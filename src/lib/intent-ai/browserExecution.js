/**
 * FBT INTENT OS — browser execution hooks.
 * ---------------------------------------------------------------------------
 * Wires the live swap engine and connected EVM wallet to the execution
 * runtime. This is browser-only: private keys never leave WalletContext and
 * nothing reports success without a chain receipt.
 */

import { EVM_CHAINS, getToken } from '../chains.js';
import {
  getQuote,
  needsApproval,
  approveToken,
  executeSwap,
  getTokenBalance
} from '../swap.js';
import { createSwapQuoteReview } from './quoteReview.js';
import { createEvmAdapter, createSolanaAdapter, chainKind } from './chainAdapters.js';

function firstAddress(wallet) {
  return wallet?.address
    || wallet?.evmAddresses?.[0]
    || null;
}

function isUserReject(err) {
  return Number(err?.code) === 4001 || /user\s*(rejected|denied|cancell?ed)/i.test(String(err?.message || ''));
}

async function signerForChain(wallet, chainId) {
  const target = Number(chainId);
  if (!Number.isFinite(target) || !EVM_CHAINS[target]) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  if (typeof wallet?.getSigner !== 'function') return { ok: false, code: 'NO_SIGNER' };

  let signer = wallet.getSigner();
  if (!signer) return { ok: false, code: 'NO_SIGNER' };
  const networkId = async (candidate) => {
    try {
      const network = await candidate?.provider?.getNetwork?.();
      const value = Number(network?.chainId);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };

  let current = await networkId(signer);
  if (current === target) return { ok: true, signer };
  if (typeof wallet.switchChain !== 'function') return { ok: false, code: 'CHAIN_MISMATCH' };

  let switched = false;
  try { switched = await wallet.switchChain(target); } catch (err) {
    return { ok: false, code: isUserReject(err) ? 'USER_REJECTED' : 'CHAIN_SWITCH_FAILED' };
  }
  if (switched !== true) return { ok: false, code: 'CHAIN_SWITCH_FAILED' };

  /* wallet_switchEthereumChain and `chainChanged` are asynchronous. Do not
     trust the React chain label; inspect the actual signer provider before any
     approval or swap signature is requested. */
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    signer = wallet.getSigner();
    current = await networkId(signer);
    if (current === target) return { ok: true, signer };
  }
  return { ok: false, code: 'CHAIN_MISMATCH' };
}

async function requestSwapQuote(action, wallet, providerOf) {
  const chainId = Number(action?.chainId);
  const fromSym = action?.from || action?.fromSymbol;
  const toSym = action?.to || action?.toSymbol;
  const amount = action?.amount;
  if (!Number.isFinite(chainId) || !EVM_CHAINS[chainId] || !fromSym || !toSym) {
    return { ok: false, code: 'VALIDATION_FAILED' };
  }
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return { ok: false, code: 'AMOUNT_UNIT_REQUIRED' };
  }

  const fromToken = getToken(chainId, fromSym);
  const toToken = getToken(chainId, toSym);
  if (!fromToken || !toToken) return { ok: false, code: 'TOKEN_NOT_LISTED' };
  if (fromToken.symbol === toToken.symbol && String(fromToken.address || '').toLowerCase() === String(toToken.address || '').toLowerCase()) {
    return { ok: false, code: 'IDENTICAL_ASSETS' };
  }

  const provider = await providerOf(chainId);
  if (!provider) return { ok: false, code: 'NO_PROVIDER' };
  const fromAddress = firstAddress(wallet);
  let quote = null;
  try {
    quote = await getQuote({
      provider,
      chainId,
      fromToken,
      toToken,
      amountIn: String(amount),
      slippage: 0.5,
      fromAddress
    });
  } catch (err) {
    return { ok: false, code: String(err?.message || 'QUOTE_FAILED').slice(0, 80) };
  }
  if (!quote || quote.error) return { ok: false, code: quote?.error || 'NO_QUOTE' };
  return { ok: true, ...quote, fromToken, toToken, chainId };
}

