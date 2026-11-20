import type { RenamedTab } from '@/types';
import { SerialTaskQueue } from '@/utils/serialTaskQueue';
import { markTabNameClosed, normalizeTabNames, reconcileTabNames, type TabNameMap } from '@/utils/tabNamePersistence';
import { getHttpOrigin, isScriptableHttpUrl } from '@/utils/pageOrigin';
import {
  applyPageTitleOverride,
  normalizeCustomTabTitle,
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

const titlesMatch = (left: string, right: string): boolean =>
  normalizeCustomTabTitle(left) === normalizeCustomTabTitle(right);

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

const reapplyTabStripTitles = async (names: TabNameMap): Promise<boolean> => {
  let mutated = false;

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

        const applied = await applyPageTitleOverride(name.tabId, name.customName, name.tabStripOrigin);

        if (applied.success && applied.originalTitle !== name.originalTitle) {
          name.originalTitle = applied.originalTitle;
          mutated = true;
        }
      } catch {
        // Tab may be gone or injection unavailable.
      }
    }),
  );

  return mutated;
};

const reconcileRenamedTabs = async (): Promise<TabNameMap> =>
  operations.enqueue(async () => {
    const [tabs, stored] = await Promise.all([chrome.tabs.query({}), chrome.storage.local.get(localKey)]);
    const names = await persistReconciledTabNames(tabs, normalizeTabNames(stored[localKey]));
    if (await reapplyTabStripTitles(names)) {
      await chrome.storage.local.set({ [localKey]: names });
    }
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
      await operations.enqueue(async () => {
        if (await reapplyTabStripTitles(names)) {
          await chrome.storage.local.set({ [localKey]: names });
        }
      });
    }

    return;
  }

  await operations.drain();

  await operations.enqueue(async () => {
    if (Object.keys(names).length) {
      const reconciled = await persistReconciledTabNames(await chrome.tabs.query({}), names, true);
      if (await reapplyTabStripTitles(reconciled)) {
        await chrome.storage.local.set({ [localKey]: reconciled });
      }
    }
  });

  await chrome.storage.session.set({ [sessionKey]: true });

  if (reattachmentPending) {
    scheduleReconciliation();
  }
};

export const tabNameSessionInitialization = initializeSession().catch(() => {
  sessionSafe = false;
});

type DeferRollback = (fn: () => Promise<void>) => void;

const withNamesMutation = <T>(
  mutate: (names: TabNameMap, deferRollback: DeferRollback) => Promise<T> | T,
): Promise<T> =>
  operations.enqueue(async () => {
    const stored = await chrome.storage.local.get(localKey);
    const names = normalizeTabNames(stored[localKey]);
    const rollbacks: Array<() => Promise<void>> = [];
    const result = await mutate(names, (fn) => {
      rollbacks.push(fn);
    });

    if (result === false) {
      return result;
    }

    try {
      await chrome.storage.local.set({ [localKey]: names });
    } catch (error) {
      for (const fn of [...rollbacks].reverse()) {
        await fn().catch(() => undefined);
      }
      throw error;
    }

    namedTabIds = getNamedTabIds(names);
    return result;
  });

const restoreStripOverride = async (tabId: number, previous?: RenamedTab): Promise<void> => {
  if (!previous?.showInTabStrip || !previous.tabStripOrigin) {
    return;
  }

  await restorePageTitleOverride(tabId, previous.originalTitle, previous.customName, previous.tabStripOrigin).catch(
    () => undefined,
  );
};

