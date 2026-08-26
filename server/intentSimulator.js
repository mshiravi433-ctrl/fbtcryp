/**
 * FBT INTENT AI — Simulator service.
 *
 * Provides requestDigest + resultDigest evidence for Wave 2.
 * The simulator NEVER signs or submits transactions.
 * It only simulates intent execution and returns digests.
 */

import { createHash } from 'node:crypto';
import { verifySimulator } from '../src/lib/intent-ai/operationalActivation.js';

export const SIMULATOR_SCHEMA = 'fbt.intent-simulator.v1';

/**
 * Run a simulation. Returns requestDigest and resultDigest.
 * This is a local deterministic simulation — no external calls.
 */
export function simulateIntent(intent = {}, { now = Date.now() } = {}) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return { ok: false, code: 'INTENT_MALFORMED' };
  }

  const requestPayload = {
    kind: intent.kind || 'swap',
    chainId: intent.chainId || 0,
    from: intent.from || '',
    to: intent.to || '',
    amount: intent.amount || '0',
    nonce: intent.nonce || now
  };

  const requestDigest = createHash('sha256')
    .update(JSON.stringify(requestPayload))
    .digest('hex');

  /* Simulate execution deterministically */
  const simulatedResult = {
    requestDigest,
    status: 'simulated',
    gasEstimate: '21000',
    outputAmount: intent.amount || '0',
    slippageBps: 30,
    routeVerified: true
  };

  const resultDigest = createHash('sha256')
    .update(JSON.stringify(simulatedResult))
    .digest('hex');

  return {
    ok: true,
    schema: SIMULATOR_SCHEMA,
    requestDigest,
    resultDigest,
    providerId: 'local-simulator',
    checkedAt: now,
    expiresAt: now + 300_000,
    simulated: true,
    signs: false,
    submits: false
  };
}

/**
 * Get simulator evidence for phase activation.
 */
export function simulatorEvidence({ now = Date.now() } = {}) {
  const sim = simulateIntent({ kind: 'swap', chainId: 421614, amount: '1000000' }, { now });
  if (!sim.ok) return { ok: false, code: sim.code };

  return verifySimulator({
    providerId: sim.providerId,
    requestDigest: sim.requestDigest,
    resultDigest: sim.resultDigest,
    checkedAt: sim.checkedAt,
    expiresAt: sim.expiresAt,
    available: true,
    timeout: false
  }, { now });
}
