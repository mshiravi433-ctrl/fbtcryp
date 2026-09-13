/**
 * FBT LAUNCH — the state machine.
 *
 * WHY A STATE MACHINE (and not "agents")
 * ---------------------------------------------------------------------------
 * The proposal drew a Launch Agent fanning out to Token / Liquidity / Risk
 * agents. Execution of financial actions must be DETERMINISTIC: the same
 * event history must produce the same on-chain behaviour on every device,
 * every time, with zero model in the loop. So the "agents" are replaced by
 * one pure transition function. The AI keeps its legitimate job — planning,
 * explaining, answering — and hands the user a config; from here on it is
 * only bytes, signatures and blocks.
 *
 * THE STATES (spec §24)
 *   DRAFT → CONFIGURED → SIMULATING → SIMULATED → AWAITING_CONFIRMATION
 *        → SIGNING → SUBMITTED → CONFIRMING → VERIFIED → LIVE
 * Error states: FAILED · RETRYABLE · CANCELLED · EXPIRED
 *
 * HONEST PARTIAL FAILURE (spec §25)
 * ---------------------------------------------------------------------------
 * Token mined, liquidity reverted? The machine lands in RETRYABLE with a
 * `partial` report — token: SUCCESS (with its real address), pool: FAILED
 * (with the reason) — and keeps the token address so the recovery path
 * ("retry the pool") starts from the truth on-chain, never from a claim.
 * A launch is LIVE only when verification read the real chain back.
 */

export const STATE = Object.freeze({
  DRAFT: 'DRAFT',
  CONFIGURED: 'CONFIGURED',
  SIMULATING: 'SIMULATING',
  SIMULATED: 'SIMULATED',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  SIGNING: 'SIGNING',
  SUBMITTED: 'SUBMITTED',
  CONFIRMING: 'CONFIRMING',
  VERIFIED: 'VERIFIED',
  LIVE: 'LIVE',
  FAILED: 'FAILED',
  RETRYABLE: 'RETRYABLE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
});

export const STEP_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  SIGNING: 'signing',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
});

const TERMINAL = new Set([STATE.LIVE, STATE.FAILED, STATE.CANCELLED]);
const ERROR_STATES = new Set([STATE.FAILED, STATE.RETRYABLE, STATE.CANCELLED, STATE.EXPIRED]);

let idCounter = 0;

/**
 * Create a fresh draft. `now` is injectable so tests are deterministic.
 */
export function createLaunch({ now = Date.now(), id = null } = {}) {
  idCounter += 1;
  return {
    id: id || `launch-${now.toString(36)}-${idCounter.toString(36)}`,
    schema: 'fbt.launch.v1',
    state: STATE.DRAFT,
    createdAt: now,
    updatedAt: now,
    config: null,
    risk: null,
    simulation: null,
    steps: [],
    token: null, // { address, name, symbol, decimals, supply, capabilities, txHash }
    pool: null, // { address, reserves, lpBalance, txHash }
    partial: null,
    error: null,
    history: []
  };
}

function withEvent(launch, event, payload = {}) {
  launch.history.push({ at: launch.updatedAt, event, payload });
  return launch;
}

function set(launch, state, extra = {}) {
  launch.state = state;
  launch.updatedAt = Date.now();
  if (state in STATE) launch.error = ERROR_STATES.has(state) ? extra.reason || null : null;
  return withEvent(launch, state, extra);
}

function step(launch, id) {
  return launch.steps.find((s) => s.id === id) || null;
}

/**
 * CONFIGURED — a valid, fully-described launch is waiting for simulation.
 *
 * @param {object} cfg
 *   cfg.chainId, cfg.dex {factory, router, wrapped, name, feeTierBps}
 *   cfg.factoryAddress, cfg.spec, cfg.quote {address, decimals, native, symbol}
 *   cfg.tokenAmount, cfg.quoteAmount, cfg.slippageBps, cfg.creator
 *   cfg.steps       prepared steps from buildLaunchPlan (phase one: token tx
 *                   + the deferred pool intent)
 *   cfg.risk        scoreLaunch() output
 */
