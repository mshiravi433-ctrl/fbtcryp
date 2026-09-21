/**
 * THE WALLETCONNECT CONNECTION LIFECYCLE, NAMED.
 * ---------------------------------------------------------------------------
 * A pairing is a trip, not a request: the user leaves this document, decides in
 * another app, and comes back. Between those two moments the app has to know
 * WHERE the trip is, because every one of the reports this module exists for —
 * «nothing opened», «it opened but never approved», «I approved and nothing
 * happened» — is a different position on the same journey:
 *
 *   IDLE                nothing was asked yet
 *   CONNECTING          a pairing is being created (or one already exists)
 *   WALLET_OPENED       the hand-off fired; the wallet is in front of the user
 *   AWAITING_APPROVAL   the wallet has the proposal and the user has not decided
 *   APPROVED            the wallet approved; the session is being established
 *   PROVIDER_ATTACHING  the account exists but the EIP-1193 provider has not
 *                       answered yet (this is the state that used to be reported
 *                       as a failure — and the one that loses an address if the
 *                       screen gives up too early)
 *   CONNECTED           the address is attached and usable
 *   REJECTED            the user declined in the wallet
 *   TIMEOUT             no answer arrived inside the budget
 *   FAILED              something broke for a reason that is not the user
 *   RECOVERABLE         a failure with a way forward that does NOT need a new
 *                       pairing (reopen the same URI, bring the wallet back)
 *
 * ─── WHY IT IS A PURE FUNCTION AND NOT A useState ───────────────────────────
 * The facts live in four places (the sheet's own state, the SDK's shared
 * controllers, app storage, and the hand-off trace). A second `status` field
 * kept next to them would be a fifth copy that drifts. So the state is DERIVED
 * from the facts every time it is read, and the same derivation is used by the
 * sheet, the health panel and the tests — one answer, whoever asks.
 *
 * Nothing here is a claim about a wallet that has not answered. `APPROVED` is
 * only reachable from an approval the SDK actually reported, and `CONNECTED`
 * only from an attached account.
 */

/** Every state the flow can be in. Order is the order of the journey. */
export const WC_FLOW_STATES = Object.freeze([
  'IDLE',
  'CONNECTING',
  'WALLET_OPENED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'PROVIDER_ATTACHING',
  'CONNECTED',
  'REJECTED',
  'TIMEOUT',
  'FAILED',
  'RECOVERABLE'
]);

/**
 * The legal moves. Anything not listed here is a bug, and the probe asserts
 * that the derivation never produces one (a `REJECTED` flow cannot become
 * `CONNECTED` without a new attempt passing through CONNECTING first, and a
 * finished connection never falls back to CONNECTING on its own).
 */
export const WC_FLOW_TRANSITIONS = Object.freeze({
  IDLE: ['CONNECTING'],
  CONNECTING: ['WALLET_OPENED', 'AWAITING_APPROVAL', 'APPROVED', 'CONNECTED', 'REJECTED', 'TIMEOUT', 'FAILED', 'RECOVERABLE', 'IDLE'],
  WALLET_OPENED: ['AWAITING_APPROVAL', 'APPROVED', 'CONNECTED', 'REJECTED', 'TIMEOUT', 'FAILED', 'RECOVERABLE'],
  AWAITING_APPROVAL: ['APPROVED', 'CONNECTED', 'REJECTED', 'TIMEOUT', 'FAILED', 'RECOVERABLE'],
  APPROVED: ['PROVIDER_ATTACHING', 'CONNECTED', 'TIMEOUT', 'FAILED', 'RECOVERABLE'],
  PROVIDER_ATTACHING: ['CONNECTED', 'TIMEOUT', 'FAILED', 'RECOVERABLE'],
  CONNECTED: ['IDLE'],
  REJECTED: ['CONNECTING', 'IDLE'],
  TIMEOUT: ['RECOVERABLE', 'CONNECTING', 'IDLE'],
  FAILED: ['RECOVERABLE', 'CONNECTING', 'IDLE'],
  RECOVERABLE: ['CONNECTING', 'WALLET_OPENED', 'AWAITING_APPROVAL', 'CONNECTED', 'IDLE']
});

/** States that mean «this attempt is over». */
export const WC_FLOW_TERMINAL = Object.freeze(['CONNECTED', 'REJECTED', 'TIMEOUT', 'FAILED']);

/**
 * The one state, from the measured facts.
 *
 * Facts (all optional, all booleans unless noted):
 *   connected          an account is attached and usable
 *   rejected           the wallet said no
 *   failed             an error that is not the user's choice
 *   recoverable        there is a way forward without a new pairing
 *   timedOut           the budget passed with no answer
 *   approved           the wallet reported an approval
 *   providerAttaching  the account exists, the provider has not answered yet
 *   awaitingApproval   the proposal reached the wallet
 *   walletOpened       a hand-off was fired
 *   connecting         a connect() is in flight, OR a pairing URI exists
 *   error             ('REJECTED' | 'TIMEOUT' | any other code) when known
 */
export function wcFlowState(facts = {}) {
  const {
    connected = false,
    rejected = false,
    failed = false,
    recoverable = false,
    timedOut = false,
    approved = false,
    providerAttaching = false,
    awaitingApproval = false,
    walletOpened = false,
    connecting = false,
    error = null
  } = facts;

  /* The code, when the caller only has one, decides the failure class. */
  const code = error ? String(error).toUpperCase() : null;
  const isRejected = rejected || code === 'REJECTED' || code === 'USER_REJECTED';
  const isTimedOut = timedOut || code === 'TIMEOUT' || code === 'NO_ANSWER';

  return derive({
    connected,
    rejected: isRejected,
    failed: failed || Boolean(code && !isRejected && !isTimedOut),
    recoverable,
    timedOut: isTimedOut,
    approved,
    providerAttaching,
    awaitingApproval,
    walletOpened,
    connecting
  });
}

function derive(f) {
  /* Precedence, and why: a live account beats every error (a wallet can attach
     while an old timeout is still on screen), and a user's own refusal is never
     shown as a failure of ours. */
  if (f.connected) return state('CONNECTED');
  if (f.rejected) return state('REJECTED');
  if (f.timedOut) return state(f.recoverable ? 'RECOVERABLE' : 'TIMEOUT');
  if (f.failed) return state(f.recoverable ? 'RECOVERABLE' : 'FAILED');
  if (f.approved) return state('APPROVED');
  if (f.providerAttaching) return state('PROVIDER_ATTACHING');
  if (f.awaitingApproval) return state('AWAITING_APPROVAL');
  if (f.walletOpened) return state('WALLET_OPENED');
  if (f.connecting) return state('CONNECTING');
  return state('IDLE');
}

function state(code) {
  return {
    code,
    terminal: WC_FLOW_TERMINAL.includes(code),
    /* What the next legal positions are — the transition table, so a caller
       that is writing UI copy does not have to know the journey by heart. */
    next: WC_FLOW_TRANSITIONS[code] ?? []
  };
}

/** Was moving from `from` to `to` legal? Used by the probe, not by the UI. */
export function wcFlowTransitionAllowed(from, to) {
  const list = WC_FLOW_TRANSITIONS[from];
  return Array.isArray(list) ? list.includes(to) : false;
}
