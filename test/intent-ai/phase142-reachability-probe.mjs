/**
 * PHASE 142 (REVISED 2026-08-31) — THE EXECUTION-CONTROL BOX IS REMOVED,
 * THE STATE MACHINE AND THE RELEASE PATH STAY.
 * ---------------------------------------------------------------------------
 * History this probe guards, so neither regression returns:
 *
 *   · First the pause / emergency-stop / human-agent controls lived on the
 *     Intent OS rail, then they were moved to the AI surface, and once they
 *     were removed without being rebuilt anywhere the gate became unreachable
 *     from every screen while the probes stayed green (they tested the module,
 *     not the screen). The original phase-142 probe made sure that could not
 *     happen again.
 *
 *   · On 2026-08-31 the OWNER asked for the execution-control box on the
 *     Intent AI page (pause / emergency stop / human agent / pause presets)
 *     to be removed entirely. That is now the requirement this probe encodes:
 *
 *       - the box is NOT mounted on any screen and the component file is gone;
 *       - the rail state machine itself (railStore + intentRailControls) stays,
 *         because the Intent OS rail renders its state and the chat gates
 *         still read it — a persisted STOPPED state must keep meaning STOPPED;
 *       - a blocked rail ALWAYS keeps its way back: the release control on the
 *         Intent OS rail (two taps for a stop) is the one remaining operator,
 *         so removing the box must never remove the release.
 */
import { readFileSync, readdirSync } from 'node:fs';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const srcFiles = (function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : (/\\.jsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])
  );
})('src');
const all = srcFiles.map((f) => ({ file: f, src: read(f) }));
/* The library defines the actions; only callers OUTSIDE it could mount them. */
const callers = all.filter((f) => !f.file.includes('/lib/intent-ai/'));

const GATE_ACTIONS = ['pauseExecution', 'engageEmergencyStop', 'requestHumanAgent'];
const RELEASE_ACTIONS = ['releaseEmergencyStop', 'resumeExecution'];

try {
  /* ---------------- 1. the state machine stays ---------------- */
  const store = read('src/lib/intent-ai/railStore.js');
  check('a rail store exists', store.length > 0);
  for (const action of [...GATE_ACTIONS, ...RELEASE_ACTIONS]) {
    check(`the store exposes a wrapper for ${action}`,
      new RegExp(`export const rail\\w+\\s*=\\s*\\(?[^)]*\\)?\\s*=>\\s*commitRail\\(\\s*${action}\\b`).test(store)
      || new RegExp(`commitRail\\(\\s*${action}\\(`).test(store));
  }

  /* ---------------- 2. the box is gone (owner, 2026-08-31) ---- */
  check('the ExecutionControls component file is deleted',
    !srcFiles.some((f) => f.endsWith('/components/ExecutionControls.jsx'))
    && read('src/components/ExecutionControls.jsx') === '');
  check('no screen mounts an execution-controls box',
    !callers.some((f) => /<ExecutionControls/.test(f.src) || /import ExecutionControls/.test(f.src)));
  for (const action of GATE_ACTIONS) {
    check(`no screen calls ${action} (the box was removed on purpose)`,
      !callers.some((f) => f.src.includes(`${action}(`)));
  }

  /* ---------------- 3. the way back is never lost ------------- */
  const rail = read('src/components/IntentRail.jsx');
  check('the Intent OS rail still reads the shared store',
    rail.includes('useSyncExternalStore') && rail.includes('subscribeRail'));
  check('a blocked rail always offers a release on the Intent OS rail',
    /blocked &&[\s\S]{0,400}?intent-rail-release/.test(rail));
  check('releasing a stop still needs two taps',
    /releaseArm/.test(rail));
  check('the store keeps a way back for both pause and stop',
    /railResume\b/.test(store) && /railReleaseStop\b/.test(store));

  /* ---------------- 4. the rail copy is translated ------------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(read(`src/i18n/locales/${l}.json`)));
  check('the Intent OS rail copy exists in en, fa and ar',
    locales.every((l) => typeof l?.intentOS?.rail?.label === 'string'
      && typeof l?.intentOS?.rail?.release === 'string'
      && typeof l?.intentOS?.rail?.stoppedShort === 'string'));
} catch (error) {
  check(`probe crashed: ${error.message}`, false);
}

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'phase142-reachability', passed, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
