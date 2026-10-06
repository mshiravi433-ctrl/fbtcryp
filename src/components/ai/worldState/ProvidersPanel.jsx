/**
 * PANEL 9 — DATA PROVIDERS.
 * ---------------------------------------------------------------------------
 * REPORTED: «ارائه‌دهندگان باید ایکون‌های SVG درست و زیبا و مدرن داشته باشند».
 *
 * The old tab printed the raw `providers` object with dot lamps and no icon at
 * all. This renders the same five readiness lamps as real SVG states, with:
 *   · one stroke icon per domain (inline SVG from the shared set — no emoji,
 *     no font glyphs, no images);
 *   · a lamp legend that says what each of the five positions actually means;
 *   · the lit count per row and the aggregate «live / ready / total» row;
 *   · the failure reason when the domain itself reported one, plus the
 *     domain's own status and freshness, so a lit lamp never contradicts the
 *     domain tab.
 * A lamp is lit only when the server said `true`; nothing is inferred.
 */
import { useMemo } from 'react';
import { buildProvidersView } from './worldModel.js';
import { WIcon } from './icons.jsx';
import { faNum, timeAgo } from './format.jsx';
import { describeSource } from './resolve.js';

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
const LAMP_FA = {
  implemented: 'پیاده‌سازی', configured: 'پیکربندی', provider_available: 'دسترس‌پذیری',
  runtime_ready: 'آمادهٔ اجرا', live: 'زنده'
};
const LAMP_EN = {
  implemented: 'implemented', configured: 'configured', provider_available: 'available',
  runtime_ready: 'runtime-ready', live: 'live'
};
const STATUS_FA = { OK: 'کامل', PARTIAL: 'ناقص', UNAVAILABLE: 'خوانده نشد', STALE: 'کهنه' };

export function ProvidersPanel({ providers, domains, L, isPersian, reasonLabel }) {
  const view = useMemo(() => buildProvidersView(providers, domains), [providers, domains]);

  if (!view.rows.length) {
    return (
      <div className="aigw-panel acc-prov">
        <div className="aig-empty" style={{ padding: 16 }}>
          {L('فهرست ارائه‌دهندگان در این پاسخ نرسید.', 'The provider list did not arrive in this response.')}
        </div>
      </div>
    );
  }

  return (
    <div className="aigw-panel acc-prov">
      <div className="aigw-prov-sum">
        <span className="aigw-prov-sum-n aigw-ltr">{isPersian ? faNum(view.live) : view.live}</span>
        <span className="aigw-prov-sum-d">
          {L(
            `زنده از ${faNum(view.total)} دامنه · ${faNum(view.ready)} آمادهٔ اجرا`,
            `live out of ${view.total} domains · ${view.ready} runtime-ready`
          )}
        </span>
      </div>

      {/* the legend — each lamp position, in the order the rows draw them */}
      <div className="aigw-lamp-legend">
        {view.lamps.map((l) => (
          <span key={l} className="aigw-lamp-legend-i">
            <i className="aigw-lamp on" aria-hidden="true" />
            {isPersian ? LAMP_FA[l] : LAMP_EN[l]}
          </span>
        ))}
        <span className="aigw-lamp-legend-i">
          <i className="aigw-lamp off" aria-hidden="true" />
          {L('خاموش', 'off')}
        </span>
      </div>

      {view.rows.map((r) => {
        const face = FACE[r.key] || FACE.macro;
        /* `aig-light` / `aig-lamp` are the historical hook names the phase211
           probe counts; the console's own classes carry the styling. */
        return (
          <div key={r.key} className="aigw-prov aig-light" style={{ '--acc1': face.acc1, '--acc2': face.acc2 }}>
            <span className="aigw-dom-ico" aria-hidden="true"><WIcon name={face.icon} size={17} /></span>

            <div style={{ minWidth: 0 }}>
              <div className="aigw-prov-name">
                {isPersian ? r.label.fa : r.label.en}
                <span className={`aigw-pill ${r.status === 'OK' ? 'up' : r.status === 'PARTIAL' ? 'warn' : r.status ? 'flat' : 'ghost'}`} style={{ fontSize: 9, padding: '1px 7px' }}>
                  {r.status ? (isPersian ? (STATUS_FA[r.status] || r.status) : r.status) : L('وضعیت نامعلوم', 'status unknown')}
                </span>
              </div>
              <div className="aigw-prov-sub">
                {r.reason
                  ? <span title={r.reason}>{L(`دلیل: ${reasonLabel ? reasonLabel(r.reason, true) : r.reason}`, `reason: ${reasonLabel ? reasonLabel(r.reason, false) : r.reason}`)}</span>
                  : describeSource(r.source, isPersian)
                    ? <span>{describeSource(r.source, isPersian)}</span>
                    : L('بدون منبع اعلام‌شده', 'no source declared')}
                {r.at ? <span> · {timeAgo(r.at, isPersian)}</span> : null}
              </div>
            </div>

            <div className="aigw-prov-side">
              <span className="aigw-lamps" title={isPersian
                ? 'پیاده‌سازی · پیکربندی · دسترس‌پذیری · آمادهٔ اجرا · زنده'
                : 'implemented · configured · available · runtime-ready · live'}>
                {r.lamps.map((l, i) => (
                  <i key={l.key} className={`aigw-lamp aig-lamp ${l.on ? 'on' : 'off'}${i === 4 && l.on ? ' warm' : ''}`}
                    title={isPersian ? LAMP_FA[l.key] : LAMP_EN[l.key]} />
                ))}
              </span>
              <span className="aigw-prov-lit aigw-ltr">{isPersian ? `${faNum(r.lit)}/۵` : `${r.lit}/5`}</span>
              {r.lamps[4].on
                ? <WIcon name="check" size={14} style={{ color: 'var(--up)' }} />
                : <WIcon name="cloud" size={14} style={{ color: 'var(--text-3)' }} />}
            </div>
          </div>
        );
      })}

      <div className="aigw-note">
        {L(
          'هر چراغ فقط وقتی روشن است که سرور همان وضعیت را true اعلام کرده باشد؛ «زنده» یعنی در همین فرایند نتیجهٔ واقعی برگشته. چراغ روشن وعدهٔ آینده نیست.',
          'A lamp is lit only when the server reported that flag as true; «live» means a real result returned in this process. A lit lamp is not a promise.'
        )}
      </div>
    </div>
  );
}

export default ProvidersPanel;
