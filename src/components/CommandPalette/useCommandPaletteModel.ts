import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CommandItem, PaletteItem, ThemePreferences } from '@/types';
import { useSavedPages } from './useSavedPages';
import { usePaletteTabs } from './usePaletteTabs';
import { getCommands } from '@/utils/commands';
import { bulkCloseTabIds, isBulkCloseAction } from '@/utils/bulkClose';
import { normalizeNavigationUrl, sendBackground } from '@/utils/chromeHelpers';
import { writeClipboardText } from '@/utils/clipboard';
import { findSearchProvider, parseProviderQuery } from '@/utils/searchProviders';
import type { SearchProviderDefinition } from '@/utils/searchProviders';
import { isTabInSplitView } from '@/utils/splitViews';
import { TAB_GROUP_ID_NONE } from '@/utils/chromeApiConstants';
import { initialCommandItems, toTabItems } from '@/utils/tabItems';
import type { ManagedTab } from '@/utils/tabItems';
import { markCommandPaletteEscape } from '@/utils/escapeEvents';
import type { ActionDockItem } from '../ActionDock/types';
import {
  actionDockId,
  findPaletteResults,
  getConfirmCloseTitle,
  getEmptyState,
  getLiveStatusText,
  getOpenErrorMessage,
  initialResultLimit,
  isTabActionsShortcut,
  recordTiming,
  resultPageSize,
  tabbableSelector,
} from './helpers';
import type { ActionDockState, CommandPaletteMode, CommandPaletteProps, FlowDialog, ToastMessage } from './types';
import { usePaletteAppearance } from './usePaletteAppearance';

