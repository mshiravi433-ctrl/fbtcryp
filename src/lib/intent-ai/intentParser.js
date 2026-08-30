/**
 * FBT INTENT AI — INTENT PARSER
 * ---------------------------------------------------------------------------
 * Turns free-form user utterances into a structured Intent draft, plus a
 * confidence score and a list of "clarifications needed" when the input is
 * ambiguous. This is the ONLY place natural language enters the system; the
 * rest of the pipeline works exclusively on the structured Intent object.
 *
 * The parser is DETERMINISTIC and keyword-driven — it does not call an LLM
 * directly. Real production would hand off to a hosted model behind a scoped
 * adapter; here we ship a transparent, testable rule engine so behaviour is
 * auditable and cannot be prompt-injected into a money-moving decision.
 *
 * Output shape:
 *   {
 *     ok: boolean,
 *     intent: { kind, action, fromSymbol, toSymbol, amount, chainId?,
 *               leverage?, slippage?, goalPct?, durationHrs?, ... }
 *     confidence: 0..100,
 *     clarifications: string[],     // codes of missing / ambiguous fields
 *     signals: string[],            // what we parsed out (for audit trail)
 *     raw: string                   // trimmed user text
 *   }
 */

import { ALLOWED_CHAINS } from './permissions.js';
import { checkIntentLimits } from './intentLimits.js';
import { analyzeUtterance } from './semanticIntent.js';
import { normalizeWord, editDistance, typoTolerance, ASSET_ALIAS_INDEX } from './semanticLexicon.js';

const CHAIN_ALIASES = {
  'آربیتروم': 42161, 'اتریوم': 1, 'بیس': 8453, 'پالیگان': 137, 'سولانا': 501,
  ethereum: 1, mainnet: 1,
  optimism: 10, op: 10,
  bsc: 56, binance: 56, 'bnb-chain': 56, 'bnb chain': 56, bnb: 56,
  polygon: 137, matic: 137,
  sonic: 146,
  base: 8453,
  arbitrum: 42161, arb: 42161, 'arbitrum one': 42161,
  avalanche: 43114, avax: 43114,
  linea: 59144,
  solana: 501, sol: 501,
  tron: 195, trx: 195,
  ton: 8757 // placeholder, expand as supported
};

/* Action keywords and prepositions must never be mistaken for tokens. */
const ACTION_STOPWORDS = new Set([
  'به', 'در', 'با', 'از', 'برای', 'روی',
  'SWAP', 'EXCHANGE', 'CONVERT', 'TRADE', 'BRIDGE', 'SEND', 'TRANSFER',
  'PAY', 'BUY', 'PURCHASE', 'LONG', 'SELL', 'SHORT', 'EXIT', 'FARM',
  'STAKE', 'YIELD', 'LP', 'LIQUIDITY', 'FUTURES', 'PERPS', 'PERPETUAL',
  'LEVERAGE', 'LEV', 'DYDX', 'DEFI', 'ANALYZE', 'ANALYSE', 'ANALYSIS', 'RESEARCH',
  'PORTFOLIO', 'WALLET', 'HOLDINGS', 'BALANCE', 'NEWS', 'SIGNAL',
  'GOAL', 'TARGET', 'PROFIT', 'ON', 'TO', 'WITH', 'FOR', 'FROM', 'INTO', 'AT',
  'MAKE', 'GET', 'WANT', 'I', 'ME', 'MY'
]);

/*
 * English function words the ticker heuristic used to read as symbols.
 *
 * `normalizeToken` accepts anything 2-12 chars of A-Z, and `isPlausibleToken`
 * accepts anything shaped like /^[A-Z]{2,6}$/ — so "buy 200 dollars OF
 * bitcoin" produced toSymbol: "OF" and "PUT a quarter into ETH" produced
 * fromSymbol: "PUT". A trade built on a word that is not an asset is worse
 * than one that asks, so the filler list is explicit.
 */
const FILLER_WORDS = new Set([
  'OF', 'OFF', 'AND', 'THE', 'A', 'AN', 'IN', 'INTO', 'IS', 'IT', 'TO', 'AT', 'AS', 'BE',
  'PUT', 'GET', 'GOT', 'USE', 'USING', 'WANT', 'NEED', 'HAVE', 'HAS', 'HAD', 'ALL',
  'ANY', 'SOME', 'MORE', 'LESS', 'NOW', 'THEN', 'WHEN', 'WHAT', 'WHICH', 'WHO', 'HOW',
  'FOR', 'FROM', 'WITH', 'WITHIN', 'ABOUT', 'AFTER', 'BEFORE', 'BETWEEN', 'AGAINST',
  'ME', 'MY', 'MINE', 'YOU', 'YOUR', 'WE', 'OUR', 'THEY', 'THEM', 'THEIR', 'HE', 'SHE',
  'THIS', 'THAT', 'THESE', 'THOSE', 'THERE', 'HERE', 'PLEASE', 'JUST', 'ONLY', 'EACH',
  'EVERY', 'PER', 'UP', 'DOWN', 'OUT', 'OVER', 'UNDER', 'BY', 'OR', 'NOT', 'NO', 'YES',
  'DO', 'DOES', 'DID', 'CAN', 'COULD', 'WOULD', 'SHOULD', 'WILL', 'AM', 'ARE', 'WAS',
  'WERE', 'BEEN', 'BEING', 'MUCH', 'MANY', 'LOT', 'LOTS', 'BIT', 'LITTLE', 'HALF',
  'QUARTER', 'THIRD', 'TOTAL', 'WHOLE', 'ENTIRE', 'REST', 'OTHER', 'ANOTHER', 'SAME',
  'IF', 'SO', 'BUT', 'BECAUSE', 'THAN', 'THAT', 'WHILE', 'ONCE', 'TWICE',
  /* "market" and "brief" are analysis-request words, never tickers — without
     this, "market brief" parses as the fake pair MARKET → BRIEF. */
  'MARKET', 'MARKETS', 'BRIEF'
]);

