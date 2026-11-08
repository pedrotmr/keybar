import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

const sourceManifestPath = path.join(projectRoot, 'src', 'manifest.json');
const manifestPath = path.join(distDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const artifacts = JSON.parse(fs.readFileSync(path.join(projectRoot, 'extension-artifacts.json'), 'utf8'));
const noticesPath = artifacts.notices;
manifest.version = packageMetadata.version;
manifest.web_accessible_resources = [
  {
    resources: Object.values(artifacts.fonts.families).flatMap((family) => family.faces.map((face) => face.path)),
    matches: artifacts.fonts.matches,
  },
];

if (!fs.existsSync(path.join(distDir, manifest.background.service_worker))) {
  throw new Error(`Build output is missing ${manifest.background.service_worker}`);
}
if (!fs.existsSync(path.join(distDir, artifacts.popupHtml))) {
  throw new Error('Build output is missing the native extension popup.');
}
const exposedResources = manifest.web_accessible_resources?.flatMap((entry) => entry.resources) ?? [];
if (exposedResources.some((file) => !file.startsWith('assets/fonts/') || !fs.existsSync(path.join(distDir, file)))) {
  throw new Error('Build output is missing an exposed UI font asset.');
}
const contentBundles = Object.values(artifacts.contentSurfaces).map((surface) => surface.file);
if (contentBundles.some((file) => !fs.existsSync(path.join(distDir, file)))) {
  throw new Error('Build output is missing one of the on-demand page surfaces.');
}
for (const file of contentBundles) {
  const bundle = fs.readFileSync(path.join(distDir, file), 'utf8');
  if (/process\.env\.NODE_ENV/.test(bundle)) {
    throw new Error(`${file} contains an unbundled NODE_ENV reference.`);
  }
}
if (
  manifest.content_scripts?.length ||
  manifest.host_permissions?.length ||
  manifest.optional_host_permissions?.length
) {
  throw new Error('The extension build unexpectedly includes page injection or host permissions.');
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const notices = fs.readFileSync(path.join(projectRoot, noticesPath), 'utf8').replaceAll('public/assets/', 'assets/');
const runtimeLicenses = ['react', 'react-dom'].map(
  (dependency) =>
    `\n\n## ${dependency}\n\n${fs.readFileSync(path.join(projectRoot, 'node_modules', dependency, 'LICENSE'), 'utf8')}`,
);
fs.writeFileSync(path.join(distDir, noticesPath), notices + runtimeLicenses.join(''));
console.log('✓ Copied and validated extension manifest');

console.log('✓ Post-build steps completed');
