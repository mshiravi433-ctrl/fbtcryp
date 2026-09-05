import { Router } from 'express';
import { createHash } from 'node:crypto';
import { storeGet, storeSet, storeDurable } from './store.js';
import {
  INTENT_OS_SERVER_SCHEMA,
  createAgentRun,
  createConversationRecord,
  createExecutionRecord,
  createGoalRecord,
  createIntentOSState,
  createIntentRecord,
  createMonitoringEvent,
  createQuestionRecord,
  createTaskRecord,
  createToolRun,
  nowMs
} from '../src/lib/intent-ai/os/upgrade8/contracts.js';
import { bindAnswerToState } from '../src/lib/intent-ai/os/upgrade8/questionEngine.js';

const router = Router();

const DEVICE_HEADER = 'x-fbt-device';
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SALT = process.env.FINANCIAL_GOALS_SALT || process.env.CRON_SECRET || 'fbt-intent-os-upgrade8';
const SECRET_RE = /(?:private[\s-]?key|seed[\s-]?phrase|mnemonic|passphrase|api[\s-]?secret|raw[\s-]?secret|secret key)/i;

const jsonClone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const safeText = (value, max = 4000) => String(value ?? '').replace(/[\u0000-\u001f\u200b-\u200f]/g, ' ').trim().slice(0, max);
const hashOwner = (value) => createHash('sha256').update(`${value}|${SALT}`).digest('hex').slice(0, 32);

function ownerFor(req) {
  if (req?.tgUser?.id) return `tg:${req.tgUser.id}`;
  const device = String(req?.get?.(DEVICE_HEADER) || '').trim();
  if (DEVICE_RE.test(device)) return `dev:${hashOwner(device)}`;
  return `ip:${String(req?.ip || 'anon').slice(0, 64)}`;
}

function rowKey(owner) {
  return `ai:os8:${owner}`;
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && SECRET_RE.test(value)) return null;
    return value;
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_RE.test(key)) continue;
    out[key] = stripSecrets(entry);
  }
  return out;
}

function sanitizeState(input = {}) {
  const state = createIntentOSState(stripSecrets(input));
  return {
    ...state,
    walletContext: state.walletContext
      ? {
          address: state.walletContext.address || null,
          chainId: state.walletContext.chainId || state.walletContext.chain || null,
          chainType: state.walletContext.chainType || null,
          connected: Boolean(state.walletContext.connected || state.walletContext.address),
          canSign: state.walletContext.canSign !== false,
          lastUpdated: Number(state.walletContext.lastUpdated) || nowMs()
        }
      : null,
    memory: {
      ...(state.memory || {}),
      shortTerm: Array.isArray(state.memory?.shortTerm)
        ? state.memory.shortTerm
            .map((item) => ({
              ...item,
              text: SECRET_RE.test(String(item?.text || '')) ? '' : safeText(item?.text || '', 400)
            }))
            .slice(-32)
        : [],
      taskMemory: Array.isArray(state.memory?.taskMemory)
        ? state.memory.taskMemory.map((item) => ({
            ...item,
            task: SECRET_RE.test(String(item?.task || '')) ? '' : safeText(item?.task || '', 280)
          })).slice(-32)
        : []
    },
    conversation: state.conversation
      ? {
          ...state.conversation,
          turns: Array.isArray(state.conversation.turns)
            ? state.conversation.turns.map((turn) => ({
                ...turn,
                text: SECRET_RE.test(String(turn?.text || '')) ? '' : safeText(turn?.text || '', 4000)
              })).slice(-200)
            : []
        }
      : null,
    lastUpdated: nowMs()
  };
}

