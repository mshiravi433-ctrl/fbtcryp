/**
 * P2P CLASSIFIEDS BOARD — listings only, never funds.
 * ---------------------------------------------------------------------------
 *
 * ─── THE LEGAL LINE THIS MODULE IS BUILT ON ─────────────────────────────────
 * FinCEN's CVC guidance draws a precise boundary, and everything here sits on
 * the safe side of it deliberately:
 *
 *   "if a CVC trading platform only provides a forum where buyers and sellers
 *    of CVC post their bids and offers (with or without automatic matching of
 *    counterparties), and the parties themselves settle any matched
 *    transactions through an outside venue ... the trading platform does not
 *    qualify as a money transmitter"
 *
 * The other side of that line — holding funds in escrow for even a moment,
 * arbitrating disputes, or taking a cut OF THE TRANSFER — makes the operator a
 * money transmitter. In the US that is a felony under 18 U.S.C. 1960 when
 * unlicensed, and state licences run $50k-$500k each.
 *
 * So this module can do exactly three things: store a listing, return
 * listings, and remove a listing. It has no concept of a trade, a balance, an
 * escrow or a dispute, and it must never grow one. The revenue comes from
 * PROMOTION (paying to be seen) and from the swap the counterparties make
 * anyway — never from the transfer between them.
 *
 * ─── WHY EVERYTHING LIVES IN ONE BLOB KEY ───────────────────────────────────
 * Vercel Blob's free tier allows 10,000 simple operations per MONTH. The
 * obvious design — one object per listing, read-modify-write per change —
 * spends that in days: a single feed load would cost one op per listing, so
 * 200 users refreshing a 50-row board is 10,000 ops in an afternoon.
 *
 * Instead the whole board is ONE json document, and `storeGet` keeps it in
 * process memory after the first read. A warm instance therefore serves the
 * feed for ZERO ops; only a cold start pays one read, and only a write pays a
 * write. That is the difference between this feature being free and it being
 * the thing that takes the site down at month end.
 *
 * The cost of that choice is honest: the board is capped, because one document
 * has to stay small enough to read on every cold start.
 *
 * ─── LAST-WRITER-WINS IS ACCEPTABLE HERE, AND ONLY HERE ─────────────────────
 * server/store.js does read-modify-write with no locking, so two listings
 * posted in the same instant can lose one. For a classifieds board that is a
 * tolerable, self-healing failure (the user sees it did not appear and posts
 * again). It would NOT be acceptable for anything holding money, which is
 * another reason money never touches this module.
 */

import { storeGet, storeSet } from './store.js';

const KEY = 'board:v1';

/**
 * Hard cap on stored listings.
 *
 * Not a product decision — a memory and bandwidth one. The whole board is read
 * into a serverless function on cold start, so it must stay small. At ~400
 * bytes per row, 300 rows is ~120 KB, which is a fast read and nowhere near
 * the 1 GB storage limit. Raising this without re-checking that arithmetic is
 * how a free tier turns into a bill.
 */
const MAX_ROWS = 300;

/** A listing expires on its own. Nobody has to clean up, and stale ads die. */
const TTL_DAYS = 14;
const TTL_MS = TTL_DAYS * 24 * 3600_000;

/** How long a paid promotion lasts. */
export const PROMO_DAYS = 30;

/* -------------------------------------------------------------------------- */
/* Sanitising                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Strip anything that could execute or deceive in someone else's client.
 *
 * These strings are rendered inside other users' apps, so the rules are the
 * same ones UsernameField already applies to display names, for the same
 * reason: angle brackets and quotes are removed outright rather than escaped
 * and hoped for, and bidi override characters are stripped because they let a
 * string visually reverse the text around it — a real spoofing technique, not
 * a theoretical one. An attacker could otherwise make "selling 100 USDT" read
 * as something else entirely in the feed.
 */
// eslint-disable-next-line no-misleading-character-class
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

