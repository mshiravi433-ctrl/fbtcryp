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
 * The routing flags, forced back to what the EMAIL surface needs — in-memory
 * only, never storage.
 *
 * ─── THE «EMAIL TAP OPENS THE WALLET LIST» REPORT (2026-09-18) ──────────────
 * Reproduced against the shipped singletons: the WalletConnect surface's
 * AppKit instance is created by `@walletconnect/ethereum-provider` through
 * `@reown/appkit/core` with ZERO adapters, and its `initialize()` writes two
 * flags into the shared controllers that the SDK then NEVER resets:
 *
 *   • `ChainController.state.noAdapters` — `ChainController.initialize([])`
 *     sets it true and the SDK has no setter back to false (a later
 *     adapter-bearing `initialize()` only ever sets it true, never false);
 *   • `OptionsController.state.manualWCControl` — set true by the WC
 *     instance's `initializeUniversalAdapter()`.
 *
 * `ModalController.open({ view: 'Connect' })` reads both BEFORE it honours
 * the requested view:
 *
 *     else if (manualWCControl || (noAdapters && !caipAddress))
 *         → 'AllWallets' on mobile, 'ConnectingWalletConnectBasic' on desktop
 *
 * So after ANY WalletConnect use on the page, an email tap whose boot marker
 * still stands (the `fresh=false` path, which skips the full
 * `resetSharedConnectionState()` on purpose — that reset purges state a live
 * frame session is owed) opens the searchable wallet grid instead of the
 * email form. The grid is dead on this surface: its rows need a `wcUri`
 * only a pairing creates, and the email instance pairs nothing — hence «the
 * WalletConnect popup appears and nothing connects», while a marker-less tap
 * (fresh, fully reset) works. That asymmetry is exactly the «sometimes it
 * connects» half of the report.
 *
 * Clearing the flags is safe in every direction:
 *   • they describe the last instance that initialised, not a session —
 *     this surface ALWAYS carries the ethers adapter, so `noAdapters:false`
 *     is the truth for it;
 *   • the WC surface is unaffected: its modal routing keys on
 *     `manualWCControl:true` (re-asserted by `applyWalletSurface` before each
 *     WC open), and the next WC `initialize([])` sets `noAdapters` back
 *     where it belongs for that surface;
 *   • nothing here touches `activeCaipAddress`, the connection list or any
 *     storage key — a live frame session the marker describes is left
 *     exactly as it is.
 *
 * Best-effort and never throws: a controllers chunk that cannot load (the
 * offline first paint) returns 'unavailable' so the caller can trace it, and
 * the flow continues — the pre-open `reassertFeatures()` still re-asserts
 * the OptionsController half through the instance itself.
 *
 * @returns {Promise<'fixed'|'clean'|'unavailable'>} what happened, for the
 *   trace — never a boolean that hides which one.
 */
export async function assertEmailRouting() {
  let C;
  try {
    C = (await import('@reown/appkit-controllers')) ?? {};
  } catch {
    return 'unavailable';
  }
  let fixed = false;
  try {
    /* The one-way latch the SDK never releases — see the doc comment. */
    if (C.ChainController?.state?.noAdapters === true) {
      C.ChainController.state.noAdapters = false;
      fixed = true;
    }
  } catch { /* a shape change must never break the login */ }
  try {
    if (C.OptionsController?.state?.manualWCControl === true) {
      C.OptionsController.state.manualWCControl = false;
      fixed = true;
    }
  } catch { /* same */ }
  try {
    /* Belt and braces for `reassertFeatures()`: even when its updateOptions
       path is unavailable, the email popup must not grow the wallet list. */
    if (C.OptionsController?.state?.enableWallets === true) {
      C.OptionsController.state.enableWallets = false;
      fixed = true;
    }
  } catch { /* same */ }
  return fixed ? 'fixed' : 'clean';
}

