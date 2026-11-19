export type TabSwitcherReleaseKey = 'Meta' | 'Control' | 'Alt';

interface KeyReleaseState {
  releaseAtByKey?: Partial<Record<TabSwitcherReleaseKey, number>>;
}

declare global {
  interface Window {
    __keybarKeyReleaseState?: KeyReleaseState;
  }
}

export const isTabSwitcherModifierKey = (key: string): key is 'Meta' | 'Control' | 'Alt' => {
  return key === 'Meta' || key === 'Control' || key === 'Alt';
};

export const getTabSwitcherReleaseKeyFromShortcut = (
  shortcut: string | null | undefined,
): TabSwitcherReleaseKey | null => {
  if (!shortcut) {
    return null;
  }

  const tokens = shortcut
    .replace(/⌃/g, 'Control+')
    .replace(/⌘/g, 'Meta+')
    .replace(/⌥/g, 'Alt+')
    .replace(/⇧/g, 'Shift+')
    .split('+')
    .map((part: string) => part.trim().toLowerCase());

  for (const token of tokens) {
    if (token === 'command' || token === 'cmd' || token === 'meta') {
      return 'Meta';
    }

    if (token === 'ctrl' || token === 'control' || token === 'macctrl') {
      return 'Control';
    }

    if (token === 'alt' || token === 'option') {
      return 'Alt';
    }
  }

  return null;
};

export const installTabSwitcherKeyReleaseMonitorInPage = (): void => {
  if (window.__keybarKeyReleaseState?.releaseAtByKey) {
    return;
  }

  const releaseAtByKey: Partial<Record<TabSwitcherReleaseKey, number>> = {};
  const state: KeyReleaseState = { releaseAtByKey };
  window.__keybarKeyReleaseState = state;

  window.addEventListener(
    'keyup',
    (event: KeyboardEvent) => {
      if (event.isTrusted && (event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt')) {
        releaseAtByKey[event.key] = Date.now();
      }
    },
    true,
  );
};

export const installTabSwitcherKeyReleaseMonitor = (): void => {
  installTabSwitcherKeyReleaseMonitorInPage();
};

export const wasTabSwitcherModifierReleasedAfter = (
  startedAt: number | null | undefined,
  releaseKey: TabSwitcherReleaseKey | null | undefined,
): boolean => {
  if (!startedAt || !releaseKey) {
    return false;
  }

  installTabSwitcherKeyReleaseMonitor();
  return (window.__keybarKeyReleaseState?.releaseAtByKey?.[releaseKey] ?? 0) >= startedAt;
};
