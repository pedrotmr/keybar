import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifacts = JSON.parse(readFileSync(path.join(root, 'extension-artifacts.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Package and extension versions do not match.');
for (const file of [
  manifest.background.service_worker,
  ...Object.values(artifacts.contentSurfaces).map((surface) => surface.file),
  artifacts.popupHtml,
  artifacts.notices,
]) {
  readFileSync(path.join(dist, file));
}
const release = path.join(root, 'release');
mkdirSync(release, { recursive: true });
const filename = `keybar-${manifest.version}.zip`;
const output = path.join(release, filename);
rmSync(output, { force: true });
const result = spawnSync('zip', ['-q', '-r', output, '.'], { cwd: dist, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`zip failed with exit code ${result.status}`);
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
console.log(`${output}\nSHA-256: ${sha256}`);
