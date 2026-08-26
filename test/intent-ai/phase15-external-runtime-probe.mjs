/* Phase 15 — external runtime, capability negotiation, scoped handles and revoke. */
import {
  createExternalAgentRuntime,
  validateExternalRuntimeRequest
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
let clock = now;
const passport = {
  schema: 'fbt.external-agent-passport.v1',
  id: 'external-15',
  securityStatus: 'verified',
  verification: { independentlyVerified: true },
  capabilities: ['quote', 'research'],
  supportedChains: [42161],
  supportedProtocols: ['swap'],
  maxTransactionUsd: 100
};
const provider = {
  health: () => ({ ok: true, operational: true, attested: true, providerId: 'runtime-provider' }),
  request: async ({ handle, request }) => ({ ok: true, response: { handleSeen: Boolean(handle), chainId: request.chainId }, evidenceId: 'runtime-evidence' })
};

try {
  const unavailable = createExternalAgentRuntime();
  check('missing external runtime provider is unavailable', unavailable.status().status === 'unavailable' && unavailable.status().executionActivated === false);
  const runtime = createExternalAgentRuntime({ provider, now: () => clock });
  const negotiation = runtime.negotiate({ passport, requestedCapabilities: ['quote'], chainId: 42161, protocol: 'swap', userAuthorized: true, guardianApproved: true });
  check('capability negotiation is scoped and not execution authorization', negotiation.ok && negotiation.canIssueSession && negotiation.executionAuthorized === false);
  const noUser = runtime.issueSession({ passport, capabilities: ['quote'], allowedChains: [42161], allowedProtocols: ['swap'], maxTransactionUsd: 50, userAuthorized: false, guardianApproved: true });
  check('session requires explicit user authorization', !noUser.ok && noUser.code === 'USER_AUTHORIZATION_REQUIRED');
  const issued = runtime.issueSession({ passport, capabilities: ['quote'], allowedChains: [42161], allowedProtocols: ['swap'], maxTransactionUsd: 50, ttlMs: 60000, userAuthorized: true, guardianApproved: true });
  const session = issued.session;
  check('session issue returns only an opaque scoped handle', issued.ok && issued.handlesOnly && session.handle && session.externalReceivesHandleOnly && session.rawCredentialsAllowed === false && session.executionAuthorized === false);
  check('request is bounded to chain protocol amount and capability', runtime.validateRequest(session, { chainId: 42161, protocol: 'swap', amountUsd: 25, capability: 'quote' }).ok && runtime.validateRequest(session, { chainId: 1, protocol: 'swap', amountUsd: 25, capability: 'quote' }).code === 'CHAIN_SCOPE_EXCEEDED' && runtime.validateRequest(session, { chainId: 42161, protocol: 'swap', amountUsd: 51, capability: 'quote' }).code === 'TRANSACTION_SCOPE_EXCEEDED');
  check('raw credentials are rejected at runtime request boundary', runtime.validateRequest(session, { chainId: 42161, protocol: 'swap', amountUsd: 1, capability: 'quote', privateKey: 'x' }).code === 'RAW_CREDENTIAL_FORBIDDEN');
  const invoked = await runtime.invoke(session, { chainId: 42161, protocol: 'swap', amountUsd: 10, capability: 'quote' });
  check('runtime transport receives a handle but no authority', invoked.ok && invoked.response.handleSeen && invoked.executionAuthorized === false && invoked.rawCredentialsAllowed === false);
  clock = now + 61000;
  check('expiration is checked again on every request', runtime.validateRequest(session, { chainId: 42161, protocol: 'swap', amountUsd: 1, capability: 'quote' }).code === 'SESSION_EXPIRED');
  clock = now;
  const issued2 = runtime.issueSession({ passport, capabilities: ['quote'], allowedChains: [42161], allowedProtocols: ['swap'], maxTransactionUsd: 50, ttlMs: 60000, userAuthorized: true, guardianApproved: true });
  const revoked = runtime.revoke(issued2.session);
  check('revoke immediately invalidates the scope', revoked.ok && revoked.immediate && runtime.validateRequest(issued2.session, { chainId: 42161, protocol: 'swap', amountUsd: 1, capability: 'quote' }).code === 'SESSION_REVOKED');
  const issued3 = runtime.issueSession({ passport, capabilities: ['quote'], allowedChains: [42161], allowedProtocols: ['swap'], maxTransactionUsd: 50, ttlMs: 60000, userAuthorized: true, guardianApproved: true });
  const disconnected = runtime.disconnect(issued3.session);
  check('disconnect immediately invalidates the scope', disconnected.ok && disconnected.immediate && runtime.validateRequest(issued3.session, { chainId: 42161, protocol: 'swap', amountUsd: 1, capability: 'quote' }).code === 'RUNTIME_DISCONNECTED');
  check('standalone request validation also rejects expired/unsafe scopes', validateExternalRuntimeRequest({ ...issued2.session, revoked: false, disconnected: false, expiresAt: now - 1 }, { chainId: 42161, protocol: 'swap', amountUsd: 1 }, { now }).code === 'SESSION_EXPIRED');
  check('runtime public status never claims live execution', runtime.status().executionActivated === false && runtime.status().rawCredentialsAllowed === false);

  console.log(JSON.stringify({ probe: 'phase15-external-runtime', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase15-external-runtime', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
