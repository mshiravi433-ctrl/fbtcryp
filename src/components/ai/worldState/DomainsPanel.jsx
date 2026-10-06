/**
 * PANEL 8 — DATA DOMAINS.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «حوزه‌های داده: باکس‌ها شلوغ‌اند و فارسی با رشتهٔ خام
 * قاطی شده؛ هر ردیف یک باکس بلند و کشیده باشد؛ با لمس هر کدام صفحه ارور
 * می‌دهد».
 *
 *   · THE CRASH: the row renderer called `L(...)` without receiving it, so
 *     opening any domain that carried rows threw a ReferenceError and the
 *     error boundary showed «page encountered a problem». `L` is now passed
 *     explicitly, and the whole panel is covered by a render probe that opens
 *     every domain.
 *   · ONE WIDE ROW PER DOMAIN: icon · name and role · a one-sentence headline of
 *     what the domain returned · up to three stat chips · status. The row is the
 *     tap target; the details open IN PLACE under it (an accordion), so the page
 *     never jumps to a separate block.
 *   · NO RAW CODES: statuses, reasons, sources, topics, chain names and
 *     instrument names all arrive in Persian (worldModel.buildDomainsView);
 *     tickers and numbers stay inside LTR chips.
 * A domain with nothing usable states its reason in words — never a fabricated
 * number, and never an unexplained «دادهٔ کافی نیست».
 */
import { useMemo, useState } from 'react';
import { buildDomainsView, usdCompact, usdFaCompact } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct, timeAgo, priceText } from './format.jsx';
import { Ltr } from './parts.jsx';

/* one accent pair + icon per domain, so the list is varied — never all-purple */
const FACE = {
  smart_money: { icon: 'brain', acc1: '#a78bfa', acc2: '#7c3aed' },
  whales: { icon: 'waves', acc1: '#38bdf8', acc2: '#0284c7' },
  onchain: { icon: 'link', acc1: '#22d3ee', acc2: '#0891b2' },
  news: { icon: 'news', acc1: '#fbbf24', acc2: '#d97706' },
  macro: { icon: 'globe', acc1: '#34d399', acc2: '#059669' },
  stocks: { icon: 'chart', acc1: '#60a5fa', acc2: '#2563eb' },
  forex: { icon: 'swap', acc1: '#f472b6', acc2: '#db2777' },
  commodities: { icon: 'coin', acc1: '#fb923c', acc2: '#ea580c' },
  rwa: { icon: 'building', acc1: '#2dd4bf', acc2: '#0d9488' }
};

const SOURCE_STATUS = {
  HEALTHY: { fa: 'سالم', en: 'healthy', cls: 'up' },
  DEGRADED: { fa: 'نیمه‌سالم', en: 'degraded', cls: 'warn' },
  DOWN: { fa: 'خاموش', en: 'down', cls: 'bad' }
};

const tone2pill = { ok: 'up', warn: 'warn', off: 'ghost' };

