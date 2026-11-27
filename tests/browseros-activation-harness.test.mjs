import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const harnessSource = await readFile(new URL('../scripts/browseros-cold-activation-mcp.js', import.meta.url), 'utf8');
const benchmark = new Function('globalThis', `${harnessSource}\nreturn globalThis.KeybarColdActivationBenchmark;`)({});

const pendingActivation = ({
  completedPerfMs,
  resultMarkerAt,
  includeResultEvent = false,
  triggerComplete = true,
} = {}) => {
  const activationId = 'activation-1';
  const events = [
    { activationId, name: 'hostInjected', perfMs: 92 },
    { activationId, name: 'hostShown', activation: 1, perfMs: 93 },
    { activationId, name: 'surfaceShown', activation: 1, surface: 'command-bar', perfMs: 94 },
    { activationId, name: 'focused', activation: 1, surface: 'command-bar', perfMs: 95 },
  ];
  if (includeResultEvent) {
    events.push({
      activationId,
      name: 'firstResultAfterPaintOpportunity',
      activation: 1,
      surface: 'command-bar',
      perfMs: Number(resultMarkerAt),
    });
  }
  return {
    activationId,
    startedPerfMs: 90,
    resultTimeoutMs: 10,
    activationDeadlinePerfMs: 100,
    lockToken: 'lock-token',
    restoreUrl: 'http://127.0.0.1:8770/fixture?tab=0001',
    keepDocument: false,
    hostWasPresentBeforeActivation: false,
    surface: 'command-bar',
    workerStatuses: ['STOPPED'],
    workerStopped: true,
    workerWarm: false,
    pageId: 42,
    fixtureProbe: {
      sample: 7,
      events,
      triggerResponse: {
        activationId,
        response: { success: true },
        completedPerfMs,
      },
      bridgeState: {
        triggerComplete,
        resultAfterPaintOpportunityAt: resultMarkerAt ?? null,
      },
    },
  };
};

const makeBrowser = (pending, onWait, pageClockMs = 96, { onClock } = {}) => {
  const fixture = {
    evaluateInPage: async (script) => {
      if (typeof script === 'string' && script.includes('__keybarColdActivationProbe')) {
        return { value: structuredClone(pending.fixtureProbe) };
      }
      if (script === 'return performance.now()') {
        onClock?.();
        return { value: pageClockMs };
      }
      return { value: true };
    },
    waitForSelector: async (selector, options) => onWait(selector, options, pending.fixtureProbe),
    goto: async () => undefined,
  };
  return { page: () => fixture };
};

test('split collection accepts a result recorded after the first probe read but before the deadline check', async () => {
  const pending = pendingActivation({ completedPerfMs: 94 });
  const browser = makeBrowser(
    pending,
    async () => {
      throw new Error('The result was recorded by the deadline, so no selector wait should start');
    },
    101,
    {
      onClock: () => {
        pending.fixtureProbe.bridgeState.resultAfterPaintOpportunityAt = '99';
        pending.fixtureProbe.events.push({
          activationId: pending.activationId,
          name: 'firstResultAfterPaintOpportunity',
          activation: 1,
          surface: 'command-bar',
          perfMs: 99,
        });
      },
    },
  );

  const result = await benchmark.collect(browser, pending);

  assert.equal(result.ok, true);
  assert.equal(result.sample.latencyMs.firstResultAfterPaintOpportunity, 9);
});

test('split collection accepts a trigger response recorded after the first probe read but before the deadline check', async () => {
  const pending = pendingActivation({ triggerComplete: false });
  const browser = makeBrowser(
    pending,
    async () => {
      throw new Error('The response was recorded by the deadline, so no selector wait should start');
    },
    101,
    {
      onClock: () => {
        pending.fixtureProbe.triggerResponse.completedPerfMs = 99;
        pending.fixtureProbe.bridgeState.triggerComplete = true;
        pending.fixtureProbe.bridgeState.resultAfterPaintOpportunityAt = '99';
        pending.fixtureProbe.events.push({
          activationId: pending.activationId,
          name: 'firstResultAfterPaintOpportunity',
          activation: 1,
          surface: 'command-bar',
          perfMs: 99,
        });
      },
    },
  );

  const result = await benchmark.collect(browser, pending);

  assert.equal(result.ok, true);
  assert.equal(result.sample.latencyMs.firstResultAfterPaintOpportunity, 9);
});

test('split collection accepts an on-time result recorded as the selector wait times out', async () => {
  const pending = pendingActivation({ completedPerfMs: 94 });
  const browser = makeBrowser(pending, async (selector, options, probe) => {
    assert.equal(selector, 'html[data-keybar-benchmark-result-after-paint-opportunity-at]');
    assert.equal(options.timeout, 4);
    probe.bridgeState.resultAfterPaintOpportunityAt = '99';
    probe.events.push({
      activationId: pending.activationId,
      name: 'firstResultAfterPaintOpportunity',
      activation: 1,
      surface: 'command-bar',
      perfMs: 99,
    });
    return { matched: false };
  });

  const result = await benchmark.collect(browser, pending);

  assert.equal(result.ok, true);
  assert.equal(result.sample.latencyMs.firstResultAfterPaintOpportunity, 9);
});

test('split collection accepts an on-time trigger response recorded as the selector wait times out', async () => {
  const pending = pendingActivation({
    completedPerfMs: 99,
    resultMarkerAt: '99',
    includeResultEvent: true,
    triggerComplete: false,
  });
  const browser = makeBrowser(
    pending,
    async () => {
      throw new Error('The zero remaining deadline should not start a selector wait');
    },
    101,
  );

  const result = await benchmark.collect(browser, pending);

  assert.equal(result.ok, true);
  assert.equal(result.sample.latencyMs.firstResultAfterPaintOpportunity, 9);
});

test('split collection rejects a trigger response recorded after the original deadline', async () => {
  const pending = pendingActivation({ completedPerfMs: 101, resultMarkerAt: '99', includeResultEvent: true });
  const browser = makeBrowser(pending, async () => {
    throw new Error('The already-recorded result should not wait');
  });

  const result = await benchmark.collect(browser, pending);

  assert.equal(result.ok, false);
  assert.match(result.error, /activation response arrived after the 10 ms deadline/);
});
