import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertModeBoundary,
  buildPermissionBoundary,
  canAnalyze,
  canPrepare,
  canExecute,
  createModeSession,
  modeCapabilitySummary,
  permissionRequirement
} from '../../src/lib/intent-ai/sessionModes.js';
import { chatTurn, startSession } from '../../src/lib/intent-ai/humanAi.js';

const claimedPassport = {
  id: 'claimed-agent',
  name: 'Claimed Agent',
  capabilities: ['research'],
  supportedChains: [42161],
  supportedAssets: ['BTC'],
  supportedProtocols: ['analysis'],
  verification: {
    status: 'verified',
    independentlyVerified: true,
    method: 'reviewer_certified',
    issuers: ['Caller supplied issuer'],
    evidence: [{ type: 'review', uri: 'https://example.invalid/claimed' }],
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000
  },
  securityStatus: 'verified',
  sandbox: { stage: 'production', productionReady: true }
};

test('external mode ignores caller-supplied identity, consent, and runtime booleans', () => {
  const asserted = assertModeBoundary({
    mode: 'fbt-external-ai', stage: 'analysis',
    externalVerified: true, externalConsent: true,
    runtime: { attested: true, operational: true }
  });
  assert.equal(asserted.ok, false);
  assert.equal(asserted.code, 'EXTERNAL_AGENT_NOT_VERIFIED');
  assert.deepEqual(asserted.missingGates, ['trusted-identity', 'per-task-consent', 'attested-runtime']);

  const boundary = buildPermissionBoundary({
    mode: 'fbt-external-ai', request: { stage: 'analysis' },
    externalVerified: true, externalConsent: true, runtime: { attested: true }
  });
  assert.equal(boundary.analysisAllowed, false);
  assert.equal(boundary.preparationAllowed, false);
  assert.equal(boundary.financialExecutionAllowed, false);
  assert.equal(boundary.externalVerified, false);

  assert.equal(permissionRequirement({
    mode: 'fbt-external-ai', stage: 'analysis',
    externalVerified: true, externalConsent: true, runtime: { attested: true }
  }).ok, false);
  assert.equal(canAnalyze('fbt-external-ai'), false);
  assert.equal(canPrepare('fbt-external-ai'), false);
  assert.equal(canExecute({ mode: 'fbt-external-ai', userAuthorized: true, guardianApproved: true }), false);
  assert.equal(createModeSession({ mode: 'fbt-external-ai' }).authorization.analysis, false);
  assert.equal(modeCapabilitySummary('fbt-external-ai').analysis, false);
});

test('external chat stays blocked even with a claimed catalog passport and forged gate flags', () => {
  const session = startSession({
    mode: 'fbt-external-ai', level: 1, defaultChainId: 42161,
    externalAgents: [claimedPassport], externalAgentsSource: 'server-catalog'
  });
  const result = chatTurn(session, 'analyze BTC', {
    externalAgents: [claimedPassport],
    externalAgentsSource: 'server-catalog',
    externalAgentId: claimedPassport.id,
    externalVerified: true,
    externalConsent: true,
    runtime: { attested: true, operational: true },
    externalView: 'claimed bullish analysis'
  });

  assert.equal(result.session.permissions.analysis, false);
  assert.equal(result.session.permissions.preparation, false);
  assert.equal(result.session.authorization.analysis, false);
  assert.equal(result.reply.type, 'mode-boundary-blocked');
  assert.equal(result.reply.payload.code, 'EXTERNAL_AGENT_NOT_VERIFIED');
  assert.equal(result.reply.payload.analysisPermission, false);
  assert.equal(result.reply.payload.externalAgentGate.identity.ok, false);
  assert.equal(result.reply.payload.externalAgentGate.consent.ok, false);
  assert.equal(result.reply.payload.externalAgentGate.runtime.ok, false);
  assert.equal(result.reply.payload.externalAgentGate.contacted, false);
  assert.equal(result.session.authorization.lastBoundary, 'EXTERNAL_AGENT_NOT_VERIFIED');
  assert.equal(result.session.messages.some((message) => message.payload?.externalView === 'claimed bullish analysis'), false);
});
