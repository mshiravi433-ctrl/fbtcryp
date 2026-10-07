/**
 * FBT AI ORCHESTRATOR — REASONING GRAPH ENGINE (zero dependencies)
 * ---------------------------------------------------------------------------
 * The one idea worth taking from LangGraph (langchain-ai/langgraph, MIT) for a
 * Node app that must stay dependency-light and deployable on one small host:
 * a reasoning turn is a GRAPH of small steps over one shared state object —
 * not a 900-line if-chain. Nodes read state, return a patch and (optionally)
 * choose the next node; the engine owns the laws that a hand-written pipeline
 * keeps forgetting:
 *
 *   · a deadline and a step ceiling (a planner bug can never spin forever)
 *   · a per-node timeout (one slow model/data read cannot eat the turn)
 *   · a trace of every hop with its duration, patch keys and reason
 *   · checkpointing after every step, so a turn can be resumed or replayed
 *   · a failure policy per graph: abort, skip, or jump to a recovery node —
 *     never a half-applied state without a recorded error
 *
 * Why not LangGraph itself: it is a Python library (langgraph.js is a separate
 * port of a moving target) and this repository's server runs as one Vercel
 * function whose cold-start budget is already spent on the app. The semantics
 * above are ~250 lines of dependency-free code and are testable without a
 * network, which is exactly the property the AI path here needs most.
 *
 * Determinism: the engine never reads the clock or Math.random directly — both
 * are injectable (`now`), so probes can assert an exact trace.
 */

export const GRAPH_SCHEMA = 'fbt.reasoning-graph.v1';
export const GRAPH_VERSION = '1.0.0';

/** Terminal statuses a run can end in. Nothing else is a valid `status`. */
export const RUN_STATUS = Object.freeze({
  DONE: 'DONE',
  STOPPED: 'STOPPED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  STEP_LIMIT: 'STEP_LIMIT',
  NODE_ERROR: 'NODE_ERROR',
  NODE_TIMEOUT: 'NODE_TIMEOUT',
  UNKNOWN_NODE: 'UNKNOWN_NODE'
});

const DEFAULT_POLICIES = Object.freeze({
  maxSteps: 12,
  deadlineMs: 15_000,
  nodeTimeoutMs: 8_000,
  retries: 0,
  /** 'abort' | 'skip' | { goto: '<node>' } */
  onError: 'abort'
});

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Normalise a node's return value into the engine's step contract.
 * A node may return nothing (state untouched, follow the default edge) or:
 *   { patch, goto, stop, note, data }
 */
