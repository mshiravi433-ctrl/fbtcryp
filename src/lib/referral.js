/**
 * REFERRAL TRACKING
 * ---------------------------------------------------------------------------
 * Someone arrives with `?ref=CODE`, we remember who sent them, and that
 * referrer earns a share of the fee their invitee generates.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
 * It does not split the fee on-chain, and that limitation is worth stating
 * plainly rather than discovering later.
 *
 * Our 0.70% is collected by KyberSwap's router INSIDE the user's own swap
 * transaction and paid to a single `feeReceiver` address (see
 * `feeRecipientFor` in lib/chains.js). The aggregator supports exactly one
 * recipient. Splitting it two ways would mean routing every swap through a
 * fee-splitting contract of our own — a payable contract holding other
 * people's money, which needs an audit, and which turns a bug into stolen
 * funds rather than a broken screen.
 *
 * The owner asked for this only if it would not introduce bugs. Deploying an
 * unaudited money-handling contract to earn a 0.01 share would not clear that
 * bar. So this records ATTRIBUTION — who referred whom, and how much fee that
 * person generated — and payouts are made from the collected total. The
 * accounting is exact and verifiable; only the settlement is manual.
 *
 * ─── WHY THE CODE IS STORED, NOT THE URL ────────────────────────────────────
 * The parameter is read once and persisted. A referral must survive the user
 * closing the app, coming back a week later, and finally swapping — which is
 * the only moment any fee exists to share.
 */

const REF_KEY = 'fbt-referred-by';
const REF_AT_KEY = 'fbt-referred-at';

/** A referral is only credited if the invitee swaps within this window. */
export const REFERRAL_WINDOW_DAYS = 90;

/** Share of OUR fee that goes to the referrer. */
export const REFERRAL_SHARE = 0.01;

/**
 * Codes are user-supplied and end up in storage and on the wire, so they are
 * constrained hard: alphanumeric, dash and underscore, 4-32 characters.
 * Anything else is treated as absent rather than sanitised into something
 * that might collide with a real code.
 */
const VALID = /^[A-Za-z0-9_-]{4,32}$/;

export const isValidRefCode = (code) => typeof code === 'string' && VALID.test(code);

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the referral simply is not remembered */
  }
}

/**
 * Capture `?ref=` from the current URL, once.
 *
 * ─── FIRST TOUCH WINS ───────────────────────────────────────────────────────
 * An existing referral is never overwritten. Otherwise anyone could send an
 * existing user their own link and take credit for a relationship they had
 * nothing to do with — the standard way affiliate programmes get farmed.
 *
 * Returns the code in effect, or null.
 */
/** This device's own invite code, from the persisted app store. */
function ownRefCode() {
  try {
    const raw = localStorage.getItem('fbt-swap-v1');
    if (!raw) return null;
    return JSON.parse(raw)?.state?.refCode ?? null;
  } catch {
    return null;
  }
}

export function captureReferral(search = typeof window !== 'undefined' ? window.location.search : '') {
  const existing = read(REF_KEY);
  if (isValidRefCode(existing)) return existing;

  let code = null;
  try {
    code = new URLSearchParams(search).get('ref');
  } catch {
    return null;
  }
  if (!isValidRefCode(code)) return null;

  /*
   * Self-referral is refused.
   *
   * A user opening their own invite link would otherwise be recorded as
   * having referred themselves, and every fee they generate would owe them a
   * rebate — the simplest possible way to farm this.
   *
   * The device's own code lives inside the zustand store's persisted blob
   * ('fbt-swap-v1'), not a key of its own, so it is read from there. Wrapped
   * because a corrupt or absent blob must not stop a legitimate referral from
   * being recorded.
   */
  if (code === ownRefCode()) return null;

  write(REF_KEY, code);
  write(REF_AT_KEY, String(Date.now()));
  return code;
}

/** The code that referred this device, or null. */
export function referredBy() {
  const code = read(REF_KEY);
  if (!isValidRefCode(code)) return null;

  /*
   * Attribution expires. Without a window, a click from years ago would keep
   * earning forever — which is neither what a referrer contributed nor
   * something we could defend if asked.
   */
  const at = Number(read(REF_AT_KEY));
  if (!Number.isFinite(at) || at <= 0) return code; // legacy entry, honour it
  const age = Date.now() - at;
  if (age < 0) return code; // clock moved; do not punish the user
  return age <= REFERRAL_WINDOW_DAYS * 86_400_000 ? code : null;
}

/**
 * The referrer's cut of a given fee amount.
 *
 * Kept as a pure function so the share can be shown to both sides honestly:
 * the referrer sees what they earned, and the invitee can see that their own
 * cost did not change — the share comes out of OUR fee, not on top of it.
 */
export function referrerShare(feeAmount, share = REFERRAL_SHARE) {
  const n = Number(feeAmount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const s = Number(share);
  if (!Number.isFinite(s) || s <= 0 || s > 1) return 0;
  return n * s;
}

/** Forget the referral. Used by the reset-account path. */
export function clearReferral() {
  try {
    localStorage.removeItem(REF_KEY);
    localStorage.removeItem(REF_AT_KEY);
  } catch {
    /* ignore */
  }
}
