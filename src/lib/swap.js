/**
 * On-chain swap engine (PancakeSwap V2 router on BSC).
 *
 * Every function here builds a transaction that the USER signs from THEIR
 * wallet. There is no operator address, no fee-skim, and no server involvement.
 *
 * Safety properties worth keeping if you edit this file:
 *   • `amountOutMin` is always enforced from a fresh on-chain quote, so a
 *     sandwich attack can't drain more than the slippage the user accepted.
 *   • Approvals default to the exact amount, not the common `MaxUint256`
 *     "infinite approve" — a compromised router then can't move the rest of
 *     the user's balance later.
 *   • Deadlines are short (default 20 min) so a stuck tx can't execute hours
 *     later at a wildly different price.
 */

import { EVM_CHAINS, ERC20_ABI, ROUTER_ABI, buildPath } from './chains';

const loadEthers = () => import('ethers');

export const DEFAULT_SLIPPAGE = 0.5; // percent
export const DEFAULT_DEADLINE_MIN = 20;

/* ------------------------------- balances -------------------------------- */

export async function getTokenBalance(provider, token, owner) {
  const { Contract, formatUnits } = await loadEthers();
  if (token.native) {
    const wei = await provider.getBalance(owner);
    return { raw: wei, formatted: Number(formatUnits(wei, 18)) };
  }
  const c = new Contract(token.address, ERC20_ABI, provider);
  const raw = await c.balanceOf(owner);
  return { raw, formatted: Number(formatUnits(raw, token.decimals)) };
}

/** Fetch balances for a token list in parallel; failures resolve to zero. */
export async function getBalances(provider, tokens, owner) {
  const out = {};
  await Promise.all(
    tokens.map(async (t) => {
      try {
        out[t.symbol] = await getTokenBalance(provider, t, owner);
      } catch {
        out[t.symbol] = { raw: 0n, formatted: 0 };
      }
    })
  );
  return out;
}

/* -------------------------------- quoting -------------------------------- */

/**
 * Ask the router what `amountIn` of `fromToken` is worth in `toToken`.
 * Returns null when there is no route or the pool is empty.
 */
export async function getQuote({ provider, chainId, fromToken, toToken, amountIn, slippage = DEFAULT_SLIPPAGE }) {
  if (!amountIn || Number(amountIn) <= 0) return null;
  const { Contract, parseUnits, formatUnits } = await loadEthers();
  const cfg = EVM_CHAINS[chainId];
  const router = new Contract(cfg.router, ROUTER_ABI, provider);

  const path = buildPath(chainId, fromToken, toToken);
  if (path.length < 2) return null;

  const amountInWei = parseUnits(String(amountIn), fromToken.decimals);

  let amounts;
  try {
    amounts = await router.getAmountsOut(amountInWei, path);
  } catch {
    return { error: 'NO_ROUTE', path };
  }

  const outWei = amounts[amounts.length - 1];
  if (outWei === 0n) return { error: 'NO_LIQUIDITY', path };

  // amountOutMin = out * (1 - slippage). Done in basis points to stay integral.
  const bps = BigInt(Math.round((100 - slippage) * 100));
  const minOutWei = (outWei * bps) / 10000n;

  const amountOut = Number(formatUnits(outWei, toToken.decimals));
  const rate = amountOut / Number(amountIn);

  return {
    path,
    amountInWei,
    amountOutWei: outWei,
    minOutWei,
    amountOut,
    minOut: Number(formatUnits(minOutWei, toToken.decimals)),
    rate,
    hops: path.length - 1,
    slippage
  };
}

/* ------------------------------- allowance ------------------------------- */

export async function getAllowance({ provider, chainId, token, owner }) {
  if (token.native) return { raw: null, unlimited: true }; // gas coin needs no approval
  const { Contract } = await loadEthers();
  const c = new Contract(token.address, ERC20_ABI, provider);
  const raw = await c.allowance(owner, EVM_CHAINS[chainId].router);
  return { raw, unlimited: false };
}

export async function needsApproval({ provider, chainId, token, owner, amountWei }) {
  if (token.native) return false;
  const { raw } = await getAllowance({ provider, chainId, token, owner });
  return raw < amountWei;
}

