interface KeyReleaseState {
  lastModifierReleaseAt: number;
}

declare global {
  interface Window {
    __keybarKeyReleaseState?: KeyReleaseState;
  }
}

export const isTabSwitcherModifierKey = (key: string): key is 'Meta' | 'Control' | 'Alt' => {
  // Chrome lets users customize extension shortcuts, so the modifier may differ
  // from the operating system's suggested shortcut.
  return key === 'Meta' || key === 'Control' || key === 'Alt';
};

export const installTabSwitcherKeyReleaseMonitorInPage = (): void => {
  if (window.__keybarKeyReleaseState) {
    return;
  }

  const state: KeyReleaseState = { lastModifierReleaseAt: 0 };
  window.__keybarKeyReleaseState = state;

  window.addEventListener(
    'keyup',
    (event: KeyboardEvent) => {
      if (event.isTrusted && (event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt')) {
        state.lastModifierReleaseAt = Date.now();
      }
    },
    true,
  );
};

export const installTabSwitcherKeyReleaseMonitor = (): void => {
  installTabSwitcherKeyReleaseMonitorInPage();
};

export const wasTabSwitcherModifierReleasedAfter = (startedAt: number | null | undefined): boolean => {
  if (!startedAt) {
    return false;
  }

  installTabSwitcherKeyReleaseMonitor();
  return (window.__keybarKeyReleaseState?.lastModifierReleaseAt ?? 0) >= startedAt;
};
