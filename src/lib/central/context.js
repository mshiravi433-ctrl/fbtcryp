/**
 * FBT CENTRAL INTELLIGENCE OS — Context Engine (spec §5–§7, §18).
 * ---------------------------------------------------------------------------
 * The reported failure this module exists to kill: the user says «انجامش بده»
 * and the assistant answers «منظورتان چیست؟». That happens when the model is
 * handed a message and a prompt but not a WORLD. Here the world is assembled
 * from eleven named inputs before anything is decided, and — the part the old
 * path never did — an unresolved pronoun is RESOLVED against memory before the
 * system is allowed to consider asking.
 *
 * THREE DELIBERATE CHOICES
 *
 * 1. Asking is a last resort with a proof. `contextSufficiency()` returns the
 *    exact missing field names. A question is only legitimate when that list is
 *    non-empty, and the question must name those fields — «لطفاً بیشتر توضیح
 *    دهید» is impossible to emit from this code path (§20).
 *
 * 2. Follow-up detection is lexical, not "LLM-smart". Persian clitics and
 *    object pronouns («بفروشم؟», «انجامش بده», «چقدر می‌توانم بگیرم؟») are a
 *    closed set of forms. Encoding them once keeps resolution deterministic and
 *    testable; a model that guesses whether «ش» referred to BTC is exactly the
 *    bug being fixed.
 *
 * 3. Page context is a CLAIM, not a fact. The browser says "I am on /loan, tab
 *    borrow, asset USDC". That resolves references; it never authorises an
 *    action and never overrides state the server read itself.
 */
import { CI_SCHEMA, hashString, round, usableNumber } from './schema.js';

export const CONTEXT_SCHEMA = 'fbt.central-context.v1';

/* ── text normalisation ─────────────────────────────────────────────────── */
const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

/**
 * One canonical form for matching. Persian yā/kaf variants, Arabic-Indic and
 * Persian digits, tatweel and the zero-width joiner that keyboards smuggle in,
 * and the ZWNJ (نیم‌فاصله) which must become a SPACE rather than vanish: «می‌توانم»
 * searched as "میتوانم" misses every lexicon written with a space.
 */
export function normalizeText(input) {
  let s = String(input ?? '');
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '');
  s = s.replace(/[\u064B-\u0652\u0670]/g, '');
  s = s.replace(/\u0640/g, '');
  s = s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه');
  s = s.replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] || d);
  s = s.replace(/[\u200c]/g, ' ');
  s = s.replace(/[،؛]/g, (p) => (p === '،' ? ',' : ';'));
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

/* ── §7 page awareness ──────────────────────────────────────────────────── */
/*
 * Route → module/tab/what-can-here, derived from the actual route table in
 * src/App.jsx. Kept as data so a new page registers its module in one place and
 * the brain discovers it without a new prompt line.
 */
