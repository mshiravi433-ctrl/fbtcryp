/**
 * FBT NATIVE AGENTS — the data bench.
 * ---------------------------------------------------------------------------
 * A native agent is a first-party FBT agent: it runs inside this deployment,
 * on public data this repository already uses elsewhere, and it needs no
 * account, no OAuth and no third-party agent host.
 *
 * The point of this file is that it does NOT add a data source. Every reader
 * here delegates to a module the app already ships and already audits:
 *
 *   prices / candles     server/providers.js      (CoinGecko; native detail is single-shot, no CoinLore fallback)
 *   yields               server/yields.js         (DefiLlama, safety-filtered)
 *   protocols / hacks    server/explorerData.js   (DefiLlama)
 *   token security       server/tokenRisk.js      (GoPlus, keyless)
 *   token / wallet intel server/smartMoney        (DexScreener, Blockscout, EVM/Solana RPC, explorer and price sources)
 *   bridge intent        local parser only; LI.FI is reached by Bridge/Swap after separate UI consent
 *
 * Two rules make a native agent honest instead of impressive:
 *
 *   1. A DEADLINE IS A RESULT. Every read is raced against a short deadline.
 *      The loser is reported as `DATA_TIMEOUT`; it is never quietly replaced by
 *      a remembered or a plausible value. A section that could not read says so.
 *   2. THE MARKET CALL IS READ-ONLY. Nothing here can build a transaction,
 *      sign anything, move a balance or start a paid invocation. The bridge
 *      assistant returns an ESTIMATE for a human to read; it does not return
 *      calldata to execute.
 *
 * Everything is injectable (`createDataAccess({ overrides })`) so the tests run
 * deterministic, offline and fast.
 */

export const NATIVE_DATA_SCHEMA = 'fbt.agent-hub.native-data.v1';

/** Per-read budget. Four reads run in parallel, so this is the agent's worst case. */
export const READ_DEADLINE_MS = 14_000;
export const BACKTEST_DEADLINE_MS = 25_000;

/* Chain names as people type them. Only chains the app can read today. */
export const CHAINS = Object.freeze({
  ethereum: 1, eth: 1, mainnet: 1, erc20: 1,
  bsc: 56, bnb: 56, binance: 56,
  polygon: 137, matic: 137,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  base: 8453,
  avalanche: 43114, avax: 43114,
  linea: 59144,
  sonic: 146,
  mantle: 5000,
  berachain: 80094,
  unichain: 130,
  monad: 143,
  scroll: 534352,
  zksync: 324,
  robinhood: 4663,
  solana: 'solana', sol: 'solana'
});

export const CHAIN_LABELS = Object.freeze({
  1: 'Ethereum', 56: 'BNB Chain', 137: 'Polygon', 42161: 'Arbitrum', 10: 'Optimism',
  8453: 'Base', 43114: 'Avalanche', 59144: 'Linea', 146: 'Sonic', 5000: 'Mantle',
  80094: 'Berachain', 130: 'Unichain', 143: 'Monad', 534352: 'Scroll', 324: 'zkSync Era',
  4663: 'Robinhood', solana: 'Solana'
});

export const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/;
export const SOLANA_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const EVM_ONLY_RE = /^0x[a-fA-F0-9]{40}$/;

/* ───────────────────────── Persian input, same agents ─────────────────────
 * Before this file grew the tables below, a Persian request reached the same
 * eleven agents and died at the first step: `extractRequest('اتریوم را تحلیل
 * کن')` found no symbol, so every agent answered «ورودی لازم است» — which a
 * user reads as "the agent is broken / the provider connection is incomplete"
 * even though the run had completed. The agents were fine; the reader was
 * Latin-only.
 *
 * Three normalisations happen before any parsing, and none of them touches the
 * text the user sees or the text that is sent:
 *
 *   ۱. Persian (۰-۹) and Arabic-Indic (٠-٩) digits become ASCII. «۱۰۰ USDC»
 *      is an amount, not an unknown token.
 *   ۲. Arabic letter variants (ي، ك، ة) become their Persian forms (ی، ک، ه),
 *      because keyboards emit both for the same word.
 *   ۳. A zero-width non-joiner becomes a space, so «بیت‌کوین» and «بیت کوین»
 *      match the same alias. A second alias table covers the no-space spelling.
 *
 * Coin, chain and protocol aliases are DATA, not code branches: the agent logic
 * is unchanged, and an alias can only ever resolve to a name the app already
 * knew how to look up. An alias that is not in the table still produces the
 * same honest «ورودی لازم است», never a guessed coin.
 */

