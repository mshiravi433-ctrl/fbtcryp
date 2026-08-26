export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const scoreMod = await import('../../src/lib/intent-ai/agentScore.js');
  const market = await import('../../src/lib/intent-ai/specialistMarket.js');
  const collab = await import('../../src/lib/intent-ai/collaborationSession.js');
  const dir = await import('../../src/lib/intent-ai/agentDirectory.js');

  dir._resetAgentDirectory();
  dir.registerAgent({ id: 'spec-v', name: 'Verified', securityStatus: 'verified', supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['quote'] });
  dir.registerAgent({ id: 'spec-u', name: 'Unverified', securityStatus: 'unverified', supportedChains: [42161], supportedProtocols: ['swap'], capabilities: ['execute'] });

  // Insufficient score does not equal execution.
  const thin = scoreMod.observedScore([{ outcome: 'success', confirmed: true }, { outcome: 'failure' }]);
  t('insufficient score is NOT execution-ready', thin.status === 'insufficient_data' && thin.successRate === null);

  // hire without gate → refused.
  const noGate = market.hire({ specialist: dir.getAgent('spec-v'), guardianApproved: { approved: true } });
  t('hire without confirmation gate refused', noGate.ok === false);

  // Unverified specialist cannot be hired even with gates.
  const unvetted = market.hire({
    specialist: dir.getAgent('spec-u'),
    userConfirmed: true,
    guardianApproved: { approved: true },
    capabilityTokenScoped: { ok: true },
    sessionKeyScoped: { ok: true }
  });
  t('unverified specialist hire refused', unvetted.ok === false);

  // Collaboration session: social messages are never commands/executable.
  const sess = collab.createCollaborationSession({
    agents: dir.listAgents(),
    agentIds: ['spec-v'],
    policy: { id: 'p1' },
    sessionKeyScoped: { ok: true, scopedHandle: 'h' }
  });
  t('collab session created', sess.ok);
  const ready = collab.createCollaborationSession({
    agents: dir.listAgents(), agentIds: ['spec-u'], policy: { id: 'p1' },
    sessionKeyScoped: { ok: true }
  });
  t('collab session refuses non-participant / unverified', ready.ok === false);

  const turn = collab.collaborationTurn(sess.session, 'spec-v', 'greeting', { note: 'hello' });
  t('social turn accepted', turn.ok);
  t('social message is never a command', turn.message.isCommand === false && turn.message.isExecutable === false);

  // A message trying to smuggle a command is refused.
  const smuggle = collab.collaborationTurn(sess.session, 'spec-v', 'acknowledge', { execute: 'now' });
  t('command-smuggling message refused', smuggle.ok === false);

  // A non-participant cannot speak.
  const stranger = collab.collaborationTurn(sess.session, 'someone-else', 'greeting', { note: 'hi' });
  t('non-participant message refused', stranger.ok === false);

  // isExecutableMessage flags command-like content.
  t('executable message detected', collab.isExecutableMessage({ isCommand: true }) === true);
  t('plain social message not executable', collab.isExecutableMessage({ isCommand: false, isExecutable: false }) === false);

  return rows;
}
