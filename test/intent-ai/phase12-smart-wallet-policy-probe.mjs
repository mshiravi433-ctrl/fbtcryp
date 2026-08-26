/* Phase 12 — Smart Wallet policy, independent Guardian and authorization screen. */
import {
  createSmartWalletPolicy,
  evaluateSmartWalletPolicy,
  buildFeeSheet,
  guardianDecision,
  createAuthorizationScreen,
  confirmAuthorization,
  authorizeFinancialExecution,
  createControls,
  applySmartWalletControl
} from '../../src/lib/intent-ai/index.js';
import { FEE_TYPES } from '../../src/lib/intent-ai/smartWalletPolicy.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const input = {
  id: 'policy-12', version: '1', capitalLimitUsd: 1000, transactionLimitUsd: 200,
  riskLimitPct: 40, protocolAllowlist: ['swap'], chainAllowlist: [42161],
  timeLimitSeconds: 3600, feeLimitUsd: 10, slippageLimitPct: 1, expiresAt: now + 3600000
};
const request = { capitalUsd: 100, amountUsd: 50, riskPct: 10, protocol: 'swap', chainId: 42161, durationSeconds: 60, feeUsd: 1, slippagePct: 0.2 };

try {
  const incomplete = createSmartWalletPolicy({ id: 'bad-policy', capitalLimitUsd: 1 });
  check('incomplete policy fails closed', !incomplete.ok && incomplete.code === 'POLICY_INCOMPLETE');
  const created = createSmartWalletPolicy(input, { now });
  check('valid policy contains all eight bounded limits', created.ok && created.policy.guardianRequired && created.policy.protocolAllowlist.length === 1 && created.policy.chainAllowlist.length === 1 && created.policy.slippageLimitPct === 1);
  const evaluated = evaluateSmartWalletPolicy({ policy: created.policy, request, now });
  check('policy evaluation checks chain and protocol explicitly', evaluated.ok && evaluated.decision === 'ALLOW_REVIEW_ONLY' && Object.values(evaluated.checked).every(Boolean));
  check('an over-limit transaction is blocked', evaluateSmartWalletPolicy({ policy: created.policy, request: { ...request, amountUsd: 201 }, now }).code === 'TRANSACTION_LIMIT_EXCEEDED');
  check('an empty chain/protocol scope is blocked', evaluateSmartWalletPolicy({ policy: { ...created.policy, chainAllowlist: [] }, request, now }).code === 'POLICY_INCOMPLETE');

  const unknownFees = buildFeeSheet({ fees: { network: 1 }, now });
  check('unknown fees are not treated as zero', !unknownFees.ok && unknownFees.executionAllowed === false && unknownFees.unknownFees.length === FEE_TYPES.length - 1);
  const fees = Object.fromEntries(FEE_TYPES.map((type) => [type, type === 'slippage' ? 0.1 : 0.2]));
  const feeSheet = buildFeeSheet({ fees, now });
  check('all required fee categories are visible before authorization', feeSheet.ok && feeSheet.totalFee > 0 && feeSheet.unknownFees.length === 0);

  const missingGuardian = guardianDecision({ policy: created.policy, request, guardian: null, now });
  check('Guardian cannot be disabled or omitted', !missingGuardian.ok && missingGuardian.code === 'GUARDIAN_APPROVAL_REQUIRED');
  const guardian = { decision: 'approve', independent: true, evidence: ['guardian-check-12'] };
  const guardianOk = guardianDecision({ policy: created.policy, request, guardian, now });
  check('Guardian is independent and does not replace user confirmation', guardianOk.ok && guardianOk.approved && guardianOk.independent && guardianOk.replacesUserConfirmation === false);

  const screen = createAuthorizationScreen({ policy: created.policy, request, fees, guardian, now });
  check('authorization screen is a separate record', screen.ok && screen.screenShown && screen.userConfirmed === false && screen.executionAuthorized === false);
  const noConfirm = confirmAuthorization({ screen, confirmed: false, confirmationText: 'NO', now });
  check('screen display is not explicit user confirmation', !noConfirm.ok && noConfirm.code === 'EXPLICIT_USER_CONFIRMATION_REQUIRED');
  const confirmed = confirmAuthorization({ screen, confirmed: true, confirmationText: 'CONFIRM', now });
  check('explicit confirmation creates an authorization record but not a signature', confirmed.ok && confirmed.userConfirmed && confirmed.adapterRequired && confirmed.executionAuthorized === false);
  const noRuntime = authorizeFinancialExecution({ screen, authorization: confirmed, controls: createControls(now), now });
  check('authorization without provider/runtime evidence is unavailable', !noRuntime.ok && noRuntime.code === 'RUNTIME_EVIDENCE_UNAVAILABLE');
  const runtimeEvidence = { providerId: 'provider-12', health: 'healthy', attested: true, checkedAt: now, expiresAt: now + 60000 };
  const authorized = authorizeFinancialExecution({ screen, authorization: confirmed, runtimeEvidence, controls: createControls(now), now });
  check('full authorization still declares adapter required', authorized.ok && authorized.executionAuthorized && authorized.financialExecutionAuthorized && authorized.executionRequiresAdapter);

  const stopped = applySmartWalletControl(createControls(now), 'STOP', now);
  const blockedAfterStop = authorizeFinancialExecution({ screen, authorization: confirmed, runtimeEvidence, controls: stopped.controls, now });
  check('STOP is non-bypassable', stopped.ok && !blockedAfterStop.ok && blockedAfterStop.code === 'STOP_ACTIVE');
  const emergency = applySmartWalletControl(stopped.controls, 'EMERGENCY_EXIT', now);
  check('EMERGENCY_EXIT revokes and pauses the scope', emergency.ok && emergency.controls.emergency_exit && emergency.controls.revoked && emergency.controls.paused);

  check('policy and fee objects contain no raw credential material', !/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ created, screen, confirmed, authorized })));
  console.log(JSON.stringify({ probe: 'phase12-smart-wallet-policy', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase12-smart-wallet-policy', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