/** a single list row of an opened domain — `L` is passed in (it was the crash) */
function DomainItem({ d, it, L, isPersian }) {
  switch (d.listKind) {
    case 'tokens':
      return (
        <>
          <b><Ltr>{it.symbol || '—'}</Ltr></b>
          {it.chain ? <span>{isPersian ? (it.chainFa || it.chain) : it.chain}</span> : null}
          {it.valueUsd !== null && it.valueUsd !== undefined
            ? <Ltr style={{ color: it.valueUsd >= 0 ? 'var(--up)' : 'var(--down)' }}>{isPersian ? usdFaCompact(it.valueUsd, { signed: false }) : usdCompact(it.valueUsd).replace('+', '')}</Ltr>
            : null}
          {it.flow ? <span className="aigw-pill flat" style={{ fontSize: 9, padding: '1px 6px' }}>{it.flow === 'accumulating' || it.flow === 'in' ? L('انباشت', 'accumulating') : it.flow === 'distributing' || it.flow === 'out' ? L('توزیع', 'distributing') : L('برچسب‌دار', 'labelled')}</span> : null}
          {it.confidence !== null && it.confidence !== undefined && it.confidence > 0
            ? <span style={{ opacity: 0.7 }}>{L('اطمینان', 'confidence')} <Ltr>{isPersian ? faNum(it.confidence) : it.confidence}</Ltr></span>
            : null}
        </>
      );
    case 'whales':
      return (
        <>
          <b><Ltr>{it.symbol || '—'}</Ltr></b>
          {it.chain ? <span>{isPersian ? (it.chainFa || it.chain) : it.chain}</span> : null}
          <Ltr>{isPersian ? usdFaCompact(it.valueUsd, { signed: false }) : usdCompact(it.valueUsd).replace('+', '')}</Ltr>
          {it.flow ? (
            <span className={`aigw-pill ${it.flow === 'in' ? 'up' : 'down'}`} style={{ fontSize: 9, padding: '1px 6px' }}>
              <DirMark dir={it.flow === 'in' ? 'up' : 'down'} size={8} />
              {it.flow === 'in' ? L('ورود', 'in') : L('خروج', 'out')}
            </span>
          ) : null}
          {it.at ? <span>{timeAgo(it.at, isPersian)}</span> : null}
        </>
      );
    case 'sources': {
      const st = SOURCE_STATUS[String(it.status || '').toUpperCase()];
      return (
        <>
          <b>{(isPersian ? it.labelFa : it.labelEn) || it.symbol || '—'}</b>
          <span className={`aigw-pill ${st?.cls || 'flat'}`} style={{ fontSize: 9, padding: '1px 6px' }}>{st ? (isPersian ? st.fa : st.en) : L('نامشخص', 'unknown')}</span>
          {it.failures !== null && it.failures !== undefined ? <span>{L('خطا', 'failures')} <b className="aigw-ltr">{isPersian ? faNum(it.failures) : it.failures}</b></span> : null}
          {it.lastOkAt ? <span>{timeAgo(it.lastOkAt, isPersian)}</span> : null}
        </>
      );
    }
    case 'headlines':
      return (
        <>
          <span className="ell aigw-dom-title"><bdi dir="auto">{it.title || '—'}</bdi></span>
          {it.source ? <span style={{ opacity: 0.75 }}><Ltr>{it.source}</Ltr></span> : null}
          {it.at ? <span style={{ flexShrink: 0 }}>{timeAgo(it.at, isPersian)}</span> : null}
        </>
      );
    case 'topics':
      return (
        <>
          <b>{isPersian ? (it.symbolFa || it.symbol) : it.symbol}</b>
          <span>{'\u00d7'} <b className="aigw-ltr">{isPersian ? faNum(it.count) : it.count}</b></span>
        </>
      );
    case 'instruments':
      return (
        <>
          <b>{isPersian && it.nameFa ? it.nameFa : <Ltr>{it.symbol || '—'}</Ltr>}</b>
          {isPersian && it.nameFa ? <Ltr style={{ opacity: 0.6, fontSize: 9 }}>{it.symbol}</Ltr> : (it.name ? <span className="ell">{it.name}</span> : null)}
          {it.changePct !== null && it.changePct !== undefined ? (
            <Ltr style={{ color: it.changePct >= 0 ? 'var(--up)' : 'var(--down)' }}>{pct(it.changePct, isPersian)}</Ltr>
          ) : (
            <span style={{ opacity: 0.7 }}>{L('تغییر روزانه نرسید', 'no daily change')}</span>
          )}
          {it.priceUsd !== null && it.priceUsd !== undefined
            ? <Ltr style={{ opacity: 0.8 }}>{priceText(it.priceUsd, isPersian)}</Ltr>
            : <span style={{ opacity: 0.55 }}>{L('قیمت نرسید', 'no price')}</span>}
        </>
      );
    default:
      return <span className="ell">{it.symbol || it.title || '—'}</span>;
  }
}