/**
 * Get a live, executable quote and reduce it to the serializable terms shown in
 * the chat card. Never returns calldata or wallet secrets.
 */
export async function getSwapQuoteReview(action, wallet, { now = Date.now() } = {}) {
  const chainId = Number(action?.chainId);
  if (!Number.isFinite(chainId) || !EVM_CHAINS[chainId]) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
  const providerOf = async (id) => {
    if (typeof wallet?.getReadProvider === 'function') return wallet.getReadProvider(id);
    return null;
  };
  const quote = await requestSwapQuote(action, wallet, providerOf);
  if (!quote.ok) return quote;
  return createSwapQuoteReview({
    action,
    quote,
    networkName: EVM_CHAINS[chainId]?.name,
    now
  });
}

/**
 * Build runtime hooks bound to a live wallet.
 *
 * @param {object} wallet WalletContext value (getSigner, getReadProvider,
 *   address, chainId, switchChain)
 */
export function buildBrowserHooks(wallet) {
  const signerOf = () => (typeof wallet?.getSigner === 'function' ? wallet.getSigner() : null);
  const providerOf = async (chainId) => {
    if (typeof wallet?.getReadProvider === 'function') return wallet.getReadProvider(chainId || wallet.chainId);
    return null;
  };

  return {
    async getQuote(action) {
      return requestSwapQuote(action, wallet, providerOf);
    },

    async getBalance(address, action = {}) {
      const addr = address || firstAddress(wallet);
      const chainId = Number(action?.chainId);
      const symbol = action?.from || action?.fromSymbol;
      const token = Number.isFinite(chainId) ? getToken(chainId, symbol) : null;
      if (!addr || !token) return { ok: false, code: 'BALANCE_UNVERIFIED' };
      const provider = await providerOf(chainId);
      if (!provider) return { ok: false, code: 'BALANCE_UNVERIFIED' };
      try {
        const balance = await getTokenBalance(provider, token, addr);
        return {
          ok: true,
          raw: String(balance.raw),
          amount: String(balance.formatted),
          symbol: token.symbol,
          chainId,
          decimals: token.decimals,
          tokenAddress: token.native ? null : token.address
        };
      } catch {
        return { ok: false, code: 'BALANCE_UNVERIFIED' };
      }
    },

    async checkAllowance(action) {
      const quote = action.quote;
      if (!quote?.fromToken) throw new Error('ALLOWANCE_READ_FAILED');
      if (quote.fromToken.native) return false;
      const provider = await providerOf(quote.chainId);
      const owner = firstAddress(wallet);
      if (!provider || !owner || quote.amountInWei == null) throw new Error('ALLOWANCE_READ_FAILED');
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
      const quote = action.quote;
      if (!quote?.fromToken) return { ok: false, code: 'NO_SIGNER' };
      const ready = await signerForChain(wallet, quote.chainId);
      if (!ready.ok) return ready;
      try {
        const tx = await approveToken({
          signer: ready.signer,
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
      const quote = actionOrTx?.quote || actionOrTx;
      const ready = await signerForChain(wallet, quote?.chainId);
      if (!ready.ok) throw Object.assign(new Error(ready.code), { code: ready.code });
      const result = await executeSwap({
        signer: ready.signer,
        chainId: quote.chainId,
        fromToken: quote.fromToken,
        toToken: quote.toToken,
        quote
      });
      return { txHash: result.hash, wait: result.wait };
    },

    async waitForConfirmation(txHash, action = {}) {
      const chainId = Number(action?.chainId);
      const provider = Number.isFinite(chainId) ? await providerOf(chainId) : signerOf()?.provider;
      if (!provider?.waitForTransaction) return { ok: false, code: 'NO_RECEIPT_SOURCE' };
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
