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

  const surfaceId = `${id}-command-center-surface`;
  const readPanel = () =>
    worker.evaluate(
      async ({ sourceId, surfaceId }) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: sourceId },
          world: 'ISOLATED',
          func: (surfaceId) => {
            const surface = document.getElementById(surfaceId);
            if (!(surface instanceof HTMLElement)) {
              return null;
            }

            const shadowRoot = chrome.dom.openOrClosedShadowRoot(surface);
            const panel = shadowRoot?.querySelector('.tab-switcher-panel[role="listbox"]');
            const selectedCard = panel?.querySelector('[aria-selected="true"]');
            if (!(panel instanceof HTMLElement) || !(selectedCard instanceof HTMLElement)) {
              return null;
            }

            const panelBounds = panel.getBoundingClientRect();
            const cardBounds = selectedCard.getBoundingClientRect();
            const viewportLeft = panelBounds.left + panel.clientLeft;
            const viewportRight = viewportLeft + panel.clientWidth;

            return {
              animationFinished: panel.getAnimations().every((animation) => animation.playState === 'finished'),
              focused: shadowRoot.activeElement === panel,
              scrollLeft: panel.scrollLeft,
              scrollable: panel.scrollWidth > panel.clientWidth,
              selectedLabel: selectedCard.getAttribute('aria-label'),
              selectedIndex: Number.parseInt(selectedCard.getAttribute('aria-label') ?? '', 10) - 1,
              selectedCardIsFullyVisible:
                cardBounds.left >= viewportLeft - 0.5 && cardBounds.right <= viewportRight + 0.5,
              bounds: {
                x: panelBounds.x,
                y: panelBounds.y,
                width: panelBounds.width,
                height: panelBounds.height,
              },
            };
          },
          args: [surfaceId],
        });

        return result?.result ?? null;
      },
      { sourceId, surfaceId },
    );

  await expect.poll(async () => (await readPanel())?.focused).toBe(true);
  await expect.poll(async () => (await readPanel())?.scrollable).toBe(true);
  await expect.poll(async () => (await readPanel())?.animationFinished).toBe(true);
  const initiallySelectedLabel = (await readPanel())?.selectedLabel;
  expect(initiallySelectedLabel).toBeTruthy();
  await expect.poll(async () => (await readPanel())?.selectedCardIsFullyVisible).toBe(true);

  await source.keyboard.press('Home');
  await expect.poll(async () => (await readPanel())?.selectedIndex).toBe(0);
  await source.setViewportSize({ width: 1200, height: 800 });
  await source.keyboard.press('End');
  await expect.poll(async () => (await readPanel())?.selectedIndex).toBe(6);
  await expect.poll(async () => (await readPanel())?.selectedCardIsFullyVisible).toBe(true);

  await source.setViewportSize({ width: 600, height: 800 });
  await expect.poll(async () => (await readPanel())?.selectedCardIsFullyVisible).toBe(true);

  const selectedBeforeArrow = (await readPanel())?.selectedIndex;
  expect(selectedBeforeArrow).toBeDefined();
  await source.keyboard.press('ArrowRight');
  await expect.poll(async () => (await readPanel())?.selectedIndex).toBe((selectedBeforeArrow + 1) % 7);
  await expect.poll(async () => (await readPanel())?.selectedCardIsFullyVisible).toBe(true);

  const panelBounds = (await readPanel())?.bounds;
  expect(panelBounds).toBeDefined();
  await source.mouse.move(panelBounds.x + panelBounds.width - 18, panelBounds.y + panelBounds.height / 2);
  let previousScrollLeft = (await readPanel())?.scrollLeft;
  expect(previousScrollLeft).toBeDefined();
  for (let index = 0; index < 3; index++) {
    await source.mouse.wheel(0, 25);
    await expect.poll(async () => (await readPanel())?.scrollLeft).toBeGreaterThan(previousScrollLeft);
    previousScrollLeft = (await readPanel())?.scrollLeft;
    await expect.poll(async () => (await readPanel())?.selectedCardIsFullyVisible).toBe(true);
  }

  await root.detach();
  await cdp.detach();
});