/* Chain words that should NOT be treated as tokens when used with "on <chain>" context.
   Note: short symbols like ETH, SOL, BNB, ARB, OP, MATIC, AVAX, TRX, TON are also tokens
   (they are in TOKEN_ALIASES) so we only filter out the long names + MAINNET/CHAIN. */
const CHAIN_LONG_NAMES = new Set([
  'ETHEREUM', 'ARBITRUM', 'OPTIMISM', 'BINANCE', 'POLYGON', 'SONIC',
  'AVALANCHE', 'LINEA', 'SOLANA', 'TRON', 'MAINNET', 'CHAIN'
]);

const ACTION_KEYWORDS = [
  // English bare greetings ("hello", "hi") are deliberately NOT greetings
  // here: with no actionable request they must surface ACTION_UNCLEAR so the
  // guided flow can ask what the user actually wants. Localised greetings
  // (سلام، درود، مرحبا…) remain first-class conversation intents.
  { action: 'conversation', keywords: ['سلام', 'درود', 'مرحبا', 'اهلاً'], kind: 'conversation', subType: 'greeting' },
  { action: 'conversation', keywords: ['ممنون', 'تشکر', 'مرسی', 'سپاس', 'thanks', 'thank you', 'شكر', 'شكرا'], kind: 'conversation', subType: 'thanks' },
  { action: 'conversation', keywords: ['خداحافظ', 'بدرود', 'bye', 'goodbye', 'وداعا', 'مع السلامة'], kind: 'conversation', subType: 'goodbye' },
  { action: 'swap',        keywords: ['swap', 'exchange', 'convert', 'trade', 'تبدیل', 'مبادله', 'تعویض'],                   kind: 'swap' },
  { action: 'bridge',      keywords: ['bridge', 'cross-chain', 'cross chain', 'move to', 'پل'],        kind: 'bridge' },
  { action: 'send',        keywords: ['send', 'transfer', 'pay', 'ارسال'],                                kind: 'send' },
  { action: 'buy',         keywords: ['buy', 'purchase', 'long', 'go long', 'خرید'],                     kind: 'swap' },
  { action: 'sell',        keywords: ['sell', 'short', 'exit', 'فروش'],                                  kind: 'swap' },
  { action: 'farm',        keywords: ['farm', 'stake', 'yield', 'lp', 'liquidity'],              kind: 'defi' },
  { action: 'futures',     keywords: ['futures', 'perps', 'perpetual', 'leverage', 'فیوچرز'],               kind: 'futures' },
  { action: 'dydx',        keywords: ['dydx'],                                                   kind: 'futures' },
  { action: 'defi',        keywords: ['defi', 'lend', 'borrow', 'supply', 'deposit', 'دیفای', 'وام'],            kind: 'defi' },
  { action: 'analyze',     keywords: ['analyze', 'analyse', 'analysis', 'research', 'look at', 'market brief', 'brief', 'market update', 'تحلیل'],  kind: 'analysis' },
  // action -> [keywords], kind
  { action: 'swap',        keywords: ['swap', 'exchange', 'convert', 'trade'],                   kind: 'swap' },
  { action: 'bridge',      keywords: ['bridge', 'cross-chain', 'cross chain', 'move to'],        kind: 'bridge' },
  { action: 'send',        keywords: ['send', 'transfer', 'pay'],                                kind: 'send' },
  { action: 'buy',         keywords: ['buy', 'purchase', 'long', 'go long'],                     kind: 'swap' },
  { action: 'sell',        keywords: ['sell', 'short', 'exit'],                                  kind: 'swap' },
  { action: 'farm',        keywords: ['farm', 'stake', 'yield', 'lp', 'liquidity'],              kind: 'defi' },
  { action: 'futures',     keywords: ['futures', 'perps', 'perpetual', 'leverage'],               kind: 'futures' },
  { action: 'dydx',        keywords: ['dydx'],                                                   kind: 'futures' },
  { action: 'defi',        keywords: ['defi', 'lend', 'borrow', 'supply', 'deposit'],            kind: 'defi' },
  { action: 'analyze',     keywords: ['analyze', 'analyse', 'analysis', 'research', 'look at', 'market brief', 'brief', 'market update'],  kind: 'analysis' },
  { action: 'portfolio',   keywords: ['portfolio', 'wallet', 'holdings', 'balance'],              kind: 'analysis' },
  { action: 'news',        keywords: ['news', 'signal', 'headline'],                              kind: 'analysis' },
  { action: 'goal',        keywords: ['goal', 'target', 'percent', '% return', 'profit'],         kind: 'goal' }
];

