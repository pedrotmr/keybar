import type { PaletteItem } from '@/types';

export interface ResultsEmptyStateAction {
  label: string;
  shortcut?: string;
  onActivate: () => void;
}

export interface ResultsEmptyState {
  title: string;
  detail: string;
  providerId?: string;
  action?: ResultsEmptyStateAction;
}

export interface ResultsLoadingState {
  title: string;
  detail: string;
}

interface ResultsListDataProps {
  items: PaletteItem[];
  selectedIndex: number;
  keyboardNavigationVersion: number;
  highlightQuery: string;
  mode: 'commands' | 'tabs';
}

interface ResultsListStatusProps {
  isBusy: boolean;
  loadingState?: ResultsLoadingState;
  emptyState?: ResultsEmptyState;
  isInitialList?: boolean;
}

interface ResultsListInteractionProps {
  onItemClick: (index: number) => void;
  onItemHover: (index: number) => void;
  onItemContextMenu?: (index: number) => boolean;
  /** Rows that pass this check get a "more actions" button. */
  hasItemActions?: (item: PaletteItem) => boolean;
  onItemActions?: (index: number, fromKeyboard: boolean) => void;
  /** Index of the row whose actions menu is open. */
  openActionsIndex?: number;
  actionsMenuId?: string;
}

export type ResultsListProps = ResultsListDataProps & ResultsListStatusProps & ResultsListInteractionProps;

interface ResultRowDataProps {
  item: PaletteItem;
  index: number;
  selected: boolean;
  highlightQuery: string;
}

interface ResultRowInteractionProps {
  onItemClick: (index: number) => void;
  onItemHover: (index: number) => void;
  onItemContextMenu?: (index: number) => boolean;
  hasItemActions?: (item: PaletteItem) => boolean;
  onItemActions?: (index: number, fromKeyboard: boolean) => void;
  openActionsIndex?: number;
  actionsMenuId?: string;
}

export type ResultRowProps = ResultRowDataProps & ResultRowInteractionProps;

export interface EmptyStateProps {
  isBusy: boolean;
  mode: 'commands' | 'tabs';
  loadingState?: ResultsLoadingState;
  emptyState?: ResultsEmptyState;
}
