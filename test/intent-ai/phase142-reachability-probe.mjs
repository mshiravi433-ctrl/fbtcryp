/**
 * PHASE 142 (REVISED 2026-08-31, second pass) — NOTHING CAN BLOCK A USER
 * BEHIND A CONTROL THAT NO LONGER EXISTS.
 * ---------------------------------------------------------------------------
 * History this probe guards, so none of it comes back:
 *
 *   · The pause / emergency-stop / human-agent controls lived on the Intent OS
 *     rail, then moved to the AI surface, and once they were removed without
 *     being rebuilt anywhere the gate became UNREACHABLE from every screen
 *     while the probes stayed green — they tested the module, not the screen.
 *     That is the original bug this phase exists for.
 *
 *   · 2026-08-31 (a): the owner removed the execution-control box on the
 *     Intent AI page (pause / emergency stop / human agent / presets).
 *
 *   · 2026-08-31 (b): the owner removed the L1/L2/L3 + state-pill rail box
 *     from the Intent OS page. That rail carried the LAST release control, and
 *     it also carried the gate that could refuse to send. Removing the release
 *     while keeping the gate would have recreated the original bug in its
 *     worst form: a screen that refuses to send with no way back.
 *
 * So the contract is now the mirror image of the old one:
 *
 *   1. no screen mounts a pause / emergency-stop / human-agent control;
 *   2. no screen GATES execution on the rail state either — if there is no
 *      release control on any screen, there must be no lock to release;
 *   3. the deterministic state machine in the library stays (it is still the
 *      audited definition of the states, and its release transitions still
 *      exist), so a future surface can be rebuilt on it honestly;
 *   4. the real gates are untouched: a compiled plan's own checks, the venue
 *      screen and the wallet signature.
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
/* The library defines the actions; only callers OUTSIDE it could mount them. */
const callers = all.filter((f) => !f.file.includes('/lib/intent-ai/'));

const GATE_ACTIONS = ['pauseExecution', 'engageEmergencyStop', 'requestHumanAgent'];
const RELEASE_ACTIONS = ['releaseEmergencyStop', 'resumeExecution'];

try {
  /* ---------------- 1. the state machine stays in the library ---------- */
  const controls = read('src/lib/intent-ai/intentRailControls.js');
  check('the deterministic rail state machine still exists', controls.length > 0);
  for (const action of [...GATE_ACTIONS, ...RELEASE_ACTIONS]) {
    check(`the state machine still defines ${action}`,
      new RegExp(`export function ${action}\\b`).test(controls));
  }
  check('mayExecute still refuses a stopped or indefinitely paused state',
    /export function mayExecute/.test(controls)
    && /EMERGENCY_STOP/.test(controls) && /PAUSED_INDEFINITE/.test(controls));

  const store = read('src/lib/intent-ai/railStore.js');
  check('the shared store keeps a way back for both pause and stop',
    /railResume\b/.test(store) && /railReleaseStop\b/.test(store));

  /* ---------------- 2. no screen mounts the removed controls ----------- */
  check('the ExecutionControls component file is deleted',
    !srcFiles.some((f) => f.endsWith('/components/ExecutionControls.jsx'))
    && read('src/components/ExecutionControls.jsx') === '');
  check('the Intent OS control rail component is deleted',
    !srcFiles.some((f) => f.endsWith('/components/IntentRail.jsx'))
    && read('src/components/IntentRail.jsx') === '');
  check('no screen mounts an execution-controls box',
    !callers.some((f) => /<ExecutionControls/.test(f.src) || /import ExecutionControls/.test(f.src)));
  check('no screen mounts the L1/L2/L3 control rail',
    !callers.some((f) => /<IntentRail/.test(f.src) || /import IntentRail/.test(f.src)));
  for (const action of GATE_ACTIONS) {
    check(`no screen calls ${action} (the controls were removed on purpose)`,
      !callers.some((f) => f.src.includes(`${action}(`)));
  }

  /* ---------------- 3. and no screen locks on that state --------------- */
  const os = read('src/pages/IntentOS.jsx');
  check('the Intent OS page no longer gates sending on the rail state',
    !/railBlocked/.test(os) && !/mayExecute\(/.test(os));
  check('no screen imports the rail store now that no rail is rendered',
    !callers.some((f) => /from '[^']*railStore/.test(f.src)));
  check('no screen renders a rail-blocked banner',
    !callers.some((f) => /ios-rail-blocked/.test(f.src)));

  /* ---------------- 4. the real gates are still there ------------------ */
  check('a compiled plan still refuses to hand off when its own checks block it',
    /if \(!compiled \|\| compiled\.blocked\) return;/.test(os));
  check('the Intent OS page still hands off to a venue screen instead of executing',
    /navigate\(compiled\.handoff\)/.test(os));
} catch (error) {
  check(`probe crashed: ${error.message}`, false);
}

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'phase142-reachability', passed, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
