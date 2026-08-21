import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import CoinLogo from '../components/CoinLogo';
import AdBanner from '../components/AdBanner';
import AnimatedNumber from '../components/AnimatedNumber';
import Sparkline from '../components/Sparkline';
import { useChart, useCoin, useGlobalStats, useMarkets } from '../hooks/useMarket';
import { analyze, marketSentiment, projectRange } from '../lib/ai';
import { fmtPct, fmtPrice, fmtCompact } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { aiStatus, getMarketBrief, getOutlook } from '../lib/aiClient';
import SegIndicator from '../components/SegIndicator';
import VerdictPanel from '../components/VerdictPanel';
import { verdict } from '../lib/verdict';
import { marketRegime } from '../lib/macro';
import { scenarioSplit, findLevels } from '../lib/history';
import { SOLANA_SIGNAL_ASSETS, getSolanaIntel } from '../lib/solanaSignals';
import { getPerpMarkets } from '../lib/perp';
import { useLearningTelemetry } from '../hooks/telemetry';
import useLearningParams from '../hooks/useLearningParams';
import { useSettingsStore } from '../store/useSettingsStore';
import '../styles/docs-modern.css';
import '../styles/wallet-modern.css';

const HORIZONS = [
  { days: 1, key: '1D' },
  { days: 7, key: '7D' },
  { days: 30, key: '30D' }
];

/* The four verdict regimes, mapped to one-line labels a layperson reads. */
const REGIME_LABEL = { riskOn: 'riskOn', btcLed: 'btcLed', rotationOut: 'rotationOut', riskOff: 'riskOff' };

function Gauge({ score, label, confidence }) {
  const { t } = useTranslation();
  const pct = (score + 100) / 200;
  const angle = -90 + pct * 180;
  const color = score > 40 ? 'var(--up)' : score > 12 ? '#7ee787' : score < -40 ? 'var(--down)' : score < -12 ? '#ff8fa3' : 'var(--rgb-5)';
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 270, margin: '0 auto' }}>
      <svg viewBox="0 0 200 120" style={{ width: '100%', overflow: 'visible' }}>
        <defs>
          <linearGradient id="gaugeGrad2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff3b6b" />
            <stop offset="50%" stopColor="#ffb300" />
            <stop offset="100%" stopColor="#00ff9d" />
          </linearGradient>
        </defs>
        <path d="M12 100 A88 88 0 0 1 188 100" fill="none" stroke="rgba(127,127,127,.13)" strokeWidth="16" strokeLinecap="round" />
        <motion.path d="M12 100 A88 88 0 0 1 188 100" fill="none" stroke="url(#gaugeGrad2)" strokeWidth="16" strokeLinecap="round" strokeDasharray="276" initial={{ strokeDashoffset: 276 }} animate={{ strokeDashoffset: 276 - 276 * pct }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} style={{ filter: 'drop-shadow(0 0 10px rgba(0,255,157,0.22))' }} />
        <motion.g initial={{ rotate: -90 }} animate={{ rotate: angle }} transition={{ type: 'spring', stiffness: 58, damping: 14 }} style={{ transformOrigin: '100px 100px' }}>
          <line x1="100" y1="100" x2="100" y2="28" stroke={color} strokeWidth="3.6" strokeLinecap="round" />
          <circle cx="100" cy="100" r="9" fill={color} style={{ filter: 'drop-shadow(0 0 8px currentColor)' }} />
          <circle cx="100" cy="100" r="3.5" fill="#fff" />
        </motion.g>
      </svg>
      <div style={{ textAlign: 'center', marginTop: -10 }}>
        <div style={{ color, fontSize: 34, fontWeight: 900, letterSpacing: -0.5 }}><AnimatedNumber value={score} format={(v) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)))} /></div>
        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 2 }}>{t(`signals.label.${label}`)}</div>
        <div className="faint" style={{ marginTop: 4, fontSize: 12 }}>{t('signals.confidence')}: <span style={{ color: 'var(--text-1)', fontWeight: 800 }}>{confidence}%</span></div>
      </div>
    </div>
  );
}

/*
 * The same bipolar bar IndicatorBar draws, generalised to take a ready-made
 * label so it can render a VERDICT LAYER (technical / structural / macro /
 * derivatives) as well as an analysis indicator.
 */
function LayerBar({ label, score, weight }) {
  const pct = Math.min(100, Math.abs(score));
  const positive = score >= 0;
  const dim = weight < 0.4; /* a low-weight layer still shows, just quieter */
  return (
    <motion.div variants={riseIn} style={{ marginBottom: 13, opacity: dim ? 0.78 : 1 }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</span>
        <span className={`mono ${positive ? 'up' : 'down'}`} style={{ fontSize: 12, fontWeight: 800 }}>{positive ? '+' : ''}{Math.round(score)}</span>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(127,127,127,.10)', padding: 1.5 }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          {!positive && <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7 }} style={{ background: 'var(--down)', borderRadius: 999, boxShadow: '0 0 10px rgba(255,59,107,0.32)' }} />}
        </div>
        <div style={{ width: 2, background: 'rgba(255,255,255,.18)', borderRadius: 2, margin: '0 1px' }} />
        <div style={{ flex: 1 }}>
          {positive && <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7 }} style={{ background: 'var(--up)', borderRadius: 999, height: '100%', boxShadow: '0 0 10px rgba(0,255,157,0.32)' }} />}
        </div>
      </div>
    </motion.div>
  );
}

