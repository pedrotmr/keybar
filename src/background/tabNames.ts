import type { RenamedTab } from '@/types';
import { SerialTaskQueue } from '@/utils/serialTaskQueue';
import {
  markTabNameClosed,
  normalizeTabNames,
  reconcileTabNames,
  TAB_NAMES_STORAGE_KEY,
  type TabNameMap,
} from '@/utils/tabNamePersistence';
import { getHttpOrigin, isScriptableHttpUrl } from '@/utils/pageOrigin';
import {
  applyPageTitleOverride,
  normalizeCustomTabTitle,
  restorePageTitleOverride,
  type TitleOverrideReason,
} from '@/utils/pageTitleOverride';

const localKey = TAB_NAMES_STORAGE_KEY;
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

const notifyTabsChanged = (): void => {
  void chrome.runtime.sendMessage({ action: 'ui:tabs-changed' }).catch(() => undefined);
};

/**
 * Re-inject strip titles without occupying the name-mutation queue. Rename/list
 * must not wait on executeScript across every renamed tab.
 */
const scheduleStripTitleReapply = (names: TabNameMap): void => {
  const targets = Object.values(names).filter(
    (name) => name.showInTabStrip && name.tabStripOrigin && !isStaleKey(String(name.tabId)),
  );

  if (!targets.length) {
    return;
  }

  void (async () => {
    const originalTitleUpdates: Array<{ tabId: number; originalTitle: string }> = [];

    await Promise.all(
      targets.map(async (name) => {
        try {
          const tab = await chrome.tabs.get(name.tabId);
          const origin = getHttpOrigin(tab.url);

          if (origin !== name.tabStripOrigin) {
            return;
          }

          const applied = await applyPageTitleOverride(name.tabId, name.customName, name.tabStripOrigin!);

          if (applied.success && applied.originalTitle !== name.originalTitle) {
            originalTitleUpdates.push({ tabId: name.tabId, originalTitle: applied.originalTitle });
          }
        } catch {
          // Tab may be gone or injection unavailable.
        }
      }),
    );

    if (!originalTitleUpdates.length) {
      return;
    }

    await withNamesMutation(async (fresh) => {
      let changed = false;

      for (const update of originalTitleUpdates) {
        const entry = fresh[String(update.tabId)];

        if (entry && entry.originalTitle !== update.originalTitle) {
          entry.originalTitle = update.originalTitle;
          changed = true;
        }
      }

      return changed;
    }).catch(() => undefined);
  })().catch(() => undefined);
};

const applyStripTitleInBackground = (
  tabId: number,
  customName: string,
  origin: string,
  previous: RenamedTab | undefined,
): void => {
  void (async () => {
    const applied = await applyPageTitleOverride(tabId, customName, origin);

    if (!applied.success) {
      await withNamesMutation(async (names) => {
        const saved = names[String(tabId)];

        if (!saved || saved.customName !== customName) {
          return false;
        }

        const live = await chrome.tabs.get(tabId).catch(() => null);
        const liveOrigin = getHttpOrigin(live?.url);
        const previousStillActive =
          Boolean(previous?.showInTabStrip) &&
          Boolean(previous?.tabStripOrigin) &&
          previous?.tabStripOrigin === liveOrigin;

        if (previousStillActive && previous) {
          names[String(tabId)] = previous;
          return true;
        }

        const liveTitle = live?.title ?? '';
        names[String(tabId)] = {
          tabId,
          customName,
          originalTitle:
            previous?.customName && titlesMatch(liveTitle, previous.customName)
              ? previous.originalTitle
              : liveTitle || live?.url || saved.originalTitle,
          url: live?.url ?? saved.url,
          updatedAt: Date.now(),
        };
        return true;
      }).catch(() => undefined);
      notifyTabsChanged();
      return;
    }

    await withNamesMutation(async (names) => {
      const saved = names[String(tabId)];

      if (!saved || saved.customName !== customName) {
        return false;
      }

      saved.originalTitle = applied.originalTitle;
      saved.showInTabStrip = true;
      saved.tabStripOrigin = origin;
      return true;
    }).catch(() => undefined);

    notifyTabsChanged();
  })().catch(() => undefined);
};

const restoreStripTitleInBackground = (previous: RenamedTab): void => {
  if (!previous.showInTabStrip || !previous.tabStripOrigin) {
    return;
  }

  void restorePageTitleOverride(
    previous.tabId,
    previous.originalTitle,
    previous.customName,
    previous.tabStripOrigin,
  )
    .then((restored) => {
      if (
        restored.success ||
        restored.reason === 'title-not-overridden' ||
        restored.reason === 'origin-mismatch'
      ) {
        return;
      }

      // Reinstate so the user can retry when injection fails.
      void withNamesMutation(async (names) => {
        if (names[String(previous.tabId)]) {
          return false;
        }

        names[String(previous.tabId)] = previous;
        return true;
      }).catch(() => undefined);
    })
    .finally(() => {
      notifyTabsChanged();
    });
};

