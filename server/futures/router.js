/**
 * FBT FUTURES — BFF router, mounted at /api/v1/futures (spec §19).
 * ---------------------------------------------------------------------------
 *   GET  /providers                   provider registry + live status
 *   GET  /health                      engine health (providers, ledger durability)
 *   GET  /markets?provider=           markets for one provider (or all executable)
 *   GET  /markets/:provider/:market   one market
 *   GET  /candles?provider=&market=&resolution=&limit=
 *   GET  /funding?provider=           funding + rollover per market
 *   GET  /open-interest?provider=
 *   GET  /positions/:wallet?provider= live positions (never cached)
 *   GET  /account/:wallet?provider=   collateral balance + allowance
 *   GET  /fees?provider=&collateral=&leverage=&market=   fee preview (backend truth)
 *   POST /quote                       route + fee + risk for a proposed order
 *   POST /risk                        risk only
 *   POST /simulate                    gas estimate of the prepared calldata
 *   POST /prepare                     build UNSIGNED tx (needs Idempotency-Key)
 *   POST /execute                     alias of prepare — the server NEVER signs;
 *                                     returns the same unsigned handoff
 *   POST /verify                      receipt check + ledger update + events
 *   POST /positions/:id/increase|decrease|close|tp|sl   management builders
 *   GET  /executions/:wallet          this wallet's execution records
 *   GET  /fees/ledger                 append-only fee records (summary + rows)
 *
 * Every POST answers with requestId / intentId / executionId / idempotencyKey.
 * Every value the UI shows comes from here. Nothing here holds a key.
 */
import express from 'express';
import { getAddress, isAddress } from 'ethers';
import { fetchSimplePrices } from '../providers.js';
import { publish } from '../central/eventBus.js';
import {
  PROVIDER_CATALOGUE, PROVIDER_STATUS, EXECUTABLE_STATUSES,
  computeFeeBreakdown, FEE_POLICY_IDS,
  assessFuturesRisk, positionHealth,
  selectVenue,
  mapFuturesError, FUTURES_ERRORS,
  makeFuturesRequestId, makeFuturesIntentId, isValidIdempotencyKey
} from '../../src/lib/futures-engine/index.js';
import { listProviders, probeProvider, noteProviderError, noteProviderSuccess, fbtFeeRecipient, fbtFeeOverrideBps } from './registry.js';
import * as ostium from './adapters/ostium.js';
import * as drift from './adapters/drift.js';
import {
  claimFuturesIdempotency, saveFuturesIdempotency, createExecution, getExecution, updateExecution,
  listExecutionsForWallet, appendFeeRecord, listFeeRecords, feeSummary, ledgerDurable
} from './ledger.js';

const SCHEMA = (name) => `fbt.futures-${name}.v1`;
const now = () => Date.now();

const ok = (res, data, meta = {}) => res.json({ ok: true, data, meta: { generatedAt: new Date().toISOString(), ...meta } });
const fail = (res, status, code, extra = {}) => {
  const known = FUTURES_ERRORS[code] || FUTURES_ERRORS.UNKNOWN;
  return res.status(status).json({ ok: false, error: { code, retryable: known.retryable, recovery: known.recovery, ...extra } });
};

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const cleanWallet = (w) => { try { return isAddress(w) ? getAddress(w) : null; } catch { return null; } };
const providerOf = (id) => PROVIDER_CATALOGUE[String(id || '').toLowerCase()] || null;
const ownerFor = (req) => (req?.tgUser?.id ? `tg:${req.tgUser.id}` : String(req.get?.('x-fbt-device') || req.ip || 'anon').slice(0, 64));

/* Ostium has a server-side EVM order path (Stocks). Drift (Solana) has a live
   READ path — markets/prices/funding/OI/candles — but no order path yet, so its
   adapter answers data and the venue stays READ_ONLY. The table makes adding
   Drift execution a registration, not a rewrite. */
const ADAPTERS = { ostium, drift };

/* Per-adapter fee + collateral constants. Kept out of the generic flow so each
   venue reports its OWN numbers rather than inheriting another's. */
const ADAPTER_CONSTS = {
  ostium: { minCollateralUsd: ostium.OSTIUM_MIN_COLLATERAL_USD, flatFeeUsd: ostium.OSTIUM_ORACLE_FEE_USD, venueCapBps: ostium.OSTIUM_VENUE_FEE_CAP_BPS },
  drift: { minCollateralUsd: drift.DRIFT_MIN_COLLATERAL_USD, flatFeeUsd: 0, venueCapBps: drift.DRIFT_VENUE_FEE_CAP_BPS }
};

