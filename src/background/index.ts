import { validateRequest } from '@/utils/validateRequest';
import type { BackgroundAction, BackgroundResult } from '@/utils/chromeMessages';
import type { SplitAwareTab } from '@/types';
import { asPositiveInteger, normalizeNavigationUrl, normalizeSavedNavigationUrl } from '@/utils/chromeHelpers';
import { isTabInSplitView } from '@/utils/splitViews';
import { TAB_GROUP_ID_NONE } from '@/utils/chromeApiConstants';
import { bulkCloseTabIds } from '@/utils/bulkClose';
import { isOverlayPage } from '@/utils/pageSupport';
import { OverlayTabRegistry } from '@/utils/overlayTabRegistry';
import { TabPreviewCache, type TabPreviewRecord } from '@/utils/tabPreviewCache';
import { writePopupLaunchIntent } from '@/utils/popupLaunchIntent';
import { installTabSwitcherKeyReleaseMonitorInPage } from '@/utils/tabSwitcherKeyRelease';
import artifacts from '../../extension-artifacts.json';
import {
  getTabCustomName,
  getTabNames,
  handleClosedTabName,
  handleCreatedTabName,
  handleUpdatedTabName,
  renameTab,
  tabNameSessionInitialization,
} from './tabNames';

const TAB_PREVIEW_PREFIX = 'tabPreview:';
const TAB_PREVIEW_IDS_KEY = 'tabPreviewIds';
const OVERLAY_TAB_IDS_SESSION_KEY = 'keybarOverlayTabIds';

const MAX_TAB_PREVIEWS = 5;
const TAB_SWITCHER_OPENING_TIMEOUT_MS = 5000;

const ownExtensionUrlPrefix = chrome.runtime.getURL('');
const popupPath = artifacts.popupHtml;

const tabPreviewCache = new TabPreviewCache(
  {
    get: (key) => chrome.storage.session.get(key),
    set: (values) => chrome.storage.session.set(values),
    remove: (keys) => chrome.storage.session.remove(keys),
  },
  TAB_PREVIEW_IDS_KEY,
  TAB_PREVIEW_PREFIX,
  MAX_TAB_PREVIEWS,
);

let tabChangeBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

const overlayTabRegistry = new OverlayTabRegistry({
  load: async () => {
    const stored = await chrome.storage.session.get(OVERLAY_TAB_IDS_SESSION_KEY);
    return stored[OVERLAY_TAB_IDS_SESSION_KEY];
  },
  save: async (tabIds) => {
    await chrome.storage.session.set({ [OVERLAY_TAB_IDS_SESSION_KEY]: tabIds });
  },
  notify: (tabId, message = { action: 'ui:tabs-changed' }) => chrome.tabs.sendMessage(tabId, message),
});

const tabSwitcherOpenWindows = new Set<number>();
const tabSwitcherSurfaceByWindow = new Map<number, 'overlay' | 'popup'>();
const tabSwitcherOpeningWindows = new Map<number, { tabId: number; pendingCycles: number; startedAt: number }>();
const tabPreviewCaptureAt = new Map<number, number>();

const respond = <T>(data: T): { success: true; data: T } => {
  return { success: true, data };
};

const assertNever = (value: never): never => {
  void value;
  throw new Error('Unknown command.');
};

const typedBackgroundResult = <Action extends BackgroundAction>(
  _action: Action,
  result: NoInfer<BackgroundResult<Action>> | PromiseLike<NoInfer<BackgroundResult<Action>>>,
): Promise<BackgroundResult<Action>> => Promise.resolve(result);

const normalizeError = (error: unknown): string => {
  return error instanceof Error ? error.message : 'The browser action failed.';
};

const broadcastTabChanges = (): void => {
  if (tabChangeBroadcastTimer) {
    clearTimeout(tabChangeBroadcastTimer);
  }

  tabChangeBroadcastTimer = setTimeout(() => {
    tabChangeBroadcastTimer = null;
    void chrome.runtime.sendMessage({ action: 'ui:tabs-changed' }).catch(() => undefined);
    void overlayTabRegistry.broadcast().catch(() => undefined);
  }, 24);
};

const broadcastPermissionChanges = (): void => {
  void chrome.runtime.sendMessage({ action: 'ui:permissions-changed' }).catch(() => undefined);
  void overlayTabRegistry.broadcast({ action: 'ui:permissions-changed' }).catch(() => undefined);
};

const configureActionForTab = async (tabId: number, url?: string): Promise<void> => {
  const resolvedUrl = url ?? (await chrome.tabs.get(tabId)).url;
  await chrome.action.setPopup({ tabId, popup: isOverlayPage(resolvedUrl) ? '' : popupPath });
};

const configureActionForOpenTabs = async (): Promise<void> => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.flatMap((tab) =>
      tab.id === undefined ? [] : [configureActionForTab(tab.id, tab.url).catch(() => undefined)],
    ),
  );
};

