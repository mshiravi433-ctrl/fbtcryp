/**
 * FBT FUTURES — Intent OS adapter (spec §18).
 * ---------------------------------------------------------------------------
 * What the central brain (server/central) sees of the Futures Engine. It
 * exposes the engine through the standard module interface
 * (read / quote / prepare / simulate / execute / verify / healthCheck /
 * capabilities) so the pipeline's confirmation gate, policy engine and
 * event-driven refresh apply to futures exactly as they do to swaps.
 *
 * Honesty rules (§18.5, §18.6):
 *   · capabilities() reports READ_ONLY unless a provider is genuinely
 *     executable on this deployment — the AI can never claim it can open a
 *     position when no order path is configured;
 *   · quote/prepare never guess a market: a missing asset is a QUESTION, an
 *     unavailable provider is a structured refusal, and every reply carries
 *     the fee breakdown + risk verdict the UI would show;
 *   · execute() refuses — the server never signs. The prepared unsigned tx is
 *     the hand-off, and it only exists after the user confirmed.
 */
import { listProviders, probeProvider, fbtFeeRecipient, fbtFeeOverrideBps } from './registry.js';
import * as ostium from './adapters/ostium.js';
import * as drift from './adapters/drift.js';
import { PROVIDER_STATUS, computeFeeBreakdown, assessFuturesRisk, selectVenue, PROVIDER_CATALOGUE } from '../../src/lib/futures-engine/index.js';

export const FA = Object.freeze({
  READ_ONLY: 'این بازار در حال حاضر فقط برای مشاهده در دسترس است.',
  NOT_CONFIGURED: 'این قابلیت هنوز برای محیط Production پیکربندی نشده است.',
  ASK_MARKET: 'روی کدام بازار؟ نام بازار (مثلاً BTC یا XAU) را بگویید یا تب آن‌چین را باز کنید.',
  ASK_SIZE: 'مبلغ وثیقه (به دلار) و اهرم را مشخص کنید؛ مثلاً «۵۰ دلار با اهرم ۵».',
  WALLET_REQUIRED: 'برای ساخت سفارش، کیف پول باید متصل باشد. بدون کیف پول فقط قیمت و ریسک نشان داده می‌شود.'
});

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const live = (data, extra = {}) => ({ ok: true, dataStatus: 'live', ...data, ...extra });
const refuse = (status, error, detail = null, extra = {}) => ({ ok: false, status, error, detail, ...extra });

/** The asset symbol the brain extracted → a market ref the adapter accepts. */
const marketRefFor = (input) => {
  const explicit = input?.market || input?.marketId;
  if (explicit) return String(explicit);
  const asset = String(input?.asset || '').toUpperCase();
  return asset ? `${asset}/USD` : null;
};

export async function futuresRead(input = {}) {
  const providers = await listProviders();
  const executable = providers.filter((p) => p.executable);
  let markets = [];
  let marketsLive = false;
  try {
    /* The on-chain futures tab is Velocity (Solana) only. */
    const mk = await drift.readMarkets();
    marketsLive = mk.live;
    markets = mk.markets.slice(0, 40).map((m) => ({ providerId: 'drift', marketId: m.marketId, symbol: m.symbol, mid: m.mid, maxLeverage: m.maxLeverage, fundingAprPct: m.fundingAprPct, openInterestUsd: m.openInterestUsd, isMarketOpen: m.isMarketOpen, category: m.category }));
  } catch { /* honest empty */ }
  const asset = String(input?.asset || '').toUpperCase();
  const rows = asset ? markets.filter((m) => m.symbol.startsWith(`${asset}/`)) : markets;
  return live({
    providers: providers.map((p) => ({ providerId: p.providerId, status: p.status, reason: p.reason, executable: p.executable, chainName: p.chainName, marketCount: p.marketCount })),
    executableProviders: executable.map((p) => p.providerId),
    rows,
    marketsLive,
    onchainTab: '/perp?tab=onchain'
  }, { dataStatus: marketsLive ? 'live' : 'unavailable' });
}

/**
 * quote — the position preview the pipeline shows BEFORE asking for
 * confirmation. Requires asset + amount + leverage; asks otherwise.
 */
