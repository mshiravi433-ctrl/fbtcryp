/* THE PHASE CPU REPORT — the contract (2026-11-12)
 * ==========================================================================
 *
 * This file locks down what the measurement found, so that a later change
 * cannot quietly undo it:
 *
 *   · the five "provider required" env vars are read by the PROBE ALONE —
 *     a phase must not be dark because a variable nobody reads is unset;
 *   · the three files that import `'../chains'` / `'../swap'` without the
 *     `.js` extension must keep their extension, because Node's ESM
 *     resolver refuses the extensionless form (Vite accepts both, so only
 *     the server breaks, and only at runtime);
 *   · the phase report must be correct from the FIRST call in a process,
 *     not only after a background refresh has run.
 *
 * The first two are static facts about the repository and are checked
 * statically. The third is a runtime fact and is checked at runtime.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';

/* ── 1. the provider env vars must not be the only thing standing between
        a phase and "live" ─────────────────────────────────────────────────── */
test('the provider-required env vars are read by the probe alone', async () => {
  const files = [
    'server/intentPhaseRuntimeProbe.js',
    'server/intentPhaseRuntimeProbeCache.js',
    'server/intentPhaseStatus.js'
  ];
  const VARS = [
    'INTENT_VENUE_PROVIDERS',
    'INTENT_WALLET_PROVIDER',
    'INTENT_EXECUTION_FEED',
    'INTENT_BRIDGE_PROVIDERS',
    'INTENT_BROKER_PROVIDERS'
  ];

  const probeOnly = new Set(['server/intentPhaseRuntimeProbe.js']);

  /* Every file in the repository that mentions one of these variables. */
  const { execFileSync } = await import('node:child_process');
  let out = '';
  try {
    out = execFileSync('grep', [
      '-rl', '--include=*.js', '--include=*.mjs', '--include=*.jsx',
      ...VARS.map((v) => `-e=${v}`),
      'server', 'src', 'scripts'
    ], { encoding: 'utf8', cwd: process.cwd() }).trim();
  } catch (err) {
    /* grep exits 1 when nothing matches — that is a PASS for this test. */
    out = String(err.stdout || '').trim();
  }

  const hits = out ? out.split('\n').filter(Boolean) : [];
  for (const file of hits) {
    if (probeOnly.has(file)) continue;
    /* A file may MENTION the name in a comment — that is fine. What it may
       not do is READ it, because reading it would mean the variable has a
       real effect and the "administrative blocker" story would be wrong. */
    const text = readFileSync(file, 'utf8');
    for (const v of VARS) {
      const reads = new RegExp(`process\\.env\\.${v}|env\\[['"]${v}['"]\\]|\\b${v}\\b\\s*[,)]`).test(text);
      assert.equal(
        reads, false,
        `${file} reads ${v}; the blocker must not depend on a variable the runtime actually reads`
      );
    }
  }
});

/* ── 2. the three import paths must keep their extension ───────────────── */
test('the modules a phase would load carry an explicit .js extension', async () => {
  /*
   * The trap this guards is not "the file is broken today" — it is that the
   * file is broken the MOMENT somebody tries to switch the phase on.
   *
   * These three modules import `'../chains'` and `'../swap'` without the
   * `.js` extension. Vite resolves them (so the browser build is fine) and
   * Node's ESM resolver does not (so the SERVER fails, at runtime, only
   * when the module is first imported). Today they are not on the boot
   * path, so nothing pays for them; the moment phase 216 is wired up, the
   * import explodes.
   *
   * So the check is on the modules a PHASE OWNS, not on the whole tree:
   * 183 extensionless imports exist in `src/`, and every one of them is a
   * FRONTEND file that only Vite ever loads. The server tree has zero.
   */
  const files = [
    'src/lib/defi/compoundV3Base.js',
    'src/lib/defi/compoundV3Lending.js',
    'src/lib/defi/morphoBlueBase.js'
  ];
  for (const file of files) {
    assert.ok(existsSync(file), `${file} must exist`);
    const text = readFileSync(file, 'utf8');
    const bad = [...text.matchAll(/from\s+['"](\.\.?\/[^'"]*?)['"]/g)]
      .map((m) => m[1])
      /* An extensionless relative import: Node's ESM resolver refuses it. */
      .filter((p) => !/\.(m?js|jsx|json|css)$/.test(p) && !p.endsWith('/'));
    /*
     * These files carried extensionless imports until 2026-11-12, and the
     * known set is now EMPTY.
     *
     * It was a real defect (§4.1 of docs/PHASE-CPU-AND-DARK-PHASES.md):
     * phase 216 could not load on the server, and it broke the MOMENT
     * somebody wired it up. The set is kept as an explicit constant rather
     * than deleted, so that a NEW extensionless import is still caught —
     * the check must not be able to grow.
     */
    const KNOWN = {
      'src/lib/defi/compoundV3Base.js': [],
      'src/lib/defi/compoundV3Lending.js': [],
      'src/lib/defi/morphoBlueBase.js': []
    };
    assert.deepEqual(
      bad.slice().sort(),
      (KNOWN[file] || []).slice().sort(),
      `${file} changed its extensionless imports — a new one is a new latent server break, and a removed one should be recorded here`
    );
  }
});

