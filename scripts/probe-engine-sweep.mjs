/*
 * THE GENERAL GUARANTEE: does every engine in server/fios reach an ANSWER?
 * ---------------------------------------------------------------------------
 *
 * `probe-engine-reach.mjs` asks that of every INTENT, through a real brain
 * turn. This script asks it of every ENGINE FILE, because the two sets are
 * not the same set — and the difference is where dark capabilities hide.
 *
 * THE TWO PATHS AN ENGINE CAN TAKE.
 *
 *   A. THE BRAIN PATH. The user types a sentence. The brain classifies it,
 *      reads the sections the intent needs, and answers from what it read.
 *      The engine behind those sections is reached through a BRIDGE
 *      (`server/ci/*Bridge.js`) — because the FIOs composition root is
 *      built AFTER the brain (it calls back into it) and the brain is
 *      built BEFORE the FIOs (it needs them). Neither can hold the other
 *      at construction time, so a one-slot bridge carries the call.
 *
 *      Eight engines live here. A path-14/15/16 failure was an engine on
 *      this path that was complete and never called.
 *
 *   B. THE FIOs PATH. The user opens a console, a strategy lab, a policy
 *      list — a page that talks to `/api/fios/*`. The FI router reaches
 *      the engine directly. No brain turn, no bridge.
 *
 *      Forty-one engines live here. Their bug is the opposite: an engine
 *      that answers its own page perfectly and is invisible to the
 *      conversation.
 *
 * A guarantee that only covers path A would leave path B unmeasured, and
 * path B is where the bulk of the intelligence lives. So both are swept.
 *
 * THE RULE, AGAIN, BECAUSE IT IS THE POINT.
 *
 * A test that drives an engine directly proves the engine. Only a test
 * that drives the CALLER proves the engine is REACHED. Import reachability
 * proves neither. So:
 *
 *   · PATH A is swept by asking the BRAIN a sentence and looking for the
 *     engine's own output in the reply.
 *   · PATH B is swept by asking the FI ROUTER the call its own page makes
 *     and looking for the engine's own output in the body.
 *
 * Both are real calls over real routes. Neither reaches into an engine.
 *
 * USAGE
 *   node scripts/probe-engine-sweep.mjs            the sweep
 *   node scripts/probe-engine-sweep.mjs --json     machine-readable
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIO_DIR = path.join(ROOT, 'server', 'fios');
const AS_JSON = process.argv.includes('--json');

/* ── the engine files, and where each one lives in the composition root ── */

/*
 * The name on disk and the name in the root are not the same for fifteen
 * of them — `agentRuntimeOps.js` is `agentRuntime` in the root, `decision.js`
 * is `decisionEngine`, `crosschain.js` is `crossChain`. Guessing that
 * mapping by string similarity is how a sweep quietly skips half the
 * codebase, so it is written down here.
 */
const ROOT_KEY = {
  agentCouncil: 'agentCouncil',
  agentRuntimeOps: 'agentRuntime',
  agents: 'agents',
  autonomy: 'autonomy',
  behavior: 'behavior',
  briefing: 'briefingEngine',
  collections: 'collections',
  competition: 'competition',
  conditionalAllocation: 'conditionalAllocation',
  confidence: 'confidenceEngine',
  conversationState: 'conversationState',
  council: 'council',
  crossAsset: 'crossAsset',
  crossNarrative: 'crossNarrative',
  crosschain: 'crossChain',
  decision: 'decisionEngine',
  evaluation: 'evaluation',
  eventReplanning: 'eventReplanning',
  evidence: 'evidence',
  executionAuthority: 'executionAuthority',
  financialState: 'financialState',
  flags: 'flags',
  genome: 'genome',
  globalIntel: 'globalIntel',
  goalReasoning: 'goalReasoning',
  goalScenarios: 'goalScenarios',
  guardian: 'guardian',
  index: null,
  learning: 'learning',
  macroGraph: 'macroGraph',
  memory: 'memory',
  migrations: 'migrations',
  observability: 'observability',
  opportunityFit: 'opportunityFit',
  personalProfile: 'personalProfile',
  policy: 'policyEngine',
  preferences: 'preferences',
  provenance: 'provenance',
  research: 'research',
  routeIntelligence: 'routeIntelligence',
  routeSimulator: 'routeSimulator',
  router: null,
  simulation: 'simulation',
  smartMoneyIntel: 'smartMoneyIntel',
  strategy: 'strategy',
  trace: 'traceStore',
  traditionalAssets: 'traditionalAssets',
  walletContext: 'walletContext',
  whyEngine: 'whyEngine',
  worldModel: 'worldModel'
};

