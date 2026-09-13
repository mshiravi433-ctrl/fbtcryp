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
 *
 * ── WHAT `verifyDex` PROVES BEFORE ANY SIGNATURE (calldata.js) ──────────────
 *   1. the factory has code at the pinned address,
 *   2. `factory.getPair(anchor.a, anchor.b)` is non-zero (the anchor market
 *      really was created by THIS factory),
 *   3. that pair's own `factory()` points back at the same address,
 *   4. the router we are about to hand the user's approvals to reports the
 *      SAME factory, and its `WETH()` is the wrapped native we pair against.
 * Steps 3–4 matter because a router constant that belongs to another DEX
 * family (Velodrome, Trader Joe, SyncSwap…) would otherwise accept
 * Uniswap-V2-shaped calldata it does not implement. Any mismatch blocks the
 * launch with a named reason instead.
 *
 * HOW THE ADDRESSES BELOW WERE ESTABLISHED (no guessing, ever)
 * ---------------------------------------------------------------------------
 *   · factory/router pairs come from the DEX's own published deployment
 *     config (Sushi's `sushiswap-v2.ts` chain registry for chains 10, 43114,
 *     42161), NOT from an unverified third-party list;
 *   · each anchor is then CROSS-CHECKED cryptographically: for the anchor's
 *     two tokens, CREATE2(factory, keccak256(tokenA‖tokenB), pairInitHash)
 *     must equal the address of a live pool that an independent indexer
 *     (GeckoTerminal) lists on that DEX. A wrong factory cannot reproduce
 *     those pool addresses, so the check is evidence, not a copy-paste;
 *   · finally `verifyDex` re-proves 1–4 against the user's own RPC on every
 *     launch, so a constant that later goes stale is a BLOCK, never a
 *     mis-signed transaction.
 *
 * CHAINS DELIBERATELY ABSENT (the honesty rule)
 * ---------------------------------------------------------------------------
 * A chain only appears in the launch list when a V2-family DEX on it is
 * pinned with full confidence (factory + router + wrapped + fee tier + a
 * verifiable anchor market). Linea, Scroll, Sonic, Unichain, Mantle, Berachain,
 * Monad, zkSync Era, Robinhood Chain (4663) currently have no such verified
 * V2 entry in this repository — so they are NOT listed, instead of being
 * listed and failing after the user's first signature. Adding one is a data
 * change here plus a `scripts/verify-launch-dex.mjs` run, nothing more.
 */
import { EVM_CHAINS, TOKENS } from '../chains.js';

export const LAUNCH_SCHEMA = 'fbt.launch-config.v1';

/**
 * Networks a user can launch on. The list is ordered by how deep the launch
 * DEX is on that chain — the first entry is the default and the safest pool.
 */
export const LAUNCH_CHAINS = Object.freeze([8453, 56, 42161, 137, 1, 10, 43114]);

/**
 * Phase-two slot. The adapter interface already exists (dex adapters are
 * plain objects, see calldata.js); Solana needs its own wallet stack, SPL
 * token program and the Raydium/Meteora/Orca program ABIs — a separate,
 * separately-audited workstream, which is why the UI shows it as coming soon
 * instead of shipping an untested signing path.
 */
export const SOLANA_LAUNCH_STATUS = 'COMING_SOON';

/**
 * Deployment mode of the TOKEN step. Both are non-custodial; they differ in
 * who the transaction talks to:
 *
 *   · 'direct'  — the token's creation bytecode is sent straight from the
 *                 user's wallet (to = null, a plain CREATE). No FBT contract
 *                 is involved, no FBT contract needs to exist, and there is
 *                 nothing to pay an operator. This is the v1 default.
 *   · 'factory' — the token is created through the FBTTokenFactory deployment
 *                 pinned for that chain via FBTLAUNCH_FACTORY_<chainId>. The
 *                 factory is an optional deployer/registry (stateless, no
 *                 owner, no fees) and the path any future on-chain fee would
 *                 need; it is used only when an operator explicitly pins one.
 *
 * The mode is per chain and is disclosed in the UI before any signature.
 */
export const LAUNCH_MODES = Object.freeze({ DIRECT: 'direct', FACTORY: 'factory' });

