import type { RenamedTab } from '@/types';
import { SerialTaskQueue } from '@/utils/serialTaskQueue';
import { markTabNameClosed, normalizeTabNames, reconcileTabNames, type TabNameMap } from '@/utils/tabNamePersistence';
import { getHttpOrigin, isScriptableHttpUrl } from '@/utils/pageOrigin';
import {
  applyPageTitleOverride,
  restorePageTitleOverride,
  type TitleOverrideReason,
} from '@/utils/pageTitleOverride';

const localKey = 'renamedTabs';
const sessionKey = 'tabNameIdsCurrentSession';
const operations = new SerialTaskQueue();

let namedTabIds = new Set<string>();
let reattachmentPending = false;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let sessionSafe = true;

export type RenameTabResult = {
  record: RenamedTab | null;
  stripStatus?: 'applied' | 'restored' | 'unavailable' | 'denied' | 'unchanged';
  stripReason?: TitleOverrideReason;
};

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
    const names = await persistReconciledTabNames(tabs, normalizeTabNames(stored[localKey]));
    return names;
  }).then(async (names) => {
    await reapplyTabStripTitles(names);
    return names;
  });

const scheduleReconciliation = (): void => {
  if (!reattachmentPending || reconcileTimer) {
    return;
  }

  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    void reconcileRenamedTabs().catch(() => undefined);
  }, 250);
};

const reapplyTabStripTitles = async (names: TabNameMap): Promise<void> => {
  await Promise.all(
    Object.entries(names).map(async ([key, name]) => {
      if (isStaleKey(key) || !name.showInTabStrip || !name.tabStripOrigin) {
        return;
      }

      try {
        const tab = await chrome.tabs.get(name.tabId);
        const origin = getHttpOrigin(tab.url);

        if (origin !== name.tabStripOrigin) {
          return;
        }

        await applyPageTitleOverride(name.tabId, name.customName, name.tabStripOrigin);
      } catch {
        // Tab may be gone or injection unavailable.
      }
    }),
  );
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
    if (reattachmentPending) {
      scheduleReconciliation();
    } else {
      void reapplyTabStripTitles(names).catch(() => undefined);
    }

    return;
  }

  await operations.drain();

  if (Object.keys(names).length) {
    const reconciled = await persistReconciledTabNames(await chrome.tabs.query({}), names, true);
    await reapplyTabStripTitles(reconciled);
  }

  await chrome.storage.session.set({ [sessionKey]: true });

  if (reattachmentPending) {
    scheduleReconciliation();
  }
};

export const tabNameSessionInitialization = initializeSession().catch(() => {
  sessionSafe = false;
});

const withNamesMutation = <T>(mutate: (names: TabNameMap) => Promise<T> | T): Promise<T> =>
  operations.enqueue(async () => {
    const stored = await chrome.storage.local.get(localKey);
    const names = normalizeTabNames(stored[localKey]);
    const result = await mutate(names);

    if (result === false) {
      return result;
    }

    await chrome.storage.local.set({ [localKey]: names });
    namedTabIds = getNamedTabIds(names);
    return result;
  });

const restoreStripOverride = async (tabId: number, previous?: RenamedTab): Promise<void> => {
  if (!previous?.showInTabStrip || !previous.tabStripOrigin) {
    return;
  }

  await restorePageTitleOverride(
    tabId,
    previous.originalTitle,
    previous.customName,
    previous.tabStripOrigin,
  ).catch(() => undefined);
};

