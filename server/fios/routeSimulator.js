/**
 * FBT FINANCIAL INTELLIGENCE OS — Live Route Simulator (Phase 11 runtime).
 * ---------------------------------------------------------------------------
 * The Phase 11 contract (`strategyCompetition.simulateRoute`) accepts an
 * injected `simulator` function. Until this module existed, the only place a
 * simulator was ever supplied was the probe — production always returned
 * `SIMULATOR_UNAVAILABLE` and Phase 11 stayed ready:false / live:false.
 *
 * This provider is the real runtime connector. It does NOT sign, does NOT
 * submit, and does NOT invent quotes. For each strategy it:
 *
 *   1. Models net output from the strategy's expected return / fees / risk
 *      against the owner's readable capital (or returns unavailable).
 *   2. Overlays execution costs: fees, gas, slippage, liquidity stress.
 *   3. Attaches observed evidence (price series length, APY sample, smart
 *      money window) so competition can only crown a provisional winner when
 *      evidence quality is `observed`.
 *   4. Labels every number `estimate: true` — never a promise, never an
 *      execution grant.
 *
 * Shape returned matches what `simulateRoute` expects:
 *   { ok, status:'passed'|'failed', output, fee, slippagePct, providerId, evidence }
 */
import { createHash } from 'node:crypto';
import { round } from '../../src/lib/central/schema.js';

export const ROUTE_SIMULATOR_SCHEMA = 'fbt.fi.route-simulator.v1';
export const ROUTE_SIMULATOR_PROVIDER_ID = 'fios-route-simulator';

/* null/undefined must stay null — Number(null) === 0 would invent a zero return. */
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Default slippage model. A strategy that moves more capital into thinner
 * books pays more — linear first-order approximation, labelled as such.
 */
function modelledSlippagePct({ tradeUsd = null, liquidity = null, riskPct = null } = {}) {
  const base = 0.15;
  const sizeBump = tradeUsd != null && tradeUsd > 50_000 ? Math.min(1.5, tradeUsd / 500_000) : 0;
  const liq = String(liquidity || '').toLowerCase();
  const liqBump = /encumber|transit|reduced/.test(liq) ? 0.25 : /improv/.test(liq) ? -0.05 : 0;
  const riskBump = riskPct != null ? Math.min(0.8, Number(riskPct) / 200) : 0;
  return round(Math.max(0.05, base + sizeBump + liqBump + riskBump), 3);
}

/**
 * Build the live simulator function that Phase 11's `simulateRoute` injects.
 *
 * @param {object} opts
 * @param {object} [opts.financial]  canonical financial state (or its computed)
 * @param {object} [opts.world]      world-model digest
 * @param {object} [opts.strategy]   full strategy row (kind, fees, risk, …)
 * @param {object} [opts.globalIntel]
 * @param {object} [opts.crossAsset]
 * @param {object} [opts.smartMoney] pre-fetched smart-money context
 * @param {number} [opts.now]
 */
