/**
 * EARLYNESS — «شناخت زودهنگام کیف پول», as a measurement rather than a badge.
 * ===========================================================================
 * The app has called wallets «تازه» for a while. What it could not answer is
 * the question the label exists for:
 *
 *   · Is this wallet early to THIS TOKEN, or merely new?
 *   · Is the money it holds still there, or did it already leave through the
 *     same door it came in?
 *   · Could anyone have acted on this observation when it was made?
 *
 * A boolean cannot answer any of those. Three fields can, and this module is
 * almost entirely about the distances between them:
 *
 *   1. WALLET AGE ≠ OPPORTUNITY. A wallet created four hours ago that filled
 *      26 hours ago is a post-mortem: the news is stale, the price already
 *      moved, and calling it «زودهنگام» invites the reader to buy the top. So
 *      the OBSERVATION is aged, not just the wallet.
 *   2. YOUNG AT ENTRY. A wallet that is nine months old but made its FIRST
 *      trade in this token yesterday is early to the token, and that is the
 *      signal — not the wallet's birthday. Earlyness is measured at the entry,
 *      relative to the token's own life when both are known.
 *   3. CAPITAL THAT STAYED. Fresh capital that arrived and stayed is an
 *      observation; the same dollars that arrived and left are a round trip,
 *      which is what a bot or a farmer does.
 *
 * ─── WHAT THIS REFUSES TO DO ───────────────────────────────────────────────
 * • It never invents a timestamp. Every age comes from a field the caller has;
 *   a missing one makes that PART unmeasured (`null`), never zero.
 * • It never promotes a young wallet to «smart». A wallet cannot have a track
 *   record before it has a history — the ladder stops at `earlyWatch`.
 * • It never returns a score built from one part. With fewer than
 *   `EARLY_MIN_PARTS` measured parts the score is null and the reason is named,
 *   because a confident number made of one integer is worse than «—».
 *
 * Pure arithmetic over values in hand: no fetch, no timer, no storage, so it
 * costs nothing to run on every row of a list that is already on screen.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/* ── the constants, exported so a screen and a probe cannot disagree ─────── */

/** A wallet younger than this is «new» in the plain sense. */
export const EARLY_MAX_AGE_MS = 48 * 3600_000;
/** An observation older than this cannot be acted on at the price observed. */
export const EARLY_MAX_STALENESS_MS = 6 * 3600_000;
/** Earlyness is only credible inside this fraction of the token's own life. */
export const EARLY_TOKEN_AGE_FRACTION = 0.25;
/** Below this share of the received money still held, the capital round-tripped. */
export const EARLY_STAYED_MIN = 0.4;
/** Parts that must be measured before a score is published at all. */
export const EARLY_MIN_PARTS = 2;
/**
 * The two parts that ARE the question. A score for «how early was this?» with
 * neither a timing measure nor a staleness measure is not a low score, it is
 * not a score — `stayed` and `thinActivity` alone would let a wallet with no
 * timestamps at all come out labelled `earlyWatch` at 96, which is exactly the
 * confidently-baseless output this module exists to stop. Both must exist.
 */
export const EARLY_REQUIRED_PARTS = Object.freeze(['youngAtEntry', 'actionable']);

/**
 * The strongest labels this engine will emit.
 *
 * Deliberately stops at `earlyWatch`: «early» means «we saw this wallet before
 * the crowd could», which is an observation about TIMING. It says nothing about
 * whether the wallet is any good, and a wallet younger than 48 hours cannot be.
 */
export const EARLY_LABELS = Object.freeze([
  'earlyWatch',   // young at entry, capital stayed, news still actionable
  'early',        // young at entry, news still actionable
  'late',         // young, but the window to act has closed
  'roundTrip',    // the money arrived and left again
  'stale',        // old news on an old wallet
  'unmeasured'    // not enough of the inputs to say anything
]);

const WEIGHTS = Object.freeze({
  youngAtEntry: 0.34,
  actionable: 0.26,
  stayed: 0.18,
  firstMover: 0.12,
  thinActivity: 0.10
});

/**
 * One wallet, read for how early it was — and how much of that is still true.
 *
 * @param {object} input
 * @param {number} [input.walletAgeMs]   age of the wallet itself, when measured
 * @param {number} [input.seenAt]        when the movement was OBSERVED (ms)
 * @param {number} [input.entryAt]       when this wallet first touched the asset
 * @param {number} [input.tokenAgeMs]    the asset's own age, when known
 * @param {number} [input.receivedUsd]   capital that arrived
 * @param {number} [input.heldUsd]       capital still held
 * @param {number} [input.capitalUsd]    total observed capital
 * @param {number} [input.activity]      lifetime tx + token-transfer count
 * @param {number} [input.buyerRank]     1 = first independent buyer we saw
 * @param {number} [input.buyers]        independent buyers observed
 * @param {number} [input.now]
 */
