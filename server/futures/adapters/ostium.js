/**
 * FBT FUTURES — Ostium adapter (Arbitrum One, USDC-collateralised perps).
 * ---------------------------------------------------------------------------
 * The one provider with a REAL order path: the server builds unsigned
 * calldata against Ostium's audited Trading contract and the user's wallet
 * signs it. This file is a BFF adapter, not a relayer:
 *
 *   · reads  — pairs + live bid/mid/ask (public builder API + subgraph),
 *              funding / OI / max leverage per pair, open trades per wallet,
 *              USDC balance + allowance per wallet (multi-RPC failover)
 *   · builds — openTrade / closeTradeMarket / updateTp / updateSl /
 *              topUpCollateral / removeCollateral / approve — UNSIGNED
 *   · never  — signs, holds a key, broadcasts, or invents a price
 *
 * Encoding is done with the SAME ABI strings the browser module uses
 * (src/lib/ostium.js, golden-tested byte-for-byte against @ostium/builder-sdk
 * 0.7.0). They are duplicated here rather than imported because that module
 * reads `import.meta.env` (Vite) and cannot load in Node; a mirror-sync test
 * pins the two encoders to identical output.
 */
import { Interface, getAddress, isAddress, parseUnits, formatUnits } from 'ethers';
import { fetchOstiumPrices, fetchOstiumSubgraph, fetchOstiumOhlc, OSTIUM_OHLC_RESOLUTIONS } from '../../ostium.js';
import { EVM_CHAINS } from '../../chainsLite.js';
import { withCache } from '../../cache.js';

export const OSTIUM_CHAIN_ID = 42161;
export const OSTIUM_TRADING = '0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411';
export const OSTIUM_SPENDER = '0xcCd5891083A8acD2074690F65d3024E7D13d66E7';
export const OSTIUM_COLLATERAL = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const OSTIUM_MIN_COLLATERAL_USD = 5;
export const OSTIUM_ORACLE_FEE_USD = 0.1;
export const OSTIUM_VENUE_FEE_CAP_BPS = 50;

/** Allowlist — anything the BFF ever returns as `to` must be one of these. */
export const OSTIUM_ALLOWED_TARGETS = Object.freeze([OSTIUM_TRADING.toLowerCase(), OSTIUM_COLLATERAL.toLowerCase()]);

const OPEN_TRADE_ABI = [
  'function openTrade((uint256 collateral,uint192 openPrice,uint192 tp,uint192 sl,address trader,uint32 leverage,uint16 pairIndex,uint8 index,bool buy,bool isDayTrade) t,(address builder,uint32 builderFee) bf,uint8 orderType,uint256 slippageP)'
];
const MANAGE_ABI = [
  'function closeTradeMarket(uint16 pairIndex,uint8 index,uint16 closePercentage,uint192 marketPrice,uint32 slippageP)',
  'function updateTp(uint16 pairIndex,uint8 index,uint192 newTp)',
  'function updateSl(uint16 pairIndex,uint8 index,uint192 newSl)',
  'function topUpCollateral(uint16 pairIndex,uint8 index,uint256 topUpAmount)',
  'function removeCollateral(uint16 pairIndex,uint8 index,uint256 removeAmount)'
];
const ERC20_ABI = [
  'function approve(address spender,uint256 amount)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)'
];
const openIface = new Interface(OPEN_TRADE_ABI);
const manageIface = new Interface(MANAGE_ABI);
const erc20Iface = new Interface(ERC20_ABI);

export const ORDER_TYPE = Object.freeze({ market: 0, limit: 1, stop: 2 });

/** builderFee as the contract wants it: percent × 1e6 → bps × 1e4. */
export const feeBpsToContractUnits = (bps) => {
  const n = Number(bps);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10_000);
};

/* ── subgraph reads ──────────────────────────────────────────────────────── */

const PAIRS_QUERY = `query FbtFuturesPairs {
  pairs(first: 1000, orderBy: id, orderDirection: asc, subgraphError: allow) {
    id from to maxLeverage overnightMaxLeverage takerFeeP makerFeeP
    longOI shortOI maxOI lastFundingRate curFundingLong curFundingShort curRollover lastTradePrice
    group { name maxLeverage }
    fee { minLevPos }
  }
}`;

const TRADES_QUERY = `query FbtFuturesTrades($trader: String!) {
  trades(where: { isOpen: true, trader: $trader }, first: 100, orderBy: timestamp, orderDirection: desc) {
    id tradeID isBuy isDayTrade index collateral tradeNotional leverage highestLeverage
    openPrice stopLossPrice takeProfitPrice timestamp funding rollover
    pair { id from to maxLeverage }
  }
}`;

