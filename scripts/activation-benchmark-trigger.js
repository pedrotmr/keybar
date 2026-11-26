(() => {
  const triggerEvent = 'keybar:activation-benchmark-trigger';
  const resultEvent = 'keybar:activation-benchmark-trigger-result';
  const warmupEvent = 'keybar:activation-benchmark-warmup';
  const warmupResultEvent = 'keybar:activation-benchmark-warmup-result';
  const layoutEvent = 'keybar:activation-benchmark-layout';
  const layoutResultEvent = 'keybar:activation-benchmark-layout-result';
  let pending = false;

  if (location.origin !== 'http://127.0.0.1:8770' || location.pathname !== '/fixture') {
    return;
  }

  const markBridgeReady = () => {
    if (!document.documentElement) {
      return false;
    }
    document.documentElement.setAttribute('data-keybar-benchmark-trigger-ready', '');
    return true;
  };
  if (!markBridgeReady()) {
    const observer = new MutationObserver(() => {
      if (markBridgeReady()) {
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true });
  }

  window.addEventListener(triggerEvent, (event) => {
    document.documentElement?.setAttribute('data-keybar-benchmark-trigger-received', '');
    document.documentElement?.setAttribute(
      'data-keybar-benchmark-trigger-detail',
      `${event.detail?.mode ?? 'missing-mode'}:${event.detail?.startedAt ?? 'missing-time'}`,
    );
    if (pending || !document.documentElement?.hasAttribute('data-keybar-activation-benchmark')) {
      return;
    }

    const { mode, startedAt } = event.detail ?? {};
    if ((mode !== 'commands' && mode !== 'tabs') || !Number.isFinite(startedAt)) {
      return;
    }

    pending = true;
    void chrome.runtime
      .sendMessage({ action: 'benchmark:activate', mode, startedAt })
      .then((response) => {
        window.dispatchEvent(new CustomEvent(resultEvent, { detail: { response } }));
      })
      .catch((error) => {
        window.dispatchEvent(
          new CustomEvent(resultEvent, {
            detail: { response: { success: false, error: error instanceof Error ? error.message : String(error) } },
          }),
        );
      })
      .finally(() => {
        pending = false;
      });
  });

  window.addEventListener(warmupEvent, () => {
    if (pending || !document.documentElement?.hasAttribute('data-keybar-activation-benchmark')) {
      return;
    }

    pending = true;
    void chrome.runtime
      .sendMessage({ action: 'benchmark:warmup' })
      .then((response) => {
        window.dispatchEvent(new CustomEvent(warmupResultEvent, { detail: { response } }));
      })
      .catch((error) => {
        window.dispatchEvent(
          new CustomEvent(warmupResultEvent, {
            detail: { response: { success: false, error: error instanceof Error ? error.message : String(error) } },
          }),
        );
      })
      .finally(() => {
        pending = false;
      });
  });

  window.addEventListener(layoutEvent, (event) => {
    if (pending || !document.documentElement?.hasAttribute('data-keybar-activation-benchmark')) {
      return;
    }

    const { layout } = event.detail ?? {};
    document.documentElement.removeAttribute('data-keybar-benchmark-layout-result');
    if (layout !== 'single' && layout !== 'four' && layout !== 'hundred' && layout !== 'cleanup') {
      return;
    }

    pending = true;
    void chrome.runtime
      .sendMessage({ action: 'benchmark:fixture-layout', layout })
      .then((response) => {
        document.documentElement?.setAttribute('data-keybar-benchmark-layout-result', JSON.stringify(response));
        window.dispatchEvent(new CustomEvent(layoutResultEvent, { detail: { response } }));
      })
      .catch((error) => {
        const response = { success: false, error: error instanceof Error ? error.message : String(error) };
        document.documentElement?.setAttribute('data-keybar-benchmark-layout-result', JSON.stringify(response));
        window.dispatchEvent(
          new CustomEvent(layoutResultEvent, {
            detail: { response },
          }),
        );
      })
      .finally(() => {
        pending = false;
      });
  });
})();
