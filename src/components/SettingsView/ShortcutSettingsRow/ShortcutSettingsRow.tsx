import { useEffect, useState } from 'react';
import { formatShortcutAccessibleLabel, formatShortcutLabel, sendBackground } from '@/utils/chromeHelpers';

interface ShortcutSettingsRowProps {
  onManageShortcuts: () => void;
}

type ShortcutCommand = 'open-command-palette' | 'open-tab-switcher';
type ShortcutState =
  { status: 'loading' } | { status: 'ready'; bindings: Partial<Record<ShortcutCommand, string>> } | { status: 'error' };

const SHORTCUTS: Array<{ name: ShortcutCommand; title: string; description: string }> = [
  {
    name: 'open-command-palette',
    title: 'Command Bar',
    description: 'Search commands, open tabs, and websites.',
  },
  {
    name: 'open-tab-switcher',
    title: 'Tab Switcher',
    description: 'Jump between recent tabs in this window.',
  },
];

export function ShortcutSettingsRow({ onManageShortcuts }: ShortcutSettingsRowProps) {
  const [shortcutState, setShortcutState] = useState<ShortcutState>({ status: 'loading' });

  useEffect(() => {
    let isMounted = true;

    const loadShortcuts = async (): Promise<void> => {
      try {
        const commands = await sendBackground('shortcuts:list');
        const bindings = Object.fromEntries(
          commands
            .filter((command) => command.name && command.shortcut)
            .map((command) => [command.name, command.shortcut]),
        ) as Partial<Record<ShortcutCommand, string>>;

        if (isMounted) setShortcutState({ status: 'ready', bindings });
      } catch {
        if (isMounted) setShortcutState({ status: 'error' });
      }
    };

    void loadShortcuts();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <section className="settings-shortcuts" aria-labelledby="shortcut-settings-title">
      <div className="settings-shortcuts-heading">
        <div className="settings-row-text">
          <h3 id="shortcut-settings-title" className="settings-row-title">
            Keyboard shortcuts
          </h3>
          <p className="settings-row-description">See what opens each Keybar surface.</p>
        </div>
        <button type="button" className="button-secondary" onClick={onManageShortcuts}>
          Manage shortcuts
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5.5 10.5 10.5 5.5M6.5 5.5h4v4" />
          </svg>
        </button>
      </div>
      <dl
        className="settings-shortcut-list"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={shortcutState.status === 'loading'}
      >
        {SHORTCUTS.map((shortcut) => {
          const binding = shortcutState.status === 'ready' ? shortcutState.bindings[shortcut.name] : undefined;

          return (
            <div key={shortcut.name} className="settings-shortcut-item">
              <dt>
                <span className="settings-row-title">{shortcut.title}</span>
                <span className="settings-row-description">{shortcut.description}</span>
              </dt>
              <dd>
                {shortcutState.status === 'loading' ? (
                  <span className="settings-shortcut-fallback">Checking…</span>
                ) : shortcutState.status === 'ready' && binding ? (
                  <kbd>
                    <span aria-hidden="true">{formatShortcutLabel(binding)}</span>
                    <span className="visually-hidden">{formatShortcutAccessibleLabel(binding)}</span>
                  </kbd>
                ) : shortcutState.status === 'ready' ? (
                  <span className="settings-shortcut-fallback">Not assigned</span>
                ) : (
                  <span className="settings-shortcut-fallback">Couldn’t read</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="settings-shortcuts-note">
        {shortcutState.status === 'ready'
          ? 'If a shortcut is not assigned, use Manage shortcuts to choose one. Chrome controls which shortcuts extensions can use; browser shortcuts may stay with Chrome.'
          : 'Use Manage shortcuts to check or assign a shortcut in Chrome. Chrome controls which shortcuts extensions can use; browser shortcuts may stay with Chrome.'}
      </p>
    </section>
  );
}
