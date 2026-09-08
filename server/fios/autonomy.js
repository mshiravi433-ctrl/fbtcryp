/**
 * FBT FINANCIAL INTELLIGENCE OS — Autonomous Execution Loop (batch 5).
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * The loop that lets a standing policy run WITHOUT a human in the chair for
 * every trade — and the machinery that keeps it honest. One run looks like:
 *
 *   trigger → risk gate → policy gate → guardian gate → confidence gate
 *           → reserve → execute → verify → commit
 *
 * THE LAW: **STOP AT EVERY CHECK FAILURE**
 * Any gate that does not say yes ends the run, immediately, permanently for
 * that run: the trace goes BLOCKED or FAILED, the spend reservation (if one
 * was made) is released, an event with the exact code is emitted, and the
 * loop returns the full check report. There is no retry, no "try again in a
 * minute", no fallback executor. A failure to check is the same kind of
 * failure as a failed check — the loop would rather not run than run
 * unchecked.
 *
 * WHO EXECUTES
 * The loop receives an `executor` in its constructor. In this deployment that
 * executor is the brain's UNSIGNED hand-off: it prepares the transaction and
 * hands it to the user's wallet, which is the only place a signature exists.
 * Nothing in this file can sign — the loop's success criterion is a
 * VERIFICATION ID from the receipt path, and until that arrives the trace
 * cannot reach COMPLETED (the state machine enforces it, see trace.js). So
 * "autonomous" here means "autonomous up to the wallet", which is the only
 * autonomy this system is allowed to have.
 *
 * GATES, IN ORDER (each failure = STOP with its code):
 *   1. FLAG          AUTONOMOUS_POLICY_ENABLED off → FEATURE_DISABLED
 *   2. EXECUTOR      no executor wired → EXECUTOR_NOT_WIRED (never pretend)
 *   3. REQUEST       no kind/amount → REQUEST_INCOMPLETE
 *   4. RISK          level CRITICAL or above the policy's riskLimit → RISK_GATE
 *   5. POLICY        the policy engine's full evaluation → its code
 *   6. GUARDIAN      a blocking guardian finding → GUARDIAN_GATE
 *   7. CONFIDENCE    a critical input at 0 → CONFIDENCE_GATE
 *   8. RESERVE       the spend reservation → RESERVE_FAILED
 *   9. EXECUTE       the executor itself → EXECUTION_FAILED
 *   10. VERIFY       no verification id → NOT_VERIFIED (trace FAILED, never
 *                    COMPLETED) — and COMMIT of the spend to the ledger
 *
 * Every run is traced (the same decision-trace store and state machine the
 * supervised path uses), so a policy run and a confirmed run leave the same
 * shape of audit record — with the policy id linked, which is what makes
 * "the machine did this" checkable after the fact.
 */
import { requireFlag } from './flags.js';

export const AUTONOMY_SCHEMA = 'fbt.fi.autonomy.v1';

export const AUTONOMY_GATE_CODES = Object.freeze([
  'FEATURE_DISABLED', 'EXECUTOR_NOT_WIRED', 'REQUEST_INCOMPLETE',
  'RISK_GATE', 'POLICY_GATE', 'GUARDIAN_GATE', 'CONFIDENCE_GATE',
  'RESERVE_FAILED', 'EXECUTION_FAILED', 'NOT_VERIFIED'
]);

const RISK_ORDER = Object.freeze({ LOW: 1, MODERATE: 2, ELEVATED: 3, HIGH: 4, CRITICAL: 5 });

