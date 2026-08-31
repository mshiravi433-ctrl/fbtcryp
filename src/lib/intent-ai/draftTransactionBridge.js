/**
 * FBT INTENT AI — DRAFT → TRANSACTION BRIDGE
 * ---------------------------------------------------------------------------
 * The missing translation layer between what Intent OS reasons about and what
 * a blockchain accepts.
 *
 * An Intent OS draft is economic intent:
 *     { chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountUsd: 100 }
 *
 * A transaction is mechanical:
 *     { to: '0x…', data: '0x…', value: 0n }
 *
 * Nothing in src/lib/intent-ai/ could cross that gap: no module resolved a
 * symbol to a token address, converted a USD figure into base units, or
 * obtained a live route. `confirmAndSubmit` therefore always ran with
 * `broadcastResult = null`, so `txHash` was always null and Intent OS could
 * never actually execute — while `src/pages/Swap.jsx` did exactly this through
 * `buildIntentTransactionRequest`. This module makes the same capability
 * reachable from a draft, under the same rules.
 *
 * FAIL-CLOSED CONTRACT
 * --------------------
 * Every function here returns { ok: false, error: classifyFailure(...) } when
 * anything is missing. Nothing is estimated, defaulted or hopefully assumed:
 *
 *   - an unresolvable symbol is MISSING_DATA, never a guessed address
 *   - a missing decimals field is MISSING_DATA, never an assumed 18
 *   - a missing or errored quote is PROVIDER_ERROR / SIMULATION_UNAVAILABLE
 *   - a fee above the announced ceiling is TERMS_CHANGED
 *   - broadcasting is OFF unless the caller explicitly opts in
 *
 * This module NEVER signs and NEVER broadcasts. It prepares a request and
 * hands it back; the caller passes it to the existing, already-audited
 * broadcast path. Keeping the signing boundary where it is means the phase-51
 * to phase-55 guarantees are untouched.
 */

import { classifyFailure } from './failureModes.js';
import { FEE_BPS, FEE_BPS_MAX } from '../feeBps.js';

export const DRAFT_BRIDGE_SCHEMA = 'fbt.draft-transaction-bridge.v1';

/**
 * Reject null, '', booleans and non-finite input.
 *
 * Repeated in every module by project convention rather than shared, because
 * Number(null) === 0 and Number('') === 0: a shared helper that anyone could
 * loosen later would silently turn a missing amount into a zero-value trade.
 */
function strictNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strictPositive(value) {
  const n = strictNumber(value);
  return n !== null && n > 0 ? n : null;
}

/** A whole, non-negative integer — decimals must never be fractional. */
function strictDecimals(value) {
  const n = strictNumber(value);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 0 || n > 36) return null;
  return n;
}

const SYMBOL_RE = /^[A-Za-z0-9._-]{1,16}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Resolve a token symbol on a chain to a concrete { address, decimals } pair.
 *
 * `tokenSource` is injected (normally `getToken` from src/lib/chains.js) so
 * this module stays free of UI imports and is fully testable.
 *
 * A native asset legitimately has address === null; that is represented
 * explicitly as `native: true` rather than being confused with "not found".
 */
export function resolveDraftToken({ chainId, symbol, tokenSource } = {}) {
  const chain = strictPositive(chainId);
  if (chain === null) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'CHAIN_ID_REQUIRED' }) };
  }
  const sym = typeof symbol === 'string' ? symbol.trim() : '';
  if (!SYMBOL_RE.test(sym)) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'SYMBOL_REQUIRED' }) };
  }
  if (typeof tokenSource !== 'function') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TOKEN_SOURCE' }) };
  }

  let found = null;
  try {
    found = tokenSource(chain, sym);
  } catch (err) {
    return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: String(err?.message || err).slice(0, 120) }) };
  }
  if (!found || typeof found !== 'object') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: `TOKEN_NOT_FOUND:${sym}` }) };
  }

  const decimals = strictDecimals(found.decimals);
  if (decimals === null) {
    /* Assuming 18 here would misprice a 6-decimal token by 10^12. */
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: `TOKEN_DECIMALS_UNKNOWN:${sym}` }) };
  }

  const isNative = found.native === true || found.address === null || found.address === undefined;
  if (!isNative && !ADDRESS_RE.test(String(found.address))) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: `TOKEN_ADDRESS_INVALID:${sym}` }) };
  }

  return {
    ok: true,
    schema: DRAFT_BRIDGE_SCHEMA,
    token: Object.freeze({
      symbol: found.symbol || sym,
      address: isNative ? null : String(found.address),
      decimals,
      native: isNative,
      chainId: chain
    })
  };
}