export function configure(launch, cfg) {
  if (launch.state !== STATE.DRAFT && launch.state !== STATE.EXPIRED) {
    throw new Error(`CANNOT_CONFIGURE_FROM_${launch.state}`);
  }
  if (cfg.risk?.blocked) {
    set(launch, STATE.FAILED, { reason: 'RISK_GATE_BLOCKED' });
    return launch;
  }
  launch.config = { ...cfg };
  launch.steps = (cfg.steps || []).map((s) => ({
    id: s.id,
    deferred: Boolean(s.deferred),
    status: s.deferred ? STEP_STATUS.PENDING : STEP_STATUS.READY,
    to: s.to || null,
    data: s.data || null,
    value: s.value || '0',
    description: s.description || s.id,
    txHash: null,
    receipt: null,
    error: null
  }));
  launch.risk = cfg.risk || null;
  set(launch, STATE.CONFIGURED);
  return launch;
}

export function simulateStart(launch) {
  if (launch.state !== STATE.CONFIGURED && launch.state !== STATE.RETRYABLE) throw new Error('NOT_CONFIGURED');
  set(launch, STATE.SIMULATING);
  return launch;
}

/**
 * SIMULATED — the UI ran estimateGas/eth_call on every non-deferred step.
 * @param {object} sim { gas: { [stepId]: { gasLimit, nativeCost } }, priceImpactNote?, at }
 */
export function simulateDone(launch, sim) {
  if (launch.state !== STATE.SIMULATING) throw new Error('NOT_SIMULATING');
  launch.simulation = { ...(launch.simulation || {}), ...(sim || {}), at: Date.now() };
  set(launch, STATE.SIMULATED);
  return launch;
}

export function confirmIntent(launch) {
  if (launch.state !== STATE.SIMULATED && launch.state !== STATE.AWAITING_CONFIRMATION) {
    throw new Error('NOT_SIMULATED');
  }
  set(launch, STATE.AWAITING_CONFIRMATION);
  return launch;
}

/**
 * The engine hands the next step to the wallet. Returns the step whose
 * signature is requested (or null when nothing is left — the caller then
 * moves to verification).
 */
export function nextPendingStep(launch) {
  if (![STATE.AWAITING_CONFIRMATION, STATE.SIGNING, STATE.SUBMITTED, STATE.CONFIRMING, STATE.RETRYABLE].includes(launch.state)) {
    return null;
  }
  return launch.steps.find((s) => !s.deferred && (s.status === STEP_STATUS.READY || s.status === STEP_STATUS.PENDING)) || null;
}

export function signingStarted(launch, stepId) {
  const s = step(launch, stepId);
  if (!s) throw new Error('STEP_NOT_FOUND');
  if (s.status !== STEP_STATUS.READY && s.status !== STEP_STATUS.PENDING) throw new Error(`STEP_NOT_SIGNABLE:${s.status}`);
  s.status = STEP_STATUS.SIGNING;
  set(launch, STATE.SIGNING, { stepId });
  return launch;
}

/**
 * The user declined a signature. That is a CHOICE, never a failure.
 *  · Nothing mined yet → CANCELLED: the launch is simply abandoned.
 *  · Token already mined → RETRYABLE: the token exists on-chain, so the
 *    partial report (with its retry-pool recovery) is the honest state —
 *    the user keeps full control over what happens next.
 * Either way the step keeps its USER_REJECTED error so the run view can
 * explain exactly why the run stopped.
 */
export function stepRejected(launch, stepId) {
  const s = step(launch, stepId);
  if (!s) throw new Error('STEP_NOT_FOUND');
  s.status = STEP_STATUS.FAILED;
  s.error = 'USER_REJECTED';
  if (launch.token?.address) {
    launch.partial = {
      token: 'SUCCESS',
      tokenAddress: launch.token.address,
      pool: launch.pool?.lpBalance && Number(launch.pool.lpBalance) > 0 ? 'SUCCESS' : 'NOT_STARTED',
      failedStep: null,
      reason: 'USER_REJECTED',
      recovery: 'retry-pool'
    };
    set(launch, STATE.RETRYABLE, { stepId, reason: 'USER_REJECTED' });
  } else {
    for (const st of launch.steps) {
      if (st.status === STEP_STATUS.READY || st.status === STEP_STATUS.PENDING || st.status === STEP_STATUS.SIGNING) {
        st.status = STEP_STATUS.SKIPPED;
      }
    }
    set(launch, STATE.CANCELLED, { stepId, reason: 'USER_REJECTED' });
  }
  return launch;
}

