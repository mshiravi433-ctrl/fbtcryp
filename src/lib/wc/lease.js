/**
 * THE WALLET SESSION LEASE
 * ---------------------------------------------------------------------------
 * THE REPORT: «پس از رفرش کیف پول متصل دیسکانکت می‌شه» — refresh the page and the
 * connected wallet is gone.
 *
 * ─── WHY IT HAPPENED ──────────────────────────────────────────────────────
 * Two separate holes, one symptom.
 *
 *   1. NOTHING REMEMBERED THE CHOICE. `connectInjected()` attached a provider
 *      to React state and wrote NOTHING anywhere. An injected wallet — MetaMask
 *      in the browser, Trust's own dApp browser, the whole desktop experience —
 *      was therefore connected *for the lifetime of the document* and for no
 *      longer. A reload is a new document, so the wallet was simply not there
 *      any more, and there was no record saying it had ever been.
 *
 *   2. THE WALLETCONNECT RESUME RAN ONCE. `restoreWcSession()` is opportunistic
 *      (see session.js): one attempt, no retry, and every failure was silent —
 *      a relay init that lost an 8s race on a phone loading 15 other chunks
 *      left the session on disk but the app showing «not connected», with
 *      nothing scheduled to try again.
 *
 * So the app needed one explicit, inspectable fact: **this device has a wallet
 * connection, on this address, and it is good until <time>**. That is the lease.
 *
 * ─── WHAT THE LEASE IS, AND WHAT IT IS NOT ────────────────────────────────
 * It is a small localStorage record `{ mode, address, chainId, rdns, expiresAt }`
 * — no key, no signature, no secret, and nothing a thief can turn into money:
 * the worst it can do is make the app ASK the wallet to re-attach itself (and a
 * WalletConnect re-attach still needs the session the wallet itself signed).
 *
 * It is the difference between the two sentences a user can be shown after a
 * reload:
 *
 *   • «وصل نیست» — reconnect from scratch, approve in the wallet again.
 *   • «در حال اتصال مجدد…» — the app is doing exactly what it was told to do.
 *
 * ─── THE DURATION COMES FROM SETTINGS ─────────────────────────────────────
 * `walletSessionMinutes` (Settings → Security) is the number the user picked —
 * 60 minutes by default. While the app is open and connected the lease ROLLS
 * FORWARD (a connection in active use must not expire under the user's hands);
 * once the app is gone, the clock keeps running and the lease simply lapses.
 * `0` means «until I disconnect» — no expiry at all, which is what the
 * «تا قطع دستی» option in Settings selects.
 *
 * After it lapses the app stops re-attaching on its own AND purges the stored
 * WalletConnect session, so the next Connect is a clean first attempt instead
 * of an init() that resurrects a stale session behind the modal — the exact
 * failure documented in storage.js. Reconnecting after that is one tap, and
 * the wallet is asked for a fresh approval: a lease that could be renewed by a
 * page refresh would be a connection nobody ever approved.
 */

/** Where the lease lives. Bumping the version abandons old shapes. */
export const WALLET_LEASE_KEY = 'fbt-wallet-session-v1';

/** What the picker in Settings offers, and what a fresh install starts with. */
export const WALLET_LEASE_DEFAULT_MINUTES = 60;
export const WALLET_SESSION_CHOICES = Object.freeze([15, 30, 60, 180, 0]);

/** The three transports the lease can describe (WalletContext's modes). */
export const WALLET_LEASE_MODES = Object.freeze(['injected', 'wc', 'local']);

function storeOf(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    /* storage blocked by policy (partitioned WebView, private mode) */
    return null;
  }
}

/** A hex EVM address, and nothing else — never a label, a name or a topic. */
export function isLeaseAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Normalise the settings value.
 *
 * Anything unparseable falls back to the default rather than to 0: a corrupted
 * preference must not silently turn into «never expires», because that is the
 * one value that cannot be corrected by waiting.
 */
export function walletLeaseMinutes(value, fallback = WALLET_LEASE_DEFAULT_MINUTES) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return 0;
  return Math.min(24 * 60, Math.round(n));
}

/**
 * Write (or roll) the lease.
 *
 * @returns {object|null} the stored record, or null when storage refused.
 */
