export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const ct = await import('../../src/lib/intent-ai/capabilityToken.js');
  const dir = await import('../../src/lib/intent-ai/agentDirectory.js');
  const strat = await import('../../src/lib/intent-ai/strategyAgent.js');
  const perm = await import('../../src/lib/intent-ai/permissions.js');
  const ma = await import('../../src/lib/intent-ai/multiAgentOrchestrator.js');
  const guardianMod = await import('../../src/lib/intent-ai/guardian.js');

  // Reset shared module registries so this probe is independent of its siblings.
  dir._resetAgentDirectory();
  ct._resetCapabilityTokenStore();

  t('Guardian is always on', guardianMod.GUARDIAN_NON_DISABLEABLE === true);

  // A token never grants withdraw / bypass / fabricate-receipt, even if asked.
  const tok = ct.issueCapabilityToken({
    policyId: 'p', agentId: 'a',
    capabilities: ['withdrawFunds', 'executeWithoutUser', 'bypassGuardian', 'holdRawCredential', 'fabricateReceipt'],
    allowedChains: [42161], allowedProtocols: ['swap']
  });
  t('all-forbidden capability request yields no grantable cap', tok.ok === false);

  // Revoked-token access is refused even before expiry.
  const t2 = ct.issueCapabilityToken({ policyId: 'p2', agentId: 'a2', capabilities: ['quote'], allowedChains: [42161], allowedProtocols: ['swap'], now: 1 });
  ct.revokeCapabilityToken(t2.token);
  t('revoked token refuses even in time', !ct.scopeCapabilityToken(t2.token, { chainId: 42161, protocol: 'swap', amountUsd: 10 }, { now: 100 }).ok);

  // An unverified agent can never be matched on the execution path.
  dir.registerAgent({ id: 'u-agent', securityStatus: 'unverified', supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['execute'] });
  const m = dir.matchAgent({ chainId: 42161, protocol: 'swap' });
  t('unverified-only directory has no match', m.ok === false);

  // A missing/invalid external specialist replans honestly or refuses — never bypasses Guardian.
  dir.registerAgent({ id: 'v-agent', name: 'Verified', securityStatus: 'verified', supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['quote', 'research'], maxLeverage: 1 });

  const intent = { action: 'swap', fromSymbol: 'USDC', toSymbol: 'ETH', chainId: 42161, direction: 'buy', goalPct: 8, durationHrs: 4, kind: 'goal', raw: 'swap usdc to eth' };
  const out = strat.formulateStrategies(intent, { prices: [], targetChainId: 42161, externalAgents: [{ id: 'v-agent' }] });
  const pol = perm.sanitizePolicy({ maxCapitalUsd: 5000, maxTransactionUsd: 1000, maxLossUsd: 200, allowedChains: [42161], allowedProtocols: ['swap'] }, 3).policy;

  // Requesting an UNKNOWN specialist: it must NEVER route through it. It either
  // replans without a specialist (honest fallback) or refuses — never bypasses Guardian.
  const unknown = ma.coordinateMultiAgent({
    strategyOutput: out, policy: pol,
    ctx: { selectedProposalId: out.proposals[0].id, amountUsd: 100 },
    external: { agentId: 'nonexistent', capabilities: ['quote'], chainId: 42161, protocol: 'swap' }
  });
  t('unknown specialist never executes through it',
    (unknown.replanned === true && unknown.external?.skipped === true && unknown.external?.reason === 'AGENT_NOT_FOUND')
    || (unknown.ok === false && unknown.reason?.includes('EXTERNAL_AGENT_NOT_VERIFIED')));

  // A verified specialist is advice-only and still requires confirmation.
  const verified = ma.coordinateMultiAgent({
    strategyOutput: out, policy: pol,
    ctx: { selectedProposalId: out.proposals[0].id, amountUsd: 100 },
    external: { agentId: 'v-agent', capabilities: ['quote'], chainId: 42161, protocol: 'swap' }
  });
  t('verified specialist advice-only + requires confirmation', verified.ok && verified.requiresConfirmation === true && verified.external.adviceOnly === true);

  // Over-cap external request refuses at token scope.
  const overCap = ma.coordinateMultiAgent({
    strategyOutput: out, policy: pol,
    ctx: { selectedProposalId: out.proposals[0].id, amountUsd: 50000 },
    external: { agentId: 'v-agent', capabilities: ['quote'], chainId: 42161, protocol: 'swap', amountUsd: 50000 }
  });
  t('over-cap external request refuses', overCap.ok === false);

  return rows;
}