const openPopup = async (
  tabId: number,
  mode: 'commands' | 'tabs',
  autoSwitchOnRelease = false,
  openedAt = Date.now(),
): Promise<void> => {
  await writePopupLaunchIntent({ mode, autoSwitchOnRelease, openedAt });
  await chrome.action.setPopup({ tabId, popup: popupPath });

  try {
    await chrome.action.openPopup();
  } catch {
    const url = chrome.runtime.getURL(`${popupPath}?mode=${mode}&openedAt=${openedAt}`);
    await chrome.windows.create({ url, type: 'popup', width: 600, height: 620, focused: true });
  }
};

const openOverlay = async (
  tabId: number,
  mode: 'commands' | 'tabs',
  autoSwitchOnRelease = false,
  openedAt = Date.now(),
): Promise<void> => {
  if (mode === 'tabs') {
    const tab = await chrome.tabs.get(tabId);
    const alreadyOpen = tab.windowId !== undefined && tabSwitcherOpenWindows.has(tab.windowId);

    if (!alreadyOpen) {
      await chrome.tabs.sendMessage(tabId, { action: 'overlay:close', switching: true }).catch(() => undefined);
    }
  }

  await chrome.action.setPopup({ tabId, popup: '' });
  const request = { action: 'overlay:open', mode, autoSwitchOnRelease, openedAt };

  try {
    const response = (await chrome.tabs.sendMessage(tabId, request)) as { success?: boolean } | undefined;

    if (response?.success) {
      void overlayTabRegistry.register(tabId).catch(() => undefined);
      return;
    }
  } catch {
    // The page does not have an initialized surface yet.
  }

  await chrome.tabs.sendMessage(tabId, { action: 'overlay:close', switching: true }).catch(() => undefined);
  const script = artifacts.contentSurfaces[mode].file;
  await chrome.scripting.executeScript({ target: { tabId }, files: [script] });
  const response = (await chrome.tabs.sendMessage(tabId, request)) as { success?: boolean } | undefined;

  if (!response?.success) {
    throw new Error('The page overlay could not be opened.');
  }

  void overlayTabRegistry.register(tabId).catch(() => undefined);
};

const getLiveTabSwitcherSurface = async (tabId: number, windowId: number): Promise<'overlay' | 'popup' | null> => {
  let rememberedSurface = tabSwitcherSurfaceByWindow.get(windowId);

  if (!rememberedSurface) {
    const storageKey = `tabSwitcher:${windowId}`;
    const stored: Record<string, unknown> = await chrome.storage.session.get(storageKey).catch(() => ({}));
    const persisted = stored[storageKey];

    if (persisted === 'overlay' || persisted === 'popup') {
      rememberedSurface = persisted;
      tabSwitcherSurfaceByWindow.set(windowId, persisted);
      tabSwitcherOpenWindows.add(windowId);
    }
  }

  if (rememberedSurface === 'popup' || tabSwitcherOpenWindows.has(windowId)) {
    try {
      const popupContexts = await chrome.runtime.getContexts({
        contextTypes: ['POPUP'],
        documentUrls: [chrome.runtime.getURL(popupPath)],
        windowIds: [windowId],
      });

      if (popupContexts.length) {
        tabSwitcherOpenWindows.add(windowId);
        tabSwitcherSurfaceByWindow.set(windowId, 'popup');
        return 'popup';
      }
    } catch {
      // The active-tab message below remains the authority for an injected overlay.
    }

    const popupTabs = await chrome.tabs.query({ windowId }).catch(() => []);

    if (popupTabs.some((candidate) => candidate.url?.startsWith(chrome.runtime.getURL(popupPath)))) {
      tabSwitcherOpenWindows.add(windowId);
      tabSwitcherSurfaceByWindow.set(windowId, 'popup');
      return 'popup';
    }
  }

  if (rememberedSurface !== 'overlay') {
    if (rememberedSurface === 'popup') {
      tabSwitcherOpenWindows.delete(windowId);
      tabSwitcherSurfaceByWindow.delete(windowId);
      await chrome.storage.session.remove(`tabSwitcher:${windowId}`).catch(() => undefined);
    }

    return null;
  }

  const status = (await chrome.tabs.sendMessage(tabId, { action: 'tabs:switcher-status' }).catch(() => undefined)) as
    { open?: boolean } | undefined;

  if (status?.open) {
    tabSwitcherOpenWindows.add(windowId);
    tabSwitcherSurfaceByWindow.set(windowId, 'overlay');
    return 'overlay';
  }

  tabSwitcherOpenWindows.delete(windowId);
  tabSwitcherSurfaceByWindow.delete(windowId);
  await chrome.storage.session.remove(`tabSwitcher:${windowId}`).catch(() => undefined);
  return null;
};