const scaled = (value, decimals) => {
  try {
    const raw = BigInt(value ?? 0);
    const neg = raw < 0n;
    const abs = neg ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    const out = Number(abs / base) + Number(abs % base) / Number(base);
    return neg ? -out : out;
  } catch { return 0; }
};

/* Arbitrum ≈ 0.25s blocks → ~126,144,000 blocks/year. Used ONLY to annualise a
   per-block funding rate that the subgraph reports; labelled as an estimate. */
const ARB_BLOCKS_PER_YEAR = 126_144_000;

const canonical = (from, to) => `${String(from || '').toUpperCase()}/${String(to || 'USD').toUpperCase()}`;

function normalisePair(p, priceRow) {
  const from = String(p.from || '').toUpperCase();
  const to = String(p.to || 'USD').toUpperCase();
  const ownMax = Number(p.maxLeverage || 0);
  const groupMax = Number(p.group?.maxLeverage || 0);
  const longOi = scaled(p.longOI, 6);
  const shortOi = scaled(p.shortOI, 6);
  const maxOi = scaled(p.maxOI, 6);
  /* lastFundingRate is per-block, 1e18-scaled, positive = longs pay shorts. */
  const fundingPerBlock = scaled(p.lastFundingRate, 18);
  const fundingAprPct = Number.isFinite(fundingPerBlock) ? fundingPerBlock * ARB_BLOCKS_PER_YEAR * 100 : null;
  const rolloverPerBlock = scaled(p.curRollover, 18);
  return {
    marketId: String(p.id),
    pairId: String(p.id),
    symbol: canonical(from, to),
    base: from,
    quote: to,
    category: String(p.group?.name || 'Other'),
    maxLeverage: (ownMax || groupMax) / 100 || null,
    overnightMaxLeverage: Number(p.overnightMaxLeverage || 0) / 100 || null,
    minLeveragedPositionUsd: p.fee?.minLevPos != null ? scaled(p.fee.minLevPos, 6) : null,
    openFeeBps: Number(p.takerFeeP || 0) / 10_000,
    makerFeeBps: Number(p.makerFeeP || 0) / 10_000,
    openInterestLongUsd: longOi,
    openInterestShortUsd: shortOi,
    openInterestUsd: longOi + shortOi,
    maxOpenInterestUsd: maxOi || null,
    fundingAprPct,
    fundingBasis: 'subgraph lastFundingRate per block × ~126.1M Arbitrum blocks/yr (estimate; positive = longs pay)',
    rolloverAprPct: Number.isFinite(rolloverPerBlock) ? rolloverPerBlock * ARB_BLOCKS_PER_YEAR * 100 : null,
    bid: priceRow ? Number(priceRow.bid) : null,
    mid: priceRow ? Number(priceRow.mid) : null,
    ask: priceRow ? Number(priceRow.ask) : null,
    spreadBps: priceRow && Number(priceRow.mid) > 0 ? ((Number(priceRow.ask) - Number(priceRow.bid)) / Number(priceRow.mid)) * 10_000 : null,
    isMarketOpen: priceRow ? priceRow.isMarketOpen === true : null,
    isDayTradingClosed: priceRow ? priceRow.isDayTradingClosed === true : null,
    priceAt: priceRow && Number(priceRow.timestampSeconds) > 0 ? Number(priceRow.timestampSeconds) * 1000 : null
  };
}

/** Pairs merged with live prices. Cached 10s; the price staleness flag is surfaced, never hidden. */
export async function readMarkets() {
  const { value } = await withCache('futures:ostium:markets', 10_000, async () => {
    const [graph, feed] = await Promise.all([
      fetchOstiumSubgraph({ query: PAIRS_QUERY }),
      fetchOstiumPrices()
    ]);
    const pairs = Array.isArray(graph?.data?.pairs) ? graph.data.pairs : [];
    const prices = Array.isArray(feed?.prices) ? feed.prices : [];
    const byName = new Map(prices.map((p) => [String(p.pair || `${p.from}/${p.to}`).replace('-', '/').toUpperCase(), p]));
    const markets = pairs
      .map((p) => normalisePair(p, byName.get(canonical(p.from, p.to))))
      .filter((m) => m.marketId && Number.isFinite(m.mid) && m.mid > 0);
    return {
      markets,
      live: feed?.stale !== true && markets.length > 0,
      stale: feed?.stale === true,
      generatedAt: feed?.generatedAt ?? null,
      readAt: Date.now()
    };
  });
  return value;
}

