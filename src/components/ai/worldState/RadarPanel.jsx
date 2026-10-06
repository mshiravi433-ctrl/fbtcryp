/**
 * PANEL 3 — FBT GLOBAL RADAR.
 * ---------------------------------------------------------------------------
 * REPORTED: «زیر تب رادار هم انیمیشن خیلی ضعیف و مدرن نیست هم داده‌ها کامل
 * نیست و ناقصه».
 *
 * The radar now scans the whole pass, not the top of the briefing queue:
 *   · SECTOR is the domain (policy · rates · dollar · energy · equity ·
 *     crypto · on-chain · news · opportunity) — the bearing means something;
 *   · RING is severity: closer to the centre = more severe;
 *   · COLOUR is the tone ladder (critical → emerging → developing → stable →
 *     opportunity);
 *   · a signal TAPE below lists every blip with its real value and source, so
 *     nothing the pass produced is hidden behind a dot;
 *   · the sweep is a two-beam phosphor scan with a slow counter-rotating arc.
 */
import { useMemo, useState } from 'react';
import { buildRadar, RADAR_SECTORS, usdCompact } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct, timeAgo } from './format.jsx';

const TONE_META = {
  critical: { fa: 'بحرانی', en: 'Critical', color: '#ef4444' },
  emerging: { fa: 'نوظهور', en: 'Emerging', color: '#f97316' },
  developing: { fa: 'در حال شکل‌گیری', en: 'Developing', color: '#eab308' },
  stable: { fa: 'پایدار', en: 'Stable', color: '#22c55e' },
  opportunity: { fa: 'فرصت', en: 'Opportunity', color: '#38bdf8' }
};

const KIND_ICON = {
  macro: 'chart', curve: 'curve', class: 'layers', chain: 'link', tokenFlow: 'flow', liquidity: 'drop',
  whale: 'waves', smartMoney: 'brain', rwa: 'building', divergence: 'swap', news: 'news', briefing: 'spark',
  cross_asset: 'swap', whale_flow: 'waves', onchain: 'link', risk: 'warning'
};

const USD_KINDS = new Set(['tokenFlow', 'chain', 'liquidity', 'whale', 'smartMoney']);
const PCT_KINDS = new Set(['macro', 'class', 'rwa', 'curve', 'divergence']);

function valueText(b, isPersian) {
  if (b.value === null || b.value === undefined) return null;
  if (USD_KINDS.has(b.kind)) return usdCompact(b.value);
  if (PCT_KINDS.has(b.kind)) return pct(b.value, isPersian);
  return isPersian ? faNum(b.value) : String(b.value);
}