export const PAGE_MAP = Object.freeze({
  '/wallet': { module: 'wallet', tabs: ['overview', 'tokens', 'activity'], intents: ['balance', 'send', 'history'] },
  '/portfolio': { module: 'portfolio', tabs: ['overview', 'allocation', 'performance', 'risk'], intents: ['analyze', 'rebalance', 'concentration'] },
  '/swap': { module: 'swap', tabs: ['swap'], intents: ['quote', 'swap'] },
  '/bridge': { module: 'bridge', tabs: ['bridge', 'status'], intents: ['quote', 'bridge'] },
  '/loan': { module: 'lending', tabs: ['supply', 'borrow', 'repay', 'withdraw'], intents: ['positions', 'borrow', 'repay', 'risk'] },
  '/earn': { module: 'farming', tabs: ['pools', 'staking', 'liquidity'], intents: ['opportunities', 'farm'] },
  '/farm': { module: 'farming', tabs: ['pools'], intents: ['opportunities', 'farm'] },
  '/perp': { module: 'futures', tabs: ['markets', 'positions'], intents: ['markets', 'open', 'close'] },
  '/dydx': { module: 'dydx', tabs: ['markets', 'account'], intents: ['markets', 'order'] },
  '/derivatives': { module: 'futures', tabs: ['overview', 'funding'], intents: ['funding', 'exposure'] },
  '/ostium': { module: 'commodities', tabs: ['markets'], intents: ['markets'] },
  '/stocks': { module: 'stocks', tabs: ['markets', 'watchlist'], intents: ['markets', 'quote'] },
  '/market': { module: 'crypto', tabs: ['overview', 'gainers'], intents: ['prices', 'screener'] },
  '/coin/:id': { module: 'crypto', tabs: ['overview', 'technicals'], intents: ['analyze', 'buy'] },
  '/signals': { module: 'signals', tabs: ['list', 'asset'], intents: ['signals'] },
  '/news': { module: 'news', tabs: ['feed', 'asset'], intents: ['news'] },
  '/smart-money': { module: 'signals', tabs: ['overview', 'tokens', 'wallets'], intents: ['flow', 'signals'] },
  '/orders': { module: 'transactions', tabs: ['open', 'history'], intents: ['orders', 'cancel'] },
  '/transactions': { module: 'transactions', tabs: ['history'], intents: ['history', 'status'] },
  '/intent': { module: 'intent-os', tabs: ['chat', 'automations', 'memory'], intents: ['chat', 'plan'] },
  '/intent-ai': { module: 'intent-os', tabs: ['chat'], intents: ['chat'] },
  '/vault': { module: 'staking', tabs: ['overview'], intents: ['deposit', 'withdraw'] },
  '/predict': { module: 'prediction', tabs: ['markets'], intents: ['forecast'] },
  '/lab': { module: 'lab', tabs: ['simulation', 'backtest', 'whatif'], intents: ['simulate', 'backtest', 'whatif'] },
  '/invest': { module: 'profit-plan', tabs: ['plan', 'goals'], intents: ['plan', 'goals'] },
  '/trade': { module: 'swap', tabs: ['trade'], intents: ['trade'] },
  '/solana': { module: 'swap', tabs: ['solana'], intents: ['quote', 'swap'] },
  '/buy': { module: 'fiat', tabs: ['ramp'], intents: ['buy'] },
  '/settings': { module: 'session', tabs: ['general', 'security'], intents: ['settings'] },
  '/explore': { module: 'crypto', tabs: ['list'], intents: ['browse'] }
});

const ROUTE_PREFIX_ALIASES = Object.freeze({
  '/smart-money/token': { module: 'crypto', tab: 'token', intents: ['analyze'] },
  '/smart-money/wallet': { module: 'signals', tab: 'wallet', intents: ['flow'] },
  '/flash-liquidity': { module: 'liquidity', tab: 'scan', intents: ['scan'] }
});

/**
 * Resolve any route to `{ module, tab, intents }`.
 *
 * Unknown routes yield `module: 'session'` and NO intents rather than a guess.
 * A wrong module is worse than no module: it makes the brain resolve «انجامش
 * بده» into an action on the wrong surface.
 */
