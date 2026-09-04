/**
 * FBT AI / Intent OS — UPGRADE 6
 * Conversation State Machine + No Repetition + Self-Check + Response Memory Check
 * Spec §22, §33, §34, §35
 */

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  UNDERSTANDING: 'UNDERSTANDING',
  CLARIFYING: 'CLARIFYING',
  READY: 'READY',
  WORKING: 'WORKING',
  NAVIGATING: 'NAVIGATING',
  WAITING: 'WAITING',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
});

const TRANSITIONS = Object.freeze({
  IDLE: [STATES.UNDERSTANDING],
  UNDERSTANDING: [STATES.CLARIFYING, STATES.READY, STATES.WORKING, STATES.COMPLETED, STATES.FAILED],
  CLARIFYING: [STATES.UNDERSTANDING, STATES.READY, STATES.COMPLETED, STATES.FAILED],
  READY: [STATES.WORKING, STATES.NAVIGATING, STATES.EXECUTING, STATES.WAITING, STATES.COMPLETED],
  WORKING: [STATES.NAVIGATING, STATES.EXECUTING, STATES.VERIFYING, STATES.WAITING, STATES.COMPLETED, STATES.FAILED],
  NAVIGATING: [STATES.WAITING, STATES.WORKING, STATES.EXECUTING, STATES.COMPLETED, STATES.FAILED, STATES.IDLE],
  WAITING: [STATES.UNDERSTANDING, STATES.READY, STATES.WORKING, STATES.EXECUTING, STATES.COMPLETED, STATES.FAILED],
  EXECUTING: [STATES.VERIFYING, STATES.COMPLETED, STATES.FAILED, STATES.WAITING],
  VERIFYING: [STATES.COMPLETED, STATES.FAILED, STATES.EXECUTING, STATES.WORKING],
  COMPLETED: [STATES.IDLE, STATES.UNDERSTANDING], // Only via new user request
  FAILED: [STATES.IDLE, STATES.UNDERSTANDING]
});

export class ConversationStateMachine {
  constructor(initialState = STATES.IDLE) {
    this.current = initialState;
    this.history = [{ state: initialState, at: Date.now(), reason: 'init' }];
    this.context = {};
  }

  getState() {
    return this.current;
  }

  canTransition(to) {
    const allowed = TRANSITIONS[this.current] || [];
    return allowed.includes(to);
  }

  transition(to, { reason = null, context = null, force = false } = {}) {
    // Rule: No state should go back to IDLE without reason (§22)
    if (to === STATES.IDLE && this.current !== STATES.COMPLETED && this.current !== STATES.FAILED && !force) {
      if (!reason) {
        return { ok: false, reason: 'IDLE_REQUIRES_REASON', from: this.current, to };
      }
    }

    // Completed should not auto-transition except via new request
    if (this.current === STATES.COMPLETED && !force && to !== STATES.IDLE && to !== STATES.UNDERSTANDING) {
      return { ok: false, reason: 'COMPLETED_IS_TERMINAL', from: this.current, to };
    }

    if (!force && !this.canTransition(to)) {
      // Allow if force or if reason is new user request
      if (reason !== 'new_user_request' && reason !== 'user_request') {
        return { ok: false, reason: 'INVALID_TRANSITION', from: this.current, to, allowed: TRANSITIONS[this.current] };
      }
    }

    const prev = this.current;
    this.current = to;
    this.history.push({ from: prev, to, state: to, at: Date.now(), reason });
    if (context) this.context = { ...this.context, ...context };
    if (this.history.length > 100) this.history.shift();

    return { ok: true, from: prev, to, reason };
  }

  reset(reason = 'reset') {
    return this.transition(STATES.IDLE, { reason, force: true });
  }

  getHistory() {
    return [...this.history];
  }
}

/**
 * No Repetition Policy — Spec §33
 * Before AI response: Did I already ask? Did user already answer? Is answer stored? Is intent still active?
 */
export class NoRepetitionPolicy {
  check({ question, conversationState, intentId = null } = {}) {
    if (!question) return { shouldAsk: false, reason: 'no_question' };
    const qLower = String(question).toLowerCase().trim();
    const asked = conversationState?.questionsAsked || [];
    const slots = conversationState?.collectedSlots || {};
    const intentActive = conversationState?.intentId === intentId || !intentId ? true : false;

    // Did I already ask this question?
    const alreadyAsked = asked.some((item) => {
      const existing = String(item.question || item.expectedType || '').toLowerCase();
      return existing === qLower || existing.includes(qLower) || qLower.includes(existing);
    });
    if (alreadyAsked) {
      return { shouldAsk: false, reason: 'already_asked', question };
    }

    // Did user already answer it? Check slots
    // If question expects duration and we have timeframe, don't ask
    if (/مدت|بازه|timeframe|duration|forecast.*period/i.test(question)) {
      if (slots.timeframe || slots.forecastPeriod) {
        return { shouldAsk: false, reason: 'slot_already_filled', slot: 'timeframe', value: slots.timeframe || slots.forecastPeriod };
      }
    }
    if (/سرمایه|capital|amount|مقدار/i.test(question)) {
      if (slots.capital || slots.amount) {
        return { shouldAsk: false, reason: 'slot_already_filled', slot: 'capital', value: slots.capital || slots.amount };
      }
    }
    if (/ریسک|risk/i.test(question)) {
      if (slots.risk) {
        return { shouldAsk: false, reason: 'slot_already_filled', slot: 'risk', value: slots.risk };
      }
    }

    // Is intent still active? If completed, don't ask
    if (conversationState?.intentStatus === 'completed' && !intentActive) {
      return { shouldAsk: false, reason: 'intent_completed' };
    }

    return { shouldAsk: true, reason: 'not_asked_yet' };
  }
}

