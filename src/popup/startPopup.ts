import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import { PermissionRequest } from './PermissionRequest';
import {
  applyTheme,
  defaultThemePreferences,
  normalizeThemePreferences,
  readThemeCache,
  themePreferencesStorageKey,
} from '@/themes';
import type { PaletteMode, ThemePreferences } from '@/types';
import { installProductFont } from '@/utils/installProductFont';
import {
  installTabSwitcherKeyReleaseMonitor,
  wasTabSwitcherModifierReleasedAfter,
} from '@/utils/tabSwitcherKeyRelease';
import { consumePopupLaunchIntent, parsePopupLaunchFallback } from '@/utils/popupLaunchIntent';

interface CommandCenterTiming {
  name: string;
  durationMs: number;
  at: number;
}

interface WindowWithCommandCenterTimings extends Window {
  __commandCenterTimings?: CommandCenterTiming[];
}

const isPaletteMode = (value: string | null): value is PaletteMode => {
  return value === 'commands' || value === 'tabs' || value === 'settings';
};

const resolvePaletteMode = (urlMode: string | null, storedMode: string | null): PaletteMode => {
  if (isPaletteMode(urlMode)) {
    return urlMode;
  }

  if (isPaletteMode(storedMode)) {
    return storedMode;
  }

  return 'commands';
};

const guardShortcutChordOnOpen = (): void => {
  const deadline = performance.now() + 180;
  const removeGuard = () => window.removeEventListener('keydown', suppressChord, true);

  const suppressChord = (event: KeyboardEvent) => {
    if (performance.now() > deadline) {
      removeGuard();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      removeGuard();
    }
  };

  window.addEventListener('keydown', suppressChord, true);
  window.setTimeout(removeGuard, 180);
};

export const startPopup = async (): Promise<void> => {
  const urlParameters = new URLSearchParams(window.location.search);
  const fallbackIntent = parsePopupLaunchFallback(urlParameters);
  const isFallbackWindow = fallbackIntent !== null;

  if (isFallbackWindow) {
    document.documentElement.dataset.popupWindow = 'fallback';
  }

  performance.mark('cc:popup-start', { startTime: 0 });
  const cachedTheme = readThemeCache();
  installProductFont(document, cachedTheme.fontFamily);
  installTabSwitcherKeyReleaseMonitor();
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(cachedTheme, systemDark);

  let popupRequestedAt: number | null = null;
  const fromUrl = urlParameters.get('mode');
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    return;
  }

  if (fromUrl === 'permission-request') {
    const allowedPermissions = new Set(['bookmarks', 'history', 'tabGroups', 'sessions', 'clipboardWrite']);
    const permissions = (urlParameters.get('permissions') ?? '')
      .split(',')
      .filter((permission) => allowedPermissions.has(permission)) as NonNullable<
      chrome.permissions.Permissions['permissions']
    >;

    createRoot(rootElement).render(createElement(StrictMode, null, createElement(PermissionRequest, { permissions })));

    return;
  }

  popupRequestedAt = fallbackIntent?.openedAt ?? null;

  let switcherAutoSwitchOnRelease = fallbackIntent?.autoSwitchOnRelease ?? false;
  let switcherModifierReleased = false;
  let switcherOpenedAt = fallbackIntent?.openedAt ?? 0;
  let storedMode: string | null = fallbackIntent?.mode ?? null;
  let initialTheme: ThemePreferences = cachedTheme;

  try {
    const [launchIntent, themeValues] = await Promise.all([
      consumePopupLaunchIntent(),
      chrome.storage.local.get(themePreferencesStorageKey),
    ]);

    storedMode = launchIntent.mode ?? storedMode;
    switcherAutoSwitchOnRelease = launchIntent.autoSwitchOnRelease ?? false;

    if (launchIntent.openedAt !== undefined) {
      popupRequestedAt = launchIntent.openedAt;
    }

    switcherOpenedAt = popupRequestedAt ?? 0;
    switcherModifierReleased = switcherAutoSwitchOnRelease && wasTabSwitcherModifierReleasedAfter(switcherOpenedAt);
    initialTheme = normalizeThemePreferences(themeValues[themePreferencesStorageKey] ?? defaultThemePreferences);
  } catch {
    // Cached appearance and the normal command mode keep the popup usable if storage is unavailable.
  }

  applyTheme(initialTheme, systemDark);

  const mode = resolvePaletteMode(fromUrl, storedMode);

  if (popupRequestedAt !== null && (mode === 'commands' || mode === 'tabs')) {
    guardShortcutChordOnOpen();
  }

  createRoot(rootElement).render(
    createElement(
      StrictMode,
      null,
      createElement(Popup, {
        initialMode: mode,
        initialTheme,
        initialSwitcherAutoSwitchOnRelease: switcherAutoSwitchOnRelease,
        initialSwitcherOpenedAt: switcherOpenedAt,
        initialSwitcherModifierReleased: switcherModifierReleased,
      }),
    ),
  );

  requestAnimationFrame(() => {
    const durationMs = popupRequestedAt === null ? performance.now() : Math.max(0, Date.now() - popupRequestedAt);
    const host = window as WindowWithCommandCenterTimings;

    const metrics = host.__commandCenterTimings ?? (host.__commandCenterTimings = []);
    metrics.push({ name: 'popup-first-frame', durationMs, at: Date.now() });

    if (metrics.length > 100) {
      metrics.splice(0, metrics.length - 100);
    }

    window.dispatchEvent(new Event('command-center:timing'));
    performance.mark('cc:first-frame');
    performance.measure('cc:popup-first-frame', 'cc:popup-start', 'cc:first-frame');
  });
};
