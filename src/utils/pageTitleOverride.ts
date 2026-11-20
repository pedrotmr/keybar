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
  { success: true; originalTitle: string } | { success: false; reason: TitleOverrideReason };

export type TitleRestoreResult = { success: true } | { success: false; reason: TitleOverrideReason };

export const normalizeCustomTabTitle = (value: string): string => value.replace(/[\t\n\f\r ]+/g, ' ').trim();

/** Injected into the page; must stay self-contained for executeScript. */
function setPageTitle(
  customName: string,
  expectedOrigin: string,
): { applied: boolean; originalTitle?: string; reason?: string } {
  if (window.location.origin !== expectedOrigin) {
    return { applied: false, reason: 'origin-mismatch' };
  }

  const stateKey = '__keybarTitleOverride';
  type PageState = {
    originalTitle: string;
    customName: string;
    origin: string;
    version: number;
    observer: MutationObserver | null;
    pageshowHandler: ((event: PageTransitionEvent) => void) | null;
  };

  const pageWindow = window as unknown as Window & { [stateKey]?: PageState };
  const existing = pageWindow[stateKey];
  const state: PageState = existing ?? {
    originalTitle: document.title,
    customName,
    origin: expectedOrigin,
    version: 0,
    observer: null,
    pageshowHandler: null,
  };

  const priorCustomName = state.customName;
  state.customName = customName;
  state.origin = expectedOrigin;
  state.version += 1;
  pageWindow[stateKey] = state;

  // Finish observer/pageshow setup before changing the title so a missing HTML
  // head (e.g. standalone SVG) cannot leave an applied title without tracking.
  let createdObserver = false;

  if (!state.observer) {
    createdObserver = true;
    state.observer = new MutationObserver(() => {
      if (window.location.origin === state.origin && document.title !== state.customName) {
        document.title = state.customName;
      }
    });
    const observeTarget = document.head ?? document.documentElement;

    if (observeTarget) {
      state.observer.observe(observeTarget, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  let createdPageshow = false;

  if (!state.pageshowHandler) {
    createdPageshow = true;
    state.pageshowHandler = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      const pending = pageWindow[stateKey];

      if (!pending) {
        return;
      }

      // Invalidate in-flight replies from earlier renames, clears, or BFCache checks.
      pending.version += 1;
      const requestVersion = pending.version;
      const requestState = pending;

      void chrome.runtime
        .sendMessage({ action: 'tabs:title-bfcache-check' })
        .then((response: { success?: boolean; data?: { customName?: string; restore?: boolean } } | undefined) => {
          const current = pageWindow[stateKey];

          // Require the same state object and version so a clear/rename on another
          // same-origin document cannot leave a stale reply free to reapply later.
          if (!current || current !== requestState || current.version !== requestVersion) {
            return;
          }

          const decision = response?.success ? response.data : undefined;

          if (decision?.customName && window.location.origin === current.origin) {
            current.customName = decision.customName;
            document.title = decision.customName;
            return;
          }

          if (decision?.restore) {
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

  document.title = customName;

  // Some HTTP(S) documents (e.g. XML) accept the assignment but leave title unchanged.
  if (document.title !== customName) {
    if (createdObserver) {
      state.observer?.disconnect();
      state.observer = null;
    }

    if (createdPageshow && state.pageshowHandler) {
      window.removeEventListener('pageshow', state.pageshowHandler);
      state.pageshowHandler = null;
    }

    if (!existing) {
      delete pageWindow[stateKey];
    } else {
      state.customName = priorCustomName;
    }

    return { applied: false, reason: 'unsupported-page' };
  }

  return { applied: true, originalTitle: state.originalTitle };
}

/** Injected into the page; must stay self-contained for executeScript. */
function restorePageTitle(_storageTitle: string, _customName: string, expectedOrigin: string): { restored: boolean } {
  const stateKey = '__keybarTitleOverride';
  type PageState = {
    originalTitle: string;
    customName: string;
    origin: string;
    version: number;
    observer: MutationObserver | null;
    pageshowHandler: ((event: PageTransitionEvent) => void) | null;
  };

  const pageWindow = window as unknown as Window & { [stateKey]?: PageState };
  const state = pageWindow[stateKey];

  // Clear any Keybar-owned override on this origin. A BFCache document may still
  // hold an older customName than storage after same-origin navigation.
  if (window.location.origin !== expectedOrigin || !state || state.origin !== expectedOrigin) {
    return { restored: false };
  }

  // Bump so in-flight BFCache replies cannot reapply a cleared override.
  state.version += 1;
  state.observer?.disconnect();
  if (state.pageshowHandler) {
    window.removeEventListener('pageshow', state.pageshowHandler);
  }
  delete pageWindow[stateKey];
  // Prefer the title captured for this document — storage may still hold a prior page's title.
  document.title = state.originalTitle;
  return { restored: true };
}

export const applyPageTitleOverride = async (
  tabId: number,
  customName: string,
  expectedOrigin: string,
): Promise<TitleOverrideResult> => {
  const normalizedName = normalizeCustomTabTitle(customName);

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
      args: [originalTitle, normalizeCustomTabTitle(customName), expectedOrigin],
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
