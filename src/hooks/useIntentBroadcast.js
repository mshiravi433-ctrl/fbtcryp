/**
 * useIntentBroadcast — Intent AI's REAL execution bridge.
 * ---------------------------------------------------------------------------
 * Reported as (and this file is the fix for):
 *
 *   «مجاز شد — هنوز روی شبکه نیست»
 *   «امضا شد و با سیاست شما بررسی شد. این نسخه تراکنش را به شبکه نمی‌فرستد.»
 *   «کارمزد دریافت‌شده: 0.7 USDT» — while nothing ever reached a chain.
 *
 * The Intent AI panel could sign an EIP-712 authorization and then… stop.
 * Its "broadcast" attempt sent the MEV-shield envelope (chainId + deadline +
 * slippage) to eth_sendTransaction — an object with no `to`, no `data` and no
 * `value`, which no chain can execute. So every confirmation ended in the
 * honest-but-useless "authorized, not on network" receipt, behind a build flag
 * that was never enabled in production.
 *
 * This hook closes the loop with the SAME audited path the /swap screen runs:
 *
 *   resolve tokens → switch chain (wallet asks) → getQuote (Kyber/OpenOcean/
 *   Velora, fee verified on-chain) → ERC-20 approval when needed →
 *   executeSwap → real txHash → receipt tracking.
 *
 * Consent chain (STRONGER than the swap screen's, never weaker):
 *   1. the panel's Confirmation Gate (terms the user reviewed)
 *   2. the per-execution broadcast opt-in checkbox
 *   3. the EIP-712 intent signature in the wallet
 *   4. the wallet's own confirmation of the actual transaction
 *
 * Every failure is honest: { ok: false, code, message } — never a fake hash.
 * The hook never signs anything itself; the wallet signs twice.
 */

import { useCallback } from 'react';
import { getToken, explorerTx } from '../lib/chains';
import { getQuote, needsApproval, approveToken, executeSwap } from '../lib/swap';

/** Closed cause-code set for broadcast failures (mapped to i18n keys by the panel). */
export const BROADCAST_FAILURE_CODES = Object.freeze([
  'WALLET_NOT_CONNECTED',
  'CHAIN_SWITCH_REJECTED',
  'TOKEN_NOT_FOUND',
  'NO_QUOTE',
  'APPROVAL_REJECTED',
  'USER_REJECTED',
  'EXECUTION_FAILED',
  'NOT_SUPPORTED'
]);

const isUserRejection = (err) => {
  const code = Number(err?.code);
  const message = String(err?.message || err || '');
  return code === 4001 || code === 'ACTION_REJECTED'
    || /user\s*(rejected|denied|cancell?ed)/i.test(message);
};

const fail = (code, message) => ({ ok: false, code, message: String(message || code).slice(0, 200) });

/** Strictly-positive finite number or null. */
const posNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Which draft kinds this bridge can genuinely execute today.
 * Everything else answers NOT_SUPPORTED — honestly — instead of firing a
 * transaction that does something else than the user asked for.
 */
export function broadcastSupportedKind(kind) {
  return String(kind || '').toLowerCase() === 'swap';
}

