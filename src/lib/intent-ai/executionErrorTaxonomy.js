/**
 * FBT INTENT AI — PHASE 56: RECEIPT ERROR TAXONOMY
 * ---------------------------------------------------------------------------
 * An execution error is not a black box. Before this module every failure —
 * a Guardian rejection, a missing authorization, an emergency stop, a dead
 * feed — collapsed into one receipt line: "Unavailable — no live venue".
 * That sentence was true for exactly one of those cases and misleading for
 * all the others.
 *
 * Two jobs live here:
 *
 *   1. `explainExecutionFailure()` turns a pipeline error (plus the Guardian
 *      reasons that produced it) into a specific, translatable receipt reason.
 *   2. `checkSessionPolicy()` lets the interactive confirmation screen show
 *      the ACTIVE SESSION POLICY ceilings under the fields — next to the
 *      product ceilings — and lock the final confirm before the user is sent
 *      into a rejection they could not have predicted.
 *
 * Reproduction case this closes: a $100 swap, edited to $500 on the
 * confirmation screen (under the $5k product ceiling, over the default $200
 * L3 session-policy ceiling) must say "above the session policy limit", not
 * "no live venue".
 */

export const RECEIPT_REASON_SCHEMA = 'fbt.receipt-reason.v1';
const NS = 'intentAI.receipt.reason.';

/** Every reason the receipt can state, each with its own i18n key. */
export const RECEIPT_REASONS = Object.freeze({
  POLICY_PER_TX: `${NS}policyPerTx`,
  POLICY_CAPITAL: `${NS}policyCapital`,
  POLICY_ASSET: `${NS}policyAsset`,
  POLICY_CHAIN: `${NS}policyChain`,
  POLICY_PROTOCOL: `${NS}policyProtocol`,
  POLICY_LOSS: `${NS}policyLoss`,
  POLICY_SLIPPAGE: `${NS}policySlippage`,
  POLICY_LEVERAGE: `${NS}policyLeverage`,
  POLICY_EXPIRED: `${NS}policyExpired`,
  POLICY_DESTINATION: `${NS}policyDestination`,
  PRODUCT_LIMIT: `${NS}productLimit`,
  PERMISSION: `${NS}permission`,
  AUTHORIZATION: `${NS}authorization`,
  EMERGENCY_STOP: `${NS}emergencyStop`,
  TERMS_CHANGED: `${NS}termsChanged`,
  SLIPPAGE_MOVED: `${NS}slippageMoved`,
  NO_SIGNER: `${NS}noSigner`,
  NO_PROVIDER: `${NS}noProvider`,
  NO_QUOTE: `${NS}noQuote`,
  NO_BROADCASTER: `${NS}noBroadcaster`,
  BRIDGE_UNAVAILABLE: `${NS}bridgeUnavailable`,
  BRIDGE_APPROVAL: `${NS}bridgeApproval`,
  NO_ROUTE: `${NS}noRoute`,
  RISK_BLOCKED: `${NS}riskBlocked`,
  DEADLINE: `${NS}deadline`,
  REVERTED: `${NS}reverted`,
  SUBMIT_REJECTED: `${NS}submitRejected`,
  PROVIDER: `${NS}provider`,
  PARTIAL: `${NS}partial`,
  SESSION_KEY: `${NS}sessionKey`,
  UNKNOWN: `${NS}unknown`
});

/** Guardian reason (may carry a `:detail` suffix) → receipt reason. */
const GUARDIAN_REASON_MAP = Object.freeze({
  TRANSACTION_LIMIT_EXCEEDED: 'POLICY_PER_TX',
  CAPITAL_LIMIT_EXCEEDED: 'POLICY_CAPITAL',
  CAPITAL_ABOVE_GLOBAL_HARD_CAP: 'PRODUCT_LIMIT',
  LEVERAGE_ABOVE_GLOBAL_HARD_CAP: 'PRODUCT_LIMIT',
  SLIPPAGE_ABOVE_GLOBAL_HARD_CAP: 'PRODUCT_LIMIT',
  FEE_ABOVE_GLOBAL_HARD_CAP: 'PRODUCT_LIMIT',
  ASSET_NOT_IN_POLICY: 'POLICY_ASSET',
  CHAIN_NOT_IN_POLICY: 'POLICY_CHAIN',
  CHAIN_NOT_SUPPORTED: 'POLICY_CHAIN',
  CHAIN_REQUIRED: 'POLICY_CHAIN',
  PROTOCOL_NOT_IN_POLICY: 'POLICY_PROTOCOL',
  PROTOCOL_NOT_SUPPORTED: 'POLICY_PROTOCOL',
  LOSS_CAP_EXCEEDED: 'POLICY_LOSS',
  SLIPPAGE_LIMIT_EXCEEDED: 'POLICY_SLIPPAGE',
  FEE_LIMIT_EXCEEDED: 'POLICY_SLIPPAGE',
  LEVERAGE_LIMIT_EXCEEDED: 'POLICY_LEVERAGE',
  SESSION_EXPIRED: 'POLICY_EXPIRED',
  ACTION_DEADLINE_PASSED: 'DEADLINE',
  DESTINATION_NOT_IN_POLICY: 'POLICY_DESTINATION',
  AMOUNT_USD_REQUIRED: 'POLICY_PER_TX',
  MATERIAL_CHANGE_REAUTHORISATION_REQUIRED: 'TERMS_CHANGED',
  INSUFFICIENT_PERMISSION: 'PERMISSION'
});

