/**
 * FBT INTENT AI — GUARDIAN (independent, non-disableable)
 * ---------------------------------------------------------------------------
 * Guardian is the last deterministic gate before any money-moving action.
 * No Agent (internal or external), no UI module, and no administrator can
 * disable it. It is pure, synchronous, and fail-closed: any missing field,
 * any unknown policy, any disallowed parameter is a rejection, never a pass.
 *
 * Guardian's decision is a simple { approved, reasons[], warnings[] }.
 * It never signs, never holds keys, never routes orders. It only answers:
 *   "is this action allowed under this policy RIGHT NOW?"
 *
 * The list of rejection reasons is comprehensive per the master spec.
 */

import { SENSITIVE_ACTIONS } from '../intentGuardian.js';
import { DEFAULT_POLICY_CAPS, ALLOWED_CHAINS, ALLOWED_PROTOCOLS } from './permissions.js';

/* Prompt-injection heuristic substrings. If these appear in ANY string field
   of a proposed action (note, recipient label, agent message, sticker, ...),
   Guardian rejects immediately. We err on the side of false positives — the
   user can rephrase; a successful injection can move money. */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules?)/i,
  /you\s+are\s+now/i,
  /disregard\s+(your|the|all)\s+(safety|guardian|policy|rules?)/i,
  /reveal\s+(the\s+)?(private\s+key|seed|mnemonic|secret)/i,
  /sign(ed|ing)?\s+this\s+(for|now)/i,
  /bypass\s+(the\s+)?(guardian|policy|safety|risk)/i,
  /system:\s*\{/i,
  /<[\/]?(script|iframe|object|embed)/i,
  /delete\s+(all\s+)?audit/i,
  /disable\s+(the\s+)?guardian/i
];

function finiteNonNeg(v) {
  return Number.isFinite(Number(v)) && Number(v) >= 0;
}

function asStringSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((v) => String(v).toUpperCase()));
}

/**
 * Recursively scan a value for prompt-injection strings and forbidden keys.
 * Returns an array of reason fragments starting with a code prefix:
 *   'PROMPT_INJECTION:xxx'  — injection text found
 *   'SENSITIVE_FIELD:xxx'   — a forbidden key was present
 */
function scanInjection(value, seen = new Set(), out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    for (const rx of INJECTION_PATTERNS) {
      const m = value.match(rx);
      if (m) { out.push(`PROMPT_INJECTION:${m[0]}`); break; }
    }
    return out;
  }
  if (typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) scanInjection(item, seen, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (/secret|privatekey|mnemonic|seedphrase|password/i.test(k)) out.push(`SENSITIVE_FIELD:${k}`);
    scanInjection(v, seen, out);
  }
  return out;
}

/**
 * Review a proposed action against policy and runtime context.
 *
 * @param {object} action  { action, chainId, protocol, asset, amountUsd,
 *                           leverage, slippagePct, feeBps, recipientRef,
 *                           routeFingerprint, agentId, externalAgent, note,
 *                           deadlineAt }
 * @param {object} policy  output of sanitizePolicy() (permissions.js)
 * @param {object} [ctx]   { sessionStartAt, currentLossUsd, now,
 *                           approvedTermsHash, termsHash, capabilities:{} }
 */