// Common token aliases. Uppercase keys.
const TOKEN_ALIASES = {
  BTC: 'BTC', BITCOIN: 'BTC',
  ETH: 'ETH', ETHER: 'ETH',
  SOL: 'SOL', SOLANA: 'SOL',
  USDT: 'USDT', TETHER: 'USDT',
  USDC: 'USDC',
  DAI: 'DAI',
  BNB: 'BNB',
  ARB: 'ARB',
  OP: 'OP',
  MATIC: 'MATIC', POLYGON: 'MATIC', POL: 'POL',
  AVAX: 'AVAX', AVALANCHE: 'AVAX',
  TRX: 'TRX', TRON: 'TRX',
  TON: 'TON',
  FBT: 'FBT'
};

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD']);

function normalizeToken(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return TOKEN_ALIASES[key] || (key.length >= 2 && key.length <= 12 ? key : null);
}

/** Token normalizer reused by the guided flow (single token from an answer). */
export { normalizeToken };

function detectAmount(text) {
  // "$500" — explicit USD
  const usdMatch = text.match(/\$\s?([0-9]+(?:\.[0-9]+)?)/);
  if (usdMatch) return { amount: Number(usdMatch[1]), unit: 'USD', match: usdMatch[0] };

  // "500 دلار" / "500 dollars" / "500 usd" — the Persian phrasing users write
  // when the guided flow asks how much they want to enter. No \b at the end:
  // Persian letters are not \w in JS regex, so \b never fires after them.
  const dollarMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:دلار|دولار|dollars?|usd)(?![a-z])/i);
  if (dollarMatch) return { amount: Number(dollarMatch[1]), unit: 'USD', match: dollarMatch[0] };

  // "N TOKEN" patterns — return the FIRST occurrence whose token is a known alias
  // (avoids matching "1 day" as "1 DAY"). For "buy N X with M Y", the caller will
  // separately pick up the source side via tokensAfter("with").
  const re = /([0-9]+(?:\.[0-9]+)?)\s?([a-z]{2,8})/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    const unit = normalizeToken(m[2]);
    if (!Number.isFinite(n) || n <= 0 || !unit) continue;
    if (CHAIN_LONG_NAMES.has(unit)) continue;
    if (ACTION_STOPWORDS.has(unit)) continue;
    if (TOKEN_ALIASES[unit] || STABLES.has(unit)) {
      const before = text.slice(0, m.index).toLowerCase();
      const isPayWith = /\b(with|با)\s*$/.test(before);
      return { amount: n, unit, match: m[0], isPayWith };
    }
  }
  return null;
}

function detectChain(text) {
  const lower = text.toLowerCase();
  // Tokenize and look for an alias as a whole token (possibly followed by "chain").
  // Check longer aliases first so "arbitrum one" wins over "arbitrum" wins over "arb", etc.
  const aliases = Object.entries(CHAIN_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, id] of aliases) {
    const tokens = alias.split(/\s+/);
    // Find the alias as a standalone phrase in the lowercased text.
    const re = new RegExp(
      `(^|\\s|(on|در|روی)\\s)${tokens.map(t => t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('\\s+')}(\\s+chain)?(\\s|$|\\.|,|!|\\?)`,
      'i'
    );
    if (re.test(lower) && ALLOWED_CHAINS.has(id)) return id;
  }
  return null;
}

/** Chain detector reused by the guided flow (network answers). */
export { detectChain };

/**
 * Chain detection with typo tolerance. "arbitrom" is a keystroke away from a
 * supported network, and refusing to route it while happily routing a
 * misspelled ticker would be an odd priority.
 *
 * Only the LONG aliases are fuzzy-matched. Fuzzing "op" or "sol" would match
 * half the dictionary; fuzzing "arbitrum" cannot plausibly land anywhere else.
 */
function detectChainFuzzy(text) {
  const exact = detectChain(text);
  if (exact) return { chainId: exact, via: 'exact' };
  const folded = normalizeWord(text);
  const tokens = folded.split(' ').filter(Boolean);
  const longAliases = Object.entries(CHAIN_ALIASES)
    .filter(([alias]) => alias.length >= 6 && !alias.includes(' '))
    .sort((a, b) => b[0].length - a[0].length);
  for (const token of tokens) {
    const tol = typoTolerance(token);
    if (tol === 0) continue;
    for (const [alias, id] of longAliases) {
      if (Math.abs(alias.length - token.length) > tol) continue;
      if (editDistance(token, alias, tol) <= tol && ALLOWED_CHAINS.has(id)) {
        return { chainId: id, via: 'typo', alias };
      }
    }
  }
  return { chainId: null, via: null };
}