export const useCommandPaletteModel = ({
  initialMode,
  initialTheme,
  surface = 'popup',
  onClose,
  themeRoot,
  cacheThemeInLocalStorage = true,
}: CommandPaletteProps) => {
  const [mode, setMode] = useState<CommandPaletteMode>(initialMode);
  const [query, setQuery] = useState('');
  const [activeProvider, setActiveProvider] = useState<SearchProviderDefinition | null>(null);
  const providerOriginQuery = useRef('');

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [keyboardNavigationVersion, setKeyboardNavigationVersion] = useState(0);

  const [windows, setWindows] = useState<chrome.windows.Window[]>([]);

  const [dialog, setDialog] = useState<FlowDialog | null>(null);
  const [actionDock, setActionDock] = useState<ActionDockState | null>(null);

  const [renameValue, setRenameValue] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupColor, setGroupColor] = useState('blue');
  const [groupTargetId, setGroupTargetId] = useState('new');
  const [moveWindowId, setMoveWindowId] = useState('new');

  const { preferences, viewport, updatePreferences } = usePaletteAppearance({
    initialPreferences: initialTheme,
    themeRoot,
    cacheInLocalStorage: cacheThemeInLocalStorage,
  });

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [dialogError, setDialogError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const commandCenterRef = useRef<HTMLDivElement>(null);
  const settingsViewRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const moveWindowSelectRef = useRef<HTMLSelectElement>(null);
  const groupNameInputRef = useRef<HTMLInputElement>(null);
  const groupTargetSelectRef = useRef<HTMLSelectElement>(null);
  const closeConfirmationCancelRef = useRef<HTMLButtonElement>(null);
  const actionDockReturnFocus = useRef<HTMLElement | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastDismissRef = useRef<HTMLButtonElement>(null);
  const handoffPending = useRef(false);
  const executionPending = useRef(false);
  const dialogPending = useRef(false);

  const restorePaletteFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const focusTarget = mode === 'settings' ? settingsViewRef.current : inputRef.current;

      if (focusTarget?.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    });
  }, [mode]);

  const notify = useCallback(
    (message: string, tone: ToastMessage['tone'] = 'error') => {
      setToast({ message, tone });

      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }

      toastTimer.current =
        tone === 'success'
          ? setTimeout(() => {
              const restoreFocus = toastDismissRef.current?.matches(':focus') ?? false;
              setToast(null);
              toastTimer.current = null;

              if (restoreFocus) {
                restorePaletteFocus();
              }
            }, 4000)
          : null;
    },
    [restorePaletteFocus],
  );

  const {
    tabs,
    tabsReady,
    currentTabId,
    currentWindowId,
    permissions,
    setPermissions,
    groups,
    setGroups,
    splitCapabilities,
    refreshTabs,
  } = usePaletteTabs({ surface, notify });
  const { bookmarks, history, localDataLoading, localDataLoaded, loadLocalData } = useSavedPages(permissions, notify);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const dialogElement = dialogRef.current;
    let effectCancelled = false;

    if (dialog && dialogElement) {
      if (!dialogElement.open) {
        dialogElement.showModal();
      }

      requestAnimationFrame(() => {
        if (effectCancelled || !dialogRef.current?.open) {
          return;
        }

        if (dialog.kind === 'move') {
          moveWindowSelectRef.current?.focus();
        } else if (dialog.kind === 'assign-group') {
          groupTargetSelectRef.current?.focus();
        } else if (dialog.kind === 'group') {
          groupNameInputRef.current?.focus();
        } else if (dialog.kind === 'confirm-close') {
          closeConfirmationCancelRef.current?.focus();
        } else {
          renameInputRef.current?.focus();
        }
      });

      return () => {
        effectCancelled = true;
      };
    }

    if (dialogElement?.open) {
      dialogElement.close();
    }

    requestAnimationFrame(() => {
      if (effectCancelled || dialogRef.current?.open || actionDock) {
        return;
      }

      const commandCenter = commandCenterRef.current;
      const root = commandCenter?.getRootNode();
      const activeElement = (root as Document | ShadowRoot | undefined)?.activeElement ?? document.activeElement;

      if (
        activeElement instanceof HTMLElement &&
        commandCenter?.contains(activeElement) &&
        !dialogElement?.contains(activeElement)
      ) {
        return;
      }

      const focusTarget = mode === 'settings' ? settingsViewRef.current : inputRef.current;

      if (focusTarget?.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    });

    return () => {
      effectCancelled = true;
    };
  }, [actionDock, dialog, mode]);

  useEffect(
    () => () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === currentTabId) ?? null, [tabs, currentTabId]);
  const activeGroup = useMemo(
    () => (activeTab ? (groups.find((group) => group.id === activeTab.groupId) ?? null) : null),
    [activeTab, groups],
  );

  const tabCountInWindow = activeTab ? tabs.filter((tab) => tab.windowId === activeTab.windowId).length : 0;
  const tabsToRightCount = activeTab
    ? tabs.filter((tab) => tab.windowId === activeTab.windowId && tab.index > activeTab.index).length
    : 0;

  const activeGroupTabCount =
    activeTab?.groupId !== undefined && activeTab.groupId !== TAB_GROUP_ID_NONE
      ? tabs.filter((tab) => tab.groupId === activeTab.groupId).length
      : 0;

  const commands = useMemo(
    () =>
      getCommands({
        activeTab,
        activeGroup,
        tabCountInWindow,
        tabsToRightCount,
        activeGroupTabCount,
        canUnsplitTabs: splitCapabilities.unsplit,
      }),
    [activeTab, activeGroup, tabCountInWindow, tabsToRightCount, activeGroupTabCount, splitCapabilities.unsplit],
  );

  const tabItems = useMemo(
    () => toTabItems(tabs, currentTabId, currentWindowId),
    [tabs, currentTabId, currentWindowId],
  );

  const initialItems = useMemo(() => initialCommandItems(commands, tabItems), [commands, tabItems]);
  const uniqueHistory = useMemo(() => {
    const bookmarkedUrls = new Set(bookmarks.map((bookmark) => bookmark.url));
    return history.filter((item) => !bookmarkedUrls.has(item.url));
  }, [bookmarks, history]);

  const savedSearchPrompt = useMemo<CommandItem | null>(() => {
    const term = query.trim();

    if (
      !term ||
      mode !== 'commands' ||
      (permissions.has('bookmarks') && permissions.has('history') && (localDataLoaded || localDataLoading))
    ) {
      return null;
    }

    return {
      id: 'search-saved-pages',
      title: `Search bookmarks and history for “${term}”`,
      description:
        permissions.has('bookmarks') && permissions.has('history')
          ? 'Retry loading saved pages. Results already loaded remain available.'
          : 'Grant optional access to search saved pages and recent visits on this device.',
      subtitle:
        permissions.has('bookmarks') && permissions.has('history')
          ? 'Retry saved-page search'
          : 'Requires optional bookmarks and history access',
      category: 'Saved pages',
      icon: '⌕',
      type: 'command',
      action: '',
      flow: 'saved-search',
      permission: { permissions: ['bookmarks', 'history'] },
      keywords: [term, 'bookmarks', 'history', 'saved pages'],
    };
  }, [mode, query, permissions, localDataLoaded, localDataLoading]);

  const providerCandidate = useMemo(() => {
    const term = query.trim();

    if (mode !== 'commands' || activeProvider || parseProviderQuery(term)) {
      return null;
    }

    return findSearchProvider(term);
  }, [mode, query, activeProvider]);

  const sourceItems = useMemo<PaletteItem[]>(() => {
    if (mode === 'settings') {
      return [];
    }

    return [...commands, ...tabItems, ...bookmarks, ...uniqueHistory];
  }, [mode, commands, tabItems, bookmarks, uniqueHistory]);

  const isUnfilteredExpandedView =
    mode === 'commands' && preferences.windowMode === 'expanded' && !query.trim() && !activeProvider;

  const openingResultLimit = initialResultLimit(preferences.size, surface, viewport);

  const results = useMemo(() => {
    if (mode === 'commands' && preferences.windowMode === 'compact' && !query.trim() && !activeProvider) {
      return [];
    }

    if (mode === 'commands' && !query.trim() && !activeProvider && !tabsReady) {
      return [];
    }

    const start = performance.now();
    const allowFallback = !localDataLoading && !providerCandidate;
    const searchableItems = !query.trim() && mode === 'commands' ? initialItems : sourceItems;
    const found = findPaletteResults(activeProvider, query, mode, searchableItems, allowFallback);

    if (
      savedSearchPrompt &&
      !activeProvider &&
      !providerCandidate &&
      !parseProviderQuery(query) &&
      !normalizeNavigationUrl(query)
    ) {
      // Permission discovery must not take over the selected result or Enter action.
      found.push(savedSearchPrompt);
    }

    const visibleResults = isUnfilteredExpandedView ? found.slice(0, openingResultLimit) : found;
    const duration = performance.now() - start;

    if (mode !== 'settings' && query.trim()) {
      recordTiming('local-search', duration);
    }

    return visibleResults;
  }, [
    sourceItems,
    initialItems,
    query,
    mode,
    preferences.windowMode,
    openingResultLimit,
    isUnfilteredExpandedView,
    savedSearchPrompt,
    activeProvider,
    providerCandidate,
    localDataLoading,
    tabsReady,
  ]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
  const isCompactEmpty =
    mode === 'commands' && preferences.windowMode === 'compact' && !query.trim() && !activeProvider;

  const isLoadingInitialTabs =
    mode === 'commands' && preferences.windowMode === 'expanded' && !query.trim() && !activeProvider && !tabsReady;

  const showResults = mode === 'commands' && !isCompactEmpty;
  const selectedItem = showResults ? results[activeIndex] : undefined;
  const selectedTab =
    selectedItem?.type === 'tab' ? (tabs.find((tab) => tab.id === selectedItem.tabId) ?? null) : activeTab;

  const assignmentWindowId =
    dialog?.kind === 'assign-group' ? tabs.find((tab) => tab.id === dialog.tabId)?.windowId : undefined;

  const groupChoices =
    assignmentWindowId === undefined ? [] : groups.filter((group) => group.windowId === assignmentWindowId);

  const actionDockIndex = actionDock ? results.findIndex((item) => item.id === actionDock.itemId) : -1;
  const actionDockTab = actionDock ? (tabs.find((tab) => tab.id === actionDock.tabId) ?? null) : null;

  useEffect(() => {
    if (!actionDock) {
      return;
    }

    if (!showResults || actionDockIndex < 0 || !actionDockTab) {
      closeActionDock();
      return;
    }

    // The row that opened the dock stays selected, even when a tab refresh reorders the results.
    if (selectedIndex !== actionDockIndex) {
      setSelectedIndex(actionDockIndex);
    }
  }, [actionDock, actionDockIndex, actionDockTab, selectedIndex, showResults]);

  const selectFromKeyboard = (update: (index: number) => number): void => {
    setSelectedIndex(update);
    setKeyboardNavigationVersion((version) => version + 1);
  };

  const dismissToast = (restoreFocus = false): void => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }

    toastTimer.current = null;
    setToast(null);

    if (restoreFocus) {
      restorePaletteFocus();
    }
  };

  const changeMode = (nextMode: CommandPaletteMode): void => {
    setMode(nextMode);
    setQuery('');
    setActiveProvider(null);
    setSelectedIndex(0);

    requestAnimationFrame(() => {
      if (nextMode === 'settings') {
        settingsViewRef.current?.focus({ preventScroll: true });
      } else {
        inputRef.current?.focus({ preventScroll: true });
      }
    });
  };

  const closeSurface = (): void => {
    if (onClose) {
      onClose();
    } else {
      window.close();
    }
  };

  const handleSurfaceEscape = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (event.key !== 'Escape' || dialog) {
      return;
    }

    markCommandPaletteEscape(event.nativeEvent);
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();

    if (event.repeat) {
      return;
    }

    if (actionDock) {
      closeActionDock();
      return;
    }

    if (mode !== 'commands' || activeProvider || query.trim()) {
      changeMode('commands');
      return;
    }

    closeSurface();
  };

  const ensurePermissions = async (
    required: NonNullable<chrome.permissions.Permissions['permissions']>,
  ): Promise<boolean> => {
    const missing = required.filter((permission) => !permissions.has(permission));

    if (!missing.length) {
      return true;
    }

    try {
      if (surface === 'overlay') {
        await sendBackground('permissions:open-request', { permissions: missing });
        notify('Approve access in the Keybar window, then choose this command again.', 'success');
        return false;
      }

      const granted = await chrome.permissions.request({ permissions: missing });

      if (!granted) {
        const isSavedSearchPermission = missing.includes('bookmarks') || missing.includes('history');
        notify(
          isSavedSearchPermission
            ? 'Bookmarks and history access was declined. Commands and open tabs are still available.'
            : 'Permission declined. Other commands are still available.',
        );

        return false;
      }

      setPermissions((current) => new Set([...current, ...missing]));
      return true;
    } catch {
      notify('Chrome could not grant that permission.');
      return false;
    }
  };

  const ensureCommandPermission = async (command: CommandItem): Promise<boolean> => {
    return ensurePermissions(command.permission?.permissions ?? []);
  };

  const executeCommand = async (command: CommandItem): Promise<void> => {
    if (!(await ensureCommandPermission(command))) {
      return;
    }

    if (command.flow === 'settings') {
      changeMode('settings');
      return;
    }

    if (command.flow === 'saved-search') {
      dismissToast();
      await loadLocalData(new Set(['bookmarks', 'history']));
      return;
    }

    if (command.flow === 'confirm-close') {
      if (!activeTab?.id || !isBulkCloseAction(command.action)) return;
      const tabIds = bulkCloseTabIds(tabs, activeTab, command.action);
      const count = tabIds.length;

      if (!count) {
        return;
      }

      const title = getConfirmCloseTitle(command.action, count);

      dismissToast();
      setDialogError('');
      setDialog({
        kind: 'confirm-close',
        action: command.action,
        count,
        title,
        anchorTabId: activeTab.id,
        windowId: activeTab.windowId,
        tabIds,
      });
      return;
    }

    if (command.flow === 'rename-active' && activeTab?.id !== undefined) {
      openRename(activeTab);
      return;
    }

    if (command.flow === 'move-active' && activeTab?.id !== undefined) {
      openMove(activeTab);
      return;
    }

    if (command.flow === 'assign-group' && activeTab?.id !== undefined) {
      dismissToast();
      setDialogError('');

      const currentGroups = await sendBackground('groups:list').catch(() => []);
      setGroups(currentGroups);
      setGroupTargetId('new');
      setGroupName('');
      setGroupColor('blue');
      setDialog({ kind: 'assign-group', tabId: activeTab.id });
      return;
    }

    if (command.flow === 'group-active' && activeTab?.id !== undefined) {
      const currentGroups = permissions.has('tabGroups') ? groups : await sendBackground('groups:list').catch(() => []);

      const group = currentGroups.find((candidate) => candidate.id === activeTab.groupId) ?? activeGroup;
      dismissToast();
      setDialogError('');
      setGroups(currentGroups);

      setDialog({
        kind: 'group',
        groupId: group?.id ?? null,
        initialName: group?.title ?? '',
        initialColor: group?.color ?? 'blue',
      });
      setGroupName(group?.title ?? '');
      setGroupColor(group?.color ?? 'blue');
      return;
    }

    try {
      if (command.flow === 'toggle-group' && activeGroup) {
        await sendBackground('groups:update', { groupId: activeGroup.id, collapsed: !activeGroup.collapsed });
        await refreshTabs();
        notify(activeGroup.collapsed ? 'Tab group expanded.' : 'Tab group collapsed.', 'success');
        return;
      }

      if (command.action === 'tabs:copy-url' || command.action === 'tabs:copy-title') {
        const value = await sendBackground(command.action);

        if (!value) {
          throw new Error('There is nothing to copy from the current tab.');
        }

        await writeClipboardText(value);
        notify(command.action === 'tabs:copy-url' ? 'URL copied.' : 'Tab title copied.', 'success');
        return;
      }

      if (!command.action) {
        throw new Error('This command does not have a browser action.');
      }

      const started = performance.now();
      await sendBackground(command.action);
      recordTiming('browser-action', performance.now() - started);
      closeSurface();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The command failed.');
    }
  };

  const executeItem = async (item: PaletteItem): Promise<void> => {
    if (executionPending.current) return;
    executionPending.current = true;
    try {
      await executeItemOnce(item);
    } finally {
      executionPending.current = false;
    }
  };

  const executeItemOnce = async (item: PaletteItem): Promise<void> => {
    if (item.type === 'command') {
      await executeCommand(item);
      return;
    }

    if (item.type === 'tab') {
      const started = performance.now();

      try {
        await sendBackground('tabs:activate', { tabId: item.tabId, sourceTabId: currentTabId });
        recordTiming('tab-switch', performance.now() - started);
        closeSurface();
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not switch to that tab.');
      }

      return;
    }

    if ('url' in item) {
      // One handoff at a time: a second Enter or click must not open a duplicate tab while Chrome responds.
      if (handoffPending.current) {
        return;
      }

      handoffPending.current = true;

      try {
        const action =
          item.type === 'bookmark' || item.type === 'history' ? 'browser:open-saved-url' : 'browser:open-url';

        await sendBackground(action, { url: item.url });
        closeSurface();
      } catch (error) {
        notify(getOpenErrorMessage(error, item));
      } finally {
        handoffPending.current = false;
      }
    }
  };

  const activateProvider = (provider: SearchProviderDefinition): void => {
    providerOriginQuery.current = query;
    setActiveProvider(provider);
    setQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus({ preventScroll: true });
  };

  const returnToCommandSearch = (): void => {
    setActiveProvider(null);
    setQuery(providerOriginQuery.current);
    setSelectedIndex(0);
    inputRef.current?.focus({ preventScroll: true });
  };

  const tabForResult = (item: PaletteItem | undefined): ManagedTab | null => {
    if (item?.type !== 'tab') {
      return null;
    }

    return tabs.find((tab) => tab.id === item.tabId) ?? null;
  };

  const openRename = (tab: ManagedTab): void => {
    if (tab.id === undefined) {
      return;
    }

    dismissToast();
    setDialogError('');
    setRenameValue(tab.customName ?? '');
    setDialog({ kind: 'rename', tabId: tab.id, initialName: tab.customName ?? '' });
  };

  const openActionDock = (index: number, focusFirstItem: boolean): void => {
    const item = results[index];
    const tab = tabForResult(item);

    if (!item || tab?.id === undefined) {
      return;
    }

    if (!actionDock) {
      // Closing returns focus to the opener: the row's actions button, or the search field.
      const commandCenter = commandCenterRef.current;
      const opener = (commandCenter?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
      actionDockReturnFocus.current =
        opener instanceof HTMLElement && opener !== commandCenter && commandCenter?.contains(opener) ? opener : null;
    }

    dismissToast();
    setSelectedIndex(index);
    setActionDock({ itemId: item.id, tabId: tab.id, focusFirstItem });
  };

  const toggleActionDock = (index: number, focusFirstItem: boolean): void => {
    if (actionDock && results[index]?.id === actionDock.itemId) {
      closeActionDock();
    } else {
      openActionDock(index, focusFirstItem);
    }
  };

  const closeActionDock = (restoreFocus = true): void => {
    const opener = actionDockReturnFocus.current;
    actionDockReturnFocus.current = null;
    setActionDock(null);

    if (!restoreFocus) {
      return;
    }

    const focusTarget = opener?.isConnected ? opener : inputRef.current;
    focusTarget?.focus({ preventScroll: true });
  };

  const canSplitWithActiveTab = (tab: ManagedTab): boolean => {
    return Boolean(
      activeTab &&
      tab.id !== activeTab.id &&
      tab.windowId === activeTab.windowId &&
      tab.pinned === activeTab.pinned &&
      tab.groupId === activeTab.groupId &&
      !isTabInSplitView(tab) &&
      !isTabInSplitView(activeTab) &&
      Math.abs(tab.index - activeTab.index) === 1 &&
      splitCapabilities.create,
    );
  };

  const tabActionItems = (tab: ManagedTab): ActionDockItem[] => {
    // Each action closes the dock first; flows that continue in a dialog move focus there themselves.
    const run = (action: () => void | Promise<void>) => () => {
      closeActionDock();
      void action();
    };

    const items: ActionDockItem[] = [
      {
        id: 'move-window',
        label: 'Move to window',
        icon: 'window',
        opensDialog: true,
        onSelect: run(() => openMove(tab)),
      },
      {
        id: 'move-group',
        label: 'Move to tab group',
        icon: 'group',
        opensDialog: true,
        onSelect: run(() => openGroupAssignment(tab)),
      },
      { id: 'rename', label: 'Rename tab', icon: 'edit', opensDialog: true, onSelect: run(() => openRename(tab)) },
    ];

    if (canSplitWithActiveTab(tab)) {
      items.push({
        id: 'split',
        label: 'Split with current tab',
        icon: 'split',
        onSelect: run(() => splitWithActiveTab(tab)),
      });
    }

    items.push(
      {
        id: 'pin',
        label: tab.pinned ? 'Unpin tab' : 'Pin tab',
        icon: 'pin',
        startsGroup: true,
        onSelect: run(() => toggleSelectedPin(tab)),
      },
      {
        id: 'mute',
        label: tab.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab',
        icon: 'audio',
        onSelect: run(() => toggleSelectedMute(tab)),
      },
      {
        id: 'copy-url',
        label: 'Copy URL',
        icon: 'link',
        startsGroup: true,
        onSelect: run(() => copyTabValue(tab, 'url')),
      },
      { id: 'copy-title', label: 'Copy title', icon: 'copy', onSelect: run(() => copyTabValue(tab, 'title')) },
      {
        id: 'close',
        label: 'Close tab',
        icon: 'close',
        danger: true,
        startsGroup: true,
        onSelect: run(() => closeTab(tab)),
      },
    );

    return items;
  };

  const openMove = async (tab: ManagedTab): Promise<void> => {
    if (tab.id === undefined) {
      return;
    }

    dismissToast();
    setDialogError('');

    try {
      const availableWindows = await sendBackground('windows:list');
      setWindows(availableWindows.filter((item) => item.id !== tab.windowId && item.incognito === tab.incognito));
      setMoveWindowId('new');
      setDialog({ kind: 'move', tabId: tab.id });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load browser windows.');
    }
  };

  const openGroupAssignment = async (tab: ManagedTab): Promise<void> => {
    if (tab.id === undefined || !(await ensurePermissions(['tabGroups']))) {
      return;
    }

    dismissToast();
    setDialogError('');

    const currentGroups = await sendBackground('groups:list').catch(() => []);
    setGroups(currentGroups);
    setGroupTargetId('new');
    setGroupName('');
    setGroupColor('blue');
    setDialog({ kind: 'assign-group', tabId: tab.id });
  };

  const closeDialog = async (): Promise<void> => {
    if (dialogRef.current?.open) {
      dialogRef.current.close();
    }

    setDialog(null);
    setDialogError('');
  };

  const submitDialog = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setDialogError('');

    if (!dialog || dialogPending.current) {
      return;
    }

    dialogPending.current = true;
    try {
      if (dialog.kind === 'confirm-close') {
        await sendBackground('tabs:close-confirmed', {
          closeAction: dialog.action,
          anchorTabId: dialog.anchorTabId,
          windowId: dialog.windowId,
          tabIds: dialog.tabIds,
        });
        closeSurface();
        return;
      }

      if (dialog.kind === 'rename') {
        await sendBackground('tabs:rename', { tabId: dialog.tabId, name: renameValue });
        await refreshTabs();
        await closeDialog();
        notify(renameValue.trim() ? 'Tab name saved.' : 'Custom tab name removed.', 'success');
        return;
      }

      if (dialog.kind === 'move') {
        if (moveWindowId === 'new') {
          await sendBackground('tabs:move-new-window', { tabId: dialog.tabId });
        } else {
          await sendBackground('tabs:move', { tabId: dialog.tabId, windowId: Number(moveWindowId) });
        }

        closeSurface();
        return;
      }

      if (dialog.kind === 'assign-group') {
        if (groupTargetId === 'new') {
          await sendBackground('groups:create', { tabId: dialog.tabId, title: groupName, color: groupColor });
        } else {
          await sendBackground('tabs:group', { tabId: dialog.tabId, groupId: Number(groupTargetId) });
        }

        await refreshTabs();
        await closeDialog();
        notify(groupTargetId === 'new' ? 'Tab group created.' : 'Tab moved to group.', 'success');
        return;
      }

      if (dialog.kind === 'group') {
        if (dialog.groupId === null) {
          await sendBackground('groups:create-current', { title: groupName, color: groupColor });
        } else {
          await sendBackground('groups:update', { groupId: dialog.groupId, title: groupName, color: groupColor });
        }

        await refreshTabs();
        await closeDialog();
        notify(dialog.groupId === null ? 'Tab group created.' : 'Tab group updated.', 'success');
      }
    } catch (error) {
      if (dialog.kind === 'confirm-close') {
        await refreshTabs().catch(() =>
          notify('Could not refresh tabs. Close and reopen the Command Bar to try again.'),
        );
      }
      setDialogError(error instanceof Error ? error.message : 'Could not complete that action.');
    } finally {
      dialogPending.current = false;
    }
  };

  const toggleSelectedPin = async (tab: ManagedTab): Promise<void> => {
    if (tab.id === undefined) {
      return;
    }

    try {
      await sendBackground('tabs:pin', { tabId: tab.id, pinned: !tab.pinned });
      await refreshTabs();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not change the pin state.');
    }
  };

  const toggleSelectedMute = async (tab: ManagedTab): Promise<void> => {
    if (tab.id === undefined) {
      return;
    }

    try {
      await sendBackground('tabs:mute', { tabId: tab.id, muted: !tab.mutedInfo?.muted });
      await refreshTabs();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not change the audio state.');
    }
  };

  const copyTabValue = async (tab: ManagedTab, field: 'url' | 'title'): Promise<void> => {
    if (tab.id === undefined) {
      return;
    }

    if (!(await ensurePermissions(['clipboardWrite']))) {
      return;
    }

    try {
      const value = await sendBackground(`tabs:copy-${field}`, { tabId: tab.id });

      if (!value) {
        throw new Error(`This tab has no ${field} to copy.`);
      }

      await writeClipboardText(value);
      notify(field === 'url' ? 'Tab URL copied.' : 'Page title copied.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not copy this value.');
    }
  };

  const splitWithActiveTab = async (tab: ManagedTab): Promise<void> => {
    if (tab.id === undefined) {
      return;
    }

    try {
      await sendBackground('tabs:split-active', { tabId: tab.id });
      closeSurface();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create split view.');
    }
  };

  const closeTab = async (tab: ManagedTab): Promise<void> => {
    if (tab.id === undefined) {
      return;
    }

    try {
      await sendBackground('tabs:close', { tabId: tab.id });
      closeSurface();
    } catch {
      notify('Could not close that tab.');
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab' && !event.shiftKey && mode === 'commands' && !activeProvider) {
      const provider = findSearchProvider(query);

      if (provider) {
        event.preventDefault();
        activateProvider(provider);
        return;
      }
    }

    if (event.key === 'Backspace' && !query && activeProvider) {
      event.preventDefault();
      returnToCommandSearch();
      return;
    }

    if (event.key === 'Backspace' && (event.metaKey || event.ctrlKey) && query) {
      event.preventDefault();
      setQuery('');
      setSelectedIndex(0);
      return;
    }

    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      selectFromKeyboard((index) => Math.min(index + 1, results.length - 1));
      return;
    }

    if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      selectFromKeyboard((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Enter' && selectedItem) {
      event.preventDefault();
      void executeItem(selectedItem);
      return;
    }

    if (event.key === 'Enter' && providerCandidate) {
      event.preventDefault();
      activateProvider(providerCandidate);
    }
  };

  const handlePaletteKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();

    if (dialog) {
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(tabbableSelector) ?? []).filter(
          (element) => element.getClientRects().length > 0,
        );

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && event.target === first && last) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && event.target === last && first) {
          event.preventDefault();
          first.focus();
        }
      }

      return;
    }

    if (actionDock) {
      // The dock handles its own navigation; the actions shortcut closes it again.
      if (isTabActionsShortcut(event)) {
        event.preventDefault();
        closeActionDock();
      }

      return;
    }

    if (mode === 'settings' && event.key === 'Tab' && event.shiftKey && event.target === settingsViewRef.current) {
      const focusable = Array.from(
        commandCenterRef.current?.querySelectorAll<HTMLElement>(tabbableSelector) ?? [],
      ).filter((element) => element.getClientRects().length > 0);

      const last = focusable[focusable.length - 1];

      if (last) {
        event.preventDefault();
        last.focus();
      }

      return;
    }

    if (surface === 'overlay' && event.key === 'Tab') {
      const focusable = Array.from(
        commandCenterRef.current?.querySelectorAll<HTMLElement>(tabbableSelector) ?? [],
      ).filter((element) => element.getClientRects().length > 0);

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && event.target === first && last) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && event.target === last && first) {
        event.preventDefault();
        first.focus();
      }

      return;
    }

    if (event.key === 'F2' && selectedItem?.type === 'tab' && selectedTab) {
      event.preventDefault();
      openRename(selectedTab);
      return;
    }

    if (isTabActionsShortcut(event) && selectedItem?.type === 'tab' && selectedTab) {
      event.preventDefault();
      openActionDock(activeIndex, true);
      return;
    }

    if (
      (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      results.length &&
      event.target instanceof Element &&
      event.target.closest('.result-actions-trigger')
    ) {
      // From a row's actions button, arrows go back to moving the selection from the search field.
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      selectFromKeyboard((index) => Math.max(0, Math.min(index + step, results.length - 1)));
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    if ((event.key === 'PageDown' || event.key === 'PageUp') && mode !== 'settings' && results.length) {
      event.preventDefault();
      const resultsList = commandCenterRef.current?.querySelector<HTMLElement>('.results-list');

      if (resultsList) {
        const pageSize = resultPageSize(resultsList);
        const direction = event.key === 'PageDown' ? 1 : -1;
        selectFromKeyboard((index) => Math.max(0, Math.min(index + direction * pageSize, results.length - 1)));
      }
    }
  };

  const handleThemeChange = (next: ThemePreferences): void => {
    const normalized = updatePreferences(next);
    void chrome.storage.local.set({ themePreferences: normalized }).catch(() => {
      notify('Could not save your appearance preference.');
    });
  };

  const emptyState = getEmptyState(providerCandidate, activeProvider, query);

  const resultCountText = `${results.length} ${results.length === 1 ? 'result' : 'results'}`;
  const liveStatusText = getLiveStatusText(toast, mode, localDataLoading, results.length, resultCountText);

  const handleQueryChange = (nextQuery: string): void => {
    setQuery(nextQuery);
    setSelectedIndex(0);
  };

  const handleResultClick = (index: number): void => {
    // With the dock open, the first click on a row only closes the dock.
    if (actionDock) {
      closeActionDock();
      return;
    }

    setSelectedIndex(index);
    void executeItem(results[index]);
  };

  const handleResultHover = (index: number): void => {
    if (!actionDock) {
      setSelectedIndex(index);
    }
  };

  const handleResultContextMenu = (index: number): boolean => {
    if (!tabForResult(results[index])) {
      return false;
    }

    openActionDock(index, false);
    return true;
  };

  const handleContainerMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (dialog) {
      return;
    }

    const target = event.target;

    if (actionDock && target instanceof Element) {
      // Inside the dock, keep focus on its actions. A row click closes the dock on click instead of running the row.
      if (target.closest('.action-dock')) {
        if (!target.closest('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
          event.preventDefault();
        }

        return;
      }

      if (target.closest('.result-row')) {
        event.preventDefault();
        return;
      }

      closeActionDock(false);
    }

    if (
      target instanceof Element &&
      target.closest('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ) {
      return;
    }

    event.preventDefault();

    if (mode === 'settings') {
      settingsViewRef.current?.focus({ preventScroll: true });
    } else {
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const openShortcuts = (): void => {
    void sendBackground('browser:open-shortcuts')
      .then(closeSurface)
      .catch((error) => notify(error instanceof Error ? error.message : 'Could not open keyboard shortcuts.'));
  };

  const loadingState = isLoadingInitialTabs
    ? { title: 'Loading your tabs', detail: 'Putting pinned tabs first.' }
    : { title: 'Searching saved pages', detail: 'Checking bookmarks and recent history.' };

  const actionDockItems = actionDock && actionDockTab && actionDockIndex >= 0 ? tabActionItems(actionDockTab) : [];

  return {
    mode,
    surface,
    preferences,
    query,
    activeProvider,
    providerCandidate,
    inputRef,
    commandCenterRef,
    settingsViewRef,
    dialogRef,
    selectedItem,
    selectedTab,
    showResults,
    results,
    activeIndex,
    keyboardNavigationVersion,
    localDataLoading,
    isLoadingInitialTabs,
    emptyState,
    isUnfilteredExpandedView,
    isCompactEmpty,
    actionDock,
    actionDockTab,
    actionDockIndex,
    actionDockItems,
    actionDockId,
    dialog,
    dialogError,
    closeConfirmationCancelRef,
    dialogFieldProps: {
      renameInputRef,
      moveWindowSelectRef,
      groupNameInputRef,
      groupTargetSelectRef,
      renameValue,
      moveWindowId,
      groupName,
      groupColor,
      groupTargetId,
      windows,
      groupChoices,
      onRenameValueChange: setRenameValue,
      onMoveWindowIdChange: setMoveWindowId,
      onGroupNameChange: setGroupName,
      onGroupColorChange: setGroupColor,
      onGroupTargetIdChange: setGroupTargetId,
    },
    closeDialog,
    submitDialog,
    changeMode,
    handleThemeChange,
    handleSurfaceEscape,
    handlePaletteKeyDown,
    handleContainerMouseDown,
    handleSearchKeyDown,
    handleQueryChange,
    returnToCommandSearch,
    activateProvider,
    openShortcuts,
    handleResultClick,
    handleResultHover,
    handleResultContextMenu,
    toggleActionDock,
    closeActionDock,
    loadingState,
    toast,
    liveStatusText,
    toastDismissRef,
    dismissToast,
  };
};