export function resolvePage(raw = {}) {
  const route = String(raw.route || raw.path || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const alias = ROUTE_PREFIX_ALIASES[Object.keys(ROUTE_PREFIX_ALIASES).find((p) => route.startsWith(p)) || ''];
  const mapped = PAGE_MAP[route] || (route.startsWith('/coin/') ? PAGE_MAP['/coin/:id'] : null) || alias || null;
  const requestedTab = normalizeText(raw.tab || raw.tabId || '');
  const tabs = mapped?.tabs || [];
  const tab = tabs.includes(requestedTab) ? requestedTab : (tabs[0] || null);
  return {
    route: route.slice(0, 120),
    module: mapped?.module || normalizeText(raw.module || '') || 'session',
    declaredModule: normalizeText(raw.module || '') || null,
    tab: tab || (requestedTab || null),
    known: Boolean(mapped),
    intents: mapped?.intents || [],
    selectedAsset: usableSymbol(raw.selectedAsset || raw.asset || null),
    selectedNetwork: usableSymbol(raw.selectedNetwork || raw.network || raw.chainId || null),
    walletConnected: raw.walletConnected === true,
    at: Number(raw.at) || 0
  };
}

/* ── §6 conversation memory ─────────────────────────────────────────────── */
export function emptyMemory() {
  return {
    lastIntent: null,
    lastEntities: null,
    lastTool: null,
    lastResult: null,
    lastAction: null,
    lastError: null,
    pendingConfirmation: null,
    conversationContext: { focus: [], turnCount: 0, lastQuestionAt: null, askedFor: [] },
    version: 1
  };
}

/**
 * Fold one completed turn into memory.
 *
 * `focus` is the ordered list of entities the conversation is ABOUT, newest
 * first, and it is trimmed to 6: long enough that «بفروشم؟» still means the BTC
 * from four turns ago, short enough that a session started on ETH does not
 * resolve a sell into ETH forever.
 */
export function applyTurn(memory, turn = {}) {
  const prev = memory || emptyMemory();
  const focus = Array.from(new Set([
    ...(turn.entities?.asset ? [String(turn.entities.asset).toUpperCase()] : []),
    ...(turn.entities?.network ? [`net:${String(turn.entities.network).toUpperCase()}`] : []),
    ...(turn.entities?.module ? [`mod:${turn.entities.module}`] : []),
    ...(prev.conversationContext?.focus || [])
  ])).slice(0, 6);
  return {
    ...prev,
    lastIntent: turn.intent ? { type: turn.intent.type || null, confidence: turn.intent.confidence ?? null, at: turn.at || Date.now() } : prev.lastIntent,
    lastEntities: turn.entities ? { ...turn.entities, at: turn.at || Date.now() } : prev.lastEntities,
    lastTool: turn.tool ? { ...turn.tool, at: turn.at || Date.now() } : prev.lastTool,
    lastResult: turn.result ? { summary: String(turn.result.summary || '').slice(0, 400), data: turn.result.data || null, at: turn.at || Date.now() } : prev.lastResult,
    lastAction: turn.action ? { ...turn.action, at: turn.at || Date.now() } : prev.lastAction,
    lastError: turn.error ? { ...turn.error, at: turn.at || Date.now() } : (turn.clearedError ? null : prev.lastError),
    pendingConfirmation: turn.pendingConfirmation === null
      ? null
      : (turn.pendingConfirmation ? { ...turn.pendingConfirmation, at: turn.at || Date.now() } : prev.pendingConfirmation),
    conversationContext: {
      focus,
      turnCount: (prev.conversationContext?.turnCount || 0) + 1,
      lastQuestionAt: turn.askedUser ? (turn.at || Date.now()) : (prev.conversationContext?.lastQuestionAt || null),
      askedFor: turn.askedUser ? [String(turn.askedUser).slice(0, 60)] : [],
      lastReplyFingerprint: turn.fingerprint || prev.conversationContext?.lastReplyFingerprint || null
    },
    version: 1
  };
}

/* ── §5/§6 reference resolution ─────────────────────────────────────────── */
/*
 * Closed-form lexicons. Order matters: anaphoric-confirmation is tested BEFORE
 * generic pronouns, because «انجامش بده» is both and must resolve to "run the
 * pending action", not to "some asset".
 */
const CONFIRM_WORDS = ['انجامش بده', 'انجامش بده.', 'همینو انجام بده', 'همین را انجام بده', 'انجام بده', 'بزن', 'اجراش کن', 'اجرای کن', 'ادامه بده', 'ادامه', 'تایید', 'تأیید', 'بله', 'آره', 'آری', 'خوبه', 'ok', 'yes', 'confirm', 'do it', 'go ahead', 'proceed'];
const CANCEL_WORDS = ['لغو', 'کنسل', 'نه', 'نمیخوام', 'نمی‌خوام', 'بی‌خیال', 'cancel', 'no', 'never mind', 'stop'];
const ANAPHORA_ONLY = ['اون', 'آن', 'این', 'همین', 'یادش', 'درباره همون', 'همون', 'it', 'this', 'that', 'the same'];
const SELL_WORDS = ['بفروشم', 'بفروشم؟', 'بفروش', 'فروش', 'فروشش', 'فروشش کنم', 'sell', 'sell it', 'sell some'];
const BUY_WORDS = ['بخرم', 'بخرمش', 'بخر', 'خرید کنم', 'خرید', 'buy', 'buy it', 'add more'];
const CAPACITY_WORDS = ['چقدر می توانم بگیرم', 'چقدر میتوانم بگیرم', 'چقدر می توانم وام بگیرم', 'چقدر وام', 'ظرفیت', 'حداکثر وام', 'how much can i borrow', 'borrowing power', 'max borrow'];
const RISK_WORDS = ['امن', 'امنیت', 'ریسک', 'خطر', 'لیکوئید', 'liquidation', 'safe', 'risk', 'health'];
const QUESTION_FOLLOWUPS = ['چقدر است', 'چقدره', 'چطور است', 'چطوره', 'چیه', 'چی شد', 'وضعیت', 'status', 'how much', 'how is', 'what about'];

const has = (text, list) => list.some((w) => text === w || text.includes(w));

export const FOLLOWUP_KINDS = Object.freeze({
  CONFIRM_PENDING: 'CONFIRM_PENDING',
  CANCEL_PENDING: 'CANCEL_PENDING',
  EXECUTE_LAST: 'EXECUTE_LAST',
  QUERY_LAST_ASSET: 'QUERY_LAST_ASSET',
  SELL_LAST_ASSET: 'SELL_LAST_ASSET',
  BUY_LAST_ASSET: 'BUY_LAST_ASSET',
  CAPACITY_QUERY: 'CAPACITY_QUERY',
  RISK_QUERY: 'RISK_QUERY',
  NONE: 'NONE'
});

/**
 * Classify a message as a follow-up on the previous turn.
 *
 * Short messages are the only ones allowed to be anaphoric. «بفروشم؟» is four
 * characters of pure reference; «بفروشم» inside a 900-character paragraph about
 * bridges is not, and resolving the paragraph to last month's BTC is precisely
 * the "context was lost and then mis-used" failure the spec reports.
 */
export function detectFollowUp(message, memory = {}, page = {}) {
  const text = normalizeText(message);
  const words = text.split(' ').filter(Boolean);
  const short = words.length <= 12;
  const base = { kind: FOLLOWUP_KINDS.NONE, anaphoric: false, confidence: 0, evidence: [] };
  if (!text) return base;

  /* Anaphora needs an antecedent. Without this check «چطور می‌تونم ETF بخرم؟» was
     read as "buy the asset from the previous turn" in a FRESH session, and the
     brain then acted on a referent that did not exist — the exact opposite of §5,
     which allows a follow-up resolution only when the conversation actually
     contains one. Page context counts as an antecedent (a selected asset on the
     page is a real referent); memory alone does not have to, but something must. */
  const antecedent = Boolean(
    memory?.lastEntities?.asset
    || (memory?.conversationContext?.focus || []).length
    || memory?.lastAction
    || page?.asset
    || page?.entity
    || page?.symbol
  );
  const evidence = [];
  if (memory.pendingConfirmation && has(text, CONFIRM_WORDS)) {
    evidence.push('pendingConfirmation+confirmWord');
    return { kind: FOLLOWUP_KINDS.CONFIRM_PENDING, anaphoric: true, confidence: 0.95, evidence };
  }
  if (memory.pendingConfirmation && has(text, CANCEL_WORDS)) {
    evidence.push('pendingConfirmation+cancelWord');
    return { kind: FOLLOWUP_KINDS.CANCEL_PENDING, anaphoric: true, confidence: 0.9, evidence };
  }
  if (short && has(text, ['انجامش بده', 'همینو انجام بده', 'اجراش کن', 'do it', 'execute it', 'run it', 'انجام بده'])) {
    if (!memory.pendingConfirmation && !memory.lastAction) return { ...base, evidence: ['execute-without-action'] };
    evidence.push('execute-last-action');
    return { kind: FOLLOWUP_KINDS.EXECUTE_LAST, anaphoric: true, confidence: memory.lastAction ? 0.85 : 0.6, evidence };
  }
  if (short && has(text, SELL_WORDS)) {
    if (!antecedent) return { ...base, evidence: ['sell-without-antecedent'] };
    evidence.push('sell+anaphora');
    return { kind: FOLLOWUP_KINDS.SELL_LAST_ASSET, anaphoric: true, confidence: 0.8, evidence };
  }
  if (short && has(text, BUY_WORDS)) {
    if (!antecedent) return { ...base, evidence: ['buy-without-antecedent'] };
    evidence.push('buy+anaphora');
    return { kind: FOLLOWUP_KINDS.BUY_LAST_ASSET, anaphoric: true, confidence: 0.75, evidence };
  }
  if (has(text, CAPACITY_WORDS)) {
    evidence.push('capacity-query');
    return { kind: FOLLOWUP_KINDS.CAPACITY_QUERY, anaphoric: false, confidence: 0.85, evidence };
  }
  if (short && has(text, RISK_WORDS) && has(text, QUESTION_FOLLOWUPS.concat(['وامم', 'وام من', 'پوزیشن', 'حساب']))) {
    if (!antecedent) return { ...base, evidence: ['risk-clitic-without-antecedent'] };
    evidence.push('risk-query-on-last-position');
    return { kind: FOLLOWUP_KINDS.RISK_QUERY, anaphoric: true, confidence: 0.8, evidence };
  }
  if (short && has(text, ANAPHORA_ONLY) && has(text, QUESTION_FOLLOWUPS)) {
    if (!antecedent) return { ...base, evidence: ['anaphora-without-antecedent'] };
    evidence.push('anaphora+question');
    return { kind: FOLLOWUP_KINDS.QUERY_LAST_ASSET, anaphoric: true, confidence: 0.7, evidence };
  }
  if (short && (text.endsWith('م؟') || text.endsWith('م ?') || /(وضعیتش|قیمتش|قیمتش چقدر|اندازه‌ش|اندازهش)/.test(text))) {
    if (!antecedent) return { ...base, evidence: ['clitic-without-antecedent'] };
    evidence.push('third-person-clitic');
    return { kind: FOLLOWUP_KINDS.QUERY_LAST_ASSET, anaphoric: true, confidence: 0.7, evidence };
  }
  /* A FIRST-person clitic («ریسک پرتفویم», «وام من») is not anaphora at all: it
     points at the user's own account, which is state we read, not a previous turn.
     Calling it a follow-up made every «…یم» question depend on chat history. */
  if (short && /(وامم|کیفتم|هدفم|پرتفویم|پورتفوییم|بدهیم|داراییم|حدودم|سودم)/.test(text)) {
    return { ...base, evidence: ['first-person-clitic-is-self-contained'] };
  }
  /* A possessive clitic on a domain noun («وامم», «پرتفوی من») is self-contained:
     it references the USER's position, which is state, not the previous turn. */
  if (page.module && short && has(text, ['وام', 'borrow', 'lend', 'supply', 'لند'])) {
    evidence.push('module-noun+page');
    return { kind: page.tab === 'borrow' ? FOLLOWUP_KINDS.CAPACITY_QUERY : FOLLOWUP_KINDS.RISK_QUERY, anaphoric: false, confidence: 0.6, evidence };
  }
  return base;
}

/**
 * Resolve what «ش/آن/it» means. Priority is a product decision, written down:
 * explicit mention in THIS message → page selection → last-mentioned asset →
 * unresolved (which permits, and requires, a precise question).
 */
export function resolveReferences(message, memory = {}, page = {}) {
  const text = normalizeText(message);
  const explicit = findAssetsIn(text);
  const focus = (memory.conversationContext?.focus || []).filter((f) => !f.startsWith('net:') && !f.startsWith('mod:'));
  const fromMemory = memory.lastEntities?.asset || focus[0] || null;
  const fromPage = page.selectedAsset || null;
  const asset = explicit[0] || fromPage || fromMemory || null;
  const networks = findNetworksIn(text);
  const network = networks[0] || page.selectedNetwork || memory.lastEntities?.network || null;
  return {
    asset,
    assetOrigin: explicit[0] ? 'message' : (fromPage ? 'page' : (fromMemory ? 'memory' : null)),
    assetExplicit: Boolean(explicit[0]),
    otherAssets: explicit.slice(1),
    network: network ? String(network).toLowerCase() : null,
    unresolved: !asset,
    focus: (memory.conversationContext?.focus || []).slice(0, 6)
  };
}

/* ── entity extraction ─────────────────────────────────────────────────── */
const ASSET_ALIASES = Object.freeze({
  btc: 'BTC', bitcoin: 'BTC', 'بیت‌کوین': 'BTC', 'بیتکوین': 'BTC',
  eth: 'ETH', ether: 'ETH', ethereum: 'ETH', اتریوم: 'ETH',
  usdc: 'USDC', usdt: 'USDT', usd: 'USD', dai: 'DAI', wbtc: 'WBTC',
  sol: 'SOL', solana: 'SOL', bnb: 'BNB', avax: 'AVAX', matic: 'POL', pol: 'POL',
  arb: 'ARB', op: 'OP', link: 'LINK', steth: 'stETH', cbtc: 'cbBTC', gold: 'XAU', xau: 'XAU'
});
const NETWORK_ALIASES = Object.freeze({
  ethereum: 'ethereum', eth: 'ethereum', mainnet: 'ethereum',
  bsc: 'bsc', 'bnb chain': 'bsc', binance: 'bsc',
  polygon: 'polygon', matic: 'polygon', arbitrum: 'arbitrum', arb: 'arbitrum',
  base: 'base', optimism: 'optimism', op: 'optimism', avalanche: 'avalanche',
  solana: 'solana', arbitrum: 'arbitrum'
});
/** Symbols that are assets AND chains: chain only when the sentence says so. */
const CHAIN_HINT = /(شبکه|به |روی |to |from |chain|network|arbitrum|base|polygon|optimism)/i;

export function usableSymbol(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > 16) return null;
  return /^[A-Za-z0-9$@._-]+$/.test(s) ? s.toUpperCase() : (ASSET_ALIASES[normalizeText(s)] || null);
}

