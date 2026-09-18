/**
 * WALLETCONNECT EVENT TRACE
 * ---------------------------------------------------------------------------
 * The answer to "it disconnected by itself" is evidence, not a guess. This is
 * a bounded ring buffer of lifecycle event NAMES and small numbers.
 *
 * WHAT IS DELIBERATELY NOT RECORDED: the pairing URI (a live QR secret),
 * session topics, addresses, chain payloads, or any string a relay could put
 * data in. This buffer is designed to be pasted into a support message, and a
 * log that can leak a pairing URI is one copy-paste away from a session
 * hijack. The shape below is a contract, not a style choice.
 *
 * ─── DETAIL EVENTS (wcEventDetail) ─────────────────────────────────────────
 * Some questions can only be answered by a NAMED fact, not a number: «the
 * email modal opened on the Account view» is `view: 'Account'`, and no count
 * of booleans says it. Those events carry a `d` object whose values are
 * booleans, finite numbers, or strings from SAFE_DETAIL_TOKENS — a CLOSED
 * vocabulary of AppKit view names, connector ids and two meta tokens. The
 * whitelist is what keeps the contract: a CAIP address (`eip155:1:0x…`), a
 * pairing URI or a relay topic matches no token and is coerced to 'other',
 * so an unsafe value can never reach the buffer even by accident.
 */

const MAX = 40;

/**
 * ─── THE RING OUTLIVES THE DOCUMENT (2026-09-18 report) ───────────────────
 * The report that started this round carried exactly ONE event —
 * `email_appkit_ready` — and every earlier report was read the same way: a
 * memory-only buffer, read minutes later, after the WebView had been through a
 * reload/back-navigation, i.e. after the evidence was gone. A trace that only
 * exists while the page does cannot answer «what happened when I pressed
 * email» on the device where the answer matters.
 *
 * So the buffer is mirrored into `sessionStorage` (same tab: survives a
 * reload and a back-navigation; dies with the tab) and, when a WebView refuses
 * session storage, into `localStorage`. Both are re-validated on the way IN as
 * well as on the way OUT (`revive`), so a store that was tampered with cannot
 * smuggle a pairing URI into a support message: the closed vocabulary below is
 * still the only thing that can be recorded, no matter who wrote the bytes.
 */
export const TRACE_STORAGE_KEY = 'fbt_wc_trace_ring_v1';

/** Detail keys must be short lowercase words — anything else is dropped. */
const DETAIL_KEY = /^[a-z]{1,8}$/;

/** The complete string vocabulary a detail may carry. Nothing else passes. */
const SAFE_DETAIL_TOKENS = new Set([
  /* AppKit 1.8.19 RouterController views (the modal's own headings table). */
  'Connect', 'Create', 'Account', 'AccountSettings', 'AllWallets',
  'ApproveTransaction', 'BuyInProgress', 'UsageExceeded', 'ConnectingExternal',
  'ConnectingWalletConnect', 'ConnectingWalletConnectBasic', 'ConnectingSiwe',
  'Convert', 'ConvertSelectToken', 'ConvertPreview', 'Downloads', 'EmailLogin',
  'EmailVerifyOtp', 'EmailVerifyDevice', 'GetWallet', 'Networks',
  'OnRampProviders', 'OnRampActivity', 'OnRampTokenSelect', 'OnRampFiatSelect',
  'Pay', 'PayQuote', 'PayLoading', 'PayWithExchange', 'PayWithExchangeSelectAsset',
  'ProfileWallets', 'SwitchNetwork', 'Transactions', 'UnsupportedChain',
  'UpgradeEmailWallet', 'UpdateEmailWallet', 'UpdateEmailPrimaryOtp',
  'UpdateEmailSecondaryOtp', 'WhatIsABuy', 'WhatIsAWallet', 'WhatIsANetwork',
  'RegisterAccountName', 'RegisterAccountNameSuccess', 'WalletReceive',
  'WalletCompatibleNetworks', 'Swap', 'SwapSelectToken', 'SwapPreview',
  'WalletSend', 'WalletSendPreview', 'WalletSendSelectToken',
  'WalletSendConfirmed', 'ConnectWallets', 'ConnectSocials', 'ConnectingSocial',
  'ConnectingMultiChain', 'ConnectingFarcaster', 'SwitchActiveChain',
  'SmartSessionList', 'SmartSessionCreated', 'SIWXSignMessage', 'DataCapture',
  'DataCaptureOtpConfirm', 'FundWallet', 'SmartAccountSettings',
  /* Connector ids (@reown/appkit-common ConstantsUtil.CONNECTOR_ID). */
  'walletConnect', 'injected', 'announced', 'coinbaseWallet', 'coinbaseWalletSDK',
  'baseAccount', 'safe', 'ledger', 'okx', 'eip6963', 'AUTH',
  /* Meta tokens for absent/unrecognised values. */
  'none', 'other',
  /* Outcome tokens for the bounded operations whose RESULT (not just their
     failure) the next report has to be able to read — e.g. whether
     `modal.open()` ever settled, or which chain the email surface was pinned
     to. See `openSurfaceDetail()` in embedded.js. */
  'settled', 'pending', 'failed', 'unsupported',
  /* The secure frame's own state: `ready` (it answered FRAME_READY),
     `loading` (its document exists but never became ready — the WebView case
     every previous report could not distinguish from «no account»). */
  'ready', 'loading'
]);

