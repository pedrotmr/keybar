import type { ManagedTab } from '@/utils/tabItems';

export const PALETTE_TABS_SNAPSHOT_KEY = 'paletteTabsSnapshot';

export type PaletteTabsSnapshot = {
  tabs: ManagedTab[];
  currentTabId: number | null;
  currentWindowId: number | null;
};

export const isPaletteTabsSnapshot = (value: unknown): value is PaletteTabsSnapshot => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as PaletteTabsSnapshot;
  return Array.isArray(candidate.tabs);
};