/**
 * Approve exactly `amountWei` (not infinite). Returns the tx receipt.
 * Some legacy tokens (USDT-style) require resetting to 0 first; we handle that.
 */
export async function approveToken({ signer, chainId, token, amountWei }) {
  const { Contract } = await loadEthers();
  const c = new Contract(token.address, ERC20_ABI, signer);
  const spender = EVM_CHAINS[chainId].router;

  const current = await c.allowance(await signer.getAddress(), spender);
  if (current > 0n && current < amountWei) {
    // non-zero -> non-zero is rejected by some ERC-20s; zero it out first
    const reset = await c.approve(spender, 0n);
    await reset.wait();
  }

  const tx = await c.approve(spender, amountWei);
  return { hash: tx.hash, wait: () => tx.wait() };
}

/* --------------------------------- swap ---------------------------------- */

/**
 * Execute the swap. Picks the right router method for native-in / native-out /
 * token-to-token, and uses the fee-on-transfer-tolerant variants so tokens
 * with a transfer tax don't revert.
 */
export async function executeSwap({
  signer,
  chainId,
  fromToken,
  toToken,
  quote,
  deadlineMinutes = DEFAULT_DEADLINE_MIN,
  supportFeeOnTransfer = true
}) {
  const { Contract } = await loadEthers();
  const cfg = EVM_CHAINS[chainId];
  const router = new Contract(cfg.router, ROUTER_ABI, signer);
  const to = await signer.getAddress();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);

  const { path, amountInWei, minOutWei } = quote;

  let tx;
  if (fromToken.native) {
    tx = supportFeeOnTransfer
      ? await router.swapExactETHForTokensSupportingFeeOnTransferTokens(minOutWei, path, to, deadline, {
          value: amountInWei
        })
      : await router.swapExactETHForTokens(minOutWei, path, to, deadline, { value: amountInWei });
  } else if (toToken.native) {
    tx = supportFeeOnTransfer
      ? await router.swapExactTokensForETHSupportingFeeOnTransferTokens(amountInWei, minOutWei, path, to, deadline)
      : await router.swapExactTokensForETH(amountInWei, minOutWei, path, to, deadline);
  } else {
    tx = supportFeeOnTransfer
      ? await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amountInWei, minOutWei, path, to, deadline)
      : await router.swapExactTokensForTokens(amountInWei, minOutWei, path, to, deadline);
  }

  return { hash: tx.hash, wait: () => tx.wait() };
}

/* ------------------------------ plain send ------------------------------- */

/** Send native coin or an ERC-20 to an address the user typed in. */
export async function sendToken({ signer, token, to, amount }) {
  const { Contract, parseUnits, isAddress } = await loadEthers();
  if (!isAddress(to)) throw new Error('INVALID_ADDRESS');

  const amountWei = parseUnits(String(amount), token.decimals);

  if (token.native) {
    const tx = await signer.sendTransaction({ to, value: amountWei });
    return { hash: tx.hash, wait: () => tx.wait() };
  }
  const c = new Contract(token.address, ERC20_ABI, signer);
  const tx = await c.transfer(to, amountWei);
  return { hash: tx.hash, wait: () => tx.wait() };
}

/* -------------------------------- gas ------------------------------------ */

/** Estimate the gas cost of a swap in native coin, for the review screen. */
export async function estimateGasCost(provider) {
  try {
    const { formatEther } = await loadEthers();
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
    const GAS_LIMIT = 250000n; // typical V2 swap with one hop
    return Number(formatEther(gasPrice * GAS_LIMIT));
  } catch {
    return null;
  }
}

/** Price impact vs. a tiny reference trade — flags thin liquidity. */
export async function getPriceImpact({ provider, chainId, fromToken, toToken, amountIn, quote }) {
  try {
    const probe = await getQuote({
      provider,
      chainId,
      fromToken,
      toToken,
      amountIn: Math.max(Number(amountIn) / 1000, 10 ** -fromToken.decimals),
      slippage: 0
    });
    if (!probe?.rate || !quote?.rate) return null;
    const impact = ((probe.rate - quote.rate) / probe.rate) * 100;
    return Math.max(0, impact);
  } catch {
    return null;
  }
}
