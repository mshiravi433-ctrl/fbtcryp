/**
 * FBT INTENT AI — Phases 141–150: the horizontal control rail.
 * ---------------------------------------------------------------------------
 * One compact horizontal strip that carries the real safety state:
 *
 *   · L1/L2/L3 autonomy icons — the CURRENT earned level is lit; tapping a
 *     higher level never grants it (promotion is earned in gradualAutonomy)
 *   · PAUSE — expandable: presets (5m/1h/1d) + reason; while paused the rail
 *     shows the resume time and the compose screen stops emitting
 *   · EMERGENCY STOP — expandable: reason + optional unwind request; release
 *     requires an explicit confirmation (a stop is instant, an undo is not)
 *   · HUMAN AGENT — one tap to request escalation; state moves
 *     none → requested → connected with timestamps
 *   · RAIL COLLAPSE — layout only; the safety state and the stop button
 *     stay visible and reachable in one tap even when collapsed
 *
 * The state lives in the same intentRailControls module the probes test, and
 * is persisted to localStorage with a tamper-safe restore (a broken record
 * degrades to STOPPED — never to running).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initialRailState, mayExecute, pauseExecution, resumeExecution,
  engageEmergencyStop, releaseEmergencyStop, requestHumanAgent,
  connectHumanAgent, endHumanAgent, setAutonomyLevel, toggleRail,
  restore, snapshot, railLayoutDescriptor, PAUSE_PRESETS_MS
} from '../lib/intent-ai';

const RAIL_STORE_KEY = 'fbt-intent-rail-v1';

function loadRailState() {
  try {
    const raw = localStorage.getItem(RAIL_STORE_KEY);
    if (!raw) return { state: initialRailState(), degraded: false };
    return restore(raw);
  } catch {
    return { state: initialRailState(), degraded: false };
  }
}

function persistRailState(state) {
  try { localStorage.setItem(RAIL_STORE_KEY, snapshot(state)); } catch { /* storage full/blocked */ }
}

const fmt = (ms) => {
  if (!ms) return null;
  const sec = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (sec >= 3600) return `${Math.ceil(sec / 3600)}h`;
  if (sec >= 60) return `${Math.ceil(sec / 60)}m`;
  return `${sec}s`;
};

