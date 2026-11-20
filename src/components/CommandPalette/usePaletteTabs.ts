import { useCallback, useEffect, useRef, useState } from 'react';
import { sendBackground } from '@/utils/chromeHelpers';
import { isPaletteTabsSnapshot, PALETTE_TABS_SNAPSHOT_KEY } from '@/utils/paletteTabsSnapshot';
import { normalizeTabNames, TAB_NAMES_STORAGE_KEY } from '@/utils/tabNamePersistence';
import { recordTiming } from './helpers';
import type { CommandCenterRuntimeMessage, ToastMessage } from './types';
import type { ManagedTab } from '@/utils/tabItems';

interface UsePaletteTabsOptions {
  surface: 'popup' | 'overlay';
  notify: (message: string, tone?: ToastMessage['tone']) => void;
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

export const usePaletteTabs = ({ surface, notify }: UsePaletteTabsOptions) => {
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
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const paintOptimistic = useCallback((nextTabs: ManagedTab[], currentTabIdValue: number | null, windowId: number | null) => {
    if (hasLiveTabs.current || !nextTabs.length) {
      return;
    }

    setTabs(nextTabs);
    setCurrentTabId(currentTabIdValue);
    setCurrentWindowId(windowId);
  }, []);

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

    // Caps + groups run alongside tabs:list when already known; otherwise caps resolve in parallel
    // and groups start as soon as permission is confirmed.
    const capsPromise = ensureCaps(requestVersion);
    const groupsKnown = groupsAllowed.current === true;
    const groupsPromise = groupsKnown
      ? sendBackground('groups:list').catch(() => [] as chrome.tabGroups.TabGroup[])
      : null;

    let nextTabs: ManagedTab[];

    try {
      // tabs:list is sorted with the focused active tab first — no separate tabs:current round-trip.
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
    setTabs(nextTabs);
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
    setTabs(withGroupLabels(nextTabs, nextGroups));
  }, [ensureCaps]);

  const patchTab = useCallback((tabId: number, patch: Partial<ManagedTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  useEffect(() => {
    performance.clearMarks('cc:ui-mounted');
    performance.mark('cc:ui-mounted');

    const loadPermissions = async () => {
      try {
        const granted =
          surface === 'popup' ? await chrome.permissions.getAll() : await sendBackground('permissions:get-all');

        const next = new Set(granted.permissions ?? []);
        setPermissions(next);
        // Seed the groups cache so the next refresh can fetch groups in parallel with tabs.
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

    // Popup can query tabs directly — no service-worker round trip — so pinned tabs and
    // rename targets paint on the first frame while the full background list catches up.
    const hydrateFromLocalTabs = async () => {
      if (surface !== 'popup' || typeof chrome.tabs?.query !== 'function') {
        return;
      }

      const [queried, focusedWindow, storedNames] = await Promise.all([
        chrome.tabs.query({}),
        chrome.windows.getLastFocused().catch(() => null),
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
  }, [paintOptimistic, refreshTabs, surface]);

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
  };
};
