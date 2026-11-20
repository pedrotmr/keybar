import { test, expect } from './fixtures.mjs';

test('loaded extension: keyboard flow, persistence, worker restart and stale responses', async ({ extension }) => {
  const { context, worker, url } = extension;
  await context.route('https://audit.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Audit destination</title><input aria-label="Page input">',
    }),
  );
  const destination = await context.newPage();
  await destination.goto('https://audit.test/target');
  let menu = await context.newPage();
  await menu.goto(url);
  let input = menu.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('Audit destination');
  await expect(menu.getByRole('option').first()).toContainText('Audit destination');
  await input.press('ArrowDown');
  const selected = await input.getAttribute('aria-activedescendant');
  await expect(menu.locator(`[id="${selected}"]`)).toHaveAttribute('aria-selected', 'true');
  // Use a unique tab result so Enter must activate the searched destination.
  await input.fill('Audit destination');
  await expect(menu.getByRole('option').first()).toContainText('Audit destination');
  await input.press('ArrowUp');
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect.poll(() => menu.isClosed()).toBe(true);
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return tab?.url;
      }),
    )
    .toBe('https://audit.test/target');

  menu = await context.newPage();
  input = menu.getByRole('combobox');
  await menu.goto(url);
  await expect(input).toBeFocused();
  // Escape closes this extension document during key dispatch. Chromium may
  // destroy the protocol target before Playwright receives its acknowledgement.
  const escapeError = await menu.keyboard.press('Escape').catch((error) => error);
  await expect.poll(() => menu.isClosed()).toBe(true);
  if (escapeError) expect(escapeError.message).toContain('Target page, context or browser has been closed');
  menu = await context.newPage();
  input = menu.getByRole('combobox');
  await menu.goto(url);
  await expect(input).toBeFocused();
  await menu.getByRole('button', { name: 'Appearance settings' }).click();
  await menu.getByRole('button', { name: 'Compact Show results after you start typing', exact: true }).click();
  await expect
    .poll(() =>
      menu.evaluate(async () => (await chrome.storage.local.get('themePreferences')).themePreferences?.windowMode),
    )
    .toBe('compact');
  await menu.reload();
  await menu.getByRole('button', { name: 'Appearance settings' }).click();
  await expect(
    menu.getByRole('button', { name: 'Compact Show results after you start typing', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  const cdp = await context.newCDPSession(menu);
  const versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updated }) => versions.push(...updated));
  await cdp.send('ServiceWorker.enable');
  await expect
    .poll(() => versions.some((version) => version.scriptURL === worker.url() && version.status === 'activated'))
    .toBe(true);
  const version = versions.findLast((version) => version.scriptURL === worker.url() && version.status === 'activated');
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  const response = await menu.evaluate(() => chrome.runtime.sendMessage({ action: 'tabs:list' }));
  expect(response.success).toBe(true);
  expect(response.data.tabs.some((tab) => tab.url === 'https://audit.test/target')).toBe(true);
  const denied = await menu.evaluate(() => chrome.runtime.sendMessage({ action: 'bookmarks:list' }));
  expect(denied.success).toBe(false);
  await cdp.detach();

  // Delay one real API response at the UI boundary to control ordering.
  // This portion tests React's race handling, not Chrome's response ordering.
  await menu.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (message, ...args) => {
      const response = await send(message, ...args);
      if (message.action === 'tabs:list' && !window.auditHeldList) {
        window.auditHeldList = true;
        window.auditOldTabs = response.data.tabs.map((tab) => tab.title);
        return new Promise((resolve) => {
          window.auditReleaseList = () => resolve(response);
        });
      }
      if (message.action === 'tabs:list' && window.auditFreezeLists) return new Promise(() => {});
      return response;
    };
  });
  await menu.goto(url);
  await expect.poll(() => menu.evaluate(() => Boolean(window.auditReleaseList))).toBe(true);
  await context.route('https://audit.test/newest', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Race newest</title>' }),
  );
  const newest = await context.newPage();
  await newest.goto('https://audit.test/newest');
  await menu.bringToFront();
  await input.fill('Race newest');
  await expect(menu.getByRole('option').first()).toContainText('Race newest');
  await expect(menu.getByRole('option').first()).toHaveAttribute('id', /^command-center-option-tab-/);
  await menu.evaluate(async () => {
    if (window.auditOldTabs.includes('Race newest')) throw new Error('Race setup did not hold an old snapshot');
    window.auditFreezeLists = true;
    window.auditReleaseList();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(menu.getByRole('option').first()).toContainText('Race newest');
  await expect(menu.getByRole('option').first()).toHaveAttribute('id', /^command-center-option-tab-/);
});