export default function IntentRail({ t, onStateChange }) {
  const layout = useMemo(() => railLayoutDescriptor(), []);
  const boot = useRef(loadRailState());
  const [state, setState] = useState(() => boot.current.state);
  const [degraded, setDegraded] = useState(() => boot.current.degraded);
  const [expanded, setExpanded] = useState(null); // null | 'pause' | 'stop'
  const [pauseReason, setPauseReason] = useState('');
  const [stopReason, setStopReason] = useState('');
  const [unwind, setUnwind] = useState(false);
  const [releaseArm, setReleaseArm] = useState(false);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    onStateChange?.(state);
    persistRailState(state);
  }, [state, onStateChange]);

  /* One-second tick only while paused with a deadline, so the resume
     countdown is real and the auto-resume moment is visible. */
  useEffect(() => {
    if (state.state !== 'paused' || !state.pausedUntil) return undefined;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.state, state.pausedUntil]);

  const gate = useMemo(() => mayExecute(state), [state, clock]);
  const remaining = state.state === 'paused' ? fmt(state.pausedUntil) : null;

  const apply = (next) => {
    if (next?.ok) { setState(next.state); setExpanded(null); setReleaseArm(false); }
    return next;
  };

  const onPause = (preset) => {
    apply(pauseExecution(state, { preset, reason: pauseReason.trim() || null }));
  };
  const onResume = () => apply(resumeExecution(state));
  const onStop = () => {
    setUnwind(false);
    apply(engageEmergencyStop(state, { reason: stopReason.trim() || null, unwind }));
  };
  const onRelease = () => {
    if (!releaseArm) { setReleaseArm(true); return; }
    const released = apply(releaseEmergencyStop(state, { confirmationToken: 'release-confirmed' }));
    if (released?.ok) setStopReason('');
  };
  const onHumanAgent = () => {
    const result = state.humanAgent?.requested
      ? { ok: true, state: endHumanAgent(state).state }
      : requestHumanAgent(state);
    if (result?.ok) setState(result.state);
  };

  const level = state.autonomy?.level ?? 1;
  const railCls = `ios-rail${state.railCollapsed ? ' is-collapsed' : ''}${state.emergencyStop ? ' is-stopped' : state.state === 'paused' ? ' is-paused' : ''}`;

  return (
    <section className={railCls} aria-label={t('intentOS.rail.label', { defaultValue: 'Intent OS control rail' })} data-testid="intent-os-rail">
      <div className="ios-rail-row">
        {/* L1 → L3 autonomy icons — display only, promotion is never a tap */}
        <div className="ios-rail-levels" role="group" aria-label={t('intentOS.rail.autonomy', { defaultValue: 'Autonomy level' })}>
          {layout.autonomyIcons.map((icon) => (
            <span
              key={icon.key}
              className={`ios-rail-level${icon.level === level ? ' is-current' : icon.level < level ? ' is-earned' : ''}`}
              title={t(icon.labelKey, { defaultValue: icon.key })}
            >
              <b>{`L${icon.level}`}</b>
              <small>{t(icon.labelKey, { defaultValue: icon.key })}</small>
            </span>
          ))}
        </div>

        <div className="ios-rail-spacer" />

        {/* PAUSE — expandable */}
        <div className={`ios-rail-action${expanded === 'pause' ? ' is-expanded' : ''}`}>
          <button
            type="button"
            className={`ios-rail-btn${state.state === 'paused' ? ' is-on' : ''}`}
            onClick={() => (state.state === 'paused' ? onResume() : setExpanded(expanded === 'pause' ? null : 'pause'))}
            aria-expanded={expanded === 'pause'}
            aria-label={t('intentOS.controls.pause', { defaultValue: 'Pause' })}
          >
            <span aria-hidden="true">{state.state === 'paused' ? '▶' : '⏸'}</span>
            {!state.railCollapsed && <small>{state.state === 'paused' ? t('intentOS.rail.resume', { defaultValue: 'Resume' }) : t('intentOS.controls.pause', { defaultValue: 'Pause' })}</small>}
          </button>
          {expanded === 'pause' && state.state !== 'paused' && (
            <div className="ios-rail-drawer">
              <div className="ios-rail-presets">
                {[['m5', '5m'], ['h1', '1h'], ['d1', '1d']].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => onPause(key)}>{label}</button>
                ))}
              </div>
              <input
                value={pauseReason}
                onChange={(event) => setPauseReason(event.target.value)}
                placeholder={t('intentOS.rail.pauseReason', { defaultValue: 'Reason (optional)' })}
                maxLength={120}
              />
              <button type="button" className="ios-rail-apply" onClick={() => onPause('h1')}>
                {t('intentOS.rail.applyPause', { defaultValue: 'Pause for 1 hour' })}
              </button>
            </div>
          )}
          {state.state === 'paused' && (
            <div className="ios-rail-statusline">
              {gate.reason === 'PAUSED' && remaining
                ? t('intentOS.rail.pausedUntil', { defaultValue: 'Paused · resumes in' }) + ` ${remaining}`
                : t('intentOS.rail.paused', { defaultValue: 'Paused' })}
              {state.pausedReason ? ` · ${state.pausedReason}` : ''}
            </div>
          )}
        </div>

        {/* EMERGENCY STOP — expandable, fail-closed */}
        <div className={`ios-rail-action${expanded === 'stop' ? ' is-expanded' : ''}`}>
          <button
            type="button"
            className={`ios-rail-btn is-stop${state.emergencyStop ? ' is-on' : ''}`}
            onClick={() => (state.emergencyStop ? onRelease() : setExpanded(expanded === 'stop' ? null : 'stop'))}
            aria-expanded={expanded === 'stop'}
            aria-label={t('intentOS.controls.emergency_exit', { defaultValue: 'Emergency stop' })}
          >
            <span aria-hidden="true">■</span>
            {!state.railCollapsed && <small>{state.emergencyStop
              ? (releaseArm ? t('intentOS.rail.confirmRelease', { defaultValue: 'Tap again to confirm release' }) : t('intentOS.rail.stopped', { defaultValue: 'STOPPED' }))
              : t('intentOS.controls.emergency_exit', { defaultValue: 'Stop' })}</small>}
          </button>
          {expanded === 'stop' && !state.emergencyStop && (
            <div className="ios-rail-drawer">
              <input
                value={stopReason}
                onChange={(event) => setStopReason(event.target.value)}
                placeholder={t('intentOS.rail.stopReason', { defaultValue: 'Reason (optional)' })}
                maxLength={120}
              />
              <label className="ios-rail-unwind">
                <input type="checkbox" checked={unwind} onChange={(event) => setUnwind(event.target.checked)} />
                {t('intentOS.rail.requestUnwind', { defaultValue: 'Request unwind of open positions' })}
              </label>
              <button type="button" className="ios-rail-apply is-stop" onClick={onStop}>
                {t('intentOS.rail.applyStop', { defaultValue: 'EMERGENCY STOP' })}
              </button>
            </div>
          )}
          {state.emergencyStop && (
            <div className="ios-rail-statusline">
              {t('intentOS.rail.stopActive', { defaultValue: 'Execution blocked' })}
              {state.stopReason ? ` · ${state.stopReason}` : ''}
              {state.unwindRequested ? ' · ⤺ unwind requested' : ''}
            </div>
          )}
        </div>

        {/* HUMAN AGENT */}
        <div className="ios-rail-action">
          <button
            type="button"
            className={`ios-rail-btn is-human${state.humanAgent?.requested ? ' is-on' : ''}`}
            onClick={onHumanAgent}
            aria-pressed={state.humanAgent?.requested === true}
            aria-label={t('intentOS.controls.humanAgent', { defaultValue: 'Human agent' })}
          >
            <span aria-hidden="true">{state.humanAgent?.escalation === 'connected' ? '🧑‍💼' : '👤'}</span>
            {!state.railCollapsed && <small>{state.humanAgent?.escalation === 'connected'
              ? t('intentOS.rail.agentConnected', { defaultValue: 'Agent connected' })
              : state.humanAgent?.requested
                ? t('intentOS.rail.agentRequested', { defaultValue: 'Requested…' })
                : t('intentOS.controls.humanAgent', { defaultValue: 'Human agent' })}</small>}
          </button>
        </div>

        {/* RAIL COLLAPSE — layout only */}
        <button
          type="button"
          className="ios-rail-btn is-collapse"
          onClick={() => setState(toggleRail(state).state)}
          aria-expanded={!state.railCollapsed}
          aria-label={t('intentOS.controls.railCollapse', { defaultValue: 'Collapse rail' })}
        >
          <span aria-hidden="true">{state.railCollapsed ? '‹' : '›'}</span>
        </button>
      </div>

      {degraded && (
        <div className="ios-rail-notice">
          {t('intentOS.rail.restoredSafe', { defaultValue: 'Rail state restored from a modified record — running in the safest (stopped) state.' })}
        </div>
      )}

      <button
        type="button"
        className="ios-rail-statechip"
        onClick={() => (state.emergencyStop ? onRelease() : state.state === 'paused' ? onResume() : null)}
        aria-live="polite"
      >
        <span className={`ios-rail-chipdot${state.emergencyStop ? ' stop' : state.state === 'paused' ? ' pause' : ''}`} aria-hidden="true" />
        {state.emergencyStop
          ? t('intentOS.rail.stoppedShort', { defaultValue: 'STOPPED' })
          : state.state === 'paused'
            ? `${t('intentOS.rail.pausedShort', { defaultValue: 'PAUSED' })}${remaining ? ` · ${remaining}` : ''}`
            : t('intentOS.rail.running', { defaultValue: 'RUNNING' })}
      </button>
    </section>
  );
}
