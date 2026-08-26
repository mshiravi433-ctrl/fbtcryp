export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const exec = await import('../../src/lib/intent-ai/controlledExecution.js');
  const rec = await import('../../src/lib/intent-ai/reconciliation.js');
  const draft = await import('../../src/lib/intent-ai/draftOrder.js');
  const perm = await import('../../src/lib/intent-ai/permissions.js');
  const policyMod = await import('../../src/lib/intent-ai/policyModel.js');
  const { GUARDIAN_NON_DISABLEABLE } = await import('../../src/lib/intent-ai/guardian.js');

  t('Guardian cannot be disabled', GUARDIAN_NON_DISABLEABLE === true);

  const d = draft.createDraftOrder({
    kind: 'swap', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH',
    amountIn: 100, amountUsd: 100, slippagePct: 0.4, protocol: 'swap'
  }).order;

  const l1 = perm.sanitizePolicy({}, 1).policy;
  const blocked = exec.prepareExecution({ draftOrder: d, policy: l1, riskInput: { tokenRisk: { level: 'low' }, priceImpactPct: 0, slippagePct: 0.4 } });
  t('no execution without L3 / guardian', blocked.ok === false);

  const created = policyMod.createPolicy({
    level: 3, maxCapitalUsd: 5000, maxTransactionUsd: 1000, maxLossUsd: 200,
    allowedChains: [42161], allowedProtocols: ['swap'], allowedAssets: ['USDC', 'ETH']
  });
  const pol = policyMod.confirmPolicy(created.policy);
  const prep = exec.prepareExecution({
    draftOrder: d,
    policy: pol,
    riskInput: { tokenRisk: { level: 'low' }, walletRisk: { level: 'low' }, simulation: { status: 'simulated-clean' }, priceImpactPct: 0.1, slippagePct: 0.4, acknowledgedHigh: true }
  });
  t('prepare opens gate', prep.ok && prep.gate);

  const noConfirm = exec.confirmAndSubmit({ prepared: { ...prep, gate: { ...prep.gate, confirmed: false, status: 'AWAITING_USER' } }, action: 'CONFIRM', policy: pol, currentTerms: prep.gate.lockedTerms });
  // CONFIRM action will confirm - use REJECT to prove no submit
  const rejected = exec.confirmAndSubmit({ prepared: prep, action: 'REJECT', policy: pol, currentTerms: prep.gate.lockedTerms });
  t('reject does not submit', rejected.ok === false);

  const fake = rec.reconcile({ observation: { successClaim: true, confirmed: false } });
  t('fabricated success refused', fake.ok === false && fake.receipt.fabricated === false && fake.receipt.status !== 'COMPLETED');

  const changed = exec.confirmAndSubmit({
    prepared: prep,
    action: 'CONFIRM',
    policy: pol,
    currentTerms: { ...prep.gate.lockedTerms, amountIn: 9999 }
  });
  t('material change requires reauth', changed.reauthoriseRequired === true);

  const stopPol = { ...pol, emergencyStop: true };
  const halted = exec.prepareExecution({ draftOrder: d, policy: stopPol });
  t('emergency stop blocks prepare', halted.ok === false && halted.error.code === 'EMERGENCY_STOP');
  return rows;
}
