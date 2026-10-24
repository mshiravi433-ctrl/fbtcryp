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
 * Price AND (with a wallet) build in one call: LI.FI returns the unsigned
 * versioned transaction alongside the estimate, so the same request that the
 * user sees priced is the one they sign (after a refresh at swap time).
 *
 * ─── `account` IS OPTIONAL, AND THAT IS THE POINT ──────────────────────────
 * LI.FI cannot quote without a `fromAddress`, so this route used to be asked
 * only after a wallet was connected — which meant the first price on the screen
 * always came from a route that could not price. With De¹'s Solana chain
 * switched off upstream (2026-10-24) that first price was the FREE Jupiter one,
 * i.e. exactly the report.
 *
 * Without an account the SERVER prices against our own fee wallet and drops the
 * transaction it built, returning `priceOnly: true`. The user gets the
 * fee-paying route's number before they connect anything and nothing signable
 * ever reaches the browser; the moment an account is present this is the
 * ordinary price+build call.
 *
 * @param {object} p
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {string} p.amount     integer base units, as a string
 * @param {string} [p.account]  the user's Solana address — omitted for a price
 * @param {number} [p.slippageBps]
 */
export async function getLifiSolanaQuote({ inputMint, outputMint, amount, account, slippageBps }) {
  if (!amount || !/^\d+$/.test(String(amount)) || String(amount) === '0') {
    throw new Error('BAD_AMOUNT');
  }
  /* An account that was supplied must still be well-formed: a typo'd address
     must fail here, not as an opaque upstream refusal at signing time. */
  if (account != null && account !== '' && !isSolanaAddress(account)) throw new Error('BAD_TAKER');

  const params = new URLSearchParams({
    inputMint: String(inputMint),
    outputMint: String(outputMint),
    amount: String(amount)
  });
  if (isSolanaAddress(account)) params.set('account', account);
  if (Number.isFinite(slippageBps)) params.set('slippageBps', String(Math.round(slippageBps)));

  return solanaApiFetch(`${apiBase()}/solana/lifi/quote?${params}`);
}

/** Is the LI.FI Solana route configured to pay us? Answered by the server,
 *  because the receiver and the rate live in its environment. */
export async function lifiSolanaStatus() {
  return solanaApiFetch(`${apiBase()}/solana/lifi/status`);
}
