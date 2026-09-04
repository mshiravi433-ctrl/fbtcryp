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

/*
 * BLOCKSCOUT v2 CONTRACT — verified against eth.blockscout.com / base.blockscout.com
 * ---------------------------------------------------------------------------
 *   · list endpoints take NO `limit` parameter (the API answers 4xx
 *     «Unexpected field: limit») and `filter` accepts only `to` or `from`
 *     — `filter=to | from` is rejected. We ask for the plain page (50 rows)
 *     and slice client-side.
 *   · token balances live at `/addresses/{a}/token-balances` (not `/balances`).
 *   · token objects carry `address_hash` (older hosts: `address`).
 *   · transfer amounts are `total.value` + `total.decimals`.
 *   · address objects carry `is_contract`, `is_scam`, `name`, `ens_domain_name`
 *     and `metadata.tags[]` ({name, slug, tagType:name|generic|protocol|note,
 *     meta}) — the explorer's public name-tags («Kraken: Hot Wallet 4»,
 *     «OKX Deposit», «MEV Bot», «Null Address»).
 *
 * Every one of these mistakes used to turn the wallet page into
 * `dataStatus:'unavailable'` for EVERY address while the indexer was up.
 */

const tokenAddr = (token) => {
  const a = token?.address_hash ?? token?.address;
  return a ? String(a).toLowerCase() : null;
};

const EXCHANGE_HINTS = [
  ['binance', 'Binance'], ['coinbase', 'Coinbase'], ['kraken', 'Kraken'], ['okx', 'OKX'], ['okex', 'OKX'],
  ['bybit', 'Bybit'], ['bitfinex', 'Bitfinex'], ['gate', 'Gate.io'], ['kucoin', 'KuCoin'], ['htx', 'HTX'],
  ['huobi', 'HTX'], ['crypto.com', 'Crypto.com'], ['bitget', 'Bitget'], ['mexc', 'MEXC'], ['upbit', 'Upbit'],
  ['bithumb', 'Bithumb'], ['gemini', 'Gemini'], ['bitstamp', 'Bitstamp'], ['robinhood', 'Robinhood'],
  ['bitmart', 'BitMart'], ['poloniex', 'Poloniex'], ['bittrex', 'Bittrex'], ['deribit', 'Deribit'],
  ['bitpanda', 'Bitpanda'], ['bitvavo', 'Bitvavo'], ['whitebit', 'WhiteBIT'], ['lbank', 'LBank'], ['coinex', 'CoinEx']
];

function exchangeFromText(text) {
  const low = String(text || '').toLowerCase();
  if (!low) return null;
  for (const [needle, name] of EXCHANGE_HINTS) if (low.includes(needle)) return name;
  return null;
}

/**
 * Reduce an explorer tag list to one honest label.
 *   kind: 'exchange' | 'zero' | 'mev' | 'dex' | 'bridge' | 'contract' | 'scam' | 'entity' | null
 * Exchange detection uses ONLY name/protocol tags (or an explicit
 * `cexDeposit` meta) — the generic «Coinbase» tag Blockscout puts on the
 * zero address means the block *coinbase*, not the exchange, and must never
 * count as a flow.
 */
export function summarizeTags(tags, { isContract = false, isScam = false, name = null, ens = null } = {}) {
  const list = Array.isArray(tags) ? tags : [];
  const meta = (t) => {
    if (!t?.meta) return {};
    if (typeof t.meta === 'object') return t.meta;
    try { return JSON.parse(t.meta); } catch { return {}; }
  };
  const named = list.filter((t) => t?.tagType === 'name').sort((a, b) => (b.ordinal || 0) - (a.ordinal || 0));
  const generic = new Set(list.filter((t) => t?.tagType === 'generic').map((t) => String(t.slug || '').toLowerCase()));
  const protocols = list.filter((t) => t?.tagType === 'protocol');
  const label = named[0]?.name || name || ens || null;

  let kind = null;
  let exchange = null;
  if (generic.has('burn') || generic.has('genesis') || generic.has('null') || /^null[: ]/i.test(label || '')) kind = 'zero';
  for (const t of named) {
    const m = meta(t);
    exchange = exchange || (m.cexDeposit ? exchangeFromText(t.name) : null) || exchangeFromText(m.main_entity) || null;
  }
  if (!exchange && (generic.has('exchange') || generic.has('hot-wallet') || generic.has('deposit-address'))) {
    for (const t of [...named, ...protocols]) { exchange = exchangeFromText(t.name); if (exchange) break; }
  }
  if (!exchange) {
    for (const t of protocols) { exchange = exchangeFromText(t.name); if (exchange) break; }
    // A protocol tag alone (e.g. «Binance» on a BNB-chain contract) is only
    // evidence when the address is also marked as an exchange-class wallet.
    if (exchange && !(generic.has('exchange') || generic.has('hot-wallet') || generic.has('deposit-address') || /hot wallet|cold wallet|deposit/i.test(label || ''))) exchange = null;
  }
  if (kind !== 'zero') {
    if (exchange) kind = 'exchange';
    else if (isScam || generic.has('phish--hack') || generic.has('scam')) kind = 'scam';
    else if (generic.has('mev-bot') || /^mev bot/i.test(label || '')) kind = 'mev';
    else if (generic.has('dex') || generic.has('router') || /router|swap|aggregat/i.test(label || '')) kind = 'dex';
    else if (generic.has('bridge') || /bridge|portal|stargate|across|layerzero/i.test(label || '')) kind = 'bridge';
    else if (isContract || generic.has('token-contract')) kind = 'contract';
    else if (label) kind = 'entity';
  }
  return { label, kind, exchange, isContract: !!isContract };
}