const cycleTabSwitcher = async (
  tabId: number,
  windowId: number,
  surface: 'overlay' | 'popup',
  cycles = 1,
): Promise<void> => {
  const message = { action: 'ui:tabs-cycle', windowId, cycles };

  if (surface === 'overlay') {
    await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
  } else {
    await chrome.runtime.sendMessage(message).catch(() => undefined);
  }
};

const rememberTabSwitcher = async (windowId: number, surface: 'overlay' | 'popup'): Promise<number> => {
  tabSwitcherOpenWindows.add(windowId);
  tabSwitcherSurfaceByWindow.set(windowId, surface);
  const opening = tabSwitcherOpeningWindows.get(windowId);
  tabSwitcherOpeningWindows.delete(windowId);
  await chrome.storage.session.set({ [`tabSwitcher:${windowId}`]: surface });
  return opening?.pendingCycles ?? 0;
};

const clearTabSwitcher = async (windowId: number): Promise<void> => {
  tabSwitcherOpenWindows.delete(windowId);
  tabSwitcherSurfaceByWindow.delete(windowId);
  tabSwitcherOpeningWindows.delete(windowId);
  await chrome.storage.session.remove(`tabSwitcher:${windowId}`);
};

const installTabSwitcherReleaseMonitor = (tabId: number): Promise<void> => {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: installTabSwitcherKeyReleaseMonitorInPage,
    })
    .then(() => undefined)
    .catch(() => undefined);
};

const openCommandCenter = async (
  mode: 'commands' | 'tabs',
  requestedTabId?: number,
  fromShortcut = false,
  shortcutTab?: chrome.tabs.Tab,
): Promise<void> => {
  const openedAt = Date.now();
  let openingWindowId: number | undefined;
  let openingLaunch: { tabId: number; pendingCycles: number; startedAt: number } | undefined;

  try {
    const tab =
      shortcutTab ?? (requestedTabId === undefined ? await getActiveTab() : await chrome.tabs.get(requestedTabId));

    if (tab?.id === undefined) {
      return;
    }

    // The Tab Switcher only runs on pages where the isolated overlay can be injected.
    // Native Chrome pages continue to use the extension action popup for Command Mode.
    if (mode === 'tabs' && !isOverlayPage(tab.url)) {
      return;
    }

    // Install the tiny release listener before the heavier Tab Switcher bundle.
    // This closes the cold-start gap when a user taps the shortcut quickly.
    if (mode === 'tabs' && fromShortcut) {
      await installTabSwitcherReleaseMonitor(tab.id);
    }

    const windowId = tab.windowId;
    const switcherTracked =
      windowId !== undefined &&
      (tabSwitcherOpenWindows.has(windowId) ||
        tabSwitcherSurfaceByWindow.has(windowId) ||
        tabSwitcherOpeningWindows.has(windowId));

    if (mode === 'commands' && windowId !== undefined && switcherTracked) {
      await clearTabSwitcher(windowId);
      await chrome.tabs.sendMessage(tab.id, { action: 'overlay:close', switching: true }).catch(() => undefined);
    }

    if (mode === 'tabs' && windowId !== undefined) {
      openingWindowId = windowId;
      const opening = tabSwitcherOpeningWindows.get(windowId);

      if (opening && Date.now() - opening.startedAt < TAB_SWITCHER_OPENING_TIMEOUT_MS) {
        opening.pendingCycles++;
        return;
      }

      const launch = { tabId: tab.id, pendingCycles: 0, startedAt: Date.now() };
      openingLaunch = launch;
      tabSwitcherOpeningWindows.set(windowId, launch);

      const liveSurface = await getLiveTabSwitcherSurface(tab.id, windowId);

      if (tabSwitcherOpeningWindows.get(windowId) !== launch) {
        return;
      }

      if (liveSurface) {
        const pendingCycles = launch.pendingCycles;
        tabSwitcherOpeningWindows.delete(windowId);
        await cycleTabSwitcher(tab.id, windowId, liveSurface, pendingCycles + 1);
        return;
      }

      if (fromShortcut) {
        const closeResponse = (await chrome.tabs
          .sendMessage(tab.id, { action: 'overlay:close', switching: true })
          .catch(() => undefined)) as { wasOpen?: boolean } | undefined;

        if (tabSwitcherOpeningWindows.get(windowId) !== launch) {
          return;
        }

        // Command Mode already captured a clean frame before it became visible.
        // Avoid replacing it with a frame captured during the overlay's compositor close.
        if (!closeResponse?.wasOpen) {
          void captureTabPreview(tab.id, windowId, tab.url).catch(() => undefined);
        }
      }
    }

    if (mode === 'commands' && windowId !== undefined && isCapturablePage(tab.url)) {
      const overlayState = (await chrome.tabs
        .sendMessage(tab.id, { action: 'overlay:surface-status' })
        .catch(() => undefined)) as { open?: boolean } | undefined;

      if (!overlayState?.open) {
        // Cache only after an explicit launch; the capture stays off the UI startup path.
        void captureTabPreview(tab.id, windowId, tab.url).catch(() => undefined);
      }
    }

    if (isOverlayPage(tab.url)) {
      try {
        await openOverlay(tab.id, mode, fromShortcut && mode === 'tabs', openedAt);
        return;
      } catch {
        // Restricted or browser-managed pages use the extension popup.
      }
    }

    await openPopup(tab.id, mode, fromShortcut && mode === 'tabs', openedAt);
  } catch (error) {
    if (
      mode === 'tabs' &&
      openingWindowId !== undefined &&
      tabSwitcherOpeningWindows.get(openingWindowId) === openingLaunch
    ) {
      tabSwitcherOpeningWindows.delete(openingWindowId);
    }

    console.error('Could not open the command surface.', error);
  }
};

