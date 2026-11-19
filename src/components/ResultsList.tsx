import { useLayoutEffect, useRef, useState } from 'react';
import type { ResultsListProps } from './ResultsList/types';
import { resultDomId } from './ResultsList/helpers';
import { EmptyState } from './ResultsList/EmptyState/EmptyState';
import { MoreGlyph } from './ResultsList/ResultRow/MoreGlyph';
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
  actionsMenuId,
  openActionsIndex,
  onItemClick,
  onItemHover,
  onItemContextMenu,
  onItemActions,
}: ResultsListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [hoveredActionId, setHoveredActionId] = useState<string | null>(null);
  const [actionButtonTops, setActionButtonTops] = useState<number[]>([]);

  useLayoutEffect(() => {
    const scrollArea = scrollRef.current;
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');

    if (!scrollArea || !selected) {
      return;
    }

    const listBounds = scrollArea.getBoundingClientRect();
    const selectedBounds = selected.getBoundingClientRect();

    if (selectedBounds.top < listBounds.top) {
      scrollArea.scrollTop -= listBounds.top - selectedBounds.top;
    } else if (selectedBounds.bottom > listBounds.bottom) {
      scrollArea.scrollTop += selectedBounds.bottom - listBounds.bottom;
    }
  }, [items, keyboardNavigationVersion]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const list = listRef.current;

    if (!content || !list) {
      return;
    }

    const updateActionButtonTops = (): void => {
      const contentTop = content.getBoundingClientRect().top;
      const positions = Array.from(list.querySelectorAll<HTMLElement>('.result-row')).map((row) => {
        const bounds = row.getBoundingClientRect();
        return Math.round(bounds.top - contentTop + (bounds.height - 28) / 2);
      });

      setActionButtonTops((current) =>
        current.length === positions.length && current.every((position, index) => position === positions[index])
          ? current
          : positions,
      );
    };

    updateActionButtonTops();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateActionButtonTops);
    observer.observe(list);
    list.querySelectorAll<HTMLElement>('.result-row').forEach((row) => observer.observe(row));

    return () => observer.disconnect();
  }, [items, keyboardNavigationVersion]);

  return (
    <>
      <div ref={scrollRef} className={`results-list-scroll${isInitialList ? ' is-opening-list' : ''}`}>
        <div ref={contentRef} className="results-list-content" onMouseLeave={() => setHoveredActionId(null)}>
          <div
            ref={listRef}
            id="command-center-results"
            className="results-list"
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
                actionsVisible={hoveredActionId === item.id || index === openActionsIndex}
                highlightQuery={highlightQuery}
                onItemClick={onItemClick}
                onItemHover={onItemHover}
                onActionsHover={setHoveredActionId}
                onItemContextMenu={onItemContextMenu}
              />
            ))}
          </div>
          {items.some((item) => item.type === 'tab') && (
            <div className="result-actions-layer" role="group" aria-label="Tab actions">
              {items.map(
                (item, index) =>
                  item.type === 'tab' && (
                    <button
                      key={`actions-${item.id}`}
                      type="button"
                      className={`result-actions-trigger${hoveredActionId === item.id ? ' is-hovered' : ''}`}
                      data-result-id={item.id}
                      style={{ top: actionButtonTops[index] ?? -9999 }}
                      tabIndex={index === selectedIndex ? 0 : -1}
                      aria-label={`Actions for ${item.title}`}
                      aria-describedby={resultDomId(item.id)}
                      aria-haspopup="menu"
                      aria-expanded={index === openActionsIndex}
                      aria-controls={index === openActionsIndex ? actionsMenuId : undefined}
                      title={`Actions for ${item.title}`}
                      onMouseEnter={() => {
                        setHoveredActionId(item.id);
                        onItemHover(index);
                      }}
                      onFocus={() => setHoveredActionId(item.id)}
                      onBlur={(event) => {
                        const relatedTarget = event.relatedTarget;
                        const nextAction =
                          relatedTarget instanceof Element
                            ? relatedTarget.closest<HTMLButtonElement>('.result-actions-trigger')
                            : null;

                        setHoveredActionId(nextAction?.dataset.resultId ?? null);
                      }}
                      onMouseLeave={(event) => {
                        const relatedTarget = event.relatedTarget;
                        const resultRow =
                          relatedTarget instanceof Element ? relatedTarget.closest<HTMLElement>('.result-row') : null;

                        if (resultRow?.dataset.resultId !== item.id) {
                          setHoveredActionId(null);
                        }
                      }}
                      onClick={(event) => onItemActions(index, event.detail === 0)}
                    >
                      <MoreGlyph />
                    </button>
                  ),
              )}
            </div>
          )}
        </div>
      </div>
      {items.length === 0 && (
        <EmptyState isBusy={isBusy} mode={mode} loadingState={loadingState} emptyState={emptyState} />
      )}
    </>
  );
}
