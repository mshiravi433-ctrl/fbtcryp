/**
 * LEARNING TELEMETRY HOOK — the only place the client ever submits a
 * learning event, and it is wired up from Signals.jsx alone.
 * ---------------------------------------------------------------------------
 * FIRES ONLY WHEN ALL OF THESE HOLD:
 *   · settings.contributeTelemetry is ON (strict opt-in — the hook is inert
 *     otherwise and performs no fetch, no timer work beyond a cheap check);
 *   · the verdict panel has been VISIBLE for ≥ 5 seconds (STABLE_MS);
 *   · the prediction has been STABLE for that whole window — any change of
 *     coin, stance or confidence restarts the clock. A flickering read is
 *     not a prediction anyone acted on, so it is not a sample.
 *
 * WHAT IT SENDS — exactly the structure the panel already computes:
 *   { coinId, horizon, predictedStance:  v.short.stance,
 *     predictedConfidence: v.short.confidence, predictedRaw, regime,
 *     layersHash, clientTs }  (+ the device-local consent token)
 *
 * WHAT IT NEVER SENDS: any resolved return or outcome (the SERVER computes
 * those from its own market cache — see server/learning/events.js), any
 * address, public key, IP, or user identifier. The payload fields are fixed
 * by construction; the wiring test greps this file to keep it that way.
 *
 * Deduped to one event per coin+horizon per day, mirroring lib/learning.js.
 */

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { weightsSnapshotId } from '../lib/learning';

export const STABLE_MS = 5000;
const DAY_MS = 24 * 3600 * 1000;
const SENT_KEY = 'fbt-learning-events-v1';

function sentMap() {
  try {
    return JSON.parse(sessionStorage.getItem(SENT_KEY) || '{}');
  } catch {
    return {};
  }
}
function markSent(m) {
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify(m));
  } catch {
    /* private mode — events just stop deduping across reloads */
  }
}

function postEvent(payload, consent) {
  try {
    fetch('/api/learning/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telemetry-consent': consent },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  } catch {
    /* telemetry must never touch the UI path */
  }
}

/**
 * @param {object} args
 * @param {object} args.coin     the market row currently shown
 * @param {object} args.v        the verdict object VerdictPanel renders
 * @param {object} [args.learn]  the /api/learning/params payload (names the
 *                               weights snapshot the prediction was made under)
 * @param {boolean} args.visible whether the verdict panel is on screen
 */
export function useLearningTelemetry({ coin, v, learn = null, visible = true }) {
  const timerRef = useRef(null);

  // Fingerprint of the CURRENT prediction. The effect below depends on THIS
  // string, not on the verdict object's identity: a re-render that computes
  // an identical read keeps the 5-second clock running, while any change of
  // coin, stance or confidence restarts it.
  const fp = coin?.id && v?.short
    ? [coin.id, v.short.stance, v.short.confidence, v.long?.stance, v.long?.confidence].join('|')
    : null;
  const vRef = useRef(v);
  vRef.current = v;
  const learnRef = useRef(learn);
  learnRef.current = learn;

  useEffect(() => {
    // OPT-IN GUARD — first check, before any work. When the user has not
    // enabled contributeTelemetry in Settings the hook does nothing at all.
    const s = useSettingsStore.getState();
    if (!s.contributeTelemetry || !s.telemetryToken) return undefined;
    if (!visible || !fp) return undefined;
    const coinId = fp.split('|')[0];

    timerRef.current = setTimeout(() => {
      const now = useSettingsStore.getState();
      if (!now.contributeTelemetry || !now.telemetryToken) return; // re-check at fire time
      const vv = vRef.current;
      if (!vv?.short) return;
      const m = sentMap();
      const day = Math.floor(Date.now() / DAY_MS);
      const regime = vv.macro?.regime?.regime ?? 'unknown';
      const layersHash = weightsSnapshotId(learnRef.current);
      for (const horizon of ['short', 'long']) {
        const side = vv[horizon];
        if (!side || side.stance === 'unclear') continue; // no claim, no sample
        const key = `${coinId}|${horizon}`;
        if (m[key] === day) continue; // once per coin per horizon per day
        m[key] = day;
        postEvent(
          {
            coinId,
            chainId: null,
            horizon,
            predictedStance: side.stance,
            predictedConfidence: side.confidence,
            predictedRaw: side.score ?? 0,
            regime,
            layersHash,
            clientTs: Date.now()
          },
          now.telemetryToken
        );
      }
      markSent(m);
    }, STABLE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [fp, visible]);
}

export default useLearningTelemetry;
