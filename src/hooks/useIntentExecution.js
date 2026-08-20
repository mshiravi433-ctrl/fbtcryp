/**
 * useIntentExecution — the Execution Core, wired into a screen.
 * ---------------------------------------------------------------------------
 * Keeps the pure modules (lifecycle · exact transaction · RPC preflight ·
 * route policy · recovery · observation) in one place so the swap screen only
 * has to render them.
 *
 * WHAT THIS HOOK OWNS
 *   · the lifecycle record for the current attempt (persisted, sanitized)
 *   · the EPHEMERAL exact transaction request — held in a ref, never in state
 *     and never persisted, because it contains calldata and the sender
 *   · the last preflight result, bound to that request's fingerprints
 *   · the deterministic route decision for the quote round
 *   · the current recovery plan, if any
 *
 * WHAT IT REFUSES TO DO
 *   · send anything (only `submit()` does, and only with a passing preflight)
 *   · re-broadcast on retry
 *   · keep a review alive across a material change
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMaterialChange,
  canRequestSignature,
  diffTerms,
  ensureLifecycle,
  recordReview,
  saveLifecycle,
  termsFingerprint,
  transition
} from '../lib/intentLifecycle';
import {
  buildIntentTransactionRequest,
  isTransactionRequestExpired,
  sendIntentTransaction
} from '../lib/intentTransaction';
import { erc20Reader, simulateIntentTransaction, simulationIsFresh } from '../lib/intentSimulation';
import { candidatesFromQuoteTrace, scoreRoutes } from '../lib/intentRoutePolicy';
import { classifyFailure, failureCodeForSimulation, planRecovery } from '../lib/intentRecovery';
import { FEE_BPS, feeRecipientFor } from '../lib/chains';

const SIM_MAX_AGE_MS = 45_000;

/**
 * The material terms the user consents to.
 *
 * `routeFingerprint` here is the QUOTE fingerprint, not the calldata one, and
 * that distinction matters: rebuilding the same route seconds later produces
 * different bytes (the deadline is encoded in them), so binding the review to
 * calldata would demand a fresh signature for a route that did not change.
 * The quote fingerprint covers what the user actually agreed to — chain, pair,
 * amounts, minimum output, fee, slippage and which solver — and moves the
 * moment any of those do.
 *
 * The recipient is stored as a REFERENCE ('self'), never as an address.
 */
function materialTerms({ chainId, amount, fromToken, toToken, slippage, request }) {
  return {
    chainId: Number(chainId),
    amountIn: String(amount ?? ''),
    fromSymbol: fromToken?.symbol ?? '',
    toSymbol: toToken?.symbol ?? '',
    recipientRef: 'self',
    slippagePct: Number(slippage ?? 0),
    minOut: request?.minOutWei ?? '',
    routeFingerprint: request?.quoteFingerprint ?? ''
  };
}

