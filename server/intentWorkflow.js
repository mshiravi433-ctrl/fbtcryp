/**
 * Single-chain atomic workflow compiler (Phase 4a).
 * ---------------------------------------------------------------------------
 * Schema: fbt.workflow.v1 — a bounded DAG of planned nodes, not an
 * autonomous spending agent. A same-chain plan (every node on one chainId,
 * no bridge action) can be compiled into a user-signed IntentWorkflowBatch
 * envelope. Cross-chain / any-bridge plans stay draft-only
 * (ATOMIC_CROSS_CHAIN_UNAVAILABLE).
 *
 * Honesty, pinned in every compiled record:
 *   - The batcher never holds tokens or keys (no owner, no rescue).
 *   - Calldata is a PLANNED envelope (`liveRouterCalldata: false`): each
 *     call's data is the SHA-256 of the canonical node, not a live DEX
 *     router payload. The user still reviews and signs.
 *   - The contract does not verify call outputs against minOutput or
 *     postconditions (`verifiesCallOutputs: false`).
 *   - Subcall `msg.sender` is the batcher, not the user.
 *   - `executable` stays false on the public envelope: FBT never spends.
 */

import { createHash } from 'node:crypto';
import { Interface, ZeroAddress, isAddress } from 'ethers';
import { canonicalValue } from './intentSignatures.js';

export const WORKFLOW_SCHEMA = 'fbt.workflow.v1';
export const WORKFLOW_PROOF_SCHEMA = 'fbt.workflow-execution-proof.v1';
export const WORKFLOW_ID_DOMAIN = 'fbt.workflow.v1/id';
export const MIN_WORKFLOW_NODES = 2;
export const MAX_WORKFLOW_NODES = 8;
export const WORKFLOW_ACTIONS = Object.freeze(['swap', 'deposit', 'borrow', 'send', 'approve', 'bridge']);
export const REVERT_POLICIES = Object.freeze(['abort-all', 'continue', 'skip-remaining']);
export const APPROVAL_MODES = Object.freeze(['none', 'exact', 'unlimited']);
export const DEPENDENCIES = Object.freeze(['success', 'always']);
export const SUPPORTED_CHAINS = Object.freeze([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);

export const POLICY_ABORT_ALL = 0;
export const POLICY_CONTINUE = 1;
export const POLICY_SKIP_REMAINING = 2;

export const WORKFLOW_BATCH_ABI = Object.freeze([
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'workflowId', type: 'bytes32' },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'deadline', type: 'uint256' }
        ]
      },
      { name: 'policy', type: 'uint8' }
    ],
    outputs: [
      { name: 'ok', type: 'bool[]' },
      { name: 'results', type: 'bytes[]' }
    ]
  },
  {
    type: 'event',
    name: 'WorkflowBatchExecuted',
    anonymous: false,
    inputs: [
      { name: 'workflowId', type: 'bytes32', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'policy', type: 'uint8', indexed: false },
      { name: 'callCount', type: 'uint256', indexed: false },
      { name: 'successCount', type: 'uint256', indexed: false }
    ]
  },
  { type: 'error', name: 'EmptyCalls' },
  { type: 'error', name: 'TooManyCalls' },
  { type: 'error', name: 'BadPolicy' },
  { type: 'error', name: 'ZeroWorkflowId' },
  { type: 'error', name: 'CallDeadlinePassed' }
]);

const workflowInterface = new Interface(WORKFLOW_BATCH_ABI);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;
const SYMBOL_RE = /^[A-Za-z0-9.$₮_-]{1,16}$/;
const AMOUNT_RE = /^(0|[1-9][0-9]{0,77})(\.[0-9]{1,18})?$/;
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

const cleanNote = (value) => {
  if (value == null) return null;
  const cleaned = String(value).replace(/[<>"'`\\\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, 240) : null;
};

const cleanSymbol = (value) => String(value ?? '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9.$₮_-]/g, '')
  .slice(0, 16);

function isEvmAddress(value) {
  return typeof value === 'string' && isAddress(value);
}

function isAcyclic(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, []]));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) return false;
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const queue = [...ids].filter((id) => incoming.get(id) === 0);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift();
    seen += 1;
    for (const next of outgoing.get(id)) {
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  return seen === ids.size;
}

function validateApprovalScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return { ok: false, code: 'BAD_APPROVAL_SCOPE' };
  }
  if (!APPROVAL_MODES.includes(scope.mode)) return { ok: false, code: 'BAD_APPROVAL_SCOPE' };
  if (scope.mode === 'none') {
    return { ok: true, scope: { mode: 'none' } };
  }
  if (scope.token != null && !isEvmAddress(scope.token)) return { ok: false, code: 'BAD_APPROVAL_SCOPE' };
  if (scope.spender != null && !isEvmAddress(scope.spender)) return { ok: false, code: 'BAD_APPROVAL_SCOPE' };
  if (scope.mode === 'exact') {
    if (scope.maxAmount != null && !AMOUNT_RE.test(String(scope.maxAmount))) {
      return { ok: false, code: 'BAD_APPROVAL_SCOPE' };
    }
  }
  return {
    ok: true,
    scope: {
      mode: scope.mode,
      token: scope.token ? String(scope.token) : null,
      spender: scope.spender ? String(scope.spender) : null,
      maxAmount: scope.mode === 'exact' && scope.maxAmount != null ? String(scope.maxAmount) : null
    }
  };
}

function validateNode(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_WORKFLOW_NODE' };
  }
  const id = String(input.id || `step-${index + 1}`);
  if (!ID_RE.test(id)) return { ok: false, code: 'BAD_WORKFLOW_NODE' };
  if (!WORKFLOW_ACTIONS.includes(input.action)) return { ok: false, code: 'BAD_WORKFLOW_ACTION' };
  const chainId = Number(input.chainId);
  if (!Number.isInteger(chainId) || !SUPPORTED_CHAINS.includes(chainId)) {
    return { ok: false, code: 'BAD_WORKFLOW_CHAIN' };
  }
  const asset = cleanSymbol(input.asset);
  if (!SYMBOL_RE.test(asset)) return { ok: false, code: 'BAD_WORKFLOW_ASSET' };
  const minOutput = input.minOutput == null || String(input.minOutput).trim() === ''
    ? null : String(input.minOutput);
  const maxInput = input.maxInput == null || String(input.maxInput).trim() === ''
    ? null : String(input.maxInput);
  if (minOutput != null && !AMOUNT_RE.test(minOutput)) {
    return { ok: false, code: 'BAD_WORKFLOW_AMOUNT' };
  }
  if (maxInput != null && !AMOUNT_RE.test(maxInput)) {
    return { ok: false, code: 'BAD_WORKFLOW_AMOUNT' };
  }
  const deadline = Number(input.deadline);
  if (!Number.isSafeInteger(deadline) || deadline <= 0) return { ok: false, code: 'BAD_WORKFLOW_DEADLINE' };
  const allowed = Array.isArray(input.allowedContracts) ? input.allowedContracts : [];
  if (allowed.length > 8) return { ok: false, code: 'BAD_WORKFLOW_CONTRACTS' };
  if (allowed.some((row) => !isEvmAddress(row))) return { ok: false, code: 'BAD_WORKFLOW_CONTRACTS' };
  const revertPolicy = REVERT_POLICIES.includes(input.revertPolicy) ? input.revertPolicy : null;
  if (!revertPolicy) return { ok: false, code: 'BAD_REVERT_POLICY' };
  const approval = validateApprovalScope(input.approvalScope || { mode: 'none' });
  if (!approval.ok) return approval;
  return {
    ok: true,
    node: {
      id,
      action: input.action,
      chainId,
      asset,
      precondition: cleanNote(input.precondition),
      postcondition: cleanNote(input.postcondition),
      minOutput,
      maxInput,
      deadline,
      allowedContracts: allowed.map((row) => String(row)),
      revertPolicy,
      approvalScope: approval.scope
    }
  };
}