export function RadarPanel({ world, L, isPersian }) {
  const radar = useMemo(() => buildRadar(world), [world]);
  const [sel, setSel] = useState(0);
  const blip = radar.blips[sel] || null;

  const C = 160; const R = 128;
  const sectorCount = RADAR_SECTORS.length;

  const pos = (b) => {
    const rr = b.r * R;
    return [C + rr * Math.cos(b.angle), C + rr * Math.sin(b.angle)];
  };

  return (
    <div className="aigw-panel acc-radar">
      <div className="aigw-radar-wrap">
        <div className="aigw-radar-scope">
          <svg className="aigw-radar" viewBox="0 0 320 320" dir="ltr" role="img"
            aria-label={L('رادار جهانی FBT', 'FBT global radar')}>
            <defs>
              <linearGradient id="aigw-sweepg" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#4ade80" stopOpacity="0" />
                <stop offset="100%" stopColor="#4ade80" stopOpacity="0.34" />
              </linearGradient>
              <radialGradient id="aigw-scopeg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#4ade80" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle cx={C} cy={C} r={R} fill="url(#aigw-scopeg)" />

            {/* range rings + severity labels */}
            {[0.25, 0.5, 0.75, 1].map((k, i) => (
              <g key={k}>
                <circle cx={C} cy={C} r={R * k} fill="none" stroke="rgba(74,222,128,0.22)" strokeWidth="0.9"
                  strokeDasharray={k === 1 ? 'none' : '3 6'} />
                {i < 3 ? (
                  <text x={C + 4} y={C - R * k + 11} fill="rgba(148,163,184,0.65)" fontSize="8" fontFamily="inherit">
                    {isPersian ? `شدت ${faNum(100 - i * 25)}` : `sev ${100 - i * 25}`}
                  </text>
                ) : null}
              </g>
            ))}

            {/* sector spokes + labels */}
            {RADAR_SECTORS.map((s, i) => {
              const a = (i / sectorCount) * Math.PI * 2 - Math.PI / 2;
              const x2 = C + (R + 14) * Math.cos(a);
              const y2 = C + (R + 14) * Math.sin(a);
              const labelR = R + 26;
              const lx = C + labelR * Math.cos(a);
              const ly = C + labelR * Math.sin(a);
              return (
                <g key={s.id}>
                  <line x1={C} y1={C} x2={x2} y2={y2} stroke="rgba(74,222,128,0.14)" strokeWidth="0.8" />
                  <text x={lx} y={ly} fill="rgba(148,163,184,0.85)" fontSize="8.5" fontFamily="inherit"
                    textAnchor={Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end'}
                    dominantBaseline="middle">
                    {isPersian ? s.fa : s.en}
                  </text>
                </g>
              );
            })}

            {/* the sweeps */}
            <g className="aigw-sweep">
              <path d={`M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 0 1 ${C + R * Math.sin(Math.PI / 5.5)} ${C - R * Math.cos(Math.PI / 5.5)} Z`}
                fill="url(#aigw-sweepg)" />
              <line x1={C} y1={C} x2={C} y2={C - R} stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" opacity="0.92" />
            </g>
            <g className="aigw-sweep-slow">
              <path d={`M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 0 0 ${C - R * Math.sin(Math.PI / 7)} ${C - R * Math.cos(Math.PI / 7)} Z`}
                fill="url(#aigw-sweepg)" opacity="0.5" />
            </g>

            {/* blips */}
            {radar.blips.map((b, i) => {
              const [x, y] = pos(b);
              const tone = TONE_META[b.tone]?.color || '#94a3b8';
              const size = 2.6 + b.severity * 2.6;
              return (
                <g key={b.id} className="aigw-blip" role="button" tabIndex={0}
                  onClick={() => setSel(i)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSel(i)}
                  aria-label={isPersian && b.titleFa ? b.titleFa : b.title}>
                  {b.tone === 'critical' ? (
                    <circle className="aigw-blip-ping" cx={x} cy={y} r="10" fill="none" stroke={tone} strokeWidth="1.4" />
                  ) : null}
                  <circle cx={x} cy={y} r={size + 4.5} fill={tone} opacity={sel === i ? 0.3 : 0.15} />
                  <circle className="b-core" cx={x} cy={y} r={sel === i ? size + 2 : size} fill={tone} stroke="rgba(0,0,0,.4)" strokeWidth="0.5" />
                </g>
              );
            })}

            <circle cx={C} cy={C} r="3.6" fill="#4ade80" />
            <circle cx={C} cy={C} r="7.5" fill="none" stroke="rgba(74,222,128,0.5)" strokeWidth="1" />
          </svg>
        </div>
      </div>

      {/* legend */}
      <div className="aigw-chips" style={{ justifyContent: 'center', marginTop: 8 }}>
        {Object.entries(TONE_META).map(([t, m]) => (
          radar.counts[t] ? (
            <span key={t} className="aigw-chip" style={{ cursor: 'default' }}>
              <span className={`aigw-dot t-${t}`} />
              {isPersian ? m.fa : m.en} · {isPersian ? faNum(radar.counts[t]) : radar.counts[t]}
            </span>
          ) : null
        ))}
        <span className="aigw-chip" style={{ cursor: 'default' }}>
          {L('کل سیگنال', 'total signals')} · {isPersian ? faNum(radar.total) : radar.total}
        </span>
      </div>

      {/* selected blip */}
      {blip ? (
        <div className="aigw-blip-detail" key={blip.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span className={`aigw-dot t-${blip.tone}`} />
            <span style={{ fontSize: 10.5, fontWeight: 900, color: TONE_META[blip.tone]?.color }}>
              {isPersian ? TONE_META[blip.tone]?.fa : TONE_META[blip.tone]?.en}
            </span>
            <span className="aigw-pill ghost">{isPersian ? RADAR_SECTORS.find((s) => s.id === blip.sector)?.fa : RADAR_SECTORS.find((s) => s.id === blip.sector)?.en}</span>
            <span className="aigw-pill ghost" style={{ marginInlineStart: 'auto' }}>{blip.kind}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <WIcon name={KIND_ICON[blip.kind] || 'target'} size={16} style={{ color: 'var(--acc1)' }} />
            <span style={{ fontSize: 12, fontWeight: 850, color: 'var(--text-1)', lineHeight: 1.8, overflowWrap: 'anywhere' }}>
              {isPersian && blip.titleFa ? blip.titleFa : blip.title}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6, flexWrap: 'wrap' }}>
            {valueText(blip, isPersian) ? (
              <span className="aigw-pill info"><DirMark dir={blip.value > 0 ? 'up' : blip.value < 0 ? 'down' : 'flat'} size={9} /><span className="aigw-ltr">{valueText(blip, isPersian)}</span></span>
            ) : null}
            <span className="aigw-pill flat">{L('شدت', 'severity')} <span className="aigw-ltr">{Math.round(blip.severity * 100)}</span></span>
            <span className="aigw-pill ghost">{L('زاویه', 'bearing')} <span className="aigw-ltr">{blip.bearing}°</span></span>
            {blip.detail ? <span className="aigw-pill ghost aigw-ltr">{blip.detail}</span> : null}
            {blip.at ? <span className="aigw-pill ghost">{timeAgo(blip.at, isPersian)}</span> : null}
          </div>
          {blip.meta ? <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 5 }}>{L('منبع', 'source')}: {blip.meta}</div> : null}
        </div>
      ) : (
        <div className="aig-empty">{L('هنوز سیگنالی در این دور ثبت نشده است.', 'No signal was recorded in this pass yet.')}</div>
      )}

      {/* the full tape — every blip with its real value */}
      <div className="aigw-sec" style={{ marginTop: 14 }}>
        <WIcon name="signal" size={17} />
        {L('نوار سیگنال‌ها', 'Signal tape')}
        <span className="aigw-sec-sub">{isPersian ? `${faNum(radar.blips.length)} ردیف` : `${radar.blips.length} rows`}</span>
      </div>
      {radar.blips.length ? (
        <div className="aigw-tape">
          {radar.blips.map((b, i) => (
            <button key={b.id} type="button" className={`aigw-tape-row ${sel === i ? 'active' : ''}`} onClick={() => setSel(i)}>
              <span className={`aigw-dot t-${b.tone}`} />
              <WIcon name={KIND_ICON[b.kind] || 'target'} size={14} style={{ color: TONE_META[b.tone]?.color }} />
              <span style={{ minWidth: 0 }}>
                <span className="aigw-tape-title">{isPersian && b.titleFa ? b.titleFa : b.title}</span>
                <span className="aigw-tape-sub">
                  {isPersian ? RADAR_SECTORS.find((s) => s.id === b.sector)?.fa : RADAR_SECTORS.find((s) => s.id === b.sector)?.en}
                  {b.meta ? ` · ${b.meta}` : ''}
                </span>
              </span>
              <span className="aigw-tape-val">{valueText(b, isPersian) || `${Math.round(b.severity * 100)}`}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="aigw-note">
        {L(
          'مکان هر نقطه معنادار است: شعاع بخش = دامنه (سیاست، نرخ، دلار، انرژی، سهام، رمزارز، زنجیره، خبر، فرصت) و فاصله از مرکز = شدت؛ رنگ = دسته. همهٔ نقاط از اقلام واقعی همین دور ساخته شده‌اند و ارزش هرکدام روی نوار پایین نوشته شده است.',
          'Each blip is placed meaningfully: the sector is the domain (policy, rates, dollar, energy, equity, crypto, on-chain, news, opportunity) and the distance from the centre is severity; colour is the category. Every blip comes from a real item of this pass and its value is printed on the tape below.'
        )}
      </div>
    </div>
  );
}

export default RadarPanel;
