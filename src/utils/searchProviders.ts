import type { SearchItem } from '@/types';

export interface SearchProviderAccent {
  light: string;
  dark: string;
}

interface SearchProviderIdentity {
  id: string;
  name: string;
  prefix: string;
  aliases: string[];
}

interface SearchProviderDestination {
  urlTemplate: string;
}

interface SearchProviderPresentation {
  hint: string;
  verb: 'Search' | 'Ask';
  // Brand tints for the provider chip, mark tile and empty state; each pair is used only behind or around the mark.
  accent: SearchProviderAccent;
}

export interface SearchProviderDefinition
  extends SearchProviderIdentity, SearchProviderDestination, SearchProviderPresentation {}

export interface ParsedProviderQuery {
  provider: SearchProviderDefinition;
  query: string;
}

export interface ProviderQueryMatch {
  trigger: string;
  providers: SearchProviderDefinition[];
  provider: SearchProviderDefinition | null;
  query: string;
  // A partial compound name has no provider query yet, but ordinary search should still see the full input.
  preserveFullQueryFallback?: boolean;
}

// Providers open their public search/composer pages; this registry does not call private APIs or scrape results.
export const searchProviders: SearchProviderDefinition[] = [
  {
    id: 'google',
    name: 'Google',
    prefix: 'g',
    aliases: ['g', 'go', 'goo', 'google'],
    urlTemplate: 'https://www.google.com/search?q=%s',
    hint: 'Search the web',
    verb: 'Search',
    accent: { light: '#1a73e8', dark: '#8ab4f8' },
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    prefix: 'gm',
    aliases: ['gm', 'ma', 'maps'],
    urlTemplate: 'https://www.google.com/maps/search/?api=1&query=%s',
    hint: 'Search places and addresses',
    verb: 'Search',
    accent: { light: '#1a73e8', dark: '#8ab4f8' },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    prefix: 'yt',
    aliases: ['yt', 'yo', 'you', 'youtube'],
    urlTemplate: 'https://www.youtube.com/results?search_query=%s',
    hint: 'Search videos',
    verb: 'Search',
    accent: { light: '#e0001e', dark: '#ff5c6c' },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    prefix: 'ai',
    aliases: ['ai', 'cha', 'chat', 'chatgpt', 'gp', 'gpt'],
    urlTemplate: 'https://chatgpt.com/?q=%s',
    hint: 'Open ChatGPT with a question',
    verb: 'Ask',
    accent: { light: '#10a37f', dark: '#4fd1a8' },
  },
  {
    id: 'claude',
    name: 'Claude',
    prefix: 'cl',
    aliases: ['cl', 'claude'],
    urlTemplate: 'https://claude.ai/new?q=%s',
    hint: 'Open Claude with a question',
    verb: 'Ask',
    accent: { light: '#c8623f', dark: '#e98d6b' },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    prefix: 'p',
    aliases: ['p', 'pe', 'per', 'perp', 'perpl', 'perple', 'perplex', 'perplexi', 'perplexit', 'perplexity'],
    urlTemplate: 'https://www.perplexity.ai/search?q=%s',
    hint: 'Get an answer with sources',
    verb: 'Ask',
    accent: { light: '#1b7f8c', dark: '#2fc1d3' },
  },
  {
    id: 'x',
    name: 'X',
    prefix: 'x',
    aliases: ['x', 'twitter'],
    urlTemplate: 'https://x.com/search?q=%s',
    hint: 'Search posts',
    verb: 'Search',
    accent: { light: '#0f1419', dark: '#e7e9ea' },
  },
  {
    id: 'yahoo',
    name: 'Yahoo',
    prefix: 'y',
    aliases: ['y', 'ya', 'yah', 'yaho', 'yahoo', 'yh'],
    urlTemplate: 'https://search.yahoo.com/search?p=%s',
    hint: 'Search Yahoo',
    verb: 'Search',
    accent: { light: '#6001d2', dark: '#b18cff' },
  },
];

export const getSearchProvider = (id: string): SearchProviderDefinition | null => {
  return searchProviders.find((provider) => provider.id === id) ?? null;
};

const normalizeProviderTrigger = (trigger: string): string => trigger.trim().toLowerCase().replace(/\s+/g, ' ');

