import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AnimatedNumber from '../components/AnimatedNumber';
import { useChart, useCoin, useMarkets } from '../hooks/useMarket';
import { EVM_CHAINS } from '../lib/chains';
import { swapTargetFor, swapUrlFor } from '../lib/coinToSwap';
import { getCoinVenue, venueRoute } from '../lib/coinVenue';
import CandleChart from '../components/CandleChart';
import CoinLogo from '../components/CoinLogo';
import { useOhlc } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct, fmtPrice, fmtTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import SegIndicator from '../components/SegIndicator';
import HistoryPanel from '../components/HistoryPanel';
import { coinKey, invalidate, lastFetchFailed } from '../lib/api';

/**
 * Chain names for the resolved-venue line.
 *
 * Read from `EVM_CHAINS` rather than typed out — a second copy of the chain
 * names is a second thing to forget when a chain is added, and this file has
 * no other reason to import the chain table.
 */
const CHAIN_LABEL = Object.fromEntries(
  Object.entries(EVM_CHAINS).map(([id, c]) => [Number(id), c.name])
);

const RANGES = [
  { key: '1D', days: 1 },
  { key: '7D', days: 7 },
  { key: '30D', days: 30 },
  { key: '90D', days: 90 },
  { key: '1Y', days: 365 }
];

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { t, p } = payload[0].payload;
  return (
    <div className="chart-tip">
      <div style={{ color: 'var(--rgb-1)' }}>${fmtPrice(p)}</div>
      <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{fmtTime(t)}</div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <motion.div className="card card-tight" variants={riseIn}>
      <div className="faint">{label}</div>
      <div className={`mono ${tone ?? ''}`} style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>
        {value}
      </div>
    </motion.div>
  );
}

