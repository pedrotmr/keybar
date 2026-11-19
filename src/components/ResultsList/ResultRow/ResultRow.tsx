import type { ResultRowProps } from '../types';
import { displayDetails, formatDisplayUrl, itemBadge, optionLabel, resultDomId } from '../helpers';
import { HighlightedText } from './HighlightedText';
import { ItemIcon } from './ItemIcon';
import { MoreGlyph } from './MoreGlyph';

export function ResultRow({
  item,
  index,
  selected,
  highlightQuery,
  onItemClick,
  onItemHover,
  onItemContextMenu,
  hasItemActions,
  onItemActions,
  openActionsIndex,
  actionsMenuId,
}: ResultRowProps) {
  const badge = itemBadge(item);
  const details = displayDetails(item);
  const hasActions = Boolean(onItemActions && hasItemActions?.(item));
  const actionsOpen = hasActions && index === openActionsIndex;

  return (
    <div
      id={resultDomId(item.id)}
      className={`result-row${selected ? ' is-selected' : ''}${item.type === 'tab' && item.current ? ' is-active-tab' : ''}${hasActions ? ' has-actions' : ''}${actionsOpen ? ' is-actions-target' : ''}`}
      role="option"
      aria-selected={selected}
      aria-label={hasActions ? optionLabel(item, details, badge) : undefined}
      aria-description={item.type === 'bookmark' ? `Saved address: ${formatDisplayUrl(item.url)}` : undefined}
      title={item.type === 'bookmark' ? formatDisplayUrl(item.url) : undefined}
      onMouseEnter={() => onItemHover(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onItemClick(index)}
      onContextMenu={
        onItemContextMenu
          ? (event) => {
              if (onItemContextMenu(index)) {
                event.preventDefault();
              }
            }
          : undefined
      }
    >
      <span className="result-icon-wrap">
        <ItemIcon key={item.type === 'tab' ? (item.favIconUrl ?? item.id) : item.id} item={item} />
      </span>
      <span className="result-copy">
        <span className="result-title">
          <HighlightedText text={item.title} highlightQuery={highlightQuery} />
        </span>
        {details && <span className="result-subtitle">{details}</span>}
      </span>
      {item.type === 'tab' && item.audible && (
        <>
          <span className="tab-audible" aria-hidden="true">
            ♫
          </span>
          <span className="visually-hidden">Playing audio</span>
        </>
      )}
      <span
        className={`result-badge${item.type === 'tab' && item.pinned && !item.current ? ' is-pinned' : ''}`}
        title={item.type === 'tab' ? badge : undefined}
      >
        {badge}
      </span>
      {hasActions && (
        <button
          type="button"
          className="result-actions-trigger"
          // Only the selected row's button is a Tab stop; arrow keys still drive selection from the search field.
          tabIndex={selected ? 0 : -1}
          aria-label={`Actions for ${item.title}`}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          aria-controls={actionsOpen ? actionsMenuId : undefined}
          onClick={(event) => {
            event.stopPropagation();
            // Keyboard activation reports detail 0; it moves focus to the first action.
            onItemActions?.(index, event.detail === 0);
          }}
        >
          <MoreGlyph />
        </button>
      )}
    </div>
  );
}