function normalizeStep(raw) {
  if (raw == null) return { patch: null, goto: undefined, stop: false, note: null, data: null };
  if (!isPlainObject(raw)) return { patch: null, goto: undefined, stop: false, note: null, data: raw };
  return {
    patch: isPlainObject(raw.patch) ? raw.patch : null,
    goto: typeof raw.goto === 'string' && raw.goto ? raw.goto : (raw.goto === null ? null : undefined),
    stop: raw.stop === true,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 240) : null,
    data: raw.data ?? null
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${ms}ms`);
        err.code = 'NODE_TIMEOUT';
        reject(err);
      }, Math.max(5, ms));
      /* deliberately NOT unref'd — a dropped timeout timer would leave the
         caller awaiting a promise that can never settle; always cleared. */
    })
  ]).finally(() => clearTimeout(timer));
}

/**
 * Build a graph.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.entry                     first node
 * @param {Record<string, Function>} spec.nodes   node name -> async (ctx) => stepResult
 * @param {Record<string, string|string[]|Function|Array>} spec.edges
 *        name -> next node | (state, meta) => name|null | [{ when, goto, why }]
 * @param {object} [spec.policies]
 * @param {() => number} [spec.now]
 */
export function createGraph({ id = 'graph', version = GRAPH_VERSION, entry, nodes = {}, edges = {}, policies = {}, now = Date.now, reduce = null } = {}) {
  if (!entry || typeof entry !== 'string') throw new Error('GRAPH_ENTRY_REQUIRED');
  if (!nodes[entry]) throw new Error(`GRAPH_ENTRY_NOT_A_NODE:${entry}`);
  for (const [name, fn] of Object.entries(nodes)) {
    if (typeof fn !== 'function') throw new Error(`GRAPH_NODE_NOT_A_FUNCTION:${name}`);
  }
  const P = Object.freeze({ ...DEFAULT_POLICIES, ...policies });

  /** Resolve the next node, with the reason so the trace can explain itself. */
  function nextNode(fromName, state, meta, explicit) {
    if (explicit === null) return { node: null, why: 'STOP_NODE_REQUESTED' };
    if (typeof explicit === 'string') return { node: explicit, why: 'NODE_GOTO' };
    const spec = edges[fromName];
    if (spec == null) return { node: null, why: 'NO_EDGE_END' };
    if (typeof spec === 'string') return { node: spec, why: 'EDGE_STATIC' };
    if (typeof spec === 'function') {
      const picked = spec(state, meta);
      return { node: picked || null, why: picked ? 'EDGE_FN' : 'EDGE_FN_END' };
    }
    if (Array.isArray(spec)) {
      // Declarative conditional edges: first matching rule wins.
      for (const rule of spec) {
        if (!rule) continue;
        if (typeof rule === 'string') return { node: rule, why: 'EDGE_RULE_DEFAULT' };
        const when = typeof rule.when === 'function' ? rule.when : () => true;
        let hit = false;
        try { hit = when(state, meta) === true; } catch { hit = false; }
        if (hit) return { node: rule.goto ?? null, why: rule.why || 'EDGE_RULE' };
      }
      return { node: null, why: 'NO_RULE_MATCHED_END' };
    }
    return { node: null, why: 'EDGE_UNKNOWN_END' };
  }

  /** Apply a patch without losing the previous state on a bad patch. */
  function applyPatch(state, patch) {
    if (!patch) return state;
    return reduce ? reduce(state, patch) : { ...state, ...patch };
  }

  async function runNode(name, ctx, traceRow) {
    const fn = nodes[name];
    if (!fn) return { error: { code: 'UNKNOWN_NODE', message: `node not found: ${name}` } };
    let attempt = 0;
    // retries: P.retries, or per-node via node.retries in the `edges` namespace
    const maxAttempts = Math.max(1, Math.min(3, Number(ctx.nodeRetries ?? P.retries) + 1));
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const raw = await withTimeout(fn(ctx), ctx.budget.nodeTimeoutMs, `node:${name}`);
        return { step: normalizeStep(raw), attempts: attempt };
      } catch (err) {
        const timedOut = err?.code === 'NODE_TIMEOUT';
        const last = attempt >= maxAttempts;
        traceRow.attempts = attempt;
        if (last) {
          return {
            error: {
              code: timedOut ? 'NODE_TIMEOUT' : 'NODE_ERROR',
              message: String(err?.message || err).slice(0, 200),
              node: name,
              attempts: attempt
            },
            attempts: attempt
          };
        }
      }
    }
    return { error: { code: 'NODE_ERROR', message: 'unreachable', node: name, attempts: attempt } };
  }

  return {
    id,
    version,
    schema: GRAPH_SCHEMA,
    policies: P,
    nodeNames: Object.keys(nodes),

    /** Topology, for the API and for humans debugging a bad answer. */
    describe() {
      const edgeRows = [];
      for (const [from, spec] of Object.entries(edges)) {
        if (typeof spec === 'string') edgeRows.push({ from, to: spec, kind: 'static' });
        else if (typeof spec === 'function') edgeRows.push({ from, to: '(fn)', kind: 'function' });
        else if (Array.isArray(spec)) {
          for (const rule of spec) {
            if (typeof rule === 'string') edgeRows.push({ from, to: rule, kind: 'default' });
            else edgeRows.push({ from, to: rule?.goto ?? '(end)', kind: 'rule', why: rule?.why || null });
          }
        }
      }
      return {
        schema: GRAPH_SCHEMA,
        id,
        version,
        entry,
        nodes: Object.keys(nodes),
        edges: edgeRows,
        policies: P
      };
    },

    /**
     * Execute the graph.
     *
     * @param {object} input
     * @param {object} [input.state]
     * @param {object} [input.budget]          { deadlineMs, maxSteps, nodeTimeoutMs }
     * @param {string} [input.startAt]         resume at a node (from a checkpoint)
     * @param {object} [input.checkpoint]      { node, state, steps } from a prior run
     * @param {Function} [input.onStep]        called with the trace row after each step
     * @param {object} [input.extra]           passed through to node ctx as `ctx.extra`
     */
    async run({ state = {}, budget = {}, startAt = null, checkpoint = null, onStep = null, extra = null } = {}) {
      const startedAt = now();
      const B = Object.freeze({
        deadlineMs: Math.max(20, Number(budget.deadlineMs ?? P.deadlineMs)),
        maxSteps: Math.max(1, Math.min(64, Number(budget.maxSteps ?? P.maxSteps))),
        nodeTimeoutMs: Math.max(5, Number(budget.nodeTimeoutMs ?? P.nodeTimeoutMs))
      });
      const resumeFrom = startAt || checkpoint?.node || null;
      let current = resumeFrom && nodes[resumeFrom] ? resumeFrom : entry;
      let shared = checkpoint?.state ? { ...checkpoint.state, ...state } : { ...state };
      const trace = [];
      const errors = [];
      let steps = Number(checkpoint?.steps || 0);
      let status = RUN_STATUS.DONE;
      let stoppedBy = null;

      while (current) {
        if (steps >= B.maxSteps) { status = RUN_STATUS.STEP_LIMIT; stoppedBy = { code: 'STEP_LIMIT', maxSteps: B.maxSteps }; break; }
        if (now() - startedAt >= B.deadlineMs) { status = RUN_STATUS.BUDGET_EXCEEDED; stoppedBy = { code: 'DEADLINE', deadlineMs: B.deadlineMs }; break; }
        if (!nodes[current]) { status = RUN_STATUS.UNKNOWN_NODE; stoppedBy = { code: 'UNKNOWN_NODE', node: current }; break; }

        const nodeStarted = now();
        const row = { i: steps, node: current, at: nodeStarted, ok: false, status: 'RUNNING' };
        steps += 1;
        const ctx = {
          state: shared,
          step: steps,
          node: current,
          budget: B,
          now,
          extra,
          /** Node helper: write into the shared state immediately (patches are preferred). */
          set: (patch) => { shared = applyPatch(shared, patch); },
          log: (label, payload) => { row[label] = payload; }
        };
        const { step, error, attempts } = await runNode(current, ctx, row);
        row.durationMs = now() - nodeStarted;
        row.attempts = attempts ?? row.attempts ?? 1;

        if (error) {
          errors.push(error);
          row.ok = false;
          row.status = error.code;
          row.error = error.message;
          trace.push(row);
          onStep?.(row, shared);
          const policy = P.onError;
          if (policy === 'skip') {
            const { node: nn, why } = nextNode(current, shared, { error }, undefined);
            row.next = nn;
            row.why = `${why}:AFTER_ERROR_SKIP`;
            if (!nn) { status = RUN_STATUS.DONE; break; }
            current = nn;
            continue;
          }
          if (policy && typeof policy === 'object' && policy.goto && nodes[policy.goto]) {
            row.next = policy.goto;
            row.why = 'ERROR_RECOVERY_NODE';
            current = policy.goto;
            continue;
          }
          status = error.code === 'NODE_TIMEOUT' ? RUN_STATUS.NODE_TIMEOUT : RUN_STATUS.NODE_ERROR;
          stoppedBy = error;
          break;
        }

        const patchKeys = step.patch ? Object.keys(step.patch) : [];
        shared = applyPatch(shared, step.patch);
        row.ok = true;
        row.status = step.stop ? 'STOPPED' : 'OK';
        row.patched = patchKeys;
        if (step.note) row.note = step.note;
        if (step.data !== null && step.data !== undefined) row.data = step.data;
        if (step.stop) {
          row.next = null;
          row.why = 'NODE_STOP';
          trace.push(row);
          onStep?.(row, shared);
          status = RUN_STATUS.STOPPED;
          stoppedBy = { code: 'NODE_STOP', node: current };
          break;
        }

        const { node: nn, why } = nextNode(current, shared, { step: row }, step.goto);
        row.next = nn;
        row.why = why;
        trace.push(row);
        onStep?.(row, shared);
        current = nn;
      }

      const endedAt = now();
      return {
        ok: status === RUN_STATUS.DONE || status === RUN_STATUS.STOPPED,
        graphId: id,
        graphVersion: version,
        schema: GRAPH_SCHEMA,
        status,
        stoppedBy,
        state: shared,
        trace,
        steps,
        errors,
        reachedEnd: current === null,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        budget: B
      };
    },

    /**
     * Continue a run from a checkpoint produced by `run` (or by an aborted
     * turn). The state is the checkpoint's state merged with `state`.
     */
    async resume({ checkpoint, state = {}, budget = {}, onStep = null, extra = null } = {}) {
      if (!checkpoint?.node) throw new Error('CHECKPOINT_NODE_REQUIRED');
      return this.run({ state, budget, startAt: checkpoint.node, checkpoint, onStep, extra });
    }
  };
}

/**
 * The checkpoint contract: what a caller persists between turns.
 *
 * `node` is the node that would run NEXT — deliberately null for a finished
 * graph, because resuming a finished run must not re-execute its last node.
 * `done` says so explicitly so a caller does not have to infer it.
 */
export function checkpointOf(run, { node = null } = {}) {
  if (!run || !Array.isArray(run.trace) || !run.trace.length) return null;
  const last = run.trace[run.trace.length - 1];
  const nextNode = node ?? last.next ?? null;
  return {
    schema: GRAPH_SCHEMA,
    graphId: run.graphId,
    node: nextNode,
    done: nextNode == null,
    steps: run.steps,
    at: run.endedAt,
    status: run.status,
    state: run.state
  };
}

export default createGraph;