export function readEarlyness({
  walletAgeMs = null,
  seenAt = null,
  entryAt = null,
  tokenAgeMs = null,
  receivedUsd = null,
  heldUsd = null,
  capitalUsd = null,
  activity = null,
  buyerRank = null,
  buyers = null,
  now = Date.now()
} = {}) {
  const age = num(walletAgeMs);
  const entered = num(entryAt) ?? num(seenAt);
  const tokenAge = num(tokenAgeMs);
  const capital = num(capitalUsd);
  const received = num(receivedUsd);
  const held = num(heldUsd);

  /* ── part 1 · was the wallet young, and young AT THE ENTRY? ───────────── */
  let youngAtEntry = null;
  let ageAtEntry = null;
  if (age !== null) {
    /* Age at the moment it touched the asset, not age today. A nine-month-old
       wallet that first traded this token yesterday was young at entry. */
    ageAtEntry = entered !== null ? age - Math.max(0, now - entered) : age;
    if (ageAtEntry >= 0) {
      if (tokenAge !== null && tokenAge > 0 && entered !== null) {
        /* Early to the TOKEN: it was in the first quarter of the token's life. */
        const share = ageAtEntry / tokenAge;
        youngAtEntry = share <= EARLY_TOKEN_AGE_FRACTION
          ? clamp(1 - share / EARLY_TOKEN_AGE_FRACTION, 0, 1)
          : 0;
      } else {
        youngAtEntry = ageAtEntry <= EARLY_MAX_AGE_MS
          ? clamp(1 - ageAtEntry / EARLY_MAX_AGE_MS, 0, 1)
          : 0;
      }
    }
  }

  /* ── part 2 · is the news still actionable? ───────────────────────────────
     Ageing the OBSERVATION rather than the wallet is the whole point: a wallet
     born an hour ago whose only fill was yesterday is not early, it is late. */
  const observationAgeMs = entered !== null ? Math.max(0, now - entered) : null;
  const actionable = observationAgeMs === null
    ? null
    : observationAgeMs <= EARLY_MAX_STALENESS_MS
      ? clamp(1 - observationAgeMs / EARLY_MAX_STALENESS_MS, 0, 1)
      : 0;

  /* ── part 3 · did the capital stay? ──────────────────────────────────────
     `receivedUsd` is the denominator when we have it: what arrived, and how
     much of it is still there. `heldUsd` is the honest input; when only the
     capital and the received total are known, the difference is what moved. */
  const stayed = received !== null && received > 0 && held !== null
    ? clamp(held / received, 0, 1)
    : null;

  /* ── part 4 · was it among the FIRST wallets, not the crowd? ────────────── */
  const rank = num(buyerRank);
  const crowd = num(buyers);
  let firstMover = null;
  if (rank !== null && crowd !== null && crowd > 0 && rank > 0) {
    /* rank 1 of 20 is early; rank 18 of 20 is the crowd. */
    firstMover = clamp(1 - (rank - 1) / Math.max(1, crowd), 0, 1);
  }

  /* ── part 5 · a barely-used wallet supports the story; a busy one dilutes it ─ */
  const act = num(activity);
  const thinActivity = act === null ? null : clamp(1 - act / 40, 0, 1);

  const parts = { youngAtEntry, actionable, stayed, firstMover, thinActivity };
  const measuredKeys = Object.keys(parts).filter((k) => parts[k] !== null);

  /* Both load-bearing parts must be measured, and at least one beyond them. */
  const requiredMissing = EARLY_REQUIRED_PARTS.filter((k) => parts[k] === null);
  /* A score made of one part is a restatement of that part. Refuse it. */
  const score = requiredMissing.length || measuredKeys.length < EARLY_MIN_PARTS
    ? null
    : Math.round(clamp(
      measuredKeys.reduce((s, k) => s + parts[k] * WEIGHTS[k], 0)
        / measuredKeys.reduce((s, k) => s + WEIGHTS[k], 0),
      0, 1
    ) * 100);

  /* ── the label, strongest claim first, and each with its own reason ────── */
  let label = 'unmeasured';
  let reason = requiredMissing.length
    ? `no-timing-evidence:${requiredMissing.join('+')}`
    : 'not-enough-measured-parts';
  if (score !== null) {
    if (stayed !== null && stayed < EARLY_STAYED_MIN) {
      /* A round trip is a round trip even when the wallet was early: the money
         is gone, and the observation is about a flow that already reversed. */
      label = 'roundTrip';
      reason = 'capital-left-through-the-same-door';
    } else if (actionable !== null && actionable === 0) {
      label = 'late';
      reason = 'observation-is-older-than-the-actionable-window';
    } else if (youngAtEntry === 0) {
      label = 'stale';
      reason = 'wallet-was-not-young-when-it-entered';
    } else if (score !== null && score >= 55 && stayed !== null && stayed >= 0.6) {
      label = 'earlyWatch';
      reason = 'young-at-entry-and-the-capital-stayed';
    } else {
      label = 'early';
      reason = 'young-at-entry';
    }
  }

  return {
    schema: 'fbt.wallet-earlyness.v1',
    measured: measuredKeys.length > 0,
    score,
    label,
    reason,
    /* How much of the ladder we could actually see. A score from two of five
       parts must travel with that fact. */
    coverage: measuredKeys.length,
    partsCovered: measuredKeys,
    partsMissing: Object.keys(parts).filter((k) => parts[k] === null),
    /** What stopped a score, when one was refused. */
    refusedBecause: score === null ? reason : null,
    youngAtEntry: youngAtEntry === null ? null : round(youngAtEntry, 2),
    actionable: actionable === null ? null : round(actionable, 2),
    stayed: stayed === null ? null : round(stayed, 2),
    firstMover: firstMover === null ? null : round(firstMover, 2),
    observationAgeMs,
    ageAtEntry,
    walletAgeMs: age,
    /** True only when the observation could still be acted on at this price. */
    live: actionable !== null && actionable > 0,
    parts,
    weights: WEIGHTS,
    note: label === 'earlyWatch' || label === 'early'
      ? 'Being early is a fact about timing, not about skill: a wallet this young has no track record, and this reading says nothing about whether it is right.'
      : null
  };
}

export default readEarlyness;
