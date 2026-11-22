import { test, expect } from './fixtures.mjs';

test('an old refresh failure cannot replace a newer successful tab list', async ({ extension }) => {
  const { context, url } = extension;
  const menu = await context.newPage();
  await menu.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    const listeners = [];
    const add = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
    chrome.runtime.onMessage.addListener = (listener) => {
      listeners.push(listener);
      add(listener);
    };
    window.auditRefresh = () => {
      for (const listener of listeners) listener({ action: 'ui:tabs-changed' }, {}, () => {});
    };
    chrome.runtime.sendMessage = async (message, ...args) => {
      if (message.action === 'tabs:list') {
        if (!window.auditRejectOldList)
          return new Promise((_, reject) => {
            window.auditRejectOldList = () => reject(new Error('Old request lost'));
          });
        return {
          success: true,
          data: {
            tabs: [{ id: 71, windowId: 1, index: 0, title: 'Fresh Quasar', url: 'https://fresh.test/', active: true }],
            currentTabId: 71,
            currentWindowId: 1,
          },
        };
      }
      return send(message, ...args);
    };
  });
  await menu.goto(url);
  await expect.poll(() => menu.evaluate(() => Boolean(window.auditRejectOldList))).toBe(true);
  await menu.evaluate(() => window.auditRefresh());
  await menu.getByRole('combobox').fill('Fresh Quasar');
  await expect(menu.locator('[id="command-center-option-tab-71"]')).toBeVisible();
  await menu.evaluate(async () => {
    window.auditRejectOldList();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(menu.getByRole('status').filter({ hasText: 'Could not load open tabs.' })).toHaveCount(0);
  await expect(menu.locator('[id="command-center-option-tab-71"]')).toBeVisible();
});
