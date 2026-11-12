/**
 * SMART MONEY — ONE READ, ONE MEANING.
 * ===========================================================================
 * «خواندن اسمارت‌مانی را درست و هوشمندتر کن»
 *
 * The app holds up to three independent statements about the same token at the
 * same time, and until now each surface picked whichever one it happened to
 * have:
 *
 *   1. the VERIFIED row — wallets that passed the performance/independence
 *      gate, with a signed net flow and a count of independent voters
 *      (`verifiedSignals` / the token route's own `verified.consensus`);
 *   2. the DEX TAPE — every large swap DexScreener saw in 24 h, buyers and
 *      sellers, no qualification at all (`smartMoneyFlow` on the token route);
 *   3. the OBSERVED ACTIVITY row — our own scanner's labelled transfers and
 *      DEX fills for that symbol in the selected window (`tokenActivity`).
 *
 * Three readers of three different shapes is how a card ends up saying
 * «accumulation» while the wallet page next to it says «distribution» for the
 * same asset, and how one $400 tape print ends up voting as loudly as a $40M
 * verified distribution.
 *
 * This module makes ONE read out of them, with these rules:
 *
 *   · EVIDENCE FIRST. A verified row wins on identity; the tape can only
 *     MODULATE it. Two sources that disagree do not average to "neutral" —
 *     that is how a real signal becomes mush. They produce `conflict: true`
 *     and the read abstains from a dollar direction, so the consensus engine
 *     treats it as a softer, lower-confidence vote rather than as a loud one.
 *
 *   · SIZE IS NOT SUPPORT. A dollar figure says how much moved; the number of
 *     independent voters, events and wallets says how much of the market that
 *     figure represents. Confidence is built from BOTH, so a big number from
 *     one wallet cannot buy high confidence.
 *
 *   · SILENCE IS NOT NEUTRAL. No source, or a source that failed, leaves the
 *     read `measured: false` with a null direction — never a `0` that the
 *     consensus would count as a real abstention.
 *
 *   · NOTHING IS FETCHED. Every input is already in the caller's hands: the
 *     Signals page, the token card and the copy-trade button all pass what
 *     they already hold. No request, no timer, no storage.
 *
 * Pure and dependency-free, so the rules can be asserted directly.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Windows, so a 24 h figure is never compared against a 7 d one. */
