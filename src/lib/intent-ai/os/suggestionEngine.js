/**
 * FBT INTENT OS — Contextual suggestion chips.
 * ---------------------------------------------------------------------------
 * The chips under the composer. Each is a `{ id, label, prompt }`: the label
 * is what the user reads, the prompt is what gets sent when they tap it.
 *
 * ─── WHY THIS WAS REWRITTEN ─────────────────────────────────────────────────
 * The templates were a single hard-coded set with the two languages mixed
 * inside one string — «Yieldهای مناسب», «Portfolio Rebalance», «تنظیم
 * Slippage». A Persian user got half-English chips no matter what the app
 * language was, and an English user got Persian ones, because there was only
 * ever one list. That is a large part of the "the UI is in English" report:
 * the chips are the most-looked-at text on the screen.
 *
 * ─── THE PROMPT MUST STAY PARSEABLE ─────────────────────────────────────────
 * A chip's `prompt` is fed straight back into `understandIntent`. So the
 * prompt is not a free translation of the label — it is written in words the
 * parser's lexicon actually contains, and every one of them is covered by the
 * acceptance corpus in intentUnderstanding.js. Translating a label is safe;
 * translating a prompt into a phrase the parser does not know would produce a
 * chip that visibly does nothing when tapped.
 */

export const SUGGESTION_SCHEMA = 'fbt.suggestion.v2';

/** 'fa-IR' → 'fa'; anything unrecognised reads as English. */
function langOf(locale) {
  const tag = String(locale || 'fa').toLowerCase();
  if (tag.startsWith('fa')) return 'fa';
  if (tag.startsWith('ar')) return 'ar';
  return 'en';
}

/**
 * Chip definitions. `label` is per-language; `prompt` is per-language too,
 * because the parser handles Persian and English natively and each should be
 * asked in its own words.
 *
 * Arabic falls back to the English prompt on purpose: the parser's lexicon has
 * no Arabic entries, so an Arabic prompt would not classify. The label is
 * translated so the chip reads correctly; the prompt stays in a language the
 * parser understands. Better a chip that reads Arabic and works than one that
 * reads Arabic and silently fails.
 */
