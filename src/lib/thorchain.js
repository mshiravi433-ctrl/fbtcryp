/**
 * THORCHAIN AFFILIATE — the address, and the rules that govern it.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS IS THE MOST DURABLE REVENUE LINE WE HAVE ──────────────────────
 * Every other affiliate programme reviewed either sits behind a bank (which
 * needs a W-8BEN naming a country, and OFAC FAQ 54 says a W-8 showing Iran
 * makes the account restricted), behind KYC, or asks us to hand our own swap
 * customer to a competitor.
 *
 * THORChain asks for none of that. There is no account, no company, no form
 * and no counterparty who can close anything — the affiliate is just an
 * address in a swap memo, validated by consensus. Nobody can take it away
 * because nobody is involved.
 *
 * It also does not cannibalise us: THORChain swaps NATIVE Bitcoin for NATIVE
 * Ethereum, which our ERC-20 aggregator cannot do at all. It adds a trade we
 * do not have rather than re-routing one we do.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── VERIFIED LIVE, NOT ASSUMED ─────────────────────────────────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * The owner's address was checked against THORChain's own node before being
 * written here, twice, because a typo in this constant would send every
 * affiliate fee we ever earn to an address nobody controls:
 *
 *   1. It decodes. `/cosmos/bank/v1beta1/balances/<addr>` returns
 *      `{"balances":[],...}` rather than a bech32 decode error. An invalid
 *      address fails here.
 *
 *   2. It EARNS. A live quote with `affiliate=<addr>&affiliate_bps=70`
 *      returns `"affiliate": "2354442"` — the network actually computed a fee
 *      for this address. Point 1 alone would not prove that.
 *
 * ─── AND THE FEE MATHS, MEASURED RATHER THAN READ ───────────────────────────
 * Three quotes on the same pair and amount (BTC.BTC -> ETH.ETH, 0.1 BTC):
 *
 *     bps      user receives      affiliate      user's real cost
 *       0        336,338,455              0        —
 *      70        333,981,328      2,354,442        70.1 bps
 *    1000        302,703,339     33,635,155      1000.0 bps
 *
 * The user's actual loss matches the requested bps almost exactly. This
 * MATTERS because it corrects something I told the owner: I read
 * `PROTOCOLAFFILIATEFEEBASISPOINTS: 1200` in the live mimir dump and reported
 * that the network adds ~12% on top of our fee, so a 70 bps setting would
 * cost the user ~78 bps.
 *
 * That was wrong. The mimir key exists, but ADR-016 which defines it is
 * marked "Status: Proposed" and says in its own text "(this mimir needs to be
 * implemented)". The key is present and inert. The measurement above is what
 * the network actually does, and it beats the configuration dump.
 *
 * The lesson worth keeping: a value being present in a config endpoint does
 * not mean the code reads it.
 */

/**
 * The affiliate address. Overridable per build, with the verified address as
 * the default so a missing env var degrades to "still earns" rather than
 * "silently earns nothing".
 *
 * ─── WHY THIS IS SAFE AS A PUBLIC VITE_ VARIABLE ────────────────────────────
 * It is a RECEIVING address, exactly like `VITE_PAYOUT_EVM` already in this
 * repo. It appears in every swap memo on a public blockchain by design — it
 * is about as secret as a bank account number printed on an invoice. The
 * twelve-word recovery phrase that controls it is a different thing entirely
 * and must never enter this repository, any env var, or any chat.
 */
const env = (k) => (typeof import.meta !== 'undefined' ? import.meta.env?.[k] : undefined) || '';

export const THOR_AFFILIATE =
  env('VITE_THOR_AFFILIATE') || 'thor12cqv53jqz6tnzmlsg9y207xe83raeem8nywqxt';

/**
 * bech32 for THORChain: `thor1` + 38 chars from the bech32 alphabet.
 *
 * The alphabet deliberately EXCLUDES `1`, `b`, `i` and `o` — the four
 * characters most often confused by eye — so checking the charset catches a
 * whole class of transcription slip that a length check alone would not.
 *
 * ─── WHAT THIS DOES NOT DO, STATED SO NOBODY RELIES ON IT ───────────────────
 * It is a FORMAT check, not a CHECKSUM check. Swapping one valid bech32
 * character for another valid one passes here — I confirmed that while
 * testing this function, changing the final `t` to an `l` and watching it
 * return true.
 *
 * A real bech32 checksum would catch that, and implementing one is a hundred
 * lines plus a dependency for a value that changes approximately never. So
 * the guarantee comes from somewhere better instead: the address in this file
 * was verified against THORChain's own node — it decodes, and a live quote
 * computed a real fee for it. That is a stronger check than any local
 * validator, because it is the network itself agreeing.
 *
 * This function's job is to catch an obviously-wrong env override (an EVM
 * address, a Tron address, an empty string), not to re-derive cryptography.
 */
export const isThorAddress = (a) =>
  /^thor1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(String(a ?? '').trim());

/**
 * ─── THE FEE CAP IS 1000 bps, AND IT COMES FROM A REAL VULNERABILITY ────────
 * Not a marketing limit. In July 2021 a researcher disclosed that THORChain
 * did no bounds checking on the affiliate field at all, so a crafted memo
 * could claim an unbounded share. The 10% ceiling was added in the fix
 * (thornode issue 1049). Requesting more is rejected outright — verified: 1500
 * is refused, 1000 is accepted.
 */
export const THOR_MAX_BPS = 1000;

/**
 * Our rate.
 *
 * Matches the 70 bps charged on EVM swaps, deliberately. A user who bridges
 * BTC and then swaps a token should not discover two different house rates —
 * consistency is worth more here than optimising one line.
 */
export const THOR_AFFILIATE_BPS = Number(env('VITE_THOR_AFFILIATE_BPS') || 70);

/**
 * Clamp anything before it reaches a memo.
 *
 * `Number(null)` is 0 and 0 is finite, so the null check has to come FIRST —
 * a rule this repo has already been bitten by once in `validateOrder`.
 */
export function clampBps(bps) {
  if (bps == null) return THOR_AFFILIATE_BPS;
  const n = Number(bps);
  if (!Number.isFinite(n) || n < 0) return THOR_AFFILIATE_BPS;
  return Math.min(Math.floor(n), THOR_MAX_BPS);
}

/**
 * Is the configured affiliate usable at all?
 *
 * Called before anything is offered to a user. An invalid address does not
 * fail the swap — THORChain skips an unparseable affiliate and executes
 * anyway — so the failure mode is silent lost revenue, which is precisely the
 * kind of bug that survives for months.
 */
export const thorConfigured = () => isThorAddress(THOR_AFFILIATE);