export default function CoinDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [range, setRange] = useState(RANGES[1]);

  // Fetch the coin by id rather than hunting for it inside the paged markets
  // list — that lookup is what produced "coin not found" for anything outside
  // the top 60 by market cap, which looked like a broken API but never was.
  const { data: coins } = useMarkets(60);
  const { data: fetched, loading: coinLoading, refresh: refreshCoin } = useCoin(id);
  const { data: series, loading } = useChart(id, range.days);

  /*
   * Is there a REAL, curated contract behind this coin?
   *
   * The route param IS the CoinGecko id (`/coin/:id`), which is exactly the
   * key `swapTargetFor` matches on — no translation needed, and deliberately
   * no symbol fallback: dozens of tokens share a ticker and a symbol match
   * here would put someone one tap from buying an impostor.
   */
  /* Line by default: easier to read, and most visitors are not traders. */
  const [chartMode, setChartMode] = useState('line');
  const { data: ohlc, loading: ohlcLoading } = useOhlc(chartMode === 'candle' ? id : null, range.days);

  const coinGeckoId = id;
  const realSwap = useMemo(() => swapTargetFor(coinGeckoId), [coinGeckoId]);

  /*
   * ─── THE SECOND OPINION, FOR EVERY COIN THE TABLE NEVER HEARD OF ────────
   *   «بعضی از کویین ها مثل پنگوئن میگه نمیشه سواپ کرد»
   *
   * `swapTargetFor` above is the curated answer: 46 hand-verified EVM tokens.
   * It is the BEST answer when it hits, because it carries a checked contract
   * and a counter-token. It is a terrible answer when it misses, because it
   * misses for the majority of the market list — including every Solana
   * token, and this app has a working Solana swap screen.
   *
   * So the miss is no longer the end of the conversation. We ask the server
   * for the coin's real contract addresses (CoinGecko's own platform map) and
   * offer whichever venue we can genuinely reach. Only asked when the curated
   * lookup failed — a request nobody needs is a request nobody should pay
   * for on a mobile connection.
   */
  const [venue, setVenue] = useState(null);
  const [venueChecked, setVenueChecked] = useState(false);
  useEffect(() => {
    if (realSwap) {
      setVenue(null);
      setVenueChecked(true);
      return undefined;
    }
    let alive = true;
    setVenue(null);
    setVenueChecked(false);
    getCoinVenue(coinGeckoId)
      .then((v) => {
        if (!alive) return;
        setVenue(v);
        setVenueChecked(true);
      })
      .catch(() => alive && setVenueChecked(true));
    return () => {
      alive = false;
    };
  }, [coinGeckoId, realSwap]);

  /*
   * ─── RECOVER WITHOUT MAKING THE USER TAP ANYTHING ─────────────────────────
   * The reported bug: open a coin without visiting Market first, get an error,
   * tap again, it works. The second tap succeeds because the cold-open request
   * burst has passed and CoinGecko's rate limit has reset.
   *
   * If a plain retry a moment later is all it takes, the app should do it
   * rather than showing an error screen and waiting to be asked. One attempt,
   * only when the failure was the NETWORK — a coin that truly does not exist
   * must not be re-requested in a loop.
   *
   * `invalidate` is required before retrying: without it the retry reads the
   * cached empty entry and returns instantly, doing nothing at all.
   */
  const retriedRef = useRef(false);
  useEffect(() => {
    retriedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (coinLoading || fetched || retriedRef.current) return undefined;
    if (!lastFetchFailed(coinKey(id))) return undefined;
    retriedRef.current = true;
    const timer = setTimeout(() => {
      invalidate(coinKey(id));
      refreshCoin();
    }, 900);
    return () => clearTimeout(timer);
  }, [id, fetched, coinLoading, refreshCoin]);

  const resolvedRoute = useMemo(() => venueRoute(venue), [venue]);

  /*
   * ─── THE WEEKLY / MONTHLY VERDICT LIVES ON /signals NOW ────────────────────
   * Asked for: «نمای کلی هفتگی و ماهانه در صفحه نمودار هر توکن را حذف کن باید
   * در صفحه سیگنال فقط باشد».
   *
   * The same VerdictPanel was rendered on BOTH this page and Signals, so the
   * app gave two homes to one answer. On a chart page that is the wrong
   * emphasis: someone opening a coin wants the price and its history, and a
   * stance card at the top turns a reference screen into an opinion screen.
   * Signals is the screen whose whole job is the opinion.
   *
   * Removed with it: the Bitcoin series and the global stats. They were
   * fetched ONLY to feed this panel's macro layer, so leaving them would be
   * two network polls per coin view — repeated every 60s by usePoll — with
   * nothing reading the result.
   *
   * HistoryPanel below stays: it reports measured facts about this coin's own
   * chart, which is exactly what a chart page is for.
   */

  const favorites = useAppStore((s) => s.favorites);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFav = favorites.includes(id);

  // Prefer the direct fetch; fall back to the list row so the header paints
  // instantly when the user tapped through from the market table.
  const coin = useMemo(
    () => fetched ?? (coins ?? []).find((c) => c.id === id) ?? null,
    [fetched, coins, id]
  );

  const chartData = series ?? [];

  const first = chartData[0]?.p ?? 0;
  const last = chartData[chartData.length - 1]?.p ?? 0;
  const rangeChange = first ? ((last - first) / first) * 100 : 0;
  const up = rangeChange >= 0;
  const color = up ? '#00ff9d' : '#ff3b6b';

  if (!coin && !loading && !coinLoading) {
    /*
     * ─── TWO DIFFERENT FAILURES THAT LOOKED IDENTICAL ─────────────────────
     * `coin === null` used to always print "this coin does not exist". But
     * the far more common cause is that both data sources were rate-limited
     * during the cold-open burst and the offline snapshot (50 coins) simply
     * had nothing for this id — see the EMPTY_TTL_MS note in lib/api.js.
     *
     * Telling someone a coin does not exist when the real answer is "our
     * data provider was busy for two seconds" is not a wording nitpick: it
     * sends them away from a page that would work if they waited.
     */
    const networkFailed = lastFetchFailed(coinKey(id));
    return (
      <PageTransition>
        <div className="empty">
          <span className="empty-icon">{networkFailed ? '📡' : '🪙'}</span>
          {networkFailed ? t('coin.tempUnavailable') : t('coin.notFound')}
          <p className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.8 }}>
            {networkFailed ? t('coin.tempUnavailableHelp') : t('coin.notFoundHelp')}
          </p>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              {t('common.back')}
            </button>
            {/*
              Retry in place, not window.location.reload().

              A full reload throws away the whole app — every other cached
              request, the scroll position, the market list — to re-fetch one
              coin. `invalidate` drops just this key so the poll's own refresh
              is guaranteed to hit the network, and the user stays where
              they are.
            */}
            <button
              className="btn btn-primary"
              onClick={() => {
                invalidate(coinKey(id));
                refreshCoin();
              }}
            >
              {t('common.refresh')}
            </button>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)}>
          ‹
        </button>
        <div className="row" style={{ gap: 9 }}>
          <CoinLogo coin={coin} px={28} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{coin?.name}</div>
            <div className="faint">
              #{coin?.rank} · {coin?.symbol}
            </div>
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={() => {
            haptic?.('select');
            toggleFavorite(id);
          }}
          style={{ color: isFav ? 'var(--rgb-5)' : undefined }}
        >
          {isFav ? '★' : '☆'}
        </button>
      </motion.div>

      {/* ---------- price + chart ---------- */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div className="stat-value">
              <AnimatedNumber value={coin?.price ?? last} format={(v) => `$${fmtPrice(v)}`} />
            </div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <span className={`pill ${up ? 'pill-up' : 'pill-down'}`}>{fmtPct(rangeChange)}</span>
              <span className="faint">{range.key}</span>
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="faint">{t('coin.high24h')}</div>
            <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(coin?.high24h)}</div>
            <div className="faint" style={{ marginTop: 4 }}>{t('coin.low24h')}</div>
            <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(coin?.low24h)}</div>
          </div>
        </div>

        {/*
          ─── LINE OR CANDLES ────────────────────────────────────────────────
          The page only ever had a line, which is a closing price per point.
          A line literally cannot show the high and the low: a day that opened
          at 100, spiked to 130 and closed at 101 draws as flat. That intraday
          range is most of what a trader reads a chart for, so candles are not
          decoration here — they carry information the line discards.

          Line stays the default because it is easier to read at a glance and
          most visitors are not traders.
        */}
        <div className="segmented" style={{ marginBottom: 10 }}>
          {['line', 'candle'].map((m) => (
            <button
              key={m}
              className={chartMode === m ? 'active' : ''}
              onClick={() => setChartMode(m)}
              aria-pressed={chartMode === m}
              style={{ isolation: 'isolate' }}
            >
              {chartMode === m && <SegIndicator id="coin-chartmode" />}
              {t(m === 'line' ? 'coin.chartLine' : 'coin.chartCandle')}
            </button>
          ))}
        </div>

        {chartMode === 'candle' ? (
          ohlcLoading ? (
            <div className="skel" style={{ height: 190 }} />
          ) : ohlc?.length ? (
            <>
              <CandleChart data={ohlc} height={190} />
              <p className="faint" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.7 }}>
                {t('coin.candleNote')}
              </p>
            </>
          ) : (
            /* No OHLC for this coin. Say so rather than silently showing the
               line under a tab labelled "Candles". */
            <p className="notice">{t('coin.noCandles')}</p>
          )
        ) : (
        <div className="chart-wrap" style={{ height: 190 }}>
          {loading ? (
            <div className="skel" style={{ height: '100%' }} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis domain={['dataMin', 'dataMax']} hide />
                <Tooltip content={<ChartTip />} cursor={{ stroke: 'rgba(255,255,255,.2)' }} />
                <Area
                  type="monotone"
                  dataKey="p"
                  stroke={color}
                  strokeWidth={2}
                  fill="url(#areaFill)"
                  isAnimationActive
                  animationDuration={900}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        )}

        <div className="segmented" style={{ marginTop: 10 }}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={range.key === r.key ? 'active' : ''}
              onClick={() => {
                haptic?.('select');
                setRange(r);
              }}
              style={{ isolation: 'isolate' }}
            >
              {range.key === r.key && (
                <SegIndicator id="range-ind" />
              )}
              {r.key}
            </button>
          ))}
        </div>
      </motion.section>

      {/* ---------- metrics ---------- */}
      <motion.div className="grid-2" variants={stagger} initial="hidden" animate="show">
        <Metric label={t('coin.mcap')} value={fmtCompact(coin?.mcap)} />
        <Metric label={t('coin.volume')} value={fmtCompact(coin?.volume)} />
        <Metric label={t('coin.change1h')} value={fmtPct(coin?.change1h ?? 0)} tone={(coin?.change1h ?? 0) >= 0 ? 'up' : 'down'} />
        <Metric label={t('coin.change7d')} value={fmtPct(coin?.change7d ?? 0)} tone={(coin?.change7d ?? 0) >= 0 ? 'up' : 'down'} />
        <Metric label={t('coin.supply')} value={fmtNum(coin?.supply ?? 0)} />
        <Metric label={t('coin.fromAth')} value={fmtPct(coin?.athChange ?? 0)} tone="down" />
      </motion.div>

      {/*
        ─── WHAT THE PAST SAYS ────────────────────────────────────────────
        Placed BELOW the metrics and ABOVE the buy/sell buttons on purpose:
        it is the last thing read before a decision, which is where a
        drawdown figure or a "this level broke 3 of 4 times" belongs.

        `series` is the chart data already on screen — no extra request, and
        the panel follows whichever range the user picked.
      */}
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <HistoryPanel
          series={(series ?? []).map((d) => d.p)}
          days={range.days}
          volume={coin?.volume}
        />
      </motion.div>

      {/*
        ─── THESE BUTTONS USED TO OPEN THE SIMULATOR ─────────────────────────
        Both went to `/trade`, which trades virtual credits. Someone tapping
        "Buy" on the Bitcoin page, in a wallet-connected app, reasonably
        believes they are buying Bitcoin. They were not — they were opening a
        practice screen, and would walk away thinking they held a position
        they did not hold. That is the worst class of bug this app can have.

        Now they go to the REAL swap with the pair pre-filled, but only when a
        curated contract actually exists for the coin. Most CoinGecko coins
        are not swappable here (wrong chain, or no verified contract), and for
        those the honest answer is to say so — see `swapTargetFor`. Falling
        back to the simulator is exactly what created this bug.

        The practice screen is still one tap away, clearly labelled, for
        anyone who wants to rehearse first.
      */}
      <motion.div className="stack" style={{ gap: 9 }} variants={riseIn} initial="hidden" animate="show">
        {realSwap ? (
          <>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-primary" onClick={() => navigate(swapUrlFor(coinGeckoId, 'buy'))}>
                {t('trade.buy')}
              </button>
              <button className="btn btn-ghost" onClick={() => navigate(swapUrlFor(coinGeckoId, 'sell'))}>
                {t('trade.sell')}
              </button>
            </div>
            <p className="faint" style={{ fontSize: 11.4, lineHeight: 1.7 }}>
              {t('coin.realSwapNote', { chain: realSwap.chainName, symbol: realSwap.token.symbol })}
            </p>
          </>
        ) : resolvedRoute ? (
          /*
            ─── RESOLVED, NOT CURATED ────────────────────────────────────────
            No hand-verified entry, but the coin's own contract address came
            back from CoinGecko's platform map and it is on a chain we trade.
            This is the PENGU case: a real Solana token with deep liquidity
            that the old 46-entry table called untradeable.

            The copy is deliberately different from the curated case. A
            curated token says "your wallet signs, this is not a simulation";
            this one has to add that the token is not on our verified list and
            that the amounts must be checked on the swap screen — which is
            where the existing unverified-token warning fires. Same honesty
            budget, spent on the thing that is actually uncertain here.
          */
          <>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-primary" onClick={() => navigate(resolvedRoute.href)}>
                {t('trade.buy')}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => navigate(resolvedRoute.href.replace('side=buy', 'side=sell'))}
              >
                {t('trade.sell')}
              </button>
            </div>
            <p className="faint" style={{ fontSize: 11.4, lineHeight: 1.7 }}>
              {t(
                resolvedRoute.kind === 'solana'
                  ? 'coin.resolvedSolanaNote'
                  : 'coin.resolvedEvmNote',
                {
                  chain: resolvedRoute.chainId ? CHAIN_LABEL[resolvedRoute.chainId] ?? resolvedRoute.chainId : 'Solana',
                  address: `${resolvedRoute.address.slice(0, 6)}…${resolvedRoute.address.slice(-4)}`
                }
              )}
            </p>
          </>
        ) : !venueChecked ? (
          /*
            Still asking. Showing "not tradeable" during the request would be
            a false refusal that flickers into a Buy button a second later —
            worse than a brief placeholder, because the user has already
            read it and moved on.
          */
          <div className="skel" style={{ height: 44 }} />
        ) : (
          /*
            Genuinely nowhere we can reach: no curated entry, and no contract
            on any chain this app trades. Saying so is the honest outcome —
            opening the swap screen on an arbitrary token that merely shares a
            ticker would put someone one tap from buying a fake.
          */
          <p className="notice">{t('coin.notSwappable')}</p>
        )}

        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/trade?coin=${id}&side=buy`)}>
          {t('coin.practiceInstead')}
        </button>
      </motion.div>

      <InfoBox title={t('common.notAdviceTitle')} tone="warn" id="coin-notadvice">
        <p>{t('common.notAdvice')}</p>
      </InfoBox>
    </PageTransition>
  );
}