const reconcileRenamedTabs = async (): Promise<TabNameMap> => {
  const names = await operations.enqueue(async () => {
    const [tabs, stored] = await Promise.all([chrome.tabs.query({}), chrome.storage.local.get(localKey)]);
    return persistReconciledTabNames(tabs, normalizeTabNames(stored[localKey]));
  });
  scheduleStripTitleReapply(names);
  return names;
};

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
      scheduleStripTitleReapply(names);
    }

    return;
  }

  await operations.drain();

  let reconciledForReapply: TabNameMap | null = null;

  await operations.enqueue(async () => {
    if (Object.keys(names).length) {
      reconciledForReapply = await persistReconciledTabNames(await chrome.tabs.query({}), names, true);
    }
  });

  await chrome.storage.session.set({ [sessionKey]: true });

  if (reconciledForReapply) {
    scheduleStripTitleReapply(reconciledForReapply);
  }

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

  // Start strip injection immediately — in parallel with storage — so Chrome's tab
  // title does not wait on the name-mutation queue (Tab Renamer-style responsiveness).
  const tabSnapshot = await chrome.tabs.get(tabId).catch(() => null);
  const snapshotOrigin = getHttpOrigin(tabSnapshot?.url);
  const wantStrip =
    Boolean(customName) && Boolean(snapshotOrigin) && isScriptableHttpUrl(tabSnapshot?.url);
  const earlyStripApply =
    wantStrip && snapshotOrigin
      ? applyPageTitleOverride(tabId, customName, snapshotOrigin).catch(() => null)
      : null;

  const pending = {
    stripApply: null as { customName: string; origin: string; previous?: RenamedTab } | null,
    stripRestore: null as RenamedTab | null,
    stripClear: undefined as RenamedTab | undefined,
    earlyStripStarted: Boolean(earlyStripApply),
  };

  const result = await withNamesMutation(async (names) => {
    // Re-read inside the queue so a navigation while waiting does not keep a stale URL.
    const tab = await chrome.tabs.get(tabId);
    const origin = getHttpOrigin(tab.url);
    const canStrip = Boolean(customName) && Boolean(origin) && isScriptableHttpUrl(tab.url);
    const previous = names[String(tabId)];

    if (!customName) {
      if (!previous) {
        return { record: null, stripStatus: 'unchanged' as const };
      }

      delete names[String(tabId)];

      if (previous.showInTabStrip && previous.tabStripOrigin) {
        pending.stripRestore = previous;
      }

      return { record: null, stripStatus: 'restored' as const };
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

    if (!canStrip) {
      pending.stripClear = previous;
      names[String(tabId)] = saved;
      return { record: saved, stripStatus: 'unavailable' as const, stripReason: 'unsupported-page' as const };
    }

    saved.showInTabStrip = true;
    saved.tabStripOrigin = origin!;
    names[String(tabId)] = saved;

    if (!pending.earlyStripStarted || origin !== snapshotOrigin) {
      pending.stripApply = { customName, origin: origin!, previous };
    }

    return { record: saved, stripStatus: 'applied' as const };
  });

  if (pending.stripClear) {
    void restoreStripOverride(tabId, pending.stripClear).catch(() => undefined);
  }

  if (pending.stripRestore) {
    restoreStripTitleInBackground(pending.stripRestore);
  }

  if (earlyStripApply) {
    void earlyStripApply.then(async (applied) => {
      if (!applied?.success) {
        applyStripTitleInBackground(tabId, customName, snapshotOrigin!, undefined);
        return;
      }

      await withNamesMutation(async (names) => {
        const saved = names[String(tabId)];

        if (!saved || saved.customName !== customName) {
          return false;
        }

        if (saved.originalTitle !== applied.originalTitle) {
          saved.originalTitle = applied.originalTitle;
          return true;
        }

        return false;
      }).catch(() => undefined);
    });
  }

  if (pending.stripApply) {
    applyStripTitleInBackground(
      tabId,
      pending.stripApply.customName,
      pending.stripApply.origin,
      pending.stripApply.previous,
    );
  }

  return result;
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

  // Reattach off the list path so Command Bar open is not blocked on reconciliation.
  if (Object.keys(names).some(isStaleKey)) {
    void reconcileRenamedTabs().catch(() => undefined);
  }

  return names;
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

    if (saved.showInTabStrip && saved.tabStripOrigin) {
      const origin = getHttpOrigin(live.url);

      if (origin === saved.tabStripOrigin) {
        // Reload/navigation clears in-page overrides; also catch late title writes.
        shouldReapply =
          changeInfo.status === 'complete' ||
          (typeof changeInfo.title === 'string' && !titlesMatch(changeInfo.title, saved.customName));
      }
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
      applyStripTitleInBackground(tabId, saved.customName, saved.tabStripOrigin, saved);
    }
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
