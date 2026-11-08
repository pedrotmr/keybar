import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const { popupHtml } = createRequire(import.meta.url)('../../extension-artifacts.json');

test('names and preferences survive a complete browser restart and restored tab IDs', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'keybar-session-'));
  const extensionPath = path.resolve(process.env.EXTENSION_PATH ?? 'dist');
  const options = {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, options);
    let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    const savedUrl = 'data:text/html,<title>Restored unique tab</title>';
    await page.goto(savedUrl);
    const original = await worker.evaluate(async () =>
      (await chrome.tabs.query({})).find((tab) => tab.title === 'Restored unique tab'),
    );
    const menu = await context.newPage();
    await menu.goto(`chrome-extension://${new URL(worker.url()).host}/${popupHtml}`);
    const result = await menu.evaluate(
      (tabId) => chrome.runtime.sendMessage({ action: 'tabs:rename', tabId, name: 'Persistent Quasar' }),
      original.id,
    );
    expect(result.success).toBe(true);
    await menu.evaluate(() =>
      chrome.storage.local.set({ themePreferences: { windowMode: 'compact', palette: 'plain' } }),
    );
    await menu.close();
    await page.bringToFront();
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      ...options,
      args: [...options.args, '--restore-last-session'],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await expect
      .poll(() =>
        worker.evaluate(async () => (await chrome.tabs.query({})).some((tab) => tab.title === 'Restored unique tab')),
      )
      .toBe(true);
    const nextMenu = await context.newPage();
    await nextMenu.goto(`chrome-extension://${new URL(worker.url()).host}/${popupHtml}?mode=commands`);
    await nextMenu.getByRole('combobox').fill('Persistent Quasar');
    await expect(nextMenu.getByRole('option').first()).toHaveAttribute('id', /^command-center-option-tab-/);
    await expect(nextMenu.getByRole('option').first()).toContainText('Persistent Quasar');
    const preferences = await nextMenu.evaluate(
      async () => (await chrome.storage.local.get('themePreferences')).themePreferences,
    );
    expect(preferences.windowMode).toBe('compact');
    const current = await worker.evaluate(async () =>
      (await chrome.tabs.query({})).find((tab) => tab.title === 'Restored unique tab'),
    );
    const names = await nextMenu.evaluate(async () => (await chrome.storage.local.get('renamedTabs')).renamedTabs);
    expect(names[String(current.id)]?.customName).toBe('Persistent Quasar');
    test.info().annotations.push({ type: 'restored-tab-ids', description: `${original.id} -> ${current.id}` });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
