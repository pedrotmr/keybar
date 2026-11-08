import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ThemePreferences } from '@/types';
import { applyTheme, cacheThemePreferences, normalizeThemePreferences } from '@/themes';

interface UsePaletteAppearanceOptions {
  initialPreferences: ThemePreferences;
  themeRoot?: HTMLElement;
  cacheInLocalStorage: boolean;
}

export const usePaletteAppearance = ({
  initialPreferences,
  themeRoot,
  cacheInLocalStorage,
}: UsePaletteAppearanceOptions) => {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const systemAppearance = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [systemDark, setSystemDark] = useState(systemAppearance.matches);

  useEffect(() => {
    const updateSystemAppearance = () => setSystemDark(systemAppearance.matches);
    systemAppearance.addEventListener('change', updateSystemAppearance);
    return () => systemAppearance.removeEventListener('change', updateSystemAppearance);
  }, [systemAppearance]);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    applyTheme(preferences, systemDark, themeRoot);

    if (cacheInLocalStorage) {
      cacheThemePreferences(preferences);
    }
  }, [preferences, systemDark, themeRoot, cacheInLocalStorage]);

  useEffect(() => {
    const onPreferencesChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.themePreferences) {
        setPreferences(normalizeThemePreferences(changes.themePreferences.newValue));
      }
    };

    chrome.storage.onChanged.addListener(onPreferencesChanged);
    return () => chrome.storage.onChanged.removeListener(onPreferencesChanged);
  }, []);

  const updatePreferences = useCallback(
    (next: ThemePreferences): ThemePreferences => {
      const normalized = normalizeThemePreferences(next);
      setPreferences(normalized);
      applyTheme(normalized, systemDark, themeRoot);
      return normalized;
    },
    [systemDark, themeRoot],
  );

  return { preferences, viewport, updatePreferences };
};