function clean(value, max) {
  return String(value ?? '')
    .replace(BIDI, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const SIDES = new Set(['buy', 'sell']);

/**
 * Contact handles are the one field a scammer most wants to control, so the
 * charset is deliberately narrow: letters, digits, dot, underscore, dash, plus
 * and @. No URLs — a link in a contact field is how a phishing site gets
 * distributed through a listing.
 */
function cleanContact(value) {
  return String(value ?? '')
    .replace(BIDI, '')
    .replace(/[^A-Za-z0-9._+@-]/g, '')
    .slice(0, 40);
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

const isLive = (row, now) => (row.at ?? 0) + TTL_MS > now;
const promoLive = (row, now) => Boolean(row.promoUntil && row.promoUntil > now);

/**
 * Every live listing, promoted rows first.
 *
 * Sorting happens on read rather than on write so a promotion can expire
 * without anything having to run on a schedule — there is no cron on the free
 * tier, and a feature that silently depends on one is a feature that breaks.
 */
export async function readBoard() {
  const rows = await storeGet(KEY, []);
  if (!Array.isArray(rows)) return [];
  const now = Date.now();

  return rows
    .filter((r) => r && isLive(r, now))
    .map((r) => ({ ...r, promoted: promoLive(r, now) }))
    .sort((a, b) => {
      if (a.promoted !== b.promoted) return a.promoted ? -1 : 1;
      return (b.at ?? 0) - (a.at ?? 0);
    });
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Post or replace a listing.
 *
 * ONE LISTING PER WALLET, replaced rather than appended. Without that rule the
 * board is a spam surface: a single wallet could fill every row for free and
 * the paid promotion would be worthless. It also means "edit" needs no extra
 * endpoint — reposting overwrites.
 */
export async function putListing(input) {
  const owner = String(input?.owner ?? '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) throw new Error('BAD_OWNER');

  const side = String(input?.side ?? '').toLowerCase();
  if (!SIDES.has(side)) throw new Error('BAD_SIDE');

  const asset = clean(input?.asset, 12).toUpperCase();
  if (!asset) throw new Error('BAD_ASSET');

  const contact = cleanContact(input?.contact);
  if (contact.length < 3) throw new Error('BAD_CONTACT');

  /*
   * Amount and price are stored as free TEXT, not numbers, and that is
   * deliberate. The moment we parse them into a rate we are quoting a market,
   * and a quote implies we stand behind it. A string is a claim by the person
   * who wrote it, which is what a classified ad actually is.
   */
  const row = {
    owner,
    side,
    asset,
    amount: clean(input?.amount, 24),
    price: clean(input?.price, 32),
    method: clean(input?.method, 28),
    city: clean(input?.city, 28),
    contact,
    note: clean(input?.note, 140),
    at: Date.now()
  };

  const rows = await storeGet(KEY, []);
  const list = Array.isArray(rows) ? rows : [];
  const now = Date.now();

  const prev = list.find((r) => r?.owner === owner);
  /* A paid promotion survives an edit — the user bought time, not a specific
     wording, and losing it on a typo fix would be theft. */
  if (prev?.promoUntil && prev.promoUntil > now) row.promoUntil = prev.promoUntil;
  if (prev?.paidTx) row.paidTx = prev.paidTx;

  const next = list.filter((r) => r && r.owner !== owner && isLive(r, now));
  next.unshift(row);

  await storeSet(KEY, next.slice(0, MAX_ROWS));
  return { ...row, promoted: promoLive(row, now) };
}

/** Remove your own listing. Ownership is proven by the caller, not here. */
export async function removeListing(owner) {
  const rows = await storeGet(KEY, []);
  const list = Array.isArray(rows) ? rows : [];
  const now = Date.now();
  const next = list.filter((r) => r && r.owner !== owner && isLive(r, now));
  await storeSet(KEY, next);
  return { removed: list.length - next.length };
}

/**
 * Mark a listing as promoted after a payment has been VERIFIED on-chain.
 *
 * The transaction hash is recorded so the same payment can never be spent
 * twice — checked against every stored row before this is called.
 */
export async function promoteListing(owner, txHash) {
  const rows = await storeGet(KEY, []);
  const list = Array.isArray(rows) ? rows : [];
  const idx = list.findIndex((r) => r?.owner === owner);
  if (idx < 0) throw new Error('NO_LISTING');

  const until = Date.now() + PROMO_DAYS * 24 * 3600_000;
  list[idx] = { ...list[idx], promoUntil: until, paidTx: String(txHash).toLowerCase() };
  await storeSet(KEY, list);
  return { promoUntil: until };
}

/** Has this transaction already bought a promotion? */
export async function txAlreadyUsed(txHash) {
  const rows = await storeGet(KEY, []);
  const needle = String(txHash).toLowerCase();
  return (Array.isArray(rows) ? rows : []).some((r) => r?.paidTx === needle);
}