const expandProviderTrigger = (trigger: string): string[] => {
  const normalized = normalizeProviderTrigger(trigger);

  if (!normalized || normalized.includes(' ') || normalized.length === 1) {
    return normalized ? [normalized] : [];
  }

  return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(0, index + 2));
};

const getProviderTriggers = (provider: SearchProviderDefinition): Set<string> =>
  new Set([
    ...expandProviderTrigger(provider.prefix),
    ...provider.aliases.flatMap(expandProviderTrigger),
    normalizeProviderTrigger(provider.name),
    ...provider.name.split(/\s+/).flatMap(expandProviderTrigger),
  ]);

interface ProviderTriggerIndexEntry {
  provider: SearchProviderDefinition;
  triggers: Set<string>;
}

const createProviderTriggerIndex = (providers: SearchProviderDefinition[]): ProviderTriggerIndexEntry[] =>
  providers.map((provider) => ({ provider, triggers: getProviderTriggers(provider) }));

const findProvidersMatchingTrigger = (
  alias: string,
  index: ProviderTriggerIndexEntry[],
): SearchProviderDefinition[] => {
  const normalized = normalizeProviderTrigger(alias);

  if (!normalized) {
    return [];
  }

  return index
    .filter(({ triggers }) => [...triggers].some((trigger) => trigger.startsWith(normalized)))
    .map(({ provider }) => provider);
};

const findCompoundNamePrefixMatches = (
  trigger: string,
  providers: SearchProviderDefinition[],
): SearchProviderDefinition[] => {
  const normalized = normalizeProviderTrigger(trigger);

  if (!normalized.includes(' ')) {
    return [];
  }

  return providers.filter((provider) => {
    const fullName = normalizeProviderTrigger(provider.name);
    return fullName.includes(' ') && normalized.length < fullName.length && fullName.startsWith(normalized);
  });
};

const resolveProviderTrigger = (
  trigger: string,
  providers: SearchProviderDefinition[],
  candidates: SearchProviderDefinition[],
): SearchProviderDefinition | null => {
  const normalized = normalizeProviderTrigger(trigger);
  const canonicalMatches = providers.filter((provider) => normalizeProviderTrigger(provider.prefix) === normalized);
  const canonical = canonicalMatches.length === 1 ? canonicalMatches[0] : null;

  // Exact canonical prefixes, aliases, and names disambiguate their generated-prefix overlaps.
  if (canonical && candidates.some((provider) => provider.id === canonical.id)) {
    return canonical;
  }

  const explicitMatches = providers.filter(
    (provider) =>
      candidates.some((candidate) => candidate.id === provider.id) &&
      (provider.aliases.some((alias) => normalizeProviderTrigger(alias) === normalized) ||
        normalizeProviderTrigger(provider.name) === normalized),
  );

  if (explicitMatches.length === 1) {
    return explicitMatches[0];
  }

  if (explicitMatches.length > 1) {
    return null;
  }

  return candidates.length === 1 ? candidates[0] : null;
};

const findCommittedProvider = (
  trigger: string,
  providers: SearchProviderDefinition[],
): SearchProviderDefinition | null => {
  const normalized = normalizeProviderTrigger(trigger);
  const canonicalMatches = providers.filter((provider) => normalizeProviderTrigger(provider.prefix) === normalized);

  if (canonicalMatches.length === 1) {
    return canonicalMatches[0];
  }

  // Only canonical shortcuts commit from text; aliases and full names stay suggestions until selected.
  return null;
};

export const findSearchProviders = (
  alias: string,
  providers: SearchProviderDefinition[] = searchProviders,
): SearchProviderDefinition[] => findProvidersMatchingTrigger(alias, createProviderTriggerIndex(providers));

export const findSearchProvider = (
  alias: string,
  providers: SearchProviderDefinition[] = searchProviders,
): SearchProviderDefinition | null => {
  const candidates = findSearchProviders(alias, providers);
  return resolveProviderTrigger(alias, providers, candidates);
};

export const getSearchProviderSuggestions = (
  alias: string,
  providers: SearchProviderDefinition[] = searchProviders,
): SearchProviderDefinition[] => {
  const candidates = findSearchProviders(alias, providers);
  const resolved = resolveProviderTrigger(alias, providers, candidates);
  return resolved ? [resolved] : candidates;
};

