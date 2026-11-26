/*
 * Paste this file into BrowserOS neo's `run` tool and append:
 *   return await runKeybarColdActivationMcp(browser, { surface: 'command-bar', count: 2 });
 *
 * For split sampling, pass `waitForResult: false`, retain its `activationId`,
 * `pageId`, `startedPerfMs`, `restoreUrl`, `keepDocument`, and verified worker
 * fields, then pass those fields to `collectKeybarColdActivationMcp` in a later
 * run. Reused-document warm batches require a one-sample `keepDocument`
 * activation first; close its surface with Escape before setting
 * `reuseDocument: true`.
 *
 * The runner keeps the fixture active, stops Keybar from the background
 * serviceworker-internals page, and sends a test-only activation through the
 * benchmark-only fixture content script.
 */
const defaultBenchmarkOptions = {
  extensionId: 'lnflcdainoeimligocpijlehbfiokfmb',
  fixtureOrigin: 'http://127.0.0.1:8770',
  surface: 'command-bar',
  count: 2,
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
  const activeWindow =
    windows.windows.find((window) => window.isActive) ??
    (windows.windows.length === 1 ? windows.windows[0] : undefined);
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
      document.documentElement.setAttribute('data-keybar-activation-benchmark', '');
      document.documentElement.removeAttribute('data-keybar-benchmark-layout-result');
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
  if (!result.value?.success || result.value.layout !== layout) {
    throw new Error(`Fixture layout failed: ${JSON.stringify(result.value)}`);
  }
  return { ok: true, layout, ...result.value };
};

