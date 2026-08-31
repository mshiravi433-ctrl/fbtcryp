/**
 * EXECUTION CONTROLS — pause, emergency stop, human agent, release.
 * ---------------------------------------------------------------------------
 * WHY THIS COMPONENT EXISTS
 *
 * These three controls used to sit on the Intent OS rail. They were moved off
 * it because that screen is a control surface for *what the agent should do*,
 * and a second, cramped copy of the safety controls was crowding out the
 * autonomy indicator the page exists to show.
 *
 * The move was made without checking where they would land — and the answer was
 * nowhere. `IntentRail` had been the only caller of `pauseExecution`,
 * `engageEmergencyStop` and `requestHumanAgent` in the entire app, so the gate
 * became unreachable from every screen while all 141 probes stayed green (they
 * exercise the module, not the screen that calls it). A safety control nobody
 * can reach is worse than a cluttered rail.
 *
 * So they live here, on the AI surface where they belong, in one rail that
 * scrolls instead of wrapping — and they read and write the SAME store the
 * Intent OS rail shows, so the two screens can never disagree about whether
 * execution is blocked.
 *
 * WHAT EACH ONE DOES, HONESTLY
 *   · PAUSE stops execution for a fixed preset and shows the real resume time.
 *   · EMERGENCY STOP blocks execution until it is released, and the release
 *     needs two taps (`release-confirmed` is required by the module itself, so
 *     a stray tap cannot lift it).
 *   · HUMAN AGENT escalates; it does not grant anything.
 *   · RELEASE appears only while paused or stopped — the way back is never
 *     more than one tap from the control that put the gate there.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import ScrollRail from './ScrollRail';
import {
  subscribeRail, getRailSnapshot,
  railPause, railResume, railEngageStop, railReleaseStop, railRequestHuman
} from '../lib/intent-ai/railStore.js';

const PAUSE_PRESETS = [
  { id: 'm5', key: 'intentOS.pause.m5' },
  { id: 'h1', key: 'intentOS.pause.h1' },
  { id: 'd1', key: 'intentOS.pause.d1' }
];

const fmtRemaining = (ms) => {
  if (!ms) return null;
  const sec = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (sec >= 3600) return `${Math.ceil(sec / 3600)}h`;
  if (sec >= 60) return `${Math.ceil(sec / 60)}m`;
  return `${sec}s`;
};

export default function ExecutionControls({ compact = false }) {
  const { t } = useTranslation();
  const rail = useSyncExternalStore(subscribeRail, getRailSnapshot, getRailSnapshot);
  const state = rail.state;
  const [preset, setPreset] = useState('h1');
  const [armStop, setArmStop] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [lastRefusal, setLastRefusal] = useState(null);

  const stopped = state.emergencyStop === true;
  const paused = state.state === 'paused';
  const blocked = stopped || paused;

  /* Tick only while a countdown is on screen, so the resume time is real. */
  useEffect(() => {
    if (!paused || !state.pausedUntil) return undefined;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused, state.pausedUntil]);

  /* A lifted stop must not stay armed for the next one. */
  useEffect(() => { if (!stopped) setArmStop(false); }, [stopped]);

  const remaining = useMemo(
    () => (paused ? fmtRemaining(state.pausedUntil) : null),
    [paused, state.pausedUntil, clock]
  );

  /* Every refusal is shown, never swallowed: a control that silently does
     nothing is the exact complaint this whole pass started with. */
  const run = (fn) => {
    const result = fn();
    setLastRefusal(result?.ok === false ? result.code || 'REFUSED' : null);
    return result;
  };

  return (
    <div className="exec-controls" data-testid="execution-controls" style="border: 1px solid #e0e0e0; border-radius: 8; padding: 12; background: rgba(255,255,255,0.03); margin-bottom: 16;">
      <div className="exec-controls-head">
        <span className="faint">
          {t('intentOS.execControls.title', { defaultValue: 'Execution controls' })}
        </span>
        <span
          className={`exec-state${blocked ? ' is-blocked' : ''}`}
          data-testid="execution-state"
          data-state={stopped ? 'stopped' : paused ? 'paused' : 'running'}
        >
          {stopped
            ? t('intentOS.rail.stoppedShort', { defaultValue: 'STOPPED' })
            : paused
              ? `${t('intentOS.rail.pausedShort', { defaultValue: 'PAUSED' })}${remaining ? ` · ${remaining}` : ''}`
              : t('intentOS.rail.running', { defaultValue: 'RUNNING' })}
        </span>
      </div>

      <ScrollRail
        className="exec-rail"
        ariaLabel={t('intentOS.execControls.rail', { defaultValue: 'Execution controls' })}
      >
        {blocked ? (
          <button
            type="button"
            className="exec-btn is-release"
            onClick={() => run(stopped ? railReleaseStop : railResume)}
            data-testid="exec-release"
          >
            <span aria-hidden="true">↺</span>
            {stopped
              ? t('intentOS.rail.release', { defaultValue: 'Release' })
              : t('intentOS.rail.resume', { defaultValue: 'Resume' })}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="exec-btn is-pause"
              onClick={() => run(() => railPause(preset, null))}
              data-testid="exec-pause"
            >
              <span aria-hidden="true">⏸</span>
              {t('intentAI.controls.pause', { defaultValue: 'Pause' })}
            </button>
            <button
              type="button"
              className={`exec-btn is-stop${armStop ? ' is-armed' : ''}`}
              onClick={() => {
                if (!armStop) { setArmStop(true); return; }
                run(() => railEngageStop(null, false));
                setArmStop(false);
              }}
              data-testid="exec-stop"
            >
              <span aria-hidden="true">⏻</span>
              {armStop
                ? t('intentOS.rail.confirmStop', { defaultValue: 'Tap again to stop' })
                : t('intentAI.controls.emergency_exit', { defaultValue: 'Emergency stop' })}
            </button>
          </>
        )}
        <button
          type="button"
          className={`exec-btn is-human${state.humanAgent?.requested ? ' is-on' : ''}`}
          onClick={() => run(railRequestHuman)}
          aria-pressed={state.humanAgent?.requested === true}
          data-testid="exec-human"
        >
          <span aria-hidden="true">👤</span>
          {state.humanAgent?.requested
            ? t('intentOS.controls.humanRequested', { defaultValue: 'Agent requested' })
            : t('intentOS.controls.humanAgent', { defaultValue: 'Human agent' })}
        </button>
      </ScrollRail>

      {!blocked && !compact && (
        <div className="exec-presets" role="group" aria-label={t('intentOS.pause.duration', { defaultValue: 'Pause length' })}>
          {PAUSE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={preset === p.id ? 'active' : ''}
              onClick={() => setPreset(p.id)}
              data-testid={`exec-preset-${p.id}`}
            >
              {t(p.key, { defaultValue: p.id })}
            </button>
          ))}
        </div>
      )}

      {blocked && (
        <p className="exec-statusline" data-testid="exec-statusline">
          {stopped
            ? t('intentOS.rail.stopActive', { defaultValue: 'Execution blocked' })
            : `${t('intentOS.rail.paused', { defaultValue: 'Paused' })}${remaining ? ` · ${remaining}` : ''}`}
        </p>
      )}

      {lastRefusal && (
        <p className="exec-refusal" data-testid="exec-refusal">
          {t('intentOS.rail.refused', { defaultValue: 'Not applied' })} · <code>{lastRefusal}</code>
        </p>
      )}
    </div>
  );
}
