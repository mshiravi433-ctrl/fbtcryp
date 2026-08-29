/**
 * FBT INTENT AI — Phases 106–116 + 121–130: customer profit-target plan.
 * ---------------------------------------------------------------------------
 * The customer states a profit target; Intent OS asks the four live venue
 * bridges (stocks, dYdX global, futures, farms) and returns a PROPOSAL:
 *
 *   · the localized one-line summary comes back from the server already in
 *     the UI language (12 locales, honest fallback with a visible marker)
 *   · the allocation table shows exactly which class gets what share and
 *     what live yield backs it — a class with no live data says so
 *   · reachability is honest: an unreachable target is reported, never
 *     stretched with leverage
 *   · nothing here executes anything; the confirmation gate and the wallet
 *     remain the only execution path (the plan says so, always)
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const RISK_OPTIONS = ['conservative', 'balanced', 'aggressive'];

export default function ProfitPlanner() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en').slice(0, 2).toLowerCase();
  const [form, setForm] = useState({
    targetMode: 'pct',
    targetValue: '20',
    capitalUsd: '1000',
    horizonDays: '180',
    riskProfile: 'balanced'
  });
  const [state, setState] = useState({ phase: 'idle' }); // idle | loading | done | error

  const build = async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch('/api/intents/v1/profit-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: { mode: form.targetMode, value: Number(form.targetValue) || 0 },
          capitalUsd: Number(form.capitalUsd) || 0,
          horizonDays: Number(form.horizonDays) || 180,
          riskProfile: form.riskProfile,
          lang
        })
      });
      const body = await res.json();
      setState(res.ok && body?.ok ? { phase: 'done', body } : { phase: 'error', body });
    } catch {
      setState({ phase: 'error', body: null });
    }
  };

  const patch = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const plan = state.body?.plan;
  const venues = state.body?.venues;
  const feasible = plan?.targetReachability?.feasible;

  const allocationRows = useMemo(() => (plan?.allocations || []).map((a) => ({
    ...a,
    label: t(`intentOS.plan.class.${a.klass}`, { defaultValue: a.klass }),
    yieldLabel: a.live
      ? (a.expectedYieldPct === null ? '—' : `${a.expectedYieldPct}%`)
      : t('intentOS.plan.noData', { defaultValue: 'no data' })
  })), [plan, t]);

  return (
    <div className="ios-planner" data-testid="intent-os-planner">
      <section className="ios-form-card">
        <div className="row-between ios-section-head">
          <div>
            <span className="ios-step-number">◈</span>
            <strong>{t('intentOS.plan.title', { defaultValue: 'Profit target plan' })}</strong>
          </div>
          <span className="ios-live-dot">{t('intentOS.plan.readOnly', { defaultValue: 'read-only proposal' })}</span>
        </div>

        <div className="ios-grid-2">
          <label className="ios-field">
            <span>{t('intentOS.plan.targetMode', { defaultValue: 'Target in' })}</span>
            <select value={form.targetMode} onChange={patch('targetMode')}>
              <option value="pct">{t('intentOS.plan.pct', { defaultValue: 'Growth %' })}</option>
              <option value="usd">{t('intentOS.plan.usd', { defaultValue: 'Final USDC' })}</option>
            </select>
          </label>
          <label className="ios-field">
            <span>{t('intentOS.plan.targetValue', { defaultValue: 'Target value' })}</span>
            <input type="number" min="0" inputMode="decimal" value={form.targetValue} onChange={patch('targetValue')} />
          </label>
          <label className="ios-field">
            <span>{t('intentOS.plan.capital', { defaultValue: 'Capital (USDC)' })}</span>
            <input type="number" min="0" inputMode="decimal" value={form.capitalUsd} onChange={patch('capitalUsd')} />
          </label>
          <label className="ios-field">
            <span>{t('intentOS.plan.horizon', { defaultValue: 'Horizon (days)' })}</span>
            <input type="number" min="1" max="3650" inputMode="numeric" value={form.horizonDays} onChange={patch('horizonDays')} />
          </label>
          <label className="ios-field">
            <span>{t('intentOS.plan.risk', { defaultValue: 'Risk profile' })}</span>
            <select value={form.riskProfile} onChange={patch('riskProfile')}>
              {RISK_OPTIONS.map((r) => (
                <option key={r} value={r}>{t(`intentOS.plan.risk.${r}`, { defaultValue: r })}</option>
              ))}
            </select>
          </label>
        </div>

        <button type="button" className="btn btn-primary ios-compile" onClick={build} disabled={state.phase === 'loading'}>
          {state.phase === 'loading'
            ? t('intentOS.plan.building', { defaultValue: 'Asking the live venues…' })
            : t('intentOS.plan.build', { defaultValue: 'Build the plan' })}
        </button>
      </section>

      {state.phase === 'error' && (
        <section className="ios-honesty-note is-error">
          {t('intentOS.plan.failed', { defaultValue: 'The plan could not be built — the venue feeds did not answer. Try again in a moment.' })}
        </section>
      )}

      {state.phase === 'done' && plan && (
        <>
          <section className="ios-plan-summary">
            <div className="ios-plan-verdict">
              <span className={`ios-status ${feasible ? 'eligible' : 'unavailable'}`}>
                {feasible
                  ? t('intentOS.plan.reachable', { defaultValue: 'Reachable' })
                  : t('intentOS.plan.unreachable', { defaultValue: 'Not reachable honestly' })}
              </span>
              <strong>{state.body.summary || t('intentOS.plan.summaryMissing', { defaultValue: 'Plan' })}</strong>
            </div>
            <div className="ios-network-metrics">
              <span><b>{plan.projectedAnnualYieldPct}%</b>{t('intentOS.plan.projectedYearly', { defaultValue: 'expected / year' })}</span>
              <span><b>{plan.targetUsdAtHorizon} USDC</b>{t('intentOS.plan.targetAtHorizon', { defaultValue: 'target at horizon' })}</span>
              <span><b>{plan.venuesSeen}/5</b>{t('intentOS.plan.venuesLive', { defaultValue: 'venue classes live' })}</span>
              {plan.targetReachability?.yearsEstimate !== null && (
                <span><b>{plan.targetReachability.yearsEstimate}y</b>{t('intentOS.plan.yearsEstimate', { defaultValue: 'years at current rates' })}</span>
              )}
            </div>
          </section>

          <section className="ios-form-card">
            <div className="row-between ios-section-head">
              <div><span className="ios-step-number">◈</span><strong>{t('intentOS.plan.allocation', { defaultValue: 'Allocation' })}</strong></div>
              <small>{t('intentOS.plan.yieldHaircut', { defaultValue: 'yields are haircut, funding needs a known interval' })}</small>
            </div>
            <div className="ios-alloc-table">
              {allocationRows.map((row) => (
                <div key={row.klass} className={`ios-alloc-row${row.live ? '' : ' is-dead'}`}>
                  <span className="ios-alloc-name">{row.label}</span>
                  <span className="ios-alloc-pct">{row.wantedPct}%</span>
                  <span className="ios-alloc-usd">${row.allocatedUsd}</span>
                  <span className="ios-alloc-yield">{row.yieldLabel}</span>
                  <span className={`ios-status ${row.live ? 'eligible' : 'unavailable'}`}>
                    {row.live ? t('intentOS.plan.live', { defaultValue: 'live' }) : t('intentOS.plan.noData', { defaultValue: 'no data' })}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="ios-honesty-note">
            <strong>{t('intentOS.plan.honestHead', { defaultValue: 'Honest notes' })}</strong>
            <ul>
              <li>{t('intentOS.plan.notGuaranteed', { defaultValue: 'These figures are estimates from live venue data, not promises — returns are not guaranteed.' })}</li>
              <li>{t('intentOS.plan.noAutoExecution', { defaultValue: 'This plan executes nothing. Every action still requires your confirmation and wallet signature.' })}</li>
              {venues?.reasons && Object.entries(venues.reasons).filter(([, reason]) => reason).length > 0 && (
                <li>{t('intentOS.plan.partialFeeds', { defaultValue: 'Some venue feeds are currently unavailable; the plan reports them instead of guessing.' })}</li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
