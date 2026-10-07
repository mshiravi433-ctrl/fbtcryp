#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — TOOL BROKER probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The broker is the orchestrator's ONLY way to touch the world, so it is tested
 * as a security boundary first and as a fetcher second:
 *
 *   · read-only by construction — every catalogue entry declares `read`, the
 *     executor refuses anything else, and every MCP descriptor says
 *     readOnlyHint:true with no execution-ish name;
 *   · the day-to-day discipline: dedupe, per-turn cap, deadline, per-tool
 *     timeouts and a loop guard (the same class of protection the central tool
 *     router applies to modules);
 *   · a failed read is REPORTED (observed/degraded/unavailable + provenance),
 *     never silently dropped — the judge needs to know what is missing;
 *   · a high-cost tool stays off unless the operator turns it on;
 *   · provenance is present on every row, so an answer can always say where a
 *     number came from.
 *
 * Everything is injected: the central tool router, the macro desk, the
 * smart-money desk and the RAG memory are fakes here, so the probe is offline,
 * deterministic and does not care which providers are configured.
 *
 * Run: npm run test:upgrade14-broker
 */
import assert from 'node:assert/strict';
import {
  toolCatalogue, executeToolRequests, listTools, mcpToolDescriptors,
  EXECUTION_TOOL_NAMES, TOOL_BROKER_SCHEMA, _resetToolLoopMemory
} from '../../server/aiToolBroker.js';
import { FORBIDDEN_NAME_RE } from '../../mcp/src/tools.mjs';

const results = [];
const t = async (name, fn) => {
  try { await fn(); results.push([name, true, '']); }
  catch (error) { results.push([name, false, String(error?.message || error).slice(0, 260)]); }
};

/* A fake central tool router: the only dependency the broker reads through. */
function makeRunTool({ fail = [], hang = [] } = {}) {
  const calls = [];
  const runTool = async ({ module, operation, input }) => {
    calls.push({ module, operation, input });
    if (hang.includes(module)) return new Promise(() => {});
    if (fail.includes(module)) return { ok: false, status: 'CAPABILITY_UNAVAILABLE', error: 'MODULE_UNAVAILABLE' };
    switch (module) {
      case 'markets':
        return { ok: true, status: 'OK', result: { count: 2, coins: [{ symbol: 'BTC', priceUsd: 63250.5, change24hPct: 1.8 }, { symbol: 'ETH', priceUsd: 3100.2, change24hPct: -0.4 }], staleness: { stale: false } } };
      case 'signals':
        return { ok: true, status: 'OK', result: { rows: [{ symbol: String(input.asset || 'BTC').toUpperCase(), momentum: 'up', volatility: 'medium', priceUsd: 63250.5, change24hPct: 1.8, basis: 'momentum from market read' }] } };
      case 'portfolio':
        return { ok: true, status: 'OK', result: { totalValueUsd: 1200, partial: false, holdings: [{ symbol: 'ETH', amount: 0.25, valueUsd: 800 }, { symbol: 'BTC', amount: 0.005, valueUsd: 316 }] } };
      case 'wallet':
        return { ok: true, status: 'OK', result: { connected: true, chains: ['ethereum', 'solana'], evmAddresses: ['0x1234567890abcdef1234567890abcdef12345678'], solanaAddresses: [] } };
      case 'news':
        return { ok: true, status: 'OK', result: { filteredByAsset: null, items: [{ title: 'ETF inflows continue', source: 'fbt', at: 1700000000000 }] } };
      case 'farming':
        return { ok: true, status: 'OK', result: { rows: [{ project: 'aave-v3', symbol: 'USDC', chain: 'ethereum', apy: 4.2, tvlUsd: 1000000 }] } };
      case 'transactions':
        return { ok: true, status: 'OK', result: { rows: [] } };
      default:
        return { ok: false, status: 'NOT_REGISTERED', error: `no module ${module}` };
    }
  };
  return { runTool, calls };
}

