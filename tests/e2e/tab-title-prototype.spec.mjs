import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('per-site access prototype overrides a page title and restores it after SPA updates and reloads', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'keybar-title-prototype-'));
  const sourceExtensionPath = path.resolve('prototypes/tab-title-rename');
  const extensionPath = path.join(profile, 'extension');
  let context;

  try {
    await cp(sourceExtensionPath, extensionPath, { recursive: true });
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // A real optional permission dialog is browser chrome UI; pregrant only the test origins for headless runs.
    manifest.host_permissions = ['http://title-prototype.test/*', 'http://other-title.test/*'];
    await writeFile(manifestPath, JSON.stringify(manifest));

    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route('http://title-prototype.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const pageTitle =
        pathname === '/second'
          ? 'Second page title'
          : pathname === '/third'
            ? 'Third page title'
            : 'Original page title';
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>${pageTitle}</title><main>Allowed page</main>`,
      });
    });
    await context.route('http://other-title.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Other site title</title><main>Other site</main>',
      }),
    );

    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto('http://title-prototype.test/regular');
    const activeTab = await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0],
    );
    const popup = await context.newPage();
    await popup.addInitScript((tab) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      const request = chrome.permissions.request.bind(chrome.permissions);
      const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.rejectNextMessage = false;
      window.permissionRequests = [];
      chrome.permissions.request = (permission, callback) => {
        window.permissionRequests.push(permission);
        return request(permission, callback);
      };
      chrome.runtime.sendMessage = (...args) => {
        if (window.rejectNextMessage) {
          window.rejectNextMessage = false;
          return Promise.reject(new Error('Message delivery failed'));
        }

        return sendMessage(...args);
      };
      chrome.tabs.query = (queryInfo, callback) => {
        if (queryInfo?.active && queryInfo?.lastFocusedWindow) {
          if (callback) {
            callback([tab]);
            return;
          }
          return Promise.resolve([tab]);
        }

        return query(queryInfo, callback);
      };
    }, activeTab);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const failedApplyResponse = await popup.evaluate(async () => {
      try {
        return await Promise.race([
          chrome.runtime.sendMessage({
            action: 'title:apply',
            tabId: -1,
            customName: 'Missing tab',
            expectedOrigin: 'http://title-prototype.test',
          }),
          new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 1000)),
        ]);
      } catch {
        return { rejected: true };
      }
    });
    expect(failedApplyResponse).toMatchObject({ success: false, reason: 'operation-failed' });
    await popup.getByLabel('Custom tab name').fill('Prototype  title');
    await popup.getByRole('button', { name: 'Allow this site and apply' }).click();
    await expect(popup.getByRole('status')).toHaveText('Custom title applied.');
    expect(await popup.evaluate(() => window.permissionRequests[0])).toEqual({
      origins: ['http://title-prototype.test/*'],
    });
    await expect(page).toHaveTitle('Prototype title');
    const titleMutations = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let mutations = 0;
          const observer = new MutationObserver(() => mutations++);
          observer.observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(mutations);
          }, 30);
        }),
    );
    expect(titleMutations).toBeLessThan(4);
    await page.evaluate(() => {
      history.pushState({}, '', '/spa');
      document.title = 'SPA provided title';
    });
    await expect(page).toHaveTitle('Prototype title');

    await page.reload();
    await expect(page).toHaveTitle('Prototype title');
    await page.goto('http://title-prototype.test/second');
    await expect(page).toHaveTitle('Prototype title');
    await popup.getByRole('button', { name: 'Restore page title' }).click();
    await expect(page).toHaveTitle('Second page title');

    const secondPage = await context.newPage();
    await secondPage.goto('http://title-prototype.test/third');
    const secondTabId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://title-prototype.test/third' });
      return tab?.id;
    });
    expect(secondTabId).toBeDefined();
    const tabIds = [activeTab.id, secondTabId];
    const concurrentApply = await popup.evaluate(
      async (ids) =>
        Promise.all(
          ids.map((tabId) =>
            chrome.runtime.sendMessage({
              action: 'title:apply',
              tabId,
              customName: 'Concurrent title',
              expectedOrigin: 'http://title-prototype.test',
            }),
          ),
        ),
      tabIds,
    );
    expect(concurrentApply.every((result) => result.success)).toBe(true);
    await expect(page).toHaveTitle('Concurrent title');
    await expect(secondPage).toHaveTitle('Concurrent title');
    const concurrentRestore = await popup.evaluate(
      async (ids) => Promise.all(ids.map((tabId) => chrome.runtime.sendMessage({ action: 'title:restore', tabId }))),
      tabIds,
    );
    expect(concurrentRestore.every((result) => result.success)).toBe(true);
    await expect(page).toHaveTitle('Second page title');
    await expect(secondPage).toHaveTitle('Third page title');

    await popup.getByRole('button', { name: 'Allow this site and apply' }).click();
    await expect(popup.getByRole('status')).toHaveText('Custom title applied.');
    await page.goto('http://other-title.test/regular');
    await expect(page).toHaveTitle('Other site title');
    const staleApply = await popup.evaluate(
      async (tabId) =>
        chrome.runtime.sendMessage({
          action: 'title:apply',
          tabId,
          customName: 'Site A title',
          expectedOrigin: 'http://title-prototype.test',
        }),
      activeTab.id,
    );
    expect(staleApply).toMatchObject({ success: false, reason: 'origin-mismatch' });
    await expect(page).toHaveTitle('Other site title');
    await popup.getByRole('button', { name: 'Restore page title' }).click();
    await expect(popup.getByRole('status')).toHaveText('No active custom title on this page.');
    await expect(page).toHaveTitle('Other site title');
    await popup.evaluate(() => {
      window.rejectNextMessage = true;
    });
    await popup.getByRole('button', { name: 'Allow this site and apply' }).click();
    await expect(popup.getByRole('status')).toHaveText('Could not apply the title.');
    await popup.evaluate(() => {
      window.rejectNextMessage = true;
    });
    await popup.getByRole('button', { name: 'Restore page title' }).click();
    await expect(popup.getByRole('status')).toHaveText('Could not restore the page title.');
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('the prototype cannot inject into restricted Chrome pages', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'keybar-title-restricted-'));
  const sourceExtensionPath = path.resolve('prototypes/tab-title-rename');
  const extensionPath = path.join(profile, 'extension');
  let context;

  try {
    await cp(sourceExtensionPath, extensionPath, { recursive: true });
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // The temporary fixture gets all web hosts so a restricted-page failure cannot be due to missing host access.
    manifest.host_permissions = ['<all_urls>'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route('http://title-prototype.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Allowed page</title>' }),
    );
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto('http://title-prototype.test/regular');
    const tabId = await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id,
    );
    const allowedPageInjection = await worker.evaluate(async (id) => {
      try {
        await chrome.scripting.executeScript({ target: { tabId: id }, func: () => 'allowed' });
        return 'allowed';
      } catch (error) {
        return error.message;
      }
    }, tabId);
    expect(allowedPageInjection).toBe('allowed');
    await page.goto('chrome://version');
    const injection = await worker.evaluate(async (id) => {
      try {
        await chrome.scripting.executeScript({ target: { tabId: id }, func: () => (document.title = 'Not allowed') });
        return 'allowed';
      } catch (error) {
        return error.message;
      }
    }, tabId);
    expect(injection).toMatch(/chrome:\/\/|not allowed|cannot access/i);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('the popup rejects Chrome Web Store pages before requesting site access', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'keybar-title-webstore-'));
  const extensionPath = path.resolve('prototypes/tab-title-rename');
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    for (const url of [
      'https://chromewebstore.google.com/detail/example',
      'https://chrome.google.com/webstore/detail/example',
    ]) {
      const popup = await context.newPage();
      await popup.addInitScript((targetUrl) => {
        window.permissionRequests = [];
        chrome.tabs.get = (tabId) => Promise.resolve({ id: tabId, url: targetUrl });
        chrome.permissions.request = (permission) => {
          window.permissionRequests.push(permission);
          return Promise.resolve(true);
        };
      }, url);
      await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html?tabId=1`);
      await popup.getByRole('button', { name: 'Allow this site and apply' }).click();

      await expect(popup.getByRole('status')).toHaveText('Chrome does not allow access to this page.');
      expect(await popup.evaluate(() => window.permissionRequests)).toEqual([]);
      await popup.close();
    }
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('a no-op restore returns its result when storage writes fail', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'keybar-title-noop-restore-'));
  const extensionPath = path.resolve('prototypes/tab-title-rename');
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await worker.evaluate(() => {
      chrome.storage.local.set = () => Promise.reject(new Error('Storage unavailable'));
    });

    const result = await popup.evaluate(() => chrome.runtime.sendMessage({ action: 'title:restore', tabId: -1 }));
    expect(result).toMatchObject({ success: false, reason: 'no-saved-title' });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