export function DomainsView({ domains, L, isPersian, reasonLabel }) {
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => buildDomainsView(domains), [domains]);
  const read = rows.filter((r) => r.status === 'OK').length;
  const partial = rows.filter((r) => r.status === 'PARTIAL').length;

  if (!rows.length) {
    return (
      <div className="aigw-panel acc-domains">
        <div className="aig-empty" style={{ padding: 16 }}>
          {L('اسنپ‌شات حوزه‌ها در این پاسخ نرسید.', 'The domain snapshot did not arrive in this response.')}
        </div>
      </div>
    );
  }

  const reasonText = (d) => (d.reason ? (reasonLabel ? reasonLabel(d.reason, isPersian) : L('خوانده نشد', 'unread')) : L('هیچ فیلدی برنگشت', 'no field returned'));

  return (
    <div className="aigw-panel acc-domains">
      <div className="aigw-prov-sum">
        <span className="aigw-prov-sum-n aigw-ltr">
          {isPersian ? `${faNum(read)}/${faNum(rows.length)}` : `${read}/${rows.length}`}
        </span>
        <span className="aigw-prov-sum-d">
          {L(
            `${faNum(read)} حوزه کامل${partial ? `، ${faNum(partial)} ناقص` : ''}؛ بقیه با دلیلشان نشان داده شده‌اند. روی هر ردیف بزنید تا جزئیات همان‌جا باز شود.`,
            `${read} domains complete${partial ? `, ${partial} partial` : ''}; the rest carry their reason. Tap a row to open its details in place.`
          )}
        </span>
      </div>

      <div className="aigw-domlist">
        {rows.map((d) => {
          const f = FACE[d.key] || FACE.macro;
          const active = open === d.key;
          const headline = isPersian ? d.headlineFa : d.headlineEn;
          const quotes = (d.quotes || []).filter((q) => q.change1dPct !== null && q.change1dPct !== undefined);
          const mover = quotes.length ? quotes.slice().sort((a, b) => Math.abs(b.change1dPct) - Math.abs(a.change1dPct))[0] : null;
          return (
            <div key={d.key} className={`aigw-domrow tone-${d.tone} ${active ? 'open' : ''}`} style={{ '--acc1': f.acc1, '--acc2': f.acc2 }}>
              <button
                type="button"
                className={`aigw-dom ${active ? 'on' : ''}`}
                onClick={() => setOpen(active ? null : d.key)}
                aria-expanded={active}
              >
                <span className="aigw-dom-ico"><WIcon name={f.icon} size={18} /></span>
                <span className="aigw-dom-main">
                  <span className="aigw-dom-name">{isPersian ? d.label.fa : d.label.en}</span>
                  <span className="aigw-dom-role">{isPersian ? d.role.fa : d.role.en}</span>
                </span>
                <span className="aigw-dom-line">
                  {d.status === 'OK' || d.status === 'PARTIAL'
                    ? (headline || L('جزئیات در ردیف باز می‌شود', 'details open in the row'))
                    : reasonText(d)}
                </span>
                <span className="aigw-dom-stats">
                  {d.stats.slice(0, 3).map((s) => (
                    <span key={s.en} className="aigw-dom-stat">
                      <small>{isPersian ? s.fa : s.en}</small>
                      <b className="aigw-ltr" style={{ color: s.dir === 'up' ? 'var(--up)' : s.dir === 'down' ? 'var(--down)' : 'var(--text-1)' }}>{isPersian ? s.valueFa : s.valueEn}</b>
                    </span>
                  ))}
                  {mover ? (
                    <span className="aigw-dom-stat">
                      <small>{L('بزرگ‌ترین حرکت', 'top mover')} · {isPersian && mover.nameFa ? mover.nameFa : mover.symbol}</small>
                      <b className="aigw-ltr" style={{ color: mover.change1dPct >= 0 ? 'var(--up)' : 'var(--down)' }}>{pct(mover.change1dPct, isPersian, 1)}</b>
                    </span>
                  ) : null}
                </span>
                <span className="aigw-dom-side">
                  <span className={`aigw-pill ${tone2pill[d.tone] || 'ghost'}`} style={{ fontSize: 9.5, padding: '2px 8px' }}>
                    {isPersian ? d.statusFa : d.statusEn}
                  </span>
                  <i className="aigw-dom-caret" aria-hidden="true" />
                </span>
              </button>

              {active ? (
                <div className="aigw-dom-open">
                  <div className="aigw-dom-meta">
                    {[
                      (isPersian ? d.sourceFa : d.sourceEn) ? `${L('منبع', 'source')}: ${isPersian ? d.sourceFa : d.sourceEn}` : null,
                      d.at ? `${L('به‌روزرسانی', 'updated')} ${timeAgo(d.at, isPersian)}` : null,
                      d.confidence !== null && d.confidence !== undefined ? `${L('اطمینان', 'confidence')} ${isPersian ? faNum(d.confidence) : d.confidence}` : null,
                      d.partial ? L('پاسخ ناقص', 'partial payload') : null,
                      d.stale ? L('آخرین خوانش سالم', 'last good read') : null
                    ].filter(Boolean).join(' · ')}
                  </div>

                  {d.metrics.length ? (
                    <div className="aigw-dom-metrics">
                      {d.metrics.map((m) => (
                        <span key={m.key} className="aigw-dom-metric">
                          <span>{isPersian ? m.fa : m.en}</span>
                          <b className="aigw-ltr" style={{ color: m.dir === 'up' ? 'var(--up)' : m.dir === 'down' ? 'var(--down)' : 'var(--text-1)' }}>{isPersian ? (m.valueFa ?? m.value) : m.value}</b>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {d.list.length ? (
                    <div className="aigw-dom-list">
                      {d.list.slice(0, 12).map((it, i) => (
                        <div key={i} className="aigw-dom-item">
                          <DomainItem d={d} it={it} L={L} isPersian={isPersian} />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {d.activity?.length ? (
                    <div className="aigw-dom-list">
                      {d.activity.map((a, i) => (
                        <div key={i} className="aigw-dom-item">
                          <span className="ell"><bdi dir="auto">{a.detail || a.type || '—'}</bdi></span>
                          <span style={{ flexShrink: 0, opacity: 0.75 }}>{a.at ? timeAgo(a.at, isPersian) : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {d.quotes?.length ? (
                    <div className="aigw-dom-list">
                      {d.quotes.map((q, i) => (
                        <div key={i} className="aigw-dom-item">
                          <b>{isPersian && q.nameFa ? q.nameFa : <Ltr>{q.symbol}</Ltr>}</b>
                          <Ltr>{q.priceUsd === null || q.priceUsd === undefined ? L('قیمت نرسید', 'no price') : (isPersian ? faNum(q.priceUsd) : q.priceUsd)}</Ltr>
                          {q.change1dPct !== null && q.change1dPct !== undefined ? (
                            <Ltr style={{ color: q.change1dPct >= 0 ? 'var(--up)' : 'var(--down)' }}>{pct(q.change1dPct, isPersian)}</Ltr>
                          ) : null}
                          {(isPersian ? q.sourceFa : q.source) ? <span style={{ opacity: 0.7 }}>{isPersian ? q.sourceFa : q.source}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {!d.list.length && !d.metrics.length && !d.quotes?.length ? (
                    <div className="aigw-note" style={{ marginTop: 6 }}>
                      {L('این حوزه در این دور هیچ فیلد قابل نمایشی برنگرداند.', 'This domain returned no displayable field this pass.')}
                      {d.reason ? ` ${L('دلیل', 'reason')}: ${reasonText(d)}` : ''}
                    </div>
                  ) : null}

                  {d.readOnly ? (
                    <div className="aigw-note" style={{ marginTop: 6 }}>
                      {L('فقط‌خواندنی: هیچ سفارش یا اجرایی از این حوزه صادر نمی‌شود.', 'read-only: no order or execution is ever issued from this domain.')}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="aigw-note">
        {L(
          'وضعیت هر حوزه از همان پاسخ سرور استخراج می‌شود: «کامل» یعنی همه‌چیز رسیده، «ناقص» یعنی حوزه پاسخ داد ولی بخشی از فیلدها (مثلاً تغییر روزانه) نرسید، و «خوانده نشد» یعنی هیچ دادهٔ قابل‌استنادی نبود. هیچ عددی ساخته نمی‌شود.',
          'Each domain\u2019s status comes from the same server payload: «complete» means everything arrived, «partial» means the domain answered but some fields (such as the daily change) did not, and «unread» means nothing citable was present. No number is ever invented.'
        )}
      </div>
    </div>
  );
}

export default DomainsView;
