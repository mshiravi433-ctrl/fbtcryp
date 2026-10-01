/**
 * SMART MONEY → INTENT OS, THE MISSING CONNECTOR.
 * ---------------------------------------------------------------------------
 * Reported, verbatim: «اتصال اسمارت مانی به هوش مصنوعی Intent OS».
 *
 * Both halves of this already existed and were already tested:
 *
 *   · the evidence gate — `verifiedSignals` (src/lib/smartMoneyEvidence.js),
 *     ≥3 independent performance-qualified wallets on paired swaps;
 *   · the automation engine — `server/intentMonitoring.js`, which evaluates
 *     SMART_MONEY_BUYERS / SMART_MONEY_NET / SMART_MONEY_REVERSAL against
 *     that very index, and delivers a real push.
 *
 * What did NOT exist was the wire between them, and the gap was not a missing
 * feature so much as a MISSING ARGUMENT. Both server metrics require
 * `smartTarget: { chain, token }` — a concrete contract — and refuse a monitor
 * without one (`BAD_SM_TARGET`). The only thing that could have supplied it
 * was an opportunity card, so a Smart Money alert was reachable from exactly
 * one screen and from nowhere in conversation.
 *
 * Typing the obvious sentence proved it (reproduced in
 * test/smart-money-intent-monitor-probe.mjs):
 *
 *   «اگر اسمارت مانی اتریوم را انباشت کرد خبر بده»
 *     → smartMoneyWord ✓  walletWord ✗  so the wallet-analysis route misses
 *     → monitorIntent ✓   («خبر بده»)
 *     → parseMonitorRequest → NO_CONDITION
 *     → the chat answers «type a threshold instead»
 *
 * …while `smartMoneyAlertFromText` in smartMoneyAI.js, the function whose
 * docstring promises this exact sentence, built a phantom intent object that
 * nothing stored. It was also Persian-blind: its asset pattern is a Latin
 * ticker list, so «اتریوم» failed with BAD_ASSET — the one language this app
 * is actually used in.
 *
 * ─── WHAT THIS MODULE DOES, AND NOT ───────────────────────────────────────
 * It turns a sentence into a monitor DRAFT carrying a contract that is proven
 * to be under qualified-wallet observation. It never invents a contract: the
 * only address it will ever emit is one the live verified index already
 * names. If that index has nothing for the asset, this returns
 * `NO_VERIFIED_CONTRACT` and the caller says so — because a monitor pointed
 * at a guessed address is precisely the "wired to nothing" failure the engine
 * refuses to create.
 *
 * It never trades. A SMART_MONEY_* monitor is notify-only by construction
 * (server side: action is a push, there is no signing anywhere on this path).
 *
 * Pure: no network, no clock beyond an injected `now`. The probe drives the
 * whole thing, and the server's own `normalizeMonitor` is the acceptance test.
 */

import { verifiedSignals } from './smartMoneyEvidence.js';
import { resolveMonitorAsset } from './intent-ai/os/monitorClient.js';

/* ── vocabulary ─────────────────────────────────────────────────────────── */

/** The subject: who is being watched. Reuses the chat's own wording. */
const SUBJECT = /(اسمارت\s*مانی|اسمارت‌مانی|پول\s*هوشمند|نهنگ‌ها|نهنج‌ها|نهنگ|smart[\s-]*money|whales?)/i;

/** The instruction: be told when it happens. */
const NOTIFY = /(خبر\s*بده|خبردار|بهم\s*بگو|بگو|بگید|اطلاع\s*بده|اطلاع‌رسانی|اعلام\s*کن|هشدار\s*بده|بپای|پایش\s*کن|پایش|نظارت\s*کن|دنبال\s*کن|ردیابی\s*کن|let\s*me\s*know|tell\s*me|notify|alert|watch|monitor|follow)/i;

/** Direction of the flow the user wants to hear about. */
const ACCUMULATE = /(انباشت|انباشته|انبار|خرید|خردار|خردارن|می‌خرن|میخرن|می‌خرند|خریدن|ورود|accumulat|buying|\bbuy\b|pumping|در حال خرید)/i;
const DISTRIBUTE = /(توزیع|توزیع‌شده|فروش|فروشند|فروشنده|می‌فروشن|میفروشن|خروج|دامپ|dump|distribut|selling|\bsell\b|sold)/i;
const REVERSAL = /(برعکس|معکوس|چرخش|تغییر\s*جهت|برگشت\s*روند|ریورس|reversal|reverses|flip|turns?)/i;

/** A definition question is never an automation. */
const DEFINITION = /(چیست|چیه|چه\s*کار\s*می‌کند|چطور\s*کار\s*می‌کند|معنی|تعریف|what\s*is|how\s*does\s*it\s*work|meaning|define)/i;

