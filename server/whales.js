/**
 * Whale transactions.
 *
 * Pulls RECENT large transfers from the supported EVM chains via their public
 * RPC endpoints (no API key required). We look at the last N blocks, collect
 * ERC-20 Transfer event logs above a value floor, plus large native coin
 * transfers, then annotate with prices from the existing CoinGecko provider
 * and labels from our curated token registry.
 *
 * Optional ETHERSCAN_API_KEY / BSCSCAN_API_KEY / POLYGONSCAN_API_KEY /
 * ARBISCAN_API_KEY / BASESCAN_API_KEY / OPTIMISTIC_ETHERSCAN_API_KEY /
 * SNOWTRACE_API_KEY can be set server-side to use the txlist endpoint which
 * yields a much denser set of transactions (including internal transfers and
 * exchange inflows). When no key is set we fall back to RPC logs — the
 * endpoint degrades gracefully rather than failing closed.
 *
 * Exchange labels are ONLY derived from addresses the project's chain
 * registry genuinely recognises. Unknown addresses stay "Unknown". Nothing is
 * fabricated.
 */

import { withCache, memoryStore } from './cache.js';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS } from './chainsLite.js';

const UPSTREAM_TIMEOUT_MS = 8000;

// How many blocks we scan per chain when no explorer key is available. We keep
// this modest because each `eth_getLogs` call across a wide block range is
// expensive for the public RPC and will get rate-limited if we push it.
const RPC_BLOCK_WINDOW = Number(process.env.WHALE_BLOCK_WINDOW || 15);

/*
 * Approximate seconds-per-block per chain. The old code hardcoded 3s for
 * EVERY chain, so an Ethereum event 10 blocks back (~2 minutes) was stamped
 * ~30 seconds old, and window math (24h vs previous 24h) drifted. Real block
 * cadence differs by 40x across the supported chains.
 */
const BLOCK_TIME_MS = {
  1: 12_000,     // Ethereum
  56: 3_000,     // BNB Smart Chain
  137: 2_200,    // Polygon
  42161: 300,    // Arbitrum One
  8453: 2_000,   // Base
  10: 2_000,     // Optimism
  43114: 2_000   // Avalanche C-Chain
};

/*
 * Per-chain log-scan window (blocks) sized to cover a similar slice of wall
 * time (~2-3 minutes) on each chain instead of 15 blocks everywhere — which
 * was 3 minutes on Ethereum but 4.5 SECONDS on Arbitrum, leaving the fast
 * chains almost always "empty". WHALE_BLOCK_WINDOW still overrides all.
 */
const CHAIN_BLOCK_WINDOW = {
  1: 15, 56: 50, 137: 60, 42161: 240, 8453: 60, 10: 60, 43114: 60
};

function blockWindowFor(chainId) {
  if (process.env.WHALE_BLOCK_WINDOW) return RPC_BLOCK_WINDOW;
  return CHAIN_BLOCK_WINDOW[chainId] || RPC_BLOCK_WINDOW;
}

// Per-chain explorer endpoints (Etherscan-compatible). Each entry, when its
// key is present, activates the explorer fast path.
const EXPLORERS = {
  1: { api: 'https://api.etherscan.io/api', keyEnv: 'ETHERSCAN_API_KEY' },
  56: { api: 'https://api.bscscan.com/api', keyEnv: 'BSCSCAN_API_KEY' },
  137: { api: 'https://api.polygonscan.com/api', keyEnv: 'POLYGONSCAN_API_KEY' },
  42161: { api: 'https://api.arbiscan.io/api', keyEnv: 'ARBISCAN_API_KEY' },
  8453: { api: 'https://api.basescan.org/api', keyEnv: 'BASESCAN_API_KEY' },
  10: { api: 'https://api-optimistic.etherscan.io/api', keyEnv: 'OPTIMISTIC_ETHERSCAN_API_KEY' },
  43114: { api: 'https://api.snowtrace.io/api', keyEnv: 'SNOWTRACE_API_KEY' }
};

// Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function ctrlTimeout(ms = UPSTREAM_TIMEOUT_MS) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function rpcCall(url, method, params, { timeout = UPSTREAM_TIMEOUT_MS } = {}) {
  const { signal, done } = ctrlTimeout(timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
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

function hexToNumber(h) {
  if (h == null) return null;
  if (typeof h === 'number') return h;
  return BigInt(h).toString(); // avoid precision loss, return string
}

function hexToBigInt(h) {
  if (h == null) return 0n;
  try { return BigInt(h); } catch { return 0n; }
}

/** Address of a log topic — strip leading zeros to the 20-byte form. */
function topicToAddr(t) {
  if (!t || t.length < 64) return null;
  return '0x' + t.slice(-40).toLowerCase();
}

function short(a) {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Build a lookup map of known tokens on this chain (address → token meta). */
function knownTokenMap(chainId) {
  const out = new Map();
  for (const t of TOKENS[chainId] ?? []) {
    if (t.address) out.set(t.address.toLowerCase(), t);
  }
  return out;
}

/**
 * Known exchange/labelled addresses. Deliberately tiny and conservative — we
 * only label addresses we actually recognise from the curated list. Anything
 * not here remains "Unknown".
 *
 * These addresses are public and widely-documented (they appear on every block
 * explorer). They are not secrets.
 */
const KNOWN_ADDR = {
  1: {
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { label: 'Tether Treasury', kind: 'issuer' },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { label: 'Circle', kind: 'issuer' },
    '0x0000000000000000000000000000000000000000': { label: 'Zero', kind: 'zero' },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { label: 'WETH Contract', kind: 'contract' }
  },
  56: {
    '0x55d398326f99059ff775485246999027b3197955': { label: 'Tether (BSC)', kind: 'issuer' },
    '0x0000000000000000000000000000000000000000': { label: 'Zero', kind: 'zero' },
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { label: 'WBNB Contract', kind: 'contract' }
  }
};

function labelFor(chainId, address) {
  if (!address) return null;
  const map = KNOWN_ADDR[chainId];
  return map?.[address.toLowerCase()] ?? null;
}

function classify(fromLabel, toLabel, fromAddr, toAddr, isMint, isBurn, value) {
  if (isMint) return 'mint';
  if (isBurn) return 'burn';
  const zero = '0x0000000000000000000000000000000000000000';
  if (fromAddr === zero) return 'mint';
  if (toAddr === zero) return 'burn';
  if (fromLabel?.kind === 'issuer') return 'mint'; // treat treasury emits like mints
  if (toLabel?.kind === 'issuer') return 'burn';
  if (fromLabel?.kind === 'contract' && !toLabel) return 'transfer';
  if (toLabel?.kind === 'contract' && !fromLabel) return 'transfer';
  // Default: plain transfer — we do NOT invent "exchange inflow/outflow"
  // without verifiable address labels. Callers can extend KNOWN_ADDR with
  // verified exchange hot wallets when/if they are sourced.
  return 'transfer';
}

function explorerTxUrl(chainId, hash) {
  const cfg = EVM_CHAINS[chainId];
  if (!cfg?.explorer) return null;
  return `${cfg.explorer}/tx/${hash}`;
}

function explorerAddrUrl(chainId, addr) {
  const cfg = EVM_CHAINS[chainId];
  if (!cfg?.explorer) return null;
  return `${cfg.explorer}/address/${addr}`;
}

/* -------- fetch helpers per chain (RPC-only fallback path) -------- */

/*
 * WHALE SCAN ENDPOINT FALLBACK
 * ---------------------------------------------------------------------------
 * Each chain lists several public RPCs (see chainsLite.js) because one dead
 * or rate-limited host used to take the WHOLE chain out of the feed:
 * `eth_blockNumber` throws → the chain returns [] → metrics, flows and the
 * whale board all lose that chain's events. Now we walk the endpoint list
 * in order; an endpoint that cannot even read the latest block is skipped,
 * while an endpoint that answers (even with zero whale events in the window)
 * is a VALID answer and stops the walk — we never pay extra upstream calls
 * for a chain that is genuinely quiet.
 */
async function fetchWhalesRpc(chainId, minValueUsd, priceLookup) {
  const cfg = EVM_CHAINS[chainId];
  if (!cfg?.rpc?.length) return [];
  const known = knownTokenMap(chainId);
  let lastErr = null;
  for (const rpc of cfg.rpc) {
    try {
      return await fetchWhalesRpcFrom(rpc, chainId, minValueUsd, priceLookup, known);
    } catch (e) {
      // This endpoint failed (rate-limited / down) — try the next one.
      lastErr = e;
    }
  }
  // Every endpoint for this chain failed. Re-throw so `fetchWhales` records
  // it in `failedChains` / `partial: true` — the same observability the
  // single-endpoint days had. Other chains continue (allSettled).
  throw lastErr || new Error("ALL_RPC_ENDPOINTS_FAILED");
}

async function fetchWhalesRpcFrom(rpc, chainId, minValueUsd, priceLookup, known) {
  /*
   * THE BUG THAT BLANKED SMART MONEY: this function referenced `cfg`
   * (chain metadata for chainShort/name/color) without defining it. A chain
   * whose getLogs came back EMPTY sailed through, but the moment a chain
   * returned real Transfer logs the first `events.push({ chainShort:
   * cfg.short … })` threw ReferenceError, the whole chain was recorded as
   * "failed", and the feed stayed empty forever — the more on-chain
   * activity, the harder it failed. That is why «هیچ اتصالی برقرار نیست».
   */
  const cfg = EVM_CHAINS[chainId];
  const latestHex = await rpcCall(rpc, 'eth_blockNumber', []);
  const latest = Number(BigInt(latestHex));
  const windowBlocks = blockWindowFor(chainId);
  const fromBlock = Math.max(0, latest - windowBlocks);
  const toBlock = latest;

  // ERC-20 Transfer logs across the whole window. Some public RPCs cap this
  // range; we retry with progressively smaller windows on failure.
  let logs = [];
  try {
    logs = await rpcCall(rpc, 'eth_getLogs', [{
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      topics: [TRANSFER_TOPIC]
    }]);
  } catch {
    // Try a half-size window, then a tight 3-block window.
    try {
      logs = await rpcCall(rpc, 'eth_getLogs', [{
        fromBlock: '0x' + Math.max(0, latest - Math.max(3, Math.floor(windowBlocks / 2))).toString(16),
        toBlock: '0x' + toBlock.toString(16),
        topics: [TRANSFER_TOPIC]
      }]);
    } catch {
      try {
        logs = await rpcCall(rpc, 'eth_getLogs', [{
          fromBlock: '0x' + Math.max(0, latest - 3).toString(16),
          toBlock: '0x' + toBlock.toString(16),
          topics: [TRANSFER_TOPIC]
        }]);
      } catch (e) {
        throw e; // this endpoint cannot serve logs — let the caller try the next
      }
    }
  }
  if (!Array.isArray(logs)) logs = [];

  const events = [];
  const seen = new Set();
  for (const log of logs ?? []) {
    if (!log?.topics?.[0] || log.topics[0] !== TRANSFER_TOPIC) continue;
    if (!log.topics[1] || !log.topics[2] || !log.data) continue;
    const from = topicToAddr(log.topics[1]);
    const to = topicToAddr(log.topics[2]);
    if (!from || !to) continue;
    const raw = hexToBigInt(log.data);
    if (raw === 0n) continue;
    const contract = log.address?.toLowerCase();
    const token = known.get(contract);
    const decimals = token?.decimals ?? 18;
    const divisor = 10n ** BigInt(decimals);
    const amount = Number(raw / divisor) + Number(raw % divisor) / Number(divisor);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const cgId = token?.coingeckoId;
    const usdPrice = cgId ? priceLookup(cgId) : null;
    const valueUsd = usdPrice != null ? amount * usdPrice : null;
    if (valueUsd != null && valueUsd < minValueUsd) continue;
    if (valueUsd == null && amount < 1_000_000) continue; // unpriced tokens: huge qty only

    const zero = '0x0000000000000000000000000000000000000000';
    const isMint = from === zero;
    const isBurn = to === zero;
    const fromLabel = isMint ? { label: 'Mint', kind: 'zero' } : labelFor(chainId, from);
    const toLabel = isBurn ? { label: 'Burn', kind: 'zero' } : labelFor(chainId, to);
    const kind = classify(fromLabel, toLabel, from, to, isMint, isBurn, amount);

    const ts = Number(log.blockNumber) ? Number(BigInt(log.blockNumber)) : null;
    const id = `${chainId}:${log.transactionHash?.toLowerCase()}:${log.logIndex}`;
    if (seen.has(id)) continue;
    seen.add(id);

    events.push({
      id,
      chainId,
      chainShort: cfg.short,
      chainName: cfg.name,
      chainColor: cfg.color,
      kind,
      token: {
        symbol: token?.symbol ?? '???',
        name: token?.name ?? (contract ? short(contract) : 'Unknown'),
        address: contract,
        decimals,
        verified: Boolean(token),
        coingeckoId: cgId ?? null
      },
      amount,
      amountRaw: raw.toString(),
      valueUsd,
      usdPrice,
      from: { address: from, label: fromLabel?.label ?? null, short: short(from) },
      to: { address: to, label: toLabel?.label ?? null, short: short(to) },
      hash: log.transactionHash,
      blockNumber: Number(BigInt(log.blockNumber)),
      txIndex: Number(log.transactionIndex ?? 0),
      logIndex: Number(log.logIndex ?? 0),
      timestamp: null, // filled below from block header
      explorerTx: explorerTxUrl(chainId, log.transactionHash),
      explorerFrom: explorerAddrUrl(chainId, from),
      explorerTo: explorerAddrUrl(chainId, to)
    });
  }

  // Native large transfers — pull last block's coinbase + high-value transactions
  try {
    const block = await rpcCall(rpc, 'eth_getBlockByNumber', ['0x' + latest.toString(16), true]);
    const ts = Number(BigInt(block.timestamp ?? '0x0')) * 1000;
    if (block?.transactions) {
      for (const tx of block.transactions) {
        const value = hexToBigInt(tx.value);
        if (value === 0n) continue;
        const amount = Number(value / 10n ** 18n);
        const usdPrice = priceLookup(cfg.native.coingeckoId);
        const valueUsd = usdPrice != null ? amount * usdPrice : null;
        if (valueUsd != null && valueUsd < minValueUsd) continue;
        const from = tx.from?.toLowerCase();
        const to = tx.to?.toLowerCase();
        if (!from || !to) continue;
        const fromLabel = labelFor(chainId, from);
        const toLabel = labelFor(chainId, to);
        const id = `${chainId}:native:${tx.hash?.toLowerCase()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        events.push({
          id,
          chainId,
          chainShort: cfg.short,
          chainName: cfg.name,
          chainColor: cfg.color,
          kind: classify(fromLabel, toLabel, from, to, false, false, amount),
          token: {
            symbol: cfg.native.symbol,
            name: cfg.name + ' Native',
            address: null,
            decimals: cfg.native.decimals,
            verified: true,
            coingeckoId: cfg.native.coingeckoId
          },
          amount,
          amountRaw: value.toString(),
          valueUsd,
          usdPrice,
          from: { address: from, label: fromLabel?.label ?? null, short: short(from) },
          to: { address: to, label: toLabel?.label ?? null, short: short(to) },
          hash: tx.hash,
          blockNumber: Number(BigInt(tx.blockNumber)),
          txIndex: Number(tx.transactionIndex ?? 0),
          logIndex: -1,
          timestamp: ts,
          explorerTx: explorerTxUrl(chainId, tx.hash),
          explorerFrom: explorerAddrUrl(chainId, from),
          explorerTo: explorerAddrUrl(chainId, to)
        });
      }
    }
    // Attach timestamp to ERC-20 events from same latest block; older blocks
    // are approximated using the chain's real block cadence (BLOCK_TIME_MS) —
    // good enough for "X minutes ago" and for window math.
    const blockMs = BLOCK_TIME_MS[chainId] || 3000;
    for (const e of events) {
      if (!e.timestamp) {
        const diff = latest - e.blockNumber;
        e.timestamp = ts - diff * blockMs;
      }
    }
  } catch {
    // fall through; ERC-20 events will still carry approximate timestamps
    const now = Date.now();
    const blockMs = BLOCK_TIME_MS[chainId] || 3000;
    for (const e of events) {
      if (!e.timestamp) {
        const diff = latest - e.blockNumber;
        e.timestamp = now - diff * blockMs;
      }
    }
  }

  return events;
}

/* -------- explorer fast path (when API key is present) -------- */

/*
 * The old query sent `module=account&action=tokentx` with NO address or
 * contract filter — the Etherscan family rejects that ("Missing address"),
 * so the fast path silently returned [] even with a key configured. Now we
 * ask for the recent transfers of the chain's curated high-volume tokens
 * (USDT/USDC/…) — dense, real whale flow, two requests per chain max.
 *
 * Etherscan V2 note: one ETHERSCAN_API_KEY now serves every supported chain
 * through https://api.etherscan.io/v2/api?chainid=N — used automatically as
 * the fallback when a chain-specific key is absent.
 */
async function explorerRequestUrl(chainId) {
  const exp = EXPLORERS[chainId];
  const ownKey = exp ? process.env[exp.keyEnv] : null;
  if (ownKey) return { api: exp.api, key: ownKey, chainParam: '' };
  const v2Key = process.env.ETHERSCAN_API_KEY;
  if (v2Key) return { api: 'https://api.etherscan.io/v2/api', key: v2Key, chainParam: `&chainid=${chainId}` };
  return null;
}

async function fetchWhalesExplorer(chainId, minValueUsd, priceLookup) {
  const conf = await explorerRequestUrl(chainId);
  if (!conf) return [];
  const cfg = EVM_CHAINS[chainId];
  const known = knownTokenMap(chainId);

  // Query the curated tokens with on-chain contracts (max 2 to protect the
  // key's rate limit) — stablecoins carry the densest whale flow.
  const contracts = (TOKENS[chainId] ?? []).filter((t) => t.address).slice(0, 2);
  if (!contracts.length) return [];

  const pages = await Promise.allSettled(contracts.map(async (tok) => {
    const url = `${conf.api}?module=account&action=tokentx&contractaddress=${tok.address}` +
      `&page=1&offset=100&sort=desc&apikey=${encodeURIComponent(conf.key)}${conf.chainParam}`;
    const { signal, done } = ctrlTimeout();
    try {
      const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`explorer ${res.status}`);
      const body = await res.json();
      if (body?.status !== '1' || !Array.isArray(body.result)) return [];
      return body.result;
    } finally {
      done();
    }
  }));
  const rows = [];
  for (const p of pages) if (p.status === 'fulfilled') rows.push(...p.value);
  if (!rows.length) return [];

  const seen = new Set();
  const out = [];
  for (const tx of rows) {
    const contract = String(tx.contractAddress || '').toLowerCase();
    const token = known.get(contract) ?? {
      symbol: (tx.tokenSymbol || '???').toUpperCase().slice(0, 10),
      name: tx.tokenName || 'Unknown Token',
      address: contract,
      decimals: Number(tx.tokenDecimal) || 18,
      coingeckoId: null,
      verified: false
    };
    const raw = BigInt(String(tx.value || '0'));
    if (raw === 0n) continue;
    const decimals = Number(tx.tokenDecimal) || token.decimals || 18;
    const divisor = 10n ** BigInt(decimals);
    const amount = Number(raw / divisor) + Number(raw % divisor) / Number(divisor);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const cgId = token.coingeckoId;
    const usdPrice = cgId ? priceLookup(cgId) : null;
    const valueUsd = usdPrice != null ? amount * usdPrice : null;
    if (valueUsd != null && valueUsd < minValueUsd) continue;

    const from = String(tx.from || '').toLowerCase();
    const to = String(tx.to || '').toLowerCase();
    const fromLabel = labelFor(chainId, from);
    const toLabel = labelFor(chainId, to);
    const zero = '0x0000000000000000000000000000000000000000';
    const isMint = from === zero;
    const isBurn = to === zero;
    const kind = classify(fromLabel, toLabel, from, to, isMint, isBurn, amount);
    const id = `${chainId}:${tx.hash}:${tx.transactionIndex ?? ''}:${tx.logIndex ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      chainId,
      chainShort: cfg.short,
      chainName: cfg.name,
      chainColor: cfg.color,
      kind,
      token: {
        symbol: token.symbol,
        name: token.name,
        address: contract,
        decimals,
        verified: Boolean(known.get(contract)),
        coingeckoId: cgId ?? null
      },
      amount,
      amountRaw: raw.toString(),
      valueUsd,
      usdPrice,
      from: { address: from, label: fromLabel?.label ?? null, short: short(from) },
      to: { address: to, label: toLabel?.label ?? null, short: short(to) },
      hash: tx.hash,
      blockNumber: Number(tx.blockNumber),
      txIndex: Number(tx.transactionIndex ?? 0),
      logIndex: Number(tx.logIndex ?? 0),
      timestamp: Number(tx.timeStamp) * 1000,
      explorerTx: explorerTxUrl(chainId, tx.hash),
      explorerFrom: explorerAddrUrl(chainId, from),
      explorerTo: explorerAddrUrl(chainId, to)
    });
  }
  return out;
}

/* -------- prices -------- */

/*
 * PRICE FALLBACK CHAIN — keyless sources that answer with different rate
 * limits and different IP reputations, tried in order. The old fallback
 * called `api.coinlore.net/api/prices/v2/ids/<coingecko-ids>` — an endpoint
 * that does not exist (Coinlore keys tickers by NUMERIC id) — so the moment
 * CoinGecko rate-limited, the "fallback" 404ed too, every event lost its
 * USD value, and the whole Smart Money page reported `unavailable`.
 */

/** CoinGecko id → ticker symbol for the symbol-keyed fallback sources. */
const CG_TO_SYMBOL = {
  ethereum: 'ETH',
  bitcoin: 'BTC',
  tether: 'USDT',
  'usd-coin': 'USDC',
  dai: 'DAI',
  binancecoin: 'BNB',
  'matic-network': 'POL',
  'avalanche-2': 'AVAX',
  arbitrum: 'ARB',
  optimism: 'OP',
  'pancakeswap-token': 'CAKE',
  'staked-ether': 'STETH'
};

/**
 * Major USD stablecoins. Used ONLY as the last-resort backstop so that the
 * bulk of whale flow (USDT/USDC/DAI transfers) stays priced through a full
 * market-data outage. $1.00 is the definitional value of these assets; a
 * de-peg deep enough to distort a whale feed is front-page news, and the
 * response still carries `priceSource` so the UI can disclose the basis.
 */
const PEGGED_USD = { tether: 1, 'usd-coin': 1, dai: 1 };

/** CryptoCompare keyless multi-price. `{ ETH: { USD: 4300 } }` shape in. */
async function fetchCryptoComparePrices(ids, vsCcy = 'usd') {
  const bySymbol = new Map(); // SYMBOL → [cgId, ...]
  for (const id of ids) {
    const sym = CG_TO_SYMBOL[id];
    if (!sym) continue;
    const list = bySymbol.get(sym) || [];
    list.push(id);
    bySymbol.set(sym, list);
  }
  if (!bySymbol.size) return {};
  const fsyms = [...bySymbol.keys()].join(',');
  const tsym = vsCcy.toUpperCase();
  const res = await fetch(
    `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${encodeURIComponent(fsyms)}&tsyms=${encodeURIComponent(tsym)}`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`cryptocompare ${res.status}`);
  const body = await res.json();
  const out = {};
  for (const [sym, cgIds] of bySymbol) {
    const p = Number(body?.[sym]?.[tsym]);
    if (!Number.isFinite(p) || p <= 0) continue;
    for (const id of cgIds) out[id] = { [vsCcy]: p };
  }
  return out;
}

/**
 * Coinbase keyless exchange-rates fallback — ONE request returns every rate
 * against USD; invert to get USD prices. Coinbase's public API allows very
 * generous keyless rates and (unlike some exchange APIs) answers from US
 * serverless IPs.
 */
async function fetchCoinbasePrices(ids, vsCcy = 'usd') {
  if (vsCcy !== 'usd') return {}; // rates are only meaningful against USD here
  const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`coinbase ${res.status}`);
  const body = await res.json();
  const rates = body?.data?.rates || {};
  const out = {};
  for (const id of ids) {
    const sym = CG_TO_SYMBOL[id];
    if (!sym) continue;
    const r = Number(rates[sym]);
    if (!Number.isFinite(r) || r <= 0) continue;
    out[id] = { [vsCcy]: 1 / r };
  }
  return out;
}

/*
 * PRICING WAS A SINGLE POINT OF FAILURE — THE ONE THAT KILLED THE FEED.
 * ---------------------------------------------------------------------------
 * The old version awaited `fetchSimplePrices` and let it throw. CoinGecko's
 * keyless public limit (a handful of calls/minute on a shared Vercel IP)
 * returns 429 exactly when the app is busy; the throw propagated out of
 * `fetchWhales`, `labelledEvents` swallowed it, and EVERY whale-based number
 * on the Smart Money page went to zero — «خیلی از داده‌ها کار نمی‌کند».
 *
 * Now: CoinGecko (retried once) → CryptoCompare → Coinbase, then the pegged
 * stablecoin backstop fills any gap for USDT/USDC/DAI so the dominant share
 * of whale flow stays priced through a full market-data outage. Only when
 * literally nothing priced anything does the response carry
 * `pricesOutage: true` so the UI says "no data" instead of "zero activity".
 */
async function priceLookupFor(vsCcy) {
  // Use the existing providers.js simple-price fetch so keys stay server-side
  // and caching is shared with every other market endpoint. Import lazily to
  // avoid a circular load during test setup.
  const { fetchSimplePrices } = await import('./providers.js');
  const cgIds = new Set();
  for (const cid of EVM_CHAIN_ORDER) {
    const cfg = EVM_CHAINS[cid];
    if (cfg?.native?.coingeckoId) cgIds.add(cfg.native.coingeckoId);
    for (const t of TOKENS[cid] ?? []) {
      if (t.coingeckoId) cgIds.add(t.coingeckoId);
    }
  }
  const ids = Array.from(cgIds);

  let prices = null;
  let source = null;
  for (let attempt = 0; attempt < 2 && !prices; attempt += 1) {
    try {
      const got = await fetchSimplePrices(ids, vsCcy);
      if (got && Object.keys(got).length) { prices = got; source = 'coingecko'; }
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!prices) {
    try {
      const cc = await fetchCryptoComparePrices(ids, vsCcy);
      if (cc && Object.keys(cc).length) { prices = cc; source = 'cryptocompare'; }
    } catch { /* try the next source */ }
  }
  if (!prices) {
    try {
      const cb = await fetchCoinbasePrices(ids, vsCcy);
      if (cb && Object.keys(cb).length) { prices = cb; source = 'coinbase'; }
    } catch { /* fall through to the pegged backstop */ }
  }

  const map = prices ? { ...prices } : {};
  // Backstop: fill any stablecoin gap at the definitional $1 peg so USDT/
  // USDC/DAI whale flow (most of it) survives a market-data outage.
  if (vsCcy === 'usd') {
    for (const [id, usd] of Object.entries(PEGGED_USD)) {
      if (ids.includes(id) && map[id]?.[vsCcy] == null) map[id] = { ...(map[id] || {}), [vsCcy]: usd };
    }
  }
  const anyPrice = Object.keys(map).length > 0;
  return {
    lookup: (cgId) => map[cgId]?.[vsCcy] ?? null,
    ok: anyPrice,
    source: source || (anyPrice ? 'pegged-stables' : 'none')
  };
}

/* -------- public entry -------- */

/** Race a promise against a deadline (timer is cleared either way). */
function withDeadline(promise, ms, tag = 'UPSTREAM') {
  let timer;
  const gate = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${tag}_TIMEOUT`)), ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer));
}

/**
 * Fetch a page of whale events across supported chains.
 *
 * @param {object} opts
 * @param {number} opts.minUsd       minimum value filter (applied to priced events)
 * @param {string[]} opts.chains     chain short names to include (default: all)
 * @param {string} opts.tokenQuery   case-insensitive token symbol/name substring
 * @param {number} opts.since        epoch ms — drop events older than this
 * @param {string} opts.vs           fiat vs_currency (e.g. 'usd', 'eur')
 * @param {number} opts.limit        max events to return
 */
export async function fetchWhales({
  minUsd = 100_000,
  chains = null,
  tokenQuery = '',
  since = 0,
  vs = 'usd',
  limit = 40
} = {}) {
  const selectedIds = chains?.length
    ? EVM_CHAIN_ORDER.filter((id) => chains.includes(EVM_CHAINS[id]?.short?.toLowerCase()) || chains.includes(String(id)))
    : EVM_CHAIN_ORDER;

  const { lookup: priceLookup, ok: pricesOk, source: priceSource } = await priceLookupFor(vs);

  // Fetch chains in parallel; tolerate partial failure per chain. Each chain
  // gets a hard deadline: walking 3 RPC endpoints × (blockNumber + getLogs +
  // retries) could otherwise take >60s for ONE dead chain — longer than the
  // client (and a serverless function) is willing to wait for ALL of them.
  const results = await Promise.allSettled(
    selectedIds.map((cid) => withDeadline((async () => {
      // Prefer explorer fast-path when configured; fall back to RPC logs.
      try {
        const fast = await fetchWhalesExplorer(cid, minUsd, priceLookup);
        if (fast.length) return fast;
      } catch { /* ignore */ }
      return fetchWhalesRpc(cid, minUsd, priceLookup);
    })(), 15_000, `CHAIN_${cid}`))
  );

  const failures = [];
  const all = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') all.push(...r.value);
    else failures.push(EVM_CHAINS[selectedIds[i]]?.short ?? String(selectedIds[i]));
  }

  // Dedup by id
  const seen = new Set();
  const deduped = [];
  for (const e of all) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    deduped.push(e);
  }

  // Apply filters.
  const q = String(tokenQuery || '').trim().toLowerCase();
  const filtered = deduped.filter((e) => {
    if (since && e.timestamp && e.timestamp < since) return false;
    if (q) {
      const hay = `${e.token.symbol} ${e.token.name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Sort by timestamp descending (newest first), unpriced last.
  filtered.sort((a, b) => {
    const av = a.valueUsd ?? -1;
    const bv = b.valueUsd ?? -1;
    if (av !== bv) return bv - av;
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });

  const pricedCount = filtered.filter((e) => e.valueUsd != null).length;
  return {
    schema: 'fbt.whales.v1',
    at: Date.now(),
    vs,
    minUsd,
    limit,
    total: filtered.length,
    pricedCount,
    partial: failures.length > 0 || pricedCount < filtered.length || !pricesOk,
    // True when no price source answered (CoinGecko AND Coinlore). Callers
    // and the UI can then report "no data" instead of "zero activity".
    pricesOutage: !pricesOk,
    priceSource: priceSource,
    failedChains: failures,
    events: filtered.slice(0, limit)
  };
}

/** Cached wrapper used by the route handler. */
export function cachedWhales(opts) {
  const key = `whales:${opts.vs || 'usd'}:${opts.minUsd || 0}:${(opts.chains || []).join(',')}:${opts.since || 0}`;
  return withCache(key, 60_000, () => fetchWhales(opts), memoryStore);
}
