/**
 * COPY-TRADE — THE MISSING MIDDLE LAYER.
 * ===========================================================================
 * «موتور کپی‌ترید را هوشمندتر کن و مطمئن شو با سیگنال هم‌جریان است»
 *
 * Until now «کپی تراکنش» was a handoff, not an engine: it checked that the
 * address parsed and opened the swap screen. Everything that makes copying a
 * whale's fill a good idea or a bad one — is the evidence still fresh, do the
 * independent planes agree, is the pool deep enough for the size, how much is
 * actually at risk if the stop is where the evidence breaks — was left to the
 * reader to assemble from three different screens.
 *
 * This module is that middle layer. It answers one question (`plan`) and it
 * answers it from data the app ALREADY HAS:
 *
 *   · the smart-money read (`readSmartMoney`) — who, how decisively, how fresh;
 *   · the token route's own numbers — liquidity, top-10 concentration, exchange
 *     supply, volatility, 24 h volume and trade count;
 *   · the reader's own size — a planned amount, or the portfolio impact the
 *     Signals page already computed.
 *
 * ─── THE RULE THAT MAKES IT WORTH HAVING ───────────────────────────────────
 * A copy-trade plan and a SIGNAL must be the same opinion. Both are built from
 * `readSmartMoney`, and `plan.read` is returned verbatim so it can be handed to
 * `readForConsensus` — the exact function the signal card uses. A test asserts
 * that the two agree for every input, so the button and the card cannot drift
 * apart again.
 *
 * ─── WHAT IT REFUSES TO DO ─────────────────────────────────────────────────
 * • It never invents a number. A gate whose input is missing is `pass: null`
 *   and says «unmeasured»; only a gate that was measured can fail.
 * • It never upgrades a weak case into a recommendation. `action` is null
 *   unless the evidence gate passed, the planes did not conflict, and at least
 *   three gates were measured and passed. A blocked plan still returns the
 *   reasons — a veto with no explanation is just a disabled button.
 * • It never prices risk off a guess. `riskUsd` needs a planned size AND a
 *   volatility/stop reading; with either missing it is null and the UI hides it.
 * • It never signs, quotes or promises a fill. The output is a plan plus the
 *   prefill link; the swap screen keeps its own gate, slippage and confirmation.
 *
 * Pure arithmetic over values in hand: no fetch, no timer, no storage.
 */
import { swapDeepLink } from './smartMoneySwap.js';
import { readSmartMoney } from './smartMoneyRead.js';

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

/** Below this a plan is not worth the gas, whatever the evidence says. */
export const MIN_POOL_USD = 50_000;
/** Top-10 share above this is a token one wallet can move. */
export const MAX_TOP10_PCT = 60;
/** An evidence read older than this is history, not a signal. */
export const MAX_EVIDENCE_AGE_MS = 6 * 3600_000;
/** Gates that must be MEASURED (not merely unfailed) before an action exists. */
export const MIN_MEASURED_GATES = 3;

/**
 * One gate. `pass === null` means «not measured» and is reported, never
 * silently counted as a pass — that is the whole difference between a checklist
 * and a formality.
 */
function gate(key, pass, detail = null) {
  return { key, pass, detail };
}

/**
 * @param {object} input
 * @param {number|string} input.chain
 * @param {string} input.token             contract / mint
 * @param {string} [input.symbol]
 * @param {object} [input.verified]        a verified consensus row
 * @param {object} [input.tape]            `smartMoneyFlow` (unqualified swaps)
 * @param {object} [input.activity]        a `tokenActivity` row
 * @param {object} [input.whales]          the whale-engine token read
 * @param {string} [input.window]
 * @param {object} [input.tokenIntel]      the token route's payload
 *        (`{ liquidityUsd, holders:{top10Share,exchangeSupplyPct}, volume:{h24}, txns:{buys24,sells24} }`)
 * @param {number} [input.volatilityPct]   measured volatility (e.g. ATR % or σ)
 * @param {number} [input.plannedUsd]      the reader's size
 * @param {number} [input.bookUsd]         portfolio value, for the share
 * @param {number} [input.now]
 */