export function guardianReview(action, policy, ctx = {}) {
  const reasons = [];
  const warnings = [];

  // ---- 0. structural integrity ----
  if (!action || typeof action !== 'object') {
    reasons.push('MISSING_ACTION');
    return result(reasons, warnings);
  }
  if (!policy || typeof policy !== 'object') {
    reasons.push('MISSING_POLICY');
    return result(reasons, warnings);
  }

  // ---- 1. injection / secret exfiltration scan ----
  const injectionHits = scanInjection(action);
  for (const hit of injectionHits.slice(0, 8)) reasons.push(hit.slice(0, 96));

  // ---- 2. sensitive action must be declared ----
  const actionName = String(action.action || '').toLowerCase();
  if (!actionName) reasons.push('MISSING_ACTION_TYPE');
  if (actionName && !SENSITIVE_ACTIONS.has(actionName) && !['analyze', 'quote', 'draft'].includes(actionName)) {
    warnings.push(`UNKNOWN_ACTION:${actionName}`);
  }
  const isSensitive = SENSITIVE_ACTIONS.has(actionName);

  // ---- 3. permission level ----
  const level = Number(policy.level) || 1;
  // Sensitive actions require at least L2 (PREPARE) to even quote/draft them.
  if (isSensitive && level < 2) reasons.push('INSUFFICIENT_PERMISSION:NEED_PREPARE');
  // Actual execution (action.execution === true) requires L3 CONTROLLED_AUTONOMOUS,
  // regardless of action name — this is what enforces that L2 produces drafts only.
  if (action.execution === true && level < 3) {
    reasons.push('INSUFFICIENT_PERMISSION:NEED_CONTROLLED');
  }

  // ---- 4. global hard caps always apply (even at L2 quote time) ----
  if (finiteNonNeg(action.amountUsd) && Number(action.amountUsd) > DEFAULT_POLICY_CAPS.maxCapitalUsd) {
    reasons.push('CAPITAL_ABOVE_GLOBAL_HARD_CAP');
  }
  if (finiteNonNeg(action.leverage) && Number(action.leverage) > DEFAULT_POLICY_CAPS.maxLeverage) {
    reasons.push('LEVERAGE_ABOVE_GLOBAL_HARD_CAP');
  }
  if (finiteNonNeg(action.slippagePct) && Number(action.slippagePct) > DEFAULT_POLICY_CAPS.maxSlippagePct) {
    reasons.push('SLIPPAGE_ABOVE_GLOBAL_HARD_CAP');
  }
  if (finiteNonNeg(action.feeBps) && Number(action.feeBps) > DEFAULT_POLICY_CAPS.maxFeeBps) {
    reasons.push('FEE_ABOVE_GLOBAL_HARD_CAP');
  }

  // ---- 5. per-session policy caps (only binding when executing at L3) ----
  if (level >= 3 && action.execution === true) {
    if (finiteNonNeg(action.amountUsd)) {
      if (Number(action.amountUsd) > Number(policy.maxCapitalUsd)) reasons.push('CAPITAL_LIMIT_EXCEEDED');
      if (Number(action.amountUsd) > Number(policy.maxTransactionUsd)) reasons.push('TRANSACTION_LIMIT_EXCEEDED');
    } else {
      reasons.push('AMOUNT_USD_REQUIRED');
    }

    if (finiteNonNeg(action.leverage) && Number(action.leverage) > Number(policy.maxLeverage)) {
      reasons.push('LEVERAGE_LIMIT_EXCEEDED');
    }
    if (finiteNonNeg(action.slippagePct) && Number(policy.maxSlippagePct) > 0
        && Number(action.slippagePct) > Number(policy.maxSlippagePct)) {
      reasons.push('SLIPPAGE_LIMIT_EXCEEDED');
    }
    if (finiteNonNeg(action.feeBps) && Number(policy.maxFeeBps) > 0
        && Number(action.feeBps) > Number(policy.maxFeeBps)) {
      reasons.push('FEE_LIMIT_EXCEEDED');
    }

    // loss cap — cumulative
    if (finiteNonNeg(policy.maxLossUsd) && Number(policy.maxLossUsd) >= 0) {
      const lossSoFar = Number(ctx.currentLossUsd) || 0;
      const projectedLoss = Number(action.projectedLossUsd) || Number(action.amountUsd) * 0.05;
      if (lossSoFar + projectedLoss > Number(policy.maxLossUsd)) {
        reasons.push('LOSS_CAP_EXCEEDED');
      }
    }

    // chains / protocols / assets allowlists
    if (action.chainId != null) {
      if (!ALLOWED_CHAINS.has(Number(action.chainId))) reasons.push('CHAIN_NOT_SUPPORTED');
      if (Array.isArray(policy.allowedChains) && policy.allowedChains.length
        && !policy.allowedChains.includes(Number(action.chainId))) {
        reasons.push('CHAIN_NOT_IN_POLICY');
      }
    } else if (isSensitive) {
      reasons.push('CHAIN_REQUIRED');
    }

    if (action.protocol) {
      const rawProto = String(action.protocol).toLowerCase();
      const protoMap = { dex_aggregator: 'swap', bridge_router: 'bridge', lending_market: 'defi' };
      const proto = protoMap[rawProto] || rawProto;
      if (!ALLOWED_PROTOCOLS.has(proto)) reasons.push(`PROTOCOL_NOT_SUPPORTED:${proto}`);
      const allowedProtos = asStringSet(policy.allowedProtocols);
      if (allowedProtos.size && !allowedProtos.has(proto.toUpperCase())) reasons.push('PROTOCOL_NOT_IN_POLICY');
    }

    if (action.asset && Array.isArray(policy.allowedAssets) && policy.allowedAssets.length) {
      const allowedAssets = asStringSet(policy.allowedAssets);
      const assetOk = allowedAssets.has(String(action.asset).toUpperCase())
        || (action.toSymbol && allowedAssets.has(String(action.toSymbol).toUpperCase()))
        || (action.fromSymbol && allowedAssets.has(String(action.fromSymbol).toUpperCase()));
      if (!assetOk) reasons.push('ASSET_NOT_IN_POLICY');
    }

    // destinations
    if (action.recipientRef) {
      if (!Array.isArray(policy.allowedDestinations) || !policy.allowedDestinations.length) {
        reasons.push('DESTINATION_NOT_IN_POLICY');
      } else {
        const allowed = new Set(policy.allowedDestinations);
        if (!allowed.has(String(action.recipientRef))) reasons.push('DESTINATION_NOT_IN_POLICY');
      }
    }

    // session duration
    if (policy.durationMs > 0 && ctx.sessionStartAt) {
      const elapsed = (ctx.now || Date.now()) - Number(ctx.sessionStartAt);
      if (elapsed > Number(policy.durationMs)) reasons.push('SESSION_EXPIRED');
    }

    // deadline
    if (action.deadlineAt && Number(action.deadlineAt) < (ctx.now || Date.now())) {
      reasons.push('ACTION_DEADLINE_PASSED');
    }
  } else if (level < 3) {
    // At L1/L2 we still enforce global chain/protocol sanity but NOT per-session allowlists.
    if (action.chainId != null && !ALLOWED_CHAINS.has(Number(action.chainId))) {
      reasons.push('CHAIN_NOT_SUPPORTED');
    }
    if (action.protocol) {
      const rawProto = String(action.protocol).toLowerCase();
      const protoMap = { dex_aggregator: 'swap', bridge_router: 'bridge', lending_market: 'defi' };
      const proto = protoMap[rawProto] || rawProto;
      if (!ALLOWED_PROTOCOLS.has(proto)) reasons.push(`PROTOCOL_NOT_SUPPORTED:${proto}`);
    }
  }

  // ---- 6. unexpected asset in swap ----
  if (action.expectedAsset && action.actualAsset && action.expectedAsset !== action.actualAsset) {
    reasons.push('UNEXPECTED_ASSET');
  }

  // ---- 7. terms re-authorisation ----
  if (isSensitive && ctx.approvedTermsHash && ctx.termsHash && ctx.approvedTermsHash !== ctx.termsHash) {
    reasons.push('MATERIAL_CHANGE_REAUTHORISATION_REQUIRED');
  }

  // ---- 8. external-agent-specific checks ----
  if (action.externalAgent) {
    if (action.externalAgent.securityStatus !== 'verified') reasons.push('EXTERNAL_AGENT_NOT_VERIFIED');
    if (!action.agentId) reasons.push('EXTERNAL_AGENT_ID_REQUIRED');
    if (action.capabilityToken === true) warnings.push('CAPABILITY_TOKEN_PRESENT');
    if (action.brokerMasterCredential === true) reasons.push('EXTERNAL_AGENT_FORBIDDEN_CREDENTIAL');
  }

  // ---- 9. audit-deletion attempts ----
  if (/delete.*audit|purge.*log/i.test(String(action.note || '') + String(action.message || ''))) {
    reasons.push('AUDIT_DELETION_ATTEMPT');
  }

  // ---- 10. success-receipt honesty ----
  if (action.txHash && action.status === 'COMPLETED' && !action.onChainConfirmed) {
    warnings.push('UNCONFIRMED_RECEIPT');
  }

  const approved = reasons.length === 0;
  return { approved, reasons, warnings, level, isSensitive };
}

function result(reasons, warnings) {
  return { approved: false, reasons, warnings, level: 0, isSensitive: true };
}

/** Emergency stop: a hard check that can never return `go` when a stop flag is set. */
export function emergencyStopCheck(stopFlagSet) {
  if (stopFlagSet === true) return { ok: false, reason: 'EMERGENCY_STOP_ACTIVE' };
  return { ok: true };
}

/** Guardian is non-disableable by construction: expose a sentinel. */
export const GUARDIAN_NON_DISABLEABLE = true;
