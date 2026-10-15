import React, { useEffect, useState } from 'react';
import { LOOP_RUN_STATE, LOOP_STEP_STATE } from '../../lib/loopExecution.js';
import { loanErrorText } from '../../lib/loanErrors.js';
import { formatFactor, formatPct, formatToken, hfTone, shortHash, tr } from './loopFormat.js';

/** Loop-specific sentence first, then the Loan page's shared error vocabulary. */
export function loopErrorText(t, code) {
  if (!code) return '';
  if (typeof t === 'function') {
    const own = t(`loan.loop.exec.code.${code}`, { defaultValue: '' });
    if (own) return own;
  }
  return loanErrorText(t, code);
}

const KIND_ICON = {
  supply: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12" /><path d="m6 10 6 6 6-6" /><path d="M5 20h14" /></svg>
  ),
  borrow: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V8" /><path d="m6 14 6-6 6 6" /><path d="M5 4h14" /></svg>
  ),
  swap: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3" /><path d="M17 17H6l3 3" /></svg>
  )
};
const CHECK = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
);

/** Amount shown for a step: what was signed, else what was resolved, else the plan (≈). */
function stepAmount(step, steps, plan) {
  const market = plan?.market ?? {};
  const decimals = step.id === 'supply' ? market.collateralDecimals : market.borrowDecimals;
  const source = step.amountFromKey ? steps.find((s) => s.key === step.amountFromKey) : null;
  const exact = step.executedWei ?? step.prepared?.amountWei ?? (step.fixedAmount ? step.amountWei : null);
  if (exact != null) return { wei: exact, decimals, approx: false };
  if (step.id === 'swap' && source) {
    const fromSource = source.executedWei ?? source.prepared?.amountWei ?? null;
    if (fromSource != null) return { wei: fromSource, decimals, approx: false };
    return { wei: source.plannedWei ?? null, decimals, approx: true };
  }
  if (step.id === 'supply' && source?.receivedWei) return { wei: source.receivedWei, decimals, approx: false };
  return { wei: step.plannedWei ?? step.projectedWei ?? null, decimals, approx: true };
}

export function describeStep(t, step, steps, plan) {
  const { wei, decimals, approx } = stepAmount(step, steps, plan);
  const amount = `${approx ? '≈ ' : ''}${formatToken(wei, decimals)}`;
  if (step.id === 'swap') {
    return tr(t, 'loan.loop.exec.step.swap', { amount, from: step.fromSymbol ?? '', to: step.toSymbol ?? '' });
  }
  return tr(t, `loan.loop.exec.step.${step.id}`, { amount, symbol: step.symbol ?? step.asset?.symbol ?? '' });
}

