import { PAYOUT_ADDRESSES } from './payout.js';
import { FEE_BPS as FBT_SWAP_FEE_BPS } from './feeBps.js';

/**
 * ECOSYSTEM DATA ADAPTER
 * ---------------------------------------------------------------------------
 * Maps real provider status data from `/api/providers/status` and the existing
 * ecosystem catalog endpoints into the UI structures the Ecosystem page needs.
 *
 * RULES:
 *   1. No hardcoded fake data. Everything derives from real API responses.
 *   2. If an API is unavailable, the UI says "unavailable" — never fakes it.
 *   3. Network metadata is a static registry (chain IDs are facts, not opinions).
 *   4. Provider categories and capabilities derive from the provider data itself.
 */

import { apiBase } from './apiBase.js';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS } from './chains.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

/**
 * Static network registry — chain IDs and their metadata are facts, not API data.
 * This is NOT fake data; it maps known chain IDs to human-readable names.
 */
export const NETWORK_REGISTRY = [
  { id: 'ethereum', name: 'Ethereum', chainId: 1, type: 'EVM', chainType: 'Mainnet', short: 'ETH', hue: '#627eea' },
  { id: 'polygon', name: 'Polygon', chainId: 137, type: 'EVM', chainType: 'Mainnet', short: 'POL', hue: '#8247e5' },
  { id: 'bnb', name: 'BNB Chain', chainId: 56, type: 'EVM', chainType: 'Mainnet', short: 'BNB', hue: '#f0b90b' },
  { id: 'arbitrum', name: 'Arbitrum', chainId: 42161, type: 'EVM', chainType: 'Layer 2', short: 'ARB', hue: '#28a0f0' },
  { id: 'optimism', name: 'Optimism', chainId: 10, type: 'EVM', chainType: 'Layer 2', short: 'OP', hue: '#ff0420' },
  { id: 'base', name: 'Base', chainId: 8453, type: 'EVM', chainType: 'Layer 2', short: 'BASE', hue: '#0052ff' },
  { id: 'avalanche', name: 'Avalanche', chainId: 43114, type: 'EVM', chainType: 'Mainnet', short: 'AVAX', hue: '#e84142' },
  { id: 'linea', name: 'Linea', chainId: 59144, type: 'EVM', chainType: 'Layer 2', short: 'LINEA', hue: '#6ce0e0' },
  { id: 'sonic', name: 'Sonic', chainId: 146, type: 'EVM', chainType: 'Mainnet', short: 'SONIC', hue: '#ff5722' },
  { id: 'mantle', name: 'Mantle', chainId: 5000, type: 'EVM', chainType: 'Layer 2', short: 'MNT', hue: '#f0b90b' },
  { id: 'berachain', name: 'Berachain', chainId: 80094, type: 'EVM', chainType: 'Mainnet', short: 'BERA', hue: '#a855f7' },
  { id: 'unichain', name: 'Unichain', chainId: 130, type: 'EVM', chainType: 'Layer 2', short: 'UNI', hue: '#ff007a' },
  { id: 'monad', name: 'Monad', chainId: 143, type: 'EVM', chainType: 'Mainnet', short: 'MON', hue: '#7c3aed' },
  { id: 'scroll', name: 'Scroll', chainId: 534352, type: 'EVM', chainType: 'Layer 2', short: 'SCR', hue: '#f1c27d' },
  { id: 'zksync-era', name: 'zkSync Era', chainId: 324, type: 'EVM', chainType: 'Layer 2', short: 'ZK', hue: '#8c8dfc' },
  { id: 'robinhood-chain', name: 'Robinhood Chain', chainId: 4663, type: 'EVM', chainType: 'Layer 2', short: 'HOOD', hue: '#00c805' },
  { id: 'solana', name: 'Solana', chainId: null, type: 'Non-EVM', chainType: 'Mainnet', short: 'SOL', hue: '#9945ff' }
];

/**
 * Provider → Ecosystem category mapping.
 * This maps the real provider IDs from providerStatus.js into ecosystem sections.
 *
 * The `fee` object carries the money relationship for THIS integration only.
 * It is deliberately not a marketing claim: `bps`/`receiver` mirror the values
 * the same modules read at run time (server/solanaOcean.js, server/gasless.js,
 * server/swapProxy.js, src/lib/openocean.js), `providerCutPercent` is the
 * provider's documented share of the referrer fee, and the UI only displays the
 * fee as live when `feeReady` came back true from /api/providers/status.
 */
const FBT_FEE_EVM = PAYOUT_ADDRESSES.evm;
const FBT_FEE_SOLANA = PAYOUT_ADDRESSES.solana;
const OPENOCEAN_CUT_PERCENT = 20;

