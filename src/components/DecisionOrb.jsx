import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { marketDecision } from '../lib/marketDecision';
import '../styles/decision-orb.css';

export default function DecisionOrb({ coins = [], updatedAt = 0, unavailable = false, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const toggleRef = useRef(null);
  const metrics = useMemo(() => marketDecision(coins), [coins]);
  const stale = unavailable || !updatedAt || now - updatedAt > 120000;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (e.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return createPortal(
    <aside className={`dor${open ? ' is-open' : ''}`} dir="rtl" aria-label="نبض بازار">
      <button ref={toggleRef} className="dor-toggle" type="button" aria-label={open ? 'بستن نبض بازار' : 'باز کردن نبض بازار'} aria-expanded={open} aria-controls="market-decision-rail" onClick={() => setOpen(v => !v)}>
        <span aria-hidden="true">{open ? '‹' : '›'}</span>
      </button>
      <div id="market-decision-rail" className="dor-rail" hidden={!open}>
        <span className="dor-caption">نبض<br />۲۴ ساعت</span>
        {metrics.map(metric => {
          const value = stale ? null : metric.value;
          return <div className="dor-metric" key={metric.key} title={`${metric.label} · ${metric.count} دارایی`}>
            <span className="dor-ring" style={{ '--ring-color': metric.color, '--ring-value': `${value === null ? 0 : Math.min(100, value)}%` }} aria-hidden="true"><span>{metric.icon}</span></span>
            <strong dir="ltr">{value === null ? '—' : `${value.toFixed(1)}%`}</strong>
            <span className="dor-label">{metric.label}</span>
          </div>;
        })}
        <span className="dor-status" role="status">{stale ? 'داده تازه نیست' : 'از داده بازار'}</span>
        <details className="dor-info"><summary aria-label="روش محاسبه">ⓘ</summary><p>خرید و فروش: سهم دارایی‌های صعودی و نزولی از {metrics[1].count} دارایی دارای تغییر قیمت ۲۴ ساعته؛ نه حجم معاملات خرید و فروش. دارایی‌های بدون تغییر در هیچ‌کدام نیستند. ریسک: میانگین دامنهٔ بالا تا پایین روز نسبت به کف قیمت، از {metrics[0].count} دارایی؛ نه احتمال زیان یا توصیهٔ معامله. دادهٔ قدیمی‌تر از دو دقیقه نمایش داده نمی‌شود.</p></details>
      </div>
    </aside>, document.body
  );
}
