/**
 * FBT CENTRAL INTELLIGENCE OS — Policy Engine (§33, §23).
 * ---------------------------------------------------------------------------
 * Three permission levels:
 *
 *   READ    — analysis, news, signals, positions. No confirmation needed.
 *   PREPARE — quotes, simulations, tx preparation. Never executes.
 *   EXECUTE — swap, bridge, lend, borrow, futures, rebalance… ALWAYS
 *             requires explicit user confirmation, and the server never
 *             signs: execution is a prepared, verified hand-off to the
 *             user's wallet.
 *
 * Security rules are TERMINAL (§23): flagged recipient, oracle anomaly,
 * contract mismatch, policy violation → SAFE STOP. The policy engine cannot
 * be bypassed by any planner, router or LLM path (§44, scenario J).
 */
import { SECURITY_STOP_CODES } from './constants.js';

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Very small local denylist; real deployments extend this via env. */
const DENYLIST = new Set(
  String(process.env.CENTRAL_DENYLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export function validateRecipient(address) {
  if (address == null || address === '') return { ok: false, code: 'INVALID_RECIPIENT', detail: 'no recipient provided' };
  const a = String(address);
  if (!EVM_ADDR_RE.test(a) && !SOL_ADDR_RE.test(a)) {
    return { ok: false, code: 'INVALID_RECIPIENT', detail: 'address format is not valid' };
  }
  if (DENYLIST.has(a.toLowerCase())) {
    return { ok: false, code: 'SECURITY_VIOLATION', detail: 'recipient is on the denylist' };
  }
  return { ok: true };
}

/**
 * Security scan over a proposed action. Returns the FIRST fatal violation —
 * ordering matters: security beats everything else.
 */
export function securityScan({ action = {}, state = null } = {}) {
  const violations = [];

  if (action.recipient != null) {
    const v = validateRecipient(action.recipient);
    if (!v.ok) violations.push(v);
  }
  // Self-transfer poisoning guard: recipient identical to a known-good
  // address is fine, but a recipient that only differs by homoglyphs is not
  // representable in our validated alphabets — covered by the regex above.

  const oracle = state?.lending?.oracle;
  if (oracle === 'manipulated' || state?.markets?.oracleAnomaly === true) {
    violations.push({ ok: false, code: 'ORACLE_ANOMALY', detail: 'price feed anomaly detected; refusing to price the operation' });
  }
  if (action.contractAddress && typeof action.contractAddress === 'string' && !EVM_ADDR_RE.test(action.contractAddress)) {
    violations.push({ ok: false, code: 'CONTRACT_MISMATCH', detail: 'contract address failed checksum/format validation' });
  }
  if (action.amountUsd != null && (!Number.isFinite(Number(action.amountUsd)) || Number(action.amountUsd) <= 0)) {
    violations.push({ ok: false, code: 'POLICY_VIOLATION', detail: 'amount must be a positive finite number' });
  }
  if (action.leverage != null && Number(action.leverage) > 50) {
    violations.push({ ok: false, code: 'POLICY_VIOLATION', detail: 'leverage above 50x is refused by policy' });
  }
  return violations;
}

/** Decide the permission level a whole intent needs. */
export function permissionForPlan(plan) {
  if (plan.some((s) => s.permission === 'EXECUTE' || s.operation === 'execute')) return 'EXECUTE';
  if (plan.some((s) => ['quote', 'prepare', 'simulate'].includes(s.operation))) return 'PREPARE';
  return 'READ';
}

/**
 * Full policy check for a pending EXECUTE step. Used by the pipeline right
 * before confirmation and again right before execution (double-check: the
 * world may have changed between confirm and execute).
 */
export function policyCheck({ plan, action = {}, state = null }) {
  const violations = securityScan({ action, state });
  if (violations.length) {
    const fatal = violations.find((v) => SECURITY_STOP_CODES.includes(v.code)) || violations[0];
    return {
      allowed: false,
      safeStop: SECURITY_STOP_CODES.includes(fatal.code),
      level: 'EXECUTE',
      violations,
      stopCode: fatal.code,
      reason: fatal.detail
    };
  }
  const level = permissionForPlan(plan || []);
  return {
    allowed: true,
    safeStop: false,
    level,
    requiresConfirmation: level === 'EXECUTE',
    violations: []
  };
}
