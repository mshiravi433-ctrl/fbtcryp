/**
 * PANEL — ECONOMIC OUTLOOK (the «اقتصاد و دارایی → چشم‌انداز» reading).
 * ---------------------------------------------------------------------------
 * REPORTED: «اقتصاد و دارایی → اقتصادی چشم‌انداز: دادهٔ کافی نیست».
 *
 * That string was the engine's own label: when the server's composite could
 * not be computed it emitted UNAVAILABLE and the UI printed it verbatim, even
 * though the client was holding real readings the engine had not used.
 *
 * This panel now shows the FULL reading instead of a verdict:
 *   · the label and score, with their provenance stated — engine, engine +
 *     labelled local complement, or a purely local composite when the engine
 *     did not answer at all;
 *   · a coverage meter over the nine possible inputs (have/total), because
 *     «enough data?» is answered by a count, not by a sentence;
 *   · every contributing signal — engine first, then the local ones — with its
 *     real value, its weight, and the evidence sentence it was derived from;
 *   · every MISSING input with the precise reason it is missing.
 * Nothing is filled in to make the panel look complete.
 */
import { useMemo } from 'react';
import { buildOutlookReading, usdCompact } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct } from './format.jsx';

const SIGNAL_FA = {
  risk_mood: 'حال‌وهوای کلاس‌ها', breadth: 'گستردگی حرکت‌ها', dollar_pressure: 'فشار دلار',
  safe_haven_bid: 'تقاضای پناهگاه امن', energy: 'فشار انرژی/تورم', curve: 'شیب منحنی بازده',
  liquidity: 'نقدینگی استیبل‌کوین', smart_money: 'جریان نهادِ برچسب‌دار', geopolitics: 'ریسک ژئوپلیتیک'
};
const SIGNAL_EN = {
  risk_mood: 'cross-class mood', breadth: 'advance/decline breadth', dollar_pressure: 'dollar pressure',
  safe_haven_bid: 'safe-haven bid', energy: 'energy & inflation pressure', curve: 'yield-curve slope',
  liquidity: 'stablecoin liquidity', smart_money: 'labelled institutional flow', geopolitics: 'geopolitical risk'
};

function sigName(s, isPersian) {
  return isPersian ? (s.nameFa || SIGNAL_FA[s.rawId] || s.name || s.rawId) : (s.name || SIGNAL_EN[s.rawId] || s.rawId);
}


/* the direction word of a signal, derived from its own direction field */
function dirWord(s) {
  const d = String(s.direction || '').toLowerCase();
  if (d === 'supportive' || d === 'up' || d === 'positive') return { kind: 'up' };
  if (d === 'cautionary' || d === 'down' || d === 'negative') return { kind: 'down' };
  const v = Number(s.value);
  if (Number.isFinite(v) && Math.abs(v) > 0.05) return { kind: v > 0 ? 'up' : 'down' };
  return { kind: 'neutral' };
}


/* the score arc: a half circle from «ریسک فشار» (left) to «رشد» (right).
   Geometry only — the value it draws is the reading's own score. */
