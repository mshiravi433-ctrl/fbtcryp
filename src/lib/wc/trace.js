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
  'none', 'other'
]);

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
          let s = String(value).slice(0, 120);
          // Remove potential wc: URIs, long hex addresses
          s = s.replace(/wc:[^\s]+/gi, '[wc]');
          s = s.replace(/0x[0-9a-fA-F]{20,}/g, '[addr]');
          // Only keep if not empty
          if (s.trim()) {
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
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[wc] ${entry.event}`, entry.n ?? entry.ok ?? entry.d ?? '');
  }
}

/** Snapshot for the health panel / a support export. Returns a copy. */
export function wcTraceSnapshot() {
  return trace.map((entry) => ({ ...entry }));
}

/** Test hook: empty the buffer. */
export function wcTraceReset() {
  trace.length = 0;
}
