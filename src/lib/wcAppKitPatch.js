/**
 * APPKIT MOBILE-SELECTION COMPATIBILITY WRAPPER
 * ---------------------------------------------------------------------------
 * `onConnectMobile()` is the one place AppKit knows which Explorer/recent row
 * the user tapped. Wrap it narrowly to:
 *
 *   1. remember that wallet so a rare bare `wc:` open can be completed without
 *      guessing, and
 *   2. fill an omitted `link_mode` as HTTPS fallback data, and
 *   3. RECONCILE AppKit's pairing state with OUR live pairing (see below).
 *
 * Native remains primary (`experimental_preferUniversalLinks: false`). The
 * wrapper never mutates AppKit's wallet object, URI, encoding or target. It is
 * best-effort and idempotent across provider initializations.
 *
 * ─── WHY THE URI RECONCILIATION EXISTS (the «wallet opens, home screen, no
 * ─── approval prompt» report) ─────────────────────────────────────────────
 * The modal embedded by @walletconnect/ethereum-provider runs with
 * `manualWCControl: true`, and in that mode NOTHING resets
 * `ConnectionController.state.wcUri` between attempts:
 *
 *   • `EthereumProvider.disconnect()` only tears down a SESSION — a cancelled
 *     or timed-out PAIRING emits no provider `disconnect` event, so AppKit's
 *     `onDisconnect → resetWcConnection()` never runs;
 *   • `AppKit.close()` (appkit-core, manualWCControl branch) only calls
 *     `finalizeWcConnection()`.
 *
 * So after a failed/cancelled attempt, `state.wcUri` still names the DEAD
 * pairing topic. The connecting widget (`w3m-connecting-wc-mobile`) fires
 * `onConnect()` from its constructor whenever `this.uri` is truthy — reading
 * that stale state — and the wallet is handed a pairing that no longer
 * exists: the app opens to its home screen with no proposal, while the FRESH
 * pairing our provider just created sits unused on the relay (which is why
 * the SAME attempt always connects via the QR — the sheet renders the fresh
 * `display_uri`, not AppKit's stale state).
 *
 * The fix: WalletContext reports the pairing URI its OWN provider emitted on
 * `display_uri` (`setLivePairingUri`), and this wrapper makes the state match
 * immediately before AppKit builds the hand-off link. `setUri()` is the same
 * setter the SDK's own `onDisplayUri` path uses, so the values and the expiry
 * bookkeeping stay in the SDK's own shape. When nothing is pairing (no live
 * URI, nothing in state) the original behaviour is preserved — including its
 * silent no-op when both are absent.
 */

import { rememberTappedWallet, withLinkMode } from './wcWallets.js';

/** The exact wrapper object we installed, so re-applying is a no-op. */
let installed = null;

/* The pairing URI of the LIVE attempt, set by WalletContext's display_uri
   handler and cleared when the attempt settles. A string only — never an
   object with topics beyond the pairing the sheet already shows, and it dies
   with the attempt. */
let livePairingUri = null;

/**
 * Report/clear the pairing URI of the currently-live pairing attempt.
 * Call with the URI on `display_uri`, with null when the attempt settles.
 */
export function setLivePairingUri(uri) {
  const text = String(uri || '').trim();
  livePairingUri = text || null;
  return livePairingUri;
}

/**
 * Best-effort: clear AppKit's stale pairing state between attempts. Safe to
 * call when no controllers are loaded (dynamic import fails → no-op) and when
 * there is nothing to reset (resetUri on empty state is a no-op). Never
 * throws — the next attempt must never pay for a hygiene miss here.
 */
export async function resetAppKitPairingState() {
  livePairingUri = null;
  try {
    const controllers = await import('@reown/appkit-controllers');
    controllers?.ConnectionController?.resetUri?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Install the patch against the controllers singleton.
 *
 * @returns {Promise<boolean>} true when the patch is (already) in place.
 */
export async function installAppKitLinkModePatch() {
  try {
    const controllers = await import('@reown/appkit-controllers');
    const util = controllers?.ConnectionControllerUtil;
    if (!util || typeof util.onConnectMobile !== 'function') return false;
    if (installed && util.onConnectMobile === installed) return true;
    const original = util.onConnectMobile;
    const wrapper = function onConnectMobile(wallet, wcPayUrl) {
      /*
       * Record WHICH wallet is being handed a pairing, here, at the only place
       * the SDK knows it. lib/wcDeepLink.js needs it for one case it cannot
       * otherwise serve: the SDK opening the pairing URI itself (`wc:…`). The
       * URI can then be completed into the tapped wallet's native link, with
       * HTTPS retained as fallback. No URI or account is stored here.
       */
      rememberTappedWallet(wallet);
      /*
       * THE LIVE-PAIRING RECONCILE — see the block comment above. If AppKit's
       * state still names a previous attempt's pairing while OUR provider is
       * holding a fresh one, point the state at the fresh one BEFORE the
       * original builds the deep link. The user's tap then carries exactly
       * the bytes the QR carries — the pairing that is actually alive.
       */
      try {
        const stateUri = controllers.ConnectionController?.state?.wcUri;
        if (livePairingUri && stateUri !== livePairingUri) {
          controllers.ConnectionController.setUri(livePairingUri);
        }
      } catch { /* state shape changed — the original call still runs */ }
      return original.call(util, withLinkMode(wallet), wcPayUrl);
    };
    util.onConnectMobile = wrapper;
    installed = wrapper;
    return util.onConnectMobile === wrapper;
  } catch {
    return false;
  }
}
