export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const dir = await import('../../src/lib/intent-ai/agentDirectory.js');
  const market = await import('../../src/lib/intent-ai/specialistMarket.js');

  dir._resetAgentDirectory();

  // Two specialists: one verified, one unverified.
  dir.registerAgent({ id: 'spec-a', name: 'Specialist A', securityStatus: 'verified', supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['quote', 'research'] });
  dir.registerAgent({ id: 'spec-b', name: 'Specialist B', securityStatus: 'unverified', supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['execute'] });

  const list = market.listSpecialists(dir.listAgents());
  t('market only lists verified specialists', list.length === 1 && list[0].id === 'spec-a');

  // Quote is advice-only, never execution.
  const q = market.quote(dir.getAgent('spec-a'), { chainId: 42161, protocol: 'swap', amountUsd: 100 });
  t('quote is advice-only', q.ok && q.adviceOnly === true && q.quote.status === 'advice-only');
  t('quote carries honest disclaimer', q.quote.disclaimer === 'NOT_GUARANTEED');

  // Unverified specialist cannot quote.
  const qBad = market.quote(dir.getAgent('spec-b'), { chainId: 42161, protocol: 'swap' });
  t('unverified specialist cannot quote', qBad.ok === false);

  // Forbidden op in a quote is refused.
  const qWithdraw = market.quote(dir.getAgent('spec-a'), { op: 'withdraw' });
  t('withdraw quote refused', qWithdraw.ok === false);

  // Hire requires ALL gates.
  const hire = market.hire;
  const gates = {
    specialist: dir.getAgent('spec-a'),
    request: { chainId: 42161, protocol: 'swap', amountUsd: 100 },
    userConfirmed: true,
    guardianApproved: { approved: true },
    capabilityTokenScoped: { ok: true },
    sessionKeyScoped: { ok: true }
  };
  const ok = market.hire(gates);
  t('hire succeeds with all gates', ok.ok && ok.agreement.gates.userConfirmed && ok.agreement.gates.guardianApproved);
  t('hire is advice-only, never automatic', ok.adviceOnly === true && ok.automaticExecution === false);
  t('hire has honest disclaimer', ok.agreement.disclaimer === 'NOT_GUARANTEED');

  // Missing any gate → refusal (fail-closed).
  t('no user confirm refuses', market.hire({ ...gates, userConfirmed: false }).ok === false);
  t('no guardian approval refuses', market.hire({ ...gates, guardianApproved: { approved: false } }).ok === false);
  t('no capability token refuses', market.hire({ ...gates, capabilityTokenScoped: { ok: false } }).ok === false);
  t('no session key refuses', market.hire({ ...gates, sessionKeyScoped: { ok: false } }).ok === false);
  t('unverified specialist hire refuses', market.hire({ ...gates, specialist: dir.getAgent('spec-b') }).ok === false);
  t('withdraw hire refuses', market.hire({ ...gates, request: { op: 'withdraw' } }).ok === false);

  return rows;
}
