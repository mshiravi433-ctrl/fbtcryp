/**
 * UNIFIED QUOTE MODEL — the single internal representation every provider's
 * quote is normalized into before it is compared, displayed or signed.
 * ---------------------------------------------------------------------------
 * This module exists because the swap engine grew one quote shape per
 * provider (KyberSwap, OpenOcean, Velora, 0x, LI.FI, deBridge, THORChain,
 * Solana), and the comparison code in `bestQuote.js` could only ever rank
 * them on GROSS output. That is the wrong metric the moment two routes have
 * different gas costs, and it is exactly the comparison the product is sold
 * on ("we checked N routes and picked the best").
 *
 * The model enforces four properties the P0 spec requires, none of which the
 * ad-hoc shapes guaranteed:
 *
 *   1. SELECTION IS NET, NOT GROSS.
 *      `netOutputUsd` subtracts gas from the received value. A route whose
 *      gas cost is unknown is never allowed to win — "if gas or price source
 *      is unknown, the route must not be presented as the best route".
 *
 *   2. QUOTES HAVE A CLOCK.
 *      Every quote carries `quoteTimestamp` and `expiry`. `isFresh`/`isExpired`
 *      gate signing: a quote that sat on screen past its TTL cannot be signed,
 *      and the UI can show its age.
 *
 *   3. THE ECONOMIC COMMITMENT IS FINGERPRINTED.
 *      `quoteFingerprint` is a deterministic digest of the fields that decide
 *      where money goes (amounts, min out, fee, fee recipient, slippage,
 *      source). The number shown to the user and the number signed must share
 *      a fingerprint; a mismatch is tamper or drift, and signing stops.
 *      NOTE: this is a NON-cryptographic integrity check (FNV-1a). The
 *      authoritative protection remains the on-chain fee-echo verification in
 *      aggregator.js — a fingerprint collision cannot move funds, it can only
 *      defeat this early-warning layer.
 *
 *   4. COMPARABILITY IS STRICT.
 *      `comparable(a, b)` is false unless chain, pair, fee bps, slippage and a
 *      price-source class agree AND both quotes are fresh and executable.
 *      Ranking a fee-free quote against a fee-charging one made the fee-free
 *      path always "win" — the original bug `bestQuote.comparable` already
 *      refused to make. This is the same rule, lifted into the unified model.
 *
 * Every function here is pure and synchronous (the only "clock" is an injected
 * `now`), so the whole model is unit-testable without a network or a DOM.
 */

/** Schema tag, so a consumer can refuse a shape it does not understand. */
export const QUOTE_SCHEMA = 'fbt.quote.v1';

/** Default quote lifetime. Short: a DEX quote is stale data the moment the
 *  pool moves, and the only thing a long TTL buys is a wider sandwich window. */
export const DEFAULT_QUOTE_TTL_MS = 30_000;

/** Two quotes are only "the same instant" if quoted within this window. */
export const COMPARABILITY_CLOCK_SKEW_MS = 5_000;

/* -------------------------------------------------------------------------- */
/* Hashing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a 32-bit, returned as an unsigned hex string.
 *
 * Chosen because it is dependency-free and synchronous. Its job is identity +
 * drift detection, not forgery resistance — forgery is defeated by the
 * on-chain fee echo, not by a client-side digest.
 */
