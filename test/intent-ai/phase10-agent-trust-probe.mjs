/* Phase 10 — External Agent trust-plane probe.
 *
 * This is deliberately a fail-closed probe, not a mock "green" integration:
 * it exercises the public contracts for discovery, independent verification,
 * sandbox sequencing, non-executable handshake/reputation, scoped issuance,
 * expiry and revocation. No external provider or live certificate authority
 * is assumed by this file.
 */
import assert from 'node:assert/strict';
import {
  EXTERNAL_AGENT_PASSPORT_SCHEMA,
  EXTERNAL_AGENT_DISCOVERY_SCHEMA,
  EXTERNAL_AGENT_SECURITY_SCHEMA,
  EXTERNAL_AGENT_SANDBOX_SCHEMA,
  EXTERNAL_AGENT_HANDSHAKE_SCHEMA,
  EXTERNAL_AGENT_REPUTATION_SCHEMA,
  EXTERNAL_AGENT_SCOPE_SCHEMA,
  EXTERNAL_AGENT_SANDBOX_STAGES,
  EXTERNAL_AGENT_REPUTATION_CATEGORIES,
  EXTERNAL_AGENT_REQUIRED_PERMISSIONS,
  sanitizeExternalAgentPassport,
  passportFromCatalog,
  evaluateExternalAgentSecurity,
  discoverExternalAgents,
  createExternalAgentSandbox,
  advanceExternalAgentSandbox,
  createExternalAgentHandshake,
  externalAgentHandshakeTurn,
  handshakeTranscript,
  buildExternalAgentReputation,
  createBidirectionalAgentRating,
  authorizeExternalAgentScope,
  revokeExternalAgentScope,
  startSession,
  chatTurn
} from '../../src/lib/intent-ai/index.js';
import { scopeCapabilityToken, tokenHasForbiddenKey } from '../../src/lib/intent-ai/capabilityToken.js';
import { scopeFor } from '../../src/lib/intent-ai/sessionKeys.js';

const results = [];
function check(name, condition) {
  const ok = Boolean(condition);
  results.push({ name, ok });
  if (!ok) throw new Error(`FAIL: ${name}`);
}

const now = 1_800_000_000_000;
const evidence = [{ type: 'security_review', uri: 'https://evidence.example/phase10/security' }];
const passportInput = {
  id: 'trusted-agent-10',
  name: 'Trusted Agent Ten',
  creator: 'Independent Registry',
  capabilities: ['research', 'analyze', 'quote'],
  supportedChains: [42161],
  supportedAssets: ['USDC', 'ETH'],
  supportedProtocols: ['swap'],
  financialFunctions: ['research', 'quote', 'route'],
  fees: [
    { type: 'network', amount: 0, currency: 'USD' },
    { type: 'external', amount: 1, currency: 'USD' },
    { type: 'performance', amount: 0, currency: 'USD' }
  ],
  verification: {
    status: 'certified',
    method: 'reviewer_certified',
    issuers: ['Independent Security Review'],
    evidence,
    issuedAt: now - 60_000,
    expiresAt: now + 3_600_000
  },
  reputation: { status: 'insufficient_data' },
  maxCapitalUsd: 200,
  maxTransactionUsd: 100,
  expiresAt: now + 3_600_000,
  requiredPermissions: [...EXTERNAL_AGENT_REQUIRED_PERMISSIONS],
  sandbox: { stage: 'discovery' }
};