export default function useIntentExecution({
  intentId = null,
  chainId,
  account = null,
  quote = null,
  fromToken = null,
  toToken = null,
  amount = '',
  slippage = 0.5,
  deadlineMinutes = 20,
  getReadProvider = null,
  active = false
}) {
  const [lifecycle, setLifecycle] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const attempts = useRef(0);
  /* Ephemeral by design: calldata and the sender never enter React state or
     local storage, so a crash dump or a persisted store cannot leak them. */
  const requestRef = useRef(null);
  const recoveryLog = useRef([]);
  /* The terms behind the current approval, kept in memory only so the UI can
     name exactly WHICH field changed instead of saying "something changed". */
  const approvedTermsRef = useRef(null);

  /* Intent-originated swaps are the ones held to the strict gate. */
  const enforced = Boolean(intentId);

  const decision = useMemo(() => {
    if (!quote || quote.error) return null;
    const trace = quote.executionTrace;
    if (!trace?.candidates?.length) return null;
    return scoreRoutes(
      candidatesFromQuoteTrace(trace.candidates, {
        chainId,
        fromSymbol: fromToken?.symbol,
        toSymbol: toToken?.symbol,
        observedAt: trace.observedAt ? Date.parse(trace.observedAt) : null,
        priceSource: trace.selectedSolver ? 'aggregator-usd' : null
      }),
      { now: Date.now() }
    );
  }, [quote, chainId, fromToken?.symbol, toToken?.symbol]);

  const persist = useCallback((record) => {
    if (!record) return null;
    const saved = saveLifecycle(record);
    setLifecycle(saved);
    return saved;
  }, []);

  const advance = useCallback((record, status, reasonCode, detail = null) => {
    if (!record) return null;
    const moved = transition(record, status, { reasonCode, detail });
    return persist(moved.record);
  }, [persist]);

  /* Create (or migrate) the lifecycle once the screen has something real. */
  useEffect(() => {
    if (!enforced) { setLifecycle(null); return; }
    const base = ensureLifecycle({ intentId, origin: 'swap' });
    const validated = ['CREATED'].includes(base.status)
      ? transition(transition(base, 'VALIDATING', { reasonCode: 'SWAP_OPENED' }).record, 'VALIDATED', {
          reasonCode: 'SWAP_OPENED'
        }).record
      : base;
    persist(validated);
  }, [enforced, intentId, persist]);

  /* Quote arrivals move QUOTING → OPTIMIZING and invalidate any old preflight. */
  useEffect(() => {
    if (!enforced || !lifecycle) return;
    if (!quote || quote.error) return;
    if (['SUBMITTED', 'CONFIRMING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(lifecycle.status)) return;
    if (lifecycle.status === 'VALIDATED') {
      const quoting = advance(lifecycle, 'QUOTING', 'QUOTE_ROUND_STARTED');
      if (quoting) advance(quoting, 'OPTIMIZING', 'ROUTE_SELECTED', { policy: decision?.policy ?? null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enforced, quote?.amountOutWei?.toString?.(), lifecycle?.status]);

  const reset = useCallback(() => {
    requestRef.current = null;
    setSimulation(null);
    setRecovery(null);
  }, []);

  /**
   * Build the exact transaction and run the real preflight on it.
   * Returns the simulation result; never throws, never sends.
   */
  const preflight = useCallback(async () => {
    if (!quote || quote.error || !account || !getReadProvider) return null;
    setSimulating(true);
    setRecovery(null);
    try {
      let record = lifecycle;
      if (enforced && record && !['SIMULATING'].includes(record.status)) {
        record = advance(record, 'SIMULATING', 'PREFLIGHT_STARTED') ?? record;
      }

      const built = await buildIntentTransactionRequest({
        chainId,
        account,
        quote,
        fromToken,
        toToken,
        slippage,
        deadlineMinutes,
        expectFeeBps: FEE_BPS,
        expectFeeReceiver: feeRecipientFor(chainId)
      });
      if (!built.ok) {
        const code = built.code === 'QUOTE_EXPIRED' ? 'QUOTE_EXPIRED'
          : built.code === 'UNSUPPORTED_SOURCE' ? null
            : 'ROUTE_CHANGED';
        if (code) {
          attempts.current += 1;
          const plan = planRecovery(code, { attempt: attempts.current });
          recoveryLog.current.push(plan);
          setRecovery(plan);
        }
        requestRef.current = null;
        setSimulation(null);
        return null;
      }

      requestRef.current = built.request;
      const provider = await getReadProvider(chainId);
      const reader = fromToken?.native
        ? null
        : await erc20Reader({ provider, tokenAddress: fromToken?.address }).catch(() => null);

      const result = await simulateIntentTransaction({
        provider,
        request: built.request,
        erc20: reader,
        account,
        chainId,
        intentId,
        amountInWei: quote.amountInWei?.toString?.() ?? null
      });
      setSimulation(result);

      if (enforced && record) {
        if (result.status === 'passed') {
          const terms = materialTerms({ chainId, amount, fromToken, toToken, slippage, request: built.request });
          const previous = approvedTermsRef.current;
          const alreadyApproved = record.approvedTermsHash
            && record.approvedTermsHash === termsFingerprint(terms);

          if (record.approvedTermsHash && !alreadyApproved) {
            /* The user approved something else. Do NOT quietly re-approve on
               their behalf: de-authorise, say which field moved, and wait for
               a deliberate second confirmation. */
            const changed = previous ? diffTerms(previous, terms) : ['routeFingerprint'];
            const reauthorised = applyMaterialChange(record, changed, { reasonCode: 'ROUTE_CHANGED' });
            persist(reauthorised.record);
            const plan = planRecovery('ROUTE_CHANGED', { attempt: (attempts.current += 1) });
            recoveryLog.current.push(plan);
            setRecovery(plan);
            return result;
          }

          approvedTermsRef.current = terms;
          const reviewed = recordReview(record, terms);
          advance(reviewed, 'AWAITING_SIGNATURE', 'PREFLIGHT_PASSED', {
            gasEstimate: result.gasEstimate,
            block: result.blockNumber
          });
        } else if (result.status === 'approval-required') {
          advance(record, 'AWAITING_APPROVAL', 'APPROVAL_REQUIRED');
        }
      }

      const failureCode = failureCodeForSimulation(result.status);
      if (failureCode) {
        attempts.current += 1;
        const plan = planRecovery(failureCode, { attempt: attempts.current });
        recoveryLog.current.push(plan);
        setRecovery(plan);
      }
      return result;
    } catch (err) {
      attempts.current += 1;
      const plan = planRecovery(classifyFailure(err), { attempt: attempts.current });
      recoveryLog.current.push(plan);
      setRecovery(plan);
      setSimulation(null);
      return null;
    } finally {
      setSimulating(false);
    }
  }, [
    quote, account, getReadProvider, chainId, fromToken, toToken, slippage, deadlineMinutes,
    lifecycle, enforced, intentId, amount, advance
  ]);

  /* Run the preflight when the review sheet opens, and again when the exact
     bytes would have changed. Never on every render. */
  useEffect(() => {
    if (!active || !quote || quote.error || !account) return;
    preflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, account, chainId, quote?.amountOutWei?.toString?.(), quote?.source]);

  /** Is the current preflight still valid for the bytes we would send? */
  const preflightValid = useCallback(() => {
    const request = requestRef.current;
    if (!request || !simulation) return false;
    if (isTransactionRequestExpired(request)) return false;
    return simulation.status === 'passed' && simulationIsFresh(simulation, request, { maxAgeMs: SIM_MAX_AGE_MS });
  }, [simulation]);

  /**
   * The only send path for an intent-originated swap. Rebuilds and re-simulates
   * when the previous preflight went stale, and refuses when the terms the user
   * reviewed no longer hold.
   */
  const submit = useCallback(async ({ signer }) => {
    let request = requestRef.current;
    let sim = simulation;
    if (!preflightValid()) {
      sim = await preflight();
      request = requestRef.current;
    }
    if (!request || !sim || sim.status !== 'passed') {
      return { ok: false, code: sim?.status === 'approval-required' ? 'APPROVAL_REQUIRED' : 'SIMULATION_REQUIRED' };
    }

    if (enforced) {
      const gate = canRequestSignature(
        lifecycle,
        materialTerms({ chainId, amount, fromToken, toToken, slippage, request })
      );
      if (!gate.ok) {
        if (gate.code === 'TERMS_CHANGED') {
          const changed = applyMaterialChange(lifecycle, ['routeFingerprint'], { reasonCode: 'ROUTE_CHANGED' });
          persist(changed.record);
          const plan = planRecovery('ROUTE_CHANGED', { attempt: (attempts.current += 1) });
          recoveryLog.current.push(plan);
          setRecovery(plan);
        }
        return { ok: false, code: gate.code };
      }
    }

    const sent = await sendIntentTransaction({
      signer,
      request,
      simulation: sim,
      account,
      chainId
    });
    if (!sent.ok) return sent;
    if (enforced && lifecycle) advance(lifecycle, 'SUBMITTED', 'USER_SIGNED');
    return sent;
  }, [
    simulation, preflightValid, preflight, enforced, lifecycle, chainId, amount,
    fromToken, toToken, slippage, account, advance, persist
  ]);

  /**
   * The user has SEEN what changed and re-approved it. Only a deliberate press
   * reaches this; nothing in the pipeline calls it on the user's behalf.
   */
  const acknowledgeChange = useCallback(() => {
    const request = requestRef.current;
    if (!lifecycle || !request) return false;
    const terms = materialTerms({ chainId, amount, fromToken, toToken, slippage, request });
    approvedTermsRef.current = terms;
    const reviewed = recordReview(lifecycle, terms);
    advance(reviewed, 'AWAITING_SIGNATURE', 'REAUTHORISED');
    setRecovery(null);
    return true;
  }, [lifecycle, chainId, amount, fromToken, toToken, slippage, advance]);

  const markConfirming = useCallback(() => {
    if (enforced && lifecycle) advance(lifecycle, 'CONFIRMING', 'RECEIPT_PENDING');
  }, [enforced, lifecycle, advance]);

  const markCompleted = useCallback(() => {
    if (enforced && lifecycle) advance(lifecycle, 'COMPLETED', 'RECEIPT_CONFIRMED');
  }, [enforced, lifecycle, advance]);

  const markFailed = useCallback((code = 'RECEIPT_FAILED') => {
    attempts.current += 1;
    const plan = planRecovery(code, { attempt: attempts.current });
    recoveryLog.current.push(plan);
    setRecovery(plan);
    if (enforced && lifecycle) {
      const target = ['FAILED', 'EXPIRED', 'CANCELLED', 'RECOVERABLE', 'CONFIRMING', 'AWAITING_APPROVAL'].includes(plan.nextStatus)
        ? plan.nextStatus
        : 'RECOVERABLE';
      advance(lifecycle, target, plan.code);
    }
    return plan;
  }, [enforced, lifecycle, advance]);

  /** Evidence block for the v2 execution proof. Contains no calldata. */
  const proofEvidence = useCallback(({ txHash, receipt, approvalTxHash = null, confirmationLatencyMs = null, actualOutput = null, predictedOutput = null }) => ({
    lifecycleSchema: lifecycle?.schema ?? 'fbt.intent-lifecycle.v1',
    lifecyclePolicyVersion: lifecycle?.policyVersion ?? null,
    lifecycleFinalStatus: lifecycle?.status ?? null,
    lifecycleSequence: lifecycle?.sequence ?? null,
    routePolicy: decision?.policy ?? null,
    routePolicyClaim: decision?.claim ?? null,
    rejectedRoutes: decision?.rejected ?? [],
    missingFields: decision?.missingFields ?? [],
    routeFingerprint: requestRef.current?.routeFingerprint ?? simulation?.routeFingerprint ?? null,
    quoteFingerprint: requestRef.current?.quoteFingerprint ?? simulation?.quoteFingerprint ?? null,
    simulation,
    approvalTxHash,
    txHash,
    actualGasUsed: receipt?.gasUsed != null ? String(receipt.gasUsed) : null,
    actualOutput,
    actualOutputSource: actualOutput != null ? 'receipt-log' : null,
    predictedOutput,
    gasDeltaBps: simulation?.gasEstimate && receipt?.gasUsed
      ? Math.round(((Number(receipt.gasUsed) - Number(simulation.gasEstimate)) / Number(simulation.gasEstimate)) * 10_000)
      : null,
    outputDeltaBps: null,
    confirmationLatencyMs,
    recoveryEvents: recoveryLog.current.map((plan) => ({
      code: plan.code,
      actions: plan.actions,
      attempt: plan.attempt
    }))
  }), [lifecycle, decision, simulation]);

  return {
    enforced,
    needsReauthorisation: Boolean(lifecycle?.reauthorisationRequired),
    acknowledgeChange,
    lifecycle,
    simulation,
    simulating,
    decision,
    recovery,
    recoveryLog: recoveryLog.current,
    request: requestRef,
    preflight,
    preflightValid,
    submit,
    markConfirming,
    markCompleted,
    markFailed,
    proofEvidence,
    reset
  };
}