test('the modules a phase owns now LOAD on the server', async () => {
  /*
   * The point of fixing the extensions was not tidiness: it was that a
   * phase which claims to be implemented but whose module will not import
   * is a phase that breaks the MOMENT somebody wires it up.
   *
   * Phase 216 (lending adapters) owned three modules that Node could not
   * resolve. They are not on the boot path today, so nothing paid for
   * them — which is exactly why the defect survived. This test loads
   * them, so the defect cannot come back unnoticed.
   */
  const files = [
    'src/lib/defi/compoundV3Base.js',
    'src/lib/defi/compoundV3Lending.js',
    'src/lib/defi/morphoBlueBase.js'
  ];
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  for (const file of files) {
    const mod = await import(`${root}${file}`);
    assert.ok(
      Object.keys(mod).length > 0,
      `${file} must load AND expose an API — an empty module is not a capability`
    );
  }
});

test('the server tree has NO extensionless relative import', async () => {
  /*
   * The server tree is the one Node loads directly. A single extensionless
   * import in it is a module that fails the moment it is imported — and on
   * a serverless platform "the moment it is imported" is "the moment a
   * user hits the route", not "the moment CI runs".
   */
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('grep', [
    '-rn', '--include=*.js', '--include=*.mjs',
    '-E', "from +['\"]\\.\\.?/[^'\"]*['\"]",
    'server'
  ], { encoding: 'utf8', cwd: process.cwd() }).trim();

  const offenders = [];
  for (const line of out ? out.split('\n').filter(Boolean) : []) {
    const match = line.match(/from\s+['"](\.\.?\/[^'"]*?)['"]/);
    if (!match) continue;
    const spec = match[1];
    if (/\.(m?js|jsx|json|css)$/.test(spec)) continue;
    if (spec.endsWith('/')) continue;
    offenders.push(`${line.split(':')[0]} -> ${spec}`);
  }
  assert.deepEqual(offenders, [], 'the server tree must not carry an extensionless import');
});

/* ── 3. the report must be right from the first call ────────────────────── */
test('the phase report is correct immediately after boot, not only after a refresh', async () => {
  const { phaseStatusReport } = await import('../../server/intentPhaseStatus.js');
  const { refreshProductArcProbe } = await import('../../server/intentPhaseRuntimeProbeCache.js');

  const before = phaseStatusReport();
  const notCompletedBefore = before.phases.filter((p) =>
    (p.blockers || []).includes('RUNTIME_PROBE_NOT_COMPLETED')).length;

  await refreshProductArcProbe({ now: Date.now() });
  const after = phaseStatusReport();
  const notCompletedAfter = after.phases.filter((p) =>
    (p.blockers || []).includes('RUNTIME_PROBE_NOT_COMPLETED')).length;

  assert.equal(
    notCompletedAfter, 0,
    'after the probe runs, no phase may still claim the probe has not completed'
  );
  assert.ok(
    after.operationalPhaseCount > before.operationalPhaseCount,
    'the refreshed report must know about more live phases than the cold one'
  );
});

/* ── 4. the boot warm-up ───────────────────────────────────────────────── */
test('the server warms the phase probe during boot, so the FIRST report is right', async () => {
  /*
   * The race this closes: `phaseStatusReport()` is synchronous and the
   * probe is asynchronous, so on a COLD process — which is every Vercel
   * invocation — the report used to be computed from an empty cache. It
   * published 41 live phases out of 206 and 165 phases claiming
   * `RUNTIME_PROBE_NOT_COMPLETED`, when the honest number is higher.
   *
   * The fix warms the probe once during boot. This test boots the REAL
   * server and asks for the report with NO explicit refresh, which is
   * exactly what a cold invocation does.
   */
  await import('../../server/app.js');
  /* Give the boot warm-up the microtask turns it needs. */
  await new Promise((resolve) => setTimeout(resolve, 250));

  const { phaseStatusReport } = await import('../../server/intentPhaseStatus.js');
  const report = phaseStatusReport();

  const notCompleted = report.phases.filter((p) =>
    (p.blockers || []).includes('RUNTIME_PROBE_NOT_COMPLETED'));
  assert.equal(
    notCompleted.length, 0,
    'a cold process must not publish phases as "probe not completed" — the boot warm-up exists for exactly this'
  );
});

/* ── 5. the probe MEASURES the provider, it does not read a made-up var ─── */
test('a phase with a loadable provider module is live without any override', async () => {
  /*
   * The old rule was: the phase is dark unless an env var nobody reads is
   * set. The new rule is: the phase is live when its own module loads and
   * exposes an API.
   *
   * The override still works — an operator may declare a provider present
   * — but it is no longer the ONLY way to be live, so it can no longer be
   * the reason a working phase is dark.
   */
  const { probeProductArcPhases } = await import('../../server/intentPhaseRuntimeProbe.js');
  const before = {
    venue: process.env.INTENT_VENUE_PROVIDERS,
    wallet: process.env.INTENT_WALLET_PROVIDER,
    feed: process.env.INTENT_EXECUTION_FEED
  };
  delete process.env.INTENT_VENUE_PROVIDERS;
  delete process.env.INTENT_WALLET_PROVIDER;
  delete process.env.INTENT_EXECUTION_FEED;
  try {
    const result = await probeProductArcPhases({ now: Date.now() });
    const venuePhases = result.phases.filter((p) => p.phase >= 101 && p.phase <= 116);
    assert.ok(venuePhases.length > 0, 'the multi-venue phases must be probed');
    const dark = venuePhases.filter((p) => !p.live);
    assert.deepEqual(
      dark.map((p) => `${p.phase}:${(p.blockers || []).join('|')}`),
      [],
      'the multi-venue phases load and serve; no override may be needed to make them live'
    );
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
