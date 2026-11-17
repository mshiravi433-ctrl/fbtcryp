/**
 * THE SESSION BRIDGE — CONVERSATION STATE AND EVENT REPLANNING
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The last two dark engines are not surfaces. They are MACHINERY.
 *
 * `server/fios/conversationState.js` is a state machine over a financial
 * conversation: DISCOVERY → UNDERSTANDING → CLARIFICATION → RESEARCH →
 * STRATEGY → SIMULATION → PROPOSAL → CONFIRMATION → EXECUTION →
 * VERIFICATION → MONITORING → REPLAN → COMPLETED, with legal edges, an
 * adaptive question bank that asks only for the fields the conversation
 * still lacks, and a rule that an illegal edge is REFUSED with the legal
 * edges named.
 *
 * `server/fios/eventReplanning.js` listens on the central event bus and
 * re-plans when the world moves: a price moved, a balance changed, the
 * risk level changed, a module degraded. It has cooldowns per trigger
 * family, so a busy market does not produce a replan storm.
 *
 * Both were built. Both were dark — and the reason is the same one the
 * other bridges exist for:
 *
 *   · `fios` is built AFTER the brain, and the brain is built BEFORE
 *     `fios`. Neither can hold the other at construction time.
 *
 * But there is a SECOND reason, and it is the important one. These two
 * engines are not user-facing CAPABILITIES. They are the layer UNDER the
 * capabilities: the conversation's own shape, and the machinery that
 * reacts when the world moves under a plan.
 *
 * Making them modules would be a lie of the same kind this repo keeps
 * fixing: a user-facing «replan my conversation» button is not what a
 * conversation-state machine IS. The right integration is:
 *
 *   · the TURN ingests the message into the conversation, advances the
 *     state, and asks the NEXT adaptive question when a field the
 *     current state needs is missing;
 *   · the EVENT BUS drives the replan, so a plan made before a price
 *     move is reconsidered after it.
 *
 * So this bridge exposes exactly two things to the session layer, and
 * the session layer uses them at the right moment.
 *
 * WHY NOT CALL THE ENGINES DIRECTLY
 *
 * The same reasons as every other bridge here, plus one: the engines sit
 * on the composition root's dependency graph, and importing them eagerly
 * from the brain would put them on the cold-start path of every
 * serverless instance.
 */

let conversationProvider = null;
let replanProvider = null;
let replanReader = null;

/**
 * Register the conversation-state reader.
 *
 * @param {(owner: string, opts?: object) => Promise<any>} fn
 *   Returns `{ ok, conversation, suggestion, question }`.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setConversationProvider(fn) {
  const previous = conversationProvider;
  conversationProvider = typeof fn === 'function' ? fn : null;
  return () => { conversationProvider = previous; };
}

/**
 * Register the event-replanning trigger.
 *
 * @param {(owner: string, opts?: object) => Promise<any>} fn
 *   Returns `{ ok, changed, notify }` — what changed and whether the
 *   owner should hear about it.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setReplanProvider(fn) {
  const previous = replanProvider;
  replanProvider = typeof fn === 'function' ? fn : null;
  return () => { replanProvider = previous; };
}

/**
 * Register the replan READER.
 *
 * The replanning engine writes its attempt; the session layer needs to
 * READ the last one, so the turn can say «the world moved and the plan
 * was reconsidered» instead of leaving the owner to notice the change
 * alone. It is a separate slot because reading and triggering are
 * different operations with different failure modes.
 *
 * @param {(owner: string, opts?: object) => Promise<any>} fn
 *   Returns `{ ok, replan }` — the last attempt, or null.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setReplanReader(fn) {
  const previous = replanReader;
  replanReader = typeof fn === 'function' ? fn : null;
  return () => { replanReader = previous; };
}

/** True once the replan reader has wired itself in. */
export function hasReplanReader() {
  return typeof replanReader === 'function';
}

/**
 * Read the last replan attempt for one owner.
 *
 * A missing attempt is NOT an error: most turns have no event to react
 * to. The caller gets `{ ok: true, replan: null }` and carries on.
 */
export async function readLastReplan(owner, { limit = 5 } = {}) {
  if (!hasReplanReader()) {
    return { ok: false, code: 'REPLAN_READER_NOT_WIRED', replan: null, attempts: [] };
  }
  try {
    const out = await replanReader(owner, { limit });
    if (!out || typeof out !== 'object') {
      return { ok: false, code: 'REPLAN_READER_BAD_RESULT', replan: null, attempts: [] };
    }
    if (out.ok === false) {
      return { ok: false, code: out.code || 'REPLAN_READ_FAILED', detail: out.detail || null, replan: null, attempts: [] };
    }
    return { ok: true, replan: out.replan || null, attempts: Array.isArray(out.attempts) ? out.attempts : [] };
  } catch (err) {
    return {
      ok: false,
      code: 'REPLAN_READ_FAILED',
      detail: String(err?.message || err).slice(0, 200) || null,
      replan: null,
      attempts: []
    };
  }
}