/** Persian/Arabic → English names people actually type for major assets. */
export const PERSIAN_COIN_ALIASES = Object.freeze({
  'بیت کوین': 'BTC', 'بیتکوین': 'BTC', 'بیت‌کوین': 'BTC', 'بيتكوين': 'BTC',
  'اتریوم': 'ETH', 'اتريوم': 'ETH', 'ای‌تی‌اچ': 'ETH', 'اتر': 'ETH',
  'تتر': 'USDT', 'یو اس دی تی': 'USDT',
  'یو اس دی کوین': 'USDC', 'یواسدی‌سی': 'USDC',
  'سولانا': 'SOL', 'سول': 'SOL',
  'بایننس کوین': 'BNB', 'بی ان بی': 'BNB',
  'ریپل': 'XRP', 'کاردانو': 'ADA', 'دوج کوین': 'DOGE', 'دوجکوین': 'DOGE', 'دوج': 'DOGE',
  'ترون': 'TRX', 'پالیگان': 'MATIC', 'پلیگان': 'MATIC', 'ماتیک': 'MATIC',
  'آوالانچ': 'AVAX', 'اولانچ': 'AVAX',
  'پولکادات': 'DOT', 'چین لینک': 'LINK', 'چین‌لینک': 'LINK',
  'یونی سواپ': 'UNI', 'یونی‌سواپ': 'UNI', 'شیبا': 'SHIB', 'شیبا اینو': 'SHIB',
  'لایت کوین': 'LTC', 'لایتکوین': 'LTC', 'بیت کوین کش': 'BCH',
  'کازموس': 'ATOM', 'کاسما': 'ATOM', 'نیر': 'NEAR', 'نِیر': 'NEAR',
  'اپتوس': 'APT', 'آپتوس': 'APT', 'سوی': 'SUI', 'آربیتروم': 'ARB',
  'آپتیمیزم': 'OP', 'اپتیمیزم': 'OP', 'پپه': 'PEPE', 'تون': 'TON',
  'دای': 'DAI', 'دای استیبل': 'DAI', 'لیدو': 'LDO', 'آوه': 'AAVE', 'آوی': 'AAVE',
  'میکر': 'MKR', 'کرو': 'CRV', 'کروم': 'CRV', 'فایل کوین': 'FIL'
});

/** Persian spellings of the chains this app can already read. */
export const PERSIAN_CHAIN_ALIASES = Object.freeze({
  'اتریوم': 1, 'اتريوم': 1, 'شبکه اتریوم': 1,
  'بی ان بی': 56, 'بایننس': 56, 'بی اس سی': 56,
  'پالیگان': 137, 'پلیگان': 137, 'ماتیک': 137,
  'آربیتروم': 42161, 'اربیتروم': 42161,
  'آپتیمیزم': 10, 'اپتیمیزم': 10,
  'بیس': 8453, 'بیز': 8453,
  'آوالانچ': 43114, 'اولانچ': 43114,
  'لاینیا': 59144, 'سونیک': 146, 'مانتل': 5000, 'براچین': 80094,
  'یونی چین': 130, 'یونی‌چین': 130, 'موناد': 143, 'اسکرول': 534352,
  'زیکی‌سینک': 324, 'سولانا': 'solana'
});

/** Persian names of protocols FBT already reviews, mapped to their slug stem. */
export const PERSIAN_PROTOCOL_ALIASES = Object.freeze({
  'آوه': 'aave', 'آوی': 'aave', 'کامپاند': 'compound', 'کامپاوند': 'compound',
  'مورفو': 'morpho', 'ونوس': 'venus', 'اسپارک': 'spark', 'کروم': 'curve', 'کرو': 'curve',
  'یونی سواپ': 'uniswap', 'یونی‌سواپ': 'uniswap', 'لیدو': 'lido', 'پندل': 'pendle',
  'بیفی': 'beefy', 'میکر': 'maker', 'دای': 'maker', 'بلنسر': 'balancer',
  'جی ام ایکس': 'gmx', 'هایپردلیکوید': 'hyperliquid', 'هایپرلیکوید': 'hyperliquid',
  'استارگیت': 'stargate', 'آکالا': 'acala', 'کامینو': 'kamino'
});

