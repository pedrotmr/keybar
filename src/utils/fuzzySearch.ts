import type { PaletteItem, UrlItem } from '@/types';
import { normalizeNavigationUrl } from '@/utils/chromeHelpers';
import { createProviderSearchItem, parseProviderQuery, searchProviders } from '@/utils/searchProviders';
import type { SearchProviderDefinition } from '@/utils/searchProviders';

interface SearchField {
  value: string;
  weight: number;
}

interface RankedItem {
  item: PaletteItem;
  score: number;
  order: number;
}

const searchFieldCache = new WeakMap<object, SearchField[]>();

const scoreText = (text: string, term: string): number => {
  const value = text;

  if (!value) {
    return 0;
  }

  if (value === term) {
    return 140;
  }

  if (value.startsWith(term)) {
    return 110 - Math.min(value.length - term.length, 20);
  }

  const position = value.indexOf(term);

  if (position >= 0) {
    return 82 - Math.min(position, 30);
  }

  if (term.length < 3) {
    return 0;
  }

  const maxGaps = Math.max(1, Math.floor(term.length / 2));
  let best = 0;

  for (let start = value.indexOf(term[0]); start >= 0; start = value.indexOf(term[0], start + 1)) {
    let cursor = 1;
    let gaps = 0;
    let previous = start;
    let wordBoundaryMatches = /[\s/_.-]/.test(value[start - 1] ?? ' ') ? 1 : 0;
    let crossedBoundary = false;
    let matchesAfterLastBoundary = 1;

    for (let index = start + 1; index < value.length && cursor < term.length; index++) {
      if (index - start > term.length + maxGaps - 1) {
        break;
      }

      if (value[index] !== term[cursor]) {
        continue;
      }

      gaps += index - previous - 1;

      if (gaps > maxGaps) {
        break;
      }

      if (/[^a-z0-9]/.test(value.slice(previous + 1, index))) {
        crossedBoundary = true;
        matchesAfterLastBoundary = 1;
      } else if (crossedBoundary) {
        matchesAfterLastBoundary++;
      }

      if (/[\s/_.-]/.test(value[index - 1])) {
        wordBoundaryMatches++;
      }

      previous = index;
      cursor++;
    }

    if (cursor !== term.length || (crossedBoundary && matchesAfterLastBoundary < 2)) {
      continue;
    }

    const score = 56 - gaps * 4 - Math.min(start, 20) + wordBoundaryMatches * 4;

    if (score > best) {
      best = score;
    }
  }

  // Keep typo tolerance local and strong enough that it cannot capture unrelated actions.
  return best >= 28 ? best : 0;
};

const getSearchFields = (item: PaletteItem): SearchField[] => {
  const cached = searchFieldCache.get(item);

  if (cached) {
    return cached;
  }

  const title = item.title.trim().toLowerCase();
  const fields: SearchField[] = [{ value: title, weight: 1 }];
  const seen = new Set([title]);

  const addField = (value: string | undefined, weight: number) => {
    const normalized = value?.trim();

    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    fields.push({ value: key, weight });
  };

  addField(item.subtitle, 0.76);

  if ('description' in item) {
    addField(item.description, 0.7);
  }

  if ('url' in item) {
    addField(item.url, 0.64);
  }

  for (const keyword of item.keywords ?? []) {
    addField(keyword, 0.6);
  }

  searchFieldCache.set(item, fields);
  return fields;
};

const scoreItem = (item: PaletteItem, terms: string[]): number => {
  const fields = getSearchFields(item);
  let total = 0;
  let allTermsInTitle = true;

  for (const term of terms) {
    let best = 0;
    let titleScore = 0;

    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      const score = scoreText(field.value, term) * field.weight;

      if (index === 0) {
        titleScore = score;
      }

      if (score > best) {
        best = score;
      }
    }

    if (!best) {
      return 0;
    }

    total += best;

    if (!titleScore) {
      allTermsInTitle = false;
    }
  }

  return total / Math.max(1, terms.length) + (allTermsInTitle ? 8 : 0);
};

