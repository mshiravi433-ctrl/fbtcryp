/**
 * FBT INTENT OS 2.0 — Upgrade 8 domain primitives.
 *
 * This module is deliberately deterministic and provider agnostic. It is the
 * contract shared by the browser, the central API and tests: providers may
 * enrich a state, but they cannot replace its lifecycle, safety or identity.
 */

export const UPGRADE8_SCHEMA = 'fbt.intent-os.v2';
export const CONVERSATION_STATUSES = Object.freeze(['CREATED','ACTIVE','WAITING','NAVIGATING','EXECUTING','PAUSED','RESUMABLE','COMPLETED','FAILED','ARCHIVED']);
export const INTENT_STATUSES = Object.freeze(['created','understanding','clarifying','ready','planning','executing','verifying','monitoring','completed','cancelled','failed']);
export const TASK_STATUSES = Object.freeze(['pending','running','waiting','paused','completed','failed']);
export const PERMISSIONS = Object.freeze(['VIEW','ANALYZE','SIMULATE','RECOMMEND','NOTIFY','EXECUTE','RECURRING_EXECUTE']);

const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const now = () => Date.now();
const clone = (value) => JSON.parse(JSON.stringify(value));

export function createIntentOSState(input = {}) {
  const t = now();
  return {
    schema: UPGRADE8_SCHEMA,
    sessionId: input.sessionId || id('sess'),
    conversationId: input.conversationId || id('conv'),
    activeIntent: input.activeIntent || null,
    activeGoal: input.activeGoal || null,
    activeTask: input.activeTask || null,
    currentStep: input.currentStep || null,
    currentRoute: input.currentRoute || '/',
    previousRoute: input.previousRoute || null,
    pendingQuestion: input.pendingQuestion || null,
    collectedSlots: { ...(input.collectedSlots || {}) },
    missingSlots: [...(input.missingSlots || [])],
    walletContext: input.walletContext || null,
    portfolioContext: input.portfolioContext || null,
    agentState: input.agentState || { active: [], runs: [], conflicts: [] },
    toolState: input.toolState || { available: [], runs: [] },
    executionState: input.executionState || { status: 'idle', executionId: null, idempotencyKey: null, pendingTransaction: null },
    monitoringState: input.monitoringState || { status: 'idle', events: [], lastCheckedAt: null },
    conversationStatus: input.conversationStatus || 'CREATED',
    lastUpdated: t
  };
}

export function transition(value, allowed, next) {
  if (!allowed.includes(next)) throw new Error(`INVALID_STATUS:${next}`);
  return next;
}

export function createIntent({ type = 'GENERIC', message = '', entities = {}, goalId = null } = {}) {
  return { intentId: id('intent'), type, message, entities: { ...entities }, goalId, status: 'created', createdAt: now(), updatedAt: now() };
}

export function updateIntent(state, patch = {}) {
  const intent = state.activeIntent ? { ...state.activeIntent, ...patch, updatedAt: now() } : null;
  if (intent?.status && !INTENT_STATUSES.includes(intent.status)) throw new Error(`INVALID_INTENT_STATUS:${intent.status}`);
  return { ...state, activeIntent: intent, lastUpdated: now() };
}

export function createGoal({ title, target, horizonMonths = null, riskProfile = null, constraints = [] } = {}) {
  if (!title) throw new Error('GOAL_TITLE_REQUIRED');
  return { goalId: id('goal'), title, target: target ?? null, horizonMonths, riskProfile, constraints: [...constraints], status: 'active', progress: 0, createdAt: now(), updatedAt: now() };
}

export function createTask({ intentId, goalId = null, steps = [], currentStep = null } = {}) {
  if (!intentId) throw new Error('TASK_INTENT_REQUIRED');
  const normalized = steps.map((step, i) => typeof step === 'string' ? { stepId: id('step'), name: step, status: i === 0 ? 'running' : 'pending', checkpoint: false } : { stepId: step.stepId || id('step'), status: step.status || (i === 0 ? 'running' : 'pending'), checkpoint: Boolean(step.checkpoint), ...step });
  return { taskId: id('task'), intentId, goalId, status: normalized.length ? 'running' : 'pending', currentStep: currentStep || normalized[0]?.stepId || null, progress: 0, steps: normalized, createdAt: now(), updatedAt: now() };
}

export function updateTask(task, patch = {}) {
  const next = { ...task, ...patch, updatedAt: now() };
  if (!TASK_STATUSES.includes(next.status)) throw new Error(`INVALID_TASK_STATUS:${next.status}`);
  if (next.progress != null) next.progress = Math.max(0, Math.min(100, Number(next.progress) || 0));
  return next;
}

export function checkpoint(task, stepId, patch = {}) {
  const steps = (task.steps || []).map((step) => step.stepId === stepId ? { ...step, ...patch, status: patch.status || 'completed', completedAt: now() } : step);
  const completed = steps.filter((s) => s.status === 'completed').length;
  return updateTask({ ...task, steps, currentStep: steps.find((s) => s.status !== 'completed')?.stepId || null, progress: steps.length ? Math.round(completed / steps.length * 100) : 100 }, { status: completed === steps.length ? 'completed' : 'running' });
}

export function createQuestion({ intentId, slot, expectedType = 'string', required = true } = {}) {
  if (!intentId || !slot) throw new Error('QUESTION_BINDING_REQUIRED');
  return { questionId: id('question'), intentId, slot, expectedType, required: Boolean(required), createdAt: now(), status: 'active' };
}