const ARABIC_TO_PERSIAN = { 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ى': 'ی', 'ۀ': 'ه' };

/**
 * Normalise digits, Arabic letter variants and ZWNJ — for PARSING only.
 * The original string is still what is stored, quoted back and sent.
 */
export function normalizeInputText(value = '') {
  return String(value ?? '')
    /* ۰-۹ (U+06F0..U+06F9) */
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    /* ٠-٩ (U+0660..U+0669) */
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u064A\u0643\u0629\u0649\u06C0]/g, (c) => ARABIC_TO_PERSIAN[c] || c)
    /* A half-space is a word separator for matching, never for display. */
    .replace(/[\u200C\u200D]/g, ' ')
    .replace(/\s{2,}/g, ' ');
}

const PERSIAN_LETTER = '\\u0600-\\u06FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const aliasBoundary = (alias) => new RegExp(
  `(^|[^A-Za-z0-9${PERSIAN_LETTER}])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9${PERSIAN_LETTER}])`,
  'i'
);

/** Every Persian alias found in the text, in the order it appears. */
function persianAliases(text, table) {
  const out = [];
  const source = String(text || '');
  for (const [alias, value] of Object.entries(table)) {
    const re = aliasBoundary(alias);
    const match = re.exec(source);
    if (match) out.push({ alias, value, at: match.index + String(match[1] || '').length });
  }
  return out.sort((a, b) => a.at - b.at || b.alias.length - a.alias.length);
}

/** Chains GoPlus publishes a token-security report for (mirrors tokenRisk.js). */
export const GOPLUS_CHAINS = new Set([1, 56, 137, 42161, 10, 8453, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663]);

/** A quote pair has to name two different chains; same-chain is a swap, not a bridge. */
const BRIDGE_CHAINS = new Set([1, 56, 137, 42161, 10, 8453, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663, 'solana']);

/**
 * Chains named in the text, in the ORDER THEY APPEAR.
 *
 * Order is the contract, not a detail: the cross-chain agent treats the first
 * chain as the source and the second as the destination. The old version sorted
 * by alias length, which was correct by accident for half the sentences — for
 * «۱۰۰ USDC از آربیتروم به بیس» a length sort still happens to work, but for
 * «از بیس به آربیتروم» it silently inverted the route. Position cannot invert.
 */
export function chainFromText(text = '') {
  const source = normalizeInputText(text);
  const found = [];
  for (const [alias, id] of Object.entries(CHAINS)) {
    /* Word-ish boundary: `op` must not match inside "optimism" twice, `sol`
       must not match "solution", and a Latin alias must not match inside a
       Persian word. */
    const match = aliasBoundary(alias).exec(source);
    if (match) found.push({ alias, id, at: match.index + String(match[1] || '').length });
  }
  for (const row of persianAliases(source, PERSIAN_CHAIN_ALIASES)) {
    found.push({ alias: row.alias, id: row.value, at: row.at });
  }
  found.sort((a, b) => a.at - b.at || b.alias.length - a.alias.length);
  const unique = [];
  for (const row of found) if (!unique.some((u) => String(u.id) === String(row.id))) unique.push(row);
  return unique.map((u) => u.id);
}

export function isEvmAddress(value) {
  return EVM_ONLY_RE.test(String(value || '').trim());
}

export function isSolanaAddress(value) {
  const v = String(value || '').trim();
  return !EVM_ONLY_RE.test(v) && v.length >= 32 && v.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(v);
}

/**
 * What the user actually asked for, extracted once and shared by every agent.
 *
 * This is deliberately shallow: an address is an address, a `$SYMBOL` is a
 * symbol, a chain is a known chain name. It never guesses that "cake" means
 * PancakeSwap or that "a lot" means an amount. An agent that cannot find its
 * input says so instead of inventing one.
 */
