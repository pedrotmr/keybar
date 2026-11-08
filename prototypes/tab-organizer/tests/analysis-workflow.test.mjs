import assert from 'node:assert/strict';
import test from 'node:test';

let importId = 0;
const tab = (id, url, extra = {}) => ({ id, url, title: 'Docs', pinned: false, windowId: 1, groupId: -1, ...extra });

async function harness(
  t,
  tabs = [
    tab(11, 'https://example.com/a'),
    tab(22, 'https://example.com/a'),
    tab(33, 'https://example.com/b'),
    tab(44, 'https://example.com/pinned', { pinned: true }),
  ],
) {
  const previousChrome = globalThis.chrome;
  let listener;
  let settings = { provider: 'codex', selections: { codex: { modelId: 'gpt-6-luna', reasoningEffort: 'low' } } };
  const state = {
    tabs,
    calls: [],
    ports: [],
    deferred: [],
    pause: false,
    failNext: false,
    removed: [],
    previews: [],
    streamPreview: false,
    recovery: undefined,
    pendingCreates: [],
    pauseCreateOnce: false,
    failCreates: false,
    failRecoveryReadOnce: false,
    failGroupOperation: false,
    created: [],
  };
  const event = () => {
    const listeners = [];
    return { addListener: (fn) => listeners.push(fn), emit: (value) => listeners.forEach((fn) => fn(value)) };
  };
  function reply(port, message) {
    if (message.action === 'analyze' && state.streamPreview) {
      port.onMessage.emit({ id: message.id, event: 'progress', data: { groups: [{ name: 'Docs', tabIds: [1, 2] }] } });
    }
    if (message.action === 'analyze' && state.failNext) {
      state.failNext = false;
      port.onMessage.emit({ id: message.id, ok: false, error: 'provider unavailable' });
      return;
    }
    const data =
      message.action === 'analyze'
        ? {
            groups: [{ name: 'Docs', tabIds: [1, 2] }],
            closeCandidates: [],
            latencyMs: 100,
            timings: { authMs: 1, requestMs: 98, validationMs: 1 },
            outputCharacters: 50,
          }
        : { status: 'connected', sharing: true };
    port.onMessage.emit({ id: message.id, ok: true, data });
  }
  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://prototype/${path}`,
      onMessage: {
        addListener: (fn) => {
          listener = fn;
        },
      },
      sendMessage: async (message) => {
        state.previews.push(message);
      },
      connectNative: () => {
        const port = {
          onMessage: event(),
          onDisconnect: event(),
          disconnected: false,
          disconnect() {
            if (!this.disconnected) {
              this.disconnected = true;
              this.onDisconnect.emit();
            }
          },
          postMessage(message) {
            if (message.action === 'cancel-analysis') return;
            if (message.action === 'analyze') state.calls.push(message);
            if (state.pause && message.action === 'analyze') state.deferred.push(() => reply(this, message));
            else queueMicrotask(() => reply(this, message));
          },
        };
        state.ports.push(port);
        return port;
      },
    },
    tabs: {
      query: async () => structuredClone(state.tabs),
      get: async (id) => {
        const found = state.tabs.find((tab) => tab.id === id);
        if (!found) throw new Error('tab closed');
        return structuredClone(found);
      },
      remove: async (id) => {
        state.removed.push(id);
        state.tabs = state.tabs.filter((tab) => tab.id !== id);
      },
      group: async () => {
        if (state.failGroupOperation) throw new Error('tab group operation failed');
        return 100;
      },
      create: async (properties) => {
        state.created.push(properties);
        if (state.pauseCreateOnce) {
          state.pauseCreateOnce = false;
          await new Promise((resolve) => state.pendingCreates.push(resolve));
        }
        if (state.failCreates) throw new Error('cannot reopen tab');
        return { id: 100 + state.created.length };
      },
    },
    tabGroups: { query: async () => [], update: async () => ({}) },
    storage: {
      local: {
        get: async () => ({ tabOrganizerProviderSettings: structuredClone(settings) }),
        set: async (value) => {
          settings = structuredClone(value.tabOrganizerProviderSettings);
        },
      },
      session: {
        get: async (key) => {
          if (state.failRecoveryReadOnce) {
            state.failRecoveryReadOnce = false;
            throw new Error('recovery read failed');
          }
          return { [key]: structuredClone(state.recovery) };
        },
        set: async (value) => {
          state.recovery = structuredClone(value.recentClosedTabs);
        },
        remove: async () => {
          state.recovery = undefined;
        },
      },
    },
  };
  t.after(() => {
    state.ports.forEach((port) => port.disconnect());
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  await import(`../extension/service-worker.js?test=${++importId}`);
  const send = (message) =>
    new Promise((resolve, reject) => {
      listener(message, {}, (response) => (response.ok ? resolve(response.result) : reject(new Error(response.error))));
    });
  return { state, send };
}

test('fresh analysis reduces model input; repeat uses cache without stale request timings; force refresh calls AI', async (t) => {
  const { state, send } = await harness(t);
  const first = await send({ type: 'analyze' });
  assert.equal(first.resultSource, 'fresh');
  assert.equal(first.tabsSentToModel, 2);
  assert.equal(first.tabsAnalyzed, 4);
  assert.equal(first.exactDuplicateCount, 1);
  assert.deepEqual(
    state.calls[0].tabs.map((tab) => tab.url),
    ['https://example.com/a', 'https://example.com/b'],
  );
  assert.deepEqual(
    first.groups[0].tabs.map((tab) => tab.id),
    [11, 22, 33],
  );
  const cached = await send({ type: 'analyze' });
  assert.equal(cached.resultSource, 'cached');
  assert.equal(cached.tabsSentToModel, 0);
  assert.equal(cached.timings, undefined);
  assert.equal(cached.latencyMs, undefined);
  assert.equal(state.calls.length, 1);
  assert.equal((await send({ type: 'analyze', forceRefresh: true })).resultSource, 'fresh');
  assert.equal(state.calls.length, 2);
});

test('duplicate-only analysis finishes locally without opening a native connection', async (t) => {
  const { state, send } = await harness(t, [tab(11, 'https://example.com/a'), tab(22, 'https://example.com/a')]);
  const result = await send({ type: 'analyze' });
  assert.equal(result.resultSource, 'local');
  assert.equal(result.tabsSentToModel, 0);
  assert.equal(result.closeCandidates[0].id, 22);
  assert.equal(result.closeCandidates[0].keepTabId, 11);
  assert.equal(state.ports.length, 0);
});

test('changed tabs and model settings each require a fresh request', async (t) => {
  const { state, send } = await harness(t);
  await send({ type: 'analyze' });
  state.tabs[0].url += '?changed=true';
  assert.equal((await send({ type: 'analyze' })).resultSource, 'fresh');
  const settings = await send({ type: 'get-settings' });
  settings.selections.codex.reasoningEffort = 'none';
  await send({ type: 'save-settings', settings });
  assert.equal((await send({ type: 'analyze' })).resultSource, 'fresh');
  assert.equal(state.calls.length, 3);
});

test('disconnect invalidates a cached proposal and failed requests never populate the cache', async (t) => {
  const { state, send } = await harness(t);
  await send({ type: 'analyze' });
  await send({ type: 'disconnect', provider: 'codex' });
  state.failNext = true;
  await assert.rejects(send({ type: 'analyze' }), /provider unavailable/);
  assert.equal((await send({ type: 'analyze' })).resultSource, 'fresh');
  assert.equal(state.calls.length, 3);
});

test('invalidation while inference is pending prevents that response from repopulating the cache', async (t) => {
  const { state, send } = await harness(t);
  state.pause = true;
  const pending = send({ type: 'analyze' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.deferred.length, 1);
  await send({ type: 'disconnect', provider: 'codex' });
  state.deferred.shift()();
  await pending;
  state.pause = false;
  assert.equal((await send({ type: 'analyze' })).resultSource, 'fresh');
});

test('a stale popup cancellation cannot cancel a newer analysis run', async (t) => {
  const { state, send } = await harness(t);
  state.pause = true;
  const pendingAnalysis = send({ type: 'analyze', runId: 'current-run' });
  await new Promise((resolve) => setImmediate(resolve));
  await send({ type: 'cancel-analysis', runId: 'stale-run' });
  state.deferred.shift()();
  assert.equal((await pendingAnalysis).resultSource, 'fresh');
});

test('applying a local closure skips a duplicate if its keeper has disappeared', async (t) => {
  const { state, send } = await harness(t);
  const result = await send({ type: 'analyze' });
  state.tabs = state.tabs.filter((tab) => tab.id !== 11);
  const applied = await send({ type: 'apply', selection: { groups: [], closeIds: result.closeCandidates } });
  assert.equal(applied.closedCount, 0);
  assert.equal(applied.skipped.length, 1);
  assert.deepEqual(state.removed, []);
});

test('apply reports browser operation failures separately from tabs that changed', async (t) => {
  const { state, send } = await harness(t);
  state.failGroupOperation = true;
  const applied = await send({
    type: 'apply',
    selection: {
      groups: [{ name: 'Docs', tabs: [state.tabs[0], state.tabs[2]] }],
      closeIds: [],
    },
  });
  assert.deepEqual(applied.skipped, []);
  assert.deepEqual(applied.failures, ['Docs']);
});

test('progress expands original tabs, includes the popup run ID and cannot be applied or cached early', async (t) => {
  const { state, send } = await harness(t);
  state.pause = true;
  const pending = send({ type: 'analyze', runId: 'popup-run' });
  await new Promise((resolve) => setImmediate(resolve));
  state.ports[0].onMessage.emit({
    id: state.calls[0].id,
    event: 'progress',
    data: { groups: [{ name: 'Docs', tabIds: [1, 2] }] },
  });
  assert.equal(state.previews[0].runId, 'popup-run');
  assert.deepEqual(
    state.previews[0].groups[0].tabs.map((tab) => tab.id),
    [11, 22, 33],
  );
  await assert.rejects(send({ type: 'apply', selection: { groups: [], closeIds: [] } }), /full proposal/);
  await assert.rejects(send({ type: 'analyze' }), /already running/);
  state.deferred.shift()();
  await pending;
  assert.equal((await send({ type: 'analyze' })).resultSource, 'cached');
});

test('a response that fails after streaming a preview does not populate the cache', async (t) => {
  const { state, send } = await harness(t);
  state.streamPreview = true;
  state.failNext = true;
  await assert.rejects(send({ type: 'analyze', runId: 'failed-run' }), /provider unavailable/);
  assert.equal(state.previews.length, 1);
  assert.equal((await send({ type: 'analyze' })).resultSource, 'fresh');
  assert.equal(state.calls.length, 2);
});

for (const failReopen of [false, true]) {
  test(`recovery batches survive overlapping reopen and close operations (reopen fails: ${failReopen})`, async (t) => {
    const { state, send } = await harness(t);
    state.recovery = [{ title: 'Old closed tab', url: 'https://old.example/', windowId: 1 }];
    state.pauseCreateOnce = true;
    state.failCreates = failReopen;
    const reopening = send({ type: 'reopen' });
    await new Promise((resolve) => setImmediate(resolve));
    const closing = send({ type: 'apply', selection: { groups: [], closeIds: [tab(22, 'https://example.com/a')] } });
    await new Promise((resolve) => setImmediate(resolve));
    state.pendingCreates.shift()();
    const [, applied] = await Promise.all([reopening, closing]);
    assert.equal(applied.closedCount, 1);
    assert.deepEqual(state.recovery, [{ title: 'Docs', url: 'https://example.com/a', windowId: 1 }]);
  });
}

test('concurrent reopens consume a recovery batch only once', async (t) => {
  const { state, send } = await harness(t);
  state.recovery = [{ title: 'Old closed tab', url: 'https://old.example/', windowId: 1 }];
  state.pauseCreateOnce = true;
  const first = send({ type: 'reopen' });
  await new Promise((resolve) => setImmediate(resolve));
  const second = send({ type: 'reopen' });
  await new Promise((resolve) => setImmediate(resolve));
  state.pendingCreates.shift()();
  const results = await Promise.all([first, second]);
  assert.equal(state.created.length, 1);
  assert.equal(results[0].reopened.length, 1);
  assert.equal(results[1].reopened.length, 0);
});

test('failed recovery operations do not prevent later closing batches from being saved', async (t) => {
  const { state, send } = await harness(t);
  state.failRecoveryReadOnce = true;
  await assert.rejects(send({ type: 'reopen' }), /recovery read failed/);
  const result = await send({ type: 'apply', selection: { groups: [], closeIds: [tab(22, 'https://example.com/a')] } });
  assert.equal(result.closedCount, 1);
  assert.equal(state.recovery.length, 1);
});

test('a queued apply rejected by a newer analysis leaves that analysis cacheable', async (t) => {
  const { state, send } = await harness(t);
  state.recovery = [{ title: 'Old closed tab', url: 'https://old.example/', windowId: 1 }];
  state.pauseCreateOnce = true;
  const reopening = send({ type: 'reopen' });
  await new Promise((resolve) => setImmediate(resolve));
  const rejectedApply = assert.rejects(
    send({ type: 'apply', selection: { groups: [], closeIds: [] } }),
    /full proposal/,
  );
  state.pause = true;
  const analyzing = send({ type: 'analyze' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.deferred.length, 1);
  state.pendingCreates.shift()();
  await reopening;
  await rejectedApply;
  state.deferred.shift()();
  await analyzing;
  state.pause = false;
  assert.equal((await send({ type: 'analyze' })).resultSource, 'cached');
  assert.equal(state.calls.length, 1);
});
