/**
 * PANEL 7 — MARKET DNA.
 * ---------------------------------------------------------------------------
 * REPORTED: «DNA بازار — داده‌ها و انیمیشن حرکتی و آیکون‌ها را درست کن و داده‌های
 * درست».
 *
 * Each asset now shows:
 *   · a rotating double helix drawn as two phase-shifted strands with animated
 *     rungs (CSS keyframes, transform/opacity only);
 *   · a sensitivity HEXAGON (SVG radar) of the six model genes, so the shape
 *     of the asset is readable at a glance, plus the six rows with bars;
 *   · on every gene, the reading of THIS PASS that touches it (liquidity →
 *     stablecoin net, macro → regime, whale → scanner count, usd → DXY move,
 *     riskOn → class breadth, etf → the gold-ETF read) with a white marker on
 *     the prior bar when that field was read.
 * Priors stay labelled model terms; the white markers are real reads.
 */
import { useMemo, useState } from 'react';
import { buildDna, DNA_ASSETS, DNA_GENE_META, usdCompact } from './worldModel.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct } from './format.jsx';

const VOL_FA = { high: 'پرنوسان', medium: 'متوسط', low: 'آرام' };
const VOL_EN = { high: 'volatile', medium: 'moderate', low: 'calm' };
const GENE_ORDER = ['liquidity', 'macro', 'whale', 'usd', 'riskOn', 'etf'];

