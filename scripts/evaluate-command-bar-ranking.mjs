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
  const [{ searchItems }, { getCommands }, { toTabItems }] = await Promise.all([
    server.ssrLoadModule('/src/utils/fuzzySearch.ts'),
    server.ssrLoadModule('/src/utils/commands.ts'),
    server.ssrLoadModule('/src/utils/tabItems.ts'),
  ]);

  const tabs = toTabItems(
    [
      {
        id: 201,
        title: 'Quarterly roadmap',
        url: 'https://docs.example.test/roadmap',
        windowId: 1,
        index: 0,
        active: false,
        pinned: false,
      },
      {
        id: 202,
        title: 'Invoice PDF',
        url: 'https://billing.example.test/invoices/2026',
        windowId: 1,
        index: 1,
        active: false,
        pinned: false,
      },
      {
        id: 203,
        title: 'Rust concurrency notes',
        url: 'https://wiki.example.test/rust/async',
        windowId: 1,
        index: 2,
        active: false,
        pinned: false,
      },
      {
        id: 204,
        title: 'Hotel booking overview',
        customName: 'Weekend in Porto',
        url: 'https://travel.example.test/porto',
        windowId: 1,
        index: 3,
        active: false,
        pinned: false,
      },
      {
        id: 205,
        title: 'Mercury SRE on-call',
        url: 'https://runbooks.example.test/mercury',
        windowId: 2,
        index: 0,
        windowTitle: 'Operations',
        active: false,
        pinned: false,
      },
    ],
    999,
    1,
  );

  const commands = getCommands({
    activeTab: { id: 201, windowId: 1, index: 0, url: 'https://docs.example.test/roadmap', title: 'Quarterly roadmap' },
    activeGroup: null,
    tabCountInWindow: 5,
    tabsToRightCount: 4,
    activeGroupTabCount: 0,
    canUnsplitTabs: false,
  });

  const savedPages = [
    {
      id: 'bookmark-typescript',
      title: 'TypeScript handbook',
      subtitle: 'https://www.typescriptlang.org/docs/',
      icon: '☆',
      type: 'bookmark',
      url: 'https://www.typescriptlang.org/docs/',
    },
    {
      id: 'bookmark-css-grid',
      title: 'CSS grid guide',
      subtitle: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
      icon: '☆',
      type: 'bookmark',
      url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
    },
    {
      id: 'bookmark-vite',
      title: 'Vite configuration reference',
      subtitle: 'https://vite.dev/config/',
      icon: '☆',
      type: 'bookmark',
      url: 'https://vite.dev/config/',
    },
    {
      id: 'history-tax-return',
      title: '2025 tax return',
      subtitle: 'https://tax.example.test/return',
      icon: '◷',
      type: 'history',
      url: 'https://tax.example.test/return',
      lastVisitTime: 1_763_400_000_000,
    },
    {
      id: 'history-gardening',
      title: 'Gardening ideas',
      subtitle: 'https://garden.example.test/ideas',
      icon: '◷',
      type: 'history',
      url: 'https://garden.example.test/ideas',
      lastVisitTime: 1_763_300_000_000,
    },
  ];

  const items = [...commands, ...tabs, ...savedPages];
  const cases = [
    ['Open a new tab', 'new tab', 'new-tab', 'command'],
    ['Open a browser window', 'new window', 'new-window', 'command'],
    ['Open a private window', 'incognito window', 'new-incognito-window', 'command'],
    ['Reload the current page', 'reload current', 'reload-tab', 'command'],
    ['Close the current tab', 'close current tab', 'close-tab', 'command'],
    ['Reopen the last closed tab', 'reopen closed', 'reopen-closed-tab', 'command'],
    ['Find browser history', 'open history', 'open-history', 'command'],
    ['Find browser bookmarks', 'open bookmarks', 'open-bookmarks', 'command'],
    ['Open Chrome downloads', 'downloads', 'open-downloads', 'command'],
    ['Manage extension shortcuts', 'keyboard shortcuts', 'open-shortcuts', 'command'],
    ['Open browser preferences', 'preferences', 'open-chrome-settings', 'command'],
    ['Reload the current page while bypassing the cache', 'clear cache', 'hard-reload-tab', 'command'],
    ['Open the quarterly roadmap tab', 'quarterly roadmap', 'tab-201', 'tab'],
    ['Find an invoice PDF tab', 'invoice pdf', 'tab-202', 'tab'],
    ['Find Rust async notes', 'rust async', 'tab-203', 'tab'],
    ['Find a custom-named trip tab', 'weekend porto', 'tab-204', 'tab'],
    ['Find a tab in another window', 'mercury on-call', 'tab-205', 'tab'],
    ['Open TypeScript documentation', 'typescript docs', 'bookmark-typescript', 'bookmark'],
    ['Open the CSS grid bookmark', 'css grid', 'bookmark-css-grid', 'bookmark'],
    ['Open Vite configuration documentation', 'vite config', 'bookmark-vite', 'bookmark'],
    ['Revisit a tax return page', 'tax return', 'history-tax-return', 'history'],
    ['Revisit gardening research', 'gardening ideas', 'history-gardening', 'history'],
    [
      'Search YouTube for lo-fi music',
      'yt lo-fi music',
      'search-youtube',
      'search',
      'https://www.youtube.com/results?search_query=lo-fi%20music',
    ],
    [
      'Search YouTube using its full name',
      'youtube cats',
      'search-youtube',
      'search',
      'https://www.youtube.com/results?search_query=cats',
    ],
    [
      'Ask ChatGPT about focus time',
      'ai focus time',
      'search-chatgpt',
      'search',
      'https://chatgpt.com/?q=focus%20time',
    ],
    [
      'Navigate directly to a documentation URL',
      'https://developer.mozilla.org/en-US/docs/Web/CSS/grid',
      'navigate-url',
      'url',
      'https://developer.mozilla.org/en-US/docs/Web/CSS/grid',
    ],
    [
      'Fall back to web search for an unmatched query',
      'quantum computing basics',
      'search-google',
      'search',
      'https://www.google.com/search?q=quantum%20computing%20basics',
    ],
  ];

  const results = cases.map(([task, query, expectedId, resultType, expectedDestination]) => {
    const ranked = searchItems(items, query);
    const expectedIdCandidate = ranked.find((item) => item.id === expectedId);
    const expectedIndex = ranked.findIndex(
      (item) =>
        item.id === expectedId &&
        item.type === resultType &&
        (expectedDestination === undefined || item.url === expectedDestination),
    );
    return {
      task,
      query,
      expectedId,
      resultType,
      expectedDestination: expectedDestination ?? null,
      observedType: expectedIdCandidate?.type ?? null,
      observedDestination: expectedIdCandidate?.url ?? null,
      rank: expectedIndex < 0 ? null : expectedIndex + 1,
      top1: expectedIndex === 0,
      top5: expectedIndex >= 0 && expectedIndex < 5,
      leadingIds: ranked.slice(0, 5).map((item) => item.id),
    };
  });

  console.log(
    JSON.stringify(
      {
        fixture: 'keybar-command-bar-synthetic-v1',
        cases: results.length,
        top1: results.filter((result) => result.top1).length,
        top5: results.filter((result) => result.top5).length,
        byType: Object.fromEntries(
          [...new Set(results.map((result) => result.resultType))].map((type) => {
            const typed = results.filter((result) => result.resultType === type);
            return [
              type,
              {
                cases: typed.length,
                top1: typed.filter((result) => result.top1).length,
                top5: typed.filter((result) => result.top5).length,
              },
            ];
          }),
        ),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
