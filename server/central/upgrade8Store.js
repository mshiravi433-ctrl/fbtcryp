/** Upgrade 8 durable-in-process state facade.
 * The central API owns lifecycle records; React is a projection, never the source
 * of truth. A database adapter can replace this Map without changing endpoints.
 */
import { createIntentOSState, createGoal, createTask, createQuestion, createSimulation, sanitizeContext } from '../../src/lib/intent-ai/upgrade8/index.js';

const sessions = new Map();
function session(owner) { if (!sessions.has(owner)) sessions.set(owner, createIntentOSState({ sessionId: owner })); return sessions.get(owner); }
function save(owner, state) { sessions.set(owner, { ...state, lastUpdated: Date.now() }); return sessions.get(owner); }

export function getUpgrade8State(owner) { return session(owner); }
export function patchUpgrade8State(owner, patch = {}) { return save(owner, { ...session(owner), ...sanitizeContext(patch) }); }
export function startUpgrade8Intent(owner, { type, message, entities = {}, goal = null, steps = [] } = {}) {
  const state = session(owner);
  const activeIntent = { intentId: `intent_${Date.now().toString(36)}`, type: type || 'GENERIC', message: String(message || ''), entities, status: 'understanding', createdAt: Date.now(), updatedAt: Date.now() };
  const activeGoal = goal ? createGoal(goal) : state.activeGoal;
  const activeTask = steps.length ? createTask({ intentId: activeIntent.intentId, goalId: activeGoal?.goalId, steps }) : state.activeTask;
  return save(owner, { ...state, activeIntent, activeGoal, activeTask, conversationStatus: 'ACTIVE', currentStep: activeTask?.currentStep || null, collectedSlots: { ...state.collectedSlots, ...entities }, missingSlots: [] });
}
export function askUpgrade8Question(owner, question) { return save(owner, { ...session(owner), pendingQuestion: createQuestion(question), conversationStatus: 'WAITING' }); }
export function createUpgrade8Simulation(input) { return createSimulation(input); }
export function resetUpgrade8() { sessions.clear(); }
export const _upgrade8Sessions = sessions;