/**
 * Per-chain DEX facts. `router`/`wrapped` default to lib/chains.js (the
 * single source of truth for the SWAP router) and are overridden HERE only
 * when the launch DEX is a different family than the chain's swap router —
 * Optimism (Velodrome) and Avalanche (Trader Joe, whose native-liquidity
 * method is not `addLiquidityETH`) both launch on SushiSwap V2 instead.
 * `factory` is the V2-family factory that `router` routes to, and `anchor`
 * is the pair used for the runtime verification described in the header.
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
    /*
     * CORRECTED 2026-09-13. The previous constant
     * (0x4726B504e477d31e09E2A0C38E10F226F3104881) was not even a valid
     * EIP-55 checksum — it was hand-typed, and `getPair` on it can never
     * return the anchor, so every Arbitrum launch was blocked at the runtime
     * check. Sushi's own deployment registry pins the standard factory
     * (0xc35DAD…74C4) for Arbitrum, and the anchor below is its WETH/USDT
     * market: CREATE2(factory, keccak256(WETH‖USDT), pairInitHash) reproduces
     * that pool's live address exactly.
     */
    factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
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
  },
  10: {
    /*
     * Optimism's swap router in lib/chains.js is Velodrome, whose router is
     * NOT Uniswap-V2-compatible (its addLiquidity takes a `stable` flag), so
     * launching through it with V2 calldata would revert at best. SushiSwap V2
     * is the chain's V2-family venue with a published deployment config — and
     * the same address pair Sushi pins for Linea — so the launch DEX pins its
     * own router/wrapped here and `verifyDex` proves router.factory() is this
     * factory before anything is signed.
     */
    id: 'sushi-v2-optimism',
    dexName: 'SushiSwap',
    factory: '0xFbc12984689e5f15626Bad03Ad60160Fe98B303C',
    router: '0x2ABf469074dc0b54d793850807E6eb5Faf2625b1',
    wrapped: '0x4200000000000000000000000000000000000006', // WETH
    feeTierBps: 30,
    /*
     * USDC / WETH — this factory's deepest market on Optimism. Honest note:
     * Sushi V2 is a thin venue on Optimism, so the anchor proves the factory
     * (it is long-lived and was created by this exact factory), and the UI
     * does not claim more than that.
     */
    anchor: { a: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', b: '0x4200000000000000000000000000000000000006' }
  },
  43114: {
    /*
     * Avalanche's swap router in lib/chains.js is Trader Joe's, a V2 fork
     * whose native-liquidity entry point is `addLiquidityAVAX`, not the
     * `addLiquidityETH` every V2 adapter here builds. So Avalanche launches on
     * SushiSwap V2 (WAVAX is its wrapped native, and its router exposes the
     * standard V2 surface), verified at runtime the same way.
     */
    id: 'sushi-v2-avalanche',
    dexName: 'SushiSwap',
    factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    wrapped: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
    feeTierBps: 30,
    /* USDC / WAVAX — the factory's deepest market on Avalanche. */
    anchor: { a: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', b: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' }
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
 * (the single source of truth for those two) — unless the launch DEX pins its
 * own router/wrapped, which happens exactly when the chain's swap router is a
 * different DEX family (see the entries for 10 and 43114). Every byte-building
 * and verifying function takes THIS object — nothing may read LAUNCH_DEX
 * directly, or it would silently miss the router.
 */
export function dexForChain(chainId) {
  const base = EVM_CHAINS[chainId];
  const dex = LAUNCH_DEX[chainId];
  if (!base || !dex) return null;
  return {
    ...dex,
    chainId,
    router: dex.router || base.router,
    wrapped: dex.wrapped || base.wrapped,
    /* Disclosed for the UI, so a card can say whose router will be approved. */
    routerOwner: dex.router ? 'dex' : 'chain'
  };
}

/** 'factory' when an FBTTokenFactory is pinned for the chain, else 'direct'. */
export function launchModeFor(chainId, factoryRegistry = {}) {
  const pinned = factoryRegistry instanceof Map
    ? factoryRegistry.get(String(chainId)) || factoryRegistry.get(chainId)
    : factoryRegistry?.[String(chainId)] || factoryRegistry?.[chainId];
  return pinned ? LAUNCH_MODES.FACTORY : LAUNCH_MODES.DIRECT;
}

/**
 * Full launch-ready description of one chain.
 *   · `status: 'ready'`  — a DEX is pinned for this chain (still verified
 *                          on-chain per launch, before any signature).
 *   · `mode`             — 'direct' (default, no factory involved) or
 *                          'factory' (FBTTokenFactory pinned for this chain).
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
    mode: launchModeFor(chainId, factoryAddress ? { [String(chainId)]: factoryAddress } : {}),
    /* Direct deploys need no operator contract, so the token step of every
       listed chain is launchable even with no factory deployed anywhere. */
    tokenDeployReady: true,
    status: 'ready'
  };
}

export function describeAllLaunchChains(factoryRegistry = {}) {
  return LAUNCH_CHAINS
    .map((id) => describeLaunchChain(id, { factoryAddress: factoryRegistry[String(id)] || null }))
    .filter(Boolean);
}
