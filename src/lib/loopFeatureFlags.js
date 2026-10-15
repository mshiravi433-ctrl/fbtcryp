/**
 * Feature gates for the collateral-loop experience.
 *
 * Calculator is display-only and defaults on.
 *
 * ─── 2026-10-15: STEP EXECUTION IS LIVE ─────────────────────────────────────
 * Execution used to be blocked behind a constant that could only flip once the
 * whole lending → swap → lending sequence had been simulated AS ONE on public
 * RPCs — which those providers cannot do (no state overrides, no bundles), so
 * the gate could never open. The sequence is now never SIGNED as one either:
 * loopRuntime.js runs one transaction per user click, and each one is
 * eth_call'ed against the state its predecessors actually produced, right
 * before its signature, with its amount re-resolved from fresh reads. That
 * per-step model is what `LOOP_PER_STEP_SIMULATION` declares.
 *
 *   VITE_COLLATERAL_LOOP_EXECUTION_ENABLED  default ON. 'false' / '0' / 'off' /
 *                                           'no' is the kill switch.
 *   VITE_COLLATERAL_LOOP_ALLOWLIST          optional staged rollout: when set,
 *                                           only those exact chain:wallet pairs
 *                                           may execute. Set-but-unparseable
 *                                           means NOBODY (the operator asked
 *                                           for a restriction), never everyone.
 *
 * The gate also refuses a read-only backend (the lending circuit breaker) and
 * a wallet on another network; the runtime re-checks both at every signature.
 */

export const LOOP_PER_STEP_SIMULATION = true;

export function parseLoopExecutionAllowlist(value = '') {
  if (Array.isArray(value)) return value.map(parseRule).filter(Boolean);
  return String(value ?? '').split(',').map(parseRule).filter(Boolean);
}

function parseRule(raw) {
  if (raw && typeof raw === 'object') {
    const chainId = Number(raw.chainId);
    const wallet = String(raw.wallet ?? '').trim().toLowerCase();
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[a-f0-9]{40}$/.test(wallet)) return null;
    return { chainId, wallet };
  }
  const text = String(raw ?? '').trim();
  const colon = text.indexOf(':');
  if (colon <= 0) return null;
  const chainId = Number(text.slice(0, colon).trim());
  const wallet = text.slice(colon + 1).trim().toLowerCase();
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[a-f0-9]{40}$/.test(wallet)) return null;
  return { chainId, wallet };
}

const OFF = ['false', '0', 'off', 'no'];

export function readLoopFeatureFlags(env = import.meta.env) {
  const calculatorValue = String(env?.VITE_COLLATERAL_LOOP_CALCULATOR_ENABLED ?? 'true').trim().toLowerCase();
  const executionValue = String(env?.VITE_COLLATERAL_LOOP_EXECUTION_ENABLED ?? 'true').trim().toLowerCase();
  const rawAllowlist = String(env?.VITE_COLLATERAL_LOOP_ALLOWLIST ?? '').trim();
  return {
    calculatorEnabled: !OFF.includes(calculatorValue),
    executionEnabled: !OFF.includes(executionValue),
    allowlist: parseLoopExecutionAllowlist(rawAllowlist),
    allowlistConfigured: rawAllowlist.length > 0
  };
}

/**
 * Who may press "execute" right now. Order matters: the first failing reason
 * is the one the UI explains (and, for WALLET_REQUIRED / WRONG_NETWORK, offers
 * to fix with one tap).
 */
export function loopExecutionGate({
  flags = readLoopFeatureFlags(),
  chainId,
  wallet,
  supportedChain = false,
  walletChainId = null,
  readOnly = false,
  perStepSimulation = LOOP_PER_STEP_SIMULATION
} = {}) {
  if (!flags?.executionEnabled) return { allowed: false, reason: 'FLAG_DISABLED' };
  if (!supportedChain) return { allowed: false, reason: 'CHAIN_UNSUPPORTED' };
  if (perStepSimulation !== true) return { allowed: false, reason: 'STEP_SIMULATION_UNAVAILABLE' };
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(String(wallet))) return { allowed: false, reason: 'WALLET_REQUIRED' };
  const normalized = String(wallet).toLowerCase();
  const allowlist = Array.isArray(flags.allowlist) ? parseLoopExecutionAllowlist(flags.allowlist) : parseLoopExecutionAllowlist(flags.allowlist ?? '');
  const restricted = flags.allowlistConfigured === true || allowlist.length > 0;
  if (restricted && !allowlist.some((entry) => Number(entry.chainId) === Number(chainId) && entry.wallet === normalized)) {
    return { allowed: false, reason: 'NOT_ALLOWLISTED' };
  }
  if (readOnly) return { allowed: false, reason: 'READ_ONLY' };
  if (walletChainId != null && Number.isFinite(Number(walletChainId)) && Number(walletChainId) !== Number(chainId)) {
    return { allowed: false, reason: 'WRONG_NETWORK' };
  }
  return { allowed: true, reason: null };
}
