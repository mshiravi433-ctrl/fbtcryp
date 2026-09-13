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
import { LAUNCH_DEX, LAUNCH_CHAINS, LAUNCH_MODES, dexForChain, launchModeFor } from './networks.js';
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
/**
 * The runtime code of the token, as compiled (artifacts.json → deployedBytecode).
 * The direct-deploy path does not parse an event to learn where the token is:
 * after the CREATE transaction mines it reads `eth_getCode` at the predicted
 * address and compares it BYTE FOR BYTE with this constant. A different
 * contract at that address is a named failure, never a silently accepted token.
 */
export const TOKEN_DEPLOYED_BYTECODE = artifact.contracts.FBTBasicToken.deployedBytecode;

/* The token constructor, exactly as declared in contracts/FBTTokenFactory.sol:
     constructor(string name_, string symbol_, uint8 decimals_,
                 uint256 initialSupply_, address creator_, uint256 capabilities_)
   `creator` is always the DEPLOYER (the user's own wallet) — in direct mode
   the wallet is both the sender and the creator, so the address that receives
   the initial supply is the one that signed. */
export const TOKEN_CONSTRUCTOR_TYPES = Object.freeze([
  'string', 'string', 'uint8', 'uint256', 'address', 'uint256'
]);

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
  'function factory() view returns (address)',
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
 * Runtime verification of a chain's DEX constants, run before ANY signature.
 * See networks.js header for why this exists.
 *
 * The four proofs, in order of what they protect:
 *   FACTORY_NO_CODE      — the pinned factory address is empty on this chain
 *   ANCHOR_PAIR_MISSING  — getPair(anchor) is zero: not this factory's market
 *   PAIR_FACTORY_MISMATCH— the anchor pair belongs to a DIFFERENT factory
 *   ROUTER_FACTORY_MISMATCH — the router we would approve routes to another
 *                          factory (a stale constant, or a router from a
 *                          different DEX family that cannot run these bytes)
 *   ROUTER_WRAPPED_MISMATCH — router.WETH() ≠ the wrapped native we pair with
 *
 * Any failure ⇒ ok:false and the launch is BLOCKED (safe failure). The checks
 * are read-only view calls; nothing here signs, sends or holds anything.
 *
 * @returns {{ok:boolean, factory:(string|null), anchorPair:(string|null),
 *            router:(string|null), reason:(string|undefined), problems:string[]}}
 */
