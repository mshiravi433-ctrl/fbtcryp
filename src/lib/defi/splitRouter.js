/**
 * SPLIT ROUTER — the client seam for fee-on-deposit routing.
 * ---------------------------------------------------------------------------
 * «میخواهیم کارمزد بگیریم اما پول دست ما نباشد»
 *
 * contracts/FBTSplitRouter.sol takes a small fee on the way INTO the five
 * Farm execution protocols and forwards the rest in the same transaction,
 * credited to the depositor — the app's existing non-custodial shape with a
 * revenue leg. This module is the ENTIRE client side of that, and it is
 * DORMANT by design:
 *
 *   · No VITE_FBT_SPLIT_ROUTER_<CHAIN> configured  →  every function here
 *     returns null / the original plan untouched, and the app behaves
 *     byte-for-byte as it does today (direct deposit, zero fee). Nothing
 *     existing imports a routing decision from anywhere else.
 *   · Configured  →  routeSupplyPlan() rewrites a supply plan from any of the
 *     four adapter builders so its steps point at the router, and records the
 *     fee inside plan.checks.splitRouter for the UI to SHOW BEFORE SIGNING —
 *     the same rule the swap fee follows.
 *
 * ─── WHY THIS SHIPS DORMANT AND NOT WIRED INTO THE PANELS ──────────────────
 * The router is not deployed, and an address that does not exist cannot be
 * wired to anything ("wired to nothing" is a documented failure mode of this
 * repo). The rollout order is in docs/defi/SPLIT-ROUTER-FA.md: audit → deploy
 * per chain → run the strict fork rehearsal → set the env → wire the panels
 * (a diff measured in lines, not files, because the plan rewriting below is
 * already tested against every adapter's real step shape).
 *
 * ─── THE FEE IS READ FROM THE CHAIN, NEVER FROM ENV ────────────────────────
 * feeBps is immutable on the router. loadSplitRouterInfo() reads it, sanity-
 * checks it against the compiled ceiling, and refuses to route anything if
 * the on-chain value is insane — so a typo in an env var can never make the
 * app display a fee the contract does not charge, or vice versa.
 */

import { Interface } from 'ethers';

const env = (k) => (typeof import.meta !== 'undefined' ? import.meta.env?.[k] : undefined) || '';

/** Mirrors the contract's compiled MAX_FEE_BPS. A sanity ceiling, not a config. */
export const SPLIT_ROUTER_MAX_FEE_BPS = 100;

/** The one env var per chain that turns routing on for that chain. */
const CHAIN_ENV = Object.freeze({
  8453: 'VITE_FBT_SPLIT_ROUTER_BASE',
  42161: 'VITE_FBT_SPLIT_ROUTER_ARBITRUM',
  1: 'VITE_FBT_SPLIT_ROUTER_ETHEREUM'
});

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/** The router entry points, one per Farm execution adapter id. */
const ROUTER_ABI = Object.freeze([
  'function feeBps() view returns (uint256)',
  'function quoteFee(uint256 amountIn) view returns (uint256 fee, uint256 amountAfterFee)',
  'function supplyAave(uint256 amount)',
  'function supplyCompound(uint256 amount)',
  'function supplyMorpho(uint256 amount)',
  'function stakeLido() payable'
]);
const ROUTER_IFACE = new Interface(ROUTER_ABI);

/** adapter id → router method. These are the five ids FarmPositionHub pins. */
export const SPLIT_ROUTER_METHODS = Object.freeze({
  'aave-base': 'supplyAave',
  'aave-arbitrum': 'supplyAave',
  'compound-base': 'supplyCompound',
  'morpho-base': 'supplyMorpho',
  lido: 'stakeLido'
});

/**
 * The configured router address for a chain, or null.
 *
 * A malformed address is LOUD: it warns and returns null, because a silently
 * ignored typo here would quietly route deposits through nothing.
 */
export function splitRouterAddressFor(chainId) {
  const key = CHAIN_ENV[Number(chainId)];
  if (!key) return null;
  const raw = String(env(key)).trim();
  if (!raw) return null;
  if (!ADDR_RE.test(raw)) {
    // eslint-disable-next-line no-console
    console.warn(`[split-router] ${key}="${raw}" is not a 0x…40 address; routing stays OFF for chain ${chainId}`);
    return null;
  }
  return raw;
}

/** Is routing configured for this chain? (Configured ≠ audited ≠ deployed.) */
export function splitRouterIsLive(chainId) {
  return splitRouterAddressFor(chainId) != null;
}

/**
 * The on-chain router info: { address, feeBps } or null.
 *
 * Reads feeBps from the CONTRACT — never from env, never from a default —
 * and refuses (null + warning) anything above the compiled ceiling, so the
 * number the UI shows is the number the contract charges or nothing at all.
 */