/** Failure code → receipt reason, when no Guardian reason is more specific. */
const CODE_MAP = Object.freeze({
  GUARDIAN_REJECTED: 'POLICY_PER_TX',
  RISK_BLOCKED: 'RISK_BLOCKED',
  USER_AUTHORIZATION_REQUIRED: 'AUTHORIZATION',
  GATE_NOT_CONFIRMED: 'AUTHORIZATION',
  INSUFFICIENT_PERMISSION: 'PERMISSION',
  EMERGENCY_STOP: 'EMERGENCY_STOP',
  TERMS_CHANGED: 'TERMS_CHANGED',
  SESSION_KEY_EXPIRED: 'SESSION_KEY',
  SESSION_KEY_REVOKED: 'SESSION_KEY',
  DEADLINE_PASSED: 'DEADLINE',
  ONCHAIN_REVERT: 'REVERTED',
  SIMULATION_REVERT: 'REVERTED',
  SUBMIT_REJECTED: 'SUBMIT_REJECTED',
  SUBMIT_TIMEOUT: 'PROVIDER',
  CONFIRMATION_TIMEOUT: 'PROVIDER',
  PROVIDER_ERROR: 'PROVIDER',
  PROVIDER_TIMEOUT: 'PROVIDER',
  PARTIAL_FILL: 'PARTIAL',
  USER_REJECTED: 'AUTHORIZATION',
  USER_CANCELLED: 'AUTHORIZATION'
});

/** `detail` fragment → receipt reason (the most specific signal we have). */
const DETAIL_MAP = Object.freeze([
  [/NO_SIGNER|WALLET_REJECTED/i, 'NO_SIGNER'],
  [/NO_PROVIDER/i, 'NO_PROVIDER'],
  [/QUOTE|NO_QUOTE_SOURCE/i, 'NO_QUOTE'],
  [/NO_BROADCASTER|NO_TX_HASH/i, 'NO_BROADCASTER'],
  [/BRIDGE_EXECUTE_UNAVAILABLE/i, 'BRIDGE_UNAVAILABLE'],
  [/BRIDGE_APPROVAL|BRIDGE_TERMS_CHANGED/i, 'BRIDGE_APPROVAL'],
  [/SLIPPAGE_EXCEEDED/i, 'SLIPPAGE_MOVED'],
  [/NO_LIVE_ADAPTER|CHAIN_UNSUPPORTED/i, 'NO_ROUTE'],
  [/NO_MEV_GUARD|NO_DEADLINE|GUARD_EXPIRED/i, 'DEADLINE']
]);

/* -------------------------------------------------------------------------- */
/* 1. Session-policy ceilings for the interactive confirmation screen          */
/* -------------------------------------------------------------------------- */

/** The ACTIVE session-policy ceilings, in the shape the screen renders. */
export function sessionPolicyCaps(policy = null) {
  if (!policy || typeof policy !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    active: policy.userConfirmed === true,
    maxTransactionUsd: num(policy.maxTransactionUsd),
    maxCapitalUsd: num(policy.maxCapitalUsd),
    maxLossUsd: num(policy.maxLossUsd),
    maxLeverage: num(policy.maxLeverage),
    allowedChains: Array.isArray(policy.allowedChains) ? policy.allowedChains.map(Number).filter(Boolean) : [],
    allowedProtocols: Array.isArray(policy.allowedProtocols) ? policy.allowedProtocols.map((p) => String(p).toLowerCase()) : [],
    allowedAssets: Array.isArray(policy.allowedAssets) ? policy.allowedAssets.map((a) => String(a).toUpperCase()) : [],
    expiresAt: Number.isFinite(Number(policy.expiresAt)) ? Number(policy.expiresAt) : null
  };
}

/**
 * Check the values currently on the confirmation screen against the ACTIVE
 * session policy. Returns friendly, translatable violations — this is what
 * locks the final confirm before the user is dropped into a rejection.
 */
