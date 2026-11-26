/*
 * Paste this file into the BrowserOS CUA REPL after binding `app` to the
 * BrowserOS neo window. The fixture server must be running and the active tab
 * must be /fixture?tab=0000. Set the fixture cell with BrowserOS MCP before
 * sampling, then correlate startEpochMs with /benchmarks/events.
 */
globalThis.createKeybarColdActivationHarness = function (app, options = {}) {
  const fixtureUrl = options.fixtureUrl ?? 'http://127.0.0.1:8770/fixture?tab=0000';
  const extensionId = options.extensionId ?? 'lnflcdainoeimligocpijlehbfiokfmb';
  const workerScope = `Scope: chrome-extension://${extensionId}/`;

  const readWorker = (state) => {
    const lines = state.split('\n');
    const scopeIndex = lines.findIndex((line) => line.includes(workerScope));
    if (scopeIndex < 0) return null;

    let start = scopeIndex;
    while (start >= 0 && !lines[start].includes('Registration ID:')) start -= 1;
    if (start < 0) throw new Error('Keybar worker registration ID is missing');

    let end = lines.findIndex((line, index) => index > start && line.includes('Registration ID:'));
    if (end < 0) end = lines.length;
    const block = lines.slice(start, end);
    return {
      block,
      registration: block.find((line) => line.includes('Registration ID:'))?.trim(),
      status: block.find((line) => line.includes('Running Status:'))?.trim() ?? '',
    };
  };

  const serviceWorkerState = async () => {
    const scopeAwareSnapshot = async () => {
      let state = await app.getAXState({ disableDiffing: true, emit: false });
      if (!state.includes(workerScope)) {
        state = (await app.getAXStateAndScreenshot({ disableDiffing: true, emit: false })).state;
      }
      return state;
    };

    let state = await scopeAwareSnapshot();
    let worker = readWorker(state);
    if (!worker) throw new Error(`Keybar service worker scope not found: ${workerScope}`);

    if (worker.status.includes('RUNNING')) {
      const stopButton = worker.block.find((line) => /button Stop$/.test(line));
      if (!stopButton) throw new Error('Keybar worker is running without a Stop button');
      await app.click(Number(stopButton.trim().match(/^\d+/)[0]));
      state = await scopeAwareSnapshot();
      worker = readWorker(state);
    }

    if (!worker?.status.includes('STOPPED')) {
      throw new Error(`Keybar worker did not stop: ${worker?.status ?? 'registration missing'}`);
    }
    return worker;
  };

  const stopColdWorker = async () => {
    await app.pressKey('super+t');
    await app.pressKey('super+l');
    await app.typeText('chrome://serviceworker-internals');
    await app.pressKey('Return');
    return serviceWorkerState();
  };

  const sample = async (surface) => {
    if (!['tab-switcher', 'command-bar'].includes(surface)) {
      throw new Error(`Unsupported surface: ${surface}`);
    }

    const worker = await stopColdWorker();
    await app.pressKey('super+w');
    const pageState = await app.getAXState({ disableDiffing: true, emit: false });
    if (!pageState.includes(`URL: ${fixtureUrl}`)) {
      throw new Error(`Expected to return to fixture ${fixtureUrl}`);
    }

    let activationTarget;
    if (surface === 'tab-switcher') {
      activationTarget = 'ctrl+a';
    } else {
      const button = pageState.match(/\n\s*(\d+) pop up button Open Keybar/);
      if (!button) throw new Error('Open Keybar toolbar action is missing');
      activationTarget = Number(button[1]);
    }

    const startEpochMs = Date.now();
    if (surface === 'tab-switcher') await app.pressKey(activationTarget);
    else await app.click(activationTarget);

    const shownState = await app.getAXState({ disableDiffing: true, emit: false });
    const commandBarVisible = shownState.includes('Command Bar');
    const tabSwitcherVisible =
      shownState.includes('Recent tabs') && shownState.includes('Most recently used tabs in this window');
    await app.pressKey('Escape');
    const closedState = await app.getAXState({ disableDiffing: true, emit: false });

    return {
      surface,
      startEpochMs,
      workerRegistration: worker.registration,
      workerScope,
      workerStopped: worker.status.includes('STOPPED'),
      visible: surface === 'command-bar' ? commandBarVisible : tabSwitcherVisible,
      closed: !closedState.includes('Command Bar') && !closedState.includes('Recent tabs'),
    };
  };

  return {
    sample,
    run: async ({ surface, count = 20 }) => {
      if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
      const samples = [];
      for (let index = 0; index < count; index += 1) {
        samples.push(await sample(surface));
      }
      return samples;
    },
  };
};
