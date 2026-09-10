/**
 * FBT STRATEGY BRAIN — STRATEGY ENGINE (layer 3 of 4).
 * ---------------------------------------------------------------------------
 * This is the piece that was missing. Everything around it could already do
 * ONE thing well: quote a swap, rank a farm, read a portfolio, show funding.
 * What none of them did was look at all of it at once and DECIDE.
 *
 * Given a goal spec (capital, target, horizon, risk) and an ecosystem state
 * (layer 2), this engine:
 *
 *   1. reads the market view   — regime, sentiment, smart-money and whale
 *                                pressure, macro — because the same plan is a
 *                                different plan in a different regime;
 *   2. builds one opportunity universe out of every module that answered
 *                                — lending, farms, pools, staking, crypto,
 *                                RWA, stocks, forex, commodities, perps, dYdX;
 *   3. expands candidate blueprints (yield core, balanced growth, hedged
 *      growth, carry, momentum) into real sleeves, only inside the user's own
 *      risk band;
 *   4. scores and COMPARES them — expected return net of cost, risk, data
 *      confidence, correlation — and says WHY one won and the others lost;
 *   5. compiles the winner into a STAGED plan whose every action is a handoff
 *      to a real venue (route + capability + params), plus the monitors that
 *      watch it and the revision policy that re-plans it.
 *
 * ─── WHAT IT NEVER DOES ─────────────────────────────────────────────────────
 *   · never invents a rate: a module that did not answer is excluded and named
 *     in `gaps`; the plan's `confidence` falls with it;
 *   · never promises a return: `honesty` is part of the object, and an
 *     unreachable target stays unreachable — the engine reports the closest
 *     honest plan and the number that is missing, it does not soften the goal;
 *   · never moves money: `fundsMoved: false`, `executionAuthorized: false`,
 *     every action `requiresSignature: true`. Signing happens at the venue.
 *
 * ─── HOST BUDGET ────────────────────────────────────────────────────────────
 * Pure arithmetic over data layer 2 already fetched. No network, no timers, no
 * storage. Candidate blueprints are capped at 6 and sleeves at 6, so the whole
 * comparison is a few thousand floating-point operations per turn.
 */

import { requiredApyPctFor, daysToMultipleAt, multipleAfterDays } from '../intent-ai/autonomy/goalPlanCompiler.js';
import { FEE_BPS } from '../feeBps.js';
import { domainData, isLive } from './ecosystemState.js';
import { num, r2 } from './numeric.js';

/*
 * `clamp` here is deliberately NOT the absence-preserving one in numeric.js:
 * every value it touches (a bias, a conviction, a weight) has already been
 * through `num`, and a null leaking out of a clamp would poison the arithmetic
 * downstream. Reading-presence is numeric.js's job; bounding is this one's.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

export const PORTFOLIO_STRATEGY_SCHEMA = 'fbt.portfolio-strategy.v1';

const DAY = 86_400_000;
/** Monotonic, so two plans built in the same millisecond never collide. */
let buildSeq = 0;
const DAYS_PER_YEAR = 365;


/* ══════════════════════════════════════════════════════════════════════════
   RISK BANDS — the user's own appetite is a CEILING, not a suggestion
   ══════════════════════════════════════════════════════════════════════════ */

export const RISK_PROFILES = Object.freeze({
  conservative: Object.freeze({
    id: 'conservative', label: 'Conservative', maxRiskRank: 1, allowsLeverage: false,
    maxSleevePct: 40, maxSleeves: 5, drawdownBudgetPct: 8, riskAversion: 1.6, cashFloorPct: 15,
    allowsFamilies: ['cash', 'lending', 'staking', 'rwa']
  }),
  balanced: Object.freeze({
    id: 'balanced', label: 'Balanced', maxRiskRank: 2, allowsLeverage: false,
    maxSleevePct: 30, maxSleeves: 6, drawdownBudgetPct: 18, riskAversion: 1.0, cashFloorPct: 8,
    allowsFamilies: ['cash', 'lending', 'staking', 'farm', 'lp', 'rwa', 'crypto', 'equity', 'commodity', 'fx']
  }),
  aggressive: Object.freeze({
    id: 'aggressive', label: 'Aggressive', maxRiskRank: 3, allowsLeverage: true,
    maxSleevePct: 25, maxSleeves: 6, drawdownBudgetPct: 32, riskAversion: 0.6, cashFloorPct: 4,
    allowsFamilies: ['cash', 'lending', 'staking', 'farm', 'lp', 'rwa', 'crypto', 'equity', 'commodity', 'fx', 'derivatives']
  })
});

const RISK_RANK = Object.freeze({ low: 1, medium: 2, high: 3, extreme: 4 });
export const riskRankOf = (risk) => RISK_RANK[String(risk || 'medium').toLowerCase()] ?? 2;

/* ══════════════════════════════════════════════════════════════════════════
   MARKET VIEW — what the ecosystem is doing right now
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A regime is read, not assumed. It comes from the macro read (global market
 * cap change / BTC trend), the news tone, and smart-money + whale direction.
 * Every input that is missing lowers the conviction rather than being
 * replaced by a default — `conviction` is what the card shows next to it.
 */
