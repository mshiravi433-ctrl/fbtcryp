/**
 * CROSS-CHAIN — THE ONE ENGINE.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * Before this module the app had TWO cross-chain systems that had never met:
 *
 *   1. /bridge — a real LI.FI proxy (server/bridge.js) that quoted, itemised
 *      fees and handed a signable transaction to the wallet.
 *   2. Intent OS → «میان‌زنجیره‌ای» — which called
 *      /api/intents/v1/bridge-quote, and that endpoint returned a HARD-CODED
 *      object: `estimatedOutput: '999000'`, `fee: '1000'`, `estimatedTime: 120`.
 *      A number that never touched a bridge, rendered as "نرخ پل".
 *
 * Two engines means two truths, and one of them was invented. This file is the
 * single normalisation / ranking / status engine that both sides now import —
 * the server (server/crossChain.js) and the browser
 * (src/services/cross-chain/client.js) run the SAME code on the SAME shapes,
 * so a quote cannot mean one thing in Intent OS and another on /bridge.
 *
 * ─── THE RULES BAKED IN HERE ────────────────────────────────────────────────
 * · No provider response, no quote. Every number below is derived from a LI.FI
 *   payload; nothing has a default that could be mistaken for a rate.
 * · Every quote expires. A rate with no expiry is a lie with a long fuse.
 * · COMPLETED requires a destination transaction hash. A confirmed source tx
 *   is not an arrival, and calling it one is the single most damaging lie a
 *   bridge UI can tell.
 */

/* ── schemas ─────────────────────────────────────────────────────────────── */

export const CROSS_CHAIN_QUOTE_SCHEMA = 'fbt.cross-chain-quote.v1';
export const CROSS_CHAIN_ROUTE_SCHEMA = 'fbt.cross-chain-route.v1';
export const CROSS_CHAIN_TX_SCHEMA = 'fbt.cross-chain-transaction.v1';
export const CROSS_CHAIN_INTENT_SCHEMA = 'fbt.cross-chain-intent.v1';

/**
 * How long a quote is honoured before the UI must re-ask.
 *
 * LI.FI does not return a TTL, so inventing a long one would be pretending to
 * know something we do not. 60s is short enough that the number on screen is
 * still roughly true and long enough to read the fee breakdown and tap once.
 */
export const QUOTE_TTL_MS = 60_000;

/* ── execution status — the real lifecycle, no decorative states ─────────── */

export const EXECUTION_STATUS = Object.freeze({
  QUOTED: 'QUOTED',
  AWAITING_SIGNATURE: 'AWAITING_SIGNATURE',
  SIGNED: 'SIGNED',
  SUBMITTED: 'SUBMITTED',
  BRIDGING: 'BRIDGING',
  DESTINATION_PENDING: 'DESTINATION_PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
});

export const EXECUTION_STATUS_ORDER = Object.freeze([
  'QUOTED',
  'AWAITING_SIGNATURE',
  'SIGNED',
  'SUBMITTED',
  'BRIDGING',
  'DESTINATION_PENDING',
  'COMPLETED',
  'FAILED'
]);

/** Terminal states: nothing may move out of these. */
export const TERMINAL_STATUS = Object.freeze(new Set(['COMPLETED', 'FAILED']));

/**
 * Legal transitions.
 *
 * A state machine rather than "set whatever the client sent". The client is a
 * browser: if it could post COMPLETED, then COMPLETED means nothing, and the
 * history a user reads back would be a list of the app's own optimism.
 */
const TRANSITIONS = Object.freeze({
  QUOTED: ['AWAITING_SIGNATURE', 'FAILED'],
  AWAITING_SIGNATURE: ['SIGNED', 'SUBMITTED', 'FAILED'],
  SIGNED: ['SUBMITTED', 'FAILED'],
  SUBMITTED: ['BRIDGING', 'DESTINATION_PENDING', 'COMPLETED', 'FAILED'],
  BRIDGING: ['DESTINATION_PENDING', 'COMPLETED', 'FAILED'],
  DESTINATION_PENDING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: []
});