const isCapturablePage = (url?: string): boolean => {
  return Boolean(url && /^https?:\/\//i.test(url));
};

const removeTabPreview = async (tabId: number): Promise<void> => {
  await tabPreviewCache.remove(tabId);
};

const captureTabPreview = async (tabId: number, windowId: number, expectedUrl?: string): Promise<void> => {
  if (tabSwitcherOpenWindows.has(windowId)) {
    return;
  }

  const previewGeneration = tabPreviewCache.captureGeneration();
  const now = Date.now();

  if (now - (tabPreviewCaptureAt.get(windowId) ?? 0) < 650) {
    return;
  }

  tabPreviewCaptureAt.set(windowId, now);

  // Begin the capture while the user-invoked tab still has its activeTab grant.
  const capturePromise = chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 40 }).catch(() => null);

  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  const url = activeTab?.url;

  if (activeTab?.id !== tabId || !url || !isCapturablePage(url) || (expectedUrl && url !== expectedUrl)) {
    return;
  }

  const dataUrl = await capturePromise;

  if (!dataUrl) {
    return;
  }

  const [stillActive] = await chrome.tabs.query({ active: true, windowId });

  if (stillActive?.id !== tabId || stillActive.url !== url) {
    return;
  }

  await tabPreviewCache.save(
    tabId,
    { url, dataUrl, capturedAt: Date.now() } satisfies TabPreviewRecord,
    previewGeneration,
  );
};

const listRecentTabs = async (): Promise<Array<SplitAwareTab & { customName?: string; windowTitle?: string }>> => {
  const current = await getActiveTab();

  if (current?.windowId === undefined) {
    return [];
  }

  const tabs = await listTabs();
  return tabs
    .filter((tab) => tab.windowId === current.windowId)
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .slice(0, 5);
};

const getTabPreviews = async (tabIds: number[]): Promise<Record<number, string>> => {
  const ids = [...new Set(tabIds)].filter(Number.isFinite).slice(0, 5);

  if (!ids.length) {
    return {};
  }

  const keys = ids.map((id) => `${TAB_PREVIEW_PREFIX}${id}`);
  const records = await chrome.storage.session.get(keys);
  const previews: Record<number, string> = {};
  ids.forEach((id) => {
    const record = records[`${TAB_PREVIEW_PREFIX}${id}`] as TabPreviewRecord | undefined;

    if (record?.dataUrl && record.url) {
      previews[id] = record.dataUrl;
    }
  });

  return previews;
};

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    void openCommandCenter('commands', tab.id);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void configureActionForTab(tabId).catch(() => undefined);
  broadcastTabChanges();
});

chrome.tabs.onCreated.addListener(broadcastTabChanges);
chrome.tabs.onMoved.addListener(broadcastTabChanges);
chrome.tabs.onAttached.addListener(broadcastTabChanges);
chrome.tabs.onDetached.addListener(broadcastTabChanges);
chrome.tabs.onRemoved.addListener((tabId) => {
  broadcastTabChanges();
  void overlayTabRegistry.unregister(tabId).catch(() => undefined);
  void removeTabPreview(tabId).catch(() => undefined);

  for (const [windowId, opening] of tabSwitcherOpeningWindows) {
    if (opening.tabId === tabId) {
      tabSwitcherOpeningWindows.delete(windowId);
    }
  }
});

chrome.windows.onRemoved?.addListener((windowId) => {
  void clearTabSwitcher(windowId).catch(() => undefined);
  tabPreviewCaptureAt.delete(windowId);
});
chrome.tabs.onUpdated.addListener((_tabId, changes) => {
  if (
    changes.url !== undefined ||
    changes.title !== undefined ||
    changes.favIconUrl !== undefined ||
    changes.pinned !== undefined ||
    changes.groupId !== undefined ||
    changes.mutedInfo !== undefined ||
    changes.audible !== undefined
  ) {
    broadcastTabChanges();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url) {
    void removeTabPreview(tabId).catch(() => undefined);
  }
});

