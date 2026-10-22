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
 *   prices / candles     server/providers.js      (CoinGecko + CoinLore backup)
 *   yields               server/yields.js         (DefiLlama, safety-filtered)
 *   protocols / hacks    server/explorerData.js   (DefiLlama)
 *   token security       server/tokenRisk.js      (GoPlus, keyless)
 *   token / wallet intel server/smartMoney        (DexScreener + Blockscout)
 *   bridge routes        server/lifi.js           (LI.FI quote, read-only)
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
export const READ_DEADLINE_MS = 9_000;

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

/** Chains GoPlus publishes a token-security report for (mirrors tokenRisk.js). */
export const GOPLUS_CHAINS = new Set([1, 56, 137, 42161, 10, 8453, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663]);

/** A quote pair has to name two different chains; same-chain is a swap, not a bridge. */
const BRIDGE_CHAINS = new Set([1, 56, 137, 42161, 10, 8453, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663, 'solana']);

export function chainFromText(text = '') {
  const source = String(text || '').toLowerCase();
  const found = [];
  for (const [alias, id] of Object.entries(CHAINS)) {
    /* Word-ish boundary: `op` must not match inside "optimism" twice, and `sol`
       must not match "solution". Longest aliases are checked first below. */
    const re = new RegExp(`(^|[^a-z0-9])${alias}($|[^a-z0-9])`, 'i');
    if (re.test(source)) found.push({ alias, id });
  }
  found.sort((a, b) => b.alias.length - a.alias.length);
  const unique = [];
  for (const row of found) if (!unique.some((u) => u.id === row.id)) unique.push(row);
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
  const evm = source.match(EVM_ADDRESS_RE)?.[0] || null;
  const solanaRaw = evm ? null : source.match(SOLANA_ADDRESS_RE)?.[0] || null;
  const solana = solanaRaw && isSolanaAddress(solanaRaw) ? solanaRaw : null;
  const chains = chainFromText(source);

  const dollar = source.match(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/)?.[1] || null;
  const amountMatch = source.match(/(\d+(?:[.,]\d+)?)\s*([A-Za-z][A-Za-z0-9]{1,9})\b/);
  const upper = [...source.matchAll(/\b([A-Z][A-Z0-9]{1,9})\b/g)].map((m) => m[1]);
  const stop = new Set([
    'AI', 'FBT', 'USD', 'THE', 'AND', 'FOR', 'DEFI', 'APY', 'APR', 'TVL', 'DEX', 'CEX',
    'LP', 'NFT', 'A', 'I', 'ON', 'TO', 'FROM', 'SMA', 'DCA', 'RSI', 'MACD', 'UNKNOWN',
    'WHAT', 'HOW', 'IS', 'ARE', 'OF', 'IN', 'AT', 'BY', 'OR', 'MY', 'ME', 'ALL', 'ANY'
  ]);
  /* An uppercase word is only a CANDIDATE. "Backtest SMA on ETH" has two, and
     only one of them is a coin. The resolver tries them in order against the
     real search endpoint instead of trusting the first capitalised word. */
  const candidates = [];
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

  const protocol = source.match(/(?:protocol|پروتکل)\s+([A-Za-z][A-Za-z0-9 ._-]{1,30})/i)?.[1]?.trim() || null;

  const AMOUNT_STOP = new Set(['ON', 'IN', 'AT', 'TO', 'FROM', 'PER', 'FOR', 'AND', 'OF', 'WITH', 'BY', 'THE', 'A', 'AN']);
  const rawAmount = amountMatch ? Number(amountMatch[1].replace(',', '')) : null;
  const rawAmountToken = amountMatch ? amountMatch[2] : null;
  const amountUsable = amountMatch && !AMOUNT_STOP.has(String(rawAmountToken).toUpperCase());
  const amount = amountUsable && Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null;
  const amountToken = amountUsable ? rawAmountToken : null;

  const pair = source.match(/\b([A-Za-z0-9]{2,10})\s*(?:\/|-)\s*([A-Za-z0-9]{2,10})\b/);
  return {
    raw: source,
    text: source.trim(),
    evmAddress: evm,
    solanaAddress: solana,
    address: evm || solana || null,
    chains,
    chainId: chains[0] || (solana ? 'solana' : null),
    symbol: symbol ? String(symbol).toUpperCase() : null,
    symbolCandidates,
    protocolQuery: protocol,
    amount,
    amountToken: amountToken ? amountToken.toUpperCase() : null,
    pair: pair ? [pair[1].toUpperCase(), pair[2].toUpperCase()] : null
  };
}

