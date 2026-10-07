/**
 * FBT AI ORCHESTRATOR — TOOL BROKER (MCP-shaped, read-only by construction)
 * ---------------------------------------------------------------------------
 * The "hands" of the orchestrator: a named catalogue of the facts FBT can
 * actually read, each with an MCP-compatible descriptor (`name`, `title`,
 * `description`, `inputSchema`, `scope`) so the SAME catalogue can be exposed
 * to an external agent (mcp/src/tools.mjs) and to the internal brain without
 * two implementations that drift.
 *
 * Hard boundary, enforced twice:
 *   · every tool here declares `sideEffects: 'read'` — there is no code path in
 *     this file that builds a transaction, signs, approves or sends;
 *   · the executor refuses anything whose `sideEffects` is not `'read'`, so a
 *     future edit that adds an execution tool to the catalogue fails closed.
 *
 * Execution discipline (this is what makes the tool layer safe to run inside a
 * 12-second turn):
 *   · dedupe   — the same tool+input is never called twice in one turn;
 *   · cap      — at most `maxTools` calls per turn (`AI_ORCH_MAX_TOOLS`, 4);
 *   · deadline — a call that would cross the turn deadline is not started, and
 *                a running call is raced against the remaining budget;
 *   · timeout  — every tool has its own ceiling underneath that;
 *   · loop     — an identical (tool, input) third time is refused outright
 *                (the same guard the central tool router applies to modules);
 *   · honesty  — every row carries `status: observed | degraded | unavailable`
 *                plus provenance. An unavailable read is REPORTED as a gap, not
 *                silently dropped, so the judge can put it in `limits`.
 *
 * The underlying modules are the app's own: the central brain's tool router
 * (capability + policy + health gated module reads), the macro desk, the
 * smart-money intelligence engine and the RAG memory. Nothing is re-fetched
 * that the turn already holds — that decision belongs to evidencePlan.js.
 */

import { createHash } from 'node:crypto';

export const TOOL_BROKER_SCHEMA = 'fbt.ai-tool-broker.v1';
export const TOOL_BROKER_VERSION = '14.0.0';

/* Loop detection is scoped to ONE turn, exactly like the central tool
   router's per-turn window (server/central/toolRouter.js): reads are
   idempotent, so a user asking about the same asset four times in a minute is
   normal conversation, while the same call four times inside one turn is a
   planner bug. Without a turn id there is no cross-turn state to poison —
   within a single gather step the request list is finite and deduped, and the
   per-turn cap bounds it. */
const LOOP_WINDOW_MS = 30_000;
const LOOP_LIMIT = 3;
const loopMemory = new Map(); // `${turnId}|${fingerprint}` -> [timestamps]

function fingerprint(tool, input) {
  const h = createHash('sha1');
  h.update(`${tool}|${stableStringify(input)}`);
  return h.digest('hex').slice(0, 16);
}

function stableStringify(value, depth = 0) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (depth > 4) return '"…"';
  if (Array.isArray(value)) return `[${value.slice(0, 20).map((v) => stableStringify(v, depth + 1)).join(',')}]`;
  return `{${Object.keys(value).sort().slice(0, 20).map((k) => `${JSON.stringify(k)}:${stableStringify(value[k], depth + 1)}`).join(',')}}`;
}

