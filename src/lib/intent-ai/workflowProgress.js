/**
 * WORKFLOW STEP PROGRESS — WHAT THE USER SAYS THEY DID, AND NOTHING MORE.
 * ---------------------------------------------------------------------------
 * A compiled multi-step intent is not executed by Intent OS. Each step opens
 * the real venue screen (swap / bridge / loan / wallet) with this intent's
 * values already filled in, and the venue's own confirmation and the wallet
 * signature are what actually move money.
 *
 * That left one honest gap: after finishing a bridge and coming back, the
 * workflow looked untouched — the user had no way to say "that one is done"
 * and no list of what was left.
 *
 * This module closes that gap without ever lying about it:
 *
 *   · `opened`  — recorded automatically, because it is a fact this app knows:
 *                 the user pressed the step's button and we navigated there.
 *   · `done`    — recorded ONLY from a user action (the per-step "done" button,
 *                 or pressing restore on a saved intent, which confirms the
 *                 steps that were opened). It is self-reported, it is labelled
 *                 as self-reported in the UI, and it is always undoable.
 *
 * We deliberately do NOT infer completion from chain state. Reading a balance
 * cannot tell you whether THIS step is what changed it, and a guess presented
 * as a fact is exactly the class of bug this codebase keeps deleting.
 *
 * Storage is local to the browser, like the saved-intent drafts it mirrors.
 */

const KEY = 'fbt.intent-os.workflow-progress.v1';
const MAX_INTENTS = 40;

export const STEP_PENDING = 'pending';
export const STEP_OPENED = 'opened';
export const STEP_DONE = 'done';

const memoryFallback = new Map();

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readAll() {
  const store = storage();
  if (!store) return Object.fromEntries(memoryFallback);
  try {
    const raw = store.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  const entries = Object.entries(map)
    .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
    .slice(0, MAX_INTENTS);
  const trimmed = Object.fromEntries(entries);
  const store = storage();
  if (!store) {
    memoryFallback.clear();
    for (const [k, v] of entries) memoryFallback.set(k, v);
    return trimmed;
  }
  try {
    store.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* quota or private mode: the workflow still works, it just forgets. */
  }
  return trimmed;
}

const id = (value) => String(value ?? '').trim();

/** Raw record for one intent: `{ [stepId]: { status, route, openedAt, doneAt } }`. */
export function getIntentProgress(intentId) {
  const key = id(intentId);
  if (!key) return {};
  const row = readAll()[key];
  return row && typeof row.steps === 'object' && row.steps ? row.steps : {};
}

function patchStep(intentId, stepId, patch, now = Date.now()) {
  const key = id(intentId);
  const step = id(stepId);
  if (!key || !step) return {};
  const all = readAll();
  const row = all[key] && typeof all[key] === 'object' ? all[key] : {};
  const steps = row.steps && typeof row.steps === 'object' ? { ...row.steps } : {};
  steps[step] = { ...(steps[step] || {}), ...patch };
  all[key] = { steps, updatedAt: now };
  writeAll(all);
  return steps;
}

/** The user pressed a step's action button and we sent them to the venue. */
export function markStepOpened(intentId, stepId, route = '', now = Date.now()) {
  const current = getIntentProgress(intentId)[id(stepId)];
  /* Re-opening a step the user already ticked off must not silently undo it. */
  if (current?.status === STEP_DONE) return patchStep(intentId, stepId, { route: route || current.route || '', reopenedAt: now }, now);
  return patchStep(intentId, stepId, { status: STEP_OPENED, route: String(route || ''), openedAt: now }, now);
}

/** The user says this step is finished. Self-reported, always undoable. */
export function markStepDone(intentId, stepId, now = Date.now()) {
  return patchStep(intentId, stepId, { status: STEP_DONE, doneAt: now, selfReported: true }, now);
}

/** Undo — back to "opened" if it had been opened, otherwise untouched. */
export function markStepPending(intentId, stepId, now = Date.now()) {
  const current = getIntentProgress(intentId)[id(stepId)] || {};
  return patchStep(
    intentId,
    stepId,
    { status: current.openedAt ? STEP_OPENED : STEP_PENDING, doneAt: null, selfReported: false },
    now
  );
}

/**
 * Pressing "restore / continue" on a saved intent: every step the user was
 * sent to is taken at their word as finished, and the ids of the ones we just
 * flipped are returned so the screen can say exactly what it recorded.
 */
export function confirmOpenedSteps(intentId, now = Date.now()) {
  const key = id(intentId);
  if (!key) return { steps: {}, confirmed: [] };
  const all = readAll();
  const row = all[key];
  const steps = row && typeof row.steps === 'object' && row.steps ? { ...row.steps } : {};
  const confirmed = [];
  for (const [stepId, value] of Object.entries(steps)) {
    if (value?.status === STEP_OPENED) {
      steps[stepId] = { ...value, status: STEP_DONE, doneAt: now, selfReported: true };
      confirmed.push(stepId);
    }
  }
  if (confirmed.length) {
    all[key] = { steps, updatedAt: now };
    writeAll(all);
  }
  return { steps, confirmed };
}

export function clearIntentProgress(intentId) {
  const key = id(intentId);
  if (!key) return {};
  const all = readAll();
  delete all[key];
  writeAll(all);
  return {};
}

/**
 * Join the intent's step list with what we recorded, so a screen can render
 * the whole thing from one object: per-step status, counts, and the next step
 * that still has to happen.
 */
export function summarizeWorkflow(intent, progress = null) {
  const steps = Array.isArray(intent?.steps) ? intent.steps : [];
  const record = progress || getIntentProgress(intent?.id);
  const rows = steps.map((step, index) => {
    const entry = record[id(step?.id)] || {};
    const status = entry.status === STEP_DONE || entry.status === STEP_OPENED ? entry.status : STEP_PENDING;
    return {
      step,
      index,
      id: id(step?.id),
      action: String(step?.action || ''),
      status,
      selfReported: status === STEP_DONE && entry.selfReported === true,
      openedAt: entry.openedAt || null,
      doneAt: entry.doneAt || null,
      route: entry.route || ''
    };
  });
  const done = rows.filter((r) => r.status === STEP_DONE);
  const remaining = rows.filter((r) => r.status !== STEP_DONE);
  return {
    rows,
    total: rows.length,
    doneCount: done.length,
    openedCount: rows.filter((r) => r.status === STEP_OPENED).length,
    remaining,
    next: remaining[0] || null,
    complete: rows.length > 0 && remaining.length === 0,
    started: rows.some((r) => r.status !== STEP_PENDING)
  };
}
