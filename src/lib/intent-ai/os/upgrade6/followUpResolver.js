/**
 * FBT Intent OS — follow-up resolver
 *
 * The live chat dump that drove this module:
 *   «اره» after “open the market page?”  → GENERAL
 *   «بله تایید شد» after CONTINUE        → GENERAL
 *   «اره پر سوده را» after yield list    → NAVIGATION → /news
 *   «افق جهانی را باز کن» after a prior  → “unfinished HORIZON?”
 *     Horizon navigation that never completed
 *
 * Short confirmations, “open it”, “the most profitable one” and pasted
 * assistant text + yes are continuations of the last offer — not a new
 * GENERAL request and never a default trip to /news.
 */

const FA_DIGITS = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
};

export function normalizeFollowUp(input) {
  let s = String(input ?? '');
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '');
  s = s.replace(/[\u064B-\u0652\u0670]/g, '');
  s = s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة|ۀ/g, 'ه').replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و');
  s = s.replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] || d);
  s = s.replace(/[\u200c]/g, ' ');
  s = s.replace(/[?!.,;:؛،؟)("'`]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

const CONFIRM_HEAD = /^(بله|اره|اری|باشه|اوکی|ok|okay|yes|yep|yeah|confirm|تایید شد|تایید|انجام بده|انجامش بده|ادامه بده|ادامه اش را بده|ادامه اش|ادامهاش|ادامه)(\s|$)/;
const CONFIRM_ANY = /\b(بله|اره|اری|باشه|اوکی|ok|okay|yes|yep|yeah|confirm|تایید شد|تایید|انجام بده|انجامش بده|ادامه بده)\b/;
const REJECT_RE = /^(نه|نخیر|نه فعلا|فعلا نه|لغو کن|لغو|کنسل|بی خیال|no|nope|cancel|stop)(\s|$)/;
const BEST_RE = /پر\s*سود|پرسود|پربازده|سودده|بهترین|most profit|highest|the best|best (one|apy|yield)/;
const OPEN_RE = /باز کن|بازکن|بازش کن|بازش|open (it|the page)|take me|go there/;

/**
 * Classify a user turn as confirm / reject / best-pick / other.
 * Long pasted assistant text + a yes at the end still counts as confirm.
 */
export function classifyFollowUp(text) {
  const t = normalizeFollowUp(text);
  if (!t) return { type: 'empty', confidence: 0, raw: text };

  if (REJECT_RE.test(t) && t.length < 40) {
    return { type: 'reject', value: false, confidence: 0.99, raw: text };
  }

  const lastChunk = (t.split(/\n/).pop() || t).trim();
  const best = BEST_RE.test(t);
  const open = OPEN_RE.test(t);
  const short = t.length <= 64;
  const confirm = (short && CONFIRM_HEAD.test(t))
    || (CONFIRM_ANY.test(lastChunk) && lastChunk.length <= 80)
    || (short && open && CONFIRM_ANY.test(t));

  if (confirm || (best && t.length < 120 && CONFIRM_ANY.test(t))) {
    return {
      type: 'confirm',
      value: true,
      best,
      open,
      confidence: short ? 0.99 : 0.9,
      raw: text
    };
  }

  if (best && t.length < 80) {
    return { type: 'best', value: true, best: true, confidence: 0.9, raw: text };
  }

  return { type: 'other', confidence: 0, raw: text };
}

/** Intents that are just “open this page” — never an unfinished money move. */
export const PAGE_OPEN_INTENTS = Object.freeze([
  'HORIZON', 'FOREX', 'NAVIGATION', 'NEWS_SEARCH', 'SIGNALS', 'ANALYZE_TOKEN',
  'MARKET_ANALYSIS', 'STOCKS', 'RWA', 'FUTURES', 'DYDX', 'P2P', 'FARM', 'LEND',
  'YIELD_DISCOVERY', 'INVESTMENT_PLAN', 'OPS_CENTER', 'AGENTS', 'STRATEGY',
  'SYSTEM_STATUS', 'SETTINGS', 'REWARDS', 'NFT', 'SHOP', 'EXPLORE', 'INTENT_OS',
  'BTC_WALLET', 'ORDERS', 'SMART_MONEY', 'WHALE', 'PORTFOLIO_ANALYSIS'
]);

export const INTENT_DEFAULT_ROUTE = Object.freeze({
  HORIZON: '/stocks',
  FOREX: '/stocks',
  MARKET_ANALYSIS: '/market',
  ANALYZE_TOKEN: '/signals',
  SIGNALS: '/signals',
  NEWS_SEARCH: '/news',
  YIELD_DISCOVERY: '/farm',
  INVESTMENT_PLAN: '/invest',
  GOAL: '/invest',
  FARM: '/farm',
  LEND: '/loan',
  STOCKS: '/stocks',
  RWA: '/stocks',
  FUTURES: '/perp',
  DYDX: '/dydx',
  P2P: '/p2p',
  PORTFOLIO_ANALYSIS: '/portfolio',
  WALLET_BALANCE: '/wallet',
  SMART_MONEY: '/smart-money',
  WHALE: '/smart-money',
  ORDERS: '/orders',
  OPS_CENTER: '/intent?tab=ops',
  AGENTS: '/intent?tab=agents',
  STRATEGY: '/intent?tab=strategies',
  SYSTEM_STATUS: '/intent?tab=status',
  SETTINGS: '/settings',
  REWARDS: '/rewards',
  NFT: '/nft',
  SHOP: '/shop',
  EXPLORE: '/explore',
  INTENT_OS: '/intent',
  BTC_WALLET: '/wallet?tab=real',
  SWAP: '/swap',
  BRIDGE: '/bridge',
  SEND: '/wallet?tab=send'
});

function routeFromAiText(text) {
  const t = normalizeFollowUp(text);
  if (!t) return null;
  if (/افق جهانی|فارکس|horizon|forex|طلا|نفت|فلزات/.test(t)) return '/stocks';
  if (/پول مجازی|سرمایه‌گذاری مجازی|\binvest\b/.test(t)) return '/invest';
  if (/بازار|market/.test(t)) return '/market';
  if (/سیگنال|signals?/.test(t)) return '/signals';
  if (/فارم|farm|استخر|yield|سود/.test(t)) return '/farm';
  if (/پرتفوی|portfolio/.test(t)) return '/portfolio';
  if (/اخبار|news/.test(t)) return '/news';
  if (/فیوچرز|perp|futures/.test(t)) return '/perp';
  if (/سهام|stocks?/.test(t)) return '/stocks';
  if (/کیف پول|wallet/.test(t)) return '/wallet';
  return null;
}

export function inferOffer({
  pendingOffer = null,
  lastIntentType = null,
  lastRoute = null,
  lastAiContent = null,
  lastNavigated = null,
  operational = {},
  lastTask = null,
  preferBest = false
} = {}) {
  if (pendingOffer && (pendingOffer.route || pendingOffer.intentType)) {
    return {
      route: pendingOffer.route || INTENT_DEFAULT_ROUTE[pendingOffer.intentType] || null,
      intentType: pendingOffer.intentType || lastIntentType,
      selection: pendingOffer.selection || (preferBest ? 'best' : null)
    };
  }

  const type = String(
    lastIntentType
    || operational.intent
    || operational.operation
    || lastTask?.intent
    || ''
  ).toUpperCase() || null;

  let route = lastNavigated
    || lastRoute
    || (type && type !== 'NAVIGATION' && type !== 'CONTINUE' && type !== 'GENERAL'
      ? INTENT_DEFAULT_ROUTE[type]
      : null)
    || routeFromAiText(lastAiContent)
    || null;

  if (preferBest && (type === 'YIELD_DISCOVERY' || type === 'FARM' || type === 'INVESTMENT_PLAN' || /سود|yield|farm/i.test(String(lastAiContent || '')))) {
    route = '/farm';
  }

  if (!route && !type) return null;
  return {
    route: route || INTENT_DEFAULT_ROUTE[type] || null,
    intentType: type || 'NAVIGATION',
    selection: preferBest ? 'best' : null
  };
}

/**
 * Resolve a short follow-up against the last offer.
 * @returns {{ handled: boolean, action?: string, route?: string|null, intentType?: string, kind: object }}
 */
export function resolveFollowUp(message, context = {}) {
  const kind = classifyFollowUp(message);
  if (kind.type === 'empty' || kind.type === 'other') {
    return { handled: false, kind };
  }
  if (kind.type === 'reject') {
    return { handled: true, action: 'cancel', kind };
  }

  const offer = inferOffer({ ...context, preferBest: Boolean(kind.best) });
  if (!offer || (!offer.route && !offer.intentType)) {
    return { handled: false, kind, reason: 'no_offer' };
  }

  return {
    handled: true,
    action: 'resume',
    route: offer.route,
    intentType: offer.intentType,
    selection: kind.best ? 'best' : offer.selection,
    kind
  };
}

/** True when this utterance should never start a brand-new intent. */
export function isBareFollowUp(text) {
  const kind = classifyFollowUp(text);
  // “best one” by itself is not a continuation — «بهترین Yield را پیدا کن»
  // is a new yield search. Confirm/reject (optionally + best) are.
  return kind.type === 'confirm' || kind.type === 'reject';
}
