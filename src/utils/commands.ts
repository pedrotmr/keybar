import type { ActionCommandItem, CommandFlow, CommandItem, FlowCommandItem, SplitAwareTab } from '@/types';
import type { CommandAction } from '@/utils/chromeMessages';
import { isTabInSplitView } from '@/utils/splitViews';
import { TAB_GROUP_ID_NONE } from '@/utils/chromeApiConstants';

export interface CommandContext {
  activeTab: SplitAwareTab | null;
  activeGroup: chrome.tabGroups.TabGroup | null;
  tabCountInWindow: number;
  tabsToRightCount: number;
  activeGroupTabCount: number;
  canUnsplitTabs: boolean;
}

type CommandOptions = Partial<Pick<ActionCommandItem, 'permission' | 'category'>>;
type ActionCommandOptions = CommandOptions & { flow?: 'confirm-close' };
type FlowCommandOptions = CommandOptions & { flow: Exclude<CommandFlow, 'confirm-close'> };

function command(
  id: string,
  title: string,
  description: string,
  icon: string,
  action: CommandAction,
  keywords: string[],
  options?: ActionCommandOptions,
): ActionCommandItem;
function command(
  id: string,
  title: string,
  description: string,
  icon: string,
  action: '',
  keywords: string[],
  options: FlowCommandOptions,
): FlowCommandItem;
function command(
  id: string,
  title: string,
  description: string,
  icon: string,
  action: CommandAction | '',
  keywords: string[],
  options: ActionCommandOptions | FlowCommandOptions = {},
) {
  const { category, ...metadata } = options;
  return {
    id,
    title,
    description,
    icon,
    type: 'command' as const,
    action,
    keywords,
    category: category ?? 'Browser',
    ...metadata,
  } as ActionCommandItem | FlowCommandItem;
}

