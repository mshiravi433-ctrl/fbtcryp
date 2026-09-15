/**
 * APPKIT DEEP-LINK PATCH — give the SDK the `link_mode` the explorer omits
 * ---------------------------------------------------------------------------
 * The screen the user actually taps on a phone is AppKit's own wallet list
 * (`w3m-all-wallets-list` → `ApiController.state`), because the
 * ethereum-provider creates the modal with `basic: true` and
 * `manualWCControl: true`: the `customWallets` entry we hand over in
 * `qrModalOptions.mobileWallets` is rendered in the FIRST screen's list, but
 * the trusted-looking "recommended / all wallets" rows — the ones a user
 * recognises and taps — carry the EXPLORER's data. Fetched live with this
 * project's id (`https://api.web3modal.org/getWallets?projectId=8e36ecca…`):
 *
 *   Trust Wallet → { mobile_link: 'trust://',    link_mode: null }
 *   MetaMask     → { mobile_link: 'metamask://', link_mode: null }
 *
 * `ConnectionControllerUtil.onConnectMobile()` is the single place the SDK
 * turns such an object into a URL:
 *
 *   const { redirect, redirectUniversalLink } =
 *     CoreHelperUtil.formatNativeUrl(mobile_link, uri, link_mode);
 *   if (OptionsController.state.experimental_preferUniversalLinks && universalLink)
 *     openHref(universalLink); else openHref(redirect);
 *
 * With `link_mode: null` there is no `redirectUniversalLink`, so
 * `experimental_preferUniversalLinks: true` (which this app sets) has nothing
 * to prefer and the CUSTOM SCHEME is opened. That is the whole bug behind
 * «با زدن بازکردن ارور دیپ لینک میزنه»: `trust://wc?uri=…` is navigable from
 * a real browser and from nothing else — a WebView answers with its error
 * page.
 *
 * This module wraps that one function so EVERY wallet object — from the
 * explorer, from storage's recent list, or from our own table — goes into
 * `formatNativeUrl()` carrying the https base (`withLinkMode`). It is the
 * narrowest possible patch: the SDK keeps its own logic, its own encoding and
 * its own platform choice; it merely stops receiving an incomplete object.
 *
 * Best-effort by design, and never a hard dependency: if a future SDK renames
 * or moves the function the patch silently returns false, and
 * lib/wcDeepLink.js still rewrites whatever URL the SDK ends up opening.
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
       * otherwise serve: the SDK opening the pairing URI itself (`wc:…`) — the
       * «Invalid Url:wc:…» report — where the URI has to be completed into the
       * tapped wallet's https link, because a WebView can open no wallet at
       * all. Public entry only; no URI, no account, nothing session-bearing.
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
