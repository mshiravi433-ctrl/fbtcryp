#!/usr/bin/env node
/**
 * Shared helper for the owner-activated release probes.
 *
 * Builds the owner plane-attestation bundle (control planes 22–50) with the
 * SAME builder the activation script uses, and injects it through the
 * dual-operator route. Test-only operators and key — never configured in a
 * deployment by the app.
 */
import { buildActivationFacts } from '../../../server/intentRuntimePlaneInputs.js';
import { PLANE_ATTESTATIONS_SCHEMA } from '../../../server/intentPlaneAttestations.js';

export const OWNER_TEST_OPERATORS = Object.freeze(['owner-test-a', 'owner-test-b']);
// Fixture-only operator key. Never configured in a deployment by the app.
process.env.INTENT_OPERATOR_EVIDENCE_KEY ||= 'test-only-operator-evidence-key-2026';

export function ownerAttestationBundle({ now = Date.now(), ttlMs = 6 * 3600_000, operators = null } = {}) {
  const [op1, op2] = operators || OWNER_TEST_OPERATORS;
  return {
    schema: PLANE_ATTESTATIONS_SCHEMA,
    operators: [op1, op2],
    attestedAt: now - 1000,
    expiresAt: now + ttlMs,
    planes: buildActivationFacts({
      operators: [op1, op2],
      reviewerId: 'owner-test-reviewer',
      providerPrefix: 'test',
      salt: 'owner-test-activation',
      now,
      ttlMs
    })
  };
}

export async function injectOwnerAttestations(base, options = {}) {
  const [op1, op2] = options.operators || OWNER_TEST_OPERATORS;
  const bundle = ownerAttestationBundle(options);
  const response = await fetch(`${base}/api/intents/v1/plane-attestations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Operator-1': op1,
      'X-Operator-2': op2,
      'x-operator-evidence-key': process.env.INTENT_OPERATOR_EVIDENCE_KEY
    },
    body: JSON.stringify({ bundle })
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error(`owner attestation injection failed: ${response.status} ${JSON.stringify(result)}`);
  }
  return result;
}