export const renameTab = async (tabId: number, name: string): Promise<RenameTabResult> => {
  const customName = normalizeCustomTabTitle(name).slice(0, 120);

  return withNamesMutation(async (names, deferRollback) => {
    // Read the live tab inside the queue so a navigation while waiting does not
    // keep a stale URL/origin for Keybar-only fallback or strip retention.
    const tab = await chrome.tabs.get(tabId);
    const origin = getHttpOrigin(tab.url);
    const wantStrip = Boolean(customName) && Boolean(origin) && isScriptableHttpUrl(tab.url);
    const previous = names[String(tabId)];

    if (!customName) {
      if (!previous?.showInTabStrip || !previous.tabStripOrigin) {
        delete names[String(tabId)];
        return { record: null, stripStatus: 'unchanged' };
      }

      const restored = await restorePageTitleOverride(
        tabId,
        previous.originalTitle,
        previous.customName,
        previous.tabStripOrigin,
      );

      if (!restored.success) {
        // Page already shows the real title, or the tab left the strip origin.
        if (restored.reason === 'title-not-overridden' || restored.reason === 'origin-mismatch') {
          delete names[String(tabId)];
          return { record: null, stripStatus: 'restored' };
        }

        // Keep the record so the user can retry when injection fails.
        return {
          record: previous,
          stripStatus: restored.reason === 'site-access-required' ? 'denied' : 'unavailable',
          stripReason: restored.reason,
        };
      }

      delete names[String(tabId)];
      deferRollback(async () => {
        await applyPageTitleOverride(tabId, previous.customName, previous.tabStripOrigin!).catch(() => undefined);
      });
      return { record: null, stripStatus: 'restored' };
    }

    const pageTitle =
      previous?.showInTabStrip &&
      previous.tabStripOrigin === origin &&
      titlesMatch(tab.title ?? '', previous.customName)
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
      // Injection may see a newer origin than the snapshot above — re-read.
      const live = await chrome.tabs.get(tabId).catch(() => null);
      const liveOrigin = getHttpOrigin(live?.url);

      // If navigation returned to the strip origin during injection, the previous
      // override may still be active — keep that record instead of Keybar-only.
      const previousStillActive =
        Boolean(previous?.showInTabStrip) &&
        Boolean(previous?.tabStripOrigin) &&
        previous?.tabStripOrigin === liveOrigin;

      if (previousStillActive && previous) {
        return {
          record: previous,
          stripStatus: applied.reason === 'site-access-required' ? 'denied' : 'unavailable',
          stripReason: applied.reason,
        };
      }

      const liveTitle = live?.title ?? '';
      const keybarOnly: RenamedTab = {
        tabId,
        customName,
        // Avoid storing a still-visible custom strip title as the page's original title.
        originalTitle:
          previous?.customName && titlesMatch(liveTitle, previous.customName)
            ? previous.originalTitle
            : liveTitle || live?.url || pageTitle,
        url: live?.url ?? '',
        updatedAt: Date.now(),
      };

      names[String(tabId)] = keybarOnly;
      return {
        record: keybarOnly,
        stripStatus: applied.reason === 'site-access-required' ? 'denied' : 'unavailable',
        stripReason: applied.reason,
      };
    }

    saved.originalTitle = applied.originalTitle;
    saved.showInTabStrip = true;
    saved.tabStripOrigin = origin!;
    names[String(tabId)] = saved;
    deferRollback(async () => {
      if (previous?.showInTabStrip && previous.tabStripOrigin === origin) {
        await applyPageTitleOverride(tabId, previous.customName, previous.tabStripOrigin).catch(() => undefined);
        return;
      }

      await restorePageTitleOverride(tabId, applied.originalTitle, customName, origin!).catch(() => undefined);
    });
    return { record: saved, stripStatus: 'applied' };
  });
};

const inheritTabNameInto = async (
  names: TabNameMap,
  deferRollback: DeferRollback,
  tabId: number,
  source: RenamedTab,
): Promise<void> => {
  const tab = await chrome.tabs.get(tabId);
  const customName = normalizeCustomTabTitle(source.customName).slice(0, 120);

  if (!customName) {
    return;
  }

  const origin = getHttpOrigin(tab.url);
  const saved: RenamedTab = {
    tabId,
    customName,
    originalTitle: tab.title ?? tab.url ?? 'Untitled tab',
    url: tab.url ?? '',
    updatedAt: Date.now(),
  };

  // Drop any reattached record reconciliation may have written for this new tab id.
  delete names[String(tabId)];

  const canStrip =
    Boolean(source.showInTabStrip) &&
    Boolean(source.tabStripOrigin) &&
    origin === source.tabStripOrigin &&
    isScriptableHttpUrl(tab.url);

  if (!canStrip) {
    names[String(tabId)] = saved;
    return;
  }

  const applied = await applyPageTitleOverride(tabId, customName, origin!);

  if (!applied.success) {
    names[String(tabId)] = saved;
    return;
  }

  saved.originalTitle = applied.originalTitle;
  saved.showInTabStrip = true;
  saved.tabStripOrigin = origin!;
  names[String(tabId)] = saved;
  deferRollback(async () => {
    await restorePageTitleOverride(tabId, applied.originalTitle, customName, origin!).catch(() => undefined);
  });
};

