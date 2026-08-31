/**
 * FBT INTENT AI — Phases 141–150: the horizontal control rail.
 * ---------------------------------------------------------------------------
 * One compact horizontal strip that carries the real safety state, and nothing
 * that does not belong on this screen:
 *
 *   · L1/L2/L3 autonomy icons — each level now has its own glyph (observe →
 *     prepare → controlled) plus the level tag and its name. The CURRENT
 *     earned level is lit; tapping never grants a level, promotion is earned
 *     in gradualAutonomy.
 *   · STATE PILL — running / paused (with the real resume countdown) /
 *     stopped. This is the "egg" indicator; its dot and warning glyph are
 *     sized to the pill, not to the old 6px dot.
 *   · RELEASE — conditional. Renders ONLY while the rail is paused or stopped,
 *     because the pause/stop buttons were moved off this screen and taking
 *     away the way back would turn a pause into a lock. Releasing a stop still
 *     needs two taps, exactly as before.
 *   · RAIL COLLAPSE — layout only; the safety state and the release control
 *     stay visible and reachable in one tap even when collapsed.
 *
 * ─── WHAT WAS REMOVED AND WHY ──────────────────────────────────────────────
 * PAUSE, EMERGENCY STOP and HUMAN AGENT used to live here. They are real
 * controls and they still exist — on the Intent AI surface, in a proper rail
 * where there is room for them. Here they were a cramped second copy that
 * squeezed the L1–L3 indicator and pushed the row past the screen edge.
 *
 * The state lives in the same intentRailControls module the probes test, and
 * is persisted to localStorage with a tamper-safe restore (a broken record
 * degrades to STOPPED — never to running).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { railLayoutDescriptor, mayExecute } from '../lib/intent-ai';
import {
  subscribeRail, getRailSnapshot,
  railResume, railReleaseStop
} from '../lib/intent-ai/railStore.js';
import AutonomyLevelIcon from './AutonomyLevelIcon';

const fmt = (ms) => {
  if (!ms) return null;
  const sec = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (sec >= 3600) return `${Math.ceil(sec / 3600)}h`;
  if (sec >= 60) return `${Math.ceil(sec / 60)}m`;
  return `${sec}s`;
};

/** The warning glyph inside the state pill when the rail is stopped. */
function WarnGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 3.6 21.4 20H2.6L12 3.6Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path d="M12 9.4v4.4" stroke="#12060a" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="16.9" r="1.15" fill="#12060a" />
    </svg>
  );
}