export function canTransition(from, to) {
  if (!from) return to === 'QUOTED' || to === 'AWAITING_SIGNATURE' || to === 'SUBMITTED';
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * THE NO-FAKE-SUCCESS RULE, as a function instead of a comment.
 *
 * COMPLETED is only reachable with a destination transaction hash. Everything
 * else that "looks done" — a mined source tx, a provider saying DONE without
 * naming the receiving tx — lands on DESTINATION_PENDING, which the UI renders
 * as «تراکنش اولیه انجام شد … در حال تکمیل انتقال».
 */
export function guardCompletion(nextStatus, { destinationTxHash } = {}) {
  if (nextStatus !== 'COMPLETED') return nextStatus;
  return destinationTxHash ? 'COMPLETED' : 'DESTINATION_PENDING';
}

/* ── chain identity ──────────────────────────────────────────────────────── */

/**
 * Chain families. A cross-chain app that treats every chain as EVM will
 * eventually send an 0x… address to Solana, which is unrecoverable.
 */
export const CHAIN_FAMILY = Object.freeze({ EVM: 'EVM', SVM: 'SVM' });

/** LI.FI's own id for Solana, as used by its REST API. */
export const SOLANA_CHAIN_ID = 1151111081099710;

export function chainFamily(chainId) {
  if (chainId == null) return null;
  const raw = String(chainId).toUpperCase();
  if (raw === 'SOL' || raw === 'SVM' || Number(chainId) === SOLANA_CHAIN_ID) return CHAIN_FAMILY.SVM;
  return Number.isFinite(Number(chainId)) ? CHAIN_FAMILY.EVM : null;
}

export const isSolanaChain = (chainId) => chainFamily(chainId) === CHAIN_FAMILY.SVM;
export const isEvmChain = (chainId) => chainFamily(chainId) === CHAIN_FAMILY.EVM;

/** Numeric chain id in LI.FI's vocabulary ('SOL' → 1151111081099710). */
export function toProviderChainId(chainId) {
  if (isSolanaChain(chainId)) return SOLANA_CHAIN_ID;
  const n = Number(chainId);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ── address validation, per family ──────────────────────────────────────── */

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Solana addresses are base58 of exactly 32 bytes. Length-in-characters is
 * NOT enough: '1111…' decodes to fewer bytes and would be accepted by a naive
 * regex. Decoded here (no dependency — this file must run in both runtimes).
 */
export function isSolanaAddress(value) {
  const s = String(value || '');
  if (!BASE58_RE.test(s)) return false;
  const bytes = [0];
  for (const ch of s) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) return false;
    let carry = idx;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  for (const ch of s) {
    if (ch !== '1') break;
    leadingZeros += 1;
  }
  /*
   * `bytes` is little-endian and seeded with a single 0, so a decoded value of
   * zero still has length 1. The significant byte count is therefore 0 for the
   * all-'1's address (the system program, 32 zero bytes — a legal pubkey) and
   * `bytes.length` otherwise.
   */
  const significant = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  return significant + leadingZeros === 32;
}

export const isEvmAddress = (value) => EVM_ADDRESS_RE.test(String(value || ''));

/**
 * Is this address usable as the DESTINATION on this chain?
 *
 * Returns a code rather than a boolean so the UI can say which mistake was
 * made — "that is an EVM address and the destination is Solana" is actionable,
 * "invalid address" is not.
 */
export function validateDestinationAddress(address, chainId) {
  const family = chainFamily(chainId);
  const value = String(address || '').trim();
  if (!value) return { ok: false, code: 'DESTINATION_REQUIRED', family };
  if (family === CHAIN_FAMILY.SVM) {
    if (isEvmAddress(value)) return { ok: false, code: 'EVM_ADDRESS_ON_SOLANA', family };
    return isSolanaAddress(value)
      ? { ok: true, code: null, family, address: value }
      : { ok: false, code: 'BAD_SOLANA_ADDRESS', family };
  }
  if (family === CHAIN_FAMILY.EVM) {
    if (isSolanaAddress(value) && !isEvmAddress(value)) return { ok: false, code: 'SOLANA_ADDRESS_ON_EVM', family };
    return isEvmAddress(value)
      ? { ok: true, code: null, family, address: value }
      : { ok: false, code: 'BAD_EVM_ADDRESS', family };
  }
  return { ok: false, code: 'UNSUPPORTED_CHAIN', family };
}

/* ── amount helpers (string maths — never floats) ────────────────────────── */

export function toBaseUnits(amount, decimals) {
  const raw = String(amount ?? '').trim();
  if (!raw || !/^\d*\.?\d*$/.test(raw)) return null;
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) return null;
  const [whole = '0', frac = ''] = raw.split('.');
  const padded = (frac + '0'.repeat(d)).slice(0, d);
  const joined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(joined)) return null;
  return joined;
}

