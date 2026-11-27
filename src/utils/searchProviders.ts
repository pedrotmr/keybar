import type { SearchItem } from '@/types';
import catalogMarkdown from '../../docs/research/search-provider-catalog.md?raw';

export interface SearchProviderAccent {
  light: string;
  dark: string;
}

export type SearchProviderIconAsset =
  'google' | 'google-maps' | 'youtube' | 'openai' | 'claude' | 'perplexity' | 'x' | 'yahoo' | 'fallback';

export interface SearchProviderDefinition {
  id: string;
  name: string;
  /** The first trigger is the canonical shortcut that commits a handoff when followed by a query. */
  prefix: string;
  /** All explicit shortcuts; each multi-character value also matches progressively. */
  prefixes: string[];
  /** Legacy aliases retained for current providers and imported catalog aliases. */
  aliases: string[];
  urlTemplate: string;
  hint: string;
  verb: 'Search' | 'Ask';
  iconAsset: SearchProviderIconAsset;
  accent: SearchProviderAccent;
  enabled: boolean;
  builtIn: boolean;
}

export interface SearchProviderSettings {
  providers: SearchProviderDefinition[];
}

export interface ParsedProviderQuery {
  provider: SearchProviderDefinition;
  query: string;
}

export interface ProviderQueryMatch {
  trigger: string;
  providers: SearchProviderDefinition[];
  provider: SearchProviderDefinition | null;
  query: string;
  preserveFullQueryFallback?: boolean;
}

export const SEARCH_PROVIDER_SETTINGS_KEY = 'searchProviderSettings';

const accent = (light: string, dark = light): SearchProviderAccent => ({ light, dark });

export const baseProvider = (
  id: string,
  name: string,
  prefixes: string[],
  urlTemplate: string,
  hint: string,
  iconAsset: SearchProviderIconAsset = 'fallback',
  color = '#6b7280',
  verb: 'Search' | 'Ask' = 'Search',
  darkColor = color,
): SearchProviderDefinition => ({
  id,
  name,
  prefix: prefixes[0],
  prefixes,
  aliases: prefixes,
  urlTemplate,
  hint,
  verb,
  iconAsset,
  accent: accent(color, darkColor),
  enabled: true,
  builtIn: true,
});

const readCatalogRows = (): SearchProviderDefinition[] => {
  const rows = catalogMarkdown.split('\n').filter((line) => /^\| \[[^\]]+\]\(https?:\/\//.test(line));

  return rows.flatMap((line) => {
    // The table's first four columns carry the name, homepage, query route, and trigger guidance.
    const columns = line
      .replace(/^\|/, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
    if (columns.length < 4) return [];

    const identity = columns[0].match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    if (!identity) return [];

    const name = identity[1].replace(/\\\|/g, '|').trim();
    const homepage = identity[2];
    const queryRoute = columns[2].match(/`(https?:\/\/[^`]+)`/)?.[1];
    const urlTemplate = queryRoute?.includes('%s') ? queryRoute : homepage;
    const suggestedAliases = columns[3]
      .split('+')
      .slice(1)
      .join('+')
      .split(',')
      .map((value) =>
        value
          .replace(/`/g, '')
          .replace(/\s*\([^)]*\)/g, '')
          .trim()
          .toLowerCase(),
      )
      .filter((value) => value.length > 1 && /^[a-z0-9]+$/.test(value));
    const firstNameToken = name.toLowerCase().match(/[a-z0-9]+/)?.[0] ?? 'search';
    const prefixes = [...new Set([suggestedAliases[0] ?? firstNameToken.slice(0, 2), ...suggestedAliases])];
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const isAi = /\b(ai|chat|answer|copilot|gpt)\b/i.test(columns[0]);

    return [
      baseProvider(id, name, prefixes, urlTemplate, `Search ${name}`, 'fallback', '#6b7280', isAi ? 'Ask' : 'Search'),
    ];
  });
};

