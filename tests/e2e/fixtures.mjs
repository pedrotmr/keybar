import { test as base, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const { popupHtml } = createRequire(import.meta.url)('../../extension-artifacts.json');

export const test = base.extend({
  extension: async ({ playwright }, use) => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'keybar-release-'));
    const extensionPath = path.resolve(process.env.EXTENSION_PATH ?? 'dist');
    const context = await playwright.chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: process.env.HEADED !== '1',
      args: [
        '--enable-unsafe-extension-debugging',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    try {
      const errors = [];
      context.on('weberror', (event) => errors.push(event.error().message));
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).host;
      const url = `chrome-extension://${id}/${popupHtml}?mode=commands`;
      await use({ context, worker, id, url, profile });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
});
export { expect };