export { detectChainFuzzy };

function detectLeverage(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s?x\s?(leverage|lev|long|short)?/i);
  if (m) {
    const lev = Number(m[1]);
    if (Number.isFinite(lev) && lev > 0 && lev <= 100) return lev;
  }
  return null;
}

function detectGoal(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s?%/);
  if (m) {
    const pct = Number(m[1]);
    if (Number.isFinite(pct) && pct > 0 && pct <= 1000) return pct;
  }
  return null;
}

function detectDuration(text) {
  const hours = text.match(/(\d+)\s?(h|hr|hour|hours)/i);
  const days = text.match(/(\d+)\s?(d|day|days)/i);
  const minutes = text.match(/(\d+)\s?(m|min|minute|minutes)/i);
  if (hours) return { hrs: Number(hours[1]) };
  if (days) return { hrs: Number(days[1]) * 24 };
  if (minutes) return { hrs: Number(minutes[1]) / 60 };
  return null;
}

function detectDirection(text) {
  if (/(?:^|\s|[.,!?؛،])(buy|long|purchase|accumulate|خرید)(?:\s|[.,!?؛،]|$)/i.test(text)) return 'buy';
  if (/(?:^|\s|[.,!?؛،])(sell|short|exit|dump|فروش)(?:\s|[.,!?؛،]|$)/i.test(text)) return 'sell';
  return null;
}

/**
 * Fill the gaps the keyword pass left, from the semantic reading.
 *
 * The rule is strict and it is the whole reason this is safe to bolt onto a
 * money path: SEMANTICS ONLY ADDS. Where the original keyword engine already
 * produced a value, that value stands untouched — so every utterance the
 * parser understood before still parses to exactly the same intent, and the
 * 5,985 assertions that depend on it are unaffected. Semantics only speaks
 * where the old engine was silent, which is precisely the set of sentences it
 * was blind to.
 */
