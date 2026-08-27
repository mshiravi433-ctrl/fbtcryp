/**
 * PHASE 75 — ON-CHAIN RECEIPT
 * A receipt this app prints is this app's word. An anchored hash is not.
 * Submitted is not mined, a mined anchor gets a real link, and a receipt
 * edited after anchoring fails verification.
 */
import { readFileSync } from 'node:fs';
import {
  digest, buildReceiptLeaf, buildBatch, merkleProof, verifyProof,
  anchorBatch, explorerUrl, verifyAgainstAnchor, ANCHOR_SCHEMA, MAX_BATCH_SIZE
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const TX = '0x'.concat('1'.repeat(64));
const TERMS = { amount: 100, tokenIn: 'USDC', tokenOut: 'ETH', slippageBps: 50 };
const OUTCOME = { status: 'confirmed', received: 0.039, txHash: TX };

try {
  /* ---------- the leaf ---------- */
  const leaf = buildReceiptLeaf({ intentId: 'i1', terms: TERMS, outcome: OUTCOME, txHash: TX, at: NOW });
  check('a leaf is built from terms and outcome', leaf.ok === true && leaf.schema === ANCHOR_SCHEMA);
  check('the terms are committed as a hash', typeof leaf.termsHash === 'string' && leaf.termsHash.startsWith('0x'));
  check('the outcome is committed too', typeof leaf.outcomeHash === 'string');
  check('terms and outcome are separate commitments', leaf.termsHash !== leaf.outcomeHash);
  check('the leaf never carries the terms themselves', leaf.revealsTerms === false && leaf.terms === undefined);
  check('the leaf is deterministic',
    buildReceiptLeaf({ intentId: 'i1', terms: TERMS, outcome: OUTCOME, txHash: TX, at: NOW + 1 }).leaf === leaf.leaf);
  check('a different amount gives a different leaf',
    buildReceiptLeaf({ intentId: 'i1', terms: { ...TERMS, amount: 500 }, outcome: OUTCOME, at: NOW }).leaf !== leaf.leaf);
  check('a leaf with no outcome is refused', buildReceiptLeaf({ intentId: 'i1', terms: TERMS, at: NOW }).ok === false);
  check('a leaf with no terms is refused', buildReceiptLeaf({ intentId: 'i1', outcome: OUTCOME, at: NOW }).ok === false);
  check('a leaf with no intent is refused', buildReceiptLeaf({ terms: TERMS, outcome: OUTCOME, at: NOW }).ok === false);
  check('a bad execution hash is dropped, not stored',
    buildReceiptLeaf({ intentId: 'i1', terms: TERMS, outcome: OUTCOME, txHash: '0xzz', at: NOW }).executionTxHash === null);
  check('the digest is stable', digest({ a: 1 }) === digest({ a: 1 }));
  check('the digest separates different inputs', digest({ a: 1 }) !== digest({ a: 2 }));

  /* ---------- batching keeps gas honest ---------- */
  const leaves = Array.from({ length: 7 }, (_, i) =>
    buildReceiptLeaf({ intentId: `i${i}`, terms: { ...TERMS, amount: 100 + i }, outcome: OUTCOME, at: NOW }));
  const batch = buildBatch({ leaves, now: NOW });
  check('a batch is built', batch.ok === true && batch.size === 7);
  check('many receipts cost ONE transaction', batch.transactionsRequired === 1);
  check('the batch has a single root', typeof batch.root === 'string');
  check('an unanchored batch says so', batch.state === 'unanchored');
  check('an empty batch is refused', buildBatch({ leaves: [], now: NOW }).ok === false);
  check('broken leaves never enter the batch', buildBatch({ leaves: [{ ok: false }], now: NOW }).ok === false);
  check('the batch is bounded', MAX_BATCH_SIZE >= 2 && buildBatch({ leaves: Array.from({ length: MAX_BATCH_SIZE + 40 }, (_, i) => buildReceiptLeaf({ intentId: `x${i}`, terms: TERMS, outcome: OUTCOME, at: NOW })), now: NOW }).size === MAX_BATCH_SIZE);

  /* ---------- inclusion proofs ---------- */
  const proof = merkleProof(batch, leaves[3].leaf);
  check('a member gets an inclusion proof', proof.ok === true);
  check('the proof verifies against the root', verifyProof({ leaf: leaves[3].leaf, path: proof.path, root: batch.root }).verified === true);
  check('every member of the batch can prove inclusion',
    leaves.every((l) => verifyProof({ leaf: l.leaf, path: merkleProof(batch, l.leaf).path, root: batch.root }).verified === true));
  check('a non-member gets no proof', merkleProof(batch, digest('not-in-batch')).ok === false);
  check('a tampered path does not verify',
    verifyProof({ leaf: leaves[3].leaf, path: [{ hash: digest('x'), right: true }], root: batch.root }).verified === false);
  check('a proof without a root does not verify', verifyProof({ leaf: leaves[0].leaf, path: [] }).verified === false);

  /* ---------- submitted is not mined ---------- */
  const noAdapter = await anchorBatch({ batch, now: NOW });
  check('with no chain adapter nothing is claimed', noAdapter.anchored === false && noAdapter.ok === false);
  check('an unanchored receipt gets NO verification link', noAdapter.verifyUrl === null);
  const pending = await anchorBatch({ batch, chainId: 1, submit: async () => ({ txHash: TX }), now: NOW });
  check('a submitted-but-unmined anchor is pending', pending.state === 'pending');
  check('a pending anchor is not anchored', pending.anchored === false);
  check('a pending anchor shows no verification link yet', pending.verifyUrl === null);
  check('the pending notice is a translatable key', pending.i18nKey === 'intentAI.anchor.pending');
  const mined = await anchorBatch({ batch, chainId: 1, submit: async () => ({ txHash: TX, blockNumber: 19_000_000, confirmed: true }), now: NOW });
  check('a mined anchor is anchored', mined.anchored === true && mined.state === 'anchored');
  check('a mined anchor carries a real explorer link', mined.verifyUrl === `https://etherscan.io/tx/${TX}`);
  check('the anchor records the block', mined.blockNumber === 19_000_000);
  const rejected = await anchorBatch({ batch, chainId: 1, submit: async () => ({ ok: true }), now: NOW });
  check('a submit with no tx hash is a failure, not an anchor', rejected.state === 'failed' && rejected.anchored === false);
  const threw = await anchorBatch({ batch, chainId: 1, submit: async () => { throw new Error('rpc'); }, now: NOW });
  check('a throwing submit does not crash', threw.ok === false && typeof threw.error?.code === 'string');

  /* ---------- links are never guessed ---------- */
  check('a known chain gets a link', explorerUrl({ chainId: 42161, txHash: TX }).includes('arbiscan'));
  check('an unknown chain gets NO link', explorerUrl({ chainId: 99999, txHash: TX }) === null);
  check('a bad hash gets no link', explorerUrl({ chainId: 1, txHash: 'nope' }) === null);

  /* ---------- verifying what the user sees ---------- */
  const p3 = merkleProof(batch, leaves[3].leaf);
  const anchoredBatch = { ...mined, root: batch.root };
  const good = verifyAgainstAnchor({ intentId: 'i3', terms: { ...TERMS, amount: 103 }, outcome: OUTCOME, proof: p3, anchor: anchoredBatch });
  check('an unaltered receipt verifies', good.verified === true && good.i18nKey === 'intentAI.anchor.verified');
  check('the verified result carries the link', good.verifyUrl === mined.verifyUrl);
  const altered = verifyAgainstAnchor({ intentId: 'i3', terms: { ...TERMS, amount: 999 }, outcome: OUTCOME, proof: p3, anchor: anchoredBatch });
  check('a receipt edited after anchoring FAILS to verify', altered.verified === false);
  check('the alteration is named', altered.reason === 'RECEIPT_ALTERED');
  check('the alteration carries a TERMS_CHANGED error', altered.error.code === 'TERMS_CHANGED');
  check('a pending anchor cannot verify anything',
    verifyAgainstAnchor({ intentId: 'i3', terms: { ...TERMS, amount: 103 }, outcome: OUTCOME, proof: p3, anchor: pending }).verified === false);
  check('verification without an anchor fails closed',
    verifyAgainstAnchor({ intentId: 'i3', terms: TERMS, outcome: OUTCOME, proof: p3 }).verified === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the anchor strings are translated in en, fa and ar',
    locales.every((loc) => ['anchored', 'pending', 'verified', 'mismatch', 'unavailable', 'viewOnExplorer']
      .every((k) => typeof loc?.intentAI?.anchor?.[k] === 'string')));
  check('the pending copy never claims proof', !/proven\b(?!\s*yet)/i.test(locales[0].intentAI.anchor.pending));

  console.log(JSON.stringify({ probe: 'phase75-onchain-receipt', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