async function readOwnerRecord(owner) {
  const stored = await storeGet(rowKey(owner), null);
  if (!stored || typeof stored !== 'object') {
    const state = createIntentOSState();
    return {
      schema: INTENT_OS_SERVER_SCHEMA,
      owner,
      durable: storeDurable(),
      state,
      createdAt: nowMs(),
      updatedAt: nowMs()
    };
  }
  return {
    schema: INTENT_OS_SERVER_SCHEMA,
    owner,
    durable: storeDurable(),
    state: createIntentOSState(stored.state || stored),
    createdAt: Number(stored.createdAt) || nowMs(),
    updatedAt: Number(stored.updatedAt) || nowMs()
  };
}

async function writeOwnerRecord(owner, state) {
  const now = nowMs();
  const current = await readOwnerRecord(owner);
  const next = {
    schema: INTENT_OS_SERVER_SCHEMA,
    owner,
    durable: storeDurable(),
    state: sanitizeState(state),
    createdAt: current.createdAt || now,
    updatedAt: now
  };
  await storeSet(rowKey(owner), next);
  return next;
}

function upsertById(list = [], field, record) {
  const rows = Array.isArray(list) ? list.slice() : [];
  const index = rows.findIndex((item) => String(item?.[field] || '') === String(record?.[field] || ''));
  if (index >= 0) rows[index] = { ...rows[index], ...record };
  else rows.push(record);
  return rows;
}

function findRecord(state, collection, idField, id) {
  return (state?.[collection] || []).find((item) => String(item?.[idField] || '') === String(id || '')) || null;
}

function sendError(res, status, code, detail = null) {
  return res.status(status).json({ ok: false, error: code, detail });
}

router.get('/state', async (req, res) => {
  const owner = ownerFor(req);
  const record = await readOwnerRecord(owner);
  return res.json({
    ok: true,
    schema: INTENT_OS_SERVER_SCHEMA,
    owner,
    durable: record.durable,
    state: record.state,
    updatedAt: record.updatedAt
  });
});

router.post('/state', async (req, res) => {
  const owner = ownerFor(req);
  const payload = req.body?.state || req.body || {};
  const record = await writeOwnerRecord(owner, payload);
  return res.json({ ok: true, schema: INTENT_OS_SERVER_SCHEMA, durable: record.durable, state: record.state, updatedAt: record.updatedAt });
});

router.post('/conversations', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const conversation = createConversationRecord({
    ...(current.state.conversation || {}),
    ...(req.body || {}),
    conversationId: req.body?.conversationId || current.state.conversationId,
    sessionId: req.body?.sessionId || current.state.sessionId,
    updatedAt: nowMs()
  });
  const state = {
    ...current.state,
    conversationId: conversation.conversationId,
    sessionId: conversation.sessionId,
    conversation,
    currentRoute: conversation.currentRoute || current.state.currentRoute,
    previousRoute: conversation.previousRoute || current.state.previousRoute,
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, conversation: saved.state.conversation, state: saved.state });
});

router.get('/conversations/:id', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  if (String(current.state.conversation?.conversationId || '') !== String(req.params.id || '')) {
    return sendError(res, 404, 'CONVERSATION_NOT_FOUND');
  }
  return res.json({ ok: true, conversation: current.state.conversation, state: current.state });
});

router.post('/intents', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const intent = createIntentRecord({
    conversationId: current.state.conversationId,
    ...(req.body || {}),
    updatedAt: nowMs()
  });
  const state = {
    ...current.state,
    activeIntent: req.body?.activate === false ? current.state.activeIntent : intent.intentId,
    intents: upsertById(current.state.intents, 'intentId', intent),
    conversation: {
      ...(current.state.conversation || {}),
      lastIntentId: intent.intentId,
      updatedAt: nowMs()
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, intent, state: saved.state });
});

router.get('/intents/:id', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const intent = findRecord(current.state, 'intents', 'intentId', req.params.id);
  if (!intent) return sendError(res, 404, 'INTENT_NOT_FOUND');
  return res.json({ ok: true, intent, state: current.state });
});

