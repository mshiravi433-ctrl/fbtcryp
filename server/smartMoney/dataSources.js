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

const configuredTimeout = Number(process.env.UPSTREAM_TIMEOUT_MS || 10_000);
const TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? Math.min(configuredTimeout, 14_000)
  : 10_000;

let fetchImpl = (url, opts) => globalThis.fetch(url, opts);

/** Test seam. Pass null to restore the global fetch. */
export function __setFetchForTests(fn) {
  fetchImpl = fn || ((url, opts) => globalThis.fetch(url, opts));
}

function ctrlTimeout(ms = TIMEOUT_MS) {
  const boundedMs = Math.max(250, Math.min(14_000, Number(ms) || TIMEOUT_MS));
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), boundedMs);
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

/** All pairs for one or more token addresses (max 30).
 *
 * Solana mints are base58 and CASE-SENSITIVE — lowercasing them rewrites the
 * address (5tzFki… ≠ 5tzfki…) and DexScreener answers nothing for the
 * mutated string. EVM addresses are hex and insensitive, so they keep being
 * normalised to lowercase for dedupe. */
const SOL_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export async function dexPairsForTokens(addresses, { timeoutMs = 9_000 } = {}) {
  const addrs = (Array.isArray(addresses) ? addresses : [addresses])
    .map((a) => String(a || '').trim())
    .map((a) => (SOL_MINT.test(a) ? a : a.toLowerCase()))
    .filter(Boolean)
    .slice(0, 30);
  if (!addrs.length) return { dataStatus: 'unavailable', pairs: [] };
  try {
    const body = await getJson(`${DEX_BASE}/latest/dex/tokens/${addrs.join(',')}`, { timeout: timeoutMs });
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
export async function dexTokenProfiles({ timeoutMs = 9000 } = {}) {
  try {
    const body = await getJson(`${DEX_BASE}/token-profiles/latest/v1`, { timeout: timeoutMs });
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
export async function dexTokenBoosts({ timeoutMs = 9000 } = {}) {
  try {
    const body = await getJson(`${DEX_BASE}/token-boosts/latest/v1`, { timeout: timeoutMs });
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

async function bsGet(chainId, path, { timeout = TIMEOUT_MS } = {}) {
  const base = blockscoutBase(chainId);
  if (!base) {
    const err = new Error('NO_BLOCKSCOUT');
    err.code = 'NO_INDEXER';
    throw err;
  }
  return getJson(`${base}${path}`, { timeout });
}

/** Address counters: first-seen tx time, total tx count. */
export async function bsAddressCounters(chainId, address, { timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/counters`, { timeout: timeoutMs });
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
    // A tagged liquidity pool is the DEX side of a swap («Uniswap V3: USDC 4»
    // is caught by the name regex; an OLI "Liquidity Pool" tag on an unnamed
    // pool used to fall through to plain `contract` and lose the pairing).
    else if (generic.has('dex') || generic.has('router') || generic.has('liquidity-pool') || /router|swap|aggregat/i.test(label || '')) kind = 'dex';
    else if (generic.has('bridge') || /bridge|portal|stargate|across|layerzero/i.test(label || '')) kind = 'bridge';
    else if (isContract || generic.has('token-contract')) kind = 'contract';
    else if (label) kind = 'entity';
  }
  return { label, kind, exchange, isContract: !!isContract };
}

function shapeParty(party) {
  if (!party || typeof party !== 'object') return { address: null, label: null, kind: null, exchange: null, isContract: false };
  const sum = summarizeTags(party.metadata?.tags, {
    // An EIP-7702 delegated EOA reports is_contract:true — it is still a user
    // wallet (the delegate is code it borrows, not a deployed contract).
    isContract: !!party.is_contract && String(party.proxy_type || '').toLowerCase() !== 'eip7702',
    isScam: !!party.is_scam,
    name: party.name || null,
    ens: party.ens_domain_name || null
  });
  return { address: party.hash ? String(party.hash).toLowerCase() : null, ...sum };
}

/** Native + token balances for an address. Blockscout ships an
 *  `exchange_rate` per token where it has one — kept as `priceUsd`/`valueUsd`
 *  so a holding still prices when no DEX pair answers. */
export async function bsBalances(chainId, address, { timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/token-balances`, { timeout: timeoutMs });
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
export async function bsTokenTransfers(chainId, address, { limit = 50, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/token-transfers?type=ERC-20`, { timeout: timeoutMs });
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
      // Blockscout only returns ONE page. A next-page cursor or local slice
      // means we cannot certify complete cost basis / lifetime profitability.
      hasMore: !!j?.next_page_params || items.length > Math.max(1, limit),
      // oldest timestamp of the page = lower bound on first activity
      oldestAt: rows.length ? Math.min(...rows.map((r) => r.timestamp || Date.now())) : null
    };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', rows: [] };
  }
}

/** Transactions for an address (used for native flows + tx-count/age). */
export async function bsTransactions(chainId, address, { limit = 50, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/addresses/${address}/transactions`, { timeout: timeoutMs });
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

/**
 * ACTIVE STABLECOIN TRADERS — live acquisition seed for the Verified
 * Intelligence index («هوش تأییدشده اصلاً به داده‌های واقعی وصل نیست»).
 *
 * The verified ledger (performance.js) can only prove a trade when a wallet
 * swaps an ERC-20 against an allowlisted USD stablecoin. The old discovery
 * queue fed it whale transfers ≥ $100k through a handful of routers — mostly
 * aggregators, solvers and CEX hot wallets that can never pair a swap — so the
 * index stayed empty forever. This reads the chain's latest transfers of the
 * stablecoin ITSELF and keeps only plain wallets (EOA, untagged, not a
 * bridge/MEV/exchange) that sent the stablecoin to a DEX/pool contract or
 * received it from one: people who are swapping against USD right now.
 *
 * Discovery only — a hit is an address worth examining, never a label, score
 * or vote. It becomes evidence only after analyzeWallet reconstructs its own
 * paired fills from its own history.
 */
/* Undecoded 4-byte selectors Blockscout prints when the contract ABI is not
   verified: Universal Router execute (both overloads), multicall (both), V3
   exactInput/exactInputSingle (router & router02), V2 swapExact*. A hint for
   discovery only — reconstructSwaps still demands the paired legs. */
const SWAP_SELECTORS = new Set(['0x3593564c', '0x24856bc3', '0x5ae401dc', '0xac9650d8', '0x414bf389', '0x04e45aaf',
  '0xc04b8d59', '0xb858183f', '0x38ed1739', '0x7ff36ab5', '0x18cbafe5']);

const isDelegatedEoa = (p) => String(p?.proxy_type || '').toLowerCase() === 'eip7702';
const isWalletParty = (p) => !!p && (!p.is_contract || isDelegatedEoa(p));
const isContractParty = (p) => !!p?.is_contract && !isDelegatedEoa(p);
const DEX_CONTRACT_NAME = /settler|router|swap|poolmanager|v[234]pool|pair\b|aggregat|augustus|odos|kyber|1inch|gpv2settlement|lbpair/i;

export async function bsRecentStableSwappers(chainId, tokenAddress, { minUsd = 250, limit = 12, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/tokens/${tokenAddress}/transfers`, { timeout: timeoutMs });
    const items = Array.isArray(j?.items) ? j.items : [];
    const out = new Map();
    for (const it of items) {
      const decimalsRaw = Number(it?.total?.decimals ?? it?.token?.decimals);
      const decimals = Number.isFinite(decimalsRaw) ? decimalsRaw : 6;
      const amount = Number(it?.total?.value) / 10 ** decimals;
      if (!Number.isFinite(amount) || amount < minUsd) continue;
      const from = shapeParty(it?.from);
      const to = shapeParty(it?.to);
      // Exactly one side a plain wallet, the other a contract (pool/router).
      // EIP-7702 delegated EOAs report is_contract:true but are user wallets.
      const walletSide = isWalletParty(it?.from) && isContractParty(it?.to) ? { party: from, raw: it.from, other: to, side: 'SENT' }
        : isWalletParty(it?.to) && isContractParty(it?.from) ? { party: to, raw: it.to, other: from, side: 'RECEIVED' } : null;
      if (!walletSide || !walletSide.party.address || /^0x0{40}$/.test(walletSide.party.address)) continue;
      // An EOA with an explorer name-tag is a solver, bridge, exchange or MEV
      // bot far more often than an independent trader — skip, never guess.
      // (An ENS name alone — kind 'entity' — is an ordinary user and stays.)
      if (walletSide.raw?.is_scam || (walletSide.party.kind && walletSide.party.kind !== 'entity')
        || (walletSide.raw?.metadata?.tags || []).length) continue;
      const method = String(it?.method || '').toLowerCase();
      // Aggregator settlement contracts (0x Settler, CoW, 1inch, Odos…) carry
      // no DEX tag on Blockscout, but their verified contract name is explicit.
      const otherName = String(walletSide.raw === it?.from ? it?.to?.name || '' : it?.from?.name || '');
      const counterpartyIsDex = walletSide.other.kind === 'dex'
        || /swap|exact|execute|multicall|unoswap|route/i.test(method) || SWAP_SELECTORS.has(method)
        || DEX_CONTRACT_NAME.test(otherName);
      if (!counterpartyIsDex) continue;
      const prev = out.get(walletSide.party.address);
      if (!prev || amount > prev.observedUsd) {
        out.set(walletSide.party.address, { chain: Number(chainId), address: walletSide.party.address,
          observedUsd: Math.round(amount), side: walletSide.side,
          txHash: it?.transaction_hash ? String(it.transaction_hash).toLowerCase() : null,
          at: it?.timestamp ? new Date(it.timestamp).getTime() : null, basis: 'live-stablecoin-dex-transfer' });
      }
    }
    const rows = [...out.values()].sort((a, b) => b.observedUsd - a.observedUsd).slice(0, Math.max(1, limit));
    return { dataStatus: 'live', rows };
  } catch (e) {
    return { dataStatus: e?.code === 'NO_INDEXER' ? 'unsupported-chain' : 'unavailable', rows: [] };
  }
}

/** Token contract facts (total supply, holder count, explorer price). */
export async function bsTokenInfo(chainId, tokenAddress, { timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const j = await bsGet(chainId, `/api/v2/tokens/${tokenAddress}`, { timeout: timeoutMs });
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
export async function bsTokenHolders(chainId, tokenAddress, { limit = 20, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const [holdersSettled, infoSettled] = await Promise.allSettled([
      bsGet(chainId, `/api/v2/tokens/${tokenAddress}/holders`, { timeout: timeoutMs }),
      bsTokenInfo(chainId, tokenAddress, { timeoutMs })
    ]);
    if (holdersSettled.status !== 'fulfilled') throw holdersSettled.reason;
    const j = holdersSettled.value;
    const info = infoSettled.status === 'fulfilled' ? infoSettled.value : { dataStatus: 'unavailable' };
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

/* ════════════════════ Solana public RPC: token holders ══════════════════ */
/*
 * Keyless public Solana RPC (no API key; rate-limited but fine for one mint).
 * getTokenSupply gives the real total supply; getTokenLargestAccounts gives
 * the largest holders, which is what a token page can honestly show. The
 * MINT ACCOUNT — the first entry whenever tokens are still unissued — holds
 * no one's tokens and would otherwise rank as the top "holder" with ~100%,
 * so it is excluded when its balance equals the total supply.
 *
 * totalHolders is deliberately null: a real census needs getProgramAccounts,
 * which at ~400k accounts per popular mint would hammer a public node. An
 * unknown count is reported as unknown, never as the number of rows we got.
 */
/* `solRpc` itself is declared below in the general Solana section — this
   block reuses it rather than re-declaring a second RPC client. */

export async function solanaTokenHolders(mint, { timeoutMs = 10_000 } = {}) {
  if (!SOL_MINT.test(String(mint || ''))) return { dataStatus: 'unavailable', rows: [], totalHolders: null };
  try {
    const [supplySettled, largestSettled] = await Promise.allSettled([
      solRpc('getTokenSupply', [mint], { timeoutMs }),
      solRpc('getTokenLargestAccounts', [mint], { timeoutMs })
    ]);
    if (supplySettled.status !== 'fulfilled') throw supplySettled.reason;
    if (largestSettled.status !== 'fulfilled') throw largestSettled.reason;
    const supply = supplySettled.value;
    const largest = largestSettled.value;
    const total = Number(supply?.value?.uiAmount);
    const accounts = Array.isArray(largest?.value) ? largest.value : [];
    const rows = accounts
      .map((a) => ({
        address: String(a?.address || ''),
        balance: Number(a?.uiAmount),
        amount: String(a?.amount || '')
      }))
      /* The mint account holds unissued supply, not a holder's tokens. */
      .filter((r) => !(total > 0 && r.amount && r.balance != null && Math.abs(r.balance - total) < 1e-9))
      .filter((r) => r.address && Number.isFinite(r.balance) && r.balance > 0)
      .map((r) => ({
        address: r.address,
        name: null,
        kind: null,
        exchange: null,
        isContract: false,
        balance: r.balance,
        share: total > 0 ? r.balance / total : null
      }));
    return {
      dataStatus: rows.length ? 'live' : 'quiet',
      rows,
      totalHolders: null
    };
  } catch {
    return { dataStatus: 'unavailable', rows: [], totalHolders: null };
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
export async function explorerAccountTxns(chainId, address, { limit = 100, timeoutMs = 9_000 } = {}) {
  const exp = EXPLORERS[Number(chainId)];
  const key = exp && String(process.env[exp.keyEnv] || '').trim();
  if (!exp || !key) return { dataStatus: 'unconfigured', rows: [] };
  try {
    const url = `${exp.api}?module=account&action=txlist&address=${address}&sort=desc&offset=${Math.min(200, limit)}&apikey=${encodeURIComponent(key)}`;
    const body = await getJson(url, { timeout: timeoutMs });
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

async function solRpc(method, params, { timeoutMs = 10_000 } = {}) {
  const { signal, done } = ctrlTimeout(timeoutMs);
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

export const SOL_SIGNATURE_PAGE_LIMIT = 100;
export const SOL_SIGNATURE_MAX_ROWS = 300;

/**
 * Signature history for a Solana address, newest first, with explicit
 * backwards pagination.
 *
 * `getSignaturesForAddress` returns one newest→oldest page; passing the last
 * signature of that page as `before` is the only cursor to older activity.
 * Phase 3 read one page and therefore could never say whether any older fill
 * existed. This reader can now make that distinction: `complete:true` is
 * returned only when the RPC itself returns a short page (the address has no
 * older signatures in the scanned direction). Hitting the row/page/deadline
 * caps on a full page is `complete:false`, never disguised as a full ledger.
 *
 * `limit` bounds raw signatures scanned before the optional failed-row
 * filter, so completeness talks about signature history rather than about
 * the shorter successful-only subset handed to transaction fetching.
 */
export async function solSignatures(address, {
  limit = 50,
  pageLimit = SOL_SIGNATURE_PAGE_LIMIT,
  maxPages = 1,
  includeFailed = true,
  timeoutMs = 10_000
} = {}) {
  const base = {
    rows: [], oldestAt: null, oldestScannedAt: null, complete: false,
    hasMore: false, pagesFetched: 0, scanned: 0
  };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address || ''))) {
    return { dataStatus: 'bad-address', ...base };
  }

  const target = Math.max(1, Math.min(SOL_SIGNATURE_MAX_ROWS, Number(limit) || 50));
  const boundedPageLimit = Math.max(1, Math.min(SOL_SIGNATURE_PAGE_LIMIT, Number(pageLimit) || SOL_SIGNATURE_PAGE_LIMIT));
  const boundedMaxPages = Math.max(1, Math.min(10, Number(maxPages) || 1));
  const budgetMs = Math.max(250, Math.min(14_000, Number(timeoutMs) || 10_000));
  const deadlineAt = Date.now() + budgetMs;
  const bySignature = new Map();
  let before = null;
  let pagesFetched = 0;
  let complete = false;
  let pageFailed = false;

  while (pagesFetched < boundedMaxPages && bySignature.size < target) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < 250) break;
    const requested = Math.min(boundedPageLimit, target - bySignature.size);
    let page;
    try {
      page = await solRpc('getSignaturesForAddress', [
        address,
        { limit: requested, ...(before ? { before } : {}) }
      ], { timeoutMs: remainingMs });
    } catch {
      pageFailed = true;
      break;
    }
    if (!Array.isArray(page)) {
      pageFailed = true;
      break;
    }
    pagesFetched++;

    let lastSignature = null;
    for (const raw of page) {
      const signature = String(raw?.signature || '');
      if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) continue;
      lastSignature = signature;
      if (!bySignature.has(signature)) {
        bySignature.set(signature, {
          signature,
          slot: raw.slot ?? null,
          timestamp: raw.blockTime ? raw.blockTime * 1000 : null,
          err: raw.err || null
        });
      }
    }

    // A short page is the RPC's own end-of-history proof. A full page only
    // proves that the next cursor *might* have older rows behind it.
    if (page.length < requested) {
      complete = true;
      break;
    }
    if (!lastSignature || lastSignature === before) break;
    before = lastSignature;
  }

  const scannedRows = [...bySignature.values()];
  const rows = includeFailed ? scannedRows : scannedRows.filter((row) => !row.err);
  const oldestAt = rows.length
    ? Math.min(...rows.map((r) => r.timestamp || Date.now())) : null;
  const oldestScannedAt = scannedRows.length
    ? Math.min(...scannedRows.map((r) => r.timestamp || Date.now())) : null;
  return {
    dataStatus: pageFailed ? (pagesFetched ? 'partial' : 'unavailable') : 'live',
    rows,
    oldestAt,
    oldestScannedAt,
    complete: complete && !pageFailed,
    hasMore: !(complete && !pageFailed),
    pagesFetched,
    scanned: scannedRows.length,
    pageLimit: boundedPageLimit,
    limit: target
  };
}

/** SOL balance in lamports for an address. */
export async function solBalance(address, { timeoutMs = 10_000 } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address || ''))) return { dataStatus: 'bad-address' };
  try {
    const lamports = await solRpc('getBalance', [address], { timeoutMs });
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
export async function solTokenBalances(address, { limit = 40, timeoutMs = 10_000 } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address || ''))) {
    return { dataStatus: 'bad-address', tokens: [], accounts: 0, mintCount: 0, truncated: false, complete: false };
  }
  const tokenPrograms = [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEB'
  ];
  try {
    // Token-2022 balances are invisible to the legacy program filter. A
    // reconciliation that silently omitted that whole token family would
    // call an incomplete balance read "independent" when it is not.
    const responses = await Promise.all(tokenPrograms.map((programId) => solRpc('getTokenAccountsByOwner', [
      address,
      { programId },
      { encoding: 'jsonParsed' }
    ], { timeoutMs })));
    const byMint = new Map();
    let accounts = 0;
    let invalidAccounts = 0;
    for (const res of responses) {
      if (!Array.isArray(res?.value)) invalidAccounts++;
      const rows = Array.isArray(res?.value) ? res.value : [];
      accounts += rows.length;
      for (const acc of rows) {
        const info = acc?.account?.data?.parsed?.info;
        const mint = String(info?.mint || '');
        const tokenAmount = info?.tokenAmount || {};
        const decimals = Number(tokenAmount.decimals);
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)
          || !/^\d+$/.test(String(tokenAmount.amount || ''))
          || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
          invalidAccounts++;
          continue;
        }
        let raw;
        try { raw = BigInt(String(tokenAmount.amount)); } catch {
          invalidAccounts++;
          continue;
        }
        if (raw <= 0n) continue;
        const prev = byMint.get(mint);
        if (prev && prev.decimals !== decimals) {
          invalidAccounts++;
          continue;
        }
        const amountRaw = (prev?.amountRaw || 0n) + raw;
        byMint.set(mint, {
          mint,
          amountRaw,
          amount: Number(amountRaw) / (10 ** decimals),
          decimals
        });
      }
    }
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 40));
    const sorted = [...byMint.values()].sort((a, b) => b.amount - a.amount || a.mint.localeCompare(b.mint));
    const tokens = sorted
      .slice(0, boundedLimit)
      .map((t) => ({
        token: t.mint,
        amount: t.amount,
        amountRaw: t.amountRaw.toString(),
        decimals: t.decimals,
        symbol: null,
        name: null
      }));
    return {
      dataStatus: 'live', tokens, accounts, invalidAccounts, mintCount: byMint.size,
      truncated: byMint.size > tokens.length,
      // A malformed token account may be display noise, but it is fatal to an
      // exact reconciliation claim: the omitted balance is unmeasured, not 0.
      complete: invalidAccounts === 0 && byMint.size <= tokens.length,
      tokenPrograms
    };
  } catch {
    return { dataStatus: 'unavailable', tokens: [], accounts: 0, invalidAccounts: 0, mintCount: 0, truncated: false, complete: false };
  }
}

/**
 * Full parsed transactions for a bounded set of Solana signatures.
 * The decoder needs both `meta.preTokenBalances`/`postTokenBalances` and,
 * from phase 4, parsed SPL-token transfer instructions; a signature list
 * alone can prove neither. Requests are deduplicated, capped at the same
 * 300-signature scan bound and read with limited concurrency under one
 * wall-clock budget. A partial read is labelled partial with exact counts —
 * never presented as a
 * complete wallet ledger.
 */
export async function solTransactions(signatures, { limit = 25, timeoutMs = 6_000, concurrency = 5 } = {}) {
  const requestedSigs = [...new Set((Array.isArray(signatures) ? signatures : [])
    .map((s) => String(typeof s === 'string' ? s : s?.signature || ''))
    .filter((s) => /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s)))]
    .slice(0, Math.max(1, Math.min(SOL_SIGNATURE_MAX_ROWS, Number(limit) || 25)));
  const base = { rows: [], requested: requestedSigs.length, attempted: 0, fetched: 0, failed: 0,
    unattempted: requestedSigs.length, complete: false, coverage: 0 };
  if (!requestedSigs.length) return { dataStatus: 'unavailable', ...base };

  const budgetMs = Math.max(250, Math.min(14_000, Number(timeoutMs) || 6_000));
  const deadlineAt = Date.now() + budgetMs;
  const batchSize = Math.max(1, Math.min(8, Number(concurrency) || 5));
  const rows = [];
  let attempted = 0;
  let failed = 0;

  for (let i = 0; i < requestedSigs.length; i += batchSize) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < 250) break;
    const batch = requestedSigs.slice(i, i + batchSize);
    attempted += batch.length;
    const settled = await Promise.allSettled(batch.map((signature) => solRpc('getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
    ], { timeoutMs: remainingMs })));
    settled.forEach((result, idx) => {
      const tx = result.status === 'fulfilled' ? result.value : null;
      if (!tx || typeof tx !== 'object') { failed++; return; }
      rows.push({
        signature: batch[idx],
        slot: tx.slot ?? null,
        blockTime: tx.blockTime ?? null,
        version: tx.version ?? null,
        transaction: tx.transaction || null,
        meta: tx.meta || null
      });
    });
  }

  const unattempted = requestedSigs.length - attempted;
  const complete = rows.length === requestedSigs.length && failed === 0 && unattempted === 0;
  const dataStatus = complete ? 'live' : rows.length ? 'partial' : 'unavailable';
  return {
    dataStatus, rows, requested: requestedSigs.length, attempted, fetched: rows.length,
    failed, unattempted, complete,
    coverage: requestedSigs.length ? rows.length / requestedSigs.length : 0
  };
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