export const renameTab = async (tabId: number, name: string): Promise<RenameTabResult> => {
  const tab = await chrome.tabs.get(tabId);
  const customName = name.trim().slice(0, 120);
  const origin = getHttpOrigin(tab.url);
  const wantStrip = Boolean(customName) && Boolean(origin) && isScriptableHttpUrl(tab.url);

  return withNamesMutation(async (names) => {
    const previous = names[String(tabId)];

    if (!customName) {
      await restoreStripOverride(tabId, previous);
      delete names[String(tabId)];
      return { record: null, stripStatus: previous?.showInTabStrip ? 'restored' : 'unchanged' };
    }

    const pageTitle =
      previous?.showInTabStrip && tab.title === previous.customName
        ? previous.originalTitle
        : (tab.title ?? tab.url ?? 'Untitled tab');

    const saved: RenamedTab = {
      tabId,
      customName,
      originalTitle: pageTitle,
      url: tab.url ?? '',
      updatedAt: Date.now(),
    };

    if (!wantStrip) {
      await restoreStripOverride(tabId, previous);
      names[String(tabId)] = saved;
      return { record: saved, stripStatus: 'unavailable', stripReason: 'unsupported-page' };
    }

    const applied = await applyPageTitleOverride(tabId, customName, origin!);

    if (!applied.success) {
      // Keep the Keybar-only name; strip flag stays off until injection succeeds.
      names[String(tabId)] = saved;
      return {
        record: saved,
        stripStatus: applied.reason === 'site-access-required' ? 'denied' : 'unavailable',
        stripReason: applied.reason,
      };
    }

    saved.originalTitle = previous?.showInTabStrip ? pageTitle : applied.originalTitle;
    saved.showInTabStrip = true;
    saved.tabStripOrigin = origin!;
    names[String(tabId)] = saved;
    return { record: saved, stripStatus: 'applied' };
  });
};

export const getTabNames = async (): Promise<TabNameMap> => {
  const stored = await chrome.storage.local.get(localKey);
  const names = sessionSafe ? normalizeTabNames(stored[localKey]) : {};
  return Object.keys(names).some(isStaleKey) ? reconcileRenamedTabs() : names;
};

export const handleClosedTabName = async (tabId: number): Promise<void> => {
  await tabNameSessionInitialization;
  const updated = await withNamesMutation(async (names) => {
    if (!names[String(tabId)]) {
      return false;
    }

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

  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== 'complete') {
    return;
  }

  await tabNameSessionInitialization;

  if (!namedTabIds.has(String(tabId))) {
    return;
  }

  let shouldReapply = false;

  const updated = await withNamesMutation((names) => {
    const saved = names[String(tabId)];

    if (!saved) {
      return false;
    }

    if (typeof tab.url === 'string') {
      saved.url = tab.url;
    }

    if (typeof tab.title === 'string') {
      if (!(saved.showInTabStrip && tab.title === saved.customName)) {
        saved.originalTitle = tab.title;
      }
    }

    saved.closedAt = undefined;
    saved.updatedAt = Date.now();

    if (saved.showInTabStrip && saved.tabStripOrigin && changeInfo.status === 'complete') {
      const origin = getHttpOrigin(tab.url);
      shouldReapply = origin === saved.tabStripOrigin;
    }

    return true;
  });

  if (updated) {
    scheduleReconciliation();
  }

  if (shouldReapply) {
    const stored = await chrome.storage.local.get(localKey);
    const saved = normalizeTabNames(stored[localKey])[String(tabId)];

    if (saved?.showInTabStrip && saved.tabStripOrigin) {
      await applyPageTitleOverride(tabId, saved.customName, saved.tabStripOrigin).catch(() => undefined);
    }
  }
};

export const handleCreatedTabName = async (): Promise<void> => {
  await tabNameSessionInitialization;
  scheduleReconciliation();
};

export const getBfcacheTitleDecision = async (
  tabId: number,
): Promise<{ customName?: string; restore?: boolean }> => {
  const stored = await chrome.storage.local.get(localKey);
  const saved = normalizeTabNames(stored[localKey])[String(tabId)];
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const origin = getHttpOrigin(tab?.url);

  if (saved?.showInTabStrip && saved.tabStripOrigin && origin === saved.tabStripOrigin) {
    return { customName: saved.customName };
  }

  return { restore: true };
};
