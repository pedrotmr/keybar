/*
 * Run this source with BrowserOS neo's `run` tool. Set `benchmarkOptions` for
 * one bounded batch. It keeps the fixture tab active, stops Keybar from the
 * background serviceworker-internals page, and sends a test-only activation
 * through the benchmark-only fixture content script.
 */
const defaultBenchmarkOptions = {
  extensionId: 'lnflcdainoeimligocpijlehbfiokfmb',
  fixtureOrigin: 'http://127.0.0.1:8770',
  surface: 'command-bar',
  count: 5,
  cold: true,
  cell: 'unspecified',
  resultTimeoutMs: 8000,
  workerStopTimeoutMs: 25000,
};

export const setKeybarFixtureLayoutMcp = async (
  browser,
  { layout, fixtureOrigin = defaultBenchmarkOptions.fixtureOrigin, resultTimeoutMs = 25000 },
) => {
  if (!['single', 'four', 'hundred', 'cleanup'].includes(layout)) {
    throw new Error(`Unsupported fixture layout: ${layout}`);
  }
  if (fixtureOrigin !== defaultBenchmarkOptions.fixtureOrigin) {
    throw new Error('Activation benchmark builds only match the fixed 127.0.0.1:8770 fixture origin');
  }

  const pages = await browser.pages.list();
  const windows = await browser.windows({});
  const activeWindow = windows.windows.find((window) => window.isActive);
  const fixtureInfo = pages.find(
    (page) =>
      page.windowId === activeWindow?.windowId && page.isActive && page.url.startsWith(`${fixtureOrigin}/fixture`),
  );
  if (!fixtureInfo) {
    throw new Error('The active BrowserOS tab is not a Keybar activation fixture page');
  }

  const fixture = browser.page(fixtureInfo.pageId);
  await fixture.evaluateInPage(
    ({ requestedLayout }) => {
      window.dispatchEvent(
        new CustomEvent('keybar:activation-benchmark-layout', { detail: { layout: requestedLayout } }),
      );
      return true;
    },
    { requestedLayout: layout },
  );
  const resultWait = await fixture.waitForSelector('html[data-keybar-benchmark-layout-result]', {
    timeout: resultTimeoutMs,
  });
  if (!resultWait.matched) {
    throw new Error(`The ${layout} fixture layout did not finish within ${resultTimeoutMs} ms`);
  }

  const result = await fixture.evaluateInPage(() => {
    const serialized = document.documentElement.getAttribute('data-keybar-benchmark-layout-result');
    return serialized ? JSON.parse(serialized) : null;
  });
  if (!result.value?.success) {
    throw new Error(`Fixture layout failed: ${JSON.stringify(result.value)}`);
  }
  return { ok: true, layout, ...result.value };
};

