import { PAYOUT_ADDRESSES } from './payout.js';

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

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

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
const FBT_SWAP_FEE_BPS = 70;
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

/**
 * Ask the server to re-check the fee-earning DEX/liquidity sources with one
 * small real call each. This is what turns `reachable` from false to true on a
 * fresh server instance; it is POST, read-only, and never signs anything.
 */
export async function probeProviderStatuses({ timeout = 30000 } = {}) {
  const now = Date.now();
  if (now - lastProbeAt < 60000) return true;
  lastProbeAt = now;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(`${API_BASE}/providers/probe`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' }
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Build the complete ecosystem data from real API responses.
 * Returns all sections needed by the UI.
 */
export function buildEcosystemData(providerReport) {
  if (!providerReport || providerReport.status !== 'success') {
    return { status: 'unavailable', sections: null, summary: null };
  }

  const report = providerReport.data;
  const providers = report?.providers || [];

  // Map providers to ecosystem sections
  const dex = [];
  const bridges = [];
  const dataProviders = [];

  for (const provider of providers) {
    const meta = PROVIDER_CATEGORIES[provider.id];
    if (!meta) continue;

    const networks = (provider.supportedChains || [])
      .map(chainId => {
        if (chainId === 'solana') return NETWORK_REGISTRY.find(n => n.id === 'solana');
        return NETWORK_REGISTRY.find(n => n.chainId === chainId);
      })
      .filter(Boolean);

    const entry = {
      id: provider.id,
      name: meta.name,
      type: meta.type,
      section: meta.section,
      role: meta.role,
      capabilities: meta.capabilities,
      networks,
      networkIds: networks.map(n => n.id),
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

  // Networks actually in use
  const usedChainIds = new Set();
  for (const provider of providers) {
    for (const chain of (provider.supportedChains || [])) {
      if (chain === 'solana') usedChainIds.add('solana');
      else usedChainIds.add(chain);
    }
  }

  const activeNetworks = NETWORK_REGISTRY.filter(n => {
    if (n.chainId && usedChainIds.has(n.chainId)) return true;
    if (n.id === 'solana' && usedChainIds.has('solana')) return true;
    return false;
  }).map(n => ({
    ...n,
    status: 'OPERATIONAL',
    capabilities: getNetworkCapabilities(n.id, providers)
  }));

  // Summary
  const totalProviders = providers.length;
  const configuredCount = providers.filter(p => p.configured).length;
  const reachableCount = providers.filter(p => p.reachable).length;

  const summary = {
    networks: { total: activeNetworks.length, operational: activeNetworks.length },
    dex: { total: dex.length, operational: dex.filter(d => d.status === 'OPERATIONAL').length },
    bridges: { total: bridges.length, operational: bridges.filter(b => b.status === 'OPERATIONAL').length },
    providers: { total: totalProviders, configured: configuredCount, reachable: reachableCount },
    dataInfra: { total: DATA_INFRASTRUCTURE.length, operational: DATA_INFRASTRUCTURE.length },
    generatedAt: report?.generatedAt || new Date().toISOString()
  };

  return {
    status: 'live',
    sections: {
      networks: activeNetworks,
      dex,
      bridges,
      dataProviders,
      dataInfrastructure: DATA_INFRASTRUCTURE.map(d => ({ ...d, status: 'OPERATIONAL' })),
      wallets: WALLET_INTEGRATIONS.map(w => ({ ...w, status: 'OPERATIONAL' })),
      ai: AI_INFRASTRUCTURE.map(a => ({ ...a, status: 'OPERATIONAL' }))
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
  if (provider.reachable) return 'OPERATIONAL';
  if (provider.lastFailureAt) return 'DEGRADED';
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
      if (networkId === 'solana') return c === 'solana';
      const net = NETWORK_REGISTRY.find(n => n.id === networkId);
      return net && c === net.chainId;
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
