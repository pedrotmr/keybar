import { createNativeHostClient } from './native-host-client.mjs';
import {
  createProposalCache,
  keeperMatches,
  mergeLocalAnalysis,
  prepareAnalysis,
  proposalCacheKey,
} from './local-analysis.mjs';
import { ANALYSIS_REQUEST_TIMEOUT_MS, CLI_LAUNCH_TIMEOUT_MS, SIGN_IN_TIMEOUT_MS } from './shared/timeouts.mjs';
import { normalizeProviderSettings, PROVIDERS, isProvider } from './shared/provider-config.mjs';
import { NativeHostAction, PopupMessage } from './shared/protocol.mjs';

const HOST = 'com.keybar.tab_organizer';
const hostClient = createNativeHostClient({
  connect: () => chrome.runtime.connectNative(HOST),
  lastError: () => chrome.runtime.lastError?.message,
});
const CLOSED_KEY = 'recentClosedTabs';
const SETTINGS_KEY = 'tabOrganizerProviderSettings';
const MAX_TABS = 100;
let activeAnalysis;
let recoveryQueue = Promise.resolve();
const proposalCache = createProposalCache();

function invalidateProposalCache() {
  proposalCache.clear();
  if (activeAnalysis) activeAnalysis.cacheInvalidated = true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === PopupMessage.cancelAnalysis) {
    cancelActiveAnalysis(message.runId);
    sendResponse({ ok: true });
    return false;
  }

  void handleMessage(message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: safeError(error) }),
  );
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case PopupMessage.session: {
      const provider = requireProvider(message.provider);
      const session = await requestHost({ action: NativeHostAction.session, provider });
      if (provider === 'codex' ? !session.sharing : session.status !== 'connected') invalidateProposalCache();
      return session;
    }
    case PopupMessage.connect:
      if (requireProvider(message.provider) !== 'codex')
        throw new Error('Choose Codex in provider settings to connect it.');
      invalidateProposalCache();
      return requestHost({ action: NativeHostAction.signIn, provider: 'codex' }, { timeoutMs: SIGN_IN_TIMEOUT_MS });
    case PopupMessage.connectClaude:
      if (requireProvider(message.provider) !== 'anthropic')
        throw new Error('Choose Claude Code in provider settings to connect it.');
      invalidateProposalCache();
      return requestHost(
        { action: NativeHostAction.claudeLogin, provider: 'anthropic' },
        { timeoutMs: CLI_LAUNCH_TIMEOUT_MS },
      );
    case PopupMessage.disconnect:
      invalidateProposalCache();
      return requestHost({ action: NativeHostAction.disconnect, provider: requireProvider(message.provider) });
    case PopupMessage.catalog:
      return requestHost({ action: NativeHostAction.catalog, provider: requireProvider(message.provider) });
    case PopupMessage.getSettings:
      return readSettings();
    case PopupMessage.saveSettings:
      return saveSettings(message.settings);
    case PopupMessage.analyze:
      return analyzeTabs(message.forceRefresh === true, message.runId);
    case PopupMessage.hasReopenableTabs: {
      const stored = await chrome.storage.session.get(CLOSED_KEY);
      return Array.isArray(stored[CLOSED_KEY]) && stored[CLOSED_KEY].length > 0;
    }
    case PopupMessage.apply:
      if (activeAnalysis) throw new Error('Wait for the full proposal before applying changes.');
      return serializeRecovery(() => {
        if (activeAnalysis) throw new Error('Wait for the full proposal before applying changes.');
        invalidateProposalCache();
        return applyProposal(message.selection);
      });
    case PopupMessage.loadSample:
      invalidateProposalCache();
      return loadSampleTabs();
    case PopupMessage.reopen:
      return serializeRecovery(() => {
        invalidateProposalCache();
        return reopenLastClosedTabs();
      });
    default:
      throw new Error('Unknown prototype action.');
  }
}

function serializeRecovery(operation) {
  const result = recoveryQueue.then(operation);
  recoveryQueue = result.catch(() => {});
  return result;
}