export async function verifyDex(provider, chainId, dex = LAUNCH_DEX[chainId]) {
  if (!provider || !dex) return { ok: false, factory: null, anchorPair: null, router: null, reason: 'NO_DEX', problems: ['NO_DEX'] };
  const { Contract } = await import('ethers');
  const problems = [];
  const routerAddress = dex.router || EVM_CHAINS[chainId]?.router || null;
  let anchorPair = null;
  try {
    const code = await provider.getCode(dex.factory);
    if (!code || code === '0x') problems.push('FACTORY_NO_CODE');

    const factory = new Contract(dex.factory, V2_FACTORY_ABI, provider);
    const pair = await factory.getPair(dex.anchor.a, dex.anchor.b);
    const exists = Boolean(pair && pair !== '0x0000000000000000000000000000000000000000');
    if (!exists) problems.push('ANCHOR_PAIR_MISSING');
    anchorPair = exists ? pair : null;

    // The pair must point back at this factory: a factory address that merely
    // answers getPair is not proof, a pair that names it as its creator is.
    if (exists) {
      const pairC = new Contract(pair, V2_PAIR_ABI, provider);
      const back = await pairC.factory().catch(() => null);
      if (!back || String(back).toLowerCase() !== dex.factory.toLowerCase()) problems.push('PAIR_FACTORY_MISMATCH');
    }

    // The router we hand the user's approvals to must belong to that same
    // factory, and must wrap the native we are pairing against.
    if (routerAddress) {
      const router = new Contract(routerAddress, V2_ROUTER_ABI, provider);
      const rFactory = await router.factory().catch(() => null);
      if (!rFactory || String(rFactory).toLowerCase() !== dex.factory.toLowerCase()) problems.push('ROUTER_FACTORY_MISMATCH');
      const rWrapped = await router.WETH().catch(() => null);
      const wrapped = dex.wrapped || EVM_CHAINS[chainId]?.wrapped || null;
      if (wrapped && (!rWrapped || String(rWrapped).toLowerCase() !== String(wrapped).toLowerCase())) problems.push('ROUTER_WRAPPED_MISMATCH');
    }
  } catch (e) {
    problems.push(String(e?.shortMessage || e?.message || 'VERIFY_FAILED'));
  }
  return {
    ok: problems.length === 0,
    factory: dex.factory,
    anchorPair,
    router: routerAddress,
    reason: problems[0],
    problems
  };
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

/* ─────────────────── direct (no-factory) token deployment ─────────────── */

/**
 * The CREATE address of a contract deployed by `deployer` with `nonce`:
 *
 *   address = last 160 bits of keccak256(rlp([deployer, nonce]))
 *
 * This is Ethereum's original deployment rule (and every EVM chain's). It is
 * reimplemented here rather than assumed, because the launch screen shows the
 * user where their token WILL be created BEFORE they sign — an address that
 * turns out wrong after the fact would be a broken promise printed on a
 * confirmation screen.
 *
 * @param {string} deployer 0x-address that sends the CREATE transaction
 * @param {number|bigint} nonce the deployer's transaction count (pre-tx)
 * @returns {string} the predicted 0x-address (checksummed)
 */
export async function predictCreateAddress(deployer, nonce) {
  const { getAddress, getCreateAddress, keccak256, encodeRlp } = await import('ethers');
  const from = getAddress(deployer);
  const n = BigInt(nonce ?? 0);
  if (n < 0n) throw new Error('NONCE_INVALID');
  /* The nonce enters the RLP list as a minimal big-endian byte string:
     zero is the EMPTY string (0x80), 1 is 0x01, 256 is 0x0100. */
  let nonceHex = n.toString(16);
  if (nonceHex === '0') nonceHex = '0x';
  else nonceHex = `0x${nonceHex.length % 2 ? '0' : ''}${nonceHex}`;
  // Belt and braces: this hand-rolled rule and ethers' own implementation
  // must agree. If they ever did not, we would rather throw than print a
  // wrong address to a user who is about to sign.
  const viaRlp = getAddress(`0x${keccak256(encodeRlp([from, nonceHex])).slice(-40)}`);
  const viaEthers = getCreateAddress({ from, nonce: n });
  if (viaEthers.toLowerCase() !== viaRlp.toLowerCase()) throw new Error('CREATE_ADDRESS_RULE_DIVERGED');
  return viaRlp;
}

/**
 * Build the DIRECT token deployment transaction — the v1 default.
 *
 * There is no factory, no registry and no operator contract in this path:
 * the transaction's `to` is null (a plain CREATE) and its data is the token's
 * creation bytecode followed by the ABI-encoded constructor arguments:
 *
 *   data = <creationBytecode> + abi.encode(name, symbol, decimals,
 *                                           initialSupply, deployer, caps)
 *
 * `creator` is the deployer: the wallet that signs is the wallet that owns
 * the token and receives the entire initial supply. FBT is not in this
 * transaction in any form.
 *
 * @param {object} p
 *   p.spec    validated spec from capabilities.js
 *             { name, symbol, decimals, supplyWei, capabilities }
 *   p.creator the user's own wallet address (the deployer, and the creator)
 *   p.nonce   the deployer's transaction count, used for the address
 *             prediction only — the UI re-reads it right before signing
 * @returns {{to:null, data:string, value:string, id:string, deploy:true,
 *            predictedAddress:string, nonce:string, expectedCode:string,
 *            description:string, event:null}}
 */
export async function buildDirectTokenCreateTx({ spec, creator, nonce = 0 }) {
  if (!creator || !/^0x[0-9a-fA-F]{40}$/.test(creator)) throw new Error('CREATOR_ADDRESS_INVALID');
  if (!spec || !spec.name || !spec.symbol) throw new Error('SPEC_REQUIRED');
  const { AbiCoder, getAddress } = await import('ethers');
  const deployer = getAddress(creator);
  const args = AbiCoder.defaultAbiCoder().encode(
    [...TOKEN_CONSTRUCTOR_TYPES],
    [
      spec.name,
      spec.symbol,
      Number(spec.decimals),
      BigInt(spec.supplyWei),
      deployer,
      BigInt(spec.capabilities || 0)
    ]
  );
  return {
    to: null,
    data: TOKEN_BYTECODE + args.slice(2),
    value: '0',
    id: LAUNCH_STEPS.CREATE_TOKEN,
    deploy: true,
    /* No event to read: the address is PREDICTED, then proven by code. */
    event: null,
    predictedAddress: await predictCreateAddress(deployer, nonce),
    expectedCode: TOKEN_DEPLOYED_BYTECODE,
    creator: deployer,
    nonce: String(nonce ?? 0),
    constructorArgs: {
      name: spec.name,
      symbol: spec.symbol,
      decimals: Number(spec.decimals),
      initialSupply: String(spec.supplyWei),
      creator: deployer,
      capabilities: Number(spec.capabilities || 0)
    },
    description: `Deploy ${spec.symbol} (${spec.name}) directly from your wallet`
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
 * DIRECT IS THE DEFAULT, THE FACTORY IS OPTIONAL
 * ---------------------------------------------------------------------------
 * When the chain has no FBTTokenFactory pinned (the normal case), the token
 * step is a plain CREATE from the user's wallet: `to: null`, data = creation
 * bytecode + constructor args (buildDirectTokenCreateTx). The factory path is
 * used only when an address is pinned for that chain, and the plan always says
 * which mode it is in (`plan.mode`), so no consumer has to guess.
 *
 * @param {object} p
 *   p.chainId, p.factoryAddress, p.spec      (phase one)
 *   p.mode              'direct' | 'factory' (defaults from the factory pin)
 *   p.nonce             deployer nonce for the direct address prediction
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
    pairAddress = null, createPairNeeded = null, provider = null, deadlineSeconds,
    nonce = 0
  } = p;
  if (!LAUNCH_CHAINS.includes(chainId)) throw new Error('CHAIN_NOT_SUPPORTED');
  const chain = EVM_CHAINS[chainId];
  const dex = dexForChain(chainId);
  const mode = p.mode || launchModeFor(chainId, factoryAddress ? { [String(chainId)]: factoryAddress } : {});

  const steps = [];
  const signatureOrder = [];

  // Phase one — token creation (only before the token exists)
  if (!tokenAddress) {
    if (mode === LAUNCH_MODES.FACTORY) {
      if (!factoryAddress) throw new Error('FACTORY_NOT_DEPLOYED');
      steps.push(await buildTokenCreateTx({ factoryAddress, spec }));
    } else {
      // Direct deploy — no operator contract anywhere in this transaction.
      steps.push(await buildDirectTokenCreateTx({ spec, creator, nonce }));
    }
    signatureOrder.push('token.create');

    if (quote) {
      // Phase two cannot be byte-complete yet: pin its full intent here.
      let needPair = createPairNeeded;
      let resolvedPair = pairAddress || null;
      if (provider) {
        const quoteAddr = quote.native ? dex.wrapped : quote.address;
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
      mode,
      dex,
      steps,
      createPairNeeded,
      pairAddress: pairAddress || null,
      signatureOrder,
      /* Only meaningful in direct mode: the token's exact future address, for
         the review panel. In factory mode the address is unknown until the
         factory's TokenCreated event is parsed. */
      predictedTokenAddress: steps[0].predictedAddress || null
    };
  }

  // Phase two — pool + liquidity with the real token address
  const quoteAddress = quote.native ? dex.wrapped : quote.address;
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
    mode,
    dex,
    steps,
    createPairNeeded: needPair,
    pairAddress: resolvedPair,
    summary: liq.summary,
    signatureOrder
  };
}
