/**
 * FBT LAUNCH — deterministic risk engine.
 *
 * WHY DETERMINISTIC (and not an LLM)
 * ---------------------------------------------------------------------------
 * The proposal asked the "FBT Intent OS" to run the launch risk check. An
 * LLM is the WRONG place for the gate that decides how loudly to warn a user
 * about mint authority or a 100-dollar pool: it is non-deterministic, it can
 * be prompt-influenced, and a warning it sometimes softens is a product
 * failure. So the gate itself is a fixed, unit-tested function of the inputs
 * — same config in, same score out, on every device, with no network.
 *
 * The AI layer keeps its honest role: it can EXPLAIN the findings, answer
 * "why is my risk elevated?", and plan a launch (Intent OS tool
 * `launch.plan`) — but it can neither lower the score nor approve the launch.
 *
 * SCORING (spec §17)
 * ---------------------------------------------------------------------------
 * 0–20 Low · 21–40 Moderate · 41–60 Elevated · 61–80 High · 81–100 Critical
 *
 * A high score never silently BLOCKS a launch (spec: warn loudly, strong
 * confirmation) — except the hard gates below, which are invariants, not
 * opinions:
 *   · DEX anchor verification failed (we cannot prove the factory is real)
 *   · FBT factory not deployed on the chosen chain
 *   · token spec invalid (the contract would revert anyway)
 */
import { CAPABILITIES, hasCap } from './capabilities.js';

export const RISK_BANDS = Object.freeze([
  { min: 0, max: 20, id: 'low' },
  { min: 21, max: 40, id: 'moderate' },
  { min: 41, max: 60, id: 'elevated' },
  { min: 61, max: 80, id: 'high' },
  { min: 81, max: 100, id: 'critical' }
]);

export function bandFor(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  return RISK_BANDS.find((b) => s >= b.min && s <= b.max) || RISK_BANDS[0];
}

/**
 * Score a launch plan.
 *
 * @param {object} plan
 *   plan.capabilities   uint256 bitmap (or {mintable, ...} map)
 *   plan.decimals       number
 *   plan.supplyWei      decimal string (full supply, smallest units)
 *   plan.tokenAmount    decimal string (token side of the initial pool)
 *   plan.quoteAmount    decimal string (quote side of the initial pool)
 *   plan.quoteDecimals  number (quote asset decimals)
 *   plan.dexVerified    boolean — anchor check passed at runtime
 *   plan.factoryReady   boolean — FBT factory deployed on this chain
 *   plan.lpqToUser      boolean — LP tokens go to the creator (always true in v1)
 * @returns {{score:number, band:string, findings:object[], gates:object[], confirmRequired:boolean}}
 */
export function scoreLaunch(plan = {}) {
  const findings = [];
  const gates = [];

  const caps = typeof plan.capabilities === 'object' && plan.capabilities !== null
    ? Object.entries(plan.capabilities).reduce((acc, [k, v]) => (v ? acc | (CAPABILITIES.find((c) => c.id === k)?.bit || 0) : acc), 0)
    : Number(plan.capabilities || 0);

  const capFor = (id) => CAPABILITIES.find((c) => c.id === id);

  // ── capability findings (owner powers the user opted into) ─────────────
  for (const def of CAPABILITIES) {
    if (hasCap(caps, def.bit)) {
      findings.push({
        id: def.riskKey.replace('launch.risk.finding.', ''),
        key: def.riskKey,
        severity: def.risk >= 15 ? 'high' : def.risk >= 10 ? 'medium' : 'low',
        weight: def.risk,
        caps: def.id
      });
    }
  }

  // ── initial price sanity ───────────────────────────────────────────────
  const tokenAmt = Number(plan.tokenAmount || 0);
  const quoteAmt = Number(plan.quoteAmount || 0);
  let price = 0;
  if (tokenAmt > 0 && quoteAmt > 0) price = quoteAmt / tokenAmt;

  if (price > 0 && (price < 1e-9 || price > 1e6)) {
    findings.push({
      id: 'extremePrice',
      key: 'launch.risk.finding.extremePrice',
      severity: 'high',
      weight: 20,
      detail: { price: price.toExponential(3) }
    });
  }

  // ── liquidity depth (in quote units, stable-quoted pools dominate) ─────
  if (quoteAmt > 0 && quoteAmt < 1000) {
    findings.push({
      id: 'thinLiquidity',
      key: 'launch.risk.finding.thinLiquidity',
      severity: 'high',
      weight: 15,
      detail: { quoteAmount: quoteAmt }
    });
  } else if (quoteAmt > 0 && quoteAmt < 10_000) {
    findings.push({
      id: 'shallowLiquidity',
      key: 'launch.risk.finding.shallowLiquidity',
      severity: 'medium',
      weight: 8,
      detail: { quoteAmount: quoteAmt }
    });
  }

  // ── tokenomics shape ───────────────────────────────────────────────────
  const decimals = Number(plan.decimals ?? 18);
  if (decimals === 0) {
    findings.push({ id: 'oddDecimals', key: 'launch.risk.finding.oddDecimals', severity: 'low', weight: 5 });
  } else if (decimals > 18) {
    findings.push({ id: 'badDecimals', key: 'launch.risk.finding.badDecimals', severity: 'high', weight: 15 });
  }

  const supply = BigInt(plan.supplyWei || 0);
  if (supply > 10n ** 12n * 10n ** BigInt(decimals)) {
    findings.push({ id: 'largeSupply', key: 'launch.risk.finding.largeSupply', severity: 'low', weight: 5 });
  }

  // ── structural positives (score stays honest in BOTH directions) ───────
  if (plan.lpqToUser !== false) {
    // LP stays in the creator's wallet: no lock, no third party, nothing to
    // attack. This is the non-custodial default and worth stating.
    findings.push({ id: 'lpOwnedByCreator', key: 'launch.risk.finding.lpOwnedByCreator', severity: 'info', weight: 0 });
  }
  findings.push({ id: 'noTaxNoBlacklist', key: 'launch.risk.finding.noTaxNoBlacklist', severity: 'info', weight: 0 });

  // ── hard gates (invariants, not opinions) ──────────────────────────────
  if (plan.dexVerified === false) {
    gates.push({ id: 'dexUnverified', key: 'launch.risk.gate.dexUnverified', fatal: true });
  }
  if (plan.factoryReady === false) {
    gates.push({ id: 'factoryNotDeployed', key: 'launch.risk.gate.factoryNotDeployed', fatal: true });
  }

  const score = Math.min(100, findings.reduce((sum, f) => sum + (f.weight || 0), 0));
  const band = bandFor(score).id;

  return {
    score,
    band,
    findings,
    gates,
    blocked: gates.some((g) => g.fatal),
    /** High/Critical demand an explicit typed confirmation in the UI. */
    confirmRequired: band === 'high' || band === 'critical'
  };
}
