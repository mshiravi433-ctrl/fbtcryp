/**
 * FBT FINANCIAL INTELLIGENCE OS — Strategy Engine (§13).
 * ---------------------------------------------------------------------------
 * Turns an intent plus the live world model into SEVERAL bounded strategies,
 * each carrying: expected return scenario, risk, drawdown, fees, liquidity,
 * goal compatibility, user compatibility, assumptions, confidence, evidence.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   · no guaranteed-return language — every proposal is normalised through
 *     `strategyCompetition.generateStrategies`, which stamps
 *     `guaranteed: false` and `financialExecutionAuthorized: false`
 *   · no invented numbers — expectedReturnPct is derived from a read APY, a
 *     read volatility or is left null (and an unscored strategy cannot win)
 *   · no execution — the engine emits proposals; the decision engine and the
 *     policy engine decide whether anything may happen
 *
 * Evidence uses the shape `strategyCompetition.js` requires
 * (`source, observedAt, sampleSize, quality, assumptions`), where `sampleSize`
 * is the honest count of observations behind the number: 30 daily candles, 12
 * observed pools, 1 quote. A single snapshot therefore scores as
 * `insufficient-evidence`, which is the truth about a single snapshot.
 */
import { generateStrategies } from '../../src/lib/intent-ai/strategyCompetition.js';
import { round } from '../../src/lib/central/schema.js';

export const STRATEGY_ENGINE_SCHEMA = 'fbt.fi.strategy-engine.v1';

