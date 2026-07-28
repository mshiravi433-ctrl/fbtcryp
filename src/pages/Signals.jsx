import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import AnimatedNumber from '../components/AnimatedNumber';
import Sparkline from '../components/Sparkline';
import { useChart, useGlobalStats, useMarkets } from '../hooks/useMarket';
import { analyze, marketSentiment, projectRange } from '../lib/ai';
import { fmtPct, fmtPrice } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { aiStatus, getMarketBrief, getOutlook } from '../lib/aiClient';

const HORIZONS = [
  { days: 1, key: '1D' },
  { days: 7, key: '7D' },
  { days: 30, key: '30D' }
];

/** Animated gauge for the -100..100 signal score. */
function Gauge({ score, label, confidence }) {
  const { t } = useTranslation();
  const pct = (score + 100) / 200;
  const angle = -90 + pct * 180;

  const color =
    score > 40 ? 'var(--up)' : score > 12 ? '#7ee787' : score < -40 ? 'var(--down)' : score < -12 ? '#ff8fa3' : 'var(--rgb-5)';

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 250, margin: '0 auto' }}>
      <svg viewBox="0 0 200 116" style={{ width: '100%', overflow: 'visible' }}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff3b6b" />
            <stop offset="50%" stopColor="#ffb300" />
            <stop offset="100%" stopColor="#00ff9d" />
          </linearGradient>
        </defs>
        <path d="M14 100 A86 86 0 0 1 186 100" fill="none" stroke="rgba(127,127,127,.18)" strokeWidth="13" strokeLinecap="round" />
        <motion.path
          d="M14 100 A86 86 0 0 1 186 100"
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray="270"
          initial={{ strokeDashoffset: 270 }}
          animate={{ strokeDashoffset: 270 - 270 * pct }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.g
          initial={{ rotate: -90 }}
          animate={{ rotate: angle }}
          transition={{ type: 'spring', stiffness: 60, damping: 14 }}
          style={{ transformOrigin: '100px 100px' }}
        >
          <line x1="100" y1="100" x2="100" y2="34" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="100" cy="100" r="7" fill={color} />
        </motion.g>
      </svg>

      <div style={{ textAlign: 'center', marginTop: -18 }}>
        <div className="stat-value" style={{ color, fontSize: 30 }}>
          <AnimatedNumber value={score} format={(v) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)))} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{t(`signals.label.${label}`)}</div>
        <div className="faint" style={{ marginTop: 3 }}>
          {t('signals.confidence')}: {confidence}%
        </div>
      </div>
    </div>
  );
}

