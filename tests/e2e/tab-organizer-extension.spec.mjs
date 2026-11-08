import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('tab organizer extension starts its worker and loads its popup', async ({ playwright }) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'keybar-organizer-extension-'));
  const extensionPath = path.resolve('prototypes/tab-organizer/extension');
  const context = await playwright.chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: process.env.HEADED !== '1',
    args: [
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const errors = [];
  context.on('weberror', (event) => errors.push(event.error().message));

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'Organize tabs' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