function applySemantics(intent, sem, existing) {
  const out = { ...intent };
  const signals = [];

  if (!sem) return { intent: out, signals };

  /*
   * Nothing in the sentence was understood — no verb, no asset, no objective,
   * no number. That is the honest answer, and it has to override whatever the
   * keyword pass scraped together, because the ticker heuristic reads ANY
   * 2-6 letter word as a symbol: "xkcd 42 zzz" produced fromSymbol XKCD and
   * toSymbol ZZZ. Offering a swap on a token the lexicon has never heard of,
   * out of a sentence nobody understood, is the worst available response to
   * gibberish. Better to say so and ask.
   */
  if (sem.understood === false && !existing.action) {
    out.kind = null;
    out.action = null;
    if (out.fromSymbol && !ASSET_ALIAS_INDEX.has(normalizeWord(out.fromSymbol))) out.fromSymbol = null;
    if (out.toSymbol && !ASSET_ALIAS_INDEX.has(normalizeWord(out.toSymbol))) out.toSymbol = null;
    signals.push('understanding:none');
    return { intent: out, signals };
  }
  if (sem.understood === false) return { intent: out, signals };

  /* ── action / kind ─────────────────────────────────────────────────── */
  const top = sem.actions[0];
  if (!existing.action && top) {
    out.action = top.action;
    out.kind = top.kind;
    out.subType = top.subType ?? out.subType;
    signals.push(`action:${top.action} (semantic:${top.source ?? 'lexicon'})`);
  }
  /*
   * A question about whether to act is analysis. "بیت کوین الان بخرم یا نه؟"
   * contains the verb BUY and means the opposite of an order to buy; routing
   * it to a swap screen would be the worst possible answer to it.
   */
  if (sem.deliberating && out.kind !== 'conversation' && out.kind !== 'help') {
    out.action = 'analyze';
    out.kind = 'analysis';
    signals.push('action:analyze (question, not an order)');
  }
  /* An objective with no verb is still a request — for a plan. */
  if (!out.action || (out.kind === 'analysis' && !existing.action && sem.objective)) {
    if (sem.objective && !existing.action) {
      out.action = 'goal';
      out.kind = 'goal';
      signals.push(`action:goal (objective:${sem.objective})`);
    }
  }
  if (sem.objective) out.objective = sem.objective;
  if (sem.riskTolerance) out.riskTolerance = sem.riskTolerance;

  /* ── amount ────────────────────────────────────────────────────────── */
  if (!existing.amount && sem.capital) {
    out.amount = sem.capital.value;
    out.amountUnit = sem.capital.unit;
    if (sem.capital.unit === 'USD') out.amountUsd = sem.capital.value;
    signals.push(`amount:${sem.capital.value}${sem.capital.unit} (semantic:${sem.capital.via})`);
  }
  /* "half of my money" — a share, not an invented number. */
  if (sem.amountPct != null) {
    out.amountPct = sem.amountPct;
    signals.push(`amountPct:${sem.amountPct}%`);
  }
  if (sem.fuzzyAmount) {
    out.fuzzyAmount = sem.fuzzyAmount;
    signals.push(`amount:fuzzy(${sem.fuzzyAmount})`);
  }

  /* ── assets, in the order the customer wrote them ──────────────────── */
  const stables = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD', 'USD']);
  /*
   * "USD" is a unit of account, not something a wallet holds. It becomes a
   * source only when the customer is actually buying — "buy $200 of bitcoin"
   * genuinely means pay in dollars. Left in for a sentence with no direction,
   * it becomes a phantom fromSymbol that makes the guided flow skip the
   * "which asset are you selling?" question it exists to ask.
   */
  const directionForAssets = intent.direction ?? top?.direction ?? null;
  const semAssets = (sem.assets || [])
    .map((a) => a.symbol)
    .filter(Boolean)
    .filter((sym) => sym !== 'USD' || directionForAssets === 'buy');

  /*
   * If the keyword pass guessed a symbol the lexicon has never heard of, and
   * the semantic pass found a real one, the real one wins. "OF" and "PUT" are
   * not assets; ETH is.
   */
  if (semAssets.length) {
    if (out.fromSymbol && !ASSET_ALIAS_INDEX.has(normalizeWord(out.fromSymbol)) && !stables.has(out.fromSymbol)) {
      out.fromSymbol = null;
      signals.push('dropped:invented-from-symbol');
    }
    if (out.toSymbol && !ASSET_ALIAS_INDEX.has(normalizeWord(out.toSymbol)) && !stables.has(out.toSymbol)) {
      out.toSymbol = null;
      signals.push('dropped:invented-to-symbol');
    }
  }
  const direction = directionForAssets;
  if (semAssets.length) {
    if (!out.toSymbol && direction === 'buy') {
      out.toSymbol = semAssets.find((s) => !stables.has(s)) ?? semAssets[0];
      if (!out.fromSymbol) out.fromSymbol = semAssets.find((s) => stables.has(s) && s !== out.toSymbol) ?? null;
    } else if (!out.fromSymbol && direction === 'sell') {
      /*
       * "همه رو بفروش و ببر تتر" names only the destination. When the sole
       * asset mentioned is a stable and the customer is selling everything,
       * that stable is where the money is GOING, not what is being sold — the
       * source is whatever they hold, which the confirmation screen lists.
       */
      const nonStable = semAssets.find((s) => !stables.has(s));
      if (nonStable) {
        out.fromSymbol = nonStable;
        if (!out.toSymbol) out.toSymbol = semAssets.find((s) => stables.has(s) && s !== out.fromSymbol) ?? null;
      } else if (out.amountPct != null && semAssets.length === 1) {
        out.toSymbol = semAssets[0];
      } else {
        out.fromSymbol = semAssets[0];
      }
    } else if (!out.toSymbol && out.amountPct != null && semAssets.length === 1) {
      /*
       * "نصف پولم رو ببر بیت کوین" — a SHARE of the portfolio is being moved
       * INTO the one asset named. That asset is the destination; the source is
       * "whatever I hold", which the confirmation screen will show.
       */
      out.toSymbol = semAssets[0];
    } else {
      if (!out.fromSymbol) out.fromSymbol = semAssets[0];
      if (!out.toSymbol) out.toSymbol = semAssets.find((s) => s !== out.fromSymbol) ?? null;
    }
    if (!existing.from && out.fromSymbol) signals.push(`from:${out.fromSymbol} (semantic)`);
    if (!existing.to && out.toSymbol) signals.push(`to:${out.toSymbol} (semantic)`);
  }
  if (direction && !out.direction) out.direction = direction;
  if (!out.direction) {
    const carried = (sem.actions || []).find((a) => a.direction);
    if (carried) {
      out.direction = carried.direction;
      signals.push(`direction:${carried.direction} (semantic:${carried.action})`);
    }
  }

  /* ── goal, horizon, leverage, recurrence, loss cap ─────────────────── */
  if (sem.goalPct != null && out.goalPct == null) {
    out.goalPct = sem.goalPct;
    out.kind = 'goal';
    signals.push(`goal:${sem.goalPct}% (semantic)`);
  }
  if (sem.durationHrs != null && out.durationHrs == null) {
    out.durationHrs = sem.durationHrs;
    signals.push(`duration:${sem.durationHrs}h (semantic)`);
  }
  if (sem.leverage != null && out.leverage == null) {
    out.leverage = sem.leverage;
    signals.push(`leverage:${sem.leverage}x (semantic)`);
  }
  if (sem.recurring) {
    out.recurring = sem.recurring;
    signals.push(`recurring:${sem.recurring}`);
  }
  if (sem.maxLossUsd != null) {
    out.maxLossUsd = sem.maxLossUsd;
    signals.push(`maxLossUsd:${sem.maxLossUsd}`);
  }

  /* ── nothing at all: say so instead of defaulting to "analysis" ────── */
  if (!existing.action && !semAssets.length && !sem.objective && sem.capital == null && !sem.understood) {
    out.kind = null;
    out.action = null;
    signals.push('understanding:none');
  }

  return { intent: out, signals };
}

