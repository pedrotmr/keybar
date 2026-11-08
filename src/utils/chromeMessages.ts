import type { RenamedTab } from '@/types';
import type { BulkCloseAction } from './bulkClose';

type ManagedBrowserTab = chrome.tabs.Tab & {
  splitViewId?: number;
  customName?: string;
  previewDataUrl?: string;
  windowTitle?: string;
  groupTitle?: string;
  groupColor?: string;
};

type Permissions = chrome.permissions.Permissions;
type EmptyPayload = Record<string, never>;

interface UiMessages {
  'ui:tabs-changed': { request: EmptyPayload; response: boolean };
  'ui:tabs-cycle': { request: { windowId: number; cycles: number }; response: boolean };
  'popup:ready': { request: { windowId?: number; surface?: string }; response: boolean };
}

interface TabNavigationMessages {
  'tabs:reload-active': { request: EmptyPayload; response: boolean };
  'tabs:hard-reload-active': { request: EmptyPayload; response: boolean };
  'tabs:back': { request: EmptyPayload; response: boolean };
  'tabs:forward': { request: EmptyPayload; response: boolean };
  'tabs:zoom-in': { request: EmptyPayload; response: boolean };
  'tabs:zoom-out': { request: EmptyPayload; response: boolean };
  'tabs:zoom-reset': { request: EmptyPayload; response: boolean };
}

interface TabLifecycleMessages {
  'tabs:duplicate-active': { request: EmptyPayload; response: boolean };
  'tabs:close-active': { request: EmptyPayload; response: boolean };
  'tabs:close-others': { request: EmptyPayload; response: boolean };
  'tabs:close-right': { request: EmptyPayload; response: boolean };
  'tabs:new': { request: EmptyPayload; response: boolean };
  'tabs:close': { request: { tabId: number }; response: boolean };
}

interface TabStateMessages {
  'tabs:pin-active': { request: EmptyPayload; response: boolean };
  'tabs:mute-active': { request: EmptyPayload; response: boolean };
  'tabs:unsplit-active': { request: EmptyPayload; response: boolean };
  'tabs:pin': { request: { tabId: number; pinned: boolean }; response: boolean };
  'tabs:mute': { request: { tabId: number; muted: boolean }; response: boolean };
  'tabs:split-active': { request: { tabId: number }; response: boolean };
}

interface TabLookupMessages {
  'tabs:list': { request: EmptyPayload; response: ManagedBrowserTab[] };
  'tabs:recent': { request: EmptyPayload; response: ManagedBrowserTab[] };
  'tabs:current': { request: EmptyPayload; response: (chrome.tabs.Tab & { splitViewId?: number }) | null };
  'tabs:activate': { request: { tabId: number; sourceTabId?: number | null }; response: boolean };
}

interface CloseConfirmedRequest {
  anchorTabId: number;
  closeAction: BulkCloseAction;
  tabIds: number[];
  windowId: number;
}

interface SwitcherShownRequest {
  windowId?: number;
  surface?: 'popup' | 'overlay';
}

interface TabSwitcherMessages {
  'tabs:switcher-shown': { request: SwitcherShownRequest; response: { pendingCycles: number } };
  'tabs:switcher-hidden': { request: { windowId?: number }; response: boolean };
  'tabs:recent-previews': { request: { tabIds: number[] }; response: Record<number, string> };
  'tabs:close-confirmed': { request: CloseConfirmedRequest; response: boolean };
}

interface TabOrganizationMessages {
  'tabs:rename': { request: { tabId: number; name: string }; response: RenamedTab | null };
  'tabs:move-active-new-window': { request: EmptyPayload; response: boolean };
  'tabs:move-new-window': { request: { tabId: number }; response: boolean };
  'tabs:move': { request: { tabId: number; windowId: number }; response: boolean };
  'tabs:group': { request: { tabId: number; groupId: number }; response: boolean };
}

