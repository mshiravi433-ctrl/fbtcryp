import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMarketSnapshot } from '../../server/aiChatReliability.js';
import { buildExpertiseContract } from '../../server/aiExpertiseContract.js';
import { assessEvidence, evaluateDecision } from '../../server/aiDecisionGate.js';
import { buildMarketFrame } from '../../server/aiMarketFrame.js';
import { runCollaborativeAnalysis, buildSafeContextBlock } from '../../server/aiCollaboration.js';
import { normalizeYieldRows } from '../../src/lib/opportunity/feed.js';
import { scanOpportunities } from '../../src/lib/brain/opportunityEngine.js';
import { runOpportunityEngine } from '../../src/lib/intent-ai/os/opportunityEngine.js';

test('central specialist brief covers the actual signal, risk, education and social needs without promising execution', () => {
  const prompt = buildExpertiseContract({ message: 'نگرانم، لطفا توضیح بده ریسک اهرم و سیگنال ورود چطور است؟', taskTypes: ['market'] });
  for (const part of ['CENTRAL BRAIN', 'SOCIAL', 'RISK', 'SIGNALS AND OPPORTUNITIES', 'CRYPTO EDUCATOR']) assert.ok(prompt.includes(part));
  assert.match(prompt, /not.*permission to transact/i);
  assert.match(prompt, /Never invent indicators/i);
});

test('missing values and model agreement cannot turn into evidence', () => {
  const e = assessEvidence({ context: { market: { dataStatus: 'live', priceMap: { BTC: null } }, portfolio: { totalValueUsd: null } }, comparison: { agreement: '3/3' } });
  assert.equal(e.level, 'thin');
  assert.equal(e.score, 0);
  assert.ok(!e.reasons.includes('live_market') && !e.reasons.includes('portfolio'));
  assert.equal(assessEvidence({ context: { market: { dataStatus: 'stale', priceMap: { BTC: 100 } } } }).level, 'thin');
});

test('a caution or condition in one clause cannot hide a bare order in another', () => {
  const e = assessEvidence();
  for (const answer of ['نخر؛ ولی الان بخر.', 'اگر بازار افت کند صبر کن. الان بخر.', "Don't sell. Buy now."]) {
    assert.equal(evaluateDecision({ message: 'الان بخرم؟', evidence: e, answer }).compliant, false, answer);
  }
  assert.equal(evaluateDecision({ message: 'الان بخرم؟', evidence: e, answer: 'اگر داده تأیید شد، پلکانی بخر.' }).compliant, true);
  assert.equal(evaluateDecision({ message: 'الان بخرم؟', evidence: e, answer: 'توصیه نمی‌کنم بخرید.' }).compliant, true);
});

test('market cache freshness and absent values survive chat context normalization', () => {
  const empty = normalizeMarketSnapshot({ bitcoin: { usd: null, usd_24h_change: null } });
  assert.equal(empty.dataStatus, 'unavailable');
  assert.equal(empty.priceMap.BTC, null);
  assert.equal(empty.change24hPct, null);
  const stale = normalizeMarketSnapshot({ bitcoin: { usd: 10, usd_24h_change: 0 } }, true);
  assert.equal(stale.dataStatus, 'stale');
  assert.equal(stale.change24hPct, 0);
  assert.equal(normalizeMarketSnapshot({ bitcoin: { usd: 10 } }).dataStatus, 'live');
});

test('market frame retains observed details, treats nulls as unknown, and measures horizon correctly', () => {
  const frame = buildMarketFrame({ context: { market: { dataStatus: 'stale', priceMap: { BTC: 50 }, change24hPct: null,
    assets: [{ symbol: 'BTC', price: 50, change24h: 5, volume: 100 }] , ohlc: [] } }, message: 'تحلیل BTC تا سه ماه آینده' });
  assert.equal(frame.instruments[0].change24hPct, 5);
  assert.equal(frame.instruments[0].volume24hUsd, 100);
  assert.equal(frame.horizon.requestedDays, 90);
  assert.ok(frame.notSupported.includes('ohlc_history'));
  assert.match(buildSafeContextBlock({ context: { market: { dataStatus: 'stale', priceMap: { BTC: 50 } } } }), /status: stale/);
  assert.equal(buildMarketFrame({ context: {}, message: 'next year' }).horizon.requestedDays, 365);
});

test('balanced model actually receives social, risk and teaching guidance', async () => {
  const systems = [];
  await runCollaborativeAnalysis({ message: 'نگرانم لطفاً ریسک اهرم و سیگنال ورود را توضیح بده', locale: 'fa', intelligence: 'balanced', deadlineMs: 3000,
    context: { conversationSummary: 'User: ریسک من کم است' },
    analysis: { level: 2, taskTypes: ['risk', 'market'], freshness: 'STATIC', needsWeb: false, emotion: {}, fomo: {} },
    deps: { selectProviders: () => ['fake'], execute: async (_id, opts) => { systems.push(opts.system); return { text: JSON.stringify({ answer: 'اهرم زیان را نیز بزرگ می‌کند؛ بدون داده، سیگنال ورود قابل تأیید نیست.', claims: [] }) }; } }
  });
  for (const part of ['CENTRAL BRAIN', 'SOCIAL', 'RISK', 'SIGNALS AND OPPORTUNITIES', 'CRYPTO EDUCATOR', 'RESEARCH POSTURE', 'MARKET FRAME']) assert.ok(systems.some(s => s.includes(part)), part);
});

test('unreported protocol risk stays unknown instead of being assigned low risk', () => {
  const rows = normalizeYieldRows({ pools: [{ id: 'pool', project: 'aave', symbol: 'USDC', apy: 5, tvlUsd: 50_000_000 }] });
  assert.equal(rows.lendingMarkets[0].riskScore, null);
  const scan = scanOpportunities({ userCapitalUsd: 1000, riskProfile: 'MODERATE', lendingMarkets: rows.lendingMarkets });
  const row = [...scan.opportunities, ...scan.rejected].find(x => x.category === 'LENDING');
  assert.equal(row.risk.components.smartContract, null);
  assert.equal(row.risk.components.counterparty, null);
  assert.equal(row.risk.level, 'UNKNOWN');
});

test('yield IL categories are not presented as measured drawdowns', async () => {
  const scan = await runOpportunityEngine({
    overrides: { fetchMarkets: async () => [], fetchOhlc: async () => [] },
    services: { yieldService: { discover: async () => ({ ok: true, pools: [{ symbol: 'ETH-USDC', apy: 7, ilRisk: 'high' }] }) } }
  });
  const row = scan.opportunities.find(o => o.symbol === 'ETH-USDC');
  assert.equal(row.potentialDrawdownPct, null);
  assert.equal(row.risk, 'unknown');
});