const PROVIDER_CATEGORIES = {
  'kyberswap': {
    section: 'dex',
    name: 'KyberSwap',
    type: 'DEX / Aggregator',
    capabilities: ['read', 'quote', 'prepare', 'simulate', 'execute'],
    role: 'Swap routing aggregator across 9 chains',
    fee: { bps: FBT_SWAP_FEE_BPS, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: 0, revenueMode: 'swap' }
  },
  'openocean': {
    section: 'dex',
    name: 'OpenOcean',
    type: 'DEX / Aggregator',
    capabilities: ['read', 'quote', 'prepare', 'simulate', 'execute'],
    role: 'Multi-chain DEX aggregator',
    fee: { bps: FBT_SWAP_FEE_BPS, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: OPENOCEAN_CUT_PERCENT, revenueMode: 'swap' }
  },
  'velora': {
    section: 'dex',
    name: 'Velora',
    type: 'Price Source',
    capabilities: ['read', 'quote'],
    role: 'Price source (quote-only) — prices the swap, does not execute it',
    fee: { bps: FBT_SWAP_FEE_BPS, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: 0, revenueMode: 'swap-when-executable' }
  },
  '0x-gasless': {
    section: 'dex',
    name: '0x Gasless',
    type: 'DEX / Meta-Tx',
    capabilities: ['read', 'quote', 'prepare', 'execute'],
    role: 'Gasless swap execution',
    fee: { bps: FBT_SWAP_FEE_BPS, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: 0, revenueMode: 'gasless-swap' }
  },
  '0x-cross-chain': {
    section: 'bridge',
    name: '0x Cross-Chain',
    type: 'Cross-Chain Router',
    capabilities: ['read', 'quote', 'prepare', 'execute'],
    role: 'Cross-chain swap routing',
    fee: { bps: 30, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: 0, revenueMode: 'bridge' }
  },
  'lifi': {
    section: 'bridge',
    name: 'LI.FI',
    type: 'Bridge Aggregator',
    capabilities: ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'],
    role: 'Bridge and DEX aggregation',
    fee: { bps: 30, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: 0, revenueMode: 'bridge' }
  },
  'debridge-dln': {
    section: 'bridge',
    name: 'deBridge DLN',
    type: 'Bridge Protocol',
    capabilities: ['read', 'quote', 'prepare', 'execute', 'verify'],
    role: 'Cross-chain liquidity network',
    fee: { bps: 40, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: 0, revenueMode: 'bridge' }
  },
  'thorchain': {
    section: 'bridge',
    name: 'THORChain',
    type: 'Cross-Chain Protocol',
    capabilities: ['read', 'quote', 'prepare', 'execute'],
    role: 'Cross-chain native asset swaps',
    fee: { bps: FBT_SWAP_FEE_BPS, receiver: FBT_FEE_EVM, family: 'evm', providerCutPercent: 0, revenueMode: 'bridge-when-thorname' }
  },
  'solana-openocean': {
    section: 'dex',
    name: 'OpenOcean (Solana)',
    type: 'DEX / Aggregator',
    capabilities: ['read', 'quote', 'prepare', 'execute'],
    role: 'Solana DEX aggregation',
    fee: { bps: FBT_SWAP_FEE_BPS, receiver: FBT_FEE_SOLANA, family: 'solana', providerCutPercent: OPENOCEAN_CUT_PERCENT, revenueMode: 'swap' }
  },
  'goplus-token-risk': { section: 'data', name: 'GoPlus', type: 'Security / Token Risk', capabilities: ['read'], role: 'Token security analysis' }
};

/** Market & data infrastructure — known data sources */
const DATA_INFRASTRUCTURE = [
  { id: 'coingecko', name: 'CoinGecko', type: 'Market Data', category: 'Market Data', purpose: 'Price feeds, market data, coin metadata', hue: '#00e676' },
  { id: 'geckoterminal', name: 'GeckoTerminal', type: 'DEX Analytics', category: 'Market Data', purpose: 'DEX pool analytics and charts', hue: '#18ffff' },
  { id: 'defillama', name: 'DefiLlama', type: 'Protocol Data', category: 'Analytics', purpose: 'Independent protocol TVL and revenue data', hue: '#2172e5' },
  { id: 'dexscreener', name: 'DEX Screener', type: 'DEX Charts', category: 'Market Data', purpose: 'Live charts for any trading pair', hue: '#ff5c00' },
  { id: 'bscscan', name: 'BscScan', type: 'Block Explorer', category: 'Indexer', purpose: 'Transaction verification on BNB Chain', hue: '#7c4dff' }
];

/** Wallet integrations */
const WALLET_INTEGRATIONS = [
  { id: 'metamask', name: 'MetaMask', type: 'Browser Wallet', purpose: 'Most widely used EVM wallet', hue: '#ff6d00' },
  { id: 'trust', name: 'Trust Wallet', type: 'Mobile Wallet', purpose: 'Mobile-first, BSC native wallet', hue: '#00e5ff' },
  { id: 'walletconnect', name: 'WalletConnect', type: 'Wallet Protocol', purpose: 'Connect any wallet via QR/URI', hue: '#3b99fc' },
  { id: 'rabby', name: 'Rabby', type: 'Browser Wallet', purpose: 'Transaction simulation wallet', hue: '#8697ff' },
  { id: 'safe', name: 'Safe', type: 'Multisig Wallet', purpose: 'Multi-signature wallet', hue: '#12ff80' }
];