/**
 * Convert a human amount into base units, exactly.
 *
 * Uses string arithmetic and BigInt rather than floating point: at 18 decimals
 * a Number cannot represent the value without loss, and the rounding error
 * lands on a real balance.
 */
export function amountToBaseUnits({ amount, decimals } = {}) {
  const dec = strictDecimals(decimals);
  if (dec === null) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'DECIMALS_REQUIRED' }) };
  }
  if (typeof amount === 'boolean' || amount === null || amount === undefined) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'AMOUNT_REQUIRED' }) };
  }
  const raw = String(amount).trim();
  if (raw === '' || !/^\d*\.?\d*$/.test(raw) || raw === '.') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'AMOUNT_MALFORMED' }) };
  }
  const [whole = '0', fractionRaw = ''] = raw.split('.');
  if (fractionRaw.length > dec) {
    /* Silently truncating extra precision would execute a different trade
       than the one the user confirmed. */
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'AMOUNT_PRECISION_EXCEEDS_DECIMALS' }) };
  }
  const fraction = fractionRaw.padEnd(dec, '0');
  let units = null;
  try {
    units = BigInt(`${whole}${fraction}` || '0');
  } catch {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'AMOUNT_MALFORMED' }) };
  }
  if (units <= 0n) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'AMOUNT_MUST_BE_POSITIVE' }) };
  }
  return { ok: true, schema: DRAFT_BRIDGE_SCHEMA, baseUnits: units.toString(), decimals: dec };
}

/**
 * Turn a USD notional into a token amount using an explicitly supplied price.
 *
 * The price must be passed in. Inventing one, or reusing a stale cached value,
 * is how an intent silently becomes a different trade — and this codebase
 * forbids price prediction outright.
 */
export function usdToTokenAmount({ amountUsd, unitPriceUsd } = {}) {
  const usd = strictPositive(amountUsd);
  if (usd === null) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'AMOUNT_USD_REQUIRED' }) };
  }
  const price = strictPositive(unitPriceUsd);
  if (price === null) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'UNIT_PRICE_REQUIRED' }) };
  }
  return { ok: true, schema: DRAFT_BRIDGE_SCHEMA, amount: usd / price, amountUsd: usd, unitPriceUsd: price };
}

/**
 * Full draft → transaction-request preparation.
 *
 * Injected dependencies (none imported here, so the module stays UI-free):
 *   tokenSource   (chainId, symbol) → { address, decimals, native }
 *   quoteSource   async ({ chainId, fromToken, toToken, amountIn, slippage }) → quote
 *   requestBuilder async ({ chainId, account, quote, fromToken, toToken, ... }) → { ok, request }
 *
 * Returns the prepared request WITHOUT signing or broadcasting anything.
 */