router.patch('/intents/:id', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const previous = findRecord(current.state, 'intents', 'intentId', req.params.id);
  if (!previous) return sendError(res, 404, 'INTENT_NOT_FOUND');
  const intent = createIntentRecord({ ...previous, ...(req.body || {}), intentId: previous.intentId, updatedAt: nowMs() });
  const state = {
    ...current.state,
    intents: upsertById(current.state.intents, 'intentId', intent),
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.json({ ok: true, intent, state: saved.state });
});

router.post('/intents/:id/resume', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const intent = findRecord(current.state, 'intents', 'intentId', req.params.id);
  if (!intent) return sendError(res, 404, 'INTENT_NOT_FOUND');
  const route = safeText(req.body?.route || current.state.currentRoute || '/intent', 160);
  const state = {
    ...current.state,
    activeIntent: intent.intentId,
    currentRoute: route,
    conversation: {
      ...(current.state.conversation || {}),
      status: current.state.pendingQuestion ? 'WAITING' : 'RESUMABLE',
      currentRoute: route,
      updatedAt: nowMs()
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.json({ ok: true, intent, state: saved.state, resumed: true });
});

router.post('/goals', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const goal = createGoalRecord({
    conversationId: current.state.conversationId,
    intentId: req.body?.intentId || current.state.activeIntent || null,
    ...(req.body || {}),
    updatedAt: nowMs()
  });
  const state = {
    ...current.state,
    activeGoal: req.body?.activate === false ? current.state.activeGoal : goal.goalId,
    goals: upsertById(current.state.goals, 'goalId', goal),
    conversation: {
      ...(current.state.conversation || {}),
      activeGoalId: goal.goalId,
      updatedAt: nowMs()
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, goal, state: saved.state });
});

router.get('/goals/:id', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const goal = findRecord(current.state, 'goals', 'goalId', req.params.id);
  if (!goal) return sendError(res, 404, 'GOAL_NOT_FOUND');
  return res.json({ ok: true, goal, state: current.state });
});

router.post('/tasks', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const task = createTaskRecord({
    intentId: req.body?.intentId || current.state.activeIntent || null,
    goalId: req.body?.goalId || current.state.activeGoal || null,
    ...(req.body || {}),
    updatedAt: nowMs()
  });
  const state = {
    ...current.state,
    activeTask: req.body?.activate === false ? current.state.activeTask : task.taskId,
    currentStep: task.currentStep,
    tasks: upsertById(current.state.tasks, 'taskId', task),
    conversation: {
      ...(current.state.conversation || {}),
      activeTaskId: task.taskId,
      updatedAt: nowMs()
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, task, state: saved.state });
});

router.get('/tasks/:id', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const task = findRecord(current.state, 'tasks', 'taskId', req.params.id);
  if (!task) return sendError(res, 404, 'TASK_NOT_FOUND');
  return res.json({ ok: true, task, state: current.state });
});

router.post('/questions', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const question = createQuestionRecord({
    intentId: req.body?.intentId || current.state.activeIntent || null,
    taskId: req.body?.taskId || current.state.activeTask || null,
    ...(req.body || {}),
    updatedAt: nowMs()
  });
  const state = {
    ...current.state,
    pendingQuestion: question.questionId,
    missingSlots: Array.from(new Set([...(current.state.missingSlots || []), question.slot])),
    questions: upsertById(current.state.questions, 'questionId', question),
    conversation: {
      ...(current.state.conversation || {}),
      activeQuestionId: question.questionId,
      status: 'WAITING',
      updatedAt: nowMs()
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, question, state: saved.state });
});

router.get('/questions/:id', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const question = findRecord(current.state, 'questions', 'questionId', req.params.id);
  if (!question) return sendError(res, 404, 'QUESTION_NOT_FOUND');
  return res.json({ ok: true, question, state: current.state });
});

