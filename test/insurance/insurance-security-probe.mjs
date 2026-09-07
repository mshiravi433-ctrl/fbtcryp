/**
 * FBT Insurance OS — security / failure / replay probe.
 *  - quote expiry is never honoured after expiresAt
 *  - cross-owner access is denied (no leakage)
 *  - claims against non-active coverage are rejected
 *  - payouts on unapproved claims are rejected
 *  - provider fallback: unavailable provider is skipped, honest "no eligible"
 *    is returned instead of an invented quote
 *  - money ops stay idempotent (no duplicate coverage)
 */
import assert from 'node:assert/strict';
import { setupProviders } from '../../server/insurance/adapters/index.js';
import { quotingProviders, noteHealth } from '../../server/insurance/provider-registry.js';
import * as service from '../../server/insurance/service.js';
import * as coverageApi from '../../server/insurance/coverage.js';
import * as claimsApi from '../../server/insurance/claims.js';
import { toMicro } from '../../server/insurance/constants.js';

let pass = 0;
const ok = (n) => { pass += 1; console.log('  ✓', n); };
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function freshQuote(wallet) {
  const res = await service.aggregateQuotes({ walletAddress: wallet, chainId: 56, protectionType: 'bridge', coverageAmountMicro: toMicro('2000'), durationDays: 30 });
  return res.quotes[0];
}

async function main() {
  setupProviders();

  // 1) Quote expiry never honoured.
  const q = await freshQuote(A);
  const forged = { ...q, expiresAt: Date.now() - 1000 };
  const expired = await service.getQuote(forged.quoteId); // stored one is still valid
  assert.ok(expired.ok === true, 'stored quote still valid');
  // simulate an expired stored quote
  const store = await import('../../server/insurance/store.js');
  await store.set('quotes', q.quoteId, { ...q, expiresAt: Date.now() - 1000 });
  const gone = await service.getQuote(q.quoteId);
  assert.ok(gone.ok === false && gone.error === 'QUOTE_EXPIRED');
  ok('expired quote is never honoured (QUOTE_EXPIRED)');

  // 2) Cross-owner coverage access denied.
  const q2 = await freshQuote(A);
  const intent = await coverageApi.createPurchaseIntent({ quoteId: q2.quoteId, walletAddress: A, idempotencyKey: 'sec-owner-a' });
  await coverageApi.activateCoverage({ coverageId: intent.coverageId, owner: A, txHash: '0xsecowner', chainId: 56 });
  const own = await coverageApi.getCoverage(intent.coverageId, A);
  const other = await coverageApi.getCoverage(intent.coverageId, B);
  assert.ok(own && other === null);
  ok('cross-owner coverage read returns null (no leakage)');

  // 3) Claim against a non-active (expired/cancelled) coverage rejected.
  await coverageApi.cancelCoverage({ coverageId: intent.coverageId, owner: A });
  let rejected = null;
  try { await claimsApi.createClaim({ coverageId: intent.coverageId, owner: A, incidentType: 'x', description: 'y' }); } catch (e) { rejected = e.code; }
  assert.equal(rejected, 'COVERAGE_NOT_ACTIVE');
  ok('claim on non-active coverage rejected');

  // 4) Payout on an unapproved claim rejected.
  const q3 = await freshQuote(A);
  const intent3 = await coverageApi.createPurchaseIntent({ quoteId: q3.quoteId, walletAddress: A, idempotencyKey: 'sec-payout-unapproved' });
  await coverageApi.activateCoverage({ coverageId: intent3.coverageId, owner: A, txHash: '0xsec3', chainId: 56 });
  const claim = await claimsApi.createClaim({ coverageId: intent3.coverageId, owner: A, incidentType: 'x', description: 'y', affectedAmountMicro: toMicro('500') });
  let payoutErr = null;
  try { await claimsApi.recordPayout({ claimId: claim.claimId, txHash: '0xzzz', amountMicro: toMicro('500'), chainId: 56 }); } catch (e) { payoutErr = e.code; }
  assert.equal(payoutErr, 'CLAIM_NOT_APPROVED');
  ok('payout on an unapproved claim is rejected');

  // 5) Provider fallback: mark the only EVM provider UNAVAILABLE -> honest "no eligible".
  const p = quotingProviders().find((x) => x.providerId === 'fbt-sandbox-evm');
  noteHealth('fbt-sandbox-evm', { status: 'UNAVAILABLE', quoteSuccessRate: 0 });
  const noEligible = await service.aggregateQuotes({ walletAddress: A, chainId: 56, protectionType: 'bridge', coverageAmountMicro: toMicro('1000'), durationDays: 30 });
  assert.ok(noEligible.none === true && /No eligible protection/.test(noEligible.reason));
  ok('provider fallback returns honest "No eligible protection" (never invents a quote)');
  // restore health so later assertions can still get a quote
  noteHealth('fbt-sandbox-evm', { status: 'HEALTHY', quoteSuccessRate: 1 });
  void p;

  // 6) Duplicate purchase with same idempotency key returns SAME coverage.
  const q4 = await freshQuote(A);
  const i1 = await coverageApi.createPurchaseIntent({ quoteId: q4.quoteId, walletAddress: A, idempotencyKey: 'sec-dup-1' });
  const i2 = await coverageApi.createPurchaseIntent({ quoteId: q4.quoteId, walletAddress: A, idempotencyKey: 'sec-dup-1' });
  assert.equal(i1.coverageId, i2.coverageId);
  ok('duplicate purchase blocked by idempotency (same coverageId)');

  console.log(`\nPASS ${pass} insurance-security assertions`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e); process.exit(1); });