/** Duplicate a tab and inherit its name without racing reconciliation. */
export const duplicateTabWithName = async (sourceTabId: number): Promise<void> => {
  await withNamesMutation(async (names, deferRollback) => {
    const source = names[String(sourceTabId)];
    const duplicate = await chrome.tabs.duplicate(sourceTabId);

    if (duplicate?.id === undefined || !source?.customName) {
      return true;
    }

    await inheritTabNameInto(names, deferRollback, duplicate.id, source);
    return true;
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
): Promise<void> => {
  if (reattachmentPending && (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title)) {
    scheduleReconciliation();
  }

  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== 'complete') {
    return;
  }

  await tabNameSessionInitialization;
  // Wait for an in-flight rename's storage write so namedTabIds includes this tab
  // before a same-origin navigation complete is treated as unnamed.
  await operations.drain();

  if (!namedTabIds.has(String(tabId))) {
    return;
  }

  let shouldReapply = false;

  const updated = await withNamesMutation(async (names) => {
    const saved = names[String(tabId)];

    if (!saved) {
      return false;
    }

    // Prefer the live tab over the event snapshot so a rolled-back or superseded
    // title change cannot overwrite originalTitle with a rejected custom name.
    const live = await chrome.tabs.get(tabId).catch(() => null);

    if (!live) {
      return false;
    }

    if (typeof live.url === 'string') {
      saved.url = live.url;
    }

    if (typeof live.title === 'string') {
      const origin = getHttpOrigin(live.url);
      const stripOwnsTitle =
        saved.showInTabStrip &&
        saved.tabStripOrigin &&
        origin === saved.tabStripOrigin &&
        titlesMatch(live.title, saved.customName);

      if (!stripOwnsTitle) {
        saved.originalTitle = live.title;
      }
    }

    saved.closedAt = undefined;
    saved.updatedAt = Date.now();

    if (saved.showInTabStrip && saved.tabStripOrigin && changeInfo.status === 'complete') {
      shouldReapply = getHttpOrigin(live.url) === saved.tabStripOrigin;
    }

    return true;
  });

  if (updated) {
    scheduleReconciliation();
  }

  if (shouldReapply) {
    await operations.enqueue(async () => {
      const stored = await chrome.storage.local.get(localKey);
      const names = normalizeTabNames(stored[localKey]);
      const saved = names[String(tabId)];

      if (!saved?.showInTabStrip || !saved.tabStripOrigin) {
        return;
      }

      const applied = await applyPageTitleOverride(tabId, saved.customName, saved.tabStripOrigin).catch(() => null);

      if (applied?.success && applied.originalTitle !== saved.originalTitle) {
        saved.originalTitle = applied.originalTitle;
        await chrome.storage.local.set({ [localKey]: names });
      }
    });
  }
};

export const handleCreatedTabName = async (): Promise<void> => {
  await tabNameSessionInitialization;
  scheduleReconciliation();
};

export const getBfcacheTitleDecision = async (tabId: number): Promise<{ customName?: string; restore?: boolean }> => {
  const stored = await chrome.storage.local.get(localKey);
  const saved = normalizeTabNames(stored[localKey])[String(tabId)];
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const origin = getHttpOrigin(tab?.url);

  if (saved?.showInTabStrip && saved.tabStripOrigin && origin === saved.tabStripOrigin) {
    return { customName: normalizeCustomTabTitle(saved.customName) };
  }

  return { restore: true };
};
