/**
 * FBT WALLET ENGINE — SMART GAS MANAGER
 * ---------------------------------------------------------------------------
 * Gas is the most common reason a signed transaction never lands. This engine
 * answers three questions before anything is broadcast:
 *
 *   1. Is there enough gas?          `checkGas()`
 *   2. If not, how short are we?     the shortfall, in native + USD
 *   3. Can this chain abstract gas?  `gasAbstractionFor()`
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · `hasEnoughGas` (from walletRisk.js) returns null — not false — when the
 *   fee feed is missing. `checkGas` preserves that: `level:'unknown'` is a
 *   real, renderable answer and the UI must treat it as "not proven safe".
 * · Gas abstraction is chain + configuration dependent. `gasAbstractionFor`
 *   reports chain SUPPORT and a `configured` flag separately, because a chain
 *   that supports EIP-4337 but has no configured paymaster offers nothing.
 */

import { hasEnoughGas } from '../walletRisk.js';
import { gaslessSupports } from '../gasless.js';

export const GAS_SCHEMA = 'fbt.gas-check.v1';

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Check whether the native balance covers the estimated fee (with a buffer).
 *
 * Returns `{ level:'ok'|'low'|'unknown', ok, shortfallNative, shortfallUsd }`.
 */
export function checkGas({ nativeBalance = null, feeNative = null, nativePriceUsd = null, buffer = 1.25 } = {}) {
  const bal = num(nativeBalance);
  const fee = num(feeNative);
  if (bal == null || fee == null) {
    return { schema: GAS_SCHEMA, level: 'unknown', ok: null, shortfallNative: null, shortfallUsd: null };
  }
  const enough = hasEnoughGas({ nativeBalance: bal, feeNative: fee, buffer });
  if (enough === null) return { schema: GAS_SCHEMA, level: 'unknown', ok: null, shortfallNative: null, shortfallUsd: null };
  if (enough) return { schema: GAS_SCHEMA, level: 'ok', ok: true, shortfallNative: 0, shortfallUsd: 0 };
  const shortfallNative = fee * buffer - bal;
  const price = num(nativePriceUsd);
  return {
    schema: GAS_SCHEMA,
    level: 'low',
    ok: false,
    shortfallNative,
    shortfallUsd: price != null ? shortfallNative * price : null
  };
}

/** i18n + summary for a gas-check level (the UI renders `key`, never prose). */
export function gasVerdict(level) {
  const keys = { ok: 'gas.ok', low: 'gas.low', unknown: 'gas.unknown' };
  return { level, key: keys[level] || 'gas.unknown' };
}

/**
 * Gas-abstraction support for a chain. `configured` comes from the app layer
 * (the server advertises it via `GET /api/gasless/status`); this function only
 * reports chain SUPPORT, because support without configuration is not a
 * feature — it is a button that 401s.
 */
export function gasAbstractionFor(chainId, { configured = false } = {}) {
  const supported = gaslessSupports(chainId);
  return {
    schema: 'fbt.gas-abstraction.v1',
    chainId: Number(chainId) || null,
    supported,
    configured: Boolean(configured),
    available: supported && configured
  };
}
