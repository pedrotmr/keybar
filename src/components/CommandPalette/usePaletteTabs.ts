import { useCallback, useEffect, useRef, useState } from 'react';
import { sendBackground } from '@/utils/chromeHelpers';
import {
  isPaletteTabsSnapshot,
  PALETTE_TABS_SNAPSHOT_KEY,
  type PaletteTabsSnapshot,
} from '@/utils/paletteTabsSnapshot';
import { normalizeTabNames, TAB_NAMES_STORAGE_KEY } from '@/utils/tabNamePersistence';
import { recordTiming } from './helpers';
import type { CommandCenterRuntimeMessage, ToastMessage } from './types';
import type { ManagedTab } from '@/utils/tabItems';

interface UsePaletteTabsOptions {
  surface: 'popup' | 'overlay';
  notify: (message: string, tone?: ToastMessage['tone']) => void;
  initialTabsSnapshot?: PaletteTabsSnapshot | null;
}

type SplitCapabilities = { create: boolean; unsplit: boolean };

const toOptimisticManagedTabs = (
  tabs: chrome.tabs.Tab[],
  names: ReturnType<typeof normalizeTabNames>,
): ManagedTab[] => {
  const ownExtensionUrlPrefix = chrome.runtime.getURL('');

  return tabs
    .filter(
      (tab) =>
        tab.id !== undefined &&
        tab.windowId !== chrome.windows.WINDOW_ID_NONE &&
        !tab.url?.startsWith(ownExtensionUrlPrefix),
    )
    .map((tab) => {
      const saved = names[String(tab.id)];
      return {
        ...(tab as ManagedTab),
        customName: saved?.customName,
        originalTitle: saved?.originalTitle,
      };
    });
};

const withGroupLabels = (tabs: ManagedTab[], groups: chrome.tabGroups.TabGroup[]): ManagedTab[] => {
  if (!groups.length) {
    return tabs;
  }

  const groupById = new Map(groups.map((group) => [group.id, group]));
  return tabs.map((tab) => {
    const group = groupById.get(tab.groupId);
    return group ? { ...tab, groupTitle: group.title, groupColor: group.color } : tab;
  });
};

