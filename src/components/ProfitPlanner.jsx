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
 *
 * ─── WHY THE BUILD BUTTON LOOKED DEAD ─────────────────────────────────────
 * Reported: «برنامه سود پس از زدن دکمه برنامه ساخت در اینتنت os کار نمیده و
 * کاری انجام نمیده». The request itself was fine — the screen was not:
 *
 *   1. The button's only feedback was a text swap to "Asking the live venues…"
 *      with no spinner, so on a slow connection there was no sign the tap had
 *      landed at all.
 *   2. The results rendered BELOW a tall form, outside the viewport. The plan
 *      arrived, the button reverted to its idle label, and nothing appeared to
 *      have happened — the evidence was off-screen.
 *   3. A failure printed one fixed sentence and threw away everything the
 *      server said, including its own error code, so a 502 and a network
 *      blackout looked identical.
 *
 * The build now has a spinner and an elapsed counter, scrolls its own result
 * into view, carries a client-side timeout so it can never hang, and reports
 * the server's actual code alongside the human sentence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const RISK_OPTIONS = ['conservative', 'balanced', 'aggressive'];

/* The server caps each venue feed at 12s and answers in parallel, so a healthy
   build is a couple of seconds. 30s is a ceiling, not an expectation: past it
   we stop waiting and say so rather than leaving the button spinning. */
const BUILD_TIMEOUT_MS = 30_000;

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
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef(null);
  const resultRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /* A visible clock, not just a disabled button: with four upstream feeds
     behind it, a build can legitimately take several seconds, and "how long
     has this been going" is the whole difference between waiting and thinking
     it is broken. */
  useEffect(() => {
    if (state.phase !== 'loading') return undefined;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  const build = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    /* Abandon the request on the client shortly after the server's own feed
       deadline, so a wedged connection cannot hold the button hostage. */
    const timer = setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS);

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
        }),
        signal: controller.signal
      });

      let body = null;
      try {
        body = await res.json();
      } catch {
        /* An HTML error page from a proxy is not JSON. Say what happened
           rather than crashing on it. */
        if (!aliveRef.current) return;
        setState({
          phase: 'error',
          body: null,
          code: `HTTP_${res.status}`,
          detail: t('intentOS.plan.badResponse', { defaultValue: 'The server answered with something that was not a plan.' })
        });
        return;
      }

      if (!aliveRef.current) return;
      setState(res.ok && body?.ok
        ? { phase: 'done', body }
        : { phase: 'error', body, code: body?.code || `HTTP_${res.status}`, detail: body?.detail || null });
    } catch (error) {
      if (!aliveRef.current) return;
      const timedOut = error?.name === 'AbortError';
      setState({
        phase: 'error',
        body: null,
        code: timedOut ? 'BUILD_TIMED_OUT' : 'NETWORK_UNREACHABLE',
        detail: timedOut
          ? t('intentOS.plan.timedOut', { defaultValue: 'The venue feeds did not answer within 30 seconds.' })
          : String(error?.message || '').slice(0, 120)
      });
    } finally {
      clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [form.capitalUsd, form.horizonDays, form.riskProfile, form.targetMode, form.targetValue, lang, t]);

  /* The result is rendered below a tall form. Without this, a successful build
     looks exactly like a failed one: the button goes idle and the screen does
     not appear to change. */
  useEffect(() => {
    if (state.phase !== 'done' && state.phase !== 'error') return;
    const node = resultRef.current;
    if (!node || typeof node.scrollIntoView !== 'function') return;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [state.phase]);

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

  const reach = plan?.targetReachability || null;
  const loading = state.phase === 'loading';

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

        <button
          type="button"
          className="btn btn-primary ios-compile"
          onClick={build}
          disabled={loading}
          data-testid="profit-plan-build"
        >
          {loading ? (
            <>
              <span className="ios-build-spinner" aria-hidden="true" />
              {t('intentOS.plan.building', { defaultValue: 'Asking the live venues…' })}
              {elapsed > 0 && <span className="ios-build-elapsed">{elapsed}s</span>}
            </>
          ) : t('intentOS.plan.build', { defaultValue: 'Build the plan' })}
        </button>

        {loading && (
          <p className="ios-build-hint" role="status">
            {t('intentOS.plan.buildHint', { defaultValue: 'Reading stocks, dYdX, perpetuals and farm yields. Nothing is executed.' })}
          </p>
        )}
      </section>

      {state.phase === 'error' && (
        <section className="ios-honesty-note is-error" ref={resultRef} data-testid="profit-plan-error">
          <strong>{t('intentOS.plan.failed', { defaultValue: 'The plan could not be built — the venue feeds did not answer. Try again in a moment.' })}</strong>
          {state.code && <code className="ios-plan-code">{state.code}</code>}
          {state.detail && <span className="ios-plan-detail">{state.detail}</span>}
          <button type="button" className="ia-ctl" onClick={build}>
            {t('intentOS.plan.retry', { defaultValue: 'Try again' })}
          </button>
        </section>
      )}

      {state.phase === 'done' && plan && (
        <>
          <section className="ios-plan-summary" ref={resultRef} data-testid="profit-plan-summary">
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
              {reach && reach.yearsEstimate !== null && reach.yearsEstimate !== undefined && (
                <span><b>{reach.yearsEstimate}y</b>{t('intentOS.plan.yearsEstimate', { defaultValue: 'years at current rates' })}</span>
              )}
            </div>
            {reach?.reason && (
              <p className="ios-plan-reason">{t('intentOS.plan.why', { defaultValue: 'Why' })} · <code>{reach.reason}</code></p>
            )}
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
            {Array.isArray(plan.venuesMissing) && plan.venuesMissing.length > 0 && (
              <p className="ios-plan-reason">
                {t('intentOS.plan.noData', { defaultValue: 'no data' })}: {plan.venuesMissing.map((k) => t(`intentOS.plan.class.${k}`, { defaultValue: k })).join(' · ')}
              </p>
            )}
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