interface TabClipboardMessages {
  'tabs:copy-url': { request: { tabId?: number }; response: string };
  'tabs:copy-title': { request: { tabId?: number }; response: string };
}

interface TabMessages
  extends
    TabNavigationMessages,
    TabLifecycleMessages,
    TabStateMessages,
    TabLookupMessages,
    TabSwitcherMessages,
    TabOrganizationMessages,
    TabClipboardMessages {}

interface GroupUpdateRequest {
  groupId: number;
  title?: string;
  color?: string;
  collapsed?: boolean;
}

interface GroupMessages {
  'groups:ungroup-current': { request: EmptyPayload; response: boolean };
  'groups:close-current': { request: EmptyPayload; response: boolean };
  'groups:list': { request: EmptyPayload; response: chrome.tabGroups.TabGroup[] };
  'groups:create': { request: { tabId: number; title: string; color: string }; response: number };
  'groups:create-current': { request: { title: string; color: string }; response: number | false };
  'groups:update': { request: GroupUpdateRequest; response: chrome.tabGroups.TabGroup | undefined };
}

interface WindowMessages {
  'windows:new': { request: EmptyPayload; response: boolean };
  'windows:new-incognito': { request: EmptyPayload; response: boolean };
  'windows:minimize-active': { request: EmptyPayload; response: boolean };
  'windows:maximize-active': { request: EmptyPayload; response: boolean };
  'windows:list': { request: EmptyPayload; response: chrome.windows.Window[] };
}

interface BrowserPageMessages {
  'browser:open-history': { request: EmptyPayload; response: boolean };
  'browser:open-bookmarks': { request: EmptyPayload; response: boolean };
  'browser:open-downloads': { request: EmptyPayload; response: boolean };
  'browser:open-extensions': { request: EmptyPayload; response: boolean };
  'browser:open-chrome-settings': { request: EmptyPayload; response: boolean };
  'browser:open-web-store': { request: EmptyPayload; response: boolean };
  'browser:open-shortcuts': { request: EmptyPayload; response: boolean };
}

interface BrowserUrlMessages {
  'browser:split-capabilities': { request: EmptyPayload; response: { create: boolean; unsplit: boolean } };
  'browser:open-url': { request: { url: string }; response: boolean };
  'browser:open-saved-url': { request: { url: string }; response: boolean };
}

interface BrowserMessages extends BrowserPageMessages, BrowserUrlMessages {}

interface SessionMessages {
  'sessions:restore': { request: EmptyPayload; response: chrome.sessions.Session | undefined };
}

interface PermissionMessages {
  'permissions:get-all': { request: EmptyPayload; response: Permissions };
  'permissions:contains': {
    request: { permissions: string[]; origins?: string[] };
    response: boolean;
  };
  'permissions:open-request': { request: { permissions: string[] }; response: boolean };
}

interface BrowserDataMessages {
  'bookmarks:list': { request: EmptyPayload; response: chrome.bookmarks.BookmarkTreeNode[] };
  'history:list': { request: EmptyPayload; response: chrome.history.HistoryItem[] };
}

export interface ChromeMessages
  extends
    UiMessages,
    TabMessages,
    GroupMessages,
    WindowMessages,
    BrowserMessages,
    SessionMessages,
    PermissionMessages,
    BrowserDataMessages {}