/**
 * THE EMAIL SURFACE'S CLAIM ON THE ACTIVE NETWORK.
 *
 * ─── WHY THE FLAGS ABOVE ARE NOT ENOUGH (the «Action not allowed» reports) ──
 * `assertEmailRouting()` decides WHICH VIEW opens; this decides WHICH CHAIN the
 * secure frame boots on — and the frame only serves a hard-coded list of 24
 * eip155 networks (`W3mFrame#networks` in @reown/appkit-wallet 1.8.19). The app
 * ships 16 chains, 8 of which are NOT on that list (Unichain 130, Monad 143,
 * Sonic 146, Robinhood 4663, Mantle 5000, Linea 59144, Berachain 80094, Scroll
 * 534352). Two pieces of that chain state are read by the SDK and neither can
 * be trusted to name a supported chain:
 *
 *   • `@appkit/active_caip_network_id` — `ChainController.initialize()` reads it
 *     FIRST and adopts it whenever it matches a network in the list, so an
 *     email boot after a WalletConnect session that ended on Sonic starts the
 *     frame on Sonic.
 *   • `ChainController.state.activeCaipNetwork` (and the per-namespace
 *     `networkState.caipNetwork`) — what `getActiveCaipNetwork()` returns, i.e.
 *     the `chainId`+`rpcUrl` EVERY frame RPC carries (`request()` sets both from
 *     it) and the `chainId` the iframe URL is built with.
 *
 * A frame asked to serve a network it never advertised is the reported
 * «Action not allowed» / «action not valid», so the email surface pins the
 * active network to one it can actually serve, exactly the way it pins the
 * routing flags.
 *
 * ─── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 * Never touches anything while an address is attached: a live wallet sits on
 * the chain the user chose, and yanking `activeCaipNetwork` out from under it
 * would desynchronise the signer from the UI. That is reported as `'blocked'`
 * (and traced) instead of being "fixed" behind the user's back.
 *
 * @param {object} options
 * @param {Array<{id:number|string}>} options.networks — the chain objects the
 *   email instance advertises (embedded.js#buildNetworks), so the pin uses the
 *   exact object AppKit itself would have used.
 * @param {Iterable<number>} options.supportedChainIds — the frame's own list,
 *   intersect our registry (embedded.js#EMAIL_FRAME_CHAIN_IDS).
 * @param {number} [options.defaultChainId] — the chain to pin to.
 * @returns {Promise<'fixed'|'clean'|'blocked'|'unavailable'>} what happened,
 *   for the trace — never a boolean that hides which one.
 */
