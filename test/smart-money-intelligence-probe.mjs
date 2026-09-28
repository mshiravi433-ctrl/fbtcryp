#!/usr/bin/env node
/** Receipt → qualification → independent consensus → FIOS/Intent/opportunity.
 * No live API or credentials required. Run: node test/smart-money-intelligence-probe.mjs */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

import assert from 'node:assert/strict';
import { analyzePerformance, reconstructSwaps } from '../server/smartMoney/performance.js';
import { buildConsensus } from '../server/smartMoney/consensus.js';
import { verifiedSignals, verifiedToken } from '../src/lib/smartMoneyEvidence.js';
import { runOpportunityEngine } from '../src/lib/intent-ai/os/opportunityEngine.js';
import { buildSmartMoneyIntel, smartMoneyKindBias } from '../server/fios/smartMoneyIntel.js';
import { createMonitor, evaluateMonitor, normalizeMonitor } from '../server/intentMonitoring.js';
import { putWatchlist, runAlertCycle } from '../server/smartMoney/watchlist.js';
import { runIntelligenceCycle } from '../server/smartMoney/intelligence.js';
import { runSmartMoneyCadence } from '../server/smartMoney/cadence.js';
import { smartMoneyMonitorHandoff, narrateIntelligence } from '../server/smartMoney/narration.js';
import { verifiedFixture, walletReceipts, TOKEN } from './fixtures/verifiedSmartMoney.mjs';

const now = Date.now();
const wallet = `0x${'1'.repeat(40)}`;
const history = walletReceipts(wallet, { now });
const qualified = analyzePerformance(history);
assert.equal(qualified.smartMoney.qualified, true);
assert.ok(qualified.smartMoney.score >= 70);
assert.equal(qualified.performance.closedTrades, 6);
assert.equal(qualified.pnl.realizedUsd, 300_000);
assert.equal(qualified.swaps.length, 12);
assert.equal(analyzePerformance({ ...history, historyLive: false }).smartMoney.status, 'UNAVAILABLE');
assert.equal(analyzePerformance({ ...history, historyLive: false }).smartMoney.score, null);
assert.equal(analyzePerformance({ ...history, historyLive: false }).smartMoney.qualified, false);
assert.equal(analyzePerformance({ ...history, transfers: history.transfers.slice(0, 2) }).smartMoney.score, null);
// A lone router transfer, unknown fake "USDC", failed tx or unpaired ERC20
// cannot become a verified trade (nor a profitable position).
assert.deepEqual(reconstructSwaps({ ...history, transfers: [history.transfers[1]] }), []);
assert.deepEqual(reconstructSwaps({ ...history, transactions: history.transactions.map((t) => ({ ...t, success: false })) }), []);
assert.deepEqual(reconstructSwaps({ ...history, transfers: history.transfers.map((tr) =>
  tr.token.symbol === 'USDC' ? { ...tr, token: { address: `0x${'9'.repeat(40)}`, symbol: 'USDC' } } : tr) }), []);

const addresses = [4, 5, 6, 7, 8].map((n) => `0x${String(n).repeat(40)}`);
const checked = [];
const probeWallet = async (address, chain) => {
  checked.push(address);
  return { address, chain, smartMoney: { status: 'INSUFFICIENT_EVIDENCE',
    score: null, qualified: false }, performance: { closedTrades: 0 }, verifiedSwaps: [] };
};
await runIntelligenceCycle({ now, candidates: addresses.map((address) => ({ chain: 1, address })),
  analyze: probeWallet, maxWallets: 2 });
await runIntelligenceCycle({ now: now + 1_000, candidates: addresses.map((address) => ({ chain: 1, address })),
  analyze: probeWallet, maxWallets: 2 });
assert.equal(checked.length, 4);
assert.equal(new Set(checked).size, 4, 'the index must not repeatedly consume its budget on the same first two wallets');

const sell = verifiedFixture({ now });
assert.equal(smartMoneyMonitorHandoff(`Alert me if smart money sells ${TOKEN} on Base`).route,
  `/intent?smMonitor=sell&smChain=8453&smToken=${TOKEN}`);
assert.equal(smartMoneyMonitorHandoff('Monitor smart money buying TEST').ready, false);
assert.equal(smartMoneyMonitorHandoff('What did smart money buy?'), null);
assert.equal(smartMoneyMonitorHandoff(`پایش پول هوشمند شبکه 1 قرارداد ${TOKEN}`).ready, true);
assert.equal(narrateIntelligence({ consensus: [], indexedAt: now }, { message: 'smart money?' }).dataStatus,
  'insufficient-evidence');
