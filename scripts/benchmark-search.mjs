import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  configFile: path.join(projectRoot, 'vite.config.ts'),
  root: projectRoot,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { searchItems } = await server.ssrLoadModule('/src/utils/fuzzySearch.ts');
  const { toTabItems } = await server.ssrLoadModule('/src/utils/tabItems.ts');
  const syntheticTabs = (count) =>
    toTabItems(
      Array.from({ length: count }, (_, index) => ({
        id: index,
        title: `Design workspace ${index}`,
        url: `https://example${index}.com/planning`,
        windowId: 1,
        index,
        active: false,
        pinned: index % 17 === 0,
      })),
      null,
    );

  const measureSearch = (items) => {
    const timings = [];
    const queries = ['design planning', 'desgn plannng', 'zzqxv no-such-page'];
    const coldStart = performance.now();
    const coldMatches = searchItems(items, queries[0], true);
    const coldMs = performance.now() - coldStart;
    assert.equal(coldMatches.length, 100);

    for (let index = 0; index < 5; index++) {
      for (const query of queries) searchItems(items, query, true);
    }

    for (let index = 0; index < 35; index++) {
      const query = queries[index % queries.length];
      const start = performance.now();
      const matches = searchItems(items, query, true);
      assert.equal(matches.length, query === queries[2] ? 0 : 100);
      timings.push(performance.now() - start);
    }

    timings.sort((a, b) => a - b);
    return {
      coldMs,
      p50: timings[Math.floor(timings.length * 0.5)],
      p95: timings[Math.ceil(timings.length * 0.95) - 1],
    };
  };

  const ordinaryTiming = measureSearch(syntheticTabs(2300));
  const stressTiming = measureSearch(syntheticTabs(10000));

  if (process.argv.includes('--check-budget')) {
    assert.ok(ordinaryTiming.p95 < 30, `2,300-tab p95: ${ordinaryTiming.p95.toFixed(2)} ms`);
    assert.ok(stressTiming.p95 < 100, `10,000-tab p95: ${stressTiming.p95.toFixed(2)} ms`);
  }

  console.log(JSON.stringify({ ordinaryTabs: ordinaryTiming, stressTabs: stressTiming }, null, 2));
} finally {
  await server.close();
}
