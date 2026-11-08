import { ChromeResponse } from '@/types';
import type { BackgroundAction, BackgroundResult, SendArguments } from './chromeMessages';

export const asPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
};

export const sendBackground = async <Action extends BackgroundAction>(
  action: Action,
  ...args: SendArguments<Action>
): Promise<BackgroundResult<Action>> => {
  const [payload] = args;
  const response = (await chrome.runtime.sendMessage({ action, ...(payload ?? {}) })) as
    ChromeResponse<BackgroundResult<Action>> | undefined;

  if (!response?.success) {
    throw new Error(response?.error ?? 'The browser action could not be completed.');
  }

  return response.data as BackgroundResult<Action>;
};

export const formatShortcutLabel = (shortcut: string): string => {
  const labels: Record<string, string> = {
    Command: '⌘',
    Cmd: '⌘',
    Control: 'Ctrl',
    Ctrl: 'Ctrl',
    Shift: '⇧',
    Option: '⌥',
    Alt: 'Alt',
  };

  return shortcut
    .split('+')
    .map((part) => labels[part] ?? part.toUpperCase())
    .join('');
};

export const normalizeNavigationUrl = (input: string): string | null => {
  const value = input.trim();

  if (!value) {
    return null;
  }

  const chromePages: Record<string, string> = {
    'chrome://newtab': 'chrome://newtab/',
    'chrome://newtab/': 'chrome://newtab/',
    'chrome://new-tab-page': 'chrome://newtab/',
    'chrome://new-tab-page/': 'chrome://newtab/',
    'chrome://settings': 'chrome://settings/',
    'chrome://settings/': 'chrome://settings/',
    'chrome://history': 'chrome://history/',
    'chrome://history/': 'chrome://history/',
    'chrome://bookmarks': 'chrome://bookmarks/',
    'chrome://bookmarks/': 'chrome://bookmarks/',
    'chrome://downloads': 'chrome://downloads/',
    'chrome://downloads/': 'chrome://downloads/',
    'chrome://extensions': 'chrome://extensions/',
    'chrome://extensions/': 'chrome://extensions/',
    'chrome://extensions/shortcuts': 'chrome://extensions/shortcuts',
  };

  const normalized = value.toLowerCase();

  if (chromePages[normalized]) {
    return chromePages[normalized];
  }

  if (normalized === 'chrome://' || normalized === 'chrome:///') {
    return 'chrome://settings/';
  }

  if (normalized.startsWith('chrome://')) {
    try {
      const url = new URL(value);

      if (
        url.protocol !== 'chrome:' ||
        !/^[a-z0-9-]+$/i.test(url.hostname) ||
        url.port ||
        url.username ||
        url.password
      ) {
        return null;
      }

      if (!url.pathname || url.pathname === '') {
        url.pathname = '/';
      }

      return url.href;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(value);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    // Missing schemes are valid input; the hostname branch below supplies HTTPS.
  }

  const isBareAddress = /^(?:([\w-]+\.)+[a-z]{2,}|localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#].*)?$/i.test(
    value,
  );

  if (isBareAddress) {
    try {
      const url = new URL(`https://${value}`);

      if (!url.hostname || url.username || url.password) {
        return null;
      }

      return url.href;
    } catch {
      return null;
    }
  }

  return null;
};

export const normalizeSavedNavigationUrl = (input: string): string | null => {
  const webOrChromeUrl = normalizeNavigationUrl(input);

  if (webOrChromeUrl) {
    return webOrChromeUrl;
  }

  try {
    const url = new URL(input.trim());

    if (url.protocol === 'file:') {
      return url.href;
    }

    if (url.protocol === 'chrome-extension:' && /^[a-p]{32}$/i.test(url.hostname)) {
      return url.href;
    }

    if (url.href === 'about:blank') {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
};
