/**
 * FBT INTENT OS — user-facing intent kinds.
 * ---------------------------------------------------------------------------
 * The Command Center routes utterances onto seven internal surfaces
 * (TRADE / EARN / PORTFOLIO / …). Those labels are machinery. This module
 * recovers the *user* intent the chat must honour:
 *
 *   "پرتفوی من را تحلیل کن"     → ANALYZE_PORTFOLIO
 *   "پرتفوی من را متعادل کن"    → REBALANCE_PORTFOLIO
 *   "ETH بخر"                    → BUY
 *   "موجودی من را نشان بده"     → GET_BALANCE
 *
 * The kind is never rendered. The Human Response layer uses it to pick a
 * message, a card, and whether a wallet is actually required.
 */

export const USER_INTENT_SCHEMA = 'fbt.ai-user-intent.v1';

export const USER_INTENTS = Object.freeze([
  'ANALYZE_PORTFOLIO',
  'REBALANCE_PORTFOLIO',
  'GET_BALANCE',
  'SWAP',
  'BUY',
  'SELL',
  'BRIDGE',
  'SEND',
  'INVESTMENT_PLAN',
  'DCA',
  'GOAL',
  'FARM',
  'LEND',
  'FUTURES',
  'STOCK',
  'RESEARCH',
  'GENERAL'
]);

/** Intents that cannot produce a real number without a connected wallet. */
export const WALLET_REQUIRED_INTENTS = Object.freeze([
  'REBALANCE_PORTFOLIO',
  'GET_BALANCE',
  'SWAP',
  'BUY',
  'SELL',
  'BRIDGE',
  'SEND',
  'FARM',
  'LEND',
  'FUTURES',
  'DCA'
]);

/** Intents that may *ask* for a wallet so numbers are real, but still answer. */
export const WALLET_PREFERRED_INTENTS = Object.freeze([
  'ANALYZE_PORTFOLIO',
  'INVESTMENT_PLAN',
  'GOAL',
  'STOCK'
]);

/** Intents that produce an executable action card (never analysis). */
export const EXECUTABLE_INTENTS = Object.freeze([
  'REBALANCE_PORTFOLIO',
  'SWAP',
  'BUY',
  'SELL',
  'BRIDGE',
  'SEND',
  'DCA',
  'GOAL',
  'FARM',
  'LEND',
  'FUTURES'
]);

const RULES = Object.freeze([
  {
    kind: 'REBALANCE_PORTFOLIO',
    weight: 6,
    words: ['rebalance', 're-balance', 'rebalancing', 'reallocate', 're-allocate'],
    stems: ['متعادل', 'متوازن', 'بازتنظیم', 'بازچینش', 'ریبالانس', 'ری‌بالانس', 'اعاده التوازن']
  },
  {
    kind: 'ANALYZE_PORTFOLIO',
    weight: 5,
    words: ['analyze my portfolio', 'analyse my portfolio', 'portfolio analysis', 'review my portfolio', 'how is my portfolio', 'portfolio health'],
    stems: ['تحلیل پرتفوی', 'تحلیل سبد', 'پرتفوی من را تحلیل', 'سبدم را تحلیل', 'وضعیت پرتفوی', 'عملکرد پرتفوی', 'تحليل المحفظة']
  },
  {
    kind: 'GET_BALANCE',
    weight: 5,
    words: ['show my balance', 'my balance', 'wallet balance', 'how much do i have', 'what do i hold'],
    stems: ['موجودی', 'موجودی من', 'چقدر دارم', 'موجودیم', 'رصيدي', 'رصيد']
  },
  {
    kind: 'INVESTMENT_PLAN',
    weight: 4,
    words: ['invest in solana', 'investment plan', 'allocate my money', 'where should i invest'],
    stems: ['سرمایه‌گذاری', 'سرمایه گذاری', 'روی سولانا', 'برنامه سرمایه‌', 'استثمر']
  },
  {
    kind: 'DCA',
    weight: 5,
    words: ['every week', 'every day', 'dca', 'dollar cost', 'recurring buy'],
    stems: ['هر هفته', 'هر روز', 'هر ماه', 'دلار کاست', 'خرید دوره‌ای']
  },
  {
    kind: 'GOAL',
    weight: 4,
    words: ['financial goal', 'double my money', 'in 3 years', 'target'],
    stems: ['هدف مالی', 'دو برابر', 'طی ۳ سال', 'طی 3 سال']
  },
  {
    kind: 'BRIDGE',
    weight: 5,
    words: ['bridge', 'cross-chain', 'cross chain'],
    stems: ['بریج', 'بریدج', 'بین زنجیره']
  },
  {
    kind: 'SEND',
    weight: 4,
    words: ['send', 'transfer to', 'withdraw to'],
    stems: ['ارسال', 'بفرست', 'انتقال به']
  },
  {
    kind: 'FUTURES',
    weight: 4,
    words: ['futures', 'perp', 'perpetual', 'leverage', 'long eth', 'short btc'],
    stems: ['فیوچرز', 'اهرم', 'پِرپ', 'پرپ']
  },
  {
    kind: 'FARM',
    weight: 4,
    words: ['farm', 'yield farm', 'best farm', 'liquidity pool'],
    stems: ['فارم', 'استخر نقدینگی', 'کشت سود']
  },
  {
    kind: 'LEND',
    weight: 4,
    words: ['lend', 'lending', 'borrow', 'aave', 'loan'],
    stems: ['وام', 'قرض', 'لندینگ', 'وام بگیر']
  },
  {
    kind: 'STOCK',
    weight: 3,
    words: ['stock', 'equity', 'share of apple', 'tesla'],
    stems: ['سهام', 'بورس']
  },
  {
    kind: 'BUY',
    weight: 4,
    words: ['buy ', 'purchase ', 'i want to buy'],
    stems: ['بخر', 'خرید ', 'می‌خرم', 'ميخرم']
  },
  {
    kind: 'SELL',
    weight: 4,
    words: ['sell ', 'dump ', 'i want to sell'],
    stems: ['بفروش', 'فروش ', 'می‌فروشم']
  },
  {
    kind: 'SWAP',
    weight: 3,
    words: ['swap', 'convert', 'exchange'],
    stems: ['تبدیل', 'معاوضه', 'سواپ']
  }
]);

