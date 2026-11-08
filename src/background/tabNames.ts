import type { RenamedTab } from '@/types';
import { SerialTaskQueue } from '@/utils/serialTaskQueue';
import { markTabNameClosed, normalizeTabNames, reconcileTabNames, type TabNameMap } from '@/utils/tabNamePersistence';

const localKey = 'renamedTabs';
const sessionKey = 'tabNameIdsCurrentSession';
const operations = new SerialTaskQueue();

let namedTabIds = new Set<string>();
let reattachmentPending = false;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let sessionSafe = true;

const isStaleKey = (key: string): boolean => key.startsWith('stale:');

const getNamedTabIds = (names: TabNameMap): Set<string> =>
  new Set(Object.keys(names).filter((key) => !isStaleKey(key)));

const persistReconciledTabNames = async (
  tabs: chrome.tabs.Tab[],
  savedNames: TabNameMap,
  forceIdentityMatching = false,
): Promise<TabNameMap> => {
  const names = reconcileTabNames(savedNames, tabs, Date.now(), undefined, forceIdentityMatching);
  await chrome.storage.local.set({ [localKey]: names });
  namedTabIds = getNamedTabIds(names);
  reattachmentPending = Object.keys(names).some(isStaleKey);
  return names;
};

const reconcileRenamedTabs = async (): Promise<TabNameMap> =>
  operations.enqueue(async () => {
    const [tabs, stored] = await Promise.all([chrome.tabs.query({}), chrome.storage.local.get(localKey)]);
    return persistReconciledTabNames(tabs, normalizeTabNames(stored[localKey]));
  });

const scheduleReconciliation = (): void => {
  if (!reattachmentPending || reconcileTimer) return;

  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    void reconcileRenamedTabs().catch(() => undefined);
  }, 250);
};

const initializeSession = async (): Promise<void> => {
  const [session, stored] = await Promise.all([
    chrome.storage.session.get(sessionKey),
    chrome.storage.local.get(localKey),
  ]);

  const names = normalizeTabNames(stored[localKey]);
  namedTabIds = getNamedTabIds(names);
  reattachmentPending = Object.keys(names).some(isStaleKey);

  if (session[sessionKey]) {
    if (reattachmentPending) scheduleReconciliation();
    return;
  }

  await operations.drain();
  if (Object.keys(names).length) await persistReconciledTabNames(await chrome.tabs.query({}), names, true);
  await chrome.storage.session.set({ [sessionKey]: true });
  if (reattachmentPending) scheduleReconciliation();
};

export const tabNameSessionInitialization = initializeSession().catch(() => {
  sessionSafe = false;
});

const withNamesMutation = <T>(mutate: (names: TabNameMap) => Promise<T> | T): Promise<T> =>
  operations.enqueue(async () => {
    const stored = await chrome.storage.local.get(localKey);
    const names = normalizeTabNames(stored[localKey]);
    const result = await mutate(names);
    if (result === false) return result;

    await chrome.storage.local.set({ [localKey]: names });
    namedTabIds = getNamedTabIds(names);
    return result;
  });

export const renameTab = async (tabId: number, name: string): Promise<RenamedTab | null> => {
  const tab = await chrome.tabs.get(tabId);
  const customName = name.trim().slice(0, 120);

  return withNamesMutation((names) => {
    if (!customName) {
      delete names[String(tabId)];
      return null;
    }

    const saved: RenamedTab = {
      tabId,
      customName,
      originalTitle: tab.title ?? tab.url ?? 'Untitled tab',
      url: tab.url ?? '',
      updatedAt: Date.now(),
    };
    names[String(tabId)] = saved;
    return saved;
  });
};

export const getTabCustomName = async (tabId: number): Promise<string | undefined> => {
  const stored = await chrome.storage.local.get(localKey);
  return normalizeTabNames(stored[localKey])[String(tabId)]?.customName;
};

export const getTabNames = async (): Promise<TabNameMap> => {
  const stored = await chrome.storage.local.get(localKey);
  const names = sessionSafe ? normalizeTabNames(stored[localKey]) : {};
  return Object.keys(names).some(isStaleKey) ? reconcileRenamedTabs() : names;
};

export const handleClosedTabName = async (tabId: number): Promise<void> => {
  await tabNameSessionInitialization;
  const updated = await withNamesMutation(async (names) => {
    if (!names[String(tabId)]) return false;
    const currentTabs = await chrome.tabs.query({});
    return markTabNameClosed(names, tabId, Date.now(), currentTabs);
  });

  if (updated) {
    reattachmentPending = true;
    scheduleReconciliation();
  }
};

export const handleUpdatedTabName = async (
  tabId: number,
  changeInfo: { status?: string; url?: string; title?: string },
  tab: chrome.tabs.Tab,
): Promise<void> => {
  if (reattachmentPending && (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title)) {
    scheduleReconciliation();
  }
  if (!changeInfo.url && !changeInfo.title) return;

  await tabNameSessionInitialization;
  if (!namedTabIds.has(String(tabId))) return;

  const updated = await withNamesMutation((names) => {
    const saved = names[String(tabId)];
    if (!saved) return false;
    if (typeof tab.url === 'string') saved.url = tab.url;
    if (typeof tab.title === 'string') saved.originalTitle = tab.title;
    saved.closedAt = undefined;
    saved.updatedAt = Date.now();
    return true;
  });
  if (updated) scheduleReconciliation();
};

export const handleCreatedTabName = async (): Promise<void> => {
  await tabNameSessionInitialization;
  scheduleReconciliation();
};
