import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHost, hideHost, setPageInert } from './host';
import { attachOverlayListeners } from './listeners';
import { installTabSwitcherKeyReleaseMonitor } from '@/utils/tabSwitcherKeyRelease';
import { OverlayFrame } from './OverlayFrame/OverlayFrame';
import type { OverlaySurface, SurfaceBridge, SurfaceController, SurfaceRenderer } from './types';

const hostId = `${chrome.runtime.id}-command-center-surface`;
const controllerKey = `__commandCenterSurface_${chrome.runtime.id}`;
const sharedWindow = window as unknown as Window & Record<string, unknown>;

installTabSwitcherKeyReleaseMonitor();

export const mountOverlaySurface = (surface: OverlaySurface, styles: string, renderSurface: SurfaceRenderer): void => {
  sharedWindow.__commandCenterOverlayStyles = styles;
  const previous = sharedWindow[controllerKey] as SurfaceController | undefined;

  if (previous) {
    previous.dispose();
  }

  document.getElementById(hostId)?.remove();

  const { host, mountPoint } = createHost(hostId, sharedWindow.__commandCenterOverlayStyles as string);
  const root = createRoot(mountPoint);
  const bridge: SurfaceBridge = {
    pendingOpen: false,
    pendingAutoSwitchOnRelease: false,
    pendingOpenedAt: 0,
    pendingReleaseKey: null,
    pendingClose: false,
    pendingSwitching: false,
    pendingCycles: 0,
  };

  let removeListeners = () => {};

  const controller: SurfaceController = {
    surface,
    host,
    root,
    focusTarget: previous?.focusTarget ?? null,
    focusTargetPreservedUntil: previous?.focusTargetPreservedUntil ?? 0,
    pageInertState: null,
    bridge,
    dispose: () => {
      removeListeners();
      hideHost(host);
      setPageInert(controller, false);
      root.unmount();
      host.remove();
    },
  };

  sharedWindow[controllerKey] = controller;
  removeListeners = attachOverlayListeners(controller, mountPoint);
  root.render(createElement(StrictMode, null, createElement(OverlayFrame, { controller, renderSurface })));
};
