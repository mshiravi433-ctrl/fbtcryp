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
 * escrow or a dispute, and it must never grow one.
 *
 * ─── PAY TO PUBLISH, WHICH IS THE ANTI-SPAM MECHANISM ───────────────────────
 * A free board fills with adverts from people with nothing to sell. Charging
 * for the SLOT — not for the trade — costs a spammer real money per advert
 * while costing a genuine trader about the price of a coffee.
 *
 * A listing is therefore INVISIBLE until it is paid for. `liveUntil` is set
 * only by `activateListing`, and only after server-side on-chain verification.
 * There is no code path that publishes an unpaid row, which is the property
 * that matters: forgetting to pay cannot accidentally publish.
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
 * write.
 *
 * ─── LAST-WRITER-WINS IS ACCEPTABLE HERE, AND ONLY HERE ─────────────────────
 * server/store.js does read-modify-write with no locking, so two listings
 * posted in the same instant can lose one. For a classifieds board that is a
 * tolerable, self-healing failure. It would NOT be acceptable for anything
 * holding money, which is another reason money never touches this module.
 */

import { storeGet, storeSet } from './store.js';

const KEY = 'board:v1';

/**
 * Hard cap on stored listings.
 *
 * Not a product decision — a memory and bandwidth one. The whole board is read
 * into a serverless function on cold start, so it must stay small. At ~400
 * bytes per row, 300 rows is ~120 KB, which is a fast read and nowhere near
 * the 1 GB storage limit.
 */
const MAX_ROWS = 300;

/**
 * How long an UNPAID draft is kept before it is swept away.
 *
 * Long enough that somebody can fill the form, go and buy USDC, and come back;
 * short enough that abandoned drafts cannot accumulate and push paid listings
 * out of the 300-row cap.
 */
const DRAFT_TTL_MS = 24 * 3600_000;

/**
 * THE PRICE LIST. One source of truth, exported so the API, the UI and the
 * payment verifier all read the same numbers — a duplicated price is how the
 * screen advertises $5 and the server demands $25.
 *
 * Ordered cheapest first; `tierForAmount` relies on that.
 */
export const TIERS = [
  { id: 'd1', days: 1, usd: 1 },
  { id: 'd7', days: 7, usd: 5 },
  { id: 'd30', days: 30, usd: 25 }
];

/** The longest tier gets the highlighted card, so paying more shows. */
export const FEATURED_TIER = 'd30';

export const tierById = (id) => TIERS.find((t) => t.id === id) ?? null;

/**
 * Which tier does a payment of `usd` buy?
 *
 * Rounds DOWN to the best tier the money actually covers, and returns null
 * below the cheapest. Paying $3 buys one day, not seven — generous rounding
 * would let somebody buy 30 days for $25 by sending $24.99 and arguing.
 */
export function tierForAmount(usd) {
  const paid = Number(usd);
  if (!Number.isFinite(paid)) return null;
  let best = null;
  for (const t of TIERS) if (paid + 1e-9 >= t.usd) best = t;
  return best;
}

/* -------------------------------------------------------------------------- */
/* Sanitising                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Strip anything that could execute or deceive in someone else's client.
 *
 * These strings are rendered inside other users' apps, so the rules are the
 * same ones UsernameField already applies to display names: angle brackets and
 * quotes are removed outright rather than escaped and hoped for, and bidi
 * override characters are stripped because they let a string visually reverse
 * the text around it — a real spoofing technique. An attacker could otherwise
 * make "selling 100 USDT" read as something else entirely in the feed.
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
 * Contact handles are the field a scammer most wants to control, so the
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

/** Paid and still within its window. */
const isLive = (row, now) => Boolean(row?.liveUntil && row.liveUntil > now);

/** An unpaid draft that has not yet been swept. */
const isDraft = (row, now) => !row?.liveUntil && (row?.at ?? 0) + DRAFT_TTL_MS > now;

/** Anything worth keeping in storage. */
const isKeepable = (row, now) => isLive(row, now) || isDraft(row, now);

const decorate = (row) => ({
  ...row,
  featured: row.tier === FEATURED_TIER,
  days: tierById(row.tier)?.days ?? null
});

/**
 * The PUBLIC board: paid listings only.
 *
 * Drafts are excluded here and nowhere else needs to know — which is what
 * makes "unpaid adverts are invisible" a property of the data rather than of
 * whichever caller remembers to filter.
 *
 * Sorting happens on read rather than on write so a listing can expire without
 * anything having to run on a schedule — there is no cron on the free tier,
 * and a feature that silently depends on one is a feature that breaks.
 */
export async function readBoard() {
  const rows = await storeGet(KEY, []);
  if (!Array.isArray(rows)) return [];
  const now = Date.now();

  return rows
    .filter((r) => isLive(r, now))
    .map(decorate)
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return (b.at ?? 0) - (a.at ?? 0);
    });
}

