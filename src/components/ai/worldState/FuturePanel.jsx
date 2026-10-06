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
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct } from './format.jsx';

const FUTURE_META = {
  btc: { fa: 'رمزارز (کلاس)', en: 'Crypto (class)', icon: 'coin' },
  gold: { fa: 'طلا', en: 'Gold', icon: 'spark' },
  dollar: { fa: 'دلار', en: 'Dollar', icon: 'bank' },
  equity: { fa: 'سهام', en: 'Equity', icon: 'chart' }
};
const CASE_META = {
  bull: { fa: 'سناریوی صعودی', en: 'Bull case', color: '#22c55e', icon: 'spark' },
  base: { fa: 'سناریوی خنثی', en: 'Base case', color: '#eab308', icon: 'gauge' },
  stress: { fa: 'سناریوی فشار', en: 'Stress case', color: '#ef4444', icon: 'warning' }
};
const ADV_ARG_FA = {
  macroRisk: 'ریسک کلان', liquidityRisk: 'ریسک نقدینگی', dollarHeadwind: 'باد مخالف دلار',
  whaleExitRisk: 'ریسک خروج نهنگ', divergenceRisk: 'ریسک واگرایی', volatilityRisk: 'ریسک تلاطم',
  dataGapRisk: 'شکاف داده', modelRisk: 'ریسک مدل'
};
const ADV_ARG_EN = {
  macroRisk: 'Macro risk', liquidityRisk: 'Liquidity risk', dollarHeadwind: 'Dollar headwind',
  whaleExitRisk: 'Whale exit risk', divergenceRisk: 'Divergence risk', volatilityRisk: 'Volatility risk',
  dataGapRisk: 'Data gap risk', modelRisk: 'Model risk'
};

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
            <WIcon name={FUTURE_META[a].icon} size={13} />
            {isPersian ? FUTURE_META[a].fa : FUTURE_META[a].en}
          </button>
        ))}
      </div>

      {/* ── the tree ─────────────────────────────────────────────────────── */}
      <div className="aigw-tree-stage" key={asset}>
        <svg className="aigw-tree-svg" viewBox="0 0 320 220" fill="none" dir="ltr" role="img"
          aria-label={L('درخت آینده', 'Future tree')}>
          {/* trunk */}
          <path className="aigw-branch-tree-path" d="M160 214 V150" stroke="rgba(163,230,53,0.85)" strokeWidth="4" strokeLinecap="round" />
          {/* bull limb (left) */}
          <path className="aigw-branch-tree-path d1" d="M160 152 C150 126 118 116 88 82" stroke="#22c55e" strokeWidth="2.6" strokeLinecap="round" />
          {/* base limb (centre) */}
          <path className="aigw-branch-tree-path d2" d="M160 150 C160 122 160 104 160 66" stroke="#eab308" strokeWidth="2.6" strokeLinecap="round" />
          {/* stress limb (right) */}
          <path className="aigw-branch-tree-path d2" d="M160 152 C172 126 206 116 236 82" stroke="#ef4444" strokeWidth="2.6" strokeLinecap="round" />
          {/* leaves */}
          {[
            [78, 74, '#22c55e', ''], [96, 92, '#22c55e', 'd1'], [64, 90, '#22c55e', 'd2'],
            [152, 60, '#eab308', 'd1'], [170, 62, '#eab308', 'd2'], [161, 42, '#eab308', ''],
            [246, 74, '#ef4444', 'd2'], [228, 92, '#ef4444', ''], [258, 92, '#ef4444', 'd1']
          ].map(([x, y, fill, d], i) => (
            <circle key={i} className={`aigw-leaf ${d}`} cx={x} cy={y} r={i % 3 === 0 ? 6 : 4.6} fill={fill} opacity="0.85" />
          ))}
          {/* the weights live on the limbs */}
          <text x="62" y="58" fill="#22c55e" fontSize="15" fontWeight="900" fontFamily="inherit" textAnchor="middle">
            {isPersian ? `${faNum(w.bull)}\u066a` : `${w.bull}%`}
          </text>
          <text x="160" y="30" fill="#eab308" fontSize="15" fontWeight="900" fontFamily="inherit" textAnchor="middle">
            {isPersian ? `${faNum(w.base)}\u066a` : `${w.base}%`}
          </text>
          <text x="258" y="58" fill="#ef4444" fontSize="15" fontWeight="900" fontFamily="inherit" textAnchor="middle">
            {isPersian ? `${faNum(w.stress)}\u066a` : `${w.stress}%`}
          </text>
        </svg>
      </div>

      <div className="aigw-tree-root" style={{ marginTop: 2 }}>
        <div>
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
        <div key={k} className="aigw-branch" style={{ '--branch-tone': CASE_META[k].color }}>
          <div className="aigw-branch-head">
            <span className="aigw-branch-name">
              <WIcon name={CASE_META[k].icon} size={15} style={{ color: CASE_META[k].color }} />
              {isPersian ? CASE_META[k].fa : CASE_META[k].en}
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
            <b className="aigw-ltr">{n.value}</b>
            <span className="aigw-ltr" style={{ color: n.amount > 0 ? 'var(--up)' : 'var(--down)' }}>{n.amount > 0 ? '+' : ''}{n.amount}</span>
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

      {/* ── the adversarial challenger ───────────────────────────────────── */}
      <div className="aigw-adv">
        <div className="aigw-sec" style={{ margin: '0 0 6px', color: 'var(--down)' }}>
          <WIcon name="shield" size={17} />
          {L('هوش مدعی: چرا این فرصت ممکن است اشتباه باشد؟', 'Adversarial AI: why this thesis could be wrong')}
        </div>
        {challenge.opportunity ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span className="aigw-pill info">{L('فرصت این دور', 'this pass\u2019s opportunity')}</span>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: 'var(--text-1)' }}>{challenge.opportunity.label}</span>
              <span className="aigw-ltr" style={{ fontSize: 11, fontWeight: 850, color: 'var(--up)', marginInlineStart: 'auto' }}>{challenge.opportunity.value}</span>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginBottom: 6 }}>{challenge.opportunity.detail}</div>
            {challenge.arguments.map((a) => (
              <div key={a.id} className="aigw-adv-row">
                <span className={`aigw-adv-ico ${a.observed ? 'observed' : 'standing'}`}>
                  <WIcon name={a.observed ? 'warning' : 'cloud'} size={14} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="aigw-adv-title">
                    {isPersian ? ADV_ARG_FA[a.key] : ADV_ARG_EN[a.key]}
                    {a.observed
                      ? <span className="aigw-pill bad" style={{ marginInlineStart: 6 }}>{L('مشاهده شد', 'observed')}</span>
                      : <span className="aigw-pill ghost" style={{ marginInlineStart: 6 }}>{L('ریسک دائمی', 'standing')}</span>}
                  </div>
                  {a.observed && a.evidence ? <div className="aigw-adv-ev">{a.evidence}</div> : null}
                </div>
              </div>
            ))}
            <div className="aigw-note" style={{ marginTop: 6 }}>
              {isPersian
                ? `${faNum(challenge.observed)} دلیل از ${faNum(challenge.arguments.length)} در همین دور مشاهده شد. مدعی فقط از دادهٔ خوانده‌شده حرف می‌زند — ریسک‌های دائمی همیشه فهرست می‌شوند.`
                : `${challenge.observed} of ${challenge.arguments.length} risks were observed in this pass. The challenger speaks only from read data — standing risks are always listed.`}
            </div>
          </>
        ) : (
          <div className="aig-empty" style={{ padding: 16 }}>
            {L('در این دور فرصت صعودی برجسته‌ای ثبت نشد که مدعی به آن حمله کند.', 'No prominent positive opportunity was recorded this pass for the challenger to attack.')}
          </div>
        )}
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
