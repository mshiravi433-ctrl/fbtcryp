#!/usr/bin/env node
/**
 * i18n merge helper — add/overwrite nested keys in one or more locale files.
 *
 *   node scripts/i18n-merge.mjs patch.json            # applies to every locale named in the patch
 *
 * The patch file shape: { "<lang>": { "a": { "b": "text" } }, ... }.
 * Existing keys not named in the patch are left untouched; the file keeps its
 * 2-space indentation and non-ASCII text (never \uXXXX escapes).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const patchPath = process.argv[2];
if (!patchPath) {
  console.error('usage: node scripts/i18n-merge.mjs patch.json');
  process.exit(1);
}
const patch = JSON.parse(readFileSync(patchPath, 'utf8'));

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

for (const [lang, tree] of Object.entries(patch)) {
  const file = resolve('src/i18n/locales', `${lang}.json`);
  const current = JSON.parse(readFileSync(file, 'utf8'));
  deepMerge(current, tree);
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`merged → ${lang}.json`);
}