export function createRouteSimulator({
  financial = null,
  world = null,
  strategiesById = null,
  globalIntel = null,
  crossAsset = null,
  smartMoney = null,
  now = () => Date.now()
} = {}) {
  /**
   * @param {{ strategyId, route, context }} args
   * @returns {Promise<object>} simulator result for simulateRoute
   */
  return async function routeSimulator({ strategyId, route = [], context = {} } = {}) {
    const at = typeof now === 'function' ? now() : now;
    const fs = financial?.computed || financial || {};
    const capital = num(fs.netWorthUsd ?? fs.availableCapitalUsd ?? context.capitalUsd);
    const strategy = (strategiesById && strategiesById.get?.(strategyId))
      || (strategiesById && strategiesById[strategyId])
      || context.strategy
      || null;

    /* HOLD / no-action routes still "pass" — net output is capital unchanged,
       fees are zero, evidence is the portfolio read itself. */
    const kind = String(strategy?.kind || context.kind || '').toUpperCase();
    const isNoAction = kind === 'HOLD' || (Array.isArray(route) && route.includes('no-action') && route.length === 1);

    if (!isNoAction && (capital === null || capital <= 0) && fs.status === 'UNAVAILABLE') {
      return {
        ok: false,
        status: 'failed',
        reason: 'NO_READABLE_CAPITAL',
        providerId: ROUTE_SIMULATOR_PROVIDER_ID
      };
    }

    const expectedReturnPct = num(strategy?.expectedReturnPct ?? context.expectedReturnPct) ?? 0;
    const feesUsd = num(strategy?.feesUsd ?? context.feesUsd) ?? 0;
    const riskPct = num(strategy?.riskPct ?? context.riskPct);
    const drawdownPct = num(strategy?.maximumDrawdownPct ?? strategy?.potentialLossPct);
    const tradeUsd = num(context.tradeUsd)
      ?? (kind === 'DCA_IN' ? num(context.contributionUsd) : null)
      ?? (capital !== null ? Math.min(capital * 0.1, capital) : null);

    const slippagePct = modelledSlippagePct({
      tradeUsd,
      liquidity: strategy?.liquidity || context.liquidity,
      riskPct
    });
    const slippageCostUsd = tradeUsd != null ? round((slippagePct / 100) * tradeUsd, 2) : 0;
    const totalFee = round(feesUsd + slippageCostUsd, 2);

    /* Gross modelled output: capital × (1 + expectedReturn/100). For HOLD the
       expected return is the blended yield already on the books; for others it
       is the strategy's own modelled band. Null expected return → capital
       unchanged (honest: we refuse to invent a gain). */
    const gross = capital != null
      ? round(capital * (1 + expectedReturnPct / 100), 2)
      : null;
    const output = gross != null ? round(Math.max(0, gross - totalFee), 2) : null;

    if (output === null && !isNoAction) {
      return {
        ok: false,
        status: 'failed',
        reason: 'OUTPUT_UNMODELLABLE',
        providerId: ROUTE_SIMULATOR_PROVIDER_ID
      };
    }

    /* Evidence rows — only from what was actually observed this pass. */
    const evidence = [];
    const holdingsCounted = num(fs.holdingsCounted);
    if (holdingsCounted != null || capital != null) {
      evidence.push({
        source: 'financial-state:route-sim',
        observedAt: at,
        sampleSize: holdingsCounted ?? 1,
        quality: financial?.confidence ?? 0.7,
        assumptions: ['portfolio read at simulation time']
      });
    }
    const apyRows = Array.isArray(world?.domains?.market?.apy?.value)
      ? world.domains.market.apy.value
      : [];
    if (apyRows.length && kind === 'YIELD_ON_IDLE') {
      evidence.push({
        source: 'yield-feed:route-sim',
        observedAt: at,
        sampleSize: apyRows.length,
        quality: 0.7,
        assumptions: ['observed pool APYs']
      });
    }
    const seriesN = num(context.seriesSamples);
    if (seriesN != null && seriesN >= 5) {
      evidence.push({
        source: 'price-series:route-sim',
        observedAt: at,
        sampleSize: seriesN,
        quality: 0.8,
        assumptions: ['historical candles for volatility']
      });
    }
    /* Smart-money window as evidence — observation, never a trade trigger. */
    const sm = smartMoney || globalIntel?.domains?.smart_money?.data || null;
    if (sm) {
      const eventCount = num(sm.whaleActivity?.count ?? sm.eventCount ?? sm.coverage?.inWindow) ?? 0;
      if (eventCount >= 1) {
        evidence.push({
          source: 'smart-money:route-sim',
          observedAt: at,
          sampleSize: eventCount, /* honest count — evidenceQuality needs ≥5 for 'observed' */
          quality: eventCount >= 5 ? 0.75 : 0.45,
          assumptions: ['labelled on-chain flow only', 'not a buy/sell signal']
        });
      }
    }
    const regime = crossAsset?.regime?.regime || strategy?.globalContext?.regime || null;
    if (regime) {
      evidence.push({
        source: 'market-regime:route-sim',
        observedAt: at,
        sampleSize: (crossAsset?.observedClasses || strategy?.globalContext?.observedClasses || []).length || 1,
        quality: 0.6,
        assumptions: [`regime ${regime}`, 'observation not forecast']
      });
    }

    /* Digest so the audit trail can prove which inputs produced this result. */
    const digest = createHash('sha256')
      .update(JSON.stringify({
        strategyId, kind, expectedReturnPct, feesUsd, slippagePct, capital, at
      }))
      .digest('hex')
      .slice(0, 16);

    return {
      ok: true,
      status: 'passed',
      schema: ROUTE_SIMULATOR_SCHEMA,
      providerId: ROUTE_SIMULATOR_PROVIDER_ID,
      strategyId,
      route,
      output: output ?? (capital != null ? capital : 0),
      fee: totalFee,
      slippagePct,
      gasUsd: null,
      drawdownPct: drawdownPct != null ? Math.abs(drawdownPct) : null,
      riskPct,
      expectedReturnPct,
      liquidity: strategy?.liquidity || null,
      regime,
      estimate: true,
      scenario: true,
      signs: false,
      submits: false,
      executionPermission: false,
      evidence,
      digest,
      checkedAt: at,
      note: 'Modelled route outcome from readable state + observed feeds. Not a quote lock and not an execution grant.'
    };
  };
}