function hitsIn(text, rule) {
  let n = 0;
  for (const word of rule.words) if (word && text.includes(word)) n += 1;
  for (const stem of rule.stems) if (stem && text.includes(stem)) n += 1;
  return n;
}

function fromCommandCenter(classification) {
  const intent = String(classification?.intent || '').toUpperCase();
  const actions = classification?.utterance?.actions || [];
  const first = actions[0]?.action;
  if (first === 'buy') return 'BUY';
  if (first === 'sell') return 'SELL';
  if (first === 'swap') return 'SWAP';
  if (first === 'bridge') return 'BRIDGE';
  if (first === 'send') return 'SEND';
  if (first === 'futures' || first === 'dydx') return 'FUTURES';
  if (first === 'farm' || first === 'defi') return 'FARM';
  if (intent === 'AUTOMATION') return 'DCA';
  if (intent === 'EARN') return 'FARM';
  if (intent === 'RESEARCH') return 'RESEARCH';
  if (intent === 'TRADE') return 'SWAP';
  if (intent === 'PORTFOLIO') return 'ANALYZE_PORTFOLIO';
  return 'GENERAL';
}

/**
 * Classify one user utterance into a USER_INTENT.
 *
 * @param {string} message
 * @param {object} [classification]  command-center classifyIntent() result
 */
export function classifyUserIntent(message, classification = null) {
  const raw = String(message || '');
  const text = raw.toLowerCase();
  const votes = [];
  for (const rule of RULES) {
    const hits = hitsIn(text, rule);
    if (hits > 0) votes.push({ kind: rule.kind, score: hits * rule.weight });
  }
  votes.sort((a, b) => b.score - a.score);

  let kind = votes[0]?.kind || fromCommandCenter(classification);
  /* "analyze / rebalance my portfolio" both match PORTFOLIO; the more
     specific rule must win. A sentence that only says «پرتفوی» without
     analyze/rebalance stays ANALYZE — never an implicit rebalance. */
  if (!votes[0] && /portfolio|پرتفوی|پرتفو|سبد|محفظة|محفظه/i.test(raw)) {
    kind = 'ANALYZE_PORTFOLIO';
  }
  if (kind === 'ANALYZE_PORTFOLIO' && votes.some((v) => v.kind === 'REBALANCE_PORTFOLIO' && v.score >= 6)) {
    kind = 'REBALANCE_PORTFOLIO';
  }
  if (!USER_INTENTS.includes(kind)) kind = 'GENERAL';

  const top = votes[0]?.score || 0;
  const second = votes[1]?.score || 0;
  const confidence = top <= 0
    ? (classification?.confidence || 0.3)
    : Math.min(0.98, (top + (second > 0 ? 0 : 1)) / (top + second + 1));

  return {
    ok: true,
    schema: USER_INTENT_SCHEMA,
    type: kind,
    confidence: Math.round(confidence * 100) / 100,
    source: top > 0 ? 'user-lexicon' : 'command-center',
    requiresWallet: WALLET_REQUIRED_INTENTS.includes(kind),
    prefersWallet: WALLET_PREFERRED_INTENTS.includes(kind),
    executable: EXECUTABLE_INTENTS.includes(kind)
  };
}

export function intentRequiresWallet(kind) {
  return WALLET_REQUIRED_INTENTS.includes(String(kind || ''));
}

export function intentIsExecutable(kind) {
  return EXECUTABLE_INTENTS.includes(String(kind || ''));
}