export function fromBaseUnits(raw, decimals) {
  if (raw == null) return null;
  const s = String(raw);
  if (!/^\d+$/.test(s)) return null;
  const d = Number(decimals) || 0;
  if (d === 0) return s;
  const padded = s.padStart(d + 1, '0');
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ── deterministic quote id ──────────────────────────────────────────────── */

/**
 * A 64-bit FNV-1a over the parts of a quote a user would care about.
 *
 * Deliberately content-addressed: two quotes with the same route AND the same
 * output have the same id, so the pre-execution re-quote (`QUOTE_CHANGED`)
 * fires when the PRICE moved and stays quiet when nothing did. A random uuid
 * would make every refresh look like a change and train people to tap through
 * the warning.
 */
export function quoteFingerprint(parts) {
  const text = JSON.stringify(parts);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function quoteMetadata(quote, { now = Date.now(), ttlMs = QUOTE_TTL_MS } = {}) {
  return {
    quoteId: quote.quoteId,
    createdAt: now,
    expiresAt: now + ttlMs
  };
}

export function isQuoteExpired(quote, now = Date.now()) {
  if (!quote?.expiresAt) return true;
  return now >= Number(quote.expiresAt);
}

export function quoteSecondsLeft(quote, now = Date.now()) {
  if (!quote?.expiresAt) return 0;
  return Math.max(0, Math.round((Number(quote.expiresAt) - now) / 1000));
}

/* ── LI.FI → internal schema ─────────────────────────────────────────────── */

function normalizeToken(token) {
  if (!token) return null;
  return {
    address: token.address ?? null,
    symbol: token.symbol ?? null,
    decimals: Number.isFinite(Number(token.decimals)) ? Number(token.decimals) : null,
    chainId: token.chainId ?? null,
    name: token.name ?? null,
    logoURI: token.logoURI ?? null,
    priceUSD: token.priceUSD != null ? String(token.priceUSD) : null
  };
}

/**
 * Split LI.FI's `feeCosts` into the two things a user must be told apart:
 * fees taken OUT of what arrives (`included`) and fees that must be paid on
 * top (`!included`, i.e. more native coin needed in the wallet).
 */
function splitFees(feeCosts = []) {
  let bridgeUsd = 0;
  let protocolUsd = 0;
  let payableUsd = 0;
  let integratorUsd = 0;
  const items = [];
  for (const cost of Array.isArray(feeCosts) ? feeCosts : []) {
    const usd = num(cost?.amountUSD);
    const name = String(cost?.name || '').toLowerCase();
    const isProtocol = /protocol|integrator|lifi|platform|service/.test(name);
    if (isProtocol) protocolUsd += usd;
    else bridgeUsd += usd;
    if (cost?.included === false) payableUsd += usd;

    /* Our own cut, dug out of the fee split rather than repeated from config:
       the disclosure on screen must be the number the provider actually
       charged, not the number we asked for. */
    const recipients = cost?.feeSplit?.recipients;
    if (Array.isArray(recipients)) {
      const total = num(cost?.amount);
      const mine = recipients.find((r) => r?.name && String(r.name).toLowerCase() !== 'lifi');
      if (mine && total > 0) integratorUsd += usd * (num(mine.fee) / total);
    }
    items.push({
      name: cost?.name ?? null,
      description: cost?.description ?? null,
      amountUsd: usd,
      included: cost?.included !== false,
      token: normalizeToken(cost?.token),
      amount: cost?.amount != null ? String(cost.amount) : null
    });
  }
  return { bridgeUsd, protocolUsd, payableUsd, integratorUsd, items };
}

function sumGas(gasCosts = []) {
  let usd = 0;
  let nativeSymbol = null;
  let nativePriceUsd = null;
  let amount = 0n;
  for (const g of Array.isArray(gasCosts) ? gasCosts : []) {
    usd += num(g?.amountUSD);
    if (!nativeSymbol && g?.token?.symbol) nativeSymbol = g.token.symbol;
    if (nativePriceUsd == null && num(g?.token?.priceUSD) > 0) nativePriceUsd = num(g.token.priceUSD);
    try {
      if (g?.amount != null && /^\d+$/.test(String(g.amount))) amount += BigInt(g.amount);
    } catch { /* a non-integer gas amount is simply not summed */ }
  }
  return { usd, nativeSymbol, nativePriceUsd, amount: amount.toString() };
}

/**
 * Normalise ONE LI.FI step (the shape `/v1/quote` returns) into the internal
 * CrossChainQuote. This is the only place LI.FI's field names are read.
 */
export function normalizeLifiStep(step, { now = Date.now(), ttlMs = QUOTE_TTL_MS, provider = 'lifi' } = {}) {
  if (!step || !step.action || !step.estimate) return null;
  const action = step.action;
  const est = step.estimate;

  const fees = splitFees(est.feeCosts);
  const gas = sumGas(est.gasCosts);
  const fromToken = normalizeToken(action.fromToken);
  const toToken = normalizeToken(action.toToken);

  const fromChain = action.fromChainId ?? fromToken?.chainId ?? null;
  const toChain = action.toChainId ?? toToken?.chainId ?? null;
  const tool = step.tool ?? est.tool ?? null;

  const quoteId = quoteFingerprint({
    tool,
    fromChain,
    toChain,
    fromToken: fromToken?.address,
    toToken: toToken?.address,
    fromAmount: String(est.fromAmount ?? action.fromAmount ?? ''),
    toAmount: String(est.toAmount ?? ''),
    toAmountMin: String(est.toAmountMin ?? ''),
    slippage: action.slippage ?? null
  });

  const steps = Array.isArray(step.includedSteps) && step.includedSteps.length
    ? step.includedSteps.map((s) => ({
      type: s.type ?? null,
      tool: s.tool ?? null,
      toolName: s.toolDetails?.name ?? s.tool ?? null,
      fromChain: s.action?.fromChainId ?? null,
      toChain: s.action?.toChainId ?? null
    }))
    : [{ type: step.type ?? null, tool, toolName: step.toolDetails?.name ?? tool, fromChain, toChain }];

  const toAmountUsd = num(est.toAmountUSD);
  const fromAmountUsd = num(est.fromAmountUSD);

  return {
    schema: CROSS_CHAIN_QUOTE_SCHEMA,
    quoteId,
    provider,
    routeId: step.id ?? null,

    fromChain: fromChain == null ? null : String(fromChain),
    toChain: toChain == null ? null : String(toChain),
    fromToken: fromToken?.address ?? null,
    toToken: toToken?.address ?? null,
    fromTokenDetail: fromToken,
    toTokenDetail: toToken,

    fromAmount: String(est.fromAmount ?? action.fromAmount ?? ''),
    toAmount: String(est.toAmount ?? ''),
    toAmountMin: est.toAmountMin != null ? String(est.toAmountMin) : null,
    fromAmountUsd,
    toAmountUsd,

    /* The `CrossChainQuote` interface's string fields — USD, fixed to cents so
       two providers are comparable at a glance. */
    gasCost: gas.usd ? gas.usd.toFixed(4) : '0',
    bridgeFee: fees.bridgeUsd ? fees.bridgeUsd.toFixed(4) : '0',
    protocolFee: fees.protocolUsd ? fees.protocolUsd.toFixed(4) : '0',

    gasCostUsd: gas.usd,
    bridgeFeeUsd: fees.bridgeUsd,
    protocolFeeUsd: fees.protocolUsd,
    payableFeeUsd: fees.payableUsd,
    integratorFeeUsd: fees.integratorUsd || null,
    totalCostUsd: gas.usd + fees.bridgeUsd + fees.protocolUsd,
    feeItems: fees.items,
    nativeSymbol: gas.nativeSymbol,
    nativePriceUsd: gas.nativePriceUsd,

    slippage: action.slippage != null ? Number(action.slippage) : null,
    estimatedTime: Number.isFinite(Number(est.executionDuration)) ? Number(est.executionDuration) : null,
    tool,
    toolName: step.toolDetails?.name ?? tool ?? null,
    steps,
    tags: Array.isArray(step.tags) ? step.tags : [],

    approvalAddress: est.approvalAddress ?? null,
    transactionRequest: step.transactionRequest ?? null,
    executable: Boolean(step.transactionRequest),

    fromAddress: action.fromAddress ?? null,
    toAddress: action.toAddress ?? null,

    createdAt: now,
    expiresAt: now + ttlMs
  };
}

/**
 * Normalise a LI.FI ROUTE (the shape `/v1/advanced/routes` returns).
 *
 * A route is a list of steps and carries no transactionRequest — it is a
 * comparison object. Executing one always goes back through `/v1/quote` for
 * that tool, which re-prices it at the moment of signing.
 */
export function normalizeLifiRoute(route, { now = Date.now(), ttlMs = QUOTE_TTL_MS, provider = 'lifi' } = {}) {
  if (!route || !Array.isArray(route.steps) || route.steps.length === 0) return null;

  let bridgeUsd = 0;
  let protocolUsd = 0;
  let payableUsd = 0;
  let integratorUsd = 0;
  let duration = 0;
  let slippage = null;
  const feeItems = [];
  const steps = [];

  for (const step of route.steps) {
    const est = step?.estimate || {};
    const fees = splitFees(est.feeCosts);
    bridgeUsd += fees.bridgeUsd;
    protocolUsd += fees.protocolUsd;
    payableUsd += fees.payableUsd;
    integratorUsd += fees.integratorUsd;
    feeItems.push(...fees.items);
    duration += num(est.executionDuration);
    if (step?.action?.slippage != null) {
      slippage = Math.max(slippage ?? 0, Number(step.action.slippage));
    }
    steps.push({
      type: step?.type ?? null,
      tool: step?.tool ?? null,
      toolName: step?.toolDetails?.name ?? step?.tool ?? null,
      fromChain: step?.action?.fromChainId ?? null,
      toChain: step?.action?.toChainId ?? null
    });
  }

  const fromToken = normalizeToken(route.fromToken);
  const toToken = normalizeToken(route.toToken);
  const gasUsd = num(route.gasCostUSD);
  const primary = route.steps.find((s) => s?.type === 'cross' || s?.type === 'lifi') || route.steps[0];
  const tool = primary?.tool ?? null;

  const quoteId = quoteFingerprint({
    tool,
    fromChain: route.fromChainId,
    toChain: route.toChainId,
    fromToken: fromToken?.address,
    toToken: toToken?.address,
    fromAmount: String(route.fromAmount ?? ''),
    toAmount: String(route.toAmount ?? ''),
    toAmountMin: String(route.toAmountMin ?? ''),
    slippage
  });

  return {
    schema: CROSS_CHAIN_ROUTE_SCHEMA,
    quoteId,
    provider,
    routeId: route.id ?? null,

    fromChain: route.fromChainId == null ? null : String(route.fromChainId),
    toChain: route.toChainId == null ? null : String(route.toChainId),
    fromToken: fromToken?.address ?? null,
    toToken: toToken?.address ?? null,
    fromTokenDetail: fromToken,
    toTokenDetail: toToken,

    fromAmount: String(route.fromAmount ?? ''),
    toAmount: String(route.toAmount ?? ''),
    toAmountMin: route.toAmountMin != null ? String(route.toAmountMin) : null,
    fromAmountUsd: num(route.fromAmountUSD),
    toAmountUsd: num(route.toAmountUSD),

    gasCost: gasUsd ? gasUsd.toFixed(4) : '0',
    bridgeFee: bridgeUsd ? bridgeUsd.toFixed(4) : '0',
    protocolFee: protocolUsd ? protocolUsd.toFixed(4) : '0',

    gasCostUsd: gasUsd,
    bridgeFeeUsd: bridgeUsd,
    protocolFeeUsd: protocolUsd,
    payableFeeUsd: payableUsd,
    integratorFeeUsd: integratorUsd || null,
    totalCostUsd: gasUsd + bridgeUsd + protocolUsd,
    feeItems,
    nativeSymbol: null,
    nativePriceUsd: null,

    slippage,
    estimatedTime: duration || null,
    tool,
    toolName: primary?.toolDetails?.name ?? tool ?? null,
    steps,
    tags: Array.isArray(route.tags) ? route.tags : [],
    insurance: route.insurance?.state ?? null,

    approvalAddress: primary?.estimate?.approvalAddress ?? null,
    /* A route is never directly signable — see the doc comment above. */
    transactionRequest: null,
    executable: false,

    fromAddress: route.fromAddress ?? null,
    toAddress: route.toAddress ?? null,

    createdAt: now,
    expiresAt: now + ttlMs
  };
}

/* ── best route ──────────────────────────────────────────────────────────── */

/**
 * How much an hour in flight is assumed to cost, as a fraction of the amount
 * being moved.
 *
 * 0.2%/hour. The basis is not a preference but exposure: capital sitting in a
 * bridge is capital the user cannot act on, at roughly the hourly volatility
 * of the assets involved. It is deliberately small enough that a genuinely
 * better rate still wins — a route paying 0.5% more is worth a two-hour wait
 * and this scoring says so — and large enough that a route which is a cent
 * better and an hour slower loses.
 */
const TIME_COST_PER_HOUR = 0.002;

/** Weight of the downside (`toAmountMin`) in the effective output. */
const DOWNSIDE_WEIGHT = 0.2;

/** How much an unreliable-looking route is penalised, as a fraction. */
const RELIABILITY_WEIGHT = 0.002;

/**
 * Reliability, from things the provider actually told us: whether LI.FI tagged
 * the route RECOMMENDED, whether it is insurable, and how many hops it has.
 * Every extra hop is another contract that can be the one that fails.
 */
export function routeReliability(route) {
  let score = 0.85;
  const tags = (route?.tags || []).map((x) => String(x).toUpperCase());
  if (tags.includes('RECOMMENDED')) score += 0.1;
  if (tags.includes('FASTEST')) score += 0.02;
  if (tags.includes('CHEAPEST')) score += 0.02;
  if (route?.insurance === 'INSURED' || route?.insurance === 'INSURABLE') score += 0.03;
  const hops = Array.isArray(route?.steps) ? route.steps.length : 1;
  score -= Math.max(0, hops - 1) * 0.05;
  return Math.max(0, Math.min(1, score));
}

/**
 * Score a normalised route. Higher is better; the unit is USD.
 *
 * Every factor the spec asks for is represented, and each one is a real
 * number from the provider rather than a vibe:
 *   output − gas − fees payable on top − time-in-flight − unreliability
 */
export function scoreRoute(route) {
  if (!route) return null;
  const output = num(route.toAmountUsd);
  const decimals = route.toTokenDetail?.decimals;
  const price = num(route.toTokenDetail?.priceUSD);

  /* When LI.FI omits toAmountUSD (it does for thin tokens) the USD value is
     rebuilt from the token price. Without a price there is nothing to compare
     and the route is scored null rather than zero — zero would silently make
     it the worst option instead of an unknown one. */
  let effective = output;
  if (!effective && price > 0 && decimals != null) {
    const human = Number(fromBaseUnits(route.toAmount, decimals));
    if (Number.isFinite(human)) effective = human * price;
  }
  if (!effective) return null;

  let downside = effective;
  if (route.toAmountMin && decimals != null && price > 0) {
    const min = Number(fromBaseUnits(route.toAmountMin, decimals));
    if (Number.isFinite(min)) downside = min * price;
  }
  const blended = effective * (1 - DOWNSIDE_WEIGHT) + downside * DOWNSIDE_WEIGHT;

  const gas = num(route.gasCostUsd);
  const payable = num(route.payableFeeUsd);
  const hours = num(route.estimatedTime) / 3600;
  const timeCost = num(route.fromAmountUsd) * TIME_COST_PER_HOUR * hours;
  const reliabilityCost = num(route.fromAmountUsd) * (1 - routeReliability(route)) * RELIABILITY_WEIGHT;

  return blended - gas - payable - timeCost - reliabilityCost;
}

/**
 * Rank routes best-first and explain the ranking.
 *
 * Returns a NEW array; every entry carries `score` and `scoreBreakdown` so the
 * UI (and the probe) can show why one route won instead of asking the user to
 * trust an ordering they cannot check.
 */
export function rankRoutes(routes = []) {
  const scored = [];
  for (const route of routes) {
    if (!route) continue;
    const score = scoreRoute(route);
    scored.push({
      ...route,
      score,
      reliability: routeReliability(route),
      scoreBreakdown: {
        outputUsd: num(route.toAmountUsd),
        gasUsd: num(route.gasCostUsd),
        payableFeeUsd: num(route.payableFeeUsd),
        bridgeFeeUsd: num(route.bridgeFeeUsd),
        protocolFeeUsd: num(route.protocolFeeUsd),
        estimatedTime: route.estimatedTime ?? null,
        slippage: route.slippage ?? null
      }
    });
  }
  scored.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });
  return scored.map((r, i) => ({ ...r, rank: i + 1, best: i === 0 }));
}