const buy = verifiedFixture({ now, window: '30m', buyRecently: true });
assert.equal(sell.snapshot.consensus[0].signal, 'DISTRIBUTION');
assert.equal(sell.snapshot.consensus[0].netFlowUsd, -3_600_000);
assert.equal(verifiedSignals(sell.snapshot, { now }).netFlowUsd, -3_600_000);
assert.equal(verifiedToken(sell.snapshot, 1, TOKEN, { now })?.confidence, 80);
assert.equal(verifiedToken(sell.snapshot, 56, TOKEN, { now }), null);
assert.equal(verifiedToken(sell.snapshot, 1, `0x${'2'.repeat(40)}`, { now }), null);
assert.equal(buy.snapshot.consensus[0].signal, 'ACCUMULATION');
assert.equal(buy.snapshot.consensus[0].independentBuyers, 3);
assert.ok(sell.snapshot.graph.edges.every((e) => e.evidence === 'paired-explorer-transfers' && e.hashes.length));
assert.equal(verifiedSignals({ ...sell.snapshot, indexedAt: now - 37 * 3_600_000 }, { now }).netFlowUsd, null);
assert.equal(verifiedSignals({ ...sell.snapshot, consensus: [] }, { now }).dataStatus, 'insufficient-evidence');

const funder = `0x${'f'.repeat(40)}`;
const linked = sell.profiles.slice(0, 2).map((p) => ({ chainId: 1, flow: 'transfer', valueUsd: 50_000,
  from: { address: funder }, to: { address: p.address } }));
const clustered = buildConsensus({ profiles: sell.profiles, swaps: sell.swaps,
  events: linked, now, indexedAt: now - 1_000 });
assert.equal(clustered.graph.fundingLinks.length, 1);
assert.equal(clustered.graph.fundingLinks[0].ownership, 'unknown');
assert.equal(clustered.consensus[0].signal, 'INSUFFICIENT_EVIDENCE');
assert.equal(verifiedSignals(clustered, { now }).netFlowUsd, null);
assert.equal(verifiedSignals(buildConsensus({ profiles: sell.profiles, swaps: sell.swaps.slice(0, 4),
  now, indexedAt: now - 1_000 }), { now }).netFlowUsd, null);

const proxyOverview = { dataStatus: 'live', at: now, window: '24h',
  metrics: { accumulation: { valueUsd: 9_000_000 }, netFlow: { value: 9_000_000 } },
  tokenActivity: [{ symbol: 'TEST', netUsd: 9_000_000, signal: 'ACCUMULATION' }] };
const proxy = buildSmartMoneyIntel(proxyOverview, { now });
assert.equal(proxy.signals.netFlowUsd, null);
assert.equal(proxy.alignment, null);
assert.equal(smartMoneyKindBias('DCA_IN', proxy), null);
const verified = buildSmartMoneyIntel({ ...proxyOverview, verified: sell.snapshot }, { now });
assert.equal(verified.signals.netFlowUsd, -3_600_000);
assert.equal(verified.signals.whaleTransferNetUsd, 9_000_000);
assert.ok(smartMoneyKindBias('RISK_REDUCTION', verified) > smartMoneyKindBias('DCA_IN', verified));

const scan = (payload) => runOpportunityEngine({ limit: 5, overrides: {
  fetchMarkets: async () => [], fetchOhlc: async () => [], fetchVerifiedIntelligence: async () => payload
} });
const opportunity = await scan(sell.snapshot);
assert.equal(opportunity.opportunities[0].kind, 'SMART_MONEY');
assert.equal(opportunity.opportunities[0].address, TOKEN);
assert.equal(opportunity.opportunities[0].chainId, 1);
assert.equal(opportunity.opportunities[0].signal, 'DISTRIBUTION');
assert.equal(opportunity.opportunities[0].expectedReturnPct, null);
assert.equal(opportunity.opportunities[0].probabilityPct, null);
assert.equal(opportunity.opportunities[0].risk, 'unknown');
assert.equal(opportunity.opportunities[0].guaranteed, false);
assert.equal((await scan(proxyOverview)).opportunities.length, 0);
assert.equal((await scan({ ...sell.snapshot, indexedAt: now - 37 * 3_600_000 })).opportunities.length, 0);

