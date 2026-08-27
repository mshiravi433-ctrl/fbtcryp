/**
 * PHASE 78 — INDEPENDENT THIRD-PARTY VERIFICATION
 * Our own word is the weakest evidence. Two independent operators must agree,
 * one disagreement kills the claim, and the packet they see reveals nothing.
 */
import { readFileSync } from 'node:fs';
import {
  buildVerificationPacket, requestIndependentVerification, assurancePlaneReady,
  assertVerificationHonest, MIN_INDEPENDENT_VERIFIERS, VERIFICATION_SCHEMA, VERDICTS,
  buildReceiptLeaf, buildBatch, merkleProof
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const TX = '0x'.concat('2'.repeat(64));
const TERMS = { amount: 100, tokenIn: 'USDC', tokenOut: 'ETH', recipient: '0x'.concat('c'.repeat(40)) };
const OUTCOME = { status: 'confirmed', received: 0.039 };
const leaf = buildReceiptLeaf({ intentId: 'i1', terms: TERMS, outcome: OUTCOME, txHash: TX, at: NOW });
const batch = buildBatch({ leaves: [leaf], now: NOW });
const anchor = { root: batch.root, txHash: TX, chainId: 1, anchored: true };
const proof = merkleProof(batch, leaf.leaf);
const packet = buildVerificationPacket({ receiptLeaf: leaf, anchor, proof, now: NOW });

const agreeing = (id) => ({ operatorId: id, verify: async (p) => ({ verdict: 'verified', leaf: p.leaf, evidence: 'root matched' }) });

try {
  /* ---------- the packet reveals nothing ---------- */
  check('a packet is built', packet.ok === true && packet.packet.schema === VERIFICATION_SCHEMA);
  check('the packet carries the hashes', typeof packet.packet.termsHash === 'string' && typeof packet.packet.leaf === 'string');
  check('the packet carries the anchor', packet.packet.anchorRoot === batch.root && packet.packet.anchorTxHash === TX);
  check('the packet carries the inclusion path', Array.isArray(packet.packet.proofPath));
  check('the packet does NOT contain the terms', packet.packet.terms === undefined && packet.revealsTerms === false);
  check('the packet does NOT contain the recipient', JSON.stringify(packet.packet).includes('cccccccc') === false);
  check('the packet does NOT contain the amount', JSON.stringify(packet.packet).includes('"amount"') === false);
  check('the packet is frozen against edits', Object.isFrozen(packet.packet));
  check('the packet has its own hash', typeof packet.packetHash === 'string');
  check('no leaky field slipped through', packet.leaks.length === 0);
  check('a packet without a leaf is refused', buildVerificationPacket({ now: NOW }).ok === false);

  /* ---------- quorum ---------- */
  const one = await requestIndependentVerification({ packet, verifiers: [agreeing('op-a')], now: NOW });
  check('ONE verifier is not enough', one.verdict === 'unverified' && one.ok === false);
  check('the shortfall is stated', one.required === MIN_INDEPENDENT_VERIFIERS);
  check('an unverified result says so in a key', one.i18nKey === 'intentAI.verify.unverified');
  const two = await requestIndependentVerification({ packet, verifiers: [agreeing('op-a'), agreeing('op-b')], now: NOW });
  check('two independent verifiers reach quorum', two.verdict === 'verified' && two.ok === true);
  check('the verifiers are named', two.verifiedBy.includes('op-a') && two.verifiedBy.includes('op-b'));
  check('the verified notice is a translatable key', two.i18nKey === 'intentAI.verify.verified');
  check('the count is in the params', two.i18nParams.count === 2);

  /* ---------- independence ---------- */
  const dupes = await requestIndependentVerification({ packet, verifiers: [agreeing('op-a'), agreeing('op-a'), agreeing('op-a')], now: NOW });
  check('the same operator answering three times is ONE voice', dupes.independentCount === 1);
  check('duplicated voices do not reach quorum', dupes.verdict === 'unverified');
  check('the duplicates are counted', dupes.duplicates === 2);
  check('a verifier with no operator id does not count',
    (await requestIndependentVerification({ packet, verifiers: [agreeing('op-a'), { verify: async () => ({ verdict: 'verified' }) }], now: NOW })).verdict === 'unverified');

  /* ---------- disagreement beats majority ---------- */
  const disputed = await requestIndependentVerification({
    packet,
    verifiers: [agreeing('op-a'), agreeing('op-b'), agreeing('op-c'), { operatorId: 'op-d', verify: async () => ({ verdict: 'disputed' }) }],
    now: NOW
  });
  check('one dissenting verifier makes the whole result disputed', disputed.verdict === 'disputed');
  check('a disputed result is not ok', disputed.ok === false);
  check('the dissenter is named', disputed.disputedBy.includes('op-d'));
  check('majority does NOT override a dispute', disputed.verifiedBy.length === 3 && disputed.verdict !== 'verified');
  check('the dispute is a translatable notice', disputed.i18nKey === 'intentAI.verify.disputed');

  /* ---------- broken verifiers never count as agreement ---------- */
  const broken = await requestIndependentVerification({
    packet,
    verifiers: [agreeing('op-a'), { operatorId: 'op-x', verify: async () => { throw new Error('down'); } }],
    now: NOW
  });
  check('a throwing verifier does not crash the check', broken.verdict === 'unverified');
  check('a throwing verifier is not counted as agreement', broken.verifiedBy.includes('op-x') === false);
  const slow = await requestIndependentVerification({
    packet,
    verifiers: [agreeing('op-a'), { operatorId: 'op-slow', verify: () => new Promise((r) => { setTimeout(() => r({ verdict: 'verified' }), 200); }) }],
    timeoutMs: 20, now: NOW
  });
  check('a verifier that times out is not agreement', slow.verdict === 'unverified');
  const wrongLeaf = await requestIndependentVerification({
    packet,
    verifiers: [agreeing('op-a'), { operatorId: 'op-y', verify: async () => ({ verdict: 'verified', leaf: '0xdeadbeef' }) }],
    now: NOW
  });
  check('a verifier answering about ANOTHER receipt is discarded', wrongLeaf.verdict === 'unverified');
  check('with no verifiers at all nothing is verified',
    (await requestIndependentVerification({ packet, verifiers: [], now: NOW })).verdict === 'unverified');
  check('without a packet the result is unavailable, not verified',
    (await requestIndependentVerification({ verifiers: [agreeing('a'), agreeing('b')], now: NOW })).verdict === 'unavailable');
  check('every verdict is a known verdict', VERDICTS.includes(two.verdict) && VERDICTS.includes(disputed.verdict));

  /* ---------- the assurance plane ---------- */
  check('a healthy assurance plane is ready', assurancePlaneReady({ assurance: { ok: true, gaps: [] } }).ok === true);
  check('a degraded plane is reported', assurancePlaneReady({ assurance: { ok: false, gaps: ['x'] } }).ok === false);
  check('the degraded plane has a translatable notice',
    assurancePlaneReady({ assurance: null }).i18nKey === 'intentAI.verify.networkDegraded');

  /* ---------- the badge guard ---------- */
  check('the guard allows the badge on a real quorum', assertVerificationHonest(two).mayShowVerifiedBadge === true);
  check('the guard refuses the badge without quorum', assertVerificationHonest(one).mayShowVerifiedBadge === false);
  check('the guard catches a forged single-verifier claim',
    assertVerificationHonest({ schema: VERIFICATION_SCHEMA, verdict: 'verified', verifiedBy: ['op-a'], disputedBy: [] }).reasons.includes('QUORUM_NOT_MET'));
  check('the guard catches the same operator counted twice',
    assertVerificationHonest({ schema: VERIFICATION_SCHEMA, verdict: 'verified', verifiedBy: ['op-a', 'op-a'], disputedBy: [] }).reasons.includes('VERIFIERS_NOT_INDEPENDENT'));
  check('the guard catches verified-while-disputed',
    assertVerificationHonest({ schema: VERIFICATION_SCHEMA, verdict: 'verified', verifiedBy: ['a', 'b'], disputedBy: ['c'] }).reasons.includes('CLAIMED_VERIFIED_WHILE_DISPUTED'));
  check('the guard rejects a non-verification', assertVerificationHonest({ verdict: 'verified' }).ok === false);
  check('the guard refuses the badge on a disputed result', assertVerificationHonest(disputed).mayShowVerifiedBadge === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the verification copy is translated in en, fa and ar',
    locales.every((loc) => ['verified', 'unverified', 'disputed', 'unavailable', 'networkReady', 'networkDegraded']
      .every((k) => typeof loc?.intentAI?.verify?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase78-third-party-verification', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
