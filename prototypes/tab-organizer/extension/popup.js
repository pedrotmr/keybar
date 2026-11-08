import { chooseDefaultModel } from './shared/provider-config.mjs';
import { PopupMessage } from './shared/protocol.mjs';

const $ = (selector) => document.querySelector(selector);
const connectButton = $('#connect');
const disconnectButton = $('#disconnect');
const connectClaudeButton = $('#connect-claude');
const sampleButton = $('#sample');
const organizeButton = $('#organize');
const cancelButton = $('#cancel');
const applyButton = $('#apply');
const connectionLabel = $('#connection');
const providerSelect = $('#provider');
const modelSelect = $('#model');
const reasoningSelect = $('#reasoning');
const results = $('#results');
const groupsRoot = $('#groups');
const duplicatesRoot = $('#duplicates');
const message = $('#message');
let proposal;
let analysisCancelled = false;
let settings;
let models = [];
let session;
let currentRun;
let providerGeneration = 0;
let catalogGeneration = 0;
let settingsSaveGeneration = 0;
let settingsSaveQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message) => {
  if (
    message?.type !== PopupMessage.analysisProgress ||
    !currentRun?.running ||
    message.runId !== currentRun.id ||
    analysisCancelled ||
    !message.groups?.length
  )
    return;
  renderGroups(message.groups, true);
  duplicatesRoot.replaceChildren();
  results.classList.remove('hidden');
  currentRun.firstGroupShownMs ??= performance.now() - currentRun.clickedAt;
  $('#latency').textContent = `Receiving groups · first group ${Math.round(currentRun.firstGroupShownMs)} ms`;
  $('#notice').textContent =
    `${message.groups.length} provisional group(s). Waiting for the full proposal before review.`;
  $('#timing-label').textContent = 'Timing details · step 4';
  $('#timing-details').textContent =
    `First group shown: ${Math.round(currentRun.firstGroupShownMs)} ms · Full proposal pending`;
});

connectButton.addEventListener('click', () =>
  run(connectButton, async () => {
    connectionLabel.textContent = 'Complete the sign-in and permission flow in your browser…';
    const session = await sendProviderAction({ type: PopupMessage.connect, provider: 'codex' });
    if (!session) return;
    renderSession(session);
    await loadCatalog();
  }),
);

disconnectButton.addEventListener('click', () =>
  run(disconnectButton, async () => {
    const session = await sendProviderAction({ type: PopupMessage.disconnect, provider: 'codex' });
    if (!session) return;
    renderSession(session);
    clearCatalog();
  }),
);

connectClaudeButton.addEventListener('click', () =>
  run(connectClaudeButton, async () => {
    const result = await sendProviderAction({ type: PopupMessage.connectClaude, provider: 'anthropic' });
    if (result?.status === 'login_started') {
      connectionLabel.textContent =
        'Claude Code opened in Terminal. Finish sign-in there, then reopen this popup to check the connection.';
    }
  }),
);

providerSelect.addEventListener('change', () =>
  run(providerSelect, async () => {
    settings.provider = providerSelect.value;
    await Promise.all([saveSettings(), loadProvider()]);
  }),
);

$('#refresh-models').addEventListener('click', () => run($('#refresh-models'), loadCatalog));

modelSelect.addEventListener('change', () =>
  run(modelSelect, async () => {
    const selection = settings.selections[settings.provider];
    selection.modelId = modelSelect.value;
    const model = models.find((candidate) => candidate.id === selection.modelId);
    selection.reasoningEffort = model?.defaultReasoningEffort || 'default';
    renderModelSettings();
    await saveSettings();
  }),
);

reasoningSelect.addEventListener('change', () =>
  run(reasoningSelect, async () => {
    settings.selections[settings.provider].reasoningEffort = reasoningSelect.value;
    await saveSettings();
  }),
);

sampleButton.addEventListener('click', () =>
  run(sampleButton, async () => {
    const result = await send({ type: PopupMessage.loadSample });
    showMessage(
      result.alreadyLoaded
        ? 'Sample tabs are already open in this window.'
        : `Opened ${result.opened} local sample tabs.`,
      false,
    );
  }),
);

organizeButton.addEventListener('click', () => void organizeTabs());
$('#reanalyze').addEventListener('click', () => void organizeTabs(true));

