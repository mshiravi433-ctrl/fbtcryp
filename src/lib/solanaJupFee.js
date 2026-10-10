/**
 * SOLANA SWAP CLIENT — Jupiter's own Swap API, WITH our platform fee
 * ---------------------------------------------------------------------------
 * The counterpart to server/solanaJupFee.js, and the third fee-earning Solana
 * route next to De¹/OpenOcean and LI.FI.
 *
 * ─── WHY A SECOND JUPITER CLIENT EXISTS ────────────────────────────────────
 * lib/solana.js already talks to Jupiter — through the **V2 `/order`** endpoint,
 * whose integrator fee is the Referral Program: a `referralAccount` plus a
 * `referralTokenAccount` per fee mint, all created on-chain, which the payout
 * wallet has no SOL to create. Jupiter documents that failure as silent, so
 * that path earns nothing and looks identical to a working one. This client
 * uses the **Metis Swap API** instead, where `platformFeeBps` + a `feeAccount`
 * is the whole fee mechanism — no referral program, no upstream key.
 *
 * Two Jupiter clients is not duplication: they call different endpoints, need
 * different signing (V2 signs only and lands through Jupiter's own /execute;
 * this one returns a transaction WE broadcast), and only one of them can pay
 * us. Confusing them is exactly what `provider: 'jupfee'` vs `'jupiter'`
 * prevents on the screen.
 *
 * ─── WHY IT GOES THROUGH OUR SERVER ────────────────────────────────────────
 * `feeAccount` decides where our revenue lands and `platformFeeBps` decides how
 * much the user pays on top of the route. Both are attached server-side from
 * server env and verified against the upstream echo there, so neither is
 * editable from a browser. Same boundary as lib/solanaOcean.js.
 */

import { apiBase } from './apiBase';
import { isSolanaAddress, solanaApiFetch } from './solanaOcean';

/**
 * Price only — and only when this pair can actually pay us.
 *
 * The server answers 503 JUP_FEE_NOT_CONFIGURED when it holds no fee account
 * for either mint; the screen treats that as "this paid route does not exist
 * for this pair" and moves on, which is why the error is a code and not a
 * network failure.
 *
 * @param {object} p
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {string} p.amount      integer base units, as a string
 * @param {number} [p.slippageBps]
 */
export async function getJupFeeQuote({ inputMint, outputMint, amount, slippageBps }) {
  if (!isSolanaAddress(inputMint) || !isSolanaAddress(outputMint)) throw new Error('BAD_MINT');
  if (inputMint === outputMint) throw new Error('SAME_TOKEN');
  if (!amount || !/^\d+$/.test(String(amount)) || String(amount) === '0') {
    throw new Error('BAD_AMOUNT');
  }

  const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
  if (Number.isFinite(slippageBps)) params.set('slippageBps', String(Math.round(slippageBps)));

  return solanaApiFetch(`${apiBase()}/solana/jupfee/quote?${params}`);
}

/**
 * Price AND build, server-side in one round trip.
 *
 * Jupiter's `/swap` consumes the whole `quoteResponse` from `/quote`; letting
 * that object travel to the browser and back would hand a caller an editable
 * copy of our fee fields, and caching it in the server would break on
 * serverless, where the build lands on a different instance than the quote. So
 * the server re-quotes and builds together — which is also the freshness rule
 * the whole screen follows: what the user signs is priced seconds before they
 * sign it.
 *
 * @param {object} p
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {string} p.amount
 * @param {string} p.account     the user's Solana address (the signer/taker)
 * @param {number} [p.slippageBps]
 */
export async function buildJupFeeSwap({ inputMint, outputMint, amount, account, slippageBps }) {
  if (!isSolanaAddress(account)) throw new Error('BAD_TAKER');

  return solanaApiFetch(`${apiBase()}/solana/jupfee/swap`, {
    method: 'POST',
    body: JSON.stringify({
      inputMint,
      outputMint,
      amount: String(amount),
      account,
      ...(Number.isFinite(slippageBps) ? { slippageBps: Math.round(slippageBps) } : {})
    })
  });
}

/**
 * Which mints can this route collect a fee in, and at what rate?
 *
 * Answered by the server, because the fee account and the rate live in its
 * environment. The screen uses it to skip a round trip that could only answer
 * 503 — and, when the free route ends up running, to say why.
 */
export async function jupFeeStatus() {
  return solanaApiFetch(`${apiBase()}/solana/jupfee/status`);
}