/** AI / Intelligence infrastructure */
const AI_INFRASTRUCTURE = [
  { id: 'intent-os', name: 'FBT Intent OS', purpose: 'AI Financial Intelligence & Execution Orchestration', capabilities: ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'], section: 'ai' },
  { id: 'central-brain', name: 'Central Intelligence', purpose: 'Unified decision engine across all modules', capabilities: ['read', 'quote', 'prepare', 'simulate'], section: 'ai' },
  { id: 'risk-engine', name: 'Risk Engine', purpose: 'Token security analysis and risk scoring', capabilities: ['read'], section: 'ai' },
  { id: 'router-engine', name: 'Router Engine', purpose: 'Optimal route finding across DEX and bridge liquidity', capabilities: ['read', 'quote', 'prepare', 'simulate'], section: 'ai' }
];

/**
 * Fetch provider status from the real API.
 */
export async function fetchProviderStatus({ timeout = 8000 } = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(`${API_BASE}/providers/status`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' }
    });
    clearTimeout(timer);
    if (!res.ok) return { status: 'error', data: null };
    const data = await res.json();
    return { status: 'success', data };
  } catch {
    return { status: 'error', data: null };
  }
}

/** At most one upstream probe per minute per browser session. */
let lastProbeAt = 0;
let lastProbeBody = null;

/**
 * Ask the server to re-check the fee-earning DEX/liquidity sources with one
 * small real call each. This is what turns `reachable` from false to true on a
 * fresh server instance; it is POST, read-only, and never signs anything.
 *
 * Returns the probe response body (the per-provider `ok` evidence) or `null`
 * when the probe could not be run. The same evidence is re-used for the rest
 * of the browser session, so opening /ecosystem again within a minute keeps
 * showing the result instead of dropping back to 0/N.
 */
export async function probeProviderStatuses({ timeout = 30000, force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastProbeAt < 60000) return lastProbeBody;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(`${API_BASE}/providers/probe`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = await res.json();
    lastProbeAt = Date.now();
    lastProbeBody = body || null;
    return lastProbeBody;
  } catch {
    return null;
  }
}

/* ─── Browser-side liveness probe ─────────────────────────────────────────────
 * The server probe above is the preferred evidence, but on a serverless host
 * the instance that answers /providers/status is frequently not the one that
 * ran the probe, and datacenter egress to some aggregators is throttled. The
 * result was an Ecosystem card stuck on "0/5 DEX sources" while the swap page
 * — running in the SAME browser — was quoting through those very providers.
 *
 * So the browser asks the same question itself: one tiny quote per provider,
 * through the exact endpoints the swap/bridge screens already use (direct
 * upstream first for the keyless aggregators, our own same-origin routes for
 * the rest). A provider only counts as reachable when it returned a real
 * quote/registration; nothing is signed, broadcast or stored.
 */
const PROBE_USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PROBE_WETH_BASE = '0x4200000000000000000000000000000000000006';
const PROBE_USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const PROBE_USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const PROBE_USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const PROBE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const PROBE_USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PROBE_TAKER = PAYOUT_ADDRESSES.evm;
const PROBE_CHAIN_IDS = {
  kyberswap: [8453],
  openocean: [8453],
  velora: [8453],
  '0x-gasless': [56],
  'solana-openocean': ['solana'],
  lifi: [],
  'debridge-dln': [8453, 42161],
  '0x-cross-chain': []
};

/**
 * Per-network evidence out of a probe body.
 *
 * The network lights used to be derived from the PROVIDER evidence (a chain
 * was counted as covered when a provider that advertises it was reachable
 * somewhere), which is why every network sat at PARTIAL: a network whose only
 * probe was on Base was being judged against all seven providers that list it.
 * A chain is now judged by what was actually attempted ON THAT CHAIN — the
 * `chains[]` array both probe paths emit — so "probed" and "answered" are two
 * different, honest numbers.
 *
 * Older bodies (and the unit fixtures) carry only `results[].chainIds`, so
 * that shape is still understood and converted rather than ignored.
 */
export function chainsFromProbe(probe) {
  const explicit = Array.isArray(probe?.chains) ? probe.chains : [];
  const map = new Map();
  const add = (chain, provider, ok) => {
    if (chain == null || !provider) return;
    const key = String(chain);
    const entry = map.get(key) || { chain, providers: new Map() };
    entry.providers.set(provider, Boolean(entry.providers.get(provider) || ok));
    map.set(key, entry);
  };
  for (const row of explicit) {
    /* Two shapes speak here, deliberately: the aggregated row the probe bodies
       publish ({chain, probed, ready, sources[]}) and the single-source row the
       server walk emits ({chain, provider, ok, status}). A decoder that only
       understood the first silently dropped every network the server had
       proven — the exact failure this function exists to prevent. */
    if (row?.provider) {
      add(row.chain, row.provider, row.ok);
      continue;
    }
    for (const source of row?.sources || []) add(row?.chain, source?.provider, source?.ok);
  }
  for (const r of Array.isArray(probe?.results) ? probe.results : []) {
    const okSet = new Set((r?.okChainIds || (r?.ok ? r?.chainIds : []) || []).map(String));
    for (const chain of r?.chainIds || []) add(chain, r.provider, okSet.has(String(chain)));
  }
  return map;
}

