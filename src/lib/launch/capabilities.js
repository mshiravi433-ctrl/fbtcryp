/**
 * FBT LAUNCH — token capabilities (the immutable capability bitmap).
 *
 * The bitmap lives in the contract (contracts/FBTTokenFactory.sol); this
 * module is its single human-readable description, shared by the UI, the
 * risk engine and the API so the three can never drift apart.
 *
 * THE "BASIC" RULE
 * ---------------------------------------------------------------------------
 * The default launch token has NO capabilities: fixed supply, no mint, no
 * pause, no ceilings. That is the honest, auditable, no-surprises product.
 * Every advanced capability is opt-in, each with a plain-language warning,
 * and each one raises the deterministic risk score (risk.js) before the user
 * can sign anything.
 */

export const CAP = Object.freeze({
  MINTABLE: 1 << 0,
  BURNABLE: 1 << 1,
  PAUSABLE: 1 << 2,
  MAX_WALLET: 1 << 3,
  MAX_TX: 1 << 4
});

/** Highest bit the current contract understands (mirrors CAP_KNOWN_MASK). */
export const CAP_KNOWN_MASK = (1 << 5) - 1;

/** Human-readable definition of every advanced capability. */
export const CAPABILITIES = Object.freeze([
  {
    bit: CAP.MINTABLE,
    id: 'mintable',
    labelKey: 'launch.cap.mintable',
    warnKey: 'launch.cap.mintableWarn',
    risk: 20,
    riskKey: 'launch.risk.finding.mintable'
  },
  {
    bit: CAP.BURNABLE,
    id: 'burnable',
    labelKey: 'launch.cap.burnable',
    warnKey: 'launch.cap.burnableWarn',
    risk: 5,
    riskKey: 'launch.risk.finding.burnable'
  },
  {
    bit: CAP.PAUSABLE,
    id: 'pausable',
    labelKey: 'launch.cap.pausable',
    warnKey: 'launch.cap.pausableWarn',
    risk: 15,
    riskKey: 'launch.risk.finding.pausable'
  },
  {
    bit: CAP.MAX_WALLET,
    id: 'maxWallet',
    labelKey: 'launch.cap.maxWallet',
    warnKey: 'launch.cap.maxWalletWarn',
    risk: 10,
    riskKey: 'launch.risk.finding.maxWallet'
  },
  {
    bit: CAP.MAX_TX,
    id: 'maxTx',
    labelKey: 'launch.cap.maxTx',
    warnKey: 'launch.cap.maxTxWarn',
    risk: 10,
    riskKey: 'launch.risk.finding.maxTx'
  }
]);

export function hasCap(bitmap, bit) {
  return Boolean(Number(bitmap || 0) & Number(bit));
}

export function capsToBitmap(caps = {}) {
  let out = 0;
  for (const def of CAPABILITIES) if (caps[def.id]) out |= def.bit;
  return out;
}

export function bitmapToCaps(bitmap) {
  const out = {};
  for (const def of CAPABILITIES) out[def.id] = hasCap(bitmap, def.bit);
  return out;
}

/**
 * Validate a user-facing token spec. Returns { ok, value, errors }.
 * Every check here is duplicated by the contract — this layer exists so the
 * UI (and the API) reject the same things the chain will, BEFORE the user
 * pays a signature prompt for a guaranteed revert.
 */
export function validateTokenSpec(spec = {}) {
  const errors = [];
  const name = String(spec.name ?? '').trim();
  const symbol = String(spec.symbol ?? '').trim().toUpperCase();
  const decimals = Number(spec.decimals ?? 18);
  const supply = String(spec.supply ?? '').trim();

  if (!name) errors.push('NAME_REQUIRED');
  if (name.length > 64) errors.push('NAME_TOO_LONG');
  if (!symbol) errors.push('SYMBOL_REQUIRED');
  if (symbol.length > 32) errors.push('SYMBOL_TOO_LONG');
  if (!/^[A-Z0-9.+-]+$/.test(symbol)) errors.push('SYMBOL_INVALID');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) errors.push('DECIMALS_INVALID');

  let supplyWei = null;
  if (!/^\d+$/.test(supply)) {
    errors.push('SUPPLY_INVALID');
  } else {
    const supplyBig = BigInt(supply) * 10n ** BigInt(decimals);
    if (supplyBig === 0n) errors.push('SUPPLY_ZERO');
    // Above 2^200 the number is far beyond anything a 512-bit UI can show;
    // the contract would still accept it, so we cap here for sanity.
    if (supplyBig > 2n ** 200n) errors.push('SUPPLY_TOO_LARGE');
    supplyWei = supplyBig;
  }

  // Detect UNKNOWN capability keys up front. capsToBitmap() only knows the
  // five real powers, so an unknown key would otherwise be silently dropped —
  // the user would believe they enabled a power that never reaches the chain.
  // Rejecting loudly keeps the UI and the contract honest with each other.
  const capsObj = spec.caps || {};
  if (Object.keys(capsObj).some((k) => !CAPABILITIES.some((c) => c.id === k))) {
    errors.push('CAPABILITY_UNKNOWN');
  }
  const caps = capsToBitmap(capsObj);
  if (caps & ~CAP_KNOWN_MASK) errors.push('CAPABILITY_UNKNOWN');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      name,
      symbol,
      decimals,
      supplyHuman: supply || '0',
      supplyWei: supplyWei == null ? '0' : supplyWei.toString(),
      capabilities: caps
    }
  };
}
