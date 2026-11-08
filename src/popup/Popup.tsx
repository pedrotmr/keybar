import { useEffect, useState } from 'react';
import type { PaletteMode, ThemePreferences } from '@/types';
import { CommandPalette } from '@/components/CommandPalette';
import { TabSwitcher } from '@/components/TabSwitcher';
import { sendBackground } from '@/utils/chromeHelpers';

interface PopupProps {
  initialMode: PaletteMode;
  initialTheme: ThemePreferences;
  initialSwitcherAutoSwitchOnRelease: boolean;
  initialSwitcherOpenedAt: number;
  initialSwitcherModifierReleased: boolean;
}

export function Popup({
  initialMode,
  initialTheme,
  initialSwitcherAutoSwitchOnRelease,
  initialSwitcherOpenedAt,
  initialSwitcherModifierReleased,
}: PopupProps) {
  const surface = initialMode === 'tabs' ? 'tabs' : 'commands';
  const [cycleVersion, setCycleVersion] = useState(0);

  useEffect(() => {
    void sendBackground('tabs:current')
      .then((tab) => sendBackground('popup:ready', { windowId: tab?.windowId, surface }))
      .catch(() => undefined);
  }, [surface]);

  useEffect(() => {
    const onRuntimeMessage = (message: { action?: string; cycles?: number }) => {
      if (message.action === 'ui:tabs-cycle') {
        const cycles = Math.max(1, Math.min(64, Math.floor(Number(message.cycles) || 1)));
        setCycleVersion((version) => version + cycles);
      }
    };

    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }, []);

  return (
    <div className="cc-root">
      {surface === 'tabs' ? (
        <TabSwitcher
          onClose={() => window.close()}
          autoSwitchOnRelease={initialSwitcherAutoSwitchOnRelease}
          openedAt={initialSwitcherOpenedAt}
          modifierReleasedAtOpen={initialSwitcherModifierReleased}
          surface="popup"
          cycleVersion={cycleVersion}
        />
      ) : (
        <CommandPalette
          initialMode={initialMode === 'settings' ? 'settings' : 'commands'}
          initialTheme={initialTheme}
          onClose={() => window.close()}
        />
      )}
    </div>
  );
}