router.post('/questions/:id/answers', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const question = findRecord(current.state, 'questions', 'questionId', req.params.id);
  if (!question) return sendError(res, 404, 'QUESTION_NOT_FOUND');
  const text = safeText(req.body?.text || req.body?.answer || '', 500);
  if (!text) return sendError(res, 400, 'EMPTY_ANSWER');
  const bound = bindAnswerToState({
    state: { ...current.state, pendingQuestion: question.questionId },
    text,
    question,
    timestamp: nowMs()
  });
  if (!bound.bound) return sendError(res, 409, 'ANSWER_AMBIGUOUS', bound.error || null);
  const saved = await writeOwnerRecord(owner, bound.state);
  return res.status(201).json({ ok: true, bound: bound.bound, state: saved.state });
});

router.post('/agent-runs', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const run = createAgentRun({
    intentId: req.body?.intentId || current.state.activeIntent || null,
    taskId: req.body?.taskId || current.state.activeTask || null,
    ...(req.body || {}),
    timestamp: nowMs()
  });
  const state = {
    ...current.state,
    agentState: {
      ...(current.state.agentState || {}),
      runs: [...(current.state.agentState?.runs || []), run].slice(-64)
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, run, state: saved.state });
});

router.post('/tool-runs', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const run = createToolRun({
    intentId: req.body?.intentId || current.state.activeIntent || null,
    taskId: req.body?.taskId || current.state.activeTask || null,
    ...(req.body || {}),
    timestamp: nowMs()
  });
  const state = {
    ...current.state,
    toolState: {
      ...(current.state.toolState || {}),
      runs: [...(current.state.toolState?.runs || []), run].slice(-64),
      freshness: {
        ...(current.state.toolState?.freshness || {}),
        [run.toolId]: run.freshAt || run.timestamp
      },
      health: {
        ...(current.state.toolState?.health || {}),
        [run.toolId]: run.result || { status: run.status }
      }
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, run, state: saved.state });
});

router.post('/executions', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const execution = createExecutionRecord({
    intentId: req.body?.intentId || current.state.activeIntent || null,
    taskId: req.body?.taskId || current.state.activeTask || null,
    ...(req.body || {}),
    updatedAt: nowMs()
  });
  const history = Array.isArray(current.state.executionState?.history) ? current.state.executionState.history.slice() : [];
  history.push(execution);
  const state = {
    ...current.state,
    executionState: {
      ...(current.state.executionState || {}),
      status: execution.status,
      executionId: execution.executionId,
      idempotencyKey: execution.idempotencyKey,
      lastSimulation: execution.simulation || current.state.executionState?.lastSimulation || null,
      lastConfirmation: execution.confirmation || current.state.executionState?.lastConfirmation || null,
      lastVerification: execution.verification || current.state.executionState?.lastVerification || null,
      pendingExecution: execution.action || current.state.executionState?.pendingExecution || null,
      history: history.slice(-24)
    },
    conversation: {
      ...(current.state.conversation || {}),
      status: ['confirmed', 'pending', 'submitted'].includes(String(execution.status || '').toLowerCase()) ? 'EXECUTING' : current.state.conversation?.status,
      updatedAt: nowMs()
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, execution, state: saved.state });
});

router.post('/monitoring-events', async (req, res) => {
  const owner = ownerFor(req);
  const current = await readOwnerRecord(owner);
  const event = createMonitoringEvent({
    goalId: req.body?.goalId || current.state.activeGoal || null,
    intentId: req.body?.intentId || current.state.activeIntent || null,
    executionId: req.body?.executionId || current.state.executionState?.executionId || null,
    ...(req.body || {}),
    createdAt: nowMs()
  });
  const state = {
    ...current.state,
    monitoringState: {
      ...(current.state.monitoringState || {}),
      status: 'active',
      events: [...(current.state.monitoringState?.events || []), event].slice(-64)
    },
    lastUpdated: nowMs()
  };
  const saved = await writeOwnerRecord(owner, state);
  return res.status(201).json({ ok: true, event, state: saved.state });
});

export default router;