function shapeParty(party) {
  if (!party || typeof party !== 'object') return { address: null, label: null, kind: null, exchange: null, isContract: false };
  const sum = summarizeTags(party.metadata?.tags, {
    isContract: !!party.is_contract,
    isScam: !!party.is_scam,
    name: party.name || null,
    ens: party.ens_domain_name || null
  });
  return { address: party.hash ? String(party.hash).toLowerCase() : null, ...sum };
}

/** Native + token balances for an address. Blockscout ships an
 *  `exchange_rate` per token where it has one — kept as `priceUsd`/`valueUsd`
 *  so a holding still prices when no DEX pair answers. */
export async function bsBalances(chainId, address) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/token-balances`);
    const tokens = (Array.isArray(j) ? j : [])
      .filter((b) => !b?.token?.type || b.token.type === 'ERC-20')
      .map((b) => {
        const decimals = Number(b?.token?.decimals);
        const dec = Number.isFinite(decimals) ? decimals : 18;
        const amount = b?.value != null ? Number(b.value) / 10 ** dec : null;
        const rate = Number(b?.token?.exchange_rate);
        const priceUsd = Number.isFinite(rate) && rate > 0 ? rate : null;
        return {
          token: tokenAddr(b?.token),
          symbol: b?.token?.symbol || null,
          name: b?.token?.name || null,
          decimals: dec,
          amount,
          priceUsd,
          valueUsd: amount != null && priceUsd != null ? amount * priceUsd : null
        };
      })
      .filter((t) => t.token && t.amount != null);
    return { dataStatus: 'live', tokens };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', tokens: [] };
  }
}

/**
 * Recent token transfers for an address. Each row has counterparty, token,
 * value, timestamp and a direction. This is the raw material for wallet
 * activity classification (buy/sell/transfer/CEX) and flow aggregation.
 * Zero-value transfers (address-poisoning spam) are dropped.
 */
export async function bsTokenTransfers(chainId, address, { limit = 50 } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/token-transfers?type=ERC-20`);
    const items = Array.isArray(j?.items) ? j.items : [];
    const me = address.toLowerCase();
    const rows = items.map((it) => {
      const token = it?.token;
      const decimalsRaw = Number(it?.total?.decimals ?? token?.decimals);
      const decimals = Number.isFinite(decimalsRaw) ? decimalsRaw : 18;
      const raw = Number(it?.total?.value ?? it?.value);
      const fromP = shapeParty(it?.from);
      const toP = shapeParty(it?.to);
      const from = fromP.address || '';
      const to = toP.address || '';
      const direction = to === me ? 'in' : from === me ? 'out' : null;
      const other = direction === 'in' ? fromP : toP;
      return {
        hash: it?.transaction_hash ? String(it.transaction_hash).toLowerCase() : null,
        timestamp: it?.timestamp ? new Date(it.timestamp).getTime() : null,
        blockNumber: Number(it?.block_number) || null,
        from,
        to,
        direction,
        counterparty: direction === 'in' ? from : to,
        counterpartyLabel: other.label,
        counterpartyKind: other.kind,
        counterpartyExchange: other.exchange,
        token: {
          address: tokenAddr(token),
          symbol: token?.symbol || '???',
          name: token?.name || null,
          decimals
        },
        amount: Number.isFinite(raw) ? raw / 10 ** decimals : null,
        method: it?.method || null,
        fromTag: fromP.label,
        toTag: toP.label
      };
    }).filter((r) => r.direction && r.amount != null && r.amount > 0).slice(0, Math.max(1, limit));
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
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/transactions`);
    const items = Array.isArray(j?.items) ? j.items : [];
    const me = address.toLowerCase();
    const rows = items.map((it) => {
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
    }).filter((r) => r.direction).slice(0, Math.max(1, limit));
    return { dataStatus: 'live', rows };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', rows: [] };
  }
}

/** Token contract facts (total supply, holder count, explorer price). */
export async function bsTokenInfo(chainId, tokenAddress) {
  try {
    const j = await bsGet(chainId, `/api/v2/tokens/${tokenAddress}`);
    const decimals = Number(j?.decimals);
    return {
      dataStatus: 'live',
      decimals: Number.isFinite(decimals) ? decimals : 18,
      totalSupplyRaw: j?.total_supply != null ? String(j.total_supply) : null,
      holdersCount: Number(j?.holders_count) || null,
      priceUsd: Number(j?.exchange_rate) > 0 ? Number(j.exchange_rate) : null,
      symbol: j?.symbol || null,
      name: j?.name || null
    };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable' };
  }
}

/** Token holder list + total holder count for a contract. `share` is the
 *  holder's slice of total supply when the contract reports one. */
export async function bsTokenHolders(chainId, tokenAddress, { limit = 20 } = {}) {
  try {
    const [j, info] = await Promise.all([
      bsGet(chainId, `/api/v2/tokens/${tokenAddress}/holders`),
      bsTokenInfo(chainId, tokenAddress).catch(() => ({ dataStatus: 'unavailable' }))
    ]);
    const items = Array.isArray(j?.items) ? j.items : [];
    const supply = info?.totalSupplyRaw ? Number(info.totalSupplyRaw) : null;
    const rows = items.slice(0, Math.max(1, limit)).map((h) => {
      const dec = Number(h?.token?.decimals ?? info?.decimals);
      const decimals = Number.isFinite(dec) ? dec : 18;
      const party = shapeParty(h?.address);
      const raw = Number(h?.value);
      return {
        address: party.address || '',
        name: party.label,
        kind: party.kind,
        exchange: party.exchange,
        isContract: party.isContract,
        balance: Number.isFinite(raw) ? raw / 10 ** decimals : 0,
        share: supply && Number.isFinite(raw) && supply > 0 ? raw / supply : null
      };
    });
    const total = Number(j?.total);
    return {
      dataStatus: 'live',
      rows,
      totalHolders: Number.isFinite(total) && total > 0 ? total : (info?.holdersCount ?? rows.length)
    };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', rows: [] };
  }
}

/* ═══════════════════ Blockscout public address metadata ════════════════ */
/*
 * Keyless bulk name-tag lookup: the same tags the explorer shows on an
 * address page («Kraken: Hot Wallet 4», «OKX Deposit», «MEV Bot»,
 * «Beacon Depositor», «Null Address»). One request labels up to 50
 * addresses on one chain. Used to (a) recognise exchange counterparties the
 * curated registry does not list yet — reported at confidence 'medium' with
 * source 'blockscout-tag' — and (b) keep contracts, MEV bots and the zero
 * address off the whale board. A silent failure labels nothing; nothing
 * is ever guessed.
 */

const METADATA_BASE = 'https://metadata.services.blockscout.com/api/v1/metadata';
const TAG_TTL_MS = 6 * 3600_000;
const tagMemo = new Map(); // `${chainId}:${addr}` → { value, expires }
const EMPTY_TAG = Object.freeze({ label: null, kind: null, exchange: null, isContract: false });

export async function bsAddressTags(chainId, addresses, { timeout = 5000 } = {}) {
  const out = new Map();
  const want = [...new Set((addresses || []).map((a) => String(a || '').toLowerCase()).filter((a) => /^0x[a-f0-9]{40}$/.test(a)))];
  const missing = [];
  const now = Date.now();
  for (const a of want) {
    const hit = tagMemo.get(`${chainId}:${a}`);
    if (hit && hit.expires > now) out.set(a, hit.value);
    else missing.push(a);
  }
  const batches = [];
  for (let i = 0; i < missing.length; i += 50) batches.push(missing.slice(i, i + 50));
  await Promise.all(batches.map(async (batch) => {
    let body = null;
    try {
      body = await getJson(`${METADATA_BASE}?chainId=${Number(chainId)}&tagsLimit=8&addresses=${batch.join(',')}`, { timeout });
    } catch {
      return; // labels are an enrichment, never a dependency
    }
    const byLower = new Map();
    for (const [addr, row] of Object.entries(body?.addresses || {})) byLower.set(String(addr).toLowerCase(), row);
    for (const a of batch) {
      const row = byLower.get(a);
      const value = row ? summarizeTags(row.tags) : EMPTY_TAG;
      tagMemo.set(`${chainId}:${a}`, { value, expires: now + TAG_TTL_MS });
      out.set(a, value);
    }
  }));
  return out;
}

/** Test/ops seam: forget every cached tag. */
export function __clearTagCacheForTests() { tagMemo.clear(); }

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
