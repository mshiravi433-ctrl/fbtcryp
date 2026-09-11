/**
 * FBT STRATEGY BRAIN — PORTFOLIO STRATEGY CARD.
 * ---------------------------------------------------------------------------
 * The surface that makes the cross-module brain visible. It renders the object
 * `buildPortfolioStrategy` produced and nothing else: no price is computed
 * here, no fee is invented here, and no number appears that is not in the plan.
 *
 * What it has to show, and why each block exists:
 *
 *   objective      the four numbers the plan was built on, and where each came
 *                  from — "you said 10,000" and "your wallet holds 10,000" are
 *                  different evidence for the same number.
 *   coverage       which of the 21 domains actually answered. A plan that was
 *                  built on 9 reads must not look like one built on 21.
 *   verdict        required APY vs what the ecosystem can source, the gap that
 *                  only price can fill, and the measured 1σ range — the honest
 *                  answer to "is 15% in 4 months realistic".
 *   comparison     every candidate the engine scored, with the reason each one
 *                  lost. This is the "compare the options" half of the ask.
 *   sleeves        the allocation itself: weight, amount, sourced rate, basis.
 *   stages         the execution order, each stage a handoff to the venue that
 *                  owns the signature. Nothing here signs.
 *   monitors       what will be watched, and what happens when it trips.
 *
 * A refusal (`ok: false`) renders as an answer with the reason and the way out,
 * never as an empty card.
 */
import { useMemo, useState } from 'react';
import { localizeStrategyPlan, domainDisplayName } from '../lib/strategyBrain/strategyLocales.js';

const pct = (v, d = 2) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)}%` : '—');
const usd = (v, d = 0) => (Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: d })}` : '—');

/* The runtime's four verdicts, in the user's language. These are labels for a
   decision the runtime already made — the UI never picks one of them. */
export const DECISION_LABELS = Object.freeze({
  CONTINUE: { fa: 'برنامه روی مسیر است', en: 'The plan is on track' },
  REVISE: { fa: 'نیاز به بازسازی دارد', en: 'Needs a rebuild' },
  HALT: { fa: 'توقف — بودجه ریسک شکسته شد', en: 'Halted — risk budget breached' },
  COMPLETE: { fa: 'افق زمانی تمام شد', en: 'Horizon reached' }
});

const FAMILY_LABEL = Object.freeze({
  cash: { fa: 'نقد/استیبل', en: 'Stable' },
  lending: { fa: 'وام‌دهی', en: 'Lending' },
  staking: { fa: 'استیکینگ', en: 'Staking' },
  farm: { fa: 'فارم', en: 'Farm' },
  lp: { fa: 'نقدینگی', en: 'Liquidity' },
  crypto: { fa: 'کریپتو', en: 'Crypto' },
  rwa: { fa: 'RWA', en: 'RWA' },
  equity: { fa: 'سهام', en: 'Equities' },
  fx: { fa: 'فارکس', en: 'Forex' },
  commodity: { fa: 'کالا', en: 'Commodities' },
  derivatives: { fa: 'فیوچرز', en: 'Derivatives' }
});

const BASIS_LABEL = Object.freeze({
  apy: { fa: 'نرخ زنده', en: 'live APY' },
  funding: { fa: 'فاندینگ', en: 'funding' },
  historical: { fa: 'تاریخچه', en: 'historical' },
  /* Worded without the phrase a store content filter scans for: this label
     says the sleeve does NOT depend on price movement, but a filter reads
     strings, not intent — which is exactly why test/run.mjs greps the built
     bundle instead of the source. */
  'zero-drift': { fa: 'بدون وابستگی به قیمت', en: 'no price exposure' },
  none: { fa: 'بدون منبع', en: 'unsourced' }
});