export function bindAnswer(state, answer, question = state.pendingQuestion) {
  if (!question?.questionId) return { ok: false, error: 'NO_ACTIVE_QUESTION', state };
  const value = answer?.value ?? answer;
  if (value == null || String(value).trim?.() === '') return { ok: false, error: 'EMPTY_ANSWER', state };
  const pending = { ...question, status: 'answered', answeredAt: now(), answer: value };
  return { ok: true, slot: question.slot, value, state: { ...state, pendingQuestion: null, collectedSlots: { ...state.collectedSlots, [question.slot]: value }, missingSlots: state.missingSlots.filter((slot) => slot !== question.slot), lastUpdated: now() } };
}

const short = new Map([['yes', true], ['بله', true], ['آره', true], ['اره', true], ['حتما', true], ['do it', true], ['انجام بده', true], ['no', false], ['نه', false], ['خیر', false], ['cancel', false], ['لغو', false]]);
export function normalizeShortAnswer(text) { const value = String(text || '').trim().toLowerCase(); return short.has(value) ? short.get(value) : text; }

export function resolveReference(text, context = {}) {
  const value = String(text || '').trim().toLowerCase();
  const lists = [context.options, context.assets, context.wallets, context.items].filter(Array.isArray);
  const index = value === 'اولی' || value === 'first' || value === 'گزینه اول' || /(?:همون\s+)?(?:گزینه\s+)?اول/.test(value) ? 0 : value === 'دومی' || value === 'second' || value === 'گزینه دوم' || /(?:همون\s+)?(?:گزینه\s+)?دوم/.test(value) ? 1 : -1;
  if (index >= 0) return lists[0]?.[index] ?? null;
  if (['همون', 'همون قبلی', 'مثل قبل', 'same', 'same one', 'این', 'این یکی'].includes(value)) return context.lastExplicit ?? context.lastSelected ?? null;
  return null;
}

export function createAgentResult({ agentId, status = 'completed', result = null, confidence = 0, sources = [], latency = 0, error = null } = {}) { return { agentId, status, result, confidence: Math.max(0, Math.min(1, Number(confidence) || 0)), sources: [...sources], timestamp: now(), latency, error }; }

export async function runAgents(agents = [], input = {}) {
  const started = now();
  const results = await Promise.all(agents.map(async (agent) => { const t = now(); try { const result = await agent.run(input); return createAgentResult({ agentId: agent.agentId || agent.id, status: 'completed', result, confidence: agent.confidence ?? 0.5, sources: result?.sources || [], latency: now() - t }); } catch (error) { return createAgentResult({ agentId: agent.agentId || agent.id, status: 'failed', error: String(error?.message || error), latency: now() - t }); } }));
  const successful = results.filter((r) => r.status === 'completed');
  const confidence = successful.length ? successful.reduce((sum, r) => sum + r.confidence, 0) / successful.length : 0;
  return { results, confidence, latency: now() - started, conflicts: detectConflicts(results) };
}

export function detectConflicts(results = []) { const values = results.filter((r) => r.status === 'completed').map((r) => JSON.stringify(r.result)); return new Set(values).size > 1 && values.length > 1 ? [{ type: 'RESULT_DISAGREEMENT', agents: results.map((r) => r.agentId) }] : []; }

export function createExecution({ intentId, executionId = id('exec'), idempotencyKey = id('idem'), permission = 'EXECUTE' } = {}) { return { executionId, intentId, idempotencyKey, permission, status: 'prepared', pendingTransaction: null, createdAt: now(), updatedAt: now() }; }

export function executionAllowed(execution, { permission = 'VIEW', simulation = false, confirmed = false } = {}) { if (!PERMISSIONS.includes(permission)) return { ok: false, error: 'UNKNOWN_PERMISSION' }; if (permission !== 'EXECUTE' && permission !== 'RECURRING_EXECUTE') return { ok: false, error: 'EXECUTE_PERMISSION_REQUIRED' }; if (!simulation) return { ok: false, error: 'SIMULATION_REQUIRED' }; if (!confirmed) return { ok: false, error: 'USER_CONFIRMATION_REQUIRED' }; return { ok: true }; }

export function createSimulation({ scenario = 'base', assumptions = {}, inputs = {} } = {}) { if (!['bull','base','bear','stress'].includes(scenario)) throw new Error('UNKNOWN_SCENARIO'); return { simulationId: id('sim'), scenario, assumptions: { ...assumptions }, inputs: { ...inputs }, transactionCreated: false, status: 'completed', createdAt: now() }; }

export function createIdempotencyGuard() { const records = new Map(); return { claim(key, execution) { if (records.has(key)) return { ok: false, duplicate: true, execution: records.get(key) }; records.set(key, clone(execution)); return { ok: true, duplicate: false, execution }; }, get(key) { return records.get(key) || null; } }; }

export function sanitizeContext(input = {}) { const forbidden = /private.?key|seed|mnemonic|recovery.?phrase|secret|password/i; const walk = (value) => Array.isArray(value) ? value.map(walk) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, v]) => [key, walk(v)])) : value; return walk(input); }

export function createCheckpointRecovery(state, checkpoints = []) { const last = [...checkpoints].reverse().find((item) => item.status === 'completed'); return { state: { ...state, currentStep: last?.nextStep || state.currentStep, lastUpdated: now() }, recoveredFrom: last?.checkpointId || null }; }

export const upgrade8 = { createIntentOSState, createIntent, updateIntent, createGoal, createTask, updateTask, checkpoint, createQuestion, bindAnswer, normalizeShortAnswer, resolveReference, runAgents, createAgentResult, createExecution, executionAllowed, createSimulation, createIdempotencyGuard, sanitizeContext, createCheckpointRecovery };
