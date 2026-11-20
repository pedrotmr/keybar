import type { PaletteItem } from '@/types';
import { ActionDock } from '../../ActionDock';
import type { ActionDockItem } from '../../ActionDock/types';
import { ResultsList } from '../../ResultsList';
import type { ResultsEmptyState, ResultsLoadingState } from '../../ResultsList/types';
import type { ActionDockState } from '../types';
import type { ManagedTab } from '@/utils/tabItems';

interface ResultsRegionListDataProps {
  results: PaletteItem[];
  activeIndex: number;
  keyboardNavigationVersion: number;
  highlightQuery: string;
  isInitialList: boolean;
}

interface ResultsRegionFeedbackProps {
  isBusy: boolean;
  loadingState: ResultsLoadingState;
  emptyState?: ResultsEmptyState;
}

interface ResultsRegionActionDockProps {
  actionDock: ActionDockState | null;
  actionDockIndex: number;
  actionDockTab: ManagedTab | null;
  actionsMenuId: string;
  actionItems: ActionDockItem[];
}

interface ResultsRegionHandlerProps {
  onItemClick: (index: number) => void;
  onItemHover: (index: number) => void;
  onItemContextMenu: (index: number) => boolean;
  onItemActions: (index: number, fromKeyboard: boolean) => void;
  onDismissActionDock: () => void;
}

interface ResultsRegionProps
  extends
    ResultsRegionListDataProps,
    ResultsRegionFeedbackProps,
    ResultsRegionActionDockProps,
    ResultsRegionHandlerProps {}

export function ResultsRegion({
  results,
  activeIndex,
  keyboardNavigationVersion,
  highlightQuery,
  isBusy,
  loadingState,
  emptyState,
  isInitialList,
  actionDock,
  actionDockIndex,
  actionDockTab,
  actionsMenuId,
  actionItems,
  onItemClick,
  onItemHover,
  onItemContextMenu,
  onItemActions,
  onDismissActionDock,
}: ResultsRegionProps) {
  return (
    <div className="results-region">
      <ResultsList
        items={results}
        selectedIndex={activeIndex}
        keyboardNavigationVersion={keyboardNavigationVersion}
        highlightQuery={highlightQuery}
        mode="commands"
        isBusy={isBusy}
        loadingState={loadingState}
        emptyState={emptyState}
        isInitialList={isInitialList}
        actionsMenuId={actionsMenuId}
        openActionsIndex={actionDock ? actionDockIndex : undefined}
        onItemClick={onItemClick}
        onItemHover={onItemHover}
        onItemContextMenu={onItemContextMenu}
        onItemActions={onItemActions}
      />
      {actionDock && actionDockTab && actionDockIndex >= 0 && (
        <ActionDock
          key={actionDock.itemId}
          id={actionsMenuId}
          label={`Actions for ${results[actionDockIndex].title}`}
          items={actionItems}
          focusFirstItem={actionDock.focusFirstItem}
          onDismiss={onDismissActionDock}
        />
      )}
    </div>
  );
}
