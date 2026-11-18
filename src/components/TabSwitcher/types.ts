import type { TabSwitcherReleaseKey } from '@/utils/tabSwitcherKeyRelease';

export interface TabSwitcherProps {
  onClose: () => void;
  autoSwitchOnRelease?: boolean;
  openedAt?: number;
  modifierReleasedAtOpen?: boolean;
  releaseKey?: TabSwitcherReleaseKey | null;
  surface?: 'popup' | 'overlay';
  cycleVersion?: number;
}