/** Never throws: an unreachable feed is `{ market: null, live: false, error }`. */
export async function findMarket(marketRef) {
  let mk;
  try { mk = await readMarkets(); }
  catch (err) { return { market: null, live: false, stale: false, readAt: null, error: String(err?.message || 'OSTIUM_UNREACHABLE').slice(0, 80) }; }
  const ref = String(marketRef || '').toUpperCase();
  const market = mk.markets.find((m) => m.marketId === ref || m.symbol === ref || m.symbol.replace('/', '-') === ref || m.symbol.replace('/', '') === ref) || null;
  return { market, live: mk.live, stale: mk.stale, readAt: mk.readAt, error: null };
}

/** Resolution → seconds per candle, for sizing the request window. */
const RES_SECONDS = Object.freeze({ '1': 60, '5': 300, '15': 900, '60': 3600, '240': 14_400, '1D': 86_400 });

/**
 * OHLC candles for the chart. Same keyless upstream as the prices; cached 30s
 * per pair/resolution. Returns `{ candles: [], live: false }` on failure — the
 * chart says "unavailable", it never draws a flat line.
 */
export async function readCandles({ marketRef, resolution = '60', limit = 96 }) {
  const res = OSTIUM_OHLC_RESOLUTIONS.includes(String(resolution)) ? String(resolution) : '60';
  const count = Math.max(2, Math.min(500, Number(limit) || 96));
  const found = await findMarket(marketRef);
  if (found.error) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: found.error, candles: [], live: false, resolution: res };
  const { market } = found;
  if (!market) return { ok: false, code: 'MARKET_NOT_LISTED', candles: [], live: false, resolution: res };
  const pair = `${market.base}-${market.quote}`;
  const key = `futures:ostium:ohlc:${pair}:${res}:${count}`;
  try {
    const { value } = await withCache(key, 30_000, async () => {
      const to = Math.floor(Date.now() / 1000);
      const from = to - RES_SECONDS[res] * count;
      const body = await fetchOstiumOhlc({ pair, fromTimestampSeconds: from, toTimestampSeconds: to, resolution: res });
      const rows = Array.isArray(body?.data) ? body.data : [];
      const candles = rows
        .map((c) => ({
          startedAt: Number(c.time) > 1e12 ? Number(c.time) : Number(c.time) * 1000,
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close)
        }))
        .filter((c) => Number.isFinite(c.startedAt) && Number.isFinite(c.close) && c.close > 0)
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-count);
      return { candles, readAt: Date.now() };
    });
    return { ok: true, marketId: market.marketId, symbol: market.symbol, resolution: res, candles: value.candles, live: value.candles.length > 1, readAt: value.readAt };
  } catch (err) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: String(err?.message || '').slice(0, 80), marketId: market.marketId, resolution: res, candles: [], live: false };
  }
}

/* ── on-chain account reads (multi-RPC failover) ─────────────────────────── */

async function rpcOnce(endpoint, method, params, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body?.error) throw new Error(String(body.error.message || body.error.code || 'rpc error'));
    return body?.result;
  } finally { clearTimeout(timer); }
}

export async function rpcWithFailover(method, params) {
  const endpoints = (EVM_CHAINS[OSTIUM_CHAIN_ID]?.rpc || []).slice();
  let lastError = null;
  for (const endpoint of endpoints) {
    try { return { ok: true, result: await rpcOnce(endpoint, method, params) }; }
    catch (error) { lastError = error; }
  }
  return { ok: false, code: 'RPC_ERROR', detail: String(lastError?.message || lastError || 'no endpoint').slice(0, 120) };
}

export async function readAccount(wallet) {
  if (!isAddress(wallet)) return { ok: false, code: 'INVALID_INPUT' };
  const owner = getAddress(wallet);
  const [bal, allow] = await Promise.all([
    rpcWithFailover('eth_call', [{ to: OSTIUM_COLLATERAL, data: erc20Iface.encodeFunctionData('balanceOf', [owner]) }, 'latest']),
    rpcWithFailover('eth_call', [{ to: OSTIUM_COLLATERAL, data: erc20Iface.encodeFunctionData('allowance', [owner, OSTIUM_SPENDER]) }, 'latest'])
  ]);
  if (!bal.ok || !allow.ok) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: bal.detail || allow.detail };
  const decode = (hex) => { try { return Number(formatUnits(BigInt(hex || '0x0'), 6)); } catch { return null; } };
  return { ok: true, chainId: OSTIUM_CHAIN_ID, collateral: 'USDC', balanceUsd: decode(bal.result), allowanceUsd: decode(allow.result), readAt: Date.now() };
}

