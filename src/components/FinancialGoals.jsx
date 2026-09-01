/**
 * FBT FINANCIAL OS — Financial Goals.
 * ---------------------------------------------------------------------------
 * The whole product in three screens, and nothing internal in sight:
 *
 *     My Goals          → what you are working toward, and how it is going
 *     Build My Plan     → required return · risk score · allocation · scenarios
 *     Review Plan       → Approve / Edit / Cancel
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   · No execution. Approving a plan produces an intent payload and hands it
 *     to the existing Intent OS (`financialGoalIntent.js`); the wallet is
 *     still the only thing that can move funds, and this component never
 *     touches a key or a seed phrase.
 *   · No invented numbers. Every figure comes back from the server, which
 *     computes it from the user's own inputs plus live (haircut) venue data.
 *     When a feed is dead the screen says "no live data" instead of filling
 *     the gap.
 *   · No guarantee language. Required return is labelled REQUIRED, and the
 *     honest note under every plan says the return is not promised.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  approveGoal,
  analyzeGoal,
  buildPlan as buildPlanRequest,
  createGoal,
  goalProgress,
  listGoals,
  pauseGoal,
  readGoalSentence,
  simulateGoal as simulateGoalRequest,
  whatIfGoal
} from '../lib/financialGoals';
import { handOffToIntentOS } from '../lib/financialGoalIntent';
import { ALLOCATION_ASSETS, RISK_PROFILES } from '../lib/financialGoalEngine';

const RISK_LABEL = { CONSERVATIVE: 'Conservative', MODERATE: 'Moderate', AGGRESSIVE: 'Aggressive' };
const ASSET_LABEL = { BTC: 'BTC', ETH: 'ETH', STABLE: 'Stable / Yield', OTHER: 'Other crypto' };
const STATUS_TONE = {
  ON_TRACK: 'is-good',
  AHEAD: 'is-good',
  COMPLETED: 'is-good',
  BEHIND: 'is-warn',
  AT_RISK: 'is-bad',
  PAUSED: 'is-idle'
};
const STRATEGY_LABEL = { conservative: 'Conservative', moderate: 'Balanced', aggressive: 'Aggressive' };

const money = (value, currency = 'USD') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount >= 1000 ? 0 : 2
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString()}`;
  }
};

const pct = (value) => (Number.isFinite(Number(value)) ? `${Number(value)}%` : '—');

/** A date input needs YYYY-MM-DD, and the goal stores an epoch. */
const fromDateInput = (text) => {
  const parsed = Date.parse(`${String(text || '').slice(0, 10)}T23:59:59Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

const defaultTargetDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 3);
  return d.toISOString().slice(0, 10);
};

const emptyForm = () => ({
  sentence: '',
  name: '',
  startingCapital: '10000',
  targetAmount: '20000',
  targetDate: defaultTargetDate(),
  riskProfile: 'MODERATE',
  monthlyContribution: '0',
  currency: 'USD'
});

export default function FinancialGoals({ onOpenCompose = null }) {
  const { t } = useTranslation();
  const [view, setView] = useState('list');
  const [goals, setGoals] = useState([]);
  const [progress, setProgress] = useState({});
  const [active, setActive] = useState(null);   // { goal, plan }
  const [intent, setIntent] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [handoff, setHandoff] = useState(null);
  const [scope, setScope] = useState(null);   // 'telegram' | 'device'
  /* Goal Engine surfaces: outlook · health · evidence · strategies · futures */
  const [engine, setEngine] = useState(null);        // { outlook, health, evidence, strategies, futures }
  const [whatif, setWhatif] = useState(null);        // last what-if result
  const [simulator, setSimulator] = useState(null);  // last simulator result
  const [selectedStrategy, setSelectedStrategy] = useState('moderate');
  const [whatifBusy, setWhatifBusy] = useState(null);
  const [simBusy, setSimBusy] = useState(null);
  const [simValue, setSimValue] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const result = await listGoals();
    if (!alive.current) return;
    if (!result.ok) {
      setError(result.code);
      return;
    }
    const rows = result.data || [];
    setGoals(rows);
    setScope(result.meta?.scope ?? null);
    setError(null);
    /* Progress is one cheap request per goal, run in parallel — and a failure
       leaves that card without a status rather than emptying the list. */
    const entries = await Promise.all(rows.map(async (goal) => {
      const report = await goalProgress(goal.id);
      return [goal.id, report.ok ? report.data?.progress : null];
    }));
    if (!alive.current) return;
    setProgress(Object.fromEntries(entries));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const patch = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  /* The sentence is read on the device: no model call, so nothing typed here
     leaves the browser. It only ever fills empty-looking fields. */
  const applySentence = () => {
    const parsed = readGoalSentence(form.sentence);
    if (!parsed.matched) return;
    setForm((f) => ({
      ...f,
      startingCapital: parsed.fields.startingCapital ? String(parsed.fields.startingCapital) : f.startingCapital,
      targetAmount: parsed.fields.targetAmount ? String(parsed.fields.targetAmount) : f.targetAmount,
      monthlyContribution: parsed.fields.monthlyContribution ? String(parsed.fields.monthlyContribution) : f.monthlyContribution,
      riskProfile: parsed.fields.riskProfile || f.riskProfile,
      name: f.name || String(form.sentence).slice(0, 60)
    }));
  };

  const submitCreate = async () => {
    setBusy('create');
    setError(null);
    const created = await createGoal({
      name: form.name || t('intentOS.goals.untitled', { defaultValue: 'My goal' }),
      startingCapital: Number(form.startingCapital),
      targetAmount: Number(form.targetAmount),
      targetDate: fromDateInput(form.targetDate),
      riskProfile: form.riskProfile,
      monthlyContribution: Number(form.monthlyContribution) || 0,
      currency: form.currency
    });
    if (!alive.current) return;
    setBusy(null);
    if (!created.ok) {
      setError(created.code);
      return;
    }
    await refresh();
    if (!alive.current) return;
    setActive({ goal: created.data, plan: null });
    setView('plan');
    await runBuildPlan(created.data);
  };

  const runBuildPlan = useCallback(async (goal) => {
    setBusy('plan');
    setError(null);
    const result = await buildPlanRequest(goal.id, {});
    if (!alive.current) return;
    setBusy(null);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setActive({ goal: result.data.goal, plan: result.data.plan });
    setHandoff(null);
    await runAnalyze(result.data.goal.id);
  }, []);

  /* The Goal Engine one-call analysis: probability · range · health ·
     evidence · strategies · futures. Server-owned, execution-free. */
  const runAnalyze = useCallback(async (goalId, currentValueUsd = null) => {
    const result = await analyzeGoal(goalId, currentValueUsd === null ? {} : { currentValueUsd });
    if (!alive.current) return;
    if (result.ok) {
      setEngine(result.data || null);
      setError(null);
    } else {
      // Non-blocking: the plan card still renders from buildPlan; the engine
      // cards simply stay absent rather than showing a fabricated number.
      setEngine((current) => current ? { ...current, error: result.code } : null);
    }
  }, []);

  const runWhatIf = async (change) => {
    if (!active?.goal) return;
    setWhatifBusy(change.type);
    setError(null);
    const result = await whatIfGoal(active.goal.id, { change });
    if (!alive.current) return;
    setWhatifBusy(null);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setWhatif(result.data || null);
  };

  const runSimulator = async (candidates) => {
    if (!active?.goal) return;
    setSimBusy('run');
    setError(null);
    const result = await simulateGoalRequest(active.goal.id, { candidates });
    if (!alive.current) return;
    setSimBusy(null);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setSimulator(result.data || null);
  };

  const pickSimValue = async (value) => {
    setSimValue(value);
    await runSimulator([0, 250, 500, 750, 1000, 1500]);
  };

  /* Load the monthly → probability table once per goal so the Forecast card
     is useful the moment a plan opens, not just after a click. */
  useEffect(() => {
    if (active?.goal && !simulator) {
      runSimulator([0, 250, 500, 750, 1000, 1500]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.goal?.id]);

  const openGoal = async (goal) => {
    setActive({ goal, plan: null });
    setIntent(null);
    setHandoff(null);
    setView('plan');
    await runBuildPlan(goal);
  };

  const approve = async () => {
    if (!active?.plan) return;
    setBusy('approve');
    setError(null);
    const result = await approveGoal(active.goal.id);
    if (!alive.current) return;
    setBusy(null);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setActive({ goal: result.data.goal, plan: result.data.plan });
    setIntent(result.data.intent);
    setView('review');
    await refresh();
  };

  const togglePause = async (goal) => {
    const paused = goal.status !== 'PAUSED';
    setBusy('pause');
    const result = await pauseGoal(goal.id, paused);
    if (!alive.current) return;
    setBusy(null);
    if (result.ok) {
      await refresh();
      if (active?.goal?.id === goal.id) setActive((a) => (a ? { ...a, goal: result.data.goal } : a));
    } else {
      setError(result.code);
    }
  };

  const openInIntentOS = () => {
    if (!intent) return;
    const result = handOffToIntentOS({ goal: active.goal, intent });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHandoff({ intentId: result.intentId, kind: result.kind, blocked: result.blocked, skipped: result.skipped });
    /* The draft lands in the existing compose tab, which already owns review,
       signing and execution. Nothing is executed on the way there. */
    if (typeof onOpenCompose === 'function') onOpenCompose();
  };

  const currentProgress = active?.goal ? progress[active.goal.id] : null;

  const allocationRows = useMemo(() => {
    const rows = active?.plan?.allocation || [];
    const byAsset = new Map(rows.map((row) => [row.asset, Number(row.percentage)]));
    return ALLOCATION_ASSETS.map((asset) => ({ asset, percentage: byAsset.get(asset) ?? 0 }));
  }, [active]);

  const goalYears = useMemo(() => {
    const goal = active?.goal;
    if (!goal) return null;
    const years = (Number(goal.targetDate) - Number(goal.createdAt)) / (365.25 * 24 * 3600_000);
    return Number.isFinite(years) ? Math.round(years * 10) / 10 : null;
  }, [active]);

  return (
    <div className="fg-root" data-testid="financial-goals">
      {/* ── screen 1: my goals ───────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          <section className="fg-head">
            <div>
              <span className="fg-glyph" aria-hidden="true">✦</span>
              <strong>{t('intentOS.goals.title', { defaultValue: 'Financial Goals' })}</strong>
            </div>
            <button type="button" className="fg-create" onClick={() => { setForm(emptyForm()); setView('create'); setError(null); }} data-testid="fg-create-goal">
              + {t('intentOS.goals.create', { defaultValue: 'Create Goal' })}
            </button>
          </section>

          <section className="fg-list-card">
            <div className="fg-card-head">
              <strong>{t('intentOS.goals.myGoals', { defaultValue: 'My Goals' })}</strong>
              <small>{goals.length}</small>
            </div>

            {scope === 'device' && (
              <p className="fg-note" data-testid="fg-device-scope">
                {t('intentOS.goals.deviceScope', { defaultValue: 'These goals are saved for this device. Sign in with Telegram to keep them across devices.' })}
              </p>
            )}

            {goals.length === 0 && (
              <p className="fg-empty">
                {t('intentOS.goals.empty', { defaultValue: 'No goals yet. Create one and the app will work out what return it needs.' })}
              </p>
            )}

            {goals.map((goal) => {
              const report = progress[goal.id];
              const reported = report?.valueReported === true;
              const value = reported ? report.currentValueUsd : goal.startingCapital;
              return (
                <article key={goal.id} className="fg-goal" data-testid="fg-goal-card">
                  <div className="fg-goal-top">
                    <strong>{goal.name}</strong>
                    <span className={`fg-dot ${reported ? (STATUS_TONE[report.status] || 'is-idle') : 'is-idle'}`} aria-hidden="true" />
                  </div>
                  <div className="fg-goal-value">
                    {money(value, goal.currency)} <span>/ {money(goal.targetAmount, goal.currency)}</span>
                  </div>
                  <div className="fg-goal-meta">
                    <span className={`fg-chip ${reported ? (STATUS_TONE[report.status] || '') : ''}`}>
                      {reported
                        ? t(`intentOS.goals.status.${report.status}`, { defaultValue: report.status })
                        : t('intentOS.goals.noValue', { defaultValue: 'no value reported' })}
                    </span>
                    <span>{RISK_LABEL[goal.riskProfile] || goal.riskProfile}</span>
                    {goal.status === 'PAUSED' && <span>{t('intentOS.goals.paused', { defaultValue: 'Paused' })}</span>}
                  </div>
                  <div className="fg-goal-bar" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, Math.max(0, (Number(value) / Number(goal.targetAmount || 1)) * 100))}%` }} />
                  </div>
                  <div className="fg-goal-actions">
                    <button type="button" className="fg-cta" onClick={() => openGoal(goal)} data-testid="fg-view-plan">
                      {t('intentOS.goals.viewPlan', { defaultValue: 'View Plan' })}
                    </button>
                    <button type="button" className="fg-mini" onClick={() => togglePause(goal)} disabled={busy === 'pause'}>
                      {goal.status === 'PAUSED'
                        ? t('intentOS.goals.resume', { defaultValue: 'Resume' })
                        : t('intentOS.goals.pause', { defaultValue: 'Pause' })}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}

      {/* ── screen 2: create goal ────────────────────────────────────────── */}
      {view === 'create' && (
        <section className="fg-card">
          <div className="fg-card-head">
            <strong>{t('intentOS.goals.newGoal', { defaultValue: 'New goal' })}</strong>
            <button type="button" className="fg-mini" onClick={() => setView('list')}>
              {t('intentOS.goals.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>

          <label className="fg-field">
            <span>{t('intentOS.goals.sentence', { defaultValue: 'In your words (optional)' })}</span>
            <input
              type="text"
              value={form.sentence}
              onChange={patch('sentence')}
              onBlur={applySentence}
              placeholder={t('intentOS.goals.sentenceHint', { defaultValue: 'I want to double my capital in 3 years' })}
              data-testid="fg-sentence"
            />
          </label>

          <div className="fg-grid">
            <label className="fg-field">
              <span>{t('intentOS.goals.goalName', { defaultValue: 'Goal' })}</span>
              <input type="text" value={form.name} onChange={patch('name')} placeholder="Double My Capital" data-testid="fg-name" />
            </label>
            <label className="fg-field">
              <span>{t('intentOS.goals.starting', { defaultValue: 'Starting Capital' })}</span>
              <input type="number" min="0" inputMode="decimal" value={form.startingCapital} onChange={patch('startingCapital')} data-testid="fg-starting" />
            </label>
            <label className="fg-field">
              <span>{t('intentOS.goals.target', { defaultValue: 'Target Amount' })}</span>
              <input type="number" min="0" inputMode="decimal" value={form.targetAmount} onChange={patch('targetAmount')} data-testid="fg-target" />
            </label>
            <label className="fg-field">
              <span>{t('intentOS.goals.targetDate', { defaultValue: 'Target Date' })}</span>
              <input type="date" value={form.targetDate} onChange={patch('targetDate')} data-testid="fg-target-date" />
            </label>
            <label className="fg-field">
              <span>{t('intentOS.goals.monthly', { defaultValue: 'Monthly Contribution' })}</span>
              <input type="number" min="0" inputMode="decimal" value={form.monthlyContribution} onChange={patch('monthlyContribution')} data-testid="fg-monthly" />
            </label>
          </div>

          <div className="fg-field">
            <span>{t('intentOS.goals.risk', { defaultValue: 'Risk' })}</span>
            <div className="fg-risk" role="radiogroup" aria-label="risk profile">
              {RISK_PROFILES.map((profile) => (
                <button
                  key={profile}
                  type="button"
                  role="radio"
                  aria-checked={form.riskProfile === profile}
                  className={form.riskProfile === profile ? 'is-on' : ''}
                  onClick={() => setForm((f) => ({ ...f, riskProfile: profile }))}
                  data-testid={`fg-risk-${profile.toLowerCase()}`}
                >
                  {t(`intentOS.goals.risk.${profile}`, { defaultValue: RISK_LABEL[profile] })}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="fg-cta fg-cta-wide" onClick={submitCreate} disabled={busy === 'create'} data-testid="fg-build-plan">
            {busy === 'create'
              ? t('intentOS.goals.building', { defaultValue: 'Building…' })
              : t('intentOS.goals.buildPlan', { defaultValue: 'Build My Plan' })}
          </button>

          <p className="fg-note">
            {t('intentOS.goals.noGuarantee', { defaultValue: 'The plan is a projection from your numbers and live market data. No return is guaranteed.' })}
          </p>
        </section>
      )}

      {/* ── screen 3: the plan ───────────────────────────────────────────── */}
      {(view === 'plan' || view === 'review') && active?.goal && (
        <>
          <section className="fg-head">
            <div>
              <span className="fg-glyph" aria-hidden="true">✦</span>
              <strong>{active.goal.name}</strong>
            </div>
            <button type="button" className="fg-mini" onClick={() => { setView('list'); setIntent(null); setHandoff(null); }}>
              {t('intentOS.goals.back', { defaultValue: 'My Goals' })}
            </button>
          </section>

          <section className="fg-summary">
            <div className="fg-summary-grid">
              <div><small>{t('intentOS.goals.starting', { defaultValue: 'Starting' })}</small><b>{money(active.goal.startingCapital, active.goal.currency)}</b></div>
              <div><small>{t('intentOS.goals.target', { defaultValue: 'Target' })}</small><b>{money(active.goal.targetAmount, active.goal.currency)}</b></div>
              <div><small>{t('intentOS.goals.risk', { defaultValue: 'Risk' })}</small><b>{RISK_LABEL[active.goal.riskProfile] || active.goal.riskProfile}</b></div>
              <div><small>{t('intentOS.goals.horizon', { defaultValue: 'Horizon' })}</small><b>{goalYears === null ? '—' : t('intentOS.goals.years', { defaultValue: '{{years}}y', years: goalYears })}</b></div>
            </div>
          </section>

          {/* ── GOAL HEALTH ─────────────────────────────────────────────── */}
          {engine?.health && (
            <section className="fg-card" data-testid="fg-goal-health">
              <div className="fg-card-head">
                <strong>{t('intentOS.goals.healthTitle', { defaultValue: 'GOAL HEALTH' })}</strong>
                <span className={`fg-chip ${STATUS_TONE[engine.health.status] || ''}`}>
                  {t(`intentOS.goals.status.${engine.health.status}`, { defaultValue: engine.health.status })}
                </span>
              </div>
              <div className="fg-health-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={engine.health.healthPct}>
                <span style={{ width: `${engine.health.healthPct}%` }} />
              </div>
              <div className="fg-health-value">{engine.health.healthPct}%</div>
              <div className="fg-metrics">
                <div className="fg-metric">
                  <small>{t('intentOS.goals.healthProb', { defaultValue: 'Goal Probability' })}</small>
                  <b>{engine.health.probabilityPct === null ? '—' : `${engine.health.probabilityPct}%`}</b>
                </div>
                <div className="fg-metric">
                  <small>{t('intentOS.goals.healthBehind', { defaultValue: 'Behind Schedule' })}</small>
                  <b>{engine.health.behindPct > 0 ? `${engine.health.behindPct}%` : '0%'}</b>
                </div>
              </div>
              {engine.health.suggestions && engine.health.suggestions.length > 0 && (
                <div className="fg-health-suggestions" data-testid="fg-health-suggestions">
                  <strong className="fg-sub">{t('intentOS.goals.healthSuggest', { defaultValue: 'Suggested adjustment' })}</strong>
                  {engine.health.suggestions.map((suggestion) => (
                    <p key={suggestion.kind}>
                      {suggestion.kind === 'increaseMonthly' && t('intentOS.goals.healthAddMonthly', { defaultValue: 'Increase contribution by {{amount}}/month.', amount: money(suggestion.detail, active.goal.currency) })}
                      {suggestion.kind === 'reduceTarget' && t('intentOS.goals.healthReduceTarget', { defaultValue: 'Reduce the target by {{amount}}.', amount: money(suggestion.detail, active.goal.currency) })}
                      {suggestion.kind === 'extendTimeline' && t('intentOS.goals.healthExtend', { defaultValue: 'Extend the timeline by {{months}} month(s).', months: suggestion.detail })}
                      {suggestion.kind === 'reviewPlan' && t('intentOS.goals.healthReview', { defaultValue: 'Review the plan settings.' })}
                    </p>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── PROFIT PLAN: probability, range, strategies, futures ────── */}
          {engine?.outlook && (
            <section className="fg-card" data-testid="fg-profit-plan">
              <div className="fg-card-head">
                <strong>{t('intentOS.goals.profitPlan', { defaultValue: 'PROFIT PLAN' })}</strong>
                <small>{t('intentOS.goals.assumptionNote', { defaultValue: 'assumption-based, not a forecast' })}</small>
              </div>
              <div className="fg-probability">
                <div className="fg-probability-value">
                  <b>{engine.outlook.probabilityPct === null ? '—' : `${engine.outlook.probabilityPct}%`}</b>
                  <small>{t('intentOS.goals.goalProbability', { defaultValue: 'Goal Probability' })}</small>
                </div>
                <div className="fg-probability-bar" aria-hidden="true">
                  <i style={{ width: `${engine.outlook.probabilityPct || 0}%` }} />
                </div>
              </div>
              <div className="fg-range">
                <div><small>{t('intentOS.goals.scenario.bear', { defaultValue: 'Bear' })}</small><b>{money(engine.outlook.range.bear, active.goal.currency)}</b></div>
                <div><small>{t('intentOS.goals.scenario.base', { defaultValue: 'Base' })}</small><b>{money(engine.outlook.range.base, active.goal.currency)}</b></div>
                <div><small>{t('intentOS.goals.scenario.bull', { defaultValue: 'Bull' })}</small><b>{money(engine.outlook.range.bull, active.goal.currency)}</b></div>
              </div>

              {engine.strategies?.rows?.length > 0 && (
                <div className="fg-strategies" data-testid="fg-strategies">
                  <strong className="fg-sub">{t('intentOS.goals.strategies', { defaultValue: 'Choose your risk' })}</strong>
                  <div className="fg-strategy-grid">
                    {engine.strategies.rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className={`fg-strategy ${selectedStrategy === row.id ? 'is-on' : ''}`}
                        onClick={() => setSelectedStrategy(row.id)}
                        data-testid={`fg-strategy-${row.id}`}
                      >
                        <strong>{t(`intentOS.goals.strategy.${row.id}`, { defaultValue: STRATEGY_LABEL[row.id] })}</strong>
                        <span>{t('intentOS.goals.expectedReturn', { defaultValue: 'Expected Return' })} <b>{pct(row.expectedReturnPct)}</b></span>
                        <span>{t('intentOS.goals.maxDrawdown', { defaultValue: 'Max Drawdown' })} <b>{pct(row.maxDrawdownPct)}</b></span>
                        <span>{t('intentOS.goals.goalProbability', { defaultValue: 'Goal Probability' })} <b>{row.probabilityPct === null ? '—' : `${row.probabilityPct}%`}</b></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {engine.futures && (
                <div className="fg-futures" data-testid="fg-futures">
                  <strong className="fg-sub">{t('intentOS.goals.futuresExposure', { defaultValue: 'Futures Exposure' })}</strong>
                  <div className="fg-metrics">
                    <div className="fg-metric"><small>{t('intentOS.goals.futuresRec', { defaultValue: 'Recommended' })}</small><b>{pct(engine.futures.recommendedPct)}</b></div>
                    <div className="fg-metric"><small>{t('intentOS.goals.futuresMax', { defaultValue: 'Maximum Allowed' })}</small><b>{pct(engine.futures.maximumPct)}</b></div>
                    <div className="fg-metric"><small>{t('intentOS.goals.futuresRisk', { defaultValue: 'Risk Contribution' })}</small><b>{engine.futures.riskContribution}</b></div>
                  </div>
                  {engine.futures.warning && (
                    <p className={`fg-warn ${engine.futures.reducesProbability ? '' : 'fg-warn-soft'}`}>{engine.futures.warning}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {busy === 'plan' && (
            <p className="fg-note" role="status">{t('intentOS.goals.building', { defaultValue: 'Building…' })}</p>
          )}

          {active.plan && (
            <>
              <section className="fg-card" data-testid="fg-plan">
                <div className="fg-card-head">
                  <strong>{t('intentOS.goals.yourPlan', { defaultValue: 'YOUR PLAN' })}</strong>
                  <small>{active.plan.market?.live
                    ? t('intentOS.goals.marketLive', { defaultValue: 'live market data' })
                    : t('intentOS.goals.marketDead', { defaultValue: 'no live market data' })}</small>
                </div>

                <div className="fg-metrics">
                  <div className="fg-metric">
                    <small>{t('intentOS.goals.requiredReturn', { defaultValue: 'Required Return' })}</small>
                    <b data-testid="fg-required-return">{pct(active.plan.requiredReturnPct)}</b>
                    <em>{t('intentOS.goals.requiredNote', { defaultValue: 'per year · projection, not a promise' })}</em>
                  </div>
                  <div className="fg-metric">
                    <small>{t('intentOS.goals.riskScore', { defaultValue: 'Risk Score' })}</small>
                    <b data-testid="fg-risk-score">{active.plan.riskScore}<span>/100</span></b>
                    <em>{active.plan.riskBand}</em>
                  </div>
                </div>

                <div className="fg-alloc" data-testid="fg-allocation">
                  <strong className="fg-sub">{t('intentOS.goals.allocation', { defaultValue: 'Allocation' })}</strong>
                  {allocationRows.map((row) => (
                    <div key={row.asset} className="fg-alloc-row">
                      <span>{t(`intentOS.goals.asset.${row.asset}`, { defaultValue: ASSET_LABEL[row.asset] })}</span>
                      <div className="fg-alloc-bar" aria-hidden="true"><i style={{ width: `${row.percentage}%` }} /></div>
                      <b>{row.percentage}%</b>
                    </div>
                  ))}
                </div>

                <div className="fg-scenarios" data-testid="fg-scenarios">
                  <strong className="fg-sub">{t('intentOS.goals.scenarios', { defaultValue: 'Projected Scenarios' })}</strong>
                  <div className="fg-scenario-grid">
                    {(active.plan.scenarios || []).map((scenario) => (
                      <div key={scenario.id} className={`fg-scenario is-${scenario.id}`}>
                        <small>{t(`intentOS.goals.scenario.${scenario.id}`, { defaultValue: scenario.id })}</small>
                        <b>{money(scenario.projectedUsd, active.goal.currency)}</b>
                        <em>{pct(scenario.ratePct)}</em>
                      </div>
                    ))}
                  </div>
                  <p className="fg-note">
                    {t('intentOS.goals.scenarioNote', { defaultValue: 'Bear = no growth · Base = the live, haircut yield continues · Bull = the goal’s own required return happens. None of them is a forecast.' })}
                  </p>
                  {!active.plan.projectedYieldLive && (
                    <p className="fg-note" data-testid="fg-no-yield">
                      {t('intentOS.goals.noYield', { defaultValue: 'No live yield feed is answering right now, so Base is the same as Bear. The plan is not guessing a yield in its place.' })}
                    </p>
                  )}
                </div>

                {!active.plan.reachable && (
                  <p className="fg-warn" data-testid="fg-unreachable">
                    {active.plan.reachReason === 'BEYOND_REACH'
                      ? t('intentOS.goals.beyondReach', { defaultValue: 'This target needs more than the plan can honestly project. Raise the contribution, extend the date, or lower the target.' })
                      : t('intentOS.goals.cannotCompute', { defaultValue: 'This goal cannot be computed. Check the amounts and the date.' })}
                  </p>
                )}

                <div className="fg-actions">
                  {view === 'plan' && (
                    <button type="button" className="fg-cta" onClick={() => setView('review')} data-testid="fg-create-intent">
                      {t('intentOS.goals.createIntent', { defaultValue: 'Create Intent' })}
                    </button>
                  )}
                  <button type="button" className="fg-mini" onClick={() => runBuildPlan(active.goal)} disabled={busy === 'plan'} data-testid="fg-rebuild">
                    {t('intentOS.goals.rebuild', { defaultValue: 'Rebuild with fresh market data' })}
                  </button>
                </div>
              </section>

              {/* ── monitoring ─────────────────────────────────────────── */}
              {currentProgress && (
                <section className="fg-card" data-testid="fg-progress">
                  <div className="fg-card-head">
                    <strong>{t('intentOS.goals.monitoring', { defaultValue: 'Progress' })}</strong>
                    <span className={`fg-chip ${STATUS_TONE[currentProgress.status] || ''}`}>
                      {t(`intentOS.goals.status.${currentProgress.status}`, { defaultValue: currentProgress.status })}
                    </span>
                  </div>
                  <div className="fg-metrics">
                    <div className="fg-metric">
                      <small>{t('intentOS.goals.current', { defaultValue: 'Current Value' })}</small>
                      <b>{money(currentProgress.currentValueUsd, active.goal.currency)}</b>
                      <em>{t('intentOS.goals.targetValue', { defaultValue: 'target {{value}}', value: money(currentProgress.targetValueUsd, active.goal.currency) })}</em>
                    </div>
                    <div className="fg-metric">
                      <small>{t('intentOS.goals.progress', { defaultValue: 'Progress' })}</small>
                      <b>{currentProgress.progressPct}%</b>
                      <em>{t('intentOS.goals.expectedNow', { defaultValue: 'expected {{value}}', value: money(currentProgress.expectedValueUsd, active.goal.currency) })}</em>
                    </div>
                  </div>
                  <div className="fg-path" aria-hidden="true">
                    <div className="fg-path-expected">
                      {(currentProgress.expectedPath || []).map((point) => (
                        <span key={point.at} style={{ left: `${((point.at - Number(active.goal.createdAt)) / Math.max(1, Number(active.goal.targetDate) - Number(active.goal.createdAt))) * 100}%`, bottom: `${(point.valueUsd / Math.max(1, Number(active.goal.targetAmount))) * 100}%` }} />
                      ))}
                    </div>
                    <div className="fg-path-actual">
                      {(currentProgress.actualPath || []).map((point) => (
                        <span key={point.at} style={{ left: `${((point.at - Number(active.goal.createdAt)) / Math.max(1, Number(active.goal.targetDate) - Number(active.goal.createdAt))) * 100}%`, bottom: `${(point.valueUsd / Math.max(1, Number(active.goal.targetAmount))) * 100}%` }} />
                      ))}
                    </div>
                  </div>
                  <p className="fg-note">
                    {t('intentOS.goals.pathNote', { defaultValue: 'The line is the path the goal needs; the dots are the values you have reported.' })}
                  </p>
                  {!currentProgress.valueReported && (
                    <p className="fg-note">{t('intentOS.goals.reportHint', { defaultValue: 'No value reported yet — the status below the plan is based on your starting capital until you update it.' })}</p>
                  )}
                </section>
              )}

              {/* ── FORECAST: what-if & simulator ───────────────────────── */}
              <section className="fg-card" data-testid="fg-forecast">
                <div className="fg-card-head">
                  <strong>{t('intentOS.goals.forecast', { defaultValue: 'FORECAST' })}</strong>
                  <small>{t('intentOS.goals.forecastNote', { defaultValue: 'what-if · under the same assumption band' })}</small>
                </div>

                <div className="fg-whatif">
                  <strong className="fg-sub">{t('intentOS.goals.whatIf', { defaultValue: 'What if…' })}</strong>
                  <div className="fg-whatif-grid">
                    <button type="button" className="fg-mini" onClick={() => runWhatIf({ type: 'market-shock', asset: 'crypto', changePct: -30 })} disabled={whatifBusy === 'market-shock'} data-testid="fg-whatif-crypto">
                      {t('intentOS.goals.whatIfCrypto', { defaultValue: 'Crypto −30%' })}
                    </button>
                    <button type="button" className="fg-mini" onClick={() => runWhatIf({ type: 'market-shock', asset: 'crypto', changePct: 30 })} disabled={whatifBusy === 'market-shock'} data-testid="fg-whatif-crypto-up">
                      {t('intentOS.goals.whatIfCryptoUp', { defaultValue: 'Crypto +30%' })}
                    </button>
                    <button type="button" className="fg-mini" onClick={() => runWhatIf({ type: 'monthly-delta', deltaUsd: 500 })} disabled={whatifBusy === 'monthly-delta'} data-testid="fg-whatif-monthly">
                      {t('intentOS.goals.whatIfMonthly', { defaultValue: 'Contribution +500/mo' })}
                    </button>
                  </div>

                  {whatifBusy && (
                    <p className="fg-note" role="status">{t('intentOS.goals.computing', { defaultValue: 'Computing…' })}</p>
                  )}
                  {whatif && (
                    <div className="fg-whatif-result" data-testid="fg-whatif-result">
                      <div className="fg-metrics">
                        <div className="fg-metric">
                          <small>{t('intentOS.goals.before', { defaultValue: 'Before' })}</small>
                          <b>{whatif.before?.probabilityPct === null || whatif.before?.probabilityPct === undefined ? '—' : `${whatif.before.probabilityPct}%`}</b>
                        </div>
                        <div className="fg-metric">
                          <small>{t('intentOS.goals.after', { defaultValue: 'After' })}</small>
                          <b>{whatif.after?.probabilityPct === null || whatif.after?.probabilityPct === undefined ? '—' : `${whatif.after.probabilityPct}%`}</b>
                        </div>
                        <div className={`fg-metric ${whatif.delta?.probabilityPct < 0 ? 'is-warn' : 'is-good'}`}>
                          <small>{t('intentOS.goals.delta', { defaultValue: 'Δ' })}</small>
                          <b>{whatif.delta?.probabilityPct === undefined ? '—' : `${whatif.delta.probabilityPct >= 0 ? '+' : ''}${whatif.delta.probabilityPct}%`}</b>
                        </div>
                      </div>
                      {whatif.warnings?.length > 0 && (
                        <p className="fg-warn">{whatif.warnings.join(' · ')}</p>
                      )}
                      <p className="fg-note">{whatif.note || t('intentOS.goals.assumptionNote', { defaultValue: 'assumption-based, not a forecast' })}</p>
                    </div>
                  )}
                </div>

                <div className="fg-simulator">
                  <strong className="fg-sub">{t('intentOS.goals.simulator', { defaultValue: 'Monthly contribution' })}</strong>
                  <div className="fg-sim-grid">
                    {[0, 250, 500, 750, 1000, 1500].map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        className={`fg-chip ${simValue === candidate ? 'is-on' : ''}`}
                        onClick={() => pickSimValue(candidate)}
                        disabled={simBusy === 'run'}
                        data-testid={`fg-sim-${candidate}`}
                      >
                        {t('intentOS.goals.simMonthly', { defaultValue: '{{amount}}', amount: money(candidate, active.goal.currency) })}
                        {simulator?.rows?.find((r) => r.monthlyUsd === candidate) && (
                          <em>{simulator.rows.find((r) => r.monthlyUsd === candidate).probabilityPct}%</em>
                        )}
                      </button>
                    ))}
                  </div>
                  {simBusy && <p className="fg-note" role="status">{t('intentOS.goals.computing', { defaultValue: 'Computing…' })}</p>}
                  {simulator?.rows && simulator.rows.length > 1 && (
                    <div className="fg-sim-table" data-testid="fg-sim-table">
                      {simulator.rows.map((row) => (
                        <div key={row.monthlyUsd} className="fg-sim-row">
                          <span>{money(row.monthlyUsd)}</span>
                          <div className="fg-alloc-bar" aria-hidden="true"><i style={{ width: `${row.probabilityPct}%` }} /></div>
                          <b>{row.probabilityPct}%</b>
                        </div>
                      ))}
                    </div>
                  )}
                  {simulator?.rows?.length === 1 && (
                    <p className="fg-note" data-testid="fg-sim-single">
                      {t('intentOS.goals.simSingle', { defaultValue: 'Contribution {{amount}} → {{probability}}% chance of hitting the target.', amount: money(simulator.rows[0].monthlyUsd), probability: simulator.rows[0].probabilityPct })}
                    </p>
                  )}
                </div>
              </section>

              <section className="fg-honest">
                <strong>{t('intentOS.goals.honestHead', { defaultValue: 'Honest notes' })}</strong>
                <ul>
                  <li>{t('intentOS.goals.honest1', { defaultValue: 'Required return is arithmetic about your own numbers — it is what the goal needs, not what any asset will do.' })}</li>
                  <li>{t('intentOS.goals.honest2', { defaultValue: 'Nothing here is guaranteed and nothing here executes. Approving creates a draft you still review and sign in Intent OS.' })}</li>
                  <li>{t('intentOS.goals.honest3', { defaultValue: 'No price forecast: crypto sleeves are exposure, not income, so only live venue yields are projected.' })}</li>
                </ul>
              </section>
            </>
          )}
        </>
      )}

      {/* ── screen 4: review ─────────────────────────────────────────────── */}
      {view === 'review' && (
        <section className="fg-card" data-testid="fg-review">
          <div className="fg-card-head">
            <strong>{t('intentOS.goals.reviewPlan', { defaultValue: 'REVIEW PLAN' })}</strong>
            <small>{active?.goal?.status || ''}</small>
          </div>

          {!intent && (
            <>
              <ul className="fg-review-list">
                <li><span>{t('intentOS.goals.requiredReturn', { defaultValue: 'Required Return' })}</span><b>{pct(active?.plan?.requiredReturnPct)}</b></li>
                <li><span>{t('intentOS.goals.riskScore', { defaultValue: 'Risk Score' })}</span><b>{active?.plan?.riskScore}/100</b></li>
                <li><span>{t('intentOS.goals.allocation', { defaultValue: 'Allocation' })}</span><b>{(active?.plan?.allocation || []).map((row) => `${row.asset} ${row.percentage}%`).join(' · ')}</b></li>
              </ul>
              <div className="fg-actions">
                <button type="button" className="fg-cta" onClick={approve} disabled={busy === 'approve'} data-testid="fg-approve">
                  {busy === 'approve'
                    ? t('intentOS.goals.approving', { defaultValue: 'Approving…' })
                    : t('intentOS.goals.approve', { defaultValue: 'Approve' })}
                </button>
                <button type="button" className="fg-mini" onClick={() => setView('plan')}>
                  {t('intentOS.goals.edit', { defaultValue: 'Edit' })}
                </button>
                <button type="button" className="fg-mini" onClick={() => { setView('list'); setIntent(null); setHandoff(null); }}>
                  {t('intentOS.goals.cancel', { defaultValue: 'Cancel' })}
                </button>
              </div>
              <p className="fg-note">
                {t('intentOS.goals.approveNote', { defaultValue: 'Approving reviews the plan. It creates an intent for Intent OS — you still review and sign every action, and nothing is executed here.' })}
              </p>
            </>
          )}

          {intent && (
            <>
              <div className="fg-intent" data-testid="fg-intent">
                <small>{intent.source} · {intent.goalId}</small>
                {intent.actions.map((action) => (
                  <div key={action.asset} className="fg-intent-row">
                    <span>{action.type}</span>
                    <b>{action.asset}</b>
                    <em>{action.percentage}%</em>
                    <i>{money(action.amount, intent.currency)}</i>
                  </div>
                ))}
              </div>
              <div className="fg-actions">
                <button type="button" className="fg-cta" onClick={openInIntentOS} data-testid="fg-open-intent">
                  {t('intentOS.goals.openIntent', { defaultValue: 'Open in Intent OS' })}
                </button>
                <button type="button" className="fg-mini" onClick={() => setView('plan')} data-testid="fg-edit-plan">
                  {t('intentOS.goals.edit', { defaultValue: 'Edit' })}
                </button>
              </div>
              {handoff && (
                <p className="fg-note" data-testid="fg-handoff">
                  {handoff.blocked
                    ? t('intentOS.goals.handoffBlocked', { defaultValue: 'The draft is saved but blocked by Intent OS checks. Open Intent OS to see why — nothing was executed.' })
                    : t('intentOS.goals.handoffOk', { defaultValue: 'Draft saved in Intent OS ({{id}}). Review it there and sign — nothing has been executed.', id: handoff.intentId })}
                  {Array.isArray(handoff.skipped) && handoff.skipped.length > 0 && (
                    <>
                      {' '}
                      {t('intentOS.goals.handoffSkipped', { defaultValue: 'Not turned into a trade: {{assets}}.', assets: handoff.skipped.join(', ') })}
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {error && (
        <p className="fg-error" role="alert" data-testid="fg-error">
          {t('intentOS.goals.failed', { defaultValue: 'That did not work' })} · <code>{error}</code>
        </p>
      )}
    </div>
  );
}
