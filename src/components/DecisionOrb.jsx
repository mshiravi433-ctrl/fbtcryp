import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { marketDecision } from '../lib/marketDecision';
import '../styles/decision-orb.css';

export default function DecisionOrb({ coins = [], updatedAt = 0, unavailable = false, onOpenChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const toggleRef = useRef(null);
  const metrics = useMemo(() => marketDecision(coins), [coins]);
  const stale = unavailable || !updatedAt || now - updatedAt > 120000;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const dismissOutside = (event) => {
      if (!event.target?.closest?.('.dor')) setOpen(false);
    };
    const timer = window.setTimeout(() => setOpen(false), 20_000);
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', dismissOutside, true);
    };
  }, [open]);
  return createPortal(
    <aside className={`dor${open ? ' is-open' : ''}`} dir={typeof document !== 'undefined' ? (document.documentElement.dir || 'ltr') : 'ltr'} aria-label={t('market.pulse.title')}>
      <button ref={toggleRef} className="dor-toggle" type="button" aria-label={open ? t('market.pulse.close') : t('market.pulse.open')} aria-expanded={open} aria-controls="market-decision-rail" onClick={() => setOpen(v => !v)}>
        <span aria-hidden="true">{open ? '‹' : '›'}</span>
      </button>
      <div id="market-decision-rail" className="dor-rail" hidden={!open}>
        <span className="dor-caption">{t('market.pulse.caption')}</span>
        {metrics.map(metric => {
          const value = stale ? null : metric.value;
          const label = t(`market.pulse.metric.${metric.key}`);
          return <div className="dor-metric" key={metric.key} title={t('market.pulse.metricTitle', { label, count: metric.count })}>
            <span className="dor-ring" style={{ '--ring-color': metric.color, '--ring-value': `${value === null ? 0 : Math.min(100, value)}%` }} aria-hidden="true"><span>{metric.icon}</span></span>
            <strong dir="ltr">{value === null ? '—' : `${value.toFixed(1)}%`}</strong>
            <span className="dor-label">{label}</span>
          </div>;
        })}
        <span className="dor-status" role="status">{stale ? t('market.pulse.stale') : t('market.pulse.live')}</span>
        <details className="dor-info"><summary aria-label={t('market.pulse.method')}>ⓘ</summary><p>{t('market.pulse.explanation', { moves: metrics[1].count, ranges: metrics[0].count })}</p></details>
      </div>
    </aside>, document.body
  );
}
