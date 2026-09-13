/**
 * FBT LAUNCH — network & DEX registry
 * ============================================================================
 *
 * Phase-one launch networks (EVM) and the DEX each one launches on.
 *
 * WHY THE CHAIN'S OWN DEX
 * ---------------------------------------------------------------------------
 * The proposal named Uniswap v4 as the core provider. v1 does NOT ship on v4:
 * v4 pool initialisation is a different (hook-aware, permissioned) flow, it
 * does not exist on BNB Chain, and a launchpad whose flagship provider cannot
 * be simulated on three of the five launch networks is not a launchpad, it is
 * a promise. Every chain below already has a battle-tested V2-family factory
 * the FBT Swap engine itself routes through (see lib/chains.js) — those pools
 * are created, verified and tradable the moment the user signs. Uniswap v4
 * enters later through the same adapter interface, behind `dex.status`.
 *
 * THE ANCHOR PAIR — why every DEX entry carries one
 * ---------------------------------------------------------------------------
 * This repository's own rule for lib/chains.js: "VERIFY THESE ADDRESSES
 * YOURSELF before sending real value." We cannot ship a verified stamp we did
 * not earn, so instead of trusting a constant, the client VERIFIES it at
 * runtime, before any signature: it asks the claimed DEX factory for
 * `getPair(anchor0, anchor1)` — a pair that is deeply liquid on that DEX and
 * can only have been created by that DEX's factory. A stale or wrong factory
 * constant returns zero and the launch is BLOCKED with a named error
 * (safe failure). A wrong factory can therefore never become a wrong pool.
 * `scripts/verify-launch-dex.mjs` runs the same check from a machine with
 * network for CI/operators.
 */
import { EVM_CHAINS, TOKENS } from '../chains.js';

export const LAUNCH_SCHEMA = 'fbt.launch-config.v1';

/** Networks a user can launch on in phase one. */
export const LAUNCH_CHAINS = Object.freeze([8453, 56, 42161, 137, 1]);

/**
 * Phase-two slot. The adapter interface already exists (dex adapters are
 * plain objects, see calldata.js); Solana needs its own wallet stack, SPL
 * token program and the Raydium/Meteora/Orca program ABIs — a separate,
 * separately-audited workstream, which is why the UI shows it as coming soon
 * instead of shipping an untested signing path.
 */
export const SOLANA_LAUNCH_STATUS = 'COMING_SOON';

/**
 * Per-chain DEX facts. `router`/`wrapped` mirror lib/chains.js (single
 * source of truth for those two); `factory` is the V2-family factory that
 * `router` routes to, and `anchor` is the pair used for the runtime
 * verification described in the header.
 *
 * These constants are CROSS-VERIFIED AT RUNTIME by `verifyDex` (calldata.js)
 * before any launch transaction is signed. They are also overridable through
 * the server config (FBTLAUNCH_DEX_* env) for deployments that pin their own
 * audited addresses — the client treats the server value as authoritative
 * when the API is reachable, and falls back to these otherwise.
 */
export const LAUNCH_DEX = Object.freeze({
  8453: {
    id: 'uniswap-v2-base',
    dexName: 'Uniswap V2',
    factory: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
    feeTierBps: 30,
    /* WETH / USDC — the deepest market on Uniswap V2 (fork) on Base. */
    anchor: { a: '0x4200000000000000000000000000000000000006', b: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }
  },
  56: {
    id: 'pancakeswap-v2',
    dexName: 'PancakeSwap',
    factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    feeTierBps: 25,
    /* WBNB / USDT — the deepest market on PancakeSwap V2. */
    anchor: { a: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', b: '0x55d398326f99059fF775485246999027B3197955' }
  },
  42161: {
    id: 'sushi-v2-arbitrum',
    dexName: 'SushiSwap',
    factory: '0x4726B504e477d31e09E2A0C38E10F226F3104881',
    feeTierBps: 30,
    /* WETH / USDT — a long-standing deep market on this factory. */
    anchor: { a: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', b: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' }
  },
  137: {
    id: 'quickswap-v2',
    dexName: 'QuickSwap',
    factory: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
    feeTierBps: 30,
    /* WMATIC / USDT — a deep market on QuickSwap. */
    anchor: { a: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', b: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }
  },
  1: {
    id: 'uniswap-v2',
    dexName: 'Uniswap V2',
    factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    feeTierBps: 30,
    /* WETH / USDT — a decade-old anchor market. */
    anchor: { a: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', b: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }
  }
});

/** Quote assets a launch can pair with, per chain (curated list only). */
export function quoteAssetsFor(chainId) {
  const list = TOKENS[chainId] || [];
  return list.filter((t) => t.symbol === 'USDT' || t.symbol === 'USDC' || t.symbol === 'DAI' || t.native);
}

/** The native entry of the curated list, or null. */
export function nativeFor(chainId) {
  const list = TOKENS[chainId] || [];
  return list.find((t) => t.native) || null;
}

/**
 * The complete DEX object for a chain: registry facts (factory, anchor,
 * fee tier) merged with the chain's router/wrapped native from EVM_CHAINS
 * (the single source of truth for those two). Every byte-building and
 * verifying function takes THIS object — nothing may read LAUNCH_DEX
 * directly, or it would silently miss the router.
 */
export function dexForChain(chainId) {
  const base = EVM_CHAINS[chainId];
  const dex = LAUNCH_DEX[chainId];
  if (!base || !dex) return null;
  return {
    ...dex,
    chainId,
    router: base.router,
    wrapped: base.wrapped
  };
}

/**
 * Full launch-ready description of one chain. `status` is the honest state:
 *  · 'ready'            — DEX constants present (still runtime-verified per launch)
 *  · 'no-factory'       — FBT launch factory not deployed on this chain yet
 *                         (filled from server config when reachable)
 */
export function describeLaunchChain(chainId, { factoryAddress = null } = {}) {
  const base = EVM_CHAINS[chainId];
  const dex = dexForChain(chainId);
  if (!base || !dex) return null;
  return {
    chainId,
    name: base.name,
    short: base.short,
    color: base.color,
    native: base.native,
    explorer: base.explorer,
    dex: {
      id: dex.id,
      name: dex.dexName,
      factory: dex.factory,
      router: dex.router,
      wrapped: dex.wrapped,
      feeTierBps: dex.feeTierBps
    },
    quotes: quoteAssetsFor(chainId),
    fbtFactory: factoryAddress || null,
    status: factoryAddress ? 'ready' : 'no-factory'
  };
}

export function describeAllLaunchChains(factoryRegistry = {}) {
  return LAUNCH_CHAINS.map((id) => describeLaunchChain(id, { factoryAddress: factoryRegistry[String(id)] || null }));
}