async function probeFetchJson(url, { timeout = 12000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', ...headers } });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Try the direct upstream first, then our same-origin proxy; ok if either passes `accept`. */
async function probeEither(provider, attempts) {
  for (const { url, headers, accept } of attempts) {
    const r = await probeFetchJson(url, { headers });
    if (r.ok && (!accept || accept(r.body))) return { provider, ok: true, status: r.status, via: url.startsWith('http') ? 'direct' : 'proxy' };
  }
  return { provider, ok: false };
}

/* ─── Browser-side per-network walk ──────────────────────────────────────────
 * Provider probes answer "does this integration answer?" on ONE chain each
 * (Base for KyberSwap/OpenOcean/Velora, BSC for the gasless path, Arbitrum for
 * DLN). The network chips need the other half: "does this CHAIN have a route?"
 * — and the browser, not the datacenter, is where that question gets an
 * honest answer when an aggregator's edge filters server egress.
 *
 * One LI.FI same-chain quote per EVM network, sent from the user's own
 * connection, no fee parameters (a plain quote — see the note in
 * server/providerProbe.js for why the fee-gated one must not be the probe).
 * LI.FI is the source the app itself uses on the five networks where Kyber and
 * OpenOcean cannot route, and its public API is callable from a browser, so a
 * single call covers the chains the provider probes never touch.
 *
 * A call that never reached a server (CORS, DNS, a blocked host — status 0)
 * records NOTHING: "we could not ask" is not evidence that a chain is down,
 * and turning it into a failure would paint healthy networks yellow.
 */
const WALK_STABLES = ['USDC', 'USDT', 'USDG', 'HONEY'];

function walkTokens(chainId) {
  const list = TOKENS[Number(chainId)] || [];
  const stable = WALK_STABLES
    .map((symbol) => list.find((t) => t.symbol === symbol && t.address))
    .find(Boolean);
  const native = EVM_CHAINS[Number(chainId)]?.native?.symbol || null;
  return stable && native ? { from: stable.address, to: native } : null;
}

/** The same bounded-parallelism walk the server probe runs, for the browser. */
async function probeChainsFromBrowser({ budgetMs = 9000, limit = 4 } = {}) {
  const started = Date.now();
  const queue = [...EVM_CHAIN_ORDER];
  const rows = [];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      if (Date.now() - started > budgetMs) return;
      const chainId = queue.shift();
      if (chainId == null) return;
      const pair = walkTokens(chainId);
      if (!pair) continue;
      const qs = new URLSearchParams({
        fromChain: String(chainId),
        toChain: String(chainId),
        fromToken: pair.from,
        toToken: pair.to,
        fromAmount: '1000000',
        fromAddress: PROBE_TAKER,
        toAddress: PROBE_TAKER,
        slippage: '0.005'
      });
      const r = await probeFetchJson(`https://li.quest/v1/quote?${qs.toString()}`, { timeout: 9000 });
      /* status 0 = the request never reached LI.FI (CORS/DNS/filtered). No
         verdict from upstream is not a verdict about the chain. */
      if (!r.status) continue;
      rows.push({
        chain: chainId,
        sources: [{ provider: 'lifi', ok: Boolean(r.ok && r.body?.estimate?.toAmount) }]
      });
    }
  });
  await Promise.all(workers);
  return rows;
}

let lastBrowserProbeAt = 0;
let lastBrowserProbeBody = null;

