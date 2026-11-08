import { useEffect, useRef, useState } from 'react';
import { applyTheme, defaultThemePreferences, normalizeThemePreferences, themePreferencesStorageKey } from '@/themes';
import type { ThemePreferences } from '@/types';
import { loadProductFontForPage } from '@/utils/installProductFont';
import { wasTabSwitcherModifierReleasedAfter } from '@/utils/tabSwitcherKeyRelease';
import { hideHost, setPageInert, showHost } from '../host';
import type { SurfaceController } from '../types';

interface OverlayFrameState {
  isOpen: boolean;
  theme: ThemePreferences;
  closeSurface: () => void;
  autoSwitchOnRelease: boolean;
  openedAt: number;
  modifierReleasedAtOpen: boolean;
  cycleVersion: number;
}

export const useOverlayFrame = (controller: SurfaceController): OverlayFrameState => {
  const [isOpen, setIsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreferences>(defaultThemePreferences);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [autoSwitchOnRelease, setAutoSwitchOnRelease] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const [modifierReleasedAtOpen, setModifierReleasedAtOpen] = useState(false);
  const [cycleVersion, setCycleVersion] = useState(0);

  const isOpenRef = useRef(false);
  const openRequestVersion = useRef(0);

  const closeSurface = () => {
    controller.bridge.closeHandler?.(false);
  };

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = () => setSystemDark(query.matches);

    query.addEventListener('change', onSchemeChange);

    return () => query.removeEventListener('change', onSchemeChange);
  }, []);

  useEffect(() => {
    const onStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local' || !changes[themePreferencesStorageKey]) {
        return;
      }

      setTheme(normalizeThemePreferences(changes[themePreferencesStorageKey].newValue ?? defaultThemePreferences));
    };

    chrome.storage.onChanged.addListener(onStorageChange);

    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  useEffect(() => {
    applyTheme(theme, systemDark, controller.host);

    if (isOpen) {
      void loadProductFontForPage(controller.host.ownerDocument, theme.fontFamily).catch((error: unknown) => {
        console.warn(`[Keybar] Failed to load ${theme.fontFamily} font for the page overlay.`, error);
      });
    }
  }, [theme, systemDark, controller.host, isOpen]);

  useEffect(() => {
    const openSurface = (shouldAutoSwitchOnRelease: boolean, requestOpenedAt: number) => {
      if (isOpenRef.current) {
        if (controller.surface === 'tabs') {
          setCycleVersion((version) => version + 1);
        }

        return;
      }

      isOpenRef.current = true;
      const requestVersion = ++openRequestVersion.current;
      const launchTime = Number.isFinite(requestOpenedAt) && requestOpenedAt > 0 ? requestOpenedAt : Date.now();
      setAutoSwitchOnRelease(shouldAutoSwitchOnRelease);
      setOpenedAt(launchTime);
      setModifierReleasedAtOpen(shouldAutoSwitchOnRelease && wasTabSwitcherModifierReleasedAfter(launchTime));

      if (
        !controller.focusTarget ||
        Date.now() > controller.focusTargetPreservedUntil ||
        !controller.focusTarget.isConnected
      ) {
        let focused = document.activeElement;

        while (focused?.shadowRoot?.activeElement) {
          focused = focused.shadowRoot.activeElement;
        }

        controller.focusTarget = focused;
      }

      controller.focusTargetPreservedUntil = 0;
      showHost(controller.host);
      setPageInert(controller, true);
      void chrome.storage.local
        .get(themePreferencesStorageKey)
        .then((values) => {
          if (!isOpenRef.current || requestVersion !== openRequestVersion.current) {
            return;
          }

          setTheme(normalizeThemePreferences(values[themePreferencesStorageKey] ?? defaultThemePreferences));
          setIsOpen(true);
        })
        .catch(() => {
          if (isOpenRef.current && requestVersion === openRequestVersion.current) {
            setIsOpen(true);
          }
        });
    };

    const closeSurfaceWithSwitching = (switching: boolean) => {
      openRequestVersion.current++;
      isOpenRef.current = false;
      setIsOpen(false);
      hideHost(controller.host);
      setPageInert(controller, false);
      const target = controller.focusTarget;

      if (switching) {
        controller.focusTargetPreservedUntil = Date.now() + 1600;
        return;
      }

      controller.focusTarget = null;
      controller.focusTargetPreservedUntil = 0;

      if (target instanceof HTMLElement && target.isConnected) {
        const closeVersion = openRequestVersion.current;
        requestAnimationFrame(() => {
          if (!isOpenRef.current && closeVersion === openRequestVersion.current && target.isConnected) {
            target.focus({ preventScroll: true });
          }
        });
      }
    };

    controller.bridge.openHandler = openSurface;
    controller.bridge.closeHandler = closeSurfaceWithSwitching;

    controller.bridge.cycleHandler = (cycles) => {
      if (isOpenRef.current && controller.surface === 'tabs') {
        setCycleVersion((version) => version + cycles);
      } else {
        controller.bridge.pendingCycles += cycles;
      }
    };

    controller.bridge.switcherOpenHandler = () => isOpenRef.current && controller.surface === 'tabs';
    controller.bridge.surfaceOpenHandler = () => isOpenRef.current;

    if (controller.bridge.pendingOpen) {
      controller.bridge.pendingOpen = false;
      openSurface(controller.bridge.pendingAutoSwitchOnRelease, controller.bridge.pendingOpenedAt);
      controller.bridge.pendingAutoSwitchOnRelease = false;
      controller.bridge.pendingOpenedAt = 0;
    }

    if (controller.bridge.pendingCycles) {
      const cycles = controller.bridge.pendingCycles;
      controller.bridge.pendingCycles = 0;
      setCycleVersion((version) => version + cycles);
    }

    if (controller.bridge.pendingClose) {
      controller.bridge.pendingClose = false;
      closeSurfaceWithSwitching(controller.bridge.pendingSwitching);
    }

    return () => {
      controller.bridge.openHandler = undefined;
      controller.bridge.closeHandler = undefined;
      controller.bridge.cycleHandler = undefined;
      controller.bridge.switcherOpenHandler = undefined;
      controller.bridge.surfaceOpenHandler = undefined;
    };
  }, [controller]);

  return { isOpen, theme, closeSurface, autoSwitchOnRelease, openedAt, modifierReleasedAtOpen, cycleVersion };
};