export const READ_WINDOWS = Object.freeze({ '1h': 3600_000, '4h': 4 * 3600_000,
  '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000 });

/**
 * How much of a story a sample actually tells, 0…1.
 *
 * Breadth beats volume: three wallets that agree are a pattern, one wallet that
 * moved a lot is one wallet. Each term is capped so no single number can carry
 * the whole score, and a missing term is simply not counted (the divisor only
 * includes terms we could measure).
 */
/**
 * The tape's own size, on the same log scale the consensus engine uses for
 * smart-money dollars. Without it a $120k net and a $120M net read as the same
 * measurement, which is how a thin tape gets a confident label.
 */
function tapeSize(netUsd) {
  const n = num(netUsd);
  if (n === null) return 0;
  return clamp(Math.log10(1 + Math.abs(n) / 10_000) / 3, 0, 1);
}

function supportScore({ votes, events, wallets, trades }) {
  const parts = [];
  const push = (value, cap) => {
    const n = num(value);
    if (n !== null) parts.push(clamp(n / cap, 0, 1));
  };
  push(votes, 6);      // independent votes: 6 is a strong board
  push(wallets, 12);   // distinct wallets touched
  push(events, 20);    // labelled events
  push(trades, 200);   // raw tape prints (a weak term on purpose)
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** The tape's own direction, from its two sides. */
function tapeRead(flow) {
  if (!flow || typeof flow !== 'object') return null;
  const net = num(flow.netUsd);
  if (net === null) return null;
  const buy = num(flow.buyUsd);
  const sell = num(flow.sellUsd);
  const total = (buy ?? 0) + (sell ?? 0);
  return {
    netUsd: net,
    dir: Math.abs(net) < 1e-9 ? 0 : Math.sign(net),
    share: total > 0 ? Math.abs(net) / total : null,
    trades: num(flow.trades),
    wallets: num(flow.wallets)
  };
}

/** The scanner's labelled activity row, in the same vocabulary. */
function activityRead(row) {
  if (!row || typeof row !== 'object') return null;
  const net = num(row.netUsd);
  if (net === null) return null;
  const stated = String(row.signal || '').toUpperCase();
  return {
    netUsd: net,
    dir: Math.abs(net) < 1e-9 ? 0 : Math.sign(net),
    stated: stated === 'ACCUMULATION' ? 1 : stated === 'DISTRIBUTION' ? -1 : 0,
    events: num(row.labelledEvents ?? row.events),
    wallets: num(row.wallets)
  };
}

/**
 * @param {object} input
 * @param {object} [input.verified]  a row from `verifiedSignals` (already gated)
 * @param {object} [input.tape]      the token route's `smartMoneyFlow` /
 *                                   `tokenSignals` object (unqualified swaps)
 * @param {object} [input.activity]  one `tokenActivity` row from the overview
 * @param {object} [input.whales]    the whale-engine token read
 *                                   (`readWhalesOnToken`) — wallets that moved
 *                                   this ticker, not swaps
 * @param {string} [input.window]    '1h' | '4h' | '24h' | '7d' — for freshness
 * @param {number} [input.now]
 *
 * @returns {{
 *   measured:boolean, basis:'verified'|'activity'|'tape'|null,
 *   signal:'ACCUMULATION'|'DISTRIBUTION'|null, netUsd:number|null,
 *   confidence:number|null, support:{votes:number|null,events:number|null,
 *   wallets:number|null,trades:number|null}, conflict:boolean,
 *   agreement:number|null, freshnessMs:number|null, window:string|null,
 *   sizeUsd:number|null, note:string
 * }}
 */
export function readSmartMoney({
  verified = null,
  tape = null,
  activity = null,
  whales = null,
  window = null,
  now = Date.now()
} = {}) {
  const empty = {
    measured: false, basis: null, signal: null, netUsd: null, confidence: null,
    support: { votes: null, events: null, wallets: null, trades: null },
    conflict: false, agreement: null, freshnessMs: null, window: window || null,
    sizeUsd: null, note: 'no-source'
  };

  /* ── 1 · the verified row: the only source allowed to NAME a direction ──── */
  let v = null;
  if (verified && typeof verified === 'object') {
    const net = num(verified.netFlowUsd ?? verified.netUsd);
    const stated = String(verified.signal || '').toUpperCase();
    const dir = stated === 'ACCUMULATION' ? 1 : stated === 'DISTRIBUTION' ? -1 : 0;
    /* A stated direction that its own flow contradicts is not evidence in
       either direction — the row is dropped rather than guessed at. */
    const selfConsistent = net === null || dir === 0 || Math.sign(net) === dir;
    if (dir !== 0 && selfConsistent) {
      v = {
        netUsd: net,
        dir,
        confidence: num(verified.confidence),
        votes: num(verified.independentVotes),
        swaps: num(verified.swaps),
        buyers: num(verified.independentBuyers),
        sellers: num(verified.independentSellers),
        lastAt: num(verified.lastAt)
      };
    }
  }

  /* ── 2 · the tape and the scanner row ───────────────────────────────────── */
  const t = tapeRead(tape);
  const a = activityRead(activity);

  /* An activity row whose stated signal fights its own net is treated exactly
     like a contradictory tape: recorded, never used as a direction. */
  const aUsable = a && (a.stated === 0 || a.stated === a.dir) ? a : null;

  const supporting = [t, aUsable].filter(Boolean);
  const scores = supportScore({
    votes: v?.votes,
    events: aUsable?.events ?? null,
    wallets: aUsable?.wallets ?? t?.wallets ?? null,
    trades: t?.trades
  });

  /* ── 3 · the read ───────────────────────────────────────────────────────── */
  if (v) {
    const tapeDir = t && t.dir !== 0 ? t.dir : null;
    const actDir = aUsable && aUsable.dir !== 0 ? aUsable.dir : null;
    /* Disagreement with EITHER independent source is a conflict: two of the
       three inputs would be at war, and averaging a war produces silence. */
    const opposing = [tapeDir, actDir].filter((d) => d !== null && d !== v.dir);
    const agree = 1 + [tapeDir, actDir].filter((d) => d !== null && d === v.dir).length;
    const agreement = agree / (1 + [tapeDir, actDir].filter((d) => d !== null).length);

    const baseConfidence = v.confidence ?? 60;
    const supported = clamp((baseConfidence * (0.7 + 0.3 * (scores ?? 0.5)) * agreement), 0, 100);
    const conflict = opposing.length > 0;

    return {
      measured: true,
      basis: 'verified',
      signal: v.dir > 0 ? 'ACCUMULATION' : 'DISTRIBUTION',
      /* On a conflict the dollar figure is withheld — the consensus then votes
         on the STATED direction at the reduced confidence instead of letting a
         contested number dominate the size-scaled branch. */
      netUsd: conflict ? null : v.netUsd,
      sizeUsd: v.netUsd,
      confidence: Math.round(clamp(conflict ? Math.min(supported, 55) : supported, 0, 100)),
      support: {
        votes: v.votes,
        events: aUsable?.events ?? null,
        wallets: aUsable?.wallets ?? t?.wallets ?? null,
        trades: t?.trades ?? null
      },
      conflict,
      agreement: Math.round(agreement * 100) / 100,
      freshnessMs: v.lastAt !== null ? Math.max(0, now - v.lastAt) : null,
      window: window || null,
      note: conflict ? 'verified-opposed-by-tape' : 'verified'
    };
  }

  /* No verified row: the labelled scanner activity is the next best thing,
     because its wrong parts (routers, exchanges, contracts) were removed by
     the server's own label rules. */
  if (aUsable && aUsable.dir !== 0) {
    const tapeDir = t && t.dir !== 0 ? t.dir : null;
    const conflict = tapeDir !== null && tapeDir !== aUsable.dir;
    const agreement = tapeDir === null ? null : conflict ? 0 : 1;
    const trust = clamp(0.55 + 0.45 * (scores ?? 0.4), 0, 1);
    return {
      measured: true,
      basis: 'activity',
      signal: aUsable.dir > 0 ? 'ACCUMULATION' : 'DISTRIBUTION',
      netUsd: conflict ? null : aUsable.netUsd,
      sizeUsd: aUsable.netUsd,
      confidence: Math.round(clamp(trust * (conflict ? 40 : 70), 0, 100)),
      support: { votes: null, events: aUsable.events, wallets: aUsable.wallets, trades: t?.trades ?? null },
      conflict,
      agreement,
      freshnessMs: null,
      window: window || null,
      note: conflict ? 'labelled-opposed-by-tape' : 'labelled-activity'
    };
  }

  /* Last: the raw tape. It is a real measurement of real swaps, but nobody
     verified WHO did them, so it is never allowed high confidence. */
  if (t && t.dir !== 0) {
    return {
      measured: true,
      basis: 'tape',
      signal: t.dir > 0 ? 'ACCUMULATION' : 'DISTRIBUTION',
      netUsd: t.netUsd,
      sizeUsd: t.netUsd,
      /* Size (log-scaled), balance of the two sides, and breadth — three
         independent reasons to believe a number nobody verified the actors of.
         Still capped at 70: an unqualified tape can never outrank evidence. */
      confidence: Math.round(clamp(15 + 30 * tapeSize(t.netUsd) + 25 * (t.share ?? 0) + 30 * (scores ?? 0), 0, 70)),
      support: { votes: null, events: null, wallets: t.wallets, trades: t.trades },
      conflict: false,
      agreement: null,
      freshnessMs: null,
      window: window || null,
      note: 'unqualified-tape'
    };
  }

  /* ── and last, the WHALE BOARD ────────────────────────────────────────────
     A wallet that moved this ticker is a real observation, but it is the
     weakest of the four: the board ranks wallets by capital, and its token
     membership is a symbol match, so the same ticker on another chain can be
     behind it. It is therefore used ONLY when nothing more specific was
     measured, it needs breadth to say anything (`confident`), and its
     confidence is capped low. */
  if (whales && whales.measured && whales.direction && whales.confident) {
    return {
      measured: true,
      basis: 'whales',
      signal: whales.direction,
      netUsd: num(whales.netUsd),
      sizeUsd: num(whales.netUsd),
      confidence: Math.round(clamp(20 + 15 * clamp(whales.wallets / 8, 0, 1)
        + 10 * (1 - clamp((whales.topSharePct ?? 0) / 100, 0, 1)), 0, 45)),
      support: { votes: null, events: null, wallets: whales.wallets, trades: null },
      conflict: false,
      agreement: null,
      freshnessMs: null,
      window: window || whales.window || null,
      note: 'whale-board'
    };
  }

  return empty;
}

/**
 * The consensus-engine shape: `{ signal, netUsd, confidence }` — or null.
 *
 * Split out so every caller (the signal card, the early detector, the
 * copy-trade plan) converts a read the same way, and so a `measured:false`
 * read can never reach the engine as a zero.
 */
export function readForConsensus(read) {
  if (!read || !read.measured || !read.signal) return null;
  return {
    signal: read.signal,
    /* `netUsd: null` is meaningful here — it tells the consensus to vote on
       the stated direction at `confidence` rather than on a size-scaled
       number. See the conflict branch above. */
    netUsd: read.netUsd,
    confidence: read.confidence
  };
}

/** Human-facing provenance, for a row label. Never a claim of advice. */
export const READ_BASIS_LABEL = Object.freeze({
  verified: 'verified',
  activity: 'labelledActivity',
  tape: 'unqualifiedTape',
  whales: 'whaleBoard'
});

export default readSmartMoney;
