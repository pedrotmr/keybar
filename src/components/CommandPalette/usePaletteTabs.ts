import { useCallback, useEffect, useRef, useState } from 'react';
import { sendBackground } from '@/utils/chromeHelpers';
import { recordTiming } from './helpers';
import type { CommandCenterRuntimeMessage, ToastMessage } from './types';
import type { ManagedTab } from '@/utils/tabItems';

interface UsePaletteTabsOptions {
  surface: 'popup' | 'overlay';
  notify: (message: string, tone?: ToastMessage['tone']) => void;
}

export const usePaletteTabs = ({ surface, notify }: UsePaletteTabsOptions) => {
  const [tabs, setTabs] = useState<ManagedTab[]>([]);
  const [tabsReady, setTabsReady] = useState(false);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);

  const [permissions, setPermissions] = useState<Set<string>>(() => new Set());
  const [groups, setGroups] = useState<chrome.tabGroups.TabGroup[]>([]);
  const [splitCapabilities, setSplitCapabilities] = useState({ create: false, unsplit: false });

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefreshVersion = useRef(0);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const refreshTabs = useCallback(async () => {
    const requestVersion = ++tabRefreshVersion.current;
    const started = performance.now();
    const snapshot = await Promise.all([
      sendBackground('tabs:list'),
      sendBackground('tabs:current'),
      sendBackground('permissions:contains', { permissions: ['tabGroups'] }).catch(() => false),
      sendBackground('browser:split-capabilities').catch(() => ({ create: false, unsplit: false })),
    ]).catch((error: unknown) => {
      if (requestVersion === tabRefreshVersion.current) {
        throw error;
      }

      return null;
    });

    if (!snapshot) {
      return;
    }

    const [nextTabs, currentTab, groupsAllowed, splitSupport] = snapshot;
    const nextGroups = groupsAllowed ? await sendBackground('groups:list').catch(() => []) : [];

    if (requestVersion !== tabRefreshVersion.current) {
      return;
    }

    const groupById = new Map(nextGroups.map((group) => [group.id, group]));
    setTabs(
      nextTabs.map((tab) => {
        const group = groupById.get(tab.groupId);
        return { ...tab, groupTitle: group?.title, groupColor: group?.color };
      }),
    );

    setCurrentTabId(currentTab?.id ?? null);
    setCurrentWindowId(currentTab?.windowId ?? null);
    setGroups(nextGroups);
    setSplitCapabilities(splitSupport);

    setTabsReady(true);
    recordTiming('tab-list', performance.now() - started);
  }, []);

  useEffect(() => {
    performance.clearMarks('cc:ui-mounted');
    performance.mark('cc:ui-mounted');

    const loadPermissions = async () => {
      try {
        const granted =
          surface === 'popup' ? await chrome.permissions.getAll() : await sendBackground('permissions:get-all');

        setPermissions(new Set(granted.permissions ?? []));
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

    void refreshTabs().catch(() => {
      setTabsReady(true);
      notifyRef.current('Could not load open tabs.');
    });
    void loadPermissions();

    const handleRuntimeMessage = (message: CommandCenterRuntimeMessage) => {
      if (message.action === 'ui:tabs-changed') {
        scheduleRefresh();
      }

      if (message.action === 'ui:permissions-changed') {
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
  }, [refreshTabs, surface]);

  return {
    tabs,
    tabsReady,
    currentTabId,
    currentWindowId,
    permissions,
    setPermissions,
    groups,
    setGroups,
    splitCapabilities,
    refreshTabs,
  };
};
