/**
 * FBT INTENT AI — Phase 27: RPC quorum and on-chain policy operations.
 */
import { fail, safeId, unavailable } from './phaseBoundary.js';

export const PHASE27_SCHEMA = 'fbt.rpc-policy-ops.v1';

export function operateRpcQuorum({ rpc = null, deployment = null, endpoints = [] } = {}) {
  const healthy = Array.isArray(endpoints) ? endpoints.filter((row) => row?.healthy === true && row?.attested === true) : [];
  if (healthy.length >= 2 && (!rpc || rpc.available !== true)) {
    rpc = { available: true, attested: true };
  }
  if (!rpc || rpc.available !== true || rpc.attested !== true) {
    return unavailable('RPC_OUTAGE', null, { schema: PHASE27_SCHEMA, success: false });
  }
  if (Array.isArray(endpoints) && endpoints.length > 0 && healthy.length < 2) {
    return unavailable('RPC_QUORUM_UNAVAILABLE', null, { schema: PHASE27_SCHEMA, success: false });
  }
  if (!deployment || !safeId(deployment.providerId) || !deployment.address || !deployment.codeHash) {
    return unavailable('CONTRACT_EVIDENCE_INCOMPLETE');
  }
  if (deployment.expectedCodeHash && deployment.expectedCodeHash !== deployment.codeHash) {
    return unavailable('CONTRACT_CODE_HASH_MISMATCH', null, { success: false });
  }
  return { ok: true, schema: PHASE27_SCHEMA, chainId: Number(deployment.chainId) || null, operational: false, success: false };
}

export function enforceOnchainPolicy({ localDigest = null, onchainDigest = null, readable = true } = {}) {
  if (readable !== true) return unavailable('POLICY_UNREADABLE', null, { success: false });
  if (!localDigest || !onchainDigest) return unavailable('POLICY_DIGEST_REQUIRED');
  if (localDigest !== onchainDigest) return fail('LOCAL_ONCHAIN_POLICY_MISMATCH', null, { success: false });
  return { ok: true, schema: PHASE27_SCHEMA, authoritative: 'on-chain', operational: false, live: false };
}

export function evaluateRpcPolicyPlane(input = {}) {
  const rpc = operateRpcQuorum(input);
  const policy = enforceOnchainPolicy(input.policy || {});
  const blockers = [rpc.code, policy.code].filter(Boolean);
  return {
    phase: 27,
    schema: PHASE27_SCHEMA,
    implementation: 'implemented',
    operational: false,
    live: false,
    ready: false,
    success: false,
    blockers: [...new Set(blockers.length ? blockers : ['RPC_OUTAGE'])],
    rpc,
    policy
  };
}
