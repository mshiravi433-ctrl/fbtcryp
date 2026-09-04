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
import { analyze, projectRange } from '../lib/ai';
import { fmtPct, fmtPrice, fmtCompact, timeAgo } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { getMarketBrief, getOutlook } from '../lib/aiClient';
import SegIndicator from '../components/SegIndicator';
import {
  IconActivity,
  IconBell,
  IconClock,
  IconGlobe,
  IconSmartMoney,
  IconSparkle,
  IconTrend,
  IconWallet,
  IconX
} from '../components/Icons';
import { verdict } from '../lib/verdict';
import { useAppStore } from '../store/useAppStore';
import { POINT_VALUES } from '../lib/ranks';
import { scenarioSplit, findLevels } from '../lib/history';
import { SOLANA_SIGNAL_ASSETS, getSolanaIntel } from '../lib/solanaSignals';
import { getPerpMarkets } from '../lib/perp';
import { useLearningTelemetry } from '../hooks/telemetry';
import useLearningParams from '../hooks/useLearningParams';
import { useSettingsStore } from '../store/useSettingsStore';
import { fetchOverview } from '../lib/smartMoneyClient';
import { getSignalPulse, getSignalWhy } from '../lib/signalApi';
import { swapUrlFor } from '../lib/coinToSwap';
import {
  computeHorizonRisks, computeSignalCard, computeEarlySignals,
  computePulseLocal, portfolioImpact, rankSignals, classKey
} from '../lib/signalEngine';
import {
  readWatchlist, toggleWatch, createAlert, readAlerts, deleteAlert, saveAlerts,
  evaluateSignalAlerts, recordSignal, settleHistory, readHistory
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

function Chevron({ open, className = '' }) {
  return (
    <svg
      className={`sic-chevron ${open ? 'is-open' : ''} ${className}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PulseCard({ pulse, brief }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  if (!pulse) return null;
  const s = pulse.sentiment ?? {};
  const tone = s.label === 'bullish' ? 'bullish' : s.label === 'bearish' ? 'bearish' : 'neutral';
  const live = pulse.source === 'live' || pulse.source === 'market-only' || pulse.source === 'local';
  const liveTone = live ? 'bullet up' : '';
  const breadth = pulse.breadth;
  const avg = breadth?.avgChange;
  const turn = pulse.liquidity?.turnoverPct;
  return (
    <motion.section className={`sic-pulse ${open ? 'is-open' : ''}`} variants={riseIn} initial="hidden" animate="show">
      <button
        type="button"
        className="sic-pulse-toggle"
        aria-expanded={open}
        aria-controls="sic-pulse-content"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sic-head-icon"><IconActivity /></span>
        <span className="sic-pulse-copy">
          <span className="sic-pulse-title">{t('signals.intel.title')}</span>
          <span className="sic-pulse-subtitle">{t('signals.intel.subtitle')}</span>
        </span>
        <span className={`sic-badge ${tone}`}>
          <i className="sic-status-dot" aria-hidden="true" />
          {t(`signals.intel.sentimentLabel.${s.label || 'neutral'}`)}
        </span>
        <Chevron open={open} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="sic-pulse-content"
            key="pulse-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="sic-collapsible-body"
          >
            <div className="sic-pulse-content">
              <div className="sic-pulse-grid">
                <MetricTile k={t('signals.intel.sentiment')} v={`${s.score ?? '—'}/100`} />
                <MetricTile k={t('signals.intel.riskLevel')} v={t(`signals.intel.riskLabel.${(pulse.risk?.label || 'medium').toLowerCase()}`)} tone={pulse.risk?.label === 'HIGH' ? 'down' : pulse.risk?.label === 'LOW' ? 'up' : 'warn'} />
                <MetricTile k={t('signals.intel.aiConfidence')} v={`${pulse.aiConfidence ?? '—'}%`} tone={pulse.aiConfidence >= 70 ? 'up' : ''} />
                <MetricTile k={t('signals.intel.pulseMomentum')} v={`${t(`signals.intel.momentumLabel.${(pulse.momentum?.label || 'flat')}`)}${pulse.momentum?.direction === 'up' ? ' ↑' : pulse.momentum?.direction === 'down' ? ' ↓' : ''}`} tone={pulse.momentum?.direction === 'up' ? 'up' : pulse.momentum?.direction === 'down' ? 'down' : ''} />
                <MetricTile k={t('signals.intel.volatility')} v={t(`signals.intel.volLabel.${(pulse.volatility?.label || 'moderate')}`)} tone={pulse.volatility?.label === 'high' ? 'down' : pulse.volatility?.label === 'low' ? 'up' : 'warn'} />
                <MetricTile k={t('signals.intel.liquidity')} v={t(`signals.intel.liquidityLabel.${(pulse.liquidity?.label || 'adequate')}`)} tone={pulse.liquidity?.label === 'strong' ? 'up' : pulse.liquidity?.label === 'thin' ? 'down' : ''} />
                <MetricTile
                  k={t('signals.intel.breadth')}
                  v={breadth?.total ? `${breadth.up ?? 0}/${breadth.total}` : '—'}
                  tone={(breadth?.up ?? 0) > (breadth?.total ?? 0) / 2 ? 'up' : (breadth?.total ? 'down' : '')}
                />
                <MetricTile
                  k={t('signals.intel.avgChange')}
                  v={avg != null ? `${avg > 0 ? '+' : ''}${avg}%` : '—'}
                  tone={avg > 0 ? 'up' : avg < 0 ? 'down' : ''}
                />
                <MetricTile
                  k={t('signals.intel.turnover')}
                  v={turn != null ? `${turn}%` : '—'}
                />
              </div>

              {brief && (
                <div className="sic-daily-brief">
                  <div className="sic-daily-brief-head">
                    <span>{t('signals.dailyBrief')}</span>
                    <span className={`sic-bias ${brief.bias || 'neutral'}`}>{t(`signals.bias.${brief.bias || 'neutral'}`)}</span>
                  </div>
                  <strong>{brief.headline}</strong>
                  <p>{brief.summary}</p>
                </div>
              )}

              <div className="sic-pulse-meta">
                <span>
                  {t(`signals.intel.source.${pulse.source || 'unavailable'}`)}
                  {pulse.smartMoney?.dataStatus ? ` · ${t(`signals.intel.smartMoney.${pulse.smartMoney.dataStatus}`)}` : ''}
                </span>
                <span className={liveTone}>{t('signals.intel.lastUpdate')}: {timeAgo(pulse.lastUpdate || pulse.at)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

function WhyModal({ why, onClose }) {
  const { t } = useTranslation();
  if (!why) return null;
  const { signal, loading, data } = why;
  return (
    <div className="sic-modal-backdrop" role="presentation" onClick={onClose}>
      <motion.div className="sic-modal" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 className="sic-modal-title"><IconSparkle /> {t('signals.intel.why.title')}</h3>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
              {signal?.coin?.symbol} · {t(classKey(signal?.classification))} · {signal?.confidence}%
            </div>
          </div>
          <button type="button" className="sic-icon-btn" onClick={onClose} aria-label={t('signals.intel.actions.close')}><IconX /></button>
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
                <span className="pill pill-down sic-warning-pill"><b aria-hidden="true">!</b> {t('signals.intel.why.disagreement')}</span>
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
          <h3 className="sic-modal-title"><IconBell /> {t('signals.intel.alert.title')} · {symbol}</h3>
          <button type="button" className="sic-icon-btn" onClick={onClose} aria-label={t('signals.intel.actions.close')}><IconX /></button>
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
              <div className="field-label">{t('signals.intel.alert.value')}</div>
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

function EarlySection({ early, embedded = false }) {
  const { t } = useTranslation();
  return (
    <section className={embedded ? 'sic-embedded-section' : ''}>
      {!embedded && (
        <div className="sic-section-head">
          <span className="cap"><IconSparkle /></span>
          <div>
            <div className="title">{t('signals.intel.early.title')}</div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.early.subtitle')}</div>
          </div>
        </div>
      )}
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

function SmartMoneySection({ sm, embedded = false }) {
  const { t } = useTranslation();
  if (!sm || !sm.tokenActivity?.length) {
    return (
      <section className={embedded ? 'sic-embedded-section' : ''}>
        {!embedded && <div className="sic-section-head"><span className="cap"><IconSmartMoney /></span><div className="title">{t('signals.intel.smartMoney.title')}</div></div>}
        <div className="sic-insufficient">{t('signals.intel.smartMoney.unavailable')}</div>
      </section>
    );
  }
  const m = sm.metrics || {};
  return (
    <section className={embedded ? 'sic-embedded-section' : ''}>
      {!embedded && (
        <div className="sic-section-head">
          <span className="cap"><IconSmartMoney /></span>
          <div>
            <div className="title">{t('signals.intel.smartMoney.title')}</div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.smartMoney.subtitle')}</div>
          </div>
        </div>
      )}
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

function MomentumSection({ cards, embedded = false }) {
  const { t } = useTranslation();
  const rows = (cards ?? []).filter((s) => s.status === 'READY').slice(0, 6);
  return (
    <section className={embedded ? 'sic-embedded-section' : ''}>
      {!embedded && (
        <div className="sic-section-head">
          <span className="cap"><IconTrend /></span>
          <div>
            <div className="title">{t('signals.intel.momentum.title')}</div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.momentum.subtitle')}</div>
          </div>
        </div>
      )}
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

function HistorySection({ history, embedded = false }) {
  const { t } = useTranslation();
  const rows = [...history].reverse().slice(0, 8);
  return (
    <section className={embedded ? 'sic-embedded-section' : ''}>
      {!embedded && (
        <div className="sic-section-head">
          <span className="cap"><IconClock /></span>
          <div>
            <div className="title">{t('signals.intel.history.title')}</div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('signals.intel.history.subtitle')}</div>
          </div>
        </div>
      )}
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
    </section>
  );
}

function PortfolioCard({ impact, embedded = false }) {
  const { t } = useTranslation();
  const tone = impact?.impact === 'HIGH' ? 'down' : impact?.impact === 'MEDIUM' ? 'warn' : 'up';
  return (
    <section className={embedded ? 'sic-embedded-section' : ''}>
      {!embedded && (
        <div className="sic-section-head">
          <span className="cap"><IconWallet /></span>
          <div className="title">{t('signals.intel.portfolio.title')}</div>
        </div>
      )}
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
    </section>
  );
}

function StarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z" />
    </svg>
  );
}

function SolanaIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6.2 5.5h12.3l-2.7 3H3.5l2.7-3Z" />
      <path d="M5.5 10.5h12.3l2.7 3H8.2l-2.7-3Z" />
      <path d="M6.2 15.5h12.3l-2.7 3H3.5l2.7-3Z" />
    </svg>
  );
}

function TokenPicker({ coin, options, value, onChange }) {
  const { t } = useTranslation();
  const available = options.length ? options : (coin ? [{ id: coin.id, symbol: coin.symbol, name: coin.name }] : []);
  return (
    <label className="sic-token-picker">
      <span className="sic-token-picker-label">{t('signals.intel.assetPicker.label')}</span>
      <span className="sic-token-select-shell">
        <CoinLogo coin={coin} px={34} />
        <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={t('signals.intel.assetPicker.label')}>
          {available.map((option) => (
            <option key={option.id} value={option.id}>
              {option.symbol}{option.name ? ` · ${option.name}` : ''}
            </option>
          ))}
        </select>
        <Chevron />
      </span>
    </label>
  );
}

function SelectedSignalCard({ coin, signal, analysis, scanning, watched, whyLoading, onWhy, onWatch, onAlert }) {
  const { t } = useTranslation();
  const ready = signal?.status === 'READY';
  const risk = (signal?.risk || 'MEDIUM').toLowerCase();

  if (!coin) return <div className="sic-insufficient sic-token-empty">{t('signals.intel.card.insufficientBody')}</div>;

  return (
    <section className="sic-card sic-focus-card" data-testid="selected-signal-card" aria-live="polite">
      {scanning || !analysis || !coin ? (
        <div className="sic-focus-loading">
          <motion.span className="sic-spinner" animate={{ rotate: 360 }} transition={{ duration: 1.05, repeat: Infinity, ease: 'linear' }} />
          <span>{t('signals.analyzing')}</span>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={coin.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
            <div className="sic-focus-head">
              <div className="sic-focus-asset">
                <CoinLogo coin={coin} px={42} />
                <div>
                  <div className="sic-focus-symbol"><b>{coin.symbol}</b></div>
                  <span className="sic-focus-name">{coin.name}</span>
                </div>
              </div>
              <div className="sic-focus-price">
                <b>${fmtPrice(coin.price)}</b>
                <span className={(coin.change24h ?? 0) >= 0 ? 'up' : 'down'}>{fmtPct(coin.change24h ?? 0)}</span>
              </div>
            </div>

            <div className="sic-focus-overview">
              <Gauge score={analysis.score} label={analysis.label} confidence={analysis.confidence} />
              {ready ? (
                <div className="sic-focus-metrics">
                  <MetricTile
                    k={t('signals.intel.card.risk')}
                    v={t(`signals.intel.riskLabel.${risk}`)}
                    tone={risk === 'high' ? 'down' : risk === 'low' ? 'up' : 'warn'}
                  />
                  <MetricTile k={t('signals.intel.card.timeframe')} v={t('signals.intel.card.timeframeLabel', { d: signal.timeframe })} />
                  <MetricTile k={t('signals.intel.card.target')} v={signal.targetPct != null ? `+${signal.targetPct}%` : '—'} tone="up" />
                  <MetricTile k={t('signals.intel.card.stop')} v={signal.stopPct != null ? `-${signal.stopPct}%` : '—'} tone="down" />
                </div>
              ) : (
                <div className="sic-insufficient">
                  <strong>{t('signals.intel.card.insufficient')}</strong>
                  <span>{t('signals.intel.card.insufficientBody')}</span>
                </div>
              )}
            </div>

            {ready && <EvidenceChips evidence={signal.evidence} max={4} />}

            <div className="sic-focus-actions">
              <button type="button" className="sic-btn primary" disabled={!ready} onClick={() => onWhy(signal)}>
                <IconSparkle />
                <span>{whyLoading ? t('signals.intel.why.loading') : t('signals.intel.card.why')}</span>
              </button>
              <button type="button" className={`sic-icon-btn ${watched ? 'active' : ''}`} disabled={!ready} onClick={() => onWatch(signal)} title={t(watched ? 'signals.intel.actions.watched' : 'signals.intel.actions.watch')} aria-label={t(watched ? 'signals.intel.actions.watched' : 'signals.intel.actions.watch')}>
                <StarIcon />
              </button>
              <button type="button" className="sic-icon-btn" disabled={!ready} onClick={() => onAlert(signal)} title={t('signals.intel.actions.alert')} aria-label={t('signals.intel.actions.alert')}>
                <IconBell />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </section>
  );
}

function SignalBreakdown({
  analysis,
  activeHorizons,
  layerRows,
  perpForCoin,
  scenarios,
  horizon,
  invalidation,
  backtestInfo,
  hasOnchain,
  intel
}) {
  const { t } = useTranslation();
  if (!analysis) return <div className="sic-insufficient">{t('signals.intel.card.insufficient')}</div>;

  return (
    <div className="sic-breakdown">
      <HorizonStrip horizons={activeHorizons} />

      {layerRows.length > 0 && (
        <SignalSection
          id="layers"
          title={t('signals.layerTitle')}
          summary={t('signals.acc.layersSummary', { n: layerRows.length })}
        >
          {layerRows.map((layer) => (
            <LayerBar key={layer.key} label={t(`verdict.layerName.${layer.key}`)} score={layer.score} weight={layer.weight} />
          ))}
        </SignalSection>
      )}

      {perpForCoin && perpForCoin.avgFundingApr != null && (
        <SignalSection
          id="derivatives"
          title={t('signals.derivatives.title')}
          summary={`${perpForCoin.avgFundingApr > 0 ? '+' : ''}${Math.round(perpForCoin.avgFundingApr)}%`}
        >
          <div className="sic-pair-grid">
            <div>
              <div className="faint sic-mini-label">{t('signals.derivatives.funding')}</div>
              <div className={`mono sic-mini-value ${perpForCoin.avgFundingApr >= 0 ? 'up' : 'down'}`}>
                {perpForCoin.avgFundingApr > 0 ? '+' : ''}{Math.round(perpForCoin.avgFundingApr)}%
              </div>
            </div>
            {perpForCoin.openInterestUsd != null && (
              <div className="sic-align-end">
                <div className="faint sic-mini-label">{t('signals.derivatives.openInterest')}</div>
                <div className="mono sic-mini-value">${fmtCompact(perpForCoin.openInterestUsd)}</div>
              </div>
            )}
          </div>
        </SignalSection>
      )}

      {scenarios && scenarios.samples >= 20 && (
        <SignalSection
          id="scenarios"
          title={t('signals.scenarios.title')}
          summary={`↑ ${scenarios.pctUp}% · ↓ ${scenarios.pctDown}%`}
        >
          <div className="sic-scenario-track">
            <motion.i initial={{ width: 0 }} animate={{ width: `${scenarios.pctUp}%` }} transition={{ duration: 0.7 }} className="up" />
            <motion.i initial={{ width: 0 }} animate={{ width: `${scenarios.pctNeutral}%` }} transition={{ duration: 0.7 }} className="neutral" />
            <motion.i initial={{ width: 0 }} animate={{ width: `${scenarios.pctDown}%` }} transition={{ duration: 0.7 }} className="down" />
          </div>
          <div className="sic-scenario-legend">
            <span className="up">↑ {scenarios.pctUp}% {t('signals.scenarios.bullish')}</span>
            <span className="faint">{scenarios.pctNeutral}% {t('signals.scenarios.neutral')}</span>
            <span className="down">↓ {scenarios.pctDown}% {t('signals.scenarios.bearish')}</span>
          </div>
          <div className="faint sic-panel-note">{t('signals.scenarios.hint', { n: scenarios.samples, d: horizon.days })}</div>
        </SignalSection>
      )}

      {invalidation && (
        <SignalSection id="invalidation" title={t('signals.invalidation')} summary={`$${fmtPrice(invalidation.price)}`}>
          <div className="row-between">
            <div>
              <div className="faint sic-mini-label">{t('signals.invalidation')}</div>
              <div className="mono down sic-mini-value">${fmtPrice(invalidation.price)}</div>
            </div>
            <div className="sic-align-end">
              <div className="faint sic-mini-label">{t('signals.invalidationBelow')}</div>
              <div className="mono sic-mini-value">-{fmtPct(invalidation.pctBelow)}</div>
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
          <div className="sic-triple-grid">
            <div><b className="mono up">{Math.round(backtestInfo.rate)}%</b><span>{t('signals.backtestHitRate')}</span></div>
            <div><b className={`mono ${backtestInfo.edge >= 0 ? 'up' : 'down'}`}>{backtestInfo.edge >= 0 ? '+' : ''}{Math.round(backtestInfo.edge)}pp</b><span>{t('signals.backtestEdge')}</span></div>
            <div><b className="mono">{backtestInfo.samples}</b><span>{t('signals.backtestSamples')}</span></div>
          </div>
          <div className="faint sic-panel-note">{t('signals.backtestHint', { base: Math.round(backtestInfo.base) })}</div>
        </SignalSection>
      )}

      {hasOnchain && (
        <SignalSection id="onchain" title={t('signals.onchain.title')}>
          <div className="sic-key-value-list">
            {intel.whaleFlow?.direction && <div><span>{t('signals.onchain.whaleFlow')}</span><b className={`mono ${intel.whaleFlow.direction === 'outflow' ? 'down' : intel.whaleFlow.direction === 'inflow' ? 'up' : ''}`}>{t(`signals.onchain.flow.${intel.whaleFlow.direction}`)}</b></div>}
            {intel.holderTrend?.change && <div><span>{t('signals.onchain.holderTrend')}</span><b className={`mono ${intel.holderTrend.change === 'rising' ? 'down' : 'up'}`}>{t(`signals.onchain.trend.${intel.holderTrend.change}`)}</b></div>}
            {intel.topHolderPct != null && <div><span>{t('signals.onchain.topHolder')}</span><b className="mono">{intel.topHolderPct}%</b></div>}
            {intel.dexActivity?.pressure && <div><span>{t('signals.onchain.dexActivity')}</span><b className={`mono ${intel.dexActivity.pressure === 'buy' ? 'up' : intel.dexActivity.pressure === 'sell' ? 'down' : ''}`}>{t(`signals.onchain.pressure.${intel.dexActivity.pressure}`)}</b></div>}
          </div>
        </SignalSection>
      )}

      <SignalSection id="indicators" title={t('signals.acc.indicators')} summary={t('signals.acc.indicatorsSummary', { n: analysis.signals.length })}>
        {analysis.signals.map((signal) => <IndicatorBar key={signal.key} signal={signal} />)}
        <div className="sic-indicator-grid">
          {analysis.indicators.rsi != null && <div className="sic-data-cell"><span>RSI (14)</span><b className="mono">{analysis.indicators.rsi.toFixed(1)}</b></div>}
          {analysis.indicators.volatility != null && <div className="sic-data-cell"><span>{t('signals.volatility')}</span><b className="mono">{analysis.indicators.volatility.toFixed(0)}%</b></div>}
          {analysis.indicators.support != null && <div className="sic-data-cell"><span>{t('signals.support')}</span><b className="mono up">${fmtPrice(analysis.indicators.support)}</b></div>}
          {analysis.indicators.resistance != null && <div className="sic-data-cell"><span>{t('signals.resistance')}</span><b className="mono down">${fmtPrice(analysis.indicators.resistance)}</b></div>}
        </div>
      </SignalSection>
    </div>
  );
}

function AiAnalysisPanel({ outlook, aiLoading, aiError, horizon, setHorizon }) {
  const { t } = useTranslation();
  return (
    <div className="sic-ai-panel">
      <div className="sic-ai-panel-head">
        <span>{outlook?.source === 'local' ? t('signals.outlookLocal') : t('signals.aiOutlook')}</span>
        {outlook && <span className={`sic-bias ${outlook.bias || 'neutral'}`}>{t(`signals.bias.${outlook.bias || 'neutral'}`)} · {outlook.confidence}%</span>}
      </div>
      <div className="segmented sic-horizon-tabs">
        {HORIZONS.filter((item) => item.days !== 1).map((item) => (
          <button key={item.key} type="button" className={horizon.key === item.key ? 'active' : ''} onClick={() => setHorizon(item)}>
            {horizon.key === item.key && <SegIndicator id="hz-outlook" />}
            {t(item.key === '7D' ? 'signals.horizon.weekly' : 'signals.horizon.monthly')}
          </button>
        ))}
      </div>

      {aiLoading && (
        <div className="stack sic-ai-loading">
          {[92, 78, 60].map((width) => <motion.div key={width} className="skel" style={{ height: 11, width: `${width}%`, borderRadius: 8 }} animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} />)}
          <span className="faint">{t('signals.aiThinking')}</span>
        </div>
      )}
      {aiError && <p className="notice">{t('signals.aiUnavailable')}</p>}
      {!aiLoading && !aiError && !outlook && <div className="sic-insufficient">{t('signals.aiUnavailable')}</div>}

      {outlook && !aiLoading && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h3 className="sic-ai-headline">{outlook.headline}</h3>
          <p className="sic-ai-summary">{outlook.summary}</p>
          {outlook.range?.low != null && (
            <InfoBox title={t('signals.projectionTitle')} tone="info" id="sig-proj-box">
              <div className="sic-projection-row">
                <span>{t('signals.aiRange', { d: outlook.range.horizonDays })}</span>
                <b className="mono">${fmtPrice(outlook.range.low)} – ${fmtPrice(outlook.range.high)}</b>
              </div>
            </InfoBox>
          )}
          {outlook.drivers?.length > 0 && (
            <div className="sic-ai-list">
              <div className="field-label">{t('signals.drivers')}</div>
              {outlook.drivers.map((driver, index) => <p key={index} className="support"><i aria-hidden="true">↑</i><span>{driver}</span></p>)}
            </div>
          )}
          {outlook.risks?.length > 0 && (
            <div className="sic-ai-list">
              <div className="field-label">{t('signals.risks')}</div>
              {outlook.risks.map((riskItem, index) => <p key={index} className="risk"><i aria-hidden="true">↓</i><span>{riskItem}</span></p>)}
            </div>
          )}
          {outlook.invalidation && <p className="notice sic-ai-invalidation"><strong>{t('signals.invalidation')}:</strong> {outlook.invalidation}</p>}
          <div className="faint sic-ai-meta">{outlook.source === 'local' ? t('signals.aiMetaLocal') : t('signals.aiMeta', { model: outlook.model })}</div>
        </motion.div>
      )}
    </div>
  );
}

function IntelligenceHub({ early, sm, momentumCards, portfolioImpactData, history }) {
  const { t } = useTranslation();
  const still = useStill();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('early');
  const tabs = [
    { id: 'early', label: t('signals.intel.early.title'), subtitle: t('signals.intel.early.subtitle'), Icon: IconSparkle },
    { id: 'smartMoney', label: t('signals.intel.smartMoney.title'), subtitle: t('signals.intel.smartMoney.subtitle'), Icon: IconSmartMoney },
    { id: 'momentum', label: t('signals.intel.momentum.title'), subtitle: t('signals.intel.momentum.subtitle'), Icon: IconTrend },
    { id: 'portfolio', label: t('signals.intel.portfolio.title'), subtitle: t('signals.intel.portfolio.subtitle'), Icon: IconWallet },
    { id: 'history', label: t('signals.intel.history.title'), subtitle: t('signals.intel.history.subtitle'), Icon: IconClock }
  ];
  const selected = tabs.find((item) => item.id === active) || tabs[0];
  const moveTab = (event, index) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setActive(next.id);
    requestAnimationFrame(() => document.getElementById(`sic-tab-${next.id}`)?.focus());
  };
  const panels = {
    early: <EarlySection early={early} embedded />,
    smartMoney: <SmartMoneySection sm={sm} embedded />,
    momentum: <MomentumSection cards={momentumCards} embedded />,
    portfolio: <PortfolioCard impact={portfolioImpactData} embedded />,
    history: <HistorySection history={history} embedded />
  };

  return (
    <motion.section className={`sic-hub ${open ? 'is-open' : ''}`} variants={riseIn} initial="hidden" animate="show">
      <button type="button" className="sic-hub-toggle" aria-expanded={open} aria-controls="sic-hub-content" onClick={() => setOpen((value) => !value)}>
        <span className="sic-head-icon"><IconSparkle /></span>
        <span className="sic-hub-copy">
          <strong>{t('signals.intel.hub.title')}</strong>
          <small>{t('signals.intel.hub.subtitle')}</small>
        </span>
        <span className="sic-hub-summary">{t('signals.intel.hub.summary', { n: tabs.length })}</span>
        <Chevron open={open} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="sic-hub-content"
            key="hub-content"
            initial={still ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={still ? { duration: 0 } : { duration: 0.24, ease: 'easeOut' }}
            className="sic-collapsible-body"
          >
            <div className="sic-hub-layout">
              <div className="sic-tab-rail" role="tablist" aria-orientation="vertical" aria-label={t('signals.intel.hub.title')}>
                {tabs.map(({ id, label, Icon }, index) => (
                  <button
                    type="button"
                    key={id}
                    id={`sic-tab-${id}`}
                    role="tab"
                    aria-selected={active === id}
                    aria-controls={`sic-panel-${id}`}
                    tabIndex={active === id ? 0 : -1}
                    className={active === id ? 'active' : ''}
                    onClick={() => setActive(id)}
                    onKeyDown={(event) => moveTab(event, index)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="sic-hub-panel" id={`sic-panel-${active}`} role="tabpanel" aria-labelledby={`sic-tab-${active}`} tabIndex={0}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={active} initial={still ? false : { opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }} transition={{ duration: still ? 0 : 0.16 }}>
                    <div className="sic-hub-panel-head">
                      <span className="sic-panel-icon"><selected.Icon /></span>
                      <div><h3>{selected.label}</h3><p>{selected.subtitle}</p></div>
                    </div>
                    {panels[active]}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
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
  const [detailTab, setDetailTab] = useState('breakdown');
  const [scanning, setScanning] = useState(true);
  const [outlook, setOutlook] = useState(null);
  const [brief, setBrief] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const [why, setWhy] = useState(null);
  const [alertFor, setAlertFor] = useState(null);
  const [watchVersion, setWatchVersion] = useState(0);
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
  const sm = smPoll.data;
  const pulse = useMemo(() => {
    const srv = pulsePoll.data?.sentiment ? pulsePoll.data : null;
    if (srv && (srv.source === 'live' || srv.source === 'market-only')) return srv;
    const local = computePulseLocal({ global, markets: coins ?? [], smartMoney: sm, now: Date.now() });
    return local || srv || null;
  }, [pulsePoll.data, global, coins, sm]);

  const coin = useMemo(() => {
    if (tab === 'solana') return solanaCoin ?? (coins ?? []).find((c) => c.id === activeId) ?? null;
    return (coins ?? []).find((c) => c.id === coinId) ?? null;
  }, [tab, solanaCoin, coins, coinId, activeId]);

  const priceSeries = useMemo(() => (chart?.length ? chart.map((p) => p.p) : (coin?.sparkline ?? [])), [chart, coin]);
  const btcSeries = useMemo(() => (btcChart ?? []).map((p) => p.p), [btcChart]);
  const analysis = useMemo(() => (priceSeries.length ? analyze(priceSeries, coin ?? {}) : null), [priceSeries, coin]);
  const projection = useMemo(() => (analysis ? projectRange(analysis, horizon.days) : null), [analysis, horizon]);

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

  /* One picker, one active token. Bitcoin stays first and selected by default
     in the global view; Solana stays first in the Solana view. */
  const globalOptions = useMemo(() => {
    return [...globalSignals]
      .sort((a, b) => (a.coin?.id === 'bitcoin' ? -1 : b.coin?.id === 'bitcoin' ? 1 : 0))
      .map((signal) => ({ id: signal.coin.id, symbol: signal.coin.symbol, name: signal.coin.name }));
  }, [globalSignals]);
  const solanaOptions = useMemo(() => SOLANA_SIGNAL_ASSETS.map((asset) => {
    const marketCoin = (coins ?? []).find((item) => item.id === asset.id);
    return { id: asset.id, symbol: asset.symbol, name: marketCoin?.name || '' };
  }), [coins]);
  const tokenOptions = tab === 'solana' ? solanaOptions : globalOptions;

  useEffect(() => {
    if (tab !== 'all' || !globalOptions.length || globalOptions.some((option) => option.id === coinId)) return;
    setCoinId(globalOptions.find((option) => option.id === 'bitcoin')?.id || globalOptions[0].id);
  }, [tab, globalOptions, coinId]);

  /* The selected Solana asset's on-chain data is fetched only when needed. */
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

  const selectedSignal = useMemo(() => {
    if (tab === 'all') return globalSignals.find((signal) => signal.coin?.id === coinId) ?? null;
    if (!coin) return null;
    if (!analysis || priceSeries.length < 30 || !Number.isFinite(coin.price) || coin.price <= 0) {
      return { status: 'INSUFFICIENT_DATA', at: Date.now(), coin };
    }
    return computeSignalCard({
      coin,
      series: priceSeries,
      analysis,
      solanaIntel: intel,
      smToken: smBySymbol.get(coin.symbol),
      pulse,
      now: Date.now()
    });
  }, [tab, globalSignals, coinId, coin, analysis, priceSeries, intel, smBySymbol, pulse]);

  const portfolioImpactData = useMemo(
    () => (selectedSignal?.status === 'READY'
      ? portfolioImpact({ positions, priceMap, coin: selectedSignal.coin, classification: selectedSignal.classification })
      : null),
    [selectedSignal, positions, priceMap]
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

  const selectToken = (id) => {
    haptic?.('select');
    if (tab === 'all') setCoinId(id);
    else setSolanaId(id);
  };

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
  const pulseLive = Boolean(pulse && (pulse.source === 'live' || pulse.source === 'market-only'));
  const momentumCards = useMemo(
    () => [...globalSignals].sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0)),
    [globalSignals]
  );

  return (
    <PageTransition className="page sic-page">
      <motion.section className="sic-page-hero" variants={riseIn} initial="hidden" animate="show">
        <span className="sic-hero-icon"><IconSparkle /></span>
        <div className="sic-hero-copy">
          <h1>{t('signals.title')}</h1>
          <p>{t('signals.subtitle')}</p>
        </div>
        <div className="sic-hero-status">
          <span>{t('signals.aiPowered')}</span>
          <i className={pulseLive ? 'live' : 'offline'}>
            <b aria-hidden="true" />
            {t(`signals.intel.status.${pulseLive ? 'live' : pulse?.source === 'local' || pulse?.source === 'offline' ? 'offline' : 'unavailable'}`)}
          </i>
        </div>
      </motion.section>

      <PulseCard pulse={pulse} brief={brief} />

      <motion.section className="sic-workspace" variants={riseIn} initial="hidden" animate="show">
        <div className="sic-market-tabs" role="tablist" aria-label={t('signals.intel.assetPicker.marketLabel')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            className={tab === 'all' ? 'active' : ''}
            onClick={() => { haptic?.('select'); setTab('all'); }}
          >
            <IconGlobe />
            <span>{t('signals.allTab')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'solana'}
            className={tab === 'solana' ? 'active' : ''}
            onClick={() => { haptic?.('select'); setTab('solana'); }}
          >
            <SolanaIcon />
            <span>{t('signals.solanaTab')}</span>
          </button>
        </div>

        <TokenPicker coin={coin} options={tokenOptions} value={activeId} onChange={selectToken} />

        <SelectedSignalCard
          coin={coin}
          signal={selectedSignal}
          analysis={analysis}
          scanning={scanning}
          watched={watchedIds.has(activeId)}
          whyLoading={why?.signal?.coin?.id === activeId && why?.loading}
          onWhy={openWhy}
          onWatch={(signal) => onCardAction('watch', signal)}
          onAlert={(signal) => onCardAction('alert', signal)}
        />

        <div className="sic-detail-box">
          <div className="sic-detail-tabs" role="tablist" aria-label={t('signals.intel.detailTabs.label')}>
            <button
              type="button"
              id="sic-detail-tab-breakdown"
              role="tab"
              aria-controls="sic-detail-panel"
              aria-selected={detailTab === 'breakdown'}
              className={detailTab === 'breakdown' ? 'active' : ''}
              onClick={() => setDetailTab('breakdown')}
            >
              <IconActivity />
              <span>{t('signals.breakdown')}</span>
            </button>
            <button
              type="button"
              id="sic-detail-tab-ai"
              role="tab"
              aria-controls="sic-detail-panel"
              aria-selected={detailTab === 'ai'}
              className={detailTab === 'ai' ? 'active' : ''}
              onClick={() => setDetailTab('ai')}
            >
              <IconSparkle />
              <span>{t('signals.aiOutlook')}</span>
            </button>
          </div>

          <div
            id="sic-detail-panel"
            className="sic-detail-panel"
            role="tabpanel"
            aria-labelledby={detailTab === 'breakdown' ? 'sic-detail-tab-breakdown' : 'sic-detail-tab-ai'}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={detailTab} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.16 }}>
                {detailTab === 'breakdown' ? (
                  <SignalBreakdown
                    analysis={analysis}
                    activeHorizons={activeHorizons}
                    layerRows={layerRows}
                    perpForCoin={perpForCoin}
                    scenarios={scenarios}
                    horizon={horizon}
                    invalidation={invalidation}
                    backtestInfo={backtestInfo}
                    hasOnchain={hasOnchain}
                    intel={intel}
                  />
                ) : (
                  <AiAnalysisPanel outlook={outlook} aiLoading={aiLoading} aiError={aiError} horizon={horizon} setHorizon={setHorizon} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="sic-workspace-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/intent?to=${encodeURIComponent(coin?.symbol || '')}`)}>{t('signals.createIntent')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/coin/${activeId}`)}>{t('signals.viewChart')}</button>
        </div>
      </motion.section>

      <AdBanner slot="swap" />

      <IntelligenceHub
        early={early}
        sm={sm}
        momentumCards={momentumCards}
        portfolioImpactData={portfolioImpactData}
        history={history}
      />

      <InfoBox title={t('signals.disclaimerTitle')} tone="warn" id="signals-disclaimer" style={{ marginTop: 2 }}>
        <p style={{ fontSize: 12.5, lineHeight: 1.9 }}>{t('signals.intel.disclaimer')} — {t('signals.disclaimer')}</p>
      </InfoBox>

      <WhyModal why={why} onClose={() => setWhy(null)} />
      <AlertSheet symbol={alertFor} onClose={() => setAlertFor(null)} />
    </PageTransition>
  );
}
