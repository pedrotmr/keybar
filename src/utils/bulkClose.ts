import { TAB_GROUP_ID_NONE } from './chromeApiConstants';

export type BulkCloseAction = 'tabs:close-others' | 'tabs:close-right' | 'groups:close-current';

export const isBulkCloseAction = (action: unknown): action is BulkCloseAction =>
  action === 'tabs:close-others' || action === 'tabs:close-right' || action === 'groups:close-current';

export const bulkCloseTabIds = (
  tabs: chrome.tabs.Tab[],
  anchor: chrome.tabs.Tab,
  action: BulkCloseAction,
): number[] => {
  return tabs
    .filter((tab) => {
      if (tab.windowId !== anchor.windowId) {
        return false;
      }

      switch (action) {
        case 'tabs:close-others':
          return tab.id !== anchor.id;
        case 'tabs:close-right':
          return tab.index > anchor.index;
        case 'groups:close-current':
          return anchor.groupId !== undefined && anchor.groupId !== TAB_GROUP_ID_NONE && tab.groupId === anchor.groupId;
      }
    })
    .flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
};
