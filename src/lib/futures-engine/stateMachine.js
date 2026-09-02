/**
 * FBT FUTURES — transaction state machine (spec §13).
 * ---------------------------------------------------------------------------
 *   IDLE → VALIDATING → QUOTING → RISK_CHECK → READY → SIMULATING →
 *   AWAITING_SIGNATURE → SIGNED → BROADCASTING → PENDING → CONFIRMED →
 *   VERIFYING → COMPLETED
 *
 * Error branches: FAILED (retryable), REJECTED (wallet refusal — never retried
 * automatically), CANCELLED, BLOCKED (risk/policy — terminal until inputs
 * change), TIMEOUT (pending too long → recoverable via verify).
 *
 * Same discipline as the lending engine's machine: illegal transitions are
 * refused, terminal states must be reset before reuse, and the machine holds
 * no wallet, network or React.
 */

export const FUTURES_TX_STATE = Object.freeze({
  IDLE: 'IDLE',
  VALIDATING: 'VALIDATING',
  QUOTING: 'QUOTING',
  RISK_CHECK: 'RISK_CHECK',
  READY: 'READY',
  SIMULATING: 'SIMULATING',
  AWAITING_SIGNATURE: 'AWAITING_SIGNATURE',
  SIGNED: 'SIGNED',
  BROADCASTING: 'BROADCASTING',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  BLOCKED: 'BLOCKED',
  TIMEOUT: 'TIMEOUT'
});

const S = FUTURES_TX_STATE;

export const FUTURES_TRANSITIONS = Object.freeze({
  [S.IDLE]: [S.VALIDATING, S.CANCELLED],
  [S.VALIDATING]: [S.QUOTING, S.FAILED, S.BLOCKED],
  [S.QUOTING]: [S.RISK_CHECK, S.FAILED],
  [S.RISK_CHECK]: [S.READY, S.BLOCKED],
  [S.READY]: [S.SIMULATING, S.CANCELLED],
  [S.SIMULATING]: [S.AWAITING_SIGNATURE, S.FAILED],
  [S.AWAITING_SIGNATURE]: [S.SIGNED, S.REJECTED, S.FAILED],
  [S.SIGNED]: [S.BROADCASTING, S.FAILED],
  [S.BROADCASTING]: [S.PENDING, S.FAILED],
  [S.PENDING]: [S.CONFIRMED, S.FAILED, S.TIMEOUT],
  [S.CONFIRMED]: [S.VERIFYING, S.FAILED],
  [S.VERIFYING]: [S.COMPLETED, S.FAILED],
  [S.TIMEOUT]: [S.VERIFYING, S.FAILED],
  [S.COMPLETED]: [],
  [S.FAILED]: [S.IDLE],
  [S.REJECTED]: [S.IDLE],
  [S.CANCELLED]: [S.IDLE],
  [S.BLOCKED]: [S.IDLE]
});

export const TERMINAL_STATES = Object.freeze([S.COMPLETED, S.FAILED, S.REJECTED, S.CANCELLED, S.BLOCKED]);
export const isTerminalFuturesState = (state) => TERMINAL_STATES.includes(state);

/** States in which a retry is allowed. A wallet REJECTED is never auto-retried. */
export const RETRYABLE_STATES = Object.freeze([S.FAILED, S.TIMEOUT]);

export const FUTURES_PROGRESS_STEPS = Object.freeze([
  { id: 'validate', labelKey: 'futures.progress.validate' },
  { id: 'quote', labelKey: 'futures.progress.quote' },
  { id: 'risk', labelKey: 'futures.progress.risk' },
  { id: 'sign', labelKey: 'futures.progress.sign' },
  { id: 'confirm', labelKey: 'futures.progress.confirm' },
  { id: 'verify', labelKey: 'futures.progress.verify' }
]);

const PROGRESS_AT = Object.freeze({
  [S.IDLE]: 0, [S.VALIDATING]: 0, [S.QUOTING]: 1, [S.RISK_CHECK]: 2, [S.READY]: 3,
  [S.SIMULATING]: 3, [S.AWAITING_SIGNATURE]: 3, [S.SIGNED]: 4, [S.BROADCASTING]: 4,
  [S.PENDING]: 4, [S.CONFIRMED]: 5, [S.VERIFYING]: 5, [S.TIMEOUT]: 5, [S.COMPLETED]: 6,
  [S.FAILED]: 0, [S.REJECTED]: 0, [S.CANCELLED]: 0, [S.BLOCKED]: 2
});

export function createFuturesTxMachine({ action = 'open', meta = {} } = {}) {
  let state = S.IDLE;
  const history = [{ state, at: Date.now() }];
  const m = {
    action,
    meta,
    state: () => state,
    history: () => history.slice(),
    isTerminal: () => isTerminalFuturesState(state),
    can: (next) => FUTURES_TRANSITIONS[state]?.includes(next) ?? false,
    transition(next, eventMeta = {}) {
      if (!m.can(next)) return { ok: false, reason: 'ILLEGAL_TRANSITION', from: state, to: next, allowed: FUTURES_TRANSITIONS[state] || [] };
      state = next;
      history.push({ state, at: Date.now(), ...eventMeta });
      return { ok: true, state };
    },
    reset() {
      if (!isTerminalFuturesState(state)) return { ok: false, reason: 'NOT_TERMINAL' };
      if (state === S.COMPLETED) return { ok: false, reason: 'COMPLETED_IS_FINAL' };
      state = S.IDLE;
      history.push({ state, at: Date.now(), reset: true });
      return { ok: true, state };
    },
    progress() {
      const done = PROGRESS_AT[state] ?? 0;
      return FUTURES_PROGRESS_STEPS.map((step, i) => ({ ...step, status: i < done ? 'done' : i === done && !isTerminalFuturesState(state) ? 'active' : 'pending' }));
    },
    snapshot: () => ({ action, state, meta, history: history.slice(), progress: m.progress() })
  };
  return m;
}
