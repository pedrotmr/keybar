import type { KeyboardEvent } from 'react';
import type { BookmarkItem, CommandBarSize, HistoryItem, PaletteItem } from '@/types';
import { searchItems, searchProviderItems } from '@/utils/fuzzySearch';
import type { ResultsEmptyState } from '../ResultsList/types';
import type {
  FlowDialog,
  PaletteViewport,
  ToastMessage,
  WindowWithCommandCenterTimings,
  CommandPaletteMode,
} from './types';
import type { SearchProviderDefinition } from '@/utils/searchProviders';
import type { BulkCloseAction } from '@/utils/bulkClose';

export const groupColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const actionDockId = 'command-center-actions';

// Hidden row action buttons stay focusable with tabindex -1, so focus loops must skip them.
export const tabbableSelector = [
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const isTabActionsShortcut = (event: KeyboardEvent<HTMLElement>): boolean => {
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    return true;
  }

  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
};

export const recordTiming = (name: string, durationMs: number): void => {
  const host = window as WindowWithCommandCenterTimings;
  const metrics = host.__commandCenterTimings ?? (host.__commandCenterTimings = []);
  metrics.push({ name, durationMs, at: Date.now() });

  if (metrics.length > 100) {
    metrics.splice(0, metrics.length - 100);
  }
};

export const resultPageSize = (list: HTMLElement): number => {
  const row = list.querySelector<HTMLElement>('.result-row');

  if (!row) {
    return 1;
  }

  const rowStyle = window.getComputedStyle(row);
  const listStyle = window.getComputedStyle(list);
  const margin = (Number.parseFloat(rowStyle.marginTop) || 0) + (Number.parseFloat(rowStyle.marginBottom) || 0);
  const padding = (Number.parseFloat(listStyle.paddingTop) || 0) + (Number.parseFloat(listStyle.paddingBottom) || 0);
  const rowPitch = row.getBoundingClientRect().height + margin;

  return Math.max(1, Math.floor((list.clientHeight - padding) / Math.max(1, rowPitch)));
};

export const initialResultLimit = (
  size: CommandBarSize,
  surface: 'popup' | 'overlay',
  viewport: PaletteViewport,
): number => {
  const overlayMaxHeights: Record<CommandBarSize, number> = { compact: 520, standard: 580, wide: 660 };
  const popupHeights: Record<CommandBarSize, number> = { compact: 520, standard: 560, wide: 600 };
  const panelHeight =
    surface === 'overlay'
      ? Math.min(overlayMaxHeights[size], viewport.height - (viewport.width <= 560 ? 24 : 48))
      : popupHeights[size];

  const panelBorder = surface === 'overlay' ? 2 : 0;
  const searchHeight = surface === 'overlay' ? 58 : 56;
  const listContentHeight = panelHeight - panelBorder - searchHeight - 20;
  const rowHeight = surface === 'overlay' ? 44 : 42;
  const rowPitch = rowHeight + 4;

  // Cap the unfiltered opening view at seven rows and leave one row of slack for smaller screens.
  return Math.max(1, Math.min(7, Math.floor(listContentHeight / rowPitch) - 1));
};

export const flattenBookmarks = (
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  output: BookmarkItem[] = [],
): BookmarkItem[] => {
  for (const node of nodes) {
    if (node.url) {
      output.push({
        id: `bookmark-${node.id}`,
        title: node.title || node.url,
        subtitle: node.url,
        icon: '☆',
        type: 'bookmark',
        url: node.url,
      });
    }

    if (node.children) {
      flattenBookmarks(node.children, output);
    }
  }

  return output;
};

export const toHistoryItems = (items: chrome.history.HistoryItem[]): HistoryItem[] => {
  return items
    .filter((item) => Boolean(item.url && item.title))
    .map((item) => ({
      id: `history-${item.id}`,
      title: item.title || item.url || 'Visited page',
      subtitle: item.url,
      icon: '◷',
      type: 'history',
      url: item.url!,
      lastVisitTime: item.lastVisitTime,
    }));
};

