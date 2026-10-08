/**
 * SOLANA SWAP CLIENT — LI.FI route
 * ---------------------------------------------------------------------------
 * The counterpart to server/solanaLifi.js, and the second fee-earning Solana
 * route next to De¹/OpenOcean. See that file for why it exists (reported:
 * «در سواپ سولانا فقط با ژوپیتر که کارمزد نمی‌گیریم مسیریابی می‌شه») and for the
 * live quote that proves LI.FI pays the receiver named in our request.
 *
 * ─── TWO THINGS THIS ROUTE DOES DIFFERENTLY FROM THE De¹ ONE ────────────────
 * 1. It needs a wallet address even to PRICE, because LI.FI builds the
 *    transaction into the quote response and will not accept a quote request
 *    without a `fromAddress`. So the screen asks for this route only once an
 *    account is connected — before that, the price can only come from De¹ or
 *    Jupiter. The transaction that arrives with it is used at SIGN time, after
 *    a fresh request: a quote is a price, not something to sign minutes later.
 *
 * 2. There is no `account`-less variant and therefore no way to price it
 *    without a wallet, which is why it is never the only source on screen.
 *
 * ─── WHY THE FEE IS STILL NOT IN THIS FILE ──────────────────────────────────
 * Identically to the De¹ client: `distributionFees` (our receiver + rate) is
 * attached by the server from its own configuration and verified there against
 * the response echo. If these values travelled from the browser they would be
 * attacker-editable, and "our revenue is optional" is a worse bug than a
 * missing route.
 */

import { apiBase } from './apiBase';
import { isSolanaAddress, solanaApiFetch } from './solanaOcean';

/**
 * Price AND build in one call: LI.FI returns the unsigned versioned
 * transaction alongside the estimate, so the same request that the user sees
 * priced is the one they sign (after a refresh at swap time).
 *
 * @param {object} p
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {string} p.amount     integer base units, as a string
 * @param {string} p.account    the user's Solana address (required by LI.FI)
 * @param {number} [p.slippageBps]
 */
export async function getLifiSolanaQuote({ inputMint, outputMint, amount, account, slippageBps }) {
  if (!isSolanaAddress(account)) throw new Error('BAD_TAKER');
  if (!amount || !/^\d+$/.test(String(amount)) || String(amount) === '0') {
    throw new Error('BAD_AMOUNT');
  }

  const params = new URLSearchParams({
    inputMint: String(inputMint),
    outputMint: String(outputMint),
    amount: String(amount),
    account
  });
  if (Number.isFinite(slippageBps)) params.set('slippageBps', String(Math.round(slippageBps)));

  return solanaApiFetch(`${apiBase()}/solana/lifi/quote?${params}`);
}

/** Is the LI.FI Solana route configured to pay us? Answered by the server,
 *  because the receiver and the rate live in its environment. */
export async function lifiSolanaStatus() {
  return solanaApiFetch(`${apiBase()}/solana/lifi/status`);
}
