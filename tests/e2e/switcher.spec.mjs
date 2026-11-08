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