const depsWith = (extra = {}) => ({
  fetchMacroQuotes: async () => ([{ symbol: 'DXY', value: 104.2, changePct: 0.1 }, { symbol: 'GOLD', value: 2410.5, changePct: -0.2 }]),
  getVerifiedIntelligence: async () => ({ dataStatus: 'observed', coverage: { assets: 12 }, consensus: [{ asset: 'BTC', side: 'accumulation', score: 0.72, wallets: 9 }] }),
  rag: {
    async recall() {
      return { ok: true, passages: [{ cite: 'kb.swap.howto', title: 'سواپ چگونه کار می‌کند؟', text: 'کارمزد سواپ بخشی از مبلغ معامله است.', score: 0.7, kind: 'knowledge' }], stats: { backend: 'local' } };
    }
  },
  ...extra
});

const marketRequest = { facetId: 'market_prices', tool: 'fbt_get_market_snapshot', cost: 'low', priority: 90 };
const portfolioRequest = { facetId: 'portfolio_state', tool: 'fbt_get_portfolio', cost: 'low', priority: 95 };

/* ── 1. the boundary ────────────────────────────────────────────────────── */

await t('every catalogue entry is a read, with a schema and a timeout', async () => {
  const cat = toolCatalogue();
  assert.ok(cat.length >= 10, `expected the ten reads, got ${cat.length}`);
  for (const tool of cat) {
    assert.equal(tool.sideEffects, 'read', `${tool.name} must be read-only`);
    assert.ok(tool.inputSchema && tool.inputSchema.type === 'object', `${tool.name} needs an input schema`);
    assert.ok(tool.timeoutMs > 0 && tool.timeoutMs <= 10_000, `${tool.name} needs a sane timeout`);
    assert.ok(!FORBIDDEN_NAME_RE.test(tool.name), `${tool.name} impersonates an execution tool`);
  }
  assert.deepEqual(EXECUTION_TOOL_NAMES.length, 10);
});

await t('an execution tool cannot even be requested: it is not in the catalogue', async () => {
  const { runTool, calls } = makeRunTool();
  const out = await executeToolRequests({
    requests: [{ facetId: 'swap', tool: 'fbt_swap_now', cost: 'low' }],
    turnCtx: { owner: 'dev:probe' }, deadlineMs: 2000, deps: { runTool }
  });
  assert.equal(out.rows[0].status, 'unavailable');
  assert.equal(out.rows[0].reason, 'TOOL_NOT_REGISTERED');
  assert.equal(calls.length, 0, 'nothing may reach the module layer');
  assert.equal(out.canExecute, false);
  assert.equal(out.readOnly, true);
  assert.equal(out.schema, TOOL_BROKER_SCHEMA);
});

await t('the MCP projection advertises the same reads, never an execution', async () => {
  const descriptors = mcpToolDescriptors();
  assert.equal(descriptors.length, listTools().length);
  for (const d of descriptors) {
    assert.equal(d.annotations.readOnlyHint, true);
    assert.equal(d.annotations.destructiveHint, false);
    assert.ok(d.inputSchema.type === 'object');
    assert.ok(!FORBIDDEN_NAME_RE.test(d.name));
    assert.ok(['public', 'owner', 'read_network'].includes(d['x-fbt-scope']));
  }
});

/* ── 2. the reads actually work through the module layer ───────────────── */

await t('a market read returns observed rows with provenance and no secrets', async () => {
  const { runTool } = makeRunTool();
  const out = await executeToolRequests({ requests: [marketRequest], turnCtx: { owner: 'dev:probe' }, deadlineMs: 3000, deps: { runTool, ...depsWith() } });
  const row = out.rows[0];
  assert.equal(row.status, 'observed');
  assert.equal(row.summary.rows[0].symbol, 'BTC');
  assert.equal(row.summary.rows[0].priceUsd, 63250.5);
  assert.equal(row.provenance.tool, 'fbt_get_market_snapshot');
  assert.ok(row.provenance.via);
  assert.equal(out.observed, 1);
});

await t('the owner is passed to the module layer; the client data is not', async () => {
  const { runTool, calls } = makeRunTool();
  await executeToolRequests({
    requests: [portfolioRequest],
    turnCtx: { owner: 'dev:probe', clientData: { portfolio: { totalValueUsd: 1200 }, secret: 'nope' } },
    deadlineMs: 3000, deps: { runTool, ...depsWith() }
  });
  assert.equal(calls[0].input.owner, 'dev:probe');
  assert.ok(!JSON.stringify(calls[0].input).includes('nope'), 'client data must not be forwarded wholesale');
});

