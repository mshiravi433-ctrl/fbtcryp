/**
 * FBT Insurance OS — Portfolio Risk Engine + Coverage Gap (§13, §14).
 *
 * Input: a wallet exposure report (the client/aggregator supplies real balances
 * & positions — the server never invents balances). Output: per-kind risk
 * bands, an overall risk score, eligible exposure, active coverage and the
 * uncovered gap. The engine RECOMMENDS; it never buys.
 *
 * All money math is integer micro-units (BigInt).
 */
import { toMicro, fromMicro, RISK_BANDS } from './constants.js';

const KIND_LABEL = {
  smartContract: 'Smart Contract',
  bridge: 'Bridge',
  stablecoin: 'Stablecoin',
  lending: 'Lending',
  lp: 'LP',
  wallet: 'Wallet',
  oracle: 'Oracle',
  protocol: 'DeFi Protocol'
};

/** Baseline risk weight per exposure kind (0..1) — configurable via admin. */
const BASE_WEIGHT = {
  smartContract: 0.35,
  bridge: 0.4,
  stablecoin: 0.2,
  lending: 0.3,
  lp: 0.55,
  wallet: 0.15,
  oracle: 0.5,
  protocol: 0.5
};

/** Multipliers applied to a chain's / protocol's risk band. */
const BAND_FACTOR = { LOW: 0.8, MEDIUM: 1.0, HIGH: 1.35, CRITICAL: 1.9 };

export function bandScore(risk) {
  const n = Number(risk ?? 0);
  if (n >= 0.7) return RISK_BANDS.CRITICAL;
  if (n >= 0.45) return RISK_BANDS.HIGH;
  if (n >= 0.22) return RISK_BANDS.MEDIUM;
  return RISK_BANDS.LOW;
}

/**
 * Analyse an exposure report.
 * report = { exposures: [ { kind, amountMicro(integer BigInt|string), chainId,
 *                          protocol?, protocolRiskBand?, label? } ],
 *            activeCoverage: [ { kind, amountMicro } ] }
 */
export function analysePortfolioRisk(report = {}) {
  const exposures = Array.isArray(report.exposures) ? report.exposures : [];
  const coverage = Array.isArray(report.activeCoverage) ? report.activeCoverage : [];

  const byKind = new Map();
  let totalExposure = 0n;
  for (const e of exposures) {
    const amt = typeof e.amountMicro === 'bigint' ? e.amountMicro : toMicro(e.amountMicro);
    if (amt === null || amt <= 0n) continue;
    totalExposure += amt;
    const rec = byKind.get(e.kind) || { kind: e.kind, exposureMicro: 0n, protocolRisk: null };
    rec.exposureMicro += amt;
    if (e.protocolRiskBand && BAND_FACTOR[e.protocolRiskBand]) rec.protocolRisk = Math.max(rec.protocolRisk || 0, BAND_FACTOR[e.protocolRiskBand]);
    byKind.set(e.kind, rec);
  }

  const kindRows = [];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const { kind, exposureMicro, protocolRisk } of byKind.values()) {
    const base = BASE_WEIGHT[kind] ?? 0.3;
    const mult = protocolRisk && protocolRisk > 1 ? protocolRisk : 1;
    const risk = Math.min(1, base * mult);
    const amt = exposureMicro;
    // coverage applied per kind
    const covered = coverage
      .filter((c) => c.kind === kind)
      .reduce((acc, c) => acc + (typeof c.amountMicro === 'bigint' ? c.amountMicro : toMicro(c.amountMicro) || 0n), 0n);
    const gapMicro = amt > covered ? amt - covered : 0n;
    kindRows.push({
      kind,
      label: KIND_LABEL[kind] || kind,
      exposureMicro: amt,
      exposureUsd: fromMicro(amt),
      coveredMicro: covered,
      gapMicro,
      gapUsd: fromMicro(gapMicro),
      riskBand: bandScore(risk),
      risk,
      coveredRatio: amt > 0n ? Number((covered * 100n) / amt) : 100
    });
    // weight by exposure for the portfolio-level score
    const w = Number(amt);
    weightedSum += risk * w;
    weightTotal += w;
  }

  const overallRisk = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const totalCoverage = coverage.reduce((a, c) => a + (typeof c.amountMicro === 'bigint' ? c.amountMicro : toMicro(c.amountMicro) || 0n), 0n);
  const totalGapMicro = totalExposure > totalCoverage ? totalExposure - totalCoverage : 0n;

  return {
    totalExposureMicro: totalExposure,
    totalExposureUsd: fromMicro(totalExposure),
    totalCoverageMicro: totalCoverage,
    totalCoverageUsd: fromMicro(totalCoverage),
    coverageGapMicro: totalGapMicro,
    coverageGapUsd: fromMicro(totalGapMicro),
    overallRisk,
    overallRiskBand: bandScore(overallRisk),
    kinds: kindRows.sort((a, b) => (b.gapMicro > a.gapMicro ? 1 : -1))
  };
}

/** Summary used by coverage-gap UI: eligible exposure, active coverage, gap. */
export function coverageGap(riskAnalysis) {
  return {
    eligibleExposureUsd: riskAnalysis.totalExposureUsd,
    eligibleExposureMicro: riskAnalysis.totalExposureMicro,
    activeCoverageUsd: riskAnalysis.totalCoverageUsd,
    activeCoverageMicro: riskAnalysis.totalCoverageMicro,
    coverageGapUsd: riskAnalysis.coverageGapUsd,
    coverageGapMicro: riskAnalysis.coverageGapMicro,
    percentProtected: riskAnalysis.totalExposureMicro > 0n
      ? Number((riskAnalysis.totalCoverageMicro * 100n) / riskAnalysis.totalExposureMicro)
      : 100
  };
}