try {
  check('passport sanitizer emits the Phase 10 schema', sanitizeExternalAgentPassport(passportInput, { trustedVerification: true, now }).passport.schema === EXTERNAL_AGENT_PASSPORT_SCHEMA);

  const selfReported = sanitizeExternalAgentPassport({
    ...passportInput,
    verification: { ...passportInput.verification, method: 'self_reported' }
  }, { now });
  check('self-reported certification is not independent verification', selfReported.ok && selfReported.passport.securityStatus === 'unverified');

  const forbidden = sanitizeExternalAgentPassport({ ...passportInput, privateKey: '0x' + 'a'.repeat(64) }, { trustedVerification: true, now });
  check('raw private keys are rejected at the passport boundary', !forbidden.ok && forbidden.code === 'RAW_CREDENTIAL_FORBIDDEN');

  const trusted = passportFromCatalog(passportInput, { now });
  check('catalog trust is derived only through the trusted conversion path', trusted.ok && trusted.passport.securityStatus === 'verified' && trusted.passport.security.independentlyVerified === true);
  check('a reviewer certificate may be valid without an inline evidence link', passportFromCatalog({
    ...passportInput,
    verification: { ...passportInput.verification, evidence: [] }
  }, { now }).passport.securityStatus === 'verified');

  const intent = {
    id: 'intent-phase10',
    chainId: 42161,
    fromSymbol: 'USDC',
    protocol: 'swap',
    requiredCapabilities: ['research']
  };
  const discovery = discoverExternalAgents({
    agents: [passportInput],
    intent,
    source: 'server-catalog',
    trustedRegistry: true,
    now
  });
  check('discovery emits its own schema and live status only for supplied runtime data', discovery.schema === EXTERNAL_AGENT_DISCOVERY_SCHEMA && discovery.dataStatus === 'live');
  check('a compatible independently verified candidate is analysis-eligible but not executable', discovery.candidates[0]?.matches === true && discovery.candidates[0]?.eligibleForAnalysis === true && discovery.candidates[0]?.eligibleForExecution === false);
  check('discovery withholds reputation score for thin evidence', discovery.candidates[0]?.score === null && discovery.candidates[0]?.scoreStatus === 'insufficient_data');
  check('discovery requires explicit user choice and never auto-enables an agent', discovery.candidates[0]?.userChoiceRequired === true && discovery.candidates[0]?.automaticEnable === false && discovery.selectedAgentId === null);

  const untrustedDiscovery = discoverExternalAgents({ agents: [passportInput], intent, source: 'runtime-input', now });
  check('runtime self-description remains visible but blocked', untrustedDiscovery.candidates[0]?.trustStatus === 'unverified' && untrustedDiscovery.candidates[0]?.eligibleForAnalysis === false);
  const unavailable = discoverExternalAgents({ source: 'unavailable', agents: [], intent, now });
  check('unavailable registry is explicit rather than an invented empty success', unavailable.dataStatus === 'unavailable' && unavailable.candidates.length === 0);

  const externalSession = startSession({ mode: 'fbt-external-ai', level: 1, defaultChainId: 42161 });
  const externalTurn = chatTurn(externalSession, 'analyze 1 ETH to USDC on Arbitrum', {
    externalAgents: [passportInput],
    externalAgentsSource: 'server-catalog'
  });
  check('Human session admits only the runtime-discovered verified external candidate for analysis', externalTurn.reply?.type === 'analysis' && externalTurn.reply.payload.externalAgentDiscovery?.candidates?.[0]?.eligibleForAnalysis === true && externalTurn.reply.payload.financialExecutionAuthorized === false);

  const analysisSecurity = evaluateExternalAgentSecurity(trusted.passport, {
    stage: 'analysis',
    chainId: 42161,
    asset: 'USDC',
    protocol: 'swap',
    requiredCapabilities: ['research'],
    now
  });
  check('analysis security is evidence-backed and still not an execution grant', analysisSecurity.schema === EXTERNAL_AGENT_SECURITY_SCHEMA && analysisSecurity.analysisEligible === true && analysisSecurity.executionEligible === false);

  let sandbox = createExternalAgentSandbox(trusted.passport, { now }).sandbox;
  check('sandbox starts at discovery and is non-executable', sandbox.schema === EXTERNAL_AGENT_SANDBOX_SCHEMA && sandbox.stage === 'discovery' && sandbox.executionAllowed === false);
  check('sandbox cannot skip a required stage', !advanceExternalAgentSandbox(sandbox, {
    nextStage: 'simulation',
    evidence
  }).ok);
  check('sandbox cannot advance without evidence', !advanceExternalAgentSandbox(sandbox, { nextStage: 'identity', evidence: [] }).ok);
  const sandboxBeforeComplete = evaluateExternalAgentSecurity(trusted.passport, {
    stage: 'execution',
    chainId: 42161,
    asset: 'USDC',
    protocol: 'swap',
    amountUsd: 50,
    capitalUsd: 100,
    requiredCapabilities: ['research'],
    sandbox,
    userAuthorized: true,
    guardianApproved: true,
    now
  });
  check('execution remains blocked before sandbox completion', !sandboxBeforeComplete.executionEligible && sandboxBeforeComplete.failures.some((item) => item.code === 'SANDBOX_NOT_COMPLETE'));

  /* Progress through every stage with evidence and explicit operator approval.
     This is the only sandbox object used for the valid scope test below. */
  for (const stage of EXTERNAL_AGENT_SANDBOX_STAGES.slice(1)) {
    const advanced = advanceExternalAgentSandbox(sandbox, {
      nextStage: stage,
      evidence: [{ type: 'sandbox_test_run', uri: `https://evidence.example/phase10/${stage}` }],
      operatorApproved: stage === 'production',
      now: now + EXTERNAL_AGENT_SANDBOX_STAGES.indexOf(stage)
    });
    check(`sandbox advances in order to ${stage}`, advanced.ok);
    sandbox = advanced.sandbox;
  }
  check('sandbox production requires all stages, evidence and operator approval', sandbox.stage === 'production' && sandbox.productionReady === true && sandbox.operatorApproved === true && EXTERNAL_AGENT_SANDBOX_STAGES.every((stage) => sandbox.completedStages.includes(stage) && sandbox.evidence[stage]?.length));

  const handshake = createExternalAgentHandshake(trusted.passport, { intent, now });
  check('verified handshake is created as social evidence only', handshake.ok && handshake.handshake.schema === EXTERNAL_AGENT_HANDSHAKE_SCHEMA && handshake.handshake.executable === false && handshake.handshake.credentialsRequested === false);
  const handshakeTurn = externalAgentHandshakeTurn(handshake.handshake, 'trusted-agent-10', 'request-evidence', { request: 'show sandbox evidence' });
  check('handshake accepts evidence dialogue but keeps it non-executable', handshakeTurn.ok && handshakeTurn.handshake.executable === false && handshakeTurn.message.isExecutable === false);
  check('handshake rejects command-like or secret content', !externalAgentHandshakeTurn(handshake.handshake, 'trusted-agent-10', 'acknowledge', { command: 'execute transfer' }).ok && handshakeTranscript(handshakeTurn.handshake).every((message) => message.isExecutable === false));
  check('unverified agents cannot start a handshake', createExternalAgentHandshake(selfReported.passport, { intent, now }).code === 'AGENT_NOT_VERIFIED');

  const thinReputation = buildExternalAgentReputation([
    { agentId: passportInput.id, observed: true, confirmed: true, outcome: 'completed', security: 95 },
    { agentId: passportInput.id, observed: true, confirmed: true, outcome: 'failed', security: 90 }
  ], { now });
  check('thin reputation publishes no score', thinReputation.schema === EXTERNAL_AGENT_REPUTATION_SCHEMA && thinReputation.agents[passportInput.id].status === 'insufficient_data' && thinReputation.agents[passportInput.id].successRate === null && thinReputation.agents[passportInput.id].sampleSize === null);
  const richSamples = [
    ...Array.from({ length: 5 }, (_, index) => ({ agentId: passportInput.id, observed: true, confirmed: true, outcome: 'completed', reliability: 80 + index })),
    ...Array.from({ length: 2 }, () => ({ agentId: passportInput.id, observed: true, confirmed: true, outcome: 'failed', reliability: 40 })),
    { agentId: passportInput.id, observed: true, confirmed: true, outcome: 'cancelled', reliability: 60 }
  ];
  const richReputation = buildExternalAgentReputation(richSamples, { now });
  check('observed reputation appears only after enough decided samples', richReputation.agents[passportInput.id].status === 'observed' && richReputation.agents[passportInput.id].sampleSize === 7 && richReputation.agents[passportInput.id].successRate === 0.7143);
  check('all reputation categories are bounded and evidence-derived', Object.keys(richReputation.agents[passportInput.id].categories || {}).every((category) => EXTERNAL_AGENT_REPUTATION_CATEGORIES.includes(category)));
  check('address-shaped identifiers are not scored or published', Object.keys(buildExternalAgentReputation([
    ...Array.from({ length: 5 }, () => ({ agentId: '0x' + 'a'.repeat(40), observed: true, confirmed: true, outcome: 'completed' }))
  ], { now }).agents).length === 0);

  check('ratings cannot be created before a completed session', createBidirectionalAgentRating({ fromAgent: 'fbt-ai', toAgent: passportInput.id, ratings: {}, sessionCompleted: false }).code === 'SESSION_NOT_COMPLETED');
  const rating = createBidirectionalAgentRating({
    fromAgent: 'fbt-ai',
    toAgent: passportInput.id,
    sessionCompleted: true,
    ratings: Object.fromEntries(EXTERNAL_AGENT_REPUTATION_CATEGORIES.map((category) => [category, 80])),
    evidence
  });
  check('bidirectional ratings are audit records, not permission changes', rating.ok && rating.rating.observed === false && rating.rating.trustChanged === false && rating.rating.executionPermissionChanged === false);

  const blockedScope = authorizeExternalAgentScope({
    passport: trusted.passport,
    intent: { ...intent, amountUsd: 50, capitalUsd: 100 },
    policy: { id: 'policy-phase10', allowedChains: [42161], allowedProtocols: ['swap'], maxTransactionUsd: 100, expiresAt: now + 3_600_000 },
    sandbox,
    userAuthorized: false,
    guardianApproved: false,
    now
  });
  check('scope issuance fails closed without both user and Guardian approval', !blockedScope.ok && blockedScope.code === 'USER_AUTHORIZATION_REQUIRED');
  const missingScope = authorizeExternalAgentScope({
    passport: trusted.passport,
    intent: { ...intent, amountUsd: 50, capitalUsd: 100 },
    policy: { id: 'policy-phase10', allowedChains: [], allowedProtocols: [], maxTransactionUsd: 100, expiresAt: now + 3_600_000 },
    sandbox,
    userAuthorized: true,
    guardianApproved: true,
    now
  });
  check('scope authorization requires non-empty chain and protocol scopes', !missingScope.ok && missingScope.code === 'CHAIN_SCOPE_REQUIRED');
  const unknownFee = authorizeExternalAgentScope({
    passport: trusted.passport,
    intent: { ...intent, amountUsd: 50, capitalUsd: 100 },
    policy: { id: 'policy-phase10', allowedChains: [42161], allowedProtocols: ['swap'], maxTransactionUsd: 100, feeLimitUsd: 5, expiresAt: now + 3_600_000 },
    sandbox,
    userAuthorized: true,
    guardianApproved: true,
    now
  });
  check('fee limit fails closed when the fee is not known', !unknownFee.ok && unknownFee.code === 'FEE_LIMIT_UNKNOWN');

  const authorized = authorizeExternalAgentScope({
    passport: trusted.passport,
    intent: { ...intent, amountUsd: 50, capitalUsd: 100 },
    policy: { id: 'policy-phase10', allowedChains: [42161], allowedProtocols: ['swap'], maxTransactionUsd: 100, expiresAt: now + 3_600_000 },
    sandbox,
    userAuthorized: true,
    guardianApproved: true,
    now
  });
  check('scope issuance requires all seven bounded permissions and returns opaque handles', authorized.ok && authorized.schema === EXTERNAL_AGENT_SCOPE_SCHEMA && authorized.smartWallet === true && authorized.handlesOnly === true && authorized.capabilityToken.handle && authorized.sessionKey.handle);
  check('scope output contains no raw credentials', authorized.rawCredentialsAllowed === false && !tokenHasForbiddenKey(authorized) && !/private.?key|seed.?phrase|master.?password|raw.?secret/i.test(JSON.stringify(authorized)));
  check('capability token is bounded to the requested chain, protocol and amount', scopeCapabilityToken(authorized.capabilityToken, { chainId: 42161, protocol: 'swap', amountUsd: 50, capabilities: ['research'] }, { now }).ok && !scopeCapabilityToken(authorized.capabilityToken, { chainId: 1, protocol: 'swap', amountUsd: 50, capabilities: ['research'] }, { now }).ok);
  check('session key applies the same scope boundary', scopeFor(authorized.sessionKey, { chainId: 42161, protocol: 'swap', amountUsd: 50 }, { now }).ok && !scopeFor(authorized.sessionKey, { chainId: 1, protocol: 'swap', amountUsd: 50 }, { now }).ok);
  check('expired token is rejected', !scopeCapabilityToken(authorized.capabilityToken, { chainId: 42161, protocol: 'swap', amountUsd: 50 }, { now: authorized.expiresAt + 1 }).ok);

  const revoked = revokeExternalAgentScope(authorized);
  check('STOP/REVOKE immediately invalidates both issued handles', revoked.ok && !scopeCapabilityToken(authorized.capabilityToken, { chainId: 42161, protocol: 'swap', amountUsd: 1 }, { now }) .ok && !scopeFor(authorized.sessionKey, { chainId: 42161, protocol: 'swap', amountUsd: 1 }, { now }).ok);
  check('expired passport fails closed independently of scope state', evaluateExternalAgentSecurity({ ...trusted.passport, expiresAt: now - 1 }, { stage: 'analysis', now }).failures.some((item) => item.code === 'AGENT_PASSPORT_EXPIRED'));

  /* Real server route: this may be live only when an approved durable
     ecosystem registry is configured. Either way, the response must retain
     its explicit status and must never issue a handle. */
  const { default: app } = await import('../../server/app.js');
  const httpServer = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/intents/v1/external-agents`);
    const body = await response.json();
    check('server external discovery route exposes an honest status and read-only candidates', response.ok && body.schema === EXTERNAL_AGENT_DISCOVERY_SCHEMA && ['live', 'unavailable'].includes(body.dataStatus) && Array.isArray(body.candidates));
    check('server discovery never returns a capability token or session key', !/capabilityToken|sessionKey|privateKey|seedPhrase|masterPassword/i.test(JSON.stringify(body)));
    const openapi = await (await fetch(`http://127.0.0.1:${httpServer.address().port}/api/openapi.json`)).json();
    check('OpenAPI documents the read-only external discovery route', Boolean(openapi.paths?.['/intents/v1/external-agents']?.get));
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  console.log(JSON.stringify({ probe: 'phase10-agent-trust', passed: results.length, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase10-agent-trust', failed: true, completed: results, error: error.message }, null, 2));
  process.exitCode = 1;
}