export function stepSubmitted(launch, stepId, txHash) {
  const s = step(launch, stepId);
  if (!s) throw new Error('STEP_NOT_FOUND');
  s.txHash = txHash;
  s.status = STEP_STATUS.SUBMITTED;
  set(launch, STATE.SUBMITTED, { stepId, txHash });
  return launch;
}

export function stepConfirming(launch, stepId) {
  const s = step(launch, stepId);
  if (!s) throw new Error('STEP_NOT_FOUND');
  s.status = STEP_STATUS.SUBMITTED;
  set(launch, STATE.CONFIRMING, { stepId });
  return launch;
}

/**
 * A step mined successfully. For the token step the engine also records the
 * token facts (parsed from the TokenCreated event) and — because the pool
 * bytes were deferred on purpose — splices the real token address into the
 * deferred steps (which the UI re-prepares via buildLiquiditySteps).
 */
export function stepConfirmed(launch, stepId, { receipt = null, tokenFacts = null, poolFacts = null } = {}) {
  const s = step(launch, stepId);
  if (!s) throw new Error('STEP_NOT_FOUND');
  s.status = STEP_STATUS.CONFIRMED;
  s.receipt = receipt || null;

  if (stepId === 'create-token' && tokenFacts) {
    launch.token = { ...tokenFacts, txHash: s.txHash };
    // Resolve the deferred pool intent with the real address. Callers may
    // pass the normalised engine shape ({ address }) or the raw parsed event
    // ({ token }) — accept both, but the record keeps `address` canonical.
    const tokenAddress = tokenFacts.address || tokenFacts.token;
    if (launch.token && !launch.token.address) launch.token.address = tokenAddress;
    for (const st of launch.steps) {
      if (st.deferred) {
        st.status = STEP_STATUS.READY;
        st.deferred = false;
        st.resolvedWith = tokenAddress;
        st.needsReprepare = true;
      }
    }
  }
  if (stepId === 'create-pair' && poolFacts?.address) {
    launch.pool = { ...(launch.pool || {}), ...poolFacts, txHash: s.txHash };
  }

  if (nextPendingStep(launch)) {
    set(launch, STATE.AWAITING_CONFIRMATION, { stepId: 'done' });
  } else {
    set(launch, STATE.CONFIRMING, { stepId: 'all-done' });
  }
  return launch;
}

/**
 * A step failed on-chain (revert, out of gas, deadline).
 * The partial-failure law: if the token is already mined, this is RETRYABLE
 * with an exact partial report; otherwise the whole launch FAILED.
 */
function failFrom(launch, stepId, reason) {
  const tokenOk = Boolean(launch.token?.address);
  const poolOk = Boolean(launch.pool?.lpBalance && Number(launch.pool.lpBalance) > 0);
  if (tokenOk) {
    launch.partial = {
      token: 'SUCCESS',
      tokenAddress: launch.token.address,
      pool: poolOk ? 'SUCCESS' : 'FAILED',
      failedStep: stepId,
      reason,
      recovery: poolOk
        ? 'verify'
        : 'retry-pool'
    };
    set(launch, STATE.RETRYABLE, { reason, stepId });
  } else {
    launch.partial = {
      token: 'FAILED',
      tokenAddress: null,
      pool: 'NOT_STARTED',
      failedStep: stepId,
      reason,
      recovery: 'restart'
    };
    set(launch, STATE.FAILED, { reason, stepId });
  }
  return launch;
}