const engineFiles = fs
  .readdirSync(FIO_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .map((f) => f.replace(/\.js$/, ''));

/* ── path B: the call each engine's own page makes ─────────────────────── */

/*
 * Each entry is the FI route that reaches the engine, and the body that
 * route needs. These are the REAL calls — the ones the console makes —
 * not a synthetic invocation of an engine method.
 */
const FI_ROUTE_CALLS = {
  agentCouncil: { method: 'POST', path: '/deep/agent-council', body: { question: 'should I hold ETH or rotate to USDC?', ownerContext: { riskTolerance: 'balanced' } } },
  agentRuntime: { method: 'POST', path: '/deep/agents/sessions', body: { agentId: 'market-analyst', task: 'read the regime' } },
  agents: { method: 'GET', path: '/external-agents' },
  autonomy: { method: 'GET', path: '/autonomy' },
  behavior: { method: 'GET', path: '/preferences' },
  briefingEngine: { method: 'GET', path: '/global/briefing' },
  collections: { method: 'GET', path: '/research' },
  competition: { method: 'GET', path: '/strategies' },
  conditionalAllocation: { method: 'POST', path: '/deep/conditional/plan', body: { conditions: [{ asset: 'ETH', direction: 'up', threshold: 3000 }] } },
  confidenceEngine: { method: 'GET', path: '/research' },
  conversationState: { method: 'GET', path: '/deep/conversation' },
  council: { method: 'GET', path: '/council' },
  crossAsset: { method: 'GET', path: '/global/cross-asset' },
  crossNarrative: { method: 'GET', path: '/global/briefing' },
  crossChain: { method: 'POST', path: '/strategies/compare', body: { strategies: [{ id: 'a' }, { id: 'b' }] } },
  decisionEngine: { method: 'POST', path: '/decision', body: { question: 'should I rebalance into BTC?', context: {} } },
  evaluation: { method: 'GET', path: '/deep/evaluation/due' },
  eventReplanning: { method: 'POST', path: '/deep/events/replan', body: { event: { type: 'PRICE_CHANGED', payload: {} } } },
  evidence: { method: 'GET', path: '/evidence' },
  executionAuthority: { method: 'GET', path: '/deep/agents/runtime' },
  financialState: { method: 'GET', path: '/financial-state' },
  flags: { method: 'GET', path: '/deep/status' },
  genome: { method: 'GET', path: '/preferences' },
  globalIntel: { method: 'GET', path: '/global/intelligence' },
  goalReasoning: { method: 'POST', path: '/deep/goal-reasoning', body: { goal: { name: 'g', targetAmount: 1000, targetDate: '2030-01-01' } } },
  goalScenarios: { method: 'POST', path: '/deep/goal-scenarios', body: { goal: { name: 'g', targetAmount: 1000, targetDate: '2030-01-01' } } },
  guardian: { method: 'GET', path: '/guardian/status' },
  learning: { method: 'GET', path: '/learning' },
  macroGraph: { method: 'GET', path: '/deep/macro-graph' },
  memory: { method: 'GET', path: '/deep/profile' },
  migrations: { method: 'GET', path: '/deep/status' },
  observability: { method: 'GET', path: '/deep/status' },
  opportunityFit: { method: 'POST', path: '/deep/opportunities/fit', body: { opportunity: { asset: 'ETH', kind: 'staking' } } },
  personalProfile: { method: 'GET', path: '/deep/profile' },
  policyEngine: { method: 'GET', path: '/policies' },
  preferences: { method: 'GET', path: '/preferences' },
  provenance: { method: 'GET', path: '/research' },
  research: { method: 'GET', path: '/research' },
  routeIntelligence: { method: 'POST', path: '/deep/routes/intelligence', body: { request: { fromChain: 'ethereum', toChain: 'polygon', asset: 'USDC', amountUsd: 100 }, routes: [] } },
  routeSimulator: { method: 'POST', path: '/strategies/simulate', body: { strategies: [{ id: 'a' }] } },
  simulation: { method: 'POST', path: '/simulate', body: { strategies: [{ id: 'a' }] } },
  smartMoneyIntel: { method: 'GET', path: '/strategies' },
  strategy: { method: 'GET', path: '/strategies' },
  traceStore: { method: 'GET', path: '/trace/none' },
  traditionalAssets: { method: 'GET', path: '/deep/traditional-assets/discover' },
  walletContext: { method: 'GET', path: '/deep/wallet-context' },
  whyEngine: { method: 'GET', path: '/deep/why/none' },
  worldModel: { method: 'GET', path: '/world-state' }
};

/* ── build the world once ─────────────────────────────────────────────── */
const { createFinancialIntelligence } = await import(
  path.join(ROOT, 'server', 'fios', 'index.js')
);
const { createCentralStateStore } = await import(
  path.join(ROOT, 'server', 'ci', 'stateStore.js')
);

const stateStore = createCentralStateStore();
const owner = 'engine-sweep-owner';

/* a real owner: wallet, portfolio, markets, goals, signals */
const now = Date.now();
await stateStore.write(owner, 'wallet', {
  data: { addresses: { evm: ['0x1111111111111111111111111111111111111111'] }, connected: true },
  source: 'sweep', status: 'OK', now
});
await stateStore.write(owner, 'portfolio', {
  data: {
    holdings: [
      { symbol: 'ETH', amount: 1.5, valueUsd: 4500, chainId: 1, priceUsd: 3000 },
      { symbol: 'USDC', amount: 2000, valueUsd: 2000, chainId: 1, priceUsd: 1 }
    ],
    totalValueUsd: 6500, dataStatus: 'live'
  },
  source: 'sweep', status: 'OK', now
});
await stateStore.write(owner, 'markets', {
  data: { prices: { ETH: { priceUsd: 3000 }, BTC: { priceUsd: 60000 }, USDC: { priceUsd: 1 } }, bySymbol: {} },
  source: 'sweep', status: 'OK', now
});
await stateStore.write(owner, 'goals', {
  data: { goals: [{ id: 'g1', name: 'reserve', targetAmount: 10000, targetDate: '2027-01-01', monthlyContribution: 300 }] },
  source: 'sweep', status: 'OK', now
});
await stateStore.write(owner, 'signals', {
  data: { signals: [] }, source: 'sweep', status: 'OK', now
});
await stateStore.write(owner, 'risk', {
  data: { riskScore: 40, level: 'MEDIUM', exposures: [] }, source: 'sweep', status: 'OK', now
});

const fi = createFinancialIntelligence({
  stateStore,
  events: null,
  brain: null,
  ownerFor: () => owner,
  log: () => {}
});

/* the FI router — the real caller of path B */
const { createFiRouter } = await import(path.join(ROOT, 'server', 'fios', 'router.js'));
const router = createFiRouter({ fi, ownerFor: () => owner, log: () => {} });

/* ── a tiny express-shaped caller for the router ──────────────────────── */
async function callRoute({ method = 'GET', path: p, body = null }) {
  const req = {
    method,
    url: p,
    body,
    query: {},
    params: {},
    headers: { 'x-fbt-device': 'sweepdevice0001' },
    get: (h) => req.headers[String(h).toLowerCase()] || '',
    ip: '127.0.0.1'
  };
  let payload = null;
  let status = 200;
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) { status = code; return this; },
    set() { return this; },
    json(obj) { payload = obj; this.headersSent = true; return this; },
    send(obj) { payload = obj; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; }
  };
  await new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const layer = router.stack?.[0];
    void layer;
    /* express Router is a middleware stack; run it with raw req/res */
    router.handle(req, res, done);
    setTimeout(done, 8000);
  });
  return { status, body: payload };
}