/**
 * The ONLY shape a free-form (key `m`/`msg`/`err`) value may take: a short
 * message with anything that even RESEMBLES a secret replaced by a token.
 * Shared by the recorder and the re-hydrator, so both directions of the
 * storage mirror enforce the same contract.
 */
function safeMessage(value) {
  let s = String(value ?? '').slice(0, 120);
  s = s.replace(/wc:[^\s]+/gi, '[wc]');
  s = s.replace(/0x[0-9a-fA-F]{20,}/g, '[addr]');
  const out = s.trim() ? s : '';
  return out;
}


/** @type {Array<{ at: number, event: string, n?: number, ok?: boolean, d?: object }>} */
const trace = [];

/** Append an event. `extra` accepts only a finite number or a boolean. */
export function wcEvent(event, extra) {
  const entry = { at: Date.now(), event: String(event).slice(0, 48) };
  if (typeof extra === 'number' && Number.isFinite(extra)) entry.n = extra;
  if (typeof extra === 'boolean') entry.ok = extra;
  push(entry);
}

/**
 * Append an event with a small named-fact payload.
 *
 * @param {string} event name, same 48-char cap as wcEvent.
 * @param {Record<string, boolean|number|string>} detail — keys are matched
 *   against DETAIL_KEY; boolean and finite-number values pass through; string
 *   values must be SAFE_DETAIL_TOKENS or are coerced to 'other'; every other
 *   type is dropped. At most 8 facts survive.
 *
 * ─── EXTENSION FOR ERROR MESSAGES (2026-09-18) ───────────────────────────
 * The email flow can fail with «Action not allowed» / «action not valid» from
 * the secure iframe. That string is not a view name, so the old whitelist
 * coerced it to 'other' and the next report could not name the failing RPC.
 * Key 'm' (and 'msg'/'err') is now allowed to carry a short, sanitized free-form
 * message (no wc: URI, no 0x address) so the diagnostic can say which RPC failed.
 */
export function wcEventDetail(event, detail) {
  const entry = { at: Date.now(), event: String(event).slice(0, 48) };
  if (detail && typeof detail === 'object') {
    const safe = {};
    let kept = 0;
    for (const [key, value] of Object.entries(detail)) {
      if (kept >= 8 || !DETAIL_KEY.test(key)) continue;
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        safe[key] = value;
        kept += 1;
      } else if (typeof value === 'string') {
        if (key === 'm' || key === 'msg' || key === 'err') {
          // Sanitized free-form: strip anything that looks like a secret
          const s = safeMessage(value);
          // Only keep if not empty
          if (s) {
            safe[key] = s;
            kept += 1;
          }
        } else {
          safe[key] = SAFE_DETAIL_TOKENS.has(value) ? value.slice(0, 32) : 'other';
          kept += 1;
        }
      }
    }
    if (kept > 0) entry.d = safe;
  }
  push(entry);
}