export function findAssetsIn(normalizedText) {
  const out = [];
  const tokens = String(normalizedText).replace(/[^\p{L}\p{N}$@.\s]/gu, ' ').split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    /* «بیت‌کوینمو» = بیت‌کوین + «-م» (mine) + the colloquial «و»; both clitics come off
       so an asset named with a possessive resolves like the English «my BTC». */
    const key = tok.replace(/م$/, '').replace(/م$/, '');
    const sym = ASSET_ALIASES[key] || ASSET_ALIASES[tok] || (/^[A-Z]{2,6}$/.test(tok.toUpperCase()) && (Object.values(ASSET_ALIASES).includes(tok.toUpperCase()) || /^[A-Z]{3,5}$/.test(tok.toUpperCase())) ? tok.toUpperCase() : null);
    if (sym && !out.includes(sym)) out.push(sym);
  }
  return out;
}

export function findNetworksIn(normalizedText) {
  const text = String(normalizedText);
  if (!CHAIN_HINT.test(text)) return [];
  const out = [];
  for (const [alias, net] of Object.entries(NETWORK_ALIASES)) {
    if (new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(text) && !out.includes(net)) out.push(net);
  }
  return out;
}

/** `500 دلار USDC`, `$500 of USDC`, `۰٫۵ اتریوم` — amount + unit + asset, or null. */
/**
 * Asset tokens WITH their position, so an amount can be attached to the asset it
 * was spoken next to. «۰.۱ بیت‌کوین» names a quantity of BTC, and reading only the
 * symbol list loses which number belongs to which asset.
 */
