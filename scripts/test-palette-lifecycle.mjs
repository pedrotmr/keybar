import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    const { SearchArea } = await server.ssrLoadModule('/src/components/CommandPalette/SearchArea/SearchArea.tsx');
    const { ResultsList, resultDomId } = await server.ssrLoadModule('/src/components/ResultsList.tsx');
    const { TabSwitcher } = await server.ssrLoadModule('/src/components/TabSwitcher.tsx');
    const { toTabItems } = await server.ssrLoadModule('/src/utils/tabItems.ts');
    const { searchProviders } = await server.ssrLoadModule('/src/utils/searchProviders.ts');

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
          getURL: (path) => `chrome-extension://test/${path}`,
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

    const actionToggleEnv = await mount();
    const tabResultIndex = model.results.findIndex((item) => item.type === 'tab');
    assert.ok(tabResultIndex >= 0, 'the command palette has a tab result for its Actions control');
    await act(async () => {
      assert.equal(model.handleResultContextMenu(tabResultIndex), true);
    });
    assert.ok(model.actionDock, 'the tab Actions dock opens');
    const actionTrigger = document.createElement('button');
    actionTrigger.className = 'result-actions-trigger';
    await act(async () => model.handleContainerMouseDown({ target: actionTrigger, preventDefault() {} }));
    assert.ok(model.actionDock, 'pressing the row Actions button does not dismiss the dock before its click');
    await act(async () => model.toggleActionDock(tabResultIndex, false));
    assert.equal(model.actionDock, null, 'the row Actions button can toggle its open dock closed');
    await unmount(actionToggleEnv);

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
    await act(async () => model.handleQueryChange('yt'));
    assert.ok(
      !model.results.some((item) => item.id === 'search-saved-pages'),
      'a standalone provider shortcut does not select the saved-pages permission action',
    );
    await act(async () => model.handleQueryChange('yt lo-fi music'));
    assert.equal(
      model.highlightQuery,
      'lo-fi music',
      'committed provider triggers reuse the parsed query for highlighting',
    );
    await act(async () => model.handleQueryChange('yt'));
    await act(async () => model.handleSearchKeyDown(keyEvent('Enter')));
    assert.equal(model.activeProvider?.id, 'youtube', 'Enter commits a standalone canonical provider shortcut');
    await act(async () => model.handleSearchKeyDown(keyEvent('Backspace')));
    assert.equal(model.query, 'yt', 'returning from a shortcut restores the original query');

    for (const query of ['goog', 'ma', 'maps']) {
      await act(async () => model.handleQueryChange(query));
      const googleFallback = model.results.find((item) => item.id === 'search-google');
      assert.equal(
        googleFallback?.url,
        `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        `the full-query Google fallback remains available for ${query}`,
      );
      assert.ok(
        model.results.some((item) => item.id === 'search-saved-pages'),
        `provider suggestions do not hide saved-page search for ${query}`,
      );
    }

    await act(async () => model.handleQueryChange('google drive'));
    assert.equal(model.highlightQuery, 'google drive', 'ordinary searches highlight the complete query');
    assert.equal(
      model.providerCandidates[0]?.id,
      'google',
      'a full provider name can still be explicitly selected from an ordinary query',
    );
    assert.equal(
      model.results.find((item) => item.id === 'search-google')?.url,
      'https://www.google.com/search?q=google%20drive',
      'typing an ordinary phrase does not strip its provider-name prefix',
    );
    assert.ok(
      model.results.some((item) => item.id === 'search-saved-pages'),
      'an uncommitted provider suggestion keeps saved-page search available',
    );
    await act(async () => model.handleQueryChange('you are here'));
    assert.deepEqual(
      model.providerCandidates.map((provider) => provider.id),
      ['youtube'],
      'ordinary text can still expose a provider suggestion without committing to it',
    );
    assert.ok(model.results.some((item) => item.id === 'search-google'));
    assert.ok(
      model.results.some((item) => item.id === 'search-saved-pages'),
      'provider suggestions do not hide the existing saved-pages search action',
    );
    await act(async () => model.handleQueryChange('Google Ma'));
    assert.deepEqual(
      model.providerCandidates.map((provider) => provider.id),
      ['google-maps'],
    );
    assert.ok(
      model.results.some((item) => item.id === 'search-google'),
      'a partial Maps name retains the ordinary Google fallback',
    );
    await act(async () => model.handleSearchKeyDown(keyEvent('Tab')));
    assert.equal(model.activeProvider?.id, 'google-maps');
    assert.equal(model.query, '', 'selecting a partial Maps name starts with a clean provider query');
    await act(async () => model.handleSearchKeyDown(keyEvent('Backspace')));
    await act(async () => model.handleQueryChange('Google Maps lunch'));
    assert.equal(model.providerCandidates[0]?.id, 'google-maps');
    assert.equal(
      model.results.find((item) => item.id === 'search-google')?.url,
      'https://www.google.com/search?q=Google%20Maps%20lunch',
      'an unselected Maps phrase retains its full-query Google fallback',
    );
    await act(async () => model.handleSearchKeyDown(keyEvent('Tab')));
    assert.equal(model.activeProvider?.id, 'google-maps');
    assert.equal(model.query, 'lunch', 'explicitly selecting Maps keeps the text after its full name');
    assert.equal(model.highlightQuery, 'lunch', 'selected provider results reuse the provider query for highlighting');
    await unmount(keyboardEnv);

    const scopeEnv = await mount();
    const youtubeProvider = searchProviders.find((provider) => provider.id === 'youtube');
    assert.ok(youtubeProvider, 'the provider registry exposes YouTube');
    await act(async () => model.activateSuggestedProvider(youtubeProvider));
    assert.equal(
      model.scopeAnnouncement,
      `Switched to ${youtubeProvider.name} search. Type a query to search.`,
      'activating a provider announces the new search scope while focus stays in the combobox',
    );
    await act(async () => model.changeMode('settings'));
    assert.equal(
      model.scopeAnnouncement,
      '',
      'leaving provider scope through mode navigation clears stale status text',
    );
    await act(async () => model.changeMode('commands'));
    await act(async () => model.activateSuggestedProvider(youtubeProvider));
    assert.equal(
      model.scopeAnnouncement,
      `Switched to ${youtubeProvider.name} search. Type a query to search.`,
      're-entering the same provider announces its scope again',
    );
    await act(async () =>
      model.handleSearchKeyDown({
        key: 'Backspace',
        keyCode: 0,
        nativeEvent: { isComposing: false },
        preventDefault() {},
      }),
    );
    assert.equal(model.activeProvider, null, 'Backspace returns from provider scope to command search');
    assert.equal(model.scopeAnnouncement, 'Returned to Command Bar search.', 'returning announces command search');
    await unmount(scopeEnv);

    const keyboardTabs = [
      { ...tab('First tab'), id: 42, index: 0 },
      { ...tab('Second tab'), id: 43, index: 1, active: false },
    ];
    const activatedTabIds = [];
    const keyboardSelectionEnv = await mount({
      handlers: {
        'tabs:list': () => keyboardTabs,
        'tabs:current': () => keyboardTabs[0],
        'tabs:activate': (message) => {
          activatedTabIds.push(message.tabId);
          return true;
        },
      },
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => model.handleQueryChange('tab'));
    const targetIndex = model.results.findIndex((item) => item.type === 'tab' && item.tabId === 43);
    assert.ok(targetIndex >= 0, 'search finds the second open tab');
    for (let step = 0; model.activeIndex !== targetIndex && step < model.results.length; step++) {
      const key = targetIndex > model.activeIndex ? 'ArrowDown' : 'ArrowUp';
      await act(async () =>
        model.handleSearchKeyDown({
          key,
          keyCode: 0,
          nativeEvent: { isComposing: false },
          preventDefault() {},
        }),
      );
    }
    assert.equal(model.selectedItem?.tabId, 43, 'arrow keys move the active result to the second tab');
    await act(async () => {
      model.handleSearchKeyDown({
        key: 'Enter',
        keyCode: 13,
        nativeEvent: { isComposing: false },
        preventDefault() {},
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(activatedTabIds, [43], 'Enter activates the selected tab');
    assert.equal(closed, 1, 'successful keyboard selection closes the Command Bar');
    await unmount(keyboardSelectionEnv);

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
    const uiEnv = await mount();
    const renderedTab = toTabItems([tab('Readable long tab title')], 42, 1)[0];
    const provider = youtubeProvider;
    await act(async () =>
      root.render(
        createElement(
          'div',
          null,
          createElement(SearchArea, {
            activeProvider: provider,
            providerCandidates: [],
            query: 'query',
            inputRef: { current: null },
            selectedItem: renderedTab,
            scopeAnnouncement: `Switched to ${provider.name} search. Type a query to search.`,
            hasSelectedTab: true,
            showResults: true,
            resultsLength: 1,
            actionDockId: 'command-center-actions',
            actionDockOpen: false,
            onQueryChange() {},
            onSearchKeyDown() {},
            onReturnToCommandSearch() {},
            onActivateProvider() {},
            onOpenSelectedActions() {},
            onOpenSettings() {},
          }),
          createElement(ResultsList, {
            items: [renderedTab],
            selectedIndex: 0,
            keyboardNavigationVersion: 0,
            highlightQuery: '',
            mode: 'commands',
            isBusy: false,
            actionsMenuId: 'command-center-actions-menu',
            onItemClick() {},
            onItemHover() {},
            onItemActions() {},
          }),
        ),
      ),
    );
    const ui = document.getElementById('test-root');
    const searchInput = ui.querySelector('#command-center-search');
    const searchLabel = ui.querySelector('label[for="command-center-search"]');
    assert.ok(searchInput && searchLabel, 'the search combobox has a persistent label');
    assert.equal(searchLabel.textContent.trim(), `${provider.verb} ${provider.name}`);
    const scopeStatus = ui.querySelector('#search-scope-status');
    assert.equal(scopeStatus.getAttribute('role'), 'status');
    assert.equal(scopeStatus.textContent.trim(), `Switched to ${provider.name} search. Type a query to search.`);
    const option = ui.querySelector('[role="option"]');
    const actionButton = ui.querySelector('.result-actions-trigger');
    assert.ok(option && actionButton, 'the selected tab and its actions control render');
    assert.equal(option.querySelector('button'), null, 'listbox options contain no focusable Actions button');
    assert.equal(actionButton.closest('[role="option"]'), null, 'the Actions button is outside the listbox option');
    assert.equal(actionButton.getAttribute('aria-describedby'), resultDomId(renderedTab.id));
    assert.equal(actionButton.getAttribute('aria-label'), `Actions for ${renderedTab.title}`);
    const resultRow = option;
    const resultsContent = ui.querySelector('.results-list-content');
    await act(async () => actionButton.focus());
    assert.ok(resultRow.classList.contains('is-actions-visible'), 'keyboard focus reserves space for row actions');
    await act(async () => {
      actionButton.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    });
    assert.ok(actionButton.classList.contains('is-hovered'), 'pointer hover reveals the row Actions control');
    await act(async () => {
      resultsContent.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    assert.ok(!actionButton.classList.contains('is-hovered'), 'pointer exit clears hover styling');
    assert.ok(
      resultRow.classList.contains('is-actions-visible'),
      'pointer exit preserves spacing while Actions has focus',
    );
    await act(async () => {
      document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    });
    assert.ok(
      !resultRow.classList.contains('is-actions-visible'),
      'pointer interaction clears keyboard-only spacing after the action menu closes',
    );
    await act(async () => {
      actionButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.ok(
      resultRow.classList.contains('is-actions-visible'),
      'keyboard interaction restores spacing for the focused Actions control',
    );
    await act(async () => actionButton.blur());
    assert.ok(
      !resultRow.classList.contains('is-actions-visible'),
      'row spacing collapses after pointer and focus leave',
    );
    const actionShadowHost = document.createElement('div');
    actionShadowHost.tabIndex = -1;
    ui.appendChild(actionShadowHost);
    const actionShadowRoot = actionShadowHost.attachShadow({ mode: 'open' });
    const actionShadowMount = document.createElement('div');
    actionShadowRoot.appendChild(actionShadowMount);
    const actionShadowReactRoot = createRoot(actionShadowMount);
    await act(async () =>
      actionShadowReactRoot.render(
        createElement(ResultsList, {
          items: [renderedTab],
          selectedIndex: 0,
          keyboardNavigationVersion: 0,
          highlightQuery: '',
          mode: 'commands',
          isBusy: false,
          actionsMenuId: 'shadow-actions-menu',
          onItemClick() {},
          onItemHover() {},
          onItemActions() {},
        }),
      ),
    );
    const shadowActionButton = actionShadowRoot.querySelector('.result-actions-trigger');
    const shadowResultRow = actionShadowRoot.querySelector('.result-row');
    assert.ok(shadowActionButton && shadowResultRow, 'row actions render inside the overlay shadow root');
    await act(async () => shadowActionButton.focus());
    assert.equal(document.activeElement, actionShadowHost, 'the closed page boundary exposes only the shadow host');
    await act(async () => {
      document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    });
    assert.ok(
      !shadowResultRow.classList.contains('is-actions-visible'),
      'a pointer interaction inside the overlay clears keyboard-only spacing',
    );
    await act(async () => {
      shadowActionButton.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }),
      );
    });
    assert.ok(
      shadowResultRow.classList.contains('is-actions-visible'),
      'keyboard input on the focused shadow-root button restores its row spacing',
    );
    await act(async () => actionShadowReactRoot.unmount());
    actionShadowHost.remove();
    await unmount(uiEnv);

    const switcherRuntimeEvent = event();
    const switcherStorageEvent = event();
    const previousSwitcherTab = { ...tab('Previous tab'), id: 43, active: false, index: 0 };
    const nextSwitcherTab = { ...tab('Next tab'), id: 44, active: false, index: 1 };
    const currentSwitcherTab = { ...tab('Current tab'), id: 42, index: 2 };
    const switcherTabs = [previousSwitcherTab, nextSwitcherTab, currentSwitcherTab];
    const switcherCalls = [];
    const switcherActivatedTabIds = [];
    let switcherClosed = 0;
    globalThis.chrome = {
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: switcherRuntimeEvent,
        sendMessage: async (message) => {
          switcherCalls.push(message);
          const responses = {
            'tabs:recent': () => switcherTabs,
            'tabs:current': () => currentSwitcherTab,
            'tabs:switcher-shown': () => ({ pendingCycles: 0 }),
            'tabs:recent-previews': () => ({}),
            'tabs:activate': (request) => {
              switcherActivatedTabIds.push(request.tabId);
              return true;
            },
            'tabs:switcher-hidden': () => true,
          };
          const response = responses[message.action];
          assert.ok(response, `Unexpected Tab Switcher background action: ${message.action}`);
          return { success: true, data: response(message) };
        },
      },
      permissions: { getAll: async () => ({ permissions: [] }) },
      storage: { onChanged: switcherStorageEvent },
    };
    root = createRoot(document.getElementById('test-root'));
    await act(async () => {
      root.render(
        createElement(TabSwitcher, {
          onClose: () => switcherClosed++,
          autoSwitchOnRelease: false,
          openedAt: Date.now(),
          surface: 'popup',
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const switcherPanel = document.querySelector('.tab-switcher-panel[role="listbox"]');
    assert.ok(switcherPanel, 'the Tab Switcher renders its horizontal listbox');
    let switcherOptions = switcherPanel.querySelectorAll('[role="option"]');
    assert.equal(switcherOptions.length, 3);
    await act(async () =>
      switcherPanel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    switcherOptions = switcherPanel.querySelectorAll('[role="option"]');
    const selectedSwitcherOption = switcherPanel.querySelector('[aria-selected="true"]');
    assert.equal(selectedSwitcherOption.querySelector('.tab-card-title').textContent, 'Next tab');
    assert.equal(switcherPanel.getAttribute('aria-activedescendant'), selectedSwitcherOption.id);
    await act(async () => {
      switcherPanel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(switcherActivatedTabIds, [44], 'Enter activates the Tab Switcher selection');
    assert.equal(switcherClosed, 1, 'successful Tab Switcher selection closes the switcher');
    assert.ok(switcherCalls.some((message) => message.action === 'tabs:switcher-shown'));
    await act(async () => root.unmount());
    root = null;

    const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    assert.match(css, /\.search-input\s*\{[^}]*caret-color:\s*var\(--cc-accent\)/);
    assert.match(css, /\.search-input:focus-visible\s*\{[^}]*outline:\s*0/);
    assert.match(
      css,
      /\.search-area:has\(\.search-input:focus-visible\) \.search-symbol\s*\{[^}]*color:\s*var\(--cc-accent\)/,
    );
    assert.match(
      css,
      /@media\s*\(forced-colors:\s*active\)[\s\S]*?button:focus-visible,\s*input:focus-visible,\s*select:focus-visible\s*\{[^}]*outline-color:\s*Highlight/,
    );
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?scroll-behavior:\s*auto !important/);
    assert.match(
      css,
      /@media\s*\(hover:\s*hover\)[\s\S]*?\.result-row\.has-actions\s*\{[^}]*padding-inline-end:\s*12px/,
    );
    assert.match(css, /\.result-row\.has-actions\.is-actions-visible\s*\{[^}]*padding-inline-end:\s*48px/);
    assert.match(css, /\.result-row\s*\{[^}]*padding-inline-end 160ms ease-out/);
    assert.match(css, /\.tab-switcher-panel\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/);
    assert.match(
      css,
      /\.tab-card\.is-selected \.tab-card-title\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;[^}]*-webkit-line-clamp:\s*2;/,
    );
    console.log(
      'Palette lifecycle passed: stale snapshots, repeated Enter/retry, group toggles, permission revocation, keyboard search/navigation/selection/back/close, scope announcements, listbox actions, focus and display CSS, subscription cleanup.',
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