export function stepFailed(launch, stepId, reason) {
  const s = step(launch, stepId);
  if (!s) throw new Error('STEP_NOT_FOUND');
  s.status = STEP_STATUS.FAILED;
  s.error = reason;
  return failFrom(launch, stepId, reason);
}

/**
 * RETRYABLE → back to a state where the failed (and following) steps can be
 * attempted again. The token is never re-created: its address is on-chain
 * fact. Steps after the failed one are re-marked ready; the failed one is
 * reset. The caller must RE-SIMULATE (gas prices moved, the chain moved).
 */
export function retryPool(launch) {
  if (launch.state !== STATE.RETRYABLE) throw new Error('NOT_RETRYABLE');
  if (!launch.token?.address) throw new Error('NO_TOKEN_TO_RETRY_FOR');
  const failedIdx = launch.steps.findIndex((s) => s.status === STEP_STATUS.FAILED);
  if (failedIdx === -1) throw new Error('NO_FAILED_STEP');
  launch.steps[failedIdx].status = STEP_STATUS.READY;
  launch.steps[failedIdx].error = null;
  launch.steps[failedIdx].txHash = null;
  for (let i = failedIdx + 1; i < launch.steps.length; i += 1) {
    launch.steps[i].status = STEP_STATUS.READY;
    launch.steps[i].error = null;
    launch.steps[i].txHash = null;
  }
  launch.error = null;
  set(launch, STATE.CONFIGURED);
  return launch;
}

export function cancel(launch) {
  if (TERMINAL.has(launch.state)) throw new Error('ALREADY_TERMINAL');
  for (const s of launch.steps) {
    if (s.status === STEP_STATUS.READY || s.status === STEP_STATUS.PENDING || s.status === STEP_STATUS.SIGNING) {
      s.status = STEP_STATUS.SKIPPED;
    }
  }
  if (launch.token?.address) {
    launch.partial = {
      token: 'SUCCESS',
      tokenAddress: launch.token.address,
      pool: launch.pool?.lpBalance && Number(launch.pool.lpBalance) > 0 ? 'SUCCESS' : 'NOT_STARTED',
      failedStep: null,
      reason: 'USER_CANCELLED',
      recovery: 'retry-pool'
    };
  }
  set(launch, STATE.CANCELLED, { reason: 'USER_CANCELLED' });
  return launch;
}

export function expire(launch) {
  if (TERMINAL.has(launch.state) || launch.state === STATE.EXPIRED) return launch;
  // A mined token survives expiry — it is on-chain fact.
  set(launch, STATE.EXPIRED, { reason: 'DEADLINE_PASSED' });
  return launch;
}

/**
 * VERIFIED — on-chain verification (verify.js) confirmed token + pair + LP.
 * This is the ONLY road to LIVE: the chain said yes, in writing.
 */
export function verified(launch, facts = {}) {
  if (launch.state !== STATE.CONFIRMING && launch.state !== STATE.VERIFIED) {
    // RETRYABLE pools that finished their retry also verify through here.
    if (launch.state !== STATE.RETRYABLE && launch.state !== STATE.AWAITING_CONFIRMATION) {
      throw new Error(`CANNOT_VERIFY_FROM_${launch.state}`);
    }
  }
  if (facts.token) launch.token = { ...launch.token, ...facts.token };
  if (facts.pool) launch.pool = { ...launch.pool, ...facts.pool };
  set(launch, STATE.VERIFIED);
  return launch;
}

export function live(launch) {
  if (launch.state !== STATE.VERIFIED) throw new Error('NOT_VERIFIED');
  set(launch, STATE.LIVE);
  return launch;
}

/** Everything the UI needs to drive one launch, in one object. */
export function launchView(launch) {
  const steps = launch.steps.map((s) => ({ ...s }));
  return {
    ...launch,
    steps,
    nextStep: nextPendingStep(launch)?.id || null,
    token: launch.token ? { ...launch.token } : null,
    pool: launch.pool ? { ...launch.pool } : null,
    partial: launch.partial ? { ...launch.partial } : null,
    done: TERMINAL.has(launch.state) || launch.state === STATE.LIVE
  };
}