export function selectBestRoute(routes = []) {
  const ranked = rankRoutes(routes);
  return ranked.find((r) => r.score != null) || ranked[0] || null;
}

/* ── provider status → our status ────────────────────────────────────────── */

/**
 * Map LI.FI's `/v1/status` onto the lifecycle above.
 *
 * The important line is the DONE branch: DONE without a receiving tx hash is
 * NOT completed here. LI.FI reports DONE the moment the bridge accepts the
 * transfer for some tools, and a user told "completed" who then finds nothing
 * in their wallet has been lied to by us, not by the bridge.
 */
export function statusFromProvider(payload) {
  const raw = String(payload?.status || '').toUpperCase();
  const substatus = String(payload?.substatus || '').toUpperCase();
  const sourceTxHash = payload?.sending?.txHash ?? null;
  const destinationTxHash = payload?.receiving?.txHash ?? null;
  const actualAmount = payload?.receiving?.amount != null ? String(payload.receiving.amount) : null;

  let status;
  if (raw === 'DONE') status = destinationTxHash ? 'COMPLETED' : 'DESTINATION_PENDING';
  else if (raw === 'FAILED' || raw === 'INVALID') status = 'FAILED';
  else if (raw === 'NOT_FOUND') status = 'SUBMITTED';
  else if (raw === 'PENDING') {
    status = substatus === 'WAIT_DESTINATION_TRANSACTION' || substatus === 'PARTIAL'
      ? 'DESTINATION_PENDING'
      : 'BRIDGING';
  } else status = 'BRIDGING';

  return {
    status: guardCompletion(status, { destinationTxHash }),
    providerStatus: raw || null,
    providerSubstatus: payload?.substatus ?? null,
    substatusMessage: payload?.substatusMessage ?? null,
    sourceTxHash,
    destinationTxHash,
    actualAmount,
    sourceExplorer: payload?.sending?.txLink ?? null,
    destinationExplorer: payload?.receiving?.txLink ?? null,
    tool: payload?.tool ?? null
  };
}