function StepList({ t, steps, plan, currentIndex = -1, explorerTxUrl, preview = false }) {
  return (
    <ol className={`loop-steps${preview ? ' is-preview' : ''}`} data-testid={preview ? 'loop-steps-preview' : 'loop-steps'}>
      {steps.map((step, index) => {
        const state = preview ? LOOP_STEP_STATE.PENDING : (step.runState || LOOP_STEP_STATE.PENDING);
        const current = !preview && index === currentIndex && state !== LOOP_STEP_STATE.DONE;
        const txUrl = step.hash && typeof explorerTxUrl === 'function' ? explorerTxUrl(step.hash) : null;
        const approvalUrl = step.approvalHash && typeof explorerTxUrl === 'function' ? explorerTxUrl(step.approvalHash) : null;
        const hf = step.prepared?.projectedHealthFactor ?? step.projectedHealthFactor ?? null;
        return (
          <li
            key={step.key ?? index}
            className={`loop-step is-${state}${current ? ' is-current' : ''}`}
            data-testid={`loop-step-${index}`}
            data-state={state}
            data-kind={step.id}
          >
            <span className="loop-step-node" aria-hidden="true">
              {state === LOOP_STEP_STATE.DONE ? CHECK
                : state === LOOP_STEP_STATE.FAILED || state === LOOP_STEP_STATE.BLOCKED ? '!'
                  : state === LOOP_STEP_STATE.SKIPPED ? '–'
                    : <bdi dir="ltr">{index + 1}</bdi>}
            </span>
            <div className="loop-step-body">
              <div className="loop-step-title">
                <span className={`loop-step-kind is-${step.id}`} aria-hidden="true">{KIND_ICON[step.id]}</span>
                <strong><bdi>{describeStep(t, step, steps, plan)}</bdi></strong>
              </div>
              <div className="loop-step-meta">
                <span>{step.round === 0 ? tr(t, 'loan.loop.exec.initial') : tr(t, 'loan.loop.exec.round', { n: step.round })}</span>
                {step.id !== 'swap' && hf != null && Number.isFinite(Number(hf)) && (
                  <span className={`is-${hfTone(hf)}`}><bdi dir="ltr">HF → {formatFactor(hf)}</bdi></span>
                )}
                {approvalUrl && (
                  <a href={approvalUrl} target="_blank" rel="noreferrer noopener" data-testid={`loop-step-${index}-approval`}>
                    {tr(t, 'loan.loop.exec.viewApproval')} <bdi dir="ltr">{shortHash(step.approvalHash)}</bdi>
                  </a>
                )}
                {txUrl && (
                  <a href={txUrl} target="_blank" rel="noreferrer noopener" data-testid={`loop-step-${index}-tx`}>
                    {tr(t, 'loan.loop.exec.viewTx')} <bdi dir="ltr">{shortHash(step.hash)}</bdi> ↗
                  </a>
                )}
              </div>
            </div>
            {!preview && <span className={`loop-step-state is-${state}`}>{tr(t, `loan.loop.exec.state.${state}`)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function QuoteCard({ t, quote, remaining, maxAgeMs }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const meta = quote?.metadata ?? {};
  const left = Math.max(0, Math.ceil((Number(quote?.quotedAt) + maxAgeMs - now) / 1000));
  const assessment = remaining?.assessment ?? null;
  const rows = [
    ['youSwap', formatToken(meta.amountInWei, meta.fromDecimals, meta.fromSymbol)],
    ['expected', formatToken(meta.amountOutWei, meta.toDecimals, meta.toSymbol)],
    ['minimum', formatToken(meta.minOutWei, meta.toDecimals, meta.toSymbol)],
    ['fee', `${formatPct(Number(meta.feeBps ?? 0) / 100)}${meta.platformFeeWei ? ` · ${formatToken(meta.platformFeeWei, meta.fromDecimals, meta.fromSymbol)}` : ''}`],
    ['worstLoss', assessment ? formatPct(assessment.worstLossPct) : '—'],
    ['hfAfter', remaining?.projectedHealthFactor != null ? formatFactor(remaining.projectedHealthFactor) : '—']
  ];
  return (
    <div className="loop-quote" data-testid="loop-quote-review">
      <div className="loop-quote-head">
        <strong>{tr(t, 'loan.loop.exec.quote.title')}</strong>
        <span className={`loop-chip ${left > 0 ? 'is-live' : 'is-warn'}`} data-testid="loop-quote-timer">
          {left > 0 ? tr(t, 'loan.loop.exec.quote.validFor', { s: left }) : tr(t, 'loan.loop.exec.quote.expired')}
        </span>
      </div>
      <dl className="loop-quote-grid">
        {rows.map(([key, value]) => (
          <div key={key}><dt>{tr(t, `loan.loop.exec.quote.${key}`)}</dt><dd><bdi dir="ltr">{value}</bdi></dd></div>
        ))}
      </dl>
      {meta.source && <p className="loop-muted">{tr(t, 'loan.loop.exec.quote.route', { source: meta.source })}</p>}
    </div>
  );
}

const STATUS_TONE = {
  [LOOP_RUN_STATE.REVIEW]: 'soft',
  [LOOP_RUN_STATE.SIMULATING]: 'wait',
  [LOOP_RUN_STATE.READY]: 'live',
  [LOOP_RUN_STATE.QUOTE_REVIEW]: 'live',
  [LOOP_RUN_STATE.RUNNING]: 'wait',
  [LOOP_RUN_STATE.PAUSED]: 'warn',
  [LOOP_RUN_STATE.PARTIAL]: 'warn',
  [LOOP_RUN_STATE.FAILED]: 'danger',
  [LOOP_RUN_STATE.COMPLETED]: 'live',
  [LOOP_RUN_STATE.CANCELLED]: 'soft'
};

/**
 * Stage 2 — the guided execution. One click = one transaction; every amount
 * is re-resolved, re-checked and simulated right before its signature.
 */
export default function LoopRunner({
  t,
  gate,
  plan,
  run,
  runPlan,
  busy = false,
  quoteMaxAgeMs = 15_000,
  canStart = false,
  hasDebt = false,
  currentHealthFactor = null,
  chainName = '',
  onStart,
  onAdvance,
  onStop,
  onResume,
  onReset,
  onConnect,
  onSwitchChain,
  onOpenPositions,
  explorerTxUrl
}) {
  const status = run?.status ?? null;
  const steps = run?.steps ?? plan?.steps ?? [];
  const usedPlan = runPlan ?? plan;
  const total = steps.length;
  const done = run?.completed?.length ?? 0;
  const current = run && run.stepIndex < total ? run.steps[run.stepIndex] : null;
  const finished = status === LOOP_RUN_STATE.COMPLETED;
  const resumable = [LOOP_RUN_STATE.PAUSED, LOOP_RUN_STATE.PARTIAL, LOOP_RUN_STATE.FAILED, LOOP_RUN_STATE.CANCELLED].includes(status)
    && run.stepIndex < total;
  const errorCode = run?.error?.code ?? null;
  const errorDetail = run?.error?.detail;
  const detailText = typeof errorDetail === 'string' ? errorDetail
    : typeof errorDetail?.detail === 'string' ? errorDetail.detail : null;

  let action = 'prepare';
  let actionLabel = tr(t, 'loan.loop.exec.prepare', { n: plan?.steps?.length ?? 0 });
  let actionDisabled = !canStart;
  let onAction = onStart;
  if (run) {
    if (busy || status === LOOP_RUN_STATE.SIMULATING || status === LOOP_RUN_STATE.RUNNING || status === LOOP_RUN_STATE.REVIEW) {
      action = 'busy';
      actionLabel = tr(t, `loan.loop.exec.phase.${run.phase || (status === LOOP_RUN_STATE.RUNNING ? 'signing' : 'preflight')}`);
      actionDisabled = true;
      onAction = undefined;
    } else if (status === LOOP_RUN_STATE.READY && current) {
      action = 'sign';
      actionLabel = tr(t, 'loan.loop.exec.sign', { n: run.stepIndex + 1, total, label: describeStep(t, current, run.steps, usedPlan) });
      actionDisabled = !gate?.allowed;
      onAction = onAdvance;
    } else if (status === LOOP_RUN_STATE.QUOTE_REVIEW) {
      action = 'confirm-quote';
      actionLabel = tr(t, 'loan.loop.exec.confirmSwap');
      actionDisabled = !gate?.allowed;
      onAction = onAdvance;
    } else if (resumable) {
      action = 'resume';
      actionLabel = tr(t, 'loan.loop.exec.resume');
      actionDisabled = !gate?.allowed;
      onAction = onResume;
    } else if (finished) {
      action = 'open-positions';
      actionLabel = tr(t, 'loan.loop.exec.openPositions');
      actionDisabled = typeof onOpenPositions !== 'function';
      onAction = onOpenPositions;
    } else {
      action = 'reset';
      actionLabel = tr(t, 'loan.loop.exec.newPlan');
      actionDisabled = false;
      onAction = onReset;
    }
  }

  return (
    <section
      className="loop-section is-exec"
      data-testid="loop-execution-gate"
      data-gate={gate?.reason || 'ready'}
      data-run={status || 'idle'}
    >
      <header className="loop-section-head">
        <span className="loop-section-index" aria-hidden="true">2</span>
        <h3>{tr(t, 'loan.loop.exec.title')}</h3>
        {run ? (
          <span className={`loop-chip is-${STATUS_TONE[status] || 'soft'}`} data-testid="loop-run-status">
            <span className="loop-chip-dot" aria-hidden="true" />
            {tr(t, `loan.loop.exec.status.${status}`)}
          </span>
        ) : gate?.allowed ? (
          <span className="loop-chip is-live"><span className="loop-chip-dot" aria-hidden="true" />{tr(t, 'loan.loop.exec.ready')}</span>
        ) : null}
      </header>

      {!gate?.allowed && (
        <div className="loop-callout is-warn" role="status" data-testid="loop-execution-block-reason">
          <p>{tr(t, `loan.loop.execution.${gate?.reason || 'FLAG_DISABLED'}`, { chain: chainName })}</p>
          {gate?.reason === 'WALLET_REQUIRED' && typeof onConnect === 'function' && (
            <button type="button" className="loop-btn is-soft" data-testid="loop-connect" onClick={onConnect}>
              {tr(t, 'loan.loop.exec.connect')}
            </button>
          )}
          {gate?.reason === 'WRONG_NETWORK' && typeof onSwitchChain === 'function' && (
            <button type="button" className="loop-btn is-soft" data-testid="loop-switch-network" onClick={onSwitchChain}>
              {tr(t, 'loan.loop.exec.switchNetwork', { chain: chainName })}
            </button>
          )}
        </div>
      )}

      {!run && (
        <>
          <p className="loop-muted">{tr(t, 'loan.loop.exec.intro')}</p>
          {plan?.ok && <StepList t={t} steps={plan.steps} plan={plan} preview />}
          {gate?.allowed && !plan?.ok && (
            <p className="loop-note" data-testid="loop-execution-plan-blocked">{tr(t, 'loan.loop.exec.fixPlan')}</p>
          )}
        </>
      )}

      {run && (
        <>
          <div className="loop-progress" data-testid="loop-progress" aria-label={tr(t, 'loan.loop.exec.progress', { done, total })}>
            <div className="loop-progress-track">
              <span className="loop-progress-fill" style={{ inlineSize: `${total ? Math.round((done / total) * 100) : 0}%` }} />
            </div>
            <span className="loop-progress-text"><bdi dir="ltr">{done}/{total}</bdi></span>
          </div>
          <StepList t={t} steps={run.steps} plan={usedPlan} currentIndex={run.stepIndex} explorerTxUrl={explorerTxUrl} />

          {status === LOOP_RUN_STATE.QUOTE_REVIEW && run.currentQuote && (
            <QuoteCard t={t} quote={run.currentQuote} remaining={run.remainingSimulation} maxAgeMs={quoteMaxAgeMs} />
          )}

          {busy && run.phase && (
            <p className="loop-phase" data-testid="loop-phase" role="status">
              <span className="loop-spinner" aria-hidden="true" />
              {tr(t, `loan.loop.exec.phase.${run.phase}`)}
            </p>
          )}

          {errorCode && !finished && (
            <div
              className={`loop-callout ${status === LOOP_RUN_STATE.FAILED || status === LOOP_RUN_STATE.PARTIAL ? 'is-danger' : 'is-warn'}`}
              role="alert"
              data-testid="loop-run-error"
              data-code={errorCode}
            >
              <p><strong>{tr(t, `loan.loop.exec.status.${status}`)}</strong> — {loopErrorText(t, errorCode)}</p>
              {detailText && <p className="loop-mono">{detailText}</p>}
              {status === LOOP_RUN_STATE.PAUSED && <p>{tr(t, 'loan.loop.exec.nothingSent')}</p>}
            </div>
          )}

          {finished && (
            <div className="loop-success" data-testid="loop-complete" role="status">
              <span className="loop-success-mark" aria-hidden="true">{CHECK}</span>
              <div>
                <strong>{tr(t, 'loan.loop.exec.completeTitle', { n: done })}</strong>
                {run.endedEarly && <p>{tr(t, 'loan.loop.exec.endedEarly')}</p>}
                {currentHealthFactor != null && (
                  <p>
                    {tr(t, 'loan.loop.exec.hfNow')}: <bdi dir="ltr" className={`is-${hfTone(currentHealthFactor)}`}>{formatFactor(currentHealthFactor)}</bdi>
                  </p>
                )}
              </div>
            </div>
          )}

          {run.unwindSuggested && (
            <p className="loop-callout is-warn" data-testid="loop-partial-unwind-note">
              {tr(t, 'loan.loop.execution.partial')} {tr(t, 'loan.loop.execution.unwind')}
            </p>
          )}
        </>
      )}

      <div className="loop-actions">
        <button
          type="button"
          className="loop-cta"
          data-testid="loop-execution-button"
          data-action={action}
          disabled={actionDisabled}
          aria-disabled={actionDisabled ? 'true' : undefined}
          onClick={actionDisabled ? undefined : onAction}
        >
          {action === 'busy' && <span className="loop-spinner" aria-hidden="true" />}
          <span>{actionLabel}</span>
        </button>
        {run && !finished && !resumable && status !== LOOP_RUN_STATE.CANCELLED && (
          <button type="button" className="loop-btn is-ghost" data-testid="loop-stop" onClick={onStop} disabled={Boolean(run.stopRequested)}>
            {tr(t, status === LOOP_RUN_STATE.RUNNING ? 'loan.loop.exec.stopAfter' : 'loan.loop.exec.stop')}
          </button>
        )}
        {run && (finished || resumable || status === LOOP_RUN_STATE.CANCELLED) && (
          <button type="button" className="loop-btn is-ghost" data-testid="loop-reset" onClick={onReset} disabled={busy}>
            {tr(t, 'loan.loop.exec.newPlan')}
          </button>
        )}
      </div>

      <p className="loop-muted" data-testid="loop-no-automation">{tr(t, 'loan.loop.execution.notAutomatic')}</p>
      {!run && hasDebt && (
        <p className="loop-note" data-testid="loop-existing-debt-note">{tr(t, 'loan.loop.exec.existingDebt')}</p>
      )}
    </section>
  );
}