export async function probeProvidersFromBrowser({ force = false } = {}) {
  const now = Date.now();
  if (!force && lastBrowserProbeBody && now - lastBrowserProbeAt < 60000) return lastBrowserProbeBody;
  const api = apiBase();

  const kyberQs = new URLSearchParams({ tokenIn: PROBE_USDC_BASE, tokenOut: PROBE_WETH_BASE, amountIn: '1000000', gasInclude: 'true' }).toString();
  const ooQs = new URLSearchParams({ inTokenAddress: PROBE_USDC_BASE, outTokenAddress: PROBE_WETH_BASE, amountDecimals: '1000000', gasPriceDecimals: '5000000000', slippage: '0.5' }).toString();
  const veloraQs = new URLSearchParams({ srcToken: PROBE_USDC_BASE, destToken: PROBE_WETH_BASE, amount: '1000000', srcDecimals: '6', destDecimals: '18', side: 'SELL', network: '8453', partner: 'fbtswap' }).toString();
  const gaslessQs = new URLSearchParams({ chainId: '56', sellToken: PROBE_USDT_BSC, buyToken: PROBE_USDC_BSC, sellAmount: '1000000000000000000', taker: PROBE_TAKER }).toString();
  const solQs = new URLSearchParams({ inputMint: PROBE_SOL_MINT, outputMint: PROBE_USDC_SOL, amount: '1000000' }).toString();
  const dlnQs = new URLSearchParams({ srcChainId: '8453', dstChainId: '42161', srcChainTokenIn: PROBE_USDC_BASE, dstChainTokenOut: PROBE_USDC_ARB, srcChainTokenInAmount: '1000000' }).toString();

  /* The provider probes and the per-network walk are independent questions;
     asking them at the same time keeps the page's wait to the slower one. */
  const settledPromise = Promise.allSettled([
    probeEither('kyberswap', [
      { url: `https://aggregator-api.kyberswap.com/base/api/v1/routes?${kyberQs}`, headers: { 'x-client-id': 'fbt-swap' }, accept: (b) => b && b.code === 0 && b.data?.routeSummary },
      { url: `${api}/swap/kyber/routes?chainId=8453&${kyberQs}`, accept: (b) => b && b.code === 0 && b.data?.routeSummary }
    ]),
    probeEither('openocean', [
      { url: `https://open-api.openocean.finance/v4/base/quote?${ooQs}`, accept: (b) => b && b.code === 200 && b.data },
      { url: `${api}/swap/oo/quote?chainId=8453&${ooQs}`, accept: (b) => b && b.code === 200 && b.data }
    ]),
    probeEither('velora', [
      { url: `https://api.velora.xyz/prices?${veloraQs}`, accept: (b) => Boolean(b?.priceRoute) },
      { url: `${api}/swap/velora/prices?${veloraQs}`, accept: (b) => Boolean(b?.priceRoute) }
    ]),
    probeEither('0x-gasless', [
      { url: `${api}/gasless/price?${gaslessQs}`, accept: (b) => b && !b.error }
    ]),
    probeEither('solana-openocean', [
      { url: `${api}/solana/oo/quote?${solQs}`, accept: (b) => b && !b.error }
    ]),
    probeEither('lifi', [
      { url: `${api}/bridge/status`, accept: (b) => Boolean(b?.registered) }
    ]),
    probeEither('debridge-dln', [
      { url: `${api}/dln/quote?${dlnQs}`, accept: (b) => b && !b.error }
    ]),
    probeEither('0x-cross-chain', [
      { url: `${api}/xchain/probe`, accept: (b) => b && b.configured === true && Number(b.httpStatus) >= 200 && Number(b.httpStatus) < 400 }
    ])
  ]);

  const [settled, walkRows] = await Promise.all([settledPromise, probeChainsFromBrowser()]);

  const body = {
    schema: 'fbt.provider-probe.browser.v1',
    generatedAt: new Date().toISOString(),
    results: settled.map((r) => {
      const result = r.status === 'fulfilled' ? r.value : { ok: false, error: 'PROBE_INTERNAL' };
      const chainIds = PROBE_CHAIN_IDS[result.provider] || [];
      return { ...result, chainIds, okChainIds: result.ok ? chainIds : [] };
    })
  };
  /* The per-network view, derived once so the server body and this one carry
     the same shape and `mergeProbeEvidence` has a single path to merge. The
     provider evidence and the per-chain walk are unioned entry-by-entry: a
     chain probed by both keeps ONE row, and "ok" wins, so a CORS-blocked
     walk can never downgrade a chain that a provider probe just reached. */
  const chainMap = chainsFromProbe(body);
  for (const row of walkRows) {
    const entry = chainMap.get(String(row.chain)) || { chain: row.chain, providers: new Map() };
    for (const source of row.sources) {
      entry.providers.set(source.provider, Boolean(entry.providers.get(source.provider) || source.ok));
    }
    chainMap.set(String(row.chain), entry);
  }
  body.chains = [...chainMap.values()].map(({ chain, providers }) => {
    const sources = [...providers.entries()].map(([provider, ok]) => ({ provider, ok }));
    return { chain, probed: sources.length, ready: sources.filter((s) => s.ok).length, sources };
  });
  lastBrowserProbeAt = Date.now();
  lastBrowserProbeBody = body;
  return body;
}

