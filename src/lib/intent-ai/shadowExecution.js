/**
 * FBT INTENT AI — Spec 65 item 24: Shadow / Paper Execution.
 *
 * A strategy can be exercised against an isolated paper sandbox before any
 * real capital is considered. Hard boundaries:
 *   - The sandbox must be attested isolated; no mainnet, no production signer,
 *     no real custody references are accepted anywhere in the run.
 *   - A timeout is a timeout, never a quote: it produces `status:'timeout'`
 *     with price/output null, never a zero-cost fill.
 *   - A passed paper run is `paper-passed`, NOT live-ready; moving to real
 *     execution requires a separate user authorization + Guardian + evidence.
 */

import { containsRawSecret, fail, finite, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const SHADOW_RUN_SCHEMA = 'fbt.intent-shadow-run.v1';

export const SHADOW_RUN_STATUSES = Object.freeze(['created', 'running', 'paper-passed', 'paper-failed', 'timeout', 'sandbox-rejected']);

const FORBIDDEN_RUNTIME_FIELDS = /^(?:mainnet|productionSigner|production_signer|realCustody|real_custody|privateKey|seed|mnemonic|liveSigner)$/i;

function rejectRealRuntime(input) {
  if (!input || typeof input !== 'object') return null;
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_RUNTIME_FIELDS.test(key) && (value === true || (typeof value === 'string' && value.length > 0))) {
      return key;
    }
  }
  return null;
}

function sandboxAttested(sandbox) {
  if (!sandbox || typeof sandbox !== 'object') return false;
  return sandbox.isolated === true
    && sandbox.operatorId != null && safeId(String(sandbox.operatorId)) !== null
    && sandbox.attestedAt != null && Number.isFinite(Number(sandbox.attestedAt));
}

/**
 * Create a shadow run against a paper sandbox. Rejects any payload that
 * references mainnet, a production signer or real custody.
 */
export function createShadowRun({ strategyId = null, sandbox = null, paperCapitalUsd = null, now = Date.now() } = {}) {
  if (containsRawSecret({ strategyId, sandbox })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const id = safeId(strategyId);
  if (!id) return fail('STRATEGY_ID_REQUIRED');
  const forbidden = rejectRealRuntime(sandbox);
  if (forbidden) return fail('REAL_RUNTIME_FORBIDDEN_IN_SHADOW', `Field "${forbidden}" is not allowed in a shadow run.`);
  if (!sandboxAttested(sandbox)) return fail('SANDBOX_ISOLATION_REQUIRED', 'A shadow run requires an attested isolated sandbox; without it status stays unavailable.');
  const capital = finite(paperCapitalUsd);
  if (capital === null || capital <= 0) return fail('PAPER_CAPITAL_REQUIRED');
  return noExecutionPermission({
    ok: true,
    schema: SHADOW_RUN_SCHEMA,
    runId: safeId(`shadow-${id}`) || `shadow-${id}`,
    strategyId: id,
    sandbox: { operatorId: safeId(String(sandbox.operatorId)), attestedAt: Number(sandbox.attestedAt), isolated: true },
    paperCapitalUsd: capital,
    realCapitalUsd: null,
    status: 'created',
    venue: 'paper-sandbox',
    mainnet: false,
    productionSignerUsed: false,
    executionAuthorized: false,
    createdAt: now
  });
}

/**
 * Advance a shadow run through a supplied paper simulator. The simulator is
 * injected; none is invented here. Timeout vs fill are distinguished: a
 * timeout never becomes a quote and never yields output/cost zeros.
 */
export async function advanceShadowRun(run, { paperSimulator = null, timeoutMs = 30_000, now = Date.now() } = {}) {
  if (!run || run.schema !== SHADOW_RUN_SCHEMA) return fail('BAD_SHADOW_RUN');
  if (run.status !== 'created' && run.status !== 'running') return fail('SHADOW_RUN_NOT_ACTIVE', run.status);
  if (typeof paperSimulator !== 'function') {
    return noExecutionPermission({ ...run, status: 'sandbox-rejected', code: 'PAPER_SIMULATOR_UNAVAILABLE', ok: false, failClosed: true });
  }
  const forbidden = rejectRealRuntime(paperSimulator);
  if (forbidden) return fail('REAL_RUNTIME_FORBIDDEN_IN_SHADOW', `Field "${forbidden}" is not allowed in a shadow run.`);
  try {
    const result = await Promise.race([
      Promise.resolve(paperSimulator({ strategyId: run.strategyId, paperCapitalUsd: run.paperCapitalUsd, venue: 'paper-sandbox' })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SHADOW_TIMEOUT')), Math.max(1, Math.min(timeoutMs, 120_000))))
    ]);
    if (!result || typeof result !== 'object') {
      return noExecutionPermission({ ...run, status: 'paper-failed', code: 'PAPER_RESULT_INVALID', ok: false, failClosed: true, checkedAt: now });
    }
    if (result.timedOut === true || safeString(result.status, 32) === 'timeout') {
      // A timeout is NOT a quote: no output, no cost, no slippage zeros.
      return noExecutionPermission({ ...run, status: 'timeout', code: 'PAPER_TIMEOUT', outputUsd: null, costUsd: null, slippagePct: null, timeoutIsQuote: false, checkedAt: now });
    }
    const passed = result.passed === true || safeString(result.status, 32) === 'passed';
    const output = finite(result.outputUsd ?? result.output);
    return noExecutionPermission({
      ...run,
      status: passed ? 'paper-passed' : 'paper-failed',
      outputUsd: output === null ? null : Math.max(0, output),
      costUsd: finite(result.costUsd),
      slippagePct: finite(result.slippagePct),
      paperOnly: true,
      liveReady: false,
      checkedAt: now
    });
  } catch (error) {
    if (safeString(String(error?.message || ''), 32) === 'SHADOW_TIMEOUT') {
      return noExecutionPermission({ ...run, status: 'timeout', code: 'PAPER_TIMEOUT', outputUsd: null, costUsd: null, slippagePct: null, timeoutIsQuote: false, checkedAt: now });
    }
    return noExecutionPermission({ ...run, status: 'paper-failed', code: 'PAPER_SIMULATOR_ERROR', ok: false, failClosed: true, checkedAt: now });
  }
}

/**
 * The only bridge from paper to real consideration. It refuses to authorize:
 * it returns the checklist that a separate real-execution flow must satisfy
 * (fresh authorization screen + explicit user confirmation + independent
 * Guardian + Risk Policy + current evidence). Paper success alone is never
 * sufficient.
 */
export function paperToRealRequirements(run) {
  if (!run || run.schema !== SHADOW_RUN_SCHEMA) return fail('BAD_SHADOW_RUN');
  return noExecutionPermission({
    ok: run.status === 'paper-passed',
    schema: SHADOW_RUN_SCHEMA,
    paperStatus: run.status,
    canGoLiveDirectly: false,
    autoUpgradeFromPaper: false,
    requiredBeforeRealExecution: [
      'NEW_AUTHORIZATION_SCREEN',
      'EXPLICIT_USER_CONFIRMATION',
      'INDEPENDENT_GUARDIAN_REVIEW',
      'RISK_POLICY_CHECK',
      'CURRENT_PROVIDER_SIGNER_SIMULATOR_RUNTIME_EVIDENCE',
      'VERIFIED_RECEIPT_PATH'
    ],
    note: 'A passed paper run is evidence for planning only; it never converts into live execution by itself.',
    executionAuthorized: false
  });
}