async function organizeTabs(forceRefresh = false) {
  if (currentRun?.running) return;
  const clickedAt = performance.now();
  const run = { id: crypto.randomUUID(), clickedAt, running: true };
  currentRun = run;
  proposal = undefined;
  analysisCancelled = false;
  clearMessage();
  organizeButton.disabled = true;
  organizeButton.textContent = 'Analyzing…';
  cancelButton.classList.remove('hidden');
  results.classList.add('hidden');
  applyButton.disabled = true;
  $('#reanalyze').disabled = true;
  try {
    const result = await send({ type: PopupMessage.analyze, forceRefresh, runId: run.id });
    if (analysisCancelled) return;
    result.totalLatencyMs = performance.now() - clickedAt;
    result.firstGroupShownMs = run.firstGroupShownMs;
    proposal = result;
    renderProposal(proposal);
    applyButton.disabled = false;
  } catch (error) {
    results.classList.add('hidden');
    groupsRoot.replaceChildren();
    duplicatesRoot.replaceChildren();
    showMessage(analysisCancelled ? 'Analysis cancelled. No tabs were changed.' : error.message, !analysisCancelled);
  } finally {
    run.running = false;
    $('#reanalyze').disabled = false;
    updateOrganizeAvailability();
    organizeButton.textContent = 'Organize tabs';
    cancelButton.classList.add('hidden');
  }
}

cancelButton.addEventListener('click', () => {
  analysisCancelled = true;
  results.classList.add('hidden');
  groupsRoot.replaceChildren();
  duplicatesRoot.replaceChildren();
  proposal = undefined;
  void send({ type: PopupMessage.cancelAnalysis, runId: currentRun?.id });
  showMessage('Analysis cancelled. No tabs were changed.', false);
});

applyButton.addEventListener('click', () =>
  run(applyButton, async () => {
    const selectedByGroup = new Map();
    for (const input of groupsRoot.querySelectorAll('input[data-group-index]:checked')) {
      const groupIndex = Number(input.dataset.groupIndex);
      const group = proposal.groups[groupIndex];
      if (!group) continue;
      const selected = selectedByGroup.get(groupIndex) || { name: group.name, tabs: [] };
      const tab = group.tabs.find((candidate) => candidate.id === Number(input.dataset.tabId));
      if (tab) selected.tabs.push(tab);
      selectedByGroup.set(groupIndex, selected);
    }
    const selectedGroups = [...selectedByGroup.values()];
    const selectedCloseIds = [...duplicatesRoot.querySelectorAll('input[data-close-index]:checked')]
      .map((input) => proposal.closeCandidates[Number(input.dataset.closeIndex)])
      .filter((candidate) => candidate && !candidate.pinned);
    const result = await send({
      type: PopupMessage.apply,
      selection: { groups: selectedGroups, closeIds: selectedCloseIds },
    });
    results.classList.add('hidden');
    const skipped = result.skipped.length ? ` Skipped ${result.skipped.length} changed item(s).` : '';
    const failed = result.failures.length ? ` Could not complete ${result.failures.length} browser operation(s).` : '';
    showMessage(
      `Applied ${result.appliedGroups.length} group(s), closed ${result.closedCount} tab(s).${skipped}${failed}`,
      result.failures.length > 0,
    );
    if (result.closedCount) $('#reopen').classList.remove('hidden');
  }),
);

$('#reopen').addEventListener('click', () =>
  run($('#reopen'), async () => {
    const result = await send({ type: PopupMessage.reopen });
    $('#reopen').classList.toggle('hidden', !result.hasMore);
    const failed = result.failed.length ? ` Could not reopen ${result.failed.length} tab(s); try again.` : '';
    showMessage(`Reopened ${result.reopened.length} tab URL(s). Unsaved page state is not restored.${failed}`, false);
  }),
);

async function send(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) throw new Error(response?.error || 'The prototype could not complete that action.');
  return response.result;
}

async function sendProviderAction(payload) {
  const generation = providerGeneration;
  const isCurrent = () => generation === providerGeneration && settings.provider === payload.provider;
  try {
    const result = await send(payload);
    if (isCurrent()) return result;
  } catch (error) {
    if (isCurrent()) throw error;
  }
}