export async function assertEmailNetwork({ networks = [], supportedChainIds = [], defaultChainId } = {}) {
  const supported = new Set(
    [...supportedChainIds].map(Number).filter((id) => Number.isFinite(id))
  );
  if (supported.size === 0) return 'unavailable';
  const preferred = supported.has(Number(defaultChainId))
    ? Number(defaultChainId)
    : Number([...supported][0]);
  const byId = new Map();
  for (const network of Array.isArray(networks) ? networks : []) {
    const id = Number(network?.id);
    if (Number.isFinite(id)) byId.set(id, network);
  }
  const fallback = byId.get(preferred) ?? byId.get(Number([...supported].find((id) => byId.has(id))));

  let fixed = false;

  /* 1. The persisted pick — read by initialize() BEFORE anything else. */
  try {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    if (storage) {
      const raw = String(storage.getItem('@appkit/active_caip_network_id') || '');
      if (raw) {
        const id = Number(raw.split(':').pop());
        if (Number.isFinite(id) && !supported.has(id)) {
          storage.removeItem('@appkit/active_caip_network_id');
          fixed = true;
        }
      }
    }
  } catch { /* storage unavailable — the in-memory half below still runs */ }

  /* 2. The in-memory half — what the frame's RPCs are stamped with. */
  try {
    const controllers = (await import('@reown/appkit-controllers')) ?? {};
    const C = controllers.ChainController;
    const state = C?.state;
    if (!state) return fixed ? 'fixed' : 'clean';
    const namespaced = C?.getNetworkData?.('eip155')?.caipNetwork;
    const active = state.activeCaipNetwork;
    const candidates = [namespaced, active].filter((network) => network && Number.isFinite(Number(network.id)));
    const unsupported = candidates.find((network) => !supported.has(Number(network.id)));
    if (!unsupported) return fixed ? 'fixed' : 'clean';
    if (state.activeCaipAddress) return 'blocked';
    if (!fallback) return fixed ? 'fixed' : 'unavailable';
    C.setActiveCaipNetwork(fallback);
    return 'fixed';
  } catch {
    return fixed ? 'fixed' : 'unavailable';
  }
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
    /*
     * ─── WHY `authConnection` IS NOT ENOUGH (the disabled email input) ──────
     * `hasAnyConnection('AUTH')` checks the connector ID and nothing else, and
     * that boolean is EXACTLY what `w3m-email-login-widget` renders the email
     * input's `disabled` attribute from. A live AUTH connection always carries
     * its accounts (the adapter writes them together with the connection), so
     * an entry with an AUTH id and an EMPTY account list is residue from an
     * attempt whose teardown lost its race — and while it sits in the shared
     * map, the email box opens with the input disabled and the tap does
     * nothing at all. The two facts are therefore reported separately instead
     * of collapsed into one boolean that cannot tell a wallet from a ghost.
     */
    const connections = C.ConnectionController?.state?.connections;
    let authEntries = 0;
    let authAccounts = 0;
    if (connections && typeof connections.values === 'function') {
      for (const list of connections.values()) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          if (entry?.connectorId !== 'AUTH') continue;
          authEntries += 1;
          authAccounts += Array.isArray(entry?.accounts) ? entry.accounts.length : 0;
        }
      }
    }
    return {
      available: true,
      /* getIsConnectedState() is literally Boolean(activeCaipAddress). */
      isConnected: Boolean(address),
      connectorId: C.ConnectorController?.getConnectorId?.('eip155') || null,
      authConnection: authEntries > 0,
      authEntries,
      authAccounts,
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
      authEntries: 0,
      authAccounts: 0,
      view: null,
      noAdapters: false,
      modalOpen: false
    };
  }
}

/**
 * Delete the AUTH entries that carry no account — the ones that disable the
 * email input without being a wallet.
 *
 * `ConnectionController.setConnections(list, namespace)` REPLACES that
 * namespace's list, so the removal goes through the official setter and valtio
 * notifies the widgets: the email box that was rendered disabled re-enables
 * itself the moment the ghost is gone. Nothing else is touched — no account
 * reset, no connector id, no storage — because this runs on paths where a
 * session may genuinely be owed and only the input's `disabled` binding is
 * wrong. A live address is a hard stop: it means a wallet owns the map, and
 * resolving that belongs to `resetSharedConnectionState()`, not here.
 *
 * @returns {Promise<number>} how many ghost entries were removed.
 */
export async function clearPhantomAuthConnection() {
  try {
    const controllers = await import('@reown/appkit-controllers');
    const C = controllers ?? {};
    if (C.ChainController?.state?.activeCaipAddress) return 0;
    const connections = C.ConnectionController?.state?.connections;
    if (!connections || typeof connections.entries !== 'function') return 0;
    let removed = 0;
    for (const [namespace, list] of connections.entries()) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter((entry) => {
        const phantom = entry?.connectorId === 'AUTH'
          && (!Array.isArray(entry?.accounts) || entry.accounts.length === 0);
        if (phantom) removed += 1;
        return !phantom;
      });
      if (kept.length !== list.length) {
        try {
          C.ConnectionController.setConnections(kept, namespace);
        } catch { /* best-effort: the guest list stays, the login still opens */ }
      }
    }
    return removed;
  } catch {
    return 0;
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
