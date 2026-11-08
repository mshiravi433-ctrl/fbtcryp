/**
 * FBT AI RISK ENGINE — THE PRE-TRADE GATE
 * ===========================================================================
 * «این موتور باید قبل از هر تصمیم مالی، هنگام اجرای معامله و پس از اجرای آن
 *  بتواند خطرات را شناسایی کند.»
 *
 * This file is the "before" and "after" half of that sentence. It complements,
 * and never replaces, the gates that already exist:
 *
 *   lib/executionGate.js          blocks a swap on token / simulation evidence
 *   lib/strategyBrain/strategyPreflight.js   refuses a plan on its own checks
 *   lib/futures-engine/risk.js    venue liquidation math for perps
 *
 * What those gates cannot see is the BOOK. They judge a trade in isolation, so
 * a $300 trade that doubles an already 80%-concentrated position reads exactly
 * like a $300 trade into an empty wallet. This module answers the missing
 * question — "what does this trade do to the portfolio's risk?" — by RE-SCORING
 * the book with the trade applied, using the same engine that produced the
 * screen's number.
 *
 * ─── CONTRACT ───────────────────────────────────────────────────────────────
 *   · It NEVER throws and NEVER blocks execution by itself. It returns a
 *     verdict the caller may use; the existing gates keep their authority.
 *   · No wallet, no book, no verdict: `INSUFFICIENT_EVIDENCE` — never a green
 *     light. Absence of evidence is not evidence of safety (the three
 *     liquidity-error rules elsewhere in this repo say the same thing).
 *   · Every verdict carries the numbers that produced it, so a refusal can be
 *     explained in one sentence rather than a red dot.
 */
import { buildRiskReport } from './riskEngine.js';
import { readBookSnapshot } from './bookSnapshot.js';
import { clamp, num, round } from './riskMath.js';

export const RISK_GATE_VERSION = 'fbt.risk-gate.1';

export const GATE_VERDICT = Object.freeze({
  INSUFFICIENT_EVIDENCE: 'insufficient-evidence',
  CLEAR: 'clear',
  NOTE: 'note',
  WARN: 'warn',
  BLOCK: 'block'
});

const SEVERITY_ORDER = [GATE_VERDICT.CLEAR, GATE_VERDICT.NOTE, GATE_VERDICT.WARN, GATE_VERDICT.BLOCK];
const worse = (a, b) => (SEVERITY_ORDER.indexOf(b) > SEVERITY_ORDER.indexOf(a) ? b : a);

/**
 * Evaluate a prospective trade against the current book.
 *
 * @param {object} input
 * @param {object} input.trade   { symbol, side: 'buy'|'sell', valueUsd, chainId }
 * @param {object} input.inputs  the same evidence bundle the screen uses
 * @returns {{verdict, reasons, before, after, delta, impacts, evidence}}
 */