/**
 * Run the Phase 11 simulateRoute over every strategy with the live provider.
 * Returns { simulations: Map/list, ranking-ready rows }.
 */
export async function simulateAllStrategies(strategies = [], {
  simulateRoute,
  financial = null,
  world = null,
  globalIntel = null,
  crossAsset = null,
  smartMoney = null,
  seriesSamples = null,
  now = Date.now()
} = {}) {
  if (typeof simulateRoute !== 'function') {
    return { ok: false, code: 'SIMULATE_ROUTE_REQUIRED', simulations: [] };
  }
  const byId = new Map((Array.isArray(strategies) ? strategies : []).filter((s) => s?.id).map((s) => [s.id, s]));
  const simulator = createRouteSimulator({
    financial,
    world,
    strategiesById: byId,
    globalIntel,
    crossAsset,
    smartMoney,
    now: () => now
  });

  const simulations = [];
  for (const strategy of byId.values()) {
    const result = await simulateRoute(strategy, {
      simulator,
      context: {
        capitalUsd: num(financial?.computed?.netWorthUsd ?? financial?.netWorthUsd ?? financial?.computed?.availableCapitalUsd),
        seriesSamples,
        kind: strategy.kind,
        expectedReturnPct: strategy.expectedReturnPct,
        feesUsd: strategy.feesUsd,
        riskPct: strategy.riskPct,
        liquidity: strategy.liquidity,
        strategy
      },
      now
    });
    simulations.push(result);
  }
  return {
    ok: true,
    schema: ROUTE_SIMULATOR_SCHEMA,
    providerId: ROUTE_SIMULATOR_PROVIDER_ID,
    simulations,
    count: simulations.length,
    passed: simulations.filter((s) => s.status === 'passed').length,
    live: true,
    estimate: true,
    executionPermission: false
  };
}

/**
 * Risk-adjusted score used by the live competition layer.
 *
 *   score = expectedReturn
 *         − 0.50 × risk
 *         − 0.25 × |drawdown|
 *         − feeDrag (fees+slippage as % of capital)
 *         + 0.15 × liquidityBonus
 *         + 0.10 × smartMoneyAlign
 *         + 0.05 × regimeAlign
 *
 * Any missing input simply drops its term — never invents a number. A row
 * without expectedReturn AND without a passing simulation scores null and
 * cannot win.
 */
export function riskAdjustedScore({
  expectedReturnPct = null,
  riskPct = null,
  drawdownPct = null,
  feesUsd = null,
  slippagePct = null,
  capitalUsd = null,
  liquidity = null,
  smartMoneyNetUsd = null,
  regime = null,
  simulationNet = null
} = {}) {
  const expected = num(expectedReturnPct);
  const simNet = num(simulationNet);
  const capital = num(capitalUsd);

  /* Prefer simulation net as % of capital when both exist; else expected. */
  let base = expected;
  if (simNet != null && capital != null && capital > 0) {
    base = round(((simNet - capital) / capital) * 100, 4);
  }
  if (base === null) return null;

  let score = base;
  const risk = num(riskPct);
  if (risk != null) score -= risk * 0.5;

  const dd = num(drawdownPct);
  if (dd != null) score -= Math.abs(dd) * 0.25;

  const fees = num(feesUsd) || 0;
  const slip = num(slippagePct) || 0;
  if (capital != null && capital > 0) {
    const feeDragPct = (fees / capital) * 100 + slip;
    score -= feeDragPct * 0.5;
  }

  const liq = String(liquidity || '').toLowerCase();
  if (/improv/.test(liq)) score += 1.5;
  else if (/encumber|transit|reduced/.test(liq)) score -= 1.0;

  const smNet = num(smartMoneyNetUsd);
  if (smNet != null) {
    /* Align: positive SM flow slightly boosts risk-on strategies' score only
       as an observation weight — capped, never a veto or a guarantee. */
    const align = Math.max(-2, Math.min(2, smNet / 5_000_000));
    score += align * 0.1 * 10; /* ±2 pts max */
  }

  const reg = String(regime || '').toUpperCase();
  if (reg === 'RISK_OFF' || reg === 'RISK_OFF_LEANING') score -= 1.5;
  else if (reg === 'RISK_ON' || reg === 'RISK_ON_LEANING') score += 0.5;

  return round(score, 4);
}

export default createRouteSimulator;
