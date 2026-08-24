/**
 * MEV EXECUTION-PROTECTION STATE MODEL.
 * ---------------------------------------------------------------------------
 * `mev.js` measures sandwich RISK (a heuristic score). That answers "how
 * exposed is this trade?" — a display question. The P0 spec asks the next
 * question: "what is the EXECUTION PATH, and is it actually protected?"
 *
 * Those are different, and conflating them is the dishonesty the spec names:
 * showing `protected` when only a local heuristic exists. So this module is a
 * pure state machine over the actual execution facts, and it is the ONLY
 * thing allowed to label a trade's MEV protection state.
 *
 * The states, exactly as the spec lists them:
 *
 *   risk-measured                 — we computed a sandwich score; nothing more.
 *                                   Never shown as "protected".
 *   private-relay-recommended     — a private relay exists for this chain AND
 *                                   the risk is high enough to warrant it.
 *                                   The relay is OFFERED, not in use.
 *   private-relay-selected        — the user opted into the relay. Still not
 *                                   confirmed: selection is a preference, and
 *                                   the wallet owns the actual RPC.
 *   private-execution-confirmed   — the unsigned transaction was simulated
 *                                   through the private path (or the relay RPC
 *                                   is the provider that returned the clean
 *                                   eth_call). This is the ONLY state that may
 *                                   render as "protected".
 *   no-private-path-available     — no mature private relay exists for this
 *                                   chain. Said out loud, not hidden, because
 *                                   "we cannot protect this" is more useful
 *                                   than a toggle that does nothing.
 *
 * ─── WHAT THIS WILL NEVER DO ───────────────────────────────────────────────
 *   · auto-change the user's wallet RPC. The wallet owns that setting; we only
 *     recommend and record.
 *   · build a Flashbots bundle with a server-side searcher key. That puts a
 *     server key in the signing path and is out of scope by design.
 *   · guarantee sandwich prevention. The label is about the mempool path, not
 *     a money-back promise.
 *
 * Pure and synchronous so the signing pipeline can run it without a network,
 * and so it is unit-testable in the same suite as the quote model.
 */
import { privateRelayFor } from './mev';

/**
 * Resolve the honest MEV execution state for a trade about to be signed.
 *
 * @param {object} opts
 * @param {number} opts.chainId
 * @param {object} [opts.sandwich]   output of estimateSandwichRisk (has .score/.level)
 * @param {boolean} [opts.userSelectedPrivate]  did the user toggle the relay on?
 * @param {boolean} [opts.simulatedViaPrivate]  was the clean eth_call served by
 *                                               the private relay RPC?
 * @param {boolean} [opts.relayOverride]         a relay exists even though
 *                                               privateRelayFor wouldn't list it
 * @returns {{ state: string, relay: object|null, recommend: boolean, confirmed: boolean, honest: boolean }}
 */
export function mevExecutionState({
  chainId,
  sandwich,
  userSelectedPrivate = false,
  simulatedViaPrivate = false,
  relayOverride = null
} = {}) {
  const relay = relayOverride || privateRelayFor(chainId) || null;
  const score = Number(sandwich?.score);
  const hasScore = Number.isFinite(score);
  // A relay is "recommended" only when there is one to use AND the measured
  // risk clears the high bar. No relay ⇒ never recommended.
  const recommend = Boolean(relay) && hasScore && score >= 45;

  // No relay for this chain → the only honest state is no-private-path.
  if (!relay) {
    return {
      state: 'no-private-path-available',
      relay: null,
      recommend: false,
      confirmed: false,
      // `honest` flags that the UI must NOT show a protect toggle here: there
      // is nothing to toggle, and a disabled-looking toggle implies a feature
      // that exists but is off.
      honest: true
    };
  }

  // Relay exists and the simulation came back clean THROUGH that relay. This
  // is the sole "protected" state. If the user never selected it but the RPC
  // happened to be the relay, we still confirm — but we note the selection was
  // implicit so the UI can say "executed via private path" rather than "you
  // chose private".
  if (simulatedViaPrivate) {
    return {
      state: 'private-execution-confirmed',
      relay,
      recommend,
      confirmed: true,
      honest: true,
      implicitSelection: !userSelectedPrivate
    };
  }

  // User opted in, but we have not confirmed the path (no simulation yet, or
  // simulation ran on the public RPC). Selection is a preference, not a fact.
  if (userSelectedPrivate) {
    return {
      state: 'private-relay-selected',
      relay,
      recommend,
      confirmed: false,
      honest: true
    };
  }

  // Relay exists and risk is high → offer it.
  if (recommend) {
    return {
      state: 'private-relay-recommended',
      relay,
      recommend: true,
      confirmed: false,
      honest: true
    };
  }

  // Default: we have measured the risk (or tried to) and that is all.
  return {
    state: 'risk-measured',
    relay,
    recommend: false,
    confirmed: false,
    honest: true,
    hasScore
  };
}

/**
 * Does a state entitle the UI to show "protected"?
 *
 * Only `private-execution-confirmed`. Every other state — including
 * `private-relay-selected` — must render as something weaker. This is the
 * single chokepoint the spec demands: nothing labelled `protected` unless it
 * is actually confirmed through a private path.
 */
export function mayShowProtected(state) {
  return state === 'private-execution-confirmed';
}

/**
 * One-line, human label keys (i18n keys) for each state, so the UI never has
 * to invent copy and so a state change cannot accidentally render the wrong
 * verb. Returns translation keys, not localized strings.
 */
export function mevStateLabel(state) {
  switch (state) {
    case 'private-execution-confirmed':
      return 'mev.exec.privateConfirmed';
    case 'private-relay-selected':
      return 'mev.exec.privateSelected';
    case 'private-relay-recommended':
      return 'mev.exec.privateRecommended';
    case 'no-private-path-available':
      return 'mev.exec.noPrivatePath';
    case 'risk-measured':
    default:
      return 'mev.exec.riskMeasured';
  }
}
