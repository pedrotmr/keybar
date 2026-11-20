import fs from 'node:fs';
import path from 'node:path';

export function collectProviderIconInventory({
  sourceDirectory,
  emittedDirectory,
  resourceDirectory,
  sourceFiles,
  emittedFilesBySource,
}) {
  const expectedSourceFiles = [...sourceFiles].sort();
  const actualSourceFiles = fs
    .readdirSync(sourceDirectory)
    .filter((file) => file.endsWith('.svg'))
    .sort();

  if (JSON.stringify(actualSourceFiles) !== JSON.stringify(expectedSourceFiles)) {
    throw new Error(
      `Provider icon source files do not match extension-artifacts.json. Expected ${expectedSourceFiles.join(', ')}, found ${actualSourceFiles.join(', ')}.`,
    );
  }

  const emittedFiles = fs
    .readdirSync(emittedDirectory)
    .filter((file) => file.endsWith('.svg'))
    .sort();
  if (emittedFilesBySource.size !== expectedSourceFiles.length) {
    throw new Error(
      `Vite asset mappings do not match extension-artifacts.json. Expected ${expectedSourceFiles.length}, found ${emittedFilesBySource.size}.`,
    );
  }

  const mappedFiles = new Set();
  const inventory = [];

  for (const source of expectedSourceFiles) {
    const file = emittedFilesBySource.get(source);

    if (!file || path.posix.dirname(file) !== resourceDirectory || !file.endsWith('.svg')) {
      throw new Error(`Vite did not map ${source} to an SVG inside ${resourceDirectory}.`);
    }

    const emittedFile = path.posix.basename(file);

    if (mappedFiles.has(emittedFile) || !emittedFiles.includes(emittedFile)) {
      throw new Error(`Vite asset mapping for ${source} points to a missing or duplicate output: ${file}.`);
    }

    const sourceBytes = fs.readFileSync(path.join(sourceDirectory, source));
    const emittedBytes = fs.readFileSync(path.join(emittedDirectory, emittedFile));

    if (!sourceBytes.equals(emittedBytes)) {
      throw new Error(`Emitted provider SVG ${file} does not match source ${source}.`);
    }

    mappedFiles.add(emittedFile);
    inventory.push({ source, file });
  }

  if (mappedFiles.size !== emittedFiles.length || emittedFiles.some((file) => !mappedFiles.has(file))) {
    throw new Error(`Expected ${inventory.length} emitted provider SVGs, found ${emittedFiles.length}.`);
  }

  return inventory;
}