export function extractRequest(text = '') {
  const source = String(text || '');
  /* Parsing copy — digits/letters/ZWNJ normalised. `raw` and `text` stay the
     user's own sentence: it is what the panel shows and what the task stores. */
  const normalized = normalizeInputText(source);
  const evm = normalized.match(EVM_ADDRESS_RE)?.[0] || null;
  const solanaRaw = evm ? null : normalized.match(SOLANA_ADDRESS_RE)?.[0] || null;
  const solana = solanaRaw && isSolanaAddress(solanaRaw) ? solanaRaw : null;
  const chains = chainFromText(normalized);

  /* Persian coin names first: «قیمت بیت کوین» has no $ sign, no amount and no
     Latin uppercase word, so without this table it reached every agent as an
     empty request. The alias maps to a symbol the resolver then checks against
     the real search endpoint — an alias never asserts that a coin exists. */
  const persianCoins = persianAliases(normalized, PERSIAN_COIN_ALIASES)
    .map((row) => String(row.value).toUpperCase());

  const dollar = normalized.match(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/)?.[1] || null;
  const amountMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*([A-Za-z][A-Za-z0-9]{1,9})\b/);
  const upper = [...normalized.matchAll(/\b([A-Z][A-Z0-9]{1,9})\b/g)].map((m) => m[1]);
  const stop = new Set([
    'AI', 'FBT', 'USD', 'THE', 'AND', 'FOR', 'DEFI', 'APY', 'APR', 'TVL', 'DEX', 'CEX',
    'LP', 'NFT', 'A', 'I', 'ON', 'TO', 'FROM', 'SMA', 'DCA', 'RSI', 'MACD', 'UNKNOWN',
    'WHAT', 'HOW', 'IS', 'ARE', 'OF', 'IN', 'AT', 'BY', 'OR', 'MY', 'ME', 'ALL', 'ANY'
  ]);
  /* An uppercase word is only a CANDIDATE. "Backtest SMA on ETH" has two, and
     only one of them is a coin. The resolver tries them in order against the
     real search endpoint instead of trusting the first capitalised word. */
  const candidates = [];
  candidates.push(...persianCoins);
  if (dollar) candidates.push(dollar);
  if (amountMatch) candidates.push(amountMatch[2]);
  for (const word of upper) candidates.push(word);
  const seen = new Set();
  const symbolCandidates = candidates
    .map((c) => String(c || '').toUpperCase())
    .filter((c) => c.length >= 2 && c.length <= 12)
    .filter((c) => !stop.has(c))
    .filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    })
    .slice(0, 6);
  const symbol = symbolCandidates[0] || null;

  /* English «protocol X» and the Persian equivalents (`پروتکل آوه`, `آوه`). */
  const protocolEn = normalized.match(/(?:protocol|پروتکل)\s+([A-Za-z][A-Za-z0-9 ._-]{1,30})/i)?.[1]?.trim() || null;
  const protocolFa = persianAliases(normalized, PERSIAN_PROTOCOL_ALIASES)[0]?.value || null;
  const protocol = protocolEn || protocolFa;

  const AMOUNT_STOP = new Set(['ON', 'IN', 'AT', 'TO', 'FROM', 'PER', 'FOR', 'AND', 'OF', 'WITH', 'BY', 'THE', 'A', 'AN']);
  const rawAmountText = amountMatch ? amountMatch[1].replace(/,/g, '') : null;
  const rawAmount = rawAmountText == null ? null : Number(rawAmountText);
  const rawAmountToken = amountMatch ? amountMatch[2] : null;
  const amountUsable = amountMatch && !AMOUNT_STOP.has(String(rawAmountToken).toUpperCase());
  const amount = amountUsable && Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null;
  const amountText = amount != null ? rawAmountText : null;
  const amountToken = amountUsable ? rawAmountToken : null;

  const pair = normalized.match(/\b([A-Za-z0-9]{2,10})\s*(?:\/|-)\s*([A-Za-z0-9]{2,10})\b/);
  return {
    raw: source,
    text: source.trim(),
    normalized,
    evmAddress: evm,
    solanaAddress: solana,
    address: evm || solana || null,
    chains,
    chainId: chains[0] || (solana ? 'solana' : null),
    symbol: symbol ? String(symbol).toUpperCase() : null,
    symbolCandidates,
    protocolQuery: protocol,
    amount,
    amountText,
    amountToken: amountToken ? amountToken.toUpperCase() : null,
    pair: pair ? [pair[1].toUpperCase(), pair[2].toUpperCase()] : null
  };
}

/**
 * The canonical CoinGecko id for symbols everybody means by that symbol.
 *
 * Major symbols resolve locally from a canonical ID map; unknown assets use a
 * short, single-shot CoinGecko search. The actual price/history read still
 * verifies every ID, so the map never supplies a price or a plausible result.
 * This avoids spending the whole task deadline repeatedly searching arbitrary
 * capitalized words from a prompt when CoinGecko is slow or filtered.
 *
 * The table is only a NAME MAP: it says which id the symbol conventionally
 * means. It never contains a price, and the agent still reads live data and
 * reports which source actually answered. If the id is wrong, the read fails
 * and the result says so — nothing is invented.
 */
