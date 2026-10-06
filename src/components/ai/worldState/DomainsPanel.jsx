/**
 * PANEL 8 — DATA DOMAINS.
 * ---------------------------------------------------------------------------
 * REPORTED: «حوزه داده: پول هوشمند و روی زنجیره — داده کافی نیست».
 *
 * It was not a rendering bug: the smart-money and on-chain rows really had
 * nothing usable on screen. The payloads, however, DO carry rows (top tokens,
 * whale events, source health, headlines, topics, instruments). This reader
 * surfaces them per domain, and every value shown is a field the pass really
 * returned:
 *   · smart_money → net / accumulation / distribution, whale events, window,
 *                   and the labelled top tokens with their confidence;
 *   · onchain     → healthy / degraded / down source counts + each source's
 *                   status and last-good time, plus the activity log;
 *   · whales      → the transfers themselves (symbol, chain, USD, direction,
 *                   age);
 *   · rwa         → the class instruments with their real 24h moves.
 * A domain with nothing usable states its reason — never a fabricated number,
 * and never an unexplained «دادهٔ کافی نیست».
 */
import { useMemo, useState } from 'react';
import { buildDomainsView, usdCompact } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct, timeAgo } from './format.jsx';

/* one accent pair + icon per domain, so the grid is varied — never all-purple */
const FACE = {
  smart_money: { icon: 'brain', acc1: '#a78bfa', acc2: '#7c3aed' },
  whales: { icon: 'waves', acc1: '#38bdf8', acc2: '#0284c7' },
  onchain: { icon: 'link', acc1: '#22d3ee', acc2: '#0891b2' },
  news: { icon: 'news', acc1: '#fbbf24', acc2: '#d97706' },
  macro: { icon: 'globe', acc1: '#34d399', acc2: '#059669' },
  stocks: { icon: 'chart', acc1: '#60a5fa', acc2: '#2563eb' },
  forex: { icon: 'exchange', acc1: '#f472b6', acc2: '#db2777' },
  commodities: { icon: 'coin', acc1: '#fb923c', acc2: '#ea580c' },
  rwa: { icon: 'building', acc1: '#2dd4bf', acc2: '#0d9488' }
};
const STATUS_FA = { OK: 'کامل', PARTIAL: 'ناقص', UNAVAILABLE: 'خوانده نشد', STALE: 'کهنه' };