export async function estimateGas({ from, to, data }) {
  const res = await rpcWithFailover('eth_estimateGas', [{ from, to, data, value: '0x0' }]);
  if (!res.ok) return { ok: false, code: 'GAS_ESTIMATION_FAILED', detail: res.detail };
  const price = await rpcWithFailover('eth_gasPrice', []);
  const gas = BigInt(res.result || '0x0');
  const gasPrice = price.ok ? BigInt(price.result || '0x0') : null;
  return { ok: true, gas: gas.toString(), gasPriceWei: gasPrice == null ? null : gasPrice.toString(), feeWei: gasPrice == null ? null : (gas * gasPrice).toString() };
}

/** ETH/USD for the network-fee line, from the same public feed the app already uses. */
export async function ethUsd(fetchSimplePrices) {
  try {
    const { value } = await withCache('futures:eth-usd', 60_000, () => fetchSimplePrices(['ethereum'], 'usd'));
    const px = Number(value?.ethereum?.usd);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch { return null; }
}

export async function readPositions(wallet) {
  if (!isAddress(wallet)) return { ok: false, code: 'INVALID_INPUT' };
  let graph;
  let mk;
  try {
    [graph, mk] = await Promise.all([
      fetchOstiumSubgraph({ query: TRADES_QUERY, variables: { trader: wallet.toLowerCase() } }),
      readMarkets().catch(() => ({ markets: [], live: false }))
    ]);
  } catch (err) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: String(err?.message || 'OSTIUM_UNREACHABLE').slice(0, 80) };
  }
  const trades = graph?.data?.trades;
  if (!Array.isArray(trades)) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  const byId = new Map(mk.markets.map((m) => [m.marketId, m]));
  const positions = trades.map((tr) => {
    const market = byId.get(String(tr.pair?.id));
    const leverage = Number(tr.leverage || 0) / 100;
    const collateral = scaled(tr.collateral, 6);
    const entryPrice = scaled(tr.openPrice, 18);
    const mark = market?.mid ?? null;
    const side = tr.isBuy ? 'long' : 'short';
    /* Gross PnL from price only — funding/rollover accrual is venue-side and NOT
       invented here; the response says which it is. */
    const grossPnlPct = mark != null && entryPrice > 0 ? ((mark - entryPrice) / entryPrice) * (tr.isBuy ? 1 : -1) * leverage * 100 : null;
    return {
      positionId: `ostium:${tr.pair?.id}:${tr.index}`,
      providerId: 'ostium',
      marketId: String(tr.pair?.id),
      symbol: canonical(tr.pair?.from, tr.pair?.to),
      pairId: String(tr.pair?.id),
      index: Number(tr.index || 0),
      side,
      collateralUsd: collateral,
      leverage,
      notionalUsd: collateral * leverage,
      entryPrice,
      markPrice: mark,
      takeProfit: scaled(tr.takeProfitPrice, 18) || null,
      stopLoss: scaled(tr.stopLossPrice, 18) || null,
      maxLeverage: market?.maxLeverage ?? (Number(tr.pair?.maxLeverage || 0) / 100 || null),
      grossPnlPct,
      grossPnlUsd: grossPnlPct == null ? null : (collateral * grossPnlPct) / 100,
      pnlBasis: 'price-only; funding and rollover are settled by the venue and not included',
      isDayTrade: Boolean(tr.isDayTrade),
      openedAt: Number(tr.timestamp || 0) * 1000,
      chainId: OSTIUM_CHAIN_ID
    };
  });
  return { ok: true, positions, marketsLive: mk.live, readAt: Date.now() };
}

/* ── unsigned transaction builders ───────────────────────────────────────── */

const px18 = (v) => parseUnits(String(v ?? '0'), 18);