const ARC = { cx: 160, cy: 132, r: 116 };
const arcPoint = (t) => [
  ARC.cx - ARC.r * Math.cos(t),
  ARC.cy - ARC.r * Math.sin(t)
];
function arcPath(from, to) {
  const a = arcPoint(from); const b = arcPoint(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${a[0].toFixed(1)} ${a[1].toFixed(1)} A ${ARC.r} ${ARC.r} 0 ${large} 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
}
const ARC_SPAN = Math.PI;

export function OutlookPanel({ world, L, isPersian }) {
  const o = useMemo(() => buildOutlookReading(world), [world]);
  const scoreDir = o.score === null ? 'flat' : o.score > 0.05 ? 'up' : o.score < -0.05 ? 'down' : 'flat';
  const tone = o.label === 'GROWTH_WATCH' ? 'up' : o.label === 'RECESSION_WATCH' ? 'down' : 'flat';
  const engine = o.source === 'engine' || o.source === 'engine+local';

  return (
    <div className="aigw-panel acc-econ">
      {/* the verdict, with provenance */}
      <div className="aigw-sec" style={{ marginTop: 2 }}>
        <WIcon name="curve" size={17} />
        {L('چشم‌انداز اقتصادی — خوانش ترکیبی', 'Economic outlook — the blended reading')}
        <span className="aigw-sec-sub">
          {engine ? L('موتور سرور + مکمل محلی برچسب‌دار', 'engine + labelled local complement') : L('ترکیب محلی برچسب‌دار', 'labelled local composite')}
        </span>
      </div>

      {/* ── the gauge: where this pass's blended score sits on the scale ──── */}
      {(() => {
        const v = o.score === null ? null : Math.max(-1, Math.min(1, Number(o.score)));
        const t = v === null ? ARC_SPAN / 2 : ((v + 1) / 2) * ARC_SPAN;
        const tip = arcPoint(t);
        const tone = v === null ? 'var(--text-3)' : v > 0.05 ? 'var(--up)' : v < -0.05 ? 'var(--down)' : 'var(--warn, #eab308)';
        return (
          <div className="aigw-outlook-gauge">
            <svg className="aigw-outlook-arc" viewBox="0 0 320 156" dir="ltr" role="img"
              aria-label={L('مقیاس چشم‌انداز', 'outlook scale')}>
              <defs>
                <linearGradient id="aigw-outlook-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="50%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>
              <path d={arcPath(0, ARC_SPAN)} fill="none" stroke="color-mix(in srgb, var(--text-1) 12%, transparent)" strokeWidth="10" strokeLinecap="round" />
              <path d={arcPath(0, ARC_SPAN)} fill="none" stroke="url(#aigw-outlook-grad)" strokeWidth="3" strokeLinecap="round" opacity=".55" />
              {v !== null ? (
                <path d={arcPath(0, Math.max(0.02, t))} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round" opacity=".85" />
              ) : null}
              <line x1={ARC.cx} y1={ARC.cy} x2={tip[0]} y2={tip[1]} stroke={tone} strokeWidth="2.4" strokeLinecap="round" />
              <circle cx={ARC.cx} cy={ARC.cy} r="6" fill={tone} />
              <circle cx={ARC.cx} cy={ARC.cy} r="2.4" fill="var(--bg-panel-solid, #0b1020)" />
              <text x="18" y="152" fontSize="9.5" fill="var(--text-3)" fontFamily="inherit">{L('فشار', 'stress')}</text>
              <text x={ARC.cx} y="18" fontSize="9.5" fill="var(--text-3)" fontFamily="inherit" textAnchor="middle">{L('خنثی', 'neutral')}</text>
              <text x="302" y="152" fontSize="9.5" fill="var(--text-3)" fontFamily="inherit" textAnchor="end">{L('رشد', 'growth')}</text>
            </svg>
            <div className="aigw-outlook-legend">
              <span>-1</span>
              <span>{L('امتیاز ترکیبی', 'blended score')}: {o.score === null ? L('خوانده نشد', 'unread') : (isPersian ? faNum(`${o.score > 0 ? '+' : ''}${o.score}`) : `${o.score > 0 ? '+' : ''}${o.score}`)}</span>
              <span>+1</span>
            </div>
          </div>
        );
      })()}

      <div className="aigw-outlook-now">
        <div className="aigw-outlook-state">
          <div className="aigw-outlook-state-k">{L('برچسب', 'label')}</div>
          <div className="aigw-outlook-state-v">
            {o.label === 'UNAVAILABLE'
              ? L('دادهٔ کافی نیست', 'not enough data')
              : (isPersian ? o.labelFa : o.label.replace(/_/g, ' '))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <span className={`aigw-pill ${tone}`}>
              <DirMark dir={scoreDir} size={9} />
              <span className="aigw-ltr">{o.score === null ? '—' : (o.score > 0 ? '+' : '') + o.score}</span>
            </span>
            {o.engineLabel
              ? <span className="aigw-pill info">{L(`موتور: ${o.engineLabel}`, `engine: ${o.engineLabel}`)}</span>
              : <span className="aigw-pill ghost">{L('موتور این دور پاسخ نداد', 'the engine did not answer')}</span>}
            {o.localScore !== null
              ? <span className="aigw-pill flat">{L(`محلی: ${faNum(o.localScore)}`, `local: ${o.localScore}`)}</span>
              : null}
          </div>
        </div>

        <div className="aigw-outlook-state">
          <div className="aigw-outlook-state-k">{L('پوشش ورودی‌ها', 'input coverage')}</div>
          <div className="aigw-outlook-state-v aigw-ltr">
            {isPersian ? `${faNum(o.availableSignals)} / ${faNum(o.possible)}` : `${o.availableSignals} / ${o.possible}`}
          </div>
          <div className="aigw-sig-bar" style={{ marginTop: 8 }} aria-hidden="true">
            <i style={{ insetInlineStart: 0, width: `${Math.round((o.coverage || 0) * 100)}%`, background: 'var(--acc-grad)' }} />
          </div>
          <div className="aigw-outlook-state-k" style={{ marginTop: 6 }}>
            {o.currentState.regime
              ? L(`رژیم کنونی: ${o.currentState.regime}`, `current regime: ${o.currentState.regime}`)
              : L('رژیم خوانده نشد', 'regime unread')}
          </div>
        </div>
      </div>

      {/* the closing levels of the observed classes */}
      {o.currentState.classes.some((c) => c.avg !== null) ? (
        <div className="aigw-class-chips">
          {o.currentState.classes.filter((c) => c.avg !== null).map((c) => (
            <span key={c.cls} className="aigw-pill flat">
              <span className="aigw-ltr">{c.cls}</span>
              <DirMark dir={c.avg > 0 ? 'up' : c.avg < 0 ? 'down' : 'flat'} size={8} />
              <span className="aigw-ltr" style={{ color: c.avg > 0 ? 'var(--up)' : c.avg < 0 ? 'var(--down)' : 'var(--text-2)' }}>{pct(c.avg, isPersian)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* every contributing signal, engine first */}
      <div className="aigw-sec">
        <WIcon name="signal" size={17} />
        {L('سیگنال‌های سازنده', 'contributing signals')}
        <span className="aigw-sec-sub">{L(`وزن‌دار · ${faNum(o.signals.filter((s) => s.value !== null).length)} فعال`, `weighted · ${o.signals.filter((s) => s.value !== null).length} active`)}</span>
      </div>

      {o.signals.filter((s) => s.value !== null).length ? (
        o.signals.filter((s) => s.value !== null).map((s) => {
          const v = Math.max(-1, Math.min(1, Number(s.value)));
          const w = Math.min(50, (Math.abs(v) * 50));
          const color = s.origin === 'engine' ? 'var(--acc1)' : 'var(--acc2)';
          return (
            <div key={s.id} className="aigw-signal-row aig-signal">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 850, color: 'var(--text-1)' }}>{sigName(s, isPersian)}</span>
                  <span className={`aigw-pill ${s.origin === 'engine' ? 'info' : 'flat'}`} style={{ fontSize: 9, padding: '1px 7px' }}>
                    {s.origin === 'engine' ? L('موتور', 'engine') : L('خوانش محلی', 'local read')}
                  </span>
                  <span className="aigw-pill ghost" style={{ fontSize: 9, padding: '1px 7px' }}>
                    {L('وزن', 'w')} <b className="aigw-ltr">{s.weight}</b>
                  </span>
                  {/* the direction word, not just the arrow: «پشتیبان» / «هشداردهنده» / «خنثی».
                      The historical `aig-signal-dir` hook is kept so the older
                      cross-asset probe keeps reading the same criterion. */}
                  <span className={`aig-signal-dir ${s.direction || ''} aigw-signal-dir ${dirWord(s).kind}`}>
                    <DirMark dir={dirWord(s).kind === 'up' ? 'up' : dirWord(s).kind === 'down' ? 'down' : 'flat'} size={9} />
                    <span style={{ fontSize: 9, fontWeight: 800 }}>
                      {dirWord(s).kind === 'up' ? L('پشتیبان', 'supportive') : dirWord(s).kind === 'down' ? L('هشداردهنده', 'cautionary') : L('خنثی', 'neutral')}
                    </span>
                  </span>
                  {s.source ? <span className="aigw-ltr" style={{ fontSize: 8.5, color: 'var(--text-3)' }}>{s.source}</span> : null}
                </div>
                {s.evidence ? (
                  <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.85 }}>
                    {isPersian ? (s.evidenceFa || s.evidence) : s.evidence}
                  </div>
                ) : null}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="aigw-sig-bar" aria-hidden="true">
                  <i style={{ insetInlineStart: v >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: v >= 0 ? 'var(--up)' : 'var(--down)' }} />
                  <i style={{ insetInlineStart: '50%', width: '1px', background: 'color-mix(in srgb, var(--text-1) 34%, transparent)' }} />
                </div>
                <div className="aigw-ltr" style={{ fontSize: 10, fontWeight: 900, textAlign: 'center', marginTop: 4, color: v >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {isPersian ? faNum(`${v > 0 ? '+' : ''}${v}`) : `${v > 0 ? '+' : ''}${v}`}
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="aig-empty" style={{ padding: 14 }}>
          {L('هیچ ورودی قابل استنادی در این دور خوانده نشد — عدد ساخته نمی‌شود.', 'No citable input was read this pass — no number is invented.')}
        </div>
      )}

      {/* what is missing, and exactly why */}
      {o.missing.length ? (
        <>
          <div className="aigw-sec">
            <WIcon name="eye" size={17} />
            {L('ورودی‌های خوانده‌نشده', 'inputs not read')}
            <span className="aigw-sec-sub">{isPersian ? faNum(o.missing.length) : o.missing.length}</span>
          </div>
          <div className="aigw-missing">
            {o.missing.map((m) => (
              <span key={m.id} className="aigw-pill ghost" title={isPersian ? m.whyFa : m.whyEn}>
                {isPersian ? (m.nameFa || SIGNAL_FA[m.id] || m.id) : (m.nameEn || SIGNAL_EN[m.id] || m.id)}
                <span style={{ opacity: .7, fontWeight: 700 }}>· {isPersian ? m.whyFa : m.whyEn}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}

      <div className="aigw-note">
        {L(
          `هر سیگنال با مقدار، وزن و شاهد خودش آمده است. برچسب و امتیاز وقتی موتور پاسخ داده مال موتور است و مکمل محلی جدا برچسب می‌خورد؛ وقتی موتور پاسخ نداده، همین ترکیب محلی با برچسب «ترکیب محلی» نمایش داده می‌شود — نه یک حکم بی‌پشتوانه.${o.currentState.regime ? ` رژیم مرجع: ${o.currentState.regime}.` : ''}`,
          `Every signal carries its value, weight and evidence. When the engine answered, the label and score are its own and the local complement is labelled separately; when it did not, this labelled local composite is shown — never an unsupported verdict.${o.currentState.regime ? ` Reference regime: ${o.currentState.regime}.` : ''}`
        )}
      </div>
    </div>
  );
}

export default OutlookPanel;
export { usdCompact };
