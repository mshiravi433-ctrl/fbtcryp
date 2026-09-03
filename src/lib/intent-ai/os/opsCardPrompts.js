/**
 * FBT INTENT OS — WHAT AN OPERATIONS CARD ASKS.
 * ---------------------------------------------------------------------------
 * Tapping a card in the Operations Center sends a sentence to the assistant.
 * This file is that sentence, per card, per language.
 *
 * ─── WHY IT IS NOT `card.title` ─────────────────────────────────────────────
 * The component used to do `CARD_PROMPTS[card.id] || card.title`, with a
 * partial 45-entry map. Both halves of that were broken:
 *
 *   · the map was Persian-only, so an English user tapping a covered card sent
 *     a Persian sentence and got a Persian answer inside an English UI
 *   · the fallback sent the card's TITLE, which is a label, not a request.
 *     Titles like "Position", "Events", "Forecast", "Progress" are single
 *     nouns that classify as GENERAL — so those cards replied "I could not map
 *     that to a module". A button in the Operations Center, doing nothing.
 *
 * ─── THE INVARIANT ──────────────────────────────────────────────────────────
 * Every prompt here must classify to something other than GENERAL. That is not
 * a style rule, it is the whole contract of the file: a card whose prompt does
 * not classify is a dead button. `promptsThatFailToClassify()` exists so a
 * probe can assert it against the live parser rather than trusting review.
 *
 * Prompts are written in vocabulary the parser's lexicon covers. Arabic reuses
 * the English prompt because the parser has no Arabic lexicon — the UI reads
 * Arabic, the request is understood, and the reply comes back in the user's
 * language from the response layer.
 */

/** Cards whose action is read/quote and therefore send a chat message. */
const PROMPTS = Object.freeze({
  /* Portfolio */
  portfolio_analysis: { fa: 'پرتفوی من را تحلیل کن', en: 'analyze my portfolio' },
  portfolio_rebalance: { fa: 'پرتفوی من را متعادل کن', en: 'rebalance my portfolio' },
  portfolio_risk: { fa: 'ریسک پرتفوی من را بررسی کن', en: 'check my portfolio risk' },
  portfolio_allocation: { fa: 'توزیع دارایی‌های من را نشان بده', en: 'show my asset allocation' },

  /* Wallet */
  wallet_analysis: { fa: 'کیف پول من را تحلیل کن', en: 'analyze my wallet' },
  wallet_balances: { fa: 'موجودی کیف پول من را نشان بده', en: 'show my wallet balances' },
  wallet_transactions: { fa: 'تاریخچه تراکنش‌های من را نشان بده', en: 'show my transaction history' },

  /* Swap */
  swap_token: { fa: 'می‌خواهم سواپ انجام دهم', en: 'I want to swap a token' },
  swap_quote: { fa: 'نرخ سواپ را نشان بده', en: 'show me a swap quote' },
  swap_execute: { fa: 'می‌خواهم سواپ اجرا کنم', en: 'I want to execute a swap' },
  swap_crosschain: { fa: 'می‌خواهم سواپ کراس‌چین انجام دهم', en: 'I want a cross-chain swap' },

  /* Bridge */
  bridge_run: { fa: 'می‌خواهم بریج بزنم', en: 'I want to bridge' },
  bridge_quote: { fa: 'نرخ بریج را نشان بده', en: 'show me a bridge quote' },
  bridge_execute: { fa: 'می‌خواهم بریج را اجرا کنم', en: 'I want to execute a bridge' },
  bridge_crosschain: { fa: 'می‌خواهم انتقال کراس‌چین انجام دهم', en: 'I want a cross-chain transfer' },

  /* Lending */
  lending_analysis: { fa: 'بازارهای وام را تحلیل کن', en: 'analyze the lending markets' },

  /* Farm & liquidity */
  farm_analysis: { fa: 'فرصت‌های فارم را تحلیل کن', en: 'analyze farm opportunities' },
  farm_recommend: { fa: 'بهترین فارم را پیدا کن', en: 'find the best farm' },
  lp_analysis: { fa: 'استخرهای نقدینگی را تحلیل کن', en: 'analyze the liquidity pools' },

  /* Futures */
  futures_analysis: { fa: 'بازار فیوچرز را تحلیل کن', en: 'analyze the futures market' },
  futures_position: { fa: 'پوزیشن‌های فیوچرز من را نشان بده', en: 'show my futures positions' },
  futures_risk: { fa: 'ریسک پوزیشن‌های فیوچرز را بررسی کن', en: 'check my futures position risk' },

  /* dYdX */
  dydx_market: { fa: 'بازار dYdX را تحلیل کن', en: 'analyze the dYdX market' },
  dydx_position: { fa: 'پوزیشن‌های dYdX من را نشان بده', en: 'show my dYdX positions' },
  dydx_risk: { fa: 'ریسک dYdX را بررسی کن', en: 'check the dYdX risk' },

  /* Global markets */
  markets_rwa: { fa: 'توکن‌های دارایی واقعی را نشان بده', en: 'show me RWA tokens' },
  markets_tokenized: { fa: 'دارایی‌های توکن‌شده را نشان بده', en: 'show me tokenized assets' },

  /* Intelligence */
  intel_marketscan: { fa: 'بازار را اسکن کن', en: 'scan the market' },
  intel_smartmoney: { fa: 'اسمارت مانی را بررسی کن', en: 'check smart money' },
  intel_whales: { fa: 'نهنگ‌ها را دنبال کن', en: 'track the whales' },
  intel_signals: { fa: 'سیگنال‌ها را نشان بده', en: 'show me the signals' },
  intel_news: { fa: 'اخبار بازار را نشان بده', en: 'show me market news' },
  /* «رویدادها» alone is GENERAL — the prompt names the surface it belongs to. */
  intel_events: { fa: 'رویدادها و اخبار بازار را نشان بده', en: 'show me market events and news' },
  intel_token: { fa: 'این توکن را تحلیل کن', en: 'analyze this token' },
  intel_contract: { fa: 'قرارداد توکن را تحلیل کن', en: 'analyze the token contract' },

  /* Goals */
  goals_profit: { fa: 'برنامه سود برای هدفم بساز', en: 'build a profit plan for my goal' },
  /* «پیش‌بینی» alone is GENERAL — anchored to the goal it forecasts. */
  goals_forecast: { fa: 'پیش‌بینی هدف مالی من را نشان بده', en: 'show the forecast for my financial goal' },
  goals_whatif: { fa: 'سناریوی چه‌اگر روی پرتفوی من را شبیه‌سازی کن', en: 'run a what-if simulation on my portfolio' },
  /* «پیشرفت» alone is GENERAL — anchored to goals. */
  goals_progress: { fa: 'پیشرفت هدف‌های مالی من را نشان بده', en: 'show progress on my financial goals' },
  goals_rebalance: { fa: 'پرتفوی من را متعادل کن', en: 'rebalance my portfolio' },
  goals_create: { fa: 'می‌خواهم یک هدف مالی بسازم', en: 'I want to create a financial goal' },

  /* Automation shortcuts used by the order flow */
  auto_recurring: { fa: 'هر هفته ۱۰۰ دلار بیت‌کوین بخر', en: 'buy $100 of bitcoin every week' },
  auto_scheduled: { fa: 'هر هفته ۱۰۰ دلار بیت‌کوین بخر', en: 'buy $100 of bitcoin every week' },

  /* Monitoring */
  monitor_list: { fa: 'پایش‌های فعال من را نشان بده', en: 'show my active monitors' },
  monitor_portfolio: { fa: 'پرتفوی من را پایش کن', en: 'monitor my portfolio' }
});

