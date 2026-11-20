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
  options?: { previousCustomName?: string; originalTitle?: string },
): Promise<void> => {
  const customName = normalizeCustomTabTitle(name);
  const origin = getHttpOrigin(url);

  if (!origin || !isScriptableHttpUrl(url)) {
    return;
  }

  // Always go through the MAIN-world injector so originalTitle is captured before
  // document.title changes. Never write document.title from the overlay world first.
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