/* ── request validation, shared by both callers ──────────────────────────── */

const AMOUNT_RE = /^[1-9][0-9]{0,77}$/;

/**
 * Validate quote parameters ONCE, for the server route and the browser alike.
 *
 * Fail-closed and specific: an unroutable request must be refused before a
 * provider call, because the alternative is a spinner followed by a generic
 * error the user cannot act on.
 */
export function validateQuoteParams(params = {}, { requireAddress = true } = {}) {
  const fromChain = params.fromChain;
  const toChain = params.toChain;
  if (toProviderChainId(fromChain) == null) return { ok: false, code: 'BAD_FROM_CHAIN' };
  if (toProviderChainId(toChain) == null) return { ok: false, code: 'BAD_TO_CHAIN' };
  if (String(toProviderChainId(fromChain)) === String(toProviderChainId(toChain))) {
    return { ok: false, code: 'SAME_CHAIN' };
  }
  if (!params.fromToken) return { ok: false, code: 'BAD_FROM_TOKEN' };
  if (!params.toToken) return { ok: false, code: 'BAD_TO_TOKEN' };
  if (!AMOUNT_RE.test(String(params.fromAmount || ''))) return { ok: false, code: 'BAD_AMOUNT' };

  const from = validateDestinationAddress(params.fromAddress, fromChain);
  if (!from.ok && (requireAddress || params.fromAddress)) {
    return { ok: false, code: from.code === 'DESTINATION_REQUIRED' ? 'BAD_FROM_ADDRESS' : from.code };
  }

  if (params.toAddress) {
    const to = validateDestinationAddress(params.toAddress, toChain);
    if (!to.ok) return { ok: false, code: to.code };
  } else if (chainFamily(fromChain) !== chainFamily(toChain) && requireAddress) {
    /* Crossing families with no destination address would default to the
       sender's address on a chain where that address does not exist. */
    return { ok: false, code: 'DESTINATION_REQUIRED' };
  }

  const slippage = params.slippage == null ? null : Number(params.slippage);
  if (slippage != null && (!Number.isFinite(slippage) || slippage < 0 || slippage > 0.5)) {
    return { ok: false, code: 'BAD_SLIPPAGE' };
  }

  return {
    ok: true,
    value: {
      fromChain: toProviderChainId(fromChain),
      toChain: toProviderChainId(toChain),
      fromToken: String(params.fromToken),
      toToken: String(params.toToken),
      fromAmount: String(params.fromAmount),
      fromAddress: from.ok ? String(params.fromAddress) : null,
      toAddress: params.toAddress ? String(params.toAddress) : null,
      slippage
    }
  };
}

