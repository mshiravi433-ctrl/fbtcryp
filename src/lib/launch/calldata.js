/**
 * FBT LAUNCH — calldata preparation (the ONLY place bytes are built).
 *
 * PREPARE, NEVER SIGN
 * ---------------------------------------------------------------------------
 * Every function in this module is a PURE PREPARATION step: config in,
 * `{ to, data, value }` out. Nothing here touches a wallet, a key or a
 * signer. The wallet layer (context/WalletContext) builds the final
 * transaction from these bytes and the USER'S wallet signs it. The server
 * imports this same module for the public prepare API, so the app and the
 * SDK can never disagree about the bytes being signed.
 *
 * DEX ADAPTER BOUNDARY
 * ---------------------------------------------------------------------------
 * `dex` is a plain object { factory, router, wrapped, feeTierBps, dexName,
 * id } — the V2-family adapter ships inline below (it is small enough that
 * an abstraction layer around one implementation would be decoration).
 * Uniswap v4 / Raydium / Meteora enter later as new adapter objects with the
 * same surface: `prepare(poolIntent) -> steps[]`, `verify(pair) -> state`.
 */
import artifact from './artifacts.js';
import { LAUNCH_DEX, LAUNCH_CHAINS, dexForChain } from './networks.js';
import { EVM_CHAINS } from '../chains.js';

export const LAUNCH_STEPS = Object.freeze({
  CREATE_TOKEN: 'create-token',
  APPROVE_TOKEN: 'approve-token',
  APPROVE_QUOTE: 'approve-quote',
  CREATE_PAIR: 'create-pair',
  ADD_LIQUIDITY: 'add-liquidity'
});

export const TOKEN_ABI = artifact.contracts.FBTBasicToken.abi;
export const FACTORY_ABI = artifact.contracts.FBTTokenFactory.abi;
export const TOKEN_BYTECODE = artifact.contracts.FBTBasicToken.bytecode;
export const FACTORY_BYTECODE = artifact.contracts.FBTTokenFactory.bytecode;

/* The Uniswap V2-family surface every launch DEX exposes. Identical across
   Uniswap V2, PancakeSwap V2, QuickSwap and Sushi V2 — which is exactly why
   they can share one adapter. */
const V2_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
  'function createPair(address tokenA, address tokenB) returns (address pair)',
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)'
];
const V2_PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function factory() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function sync() external'
];
const V2_ROUTER_ABI = [
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) payable returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
  'function WETH() view returns (address)'
];
const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)'
];

async function loadInterfaces() {
  const { Interface } = await import('ethers');
  return {
    factory: new Interface(FACTORY_ABI),
    v2Factory: new Interface(V2_FACTORY_ABI),
    v2Pair: new Interface(V2_PAIR_ABI),
    v2Router: new Interface(V2_ROUTER_ABI),
    erc20: new Interface(ERC20_ABI),
    token: new Interface(TOKEN_ABI)
  };
}

export { loadInterfaces };

/* ─────────────────────────── DEX verification ─────────────────────────── */

/**
 * Runtime verification of a DEX's factory address against its anchor pair.
 * See networks.js header for why this exists.
 *
 * @returns {{ok:boolean, factory:(string|null), anchorPair:(string|null), reason?:string}}
 */
export async function verifyDex(provider, chainId, dex = LAUNCH_DEX[chainId]) {
  if (!provider || !dex) return { ok: false, factory: null, anchorPair: null, reason: 'NO_DEX' };
  const { Contract } = await import('ethers');
  const factory = new Contract(dex.factory, V2_FACTORY_ABI, provider);
  try {
    const pair = await factory.getPair(dex.anchor.a, dex.anchor.b);
    const ok = Boolean(pair && pair !== '0x0000000000000000000000000000000000000000');
    return { ok, factory: dex.factory, anchorPair: ok ? pair : null, reason: ok ? undefined : 'ANCHOR_PAIR_MISSING' };
  } catch (e) {
    return { ok: false, factory: dex.factory, anchorPair: null, reason: String(e?.shortMessage || e?.message || 'VERIFY_FAILED') };
  }
}

