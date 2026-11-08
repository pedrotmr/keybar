import type { PaletteMode } from '@/types';
import { wasCommandPaletteEscapeHandled } from '@/utils/escapeEvents';
import { hideHost, setPageInert, showHost } from './host';
import type { OpenRequest, SurfaceController } from './types';

export const attachOverlayListeners = (controller: SurfaceController, mountPoint: HTMLElement): (() => void) => {
  const { bridge, host, surface } = controller;

  const onMessage = (
    message: OpenRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (!message || typeof message !== 'object') {
      return false;
    }

    if (message.action === 'ui:tabs-cycle') {
      const cycles = Math.max(1, Math.min(64, Math.floor(Number(message.cycles) || 1)));

      if (bridge.cycleHandler) {
        bridge.cycleHandler(cycles);
      } else {
        bridge.pendingCycles += cycles;
      }

      sendResponse({ success: true });
      return false;
    }

    if (message.action === 'tabs:switcher-status') {
      sendResponse({ open: bridge.switcherOpenHandler?.() ?? false });
      return false;
    }

    if (message.action === 'overlay:surface-status') {
      sendResponse({ open: bridge.surfaceOpenHandler?.() ?? false, surface });
      return false;
    }

    if (message.action === 'overlay:close') {
      const wasOpen = bridge.surfaceOpenHandler?.() ?? bridge.pendingOpen;

      if (bridge.closeHandler) {
        bridge.closeHandler(Boolean(message.switching));
      } else {
        bridge.pendingOpen = false;
        bridge.pendingClose = true;
        bridge.pendingSwitching = Boolean(message.switching);
        hideHost(host);
        setPageInert(controller, false);
      }

      sendResponse({ success: true, wasOpen });
      return false;
    }

    const requestedSurface: PaletteMode = message.mode === 'tabs' ? 'tabs' : 'commands';

    if (message.action !== 'overlay:open' || requestedSurface !== surface) {
      return false;
    }

    const openedAt = Number.isFinite(message.openedAt) ? Number(message.openedAt) : Date.now();

    if (bridge.openHandler) {
      bridge.openHandler(Boolean(message.autoSwitchOnRelease), openedAt);
    } else {
      bridge.pendingClose = false;
      bridge.pendingOpen = true;
      bridge.pendingAutoSwitchOnRelease = Boolean(message.autoSwitchOnRelease);
      bridge.pendingOpenedAt = openedAt;
      showHost(host);
      setPageInert(controller, true);
    }

    sendResponse({ success: true });
    return false;
  };

  const isUnmodifiedPrintableKey = (event: globalThis.KeyboardEvent): boolean => {
    return event.isTrusted && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
  };

  const closeOnEscape = (event: globalThis.KeyboardEvent) => {
    if (!event.isTrusted) {
      return;
    }

    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.key !== 'Escape' ||
      mountPoint.querySelector('dialog[open]')
    ) {
      return;
    }

    if (!bridge.pendingOpen && bridge.surfaceOpenHandler?.() !== true) {
      return;
    }

    window.setTimeout(() => {
      if (wasCommandPaletteEscapeHandled(event) || mountPoint.querySelector('dialog[open]')) {
        return;
      }

      if (!bridge.pendingOpen && bridge.surfaceOpenHandler?.() !== true) {
        return;
      }

      if (bridge.closeHandler) {
        bridge.closeHandler(false);
      } else {
        bridge.pendingOpen = false;
        bridge.pendingClose = true;
        bridge.pendingSwitching = false;

        hideHost(host);
        setPageInert(controller, false);
      }
    }, 0);
  };

  const isolateOverlayKeyboardEvent = (event: globalThis.KeyboardEvent) => {
    if (
      !isUnmodifiedPrintableKey(event) ||
      bridge.surfaceOpenHandler?.() !== true ||
      !event.composedPath().includes(host)
    ) {
      return;
    }

    const shadowRoot = mountPoint.getRootNode();
    const activeElement = shadowRoot instanceof ShadowRoot ? shadowRoot.activeElement : null;

    if (activeElement instanceof Element && mountPoint.contains(activeElement)) {
      const isolatedEvent = new KeyboardEvent(event.type, {
        key: event.key,
        code: event.code,
        location: event.location,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        charCode: event.charCode,
        keyCode: event.keyCode,
        which: event.which,
        bubbles: true,
        cancelable: event.cancelable,
        composed: false,
      });

      activeElement.dispatchEvent(isolatedEvent);

      if (isolatedEvent.defaultPrevented) {
        event.preventDefault();
      }
    }

    event.stopImmediatePropagation();
  };

  window.addEventListener('keydown', isolateOverlayKeyboardEvent, true);
  window.addEventListener('keypress', isolateOverlayKeyboardEvent, true);
  window.addEventListener('keyup', isolateOverlayKeyboardEvent, true);
  window.addEventListener('keydown', closeOnEscape, true);
  chrome.runtime.onMessage.addListener(onMessage);

  return () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener('keydown', isolateOverlayKeyboardEvent, true);
    window.removeEventListener('keypress', isolateOverlayKeyboardEvent, true);
    window.removeEventListener('keyup', isolateOverlayKeyboardEvent, true);
    window.removeEventListener('keydown', closeOnEscape, true);
  };
};