export function findAssetsWithPositions(normalizedText) {
  const text = String(normalizedText);
  const out = [];
  const re = /[^\p{L}\p{N}$@_.-]+/gu;
  let match;
  let index = 0;
  const words = [];
  while ((match = re.exec(text)) !== null) {
    if (match.index > index) words.push({ at: index, text: text.slice(index, match.index) });
    index = match.index + match[0].length;
  }
  if (index < text.length) words.push({ at: index, text: text.slice(index) });
  for (const w of words) {
    /* «پرتفویم», «بیت‌کوینمو», «وامم»: the possessive clitic and the colloquial
       «-و» after it both have to come off, or a Persian possessive would fail to
       resolve while the same sentence in English («my portfolio») resolves. */
    const key = w.text.replace(/م$/, '').replace(/م$/, '');
    const sym = ASSET_ALIASES[key] || ASSET_ALIASES[w.text] || (/^[A-Za-z]{3,5}$/.test(w.text) && Object.values(ASSET_ALIASES).includes(w.text.toUpperCase()) ? w.text.toUpperCase() : null);
    if (sym && !out.some((o) => o.asset === sym)) out.push({ asset: sym, at: w.at, end: w.at + w.text.length });
  }
  return out;
}

/** Numbers with positions plus the Persian fraction words, which ARE amounts. */
function numberPositions(text) {
  const out = [];
  const re = /(\d+(?:[.,]\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ at: m.index, end: re.lastIndex, value: Number(m[1].replace(',', '.')) });
  return out.filter((n) => Number.isFinite(n.value));
}