function validateEdge(input, nodeIds) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_WORKFLOW_EDGE' };
  }
  if (!nodeIds.has(String(input.from || '')) || !nodeIds.has(String(input.to || ''))) {
    return { ok: false, code: 'BAD_WORKFLOW_EDGE' };
  }
  if (String(input.from) === String(input.to)) return { ok: false, code: 'BAD_WORKFLOW_EDGE' };
  if (!DEPENDENCIES.includes(input.dependency)) return { ok: false, code: 'BAD_WORKFLOW_EDGE' };
  let valueBinding = null;
  if (input.valueBinding != null) {
    if (typeof input.valueBinding !== 'object' || Array.isArray(input.valueBinding)) {
      return { ok: false, code: 'BAD_VALUE_BINDING' };
    }
    const from = String(input.valueBinding.from || '');
    const to = String(input.valueBinding.to || '');
    if (!from || !to || from.length > 64 || to.length > 64) return { ok: false, code: 'BAD_VALUE_BINDING' };
    valueBinding = { from, to };
  }
  return {
    ok: true,
    edge: {
      from: String(input.from),
      to: String(input.to),
      dependency: input.dependency,
      valueBinding
    }
  };
}

/** Sequential success edges when the caller only supplied an ordered node list. */
export function sequentialEdges(nodes) {
  return nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    dependency: 'success',
    valueBinding: null
  }));
}

/**
 * Lift the legacy `steps[]` view (and the Compose UI) into fbt.workflow.v1.
 * Missing DAG fields get honest defaults: abort-all, no contracts, no
 * approval, no value binding.
 */
export function workflowFromLegacySteps(steps, { chainId, deadline } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const nodes = list.map((step, index) => ({
    id: String(step?.id || `step-${index + 1}`).slice(0, 32),
    action: step?.action,
    chainId: Number.isInteger(Number(step?.chainId)) ? Number(step.chainId) : Number(chainId),
    asset: step?.asset,
    precondition: step?.precondition ?? null,
    postcondition: step?.postcondition ?? null,
    minOutput: step?.minOutput ?? null,
    maxInput: step?.maxInput ?? null,
    deadline: Number.isSafeInteger(Number(step?.deadline)) ? Number(step.deadline) : Number(deadline),
    allowedContracts: Array.isArray(step?.allowedContracts) ? step.allowedContracts : [],
    revertPolicy: REVERT_POLICIES.includes(step?.revertPolicy) ? step.revertPolicy : 'abort-all',
    approvalScope: step?.approvalScope || { mode: 'none' }
  }));
  return { schema: WORKFLOW_SCHEMA, nodes, edges: sequentialEdges(nodes) };
}

/** Strict structural validation. Does not claim executability. */
export function validateWorkflow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_WORKFLOW' };
  }
  if (input.schema !== WORKFLOW_SCHEMA) return { ok: false, code: 'BAD_WORKFLOW_SCHEMA' };
  if (!Array.isArray(input.nodes)
    || input.nodes.length < MIN_WORKFLOW_NODES
    || input.nodes.length > MAX_WORKFLOW_NODES) {
    return { ok: false, code: 'BAD_WORKFLOW' };
  }
  const nodes = [];
  const seen = new Set();
  for (let i = 0; i < input.nodes.length; i += 1) {
    const checked = validateNode(input.nodes[i], i);
    if (!checked.ok) return checked;
    if (seen.has(checked.node.id)) return { ok: false, code: 'DUPLICATE_WORKFLOW_NODE' };
    seen.add(checked.node.id);
    nodes.push(checked.node);
  }
  const rawEdges = Array.isArray(input.edges) ? input.edges : sequentialEdges(nodes);
  if (rawEdges.length > MAX_WORKFLOW_NODES * MAX_WORKFLOW_NODES) {
    return { ok: false, code: 'BAD_WORKFLOW_EDGE' };
  }
  const edges = [];
  for (const row of rawEdges) {
    const checked = validateEdge(row, seen);
    if (!checked.ok) return checked;
    edges.push(checked.edge);
  }
  if (!isAcyclic(nodes, edges)) return { ok: false, code: 'WORKFLOW_CYCLE' };
  return { ok: true, workflow: { schema: WORKFLOW_SCHEMA, nodes, edges } };
}

/** Same-chain atomic candidate: one chainId, no bridge action. */
export function isSingleChainWorkflow(workflow) {
  const nodes = workflow?.nodes;
  if (!Array.isArray(nodes) || nodes.length < MIN_WORKFLOW_NODES) return false;
  if (nodes.some((node) => node.action === 'bridge')) return false;
  const chainId = nodes[0]?.chainId;
  return nodes.every((node) => node.chainId === chainId);
}