const existingProviders: SearchProviderDefinition[] = [
  baseProvider(
    'google',
    'Google',
    ['g', 'go', 'goo', 'google'],
    'https://www.google.com/search?q=%s',
    'Search the web',
    'google',
    '#1a73e8',
    'Search',
    '#8ab4f8',
  ),
  baseProvider(
    'google-maps',
    'Google Maps',
    ['gm', 'ma', 'maps'],
    'https://www.google.com/maps/search/?api=1&query=%s',
    'Search places and addresses',
    'google-maps',
    '#1a73e8',
    'Search',
    '#8ab4f8',
  ),
  baseProvider(
    'youtube',
    'YouTube',
    ['yt', 'yo', 'you', 'yout', 'youtu', 'youtub', 'youtube'],
    'https://www.youtube.com/results?search_query=%s',
    'Search videos',
    'youtube',
    '#e0001e',
    'Search',
    '#ff5c6c',
  ),
  baseProvider(
    'chatgpt',
    'ChatGPT',
    ['ai', 'cha', 'chat', 'chatgpt', 'gp', 'gpt'],
    'https://chatgpt.com/?q=%s',
    'Open ChatGPT with a question',
    'openai',
    '#10a37f',
    'Ask',
    '#4fd1a8',
  ),
  baseProvider(
    'claude',
    'Claude',
    ['cl', 'claude'],
    'https://claude.ai/new?q=%s',
    'Open Claude with a question',
    'claude',
    '#c8623f',
    'Ask',
    '#e98d6b',
  ),
  baseProvider(
    'perplexity',
    'Perplexity',
    ['p', 'pe', 'per', 'perp', 'perpl', 'perple', 'perplex', 'perplexi', 'perplexit', 'perplexity'],
    'https://www.perplexity.ai/search?q=%s',
    'Get an answer with sources',
    'perplexity',
    '#1b7f8c',
    'Ask',
    '#2fc1d3',
  ),
  baseProvider(
    'x',
    'X',
    ['x', 'twitter'],
    'https://x.com/search?q=%s',
    'Search posts',
    'x',
    '#0f1419',
    'Search',
    '#e7e9ea',
  ),
  baseProvider(
    'yahoo',
    'Yahoo',
    ['y', 'ya', 'yah', 'yaho', 'yahoo', 'yh'],
    'https://search.yahoo.com/search?p=%s',
    'Search Yahoo',
    'yahoo',
    '#6001d2',
    'Search',
    '#b18cff',
  ),
];

const catalogProviders = readCatalogRows();
const productionProviderIds = new Set(existingProviders.map(({ id }) => id));
// Keep production definitions stable while taking the full catalog from its researched source.
export const searchProviders: SearchProviderDefinition[] = [
  ...existingProviders,
  ...catalogProviders.filter((provider) => !productionProviderIds.has(provider.id)),
];

export const normalizeSearchProviderSettings = (value: unknown): SearchProviderDefinition[] => {
  const stored = (value as SearchProviderSettings | undefined)?.providers;
  if (!Array.isArray(stored)) return searchProviders;

  const overrides = new Map(
    stored.filter((provider) => provider && typeof provider.id === 'string').map((provider) => [provider.id, provider]),
  );
  const providers = searchProviders.map((provider) => {
    const override = overrides.get(provider.id);
    if (!override) return provider;
    return {
      ...provider,
      name: typeof override.name === 'string' && override.name.trim() ? override.name.trim() : provider.name,
      urlTemplate: isValidProviderTemplate(override.urlTemplate) ? override.urlTemplate.trim() : provider.urlTemplate,
      prefixes: normalizePrefixes(override.prefixes, provider.prefixes),
      prefix: normalizePrefixes(override.prefixes, provider.prefixes)[0] ?? provider.prefix,
      aliases: normalizePrefixes(override.prefixes, provider.prefixes),
      enabled: override.enabled !== false,
    };
  });

  for (const provider of stored) {
    if (!provider?.id?.startsWith('custom-') || overrides.has(provider.id) === false) continue;
    if (
      providers.some(({ id }) => id === provider.id) ||
      !provider.name?.trim() ||
      !isValidProviderTemplate(provider.urlTemplate)
    )
      continue;
    const prefixes = normalizePrefixes(provider.prefixes, []);
    providers.push({
      ...baseProvider(
        provider.id,
        provider.name.trim(),
        prefixes,
        provider.urlTemplate.trim(),
        `Search ${provider.name.trim()}`,
      ),
      enabled: provider.enabled !== false,
      builtIn: false,
    });
  }

  return providers;
};

const normalizePrefixes = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  return [
    ...new Set(
      value
        .filter((prefix): prefix is string => typeof prefix === 'string')
        .map(normalizeProviderTrigger)
        .filter(Boolean),
    ),
  ];
};