/** True once the conversation engine has wired itself in. */
export function hasConversationProvider() {
  return typeof conversationProvider === 'function';
}

/** True once the replanning engine has wired itself in. */
export function hasReplanProvider() {
  return typeof replanProvider === 'function';
}

/**
 * Ingest one user message into the conversation.
 *
 * This is the TURN's half of the machinery. It opens the conversation on
 * the first message, advances DISCOVERY → UNDERSTANDING, patches in what
 * the turn learned about the goal, and then asks the ONE question the
 * current state needs — the first missing field, not a questionnaire.
 *
 * A failure is a NAMED code. The turn does not die because the
 * conversation could not be advanced; it simply has no adaptive question
 * to ask this time.
 */
export async function ingestTurn(owner, { message = '', locale = 'fa', goalReasoning = null, patch = {} } = {}) {
  if (!hasConversationProvider()) {
    return {
      ok: false,
      code: 'CONVERSATION_PROVIDER_NOT_WIRED',
      detail: 'the conversation-state engine is not mounted in this process',
      conversation: null,
      suggestion: null,
      question: null
    };
  }
  try {
    const out = await conversationProvider(owner, { message, locale, goalReasoning, patch });
    if (!out || typeof out !== 'object') {
      return {
        ok: false,
        code: 'CONVERSATION_PROVIDER_BAD_RESULT',
        detail: 'the conversation engine returned something that is not a result',
        conversation: null,
        suggestion: null,
        question: null
      };
    }
    if (out.ok === false) {
      return {
        ok: false,
        code: out.code || 'CONVERSATION_FAILED',
        detail: out.detail || null,
        conversation: out.conversation || null,
        suggestion: out.suggestion || null,
        question: out.question || null
      };
    }
    return {
      ok: true,
      conversation: out.conversation || null,
      suggestion: out.suggestion || null,
      question: out.question || null,
      durable: out.durable ?? null
    };
  } catch (err) {
    return {
      ok: false,
      code: 'CONVERSATION_FAILED',
      detail: String(err?.message || err).slice(0, 200) || null,
      conversation: null,
      suggestion: null,
      question: null
    };
  }
}

/**
 * Re-plan for one owner after an event.
 *
 * This is the EVENT half of the machinery. The engine reads the macro
 * graph, the financial state, the risk view and the council, and says
 * what changed and whether the owner should be told.
 *
 * A cooldown is honoured by the engine, not here: the engine knows which
 * trigger families have a cooldown and how long they last.
 */
export async function replanFor(owner, { trigger = 'PRICE_CHANGED', payload = {}, correlationId = null } = {}) {
  if (!hasReplanProvider()) {
    return {
      ok: false,
      code: 'REPLAN_PROVIDER_NOT_WIRED',
      detail: 'the event-replanning engine is not mounted in this process',
      changed: false,
      notify: false
    };
  }
  try {
    const out = await replanProvider(owner, { trigger, payload, correlationId });
    if (!out || typeof out !== 'object') {
      return {
        ok: false,
        code: 'REPLAN_PROVIDER_BAD_RESULT',
        detail: 'the replanning engine returned something that is not a result',
        changed: false,
        notify: false
      };
    }
    if (out.ok === false) {
      return {
        ok: false,
        code: out.code || 'REPLAN_FAILED',
        detail: out.detail || null,
        changed: false,
        notify: false
      };
    }
    return {
      ok: true,
      changed: out.changed === true,
      notify: out.notify === true,
      skipped: out.skipped === true,
      reason: out.reason || null,
      retryInMs: out.retryInMs ?? null,
      summary: out.summary || null,
      trigger: out.trigger || trigger
    };
  } catch (err) {
    return {
      ok: false,
      code: 'REPLAN_FAILED',
      detail: String(err?.message || err).slice(0, 200) || null,
      changed: false,
      notify: false
    };
  }
}

/**
 * The conversation's own progression, as the turn layer sees it.
 *
 * This is a small, PURE helper — it does not call the engine — and it
 * exists because the turn layer needs to know ONE thing before it
 * composes a reply: does the current state still need a field, and which
 * one?
 *
 * The question is asked only when the conversation is in a state that
 * genuinely needs one. A conversation in RESEARCH does not need to be
 * asked for its goal; a conversation in CLARIFICATION does. That is the
 * machine's own rule, and the turn layer applies it rather than
 * re-inventing it.
 */
export function conversationNeedsInput(conversation, question) {
  if (!conversation || !question) return null;
  const state = String(conversation.state || '').toUpperCase();
  /* The states that ASK are the ones that consume a field. */
  const ASKING = new Set(['UNDERSTANDING', 'CLARIFICATION', 'STRATEGY', 'SIMULATION', 'PROPOSAL']);
  if (!ASKING.has(state)) return null;
  if (!question.question) return null;
  const locale = String(conversation.locale || 'fa');
  const text = question.question[locale] || question.question.fa || question.question.en || null;
  if (!text) return null;
  return {
    state,
    field: question.field || null,
    missing: Array.isArray(question.missing) ? question.missing : [],
    question: text
  };
}
