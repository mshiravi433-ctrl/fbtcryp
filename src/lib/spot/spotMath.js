/**
 * SPOT TRADE — pure arithmetic and checks. No ethers, no DOM, no network.
 *
 * Rounding policy (this file is the only place it is decided):
 *
 *   • What the user PAYS is parsed exactly. A typed amount with more decimals
 *     than the token has is REJECTED, never silently rounded: rounding a paid
 *     amount up can ask for a balance the wallet does not have.
 *   • What the user RECEIVES is displayed floored. Showing 1.9999 as "2.00"
 *     overstates the outcome; flooring never does.
 *   • The on-chain minimum is checked against the slippage the user accepted,
 *     with the same integer formula lib/swap.js and lib/aggregator.js use, so
 *     a healthy quote is never refused by a rounding difference.
 */

/** A quote older than this is not executed; it is fetched again first. */
export const SPOT_QUOTE_MAX_AGE_MS = 20_000;

export const SPOT_SLIPPAGE_MIN = 0.01; // percent
export const SPOT_SLIPPAGE_MAX = 5; // percent — above this the form refuses
export const SPOT_SLIPPAGE_HIGH = 3; // percent — above this we warn in red
export const SPOT_IMPACT_WARN = 1; // percent price impact
export const SPOT_IMPACT_HIGH = 5; // percent price impact

const DECIMAL_RE = /^(\d+(\.\d+)?|\.\d+)$/;

/**
 * Parse a typed decimal into base units. Never rounds.
 * @returns {{ok:true, wei:bigint} | {ok:false, code:string}}
 */
export function parseAmountWei(text, decimals) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false, code: 'AMOUNT_REQUIRED' };
  if (!DECIMAL_RE.test(s)) return { ok: false, code: 'INVALID_AMOUNT' };
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return { ok: false, code: 'INVALID_DECIMALS' };

  const [whole, fracRaw = ''] = s.startsWith('.') ? ['0', s.slice(1)] : s.split('.');
  if (fracRaw.length > dec) return { ok: false, code: 'TOO_MANY_DECIMALS' };

  const wei = BigInt(whole + fracRaw.padEnd(dec, '0'));
  if (wei <= 0n) return { ok: false, code: 'AMOUNT_ZERO' };
  return { ok: true, wei };
}

/**
 * Base units → decimal string, FLOORED to `maxFrac` places and with trailing
 * zeros removed. Never rounds up, so it never shows more than the user holds
 * or will receive.
 */
export function formatWeiFloor(wei, decimals, maxFrac = 6) {
  const dec = Number(decimals);
  const value = BigInt(wei ?? 0);
  if (value <= 0n) return '0';
  const base = 10n ** BigInt(dec);
  const whole = value / base;
  const frac = (value % base).toString().padStart(dec, '0').slice(0, Math.max(0, Math.min(maxFrac, dec)));
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

/**
 * The minimum the user accepts, from their slippage: floor(out × (100−s)%).
 * Same integer rounding as lib/swap.js (basis points, BigInt division).
 */
export function floorMinOutWei(amountOutWei, slippagePct) {
  const out = BigInt(amountOutWei ?? 0);
  const keepBps = BigInt(Math.round((100 - Number(slippagePct)) * 100));
  return (out * keepBps) / 10000n;
}

/**
 * Refuse a quote whose on-chain minimum is looser than the slippage the user
 * accepted, or which is internally inconsistent. Pure: the caller decides what
 * to do with the code.
 * @returns {{ok:true} | {ok:false, code:'QUOTE_MISSING'|'QUOTE_INVALID'|'SLIPPAGE_EXCEEDED'}}
 */
export function verifyQuoteProtection({ quote, slippagePct }) {
  if (!quote || quote.error) return { ok: false, code: 'QUOTE_MISSING' };
  if (typeof quote.amountOutWei !== 'bigint' || typeof quote.minOutWei !== 'bigint') {
    return { ok: false, code: 'QUOTE_INVALID' };
  }
  if (quote.amountOutWei <= 0n || quote.minOutWei < 0n || quote.minOutWei > quote.amountOutWei) {
    return { ok: false, code: 'QUOTE_INVALID' };
  }
  if (quote.minOutWei < floorMinOutWei(quote.amountOutWei, slippagePct)) {
    return { ok: false, code: 'SLIPPAGE_EXCEEDED' };
  }
  return { ok: true };
}

/** True when the quote is older than the execution window (or has no time). */
export function isQuoteStale(fetchedAt, now, maxAgeMs = SPOT_QUOTE_MAX_AGE_MS) {
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return true;
  return now - fetchedAt >= maxAgeMs;
}

/** 'invalid' outside [0.01, 5], 'high' from 3 up, otherwise 'ok'. */
export function slippageLevel(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < SPOT_SLIPPAGE_MIN || n > SPOT_SLIPPAGE_MAX) return 'invalid';
  return n >= SPOT_SLIPPAGE_HIGH ? 'high' : 'ok';
}

/** null below the warning line, then 'warn', then 'high'. */
export function impactLevel(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  if (n >= SPOT_IMPACT_HIGH) return 'high';
  if (n >= SPOT_IMPACT_WARN) return 'warn';
  return null;
}

/**
 * Turn a pair into the direction the swap engine needs.
 * buy  = pay the quote asset, receive the asset.
 * sell = pay the asset, receive the quote asset.
 * @returns {{fromToken, toToken} | null} null when both sides are the same token.
 */
export function directedPair({ side, asset, quoteAsset }) {
  if (!asset || !quoteAsset) return null;
  if (asset.symbol === quoteAsset.symbol && asset.address === quoteAsset.address) return null;
  return side === 'sell'
    ? { fromToken: asset, toToken: quoteAsset }
    : { fromToken: quoteAsset, toToken: asset };
}

const QUOTE_PREFERENCE = ['USDC', 'USDT', 'DAI'];

/** The default pay/receive currency for a chain: a stablecoin when one exists. */
export function defaultQuoteAsset(tokens, avoid = null) {
  const list = (tokens ?? []).filter((t) => !avoid || t.symbol !== avoid.symbol);
  for (const sym of QUOTE_PREFERENCE) {
    const hit = list.find((t) => t.symbol === sym);
    if (hit) return hit;
  }
  return list[0] ?? null;
}