async function run(button, callback) {
  button.disabled = true;
  clearMessage();
  try {
    await callback();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadProvider() {
  const provider = settings.provider;
  const generation = ++providerGeneration;
  session = undefined;
  const isCodex = provider === 'codex';
  $('#codex-connection').classList.toggle('hidden', !isCodex);
  $('#claude-connection').classList.toggle('hidden', isCodex);
  $('#provider-help').textContent = isCodex
    ? 'Sign in with ChatGPT and grant plan usage. The installed Codex CLI supplies model and reasoning options; a listed model can still depend on your account access.'
    : 'Claude Code handles sign-in through its own CLI in Terminal. The prototype does not read or store credentials. The CLI offers effort levels rather than a non-reasoning switch, and checks model access when used.';
  $('#privacy-copy').textContent = isCodex
    ? 'When you analyze tabs, titles, up to 2,048 URL characters, pinned state, current group names, and a temporary matching number go to OpenAI through ChatGPT plan usage. The number is not a Chrome tab ID. Codex app-server loads the model catalog; analysis runs through a request with no tools. Page contents and the browser password store are not read. URLs may contain sensitive data.'
    : 'When you analyze tabs, titles, up to 2,048 URL characters, pinned state, current group names, and a temporary matching number go to Claude Code through its local CLI and then to Anthropic. The number is not a Chrome tab ID. Claude Code credentials stay under the CLI’s control. The request disables built-in and MCP tools and does not save a session. Page contents and the browser password store are not read. URLs may contain sensitive data.';

  clearCatalog();
  try {
    const value = await send({ type: PopupMessage.session, provider });
    if (generation !== providerGeneration || provider !== settings.provider) return;
    renderSession(value);
    if (isConnected(value, provider)) await loadCatalog();
    else updateOrganizeAvailability();
  } catch (error) {
    if (generation === providerGeneration && provider === settings.provider) throw error;
  }
}

function isConnected(value, provider = settings?.provider) {
  return provider === 'codex' ? value?.sharing === true : value?.status === 'connected';
}

function renderSession(value) {
  session = value;
  const provider = settings?.provider || 'codex';
  const connected = isConnected(value, provider);
  $('#refresh-models').disabled = !connected;
  const hasSavedSession = value?.status === 'connected' || value?.status === 'reauth_required';
  if (provider === 'codex') {
    connectButton.classList.toggle('hidden', connected);
    disconnectButton.classList.toggle('hidden', !hasSavedSession);
    $('#usage').classList.toggle('hidden', !connected);
    connectionLabel.textContent = connected
      ? `Connected to ChatGPT${value.identity?.email ? ` as ${value.identity.email}` : ''}; plan usage is enabled.`
      : value?.status === 'connected'
        ? 'Signed in, but ChatGPT plan usage is not enabled. Reconnect and approve it.'
        : value?.status === 'reauth_required'
          ? 'Reconnect your ChatGPT account to use Codex models.'
          : 'Not connected. Connect ChatGPT to use Codex models.';
  } else {
    connectClaudeButton.classList.toggle('hidden', connected);
    connectClaudeButton.disabled = value?.status === 'not_installed';
    connectionLabel.textContent = connected
      ? 'Claude Code is signed in with your Claude account.'
      : value?.status === 'not_installed'
        ? 'Claude Code CLI path is not registered. Install it if needed, then rerun the prototype setup.'
        : value?.status === 'unsupported_auth'
          ? 'Claude Code is signed in with an API key or another provider. This prototype requires Claude account sign-in; existing CLI credentials were left unchanged.'
          : 'Not signed in. Start Claude Code sign-in in Terminal to use the Claude plan.';
  }
  connectionLabel.dataset.error = String(
    value?.status === 'reauth_required' || value?.status === 'unsupported_auth' || value?.status === 'not_installed',
  );
  updateOrganizeAvailability();
}

async function loadCatalog() {
  const provider = settings.provider;
  const generation = ++catalogGeneration;
  const isCurrent = () => generation === catalogGeneration && provider === settings.provider;
  if (!isConnected(session, provider)) return;
  modelSelect.disabled = true;
  reasoningSelect.disabled = true;
  modelSelect.replaceChildren(new Option('Loading models…', ''));
  let catalog;
  try {
    catalog = await send({ type: PopupMessage.catalog, provider });
  } catch (error) {
    if (!isCurrent()) return;
    clearCatalog();
    throw error;
  }
  if (!isCurrent()) return;
  models = Array.isArray(catalog.models) ? catalog.models : [];
  const selection = settings.selections[provider];
  if (!models.some((model) => model.id === selection.modelId)) {
    selection.modelId = chooseDefaultModel(models, provider)?.id || '';
    const selectedModel = models.find((model) => model.id === selection.modelId);
    selection.reasoningEffort = selectedModel?.defaultReasoningEffort || 'default';
  }
  renderModelSettings();
  try {
    await saveSettings();
  } catch (error) {
    if (isCurrent()) throw error;
    return;
  }
  if (!isCurrent()) return;
  if (!models.length) showMessage('No models are available for this provider connection.', true);
  else clearMessage();
}

function renderModelSettings() {
  const selection = settings.selections[settings.provider];
  const connected = isConnected(session, settings.provider);
  $('#refresh-models').disabled = !connected;
  modelSelect.replaceChildren();
  if (!models.length) {
    modelSelect.append(new Option(connected ? 'No models loaded' : 'Connect a provider to load models', ''));
    modelSelect.disabled = true;
    reasoningSelect.replaceChildren(new Option('Provider default', 'default'));
    reasoningSelect.disabled = true;
    updateOrganizeAvailability();
    return;
  }
  for (const model of models) modelSelect.append(new Option(model.displayName, model.id));
  modelSelect.value = selection.modelId;
  modelSelect.disabled = !connected;

  const selectedModel = models.find((model) => model.id === selection.modelId);
  const choices = selectedModel?.reasoningEfforts || [{ value: 'default', label: 'Provider default' }];
  reasoningSelect.replaceChildren(...choices.map((choice) => new Option(choice.label, choice.value)));
  if (!choices.some((choice) => choice.value === selection.reasoningEffort)) {
    selection.reasoningEffort = selectedModel?.defaultReasoningEffort || choices[0]?.value || 'default';
  }
  reasoningSelect.value = selection.reasoningEffort;
  reasoningSelect.disabled = !connected || choices.length <= 1;
  updateOrganizeAvailability();
}

function clearCatalog() {
  catalogGeneration++;
  models = [];
  renderModelSettings();
}

async function saveSettings() {
  const generation = ++settingsSaveGeneration;
  const snapshot = structuredClone(settings);
  const saved = settingsSaveQueue.then(() => send({ type: PopupMessage.saveSettings, settings: snapshot }));
  settingsSaveQueue = saved.catch(() => {});
  const value = await saved;
  if (generation === settingsSaveGeneration) settings = value;
  updateOrganizeAvailability();
}

function updateOrganizeAvailability() {
  if (!settings) {
    organizeButton.disabled = true;
    return;
  }
  const selection = settings?.selections?.[settings.provider];
  organizeButton.disabled = currentRun?.running || !isConnected(session, settings.provider) || !selection?.modelId;
}

function renderProposal(value) {
  results.classList.remove('hidden');
  const effort = value.reasoningEffort ? ` · ${reasoningLabel(value.reasoningEffort)}` : '';
  const providerName = value.provider === 'anthropic' ? 'Claude Code' : 'Codex';
  const displayName =
    models.find((model) => model.id === value.modelName)?.displayName || value.modelName || providerName;
  const fresh = value.resultSource === 'fresh';
  const sourceLabel = fresh ? 'Fresh AI' : value.resultSource === 'cached' ? 'Cached proposal' : 'Local result';
  $('#latency').textContent =
    `${sourceLabel} · ${Math.round(fresh ? value.latencyMs : value.totalLatencyMs)} ms` +
    (value.resultSource === 'local' ? '' : ` · ${providerName} · ${displayName}${effort}`);
  $('#timing-label').textContent = `Timing details · step ${value.optimizationStep}`;
  const timings = value.timings;
  const requestLabel = value.provider === 'anthropic' ? 'CLI + request' : 'Request';
  $('#timing-details').textContent = [
    `Total: ${Math.round(value.totalLatencyMs)} ms`,
    `Source: ${sourceLabel}`,
    ...(fresh
      ? [
          Number.isFinite(value.firstGroupShownMs)
            ? `First group shown: ${Math.round(value.firstGroupShownMs)} ms`
            : 'First group shown: no streamed preview',
        ]
      : []),
    `Sent to AI: ${value.tabsSentToModel} of ${value.tabsAnalyzed} tabs`,
    `Exact duplicate copies found: ${value.exactDuplicateCount}`,
    ...(Number.isFinite(value.cacheAgeMs) ? [`Cache age: ${Math.round(value.cacheAgeMs / 1000)} s`] : []),
    ...(fresh ? [`Host: ${Math.round(value.latencyMs)} ms`] : []),
    ...(typeof value.hostReused === 'boolean' ? [`Companion: ${value.hostReused ? 'reused' : 'new'}`] : []),
    ...(timings
      ? [
          `Auth check: ${Math.round(timings.authMs)} ms`,
          `${requestLabel}: ${Math.round(timings.requestMs)} ms`,
          ...(Number.isFinite(timings.firstTextMs)
            ? [`First text within request: ${Math.round(timings.firstTextMs)} ms`]
            : []),
          ...(Number.isFinite(timings.firstGroupMs)
            ? [`First group within host: ${Math.round(timings.firstGroupMs)} ms`]
            : []),
          `Validation: ${Math.round(timings.validationMs)} ms`,
        ]
      : []),
    ...(Number.isFinite(value.outputCharacters) ? [`Output: ${value.outputCharacters} characters`] : []),
  ].join(' · ');
  $('#notice').textContent =
    `${value.tabsAnalyzed} tabs analyzed. ${value.groups.length} groups and ${value.closeCandidates.length} possible duplicates. Grouping is selected; closures need your explicit selection.`;
  renderGroups(value.groups);
  duplicatesRoot.replaceChildren();

  if (!value.closeCandidates.length) return;
  const section = document.createElement('article');
  section.className = 'card';
  const heading = document.createElement('h3');
  heading.textContent = 'Possible duplicates';
  section.append(heading);
  for (const [index, candidate] of value.closeCandidates.entries()) {
    const input = checkbox(`close-${index}`, candidate.title, `close ${index}`);
    input.dataset.closeIndex = String(index);
    input.checked = false;
    input.disabled = candidate.pinned;
    const reason = document.createElement('small');
    reason.textContent = `${candidate.reason} · ${candidate.url}`;
    input.parentElement.querySelector('span').append(reason);
    if (candidate.pinned) input.parentElement.querySelector('span').append(badge('pinned · protected'));
    section.append(input.parentElement);
  }
  duplicatesRoot.append(section);
}

function renderGroups(groups, provisional = false) {
  groupsRoot.replaceChildren();
  for (const [index, group] of groups.entries()) {
    const card = document.createElement('article');
    card.className = 'card';
    const heading = document.createElement('h3');
    heading.textContent = group.name;
    card.append(heading);
    for (const tab of group.tabs) {
      const input = checkbox(`group-${index}-${tab.id}`, tab.title, `group ${index}`);
      input.checked = true;
      input.disabled = provisional;
      input.dataset.groupIndex = String(index);
      input.dataset.tabId = String(tab.id);
      const details = document.createElement('small');
      details.textContent = tab.url;
      input.parentElement.querySelector('span').append(details);
      card.append(input.parentElement);
    }
    groupsRoot.append(card);
  }
}

function reasoningLabel(value) {
  if (value === 'none') return 'Non-reasoning';
  const label = value === 'xhigh' ? 'Extra high' : `${value[0].toUpperCase()}${value.slice(1)}`;
  return `${label} effort`;
}

function checkbox(id, label, data) {
  const wrapper = document.createElement('label');
  wrapper.className = 'option';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.dataset[data.startsWith('group') ? 'groupIndex' : 'closeIndex'] = data.split(' ')[1];
  const text = document.createElement('span');
  text.append(document.createTextNode(label));
  wrapper.append(input, text);
  return input;
}

function badge(label) {
  const span = document.createElement('span');
  span.className = 'badge';
  span.textContent = label;
  return span;
}

function showMessage(text, isError) {
  message.textContent = text;
  message.dataset.error = String(isError);
}

function clearMessage() {
  message.textContent = '';
  message.removeAttribute('data-error');
}

void send({ type: PopupMessage.getSettings })
  .then(async (initialSettings) => {
    settings = initialSettings;
    providerSelect.value = settings.provider;
    providerSelect.disabled = false;
    connectButton.disabled = false;
    connectClaudeButton.disabled = false;
    await loadProvider();
  })
  .catch((error) => {
    connectionLabel.textContent = error.message;
    connectionLabel.dataset.error = 'true';
  });

void send({ type: PopupMessage.hasReopenableTabs }).then((hasTabs) => {
  $('#reopen').classList.toggle('hidden', !hasTabs);
});