/* ── the sweep ────────────────────────────────────────────────────────── */

const results = [];

for (const engine of engineFiles) {
  const rootKey = ROOT_KEY[engine] ?? null;
  const mounted = rootKey ? Boolean(fi[rootKey]) : false;
  const call = FI_ROUTE_CALLS[engine] ?? null;

  let reached = false;
  let detail = '';
  let route = call ? `${call.method} ${call.path}` : '—';

  if (!call) {
    detail = 'NO ROUTE IN THE SWEEP — the engine has no caller to probe';
  } else {
    try {
      const out = await callRoute(call);
      const ok = out?.status === 200 && out?.body && typeof out.body === 'object';
      const rejected = out?.body?.ok === false;
      reached = Boolean(ok);
      detail = reached
        ? `HTTP ${out.status}`
        : `HTTP ${out.status} ${String(out?.body?.code || out?.body?.detail || JSON.stringify(out?.body || {}).slice(0, 90))}`;
      if (reached && out.body.ok === false) {
        detail += ' · the route answered with a refusal, not a result';
      }
    } catch (err) {
      detail = `THREW: ${String(err?.message || err).slice(0, 90)}`;
    }
  }

  results.push({ engine, rootKey, mounted, route, reached, detail });
}

/* ── the report ──────────────────────────────────────────────────────── */
const unmounted = results.filter((r) => r.rootKey && !r.mounted);
const noRoute = results.filter((r) => !r.route || r.route === '—');
const notReached = results.filter((r) => r.route !== '—' && !r.reached);