/** The existing pair for (token, quote) on the chain's DEX, or null. */
export async function getExistingPair(provider, chainId, token, quote) {
  const dex = LAUNCH_DEX[chainId];
  if (!dex) return null;
  const { Contract } = await import('ethers');
  const factory = new Contract(dex.factory, V2_FACTORY_ABI, provider);
  try {
    const pair = await factory.getPair(token, quote);
    return pair && pair !== '0x0000000000000000000000000000000000000000' ? pair : null;
  } catch {
    return null;
  }
}

/* ───────────────────────── token creation bytes ───────────────────────── */

/**
 * Build the factory `createToken` transaction bytes.
 *
 * @param {object} p
 *   p.factoryAddress  FBTTokenFactory deployment on the chosen chain
 *   p.spec            validated spec from capabilities.js
 *                     { name, symbol, decimals, supplyWei, capabilities }
 * @returns {{to:string, data:string, value:string, id:string, description:string, event:string}}
 */
export async function buildTokenCreateTx({ factoryAddress, spec }) {
  if (!factoryAddress) throw new Error('FACTORY_NOT_DEPLOYED');
  const { factory } = await loadInterfaces();
  const data = factory.encodeFunctionData('createToken', [
    {
      name: spec.name,
      symbol: spec.symbol,
      decimals: spec.decimals,
      initialSupply: spec.supplyWei,
      capabilities: spec.capabilities
    }
  ]);
  return {
    to: factoryAddress,
    data,
    value: '0',
    id: LAUNCH_STEPS.CREATE_TOKEN,
    description: `Create ${spec.symbol} (${spec.name}) on the FBT factory`,
    event: 'TokenCreated'
  };
}

/** Decode a TokenCreated log → { token, creator, name, symbol, decimals, supply, capabilities }. */
export async function parseTokenCreatedLog(log) {
  const { factory } = await loadInterfaces();
  const parsed = factory.parseLog(log);
  if (!parsed || parsed.name !== 'TokenCreated') return null;
  const [token, creator, name, symbol, decimals, totalSupply, capabilities] = parsed.args;
  return {
    token: token.toString ? token.toString() : token,
    creator: creator.toString ? creator.toString() : creator,
    name,
    symbol,
    decimals: Number(decimals),
    supply: totalSupply.toString(),
    capabilities: Number(capabilities)
  };
}

/* ───────────────────────── pool + liquidity bytes ─────────────────────── */

const toWei = (human, decimals) => {
  const s = String(human || '0').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('AMOUNT_INVALID');
  const [whole, frac = ''] = s.split('.');
  const pad = frac.slice(0, decimals).padEnd(decimals, '0');
  return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(pad || '0')).toString();
};

/** Slippage floor: amount × (1 − slippageBps/10000), floored. */
export function minWithSlippage(amountWei, slippageBps = 100) {
  const bps = Math.max(0, Math.min(5000, Number(slippageBps) || 0));
  const amt = BigInt(amountWei);
  return (amt * BigInt(10_000 - bps)) / 10_000n;
}

/**
 * Build the ordered, fully-specified pool + liquidity steps.
 *
 * Order (why it matters):
 *   1. approve token → router   (the new token must allow the router)
 *   2. approve quote → router   (only when the quote is an ERC-20)
 *   3. createPair (DEX factory) (only when no pair exists yet — creation is
 *                                permissionless; the user's own wallet does
 *                                it, so no middleman ever can)
 *   4. addLiquidity(ETH) (router) (LP tokens mint straight to the creator)
 *
 * Requires a REAL token address — the engine calls this in the second
 * phase, after the token has been mined (see buildLaunchPlan).
 *
 * @returns {{steps:object[], summary:object}}
 */