export async function futuresQuote(input = {}, ctx = {}) {
  const providerId = String(input.provider || 'drift').toLowerCase();
  const health = await probeProvider(providerId);
  if (!health) return refuse('POLICY', 'MARKET_NOT_LISTED', 'unknown provider');
  if (health.status === PROVIDER_STATUS.BLOCKED) return refuse('SAFE_STOP', 'PROVIDER_BLOCKED', FA.READ_ONLY, { securityStop: true });
  const marketRef = marketRefFor(input);
  if (!marketRef) return refuse('QUESTION', 'MARKET_REQUIRED', FA.ASK_MARKET, { question: FA.ASK_MARKET, missing: ['market'] });
  const collateralUsd = num(input.amountUsd ?? input.collateralUsd);
  const leverage = num(input.leverage) ?? null;
  if (collateralUsd == null || leverage == null) return refuse('QUESTION', 'SIZE_REQUIRED', FA.ASK_SIZE, { question: FA.ASK_SIZE, missing: [collateralUsd == null ? 'amountUsd' : null, leverage == null ? 'leverage' : null].filter(Boolean) });

  const found = await drift.findMarket(marketRef);
  if (found.error) return refuse('PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', found.error, { userMessage: health.status === PROVIDER_STATUS.READ_ONLY ? FA.READ_ONLY : null });
  if (!found.market) return refuse('POLICY', 'MARKET_NOT_LISTED', `${marketRef} is not listed on ${providerId}`);
  const market = found.market;
  const side = String(input.side || (String(input.direction || '').toLowerCase().includes('short') ? 'short' : 'long')).toLowerCase() === 'short' ? 'short' : 'long';
  const effectiveMax = market.isDayTradingClosed && market.overnightMaxLeverage > 0 ? market.overnightMaxLeverage : market.maxLeverage;

  const wallet = ctx?.clientData?.wallet?.evmAddresses?.[0] || ctx?.clientData?.wallet?.address || input.wallet || null;
  let account = null;
  /* Velocity's collateral (USDT) lives inside the on-chain user account, which
     only the venue SDK can decode, so readAccount reports the SOL balance and
     leaves balanceUsd null — the tab shows the real collateral. Best effort:
     a failed RPC read must not fail the quote. */
  if (wallet && drift.isSolanaAddress(wallet)) {
    const read = await drift.readAccount(wallet);
    if (read.ok) account = read;
  }

  const risk = assessFuturesRisk({
    providerId, side, collateralUsd, leverage, maxLeverage: effectiveMax, entryPrice: side === 'long' ? market.ask : market.bid,
    takeProfit: num(input.takeProfit), stopLoss: num(input.stopLoss), availableBalanceUsd: account?.balanceUsd ?? null,
    fundingAprPct: market.fundingAprPct == null ? null : (side === 'long' ? market.fundingAprPct : -market.fundingAprPct),
    isMarketOpen: market.isMarketOpen, spreadBps: market.spreadBps
  });
  const fee = computeFeeBreakdown({
    collateralUsd, leverage, protocolFeeBps: market.openFeeBps, protocolFlatUsd: 0, networkFeeUsd: null,
    policyId: 'STANDARD', overrideBps: fbtFeeOverrideBps(), venueCapBps: drift.DRIFT_VENUE_FEE_CAP_BPS, recipient: fbtFeeRecipient(), chargedOn: 'fill'
  });
  const route = selectVenue([{
    providerId, status: health.status, capabilities: PROVIDER_CATALOGUE[providerId]?.capabilities, isMarketOpen: market.isMarketOpen, maxLeverage: effectiveMax,
    protocolFeeBps: market.openFeeBps, protocolFlatUsd: 0, networkFeeUsd: null, spreadBps: market.spreadBps, openInterestUsd: market.openInterestUsd,
    fundingAprPct: market.fundingAprPct, dataAgeMs: health.dataAgeMs, supportsMarket: true
  }], { notionalUsd: collateralUsd * leverage, leverage });

  return live({
    provider: providerId, providerStatus: health.status, executable: health.executable,
    market: { marketId: market.marketId, symbol: market.symbol, mid: market.mid, bid: market.bid, ask: market.ask, maxLeverage: effectiveMax, isMarketOpen: market.isMarketOpen, fundingAprPct: market.fundingAprPct },
    order: { side, collateralUsd, leverage, notionalUsd: collateralUsd * leverage },
    fee, risk, route,
    account: account ? { balanceUsd: account.balanceUsd, allowanceUsd: account.allowanceUsd } : null,
    canExecute: Boolean(health.executable && !risk.blocked && route.ok),
    userMessage: !health.executable ? (health.reason === 'NOT_CONFIGURED' ? FA.NOT_CONFIGURED : FA.READ_ONLY) : null,
    onchainTab: `/perp?tab=onchain`
  }, { dataStatus: found.stale ? 'stale' : 'live' });
}

/**
 * prepare — runs only AFTER the user confirmed in the pipeline. Builds the
 * unsigned calldata through the same adapter the BFF uses. Never signs.
 */
