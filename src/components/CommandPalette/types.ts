import type { BookmarkItem, CommandItem, HistoryItem, PaletteItem, ThemePreferences } from '@/types';
import type { SearchProviderDefinition } from '@/utils/searchProviders';
import type { ManagedTab } from '@/utils/tabItems';
import type { ResultsEmptyState } from '../ResultsList/types';
import type { BulkCloseAction } from '@/utils/bulkClose';

interface ConfirmCloseDialog {
  kind: 'confirm-close';
  action: BulkCloseAction;
  count: number;
  title: string;
  anchorTabId: number;
  windowId: number;
  tabIds: number[];
}

export type FlowDialog =
  | { kind: 'rename'; tabId: number; initialName: string }
  | { kind: 'move'; tabId: number }
  | { kind: 'assign-group'; tabId: number }
  | { kind: 'group'; groupId: number | null; initialName: string; initialColor: string }
  | ConfirmCloseDialog;

export interface ToastMessage {
  message: string;
  tone: 'success' | 'error';
}

export interface ActionDockState {
  itemId: string;
  tabId: number;
  focusFirstItem: boolean;
}

export interface CommandCenterTiming {
  name: string;
  durationMs: number;
  at: number;
}

export interface WindowWithCommandCenterTimings extends Window {
  __commandCenterTimings?: CommandCenterTiming[];
}

export interface CommandCenterRuntimeMessage {
  action?: string;
}

export interface PaletteViewport {
  width: number;
  height: number;
}

export type CommandPaletteMode = 'commands' | 'settings';

export interface CommandPaletteProps {
  initialMode: CommandPaletteMode;
  initialTheme: ThemePreferences;
  surface?: 'popup' | 'overlay';
  onClose?: () => void;
  themeRoot?: HTMLElement;
  cacheThemeInLocalStorage?: boolean;
}

export interface PaletteDataItems {
  bookmarks: BookmarkItem[];
  history: HistoryItem[];
  commands: CommandItem[];
  tabItems: PaletteItem[];
}

export interface ConfirmCloseCounts {
  tabCountInWindow: number;
  tabsToRightCount: number;
  activeGroupTabCount: number;
}

interface CommandPaletteSearchResults {
  results: PaletteItem[];
  activeIndex: number;
  selectedItem?: PaletteItem;
  selectedTab: ManagedTab | null;
  providerCandidate: SearchProviderDefinition | null;
  emptyState: ResultsEmptyState | undefined;
}

interface CommandPaletteSearchViewState {
  showResults: boolean;
  isCompactEmpty: boolean;
  isUnfilteredExpandedView: boolean;
  isLoadingInitialTabs: boolean;
}

interface CommandPaletteSearchAnnouncements {
  resultCountText: string;
  liveStatusText: string;
}

export interface CommandPaletteSearchModel
  extends CommandPaletteSearchResults, CommandPaletteSearchViewState, CommandPaletteSearchAnnouncements {}
