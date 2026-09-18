/**
 * THE SHARED APPKIT SURFACE
 * ---------------------------------------------------------------------------
 * ONE AppKit instance lives on a page now, and it is not ours: the
 * WalletConnect modal is created by `@walletconnect/ethereum-provider` itself.
 *
 * Until 2026-09-18 a second instance existed beside it — the email/social
 * "embedded wallet" (`embedded.js`, retired) — and the two shared AppKit's
 * controllers SINGLETONS (OptionsController, ConnectionController) and the one
 * `<w3m-modal>` element. That sharing is what made an email tap open the
 * WalletConnect wallet grid, and what left the shared state describing a dead
 * wallet after a WalletConnect cycle.
 *
 * The rule that survived the removal is the one that was always doing the
 * work:
 *
 *   THE SURFACE RE-ASSERTS ITS OWN OPTIONS IMMEDIATELY BEFORE IT OPENS.
 *
 * `applyWalletSurface()` is that re-assertion. It also keeps auth wallets
 * HARD-disabled (`features: { email: false, socials: false }`), which is no
 * longer a truce between two instances but simply the truth about this app: a
 * `wc.connect()` promise can only settle on a WalletConnect session, and there
 * is no login left that could produce anything else.
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
 * Read the SHARED controllers' connection facts — the in-memory state the
 * `<w3m-modal>` renders from.
 *
 * WHY THIS EXISTS: a report can answer every STORAGE question
 * (`storedConnectors: []`, `connectionStatus: 'disconnected'`) and still not
 * say what the modal opened on, because half of that state is never
 * persisted: `ChainController.state.activeCaipAddress` is what
 * `getIsConnectedState()` returns, and `noAdapters` + `manualWCControl` are
 * what `ModalController.open()` routes on. This reader turns that half into
 * traceable booleans (and whitelisted tokens), so the NEXT report names the
 * surface the modal actually opened on instead of leaving it to inference.
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
      view: null,
      noAdapters: false,
      modalOpen: false
    };
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
