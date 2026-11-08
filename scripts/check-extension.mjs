import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const directory = await realpath(path.join(root, 'dist'));
  const source = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const artifacts = JSON.parse(await readFile(path.join(root, 'extension-artifacts.json'), 'utf8'));
  const built = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const expectedManifest = {
    ...source,
    version: pkg.version,
    web_accessible_resources: [
      {
        resources: Object.values(artifacts.fonts.families).flatMap((family) => family.faces.map((face) => face.path)),
        matches: artifacts.fonts.matches,
      },
    ],
  };
  assert.deepEqual(built, expectedManifest, 'Build manifest differs from source; run npm run build');
  const bundles = {};
  for (const file of [
    built.background.service_worker,
    ...Object.values(artifacts.contentSurfaces).map((surface) => surface.file),
    artifacts.popupHtml,
  ]) {
    const bytes = await readFile(path.join(directory, file));
    bundles[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  console.log(
    JSON.stringify(
      {
        directory,
        version: built.version,
        minimumChrome: built.minimum_chrome_version,
        permissions: built.permissions,
        bundles,
        browser:
          'NOT VERIFIED: check connection, user agent, extension ID and Loaded from in chrome://extensions; see docs/extension-validation.md',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`Extension preflight failed: ${error.message}. Run npm run build before loading dist/.`);
  process.exitCode = 1;
}
