/**
 * LOAN ERRORS — the ONE door between a machine code and a sentence.
 * ============================================================================
 * WHY THIS FILE EXISTS (report: «سه‌جا با استرینگ هست به جای زبان درست»)
 * ---------------------------------------------------------------------------
 * The Lending page spoke its errors two different ways, and only one of them
 * was translated:
 *
 *   · INSIDE the page — `t(\`loan.error.${code}\`, { defaultValue: code })`.
 *     A code with no key printed itself: `BORROWING_DISABLED` under a Persian
 *     heading, which is the «استرینگ» in the report.
 *   · ON THE TOAST — `notify(\`loan.error.${code}\`, 'error')`, which lands in
 *     Toasts.jsx as `t(\`toast.${key}\`, { defaultValue: key })`.
 *     `toast.loan.error.MARKET_PAUSED` does not exist and CANNOT exist under
 *     that prefix, so EVERY loan toast printed its own key path
 *     (`loan.error.HEALTH_FACTOR_TOO_LOW`) over a Persian UI — including the
 *     page's own non-error toasts (`loan.chooseAssetFirst`, `loan.enterAmount`,
 *     `loan.amountOverWallet`, `loan.needCollateralFirst`, which are real keys
 *     under `loan.`).
 *
 * Both paths now come through here:
 *
 *   loanErrorText(t, codeOrKey)  → the localized sentence, ALWAYS
 *   loanErrorKey(code)           → `loan.error.<CODE>`
 *
 * The rule the rest of the app already follows (src/lib/bridgeErrors.js,
 * src/lib/defi/farmErrors.js) is kept exactly:
 *
 *   · a KNOWN code   → its translated sentence;
 *   · an UNKNOWN code → a translated generic sentence that KEEPS the code, so
 *     support still gets the machine string — but the user gets a language.
 *
 * Nothing here invents a cause, and nothing here decides policy: the engine
 * still decides which codes exist. This module only guarantees that whatever
 * it decides reaches the screen as a sentence in the user's language.
 */

/** The namespace this page owns for error sentences. */
export const LOAN_ERROR_PREFIX = 'loan.error.';

/** The key that carries «… (CODE)» for a code this build has no sentence for. */
export const LOAN_ERROR_GENERIC = 'loan.error.UNKNOWN_WITH_CODE';

/** What the page says when it is handed nothing at all. */
export const LOAN_ERROR_FALLBACK = 'UNKNOWN';

/**
 * Codes the SOLANA WALLET LAYER returns (src/lib/solana/walletLayer.js) and the
 * EVM path's own vocabulary, listed here for one reason: they arrive at the
 * page as an `error.code`/`{code}` from a layer that has no i18n of its own, so
 * an unknown one used to collapse into «the transaction did not go through» —
 * a sentence about the wrong event. Listed only where the direct key name
 * differs from what the page owns. (Most wallet codes already ARE
 * `loan.error.*` keys; this table is the exception list, one line per entry.)
 */
export const LOAN_ERROR_ALIASES = Object.freeze({
  /* The wallet layer's vocabulary → the engine's codes. */
  ACTION_REJECTED: 'USER_REJECTED',
  CANNOT_SIGN: 'UNSUPPORTED',
  DECRYPT_FAILED: 'SIGN_FAILED',
  /* Solana broadcast helpers. */
  RATE_LIMIT: 'RPC_RATE_LIMITED',
  TOO_MANY_REQUESTS: 'RPC_RATE_LIMITED',
  HTTP_403: 'RPC_BLOCKED',
  HTTP_401: 'RPC_BLOCKED',
  HTTP_451: 'RPC_BLOCKED',
  IN_WALLET_PENDING: 'IN_WALLET',
  /* The EVM engine's revert names that the UI may receive verbatim. */
  REVERTED: 'TRANSACTION_REVERTED',
  UNKNOWN_STEP: 'UNKNOWN'
});

/** Codes that name a WALLET-side outcome; used by the coverage test. */
export const LOAN_WALLET_CODES = Object.freeze([
  'REJECTED', 'USER_REJECTED', 'NO_WALLET', 'WALLET_NOT_FOUND', 'NO_ACCOUNT',
  'NO_SESSION', 'TIMEOUT', 'UNSUPPORTED', 'UNSUPPORTED_TRANSACTION',
  'SIGN_FAILED', 'SEND_FAILED', 'CONNECT_FAILED', 'IN_WALLET', 'NO_SIGNATURE',
  'BAD_TRANSACTION', 'SOLANA_WALLET_REQUIRED', 'SOLANA_SIGN_UNAVAILABLE'
]);

