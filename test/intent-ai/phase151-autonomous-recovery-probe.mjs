import assert from 'node:assert/strict';
import {
  PERFORMANCE_FEE_BPS,
  createRecoveryJournal, saveRecoveryJob, appendRecoveryEvent, restoreRecoveryJournal,
  exportRecoveryBundle, importRecoveryBundle, persistRecoveryJournal, loadRecoveryJournal,
  diagnoseRecovery, venueOptions,
  compileAtomicIntent, createPortfolioGuard, evaluatePortfolioGuard,
  createWalletAgentProfile, rankAgents, calculatePerformanceFee, buildProfitSettlement,
  cexEligibility, evidenceLearningChecklist, autonomousScenarios
} from '../../src/lib/intent-ai/index.js';

const tests = [];
async function test(name, fn) {
  try { await fn(); tests.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (error) { tests.push({ name, ok: false }); console.error(`✗ ${name}: ${error.message}`); }
}

await test('recovery journal strips secrets and survives portable export/import', () => {
  let journal = createRecoveryJournal({ deviceId: 'phone', now: 100 });
  const saved = saveRecoveryJob(journal, {
    id: 'intent-1', intentType: 'swap', chainId: 1, status: 'recoverable',
    termsFingerprint: 'terms:abc', privateKey: 'must-not-survive', calldata: '0xdeadbeef'
  }, { now: 110 });
  assert.equal(saved.ok, true);
  assert.equal(JSON.stringify(saved.journal).includes('must-not-survive'), false);
  assert.equal(JSON.stringify(saved.journal).includes('deadbeef'), false);
  journal = appendRecoveryEvent(saved.journal, 'intent-1', { code: 'RPC_UNAVAILABLE', detail: 'timeout' }, { now: 120 }).journal;
  assert.equal(journal.jobs[0].events.length, 1);
  const imported = importRecoveryBundle(exportRecoveryBundle(journal), { now: 130 });
  assert.equal(imported.ok, true);
  assert.equal(imported.importedJobs, 1);
  const memory = new Map();
  const storage = { setItem: (key, value) => memory.set(key, value), getItem: (key) => memory.get(key) ?? null };
  assert.equal(persistRecoveryJournal(journal, { storage }).ok, true);
  assert.equal(loadRecoveryJournal({ storage, now: 130 }).journal.jobs.length, 1);
  const tampered = JSON.parse(JSON.stringify(journal));
  tampered.jobs[0].status = 'completed';
  assert.equal(restoreRecoveryJournal(tampered, { now: 140 }).jobs.length, 0);
});

await test('recovery follows explain → alternative → recalculate → safe retry', () => {
  const rpc = diagnoseRecovery({ failureCode: 'RPC_UNAVAILABLE', attempts: 1 });
  assert.equal(rpc.retry.kind, 'PREFLIGHT_ONLY');
  assert.equal(rpc.retry.automaticallyBroadcasts, false);
  const changed = diagnoseRecovery({ failureCode: 'ROUTE_CHANGED', attempts: 1, termsChanged: true });
  assert.equal(changed.recalculate, true);
  assert.equal(changed.retry.requiresWalletConfirmation, true);
  assert.equal(diagnoseRecovery({ failureCode: 'RPC_UNAVAILABLE', attempts: 3 }).retry.allowed, false);
});

await test('spot options include 0x and all execution remains wallet-confirmed', () => {
  const rows = venueOptions({ market: 'spot', evm: true, healthyVenueIds: ['zero-x'] });
  assert.equal(rows.some((row) => row.id === 'zero-x' && row.executable), true);
  assert.equal(rows.every((row) => row.requiresWalletConfirmation), true);
  assert.equal(rows.find((row) => row.id === 'kyberswap').executable, false);
});

await test('atomic compiler is honest about same-chain and cross-chain workflows', () => {
  const adapter = { atomicSingleChain: true };
  const atomic = compileAtomicIntent({ adapter, steps: [
    { action: 'swap', chainId: 1, targetRef: 'zero-x', revertPolicy: 'abort-all' },
    { action: 'deposit', chainId: 1, targetRef: 'vault', revertPolicy: 'abort-all' }
  ] });
  assert.equal(atomic.ok, true);
  assert.equal(atomic.oneTransaction, true);
  assert.equal(atomic.requiresWalletConfirmation, true);
  const cross = compileAtomicIntent({ adapter, steps: [{ action: 'swap', chainId: 1 }, { action: 'bridge', chainId: 42161 }] });
  assert.equal(cross.ok, false);
  assert.ok(cross.blockers.includes('CROSS_CHAIN_NOT_ATOMIC'));
  assert.equal(cross.crossChainAtomicClaim, false);
});

await test('20% portfolio guard monitors and proposes but never trades', () => {
  const made = createPortfolioGuard({ maxRiskPct: 20, allowedAssets: ['USDC', 'ETH'] });
  assert.equal(made.ok, true);
  assert.equal(made.policy.promisesFixedProfit, false);
  const result = evaluatePortfolioGuard({ policy: made.policy, positions: [
    { asset: 'USDC', valueUsd: 600, riskWeight: 0.05 },
    { asset: 'ETH', valueUsd: 400, riskWeight: 0.8 }
  ] });
  assert.equal(result.breach, true);
  assert.equal(result.proposal.automaticallyExecutes, false);
  assert.equal(result.proposal.requiresWalletConfirmation, true);
});

await test('wallet agent is pseudonymous and ranking is evidence-weighted', () => {
  assert.equal(createWalletAgentProfile({ walletRef: '0x1111111111111111111111111111111111111111' }).ok, false);
  const profile = createWalletAgentProfile({ walletRef: 'wallet-ref-9', resilience: 'maximum' });
  assert.equal(profile.ok, true);
  assert.equal(profile.profile.signerAccess, false);
  const ranked = rankAgents([{ id: 'a', completed: 20, failed: 0, recovered: 3 }, { id: 'b', completed: 1, failed: 0 }]);
  assert.equal(ranked[0].id, 'a');
  assert.equal(ranked.every((row) => row.signerAccess === false), true);
});

await test('5% fee applies only to realised positive net profit', () => {
  assert.equal(PERFORMANCE_FEE_BPS, 500);
  const profit = calculatePerformanceFee({ proceedsUsd: 1200, costBasisUsd: 1000, networkFeesUsd: 20 });
  assert.equal(profit.netProfitUsd, 180);
  assert.equal(profit.feeUsd, 9);
  assert.equal(profit.userProfitAfterFeeUsd, 171);
  const loss = calculatePerformanceFee({ proceedsUsd: 900, costBasisUsd: 1000 });
  assert.equal(loss.feeUsd, 0);
  assert.equal(loss.lossCharged, false);
  assert.equal(calculatePerformanceFee({ proceedsUsd: 1200, costBasisUsd: 1000, feeBps: 900 }).ok, false);
});

await test('profit destination and fee are one explicit final proposal', () => {
  const fee = calculatePerformanceFee({ proceedsUsd: 1100, costBasisUsd: 1000 });
  const unverified = buildProfitSettlement({ fee, destination: 'external-wallet', feeRecipientConfigured: true });
  assert.equal(unverified.ok, false);
  const ready = buildProfitSettlement({ fee, destination: 'external-wallet', externalAddressVerified: true, feeRecipientConfigured: true });
  assert.equal(ready.ok, true);
  assert.equal(ready.automaticTransfer, false);
  assert.equal(ready.requiresOneFinalWalletConfirmation, true);
});

await test('Iranian no-KYC CEX request fails closed without a workaround', () => {
  const result = cexEligibility({ entityCountry: 'IR', kycAvailable: false, requestsKycBypass: true, venueLicensed: false });
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'DO_NOT_OPERATE_CEX');
  assert.ok(result.blockers.includes('KYC_BYPASS_PROHIBITED'));
  assert.ok(result.blockers.includes('IRAN_SANCTIONS_LEGAL_REVIEW_REQUIRED'));
  assert.equal(result.suggestsNoKycWorkaround, false);
});

await test('all 21 evidence lessons are personal education, never fake evidence', () => {
  const board = evidenceLearningChecklist({ completed: ['simulator', 'rpc'] });
  assert.equal(board.total, 21);
  assert.equal(board.lessons.length, 21);
  assert.equal(board.completed, 2);
  assert.equal(board.lessons.every((row) => row.lessonFa && row.operationalEvidence === false), true);
});

await test('scenario catalog covers recovery, risk, fees, atomicity and CEX refusal', () => {
  const ids = autonomousScenarios().map((row) => row.id);
  for (const id of ['rpc-failure', 'route-change', 'risk-20', 'profit-loss', 'profit-positive', 'cross-chain', 'cex-iran']) assert.ok(ids.includes(id));
});

const failed = tests.filter((row) => !row.ok);
console.log(`${tests.length - failed.length}/${tests.length} passed`);
if (failed.length) process.exitCode = 1;
export default tests;
