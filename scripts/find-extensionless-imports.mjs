/**
 * FIND THE EXTENSIONLESS IMPORTS (2026-11-12)
 * ===========================================================================
 *
 * Node's ESM resolver refuses an extensionless relative import. Vite
 * accepts it. So a file like
 *
 *     import { EVM_CHAINS } from '../chains';
 *
 * builds into the browser bundle and FAILS on the server — and it fails
 * only at runtime, when that module is first imported.
 *
 * This finds every such import, and separates the two cases that matter:
 *
 *   · UNRESOLVABLE — the target does not exist under ANY extension. The
 *     import is broken everywhere.
 *   · EXTENSIONLESS — the target exists (as `.js`), so Vite resolves it
 *     but Node does not. The module breaks on the server only.
 *
 * Usage:
 *   node scripts/find-extensionless-imports.mjs
 *   node scripts/find-extensionless-imports.mjs --json
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const AS_JSON = process.argv.includes('--json');
const ROOT = process.cwd();

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.next', 'coverage'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(m?js)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const files = [
  ...walk(join(ROOT, 'server')),
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'scripts'))
];

const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"](\.\.?\/[^'"]*?)['"]/g;
const EXTS = ['.js', '.mjs', '.jsx', '.json', '/index.js', '/index.mjs'];

const rows = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (/\.(m?js|jsx|json|css)$/.test(spec)) continue;
    if (spec.endsWith('/')) continue;
    const target = resolve(dirname(file), spec);
    const resolves = EXTS.some((ext) => existsSync(target + ext));
    rows.push({
      file: rel,
      spec,
      resolves,
      /* An extensionless import that RESOLVES is a server-only break:
         Vite finds the file, Node does not. */
      kind: resolves ? 'extensionless' : 'unresolvable'
    });
  }
}

const unresolvable = rows.filter((r) => !r.resolves);
const extensionless = rows.filter((r) => r.resolves);

const summary = {
  schema: 'fbt.extensionless-imports.v1',
  measuredAt: new Date().toISOString(),
  filesScanned: files.length,
  totals: {
    imports: rows.length,
    unresolvable: unresolvable.length,
    extensionless: extensionless.length
  },
  unresolvable,
  extensionless
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('\nEXTENSIONLESS RELATIVE IMPORTS — Node ESM cannot resolve these\n');
  console.log(`  files scanned              ${summary.filesScanned}`);
  console.log(`  imports found              ${summary.totals.imports}`);
  console.log(`  UNRESOLVABLE (broken)      ${summary.totals.unresolvable}`);
  console.log(`  extensionless (server break)${String(summary.totals.extensionless).padStart(4)}`);
  console.log('');
  if (unresolvable.length) {
    console.log('BROKEN — THE TARGET DOES NOT EXIST AT ALL');
    for (const r of unresolvable) console.log(`  ${r.file.padEnd(46)} ${r.spec}`);
    console.log('');
  }
  console.log('EXTENSIONLESS — THE TARGET EXISTS, BUT ONLY NODE BREAKS');
  for (const r of extensionless) console.log(`  ${r.file.padEnd(46)} ${r.spec}`);
}
