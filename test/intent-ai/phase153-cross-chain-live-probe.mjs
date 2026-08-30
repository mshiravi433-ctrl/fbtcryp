/**
 * Phase 153 probe — the browser cross-chain client is REAL.
 *
 * The reason cross-chain was "not connected" was structural: the server's
 * settlement machine (fbt.cross-chain-state.v1 + signed leg receipts) verifies
 * Ed25519 with node:crypto, but no browser code could produce those
 * signatures. This probe proves the @noble/ed25519 client produces keys,
 * plan ids and signatures the SERVER validator accepts byte-for-byte:
 *
 *   1. client key → server isValidEd25519PublicKey() === true
 *   2. client-built plan (incl. deterministic stateId) → server
 *      validateCrossChainState() accepts it UNCHANGED
 *   3. client-signed source receipt → server verifyCrossChainReceipt() ok
 *   4. any tampering → server rejects with signature/binding mismatches
 *   5. client-signed destination receipt chains on the source receipt
 *   6. canonical serialization is identical on both sides
 */
import assert from 'node:assert/strict';
import {
  canonicalValue,
  generatePartyKey,
  buildCrossChainStatePlan,
  signLegReceipt,
  verifyLegReceiptLocally,
  canonicalSigningMessage,
  CROSS_CHAIN_RECEIPT_DOMAIN
} from '../../src/lib/intentCrossChainClient.js';
import {
  validateCrossChainState,
  verifyCrossChainReceipt
} from '../../server/intentCrossChain.js';
import { verifyCanonicalSignature, canonicalValue as serverCanonicalValue, isValidEd25519PublicKey } from '../../server/intentSignatures.js';