chrome.tabGroups?.onCreated?.addListener(broadcastTabChanges);
chrome.tabGroups?.onUpdated?.addListener(broadcastTabChanges);
chrome.tabGroups?.onRemoved?.addListener(broadcastTabChanges);
chrome.permissions.onAdded.addListener(broadcastPermissionChanges);
chrome.permissions.onRemoved.addListener(broadcastPermissionChanges);

chrome.runtime.onInstalled.addListener(() => {
  void configureActionForOpenTabs().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  void configureActionForOpenTabs().catch(() => undefined);
});
void configureActionForOpenTabs().catch(() => undefined);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-command-palette') {
    void openCommandCenter('commands', undefined, true, tab);
  }

  if (command === 'open-tab-switcher') {
    void openCommandCenter('tabs', undefined, true, tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleClosedTabName(tabId).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    void configureActionForTab(tabId, tab.url).catch(() => undefined);
  }

  void handleUpdatedTabName(tabId, changeInfo, tab).catch(() => undefined);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined) {
    void configureActionForTab(tab.id, tab.url).catch(() => undefined);
  }

  void handleCreatedTabName().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
  void handleRequest(rawMessage, sender)
    .then((data) => sendResponse(respond(data)))
    .catch((error: unknown) => sendResponse({ success: false, error: normalizeError(error) }));

  return true;
});

