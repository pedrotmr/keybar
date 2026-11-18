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
  query: string;
  providerSearchMode: boolean;
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
  onItemActions: (index: number, fromKeyboard: boolean) => void;
  actionsMenuId: string;
  openActionsIndex?: number;
}

export type ResultsListProps = ResultsListDataProps & ResultsListStatusProps & ResultsListInteractionProps;

interface ResultRowDataProps {
  item: PaletteItem;
  index: number;
  selected: boolean;
  actionsVisible: boolean;
  query: string;
  providerSearchMode: boolean;
}

interface ResultRowInteractionProps {
  onItemClick: (index: number) => void;
  onItemHover: (index: number) => void;
  onActionsHover: (itemId: string | null) => void;
  onItemContextMenu?: (index: number) => boolean;
}

export type ResultRowProps = ResultRowDataProps & ResultRowInteractionProps;

export interface EmptyStateProps {
  isBusy: boolean;
  mode: 'commands' | 'tabs';
  loadingState?: ResultsLoadingState;
  emptyState?: ResultsEmptyState;
}
