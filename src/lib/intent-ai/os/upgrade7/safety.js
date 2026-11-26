/**
 * FBT INTENT OS — UPGRADE 7 · Action Safety Layer
 * ---------------------------------------------------------------------------
 * Spec §27 (Intent → Policy → Risk → Permission → Fresh Data → Simulation →
 * Confirmation → Signature → Execution → Verification), §28 (simulation before
 * execution), §21 (answer binding IDs), §46 (never put secrets in AI context).
 *
 * The repo already owns the real machinery: `intent-ai/simulationGate.js`,
 * `riskEngine.js`, `policyGuard.js`, `confirmationGate.js`, `os/security.js`.
 * This module does not re-implement any of it — it is the ORDER those gates must
 * run in, expressed as one auditable pipeline with an explicit stage log.
 */

/* The Smart Wallet's LOCAL policy is the policy Intent OS obeys: raising a cap
   on the Smart Wallet screen and ignoring it here was the whole bypass this
   default gate closes. It never imports an LLM, a signer or a network client. */
import { checkPolicy as checkSmartWalletPolicy } from '../../../smartWallet.js';
import { loadIntentMemory } from '../../../intentOS.js';

export const SAFETY_SCHEMA = 'fbt.action-safety.v7';

export const STAGE = Object.freeze({
  INTENT: 'intent', POLICY: 'policy', RISK: 'risk', PERMISSION: 'permission',
  FRESH_DATA: 'fresh_data', SIMULATION: 'simulation', CONFIRMATION: 'user_confirmation',
  SIGNATURE: 'wallet_signature', EXECUTION: 'execution', VERIFICATION: 'verification'
});

export const STAGE_ORDER = Object.freeze([
  STAGE.INTENT, STAGE.POLICY, STAGE.RISK, STAGE.PERMISSION, STAGE.FRESH_DATA,
  STAGE.SIMULATION, STAGE.CONFIRMATION, STAGE.SIGNATURE, STAGE.EXECUTION, STAGE.VERIFICATION
]);

/* -------------------------------------------------------------------------- */
/*  §46 SECRET GUARD                                                            */
/* -------------------------------------------------------------------------- */

const SECRET_PATTERNS = [
  /\b(private[\s_-]?key|seed[\s_-]?phrase|mnemonic|secret[\s_-]?key|signing[\s_-]?secret|kms[\s_-]?secret)\b/i,
  /\b0x[a-fA-F0-9]{64}\b/,                                  // raw 32-byte key
  /\b([a-z]{3,10}\s+){11}[a-z]{3,10}\b/i                    // 12-word phrase
];

const SENSITIVE_KEYS = /^(privatekey|private_key|pk|seed|seedphrase|mnemonic|secret|signingkey|kmskey|apisecret|sessionkey)$/i;