const handleRequest = async (
  rawMessage: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResult<BackgroundAction>> => {
  const message = validateRequest(rawMessage, sender, chrome.runtime.id);
  const action = message.action;

  if (
    action === 'tabs:list' ||
    action === 'tabs:recent' ||
    action === 'tabs:rename' ||
    action === 'tabs:duplicate-active'
  ) {
    await tabNameSessionInitialization;
  }

  switch (action) {
    case 'ui:tabs-changed':
    case 'ui:tabs-cycle':
      return typedBackgroundResult(action, true);
    case 'permissions:get-all':
      return typedBackgroundResult(action, chrome.permissions.getAll());

    case 'permissions:contains': {
      const permissions = (
        Array.isArray(message.permissions) ? message.permissions : []
      ) as chrome.permissions.Permissions['permissions'];

      const origins = Array.isArray(message.origins) ? (message.origins as string[]) : [];
      return typedBackgroundResult(
        action,
        chrome.permissions.contains({
          permissions,
          origins,
        }),
      );
    }

    case 'permissions:open-request': {
      const permissions = (
        Array.isArray(message.permissions) ? message.permissions : []
      ) as chrome.permissions.Permissions['permissions'];

      const allowed = new Set(['bookmarks', 'history', 'tabGroups', 'sessions', 'clipboardWrite']);
      const requested = [...new Set((permissions ?? []).filter((permission) => allowed.has(permission)))];

      if (!requested.length) {
        return typedBackgroundResult(action, false);
      }

      const url = chrome.runtime.getURL(
        `${popupPath}?mode=permission-request&permissions=${encodeURIComponent(requested.join(','))}`,
      );

      await chrome.windows.create({ url, type: 'popup', width: 420, height: 300, focused: true });
      return typedBackgroundResult(action, true);
    }

    case 'browser:split-capabilities': {
      const tabsApi = chrome.tabs as typeof chrome.tabs & { createSplit?: unknown; unsplit?: unknown };
      return typedBackgroundResult(action, {
        create: typeof tabsApi.createSplit === 'function',
        unsplit: typeof tabsApi.unsplit === 'function',
      });
    }

    case 'tabs:current':
      return typedBackgroundResult(action, getActiveTab());
    case 'tabs:list':
      return typedBackgroundResult(action, listTabs());
    case 'tabs:recent':
      return typedBackgroundResult(action, listRecentTabs());
    case 'tabs:recent-previews':
      return typedBackgroundResult(action, getTabPreviews(message.tabIds));

    case 'tabs:switcher-shown': {
      const windowId = message.windowId ?? asPositiveInteger(sender.tab?.windowId);

      if (windowId === undefined) {
        return typedBackgroundResult(action, { pendingCycles: 0 });
      }

      const surface = message.surface === 'popup' ? 'popup' : 'overlay';
      const pendingCycles = await rememberTabSwitcher(windowId, surface);
      return typedBackgroundResult(action, { pendingCycles });
    }

    case 'tabs:switcher-hidden': {
      const windowId = message.windowId ?? asPositiveInteger(sender.tab?.windowId);

      if (windowId !== undefined) {
        await clearTabSwitcher(windowId);
      }

      return typedBackgroundResult(action, true);
    }

    case 'popup:ready': {
      const windowId = message.windowId ?? asPositiveInteger(sender.tab?.windowId);

      if (windowId !== undefined && message.surface !== 'tabs') {
        await clearTabSwitcher(windowId);
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:activate': {
      const sourceTabId = message.sourceTabId ?? asPositiveInteger(sender.tab?.id);
      return typedBackgroundResult(action, activateTab(message.tabId, sourceTabId ?? undefined));
    }

    case 'tabs:rename':
      return typedBackgroundResult(action, renameTab(message.tabId, message.name));
    case 'tabs:close':
      await chrome.tabs.remove(message.tabId);
      return typedBackgroundResult(action, true);

    case 'tabs:close-confirmed': {
      const anchorTabId = message.anchorTabId;
      const ids = message.tabIds;
      const anchor = await chrome.tabs.get(anchorTabId).catch(() => null);

      if (!anchor || anchor.windowId !== message.windowId) {
        throw new Error('Tabs changed. Cancel and review the tabs before closing.');
      }

      const tabs = (await chrome.tabs.query({ windowId: anchor.windowId })).filter(
        (tab) => !tab.url?.startsWith(ownExtensionUrlPrefix),
      );

      const currentIds = bulkCloseTabIds(tabs, anchor, message.closeAction);

      if (currentIds.length !== ids.length || currentIds.some((id) => !ids.includes(id))) {
        throw new Error('Tabs changed. Cancel and review the tabs before closing.');
      }

      await chrome.tabs.remove(currentIds);
      return typedBackgroundResult(action, true);
    }

    case 'tabs:close-active': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.remove(tab.id);
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:close-others': {
      const tab = await getActiveTab();

      if (tab?.id) {
        const others = await chrome.tabs.query({ windowId: tab.windowId });
        const ids = others.filter((other) => other.id !== tab.id).flatMap((other) => (other.id ? [other.id] : []));

        if (ids.length) {
          await chrome.tabs.remove(ids);
        }
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:close-right': {
      const tab = await getActiveTab();

      if (tab?.id) {
        const tabs = await chrome.tabs.query({ windowId: tab.windowId });
        const ids = tabs.filter((other) => other.index > tab.index).flatMap((other) => (other.id ? [other.id] : []));

        if (ids.length) {
          await chrome.tabs.remove(ids);
        }
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:duplicate-active': {
      const tab = await getActiveTab();

      if (tab?.id) {
        const duplicate = await chrome.tabs.duplicate(tab.id);
        const originalName = await getTabCustomName(tab.id);

        if (duplicate?.id !== undefined && originalName) {
          await renameTab(duplicate.id, originalName);
        }
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:pin-active': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:pin':
      await chrome.tabs.update(message.tabId, { pinned: message.pinned });
      return typedBackgroundResult(action, true);

    case 'tabs:mute-active': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:mute':
      await chrome.tabs.update(message.tabId, { muted: message.muted });
      return typedBackgroundResult(action, true);

    case 'tabs:reload-active': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.reload(tab.id);
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:hard-reload-active': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.reload(tab.id, { bypassCache: true });
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:back': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.goBack(tab.id);
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:forward': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.goForward(tab.id);
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:copy-url': {
      const tab = message.tabId === undefined ? await getActiveTab() : await chrome.tabs.get(message.tabId);
      return typedBackgroundResult(action, tab?.url ?? '');
    }

    case 'tabs:copy-title': {
      const tab = message.tabId === undefined ? await getActiveTab() : await chrome.tabs.get(message.tabId);
      return typedBackgroundResult(action, tab?.title ?? '');
    }

    case 'tabs:zoom-in':
      return typedBackgroundResult(action, setActiveTabZoom(action));

    case 'tabs:zoom-out':
      return typedBackgroundResult(action, setActiveTabZoom(action));

    case 'tabs:zoom-reset':
      return typedBackgroundResult(action, setActiveTabZoom(action));

    case 'tabs:move-active-new-window': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.windows.create({ tabId: tab.id, focused: true });
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:move-new-window':
      await chrome.windows.create({ tabId: message.tabId, focused: true });
      return typedBackgroundResult(action, true);

    case 'tabs:move': {
      const tabId = message.tabId;
      const windowId = message.windowId;
      await chrome.tabs.move(tabId, { windowId, index: -1 });
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return typedBackgroundResult(action, true);
    }

    case 'tabs:group': {
      const tabId = message.tabId;
      const groupId = message.groupId;
      await chrome.tabs.group({ tabIds: [tabId], groupId });
      return typedBackgroundResult(action, true);
    }

    case 'tabs:split-active':
      return typedBackgroundResult(action, createSplitWithActive(message.tabId));

    case 'tabs:unsplit-active': {
      const tabsApi = chrome.tabs as typeof chrome.tabs & { unsplit?: (splitViewId: number) => Promise<void> };

      if (!tabsApi.unsplit) {
        throw new Error('Native split view requires a newer version of Chrome.');
      }

      const tab = await getActiveTab();

      if (isTabInSplitView(tab)) {
        await tabsApi.unsplit(tab.splitViewId);
      }

      return typedBackgroundResult(action, true);
    }

    case 'tabs:new':
      await chrome.tabs.create({ url: 'chrome://newtab/' });
      return typedBackgroundResult(action, true);
    case 'windows:list':
      return typedBackgroundResult(action, chrome.windows.getAll({ windowTypes: ['normal'], populate: true }));
    case 'windows:new':
      await chrome.windows.create({ focused: true });
      return typedBackgroundResult(action, true);
    case 'windows:new-incognito':
      await chrome.windows.create({ incognito: true, focused: true });
      return typedBackgroundResult(action, true);

    case 'windows:minimize-active': {
      const tab = await getActiveTab();

      if (tab) {
        await chrome.windows.update(tab.windowId, { state: 'minimized' });
      }

      return typedBackgroundResult(action, true);
    }

    case 'windows:maximize-active': {
      const tab = await getActiveTab();

      if (tab) {
        await chrome.windows.update(tab.windowId, { state: 'maximized' });
      }

      return typedBackgroundResult(action, true);
    }

    case 'browser:open-url':
      await openUrl(message.url, sender.tab?.id);
      return typedBackgroundResult(action, true);

    case 'browser:open-saved-url': {
      const safeUrl = normalizeSavedNavigationUrl(message.url);

      if (!safeUrl) {
        throw new Error('This saved page uses an unsupported address.');
      }

      await closeOverlayBeforeNavigation(sender.tab?.id);
      await chrome.tabs.create({ url: safeUrl });
      return typedBackgroundResult(action, true);
    }

    case 'browser:open-history':
      await openUrl('chrome://history/');
      return typedBackgroundResult(action, true);

    case 'browser:open-bookmarks':
      await openUrl('chrome://bookmarks/');
      return typedBackgroundResult(action, true);

    case 'browser:open-downloads':
      await openUrl('chrome://downloads/');
      return typedBackgroundResult(action, true);

    case 'browser:open-extensions':
      await openUrl('chrome://extensions/');
      return typedBackgroundResult(action, true);

    case 'browser:open-shortcuts':
      await openUrl('chrome://extensions/shortcuts');
      return typedBackgroundResult(action, true);

    case 'browser:open-chrome-settings':
      await openUrl('chrome://settings/');
      return typedBackgroundResult(action, true);

    case 'browser:open-web-store':
      await openUrl('https://chromewebstore.google.com/');
      return typedBackgroundResult(action, true);

    case 'bookmarks:list':
      return typedBackgroundResult(action, chrome.bookmarks.getTree());

    case 'history:list':
      return typedBackgroundResult(
        action,
        chrome.history.search({
          text: '',
          startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
          maxResults: 500,
        }),
      );

    case 'sessions:restore':
      return typedBackgroundResult(action, chrome.sessions.restore());

    case 'groups:list':
      return typedBackgroundResult(action, chrome.tabGroups.query({}));

    case 'groups:create-current': {
      const tab = await getActiveTab();

      if (!tab?.id) {
        return typedBackgroundResult(action, false);
      }

      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, {
        title: message.title.slice(0, 80),
        color: normalizeGroupColor(message.color),
      });

      return typedBackgroundResult(action, groupId);
    }

    case 'groups:create': {
      const tabId = message.tabId;
      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, {
        title: message.title.slice(0, 80),
        color: normalizeGroupColor(message.color),
      });

      return typedBackgroundResult(action, groupId);
    }

    case 'groups:update': {
      const updates: chrome.tabGroups.UpdateProperties = {};

      if (typeof message.title === 'string') {
        updates.title = message.title.slice(0, 80);
      }

      if (message.color) {
        updates.color = normalizeGroupColor(message.color);
      }

      if (typeof message.collapsed === 'boolean') {
        updates.collapsed = message.collapsed;
      }

      return typedBackgroundResult(action, chrome.tabGroups.update(message.groupId, updates));
    }

    case 'groups:ungroup-current': {
      const tab = await getActiveTab();

      if (tab?.id) {
        await chrome.tabs.ungroup(tab.id);
      }

      return typedBackgroundResult(action, true);
    }

    case 'groups:close-current': {
      const tab = await getActiveTab();

      if (tab && tab.groupId !== TAB_GROUP_ID_NONE) {
        const tabs = await chrome.tabs.query({ groupId: tab.groupId });
        const ids = tabs.flatMap((item) => (item.id ? [item.id] : []));

        if (ids.length) {
          await chrome.tabs.remove(ids);
        }
      }

      return typedBackgroundResult(action, true);
    }

    default:
      return assertNever(action);
  }
};

const getActiveTab = async (): Promise<SplitAwareTab | null> => {
  const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);

  if (focused?.id === undefined) {
    return null;
  }

  const [tab] = await chrome.tabs.query({ active: true, windowId: focused.id });
  return (tab as SplitAwareTab | undefined) ?? null;
};

const setActiveTabZoom = async (action: string): Promise<boolean> => {
  const tab = await getActiveTab();

  if (!tab?.id) {
    return true;
  }

  if (action === 'tabs:zoom-reset') {
    await chrome.tabs.setZoom(tab.id, 0);
    return true;
  }

  const current = await chrome.tabs.getZoom(tab.id);
  const delta = action === 'tabs:zoom-in' ? 0.1 : -0.1;
  const next = Math.min(5, Math.max(0.25, Math.round((current + delta) * 100) / 100));

  await chrome.tabs.setZoom(tab.id, next);
  return true;
};

const listTabs = async (): Promise<Array<SplitAwareTab & { customName?: string; windowTitle?: string }>> => {
  const [tabs, windows, names, focusedWindow] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getAll({ windowTypes: ['normal'] }),
    getTabNames(),
    chrome.windows.getLastFocused(),
  ]);

  const windowTitles = new Map(
    windows.flatMap((window, index) => {
      if (window.id === undefined) {
        return [];
      }

      const activeTitle = tabs.find((tab) => tab.windowId === window.id && tab.active)?.title;
      return [[window.id, activeTitle ? `Window · ${activeTitle}` : `Window ${index + 1}`] as const];
    }),
  );

  return tabs
    .filter(
      (tab) =>
        tab.id !== undefined &&
        tab.windowId !== chrome.windows.WINDOW_ID_NONE &&
        !tab.url?.startsWith(ownExtensionUrlPrefix),
    )
    .map((tab) => ({
      ...(tab as SplitAwareTab),
      customName: names[String(tab.id)]?.customName,
      windowTitle: windowTitles.get(tab.windowId) ?? 'Window',
    }))
    .sort(
      (a, b) =>
        Number(b.active && b.windowId === focusedWindow.id) - Number(a.active && a.windowId === focusedWindow.id) ||
        (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
    );
};

