import { useMemo, useState } from 'react';
import { baseProvider, detectProviderPrefixConflicts, isValidProviderTemplate } from '@/utils/searchProviders';
import type { SearchProviderDefinition } from '@/utils/searchProviders';

interface SearchProviderSectionProps {
  providers: SearchProviderDefinition[];
  onChange: (providers: SearchProviderDefinition[]) => void;
}

export function SearchProviderSection({ providers, onChange }: SearchProviderSectionProps) {
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newPrefixes, setNewPrefixes] = useState('');
  const conflicts = useMemo(
    () => detectProviderPrefixConflicts(providers.filter((provider) => provider.enabled)),
    [providers],
  );
  const conflictsByProvider = useMemo(() => {
    const index = new Map<string, Set<string>>();
    for (const conflict of conflicts) {
      for (const id of conflict.providers) {
        const triggers = index.get(id) ?? new Set<string>();
        triggers.add(conflict.trigger);
        index.set(id, triggers);
      }
    }
    return index;
  }, [conflicts]);
  const visibleProviders = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return providers.filter(
      (provider) =>
        !query ||
        [provider.name, provider.urlTemplate, ...provider.prefixes].some((value) =>
          value.toLowerCase().includes(query),
        ),
    );
  }, [filter, providers]);

  const updateProvider = (id: string, update: Partial<SearchProviderDefinition>) => {
    onChange(providers.map((provider) => (provider.id === id ? { ...provider, ...update } : provider)));
  };

  const addProvider = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    const prefixes = newPrefixes
      .split(/[\s,]+/)
      .map((prefix) => prefix.trim().toLowerCase())
      .filter(Boolean);
    if (!name || !isValidProviderTemplate(url) || !url.includes('%s') || !prefixes.length) return;
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'provider';
    const id = `custom-${slug}-${Date.now().toString(36)}`;
    onChange([...providers, { ...baseProvider(id, name, prefixes, url, `Search ${name}`), builtIn: false }]);
    setNewName('');
    setNewUrl('');
    setNewPrefixes('');
  };

  return (
    <fieldset className="settings-group provider-settings">
      <legend>Search providers</legend>
      <p className="provider-settings-intro">
        Choose which destinations appear in the Command Bar. Prefixes match progressively, so conflicts include shared
        short forms.
      </p>
      {conflicts.length > 0 && (
        <div className="provider-conflict-summary" role="status">
          <strong>
            {conflicts.length} active prefix {conflicts.length === 1 ? 'conflict' : 'conflicts'}
          </strong>
          <span>
            {conflicts
              .slice(0, 12)
              .map(({ trigger }) => `“${trigger}”`)
              .join(', ')}
            {conflicts.length > 12 ? ', …' : ''}
          </span>
        </div>
      )}
      <label className="provider-filter-label">
        <span>Find a provider</span>
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search 107 providers" />
      </label>
      <div className="provider-settings-list" aria-label="Search provider catalog">
        {visibleProviders.map((provider) => {
          const providerConflicts = [...(conflictsByProvider.get(provider.id) ?? [])];
          return (
            <article className={`provider-settings-card${provider.enabled ? '' : ' is-disabled'}`} key={provider.id}>
              <div className="provider-settings-title-row">
                <label className="provider-enabled-control">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })}
                  />
                  <span>{provider.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
                <span className="provider-kind">{provider.builtIn ? 'Built in' : 'Custom'}</span>
              </div>
              <label>
                <span>Name</span>
                <input
                  value={provider.name}
                  onChange={(event) => updateProvider(provider.id, { name: event.target.value })}
                />
              </label>
              <label>
                <span>URL template</span>
                <input
                  value={provider.urlTemplate}
                  onChange={(event) => updateProvider(provider.id, { urlTemplate: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label>
                <span>Trigger prefixes</span>
                <input
                  value={provider.prefixes.join(', ')}
                  onChange={(event) => {
                    const prefixes = [
                      ...new Set(
                        event.target.value
                          .split(/[\s,]+/)
                          .map((value) => value.trim().toLowerCase())
                          .filter(Boolean),
                      ),
                    ];
                    updateProvider(provider.id, { prefixes, prefix: prefixes[0] ?? '', aliases: prefixes });
                  }}
                  aria-describedby={`provider-conflicts-${provider.id}`}
                />
              </label>
              <p
                className={`provider-conflict-note${providerConflicts.length ? ' has-conflict' : ''}`}
                id={`provider-conflicts-${provider.id}`}
              >
                {providerConflicts.length
                  ? `Conflicts with progressive matches: ${providerConflicts.join(', ')}`
                  : 'No active prefix conflicts'}
              </p>
            </article>
          );
        })}
        {!visibleProviders.length && <p className="provider-empty">No providers match that search.</p>}
      </div>
      <div className="provider-add-form">
        <h3>Add a custom provider</h3>
        <label>
          <span>Name</span>
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Example Search" />
        </label>
        <label>
          <span>URL template</span>
          <input
            value={newUrl}
            onChange={(event) => setNewUrl(event.target.value)}
            placeholder="https://example.com/search?q=%s"
            spellCheck={false}
          />
        </label>
        <label>
          <span>Trigger prefixes</span>
          <input
            value={newPrefixes}
            onChange={(event) => setNewPrefixes(event.target.value)}
            placeholder="ex, example"
          />
        </label>
        <button
          type="button"
          className="provider-add-button"
          onClick={addProvider}
          disabled={
            !newName.trim() || !isValidProviderTemplate(newUrl) || !newUrl.includes('%s') || !newPrefixes.trim()
          }
        >
          Add provider
        </button>
      </div>
    </fieldset>
  );
}