export default function useIntentBroadcast(wallet) {
  /**
   * Execute a confirmed swap intent for real.
   *
   * @param {object} terms  locked terms from the Confirmation Gate:
   *                        { kind, chainId, fromSymbol, toSymbol, amountIn,
   *                          amountUsd, slippagePct }
   * @returns {Promise<{ok:true, txHash:string, chainId:number, wait:Function}
   *                |{ok:false, code:string, message:string}>}
   */
  const executeIntentBroadcast = useCallback(async (terms = {}) => {
    const runtime = typeof wallet?.getWalletRuntime === 'function' ? wallet.getWalletRuntime() : null;
    if (!runtime?.connected || !runtime?.provider) {
      return fail('WALLET_NOT_CONNECTED', 'Connect a wallet to send this to the network.');
    }
    if (!broadcastSupportedKind(terms.kind ?? 'swap')) {
      return fail('NOT_SUPPORTED', 'Only single-chain swaps can be broadcast from Intent AI today.');
    }

    const chainId = Number(terms.chainId);
    if (!Number.isFinite(chainId) || chainId <= 0) return fail('NO_QUOTE', 'The intent carries no chain.');

    const amountIn = posNumber(terms.amountIn) ?? posNumber(terms.amountUsd);
    if (amountIn === null) return fail('NO_QUOTE', 'The intent carries no amount.');

    const fromToken = getToken(chainId, String(terms.fromSymbol || '').toUpperCase());
    const toToken = getToken(chainId, String(terms.toSymbol || '').toUpperCase());
    if (!fromToken || !toToken) {
      return fail('TOKEN_NOT_FOUND', `No ${terms.fromSymbol}→${terms.toSymbol} pair on chain ${chainId}.`);
    }
    if (fromToken.symbol === toToken.symbol) {
      return fail('TOKEN_NOT_FOUND', 'Source and destination are the same token.');
    }

    /* The quote and the swap must run on the intent's chain. If the wallet is
       elsewhere, ask it to switch — the user confirms this in the wallet too. */
    try {
      if (Number(wallet?.chainId) !== chainId && typeof wallet?.switchChain === 'function') {
        await wallet.switchChain(chainId);
      }
    } catch (err) {
      if (isUserRejection(err)) return fail('CHAIN_SWITCH_REJECTED', 'The chain switch was declined in the wallet.');
      /* No switch helper (or already on the right chain): carry on — the
         signer below still targets the connected provider, and a wrong-chain
         attempt fails honestly at the quote or the wallet. */
    }

    let signer = null;
    try {
      signer = (typeof wallet?.getSigner === 'function' && wallet.getSigner()) || null;
      if (!signer) {
        const { BrowserProvider } = await import('ethers');
        const browserProvider = new BrowserProvider(runtime.provider);
        signer = await browserProvider.getSigner();
      }
    } catch { signer = null; }
    if (!signer) return fail('WALLET_NOT_CONNECTED', 'The connected wallet cannot sign transactions.');

    let provider = null;
    try {
      provider = typeof wallet?.getReadProvider === 'function' ? await wallet.getReadProvider(chainId) : null;
    } catch { provider = null; }

    /* 1 — a live, executable quote (the aggregator fee is verified inside). */
    let quote = null;
    try {
      quote = await getQuote({
        provider,
        chainId,
        fromToken,
        toToken,
        amountIn,
        slippage: posNumber(terms.slippagePct) ?? 0.5
      });
    } catch (err) {
      return fail('NO_QUOTE', err?.message || 'The live quote failed.');
    }
    if (!quote || quote.error) {
      return fail('NO_QUOTE', quote?.error || 'No live executable route is available right now.');
    }

    /* 2 — ERC-20 allowance, exact-amount, only when actually needed. */
    try {
      if (!fromToken.native && provider) {
        const amountWei = quote.amountInWei?.toString?.() ?? null;
        const owner = runtime.account;
        if (amountWei && owner && await needsApproval({ provider, chainId, token: fromToken, owner, amountWei, quote })) {
          const approval = await approveToken({ signer, chainId, token: fromToken, amountWei, quote });
          await approval.wait();
        }
      }
    } catch (err) {
      if (isUserRejection(err)) return fail('APPROVAL_REJECTED', 'The token approval was declined in the wallet.');
      return fail('APPROVAL_REJECTED', err?.message || 'The token approval failed.');
    }

    /* 3 — the swap itself. The wallet shows the real transaction; nothing is
       sent until the user accepts it there. */
    let tx = null;
    try {
      tx = await executeSwap({ signer, chainId, fromToken, toToken, quote });
    } catch (err) {
      if (isUserRejection(err)) return fail('USER_REJECTED', 'The transaction was declined in the wallet.');
      return fail('EXECUTION_FAILED', err?.message || 'The swap transaction failed.');
    }
    if (!tx?.hash) return fail('EXECUTION_FAILED', 'The wallet returned no transaction hash.');

    return { ok: true, txHash: tx.hash, chainId, wait: typeof tx.wait === 'function' ? tx.wait : null };
  }, [wallet]);

  /**
   * Track a broadcast transaction to a terminal state.
   * Uses the wallet provider's eth_getTransactionReceipt; never fabricates a
   * confirmation — no receipt means still pending.
   */
  const trackIntentTx = useCallback(async ({ txHash, chainId }) => {
    const runtime = typeof wallet?.getWalletRuntime === 'function' ? wallet.getWalletRuntime() : null;
    if (!runtime?.provider || !txHash) return null;
    try {
      const receipt = await runtime.provider.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      });
      if (!receipt) return { status: 'pending', confirmations: 0 };
      const ok = String(receipt.status) === '0x1' || receipt.status === 1 || receipt.status === true;
      return { status: ok ? 'confirmed' : 'failed', confirmations: Number(receipt.confirmations ?? 1) };
    } catch {
      return null;
    }
  }, [wallet]);

  const explorerUrl = useCallback(({ txHash, chainId }) => {
    try {
      return explorerTx(Number(chainId), String(txHash || '')) || null;
    } catch {
      return null;
    }
  }, []);

  return { executeIntentBroadcast, trackIntentTx, explorerUrl, broadcastSupportedKind };
}