/** The server's own floors, restated so a refusal here is a refusal there. */
const SM_CHAINS = new Set([1, 56, 137, 42161, 8453, 10, 43114]);
const SM_ADDRESS = /^0x[a-f0-9]{40}$/;

/**
 * The asset the user NAMES and the asset the index RECORDS are often the same
 * thing wearing different tickers, and the first version of this file silently
 * missed the most important case in the product: the user says «اتریوم» —
 * which every price feed in the app resolves to `ETH` — while the verified
 * consensus rows carry the CONTRACT's own symbol, `WETH`. Matching on the
 * literal string made «اگر اسمارت مانی اتریوم را انباشت کرد خبر بده» fail with
 * NO_VERIFIED_CONTRACT even though ETH was under qualified-wallet observation
 * at that very moment. Wrapped/staked pairs are folded to one canonical base.
 *
 * An explicit table, not a `W`-stripping rule: a bare heuristic would merge
 * real, distinct tickers.
 */
const CANONICAL = Object.freeze({
  WETH: 'ETH', STETH: 'ETH', WSTETH: 'ETH', ETH: 'ETH', EETH: 'ETH',
  WBTC: 'BTC', 'CBBTC': 'BTC', BTC: 'BTC',
  WSOL: 'SOL', SOL: 'SOL',
  WBNB: 'BNB', BNB: 'BNB',
  WAVAX: 'AVAX', AVAX: 'AVAX',
  WMATIC: 'POL', POL: 'POL', MATIC: 'POL',
  USDT: 'USDT', USDC: 'USDC', DAI: 'DAI'
});

/** Fold a ticker to the base asset it represents. */
export function canonicalSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  return CANONICAL[s] || s;
}

/**
 * Words that are part of the INSTRUCTION, never the asset. Without this a
 * sentence could be read as naming a token called "ALERT" or "WATCH" if the
 * index ever carried one.
 */
const STOPWORDS = new Set(['IF', 'WHEN', 'TELL', 'ME', 'US', 'NOTIFY', 'NOTIFICATION', 'ALERT', 'ALERTS',
  'WATCH', 'MONITOR', 'FOLLOW', 'SMART', 'MONEY', 'WHALE', 'WHALES', 'ACCUMULATES', 'ACCUMULATION',
  'DISTRIBUTES', 'DISTRIBUTION', 'REVERSAL', 'REVERSES', 'BUY', 'BUYING', 'SELL', 'SELLING',
  'THE', 'ON', 'IN', 'A', 'AN', 'AND', 'OR', 'TO', 'OF', 'IS', 'FOR', 'AND', 'LET', 'KNOW',
  'BUYERS', 'SELLERS', 'NET', 'FLOW', 'PRICE', 'USD', 'NOW']);

/**
 * Resolve the asset FROM THE INDEX when the hint table does not know it.
 *
 * This is not a convenience — it is the only way the feature works at all for
 * its own subject matter. The hint table in monitorClient.js covers majors
 * (BTC, ETH, SOL…), but the live verified index on the day this was written
 * held ONDO, AAVE, PEPE, PENDLE, ARB, LINK, UNI, LDO, GALA, AERO, JUP: precisely
 * the tokens the Smart Money page exists to surface, and none of which the
 * user could name in a sentence. «اگر اسمارت مانی AAVE را انباشت کرد خبر بده»
 * answered NO_ASSET while AAVE was under qualified-wallet observation at that
 * moment.
 *
 * The index is the better authority anyway: it is the list of contracts that
 * are actually being watched, so a ticker it names is one the user can
 * genuinely be alerted about. Only Latin tickers can match here — a Persian
 * sentence names these alt coins by their ticker anyway.
 *
 * @returns {{symbol:string}|{error:'NO_ASSET'|'AMBIGUOUS_CONTRACT'}}
 */
export function resolveSymbolFromIndex(text, verified, { now = Date.now(), window = null } = {}) {
  const gate = verifiedSignals(verified || null, { now, window });
  if (!gate.rows.length) return { error: 'NO_ASSET' };
  /* symbol → canonical base, so ONDO matches ONDO and WETH answers to ETH. */
  const byBase = new Map();
  for (const r of gate.rows) {
    const sym = String(r.symbol || '').toUpperCase();
    if (sym) byBase.set(canonicalSymbol(sym), sym);
  }
  const words = String(text || '').match(/[A-Za-z][A-Za-z0-9]{1,11}/g) || [];
  const hits = [];
  for (const w of words) {
    const up = w.toUpperCase();
    if (STOPWORDS.has(up) || !/^[A-Z][A-Z0-9]{1,11}$/.test(up)) continue;
    const base = canonicalSymbol(up);
    if (!byBase.has(base) || hits.includes(base)) continue;
    hits.push(base);
  }
  if (hits.length === 0) return { error: 'NO_ASSET' };
  if (hits.length > 1) {
    return {
      error: 'AMBIGUOUS_CONTRACT',
      candidates: hits.map((b) => ({ chain: gate.rows.find((r) => canonicalSymbol(r.symbol) === b).chain,
        token: gate.rows.find((r) => canonicalSymbol(r.symbol) === b).token,
        symbol: byBase.get(b) }))
    };
  }
  return { symbol: byBase.get(hits[0]) };
}

