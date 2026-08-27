/**
 * FBT Intent AI — Phase 8 activation and Secret Manager boundary probe.
 *
 * The public activation report must distinguish implementation from operational
 * proof, and the secret boundary must never persist or publish raw material.
 */

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  const activation = await import('../../server/intentActivation.js');
  const secrets = await import('../../server/intentSecretManager.js');

  const report = activation.activationReport({
    now: Date.UTC(2026, 7, 26),
    env: {
      INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS: '',
      INTENT_COORDINATOR_ROTATIONS: '',
      INTENT_MERKLE_ANCHOR_NETWORKS: '',
      INTENT_WORKFLOW_BATCH_ADDRESS: ''
    }
  });

  t('activation report has the versioned schema', report.schema === 'fbt.intent-ai-activation.v1');
  t('original phases 1-7 are complete', report.product.originalRoadmapComplete === true
    && report.product.numberedPhasesRemaining === 0
    && report.product.completedPhases.length === 7);
  t('phase 8 is implementation-complete but operationally honest', report.phase8.implementation === 'implemented'
    && report.phase8.operational === 'partial');
  t('the reviewed specification is live while the historical Secret Manager remains isolated', report.phase8.secretManager.operational === false
    && report.product.launchAllowed === true
    && report.blockers.length === 0);
  t('future phases 9-20 are not falsely marked done', report.roadmap.length === 13
    && report.roadmap[0].phase === 8
    && report.roadmap.at(-1).phase === 20
    && report.roadmap.slice(1).every((row) => row.status === 'roadmap'));
  t('report exposes no secret values', !JSON.stringify(report).includes('server-only-secret')
    && !JSON.stringify(report).includes('0x' + 'a'.repeat(64)));
  t('security boundary is fail-closed', report.securityBoundary.failClosed === true
    && report.securityBoundary.rawCredentialsToAgents === false
    && report.securityBoundary.rawCredentialsToClient === false);

  const unavailable = secrets.unavailableSecretManager();
  const unavailableStatus = unavailable.status();
  t('default Secret Manager is unavailable, never fake-operational', unavailableStatus.operational === false
    && unavailableStatus.status === 'unavailable'
    && unavailableStatus.secretsExposed === false
    && unavailableStatus.rawSecretsPersisted === false);
  t('default manager rejects binding', unavailable.bind({
    handle: 'fbt_secret_1234567890abcdef',
    policyId: 'policy-1',
    agentId: 'agent-1',
    capabilities: ['quote'],
    allowedChains: [42161],
    allowedProtocols: ['swap'],
    expiresAt: Date.now() + 60_000,
    purpose: 'quote'
  }).code === 'REAL_SECRET_MANAGER_REQUIRED');

  const calls = [];
  const provider = {
    name: 'test-attested-provider',
    health: () => ({ ok: true, durable: true, attested: true }),
    resolve: async (handle, context) => {
      calls.push({ handle, context });
      return { ok: true, value: 'server-only-secret' };
    },
    revoke: async () => {}
  };
  let now = Date.now();
  const manager = secrets.createSecretManager({ provider, now: () => now, maxHandles: 2 });
  const metadata = {
    handle: 'fbt_secret_1234567890abcdef',
    policyId: 'policy-1',
    agentId: 'agent-1',
    capabilities: ['quote'],
    allowedChains: [42161],
    allowedProtocols: ['swap'],
    expiresAt: now + 60_000,
    purpose: 'quote'
  };
  const bound = manager.bind(metadata);
  t('an attested provider can bind opaque metadata', bound.ok === true
    && bound.record.handle === metadata.handle
    && !secrets.containsSecretMaterial(bound.record));
  t('metadata list never includes a raw secret', !JSON.stringify(manager.listHandles()).includes('server-only-secret'));

  const used = await manager.withSecretHandle(metadata.handle, {
    policyId: 'policy-1',
    agentId: 'agent-1',
    capability: 'quote'
  }, async (value) => value === 'server-only-secret');
  t('a secret is available only inside the internal consumer', used.ok === true && used.result === true);
  t('provider receives only scoped context', calls.length === 1
    && calls[0].context.policyId === 'policy-1'
    && calls[0].context.agentId === 'agent-1'
    && calls[0].context.capability === 'quote'
    && !Object.values(calls[0].context).includes('server-only-secret'));
  t('public status still contains no secret', !JSON.stringify(manager.status()).includes('server-only-secret'));

  t('wrong policy is rejected', (await manager.withSecretHandle(metadata.handle, { policyId: 'other' }, () => true)).code === 'POLICY_SCOPE_MISMATCH');
  t('wrong capability is rejected', (await manager.withSecretHandle(metadata.handle, { capability: 'execute' }, () => true)).code === 'CAPABILITY_SCOPE_MISMATCH');
  t('raw secret metadata is rejected', manager.bind({
    ...metadata,
    handle: 'fbt_secret_abcdef1234567890',
    privateKey: '0x' + 'a'.repeat(64)
  }).code === 'SECRET_MATERIAL_IN_METADATA');
  t('unknown metadata fields are rejected', manager.bind({
    ...metadata,
    handle: 'fbt_secret_abcdef1234567890',
    debug: 'anything'
  }).code === 'UNSAFE_HANDLE_METADATA');

  const secondHandle = 'fbt_secret_abcdef1234567890';
  const secondBound = manager.bind({ ...metadata, handle: secondHandle, expiresAt: now + 60_000 });
  t('a second handle can be independently bound', secondBound.ok === true);
  t('revocation removes a bound handle', (await manager.revoke(secondHandle)).ok === true
    && !manager.listHandles().some((row) => row.handle === secondHandle));

  now += 61_000;
  t('expired handle fails closed', (await manager.withSecretHandle(metadata.handle, {}, () => true)).code === 'SECRET_HANDLE_EXPIRED');

  const injected = activation.activationReport({
    now: Date.UTC(2026, 7, 26),
    env: {},
    secretManagerStatus: {
      provider: 'attested-kms',
      configured: true,
      operational: true,
      durable: true,
      attested: true,
      keyRefPresent: true
    }
  });
  t('only an explicitly injected, fully attested provider becomes operational', injected.phase8.operational === 'ready'
    && injected.phase8.secretManager.operational === true
    && injected.phase8.secretManager.secretsExposed === false);

  return rows;
}