export const findPaletteResults = (
  activeProvider: SearchProviderDefinition | null,
  query: string,
  mode: CommandPaletteMode,
  items: PaletteItem[],
  allowFallback: boolean,
): PaletteItem[] => {
  if (!activeProvider) {
    return searchItems(items, query, false, allowFallback);
  }

  if (!query.trim() || mode !== 'commands') {
    return [];
  }

  return searchProviderItems(items, query, activeProvider, allowFallback);
};

export const getConfirmCloseTitle = (action: BulkCloseAction, count: number): string => {
  const noun = count === 1 ? 'tab' : 'tabs';

  if (action === 'tabs:close-others') {
    return `Close ${count} other ${noun}?`;
  }

  if (action === 'tabs:close-right') {
    return `Close ${count} ${noun} to the right?`;
  }

  return `Close ${count} ${noun} in this group?`;
};

export const getOpenErrorMessage = (error: unknown, item: PaletteItem): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (item.type === 'search') {
    return 'Could not open that search.';
  }

  return 'Could not open that page.';
};

export const getEmptyState = (
  providerCandidate: SearchProviderDefinition | null,
  activeProvider: SearchProviderDefinition | null,
  query: string,
): ResultsEmptyState | undefined => {
  if (providerCandidate) {
    return {
      title: `${providerCandidate.verb} ${providerCandidate.name}`,
      detail: `Press Tab or Enter to ${providerCandidate.verb.toLowerCase()} ${providerCandidate.name}.`,
      providerId: providerCandidate.id,
    };
  }

  if (activeProvider && !query.trim()) {
    const searchPrompt = activeProvider.verb === 'Ask' ? 'a question' : 'what to search for';

    return {
      title: `${activeProvider.verb} ${activeProvider.name}`,
      detail: `Type ${searchPrompt}, then press Enter. ${activeProvider.name} opens in a new tab.`,
      providerId: activeProvider.id,
    };
  }

  return undefined;
};

export const getLiveStatusText = (
  toast: ToastMessage | null,
  mode: CommandPaletteMode,
  localDataLoading: boolean,
  resultsLength: number,
  resultCountText: string,
): string => {
  if (toast !== null) {
    return toast.message;
  }

  if (mode === 'settings') {
    return '';
  }

  if (localDataLoading) {
    return 'Searching saved pages and recent history.';
  }

  if (resultsLength) {
    return resultCountText;
  }

  return '';
};

export const getDialogHeadingLabel = (dialog: FlowDialog): string => {
  if (dialog.kind === 'rename') {
    return 'Tab';
  }

  if (dialog.kind === 'move') {
    return 'Window';
  }

  if (dialog.kind === 'confirm-close') {
    return 'Confirm';
  }

  return 'Tab group';
};

export const getDialogTitle = (dialog: FlowDialog): string => {
  if (dialog.kind === 'confirm-close') {
    return dialog.title;
  }

  if (dialog.kind === 'rename') {
    return 'Rename tab';
  }

  if (dialog.kind === 'move') {
    return 'Move tab';
  }

  if (dialog.kind === 'assign-group') {
    return 'Move tab to group';
  }

  if (dialog.groupId === null) {
    return 'Create tab group';
  }

  return 'Edit tab group';
};

export const getDialogDescription = (dialog: FlowDialog): string => {
  if (dialog.kind === 'confirm-close') {
    return 'These tabs will close. You can find the pages again in Chrome History.';
  }

  if (dialog.kind === 'rename') {
    return 'This name is stored by the extension. The website title stays unchanged.';
  }

  if (dialog.kind === 'move') {
    return 'Choose a destination window for this tab.';
  }

  if (dialog.kind === 'assign-group') {
    return 'Add this tab to an existing group or create a new one.';
  }

  return 'Choose a name and color for this group.';
};

export const getDialogSubmitLabel = (dialog: FlowDialog, groupTargetId: string): string => {
  if (dialog.kind === 'confirm-close') {
    return 'Close tabs';
  }

  if (dialog.kind === 'rename') {
    return 'Save name';
  }

  if (dialog.kind === 'move') {
    return 'Move tab';
  }

  if (dialog.kind === 'assign-group') {
    if (groupTargetId === 'new') {
      return 'Create group';
    }

    return 'Move to group';
  }

  if (dialog.groupId === null) {
    return 'Create group';
  }

  return 'Save group';
};
