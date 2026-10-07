#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — REASONING GRAPH probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The engine that replaced the "one more if-chain" in the AI path is itself an
 * object with laws, so the laws are asserted directly and offline:
 *
 *   · nodes patch one shared state and the trace explains every hop;
 *   · conditional edges pick by rule, with the reason recorded;
 *   · a node that throws obeys the graph's failure policy (abort / skip / goto)
 *     instead of leaving a half-applied state;
 *   · a slow node is cut by the per-node timeout;
 *   · a runaway plan is stopped by maxSteps, and a slow one by the deadline;
 *   · a run can be checkpointed and resumed without re-running finished nodes.
 *
 * No network, no clock: `now` is injected so the trace is exactly comparable.
 */
import assert from 'node:assert/strict';
import { createGraph, checkpointOf, RUN_STATUS, GRAPH_SCHEMA } from '../../src/lib/intent-ai/orchestrator/graphEngine.js';

let passed = 0;
let total = 0;
const test = async (name, fn) => {
  total += 1;
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); }
};

/** A deterministic clock: every call advances 5ms. */
function fakeClock(start = 1_000, step = 5) {
  let t = start;
  return () => { const v = t; t += step; return v; };
}

async function runAll() {
  console.log('\n=== FBT AI ORCHESTRATOR — reasoning graph probe ===\n');

  await test('linear graph runs every node and patches one shared state', async () => {
    const g = createGraph({
      id: 'linear',
      entry: 'a',
      nodes: {
        a: () => ({ patch: { a: 1 } }),
        b: ({ state }) => ({ patch: { b: (state.a || 0) + 1 } }),
        c: ({ state }) => { assert.equal(state.b, 2); return { patch: { done: true } }; }
      },
      edges: { a: 'b', b: 'c', c: null },
      now: fakeClock()
    });
    const out = await g.run({ state: {} });
    assert.equal(out.status, RUN_STATUS.DONE);
    assert.equal(out.ok, true);
    assert.deepEqual([out.state.a, out.state.b, out.state.done], [1, 2, true]);
    assert.equal(out.trace.length, 3);
    assert.deepEqual(out.trace.map((t) => t.node), ['a', 'b', 'c']);
    assert.deepEqual(out.trace[0].patched, ['a']);
    assert.equal(out.trace[2].next, null);
    assert.equal(out.trace[2].why, 'NO_EDGE_END');
    assert.equal(out.schema, GRAPH_SCHEMA);
  });

  await test('conditional edges pick the first matching rule and say why', async () => {
    const g = createGraph({
      id: 'branch',
      entry: 'check',
      nodes: {
        check: ({ state }) => ({ patch: { checked: true } }),
        risky: () => ({ patch: { path: 'risky' } }),
        safe: () => ({ patch: { path: 'safe' } })
      },
      edges: {
        check: [
          { when: (s) => s.stakes === 'HIGH', goto: 'risky', why: 'HIGH_STAKES' },
          { goto: 'safe', why: 'DEFAULT' }
        ],
        risky: null,
        safe: null
      },
      now: fakeClock()
    });
    const high = await g.run({ state: { stakes: 'HIGH' } });
    assert.equal(high.state.path, 'risky');
    assert.equal(high.trace[0].why, 'HIGH_STAKES');
    const low = await g.run({ state: { stakes: 'LOW' } });
    assert.equal(low.state.path, 'safe');
    assert.equal(low.trace[0].why, 'DEFAULT');
  });

  await test('a node may jump explicitly (goto) and stop the graph (stop)', async () => {
    const g = createGraph({
      id: 'goto',
      entry: 'a',
      nodes: {
        a: () => ({ goto: 'c', note: 'skip b' }),
        b: () => { throw new Error('b must not run'); },
        c: () => ({ stop: true, patch: { stopped: true } })
      },
      edges: { a: 'b', b: 'c', c: null },
      now: fakeClock()
    });
    const out = await g.run({});
    assert.equal(out.status, RUN_STATUS.STOPPED);
    assert.equal(out.state.stopped, true);
    assert.deepEqual(out.trace.map((t) => t.node), ['a', 'c']);
    assert.equal(out.trace[0].why, 'NODE_GOTO');
    assert.equal(out.trace[1].why, 'NODE_STOP');
  });

  await test('onError abort keeps the state clean and reports the error', async () => {
    const g = createGraph({
      id: 'abort',
      entry: 'a',
      nodes: { a: () => ({ patch: { a: 1 } }), boom: () => { throw new Error('kaboom'); }, c: () => ({ patch: { c: 1 } }) },
      edges: { a: 'boom', boom: 'c', c: null },
      now: fakeClock()
    });
    const out = await g.run({});
    assert.equal(out.ok, false);
    assert.equal(out.status, RUN_STATUS.NODE_ERROR);
    assert.equal(out.state.a, 1);
    assert.equal(out.state.c, undefined);
    assert.equal(out.errors[0].message, 'kaboom');
    assert.equal(out.trace[1].ok, false);
    assert.equal(out.trace[1].error, 'kaboom');
  });

  await test('onError skip continues along the default edge', async () => {
    const g = createGraph({
      id: 'skip',
      entry: 'a',
      nodes: { a: () => ({ patch: { a: 1 } }), boom: () => { throw new Error('bad source'); }, c: () => ({ patch: { c: 'reached' } }) },
      edges: { a: 'boom', boom: 'c', c: null },
      policies: { onError: 'skip' },
      now: fakeClock()
    });
    const out = await g.run({});
    assert.equal(out.ok, true);
    assert.equal(out.status, RUN_STATUS.DONE);
    assert.equal(out.state.c, 'reached');
    assert.equal(out.errors.length, 1);
    assert.equal(out.trace[1].why, 'EDGE_STATIC:AFTER_ERROR_SKIP');
  });

  await test('onError goto routes to a recovery node', async () => {
    const g = createGraph({
      id: 'recover',
      entry: 'a',
      nodes: { a: () => ({ patch: { a: 1 } }), boom: () => { throw new Error('nope'); }, fallback: () => ({ patch: { recovered: true } }) },
      edges: { a: 'boom', boom: null, fallback: null },
      policies: { onError: { goto: 'fallback' } },
      now: fakeClock()
    });
    const out = await g.run({});
    /* Recovery is a real recovery: the graph finishes DONE, the failed hop is
       still in `errors`, and the state carries what the fallback wrote. */
    assert.equal(out.ok, true);
    assert.equal(out.status, RUN_STATUS.DONE);
    assert.equal(out.state.recovered, true);
    assert.equal(out.errors.length, 1);
    assert.equal(out.trace[1].status, 'NODE_ERROR');
  });

  await test('a slow node is cut by nodeTimeoutMs, and retries are honoured', async () => {
    let attempts = 0;
    const slowNode = async () => { attempts += 1; await new Promise((r) => setTimeout(r, 40)); return { patch: { slow: true } }; };

    const aborting = createGraph({
      id: 'slow-abort', entry: 'slow', nodes: { slow: slowNode }, edges: { slow: null },
      policies: { nodeTimeoutMs: 10, onError: 'abort', retries: 1 }, now: Date.now
    });
    const out = await aborting.run({});
    assert.equal(attempts, 2, 'retries=1 must attempt twice before giving up');
    assert.equal(out.status, RUN_STATUS.NODE_TIMEOUT);
    assert.equal(out.errors[0].code, 'NODE_TIMEOUT');
    assert.equal(out.trace[0].attempts, 2);

    /* With a skip policy the same timeout is survivable: the hop is recorded
       in `errors`, the graph keeps going and the state has no half-patch. */
    let skipAttempts = 0;
    const skipping = createGraph({
      id: 'slow-skip', entry: 'slow',
      nodes: { slow: async () => { skipAttempts += 1; await new Promise((r) => setTimeout(r, 40)); return { patch: { slow: true } }; } },
      edges: { slow: null },
      policies: { nodeTimeoutMs: 10, onError: 'skip' }, now: Date.now
    });
    const soft = await skipping.run({});
    assert.equal(skipAttempts, 1);
    assert.equal(soft.status, RUN_STATUS.DONE);
    assert.equal(soft.state.slow, undefined);
    assert.equal(soft.errors[0].code, 'NODE_TIMEOUT');
  });

  await test('maxSteps stops a cycle and the deadline stops a long one', async () => {
    const loopy = createGraph({
      id: 'loop',
      entry: 'tick',
      nodes: { tick: ({ state }) => ({ patch: { n: (state.n || 0) + 1 } }) },
      edges: { tick: 'tick' },
      policies: { maxSteps: 4 },
      now: fakeClock()
    });
    const capped = await loopy.run({});
    assert.equal(capped.status, RUN_STATUS.STEP_LIMIT);
    assert.equal(capped.state.n, 4);
    assert.equal(capped.stoppedBy.code, 'STEP_LIMIT');

    const deadline = createGraph({
      id: 'deadline',
      entry: 'tick',
      nodes: { tick: async () => { await new Promise((r) => setTimeout(r, 12)); return {}; } },
      edges: { tick: 'tick' },
      policies: { deadlineMs: 35, nodeTimeoutMs: 50 },
      now: Date.now
    });
    const cut = await deadline.run({});
    assert.equal(cut.status, RUN_STATUS.BUDGET_EXCEEDED);
    assert.equal(cut.stoppedBy.code, 'DEADLINE');
  });

  await test('a checkpoint can resume without re-running finished nodes', async () => {
    const calls = [];
    const build = () => createGraph({
      id: 'resume',
      entry: 'a',
      nodes: {
        a: () => { calls.push('a'); return { patch: { a: 1 } }; },
        b: () => { calls.push('b'); return { patch: { b: 2 } }; },
        c: () => { calls.push('c'); return { patch: { c: 3 } }; }
      },
      edges: { a: 'b', b: 'c', c: null },
      now: fakeClock()
    });
    const first = await build().run({ state: {} });
    assert.deepEqual(calls, ['a', 'b', 'c']);
    const cp = checkpointOf(first);
    assert.equal(cp.node, null, 'a finished graph checkpoints on "no next node"');
    /* Interrupt after b: run again but stop at c via a checkpoint produced by
       a partial trace — exactly what a caller persists between turns. */
    const partial = { schema: GRAPH_SCHEMA, graphId: first.graphId, node: 'c', steps: 2, at: first.endedAt, state: { a: 1, b: 2 } };
    calls.length = 0;
    const resumed = await build().resume({ checkpoint: partial });
    assert.deepEqual(calls, ['c'], 'only the remaining node runs');
    assert.equal(resumed.state.c, 3);
    assert.deepEqual({ ...resumed.state }, { a: 1, b: 2, c: 3 });
  });

  await test('a custom reducer can merge patches instead of overwriting', async () => {
    const g = createGraph({
      id: 'reduce',
      entry: 'a',
      nodes: { a: () => ({ patch: { list: ['a'] } }), b: () => ({ patch: { list: ['b'] } }) },
      edges: { a: 'b', b: null },
      reduce: (state, patch) => ({
        ...state,
        ...patch,
        list: [...(state.list || []), ...(patch.list || [])]
      }),
      now: fakeClock()
    });
    const out = await g.run({});
    assert.deepEqual(out.state.list, ['a', 'b']);
  });

  await test('describe() publishes the topology that actually runs', async () => {
    const g = createGraph({
      id: 'described', version: '9.9.9', entry: 'a',
      nodes: { a: () => ({}), b: () => ({}), c: () => ({}) },
      edges: { a: [{ when: () => true, goto: 'b', why: 'ALWAYS' }], b: 'c', c: null },
      now: fakeClock()
    });
    const d = g.describe();
    assert.equal(d.schema, GRAPH_SCHEMA);
    assert.equal(d.id, 'described');
    assert.deepEqual(d.nodes, ['a', 'b', 'c']);
    assert.ok(d.edges.some((e) => e.from === 'a' && e.to === 'b' && e.kind === 'rule' && e.why === 'ALWAYS'));
    assert.ok(d.edges.some((e) => e.from === 'b' && e.to === 'c' && e.kind === 'static'));
    assert.equal(d.policies.maxSteps, 12);
  });

  await test('unknown entry and non-function nodes are refused loudly at build time', async () => {
    assert.throws(() => createGraph({ entry: 'missing', nodes: {} }), /GRAPH_ENTRY_NOT_A_NODE/);
    assert.throws(() => createGraph({ entry: 'a', nodes: { a: 'not a function' } }), /GRAPH_NODE_NOT_A_FUNCTION/);
    assert.throws(() => createGraph({ nodes: { a: () => ({}) } }), /GRAPH_ENTRY_REQUIRED/);
  });

  await test('an unknown node reached by an edge is reported, not silently ignored', async () => {
    const g = createGraph({
      id: 'unknown', entry: 'a',
      nodes: { a: () => ({ patch: { a: 1 } }) },
      edges: { a: 'ghost' },
      now: fakeClock()
    });
    const out = await g.run({});
    assert.equal(out.status, RUN_STATUS.UNKNOWN_NODE);
    assert.equal(out.stoppedBy.node, 'ghost');
  });

  console.log(`\n=== ORCHESTRATOR GRAPH PROBE: ${passed}/${total} passed ===\n`);
  if (passed !== total) process.exit(1);
}

runAll().catch((err) => { console.error(`\nGRAPH PROBE FAILED: ${err.message}\n`); process.exit(1); });
