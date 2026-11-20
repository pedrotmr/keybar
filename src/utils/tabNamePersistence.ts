import type { RenamedTab } from '@/types';
import { getHttpOrigin } from '@/utils/pageOrigin';

export const TAB_NAMES_STORAGE_KEY = 'renamedTabs';

export type TabNameMap = Record<string, RenamedTab>;
export type TabIdentitySnapshot = Pick<chrome.tabs.Tab, 'id' | 'url' | 'title'>;

export const normalizeTabNames = (value: unknown): TabNameMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) => {
      if (!/^(?:[0-9]+|stale:.+)$/.test(key) || !entry || typeof entry !== 'object') {
        return false;
      }

      const name = entry as Partial<RenamedTab>;
      const validStrip =
        (name.showInTabStrip === undefined || typeof name.showInTabStrip === 'boolean') &&
        (name.tabStripOrigin === undefined || typeof name.tabStripOrigin === 'string');

      return (
        typeof name.tabId === 'number' &&
        Number.isSafeInteger(name.tabId) &&
        name.tabId > 0 &&
        typeof name.customName === 'string' &&
        typeof name.url === 'string' &&
        typeof name.originalTitle === 'string' &&
        typeof name.updatedAt === 'number' &&
        Number.isFinite(name.updatedAt) &&
        validStrip &&
        (name.closedAt === undefined || (typeof name.closedAt === 'number' && Number.isFinite(name.closedAt))) &&
        (name.excludedTabIdsAtClose === undefined ||
          (Array.isArray(name.excludedTabIdsAtClose) &&
            name.excludedTabIdsAtClose.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)))
      );
    }),
  );
};

const normalizeComparableTitle = (value: string): string => value.replace(/[\t\n\f\r ]+/g, ' ').trim();

const pageTitleForStorage = (tabTitle: string | undefined, tabUrl: string | undefined, name: RenamedTab): string => {
  if (typeof tabTitle !== 'string') {
    return name.originalTitle;
  }

  // When Keybar owns document.title on the strip origin, Chrome reports the custom name as tab.title.
  if (
    name.showInTabStrip &&
    name.tabStripOrigin &&
    getHttpOrigin(tabUrl) === name.tabStripOrigin &&
    normalizeComparableTitle(tabTitle) === normalizeComparableTitle(name.customName)
  ) {
    return name.originalTitle;
  }

  return tabTitle;
};

const DEFAULT_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

export const markTabNameClosed = (
  savedNames: TabNameMap,
  tabId: number,
  closedAt = Date.now(),
  currentTabs: TabIdentitySnapshot[] = [],
): boolean => {
  const id = String(tabId);
  const savedName = savedNames[id];

  if (!savedName) {
    return false;
  }

  delete savedNames[id];
  const keyBase = `stale:${savedName.tabId}:${savedName.updatedAt}:${closedAt}`;
  let staleKey = keyBase;
  let suffix = 1;

  while (savedNames[staleKey]) {
    staleKey = `${keyBase}:${suffix++}`;
  }

  const excludedTabIdsAtClose = currentTabs.flatMap((tab) =>
    tab.id !== undefined && tab.url === savedName.url ? [tab.id] : [],
  );

  savedNames[staleKey] = { ...savedName, closedAt, excludedTabIdsAtClose };
  return true;
};

const withoutCloseExclusions = (name: RenamedTab): RenamedTab => {
  const copy = { ...name };
  delete copy.excludedTabIdsAtClose;
  return copy;
};

const isStaleTabNameKey = (key: string): boolean => {
  return key.startsWith('stale:');
};

const identity = (url: string | undefined, title: string | undefined): string | null => {
  if (!url) {
    return null;
  }

  return `${url}\u0000${title ?? ''}`;
};

