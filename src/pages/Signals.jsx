import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useStill } from '../components/AnimatedIcon';
import InfoBox from '../components/InfoBox';
import CoinLogo from '../components/CoinLogo';
import AdBanner from '../components/AdBanner';
import AnimatedNumber from '../components/AnimatedNumber';
import Sparkline from '../components/Sparkline';
import { useChart, useCoin, useGlobalStats, useMarkets, usePoll } from '../hooks/useMarket';
import { analyze, marketSentiment, projectRange } from '../lib/ai';
import { fmtPct, fmtPrice, fmtCompact, timeAgo } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { aiStatus, getMarketBrief, getOutlook } from '../lib/aiClient';
import SegIndicator from '../components/SegIndicator';
import VerdictPanel from '../components/VerdictPanel';
import { verdict } from '../lib/verdict';
import { marketRegime } from '../lib/macro';
import { useAppStore } from '../store/useAppStore';
import { POINT_VALUES } from '../lib/ranks';
import { scenarioSplit, findLevels } from '../lib/history';
import { SOLANA_SIGNAL_ASSETS, getSolanaIntel } from '../lib/solanaSignals';
import { getPerpMarkets } from '../lib/perp';
import { useLearningTelemetry } from '../hooks/telemetry';
import useLearningParams from '../hooks/useLearningParams';
import { useSettingsStore } from '../store/useSettingsStore';
import { fetchOverview } from '../lib/smartMoneyClient';
import { getSignalPulse, getSignalWhy, getSolanaRadar } from '../lib/signalApi';
import {
  CLASS_META, computeHorizonRisks, computeSignalCard, computeEarlySignals,
  computePulseLocal, portfolioImpact, rankSignals, filterSignals, searchSignals,
  classKey
} from '../lib/signalEngine';
import {
  readWatchlist, toggleWatch, createAlert, readAlerts, deleteAlert, saveAlerts,
  evaluateSignalAlerts, recordSignal, settleHistory, readHistory, performance,
  readConsent, setConsent
} from '../lib/signalStore';
import { showLocalNotification } from '../lib/notify';
import '../styles/docs-modern.css';
import '../styles/wallet-modern.css';
import '../styles/signals-intel.css';

const HORIZONS = [
  { days: 1, key: '1D' },
  { days: 7, key: '7D' },
  { days: 30, key: '30D' }
];

const SOLANA_IDS = new Set(SOLANA_SIGNAL_ASSETS.map((a) => a.id));

/** Which chain bucket a coin belongs to (drives the market filter). */
const marketOf = (c) => (SOLANA_IDS.has(c?.id) ? 'solana' : 'evm');

/* ────────────────────────────────────────────────────────────────────────────
 * COLLAPSIBLE SIGNAL SECTION (kept from the existing page — presentation only)
 * ──────────────────────────────────────────────────────────────────────────── */
