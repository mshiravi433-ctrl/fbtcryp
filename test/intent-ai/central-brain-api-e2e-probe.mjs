#!/usr/bin/env node
/**
 * FBT AI — END-TO-END EXPRESS HTTP API PROBE FOR CENTRAL BRAIN V2, SMART MEMORY, LEARNING & COUNCIL
 * ---------------------------------------------------------------------------
 * Boots the real Express application (`server/app.js`) on an ephemeral port and
 * verifies live HTTP contracts, device-owner scoping, secret scrubbing,
 * reversible learning rollback, Qdrant/Vector diagnostic endpoint, and Adaptive
 * AI Council structured outputs.
 */

import assert from 'node:assert/strict';
import app from '../../server/app.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
  }
}

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function api(path, { method = 'GET', body = undefined, device = 'fbt_e2e_device_alpha_01' } = {}) {
  const headers = { 'x-fbt-device': device };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json() };
}

console.log('\n=== FBT AI — LIVE EXPRESS HTTP API E2E PROBE ===\n');

try {
  await test('GET /api/v1/ai/central-brain/status & /api/brain/central-brain/status publish all 10 capabilities & 8 council roles', async () => {
    const r1 = await api('/api/v1/ai/central-brain/status');
    assert.equal(r1.status, 200);
    assert.equal(r1.json.ok, true);
    assert.equal(r1.json.capabilities.length, 10);
    assert.equal(r1.json.councilSpecialists.length, 8);
    assert.equal(r1.json.laws.neverCallsAllModelsUnnecessarily, true);
    assert.equal(r1.json.laws.baseModelsModified, false);
    assert.equal(r1.json.laws.executionAuthorized, false);

    const r2 = await api('/api/brain/central-brain/status');
    assert.equal(r2.status, 200);
    assert.equal(r2.json.ok, true);
  });

  await test('POST /api/v1/ai/smart-memory/qdrant/test verifies operational vector database & 384-dim cross-lingual semantics', async () => {
    const r = await api('/api/v1/ai/smart-memory/qdrant/test', {
      method: 'POST',
      body: { dim: 384 }
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });

  await test('Smart Memory HTTP API: profile, conversation, semantic search, private agent isolation & owner isolation', async () => {
    // Store goal & preference via conversation for device A
    const c = await api('/api/v1/ai/smart-memory/conversation', {
      method: 'POST',
      device: 'device_owner_alpha_999',
      body: {
        userMessage: 'هدفم رسیدن به ۲۵ هزار دلار در ۱۲ ماه است و ریسک کم می‌خواهم و بدون اهرم معامله می‌کنم.',
        assistantReply: 'پروفایل شما ثبت شد.'
      }
    });
    assert.equal(c.json.ok, true);

    const prof = await api('/api/v1/ai/smart-memory/profile', { device: 'device_owner_alpha_999' });
    assert.equal(prof.json.ok, true);
    assert.equal(prof.json.preferencesMap.riskTolerance, 'CONSERVATIVE');
    assert.equal(prof.json.preferencesMap.leveragePolicy, 'NO_LEVERAGE_SPOT_ONLY');

    // Other device sees empty profile!
    const otherProf = await api('/api/v1/ai/smart-memory/profile', { device: 'device_owner_bravo_888' });
    assert.equal(otherProf.json.goals.length, 0);

    // Semantic search
    const srch = await api('/api/v1/ai/smart-memory/search', {
      method: 'POST',
      device: 'device_owner_alpha_999',
      body: { query: 'conservative low risk savings goal without leverage' }
    });
    assert.equal(srch.json.ok, true);
    assert.ok(srch.json.rows.length >= 1);

    // Agent private memory isolation over HTTP
    await api('/api/v1/ai/smart-memory/agent/technical_analyst', {
      method: 'POST',
      device: 'device_owner_alpha_999',
      body: { note: 'ETH 4h structure above EMA200', assets: ['ETH'] }
    });
    const denied = await api('/api/v1/ai/smart-memory/agent/technical_analyst?requesterAgentId=macro_news_analyst', {
      device: 'device_owner_alpha_999'
    });
    assert.equal(denied.json.ok, false);
    assert.equal(denied.json.error, 'AGENT_PRIVATE_MEMORY_ISOLATED');
  });

  await test('Central Brain & Adaptive AI Council HTTP API: dynamic selection, full council run, traces & secret refusal', async () => {
    // Secret refusal check
    const secretTry = await api('/api/v1/ai/central-brain/run', {
      method: 'POST',
      body: { message: 'این کلید خصوصی من است: 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318' }
    });
    assert.equal(secretTry.json.ok, false);
    assert.equal(secretTry.json.error, 'SENSITIVE_INPUT_REFUSED');

    // Dynamic Council Convene on multi-domain strategy question
    const conv = await api('/api/v1/ai/council/convene', {
      method: 'POST',
      device: 'device_owner_alpha_999',
      body: {
        message: 'با توجه به تحلیل تکنیکال، جریان نهنگ‌های اسمارت‌مانی و اخبار اقتصاد کلان، برای خرید ETH چه تصمیمی بگیریم؟',
        evidence: [
          { facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed', summary: { assets: [{ symbol: 'ETH', price: 3320, change24h: 3.1 }] } },
          { facetId: 'smart_money', tool: 'fbt_get_signals', status: 'observed', summary: { signal: 'whale accumulation inflow' } },
          { facetId: 'news_flow', tool: 'fbt_get_news', status: 'observed', summary: { headlines: ['Institutional ETH ETF demand steady'] } }
        ]
      }
    });
    assert.equal(conv.status, 200);
    assert.equal(conv.json.ok, true);
    assert.ok(Array.isArray(conv.json.memberOpinions) && conv.json.memberOpinions.length >= 4);
    assert.ok(Array.isArray(conv.json.evidenceUsed) && conv.json.evidenceUsed.length === 3);
    assert.ok(Array.isArray(conv.json.pointsOfAgreement));
    assert.ok(Array.isArray(conv.json.pointsOfDisagreement));
    assert.ok(typeof conv.json.confidence?.score === 'number');
    assert.ok(conv.json.finalDecision?.action);
    assert.ok(Array.isArray(conv.json.decisionReasons) && conv.json.decisionReasons.length >= 1);
    assert.equal(conv.json.executionAuthorized, false);

    // Decision trace retrieval
    const traces = await api('/api/v1/ai/central-brain/traces', { device: 'device_owner_alpha_999' });
    assert.equal(traces.json.ok, true);
    assert.ok(traces.json.traces.length >= 1);
    assert.equal(traces.json.traces[0].stageCount, 10);
  });

  await test('Performance Learning HTTP API: record prediction, evaluate outcome, inspect metrics & rollback policy', async () => {
    const pred = await api('/api/v1/ai/learning/predictions', {
      method: 'POST',
      device: 'device_owner_alpha_999',
      body: {
        question: 'SOL short-term direction',
        asset: 'SOL',
        taskType: 'TECHNICAL_ANALYSIS',
        predictedDirection: 'BULLISH',
        predictedMovePct: 4.0,
        confidence: 80,
        entryPrice: 180,
        modelVotes: [
          { provider: 'deepseek', direction: 'BULLISH', confidence: 82 },
          { provider: 'groq', direction: 'BEARISH', confidence: 75 }
        ],
        agentVotes: [
          { agentId: 'technical_analyst', direction: 'BULLISH', confidence: 80 },
          { agentId: 'risk_specialist', direction: 'BEARISH', confidence: 78 }
        ]
      }
    });
    assert.equal(pred.json.ok, true);

    const ev = await api('/api/v1/ai/learning/evaluate', {
      method: 'POST',
      device: 'device_owner_alpha_999',
      body: { predictionId: pred.json.predictionId, actualPrice: 171 } // -5% drop
    });
    assert.equal(ev.json.ok, true);
    assert.equal(ev.json.evaluation.hit, false);
    assert.ok(ev.json.evaluation.postmortem.reasonCodes.includes('IGNORED_RISK_OR_CRITIC_WARNING'));

    const metrics = await api('/api/v1/ai/learning/metrics?scope=global');
    assert.equal(metrics.json.ok, true);
    assert.equal(metrics.json.baseModelsModified, false);
    assert.ok(metrics.json.models.length >= 2);

    const rb = await api('/api/v1/ai/learning/rollback', {
      method: 'POST',
      body: { versionId: 'baseline' }
    });
    assert.equal(rb.json.ok, true);
    assert.equal(rb.json.restoredVersion, 'baseline');
  });
} finally {
  await new Promise((r) => server.close(r));
}

console.log(`\n=== LIVE EXPRESS HTTP API E2E PROBE: ${passed}/${passed + failed} passed ===\n`);
if (failed > 0) process.exit(1);
