/**
 * BRIDGE ERROR LOCALISATION
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS REPLACES ─────────────────────────────────────────────────
 * Every bridge tab translated its errors with
 *
 *     t(`bridge.err.${code}`, { defaultValue: code })
 *     t(`bridge.err.${code}`, { defaultValue: result.detail || result.code })
 *
 * and `bridge.err` held FIVE keys while the stack under it throws over forty
 * machine codes (`INSUFFICIENT_BALANCE`, `CHAIN_SWITCH_REJECTED`,
 * `PROVIDER_UNAVAILABLE`, `UPSTREAM_FAILED`, …). Two failures followed, both
 * reported:
 *
 *   1. A code with no key rendered the DEFAULTVALUE — the raw code itself, or
 *      a raw RPC message: «INSUFFICIENT_BALANCE» in red on a Persian screen.
 *      That is the «گاهی استرینگ هست» report — a machine string where a
 *      sentence should be.
 *   2. A code with no key but a translated generic default rendered the
 *      WRONG sentence: every quote failure collapsed into «مسیری پیدا نشد»
 *      even when the real reason was a rate-limited provider or a too-small
 *      amount — a message that invites exactly the action (change the amount)
 *      that cannot fix it.
 *
 * ─── THE CONTRACT ──────────────────────────────────────────────────────────
 * Same shape as lib/defi/farmErrors.js, because it is the same job: the single
 * door through which a bridge error becomes a sentence.
 *
 *   1. a machine code the bridge tabs spell → `bridge.err.*`
 *   2. any other machine code the shared cross-chain engine has a key for →
 *      `crossChain.err.*`, resolved dynamically so new engine codes
 *      (history/ledger statuses, provider faults) translate the moment their
 *      keys exist, without touching this file
 *   3. human prose from a wallet or an upstream (a decoded revert, 0x's own
 *      error text) → the tab's own fallback sentence as the headline, with
 *      the prose kept as EVIDENCE on a second `dir="ltr"` line — a raw
 *      English sentence as the headline is a bug, while hiding the only
 *      diagnostic the user has is a support cost
 *   4. an unmapped machine code → the generic sentence with the code kept
 *      for support, translated like everything else on the screen
 *
 * Never returned: a raw `SOME_CODE` as the whole error line.
 */

/** Error codes the bridge surfaces spell themselves (`bridge.err.*`). */
const BRIDGE_CODES = new Set([
  'UNSAFE_BRIDGE_REQUEST',
  'BRIDGE_ACCOUNT_CHANGED',
  'QUOTE_FAILED',
  'SAME_CHAIN',
  'UNSUPPORTED_CHAIN',
  'BAD_AMOUNT',
  'BAD_ADDRESS',
  'NO_ROUTE',
  'NO_SIGNER',
  'NO_RECIPIENT',
  'TX_FAILED',
  'WRONG_NETWORK',
  'CHAIN_SWITCH_REJECTED',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_GAS',
  'USER_REJECTED',
  'ROUTE_NOT_EXECUTABLE',
  'BROADCAST_FAILED',
  'QUOTE_EXPIRED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_BAD_RESPONSE',
  'PROVIDER_RATE_LIMITED',
  'UPSTREAM_FAILED',
  'UPSTREAM_TIMEOUT',
  'NETWORK_FAILED',
  'TIMEOUT',
  'AMOUNT_TOO_LOW',
  'WALLET_REQUIRED',
  'WALLET_NOT_CONNECTED',
  'BAD_CHAIN',
  'BAD_TOKEN',
  'BAD_ORIGIN_ADDRESS',
  'DESTINATION_ADDRESS_REQUIRED',
  'CROSSCHAIN_NOT_CONFIGURED'
]);

const CODE_RE = /^[A-Z][A-Z0-9_]{2,40}$/;

/**
 * Everything a bridge tab needs to render one error honestly.
 *
 * @param {string} code   machine code (or upstream prose) that was thrown
 * @param {Function} t    the active i18next translator
 * @param {object} [opts]
 * @param {string} [opts.fallbackKey] translated headline used when the input
 *        is prose rather than a code — the tab's own "what this screen calls
 *        an unknown failure" (quote paths pass `bridge.err.QUOTE_FAILED`,
 *        execute paths leave the default).
 * @returns {{ text: string, detail: string|null }}
 *   `text`   — a sentence in the user's language (or English fallback),
 *              never a raw key.
 *   `detail` — original wallet/upstream prose to render as a small, `ltr`
 *              evidence line, or null when there is nothing useful to add.
 */
export function bridgeErrorText(code, t, { fallbackKey = 'bridge.err.TX_FAILED' } = {}) {
  const key = String(code ?? '').trim().toUpperCase();

  if (CODE_RE.test(key)) {
    if (BRIDGE_CODES.has(key)) {
      const text = t(`bridge.err.${key}`);
      if (text && text !== `bridge.err.${key}`) return { text, detail: null };
    }
    /*
     * The shared cross-chain engine (and the Intent OS desk on top of it)
     * throws its own vocabulary — `BAD_FROM_CHAIN`, `HISTORY_WRITE_FAILED`,
     * `PROVIDER_BAD_RESPONSE`, … — already translated under `crossChain.err`.
     * Resolved dynamically rather than enumerated: a new engine code becomes
     * a sentence the moment its key exists, in every locale at once.
     */
    const shared = t(`crossChain.err.${key}`);
    if (shared && shared !== `crossChain.err.${key}`) return { text: shared, detail: null };

    /* An unmapped code is still a machine code, not prose — the generic
       sentence keeps it for support instead of pasting it as the headline. */
    return { text: t('bridge.err.GENERIC', { code: key }), detail: null };
  }

  /*
   * Not a code: upstream/wallet prose (0x passes whole sentences through
   * `error`; wallets through `shortMessage`). The fallback sentence carries
   * the meaning in the user's language; the prose is kept as evidence rather
   * than discarded, because it is often the ONLY place the actual reason is
   * written.
   */
  const prose = String(code ?? '').trim();
  return { text: t(fallbackKey), detail: prose ? prose.slice(0, 220) : null };
}

/**
 * Convenience for the common `catch (e)` shape. Prefers the thrown `code`;
 * falls back to a wallet `shortMessage`/`message` that may itself BE a code
 * (`throw new Error('NO_SIGNER')` on the DLN and Solana paths).
 */
export function bridgeErrorFromException(e, t, opts = {}) {
  const asCode = String(e?.code ?? e?.message ?? e?.shortMessage ?? '').trim().toUpperCase();
  if (CODE_RE.test(asCode)) return bridgeErrorText(asCode, t, opts);

  const prose = e?.shortMessage
    || (typeof e?.message === 'string' && e.message.trim() ? e.message : null);
  if (prose) {
    return { text: t(opts.fallbackKey ?? 'bridge.err.TX_FAILED'), detail: prose.slice(0, 220) };
  }
  return bridgeErrorText(e?.code || 'TX_FAILED', t, opts);
}