export function getCommands(context: CommandContext): CommandItem[] {
  const tab = context.activeTab;
  const items: CommandItem[] = [
    command('new-tab', 'Open new tab', 'Create a tab in this window', '+', 'tabs:new', ['new', 'create', 'tab']),
    command('new-window', 'Open new window', 'Create a browser window', '□', 'windows:new', ['window', 'create']),
    command(
      'new-incognito-window',
      'Open incognito window',
      'Create a private browsing window',
      '◉',
      'windows:new-incognito',
      ['private', 'incognito', 'window'],
    ),
    command(
      'minimize-window',
      'Minimize current window',
      'Minimize the focused browser window',
      '–',
      'windows:minimize-active',
      ['window', 'minimize'],
    ),
    command(
      'maximize-window',
      'Maximize current window',
      'Maximize the focused browser window',
      '□',
      'windows:maximize-active',
      ['window', 'maximize', 'restore'],
    ),
    command('reload-tab', 'Reload current tab', 'Reload the active page', '↻', 'tabs:reload-active', [
      'refresh',
      'reload',
    ]),
    command(
      'hard-reload-tab',
      'Clear cache and refresh',
      'Hard reload the active page without using the local cache',
      '⟳',
      'tabs:hard-reload-active',
      ['refresh', 'reload', 'cache', 'clear cache', 'bypass cache', 'hard reload'],
    ),
    command('go-back', 'Go back', 'Navigate to the previous page', '←', 'tabs:back', ['previous', 'back']),
    command('go-forward', 'Go forward', 'Navigate to the next page', '→', 'tabs:forward', ['next', 'forward']),
    command(
      'copy-url',
      'Copy current URL',
      'Copy the active page address',
      '↗',
      'tabs:copy-url',
      ['copy', 'link', 'address'],
      { permission: { permissions: ['clipboardWrite'] } },
    ),
    command(
      'copy-title',
      'Copy current tab title',
      'Copy the active page title',
      'T',
      'tabs:copy-title',
      ['copy', 'title', 'name'],
      { permission: { permissions: ['clipboardWrite'] } },
    ),
    command('zoom-in', 'Zoom in', 'Increase zoom for this site', 'A+', 'tabs:zoom-in', ['zoom', 'larger', 'magnify']),
    command('zoom-out', 'Zoom out', 'Decrease zoom for this site', 'A−', 'tabs:zoom-out', [
      'zoom',
      'smaller',
      'magnify',
    ]),
    command('zoom-reset', 'Reset zoom', 'Return this site to its default zoom', 'A', 'tabs:zoom-reset', [
      'zoom',
      'default',
      'reset',
    ]),
    command('duplicate-tab', 'Duplicate current tab', 'Open a copy beside this tab', '▣', 'tabs:duplicate-active', [
      'clone',
      'copy',
    ]),
    command('close-tab', 'Close current tab', 'Close the active tab', '×', 'tabs:close-active', ['close', 'remove']),
    command(
      'open-tab-group',
      'Group current tab',
      'Create or update a group for this tab',
      '▦',
      '',
      ['group', 'organize'],
      { flow: 'group-active', permission: { permissions: ['tabGroups'] }, category: 'Groups' },
    ),
    command(
      'reopen-closed-tab',
      'Reopen closed tab',
      'Restore the most recently closed tab',
      '⟲',
      'sessions:restore',
      ['undo', 'restore', 'closed'],
      { permission: { permissions: ['sessions'] }, category: 'Tabs' },
    ),
    command('open-history', 'Open history', 'Browse your Chrome history', '◷', 'browser:open-history', [
      'history',
      'visited',
    ]),
    command('open-bookmarks', 'Open bookmarks', 'Browse your Chrome bookmarks', '☆', 'browser:open-bookmarks', [
      'bookmark',
      'saved',
    ]),
    command('open-downloads', 'Open downloads', 'Browse downloaded files', '↓', 'browser:open-downloads', [
      'download',
      'files',
    ]),
    command('open-extensions', 'Open extensions', 'Manage installed extensions', '◇', 'browser:open-extensions', [
      'extensions',
      'addons',
    ]),
    command(
      'open-chrome-settings',
      'Open Chrome settings',
      'Open browser settings in a new tab',
      '⚙',
      'browser:open-chrome-settings',
      ['chrome', 'browser', 'preferences'],
    ),
    command(
      'chrome-web-store',
      'Open Chrome Web Store',
      'Browse Chrome extensions and themes',
      '◈',
      'browser:open-web-store',
      ['chrome', 'extensions', 'themes', 'store'],
    ),
    command(
      'open-settings',
      'Appearance and settings',
      'Choose a theme and appearance mode',
      '⚙',
      '',
      ['settings', 'theme', 'light', 'dark'],
      { flow: 'settings', category: 'Settings' },
    ),
    command(
      'open-shortcuts',
      'Keyboard shortcuts',
      'Manage Chrome extension shortcuts',
      '⌘',
      'browser:open-shortcuts',
      ['keyboard', 'shortcut', 'keybind'],
    ),
  ];

  if (tab) {
    items.push(
      command(
        'rename-tab',
        'Rename current tab',
        'Give this tab a custom name',
        '✎',
        '',
        ['rename', 'label', 'title'],
        { flow: 'rename-active', category: 'Tabs' },
      ),
    );
    items.push(
      command('move-tab-window', 'Move current tab to a window', 'Choose another window', '⇥', '', ['move', 'window'], {
        flow: 'move-active',
        category: 'Tabs',
      }),
    );
    items.push(
      command(
        'move-tab-group',
        'Move current tab to a group',
        'Choose a tab group or create one',
        '▦',
        '',
        ['group', 'move', 'organize'],
        { flow: 'assign-group', permission: { permissions: ['tabGroups'] }, category: 'Groups' },
      ),
    );

    if (context.tabCountInWindow > 1) {
      items.push(
        command(
          'close-other-tabs',
          'Close other tabs',
          'Keep this tab and close the rest in this window',
          '⊗',
          'tabs:close-others',
          ['close', 'other', 'cleanup'],
          { flow: 'confirm-close', category: 'Tabs' },
        ),
      );
    }

    if (context.tabsToRightCount > 0) {
      items.push(
        command(
          'close-right-tabs',
          'Close tabs to the right',
          'Close later tabs in this window',
          '⊙',
          'tabs:close-right',
          ['close', 'right', 'cleanup'],
          { flow: 'confirm-close', category: 'Tabs' },
        ),
      );
    }
  }

  if (tab?.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE && context.activeGroup) {
    items.push(
      command(
        'rename-tab-group',
        'Rename current tab group',
        'Change the group name and color',
        '▦',
        '',
        ['group', 'name', 'color'],
        { flow: 'group-active', permission: { permissions: ['tabGroups'] }, category: 'Groups' },
      ),
    );
    items.push(
      command(
        'toggle-tab-group',
        context.activeGroup.collapsed ? 'Expand current tab group' : 'Collapse current tab group',
        'Change whether its tabs are shown',
        '⌄',
        '',
        ['group', 'collapse', 'expand'],
        { flow: 'toggle-group', permission: { permissions: ['tabGroups'] }, category: 'Groups' },
      ),
    );
    items.push(
      command(
        'ungroup-tab',
        'Remove current tab from group',
        'Keep the tab and remove its group',
        '⊖',
        'groups:ungroup-current',
        ['group', 'remove'],
        { permission: { permissions: ['tabGroups'] }, category: 'Groups' },
      ),
    );
    items.push(
      command(
        'close-tab-group',
        'Close current tab group',
        'Close all tabs in this group',
        '×',
        'groups:close-current',
        ['group', 'close'],
        { flow: 'confirm-close', permission: { permissions: ['tabGroups'] }, category: 'Groups' },
      ),
    );
  }

  if (tab?.pinned) {
    items.push(
      command(
        'unpin-tab',
        'Unpin current tab',
        'Return this tab to the regular tab strip',
        '⌁',
        'tabs:pin-active',
        ['pin', 'tab'],
        { category: 'Tabs' },
      ),
    );
  } else if (tab) {
    items.push(
      command(
        'pin-tab',
        'Pin current tab',
        'Keep this tab at the start of the tab strip',
        '⌁',
        'tabs:pin-active',
        ['pin', 'tab'],
        { category: 'Tabs' },
      ),
    );
  }

  if (tab?.mutedInfo?.muted) {
    items.push(
      command(
        'unmute-tab',
        'Unmute current tab',
        'Allow audio from this tab',
        '◖',
        'tabs:mute-active',
        ['sound', 'audio', 'mute'],
        { category: 'Tabs' },
      ),
    );
  } else if (tab) {
    items.push(
      command(
        'mute-tab',
        'Mute current tab',
        'Silence audio from this tab',
        '◗',
        'tabs:mute-active',
        ['sound', 'audio', 'mute'],
        { category: 'Tabs' },
      ),
    );
  }

  if (isTabInSplitView(tab) && context.canUnsplitTabs) {
    items.push(
      command(
        'unsplit-current-view',
        'Exit split view',
        'Separate the tabs into independent tabs',
        '◫',
        'tabs:unsplit-active',
        ['split', 'unsplit', 'separate'],
        { category: 'Tabs' },
      ),
    );
  }

  return items;
}