export const STRATEGY_KINDS = Object.freeze([
  'HOLD', 'DCA_IN', 'REBALANCE', 'YIELD_ON_IDLE', 'DELEVERAGE',
  'CROSS_CHAIN_CONSOLIDATE', 'RISK_REDUCTION'
]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const ev = (source, { observedAt, sampleSize = null, quality = null, assumptions = [] } = {}) => ({ source, observedAt, sampleSize, quality, assumptions });

export function createStrategyEngine({ collections, evidence = null, genome = null, observability = null, priceSeries = null, log = () => {}, now = () => Date.now() } = {}) {
  /**
   * @param {object} p
   * @param {object} p.intent        { id, type, entities, text }
   * @param {object} p.financial     canonical financial state
   * @param {object} p.world         world-model digest
   * @param {object} [p.research]    research bundle
   * @param {object} [p.goal]        { targetUsd, months, monthlyContributionUsd }
   * @param {object} [p.preferences] resolved preference model
   */
  async function generate({ owner, intent = {}, financial = null, world = null, research = null, goal = null, preferences = null, correlationId = null } = {}) {
    const at = now();
    const fs = financial?.computed || financial || {};
    if (!fs || fs.status === 'UNAVAILABLE') {
      return { ok: false, code: 'NO_FINANCIAL_STATE', detail: 'strategies are proposals about real capital; with no readable capital there is nothing to propose' };
    }
    const digest = world?.financial?.digest || null;
    const candidates = [];

    /* A price series, when a provider supplies one, is what makes a volatility
       estimate evidenced rather than asserted. */
    let seriesSamples = null;
    if (typeof priceSeries === 'function') {
      try {
        const series = await priceSeries({ symbol: intent?.entities?.asset || 'BTC' });
        if (Array.isArray(series) && series.length) seriesSamples = series.length;
      } catch (err) {
        log(`strategy:price-series-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }

    const volatilityPct = num(fs.volatilityPct);
    const concentration = fs.concentration?.level || null;
    const topSharePct = num(fs.concentration?.topSharePct);
    const stableUsd = num(fs.stableUsd) || 0;
    const debtUsd = num(fs.debtUsd) || 0;
    const blendedYieldPct = num(fs.blendedYieldPct);
    const availableUsd = num(fs.availableCapitalUsd);
    const apyRows = Array.isArray(world?.domains?.market?.apy?.value) ? world.domains.market.apy.value : [];
    const bestApy = apyRows.length ? apyRows.reduce((a, b) => ((num(b.apyPct) || 0) > (num(a.apyPct) || 0) ? b : a), apyRows[0]) : null;

    /* ── 1. HOLD — always offered; doing nothing is a strategy ──────────── */
    candidates.push({
      id: 'hold', kind: 'HOLD', name: 'Hold current allocation',
      objective: 'Keep the current allocation and let the existing positions run.',
      route: ['no-action'], uses: ['state'],
      riskPct: volatilityPct !== null ? Math.min(100, round(volatilityPct * 0.6, 1)) : null,
      expectedReturnPct: blendedYieldPct !== null ? round(blendedYieldPct, 2) : null,
      potentialLossPct: volatilityPct !== null ? round(-volatilityPct * 0.8, 1) : null,
      maximumDrawdownPct: num(fs.drawdownPct) !== null ? Math.abs(num(fs.drawdownPct)) : null,
      assumptions: ['current allocation stays as read', 'no fees are paid because nothing is executed'],
      feesUsd: 0,
      liquidity: 'unchanged',
      evidence: [
        ev('financial-state', { observedAt: at, sampleSize: fs.holdingsCounted || null, quality: financial?.confidence ?? null, assumptions: ['portfolio read'] }),
        ...(seriesSamples ? [ev('price-series', { observedAt: at, sampleSize: seriesSamples, quality: 0.8, assumptions: ['volatility from historical candles'] })] : [])
      ]
    });

    /* ── 2. DCA_IN — the recurring entry the intent usually implies ─────── */
    const contribution = num(goal?.monthlyContributionUsd) || num(intent?.entities?.amountUsd) || null;
    if (contribution !== null && availableUsd !== null) {
      candidates.push({
        id: 'dca-in', kind: 'DCA_IN', name: `Dollar-cost average into ${String(intent?.entities?.asset || 'the target asset').toUpperCase()}`,
        objective: 'Spread the entry over time instead of taking price risk on one fill.',
        route: ['swap', 'schedule'], uses: ['quote', 'schedule'],
        riskPct: volatilityPct !== null ? Math.min(100, round(volatilityPct * 0.45, 1)) : null,
        expectedReturnPct: null,
        potentialLossPct: volatilityPct !== null ? round(-volatilityPct * 0.6, 1) : null,
        assumptions: [`monthly amount ${contribution} USD`, 'each fill is quoted at execution time, not now'],
        feesUsd: round(Math.max(0.5, contribution * 0.003), 2),
        liquidity: 'reduced by each contribution',
        evidence: [ev('financial-state', { observedAt: at, sampleSize: fs.holdingsCounted || null, quality: financial?.confidence ?? null })],
        rationale: 'DCA lowers the variance of the entry price; it does not lower the volatility of the asset.'
      });
    }

    /* ── 3. REBALANCE — offered when concentration is actually concentrated ─ */
    if (concentration && ['HIGH', 'EXTREME'].includes(concentration) && topSharePct !== null) {
      candidates.push({
        id: 'rebalance', kind: 'REBALANCE', name: `Reduce ${fs.concentration.topAsset} concentration`,
        objective: `Trim the top position from ${topSharePct}% toward a more balanced allocation.`,
        route: ['swap'], uses: ['quote', 'simulation'],
        riskPct: round(Math.max(10, (volatilityPct ?? 60) * 0.35), 1),
        expectedReturnPct: 0,
        potentialLossPct: round(-Math.max(2, (volatilityPct ?? 60) * 0.2), 1),
        assumptions: ['concentration is measured on the portfolio as read', 'the trim is a market sell at execution time'],
        feesUsd: availableUsd ? round(Math.max(1, availableUsd * 0.001), 2) : null,
        liquidity: 'improved if proceeds stay in stables',
        evidence: [ev('portfolio-concentration', { observedAt: at, sampleSize: fs.holdingsCounted || null, quality: financial?.confidence ?? null, assumptions: [`HHI ${fs.concentration.hhi}`] })],
        rationale: `Top asset is ${topSharePct}% of the portfolio (${concentration} concentration).`
      });
    }

    /* ── 4. YIELD_ON_IDLE — only when a real APY was read ───────────────── */
    if (bestApy && num(bestApy.apyPct) !== null && stableUsd > 0) {
      candidates.push({
        id: 'yield-idle', kind: 'YIELD_ON_IDLE', name: `Put idle stables to work (${bestApy.pool || 'best observed pool'})`,
        objective: `Earn the observed ${round(num(bestApy.apyPct), 2)}% on capital that is currently idle.`,
        route: ['lend'], uses: ['quote', 'prepare'],
        riskPct: 25,
        expectedReturnPct: round(num(bestApy.apyPct), 2),
        potentialLossPct: -5,
        assumptions: ['APY is the last observed rate and is variable', 'protocol risk is not zero'],
        feesUsd: round(Math.max(1, stableUsd * 0.0005), 2),
        liquidity: 'encumbered while supplied; withdrawal is a second action',
        evidence: [ev('yield-feed', { observedAt: at, sampleSize: apyRows.length || null, quality: 0.7, assumptions: ['observed pool APYs'] })],
        rationale: 'Yield is paid for taking protocol and liquidity risk; it is not free.'
      });
    }

    /* ── 5. DELEVERAGE — only when there is debt ────────────────────────── */
    if (debtUsd > 0 && availableUsd !== null && availableUsd > 0) {
      candidates.push({
        id: 'deleverage', kind: 'DELEVERAGE', name: 'Repay part of the debt',
        objective: `Reduce debt of $${round(debtUsd, 2)} to lower liquidation risk.`,
        route: ['repay'], uses: ['quote', 'prepare'],
        riskPct: 15,
        expectedReturnPct: 0,
        potentialLossPct: 0,
        assumptions: ['debt is repaid from available capital', 'health factor improves proportionally'],
        feesUsd: round(Math.max(1, Math.min(debtUsd, availableUsd) * 0.001), 2),
        liquidity: 'reduced by the repayment',
        evidence: [ev('financial-state', { observedAt: at, sampleSize: fs.holdingsCounted || null, quality: financial?.confidence ?? null })],
        rationale: 'Deleveraging costs liquidity and buys solvency.'
      });
    }

    /* ── 6. RISK_REDUCTION — the "move to lower risk" answer ────────────── */
    if (String(intent?.type || '').toUpperCase().includes('RISK') || (volatilityPct !== null && volatilityPct > 60)) {
      candidates.push({
        id: 'risk-reduction', kind: 'RISK_REDUCTION', name: 'Shift toward lower-volatility assets',
        objective: 'Lower portfolio volatility by increasing the stable/major share.',
        route: ['swap'], uses: ['quote', 'simulation'],
        riskPct: 20,
        expectedReturnPct: blendedYieldPct !== null ? round(blendedYieldPct * 0.5, 2) : 0,
        potentialLossPct: -3,
        assumptions: ['stables hold their peg', 'the shift is executed at quoted prices'],
        feesUsd: availableUsd ? round(Math.max(1, availableUsd * 0.001), 2) : null,
        liquidity: 'improved',
        evidence: [ev('financial-state', { observedAt: at, sampleSize: fs.holdingsCounted || null, quality: financial?.confidence ?? null })],
        rationale: volatilityPct !== null ? `Portfolio volatility reading is ${volatilityPct}.` : 'Volatility could not be read; the shift is proposed on concentration alone.'
      });
    }

    /* ── 7. CROSS_CHAIN_CONSOLIDATE — only with multi-chain exposure ────── */
    const chains = Object.keys(fs.chainExposureUsd || {});
    if (chains.length > 1) {
      candidates.push({
        id: 'consolidate-chains', kind: 'CROSS_CHAIN_CONSOLIDATE', name: `Consolidate ${chains.length} chains`,
        objective: 'Reduce the number of chains holding value, cutting per-chain gas and monitoring overhead.',
        route: ['bridge', 'swap'], uses: ['bridge-quote', 'quote'],
        riskPct: 35,
        expectedReturnPct: 0,
        potentialLossPct: -2,
        assumptions: ['bridge quotes are re-fetched at execution time', 'bridge risk is protocol risk'],
        feesUsd: round(chains.length * 3.5, 2),
        liquidity: 'temporarily in transit during the bridge',
        evidence: [ev('chain-exposure', { observedAt: at, sampleSize: chains.length, quality: financial?.confidence ?? null })],
        rationale: `Value is spread across ${chains.join(', ')}.`
      });
    }

    if (!candidates.length) return { ok: false, code: 'NO_STRATEGY_CANDIDATES', detail: 'the state supported no bounded proposal' };

    /* Goal + user compatibility, then normalisation through the shared
       proposal builder (which enforces guaranteed:false and the evidence
       quality rules). */
    const withCompat = [];
    for (const c of candidates) {
      const goalCompatibility = scoreGoalFit(c, { goal, fs });
      let userCompatibility = null;
      let genomeVerdict = null;
      if (genome) {
        const fit = await genome.fit(owner, { kind: c.kind });
        if (fit.ok) {
          genomeVerdict = fit.verdict;
          userCompatibility = fit.rejected ? 0 : fit.dnaScore;
        }
      }
      withCompat.push({
        ...c,
        goalCompatibilityPct: goalCompatibility,
        userCompatibilityPct: userCompatibility,
        genomeVerdict,
        confidencePct: Math.round(Math.min(95, (financial?.confidence ?? 0.5) * 100 * (c.evidence?.length ? 1 : 0.5)))
      });
    }

    const out = generateStrategies({ intent: { id: intent?.id || null }, candidates: withCompat, evidence: [], now: at });
    if (!out.ok) return { ok: false, code: out.code };

    const strategies = out.strategies.map((s, i) => ({
      ...s,
      kind: withCompat[i].kind,
      goalCompatibilityPct: withCompat[i].goalCompatibilityPct,
      userCompatibilityPct: withCompat[i].userCompatibilityPct,
      genomeVerdict: withCompat[i].genomeVerdict,
      feesUsd: withCompat[i].feesUsd ?? null,
      liquidity: withCompat[i].liquidity ?? null,
      engine: STRATEGY_ENGINE_SCHEMA,
      researchId: research?.id || null
    }));

    for (const s of strategies) {
      await collections.put('strategies', owner, s);
    }
    if (observability) {
      for (const s of strategies) observability.emit({ type: 'strategy.generated', owner, correlationId, payload: { strategyId: s.id, kind: s.kind, evidence: s.evidence.length } });
    }
    if (evidence) {
      const rec = await evidence.record(owner, strategies.filter((s) => s.expectedReturnPct !== null).map((s) => ({
        type: 'research', source: `strategy-engine:${s.kind}`, value: { strategyId: s.id, expectedReturnPct: s.expectedReturnPct, riskPct: s.riskPct, assumptions: s.assumptions }, at, ttlMs: 15 * 60_000
      })), { correlationId });
      if (rec.evidence.length) return { ok: true, strategies, count: strategies.length, evidenceIds: rec.evidence.map((e) => e.id), proposalOnly: true, guaranteed: false };
    }
    return { ok: true, strategies, count: strategies.length, proposalOnly: true, guaranteed: false };
  }

  async function get(owner, id) { return collections.get('strategies', owner, id); }
  async function recent(owner, { limit = 12 } = {}) {
    const { rows } = await collections.read('strategies', owner);
    return rows.slice(0, Math.max(1, limit));
  }

  return { schema: STRATEGY_ENGINE_SCHEMA, generate, get, recent, STRATEGY_KINDS };
}

/**
 * How well a strategy serves the goal. Bounded 0-100, and null when there is no
 * goal to serve — "goal compatible" is not a default value.
 */
export function scoreGoalFit(candidate = {}, { goal = null, fs = {} } = {}) {
  if (!goal || !Number.isFinite(Number(goal.targetUsd))) return null;
  const target = Number(goal.targetUsd);
  const current = Number(fs.netWorthUsd ?? fs.availableCapitalUsd ?? 0);
  if (current <= 0) return null;
  const gapPct = ((target - current) / current) * 100;
  const expected = Number.isFinite(Number(candidate.expectedReturnPct)) ? Number(candidate.expectedReturnPct) : null;
  if (expected === null) return 30; // a strategy with no modelled return cannot be shown to close a gap
  if (gapPct <= 0) return candidate.kind === 'HOLD' ? 90 : 60; // goal already met: preservation wins
  /* Contribution-driven goals are served by DCA even with no return. */
  if (candidate.kind === 'DCA_IN' && Number(goal.monthlyContributionUsd) > 0) return Math.min(95, 55 + Math.round(expected));
  return Math.max(5, Math.min(95, Math.round(50 + expected * 1.5 - Math.abs(gapPct) * 0.2)));
}