function DomainItem({ d, it, isPersian }) {
  switch (d.listKind) {
    case 'tokens':
      return (
        <>
          <b>{it.symbol || '—'}</b>
          {it.chain ? <span>{it.chain}</span> : null}
          {it.valueUsd !== null && it.valueUsd !== undefined
            ? <span className="aigw-ltr" style={{ color: it.valueUsd >= 0 ? 'var(--up)' : 'var(--down)' }}>{usdCompact(it.valueUsd).replace('+', '')}</span>
            : null}
          {it.flow ? <span className="aigw-pill flat" style={{ fontSize: 9, padding: '1px 6px' }}>{it.flow}</span> : null}
          {it.confidence !== null && it.confidence !== undefined && it.confidence > 0
            ? <span style={{ opacity: .7 }}>{L('اطمینان', 'conf')} {isPersian ? faNum(it.confidence) : it.confidence}</span>
            : null}
        </>
      );
    case 'whales':
      return (
        <>
          <b>{it.symbol || '—'}</b>
          {it.chain ? <span>{it.chain}</span> : null}
          <span className="aigw-ltr">{usdCompact(it.valueUsd).replace('+', '')}</span>
          {it.flow ? (
            <span className={`aigw-pill ${it.flow === 'in' ? 'up' : 'down'}`} style={{ fontSize: 9, padding: '1px 6px' }}>
              <DirMark dir={it.flow === 'in' ? 'up' : 'down'} size={8} />
              {it.flow === 'in' ? L('ورود', 'in') : L('خروج', 'out')}
            </span>
          ) : null}
          {it.at ? <span>{timeAgo(it.at, isPersian)}</span> : null}
        </>
      );
    case 'sources':
      return (
        <>
          <b>{it.symbol || '—'}</b>
          <span className={`aigw-pill ${it.status === 'HEALTHY' ? 'up' : it.status === 'DEGRADED' ? 'warn' : 'bad'}`} style={{ fontSize: 9, padding: '1px 6px' }}>{it.status || '—'}</span>
          {it.failures !== null && it.failures !== undefined ? <span>{L('خطا', 'fail')} <b className="aigw-ltr">{isPersian ? faNum(it.failures) : it.failures}</b></span> : null}
          {it.lastOkAt ? <span>{timeAgo(it.lastOkAt, isPersian)}</span> : null}
        </>
      );
    case 'headlines':
      return (
        <>
          <span className="ell" style={{ color: 'var(--text-1)' }}>{it.title || '—'}</span>
          {it.source ? <span style={{ opacity: .75 }}>{it.source}</span> : null}
          {it.at ? <span style={{ flexShrink: 0 }}>{timeAgo(it.at, isPersian)}</span> : null}
        </>
      );
    case 'topics':
      return (
        <>
          <b>{it.symbol}</b>
          <span>× <b className="aigw-ltr">{isPersian ? faNum(it.count) : it.count}</b></span>
        </>
      );
    case 'instruments':
      return (
        <>
          <b>{it.symbol || '—'}</b>
          {it.name ? <span className="ell">{it.name}</span> : null}
          {it.changePct !== null && it.changePct !== undefined ? (
            <span className="aigw-ltr" style={{ color: it.changePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {pct(it.changePct, isPersian)}
            </span>
          ) : (
            <span style={{ opacity: .7 }}>{L('تغییر خوانده نشد', 'change unread')}</span>
          )}
          {it.priceUsd !== null && it.priceUsd !== undefined
            ? <span className="aigw-ltr" style={{ opacity: .8 }}>{it.priceUsd}</span>
            : null}
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
  const detailed = rows.filter((r) => r.list.length || r.metrics.length).length;
  const sel = open ? rows.find((r) => r.key === open) : null;
  const face = sel ? (FACE[sel.key] || FACE.macro) : null;

  if (!rows.length) {
    return (
      <div className="aigw-panel acc-domains">
        <div className="aig-empty" style={{ padding: 16 }}>
          {L('اسنپ‌شات حوزه‌ها در این پاسخ نرسید.', 'The domain snapshot did not arrive in this response.')}
        </div>
      </div>
    );
  }

  return (
    <div className="aigw-panel acc-domains">
      <div className="aigw-prov-sum">
        <span className="aigw-prov-sum-n aigw-ltr">
          {isPersian ? `${faNum(read)}/${faNum(rows.length)}` : `${read}/${rows.length}`}
        </span>
        <span className="aigw-prov-sum-d">
          {L(
            `${faNum(detailed)} حوزه فیلد قابل نمایش دارند · بقیه با دلیل دقیق علامت خورده‌اند`,
            `${detailed} domains carry displayable fields · the rest are marked with a precise reason`
          )}
        </span>
      </div>

      <div className="aigw-dom-grid">
        {rows.map((d) => {
          const f = FACE[d.key] || FACE.macro;
          const active = open === d.key;
          return (
            <button
              key={d.key}
              type="button"
              className={`aigw-dom ${active ? 'on' : ''}`}
              style={{ '--acc1': f.acc1, '--acc2': f.acc2, textAlign: 'start' }}
              onClick={() => setOpen(active ? null : d.key)}
              aria-expanded={active}
            >
              <span className="aigw-dom-head">
                <span className="aigw-dom-ico"><WIcon name={f.icon} size={17} /></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="aigw-dom-name" style={{ display: 'block' }}>
                    {isPersian ? d.label.fa : d.label.en}
                  </span>
                  <span className="aigw-dom-meta" style={{ display: 'block' }}>
                    {d.source || '—'}{d.at ? ` · ${timeAgo(d.at, isPersian)}` : ''}
                  </span>
                </span>
                <span
                  className={`aigw-pill ${d.status === 'OK' ? 'up' : d.status === 'PARTIAL' ? 'warn' : d.status === 'STALE' ? 'flat' : 'ghost'}`}
                  style={{ fontSize: 9, padding: '2px 7px' }}
                  title={d.status}
                >
                  {isPersian
                    ? (STATUS_FA[d.status] || d.status)
                    : (d.status === 'UNAVAILABLE' ? L('خوانده نشد', 'unread') : d.status)}
                </span>
              </span>

              {d.metrics.length ? (
                <span className="aigw-dom-metrics">
                  {d.metrics.slice(0, 4).map((m) => (
                    <span key={m.key} className="aigw-dom-metric">
                      <span>{isPersian ? m.fa : m.en}</span>
                      <b style={{ color: m.dir === 'up' ? 'var(--up)' : m.dir === 'down' ? 'var(--down)' : 'var(--text-1)' }}>{m.value}</b>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="aigw-dom-meta" style={{ display: 'block', marginTop: 8, lineHeight: 1.8 }}>
                  {d.reason
                    ? L(`دلیل: ${reasonLabel ? reasonLabel(d.reason, true) : d.reason}`, `reason: ${reasonLabel ? reasonLabel(d.reason, false) : d.reason}`)
                    : L('هیچ فیلدی برنگشت', 'no field returned')}
                </span>
              )}

              {/* the biggest real quote move of this domain — the connection
                  between the classifier label and the market it talks about */}
              {(() => {
                const quotes = (d.quotes || []).filter((q) => q.change1dPct !== null && q.change1dPct !== undefined);
                if (!quotes.length) return null;
                const mover = quotes.slice().sort((a, b) => Math.abs(b.change1dPct) - Math.abs(a.change1dPct))[0];
                return (
                  <span className="aigw-dom-metrics">
                    <span className="aigw-dom-metric">
                      <span>{mover.symbol}</span>
                      <b style={{ color: mover.change1dPct >= 0 ? 'var(--up)' : 'var(--down)' }}>{pct(mover.change1dPct, isPersian, 1)}</b>
                    </span>
                  </span>
                );
              })()}

              {d.list.length ? (
                <span className="aigw-dom-meta" style={{ display: 'block', marginTop: 7 }}>
                  {L(`${faNum(d.list.length)} ردیف آمادهٔ نمایش`, `${d.list.length} displayable rows`)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* the selected domain, opened with every field it returned */}
      {sel ? (
        <div className="aigw-dom" style={{ '--acc1': face.acc1, '--acc2': face.acc2, marginTop: 10, padding: 13 }}>
          <div className="aigw-dom-head">
            <span className="aigw-dom-ico"><WIcon name={face.icon} size={17} /></span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="aigw-dom-name" style={{ display: 'block' }}>{isPersian ? sel.label.fa : sel.label.en}</span>
              <span className="aigw-dom-meta" style={{ display: 'block' }}>
                {sel.source || '—'}
                {sel.confidence !== null && sel.confidence !== undefined ? ` · ${L('اطمینان', 'confidence')} ${isPersian ? faNum(sel.confidence) : sel.confidence}` : ''}
                {sel.partial ? ` · ${L('پاسخ ناقص', 'partial payload')}` : ''}
                {sel.stale ? ` · ${L('داده کهنه', 'stale data')}` : ''}
              </span>
            </span>
            <button type="button" className="aigw-x" onClick={() => setOpen(null)} aria-label={L('بستن', 'close')}>
              <WIcon name="close" size={14} />
            </button>
          </div>

          {sel.metrics.length ? (
            <div className="aigw-dom-metrics">
              {sel.metrics.map((m) => (
                <span key={m.key} className="aigw-dom-metric">
                  <span>{isPersian ? m.fa : m.en}</span>
                  <b style={{ color: m.dir === 'up' ? 'var(--up)' : m.dir === 'down' ? 'var(--down)' : 'var(--text-1)' }}>{m.value}</b>
                </span>
              ))}
            </div>
          ) : null}

          {sel.list.length ? (
            <div className="aigw-dom-list">
              {sel.list.slice(0, 12).map((it, i) => (
                <div key={i} className="aigw-dom-item">
                  <DomainItem d={sel} it={it} isPersian={isPersian} />
                </div>
              ))}
            </div>
          ) : null}

          {sel.activity?.length ? (
            <div className="aigw-dom-list">
              {sel.activity.map((a, i) => (
                <div key={i} className="aigw-dom-item">
                  <b>{a.type || '—'}</b>
                  <span className="ell">{a.detail || ''}</span>
                  <span style={{ flexShrink: 0, opacity: .75 }}>{a.source || ''}{a.at ? ` · ${timeAgo(a.at, isPersian)}` : ''}</span>
                </div>
              ))}
            </div>
          ) : null}

          {sel.quotes?.length ? (
            <div className="aigw-dom-list">
              {sel.quotes.map((q, i) => (
                <div key={i} className="aigw-dom-item">
                  <b>{q.symbol}</b>
                  <span className="aigw-ltr">{q.priceUsd === null || q.priceUsd === undefined ? L('قیمت خوانده نشد', 'price unread') : q.priceUsd}</span>
                  {q.change1dPct !== null && q.change1dPct !== undefined ? (
                    <span className="aigw-ltr" style={{ color: q.change1dPct >= 0 ? 'var(--up)' : 'var(--down)' }}>{pct(q.change1dPct, isPersian)}</span>
                  ) : null}
                  {q.source ? <span style={{ opacity: .7 }}>{q.source}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {!sel.list.length && !sel.metrics.length && !sel.quotes?.length ? (
            <div className="aigw-note">
              {L('این حوزه در این دور هیچ فیلد قابل نمایشی برنگرداند.', 'This domain returned no displayable field this pass.')}
              {sel.reason ? ` ${L('دلیل', 'reason')}: ${reasonLabel ? reasonLabel(sel.reason, isPersian) : sel.reason}` : ''}
            </div>
          ) : null}

          {sel.readOnly ? (
            <div className="aigw-note">
              {L('فقط‌خواندنی: هیچ سفارش یا اجرایی از این حوزه صادر نمی‌شود.', 'read-only: no order or execution is ever issued from this domain.')}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="aigw-note">
          {L('روی هر حوزه بزنید تا همهٔ فیلدهایی که سرور برگردانده باز شود.', 'Tap a domain to open every field the server returned.')}
        </div>
      )}

      <div className="aigw-note">
        {L(
          'وضعیت هر حوزه از همان پاسخ سرور استخراج می‌شود؛ «ناقص» یعنی بخشی از فیلدها نرسیده و «خوانده نشد» یعنی هیچ فیلد قابل استنادی نبود. هیچ عددی جعل نمی‌شود.',
          'Each domain\u2019s status comes from the same server payload; «partial» means some fields did not arrive and «unread» means nothing citable was present. No number is ever invented.'
        )}
      </div>
    </div>
  );
}

export default DomainsView;