async function statusGate(providerId, { needExecute = false } = {}) {
  const p = providerOf(providerId);
  if (!p) return { ok: false, status: 404, code: 'MARKET_NOT_LISTED', detail: 'unknown provider' };
  const health = await probeProvider(p.id);
  if (health.status === PROVIDER_STATUS.BLOCKED) return { ok: false, status: 451, code: 'PROVIDER_BLOCKED', health };
  if (health.status === PROVIDER_STATUS.MAINTENANCE) return { ok: false, status: 503, code: 'PROVIDER_MAINTENANCE', health };
  if (needExecute) {
    if (!ADAPTERS[p.id] || !health.executable) return { ok: false, status: 409, code: health.status === PROVIDER_STATUS.UNAVAILABLE ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_READ_ONLY', health };
    if (!EXECUTABLE_STATUSES.includes(health.status)) return { ok: false, status: 409, code: 'PROVIDER_UNAVAILABLE', health };
  }
  return { ok: true, provider: p, health };
}

/** Network fee in USD from a gas estimate (EVM venues; null when unknown). */
async function networkFeeUsd(est, providerId = 'ostium') {
  if (providerId !== 'ostium') return null; // Solana network fee is not estimated on the read path
  if (!est?.ok || est.feeWei == null) return null;
  const eth = await ostium.ethUsd(fetchSimplePrices);
  if (eth == null) return null;
  return (Number(est.feeWei) / 1e18) * eth;
}

function feeFor({ providerId = 'drift', market, collateralUsd, leverage, networkFee, policyId }) {
  const c = ADAPTER_CONSTS[providerId] || ADAPTER_CONSTS.drift;
  return computeFeeBreakdown({
    collateralUsd, leverage,
    protocolFeeBps: market?.openFeeBps ?? null,
    protocolFlatUsd: c.flatFeeUsd,
    networkFeeUsd: networkFee,
    policyId: FEE_POLICY_IDS.includes(String(policyId || '').toUpperCase()) ? String(policyId).toUpperCase() : 'STANDARD',
    overrideBps: fbtFeeOverrideBps(),
    venueCapBps: c.venueCapBps,
    recipient: fbtFeeRecipient(),
    chargedOn: providerId === 'drift' ? 'fill' : 'open'
  });
}

/** Everything a quote needs, from real reads. Shared by /quote, /prepare, /simulate. */
async function assembleOrder(body, { wallet, requireWallet = false }) {
  const providerId = String(body.provider || body.providerId || 'drift').toLowerCase();
  const gate = await statusGate(providerId, { needExecute: requireWallet });
  if (!gate.ok) return { ok: false, ...gate };
  const adapter = ADAPTERS[providerId];
  if (!adapter) return { ok: false, status: 409, code: 'PROVIDER_READ_ONLY', health: gate.health };
  const adapterConsts = ADAPTER_CONSTS[providerId] || ADAPTER_CONSTS.ostium;

  const side = body.side === 'short' ? 'short' : 'long';
  const collateralUsd = num(body.collateralUsd ?? body.collateral);
  const leverage = num(body.leverage);
  if (collateralUsd == null || collateralUsd <= 0 || leverage == null || leverage <= 0) return { ok: false, status: 400, code: 'INVALID_INPUT', detail: 'collateralUsd and leverage must be positive numbers' };
  if (collateralUsd < adapterConsts.minCollateralUsd) return { ok: false, status: 400, code: 'BELOW_MIN', detail: `minimum collateral is ${adapterConsts.minCollateralUsd} USDC` };

  const found = await adapter.findMarket(body.market || body.marketId);
  if (found.error) { noteProviderError(providerId, 'MARKETS'); return { ok: false, status: 503, code: 'PROVIDER_UNAVAILABLE', detail: found.error, health: gate.health }; }
  const { market, live, stale } = found;
  if (!market) return { ok: false, status: 404, code: 'MARKET_NOT_LISTED' };
  if (!live) return { ok: false, status: 503, code: 'FEED_STALE' };

  const effectiveMax = market.isDayTradingClosed && market.overnightMaxLeverage > 0 ? market.overnightMaxLeverage : market.maxLeverage;
  if (effectiveMax != null && leverage > effectiveMax) return { ok: false, status: 400, code: 'LEVERAGE_TOO_HIGH', detail: `max ${effectiveMax}x` };
  if (market.isMarketOpen === false) return { ok: false, status: 409, code: 'MARKET_CLOSED' };

  const takeProfit = num(body.takeProfit);
  const stopLoss = num(body.stopLoss);
  const slippageBps = Math.max(1, Math.min(500, Math.round(num(body.slippageBps) ?? 25)));

  let account = null;
  /* Read-only venues (Drift) have no wallet account path; quotes and fees still
     compute from the live market read, with the button honest about view-only. */
  if (wallet && gate.provider.execution !== 'NOT_BUILT') {
    account = await adapter.readAccount(wallet);
    if (!account.ok) account = null;
  }

  const entry = side === 'long' ? market.ask : market.bid;
  const fundingForSide = market.fundingAprPct == null ? null : (side === 'long' ? market.fundingAprPct : -market.fundingAprPct);

  const risk = assessFuturesRisk({
    providerId, side, collateralUsd, leverage, maxLeverage: effectiveMax, entryPrice: entry,
    takeProfit, stopLoss, availableBalanceUsd: account?.balanceUsd ?? null,
    fundingAprPct: fundingForSide, isMarketOpen: market.isMarketOpen, spreadBps: market.spreadBps,
    openInterestUsd: side === 'long' ? market.openInterestLongUsd : market.openInterestShortUsd,
    maxOpenInterestUsd: market.maxOpenInterestUsd
  });

  const candidates = [{
    providerId, status: gate.health.status, capabilities: gate.provider.capabilities,
    isMarketOpen: market.isMarketOpen, maxLeverage: effectiveMax, protocolFeeBps: market.openFeeBps,
    protocolFlatUsd: adapterConsts.flatFeeUsd, networkFeeUsd: null, spreadBps: market.spreadBps,
    openInterestUsd: market.openInterestUsd, fundingAprPct: fundingForSide, dataAgeMs: gate.health.dataAgeMs, supportsMarket: true
  }];
  const route = selectVenue(candidates, { notionalUsd: collateralUsd * leverage, leverage, needTp: takeProfit != null && takeProfit > 0, needSl: stopLoss != null && stopLoss > 0 });

  return {
    ok: true, providerId, provider: gate.provider, health: gate.health, adapter, market, stale, side,
    collateralUsd, leverage, effectiveMax, takeProfit, stopLoss, slippageBps, account, entry, risk, route,
    policyId: body.feePolicy || body.policyId || 'STANDARD'
  };
}

export function futuresRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  /* ── registry / health ─────────────────────────────────────────────── */
  router.get('/providers', async (_req, res) => {
    const providers = await listProviders();
    return ok(res, { providers }, { schema: SCHEMA('providers'), dataStatus: 'live' });
  });

  router.get('/health', async (_req, res) => {
    const providers = await listProviders();
    const executable = providers.filter((p) => p.executable).map((p) => p.providerId);
    return ok(res, {
      engine: 'fbt-futures-engine', version: '3.0.0',
      providers: providers.map((p) => ({ providerId: p.providerId, status: p.status, reason: p.reason, executable: p.executable, marketCount: p.marketCount, dataAgeMs: p.dataAgeMs })),
      executableProviders: executable,
      ledger: { durable: ledgerDurable() },
      feeRecipientConfigured: Boolean(fbtFeeRecipient()),
      security: { privateKeys: 'never-held', signing: 'wallet-only', broadcasting: 'wallet-only', cexTradingApis: 'none' }
    }, { schema: SCHEMA('health') });
  });

  /* ── market data ───────────────────────────────────────────────────── */
  router.get('/markets', async (req, res) => {
    const providerId = String(req.query.provider || 'drift').toLowerCase();
    const gate = await statusGate(providerId);
    if (!gate.ok) return fail(res, gate.status, gate.code, { provider: gate.health || null });
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, gate.health.status === PROVIDER_STATUS.READ_ONLY ? 'PROVIDER_READ_ONLY' : 'NOT_CONFIGURED', { detail: gate.provider.execution === 'CLIENT_SIGNED_SESSION' ? 'markets for this provider are served by its own tab' : 'no server-side adapter is configured for this provider', provider: gate.health });
    try {
      const mk = await adapter.readMarkets();
      noteProviderSuccess(providerId);
      res.set('cache-control', 'public, max-age=10, stale-while-revalidate=30');
      return ok(res, { provider: providerId, status: gate.health.status, markets: mk.markets, live: mk.live, stale: mk.stale, generatedAt: mk.generatedAt }, { schema: SCHEMA('markets'), dataStatus: mk.live ? 'live' : 'stale' });
    } catch (err) {
      noteProviderError(providerId, 'MARKETS');
      return fail(res, 503, 'PROVIDER_UNAVAILABLE', { detail: String(err?.message || '').slice(0, 80) });
    }
  });

  router.get('/markets/:provider/:market', async (req, res) => {
    const providerId = String(req.params.provider).toLowerCase();
    const gate = await statusGate(providerId);
    if (!gate.ok) return fail(res, gate.status, gate.code);
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    try {
      const found = await adapter.findMarket(req.params.market);
      if (found.error) return fail(res, 503, 'PROVIDER_UNAVAILABLE', { detail: found.error });
      const { market, live, stale } = found;
      if (!market) return fail(res, 404, 'MARKET_NOT_LISTED');
      return ok(res, { provider: providerId, market, live, stale }, { schema: SCHEMA('market') });
    } catch { return fail(res, 503, 'PROVIDER_UNAVAILABLE'); }
  });

  router.get('/candles', async (req, res) => {
    const providerId = String(req.query.provider || 'drift').toLowerCase();
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    const out = await adapter.readCandles({ marketRef: req.query.market, resolution: req.query.resolution, limit: req.query.limit });
    if (!out.ok && out.code === 'MARKET_NOT_LISTED') return fail(res, 404, 'MARKET_NOT_LISTED');
    res.set('cache-control', 'public, max-age=30, stale-while-revalidate=60');
    return ok(res, { provider: providerId, ...out }, { schema: SCHEMA('candles'), dataStatus: out.live ? 'live' : 'unavailable' });
  });

  router.get('/funding', async (req, res) => {
    const providerId = String(req.query.provider || 'drift').toLowerCase();
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    try {
      const mk = await adapter.readMarkets();
      const rows = mk.markets.map((m) => ({ marketId: m.marketId, symbol: m.symbol, fundingAprPct: m.fundingAprPct, rolloverAprPct: m.rolloverAprPct, basis: m.fundingBasis, longPays: m.fundingAprPct != null ? m.fundingAprPct > 0 : null }));
      return ok(res, { provider: providerId, rows, live: mk.live }, { schema: SCHEMA('funding') });
    } catch { return fail(res, 503, 'PROVIDER_UNAVAILABLE'); }
  });

  router.get('/open-interest', async (req, res) => {
    const providerId = String(req.query.provider || 'drift').toLowerCase();
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    try {
      const mk = await adapter.readMarkets();
      const rows = mk.markets.map((m) => ({ marketId: m.marketId, symbol: m.symbol, longUsd: m.openInterestLongUsd, shortUsd: m.openInterestShortUsd, totalUsd: m.openInterestUsd, maxUsd: m.maxOpenInterestUsd }));
      return ok(res, { provider: providerId, rows, live: mk.live }, { schema: SCHEMA('open-interest') });
    } catch { return fail(res, 503, 'PROVIDER_UNAVAILABLE'); }
  });

  /* ── wallet-scoped reads (never cached) ────────────────────────────── */
  router.get('/positions/:wallet', async (req, res) => {
    const wallet = cleanWallet(req.params.wallet);
    if (!wallet) return fail(res, 400, 'INVALID_INPUT', { detail: 'wallet' });
    const providerId = String(req.query.provider || 'drift').toLowerCase();
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    res.set('cache-control', 'no-store');
    const out = await adapter.readPositions(wallet);
    if (!out.ok) { noteProviderError(providerId, out.code); return fail(res, 503, out.code || 'PROVIDER_UNAVAILABLE'); }
    const positions = out.positions.map((p) => ({ ...p, health: positionHealth({ providerId, side: p.side, entryPrice: p.entryPrice, markPrice: p.markPrice, leverage: p.leverage, maxLeverage: p.maxLeverage }) }));
    return ok(res, { provider: providerId, wallet, positions, marketsLive: out.marketsLive }, { schema: SCHEMA('positions'), dataStatus: 'live', pnlBasis: 'price-only' });
  });

  router.get('/account/:wallet', async (req, res) => {
    const wallet = cleanWallet(req.params.wallet);
    if (!wallet) return fail(res, 400, 'INVALID_INPUT', { detail: 'wallet' });
    const providerId = String(req.query.provider || 'drift').toLowerCase();
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    res.set('cache-control', 'no-store');
    const out = await adapter.readAccount(wallet);
    if (!out.ok) return fail(res, out.code === 'INVALID_INPUT' ? 400 : 503, out.code || 'PROVIDER_UNAVAILABLE');
    return ok(res, { provider: providerId, wallet, ...out }, { schema: SCHEMA('account'), dataStatus: 'live' });
  });

  /* ── fees (GET preview) ────────────────────────────────────────────── */
  router.get('/fees', async (req, res) => {
    const providerId = String(req.query.provider || 'drift').toLowerCase();
    const adapter = ADAPTERS[providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    const collateralUsd = num(req.query.collateral ?? req.query.collateralUsd);
    const leverage = num(req.query.leverage);
    if (collateralUsd == null || leverage == null) return fail(res, 400, 'INVALID_INPUT', { detail: 'collateral and leverage required' });
    let market = null;
    if (req.query.market) market = (await adapter.findMarket(req.query.market)).market;
    const fee = feeFor({ providerId, market, collateralUsd, leverage, networkFee: null, policyId: req.query.policy });
    if (!fee) return fail(res, 400, 'INVALID_INPUT');
    return ok(res, { provider: providerId, market: market?.symbol || null, fee, policies: FEE_POLICY_IDS }, { schema: SCHEMA('fees'), note: 'network fee is estimated at /simulate; totals are null until every component is known' });
  });

  router.get('/fees/ledger', async (req, res) => {
    const wallet = req.query.wallet ? cleanWallet(req.query.wallet) : null;
    const [summary, rows] = await Promise.all([feeSummary(), listFeeRecords({ limit: Math.min(200, Number(req.query.limit) || 50), wallet })]);
    res.set('cache-control', 'no-store');
    return ok(res, { summary, rows }, { schema: SCHEMA('fee-ledger'), durable: ledgerDurable() });
  });

  /* ── quote / risk ──────────────────────────────────────────────────── */
  router.post('/quote', async (req, res) => {
    const requestId = String(req.body?.requestId || makeFuturesRequestId()).slice(0, 64);
    const wallet = req.body?.wallet ? cleanWallet(req.body.wallet) : null;
    const o = await assembleOrder(req.body || {}, { wallet });
    if (!o.ok) return fail(res, o.status || 400, o.code, { requestId, detail: o.detail || null, provider: o.health || null });
    const fee = feeFor({ providerId: o.providerId, market: o.market, collateralUsd: o.collateralUsd, leverage: o.leverage, networkFee: null, policyId: o.policyId });
    publish('FUTURES_QUOTE_UPDATED', { requestId, providerId: o.providerId, marketId: o.market.marketId }, { source: 'futures-router' });
    return ok(res, {
      requestId, provider: o.providerId, providerStatus: o.health.status,
      market: { marketId: o.market.marketId, symbol: o.market.symbol, bid: o.market.bid, mid: o.market.mid, ask: o.market.ask, spreadBps: o.market.spreadBps, isMarketOpen: o.market.isMarketOpen, maxLeverage: o.effectiveMax, fundingAprPct: o.market.fundingAprPct, priceAt: o.market.priceAt },
      order: { side: o.side, collateralUsd: o.collateralUsd, leverage: o.leverage, notionalUsd: o.collateralUsd * o.leverage, entryPrice: o.entry, takeProfit: o.takeProfit, stopLoss: o.stopLoss, slippageBps: o.slippageBps },
      account: o.account ? { balanceUsd: o.account.balanceUsd, allowanceUsd: o.account.allowanceUsd, needsApproval: o.account.allowanceUsd != null && o.account.allowanceUsd + 1e-9 < o.collateralUsd } : null,
      fee, risk: o.risk, route: o.route,
      canExecute: o.health.executable && !o.risk.blocked && o.route.ok
    }, { schema: SCHEMA('quote'), dataStatus: o.stale ? 'stale' : 'live' });
  });

  router.post('/risk', async (req, res) => {
    const requestId = String(req.body?.requestId || makeFuturesRequestId()).slice(0, 64);
    const wallet = req.body?.wallet ? cleanWallet(req.body.wallet) : null;
    const o = await assembleOrder(req.body || {}, { wallet });
    if (!o.ok) return fail(res, o.status || 400, o.code, { requestId, detail: o.detail || null });
    publish('FUTURES_RISK_UPDATED', { requestId, riskLevel: o.risk.riskLevel, blocked: o.risk.blocked }, { source: 'futures-router' });
    return ok(res, { requestId, provider: o.providerId, risk: o.risk }, { schema: SCHEMA('risk') });
  });

  /* ── prepare / simulate / execute ──────────────────────────────────── */
  /* The calldata carries EXACTLY the bps the fee breakdown states — one
     source for the number the user reads and the number the contract enforces. */
  const buildOpen = (o, wallet, builderFeeBps) => o.adapter.buildOpenTrade({
    trader: wallet, pairId: o.market.pairId, buy: o.side === 'long', price: String(o.market.mid),
    collateralUsd: o.collateralUsd, leverage: o.leverage,
    takeProfit: o.takeProfit != null && o.takeProfit > 0 ? String(o.takeProfit) : '0',
    stopLoss: o.stopLoss != null && o.stopLoss > 0 ? String(o.stopLoss) : '0',
    slippageBps: o.slippageBps, isDayTrade: false,
    builder: fbtFeeRecipient(), builderFeeBps
  });

  async function prepareHandler(req, res, { mode }) {
    const owner = ownerFor(req);
    const requestId = String(req.body?.requestId || makeFuturesRequestId()).slice(0, 64);
    const intentId = req.body?.intentId ? String(req.body.intentId).slice(0, 64) : null;
    const idemKey = req.get('idempotency-key') || req.body?.idempotencyKey;
    if (!isValidIdempotencyKey(idemKey)) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', { requestId });
    const wallet = cleanWallet(req.body?.wallet);
    if (!wallet) return fail(res, 400, 'WALLET_NOT_CONNECTED', { requestId });

    const fingerprint = JSON.stringify({ w: wallet, p: req.body?.provider, m: req.body?.market, s: req.body?.side, c: req.body?.collateralUsd, l: req.body?.leverage, tp: req.body?.takeProfit ?? null, sl: req.body?.stopLoss ?? null, mode });
    const claim = await claimFuturesIdempotency({ owner, key: idemKey, fingerprint });
    if (!claim.ok) return fail(res, 409, claim.code, { requestId });
    if (claim.replay) return res.status(200).json({ ...claim.result, meta: { ...(claim.result.meta || {}), replay: true } });

    const o = await assembleOrder(req.body || {}, { wallet, requireWallet: true });
    if (!o.ok) return fail(res, o.status || 400, o.code, { requestId, detail: o.detail || null, provider: o.health || null });
    if (o.risk.blocked) return fail(res, 422, 'RISK_BLOCKED', { requestId, risk: o.risk });
    if (!o.route.ok) return fail(res, 409, 'PROVIDER_UNAVAILABLE', { requestId, route: o.route });
    if (!o.account) return fail(res, 503, 'PROVIDER_UNAVAILABLE', { requestId, detail: 'account read failed; balance and allowance could not be verified' });
    if (o.account.balanceUsd != null && o.account.balanceUsd + 1e-9 < o.collateralUsd) return fail(res, 400, 'INSUFFICIENT_BALANCE', { requestId, balanceUsd: o.account.balanceUsd });

    const needsApproval = o.account.allowanceUsd != null && o.account.allowanceUsd + 1e-9 < o.collateralUsd;
    const feeDraft = feeFor({ providerId: o.providerId, market: o.market, collateralUsd: o.collateralUsd, leverage: o.leverage, networkFee: null, policyId: o.policyId });
    if (!feeDraft) return fail(res, 400, 'INVALID_INPUT', { requestId });

    let unsigned;
    try {
      unsigned = buildOpen(o, wallet, feeDraft.fbt.bps);
    } catch (err) {
      const m = mapFuturesError(err);
      return fail(res, m.security ? 451 : 400, m.code, { requestId });
    }
    if (!o.adapter.OSTIUM_ALLOWED_TARGETS.includes(unsigned.to.toLowerCase())) return fail(res, 451, 'CONTRACT_MISMATCH', { requestId });

    /* Simulation: gas estimate of the FINAL tx. Without allowance the estimate
       reverts by construction, so it is only attempted when approval is in place. */
    let simulation = { attempted: false, ok: null, gas: null, networkFeeUsd: null, code: needsApproval ? 'APPROVAL_REQUIRED_FIRST' : null };
    if (!needsApproval) {
      const est = await o.adapter.estimateGas({ from: wallet, to: unsigned.to, data: unsigned.data });
      simulation = { attempted: true, ok: est.ok, gas: est.ok ? est.gas : null, gasPriceWei: est.ok ? est.gasPriceWei : null, networkFeeUsd: await networkFeeUsd(est, o.providerId), code: est.ok ? null : est.code };
      if (!est.ok && mode === 'execute') return fail(res, 422, 'SIMULATION_FAILED', { requestId, detail: est.detail || null });
    }
    const fee = feeFor({ providerId: o.providerId, market: o.market, collateralUsd: o.collateralUsd, leverage: o.leverage, networkFee: simulation.networkFeeUsd, policyId: o.policyId });
    const approval = needsApproval ? o.adapter.buildApprove({ amountUsd: o.collateralUsd }) : null;

    const execution = await createExecution({
      requestId, intentId, idempotencyKey: idemKey, owner, wallet, providerId: o.providerId, marketId: o.market.marketId, symbol: o.market.symbol,
      action: 'open', side: o.side, collateralUsd: o.collateralUsd, leverage: o.leverage, notionalUsd: o.collateralUsd * o.leverage,
      fee, risk: o.risk, route: o.route, unsignedTx: unsigned
    });
    await appendFeeRecord({ executionId: execution.executionId, requestId, intentId, wallet, providerId: o.providerId, marketId: o.market.marketId, action: 'open', fee, status: 'PREPARED', chainId: unsigned.chainId });
    publish('FUTURES_ORDER_PREPARED', { executionId: execution.executionId, requestId, intentId, providerId: o.providerId, marketId: o.market.marketId, side: o.side, notionalUsd: o.collateralUsd * o.leverage, fbtFeeUsd: fee.fbt.feeUsd }, { source: 'futures-router' });

    const wrap = (tx, kind) => tx ? ({ kind, to: tx.to, data: tx.data, value: tx.value || '0x0', chainId: tx.chainId, signed: false, broadcast: false, capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' } }) : null;
    const response = {
      ok: true,
      data: {
        requestId, intentId, executionId: execution.executionId, idempotencyKey: idemKey,
        provider: o.providerId, providerStatus: o.health.status, action: 'open',
        market: { marketId: o.market.marketId, symbol: o.market.symbol, mid: o.market.mid, bid: o.market.bid, ask: o.market.ask, priceAt: o.market.priceAt, maxLeverage: o.effectiveMax },
        order: { side: o.side, collateralUsd: o.collateralUsd, leverage: o.leverage, notionalUsd: o.collateralUsd * o.leverage, entryPrice: o.entry, takeProfit: o.takeProfit, stopLoss: o.stopLoss, slippageBps: o.slippageBps },
        account: { balanceUsd: o.account.balanceUsd, allowanceUsd: o.account.allowanceUsd, needsApproval },
        fee, risk: o.risk, route: o.route, simulation,
        transactions: [wrap(approval, 'approve'), wrap(unsigned, 'open')].filter(Boolean),
        state: 'PREPARED',
        /* Quotes go stale: the client must re-prepare after this. */
        expiresAt: now() + 45_000
      },
      meta: {
        schema: SCHEMA(mode === 'execute' ? 'execute' : 'prepare'), dataStatus: 'live',
        security: { privateKeys: 'never-held', signing: 'wallet-only', broadcasting: 'wallet-only', allowlist: 'trading-and-collateral-contracts-only', note: mode === 'execute' ? 'FBT never signs: /execute returns the same unsigned handoff as /prepare; the wallet executes.' : null }
      }
    };
    await saveFuturesIdempotency(claim, response);
    return res.status(200).json(response);
  }

  router.post('/prepare', (req, res) => prepareHandler(req, res, { mode: 'prepare' }));
  router.post('/execute', (req, res) => prepareHandler(req, res, { mode: 'execute' }));

  router.post('/simulate', async (req, res) => {
    const requestId = String(req.body?.requestId || makeFuturesRequestId()).slice(0, 64);
    const wallet = cleanWallet(req.body?.wallet);
    if (!wallet) return fail(res, 400, 'WALLET_NOT_CONNECTED', { requestId });
    const o = await assembleOrder(req.body || {}, { wallet, requireWallet: true });
    if (!o.ok) return fail(res, o.status || 400, o.code, { requestId, detail: o.detail || null });
    const feeDraft = feeFor({ providerId: o.providerId, market: o.market, collateralUsd: o.collateralUsd, leverage: o.leverage, networkFee: null, policyId: o.policyId });
    let unsigned;
    try {
      unsigned = buildOpen(o, wallet, feeDraft?.fbt.bps ?? 0);
    } catch (err) { const m = mapFuturesError(err); return fail(res, 400, m.code, { requestId }); }
    const needsApproval = o.account?.allowanceUsd != null && o.account.allowanceUsd + 1e-9 < o.collateralUsd;
    if (needsApproval) return ok(res, { requestId, simulated: false, code: 'APPROVAL_REQUIRED_FIRST', needsApproval: true, risk: o.risk }, { schema: SCHEMA('simulate') });
    const est = await o.adapter.estimateGas({ from: wallet, to: unsigned.to, data: unsigned.data });
    const netFee = await networkFeeUsd(est, o.providerId);
    const fee = feeFor({ providerId: o.providerId, market: o.market, collateralUsd: o.collateralUsd, leverage: o.leverage, networkFee: netFee, policyId: o.policyId });
    return ok(res, { requestId, simulated: est.ok, gas: est.ok ? est.gas : null, networkFeeUsd: netFee, code: est.ok ? null : est.code, detail: est.ok ? null : est.detail, fee, risk: o.risk, needsApproval: false }, { schema: SCHEMA('simulate') });
  });

  /* ── verify ────────────────────────────────────────────────────────── */
  router.post('/verify', async (req, res) => {
    const executionId = String(req.body?.executionId || '');
    const txHash = String(req.body?.txHash || '');
    const record = await getExecution(executionId);
    if (!record) return fail(res, 404, 'POSITION_NOT_FOUND', { detail: 'execution not found' });
    const adapter = ADAPTERS[record.providerId];
    if (!adapter) return fail(res, 409, 'PROVIDER_READ_ONLY');
    if (req.body?.status === 'REJECTED') {
      const updated = await updateExecution(executionId, { verification: { status: 'REJECTED', at: now() } }, 'REJECTED');
      if (record.fee) await appendFeeRecord({ executionId, requestId: record.requestId, intentId: record.intentId, wallet: record.wallet, providerId: record.providerId, marketId: record.marketId, action: record.action, fee: record.fee, status: 'CANCELLED', note: 'wallet rejected' });
      publish('FUTURES_ORDER_REJECTED', { executionId, providerId: record.providerId }, { source: 'futures-router' });
      return ok(res, { executionId, state: updated.state, verification: updated.verification }, { schema: SCHEMA('verify') });
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return fail(res, 400, 'INVALID_INPUT', { detail: 'txHash' });
    const receipt = await adapter.readReceipt(txHash);
    if (!receipt.ok) return fail(res, 503, receipt.code || 'PROVIDER_UNAVAILABLE');
    if (receipt.status === 'PENDING') {
      const updated = await updateExecution(executionId, { txHash, verification: { status: 'PENDING', at: now() } }, record.state === 'PREPARED' ? 'PENDING' : null);
      if (record.state === 'PREPARED') publish('FUTURES_ORDER_SUBMITTED', { executionId, txHash, providerId: record.providerId }, { source: 'futures-router' });
      return ok(res, { executionId, txHash, state: updated.state, verification: updated.verification }, { schema: SCHEMA('verify') });
    }
    /* Contract mismatch on the receipt is a security stop: the tx that landed is not ours. */
    if (record.tx?.to && receipt.to && receipt.to !== String(record.tx.to).toLowerCase()) {
      await updateExecution(executionId, { txHash, verification: { status: 'MISMATCH', at: now(), receiptTo: receipt.to } }, 'FAILED');
      return fail(res, 451, 'CONTRACT_MISMATCH', { executionId });
    }
    const confirmed = receipt.status === 'CONFIRMED';
    const updated = await updateExecution(executionId, { txHash, verification: { status: receipt.status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, at: now() } }, confirmed ? 'COMPLETED' : 'FAILED');
    if (record.fee && record.state !== 'COMPLETED' && record.state !== 'FAILED') {
      await appendFeeRecord({ executionId, requestId: record.requestId, intentId: record.intentId, wallet: record.wallet, providerId: record.providerId, marketId: record.marketId, action: record.action, fee: record.fee, status: confirmed ? 'CONFIRMED' : 'REVERTED', txHash, chainId: record.tx?.chainId ?? null });
      if (confirmed) publish('FUTURES_FEE_RECORDED', { executionId, fbtFeeUsd: record.fee.fbt.feeUsd, providerId: record.providerId }, { source: 'futures-router' });
    }
    publish(confirmed ? 'FUTURES_ORDER_CONFIRMED' : 'FUTURES_ORDER_FAILED', { executionId, txHash, providerId: record.providerId, action: record.action }, { source: 'futures-router' });
    if (confirmed) publish(record.action === 'open' ? 'FUTURES_POSITION_OPENED' : record.action === 'close' ? 'FUTURES_POSITION_CLOSED' : ['tp', 'sl'].includes(record.action) ? 'FUTURES_TP_SL_UPDATED' : 'FUTURES_POSITION_UPDATED', { executionId, wallet: record.wallet, providerId: record.providerId, marketId: record.marketId }, { source: 'futures-router' });
    if (confirmed) publish('POSITION_CHANGED', { owner: record.owner, module: 'futures', executionId }, { source: 'futures-router' });
    return ok(res, { executionId, txHash, state: updated.state, verification: updated.verification }, { schema: SCHEMA('verify') });
  });

  /* ── position management builders ─────────────────────────────────── */
  const manage = (action) => async (req, res) => {
    const owner = ownerFor(req);
    const requestId = String(req.body?.requestId || makeFuturesRequestId()).slice(0, 64);
    const intentId = req.body?.intentId ? String(req.body.intentId).slice(0, 64) : null;
    const idemKey = req.get('idempotency-key') || req.body?.idempotencyKey;
    if (!isValidIdempotencyKey(idemKey)) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', { requestId });
    const wallet = cleanWallet(req.body?.wallet);
    if (!wallet) return fail(res, 400, 'WALLET_NOT_CONNECTED', { requestId });
    const m = /^([a-z]+):(\d+):(\d+)$/.exec(String(req.params.id || ''));
    if (!m) return fail(res, 400, 'INVALID_INPUT', { requestId, detail: 'position id' });
    const [, providerId, pairId, index] = m;
    const gate = await statusGate(providerId, { needExecute: true });
    if (!gate.ok) return fail(res, gate.status, gate.code, { requestId, provider: gate.health || null });
    const adapter = ADAPTERS[providerId];

    const fingerprint = JSON.stringify({ w: wallet, id: req.params.id, action, v: req.body?.value ?? null, pct: req.body?.closePercent ?? null, amt: req.body?.amountUsd ?? null });
    const claim = await claimFuturesIdempotency({ owner, key: idemKey, fingerprint });
    if (!claim.ok) return fail(res, 409, claim.code, { requestId });
    if (claim.replay) return res.status(200).json({ ...claim.result, meta: { ...(claim.result.meta || {}), replay: true } });

    /* The position must exist for THIS wallet — never build against a guessed index. */
    const pos = await adapter.readPositions(wallet);
    if (!pos.ok) return fail(res, 503, 'PROVIDER_UNAVAILABLE', { requestId });
    const position = pos.positions.find((p) => p.pairId === pairId && String(p.index) === index);
    if (!position) return fail(res, 404, 'POSITION_NOT_FOUND', { requestId });
    const found = await adapter.findMarket(pairId);
    if (found.error) return fail(res, 503, 'PROVIDER_UNAVAILABLE', { requestId, detail: found.error });
    const { market, live } = found;
    if (!market || !live) return fail(res, 503, 'FEED_STALE', { requestId });

    const txs = [];
    let summary = {};
    try {
      if (action === 'close') {
        if (market.isMarketOpen === false) return fail(res, 409, 'MARKET_CLOSED', { requestId });
        const closePercent = Math.max(1, Math.min(100, num(req.body?.closePercent) ?? 100));
        const price = position.side === 'long' ? market.bid : market.ask;
        txs.push({ kind: 'close', ...adapter.buildCloseTrade({ pairId, index, closePercent, price, slippageBps: Math.max(1, Math.min(500, num(req.body?.slippageBps) ?? 25)) }) });
        summary = { closePercent, price };
      } else if (action === 'decrease') {
        const closePercent = Math.max(1, Math.min(99, num(req.body?.closePercent) ?? 50));
        const price = position.side === 'long' ? market.bid : market.ask;
        txs.push({ kind: 'decrease', ...adapter.buildCloseTrade({ pairId, index, closePercent, price, slippageBps: Math.max(1, Math.min(500, num(req.body?.slippageBps) ?? 25)) }) });
        summary = { closePercent, price };
      } else if (action === 'tp' || action === 'sl') {
        const value = num(req.body?.value);
        if (value == null || value < 0) return fail(res, 400, 'INVALID_INPUT', { requestId, detail: 'value' });
        const px = market.mid;
        if (value > 0 && action === 'tp' && ((position.side === 'long' && value <= px) || (position.side === 'short' && value >= px))) return fail(res, 400, 'INVALID_INPUT', { requestId, detail: 'TAKE_PROFIT_WRONG_SIDE' });
        if (value > 0 && action === 'sl' && ((position.side === 'long' && value >= px) || (position.side === 'short' && value <= px))) return fail(res, 400, 'INVALID_INPUT', { requestId, detail: 'STOP_LOSS_WRONG_SIDE' });
        txs.push({ kind: action, ...(action === 'tp' ? adapter.buildUpdateTp({ pairId, index, takeProfit: value }) : adapter.buildUpdateSl({ pairId, index, stopLoss: value })) });
        summary = { value };
      } else if (action === 'increase') {
        const amountUsd = num(req.body?.amountUsd);
        if (amountUsd == null || amountUsd <= 0) return fail(res, 400, 'INVALID_INPUT', { requestId, detail: 'amountUsd' });
        const account = await adapter.readAccount(wallet);
        if (!account.ok) return fail(res, 503, 'PROVIDER_UNAVAILABLE', { requestId });
        if (account.balanceUsd != null && account.balanceUsd + 1e-9 < amountUsd) return fail(res, 400, 'INSUFFICIENT_BALANCE', { requestId });
        if (account.allowanceUsd != null && account.allowanceUsd + 1e-9 < amountUsd) txs.push({ kind: 'approve', ...adapter.buildApprove({ amountUsd }) });
        txs.push({ kind: 'increase', ...adapter.buildUpdateCollateral({ pairId, index, amountUsd }) });
        const newLeverage = (position.collateralUsd * position.leverage) / (position.collateralUsd + amountUsd);
        summary = { amountUsd, newLeverage, note: 'adds collateral; notional unchanged, leverage falls' };
      }
    } catch (err) {
      const e = mapFuturesError(err);
      return fail(res, e.security ? 451 : 400, e.code, { requestId });
    }
    for (const tx of txs) if (!adapter.OSTIUM_ALLOWED_TARGETS.includes(String(tx.to).toLowerCase())) return fail(res, 451, 'CONTRACT_MISMATCH', { requestId });

    const finalTx = txs[txs.length - 1];
    const est = txs.length === 1 ? await adapter.estimateGas({ from: wallet, to: finalTx.to, data: finalTx.data }) : { ok: false, code: 'APPROVAL_REQUIRED_FIRST' };
    const netFee = await networkFeeUsd(est, providerId);
    /* Management actions carry no FBT fee (Ostium charges the builder on OPEN only). */
    const fee = computeFeeBreakdown({ collateralUsd: position.collateralUsd, leverage: position.leverage, protocolFeeBps: 0, protocolFlatUsd: action === 'close' || action === 'decrease' ? adapter.OSTIUM_ORACLE_FEE_USD : 0, networkFeeUsd: netFee, policyId: 'ZERO', venueCapBps: 0, recipient: fbtFeeRecipient(), chargedOn: 'none' });
    const execution = await createExecution({ requestId, intentId, idempotencyKey: idemKey, owner, wallet, providerId, marketId: market.marketId, symbol: market.symbol, action, side: position.side, collateralUsd: position.collateralUsd, leverage: position.leverage, notionalUsd: position.notionalUsd, fee, risk: null, route: null, unsignedTx: finalTx, positionId: position.positionId });
    publish('FUTURES_ORDER_PREPARED', { executionId: execution.executionId, requestId, providerId, action, positionId: position.positionId }, { source: 'futures-router' });
    const response = {
      ok: true,
      data: {
        requestId, intentId, executionId: execution.executionId, idempotencyKey: idemKey, provider: providerId, action, positionId: position.positionId,
        position: { symbol: position.symbol, side: position.side, collateralUsd: position.collateralUsd, leverage: position.leverage, entryPrice: position.entryPrice, markPrice: market.mid },
        summary, fee, simulation: { attempted: est.ok != null && txs.length === 1, ok: est.ok, gas: est.ok ? est.gas : null, networkFeeUsd: netFee, code: est.ok ? null : est.code },
        transactions: txs.map((tx) => ({ ...tx, signed: false, broadcast: false, capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' } })),
        state: 'PREPARED', expiresAt: now() + 45_000
      },
      meta: { schema: SCHEMA(`position-${action}`), dataStatus: 'live', security: { privateKeys: 'never-held', signing: 'wallet-only', broadcasting: 'wallet-only' } }
    };
    await saveFuturesIdempotency(claim, response);
    return res.status(200).json(response);
  };
  for (const action of ['increase', 'decrease', 'close', 'tp', 'sl']) router.post(`/positions/:id/${action}`, manage(action));

  /* ── executions per wallet ─────────────────────────────────────────── */
  router.get('/executions/:wallet', async (req, res) => {
    const wallet = cleanWallet(req.params.wallet);
    if (!wallet) return fail(res, 400, 'INVALID_INPUT');
    res.set('cache-control', 'no-store');
    const rows = await listExecutionsForWallet(wallet, { limit: Math.min(100, Number(req.query.limit) || 50) });
    return ok(res, { wallet, executions: rows }, { schema: SCHEMA('executions'), durable: ledgerDurable() });
  });

  return router;
}

export default futuresRouter;
