import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import source from '../scripts/locales/tpsl-history.mjs';
import { build } from 'vite';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const en = JSON.parse(read('src/i18n/locales/en.json'));
const at = (obj, key) => key.split('.').reduce((o, k) => o?.[k], obj);
const leaves = (obj, prefix) => Object.entries(obj).flatMap(([k, v]) =>
  typeof v === 'object' ? leaves(v, `${prefix}.${k}`) : [[`${prefix}.${k}`, v]]);
const entries = [...leaves(en.dydx.tpsl, 'dydx.tpsl'), ...leaves(en.futures.history, 'futures.history')];
const placeholders = (s) => [...s.matchAll(/\{\{\w+\}\}/g)].map((m) => m[0]).sort();
const files = readdirSync(new URL('../src/i18n/locales', import.meta.url)).filter((f) => f.endsWith('.json'));
assert.equal(files.length, 12);
for (const file of files) {
  test(`${file}: all 94 TP/SL and history keys, with matching placeholders`, () => {
    const locale = JSON.parse(read(`src/i18n/locales/${file}`));
    assert.equal(entries.length, 94);
    for (const [key, value] of entries) {
      const text = at(locale, key);
      assert.equal(typeof text, 'string', key);
      assert.ok(text.trim(), key);
      assert.deepEqual(placeholders(text), placeholders(value), key);
      // Short labels may legitimately match (24 h, Limit, Status, Long).
      // Explanatory prose must never be an accidental English fallback.
      if (!['en.json', 'fa.json'].includes(file) && value.length > 16) {
        assert.notEqual(text, value, key);
      }
      if (!['en.json', 'fa.json'].includes(file)) assert.equal(source[key]?.[file.slice(0, -5)], text, key);
    }
  });
}

for (const mode of ['', 'development', 'preview', 'production']) {
  test(`web rollout is fail-closed in ${mode || 'unset'} environment`, () => {
    const out = execFileSync('sh', ['-c', '. ./ci/web-season.env.sh; printf "%s %s %s" "$VITE_ENABLE_DYDX_TPSL" "$VITE_ENABLE_FUTURES_HISTORY" "$VITE_ENABLE_SPOT_DEPTH"'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, VERCEL_ENV: mode, VITE_ENABLE_DYDX_TPSL: 'true', VITE_ENABLE_SPOT_DEPTH: 'true', VITE_ENABLE_FUTURES_HISTORY: 'true' },
      encoding: 'utf8'
    });
    assert.equal(out, `false ${mode === 'production' ? 'true' : 'false'} false`);
  });
}

test('only production web pipeline sources rollout; Android overrides all three', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['build:full'], /\. \.\/ci\/web-season\.env\.sh/);
  assert.doesNotMatch(pkg.scripts.build, /web-season/);
  for (const flag of ['DYDX_TPSL', 'FUTURES_HISTORY', 'SPOT_DEPTH']) {
    assert.match(pkg.scripts['android:sync'], new RegExp(`VITE_ENABLE_${flag}=false`));
  }
  assert.doesNotMatch(pkg.scripts['android:sync'], /web-season/);
  assert.equal(pkg.dependencies['@dydxprotocol/v4-client-js'], '3.4.0');
});

/*
 * The thresholds used to be written down a second time here (1699/1700/1701),
 * and when scripts/check-first-paint.mjs raised the budget 1700 → 1750 on
 * 2026-10-22 nobody came back — so this suite went red and stayed red, which
 * is worse than not having it: a red test hides the next real regression.
 * Read the budget out of the script instead, so the fixture cannot drift.
 */
const BUDGET_KB = Number(/budgetKB:\s*(\d+)/.exec(read('scripts/check-first-paint.mjs'))[1]);
assert.ok(Number.isFinite(BUDGET_KB) && BUDGET_KB > 0, 'the first-paint budget is readable from the guard');

for (const [name, bytes, passes] of [
  ['below budget', (BUDGET_KB - 1) * 1024, true],
  ['exactly at budget', BUDGET_KB * 1024, false],
  ['over budget', (BUDGET_KB + 1) * 1024, false],
  ['missing asset', null, false]
]) {
  test(`first-paint byte guard: ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'season-budget-'));
    try {
      mkdirSync(join(dir, 'dist/assets'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<script src="/assets/app.js"></script>');
      if (bytes !== null) writeFileSync(join(dir, 'dist/assets/app.js'), Buffer.alloc(bytes, 'a'));
      const check = () => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/check-first-paint.mjs', import.meta.url))], { cwd: dir, stdio: 'pipe' });
      if (passes) assert.doesNotThrow(check);
      else assert.throws(check);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

for (const history of [false, true]) {
  test(`Vite-built flag artifact: TP/SL=false, history=${history}, depth=false`, async () => {
    const flags = {
      VITE_ENABLE_DYDX_TPSL: 'false',
      VITE_ENABLE_FUTURES_HISTORY: String(history),
      VITE_ENABLE_SPOT_DEPTH: 'false'
    };
    const previous = Object.fromEntries(Object.keys(flags).map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, flags);
      const result = await build({
        configFile: false, logLevel: 'silent',
        build: {
          write: false,
          lib: { entry: fileURLToPath(new URL('../src/lib/features.js', import.meta.url)), formats: ['es'] }
        }
      });
      const chunk = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output).find((r) => r.type === 'chunk');
      const mod = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
      assert.equal(mod.DYDX_TPSL_ENABLED, false);
      assert.equal(mod.FUTURES_HISTORY_ENABLED, history);
      assert.equal(mod.SPOT_DEPTH_ENABLED, false);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
}