export const usePaletteTabs = ({ surface, notify, initialTabsSnapshot = null }: UsePaletteTabsOptions) => {
  const [tabs, setTabs] = useState<ManagedTab[]>([]);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);

  const [permissions, setPermissions] = useState<Set<string>>(() => new Set());
  const [groups, setGroups] = useState<chrome.tabGroups.TabGroup[]>([]);
  const [splitCapabilities, setSplitCapabilities] = useState<SplitCapabilities>({ create: false, unsplit: false });

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefreshVersion = useRef(0);
  const hasLiveTabs = useRef(false);
  const groupsAllowed = useRef<boolean | null>(null);
  const splitSupport = useRef<SplitCapabilities | null>(null);
  const pendingPatches = useRef(new Map<number, Partial<ManagedTab>>());
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const mergePending = useCallback((nextTabs: ManagedTab[]): ManagedTab[] => {
    if (!pendingPatches.current.size) {
      return nextTabs;
    }

    return nextTabs.map((tab) => {
      if (tab.id === undefined) {
        return tab;
      }

      const patch = pendingPatches.current.get(tab.id);
      return patch ? { ...tab, ...patch } : tab;
    });
  }, []);

  const paintOptimistic = useCallback((nextTabs: ManagedTab[], currentTabIdValue: number | null, windowId: number | null) => {
    if (hasLiveTabs.current || !nextTabs.length) {
      return;
    }

    setTabs(mergePending(nextTabs));
    setCurrentTabId(currentTabIdValue);
    setCurrentWindowId(windowId);
  }, [mergePending]);

  const ensureCaps = useCallback(async (requestVersion: number): Promise<boolean> => {
    if (groupsAllowed.current !== null && splitSupport.current !== null) {
      setSplitCapabilities(splitSupport.current);
      return groupsAllowed.current;
    }

    const [allowed, support] = await Promise.all([
      sendBackground('permissions:contains', { permissions: ['tabGroups'] }).catch(() => false),
      sendBackground('browser:split-capabilities').catch(() => ({ create: false, unsplit: false })),
    ]);

    if (requestVersion !== tabRefreshVersion.current) {
      return false;
    }

    groupsAllowed.current = allowed;
    splitSupport.current = support;
    setSplitCapabilities(support);
    return allowed;
  }, []);

  const refreshTabs = useCallback(async () => {
    const requestVersion = ++tabRefreshVersion.current;
    const started = performance.now();

    const capsPromise = ensureCaps(requestVersion);
    const groupsKnown = groupsAllowed.current === true;
    const groupsPromise = groupsKnown
      ? sendBackground('groups:list').catch(() => [] as chrome.tabGroups.TabGroup[])
      : null;

    let nextTabs: ManagedTab[];

    try {
      // tabs:list is sorted with the focused normal-window active tab first.
      nextTabs = await sendBackground('tabs:list');
    } catch (error: unknown) {
      if (requestVersion === tabRefreshVersion.current) {
        throw error;
      }

      return;
    }

    if (requestVersion !== tabRefreshVersion.current) {
      return;
    }

    const current = nextTabs.find((tab) => tab.active) ?? null;
    setTabs(mergePending(nextTabs));
    setCurrentTabId(current?.id ?? null);
    setCurrentWindowId(current?.windowId ?? null);
    hasLiveTabs.current = true;
    recordTiming('tab-list', performance.now() - started);

    const allowed = await capsPromise;

    if (requestVersion !== tabRefreshVersion.current) {
      return;
    }

    if (!allowed) {
      setGroups([]);
      return;
    }

    const nextGroups = await (groupsPromise ?? sendBackground('groups:list').catch(() => []));

    if (requestVersion !== tabRefreshVersion.current) {
      return;
    }

    setGroups(nextGroups);
    // Merge into current state so an optimistic pin/mute/rename is not replayed away.
    setTabs((current) => withGroupLabels(current.length ? current : mergePending(nextTabs), nextGroups));
  }, [ensureCaps, mergePending]);

  const patchTab = useCallback((tabId: number, patch: Partial<ManagedTab>) => {
    pendingPatches.current.set(tabId, { ...pendingPatches.current.get(tabId), ...patch });
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const settleTabPatch = useCallback((tabId: number, patch?: Partial<ManagedTab>) => {
    pendingPatches.current.delete(tabId);

    if (patch) {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
    }
  }, []);

  useEffect(() => {
    performance.clearMarks('cc:ui-mounted');
    performance.mark('cc:ui-mounted');

    if (isPaletteTabsSnapshot(initialTabsSnapshot) && initialTabsSnapshot.tabs.length) {
      paintOptimistic(
        initialTabsSnapshot.tabs,
        initialTabsSnapshot.currentTabId,
        initialTabsSnapshot.currentWindowId,
      );
    }

    const loadPermissions = async () => {
      try {
        const granted =
          surface === 'popup' ? await chrome.permissions.getAll() : await sendBackground('permissions:get-all');

        const next = new Set(granted.permissions ?? []);
        setPermissions(next);
        if (groupsAllowed.current === null) {
          groupsAllowed.current = next.has('tabGroups');
        }
      } catch {
        setPermissions(new Set());
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }

      refreshTimer.current = setTimeout(() => {
        void refreshTabs().catch(() => notifyRef.current('Could not update open tabs.'));
      }, 32);
    };

    const hydrateFromSessionCache = async () => {
      // Content-script overlays cannot read chrome.storage.session; they get a snapshot
      // through overlay:open instead.
      if (surface === 'overlay') {
        return;
      }

      const stored = await chrome.storage.session.get(PALETTE_TABS_SNAPSHOT_KEY);
      if (hasLiveTabs.current) {
        return;
      }

      const cached = stored[PALETTE_TABS_SNAPSHOT_KEY];
      if (!isPaletteTabsSnapshot(cached) || !cached.tabs.length) {
        return;
      }

      paintOptimistic(cached.tabs, cached.currentTabId, cached.currentWindowId);
    };

    const hydrateFromLocalTabs = async () => {
      if (surface !== 'popup' || typeof chrome.tabs?.query !== 'function') {
        return;
      }

      const [queried, focusedWindow, storedNames] = await Promise.all([
        chrome.tabs.query({}),
        chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null),
        chrome.storage.local.get(TAB_NAMES_STORAGE_KEY),
      ]);

      if (hasLiveTabs.current) {
        return;
      }

      const names = normalizeTabNames(storedNames[TAB_NAMES_STORAGE_KEY]);
      const optimistic = toOptimisticManagedTabs(queried, names);
      const focusedWindowId = focusedWindow?.id;
      const active =
        (typeof focusedWindowId === 'number'
          ? queried.find((tab) => tab.active && tab.windowId === focusedWindowId)
          : undefined) ?? queried.find((tab) => tab.active);
      paintOptimistic(optimistic, active?.id ?? null, active?.windowId ?? null);
    };

    void hydrateFromLocalTabs().catch(() => undefined);
    void hydrateFromSessionCache().catch(() => undefined);
    void refreshTabs().catch(() => {
      notifyRef.current('Could not load open tabs.');
    });
    void loadPermissions();

    const handleRuntimeMessage = (message: CommandCenterRuntimeMessage) => {
      if (message.action === 'ui:tabs-changed') {
        scheduleRefresh();
      }

      if (message.action === 'ui:permissions-changed') {
        groupsAllowed.current = null;
        void loadPermissions();
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    return () => {
      tabRefreshVersion.current++;

      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }

      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [initialTabsSnapshot, mergePending, paintOptimistic, refreshTabs, surface]);

  return {
    tabs,
    currentTabId,
    currentWindowId,
    permissions,
    setPermissions,
    groups,
    setGroups,
    splitCapabilities,
    refreshTabs,
    patchTab,
    settleTabPatch,
  };
};