export const COIN_IDS = Object.freeze({
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin', DAI: 'dai',
  BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin',
  TRX: 'tron', TON: 'the-open-network', AVAX: 'avalanche-2', DOT: 'polkadot',
  LINK: 'chainlink', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
  UNI: 'uniswap', SHIB: 'shiba-inu', LTC: 'litecoin', BCH: 'bitcoin-cash',
  ATOM: 'cosmos', NEAR: 'near', APT: 'aptos', SUI: 'sui', ARB: 'arbitrum',
  OP: 'optimism', PEPE: 'pepe', AAVE: 'aave', MKR: 'maker', CRV: 'curve-dao-token',
  LDO: 'lido-dao', FIL: 'filecoin', STETH: 'staked-ether', WBTC: 'wrapped-bitcoin',
  HBAR: 'hedera-hashgraph', ICP: 'internet-computer', ETC: 'ethereum-classic',
  XLM: 'stellar', ALGO: 'algorand', VET: 'vechain', INJ: 'injective-protocol',
  TIA: 'celestia', SEI: 'sei-network', JUP: 'jupiter-exchange-solana',
  RENDER: 'render-token', WIF: 'dogwifcoin', BONK: 'bonk'
});

/** Resolve the request's symbol/address to a CoinGecko coin, or report why not. */
export async function resolveCoin(data, request) {
  const candidates = [
    ...(Array.isArray(request.symbolCandidates) ? request.symbolCandidates : []),
    request.symbol,
    request.amountToken
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)].slice(0, 6);
  /* Major symbols already have a canonical id. Resolve those locally first:
     the live price/history read still verifies that id, while avoiding an
     unnecessary search request (and needless disclosure of the prompt text). */
  for (const query of uniqueCandidates) {
    const id = COIN_IDS[String(query).toUpperCase()];
    if (id) {
      return {
        ok: true,
        query,
        resolvedWithoutSearch: true,
        coin: { id, symbol: String(query).toUpperCase(), name: String(query).toUpperCase() }
      };
    }
  }
  /* Unknown assets use a bounded, single-shot search. Trying every capitalised
     word in a prompt multiplies latency and discloses irrelevant text. */
  for (const query of uniqueCandidates.slice(0, 2)) {
    try {
      const rows = await data.searchCoins(query);
      const exact = Array.isArray(rows)
        ? rows.find((row) => String(row.symbol || '').toUpperCase() === query.toUpperCase())
          || rows.find((row) => String(row.name || '').toLowerCase() === query.toLowerCase())
        : null;
      if (exact?.id) return { ok: true, query, coin: exact };
    } catch {
      /* A blocked search is reported below; never invent a replacement id. */
    }
  }
  return { ok: false, code: 'COIN_NOT_RESOLVED', query: request.symbol || request.amountToken || null };
}

/**
 * Race one read against a deadline.
 * Returns `{ ok:true, value }` or `{ ok:false, code, detail? }` — never throws.
 */
export async function withDeadline(promise, { ms = READ_DEADLINE_MS, code = 'DATA_TIMEOUT' } = {}) {
  let timer;
  const gate = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true }), Math.max(250, Number(ms) || READ_DEADLINE_MS));
  });
  try {
    const settled = await Promise.race([
      Promise.resolve(promise).then((value) => ({ value })).catch((error) => ({ __error: error })),
      gate
    ]);
    if (settled && settled.__timedOut) return { ok: false, code };
    if (settled && settled.__error) {
      const message = String(settled.__error?.message || settled.__error || '');
      return { ok: false, code: 'DATA_UNAVAILABLE', detail: message.slice(0, 140) };
    }
    return { ok: true, value: settled?.value ?? null };
  } finally {
    clearTimeout(timer);
  }
}

const lazy = (loader) => {
  let cached;
  return () => (cached ||= loader());
};

/**
 * The live data access object.
 *
 * `overrides` exists for tests: every agent receives this object, so a test can
 * hand it three deterministic readers and assert the exact analysis without a
 * network call. Production passes nothing.
 */
