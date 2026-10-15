/**
 * PANEL 6 — FUTURE TREE + ADVERSARIAL CHALLENGER.
 * ---------------------------------------------------------------------------
 * REPORTED: «درخت آینده — انیمیشن و داده‌ها ناقص و ناکافی است درستش کن».
 *
 * The tree is now an actual tree that GROWS when it is drawn (stroke-dash
 * animation on the three limbs, breathing leaf clusters), the three branches
 * carry their weights on the limbs themselves, and the data behind every
 * weight is opened up:
 *   · every nudge that moved a weight is listed with its real value AND the
 *     reading it came from (defillama/2s10s/DXY/regime…);
 *   · the pre-normalisation totals are shown, so the arithmetic is auditable;
 *   · a FLIP list says which reading would change the picture and what it
 *     reads right now;
 *   · the adversarial challenger keeps attacking this pass's opportunity with
 *     observed-vs-standing risks.
 */
import { useMemo, useState } from 'react';
import { buildFutureTree, buildChallenger, FUTURE_ASSETS, FUTURE_DRIVER_LABEL, usdCompact } from './worldModel.js';
import { WIcon, DirMark, useSvgId } from './icons.jsx';
import { faNum, pct } from './format.jsx';
import { Ltr } from './parts.jsx';

const FUTURE_META = {
  btc: { fa: 'رمزارز (کلاس)', en: 'Crypto (class)', icon: 'coin', grad: ['#fcd34d', '#f59e0b'] },
  gold: { fa: 'طلا', en: 'Gold', icon: 'spark', grad: ['#fde68a', '#eab308'] },
  dollar: { fa: 'دلار', en: 'Dollar', icon: 'bank', grad: ['#6ee7b7', '#10b981'] },
  equity: { fa: 'سهام', en: 'Equity', icon: 'chart', grad: ['#93c5fd', '#6366f1'] }
};
const CASE_META = {
  bull: { fa: 'سناریوی صعودی', en: 'Bull case', short: ['صعودی', 'bull'], color: '#22c55e', leaf: ['#dcfce7', '#4ade80', '#15803d'], icon: 'spark' },
  base: { fa: 'سناریوی خنثی', en: 'Base case', short: ['خنثی', 'base'], color: '#eab308', leaf: ['#fef9c3', '#facc15', '#a16207'], icon: 'gauge' },
  stress: { fa: 'سناریوی فشار', en: 'Stress case', short: ['فشار', 'stress'], color: '#ef4444', leaf: ['#fee2e2', '#f87171', '#b91c1c'], icon: 'warning' }
};

/*
 * THE TREE — «درخت آینده را خیلی مدرن کن با رنگ‌بندی جذاب» (reported 2026-10-15).
 * ---------------------------------------------------------------------------
 * An illustrated tree that grows from the asset: a tapered teal→lime trunk on
 * a glowing ground, three limbs (stress on the left, neutral up the middle,
 * bull on the right — the same left-to-right order as the outlook dial) whose
 * THICKNESS and CANOPY SIZE follow the scenario weight, leaf clusters in each
 * scenario's colours, a halo that breathes on the heaviest scenario, and
 * fireflies rising from the canopies. The weight badges sit on the canopies.
 * Everything drawn here is a weight that buildFutureTree already computed —
 * the picture adds no number of its own.
 */
const TREE = {
  trunkTop: [160, 150],
  canopy: { stress: [74, 96], base: [160, 72], bull: [246, 96] },
  limb: {
    stress: 'M160 154C150 134 116 126 90 106',
    base: 'M160 152C160 130 160 108 160 88',
    bull: 'M160 154C170 134 204 126 230 106'
  },
  twig: {
    stress: 'M122 128C114 121 107 120 99 122',
    base: 'M160 118C167 111 173 109 181 109',
    bull: 'M198 128C206 121 213 120 221 122'
  },
  twigLeaf: { stress: [96, 122], base: [184, 108], bull: [224, 122] }
};
/* a crown of pointed leaves: [angle°, length factor] — fanned up from the limb tip */
const CROWN = [[-100, 0.78], [-68, 0.92], [-36, 1], [0, 1.06], [36, 1], [68, 0.92], [100, 0.78], [-150, 0.62], [150, 0.62]];
/* one leaf, base at 0,0, pointing up (length 1, width 0.42) */
const LEAF_D = 'M0 0C.26 -.18.27 -.62 0 -1C-.27 -.62-.26 -.18 0 0Z';
const FIREFLY = [
  ['stress', -14, 0, 0], ['stress', 12, 6, 1.4], ['stress', 2, -8, 2.6],
  ['base', -10, 2, 0.7], ['base', 12, -4, 2], ['base', 0, 8, 3.1],
  ['bull', 14, 0, 0.3], ['bull', -12, 6, 1.7], ['bull', 0, -10, 2.9]
];