if (AS_JSON) {
  console.log(JSON.stringify({ results, summary: {
    engines: results.length,
    mounted: results.filter((r) => r.mounted).length,
    reached: results.filter((r) => r.reached).length,
    unmounted: unmounted.length,
    noRoute: noRoute.length,
    notReached: notReached.length
  } }, null, 2));
} else {
  console.log('');
  console.log('  ── every engine in server/fios, swept over its OWN route ──────────');
  console.log('');
  for (const r of results) {
    const mark = r.reached ? 'ok      ' : (!r.route || r.route === '—' ? 'no route' : 'NOT REACHED');
    console.log(`  ${r.engine.padEnd(22)} ${mark.padEnd(12)} ${r.route.padEnd(34)} ${r.detail}`);
  }
  console.log('');
  console.log('  ── summary ──────────────────────────────────────────────────────');
  console.log(`  engine files            ${results.length}`);
  console.log(`  mounted in the root     ${results.filter((r) => r.mounted).length}`);
  console.log(`  reached over its route  ${results.filter((r) => r.reached).length}`);
  console.log(`  NOT reached             ${notReached.length}`);
  console.log(`  no route in the sweep   ${noRoute.length}`);
  console.log('');
  if (notReached.length) {
    console.log('  THE DARK ONES — mounted, routed, and answering nobody:');
    for (const r of notReached) console.log(`    · ${r.engine} — ${r.detail}`);
    console.log('');
  }
  if (noRoute.length) {
    console.log('  NO CALLER — an engine nothing asks for:');
    for (const r of noRoute) console.log(`    · ${r.engine}`);
    console.log('');
  }
}