export function buildOpenTrade({ trader, pairId, buy, price, collateralUsd, leverage, takeProfit = '0', stopLoss = '0', orderType = 'market', slippageBps = 25, isDayTrade = false, builder, builderFeeBps }) {
  if (!isAddress(trader)) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'trader' });
  if (!isAddress(builder)) throw Object.assign(new Error('CONTRACT_MISMATCH'), { code: 'CONTRACT_MISMATCH', detail: 'builder' });
  const type = ORDER_TYPE[orderType];
  if (type == null) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'orderType' });
  const lev = Number(leverage);
  if (!Number.isFinite(lev) || lev <= 0) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'leverage' });
  const col = Number(collateralUsd);
  if (!Number.isFinite(col) || col < OSTIUM_MIN_COLLATERAL_USD) throw Object.assign(new Error('BELOW_MIN'), { code: 'BELOW_MIN' });
  const data = openIface.encodeFunctionData('openTrade', [
    {
      collateral: parseUnits(String(collateralUsd), 6),
      openPrice: px18(price),
      tp: px18(takeProfit || '0'),
      sl: px18(stopLoss || '0'),
      trader: getAddress(trader),
      leverage: Math.round(lev * 100),
      pairIndex: Number(pairId),
      index: 0,
      buy: Boolean(buy),
      isDayTrade: Boolean(isDayTrade)
    },
    { builder: getAddress(builder), builderFee: feeBpsToContractUnits(builderFeeBps) },
    type,
    Math.round(Number(slippageBps))
  ]);
  return { to: OSTIUM_TRADING, data, value: '0x0', chainId: OSTIUM_CHAIN_ID };
}

export function buildCloseTrade({ pairId, index, closePercent = 100, price, slippageBps = 25 }) {
  const pct = Number(closePercent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'closePercent' });
  if (!Number.isFinite(Number(price)) || Number(price) <= 0) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'price' });
  return {
    to: OSTIUM_TRADING,
    data: manageIface.encodeFunctionData('closeTradeMarket', [Number(pairId), Number(index), Math.round(pct * 100), px18(price), Math.round(Number(slippageBps))]),
    value: '0x0', chainId: OSTIUM_CHAIN_ID
  };
}

export function buildUpdateTp({ pairId, index, takeProfit }) {
  if (!Number.isFinite(Number(takeProfit)) || Number(takeProfit) < 0) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'takeProfit' });
  return { to: OSTIUM_TRADING, data: manageIface.encodeFunctionData('updateTp', [Number(pairId), Number(index), px18(takeProfit)]), value: '0x0', chainId: OSTIUM_CHAIN_ID };
}

export function buildUpdateSl({ pairId, index, stopLoss }) {
  if (!Number.isFinite(Number(stopLoss)) || Number(stopLoss) < 0) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'stopLoss' });
  return { to: OSTIUM_TRADING, data: manageIface.encodeFunctionData('updateSl', [Number(pairId), Number(index), px18(stopLoss)]), value: '0x0', chainId: OSTIUM_CHAIN_ID };
}

export function buildUpdateCollateral({ pairId, index, amountUsd }) {
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount === 0) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'amountUsd' });
  const name = amount > 0 ? 'topUpCollateral' : 'removeCollateral';
  return {
    to: OSTIUM_TRADING,
    data: manageIface.encodeFunctionData(name, [Number(pairId), Number(index), parseUnits(String(Math.abs(amount)), 6)]),
    value: '0x0', chainId: OSTIUM_CHAIN_ID, needsApproval: amount > 0
  };
}

/** Exact-amount approval to TradingStorage (the spender), never MaxUint256. */
export function buildApprove({ amountUsd }) {
  const amt = Number(amountUsd);
  if (!Number.isFinite(amt) || amt <= 0) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT', detail: 'amountUsd' });
  return { to: OSTIUM_COLLATERAL, data: erc20Iface.encodeFunctionData('approve', [OSTIUM_SPENDER, parseUnits(String(amountUsd), 6)]), value: '0x0', chainId: OSTIUM_CHAIN_ID };
}

/** Receipt lookup for verify(); status only, never a fabricated success. */
export async function readReceipt(txHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash || ''))) return { ok: false, code: 'INVALID_INPUT' };
  const res = await rpcWithFailover('eth_getTransactionReceipt', [txHash]);
  if (!res.ok) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: res.detail };
  if (!res.result) return { ok: true, status: 'PENDING', txHash };
  const status = res.result.status === '0x1' ? 'CONFIRMED' : 'REVERTED';
  return { ok: true, status, txHash, blockNumber: Number(res.result.blockNumber), to: String(res.result.to || '').toLowerCase(), gasUsed: res.result.gasUsed ? BigInt(res.result.gasUsed).toString() : null };
}

export function healthFromMarkets(mk) {
  if (!mk || !Array.isArray(mk.markets) || !mk.markets.length) return { dataLive: false, dataStale: false };
  return { dataLive: true, dataStale: mk.stale === true || (mk.readAt && Date.now() - mk.readAt > 60_000) };
}
