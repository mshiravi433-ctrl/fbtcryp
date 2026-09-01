/**
 * LENDING ENGINE — transaction state machine (§15/§16 of the production spec).
 * ---------------------------------------------------------------------------
 * Every user-initiated lending action runs through exactly this machine:
 *
 *   IDLE → VALIDATING → READY → SIMULATING → AWAITING_SIGNATURE → SIGNED
 *        → BROADCASTING → PENDING → CONFIRMED → VERIFYING → COMPLETED
 *
 *   SIMULATING → ERROR                    (simulation/estimate failed)
 *   AWAITING_SIGNATURE → CANCELLED        (wallet rejected)
 *   AWAITING_SIGNATURE → ERROR            (wallet error other than reject)
 *   ERROR → RETRY → VALIDATING            (spec §15)
 *   CANCELLED → IDLE
 *
 * The machine is a pure data structure: it holds no network, no wallet, no
 * React. The UI listens to it and renders; the executor drives it. Two rules
 * are enforced by construction:
 *   · a transition that is not in the graph is refused (no PENDING → SIGNED)
 *   · a COMPLETED/ERROR/CANCELLED machine must be reset (RETRY/back to IDLE)
 *     before it can move again — which is also the duplicate-transaction
 *     guard's second layer (see idempotency.js for the first).
 */

export const TX_STATE = Object.freeze({
  IDLE: 'IDLE',
  VALIDATING: 'VALIDATING',
  READY: 'READY',
  SIMULATING: 'SIMULATING',
  AWAITING_SIGNATURE: 'AWAITING_SIGNATURE',
  SIGNED: 'SIGNED',
  BROADCASTING: 'BROADCASTING',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED',
  RETRY: 'RETRY'
});

/** The full transition graph. Every arrow in spec §15, nothing else. */
export const TRANSITIONS = Object.freeze({
  [TX_STATE.IDLE]: [TX_STATE.VALIDATING, TX_STATE.CANCELLED],
  [TX_STATE.VALIDATING]: [TX_STATE.READY, TX_STATE.ERROR],
  [TX_STATE.READY]: [TX_STATE.SIMULATING, TX_STATE.CANCELLED],
  [TX_STATE.SIMULATING]: [TX_STATE.AWAITING_SIGNATURE, TX_STATE.ERROR],
  [TX_STATE.AWAITING_SIGNATURE]: [TX_STATE.SIGNED, TX_STATE.CANCELLED, TX_STATE.ERROR],
  [TX_STATE.SIGNED]: [TX_STATE.BROADCASTING, TX_STATE.ERROR],
  [TX_STATE.BROADCASTING]: [TX_STATE.PENDING, TX_STATE.ERROR],
  [TX_STATE.PENDING]: [TX_STATE.CONFIRMED, TX_STATE.ERROR],
  [TX_STATE.CONFIRMED]: [TX_STATE.VERIFYING, TX_STATE.ERROR],
  [TX_STATE.VERIFYING]: [TX_STATE.COMPLETED, TX_STATE.ERROR],
  [TX_STATE.COMPLETED]: [],
  [TX_STATE.ERROR]: [TX_STATE.RETRY],
  [TX_STATE.RETRY]: [TX_STATE.VALIDATING],
  [TX_STATE.CANCELLED]: [TX_STATE.IDLE]
});

/** The user-facing step checklist (§16), keyed by state. */
export const PROGRESS_STEPS = Object.freeze([
  { id: 'preparing',      label: 'Preparing' },
  { id: 'wallet-signed',  label: 'Wallet signed' },
  { id: 'submitted',      label: 'Submitted' },
  { id: 'confirming',     label: 'Confirming' },
  { id: 'position-update', label: 'Position update' }
]);

/** Which checklist items are done/active at each state (index = position). */
const PROGRESS_AT = Object.freeze({
  [TX_STATE.IDLE]:               { done: 0, active: 0 },
  [TX_STATE.VALIDATING]:         { done: 0, active: 0 },
  [TX_STATE.READY]:              { done: 1, active: 0 },
  [TX_STATE.SIMULATING]:         { done: 1, active: 0 },
  [TX_STATE.AWAITING_SIGNATURE]: { done: 1, active: 1 },
  [TX_STATE.SIGNED]:             { done: 2, active: 2 },
  [TX_STATE.BROADCASTING]:       { done: 2, active: 2 },
  [TX_STATE.PENDING]:            { done: 3, active: 3 },
  [TX_STATE.CONFIRMED]:          { done: 4, active: 4 },
  [TX_STATE.VERIFYING]:          { done: 4, active: 4 },
  [TX_STATE.COMPLETED]:          { done: 5, active: 4 },
  [TX_STATE.ERROR]:              { done: 0, active: 0 },
  [TX_STATE.CANCELLED]:          { done: 0, active: 0 },
  [TX_STATE.RETRY]:              { done: 0, active: 0 }
});

export const isTerminalState = (state) => state === TX_STATE.COMPLETED
  || state === TX_STATE.ERROR
  || state === TX_STATE.CANCELLED;

/**
 * Create a machine for one action instance. `action` is supply | borrow |
 * repay | withdraw; `meta` is anything worth keeping in the history
 * (requestId, idempotencyKey, asset, chainId).
 */
export function createTransactionMachine({ action = 'supply', meta = {} } = {}) {
  let state = TX_STATE.IDLE;
  const history = [{ state: TX_STATE.IDLE, at: Date.now() }];

  const machine = {
    action,
    meta,
    state: () => state,
    history: () => history.slice(),
    isTerminal: () => isTerminalState(state),

    can(next) {
      return TRANSITIONS[state]?.includes(next) ?? false;
    },

    /**
     * Move to `next`. Illegal moves are refused with `{ ok:false, reason }`
     * — the machine never silently rewrites itself.
     */
    transition(next, eventMeta = {}) {
      if (!machine.can(next)) {
        return {
          ok: false,
          reason: 'ILLEGAL_TRANSITION',
          from: state,
          to: next,
          allowed: TRANSITIONS[state] || []
        };
      }
      state = next;
      history.push({ state, at: Date.now(), ...eventMeta });
      return { ok: true, state };
    },

    /** Idempotency-safe reset: only terminal states can go back to IDLE. */
    reset() {
      if (!isTerminalState(state)) return { ok: false, reason: 'NOT_TERMINAL' };
      state = TX_STATE.IDLE;
      history.push({ state, at: Date.now(), reset: true });
      return { ok: true, state };
    },

    /** The §16 checklist rendered from the current state. */
    progress() {
      const at = PROGRESS_AT[state] || PROGRESS_AT[TX_STATE.IDLE];
      return PROGRESS_STEPS.map((step, index) => ({
        ...step,
        status: index < at.done ? 'done' : index === at.active ? 'active' : 'pending'
      }));
    },

    snapshot() {
      return { action, state, meta, history: history.slice(), progress: machine.progress() };
    }
  };

  return machine;
}
