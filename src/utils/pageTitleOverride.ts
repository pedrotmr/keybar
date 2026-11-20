import { getHttpOrigin, isScriptableHttpUrl } from '@/utils/pageOrigin';

export type TitleOverrideReason =
  | 'empty-title'
  | 'origin-mismatch'
  | 'site-access-required'
  | 'unsupported-page'
  | 'injection-failed'
  | 'no-saved-title'
  | 'title-not-overridden'
  | 'restore-failed'
  | 'operation-failed';

export type TitleOverrideResult =
  | { success: true; originalTitle: string }
  | { success: false; reason: TitleOverrideReason };

export type TitleRestoreResult = { success: true } | { success: false; reason: TitleOverrideReason };

const normalizeTitle = (value: string): string => value.replace(/[\t\n\f\r ]+/g, ' ').trim();

/** Injected into the page; must stay self-contained for executeScript. */
function setPageTitle(customName: string, expectedOrigin: string): { applied: boolean; originalTitle?: string; reason?: string } {
  if (window.location.origin !== expectedOrigin) {
    return { applied: false, reason: 'origin-mismatch' };
  }

  const stateKey = '__keybarTitleOverride';
  type PageState = {
    originalTitle: string;
    customName: string;
    origin: string;
    observer: MutationObserver | null;
    pageshowHandler: ((event: PageTransitionEvent) => void) | null;
  };

  const pageWindow = window as unknown as Window & { [stateKey]?: PageState };
  const existing = pageWindow[stateKey];
  const state: PageState = existing ?? {
    originalTitle: document.title,
    customName,
    origin: expectedOrigin,
    observer: null,
    pageshowHandler: null,
  };

  state.customName = customName;
  state.origin = expectedOrigin;
  pageWindow[stateKey] = state;
  document.title = customName;

  if (!state.observer) {
    state.observer = new MutationObserver(() => {
      if (window.location.origin === state.origin && document.title !== state.customName) {
        document.title = state.customName;
      }
    });
    const titleElement = document.querySelector('head > title');
    state.observer.observe(titleElement ?? document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  if (!state.pageshowHandler) {
    state.pageshowHandler = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      void chrome.runtime
        .sendMessage({ action: 'tabs:title-bfcache-check' })
        .then((response: { customName?: string; restore?: boolean } | undefined) => {
          const current = pageWindow[stateKey];

          if (!current) {
            return;
          }

          if (response?.customName && window.location.origin === current.origin) {
            current.customName = response.customName;
            document.title = response.customName;
            return;
          }

          if (response?.restore) {
            current.observer?.disconnect();
            if (current.pageshowHandler) {
              window.removeEventListener('pageshow', current.pageshowHandler);
            }
            const originalTitle = current.originalTitle;
            delete pageWindow[stateKey];
            document.title = originalTitle;
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener('pageshow', state.pageshowHandler);
  }

  return { applied: true, originalTitle: state.originalTitle };
}

/** Injected into the page; must stay self-contained for executeScript. */
function restorePageTitle(
  originalTitle: string,
  customName: string,
  expectedOrigin: string,
): { restored: boolean } {
  const stateKey = '__keybarTitleOverride';
  type PageState = {
    originalTitle: string;
    customName: string;
    origin: string;
    observer: MutationObserver | null;
    pageshowHandler: ((event: PageTransitionEvent) => void) | null;
  };

  const pageWindow = window as unknown as Window & { [stateKey]?: PageState };
  const state = pageWindow[stateKey];

  if (
    window.location.origin !== expectedOrigin ||
    !state ||
    state.origin !== expectedOrigin ||
    state.customName !== customName
  ) {
    return { restored: false };
  }

  state.observer?.disconnect();
  if (state.pageshowHandler) {
    window.removeEventListener('pageshow', state.pageshowHandler);
  }
  delete pageWindow[stateKey];
  document.title = originalTitle;
  return { restored: true };
}

export const applyPageTitleOverride = async (
  tabId: number,
  customName: string,
  expectedOrigin: string,
): Promise<TitleOverrideResult> => {
  const normalizedName = normalizeTitle(customName);

  if (!normalizedName) {
    return { success: false, reason: 'empty-title' };
  }

  const tab = await chrome.tabs.get(tabId);
  const origin = getHttpOrigin(tab.url);

  if (!origin || origin !== expectedOrigin) {
    return { success: false, reason: 'origin-mismatch' };
  }

  if (!isScriptableHttpUrl(tab.url)) {
    return { success: false, reason: 'unsupported-page' };
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: setPageTitle,
      args: [normalizedName, expectedOrigin],
    });
    const applied = result?.result;

    if (!applied?.applied || typeof applied.originalTitle !== 'string') {
      return { success: false, reason: (applied?.reason as TitleOverrideReason) ?? 'injection-failed' };
    }

    return { success: true, originalTitle: applied.originalTitle };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot access|Missing host permission|Cannot access contents/i.test(message)) {
      return { success: false, reason: 'site-access-required' };
    }

    return { success: false, reason: 'injection-failed' };
  }
};

export const restorePageTitleOverride = async (
  tabId: number,
  originalTitle: string,
  customName: string,
  expectedOrigin: string,
): Promise<TitleRestoreResult> => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  if (!tab) {
    return { success: false, reason: 'restore-failed' };
  }

  const origin = getHttpOrigin(tab.url);

  if (!origin || origin !== expectedOrigin) {
    return { success: false, reason: 'origin-mismatch' };
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: restorePageTitle,
      args: [originalTitle, customName, expectedOrigin],
    });

    if (!result?.result?.restored) {
      return { success: false, reason: 'title-not-overridden' };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot access|Missing host permission|Cannot access contents/i.test(message)) {
      return { success: false, reason: 'site-access-required' };
    }

    return { success: false, reason: 'restore-failed' };
  }
};
