/**
 * APPKIT MOBILE-SELECTION COMPATIBILITY WRAPPER
 * ---------------------------------------------------------------------------
 * `onConnectMobile()` is the one place AppKit knows which Explorer/recent row
 * the user tapped. Wrap it narrowly to:
 *
 *   1. remember that wallet so a rare bare `wc:` open can be completed without
 *      guessing, and
 *   2. fill an omitted `link_mode` as HTTPS fallback data.
 *
 * Native remains primary (`experimental_preferUniversalLinks: false`). The
 * wrapper never mutates AppKit's wallet object, URI, encoding or target. It is
 * best-effort and idempotent across provider initializations.
 */

import { rememberTappedWallet, withLinkMode } from './wcWallets.js';

/** The exact wrapper object we installed, so re-applying is a no-op. */
let installed = null;

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
      return original.call(util, withLinkMode(wallet), wcPayUrl);
    };
    util.onConnectMobile = wrapper;
    installed = wrapper;
    return util.onConnectMobile === wrapper;
  } catch {
    return false;
  }
}
