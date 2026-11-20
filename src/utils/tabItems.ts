import type { CommandItem, PaletteItem, SplitAwareTab, TabItem } from '@/types';
import { TAB_GROUP_ID_NONE } from '@/utils/chromeApiConstants';

export interface ManagedTab extends SplitAwareTab {
  customName?: string;
  /** Page title stored by Keybar; preferred over Chrome's tab.title when a strip override is active. */
  originalTitle?: string;
  previewDataUrl?: string;
  windowTitle?: string;
  groupTitle?: string;
  groupColor?: string;
}

const orderPinnedTabs = (tabs: TabItem[], currentWindowId?: number): TabItem[] => {
  const windowOrder = new Map<number, number>();

  for (const tab of tabs) {
    if (!windowOrder.has(tab.windowId)) {
      windowOrder.set(tab.windowId, windowOrder.size);
    }
  }

  return tabs
    .filter((tab) => tab.pinned)
    .sort((left, right) => {
      const leftWindowOrder =
        left.windowId === currentWindowId ? -1 : (windowOrder.get(left.windowId) ?? Number.MAX_SAFE_INTEGER);

      const rightWindowOrder =
        right.windowId === currentWindowId ? -1 : (windowOrder.get(right.windowId) ?? Number.MAX_SAFE_INTEGER);

      if (leftWindowOrder !== rightWindowOrder) {
        return leftWindowOrder - rightWindowOrder;
      }

      return left.index - right.index;
    });
};

const preservePinnedTabOrder = (tabs: TabItem[], currentWindowId?: number): TabItem[] => {
  const orderedPinned = orderPinnedTabs(tabs, currentWindowId);
  let pinnedIndex = 0;

  return tabs.map((tab) => (tab.pinned ? orderedPinned[pinnedIndex++] : tab));
};

export const toTabItems = (
  tabs: ManagedTab[],
  currentTabId: number | null,
  currentWindowIdOverride?: number | null,
): TabItem[] => {
  const currentWindowId = currentWindowIdOverride ?? tabs.find((tab) => tab.id === currentTabId)?.windowId;

  const items = tabs.flatMap((tab) => {
    if (tab.id === undefined) {
      return [];
    }

    const originalTitle = tab.originalTitle || tab.title || tab.url || 'Untitled tab';
    const title = tab.customName || originalTitle;
    const details = [tab.customName ? originalTitle : '', tab.url || ''].filter(Boolean).join(' · ');
    const groupTitle =
      tab.groupTitle?.trim() ||
      (tab.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE ? 'Tab group' : undefined);

    const windowTitle = currentWindowId !== undefined && tab.windowId !== currentWindowId ? tab.windowTitle : undefined;
    return [
      {
        id: `tab-${tab.id}`,
        title,
        subtitle: details,
        icon: '◉',
        type: 'tab' as const,
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        url: tab.url || '',
        originalTitle,
        favIconUrl: tab.favIconUrl,
        active: tab.active,
        current: tab.id === currentTabId,
        pinned: tab.pinned,
        muted: tab.mutedInfo?.muted ?? false,
        audible: tab.audible ?? false,
        lastAccessed: tab.lastAccessed,
        groupId: tab.groupId,
        groupTitle,
        groupColor: tab.groupColor,
        splitViewId: tab.splitViewId,
        windowTitle,
        keywords: [windowTitle ?? '', groupTitle ?? '', 'tab', tab.pinned ? 'pinned' : ''].filter(Boolean),
      },
    ];
  });

  return preservePinnedTabOrder(items, currentWindowId);
};

export const initialCommandItems = (commands: CommandItem[], tabs: TabItem[]): PaletteItem[] => {
  const currentWindowId = tabs.find((tab) => tab.current)?.windowId;
  const pinnedTabs = orderPinnedTabs(tabs, currentWindowId);
  const openTabs = tabs.filter((tab) => !tab.pinned);
  return [...pinnedTabs, ...openTabs, ...commands];
};