export function fnv1aHex(input) {
  let h = 0x811c9dc5;
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    /* FNV prime, kept in 32-bit space with >>> 0. */
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                               */
/* -------------------------------------------------------------------------- */

const toBigInt = (v, fallback = 0n) => {
  if (v == null) return fallback;
  if (typeof v === 'bigint') return v;
  const s = String(v).trim();
  if (s === '' || s === 'null' || s === 'undefined') return fallback;
  try {
    return BigInt(s);
  } catch {
    return fallback;
  }
};

const toNum = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Gas cost is "known" only when it is a present, finite, non-negative number.
 *  `Number(null)` is 0, so a null gas cost would otherwise sneak through every
 *  `isFinite` guard and be treated as a free route — which is exactly the
 *  "unknown gas" case the spec says must never be named the best. */
const gasKnown = (v) => v != null && Number.isFinite(Number(v)) && Number(v) >= 0;

/**
 * The fields that define the economic commitment. Used by the fingerprint and
 * nothing else, so adding a display-only field can never change the digest.
 */
function economicCommitment(q) {
  return [
    'fbt-quote-commit-v1',
    q.chainId,
    q.tokenIn?.toLowerCase?.() ?? q.tokenIn ?? '',
    q.tokenOut?.toLowerCase?.() ?? q.tokenOut ?? '',
    q.amountInWei.toString(),
    q.amountOutWei.toString(),
    q.minOutWei.toString(),
    q.fbtFeeBps,
    (q.feeRecipient ?? '').toLowerCase(),
    q.slippageBps,
    q.source ?? '',
    q.solver ?? ''
  ].join('|');
}

/**
 * Normalize a provider's raw quote into the unified model.
 *
 * The caller supplies the contextual facts the raw object cannot know on its
 * own (the resolved token addresses, the slippage, the clock). The raw object
 * is the source of the amounts, gas and any provider-specific fees.
 *
 * @param {object} raw   the provider quote (KyberSwap/OpenOcean/Velora/0x/…)
 * @param {object} ctx
 * @param {number|string} ctx.chainId
 * @param {string} ctx.tokenIn   resolved input token address (or 'native')
 * @param {string} ctx.tokenOut  resolved output token address (or 'native')
 * @param {number} [ctx.decimalsIn]
 * @param {number} [ctx.decimalsOut]
 * @param {number} [ctx.fbtFeeBps]   platform fee in bps (default 0)
 * @param {string} [ctx.feeRecipient]
 * @param {number} [ctx.slippageBps] slippage tolerance in bps
 * @param {string} [ctx.source]      provider id, e.g. 'kyberswap'
 * @param {string} [ctx.solver]      finer solver id (for resolver quotes)
 * @param {number} [ctx.now]         injection point for the clock (Date.now)
 * @param {number} [ctx.ttlMs]       quote lifetime (default DEFAULT_QUOTE_TTL_MS)
 * @param {boolean} [ctx.executable] can this quote actually be signed/executed?
 * @param {number} [ctx.priceImpactPct]  measured price impact, if known
 * @param {string} [ctx.routePath]   serialized route, for display/audit
 * @returns {object} unified quote with QUOTE_SCHEMA
 */
export function normalizeQuote(raw, ctx = {}) {
  const source = String(ctx.source ?? raw?.source ?? 'unknown');
  const q = {
    schema: QUOTE_SCHEMA,
    source,
    solver: String(ctx.solver ?? source),

    chainId: Number(ctx.chainId ?? raw?.chainId) || null,
    tokenIn: String(ctx.tokenIn ?? ''),
    tokenOut: String(ctx.tokenOut ?? ''),
    decimalsIn: Number(ctx.decimalsIn ?? raw?.decimalsIn) || null,
    decimalsOut: Number(ctx.decimalsOut ?? raw?.decimalsOut) || null,

    amountInWei: toBigInt(raw?.amountInWei ?? raw?.amountIn),
    amountOutWei: toBigInt(raw?.amountOutWei ?? raw?.amountOut),
    minOutWei: toBigInt(raw?.minOutWei ?? raw?.minOut),

    slippageBps: Math.round(Number(ctx.slippageBps ?? raw?.slippageBps) || 0),
    fbtFeeBps: Math.max(0, Math.min(100, Math.round(Number(ctx.fbtFeeBps ?? raw?.feeBps) || 0))),
    feeRecipient: ctx.feeRecipient ? String(ctx.feeRecipient) : (raw?.feeRecipient ?? null),

    // Gas. `null` everywhere when unknown — and "unknown gas" is a hard bar to
    // being named the best route (see canBeBest).
    gasLimit: raw?.gasLimit != null ? toBigInt(raw.gasLimit, null) : null,
    gasCostUsd: toNum(raw?.gasUsd ?? raw?.gasCostUsd),
    gasCostNative: toNum(raw?.gasNative ?? raw?.gasCostNative),

    // Fee breakdown, separated as the spec demands. The FBT fee is taken from
    // the INPUT, so it is expressed in input-token raw units. Provider/protocol
    // fees are embedded in the route; when a provider reports them we surface
    // them, otherwise null (never zero — zero reads as "free").
    fbtFeeInWei: toBigInt(raw?.platformFeeWei ?? raw?.fbtFeeInWei),
    providerFeeBps: raw?.providerFeeBps != null ? Math.round(Number(raw.providerFeeBps)) : null,
    protocolFeeBps: raw?.protocolFeeBps != null ? Math.round(Number(raw.protocolFeeBps)) : null,

    priceImpactPct: toNum(ctx.priceImpactPct ?? raw?.priceImpact ?? raw?.priceImpactPct),
    routePath: ctx.routePath ?? raw?.routePath ?? raw?.hops ?? null,

    amountOutUsd: toNum(raw?.amountOutUsd),
    amountInUsd: toNum(raw?.amountInUsd),

    executable: ctx.executable !== false && raw?.executable !== false,
    riskLevel: raw?.riskLevel ?? null,

    quoteTimestamp: Number(ctx.now ?? raw?.quoteTimestamp ?? Date.now()),
    expiry: 0
  };

  const ttl = Number(ctx.ttlMs ?? DEFAULT_QUOTE_TTL_MS) || DEFAULT_QUOTE_TTL_MS;
  q.expiry = q.quoteTimestamp + ttl;

  q.fingerprint = fnv1aHex(economicCommitment(q));
  q.netOutputUsd = netOutputUsd(q);
  q.ageMs = null; // computed on demand by quoteAgeMs(q, now)
  return q;
}

/* -------------------------------------------------------------------------- */
/* Freshness                                                                   */
/* -------------------------------------------------------------------------- */

/** Milliseconds since the quote was taken, against an explicit clock. */
export function quoteAgeMs(q, now = Date.now()) {
  if (!q || !q.quoteTimestamp) return null;
  return Math.max(0, now - q.quoteTimestamp);
}

/** A quote is fresh while `now` is before its expiry. */
export function isFresh(q, now = Date.now()) {
  if (!q || !q.expiry) return false;
  return now < q.expiry;
}

/** Convenience inverse. A quote with no expiry is treated as expired: failing
 *  closed on freshness is the only safe default for something about to be
 *  signed. */
export function isExpired(q, now = Date.now()) {
  return !isFresh(q, now);
}

/* -------------------------------------------------------------------------- */
/* Net output + comparability                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Net received value in USD, after gas.
 *
 * The FBT fee is already taken from the input before `amountOutWei` is quoted,
 * so it is already reflected here — subtracting it again would double-count.
 * Gas, by contrast, is paid on top in the native coin, so it comes off the
 * received value for a like-for-like comparison.
 *
 * Returns `null` when the received value is unknown — NOT zero. A null net
 * output cannot win a ranking, which is the point.
 */
export function netOutputUsd(q) {
  if (!q) return null;
  const out = Number(q.amountOutUsd);
  if (!Number.isFinite(out) || out <= 0) return null;
  const gas = Number(q.gasCostUsd);
  // Gas unknown is not zero gas. We still return a number (the gross) so the
  // caller can DISPLAY it, but `canBeBest` below refuses to rank on it.
  return out - (Number.isFinite(gas) && gas > 0 ? gas : 0);
}

/**
 * Is this quote eligible to be named "the best"?
 *
 * It must be usable, executable, fresh, and — critically — its gas cost must
 * be known. A route whose gas is unknown cannot honestly be ranked above one
 * whose gas is known, because we cannot compute its net output.
 */
export function canBeBest(q, now = Date.now()) {
  if (!q || q.schema !== QUOTE_SCHEMA) return false;
  if (!isUsable(q)) return false;
  if (q.executable !== true) return false;
  if (!isFresh(q, now)) return false;
  if (!gasKnown(q.gasCostUsd)) return false;
  return true;
}

/**
 * Is the quote economically usable? Positive amounts and a real output.
 */
export function isUsable(q) {
  if (!q || typeof q !== 'object') return false;
  if (typeof q.amountOutWei !== 'bigint') return false;
  return q.amountOutWei > 0n && q.amountInWei > 0n;
}

/**
 * Can these two quotes be honestly compared and ranked against each other?
 *
 * Stricter than `bestQuote.comparable`: it also requires the unified schema,
 * freshness on both sides, agreement on the resolved token pair (not just the
 * symbols), and that the two quotes were taken inside the same clock window.
 * Ranking a 10-minute-old KyberSwap quote against a fresh OpenOcean one would
 * compare two different markets and call it a price comparison.
 */
export function comparable(a, b, now = Date.now()) {
  if (!canBeBest(a, now) || !canBeBest(b, now)) return false;
  if (Number(a.chainId) !== Number(b.chainId)) return false;
  if (a.tokenIn.toLowerCase() !== b.tokenIn.toLowerCase()) return false;
  if (a.tokenOut.toLowerCase() !== b.tokenOut.toLowerCase()) return false;
  if (a.fbtFeeBps !== b.fbtFeeBps) return false;
  if (a.slippageBps !== b.slippageBps) return false;
  if (Math.abs(a.quoteTimestamp - b.quoteTimestamp) > COMPARABILITY_CLOCK_SKEW_MS) return false;
  return true;
}

/**
 * Pick the best quote by NET output, and explain the comparison.
 *
 * @param {Array} quotes  normalized quotes (failures/stale may be present)
 * @param {number} [now]
 * @returns {{
 *   best: object|null,
 *   checked: number,            // how many were eligible to be ranked
 *   stale: number,              // dropped for being expired
 *   notExecutable: number,      // dropped because they cannot be signed
 *   gasUnknown: number,         // dropped because gas cost is unknown
 *   alternatives: object[],     // other eligible quotes, ranked
 *   rejectionReasons: object[]  // why each non-winner was excluded
 * }}
 */
export function rankByNetOutput(quotes, now = Date.now()) {
  const list = Array.isArray(quotes) ? quotes : [];
  let stale = 0;
  let notExecutable = 0;
  let gasUnknown = 0;
  const rejectionReasons = [];

  const eligible = [];
  for (const q of list) {
    if (!q || q.schema !== QUOTE_SCHEMA || !isUsable(q)) {
      rejectionReasons.push({ solver: q?.solver, reason: 'unusable' });
      continue;
    }
    if (q.executable !== true) {
      notExecutable += 1;
      rejectionReasons.push({ solver: q.solver, reason: 'not-executable' });
      continue;
    }
    if (isExpired(q, now)) {
      stale += 1;
      rejectionReasons.push({ solver: q.solver, reason: 'stale' });
      continue;
    }
    if (!gasKnown(q.gasCostUsd)) {
      gasUnknown += 1;
      rejectionReasons.push({ solver: q.solver, reason: 'gas-unknown' });
      continue;
    }
    eligible.push(q);
  }

  // Rank eligible quotes pairwise. Only TRULY comparable pairs are ordered by
  // net output; an incomparable eligible quote stays in the pool but cannot
  // displace a comparable winner (it is reported as an alternative, never the
  // "best").
  eligible.sort((a, b) => {
    if (!comparable(a, b, now)) return 0;
    return netOutputUsd(b) - netOutputUsd(a);
  });

  // The head is the winner only if at least one OTHER quote is comparable to
  // it — otherwise there was nothing to compare and it is a sole-source quote.
  // (A sole-source quote is still a valid best; we just flag it.)
  let best = eligible[0] ?? null;
  let checked = eligible.length;

  const alternatives = eligible.slice(1).map((q) => ({
    solver: q.solver,
    amountOutUsd: q.amountOutUsd,
    gasCostUsd: q.gasCostUsd,
    netOutputUsd: q.netOutputUsd,
    executable: q.executable,
    source: q.source
  }));

  return {
    best,
    checked,
    stale,
    notExecutable,
    gasUnknown,
    alternatives,
    rejectionReasons,
    soleSource: eligible.length === 1
  };
}

/* -------------------------------------------------------------------------- */
/* Fingerprint integrity                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Does the quote a user is ABOUT TO SIGN still match the one they were shown?
 *
 * Compares the fingerprint of the displayed quote against a re-normalized
 * "signing" quote. Any drift in the economic commitment (amounts, fee,
 * recipient, slippage) is a hard stop: signing proceeds only when the two
 * agree. This catches a stale UI re-rendering an old quote, a tampered
 * payload, and an accidental pair switch alike.
 */
export function fingerprintMatches(displayed, signing) {
  if (!displayed || !signing) return false;
  if (!displayed.fingerprint || !signing.fingerprint) return false;
  return displayed.fingerprint === signing.fingerprint;
}

/* -------------------------------------------------------------------------- */
/* Failure taxonomy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a provider error into a stable failure code the UI and the audit
 * trace can reason about. Provider strings drift; these do not.
 *
 * Codes:
 *   NO_ROUTE            — authoritative "no liquidity between these tokens"
 *   QUOTE_NETWORK       — the network path to the provider broke (geo/ISP)
 *   PROVIDER_UNREACHABLE — provider answered nothing (timeout / 5xx)
 *   PROVIDER_AUTH       — 401/403 from the provider
 *   FEE_NOT_APPLIED     — the platform fee came back missing/wrong
 *   FEE_RECIPIENT_MISMATCH — the fee is going to the wrong address
 *   CHAIN_UNSUPPORTED   — the provider does not serve this chain
 *   BUILD_FAILED        — route existed but calldata could not be built
 *   QUOTE_EXPIRED       — a quote we held has aged out
 *   QUOTE_FAILED        — catch-all; never thrown raw without a code
 */
export function failureCode(err) {
  const msg = String(err?.message ?? err?.code ?? err ?? '').trim().toUpperCase();
  if (!msg) return 'QUOTE_FAILED';
  if (msg.includes('NO_ROUTE') || msg.includes('NO_LIQUIDITY')) return 'NO_ROUTE';
  if (msg.includes('QUOTE_NETWORK') || msg.includes('AGG_TIMEOUT')) return 'QUOTE_NETWORK';
  if (msg.includes('UNREACHABLE') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
    return 'PROVIDER_UNREACHABLE';
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('UNAUTHORIZED') || msg.includes('AUTH')) {
    return 'PROVIDER_AUTH';
  }
  if (msg.includes('FEE_RECIPIENT')) return 'FEE_RECIPIENT_MISMATCH';
  if (msg.includes('FEE_NOT_APPLIED') || msg.includes('FEE')) return 'FEE_NOT_APPLIED';
  if (msg.includes('CHAIN_UNSUPPORTED') || msg.includes('UNSUPPORTED_CHAIN')) return 'CHAIN_UNSUPPORTED';
  if (msg.includes('BUILD_FAILED')) return 'BUILD_FAILED';
  if (msg.includes('EXPIRED') || msg.includes('STALE')) return 'QUOTE_EXPIRED';
  if (/\b5\d\d\b/.test(msg)) return 'PROVIDER_UNREACHABLE';
  return 'QUOTE_FAILED';
}

/** Human-stable retryability. Network/auth/route problems can be retried; a
 *  fee mismatch or a build failure cannot (retrying gives the same answer). */
export function isRetriable(code) {
  return ['QUOTE_NETWORK', 'PROVIDER_UNREACHABLE', 'PROVIDER_AUTH', 'NO_ROUTE'].includes(code);
}