function push(entry) {
  trace.push(entry);
  if (trace.length > MAX) trace.splice(0, trace.length - MAX);
  wcTracePersist();
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[wc] ${entry.event}`, entry.n ?? entry.ok ?? entry.d ?? '');
  }
}

/**
 * The storage the ring mirrors into: per-tab first (`sessionStorage` survives
 * a reload and a back-navigation, which is exactly the shape of a mobile
 * WebView's return trip), `localStorage` second.
 *
 * Every access is guarded: a browser with storage disabled (or a WebView
 * inside a partitioned third-party context) must still get a working
 * in-memory trace, not a thrown exception on the way to the login.
 */
function pickStore(storage) {
  if (storage) return storage;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
  } catch { /* blocked by policy — try the next one */ }
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* no storage at all */ }
  return null;
}

/**
 * Re-validate one stored entry against the SAME contract `wcEventDetail`
 * enforces live. A store that was edited by hand (or by a future version of
 * this module) can therefore never widen what the buffer is allowed to carry:
 * unknown keys are dropped, unknown string values become 'other', and free-form
 * messages are stripped of URIs and addresses.
 *
 * @returns {object|null} the entry, or null when it is not an event at all.
 */
export function reviveEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const at = Number(entry.at);
  const event = typeof entry.event === 'string' ? entry.event.slice(0, 48) : '';
  if (!Number.isFinite(at) || !event) return null;
  const out = { at, event };
  if (typeof entry.n === 'number' && Number.isFinite(entry.n)) out.n = entry.n;
  if (typeof entry.ok === 'boolean') out.ok = entry.ok;
  if (entry.d && typeof entry.d === 'object') {
    const safe = {};
    let kept = 0;
    for (const [key, value] of Object.entries(entry.d)) {
      if (kept >= 8 || !DETAIL_KEY.test(key)) continue;
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        safe[key] = value;
        kept += 1;
      } else if (typeof value === 'string') {
        if (key === 'm' || key === 'msg' || key === 'err') {
          const s = safeMessage(value);
          if (s) {
            safe[key] = s;
            kept += 1;
          }
        } else {
          safe[key] = SAFE_DETAIL_TOKENS.has(value) ? value.slice(0, 32) : 'other';
          kept += 1;
        }
      }
    }
    if (kept > 0) out.d = safe;
  }
  return out;
}

/** Mirror the buffer into storage. @returns {boolean} whether it was written. */
export function wcTracePersist(storage) {
  const target = pickStore(storage);
  if (!target) return false;
  try {
    target.setItem(TRACE_STORAGE_KEY, JSON.stringify(trace));
    return true;
  } catch {
    /* quota or policy: the in-memory ring is still the source of truth */
    return false;
  }
}

/**
 * Fill an EMPTY buffer from storage, re-validated entry by entry.
 *
 * Only ever runs into an empty buffer (module load, or a test that reset it):
 * a hydrate that appended to live events would interleave two epochs into one
 * report, which is worse than a short trace.
 *
 * @returns {number} how many entries were revived.
 */
export function wcTraceHydrate(storage) {
  if (trace.length > 0) return 0;
  const target = pickStore(storage);
  if (!target) return 0;
  let revived = 0;
  try {
    const raw = target.getItem(TRACE_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    for (const candidate of parsed.slice(-MAX)) {
      const entry = reviveEntry(candidate);
      if (entry) {
        trace.push(entry);
        revived += 1;
      }
    }
  } catch {
    /* unreadable or hostile: an empty buffer is the honest answer */
    return 0;
  }
  return revived;
}

/** Snapshot for the health panel / a support export. Returns a copy. */
export function wcTraceSnapshot() {
  return trace.map((entry) => ({ ...entry }));
}

/**
 * Empty the buffer — AND its storage mirror.
 *
 * The mirror matters here: without clearing it, the next page would hydrate
 * the events the caller just asked to forget, and a «fresh attempt» report
 * would open with the previous attempt's evidence.
 */
export function wcTraceReset(storage) {
  trace.length = 0;
  const target = pickStore(storage);
  if (!target) return;
  try {
    target.removeItem(TRACE_STORAGE_KEY);
  } catch { /* nothing to clear */ }
}

/* The document's own evidence: what ran before this page replaced the last. */
wcTraceHydrate();