const FRACTIONS = [
  { re: /نصف|یک دوم|\bhalf\b|50\s?درصد/i, pct: 50 },
  { re: /یک ?سوم|ثالث|\bthird\b/i, pct: 33.333 },
  { re: /دو ?سوم|\btwo thirds?\b/i, pct: 66.667 },
  { re: /ربع|یک ?چهارم|\bquarter\b/i, pct: 25 },
  { re: /(تمام|همه|کل)( ?ی)? (پرتفوی|سبد|موجودی|دارایی)|\b(all|whole|max\.?|full)\b( ?(of )?(it|portfolio))?/i, pct: 100 }
];

export function extractAmounts(text) {
  const s = normalizeText(text);
  const out = { amountUsd: null, amountRaw: null, percent: null, targetUsd: null };
  const money = s.match(/(\d+(?:[.,]\d+)?)\s*(?:usd|دلار\$?|\$)\s*([a-z]{2,6})?/i) || s.match(/\$\s*(\d+(?:[.,]\d+)?)/i);
  if (money) out.amountUsd = usableNumber(String(money[1]).replace(',', '.'));
  const qty = s.match(/(\d+(?:[.,]\d+)?)\s*(btc|eth|usdc|usdt|sol|bnb|dai|avax|link|arb|op|pol)/i)
    || s.match(/\b(btc|eth|usdc|usdt|sol|bnb|dai|avax|link|arb|op|pol)\b.{0,10}?(\d+(?:[.,]\d+)?)/i);
  if (qty) {
    const isPrefix = /\d/.test(qty[1]);
    out.amountRaw = { value: usableNumber(String(isPrefix ? qty[1] : qty[2]).replace(',', '.')), asset: (isPrefix ? qty[2] : qty[1]).toUpperCase() };
  }
  /* A spoken fraction of the book is an amount: «نصف پرتفویم رو بفروش» means 50%
     of what the wallet actually holds, and refusing to parse it would force the
     user to do arithmetic the app is standing right there to do. */
  const frac = FRACTIONS.find((f) => f.re.test(s));
  if (frac) out.sharePct = frac.pct;
  const pctOf = s.match(/(\d+(?:[.,]\d+)?)\s*(?:درصد|٪|%)\s*(?:از)?\s*(پرتفوی|سبد|موجودی|دارایی|portfolio)/i);
  if (pctOf) out.sharePct = usableNumber(Number(pctOf[1].replace(',', '.')));
  const pct = s.match(/(\d+(?:[.,]\d+)?)\s*(?:درصد|٪|%|percent)/i);
  if (pct) out.percent = usableNumber(String(pct[1]).replace(',', '.'));
  const target = s.match(/(?:به|to)\s*(\d{1,3}(?:[,.]\d{3})*)\s*(?:هزار|k|thousand)?\s*(?:دلار|usd|\$)?/i);
  if (target) {
    const raw = Number(String(target[1]).replace(/[,.]/g, ''));
    const scale = /هزار|\bk\b|thousand/i.test(s) ? 1000 : 1;
    if (Number.isFinite(raw) && raw > 0 && /دلار|usd|\$/.test(s)) out.targetUsd = raw * scale;
  }
  return {
    amountUsd: usableNumber(out.amountUsd),
    amountRaw: out.amountRaw && usableNumber(out.amountRaw.value) !== null ? out.amountRaw : null,
    percent: usableNumber(out.percent),
    sharePct: usableNumber(out.sharePct),
    targetUsd: usableNumber(out.targetUsd),
    numbers: numberPositions(s)
  };
}