/**
 * One wallet's own row, paid or not.
 *
 * Separate from readBoard so the owner can see and edit a draft that nobody
 * else can see. Without this, filling in the form and then reloading would
 * look like the advert had vanished.
 */
export async function myListing(owner) {
  const rows = await storeGet(KEY, []);
  if (!Array.isArray(rows) || !owner) return null;
  const now = Date.now();
  const mine = rows.find(
    (r) => r?.owner?.toLowerCase() === String(owner).toLowerCase() && isKeepable(r, now)
  );
  return mine ? { ...decorate(mine), live: isLive(mine, now) } : null;
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Create or replace a listing. Always as a DRAFT unless one is already paid.
 *
 * ONE LISTING PER WALLET, replaced rather than appended. Without that rule the
 * board is a spam surface even with payment: one payment would otherwise buy
 * unlimited rows.
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

  /*
   * A PAID WINDOW SURVIVES AN EDIT. The user bought time, not a specific
   * wording, and wiping it on a typo fix would be taking their money twice.
   * The paid tx is carried across for the same reason.
   */
  const prev = list.find((r) => r?.owner === owner);
  if (prev && isLive(prev, now)) {
    row.liveUntil = prev.liveUntil;
    row.tier = prev.tier;
    /* Both shapes: `paidTxs` is current, `paidTx` may exist on rows written
       before the replay fix and must keep blocking its hash. */
    if (prev.paidTx) row.paidTx = prev.paidTx;
    if (Array.isArray(prev.paidTxs)) row.paidTxs = prev.paidTxs;
  }

  const next = list.filter((r) => r && r.owner !== owner && isKeepable(r, now));
  next.unshift(row);

  await storeSet(KEY, next.slice(0, MAX_ROWS));
  return { ...decorate(row), live: isLive(row, now) };
}

/** Remove your own listing. Ownership is proven by the caller, not here. */
export async function removeListing(owner) {
  const rows = await storeGet(KEY, []);
  const list = Array.isArray(rows) ? rows : [];
  const now = Date.now();
  const next = list.filter((r) => r && r.owner !== owner && isKeepable(r, now));
  await storeSet(KEY, next);
  return { removed: list.length - next.length };
}

/**
 * Publish a listing after a payment has been VERIFIED on-chain.
 *
 * `tier` is decided by the caller from the AMOUNT ACTUALLY PAID, never from
 * anything the client claims — see server/app.js. Extending a listing that is
 * still live ADDS to the remaining time rather than replacing it, so paying
 * again a day early does not throw away what is left.
 */
export async function activateListing(owner, txHash, tier) {
  const t = tierById(tier);
  if (!t) throw new Error('BAD_TIER');

  const rows = await storeGet(KEY, []);
  const list = Array.isArray(rows) ? rows : [];
  const idx = list.findIndex((r) => r?.owner === owner);
  if (idx < 0) throw new Error('NO_LISTING');

  const now = Date.now();
  const base = isLive(list[idx], now) ? list[idx].liveUntil : now;
  const until = base + t.days * 24 * 3600_000;

  /*
   * ─── REAL BUG FOUND IN TESTING: EVERY SPENT HASH MUST BE REMEMBERED ──────
   * This used to store a single `paidTx`, overwriting it on each renewal. So
   * after a second payment the FIRST hash was forgotten — and `txAlreadyUsed`
   * would happily accept it again. One $1 payment could then be replayed for
   * free days forever, by the buyer or by anyone who read the hash off the
   * public chain.
   *
   * The list is capped because it is stored per row and the board has to stay
   * small; ten renewals is far more than any listing will see inside its
   * lifetime, and older hashes belong to windows that have long expired.
   */
  const spent = Array.isArray(list[idx].paidTxs) ? list[idx].paidTxs : [];
  const hash = String(txHash).toLowerCase();

  list[idx] = {
    ...list[idx],
    liveUntil: until,
    /* Keep the HIGHEST tier bought, so a $1 top-up cannot demote a featured
       card that was paid for at $25. */
    tier: bestTier(list[idx].tier, t.id),
    paidTxs: [hash, ...spent.filter((h) => h !== hash)].slice(0, 10)
  };
  await storeSet(KEY, list);
  return { liveUntil: until, tier: list[idx].tier, days: t.days };
}

/** Whichever of two tier ids is worth more. */
function bestTier(a, b) {
  const rank = (id) => TIERS.findIndex((t) => t.id === id);
  return rank(a) > rank(b) ? a : b;
}

/**
 * Has this transaction already paid for a listing?
 *
 * Scans EVERY spent hash on every row, not just the most recent one — see the
 * note in activateListing for the replay hole that created. `paidTx` is still
 * read so rows written by the previous version stay protected after a deploy.
 */
export async function txAlreadyUsed(txHash) {
  const rows = await storeGet(KEY, []);
  const needle = String(txHash).toLowerCase();
  return (Array.isArray(rows) ? rows : []).some((r) => {
    if (r?.paidTx === needle) return true;
    return Array.isArray(r?.paidTxs) && r.paidTxs.includes(needle);
  });
}