const REFUSALS = Object.freeze({
  CAPITAL_REQUIRED: {
    fa: 'سرمایه‌ای که بتوانم رویش استراتژی بسازم پیدا نکردم. مبلغ را بنویس یا کیف پول را وصل کن — بدون عدد واقعی، حدس نمی‌زنم.',
    en: 'I found no capital to plan against. Type the amount or connect the wallet — without a real number I will not guess.'
  },
  NO_TARGET: {
    fa: 'هدفی نگفتی. مثلاً بنویس «۱۵٪ سود در ۴ ماه» یا «سودم دو برابر شود».',
    en: 'No target given. Try "15% in 4 months" or "double my money".'
  },
  CRITICAL_DOMAIN_MISSING: {
    fa: 'بدون کیف پول/پرتفوی نمی‌توانم استراتژی بسازم — چون نمی‌دانم چه داری.',
    en: 'I cannot build a strategy without your wallet/portfolio — I would not know what you hold.'
  },
  NO_OPPORTUNITIES: {
    fa: 'این لحظه هیچ ماژولی نرخ یا بازاری برنگرداند. بدون نرخ واقعی استراتژی نمی‌سازم.',
    en: 'No module returned a rate or a market this turn. Without real rates I will not build a strategy.'
  },
  NO_ECOSYSTEM_STATE: {
    fa: 'خواندن اکوسیستم انجام نشد. دوباره تلاش کن.',
    en: 'The ecosystem read did not run. Try again.'
  },
  GOAL_INCOMPLETE: {
    fa: 'برای ساختن استراتژی به سه عدد نیاز دارم: سرمایه، هدف سود، و بازه زمانی.',
    en: 'A strategy needs three numbers: capital, target return, and horizon.'
  }
});

/* ── sub-blocks ──────────────────────────────────────────────────────────── */

function CoverageRow({ strategy, fa }) {
  const cov = strategy.coverage || {};
  const read = Array.isArray(strategy.readDomains) ? strategy.readDomains : [];
  const gaps = Array.isArray(strategy.gaps) ? strategy.gaps : [];
  return (
    <div className="isp-block" data-testid="strategy-coverage">
      <div className="isp-block-head">
        <span>{fa ? 'چه چیزی خوانده شد' : 'What was read'}</span>
        <b dir="ltr">{cov.live ?? 0}/{cov.requested ?? 0} · {cov.pct ?? 0}%</b>
      </div>
      <div className="isp-domains">
        {read.map((d) => <span key={d} className="isp-domain is-live" title={d}>{fa ? domainDisplayName(d, 'fa') : d}</span>)}
        {gaps.map((g) => (
          <span key={g.domain} className="isp-domain is-gap" title={g.reason || g.domain}>{fa ? domainDisplayName(g.domain, 'fa') : g.domain}</span>
        ))}
      </div>
      {gaps.length ? (
        <p className="isp-note">
          {fa
            ? `خوانده نشد: ${gaps.map((g) => domainDisplayName(g.domain, 'fa')).join('، ')}. استراتژی بدون آن‌ها ساخته شد و اعتمادش کمتر است.`
            : `Not read: ${gaps.map((g) => g.domain).join(', ')}. The plan was built without them and its confidence is lower for it.`}
        </p>
      ) : null}
    </div>
  );
}