function SignalSection({ id, title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const still = useStill();

  return (
    <div className="sig-acc">
      <button
        type="button"
        className="sig-acc-head"
        aria-expanded={open}
        aria-controls={`sig-acc-${id}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sig-acc-title">{title}</span>
        {summary != null ? <span className="sig-acc-summary">{summary}</span> : null}
        <svg
          className={`sig-acc-caret ${open ? 'is-open' : ''}`}
          width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`sig-acc-${id}`}
            role="region"
            key="body"
            initial={still ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={still ? { duration: 0 } : { duration: 0.24, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <motion.div className="sig-acc-body" variants={stagger} initial="hidden" animate="show">
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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

function LayerBar({ label, score, weight }) {
  const pct = Math.min(100, Math.abs(score));
  const positive = score >= 0;
  const dim = weight < 0.4;
  return (
    <motion.div variants={riseIn} className="sig-ind" style={{ opacity: dim ? 0.78 : 1 }}>
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
    <motion.div variants={riseIn} className="sig-ind">
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


/* ────────────────────────────────────────────────────────────────────────────
 * INTELLIGENCE CENTER UI BUILDING BLOCKS
 * ──────────────────────────────────────────────────────────────────────────── */

function MetricTile({ k, v, tone }) {
  return (
    <div className="sic-metric">
      <div className="k">{k}</div>
      <div className={`v ${tone || ''}`}>{v}</div>
    </div>
  );
}

function PulseCard({ pulse }) {
  const { t } = useTranslation();
  if (!pulse) return null;
  const s = pulse.sentiment ?? {};
  const tone = s.label === 'bullish' ? 'bullish' : s.label === 'bearish' ? 'bearish' : 'neutral';
  const liveTone = pulse.source === 'live' ? 'bullet up' : '';
  return (
    <motion.section className="sic-pulse" variants={riseIn} initial="hidden" animate="show">
      <div className="sic-pulse-head">
        <div>
          <div className="sic-pulse-title">✦ {t('signals.intel.title')}</div>
          <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>{t('signals.intel.subtitle')}</div>
        </div>
        <span className={`sic-badge ${tone}`}>
          {s.label === 'bullish' ? '🟢' : s.label === 'bearish' ? '🔴' : '🟡'} {t(`signals.intel.sentimentLabel.${s.label || 'neutral'}`)}
        </span>
      </div>
      <div className="sic-pulse-grid">
        <MetricTile k={t('signals.intel.sentiment')} v={`${s.score ?? '—'}/100`} />
        <MetricTile k={t('signals.intel.riskLevel')} v={t(`signals.intel.riskLabel.${(pulse.risk?.label || 'medium').toLowerCase()}`)} tone={pulse.risk?.label === 'HIGH' ? 'down' : pulse.risk?.label === 'LOW' ? 'up' : 'warn'} />
        <MetricTile k={t('signals.intel.aiConfidence')} v={`${pulse.aiConfidence ?? '—'}%`} tone={pulse.aiConfidence >= 70 ? 'up' : ''} />
        <MetricTile k={t('signals.intel.pulseMomentum')} v={`${t(`signals.intel.momentumLabel.${(pulse.momentum?.label || 'flat')}`)}${pulse.momentum?.direction === 'up' ? ' ▲' : pulse.momentum?.direction === 'down' ? ' ▼' : ''}`} tone={pulse.momentum?.direction === 'up' ? 'up' : pulse.momentum?.direction === 'down' ? 'down' : ''} />
        <MetricTile k={t('signals.intel.volatility')} v={t(`signals.intel.volLabel.${(pulse.volatility?.label || 'moderate')}`)} tone={pulse.volatility?.label === 'high' ? 'down' : pulse.volatility?.label === 'low' ? 'up' : 'warn'} />
        <MetricTile k={t('signals.intel.liquidity')} v={t(`signals.intel.liquidityLabel.${(pulse.liquidity?.label || 'adequate')}`)} tone={pulse.liquidity?.label === 'strong' ? 'up' : pulse.liquidity?.label === 'thin' ? 'down' : ''} />
      </div>
      <div className="row-between" style={{ marginTop: 12 }}>
        <span className="faint" style={{ fontSize: 10 }}>
          {t(`signals.intel.source.${pulse.source || 'unavailable'}`)}
          {pulse.smartMoney?.dataStatus ? ` · ${t(`signals.intel.smartMoney.${pulse.smartMoney.dataStatus}`)}` : ''}
        </span>
        <span className={`faint ${liveTone}`} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{t('signals.intel.lastUpdate')}: {timeAgo(pulse.lastUpdate || pulse.at)}</span>
      </div>
    </motion.section>
  );
}

function HorizonStrip({ horizons }) {
  const { t } = useTranslation();
  if (!horizons?.length) return null;
  return (
    <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
      <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7, marginBottom: 8 }}>{t('signals.intel.horizonTitle')}</div>
      <div className="sic-horizons">
        {horizons.map((h) => {
          const rl = (h.riskLabel || 'medium').toLowerCase();
          return (
            <div key={h.key} className="sic-horizon">
              <div className="h">
                <span>{h.key}</span>
                <span className={`risk-dot ${rl}`} aria-hidden="true" />
              </div>
              <div className={`risk ${rl}`}>{t(`signals.intel.horizonRisk.${rl}`)}</div>
              <div className="sub">
                {t('signals.intel.trend')}: {t(`signals.intel.direction.${h.trend || 'flat'}`)}
                {h.volatilityPct != null ? ` · ${t('signals.intel.volatilityShort')}: ${h.volatilityPct}%` : ''}
              </div>
              <div className="sub">
                {t('signals.intel.confidenceShort')}: {h.confidence != null ? `${h.confidence}%` : '—'}
                {h.movePct != null ? ` · ${h.movePct > 0 ? '+' : ''}${h.movePct}%` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function EvidenceChips({ evidence, max = 5 }) {
  const { t } = useTranslation();
  const rows = (evidence ?? []).filter((e) => e.direction !== 0).slice(0, max);
  if (!rows.length) return null;
  return (
    <div className="sic-evidence">
      {rows.map((e) => {
        const dir = e.direction > 0 ? 'up' : e.direction < 0 ? 'down' : '';
        const arrow = e.direction > 0 ? '↑' : e.direction < 0 ? '↓' : '·';
        return (
          <span key={`${e.key}-${e.source}`} className={`sic-ev ${dir}`}>
            {arrow} {t(`signals.intel.early.${e.reason || e.key}`)}
            {e.pct != null ? ` ${e.pct}%` : ''}
          </span>
        );
      })}
    </div>
  );
}

const CARD_FIELDS = ['confidence', 'risk', 'timeframe', 'target', 'stop', 'momentum', 'volume', 'smartMoney', 'whale', 'liquidity'];

/*
 * THE SIGNAL CARD — and the crash it used to cause.
 *
 * This was the only component in the file that read `t` from its PROPS instead
 * of calling `useTranslation()` like every sibling does, and neither call site
 * (the global list below, and SolanaSignalCard) passed one. The first card to
 * render therefore threw `TypeError: t is not a function` inside the
 * CARD_FIELDS map — past <Suspense>, into RouteBoundary, which is the
 * "a problem occurred" screen the user reported. Both tabs, every language,
 * every asset, the moment market data arrived.
 *
 * It survived the suite because test/screens.jsx mounts <Signals /> and
 * asserts on the FIRST paint, before any poll resolves: no coins, no cards,
 * component never constructed. test/signals-page-probe.jsx is the test that
 * serves real response shapes and waits, and it fails if `t` ever becomes a
 * prop again.
 *
 * (This file is scanned by test/wiring.mjs for ANY Arabic-script character —
 * a localized page must carry no hardcoded Persian, and the check reads the
 * raw source, comments included. So the report it answers is quoted in the
 * probe, not here.)
 *
 * The hook also runs BEFORE the `!signal` early return now. A hook after a
 * conditional return changes the hook count between renders of the same
 * instance, which is its own crash waiting for a card that goes null.
 */
function SignalCard({ signal, selected, onSelect, onWhy, whyLoading, onAlert, watched, onCompare, onTrack }) {
  const { t } = useTranslation();
  if (!signal) return null;
  const meta = CLASS_META[signal.classification] || CLASS_META.WATCH;
  const ready = signal.status === 'READY';
  const fields = CARD_FIELDS.map((f) => {
    let v = null;
    let tone = '';
    switch (f) {
      case 'confidence': v = ready ? `${signal.confidence}%` : '—'; tone = (signal.confidence ?? 0) >= 70 ? 'up' : ''; break;
      case 'risk': v = t(`signals.intel.riskLabel.${(signal.risk || 'medium').toLowerCase()}`); tone = signal.risk === 'HIGH' ? 'down' : signal.risk === 'LOW' ? 'up' : 'warn'; break;
      case 'timeframe': v = ready ? `${signal.timeframe}D` : '—'; break;
      case 'target': v = signal.target != null ? `+${signal.targetPct}%` : '—'; tone = 'up'; break;
      case 'stop': v = signal.stop != null ? `-${signal.stopPct}%` : '—'; tone = 'down'; break;
      case 'momentum': v = ready ? t(`signals.intel.momentumLabel.${signal.momentum?.label || 'flat'}`) : '—'; tone = signal.momentum?.direction === 'up' ? 'up' : signal.momentum?.direction === 'down' ? 'down' : ''; break;
      case 'volume': v = signal.volumeChange != null ? `${signal.volumeChange}%` : '—'; tone = (signal.volumeChange ?? 0) >= 6 ? 'up' : ''; break;
      case 'smartMoney': v = signal.smartMoney ? t(`signals.intel.sentimentLabel.${signal.smartMoney}`) : '—'; tone = signal.smartMoney === 'bullish' ? 'up' : signal.smartMoney === 'bearish' ? 'down' : ''; break;
      case 'whale': v = signal.whale ? t(`signals.intel.sentimentLabel.${signal.whale === 'inflow' ? 'bullish' : 'bearish'}`) : '—'; tone = signal.whale === 'inflow' ? 'up' : signal.whale === 'outflow' ? 'down' : ''; break;
      case 'liquidity': v = signal.liquidity ? t(`signals.intel.liquidityLabel.${signal.liquidity}`) : '—'; tone = signal.liquidity === 'strong' ? 'up' : signal.liquidity === 'thin' ? 'down' : ''; break;
      default: break;
    }
    return { f, v, tone };
  });

  return (
    <motion.div
      className={`sic-card ${selected ? 'is-selected' : ''}`}
      variants={riseIn}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(); } }}
    >
      <div className="glow" style={{ background: `radial-gradient(160px 60px at 50% 0%, ${meta.tone === 'up' ? 'rgba(0,255,157,.08)' : meta.tone === 'down' ? 'rgba(255,59,107,.08)' : 'rgba(255,179,0,.08)'}, transparent)` }} />
      <div className="sic-card-head">
        <CoinLogo coin={signal.coin} />
        <div style={{ minWidth: 0 }}>
          <div className="sym">{signal.coin?.symbol}</div>
          <div className="name">{signal.coin?.name}</div>
        </div>
        <div className="price">
          <div>${fmtPrice(signal.coin?.price)}</div>
          <div className={`mono ${(signal.coin?.change24h ?? 0) >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>{fmtPct(signal.coin?.change24h ?? 0)}</div>
        </div>
      </div>

      {ready ? (
        <>
          <div className="sic-class">
            <span className={`badge ${meta.tone}`}>{meta.emoji} {t(classKey(signal.classification))}</span>
            <span className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.card.confidence')}: <b style={{ color: 'var(--text-1)' }}>{signal.confidence}%</b></span>
            {signal.offline && <span className="pill down" style={{ fontSize: 9.5, padding: '2px 8px' }}>{t('signals.intel.status.offline')}</span>}
          </div>
          <div className="sic-bar">
            <motion.i initial={{ width: 0 }} animate={{ width: `${signal.confidence}%` }} transition={{ duration: 0.7 }} style={{ background: `linear-gradient(90deg, ${meta.tone === 'up' ? 'var(--up)' : meta.tone === 'down' ? 'var(--down)' : '#ffb300'}, transparent)` }} />
          </div>
          <div className="sic-grid">
            {fields.map((x) => (
              <div key={x.f} className="sic-tile">
                <div className="k">{t(`signals.intel.card.${x.f}`)}</div>
                <div className={`v ${x.tone}`}>{x.v}</div>
              </div>
            ))}
          </div>
          <EvidenceChips evidence={signal.evidence} />
          <div className="sic-actions">
            <button type="button" className="sic-btn primary" onClick={(e) => { e.stopPropagation(); onWhy?.(signal); }}>
              {whyLoading ? '…' : '🧠'} {t('signals.intel.card.why')}
            </button>
            <button type="button" className={`sic-btn ${watched ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onAlert?.('watch', signal); }}>
              ★ {t(watched ? 'signals.intel.actions.watched' : 'signals.intel.actions.watch')}
            </button>
            <button type="button" className="sic-btn" onClick={(e) => { e.stopPropagation(); onAlert?.('alert', signal); }}>
              🔔 {t('signals.intel.actions.alert')}
            </button>
          </div>
          {ready && (
            <div className="sic-actions secondary">
              <button type="button" className="sic-btn" onClick={(e) => { e.stopPropagation(); onCompare?.(signal); }}>
                ⇄ {t('signals.intel.actions.compare')}
              </button>
              <button type="button" className="sic-btn" onClick={(e) => { e.stopPropagation(); onTrack?.(signal); }}>
                📒 {t('signals.intel.actions.track')}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="sic-insufficient" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--rgb-5)' }}>⛔ {t('signals.intel.card.insufficient')}</div>
          <div style={{ marginTop: 6 }}>{t('signals.intel.card.insufficientBody')}</div>
        </div>
      )}
      <div className="faint" style={{ fontSize: 9.5, marginTop: 10 }}>{t('signals.intel.card.at')} {timeAgo(signal.at)}</div>
    </motion.div>
  );
}

function FilterBar({ filters, setFilters }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const sel = (k, opts, val) => (
    <select value={val} onChange={(e) => set(k, e.target.value)} style={{ width: '100%', minHeight: 36, borderRadius: 11, background: 'var(--bg-panel-solid)', color: 'var(--text-1)', border: '1px solid rgba(255,255,255,0.1)', padding: '0 10px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const rows = [
    { k: 'type', opts: [['all', t('signals.intel.filters.all')], ['buy', t('signals.intel.filters.buy')], ['sell', t('signals.intel.filters.sell')], ['watch', t('signals.intel.filters.watch')]] },
    { k: 'risk', opts: [['all', t('signals.intel.filters.all')], ['low', t('signals.intel.filters.low')], ['medium', t('signals.intel.filters.medium')], ['high', t('signals.intel.filters.high')]] },
    { k: 'confidence', opts: [['all', t('signals.intel.filters.all')], ['50', t('signals.intel.filters.conf50')], ['70', t('signals.intel.filters.conf70')], ['90', t('signals.intel.filters.conf90')]] },
    { k: 'timeframe', opts: [['all', t('signals.intel.filters.all')], ['24H', t('signals.intel.filters.t24')], ['7D', t('signals.intel.filters.t7')], ['30D', t('signals.intel.filters.t30')]] },
    { k: 'asset', opts: [['all', t('signals.intel.filters.all')], ['BTC', 'BTC'], ['ETH', 'ETH'], ['SOL', 'SOL'], ['others', t('signals.intel.filters.others')]] },
    { k: 'market', opts: [['all', t('signals.intel.filters.all')], ['evm', t('signals.intel.filters.evm')], ['solana', t('signals.intel.filters.solana')]] }
  ];
  const filterLabels = {
    type: t('signals.intel.filters.type'), risk: t('signals.intel.filters.risk'), confidence: t('signals.intel.filters.confidence'),
    timeframe: t('signals.intel.filters.timeframe'), asset: t('signals.intel.filters.asset'), market: t('signals.intel.filters.market')
  };
  return (
    <div className="sic-controls" style={{ marginTop: 12 }}>
      <div className="row-between">
        <button type="button" className="sic-btn" style={{ flex: 1 }} onClick={() => setOpen((v) => !v)}>
          <span>{open ? '▾' : '▸'}</span> {t('signals.intel.filters.title')}
        </button>
        <button type="button" className="sic-btn" onClick={() => setFilters({ type: 'all', risk: 'all', confidence: 'all', timeframe: 'all', asset: 'all', market: 'all' })}>
          {t('signals.intel.filters.clear')}
        </button>
      </div>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          {rows.map((r) => (
            <div key={r.k}>
              <div className="faint" style={{ fontSize: 9.5, marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>{filterLabels[r.k]}</div>
              {sel(r.k, r.opts.map(([v, l]) => ({ value: v, label: l })), filters[r.k] || 'all')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WhyModal({ why, onClose }) {
  const { t } = useTranslation();
  if (!why) return null;
  const { signal, loading, data } = why;
  return (
    <div className="sic-modal-backdrop" role="presentation" onClick={onClose}>
      <motion.div className="sic-modal" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3>🧠 {t('signals.intel.why.title')}</h3>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
              {signal?.coin?.symbol} · {t(classKey(signal?.classification))} · {signal?.confidence}%
            </div>
          </div>
          <button type="button" className="sic-btn" style={{ flex: '0 0 auto', minWidth: 36 }} onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="stack" style={{ gap: 10, marginTop: 16 }}>
            {[92, 76, 58].map((w) => <motion.div key={w} className="skel" style={{ height: 11, width: `${w}%`, borderRadius: 8 }} animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} />)}
            <span className="faint" style={{ fontSize: 12 }}>{t('signals.intel.why.loading')}</span>
          </div>
        )}

        {!loading && !data && <p className="notice" style={{ marginTop: 16 }}>{t('signals.intel.why.unavailable')}</p>}

        {!loading && data && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {data.aiDisagreement && (
              <div className="sic-why-block">
                <span className="pill pill-down" style={{ fontSize: 10.5 }}>⚠️ {t('signals.intel.why.disagreement')}</span>
              </div>
            )}
            {data.agreement != null && (
              <div className="sic-why-block">
                <div className="k">{t('signals.intel.why.consensus')} · {t('signals.intel.why.agreement')}: {data.agreement}%</div>
                <div className="sic-bar" style={{ marginTop: 6 }}>
                  <i style={{ width: `${data.agreement}%`, background: data.agreement >= 60 ? 'var(--up)' : 'var(--rgb-5)' }} />
                </div>
              </div>
            )}
            {[
              ['technical', data.sections?.technical],
              ['market', data.sections?.market],
              ['onchain', data.sections?.onchain],
              ['sentiment', data.sections?.sentiment]
            ].map(([k, v]) => (v ? (
              <div key={k} className="sic-why-block">
                <div className="k">{t(`signals.intel.why.${k}`)}</div>
                <p>{v}</p>
              </div>
            ) : null))}
            {data.conclusion && (
              <div className="sic-why-concl">
                <div className="k">{t('signals.intel.why.conclusion')}</div>
                <p>{data.conclusion}</p>
              </div>
            )}
            <div className="faint" style={{ fontSize: 10, marginTop: 12, lineHeight: 1.7 }}>
              {data.source === 'ai' ? t('signals.intel.why.meta', { providers: (data.aiMeta?.providers || []).join(' · ') }) : t('signals.intel.why.localMeta')}
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

function AlertSheet({ symbol, onClose }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState('price');
  const [condition, setCondition] = useState('above');
  const [value, setValue] = useState('');
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    if (symbol) setAlerts(readAlerts().filter((a) => a.symbol.toUpperCase() === symbol.toUpperCase() && a.active));
  }, [symbol]);
  if (!symbol) return null;
  const kinds = [
    ['price', t('signals.intel.alert.price')],
    ['confidence', t('signals.intel.alert.confidence')],
    ['volume', t('signals.intel.alert.volume')],
    ['whale', t('signals.intel.alert.whale')],
    ['smartMoney', t('signals.intel.alert.smartMoney')],
    ['riskChange', t('signals.intel.alert.riskChange')]
  ];
  const create = () => {
    const next = createAlert({ symbol, kind, condition, value: Number(value) || 0 });
    if (next) setAlerts(next.filter((a) => a.symbol.toUpperCase() === symbol.toUpperCase() && a.active));
    showLocalNotification(`FBT · ${symbol}`, { body: t('signals.intel.alert.created') });
    setValue('');
  };
  return (
    <div className="sic-modal-backdrop" role="presentation" onClick={onClose}>
      <motion.div className="sic-modal" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h3>🔔 {t('signals.intel.alert.title')} · {symbol}</h3>
          <button type="button" className="sic-btn" style={{ flex: '0 0 auto', minWidth: 36 }} onClick={onClose}>✕</button>
        </div>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{t('signals.intel.alert.subtitle')}</p>
        <div className="stack" style={{ gap: 10, marginTop: 14 }}>
          <div>
            <div className="field-label">{t('signals.intel.alert.kind')}</div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="input" style={{ width: '100%', minHeight: 44, background: 'var(--bg-panel-solid)', color: 'var(--text-1)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '0 12px' }}>
              {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="field-label">{t('signals.intel.alert.threshold')}</div>
              <select value={condition} onChange={(e) => setCondition(e.target.value)} className="input" style={{ width: '100%', minHeight: 44, background: 'var(--bg-panel-solid)', color: 'var(--text-1)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '0 12px' }}>
                <option value="above">{t('signals.intel.alert.above')}</option>
                <option value="below">{t('signals.intel.alert.below')}</option>
              </select>
            </div>
            <div>
              <div className="field-label">Value</div>
              <input value={value} onChange={(e) => setValue(e.target.value)} type="number" inputMode="decimal" className="input" placeholder={kind === 'price' ? '100' : '70'} style={{ width: '100%', minHeight: 44, background: 'var(--bg-panel-solid)', color: 'var(--text-1)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '0 12px' }} />
            </div>
          </div>
          <button type="button" className="btn btn-primary" style={{ minHeight: 46, borderRadius: 14 }} onClick={create}>{t('signals.intel.alert.create')}</button>
          {alerts.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div className="field-label">{t('signals.intel.alert.active')}</div>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                {alerts.map((a) => (
                  <div key={a.id} className="row-between" style={{ padding: '7px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                      {t(`signals.intel.alert.cond.${a.kind}`, { v: a.value, op: t(a.condition === 'above' ? 'signals.intel.alert.above' : 'signals.intel.alert.below') })}
                      {' '}· {a.firedCount > 0 ? `${t('signals.intel.alert.fired')} ${a.firedCount}×` : ''}
                    </span>
                    <button
                      type="button"
                      className="sic-btn"
                      style={{ minWidth: 34, padding: '2px 8px', fontSize: 11 }}
                      onClick={() => setAlerts(deleteAlert(a.id).filter((x) => x.symbol.toUpperCase() === symbol.toUpperCase() && x.active))}
                      aria-label={`remove ${a.kind} alert`}
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.alert.evaluate')}</p>
        </div>
      </motion.div>
    </div>
  );
}

function EarlySection({ early }) {
  const { t } = useTranslation();
  return (
    <section>
      <div className="sic-section-head">
        <span className="cap">⚡</span>
        <div>
          <div className="title">{t('signals.intel.early.title')}</div>
          <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.early.subtitle')}</div>
        </div>
      </div>
      {early.length === 0 ? (
        <div className="sic-insufficient">{t('signals.intel.early.empty')}</div>
      ) : (
        <div className="sic-rows">
          {early.slice(0, 8).map((e) => (
            <div key={e.symbol} className="sic-row">
              <CoinLogo coin={e.coin} />
              <div className="main">
                <div className="s">{e.symbol}</div>
                <div className="d">{e.flags.map((f) => t(`signals.intel.early.${f}`)).join(' · ')}</div>
              </div>
              <div className="num">
                <div style={{ color: e.direction === 'earlyBullish' ? 'var(--up)' : e.direction === 'earlyBearish' ? 'var(--down)' : '#ffb300', fontWeight: 900 }}>
                  {t(`signals.intel.early.direction.${e.direction}`)}
                </div>
                <div className="lbl">{t('signals.intel.early.confidence')}: {e.confidence}%</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="sic-note">{t('signals.intel.early.note')}</div>
    </section>
  );
}

function SmartMoneySection({ sm }) {
  const { t } = useTranslation();
  if (!sm || !sm.tokenActivity?.length) {
    return (
      <section>
        <div className="sic-section-head"><span className="cap">🐋</span><div className="title">{t('signals.intel.smartMoney.title')}</div></div>
        <div className="sic-insufficient">{t('signals.intel.smartMoney.unavailable')}</div>
      </section>
    );
  }
  const m = sm.metrics || {};
  return (
    <section>
      <div className="sic-section-head">
        <span className="cap">🐋</span>
        <div>
          <div className="title">{t('signals.intel.smartMoney.title')}</div>
          <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.smartMoney.subtitle')}</div>
        </div>
      </div>
      <div className="sic-history-grid">
        <div className="sic-stat"><div className="k">{t('signals.intel.smartMoney.whaleActivity')}</div><div className="v">{m.whaleActivity?.value ?? '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.smartMoney.accumulation')}</div><div className="v up">{m.accumulation?.valueUsd != null ? `$${fmtCompact(m.accumulation.valueUsd)}` : '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.smartMoney.distribution')}</div><div className="v down">{m.distribution?.valueUsd != null ? `$${fmtCompact(m.distribution.valueUsd)}` : '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.smartMoney.netFlow')}</div><div className={`v ${(m.netFlow?.value ?? 0) >= 0 ? 'up' : 'down'}`}>{m.netFlow?.value != null ? `$${fmtCompact(m.netFlow.value)}` : '—'}</div></div>
      </div>
      <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, margin: '14px 0 8px' }}>{t('signals.intel.smartMoney.tokenTitle')}</div>
      <div className="sic-rows">
        {sm.tokenActivity.slice(0, 6).map((r) => (
          <div key={`${r.chainId}:${r.symbol}`} className="sic-row">
            <div className="main">
              <div className="s">{r.symbol}</div>
              <div className="d">{t(`signals.intel.smartMoney.signal.${r.signal}`)} · ${fmtCompact(r.netUsd)}</div>
            </div>
            <div className="num">
              <div style={{ color: r.netUsd >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 900 }}>{r.netUsd >= 0 ? '+' : ''}{fmtCompact(r.netUsd)}</div>
              <div className="lbl">{r.events} tx</div>
            </div>
          </div>
        ))}
      </div>
      <div className="sic-note">{t('signals.intel.smartMoney.note')}</div>
    </section>
  );
}

function MomentumSection({ cards }) {
  const { t } = useTranslation();
  const rows = (cards ?? []).filter((s) => s.status === 'READY').slice(0, 6);
  return (
    <section>
      <div className="sic-section-head">
        <span className="cap">📊</span>
        <div>
          <div className="title">{t('signals.intel.momentum.title')}</div>
          <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.momentum.subtitle')}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="sic-insufficient">{t('signals.intel.momentum.empty')}</div>
      ) : (
        <div className="sic-rows">
          {rows.map((s) => (
            <div key={s.coin.id} className="sic-row">
              <CoinLogo coin={s.coin} />
              <div className="main">
                <div className="s">{s.coin.symbol}</div>
                <div className="d">{t(classKey(s.classification))} · {s.confidence}%</div>
              </div>
              <Sparkline data={(s.coin.sparkline ?? []).slice(-40)} up={(s.score ?? 0) >= 0} width={64} height={28} />
              <div className="num">
                <div style={{ color: s.score >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 900 }}>{s.score > 0 ? '+' : ''}{s.score}</div>
                <div className="lbl">{t('signals.intel.momentum.score')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RadarSection({ radar }) {
  const { t } = useTranslation();
  const tokens = radar?.tokens ?? [];
  return (
    <section>
      <div className="sic-section-head">
        <span className="cap">🚀</span>
        <div>
          <div className="title">{t('signals.intel.radar.title')}</div>
          <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.radar.subtitle')}</div>
        </div>
      </div>
      {tokens.length === 0 ? (
        <div className="sic-insufficient">{t('signals.intel.radar.unavailable')}</div>
      ) : (
        <div className="sic-radar-grid">
          {tokens.map((tk) => (
            <div key={tk.address} className="sic-radar">
              <div className="head">
                <div>
                  <div className="sym">{tk.symbol}</div>
                  <div className="age">{tk.name}</div>
                </div>
                <div className="age">{t('signals.intel.radar.age')}: {tk.ageHours != null ? `${tk.ageHours}h` : '—'}</div>
              </div>
              <div className="sic-scores">
                <div className="sic-score">
                  <div className="k">{t('signals.intel.radar.opportunity')}</div>
                  <div className="v up">{tk.opportunityScore}</div>
                </div>
                <div className="sic-score">
                  <div className="k">{t('signals.intel.radar.risk')}</div>
                  <div className={`v ${tk.riskScore >= 75 ? 'down' : tk.riskScore >= 50 ? 'warn' : 'up'}`}>{tk.riskScore}</div>
                </div>
              </div>
              <div className="pct">
                💧 {t('signals.intel.radar.liquidity')}: ${fmtCompact(tk.liquidityUsd)} · 📈 {t('signals.intel.radar.volume')}: ${fmtCompact(tk.volumeH24)}
                {tk.buyRatio != null ? ` · ${t('signals.intel.radar.buyRatio')}: ${Math.round(tk.buyRatio * 100)}%` : ''}
              </div>
              {tk.flags?.length > 0 && (
                <div className="sic-evidence" style={{ marginTop: 8 }}>
                  {tk.flags.map((f) => <span key={f} className="sic-ev down">⚠ {t(`signals.intel.radar.flags.${f}`)}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="sic-note">{t('signals.intel.radar.note')}</div>
    </section>
  );
}

function HistorySection({ history, perf, priceMap }) {
  const { t } = useTranslation();
  const rows = [...history].reverse().slice(0, 8);
  return (
    <section>
      <div className="sic-section-head">
        <span className="cap">📒</span>
        <div>
          <div className="title">{t('signals.intel.history.title')}</div>
          <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.history.subtitle')}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="sic-insufficient">{t('signals.intel.history.empty')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="sic-table">
            <thead>
              <tr>
                {['symbol', 'time', 'entry', 'signal', 'confidence', 'result', 'move'].map((c) => <th key={c}>{t(`signals.intel.history.columns.${c}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td style={{ fontWeight: 800, color: 'var(--text-1)' }}>{h.symbol}</td>
                  <td>{new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>${fmtPrice(h.entryPrice)}</td>
                  <td>{t(classKey(h.classification))}</td>
                  <td>{h.confidence}%</td>
                  <td className={`r ${h.result === 'success' ? 'up' : h.result === 'failed' ? 'down' : ''}`}>
                    {h.settled ? t(`signals.intel.history.result.${h.result}`) : `${t('signals.intel.history.result.pending')} ${t('signals.intel.history.pendingTime', { d: h.horizon })}`}
                  </td>
                  <td className={`r ${(h.outcomePct ?? 0) >= 0 ? 'up' : 'down'}`}>{h.outcomePct != null ? `${h.outcomePct > 0 ? '+' : ''}${h.outcomePct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sic-note">{t('signals.intel.performance.insufficient')}</div>
    </section>
  );
}

function PerformanceSection({ perf }) {
  const { t } = useTranslation();
  if (!perf) return null;
  return (
    <section>
      <div className="sic-section-head">
        <span className="cap">🎯</span>
        <div className="title">{t('signals.intel.performance.title')}</div>
      </div>
      <div className="sic-history-grid">
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.totalSignals')}</div><div className="v">{perf.totalSignals}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.settledSignals')}</div><div className="v">{perf.settledSignals}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.successful')}</div><div className="v up">{perf.successful ?? '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.failed')}</div><div className="v down">{perf.failed ?? '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.accuracy')}</div><div className={`v ${(perf.accuracy ?? 0) >= 50 ? 'up' : 'down'}`}>{perf.accuracy != null ? `${perf.accuracy}%` : '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.avgReturn')}</div><div className={`v ${(perf.avgReturn ?? 0) >= 0 ? 'up' : 'down'}`}>{perf.avgReturn != null ? `${perf.avgReturn > 0 ? '+' : ''}${perf.avgReturn}%` : '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.avgDrawdown')}</div><div className="v down">{perf.avgDrawdown != null ? `${perf.avgDrawdown}%` : '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.best')}</div><div className="v up">{perf.best ? `${perf.best.symbol} ${perf.best.pct > 0 ? '+' : ''}${perf.best.pct}%` : '—'}</div></div>
        <div className="sic-stat"><div className="k">{t('signals.intel.performance.worst')}</div><div className="v down">{perf.worst ? `${perf.worst.symbol} ${perf.worst.pct > 0 ? '+' : ''}${perf.worst.pct}%` : '—'}</div></div>
      </div>
    </section>
  );
}

function PortfolioCard({ impact, consent, onConsent }) {
  const { t } = useTranslation();
  if (!impact && !consent) return null;
  const tone = impact?.impact === 'HIGH' ? 'down' : impact?.impact === 'MEDIUM' ? 'warn' : 'up';
  return (
    <section>
      <div className="sic-section-head"><span className="cap">💼</span><div className="title">{t('signals.intel.portfolio.title')}</div></div>
      {impact ? (
        <>
          <div className="sic-history-grid">
            <div className="sic-stat"><div className="k">{t('signals.intel.portfolio.impact')}</div><div className={`v ${tone}`}>{t(`signals.intel.portfolio.${impact.impact.toLowerCase()}`)}</div></div>
            <div className="sic-stat"><div className="k">{t('signals.intel.portfolio.exposure')}</div><div className="v">{impact.exposurePct}%</div></div>
            <div className="sic-stat"><div className="k">{t('signals.intel.portfolio.concentration')}</div><div className="v">{impact.concentrationPct}%</div></div>
            <div className="sic-stat"><div className="k">{t('signals.intel.portfolio.position')}</div><div className="v">{t(`signals.intel.portfolio.${impact.hasPosition ? 'yes' : 'no'}`)}</div></div>
          </div>
          <div className="sic-note">
            {impact.notes.map((n) => t(`signals.intel.portfolio.notes.${n}`)).join(' ')}
          </div>
        </>
      ) : (
        <div className="sic-insufficient">{t('signals.intel.portfolio.local')}</div>
      )}
      <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }}>
        <div className="row-between">
          <div>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{t('signals.intel.portfolio.consentTitle')}</div>
            <div className="faint" style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.7 }}>{t('signals.intel.portfolio.consentBody')}</div>
          </div>
          <button type="button" className={`sic-btn ${consent.portfolioAi ? 'active' : ''}`} style={{ flex: '0 0 auto' }} onClick={onConsent}>
            {consent.portfolioAi ? '✓' : '○'} {t(consent.portfolioAi ? 'signals.intel.portfolio.consentOn' : 'signals.intel.portfolio.consentOff')}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-asset Solana signal card (fetches its own chart lazily, only when the
 * Solana tab is mounted — same hook the existing page used for one asset).
 * ──────────────────────────────────────────────────────────────────────────── */
function SolanaSignalCard({ asset, marketCoin, pulse, smToken, selected, onSelect, onWhy, whyLoading, onAlert, watched, onCompare, onTrack, search = '', filters = null }) {
  const { data: chart } = useChart(asset.id, 30);
  const [intel, setIntel] = useState(null);
  useEffect(() => {
    let alive = true;
    getSolanaIntel(asset.mint).then((d) => alive && setIntel(d)).catch(() => {});
    return () => { alive = false; };
  }, [asset.mint]);
  const signal = useMemo(() => {
    const series = (chart ?? []).map((p) => p.p);
    const coin = marketCoin ?? { id: asset.id, symbol: asset.symbol, name: asset.name, price: series[series.length - 1] ?? 0, change24h: 0, change7d: 0, mcap: 0, volume: 0, dataProvenance: 'live' };
    const analysis = series.length >= 30 ? analyze(series, coin) : null;
    if (!analysis || !series.length || !Number.isFinite(coin.price) || coin.price <= 0) {
      return { status: 'INSUFFICIENT_DATA', at: Date.now(), coin };
    }
    return computeSignalCard({ coin, series, analysis, solanaIntel: intel, smToken, pulse });
  }, [chart, asset, marketCoin, intel, pulse, smToken]);

  /* Same search/filter semantics as the global tab, applied once the card's
     own measured data is in. An insufficient-data card is still searchable by
     symbol/name; filtering by signal fields only applies to READY cards. */
  const visible = useMemo(() => {
    if (signal.status !== 'READY') {
      return searchSignals([signal], search).length === 1;
    }
    return searchSignals([signal], search).length === 1 && filterSignals([signal], filters ?? {}, marketOf).length === 1;
  }, [signal, search, filters]);
  if (!visible) return null;

  return (
    <SignalCard signal={signal} selected={selected} onSelect={onSelect} onWhy={onWhy} whyLoading={whyLoading} onAlert={onAlert} watched={watched} onCompare={onCompare} onTrack={onTrack} />
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * THE PAGE
 * ──────────────────────────────────────────────────────────────────────────── */
export default function Signals() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const { data: coins } = useMarkets(40);
  const { data: global } = useGlobalStats();

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

  const [filters, setFilters] = useState({ type: 'all', risk: 'all', confidence: 'all', timeframe: 'all', asset: 'all', market: 'all' });
  const [search, setSearch] = useState('');
  const [why, setWhy] = useState(null);
  const [alertFor, setAlertFor] = useState(null);
  const [watchVersion, setWatchVersion] = useState(0);
  const [consent, setConsentState] = useState(readConsent());
  const [history, setHistory] = useState(readHistory());

  const { data: chart } = useChart(activeId, 30);
  const { data: btcChart } = useChart('bitcoin', 30);
  const { data: solanaCoin } = useCoin(tab === 'solana' ? activeId : null);

  const positions = useAppStore((s) => s.positions);
  const priceMap = useMemo(() => {
    const m = {};
    (coins ?? []).forEach((c) => { m[c.id] = c.price; });
    return m;
  }, [coins]);

  /* ── server-driven feeds (all fail closed) ────────────────────────────── */
  const pulsePoll = usePoll(() => getSignalPulse(), [], 60_000);
  const smPoll = usePoll(() => fetchOverview('24h'), [], 120_000);
  const radarPoll = usePoll(() => (tab === 'solana' ? getSolanaRadar(10) : Promise.resolve({ dataStatus: 'idle', tokens: [] })), [tab], 300_000);
  const sm = smPoll.data;
  const pulse = useMemo(
    () => (pulsePoll.data && pulsePoll.data?.sentiment ? pulsePoll.data : computePulseLocal({ global, markets: coins ?? [], smartMoney: sm, now: Date.now() })),
    [pulsePoll.data, global, coins, sm]
  );

  const coin = useMemo(() => {
    if (tab === 'solana') return solanaCoin ?? (coins ?? []).find((c) => c.id === activeId) ?? null;
    return (coins ?? []).find((c) => c.id === coinId) ?? null;
  }, [tab, solanaCoin, coins, coinId, activeId]);

  const priceSeries = useMemo(() => (chart?.length ? chart.map((p) => p.p) : (coin?.sparkline ?? [])), [chart, coin]);
  const btcSeries = useMemo(() => (btcChart ?? []).map((p) => p.p), [btcChart]);
  const analysis = useMemo(() => (priceSeries.length ? analyze(priceSeries, coin ?? {}) : null), [priceSeries, coin]);
  const projection = useMemo(() => (analysis ? projectRange(analysis, horizon.days) : null), [analysis, horizon]);
  const sentiment = useMemo(() => marketSentiment(global), [global]);
  const regime = useMemo(() => (global ? marketRegime({ global, btcSeries }) : null), [global, btcSeries]);

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

  const horizonKey = horizon.days >= 30 ? 'long' : 'short';
  const read = verdictData?.[horizonKey];

  /* ── reward + learning telemetry (kept) ───────────────────────────────── */
  const analysedCoinId = coin?.id ?? null;
  const analysisReady = Boolean(analysis && verdictData && analysedCoinId);
  useEffect(() => {
    if (!analysisReady || !analysedCoinId) return;
    useAppStore.getState().awardProduct('tokenAnalysis', POINT_VALUES.tokenAnalysis, {
      refId: `coin:${analysedCoinId}`,
      perDay: true
    });
  }, [analysisReady, analysedCoinId]);

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

  /* ── smart-money symbol index (real tokenActivity from the flow engine) ── */
  const smBySymbol = useMemo(() => {
    const m = new Map();
    for (const r of sm?.tokenActivity ?? []) {
      if (!r?.symbol) continue;
      const prev = m.get(r.symbol);
      if (!prev || Math.abs(r.netUsd ?? 0) > Math.abs(prev.netUsd ?? 0)) m.set(r.symbol, r);
    }
    return m;
  }, [sm]);

  /* ── Global signal cards (deterministic engine over real market data) ── */
  const globalSignals = useMemo(() => {
    if (!coins?.length) return [];
    const list = coins.slice(0, 24).map((c) => {
      const series = (c.sparkline ?? []).filter((n) => Number.isFinite(n) && n > 0);
      const a = series.length >= 30 ? analyze(series, c) : null;
      if (!a) return null;
      return computeSignalCard({ coin: c, series, analysis: a, solanaIntel: null, smToken: smBySymbol.get(c.symbol), pulse, now: Date.now() });
    }).filter(Boolean);
    return rankSignals(list);
  }, [coins, pulse, smBySymbol]);

  /* ── Solana curated signals: each card owns one chart fetch (lazy) ────── */
  const solanaSignals = useMemo(() => SOLANA_SIGNAL_ASSETS.map((a) => ({ asset: a, smToken: smBySymbol.get(a.symbol) })), [smBySymbol]);

  /* Global tab filters here (cards are already computed). Solana cards hold
     their own lazy signal computation, so they receive the same search +
     filter state and decide visibility after their data resolves. */
  const visibleSignals = useMemo(
    () => (tab === 'all' ? filterSignals(searchSignals(globalSignals, search), filters, marketOf) : globalSignals),
    [tab, globalSignals, search, filters, marketOf]
  );

  /* Solana per-card intel is resolved inside SolanaSignalCard; the selected
     asset's intel is fetched here for the detail lab (kept from the old page). */
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

  const intel = solanaIntel && solanaIntel.configured ? solanaIntel : null;

  /* On-chain row for the detail lab: Solana tab only, and only when Solscan
     actually returned at least one measured metric — failing closed exactly
     like the existing page did. */
  const hasOnchain = Boolean(
    intel && (
      intel.whaleFlow?.direction
      || intel.holderTrend?.change
      || intel.topHolderPct != null
      || intel.dexActivity?.pressure
    )
  );

  /* ── Early signals: momentum acceleration + flow/on-chain agreement ─────
        Market-wide (both tabs): every number comes from real market data. */
  const earlyEntries = useMemo(() => {
    return (coins ?? []).slice(0, 24).map((c) => {
      const series = (c.sparkline ?? []).filter((n) => Number.isFinite(n));
      const a = series.length >= 30 ? analyze(series, c) : null;
      return a ? { coin: c, series, analysis: a, smToken: smBySymbol.get(c.symbol) } : null;
    }).filter(Boolean);
  }, [coins, smBySymbol]);
  const early = useMemo(() => computeEarlySignals({ entries: earlyEntries }), [earlyEntries]);

  /* ── history learning loop: record + settle against real prices ───────── */
  useEffect(() => {
    if (!globalSignals.length) return;
    let next = history;
    for (const s of globalSignals.slice(0, 8)) next = recordSignal(s);
    if (next.length !== history.length) setHistory(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSignals]);
  useEffect(() => {
    if (!coins?.length) return;
    const next = settleHistory({ history, prices: priceMap });
    if (next !== history) setHistory(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceMap]);
  const perf = useMemo(() => performance(history), [history]);

  /* ── alerts: evaluate against real signal data, one fire per cooldown ──── */
  useEffect(() => {
    const ready = (tab === 'solana' ? [] : globalSignals).filter((s) => s.status === 'READY');
    if (!ready.length) return;
    const { fired, next } = evaluateSignalAlerts({ alerts: readAlerts(), signals: ready });
    if (fired.length) {
      saveAlerts(next);
      setWatchVersion((v) => v + 1);
      fired.forEach((a) => {
        const op = a.condition === 'above' ? t('signals.intel.alert.above') : t('signals.intel.alert.below');
        const body = t(`signals.intel.alert.cond.${a.kind === 'whale' || a.kind === 'smartMoney' ? a.kind : a.kind}`, { v: a.value, op });
        showLocalNotification(`FBT · ${a.symbol}`, { body, data: { url: '/signals' } });
      });
    }
  }, [globalSignals, tab, t]);

  /* ── why: multi-AI explanation, evidence only ──────────────────────────── */
  const openWhy = async (signal) => {
    if (!signal || signal.status !== 'READY') return;
    haptic?.('select');
    setWhy({ signal, loading: true, data: null });
    const ev = {};
    signal.evidence.forEach((e) => {
      if (e.key === 'rsi') ev.rsi = e.pct != null ? 50 + (e.direction > 0 ? -15 : e.direction < 0 ? 15 : 0) : null;
      if (e.key === 'macd') ev.macd = e.direction;
      if (e.key === 'maCross' || e.key === 'ma20') { ev.ma20 = e.direction; ev.ma50 = 0; }
      if (e.key === 'bollinger') ev.bollinger = e.direction;
      if (e.key.startsWith('momentum')) ev.momentum = e.direction * 25;
      if (e.key.startsWith('trend')) ev.change7d = e.direction * 5;
      if (e.key.startsWith('whale')) ev.whaleFlow = e.direction > 0 ? 'inflow' : 'outflow';
      if (e.key === 'holderGrowth') ev.holderTrend = 'rising';
      if (e.key === 'holderSpread') ev.holderTrend = 'falling';
      if (e.key === 'dexBuy') ev.dexPressure = 'buy';
      if (e.key === 'dexSell') ev.dexPressure = 'sell';
      if (e.key === 'smartMoneyAccum') ev.smartMoneySignal = 'ACCUMULATION';
      if (e.key === 'smartMoneyDistrib') ev.smartMoneySignal = 'DISTRIBUTION';
      if (e.key === 'liquidityActive') ev.volumeTurnover = e.pct;
      if (e.key === 'marketSentimentUp') ev.marketSentiment = 60;
      if (e.key === 'marketSentimentDown') ev.marketSentiment = 40;
    });
    if (signal.coin?.price) ev.price = signal.coin.price;
    ev.change24h = signal.momentum?.pct ?? null;
    ev.riskScore = signal.riskScore;
    ev.confidence = signal.confidence;
    /* Portfolio-aware path — ONLY with explicit consent, and ONLY aggregate
       percentages (the server sanitizer additionally enforces the allowlist). */
    if (consent.portfolioAi && portfolioImpactData) {
      ev.portfolioExposure = portfolioImpactData.exposurePct;
      ev.portfolioConcentration = portfolioImpactData.concentrationPct;
      ev.portfolioHasPosition = portfolioImpactData.hasPosition ? 1 : 0;
    }
    const res = await getSignalWhy({
      symbol: signal.coin.symbol,
      name: signal.coin.name,
      lang: i18n.language,
      evidence: ev,
      classification: signal.classification,
      confidence: signal.confidence,
      riskLabel: signal.risk,
      timeframe: signal.timeframe
    });
    setWhy({ signal, loading: false, data: res });
  };

  const onCardAction = (kind, signal) => {
    if (kind === 'watch') {
      toggleWatch(signal.coin.id);
      setWatchVersion((v) => v + 1);
      haptic?.('select');
      return;
    }
    if (kind === 'alert') setAlertFor(signal.coin.symbol);
  };

  const selectCard = (signal) => {
    haptic?.('select');
    if (tab === 'all') setCoinId(signal.coin.id);
    else setSolanaId(signal.coin.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ── portfolio-aware impact (local only) ───────────────────────────────── */
  const selectedSignal = useMemo(() => {
    if (tab === 'solana') return null;
    return globalSignals.find((s) => s.coin?.id === coinId) ?? null;
  }, [globalSignals, coinId, tab]);
  const portfolioImpactData = useMemo(
    () => (selectedSignal?.status === 'READY'
      ? portfolioImpact({ positions, priceMap, coin: selectedSignal.coin, classification: selectedSignal.classification })
      : null),
    [selectedSignal, positions, priceMap]
  );

  /* ── detail lab data (kept from the existing page, fail-closed) ────────── */
  const bandPct = useMemo(() => {
    if (!projection || !projection.mid) return 2;
    const half = (projection.high - projection.low) / 2;
    return Math.max(0.5, Math.min(10, (half / projection.mid) * 100));
  }, [projection]);
  const scenarios = useMemo(
    () => (priceSeries.length ? scenarioSplit(priceSeries, horizon.days, bandPct) : null),
    [priceSeries, horizon.days, bandPct]
  );
  const invalidation = useMemo(() => {
    if (!priceSeries.length) return null;
    const price = priceSeries[priceSeries.length - 1];
    const support = findLevels(priceSeries)
      .filter((l) => l.kind === 'support' && l.price < price)
      .sort((a, b) => b.price - a.price)[0];
    if (!support) return null;
    return { price: support.price, pctBelow: ((price - support.price) / price) * 100 };
  }, [priceSeries]);
  const backtestInfo = useMemo(() => {
    const bt = analysis?.backtest;
    if (!bt || !bt.samples || bt.samples < 8) return null;
    const side = String(analysis.label ?? '').includes('ell') ? bt.sell : bt.buy;
    if (!side || side.total < 8 || side.edge === null || side.edge === undefined) return null;
    return { rate: side.rate, edge: side.edge, samples: side.total, base: bt.baseRate };
  }, [analysis]);
  const activeHorizons = useMemo(() => computeHorizonRisks({ series: priceSeries, analysis }), [priceSeries, analysis]);
  const layerRows = useMemo(() => {
    if (!read?.layers) return [];
    const order = ['technical', 'historical', 'structural', 'macro', 'derivatives'];
    return order
      .map((k) => ({ key: k, ...read.layers[k] }))
      .filter((l) => l && l.weight > 0);
  }, [read]);

  const watchedIds = useMemo(() => new Set(readWatchlist()), [watchVersion]);
  const filteredCards = tab === 'solana'
    ? solanaSignals // solana card list is rendered by its own component below
    : visibleSignals;

  const insightLabel = useMemo(() => (selectedSignal ? t(classKey(selectedSignal.classification)) : null), [selectedSignal, t]);
  const pulseLive = Boolean(pulse && (pulse.source === 'live' || pulse.source === 'market-only'));

  return (
    <PageTransition>
      {/* HERO */}
      <motion.section className="docs-hero" variants={riseIn} initial="hidden" animate="show" style={{ overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: -40, background: 'radial-gradient(600px 300px at 20% 0%, rgba(0,229,255,0.12), transparent 60%), radial-gradient(500px 280px at 90% 0%, rgba(124,77,255,0.12), transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div className="docs-hero-title" style={{ fontSize: 24 }}>{t('signals.title')}</div>
          <p className="docs-hero-sub" style={{ maxWidth: 'none', fontSize: 13, lineHeight: 1.9, whiteSpace: 'normal' }}>{t('signals.subtitle')}</p>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span className="pill pill-rgb" style={{ fontSize: 11, padding: '5px 10px' }}>✦ AI Powered</span>
            <span className="pill" style={{ background: pulseLive ? 'rgba(0,255,157,0.08)' : 'rgba(255,179,0,0.08)', borderColor: pulseLive ? 'rgba(0,255,157,0.16)' : 'rgba(255,179,0,0.16)', color: pulseLive ? 'var(--up)' : '#ffb300', fontSize: 11 }}>
              {t(`signals.intel.status.${pulseLive ? 'live' : pulse?.source === 'local' || pulse?.source === 'offline' ? 'offline' : 'unavailable'}`)}
            </span>
          </div>
        </div>
      </motion.section>

      {/* AI MARKET PULSE */}
      <PulseCard pulse={pulse} />

      {/* Horizon risk for the selected asset */}
      {analysis && <HorizonStrip horizons={activeHorizons} />}

      {/* Daily brief (existing) */}
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

      {/* TABS — Global Signals / Solana Signals (kept, labels upgraded) */}
      <motion.div className="wallet-pie-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16, padding: 14 }}>
        <div className="segmented" style={{ width: '100%', marginBottom: 12 }}>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => { haptic?.('select'); setTab('all'); }} style={{ isolation: 'isolate', flex: 1, minHeight: 38 }}>
            {tab === 'all' && <SegIndicator id="tab-all" />}
            {t('signals.allTab')}
          </button>
          <button className={tab === 'solana' ? 'active' : ''} onClick={() => { haptic?.('select'); setTab('solana'); }} style={{ isolation: 'isolate', flex: 1, minHeight: 38 }}>
            {tab === 'solana' && <SegIndicator id="tab-sol" />}
            {t('signals.solanaTab')}
          </button>
        </div>

        {/* SEARCH */}
        <div className="sic-search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('signals.intel.search.placeholder')}
            aria-label={t('signals.intel.search.label')}
          />
        </div>

        {/* FILTERS */}
        <FilterBar filters={filters} setFilters={setFilters} />

        {/* Cards */}
        <div style={{ marginTop: 14 }}>
          {tab === 'all' ? (
            filteredCards.length ? (
              <div className="sic-cards">
                {filteredCards.map((s) => (
                  <SignalCard
                    key={s.coin?.id}
                    signal={s}
                    selected={s.coin?.id === coinId}
                    onSelect={() => selectCard(s)}
                    onWhy={openWhy}
                    whyLoading={why?.signal?.coin?.id === s.coin?.id && why?.loading}
                    onAlert={onCardAction}
                    watched={watchedIds.has(s.coin?.id)}
                    onCompare={(sig) => navigate(`/coin/${sig.coin?.id}`)}
                    onTrack={() => document.getElementById('sic-history')?.scrollIntoView({ behavior: 'smooth' })}
                  />
                ))}
              </div>
            ) : (
              <div className="sic-insufficient">{t('signals.intel.search.noResults')}</div>
            )
          ) : (
            <div className="sic-cards">
              {solanaSignals.map(({ asset, smToken }) => (
                <SolanaSignalCard
                  key={asset.id}
                  asset={asset}
                  marketCoin={(coins ?? []).find((c) => c.id === asset.id) ?? null}
                  pulse={pulse}
                  smToken={smToken}
                  selected={asset.id === solanaId}
                  onSelect={() => selectCard({ coin: { id: asset.id, symbol: asset.symbol, name: asset.name } })}
                  onWhy={openWhy}
                  whyLoading={why?.signal?.coin?.id === asset.id && why?.loading}
                  onAlert={onCardAction}
                  watched={watchedIds.has(asset.id)}
                  onCompare={(sig) => navigate(`/coin/${sig.coin?.id}`)}
                  onTrack={() => document.getElementById('sic-history')?.scrollIntoView({ behavior: 'smooth' })}
                  search={search}
                  filters={filters}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* DETAIL LAB — the selected asset (existing gauge + breakdown, preserved) */}
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
                      {regime?.regime && (
                        <span className="pill" title={t(`signals.regime.${REGIME_LABEL[regime.regime]}`)} style={{ fontSize: 10, padding: '3px 8px', background: regime.regime === 'riskOff' || regime.regime === 'rotationOut' ? 'rgba(255,89,107,0.10)' : 'rgba(0,255,157,0.10)', borderColor: regime.regime === 'riskOff' || regime.regime === 'rotationOut' ? 'rgba(255,89,107,0.22)' : 'rgba(0,255,157,0.22)', color: regime.regime === 'riskOff' || regime.regime === 'rotationOut' ? 'var(--down)' : 'var(--up)' }}>
                          {t(`signals.regime.${REGIME_LABEL[regime.regime]}`)}
                        </span>
                      )}
                      {insightLabel && <span className="pill" style={{ fontSize: 10, fontWeight: 800, background: 'rgba(0,229,255,0.08)', borderColor: 'rgba(0,229,255,0.2)', color: 'var(--rgb-1)' }}>{insightLabel}</span>}
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

      {analysis && !scanning && (
        <motion.section className="wallet-pie-card" variants={stagger} initial="hidden" animate="show" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-3), var(--rgb-2))', color: '#fff', fontSize: 12 }}>◈</span>
            {t('signals.breakdown')}
          </div>

          {layerRows.length > 0 && (
            <SignalSection
              id="layers"
              defaultOpen
              title={t('signals.layerTitle')}
              summary={t('signals.acc.layersSummary', { n: layerRows.length })}
            >
              {layerRows.map((l) => (
                <LayerBar key={l.key} label={t(`verdict.layerName.${l.key}`)} score={l.score} weight={l.weight} />
              ))}
            </SignalSection>
          )}

          {perpForCoin && perpForCoin.avgFundingApr != null && (
            <SignalSection
              id="derivatives"
              title={t('signals.derivatives.title')}
              summary={`${perpForCoin.avgFundingApr > 0 ? '+' : ''}${Math.round(perpForCoin.avgFundingApr)}%`}
            >
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
            </SignalSection>
          )}

          {scenarios && scenarios.samples >= 20 && (
            <SignalSection
              id="scenarios"
              title={t('signals.scenarios.title')}
              summary={`▲ ${scenarios.pctUp}% · ▼ ${scenarios.pctDown}%`}
            >
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
            </SignalSection>
          )}

          {invalidation && (
            <SignalSection
              id="invalidation"
              title={t('signals.invalidation')}
              summary={`$${fmtPrice(invalidation.price)}`}
            >
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
            </SignalSection>
          )}

          {backtestInfo && (
            <SignalSection
              id="backtest"
              title={t('signals.backtestHistory')}
              summary={`${Math.round(backtestInfo.rate)}% · n=${backtestInfo.samples}`}
            >
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
            </SignalSection>
          )}

          {hasOnchain && (
            <SignalSection id="onchain" title={t('signals.onchain.title')}>
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
            </SignalSection>
          )}

          <SignalSection
            id="indicators"
            title={t('signals.acc.indicators')}
            summary={t('signals.acc.indicatorsSummary', { n: analysis.signals.length })}
          >
            {analysis.signals.map((s) => <IndicatorBar key={s.key} signal={s} />)}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
              {analysis.indicators.rsi != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>RSI (14)</div><div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{analysis.indicators.rsi.toFixed(1)}</div></div>}
              {analysis.indicators.volatility != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.volatility')}</div><div className="mono" style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{analysis.indicators.volatility.toFixed(0)}%</div></div>}
              {analysis.indicators.support != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.support')}</div><div className="mono up" style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>${fmtPrice(analysis.indicators.support)}</div></div>}
              {analysis.indicators.resistance != null && <div className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}><div className="faint" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>{t('signals.resistance')}</div><div className="mono down" style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>${fmtPrice(analysis.indicators.resistance)}</div></div>}
            </div>
          </SignalSection>

          <button className="btn btn-primary" style={{ width: '100%', minHeight: 46, borderRadius: 14, marginTop: 16 }} onClick={() => { haptic?.('select'); navigate(`/intent?to=${encodeURIComponent(coin?.symbol || '')}`); }}>
            {t('signals.createIntent')}
          </button>
        </motion.section>
      )}

      {/* AI OUTLOOK (existing) */}
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
            {HORIZONS.filter((h) => h.days !== 1).map((h) => (
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

      {/* AI EARLY SIGNALS */}
      <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 6 }}>
        <EarlySection early={early} />
      </motion.div>

      {/* SMART MONEY */}
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <SmartMoneySection sm={sm} />
      </motion.div>

      {/* MOMENTUM RADAR */}
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <MomentumSection cards={[...globalSignals].sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0))} />
      </motion.div>

      {/* SOLANA EARLY TOKEN RADAR */}
      {tab === 'solana' && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <RadarSection radar={radarPoll.data?.schema ? radarPoll.data : null} />
        </motion.div>
      )}

      {/* PORTFOLIO-AWARE */}
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <PortfolioCard
          impact={portfolioImpactData}
          consent={consent}
          onConsent={() => { const next = setConsent({ portfolioAi: !consent.portfolioAi }); setConsentState(next); haptic?.('select'); }}
        />
      </motion.div>

      {/* HISTORICAL LEARNING LOOP + PERFORMANCE */}
      <motion.div id="sic-history" variants={riseIn} initial="hidden" animate="show">
        <HistorySection history={history} perf={perf} priceMap={priceMap} />
      </motion.div>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <PerformanceSection perf={perf} />
      </motion.div>

      <InfoBox title={t('signals.disclaimerTitle')} tone="warn" id="signals-disclaimer" style={{ marginTop: 18 }}>
        <p style={{ fontSize: 12.5, lineHeight: 1.9 }}>{t('signals.intel.disclaimer')} — {t('signals.disclaimer')}</p>
      </InfoBox>

      {/* Actions / routing (kept) */}
      <div className="row" style={{ gap: 12, marginTop: 18 }}>
        <button className="btn btn-primary" style={{ flex: 1, minHeight: 46, borderRadius: 14 }} onClick={() => navigate(`/swap?coin=${activeId}`)}>{t('nav.swap')}</button>
        <button className="btn btn-ghost" style={{ flex: 1, minHeight: 46, borderRadius: 14 }} onClick={() => navigate(`/coin/${activeId}`)}>{t('signals.viewChart')}</button>
      </div>

      <WhyModal why={why} onClose={() => setWhy(null)} />
      <AlertSheet symbol={alertFor} onClose={() => setAlertFor(null)} />
    </PageTransition>
  );
}