/**
 * Response Memory Check — Spec §34
 * Before generating: Context Retrieval → Task State → Last Question → User Answer → Available Data → Generate
 */
export class ResponseMemoryCheck {
  check(context = {}) {
    const {
      conversationState = null,
      currentIntent = null,
      taskState = null,
      availableData = {},
      lastMessage = null
    } = context;

    const checks = {
      hasContext: Boolean(conversationState),
      hasTaskState: Boolean(taskState || conversationState?.currentTask),
      hasLastQuestion: Boolean(conversationState?.lastQuestion),
      hasUserAnswer: Boolean(conversationState?.lastUserAnswer),
      hasAvailableData: Object.keys(availableData).length > 0,
      hasIntent: Boolean(currentIntent || conversationState?.currentIntent)
    };

    const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;

    return {
      ok: true,
      checks,
      score,
      contextSufficient: score >= 0.5,
      recommendation: score < 0.5 ? 'retrieve_more_context' : 'generate_response',
      retrieved: {
        conversationMemory: conversationState?.messages?.slice(-10) || [],
        taskState: taskState || conversationState?.currentTask,
        lastQuestion: conversationState?.lastQuestion,
        lastAnswer: conversationState?.lastUserAnswer,
        knownInfo: conversationState?.collectedSlots || {},
        missingInfo: conversationState?.missingSlots || [],
        availableData
      }
    };
  }
}

/**
 * AI Self-Check — Spec §35
 * Before sending: Context consistency, Intent consistency, Question-answer consistency, Navigation consistency, Wallet consistency, Tool consistency
 */
export class SelfCheck {
  check({ response, conversationState, intent, navigation, wallet, tool } = {}) {
    const issues = [];

    // Context consistency
    if (conversationState && response) {
      const responseText = String(response.message || response.content || '').toLowerCase();
      // If response asks for info already in slots, inconsistency
      if (conversationState.collectedSlots) {
        for (const [key, slot] of Object.entries(conversationState.collectedSlots)) {
          const val = slot?.value || slot;
          if (!val) continue;
          if (/مدت|بازه|چقدر.*طول/i.test(responseText) && (key === 'timeframe' || key === 'forecastPeriod')) {
            issues.push({ type: 'context_inconsistency', message: `Asking for timeframe but already have ${key}=${JSON.stringify(val)}`, severity: 'high' });
          }
        }
      }
    }

    // Intent consistency
    if (intent && conversationState?.currentIntent && intent.type !== conversationState.currentIntent) {
      // Allow if it's a follow-up or correction
      if (!intent.isFollowUp && !intent.isCorrection) {
        issues.push({ type: 'intent_inconsistency', message: `Response intent ${intent.type} differs from current ${conversationState.currentIntent}`, severity: 'medium' });
      }
    }

    // Question-answer consistency
    if (conversationState?.lastQuestionId && conversationState?.lastQuestion) {
      const expectedType = conversationState.lastQuestionType;
      const answer = conversationState.lastUserAnswer;
      if (expectedType && answer) {
        // If last question was duration and answer was duration, but response asks again → inconsistency
        if (response && /مدت.*چقدر|بازه.*چقدر/i.test(String(response.message || '')) && expectedType === 'duration') {
          issues.push({ type: 'qa_inconsistency', message: 'Asking duration again despite answer', severity: 'high' });
        }
      }
    }

    // Navigation consistency
    if (navigation) {
      if (navigation.target === conversationState?.currentRoute) {
        issues.push({ type: 'navigation_inconsistency', message: `Navigating to same route ${navigation.target}`, severity: 'medium' });
      }
      // Returning to chat should not trigger repeat navigation
      if (navigation.target !== '/intent' && conversationState?.currentRoute === '/intent' && conversationState?.previousRoute === navigation.target) {
        const recentNav = (conversationState.navigationHistory || []).slice(-2);
        const loop = recentNav.filter((n) => n.to === navigation.target).length >= 1;
        if (loop) {
          issues.push({ type: 'navigation_loop', message: `Potential navigation loop to ${navigation.target}`, severity: 'high' });
        }
      }
    }

    // Wallet consistency
    if (wallet) {
      if (wallet.connected === false && response?.requiresWallet) {
        issues.push({ type: 'wallet_inconsistency', message: 'Response requires wallet but wallet not connected', severity: 'medium' });
      }
    }

    // Tool consistency
    if (tool && response) {
      if (tool.requiresWallet && !wallet?.connected) {
        issues.push({ type: 'tool_inconsistency', message: `Tool ${tool.id} requires wallet`, severity: 'medium' });
      }
    }

    const hasHighSeverity = issues.some((i) => i.severity === 'high');
    return {
      ok: !hasHighSeverity,
      issues,
      hasIssues: issues.length > 0,
      shouldFix: hasHighSeverity,
      recommendation: hasHighSeverity ? 'fix_response' : issues.length ? 'review_response' : 'send_response'
    };
  }
}

// Singletons
let smInstance = null;
export function getStateMachine(initial = STATES.IDLE) {
  if (!smInstance) smInstance = new ConversationStateMachine(initial);
  return smInstance;
}

let nrInstance = null;
export function getNoRepetitionPolicy() {
  if (!nrInstance) nrInstance = new NoRepetitionPolicy();
  return nrInstance;
}

let rmInstance = null;
export function getResponseMemoryCheck() {
  if (!rmInstance) rmInstance = new ResponseMemoryCheck();
  return rmInstance;
}

let scInstance = null;
export function getSelfCheck() {
  if (!scInstance) scInstance = new SelfCheck();
  return scInstance;
}
