import type { ThemePreferences } from '@/types';
import { AppearanceSection } from './SettingsView/AppearanceSection/AppearanceSection';
import { CommandBarSizeSection } from './SettingsView/CommandBarSizeSection/CommandBarSizeSection';
import { FontFamilySection } from './SettingsView/FontFamilySection/FontFamilySection';
import { PaletteSection } from './SettingsView/PaletteSection/PaletteSection';
import { ShortcutSettingsRow } from './SettingsView/ShortcutSettingsRow/ShortcutSettingsRow';
import { WindowModeSection } from './SettingsView/WindowModeSection/WindowModeSection';
import { SearchProviderSection } from './SettingsView/SearchProviderSection';
import type { SearchProviderDefinition } from '@/utils/searchProviders';

interface SettingsViewProps {
  preferences: ThemePreferences;
  onChange: (preferences: ThemePreferences) => void;
  onManageShortcuts: () => void;
  onBack: () => void;
  viewRef: (node: HTMLElement | null) => void;
  searchProviders: SearchProviderDefinition[];
  onSearchProvidersChange: (providers: SearchProviderDefinition[]) => void;
}

export function SettingsView({
  preferences,
  onChange,
  onManageShortcuts,
  onBack,
  viewRef,
  searchProviders,
  onSearchProvidersChange,
}: SettingsViewProps) {
  return (
    <section ref={viewRef} className="settings-view" aria-labelledby="settings-title" tabIndex={-1}>
      <button
        type="button"
        className="mode-icon-button settings-back-icon"
        aria-label="Back to command search"
        title="Back to command search"
        onClick={onBack}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
      </button>
      <div className="settings-heading">
        <h2 id="settings-title">Settings</h2>
        <p>Adjust the Command Bar appearance and search provider catalog.</p>
      </div>

      <ShortcutSettingsRow onManageShortcuts={onManageShortcuts} />
      <SearchProviderSection providers={searchProviders} onChange={onSearchProvidersChange} />
      <AppearanceSection preferences={preferences} onChange={onChange} />
      <PaletteSection preferences={preferences} onChange={onChange} />
      <FontFamilySection preferences={preferences} onChange={onChange} />
      <CommandBarSizeSection preferences={preferences} onChange={onChange} />
      <WindowModeSection preferences={preferences} onChange={onChange} />
    </section>
  );
}