export const BACKGROUND_ACTIONS = [
  'ui:tabs-changed',
  'ui:tabs-cycle',
  'tabs:reload-active',
  'tabs:hard-reload-active',
  'tabs:back',
  'tabs:forward',
  'tabs:zoom-in',
  'tabs:zoom-out',
  'tabs:zoom-reset',
  'tabs:duplicate-active',
  'tabs:close-active',
  'tabs:close-others',
  'tabs:close-right',
  'tabs:pin-active',
  'tabs:mute-active',
  'tabs:move-active-new-window',
  'tabs:unsplit-active',
  'tabs:new',
  'windows:new',
  'windows:new-incognito',
  'windows:minimize-active',
  'windows:maximize-active',
  'browser:open-history',
  'browser:open-bookmarks',
  'browser:open-downloads',
  'browser:open-extensions',
  'browser:open-chrome-settings',
  'browser:open-web-store',
  'browser:open-shortcuts',
  'sessions:restore',
  'groups:ungroup-current',
  'groups:close-current',
  'tabs:list',
  'tabs:recent',
  'tabs:current',
  'tabs:activate',
  'tabs:switcher-shown',
  'tabs:switcher-hidden',
  'tabs:recent-previews',
  'tabs:close-confirmed',
  'tabs:rename',
  'tabs:move-new-window',
  'tabs:move',
  'tabs:group',
  'tabs:pin',
  'tabs:mute',
  'tabs:split-active',
  'tabs:close',
  'tabs:copy-url',
  'tabs:copy-title',
  'groups:list',
  'groups:create',
  'groups:create-current',
  'groups:update',
  'windows:list',
  'permissions:get-all',
  'permissions:contains',
  'permissions:open-request',
  'bookmarks:list',
  'history:list',
  'browser:split-capabilities',
  'browser:open-url',
  'browser:open-saved-url',
  'popup:ready',
] as const satisfies readonly (keyof ChromeMessages)[];

export type BackgroundAction = keyof ChromeMessages;
export type BackgroundPayload<Action extends BackgroundAction> = ChromeMessages[Action]['request'];
export type BackgroundResult<Action extends BackgroundAction> = ChromeMessages[Action]['response'];

export type CommandAction =
  | 'tabs:new'
  | 'windows:new'
  | 'windows:new-incognito'
  | 'windows:minimize-active'
  | 'windows:maximize-active'
  | 'tabs:reload-active'
  | 'tabs:hard-reload-active'
  | 'tabs:back'
  | 'tabs:forward'
  | 'tabs:copy-url'
  | 'tabs:copy-title'
  | 'tabs:zoom-in'
  | 'tabs:zoom-out'
  | 'tabs:zoom-reset'
  | 'tabs:duplicate-active'
  | 'tabs:close-active'
  | 'sessions:restore'
  | 'browser:open-history'
  | 'browser:open-bookmarks'
  | 'browser:open-downloads'
  | 'browser:open-extensions'
  | 'browser:open-chrome-settings'
  | 'browser:open-web-store'
  | 'browser:open-shortcuts'
  | 'tabs:close-others'
  | 'tabs:close-right'
  | 'groups:ungroup-current'
  | 'groups:close-current'
  | 'tabs:pin-active'
  | 'tabs:mute-active'
  | 'tabs:unsplit-active';

type MissingRuntimeActions = Exclude<BackgroundAction, (typeof BACKGROUND_ACTIONS)[number]>;
type RuntimeActionListIsComplete = MissingRuntimeActions extends never ? true : false;

export type BackgroundRequest = {
  [Action in BackgroundAction]: { action: Action } & BackgroundPayload<Action>;
}[BackgroundAction];

type RequiredKeys<Payload> = Payload extends EmptyPayload
  ? never
  : { [Key in keyof Payload]-?: undefined extends Payload[Key] ? never : Key }[keyof Payload];

export type NoPayloadBackgroundAction = {
  [Action in BackgroundAction]: BackgroundPayload<Action> extends EmptyPayload ? Action : never;
}[BackgroundAction];

export const isBackgroundAction: RuntimeActionListIsComplete extends true
  ? (value: unknown) => value is BackgroundAction
  : never = (value): value is BackgroundAction =>
  typeof value === 'string' && BACKGROUND_ACTIONS.includes(value as BackgroundAction);

export type SendArguments<Action extends BackgroundAction> = [RequiredKeys<BackgroundPayload<Action>>] extends [never]
  ? [payload?: BackgroundPayload<Action>]
  : [payload: BackgroundPayload<Action>];
