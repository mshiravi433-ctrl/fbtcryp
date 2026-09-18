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
let corePatched = false;

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
 * Patch CoreHelperUtil to NEVER use _self — the root cause of the dApp
 * disappearing and landing on https://uniswap.org/app/wc?uri=... after back.
 * _self replaces this document, killing the relay socket and the pending
 * connect() promise. _blank preserves the dApp.
 */
async function patchCoreHelper() {
  if (corePatched) return true;
  try {
    const controllers = await import('@reown/appkit-controllers');
    const core = controllers?.CoreHelperUtil;
    if (!core) return false;
    // Force _blank for all wallet opens
    const origOpenHref = core.openHref;
    if (typeof origOpenHref === 'function' && !core.__fbtPatched) {
      core.openHref = function patchedOpenHref(href, target, features) {
        try {
          // Always _blank for wallet hand-offs
          return origOpenHref.call(this, href, '_blank', features || 'noreferrer noopener');
        } catch {
          try { window?.open?.(href, '_blank', 'noreferrer noopener'); } catch {}
          return null;
        }
      };
      core.__fbtPatched = true;
    }
    const origGetTarget = core.getOpenTargetForPlatform;
    if (typeof origGetTarget === 'function' && !core.__fbtTargetPatched) {
      core.getOpenTargetForPlatform = function patchedGetTarget() {
        return '_blank';
      };
      core.__fbtTargetPatched = true;
    }
    corePatched = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap `ConnectionControllerUtil.onConnectMobile` — the one place AppKit knows
 * which wallet row the user tapped.
 *
 * Three jobs:
 *   1. remember the wallet, so a bare `wc:` open can be completed into that
 *      wallet's native link instead of being handed to a WebView;
 *   2. reconcile AppKit's pairing state with the LIVE pairing before the SDK
 *      builds the hand-off link — see `resetPairingState`.
 *   3. attempt a synchronous open via our own handoff logic FIRST, so the
 *      user gesture is preserved and popup-blocker does not kill it.
 *      If sync fails, fall back to the original (which is now patched to _blank).
 */
export async function installConnectPatch() {
  try {
    await patchCoreHelper();
    const controllers = await import('@reown/appkit-controllers');
    const util = controllers?.ConnectionControllerUtil;
    const connCtrl = controllers?.ConnectionController;
    if (!util || typeof util.onConnectMobile !== 'function') return false;
    if (installed && util.onConnectMobile === installed) return true;

    const original = util.onConnectMobile;

    // Import sync opener statically for the wrapper closure
    let syncOpener = null;
    try {
      const handoff = await import('./handoff.js');
      syncOpener = handoff.openWalletLinkSync;
    } catch { syncOpener = null; }

    const wrapper = function onConnectMobile(wallet, wcPayUrl) {
      rememberTappedWallet(wallet);
      try {
        const stateUri = connCtrl?.state?.wcUri;
        if (livePairingUri && stateUri !== livePairingUri) {
          connCtrl.setUri(livePairingUri);
        }
      } catch {
        /* the state shape changed — the original call still runs below */
      }

      // Try synchronous open with our own logic FIRST
      try {
        const uri = connCtrl?.state?.wcUri || livePairingUri || '';
        const known = walletForObject(wallet);
        if (uri && known && syncOpener) {
          const links = walletLinks(known, uri);
          if (links.native) {
            const ok = syncOpener(links.native, {
              pairingUri: uri,
              wallet: known,
              walletPackage: known.androidPackage || '',
              fallbackUrl: links.universal || '',
              view: typeof window !== 'undefined' ? window : null
            });
            if (ok) {
              // Still set the wcLinking/recentWallet state so AppKit UI shows "Continue"
              try {
                connCtrl.setWcLinking?.({ name: wallet.name, href: links.native });
                connCtrl.setRecentWallet?.(wallet);
              } catch {}
              return;
            }
          }
        }
      } catch {
        /* sync open failed — fall through to original */
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
 * Read the SHARED controllers' connection facts — the exact state every
 * `<w3m-modal>` renders from, no matter which instance opened it.
 *
 * WHY THIS EXISTS: the 2026-09-18 report answered every storage question
 * (`storedConnectors: []`, `connectionStatus: 'disconnected'`) yet the email
 * modal still opened on the Account view with a balance. What the report
 * CANNOT see is the in-memory half of the same state —
 * `ChainController.state.activeCaipAddress` is what `getIsConnectedState()`
 * returns, `noAdapters` decides whether the email widget renders at all, and
 * neither is persisted anywhere. This reader turns that half into traceable
 * booleans (and whitelisted tokens), so the NEXT report names the surface the
 * modal actually opened on instead of leaving it to inference.
 *
 * Nothing raw leaves this function: the address is reduced to a boolean, the
 * connector id to a token the trace whitelist already knows.
 */
export async function readSharedConnectionFacts() {
  try {
    const controllers = await import('@reown/appkit-controllers');
    const C = controllers ?? {};
    const address = C.ChainController?.state?.activeCaipAddress;
    return {
      available: true,
      /* getIsConnectedState() is literally Boolean(activeCaipAddress). */
      isConnected: Boolean(address),
      connectorId: C.ConnectorController?.getConnectorId?.('eip155') || null,
      authConnection: Boolean(C.ConnectionController?.hasAnyConnection?.('AUTH')),
      view: C.RouterController?.state?.view || null,
      noAdapters: Boolean(C.ChainController?.state?.noAdapters),
      modalOpen: Boolean(C.ModalController?.state?.open)
    };
  } catch {
    /* the controllers chunk is unavailable (offline first paint): report the
       absence rather than a confident zero. */
    return {
      available: false,
      isConnected: false,
      connectorId: null,
      authConnection: false,
      view: null,
      noAdapters: false,
      modalOpen: false
    };
  }
}

/**
 * Tear the SHARED controller state down the way AppKit's own disconnect does.
 *
 * ─── WHY THIS IS NEEDED AT ALL ─────────────────────────────────────────────
 * The WalletConnect surface's modal is created by
 * `@walletconnect/ethereum-provider` with ZERO adapters, and the only code in
 * the SDK that clears the shared `ChainController` when a wallet dies is
 * `listenAdapter`'s `adapter.on('disconnect') → onDisconnectNamespace` — a
 * listener that never exists for an adapter-less instance. So after a
 * WalletConnect connect→disconnect cycle the shared singletons keep
 * describing the dead wallet forever:
 *
 *   • `activeCaipAddress` — `getIsConnectedState()` stays true, and the modal
 *     the EMAIL surface opens renders the dead wallet's Account view
 *     (address, balance) instead of the email form — the exact report.
 *   • `ConnectorController.activeConnectorIds.eip155` — a stale id the next
 *     boot's `syncNamespaceConnection` tries to reconnect as.
 *   • `noAdapters` — one-way in the SDK (only ever set true, never reset), so
 *     the adapter-less WC instance leaves it true for the page; the connect
 *     view then hides the email/social widgets (`isEmailEnabled =
 *     remoteFeatures.email && !noAdapters`) and `ModalController.open` routes
 *     mobile to AllWallets.
 *
 * Guarded and best-effort on purpose: a controller shape change must never
 * break the login, only make the next trace say so.
 *
 * @returns {Promise<boolean>} whether the controllers were reachable.
 */
export async function resetSharedConnectionState() {
  let touched = false;
  try {
    const controllers = await import('@reown/appkit-controllers');
    const C = controllers ?? {};
    /* WC pairing residue: dead URI, wallet-deep-link, 'connecting' status. */
    try { C.ConnectionController?.resetWcConnection?.(); touched = true; } catch { /* best-effort */ }
    /* The account itself: address, balance, profile, connector id (it calls
       removeConnectorId itself), back to 'disconnected'. */
    try { C.ChainController?.resetAccount?.('eip155'); touched = true; } catch { /* best-effort */ }
    /* Belt and braces: resetAccount clears it, but a shape change in either
       direction must not leave a stale id behind. */
    try { C.ConnectorController?.removeConnectorId?.('eip155'); touched = true; } catch { /* best-effort */ }
    /* In-memory connection list — what `hasAnyConnection('AUTH')` reads to
       disable the email input. Cleared through the official setter so valtio
       notifies the widgets. */
    try { C.ConnectionController?.setConnections?.([], 'eip155'); touched = true; } catch { /* best-effort */ }
    /* `noAdapters` has no setter — the SDK only ever sets it true. Direct
       write to the valtio proxy is the only way back to the email-capable
       surface this page started with. */
    try {
      if (C.ChainController?.state) C.ChainController.state.noAdapters = false;
      touched = true;
    } catch { /* best-effort */ }
    return touched;
  } catch {
    return false;
  }
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
