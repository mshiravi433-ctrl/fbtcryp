/**
 * THE SHARED APPKIT SURFACE
 * ---------------------------------------------------------------------------
 * Two AppKit instances live on one page, and that is not an accident:
 *
 *   • the WalletConnect modal is created by `@walletconnect/ethereum-provider`
 *     itself, and it HARD-disables auth wallets — its options carry
 *     `features: { email: false, socials: false }`, because a `wc.connect()`
 *     promise can only settle on a WalletConnect session and an email login
 *     never becomes one;
 *   • the email/social login therefore needs its own `createAppKit()`
 *     (embedded.js) with the ethers adapter.
 *
 * Both share the controllers SINGLETONS (OptionsController,
 * ConnectionController) and the one `<w3m-modal>` element. That sharing is safe
 * under exactly one rule, and it is what this module enforces:
 *
 *   EVERY SURFACE RE-ASSERTS ITS OWN OPTIONS IMMEDIATELY BEFORE IT OPENS.
 *
 * Without the re-assertion, whichever instance booted last decides what the
 * other one renders: the email popup grows wallet rows that can never connect
 * (AppKit's `onConnectMobile` needs `wcUri`, which only a pairing creates), or
 * the WalletConnect modal grows an email row that hangs the pending
 * `connect()` forever.
 */

import {
  appKitCustomWallets,
  linkBase,
  rememberTappedWallet,
  walletForObject,
  walletLinks
} from './wallets.js';

/** The exact wrapper installed on the controllers singleton, so re-applying is a no-op. */
let installed = null;

/**
 * The pairing URI of the LIVE attempt.
 *
 * Set from the provider's `display_uri` event, cleared when the attempt settles.
 * A string only — no topic beyond the pairing the UI is already showing — and it
 * dies with the attempt.
 */
let livePairingUri = null;

export function setLivePairingUri(uri) {
  const text = String(uri ?? '').trim();
  livePairingUri = text || null;
  return livePairingUri;
}

export function getLivePairingUri() {
  return livePairingUri;
}

/**
 * Clear AppKit's pairing state between attempts.
 *
 * ─── WHY (the «wallet opens on its home screen, nothing asks to connect»
 * ─── report) ──────────────────────────────────────────────────────────────
 * The modal embedded by the ethereum-provider runs with `manualWCControl: true`,
 * and in that mode NOTHING resets `ConnectionController.state.wcUri` between
 * attempts: `EthereumProvider.disconnect()` only tears down a SESSION, and a
 * cancelled or timed-out PAIRING emits no provider `disconnect` event, so
 * AppKit's `onDisconnect → resetWcConnection()` never runs.
 *
 * So after a failed attempt `state.wcUri` still names the DEAD pairing topic.
 * The connecting widget fires `onConnect()` from its constructor whenever that
 * URI is truthy, and the wallet is handed a pairing that no longer exists —
 * while the fresh pairing our provider just created sits unused on the relay.
 * That is why the QR always worked: the sheet renders the fresh `display_uri`,
 * not AppKit's stale state.
 *
 * Best-effort and never throws; the next attempt must not pay for a miss here.
 */
export async function resetPairingState() {
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
 * Wrap `ConnectionControllerUtil.onConnectMobile` — the one place AppKit knows
 * which wallet row the user tapped.
 *
 * Two narrow jobs, no mutation of AppKit's wallet object, URI, encoding or
 * target:
 *
 *   1. remember the wallet, so a bare `wc:` open can be completed into that
 *      wallet's native link instead of being handed to a WebView;
 *   2. reconcile AppKit's pairing state with the LIVE pairing before the SDK
 *      builds the hand-off link — see `resetPairingState`.
 */
export async function installConnectPatch() {
  try {
    const controllers = await import('@reown/appkit-controllers');
    const util = controllers?.ConnectionControllerUtil;
    if (!util || typeof util.onConnectMobile !== 'function') return false;
    if (installed && util.onConnectMobile === installed) return true;

    const original = util.onConnectMobile;
    const wrapper = function onConnectMobile(wallet, wcPayUrl) {
      rememberTappedWallet(wallet);
      try {
        const stateUri = controllers.ConnectionController?.state?.wcUri;
        if (livePairingUri && stateUri !== livePairingUri) {
          controllers.ConnectionController.setUri(livePairingUri);
        }
      } catch {
        /* the state shape changed — the original call still runs below */
      }
      return original.call(util, withLinkMode(wallet), wcPayUrl);
    };
    util.onConnectMobile = wrapper;
    installed = wrapper;
    return util.onConnectMobile === wrapper;
  } catch {
    return false;
  }
}

/**
 * Fill AppKit's optional HTTPS fallback for Explorer rows that omit it.
 *
 * This does NOT select the universal link: `preferUniversalLinks` stays false
 * and native remains primary. It only makes sure a restricted channel has a
 * known fallback to fall back TO.
 */
export function withLinkMode(wallet) {
  if (!wallet || typeof wallet !== 'object' || wallet.link_mode) return wallet;
  const known = walletForObject(wallet);
  if (!known) return wallet;
  return { ...wallet, link_mode: linkBase(known.universal) };
}

/**
 * Re-assert the WalletConnect surface's options on the shared singleton.
 *
 * `enableWallets: true` + `manualWCControl: true` belong to THIS surface: the
 * first renders the wallet rows, the second is what routes mobile devices to
 * the wallet list when the modal opens. `features` is flattened to
 * `{ email: false, socials: false }` — an email row here would start an auth
 * connection that the pending `wc.connect()` can never settle on.
 *
 * @returns {Promise<boolean>} whether the assertion actually ran. Reporting it
 *   matters: a diagnostic that claims work that changed nothing is worse than
 *   one that admits it did nothing.
 */
export async function applyWalletSurface({ modal, projectId, metadata }) {
  const options = {
    customWallets: appKitCustomWallets(projectId),
    experimental_preferUniversalLinks: false,
    metadata,
    manualWCControl: true,
    enableWallets: true,
    features: { email: false, socials: false }
  };
  try {
    await installConnectPatch();
  } catch {
    /* the patch is an enhancement, never a blocker */
  }
  try {
    if (modal && typeof modal.updateOptions === 'function') {
      modal.updateOptions(options);
      return true;
    }
  } catch {
    /* fall through to the controllers singleton */
  }
  try {
    const controllers = await import('@reown/appkit-controllers');
    const C = controllers?.OptionsController;
    C?.setCustomWallets?.(options.customWallets);
    C?.setPreferUniversalLinks?.(options.experimental_preferUniversalLinks);
    C?.setMetadata?.(options.metadata);
    C?.setManualWCControl?.(options.manualWCControl);
    C?.setEnableWallets?.(options.enableWallets);
    C?.setFeatures?.(options.features);
    return true;
  } catch {
    return false;
  }
}

/** Convenience for the sheet: the links for a wallet, from the live URI. */
export function linksForWallet(wallet, uri) {
  return walletLinks(wallet, uri);
}