export function createDataAccess(overrides = {}, {
  providerLoader = null,
  yieldsLoader = null,
  explorerLoader = null,
  smartMoneyLoader = null
} = {}) {
  const providers = lazy(() => providerLoader ? providerLoader() : import('../providers.js'));
  const yields = lazy(() => yieldsLoader ? yieldsLoader() : import('../yields.js'));
  const explorer = lazy(() => explorerLoader ? explorerLoader() : import('../explorerData.js'));
  const tokenRisk = lazy(() => import('../tokenRisk.js'));
  const smartMoney = lazy(() => smartMoneyLoader ? smartMoneyLoader() : import('../smartMoney/index.js'));

  const api = {
    /* ── market ── */
    async searchCoins(query) {
      const mod = await providers();
      return mod.fetchSearch(String(query || '').slice(0, 60), {
        timeoutMs: Math.min(5_000, READ_DEADLINE_MS),
        retry: false
      });
    },
    async coinDetail(id, { timeoutMs = 9_000 } = {}) {
      const mod = await providers();
      return mod.fetchCoinDetail(id, 'usd', {
        timeoutMs: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || 9_000)),
        retry: false,
        allowCoinLoreFallback: false
      });
    },
    async candles(id, days = 180, { timeoutMs = READ_DEADLINE_MS } = {}) {
      const budgetMs = Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || READ_DEADLINE_MS));
      const deadlineAt = Date.now() + budgetMs;
      const boundedDays = Math.min(365, Math.max(1, Number(days) || 180));
      const mod = await providers();
      let primary = [];
      let primaryError = null;
      try {
        /* One bounded OHLC attempt. Leave time in this same 14s read budget
           for the close-history fallback instead of spending it on retries. */
        const timeoutMs = Math.max(250, Math.min(8_000, deadlineAt - Date.now()));
        primary = await mod.fetchOhlc(id, boundedDays, 'usd', { timeoutMs, retry: false });
        if (Array.isArray(primary) && (boundedDays < 300 || primary.length >= 70)) return primary;
      } catch (error) {
        primaryError = error;
      }

      const remainingMs = deadlineAt - Date.now();
      if (remainingMs >= 250 && typeof mod.fetchDailyCloses === 'function') {
        try {
          const closes = await mod.fetchDailyCloses(id, boundedDays, 'usd', { timeoutMs: remainingMs });
          if (Array.isArray(closes) && closes.length) return closes;
        } catch (error) {
          if (!primaryError) primaryError = error;
        }
      }
      if (Array.isArray(primary) && primary.length) return primary;
      if (primaryError) throw primaryError;
      return [];
    },
    async markets({ perPage = 20 } = {}) {
      const mod = await providers();
      return mod.fetchMarkets({ perPage: Math.min(100, Math.max(1, Number(perPage) || 20)) });
    },

    /* ── DeFi ── */
    async yields({ timeoutMs = READ_DEADLINE_MS } = {}) {
      const mod = await yields();
      return mod.fetchYields({
        timeoutMs: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || READ_DEADLINE_MS))
      });
    },
    async protocols({ timeoutMs = 8_500 } = {}) {
      const mod = await explorer();
      const out = await mod.llamaProtocols({ timeout: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || 8_500)) });
      return out?.data?.protocols || [];
    },
    async protocolDetail(slug, { timeoutMs = 12_000 } = {}) {
      const mod = await explorer();
      const out = await mod.protocolDetail(slug, { timeout: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || 12_000)) });
      return out?.data || null;
    },
    async incidents({ timeoutMs = 8_500 } = {}) {
      const mod = await explorer();
      const out = await mod.hacksIndex({ timeout: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || 8_500)) });
      return out?.data?.incidents || [];
    },

    /* ── security / intel ── */
    async tokenRisk(chainId, address) {
      const mod = await tokenRisk();
      return mod.fetchTokenRisk(chainId, address);
    },
    async tokenIntel(address, chainId = 1, { timeoutMs = READ_DEADLINE_MS } = {}) {
      const mod = await smartMoney();
      return mod.analyzeToken(address, chainId, {
        timeoutMs: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || READ_DEADLINE_MS))
      });
    },
    async topTraders(address, chainId = 1, window = '24h') {
      const mod = await smartMoney();
      return mod.topTraders(address, chainId, window);
    },
    async walletIntel(address, chainHint = null, { timeoutMs = 12_000 } = {}) {
      const mod = await smartMoney();
      return mod.analyzeWallet(address, chainHint, {
        timeoutMs: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || 12_000))
      });
    },
    async smartMoneyOverview(window = '24h', { timeoutMs = 8_000 } = {}) {
      const mod = await smartMoney();
      return mod.getOverview({
        window,
        timeoutMs: Math.max(250, Math.min(READ_DEADLINE_MS, Number(timeoutMs) || 8_000))
      });
    },


    schema: NATIVE_DATA_SCHEMA
  };
  return { ...api, ...overrides };
}