export async function buildLiquiditySteps(p) {
  const { chainId, token, quote, slippageBps = 100, creator } = p;
  const dex = dexForChain(chainId);
  if (!dex) throw new Error('CHAIN_NOT_SUPPORTED');
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) throw new Error('TOKEN_ADDRESS_INVALID');
  if (!creator || !/^0x[0-9a-fA-F]{40}$/.test(creator)) throw new Error('CREATOR_ADDRESS_INVALID');
  if (quote.native && !dex.wrapped) throw new Error('WRAPPED_NATIVE_MISSING');
  if (!quote.native && (!quote.address || !/^0x[0-9a-fA-F]{40}$/.test(quote.address))) throw new Error('QUOTE_ADDRESS_INVALID');

  const { v2Factory, v2Router, erc20 } = await loadInterfaces();
  const deadline = Number(p.deadlineSeconds || Math.floor(Date.now() / 1000) + 600);
  const tokenAmountWei = toWei(p.tokenAmount, 18);
  const quoteDecimals = Number(quote.decimals ?? 18);
  const quoteAmountWei = toWei(p.quoteAmount, quoteDecimals);
  const tokenMin = minWithSlippage(tokenAmountWei, slippageBps);
  const quoteMin = minWithSlippage(quoteAmountWei, slippageBps);
  const quoteAddress = quote.native ? dex.wrapped : quote.address;
  const steps = [];

  // 1 — token approval (always needed for a brand-new token)
  steps.push({
    id: LAUNCH_STEPS.APPROVE_TOKEN,
    to: token,
    data: erc20.encodeFunctionData('approve', [dex.router, tokenAmountWei]),
    value: '0',
    description: `Approve ${p.tokenAmount} TOKEN for the ${dex.dexName} router`,
    amountHuman: p.tokenAmount,
    amountWei: tokenAmountWei
  });

  // 2 — quote approval (ERC-20 quote only; native needs none)
  if (!quote.native) {
    steps.push({
      id: LAUNCH_STEPS.APPROVE_QUOTE,
      to: quote.address,
      data: erc20.encodeFunctionData('approve', [dex.router, quoteAmountWei]),
      value: '0',
      description: `Approve ${p.quoteAmount} ${quote.symbol} for the ${dex.dexName} router`,
      amountHuman: p.quoteAmount,
      amountWei: quoteAmountWei
    });
  }

  // 3 — pair creation (the engine re-checks pair existence right before this
  //    step signs, in case a concurrent launch created it first)
  if (p.createPairNeeded) {
    steps.push({
      id: LAUNCH_STEPS.CREATE_PAIR,
      to: dex.factory,
      data: v2Factory.encodeFunctionData('createPair', [token, quoteAddress]),
      value: '0',
      description: `Create the ${quote.symbol}/TOKEN pair on ${dex.dexName}`,
      quoteAddress
    });
  }

  // 4 — liquidity (LP tokens mint to the creator's own wallet)
  let data;
  let value = '0';
  if (quote.native) {
    data = v2Router.encodeFunctionData('addLiquidityETH', [
      token, tokenAmountWei, tokenMin, quoteAmountWei, creator, deadline
    ]);
    value = quoteAmountWei; // the router takes the native WITH the call
  } else {
    data = v2Router.encodeFunctionData('addLiquidity', [
      token, quoteAddress, tokenAmountWei, quoteAmountWei, tokenMin, quoteMin, creator, deadline
    ]);
  }
  steps.push({
    id: LAUNCH_STEPS.ADD_LIQUIDITY,
    to: dex.router,
    data,
    value,
    description: `Add initial liquidity (${p.tokenAmount} TOKEN + ${p.quoteAmount} ${quote.symbol})`,
    tokenAmountWei,
    quoteAmountWei,
    tokenMin: tokenMin.toString(),
    quoteMin: quoteMin.toString(),
    deadline,
    lpTo: creator
  });

  const tNum = Number(p.tokenAmount || 0);
  const qNum = Number(p.quoteAmount || 0);
  return {
    steps,
    summary: {
      tokenAmountWei,
      quoteAmountWei,
      tokenMin: tokenMin.toString(),
      quoteMin: quoteMin.toString(),
      impliedPrice: tNum > 0 ? qNum / tNum : null,
      feeTierBps: dex.feeTierBps
    }
  };
}

/* ─────────────────────────── plan assembly ────────────────────────────── */

