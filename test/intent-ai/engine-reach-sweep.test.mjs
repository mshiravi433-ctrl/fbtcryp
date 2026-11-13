/*
 * EVERY ENGINE, OVER ITS OWN ROUTE
 * ---------------------------------------------------------------------------
 *
 * `scripts/probe-engine-reach.mjs` asks the brain a sentence for every
 * INTENT. `scripts/probe-engine-sweep.mjs` asks the FIOs ROUTER the call
 * each engine's own page makes, for every ENGINE FILE.
 *
 * This test is the sweep, as a gate. The sweep found:
 *
 *   · a route comparison question classified as an instruction to move the
 *     money (a naming mistake between a MODULE and a STATE SECTION);
 *   · an owner with no debt section had NO capital, so seven engines
 *     across five files reasoned about nothing.
 *
 * Both were invisible to the surface tests, because a surface test asks
 * an engine directly and a direct call proves the engine. Only a call
 * over the engine's OWN route proves the engine is REACHED.
 *
 * So the guarantee is pinned here: every engine that IS an engine must
 * answer over its own route, and no engine may be dark.
 *
 * The sweep runs ONCE — it takes minutes, because it makes a real call per
 * engine, and calling it twice would only make the gate slower without
 * making it stricter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIO_DIR = path.join(ROOT, 'server', 'fios');

/* The flag registry and the envelope module answer nobody: every engine
   asks them, and they are used BY the engines. */
const NOT_AN_ENGINE = new Set(['flags', 'provenance']);

/* The composition root and the router are the WIRES, not the engines
   behind them. */
const NOT_AN_ENGINE_ALSO = new Set(['index', 'router']);

const isEngine = (name) => !NOT_AN_ENGINE.has(name) && !NOT_AN_ENGINE_ALSO.has(name);

test('every engine in server/fios is on the disk and accounted for', () => {
  const files = fs
    .readdirSync(FIO_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''));
  assert.ok(files.length >= 45, `expected the engine library to be real, found ${files.length} files`);
});

test('no engine in server/fios is dark — every one answers over its own route', () => {
  /* The sweep is the source of truth, and it is a script because it is
     also a diagnostic an operator can run. Running it here means the gate
     is the sweep, not a copy of it that can drift. */
  const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'probe-engine-sweep.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 32 * 1024 * 1024
  });
  assert.equal(out.status, 0, `the sweep failed:\n${out.stderr?.slice(0, 600)}`);

  let parsed;
  try {
    parsed = JSON.parse(out.stdout);
  } catch {
    assert.fail(`the sweep did not print JSON:\n${out.stdout?.slice(0, 600)}`);
  }

  const { results, summary } = parsed;

  const dark = results.filter((r) => !r.reached && isEngine(r.engine));
  assert.equal(
    dark.length,
    0,
    `these engines are mounted, routed, and answering nobody:\n${dark.map((r) => `  · ${r.engine} — ${r.detail}`).join('\n')}`
  );

  const noRoute = results.filter((r) => (!r.route || r.route === '—') && isEngine(r.engine));
  assert.equal(
    noRoute.length,
    0,
    `these engines have no caller at all:\n${noRoute.map((r) => `  · ${r.engine}`).join('\n')}`
  );

  assert.ok(summary.reached >= 45, `only ${summary.reached} engines answered`);
  assert.equal(summary.notReached, 0);

  /* The two files that are not engines are named, so the gate does not cry
     wolf over them. */
  const helpers = results.filter((r) => NOT_AN_ENGINE.has(r.engine)).map((r) => r.engine).sort();
  assert.deepEqual(helpers, ['flags', 'provenance'], 'the flag registry and the envelope module are not engines');
});
