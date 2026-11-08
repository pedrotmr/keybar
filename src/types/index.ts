import type { CommandAction } from '@/utils/chromeMessages';

export type PaletteMode = 'commands' | 'tabs' | 'settings';
export type ItemType = 'command' | 'tab' | 'bookmark' | 'history' | 'search' | 'url';
export type SplitAwareTab = chrome.tabs.Tab & { splitViewId?: number };

export interface BaseItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  type: ItemType;
  keywords?: string[];
}

interface CommandItemBase extends BaseItem {
  type: 'command';
  description: string;
  category: string;
  permission?: chrome.permissions.Permissions;
}

export type CommandFlow =
  | 'rename-active'
  | 'move-active'
  | 'group-active'
  | 'assign-group'
  | 'confirm-close'
  | 'toggle-group'
  | 'settings'
  | 'saved-search';

export type ActionCommandItem = CommandItemBase & {
  action: CommandAction;
  flow?: 'confirm-close';
};

export type FlowCommandItem = CommandItemBase & {
  action: '';
  flow: Exclude<CommandFlow, 'confirm-close'>;
};

export type CommandItem = ActionCommandItem | FlowCommandItem;

interface TabIdentity {
  tabId: number;
  windowId: number;
  index: number;
}

interface TabPageDetails {
  url: string;
  originalTitle: string;
  favIconUrl?: string;
}

interface TabActivityState {
  active: boolean;
  current: boolean;
  pinned: boolean;
  muted: boolean;
  audible: boolean;
  lastAccessed?: number;
}

interface TabGroupDetails {
  groupId?: number;
  groupTitle?: string;
  groupColor?: string;
  splitViewId?: number;
  windowTitle?: string;
}

export interface TabItem extends BaseItem, TabIdentity, TabPageDetails, TabActivityState, TabGroupDetails {
  type: 'tab';
}

export interface BookmarkItem extends BaseItem {
  type: 'bookmark';
  url: string;
}

export interface HistoryItem extends BaseItem {
  type: 'history';
  url: string;
  lastVisitTime?: number;
}

export interface SearchItem extends BaseItem {
  type: 'search';
  url: string;
}

export interface UrlItem extends BaseItem {
  type: 'url';
  url: string;
}

export type PaletteItem = CommandItem | TabItem | BookmarkItem | HistoryItem | SearchItem | UrlItem;

export interface RenamedTab {
  tabId: number;
  customName: string;
  originalTitle: string;
  url: string;
  updatedAt: number;
  closedAt?: number;
  excludedTabIdsAtClose?: number[];
}

export type AppearanceMode = 'system' | 'light' | 'dark';
export type CommandBarSize = 'compact' | 'standard' | 'wide';
export type CommandBarWindowMode = 'compact' | 'expanded';
export type CommandBarFontFamily = 'open-sans' | 'outfit' | 'nunito-sans' | 'sora' | 'ibm-plex-mono';

export interface ThemePreferences {
  appearance: AppearanceMode;
  palette: string;
  size: CommandBarSize;
  windowMode: CommandBarWindowMode;
  fontFamily: CommandBarFontFamily;
}

export interface ChromeMessage {
  action: string;
  [key: string]: unknown;
}

export interface ChromeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
