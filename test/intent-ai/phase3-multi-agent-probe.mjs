export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const strat = await import('../../src/lib/intent-ai/strategyAgent.js');
  const perm = await import('../../src/lib/intent-ai/permissions.js');
  const dir = await import('../../src/lib/intent-ai/agentDirectory.js');
  const ma = await import('../../src/lib/intent-ai/multiAgentOrchestrator.js');
  const social = await import('../../src/lib/intent-ai/socialProtocol.js');
  const ct = await import('../../src/lib/intent-ai/capabilityToken.js');

  // Start from a clean directory + token store (probes share one process).
  dir._resetAgentDirectory();
  ct._resetCapabilityTokenStore();

  // Directory of one verified external specialist.
  dir.registerAgent({
    id: 'ext-spec', name: 'Hedging Specialist', securityStatus: 'verified',
    supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['quote', 'research', 'analyze'], maxLeverage: 1
  });

  const intent = {
    action: 'swap', fromSymbol: 'USDC', toSymbol: 'ETH', chainId: 42161,
    direction: 'buy', goalPct: 10, durationHrs: 4, kind: 'goal', raw: 'swap usdc to eth target 10%'
  };
  const out = strat.formulateStrategies(intent, { prices: [], targetChainId: 42161, externalAgents: [{ id: 'ext-spec' }] });
  const pol = perm.sanitizePolicy({
    maxCapitalUsd: 5000, maxTransactionUsd: 1000, maxLossUsd: 200,
    allowedChains: [42161], allowedProtocols: ['swap']
  }, 3).policy;

  // Base coordination, no external agent.
  const res = ma.coordinateMultiAgent({
    strategyOutput: out, policy: pol,
    ctx: { selectedProposalId: out.proposals[0].id, amountUsd: 100, slippagePct: 0.5 }
  });
  t('base coordination ok', res.ok);
  t('plan present', !!res.plan);
  t('handshake is social, never a command',
    res.handshake.length > 0 && res.handshake.every((m) => m.isCommand === false && m.isExecutable === false && m.isSocial === true));

  // With an external specialist — capability token + session-key scoped.
  const extRes = ma.coordinateMultiAgent({
    strategyOutput: out, policy: pol,
    ctx: { selectedProposalId: out.proposals[0].id, amountUsd: 100, slippagePct: 0.5 },
    external: { agentId: 'ext-spec', capabilities: ['quote', 'research'], chainId: 42161, protocol: 'swap', amountUsd: 100 }
  });
  t('external coordination ok', extRes.ok);
  t('external specialist bound', !!extRes.external && extRes.external.agentId === 'ext-spec');
  t('capability token issued', !!extRes.capabilityToken);
  t('token is advice-only bounded', extRes.external.adviceOnly === true);
  t('token never carries forbidden capability', extRes.tokenForbidden.length === 0);

  // Handshake message factory from socialProtocol is never a command.
  const hs = social.socialMessage('fbt.strategy', 'fbt.exec', 'greeting', { note: 'hi' });
  t('social message is non-executable', hs.isCommand === false && hs.isExecutable === false);

  // Missing policy fails closed.
  const noPol = ma.coordinateMultiAgent({ strategyOutput: out });
  t('no policy fails closed', noPol.ok === false);

  // Emergency stop revokes keys + tokens for the policy.
  const halt = ma.emergencyStopAllForPolicy(pol.id || 'missing-policy');
  t('emergency stop returns revocation count', halt.ok === true && typeof halt.revokedTokens === 'number');

  return rows;
}
