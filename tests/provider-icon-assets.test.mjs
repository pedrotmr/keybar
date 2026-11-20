import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectProviderIconInventory } from '../scripts/provider-icon-assets.mjs';

test('provider icon inventory maps each emitted SVG to its registered source bytes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'keybar-provider-icons-'));
  const sourceDirectory = path.join(root, 'src');
  const emittedDirectory = path.join(root, 'dist');
  const sourceFiles = ['google.svg', 'google-maps.svg'];
  const sourceBytes = new Map([
    ['google.svg', Buffer.from('<svg id="google"/>')],
    ['google-maps.svg', Buffer.from('<svg id="google-maps"/>')],
  ]);
  const emittedFilesBySource = new Map([
    ['google.svg', 'assets/provider-icons/google-hash.svg'],
    ['google-maps.svg', 'assets/provider-icons/google-maps-hash.svg'],
  ]);
  const collect = () =>
    collectProviderIconInventory({
      sourceDirectory,
      emittedDirectory,
      resourceDirectory: 'assets/provider-icons',
      sourceFiles,
      emittedFilesBySource,
    });

  mkdirSync(sourceDirectory);
  mkdirSync(emittedDirectory);
  for (const [file, bytes] of sourceBytes) {
    writeFileSync(path.join(sourceDirectory, file), bytes);
    writeFileSync(path.join(emittedDirectory, file.replace('.svg', '-hash.svg')), bytes);
  }

  try {
    assert.deepEqual(collect(), [
      { source: 'google-maps.svg', file: 'assets/provider-icons/google-maps-hash.svg' },
      { source: 'google.svg', file: 'assets/provider-icons/google-hash.svg' },
    ]);

    writeFileSync(path.join(emittedDirectory, 'google-maps-hash.svg'), sourceBytes.get('google.svg'));
    writeFileSync(path.join(emittedDirectory, 'google-hash.svg'), sourceBytes.get('google-maps.svg'));
    assert.throws(
      collect,
      /Emitted provider SVG assets\/provider-icons\/google-maps-hash\.svg does not match source google-maps\.svg/,
    );

    writeFileSync(path.join(emittedDirectory, 'google-maps-hash.svg'), sourceBytes.get('google-maps.svg'));
    writeFileSync(path.join(emittedDirectory, 'google-hash.svg'), sourceBytes.get('google.svg'));
    rmSync(path.join(emittedDirectory, 'google-maps-hash.svg'));
    assert.throws(collect, /Vite asset mapping for google-maps\.svg points to a missing or duplicate output/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
