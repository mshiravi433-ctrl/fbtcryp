/**
 * FBT INTENT AI — Phase 25: Smart Wallet, independent Guardian and production signer.
 */
import { fail, safeId, unavailable, NON_BYPASSABLE_CONTROLS } from './phaseBoundary.js';

export const PHASE25_SCHEMA = 'fbt.signer-guardian-ops.v1';
export const FEE_CATEGORIES = Object.freeze(['network', 'protocol', 'bridge', 'external-agent', 'performance', 'execution', 'slippage', 'other']);

export function operateSmartWallet({ wallet = null, guardian = null, userConfirmed = false, userId = null } = {}) {
  if (!wallet || wallet.available !== true) return unavailable('SMART_WALLET_UNAVAILABLE', null, { schema: PHASE25_SCHEMA });
  if (!guardian || guardian.independent !== true) return unavailable('SMART_WALLET_WITHOUT_GUARDIAN');
  if (userId && guardian.identity && String(guardian.identity) === String(userId)) {
    return fail('GUARDIAN_MUST_NOT_BE_USER');
  }
  if (guardian.approved === true && userConfirmed !== true) return fail('GUARDIAN_CANNOT_REPLACE_USER');
  return {
    ok: true,
    schema: PHASE25_SCHEMA,
    walletId: safeId(wallet.providerId),
    operational: false,
    live: false,
    controls: [...NON_BYPASSABLE_CONTROLS]
  };
}

export function operateProductionSigner({ signer = null, envelope = null, authorized = null } = {}) {
  if (!signer || signer.policyBound !== true || signer.kmsBound !== true) return unavailable('SIGNER_WITHOUT_POLICY');
  if (signer.exposesPrivateKey === true || signer.mock === true) return fail('RAW_CREDENTIAL_FORBIDDEN');
  if (!envelope || !authorized) return fail('AUTHORIZED_ENVELOPE_REQUIRED');
  const fields = ['recipient', 'calldata', 'chain', 'amount', 'fee', 'slippage'];
  for (const field of fields) {
    if (envelope[field] !== authorized[field]) return fail('SIGNER_REJECTS_MUTATED_ENVELOPE', field);
  }
  return { ok: true, schema: PHASE25_SCHEMA, signed: false, accepted: true, operational: false, live: false };
}

export function authorizationFeesPresent(fees = {}) {
  const missing = FEE_CATEGORIES.filter((key) => fees[key] == null);
  return missing.length ? unavailable('FEE_CATEGORIES_INCOMPLETE', missing.join(',')) : { ok: true, schema: PHASE25_SCHEMA, feesComplete: true };
}

export function evaluateSignerGuardianPlane(input = {}) {
  const wallet = operateSmartWallet(input);
  const signer = operateProductionSigner({ signer: input.signer, envelope: input.envelope, authorized: input.authorized });
  const fees = authorizationFeesPresent(input.fees || {});
  const blockers = [wallet.code, signer.code, fees.ok ? null : fees.code].filter(Boolean);
  return {
    phase: 25,
    schema: PHASE25_SCHEMA,
    implementation: 'implemented',
    operational: false,
    live: false,
    ready: false,
    signed: false,
    blockers: [...new Set(blockers.length ? blockers : ['SMART_WALLET_WITHOUT_GUARDIAN'])],
    wallet,
    signer,
    fees
  };
}
