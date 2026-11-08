import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('command palette lifecycle', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="test-root"></div></body></html>', {
    url: 'https://palette.test/',
    pretendToBeVisual: true,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  const event = () => {
    const listeners = new Set();
    return {
      listeners,
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
      emit: (message) => {
        for (const fn of listeners) fn(message);
      },
    };
  };
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  };
  const tab = (title, groupId = -1) => ({
    id: 42,
    title,
    url: 'https://palette.test/',
    active: true,
    index: 0,
    windowId: 1,
    groupId,
    pinned: false,
  });
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  let root;
  let model;
  let closed;

  try {
    const { useCommandPaletteModel } = await server.ssrLoadModule(
      '/src/components/CommandPalette/useCommandPaletteModel.ts',
    );
    const { defaultThemePreferences } = await server.ssrLoadModule('/src/themes/index.ts');

    const mount = async ({ handlers = {}, granted = [] } = {}) => {
      const runtimeEvent = event();
      const storageEvent = event();
      const env = { granted, calls: [], runtimeEvent, storageEvent };
      const defaults = {
        'tabs:list': () => [tab('Current tab')],
        'tabs:current': () => tab('Current tab'),
        'permissions:contains': () => false,
        'permissions:get-all': () => ({ permissions: env.granted }),
        'browser:split-capabilities': () => ({ create: false, unsplit: false }),
        'bookmarks:list': () => [],
        'history:list': () => [],
      };
      globalThis.chrome = {
        runtime: {
          onMessage: runtimeEvent,
          sendMessage: async (message) => {
            env.calls.push(message);
            const handler = handlers[message.action] ?? defaults[message.action];
            assert.ok(handler, `Unexpected background action: ${message.action}`);
            return { success: true, data: await handler(message) };
          },
        },
        permissions: { getAll: async () => ({ permissions: env.granted }) },
        storage: { onChanged: storageEvent },
      };
      closed = 0;
      function Probe() {
        model = useCommandPaletteModel({
          initialMode: 'commands',
          initialTheme: { ...defaultThemePreferences, windowMode: 'expanded' },
          themeRoot: document.documentElement,
          cacheThemeInLocalStorage: false,
          onClose: () => closed++,
        });
        return createElement('input', { ref: model.inputRef, 'aria-label': 'Search' });
      }
      root = createRoot(document.getElementById('test-root'));
      await act(async () => root.render(createElement(Probe)));
      return env;
    };
    const unmount = async (env) => {
      await act(async () => root.unmount());
      root = null;
      assert.equal(env.runtimeEvent.listeners.size, 0, 'runtime subscriptions are disposed');
      assert.equal(env.storageEvent.listeners.size, 0, 'storage subscriptions are disposed');
    };

    const snapshots = [];
    const refreshEnv = await mount({
      handlers: {
        'tabs:list': () => {
          const request = deferred();
          snapshots.push(request);
          return request.promise;
        },
      },
    });
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await act(async () => {
        refreshEnv.runtimeEvent.emit({ action: 'ui:tabs-changed' });
        mock.timers.tick(32);
      });
    } finally {
      mock.timers.reset();
    }
    assert.equal(snapshots.length, 2, 'a browser update can overlap the initial request');
    await act(async () => snapshots[1].resolve([tab('Fresh snapshot')]));
    assert.ok(model.results.some((item) => item.title === 'Fresh snapshot'));
    await act(async () => snapshots[0].resolve([tab('Stale snapshot')]));
    assert.ok(
      model.results.some((item) => item.title === 'Fresh snapshot'),
      'late initial data cannot overwrite newer results',
    );
    assert.ok(!model.results.some((item) => item.title === 'Stale snapshot'));
    await unmount(refreshEnv);

    const executions = [];
    const executionEnv = await mount({
      handlers: {
        'tabs:new': () => {
          const request = deferred();
          executions.push(request);
          return request.promise;
        },
      },
    });
    const newTabIndex = model.results.findIndex((item) => item.type === 'command' && item.action === 'tabs:new');
    assert.ok(newTabIndex >= 0, 'the registry exposes the new-tab command');
    await act(async () => model.handleResultHover(newTabIndex));
    const enter = () =>
      model.handleSearchKeyDown({
        key: 'Enter',
        keyCode: 13,
        nativeEvent: { isComposing: false },
        preventDefault() {},
      });
    await act(async () => {
      enter();
      enter();
    });
    assert.equal(executions.length, 1, 'two Enters while Chrome responds create one tab');
    await act(async () => executions[0].reject(new Error('Simulated Chrome failure')));
    assert.equal(model.toast?.tone, 'error');
    await act(async () => enter());
    assert.equal(executions.length, 2, 'a failed command can be retried');
    await act(async () => executions[1].resolve(true));
    assert.equal(closed, 1, 'only the successful execution closes the palette');
    await unmount(executionEnv);

    const keyboardEnv = await mount();
    const keyEvent = (key, composing = false) => ({
      key,
      keyCode: composing ? 229 : 0,
      nativeEvent: { isComposing: composing, stopImmediatePropagation() {} },
      preventDefault() {},
      stopPropagation() {},
    });
    await act(async () => model.handlePaletteKeyDown(keyEvent('F2')));
    assert.equal(model.dialog?.kind, 'rename');
    await act(async () => model.handleSurfaceEscape(keyEvent('Escape')));
    assert.equal(model.dialog?.kind, 'rename', 'nested dialogs retain the first Escape');
    assert.equal(closed, 0);
    await act(async () => model.closeDialog());
    await act(async () => model.handleSearchKeyDown(keyEvent('Enter', true)));
    assert.ok(
      !keyboardEnv.calls.some((message) => message.action === 'tabs:activate'),
      'IME confirmation cannot activate the selected tab',
    );
    await act(async () => model.handleQueryChange('Composing text'));
    await act(async () => model.handleSurfaceEscape(keyEvent('Escape', true)));
    assert.equal(model.query, 'Composing text', 'IME cancellation cannot reset the search');
    await unmount(keyboardEnv);

    const savedRequests = { bookmarks: [], history: [] };
    const loadSaved = (source) => {
      const request = deferred();
      savedRequests[source].push(request);
      return request.promise;
    };
    const permissionEnv = await mount({
      granted: ['bookmarks', 'history'],
      handlers: { 'bookmarks:list': () => loadSaved('bookmarks'), 'history:list': () => loadSaved('history') },
    });
    await act(async () => model.handleQueryChange('Saved needle'));
    assert.equal(model.localDataLoading, true);
    await act(async () => {
      permissionEnv.granted = [];
      permissionEnv.runtimeEvent.emit({ action: 'ui:permissions-changed' });
    });
    await act(async () => {
      savedRequests.bookmarks[0].resolve([{ id: '1', title: 'Saved needle old bookmark', url: 'https://saved.test/' }]);
      savedRequests.history[0].resolve([{ id: '2', title: 'Saved needle old history', url: 'https://history.test/' }]);
    });
    assert.equal(model.localDataLoading, false);
    assert.ok(
      !model.results.some((item) => item.type === 'bookmark' || item.type === 'history'),
      'responses arriving after revocation cannot expose saved pages',
    );
    await act(async () => {
      permissionEnv.granted = ['bookmarks', 'history'];
      permissionEnv.runtimeEvent.emit({ action: 'ui:permissions-changed' });
    });
    assert.ok(
      !model.results.some((item) => item.type === 'bookmark' || item.type === 'history'),
      'a new grant cannot expose old responses before its own load completes',
    );
    assert.equal(savedRequests.bookmarks.length, 2, 'a new grant issues a fresh bookmark request');
    assert.equal(savedRequests.history.length, 2, 'a new grant issues a fresh history request');
    await act(async () => {
      savedRequests.bookmarks[1].resolve([
        { id: '3', title: 'Saved needle fresh bookmark', url: 'https://fresh.test/' },
      ]);
      savedRequests.history[1].resolve([]);
    });
    assert.ok(
      model.results.some((item) => item.type === 'bookmark' && item.title === 'Saved needle fresh bookmark'),
      'a new grant permits a fresh load',
    );
    await act(async () => {
      permissionEnv.granted = [];
      permissionEnv.runtimeEvent.emit({ action: 'ui:permissions-changed' });
    });
    assert.ok(
      !model.results.some((item) => item.type === 'bookmark' || item.type === 'history'),
      'revocation also clears already loaded results',
    );
    await unmount(permissionEnv);

    const groupUpdates = [];
    let groupCollapsed = false;
    const groupEnv = await mount({
      granted: ['tabGroups'],
      handlers: {
        'tabs:list': () => [tab('Grouped tab', 7)],
        'tabs:current': () => tab('Grouped tab', 7),
        'permissions:contains': () => true,
        'groups:list': () => [{ id: 7, title: 'Projects', color: 'blue', collapsed: groupCollapsed, windowId: 1 }],
        'groups:update': (message) => {
          groupUpdates.push({ groupId: message.groupId, collapsed: message.collapsed });
          groupCollapsed = message.collapsed;
          return true;
        },
      },
    });
    const toggleGroup = () =>
      model.results.findIndex((item) => item.type === 'command' && item.id === 'toggle-tab-group');
    const settlePalette = () => new Promise((resolve) => setTimeout(resolve, 0));
    await act(async () => {
      model.handleQueryChange('group');
      await settlePalette();
    });
    assert.ok(toggleGroup() >= 0, 'an active group exposes its toggle command');
    await act(async () => {
      model.handleResultClick(toggleGroup());
      await settlePalette();
    });
    assert.deepEqual(groupUpdates, [{ groupId: 7, collapsed: true }], 'the first selection collapses the active group');
    await act(async () => settlePalette());
    await act(async () => {
      model.handleResultClick(toggleGroup());
      await settlePalette();
    });
    assert.deepEqual(
      groupUpdates,
      [
        { groupId: 7, collapsed: true },
        { groupId: 7, collapsed: false },
      ],
      'the next selection expands the active group',
    );
    await unmount(groupEnv);
    console.log(
      'Palette lifecycle passed: stale snapshots, repeated Enter/retry, group toggles, permission revocation, IME/dialog keys, subscription cleanup.',
    );
  } finally {
    if (root) await act(async () => root.unmount());
    mock.timers.reset();
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
    else delete globalThis.chrome;
  }
});