export const MIN_INDEPENDENT_BUYERS = 3;
/** Same default the opportunity card uses, so both routes agree. */
export const DEFAULT_DISTRIBUTION_USD = -3_000_000;
export const DEFAULT_REVERSAL_FROM_USD = 5_000_000;
export const DEFAULT_REVERSAL_TO_USD = DEFAULT_DISTRIBUTION_USD;

const numFrom = (m) => {
  if (!m) return null;
  const fa = String(m).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const n = parseFloat(fa.replace(/[kK,]/g, ''));
  if (!Number.isFinite(n)) return null;
  return /[kK]/.test(String(m)) ? n * 1000 : n;
};

/** «هر ۳۰ دقیقه» / «every 2 hours» — snapped to the server's allowed intervals. */
function parseInterval(raw, fallback = 30) {
  const m = String(raw).match(/(?:هر|every|each)\s*(\d+)?\s*(دقیقه|ساعت|روز|min(?:ute)?s?|hours?|days?)/i);
  if (!m) return fallback;
  const n = Number(m[1] || 1);
  const minutes = /ساعت|hour/i.test(m[0]) ? n * 60 : /روز|day/i.test(m[0]) ? n * 1440 : n;
  return [5, 15, 30, 60, 180, 360, 720, 1440].includes(minutes)
    ? minutes
    : (minutes <= 5 ? 5 : minutes <= 15 ? 15 : minutes <= 60 ? 60 : minutes <= 180 ? 180 : 360);
}

/**
 * Find the ONE verified contract this request is about.
 *
 * The verified index is the only admissible source: it is the same snapshot
 * the server re-reads when it evaluates, so a monitor created from it is
 * watching the identical evidence. When the asset appears on more than one
 * chain the request is ambiguous, and guessing would silently bind the alert
 * to the wrong contract — so the caller is told to pick.
 */
export function resolveVerifiedTarget({ symbol, verified, now = Date.now(), window = null } = {}) {
  const want = String(symbol || '').trim().toUpperCase();
  if (!want) return { error: 'NO_ASSET' };
  const gate = verifiedSignals(verified || null, { now, window });
  const base = canonicalSymbol(want);
  /* An exact ticker beats a wrapped match: if the index really does name
     `ETH` for one contract and `WETH` for another, «اتریوم» is the former. */
  const exact = gate.rows.filter((r) => String(r.symbol || '').toUpperCase() === want);
  const rows = exact.length
    ? exact
    : gate.rows.filter((r) => canonicalSymbol(r.symbol) === base);
  if (rows.length === 0) {
    return {
      error: 'NO_VERIFIED_CONTRACT',
      dataStatus: gate.dataStatus,
      observed: [...new Set(gate.rows.map((r) => String(r.symbol || '').toUpperCase()))]
    };
  }
  if (rows.length > 1) {
    return {
      error: 'AMBIGUOUS_CONTRACT',
      candidates: rows.map((r) => ({ chain: Number(r.chain), token: r.token, symbol: r.symbol, signal: r.signal }))
    };
  }
  const r = rows[0];
  if (!SM_CHAINS.has(Number(r.chain)) || !SM_ADDRESS.test(String(r.token || '').toLowerCase())) {
    /* Verified rows are EVM-only by construction; anything else is refused
       rather than coerced onto chain 1. */
    return { error: 'UNSUPPORTED_CHAIN' };
  }
  return { row: r, chain: Number(r.chain), token: String(r.token).toLowerCase(), symbol: r.symbol, signal: r.signal };
}

/**
 * Parse a Smart Money watch request into a REAL Intent OS monitor draft.
 *
 * @param {string} text
 * @param {object} opts
 * @param {*}      opts.verified  body of GET /api/v1/smart-money/intelligence
 * @param {number} [opts.now]
 * @param {string} [opts.locale]
 * @param {number} [opts.window] evidence window the monitor will be judged in
 * @returns {{monitor: object, evidence: object}|{error: string, ...}}
 */
