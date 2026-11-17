/**
 * SIGNAL ACCELERATION — «موتور شتاب سیگنال‌ها»
 * ===========================================================================
 * A signal's LEVEL tells you where the evidence stands right now. Its
 * ACCELERATION tells you where it is going: whether the case is being built or
 * is quietly falling apart. A card sitting at +20 that was +34 three polls ago
 * and a card sitting at +20 that was +6 are the same number on screen and two
 * completely different situations.
 *
 * ─── WHY THIS IS A SEPARATE, TINY MODULE ──────────────────────────────────
 * The page already computes a score per token on every poll. Keeping the last
 * few of those — per token, in a bounded Map, in memory — is all this needs.
 * No request, no storage, no timer, no serialisation: a page that has been open
 * for two minutes already has enough history to say «this is accelerating».
 *
 * ─── WHAT IT REFUSES TO DO ────────────────────────────────────────────────
 * • It never infers an acceleration from a single point. Two samples are the
 *   minimum, three are needed for «steady/accelerating» to mean anything.
 * • It never reports a magnitude it cannot compare: every delta is divided by
 *   the time between samples, because polls are not evenly spaced (a hidden tab
 *   pauses, a slow network stretches the tick) and an un-normalised delta would
 *   read as «exploding» after any pause.
 * • It never turns a sign flip into «acceleration». A reversal is its own
 *   state, and a far more important one than a slope — the module says which.
 * • It never lets acceleration move a confidence figure by more than a few
 *   points. It is a refinement of an existing reading, not a new signal.
 */

/** Bounded, so a page left open for hours cannot grow this without limit. */
export const MAX_TRACKED = 40;
/** How many samples per token are kept (oldest dropped first). */
export const SAMPLES_PER_TOKEN = 6;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A bounded per-coin score history.
 *
 * Deliberately a plain factory (not a hook) so it can be tested directly and
 * used from a `useRef` without dragging React into the engine.
 */
export function createScoreTracker({ maxCoins = MAX_TRACKED, maxSamples = SAMPLES_PER_TOKEN } = {}) {
  /** @type {Map<string, {score:number, at:number}[]>} */
  const store = new Map();

  return {
    /** Record one measured score. Returns the sample list INCLUDING it. */
    push(coinId, score, at = Date.now()) {
      const id = String(coinId || '');
      const value = num(score);
      if (!id || value === null) return [];
      const list = store.get(id) || [];
      const last = list[list.length - 1];
      /* A poll that lands in the same millisecond (or with an identical score
         and timestamp) adds nothing — dedupe instead of inflating the count. */
      if (last && last.at === at) return list;
      list.push({ score: value, at });
      while (list.length > maxSamples) list.shift();
      store.set(id, list);
      /* Bound the COIN count too: visiting forty tokens must not leave forty
         histories in the heap for the life of the tab. */
      if (store.size > maxCoins) {
        const oldest = [...store.entries()].sort((a, b) => (a[1][0]?.at ?? 0) - (b[1][0]?.at ?? 0))[0];
        if (oldest) store.delete(oldest[0]);
      }
      return list;
    },

    /** The samples for one coin (a copy — callers must not mutate the store). */
    samples(coinId) {
      return [...(store.get(String(coinId || '')) || [])];
    },

    get size() {
      return store.size;
    },

    clear() {
      store.clear();
    }
  };
}

/**
 * Read the acceleration of one score series.
 *
 * @param {{score:number, at:number}[]} samples  oldest → newest
 * @returns {{
 *   delta:number|null, perHour:number|null, accel:number|null,
 *   state:'accelerating'|'fading'|'steady'|'reversing'|'new',
 *   streak:number, samples:number, spanMin:number|null,
 *   confidenceNudge:number, previousScore:number|null, currentScore:number|null
 * }}
 */