export const findProviderQueryMatch = (
  input: string,
  providers: SearchProviderDefinition[] = searchProviders,
): ProviderQueryMatch | null => {
  const trimmedInput = input.trim();
  const normalizedInput = normalizeProviderTrigger(input);
  const triggerIndex = createProviderTriggerIndex(providers);

  if (triggerIndex.some(({ triggers }) => triggers.has(normalizedInput))) {
    return null;
  }

  const words = [...trimmedInput.matchAll(/\S+/g)];
  const exactCompoundNameMatches = providers
    .map((provider) => ({ provider, nameWords: normalizeProviderTrigger(provider.name).split(' ') }))
    .filter(
      ({ nameWords }) =>
        nameWords.length > 1 &&
        nameWords.length < words.length &&
        nameWords.every((word, index) => word === normalizeProviderTrigger(words[index][0])),
    );

  if (exactCompoundNameMatches.length) {
    const longestName = Math.max(...exactCompoundNameMatches.map(({ nameWords }) => nameWords.length));
    const candidates = exactCompoundNameMatches
      .filter(({ nameWords }) => nameWords.length === longestName)
      .map(({ provider }) => provider);
    const triggerEnd = (words[longestName - 1].index ?? 0) + words[longestName - 1][0].length;
    const trigger = trimmedInput.slice(0, triggerEnd);
    const resolved = resolveProviderTrigger(trigger, providers, candidates);

    return {
      trigger,
      providers: resolved ? [resolved] : candidates,
      provider: null,
      query: trimmedInput.slice(words[longestName].index ?? 0).trim(),
    };
  }

  const wholeInputNameMatches = findCompoundNamePrefixMatches(trimmedInput, providers);
  if (wholeInputNameMatches.length) {
    return {
      trigger: trimmedInput,
      providers: wholeInputNameMatches,
      provider: null,
      query: '',
      preserveFullQueryFallback: true,
    };
  }

  const maxTriggerWordCount = Math.max(
    1,
    ...triggerIndex.flatMap(({ triggers }) => [...triggers].map((trigger) => trigger.split(' ').length)),
  );

  for (
    let triggerWordCount = Math.min(words.length - 1, maxTriggerWordCount);
    triggerWordCount > 0;
    triggerWordCount -= 1
  ) {
    const triggerEnd = (words[triggerWordCount - 1].index ?? 0) + words[triggerWordCount - 1][0].length;
    const trigger = trimmedInput.slice(0, triggerEnd);
    const query = trimmedInput.slice(triggerEnd).trim();
    const exactCandidates = providers.filter((candidate) =>
      getProviderTriggers(candidate).has(normalizeProviderTrigger(trigger)),
    );

    if (exactCandidates.length) {
      const resolved = resolveProviderTrigger(trigger, providers, exactCandidates);

      return {
        trigger,
        providers: resolved ? [resolved] : exactCandidates,
        provider: findCommittedProvider(trigger, providers),
        query,
      };
    }

    const compoundNameMatches = findCompoundNamePrefixMatches(trigger, providers);

    if (compoundNameMatches.length) {
      return {
        trigger,
        providers: compoundNameMatches,
        provider: null,
        query: query || trimmedInput,
      };
    }

    const candidates = findProvidersMatchingTrigger(trigger, triggerIndex);

    if (candidates.length) {
      const resolved = resolveProviderTrigger(trigger, providers, candidates);

      return {
        trigger,
        providers: resolved ? [resolved] : candidates,
        provider: findCommittedProvider(trigger, providers),
        query,
      };
    }
  }

  return null;
};

export const parseProviderQuery = (
  input: string,
  providers: SearchProviderDefinition[] = searchProviders,
): ParsedProviderQuery | null => {
  const match = findProviderQueryMatch(input, providers);

  // A standalone provider trigger remains a suggestion; only a recognized trigger plus a query commits a handoff.
  return match?.provider && match.query ? { provider: match.provider, query: match.query } : null;
};

export const createProviderSearchItem = (provider: SearchProviderDefinition, query: string): SearchItem => {
  const normalizedQuery = query.trim();

  return {
    id: `search-${provider.id}`,
    title:
      provider.verb === 'Ask'
        ? `Ask ${provider.name} “${normalizedQuery}”`
        : `Search ${provider.name} for “${normalizedQuery}”`,
    subtitle: provider.hint,
    icon: '↗',
    type: 'search',
    keywords: [provider.name, normalizedQuery],
    url: provider.urlTemplate.replace('%s', encodeURIComponent(normalizedQuery)),
  };
};