const CHIPS = Object.freeze({
  yield_discover: {
    fa: { label: 'فرصت‌های سود', prompt: 'بهترین فرصت سود را پیدا کن' },
    ar: { label: 'فرص العائد', prompt: 'find the best yield' },
    en: { label: 'Yield opportunities', prompt: 'find the best yield' }
  },
  dca: {
    fa: { label: 'خرید پلکانی', prompt: 'یک برنامه خرید پلکانی بساز' },
    ar: { label: 'شراء دوري', prompt: 'create a DCA plan' },
    en: { label: 'Recurring buy', prompt: 'create a DCA plan' }
  },
  rebalance: {
    fa: { label: 'متعادل‌سازی', prompt: 'پرتفوی من را متعادل کن' },
    ar: { label: 'إعادة التوازن', prompt: 'rebalance my portfolio' },
    en: { label: 'Rebalance', prompt: 'rebalance my portfolio' }
  },
  risk: {
    fa: { label: 'بررسی ریسک', prompt: 'ریسک پرتفوی من چقدر است' },
    ar: { label: 'فحص المخاطر', prompt: 'what is my portfolio risk' },
    en: { label: 'Risk check', prompt: 'what is my portfolio risk' }
  },
  analyze_portfolio: {
    fa: { label: 'تحلیل پرتفوی', prompt: 'پرتفوی من را تحلیل کن' },
    ar: { label: 'تحليل المحفظة', prompt: 'analyze my portfolio' },
    en: { label: 'Analyze portfolio', prompt: 'analyze my portfolio' }
  },
  balance: {
    fa: { label: 'موجودی', prompt: 'موجودی من را بررسی کن' },
    ar: { label: 'الرصيد', prompt: 'check my balance' },
    en: { label: 'Balances', prompt: 'check my balance' }
  },
  history: {
    fa: { label: 'تاریخچه', prompt: 'تاریخچه تراکنش‌ها' },
    ar: { label: 'السجل', prompt: 'transaction history' },
    en: { label: 'History', prompt: 'transaction history' }
  },
  send: {
    fa: { label: 'ارسال', prompt: 'ارسال دارایی' },
    ar: { label: 'إرسال', prompt: 'send a token' },
    en: { label: 'Send', prompt: 'send a token' }
  },
  market_overview: {
    fa: { label: 'وضعیت بازار', prompt: 'بازار را بررسی کن' },
    ar: { label: 'حالة السوق', prompt: 'check the market' },
    en: { label: 'Market overview', prompt: 'check the market' }
  },
  smart_money: {
    fa: { label: 'پول هوشمند', prompt: 'اسمارت مانی را بررسی کن' },
    ar: { label: 'المال الذكي', prompt: 'check smart money' },
    en: { label: 'Smart money', prompt: 'check smart money' }
  },
  whale: {
    fa: { label: 'نهنگ‌ها', prompt: 'ببین نهنگ‌ها چه می‌خرند' },
    ar: { label: 'الحيتان', prompt: 'what are whales buying' },
    en: { label: 'Whale activity', prompt: 'what are whales buying' }
  },
  signals: {
    fa: { label: 'سیگنال‌ها', prompt: 'سیگنال‌های امروز را نشان بده' },
    ar: { label: 'الإشارات', prompt: 'show me today signals' },
    en: { label: 'Signals', prompt: 'show me today signals' }
  },
  news: {
    fa: { label: 'اخبار', prompt: 'اخبار امروز کریپتو' },
    ar: { label: 'الأخبار', prompt: 'crypto news today' },
    en: { label: 'News', prompt: 'crypto news today' }
  },
  quote: {
    fa: { label: 'گرفتن قیمت', prompt: 'قیمت را بگیر' },
    ar: { label: 'عرض السعر', prompt: 'get a quote' },
    en: { label: 'Get a quote', prompt: 'get a quote' }
  },
  farm: {
    fa: { label: 'فارم', prompt: 'فارم' },
    ar: { label: 'المزرعة', prompt: 'farm' },
    en: { label: 'Farms', prompt: 'farm' }
  },
  lending: {
    fa: { label: 'وام', prompt: 'وام' },
    ar: { label: 'الإقراض', prompt: 'lending' },
    en: { label: 'Lending', prompt: 'lending' }
  },
  orders: {
    fa: { label: 'سفارش‌ها', prompt: 'سفارش‌های من' },
    ar: { label: 'الأوامر', prompt: 'my orders' },
    en: { label: 'Orders', prompt: 'my orders' }
  },
  ops_center: {
    fa: { label: 'مرکز عملیات', prompt: 'مرکز عملیات' },
    ar: { label: 'مركز العمليات', prompt: 'ops center' },
    en: { label: 'Ops Center', prompt: 'ops center' }
  },
  capabilities: {
    fa: { label: 'چه کاری بلدی؟', prompt: 'چه کاری بلدی' },
    ar: { label: 'ماذا تستطيع؟', prompt: 'what can you do' },
    en: { label: 'What can you do?', prompt: 'what can you do' }
  }
});

/** Resolve chip ids into localized `{ id, label, prompt }` objects. */
function chips(ids, locale) {
  const lang = langOf(locale);
  return ids
    .map((id) => {
      const c = CHIPS[id]?.[lang] || CHIPS[id]?.en;
      return c ? { id, label: c.label, prompt: c.prompt } : null;
    })
    .filter(Boolean);
}

/** Per-intent chip sets, by id only — the text lives in CHIPS. */
const BY_INTENT = Object.freeze({
  YIELD: ['yield_discover', 'farm', 'lending', 'dca'],
  PORTFOLIO: ['analyze_portfolio', 'rebalance', 'risk', 'yield_discover'],
  WALLET: ['balance', 'analyze_portfolio', 'history', 'send'],
  MARKET: ['market_overview', 'smart_money', 'whale', 'signals'],
  SWAP: ['quote', 'market_overview', 'balance'],
  ORDERS: ['orders', 'dca', 'market_overview'],
  OPS: ['ops_center', 'orders', 'analyze_portfolio', 'capabilities'],
  GENERAL: ['analyze_portfolio', 'market_overview', 'yield_discover', 'news']
});

/**
 * Chips for a classified intent.
 *
 * `locale` is read from the argument first and from `context.locale` second,
 * so existing callers that only pass a context keep working and get localized
 * chips without a change at the call site.
 */