/** Union of several probe bodies: a provider is ok when ANY probe reached it. */
export function mergeProbeEvidence(...probes) {
  const list = probes.filter((p) => p && (Array.isArray(p.results) || Array.isArray(p.chains)));
  if (list.length === 0) return null;
  const byId = new Map();
  let generatedAt = null;
  for (const p of list) {
    if (p.generatedAt && (!generatedAt || p.generatedAt > generatedAt)) generatedAt = p.generatedAt;
    for (const r of p.results || []) {
      if (!r?.provider) continue;
      const prev = byId.get(r.provider);
      if (!prev) {
        byId.set(r.provider, r);
        continue;
      }
      const preferred = !prev.ok && r.ok ? r : prev;
      const chainIds = [...new Set([
        ...(Array.isArray(prev.chainIds) ? prev.chainIds : []),
        ...(Array.isArray(r.chainIds) ? r.chainIds : [])
      ])];
      const okChainIds = [...new Set([
        ...(Array.isArray(prev.okChainIds) ? prev.okChainIds : (prev.ok ? prev.chainIds : []) || []),
        ...(Array.isArray(r.okChainIds) ? r.okChainIds : (r.ok ? r.chainIds : []) || [])
      ])];
      byId.set(r.provider, { ...preferred, chainIds, okChainIds });
    }
  }

  /* Network evidence: one entry per chain, "ok" winning over a failure so a
     provider that answered through any path is counted as having answered. */
  const chainMap = new Map();
  for (const p of list) {
    for (const [key, { chain, providers }] of chainsFromProbe(p)) {
      const entry = chainMap.get(key) || { chain, providers: new Map() };
      for (const [provider, ok] of providers) {
        entry.providers.set(provider, Boolean(entry.providers.get(provider) || ok));
      }
      chainMap.set(key, entry);
    }
  }
  const chains = [...chainMap.values()].map(({ chain, providers }) => {
    const sources = [...providers.entries()].map(([provider, ok]) => ({ provider, ok }));
    return { chain, probed: sources.length, ready: sources.filter((s) => s.ok).length, sources };
  });

  return {
    schema: 'fbt.provider-probe.merged.v2',
    generatedAt,
    results: [...byId.values()],
    chains
  };
}

/**
 * Merge the live probe evidence into the standard status report.
 *
 * A `/providers/status` read is cached and, on serverless hosts, may be served
 * by a different instance than the one that just recorded the probe, so the
 * only reliable place to apply "we actually just reached KyberSwap / LI.FI"
 * is here, from the probe body the client just received. This keeps the
 * Ecosystem page honest: a provider only becomes OPERATIONAL when the probe
 * reported a real success, never merely because it is configured.
 */
export function applyProbeEvidence(providerReport, probe) {
  if (!providerReport || providerReport.status !== 'success' || !Array.isArray(probe?.results)) {
    return providerReport;
  }

  /* Attempted chains and answered chains, kept apart: a probe that failed on a
     chain must not look like a probe that succeeded there, and it must not look
     like no probe at all. */
  const byId = new Map();
  for (const r of probe.results || []) {
    if (!r?.provider) continue;
    const prev = byId.get(r.provider) || { chainIds: [], okChainIds: [] };
    const okList = Array.isArray(r.okChainIds) ? r.okChainIds : (r.ok ? r.chainIds : []) || [];
    byId.set(r.provider, {
      chainIds: [...new Set([...prev.chainIds, ...(Array.isArray(r.chainIds) ? r.chainIds : [])])],
      okChainIds: [...new Set([...prev.okChainIds, ...okList])]
    });
  }
  if (byId.size === 0) return providerReport;

  const data = providerReport.data || {};
  const providers = (data.providers || []).map((p) => {
    const ev = byId.get(p.id);
    if (!ev) return p;
    const answered = ev.okChainIds.length > 0;
    return {
      ...p,
      probeChainIds: [...new Set([...(Array.isArray(p.probeChainIds) ? p.probeChainIds : []), ...ev.chainIds])],
      probeOkChainIds: [...new Set([...(Array.isArray(p.probeOkChainIds) ? p.probeOkChainIds : []), ...ev.okChainIds])],
      ...(answered
        ? {
          // A successful tiny quote is direct evidence of both fields — and it
          // is the opposite of the "configured ⇒ reachable" shortcut the status
          // module deliberately avoids. A chain probe that FAILED changes
          // nothing here: one chain refusing a quote is not an outage.
          configured: true,
          reachable: true,
          authenticated: true,
          feeReady: p.feeReady == null ? true : p.feeReady,
          lastSuccessAt: probe.generatedAt || data.generatedAt || p.lastSuccessAt,
          lastFailureAt: null,
          lastError: null,
          retryable: false
        }
        : {})
    };
  });

  return {
    ...providerReport,
    data: {
      ...data,
      providers,
      generatedAt: probe.generatedAt || data.generatedAt
    }
  };
}

/**
 * Build the complete ecosystem data from real API responses.
 * Returns all sections needed by the UI.
 */