export function parseSmartMoneyMonitorRequest(text, { verified = null, now = Date.now(), locale = 'fa', window = null } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'EMPTY' };
  if (DEFINITION.test(raw)) return { error: 'DEFINITION_QUESTION' };
  if (!SUBJECT.test(raw)) return { error: 'NOT_SMART_MONEY' };
  if (!NOTIFY.test(raw)) return { error: 'NO_NOTIFY' };

  /* Asset resolution, in order of authority:
       1. the shared hint table — it knows «اتریوم» → ETH, which no index can;
       2. the verified index itself — the only way ONDO/AAVE/PEPE (the tokens
          this feature actually monitors) can be named at all.
     Whatever it resolves to must then survive the evidence gate below. */
  const hinted = resolveMonitorAsset(raw);
  const indexed = resolveSymbolFromIndex(raw, verified, { now, window });
  /* The index resolver can itself report ambiguity, and that must reach the
     user as ambiguity. Collapsing it into NO_ASSET told someone naming two
     observed tokens that the assistant had simply not understood them. */
  if (!hinted && indexed.error === 'AMBIGUOUS_CONTRACT') return indexed;
  const symbol = hinted || indexed.symbol || null;
  if (!symbol) return { error: 'NO_ASSET' };

  const target = resolveVerifiedTarget({ symbol, verified, now, window });
  if (target.error) return target;

  /* Direction. Reversal wins over a bare flow word: «وقتی برعکس شد» is a
     stricter request than «وقتی انباشت کرد» and describes a two-point move. */
  const reversal = REVERSAL.test(raw);
  const distribution = !reversal && DISTRIBUTE.test(raw);
  const accumulation = !reversal && !distribution;
  const usd = numFrom(raw.match(/([0-9۰-۹.,]+)\s*(k|m|م|میلیون|هزار)?/i)?.[0]);
  const magnitude = usd != null && Math.abs(usd) >= 1000 ? Math.abs(usd) : null;
  const intervalMinutes = parseInterval(raw, 30);

  const base = {
    type: 'ASSET',
    asset: { symbol },
    smartTarget: { chain: target.chain, token: target.token },
    intervalMinutes,
    locale
  };

  if (reversal) {
    return {
      monitor: {
        ...base,
        metric: 'SMART_MONEY_REVERSAL',
        operator: 'ABOVE',
        threshold: 1,
        reversal: {
          fromUsd: magnitude ?? DEFAULT_REVERSAL_FROM_USD,
          toUsd: distribution ? (magnitude ? -magnitude : DEFAULT_REVERSAL_TO_USD) : DEFAULT_REVERSAL_TO_USD
        },
        label: `${symbol} · verified smart-money netflow turns negative`
      },
      evidence: { chain: target.chain, token: target.token, signal: target.signal, symbol, netFlowUsd: target.row.netFlowUsd, independentBuyers: target.row.independentBuyers, swaps: target.row.swaps, confidence: target.row.confidence }
    };
  }

  if (distribution) {
    const threshold = magnitude ? -magnitude : DEFAULT_DISTRIBUTION_USD;
    return {
      monitor: {
        ...base,
        metric: 'SMART_MONEY_NET',
        operator: 'BELOW',
        threshold,
        label: `${symbol} · verified smart-money netflow ≤ $${Math.abs(threshold).toLocaleString('en-US')}`
      },
      evidence: { chain: target.chain, token: target.token, signal: target.signal, symbol, netFlowUsd: target.row.netFlowUsd, independentBuyers: target.row.independentBuyers, swaps: target.row.swaps, confidence: target.row.confidence }
    };
  }

  return {
    monitor: {
      ...base,
      metric: 'SMART_MONEY_BUYERS',
      operator: 'ABOVE',
      threshold: MIN_INDEPENDENT_BUYERS,
      label: `${symbol} · ≥${MIN_INDEPENDENT_BUYERS} independent qualified buyers / 30m`
    },
    evidence: { chain: target.chain, token: target.token, signal: target.signal, symbol, netFlowUsd: target.row.netFlowUsd, independentBuyers: target.row.independentBuyers, swaps: target.row.swaps, confidence: target.row.confidence }
  };
}

/** True when this sentence is a Smart Money watch request at all. */
export function isSmartMoneyWatchText(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return SUBJECT.test(raw) && NOTIFY.test(raw) && !DEFINITION.test(raw);
}

export const SMART_MONEY_WATCH_ERRORS = Object.freeze({
  EMPTY: 'EMPTY',
  DEFINITION_QUESTION: 'DEFINITION_QUESTION',
  NOT_SMART_MONEY: 'NOT_SMART_MONEY',
  NO_NOTIFY: 'NO_NOTIFY',
  NO_ASSET: 'NO_ASSET',
  NO_VERIFIED_CONTRACT: 'NO_VERIFIED_CONTRACT',
  AMBIGUOUS_CONTRACT: 'AMBIGUOUS_CONTRACT',
  UNSUPPORTED_CHAIN: 'UNSUPPORTED_CHAIN'
});
