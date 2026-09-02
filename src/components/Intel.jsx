import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { IconExternal, IconRefresh } from './Icons';
import { freshnessLabel, sourceLabel } from '../lib/intelApi';
import { riseIn } from './PageTransition';

/**
 * INTEL SHARED UI — the small primitives Explore and Security Center share.
 *
 * Everything here is built from the classes FBT already has (.docs-card,
 * .pill, .section-label, .mono, .faint…) plus `intel-` scoped additions in
 * styles/intel.css. New colors: none — risk chips map onto --up/--rgb-5/
 * --down exactly as the rest of the app already does.
 */

export function SectionTabs({ tabs, active, onChange, ariaLabelKey = 'intel.sections' }) {
  const { t } = useTranslation();
  return (
    <div className="segmented intel-seg" role="tablist" aria-label={t(ariaLabelKey)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={active === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
          style={{ isolation: 'isolate' }}
          title={t(tab.labelKey)}
        >
          {tab.Icon && <tab.Icon width={14} height={14} aria-hidden="true" />}
          <span className="intel-seg-label">{t(tab.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

/** "Updated 14 seconds ago · source: blockchain RPC" — from server meta. */
export function MetaLine({ meta, style }) {
  const { t } = useTranslation();
  if (!meta) return null;
  return (
    <p className="faint intel-meta" style={style}>
      <span>{freshnessLabel(meta, t)}</span>
      <span aria-hidden="true"> · </span>
      <span>{sourceLabel(meta.source, t)}</span>
    </p>
  );
}

export function SourceBadge({ meta }) {
  const { t } = useTranslation();
  if (!meta?.source) return null;
  return <span className="pill pill-neutral intel-src">{sourceLabel(meta.source, t)}</span>;
}

/** The one place that renders LOW/MEDIUM/HIGH/UNKNOWN (never "safe"). */
export function LevelPill({ level, size = 'md' }) {
  const { t } = useTranslation();
  const key = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'].includes(String(level || '').toUpperCase())
    ? String(level).toUpperCase()
    : 'UNKNOWN';
  const emoji = key === 'LOW' ? '🟢' : key === 'MEDIUM' ? '🟡' : key === 'HIGH' ? '🔴' : '⚪';
  return (
    <span className={`pill intel-level intel-level-${key.toLowerCase()} ${size === 'sm' ? 'intel-level-sm' : ''}`}>
      <span aria-hidden="true">{emoji}</span> {t(`intel.level.${key.toLowerCase()}`)}
    </span>
  );
}

/** Status chips for evidence rows: PASS/INFO/LOW/MEDIUM/HIGH/UNKNOWN. */
export function StatusChip({ status }) {
  const { t } = useTranslation();
  const key = ['PASS', 'INFO', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'].includes(String(status || '').toUpperCase())
    ? String(status).toUpperCase()
    : 'UNKNOWN';
  return <span className={`pill pill-neutral intel-status intel-status-${key.toLowerCase()}`}>{t(`intel.status.${key.toLowerCase()}`)}</span>;
}

export function EmptyState({ icon = '○', title, note, action }) {
  return (
    <motion.div className="docs-card intel-empty" data-open="false" variants={riseIn} initial="hidden" animate="show">
      <div aria-hidden="true" style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
      {note && <p className="faint" style={{ margin: '6px 0 0', lineHeight: 1.7, fontSize: 12 }}>{note}</p>}
      {action}
    </motion.div>
  );
}

export function ErrorState({ code, onRetry, t }) {
  const msgKey =
    code === 'unavailable' || code === 'TIMEOUT' || code === 'NETWORK_UNREACHABLE' || code === 'RATE_LIMITED'
      ? 'intel.err.unavailable'
      : code === 'providerDown'
        ? 'intel.err.provider'
        : code === 'badInput'
          ? 'intel.err.badInput'
          : 'intel.err.unavailable';
  return (
    <div className="notice intel-err" role="alert">
      <span>{t(msgKey)}</span>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry} style={{ marginInlineStart: 8 }}>
          <IconRefresh width={13} height={13} /> {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function LoadingState({ label }) {
  const { t } = useTranslation();
  return (
    <div className="intel-loading" role="status" aria-live="polite">
      <span className="intel-dotpulse" aria-hidden="true"><i /><i /><i /></span>
      <span className="faint" style={{ fontSize: 12 }}>{label || t('common.loading')}</span>
    </div>
  );
}

export function StatTile({ label, value, mono = true, sub }) {
  return (
    <div className="intel-stat">
      <span className="faint intel-stat-label">{label}</span>
      <span className={mono ? 'mono intel-stat-value' : 'intel-stat-value'}>{value == null || value === '' ? <span className="faint">N/A</span> : value}</span>
      {sub ? <span className="faint" style={{ fontSize: 10.5 }}>{sub}</span> : null}
    </div>
  );
}

export function CopyRow({ label, value, mono = true, copyText, onOpen }) {
  const { t } = useTranslation();
  return (
    <div className="row-between" style={{ gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="faint" style={{ fontSize: 11.5, flexShrink: 0 }}>{label}</span>
      <span className="row" style={{ gap: 6, minWidth: 0 }}>
        <span className={mono ? 'mono' : ''} style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'ltr' }}>
          {value == null || value === '' ? <span className="faint">N/A</span> : value}
        </span>
        {onOpen && value != null && value !== '' && (
          <button type="button" className="icon-btn intel-copy" aria-label={t('intel.openLink')} onClick={onOpen} style={{ minWidth: 26, minHeight: 26, padding: 4 }}>
            <IconExternal width={12} height={12} />
          </button>
        )}
      </span>
    </div>
  );
}

/** Horizontal score meter — deliberately not a gauge with a green "SAFE" face. */
export function ScoreBar({ score, confidence, dataQuality, level }) {
  const { t } = useTranslation();
  const pct = score == null ? 0 : Math.max(0, Math.min(100, Number(score)));
  const hue = level === 'LOW' ? 'var(--up)' : level === 'MEDIUM' ? 'var(--rgb-5)' : level === 'HIGH' ? 'var(--down)' : 'var(--text-3)';
  return (
    <div className="intel-score" aria-label={t('intel.scoreAria', { score: score == null ? '—' : score, level: t(`intel.level.${String(level || 'unknown').toLowerCase()}`) })}>
      <div className="row-between" style={{ alignItems: 'baseline', gap: 8 }}>
        <span className="intel-score-num" style={{ color: hue }}>
          {score == null ? <span className="faint">—</span> : score}
          {score != null && <span className="faint" style={{ fontSize: 11 }}> / 100</span>}
        </span>
        <LevelPill level={level} size="sm" />
      </div>
      <div className="intel-score-track" role="presentation">
        <span style={{ width: `${pct}%`, background: hue }} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 10.5 }}>{t('intel.confidence')} {confidence == null ? '—' : `${Math.round(confidence * 100)}%`}</span>
        <span className="faint" style={{ fontSize: 10.5 }}>{t('intel.dataQuality')} {dataQuality ? t(`intel.quality.${String(dataQuality).toLowerCase()}`) : '—'}</span>
      </div>
    </div>
  );
}

export function Notices({ notices }) {
  const { t } = useTranslation();
  if (!Array.isArray(notices) || !notices.length) return null;
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      {notices.map((n, i) => (
        <p key={i} className="faint intel-notice" style={{ fontSize: 11, lineHeight: 1.6 }}>
          ⚠ {n.detail || n.code || t('intel.partial')}
        </p>
      ))}
    </div>
  );
}

export function ShortAddr({ value, size = 5, className = 'mono', onClick, title }) {
  if (!value) return <span className="faint">N/A</span>;
  const s = String(value);
  const text = s.length > 2 * size + 4 ? `${s.slice(0, size + 2)}…${s.slice(-size)}` : s;
  if (!onClick) return <span className={className} style={{ direction: 'ltr' }}>{text}</span>;
  return (
    <button type="button" className="intel-link mono" onClick={onClick} title={title || s} style={{ direction: 'ltr' }}>
      {text}
    </button>
  );
}

export function ChainDot({ color, short }) {
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: color || 'var(--text-3)', flexShrink: 0 }} />
      <span style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{short}</span>
    </span>
  );
}
