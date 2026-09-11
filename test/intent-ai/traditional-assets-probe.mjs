#!/usr/bin/env node
/**
 * PHASE 215 — RWA / STOCKS / FOREX / COMMODITIES in the decision engine.
 * ────────────────────────────────────────────────────────────────────────────
 * The six traditional classes (etf, funds, stocks, forex, commodities, rwa)
 * move through DISCOVERY → DECISION → WHY → SCENARIOS on the SAME opportunity
 * contract as crypto — no parallel if/else in the decision engine.
 *
 * Proven here:
 *   1. INSTRUMENT_QUERY classification still reads the right class
 *      (instrumentOf in src/lib/central/intent.js — the query-only entry);
 *   2. discovery from the global snapshot names per-class coverage and only
 *      emits rows the feed actually reported;
 *   3. the opportunities carry the crypto contract fields (verdict/score/
 *      observation/execution) and are scored by the ONE scoreOpportunityFit;
 *   4. the multi-class allocation is a target mix (preset weights × real
 *      capital) with the OBSERVED 24h change and an honest NULL portfolio
 *      return — no model, no number;
 *   5. execution exists ONLY through a registered broker/off-ramp provider:
 *      unconfigured → the honest refusal («این کلاس دارایی فقط تحلیل
 *      می‌شود، اجرا ندارد»), registered → an UNSIGNED hand-off; a simulated
 *      fill does not exist in this module;
 *   6. the goal scenarios now carry the multiClass block (crypto scenarios
 *      stand alone when the traditional side is unread).
 *
 * Run: node test/intent-ai/traditional-assets-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { createFinancialIntelligence } = await import('../../server/fios/index.js');
const { instrumentOf } = await import('../../src/lib/central/intent.js');
const {
  TRADITIONAL_CLASSES, ALL_CLASSES,
  normalizeOpportunity,
  registerExecutionProvider, unregisterExecutionProvider, listExecutionProviders
} = await import('../../server/fios/traditionalAssets.js');

const OWNER = 'dev:phase215';
const now = Date.now();

/* ── 1. INSTRUMENT_QUERY classification (the query-only entry point) ───── */
t('instrumentOf classifies the six traditional classes from text',
  instrumentOf('I want to buy an S&P 500 ETF') === 'etf'
  && instrumentOf('this mutual fund looks stable') === 'funds'
  && instrumentOf('buy some AAPL stock') === 'stocks'
  && instrumentOf('what is EURUSD doing') === 'forex'
  && instrumentOf('gold (XAU) position') === 'commodities'
  && instrumentOf('a tokenized real world asset') === 'rwa');
t('instrumentOf stays null for a pure-crypto query (no false positives)',
  instrumentOf('swap USDC to WBTC on base') === null);

