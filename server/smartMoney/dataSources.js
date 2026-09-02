/**
 * SMART MONEY — DATA SOURCES LAYER
 * ---------------------------------------------------------------------------
 * One place owns every external call the intelligence layer makes. Each
 * source is:
 *
 *   · REAL — DexScreener (DEX pairs, liquidity, volume, holders-proxy),
 *     Blockscout (keyless EVM address/contract history: transactions, token
 *     transfers, balances, counterparty tags, first-seen age), public chain
 *     RPC (logs/blocks), Etherscan-family explorers when an API key exists,
 *     Solana public RPC + Solscan when keyed.
 *   · FAIL-CLOSED — an unavailable source returns `{ dataStatus:'unavailable' }`
 *     or null. Callers then report the metric as unavailable rather than
 *     inventing a number. This mirrors server/solanaIntel.js exactly.
 *   · OVERRIDABLE — `__setFetchForTests(fn)` injects a fetch so the probe
 *     suite asserts extraction without spending a single upstream request.
 *
 * Prices never get a second source: we reuse providers.fetchSimplePrices so
 * the CoinGecko key and its rate limit stay owned in one place.
 */

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 10_000);

let fetchImpl = (url, opts) => globalThis.fetch(url, opts);

/** Test seam. Pass null to restore the global fetch. */
export function __setFetchForTests(fn) {
  fetchImpl = fn || ((url, opts) => globalThis.fetch(url, opts));
}

