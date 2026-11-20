import type { RefObject } from 'react';
import type { FlowDialog } from '../types';
import { TabGroupFields } from './DialogFields/TabGroupFields';

interface DialogFieldRefs {
  renameInputRef: RefObject<HTMLInputElement | null>;
  moveWindowSelectRef: RefObject<HTMLSelectElement | null>;
  groupNameInputRef: RefObject<HTMLInputElement | null>;
  groupTargetSelectRef: RefObject<HTMLSelectElement | null>;
}

interface DialogFieldValues {
  renameValue: string;
  moveWindowId: string;
  groupName: string;
  groupColor: string;
  groupTargetId: string;
}

interface DialogFieldOptions {
  windows: chrome.windows.Window[];
  groupChoices: chrome.tabGroups.TabGroup[];
}

interface DialogFieldHandlers {
  onRenameValueChange: (value: string) => void;
  onMoveWindowIdChange: (value: string) => void;
  onGroupNameChange: (value: string) => void;
  onGroupColorChange: (value: string) => void;
  onGroupTargetIdChange: (value: string) => void;
}

export interface DialogFieldsProps extends DialogFieldRefs, DialogFieldValues, DialogFieldOptions, DialogFieldHandlers {
  dialog: FlowDialog;
}

export function DialogFields({
  dialog,
  renameInputRef,
  moveWindowSelectRef,
  groupNameInputRef,
  groupTargetSelectRef,
  renameValue,
  moveWindowId,
  groupName,
  groupColor,
  groupTargetId,
  windows,
  groupChoices,
  onRenameValueChange,
  onMoveWindowIdChange,
  onGroupNameChange,
  onGroupColorChange,
  onGroupTargetIdChange,
}: DialogFieldsProps) {
  return (
    <>
      {dialog.kind === 'rename' && (
        <div className="field-group">
          <label htmlFor="rename-tab-input">Custom tab name</label>
          <input
            ref={renameInputRef}
            id="rename-tab-input"
            name="custom-tab-name"
            autoComplete="off"
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            maxLength={120}
            placeholder="e.g. Sprint planning"
          />
          <span className="field-help">
            Shown in Keybar and in Chrome’s tab strip on regular pages. Leave empty to clear.
          </span>
        </div>
      )}

      {dialog.kind === 'move' && (
        <div className="field-group">
          <label htmlFor="move-window-select">Destination</label>
          <select
            ref={moveWindowSelectRef}
            id="move-window-select"
            name="destination-window"
            value={moveWindowId}
            onChange={(event) => onMoveWindowIdChange(event.target.value)}
          >
            <option value="new">New window</option>
            {windows.map((browserWindow, index) => {
              const label = browserWindow.tabs?.find((tab) => tab.active)?.title;

              return (
                <option key={browserWindow.id} value={browserWindow.id}>
                  {label ? `Window · ${label}` : `Window ${index + 1}`}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {dialog.kind === 'group' && (
        <TabGroupFields
          idPrefix="tab-group"
          nameInputRef={groupNameInputRef}
          name={groupName}
          color={groupColor}
          onNameChange={onGroupNameChange}
          onColorChange={onGroupColorChange}
        />
      )}

      {dialog.kind === 'assign-group' && (
        <>
          <div className="field-group">
            <label htmlFor="tab-group-target">Destination group</label>
            <select
              ref={groupTargetSelectRef}
              id="tab-group-target"
              name="tab-group-target"
              value={groupTargetId}
              onChange={(event) => onGroupTargetIdChange(event.target.value)}
            >
              <option value="new">Create a new group</option>
              {groupChoices.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title || 'Unnamed group'}
                </option>
              ))}
            </select>
          </div>
          {groupTargetId === 'new' && (
            <TabGroupFields
              idPrefix="new-tab-group"
              nameInputRef={groupNameInputRef}
              name={groupName}
              color={groupColor}
              onNameChange={onGroupNameChange}
              onColorChange={onGroupColorChange}
            />
          )}
        </>
      )}
    </>
  );
}