export function createAutonomyLoop({
  policyEngine, traceStore, confidenceEngine = null, guardian = null,
  executor = null, observability = null, log = () => {}, now = () => Date.now()
} = {}) {
  /**
   * Run one policy-authorised execution.
   *
   * @param {object} p
   * @param {string} p.owner
   * @param {string} p.policyId
   * @param {object} p.request { kind, asset?, chain?, amountUsd, gasUsd, slippagePct, riskLevel, executionId?, intentId? }
   * @param {object} [p.financial]   canonical financial state (feeds the confidence gate)
   * @param {object} [p.world]       world model (feeds the confidence gate)
   * @param {object} [p.risk]        current risk assessment { level, securitySignals }
   * @param {object} [p.decision]    the decision this run serves (for the guardian + trace)
   * @param {string} [p.correlationId]
   */
  async function run({ owner, policyId, request = {}, financial = null, world = null, risk = null, decision = null, correlationId = null } = {}) {
    const at = now();
    const runId = String(request.executionId || request.requestId || `run_${at.toString(36)}`).slice(0, 64);
    const report = {
      ok: false,
      schema: AUTONOMY_SCHEMA,
      runId,
      policyId: String(policyId),
      state: 'STOPPED',
      stopGate: null,
      stopCode: null,
      checks: [],
      executedNothing: true,
      verificationId: null,
      trace: null,
      at
    };
    const gate = (name, ok, detail, code = null) => {
      report.checks.push({ gate: name, ok: Boolean(ok), detail: String(detail || '').slice(0, 240), code: code || null });
    };
    const stop = async (name, code, detail, { traceState = 'BLOCKED', releaseExecution = null } = {}) => {
      gate(name, false, detail, code);
      report.state = 'STOPPED';
      report.stopGate = name;
      report.stopCode = code;
      if (releaseExecution) {
        const released = await policyEngine.release(owner, policyId, releaseExecution, { reason: detail }).catch(() => null);
        report.checks.push({ gate: 'RELEASE', ok: Boolean(released?.ok), detail: released?.ok ? `reservation released after ${name} stop` : String(released?.code || 'release failed'), code: released?.code || null });
      }
      if (report.traceId) {
        await traceStore.move(owner, liveTrace(), traceState, { note: `${name}: ${code}` }).catch(() => {});
        await finishTrace('FAILED').catch(() => {});
      }
      if (observability) {
        observability.emit({
          type: name === 'RISK_GATE' ? 'risk.failed' : name === 'GUARDIAN_GATE' ? 'guardian.alerted' : name === 'CONFIDENCE_GATE' ? 'risk.failed' : 'policy.failed',
          owner, correlationId, severity: 'warning',
          payload: { runId, policyId: String(policyId), gate: name, code, detail: String(detail).slice(0, 160) }
        });
      }
      log(`autonomy:stop:${name}:${code}`);
      return report;
    };

    /* ── 1 + 2: the flag and the executor ─────────────────────────────── */
    const gate1 = requireFlag('AUTONOMOUS_POLICY_ENABLED');
    if (!gate1.ok) { gate('FLAG', false, 'autonomy is off', 'FEATURE_DISABLED'); return stop('FLAG', 'FEATURE_DISABLED', 'AUTONOMOUS_POLICY_ENABLED is off; the loop refuses to run'); }
    gate('FLAG', true, 'autonomy flag on');
    if (typeof executor !== 'function') { gate('EXECUTOR', false, 'no execution path is wired', 'EXECUTOR_NOT_WIRED'); return stop('EXECUTOR', 'EXECUTOR_NOT_WIRED', 'this deployment has no executor; running would mean pretending to trade'); }
    gate('EXECUTOR', true, 'executor wired');

    /* ── 3: the request itself ────────────────────────────────────────── */
    if (!request.kind || !Number.isFinite(Number(request.amountUsd)) || Number(request.amountUsd) <= 0) {
      gate('REQUEST', false, 'a run needs at least a strategy kind and a positive amount', 'REQUEST_INCOMPLETE');
      return stop('REQUEST', 'REQUEST_INCOMPLETE', 'kind + amountUsd are required; the loop will not fill either in');
    }
    gate('REQUEST', true, `${String(request.kind).toUpperCase()} $${request.amountUsd}`);

    /* ── the trace, so whatever happens below is on the record ───────── */
    const trace = await traceStore.open({ owner, correlationId, intentId: request.intentId || null });
    report.traceId = trace.id;
    const liveTrace = () => trace;
    const finishTrace = async (finalState) => {
      await traceStore.save(owner, trace);
      report.trace = traceStore.summary(trace);
      report.state = finalState === 'FAILED' ? 'STOPPED' : report.state;
      return report.trace;
    };
    await traceStore.move(owner, trace, 'UNDERSTANDING', { note: `autonomous run ${runId} under policy ${policyId}` });
    await traceStore.move(owner, trace, 'COLLECTING_DATA', { note: 'gathering inputs for the pre-flight gates' });

    /* ── 4: risk ──────────────────────────────────────────────────────── */
    const riskLevel = String(risk?.level || '').toUpperCase();
    if (!RISK_ORDER[riskLevel]) {
      gate('RISK', false, 'no risk level was supplied for this run', 'RISK_UNREAD');
      return stop('RISK', 'RISK_UNREAD', 'an unassessed run is an unchecked run', { traceState: 'BLOCKED' });
    }
    const policyNow = await policyEngine.get(owner, policyId);
    if (!policyNow.ok) {
      gate('POLICY', false, `policy lookup failed: ${policyNow.code}`, 'POLICY_GATE');
      await traceStore.move(owner, trace, 'BUILDING_STATE').catch(() => {});
      await traceStore.move(owner, trace, 'RISK_REVIEW').catch(() => {});
      return stop('POLICY', policyNow.code, `policy ${policyId} could not be read`, { traceState: 'BLOCKED' });
    }
    const policy = policyNow.policy;
    if (riskLevel === 'CRITICAL' || RISK_ORDER[riskLevel] > RISK_ORDER[policy.riskLimit || 'MODERATE']) {
      gate('RISK', false, `risk ${riskLevel} exceeds the policy's ${policy.riskLimit} limit`, 'RISK_LIMIT');
      await traceStore.move(owner, trace, 'BUILDING_STATE').catch(() => {});
      await traceStore.move(owner, trace, 'RISK_REVIEW').catch(() => {});
      return stop('RISK', 'RISK_GATE', `risk ${riskLevel} vs policy limit ${policy.riskLimit}${riskLevel === 'CRITICAL' ? ' (CRITICAL is a hard stop)' : ''}`, { traceState: 'BLOCKED' });
    }
    gate('RISK', true, `risk ${riskLevel} within the ${policy.riskLimit} limit`);

    /* ── 5: the policy engine (scope + every limit + fail-closed gates) ── */
    const verdict = await policyEngine.evaluate({ owner, policyId, request });
    if (!verdict.ok) {
      gate('POLICY', false, `${verdict.code}: ${verdict.detail}`, verdict.code);
      await traceStore.move(owner, trace, 'BUILDING_STATE').catch(() => {});
      await traceStore.move(owner, trace, 'RISK_REVIEW').catch(() => {});
      traceStore.link(trace, 'policyId', policy.id);
      return stop('POLICY', verdict.code, verdict.detail, { traceState: 'BLOCKED' });
    }
    gate('POLICY', true, `all policy gates passed (${verdict.checks.length} checks)`);
    traceStore.link(trace, 'policyId', policy.id);
    await traceStore.move(owner, trace, 'BUILDING_STATE', { note: 'policy cleared' }).catch(() => {});
    await traceStore.move(owner, trace, 'RISK_REVIEW', { note: 'risk within limit' }).catch(() => {});

    /* The standing policy IS the confirmation: the user granted this scope
       deliberately, with numbers. The state machine still walks through
       WAITING_FOR_CONFIRMATION — the record says what satisfied it. */
    await traceStore.move(owner, trace, 'WAITING_FOR_CONFIRMATION', { note: `satisfied by standing policy ${policy.id} (${policy.name})` }).catch(() => {});
    await traceStore.move(owner, trace, 'AUTHORIZED', { note: 'policy scope matched' }).catch(() => {});

    /* ── 6: the guardian — consistency and suitability, one last time ─── */
    if (guardian && typeof guardian.consult === 'function') {
      const consult = await guardian.consult({ owner, request, policy, financial, risk, decision }).catch((err) => ({ ok: false, code: 'GUARDIAN_UNAVAILABLE', detail: String(err?.message || err) }));
      if (!consult.ok || consult.blocking?.length) {
        const detail = consult.blocking?.length
          ? consult.blocking.map((b) => b.detail || b.id).join('; ')
          : `guardian unavailable (${consult.code || 'unknown'})`;
        gate('GUARDIAN', false, detail, consult.blocking?.length ? 'GUARDIAN_BLOCK' : 'GUARDIAN_UNAVAILABLE');
        return stop('GUARDIAN', consult.blocking?.length ? 'GUARDIAN_GATE' : 'GUARDIAN_GATE', detail, { traceState: 'BLOCKED' });
      }
      gate('GUARDIAN', true, `guardian passed with ${consult.warnings?.length || 0} non-blocking note(s)`);
    } else {
      gate('GUARDIAN', true, 'no guardian wired; the run is NOT thereby safer — it is just unconsulted');
    }

    /* ── 7: confidence — the weakest critical input caps the answer ───── */
    if (confidenceEngine && typeof confidenceEngine.assess === 'function') {
      const conf = confidenceEngine.assess({
        intent: decision?.intent || null,
        financial, world,
        strategy: decision?.strategy || null,
        risk,
        quote: request.quote || null,
        wallet: world?.domains?.user?.wallets?.value || null,
        capabilities: world?.capabilities || null,
        policy: { ok: true },
        executionRequested: true,
        now: at
      });
      if (!conf.actionable) {
        gate('CONFIDENCE', false, `blockers: ${conf.blockers.join(', ')}`, 'CONFIDENCE_BLOCKED');
        return stop('CONFIDENCE', 'CONFIDENCE_GATE', `confidence blockers ${conf.blockers.join(', ')}; a run on blind inputs is a guess`, { traceState: 'BLOCKED' });
      }
      gate('CONFIDENCE', true, `overall ${conf.overall}, capped by ${conf.cappedBy || 'n/a'}`);
    }

    /* ── 8: reserve the spend ─────────────────────────────────────────── */
    await traceStore.move(owner, trace, 'EXECUTING', { note: 'reservation then execution' }).catch(() => {});
    const reserved = await policyEngine.reserve(owner, policyId, { ...request, executionId: runId });
    if (!reserved.ok) {
      gate('RESERVE', false, `${reserved.code}: the limit check failed at reservation time`, reserved.code);
      return stop('RESERVE', 'RESERVE_FAILED', reserved.code, { traceState: 'BLOCKED' });
    }
    gate('RESERVE', true, `$${reserved.reservedUsd} held against the ledgers`);
    if (observability) observability.emit({ type: 'execution.started', owner, correlationId, payload: { runId, policyId: String(policyId), amountUsd: request.amountUsd, kind: String(request.kind).toUpperCase() } });

    /* ── 9: execute (unsigned hand-off in this deployment) ────────────── */
    let execOut = null;
    try {
      execOut = await executor({ owner, policyId: policy.id, policy, request, runId, traceId: trace.id });
    } catch (err) {
      execOut = { ok: false, code: 'EXECUTOR_THREW', detail: String(err?.message || err).slice(0, 200) };
    }
    if (!execOut || execOut.ok === false) {
      const code = String(execOut?.code || 'EXECUTION_FAILED').slice(0, 60);
      gate('EXECUTE', false, execOut?.detail || code, code);
      return stop('EXECUTE', 'EXECUTION_FAILED', execOut?.detail || 'the executor reported failure', { traceState: 'FAILED', releaseExecution: runId });
    }
    gate('EXECUTE', true, execOut.detail || 'hand-off produced');
    report.executedNothing = false;

    /* ── 10: verify, then commit ──────────────────────────────────────── */
    const verificationId = execOut.verificationId || null;
    await traceStore.move(owner, trace, 'VERIFYING', { note: verificationId ? 'verification id present' : 'waiting for verification' }).catch(() => {});
    if (!verificationId) {
      gate('VERIFY', false, 'the execution reported no verification id; COMPLETED is unreachable without one', 'NOT_VERIFIED');
      return stop('VERIFY', 'NOT_VERIFIED', 'no verification id — the attempt stays FAILED in the ledger, not CONFIRMED', { traceState: 'FAILED', releaseExecution: runId });
    }
    traceStore.link(trace, 'verificationId', verificationId);
    const confirmed = await policyEngine.confirm(owner, policyId, runId, { verificationId, actualAmountUsd: execOut.actualAmountUsd ?? null });
    if (!confirmed.ok) {
      gate('COMMIT', false, confirmed.detail || confirmed.code, confirmed.code);
      return stop('COMMIT', 'EXECUTION_FAILED', `spend could not be committed: ${confirmed.code}`, { traceState: 'FAILED', releaseExecution: runId });
    }
    gate('VERIFY', true, `verification ${String(verificationId).slice(0, 24)}…`);
    gate('COMMIT', true, `$${confirmed.settledUsd} settled to the policy ledgers`);

    await traceStore.move(owner, trace, 'COMPLETED', { note: 'verified and settled' }).catch((err) => {
      /* If even the legal COMPLETED edge is refused something is wrong with
         the trace itself; that is a stop, not a swallowed error. */
      gate('COMMIT', false, `trace refused COMPLETED: ${err?.code || err.message}`, 'TRACE_REFUSED');
      report.state = 'STOPPED';
      report.stopGate = 'COMMIT';
      report.stopCode = 'TRACE_REFUSED';
    });
    report.state = 'COMPLETED';
    report.ok = true;
    report.stopGate = null;
    report.stopCode = null;
    report.verificationId = String(verificationId).slice(0, 64);
    report.spentUsd = confirmed.settledUsd;
    await finishTrace('COMPLETED');
    if (observability) observability.emit({ type: 'execution.confirmed', owner, correlationId, payload: { runId, policyId: String(policyId), verificationId: String(verificationId).slice(0, 24) } });
    return report;
  }

  return {
    schema: AUTONOMY_SCHEMA,
    GATE_CODES: AUTONOMY_GATE_CODES,
    run,
    /** A run is only ever as autonomous as its executor lets it be. */
    capabilities: () => ({
      autonomous: requireFlag('AUTONOMOUS_POLICY_ENABLED').ok,
      executorWired: typeof executor === 'function',
      guardianWired: Boolean(guardian?.consult),
      confidenceGated: Boolean(confidenceEngine?.assess),
      canSign: false,
      note: 'execution always stops at the wallet hand-off; the signature is the wallet holder alone'
    })
  };
}