export const rankItems = (items: PaletteItem[], query: string, limit = 100): PaletteItem[] => {
  const normalized = query.trim();

  if (!normalized) {
    return items.slice(0, limit);
  }

  const terms = normalized.toLowerCase().split(/\s+/).filter(Boolean);
  const ranked: RankedItem[] = [];

  items.forEach((item, order) => {
    const score = scoreItem(item, terms);

    if (score > 0) {
      ranked.push({ item, score, order });
    }
  });

  ranked.sort((left, right) => {
    const relevance = right.score - left.score;

    if (relevance) {
      return relevance;
    }

    if (left.item.type === 'history' && right.item.type === 'history') {
      const recency = (right.item.lastVisitTime ?? 0) - (left.item.lastVisitTime ?? 0);

      if (recency) {
        return recency;
      }
    }

    return left.order - right.order;
  });

  return ranked.slice(0, limit).map(({ item }) => item);
};

const createNavigationItem = (url: string): UrlItem => {
  return {
    id: 'navigate-url',
    title: `Open ${url}`,
    subtitle: 'Navigate to this address',
    icon: '↗',
    type: 'url',
    url,
  };
};

export const searchItems = (
  items: PaletteItem[],
  query: string,
  tabsOnly = false,
  allowFallback = true,
): PaletteItem[] => {
  const normalized = query.trim();

  if (!normalized) {
    return rankItems(items, '', 40);
  }

  const providerQuery = tabsOnly ? null : parseProviderQuery(normalized);

  if (!tabsOnly) {
    const isChromePage = normalized.toLowerCase().startsWith('chrome://');
    const navigationUrl = isChromePage ? normalizeNavigationUrl(normalized) : null;

    if (navigationUrl) {
      return [createNavigationItem(navigationUrl)];
    }
  }

  const filteredItems =
    tabsOnly && items.some((item) => item.type !== 'tab') ? items.filter((item) => item.type === 'tab') : items;

  const localQuery = providerQuery?.query ?? normalized;

  if (providerQuery) {
    const matches = rankItems(filteredItems, localQuery, 99);
    const providerItem = createProviderSearchItem(providerQuery.provider, providerQuery.query);
    return [providerItem, ...matches];
  }

  if (tabsOnly) {
    return rankItems(filteredItems, localQuery, 100);
  }

  const navigationUrl = normalizeNavigationUrl(normalized);

  if (navigationUrl) {
    const matches = rankItems(filteredItems, localQuery, allowFallback ? 99 : 100);
    return [createNavigationItem(navigationUrl), ...matches].slice(0, 100);
  }

  if (!allowFallback) {
    return rankItems(filteredItems, localQuery, 100);
  }

  const fallbackProvider = searchProviders[0];
  const searchItem: PaletteItem = {
    id: 'search-google',
    title: `Search Google for “${normalized}”`,
    subtitle: fallbackProvider.hint,
    icon: '↗',
    type: 'search',
    keywords: ['Google', normalized],
    url: fallbackProvider.urlTemplate.replace('%s', encodeURIComponent(normalized)),
  };

  // Rank non-history first so a history flood cannot consume the cap and hide
  // tabs/bookmarks/commands beneath the Google fallback.
  const nonHistory = rankItems(
    filteredItems.filter((item) => item.type !== 'history'),
    localQuery,
    99,
  );
  const history = rankItems(
    filteredItems.filter((item) => item.type === 'history'),
    localQuery,
    99 - nonHistory.length,
  );
  return [...nonHistory, searchItem, ...history];
};

export const searchProviderItems = (
  items: PaletteItem[],
  query: string,
  provider: SearchProviderDefinition,
  allowFallback = true,
): PaletteItem[] => {
  const normalized = query.trim();

  if (!normalized) {
    return [];
  }

  const providerItem = createProviderSearchItem(provider, normalized);
  const navigationUrl = normalizeNavigationUrl(normalized);

  if (!navigationUrl) {
    return [providerItem];
  }

  const results = searchItems(items, normalized, false, allowFallback);
  const navigationIndex = results.findIndex((item) => item.type === 'url' && item.url === navigationUrl);

  if (navigationIndex < 0) {
    return [providerItem, ...results];
  }

  const navigationItem = results[navigationIndex];
  return [navigationItem, providerItem, ...results.filter((_, index) => index !== navigationIndex)];
};
