/**
 * COLLATERAL LOOP — BROWSER WIRING for loopRuntime.js.
 * ============================================================================
 * The runtime asks for semantic operations ("read the account", "simulate this
 * supply", "sign this borrow"); this file answers each one with the code the
 * rest of the Loan page already uses, so the loop cannot drift from it:
 *
 *   reads        lending.js           readUserAccount / readReserve /
 *                                     readOraclePrices / readAllowance
 *   simulation   lending-service.js   simulateLendingPlan (adapter-built
 *                                     unsigned tx → eth_call + estimateGas)
 *   lending tx   lending-service.js   executeLendingPlan (asserts chain and
 *                                     signer, exact approvals, receipt = 1)
 *   swap         swap.js              getQuote / needsApproval / approveToken /
 *                                     executeSwap — the platform-fee-verified
 *                                     path the Swap screen signs with
 *   guard        defi/executionGuards assertSignerContext before every prompt
 *
 * swap.js is imported on first use only: a user who never loops two different
 * assets never downloads the swap engine from this page.
 */

import { readUserAccount, readReserve, readOraclePrices, readAllowance, ERC20_MIN_ABI } from './lending.js';
import { simulateLendingPlan, executeLendingPlan } from './lending-service.js';
import { assertSignerContext } from './defi/executionGuards.js';

const loadEthers = () => import('ethers');
const loadSwap = () => import('./swap.js');

const GUARD_CODES = Object.freeze({
  EXECUTION_WRONG_CHAIN: 'WRONG_NETWORK',
  EXECUTION_ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
  EXECUTION_SIGNER_UNAVAILABLE: 'WALLET_NOT_CONNECTED',
  EXECUTION_BAD_OWNER: 'WALLET_NOT_CONNECTED',
  EXECUTION_ACCOUNT_UNREADABLE: 'WALLET_NOT_CONNECTED',
  EXECUTION_NETWORK_UNREADABLE: 'RPC_ERROR',
  EXECUTION_PROVIDER_UNAVAILABLE: 'RPC_ERROR'
});

export function createBrowserLoopDeps({ getReadProvider, getSigner } = {}) {
  /* One read provider per chain for the life of a run; a failed creation is
     not cached, so the next read tries again. */
  const providers = new Map();
  const provider = async (chainId) => {
    const key = Number(chainId);
    if (!providers.has(key)) {
      const pending = Promise.resolve().then(() => getReadProvider(key));
      providers.set(key, pending);
      pending.catch(() => providers.delete(key));
    }
    return providers.get(key);
  };
  const signer = async () => {
    const value = typeof getSigner === 'function' ? await getSigner() : null;
    if (!value) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
    return value;
  };

  return {
    async readAccount({ chainId, wallet }) {
      return readUserAccount({ provider: await provider(chainId), chainId, user: wallet });
    },
    async readReserve({ chainId, asset }) {
      return readReserve({ provider: await provider(chainId), chainId, asset });
    },
    async readPrices({ chainId, assets, reserves = null }) {
      const result = await readOraclePrices({ provider: await provider(chainId), chainId, assets, reserves });
      const out = {};
      for (const asset of assets || []) {
        const p = result?.prices?.[asset.id];
        if (p?.valid && Number(p.priceUsd) > 0) out[asset.id] = { usd: Number(p.priceUsd), base: p.priceBase };
      }
      return out;
    },
    async readTokenBalance({ chainId, asset, owner }) {
      const { Contract } = await loadEthers();
      const token = new Contract(asset.address, ERC20_MIN_ABI, await provider(chainId));
      return BigInt(await token.balanceOf(owner));
    },
    async readNativeBalance({ chainId, owner }) {
      return BigInt(await (await provider(chainId)).getBalance(owner));
    },
    async readPoolAllowance({ chainId, asset, owner }) {
      const value = await readAllowance({ provider: await provider(chainId), chainId, asset, owner });
      return value == null ? null : BigInt(value);
    },
    async simulateLending({ chainId, wallet, asset, step }) {
      return simulateLendingPlan({ provider: await provider(chainId), chainId, plan: { steps: [step] }, wallet, asset });
    },
    async executeLending({ chainId, wallet, asset, steps }) {
      return executeLendingPlan({
        signer: await signer(),
        provider: await provider(chainId),
        chainId,
        plan: { steps },
        asset,
        wallet
      });
    },
    async assertSigner({ chainId, wallet }) {
      let active;
      try { active = await signer(); } catch { return { ok: false, code: 'WALLET_NOT_CONNECTED' }; }
      try {
        await assertSignerContext(active, { owner: wallet, chainId });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: GUARD_CODES[error?.code] || 'WRONG_NETWORK' };
      }
    },
    async getQuote({ chainId, fromToken, toToken, amountIn, slippage, fromAddress }) {
      const swap = await loadSwap();
      return swap.getQuote({ provider: await provider(chainId), chainId, fromToken, toToken, amountIn, slippage, fromAddress });
    },
    async swapNeedsApproval({ chainId, token, owner, amountWei, quote }) {
      const swap = await loadSwap();
      return swap.needsApproval({ provider: await provider(chainId), chainId, token, owner, amountWei: BigInt(amountWei), quote });
    },
    async approveSwap({ chainId, token, amountWei, quote }) {
      const swap = await loadSwap();
      return swap.approveToken({ signer: await signer(), chainId, token, amountWei: BigInt(amountWei), quote });
    },
    async executeSwap({ chainId, fromToken, toToken, quote }) {
      const swap = await loadSwap();
      return swap.executeSwap({ signer: await signer(), chainId, fromToken, toToken, quote });
    }
  };
}
