/**
 * SPOT TRADE — one order, executed in the user's wallet.
 *
 * THE RULES THIS FILE ENFORCES (and test/spot-trade-flow.test.mjs counts):
 *
 *   1. Nothing is approved, signed or sent unless `confirmed === true`. The
 *      only caller that can pass it is the «تایید و ارسال» click handler.
 *   2. A quote older than SPOT_QUOTE_MAX_AGE_MS is never executed. The caller
 *      must fetch a new one and show it for review again.
 *   3. The quote's minimum must respect the slippage the user accepted.
 *   4. Approval (if needed) is for the exact input amount, never unlimited.
 *   5. After approval the quote is fetched again. If it is now worse than the
 *      one the user reviewed, or it needs a different spender, the order stops
 *      with `stale` and nothing is signed. A better price is taken.
 *   6. A rejection by the user at ANY step ends the order as `cancelled`. The
 *      next transaction is never sent.
 *
 * Dependencies are passed in (the real lib/swap.js functions from the screen,
 * counting mocks from the tests), so this file has no network and no wallet
 * of its own.
 */

import { SPOT_QUOTE_MAX_AGE_MS, isQuoteStale, verifyQuoteProtection } from './spotMath.js';

export const SPOT_STATUS = Object.freeze({
  BLOCKED: 'blocked', // refused before any wallet interaction
  STALE: 'stale', // the price or route moved: review again
  CANCELLED: 'cancelled', // the user rejected a wallet prompt
  FAILED: 'failed',
  CONFIRMED: 'confirmed'
});

const KNOWN_CODES = new Set([
  'NO_ROUTE', 'NO_LIQUIDITY', 'QUOTE_NETWORK', 'QUOTE_FAILED', 'QUOTE_EXPIRED',
  'SLIPPAGE_EXCEEDED', 'FEE_NOT_APPLIED', 'FEE_RECIPIENT_MISMATCH', 'CONFIRMATION_TIMEOUT'
]);

/** True when the wallet (or the user) refused the request. */
export function isUserRejection(err) {
  if (!err) return false;
  if (err.code === 4001 || err.code === 'ACTION_REJECTED') return true;
  return /user (rejected|denied|cancelled)|user disapproved|ACTION_REJECTED/i.test(String(err.message ?? ''));
}

/**
 * Any thrown value → one short code the UI can translate. The raw message is
 * kept by the caller in `detail` for support, never shown as the headline.
 */
export function classifySpotError(err) {
  if (isUserRejection(err)) return 'USER_REJECTED';
  const msg = String(err?.message ?? '');
  if (KNOWN_CODES.has(msg)) return msg;
  if (err?.code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(msg)) return 'INSUFFICIENT_GAS';
  if (err?.code === 'CALL_EXCEPTION' || /execution reverted|revert/i.test(msg)) return 'TX_REVERTED';
  if (
    ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR'].includes(err?.code) ||
    /network|fetch|timeout|rpc|failed to fetch/i.test(msg)
  ) {
    return 'RPC_ERROR';
  }
  return 'TX_FAILED';
}

/**
 * Execute ONE spot order.
 *
 * @param {object}  input
 * @param {boolean} input.confirmed   must be exactly true (rule 1)
 * @param {object}  input.reviewed    { quote, fetchedAt, slippage, fromToken, toToken, amountText }
 * @param {object}  input.context     { signer, provider, chainId, owner, deadlineMinutes }
 * @param {object}  input.deps        { getQuote, needsApproval, approveToken, executeSwap }
 * @param {(stage:string, extra?:object) => void} [input.onStage]
 * @param {() => number} [input.now]
 * @returns {Promise<{status, code?, hash?, stage?, detail?}>}
 */
/** Identity of a route: the aggregator source plus the token path, case-insensitive. */
function routeKey(q) {
  const path = Array.isArray(q?.path) ? q.path.map((a) => String(a).toLowerCase()).join('>') : '';
  return `${q?.source ?? ''}|${path}`;
}