export function buildEcosystemData(providerReport, probeEvidence) {
  if (!providerReport || providerReport.status !== 'success') {
    return { status: 'unavailable', sections: null, summary: null };
  }

  const report = (applyProbeEvidence(providerReport, probeEvidence) || providerReport).data;
  const providers = report?.providers || [];
  const routeProviders = providers.filter((provider) => ['dex', 'bridge'].includes(PROVIDER_CATEGORIES[provider.id]?.section));
  const supportsNetwork = (provider, network) => (provider.supportedChains || []).some((chain) =>
    network.id === 'solana' ? String(chain).toLowerCase() === 'solana' : Number(chain) === Number(network.chainId)
  );
  /* Attempted on this chain — the set behind the provider card's per-network
     list. Deliberately NOT "answered": a chain we asked about and got nothing
     back is the most useful thing the card can say, and hiding it would make
     the probe look like it never ran. */
  const attemptedNetwork = (provider, network) => {
    const attempts = [
      ...(Array.isArray(provider.probeChainIds) ? provider.probeChainIds : []),
      ...(Array.isArray(provider.probeOkChainIds) ? provider.probeOkChainIds : [])
    ];
    return attempts.some((chain) =>
      network.id === 'solana' ? String(chain).toLowerCase() === 'solana' : Number(chain) === Number(network.chainId)
    );
  };

  /* Network evidence, keyed the way the probe bodies spell a chain: the numeric
     chain id for EVM, the string 'solana' otherwise. */
  const chainEvidence = chainsFromProbe(probeEvidence);
  /* `chainsFromProbe` hands back the per-chain Map (the shape both probe bodies
     and `mergeProbeEvidence` work with), so the two numbers the light needs are
     counted here rather than assumed to be fields on the entry. */
  const evidenceFor = (network) => {
    const entry = chainEvidence.get(String(network.id === 'solana' ? 'solana' : network.chainId));
    if (!entry) return null;
    const outcomes = [...entry.providers.values()];
    return { probed: outcomes.length, ready: outcomes.filter(Boolean).length };
  };

  // Map providers to ecosystem sections
  const dex = [];
  const bridges = [];
  const dataProviders = [];

  for (const provider of providers) {
    const meta = PROVIDER_CATEGORIES[provider.id];
    if (!meta) continue;

    const networks = NETWORK_REGISTRY.filter((network) => supportsNetwork(provider, network));
    const probeNetworks = NETWORK_REGISTRY.filter((network) => attemptedNetwork(provider, network));

    const entry = {
      id: provider.id,
      name: meta.name,
      type: meta.type,
      section: meta.section,
      role: meta.role,
      capabilities: meta.capabilities,
      networks,
      networkIds: networks.map(n => n.id),
      probeNetworks,
      probeChainIds: Array.isArray(provider.probeChainIds) ? provider.probeChainIds : [],
      probeOkChainIds: Array.isArray(provider.probeOkChainIds) ? provider.probeOkChainIds : [],
      configured: provider.configured,
      reachable: provider.reachable,
      authenticated: provider.authenticated,
      feeReady: provider.feeReady,
      lastSuccessAt: provider.lastSuccessAt,
      lastFailureAt: provider.lastFailureAt,
      fee: deriveFee(meta, provider),
      hue: getHue(provider.id)
    };

    // Determine status
    entry.status = deriveStatus(provider);

    if (meta.section === 'dex') dex.push(entry);
    else if (meta.section === 'bridge') bridges.push(entry);
    else if (meta.section === 'data') dataProviders.push(entry);
  }

  /*
   * ─── WHAT A NETWORK LIGHT MEANS NOW ────────────────────────────────────────
   * It is judged ONLY by probes attempted on that chain:
   *
   *   OPERATIONAL  at least one routing source answered a real quote here.
   *   DEGRADED     probes were attempted here and none answered (retryable).
   *   UNKNOWN      nothing has been probed on this chain yet.
   *
   * The old rule compared the chains that answered against EVERY provider that
   * advertises the network, so a chain with three successful probes and seven
   * advertised sources could only ever be PARTIAL — which is what every network
   * on the page was showing. An unprobed provider is not a failing one; it is
   * simply not evidence, and it no longer counts against the light.
   *
   * `supportedProviderCount` is still the advertised set, because that is what
   * the chip's tooltip says it is.
   */
  const activeNetworks = NETWORK_REGISTRY.filter((network) =>
    routeProviders.some((provider) => supportsNetwork(provider, network))
  ).map((network) => {
    const supporting = routeProviders.filter((provider) => supportsNetwork(provider, network));
    const evidence = evidenceFor(network);
    const probedProviderCount = evidence ? evidence.probed : 0;
    const reachableProviderCount = evidence ? evidence.ready : 0;
    const status = reachableProviderCount > 0 ? 'OPERATIONAL'
      : probedProviderCount > 0 ? 'DEGRADED' : 'UNKNOWN';
    return {
      ...network,
      status,
      supportedProviderCount: supporting.length,
      probedProviderCount,
      reachableProviderCount,
      capabilities: getNetworkCapabilities(network.id, routeProviders)
    };
  });

  // Summary
  const totalProviders = providers.length;
  const configuredCount = providers.filter(p => p.configured).length;
  const reachableCount = providers.filter(p => p.reachable).length;

  const summary = {
    networks: {
      total: activeNetworks.length,
      operational: activeNetworks.filter((network) => network.status === 'OPERATIONAL').length,
      /* Probed on this chain and nothing answered — the honest replacement for
         the old "PARTIAL", which also covered "nobody asked". */
      partial: activeNetworks.filter((network) => network.status === 'DEGRADED').length,
      unverified: activeNetworks.filter((network) => network.status === 'UNKNOWN').length,
      observed: activeNetworks.filter((network) => network.probedProviderCount > 0).length
    },
    dex: {
      total: dex.length,
      operational: dex.filter((provider) => provider.status === 'OPERATIONAL').length,
      observed: dex.filter((provider) => provider.status !== 'UNKNOWN').length
    },
    bridges: {
      total: bridges.length,
      operational: bridges.filter((provider) => provider.status === 'OPERATIONAL').length,
      observed: bridges.filter((provider) => provider.status !== 'UNKNOWN').length
    },
    providers: { total: totalProviders, configured: configuredCount, reachable: reachableCount },
    dataInfra: { total: DATA_INFRASTRUCTURE.length, operational: 0, observed: 0 },
    generatedAt: report?.generatedAt || new Date().toISOString()
  };

  return {
    status: 'live',
    sections: {
      networks: activeNetworks,
      dex,
      bridges,
      dataProviders,
      dataInfrastructure: DATA_INFRASTRUCTURE.map((item) => ({ ...item, status: 'UNKNOWN' })),
      wallets: WALLET_INTEGRATIONS.map((item) => ({ ...item, status: 'UNKNOWN' })),
      ai: AI_INFRASTRUCTURE.map((item) => ({ ...item, status: 'UNKNOWN' }))
    },
    summary,
    healthRatio: report?.summary?.healthRatio ?? 0,
    generatedAt: report?.generatedAt
  };
}