export function planCopyTrade({
  chain,
  token,
  symbol = null,
  verified = null,
  tape = null,
  activity = null,
  whales = null,
  window = null,
  tokenIntel = null,
  volatilityPct = null,
  plannedUsd = null,
  bookUsd = null,
  now = Date.now()
} = {}) {
  const address = String(token || '').trim();
  const read = readSmartMoney({ verified, tape, activity, whales, window, now });

  /* ── the gates ────────────────────────────────────────────────────────────
     Ordered from "is this even a token" to "is this size sane". Each is
     independent, and the order is the order a reader would check them. */
  const href = swapDeepLink({
    chain,
    token: address,
    side: read.signal === 'DISTRIBUTION' ? 'SELL' : 'BUY'
  });

  const liquidity = num(tokenIntel?.liquidityUsd);
  const top10 = num(tokenIntel?.holders?.top10Share);
  const exchangeSupply = num(tokenIntel?.holders?.exchangeSupplyPct);
  const volume24 = num(tokenIntel?.volume?.h24);
  const buys = num(tokenIntel?.txns?.buys24);
  const sells = num(tokenIntel?.txns?.sells24);
  const vol = num(volatilityPct);
  const size = num(plannedUsd);
  const book = num(bookUsd);

  const gates = [
    gate('identity', href ? true : false, href ? null : 'unusable-address'),
    gate('evidence', read.measured ? true : false, read.measured ? read.basis : 'no-measured-source'),
    gate('direction', read.signal ? true : read.measured ? false : null, read.signal || null),
    gate('agreement', read.measured ? !read.conflict : null,
      read.measured ? (read.conflict ? 'planes-oppose' : read.agreement) : null),
    gate('freshness',
      read.freshnessMs === null ? null : read.freshnessMs <= MAX_EVIDENCE_AGE_MS,
      read.freshnessMs === null ? null : Math.round(read.freshnessMs / 60_000)),
    gate('liquidity', liquidity === null ? null : liquidity >= MIN_POOL_USD, liquidity),
    gate('concentration', top10 === null ? null : top10 <= MAX_TOP10_PCT, top10),
    gate('sizing',
      size === null ? null : (book === null ? true : size <= book * 0.2),
      size === null ? null : size)
  ];

  const measured = gates.filter((g) => g.pass !== null);
  const failed = gates.filter((g) => g.pass === false);
  const unmeasured = gates.filter((g) => g.pass === null);

  /* ── conviction: how much of the read's confidence survives the gates ───── */
  const gateRatio = gates.length ? (measured.filter((g) => g.pass === true).length / gates.length) : 0;
  const measuredRatio = gates.length ? measured.length / gates.length : 0;
  const base = read.confidence ?? 0;
  const agreement = read.agreement ?? (read.conflict ? 0 : 0.75);
  const conviction = read.measured
    ? Math.round(clamp(base * (0.45 + 0.35 * gateRatio + 0.20 * measuredRatio) * (0.6 + 0.4 * agreement), 0, 100))
    : 0;

  /* ── the action ─────────────────────────────────────────────────────────── */
  const evidencePassed = read.measured && !!read.signal && !read.conflict;
  const enoughMeasured = measured.filter((g) => g.pass === true).length >= MIN_MEASURED_GATES
    && gates.filter((g) => g.key === 'identity' && g.pass === true).length === 1;
  const action = evidencePassed && !failed.length && enoughMeasured
    ? (read.signal === 'ACCUMULATION' ? 'BUY' : 'SELL')
    : null;

  /* ── risk, only from measured numbers ─────────────────────────────────────
     The stop is where the observed volatility would have to keep running for
     the plan to be wrong beyond noise: 2× the measured move. The target is the
     mirror (3×), because a copy that risks 2 and aims at 2 is not a trade, it
     is a coin flip with fees. Both are null without a volatility reading. */
  const stopPct = vol === null ? null : round(clamp(vol * 2, 1.5, 25), 1);
  const targetPct = vol === null ? null : round(clamp(vol * 3, 2, 40), 1);
  const riskUsd = size !== null && stopPct !== null ? round((size * stopPct) / 100, 2) : null;
  const riskPctOfBook = riskUsd !== null && book ? round((riskUsd / book) * 100, 2) : null;
  const rewardUsd = size !== null && targetPct !== null ? round((size * targetPct) / 100, 2) : null;

  /* ── the tape's own balance, as context (never as a second signal) ──────── */
  const tapePressure = buys !== null && sells !== null && buys + sells > 0
    ? (buys > sells * 1.15 ? 'buy' : sells > buys * 1.15 ? 'sell' : 'balanced')
    : null;

  return {
    schema: 'fbt.copy-trade-plan.v1',
    chain: chain ?? null,
    token: address || null,
    symbol: symbol || null,
    at: now,
    /** The SAME read the signal card consumes — see `readForConsensus`. */
    read,
    action,
    followable: !!action,
    conviction,
    gates,
    failed: failed.map((g) => g.key),
    unmeasured: unmeasured.map((g) => g.key),
    sizing: {
      plannedUsd: size,
      bookUsd: book,
      sharePctOfBook: size !== null && book ? round((size / book) * 100, 2) : null,
      stopPct,
      targetPct,
      riskUsd,
      rewardUsd,
      riskPctOfBook,
      /* Reward per dollar risked, printed only when both sides are measured —
         an undefined R is worse than no R. */
      rewardToRisk: riskUsd !== null && rewardUsd !== null && riskUsd > 0
        ? round(rewardUsd / riskUsd, 2) : null
    },
    context: {
      liquidityUsd: liquidity,
      top10Share: top10,
      exchangeSupplyPct: exchangeSupply,
      volume24h: volume24,
      tapePressure,
      volatilityPct: vol
    },
    href,
    notes: [
      read.note,
      ...(failed.length ? ['blocked:' + failed.map((g) => g.key).join('+')] : []),
      ...(action ? [] : ['no-action'])
    ]
  };
}

/**
 * The label a surface may print, and nothing more.
 *
 * Kept here (not in the component) so all three copy-trade surfaces say the
 * same thing about the same plan, and so the honesty rule — an unmeasured or
 * blocked plan never gets an encouraging word — is one line that can be tested.
 */
export function planLabel(plan) {
  if (!plan) return { state: 'none', tone: 'muted', key: 'copyTrade.none' };
  if (!plan.read?.measured) return { state: 'unmeasured', tone: 'muted', key: 'copyTrade.noEvidence' };
  if (plan.read?.conflict) return { state: 'conflict', tone: 'warn', key: 'copyTrade.conflict' };
  if (!plan.action) return { state: 'blocked', tone: 'warn', key: 'copyTrade.blocked' };
  if (plan.conviction >= 70) return { state: 'strong', tone: 'up', key: 'copyTrade.strong' };
  if (plan.conviction >= 45) return { state: 'fair', tone: 'up', key: 'copyTrade.fair' };
  return { state: 'thin', tone: 'muted', key: 'copyTrade.thin' };
}

export default planCopyTrade;
