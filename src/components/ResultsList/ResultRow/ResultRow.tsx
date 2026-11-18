import type { ResultRowProps } from '../types';
import { displayDetails, formatDisplayUrl, itemBadge, optionLabel, resultDomId } from '../helpers';
import { HighlightedText } from './HighlightedText';
import { ItemIcon } from './ItemIcon';

export function ResultRow({
  item,
  index,
  selected,
  query,
  providerSearchMode,
  onItemClick,
  onItemHover,
  onItemContextMenu,
}: ResultRowProps) {
  const badge = itemBadge(item);
  const details = displayDetails(item);

  return (
    <div
      id={resultDomId(item.id)}
      className={`result-row${selected ? ' is-selected' : ''}${item.type === 'tab' && item.current ? ' is-active-tab' : ''}`}
      role="option"
      aria-selected={selected}
      aria-label={item.type === 'tab' ? optionLabel(item, details, badge) : undefined}
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
          <HighlightedText text={item.title} query={query} providerSearchMode={providerSearchMode} />
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
    </div>
  );
}