export function writeWalletLease({
  address,
  chainId = null,
  mode,
  rdns = null,
  minutes = WALLET_LEASE_DEFAULT_MINUTES,
  at = Date.now(),
  storage
} = {}) {
  const target = storeOf(storage);
  if (!target || !isLeaseAddress(address)) return null;
  const clean = WALLET_LEASE_MODES.includes(mode) ? mode : 'wc';
  const mins = walletLeaseMinutes(minutes);
  const record = {
    v: 1,
    mode: clean,
    address: address.toLowerCase(),
    chainId: Number.isFinite(Number(chainId)) && Number(chainId) > 0 ? Number(chainId) : null,
    rdns: typeof rdns === 'string' && rdns ? rdns.slice(0, 64) : null,
    minutes: mins,
    issuedAt: at,
    /* 0 is «until I disconnect»: the record says so explicitly instead of
       pretending an expiry exists far in the future. */
    expiresAt: mins > 0 ? at + mins * 60_000 : 0
  };
  try {
    target.setItem(WALLET_LEASE_KEY, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

/**
 * Read the lease and say whether it is still good.
 *
 * Never throws and never trusts the bytes: a hand-edited record is rejected
 * rather than acted on, because acting on it means re-attaching a wallet.
 *
 * @returns {{mode,address,chainId,rdns,minutes,issuedAt,expiresAt,alive,remainingMs}|null}
 */
export function readWalletLease({ storage, at = Date.now() } = {}) {
  const target = storeOf(storage);
  if (!target) return null;
  let raw = null;
  try {
    raw = target.getItem(WALLET_LEASE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!isLeaseAddress(parsed.address)) return null;
  if (!WALLET_LEASE_MODES.includes(parsed.mode)) return null;
  const expiresAt = Number(parsed.expiresAt);
  const minutes = walletLeaseMinutes(parsed.minutes, 0);
  if (!Number.isFinite(expiresAt) || expiresAt < 0) return null;
  const permanent = expiresAt === 0;
  const alive = permanent || expiresAt > at;
  return {
    mode: parsed.mode,
    address: String(parsed.address).toLowerCase(),
    chainId: Number.isFinite(Number(parsed.chainId)) && Number(parsed.chainId) > 0 ? Number(parsed.chainId) : null,
    rdns: typeof parsed.rdns === 'string' && parsed.rdns ? parsed.rdns : null,
    minutes,
    issuedAt: Number.isFinite(Number(parsed.issuedAt)) ? Number(parsed.issuedAt) : 0,
    expiresAt,
    alive,
    remainingMs: permanent ? 0 : Math.max(0, expiresAt - at)
  };
}

/** Forget the lease. Called on an explicit disconnect and when it lapses. */
export function clearWalletLease(storage) {
  const target = storeOf(storage);
  if (!target) return false;
  try {
    target.removeItem(WALLET_LEASE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Whole minutes left on the lease, or null when it never expires / is gone. */
export function walletLeaseRemainingMinutes(lease, at = Date.now()) {
  if (!lease || !lease.alive) return 0;
  if (lease.expiresAt === 0) return null;
  return Math.max(0, Math.ceil((lease.expiresAt - at) / 60_000));
}

/**
 * WHAT THE COLD START SHOULD DO — as data, so the decision is testable without
 * a browser, a wallet or a relay.
 *
 * ─── WHY A PLAN AND NOT AN `if` IN THE COMPONENT ──────────────────────────
 * The rule has one genuinely counter-intuitive branch (an EXPIRED lease purges
 * the stored session; a MISSING one does not), and that branch is precisely the
 * one a future edit would "simplify" into the old bug. Written here it is
 * asserted directly, with the reasons next to it.
 *
 * @param {object}  opts
 * @param {object}  [opts.lease]            as returned by readWalletLease()
 * @param {boolean} [opts.hasVault]         an encrypted in-app vault is on disk
 * @param {boolean} [opts.hasStoredSession] a `wc@2:` session is on disk
 * @returns {{action:'local'|'wc'|'injected'|'none', adopt?:boolean, expired?:boolean, stale?:boolean}}
 *
 *   • `local`    — the vault auto-attaches (it is the synchronous path; the
 *                  lease only supplies the address and the expiry).
 *   • `wc`       — resume the stored WalletConnect session.
 *   • `injected` — SILENTLY re-attach the remembered EIP-6963 wallet
 *                  (`eth_accounts`, never `eth_requestAccounts`) — no prompt.
 *   • `none`     — nothing to restore.
 *
 *   `adopt` — a stored session with no lease at all: an install that connected
 *   before this module existed. It is adopted once (and then leased), so the
 *   update itself does not disconnect anyone.
 *   `expired` — the lease lapsed: the stored session is dead weight now and is
 *   purged, so the next Connect is a clean first attempt.
 */
export function walletRestorePlan({ lease = null, hasVault = false, hasStoredSession = false } = {}) {
  if (lease && lease.alive) {
    if (lease.mode === 'local') {
      return hasVault ? { action: 'local' } : { action: 'none', stale: true };
    }
    if (lease.mode === 'injected') return { action: 'injected' };
    return { action: 'wc' };
  }
  if (!lease && hasStoredSession) return { action: 'wc', adopt: true };
  return { action: 'none', expired: Boolean(lease) };
}

/**
 * How long to wait before the Nth re-attach attempt (0-based), in ms.
 *
 * The first attempt runs on the mount tick, where a phone is still busy with
 * the document it just loaded; a single failure there must not be the end of
 * it. The ladder is bounded — after the last step the lease stays on disk and
 * the next visibility change (or a tap on «تلاش دوباره») starts over, so a
 * wallet that comes back online in ten minutes still re-attaches by itself.
 */
export const WALLET_RESTORE_BACKOFF = Object.freeze([1500, 4000, 10000, 25000, 60000]);

export function walletRestoreDelay(attempt) {
  const i = Math.max(0, Math.min(WALLET_RESTORE_BACKOFF.length - 1, Math.floor(Number(attempt) || 0)));
  return WALLET_RESTORE_BACKOFF[i];
}
