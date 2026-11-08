import { asPositiveInteger } from './chromeHelpers';
import { isBulkCloseAction } from './bulkClose';
import {
  isBackgroundAction,
  type BackgroundAction,
  type BackgroundRequest,
  type NoPayloadBackgroundAction,
} from './chromeMessages';

const optionalPermissions = new Set(['bookmarks', 'history', 'tabGroups', 'sessions', 'clipboardWrite']);

export const validateRequest = (
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): BackgroundRequest => {
  if (sender.id !== extensionId || (sender.tab && sender.frameId !== 0)) {
    throw new Error('Untrusted message sender.');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid message.');
  }

  const message = raw as Record<string, unknown> & { action?: unknown };

  if (typeof message.action !== 'string') {
    throw new Error('Invalid command.');
  }

  if (!isBackgroundAction(message.action)) {
    throw new Error('Unknown command.');
  }

  const action: BackgroundAction = message.action;

  const requirePositiveId = (key: string): void => {
    if (asPositiveInteger(message[key]) === undefined) {
      throw new Error(`Invalid ${key}.`);
    }
  };

  const requireGroupId = (): void => {
    if (typeof message.groupId !== 'number' || !Number.isSafeInteger(message.groupId) || message.groupId < 0) {
      throw new Error('Invalid groupId.');
    }
  };

  const requireString = (key: string): void => {
    if (typeof message[key] !== 'string') {
      throw new Error(`Invalid ${key}.`);
    }
  };

  const requireStrings = (key: string): string[] => {
    const value = message[key];

    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error(`Invalid ${key}.`);
    }

    return value;
  };

  const rejectWebsitePermissions = (): void => {
    if (message.origins !== undefined && (!Array.isArray(message.origins) || message.origins.length)) {
      throw new Error('Website permissions are not supported.');
    }
  };

  switch (action) {
    case 'ui:tabs-cycle':
      requirePositiveId('windowId');
      requirePositiveId('cycles');
      break;

    case 'tabs:activate':
    case 'tabs:close':
    case 'tabs:move-new-window':
    case 'tabs:split-active':
      requirePositiveId('tabId');

      if (action === 'tabs:activate' && message.sourceTabId != null) {
        requirePositiveId('sourceTabId');
      }

      break;

    case 'tabs:rename':
      requirePositiveId('tabId');
      requireString('name');
      break;

    case 'tabs:move':
      requirePositiveId('tabId');
      requirePositiveId('windowId');
      break;

    case 'tabs:group':
      requirePositiveId('tabId');
      requireGroupId();
      break;

    case 'tabs:pin':
      requirePositiveId('tabId');

      if (typeof message.pinned !== 'boolean') {
        throw new Error('Invalid pinned.');
      }

      break;

    case 'tabs:mute':
      requirePositiveId('tabId');

      if (typeof message.muted !== 'boolean') {
        throw new Error('Invalid muted.');
      }

      break;

    case 'tabs:copy-url':
    case 'tabs:copy-title':
      if (message.tabId !== undefined) {
        requirePositiveId('tabId');
      }

      break;

    case 'tabs:switcher-shown':
      if (message.windowId !== undefined) {
        requirePositiveId('windowId');
      }

      if (message.surface !== undefined && message.surface !== 'popup' && message.surface !== 'overlay') {
        throw new Error('Invalid surface.');
      }

      break;

    case 'tabs:switcher-hidden':
      if (message.windowId !== undefined) {
        requirePositiveId('windowId');
      }

      break;

    case 'tabs:recent-previews':
      if (!Array.isArray(message.tabIds) || !message.tabIds.every((id) => asPositiveInteger(id) !== undefined)) {
        throw new Error('Invalid tabIds.');
      }

      break;

    case 'tabs:close-confirmed':
      requirePositiveId('anchorTabId');
      requirePositiveId('windowId');

      if (!isBulkCloseAction(message.closeAction)) {
        throw new Error('Invalid closeAction.');
      }

      if (
        !Array.isArray(message.tabIds) ||
        !message.tabIds.length ||
        !message.tabIds.every((id) => asPositiveInteger(id) !== undefined) ||
        new Set(message.tabIds).size !== message.tabIds.length
      ) {
        throw new Error('Invalid tabIds.');
      }

      break;

    case 'groups:create':
      requirePositiveId('tabId');
      requireString('title');
      requireString('color');
      break;

    case 'groups:create-current':
      requireString('title');
      requireString('color');
      break;

    case 'groups:update':
      requireGroupId();

      if (message.title !== undefined) {
        requireString('title');
      }

      if (message.color !== undefined) {
        requireString('color');
      }

      if (message.collapsed !== undefined && typeof message.collapsed !== 'boolean') {
        throw new Error('Invalid collapsed.');
      }

      break;

    case 'permissions:contains':
      if (!requireStrings('permissions').every((permission) => optionalPermissions.has(permission))) {
        throw new Error('Invalid optional permissions.');
      }

      rejectWebsitePermissions();
      break;

    case 'permissions:open-request':
      if (!requireStrings('permissions').every((permission) => optionalPermissions.has(permission))) {
        throw new Error('Invalid optional permissions.');
      }

      rejectWebsitePermissions();
      break;

    case 'browser:open-url':
    case 'browser:open-saved-url':
      requireString('url');
      break;

    case 'popup:ready':
      if (message.windowId !== undefined) {
        requirePositiveId('windowId');
      }

      if (message.surface !== undefined) {
        requireString('surface');
      }

      break;

    default: {
      const actionWithNoPayload: NoPayloadBackgroundAction = action;
      void actionWithNoPayload;
      break;
    }
  }

  return raw as BackgroundRequest;
};
