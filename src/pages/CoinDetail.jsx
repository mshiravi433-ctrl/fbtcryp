import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AnimatedNumber from '../components/AnimatedNumber';
import { useChart, useCoin, useGlobalStats, useMarkets } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct, fmtPrice, fmtTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import SegIndicator from '../components/SegIndicator';
import HistoryPanel from '../components/HistoryPanel';
import VerdictPanel from '../components/VerdictPanel';
import { analyze } from '../lib/ai';

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
  const { data: fetched, loading: coinLoading } = useCoin(id);
  const { data: series, loading } = useChart(id, range.days);
  /*
   * Bitcoin over the SAME range, plus the global stats, for the verdict
   * panel's macro layer. Both series have to come from one endpoint with one
   * `days` value or their daily returns cannot be paired, which is why this
   * follows `range` rather than using a fixed window.
   *
   * On the bitcoin page this is the identical request the line above already
   * made, so the poll cache answers it without touching the network.
   */
  const { data: btcSeries } = useChart('bitcoin', range.days);
  const { data: global } = useGlobalStats();

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

  /*
   * The technical read, computed here rather than inside VerdictPanel.
   *
   * `analyze()` needs at least 30 valid points and returns null below that,
   * which is the signal to render nothing at all — a coin listed last week
   * genuinely has nothing to say and a panel full of "unknown" would be worse
   * than no panel. Keeping the call here means that decision is visible at
   * the call site instead of buried in the component.
   */
  const analysis = useMemo(
    () => analyze(chartData.map((d) => d.p), coin ?? {}),
    [chartData, coin]
  );
  const first = chartData[0]?.p ?? 0;
  const last = chartData[chartData.length - 1]?.p ?? 0;
  const rangeChange = first ? ((last - first) / first) * 100 : 0;
  const up = rangeChange >= 0;
  const color = up ? '#00ff9d' : '#ff3b6b';

  if (!coin && !loading && !coinLoading) {
    return (
      <PageTransition>
        <div className="empty">
          <span className="empty-icon">🪙</span>
          {t('coin.notFound')}
          <p className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.8 }}>
            {t('coin.notFoundHelp')}
          </p>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              {t('common.back')}
            </button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
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
          <div className="coin-logo" style={{ width: 28, height: 28 }}>
            {coin?.image ? <img src={coin.image} alt="" /> : coin?.symbol?.slice(0, 3)}
          </div>
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
      {/*
        The verdict first, then the raw history behind it. That order matters:
        the verdict is the readable answer and the history panel is the
        evidence, and a reader who stops after the first panel should already
        have the correct impression rather than a list of measurements they
        have to synthesise themselves.
      */}
      {analysis && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <VerdictPanel
            analysis={analysis}
            series={(series ?? []).map((d) => d.p)}
            btcSeries={(btcSeries ?? []).map((d) => d.p)}
            coin={coin}
            global={global}
          />
        </motion.div>
      )}

      <motion.div variants={riseIn} initial="hidden" animate="show">
        <HistoryPanel
          series={(series ?? []).map((d) => d.p)}
          days={range.days}
          volume={coin?.volume}
        />
      </motion.div>

      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="btn btn-primary" onClick={() => navigate(`/trade?coin=${id}&side=buy`)}>
          {t('trade.buy')}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate(`/trade?coin=${id}&side=sell`)}>
          {t('trade.sell')}
        </button>
      </motion.div>

      <p className="notice">{t('common.notAdvice')}</p>
    </PageTransition>
  );
}