/** Test hook. */
export function _resetToolLoopMemory() { loopMemory.clear(); }

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_r, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timeout after ${ms}ms`);
        err.code = 'TOOL_TIMEOUT';
        reject(err);
      }, Math.max(40, ms));
      /* deliberately NOT unref'd: an unref'd timer can be dropped when the
         event loop is otherwise idle, which would turn a tool timeout into an
         unsettled promise. It is always cleared in `.finally` below. */
    })
  ]).finally(() => clearTimeout(timer));
}

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null);
const truncAddr = (a) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || null);

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

/* -------------------------------------------------------------------------- */
/*  Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} deps injected readers (a probe passes fakes; production
 *        resolves the real modules lazily inside each tool)
 */
export function toolCatalogue(deps = {}) {
  const ctxOf = (turnCtx = {}) => ({ owner: turnCtx.owner || null, clientData: turnCtx.clientData || null });

  const callCentral = async (module, operation, input, turnCtx) => {
    const runTool = deps.runTool || (await import('./central/toolRouter.js')).runTool;
    const out = await runTool({
      module, operation, input: { ...(input || {}), owner: ctxOf(turnCtx).owner },
      ctx: ctxOf(turnCtx),
      permissionGranted: 'READ'
    });
    return out;
  };

  return [
    {
      name: 'fbt_get_market_snapshot',
      title: 'Live market snapshot',
      description: 'Prices, 24h change and volatility for the tracked universe. The only source of a price in an answer.',
      facet: 'market_prices', sideEffects: 'read', scope: 'read_network', cost: 'low', timeoutMs: 9000,
      inputSchema: obj({ asset: str('Optional symbol filter, e.g. BTC') }),
      async run({ input = {}, turnCtx = {} }) {
        const out = await callCentral('markets', 'read', {}, turnCtx);
        if (!out.ok) return { status: out.status === 'OK' ? 'degraded' : 'unavailable', error: clip(out.error || out.status, 120), provenance: { tool: 'fbt_get_market_snapshot', via: 'central:markets' } };
        const coins = Array.isArray(out.result?.coins) ? out.result.coins : [];
        const filter = input.asset ? String(input.asset).toUpperCase() : null;
        const rows = (filter ? coins.filter((c) => String(c.symbol).toUpperCase() === filter) : coins).slice(0, filter ? 4 : 10);
        if (!rows.length) return { status: 'unavailable', error: 'NO_MARKET_ROWS', provenance: { tool: 'fbt_get_market_snapshot', via: 'central:markets' } };
        return {
          status: 'observed',
          summary: {
            count: out.result?.count ?? coins.length,
            stale: out.result?.staleness?.stale === true || out.result?.stale === true,
            rows: rows.map((c) => ({
              symbol: clip(c.symbol, 12),
              priceUsd: round(c.priceUsd ?? c.price, 6),
              change24hPct: round(c.change24hPct, 3),
              change7dPct: round(c.change7dPct, 3),
              volatility24hPct: round(c.volatility24hPct, 3)
            }))
          },
          provenance: { tool: 'fbt_get_market_snapshot', via: 'central:markets', at: Date.now(), basis: 'live market read' }
        };
      }
    },
    {
      name: 'fbt_get_signals',
      title: 'Asset trend / momentum read',
      description: 'Derived momentum, volatility and 7-day trend for one asset, computed from the market read (never a model opinion).',
      facet: 'asset_regime', sideEffects: 'read', scope: 'read_network', cost: 'low', timeoutMs: 9000,
      inputSchema: obj({ asset: str('Symbol, e.g. ETH') }, ['asset']),
      async run({ input = {}, turnCtx = {} }) {
        const asset = clip(input.asset, 12).toUpperCase();
        const out = await callCentral('signals', 'read', { asset }, turnCtx);
        if (!out.ok) return { status: 'unavailable', error: clip(out.error || out.status, 120), provenance: { tool: 'fbt_get_signals', via: 'central:signals' } };
        const row = Array.isArray(out.result?.rows) ? out.result.rows.find((r) => String(r.symbol).toUpperCase() === asset) : null;
        const picked = row || out.result?.rows?.[0] || null;
        if (!picked) return { status: 'unavailable', error: 'ASSET_NOT_FOUND', provenance: { tool: 'fbt_get_signals', via: 'central:signals' } };
        return {
          status: 'observed',
          summary: {
            asset: clip(picked.symbol, 12),
            momentum: clip(picked.momentum, 12),
            volatility: clip(picked.volatility, 12),
            priceUsd: round(picked.priceUsd, 6),
            change24hPct: round(picked.change24hPct, 3),
            basis: clip(picked.basis, 80)
          },
          provenance: { tool: 'fbt_get_signals', via: 'central:signals', at: Date.now(), basis: picked.basis || null }
        };
      }
    },
    {
      name: 'fbt_get_portfolio',
      title: 'Portfolio state',
      description: 'The user’s own holdings as the app knows them (client-supplied state, never invented). Required for any question about their money.',
      facet: 'portfolio_state', sideEffects: 'read', scope: 'owner', cost: 'low', timeoutMs: 4000,
      inputSchema: obj({}),
      async run({ turnCtx = {} }) {
        const out = await callCentral('portfolio', 'read', {}, turnCtx);
        if (!out.ok) {
          return {
            status: out.status === 'CAPABILITY_UNAVAILABLE' ? 'unavailable' : 'degraded',
            error: clip(out.error || out.status, 120),
            provenance: { tool: 'fbt_get_portfolio', via: 'central:portfolio', at: Date.now() }
          };
        }
        const r = out.result || {};
        const holdings = Array.isArray(r.holdings) ? r.holdings.slice(0, 12) : [];
        return {
          status: 'observed',
          summary: {
            totalValueUsd: round(r.totalValueUsd, 2),
            partial: r.partial === true,
            holdingCount: holdings.length,
            holdings: holdings.map((h) => ({
              symbol: clip(h.symbol || h.token || h.asset, 14),
              amount: round(h.amount ?? h.balance, 8),
              valueUsd: round(h.valueUsd ?? h.usdValue, 2)
            }))
          },
          provenance: { tool: 'fbt_get_portfolio', via: 'central:portfolio', at: Date.now(), source: 'client-supplied portfolio state' }
        };
      }
    },
    {
      name: 'fbt_get_wallet_state',
      title: 'Wallet state',
      description: 'Connected chains and (truncated) addresses. Booleans and refs only — never a key, never a signature.',
      facet: 'wallet_state', sideEffects: 'read', scope: 'owner', cost: 'low', timeoutMs: 3000,
      inputSchema: obj({}),
      async run({ turnCtx = {} }) {
        const out = await callCentral('wallet', 'read', {}, turnCtx);
        if (!out.ok) return { status: 'unavailable', error: clip(out.error || out.status, 120), provenance: { tool: 'fbt_get_wallet_state', via: 'central:wallet' } };
        const w = out.result || {};
        return {
          status: 'observed',
          summary: {
            connected: w.connected === true,
            chains: Array.isArray(w.chains) ? w.chains.slice(0, 8).map((c) => clip(c, 20)) : [],
            evmAddresses: (w.evmAddresses || []).slice(0, 3).map(truncAddr),
            solanaAddresses: (w.solanaAddresses || []).slice(0, 3).map(truncAddr)
          },
          provenance: { tool: 'fbt_get_wallet_state', via: 'central:wallet', at: Date.now() }
        };
      }
    },
    {
      name: 'fbt_get_news',
      title: 'News flow',
      description: 'Latest headlines from the app’s own feeds, optionally filtered by asset.',
      facet: 'news_flow', sideEffects: 'read', scope: 'read_network', cost: 'medium', timeoutMs: 7000,
      inputSchema: obj({ asset: str('Optional symbol filter') }),
      async run({ input = {}, turnCtx = {} }) {
        const out = await callCentral('news', 'read', { asset: input.asset || undefined }, turnCtx);
        if (!out.ok) return { status: 'unavailable', error: clip(out.error || out.status, 120), provenance: { tool: 'fbt_get_news', via: 'central:news' } };
        const items = Array.isArray(out.result?.items) ? out.result.items.slice(0, 6) : [];
        if (!items.length) return { status: 'degraded', error: 'NO_NEWS_ITEMS', provenance: { tool: 'fbt_get_news', via: 'central:news' } };
        return {
          status: 'observed',
          summary: {
            filteredByAsset: out.result.filteredByAsset || null,
            items: items.map((i) => ({ title: clip(i.title, 140), source: clip(i.source, 40), at: i.at || null }))
          },
          provenance: { tool: 'fbt_get_news', via: 'central:news', at: Date.now() }
        };
      }
    },
    {
      name: 'fbt_get_yields',
      title: 'Yield / rate reads',
      description: 'Pool and staking rates the app tracks, so an APY in an answer is a read rather than an estimate.',
      facet: 'yield_rates', sideEffects: 'read', scope: 'read_network', cost: 'medium', timeoutMs: 8000,
      inputSchema: obj({ asset: str('Optional symbol filter') }),
      async run({ input = {}, turnCtx = {} }) {
        const out = await callCentral('farming', 'read', {}, turnCtx);
        if (!out.ok) return { status: 'unavailable', error: clip(out.error || out.status, 120), provenance: { tool: 'fbt_get_yields', via: 'central:farming' } };
        const rows = Array.isArray(out.result?.rows || out.result?.pools) ? (out.result.rows || out.result.pools) : [];
        const filter = input.asset ? String(input.asset).toUpperCase() : null
        const matching = filter ? rows.filter((r) => String(r.symbol || r.asset || '').toUpperCase().includes(filter)) : rows;
        /* A question about an asset with no yield venue is not a failed read:
           the desk answered, it simply has nothing for that symbol — so the
           top rates are returned and the summary says they are unfiltered. */
        const picked = (matching.length ? matching : rows).slice(0, 6);
        if (!picked.length) return { status: 'degraded', error: 'NO_YIELD_ROWS', provenance: { tool: 'fbt_get_yields', via: 'central:farming' } };
        return {
          status: 'observed',
          summary: {
            count: rows.length,
            filteredByAsset: filter && matching.length ? filter : null,
            rows: picked.map((r) => ({
              venue: clip(r.project || r.venue || r.pool, 60),
              symbol: clip(r.symbol || r.asset, 16),
              chain: clip(r.chain, 24),
              apy: round(r.apy ?? r.apyPct ?? r.apyBase, 3),
              tvlUsd: round(r.tvlUsd ?? r.tvl, 0)
            }))
          },
          provenance: { tool: 'fbt_get_yields', via: 'central:farming', at: Date.now() }
        };
      }
    },
    {
      name: 'fbt_get_macro',
      title: 'Macro desk',
      description: 'Rates, inflation, dollar index, gold and oil from the app’s macro desk. Expensive: several upstream desks behind one cache.',
      facet: 'macro_state', sideEffects: 'read', scope: 'read_network', cost: 'high', timeoutMs: 9500,
      inputSchema: obj({}),
      async run() {
        const fetcher = deps.fetchMacroQuotes || (await import('./macroData.js')).fetchMacroQuotes;
        const { withCache } = await import('./cache.js');
        const { value } = await withCache('orch:macro:v1', 15 * 60_000, fetcher, { swr: true });
        const rows = Array.isArray(value) ? value : (value?.items || value?.quotes || []);
        const picked = rows.filter(Boolean).slice(0, 10).map((r) => ({
          symbol: clip(r.symbol || r.id || r.label, 24),
          value: round(r.value ?? r.price ?? r.last, 4),
          changePct: round(r.changePct ?? r.change1dPct ?? r.pctChange, 3)
        }));
        if (!picked.length) return { status: 'unavailable', error: 'MACRO_EMPTY', provenance: { tool: 'fbt_get_macro', via: 'macroData' } };
        return {
          status: 'observed',
          summary: { count: rows.length, rows: picked },
          provenance: { tool: 'fbt_get_macro', via: 'macroData', at: Date.now(), cacheKey: 'orch:macro:v1' }
        };
      }
    },
    {
      name: 'fbt_get_smart_money',
      title: 'Smart-money intelligence',
      description: 'Verified on-chain accumulation/distribution from the Smart Money engine, with its own data-status.',
      facet: 'smart_money', sideEffects: 'read', scope: 'read_network', cost: 'medium', timeoutMs: 7000,
      inputSchema: obj({}),
      async run() {
        const reader = deps.getVerifiedIntelligence || (await import('./smartMoney/intelligence.js')).getVerifiedIntelligence;
        const intel = await reader({ window: '24h', includePrices: false, refresh: 'background' });
        const status = intel?.dataStatus === 'observed' ? 'observed' : intel?.dataStatus === 'unavailable' ? 'unavailable' : 'degraded';
        const consensus = (intel?.consensus || []).slice(0, 5).map((c) => ({
          asset: clip(c.asset || c.symbol, 14),
          side: clip(c.side || c.verdict, 20),
          score: round(c.score ?? c.confidence, 3),
          wallets: round(c.wallets ?? c.walletCount, 0)
        }));
        return {
          status,
          summary: { dataStatus: intel?.dataStatus || null, coverage: intel?.coverage ? { assets: intel.coverage.assets ?? null } : null, consensus },
          provenance: { tool: 'fbt_get_smart_money', via: 'smartMoney/intelligence', at: Date.now() }
        };
      }
    },
    {
      name: 'fbt_rag_search',
      title: 'Verified knowledge search',
      description: 'Hybrid (vector + BM25) search over the FBT knowledge base and the Help answers. Returns citeable passages.',
      facet: 'knowledge', sideEffects: 'read', scope: 'public', cost: 'low', timeoutMs: 3000,
      inputSchema: obj({ query: str('Natural-language query'), limit: { type: 'integer', description: 'max passages' } }, ['query']),
      async run({ input = {}, turnCtx = {} }) {
        const rag = deps.rag || (await import('./aiOrchestrator.js')).getOrchestratorRag();
        const out = await rag.recall({ query: clip(input.query, 300), locale: turnCtx.locale || 'fa', limit: Math.min(6, Number(input.limit) || 4) });
        if (!out.ok || !out.passages.length) return { status: 'unavailable', error: 'NO_PASSAGES', provenance: { tool: 'fbt_rag_search', via: 'ragMemory' } };
        return {
          status: 'observed',
          summary: { passages: out.passages.map((p) => ({ cite: p.cite, title: clip(p.title, 90), text: clip(p.text, 260), score: p.score })) },
          citations: out.passages.map((p) => p.cite),
          provenance: { tool: 'fbt_rag_search', via: 'ragMemory', at: Date.now(), backend: out.stats?.backend || null }
        };
      }
    },
    {
      name: 'fbt_memory_recall',
      title: 'Owner memory recall',
      description: 'What THIS user asked and what was concluded before, owner-scoped. Never another user’s history.',
      facet: 'past_decisions', sideEffects: 'read', scope: 'owner', cost: 'low', timeoutMs: 2500,
      inputSchema: obj({ query: str('What to recall') }, ['query']),
      async run({ input = {}, turnCtx = {} }) {
        if (!turnCtx.owner) return { status: 'unavailable', error: 'NO_OWNER', provenance: { tool: 'fbt_memory_recall', via: 'ragMemory' } };
        const rag = deps.rag || (await import('./aiOrchestrator.js')).getOrchestratorRag();
        const out = await rag.recall({
          query: clip(input.query, 300), owner: turnCtx.owner, locale: turnCtx.locale || 'fa',
          limit: Math.min(4, Number(input.limit) || 3), kinds: ['memory']
        });
        const rows = (out.passages || []).filter((p) => p.kind === 'memory');
        if (!rows.length) return { status: 'degraded', error: 'NO_MEMORY', provenance: { tool: 'fbt_memory_recall', via: 'ragMemory' } };
        return {
          status: 'observed',
          summary: { memories: rows.map((p) => ({ at: p.at, question: clip(p.question, 140), conclusion: clip(p.text, 220), score: p.score })) },
          provenance: { tool: 'fbt_memory_recall', via: 'ragMemory', at: Date.now() }
        };
      }
    }
  ];
}

/* -------------------------------------------------------------------------- */
/*  Broker                                                                     */
/* -------------------------------------------------------------------------- */

export const EXECUTION_TOOL_NAMES = Object.freeze([
  'sign', 'broadcast', 'execute', 'swap', 'bridge', 'send', 'withdraw', 'approve', 'transfer', 'settle'
]);

/**
 * Execute the tool requests an evidence plan produced.
 *
 * @param {object} opts
 * @param {Array}  opts.requests     [{ facetId, tool, cost, priority, reasons }]
 * @param {object} opts.turnCtx      { owner, clientData, locale, question }
 * @param {number} opts.deadlineMs   absolute budget for the whole gather step
 * @param {number} [opts.maxTools]
 * @param {object} [opts.deps]
 * @param {Function} [opts.now]
 * @param {boolean} [opts.allowHighCost]
 */
export async function executeToolRequests({
  requests = [],
  turnCtx = {},
  deadlineMs = 6000,
  maxTools = Number(process.env.AI_ORCH_MAX_TOOLS || 4),
  deps = {},
  now = Date.now,
  allowHighCost = null
} = {}) {
  const started = now();
  const catalogue = toolCatalogue(deps);
  const byName = new Map(catalogue.map((t) => [t.name, t]));
  const rows = [];
  const seen = new Set();
  const cap = Math.max(0, Math.min(8, Number(maxTools) || 0));
  const highAllowed = allowHighCost == null ? Number(process.env.AI_ORCH_ALLOW_MACRO || 0) === 1 : allowHighCost === true;
  let calls = 0;

  for (const req of requests) {
    const tool = byName.get(req?.tool);
    const remaining = deadlineMs - (now() - started);
    if (calls >= cap) { rows.push({ facetId: req?.facetId || null, tool: req?.tool || null, status: 'skipped', reason: 'TOOL_CAP' }); continue; }
    if (!tool) { rows.push({ facetId: req?.facetId || null, tool: req?.tool || null, status: 'unavailable', reason: 'TOOL_NOT_REGISTERED' }); continue; }
    /* Fail closed: the catalogue is read-only, and the executor refuses to run
       anything that is not — a future edit cannot turn this into an executor. */
    if (tool.sideEffects !== 'read') { rows.push({ facetId: req.facetId, tool: tool.name, status: 'refused', reason: 'NOT_READ_ONLY' }); continue; }
    if (tool.cost === 'high' && !highAllowed) { rows.push({ facetId: req.facetId, tool: tool.name, status: 'skipped', reason: 'HIGH_COST_TOOL_DISABLED' }); continue; }
    if (remaining < 600) { rows.push({ facetId: req.facetId, tool: tool.name, status: 'skipped', reason: 'DEADLINE' }); continue; }

    const input = buildToolInput(req, turnCtx);
    const key = `${tool.name}:${stableStringify(input)}`;
    if (seen.has(key)) { rows.push({ facetId: req.facetId, tool: tool.name, status: 'skipped', reason: 'DUPLICATE_REQUEST' }); continue; }
    seen.add(key);

    /* Same loop guard the central tool router applies to modules — inside the
       turn being gathered, when the caller identified one. */
    const turnId = turnCtx.turnId || null;
    if (turnId) {
      const fp = `${turnId}|${fingerprint(tool.name, input)}`;
      const hits = (loopMemory.get(fp) || []).filter((t) => now() - t < LOOP_WINDOW_MS);
      hits.push(now());
      loopMemory.set(fp, hits);
      if (loopMemory.size > 2000) {
        for (const [k, v] of loopMemory) if (!v.length || now() - v[v.length - 1] > LOOP_WINDOW_MS) loopMemory.delete(k);
      }
      if (hits.length > LOOP_LIMIT) { rows.push({ facetId: req.facetId, tool: tool.name, status: 'skipped', reason: 'LOOP_DETECTED' }); continue; }
    }

    calls += 1;
    const budgetForCall = Math.max(400, Math.min(tool.timeoutMs, deadlineMs - (now() - started) - 150));
    const callStarted = now();
    try {
      const out = await withTimeout(tool.run({ input, turnCtx, budgetMs: budgetForCall }), budgetForCall, tool.name);
      rows.push({
        facetId: req.facetId,
        tool: tool.name,
        status: out?.status || 'observed',
        summary: out?.summary ?? null,
        citations: out?.citations || [],
        error: out?.error || null,
        provenance: out?.provenance || { tool: tool.name, at: now() },
        durationMs: now() - callStarted
      });
    } catch (err) {
      rows.push({
        facetId: req.facetId,
        tool: tool.name,
        status: err?.code === 'TOOL_TIMEOUT' ? 'degraded' : 'unavailable',
        error: String(err?.message || err).slice(0, 140),
        provenance: { tool: tool.name, at: now() },
        durationMs: now() - callStarted
      });
    }
  }

  const observed = rows.filter((r) => r.status === 'observed').length;
  return {
    ok: true,
    schema: TOOL_BROKER_SCHEMA,
    version: TOOL_BROKER_VERSION,
    rows,
    requested: requests.length,
    executed: calls,
    observed,
    degraded: rows.filter((r) => r.status === 'degraded').length,
    unavailable: rows.filter((r) => r.status === 'unavailable').length,
    skipped: rows.filter((r) => r.status === 'skipped' || r.status === 'refused').length,
    durationMs: now() - started,
    readOnly: true,
    canExecute: false
  };
}

/** What each tool needs from the turn (asset symbol, the question, the owner). */
function buildToolInput(req, turnCtx = {}) {
  const asset = turnCtx.token || turnCtx.asset || null;
  switch (req.facetId) {
    case 'asset_regime': return { asset: asset || 'BTC' };
    case 'market_prices': return { asset: asset || undefined };
    case 'news_flow': return { asset: asset || undefined };
    case 'yield_rates': return { asset: asset || undefined };
    case 'knowledge': return { query: turnCtx.question || '', limit: 4 };
    case 'past_decisions': return { query: turnCtx.question || '' };
    default: return {};
  }
}

/**
 * The same catalogue projected as MCP tool descriptors, so an external agent
 * (mcp/src/protocol.mjs) can be handed the interior tools' SCHEMAS without a
 * second definition drifting from this one. Nothing here executes: these are
 * descriptors, and every `run` in the catalogue is a read.
 */
export function mcpToolDescriptors(deps = {}) {
  return toolCatalogue(deps).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: t.cost === 'low', openWorldHint: t.scope === 'read_network' },
    'x-fbt-scope': t.scope,
    'x-fbt-facet': t.facet
  }));
}

/** Catalogue metadata for the API (no handlers). */
export function listTools(deps = {}) {
  return toolCatalogue(deps).map((t) => ({
    name: t.name, title: t.title, description: t.description, facet: t.facet,
    scope: t.scope, sideEffects: t.sideEffects, cost: t.cost, timeoutMs: t.timeoutMs,
    inputSchema: t.inputSchema
  }));
}

export default executeToolRequests;