function IndicatorBar({ signal }) {
  const { t } = useTranslation();
  const pct = Math.abs(signal.score);
  const positive = signal.score >= 0;
  return (
    <motion.div variants={riseIn} style={{ marginBottom: 11 }}>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{t(`signals.ind.${signal.key}`)}</span>
        <span className={`mono ${positive ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
          {positive ? '+' : ''}{signal.score}
        </span>
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: 'rgba(127,127,127,.14)' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          {!positive && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              style={{ background: 'var(--down)', borderRadius: 999 }}
            />
          )}
        </div>
        <div style={{ width: 1, background: 'rgba(255,255,255,.25)' }} />
        <div style={{ flex: 1 }}>
          {positive && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              style={{ background: 'var(--up)', borderRadius: 999, height: '100%' }}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function Signals() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const { data: coins } = useMarkets(40);
  const { data: global } = useGlobalStats();

  const [coinId, setCoinId] = useState('bitcoin');
  const [horizon, setHorizon] = useState(HORIZONS[1]);
  const [scanning, setScanning] = useState(true);

  const [ai, setAi] = useState({ enabled: false });
  const [outlook, setOutlook] = useState(null);
  const [brief, setBrief] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const { data: chart } = useChart(coinId, 30);
  const coin = useMemo(() => (coins ?? []).find((c) => c.id === coinId), [coins, coinId]);

  const analysis = useMemo(() => {
    const prices = chart?.length ? chart.map((p) => p.p) : coin?.sparkline;
    return prices ? analyze(prices, coin ?? {}) : null;
  }, [chart, coin]);

  const projection = useMemo(
    () => (analysis ? projectRange(analysis, horizon.days) : null),
    [analysis, horizon]
  );

  const sentiment = useMemo(() => marketSentiment(global), [global]);

  useEffect(() => {
    aiStatus().then(setAi);
  }, []);

  // Daily market brief. Server caches per 6h window, so this is one LLM call
  // shared across all users rather than one per page view.
  useEffect(() => {
    if (!ai.enabled || !global || !coins?.length) return;
    getMarketBrief({ global, top: coins.slice(0, 8), lang: i18n.language })
      .then(setBrief)
      .catch(() => {});
  }, [ai.enabled, global, coins, i18n.language]);

  // Per-asset outlook, refreshed daily server-side.
  useEffect(() => {
    if (!ai.enabled || !analysis || !coin) return;
    let alive = true;
    setAiLoading(true);
    setAiError(null);
    setOutlook(null);
    getOutlook({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      price: coin.price,
      indicators: analysis.indicators,
      change24h: coin.change24h,
      change7d: coin.change7d,
      lang: i18n.language
    })
      .then((r) => alive && setOutlook(r))
      .catch((e) => alive && setAiError(e.code || 'AI_FAILED'))
      .finally(() => alive && setAiLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.enabled, coin?.id, analysis?.score, i18n.language]);

  // brief "scanning" animation whenever the asset changes — signals that the
  // numbers were recomputed rather than left stale
  useEffect(() => {
    setScanning(true);
    const id = setTimeout(() => setScanning(false), 850);
    return () => clearTimeout(id);
  }, [coinId]);

  /** Top opportunities across the market, ranked by |score| × confidence. */
  const ranked = useMemo(() => {
    if (!coins?.length) return [];
    return coins
      .map((c) => {
        const a = c.sparkline?.length >= 30 ? analyze(c.sparkline, c) : null;
        return a ? { coin: c, a, strength: Math.abs(a.score) * (a.confidence / 100) } : null;
      })
      .filter(Boolean)
      .sort((x, y) => y.strength - x.strength)
      .slice(0, 8);
  }, [coins]);

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('signals.title')}</h1>
        <p className="muted">{t('signals.subtitle')}</p>
      </motion.div>

      {/* ---------- market sentiment gauge ---------- */}
      {sentiment && (
        <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div className="row-between">
            <div>
              <div className="faint">{t('signals.marketMood')}</div>
              <div className="stat-mini" style={{ fontSize: 19 }}>
                {t(`signals.mood.${sentiment.label}`)}
              </div>
            </div>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: 17,
                background: `conic-gradient(${sentiment.score > 55 ? 'var(--up)' : sentiment.score < 45 ? 'var(--down)' : 'var(--rgb-5)'} ${sentiment.score}%, rgba(127,127,127,.15) 0)`
              }}
            >
              <span
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  background: 'var(--bg-panel-solid)',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                {sentiment.score}
              </span>
            </div>
          </div>
        </motion.section>
      )}

      {brief && (
        <motion.section className="card edge-mint card-rgb" variants={riseIn} initial="hidden" animate="show">
          <div className="aurora" />
          <div className="row-between" style={{ marginBottom: 7 }}>
            <span className="field-label" style={{ margin: 0 }}>✦ {t('signals.dailyBrief')}</span>
            <span className={`pill ${brief.bias === 'bullish' ? 'pill-up' : brief.bias === 'bearish' ? 'pill-down' : 'pill-rgb'}`}>
              {t(`signals.bias.${brief.bias}`)}
            </span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 5 }}>{brief.headline}</div>
          <p className="muted" style={{ fontSize: 12.2, margin: 0 }}>{brief.summary}</p>
        </motion.section>
      )}

      {/* ---------- asset picker ---------- */}
      <div className="tag-scroll">
        {(coins ?? []).slice(0, 14).map((c) => (
          <button
            key={c.id}
            className={`tag ${coinId === c.id ? 'active' : ''}`}
            onClick={() => {
              haptic?.('select');
              setCoinId(c.id);
            }}
          >
            {c.symbol}
          </button>
        ))}
      </div>

      {/* ---------- the gauge ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <AnimatePresence mode="wait">
          {scanning || !analysis ? (
            <motion.div
              key="scan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ height: 210, display: 'grid', placeItems: 'center', gap: 12 }}
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  border: '3px solid rgba(127,127,127,.2)',
                  borderTopColor: 'var(--rgb-1)'
                }}
              />
              <span className="faint">{t('signals.analyzing')}</span>
            </motion.div>
          ) : (
            <motion.div key="gauge" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <div className="row" style={{ gap: 9 }}>
                  <div className="coin-logo">{coin?.image ? <img src={coin.image} alt="" /> : coin?.symbol?.slice(0, 3)}</div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{coin?.symbol}</div>
                    <div className="faint mono">${fmtPrice(coin?.price)}</div>
                  </div>
                </div>
                <span className={`pill ${(coin?.change24h ?? 0) >= 0 ? 'pill-up' : 'pill-down'}`}>
                  {fmtPct(coin?.change24h ?? 0)}
                </span>
              </div>

              <Gauge score={analysis.score} label={analysis.label} confidence={analysis.confidence} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* ---------- AI outlook ---------- */}
      {ai.enabled && (
        <motion.section className="card card-rgb edge-orchid" variants={riseIn} initial="hidden" animate="show">
          <div className="aurora" />
          <div className="row-between" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <motion.span
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 2.4, repeat: Infinity }}
                style={{ fontSize: 15 }}
              >
                ✦
              </motion.span>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t('signals.aiOutlook')}</span>
            </div>
            {outlook && (
              <span className={`pill ${outlook.bias === 'bullish' ? 'pill-up' : outlook.bias === 'bearish' ? 'pill-down' : 'pill-rgb'}`}>
                {t(`signals.bias.${outlook.bias}`)} · {outlook.confidence}%
              </span>
            )}
          </div>

          {aiLoading && (
            <div className="stack" style={{ gap: 8 }}>
              {[92, 78, 60].map((w) => (
                <motion.div
                  key={w}
                  className="skel"
                  style={{ height: 11, width: `${w}%` }}
                  animate={{ opacity: [0.4, 0.9, 0.4] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
              ))}
              <span className="faint" style={{ marginTop: 4 }}>{t('signals.aiThinking')}</span>
            </div>
          )}

          {aiError && <p className="notice">{t('signals.aiUnavailable')}</p>}

          {outlook && !aiLoading && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.6, marginBottom: 7 }}>
                {outlook.headline}
              </div>
              <p className="muted" style={{ fontSize: 12.4, margin: 0 }}>{outlook.summary}</p>

              {outlook.range?.low != null && (
                <div className="card card-tight row-between" style={{ marginTop: 11 }}>
                  <span className="faint">{t('signals.aiRange', { d: outlook.range.horizonDays })}</span>
                  <span className="mono" style={{ fontSize: 12.5 }}>
                    ${fmtPrice(outlook.range.low)} – ${fmtPrice(outlook.range.high)}
                  </span>
                </div>
              )}

              {outlook.drivers?.length > 0 && (
                <div style={{ marginTop: 11 }}>
                  <div className="field-label">{t('signals.drivers')}</div>
                  {outlook.drivers.map((d, i) => (
                    <motion.div
                      key={i}
                      className="row"
                      style={{ gap: 7, marginTop: 4, alignItems: 'flex-start' }}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i }}
                    >
                      <span className="up" style={{ fontSize: 11 }}>▲</span>
                      <span className="muted" style={{ fontSize: 12 }}>{d}</span>
                    </motion.div>
                  ))}
                </div>
              )}

              {outlook.risks?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="field-label">{t('signals.risks')}</div>
                  {outlook.risks.map((r, i) => (
                    <motion.div
                      key={i}
                      className="row"
                      style={{ gap: 7, marginTop: 4, alignItems: 'flex-start' }}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i }}
                    >
                      <span className="down" style={{ fontSize: 11 }}>▼</span>
                      <span className="muted" style={{ fontSize: 12 }}>{r}</span>
                    </motion.div>
                  ))}
                </div>
              )}

              {outlook.invalidation && (
                <p className="notice" style={{ marginTop: 11 }}>
                  <strong>{t('signals.invalidation')}:</strong> {outlook.invalidation}
                </p>
              )}

              <div className="faint" style={{ marginTop: 9, fontSize: 10 }}>
                {t('signals.aiMeta', { model: outlook.model })}
              </div>
            </motion.div>
          )}
        </motion.section>
      )}

      {/* ---------- indicator breakdown ---------- */}
      {analysis && !scanning && (
        <motion.section className="card" variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 12 }}>{t('signals.breakdown')}</p>
          {analysis.signals.map((s) => (
            <IndicatorBar key={s.key} signal={s} />
          ))}

          <div className="grid-2" style={{ gap: 9, marginTop: 6 }}>
            {analysis.indicators.rsi != null && (
              <div className="card card-tight">
                <div className="faint">RSI (14)</div>
                <div className="mono" style={{ fontSize: 13 }}>{analysis.indicators.rsi.toFixed(1)}</div>
              </div>
            )}
            {analysis.indicators.volatility != null && (
              <div className="card card-tight">
                <div className="faint">{t('signals.volatility')}</div>
                <div className="mono" style={{ fontSize: 13 }}>{analysis.indicators.volatility.toFixed(0)}%</div>
              </div>
            )}
            {analysis.indicators.support != null && (
              <div className="card card-tight">
                <div className="faint">{t('signals.support')}</div>
                <div className="mono up" style={{ fontSize: 13 }}>${fmtPrice(analysis.indicators.support)}</div>
              </div>
            )}
            {analysis.indicators.resistance != null && (
              <div className="card card-tight">
                <div className="faint">{t('signals.resistance')}</div>
                <div className="mono down" style={{ fontSize: 13 }}>${fmtPrice(analysis.indicators.resistance)}</div>
              </div>
            )}
          </div>
        </motion.section>
      )}

      {/* ---------- projection cone ---------- */}
      {projection && !scanning && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>{t('signals.projection')}</p>
            <div className="segmented" style={{ width: 'auto' }}>
              {HORIZONS.map((h) => (
                <button
                  key={h.key}
                  className={horizon.key === h.key ? 'active' : ''}
                  onClick={() => setHorizon(h)}
                  style={{ isolation: 'isolate', padding: '6px 11px' }}
                >
                  {horizon.key === h.key && <motion.span layoutId="hz" className="seg-indicator" />}
                  {h.key}
                </button>
              ))}
            </div>
          </div>

          <div className="row-between" style={{ marginBottom: 8 }}>
            <div>
              <div className="faint">{t('signals.low')}</div>
              <div className="mono down" style={{ fontSize: 13 }}>${fmtPrice(projection.low)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="faint">{t('signals.mid')}</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>${fmtPrice(projection.mid)}</div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="faint">{t('signals.high')}</div>
              <div className="mono up" style={{ fontSize: 13 }}>${fmtPrice(projection.high)}</div>
            </div>
          </div>

          <div style={{ position: 'relative', height: 8, borderRadius: 999, background: 'linear-gradient(90deg,var(--down),var(--rgb-5),var(--up))', opacity: 0.75 }}>
            <motion.div
              initial={{ left: '50%' }}
              animate={{ left: '50%' }}
              style={{
                position: 'absolute',
                top: -4,
                width: 3,
                height: 16,
                background: '#fff',
                borderRadius: 2,
                boxShadow: '0 0 8px rgba(255,255,255,.8)'
              }}
            />
          </div>

          <p className="notice" style={{ marginTop: 12 }}>
            {t('signals.coneExplain', { p: projection.probability, d: projection.days })}
          </p>
        </motion.section>
      )}

      <AdBanner slot="swap" />

      {/* ---------- market scan ---------- */}
      {ranked.length > 0 && (
        <section>
          <p className="section-label">{t('signals.topSignals')}</p>
          <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {ranked.map(({ coin: c, a }) => (
              <motion.div
                key={c.id}
                className="coin-row"
                variants={riseIn}
                onClick={() => {
                  haptic?.('select');
                  setCoinId(c.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <div className="coin-logo">{c.image ? <img src={c.image} alt="" /> : c.symbol.slice(0, 3)}</div>
                <div className="coin-meta">
                  <div className="coin-sym">{c.symbol}</div>
                  <div className="coin-name">{t(`signals.label.${a.label}`)} · {a.confidence}%</div>
                </div>
                <Sparkline data={c.sparkline?.slice(-40) ?? []} up={a.score >= 0} width={52} height={24} />
                <div className="coin-right">
                  <div className={`mono ${a.score >= 0 ? 'up' : 'down'}`} style={{ fontSize: 13, fontWeight: 700 }}>
                    {a.score > 0 ? '+' : ''}{a.score}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      <p className="notice notice-danger">{t('signals.disclaimer')}</p>

      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-primary" onClick={() => navigate(`/swap?coin=${coinId}`)}>
          {t('nav.swap')}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate(`/coin/${coinId}`)}>
          {t('signals.viewChart')}
        </button>
      </div>
    </PageTransition>
  );
}
