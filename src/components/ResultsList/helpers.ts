import type { PaletteItem } from '@/types';
import { isTabInSplitView } from '@/utils/splitViews';

export const formatDisplayUrl = (value: string): string => {
  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return value;
    }

    const host = url.hostname.replace(/^www\./i, '');
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');

    return `${host}${path}${url.search}${url.hash}`;
  } catch {
    return value;
  }
};

export const resultDomId = (itemId: string): string => {
  return `command-center-option-${itemId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
};

export const displayDetails = (item: PaletteItem): string => {
  if (item.type !== 'history') {
    return '';
  }

  const raw = item.subtitle ?? item.url;
  const formatted = raw.replace(/https?:\/\/[^\s·]+/gi, formatDisplayUrl);
  const normalize = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');

  return normalize(formatted) === normalize(item.title) ? '' : formatted;
};

// Keep the tab option's full details available to assistive technology; its Actions button is a sibling.
export const optionLabel = (item: PaletteItem, details: string, badge: string): string => {
  const states = item.type === 'tab' ? [item.audible ? 'Playing audio' : ''] : [];

  return [item.title, details, ...states, badge].filter(Boolean).join(', ');
};

export const itemBadge = (item: PaletteItem): string => {
  if (item.type === 'command') {
    return item.category;
  }

  if (item.type === 'tab') {
    if (item.current) {
      return 'Current';
    }

    if (item.pinned) {
      return 'Pinned';
    }

    if (isTabInSplitView(item)) {
      return 'Split view';
    }

    return 'Tab';
  }

  if (item.type === 'bookmark') {
    return 'Bookmark';
  }

  if (item.type === 'history') {
    return 'History';
  }

  if (item.type === 'url') {
    return 'Website';
  }

  return 'Search';
};
