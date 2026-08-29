/**
 * PHASES 117–120, 142–144, 148–149 — RAIL CONTROL PLANE
 * Pause, emergency stop, human-agent escalation, autonomy level, collapse and
 * the tamper-safe snapshot. The safety state must fail closed everywhere.
 */
import {
  RAIL_CONTROL_SCHEMA, RAIL_STATES, PAUSE_PRESETS_MS,
  initialRailState, mayExecute, pauseExecution, resumeExecution,
  engageEmergencyStop, releaseEmergencyStop,
  requestHumanAgent, connectHumanAgent, endHumanAgent,
  setAutonomyLevel, toggleRail, snapshot, restore
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;

try {
  /* ---------- initial state ---------- */
  const s0 = initialRailState({ now: NOW });
  check('initial state is running', s0.state === 'running' && s0.emergencyStop === false);
  check('initial state carries the schema', s0.schema === RAIL_CONTROL_SCHEMA);
  check('initial state grants execution', mayExecute(s0, { now: NOW }).allowed === true);
  check('rail states are exactly three', RAIL_STATES.join(',') === 'running,paused,stopped');

  /* ---------- pause ---------- */
  const paused = pauseExecution(s0, { preset: 'h1', now: NOW });
  check('pause engages', paused.ok && paused.state.state === 'paused');
  check('preset h1 resolves to an hour', paused.state.pausedUntil === NOW + PAUSE_PRESETS_MS.h1);
  check('a paused rail blocks execution with a resume time', mayExecute(paused.state, { now: NOW }).reason === 'PAUSED');
  check('an expired pause auto-resumes', mayExecute(paused.state, { now: NOW + PAUSE_PRESETS_MS.h1 + 1 }).autoResumed === true);
  check('a pause in the past is refused', pauseExecution(s0, { until: NOW - 1000, now: NOW }).ok === false);
  check('resume clears the pause', resumeExecution(paused.state, { now: NOW }).state.state === 'running');

  /* ---------- emergency stop ---------- */
  const stopped = engageEmergencyStop(s0, { reason: 'drill', unwind: true, now: NOW });
  check('emergency stop engages fail-closed', stopped.ok && stopped.state.emergencyStop === true && stopped.state.state === 'stopped');
  check('stopped rail blocks execution first', mayExecute(stopped.state, { now: NOW }).reason === 'EMERGENCY_STOP');
  check('a stopped rail refuses pause', pauseExecution(stopped.state, { now: NOW }).ok === false);
  check('a stopped rail refuses resume', resumeExecution(stopped.state, { now: NOW }).ok === false);
  check('unwind is queued as a request, not executed', stopped.state.unwindRequested === true);
  check('release needs an explicit confirmation', releaseEmergencyStop(stopped.state, { now: NOW }).ok === false);
  check('the right confirmation releases', releaseEmergencyStop(stopped.state, { confirmationToken: 'release-confirmed', now: NOW }).ok === true);
  check('releasing a running rail is refused', releaseEmergencyStop(s0, { confirmationToken: 'release-confirmed', now: NOW }).ok === false);

  /* ---------- human agent ---------- */
  const ha = requestHumanAgent(s0, { now: NOW });
  check('human agent request is recorded with a session id', ha.ok && ha.state.humanAgent.requested === true && /^ha-/.test(ha.state.humanAgent.sessionId));
  check('a duplicate request is refused', requestHumanAgent(ha.state, { now: NOW }).ok === false);
  const connected = connectHumanAgent(ha.state, { sessionId: ha.state.humanAgent.sessionId, now: NOW });
  check('connection requires the same session', connected.ok && connected.state.humanAgent.escalation === 'connected');
  check('a mismatched session is refused', connectHumanAgent(ha.state, { sessionId: 'ha-other', now: NOW }).ok === false);
  check('ending the session resets escalation', endHumanAgent(connected.state, { now: NOW }).state.humanAgent.escalation === 'none');

  /* ---------- autonomy on the rail ---------- */
  const l2 = setAutonomyLevel(s0, { level: 2, now: NOW });
  check('autonomy level is shown, not granted', l2.state.autonomy.level === 2 && l2.state.autonomy.nextLevel === 3);
  check('an out-of-range level falls back to one', setAutonomyLevel(s0, { level: 9, now: NOW }).state.autonomy.level === 1);
  check('at max there is no next level', setAutonomyLevel(s0, { level: 3, atMax: true, now: NOW }).state.autonomy.nextLevel === null);

  /* ---------- collapse ---------- */
  const collapsed = toggleRail(s0, { now: NOW });
  check('collapse toggles the layout flag', collapsed.state.railCollapsed === true && toggleRail(collapsed.state, { now: NOW }).state.railCollapsed === false);
  check('a collapsed rail keeps the safety state', pauseExecution(collapsed.state, { preset: 'm5', now: NOW }).state.railCollapsed === true);

  /* ---------- snapshot / restore ---------- */
  const roundtrip = restore(snapshot(stopped.state), { now: NOW });
  check('a snapshot round-trips exactly', roundtrip.degraded === false && roundtrip.state.emergencyStop === true && roundtrip.state.stopReason === 'drill');
  const tampered = restore('{"schema":"fbt.intent-rail-controls.v1","state":"flying","emergencyStop":false}', { now: NOW });
  check('a hand-edited snapshot is treated as tampered', tampered.degraded === true);
  check('tampered data degrades to the SAFEST state', tampered.state.emergencyStop === true && tampered.state.state === 'stopped');
  check('garbage degrades to stopped', restore('not-json', { now: NOW }).state.emergencyStop === true);
  check('a stopped record cannot hide its flag', restore(snapshot({ ...s0, state: 'stopped', emergencyStop: false }), { now: NOW }).state.emergencyStop === true);
  check('a running record with a stop flag is corrected to stopped', restore(snapshot({ ...s0, emergencyStop: true }), { now: NOW }).state.state === 'stopped');
} catch (e) {
  check(`unexpected error: ${e.message}`, false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((r) => r.name).join(' | ')}`);
  process.exitCode = 1;
}
export default results;