export async function loadSplitRouterInfo(provider, chainId) {
  const address = splitRouterAddressFor(chainId);
  if (!address || !provider) return null;
  try {
    /* provider.call + manual codec rather than a Contract, so any object with
     * a .call() can stand in for a provider (tests do exactly that). */
    const data = ROUTER_IFACE.encodeFunctionData('feeBps', []);
    const result = await provider.call({ to: address, data });
    const feeBps = BigInt(ROUTER_IFACE.decodeFunctionResult('feeBps', result)[0]);
    if (feeBps > BigInt(SPLIT_ROUTER_MAX_FEE_BPS)) {
      // eslint-disable-next-line no-console
      console.warn(`[split-router] router ${address} reports feeBps=${feeBps} > ${SPLIT_ROUTER_MAX_FEE_BPS}; refusing to route`);
      return null;
    }
    return { address, feeBps };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[split-router] could not read feeBps from ${address}: ${err?.shortMessage ?? err?.message ?? err}`);
    return null;
  }
}

/**
 * The fee split, in the token's own base units. BigInt math only — these are
 * wei/6-decimal amounts and a float here would be a quietly-wrong invoice.
 */
export function quoteSplit(amount, feeBps) {
  if (typeof amount !== 'bigint' || amount <= 0n) throw new Error('SPLIT_QUOTE_BAD_AMOUNT');
  if (typeof feeBps !== 'bigint' || feeBps < 0n || feeBps > BigInt(SPLIT_ROUTER_MAX_FEE_BPS)) {
    throw new Error('SPLIT_QUOTE_BAD_FEE_BPS');
  }
  const feeAmount = (amount * feeBps) / 10_000n;
  return { feeAmount, netAmount: amount - feeAmount };
}

const ERC20_IFACE = new Interface(['function approve(address spender, uint256 amount)']);

/**
 * Build the router step for one protocol. Exported for the panels' future use
 * and for tests; routeSupplyPlan is the only caller today.
 */
export function splitRouterStep(protocolId, amountOrValue) {
  const method = SPLIT_ROUTER_METHODS[protocolId];
  if (!method) return null;
  if (method === 'stakeLido') {
    return { to: null, data: ROUTER_IFACE.encodeFunctionData('stakeLido', []) };
  }
  if (typeof amountOrValue !== 'bigint' || amountOrValue <= 0n) return null;
  return { to: null, data: ROUTER_IFACE.encodeFunctionData(method, [amountOrValue]) };
}

/**
 * Rewrite a supply plan so it routes through the split router.
 *
 * IN  : a plan as built by buildSupplyPlan() in aaveV3Base / aaveV3Arbitrum /
 *       compoundV3Base / morphoBlueBase, or the stake plan from lido.js —
 *       { checks, steps: [{ kind, to, data, value?, description? }] }.
 * OUT : a NEW plan with
 *       · the approve step (if any) approving THE ROUTER for the same amount
 *       · the supply/stake step calling the router with that amount
 *       · checks.splitRouter = { address, method, feeBps, feeAmount, netAmount }
 *       or the ORIGINAL plan object, unchanged (same reference), whenever
 *       anything is missing: no configured router, unknown protocol, or a
 *       step shape the rewriter does not recognise exactly. Fail-open to
 *       today's behaviour — a direct deposit the app already proves — never
 *       to a half-rewritten money path. Every fallback is loud.
 */
export function routeSupplyPlan(plan, { chainId, protocolId, feeBps } = {}) {
  if (!plan || !Array.isArray(plan.steps)) return plan;
  const address = splitRouterAddressFor(chainId);
  if (!address) return plan;
  const method = SPLIT_ROUTER_METHODS[protocolId];
  if (!method) {
    // eslint-disable-next-line no-console
    console.warn(`[split-router] no router method for protocol "${protocolId}"; leaving the plan direct`);
    return plan;
  }

  /* Decode the amount from the plan's OWN steps — never from a second source
   * that could disagree with what the adapter just built. */
  let approveStep = null;
  let supplyStep = null;
  for (const step of plan.steps) {
    if (step?.kind === 'approve') approveStep = step;
    if (step?.kind === 'supply' || step?.kind === 'stake') supplyStep = step;
  }

  let amount = null;
  if (method === 'stakeLido') {
    if (!supplyStep || supplyStep.kind !== 'stake' || typeof supplyStep.value !== 'bigint') {
      // eslint-disable-next-line no-console
      console.warn('[split-router] Lido plan without a valued stake step; leaving the plan direct');
      return plan;
    }
    amount = supplyStep.value;
  } else {
    if (!approveStep || !supplyStep) {
      // eslint-disable-next-line no-console
      console.warn(`[split-router] ${protocolId} plan missing its approve/supply steps; leaving the plan direct`);
      return plan;
    }
    try {
      const [spender, value] = ERC20_IFACE.decodeFunctionData('approve', approveStep.data);
      amount = BigInt(value);
      if (!spender || typeof spender !== 'string') throw new Error('bad spender');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[split-router] could not decode the approve amount (${err?.message ?? err}); leaving the plan direct`);
      return plan;
    }
  }

  if (amount == null || amount <= 0n) {
    // eslint-disable-next-line no-console
    console.warn('[split-router] plan carries no positive amount; leaving the plan direct');
    return plan;
  }

  const fee = quoteSplit(amount, typeof feeBps === 'bigint' ? feeBps : 0n);
  const routedStep = method === 'stakeLido'
    ? { ...supplyStep, to: address, data: ROUTER_IFACE.encodeFunctionData('stakeLido', []) }
    : { ...supplyStep, to: address, data: ROUTER_IFACE.encodeFunctionData(method, [amount]) };
  const steps = plan.steps.map((step) => {
    if (step === approveStep) {
      return { ...step, data: ERC20_IFACE.encodeFunctionData('approve', [address, amount]) };
    }
    if (step === supplyStep) return routedStep;
    return step;
  });

  return {
    ...plan,
    steps,
    checks: {
      ...plan.checks,
      splitRouter: {
        address,
        method,
        feeBps: typeof feeBps === 'bigint' ? feeBps : null,
        feeAmount: fee.feeAmount,
        netAmount: fee.netAmount
      }
    }
  };
}