function IndicatorBar({ signal }) {
  const { t } = useTranslation();
  const pct = Math.abs(signal.score);
  const positive = signal.score >= 0;
  return (
    <motion.div variants={riseIn} style={{ marginBottom: 13 }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t(`signals.ind.${signal.key}`)}</span>
        <span className={`mono ${positive ? 'up' : 'down'}`} style={{ fontSize: 12, fontWeight: 800 }}>{positive ? '+' : ''}{signal.score}</span>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(127,127,127,.10)', padding: 1.5 }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          {!positive && <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7 }} style={{ background: 'var(--down)', borderRadius: 999, boxShadow: '0 0 10px rgba(255,59,107,0.32)' }} />}
        </div>
        <div style={{ width: 2, background: 'rgba(255,255,255,.18)', borderRadius: 2, margin: '0 1px' }} />
        <div style={{ flex: 1 }}>
          {positive && <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7 }} style={{ background: 'var(--up)', borderRadius: 999, height: '100%', boxShadow: '0 0 10px rgba(0,255,157,0.32)' }} />}
        </div>
      </div>
    </motion.div>
  );
}

function ProjectionCard({ projection, hue, title, sub }) {
  const { t } = useTranslation();
  if (!projection) return null;
  return (
    <div className="docs-card" style={{ '--card-hue': hue, padding: 16 }} data-open="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span className="docs-icon" style={{ width: 38, height: 38, borderRadius: 11 }}><span style={{ fontWeight: 900, fontSize: 13 }}>{projection.days}</span></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>{title}</div>
          <div className="faint" style={{ fontSize: 11.5 }}>{sub}</div>
        </div>
        <span className="pill" style={{ background: `color-mix(in srgb, ${hue} 12%, transparent)`, borderColor: `color-mix(in srgb, ${hue} 22%, transparent)`, color: hue, fontWeight: 800 }}>{projection.days}D</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end', marginBottom: 12 }}>
        <div><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.low')}</div><div className="mono down" style={{ fontSize: 13.5, fontWeight: 800, marginTop: 4 }}>${fmtPrice(projection.low)}</div></div>
        <div style={{ textAlign: 'center' }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.mid')}</div><div className="mono" style={{ fontSize: 17, fontWeight: 900, marginTop: 4 }}>${fmtPrice(projection.mid)}</div></div>
        <div style={{ textAlign: 'end' }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.high')}</div><div className="mono up" style={{ fontSize: 13.5, fontWeight: 800, marginTop: 4 }}>${fmtPrice(projection.high)}</div></div>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 999, background: 'linear-gradient(90deg,var(--down),var(--rgb-5),var(--up))', opacity: 0.9, padding: 2 }}>
        <div style={{ position: 'absolute', inset: 2, borderRadius: 999, background: 'rgba(0,0,0,0.14)' }} />
        <div style={{ position: 'absolute', top: -3, left: '50%', width: 4, height: 16, background: '#fff', borderRadius: 2, boxShadow: '0 0 10px rgba(255,255,255,.9)', transform: 'translateX(-50%)' }} />
      </div>
      <p className="notice" style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.8 }}>{t('signals.coneExplain', { p: projection.probability, d: projection.days })}</p>
    </div>
  );
}