export async function prepareDraftTransaction({
  draft,
  account,
  tokenSource,
  quoteSource,
  requestBuilder,
  unitPriceUsd = null,
  slippagePct = null,
  expectFeeBps = FEE_BPS,
  now = Date.now()
} = {}) {
  if (!draft || typeof draft !== 'object') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'DRAFT_REQUIRED' }) };
  }
  if (!ADDRESS_RE.test(String(account ?? ''))) {
    /* No connected wallet is an honest stop, never a placeholder sender. */
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'WALLET_NOT_CONNECTED' }) };
  }

  /* The announced fee is a ceiling. A draft that claims more than the product
     maximum is a changed term, not a rounding artifact. */
  const bps = strictNumber(expectFeeBps);
  if (bps === null || bps < 0 || bps > FEE_BPS_MAX) {
    return { ok: false, error: classifyFailure('TERMS_CHANGED', { detail: 'FEE_BPS_OUT_OF_RANGE' }) };
  }

  const from = resolveDraftToken({ chainId: draft.chainId, symbol: draft.fromSymbol, tokenSource });
  if (!from.ok) return from;
  const to = resolveDraftToken({ chainId: draft.chainId, symbol: draft.toSymbol, tokenSource });
  if (!to.ok) return to;
  if (from.token.symbol === to.token.symbol) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'FROM_AND_TO_IDENTICAL' }) };
  }

  /* A draft carries either an explicit token amount or a USD notional. A USD
     notional needs a caller-supplied price; there is no fallback. */
  let humanAmount = strictPositive(draft.amountIn);
  if (humanAmount === null) {
    const converted = usdToTokenAmount({ amountUsd: draft.amountUsd, unitPriceUsd });
    if (!converted.ok) return converted;
    humanAmount = converted.amount;
  }

  const units = amountToBaseUnits({
    /* toFixed keeps the string inside the token's own precision; the helper
       still rejects anything that would lose value. */
    amount: humanAmount.toFixed(from.token.decimals),
    decimals: from.token.decimals
  });
  if (!units.ok) return units;

  if (typeof quoteSource !== 'function') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_QUOTE_SOURCE' }) };
  }
  if (typeof requestBuilder !== 'function') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_REQUEST_BUILDER' }) };
  }

  const slippage = strictPositive(slippagePct ?? draft.slippagePct);
  if (slippage === null) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'SLIPPAGE_REQUIRED' }) };
  }

  let quote = null;
  try {
    quote = await quoteSource({
      chainId: from.token.chainId,
      fromToken: from.token,
      toToken: to.token,
      amountIn: units.baseUnits,
      slippage
    });
  } catch (err) {
    return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: String(err?.message || err).slice(0, 120) }) };
  }
  if (!quote || quote.error) {
    return {
      ok: false,
      error: classifyFailure('SIMULATION_UNAVAILABLE', { detail: quote?.error ? String(quote.error).slice(0, 120) : 'NO_QUOTE' })
    };
  }

  let built = null;
  try {
    built = await requestBuilder({
      chainId: from.token.chainId,
      account: String(account),
      quote,
      fromToken: from.token,
      toToken: to.token,
      slippage,
      expectFeeBps: bps,
      now
    });
  } catch (err) {
    return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: String(err?.message || err).slice(0, 120) }) };
  }
  if (!built || built.ok !== true || !built.request) {
    const code = String(built?.code || 'REQUEST_BUILD_FAILED');
    /* Map the builder's own vocabulary onto the closed cause-code set. */
    const mapped = code === 'QUOTE_EXPIRED'
      ? classifyFailure('DEADLINE_PASSED', { detail: code })
      : code === 'FEE_MISMATCH'
        ? classifyFailure('TERMS_CHANGED', { detail: code })
        : classifyFailure('SIMULATION_UNAVAILABLE', { detail: code });
    return { ok: false, error: mapped };
  }

  return {
    ok: true,
    schema: DRAFT_BRIDGE_SCHEMA,
    request: built.request,
    from: from.token,
    to: to.token,
    amountBaseUnits: units.baseUnits,
    slippagePct: slippage,
    feeBps: bps,
    quote,
    /* Explicitly NOT executed. The caller decides what happens next. */
    broadcast: false,
    txHash: null
  };
}

/**
 * Is real broadcasting switched on for this build?
 *
 * ON BY DEFAULT (owner directive, 2026-08): a confirmed Intent AI swap must
 * actually reach a network. The consent chain is stronger than the plain swap
 * screen's — Confirmation Gate terms + a per-execution opt-in checkbox + the
 * EIP-712 intent signature + the wallet's own confirmation of the final
 * transaction — so an extra build-time flag only produced the reported
 * dead end («امضا شد و … به شبکه نمی‌فرستد») while every one of those four
 * gates still guarded the money.
 *
 * `VITE_INTENT_BROADCAST_ENABLED=false` remains a deliberate kill-switch for
 * a deployment that must never broadcast (an audit build, a store review
 * build). Anything else — unset, 'true', garbage — means ON.
 */
export function broadcastEnabled(env = {}) {
  return String(env.VITE_INTENT_BROADCAST_ENABLED ?? '').trim().toLowerCase() !== 'false';
}

/**
 * Gate a prepared request behind the broadcast flag AND an explicit
 * per-call opt-in. Both must be true; either alone is not enough.
 * ('false' in the env is the kill-switch; see broadcastEnabled.)
 */
export function assertBroadcastAllowed({ env = {}, userOptIn = false } = {}) {
  if (!broadcastEnabled(env)) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'BROADCAST_DISABLED_IN_BUILD' }) };
  }
  if (userOptIn !== true) {
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'BROADCAST_NOT_OPTED_IN' }) };
  }
  return { ok: true, schema: DRAFT_BRIDGE_SCHEMA, allowed: true };
}