await t('all ten reads answer through their real code paths', async () => {
  const { runTool } = makeRunTool();
  /* First gather: the eight desk reads (the executor's hard ceiling is 8 per
     turn, so a turn never turns into a crawl through every data source). */
  const first = await executeToolRequests({
    requests: [
      marketRequest,
      { facetId: 'asset_regime', tool: 'fbt_get_signals', cost: 'low' },
      portfolioRequest,
      { facetId: 'wallet_state', tool: 'fbt_get_wallet_state', cost: 'low' },
      { facetId: 'news_flow', tool: 'fbt_get_news', cost: 'medium' },
      { facetId: 'yield_rates', tool: 'fbt_get_yields', cost: 'medium' },
      { facetId: 'macro_state', tool: 'fbt_get_macro', cost: 'high' },
      { facetId: 'smart_money', tool: 'fbt_get_smart_money', cost: 'medium' }
    ],
    turnCtx: { owner: 'dev:probe', question: 'قیمت بیت‌کوین؟', locale: 'fa', token: 'BTC', turnId: 't1', clientData: { portfolio: { totalValueUsd: 1200 } } },
    deadlineMs: 6000, maxTools: 8, allowHighCost: true, deps: { runTool, ...depsWith() }
  });
  const byFacet = new Map(first.rows.map((r) => [r.facetId, r]));
  assert.equal(first.rows.length, 8);
  assert.equal(byFacet.get('market_prices').status, 'observed');
  assert.equal(byFacet.get('asset_regime').status, 'observed');
  assert.equal(byFacet.get('portfolio_state').status, 'observed');
  assert.equal(byFacet.get('wallet_state').status, 'observed');
  assert.equal(byFacet.get('wallet_state').summary.evmAddresses[0].includes('…'), true, 'addresses are truncated');
  assert.equal(byFacet.get('news_flow').status, 'observed');
  assert.equal(byFacet.get('yield_rates').status, 'observed');
  assert.equal(byFacet.get('macro_state').status, 'observed');
  assert.equal(byFacet.get('smart_money').status, 'observed');

  const second = await executeToolRequests({
    requests: [
      { facetId: 'knowledge', tool: 'fbt_rag_search', cost: 'low' },
      { facetId: 'past_decisions', tool: 'fbt_memory_recall', cost: 'low' }
    ],
    turnCtx: { owner: 'dev:probe', question: 'سواپ چطور کار می‌کند؟', locale: 'fa', turnId: 't2' },
    deadlineMs: 3000, maxTools: 4, deps: { runTool, ...depsWith() }
  });
  assert.equal(second.rows[0].status, 'observed');
  assert.deepEqual(second.rows[0].citations, ['kb.swap.howto']);
  assert.equal(second.rows[1].status, 'degraded', 'no memory row yet is a degraded read, not a failure');
  assert.equal(second.rows[1].error, 'NO_MEMORY');
});

await t('a failed module is reported as unavailable with its error, never dropped', async () => {
  const { runTool } = makeRunTool({ fail: ['markets'] });
  const out = await executeToolRequests({ requests: [marketRequest], turnCtx: {}, deadlineMs: 3000, deps: { runTool, ...depsWith() } });
  assert.equal(out.rows[0].status, 'unavailable');
  assert.ok(out.rows[0].error);
  assert.equal(out.unavailable, 1);
  assert.equal(out.observed, 0);
});

/* ── 3. the discipline ─────────────────────────────────────────────────── */

await t('a repeated request is deduped, not re-fetched', async () => {
  const { runTool, calls } = makeRunTool();
  const out = await executeToolRequests({
    requests: [marketRequest, { ...marketRequest }],
    turnCtx: {}, deadlineMs: 3000, deps: { runTool, ...depsWith() }
  });
  assert.equal(calls.length, 1, 'the module layer is called once');
  assert.equal(out.rows[1].status, 'skipped');
  assert.equal(out.rows[1].reason, 'DUPLICATE_REQUEST');
});

await t('the per-turn cap defers the rest with a reason', async () => {
  const { runTool, calls } = makeRunTool();
  const out = await executeToolRequests({
    requests: [marketRequest, { facetId: 'news_flow', tool: 'fbt_get_news', cost: 'medium' }, { facetId: 'yield_rates', tool: 'fbt_get_yields', cost: 'medium' }],
    turnCtx: {}, deadlineMs: 5000, maxTools: 2, deps: { runTool, ...depsWith() }
  });
  assert.equal(calls.length, 2);
  assert.equal(out.rows[2].reason, 'TOOL_CAP');
});

