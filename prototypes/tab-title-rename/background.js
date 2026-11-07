const OVERRIDES_KEY = 'titleOverrides';
let overrideMutationTail = Promise.resolve();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    void applySavedTitle(tabId, tab.url);
  }
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.tabs.query({}).then((tabs) => Promise.all(tabs.map((tab) => applySavedTitle(tab.id, tab.url))));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'title:apply') {
    void applyTitle(message.tabId, message.customName, message.expectedOrigin).then(sendResponse, () =>
      sendResponse({ success: false, reason: 'operation-failed' }),
    );
    return true;
  }

  if (message?.action === 'title:restore') {
    void restoreTitle(message.tabId).then(sendResponse, () =>
      sendResponse({ success: false, reason: 'operation-failed' }),
    );
    return true;
  }
});

async function applyTitle(tabId, customName, expectedOrigin, expectedCustomName) {
  const normalizedName = normalizeTitle(customName);

  if (!normalizedName) return { success: false, reason: 'empty-title' };

  return withOverridesMutation(async (overrides) => {
    const tab = await chrome.tabs.get(tabId);
    const origin = getOrigin(tab.url);

    if (!origin || origin !== expectedOrigin) {
      return { success: false, reason: 'origin-mismatch' };
    }

    if (expectedCustomName) {
      const saved = overrides[String(tabId)];

      if (saved?.origin !== expectedOrigin || saved.customName !== expectedCustomName) {
        return { success: false, reason: 'stale-override' };
      }
    }

    const hasAccess = await chrome.permissions.contains({ origins: [`${origin}/*`] });

    if (!hasAccess) return { success: false, reason: 'site-access-required' };

    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: setPageTitle,
      args: [normalizedName, expectedOrigin],
    });
    const applied = result?.result;

    if (!applied?.applied) {
      return { success: false, reason: applied?.reason ?? 'injection-failed' };
    }

    overrides[String(tabId)] = {
      origin,
      customName: normalizedName,
      originalTitle: applied.originalTitle,
    };
    return { success: true, originalTitle: applied.originalTitle };
  });
}

async function applySavedTitle(tabId, url) {
  if (tabId === undefined) return;

  const { [OVERRIDES_KEY]: overrides = {} } = await chrome.storage.local.get(OVERRIDES_KEY);
  const override = overrides[String(tabId)];
  const origin = getOrigin(url);

  if (!override || origin !== override.origin) return;

  try {
    await applyTitle(tabId, override.customName, override.origin, override.customName);
  } catch {
    // The site may not have been granted after a session restore.
  }
}

async function restoreTitle(tabId) {
  return withOverridesMutation(async (overrides) => {
    const override = overrides[String(tabId)];

    if (!override) return { success: false, reason: 'no-saved-title' };

    const tab = await chrome.tabs.get(tabId);

    if (getOrigin(tab.url) !== override.origin) {
      return { success: false, reason: 'origin-mismatch' };
    }

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: restorePageTitle,
        args: [override.originalTitle ?? '', override.customName, override.origin],
      });

      if (!result?.result?.restored) {
        return { success: false, reason: 'title-not-overridden' };
      }
    } catch {
      return { success: false, reason: 'restore-failed' };
    }

    delete overrides[String(tabId)];
    return { success: true };
  });
}

function withOverridesMutation(update) {
  const mutation = overrideMutationTail.then(async () => {
    const { [OVERRIDES_KEY]: overrides = {} } = await chrome.storage.local.get(OVERRIDES_KEY);
    const result = await update(overrides);
    if (result.success) await chrome.storage.local.set({ [OVERRIDES_KEY]: overrides });
    return result;
  });

  overrideMutationTail = mutation.then(
    () => undefined,
    () => undefined,
  );
  return mutation;
}

function normalizeTitle(value) {
  return value.replace(/[\t\n\f\r ]+/g, ' ').trim();
}

function getOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function setPageTitle(customName, expectedOrigin) {
  if (window.location.origin !== expectedOrigin) {
    return { applied: false, reason: 'origin-mismatch' };
  }

  const stateKey = '__keybarTitleRenamePrototype';
  const state = window[stateKey] ?? {
    originalTitle: document.title,
    observer: null,
  };
  state.customName = customName;
  state.origin = expectedOrigin;
  window[stateKey] = state;
  document.title = customName;

  if (!state.observer) {
    state.observer = new MutationObserver(() => {
      if (window.location.origin === state.origin && document.title !== state.customName) {
        document.title = state.customName;
      }
    });
    state.observer.observe(document.head, { childList: true, characterData: true, subtree: true });
  }

  return { applied: true, originalTitle: state.originalTitle };
}

function restorePageTitle(originalTitle, customName, expectedOrigin) {
  const stateKey = '__keybarTitleRenamePrototype';
  const state = window[stateKey];

  if (
    window.location.origin !== expectedOrigin ||
    !state ||
    state.origin !== expectedOrigin ||
    state.customName !== customName
  ) {
    return { restored: false };
  }

  state?.observer?.disconnect();
  delete window[stateKey];
  document.title = originalTitle;
  return { restored: true };
}