/** Resolve the request's symbol/address to a CoinGecko coin, or report why not. */
export async function resolveCoin(data, request) {
  const candidates = [
    ...(Array.isArray(request.symbolCandidates) ? request.symbolCandidates : []),
    request.symbol,
    request.amountToken
  ].filter(Boolean);
  for (const query of [...new Set(candidates)].slice(0, 6)) {
    try {
      const rows = await data.searchCoins(query);
      const exact = Array.isArray(rows)
        ? rows.find((row) => String(row.symbol || '').toUpperCase() === query.toUpperCase())
          || rows.find((row) => String(row.name || '').toLowerCase() === query.toLowerCase())
        : null;
      if (exact?.id) return { ok: true, query, coin: exact };
    } catch {
      /* One failed search is not a resolution failure yet; try the next form. */
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
export function createDataAccess(overrides = {}) {
  const providers = lazy(() => import('../providers.js'));
  const yields = lazy(() => import('../yields.js'));
  const explorer = lazy(() => import('../explorerData.js'));
  const tokenRisk = lazy(() => import('../tokenRisk.js'));
  const smartMoney = lazy(() => import('../smartMoney/index.js'));
  const lifi = lazy(() => import('../lifi.js'));

  const api = {
    /* ── market ── */
    async searchCoins(query) {
      const mod = await providers();
      return mod.fetchSearch(String(query || '').slice(0, 60));
    },
    async coinDetail(id) {
      const mod = await providers();
      return mod.fetchCoinDetail(id);
    },
    async candles(id, days = 180) {
      const mod = await providers();
      return mod.fetchOhlc(id, Math.min(365, Math.max(1, Number(days) || 180)));
    },
    async markets({ perPage = 20 } = {}) {
      const mod = await providers();
      return mod.fetchMarkets({ perPage: Math.min(100, Math.max(1, Number(perPage) || 20)) });
    },

    /* ── DeFi ── */
    async yields() {
      const mod = await yields();
      return mod.fetchYields();
    },
    async protocols() {
      const mod = await explorer();
      const out = await mod.llamaProtocols();
      return out?.data?.protocols || [];
    },
    async protocolDetail(slug) {
      const mod = await explorer();
      const out = await mod.protocolDetail(slug);
      return out?.data || null;
    },
    async incidents() {
      const mod = await explorer();
      const out = await mod.hacksIndex();
      return out?.data?.incidents || [];
    },

    /* ── security / intel ── */
    async tokenRisk(chainId, address) {
      const mod = await tokenRisk();
      return mod.fetchTokenRisk(chainId, address);
    },
    async tokenIntel(address, chainId = 1) {
      const mod = await smartMoney();
      return mod.analyzeToken(address, chainId);
    },
    async topTraders(address, chainId = 1, window = '24h') {
      const mod = await smartMoney();
      return mod.topTraders(address, chainId, window);
    },
    async walletIntel(address, chainHint = null) {
      const mod = await smartMoney();
      return mod.analyzeWallet(address, chainHint);
    },
    async smartMoneyOverview(window = '24h') {
      const mod = await smartMoney();
      return mod.getOverview({ window });
    },

    /* ── bridge estimate (read-only) ── */
    async tokenInfo(chainId, token) {
      const mod = await lifi();
      const query = new URLSearchParams({ chain: String(chainId), token: String(token) });
      const res = await mod.lifiFetch(`/token?${query.toString()}`, { timeoutMs: 6_000 });
      return res.ok ? res.body || null : null;
    },
    async bridgeQuote(params) {
      const mod = await lifi();
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) {
        if (value === null || value === undefined || value === '') continue;
        query.set(key, String(value));
      }
      /* The low-level reader, NOT `lifiSwapQuote`: that one builds an executable,
         fee-bearing swap for the app's own flow. An agent answers a question;
         it must not mint a transaction request. */
      const res = await mod.lifiFetch(`/quote?${query.toString()}`, { timeoutMs: READ_DEADLINE_MS });
      return res;
    },

    schema: NATIVE_DATA_SCHEMA
  };
  return { ...api, ...overrides };
}
