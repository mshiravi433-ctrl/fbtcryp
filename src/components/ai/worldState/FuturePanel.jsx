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
import { Ltr } from './parts.jsx';

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

      <div className="gw-cols">
        <div className="gw-col">
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

      <div className="aigw-tree-root">
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