/** 'fa-IR' → 'fa'. Arabic deliberately reuses the English prompt (see header). */
function promptLang(locale) {
  return String(locale || 'fa').toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

/**
 * The sentence a card sends.
 *
 * Returns null when a card has no prompt — the caller must then NOT send the
 * title as a message. A null here means "this card is not a chat action",
 * which is true of every navigate/monitor/order card.
 */
export function opsCardPrompt(card, locale = 'fa') {
  if (!card?.id) return null;
  const entry = PROMPTS[card.id];
  if (!entry) return null;
  return entry[promptLang(locale)] || entry.en || null;
}

/** Cards that send a chat message but have no prompt defined. */
export function cardsMissingPrompts(cards = []) {
  const CHAT_ACTIONS = ['read', 'quote'];
  return cards
    .filter((c) => CHAT_ACTIONS.includes(c.action) && !PROMPTS[c.id])
    .map((c) => c.id);
}

/**
 * Prompts that do not classify — i.e. dead buttons.
 *
 * `classify` is injected rather than imported so a probe can run this against
 * the live parser without this module depending on it.
 */
export function promptsThatFailToClassify(classify, locales = ['fa', 'en']) {
  const dead = [];
  for (const [id, entry] of Object.entries(PROMPTS)) {
    for (const loc of locales) {
      const prompt = entry[promptLang(loc)] || entry.en;
      if (!prompt) { dead.push({ id, locale: loc, prompt: null, type: 'MISSING' }); continue; }
      const result = classify(prompt, {});
      if (!result || result.type === 'GENERAL') {
        dead.push({ id, locale: loc, prompt, type: result?.type || 'NONE' });
      }
    }
  }
  return dead;
}

export { PROMPTS };