const cleanCode = (code) => String(code ?? '')
  .trim()
  .replace(/^loan\.error\./i, '')
  .replace(/^loan\./i, '')
  .toUpperCase()
  .replace(/[\s-]+/g, '_');

/** The key this page looks a code up under. */
export function loanErrorKey(code) {
  return `${LOAN_ERROR_PREFIX}${cleanCode(code) || LOAN_ERROR_FALLBACK}`;
}

/**
 * The sentence for a code (or for a fully-qualified loan key) — translated.
 *
 * Lookup order, and the reason for each step:
 *   1. the value itself, when it is already a `loan.*` key — this is what makes
 *      `notify('loan.chooseAssetFirst')` and `notify('loan.error.X')` resolve;
 *   2. `loan.error.<CODE>` for a bare machine code;
 *   3. the alias table, for a code a lower layer named differently;
 *   4. a translated generic that carries the code — never a bare code.
 *
 * @param {(key:string, options?:object)=>string} t  the i18next function
 * @param {string} codeOrKey                         a code or a loan.* key
 * @param {object} [options]                          interpolation values
 * @returns {string} a sentence in the active language
 */
export function loanErrorText(t, codeOrKey, options = {}) {
  const raw = String(codeOrKey ?? '').trim();
  if (typeof t !== 'function') return cleanCode(raw) || LOAN_ERROR_FALLBACK;
  if (!raw) return t(loanErrorKey(LOAN_ERROR_FALLBACK), { ...options, defaultValue: '' }) || LOAN_ERROR_FALLBACK;

  /* 1 — the key itself. Empty-string default: i18next returns the default when
     the key is absent, so a falsy answer means «this locale has no such key»
     and never a sentence that happens to be empty. */
  if (/^loan\./i.test(raw)) {
    const direct = t(raw, { ...options, defaultValue: '' });
    if (direct) return direct;
  }

  /* 2 — a machine code. */
  const normalized = cleanCode(raw);
  const byCode = t(loanErrorKey(normalized), { ...options, defaultValue: '' });
  if (byCode) return byCode;

  /* 3 — the same failure under the name another layer gave it. */
  const alias = LOAN_ERROR_ALIASES[normalized];
  if (alias) {
    const viaAlias = t(loanErrorKey(alias), { ...options, defaultValue: '' });
    if (viaAlias) return viaAlias;
  }

  /* 4 — unknown. The generic keeps `{{code}}` so support still receives the
     machine string, inside a sentence the user can read. An explicit `code` in
     `options` wins, so a caller carrying a finer-grained detail keeps it. */
  const generic = t(LOAN_ERROR_GENERIC, {
    ...options,
    code: options.code ?? (normalized || raw),
    defaultValue: ''
  });
  return generic || normalized || raw;
}

/**
 * Is this code one the page can explain in its own words?
 * (Used by the test suite and by callers that want to log unknowns once.)
 */
export function isKnownLoanError(t, codeOrKey) {
  if (typeof t !== 'function') return false;
  const raw = String(codeOrKey ?? '').trim();
  if (!raw) return false;
  if (/^loan\./i.test(raw)) return Boolean(t(raw, { defaultValue: '' }));
  const normalized = cleanCode(raw);
  if (!normalized) return false;
  if (t(loanErrorKey(normalized), { defaultValue: '' })) return true;
  const alias = LOAN_ERROR_ALIASES[normalized];
  return Boolean(alias && t(loanErrorKey(alias), { defaultValue: '' }));
}

/**
 * Every key a lookup may produce, in order — exported so a renderer that owns a
 * KEY (the toast host) can resolve through the same single door instead of
 * re-implementing the fallback chain.
 */
export function loanLookupKeys(codeOrKey) {
  const raw = String(codeOrKey ?? '').trim();
  const keys = [];
  if (/^loan\./i.test(raw)) keys.push(raw);
  const normalized = cleanCode(raw);
  if (normalized) keys.push(loanErrorKey(normalized));
  const alias = LOAN_ERROR_ALIASES[normalized];
  if (alias) keys.push(loanErrorKey(alias));
  keys.push(LOAN_ERROR_GENERIC);
  return [...new Set(keys)];
}