/**
 * The full launch plan — the function the public API (server/launch.js) and
 * the in-app engine both call: one builder, two consumers, identical bytes.
 *
 * PHASING IS HONEST, NOT THEATRICAL
 * ---------------------------------------------------------------------------
 * A launch has two signature phases and the pool bytes genuinely cannot be
 * built before the token exists. So when `tokenAddress` is absent, the pool
 * steps come back as one `deferred` step that records EXACTLY what will be
 * prepared next (with the real token address spliced in by the engine after
 * the token mines). Fake zero-address bytes would be a lie; a deferred step
 * is a promise with its parameters pinned.
 *
 * @param {object} p
 *   p.chainId, p.factoryAddress, p.spec      (phase one)
 *   p.tokenAddress      real address once the token exists (phase two)
 *   p.quote             { address, decimals, native, symbol }
 *   p.tokenAmount, p.quoteAmount              human units
 *   p.slippageBps, p.creator, p.deadlineSeconds
 *   p.pairAddress / p.createPairNeeded        pair state (engine reads live)
 *   p.provider          optional read provider for the live pair check
 * @returns {Promise<object>} the plan
 */
export async function buildLaunchPlan(p) {
  const {
    chainId, factoryAddress, spec, tokenAddress = null, quote,
    tokenAmount, quoteAmount, slippageBps, creator,
    pairAddress = null, createPairNeeded = null, provider = null, deadlineSeconds
  } = p;
  if (!LAUNCH_CHAINS.includes(chainId)) throw new Error('CHAIN_NOT_SUPPORTED');
  const chain = EVM_CHAINS[chainId];
  const dex = dexForChain(chainId);

  const steps = [];
  const signatureOrder = [];

  // Phase one — token creation (only before the token exists)
  if (!tokenAddress) {
    if (!factoryAddress) throw new Error('FACTORY_NOT_DEPLOYED');
    steps.push(await buildTokenCreateTx({ factoryAddress, spec }));
    signatureOrder.push('token.create');

    if (quote) {
      // Phase two cannot be byte-complete yet: pin its full intent here.
      let needPair = createPairNeeded;
      let resolvedPair = pairAddress || null;
      if (provider) {
        const quoteAddr = quote.native ? chain.wrapped : quote.address;
        resolvedPair = (await getExistingPair(provider, chainId, tokenAddress, quoteAddr)) || null;
        needPair = !resolvedPair;
      } else if (needPair == null) {
        needPair = !resolvedPair;
      }
      steps.push({
        id: 'deferred-pool',
        deferred: true,
        reason: 'TOKEN_NOT_CREATED_YET',
        intent: {
          createPairNeeded: needPair,
          pairAddress: resolvedPair,
          quote,
          tokenAmount,
          quoteAmount,
          slippageBps,
          creator,
          deadlineSeconds
        },
        description: 'Pool + liquidity bytes are prepared with the real token address after the token is mined'
      });
      signatureOrder.push(
        ...(needPair ? ['pool.create'] : []),
        'liquidity.approve',
        ...(quote.native ? [] : ['liquidity.approveQuote']),
        'liquidity.add'
      );
    }
    return {
      schema: 'fbt.launch-plan.v1',
      phase: 'token',
      chainId,
      dex,
      steps,
      createPairNeeded,
      pairAddress: pairAddress || null,
      signatureOrder
    };
  }

  // Phase two — pool + liquidity with the real token address
  const quoteAddress = quote.native ? chain.wrapped : quote.address;
  let resolvedPair = pairAddress || null;
  let needPair = createPairNeeded;
  if (provider) {
    resolvedPair = (await getExistingPair(provider, chainId, tokenAddress, quoteAddress)) || null;
    needPair = !resolvedPair;
  } else if (needPair == null) {
    needPair = !resolvedPair;
  }

  const liq = await buildLiquiditySteps({
    chainId,
    token: tokenAddress,
    quote,
    tokenAmount,
    quoteAmount,
    slippageBps,
    creator,
    createPairNeeded: needPair,
    deadlineSeconds
  });
  steps.push(...liq.steps);
  for (const s of liq.steps) signatureOrder.push(s.id);

  return {
    schema: 'fbt.launch-plan.v1',
    phase: 'pool',
    chainId,
    dex,
    steps,
    createPairNeeded: needPair,
    pairAddress: resolvedPair,
    summary: liq.summary,
    signatureOrder
  };
}