export function DnaPanel({ world, L, isPersian }) {
  const [sym, setSym] = useState('BTC');
  const dna = useMemo(() => buildDna(world, sym), [world, sym]);

  /* the double helix: two phase-shifted sine strands + rungs */
  const helix = useMemo(() => {
    const rungs = [];
    for (let x = 10; x <= 310; x += 14) {
      const phase = Math.sin(x / 22);
      rungs.push({ x, y1: 30 - 18 * phase, y2: 30 + 18 * phase });
    }
    return rungs;
  }, []);

  const strand = (dir) => {
    const pts = [];
    for (let x = 0; x <= 320; x += 8) {
      pts.push(`${x},${(30 + dir * 18 * Math.sin(x / 22)).toFixed(1)}`);
    }
    return `M ${pts.join(' L ')}`;
  };

  /* the sensitivity hexagon */
  const hex = useMemo(() => {
    const cx = 150; const cy = 116; const R = 84;
    const point = (i, v) => {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      return [cx + R * v * Math.cos(a), cy + R * v * Math.sin(a)];
    };
    return {
      cx, cy, R,
      grid: [0.25, 0.5, 0.75, 1].map((v) => GENE_ORDER.map((_, i) => point(i, v))),
      axes: GENE_ORDER.map((_, i) => point(i, 1)),
      labels: GENE_ORDER.map((_, i) => point(i, 1.22)),
      prior: GENE_ORDER.map((g, i) => point(i, dna.priors[g])),
      observed: dna.genes.map((g, i) => (g.field && g.field.kind === 'read' ? point(i, g.field.dir === 'down' ? 1 - g.prior : g.prior) : null)),
      point
    };
  }, [dna]);

  const poly = (pts) => pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');

  return (
    <div className="aigw-panel acc-dna">
      <div className="aigw-chips">
        {DNA_ASSETS.map((a) => (
          <button key={a} type="button" className={`aigw-chip ${sym === a ? 'active' : ''}`} onClick={() => setSym(a)}>
            <span className="aigw-ltr">{a}</span>
          </button>
        ))}
      </div>

      <svg className="aigw-dna-helix" viewBox="0 0 320 60" dir="ltr" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="aigw-dna-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e879f9" /><stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <path className="aigw-helix-a" d={strand(1)} fill="none" stroke="url(#aigw-dna-a)" strokeWidth="2.4" opacity=".9" />
        <path className="aigw-helix-b" d={strand(-1)} fill="none" stroke="url(#aigw-dna-a)" strokeWidth="2.4" opacity=".45" />
        {helix.map((r, i) => (
          <line key={r.x} className="aigw-rung" style={{ animationDelay: `${(i % 7) * 0.25}s` }}
            x1={r.x} y1={r.y1} x2={r.x} y2={r.y2} stroke="rgba(232,121,249,0.5)" strokeWidth="1" />
        ))}
      </svg>

      {/* the shape of the asset */}
      <svg className="aigw-hex" viewBox="0 0 300 250" dir="ltr" role="img" aria-label={L('شش ژن حساسیت', 'six sensitivity genes')}>
        {hex.grid.map((g, i) => (
          <polygon key={i} points={poly(g)} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="0.8" />
        ))}
        {hex.axes.map((p, i) => (
          <line key={i} x1={hex.cx} y1={hex.cy} x2={p[0]} y2={p[1]} stroke="rgba(148,163,184,0.2)" strokeWidth="0.8" />
        ))}
        <polygon points={poly(hex.prior)} fill="rgba(232,121,249,0.16)" stroke="#e879f9" strokeWidth="1.6" />
        {hex.observed.map((p, i) => (p ? (
          <circle key={i} cx={p[0]} cy={p[1]} r="4" fill="#fff" stroke="#38bdf8" strokeWidth="1.6" />
        ) : null))}
        {hex.labels.map((p, i) => (
          <text key={i} x={p[0]} y={p[1]} fontSize="9" fill="rgba(148,163,184,0.95)" fontFamily="inherit"
            textAnchor={Math.abs(p[0] - hex.cx) < 6 ? 'middle' : p[0] > hex.cx ? 'start' : 'end'}
            dominantBaseline="middle">
            {isPersian ? DNA_GENE_META[GENE_ORDER[i]].fa.replace('حساسیت ', '') : DNA_GENE_META[GENE_ORDER[i]].en.replace(' sensitivity', '')}
          </text>
        ))}
      </svg>

      <div className="aig-section" style={{ paddingTop: 4, paddingBottom: 6 }}>
        {GENE_ORDER.map((g) => {
          const meta = DNA_GENE_META[g];
          const prior = dna.priors[g];
          const gene = dna.genes.find((x) => x.id === g);
          const field = gene?.field || null;
          return (
            <div key={g} className="aigw-dna-row">
              <div style={{ minWidth: 0, width: '100%' }}>
                <div className="aigw-dna-name">
                  <WIcon name={meta.icon} size={14} style={{ color: 'var(--acc1)' }} />
                  {isPersian ? meta.fa : meta.en}
                  {field ? (
                    <span className={`aigw-pill ${field.dir === 'up' ? 'up' : field.dir === 'down' ? 'down' : 'flat'}`} style={{ fontSize: 9, padding: '1px 7px' }}>
                      <DirMark dir={field.dir} size={8} />
                      <span className="aigw-ltr">{field.value || (field.dir === 'up' ? '+' : field.dir === 'down' ? '−' : '0')}</span>
                      <span style={{ opacity: .75, fontWeight: 700 }}>{field.source || ''}</span>
                    </span>
                  ) : (
                    <span className="aigw-pill ghost" style={{ fontSize: 9, padding: '1px 7px' }}>{L('خوانده نشد', 'unread')}</span>
                  )}
                </div>
                <div className="aigw-dna-track" aria-hidden="true">
                  <i style={{ width: `${Math.round(prior * 100)}%` }} />
                  {field ? <b style={{ insetInlineStart: `calc(${Math.round(prior * 100)}% - 1px)` }} /> : null}
                </div>
              </div>
              <span className="aigw-pill flat" style={{ flexShrink: 0 }}>{isPersian ? `${faNum(Math.round(prior * 100))}\u066a` : `${Math.round(prior * 100)}%`}</span>
            </div>
          );
        })}

        <div className="aigw-dna-obs">
          {dna.observed.change !== null ? (
            <span className={`aigw-pill ${dna.observed.change >= 0 ? 'up' : 'down'}`}>
              <DirMark dir={dna.observed.change >= 0 ? 'up' : 'down'} size={9} />
              <span className="aigw-ltr">{pct(dna.observed.change, isPersian)}</span>
            </span>
          ) : <span className="aigw-pill ghost">{L('قیمتی در این دور خوانده نشد', 'no price read this pass')}</span>}
          {dna.observed.volatility ? (
            <span className={`aigw-pill ${dna.observed.volatility === 'high' ? 'bad' : dna.observed.volatility === 'medium' ? 'warn' : 'up'}`}>
              {L(`نوسان: ${VOL_FA[dna.observed.volatility]}`, `volatility: ${VOL_EN[dna.observed.volatility]}`)}
            </span>
          ) : null}
          {dna.observed.usdAlignment ? (
            <span className={`aigw-pill ${dna.observed.usdAlignment === 'opposite' ? 'warn' : 'info'}`}>
              {dna.observed.usdAlignment === 'opposite'
                ? L('خلاف‌جهت با دلار در این دور', 'opposite the dollar this pass')
                : L('هم‌جهت با دلار در این دور', 'with the dollar this pass')}
            </span>
          ) : null}
          {dna.observed.whaleTouched ? <span className="aigw-pill info">{L('در جریان‌های برچسب‌دار این دور دیده شد', 'seen in this pass\u2019s labelled flows')}</span> : null}
          {dna.observed.etfLinked ? <span className="aigw-pill flat">{L('پیوند ETF', 'ETF-linked')}</span> : null}
          {dna.observed.source ? <span className="aigw-pill ghost">{L('منبع', 'source')}: {dna.observed.source}</span> : null}
        </div>
      </div>

      {dna.observed.change === null && dna.genes.every((g) => !g.field) ? (
        <div className="aig-empty" style={{ marginTop: 6 }}>
          {L('برای این دارایی در این دور خوانشی نرسید — نوارها پیش‌فرض مدل‌اند و هیچ مشاهده‌ای جعل نمی‌شود.', 'No reading reached this asset in this pass — the bars are model priors and no observation is invented.')}
        </div>
      ) : (
        <div className="aigw-note">
          {L(
            'نوار حساسیت پیش‌فرض مدل است (برچسب‌دار و ثابت)؛ نشانگر سفید روی هر نوار یعنی همان ژن در این دور خوانش واقعی داشت و برچسب کنار نام ژن، مقدار و منبع آن خوانش است. هیچ‌کدام مجوز اجرا نیست.',
            'The sensitivity bar is a labelled, fixed model prior; the white marker on a bar means that gene had a real reading this pass, and the chip beside the gene name carries its value and source. None of it is execution authority.'
          )}
        </div>
      )}
      <div className="aigw-note" style={{ marginTop: 4 }}>
        {L('دنبالهٔ DNA نشانگر است، نه داده — هرچه خوانده شده در ردیف‌ها و برچسب‌ها آمده است.', 'The helix is decorative, not data — every real reading is in the rows and chips.')}
      </div>
    </div>
  );
}

export default DnaPanel;

export { usdCompact };