export async function futuresPrepare(input = {}, ctx = {}) {
  const q = await futuresQuote(input, ctx);
  if (!q.ok) return q;
  if (!q.executable) return refuse('POLICY', q.providerStatus === PROVIDER_STATUS.READ_ONLY ? 'PROVIDER_READ_ONLY' : 'PROVIDER_UNAVAILABLE', q.userMessage || FA.READ_ONLY);
  if (q.risk.blocked) return refuse('POLICY', 'RISK_BLOCKED', q.risk.blockReasons.join(','), { risk: q.risk });
  const wallet = input.fromAddress || input.wallet
    || ctx?.clientData?.wallet?.solanaAddresses?.[0]
    || ctx?.clientData?.wallet?.evmAddresses?.[0] || null;
  /* Velocity (the only venue on the On-Chain tab) trades on Solana; accept either
     a Solana base58 address or an EVM address, but never guess one. */
  const looksLikeWallet = wallet && (drift.isSolanaAddress(wallet) || /^0x[0-9a-fA-F]{40}$/.test(wallet));
  if (!looksLikeWallet) return refuse('POLICY', 'WALLET_REQUIRED', FA.WALLET_REQUIRED);
  if (q.provider === 'drift') {
    /* CLIENT_BUILDS_TX: the server builds NO calldata and holds NO key. The
       browser constructs initializeUserAccount / USDT deposit / placePerpOrder
       instructions with @velocity-exchange/sdk and the user's Solana wallet
       signs and sends every transaction. */
    return live({
      prepared: true, signer: 'user-solana-wallet', provider: q.provider,
      market: { ...q.market, marketIndex: Number(q.market.marketId), collateralToken: drift.VELOCITY_COLLATERAL },
      order: q.order, fee: q.fee, risk: q.risk, route: q.route,
      transactions: [],
      clientSign: { family: 'solana', program: drift.VELOCITY_PROGRAM_ID, sdk: '@velocity-exchange/sdk', buildsInTab: true },
      onchainTab: '/perp?tab=onchain',
      note: 'FBT never signs; the browser builds Velocity transactions and the user\'s Solana wallet signs them on the On-Chain tab.'
    });
  }
  if (!q.account) return refuse('PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'account read failed; balance and allowance could not be verified');
  if (q.account.balanceUsd != null && q.account.balanceUsd + 1e-9 < q.order.collateralUsd) return refuse('POLICY', 'INSUFFICIENT_BALANCE', `balance ${q.account.balanceUsd} USDC`);
  let unsigned;
  try {
    unsigned = ostium.buildOpenTrade({
      trader: wallet, pairId: q.market.marketId, buy: q.order.side === 'long', price: String(q.market.mid), collateralUsd: q.order.collateralUsd, leverage: q.order.leverage,
      takeProfit: num(input.takeProfit) > 0 ? String(input.takeProfit) : '0', stopLoss: num(input.stopLoss) > 0 ? String(input.stopLoss) : '0',
      slippageBps: 25, builder: fbtFeeRecipient(), builderFeeBps: q.fee.fbt.bps
    });
  } catch (err) {
    return refuse(err?.code === 'CONTRACT_MISMATCH' ? 'SAFE_STOP' : 'POLICY', err?.code || 'INVALID_INPUT', String(err?.message || '').slice(0, 80), { securityStop: err?.code === 'CONTRACT_MISMATCH' });
  }
  const needsApproval = q.account.allowanceUsd != null && q.account.allowanceUsd + 1e-9 < q.order.collateralUsd;
  const approval = needsApproval ? ostium.buildApprove({ amountUsd: q.order.collateralUsd }) : null;
  return live({
    prepared: true, signer: 'user-wallet', provider: q.provider, market: q.market, order: q.order, fee: q.fee, risk: q.risk, route: q.route,
    unsignedTx: { ...unsigned, signed: false, broadcast: false },
    approvalTx: approval ? { ...approval, signed: false, broadcast: false } : null,
    onchainTab: '/perp?tab=onchain',
    note: 'FBT never signs; the wallet executes on the On-Chain tab.'
  });
}

export async function futuresSimulate(input = {}, ctx = {}) {
  const q = await futuresQuote(input, ctx);
  if (!q.ok) return q;
  return live({ simulated: true, risk: q.risk, fee: q.fee, canExecute: q.canExecute, warnings: q.risk.warnings, blockReasons: q.risk.blockReasons, method: 'risk + fee engine over the live market read; gas is estimated at /api/v1/futures/prepare' });
}

export async function futuresHealth() {
  try {
    const providers = await listProviders();
    const exec = providers.filter((p) => p.executable);
    const anyData = providers.some((p) => p.marketCount > 0);
    if (exec.length) return { ok: true, status: exec.some((p) => p.status === 'DEGRADED') && !exec.some((p) => p.status === 'AVAILABLE') ? 'DEGRADED' : 'AVAILABLE' };
    if (anyData) return { ok: true, status: 'READ_ONLY', reason: providers.map((p) => `${p.providerId}:${p.reason || p.status}`).join(',').slice(0, 120) };
    return { ok: false, status: 'DEGRADED', reason: 'NO_FEED' };
  } catch (err) { return { ok: false, status: 'DEGRADED', reason: String(err?.message || 'HEALTH_FAILED').slice(0, 80) }; }
}

/** Synchronous-ish capability declaration; refreshed by healthCheck. */
export function futuresCapabilities() {
  return {
    status: 'READ_ONLY',
    operations: ['read', 'quote', 'simulate', 'prepare', 'verify'],
    kinds: ['futures_open', 'futures_close', 'futures_positions', 'futures_markets', 'futures_risk', 'futures_fee', 'futures_router', 'futures_onchain', 'futures_tp_sl'],
    note: 'execution status is derived per provider from /api/v1/futures/providers; the server never signs'
  };
}
