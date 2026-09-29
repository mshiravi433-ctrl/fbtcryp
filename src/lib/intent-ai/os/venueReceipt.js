/**
 * WHEN THE VENUE ALREADY ANSWERED, DO NOT ASK.
 * ---------------------------------------------------------------------------
 * Reported (fa): a swap is done and the user comes back — and the chat asks
 * «برگشتی! خروجی چی شد؟» about a swap it can already see. For a STRATEGY STAGE
 * the answer is the chain (strategyReceipts.js proves it from a receipt), so no
 * question is needed. For a plain venue trip — «سواپ سولانا» hands off to
 * /solana, a token→token swap hands off to /swap — there is no plan to
 * reconcile against, and the old code had nothing to read: it asked every time,
 * including after a swap that had in fact gone through.
 *
 * What CAN be read is the venue's own device ledger. The swap screens write
 * every attempt to `swapHistory` (EVM and Solana alike) BEFORE signing and
 * confirm it with the transaction hash/signature the wallet returned. That row
 * is a real signal from a venue this app owns, and it is deliberately used for
 * exactly one thing: deciding whether the «how did it go?» question still needs
 * asking.
 *
 * WHAT THIS IS NOT — three boundaries that must not move:
 *   1. It is NOT a chain receipt and it NEVER settles a strategy stage. A money
 *      stage still needs verifyStrategySwap/verifyAaveStrategySupply to read
 *      the chain (see strategyReceipts.js); a device row cannot unlock it.
 *   2. It is NOT the user's word and it is NOT silence: the row exists only
 *      because a signed transaction came back from the wallet with a hash.
 *   3. It is NOT a claim about settlement. The message the chat writes says the
 *      swap was RECORDED ON THIS DEVICE; whether it confirmed on chain is the
 *      wallet's/explorer's to show, and the message points there.
 *
 * Fail-closed everywhere else: a 'pending' row (still in the wallet prompt), a
 * 'failed'/'cancelled' row, a row older than the hand-off, or a network that
 * does not match the venue the user actually opened all return null — and the
 * chat asks, as before.
 */
import { loadSwapHistory } from '../../swapHistory.js';

/* The two swap venues this app can hand a user off to. Anything else (bridge,
   farm, loan, stocks, perp…) has no equivalent device ledger and keeps the
   question. */
const SWAP_VENUES = Object.freeze(['/swap', '/solana']);

/**
 * The confirmed swap the venue recorded after this hand-off, or null.
 *
 * @param {object}   args
 * @param {string}   args.route  the route the user was sent to (`/solana?to=…`)
 * @param {number}   args.since  the hand-off timestamp (ms) — rows older than
 *                               the trip cannot be its outcome
 * @param {object[]} [args.rows] the venue ledger; injected for tests
 */
export function venueSwapReceipt({ route, since, rows = null } = {}) {
  const path = String(route || '').split('?')[0];
  if (!SWAP_VENUES.includes(path)) return null;
  const at = Number(since);
  if (!Number.isFinite(at) || at <= 0) return null;
  let list = rows;
  if (!Array.isArray(list)) {
    try { list = loadSwapHistory(); } catch { return null; }
  }
  if (!Array.isArray(list)) return null;
  const wantSolana = path === '/solana';
  return list.find((row) => {
    if (String(row?.status) !== 'confirmed') return false;
    /* No hash means nothing the wallet could have produced — not a receipt of
       any kind, on either network. */
    if (!row?.txHash) return false;
    const rowAt = Number(row?.at);
    if (!Number.isFinite(rowAt) || rowAt < at) return false;
    const rowSolana = String(row?.network || '') === 'solana';
    return wantSolana ? rowSolana : !rowSolana;
  }) || null;
}
