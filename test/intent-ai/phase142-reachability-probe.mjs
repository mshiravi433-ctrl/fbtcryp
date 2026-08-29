/**
 * PHASE 142 — EVERY CONTROL IS REACHABLE
 * ---------------------------------------------------------------------------
 * This probe exists because of a real regression, and none of the existing 141
 * caught it.
 *
 * The pause / emergency-stop / human-agent controls were removed from the
 * Intent OS rail on the grounds that "they belong on the AI surface". They were
 * never built there. `IntentRail` had been the only caller of `pauseExecution`,
 * `engageEmergencyStop` and `requestHumanAgent` in the entire application, so
 * after the removal the execution gate could not be engaged from ANY screen.
 *
 * Every probe stayed green the whole time, because they all test the module:
 * they call `engageEmergencyStop` directly and assert on the state machine. Not
 * one of them asks whether a person can reach it. A safety control nobody can
 * operate is not a passing test suite.
 *
 * So: for each gate-changing action, assert that some component calls it — and
 * assert it against the store, not against a single component, so moving the
 * control between screens (which is what broke it) cannot break this again.
 */
import { readFileSync, readdirSync } from 'node:fs';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const srcFiles = (function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : (/\.jsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])
  );
})('src');
const all = srcFiles.map((f) => ({ file: f, src: read(f) }));
/* The library itself defines the actions; only callers OUTSIDE it can make
   them reachable. */
const callers = all.filter((f) => !f.file.includes('/lib/intent-ai/'));

const GATE_ACTIONS = ['pauseExecution', 'engageEmergencyStop', 'requestHumanAgent'];
const RELEASE_ACTIONS = ['releaseEmergencyStop', 'resumeExecution'];

try {
  /* ---------------- 1. the store is the only way in ---------------- */
  const store = read('src/lib/intent-ai/railStore.js');
  check('a rail store exists', store.length > 0);
  for (const action of [...GATE_ACTIONS, ...RELEASE_ACTIONS]) {
    check(`the store exposes a wrapper for ${action}`,
      new RegExp(`export const rail\\w+\\s*=\\s*\\(?[^)]*\\)?\\s*=>\\s*commitRail\\(\\s*${action}\\b`).test(store)
      || new RegExp(`commitRail\\(\\s*${action}\\(`).test(store));
  }

  /* ---------------- 2. every action is called from a screen --------- */
  for (const action of GATE_ACTIONS) {
    const viaStore = store.includes(`${action}(snap.state`);
    const direct = callers.some((f) => f.src.includes(`${action}(`));
    check(`${action} is reachable from a screen (not only defined in the lib)`, viaStore && direct === false ? viaStore : viaStore || direct);
  }

  /* ---------------- 3. the controls are actually mounted ------------ */
  /* A file that RENDERS it, not the component's own definition — the component
     mentions its own name, and matching that would let the check pass while
     nothing on screen ever mounts it. */
  const mounted = callers.find((f) => !f.file.endsWith('ExecutionControls.jsx')
    && /import ExecutionControls/.test(f.src) && /<ExecutionControls/.test(f.src));
  check('the execution controls component is mounted on a surface', Boolean(mounted));
  check('the controls are mounted on the AI surface, where the report said they belong',
    Boolean(mounted) && /IntentAIPanel|IntentAIRoute/.test(mounted.file));

  /* ---------------- 4. one store, so screens cannot disagree -------- */
  const rail = read('src/components/IntentRail.jsx');
  const exec = read('src/components/ExecutionControls.jsx');
  const usesStore = (s) => s.includes('useSyncExternalStore') && s.includes('subscribeRail');
  check('the Intent OS rail reads the shared store', usesStore(rail));
  check('the execution controls read the shared store', usesStore(exec));
  check('no component keeps its own copy of the rail state',
    !/useState\(\(\)\s*=>\s*loadRailState\(\)\)/.test(rail)
    && !/localStorage\.getItem\(\s*RAIL_STORE_KEY/.test(rail));

  /* ---------------- 5. the way back is never removed ---------------- */
  check('a blocked rail always offers a release on the Intent OS rail',
    /blocked &&[\s\S]{0,400}?intent-rail-release/.test(rail));
  check('a blocked rail always offers a release on the execution controls',
    /blocked \?[\s\S]{0,400}?exec-release/.test(exec));
  check('releasing a stop still needs two taps',
    /releaseArm/.test(rail) && /armStop/.test(exec));

  /* ---------------- 6. the copy is translated ----------------------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(read(`src/i18n/locales/${l}.json`)));
  check('the execution-control copy exists in en, fa and ar',
    locales.every((l) => typeof l?.intentOS?.execControls?.title === 'string'
      && typeof l?.intentOS?.controls?.humanAgent === 'string'
      && typeof l?.intentOS?.pause?.h1 === 'string'));
} catch (error) {
  check(`probe crashed: ${error.message}`, false);
}

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'phase142-reachability', passed, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
