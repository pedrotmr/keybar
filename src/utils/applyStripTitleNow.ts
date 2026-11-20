import { sendBackground } from '@/utils/chromeHelpers';
import { getHttpOrigin, isScriptableHttpUrl } from '@/utils/pageOrigin';
import {
  applyPageTitleOverride,
  normalizeCustomTabTitle,
  restorePageTitleOverride,
} from '@/utils/pageTitleOverride';

/** Paint Chrome's tab strip as soon as the user saves — do not wait on storage or session init. */
export const applyStripTitleNow = async (
  tabId: number,
  name: string,
  url: string | undefined,
  options?: { surface?: 'popup' | 'overlay'; isCurrentTab?: boolean; previousCustomName?: string; originalTitle?: string },
): Promise<void> => {
  const customName = normalizeCustomTabTitle(name);
  const origin = getHttpOrigin(url);

  if (!origin || !isScriptableHttpUrl(url)) {
    return;
  }

  // Overlay runs in the page: renaming the current tab can update document.title synchronously.
  if (options?.surface === 'overlay' && options.isCurrentTab && typeof document !== 'undefined') {
    if (customName) {
      document.title = customName;
    } else if (options.originalTitle) {
      document.title = options.originalTitle;
    }
  }

  if (typeof chrome.scripting?.executeScript === 'function') {
    if (customName) {
      await applyPageTitleOverride(tabId, customName, origin);
      return;
    }

    if (options?.previousCustomName && options.originalTitle) {
      await restorePageTitleOverride(tabId, options.originalTitle, options.previousCustomName, origin);
    }

    return;
  }

  // Content-script overlay for another tab: ask the service worker to inject only.
  if (customName) {
    await sendBackground('tabs:set-strip-title', { tabId, name: customName, origin });
    return;
  }

  if (options?.previousCustomName && options.originalTitle) {
    await sendBackground('tabs:clear-strip-title', {
      tabId,
      originalTitle: options.originalTitle,
      customName: options.previousCustomName,
      origin,
    });
  }
};
