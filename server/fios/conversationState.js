/**
 * FBT FINANCIAL INTELLIGENCE OS — Conversation State Machine (Phase 212, upgrades 17+19).
 * ---------------------------------------------------------------------------
 * The chat must stop starting from zero on every message. One state machine
 * carries a conversation from first contact to a completed plan:
 *
 *   DISCOVERY → UNDERSTANDING → CLARIFICATION → RESEARCH → STRATEGY →
 *   SIMULATION → PROPOSAL → CONFIRMATION → EXECUTION → VERIFICATION →
 *   MONITORING → REPLAN → COMPLETED
 *
 * Transitions are LEGAL-MOVE-ONLY (an illegal jump is refused with the reason,
 * like the central intent's own transition() law) and each state knows:
 *   - what it still needs (missing inputs), and
 *   - the NEXT ADAPTIVE QUESTION (upgrade 17): the question is chosen from
 *     what is actually missing in THIS conversation — a fixed questionnaire
 *     asks about the horizon even when the user just stated it.
 *
 * The machine is pure over a persisted state row (the engine keeps one
 * 'active' row per owner, capped history) and never grants execution: the
 * CONFIRMATION → EXECUTION edge requires the caller's own authority gates.
 */

import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';

export const CONVERSATION_STATE_SCHEMA = 'fbt.fi.conversation-state.v1';

export const CONVERSATION_STATES = Object.freeze([
  'DISCOVERY', 'UNDERSTANDING', 'CLARIFICATION', 'RESEARCH', 'STRATEGY',
  'SIMULATION', 'PROPOSAL', 'CONFIRMATION', 'EXECUTION', 'VERIFICATION',
  'MONITORING', 'REPLAN', 'COMPLETED'
]);

/** Legal forward edges. Back-edges exist only where honesty demands a redo. */
export const CONVERSATION_TRANSITIONS = Object.freeze({
  DISCOVERY: ['UNDERSTANDING'],
  UNDERSTANDING: ['CLARIFICATION', 'RESEARCH', 'STRATEGY'],
  CLARIFICATION: ['UNDERSTANDING', 'RESEARCH'],
  RESEARCH: ['STRATEGY', 'CLARIFICATION'],
  STRATEGY: ['SIMULATION', 'CLARIFICATION', 'PROPOSAL'],
  SIMULATION: ['PROPOSAL', 'STRATEGY'],
  PROPOSAL: ['CONFIRMATION', 'SIMULATION'],
  CONFIRMATION: ['EXECUTION', 'PROPOSAL'],
  EXECUTION: ['VERIFICATION', 'REPLAN'],
  VERIFICATION: ['MONITORING', 'REPLAN'],
  MONITORING: ['REPLAN', 'COMPLETED'],
  REPLAN: ['RESEARCH', 'STRATEGY', 'COMPLETED'],
  COMPLETED: ['DISCOVERY']
});

/** The adaptive question bank: each question exists because a FIELD is
 *  missing. The machine asks only for fields the conversation still lacks. */
export const QUESTION_BANK = Object.freeze({
  goal: { en: 'What is this money for — growth, income, or preservation?', fa: 'این پول برای چیست — رشد، درآمد، یا حفظ سرمایه؟' },
  targetReturnPct: { en: 'What return are you aiming for, in percent?', fa: 'چند درصد بازدهی هدف داری؟' },
  horizonMonths: { en: 'What is your time horizon?', fa: 'افق زمانی‌ات چقدر است؟' },
  maxDrawdownPct: { en: 'What is the maximum loss you could accept?', fa: 'حداکثر ضرری که می‌توانی قبول کنی چقدر است؟' },
  budgetUsd: { en: 'How much capital is involved?', fa: 'چقدر سرمایه درگیر است؟' },
  liquidityNeed: { en: 'Do you need this money liquid, or can it stay locked?', fa: 'به این پول نقد نیاز داری یا می‌تواند قفل بماند؟' }
});

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** What each state REQUIRES before it may advance. */
function requiredInputsFor(state, context = {}) {
  const reasoning = context.goalReasoning || {};
  switch (state) {
    case 'DISCOVERY':
    case 'UNDERSTANDING':
      return ['goal'];
    case 'CLARIFICATION':
      return ['goal', 'targetReturnPct', 'horizonMonths', 'maxDrawdownPct', 'budgetUsd'];
    case 'RESEARCH':
    case 'STRATEGY':
      return ['goal', 'targetReturnPct', 'horizonMonths'];
    case 'SIMULATION':
    case 'PROPOSAL':
      return ['goal', 'horizonMonths', 'maxDrawdownPct'];
    default:
      return [];
  }
}

