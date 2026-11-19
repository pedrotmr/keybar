import { SettingsView } from './SettingsView';
import { useCommandPaletteModel } from './CommandPalette/useCommandPaletteModel';
import type { CommandPaletteProps } from './CommandPalette/types';
import { SearchArea } from './CommandPalette/SearchArea/SearchArea';
import { ResultsRegion } from './CommandPalette/ResultsRegion/ResultsRegion';
import { FlowDialog } from './CommandPalette/FlowDialog/FlowDialog';
import { NoticeContainer } from './CommandPalette/NoticeContainer/NoticeContainer';

export function CommandPalette(props: CommandPaletteProps) {
  const model = useCommandPaletteModel(props);

  return (
    <div
      ref={model.commandCenterRef}
      className={`command-center${model.surface === 'overlay' ? ' is-overlay-surface' : ''}${model.isCompactEmpty ? ' is-compact-empty' : ''}${model.isUnfilteredExpandedView ? ' is-initial-expanded-view' : ''}${model.actionDock ? ' has-action-dock' : ''}`}
      role={model.surface === 'overlay' ? 'dialog' : undefined}
      aria-modal={model.surface === 'overlay' ? true : undefined}
      aria-label="Command Bar"
      tabIndex={-1}
      onKeyDownCapture={model.handleSurfaceEscape}
      onKeyDown={model.handlePaletteKeyDown}
      onMouseDown={model.handleContainerMouseDown}
    >
      <h1 className="visually-hidden">Command Bar</h1>
      {model.mode === 'settings' ? (
        <SettingsView
          preferences={model.preferences}
          onChange={model.handleThemeChange}
          onBack={() => model.changeMode('commands')}
          viewRef={(node) => {
            model.settingsViewRef.current = node;
          }}
          onManageShortcuts={model.openShortcuts}
        />
      ) : (
        <>
          <SearchArea
            activeProvider={model.activeProvider}
            providerCandidates={model.providerCandidates}
            query={model.query}
            inputRef={model.inputRef}
            selectedItem={model.selectedItem}
            hasSelectedTab={model.selectedItem?.type === 'tab' && Boolean(model.selectedTab)}
            showResults={model.showResults}
            resultsLength={model.results.length}
            onQueryChange={model.handleQueryChange}
            onSearchKeyDown={model.handleSearchKeyDown}
            onReturnToCommandSearch={model.returnToCommandSearch}
            onActivateProvider={model.activateSuggestedProvider}
            onOpenSettings={() => model.changeMode('settings')}
          />
          {model.showResults && (
            <ResultsRegion
              results={model.results}
              activeIndex={model.activeIndex}
              keyboardNavigationVersion={model.keyboardNavigationVersion}
              highlightQuery={model.highlightQuery}
              isBusy={model.localDataLoading || model.isLoadingInitialTabs}
              loadingState={model.loadingState}
              emptyState={model.emptyState}
              isInitialList={model.isUnfilteredExpandedView}
              actionDock={model.actionDock}
              actionDockIndex={model.actionDockIndex}
              actionDockTab={model.actionDockTab}
              actionsMenuId={model.actionDockId}
              actionItems={model.actionDockItems}
              onItemClick={model.handleResultClick}
              onItemHover={model.handleResultHover}
              onItemContextMenu={model.handleResultContextMenu}
              onItemActions={model.toggleActionDock}
              onDismissActionDock={() => model.closeActionDock()}
            />
          )}
        </>
      )}

      <FlowDialog
        dialog={model.dialog}
        dialogRef={model.dialogRef}
        closeConfirmationCancelRef={model.closeConfirmationCancelRef}
        dialogError={model.dialogError}
        onCloseDialog={model.closeDialog}
        onSubmit={model.submitDialog}
        {...model.dialogFieldProps}
      />
      <NoticeContainer
        toast={model.toast}
        liveStatusText={model.liveStatusText}
        dismissToast={model.dismissToast}
        dismissButtonRef={model.toastDismissRef}
      />
    </div>
  );
}