const tests = [];
async function test(name, fn) {
  try { await fn(); tests.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (error) { tests.push({ name, ok: false }); console.error(`✗ ${name}: ${error.message}`); }
}

const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const initiator = generatePartyKey();
const counterparty = generatePartyKey();

await test('client Ed25519 keys are accepted by the server verifier', () => {
  assert.equal(isValidEd25519PublicKey(initiator.publicKey), true);
  assert.equal(isValidEd25519PublicKey(counterparty.publicKey), true);
});

await test('canonical JSON is identical on client and server', () => {
  const sample = { b: 2, a: [1, { d: 'x', c: true }], signature: 'dropped', skip: undefined };
  assert.equal(JSON.stringify(canonicalValue(sample)), JSON.stringify(serverCanonicalValue(sample)));
});

const PLAN_INPUT = {
  createdAt: Date.now(),
  windowHours: 48,
  source: { chainId: 56, token: { symbol: 'USDC', address: USDC_BSC, native: false, decimals: 18 }, amount: '1000000000000000000' },
  destination: { chainId: 42161, token: { symbol: 'USDC', address: USDC_ARB, native: false, decimals: 6 }, amount: '99500000' },
  parties: {
    initiator: { id: 'alice-on-phone', publicKey: initiator.publicKey },
    counterparty: { id: 'bob-on-laptop', publicKey: counterparty.publicKey }
  }
};

let state = null;
await test('client-built plan with deterministic stateId passes server validation unchanged', async () => {
  const built = await buildCrossChainStatePlan(PLAN_INPUT);
  assert.equal(built.ok, true);
  state = built.state;
  assert.equal(/^0x[0-9a-f]{64}$/.test(state.stateId), true);
  assert.equal(state.claims.atomic, false, 'sequential plans never claim atomicity');
  const checked = validateCrossChainState(state);
  assert.equal(checked.ok, true, `server rejected the client plan: ${checked.code || ''}`);
  assert.equal(checked.state.stateId, state.stateId, 'server-derived id must equal the client id');
});

await test('client signs a source receipt the server verifies', async () => {
  const txHash = `0x${'ab'.repeat(32)}`;
  const signed = await signLegReceipt({ state, leg: 'source-transfer', txHash }, initiator.privateKey);
  assert.equal(signed.ok, true);
  const verified = verifyCrossChainReceipt(signed.receipt, { state, previousReceipts: [] });
  assert.equal(verified.ok, true, `server rejected the client receipt: ${verified.code || ''}`);
  // server-side signature check through the independent verify path too
  const { signature, receiptId, ...core } = signed.receipt;
  assert.equal(verifyCanonicalSignature(CROSS_CHAIN_RECEIPT_DOMAIN, { ...core, receiptId }, signature, initiator.publicKey), true);
  assert.equal(verifyLegReceiptLocally(signed.receipt, initiator.publicKey), true);
});

await test('tampering is rejected by the server', async () => {
  const txHash = `0x${'cd'.repeat(32)}`;
  const signed = await signLegReceipt({ state, leg: 'source-transfer', txHash }, initiator.privateKey);
  const forged = { ...signed.receipt, txHash: `0x${'ef'.repeat(32)}` };
  const result = verifyCrossChainReceipt(forged, { state, previousReceipts: [] });
  assert.equal(result.ok, false);
  assert.ok(['CROSS_CHAIN_SIGNATURE_MISMATCH', 'BAD_CROSS_CHAIN_RECEIPT_ID', 'CROSS_CHAIN_LEG_WINDOW_CLOSED', 'BAD_CROSS_CHAIN_TRANSITION'].includes(result.code));
  // wrong signer key for the leg: the client refuses BEFORE producing a receipt
  const wrongSigner = await signLegReceipt({ state, leg: 'source-transfer', txHash }, counterparty.privateKey);
  assert.equal(wrongSigner.ok, false);
  assert.equal(wrongSigner.code, 'WRONG_SIGNER_KEY_FOR_LEG');
  assert.equal(wrongSigner.expectedPartyId, 'alice-on-phone');
});

await test('destination receipt chains on the source receipt', async () => {
  const src = await signLegReceipt({ state, leg: 'source-transfer', txHash: `0x${'ab'.repeat(32)}` }, initiator.privateKey);
  const dst = await signLegReceipt({ state, priorReceipts: [src.receipt], leg: 'destination-transfer', txHash: `0x${'12'.repeat(32)}` }, counterparty.privateKey);
  assert.equal(dst.receipt.fromPartyId, 'bob-on-laptop');
  assert.equal(dst.receipt.priorReceiptId, src.receipt.receiptId);
  const chain = verifyCrossChainReceipt(dst.receipt, { state, previousReceipts: [src.receipt] });
  assert.equal(chain.ok, true, `chained receipt rejected: ${chain.code || ''}`);
  // destination BEFORE source is a transition violation
  const early = verifyCrossChainReceipt(dst.receipt, { state, previousReceipts: [] });
  assert.equal(early.ok, false);
});

await test('signing message shape matches the server domain contract', async () => {
  assert.equal(typeof canonicalSigningMessage(CROSS_CHAIN_RECEIPT_DOMAIN, { x: 1 }), 'string');
  assert.ok(canonicalSigningMessage(CROSS_CHAIN_RECEIPT_DOMAIN, { x: 1 }).includes('fbt.cross-chain-leg-receipt.v1/signature'));
});

await test('bad inputs fail closed on the client before any network call', async () => {
  assert.equal((await buildCrossChainStatePlan({ ...PLAN_INPUT, source: { ...PLAN_INPUT.source, chainId: 42161 } })).code, 'BAD_CROSS_CHAIN_LEG');
  assert.equal((await buildCrossChainStatePlan({ ...PLAN_INPUT, parties: { initiator: PLAN_INPUT.parties.initiator, counterparty: PLAN_INPUT.parties.counterparty } })).ok, true);
  const dupParty = await buildCrossChainStatePlan({ ...PLAN_INPUT, parties: { initiator: PLAN_INPUT.parties.initiator, counterparty: { id: 'alice-on-phone', publicKey: initiator.publicKey } } });
  assert.equal(dupParty.code, 'BAD_CROSS_CHAIN_PARTIES');
  assert.equal((await signLegReceipt({ state, leg: 'source-transfer', txHash: 'not-a-hash' }, initiator.privateKey)).code, 'BAD_TX_HASH');
  assert.equal((await signLegReceipt({ state, leg: 'teleport' }, initiator.privateKey)).code, 'BAD_CROSS_CHAIN_TRANSITION');
});

let failed = 0;
for (const t of tests) if (!t.ok) failed += 1;
console.log(`\nphase153-cross-chain-live: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed > 0 ? 1 : 0);