export const isValidProviderTemplate = (template: unknown): template is string =>
  typeof template === 'string' && /^https?:\/\//i.test(template.trim()) && !/[\r\n]/.test(template);

export const getSearchProvider = (
  id: string,
  providers: SearchProviderDefinition[] = searchProviders,
): SearchProviderDefinition | null => providers.find((provider) => provider.id === id) ?? null;

const normalizeProviderTrigger = (trigger: string): string => trigger.trim().toLowerCase().replace(/\s+/g, ' ');

const expandProviderTrigger = (trigger: string): string[] => {
  const normalized = normalizeProviderTrigger(trigger);
  if (!normalized || normalized.includes(' ') || normalized.length === 1) return normalized ? [normalized] : [];
  return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(0, index + 2));
};

const getProviderTriggers = (provider: SearchProviderDefinition): Set<string> =>
  new Set([
    ...provider.prefixes.flatMap(expandProviderTrigger),
    ...provider.aliases.flatMap(expandProviderTrigger),
    normalizeProviderTrigger(provider.name),
    ...provider.name.split(/\s+/).flatMap(expandProviderTrigger),
  ]);

export interface ProviderPrefixConflict {
  trigger: string;
  providers: string[];
}

export const detectProviderPrefixConflicts = (providers: SearchProviderDefinition[]): ProviderPrefixConflict[] => {
  const matches = new Map<string, string[]>();
  for (const provider of providers) {
    for (const trigger of getProviderTriggers(provider)) {
      const current = matches.get(trigger) ?? [];
      current.push(provider.id);
      matches.set(trigger, current);
    }
  }
  return [...matches.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([trigger, ids]) => ({ trigger, providers: ids }));
};

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
  if (!normalized) return [];
  return index
    .filter(({ triggers }) => [...triggers].some((trigger) => trigger.startsWith(normalized)))
    .map(({ provider }) => provider);
};

const findCompoundNamePrefixMatches = (
  trigger: string,
  providers: SearchProviderDefinition[],
): SearchProviderDefinition[] => {
  const normalized = normalizeProviderTrigger(trigger);
  if (!normalized.includes(' ')) return [];
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
  const explicitMatches = providers.filter(
    (provider) =>
      provider.prefixes.some((prefix) => normalizeProviderTrigger(prefix) === normalized) ||
      normalizeProviderTrigger(provider.name) === normalized,
  );
  if (explicitMatches.length > 1) return null;
  const canonicalMatches = providers.filter((provider) => normalizeProviderTrigger(provider.prefix) === normalized);
  const canonical = canonicalMatches.length === 1 ? canonicalMatches[0] : null;
  if (canonical && candidates.some((provider) => provider.id === canonical.id)) return canonical;
  const candidateExplicitMatches = explicitMatches.filter((provider) =>
    candidates.some((candidate) => candidate.id === provider.id),
  );
  if (candidateExplicitMatches.length === 1) return candidateExplicitMatches[0];
  if (candidateExplicitMatches.length > 1) return null;
  return candidates.length === 1 ? candidates[0] : null;
};

const findCommittedProvider = (
  trigger: string,
  providers: SearchProviderDefinition[],
): SearchProviderDefinition | null => {
  const normalized = normalizeProviderTrigger(trigger);
  const explicitMatches = providers.filter(
    (provider) =>
      provider.prefixes.some((prefix) => normalizeProviderTrigger(prefix) === normalized) ||
      normalizeProviderTrigger(provider.name) === normalized,
  );
  if (explicitMatches.length > 1) return null;
  const canonicalMatches = providers.filter((provider) => normalizeProviderTrigger(provider.prefix) === normalized);
  return canonicalMatches.length === 1 ? canonicalMatches[0] : null;
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
  if (triggerIndex.some(({ triggers }) => triggers.has(normalizedInput))) return null;
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
  if (wholeInputNameMatches.length)
    return {
      trigger: trimmedInput,
      providers: wholeInputNameMatches,
      provider: null,
      query: '',
      preserveFullQueryFallback: true,
    };
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
    if (compoundNameMatches.length)
      return { trigger, providers: compoundNameMatches, provider: null, query: query || trimmedInput };
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
    url: provider.urlTemplate.includes('%s')
      ? provider.urlTemplate.replace(/%s/g, encodeURIComponent(normalizedQuery))
      : provider.urlTemplate,
  };
};
