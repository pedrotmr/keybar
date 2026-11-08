import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

let importId = 0;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const groups = [
  {
    name: 'Docs',
    tabs: [
      { id: 1, title: 'Docs A', url: 'https://example.com/a', pinned: false },
      { id: 2, title: 'Docs B', url: 'https://example.com/b', pinned: false },
    ],
  },
];
const finalProposal = () => ({
  groups,
  closeCandidates: [],
  provider: 'codex',
  modelName: 'gpt-6-luna',
  reasoningEffort: 'low',
  tabsAnalyzed: 2,
  tabsSentToModel: 2,
  exactDuplicateCount: 0,
  latencyMs: 100,
  optimizationStep: 4,
  resultSource: 'fresh',
  outputCharacters: 100,
  timings: { authMs: 0, requestMs: 100, validationMs: 0 },
});

async function harness(t) {
  const dom = new JSDOM(await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  const previous = { document: globalThis.document, Option: globalThis.Option, chrome: globalThis.chrome };
  globalThis.document = dom.window.document;
  globalThis.Option = dom.window.Option;
  const listeners = [];
  const analyses = [];
  const messages = [];
  const state = {
    deferredCatalogProviders: new Set(),
    catalogRequests: [],
    deferredSessionProviders: new Set(),
    sessionRequests: [],
    pauseSaveOnce: false,
    pendingSaves: [],
    providerActions: [],
    sessions: {},
  };
  const catalogFor = (provider) => ({
    models: [
      {
        id: provider === 'codex' ? 'gpt-6-luna' : 'haiku',
        displayName: provider === 'codex' ? 'Luna' : 'Haiku',
        defaultReasoningEffort: 'low',
        reasoningEfforts: [{ value: 'low', label: 'Low' }],
      },
    ],
  });
  let settings = {
    provider: 'codex',
    selections: {
      codex: { modelId: 'gpt-6-luna', reasoningEffort: 'low' },
      anthropic: { modelId: '', reasoningEffort: 'default' },
    },
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (message) => {
        messages.push(message);
        if (message.type === 'analyze') return new Promise((resolve) => analyses.push({ message, resolve }));
        if (['connect', 'disconnect', 'connect-claude'].includes(message.type)) {
          return new Promise((resolve) => state.providerActions.push({ message, resolve }));
        }
        if (message.type === 'catalog') {
          if (state.deferredCatalogProviders.has(message.provider)) {
            return new Promise((resolve) => state.catalogRequests.push({ message, resolve }));
          }
          return Promise.resolve({ ok: true, result: catalogFor(message.provider) });
        }
        if (message.type === 'session' && state.deferredSessionProviders.has(message.provider)) {
          return new Promise((resolve) => state.sessionRequests.push({ message, resolve }));
        }
        if (message.type === 'save-settings') {
          const save = () => {
            settings = structuredClone(message.settings);
            return { ok: true, result: structuredClone(settings) };
          };
          if (state.pauseSaveOnce) {
            state.pauseSaveOnce = false;
            return new Promise((resolve) => state.pendingSaves.push({ resolve, save }));
          }
          return Promise.resolve(save());
        }
        const result = {
          'get-settings': structuredClone(settings),
          session: state.sessions[message.provider] || { status: 'connected', sharing: true },
          'has-reopenable-tabs': false,
        }[message.type];
        return Promise.resolve({ ok: true, result });
      },
    },
  };
  t.after(() => {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  await import(`../extension/popup.js?test=${++importId}`);
  await flush();
  const $ = (selector) => dom.window.document.querySelector(selector);
  const preview = (value = groups, runId = analyses.at(-1).message.runId) => {
    listeners.forEach((fn) => fn({ type: 'analysis-progress', runId, groups: value }));
  };
  assert.equal($('#organize').disabled, false);
  const changeProvider = async (provider) => {
    $('#provider').value = provider;
    $('#provider').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flush();
  };
  return { $, preview, analyses, messages, state, catalogFor, changeProvider, savedSettings: () => settings };
}

test('popup shows read-only groups before completion and enables review only after the final response', async (t) => {
  const { $, preview, analyses, messages } = await harness(t);
  $('#organize').click();
  preview(groups, 'another-popup-run');
  assert.equal($('#results').classList.contains('hidden'), true);
  preview([{ ...groups[0], name: '<img src=x onerror=alert(1)>' }]);
  assert.equal($('#results').classList.contains('hidden'), false);
  assert.equal($('#groups h3').textContent, '<img src=x onerror=alert(1)>');
  assert.equal($('#groups img'), null);
  assert.equal($('#groups input').disabled, true);
  assert.equal($('#apply').disabled, true);
  assert.equal($('#reanalyze').disabled, true);
  $('#apply').click();
  assert.equal(
    messages.some((message) => message.type === 'apply'),
    false,
  );
  analyses[0].resolve({ ok: true, result: finalProposal() });
  await flush();
  assert.equal($('#groups h3').textContent, 'Docs');
  assert.equal($('#groups input').disabled, false);
  assert.equal($('#apply').disabled, false);
  assert.equal($('#reanalyze').disabled, false);
  assert.match($('#timing-details').textContent, /First group shown: \d+ ms/);
  assert.match($('#timing-details').textContent, /Total: \d+ ms/);
});

test('cancellation removes previews and old progress cannot appear in a subsequent run', async (t) => {
  const { $, preview, analyses, messages } = await harness(t);
  $('#organize').click();
  const oldRun = analyses[0].message.runId;
  preview();
  $('#cancel').click();
  assert.equal(messages.find((message) => message.type === 'cancel-analysis')?.runId, oldRun);
  preview();
  assert.equal($('#results').classList.contains('hidden'), true);
  assert.equal($('#groups').children.length, 0);
  analyses[0].resolve({ ok: true, result: finalProposal() });
  await flush();
  assert.equal($('#results').classList.contains('hidden'), true);
  assert.equal($('#apply').disabled, true);
  $('#organize').click();
  preview(groups, oldRun);
  assert.equal($('#results').classList.contains('hidden'), true);
  preview();
  assert.equal($('#results').classList.contains('hidden'), false);
  analyses[1].resolve({ ok: true, result: finalProposal() });
  await flush();
});

test('final errors discard preview groups and never enable Apply', async (t) => {
  const { $, preview, analyses } = await harness(t);
  $('#organize').click();
  preview();
  analyses[0].resolve({ ok: false, error: 'Incomplete proposal; no tabs changed.' });
  await flush();
  preview();
  assert.equal($('#results').classList.contains('hidden'), true);
  assert.equal($('#groups').children.length, 0);
  assert.equal($('#apply').disabled, true);
  assert.match($('#message').textContent, /Incomplete proposal/);
});

test('cached proposals remain immediate complete results without a fabricated streaming time', async (t) => {
  const { $, analyses } = await harness(t);
  $('#organize').click();
  const result = finalProposal();
  delete result.timings;
  delete result.latencyMs;
  result.resultSource = 'cached';
  result.cacheAgeMs = 100;
  result.tabsSentToModel = 0;
  analyses[0].resolve({ ok: true, result });
  await flush();
  assert.match($('#latency').textContent, /Cached proposal/);
  assert.doesNotMatch($('#timing-details').textContent, /First group shown|Host:|NaN/);
  assert.equal($('#apply').disabled, false);
});

test('stale catalog success cannot replace the model list after a provider switch', async (t) => {
  const { $, state, catalogFor, changeProvider } = await harness(t);
  state.deferredCatalogProviders.add('codex');
  $('#refresh-models').click();
  assert.equal(state.catalogRequests.length, 1);
  await changeProvider('anthropic');
  assert.equal($('#model').value, 'haiku');
  state.catalogRequests[0].resolve({ ok: true, result: catalogFor('codex') });
  await flush();
  assert.equal($('#provider').value, 'anthropic');
  assert.equal($('#model').value, 'haiku');
  assert.deepEqual(
    [...$('#model').options].map((option) => option.value),
    ['haiku'],
  );
});

test('stale catalog errors cannot clear the active provider or display an unrelated failure', async (t) => {
  const { $, state, changeProvider } = await harness(t);
  state.deferredCatalogProviders.add('codex');
  $('#refresh-models').click();
  await changeProvider('anthropic');
  state.catalogRequests[0].resolve({ ok: false, error: 'obsolete Codex request failed' });
  await flush();
  assert.equal($('#model').value, 'haiku');
  assert.doesNotMatch($('#message').textContent, /obsolete/);
});

test('stale catalog responses are ignored even after switching back to their original provider', async (t) => {
  const { $, state, catalogFor, changeProvider } = await harness(t);
  state.deferredCatalogProviders.add('codex');
  $('#refresh-models').click();
  await changeProvider('anthropic');
  state.deferredCatalogProviders.clear();
  await changeProvider('codex');
  const obsolete = catalogFor('codex');
  obsolete.models[0].id = 'obsolete-model';
  state.catalogRequests[0].resolve({ ok: true, result: obsolete });
  await flush();
  assert.equal($('#model').value, 'gpt-6-luna');
});

test('stale session responses cannot disconnect the selected provider', async (t) => {
  const { $, state, changeProvider } = await harness(t);
  await changeProvider('anthropic');
  state.deferredSessionProviders.add('codex');
  await changeProvider('codex');
  assert.equal(state.sessionRequests.length, 1);
  await changeProvider('anthropic');
  state.sessionRequests[0].resolve({ ok: true, result: { status: 'disconnected', sharing: false } });
  await flush();
  assert.equal($('#model').value, 'haiku');
  assert.equal($('#organize').disabled, false);
  assert.match($('#connection').textContent, /Claude Code is signed in/);
});

for (const failSave of [false, true]) {
  test(`pending catalog settings cannot overwrite a provider switch (save fails: ${failSave})`, async (t) => {
    const { $, state, changeProvider, savedSettings } = await harness(t);
    state.pauseSaveOnce = true;
    $('#refresh-models').click();
    await flush();
    assert.equal(state.pendingSaves.length, 1);
    await changeProvider('anthropic');
    const pending = state.pendingSaves[0];
    pending.resolve(failSave ? { ok: false, error: 'obsolete save failed' } : pending.save());
    await flush();
    assert.equal(savedSettings().provider, 'anthropic');
    assert.equal(savedSettings().selections.anthropic.modelId, 'haiku');
    assert.equal($('#model').value, 'haiku');
    assert.equal($('#organize').disabled, false);
    assert.doesNotMatch($('#message').textContent, /obsolete/);
  });
}

test('a settings save failure preserves the successfully loaded catalog and displays the error', async (t) => {
  const { $, state } = await harness(t);
  state.pauseSaveOnce = true;
  $('#refresh-models').click();
  await flush();
  state.pendingSaves[0].resolve({ ok: false, error: 'settings storage unavailable' });
  await flush();
  assert.equal($('#model').value, 'gpt-6-luna');
  assert.equal($('#model').disabled, false);
  assert.match($('#message').textContent, /settings storage unavailable/);
});

for (const action of [
  { type: 'connect', button: '#connect', provider: 'codex', signedOut: true },
  { type: 'disconnect', button: '#disconnect', provider: 'codex' },
  { type: 'connect-claude', button: '#connect-claude', provider: 'anthropic', signedOut: true },
]) {
  for (const switchProvider of [false, true]) {
    test(`${action.type} failures are shown only for the current provider (switched: ${switchProvider})`, async (t) => {
      const { $, state, changeProvider } = await harness(t);
      if (action.signedOut) state.sessions[action.provider] = { status: 'disconnected', sharing: false };
      if (action.provider === 'codex' && action.signedOut) await changeProvider('anthropic');
      await changeProvider(action.provider);
      assert.equal($(action.button).classList.contains('hidden'), false);
      $(action.button).click();
      assert.equal(state.providerActions[0].message.type, action.type);
      if (switchProvider) await changeProvider(action.provider === 'codex' ? 'anthropic' : 'codex');
      state.providerActions[0].resolve({ ok: false, error: 'authentication action failed' });
      await flush();
      if (switchProvider) {
        assert.doesNotMatch($('#message').textContent, /authentication action failed/);
        assert.equal($('#model').disabled, false);
      } else {
        assert.match($('#message').textContent, /authentication action failed/);
      }
    });
  }
}
