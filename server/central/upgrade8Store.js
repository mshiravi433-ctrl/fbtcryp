/** Upgrade 8 durable-in-process state facade.
 * The central API owns lifecycle records; React is a projection, never the source
 * of truth. A database adapter can replace this Map without changing endpoints.
 */
import { createIntentOSState, createGoal, createTask, createQuestion, createSimulation, bindAnswer, checkpoint, sanitizeContext } from '../../src/lib/intent-ai/upgrade8/index.js';
import { storeGet, storeSet, storeDurable } from '../store.js';

const sessions = new Map();
const keyFor = (owner) => `intent-os:v2:${String(owner).slice(0, 160)}`;
async function session(owner) {
  if (sessions.has(owner)) return sessions.get(owner);
  const persisted = await storeGet(keyFor(owner), null);
  const state = persisted && persisted.schema === 'fbt.intent-os.v2' ? persisted : createIntentOSState({ sessionId: owner });
  sessions.set(owner, state);
  return state;
}
async function save(owner, state) {
  const next = { ...state, lastUpdated: Date.now() };
  sessions.set(owner, next);
  if (storeDurable()) await storeSet(keyFor(owner), next);
  return next;
}

export async function getUpgrade8State(owner) { return session(owner); }
export async function patchUpgrade8State(owner, patch = {}) { return save(owner, { ...(await session(owner)), ...sanitizeContext(patch) }); }
export async function startUpgrade8Intent(owner, { type, message, entities = {}, goal = null, steps = [] } = {}) {
  const state = await session(owner);
  const activeIntent = { intentId: `intent_${Date.now().toString(36)}`, type: type || 'GENERIC', message: String(message || ''), entities, status: 'understanding', createdAt: Date.now(), updatedAt: Date.now() };
  const activeGoal = goal ? createGoal(goal) : state.activeGoal;
  const activeTask = steps.length ? createTask({ intentId: activeIntent.intentId, goalId: activeGoal?.goalId, steps }) : state.activeTask;
  return save(owner, { ...state, activeIntent, activeGoal, activeTask, conversationStatus: 'ACTIVE', currentStep: activeTask?.currentStep || null, collectedSlots: { ...state.collectedSlots, ...entities }, missingSlots: [] });
}
export async function askUpgrade8Question(owner, question) { return save(owner, { ...(await session(owner)), pendingQuestion: createQuestion(question), conversationStatus: 'WAITING' }); }
export async function answerUpgrade8Question(owner, answer) {
  const state = await session(owner);
  const result = bindAnswer(state, answer, state.pendingQuestion);
  if (!result.ok) return result;
  return { ...result, state: await save(owner, result.state) };
}
export async function checkpointUpgrade8Task(owner, stepId, patch = {}) {
  const state = await session(owner);
  if (!state.activeTask) return { ok: false, error: 'NO_ACTIVE_TASK' };
  const activeTask = checkpoint(state.activeTask, stepId, patch);
  return { ok: true, state: await save(owner, { ...state, activeTask, currentStep: activeTask.currentStep }) };
}
export function createUpgrade8Simulation(input) { return createSimulation(input); }
export function resetUpgrade8() { sessions.clear(); }
export const _upgrade8Sessions = sessions;
