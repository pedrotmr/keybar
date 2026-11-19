import type { KeyboardEventHandler, RefObject } from 'react';
import type { PaletteItem } from '@/types';
import type { SearchProviderDefinition } from '@/utils/searchProviders';
import { resultDomId } from '../../ResultsList/helpers';
import { ProviderIcon, providerAccentStyle } from '../../ProviderIcon';
import { BackGlyph } from './BackGlyph';

interface SearchAreaSearchProps {
  activeProvider: SearchProviderDefinition | null;
  providerCandidates: SearchProviderDefinition[];
  query: string;
  selectedItem?: PaletteItem;
}

interface SearchAreaViewStateProps {
  inputRef: RefObject<HTMLInputElement | null>;
  hasSelectedTab: boolean;
  showResults: boolean;
  resultsLength: number;
}

interface SearchAreaHandlerProps {
  onQueryChange: (query: string) => void;
  onSearchKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onReturnToCommandSearch: () => void;
  onActivateProvider: (provider: SearchProviderDefinition) => void;
  onOpenSettings: () => void;
}

interface SearchAreaProps extends SearchAreaSearchProps, SearchAreaViewStateProps, SearchAreaHandlerProps {}

export function SearchArea({
  activeProvider,
  providerCandidates,
  query,
  inputRef,
  selectedItem,
  hasSelectedTab,
  showResults,
  resultsLength,
  onQueryChange,
  onSearchKeyDown,
  onReturnToCommandSearch,
  onActivateProvider,
  onOpenSettings,
}: SearchAreaProps) {
  return (
    <div className="search-area">
      <span className="search-symbol" aria-hidden="true">
        {activeProvider ? (
          <ProviderIcon providerId={activeProvider.id} />
        ) : (
          <svg viewBox="0 0 20 20" fill="none">
            <circle cx="8.8" cy="8.8" r="5.7" stroke="currentColor" strokeWidth="1.6" />
            <path d="m13.1 13.1 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <label className="visually-hidden" htmlFor="command-center-search">
        {activeProvider
          ? `${activeProvider.verb} ${activeProvider.name}`
          : 'Search commands, tabs, bookmarks, history, and the web'}
      </label>
      {activeProvider && (
        <span className="provider-chip" style={providerAccentStyle(activeProvider)}>
          <span>{activeProvider.name}</span>
          <button
            type="button"
            aria-label="Back to command search"
            title="Back to command search"
            onClick={onReturnToCommandSearch}
          >
            <BackGlyph />
          </button>
        </span>
      )}
      <input
        ref={inputRef}
        id="command-center-search"
        className="search-input"
        name="command-query"
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder={activeProvider ? `${activeProvider.verb} ${activeProvider.name}…` : 'Search commands or a website'}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={showResults && resultsLength > 0}
        aria-controls={showResults ? 'command-center-results' : undefined}
        aria-activedescendant={selectedItem ? resultDomId(selectedItem.id) : undefined}
        aria-describedby={
          ['provider-suggestion-status', hasSelectedTab ? 'tab-actions-hint' : ''].filter(Boolean).join(' ') ||
          undefined
        }
        autoComplete="off"
        spellCheck={false}
      />
      <span id="tab-actions-hint" className="visually-hidden">
        F2 renames the selected tab. Shift F10, the Context Menu key, or Command/Control K opens tab actions.
      </span>
      <span
        id="provider-suggestion-status"
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {providerCandidates.length > 1
          ? `${providerCandidates.length} search providers match: ${providerCandidates.map((provider) => provider.name).join(', ')}. Press Tab to focus the provider choices, then Enter to select.`
          : providerCandidates.length === 1
            ? `${providerCandidates[0].verb} ${providerCandidates[0].name}. Press Tab to select.`
            : ''}
      </span>
      <div className="mode-nav" role="group" aria-label="Command Bar controls">
        {providerCandidates.length === 1 && (
          <button
            type="button"
            className="provider-hint"
            aria-label={`${providerCandidates[0].verb} ${providerCandidates[0].name}`}
            onClick={() => onActivateProvider(providerCandidates[0])}
          >
            <ProviderIcon providerId={providerCandidates[0].id} className="provider-hint-icon" />
            <kbd aria-hidden="true">Tab</kbd>
            <span>
              {providerCandidates[0].verb} {providerCandidates[0].name}
            </span>
          </button>
        )}
        {providerCandidates.length > 1 && (
          <div className="provider-candidates" role="group" aria-label="Matching search providers">
            {providerCandidates.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="provider-candidate"
                aria-label={`${provider.verb} ${provider.name}`}
                onClick={() => onActivateProvider(provider)}
              >
                <ProviderIcon providerId={provider.id} className="provider-candidate-icon" />
                <span>{provider.name}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" aria-label="Appearance settings" className="mode-icon-button" onClick={onOpenSettings}>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 5.5h5M11.5 5.5H17M3 10h2M8.5 10H17M3 14.5h8M14.5 14.5H17" />
            <circle cx="10" cy="5.5" r="1.5" />
            <circle cx="7" cy="10" r="1.5" />
            <circle cx="13" cy="14.5" r="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
