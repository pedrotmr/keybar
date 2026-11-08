import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { event, makeChrome } from './helpers/chrome.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = JSON.parse(await readFile(path.join(projectRoot, 'extension-artifacts.json'), 'utf8'));

test('reliability contracts', { timeout: 15000 }, async (t) => {
  const original = { chrome: globalThis.chrome, window: globalThis.window, document: globalThis.document };
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  t.after(async () => {
    Object.assign(globalThis, original);
    await server.close();
  });
  let chrome, tabs, sendBackground;
  t.beforeEach(async () => {
    ({ chrome, tabs } = makeChrome());
    globalThis.chrome = chrome;
    server.moduleGraph.invalidateAll();
    await server.ssrLoadModule(`/${artifacts.background.entry}`);
    ({ sendBackground } = await server.ssrLoadModule('/src/utils/chromeHelpers.ts'));
  });

  await t.test('message channel carries data and errors and recovers after rejection', async () => {
    assert.equal((await sendBackground('tabs:current')).id, 1);
    await assert.rejects(sendBackground('unknown-action'), /Unknown command/);
    await assert.rejects(sendBackground('tabs:activate', { tabId: 999 }), /No tab with id/);
    assert.equal((await sendBackground('tabs:current')).id, 1);
  });
  await t.test('activation survives a vanished source and focuses the target window', async () => {
    const focused = [];
    chrome.windows.update = async (id, values) => focused.push({ id, ...values });
    assert.equal(await sendBackground('tabs:activate', { tabId: 2, sourceTabId: 999 }), true);
    assert.deepEqual(focused, [{ id: 20, focused: true }]);
    assert.equal(tabs.find((tab) => tab.id === 2).active, true);
  });
  await t.test('hard reload bypasses cache and propagates Chrome errors', async () => {
    const reloads = [];
    chrome.tabs.reload = async (...args) => reloads.push(args);
    await sendBackground('tabs:hard-reload-active');
    assert.deepEqual(reloads, [[1, { bypassCache: true }]]);
    chrome.tabs.reload = async () => {
      throw new Error('Tab closed during reload');
    };
    await assert.rejects(sendBackground('tabs:hard-reload-active'), /Tab closed during reload/);
  });
  await t.test('concurrent renames preserve both records; failed persistence does not poison queue', async () => {
    await Promise.all([
      sendBackground('tabs:rename', { tabId: 1, name: ' Work ' }),
      sendBackground('tabs:rename', { tabId: 2, name: 'Docs' }),
    ]);
    assert.equal(chrome.storage.local.data.renamedTabs[1]?.customName, 'Work');
    assert.equal(chrome.storage.local.data.renamedTabs[2].customName, 'Docs');
    const save = chrome.storage.local.set;
    chrome.storage.local.set = async () => {
      throw new Error('Storage quota');
    };
    await assert.rejects(sendBackground('tabs:rename', { tabId: 1, name: 'Lost' }), /Storage quota/);
    assert.equal(chrome.storage.local.data.renamedTabs[1]?.customName, 'Work');
    chrome.storage.local.set = save;
    await sendBackground('tabs:rename', { tabId: 1, name: 'Recovered' });
    assert.equal(chrome.storage.local.data.renamedTabs[1].customName, 'Recovered');
  });
  await t.test('optional API absence is an error response, capabilities remain usable', async () => {
    await assert.rejects(sendBackground('bookmarks:list'), /getTree/);
    assert.deepEqual(await sendBackground('browser:split-capabilities'), { create: false, unsplit: false });
  });
  await t.test('transport rejection and empty responses cannot masquerade as success', async () => {
    chrome.runtime.sendMessage = async () => undefined;
    await assert.rejects(sendBackground('tabs:close'), /could not be completed/);
    chrome.runtime.sendMessage = async () => {
      throw new Error('Extension context invalidated');
    };
    await assert.rejects(sendBackground('tabs:close'), /Extension context invalidated/);
  });
  await t.test('close right preserves current tab and tabs in another window', async () => {
    await sendBackground('tabs:close-right');
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      [1, 2],
    );
  });

  await t.test('confirmed bulk close stays anchored when focus changes', async () => {
    chrome.windows.getLastFocused = async () => ({ id: 20 });
    await sendBackground('tabs:close-confirmed', {
      closeAction: 'tabs:close-right',
      anchorTabId: 1,
      windowId: 10,
      tabIds: [3],
    });
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      [1, 2],
    );
  });
  await t.test('bulk close matches the palette target set when an own-extension page is open', async () => {
    tabs.push({ id: 4, windowId: 10, index: 2, url: chrome.runtime.getURL(artifacts.popupHtml) });
    await sendBackground('tabs:close-confirmed', {
      closeAction: 'tabs:close-right',
      anchorTabId: 1,
      windowId: 10,
      tabIds: [3],
    });
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      [1, 2, 4],
    );
  });
  for (const change of ['added', 'reordered', 'moved', 'closed', 'anchor-closed']) {
    await t.test(`bulk close refuses a stale confirmation after tabs are ${change}`, async () => {
      if (change === 'added') tabs.push({ id: 4, windowId: 10, index: 2 });
      if (change === 'reordered') tabs.find((tab) => tab.id === 3).index = -1;
      if (change === 'moved') tabs.find((tab) => tab.id === 1).windowId = 20;
      if (change === 'closed')
        tabs.splice(
          tabs.findIndex((tab) => tab.id === 3),
          1,
        );
      if (change === 'anchor-closed')
        tabs.splice(
          tabs.findIndex((tab) => tab.id === 1),
          1,
        );
      const before = structuredClone(tabs);
      await assert.rejects(
        sendBackground('tabs:close-confirmed', {
          closeAction: 'tabs:close-right',
          anchorTabId: 1,
          windowId: 10,
          tabIds: [3],
        }),
        /Tabs changed/,
      );
      assert.deepEqual(tabs, before, 'a stale confirmation cannot remove any tabs');
    });
  }
  await t.test('bulk close validates confirmation and restricts other/group closes to the anchor window', async () => {
    const tabsBeforeInvalidClose = structuredClone(tabs);
    await assert.rejects(
      sendBackground('tabs:close-confirmed', {
        closeAction: 'tabs:close-right',
        anchorTabId: 1,
        windowId: 10,
        tabIds: [3, 3],
      }),
    );
    assert.deepEqual(tabs, tabsBeforeInvalidClose, 'duplicate tab IDs reject without closing tabs');
    tabs.forEach((tab) => {
      tab.groupId = 4;
    });
    await sendBackground('tabs:close-confirmed', {
      closeAction: 'groups:close-current',
      anchorTabId: 1,
      windowId: 10,
      tabIds: [1, 3],
    });
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      [2],
    );
  });

  await t.test('overlay open / close / reopen before React mount honors latest intent', async () => {
    chrome.runtime.onMessage = event();
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = { body: { inert: false, isConnected: true } };
    const { attachOverlayListeners } = await server.ssrLoadModule('/src/overlay/surfaceHost/listeners.ts');
    const display = new Map();
    const host = {
      style: { setProperty: (key, value) => display.set(key, value) },
      matches: () => false,
      showPopover() {},
      removeAttribute() {},
    };
    const controller = {
      surface: 'commands',
      host,
      bridge: { pendingOpen: false, pendingClose: false, pendingCycles: 0 },
    };
    const detach = attachOverlayListeners(controller, { querySelector: () => null });
    try {
      const dispatch = (action, sender = { id: chrome.runtime.id }) =>
        chrome.runtime.onMessage.emit({ action }, sender, () => {});
      dispatch('overlay:open', { id: 'foreign-extension' });
      assert.equal(controller.bridge.pendingOpen, false);
      dispatch('overlay:open');
      assert.equal(document.body.inert, true);
      dispatch('overlay:close');
      assert.equal(controller.bridge.pendingOpen, false, 'a closed surface must not mount as open');
      assert.equal(document.body.inert, false);
      dispatch('overlay:open');
      assert.equal(controller.bridge.pendingClose, false, 'a previous close must not cancel a newer open');
      assert.equal(controller.bridge.pendingOpen, true);
      assert.equal(display.get('display'), 'block');
    } finally {
      detach();
    }
    assert.equal(chrome.runtime.onMessage.listeners.size, 0);
  });
});