export const runKeybarColdActivationMcp = async (browser, options = defaultBenchmarkOptions) => {
  const {
    extensionId = 'lnflcdainoeimligocpijlehbfiokfmb',
    fixtureOrigin = 'http://127.0.0.1:8770',
    surface = 'command-bar',
    count = 2,
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
  if (!waitForResult && count !== 1) {
    throw new Error('Split collection supports one pending activation per runner call');
  }

  const workerScope = `chrome-extension://${extensionId}/`;
  const fixturePrefix = `${fixtureOrigin}/fixture`;
  const mode = surface === 'tab-switcher' ? 'tabs' : 'commands';
  let pages = await browser.pages.list();
  const windows = await browser.windows({});
  const activeWindow =
    windows.windows.find((window) => window.isActive) ??
    (windows.windows.length === 1 ? windows.windows[0] : undefined);
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
        let currentActivationId = null;
        let sawHost = false;
        let wasVisible = false;
        let activation = 0;
        let focused = false;

        const record = (name, details = {}) => {
          const perfMs = performance.now();
          events.push({
            cell: sampleCell,
            sample: currentSample,
            name,
            activationId: currentActivationId,
            epochMs: performance.timeOrigin + perfMs,
            perfMs,
            ...details,
          });
        };
        const isVisible = (host) => {
          const style = getComputedStyle(host);
          const rect = host.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        let insertionObserver;
        let hostObserver;
        const inspect = () => {
          const host = document.getElementById(hostId);
          if (host && !sawHost) {
            sawHost = true;
            record('hostInjected');
            insertionObserver.disconnect();
            hostObserver = new MutationObserver(inspect);
            hostObserver.observe(host, {
              attributes: true,
              attributeFilter: ['style', 'class', 'aria-hidden', 'popover'],
            });
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
        insertionObserver = new MutationObserver(inspect);
        insertionObserver.observe(root, { childList: true });
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
          if (stage === 'surfaceFocused' && !focused) {
            focused = true;
            record('focused', { activation, surface });
          }
          if (stage === 'surfaceRendered') {
            record('surfaceShown', { activation, surface });
          }
          if (stage === 'firstResultAfterPaintOpportunity') {
            record('firstResultAfterPaintOpportunity', { activation, surface });
            root.dataset.keybarBenchmarkResultAfterPaintOpportunity = String(activation);
          }
        });
        window.addEventListener('keybar:activation-benchmark-trigger', (event) => {
          currentActivationId = event.detail?.activationId ?? null;
        });
        window.addEventListener('keybar:activation-benchmark-trigger-result', (event) => {
          triggerResponse = {
            activationId: event.detail?.activationId ?? null,
            response: event.detail?.response ?? null,
          };
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
              resultAfterPaintOpportunityAt: root.getAttribute(
                'data-keybar-benchmark-result-after-paint-opportunity-at',
              ),
              triggerComplete: root.hasAttribute('data-keybar-benchmark-trigger-complete'),
            },
          }),
          reset: () => {
            currentSample += 1;
            events.length = 0;
            triggerResponse = null;
            warmupResponse = null;
            currentActivationId = null;
            activation = 0;
            focused = false;
            wasVisible = false;
            root.removeAttribute('data-keybar-benchmark-result-after-paint-opportunity-at');
            root.removeAttribute('data-keybar-benchmark-result-after-paint-opportunity');
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
          disconnect: () => {
            insertionObserver.disconnect();
            hostObserver?.disconnect();
          },
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
          let stopRequested = false;
          const stopIfRunning = () => {
            const statuses = read();
            if (statuses?.length && statuses.every((status) => status === 'STOPPED')) {
              document.body.setAttribute('data-keybar-benchmark-worker-stopped', 'true');
              observer.disconnect();
              return true;
            }

            if (statuses?.some((status) => status === 'STARTING' || status === 'STOPPING')) {
              stopRequested = false;
            }
            if (statuses?.includes('RUNNING') && !stopRequested) {
              const registration = [...document.querySelectorAll('.serviceworker-registration')].find(
                (candidate) => candidate.querySelector('.serviceworker-scope .value')?.textContent?.trim() === scope,
              );
              const buttons = [...(registration?.querySelectorAll('cr-button[data-command="stop"]') ?? [])];
              if (buttons.length) {
                stopRequested = true;
                buttons.forEach((button) => button.click());
              }
            }
            return false;
          };
          const observer = new MutationObserver(stopIfRunning);
          observer.observe(document.body, { childList: true, characterData: true, subtree: true });
          if (stopIfRunning()) {
            return { stopped: true };
          }
          const registration = [...document.querySelectorAll('.serviceworker-registration')].find(
            (candidate) => candidate.querySelector('.serviceworker-scope .value')?.textContent?.trim() === scope,
          );
          if (!registration) {
            throw new Error(`Keybar worker scope was not found: ${scope}`);
          }
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
      const sampleUrl = `${fixtureOrigin}/fixture?tab=${fixtureTabNumber}&cell=${cellIdentifier}&sample=${Date.now()}-${index}`;
      let probeBefore;
      if (reuseDocument) {
        const existingProbe = await fixture.evaluateInPage(
          ({ hostId }) => ({
            probeReady: Boolean(window.__keybarColdActivationProbe?.reset),
            hostPresent: Boolean(document.getElementById(hostId)),
          }),
          { hostId: `${extensionId}-command-center-surface` },
        );
        if (!existingProbe.value?.probeReady || !existingProbe.value.hostPresent) {
          throw new Error('reuseDocument requires a prior keepDocument activation that injected the surface host');
        }
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

      const activationId = `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
      const trigger = await fixture.evaluateInPage(
        ({ requestedMode, requestedActivationId }) => {
          const startedAt = Date.now();
          const startedPerfMs = performance.now();
          window.dispatchEvent(
            new CustomEvent('keybar:activation-benchmark-trigger', {
              detail: { mode: requestedMode, startedAt, activationId: requestedActivationId },
            }),
          );
          return { startedAt, startedPerfMs, activationId: requestedActivationId };
        },
        { requestedMode: mode, requestedActivationId: activationId },
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
          workerStatuses: [...workerBeforeTrigger.statuses],
          workerStopped: workerBeforeTrigger.statuses.every((status) => status === 'STOPPED'),
          workerWarm: workerBeforeTrigger.statuses.every((status) => status === 'RUNNING'),
          startedAt: trigger.value.startedAt,
          startedPerfMs: trigger.value.startedPerfMs,
          activationId: trigger.value.activationId,
          restoreUrl: originalFixtureUrl,
          keepDocument,
        };
      }

      const resultWait = await fixture.waitForSelector(
        'html[data-keybar-benchmark-result-after-paint-opportunity-at]',
        {
          timeout: resultTimeoutMs,
        },
      );
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
      const events = probe.events.filter((event) => event.activationId === activationId);
      const activation = events.find((event) => event.name === 'hostShown')?.activation;
      const hostShown = events.find((event) => event.name === 'hostShown');
      const surfaceShown = events.find((event) => event.name === 'surfaceShown');
      const focused = events.find((event) => event.name === 'focused' && event.activation === activation);
      const firstResultAfterPaintOpportunity = events.find(
        (event) => event.name === 'firstResultAfterPaintOpportunity',
      );
      const firstResultAfterPaintOpportunityAt = firstResultAfterPaintOpportunity?.perfMs;
      if (
        !activation ||
        !hostShown ||
        !surfaceShown ||
        surfaceShown.surface !== surface ||
        !focused ||
        !firstResultAfterPaintOpportunity ||
        firstResultAfterPaintOpportunity.surface !== surface ||
        !Number.isFinite(firstResultAfterPaintOpportunityAt)
      ) {
        throw new Error(
          `Incomplete activation stages: ${JSON.stringify({ hostShown, surfaceShown, focused, firstResultAfterPaintOpportunity, firstResultAfterPaintOpportunityAt })}`,
        );
      }
      if (probe.triggerResponse?.activationId !== activationId) {
        throw new Error(
          `Benchmark response did not match activation ${activationId}: ${JSON.stringify(probe.triggerResponse)}`,
        );
      }
      if (probe.triggerResponse.response?.success !== true) {
        throw new Error(`Benchmark activation was rejected: ${JSON.stringify(probe.triggerResponse.response)}`);
      }

      const startedPerfMs = trigger.value.startedPerfMs;
      const duration = (event) => Number((event.perfMs - startedPerfMs).toFixed(1));
      samples.push({
        index,
        surface,
        cell,
        fixtureSample: probe.sample,
        workerRegistration: workerBeforeTrigger.registrationId,
        workerStopped: workerBeforeTrigger.statuses.every((status) => status === 'STOPPED'),
        workerWarm: workerBeforeTrigger.statuses.every((status) => status === 'RUNNING'),
        activationId,
        latencyMs: {
          hostShown: duration(hostShown),
          surfaceShown: duration(surfaceShown),
          focused: duration(focused),
          firstResultAfterPaintOpportunity: Number((firstResultAfterPaintOpportunityAt - startedPerfMs).toFixed(1)),
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

  const sorted = samples.map((sample) => sample.latencyMs.firstResultAfterPaintOpportunity).sort((a, b) => a - b);
  const percentile95 = sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
  if (!keepDocument) {
    await fixture.goto(originalFixtureUrl);
  }
  return {
    ok: true,
    surface,
    cell,
    cold,
    count: samples.length,
    p95FirstResultAfterPaintOpportunityMs: percentile95,
    samples,
  };
};

export const collectKeybarColdActivationMcp = async (
  browser,
  {
    pageId,
    activationId,
    startedPerfMs,
    restoreUrl,
    keepDocument = false,
    surface = 'command-bar',
    cell = 'unspecified',
    resultTimeoutMs = 25000,
    index = 0,
    workerStatuses = [],
    workerStopped = false,
    workerWarm = false,
  },
) => {
  const verifiedCold = workerStatuses.length > 0 && workerStatuses.every((status) => status === 'STOPPED');
  const verifiedWarm = workerStatuses.length > 0 && workerStatuses.every((status) => status === 'RUNNING');
  if ((!verifiedCold && !verifiedWarm) || workerStopped !== verifiedCold || workerWarm !== verifiedWarm) {
    throw new Error(
      `Collector requires the worker state returned by the activation runner: ${JSON.stringify({ workerStatuses, workerStopped, workerWarm })}`,
    );
  }

  if (!Number.isFinite(startedPerfMs)) {
    throw new Error('Collector needs the monotonic timestamp returned by the activation runner');
  }
  if (typeof activationId !== 'string' || !activationId) {
    throw new Error('Collector needs the activation ID returned by the activation runner');
  }
  if (typeof restoreUrl !== 'string' || typeof keepDocument !== 'boolean') {
    throw new Error('Collector needs the restore URL and document-retention flag returned by the activation runner');
  }

  const fixture = browser.page(pageId);
  try {
    const wait = await fixture.waitForSelector('html[data-keybar-benchmark-result-after-paint-opportunity-at]', {
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

    const events = probe.events.filter((event) => event.activationId === activationId);
    const activation = events.find((event) => event.name === 'hostShown')?.activation;
    const hostShown = events.find((event) => event.name === 'hostShown');
    const hostInjected = probe.events.find(
      (event) => event.name === 'hostInjected' && event.activationId === activationId,
    );
    const surfaceShown = events.find((event) => event.name === 'surfaceShown');
    const focused = events.find((event) => event.name === 'focused' && event.activation === activation);
    const firstResultAfterPaintOpportunity = events.find((event) => event.name === 'firstResultAfterPaintOpportunity');
    const firstResultAfterPaintOpportunityAt = firstResultAfterPaintOpportunity?.perfMs;
    if (
      !activation ||
      (!verifiedWarm && !hostInjected) ||
      !hostShown ||
      !surfaceShown ||
      surfaceShown.surface !== surface ||
      !focused ||
      !firstResultAfterPaintOpportunity ||
      firstResultAfterPaintOpportunity.surface !== surface ||
      firstResultAfterPaintOpportunity.activation !== activation ||
      !Number.isFinite(firstResultAfterPaintOpportunityAt)
    ) {
      throw new Error(
        `Incomplete activation stages: ${JSON.stringify({ hostShown, surfaceShown, focused, firstResultAfterPaintOpportunity, firstResultAfterPaintOpportunityAt })}`,
      );
    }

    if (probe.triggerResponse?.activationId !== activationId) {
      throw new Error(
        `Benchmark response did not match activation ${activationId}: ${JSON.stringify(probe.triggerResponse)}`,
      );
    }
    if (probe.triggerResponse.response?.success !== true) {
      throw new Error(`Benchmark activation was rejected: ${JSON.stringify(probe.triggerResponse.response)}`);
    }

    const duration = (event) => Number((event.perfMs - startedPerfMs).toFixed(1));
    return {
      ok: true,
      pending: false,
      sample: {
        index,
        surface,
        cell,
        fixtureSample: probe.sample,
        workerStopped: verifiedCold,
        workerWarm: verifiedWarm,
        latencyMs: {
          hostInjected: hostInjected ? duration(hostInjected) : null,
          hostShown: duration(hostShown),
          surfaceShown: duration(surfaceShown),
          focused: duration(focused),
          firstResultAfterPaintOpportunity: Number((firstResultAfterPaintOpportunityAt - startedPerfMs).toFixed(1)),
        },
      },
    };
  } finally {
    if (!keepDocument) {
      await fixture.goto(restoreUrl).catch(() => undefined);
    }
  }
};
