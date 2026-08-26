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

const CHAIN_ALIASES = {
  ethereum: 1, eth: 1, mainnet: 1,
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
  'SWAP', 'EXCHANGE', 'CONVERT', 'TRADE', 'BRIDGE', 'SEND', 'TRANSFER',
  'PAY', 'BUY', 'PURCHASE', 'LONG', 'SELL', 'SHORT', 'EXIT', 'FARM',
  'STAKE', 'YIELD', 'LP', 'LIQUIDITY', 'FUTURES', 'PERPS', 'PERPETUAL',
  'LEVERAGE', 'LEV', 'DYDX', 'DEFI', 'ANALYZE', 'ANALYSE', 'ANALYSIS', 'RESEARCH',
  'PORTFOLIO', 'WALLET', 'HOLDINGS', 'BALANCE', 'NEWS', 'SIGNAL',
  'GOAL', 'TARGET', 'PROFIT', 'ON', 'TO', 'WITH', 'FOR', 'FROM', 'INTO', 'AT',
  'MAKE', 'GET', 'WANT', 'I', 'ME', 'MY'
]);

/* Chain words that should NOT be treated as tokens when used with "on <chain>" context.
   Note: short symbols like ETH, SOL, BNB, ARB, OP, MATIC, AVAX, TRX, TON are also tokens
   (they are in TOKEN_ALIASES) so we only filter out the long names + MAINNET/CHAIN. */
const CHAIN_LONG_NAMES = new Set([
  'ETHEREUM', 'ARBITRUM', 'OPTIMISM', 'BINANCE', 'POLYGON', 'SONIC',
  'AVALANCHE', 'LINEA', 'SOLANA', 'TRON', 'MAINNET', 'CHAIN'
]);

const ACTION_KEYWORDS = [
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
  { action: 'analyze',     keywords: ['analyze', 'analyse', 'analysis', 'research', 'look at'],  kind: 'analysis' },
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

function detectAmount(text) {
  // "$500" — explicit USD
  const usdMatch = text.match(/\$\s?([0-9]+(?:\.[0-9]+)?)/);
  if (usdMatch) return { amount: Number(usdMatch[1]), unit: 'USD', match: usdMatch[0] };

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
      const isPayWith = /\bwith\s*$/.test(before);
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
      `(^|\\s|on\\s)${tokens.map(t => t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('\\s+')}(\\s+chain)?(\\s|$|\\.|,|!|\\?)`,
      'i'
    );
    if (re.test(lower) && ALLOWED_CHAINS.has(id)) return id;
  }
  return null;
}

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
  if (/\b(buy|long|purchase|accumulate)\b/i.test(text)) return 'buy';
  if (/\b(sell|short|exit|dump)\b/i.test(text)) return 'sell';
  return null;
}

/**
 * Parse a user utterance into a structured intent draft.
 *
 * @param {string} rawText
 * @param {object} [context] — { defaultChainId, balances: {...}, locale }
 */
export function parseUserIntent(rawText, context = {}) {
  const text = String(rawText ?? '').trim();
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
  let bestHits = 0;
  for (const row of ACTION_KEYWORDS) {
    let hits = 0;
    for (const kw of row.keywords) {
      if (new RegExp(`\\b${kw.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      action = row.action;
      kind = row.kind;
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
  const withIdx = words.findIndex((w) => /^with$/i.test(w));
  const forIdx  = words.findIndex((w) => /^for$/i.test(w));
  const toIdx   = words.findIndex((w) => /^to$/i.test(w));

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
    if (!fromSymbol && !toSymbol && other.length >= 2) {
      fromSymbol = other[0]; toSymbol = other[1];
    }
  }

  if (fromSymbol) signals.push(`from:${fromSymbol}`); else if (kind !== 'analysis') clarifications.push('FROM_ASSET_MISSING');
  if (toSymbol) signals.push(`to:${toSymbol}`);     else if (kind !== 'analysis' && action !== 'send') clarifications.push('TO_ASSET_MISSING');

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

  // 7. Confidence heuristic
  let confidence = 100;
  confidence -= clarifications.length * 20;
  confidence -= bestHits === 0 ? 10 : 0;
  confidence -= !amt ? 5 : 0;
  confidence = Math.max(5, Math.min(100, confidence));

  // Build structured intent draft
  const intent = {
    kind,
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

  // analysis-only intents don't require all fields
  const ok = kind === 'analysis' ? Boolean(action) : (
    Boolean(action) && Boolean(amt) && Boolean(fromSymbol) && (kind === 'send' || Boolean(toSymbol))
  );

  return {
    ok,
    intent,
    confidence,
    clarifications: [...new Set(clarifications)],
    signals,
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
  return { ...parsed, intent: out, ok: Boolean(out.action && out.fromSymbol) };
}