await t('a spent budget refuses to start a call instead of overrunning the turn', async () => {
  const { runTool, calls } = makeRunTool();
  /* The first read consumes most of the budget (the real thing is a network
     read); the second must then be refused rather than started. */
  const slow = async (args) => { await new Promise((r) => setTimeout(r, 450)); return runTool(args); };
  const out = await executeToolRequests({
    requests: [marketRequest, { facetId: 'news_flow', tool: 'fbt_get_news', cost: 'medium' }],
    turnCtx: {}, deadlineMs: 950, maxTools: 4, deps: { runTool: slow, ...depsWith() }
  });
  assert.equal(out.rows[0].status, 'observed');
  assert.equal(out.rows[1].status, 'skipped');
  assert.equal(out.rows[1].reason, 'DEADLINE');
  assert.equal(calls.length, 1);
});

await t('a hanging tool becomes a degraded row, not a hung turn', async () => {
  const { runTool } = makeRunTool({ hang: ['markets'] });
  const started = Date.now();
  const out = await executeToolRequests({ requests: [marketRequest], turnCtx: {}, deadlineMs: 1500, deps: { runTool, ...depsWith() } });
  assert.ok(Date.now() - started < 4000, 'the per-tool timeout must fire');
  assert.equal(out.rows[0].status, 'degraded');
  assert.match(String(out.rows[0].error), /timeout/i);
});

await t('the same read four times inside ONE turn is refused as a loop', async () => {
  _resetToolLoopMemory();
  const { runTool, calls } = makeRunTool();
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    out.push(await executeToolRequests({ requests: [marketRequest], turnCtx: { owner: 'dev:loop', turnId: 'turn-1' }, deadlineMs: 3000, deps: { runTool, ...depsWith() } }));
  }
  assert.equal(out[3].rows[0].status, 'skipped');
  assert.equal(out[3].rows[0].reason, 'LOOP_DETECTED');
  assert.equal(calls.filter((c) => c.module === 'markets').length, 3, 'the guard stops the fourth execution, not the first three');
});

await t('…while the SAME question in separate turns is normal conversation, never a loop', async () => {
  _resetToolLoopMemory();
  const { runTool, calls } = makeRunTool();
  for (let i = 0; i < 5; i += 1) {
    const out = await executeToolRequests({
      requests: [marketRequest],
      turnCtx: { owner: 'dev:same-question', turnId: `turn-${i}` },
      deadlineMs: 3000, deps: { runTool, ...depsWith() }
    });
    assert.equal(out.rows[0].status, 'observed', `turn ${i} must not be refused`);
  }
  assert.equal(calls.filter((c) => c.module === 'markets').length, 5, 'every distinct turn reads again');
  _resetToolLoopMemory();
});

await t('the expensive macro desk is off by default and on only when allowed', async () => {
  const request = { facetId: 'macro_state', tool: 'fbt_get_macro', cost: 'high' };
  const { runTool, calls } = makeRunTool();
  const off = await executeToolRequests({ requests: [request], turnCtx: {}, deadlineMs: 3000, allowHighCost: false, deps: { runTool, ...depsWith() } });
  assert.equal(off.rows[0].reason, 'HIGH_COST_TOOL_DISABLED');
  assert.equal(calls.length, 0);
  const on = await executeToolRequests({ requests: [request], turnCtx: {}, deadlineMs: 3000, allowHighCost: true, deps: { runTool, ...depsWith() } });
  assert.equal(on.rows[0].status, 'observed');
});

await t('an empty request list is a valid, zero-cost turn', async () => {
  const out = await executeToolRequests({ requests: [], turnCtx: {}, deadlineMs: 1000, deps: {} });
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows, []);
  assert.equal(out.executed, 0);
  assert.equal(out.canExecute, false);
});

let passed = 0;
console.log('\n=== FBT AI ORCHESTRATOR — tool broker probe ===\n');
for (const [name, ok, detail] of results) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else console.error(`  ✗ ${name}\n    ${detail}`);
}
console.log(`\n=== TOOL BROKER PROBE: ${passed}/${results.length} passed ===\n`);
if (passed !== results.length) process.exit(1);
