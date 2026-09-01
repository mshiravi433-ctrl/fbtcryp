/**
 * FBT WALLET ENGINE — TRANSACTION SIMULATION ENGINE
 * ---------------------------------------------------------------------------
 * Before a user signs, the app computes the most likely outcome: how much is
 * received, what the gas costs, how the balance changes, and how risky the
 * destination contract is. This is the arithmetic half of pre-sign safety —
 * the on-chain half (a real `eth_call` against the next block's state) already
 * exists in `src/lib/preSignSimulation.js`, and `mergeSimulation()` joins the
 * two into one verdict the UI can render.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · This is a PREDICTION, not a guarantee. `received` is `null` when the quote
 *   is missing — a missing quote is never coerced to zero.
 * · The on-chain verdict (`simulated-clean` / `revert-detected` /
 *   `provider-busy` / `unknown`) is the safety gate; the arithmetic is the
 *   preview. A `provider-busy` chain result keeps the merged verdict blocked,
 *   because a failed simulation must never read as "safe".
 * · Contract risk returns `level: 'unknown'` when there is nothing to measure;
 *   absence of data is not absence of risk.
 */

export const SIMULATION_SCHEMA = 'fbt.simulation.v1';

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Arithmetic outcome of a swap/send, computed from the quote the UI already
 * shows. Pure — no chain, no provider.
 */
export function simulateOutcome({
  amountIn = null,        // human units of the input asset
  priceInUsd = null,      // $ per unit of input
  priceOutUsd = null,     // $ per unit of output
  received = null,        // human units expected out (from the quote)
  feeUsd = null,          // platform/aggregator fee in dollars
  gasNative = null,       // gas in native units (e.g. ETH)
  gasPriceUsd = null,     // native coin price in dollars
  balanceBeforeUsd = null // total portfolio value before the trade
} = {}) {
  const amtIn = num(amountIn);
  const recv = num(received);
  const valueInUsd = amtIn != null && priceInUsd != null ? amtIn * priceInUsd : null;
  const valueOutUsd = recv != null && priceOutUsd != null ? recv * priceOutUsd : null;
  const gasCostUsd = num(gasNative) != null && num(gasPriceUsd) != null ? num(gasNative) * num(gasPriceUsd) : null;
  const fee = num(feeUsd) ?? 0;
  const totalCostUsd = valueInUsd != null ? valueInUsd + fee + (gasCostUsd ?? 0) : null;
  const balanceAfterUsd = balanceBeforeUsd != null && gasCostUsd != null
    ? balanceBeforeUsd - gasCostUsd - fee
    : null;
  const priceImpactPct = valueInUsd != null && valueOutUsd != null && valueInUsd > 0
    ? ((valueInUsd - valueOutUsd) / valueInUsd) * 100
    : null;

  return {
    schema: SIMULATION_SCHEMA,
    amountIn: amtIn,
    received: recv,
    valueInUsd,
    valueOutUsd,
    feeUsd: fee,
    gasNative: num(gasNative),
    gasCostUsd,
    totalCostUsd,
    balanceBeforeUsd: num(balanceBeforeUsd),
    balanceAfterUsd,
    priceImpactPct,
    /* The honest flag the UI renders: what changed and by how much. */
    deltaUsd: balanceAfterUsd != null && balanceBeforeUsd != null ? balanceAfterUsd - balanceBeforeUsd : null
  };
}

/**
 * Destination-contract risk, from real scan signals (injected — this engine
 * never calls a scanner itself). Returns `{ level, flags, score }` where
 * score is 0 (cleanest) … 100 (do not touch), and level is one of
 * `none | low | medium | high | unknown`.
 */
export function contractRisk({ verified = null, honeypot = null, holders = null, ageDays = null, score = null } = {}) {
  const flags = [];
  let signals = 0;
  let s = num(score);

  if (s == null) {
    /* No explicit score → derive one from the scan signals the caller had.
       Every signal that is actually present counts toward "we have data". */
    s = 0;
    if (honeypot != null) { signals += 1; if (honeypot === true) { s += 60; flags.push('honeypot'); } }
    if (verified != null) { signals += 1; if (verified === false) { s += 20; flags.push('unverified'); } }
    if (num(holders) != null) { signals += 1; if (num(holders) < 50) { s += 10; flags.push('low-holders'); } }
    if (num(ageDays) != null) { signals += 1; if (num(ageDays) < 30) { s += 10; flags.push('young-contract'); } }
    if (signals === 0) return { level: 'unknown', flags: [], score: null, reason: 'no scan data' };
  }

  const clamped = Math.max(0, Math.min(100, Math.round(s)));
  const level = clamped >= 60 ? 'high' : clamped >= 30 ? 'medium' : clamped > 0 ? 'low' : 'none';
  return { level, flags, score: clamped };
}

/**
 * Merge the on-chain `eth_call` verdict with the arithmetic outcome into a
 * single pre-sign verdict.
 *
 * `ethCallVerdict` — one of the strings produced by preSignSimulation.js:
 *   'simulated-clean' | 'revert-detected' | 'provider-busy' | 'unknown'
 */
export function mergeSimulation(ethCallVerdict = 'unknown', outcome = {}, risk = {}) {
  const v = String(ethCallVerdict || 'unknown');
  const safeToSign = v === 'simulated-clean';
  const blocked = v === 'revert-detected' || v === 'provider-busy';
  const level = v === 'revert-detected' ? 'high'
    : v === 'provider-busy' ? 'medium'
      : v === 'simulated-clean' ? 'none'
        : 'unknown';
  return {
    schema: 'fbt.simulation-verdict.v1',
    onChain: v,
    safeToSign,
    blocked,
    level,
    risk: risk || {},
    outcome: outcome || {}
  };
}