/** The inputs that are present: stated in text, in the goal, or in the profile. */
export function presentInputs({ goalReasoning = null, goal = null, profile = null } = {}) {
  const r = goalReasoning || {};
  const has = (field) => {
    switch (field) {
      case 'goal': return Boolean(r.goal || goal?.type || profile?.goal);
      case 'targetReturnPct': return num(r.targetReturnPct) !== null || num(goal?.targetReturnPct) !== null;
      case 'horizonMonths': return num(r.horizonMonths) !== null || num(goal?.months) !== null || num(profile?.horizonMonths) !== null;
      case 'maxDrawdownPct': return num(r.maxDrawdownPct) !== null || num(goal?.maxDrawdownPct) !== null;
      case 'budgetUsd': return num(r.budgetUsd) !== null || num(goal?.startUsd) !== null || num(profile?.averagePositionUsd) !== null;
      case 'liquidityNeed': return Boolean(r.liquidityNeed || profile?.liquidityRequirement);
      default: return false;
    }
  };
  return ['goal', 'targetReturnPct', 'horizonMonths', 'maxDrawdownPct', 'budgetUsd', 'liquidityNeed'].filter(has);
}

/**
 * Compute the next adaptive question (upgrade 17): the FIRST missing field
 * the CURRENT state cares about. Null when everything the state needs is
 * present — the signal to advance, not to keep interrogating.
 */
export function nextAdaptiveQuestion(state, context = {}) {
  const required = requiredInputsFor(state, context);
  const present = new Set(presentInputs(context));
  const missing = required.filter((f) => !present.has(f));
  if (!missing.length) return { question: null, field: null, missing: [] };
  const field = missing[0];
  const locales = QUESTION_BANK[field] || { en: `Please provide: ${field}`, fa: `لطفاً مشخص کن: ${field}` };
  return { question: locales, field, missing, locales: ['fa', 'en'] };
}

