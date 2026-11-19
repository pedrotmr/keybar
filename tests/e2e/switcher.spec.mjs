import { test, expect } from './fixtures.mjs';
import { createRequire } from 'node:module';

const { contentSurfaces } = createRequire(import.meta.url)('../../extension-artifacts.json');

for (const releaseBeforeReady of [false, true]) {
  test(`Tab Switcher activates on modifier release ${releaseBeforeReady ? 'immediately after open request' : 'after rendering'}`, async ({
    extension,
  }) => {
    const { context, worker, id } = extension;
    await context.route('https://switch.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<title>${new URL(route.request().url()).pathname}</title><input>`,
      }),
    );
    const target = await context.newPage();
    await target.goto('https://switch.test/target');
    const source = await context.newPage();
    await source.goto('https://switch.test/source');
    const cdp = await context.newCDPSession(source);
    const root = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await root.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    await root.send('Extensions.triggerAction', {
      id,
      targetId: targetInfos.find((tab) => tab.url === source.url()).targetId,
    });
    await expect(source.locator(`[id="${id}-command-center-surface"]`)).toBeVisible();
    const sourceId = await worker.evaluate(
      async () => (await chrome.tabs.query({})).find((tab) => tab.url === 'https://switch.test/source').id,
    );
    await worker.evaluate(
      async ({ sourceId, surfaceFile }) => {
        await chrome.scripting.executeScript({ target: { tabId: sourceId }, files: [surfaceFile] });
        await chrome.tabs.sendMessage(sourceId, {
          action: 'overlay:open',
          mode: 'tabs',
          autoSwitchOnRelease: true,
          openedAt: Date.now(),
          releaseKey: 'Meta',
        });
      },
      { sourceId, surfaceFile: contentSurfaces.tabs.file },
    );
    if (!releaseBeforeReady) {
      await expect
        .poll(async () =>
          (await cdp.send('Accessibility.getFullAXTree')).nodes.some(
            (node) => node.role?.value === 'listbox' && node.name?.value.includes('Most recently used'),
          ),
        )
        .toBe(true);
    }
    await source.keyboard.press('Meta');
    await expect
      .poll(() =>
        worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url),
      )
      .toBe('https://switch.test/target');
    expect(await source.evaluate(() => document.body.inert)).toBe(false);
    await root.detach();
    await cdp.detach();
  });
}

test('Tab Switcher keeps the selected card visible while navigating at a narrow viewport', async ({ extension }) => {
  const { context, worker, id } = extension;
  await context.route('https://switch.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<title>${new URL(route.request().url()).pathname}</title><input>`,
    }),
  );
  const source = await context.newPage();
  await source.setViewportSize({ width: 600, height: 800 });
  await source.goto('https://switch.test/source');
  for (let index = 0; index < 6; index++) {
    const tab = await context.newPage();
    await tab.goto(`https://switch.test/tab-${index}`);
  }
  await source.bringToFront();

  const cdp = await context.newCDPSession(source);
  const root = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await root.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const target = targetInfos.find((tab) => tab.url === source.url());
  expect(target).toBeDefined();
  await root.send('Extensions.triggerAction', { id, targetId: target.targetId });
  await expect(source.locator(`[id="${id}-command-center-surface"]`)).toBeVisible();
  const sourceId = await worker.evaluate(
    async () => (await chrome.tabs.query({})).find((tab) => tab.url === 'https://switch.test/source').id,
  );
  await worker.evaluate(
    async ({ sourceId, surfaceFile }) => {
      await chrome.scripting.executeScript({ target: { tabId: sourceId }, files: [surfaceFile] });
      await chrome.tabs.sendMessage(sourceId, {
        action: 'overlay:open',
        mode: 'tabs',
        autoSwitchOnRelease: false,
        openedAt: Date.now(),
      });
    },
    { sourceId, surfaceFile: contentSurfaces.tabs.file },
  );

  const panel = source.locator('.tab-switcher-panel[role="listbox"]');
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const selectedCardIsFullyVisible = () =>
    panel.evaluate((element) => {
      const card = element.querySelector('[aria-selected="true"]');
      if (!card) {
        return false;
      }

      const bounds = card.getBoundingClientRect();
      const viewportLeft = element.getBoundingClientRect().left + element.clientLeft;
      const viewportRight = viewportLeft + element.clientWidth;
      return bounds.left >= viewportLeft - 0.5 && bounds.right <= viewportRight + 0.5;
    });

  await source.keyboard.press('ArrowRight');
  await expect.poll(selectedCardIsFullyVisible).toBe(true);

  const panelBounds = await panel.boundingBox();
  expect(panelBounds).not.toBeNull();
  await source.mouse.move(panelBounds.x + panelBounds.width - 18, panelBounds.y + panelBounds.height / 2);
  let previousScrollLeft = await panel.evaluate((element) => element.scrollLeft);
  for (let index = 0; index < 3; index++) {
    await source.mouse.wheel(0, 25);
    await expect.poll(() => panel.evaluate((element) => element.scrollLeft)).toBeGreaterThan(previousScrollLeft);
    previousScrollLeft = await panel.evaluate((element) => element.scrollLeft);
    await expect.poll(selectedCardIsFullyVisible).toBe(true);
  }

  await root.detach();
  await cdp.detach();
});
