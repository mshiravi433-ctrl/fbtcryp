/**
 * FBT INTENT OS — Task Continuity
 * Spec §29
 * Task ID, State, Pending Action, Resume
 */

export const TASK_SCHEMA = 'fbt.task.v1';

const KEY = 'fbt.tasks.v1';
const MAX_TASKS = 20;

function safeRead() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function safeWrite(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_TASKS)));
  } catch {}
}

export function createTask({ intent, plan, context = {}, status = 'PENDING' } = {}) {
  const now = Date.now();
  const st = status || 'PENDING';
  return {
    id: `task_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    schema: TASK_SCHEMA,
    intent: intent?.type || intent || 'GENERAL',
    intentDetail: intent,
    plan,
    context: { currentPage: context.currentPage, walletConnected: context.wallet?.connected },
    status: st,
    pendingAction: plan?.actions?.[0] || null,
    createdAt: now,
    updatedAt: now,
    completedAt: st === 'COMPLETED' || st === 'FAILED' ? now : null
  };
}

export function saveTask(task) {
  const list = safeRead();
  const idx = list.findIndex(t => t.id === task.id);
  if (idx >= 0) list[idx] = { ...task, updatedAt: Date.now() };
  else list.push(task);
  safeWrite(list);
  return task;
}

export function getTask(id) {
  return safeRead().find(t => t.id === id) || null;
}

export function getActiveTasks() {
  return safeRead().filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
}

export function getLastActiveTask() {
  const active = getActiveTasks();
  return active.length ? active[active.length - 1] : null;
}

/** Most recent task of any status — used to resume a finished page-open offer. */
export function getLastTask() {
  const list = safeRead();
  return list.length ? list[list.length - 1] : null;
}

export function updateTaskStatus(id, status, extra = {}) {
  const list = safeRead();
  const idx = list.findIndex(t => t.id === id);
  if (idx < 0) return null;
  list[idx] = {
    ...list[idx],
    status,
    ...extra,
    updatedAt: Date.now(),
    completedAt: status === 'COMPLETED' || status === 'FAILED' ? Date.now() : list[idx].completedAt
  };
  safeWrite(list);
  return list[idx];
}

export function resumeTask(id) {
  const task = getTask(id);
  if (!task) return { ok: false, error: 'TASK_NOT_FOUND' };
  if (task.status === 'COMPLETED') return { ok: false, error: 'TASK_ALREADY_COMPLETED' };
  
  return {
    ok: true,
    task: { ...task, status: 'IN_PROGRESS', resumedAt: Date.now() },
    message: 'Resume active task?'
  };
}

export function clearCompletedTasks() {
  const list = safeRead().filter(t => t.status !== 'COMPLETED' && t.status !== 'FAILED');
  safeWrite(list);
}