/* ── the shared fixture: an owner with readable capital + a global feed ─── */
const SECTIONS = {
  wallet: { data: { connected: true, address: '0xcccccccccccccccccccccccccccccccccccccccc', balances: [
    { symbol: 'USDC', amount: 5000, valueUsd: 5000, network: 'base' },
    { symbol: 'BTC', amount: 0.05, valueUsd: 3350, network: 'bitcoin', isNative: true }
  ], allowances: [] }, status: 'OK', source: 'wallet-engine', updatedAt: now - 1000, ttlMs: 30_000 },
  portfolio: { data: { totalValueUsd: 8350, peakValueUsd: 9000, unrealizedPnlUsd: -100, holdings: [
    { symbol: 'USDC', valueUsd: 5000, amount: 5000, network: 'base' },
    { symbol: 'BTC', valueUsd: 3350, amount: 0.05, network: 'bitcoin' }
  ] }, status: 'OK', source: 'portfolio', updatedAt: now - 2000, ttlMs: 60_000 },
  markets: { data: { prices: { BTC: 67000 }, changes24hPct: { BTC: -2 }, volatilityPct: { BTC: 40, PORTFOLIO: 25 } }, status: 'OK', source: 'coingecko', updatedAt: now - 3000, ttlMs: 30_000 },
  lending: { data: { positions: [{ asset: 'USDC', protocol: 'aave', network: 'base', collateralUsd: 800, debtUsd: 300, healthFactor: 2.4, apyPct: 6.1 }] }, status: 'OK', source: 'lending', updatedAt: now - 4000, ttlMs: 60_000 },
  /* Traditional feed sections — the global-intel engine's documented seam
     (brainRead pre-seeds a domain from the owner's sections when they carry
     instruments): a deterministic stand-in for the live broker feed. */
  stocks: { data: { instruments: [
    { symbol: 'SPY', priceUsd: 590, change24hPct: 0.4 },
    { symbol: 'QQQ', priceUsd: 512, change24hPct: -0.2 }
  ] }, status: 'OK', source: 'probe-feed:stocks', updatedAt: now - 5000, ttlMs: 60_000 },
  commodities: { data: { instruments: [
    { symbol: 'GOLD', priceUsd: 2650, change24hPct: 0.1, category: 'commodities' },
    { symbol: 'WTI', priceUsd: 71, change24hPct: -1.4, category: 'commodities' }
  ] }, status: 'OK', source: 'probe-feed:commodities', updatedAt: now - 5000, ttlMs: 60_000 },
  forex: { data: { instruments: [{ symbol: 'DXY', priceUsd: 101.2, change24hPct: 0.1, category: 'forex' }] }, status: 'OK', source: 'probe-feed:forex', updatedAt: now - 5000, ttlMs: 60_000 },
  risk: { data: { level: 'ELEVATED', securitySignals: [] }, status: 'OK', source: 'risk-engine', updatedAt: now - 8000, ttlMs: 60_000 }
};
const stateStore = { peek: () => ({ sections: SECTIONS }) };
const bus = { publish: () => ({ ok: true, delivered: 1 }), subscribe: () => () => {} };
const fi = createFinancialIntelligence({ stateStore, events: bus, brain: null, log: () => {} });

/* The global-intel snapshot the discovery reads (the same shape
   globalIntel.snapshotFor produces; two classes read, one dead, the rest
   simply absent). */
const globalSnapshot = {
  status: 'PARTIAL',
  domains: {
    stocks: {
      status: 'OK', source: 'macroData:stooq', at: now,
      data: { venue: 'stooq', instruments: [
        { symbol: 'SPY', priceUsd: 590, change24hPct: 0.4 },
        { symbol: 'QQQ', priceUsd: 512, change24hPct: -0.2 }
      ] }
    },
    commodities: {
      status: 'OK', source: 'macroData:stooq', at: now,
      data: { venue: 'stooq', instruments: [
        { symbol: 'GOLD', priceUsd: 2650, change24hPct: 0.1 },
        { symbol: 'WTI', priceUsd: 71, change24hPct: -1.4 }
      ] }
    },
    forex: {
      status: 'OK', source: 'macroData:stooq', at: now,
      data: { venue: 'stooq', instruments: [{ symbol: 'DXY', priceUsd: 101.2, change24hPct: 0.1 }] }
    },
    rwa: { status: 'UNAVAILABLE', reason: 'NO_PROVIDER' }
  }
};

/* ── 2. discovery: rows only from what the feed reported ───────────────── */
const disc = await fi.traditionalAssets.discover(OWNER, { globalSnapshot });
t('discovery emits one row per reported instrument (5), none for the dead class',
  disc.ok === true && disc.result.count === 5
  && disc.result.opportunities.every((o) => o.asset !== 'RWA'));
t('per-class coverage names what read, what is dead, and what has no feed',
  disc.result.coverage.stocks?.status === 'OK'
  && disc.result.coverage.rwa?.status === 'UNREADABLE'
  && disc.result.coverage.etf?.status === 'NO_FEED'
  && disc.result.coverage.funds?.status === 'NO_FEED');