export async function runSpotOrder({ confirmed, reviewed, context, deps, onStage = () => {}, now = Date.now }) {
  // Rule 1 — the first line of the function, before anything can run.
  if (confirmed !== true) return { status: SPOT_STATUS.BLOCKED, code: 'NOT_CONFIRMED' };

  const quote = reviewed?.quote;
  if (!quote || quote.error) return { status: SPOT_STATUS.BLOCKED, code: 'QUOTE_MISSING' };

  // Rule 2 — stale is refused, not executed.
  if (isQuoteStale(reviewed.fetchedAt, now(), SPOT_QUOTE_MAX_AGE_MS)) {
    return { status: SPOT_STATUS.STALE, code: 'QUOTE_EXPIRED' };
  }

  // Rule 3 — the minimum must match the accepted slippage.
  const protectedQuote = verifyQuoteProtection({ quote, slippagePct: reviewed.slippage });
  if (!protectedQuote.ok) return { status: SPOT_STATUS.BLOCKED, code: protectedQuote.code };

  const { fromToken, toToken, slippage, amountText } = reviewed;
  const { signer, provider, chainId, owner, deadlineMinutes } = context;
  let stage = 'preparing';
  let hash = null;

  try {
    onStage(stage);

    // Rule 4 — exact amount, user-signed.
    const mustApprove = await deps.needsApproval({
      provider, chainId, token: fromToken, owner, amountWei: quote.amountInWei, quote
    });
    if (mustApprove) {
      stage = 'approving';
      onStage(stage);
      const approval = await deps.approveToken({
        signer, chainId, token: fromToken, amountWei: quote.amountInWei, quote
      });
      hash = approval.hash;
      onStage('approval-sent', { hash });
      await approval.wait();
    }

    // Rule 5 — quote again after the approval, and compare with the review.
    stage = 'quoting';
    onStage(stage);
    const fresh = await deps.getQuote({
      provider, chainId, fromToken, toToken, amountIn: amountText, slippage, fromAddress: owner
    });
    if (!fresh || fresh.error) return { status: SPOT_STATUS.FAILED, code: 'QUOTE_EXPIRED', stage };

    const freshProtected = verifyQuoteProtection({ quote: fresh, slippagePct: slippage });
    if (!freshProtected.ok) return { status: SPOT_STATUS.STALE, code: freshProtected.code, stage };

    if (fresh.minOutWei < quote.minOutWei) {
      return { status: SPOT_STATUS.STALE, code: 'PRICE_MOVED', stage };
    }
    if (fresh.amountInWei !== quote.amountInWei) {
      return { status: SPOT_STATUS.STALE, code: 'ROUTE_CHANGED', stage };
    }
    // Any change of route after review means the user saw a different path.
    // That is reviewed again, never signed: compare the source AND the token
    // path (getQuote returns `path`, not `source`).
    if (routeKey(fresh) !== routeKey(quote)) {
      return { status: SPOT_STATUS.STALE, code: 'ROUTE_CHANGED', stage };
    }

    // The one signature that moves the swap.
    stage = 'signing';
    onStage(stage);
    const tx = await deps.executeSwap({
      signer, chainId, fromToken, toToken, quote: fresh, deadlineMinutes
    });
    hash = tx.hash;
    stage = 'pending';
    onStage(stage, { hash });

    const receipt = await tx.wait();
    if (receipt && receipt.status === 0) {
      return { status: SPOT_STATUS.FAILED, code: 'TX_REVERTED', hash, stage };
    }
    return { status: SPOT_STATUS.CONFIRMED, hash, stage };
  } catch (err) {
    // Rule 6 — a rejection anywhere ends the order. Nothing else is sent.
    if (isUserRejection(err)) {
      return { status: SPOT_STATUS.CANCELLED, code: 'USER_REJECTED', hash, stage };
    }
    return {
      status: SPOT_STATUS.FAILED,
      code: classifySpotError(err),
      hash,
      stage,
      detail: String(err?.shortMessage || err?.message || '').slice(0, 160)
    };
  }
}