async function analyzeTabs(forceRefresh = false, runId) {
  if (activeAnalysis) throw new Error('An analysis is already running.');
  if (forceRefresh) proposalCache.clear();
  const analysis = { runId, cancelled: false, cacheInvalidated: false, controller: new AbortController() };
  activeAnalysis = analysis;
  try {
    const settings = await readSettings();
    const selection = settings.selections[settings.provider];
    if (!selection.modelId) throw new Error('Choose a provider model before organizing tabs.');
    const tabs = await getEligibleTabs();
    if (analysis.cancelled) throw new Error('Analysis cancelled. No tabs were changed.');
    if (tabs.length < 2) throw new Error('Open at least two web tabs, or load the sample tabs first.');
    if (tabs.length > MAX_TABS) throw new Error(`This prototype analyzes up to ${MAX_TABS} tabs at a time.`);
    const cacheKey = proposalCacheKey(tabs, settings.provider, selection);
    const cached = forceRefresh ? undefined : proposalCache.get(cacheKey);
    if (cached) {
      return {
        ...cached.proposal,
        optimizationStep: 4,
        resultSource: 'cached',
        cacheAgeMs: cached.ageMs,
        tabsSentToModel: 0,
      };
    }
    const prepared = prepareAnalysis(tabs);
    const tabsByRequestId = new Map(prepared.modelTabs.map((tab, index) => [index + 1, tab]));
    const hostTabs = prepared.modelTabs.map((tab, index) => ({
      id: index + 1,
      title: tab.title,
      url: tab.url.slice(0, 2048),
      pinned: tab.pinned,
      group: tab.group,
    }));
    const result =
      hostTabs.length < 2
        ? { groups: [], closeCandidates: [] }
        : await requestHost(
            {
              action: NativeHostAction.analyze,
              provider: settings.provider,
              modelId: selection.modelId,
              reasoningEffort: selection.reasoningEffort,
              tabs: hostTabs,
            },
            {
              analysis,
              timeoutMs: ANALYSIS_REQUEST_TIMEOUT_MS,
              onProgress: (preview) => {
                if (
                  analysis.cancelled ||
                  activeAnalysis !== analysis ||
                  typeof runId !== 'string' ||
                  runId.length > 128
                )
                  return;
                const restored = restoreTabReferences({ groups: preview.groups, closeCandidates: [] }, tabsByRequestId);
                const { groups } = mergeLocalAnalysis(restored, prepared);
                if (!groups.length) return;
                void chrome.runtime
                  .sendMessage({
                    type: PopupMessage.analysisProgress,
                    runId,
                    groups,
                  })
                  .catch(() => {
                    // Closing the popup must not interrupt inference or populate a partial cache entry.
                  });
              },
            },
          );
    if (analysis.cancelled) throw new Error('Analysis cancelled. No tabs were changed.');
    const proposal = mergeLocalAnalysis(restoreTabReferences(result, tabsByRequestId), prepared);
    const reusable = {
      groups: proposal.groups,
      closeCandidates: proposal.closeCandidates,
      provider: settings.provider,
      modelName: selection.modelId,
      ...(selection.reasoningEffort !== 'default' ? { reasoningEffort: selection.reasoningEffort } : {}),
      tabsAnalyzed: tabs.length,
      exactDuplicateCount: prepared.localCloseCandidates.length,
    };
    if (!analysis.cacheInvalidated) proposalCache.set(cacheKey, reusable);
    return {
      ...proposal,
      ...reusable,
      optimizationStep: 4,
      resultSource: hostTabs.length < 2 ? 'local' : 'fresh',
      tabsSentToModel: hostTabs.length < 2 ? 0 : hostTabs.length,
    };
  } finally {
    if (activeAnalysis === analysis) activeAnalysis = undefined;
  }
}

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