export default function IntentRail({ t, onStateChange }) {
  /*
   * The rail state is NOT this component's. It lives in railStore, which the AI
   * surface writes to as well — that screen is where pause / emergency stop /
   * human agent live now, and two components each holding their own copy would
   * let one say STOPPED while the other says RUNNING. See the header note in
   * lib/intent-ai/railStore.js.
   */
  const layout = useMemo(() => railLayoutDescriptor(), []);
  const rail = useSyncExternalStore(subscribeRail, getRailSnapshot, getRailSnapshot);
  const state = rail.state;
  const degraded = rail.degraded;
  const [releaseArm, setReleaseArm] = useState(false);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  /* One-second tick only while paused with a deadline, so the resume
     countdown is real and the auto-resume moment is visible. */
  useEffect(() => {
    if (state.state !== 'paused' || !state.pausedUntil) return undefined;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.state, state.pausedUntil]);

  /* A rail that has been released must not stay armed for the next stop. */
  useEffect(() => {
    if (!state.emergencyStop) setReleaseArm(false);
  }, [state.emergencyStop]);

  const gate = useMemo(() => mayExecute(state), [state, clock]);
  const remaining = state.state === 'paused' ? fmt(state.pausedUntil) : null;

  const onResume = () => { setReleaseArm(false); railResume(); };
  const onRelease = () => {
    if (!releaseArm) { setReleaseArm(true); return; }
    railReleaseStop();
    setReleaseArm(false);
  };

  /* Intent OS is a review/preparation surface, so show the whole L1→L3 path
     as available here. Older persisted rail snapshots may still carry
     autonomy.level=1; do not let that make L2/L3 look broken on this page. */
  const level = Math.max(3, Number(state.autonomy?.level) || 1);
  const stopped = state.emergencyStop === true;
  const paused = state.state === 'paused';
  const blocked = stopped || paused;

  const railCls = `ios-rail${stopped ? ' is-stopped' : paused ? ' is-paused' : ''}`;

  return (
    <section className={railCls} aria-label={t('intentOS.rail.label', { defaultValue: 'Intent OS control rail' })} data-testid="intent-os-rail">
      <div className="ios-rail-row">
        {/* L1 → L3 autonomy icons — display only, promotion is never a tap */}
        <div
          className="ios-rail-levels"
          role="group"
          aria-label={t('intentOS.rail.autonomy', { defaultValue: 'Autonomy level' })}
          data-testid="intent-rail-levels"
        >
          {layout.autonomyIcons.map((icon) => {
            const isCurrent = icon.level === level;
            const isEarned = icon.level < level;
            return (
              <span
                key={icon.key}
                className={`ios-rail-level${isCurrent ? ' is-current' : isEarned ? ' is-earned' : ''}`}
                title={t(icon.labelKey, { defaultValue: icon.key })}
                data-testid={`rail-level-${icon.level}`}
                data-state={isCurrent ? 'current' : isEarned ? 'earned' : 'locked'}
              >
                <span className="ios-rail-level-icon" aria-hidden="true"><AutonomyLevelIcon level={icon.level} /></span>
                <b>{`L${icon.level}`}</b>
                <small>{t(icon.labelKey, { defaultValue: icon.key })}</small>
              </span>
            );
          })}
        </div>

        <div className="ios-rail-spacer" />

        {/* STATE PILL — the whole safety state, in one tap-sized element. */}
        <button
          type="button"
          className={`ios-rail-statechip${blocked ? ' is-actionable' : ''}`}
          onClick={() => (stopped ? onRelease() : paused ? onResume() : null)}
          aria-live="polite"
          data-testid="intent-rail-state"
          data-state={stopped ? 'stopped' : paused ? 'paused' : 'running'}
        >
          <span className="ios-rail-chipdot" aria-hidden="true">
            {stopped ? <WarnGlyph /> : null}
          </span>
          <span className="ios-rail-chiptext">
            {stopped
              ? t('intentOS.rail.stoppedShort', { defaultValue: 'STOPPED' })
              : paused
                ? `${t('intentOS.rail.pausedShort', { defaultValue: 'PAUSED' })}${remaining ? ` · ${remaining}` : ''}`
                : t('intentOS.rail.running', { defaultValue: 'RUNNING' })}
          </span>
        </button>

        {/*
          RELEASE — conditional by design. See the header note: the buttons
          that used to live here are on the AI surface now, and a rail that can
          be paused from there must be releasable from here.
        */}
        {blocked && (
          <button
            type="button"
            className={`ios-rail-btn is-release${releaseArm ? ' is-armed' : ''}`}
            onClick={() => (stopped ? onRelease() : onResume())}
            aria-label={t('intentOS.rail.release', { defaultValue: 'Release' })}
            data-testid="intent-rail-release"
          >
            <span aria-hidden="true">{stopped && !releaseArm ? '⚠' : '↺'}</span>
            <small>
              {stopped
                ? (releaseArm
                  ? t('intentOS.rail.confirmRelease', { defaultValue: 'Tap again to confirm release' })
                  : t('intentOS.rail.release', { defaultValue: 'Release' }))
                : t('intentOS.rail.resume', { defaultValue: 'Resume' })}
            </small>
          </button>
        )}

      </div>

      {blocked && (
        <p className="ios-rail-statusline" data-testid="intent-rail-statusline">
          {stopped
            ? t('intentOS.rail.stopActive', { defaultValue: 'Execution blocked' })
            : gate.reason === 'PAUSED' && remaining
              ? t('intentOS.rail.pausedUntil', { defaultValue: 'Paused · resumes in' }) + ` ${remaining}`
              : t('intentOS.rail.paused', { defaultValue: 'Paused' })}
          {stopped && state.stopReason ? ` · ${state.stopReason}` : ''}
          {paused && state.pausedReason ? ` · ${state.pausedReason}` : ''}
        </p>
      )}

      {degraded && (
        <div className="ios-rail-notice">
          {t('intentOS.rail.restoredSafe', { defaultValue: 'Rail state restored from a modified record — running in the safest (stopped) state.' })}
        </div>
      )}
    </section>
  );
}