t('every row carries the crypto contract: class, observation, execution status',
  disc.result.opportunities.every((o) =>
    TRADITIONAL_CLASSES.includes(o.assetClass)
    && o.observation?.priceUsd != null
    && o.execution && typeof o.execution.available === 'boolean'));
t('a traditional row has an honest NULL where no model exists (apy/return/probability)',
  disc.result.opportunities.every((o) => o.apyPct === null && o.expectedReturnPct === null && o.probabilityPct === null));

/* ── 3. scoring: the ONE scoreOpportunityFit path, no class branch ─────── */
const profileOut = await fi.personalProfile.profileFor(OWNER, {});
const profile = profileOut.ok ? profileOut.profile : null;
const scored = await fi.traditionalAssets.scoreFor(OWNER, { opportunities: disc.result.opportunities, profile });
t('scoring ranks the traditional rows with a verdict, score and the deciding dimension',
  scored.ok === true && scored.result.count === 5
  && scored.result.ranked.every((r) => ['FITTED', 'CONDITIONAL', 'NOT_FITTED'].includes(r.verdict)
    && Number.isFinite(r.score) && Array.isArray(r.decidedBy)));
const noProfile = await fi.traditionalAssets.scoreFor(OWNER, { opportunities: disc.result.opportunities, profile: null });
t('scoring without a profile is refused (NO_PROFILE), not guessed',
  noProfile.ok === false && noProfile.code === 'NO_PROFILE');
t('an unknown class is refused by the normalizer (UNKNOWN_ASSET_CLASS)',
  normalizeOpportunity({ symbol: 'X' }, 'derivatives', {}).ok === false);

/* ── 4. multi-class allocation: a target mix, not a return forecast ────── */
const alloc = await fi.traditionalAssets.allocateFor(OWNER, {
  capitalUsd: 100000,
  riskTolerance: 'MODERATE',
  opportunities: disc.result.opportunities,
  financial: await fi.financialStateFor(OWNER)
});
t('the MODERATE preset allocates 30/30/15/25 of the real capital',
  alloc.ok === true
  && alloc.result.classes.stable.allocationUsd === 30000
  && alloc.result.classes.stocks.allocationUsd === 30000
  && alloc.result.classes.commodities.allocationUsd === 15000
  && alloc.result.classes.crypto.allocationUsd === 25000);
t('the allocation copies the OBSERVED 24h change from discovery, and never invents a return',
  alloc.result.classes.stocks.observed24hChangePct === 0.4
  && alloc.result.classes.commodities.observed24hChangePct === 0.1
  && alloc.result.expectedPortfolioReturnPct === null
  && alloc.result.signs === false && alloc.result.simulated === false);
const noCapital = await fi.traditionalAssets.allocateFor(OWNER, { capitalUsd: null, opportunities: disc.result.opportunities, financial: null });
t('a dead capital read is refused (NO_CAPITAL_READ), never defaulted',
  noCapital.ok === false && noCapital.code === 'NO_CAPITAL_READ');

/* ── 5. execution: registry-gated, unsigned, or honestly refused ───────── */
const refused = await fi.traditionalAssets.executeCheck(OWNER, { assetClass: 'stocks', instrument: 'SPY', side: 'buy', amountUsd: 1000 });
t('without a broker/off-ramp provider, execution is REFUSED honestly — never simulated',
  refused.ok === false && refused.code === 'NO_EXECUTION_PROVIDER'
  && refused.simulated === false && refused.executionPermission === false
  && /فقط تحلیل/i.test(refused.detail || ''));
t('the refusal is in Persian and names the class',
  /برای stocks configure نشده است/.test(refused.detail || ''));

let handoffCalled = null;
registerExecutionProvider({
  id: 'probe-broker', assetClass: 'stocks', name: 'Probe Broker', configured: true,
  execute: async (input) => { handoffCalled = input; return { ok: true, orderId: 'ord_1', status: 'ORDER_PREPARED', signed: false }; }
});
t('a configured provider appears in the registry',
  listExecutionProviders().some((p) => p.id === 'probe-broker' && p.assetClass === 'stocks'));
