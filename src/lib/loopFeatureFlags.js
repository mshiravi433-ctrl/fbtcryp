/**
 * Feature gates for the collateral-loop experience.
 *
 * Calculator is display-only and defaults on. Transaction execution defaults
 * off and requires BOTH an explicit build flag and an exact chain:wallet entry
 * in the new, dedicated allowlist. The final stateful-simulation gate is
 * intentionally false until the whole lending → swap → lending sequence has
 * been proven on the public RPC providers this app actually uses.
 */

export const LOOP_STATEFUL_SIMULATION_VERIFIED = false;

export function parseLoopExecutionAllowlist(value = '') {
  if (Array.isArray(value)) return value.map(parseRule).filter(Boolean);
  return String(value ?? '').split(',').map(parseRule).filter(Boolean);
}

function parseRule(raw) {
  const text = String(raw ?? '').trim();
  const colon = text.indexOf(':');
  if (colon <= 0) return null;
  const chainId = Number(text.slice(0, colon).trim());
  const wallet = text.slice(colon + 1).trim().toLowerCase();
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[a-f0-9]{40}$/.test(wallet)) return null;
  return { chainId, wallet };
}

export function readLoopFeatureFlags(env = import.meta.env) {
  const calculatorValue = String(env?.VITE_COLLATERAL_LOOP_CALCULATOR_ENABLED ?? 'true').toLowerCase();
  const executionValue = String(env?.VITE_COLLATERAL_LOOP_EXECUTION_ENABLED ?? 'false').toLowerCase();
  return {
    calculatorEnabled: !['false', '0', 'off', 'no'].includes(calculatorValue),
    executionEnabled: ['true', '1', 'on', 'yes'].includes(executionValue),
    allowlist: parseLoopExecutionAllowlist(env?.VITE_COLLATERAL_LOOP_ALLOWLIST ?? '')
  };
}

export function loopExecutionGate({
  flags = readLoopFeatureFlags(),
  chainId,
  wallet,
  supportedChain = false,
  statefulSimulationVerified = LOOP_STATEFUL_SIMULATION_VERIFIED
} = {}) {
  if (!flags?.executionEnabled) return { allowed: false, reason: 'FLAG_DISABLED' };
  if (!supportedChain) return { allowed: false, reason: 'CHAIN_UNSUPPORTED' };
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(String(wallet))) return { allowed: false, reason: 'WALLET_REQUIRED' };
  const normalized = String(wallet).toLowerCase();
  const allowlist = Array.isArray(flags.allowlist) ? flags.allowlist : parseLoopExecutionAllowlist(flags.allowlist);
  if (!allowlist.some((entry) => Number(entry.chainId) === Number(chainId) && String(entry.wallet).toLowerCase() === normalized)) {
    return { allowed: false, reason: 'NOT_ALLOWLISTED' };
  }
  if (statefulSimulationVerified !== true) return { allowed: false, reason: 'STATEFUL_SIMULATION_UNVERIFIED' };
  return { allowed: true, reason: null };
}