export function checkSessionPolicy(values = {}, policy = null, { now = Date.now() } = {}) {
  const caps = sessionPolicyCaps(policy);
  if (!caps) return { ok: true, caps: null, violations: [] };
  const violations = [];
  const amount = Number(values.amountUsd);

  if (caps.maxTransactionUsd !== null && Number.isFinite(amount) && amount > caps.maxTransactionUsd) {
    violations.push({
      code: 'SESSION_PER_TX_OVER_POLICY',
      reason: 'POLICY_PER_TX',
      i18nKey: RECEIPT_REASONS.POLICY_PER_TX,
      params: { value: amount, limit: caps.maxTransactionUsd }
    });
  }
  if (caps.maxCapitalUsd !== null && Number.isFinite(amount) && amount > caps.maxCapitalUsd) {
    violations.push({
      code: 'SESSION_CAPITAL_OVER_POLICY',
      reason: 'POLICY_CAPITAL',
      i18nKey: RECEIPT_REASONS.POLICY_CAPITAL,
      params: { value: amount, limit: caps.maxCapitalUsd }
    });
  }
  if (caps.allowedChains.length && values.chainId != null && !caps.allowedChains.includes(Number(values.chainId))) {
    violations.push({
      code: 'SESSION_CHAIN_NOT_ALLOWED',
      reason: 'POLICY_CHAIN',
      i18nKey: RECEIPT_REASONS.POLICY_CHAIN,
      params: { value: Number(values.chainId), allowed: caps.allowedChains.join(', ') }
    });
  }
  if (caps.allowedProtocols.length && values.protocol) {
    const map = { dex_aggregator: 'swap', bridge_router: 'bridge', lending_market: 'defi' };
    const raw = String(values.protocol).toLowerCase();
    const proto = map[raw] || raw;
    if (!caps.allowedProtocols.includes(proto)) {
      violations.push({
        code: 'SESSION_PROTOCOL_NOT_ALLOWED',
        reason: 'POLICY_PROTOCOL',
        i18nKey: RECEIPT_REASONS.POLICY_PROTOCOL,
        params: { value: proto, allowed: caps.allowedProtocols.join(', ') }
      });
    }
  }
  if (caps.allowedAssets.length) {
    const assets = [values.fromSymbol, values.toSymbol]
      .filter(Boolean)
      .map((a) => String(a).toUpperCase());
    const offending = assets.filter((a) => !caps.allowedAssets.includes(a));
    if (assets.length && offending.length) {
      violations.push({
        code: 'SESSION_ASSET_NOT_ALLOWED',
        reason: 'POLICY_ASSET',
        i18nKey: RECEIPT_REASONS.POLICY_ASSET,
        params: { value: offending.join(', '), allowed: caps.allowedAssets.join(', ') }
      });
    }
  }
  if (caps.expiresAt !== null && now > caps.expiresAt) {
    violations.push({
      code: 'SESSION_POLICY_EXPIRED',
      reason: 'POLICY_EXPIRED',
      i18nKey: RECEIPT_REASONS.POLICY_EXPIRED,
      params: {}
    });
  }
  return { ok: violations.length === 0, caps, violations };
}

/* -------------------------------------------------------------------------- */
/* 2. Turning a pipeline failure into an honest receipt line                   */
/* -------------------------------------------------------------------------- */

/** Normalise Guardian's reason strings (they may carry a `:detail` suffix). */
export function normalizeGuardianReasons(reasons) {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .map((r) => String(r || '').trim())
    .filter(Boolean)
    .map((r) => ({ raw: r.slice(0, 96), head: r.split(':')[0].toUpperCase() }));
}

/** Pull the Guardian reasons back out of a classified error's detail blob. */
export function guardianReasonsFromError(error) {
  const detail = error?.detail;
  if (!detail || typeof detail !== 'string') return [];
  try {
    const parsed = JSON.parse(detail);
    if (Array.isArray(parsed?.reasons)) return parsed.reasons;
  } catch { /* detail is not JSON — fall through */ }
  return [];
}

/**
 * The one function the receipt calls.
 * @returns {{status:string, reason:string, i18nKey:string, params:object,
 *            reasons:string[], detail:string|null, code:string|null}}
 */
