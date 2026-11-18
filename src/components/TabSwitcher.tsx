import type { CSSProperties } from 'react';
import { EmptyPanel } from './TabSwitcher/EmptyPanel';
import { TabCard } from './TabSwitcher/TabCard/TabCard';
import { useTabSwitcherModel } from './TabSwitcher/useTabSwitcherModel';
import type { TabSwitcherProps } from './TabSwitcher/types';

export function TabSwitcher(props: TabSwitcherProps) {
  const model = useTabSwitcherModel(props);

  return (
    <div
      className="tab-switcher-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tab-switcher-title"
      tabIndex={-1}
      onKeyDown={model.handleKeyDown}
      onMouseDown={model.handleOverlayMouseDown}
    >
      <h1 className="visually-hidden" id="tab-switcher-title">
        Recent tabs
      </h1>
      {model.hasTabs ? (
        <div
          ref={model.listboxRef}
          className="tab-switcher-panel"
          role="listbox"
          aria-label={model.listLabel}
          aria-orientation="horizontal"
          aria-activedescendant={model.activeDescendant}
          tabIndex={0}
          onMouseDown={model.handlePanelMouseDown}
          style={
            {
              '--tab-switcher-panel-width': `${model.panelWidth}px`,
            } as CSSProperties
          }
        >
          {model.tabs.map((tab, index) => {
            if (tab.id === undefined) {
              return null;
            }

            return (
              <TabCard
                key={tab.id}
                tab={tab}
                index={index}
                tabsCount={model.tabs.length}
                selected={index === model.selectedIndex}
                currentTabId={model.currentTabId}
                onPointerMove={(event) => model.handleCardPointerMove(event, tab, index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void model.activate(tab);
                }}
              />
            );
          })}
        </div>
      ) : (
        <EmptyPanel
          message={model.stateMessage}
          stateRef={model.stateRef}
          onMouseDown={model.handleEmptyPanelMouseDown}
        />
      )}
      {model.hasTabs && model.message && (
        <p className="tab-switcher-state" role="status" aria-live="polite" aria-atomic="true">
          {model.message}
        </p>
      )}
    </div>
  );
}