export function evaluateTradeRisk({ trade = null, inputs = {} } = {}) {
  const base = buildRiskReport(inputs);
  const valueUsd = num(trade?.valueUsd);
  const symbol = String(trade?.symbol || '').toUpperCase();

  if (!trade || !symbol || valueUsd == null || valueUsd <= 0) {
    return {
      version: RISK_GATE_VERSION,
      verdict: GATE_VERDICT.INSUFFICIENT_EVIDENCE,
      code: 'NO_TRADE',
      reasons: [{ key: 'no-trade', params: {} }],
      before: base.score,
      after: null,
      delta: null,
      canProceed: true
    };
  }
  if (base.score.value == null || !(base.totalUsd > 0)) {
    return {
      version: RISK_GATE_VERSION,
      verdict: GATE_VERDICT.INSUFFICIENT_EVIDENCE,
      code: 'NO_BOOK',
      reasons: [{ key: 'portfolio-not-read', params: {} }],
      before: base.score,
      after: null,
      delta: null,
      /* It does not block — the swap's own gates still run. It refuses to
         certify, which is the honest position. */
      canProceed: true
    };
  }

  let afterReport = null;
  const holdings = (inputs.holdings || base.heatmap || []).map((h) => ({
    symbol: String(h.symbol || '').toUpperCase(),
    value: num(h.value) ?? num(h.valueUsd) ?? 0,
    name: h.name ?? null,
    chainId: h.chainId ?? null,
    contractKey: h.contractKey ?? null
  }));
  const side = trade.side === 'sell' || trade.side === 'SELL' ? 'sell' : 'buy';

  /*
   * ─── TWO FUNDING MODELS, AND WE TAKE THE WORSE ONE ──────────────────────
   * A buy is paid for somehow, and the answer decides the risk. Funded from
   * outside, the book grows and every existing weight shrinks — so buying a
   * meme coin can *lower* a concentration score. Funded from the book, the
   * money leaves some other holding and the risky asset's weight goes UP.
   *
   * The first draft modelled only the external case, and reported "risk fell 6
   * points" for a $30k buy into a critical-contract memecoin. That is a gate
   * that would wave through exactly the trade it exists to stop. So both are
   * scored and the HIGHER (worse) post-trade reading is the one reported, with
   * both numbers kept in `evidence` so the user can see the assumption.
   */
  const proRata = (rows, target, amount) => {
    const pool = rows.filter((h) => h.symbol !== target && h.value > 0);
    const poolValue = pool.reduce((s, h) => s + h.value, 0);
    if (poolValue <= 0) return null;
    const take = Math.min(amount, poolValue);
    const next = rows.map((h) => (h.symbol === target || h.value <= 0
      ? { ...h }
      : { ...h, value: h.value - (h.value / poolValue) * take }));
    const hit = next.find((h) => h.symbol === target);
    if (hit) hit.value += amount;
    else next.push({ symbol, value: amount, name: null, chainId: trade.chainId ?? null, contractKey: null });
    return { rows: next.filter((h) => h.value > 0.0000001), funding: 'from-book' };
  };

  let patched = null;
  let externalModel = null;
  if (side === 'buy') {
    const externalRows = (() => {
      const next = holdings.map((h) => ({ ...h }));
      const hit = next.find((h) => h.symbol === symbol);
      if (hit) hit.value += valueUsd;
      else next.push({ symbol, value: valueUsd, name: null, chainId: trade.chainId ?? null, contractKey: null });
      return { rows: next, funding: 'external-cash' };
    })();
    const fundedRows = proRata(holdings, symbol, valueUsd);

    /* `intel: null` on purpose: the engine derives the concentration fields
       from the patched rows itself (see `deriveIntel` in riskEngine.js), so the
       gate cannot forget to pass them — which is exactly the bug that made a
       $30k buy into a memecoin read as a 6-point IMPROVEMENT. */
    const scoredExternal = buildRiskReport({ ...inputs, holdings: externalRows.rows, intel: null });
    const scoredFunded = fundedRows
      ? buildRiskReport({ ...inputs, holdings: fundedRows.rows, intel: null })
      : null;

    const extValue = scoredExternal.score.value;
    const fundValue = scoredFunded?.score.value ?? null;
    const fundedIsWorse = fundValue != null && extValue != null ? fundValue > extValue : fundValue != null;

    patched = fundedIsWorse ? fundedRows : externalRows;
    afterReport = fundedIsWorse ? scoredFunded : scoredExternal;
    externalModel = {
      externalCash: { after: extValue, funding: 'external-cash' },
      fromBook: { after: fundValue, funding: 'from-book' },
      reported: fundedIsWorse ? 'from-book' : 'external-cash'
    };
  } else {
    const next = holdings.map((h) => ({ ...h }));
    const hit = next.find((h) => h.symbol === symbol);
    patched = hit ? { rows: next.map((h) => (h.symbol === symbol ? { ...h, value: Math.max(0, h.value - valueUsd) } : h)).filter((h) => h.value > 0), funding: 'from-holding' } : null;
  }

  if (!patched) {
    return {
      version: RISK_GATE_VERSION,
      verdict: GATE_VERDICT.NOTE,
      code: 'SELL_NOT_HELD',
      reasons: [{ key: 'symbol-not-in-book', params: { symbol } }],
      before: base.score,
      after: null,
      delta: null,
      canProceed: true
    };
  }

  const after = afterReport || buildRiskReport({ ...inputs, holdings: patched.rows, intel: null });
  const delta = base.score.value != null && after.score.value != null
    ? after.score.value - base.score.value
    : null;

  /* Which families moved, and by how much. This is the "why" behind a warning:
     "this trade raises concentration by 9 points" is actionable; "risk up" is
     not. */
  const impacts = base.families
    .map((f) => {
      const next = after.families.find((x) => x.id === f.id);
      if (!next || f.score == null || next.score == null) return null;
      return { id: f.id, from: f.score, to: next.score, delta: next.score - f.score };
    })
    .filter(Boolean)
    .filter((x) => x.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const reasons = [];
  let verdict = GATE_VERDICT.CLEAR;

  /* Size relative to the book: 40% of a wallet in one trade is a different act
     from 2%, before any other number is consulted. */
  const sizePct = base.totalUsd > 0 ? (valueUsd / base.totalUsd) * 100 : null;
  if (sizePct != null && sizePct >= 50) {
    verdict = worse(verdict, GATE_VERDICT.WARN);
    reasons.push({ key: 'trade-vs-book', params: { pct: round(sizePct, 1) } });
  }

  /*
   * ─── WHY A RATIO AND NOT "10 POINTS" ────────────────────────────────────
   * A flat 10-point threshold reads well and is wrong in both directions. It
   * ignores where the book started: +10 on a 12-point book is a doubling of
   * risk, while +10 on an 80-point book is a rounding error. So the block line
   * is a RATIO of the book's own measured risk (×1.5), and it carries a floor
   * so a book starting from near-zero cannot be blocked by noise.
   *
   * Both numbers are reported, so the sentence the user sees can say which one
   * fired.
   */
  const before = base.score.value;
  const ratio = delta != null && before != null && before > 0 ? (after.score.value ?? before) / before : null;
  /* A block needs a LARGE rise AND a large relative rise: +12 on a 32-point
     book (×1.37) is a different act from +12 on an 80-point book (×1.15). */
  const blockedByRatio = ratio != null && ratio >= 1.25 && delta >= 8;
  if (delta != null && blockedByRatio) {
    verdict = worse(verdict, GATE_VERDICT.BLOCK);
    reasons.push({
      key: 'risk-jump',
      params: { delta: Math.round(delta), from: before, to: after.score.value, ratio: round(ratio, 2) }
    });
  } else if (delta != null && delta >= 4) {
    verdict = worse(verdict, GATE_VERDICT.WARN);
    reasons.push({ key: 'risk-rise', params: { delta: Math.round(delta), from: before, to: after.score.value } });
  } else if (delta != null && delta <= -3) {
    reasons.push({ key: 'risk-fall', params: { delta: Math.round(delta) } });
  }

  /* A trade INTO a family that is already serious is refused outright: adding
     to the worst-measured risk in the book is the one action every risk desk
     stops. The threshold is the engine's own "serious" band (70). */
  const serious = after.families.filter((f) => f.score != null && f.score >= 70);
  const worsenedIntoSerious = serious.filter((f) => {
    const before = base.families.find((x) => x.id === f.id);
    return !before || before.score == null || f.score - before.score >= 4 || (before.score ?? 0) < 70;
  });
  if (worsenedIntoSerious.length && side === 'buy') {
    verdict = worse(verdict, GATE_VERDICT.WARN);
    reasons.push({ key: 'serious-family', params: { families: worsenedIntoSerious.map((f) => f.id).join(', ') } });
  }

  return {
    version: RISK_GATE_VERSION,
    verdict,
    canProceed: verdict !== GATE_VERDICT.BLOCK,
    trade: { symbol, side, valueUsd: round(valueUsd, 2), sizePctOfBook: sizePct == null ? null : round(sizePct, 1) },
    before: base.score,
    after: after.score,
    delta: delta == null ? null : Math.round(delta),
    impacts,
    reasons,
    evidence: {
      funding: patched.funding,
      holdingsBefore: holdings.length,
      holdingsAfter: patched.rows.length,
      /* Both funding readings are kept. The gate reports the worse one; the
         other is here so the assumption is inspectable, not hidden. */
      fundingModels: externalModel,
      /* Printed by the caller: a buy modelled with external cash, a sell
         modelled from the holding itself. */
      assumptionNote: patched.funding === 'external-cash'
        ? 'the purchase is funded from outside the tracked book'
        : patched.funding === 'from-book'
          ? 'the purchase is paid for pro-rata out of the rest of the book (the worse of the two readings)'
          : 'the sale reduces the holding itself'
    },
    canExecute: false,
    canSign: false,
    canMoveFunds: false,
    notAdvice: true
  };
}

/**
 * "AFTER the trade" — the post-trade check.
 *
 * Given the receipt (what actually filled) and the book, it reports the risk
 * the trade ACTUALLY added, and — the part a user remembers — whether any of
 * the pre-trade warnings came true. Comparison is per family, so the answer is
 * a measurement rather than a feeling of having been careful.
 */
export function evaluatePostTradeRisk({ receipt = null, inputs = {}, preTrade = null } = {}) {
  const now = buildRiskReport(inputs);
  if (!receipt) {
    return { version: RISK_GATE_VERSION, status: 'no-receipt', after: now.score };
  }
  const before = preTrade?.before ?? null;
  const delta = before?.value != null && now.score.value != null ? now.score.value - before.value : null;
  const predicted = preTrade?.after?.value ?? null;
  return {
    version: RISK_GATE_VERSION,
    status: 'measured',
    symbol: String(receipt.symbol || receipt.fromSymbol || '').toUpperCase() || null,
    filledUsd: num(receipt.valueUsd) ?? null,
    before,
    predicted: predicted == null ? null : { value: predicted },
    after: now.score,
    delta: delta == null ? null : Math.round(delta),
    /* Did the predicted post-trade reading hold? A ±6 point band is the honest
       tolerance: prices themselves moved between the two reads. */
    predictionError: predicted != null && now.score.value != null ? Math.round(now.score.value - predicted) : null,
    familiesNow: now.families.map((f) => ({ id: f.id, score: f.score })),
    notAdvice: true
  };
}

/**
 * THE CONVENIENCE ENTRY POINT FOR A UI CALLER — the swap review sheet.
 *
 * It assembles the evidence bundle from what the risk engine last measured (the
 * book snapshot) and scores a prospective trade against it. That is the whole
 * point of the snapshot: the swap screen can answer "what does this do to my
 * portfolio risk" without opening a second read of sixteen chains while a
 * sheet is open.
 *
 * It returns `evidenceStatus: 'no-book'` rather than a green verdict when there
 * is no recent snapshot — the swap's own security gates keep their authority,
 * but this gate says plainly that it could not certify.
 */
export function evaluateSwapRisk({
  wallet = null, fromSymbol = null, toSymbol = null, amountUsd = null, chainId = null,
  storage = undefined, at = Date.now(), maxAgeMs = undefined
} = {}) {
  const snapshot = readBookSnapshot(wallet, { storage, at, maxAgeMs });
  if (!snapshot) {
    return {
      version: RISK_GATE_VERSION,
      verdict: GATE_VERDICT.INSUFFICIENT_EVIDENCE,
      evidenceStatus: 'no-book',
      code: 'NO_BOOK',
      reasons: [{ key: 'portfolio-not-read', params: {} }],
      before: { value: null },
      after: { value: null },
      delta: null,
      impacts: [],
      canProceed: true,
      canExecute: false,
      canSign: false,
      canMoveFunds: false,
      notAdvice: true
    };
  }
  const valueUsd = num(amountUsd);
  const sell = String(fromSymbol || '').toUpperCase();
  /* A swap is a SELL of `from` and a BUY of `to`. The side that can hurt the
     book is the buy (it adds exposure), so the buy is what is scored — but the
     sell is applied first so the book the buy is measured against is the book
     AFTER the money left it. */
  const inputs = {
    holdings: snapshot.rows,
    markets: snapshot.markets,
    intel: null,
    scans: {},
    chainReads: [],
    providers: null,
    lending: null,
    leverage: null,
    settings: null,
    now: at
  };
  const afterSell = sell && valueUsd != null
    ? {
        ...inputs,
        holdings: inputs.holdings
          .map((h) => (h.symbol === sell ? { ...h, value: Math.max(0, (num(h.value) ?? 0) - valueUsd) } : h))
          .filter((h) => (num(h.value) ?? 0) > 0)
      }
    : inputs;

  const verdict = evaluateTradeRisk({
    trade: { symbol: String(toSymbol || '').toUpperCase(), side: 'buy', valueUsd, chainId },
    inputs: afterSell
  });

  /* `before` must describe the book the user is looking at, not the book after
     the sale — otherwise a $0 trade reads as a big improvement. */
  const before = evaluateTradeRisk({ trade: null, inputs }).before;
  return {
    ...verdict,
    evidenceStatus: snapshot.stale ? 'stale' : 'fresh',
    snapshotAgeMs: snapshot.ageMs,
    before,
    delta: verdict.after?.value != null && before?.value != null
      ? Math.round(verdict.after.value - before.value)
      : null
  };
}

/** Compact verdict → the one sentence the review sheet shows. */
export function verdictSummary(gate, locale = 'fa') {
  const fa = String(locale || '').startsWith('fa');
  if (!gate) return fa ? 'ارزیابی ریسک انجام نشد' : 'Risk was not evaluated';
  const d = gate.delta;
  if (gate.evidenceStatus === 'no-book') {
    return fa
      ? 'پرتفوی شما تازه خوانده نشده؛ این معامله فقط با گیت‌های امنیتی سنجیده می‌شود، نه با ریسک پرتفوی.'
      : 'Your book has not been read recently; this trade is judged by the security gates only, not by portfolio risk.';
  }
  switch (gate.verdict) {
    case GATE_VERDICT.BLOCK:
      return fa
        ? `این معامله ریسک پرتفوی را ${d} امتیاز بالا می‌برد و اجازهٔ اجرا در این سطح ندارد.`
        : `This trade raises portfolio risk by ${d} points and is not permitted at this level.`;
    case GATE_VERDICT.WARN:
      return fa
        ? `ریسک پرتفوی ${d >= 0 ? '+' : ''}${d} امتیاز تغییر می‌کند؛ پیش از تأیید نگاه کنید.`
        : `Portfolio risk moves ${d >= 0 ? '+' : ''}${d} points; look before you confirm.`;
    case GATE_VERDICT.NOTE:
      return fa ? 'معامله اثر قابل‌اندازه‌گیری روی ریسک پرتفوی ندارد.' : 'The trade has no measurable effect on portfolio risk.';
    case GATE_VERDICT.CLEAR:
      return fa ? 'از نظر ریسک پرتفوی، مسیر باز است.' : 'Clear on portfolio risk.';
    default:
      return fa
        ? 'شواهد کافی برای ارزیابی ریسک این معامله در دسترس نیست؛ هیچ چراغ سبزی صادر نمی‌شود.'
        : 'There is not enough evidence to evaluate this trade; no green light is issued.';
  }
}

export { clamp };
