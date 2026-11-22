import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { ThemePreferences } from '@/types';
import type { PaletteTabsSnapshot } from '@/utils/paletteTabsSnapshot';
import type { TabSwitcherReleaseKey } from '@/utils/tabSwitcherKeyRelease';

export type OverlaySurface = 'commands' | 'tabs';

interface SurfaceThemeActions {
  theme: ThemePreferences;
  themeRoot: HTMLElement;
  onClose: () => void;
  tabsSnapshot: PaletteTabsSnapshot | null;
}

interface SurfaceActivationState {
  autoSwitchOnRelease: boolean;
  openedAt: number;
  modifierReleasedAtOpen: boolean;
  releaseKey: TabSwitcherReleaseKey | null;
  cycleVersion: number;
}

export interface SurfaceActions extends SurfaceThemeActions, SurfaceActivationState {}

export type SurfaceRenderer = (actions: SurfaceActions) => ReactNode;

export interface PageInertState {
  body: HTMLElement;
  wasInert: boolean;
}

interface SurfaceControllerMount {
  surface: OverlaySurface;
  host: HTMLElement;
  root: Root;
}

interface SurfaceControllerFocus {
  focusTarget: Element | null;
  focusTargetPreservedUntil: number;
  pageInertState: PageInertState | null;
}

interface SurfaceControllerLifecycle {
  bridge: SurfaceBridge;
  dispose: () => void;
}

export interface SurfaceController extends SurfaceControllerMount, SurfaceControllerFocus, SurfaceControllerLifecycle {}

interface SurfaceOpenHandlers {
  openHandler?: (autoSwitchOnRelease: boolean, openedAt: number, releaseKey: TabSwitcherReleaseKey | null) => void;
  closeHandler?: (switching: boolean) => void;
  cycleHandler?: (cycles: number) => void;
}

interface SurfaceStateHandlers {
  switcherOpenHandler?: () => boolean;
  surfaceOpenHandler?: () => boolean;
}

interface SurfacePendingState {
  pendingOpen: boolean;
  pendingAutoSwitchOnRelease: boolean;
  pendingOpenedAt: number;
  pendingReleaseKey: TabSwitcherReleaseKey | null;
  pendingTabsSnapshot: PaletteTabsSnapshot | null;
  pendingClose: boolean;
  pendingSwitching: boolean;
  pendingCycles: number;
}

export interface SurfaceBridge extends SurfaceOpenHandlers, SurfaceStateHandlers, SurfacePendingState {}

export interface OpenRequest {
  action?: string;
  mode?: string;
  switching?: boolean;
  autoSwitchOnRelease?: boolean;
  openedAt?: number;
  releaseKey?: TabSwitcherReleaseKey | null;
  cycles?: number;
  tabsSnapshot?: PaletteTabsSnapshot | null;
}

export interface CreatedOverlayHost {
  host: HTMLElement;
  mountPoint: HTMLElement;
}