const target = { chain: 1, token: TOKEN };
assert.equal(normalizeMonitor({ metric: 'SMART_MONEY_NET', operator: 'BELOW', threshold: -3_000_000 }).error, 'BAD_SM_TARGET');
assert.equal(normalizeMonitor({ metric: 'SMART_MONEY_NET', smartTarget: target, threshold: 0 }).error, 'BAD_THRESHOLD');
const toMonitor = (metric, threshold, extra = {}) => createMonitor(`probe:sm:${metric}`, {
  metric, asset: { symbol: 'TEST' }, operator: metric === 'SMART_MONEY_NET' ? 'BELOW' : 'ABOVE',
  threshold, smartTarget: target, intervalMinutes: 30, ...extra
}, { now });
const net = (await toMonitor('SMART_MONEY_NET', -3_000_000)).monitor;
assert.equal(net.smartTarget.token, TOKEN);
const bad = await evaluateMonitor(net, { now, fetchSmartMoney: async () => ({
  ...sell.snapshot, indexedAt: now - 37 * 3_600_000
}) });
assert.equal(bad.triggered, false);
assert.equal(bad.monitor.eventCount, 0);
assert.equal(bad.error, 'INSUFFICIENT_VERIFIED_SWAPS');
const netHit = await evaluateMonitor(net, { now, fetchSmartMoney: async () => sell.snapshot });
assert.equal(netHit.triggered, true);
assert.equal(netHit.monitor.lastEvent.kind, 'SMART_MONEY');
assert.equal(netHit.monitor.lastEvent.evidence.token, TOKEN);
assert.equal(netHit.monitor.lastEvent.sent, false);

const buyers = (await toMonitor('SMART_MONEY_BUYERS', 3)).monitor;
const buyerHit = await evaluateMonitor(buyers, { now, fetchSmartMoney: async ({ window }) => {
  assert.equal(window, '30m'); return buy.snapshot;
} });
assert.equal(buyerHit.triggered, true);
assert.equal(buyerHit.monitor.lastEvent.evidence.independentBuyers, 3);

const rev = (await toMonitor('SMART_MONEY_REVERSAL', 1, { reversal: {
  fromUsd: 2_000_000, toUsd: -3_000_000
} })).monitor;
const positive = verifiedFixture({ now, buyRecently: true }).snapshot;
const armed = await evaluateMonitor(rev, { now, fetchSmartMoney: async () => positive });
assert.equal(armed.triggered, false);
assert.equal(armed.monitor.lastValue, 3_000_000);
const later = now + 10 * 60_000;
const negative = verifiedFixture({ now: later }).snapshot;
const reversed = await evaluateMonitor(armed.monitor, { now: later, fetchSmartMoney: async () => negative });
assert.equal(reversed.triggered, true);
assert.equal(reversed.monitor.lastEvent.evidence.netFlowUsd, -3_600_000);

const identity = 'sm-probe-device-identity';
await putWatchlist(identity, [{ chain: 1, address: TOKEN, target: 'token',
  types: ['CONSENSUS_BUY', 'NETFLOW_REVERSAL'] }]);
const sent = [];
const push = await runAlertCycle(async (_id, _lang, payload) => { sent.push(payload); return true; },
  { now, events: [], intelligence: buy.snapshot });
assert.equal(push.fired, 1);
assert.equal(push.delivered, 1);
assert.equal(sent[0].alert.evidence.classification, 'verified-paired-swaps');
const repeat = await runAlertCycle(async () => { throw new Error('duplicate'); },
  { now, events: [], intelligence: buy.snapshot });
assert.equal(repeat.fired, 0);

// A stalled explorer index must not hold existing watch deliveries. Timeouts
// must report UNKNOWN, not a fictitious success or a false zero-event count.
const order = [];
const cadence = await runSmartMoneyCadence({
  alerts: async () => { order.push('alerts'); return { checked: 2, fired: 1, delivered: 1 }; },
  intelligence: async () => { order.push('index'); return { status: 'sampled' }; }
});
assert.deepEqual(order, ['alerts', 'index']);
assert.equal(cadence.delivered, 1);
assert.equal(cadence.intelligence.status, 'sampled');
const delayedIndex = await runSmartMoneyCadence({
  alerts: async () => ({ checked: 1, fired: 1, delivered: 1 }),
  intelligence: () => new Promise(() => {}), indexBudgetMs: 5
});
assert.equal(delayedIndex.delivered, 1);
assert.equal(delayedIndex.intelligence.status, 'time-budget-exceeded');
const delayedAlerts = await runSmartMoneyCadence({
  alerts: () => new Promise(() => {}), alertBudgetMs: 5,
  intelligence: async () => ({ status: 'sampled' })
});
assert.equal(delayedAlerts.status, 'time-budget-exceeded');
assert.equal(delayedAlerts.delivered, null);
assert.equal(delayedAlerts.intelligence.status, 'sampled');

console.log('Smart Money evidence, clustering, FIOS, Opportunity and Intent: all checks passed');