export function getSuggestionsForIntent(intentType, context = {}, entities = {}, locale = null) {
  const type = String(intentType || 'GENERAL').toUpperCase();
  const lang = locale || context.locale || 'fa';

  if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'BORROW', 'STAKING', 'INVESTMENT_PLAN'].includes(type)) {
    return chips(BY_INTENT.YIELD, lang);
  }

  if (['BUY', 'SELL', 'SWAP', 'BRIDGE', 'SEND'].includes(type)) {
    const token = entities.token || entities.toToken || entities.fromToken;
    const base = chips(BY_INTENT.SWAP, lang);
    if (!token) return base;
    /*
     * A token-specific chip is built from the symbol, so the prompt stays
     * parseable: "تحلیل ETH" hits the token-question rule in the classifier
     * and returns ANALYZE_TOKEN. The label carries the symbol so the chip is
     * self-explanatory next to the generic ones.
     */
    const sym = String(token).toUpperCase();
    const l = langOf(lang);
    const analyze = {
      fa: { label: `تحلیل ${sym}`, prompt: `تحلیل ${sym}` },
      ar: { label: `تحليل ${sym}`, prompt: `analyze ${sym}` },
      en: { label: `Analyze ${sym}`, prompt: `analyze ${sym}` }
    }[l];
    return [{ id: `analyze_${sym.toLowerCase()}`, ...analyze }, ...base].slice(0, 4);
  }

  if (['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'SMART_MONEY', 'WHALE', 'ANALYZE_TOKEN', 'SIGNALS', 'NEWS_SEARCH'].includes(type)) {
    return chips(BY_INTENT.MARKET, lang);
  }
  if (['PORTFOLIO_ANALYSIS', 'REBALANCE', 'RISK_ANALYSIS', 'GOAL'].includes(type)) {
    return chips(BY_INTENT.PORTFOLIO, lang);
  }
  if (['WALLET_BALANCE', 'BTC_WALLET', 'WALLET_CONNECT'].includes(type)) {
    return chips(BY_INTENT.WALLET, lang);
  }
  if (['ORDERS', 'DCA'].includes(type)) {
    return chips(BY_INTENT.ORDERS, lang);
  }
  // The ops surfaces — new intent types that previously fell to GENERAL.
  if (['OPS_CENTER', 'AGENTS', 'STRATEGY', 'SYSTEM_STATUS', 'INTENT_OS', 'CAPABILITIES'].includes(type)) {
    return chips(BY_INTENT.OPS, lang);
  }

  // Fall back to where the user is standing.
  const currentPage = context.currentPage || '/';
  if (currentPage.includes('/market')) return chips(BY_INTENT.MARKET, lang);
  if (currentPage.includes('/portfolio')) return chips(BY_INTENT.PORTFOLIO, lang);
  if (currentPage.includes('/wallet')) return chips(BY_INTENT.WALLET, lang);
  if (currentPage.includes('/swap') || currentPage.includes('/bridge')) return chips(BY_INTENT.SWAP, lang);
  if (currentPage.includes('/farm') || currentPage.includes('/earn') || currentPage.includes('/loan')) return chips(BY_INTENT.YIELD, lang);
  if (currentPage.includes('/orders')) return chips(BY_INTENT.ORDERS, lang);

  return chips(BY_INTENT.GENERAL, lang);
}

/** Chips for raw text, before (or instead of) classification. */
export function getSuggestionsForMessage(message, context = {}, locale = null) {
  const text = String(message || '').toLowerCase();
  const lang = locale || context.locale || 'fa';

  if (/سود|بازده|yield|apy|farm|فارم/.test(text)) return chips(BY_INTENT.YIELD, lang);
  if (/بازار|market|قیمت|price/.test(text)) return chips(BY_INTENT.MARKET, lang);
  if (/پرتفوی|portfolio|سبد/.test(text)) return chips(BY_INTENT.PORTFOLIO, lang);
  if (/کیف|wallet|موجودی|balance/.test(text)) return chips(BY_INTENT.WALLET, lang);
  if (/عملیات|ops|ایجنت|agent|استراتژی|strategy/.test(text)) return chips(BY_INTENT.OPS, lang);

  return getSuggestionsForIntent(context.lastIntentType || 'GENERAL', context, {}, lang);
}

export { CHIPS };
