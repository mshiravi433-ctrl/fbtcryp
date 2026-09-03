/**
 * THE ON-CHAIN VENUE FEED, AFTER THE DRIFT → VELOCITY MIGRATION.
 * ---------------------------------------------------------------------------
 * What broke, and what this probe pins:
 *
 *   drift: status = UNAVAILABLE, reason = "FEED_UNAVAILABLE", marketCount = 0
 *
 * Drift's program was paused and the protocol continued as **Velocity**
 * (a Drift v2 fork): new program ID, new Data API host
 * (`data.velocity.exchange` instead of `data.api.drift.trade`, which no longer
 * resolves), USDT instead of USDC, and a changed `/stats/markets` payload. The
 * old adapter asked the dead host for the dead `/contracts` endpoint, got
 * nothing, and honestly reported an empty feed.
 *
 * This probe runs the REAL adapter (`server/futures/adapters/drift.js`) and the
 * REAL registry (`server/futures/registry.js`) against the exact payload a live
 * `GET https://data.velocity.exchange/stats/markets` returned on 2026-09-02 —
 * strings for prices, `openInterest`/`fundingRate` as `{long, short}` objects,
 * `quoteVolume` instead of `volume24h`, `fees.taker` as a fraction, per-market
 * leverage caps — with only the network boundary stubbed. It asserts the
 * numbers the page will show, and that a dead feed still reports UNAVAILABLE
 * instead of inventing markets.
 *
 *   node test/futures-velocity-feed-probe.mjs
 */
import { memoryStore } from '../server/cache.js';

const DATA_HOST = 'https://data.velocity.exchange';
const DLOB_HOST = 'https://dlob.velocity.exchange';
process.env.VELOCITY_DATA_API = DATA_HOST;
process.env.VELOCITY_DLOB_API = DLOB_HOST;
process.env.FUTURES_PROVIDERS_ENABLED = 'drift,ostium,dydx';

/* ── the live capture: /stats/markets, verbatim shapes (trimmed to the perps
      plus two spot rows, which share the feed and must be ignored) ───────── */
const LIVE_STATS = {
  success: true,
  markets: [
    { symbol: 'USDT', marketIndex: 0, marketType: 'spot', status: 'active', precision: 6, oraclePrice: '1.000000', baseVolume: '0', quoteVolume: '0', deposits: '4059329', borrows: '34', price: '' },
    {
      symbol: 'SOL-PERP', marketIndex: 0, marketType: 'perp', uiStatus: 'visible', baseAsset: 'SOL', quoteAsset: 'USDT', status: 'active', precision: 9,
      limits: { leverage: { min: 1, max: 20 }, amount: { min: 0.01, max: 16081.91 } },
      fees: { maker: -0.000025, taker: 0.0004 },
      oraclePrice: '99.642107', markPrice: '99.854000', baseVolume: '7.880000', quoteVolume: '781.189477',
      openInterest: { long: '110.49', short: '-11.42' },
      fundingRate: { long: '-0.007591', short: '0.007591' }, fundingRate24h: '0.007546', fundingRateUpdateTs: 1788386414,
      price: '99.327920', priceChange24h: '-2.712341', priceChange24hPercent: '-2.66'
    },
    { symbol: 'SOL', marketIndex: 1, marketType: 'spot', status: 'active', precision: 9, oraclePrice: '99.642107', deposits: '926', borrows: '100' },
    {
      symbol: 'BTC-PERP', marketIndex: 1, marketType: 'perp', uiStatus: 'visible', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'active', precision: 9,
      limits: { leverage: { min: 1, max: 20 }, amount: { min: 0.0001, max: 19.8183 } },
      fees: { maker: -0.000025, taker: 0.0004 },
      oraclePrice: '77037.077959', markPrice: '77191.450000', baseVolume: '0.000200', quoteVolume: '15.546200',
      openInterest: { long: '0.05', short: '-0.003' },
      fundingRate: { long: '-0.007369', short: '0.007369' }, fundingRate24h: '0.007725', priceChange24hPercent: '-0.49'
    },
    {
      symbol: 'ETH-PERP', marketIndex: 2, marketType: 'perp', uiStatus: 'visible', baseAsset: 'ETH', quoteAsset: 'USDT', status: 'active', precision: 9,
      limits: { leverage: { min: 1, max: 20 }, amount: { min: 0.001, max: 632.622 } },
      fees: { maker: -0.000025, taker: 0.0004 },
      oraclePrice: '2380.930000', markPrice: '2386.915000', baseVolume: '0.067000', quoteVolume: '160.170704',
      openInterest: { long: '2', short: '-0.05' },
      fundingRate: { long: '-0.007556', short: '0.007556' }, fundingRate24h: '0.008158', priceChange24hPercent: '-3.44'
    },
    {
      symbol: 'HYPE-PERP', marketIndex: 3, marketType: 'perp', uiStatus: 'visible', baseAsset: 'HYPE', quoteAsset: 'USDT', status: 'active', precision: 9,
      limits: { leverage: { min: 1, max: 10 }, amount: { min: 0.1, max: 9358 } },
      fees: { maker: -0.000025, taker: 0.0004 },
      oraclePrice: '81.364848', markPrice: '81.348000', baseVolume: '0.000000', quoteVolume: '0.000000',
      openInterest: { long: '0', short: '0' },
      /* exactly Velocity's documented funding floor: 0.00125 %/h = 10.95 % APR */
      fundingRate: { long: '-0.00125', short: '0.00125' }, fundingRate24h: '0.001212', priceChange24hPercent: '0.00'
    }
  ]
};