/** Timeframe in Persian or English, for goals and forecasts. */
export function extractHorizon(text) {
  const s = normalizeText(text);
  const n = (v) => Number(v);
  let m = s.match(/(\d+|یک|دو|سه|چهار|پنج|شش|هفت|ده|پانزده|بیست|سی|چهل|پنجاه)\s*(سال|ساله|year|years)/);
  if (m) { const v = n(m[1]); return { years: Number.isFinite(v) ? v : { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'ده': 10, 'پانزده': 15, 'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50 }[m[1]] || null, months: null }; }
  m = s.match(/(\d+)\s*(ماه|month|months)/);
  if (m) return { years: null, months: n(m[1]) };
  m = s.match(/(\d+)\s*(روز|day|days)/);
  if (m) return { years: null, months: null, days: n(m[1]) };
  return { years: null, months: null };
}

/* ── §5 the assembled context ──────────────────────────────────────────── */
/**
 * Build the per-request context bundle. Everything the Decision Engine (§18)
 * asks is here, and only here — a handler must not reach around it for a
 * "quick" balance read, because that is how two answers to one question appear.
 */
export function buildCentralContext({ message = '', memory, page, state, capabilities, health, entities, followUp, now = Date.now() } = {}) {
  const resolvedPage = page || resolvePage({});
  const mem = memory || emptyMemory();
  const refs = resolveReferences(message, mem, resolvedPage);
  const follow = followUp || detectFollowUp(message, mem, resolvedPage);
  const missing = [];
  const stateSections = state?.sections || {};
  const has = (k) => stateSections[k]?.data != null && stateSections[k].status !== 'UNAVAILABLE';

  /* `missingInformation` is the list of things to ASK THE USER for. A section we
     have not read yet is not the user's job — the brain reads it this turn — so
     wallet/markets deliberately do not appear here; only the one thing a user must
     supply themselves: a connected wallet. Everything else is a note about the data
     the turn ran short on, published under `unReadSections`. */
  const unRead = [];
  if (!has('wallet')) unRead.push('wallet');
  if (!has('markets')) unRead.push('markets');
  if (!has('portfolio')) unRead.push('portfolio');
  if (resolvedPage.walletConnected !== true && !has('wallet')) missing.push('walletConnection');

  return {
    schema: CONTEXT_SCHEMA,
    brain: CI_SCHEMA,
    at: now,
    message: String(message).slice(0, 1200),
    page: resolvedPage,
    module: resolvedPage.module,
    tab: resolvedPage.tab,
    entities: { ...(entities || {}), ...refs },
    followUp: follow,
    memory: {
      lastIntent: mem.lastIntent || null,
      lastAction: mem.lastAction || null,
      lastError: mem.lastError || null,
      pendingConfirmation: mem.pendingConfirmation || null,
      focus: refs.focus
    },
    capabilities: capabilities || null,
    health: health || null,
    stateHas: {
      wallet: has('wallet'), portfolio: has('portfolio'), markets: has('markets'),
      positions: has('positions'), lending: has('lending'), borrowing: has('borrowing'),
      futures: has('futures'), dydx: has('dydx'), goals: has('goals'),
      signals: has('signals'), news: has('news'), transactions: has('transactions'),
      risk: has('risk'), alerts: has('alerts')
    },
    /** §5 rule: only ask when this list is non-empty, and then name these fields. */
    missingInformation: missing,
    unReadSections: unRead,
    contextDigest: hashString([
      resolvedPage.route, resolvedPage.module, resolvedPage.tab, refs.asset, refs.network,
      follow.kind, mem.lastAction?.actionId || '', Object.keys(stateSections).map((k) => `${k}:${stateSections[k]?.revision || 0}`).join(',')
    ].join('|')),
    quality: round(1 - Math.min(1, missing.length / 4), 3)
  };
}

/**
 * A prompt-shaped, secret-free rendering of the context (§35).
 *
 * Rendered as a table of fact-and-source rather than prose, because prose is
 * where a model starts improvising: `wallet.balances → 1.94 ETH (wallet-service,
 * 4s ago)` is re-quotable, "the user seems to have some ETH" is not.
 */
export function contextToPromptDigest(context) {
  const lines = [];
  lines.push(`page=${context.page.route} module=${context.page.module} tab=${context.page.tab || '-'}`);
  lines.push(`reference: asset=${context.entities.asset || 'UNRESOLVED'} (${context.entities.assetOrigin || 'none'}) network=${context.entities.network || '-'} followUp=${context.followUp.kind}`);
  lines.push(`memory: lastAction=${context.memory.lastAction?.type || '-'} pending=${context.memory.pendingConfirmation?.actionId || '-'} lastError=${context.memory.lastError?.code || '-'}`);
  const cap = context.capabilities;
  if (cap) lines.push(`capabilities: ${Object.entries(cap).slice(0, 16).map(([k, v]) => `${k}=${typeof v === 'string' ? v : v?.status || v?.capability || '?'}`).join(' ')}`);
  if (context.missingInformation.length) lines.push(`missing: ${context.missingInformation.join(',')}`);
  return lines.join('\n');
}
