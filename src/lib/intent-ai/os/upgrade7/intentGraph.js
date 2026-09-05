/**
 * FBT INTENT OS — UPGRADE 7 · Intent Graph
 * ---------------------------------------------------------------------------
 * Spec §3 (graph with per-node state), §36 (think in outcomes).
 *
 * A plan is not a list — steps depend on each other, some run in parallel, and
 * one blocked node must not silently cancel the rest. The graph is a plain
 * serialisable object so it can live in localStorage and be resumed after the
 * user walks to Portfolio, Wallet, Swap and back (§6).
 */

export const INTENT_GRAPH_SCHEMA = 'fbt.intent-graph.v7';

export const NODE_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped'
});

const TERMINAL = new Set([NODE_STATUS.COMPLETED, NODE_STATUS.FAILED, NODE_STATUS.SKIPPED]);

function nid(prefix = 'node') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @param {object[]} nodes  [{ id, kind, label, labelFa, dependsOn:[], agent, tool, optional }]
 */
export function createIntentGraph({ intentId = null, goal = null, nodes = [] } = {}) {
  const built = nodes.map((n, i) => ({
    id: n.id || nid('n'),
    order: i,
    kind: n.kind || 'analysis',
    label: n.label || n.id || `step ${i + 1}`,
    labelFa: n.labelFa || null,
    dependsOn: Array.isArray(n.dependsOn) ? [...n.dependsOn] : [],
    agent: n.agent || null,
    tool: n.tool || null,
    optional: Boolean(n.optional),
    status: NODE_STATUS.PENDING,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    attempts: 0
  }));

  return {
    schema: INTENT_GRAPH_SCHEMA,
    graphId: nid('graph'),
    intentId: intentId || nid('intent'),
    goal,
    nodes: built,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function getNode(graph, nodeId) {
  return graph?.nodes?.find((n) => n.id === nodeId) || null;
}

/** Nodes whose dependencies are all satisfied and that have not run yet. */
export function readyNodes(graph) {
  if (!graph?.nodes) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.nodes.filter((n) => {
    if (n.status !== NODE_STATUS.PENDING) return false;
    return n.dependsOn.every((dep) => {
      const d = byId.get(dep);
      // An unknown dependency must not deadlock the graph.
      if (!d) return true;
      return d.status === NODE_STATUS.COMPLETED || d.status === NODE_STATUS.SKIPPED;
    });
  });
}

export function setNodeStatus(graph, nodeId, status, patch = {}) {
  const node = getNode(graph, nodeId);
  if (!node) return graph;
  node.status = status;
  if (status === NODE_STATUS.RUNNING) {
    node.startedAt = Date.now();
    node.attempts += 1;
  }
  if (TERMINAL.has(status)) node.finishedAt = Date.now();
  if ('result' in patch) node.result = patch.result;
  if ('error' in patch) node.error = patch.error;
  graph.updatedAt = Date.now();

  // A hard failure blocks only what actually depended on it (§3, §40 fallback).
  if (status === NODE_STATUS.FAILED && !node.optional) {
    for (const other of graph.nodes) {
      if (other.status === NODE_STATUS.PENDING && dependsTransitively(graph, other, nodeId)) {
        other.status = NODE_STATUS.BLOCKED;
        other.error = { code: 'UPSTREAM_FAILED', node: nodeId };
      }
    }
  }
  return graph;
}

function dependsTransitively(graph, node, targetId, seen = new Set()) {
  for (const dep of node.dependsOn) {
    if (dep === targetId) return true;
    if (seen.has(dep)) continue;
    seen.add(dep);
    const d = getNode(graph, dep);
    if (d && dependsTransitively(graph, d, targetId, seen)) return true;
  }
  return false;
}

/** §5 — pause a node because information is missing; the plan is NOT restarted. */
export function blockNodeForInput(graph, nodeId, { slot, question = null, questionId = null } = {}) {
  const node = getNode(graph, nodeId);
  if (!node) return graph;
  node.status = NODE_STATUS.BLOCKED;
  node.waitingFor = { slot, question, questionId, since: Date.now() };
  graph.updatedAt = Date.now();
  return graph;
}

/** §5/§6 — the answer arrived: unblock and continue from exactly where we were. */
export function resumeGraph(graph, { slot = null, value = undefined } = {}) {
  if (!graph?.nodes) return graph;
  for (const n of graph.nodes) {
    if (n.status === NODE_STATUS.BLOCKED) {
      const waitingSlot = n.waitingFor?.slot;
      if (!slot || !waitingSlot || waitingSlot === slot) {
        n.status = NODE_STATUS.PENDING;
        if (n.waitingFor && value !== undefined) n.waitingFor.answered = value;
        if (n.error?.code === 'UPSTREAM_FAILED') n.error = null;
      }
    }
  }
  graph.updatedAt = Date.now();
  return graph;
}

export function graphProgress(graph) {
  const nodes = graph?.nodes || [];
  const total = nodes.length || 1;
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const n of nodes) counts[n.status] = (counts[n.status] || 0) + 1;
  const done = counts.completed + counts.skipped + counts.failed;
  return {
    total: nodes.length,
    counts,
    percent: Math.round((done / total) * 100),
    isComplete: nodes.length > 0 && nodes.every((n) => TERMINAL.has(n.status)),
    isBlocked: counts.blocked > 0 && counts.running === 0 && readyNodes(graph).length === 0,
    currentNode: nodes.find((n) => n.status === NODE_STATUS.RUNNING) || readyNodes(graph)[0] || null
  };
}

/**
 * §4 — what the user is allowed to see. Status only, never the reasoning.
 */
export function graphStatusLines(graph, locale = 'fa') {
  const fa = String(locale || 'fa').startsWith('fa');
  return (graph?.nodes || [])
    .filter((n) => n.status !== NODE_STATUS.SKIPPED)
    .map((n) => ({
      id: n.id,
      status: n.status,
      label: fa ? (n.labelFa || n.label) : n.label
    }));
}

export function serializeGraph(graph) {
  try { return JSON.parse(JSON.stringify(graph)); } catch { return null; }
}