async function saveSettings(value) {
  const settings = normalizeSettings(value);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

function normalizeSettings(value) {
  return normalizeProviderSettings(value);
}

function requireProvider(provider) {
  if (!isProvider(provider)) {
    const labels = Object.values(PROVIDERS)
      .map(({ label }) => label)
      .join(' or ');
    throw new Error(`Choose ${labels} in provider settings.`);
  }
  return provider;
}

function restoreTabReferences(proposal, tabsByRequestId) {
  const groups = proposal.groups
    .map(({ tabIds, ...group }) => ({
      ...group,
      tabs: tabIds.map((id) => tabsByRequestId.get(id)).filter(Boolean),
    }))
    .filter((group) => group.tabs.length >= 2);
  const closeCandidates = proposal.closeCandidates.flatMap(({ tabId, reason }) => {
    const tab = tabsByRequestId.get(tabId);
    return tab ? [{ ...tab, reason }] : [];
  });
  return { ...proposal, groups, closeCandidates };
}

function cancelActiveAnalysis(runId) {
  if (!activeAnalysis || typeof runId !== 'string' || activeAnalysis.runId !== runId) return;
  activeAnalysis.cancelled = true;
  activeAnalysis.controller.abort();
}

async function getEligibleTabs() {
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  const groupById = new Map(groups.map((group) => [group.id, group.title || 'Untitled group']));
  return tabs
    .filter((tab) => {
      const url = tab.url || '';
      return tab.id !== undefined && (/^https?:\/\//i.test(url) || url.startsWith(chrome.runtime.getURL('sample/')));
    })
    .map((tab) => ({
      id: tab.id,
      title: String(tab.title || 'Untitled tab').slice(0, 300),
      url: String(tab.url),
      pinned: Boolean(tab.pinned),
      windowId: tab.windowId,
      groupId: tab.groupId,
      group: (tab.groupId >= 0 ? groupById.get(tab.groupId) || 'Existing group' : '').slice(0, 80),
    }));
}

function requestHost(payload, { analysis, onProgress, timeoutMs = ANALYSIS_REQUEST_TIMEOUT_MS } = {}) {
  return hostClient.request(payload, { signal: analysis?.controller.signal, onProgress, timeoutMs });
}

async function applyProposal(selection) {
  if (!selection || !Array.isArray(selection.groups) || !Array.isArray(selection.closeIds)) {
    throw new Error('The selected proposal is invalid. Analyze the tabs again.');
  }
  const closed = [];
  const skipped = [];
  const failures = [];
  const appliedGroups = [];

  for (const group of selection.groups) {
    const groupsByWindow = new Map();
    const initialTabs = await Promise.all(
      group.tabs.map(async (original) => {
        try {
          return { original, current: await chrome.tabs.get(original.id) };
        } catch {
          return { original, current: undefined };
        }
      }),
    );
    for (const { original, current } of initialTabs) {
      if (
        !current ||
        original.pinned ||
        current.pinned ||
        current.url !== original.url ||
        current.windowId === undefined
      ) {
        skipped.push(original.title);
        continue;
      }
      const windowTabs = groupsByWindow.get(current.windowId) || [];
      windowTabs.push(original);
      groupsByWindow.set(current.windowId, windowTabs);
    }

    for (const [windowId, originals] of groupsByWindow) {
      const latestTabs = await Promise.all(
        originals.map(async (original) => {
          try {
            return { original, current: await chrome.tabs.get(original.id) };
          } catch {
            return { original, current: undefined };
          }
        }),
      );
      const tabIds = [];
      const groupTabs = [];
      for (const { original, current } of latestTabs) {
        if (
          !current ||
          original.pinned ||
          current.pinned ||
          current.url !== original.url ||
          current.windowId !== windowId
        ) {
          skipped.push(original.title);
          continue;
        }
        tabIds.push(current.id);
        groupTabs.push({ original, current });
      }
      if (tabIds.length < 2) {
        skipped.push(group.name);
        continue;
      }
      try {
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { title: group.name.slice(0, 60) });
        appliedGroups.push(group.name);
      } catch {
        const stillMatches = await Promise.all(
          groupTabs.map(async ({ original, current }) => {
            const latest = await chrome.tabs.get(current.id).catch(() => undefined);
            return Boolean(latest && !latest.pinned && latest.url === original.url && latest.windowId === windowId);
          }),
        );
        if (stillMatches.some((matches) => !matches)) skipped.push(group.name);
        else failures.push(group.name);
      }
    }
  }

  for (const original of selection.closeIds) {
    if (!original || !Number.isSafeInteger(original.id) || typeof original.url !== 'string' || original.pinned) {
      skipped.push(original?.title || 'Unknown tab');
      continue;
    }
    let current;
    try {
      current = await chrome.tabs.get(original.id);
    } catch {
      skipped.push(original.title || 'Untitled tab');
      continue;
    }
    if (current.url !== original.url || current.pinned) {
      skipped.push(original.title || 'Untitled tab');
      continue;
    }
    if (original.keepTabId !== undefined) {
      let keeper;
      try {
        keeper = await chrome.tabs.get(original.keepTabId);
      } catch {
        // The remaining copy must still be open before closing an exact duplicate.
      }
      if (!keeperMatches(original, keeper)) {
        skipped.push(original.title || 'Untitled tab');
        continue;
      }
    }
    try {
      await chrome.tabs.remove(current.id);
      closed.push({ title: current.title || 'Untitled tab', url: current.url, windowId: current.windowId });
    } catch {
      const latest = await chrome.tabs.get(current.id).catch(() => undefined);
      if (!latest || latest.url !== current.url || latest.pinned) skipped.push(current.title || 'Untitled tab');
      else failures.push(current.title || 'Untitled tab');
    }
  }

  if (closed.length) await chrome.storage.session.set({ [CLOSED_KEY]: closed });
  return { appliedGroups, closedCount: closed.length, skipped, failures };
}

async function loadSampleTabs() {
  const definitions = [
    ['Product docs', 'Getting started with Keybar', 'product-a'],
    ['Product docs', 'Keybar keyboard shortcuts', 'product-b'],
    ['Product docs', 'Getting started with Keybar', 'product-a'],
    ['Research notes', 'Chrome tab grouping research', 'research-a'],
    ['Research notes', 'Native messaging overview', 'research-b'],
    ['Trip planning', 'Lisbon weekend itinerary', 'travel-a'],
    ['Trip planning', 'Lisbon transit and neighborhoods', 'travel-b'],
  ];
  const samplePrefix = chrome.runtime.getURL('sample/page.html');
  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  if (currentWindowTabs.some((tab) => (tab.url || '').startsWith(samplePrefix))) {
    return { opened: 0, alreadyLoaded: true };
  }
  for (const [topic, title, page] of definitions) {
    const url = samplePrefix;
    await chrome.tabs.create({
      url: `${url}?page=${encodeURIComponent(page)}&topic=${encodeURIComponent(topic)}&title=${encodeURIComponent(title)}`,
      active: false,
    });
  }
  return { opened: definitions.length };
}

async function reopenLastClosedTabs() {
  const stored = await chrome.storage.session.get(CLOSED_KEY);
  const tabs = Array.isArray(stored[CLOSED_KEY]) ? stored[CLOSED_KEY] : [];
  const reopened = [];
  const failed = [];
  for (const tab of tabs) {
    try {
      await chrome.tabs.create({ url: tab.url, windowId: tab.windowId, active: false });
      reopened.push(tab.title);
    } catch {
      try {
        await chrome.tabs.create({ url: tab.url, active: false });
        reopened.push(`${tab.title} (opened in the current window)`);
      } catch {
        failed.push(tab);
      }
    }
  }
  if (failed.length) await chrome.storage.session.set({ [CLOSED_KEY]: failed });
  else await chrome.storage.session.remove(CLOSED_KEY);
  return { reopened, failed: failed.map((tab) => tab.title), hasMore: failed.length > 0 };
}

function safeError(error) {
  return error instanceof Error ? error.message : 'The browser action failed.';
}
