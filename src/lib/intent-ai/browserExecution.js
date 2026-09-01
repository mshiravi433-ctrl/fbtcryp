/**
 * FBT INTENT OS — browser execution hooks.
 * ---------------------------------------------------------------------------
 * Wires the live swap engine, the connected wallet and (when present) Solana
 * to the execution runtime. Imported only from the chat UI — never from the
 * server — because it talks to ethers / wallet providers.
 *
 * Nothing here reports success. Receipts come from the chain.
 */

import { getToken } from '../chains.js';
import {
  getQuote,
  needsApproval,
  approveToken,
  executeSwap,
  getTokenBalance
} from '../swap.js';
import { createEvmAdapter, createSolanaAdapter, chainKind } from './chainAdapters.js';

function firstAddress(wallet) {
  return wallet?.address
    || wallet?.evmAddresses?.[0]
    || null;
}

function isUserReject(err) {
  return Number(err?.code) === 4001 || /user\s*(rejected|denied|cancell?ed)/i.test(String(err?.message || ''));
}

/**
 * Build runtime hooks bound to a live wallet.
 *
 * @param {object} wallet  WalletContext value (getSigner, getReadProvider, address, chainId)
 */
export function buildBrowserHooks(wallet) {
  const signerOf = () => (typeof wallet?.getSigner === 'function' ? wallet.getSigner() : null);
  const providerOf = async (chainId) => {
    if (typeof wallet?.getReadProvider === 'function') return wallet.getReadProvider(chainId || wallet.chainId);
    return null;
  };

  return {
    async getQuote(action) {
      const chainId = Number(action.chainId || wallet?.chainId);
      const fromSym = action.from || action.fromSymbol;
      const toSym = action.to || action.toSymbol;
      if (!fromSym || !toSym) return { ok: false, code: 'VALIDATION_FAILED' };
      const fromToken = getToken(chainId, fromSym);
      const toToken = getToken(chainId, toSym);
      if (!fromToken || !toToken) return { ok: false, code: 'VALIDATION_FAILED' };
      const provider = await providerOf(chainId);
      if (!provider) return { ok: false, code: 'NO_PROVIDER' };
      const amount = action.amount != null ? action.amount : action.amountUsd;
      const quote = await getQuote({
        provider,
        chainId,
        fromToken,
        toToken,
        amountIn: amount,
        slippage: 0.5
      });
      if (!quote || quote.error) return { ok: false, code: quote?.error || 'NO_QUOTE' };
      return { ok: true, ...quote, fromToken, toToken, chainId };
    },

    async getBalance(address) {
      const addr = address || firstAddress(wallet);
      const chainId = Number(wallet?.chainId);
      const provider = await providerOf(chainId);
      if (!provider || !addr) return { amount: null, valueUsd: null };
      const native = getToken(chainId, (wallet?.chain?.native?.symbol) || 'ETH') || { native: true, decimals: 18, symbol: 'ETH' };
      try {
        const bal = await getTokenBalance(provider, native, addr);
        return { amount: bal.formatted, valueUsd: null };
      } catch {
        return { amount: null, valueUsd: null };
      }
    },

    async checkAllowance(action) {
      const quote = action.quote;
      if (!quote?.fromToken || quote.fromToken.native) return false;
      const provider = await providerOf(quote.chainId);
      const owner = firstAddress(wallet);
      if (!provider || !owner || !quote.amountInWei) return false;
      return needsApproval({
        provider,
        chainId: quote.chainId,
        token: quote.fromToken,
        owner,
        amountWei: quote.amountInWei,
        quote
      });
    },

    async approve(action) {
      const signer = signerOf();
      const quote = action.quote;
      if (!signer || !quote?.fromToken) return { ok: false, code: 'NO_SIGNER' };
      try {
        const tx = await approveToken({
          signer,
          chainId: quote.chainId,
          token: quote.fromToken,
          amountWei: quote.amountInWei,
          quote
        });
        const receipt = await tx.wait();
        if (!receipt || (receipt.status !== 1 && receipt.status !== true)) return { ok: false, code: 'ALLOWANCE_REQUIRED' };
        return { ok: true, receipt, txHash: tx.hash };
      } catch (err) {
        if (isUserReject(err)) return { ok: false, code: 'USER_REJECTED' };
        return { ok: false, code: 'ALLOWANCE_REQUIRED' };
      }
    },

    async sendTransaction(actionOrTx) {
      const signer = signerOf();
      const quote = actionOrTx?.quote || actionOrTx;
      if (!signer) throw Object.assign(new Error('NO_SIGNER'), { code: 'NO_SIGNER' });
      const result = await executeSwap({
        signer,
        chainId: quote.chainId,
        fromToken: quote.fromToken,
        toToken: quote.toToken,
        quote
      });
      return { txHash: result.hash, wait: result.wait };
    },

    async waitForConfirmation(txHash) {
      const signer = signerOf();
      const provider = signer?.provider || await providerOf(wallet?.chainId);
      if (!provider?.waitForTransaction) {
        return { ok: false, code: 'NO_RECEIPT_SOURCE' };
      }
      const receipt = await provider.waitForTransaction(txHash);
      if (!receipt) return { ok: true, status: 'PENDING', txHash, receipt: null, confirmed: false };
      return {
        ok: receipt.status === 1,
        status: receipt.status === 1 ? 'CONFIRMED' : 'FAILED',
        txHash,
        receipt,
        confirmed: receipt.status === 1
      };
    }
  };
}

export function buildBrowserAdapters(wallet, solana = {}) {
  const hooks = buildBrowserHooks(wallet);
  const evm = createEvmAdapter({
    getBalance: hooks.getBalance,
    sendTransaction: hooks.sendTransaction,
    waitForConfirmation: hooks.waitForConfirmation
  });
  const solanaAdapter = createSolanaAdapter({
    getBalance: typeof solana.getBalance === 'function' ? solana.getBalance : undefined,
    sendTransaction: typeof solana.sendTransaction === 'function' ? solana.sendTransaction : undefined,
    waitForConfirmation: typeof solana.waitForConfirmation === 'function' ? solana.waitForConfirmation : undefined
  });
  return { evm, solana: solanaAdapter, hooks, kindFor: chainKind };
}