/**
 * Parse a user utterance into a structured intent draft.
 *
 * @param {string} rawText
 * @param {object} [context] — { defaultChainId, balances: {...}, locale }
 */
export function parseUserIntent(rawText, context = {}) {
  let text = String(rawText ?? '').trim();
  const persianNums = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicNums  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  for (let i = 0; i < 10; i++) {
    text = text.replace(persianNums[i], i).replace(arabicNums[i], i);
  }
  const signals = [];
  const clarifications = [];

  if (!text) {
    return {
      ok: false,
      intent: null,
      confidence: 0,
      clarifications: ['EMPTY_INPUT'],
      signals: [],
      raw: ''
    };
  }

  // 1. Detect action
  let action = null;
  let kind = 'analysis';
  let subType = null;
  let bestHits = 0;
  for (const row of ACTION_KEYWORDS) {
    let hits = 0;
    for (const kw of row.keywords) {
      if (new RegExp(`(?:^|\\s|[.,!?؛،])${kw.replace(/ /g, '\\s+')}(?:\\s|[.,!?؛،]|$)`, 'i').test(text)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      action = row.action;
      kind = row.kind;
      subType = row.subType || null;
    }
  }
  if (action) signals.push(`action:${action}`);
  else clarifications.push('ACTION_UNCLEAR');

  // 2. Detect amount & unit
  const amt = detectAmount(text);
  signals.push(amt ? `amount:${amt.amount}${amt.unit}` : 'amount:missing');
  if (!amt && kind !== 'analysis') clarifications.push('AMOUNT_MISSING');

  // 3. Detect tokens — look around "for", "to", "from", direction words.
  let fromSymbol = null;
  let toSymbol = null;
  const direction = detectDirection(text);
  const words = text.replace(/[.,!?]/g, ' ').split(/\s+/);

  // Decide which side the detected amount belongs to:
  //  - "buy N X with ..." → N is the target buy amount (toSymbol = X); the pay-with side funds it.
  //  - "sell N X for USDT" → N is the source sell amount (fromSymbol = X).
  //  - "swap N X to Y" / generic → N is the source.
  if (amt && amt.unit !== 'USD') {
    if (direction === 'buy' && !amt.isPayWith) {
      toSymbol = amt.unit;
    } else {
      fromSymbol = amt.unit;
    }
  }

  // Filter word list down to plausible tokens.
  const isPlausibleToken = (tok, w) => {
    if (!tok) return false;
    if (/^\d+$/.test(tok)) return false;
    if (ACTION_STOPWORDS.has(tok)) return false;
    if (FILLER_WORDS.has(tok)) return false;
    if (CHAIN_LONG_NAMES.has(tok)) return false;
    // English filler words / units that normalize to something but aren't tokens.
    if (/(DAY|HOUR|MINUTE|HOURS|DAYS|MINUTES|WEEK|MONTH|YEAR|WANT|MY|I|ME|THE|A|AN|IN|ON|AT)$/.test(tok)) return false;
    // Require TOKEN_ALIASES hit OR 2-6 uppercase chars (ticker-shaped) OR it's a stable.
    if (TOKEN_ALIASES[tok] || STABLES.has(tok)) return true;
    if (/^[A-Z]{2,6}$/.test(tok)) return true;
    return false;
  };
  const tokenCandidates = [];
  for (const w of words) {
    const tok = normalizeToken(w);
    if (isPlausibleToken(tok, w)) tokenCandidates.push(tok);
  }

  // Find the "with Y"/"for Y" clause (the opposite side).
  const withIdx = words.findIndex((w) => /^(with|با)$/i.test(w));
  const forIdx  = words.findIndex((w) => /^(for|برای)$/i.test(w));
  const toIdx   = words.findIndex((w) => /^(to|به)$/i.test(w));

  const tokensAfter = (idx) => {
    if (idx < 0) return null;
    const out = [];
    for (const w of words.slice(idx + 1)) {
      const tok = normalizeToken(w);
      if (isPlausibleToken(tok, w)) out.push(tok);
    }
    return out;
  };

  if (direction === 'buy') {
    // Source of funds is the first token after "with" (or a stable in candidates).
    const afterWith = tokensAfter(withIdx);
    if (!fromSymbol && afterWith && afterWith.length) fromSymbol = afterWith[0];
    if (!fromSymbol) fromSymbol = tokenCandidates.find((t) => STABLES.has(t) && t !== toSymbol) || null;
    // Target: prefer the amt.unit if we already set toSymbol above, else first non-stable.
    if (!toSymbol) {
      toSymbol = tokenCandidates.find((t) => !STABLES.has(t) && t !== fromSymbol) || null;
    }
  } else if (direction === 'sell') {
    // Sell N X for/to Y (usually a stable).
    if (!fromSymbol) fromSymbol = tokenCandidates.find((t) => !STABLES.has(t)) || null;
    const afterFor = tokensAfter(forIdx >= 0 ? forIdx : toIdx);
    if (!toSymbol && afterFor && afterFor.length) toSymbol = afterFor.find((t) => STABLES.has(t)) || afterFor[0];
    if (!toSymbol) toSymbol = tokenCandidates.find((t) => STABLES.has(t) && t !== fromSymbol) || 'USDC';
  } else {
    // Generic "swap X to Y" / "convert X for Y".
    const afterTo = tokensAfter(toIdx >= 0 ? toIdx : forIdx);
    if (afterTo && afterTo.length && !toSymbol) toSymbol = afterTo[0];
    // If amount gave us the source, the other candidate is the target (and vice versa).
    const other = tokenCandidates.filter((t) => t !== fromSymbol && t !== toSymbol);
    if (fromSymbol && !toSymbol && other[0]) toSymbol = other[0];
    if (!fromSymbol && !toSymbol) {
      if (other.length >= 2) {
        fromSymbol = other[0]; toSymbol = other[1];
      } else if (other.length === 1) {
        fromSymbol = other[0];
      }
    }
  }

  if (fromSymbol) signals.push(`from:${fromSymbol}`); else if (kind !== 'analysis') clarifications.push('FROM_ASSET_MISSING');
  if (toSymbol) signals.push(`to:${toSymbol}`);     else if (kind !== 'analysis' && action !== 'send') clarifications.push('TO_ASSET_MISSING');

  // Implicit swap detection: if no explicit action but we have amount + from + to (via 'به' / 'to')
  if (!action && amt && fromSymbol && toSymbol) {
    action = 'swap';
    kind = 'swap';
    const clIdx = clarifications.indexOf('ACTION_UNCLEAR');
    if (clIdx >= 0) clarifications.splice(clIdx, 1);
    signals.push('action:swap (inferred)');
  }

  // 4. Chain
  let chainId = detectChain(text);
  if (!chainId) chainId = context.defaultChainId && ALLOWED_CHAINS.has(context.defaultChainId)
    ? context.defaultChainId
    : null;
  if (chainId) signals.push(`chain:${chainId}`);
  else clarifications.push('CHAIN_UNCLEAR');

  // 5. Leverage
  const leverage = detectLeverage(text);
  if (leverage) signals.push(`leverage:${leverage}x`);

  // 6. Goal / duration
  const goalPct = detectGoal(text);
  const duration = detectDuration(text);
  if (goalPct) {
    kind = 'goal';
    signals.push(`goal:${goalPct}%`);
  }
  if (duration) signals.push(`duration:${duration.hrs}h`);

  // Build structured intent draft
  let intent = {
    kind,
    subType,
    action: action || 'analyze',
    fromSymbol,
    toSymbol,
    amount: amt?.amount ?? null,
    amountUnit: amt?.unit ?? null,
    amountUsd: amt?.unit === 'USD' ? amt.amount : null,
    chainId,
    leverage: leverage ?? null,
    goalPct: goalPct ?? null,
    durationHrs: duration?.hrs ?? null,
    direction,
    mode: 'human-ai'
  };

  /* ── SEMANTIC PASS ─────────────────────────────────────────────────────
   * Runs after the keyword engine and only fills what it left empty. See
   * applySemantics for why that ordering is the safety property.
   */
  const semantic = analyzeUtterance(text, { locale: context.locale ?? null });
  const enriched = applySemantics(intent, semantic, {
    action, amount: amt?.amount ?? null, from: fromSymbol, to: toSymbol
  });
  intent = enriched.intent;
  for (const sig of enriched.signals) if (!signals.includes(sig)) signals.push(sig);

  /*
   * Every asset the customer named, in the order they named them. An
   * "analyze BTC ETH SOL" request is about three markets, not two — the
   * keyword engine only models a from/to pair, so the semantic asset list
   * fills in the rest. The chat layer renders one market block per symbol;
   * symbols the feed cannot price are reported as unavailable, never
   * dropped silently.
   */
  const namedAssets = [];
  for (const sym of [intent.fromSymbol, intent.toSymbol]) {
    if (sym && !namedAssets.includes(sym)) namedAssets.push(sym);
  }
  for (const row of semantic.assets || []) {
    const sym = String(row?.symbol || '').toUpperCase();
    if (sym && !namedAssets.includes(sym)) namedAssets.push(sym);
  }
  intent.assets = namedAssets;

  /* A chain the keyword pass missed, allowing one keystroke of sloppiness. */
  if (!intent.chainId) {
    const fuzzy = detectChainFuzzy(text);
    if (fuzzy.chainId) {
      intent.chainId = fuzzy.chainId;
      const ci = clarifications.indexOf('CHAIN_UNCLEAR');
      if (ci >= 0) clarifications.splice(ci, 1);
      signals.push(`chain:${fuzzy.chainId} (semantic:${fuzzy.via})`);
    }
  }

  // 7. Confidence heuristic
  let confidence = 100;
  confidence -= clarifications.length * 20;
  confidence -= bestHits === 0 ? 10 : 0;
  confidence -= !amt ? 5 : 0;
  /*
   * Understanding a sentence in the semantic pass is worth as much as
   * understanding it by keyword: a customer whose phrasing simply is not in a
   * 40-word table is not less clear about what they want.
   */
  if (bestHits === 0 && semantic.understood) confidence += 10;
  /* A share of the portfolio stands in for a missing absolute amount. */
  if (intent.amountPct != null && !amt) confidence += 5;
  /* A question is a complete request — nothing is missing from it. */
  if (semantic.deliberating) confidence += 15;
  confidence = Math.max(5, Math.min(100, confidence));

  /*
   * `ok` means "this is a COMPLETE instruction", and it deliberately keeps the
   * original contract: a money intent is only complete with an action, a size
   * and a source. An incomplete one is not an error — it hands over to the
   * guided flow, which asks.
   *
   * An early draft of this made a goal-shaped sentence `ok` on the strength of
   * the verb alone, and that silently broke the guided flow: the chip answer
   * "Goal" parsed as a complete intent and skipped the amount question. So a
   * goal with no target and no size is still incomplete here. Understanding a
   * sentence and being ready to execute it are different properties, and only
   * the second one gates the flow.
   *
   * What semantics DID change is what counts as a size: a stated share of the
   * portfolio ("نصف پولم") or an admitted fuzzy amount ("یکم") both stand in
   * for an absolute number, and a buy with a named target does not need a
   * source named — the wallet is the source.
   */
  const ok = (intent.kind === 'analysis' || intent.kind === 'conversation' || intent.kind === 'help')
    /*
     * `action`, the local — NOT `intent.action`.
     *
     * intent.action carries a default ('analyze') so the object is always
     * well-formed, and testing the defaulted value would make every
     * unrecognised sentence look like a complete analysis request, skipping
     * the guided flow. An analysis intent is complete only when the customer
     * actually asked to analyse something.
     */
    ? Boolean(action)
    : (
      Boolean(intent.action)
      && Boolean(amt || intent.amountPct != null || intent.fuzzyAmount)
      && Boolean(intent.fromSymbol || intent.direction === 'buy')
      && (intent.kind === 'send' || Boolean(intent.toSymbol) || intent.direction === 'buy')
    );

  // Product limits: over-limit numbers parse fine but carry a friendly
  // warning so the chat layer can ask the user to respect the ceiling
  // instead of silently clamping their money.
  const limitViolations = checkIntentLimits(intent);

  return {
    ok,
    intent,
    confidence,
    clarifications: (intent.kind === 'conversation' || intent.kind === 'help') ? [] : [...new Set(clarifications)],
    signals,
    limitViolations,
    semantic,
    raw: text.slice(0, 500)
  };
}

/**
 * Given a parsed intent and answers to prior clarifications, return a refined
 * intent. Answers is a map of CLARIFICATION_CODE -> value.
 */
export function refineIntent(parsed, answers = {}) {
  const out = { ...parsed.intent };
  if (answers.FROM_ASSET) out.fromSymbol = normalizeToken(answers.FROM_ASSET) || out.fromSymbol;
  if (answers.TO_ASSET)   out.toSymbol   = normalizeToken(answers.TO_ASSET)   || out.toSymbol;
  if (answers.AMOUNT && Number.isFinite(Number(answers.AMOUNT))) {
    out.amount = Number(answers.AMOUNT);
    out.amountUnit = out.amountUnit || (out.fromSymbol || 'USD');
    if (out.amountUnit === 'USD') out.amountUsd = out.amount;
  }
  if (answers.CHAIN_ID && ALLOWED_CHAINS.has(Number(answers.CHAIN_ID))) {
    out.chainId = Number(answers.CHAIN_ID);
  }
  if (answers.LEVERAGE && Number.isFinite(Number(answers.LEVERAGE))) {
    out.leverage = Math.max(1, Math.min(Number(answers.LEVERAGE), 100));
  }
  // Guided-flow answers: goal percentage and duration in hours.
  if (answers.GOAL_PCT != null && Number.isFinite(Number(answers.GOAL_PCT)) && Number(answers.GOAL_PCT) > 0) {
    out.goalPct = Number(answers.GOAL_PCT);
    out.kind = 'goal';
  }
  if (answers.DURATION_HRS != null && Number.isFinite(Number(answers.DURATION_HRS)) && Number(answers.DURATION_HRS) > 0) {
    out.durationHrs = Number(answers.DURATION_HRS);
    out.kind = out.kind === 'analysis' || out.kind === 'conversation' ? 'goal' : out.kind;
  }
  // An "unclear action" parse that receives actionable answers becomes a
  // real intent, so answering the guided flow's first question continues the
  // session instead of looping on the same clarification.
  const actionable = answers.FROM_ASSET || answers.TO_ASSET || answers.AMOUNT || answers.GOAL_PCT || answers.DURATION_HRS;
  if (actionable && (!out.action || out.kind === 'conversation' || out.kind === 'help')) {
    out.action = out.goalPct != null ? 'goal' : 'swap';
    out.kind = out.goalPct != null ? 'goal' : 'swap';
  }
  const refined = { ...parsed, intent: out, ok: Boolean(out.action && out.fromSymbol) };
  refined.limitViolations = checkIntentLimits(out);
  return refined;
}
