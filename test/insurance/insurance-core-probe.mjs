/**
 * FBT Insurance OS — core flow probe (end-to-end over the engines, no HTTP).
 *
 * Exercises: discovery → quote → purchase-intent → prepared tx → activation →
 * coverage list/dashboard → incident detection → claim → submit → decide →
 * payout verification → idempotency (no duplicate) → provider fallback/health.
 * Runs entirely against the sandbox providers.
 */
import assert from 'node:assert/strict';
import { setupProviders, listConfiguredProviderIds } from '../../server/insurance/adapters/index.js';
import { listProviders } from '../../server/insurance/provider-registry.js';
import * as service from '../../server/insurance/service.js';
import * as coverageApi from '../../server/insurance/coverage.js';
import * as claimsApi from '../../server/insurance/claims.js';
import * as monitoring from '../../server/insurance/monitoring.js';
import { protectPortfolio } from '../../server/insurance/protect-portfolio.js';
import { analysePortfolioRisk } from '../../server/insurance/risk-engine.js';
import { toMicro } from '../../server/insurance/constants.js';

let pass = 0;
function ok(name) { pass += 1; console.log('  ✓', name); }

const WALLET = '0x1111111111111111111111111111111111111111';

async function main() {
  setupProviders();
  ok('configured sandbox providers exist: ' + listConfiguredProviderIds().join(','));

  const providers = listProviders();
  assert.ok(providers.length >= 3, 'registry should list evm/solana sandbox + nexus stub');
  ok('provider registry lists ' + providers.length + ' providers');

  // products discovery
  const products = await service.discoverProducts({ chainId: 56 });
  assert.ok(products.length >= 8, 'products on chain 56');
  ok(`discovery returns ${products.length} sandbox products on chain 56`);

  // health
  const health = await service.probeAllProviders();
  ok('provider health probe ran for ' + health.length + ' providers');

  // quote across providers
  const quoteRes = await service.aggregateQuotes({
    walletAddress: WALLET, chainId: 56, protectionType: 'smart-contract',
    coverageAmountMicro: toMicro('10000'), durationDays: 30
  });
  assert.ok(quoteRes.ok && quoteRes.quotes.length >= 1, 'at least one quote');
  const quote = quoteRes.quotes[0];
  assert.ok(quote.quoteId && quote.expiresAt > Date.now());
  assert.ok(quote.termsHash && quote.totalCostMicro !== undefined);
  assert.ok(typeof quote.totalCostUsd === 'string');
  ok(`quote ${quote.quoteId}: premium $${quote.premiumUsd} total $${quote.totalCostUsd} from ${quote.provider}`);

  // quote expiry validation
  const fresh = await service.getQuote(quote.quoteId);
  assert.ok(fresh.ok === true);
  ok('quote is currently valid');

  // purchase intent + prepared unsigned tx (non-custodial)
  const intent = await coverageApi.createPurchaseIntent({ quoteId: quote.quoteId, walletAddress: WALLET, idempotencyKey: 'test-purchase-0001' });
  assert.ok(intent.coverageId && intent.prepared?.unsigned === true && intent.prepared?.to);
  ok(`purchase intent ${intent.coverageId} -> prepared unsigned tx to ${intent.prepared.to}`);

  // idempotency: repeat must NOT create a duplicate
  const again = await coverageApi.createPurchaseIntent({ quoteId: quote.quoteId, walletAddress: WALLET, idempotencyKey: 'test-purchase-0001' });
  assert.ok(again.coverageId === intent.coverageId && again.replayed === true);
  ok('idempotent purchase replay returns the SAME coverage (no duplicate)');

  // activate with sandbox on-chain verification
  const activated = await coverageApi.activateCoverage({ coverageId: intent.coverageId, owner: WALLET, txHash: '0xabc123sandboxtx', chainId: 56 });
  assert.equal(activated.coverage.status, 'ACTIVE');
  ok(`coverage ACTIVE until ${new Date(activated.coverage.expiresAt).toISOString()}`);

  // coverage list + dashboard
  const covers = await coverageApi.listCoverages(WALLET);
  assert.ok(covers.some((c) => c.coverageId === intent.coverageId));
  const dash = await coverageApi.dashboard(WALLET);
  assert.equal(dash.activeCovers, 1);
  ok(`dashboard: ${dash.activeCovers} active cover, total protected $${dash.totalProtectedUsd}`);

  // incident detection -> matches the active coverage (potential only)
  const incident = await monitoring.registerIncident({ protectionType: 'smart-contract', chainId: 56, severity: 'HIGH', description: 'test exploit on covered protocol' });
  assert.ok(incident.matched.some((m) => m.coverageId === intent.coverageId));
  ok('incident detection flagged matching coverage (never auto-claims): matched=' + incident.matched.length);

  // claim
  const claim = await claimsApi.createClaim({
    coverageId: intent.coverageId, owner: WALLET, incidentType: 'smart-contract-exploit',
    description: 'covered protocol exploited', affectedAmountMicro: toMicro('5000'), evidenceHash: '0x'+ 'ab'.repeat(32)
  });
  assert.equal(claim.status, 'DRAFT');
  ok(`claim ${claim.claimNumber} created (DRAFT)`);

  const submitted = await claimsApi.submitClaim({ claimId: claim.claimId, owner: WALLET });
  assert.ok(['SUBMITTED', 'UNDER_REVIEW'].includes(submitted.status));
  ok(`claim submitted -> ${submitted.status}`);

  const approved = await claimsApi.decideClaim({ claimId: claim.claimId, decision: 'APPROVED', payoutAmountMicro: toMicro('5000'), actor: 'admin-test' });
  assert.equal(approved.status, 'APPROVED');
  ok(`claim APPROVED, approved payout $${approved.approvedPayoutUsd}`);

  // payout must be verified on chain before PAID
  const payout = await claimsApi.recordPayout({ claimId: claim.claimId, txHash: '0xpayoutsim1', amountMicro: toMicro('5000'), chainId: 56 });
  assert.equal(payout.claim.status, 'PAID');
  ok(`payout independently verified -> claim PAID $${payout.claim.payoutUsd}`);

  // payout idempotency: replaying same payout tx returns same result
  const payoutAgain = await claimsApi.recordPayout({ claimId: claim.claimId, txHash: '0xpayoutsim1', amountMicro: toMicro('5000'), chainId: 56 });
  assert.ok(payoutAgain.claim.status === 'PAID');
  ok('payout recording is idempotent');

  // risk + coverage gap + recommendation (never executes)
  const risk = analysePortfolioRisk({
    exposures: [
      { kind: 'smartContract', amountMicro: toMicro('8000'), chainId: 56 },
      { kind: 'stablecoin', amountMicro: toMicro('4000'), chainId: 56 },
      { kind: 'lp', amountMicro: toMicro('3000'), chainId: 56 }
    ],
    activeCoverage: [{ kind: 'smartContract', amountMicro: toMicro('10000') }]
  });
  assert.ok(risk.overallRiskBand);
  ok(`risk engine: exposure $${risk.totalExposureUsd}, gap $${risk.coverageGapUsd}, band ${risk.overallRiskBand}`);

  const rec = await protectPortfolio({
    walletAddress: WALLET, chainId: 56, durationDays: 30,
    exposures: [
      { kind: 'smartContract', amountMicro: toMicro('8000'), chainId: 56 },
      { kind: 'stablecoin', amountMicro: toMicro('4000'), chainId: 56 },
      { kind: 'lp', amountMicro: toMicro('3000'), chainId: 56 }
    ]
  });
  assert.equal(rec.autoExecute, false);
  assert.ok(Array.isArray(rec.recommendations));
  ok(`PROTECT_PORTFOLIO returned ${rec.recommendations.length} recommendation(s), autoExecute=false`);

  console.log(`\nPASS ${pass} insurance-core assertions`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e); process.exit(1); });
