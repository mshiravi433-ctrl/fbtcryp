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
import { buildOutlookReading, usdCompact, OUTLOOK_LABEL_FA, REGIME_FA } from './worldModel.js';
import { WIcon, DirMark, useSvgId } from './icons.jsx';
import { faNum, pct } from './format.jsx';
import { describeSource } from './resolve.js';

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


/*
 * THE DIAL — «اون حالت عقربه را کلا مدرن‌ترش کن» (reported 2026-10-15).
 * ---------------------------------------------------------------------------
 * A half dial from −1 (stress, left) through 0 (neutral, top) to +1 (growth,
 * right) — the same orientation as before, so nobody has to relearn it:
 *   · the scale is 33 segments coloured red → amber → green; the segments
 *     between neutral and this pass's score light up (in sequence, on mount),
 *     the rest stay as a faint guide — so the dial shows HOW FAR from neutral,
 *     and on which side, at a glance;
 *   · major ticks at −1, −0.5, 0, +0.5, +1 with their numbers (Persian digits
 *     in Persian), minor ticks every 0.1;
 *   · a tapered needle with a counterweight and a glowing tip that sweeps in
 *     from −1 and settles with a small overshoot (transform only);
 *   · the score itself, large, under the hub, in the colour of its side.
 * No score → no needle sweep and no lit segment: the dial says «خوانده نشد».
 */