function deriveFee(meta, provider) {
  const base = meta?.fee;
  if (!base || !provider) return null;
  // Prefer the fee facts reported by the server (/api/providers/status) where
  // available: they are read from the same env the modules use, so a server
  // override (e.g. ZEROX_FEE_RECIPIENT) is never hidden by a build-time label.
  const live = provider.facts?.fee || base;
  const cut = Number(live.providerCutPercent ?? (base.providerCutPercent || 0));
  const bps = Number(live.bps ?? (base.bps || 0));
  const receiver = live.receiver || base.receiver || null;
  const netBps = Number(live.netBps ?? (bps * (1 - cut / 100)).toFixed(2));
  return {
    configured: Boolean(provider.configured),
    ready: Boolean(provider.feeReady),
    active: Boolean(provider.configured && provider.feeReady),
    bps,
    percent: Number((bps / 100).toFixed(2)),
    receiver,
    family: live.family || base.family || null,
    providerCutPercent: cut,
    netBps,
    revenueMode: base.revenueMode || null
  };
}

function deriveStatus(provider) {
  if (!provider.configured) return 'OFFLINE';
  const now = Date.now();
  const successAt = provider.lastSuccessAt ? Date.parse(provider.lastSuccessAt) : NaN;
  const failureAt = provider.lastFailureAt ? Date.parse(provider.lastFailureAt) : NaN;
  const successFresh = Number.isFinite(successAt) && successAt <= now && now - successAt <= 15 * 60_000;
  const failureFresh = Number.isFinite(failureAt) && failureAt <= now && now - failureAt <= 15 * 60_000;
  if (provider.reachable && successFresh && (!Number.isFinite(failureAt) || successAt >= failureAt)) return 'OPERATIONAL';
  if (failureFresh) return 'DEGRADED';
  return 'UNKNOWN';
}

function getHue(providerId) {
  const hues = {
    'kyberswap': '#00ff9d',
    'openocean': '#00bcd4',
    'velora': '#ff9800',
    '0x-gasless': '#ff007a',
    '0x-cross-chain': '#ff007a',
    'lifi': '#ff6b35',
    'debridge-dln': '#00d4aa',
    'thorchain': '#00ccff',
    'solana-openocean': '#9945ff',
    'goplus-token-risk': '#4caf50'
  };
  return hues[providerId] || '#7c4dff';
}

function getNetworkCapabilities(networkId, providers) {
  const caps = new Set();
  for (const p of providers) {
    const meta = PROVIDER_CATEGORIES[p.id];
    if (!meta) continue;
    const supportsNetwork = p.supportedChains?.some(c => {
      if (networkId === 'solana') return String(c).toLowerCase() === 'solana';
      const net = NETWORK_REGISTRY.find(n => n.id === networkId);
      return net && Number(c) === Number(net.chainId);
    });
    if (supportsNetwork) {
      if (meta.section === 'dex') caps.add('Swap');
      if (meta.section === 'bridge') caps.add('Bridge');
      if (meta.section === 'data') caps.add('Security');
    }
  }
  // Solana-specific capabilities
  if (networkId === 'solana') {
    caps.add('Wallet');
    caps.add('Token Analysis');
  }
  return [...caps];
}

/** Two-letter monogram for logo fallback */
export function monogram(name) {
  return String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
}