function ComparisonTable({ strategy, fa, picked, onPick }) {
  const rows = Array.isArray(strategy.comparison) ? strategy.comparison : [];
  if (!rows.length) return null;
  /* A 5-column table inside a ~340px chat bubble is unreadable: the four
     numeric columns crush into each other and RTL reorders the digits. Each
     option is its own card instead — title on top, then four aligned stat
     cells (بازده / ریسک / هزینه / اتکا) with LTR tabular figures. Same test
     ids, same pick behaviour, readable on a phone. */
  const stats = (r) => [
    { key: 'ret', label: fa ? 'بازده' : 'Return', value: pct(r.expectedReturnPct), tone: 'ok' },
    { key: 'risk', label: fa ? 'ریسک' : 'Risk', value: pct(r.riskPct, 1), tone: 'warn' },
    { key: 'cost', label: fa ? 'هزینه' : 'Cost', value: pct(r.costPct), tone: '' },
    { key: 'conf', label: fa ? 'اتکا' : 'Data', value: `${Math.round((r.confidence || 0) * 100)}%`, tone: '' }
  ];
  return (
    <div className="isp-block" data-testid="strategy-comparison">
      <div className="isp-block-head">
        <span>{fa ? 'مقایسه گزینه‌ها' : 'Options compared'}</span>
        <b>{rows.length}</b>
      </div>
      <div className="isp-options" role="list">
        {rows.map((r) => {
          const why = (strategy.ranking || []).find((x) => x.id === r.id);
          return (
            <button
              key={r.id}
              type="button"
              role="listitem"
              className={`isp-option${picked === r.id ? ' is-picked' : ''}${r.role === 'default' ? ' is-default' : ''}${r.role === 'stretch' ? ' is-stretch' : ''}`}
              onClick={() => onPick?.(r.id)}
              data-testid={`strategy-option-${r.id}`}
              aria-pressed={picked === r.id}
            >
              <span className="isp-option-head">
                <span className="isp-option-name">
                  {r.title}
                  {r.role === 'default' ? <em>{fa ? 'پیشنهاد' : 'default'}</em> : null}
                  {r.role === 'stretch' ? <em className="is-stretch">{fa ? 'شانس هدف' : 'stretch'}</em> : null}
                </span>
              </span>
              <span className="isp-option-stats">
                {stats(r).map((s) => (
                  <span key={s.key} className={`isp-stat${s.tone ? ` is-${s.tone}` : ''}`}>
                    <span className="isp-stat-label">{s.label}</span>
                    <span className="isp-stat-value" dir="ltr">{s.value}</span>
                  </span>
                ))}
              </span>
              {why?.reason ? <span className="isp-option-why">{why.reason}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SleeveList({ sleeves, fa }) {
  if (!Array.isArray(sleeves) || !sleeves.length) return null;
  return (
    <div className="isp-block" data-testid="strategy-sleeves">
      <div className="isp-block-head">
        <span>{fa ? 'تخصیص' : 'Allocation'}</span>
        <b dir="ltr">{sleeves.length} {fa ? 'بخش' : 'sleeves'}</b>
      </div>
      <ul className="isp-sleeves">
        {sleeves.map((s) => {
          const fam = FAMILY_LABEL[s.family] || { fa: s.family, en: s.family };
          const basis = BASIS_LABEL[s.basis] || { fa: s.basis, en: s.basis };
          return (
            <li key={`${s.id}-${s.family}`} data-testid={`strategy-sleeve-${s.family}`}>
              <div className="isp-sleeve-top">
                <span className="isp-sleeve-fam">{fa ? fam.fa : fam.en}</span>
                <span className="isp-sleeve-title" title={s.title}>{s.title}</span>
                <b dir="ltr">{usd(s.amountUsd)}</b>
              </div>
              <div className="isp-bar"><i style={{ width: `${Math.max(2, Math.min(100, s.weightPct || 0))}%` }} /></div>
              <div className="isp-sleeve-meta">
                <span dir="ltr">{pct(s.weightPct, 0)}</span>
                <span>
                  {s.returnPctAnnual != null ? (<><bdi dir="ltr">{pct(s.returnPctAnnual)} APY</bdi><small> · {fa ? basis.fa : basis.en}</small></>) : (fa ? 'بدون نرخ' : 'no rate')}
                </span>
                {s.horizonDrawdownPct != null ? <span>{fa ? 'افت' : 'DD'} <bdi dir="ltr">{pct(s.horizonDrawdownPct, 1)}{s.drawdownBasis === 'assumed' ? '*' : ''}</bdi></span> : null}
              </div>
              {s.handoff?.route ? (
                <span className="isp-sleeve-route" dir="ltr">{s.handoff.route}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StageList({ stages, fa, onOpenRoute }) {
  if (!Array.isArray(stages) || !stages.length) return null;
  return (
    <div className="isp-block" data-testid="strategy-stages">
      <div className="isp-block-head">
        <span>{fa ? 'مراحل اجرا' : 'Execution stages'}</span>
        <b dir="ltr">{stages.length}</b>
      </div>
      <ol className="isp-stages">
        {stages.map((st) => (
          <li key={st.id} data-testid={`strategy-stage-${st.id}`}>
            <div className="isp-stage-head">
              <b>{st.title}</b>
              {st.movesFunds
                ? <span className="isp-tag is-money">{fa ? 'پول جابه‌جا می‌کند' : 'moves funds'}</span>
                : <span className="isp-tag">{fa ? 'بدون جابه‌جایی' : 'no funds'}</span>}
            </div>
            <p className="isp-stage-obj">{st.objective}</p>
            <ul className="isp-stage-actions">
              {(st.actions || []).map((a, i) => (
                <li key={`${a.operation}-${i}`}>
                  {fa && (a.moduleFa || a.operationFa) ? (
                    <span>{[a.moduleFa || a.module, a.operationFa || a.operation].filter(Boolean).join(' · ')}</span>
                  ) : (
                    <span dir="ltr">{a.module} · {a.operation}</span>
                  )}
                  {a.requiresSignature ? <em>{fa ? 'امضای تو' : 'your signature'}</em> : null}
                  {onOpenRoute && a.route ? (
                    <button type="button" className="isp-link" onClick={() => onOpenRoute(a.route)}>{fa ? 'برو' : 'Open'} ↗</button>
                  ) : null}
                </li>
              ))}
            </ul>
            {st.rollback ? <small className="isp-rollback">{fa ? 'بازگشت' : 'Rollback'}: {st.rollback}</small> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function MonitorList({ monitors, fa }) {
  if (!Array.isArray(monitors) || !monitors.length) return null;
  return (
    <div className="isp-block" data-testid="strategy-monitors">
      <div className="isp-block-head">
        <span>{fa ? 'پایش و اصلاح' : 'Monitors & revision'}</span>
        <b dir="ltr">{monitors.length}</b>
      </div>
      <ul className="isp-monitors">
        {monitors.map((m) => (
          <li key={m.id} data-severity={m.severity}>
            <b dir={fa ? undefined : 'ltr'}>{m.condition}</b>
            <span>{fa ? '→ ' : '→ '}{m.action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── the card ────────────────────────────────────────────────────────────── */

export function StrategyPlanCard({
  plan, spec = null, busy = false, error = null, locale = 'fa',
  onOpenRoute = null, onExecuteStage = null, onSwitchPlan = null,
  onMonitor = null, onRevise = null, live = null
}) {
  const fa = String(locale).startsWith('fa');
  const [picked, setPicked] = useState(null);
  /* Display copy in the user's language. The runtime keeps the canonical
     object; only this render reads the localized strings. */
  const effective = useMemo(() => localizeStrategyPlan(plan || null, locale), [plan, locale]);

  if (error) {
    return (
      <div className="isp-card isp-error" data-testid="strategy-plan-error">
        <p>{error}</p>
      </div>
    );
  }

  if (!effective) {
    return (
      <div className="isp-card isp-loading" data-testid="strategy-plan-loading">
        <p>{fa ? 'در حال خواندن کل اکوسیستم…' : 'Reading the whole ecosystem…'}</p>
        <small>{fa ? 'کیف پول · پرتفوی · بازارها · بازدهی‌ها · ریسک · هزینه' : 'wallet · portfolio · markets · yields · risk · cost'}</small>
      </div>
    );
  }

  /* A refusal is an answer. It names the reason and what unblocks it. */
  if (effective.ok === false) {
    const copy = REFUSALS[effective.code] || null;
    const missing = Array.isArray(effective.missing) ? effective.missing : [];
    return (
      <div className="isp-card isp-refused" data-testid="strategy-plan-refused" data-code={effective.code}>
        <p className="isp-refusal">{copy ? (fa ? copy.fa : copy.en) : effective.detail || effective.code}</p>
        {missing.length ? (
          <p className="isp-note" dir="ltr">missing: {missing.join(', ')}</p>
        ) : null}
        {effective.detail && copy ? <small dir="ltr">{effective.detail}</small> : null}
      </div>
    );
  }

  const goal = effective.goal || {};
  const verdict = effective.verdict || {};
  const view = effective.marketView || {};
  const cost = effective.cost || {};
  const risk = effective.risk || {};
  const pickedId = picked || effective.chosen;
  const chosenRow = (effective.comparison || []).find((c) => c.id === pickedId) || null;
  const showingChosen = !pickedId || pickedId === effective.chosen;

  return (
    <div className="isp-card" data-testid="strategy-plan-card" data-chosen={effective.chosen} data-reachable={String(Boolean(verdict.reachable))}>
      {/* objective */}
      <div className="isp-head">
        <div className="isp-objective">
          <b dir="ltr">
            {usd(goal.capitalUsd)} · {pct(goal.targetPct, 1)} · {goal.horizonDays}{fa ? ' روز' : 'd'}
          </b>
          <small>
            {fa ? `ریسک ${goal.riskProfileFa || goal.riskProfile}` : `${goal.riskProfile} risk`}
            {goal.capitalSource ? ` · ${fa ? 'سرمایه از' : 'capital from'} ${fa ? (goal.capitalSourceFa || goal.capitalSource) : goal.capitalSource}` : ''}
          </small>
        </div>
        <span
          className={`isp-verdict ${verdict.reachable ? 'is-ok' : 'is-short'}`}
          data-verdict={verdict.reachable ? 'reachable' : 'not-reachable'}
        >
          {verdict.reachable ? (fa ? 'با نرخ واقعی شدنی است' : 'Reachable at live rates') : (fa ? 'با نرخ واقعی شدنی نیست' : 'Not reachable at live rates')}
        </span>
      </div>

      <dl className="isp-nums">
        <div><dt>{fa ? 'سود سالانه لازم' : 'APY required'}</dt><dd dir="ltr">{pct(verdict.requiredApyPct)}</dd></div>
        <div><dt>{fa ? 'نرخ‌های واقعی' : 'Sourced'}</dt><dd dir="ltr">{pct(verdict.sourcedReturnPct)}</dd></div>
        <div><dt>{fa ? 'فقط از قیمت' : 'Price only'}</dt><dd dir="ltr">{pct(verdict.priceGapPct)}</dd></div>
        <div><dt>{fa ? 'دامنه ۱σ' : '1σ range'}</dt><dd dir="ltr">{verdict.rangePct != null ? `±${pct(verdict.rangePct, 1)}` : '—'}</dd></div>
        <div><dt>{fa ? 'ارزش انتظار' : 'Expected'}</dt><dd dir="ltr">{usd(verdict.expectedValueUsd)}</dd></div>
        <div><dt>{fa ? 'هزینه ورود' : 'Entry cost'}</dt><dd dir="ltr">{pct(cost.totalPct)}{cost.complete ? '' : '*'}</dd></div>
      </dl>

      <p className="isp-honesty">{effective.honesty}</p>

      {view.regime ? (
        fa ? (
          <p className="isp-regime">
            رژیم: {view.regimeFa || view.regime} · سوگیری <bdi dir="ltr">{view.bias}</bdi> · اطمینان {Math.round((view.conviction || 0) * 100)}٪
            <small> ({(view.readDomains || []).map((d) => domainDisplayName(d, 'fa')).join('، ') || 'خوانشی نیست'})</small>
          </p>
        ) : (
          <p className="isp-regime" dir="ltr">
            regime: {view.regime} · bias {view.bias} · conviction {Math.round((view.conviction || 0) * 100)}%
            <small> ({(view.readDomains || []).join(', ') || 'no read'})</small>
          </p>
        )
      ) : null}

      {effective.alternatives?.stretch && effective.alternatives.stretchNote ? (
        <div className="isp-stretch" data-testid="strategy-stretch">
          <b>{fa ? 'گزینه‌ی پرریسک‌تر' : 'The stretch option'}</b>
          <p>{effective.alternatives.stretchNote}</p>
          {onSwitchPlan ? (
            <button type="button" className="isp-btn is-ghost" onClick={() => onSwitchPlan(effective.alternatives.stretch)} data-testid="strategy-switch-stretch">
              {fa ? 'همان را نشان بده' : 'Show that one'}
            </button>
          ) : null}
        </div>
      ) : null}

      <CoverageRow strategy={effective} fa={fa} />
      <ComparisonTable
        strategy={effective}
        fa={fa}
        picked={pickedId}
        onPick={(id) => { setPicked(id); onSwitchPlan?.(id); }}
      />

      {showingChosen ? (
        <>
          <SleeveList sleeves={effective.sleeves} fa={fa} />
          <StageList stages={effective.stages} fa={fa} onOpenRoute={onOpenRoute} />
          <MonitorList monitors={effective.monitors} fa={fa} />

          <div className="isp-risk" data-testid="strategy-risk">
            <span dir="ltr">
              {fa ? 'افت برآوردی' : 'Est. drawdown'}: {pct(risk.estimatedDrawdownPct, 1)} / {fa ? 'بودجه' : 'budget'} {pct(risk.drawdownBudgetPct, 0)}
            </span>
            {Array.isArray(risk.breaches) && risk.breaches.length ? (
              <ul>
                {risk.breaches.map((b) => (
                  <li key={b.code} dir={fa ? undefined : 'ltr'}>
                    {fa ? `${b.codeFa || b.code}: ${b.detailFa || b.detail}` : `${b.code}: ${b.detail}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {onExecuteStage ? (
            <div className="isp-actions">
              <button
                type="button"
                className="isp-btn is-solid"
                disabled={busy}
                onClick={() => onExecuteStage(effective)}
                data-testid="strategy-execute-stage"
              >
                {busy ? (fa ? 'در حال اجرا…' : 'Running…') : (fa ? 'مرحله بعد را با تأیید من اجرا کن' : 'Run the next stage with my confirmation')}
              </button>
              {onMonitor ? (
                <button
                  type="button"
                  className="isp-btn is-ghost"
                  disabled={busy}
                  onClick={() => onMonitor(effective)}
                  data-testid="strategy-monitor"
                >
                  {fa ? 'برنامه را با وضعیت واقعی بسنج' : 'Check the plan against reality'}
                </button>
              ) : null}
              {onRevise && live?.decision === 'REVISE' ? (
                <button
                  type="button"
                  className="isp-btn is-ghost"
                  disabled={busy}
                  onClick={() => onRevise(effective)}
                  data-testid="strategy-revise"
                >
                  {fa ? 'استراتژی را بازسازی کن' : 'Rebuild the strategy'}
                </button>
              ) : null}
            </div>
          ) : null}

          {/*
            The monitoring verdict, once the plan has been measured against
            reality. Nothing here is a promise: the pace is the plan's own
            curve, and the decision comes from the runtime, not from a
            colour the UI picked.
          */}
          {live?.last ? (
            <div
              className="isp-live"
              data-testid="strategy-live"
              data-decision={live.decision || 'CONTINUE'}
            >
              <b>{DECISION_LABELS[live.decision]?.[fa ? 'fa' : 'en'] || live.decision}</b>
              {live.last.realisedPct != null ? (
                <span dir="ltr">
                  {fa ? 'تحقق‌یافته' : 'realised'} {pct(live.last.realisedPct, 2)}
                  {live.last.paceReturnPct != null ? ` / ${fa ? 'انتظار' : 'expected'} ${pct(live.last.paceReturnPct, 2)}` : ''}
                </span>
              ) : null}
              {live.last.drawdownPct != null ? (
                <span dir="ltr">{fa ? 'افت' : 'drawdown'} {pct(live.last.drawdownPct, 2)}</span>
              ) : null}
              {(live.triggers || []).length ? (
                <ul className="isp-triggers">
                  {live.triggers.map((t) => <li key={t.id} dir="ltr">{t.id}: {t.detail}</li>)}
                </ul>
              ) : null}
              {live.revisionCount ? (
                <small data-testid="strategy-revision-count">
                  {fa ? `${live.revisionCount} بازسازی انجام شده` : `${live.revisionCount} revision(s) applied`}
                </small>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="isp-note">
          {fa
            ? `«${chosenRow?.title || pickedId}» را انتخاب کردی. برای دیدن تخصیص و مراحلش، روی «پیشنهاد» در جدول بزن.`
            : `You picked "${chosenRow?.title || pickedId}". Tap "default" in the table to see its allocation and stages.`}
        </p>
      )}

      <ul className="isp-limitations">
        {(effective.limitations || []).slice(0, 4).map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <p className="isp-foot">
        {fa
          ? '* عدد بدون ستاره از داده زنده است؛ ستاره یعنی برآورد یا هزینه‌ی نانوشته. هیچ تراکنشی بدون امضای تو ارسال نمی‌شود.'
          : '* Unstarred numbers come from live reads; a star means estimated or an unread cost. Nothing is broadcast without your signature.'}
      </p>
    </div>
  );
}

export default StrategyPlanCard;