const G = { cx: 160, cy: 160, r: 116, w: 15 };
const SEGMENTS = 33;
const STOPS = [[-1, [239, 68, 68]], [-0.5, [249, 115, 22]], [0, [234, 179, 8]], [0.5, [132, 204, 22]], [1, [34, 197, 94]]];
/* t: 0 = the left end (−1), π = the right end (+1) */
const polar = (r, t) => [G.cx - r * Math.cos(t), G.cy - r * Math.sin(t)];
const f2 = (n) => n.toFixed(2);
function arcD(r, t0, t1) {
  const a = polar(r, t0); const b = polar(r, t1);
  return `M${f2(a[0])} ${f2(a[1])}A${r} ${r} 0 0 1 ${f2(b[0])} ${f2(b[1])}`;
}
function colourAt(v) {
  const x = Math.max(-1, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i += 1) {
    const [v1, c1] = STOPS[i];
    const [v0, c0] = STOPS[i - 1];
    if (x <= v1) {
      const k = (x - v0) / (v1 - v0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
    }
  }
  return 'rgb(34,197,94)';
}

function OutlookDial({ score, labelText, L, isPersian }) {
  const id = useSvgId('ol');
  const v = score === null || score === undefined || !Number.isFinite(Number(score)) ? null : Math.max(-1, Math.min(1, Number(score)));
  const side = v === null ? 'na' : v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
  const toneColor = v === null ? '#64748b' : colourAt(v);
  const half = 1 / SEGMENTS;
  const gap = 0.022;
  const segs = Array.from({ length: SEGMENTS }, (_, i) => {
    const mid = ((i + 0.5) / SEGMENTS) * 2 - 1;
    const lit = v !== null && (
      Math.abs(mid) <= half + 1e-9
        ? true
        : v >= 0 ? (mid > 0 && mid <= v + half) : (mid < 0 && mid >= v - half)
    );
    return { i, mid, lit, d: arcD(G.r, (i / SEGMENTS) * Math.PI + gap / 2, ((i + 1) / SEGMENTS) * Math.PI - gap / 2) };
  });
  const litOrder = segs.filter((sg) => sg.lit).sort((a, b) => Math.abs(a.mid) - Math.abs(b.mid)).map((sg) => sg.i);
  const ticks = Array.from({ length: 21 }, (_, i) => {
    const tv = -1 + i * 0.1;
    const t = ((tv + 1) / 2) * Math.PI;
    const major = i % 5 === 0;
    const r0 = G.r + G.w / 2 + 4;
    const r1 = r0 + (major ? 7 : 3.5);
    const a = polar(r0, t); const b = polar(r1, t);
    return { i, major, d: `M${f2(a[0])} ${f2(a[1])}L${f2(b[0])} ${f2(b[1])}`, t, tv };
  });
  const num = (n) => {
    const txt = `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${Math.abs(n)}`;
    return isPersian ? txt.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]).replace('.', '٫') : txt;
  };
  const deg = v === null ? 0 : v * 90;
  const scoreText = v === null
    ? L('خوانده نشد', 'unread')
    : num(Math.round(Number(score) * 100) / 100);

  return (
    <div className={`aigw-outlook-gauge side-${side}`} style={{ '--ol-tone': toneColor }}>
      {/* `direction: ltr` (not only dir=…): SVG text inherits the CSS
          direction, and in a Persian page «−۰٫۵» would otherwise print as «۰٫۵−» */}
      <svg className="aigw-outlook-arc" viewBox="0 0 320 178" dir="ltr" style={{ direction: 'ltr' }} role="img"
        aria-label={`${L('مقیاس چشم‌انداز', 'outlook scale')}: ${scoreText}`}>
        <defs>
          <linearGradient id={`${id}n`} gradientUnits="userSpaceOnUse" x1="0" y1={G.cy - G.r} x2="0" y2={G.cy + 20}>
            <stop offset="0%" stopColor={toneColor} />
            <stop offset="55%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <radialGradient id={`${id}h`} cx="42%" cy="36%" r="70%">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0b1020" />
          </radialGradient>
          <filter id={`${id}g`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* the faint inner guide ring and the glow under the lit run */}
        <path d={arcD(G.r - G.w / 2 - 9, 0.02, Math.PI - 0.02)} className="aigw-ol-guide" />
        {v !== null ? (
          <path d={arcD(G.r, Math.min(Math.PI / 2, ((v + 1) / 2) * Math.PI), Math.max(Math.PI / 2, ((v + 1) / 2) * Math.PI) + 0.001)}
            stroke={toneColor} strokeWidth={G.w + 6} fill="none" opacity=".35" filter={`url(#${id}g)`} />
        ) : null}

        {/* the 33 segments */}
        {segs.map((sg) => (
          <path key={sg.i} d={sg.d} className={`aigw-ol-seg ${sg.lit ? 'lit' : ''}`}
            stroke={colourAt(sg.mid)} strokeWidth={G.w}
            style={sg.lit ? { '--i': litOrder.indexOf(sg.i) } : undefined} />
        ))}

        {/* ticks + numbers */}
        {ticks.map((tk) => <path key={tk.i} d={tk.d} className={`aigw-ol-tick ${tk.major ? 'major' : ''}`} />)}
        {ticks.filter((tk) => tk.major).map((tk) => {
          const [x, y] = polar(G.r + G.w / 2 + 20, tk.t);
          const isTop = Math.abs(tk.tv) < 1e-9;
          return (
            <text key={`n${tk.i}`} x={f2(x)} y={f2(y + (isTop ? 2 : 4))} className="aigw-ol-num"
              textAnchor={tk.tv < -0.99 ? 'start' : tk.tv > 0.99 ? 'end' : 'middle'}>
              {isTop ? L('خنثی', 'neutral') : num(Math.round(tk.tv * 10) / 10)}
            </text>
          );
        })}
        <text x={G.cx - G.r} y={G.cy + 17} className="aigw-ol-zone down" textAnchor="middle">{L('فشار', 'stress')}</text>
        <text x={G.cx + G.r} y={G.cy + 17} className="aigw-ol-zone up" textAnchor="middle">{L('رشد', 'growth')}</text>

        {/* the needle: drawn pointing at neutral, turned to the score */}
        {v !== null ? (
          <g className="aigw-ol-needle" style={{ '--deg': `${deg}deg` }}>
            <path d={`M${G.cx} ${G.cy - G.r + 6}L${G.cx + 5.5} ${G.cy}L${G.cx} ${G.cy + 20}L${G.cx - 5.5} ${G.cy}Z`}
              fill={toneColor} opacity=".45" filter={`url(#${id}g)`} />
            <path d={`M${G.cx} ${G.cy - G.r + 6}L${G.cx + 5.5} ${G.cy}L${G.cx} ${G.cy + 20}L${G.cx - 5.5} ${G.cy}Z`}
              fill={`url(#${id}n)`} stroke="rgba(15,23,42,.35)" strokeWidth=".6" />
            <path d={`M${G.cx} ${G.cy - G.r + 6}L${G.cx} ${G.cy + 20}`} stroke="rgba(255,255,255,.55)" strokeWidth=".8" />
            <circle cx={G.cx} cy={G.cy - G.r + 6} r="7.5" fill={toneColor} filter={`url(#${id}g)`} />
            <circle cx={G.cx} cy={G.cy - G.r + 6} r="3.8" fill="#fff" />
          </g>
        ) : null}

        {/* the hub */}
        <circle cx={G.cx} cy={G.cy} r="15" fill={`url(#${id}h)`} stroke={toneColor} strokeWidth="2" />
        <circle cx={G.cx} cy={G.cy} r="6.5" fill={toneColor} className="aigw-ol-core" />
        <circle cx={G.cx - 2} cy={G.cy - 2.2} r="1.8" fill="rgba(255,255,255,.75)" />
      </svg>

      <div className="aigw-outlook-legend">
        <span className={`aigw-ol-score ${side}`}><span className="aigw-ltr">{scoreText}</span></span>
        {labelText ? <span className={`aigw-ol-verdict ${side}`}>{labelText}</span> : null}
        <span className="aigw-ol-cap">
          {L('امتیاز ترکیبی', 'blended score')} · {L('از', 'from')} <span className="aigw-ltr">{num(-1)}</span> {L('تا', 'to')} <span className="aigw-ltr">{num(1)}</span>
        </span>
      </div>
    </div>
  );
}

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

      {/* ── the dial: where this pass's blended score sits on the scale ───── */}
      <OutlookDial
        score={o.score}
        labelText={o.label === 'UNAVAILABLE' ? null : (isPersian ? o.labelFa : o.label.replace(/_/g, ' ').toLowerCase())}
        L={L}
        isPersian={isPersian}
      />

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
              <span className="aigw-ltr">{o.score === null ? '—' : (isPersian ? faNum(`${o.score > 0 ? '+' : ''}${o.score}`) : `${o.score > 0 ? '+' : ''}${o.score}`)}</span>
            </span>
            {o.engineLabel
              ? <span className="aigw-pill info">{L(`موتور: ${OUTLOOK_LABEL_FA[o.engineLabel] || o.engineLabel.replace(/_/g, ' ')}`, `engine: ${o.engineLabel.replace(/_/g, ' ').toLowerCase()}`)}</span>
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
              ? L(`رژیم کنونی: ${REGIME_FA[o.currentState.regime] || o.currentState.regime}`, `current regime: ${String(o.currentState.regime).replace(/_/g, ' ').toLowerCase()}`)
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
                  {describeSource(s.source, isPersian) ? <span style={{ fontSize: 8.5, color: 'var(--text-3)' }}>{describeSource(s.source, isPersian)}</span> : null}
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
          `هر سیگنال با مقدار، وزن و شاهد خودش آمده است. برچسب و امتیاز وقتی موتور پاسخ داده مال موتور است و مکمل محلی جدا برچسب می‌خورد؛ وقتی موتور پاسخ نداده، همین ترکیب محلی با برچسب «ترکیب محلی» نمایش داده می‌شود — نه یک حکم بی‌پشتوانه.${o.currentState.regime ? ` رژیم مرجع: ${REGIME_FA[o.currentState.regime] || o.currentState.regime}.` : ''}`,
          `Every signal carries its value, weight and evidence. When the engine answered, the label and score are its own and the local complement is labelled separately; when it did not, this labelled local composite is shown — never an unsupported verdict.${o.currentState.regime ? ` Reference regime: ${String(o.currentState.regime).replace(/_/g, ' ').toLowerCase()}.` : ''}`
        )}
      </div>
    </div>
  );
}

export default OutlookPanel;
export { usdCompact };