function FutureTreeArt({ weights, isPersian, L }) {
  const id = useSvgId('ft');
  const cases = ['stress', 'base', 'bull'];
  const top = cases.reduce((a, k) => (weights[k] > weights[a] ? k : a), 'base');
  const rc = (k) => 18 + Math.max(0, Math.min(75, weights[k])) * 0.3;
  const pctText = (k) => (isPersian ? `${faNum(weights[k])}\u066a` : `${weights[k]}%`);
  return (
    <svg className="aigw-tree-svg" viewBox="0 -14 320 266" fill="none" dir="ltr" style={{ direction: 'ltr' }} role="img"
      aria-label={`${L('درخت آینده', 'Future tree')}: ${cases.map((k) => `${isPersian ? CASE_META[k].short[0] : CASE_META[k].short[1]} ${pctText(k)}`).join(' · ')}`}>
      <defs>
        <linearGradient id={`${id}t`} gradientUnits="userSpaceOnUse" x1="0" y1="236" x2="0" y2="146">
          <stop offset="0%" stopColor="#0f766e" />
          <stop offset="55%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#a3e635" />
        </linearGradient>
        <radialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity=".45" />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
        {cases.map((k) => {
          const [cx, cy] = TREE.canopy[k];
          return (
            <g key={k}>
              <linearGradient id={`${id}l${k}`} gradientUnits="userSpaceOnUse" x1="160" y1="152" x2={cx} y2={cy}>
                <stop offset="0%" stopColor="#a3e635" />
                <stop offset="100%" stopColor={CASE_META[k].color} />
              </linearGradient>
              <linearGradient id={`${id}f${k}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={CASE_META[k].leaf[2]} />
                <stop offset="55%" stopColor={CASE_META[k].leaf[1]} />
                <stop offset="100%" stopColor={CASE_META[k].leaf[0]} />
              </linearGradient>
              <radialGradient id={`${id}a${k}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={CASE_META[k].color} stopOpacity=".42" />
                <stop offset="100%" stopColor={CASE_META[k].color} stopOpacity="0" />
              </radialGradient>
            </g>
          );
        })}
      </defs>

      {/* ground + roots */}
      <ellipse cx="160" cy="236" rx="128" ry="13" fill={`url(#${id}g)`} />
      <ellipse cx="160" cy="236" rx="74" ry="4.5" className="aigw-tree-ground" />
      <g stroke="#14b8a6" strokeWidth="1.6" strokeLinecap="round" opacity=".7">
        <path d="M157 233C149 237 137 239 120 240" />
        <path d="M163 233C171 237 183 239 200 240" />
        <path d="M155 234C151 239 145 243 134 246" opacity=".6" />
        <path d="M165 234C169 239 175 243 186 246" opacity=".6" />
      </g>

      {/* the trunk: tapered, with a glow and a highlight */}
      <path d="M149 236C151.5 214 153.6 190 154.6 168C155.2 159 156.8 153 160 148C163.2 153 164.8 159 165.4 168C166.4 190 168.5 214 171 236Z"
        fill={`url(#${id}t)`} opacity=".55" filter={`url(#${id}b)`} />
      <path d="M149 236C151.5 214 153.6 190 154.6 168C155.2 159 156.8 153 160 148C163.2 153 164.8 159 165.4 168C166.4 190 168.5 214 171 236Z"
        fill={`url(#${id}t)`} />
      <path d="M157.4 228C158.2 206 158.6 186 159 166" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" strokeLinecap="round" />

      {/* limbs + twigs (they grow in), thickness follows the weight */}
      {cases.map((k, i) => (
        <path key={`l${k}`} className={`aigw-branch-tree-path ${i ? `d${i}` : ''}`} d={TREE.limb[k]}
          stroke={`url(#${id}l${k})`} strokeWidth={(3 + weights[k] * 0.085).toFixed(2)} strokeLinecap="round" />
      ))}
      {cases.map((k, i) => (
        <path key={`t${k}`} className={`aigw-branch-tree-path d${Math.min(2, i + 1)}`} d={TREE.twig[k]}
          stroke={CASE_META[k].color} strokeWidth="2" strokeLinecap="round" opacity=".85" />
      ))}

      {/* canopies: a halo, then a rosette of leaves, sized by the weight */}
      {cases.map((k) => {
        const [cx, cy] = TREE.canopy[k];
        const r = rc(k);
        return (
          <g key={`c${k}`} className={`aigw-canopy c-${k} ${k === top ? 'lead' : ''}`}>
            <circle className="aigw-tree-aura" cx={cx} cy={cy} r={(r * 1.45).toFixed(1)} fill={`url(#${id}a${k})`} />
            {CROWN.map(([deg, len], j) => (
              <g key={j} transform={`translate(${cx} ${cy + r * 0.12}) rotate(${deg}) scale(${(r * len * 1.15).toFixed(2)})`}>
                <path className={`aigw-leaf ${['', 'd1', 'd2', 'd3'][j % 4]}`} d={LEAF_D}
                  fill={`url(#${id}f${k})`} stroke="rgba(255,255,255,.28)" strokeWidth={(0.7 / (r * len * 1.15)).toFixed(3)} />
                <path d="M0 -.08V-.86" stroke="rgba(255,255,255,.45)" strokeWidth={(0.8 / (r * len * 1.15)).toFixed(3)} strokeLinecap="round" />
              </g>
            ))}
            <circle cx={cx} cy={cy + r * 0.12} r={(r * 0.2).toFixed(1)} fill={CASE_META[k].leaf[0]} opacity=".95" />
          </g>
        );
      })}
      {cases.map((k, i) => (
        <circle key={`tl${k}`} className={`aigw-leaf d${i + 1}`} cx={TREE.twigLeaf[k][0]} cy={TREE.twigLeaf[k][1]} r="4.2"
          fill={`url(#${id}f${k})`} />
      ))}

      {/* fireflies rising from the canopies */}
      {FIREFLY.map(([k, dx, dy, delay], j) => {
        const [cx, cy] = TREE.canopy[k];
        return (
          <circle key={`ff${j}`} className="aigw-firefly" cx={cx + dx} cy={cy - rc(k) * 0.4 + dy} r={j % 3 === 0 ? 1.9 : 1.4}
            fill={CASE_META[k].leaf[0]} style={{ animationDelay: `${delay}s` }} />
        );
      })}

      {/* the weight badges, on the canopies */}
      {cases.map((k) => {
        const [cx, cy] = TREE.canopy[k];
        const by = cy - rc(k) * 1.14 - 33;
        return (
          <g key={`b${k}`} className={`aigw-tree-badge ${k === top ? 'lead' : ''}`} style={{ '--case': CASE_META[k].color }}>
            <rect x={cx - 30} y={by} width="60" height="32" rx="12" />
            <text x={cx} y={by + 15} textAnchor="middle" className="aigw-tree-badge-v">{pctText(k)}</text>
            <text x={cx} y={by + 27} textAnchor="middle" className="aigw-tree-badge-k">{isPersian ? CASE_META[k].short[0] : CASE_META[k].short[1]}</text>
          </g>
        );
      })}
    </svg>
  );
}
export function FutureTreePanel({ world, L, isPersian }) {
  const [asset, setAsset] = useState('btc');
  const tree = useMemo(() => buildFutureTree(world, asset), [world, asset]);
  const challenge = useMemo(() => buildChallenger(world), [world]);
  const anchorUp = tree.anchor.change === null ? null : tree.anchor.change >= 0;
  const w = tree.weights;

  return (
    <div className="aigw-panel acc-future">
      <div className="aigw-chips">
        {FUTURE_ASSETS.map((a) => (
          <button key={a} type="button" className={`aigw-chip ${asset === a ? 'active' : ''}`} onClick={() => setAsset(a)}>
            <WIcon name={FUTURE_META[a].icon} size={14} grad={FUTURE_META[a].grad} />
            {isPersian ? FUTURE_META[a].fa : FUTURE_META[a].en}
          </button>
        ))}
      </div>

      <div className="gw-cols">
        <div className="gw-col">
      {/* ── the tree ─────────────────────────────────────────────────────── */}
      <div className="aigw-tree-stage" key={asset}>
        <FutureTreeArt weights={w} isPersian={isPersian} L={L} />
      </div>

      <div className="aigw-tree-root">
        <span className="aigw-tree-root-ico" style={{ '--g1': FUTURE_META[asset].grad[0], '--g2': FUTURE_META[asset].grad[1] }}>
          <WIcon name={FUTURE_META[asset].icon} size={18} grad={FUTURE_META[asset].grad} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 950, color: 'var(--text-1)' }}>
            {isPersian ? FUTURE_META[asset].fa : FUTURE_META[asset].en}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 3 }}>
            {L('سناریوهای مشتق‌شده از خوانش‌های همین دور — مدل، نه پیش‌بینی', 'scenarios derived from this pass\u2019s reads — a model, not a forecast')}
          </div>
        </div>
        <span className={`aigw-pill ${anchorUp === null ? 'ghost' : anchorUp ? 'up' : 'down'}`}>
          {tree.anchor.change !== null
            ? <><DirMark dir={anchorUp ? 'up' : 'down'} size={9} /><span className="aigw-ltr">{pct(tree.anchor.change, isPersian)}</span></>
            : L('خوانده نشد', 'unread')}
        </span>
      </div>

      {['bull', 'base', 'stress'].map((k) => (
        <div key={k} className={`aigw-branch b-${k} ${['bull', 'base', 'stress'].every((o) => w[k] >= w[o]) ? 'lead' : ''}`} style={{ '--branch-tone': CASE_META[k].color }}>
          <div className="aigw-branch-head">
            <span className="aigw-branch-name">
              <span className="aigw-branch-ico"><WIcon name={CASE_META[k].icon} size={15} style={{ color: CASE_META[k].color }} /></span>
              {isPersian ? CASE_META[k].fa : CASE_META[k].en}
              {['bull', 'base', 'stress'].every((o) => w[k] >= w[o])
                ? <span className="aigw-branch-lead">{L('بیشترین وزن', 'heaviest')}</span>
                : null}
            </span>
            <span className="aigw-branch-weight">{isPersian ? `${faNum(w[k])}\u066a` : `${w[k]}%`}</span>
          </div>
          <div className="aigw-branch-bar" aria-hidden="true"><i style={{ width: `${w[k]}%` }} /></div>
          <div className="aigw-driver-tags">
            {tree.drivers[k].length
              ? tree.drivers[k].map((d) => (
                <span key={d} className="aigw-tag">
                  {d.startsWith('topInflow:')
                    ? `${L('ورود سرمایه', 'inflow')}: ${d.slice(10)}`
                    : (isPersian ? FUTURE_DRIVER_LABEL[d]?.fa || d : FUTURE_DRIVER_LABEL[d]?.en || d)}
                </span>
              ))
              : <span className="aigw-tag" style={{ opacity: .7 }}>{L('بدون رانندهٔ خوانده‌شده', 'no read driver')}</span>}
          </div>
        </div>
      ))}

        </div>

        <div className="gw-col">
      {/* ── the audit: every nudge with its reading ──────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="target" size={17} />
        {L('حسابرسی وزن‌ها', 'weight audit')}
        <span className="aigw-sec-sub">
          {isPersian
            ? `خام: صعودی ${faNum(tree.baseRate.bull)} · خنثی ${faNum(tree.baseRate.base)} · فشار ${faNum(tree.baseRate.stress)}`
            : `raw: ${tree.baseRate.bull} bull · ${tree.baseRate.base} base · ${tree.baseRate.stress} stress`}
        </span>
      </div>
      <div className="aigw-driver-tags">
        {tree.nudges.length ? tree.nudges.map((n, i) => (
          <span key={`${n.key}-${i}`} className="aigw-tag" title={n.evidence || ''}>
            {isPersian ? FUTURE_DRIVER_LABEL[n.key]?.fa || n.key : FUTURE_DRIVER_LABEL[n.key]?.en || n.key}
            <b><Ltr>{isPersian ? n.valueFa : n.value}</Ltr></b>
            <span style={{ color: n.amount > 0 ? 'var(--up)' : 'var(--down)' }}><Ltr>{`${n.amount > 0 ? '+' : ''}${isPersian ? faNum(n.amount) : n.amount}`}</Ltr></span>
          </span>
        )) : <span className="aigw-tag">{L('هیچ تنظیمی اعمال نشد', 'no nudge applied')}</span>}
      </div>

      {/* ── what would flip it ───────────────────────────────────────────── */}
      {tree.flip.length ? (
        <>
          <div className="aigw-sec">
            <WIcon name="swap" size={17} />
            {L('چه چیزی این درخت را عوض می‌کند', 'what would flip the tree')}
          </div>
          {tree.flip.map((f) => (
            <div key={f.key} className="aigw-flip">
              <span style={{ color: 'var(--acc1)', marginTop: 1 }}><WIcon name="eye" size={14} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="aigw-flip-t">{isPersian ? f.textFa : f.textEn}</div>
                <div className="aigw-flip-r" style={{ color: 'var(--text-3)' }}>{isPersian ? f.readingFa : f.readingEn}</div>
              </div>
            </div>
          ))}
        </>
      ) : null}

      {/* ── the adversarial challenger ───────────────────────────────────────
          REPORTED: «هوش مدعی: چرا این فرصت ممکن است اشتباه باشد؟ — بهتر بنویس و
          شلوغ نباشد». It now speaks only about what was OBSERVED (the three
          strongest, each with one Persian sentence of evidence and one line of
          why it matters); the rest is one calm «other risks» fold, not eight
          identical rows. */}
      <div className="aigw-adv">
        <div className="aigw-adv-head">
          <span className="aigw-adv-badge"><WIcon name="shield" size={17} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="aigw-adv-h">{L('هوش مدعی: چرا این فرصت ممکن است اشتباه باشد؟', 'Adversarial AI: why this thesis could be wrong')}</div>
            <div className="aigw-adv-sub">{L('مدعی فقط از دادهٔ خوانده‌شده حرف می‌زند.', 'The challenger speaks only from data it read.')}</div>
          </div>
        </div>

        {challenge.opportunity ? (
          <>
            <div className="aigw-adv-opp">
              <span className="aigw-adv-opp-k">{L('فرصت این دور', 'this pass\u2019s opportunity')}</span>
              <div className="aigw-adv-opp-main">
                <b>{isPersian ? challenge.opportunity.kindFa : challenge.opportunity.kindEn}</b>
                {challenge.opportunity.subject ? <span className="aigw-adv-subject"><Ltr>{isPersian ? challenge.opportunity.subjectFa : challenge.opportunity.subject}</Ltr></span> : null}
                <span className="aigw-adv-opp-val"><Ltr>{isPersian ? challenge.opportunity.valueFa : challenge.opportunity.value}</Ltr></span>
              </div>
              <div className="aigw-adv-opp-d">{isPersian ? challenge.opportunity.detailFa : challenge.opportunity.detailEn}</div>
            </div>

            {(() => {
              const sum = challenge.summary;
              const byId = Object.fromEntries(challenge.arguments.map((a) => [a.id, a]));
              const top = (sum?.top || []).map((id) => byId[id]).filter(Boolean);
              const restObserved = challenge.arguments.filter((a) => a.observed && !(sum?.top || []).includes(a.id));
              const standing = challenge.arguments.filter((a) => !a.observed);
              const level = { none: 0, low: 1, medium: 2, high: 3 }[sum?.strength || 'none'];
              const strengthWord = { none: L('هیچ', 'none'), low: L('ضعیف', 'weak'), medium: L('متوسط', 'moderate'), high: L('قوی', 'strong') }[sum?.strength || 'none'];
              return (
                <>
                  <div className="aigw-adv-summary" role="status">
                    <span className="aigw-adv-meter" aria-hidden="true">
                      {[1, 2, 3].map((i) => <i key={i} className={i <= level ? `on l${level}` : ''} />)}
                    </span>
                    <span>
                      {isPersian
                        ? `${faNum(sum.observed)} دلیل از ${faNum(sum.total)} در این دور مشاهده شد · قدرت ادعای مدعی: ${strengthWord}`
                        : `${sum.observed} of ${sum.total} risks observed this pass · challenger strength: ${strengthWord}`}
                    </span>
                  </div>

                  {top.length ? top.map((a) => (
                    <div key={a.id} className="aigw-adv-row">
                      <span className="aigw-adv-ico observed"><WIcon name={a.icon} size={15} /></span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="aigw-adv-title">
                          {isPersian ? a.titleFa : a.titleEn}
                          <span className="aigw-pill bad" style={{ marginInlineStart: 6 }}>{L('مشاهده شد', 'observed')}</span>
                          <span className="aigw-pips" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={a.severity >= i / 3 - 0.1 ? 'on' : ''} />)}</span>
                        </div>
                        <div className="aigw-adv-ev">{isPersian ? a.evidenceFa : a.evidence}</div>
                        <div className="aigw-adv-why">{isPersian ? a.whyFa : a.whyEn}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="aigw-adv-calm">
                      <WIcon name="check" size={15} />
                      {L('در این دور هیچ ریسک مشهودی علیه این فرصت دیده نشد.', 'No observed risk spoke against this opportunity in this pass.')}
                    </div>
                  )}

                  {restObserved.length || standing.length ? (
                    <details className="aigw-adv-more">
                      <summary>
                        {isPersian ? `ریسک‌های دیگر (${faNum(restObserved.length + standing.length)})` : `other risks (${restObserved.length + standing.length})`}
                        <i className="aigw-bench-caret" aria-hidden="true" />
                      </summary>
                      <div className="aigw-adv-chips">
                        {restObserved.map((a) => (
                          <span key={a.id} className="aigw-adv-chip obs" title={isPersian ? a.evidenceFa : a.evidence}>{isPersian ? a.titleFa : a.titleEn}</span>
                        ))}
                        {standing.map((a) => (
                          <span key={a.id} className="aigw-adv-chip" title={isPersian ? a.whyFa : a.whyEn}>{isPersian ? a.titleFa : a.titleEn}</span>
                        ))}
                      </div>
                      <div className="aigw-adv-fine">
                        {L('پررنگ: مشاهده‌شده ولی خارج از سه مورد برتر. کم‌رنگ: ریسک‌هایی که مدل همیشه با خود دارد و امروز نشانه‌ای از آن‌ها دیده نشد.', 'Highlighted: observed but outside the top three. Muted: risks the model always carries that showed no sign today.')}
                      </div>
                    </details>
                  ) : null}
                </>
              );
            })()}
          </>
        ) : (
          <div className="aig-empty" style={{ padding: 16 }}>
            {L('در این دور فرصت صعودی برجسته‌ای ثبت نشد که مدعی به آن حمله کند.', 'No prominent positive opportunity was recorded this pass for the challenger to attack.')}
          </div>
        )}
      </div>

        </div>
      </div>

      <div className="aigw-note">
        {L(
          'وزن سناریوها تابعی شفاف از خوانش‌های همین دور است (هر تنظیم با مقدار واقعی‌اش فهرست شده) — مدل است و سناریو، نه پیش‌بینی قطعی و نه مجوز اجرا؛ عدد خام پیش از نرمال‌سازی هم نمایش داده می‌شود تا حساب‌وکتاب قابل بازبینی باشد.',
          'Scenario weights are a transparent function of this pass\u2019s reads (every nudge is listed with its real value) — a model and a scenario, not a forecast and never an execution order; the pre-normalisation totals are shown so the arithmetic can be audited.'
        )}
      </div>
    </div>
  );
}

export default FutureTreePanel;

/* the compact dollar text is handy to the parent screens too */
export { usdCompact };
