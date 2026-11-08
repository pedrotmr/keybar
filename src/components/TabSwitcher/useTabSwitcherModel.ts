import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { sendBackground } from '@/utils/chromeHelpers';
import type { ManagedTab } from '@/utils/tabItems';
import { isTabSwitcherModifierKey, wasTabSwitcherModifierReleasedAfter } from '@/utils/tabSwitcherKeyRelease';
import { optionId } from './helpers';
import type { TabSwitcherProps } from './types';

export const useTabSwitcherModel = ({
  onClose,
  autoSwitchOnRelease = false,
  openedAt = 0,
  modifierReleasedAtOpen = false,
  surface = 'popup',
  cycleVersion = 0,
}: TabSwitcherProps) => {
  const onCloseRef = useRef(onClose);
  const [tabs, setTabs] = useState<ManagedTab[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);

  const listboxRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLParagraphElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const previousCycleVersion = useRef(cycleVersion);
  const cycleVersionRef = useRef(cycleVersion);
  const selectedTabRef = useRef<ManagedTab | undefined>(undefined);

  const currentTabIdRef = useRef<number | null>(null);
  const modifierReleasedRef = useRef(false);
  const autoActivationAttemptedRef = useRef(false);
  const activateAfterShortcutRef = useRef<(tab: ManagedTab | undefined) => void>(() => undefined);

  const activationInFlightRef = useRef(false);
  const windowIdRef = useRef<number | undefined>(undefined);
  const switcherShownRef = useRef(false);

  const selectedTab = tabs[selectedIndex];
  const activeDescendant = selectedTab?.id === undefined ? undefined : optionId(selectedTab.id);
  const stateMessage = message || (loading ? 'Loading recent tabs…' : 'No recent tabs are available.');
  const cardCount = Math.max(1, tabs.length);
  const panelWidth = cardCount * 278 + (cardCount - 1) * 7 + 22;
  const hasTabs = tabs.length > 0;

  const hideSwitcher = (): void => {
    switcherShownRef.current = false;
    void sendBackground('tabs:switcher-hidden', { windowId: windowIdRef.current }).catch(() => undefined);
  };

  const closeSwitcher = (): void => {
    hideSwitcher();
    onCloseRef.current();
  };

  const refreshAfterFailedActivation = async (): Promise<void> => {
    setMessage('That tab may have closed. Refreshing recent tabs.');

    try {
      const [recentTabs, current] = await Promise.all([sendBackground('tabs:recent'), sendBackground('tabs:current')]);

      setTabs(recentTabs);
      setCurrentTabId(current?.id ?? null);
      currentTabIdRef.current = current?.id ?? null;

      const nextIndex = recentTabs.findIndex((tab) => tab.id !== current?.id);
      const resolvedIndex = nextIndex >= 0 ? nextIndex : 0;
      selectedTabRef.current = recentTabs[resolvedIndex];
      setSelectedIndex(resolvedIndex);
      setMessage(recentTabs.length ? 'Recent tabs updated. Choose a tab to switch.' : 'No recent tabs are available.');
    } catch {
      setMessage('Could not refresh recent tabs. Close and reopen the switcher to try again.');
    }
  };

  const selectIndex = (index: number): void => {
    if (!tabs.length) {
      return;
    }

    setMessage('');

    const nextIndex = (index + tabs.length) % tabs.length;
    selectedTabRef.current = tabs[nextIndex];
    setSelectedIndex(nextIndex);
  };

  const activate = async (tab: ManagedTab): Promise<boolean> => {
    if (tab.id === undefined || activationInFlightRef.current) {
      return false;
    }

    activationInFlightRef.current = true;
    setMessage('');

    try {
      await sendBackground('tabs:activate', { tabId: tab.id, sourceTabId: currentTabIdRef.current });
      closeSwitcher();
      return true;
    } catch {
      activationInFlightRef.current = false;
      await refreshAfterFailedActivation();
      return false;
    }
  };

  const activateAfterShortcut = (tab: ManagedTab | undefined): void => {
    if (!autoSwitchOnRelease || autoActivationAttemptedRef.current || !tab || tab.id === undefined) {
      return;
    }

    autoActivationAttemptedRef.current = true;

    void activate(tab).then((activated) => {
      if (!activated) {
        autoActivationAttemptedRef.current = false;
      }
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();

    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        closeSwitcher();
        break;

      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectIndex(selectedIndex + 1);
        break;

      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectIndex(selectedIndex - 1);
        break;

      case 'Home':
        event.preventDefault();
        selectIndex(0);
        break;

      case 'End':
        event.preventDefault();
        selectIndex(tabs.length - 1);
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();

        if (selectedTab) {
          void activate(selectedTab);
        }

        break;

      case 'Tab':
        event.preventDefault();
        (listboxRef.current ?? stateRef.current)?.focus({ preventScroll: true });
        break;
    }
  };

  useLayoutEffect(() => {
    (listboxRef.current ?? stateRef.current)?.focus({ preventScroll: true });
  }, [hasTabs]);

  useLayoutEffect(() => {
    selectedTabRef.current = selectedTab;
  }, [selectedTab]);

  useLayoutEffect(() => {
    cycleVersionRef.current = cycleVersion;
  }, [cycleVersion]);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    activateAfterShortcutRef.current = activateAfterShortcut;
  });

  useLayoutEffect(() => {
    if (!autoSwitchOnRelease) {
      return;
    }

    if (modifierReleasedAtOpen || wasTabSwitcherModifierReleasedAfter(openedAt)) {
      modifierReleasedRef.current = true;
    }

    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (!event.isTrusted || !isTabSwitcherModifierKey(event.key)) {
        return;
      }

      event.preventDefault();
      modifierReleasedRef.current = true;
      activateAfterShortcutRef.current(selectedTabRef.current);
    };

    window.addEventListener('keyup', onKeyUp, true);
    return () => window.removeEventListener('keyup', onKeyUp, true);
  }, [autoSwitchOnRelease, openedAt, modifierReleasedAtOpen]);

  useEffect(() => {
    let mounted = true;
    const handlePageHide = () => hideSwitcher();
    window.addEventListener('pagehide', handlePageHide);

    void Promise.all([sendBackground('tabs:recent'), sendBackground('tabs:current')])
      .then(async ([recentTabs, current]) => {
        if (!mounted) {
          return;
        }

        const currentId = current?.id ?? null;
        setCurrentTabId(currentId);
        currentTabIdRef.current = currentId;
        windowIdRef.current = current?.windowId;

        switcherShownRef.current = true;
        const opened = await sendBackground('tabs:switcher-shown', {
          windowId: current?.windowId,
          surface,
        }).catch(() => ({ pendingCycles: 0 }));

        if (!mounted) {
          switcherShownRef.current = false;
          await sendBackground('tabs:switcher-hidden', { windowId: windowIdRef.current }).catch(() => undefined);
          return;
        }

        const previousTabIndex = recentTabs.findIndex((tab) => tab.id !== currentId);
        const firstIndex = previousTabIndex >= 0 ? previousTabIndex : 0;
        const pendingCycles =
          Math.max(0, Number(opened.pendingCycles ?? 0)) +
          Math.max(0, cycleVersionRef.current - previousCycleVersion.current);

        previousCycleVersion.current = cycleVersionRef.current;
        const nextIndex = recentTabs.length ? (firstIndex + pendingCycles) % recentTabs.length : 0;
        selectedTabRef.current = recentTabs[nextIndex];
        setTabs(recentTabs);
        setSelectedIndex(nextIndex);

        if (modifierReleasedRef.current) {
          activateAfterShortcutRef.current(recentTabs[nextIndex]);
        }

        void sendBackground('tabs:recent-previews', {
          tabIds: recentTabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
        })
          .then((previews) => {
            if (!mounted) {
              return;
            }

            setTabs((currentTabs) =>
              currentTabs.map((tab) => ({
                ...tab,
                previewDataUrl: tab.id === undefined ? undefined : previews[tab.id],
              })),
            );
          })
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (mounted) {
          console.error('Tab Switcher initialization failed.', error);
          setMessage('Could not load recent tabs. Close and reopen the switcher to try again.');
          hideSwitcher();
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
      window.removeEventListener('pagehide', handlePageHide);
      hideSwitcher();
    };
  }, [surface]);

  useEffect(() => {
    if (cycleVersion === previousCycleVersion.current || tabs.length < 2) {
      return;
    }

    const cycles = cycleVersion - previousCycleVersion.current;
    previousCycleVersion.current = cycleVersion;
    const nextIndex = (((selectedIndex + cycles) % tabs.length) + tabs.length) % tabs.length;
    selectedTabRef.current = tabs[nextIndex];
    setSelectedIndex(nextIndex);
  }, [cycleVersion, selectedIndex, tabs]);

  const listLabel = 'Most recently used tabs in this window';

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      (listboxRef.current ?? stateRef.current)?.focus({ preventScroll: true });
    }
  };

  const handlePanelMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      listboxRef.current?.focus({ preventScroll: true });
    }
  };

  const handleEmptyPanelMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    stateRef.current?.focus({ preventScroll: true });
  };

  const handleCardPointerMove = (event: PointerEvent<HTMLDivElement>, tab: ManagedTab, index: number): void => {
    const previous = lastPointerRef.current;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };

    if (!previous || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 2) {
      if (selectedIndex !== index) {
        setMessage('');
        selectedTabRef.current = tab;
        setSelectedIndex(index);
      }
    }
  };

  return {
    tabs,
    selectedIndex,
    currentTabId,
    message,
    listboxRef,
    stateRef,
    activeDescendant,
    stateMessage,
    cardCount,
    panelWidth,
    hasTabs,
    handleKeyDown,
    handleOverlayMouseDown,
    handlePanelMouseDown,
    handleEmptyPanelMouseDown,
    handleCardPointerMove,
    activate,
    listLabel,
  };
};
