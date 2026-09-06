/**
 * FBT INTENT AI — GOAL SOURCES ADAPTER (autonomy core, layer 2b)
 * ---------------------------------------------------------------------------
 * The goal compiler refuses to build a plan from a rate it cannot source, so
 * something has to hand it the app's REAL rates. This is that adapter: it turns
 * the data the chat already read this turn — the opportunity scanner's live
 * pools, the Aave reserve read, the wallet's own balances — into the
 * `{ ok, rows }` shape `buildGoalPlan` expects.
 *
 * Two rules, both about not inventing money:
 *   • a pool with no APY is dropped, never defaulted to zero (a 0% row would
 *     make an unreachable goal look reachable by dragging the "best rate" down
 *     into a list that still contains real ones — the ranking is what matters);
 *   • capital is read, never assumed. No readable balance means the compiler
 *     gets 0 and answers CAPITAL_REQUIRED, which is the chat asking for the
 *     wallet instead of guessing at someone's portfolio.
 */

import { buildGoalPlan, normalizeGoalTarget } from './goalPlanCompiler.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Map one opportunity row (opportunityScanner shape) into a compiler row. */
export function opportunityToRateRow(pool = {}) {
  const apy = num(pool.apy ?? pool.apyPct ?? pool.supplyApyPct);
  if (apy == null) return null;
  const chainId = num(pool.chainId ?? pool.chain);
  return {
    id: pool.id || `${pool.kind || 'yield'}:${pool.protocol || 'unknown'}:${pool.symbol || ''}`,
    title: pool.protocol ? `${pool.protocol} · ${pool.symbol || ''}`.trim() : (pool.title || pool.id || 'pool'),
    venue: venueForPool(pool),
    kind: pool.kind === 'lending' ? 'lending' : (pool.kind === 'lp' ? 'farm' : (pool.kind || 'yield')),
    asset: pool.symbol || null,
    chainId,
    apyPct: apy,
    risk: pool.risk || 'medium',
    tvlUsd: num(pool.tvlUsd),
    mint: pool.mint || null,
    leverage: num(pool.leverage) || 1,
    side: pool.side || 'long'
  };
}

/** Which venue executor would actually sign this row. */
function venueForPool(pool) {
  const chainId = num(pool.chainId ?? pool.chain);
  const sym = String(pool.symbol || '').toUpperCase();
  const protocol = String(pool.protocol || '').toLowerCase();
  if (chainId === 501) return pool.kind === 'perp' ? 'perp-velocity' : 'equity-solana';
  if (chainId === 8453 && sym === 'USDC' && (protocol.includes('aave') || pool.kind === 'lending')) return 'aave-base-usdc';
  if (pool.kind === 'lending' || protocol.includes('aave')) return 'lend-aave';
  return 'lend-aave';
}

/**
 * Build the `sources` object for `buildGoalPlan` from what this turn already
 * read. Each reader is a function because the compiler awaits them, and a
 * source that produced nothing reports itself so the answer can name the gap.
 */
export function goalSourcesFrom({ opportunities = [], lendingMarkets = [], lstYields = [], perpFunding = [] } = {}) {
  const rowsFrom = (list, fallbackKind) => (Array.isArray(list) ? list : [])
    .map((row) => opportunityToRateRow({ kind: fallbackKind, ...row }))
    .filter(Boolean);

  const poolRows = rowsFrom(opportunities, 'yield');
  return {
    lendingRates: async () => {
      const rows = [...rowsFrom(lendingMarkets, 'lending'), ...poolRows.filter((r) => r.kind === 'lending')];
      return rows.length ? { ok: true, rows } : { ok: false, code: 'NO_LENDING_RATES' };
    },
    farmPools: async () => {
      const rows = poolRows.filter((r) => r.kind === 'farm' || r.kind === 'yield' || r.kind === 'lp');
      return rows.length ? { ok: true, rows } : { ok: false, code: 'NO_FARM_RATES' };
    },
    lstYields: async () => {
      const rows = rowsFrom(lstYields, 'staking');
      return rows.length ? { ok: true, rows } : { ok: false, code: 'NO_STAKING_RATES' };
    },
    perpFunding: async () => {
      const rows = rowsFrom(perpFunding, 'perp');
      return rows.length ? { ok: true, rows } : { ok: false, code: 'NO_PERP_RATES' };
    }
  };
}

/**
 * Read the capital a goal is allowed to be planned against. The connected
 * wallet's own numbers, in this order of preference; anything unreadable is
 * skipped rather than counted as zero, because a zero balance and an unread
 * balance are different facts and only one of them is an answer.
 */
export function readableCapitalUsd({ portfolio = null, balances = null, wallet = null, overrideUsd = null } = {}) {
  const explicit = num(overrideUsd);
  if (explicit != null && explicit > 0) return { usd: explicit, source: 'user' };

  const total = num(portfolio?.totalValueUsd ?? portfolio?.totalUsd ?? portfolio?.valueUsd);
  if (total != null && total > 0) return { usd: total, source: 'portfolio' };

  if (Array.isArray(portfolio?.holdings) && portfolio.holdings.length) {
    const sum = portfolio.holdings.reduce((acc, h) => acc + (num(h.valueUsd) || 0), 0);
    if (sum > 0) return { usd: sum, source: 'holdings' };
  }

  if (Array.isArray(balances) && balances.length) {
    const sum = balances.reduce((acc, b) => acc + (num(b.valueUsd) || 0), 0);
    if (sum > 0) return { usd: sum, source: 'balances' };
  }

  const stable = num(wallet?.stablecoinUsd ?? wallet?.usdValue);
  if (stable != null && stable > 0) return { usd: stable, source: 'wallet' };

  return { usd: 0, source: null };
}

/**
 * One call the chat can make: intent + what this turn already read → a plan.
 * Kept here (not in the component) so a probe can pin the whole path.
 */
export async function planFromIntent({ intent = {}, context = {}, results = {}, locale = 'fa' } = {}) {
  const entities = intent?.entities || {};
  const target = normalizeGoalTarget({
    multiple: entities.goalMultiple,
    targetPct: entities.targetReturn ?? entities.targetPct,
    targetUsd: entities.targetUsd
  });
  const capital = readableCapitalUsd({
    portfolio: context?.portfolio,
    balances: context?.balances,
    wallet: context?.wallet,
    overrideUsd: entities.amountUsd && !target ? entities.amountUsd : null
  });

  const scan = results?.yieldOpportunities || results?.opportunities || null;
  const opportunities = Array.isArray(scan?.opportunities)
    ? scan.opportunities
    : (Array.isArray(scan) ? scan : []);

  const plan = await buildGoalPlan({
    goal: { multiple: target?.multiple, targetPct: entities.targetReturn, targetUsd: entities.targetUsd },
    capitalUsd: capital.usd,
    horizonDays: entities.horizonDays || entities.timeframeDays || 365,
    riskProfile: entities.riskPreference === 'low' ? 'conservative' : (entities.riskPreference === 'high' ? 'aggressive' : 'balanced'),
    sources: goalSourcesFrom({
      opportunities,
      lendingMarkets: results?.lendingMarkets || [],
      lstYields: results?.lstYields || [],
      perpFunding: results?.perpFunding || []
    }),
    locale
  });

  return { plan, capital, target, opportunitiesRead: opportunities.length };
}