export default function Signals() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const { data: coins } = useMarkets(40);
  const { data: global } = useGlobalStats();

  /* ─── ASSET PICKER: an [All | Solana ◎] tab, not a new page ───────────────
   * The All tab is the existing first-14-coins scroll. The Solana tab is the
   * curated set (src/lib/solanaSignals.js): SOL plus six SPL tokens, each with
   * a verified mint, run through the SAME technical pipeline (useChart +
   * analyze). No new route, no new page. */
  const [tab, setTab] = useState('all');
  const [coinId, setCoinId] = useState('bitcoin');
  const [solanaId, setSolanaId] = useState('solana');
  const activeId = tab === 'solana' ? solanaId : coinId;

  const [horizon, setHorizon] = useState(HORIZONS[1]);
  const [scanning, setScanning] = useState(true);
  const [ai, setAi] = useState({ enabled: false });
  const [outlook, setOutlook] = useState(null);
  const [brief, setBrief] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const { data: chart } = useChart(activeId, 30);
  const { data: btcChart } = useChart('bitcoin', 30);
  /* useCoin(null) on the All tab avoids a redundant per-coin fetch — the All
     tab already has the coin from the markets list. */
  const { data: solanaCoin } = useCoin(tab === 'solana' ? activeId : null);

  const coin = useMemo(() => {
    if (tab === 'solana') return solanaCoin;
    return (coins ?? []).find((c) => c.id === coinId);
  }, [tab, solanaCoin, coins, coinId]);

  const priceSeries = useMemo(() => (chart?.length ? chart.map((p) => p.p) : (coin?.sparkline ?? [])), [chart, coin]);
  const btcSeries = useMemo(() => (btcChart ?? []).map((p) => p.p), [btcChart]);
  const analysis = useMemo(() => (priceSeries.length ? analyze(priceSeries, coin ?? {}) : null), [priceSeries, coin]);
  const projection = useMemo(() => (analysis ? projectRange(analysis, horizon.days) : null), [analysis, horizon]);
  const sentiment = useMemo(() => marketSentiment(global), [global]);

  /* MARKET REGIME — one small chip beside the signal title, only when the
     wider market actually tells us something (dominance present). */
  const regime = useMemo(() => (global ? marketRegime({ global, btcSeries }) : null), [global, btcSeries]);

  /* DERIVATIVES — fetched LAZILY after the first paint so it never blocks
     the gauge. The verdict's derivatives layer carries weight 0 until this
     resolves, so the initial read is identical to the four-layer engine. */
  const [perpMarkets, setPerpMarkets] = useState(null);
  useEffect(() => {
    let alive = true;
    getPerpMarkets().then((d) => alive && setPerpMarkets(Array.isArray(d?.assets) ? d.assets : [])).catch(() => {});
    return () => { alive = false; };
  }, []);

  const verdictData = useMemo(
    () => (analysis ? verdict({ analysis, series: priceSeries, btcSeries, coin, global, perpMarkets }) : null),
    [analysis, priceSeries, btcSeries, coin, global, perpMarkets]
  );
  const perpForCoin = useMemo(() => {
    if (!perpMarkets || !coin?.symbol) return null;
    return perpMarkets.find((m) => m?.symbol === String(coin.symbol).toUpperCase()) || null;
  }, [perpMarkets, coin]);

  /* The detail card reads the horizon the user picked (7D → short, 30D → long). */
  const horizonKey = horizon.days >= 30 ? 'long' : 'short';
  const read = verdictData?.[horizonKey];

  /* PROBABILITY SCENENARIOS — how often the same window ended up, flat or
     down on this coin's own history, with the neutral band sized to the
     projection cone so a calm coin is not flagged for ordinary noise. */
  const bandPct = useMemo(() => {
    if (!projection || !projection.mid) return 2;
    const half = (projection.high - projection.low) / 2;
    return Math.max(0.5, Math.min(10, (half / projection.mid) * 100));
  }, [projection]);
  const scenarios = useMemo(
    () => (priceSeries.length ? scenarioSplit(priceSeries, horizon.days, bandPct) : null),
    [priceSeries, horizon.days, bandPct]
  );

  /* INVALIDATION — the nearest support BELOW the current price, from the same
     level finder the backtest uses. Real, never guessed; hidden when none. */
  const invalidation = useMemo(() => {
    if (!priceSeries.length) return null;
    const price = priceSeries[priceSeries.length - 1];
    const support = findLevels(priceSeries)
      .filter((l) => l.kind === 'support' && l.price < price)
      .sort((a, b) => b.price - a.price)[0];
    if (!support) return null;
    return { price: support.price, pctBelow: ((price - support.price) / price) * 100 };
  }, [priceSeries]);

  /* BACKTEST HISTORY — how this same setup has actually paid. Hidden when the
     sample is too thin to mean anything (< 8 fires), exactly as the verdict's
     historical layer refuses to weight a handful of occurrences. */
  const backtestInfo = useMemo(() => {
    const bt = analysis?.backtest;
    if (!bt || !bt.samples || bt.samples < 8) return null;
    const side = String(analysis.label ?? '').includes('ell') ? bt.sell : bt.buy;
    if (!side || side.total < 8 || side.edge === null || side.edge === undefined) return null;
    return { rate: side.rate, edge: side.edge, samples: side.total, base: bt.baseRate };
  }, [analysis]);

  /* ON-CHAIN INTEL — Solana tab only, fetched lazily per mint. Fail-closed:
     configured:false OR all-null → the whole row stays hidden (no empty box). */
  const activeMint = useMemo(
    () => (tab === 'solana' ? (SOLANA_SIGNAL_ASSETS.find((a) => a.id === activeId)?.mint ?? null) : null),
    [tab, activeId]
  );
  const [solanaIntel, setSolanaIntel] = useState(null);
  const intelReqId = useRef(0);
  useEffect(() => {
    if (!activeMint) { setSolanaIntel(null); return undefined; }
    const req = ++intelReqId.current;
    setSolanaIntel(null);
    getSolanaIntel(activeMint)
      .then((d) => { if (req === intelReqId.current) setSolanaIntel(d); })
      .catch(() => { if (req === intelReqId.current) setSolanaIntel(null); });
    return () => { intelReqId.current += 1; };
  }, [activeMint]);

  /*
   * LEARNING TELEMETRY — wired up from Signals.jsx ONLY, and gated twice:
   * `optedIn` here (so the hook's inputs are null and it does zero work when
   * the Settings privacy toggle is off) and again inside the hook itself.
   * The verdict passed in is the SAME structure VerdictPanel renders
   * (v.short.stance / v.short.confidence / v.macro regime); the hook fires
   * once the panel has been visible ≥5s with a stable prediction.
   */
  const optedIn = useSettingsStore((s) => s.contributeTelemetry);
  const learn = useLearningParams();
  const verdictForTelemetry = useMemo(
    () => (optedIn && analysis && !scanning
      ? verdict({ analysis, series: priceSeries, btcSeries, coin, global, perpMarkets })
      : null),
    [optedIn, analysis, scanning, priceSeries, btcSeries, coin, global, perpMarkets]
  );
  useLearningTelemetry({
    coin: optedIn ? coin : null,
    v: verdictForTelemetry,
    learn,
    visible: Boolean(optedIn && analysis && !scanning)
  });
  useEffect(() => { aiStatus().then(setAi); }, []);
  useEffect(() => {
    if (!global || !coins?.length) return;
    getMarketBrief({ global, top: coins.slice(0, 8), lang: i18n.language }).then(setBrief).catch(() => {});
  }, [global, coins, i18n.language]);
  useEffect(() => {
    if (!analysis || !coin) return undefined;
    let alive = true;
    setAiLoading(true); setAiError(null); setOutlook(null);
    getOutlook({ id: coin.id, symbol: coin.symbol, name: coin.name, price: coin.price, indicators: analysis.indicators, change24h: coin.change24h, change7d: coin.change7d, lang: i18n.language, analysis, coin, days: horizon.days })
      .then((r) => alive && (r ? setOutlook(r) : setAiError('AI_FAILED'))).catch((e) => alive && setAiError(e.code || 'AI_FAILED')).finally(() => alive && setAiLoading(false));
    return () => { alive = false; };
  }, [coin?.id, analysis?.score, i18n.language, horizon.days]);
  useEffect(() => { setScanning(true); const id = setTimeout(() => setScanning(false), 850); return () => clearTimeout(id); }, [activeId]);
  const ranked = useMemo(() => {
    if (!coins?.length) return [];
    return coins.map((c) => { const a = c.sparkline?.length >= 30 ? analyze(c.sparkline, c) : null; return a ? { coin: c, a, strength: Math.abs(a.score) * (a.confidence / 100) } : null; }).filter(Boolean).sort((x, y) => y.strength - x.strength).slice(0, 8);
  }, [coins]);

  /* Only render the on-chain row when the Solscan key is configured AND at
     least one metric returned real data — fail-closed, never an empty box. */
  const intel = solanaIntel && solanaIntel.configured ? solanaIntel : null;
  const hasOnchain = Boolean(
    intel && (
      intel.whaleFlow?.direction
      || intel.holderTrend?.change
      || intel.topHolderPct != null
      || intel.dexActivity?.pressure
    )
  );

  /* Layer bars: every verdict layer carrying real weight, in read order. */
  const layerRows = useMemo(() => {
    if (!read?.layers) return [];
    const order = ['technical', 'historical', 'structural', 'macro', 'derivatives'];
    return order
      .map((k) => ({ key: k, ...read.layers[k] }))
      .filter((l) => l && l.weight > 0);
  }, [read]);

  return (
    <PageTransition>
      {/* Hero ultra modern */}
      <motion.section className="docs-hero" variants={riseIn} initial="hidden" animate="show" style={{ overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: -40, background: 'radial-gradient(600px 300px at 20% 0%, rgba(0,229,255,0.12), transparent 60%), radial-gradient(500px 280px at 90% 0%, rgba(124,77,255,0.12), transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div className="docs-hero-title" style={{ fontSize: 24 }}>{t('signals.title')}</div>
          <p className="docs-hero-sub" style={{ maxWidth: 'none', fontSize: 13, lineHeight: 1.9, whiteSpace: 'normal' }}>{t('signals.subtitle')}</p>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span className="pill pill-rgb" style={{ fontSize: 11, padding: '5px 10px' }}>✦ AI Powered</span>
            <span className="pill" style={{ background: 'rgba(0,255,157,0.08)', borderColor: 'rgba(0,255,157,0.16)', color: 'var(--up)', fontSize: 11 }}>Live</span>
          </div>
        </div>
      </motion.section>

      {sentiment && (
        <motion.section className="wallet-hero-modern" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16, padding: 18 }}>
          <div className="wallet-hero-aurora" aria-hidden="true" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, position: 'relative' }}>
            <div>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7 }}>{t('signals.marketMood')}</div>
              <div style={{ fontWeight: 900, fontSize: 18, marginTop: 4 }}>{t(`signals.mood.${sentiment.label}`)}</div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{t('signals.marketAtGlance')}</div>
            </div>
            <div style={{ width: 68, height: 68, borderRadius: '50%', display: 'grid', placeItems: 'center', background: `conic-gradient(${sentiment.score > 55 ? 'var(--up)' : sentiment.score < 45 ? 'var(--down)' : 'var(--rgb-5)'} ${sentiment.score}%, rgba(127,127,127,.13) 0)`, padding: 3 }}>
              <span style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--bg-panel-solid)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 18, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' }}>{sentiment.score}</span>
            </div>
          </div>
        </motion.section>
      )}

      {brief && (
        <motion.section className="docs-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14, '--card-hue': 'var(--rgb-4)', borderColor: 'rgba(0,255,157,0.14)', background: 'linear-gradient(145deg, rgba(0,255,157,0.07), rgba(255,255,255,0.02))' }}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.7, color: 'var(--rgb-4)' }}>✦ {t('signals.dailyBrief')}</span>
            <span className={`pill ${brief.bias === 'bullish' ? 'pill-up' : brief.bias === 'bearish' ? 'pill-down' : 'pill-rgb'}`} style={{ fontSize: 11 }}>{t(`signals.bias.${brief.bias}`)}</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.5 }}>{brief.headline}</div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85, marginTop: 6 }}>{brief.summary}</p>
        </motion.section>
      )}

      <motion.div className="wallet-pie-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16, padding: 14 }}>
        <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7, marginBottom: 10 }}>{t('signals.chooseAsset')}</div>
        {/* The two-tab picker: All (markets) or Solana ◎ (curated SPL set). */}
        <div className="segmented" style={{ width: '100%', marginBottom: 12 }}>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => { haptic?.('select'); setTab('all'); }} style={{ isolation: 'isolate', flex: 1, minHeight: 36 }}>
            {tab === 'all' && <SegIndicator id="tab-all" />}
            {t('signals.allTab')}
          </button>
          <button className={tab === 'solana' ? 'active' : ''} onClick={() => { haptic?.('select'); setTab('solana'); }} style={{ isolation: 'isolate', flex: 1, minHeight: 36 }}>
            {tab === 'solana' && <SegIndicator id="tab-sol" />}
            {t('signals.solanaTab')}
          </button>
        </div>
        <div className="tag-scroll" style={{ gap: 8 }}>
          {tab === 'all'
            ? (coins ?? []).slice(0, 14).map((c) => (
              <button key={c.id} className={`tag ${coinId === c.id ? 'active' : ''}`} onClick={() => { haptic?.('select'); setCoinId(c.id); }} style={{ minHeight: 34, padding: '7px 13px', fontSize: 12.5, borderRadius: 12 }}>{c.symbol}</button>
            ))
            : SOLANA_SIGNAL_ASSETS.map((a) => (
              <button key={a.id} className={`tag ${solanaId === a.id ? 'active' : ''}`} onClick={() => { haptic?.('select'); setSolanaId(a.id); }} style={{ minHeight: 34, padding: '7px 13px', fontSize: 12.5, borderRadius: 12 }}>{a.symbol}</button>
            ))}
        </div>
      </motion.div>

      <motion.section className="wallet-hero-modern" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14, padding: 18 }}>
        <div className="wallet-hero-aurora" aria-hidden="true" />
        <AnimatePresence mode="wait">
          {scanning || !analysis ? (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ height: 240, display: 'grid', placeItems: 'center', gap: 14 }}>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }} style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid rgba(127,127,127,.14)', borderTopColor: 'var(--rgb-1)', boxShadow: '0 0 18px rgba(0,229,255,0.18)' }} />
              <span className="faint" style={{ fontSize: 12.5 }}>{t('signals.analyzing')}</span>
            </motion.div>
          ) : (
            <motion.div key="gauge" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} style={{ width: '100%' }}>
              <div className="row-between" style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 10 }}>
                  <CoinLogo coin={coin} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {coin?.symbol}
                      {/* Market regime chip — only when the wider market reads. */}
                      {regime?.regime && (
                        <span className="pill" title={t(`signals.regime.${REGIME_LABEL[regime.regime]}`)} style={{ fontSize: 10, padding: '3px 8px', background: regime.regime === 'riskOff' || regime.regime === 'rotationOut' ? 'rgba(255,89,107,0.10)' : 'rgba(0,255,157,0.10)', borderColor: regime.regime === 'riskOff' || regime.regime === 'rotationOut' ? 'rgba(255,89,107,0.22)' : 'rgba(0,255,157,0.22)', color: regime.regime === 'riskOff' || regime.regime === 'rotationOut' ? 'var(--down)' : 'var(--up)' }}>
                          {t(`signals.regime.${REGIME_LABEL[regime.regime]}`)}
                        </span>
                      )}
                    </div>
                    <div className="faint mono" style={{ fontSize: 11.5 }}>${fmtPrice(coin?.price)}</div>
                  </div>
                </div>
                <span className={`pill ${(coin?.change24h ?? 0) >= 0 ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 11.5, padding: '5px 10px' }}>{fmtPct(coin?.change24h ?? 0)}</span>
              </div>
              <Gauge score={analysis.score} label={analysis.label} confidence={analysis.confidence} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {analysis && !scanning && (
        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
          <VerdictPanel analysis={analysis} series={priceSeries} btcSeries={btcSeries} coin={coin} global={global} />
        </motion.div>
      )}

      {/*
        THE SIGNAL CARD — completed, not a new page. Layer score bars, the
        three probability scenarios, the invalidation level and the backtest
        history of this same setup, each rendered ONLY when it has real data.
        The derivatives row appears for the majors the perp feed covers; the
        on-chain row appears in the Solana tab only when Solscan returned data.
      */}
      {analysis && !scanning && (
        <motion.section className="wallet-pie-card" variants={stagger} initial="hidden" animate="show" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-3), var(--rgb-2))', color: '#fff', fontSize: 12 }}>◈</span>
            {t('signals.breakdown')}
          </div>

          {/* Layer score bars — the "why", each layer's real contribution. */}
          {layerRows.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, marginBottom: 10 }}>{t('signals.layerTitle')}</div>
              {layerRows.map((l) => (
                <LayerBar key={l.key} label={t(`verdict.layerName.${l.key}`)} score={l.score} weight={l.weight} />
              ))}
            </div>
          )}

          {/* Derivatives row — funding + open interest, majors only. */}
          {perpForCoin && perpForCoin.avgFundingApr != null && (
            <div className="card card-soft" style={{ padding: 12, borderRadius: 12, marginBottom: 12 }}>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, marginBottom: 8 }}>{t('signals.derivatives.title')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div className="faint" style={{ fontSize: 10 }}>{t('signals.derivatives.funding')}</div>
                  <div className={`mono ${perpForCoin.avgFundingApr >= 0 ? 'up' : 'down'}`} style={{ fontSize: 14, fontWeight: 800, marginTop: 3 }}>
                    {perpForCoin.avgFundingApr > 0 ? '+' : ''}{Math.round(perpForCoin.avgFundingApr)}%
                  </div>
                </div>
                {perpForCoin.openInterestUsd != null && (
                  <div style={{ textAlign: 'end' }}>
                    <div className="faint" style={{ fontSize: 10 }}>{t('signals.derivatives.openInterest')}</div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 800, marginTop: 3 }}>${fmtCompact(perpForCoin.openInterestUsd)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Probability scenarios — up / flat / down over this horizon. */}
          {scenarios && scenarios.samples >= 20 && (
            <div style={{ marginBottom: 12 }}>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, marginBottom: 8 }}>{t('signals.scenarios.title')}</div>
              <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(127,127,127,.10)' }}>
                <motion.div initial={{ width: 0 }} animate={{ width: `${scenarios.pctUp}%` }} transition={{ duration: 0.7 }} style={{ background: 'var(--up)' }} />
                <motion.div initial={{ width: 0 }} animate={{ width: `${scenarios.pctNeutral}%` }} transition={{ duration: 0.7 }} style={{ background: 'rgba(127,127,127,.32)' }} />
                <motion.div initial={{ width: 0 }} animate={{ width: `${scenarios.pctDown}%` }} transition={{ duration: 0.7 }} style={{ background: 'var(--down)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
                <span className="up" style={{ fontWeight: 700 }}>▲ {scenarios.pctUp}% {t('signals.scenarios.bullish')}</span>
                <span className="faint" style={{ fontWeight: 700 }}>{scenarios.pctNeutral}% {t('signals.scenarios.neutral')}</span>
                <span className="down" style={{ fontWeight: 700 }}>▼ {scenarios.pctDown}% {t('signals.scenarios.bearish')}</span>
              </div>
              <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>{t('signals.scenarios.hint', { n: scenarios.samples, d: horizon.days })}</div>
            </div>
          )}

          {/* Invalidation level — the nearest support below price. */}
          {invalidation && (
            <div className="card card-soft" style={{ padding: 12, borderRadius: 12, marginBottom: 12 }}>
              <div className="row-between">
                <div>
                  <div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.invalidation')}</div>
                  <div className="mono down" style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>${fmtPrice(invalidation.price)}</div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.invalidationBelow')}</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>-{fmtPct(invalidation.pctBelow)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Backtest history — hide when the sample is too thin. */}
          {backtestInfo && (
            <div className="card card-soft" style={{ padding: 12, borderRadius: 12, marginBottom: 12 }}>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, marginBottom: 8 }}>{t('signals.backtestHistory')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div style={{ textAlign: 'center' }}>
                  <div className="mono up" style={{ fontSize: 16, fontWeight: 900 }}>{Math.round(backtestInfo.rate)}%</div>
                  <div className="faint" style={{ fontSize: 10, marginTop: 3 }}>{t('signals.backtestHitRate')}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className={`mono ${backtestInfo.edge >= 0 ? 'up' : 'down'}`} style={{ fontSize: 16, fontWeight: 900 }}>{backtestInfo.edge >= 0 ? '+' : ''}{Math.round(backtestInfo.edge)}pp</div>
                  <div className="faint" style={{ fontSize: 10, marginTop: 3 }}>{t('signals.backtestEdge')}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 900 }}>{backtestInfo.samples}</div>
                  <div className="faint" style={{ fontSize: 10, marginTop: 3 }}>{t('signals.backtestSamples')}</div>
                </div>
              </div>
              <div className="faint" style={{ fontSize: 10.5, marginTop: 8 }}>{t('signals.backtestHint', { base: Math.round(backtestInfo.base) })}</div>
            </div>
          )}

          {/* On-chain row — Solana tab only, fail-closed when no real data. */}
          {hasOnchain && (
            <div className="card card-soft" style={{ padding: 12, borderRadius: 12, marginBottom: 12, borderColor: 'rgba(152,120,255,0.18)' }}>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, marginBottom: 10 }}>{t('signals.onchain.title')}</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {intel.whaleFlow?.direction && (
                  <div className="row-between">
                    <span className="faint" style={{ fontSize: 11.5 }}>{t('signals.onchain.whaleFlow')}</span>
                    <span className={`mono ${intel.whaleFlow.direction === 'outflow' ? 'down' : intel.whaleFlow.direction === 'inflow' ? 'up' : ''}`} style={{ fontSize: 12, fontWeight: 800 }}>
                      {t(`signals.onchain.flow.${intel.whaleFlow.direction}`)}
                    </span>
                  </div>
                )}
                {intel.holderTrend?.change && (
                  <div className="row-between">
                    <span className="faint" style={{ fontSize: 11.5 }}>{t('signals.onchain.holderTrend')}</span>
                    <span className={`mono ${intel.holderTrend.change === 'rising' ? 'down' : 'up'}`} style={{ fontSize: 12, fontWeight: 800 }}>
                      {t(`signals.onchain.trend.${intel.holderTrend.change}`)}
                    </span>
                  </div>
                )}
                {intel.topHolderPct != null && (
                  <div className="row-between">
                    <span className="faint" style={{ fontSize: 11.5 }}>{t('signals.onchain.topHolder')}</span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 800 }}>{intel.topHolderPct}%</span>
                  </div>
                )}
                {intel.dexActivity?.pressure && (
                  <div className="row-between">
                    <span className="faint" style={{ fontSize: 11.5 }}>{t('signals.onchain.dexActivity')}</span>
                    <span className={`mono ${intel.dexActivity.pressure === 'buy' ? 'up' : intel.dexActivity.pressure === 'sell' ? 'down' : ''}`} style={{ fontSize: 12, fontWeight: 800 }}>
                      {t(`signals.onchain.pressure.${intel.dexActivity.pressure}`)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {analysis.signals.map((s) => <IndicatorBar key={s.key} signal={s} />)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
            {analysis.indicators.rsi != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>RSI (14)</div><div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{analysis.indicators.rsi.toFixed(1)}</div></div>}
            {analysis.indicators.volatility != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.volatility')}</div><div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{analysis.indicators.volatility.toFixed(0)}%</div></div>}
            {analysis.indicators.support != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.support')}</div><div className="mono up" style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>${fmtPrice(analysis.indicators.support)}</div></div>}
            {analysis.indicators.resistance != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.resistance')}</div><div className="mono down" style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>${fmtPrice(analysis.indicators.resistance)}</div></div>}
          </div>

          {/* Create Intent — pre-fills Intent OS, never auto-executes. */}
          <button className="btn btn-primary" style={{ width: '100%', minHeight: 46, borderRadius: 14, marginTop: 16 }} onClick={() => { haptic?.('select'); navigate(`/intent?to=${encodeURIComponent(coin?.symbol || '')}`); }}>
            {t('signals.createIntent')}
          </button>
        </motion.section>
      )}

      {(
        <motion.section className="docs-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14, '--card-hue': 'var(--rgb-2)' }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div className="row" style={{ gap: 9 }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-2), var(--rgb-1))', color: '#fff', fontSize: 13 }}>✦</span>
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{outlook?.source === 'local' ? t('signals.outlookLocal') : t('signals.aiOutlook')}</span>
            </div>
            {outlook && <span className={`pill ${outlook.bias === 'bullish' ? 'pill-up' : outlook.bias === 'bearish' ? 'pill-down' : 'pill-rgb'}`} style={{ fontSize: 11 }}>{t(`signals.bias.${outlook.bias}`)} · {outlook.confidence}%</span>}
          </div>
          <div className="segmented" style={{ width: '100%', marginBottom: 12 }}>
            {HORIZONS.filter(h => h.days !== 1).map((h) => (
              <button key={h.key} className={horizon.key === h.key ? 'active' : ''} onClick={() => setHorizon(h)} style={{ isolation: 'isolate', flex: 1, minHeight: 36 }}>
                {horizon.key === h.key && <SegIndicator id="hz-outlook" />}
                {t(h.key === '7D' ? 'signals.horizon.weekly' : 'signals.horizon.monthly')}
              </button>
            ))}
          </div>
          {aiLoading && (
            <div className="stack" style={{ gap: 10 }}>
              {[92, 78, 60].map((w) => (
                <motion.div key={w} className="skel" style={{ height: 11, width: `${w}%`, borderRadius: 8 }} animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} />
              ))}
              <span className="faint" style={{ marginTop: 4, fontSize: 12 }}>{t('signals.aiThinking')}</span>
            </div>
          )}
          {aiError && <p className="notice" style={{ marginTop: 10 }}>{t('signals.aiUnavailable')}</p>}
          {outlook && !aiLoading && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.6, marginBottom: 8 }}>{outlook.headline}</div>
              <p className="muted" style={{ fontSize: 12.7, lineHeight: 1.85, margin: 0 }}>{outlook.summary}</p>
              {outlook.range?.low != null && (
                <InfoBox title={t('signals.projectionTitle')} tone="info" id="sig-proj-box">
                  <div className="card card-soft row-between" style={{ marginTop: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>
                    <span className="faint" style={{ fontSize: 11 }}>{t('signals.aiRange', { d: outlook.range.horizonDays })}</span>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 700 }}>${fmtPrice(outlook.range.low)} – ${fmtPrice(outlook.range.high)}</span>
                  </div>
                </InfoBox>
              )}
              {outlook.drivers?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="field-label" style={{ fontSize: 11 }}>{t('signals.drivers')}</div>
                  {outlook.drivers.map((d, i) => (
                    <motion.div key={i} className="row" style={{ gap: 8, marginTop: 6, alignItems: 'flex-start' }} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                      <span className="up" style={{ fontSize: 11, marginTop: 2 }}>▲</span><span className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>{d}</span>
                    </motion.div>
                  ))}
                </div>
              )}
              {outlook.risks?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-label" style={{ fontSize: 11 }}>{t('signals.risks')}</div>
                  {outlook.risks.map((r, i) => (
                    <motion.div key={i} className="row" style={{ gap: 8, marginTop: 6, alignItems: 'flex-start' }} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                      <span className="down" style={{ fontSize: 11, marginTop: 2 }}>▼</span><span className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>{r}</span>
                    </motion.div>
                  ))}
                </div>
              )}
              {outlook.invalidation && <p className="notice" style={{ marginTop: 14, fontSize: 12, lineHeight: 1.8 }}><strong>{t('signals.invalidation')}:</strong> {outlook.invalidation}</p>}
              <div className="faint" style={{ marginTop: 12, fontSize: 10.5, lineHeight: 1.7 }}>{outlook.source === 'local' ? t('signals.aiMetaLocal') : t('signals.aiMeta', { model: outlook.model })}</div>
            </motion.div>
          )}
        </motion.section>
      )}

      <AdBanner slot="swap" />

      {ranked.length > 0 && (
        <section style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #ffb300, #ff5a3a)', color: '#fff', fontSize: 12 }}>★</span>
            {t('signals.topSignals')}
          </div>
          <motion.div className="stack" style={{ gap: 10 }} variants={stagger} initial="hidden" animate="show">
            {ranked.map(({ coin: c, a }) => (
              <motion.div key={c.id} className="wallet-token-row-modern" variants={riseIn} onClick={() => { haptic?.('select'); setTab('all'); setCoinId(c.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ cursor: 'pointer', padding: 14 }}>
                <CoinLogo coin={c} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>{c.symbol}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{t(`signals.label.${a.label}`)} · {a.confidence}%</div>
                </div>
                <Sparkline data={c.sparkline?.slice(-40) ?? []} up={a.score >= 0} width={56} height={28} />
                <div className={`mono ${a.score >= 0 ? 'up' : 'down'}`} style={{ fontSize: 16, fontWeight: 900, minWidth: 44, textAlign: 'end' }}>{a.score > 0 ? '+' : ''}{a.score}</div>
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      <InfoBox title={t('signals.disclaimerTitle')} tone="warn" id="signals-disclaimer" style={{ marginTop: 18 }}>
        <p style={{ fontSize: 12.5, lineHeight: 1.9 }}>{t('signals.disclaimer')}</p>
      </InfoBox>

      <div className="row" style={{ gap: 12, marginTop: 18 }}>
        <button className="btn btn-primary" style={{ flex: 1, minHeight: 46, borderRadius: 14 }} onClick={() => navigate(`/swap?coin=${activeId}`)}>{t('nav.swap')}</button>
        <button className="btn btn-ghost" style={{ flex: 1, minHeight: 46, borderRadius: 14 }} onClick={() => navigate(`/coin/${activeId}`)}>{t('signals.viewChart')}</button>
      </div>
    </PageTransition>
  );
}