export function deriveMarketView(state = {}) {
  const signals = [];
  let bias = 0;

  const macro = domainData(state, 'macro');
  if (macro) {
    const regime = String(macro.regime || macro.marketRegime || '').toLowerCase();
    const globalChange = num(macro.marketCapChange24hPct ?? macro.totalMarketCapChange24hPct ?? macro.change24hPct);
    if (/risk[_ -]?on|bull|expansion/i.test(regime)) { bias += 1; signals.push({ source: 'macro', note: `regime ${regime}`, weight: 1 }); }
    else if (/risk[_ -]?off|bear|contraction/i.test(regime)) { bias -= 1; signals.push({ source: 'macro', note: `regime ${regime}`, weight: 1 }); }
    if (globalChange != null) {
      bias += clamp(globalChange / 3, -1, 1);
      signals.push({ source: 'macro', note: `market cap 24h ${r2(globalChange)}%`, weight: 1 });
    }
  }

  const news = domainData(state, 'news');
  if (news) {
    const sentiment = num(news.sentimentScore ?? news.sentiment ?? news.tone);
    if (sentiment != null) { bias += clamp(sentiment, -1, 1); signals.push({ source: 'news', note: `sentiment ${r2(sentiment)}`, weight: 1 }); }
    else if (typeof news.tone === 'string') {
      const tone = /positive|bullish/i.test(news.tone) ? 1 : (/negative|bearish/i.test(news.tone) ? -1 : 0);
      bias += tone;
      signals.push({ source: 'news', note: `tone ${news.tone}`, weight: 1 });
    }
  }

  const smart = domainData(state, 'smartMoney');
  if (smart) {
    const net = num(smart.netFlowUsd ?? smart.netFlow ?? smart.netUsd);
    const dir = String(smart.direction || smart.bias || '').toLowerCase();
    if (net != null) { bias += clamp(net / 50_000_000, -1, 1); signals.push({ source: 'smartMoney', note: `net flow ${Math.round(net)} USD`, weight: 1 }); }
    else if (dir) { bias += /accumulat|inflow|buy/i.test(dir) ? 1 : (/distribut|outflow|sell/i.test(dir) ? -1 : 0); signals.push({ source: 'smartMoney', note: `direction ${dir}`, weight: 1 }); }
  }

  const whales = domainData(state, 'whales');
  if (whales) {
    const exchangeIn = num(whales.exchangeInflowUsd ?? whales.inflowUsd);
    const exchangeOut = num(whales.exchangeOutflowUsd ?? whales.outflowUsd);
    if (exchangeIn != null || exchangeOut != null) {
      /* Coins moving TO exchanges is supply arriving to be sold. */
      const pressure = ((exchangeOut || 0) - (exchangeIn || 0)) / 50_000_000;
      bias += clamp(pressure, -1, 1);
      signals.push({ source: 'whales', note: `exchange net ${Math.round((exchangeOut || 0) - (exchangeIn || 0))} USD`, weight: 1 });
    } else {
      const count = num(whales.eventCount ?? whales.count);
      if (count != null) signals.push({ source: 'whales', note: `${count} whale events`, weight: 0.5 });
    }
  }

  const crypto = domainData(state, 'crypto');
  if (crypto) {
    const btcChange = num(crypto.btcChange24hPct ?? crypto.dominanceChangePct);
    if (btcChange != null) { bias += clamp(btcChange / 4, -1, 1); signals.push({ source: 'crypto', note: `BTC 24h ${r2(btcChange)}%`, weight: 1 }); }
  }

  const risk = domainData(state, 'risk');
  const guardrails = risk
    ? {
      concentrationPct: num(risk.concentrationPct ?? risk.topHoldingPct),
      maxDrawdownPct: num(risk.maxDrawdownPct ?? risk.drawdownPct),
      volatilityPct: num(risk.volatilityPct),
      alerts: Array.isArray(risk.alerts) ? risk.alerts.slice(0, 5) : [],
      source: 'risk'
    }
    : null;

  const conviction = clamp(0.25 + signals.reduce((acc, s) => acc + s.weight, 0) * 0.12, 0.2, 0.95);
  return {
    bias: r2(clamp(bias, -3, 3)),
    regime: bias > 0.75 ? 'risk_on' : (bias < -0.75 ? 'risk_off' : 'neutral'),
    signals,
    conviction: r2(conviction),
    guardrails,
    readDomains: signals.map((s) => s.source)
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   OPPORTUNITY UNIVERSE — every module that answered, in one shape
   ══════════════════════════════════════════════════════════════════════════ */

const FAMILY_OF_DOMAIN = Object.freeze({
  lending: 'lending', farming: 'farm', liquidity: 'lp', crypto: 'crypto',
  rwa: 'rwa', stocks: 'equity', forex: 'fx', commodities: 'commodity',
  futures: 'derivatives', dydx: 'derivatives'
});

const HANDOFF_OF_FAMILY = Object.freeze({
  lending: { route: '/loan', capabilityId: 'lending.supply', module: 'lending', operation: 'SUPPLY' },
  staking: { route: '/farm', capabilityId: 'lending.supply', module: 'lending', operation: 'STAKE' },
  farm: { route: '/farm', capabilityId: 'farming.deposit', module: 'farm', operation: 'DEPOSIT' },
  lp: { route: '/farm', capabilityId: 'liquidity.add', module: 'liquidity', operation: 'ADD_LIQUIDITY' },
  cash: { route: '/loan', capabilityId: 'lending.supply', module: 'lending', operation: 'SUPPLY_STABLE' },
  crypto: { route: '/swap', capabilityId: 'swap.quote', module: 'swap', operation: 'BUY' },
  rwa: { route: '/market', capabilityId: 'rwa.tokens', module: 'swap', operation: 'BUY' },
  equity: { route: '/stocks', capabilityId: 'stocks.list', module: 'markets', operation: 'BUY_EQUITY' },
  fx: { route: '/stocks', capabilityId: 'horizon.forex', module: 'markets', operation: 'BUY_FX' },
  commodity: { route: '/stocks', capabilityId: 'horizon.commodities', module: 'markets', operation: 'BUY_COMMODITY' },
  derivatives: { route: '/perp', capabilityId: 'futures.open', module: 'futures', operation: 'OPEN_POSITION' }
});

const STABLE_RE = /^(USDC|USDT|DAI|FDUSD|TUSD|USDE|USDbC|GHO|PYUSD|USD\+)$/i;

/**
 * Families whose return comes from PRICE, not from a sourced rate. They are
 * allowed into a plan with an expected return of exactly zero — the engine
 * does not forecast — and they carry a measured volatility range instead.
 */
export const PRICE_FAMILIES = Object.freeze(['crypto', 'rwa', 'equity', 'fx', 'commodity']);
const isPriceFamily = (family) => PRICE_FAMILIES.includes(family);

function deriveRisk({ poolRisk = null, apy = null, volatilityPct = null, drawdownPct = null, tvlUsd = null, volumeUsd = null, family = null }) {
  let score = 0;
  if (String(poolRisk).toLowerCase() === 'high' || (num(apy) || 0) > 40) score += 3;
  else if (String(poolRisk).toLowerCase() === 'medium' || (num(apy) || 0) > 15) score += 1;
  if ((num(volatilityPct) || 0) > 6) score += 2; else if ((num(volatilityPct) || 0) > 3) score += 1;
  if ((num(drawdownPct) || 0) > 40) score += 2;
  const depth = num(tvlUsd) ?? num(volumeUsd);
  if (depth != null && depth < 1_000_000) score += 1;
  if (family === 'derivatives') score += 2;
  if (family === 'crypto') score += 1;
  return score >= 5 ? 'high' : (score >= 2 ? 'medium' : 'low');
}

/**
 * Annualised volatility, from the source when it gave one and otherwise
 * DERIVED from a real daily move: a 24h change is a one-day sample, so
 * `|Δ24h| × √365` is its annualised equivalent. That is arithmetic on a read
 * number, not an invented one — and it is labelled as a derivation.
 */
function annualVolatilityPct(row) {
  const given = num(row.annualVolPct ?? row.volatilityAnnualPct);
  if (given != null) return Math.abs(given);
  const daily = num(row.dailyVolPct ?? row.priceChange24hPct ?? row.price_change_percentage_24h);
  if (daily != null) return Math.abs(daily) * Math.sqrt(365);
  return null;
}

/**
 * Drawdown estimate for a row.
 *   1. a drawdown the source measured wins, always;
 *   2. otherwise an annualised volatility × 1.6 (a bad-but-normal year);
 *   3. otherwise a family default, and `drawdownAssumed` says so — an assumed
 *      number is never allowed to look like a measured one.
 */
function drawdownEstimate(row) {
  const measured = num(row.drawdownPct) ?? num(row.maxDrawdownPct) ?? num(row.worstDrawdownPct);
  if (measured != null) return { drawdownPct: Math.abs(measured), drawdownBasis: 'measured' };
  const vol = annualVolatilityPct(row);
  /* Volatility-derived, so this is an ANNUAL figure and the scorer scales it to
     the horizon: a 4-month plan is not exposed to a year of variance. */
  if (vol != null) return { drawdownPct: Math.round(vol * 1.6 * 100) / 100, drawdownBasis: 'volatility' };
  if (row.family === 'cash') return { drawdownPct: 1, drawdownBasis: 'assumed' };
  if (row.family === 'lending') return { drawdownPct: 4, drawdownBasis: 'assumed' };
  if (row.family === 'derivatives') return { drawdownPct: 45, drawdownBasis: 'assumed' };
  if (row.family === 'fx') return { drawdownPct: 8, drawdownBasis: 'assumed' };
  return { drawdownPct: 30, drawdownBasis: 'assumed' };
}

/**
 * One raw row from any domain → the common shape the engine scores.
 * Tolerant on purpose: DefiLlama pools, CoinGecko markets, dYdX markets and
 * the perp feed all name their fields differently, and refusing to read a row
 * because of a field name is how a module silently disappears from the plan.
 */
export function normalizeOpportunity(domain, raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const family = raw.family || FAMILY_OF_DOMAIN[domain] || null;
  if (!family) return null;

  const apy = num(raw.apy ?? raw.apyPct ?? raw.supplyApyPct ?? raw.ratePct ?? raw.yieldPct ?? raw.netApy);
  const historical = num(raw.forwardReturnPct ?? raw.expectedReturnPct ?? raw.medianForwardPct ?? raw.baseRatePct);
  const funding = num(raw.fundingAprPct ?? raw.fundingRateAnnualized ?? raw.fundingApr);

  const asset = String(raw.symbol || raw.asset || raw.ticker || raw.name || raw.pool || '').toUpperCase().slice(0, 24);
  const isStable = STABLE_RE.test(asset) || STABLE_RE.test(String(raw.stableSymbol || raw.token0 || ''));
  const isCashFamily = family === 'lending' && isStable;
  const priceFamily = isPriceFamily(family);

  /*
   * A price family with no sourced return keeps ZERO expected return. That is
   * not pessimism, it is the honesty rule: the engine has no forecast, so the
   * part of the target that must come from price is reported as a RANGE from
   * measured volatility instead of being quietly added to the expected return.
   */
  const returnPctAnnual = apy ?? funding ?? historical ?? (priceFamily ? 0 : null);
  const basis = apy != null ? 'apy' : (funding != null ? 'funding' : (historical != null ? 'historical' : (priceFamily ? 'zero-drift' : 'none')));

  const dailyVolPct = num(raw.volatilityPct ?? raw.volatility ?? raw.priceChange24hPct ?? raw.price_change_percentage_24h);
  const annualVolPct = annualVolatilityPct(raw);
  const tvlUsd = num(raw.tvlUsd ?? raw.tvl ?? raw.totalValueLocked ?? raw.marketCap ?? raw.market_cap ?? raw.volumeUsd ?? raw.volume24hUsd);
  const poolRisk = raw.risk || raw.riskLevel || raw.poolRisk || null;
  const leverage = num(raw.leverage) || 1;
  const risk = String(raw.risk || deriveRisk({ poolRisk, apy: returnPctAnnual, volatilityPct: dailyVolPct != null ? Math.abs(dailyVolPct) : null, drawdownPct: num(raw.drawdownPct), tvlUsd, family })).toLowerCase();
  const dd = drawdownEstimate({ ...raw, annualVolPct, dailyVolPct, family });

  const title = raw.title
    || [raw.protocol || raw.project || raw.venue, asset || raw.symbol].filter(Boolean).join(' · ')
    || `${family} row`;

  return {
    id: String(raw.id || `${domain}:${raw.pool || asset || title}`).slice(0, 80),
    domain,
    family: isCashFamily ? 'cash' : family,
    title: String(title).slice(0, 80),
    asset: asset || null,
    chainId: num(raw.chainId ?? raw.chain),
    chain: raw.chain || raw.chainName || null,
    venue: String(raw.protocol || raw.project || raw.venue || domain).slice(0, 40),
    returnPctAnnual,
    basis,
    risk,
    riskRank: riskRankOf(risk),
    leverage,
    dailyVolPct: dailyVolPct != null ? Math.abs(dailyVolPct) : null,
    annualVolPct: annualVolPct != null ? Math.round(annualVolPct * 100) / 100 : null,
    drawdownPct: dd.drawdownPct,
    /* 'measured' | 'volatility' | 'assumed' — the scorer scales the last two
       to the horizon; a measured worst case is already an absolute number. */
    drawdownBasis: dd.drawdownBasis,
    /* A real 7d/30d move, when the source gave one — used to RANK price rows,
       never to predict them. */
    trendPct: num(raw.trendPct ?? raw.priceChange7dPct ?? raw.price_change_percentage_7d_in_currency),
    stable: isStable,
    tvlUsd,
    liquidityUsd: tvlUsd,
    dataStatus: 'live',
    side: raw.side || (funding != null && funding < 0 ? 'short' : 'long'),
    raw: null
  };
}

/** Every row from every live domain, normalised and de-duplicated. */
export function buildOpportunityUniverse(state = {}) {
  const rows = [];
  const seen = new Set();
  for (const [domain, family] of Object.entries(FAMILY_OF_DOMAIN)) {
    if (!isLive(state, domain)) continue;
    const data = domainData(state, domain);
    const list = Array.isArray(data) ? data : (data?.rows || data?.pools || data?.markets || data?.items || data?.data || []);
    if (!Array.isArray(list)) continue;
    for (const raw of list.slice(0, 60)) {
      const row = normalizeOpportunity(domain, { family, ...raw });
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
   BLUEPRINTS — the candidate shapes the engine compares
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Each blueprint is a family → weight map per risk profile. Weights are
 * CEILINGS: a family with no live row is dropped and its weight is
 * redistributed, so a plan never contains a sleeve it cannot source.
 */
export const BLUEPRINTS = Object.freeze([
  {
    id: 'stable_carry', title: 'Stable carry',
    idea: 'Capital stays in dollar assets earning the best real lending rate. Lowest variance, lowest ceiling.',
    weights: {
      conservative: { cash: 55, lending: 30, staking: 15 },
      balanced: { cash: 45, lending: 30, staking: 25 },
      aggressive: { cash: 40, lending: 30, staking: 30 }
    }
  },
  {
    id: 'yield_core', title: 'DeFi yield core',
    idea: 'Lending plus farms and pools — the app\'s own yield venues, diversified across protocols.',
    weights: {
      conservative: { cash: 30, lending: 40, staking: 30 },
      balanced: { lending: 30, farm: 30, lp: 20, staking: 20 },
      aggressive: { lending: 20, farm: 35, lp: 30, staking: 15 }
    }
  },
  {
    id: 'balanced_growth', title: 'Balanced growth',
    idea: 'Yield base plus a market sleeve (crypto / RWA / equities) for the part of the target yield cannot carry.',
    weights: {
      conservative: { cash: 35, lending: 40, rwa: 25 },
      balanced: { lending: 25, farm: 20, crypto: 25, rwa: 15, equity: 15 },
      aggressive: { lending: 15, farm: 20, crypto: 30, rwa: 15, equity: 20 }
    }
  },
  {
    id: 'hedged_growth', title: 'Hedged growth',
    idea: 'Growth sleeve with a funding-funded hedge, so a fall is partly paid for by the perp book.',
    weights: {
      conservative: null,
      balanced: { lending: 25, farm: 20, crypto: 25, derivatives: 15, rwa: 15 },
      aggressive: { lending: 15, farm: 15, crypto: 30, derivatives: 25, rwa: 15 }
    }
  },
  {
    id: 'funding_carry', title: 'Funding carry',
    idea: 'Collect perp funding instead of betting on direction — only where a live funding rate exists.',
    weights: {
      conservative: null,
      balanced: { cash: 30, lending: 25, derivatives: 30, farm: 15 },
      aggressive: { cash: 20, lending: 20, derivatives: 40, farm: 20 }
    }
  },
  {
    id: 'momentum', title: 'Directional momentum',
    idea: 'Concentrated in the strongest live markets, with derivatives for the aggressive band only.',
    weights: {
      conservative: null,
      balanced: { crypto: 45, lending: 20, farm: 20, equity: 15 },
      aggressive: { crypto: 40, derivatives: 25, farm: 20, equity: 15 }
    }
  }
]);

/* ══════════════════════════════════════════════════════════════════════════
   SCORING
   ══════════════════════════════════════════════════════════════════════════ */

/** Simple-interest horizon return for a yield row; the label says so. */
export function horizonReturnPct({ returnPctAnnual, basis, days }) {
  const r = num(returnPctAnnual);
  if (r == null) return null;
  if (basis === 'historical') return r * (days / DAYS_PER_YEAR);
  return r * (days / DAYS_PER_YEAR);
}

/**
 * Cost of running the plan: the platform fee on every leg that swaps, plus a
 * per-transaction gas estimate when the gas read gave one. When gas is
 * unreadable the cost is reported as PARTIAL — never as zero, because a
 * "free" plan is a lie the user pays for later.
 */
export function estimateCost({ sleeves = [], capitalUsd = 0, gas = null, feeBps = FEE_BPS }) {
  const feePctPerLeg = feeBps / 100;
  const gasPerTxUsd = num(gas?.gasUsd ?? gas?.avgGasUsd ?? gas?.gasUsdPerTx);

  /*
   * Which legs actually pay the platform fee? Only the ones routed through the
   * aggregator:
   *   · a market sleeve is bought and later sold            → 2 legs;
   *   · a yield sleeve whose asset is NOT a stablecoin needs one entry swap
   *     (you do not deposit ETH into an AERO pool without buying AERO) → 1 leg;
   *   · a stable lending sleeve pays gas only. Charging it the swap fee is how
   *     a plan ends up costing 2% before it earns anything — the first version
   *     of this function did exactly that and ranked a 6% carry below its own
   *     fees.
   * Every leg also pays gas, entry and exit.
   */
  let entryFeeLegs = 0;
  let exitFeeLegs = 0;
  let entryTx = 0;
  let exitTx = 0;
  for (const sleeve of sleeves) {
    const row = sleeve.row || sleeve;
    const family = sleeve.family || row.family;
    const stable = row.stable === true || STABLE_RE.test(String(row.asset || ''));
    const isMarket = isPriceFamily(family) || family === 'derivatives';
    entryFeeLegs += isMarket ? 1 : (stable ? 0 : 1);
    exitFeeLegs += isMarket ? 1 : 0;
    entryTx += 1;
    exitTx += isMarket ? 1 : 1;
  }
  /*
   * ENTRY cost is what deploying the plan costs today, and it is the only part
   * subtracted from the expected return. The exit cost is real but belongs to
   * the exit decision — charging both up front made a 5-venue plan look 6%
   * underwater before it earned anything, which is not what the user pays.
   */
  const feePct = entryFeeLegs * feePctPerLeg;
  const exitFeePct = exitFeeLegs * feePctPerLeg;
  const gasUsd = gasPerTxUsd != null ? gasPerTxUsd * entryTx : null;
  const exitGasUsd = gasPerTxUsd != null ? gasPerTxUsd * exitTx : null;
  const gasPct = gasUsd != null && capitalUsd > 0 ? (gasUsd / capitalUsd) * 100 : null;
  const exitGasPct = exitGasUsd != null && capitalUsd > 0 ? (exitGasUsd / capitalUsd) * 100 : null;
  const totalPct = gasPct != null ? feePct + gasPct : null;
  const roundTripPct = totalPct != null ? totalPct + exitFeePct + (exitGasPct ?? 0) : null;
  return {
    feePct: r2(feePct),
    feeBps,
    feeLegs: entryFeeLegs,
    exitFeePct: r2(exitFeePct),
    gasUsd: gasUsd != null ? r2(gasUsd) : null,
    gasPct: gasPct != null ? r2(gasPct) : null,
    totalPct: totalPct != null ? r2(totalPct) : null,
    roundTripPct: roundTripPct != null ? r2(roundTripPct) : null,
    /* `complete` is false when gas was unread: the figure is a FLOOR, and the
       card must say so rather than showing a number that looks final. */
    complete: gasPct != null,
    txCount: entryTx,
    source: { fee: `platform fee ${feeBps} bps`, gas: gasPerTxUsd != null ? (gas.source || 'gas read') : 'UNREAD' }
  };
}

/**
 * Portfolio volatility over the horizon, in percent, from the sleeves' own
 * annualised volatilities. Where a correlation was read it is used; where it
 * was not, the sleeves are treated as independent and the result is labelled
 * as a LOWER bound — real assets are correlated, so the true range is wider.
 */
export function portfolioRangePct({ sleeves = [], days = 365, correlation = null } = {}) {
  const priced = sleeves.filter((s) => (s.annualVolPct ?? 0) > 0);
  if (!priced.length) return null;
  const w = priced.map((s) => (s.weightPct ?? 0) / 100);
  const sigma = priced.map((s) => (s.annualVolPct / 100) * Math.sqrt(days / DAYS_PER_YEAR));
  const corrOf = (a, b) => {
    const pair = (correlation?.pairs || []).find((p) => (p.a === a.asset && p.b === b.asset) || (p.a === b.asset && p.b === a.asset));
    return pair ? Math.max(-1, Math.min(1, pair.corr)) : 0;
  };
  let variance = 0;
  for (let i = 0; i < priced.length; i += 1) {
    for (let j = 0; j < priced.length; j += 1) {
      variance += w[i] * w[j] * sigma[i] * sigma[j] * (i === j ? 1 : corrOf(priced[i], priced[j]));
    }
  }
  if (!(variance > 0)) return null;
  return Math.round(Math.sqrt(variance) * 100 * 100) / 100;
}

/** Pairwise correlation from real OHLC series, when layer 2 supplied them. */
export function correlationSummary(state = {}) {
  const data = domainData(state, 'correlation');
  if (!data) return { available: false, pairs: [], note: 'CORRELATION_NOT_READ' };
  const pairs = Array.isArray(data.pairs) ? data.pairs : (Array.isArray(data) ? data : []);
  const rows = pairs
    .map((p) => ({ a: p.a || p.assetA, b: p.b || p.assetB, corr: num(p.corr ?? p.correlation) }))
    .filter((p) => p.a && p.b && p.corr != null);
  const high = rows.filter((p) => Math.abs(p.corr) > 0.7);
  return { available: true, pairs: rows.slice(0, 20), highPairs: high, note: rows.length ? null : 'NO_PAIRS' };
}

/**
 * Expand a blueprint into real sleeves.
 *
 * @returns {{sleeves:Array, dropped:Array, redistributed:number}}
 */
export function expandBlueprint({ blueprint, profile, universe, marketView, maxSleeves = 6 }) {
  const weights = blueprint.weights?.[profile.id];
  if (!weights) return { sleeves: [], dropped: [{ family: '*', reason: `blueprint not offered at ${profile.id}` }], redistributed: 0 };

  const allowed = new Set(profile.allowsFamilies);
  const dropped = [];
  let liveWeight = 0;
  const byFamily = new Map();

  for (const [family, weight] of Object.entries(weights)) {
    if (!allowed.has(family)) { dropped.push({ family, reason: 'outside risk band' }); continue; }
    const pool = universe
      .filter((row) => row.family === family)
      .filter((row) => row.riskRank <= profile.maxRiskRank)
      .filter((row) => profile.allowsLeverage || row.leverage <= 1)
      /* A yield row must have a sourced rate. A PRICE row is allowed with zero
         expected return — the plan then says plainly that the rest of the
         target has to come from price, and shows the measured range. */
      .filter((row) => row.returnPctAnnual != null || isPriceFamily(row.family));
    if (!pool.length) { dropped.push({ family, reason: 'no live row inside the band' }); continue; }

    /* Best rows first. For yield rows "best" is the highest sourced rate at
       the lowest risk. For price rows the engine has no forecast, so "best"
       is the strongest MEASURED trend and, failing that, the calmest asset —
       a read, not a prediction. The regime only breaks near-ties. */
    const tilt = marketView?.regime === 'risk_off' ? 1 : (marketView?.regime === 'risk_on' ? -1 : 0);
    const sortKey = (row) => {
      if (isPriceFamily(row.family)) {
        const trend = num(row.trendPct) ?? 0;
        return trend * 0.5 - (row.annualVolPct ?? 60) * 0.05 - row.riskRank * 1.5 + tilt * 1;
      }
      return (row.returnPctAnnual ?? 0) - row.riskRank * 1.5 + tilt * (row.riskRank === 1 ? 0.5 : -0.5);
    };
    const ranked = pool.slice().sort((a, b) => (sortKey(b) - sortKey(a)) || (a.riskRank - b.riskRank) || ((b.tvlUsd || 0) - (a.tvlUsd || 0)));

    /* One family becomes at most two sleeves, so a plan is never five rows of
       the same protocol wearing different hats. */
    const picked = ranked.slice(0, 2);
    const share = weight / picked.length;
    for (const row of picked) {
      byFamily.set(`${family}:${row.id}`, { family, weightPct: share, row });
      liveWeight += share;
    }
  }

  if (!liveWeight) return { sleeves: [], dropped, redistributed: 0 };

  /* Normalise to 100% and cap a single sleeve, giving the excess back to the
     rest — a 40% ceiling means one protocol failing cannot end the plan. */
  const cap = Math.min(profile.maxSleevePct, 100);
  let sleeves = [...byFamily.values()].map((s) => ({ ...s, weightPct: (s.weightPct / liveWeight) * 100 }));
  for (let pass = 0; pass < 4; pass += 1) {
    const over = sleeves.filter((s) => s.weightPct > cap + 0.01);
    if (!over.length) break;
    const excess = over.reduce((acc, s) => acc + (s.weightPct - cap), 0);
    const room = sleeves.filter((s) => s.weightPct <= cap);
    const roomTotal = room.reduce((acc, s) => acc + s.weightPct, 0) || 1;
    sleeves = sleeves.map((s) => (s.weightPct > cap + 0.01
      ? { ...s, weightPct: cap }
      : { ...s, weightPct: s.weightPct + excess * (s.weightPct / roomTotal) }));
  }

  const total = sleeves.reduce((acc, s) => acc + s.weightPct, 0) || 1;
  return {
    sleeves: sleeves
      .map((s) => ({ ...s, weightPct: (s.weightPct / total) * 100 }))
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, maxSleeves),
    dropped,
    redistributed: Math.round((1 - liveWeight / 100) * 100)
  };
}

/**
 * Score one candidate. The formula is written out here rather than hidden in
 * a weight vector because the card has to be able to explain the ranking:
 *
 *   score = expectedReturnPct × confidence
 *           − riskPct × profile.riskAversion
 *           − costPct × 2
 *           − correlationPenalty
 */
export function scoreCandidate({ candidate, universe, goal, horizonDays, profile, marketView, cost, correlation, state }) {
  const sleeves = candidate.sleeves;
  const rows = [];
  let expectedReturnPct = 0;
  let riskPct = 0;
  let weightedRank = 0;
  let sourcedWeight = 0;
  let priceExposurePct = 0;
  let assumedRiskCount = 0;
  const assets = [];

  for (const sleeve of sleeves) {
    const row = sleeve.row;
    const weight = sleeve.weightPct / 100;
    const ret = horizonReturnPct({ returnPctAnnual: row.returnPctAnnual, basis: row.basis, days: horizonDays });
    /* Only a SOURCED rate counts toward the expected return. A zero-drift
       price sleeve contributes exactly nothing to the expectation and shows up
       in `priceExposurePct` + the range instead. */
    if (ret != null && row.basis !== 'zero-drift') {
      expectedReturnPct += ret * weight;
      sourcedWeight += sleeve.weightPct;
    }
    if (isPriceFamily(row.family) || row.family === 'derivatives') priceExposurePct += sleeve.weightPct;
    if (row.drawdownBasis === 'assumed') assumedRiskCount += 1;
    /*
     * A volatility-derived or assumed drawdown is an ANNUAL figure, so it is
     * scaled to the horizon by √(t): a 4-month plan does not carry a year of
     * variance. A drawdown the source measured is absolute and is left alone.
     * Without this a 120-day BTC sleeve was charged a full year of drawdown and
     * every growth blueprint was scored out of existence.
     */
    const scale = row.drawdownBasis === 'measured' ? 1 : Math.sqrt(horizonDays / DAYS_PER_YEAR);
    const effectiveDrawdown = (row.drawdownPct ?? 30) * scale;
    riskPct += effectiveDrawdown * weight;
    weightedRank += row.riskRank * weight;
    if (row.asset) assets.push(row.asset);
    rows.push({
      id: row.id, family: row.family, title: row.title, asset: row.asset, venue: row.venue,
      chainId: row.chainId, weightPct: r2(sleeve.weightPct), returnPctAnnual: row.returnPctAnnual,
      horizonReturnPct: ret != null ? r2(ret) : null, basis: row.basis, risk: row.risk,
      drawdownPct: r2(row.drawdownPct), drawdownBasis: row.drawdownBasis,
      horizonDrawdownPct: r2((row.drawdownPct ?? 30) * (row.drawdownBasis === 'measured' ? 1 : Math.sqrt(horizonDays / DAYS_PER_YEAR))),
      annualVolPct: row.annualVolPct ?? null, trendPct: row.trendPct ?? null,
      stable: Boolean(row.stable), leverage: row.leverage, dataStatus: row.dataStatus
    });
  }

  const costPct = cost.totalPct ?? cost.feePct;
  expectedReturnPct -= costPct;
  const rangePct = portfolioRangePct({ sleeves: rows, days: horizonDays, correlation });

  /* Concentration in one asset is a risk the weights alone do not show. */
  const dupes = assets.filter((a, i) => assets.indexOf(a) !== i);
  const correlationPenalty = (correlation?.highPairs || [])
    .filter((p) => assets.includes(p.a) && assets.includes(p.b))
    .reduce((acc, p) => acc + Math.abs(p.corr) * 4, 0)
    + dupes.length * 2;

  /*
   * Confidence = how much of this plan rests on a read that actually answered.
   * Three parts, because they are three different kinds of evidence:
   *   · coverage — what fraction of the ecosystem answered this turn;
   *   · sourced return — what fraction of the capital sits in a rate the plan
   *     can point at (a price sleeve is live data but an unsourced return);
   *   · conviction — how much of the market view is read rather than assumed.
   */
  const coveragePct = state?.coverage?.pct ?? 0;
  const confidence = clamp(
    (coveragePct / 100) * 0.5 + (sourcedWeight / 100) * 0.3 + (marketView?.conviction ?? 0.5) * 0.2,
    0.05, 0.95
  );

  const riskBandBreach = weightedRank > profile.maxRiskRank + 0.001;
  const annualPct = horizonDays > 0 ? expectedReturnPct * (DAYS_PER_YEAR / horizonDays) : null;
  const required = goal.targetPct != null ? requiredApyPctFor(1 + goal.targetPct / 100, horizonDays) : null;
  const reachable = required != null && annualPct != null && annualPct >= required;

  /*
   * ─── THE OBJECTIVE, WRITTEN OUT ────────────────────────────────────────
   * The user granted a risk budget and asked for a target. Both sides of that
   * bargain belong in the score, and neither alone is enough:
   *
   *   earned            expected return, discounted by how much of it is read
   *   − excessRisk      risk ABOVE the user's own budget — the only risk that
   *                     is a violation; risk inside the budget was granted
   *   − entryCost       what deploying costs today
   *   − correlation     sleeves that fall together are one bet, not several
   *   − unusedRisk      when the target is NOT reachable, a plan that sits far
   *                     below the granted budget has given up on the goal
   *                     without being asked to; that is penalised, not rewarded
   *
   * The first version scored risk absolutely, so a 4% drawdown beat a 19% one
   * no matter what the return was — and a balanced-risk user asking for 15% was
   * handed a 1% stable carry and told it was the best plan.
   */
  const budget = profile.drawdownBudgetPct;
  const excessRisk = Math.max(0, riskPct - budget);
  const unusedRisk = reachable ? 0 : Math.max(0, (budget - riskPct) / budget);
  const score = (expectedReturnPct * confidence)
    - excessRisk * profile.riskAversion
    - costPct
    - correlationPenalty
    - unusedRisk * 2.5;

  return {
    id: candidate.id,
    title: candidate.title,
    idea: candidate.idea,
    sleeves: rows,
    sleeveCount: rows.length,
    expectedReturnPct: r2(expectedReturnPct),
    expectedAnnualPct: r2(annualPct),
    /* What part of the target is NOT covered by a sourced rate. */
    priceExposurePct: r2(priceExposurePct),
    /* ±1σ over the horizon, from the sleeves' measured volatilities. */
    rangePct: rangePct != null ? r2(rangePct) : null,
    riskPct: r2(riskPct),
    excessRiskPct: r2(excessRisk),
    unusedRiskFraction: r2(unusedRisk),
    assumedRiskCount,
    weightedRiskRank: r2(weightedRank),
    riskBandBreach,
    costPct: r2(costPct),
    correlationPenalty: r2(correlationPenalty),
    confidence: r2(confidence),
    sourcedWeightPct: r2(sourcedWeight),
    score: r2(score),
    reachable,
    requiredApyPct: required != null ? r2(required) : null,
    dropped: candidate.dropped
  };
}

/** Why one candidate won and another lost, in words the card can show. */
export function explainRanking(ranked = []) {
  return ranked.map((row, index) => {
    if (index === 0) {
      return {
        id: row.id, verdict: 'CHOSEN',
        reason: `Highest score: ${row.expectedReturnPct ?? '—'}% expected over the horizon at ${(row.confidence * 100).toFixed(0)}% data confidence, risk ${row.riskPct ?? '—'}%.`
      };
    }
    const winner = ranked[0];
    const reasons = [];
    if ((row.expectedReturnPct ?? -999) < (winner.expectedReturnPct ?? -999)) reasons.push('lower expected return');
    if ((row.riskPct ?? 0) > (winner.riskPct ?? 0)) reasons.push('higher estimated drawdown');
    if (row.confidence < winner.confidence) reasons.push('less of it is backed by live reads');
    if (row.riskBandBreach) reasons.push('outside your risk band');
    if (row.correlationPenalty > winner.correlationPenalty) reasons.push('more correlated sleeves');
    return { id: row.id, verdict: 'REJECTED', reason: reasons.length ? reasons.join(', ') : 'lower combined score' };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   STAGES — the plan as a sequence of handoffs, not a wall of actions
   ══════════════════════════════════════════════════════════════════════════ */

const needsSwapFirst = (sleeve) => ['crypto', 'rwa', 'equity', 'fx', 'commodity'].includes(sleeve.family);
const needsBridge = (sleeve, walletChainId) => sleeve.chainId != null && walletChainId != null && sleeve.chainId !== walletChainId;

/**
 * Compile the chosen candidate into stages. Every action is a HANDOFF: it
 * names the module, the operation, the route that owns the form, the
 * capability id the Operations catalog uses, and `requiresSignature: true`.
 * Nothing here signs and nothing here moves funds.
 */
export function buildStages({ candidate, goal, capitalUsd, state, cost, horizonDays }) {
  const sleeves = candidate.sleeves;
  const walletChainId = num(domainData(state, 'wallet')?.chainId ?? domainData(state, 'portfolio')?.chainId);
  const gasPerTxUsd = num(domainData(state, 'gas')?.gasUsd ?? domainData(state, 'gas')?.avgGasUsd);
  const stages = [];

  /* Stage 0 — preflight. Free, and it is where a plan dies cheaply. */
  stages.push({
    id: 'preflight',
    order: 0,
    title: 'Pre-flight',
    objective: 'Confirm capital, allowances, gas and risk limits before anything moves.',
    enterWhen: 'immediately',
    movesFunds: false,
    actions: [
      { module: 'wallet', operation: 'READ_BALANCES', route: '/wallet', capabilityId: 'wallet.getBalances', requiresSignature: false, params: {} },
      { module: 'risk', operation: 'CHECK_LIMITS', route: '/portfolio', capabilityId: 'risk.analyze', requiresSignature: false, params: { drawdownBudgetPct: RISK_PROFILES[goal.riskProfile].drawdownBudgetPct } }
    ],
    rollback: 'Nothing to roll back — no funds moved.',
    status: 'PENDING'
  });

  /* Stage 1 — get into the base asset / chain the sleeves need. */
  const swapSleeves = sleeves.filter(needsSwapFirst);
  const bridgeSleeves = sleeves.filter((s) => needsBridge(s, walletChainId));
  if (swapSleeves.length || bridgeSleeves.length) {
    const amountUsd = r2(swapSleeves.reduce((acc, s) => acc + (capitalUsd * s.weightPct) / 100, 0));
    stages.push({
      id: 'consolidate',
      order: 1,
      title: 'Consolidate base asset',
      objective: bridgeSleeves.length
        ? `Move ${amountUsd ?? '—'} USD onto the chain(s) the sleeves live on, then into the entry asset.`
        : `Move ${amountUsd ?? '—'} USD into the entry asset(s) for the market sleeves.`,
      enterWhen: 'pre-flight passed',
      movesFunds: true,
      actions: [
        ...(bridgeSleeves.length ? [{
          module: 'bridge', operation: 'BRIDGE', route: '/bridge', capabilityId: 'bridge.quote', requiresSignature: true,
          params: { toChainId: bridgeSleeves[0].chainId ?? null, amountUsd: r2((capitalUsd * bridgeSleeves[0].weightPct) / 100) }
        }] : []),
        ...(swapSleeves.length ? [{
          module: 'swap', operation: 'BUY', route: '/swap', capabilityId: 'swap.quote', requiresSignature: true,
          params: { toToken: swapSleeves[0].asset, amountUsd }
        }] : [])
      ],
      maxCostUsd: r2((cost.totalPct ?? cost.feePct) / 100 * capitalUsd * 0.6),
      rollback: 'Reverse swap / bridge back to the base asset.',
      status: 'PENDING'
    });
  }

  /* Stage 2 — the yield core (no price risk, funds the floor of the target). */
  const yieldSleeves = sleeves.filter((s) => ['cash', 'lending', 'staking', 'farm', 'lp'].includes(s.family));
  if (yieldSleeves.length) {
    stages.push({
      id: 'deploy-yield',
      order: 2,
      title: 'Deploy the yield core',
      objective: `Put ${r2(yieldSleeves.reduce((a, s) => a + s.weightPct, 0))}% of capital into sourced yield — the part of the target that does not depend on price.`,
      enterWhen: 'base asset in place',
      movesFunds: true,
      actions: yieldSleeves.map((s) => {
        const handoff = HANDOFF_OF_FAMILY[s.family] || HANDOFF_OF_FAMILY.lending;
        return {
          module: handoff.module, operation: handoff.operation, route: handoff.route, capabilityId: handoff.capabilityId,
          requiresSignature: true,
          params: {
            venue: s.venue, asset: s.asset, chainId: s.chainId ?? null, poolId: s.id,
            amountUsd: r2((capitalUsd * s.weightPct) / 100), expectedApyPct: s.returnPctAnnual
          }
        };
      }),
      maxCostUsd: r2((gasPerTxUsd ?? 0) * yieldSleeves.length + (cost.feePct / 100) * capitalUsd * 0.2),
      rollback: 'Withdraw / unstake back to the base asset.',
      status: 'PENDING'
    });
  }

  /* Stage 3 — the market sleeve (where the rest of the target has to come from). */
  const marketSleeves = sleeves.filter((s) => ['crypto', 'rwa', 'equity', 'fx', 'commodity', 'derivatives'].includes(s.family));
  if (marketSleeves.length) {
    stages.push({
      id: 'deploy-market',
      order: 3,
      title: 'Deploy the market sleeve',
      objective: `Add the ${r2(marketSleeves.reduce((a, s) => a + s.weightPct, 0))}% that has price risk, sized so the drawdown budget still holds.`,
      enterWhen: 'yield core confirmed',
      movesFunds: true,
      actions: marketSleeves.map((s) => {
        const handoff = HANDOFF_OF_FAMILY[s.family] || HANDOFF_OF_FAMILY.crypto;
        return {
          module: handoff.module, operation: handoff.operation, route: handoff.route, capabilityId: handoff.capabilityId,
          requiresSignature: true,
          params: {
            venue: s.venue, asset: s.asset, chainId: s.chainId ?? null, marketId: s.id, side: s.side || 'long',
            amountUsd: r2((capitalUsd * s.weightPct) / 100)
          }
        };
      }),
      maxCostUsd: r2((gasPerTxUsd ?? 0) * marketSleeves.length + (cost.feePct / 100) * capitalUsd * 0.4),
      rollback: 'Close / sell back to the base asset.',
      status: 'PENDING'
    });
  }

  /* Stage 4 — watch it. A plan nobody watches is a plan nobody can fix. */
  stages.push({
    id: 'monitor',
    order: stages.length,
    title: 'Monitor and rebalance',
    objective: 'Track realised return against the plan curve and the drawdown budget; re-plan when either breaks.',
    enterWhen: 'all deployment stages confirmed',
    movesFunds: false,
    actions: [
      { module: 'monitoring', operation: 'CREATE_MONITOR', route: '/intent?tab=ops', capabilityId: 'monitor.create', requiresSignature: false, params: { kind: 'strategy-progress' } }
    ],
    rollback: 'Monitoring only — nothing to roll back.',
    status: 'PENDING'
  });

  return stages;
}

/** The monitors the runtime watches, derived from the plan itself. */
export function buildMonitors({ goal, horizonDays, profile, candidate }) {
  const floorPct = goal.floorPct ?? goal.targetPct;
  return [
    {
      id: 'drawdown-budget',
      kind: 'risk',
      condition: `portfolio drawdown from plan start > ${profile.drawdownBudgetPct}%`,
      action: 'propose de-risk: cut the market sleeve, move to the yield core',
      severity: 'high'
    },
    {
      id: 'target-pace',
      kind: 'progress',
      condition: `realised return < 50% of the plan curve at the half-horizon (${Math.round(horizonDays / 2)} days)`,
      action: 're-plan against fresh live rates; report the gap instead of waiting',
      severity: 'medium'
    },
    {
      id: 'floor-breach',
      kind: 'progress',
      condition: floorPct != null ? `projected final return < ${floorPct}% (your stated minimum)` : 'projected return falls below the plan target',
      action: 're-plan and say plainly that the minimum is not on track',
      severity: 'high'
    },
    {
      id: 'rate-decay',
      kind: 'opportunity',
      condition: 'a sleeve\'s live APY falls more than 30% below what the plan was built on',
      action: 'propose moving that sleeve to the best live rate inside the same band',
      severity: 'medium'
    },
    {
      id: 'regime-flip',
      kind: 'market',
      condition: 'market regime flips risk_on ↔ risk_off on two consecutive reads',
      action: 're-weight the market sleeve and re-score the blueprints',
      severity: 'medium'
    }
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   THE BUILD
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} input
 * @param {object} input.goal     goal spec from layer 1
 * @param {object} input.state    ecosystem state from layer 2
 * @param {number} [input.now]
 * @param {boolean} [input.allowLeverageOverride] never true from the parser
 */
export function buildPortfolioStrategy({ goal = {}, state = {}, now = Date.now() } = {}) {
  const started = now;
  const profile = RISK_PROFILES[String(goal.riskProfile).toLowerCase()] || RISK_PROFILES.balanced;
  const capitalUsd = num(goal.capitalUsd) || 0;
  const horizonDays = Math.max(1, Math.min(3650, num(goal.horizonDays) || 365));

  if (!(capitalUsd > 0)) {
    return { ok: false, schema: PORTFOLIO_STRATEGY_SCHEMA, code: 'CAPITAL_REQUIRED', detail: 'no readable capital — the plan would be a guess about someone else\'s money', goal };
  }
  if (goal.targetPct == null) {
    return { ok: false, schema: PORTFOLIO_STRATEGY_SCHEMA, code: 'NO_TARGET', detail: 'no target return stated', goal };
  }
  if (!state?.domains) {
    return { ok: false, schema: PORTFOLIO_STRATEGY_SCHEMA, code: 'NO_ECOSYSTEM_STATE', detail: 'layer 2 produced no state', goal };
  }
  /*
   * What is actually critical is CAPITAL, and it has two honest sources: the
   * user's own words or a wallet/portfolio read. A user who typed «۱۰ هزار
   * دلار» has given the number, so refusing to plan until they connect a
   * wallet would be a wall in front of an answer we can already give — but the
   * plan must then say that it has not seen their holdings, because
   * concentration risk is exactly what a wallet read would have shown.
   */
  const positionRead = isLive(state, 'wallet') || isLive(state, 'portfolio');
  const capitalFromUser = goal.capitalSource === 'user';
  if (!positionRead && !capitalFromUser) {
    return {
      ok: false, schema: PORTFOLIO_STRATEGY_SCHEMA, code: 'CRITICAL_DOMAIN_MISSING',
      detail: `cannot plan without: ${(state.missingCritical || []).join(', ') || 'wallet'}`, goal,
      coverage: state.coverage, gaps: state.gaps
    };
  }

  const marketView = deriveMarketView(state);
  const universe = buildOpportunityUniverse(state);
  const correlation = correlationSummary(state);
  const gas = domainData(state, 'gas');

  if (!universe.length) {
    return {
      ok: false, schema: PORTFOLIO_STRATEGY_SCHEMA, code: 'NO_OPPORTUNITIES',
      detail: 'No module returned a rate or a market this turn.',
      goal, coverage: state.coverage, gaps: state.gaps, marketView
    };
  }

  /* Expand + score every blueprint the band allows. */
  const candidates = [];
  for (const blueprint of BLUEPRINTS) {
    const expanded = expandBlueprint({ blueprint, profile, universe, marketView, maxSleeves: profile.maxSleeves });
    if (!expanded.sleeves.length) continue;
    const cost = estimateCost({ sleeves: expanded.sleeves, capitalUsd, gas });
    candidates.push(scoreCandidate({
      candidate: { ...blueprint, sleeves: expanded.sleeves, dropped: expanded.dropped },
      universe, goal, horizonDays, profile, marketView, cost, correlation, state
    }));
  }

  const rankable = candidates.filter((c) => !c.riskBandBreach);
  const pool = (rankable.length ? rankable : candidates).slice().sort((a, b) => (b.score - a.score) || (b.expectedReturnPct - a.expectedReturnPct));
  if (!pool.length) {
    return {
      ok: false, schema: PORTFOLIO_STRATEGY_SCHEMA, code: 'NO_FEASIBLE_PLAN',
      detail: 'Every blueprint needs a module that did not answer this turn.',
      goal, coverage: state.coverage, gaps: state.gaps, marketView, universeSize: universe.length
    };
  }

  const chosen = pool[0];

  /*
   * ─── TWO ANSWERS WHEN THE TARGET IS OUT OF REACH ────────────────────────
   * When no plan can hit the target, "the best plan" is ambiguous: the best
   * plan for the CAPITAL is the safest one that keeps it working, and the best
   * plan for the GOAL is the one that gives the target its only chance — at a
   * price risk the engine will not forecast. Picking silently between those is
   * how an assistant ends up either ignoring the user's target or gambling
   * their money. So both are named, and the card offers the choice.
   */
  const stretch = pool
    .filter((c) => c.id !== chosen.id && !c.riskBandBreach)
    .filter((c) => (c.expectedReturnPct ?? -1e9) > (chosen.expectedReturnPct ?? -1e9) || (c.priceExposurePct ?? 0) > (chosen.priceExposurePct ?? 0))
    .sort((a, b) => (b.expectedReturnPct - a.expectedReturnPct) || (b.priceExposurePct - a.priceExposurePct))[0] || null;

  const comparison = pool.map((c) => ({
    id: c.id, title: c.title, idea: c.idea, expectedReturnPct: c.expectedReturnPct, expectedAnnualPct: c.expectedAnnualPct,
    riskPct: c.riskPct, costPct: c.costPct, confidence: c.confidence, sleeveCount: c.sleeveCount,
    priceExposurePct: c.priceExposurePct, rangePct: c.rangePct, sourcedWeightPct: c.sourcedWeightPct,
    score: c.score, reachable: c.reachable, riskBandBreach: c.riskBandBreach,
    role: c.id === chosen.id ? 'default' : (stretch && c.id === stretch.id ? 'stretch' : 'alternative')
  }));
  const ranking = explainRanking(pool);

  const sleeves = chosen.sleeves.map((s) => ({
    ...s,
    amountUsd: r2((capitalUsd * s.weightPct) / 100),
    handoff: HANDOFF_OF_FAMILY[s.family] || null
  }));
  const cost = estimateCost({ sleeves: chosen.sleeves, capitalUsd, gas });
  const stages = buildStages({ candidate: chosen, goal, capitalUsd, state, cost, horizonDays });
  const monitors = buildMonitors({ goal, horizonDays, profile, candidate: chosen });

  const requiredApyPct = requiredApyPctFor(1 + goal.targetPct / 100, horizonDays);
  const expectedAnnualPct = chosen.expectedAnnualPct;
  const reachable = requiredApyPct != null && expectedAnnualPct != null && expectedAnnualPct >= requiredApyPct;
  const daysAtPlanRate = expectedAnnualPct != null && expectedAnnualPct > 0
    ? daysToMultipleAt(1 + goal.targetPct / 100, expectedAnnualPct)
    : null;
  const targetMultipleAtHorizon = expectedAnnualPct != null ? multipleAfterDays(expectedAnnualPct, horizonDays) : null;

  /* A risk drawdown estimate that exceeds the user's own budget is a breach,
     and it is reported as one even when the return looks fine. */
  const breaches = [];
  if (chosen.riskPct != null && chosen.riskPct > profile.drawdownBudgetPct) {
    breaches.push({ code: 'DRAWDOWN_ABOVE_BUDGET', detail: `estimated ${chosen.riskPct}% vs budget ${profile.drawdownBudgetPct}%` });
  }
  if (chosen.riskBandBreach) breaches.push({ code: 'RISK_BAND_BREACH', detail: `weighted risk rank ${chosen.weightedRiskRank} > ${profile.maxRiskRank}` });
  if (cost.complete === false) breaches.push({ code: 'COST_INCOMPLETE', detail: 'gas unread — the cost below excludes it' });

  /*
   * The gap the sourced rates do not cover. This is the single most important
   * number in the answer and the one a "sure, 15% is doable" reply hides: if
   * the live rates carry 4% and the target is 15%, then 11 points have to come
   * from price — and the only honest thing to say about price is its range.
   */
  const sourcedReturnPct = r2((chosen.expectedReturnPct ?? 0) + (cost.totalPct ?? cost.feePct ?? 0));
  const priceGapPct = r2(goal.targetPct - (sourcedReturnPct ?? 0));
  /* The range quoted in the refusal is the one that matters: the chosen plan's
     own range when it has price exposure, otherwise the stretch plan's — a
     refusal that shows no range is a refusal with no alternative in it. */
  const quotedRange = chosen.rangePct ?? stretch?.rangePct ?? null;
  const honesty = reachable
    ? `This is a plan, not a promise. ${chosen.expectedReturnPct}% over ${horizonDays} days is what the live rates in this turn support — ${(chosen.confidence * 100).toFixed(0)}% of the decision rests on a read that actually answered. Markets can move against it.`
    : `Your target needs ${requiredApyPct != null ? `${r2(requiredApyPct)}%` : '—'} APY. Every rate this ecosystem can source right now adds up to ${sourcedReturnPct != null ? `${sourcedReturnPct}%` : '—'} over ${horizonDays} days${daysAtPlanRate != null ? `, and would need ${Math.round(daysAtPlanRate)} days` : ''}. The remaining ${priceGapPct != null ? `${priceGapPct} points` : 'rest'} can only come from price — where I have no forecast, only a measured range of ${quotedRange != null ? `±${quotedRange}%` : '—'} (1σ) over the horizon${stretch ? `, which is what the ${stretch.title} alternative is betting on` : ''}. I am not going to dress that up as your target.`;

  return {
    ok: true,
    schema: PORTFOLIO_STRATEGY_SCHEMA,
    /*
     * A revision is built from a FRESH read, but two plans built in the same
     * millisecond over the same data would otherwise share an id — and the
     * runtime keys its stage progress and its revision history by strategyId.
     * The counter makes every plan addressable, which is what a revision link
     * needs in order to mean anything.
     */
    strategyId: `strat_${started.toString(36)}_${(buildSeq += 1).toString(36)}_${Math.abs(chosen.score).toString(36).slice(0, 4)}`,
    goal: {
      capitalUsd, capitalSource: goal.capitalSource || null, targetPct: goal.targetPct,
      floorPct: goal.floorPct ?? null, horizonDays, riskProfile: profile.id, riskSource: goal.riskSource || null,
      requiredApyPct: r2(requiredApyPct), targetValueUsd: r2(capitalUsd * (1 + goal.targetPct / 100))
    },
    marketView,
    coverage: state.coverage,
    gaps: state.gaps,
    emptyDomains: state.emptyDomains,
    readDomains: state.liveDomains,
    universe: { rows: universe.length, families: [...new Set(universe.map((u) => u.family))] },
    correlation,
    sleeves,
    stages,
    monitors,
    revisionPolicy: {
      maxRevisions: 5,
      reevaluateAfterMs: 6 * 60 * 60 * 1000,
      triggers: monitors.map((m) => m.id),
      note: 'A revision re-reads the ecosystem and re-scores the blueprints; it never re-uses this turn\'s rates.'
    },
    comparison,
    ranking,
    chosen: chosen.id,
    /* Named, never silent: `default` is the best plan for the capital,
       `stretch` is the one that gives an unreachable target a chance. */
    alternatives: {
      default: chosen.id,
      stretch: !reachable && stretch ? stretch.id : null,
      stretchNote: !reachable && stretch
        ? `${stretch.title} is the only shape here that could reach ${goal.targetPct}% — and only through price, which is not forecast: ${stretch.priceExposurePct}% of capital exposed, measured 1σ range ±${stretch.rangePct ?? '—'}%.`
        : null
    },
    verdict: {
      reachable,
      requiredApyPct: r2(requiredApyPct),
      expectedAnnualPct: r2(expectedAnnualPct),
      expectedReturnPct: chosen.expectedReturnPct,
      /* The part of the target the sourced rates actually carry. */
      sourcedReturnPct,
      /* …and the part that can only come from price. */
      priceGapPct,
      priceExposurePct: chosen.priceExposurePct,
      /* ±1σ over the horizon from measured volatility — a range, not a forecast. */
      rangePct: chosen.rangePct,
      expectedValueUsd: r2(capitalUsd * (1 + (chosen.expectedReturnPct || 0) / 100)),
      daysToTargetAtPlanRate: daysAtPlanRate != null ? Math.round(daysAtPlanRate) : null,
      targetMultipleAtHorizon: targetMultipleAtHorizon != null ? r2(targetMultipleAtHorizon) : null
    },
    risk: {
      band: profile.id, drawdownBudgetPct: profile.drawdownBudgetPct,
      estimatedDrawdownPct: chosen.riskPct, weightedRiskRank: chosen.weightedRiskRank,
      assumedRiskCount: chosen.assumedRiskCount,
      breaches
    },
    cost,
    confidence: chosen.confidence,
    honesty,
    limitations: [
      'Expected returns come from live APYs and measured histories in this turn, not from a forecast.',
      'Nothing here signs or broadcasts — every stage hands off to the venue that owns the signature.',
      ...(!positionRead
        ? ['Planned on the capital you stated: no wallet was read, so your existing holdings and their concentration are not in this plan.']
        : []),
      ...(state.gaps.length ? [`Not read this turn: ${state.gaps.map((g) => g.domain).join(', ')}.`] : []),
      ...(cost.complete ? [] : ['Gas was unread, so the cost figure is a floor.'])
    ],
    fundsMoved: false,
    executionAuthorized: false,
    builtAt: now,
    builtInMs: Date.now() - started
  };
}