export const runKeybarColdActivationMcp = async (browser, options = defaultBenchmarkOptions) => {
  const {
    extensionId = 'lnflcdainoeimligocpijlehbfiokfmb',
    fixtureOrigin = 'http://127.0.0.1:8770',
    surface = 'command-bar',
    count = 5,
    cold = true,
    cell = 'unspecified',
    resultTimeoutMs = 8000,
    workerStopTimeoutMs = 25000,
    waitForResult = true,
    reuseDocument = false,
    keepDocument = false,
    warmWorker = false,
  } = options;
  if (!['command-bar', 'tab-switcher'].includes(surface)) {
    throw new Error(`Unsupported surface: ${surface}`);
  }
  if (fixtureOrigin !== 'http://127.0.0.1:8770') {
    throw new Error('Activation benchmark builds only match the fixed 127.0.0.1:8770 fixture origin');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('count must be a positive integer');
  }

  const workerScope = `chrome-extension://${extensionId}/`;
  const fixturePrefix = `${fixtureOrigin}/fixture`;
  const mode = surface === 'tab-switcher' ? 'tabs' : 'commands';
  let pages = await browser.pages.list();
  const windows = await browser.windows({});
  const activeWindow = windows.windows.find((window) => window.isActive);
  if (!activeWindow) {
    throw new Error('No active BrowserOS window is available');
  }

  const findActiveFixture = () =>
    pages.find(
      (page) => page.windowId === activeWindow.windowId && page.isActive && page.url.startsWith(fixturePrefix),
    );

  let fixtureInfo = findActiveFixture();
  if (!fixtureInfo) {
    throw new Error(`The active tab in window ${activeWindow.windowId} is not a Keybar fixture page`);
  }
  const fixture = browser.page(fixtureInfo.pageId);
  const installProbe = async () => {
    const result = await fixture.evaluateInPage(
      ({ cell: sampleCell, hostId }) => {
        const root = document.documentElement;
        root.setAttribute('data-keybar-activation-benchmark', '');
        const sample = Number(localStorage.getItem('keybarActivationBenchmarkSample') || '0') + 1;
        localStorage.setItem('keybarActivationBenchmarkSample', String(sample));
        const events = [];
        let triggerResponse = null;
        let warmupResponse = null;
        let currentSample = sample;
        let sawHost = false;
        let wasVisible = false;
        let activation = 0;
        let focused = false;

        const record = (name, details = {}) => {
          events.push({
            cell: sampleCell,
            sample: currentSample,
            name,
            epochMs: performance.timeOrigin + performance.now(),
            perfMs: performance.now(),
            ...details,
          });
        };
        const isVisible = (host) => {
          const style = getComputedStyle(host);
          const rect = host.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const inspect = () => {
          const host = document.getElementById(hostId);
          if (host && !sawHost) {
            sawHost = true;
            record('hostInjected');
          }
          const visible = Boolean(host && isVisible(host));
          if (visible && !wasVisible) {
            activation += 1;
            focused = false;
            root.removeAttribute('data-keybar-benchmark-host-hidden');
            record('hostShown', { activation });
          } else if (!visible && wasVisible) {
            root.setAttribute('data-keybar-benchmark-host-hidden', 'true');
          }
          wasVisible = visible;
        };
        const observer = new MutationObserver(inspect);
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['style', 'class', 'aria-hidden'],
          childList: true,
          subtree: true,
        });
        document.addEventListener(
          'focusin',
          (event) => {
            const host = document.getElementById(hostId);
            if (!focused && host && isVisible(host) && event.composedPath().includes(host)) {
              focused = true;
              record('focused', { activation });
            }
          },
          true,
        );
        window.addEventListener('keybar:activation-benchmark-stage', (event) => {
          const { stage, surface } = event.detail || {};
          if (stage === 'surfaceRendered') {
            record('surfaceShown', { activation, surface });
          }
          if (stage === 'firstResultVisible') {
            record('firstResultVisible', { activation, surface });
            root.dataset.keybarBenchmarkResultVisible = String(activation);
          }
        });
        window.addEventListener('keybar:activation-benchmark-trigger-result', (event) => {
          triggerResponse = event.detail?.response ?? null;
          root.setAttribute('data-keybar-benchmark-trigger-complete', 'true');
        });
        window.addEventListener('keybar:activation-benchmark-warmup-result', (event) => {
          warmupResponse = event.detail?.response ?? null;
          root.setAttribute('data-keybar-benchmark-warmup-complete', 'true');
        });
        window.__keybarColdActivationProbe = {
          read: () => ({
            cell: sampleCell,
            sample: currentSample,
            events,
            triggerResponse,
            warmupResponse,
            bridgeState: {
              ready: root.hasAttribute('data-keybar-benchmark-trigger-ready'),
              received: root.hasAttribute('data-keybar-benchmark-trigger-received'),
              detail: root.getAttribute('data-keybar-benchmark-trigger-detail'),
              benchmark: root.hasAttribute('data-keybar-activation-benchmark'),
              resultVisibleAt: root.getAttribute('data-keybar-benchmark-result-visible-at'),
              triggerComplete: root.hasAttribute('data-keybar-benchmark-trigger-complete'),
            },
          }),
          reset: () => {
            currentSample += 1;
            events.length = 0;
            triggerResponse = null;
            warmupResponse = null;
            activation = 0;
            focused = false;
            wasVisible = false;
            root.removeAttribute('data-keybar-benchmark-result-visible-at');
            root.removeAttribute('data-keybar-benchmark-result-visible');
            root.removeAttribute('data-keybar-benchmark-trigger-received');
            root.removeAttribute('data-keybar-benchmark-trigger-detail');
            root.removeAttribute('data-keybar-benchmark-trigger-complete');
            root.removeAttribute('data-keybar-benchmark-warmup-complete');
            root.removeAttribute('data-keybar-benchmark-host-hidden');
            return {
              ready: true,
              bridgeReady: root.hasAttribute('data-keybar-benchmark-trigger-ready'),
              sample: currentSample,
              hostPresent: Boolean(document.getElementById(hostId)),
            };
          },
          disconnect: () => observer.disconnect(),
        };
        inspect();
        return {
          ready: true,
          bridgeReady: root.hasAttribute('data-keybar-benchmark-trigger-ready'),
          hostPresent: Boolean(document.getElementById(hostId)),
        };
      },
      { cell, hostId: `${extensionId}-command-center-surface` },
    );
    return result.value;
  };

  let internalInfo = pages.find(
    (page) => page.ownership === 'mine' && page.url.startsWith('chrome://serviceworker-internals/'),
  );
  internalInfo ??= pages.find(
    (page) => page.windowId !== activeWindow.windowId && page.url.startsWith('chrome://serviceworker-internals/'),
  );
  internalInfo ??= pages.find((page) => page.url.startsWith('chrome://serviceworker-internals/'));
  if (!internalInfo) {
    const internal = await browser.open('chrome://serviceworker-internals/');
    internalInfo = { pageId: internal.id, url: 'chrome://serviceworker-internals/' };
  }
  const internals = browser.page(internalInfo.pageId);

  const readWorker = async () => {
    const result = await internals.evaluateInPage((scope) => {
      const registration = [...document.querySelectorAll('.serviceworker-registration')].find(
        (candidate) => candidate.querySelector('.serviceworker-scope .value')?.textContent?.trim() === scope,
      );
      if (!registration) {
        return null;
      }
      return {
        registrationId: registration.getAttribute('data-registration-id'),
        statuses: [...registration.querySelectorAll('.serviceworker-running-status .value')].map((node) =>
          node.textContent?.trim(),
        ),
        stopButtons: registration.querySelectorAll('cr-button[data-command="stop"]').length,
      };
    }, workerScope);
    return result.value;
  };

  const stopWorker = async () => {
    const before = await readWorker();
    if (!before) {
      throw new Error(`Keybar worker scope was not found: ${workerScope}`);
    }

    if (!before.statuses.length || before.statuses.some((status) => status !== 'STOPPED')) {
      await internals.evaluateInPage(
        (scope) => {
          document.body.removeAttribute('data-keybar-benchmark-worker-stopped');
          const read = () => {
            const registration = [...document.querySelectorAll('.serviceworker-registration')].find(
              (candidate) => candidate.querySelector('.serviceworker-scope .value')?.textContent?.trim() === scope,
            );
            if (!registration) {
              return null;
            }
            return [...registration.querySelectorAll('.serviceworker-running-status .value')].map((node) =>
              node.textContent?.trim(),
            );
          };
          const markStopped = () => {
            const statuses = read();
            if (statuses?.length && statuses.every((status) => status === 'STOPPED')) {
              document.body.setAttribute('data-keybar-benchmark-worker-stopped', 'true');
              observer.disconnect();
              return true;
            }
            return false;
          };
          const observer = new MutationObserver(markStopped);
          observer.observe(document.body, { childList: true, characterData: true, subtree: true });
          if (markStopped()) {
            return { stopped: true };
          }
          const registration = [...document.querySelectorAll('.serviceworker-registration')].find(
            (candidate) => candidate.querySelector('.serviceworker-scope .value')?.textContent?.trim() === scope,
          );
          if (!registration) {
            throw new Error(`Keybar worker scope was not found: ${scope}`);
          }
          const buttons = [...registration.querySelectorAll('cr-button[data-command="stop"]')];
          if (!buttons.length && read()?.includes('RUNNING')) {
            throw new Error('Keybar worker is running without a Stop button');
          }
          buttons.forEach((button) => button.click());
          return { stopped: false, statuses: read() };
        },
        workerScope,
        { settle: true },
      );
      const wait = await internals.waitForSelector('body[data-keybar-benchmark-worker-stopped="true"]', {
        timeout: workerStopTimeoutMs,
      });
      if (!wait.matched) {
        const current = await readWorker();
        throw new Error(`Keybar worker did not stop: ${JSON.stringify(current)}`);
      }
    }

    const after = await readWorker();
    if (!after || !after.statuses.length || after.statuses.some((status) => status !== 'STOPPED')) {
      throw new Error(`Keybar worker did not stop: ${JSON.stringify(after)}`);
    }
    return after;
  };

  const assertFixtureStillActive = async () => {
    pages = await browser.pages.list();
    fixtureInfo = pages.find((page) => page.pageId === fixture.id);
    if (!fixtureInfo?.isActive || fixtureInfo.windowId !== activeWindow.windowId) {
      throw new Error('The fixture lost focus during cold-worker setup');
    }
    const visibility = await fixture.evaluateInPage('return document.visibilityState');
    if (visibility.value !== 'visible') {
      throw new Error(`The fixture is not visible: ${visibility.value}`);
    }
  };

  const samples = [];
  const originalFixtureUrl = fixtureInfo.url;
  for (let index = 0; index < count; index += 1) {
    try {
      const fixtureTabNumber = originalFixtureUrl.match(/[?&]tab=(\d+)/)?.[1] ?? '0000';
      const cellIdentifier = String(cell).replace(/[^a-z0-9_-]/gi, '-');
      const sampleUrl = `${fixtureOrigin}/fixture?tab=${fixtureTabNumber}&cell=${cellIdentifier}&sample=${Date.now()}-${index}&extensionId=${encodeURIComponent(extensionId)}`;
      let probeBefore;
      if (reuseDocument) {
        const closed = await fixture.waitForSelector('html[data-keybar-benchmark-host-hidden="true"]', {
          timeout: 3000,
        });
        if (!closed.matched) {
          throw new Error('The previous warm surface was not closed before the next sample');
        }
        const reset = await fixture.evaluateInPage('return window.__keybarColdActivationProbe?.reset?.() ?? null');
        probeBefore = reset.value;
      } else {
        await fixture.goto(sampleUrl);
        probeBefore = await installProbe();
      }
      if (
        !probeBefore?.ready ||
        !probeBefore.bridgeReady ||
        (reuseDocument ? !probeBefore.hostPresent : probeBefore.hostPresent)
      ) {
        throw new Error('Benchmark content-script bridge did not load in the expected fixture state');
      }

      await assertFixtureStillActive();
      if (!cold && warmWorker) {
        await fixture.evaluateInPage(() => {
          document.documentElement.removeAttribute('data-keybar-benchmark-warmup-complete');
          window.dispatchEvent(new CustomEvent('keybar:activation-benchmark-warmup'));
          return true;
        });
        const warmup = await fixture.waitForSelector('html[data-keybar-benchmark-warmup-complete="true"]', {
          timeout: resultTimeoutMs,
        });
        if (!warmup.matched) {
          throw new Error('Benchmark warmup did not reach the background worker');
        }
        const warmupProbe = await fixture.evaluateInPage(
          'return window.__keybarColdActivationProbe?.read?.()?.warmupResponse ?? null',
        );
        if (warmupProbe.value?.success !== true) {
          throw new Error(`Benchmark warmup was rejected: ${JSON.stringify(warmupProbe.value)}`);
        }
      }
      const worker = cold ? await stopWorker() : await readWorker();
      if (cold && worker.statuses.some((status) => status !== 'STOPPED')) {
        throw new Error(`Keybar worker was not stopped before activation: ${JSON.stringify(worker)}`);
      }
      if (!cold && (!worker?.statuses?.includes('RUNNING') || worker.statuses.some((status) => status !== 'RUNNING'))) {
        throw new Error(`Keybar worker was not running before warm activation: ${JSON.stringify(worker)}`);
      }
      await assertFixtureStillActive();
      const workerBeforeTrigger = await readWorker();
      if (
        !workerBeforeTrigger ||
        !workerBeforeTrigger.statuses.length ||
        workerBeforeTrigger.statuses.some((status) => status !== (cold ? 'STOPPED' : 'RUNNING'))
      ) {
        throw new Error(`Keybar worker state changed before activation: ${JSON.stringify(workerBeforeTrigger)}`);
      }

      const trigger = await fixture.evaluateInPage(
        ({ requestedMode }) => {
          const startedAt = Date.now();
          window.dispatchEvent(
            new CustomEvent('keybar:activation-benchmark-trigger', {
              detail: { mode: requestedMode, startedAt },
            }),
          );
          return { startedAt };
        },
        { requestedMode: mode },
      );

      if (!waitForResult) {
        return {
          ok: true,
          pending: true,
          pageId: fixture.id,
          surface,
          cell,
          sample: probeBefore.sample,
          workerRegistration: workerBeforeTrigger.registrationId,
          workerStopped: cold ? true : (worker?.statuses?.every((status) => status === 'STOPPED') ?? false),
          workerWarm: !cold,
          startedAt: trigger.value.startedAt,
        };
      }

      const resultWait = await fixture.waitForSelector('html[data-keybar-benchmark-result-visible-at]', {
        timeout: resultTimeoutMs,
      });
      if (!resultWait.matched) {
        const partial = await fixture.evaluateInPage('return window.__keybarColdActivationProbe?.read?.() ?? null');
        throw new Error(
          `No selected ${surface} result became visible within ${resultTimeoutMs} ms: ${JSON.stringify(partial.value)}`,
        );
      }

      const triggerComplete = await fixture.waitForSelector('html[data-keybar-benchmark-trigger-complete="true"]', {
        timeout: resultTimeoutMs,
      });
      if (!triggerComplete.matched) {
        throw new Error('Benchmark activation response did not settle before the next sample');
      }

      const probeResult = await fixture.evaluateInPage('return window.__keybarColdActivationProbe?.read?.() ?? null');
      const probe = probeResult.value;
      if (!probe) {
        throw new Error('Fixture probe disappeared before results could be read');
      }
      const activation = probe.events.find((event) => event.name === 'hostShown')?.activation;
      const events = probe.events.filter((event) => event.activation === activation);
      const hostShown = events.find((event) => event.name === 'hostShown');
      const surfaceShown = events.find((event) => event.name === 'surfaceShown');
      const focused = events.find((event) => event.name === 'focused');
      const firstResultVisible = events.find((event) => event.name === 'firstResultVisible');
      const firstResultVisibleAt = firstResultVisible?.epochMs;
      if (
        !activation ||
        !hostShown ||
        !surfaceShown ||
        surfaceShown.surface !== surface ||
        !focused ||
        !firstResultVisible ||
        firstResultVisible.surface !== surface ||
        !Number.isFinite(firstResultVisibleAt)
      ) {
        throw new Error(
          `Incomplete activation stages: ${JSON.stringify({ hostShown, surfaceShown, focused, firstResultVisible, firstResultVisibleAt })}`,
        );
      }
      if (probe.triggerResponse && probe.triggerResponse.success === false) {
        throw new Error(`Benchmark activation was rejected: ${JSON.stringify(probe.triggerResponse)}`);
      }

      const startedAt = trigger.value.startedAt;
      const duration = (event) => Number((event.epochMs - startedAt).toFixed(1));
      samples.push({
        index,
        surface,
        cell,
        fixtureSample: probe.sample,
        workerRegistration: workerBeforeTrigger.registrationId,
        workerStopped: cold,
        workerWarm: !cold,
        latencyMs: {
          hostShown: duration(hostShown),
          surfaceShown: duration(surfaceShown),
          focused: duration(focused),
          firstResultVisible: Number((firstResultVisibleAt - startedAt).toFixed(1)),
        },
      });

      if (reuseDocument && index < count - 1) {
        await fixture.press('Escape');
        const closed = await fixture.waitForSelector('html[data-keybar-benchmark-host-hidden="true"]', {
          timeout: 3000,
        });
        if (!closed.matched) {
          throw new Error('The warm surface did not close before the next sample');
        }
      }
    } catch (error) {
      await fixture.goto(originalFixtureUrl).catch(() => undefined);
      return {
        ok: false,
        surface,
        cell,
        cold,
        completed: samples,
        failedIndex: index,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const sorted = samples.map((sample) => sample.latencyMs.firstResultVisible).sort((a, b) => a - b);
  const percentile95 = sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
  if (!keepDocument) {
    await fixture.goto(originalFixtureUrl);
  }
  return { ok: true, surface, cell, cold, count: samples.length, p95FirstResultVisibleMs: percentile95, samples };
};

export const collectKeybarColdActivationMcp = async (
  browser,
  {
    pageId,
    startedAt,
    surface = 'command-bar',
    cell = 'unspecified',
    resultTimeoutMs = 25000,
    index = 0,
    warm = false,
  },
) => {
  const fixture = browser.page(pageId);
  const wait = await fixture.waitForSelector('html[data-keybar-benchmark-result-visible-at]', {
    timeout: resultTimeoutMs,
  });
  if (!wait.matched) {
    const partial = await fixture.evaluateInPage('return window.__keybarColdActivationProbe?.read?.() ?? null');
    return {
      ok: false,
      pending: false,
      failedIndex: index,
      surface,
      cell,
      error: `No selected ${surface} result became visible within ${resultTimeoutMs} ms: ${JSON.stringify(partial.value)}`,
    };
  }

  const triggerComplete = await fixture.waitForSelector('html[data-keybar-benchmark-trigger-complete="true"]', {
    timeout: resultTimeoutMs,
  });
  if (!triggerComplete.matched) {
    throw new Error('Benchmark activation response did not settle before the next sample');
  }

  const probeResult = await fixture.evaluateInPage('return window.__keybarColdActivationProbe?.read?.() ?? null');
  const probe = probeResult.value;
  if (!probe) {
    throw new Error('Fixture probe disappeared before results could be read');
  }

  const activation = probe.events.find((event) => event.name === 'hostShown')?.activation;
  const events = probe.events.filter((event) => event.activation === activation);
  const hostShown = events.find((event) => event.name === 'hostShown');
  const hostInjected = probe.events.find((event) => event.name === 'hostInjected');
  const surfaceShown = events.find((event) => event.name === 'surfaceShown');
  const focused = events.find((event) => event.name === 'focused');
  const firstResultVisible = events.find((event) => event.name === 'firstResultVisible');
  const firstResultVisibleAt = firstResultVisible?.epochMs;
  if (
    !activation ||
    (!warm && !hostInjected) ||
    !hostShown ||
    !surfaceShown ||
    surfaceShown.surface !== surface ||
    !focused ||
    !firstResultVisible ||
    firstResultVisible.surface !== surface ||
    firstResultVisible.activation !== activation ||
    !Number.isFinite(firstResultVisibleAt)
  ) {
    throw new Error(
      `Incomplete activation stages: ${JSON.stringify({ hostShown, surfaceShown, focused, firstResultVisible, firstResultVisibleAt })}`,
    );
  }

  if (probe.triggerResponse && probe.triggerResponse.success === false) {
    throw new Error(`Benchmark activation was rejected: ${JSON.stringify(probe.triggerResponse)}`);
  }

  const duration = (event) => Number((event.epochMs - startedAt).toFixed(1));
  return {
    ok: true,
    pending: false,
    sample: {
      index,
      surface,
      cell,
      fixtureSample: probe.sample,
      workerStopped: !warm,
      workerWarm: warm,
      latencyMs: {
        hostInjected: hostInjected ? duration(hostInjected) : null,
        hostShown: duration(hostShown),
        surfaceShown: duration(surfaceShown),
        focused: duration(focused),
        firstResultVisible: Number((firstResultVisibleAt - startedAt).toFixed(1)),
      },
    },
  };
};