function ctrlTimeout(ms = TIMEOUT_MS) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function getJson(url, { headers = {}, timeout = TIMEOUT_MS } = {}) {
  const { signal, done } = ctrlTimeout(timeout);
  try {
    const res = await fetchImpl(url, { signal, headers: { accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    done();
  }
}

/* ════════════════════════════ DexScreener ══════════════════════════════ */
/*
 * Free, keyless, rate-limited to ~300 req/min. Returns real pairs with
 * liquidity (usd), 24h volume, price change, pair-created age, dex id and
 * chain. This is the spine of token intelligence, early-token detection and
 * liquidity movement — all derived from observed pairs, never invented.
 */

const DEX_BASE = 'https://api.dexscreener.com';

function shapePair(p) {
  if (!p || typeof p !== 'object') return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const liquidityUsd = num(p.liquidity?.usd);
  const volumeH24 = num(p.volume?.h24);
  const fdv = num(p.fdv);
  const marketCap = num(p.marketCap);
  const pairCreatedAt = num(p.pairCreatedAt);
  const ageMs = pairCreatedAt ? Date.now() - pairCreatedAt : null;
  return {
    pairAddress: String(p.pairAddress || '').toLowerCase() || null,
    chain: String(p.chainId || '').toLowerCase() || null,
    dexId: p.dexId || null,
    url: p.url || null,
    labels: Array.isArray(p.labels) ? p.labels : [],
    baseToken: p.baseToken ? {
      address: String(p.baseToken.address || '').toLowerCase() || null,
      name: p.baseToken.name || null,
      symbol: p.baseToken.symbol || null
    } : null,
    quoteToken: p.quoteToken ? {
      address: String(p.quoteToken.address || '').toLowerCase() || null,
      symbol: p.quoteToken.symbol || null
    } : null,
    priceUsd: num(p.priceUsd),
    liquidityUsd,
    fdv,
    marketCap,
    volume: {
      h1: num(p.volume?.h1),
      h6: num(p.volume?.h6),
      h24: volumeH24
    },
    priceChange: {
      h1: num(p.priceChange?.h1),
      h6: num(p.priceChange?.h6),
      h24: num(p.priceChange?.h24)
    },
    txns: {
      h1: { buys: num(p.txns?.h1?.buys), sells: num(p.txns?.h1?.sells) },
      h24: { buys: num(p.txns?.h24?.buys), sells: num(p.txns?.h24?.sells) }
    },
    pairCreatedAt,
    ageMs
  };
}

/** All pairs for one or more token addresses (max 30). */
export async function dexPairsForTokens(addresses) {
  const addrs = (Array.isArray(addresses) ? addresses : [addresses])
    .map((a) => String(a || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
  if (!addrs.length) return { dataStatus: 'unavailable', pairs: [] };
  try {
    const body = await getJson(`${DEX_BASE}/latest/dex/tokens/${addrs.join(',')}`, { timeout: 9000 });
    const pairs = (Array.isArray(body?.pairs) ? body.pairs : []).map(shapePair).filter(Boolean);
    return { dataStatus: pairs.length ? 'live' : 'no-pairs', pairs };
  } catch {
    return { dataStatus: 'unavailable', pairs: [] };
  }
}

/** All pairs that contain a search term (symbol/name/address). */
export async function dexSearch(query) {
  const q = String(query || '').trim();
  if (!q) return { dataStatus: 'unavailable', pairs: [] };
  try {
    const body = await getJson(`${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`, { timeout: 9000 });
    const pairs = (Array.isArray(body?.pairs) ? body.pairs : []).map(shapePair).filter(Boolean);
    return { dataStatus: pairs.length ? 'live' : 'no-results', pairs };
  } catch {
    return { dataStatus: 'unavailable', pairs: [] };
  }
}

/**
 * Freshly listed tokens — DexScreener's public "token profiles" feed
 * (keyless). These are tokens that just got a social/profile page, which in
 * practice means they just started trading. We then enrich each with its real
 * pairs (liquidity/volume/holders-proxy) before it can qualify as "early".
 */
export async function dexTokenProfiles() {
  try {
    const body = await getJson(`${DEX_BASE}/token-profiles/latest/v1`, { timeout: 9000 });
    const rows = Array.isArray(body) ? body : [];
    return rows
      .map((r) => ({
        tokenAddress: String(r.tokenAddress || '').toLowerCase(),
        chain: String(r.chainId || '').toLowerCase(),
        url: r.url || null,
        description: r.description || null,
        icon: r.icon || null
      }))
      .filter((r) => r.tokenAddress && r.chain);
  } catch {
    return [];
  }
}

/** Active token boosts (social-signal of attention; never a buy signal). */
export async function dexTokenBoosts() {
  try {
    const body = await getJson(`${DEX_BASE}/token-boosts/latest/v1`, { timeout: 9000 });
    const rows = Array.isArray(body) ? body : [];
    return rows
      .map((r) => ({
        tokenAddress: String(r.tokenAddress || '').toLowerCase(),
        chain: String(r.chainId || '').toLowerCase(),
        amount: Number(r.amount) || 0,
        description: r.description || null
      }))
      .filter((r) => r.tokenAddress && r.chain);
  } catch {
    return [];
  }
}

/* ════════════════════════════ Blockscout ═══════════════════════════════ */
/*
 * Keyless EVM indexer. We map our supported chains to a Blockscout v2 host.
 * When a chain has no Blockscout host, EVM address history falls back to the
 * Etherscan-family explorer key (see explorerAccount below); with neither,
 * history-dependent wallet metrics honestly report `dataStatus:'unavailable'`.
 */

export const BLOCKSCOUT = {
  1: 'https://eth.blockscout.com',
  56: 'https://bsc.blockscout.com',
  137: 'https://polygon.blockscout.com',
  42161: 'https://arbitrum.blockscout.com',
  8453: 'https://base.blockscout.com',
  10: 'https://optimism.blockscout.com'
};

function blockscoutBase(chainId) {
  return BLOCKSCOUT[Number(chainId)] || null;
}

async function bsGet(chainId, path) {
  const base = blockscoutBase(chainId);
  if (!base) {
    const err = new Error('NO_BLOCKSCOUT');
    err.code = 'NO_INDEXER';
    throw err;
  }
  return getJson(`${base}${path}`);
}

/** Address counters: first-seen tx time, total tx count. */
export async function bsAddressCounters(chainId, address) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/counters`);
    return {
      dataStatus: 'live',
      txCount: Number(j?.transactions_count) || 0,
      tokenTransfersCount: Number(j?.token_transfers_count) || 0,
      firstActivityAt: null // filled from txs endpoint when needed
    };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable' };
  }
}

/** Native + token balances for an address (token balances carry USD where
 *  Blockscout has exchange rates — otherwise we price via CoinGecko). */
export async function bsBalances(chainId, address) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/balances?type=ERC-20`);
    const tokens = (Array.isArray(j) ? j : []).map((b) => ({
      token: b?.token?.address ? String(b.token.address).toLowerCase() : null,
      symbol: b?.token?.symbol || null,
      name: b?.token?.name || null,
      decimals: Number(b?.token?.decimals) || 18,
      amount: b?.value != null ? Number(b.value) / 10 ** (Number(b?.token?.decimals) || 18) : null,
      valueUsd: b?.value_usd != null ? Number(b.value_usd) : null
    })).filter((t) => t.amount != null);
    return { dataStatus: 'live', tokens };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', tokens: [] };
  }
}

/**
 * Recent token transfers for an address. Each row has counterparty, token,
 * value, timestamp and a direction. This is the raw material for wallet
 * activity classification (buy/sell/transfer/CEX) and flow aggregation.
 */
export async function bsTokenTransfers(chainId, address, { limit = 50 } = {}) {
  try {
    const j = await bsGet(
      chainId,
      `/api/v2/addresses/${address}/token-transfers?type=ERC-20&filter=to%20%7C%20from&limit=${Math.min(100, limit)}`
    );
    const items = Array.isArray(j?.items) ? j.items : [];
    const rows = items.map((it) => {
      const token = it?.token;
      const decimals = Number(token?.decimals) || 18;
      const raw = Number(it?.total?.value ?? it?.value);
      const from = String(it?.from?.hash || '').toLowerCase();
      const to = String(it?.to?.hash || '').toLowerCase();
      const me = address.toLowerCase();
      return {
        hash: it?.transaction_hash ? String(it.transaction_hash).toLowerCase() : null,
        timestamp: it?.timestamp ? new Date(it.timestamp).getTime() : null,
        blockNumber: Number(it?.block_number) || null,
        from,
        to,
        direction: to === me ? 'in' : from === me ? 'out' : null,
        counterparty: to === me ? from : to,
        token: {
          address: token?.address ? String(token.address).toLowerCase() : null,
          symbol: token?.symbol || '???',
          name: token?.name || null,
          decimals
        },
        amount: Number.isFinite(raw) ? raw / 10 ** decimals : null,
        method: it?.method || null,
        // Blockscout public-tags / exchange labels when it knows them.
        fromTag: it?.from?.is_contract ? (it?.from?.name || null) : null,
        toTag: it?.to?.is_contract ? (it?.to?.name || null) : null
      };
    }).filter((r) => r.direction && r.amount != null);
    return {
      dataStatus: 'live',
      rows,
      // oldest timestamp of the page = lower bound on first activity
      oldestAt: rows.length ? Math.min(...rows.map((r) => r.timestamp || Date.now())) : null
    };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', rows: [] };
  }
}

/** Transactions for an address (used for native flows + tx-count/age). */
export async function bsTransactions(chainId, address, { limit = 50 } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/transactions?filter=to%20%7C%20from&limit=${Math.min(100, limit)}`);
    const items = Array.isArray(j?.items) ? j.items : [];
    const rows = items.map((it) => {
      const me = address.toLowerCase();
      const from = String(it?.from?.hash || '').toLowerCase();
      const to = String(it?.to?.hash || '').toLowerCase();
      return {
        hash: it?.hash ? String(it.hash).toLowerCase() : null,
        timestamp: it?.timestamp ? new Date(it.timestamp).getTime() : null,
        blockNumber: Number(it?.block_number) || null,
        from,
        to,
        direction: to === me ? 'in' : from === me ? 'out' : null,
        counterparty: to === me ? from : to,
        valueNative: Number(it?.value) / 1e18 || 0,
        method: it?.method || null,
        success: it?.status === 'ok'
      };
    }).filter((r) => r.direction);
    return { dataStatus: 'live', rows };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', rows: [] };
  }
}

/** Token holder list + total holder count for a contract. */
export async function bsTokenHolders(chainId, tokenAddress, { limit = 20 } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/tokens/${tokenAddress}/holders?limit=${Math.min(100, limit)}`);
    const items = Array.isArray(j?.items) ? j.items : [];
    const rows = items.map((h) => ({
      address: String(h?.address?.hash || '').toLowerCase(),
      name: h?.address?.name || h?.address?.ens_domain_name || null,
      isContract: !!h?.address?.is_contract,
      balance: Number(h?.value) / 10 ** (Number(h?.token?.decimals) || 18) || 0,
      share: null // computed by caller against total supply
    }));
    return { dataStatus: 'live', rows, totalHolders: Number(j?.total) ?? rows.length };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', rows: [] };
  }
}