const activateTab = async (tabId: number, sourceTabId?: number): Promise<boolean> => {
  const tab = await chrome.tabs.get(tabId);

  if (sourceTabId !== undefined) {
    const source = await chrome.tabs.get(sourceTabId).catch(() => undefined);
    await chrome.tabs.sendMessage(sourceTabId, { action: 'overlay:close', switching: true }).catch(() => undefined);

    if (source?.windowId !== undefined) {
      void clearTabSwitcher(source.windowId).catch(() => undefined);
    }
  }

  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return true;
};

const closeOverlayBeforeNavigation = async (sourceTabId?: number): Promise<void> => {
  if (sourceTabId === undefined) {
    return;
  }

  await chrome.tabs.sendMessage(sourceTabId, { action: 'overlay:close', switching: true }).catch(() => undefined);
};

const openUrl = async (url: string, sourceTabId?: number): Promise<void> => {
  const safeUrl = normalizeNavigationUrl(url);

  if (!safeUrl) {
    throw new Error('Only web addresses and supported Chrome pages can be opened.');
  }

  await closeOverlayBeforeNavigation(sourceTabId);
  await chrome.tabs.create({ url: safeUrl });
};

const createSplitWithActive = async (otherTabId: number): Promise<boolean> => {
  const tabsApi = chrome.tabs as typeof chrome.tabs & {
    createSplit?: (tabIds: [number, number]) => Promise<number>;
  };

  if (!tabsApi.createSplit) {
    throw new Error('Native split view requires a newer version of Chrome.');
  }

  const active = await getActiveTab();
  const other = (await chrome.tabs.get(otherTabId)) as SplitAwareTab;
  const activeId = active?.id;
  const otherId = other.id;

  if (
    !active ||
    activeId === undefined ||
    otherId === undefined ||
    activeId === otherId ||
    active.windowId !== other.windowId
  ) {
    throw new Error('Choose a different tab in the same window to create split view.');
  }

  if (isTabInSplitView(active) || isTabInSplitView(other)) {
    throw new Error('A tab in another Split View cannot be paired again.');
  }

  if (
    active.pinned !== other.pinned ||
    active.groupId !== other.groupId ||
    Math.abs(active.index - other.index) !== 1
  ) {
    throw new Error('Split view needs adjacent tabs with the same pin and group state.');
  }

  await tabsApi.createSplit([activeId, otherId]);
  return true;
};

const normalizeGroupColor = (value: unknown): chrome.tabGroups.Color => {
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  return colors.includes(String(value)) ? (String(value) as chrome.tabGroups.Color) : chrome.tabGroups.Color.BLUE;
};