/** Never let a secret reach an LLM prompt or client-side AI context (§46). */
export function scrubForAI(value, depth = 0) {
  if (depth > 6) return '[depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const re of SECRET_PATTERNS) if (re.test(out)) out = '[redacted]';
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => scrubForAI(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.test(k)) { out[k] = '[redacted]'; continue; }
      out[k] = scrubForAI(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function containsSecret(value) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (!s) return false;
    if (SECRET_PATTERNS.some((re) => re.test(s))) return true;
    return Object.keys(typeof value === 'object' && value ? value : {}).some((k) => SENSITIVE_KEYS.test(k));
  } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/*  §21 ANSWER BINDING                                                          */
/* -------------------------------------------------------------------------- */

export function createQuestion({ intentId, slot, expectedType, text, locale = 'fa' } = {}) {
  return {
    questionId: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    intentId: intentId || null,
    slot,
    expectedType: expectedType || 'text',
    text,
    locale,
    timestamp: Date.now(),
    answered: false
  };
}

export function bindAnswerToQuestion(question, rawAnswer, parser = null) {
  if (!question) return { ok: false, reason: 'NO_QUESTION' };
  const value = typeof parser === 'function' ? parser(rawAnswer, question.expectedType) : rawAnswer;
  if (value == null || value === '') return { ok: false, reason: 'UNPARSEABLE', question };
  return {
    ok: true,
    questionId: question.questionId,
    intentId: question.intentId,
    slot: question.slot,
    expectedType: question.expectedType,
    value,
    raw: rawAnswer,
    boundAt: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/*  §28 SIMULATION PREVIEW                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Normalise whatever the real quote/simulation returned into the six numbers the
 * user must see BEFORE confirming. Missing numbers stay null — never invented.
 */
export function buildSimulationPreview(sim = {}, { locale = 'fa' } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const preview = {
    schema: 'fbt.simulation-preview.v7',
    expectedInput: sim.input ?? sim.fromAmount ?? sim.amountIn ?? null,
    expectedOutput: sim.output ?? sim.toAmount ?? sim.amountOut ?? sim.expectedOutput ?? null,
    estimatedFeeUsd: num(sim.feeUsd ?? sim.estimatedFeeUsd ?? sim.gasUsd),
    slippagePct: num(sim.slippage ?? sim.slippagePct),
    priceImpactPct: num(sim.priceImpact ?? sim.priceImpactPct),
    risk: sim.risk || sim.riskLevel || null,
    status: sim.status || (sim.ok === false ? 'revert' : 'clean'),
    simulatedAt: sim.simulatedAt || sim.timestamp || Date.now()
  };
  preview.complete = ['expectedInput', 'expectedOutput'].every((k) => preview[k] != null);
  preview.labels = fa
    ? { expectedInput: 'ورودی', expectedOutput: 'خروجی تخمینی', estimatedFeeUsd: 'کارمزد تخمینی', slippagePct: 'لغزش', priceImpactPct: 'اثر قیمتی', risk: 'ریسک' }
    : { expectedInput: 'Input', expectedOutput: 'Expected output', estimatedFeeUsd: 'Estimated fee', slippagePct: 'Slippage', priceImpactPct: 'Price impact', risk: 'Risk' };
  return preview;
}

/* -------------------------------------------------------------------------- */
/*  §27 THE PIPELINE                                                            */
/* -------------------------------------------------------------------------- */

function stageResult(stage, ok, detail = {}) {
  return { stage, ok, ...detail, at: Date.now() };
}

/**
 * THE DEFAULT POLICY GATE — fail closed on the user's own rules.
 *
 * A caller may inject a stricter gate; it may NOT omit one and inherit a pass.
 * The three user-facing controls are read from the same local policy the Smart
 * Wallet screen edits:
 *
 *   · لیست مجاز مقصد  — `to` must be on the allowlist whenever one exists;
 *   · مخاطبان بازیابی اجتماعی — a recovery request must name only guardians;
 *   · کلید نشست      — an intent using the session's raised caps must carry
 *                      the exact key minted when the session started.
 *
 * The session key may come from the action, the execution context, or the
 * Intent OS memory the user filled in on the Smart Wallet screen — never from
 * the policy itself, which is the thing being checked.
 */
export function defaultIntentPolicyGate({ intent = null, action = null, context = {} } = {}) {
  const pick = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };
  const usd = pick(
    action?.usd, action?.amountUsd, action?.valueUsd, intent?.usd, intent?.amountUsd, context?.usd
  );
  const to = action?.to || action?.destination || action?.recipient || intent?.to || context?.to || null;
  const sessionKey = action?.sessionKey || context?.sessionKey || intent?.sessionKey || loadIntentMemory().sessionKey || null;
  const recovery = action?.recovery || context?.recovery || intent?.recovery || null;
  const origin = action?.origin || context?.origin || 'intent';
  const decision = checkSmartWalletPolicy({ usd, to, sessionKey, recovery, origin });
  if (!decision.ok) {
    return {
      allowed: false,
      reason: decision.code,
      code: decision.code,
      policy: decision,
      message: ({
        NOT_ALLOWLISTED: 'This destination is not on your allowed list.',
        SESSION_KEY_REQUIRED: 'Start a session and enter its key before Intent OS uses the raised limit.',
        BAD_SESSION_KEY: 'The session key did not match this session.',
        NOT_A_GUARDIAN: 'A recovery recipient is not on your social-recovery list.'
      })[decision.code] || 'The Smart Wallet policy refused this action.'
    };
  }
  return { allowed: true, policy: decision, checked: { usd, to, recovery: Boolean(recovery), origin } };
}

/**
 * Runs the safety gates in the mandated order and STOPS at the first refusal.
 * Every gate is injected — this module owns the order, not the logic.
 *
 * @param {object} gates {
 *   checkPolicy, assessRisk, checkPermission, refreshData, simulate,
 *   requestConfirmation, sign, execute, verify
 * }  — every one optional; a missing gate is reported, never assumed to pass
 *      for the stages that matter (confirmation and signature).
 */
export async function runSafetyPipeline({
  intent = null, action = null, context = {}, gates = {}, locale = 'fa', dryRun = false
} = {}) {
  const stages = [];
  const fa = String(locale || 'fa').startsWith('fa');
  const fail = (stage, reason, extra = {}) => {
    stages.push(stageResult(stage, false, { reason, ...extra }));
    return {
      schema: SAFETY_SCHEMA, ok: false, blockedAt: stage, reason, stages,
      message: extra.message || (fa ? 'این عملیات متوقف شد.' : 'This operation was stopped.'),
      ...extra
    };
  };

  // 1 INTENT
  if (!intent || !action) return fail(STAGE.INTENT, 'NO_INTENT');
  if (containsSecret(action) || containsSecret(intent)) return fail(STAGE.INTENT, 'SECRET_IN_PAYLOAD');
  stages.push(stageResult(STAGE.INTENT, true, { type: intent.type || intent.primaryIntent }));

  // 2 POLICY
  {
    const p = typeof gates.checkPolicy === 'function'
      ? await safeCall(gates.checkPolicy, { intent, action, context })
      : await safeCall(defaultIntentPolicyGate, { intent, action, context });
    if (!p.ok || p.value?.allowed === false) return fail(STAGE.POLICY, p.value?.reason || 'POLICY_DENIED', { policy: p.value });
    stages.push(stageResult(STAGE.POLICY, true, { policy: p.value }));
  }

  // 3 RISK
  let risk = null;
  if (typeof gates.assessRisk === 'function') {
    const r = await safeCall(gates.assessRisk, { intent, action, context });
    risk = r.value || null;
    if (risk?.blocked === true) return fail(STAGE.RISK, risk.reason || 'RISK_BLOCKED', { risk });
    stages.push(stageResult(STAGE.RISK, true, { risk }));
  } else stages.push(stageResult(STAGE.RISK, true, { skipped: 'NO_RISK_GATE' }));

  // 4 PERMISSION
  if (typeof gates.checkPermission === 'function') {
    const perm = await safeCall(gates.checkPermission, { intent, action, context });
    if (!perm.ok || perm.value?.granted === false) return fail(STAGE.PERMISSION, perm.value?.reason || 'PERMISSION_DENIED', { permission: perm.value });
    stages.push(stageResult(STAGE.PERMISSION, true));
  } else stages.push(stageResult(STAGE.PERMISSION, true, { skipped: 'NO_PERMISSION_GATE' }));

  // 5 FRESH DATA — a financial action never runs on a cached price (§15).
  let fresh = null;
  if (typeof gates.refreshData === 'function') {
    const f = await safeCall(gates.refreshData, { intent, action, context });
    fresh = f.value || null;
    if (!f.ok || fresh?.ok === false) return fail(STAGE.FRESH_DATA, 'STALE_DATA', { freshness: fresh, message: fa ? 'داده بازار به‌روز نبود؛ عملیات انجام نشد.' : 'Market data was not fresh — the operation was not performed.' });
    stages.push(stageResult(STAGE.FRESH_DATA, true, { freshness: fresh }));
  } else stages.push(stageResult(STAGE.FRESH_DATA, true, { skipped: 'NO_FRESH_DATA_GATE' }));

  // 6 SIMULATION (§28)
  let preview = null;
  if (typeof gates.simulate === 'function') {
    const s = await safeCall(gates.simulate, { intent, action, context });
    if (!s.ok) return fail(STAGE.SIMULATION, 'SIMULATION_FAILED', { error: s.error });
    preview = buildSimulationPreview(s.value || {}, { locale });
    if (preview.status === 'revert') return fail(STAGE.SIMULATION, 'SIMULATION_REVERT', { simulation: preview });
    stages.push(stageResult(STAGE.SIMULATION, true, { simulation: preview }));
  } else stages.push(stageResult(STAGE.SIMULATION, true, { skipped: 'NO_SIMULATION_GATE' }));

  // A dry run stops here and hands the preview back for the confirmation card.
  if (dryRun) {
    return {
      schema: SAFETY_SCHEMA, ok: true, awaitingConfirmation: true, stages,
      simulation: preview, risk,
      message: fa ? 'برای اجرا نیاز به تایید شماست.' : 'Your confirmation is required to execute.'
    };
  }

  // 7 USER CONFIRMATION — never assumed. No gate means no execution.
  const confirmed = typeof gates.requestConfirmation === 'function'
    ? await safeCall(gates.requestConfirmation, { intent, action, simulation: preview, risk, context })
    : { ok: false, value: null };
  if (!confirmed.ok || confirmed.value !== true) {
    return fail(STAGE.CONFIRMATION, 'NOT_CONFIRMED', { simulation: preview, message: fa ? 'بدون تایید شما اجرا نشد.' : 'Not executed without your confirmation.' });
  }
  stages.push(stageResult(STAGE.CONFIRMATION, true));

  // 8 WALLET SIGNATURE — the AI holds no key; it can only ask the wallet.
  let signed = null;
  if (typeof gates.sign === 'function') {
    const sg = await safeCall(gates.sign, { intent, action, context });
    if (!sg.ok || !sg.value) return fail(STAGE.SIGNATURE, 'SIGNATURE_REJECTED', { error: sg.error });
    signed = scrubForAI(sg.value);
    stages.push(stageResult(STAGE.SIGNATURE, true));
  } else {
    return fail(STAGE.SIGNATURE, 'NO_SIGNER', { message: fa ? 'امضاکننده در دسترس نیست.' : 'No signer available.' });
  }

  // 9 EXECUTION
  const exec = typeof gates.execute === 'function'
    ? await safeCall(gates.execute, { intent, action, signed, context })
    : { ok: false, error: 'NO_EXECUTOR' };
  if (!exec.ok) return fail(STAGE.EXECUTION, exec.error || 'EXECUTION_FAILED', { simulation: preview });
  stages.push(stageResult(STAGE.EXECUTION, true, { result: scrubForAI(exec.value) }));

  // 10 VERIFICATION
  let verification = null;
  if (typeof gates.verify === 'function') {
    const v = await safeCall(gates.verify, { intent, action, result: exec.value, simulation: preview, context });
    verification = v.value || null;
    stages.push(stageResult(STAGE.VERIFICATION, v.ok !== false, { verification }));
  } else stages.push(stageResult(STAGE.VERIFICATION, true, { skipped: 'NO_VERIFY_GATE' }));

  return {
    schema: SAFETY_SCHEMA, ok: true, stages,
    simulation: preview, risk, result: scrubForAI(exec.value), verification,
    completedStages: stages.filter((s) => s.ok).map((s) => s.stage)
  };
}

async function safeCall(fn, arg) {
  try { return { ok: true, value: await fn(arg) }; }
  catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

/** Human-readable stage list for the confirmation card (§37 uses existing UI). */
export function pipelineStatus(result, locale = 'fa') {
  const fa = String(locale || 'fa').startsWith('fa');
  const names = fa
    ? { intent: 'درخواست', policy: 'سیاست', risk: 'ریسک', permission: 'دسترسی', fresh_data: 'داده تازه', simulation: 'شبیه‌سازی', user_confirmation: 'تایید شما', wallet_signature: 'امضای کیف پول', execution: 'اجرا', verification: 'راستی‌آزمایی' }
    : { intent: 'Intent', policy: 'Policy', risk: 'Risk', permission: 'Permission', fresh_data: 'Fresh data', simulation: 'Simulation', user_confirmation: 'Your confirmation', wallet_signature: 'Wallet signature', execution: 'Execution', verification: 'Verification' };
  return STAGE_ORDER.map((stage) => {
    const s = (result?.stages || []).find((x) => x.stage === stage);
    return {
      stage,
      label: names[stage],
      status: !s ? 'pending' : (s.ok ? (s.skipped ? 'skipped' : 'completed') : 'failed')
    };
  });
}