/* ── human summary, used by chat + the quote card ────────────────────────── */

/**
 * The numbers a person needs, in one object, already reduced from the parts.
 *
 * Intent OS chat and the cross-chain card render the SAME summary — that is
 * the whole point of the shared engine: the chat cannot quote a number the
 * card would contradict.
 */
export function summariseQuote(quote) {
  if (!quote) return null;
  const decimals = quote.toTokenDetail?.decimals ?? null;
  return {
    quoteId: quote.quoteId,
    provider: quote.provider,
    tool: quote.tool,
    toolName: quote.toolName,
    receive: decimals != null ? fromBaseUnits(quote.toAmount, decimals) : null,
    receiveMin: decimals != null && quote.toAmountMin ? fromBaseUnits(quote.toAmountMin, decimals) : null,
    receiveSymbol: quote.toTokenDetail?.symbol ?? null,
    receiveUsd: num(quote.toAmountUsd) || null,
    sendUsd: num(quote.fromAmountUsd) || null,
    gasUsd: num(quote.gasCostUsd),
    bridgeFeeUsd: num(quote.bridgeFeeUsd),
    protocolFeeUsd: num(quote.protocolFeeUsd),
    totalCostUsd: num(quote.totalCostUsd),
    integratorFeeUsd: quote.integratorFeeUsd ?? null,
    slippagePct: quote.slippage != null ? Number(quote.slippage) * 100 : null,
    estimatedTime: quote.estimatedTime ?? null,
    expiresAt: quote.expiresAt ?? null,
    executable: Boolean(quote.executable)
  };
}