export function dominantRevertPolicy(nodes) {
  const first = nodes?.[0]?.revertPolicy;
  if (first && nodes.every((node) => node.revertPolicy === first)) return first;
  return 'abort-all';
}

export function policyCode(policy) {
  if (policy === 'continue') return POLICY_CONTINUE;
  if (policy === 'skip-remaining') return POLICY_SKIP_REMAINING;
  return POLICY_ABORT_ALL;
}

export function workflowIdFor(workflow) {
  return sha256Hex(`${WORKFLOW_ID_DOMAIN}\n${JSON.stringify(canonicalValue({
    schema: WORKFLOW_SCHEMA,
    nodes: workflow.nodes,
    edges: workflow.edges
  }))}`);
}

function plannedCalldataFor(node) {
  return sha256Hex(JSON.stringify(canonicalValue({
    domain: 'fbt.workflow.v1/node-plan',
    node
  })));
}

/**
 * Build the user-signed IntentWorkflowBatch envelope. Calldata is a planned
 * hash of each node — not a live router payload. `to` is null until
 * INTENT_WORKFLOW_BATCH_ADDRESS is a real public contract address.
 */
export function buildWorkflowBatchCalldata(input) {
  const checked = validateWorkflow(input);
  if (!checked.ok) return checked;
  if (!isSingleChainWorkflow(checked.workflow)) {
    return { ok: false, code: 'ATOMIC_CROSS_CHAIN_UNAVAILABLE' };
  }
  const workflowId = workflowIdFor(checked.workflow);
  if (!TX_RE_64.test(workflowId)) return { ok: false, code: 'BAD_WORKFLOW_ID' };
  const policy = dominantRevertPolicy(checked.workflow.nodes);
  const calls = checked.workflow.nodes.map((node) => {
    const target = isEvmAddress(node.allowedContracts[0]) ? node.allowedContracts[0] : ZeroAddress;
    return {
      target,
      value: 0n,
      data: plannedCalldataFor(node),
      deadline: node.deadline
    };
  });
  const data = workflowInterface.encodeFunctionData('execute', [workflowId, calls, policyCode(policy)]);
  const configured = configuredWorkflowBatchAddress();
  return {
    ok: true,
    workflowId,
    chainId: checked.workflow.nodes[0].chainId,
    policy,
    policyCode: policyCode(policy),
    to: configured,
    data,
    value: '0',
    liveRouterCalldata: false,
    verifiesCallOutputs: false,
    custody: false,
    holdsTokens: false,
    configured: Boolean(configured),
    callCount: calls.length,
    calls: calls.map((call, index) => ({
      nodeId: checked.workflow.nodes[index].id,
      target: call.target,
      value: '0',
      data: call.data,
      deadline: call.deadline
    }))
  };
}

export function configuredWorkflowBatchAddress(raw = process.env.INTENT_WORKFLOW_BATCH_ADDRESS || '') {
  const value = String(raw || '').trim();
  return isEvmAddress(value) ? value : null;
}

/** Capabilities block — configured flips only when a real address is set. */
export function workflowProtocolStatus({ address = configuredWorkflowBatchAddress() } = {}) {
  return {
    schema: WORKFLOW_SCHEMA,
    proofSchema: WORKFLOW_PROOF_SCHEMA,
    singleChainAtomic: true,
    crossChainAtomic: false,
    crossChainStateSchema: 'fbt.cross-chain-state.v1',
    crossChainReceiptSchema: 'fbt.cross-chain-leg-receipt.v1',
    crossChainSequentialSignatures: true,
    crossChainEnvelopeStatus: 'draft-only',
    crossChainEnvelopeBlockCode: 'ATOMIC_CROSS_CHAIN_UNAVAILABLE',
    maxNodes: MAX_WORKFLOW_NODES,
    minNodes: MIN_WORKFLOW_NODES,
    actions: [...WORKFLOW_ACTIONS],
    revertPolicies: [...REVERT_POLICIES],
    liveRouterCalldata: false,
    verifiesCallOutputs: false,
    custody: false,
    userSignatureRequired: true,
    executableByServer: false,
    contract: {
      name: 'IntentWorkflowBatch',
      custody: false,
      holdsTokens: false,
      verifiesCallOutputs: false,
      maxCalls: MAX_WORKFLOW_NODES,
      configured: Boolean(address),
      address
    }
  };
}

export { workflowInterface };
