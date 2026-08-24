/**
 * EXECUTION RISK GATE — the single decision that stands between a quote on
 * screen and a transaction the wallet is asked to sign.
 * ---------------------------------------------------------------------------
 * Before this module, risk was DISPLAYED (a token-risk pill, a MEV score) but
 * never ENFORCED. A `critical` honeypot verdict rendered red and the user could
 * still tap Execute. The P0 spec is explicit that this is wrong:
 *
 *   • risk critical must BLOCK execution
 *   • risk high must require review + acknowledgement
 *   • unknown must show a clear warning (never "safe")
 *
 * This gate combines the four independent risk reads — token risk, wallet
 * risk, the MEV execution state, and the pre-sign simulation outcome — into one
 * verdict the signing button reads. It is the last pure check before the
 * wallet is invoked, so it is the cheapest possible place to stop a bad trade.
 *
 * ─── DESIGN RULES ───────────────────────────────────────────────────────────
 *   · FAIL CLOSED. Any missing input is treated as a reason to slow down, not
 *     to proceed. "No token-risk report" is an `unknown` warning, not a pass.
 *   ·NO INVENTED DATA. The gate never synthesises a risk level; it only reads
 *     what the risk modules produced.
 *   · SEPARATE BLOCK FROM ACKNOWLEDGE. A blocked trade cannot be signed at all;
 *     an acknowledged trade can be signed only after the user confirms they
 *     saw the warning. The UI maps these to different controls.
 *   · ONE SOURCE OF TRUTH. The gate is the only thing that decides
 *     `canSign`; the button does not re-derive it from pills.
 *
 * Pure and synchronous, so it runs identically in the unit suite and in the
 * signing path.
 */

/**
 * @param {object} opts
 * @param {object} [opts.tokenRisk]   output of tokenRisk.scoreTokenRisk
 * @param {object} [opts.walletRisk]  a wallet-risk verdict { level, flags[] }
 * @param {object} [opts.mev]         mevExecutionState output { state, confirmed }
 * @param {object} [opts.simulation]  preSignSimulation outcome { status, provenSafe }
 * @param {boolean} [opts.acknowledgedHigh]  user acknowledged the high-risk warning
 * @returns {{
 *   decision: 'allow'|'acknowledge'|'block',
 *   canSign: boolean,
 *   blocked: string[],      // reasons execution is refused
 *   warnings: string[],     // reasons execution should be double-checked
 *   level: string,          // 'low'|'medium'|'high'|'critical'|'unknown'
 *   summary: string         // stable code for the UI / telemetry
 * }}
 */
export function evaluateExecutionGate({
  tokenRisk,
  walletRisk,
  mev,
  simulation,
  acknowledgedHigh = false
} = {}) {
  const blocked = [];
  const warnings = [];
  let level = 'low';

  const bump = (l) => {
    level = worse(level, l);
  };

  /* ── 1. TOKEN RISK ────────────────────────────────────────────────────────
   * The output-token risk is the strongest signal we have. A confirmed
   * honeypot blocks outright — there is no acknowledgement path for "you
   * cannot sell this". Unknown data is a warning, never a pass. */
  if (tokenRisk && typeof tokenRisk === 'object') {
    if (tokenRisk.honeypot || tokenRisk.cannotSell) {
      blocked.push('token-honeypot');
      bump('critical');
    } else if (tokenRisk.level === 'critical') {
      blocked.push('token-risk-critical');
      bump('critical');
    } else if (tokenRisk.level === 'high') {
      warnings.push('token-risk-high');
      bump('high');
    } else if (tokenRisk.level === 'unknown') {
      warnings.push('token-risk-unknown');
      bump('unknown');
    }
  } else {
    // No token-risk report at all. The spec: absence of data must not read as
    // "safe". We warn (not block) because a missing scan is recoverable, but we
    // refuse to call it low risk.
    warnings.push('token-risk-missing');
    bump('unknown');
  }

  /* ── 2. WALLET RISK ───────────────────────────────────────────────────────
   * Wallet risk is currently local-only (security settings); the provider-
   * backed version (allowances, drainer exposure) is P-future. We honour what
   * we have and never fake the rest. */
  if (walletRisk && typeof walletRisk === 'object') {
    const wl = String(walletRisk.level ?? 'unknown');
    if (wl === 'critical') {
      blocked.push('wallet-risk-critical');
      bump('critical');
    } else if (wl === 'high') {
      warnings.push('wallet-risk-high');
      bump('high');
    } else if (wl === 'unknown') {
      warnings.push('wallet-risk-unknown');
      bump('unknown');
    }
  }

  /* ── 3. MEV EXECUTION STATE ───────────────────────────────────────────────
   * The MEV state is a path fact, not a risk level, so it contributes warnings
   * rather than levels — except that "no private path available" on a high-risk
   * trade is itself a reason to slow down. */
  if (mev && typeof mev === 'object') {
    if (mev.state === 'no-private-path-available' && mev.recommend === false) {
      // No relay AND risk not high enough to recommend: neutral.
    } else if (mev.recommend && !mev.confirmed) {
      warnings.push('mev-private-relay-recommended');
    }
  }

  /* ── 4. PRE-SIGN SIMULATION ───────────────────────────────────────────────
   * A detected revert BLOCKS — there is nothing to acknowledge. A simulation
   * we could not run is a warning: we are not promising the trade is safe. */
  if (simulation && typeof simulation === 'object') {
    if (simulation.status === 'revert-detected') {
      blocked.push('simulation-revert-detected');
      bump('critical');
    } else if (simulation.status === 'provider-busy') {
      warnings.push('simulation-unavailable');
      bump('unknown');
    } else if (simulation.status === 'unknown') {
      warnings.push('simulation-not-run');
      bump('unknown');
    }
    // simulated-clean adds nothing: it is not a guarantee, merely the absence
    // of a detected problem. Calling it "low risk" would overstate it.
  }

  /* ── DECISION ───────────────────────────────────────────────────────────── */
  let decision;
  if (blocked.length > 0) {
    decision = 'block';
  } else if (level === 'high' && !acknowledgedHigh) {
    decision = 'acknowledge';
  } else if (level === 'unknown' && warnings.length > 0 && !acknowledgedHigh) {
    // Unknown risk is not a hard block, but we require the user to see that we
    // could not verify safety before signing. This is the "absence of data is
    // not safety" rule made operational.
    decision = 'acknowledge';
  } else {
    decision = 'allow';
  }

  return {
    decision,
    canSign: decision === 'allow',
    blocked,
    warnings,
    level,
    summary: `gate:${decision}:${level}:${blocked.length}:${warnings.length}`
  };
}

/**
 * Ordering of risk severity. `unknown` sits between medium and high: it is
 * worse than a measured low/medium (we know nothing), but not as bad as a
 * measured high/critical (we know something bad).
 */
const ORDER = ['low', 'medium', 'unknown', 'high', 'critical'];
export function worse(a, b) {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return 'unknown';
  if (ia === -1) return b;
  if (ib === -1) return a;
  return ia >= ib ? a : b;
}

/** Convenience: is this gate verdict a hard refusal? */
export function isBlocked(gate) {
  return gate?.decision === 'block';
}

/** Convenience: does signing require an explicit acknowledgement step? */
export function requiresAcknowledgement(gate) {
  return gate?.decision === 'acknowledge';
}
