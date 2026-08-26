export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const dir = await import('../../src/lib/intent-ai/agentDirectory.js');

  // Start from a clean directory (probes share one process).
  dir._resetAgentDirectory();

  // Register a verified external agent.
  const v = dir.registerAgent({
    id: 'ext-verified', name: 'Verified', securityStatus: 'verified',
    supportedChains: [42161], supportedProtocols: ['swap'],
    capabilities: ['quote', 'research'], maxLeverage: 1
  });
  t('verified agent registers', v.ok);

  // Register an unverified agent — it may be listed but never executed.
  const u = dir.registerAgent({
    id: 'ext-unverified', securityStatus: 'unverified',
    supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['execute']
  });
  t('unverified agent registers (listing only)', u.ok);

  // An agent carrying a forbidden credential is refused outright.
  const f = dir.registerAgent({ id: 'ext-bad', securityStatus: 'verified', privateKey: 'secret' });
  t('agent with forbidden key refused', f.ok === false);

  t('listing is self-reported, not authority', dir.DIRECTORY_IS_SELF_REPORTED === true);

  // matchAgent only returns verified agents.
  const m = dir.matchAgent({ chainId: 42161, protocol: 'swap' });
  t('verified agent matched for execution', m.ok && m.agent.id === 'ext-verified');

  const mBad = dir.matchAgent({ chainId: 56, protocol: 'swap' });
  t('no verified match on unsupported chain', mBad.ok === false);

  // isVerified gate.
  t('verified agent passes isVerified', dir.isVerified(dir.getAgent('ext-verified')) === true);
  t('unverified agent fails isVerified', dir.isVerified(dir.getAgent('ext-unverified')) === false);

  // assertAgentForExecute is fail-closed.
  t('verified agent passes execute gate', dir.assertAgentForExecute(dir.getAgent('ext-verified'), { chainId: 42161 }).ok);
  t('unverified agent refused for execute', dir.assertAgentForExecute(dir.getAgent('ext-unverified')).ok === false);
  t('unknown agent refused for execute', dir.assertAgentForExecute(null).ok === false);

  // A certificate that is not active blocks execution.
  const cert = dir.registerAgent({
    id: 'ext-cert', securityStatus: 'verified', certificate: { status: 'expired' },
    supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['quote']
  });
  t('expired-certificate agent registers', cert.ok);
  t('expired-certificate agent not verified', dir.isVerified(dir.getAgent('ext-cert')) === false);

  // Internal agents are registered verified by construction.
  dir.registerInternalAgent({ id: 'fbt.exec', role: 'orchestrator' });
  t('internal agent registers verified', dir.isVerified(dir.getAgent('fbt.exec')) === true);

  return rows;
}