/* The DLOB book is the opposite convention: RAW fixed-precision integers.
   "99800000" at PRICE_PRECISION 1e6 is $99.80 — not $99,800,000. */
const l2 = (bid, ask) => ({
  bids: [{ price: String(bid), size: '1000000000', sources: { dlob: '1000000000' } }],
  asks: [{ price: String(ask), size: '1000000000', sources: { dlob: '1000000000' } }],
  bestBidPrice: String(bid), bestAskPrice: String(ask),
  marketType: 'perp', marketIndex: 0, ts: 1788386414000, slot: 474184487
});
const BOOKS = { 'SOL-PERP': l2(99_800_000, 99_900_000), 'BTC-PERP': l2(77_150_000_000, 77_250_000_000), 'ETH-PERP': l2(2_385_000_000, 2_388_000_000), 'HYPE-PERP': l2(81_300_000, 81_400_000) };

/* ── the live candle capture: GET /market/SOL-PERP/candles/60, verbatim (2026-09-03).
   `ts` is UNIX SECONDS; each bucket carries BOTH the fill series (what trades
   actually executed at — carried forward when a bucket has no trades) and the
   oracle series. The last bucket simulates a real shape the API can return
   when the fill series is absent: the adapter must fall back to the oracle. */
const LIVE_CANDLES = {
  success: true,
  records: [
    /* ascending by ts from the API; three real 1h buckets */
    { ts: 1788382800, fillOpen: 99.32792, fillHigh: 99.32792, fillClose: 99.32792, fillLow: 99.32792, oracleOpen: 99.758064, oracleHigh: 99.780552, oracleClose: 99.63457, oracleLow: 99.472234, quoteVolume: 0, baseVolume: 0 },
    { ts: 1788386400, fillOpen: 99.32792, fillHigh: 99.32792, fillClose: 99.32792, fillLow: 99.32792, oracleOpen: 99.63457, oracleHigh: 99.675, oracleClose: 99.532148, oracleLow: 99.25607, quoteVolume: 0, baseVolume: 0 },
    { ts: 1788390000, fillOpen: 99.32792, fillHigh: 100.1101, fillClose: 99.74055, fillLow: 99.32792, oracleOpen: 99.532148, oracleHigh: 100.48411, oracleClose: 100.48411, oracleLow: 99.424666, quoteVolume: 3.997013, baseVolume: 0.04 },
    { ts: 1788393600, fillOpen: 99.74055, fillHigh: 100.77578, fillClose: 100.77578, fillLow: 99.74055, oracleOpen: 100.48411, oracleHigh: 100.48411, oracleClose: 99.535, oracleLow: 99.527661, quoteVolume: 15.116367, baseVolume: 0.15 },
    /* fill series absent on this bucket → the oracle bucket is the honest fallback */
    { ts: 1788397200, oracleOpen: 99.535, oracleHigh: 100.240991, oracleClose: 100.240991, oracleLow: 99.230864, quoteVolume: 0, baseVolume: 0 }
  ]
};

let mode = 'live';           // 'live' | 'dead' | 'no-candles'
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  seen.push(u);
  if (mode === 'dead') throw new TypeError('fetch failed'); // what DNS death looks like to fetch()
  if (u.startsWith(`${DATA_HOST}/stats/markets`)) return Response.json(LIVE_STATS);
  if (u.startsWith(`${DLOB_HOST}/l2`)) {
    const name = new URL(u).searchParams.get('marketName');
    return BOOKS[name] ? Response.json(BOOKS[name]) : Response.json({ bids: [], asks: [] });
  }
  /* The candles endpoint is REAL (verified 2026-09-03); 'no-candles' simulates
     the venue dropping it again — the honest failure this probe pins. */
  if (/\/candles\//.test(u)) {
    if (mode === 'no-candles') return Response.json({ message: 'Route not found', error: 'Not Found', statusCode: 404 }, { status: 404 });
    return Response.json(LIVE_CANDLES);
  }
  return Response.json({ message: `Route GET:${new URL(u).pathname} not found`, error: 'Not Found', statusCode: 404 }, { status: 404 });
};