const allowed = await fi.traditionalAssets.executeCheck(OWNER, { assetClass: 'stocks', instrument: 'SPY', side: 'buy', amountUsd: 1000 });
t('with a provider, execution returns the provider\'s UNSIGNED hand-off',
  allowed.ok === true
  && allowed.execution?.handoff?.provider === 'probe-broker'
  && allowed.execution?.handoff?.orderId === 'ord_1'
  && allowed.execution?.handoff?.signed === false
  && allowed.execution?.signs === false && allowed.simulated === false);
t('the provider received the honest input (class, instrument, side, amount, signed:false)',
  handoffCalled?.assetClass === 'stocks' && handoffCalled?.instrument === 'SPY'
  && handoffCalled?.side === 'buy' && handoffCalled?.amountUsd === 1000 && handoffCalled?.signed === false);

unregisterExecutionProvider('stocks');
const refusedAgain = await fi.traditionalAssets.executeCheck(OWNER, { assetClass: 'stocks', instrument: 'SPY', side: 'buy', amountUsd: 1000 });
t('unregistering the provider returns to the honest refusal',
  refusedAgain.ok === false && refusedAgain.code === 'NO_EXECUTION_PROVIDER');

const unknownClass = await fi.traditionalAssets.executeCheck(OWNER, { assetClass: 'derivatives', instrument: 'X', side: 'buy', amountUsd: 1 });
t('an unknown class is refused (UNKNOWN_ASSET_CLASS)', unknownClass.ok === false && unknownClass.code === 'UNKNOWN_ASSET_CLASS');

const cryptoCheck = await fi.traditionalAssets.executeCheck(OWNER, { assetClass: 'crypto', instrument: 'USDC', side: 'swap', amountUsd: 100 });
t('crypto execution names the real swap hand-off (it is the existing path, not a simulation)',
  cryptoCheck.ok === true && cryptoCheck.execution?.handoff?.module === 'swap' && cryptoCheck.simulated === false);

/* ── 6. goal scenarios carry the multiClass block ──────────────────────── */
const scenarios = await fi.goalScenarios.scenariosFor(OWNER, {
  goal: { targetUsd: 10000, months: 6, maxDrawdownPct: 10 },
  financial: await fi.financialStateFor(OWNER)
});
t('the goal scenarios still build the crypto presets', scenarios.ok === true && Array.isArray(scenarios.scenarios) && scenarios.scenarios.length >= 3);
t('the multiClass block rides on the scenarios with the preset mix and a NULL return',
  scenarios.multiClass?.capitalUsd != null
  && scenarios.multiClass?.classes && scenarios.multiClass.classes.stocks && scenarios.multiClass.classes.crypto
  && scenarios.multiClass.expectedPortfolioReturnPct === null
  && scenarios.multiClass.simulated === false);
t('the multiClass block reports which sleeves can execute and which are analysis-only',
  Array.isArray(scenarios.multiClass?.executableSleeves) && Array.isArray(scenarios.multiClass?.analysisOnlySleeves)
  && scenarios.multiClass.analysisOnlySleeves.includes('stocks'));

/* ── 7. the decision record carries the opportunities (one contract) ───── */
t('the opportunity rows carry an id, class, asset and execution stamp the decision engine stores',
  disc.result.opportunities.every((o) => o.id?.startsWith('trad_') && o.assetClass && o.asset && o.execution));

/* ── report ────────────────────────────────────────────────────────── */
const failed = rows.filter(([, ok]) => !ok);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) {
  console.error('\nFAILED checks:');
  for (const [name] of failed) console.error(`  ✗ ${name}`);
  process.exit(1);
}
console.log('traditional assets probe passed (Phase 215)');
process.exit(0);
