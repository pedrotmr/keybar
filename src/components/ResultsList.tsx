import { useLayoutEffect, useRef } from 'react';
import type { ResultsListProps } from './ResultsList/types';
import { EmptyState } from './ResultsList/EmptyState/EmptyState';
import { ResultRow } from './ResultsList/ResultRow/ResultRow';

export type { ResultsEmptyState } from './ResultsList/types';
export { displayDetails, resultDomId } from './ResultsList/helpers';

export function ResultsList({
  items,
  selectedIndex,
  keyboardNavigationVersion,
  highlightQuery,
  mode,
  isBusy,
  loadingState,
  emptyState,
  isInitialList = false,
  onItemClick,
  onItemHover,
  onItemContextMenu,
  hasItemActions,
  onItemActions,
  openActionsIndex,
  actionsMenuId,
}: ResultsListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');

    if (!list || !selected) {
      return;
    }

    const listBounds = list.getBoundingClientRect();
    const selectedBounds = selected.getBoundingClientRect();

    if (selectedBounds.top < listBounds.top) {
      list.scrollTop -= listBounds.top - selectedBounds.top;
    } else if (selectedBounds.bottom > listBounds.bottom) {
      list.scrollTop += selectedBounds.bottom - listBounds.bottom;
    }
  }, [items, keyboardNavigationVersion]);

  return (
    <>
      <div
        ref={listRef}
        id="command-center-results"
        className={`results-list${isInitialList ? ' is-opening-list' : ''}`}
        role="listbox"
        aria-label={mode === 'tabs' ? 'Open tabs' : 'Commands and search results'}
        aria-busy={isBusy}
      >
        {items.map((item, index) => (
          <ResultRow
            key={item.id}
            item={item}
            index={index}
            selected={index === selectedIndex}
            highlightQuery={highlightQuery}
            onItemClick={onItemClick}
            onItemHover={onItemHover}
            onItemContextMenu={onItemContextMenu}
            hasItemActions={hasItemActions}
            onItemActions={onItemActions}
            openActionsIndex={openActionsIndex}
            actionsMenuId={actionsMenuId}
          />
        ))}
      </div>
      {items.length === 0 && (
        <EmptyState isBusy={isBusy} mode={mode} loadingState={loadingState} emptyState={emptyState} />
      )}
    </>
  );
}