export function readAcceleration(samples = []) {
  const rows = (samples || []).filter((s) => s && num(s.score) !== null && num(s.at) !== null);
  const empty = {
    delta: null, perHour: null, perPoll: null, accel: null, state: 'new', streak: 0,
    samples: rows.length, spanMin: null, confidenceNudge: 0,
    previousScore: null, currentScore: null
  };
  if (rows.length === 0) return empty;

  const current = rows[rows.length - 1];
  if (rows.length === 1) return { ...empty, currentScore: current.score, state: 'new' };

  const previous = rows[rows.length - 2];
  const delta = Math.round((current.score - previous.score) * 10) / 10;

  /* Normalise to an hourly rate: polls are not evenly spaced, and an
     un-normalised delta would look explosive after any pause. */
  const spanMs = current.at - previous.at;
  const spanMin = spanMs > 0 ? Math.round(spanMs / 6000) / 10 : null;
  /* TWO WINDOWS, BECAUSE THEY ANSWER TWO QUESTIONS.
     `perPoll` is «what changed since last time», the number a reader watching
     the screen actually perceives. `perHour` normalises across uneven ticks
     (a hidden tab pauses, a slow network stretches the gap) so a value can be
     compared with another asset's. Neither is ever derived from the other. */
  const perHour = spanMin && spanMin > 0
    ? Math.round((delta / spanMin) * 60 * 10) / 10
    : null;

  /* Second difference — the difference between «still climbing» and «climbing
     faster». Needs three samples; with two it is honestly null. */
  let accel = null;
  if (rows.length >= 3) {
    const p2 = rows[rows.length - 3];
    const d1 = previous.score - p2.score;
    accel = Math.round((delta - d1) * 10) / 10;
  }

  /* A sign flip is a REVERSAL, and it outranks any slope: the case that was
     being built is now being disassembled. */
  const reversing = Math.sign(current.score) !== Math.sign(previous.score)
    && Math.abs(previous.score) >= 8 && Math.abs(current.score) >= 8;

  /* Consecutive samples moving the same way — persistence is what separates a
     trend from a bounce in the tick. */
  let streak = 0;
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const d = rows[i].score - rows[i - 1].score;
    if (d === 0) break;
    if (streak === 0) streak = Math.sign(d);
    else if (Math.sign(d) !== streak) break;
    else streak += Math.sign(d);
  }
  const streakCount = Math.abs(streak);

  /*
   * THE STATE IS ABOUT THE RUN, NOT ONLY THE LAST TICK. A score moving
   * 6 → 18 → 20 is being built even though the final step was small; judging
   * it by the last delta alone would call a two-tick climb «steady» and hide
   * exactly what the reader wants to know. So the run's own total counts too,
   * and a single flat tick inside a two-tick climb does not erase it.
   */
  const runTotal = rows.length >= 2
    ? rows[rows.length - 1].score - rows[rows.length - 1 - streakCount].score
    : 0;
  let state = 'steady';
  if (reversing) state = 'reversing';
  else if (streakCount >= 2 && (Math.abs(delta) >= 3 || Math.abs(runTotal) >= 6)) {
    state = Math.sign(runTotal || delta) > 0 ? 'accelerating' : 'fading';
  } else if (rows.length === 2) state = 'new';
  else if (Math.abs(delta) < 3) state = 'steady';

  /*
   * WHAT THIS IS ALLOWED TO DO TO CONFIDENCE: ±4 points, and only when the
   * move is both meaningful and recent. A reversal subtracts, never adds — a
   * case that just flipped is less trustworthy than one that never moved,
   * whatever the direction of the new reading.
   */
  const runMag = Math.max(Math.abs(delta), Math.abs(runTotal));
  let confidenceNudge = 0;
  if (reversing) confidenceNudge = -4;
  else if (state === 'accelerating' && runMag >= 6) confidenceNudge = 4;
  else if (state === 'accelerating') confidenceNudge = 2;
  else if (state === 'fading' && runMag >= 6) confidenceNudge = -3;
  else if (state === 'fading') confidenceNudge = -1;

  return {
    delta,
    perHour,
    perPoll: delta,
    accel,
    state,
    streak,
    samples: rows.length,
    spanMin,
    confidenceNudge: clampf(confidenceNudge, -4, 4),
    previousScore: previous.score,
    currentScore: current.score,
    runTotal: Math.round(runTotal * 10) / 10
  };
}

export default readAcceleration;