export function explainExecutionFailure({
  error = null,
  guardianReasons = null,
  policy = null,
  terms = null,
  reauthoriseRequired = false,
  venueReasons = null
} = {}) {
  const code = error?.code ? String(error.code).toUpperCase() : null;
  const detail = error?.detail ? String(error.detail) : null;
  const reasons = normalizeGuardianReasons(
    (Array.isArray(guardianReasons) && guardianReasons.length ? guardianReasons : null)
    || guardianReasonsFromError(error)
    || []
  );

  // 1. A Guardian reason is always the most specific truth available.
  for (const reason of reasons) {
    const mapped = GUARDIAN_REASON_MAP[reason.head];
    if (mapped) {
      return build(mapped, {
        code,
        detail: reason.raw,
        reasons: reasons.map((r) => r.raw),
        params: paramsFor(mapped, { policy, terms, reason: reason.raw })
      });
    }
  }

  // 2. Venue health reasons (no signer / no provider / bridge not wired).
  for (const raw of Array.isArray(venueReasons) ? venueReasons : []) {
    for (const [re, mapped] of DETAIL_MAP) {
      if (re.test(String(raw))) {
        return build(mapped, { code, detail: String(raw).slice(0, 96), reasons: reasons.map((r) => r.raw), params: {} });
      }
    }
  }

  // 3. The failure detail (NO_SIGNER, QUOTE_STALE, BRIDGE_…) beats the class.
  if (detail) {
    for (const [re, mapped] of DETAIL_MAP) {
      if (re.test(detail)) {
        return build(mapped, { code, detail: detail.slice(0, 96), reasons: reasons.map((r) => r.raw), params: {} });
      }
    }
  }

  // 4. Otherwise the classified failure code.
  if (code && CODE_MAP[code]) {
    return build(CODE_MAP[code], {
      code,
      detail: detail ? detail.slice(0, 96) : null,
      reasons: reasons.map((r) => r.raw),
      params: paramsFor(CODE_MAP[code], { policy, terms })
    });
  }
  if (reauthoriseRequired) {
    return build('TERMS_CHANGED', { code, detail, reasons: reasons.map((r) => r.raw), params: {} });
  }
  return build('UNKNOWN', { code, detail: detail ? detail.slice(0, 96) : null, reasons: reasons.map((r) => r.raw), params: {} });
}

/** Receipt status word for a reason — a policy refusal is not "unavailable". */
export function receiptStatusForReason(reason) {
  switch (reason) {
    case 'POLICY_PER_TX':
    case 'POLICY_CAPITAL':
    case 'POLICY_ASSET':
    case 'POLICY_CHAIN':
    case 'POLICY_PROTOCOL':
    case 'POLICY_LOSS':
    case 'POLICY_SLIPPAGE':
    case 'POLICY_LEVERAGE':
    case 'POLICY_EXPIRED':
    case 'POLICY_DESTINATION':
    case 'PRODUCT_LIMIT':
    case 'RISK_BLOCKED':
      return 'blocked';
    case 'AUTHORIZATION':
    case 'PERMISSION':
      return 'unconfirmed';
    case 'EMERGENCY_STOP':
      return 'emergency-stop';
    case 'TERMS_CHANGED':
    case 'SLIPPAGE_MOVED':
      return 'reauthorize';
    case 'REVERTED':
    case 'SUBMIT_REJECTED':
      return 'failed';
    case 'PARTIAL':
      return 'partial';
    default:
      return 'unavailable';
  }
}

function build(reason, { code = null, detail = null, reasons = [], params = {} } = {}) {
  return {
    schema: RECEIPT_REASON_SCHEMA,
    reason,
    i18nKey: RECEIPT_REASONS[reason] || RECEIPT_REASONS.UNKNOWN,
    status: receiptStatusForReason(reason),
    code,
    detail,
    reasons,
    params
  };
}

function paramsFor(reason, { policy, terms } = {}) {
  const caps = sessionPolicyCaps(policy);
  const amount = Number(terms?.amountIn ?? terms?.amountUsd);
  switch (reason) {
    case 'POLICY_PER_TX':
      return { value: Number.isFinite(amount) ? amount : null, limit: caps?.maxTransactionUsd ?? null };
    case 'POLICY_CAPITAL':
      return { value: Number.isFinite(amount) ? amount : null, limit: caps?.maxCapitalUsd ?? null };
    case 'POLICY_CHAIN':
      return { value: terms?.chainId ?? null, allowed: (caps?.allowedChains || []).join(', ') };
    case 'POLICY_PROTOCOL':
      return { value: terms?.protocol ?? null, allowed: (caps?.allowedProtocols || []).join(', ') };
    case 'POLICY_ASSET':
      return { value: [terms?.fromSymbol, terms?.toSymbol].filter(Boolean).join(' → '), allowed: (caps?.allowedAssets || []).join(', ') };
    case 'POLICY_LOSS':
      return { limit: caps?.maxLossUsd ?? null };
    case 'POLICY_LEVERAGE':
      return { limit: caps?.maxLeverage ?? null };
    default:
      return {};
  }
}