/* ════════════════════════ Etherscan-family (keyed) ═════════════════════ */
/*
 * When a project key is set (ETHERSCAN_API_KEY etc.) we get a denser history
 * than the RPC-log fallback in server/whales.js. The keyless Blockscout path
 * covers most needs; this is the quality upgrade operators can switch on.
 */

const EXPLORERS = {
  1: { api: 'https://api.etherscan.io/api', keyEnv: 'ETHERSCAN_API_KEY' },
  56: { api: 'https://api.bscscan.com/api', keyEnv: 'BSCSCAN_API_KEY' },
  137: { api: 'https://api.polygonscan.com/api', keyEnv: 'POLYGONSCAN_API_KEY' },
  42161: { api: 'https://api.arbiscan.io/api', keyEnv: 'ARBISCAN_API_KEY' },
  8453: { api: 'https://api.basescan.org/api', keyEnv: 'BASESCAN_API_KEY' },
  10: { api: 'https://api-optimistic.etherscan.io/api', keyEnv: 'OPTIMISTIC_ETHERSCAN_API_KEY' }
};

export function explorerConfigured(chainId) {
  const exp = EXPLORERS[Number(chainId)];
  return !!(exp && String(process.env[exp.keyEnv] || '').trim());
}

/** Etherscan v2 txlist (dense account history) when a key is present. */
export async function explorerAccountTxns(chainId, address, { limit = 100 } = {}) {
  const exp = EXPLORERS[Number(chainId)];
  const key = exp && String(process.env[exp.keyEnv] || '').trim();
  if (!exp || !key) return { dataStatus: 'unconfigured', rows: [] };
  try {
    const url = `${exp.api}?module=account&action=txlist&address=${address}&sort=desc&offset=${Math.min(200, limit)}&apikey=${encodeURIComponent(key)}`;
    const body = await getJson(url, { timeout: 9000 });
    if (body?.status !== '1' || !Array.isArray(body.result)) return { dataStatus: 'unavailable', rows: [] };
    const rows = body.result.map((tx) => ({
      hash: String(tx.hash || '').toLowerCase(),
      timestamp: Number(tx.timeStamp) * 1000,
      blockNumber: Number(tx.blockNumber),
      from: String(tx.from || '').toLowerCase(),
      to: String(tx.to || '').toLowerCase(),
      valueNative: Number(tx.value) / 1e18 || 0,
      method: tx.methodId || null,
      success: tx.isError === '0'
    }));
    return { dataStatus: 'live', rows };
  } catch {
    return { dataStatus: 'unavailable', rows: [] };
  }
}