/** Reattach names only through unique URL/title matches when tab IDs belong to another browser session. */
export const reconcileTabNames = (
  savedNames: TabNameMap,
  currentTabs: TabIdentitySnapshot[],
  now = Date.now(),
  maxAge = DEFAULT_MAX_AGE,
  forceIdentityMatching = false,
): TabNameMap => {
  const copiedNames: TabNameMap = Object.fromEntries(
    Object.entries(normalizeTabNames(savedNames)).map(([id, name]) => [id, { ...name }]),
  );

  for (const [id, name] of Object.entries(copiedNames)) {
    if (name.closedAt !== undefined && now - name.closedAt > maxAge) {
      delete copiedNames[id];
    }
  }

  const names = forceIdentityMatching
    ? Object.fromEntries(
        Object.values(copiedNames).map((name, index) => [
          `stale:${name.tabId}:${name.updatedAt}:${index}`,
          { ...withoutCloseExclusions(name), closedAt: name.closedAt ?? now },
        ]),
      )
    : copiedNames;

  const activeIds = new Set(currentTabs.flatMap((tab) => (tab.id === undefined ? [] : [String(tab.id)])));

  if (!forceIdentityMatching) {
    for (const [id, name] of Object.entries(names)) {
      if (!activeIds.has(id)) {
        continue;
      }

      const tab = currentTabs.find((candidate) => String(candidate.id) === id);

      if (!tab) {
        continue;
      }

      name.url = tab.url ?? name.url;
      name.originalTitle = pageTitleForStorage(tab.title, tab.url, name);
      name.closedAt = undefined;
      delete name.excludedTabIdsAtClose;
    }
  }

  // Chrome may restore either the real page title or the custom strip title. Match
  // both representations, require a unique pair in both directions, then mutate.
  const reattachable = Object.entries(names).flatMap(([id, name]) => {
    if (activeIds.has(id) || !name.url) {
      return [];
    }

    if (!forceIdentityMatching && !isStaleTabNameKey(id) && name.closedAt === undefined) {
      return [];
    }

    return [{ id, name }];
  });

  const unnamedTabs = currentTabs.filter((tab) => tab.id !== undefined && !names[String(tab.id)]);

  const nameMatchesTab = (name: RenamedTab, tab: TabIdentitySnapshot): boolean => {
    if (!tab.url || tab.url !== name.url) {
      return false;
    }

    const tabTitle = normalizeComparableTitle(tab.title ?? '');

    if (tabTitle === normalizeComparableTitle(name.originalTitle)) {
      return true;
    }

    // Custom strip titles only count on the origin where Keybar applied them.
    return Boolean(
      name.showInTabStrip &&
      name.tabStripOrigin &&
      getHttpOrigin(tab.url) === name.tabStripOrigin &&
      tabTitle === normalizeComparableTitle(name.customName),
    );
  };

  const nameToTabIds = new Map<string, number[]>();
  const tabToNameIds = new Map<number, string[]>();

  for (const { id, name } of reattachable) {
    const excludedIds = new Set(name.excludedTabIdsAtClose ?? []);

    for (const tab of unnamedTabs) {
      if (tab.id === undefined || excludedIds.has(tab.id) || !nameMatchesTab(name, tab)) {
        continue;
      }

      const tabs = nameToTabIds.get(id) ?? [];
      tabs.push(tab.id);
      nameToTabIds.set(id, tabs);

      const nameIds = tabToNameIds.get(tab.id) ?? [];
      nameIds.push(id);
      tabToNameIds.set(tab.id, nameIds);
    }
  }

  for (const [oldId, tabIds] of nameToTabIds) {
    if (tabIds.length !== 1) {
      continue;
    }

    const tabId = tabIds[0];
    const matchingNameIds = tabToNameIds.get(tabId) ?? [];

    if (matchingNameIds.length !== 1 || matchingNameIds[0] !== oldId) {
      continue;
    }

    const previous = names[oldId];
    names[String(tabId)] = { ...withoutCloseExclusions(previous), tabId, closedAt: undefined };
    delete names[oldId];
  }

  // A page can change its document title while restoring. Fall back to URL only
  // when the URL identifies exactly one saved name and one unnamed tab.
  const oldByUrl = new Map<string, string[]>();

  for (const [id, name] of Object.entries(names)) {
    if (activeIds.has(id) || !name.url) {
      continue;
    }

    if (!forceIdentityMatching && !isStaleTabNameKey(id) && name.closedAt === undefined) {
      continue;
    }

    const matches = oldByUrl.get(name.url) ?? [];
    matches.push(id);
    oldByUrl.set(name.url, matches);
  }

  const currentByUrl = new Map<string, TabIdentitySnapshot[]>();

  for (const tab of currentTabs) {
    if (tab.id === undefined || names[String(tab.id)] || !tab.url) {
      continue;
    }

    const matches = currentByUrl.get(tab.url) ?? [];
    matches.push(tab);
    currentByUrl.set(tab.url, matches);
  }

  for (const [url, oldIds] of oldByUrl) {
    if (oldIds.length !== 1) {
      continue;
    }

    const oldId = oldIds[0];
    const excludedIds = new Set(names[oldId].excludedTabIdsAtClose ?? []);
    const matchingTabs = (currentByUrl.get(url) ?? []).filter(
      (tab) => tab.id !== undefined && !excludedIds.has(tab.id),
    );

    if (matchingTabs.length !== 1 || matchingTabs[0].id === undefined) {
      continue;
    }

    const newId = String(matchingTabs[0].id);
    const previous = names[oldId];
    names[newId] = {
      ...withoutCloseExclusions(previous),
      tabId: matchingTabs[0].id,
      originalTitle: pageTitleForStorage(matchingTabs[0].title, matchingTabs[0].url, previous),
      closedAt: undefined,
    };
    delete names[oldId];
  }

  const currentIdentities = new Set(
    currentTabs.flatMap((tab) => {
      const key = identity(tab.url, tab.title);
      return key ? [key] : [];
    }),
  );

  for (const [id, name] of Object.entries(names)) {
    if (activeIds.has(id) || currentIdentities.has(identity(name.url, name.originalTitle) ?? '')) {
      continue;
    }

    const retentionAnchor = name.closedAt ?? name.updatedAt;

    if (now - retentionAnchor > maxAge) {
      delete names[id];
    }
  }

  return names;
};
