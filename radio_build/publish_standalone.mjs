import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const RADIO_STANDALONE_FILES = Object.freeze([
  'radio_fbt.html',
  'FBT_Radio_2Hours_chapters.txt'
]);

/**
 * Copy the standalone radio page and its chapter download into a build output.
 * Vite copies files from `public/`, but these canonical source files stay at
 * the repository root for radio_server.py and README-local workflows.
 */
export function publishRadioStandaloneFiles(outDir = resolve(REPOSITORY_ROOT, 'dist')) {
  const outputRoot = resolve(REPOSITORY_ROOT, outDir);

  for (const relativePath of RADIO_STANDALONE_FILES) {
    const source = resolve(REPOSITORY_ROOT, relativePath);
    const destination = resolve(outputRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }

  return [...RADIO_STANDALONE_FILES];
}