/** Open a new conversation row. */
export function openConversation({ owner = null, locale = 'fa', message = null, now = Date.now() } = {}) {
  return {
    schema: CONVERSATION_STATE_SCHEMA,
    id: `cnv_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    owner,
    state: 'DISCOVERY',
    history: [{ at: now, state: 'DISCOVERY', note: message ? String(message).slice(0, 160) : 'conversation opened' }],
    turns: 0,
    locale,
    context: {},
    openedAt: now,
    updatedAt: now,
    decisionId: null,
    executionAuthorized: false
  };
}

/**
 * Advance (or refuse) a transition. Pure; returns the next row or a refusal
 * that names the illegal edge / missing inputs.
 */
export function advanceConversation(row, { to = null, note = null, patch = {}, now = Date.now() } = {}) {
  if (!row || row.schema !== CONVERSATION_STATE_SCHEMA) return { ok: false, code: 'NO_CONVERSATION' };
  const target = String(to || '').toUpperCase();
  if (!CONVERSATION_STATES.includes(target)) return { ok: false, code: 'UNKNOWN_STATE', allowed: CONVERSATION_STATES };
  const legal = CONVERSATION_TRANSITIONS[row.state] || [];
  if (!legal.includes(target)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: row.state, to: target, allowed: legal, detail: `a conversation cannot jump from ${row.state} to ${target}; legal edges are ${legal.join(', ')}` };
  }
  /* CONFIRMATION → EXECUTION keeps its own gate: the caller must have passed
   * the authority gates; this machine only records the flow. */
  const next = {
    ...row,
    state: target,
    context: { ...row.context, ...patch },
    history: [...(row.history || []), { at: now, state: target, note: note ? String(note).slice(0, 200) : null }].slice(-40),
    turns: (row.turns || 0) + 1,
    updatedAt: now
  };
  return { ok: true, conversation: next };
}

/** Where the conversation SHOULD go next given what it now knows. */
export function suggestNextState(row, context = {}) {
  const state = row?.state || 'DISCOVERY';
  const legal = CONVERSATION_TRANSITIONS[state] || [];
  const q = nextAdaptiveQuestion(state, { ...row.context, ...context });
  if (q.question && legal.includes('CLARIFICATION') && state !== 'CLARIFICATION' && state !== 'DISCOVERY') return { to: 'CLARIFICATION', because: `missing ${q.missing.join(', ')}`, question: q };
  if (state === 'DISCOVERY') return { to: 'UNDERSTANDING', because: 'a message arrived', question: q };
  for (const candidate of ['RESEARCH', 'STRATEGY', 'SIMULATION', 'PROPOSAL', 'CONFIRMATION', 'EXECUTION', 'VERIFICATION', 'MONITORING', 'COMPLETED']) {
    if (legal.includes(candidate)) return { to: candidate, because: `${state} is satisfied`, question: q };
  }
  return { to: state, because: 'no legal forward edge', question: q };
}

/** The engine wrapper: one active conversation per owner, capped history. */
export function createConversationStateEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function active(owner, { locale = 'fa' } = {}) {
    if (!collections) return { ok: false, code: 'COLUMNS_NOT_WIRED', conversation: null };
    const got = await collections.get('conversations', owner, 'active').catch(() => ({ ok: false }));
    if (got?.ok && got.row?.schema === CONVERSATION_STATE_SCHEMA) return { ok: true, conversation: got.row };
    const row = openConversation({ owner, locale, now: now() });
    await collections.put('conversations', owner, { ...row, id: 'active' }, { idKey: 'id' }).catch(() => {});
    return { ok: true, conversation: row };
  }

  /** Ingest a user message: patch context (goal reasoning), suggest the next state. */
  async function ingest(owner, { message = '', locale = 'fa', goalReasoning = null, patch = {} } = {}) {
    const gate = requireFlag('CONVERSATION_STATE_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const at = now();
    const got = await active(owner, { locale });
    if (!got.ok) return got;
    const contextPatch = { ...patch, ...(goalReasoning ? { goalReasoning } : {}) };
    /* DISCOVERY → UNDERSTANDING happens on the first real message. */
    let row = got.conversation;
    if (row.state === 'DISCOVERY' && String(message || '').trim()) {
      const adv = advanceConversation(row, { to: 'UNDERSTANDING', note: 'first message', patch: contextPatch, now: at });
      if (adv.ok) row = adv.conversation;
    } else {
      row = { ...row, context: { ...row.context, ...contextPatch }, turns: row.turns + 1, updatedAt: at };
    }
    const suggestion = suggestNextState(row, row.context);
    const question = nextAdaptiveQuestion(row.state, row.context);
    await collections?.put('conversations', owner, { ...row, id: 'active' }, { idKey: 'id' }).catch(() => {});
    if (observability) observability.emit({ type: 'conversation.ingested', owner, payload: { state: row.state, suggested: suggestion.to, missing: question.missing } });
    return { ok: true, conversation: row, suggestion, question, durable: collections?.durable() ?? null };
  }

  async function advance(owner, { to, note = null, patch = {} } = {}) {
    const at = now();
    const got = await active(owner, {});
    if (!got.ok) return got;
    const adv = advanceConversation(got.conversation, { to, note, patch, now: at });
    if (!adv.ok) return adv;
    await collections?.put('conversations', owner, { ...adv.conversation, id: 'active' }, { idKey: 'id' }).catch(() => {});
    return { ok: true, conversation: adv.conversation };
  }

  /** Close the active row into history and open a fresh one. */
  async function complete(owner) {
    const got = await active(owner, {});
    if (!got.ok) return got;
    const closed = { ...got.conversation, state: 'COMPLETED', closedAt: now() };
    await collections?.put('conversations', owner, closed, { idKey: 'id' }).catch(() => {});
    const fresh = openConversation({ owner, locale: closed.locale, now: now() });
    await collections?.put('conversations', owner, { ...fresh, id: 'active' }, { idKey: 'id' }).catch(() => {});
    return { ok: true, conversation: fresh, closed };
  }

  return { schema: CONVERSATION_STATE_SCHEMA, active, ingest, advance, complete, openConversation, advanceConversation, suggestNextState, nextAdaptiveQuestion, STATES: CONVERSATION_STATES };
}
