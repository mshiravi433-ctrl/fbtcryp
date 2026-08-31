/**
 * FBT INTENT AI — CHAT NAVIGATION COMMANDS (Phase 208)
 * ---------------------------------------------------------------------------
 * "intent os" typed into the assistant is a request to OPEN the Intent OS
 * screen, not a trading instruction. This module is the deterministic
 * command layer that recognises it — the same pattern as the teach/recall
 * commands in taughtMemory.js: checked in the panel BEFORE the text ever
 * reaches the intent parser, because a parser is for money-shaped sentences
 * and a page request is neither money-shaped nor a clarification.
 *
 * Fail-closed, and deliberately conservative:
 *
 *   · only a phrase that actually NAMES the page navigates — "intent os",
 *     "intent-os", "intentos", the Persian "اینتنت او اس", and open-style
 *     phrasings around them ("باز کردن intent os", "open the intent os")
 *   · a QUESTION about the page is answered, never navigated
 *     ("intent os چیست", "what is intent os")
 *   · a sentence that also carries a financial instruction is a trade that
 *     happens to mention the page, not a page request ("swap 50 USDT to
 *     BNB on intent os") — the pipeline keeps it
 *   · navigation grants nothing: the returned shape carries no financial
 *     permission and never touches the Confirmation Gate
 */

/** Question markers — the assistant answers these instead of navigating. */
const QUESTION_MARKERS = /(چیست|چیه|یعنی|کجاست|چطور|how\s|what\s+is|what's|explain|توضیح|شرح)/i;

/*
 * A trade-shaped verb next to a page name means the sentence is about the
 * trade. "swap usdt to bnb intent os" must reach the planner, not a route
 * change. (An amount is not required: "swap usdt to bnb" names no digits
 * and is still unambiguously a trade.)
 */
const FINANCIAL_ACTION = /(swap|bridge|send|transfer|buy|sell|trade|convert|stake|farm|lend|borrow|futures|perps|خرید|فروش|تبدیل|مبادله|ارسال|فیوچرز|وام)/i;

/**
 * One entry per reachable screen. `match` is the page-name test; the rest
 * is what the chat reply and the hash navigation consume. Routes are the
 * app's hash paths (see App.jsx) without the leading '#'.
 */
const NAVIGATION_TARGETS = Object.freeze([
  {
    id: 'intent-os',
    route: '/intent',
    labelKey: 'intentAI.navigation.intentOS',
    match: (text) => (
      /* "intent os" / "intentos" / "intent-os" / "intent. os" / "INTENT OS" */
      /intent[\s\-_.]*os/i.test(text)
      /* Persian spelling: "اینتنت او اس" / "اینتنت اواس" / "اینتنت os" */
      || /اینتنت[\s\u200c\-_.]*(os|او\s?اس)/i.test(text)
    )
  }
]);

/**
 * Recognise a page request inside a chat message.
 *
 * @param {string} rawText
 * @returns {{ok: true, target: string, route: string, labelKey: string}
 *          |{ok: false, reason?: 'question'|'financial'|'unrecognised'}}
 */
export function parseNavigationCommand(rawText = '') {
  const text = String(rawText ?? '').trim();
  if (!text) return { ok: false, reason: 'unrecognised' };

  const named = NAVIGATION_TARGETS.find((target) => target.match(text));
  if (!named) return { ok: false, reason: 'unrecognised' };

  /* A question about the page is answered, not navigated. */
  if (QUESTION_MARKERS.test(text)) return { ok: false, reason: 'question' };

  /* A financial instruction that mentions the page stays a financial
     instruction — the pipeline, not a route change, owns it. */
  if (FINANCIAL_ACTION.test(text)) return { ok: false, reason: 'financial' };

  return {
    ok: true,
    target: named.id,
    route: named.route,
    labelKey: named.labelKey
  };
}

/** The single source of the routes this layer may navigate to. */
export function navigationTargets() {
  return NAVIGATION_TARGETS.map(({ id, route, labelKey }) => ({ id, route, labelKey }));
}