/* ════════════════════════════ Solana ═══════════════════════════════════ */
/*
 * Public RPC (keyless) for signatures + parsed token balances; Solscan Pro
 * (keyed, via server/solanaIntel.js) is preferred for labelled transfers.
 */

const SOL_RPC = String(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

async function solRpc(method, params) {
  const { signal, done } = ctrlTimeout(10_000);
  try {
    const res = await fetchImpl(SOL_RPC, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    if (!res.ok) throw new Error(`rpc ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  } finally {
    done();
  }
}

/** Recent signatures for a Solana address (activity + first-seen proxy). */
export async function solSignatures(address, { limit = 50 } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address || ''))) {
    return { dataStatus: 'bad-address', rows: [] };
  }
  try {
    const sigs = await solRpc('getSignaturesForAddress', [address, { limit: Math.min(100, limit) }]);
    const rows = (Array.isArray(sigs) ? sigs : []).map((s) => ({
      signature: s.signature,
      slot: s.slot,
      timestamp: s.blockTime ? s.blockTime * 1000 : null,
      err: s.err || null
    }));
    return {
      dataStatus: 'live',
      rows,
      oldestAt: rows.length ? Math.min(...rows.map((r) => r.timestamp || Date.now())) : null
    };
  } catch {
    return { dataStatus: 'unavailable', rows: [] };
  }
}

/** SOL balance in lamports for an address. */
export async function solBalance(address) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address || ''))) return { dataStatus: 'bad-address' };
  try {
    const lamports = await solRpc('getBalance', [address]);
    return { dataStatus: 'live', lamports: Number(lamports?.value ?? 0), sol: Number(lamports?.value ?? 0) / 1e9 };
  } catch {
    return { dataStatus: 'unavailable' };
  }
}

/**
 * SPL token balances for an address (public RPC, jsonParsed).
 *
 * Without this, a Solana wallet page could only ever show SOL: every token
 * position — which is what the Smart Money screens are actually about — was
 * invisible, so the page read as empty on a wallet holding hundreds of tokens.
 * The RPC returns a token account per mint (a wallet can hold several), so
 * rows are summed by mint and zero balances are dropped.
 */
export async function solTokenBalances(address, { limit = 40 } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address || ''))) return { dataStatus: 'bad-address', tokens: [] };
  try {
    const res = await solRpc('getTokenAccountsByOwner', [
      address,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' }
    ]);
    const byMint = new Map();
    for (const acc of (Array.isArray(res?.value) ? res.value : [])) {
      const info = acc?.account?.data?.parsed?.info;
      const mint = info?.mint;
      const ui = Number(info?.tokenAmount?.uiAmount);
      if (!mint || !Number.isFinite(ui) || ui <= 0) continue;
      const prev = byMint.get(mint) || { mint, amount: 0, decimals: Number(info?.tokenAmount?.decimals) || 0 };
      prev.amount += ui;
      byMint.set(mint, prev);
    }
    const tokens = [...byMint.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit)
      .map((t) => ({ token: t.mint, amount: t.amount, decimals: t.decimals, symbol: null, name: null }));
    return { dataStatus: 'live', tokens, accounts: Array.isArray(res?.value) ? res.value.length : 0 };
  } catch {
    return { dataStatus: 'unavailable', tokens: [] };
  }
}

/* ═══════════════════════════ search routing ═════════════════════════════ */

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX = /^0x[a-fA-F0-9]{64}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_TX = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

/**
 * Classify a search query without any network call. Used by the search box to
 * route straight to the right detail surface.
 */
export function classifyQuery(q) {
  const s = String(q || '').trim();
  if (EVM_TX.test(s)) return { kind: 'tx', chain: 'evm', address: s.toLowerCase() };
  if (SOL_TX.test(s)) return { kind: 'tx', chain: 'solana', address: s };
  if (EVM_ADDR.test(s)) return { kind: 'address', chain: 'evm', address: s.toLowerCase() };
  if (SOL_ADDR.test(s)) return { kind: 'address', chain: 'solana', address: s };
  if (/^[a-zA-Z0-9._$-]{2,12}$/.test(s)) return { kind: 'symbol', query: s.toUpperCase() };
  return { kind: 'text', query: s };
}