const out = [];
const t = (name, ok, extra = '') => {
  out.push([name, Boolean(ok)]);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : ` — ${extra}`}`);
};
const near = (a, b, tol = 1e-6) => a != null && Math.abs(Number(a) - b) <= tol;

const adapter = await import('../server/futures/adapters/drift.js');
const registry = await import('../server/futures/registry.js');
const { resolveProviderStatus, PROVIDER_CATALOGUE, EXECUTION_MODEL } = await import('../src/lib/futures-engine/providers.js');

/* ── 0. the reported symptom, reproduced from the pure status function ───── */
const before = resolveProviderStatus({ execution: EXECUTION_MODEL.CLIENT_BUILDS_TX, configured: true, enabled: true, dataLive: false });
t('a dead feed on the executable catalogue is exactly UNAVAILABLE · FEED_UNAVAILABLE',
  before.status === 'UNAVAILABLE' && before.reason === 'FEED_UNAVAILABLE', JSON.stringify(before));

/* ── 1. the live Velocity feed, through the real adapter ─────────────────── */
const mk = await adapter.readMarkets();
const sol = mk.markets.find((m) => m.base === 'SOL');
const hype = mk.markets.find((m) => m.base === 'HYPE');

t('the live feed yields the four Velocity perps', mk.markets.length === 4 && mk.live === true, `${mk.markets.length} markets`);
t('spot rows on the same feed are not perps', mk.markets.every((m) => m.quote === 'USDT' && m.symbol.endsWith('/USDT')));
t('market ids are the fork\'s own indices', mk.markets.map((m) => m.marketId).join(',') === '0,1,2,3', mk.markets.map((m) => m.marketId).join(','));
t('SOL-PERP mark price is read from the numeric string', near(sol?.mid, 99.854), String(sol?.mid));
t('SOL-PERP quote is USDT, not the old USDC label', sol?.quote === 'USDT' && sol?.symbol === 'SOL/USDT', String(sol?.symbol));
t('open interest {long, short} in BASE units is valued at the mark',
  near(sol?.openInterestUsd, (110.49 + 11.42) * 99.854, 1e-6) && near(sol?.openInterestLongUsd, 110.49 * 99.854, 1e-6), String(sol?.openInterestUsd));
t('funding %/hour on the short side becomes an APR (0.007591 → 66.50%)',
  near(sol?.fundingAprPct, 0.007591 * 24 * 365, 1e-6), String(sol?.fundingAprPct));
t('HYPE-PERP funding is Velocity\'s 10.95% floor', near(hype?.fundingAprPct, 10.95, 1e-9), String(hype?.fundingAprPct));
t('24h volume comes from quoteVolume', near(sol?.volume24hUsd, 781.189477, 1e-9), String(sol?.volume24hUsd));
t('venue fees are read from the feed (taker 4 bps, maker −0.25 bps)',
  near(sol?.openFeeBps, 4, 1e-9) && near(sol?.makerFeeBps, -0.25, 1e-9), `${sol?.openFeeBps}/${sol?.makerFeeBps}`);
t('leverage caps are the feed\'s per-market ones (20x, and 10x on HYPE)',
  sol?.maxLeverage === 20 && hype?.maxLeverage === 10, `${sol?.maxLeverage}/${hype?.maxLeverage}`);
t('DLOB prices are divided by PRICE_PRECISION (99800000 → $99.80)',
  near(sol?.bid, 99.8, 1e-9) && near(sol?.ask, 99.9, 1e-9), `${sol?.bid}/${sol?.ask}`);
t('spread is computed from the real touch', near(sol?.spreadBps, ((99.9 - 99.8) / 99.854) * 10_000, 1e-6), String(sol?.spreadBps));
t('healthFromMarkets reports the feed live', adapter.healthFromMarkets(mk).dataLive === true);

/* ── 2. findMarket + candles: real OHLC, honestly shaped ────────────────── */
const byBase = await adapter.findMarket('SOL');
const byVenueSymbol = await adapter.findMarket('BTC-PERP');
const missing = await adapter.findMarket('JUP'); // listed on Drift, not on Velocity
t('findMarket resolves base symbol and venue symbol', byBase.market?.marketId === '0' && byVenueSymbol.market?.marketId === '1');
t('a Drift-only perp is MARKET_NOT_LISTED, not invented', missing.market === null && byBase.live === true);

const candles = await adapter.readCandles({ marketRef: 'SOL', resolution: '60', limit: 96 });
t('candles come from the venue\'s real /market/:symbol/candles endpoint',
  candles.ok === true && candles.live === true && candles.candles.length === 5,
  `${candles.candles?.length} candles / live=${candles.live}`);
t('a candle\'s ts is unix SECONDS and becomes ms in the row',
  candles.candles[0]?.startedAt === 1_788_382_800_000, String(candles.candles[0]?.startedAt));
t('the fill series is charted: the traded OHLC of the 1788393600 bucket',
  near(candles.candles[3]?.open, 99.74055) && near(candles.candles[3]?.high, 100.77578)
    && near(candles.candles[3]?.low, 99.74055) && near(candles.candles[3]?.close, 100.77578),
  JSON.stringify(candles.candles[3]));
t('a bucket with no fill series falls back to the ORACLE bucket, never to a made-up price',
  near(candles.candles[4]?.close, 100.240991) && near(candles.candles[4]?.low, 99.230864),
  JSON.stringify(candles.candles[4]));
t('candles arrive sorted oldest → newest', candles.candles.every((c, i, a) => i === 0 || a[i - 1].startedAt < c.startedAt));
const limited = await adapter.readCandles({ marketRef: 'SOL', resolution: '60', limit: 2 });
t('limit=2 keeps only the newest 2 buckets', limited.candles.length === 2 && limited.candles[0].startedAt === 1_788_393_600_000);
const oddRes = await adapter.readCandles({ marketRef: 'SOL', resolution: '7D' });
t('an unknown candle resolution is normalised to 60, never forwarded upstream',
  oddRes.resolution === '60' && oddRes.live === true);
mode = 'no-candles';
memoryStore.clear();
const noCandles = await adapter.readCandles({ marketRef: 'SOL', resolution: '60', limit: 24 });
t('a venue that drops the candles endpoint gets an honest unavailable, not a fabricated chart',
  noCandles.ok === true && noCandles.live === false && noCandles.candles.length === 0,
  noCandles.detail || '');
mode = 'live';

/* ── 3. the registry derives the venue status from the same read ─────────── */
registry.resetFuturesRegistry();
const health = await registry.probeProvider('drift', { force: true });
t('registry: 4 markets, data live', health.marketCount === 4 && health.dataAgeMs != null, `marketCount=${health.marketCount}`);
t('registry: a live feed on an executable catalogue is AVAILABLE',
  health.status === 'AVAILABLE' && health.reason === null, `${health.status}/${health.reason}`);
/* The order path is built in the tab (@velocity-exchange/sdk + the user's
   wallet), so the venue is genuinely tradeable — this is the flip from the
   read-only phase. */
t('registry: the Velocity order path is CLIENT_BUILDS_TX and executable',
  health.executable === true && health.execution === EXECUTION_MODEL.CLIENT_BUILDS_TX
    && PROVIDER_CATALOGUE.drift.name === 'Velocity'
    && PROVIDER_CATALOGUE.drift.capabilities.canExecute === true
    && PROVIDER_CATALOGUE.drift.capabilities.canPrepare === true,
  `${health.execution}/executable=${health.executable}`);
t('registry: TP/SL and reduce-only are claimed, partial close is not',
  PROVIDER_CATALOGUE.drift.capabilities.supportsTakeProfit === true
    && PROVIDER_CATALOGUE.drift.capabilities.supportsStopLoss === true
    && PROVIDER_CATALOGUE.drift.capabilities.supportsReduceOnly === true
    && PROVIDER_CATALOGUE.drift.capabilities.supportsPartialClose === false);
t('registry: the venue is labelled Velocity on Solana with USDT collateral',
  health.name === 'Velocity' && health.chainName === 'Solana' && health.collateral === 'USDT');

/* ── 4. the failure mode still fails honestly (and now explains itself) ──── */
mode = 'dead';
memoryStore.clear();
registry.resetFuturesRegistry();
const dark = await registry.probeProvider('drift', { force: true });
t('a dead feed is still UNAVAILABLE with 0 markets (the reported symptom)',
  dark.status === 'UNAVAILABLE' && dark.reason === 'FEED_UNAVAILABLE' && dark.marketCount === 0 && dark.executable === false,
  `${dark.status}/${dark.reason}/${dark.marketCount}`);
t('the registry now explains WHY the feed is dark', String(dark.detail || '').includes('FEED_UNREACHABLE'), String(dark.detail));

memoryStore.clear();
globalThis.fetch = realFetch;

const failed = out.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} failed` : '\nall velocity feed checks passed');
if (failed.length) process.exitCode = 1;
