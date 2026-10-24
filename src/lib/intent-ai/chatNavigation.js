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
  },
  /*
   * ─── PHASE 2/3 — COMMERCE INTENTS ROUTE TO THE SHOP, NOT TO THE SWAP ─────
   * «تشخیص نیت خرید گیفت‌کارت، کارت مجازی، شارژ موبایل، eSIM، پرواز/هتل و
   * ساخت فاکتور فروشنده» — somebody who says "buy a gift card" is not
   * describing a token trade, and the trading pipeline has nothing for them.
   * These targets answer with the one thing that actually completes the job:
   * the shop tab that sells it, pre-filtered.
   *
   * The `commerce` flag is what makes this safe to add: for a COMMERCE
   * target, a buy verb in the sentence is the intent itself, so the
   * "trade-shaped sentence" block does not apply — "خرید گیفت کارت steam"
   * must navigate. For every non-commerce target the old rule is untouched,
   * which is what keeps «swap usdt to bnb on intent os» a trade and never a
   * navigation. Questions are still answered, not navigated, for all.
   *
   * Availability is never claimed here: routing to a shop tab shows a real
   * catalogue the shopper then browses; nothing in this table pretends to
   * know a price, a fare or a stock level.
   */
  {
    id: 'shop-gift',
    route: '/shop?tab=cards',
    labelKey: 'intentAI.navigation.shopGift',
    commerce: true,
    match: (text) => /گیفت\s*‌?\s*کارت|گیفتکارت|کارت\s*‌?\s*هدیه|gift\s*cards?|استیم|steam(?:\s*card)?|پلی\s*استیشن|psn(?:\s*card|\s*کارت)?|PlayStation\s*گیف/i.test(text)
  },
  {
    id: 'shop-virtualcard',
    route: '/shop?tab=money',
    labelKey: 'intentAI.navigation.shopVirtualCard',
    commerce: true,
    match: (text) => /کارت\s*(?:اعتباری|افتراضی|مجازی|و\s*یزا)|virtual\s*card|prepaid\s*(?:visa|mastercard)|پی\s*‌?\s*پال|paypal|مستر\s*کارد|mastercard/i.test(text)
  },
  {
    id: 'shop-esim',
    route: '/shop?tab=topup',
    labelKey: 'intentAI.navigation.shopEsim',
    commerce: true,
    match: (text) => /e[\s-]?sim|ای[\s\u200c-]?سیم|سیم\s*کارت\s*(?:سفر|اینترنت|ملل)|اینترنت\s*(?:مسافرتی|سفر)/i.test(text)
  },
  {
    id: 'shop-topup',
    route: '/shop?tab=topup',
    labelKey: 'intentAI.navigation.shopTopUp',
    commerce: true,
    match: (text) => /شارژ\s*(?:موبایل|تلفن(?:\s*همراه)?|سیم\s*کارت|خط(?:\s*همراه)?|همراه\s*اول|ایرانسل|رایتل|اینترنت)|اعتبار\s*(?:موبایل|تلفن|سیم\s*کارت|شارژ)|(?:mobile|phone|sim)\s*(?:top\s*-?\s*up|recharge|credit)|top\s*-?\s*up\s*(?:my\s*)?(?:mobile|phone|sim)|recharge\s*(?:my\s*)?(?:mobile|phone|sim)/i.test(text)
  },
  {
    id: 'shop-flights',
    route: '/shop?tab=flights',
    labelKey: 'intentAI.navigation.shopFlights',
    commerce: true,
    match: (text) => /بلیط\s*هواپیما|بلیت\s*هواپیما|پرواز|flight|air\s*ticket/i.test(text)
  },
  {
    id: 'shop-stays',
    route: '/shop?tab=stays',
    labelKey: 'intentAI.navigation.shopStays',
    commerce: true,
    match: (text) => /هتل|اقامت\s*(?:هتل|فندق)?|hotel|room\s*booking|booking/i.test(text)
  },
  {
    id: 'shop-invoice',
    route: '/shop?tab=pay',
    labelKey: 'intentAI.navigation.shopInvoice',
    commerce: true,
    match: (text) => /فاکتور\s*(?:فروشنده|کسب)?|صورت\s*‌?\s*حساب|لینک\s*(?:دریافت|پرداخت)|ساخت\s*فاکتور|merchant\s*invoice|payment\s*(?:link|invoice)|invoice/i.test(text)
  },
  {
    id: 'shop-home',
    route: '/shop',
    labelKey: 'intentAI.navigation.shop',
    commerce: true,
    match: (text) => /فروشگاه|خرید\s*گیفت|shop\b|store\s*cards?/i.test(text)
  }
]);

/* A named brand is more useful than a generic shelf. Keep this table tiny and
   explicit: only slugs whose provider family is stable may be deep-linked;
   every other gift request still lands on the fully browsable cards tab. */
const GIFT_BRAND_DEEP_LINKS = Object.freeze([
  { slug: 'steam', match: /(?:\bsteam\b|استیم)/i }
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

  /*
   * A financial instruction that mentions the page stays a financial
   * instruction — the pipeline, not a route change, owns it.
   *
   * The exception is COMMERCE targets (the shop tabs): for them the buy verb
   * IS the request («خرید گیفت کارت»), there is no swap-shaped pipeline that
   * could honour it, and the tab it would route to is where the purchase
   * actually begins. Non-commerce targets keep the block untouched, so a
   * trade that merely mentions Intent OS never turns into a navigation.
   */
  if (!named.commerce && FINANCIAL_ACTION.test(text)) return { ok: false, reason: 'financial' };

  const giftBrand = named.id === 'shop-gift'
    ? GIFT_BRAND_DEEP_LINKS.find((brand) => brand.match.test(text))
    : null;
  const route = giftBrand ? `${named.route}&b=${giftBrand.slug}` : named.route;

  return {
    ok: true,
    target: named.id,
    route,
    labelKey: named.labelKey,
    ...(named.commerce ? { commerce: true } : {})
  };
}

/** The single source of the routes this layer may navigate to. */
export function navigationTargets() {
  return NAVIGATION_TARGETS.map(({ id, route, labelKey, commerce }) => ({
    id, route, labelKey, ...(commerce ? { commerce: true } : {})
  }));
}
