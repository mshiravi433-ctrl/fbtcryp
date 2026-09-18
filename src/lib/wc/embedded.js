/**
 * EMAIL & SOCIAL LOGIN — the secure embedded wallet
 * ---------------------------------------------------------------------------
 * A user connects with an email address or a social account and AppKit
 * provisions a non-custodial wallet behind that login. The rest of the app
 * talks to it through the same EIP-1193 → ethers path an injected wallet uses,
 * so swap/send/sign need no special case for it.
 *
 * ─── WHY IT IS ITS OWN INSTANCE ─────────────────────────────────────────────
 * The WalletConnect modal is created by `@walletconnect/ethereum-provider`, and
 * that provider hard-disables auth wallets (`features: { email: false, socials:
 * false }`) — a `wc.connect()` promise can only settle on a WalletConnect
 * session, and an email login never becomes one. So email/social needs its own
 * `createAppKit()` with the ethers adapter. See appkit.js for the
 * shared-singleton rule that keeps the two instances from fighting.
 *
 * ─── THE TWO MARKERS ───────────────────────────────────────────────────────
 * There is no `wc@2:` session for this wallet, so a returning cold start needs
 * a flag to know it should look. Two flags exist, and the distinction is the
 * whole trick:
 *
 *   OURS (`fbt_email_social_connected`) — claimed when an attempt STARTS,
 *     because email OTP and social OAuth are redirect-shaped on mobile: the
 *     browser leaves the site and comes back as a FRESH document owning none of
 *     the listeners the flow registered.
 *
 *   THE SDK'S (`@appkit-wallet/EMAIL_LOGIN_USED_KEY`) — `W3mFrameProvider`
 *     reads it in its CONSTRUCTOR to decide whether to create the
 *     secure.walletconnect.org iframe at all. If it is missing the iframe is
 *     never created and `isConnected()` short-circuits to false without asking
 *     anybody — the returning page cannot see a perfectly healthy session. The
 *     SDK also DELETES it on any transient failure (its `isConnected()` catch
 *     calls `deleteAuthLoginCache()`), so our copy has to be able to hand it
 *     back.
 *
 * A marker that lies for one boot and self-corrects beats a truth that arrives
 * one page-load too late.
 */

import { DEFAULT_CHAIN, EVM_CHAINS } from '../chains.js';
import { readSharedConnectionFacts, resetSharedConnectionState } from './appkit.js';
import { TIMEOUT, WC_PROJECT_ID, wcMetadata } from './config.js';
import { purgeConnectionKeys } from './storage.js';
import { sleep } from './timing.js';
import { wcEvent, wcEventDetail } from './trace.js';

export const EMAIL_MARKER_KEY = 'fbt_email_social_connected';
export const SDK_LOGIN_KEY = '@appkit-wallet/EMAIL_LOGIN_USED_KEY';
const SDK_LOGIN_VALUE = 'true';

/**
 * How long a returning cold start waits for the frame to rehydrate.
 *
 * It must be LONGER than the SDK's own bound: every frame request awaits
 * `frameLoadPromise`, and `appEvent()` arms a 20s `iframeReadyTimeout` before
 * declaring `iframe_load_failed`. An earlier 8s window was smaller than the
 * SDK's own timeout for the same operation, so a correct-but-slow return could
 * never win the race — and the losing branch ERASED the boot marker, turning
 * one slow boot into a permanent loss.
 */
export const EMAIL_RESTORE_WINDOW_MS = TIMEOUT.emailRestore;

/** The social providers AppKit knows how to render, in display order. */
export const SOCIAL_PROVIDERS = Object.freeze([
  'google',
  'apple',
  'x',
  'facebook',
  'github',
  'discord',
  'farcaster'
]);

function store(storage) {
  return storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
}

export function hasMarker(storage) {
  const target = store(storage);
  if (!target) return false;
  try {
    return target.getItem(EMAIL_MARKER_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMarker(on, storage) {
  const target = store(storage);
  if (!target) return false;
  try {
    if (on) target.setItem(EMAIL_MARKER_KEY, '1');
    else target.removeItem(EMAIL_MARKER_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand the SDK's login marker back when ours says a login was attempted and the
 * SDK's own record is gone.
 *
 * @returns {'present'|'rearmed'|'not_marked'|'unavailable'} — a value the trace
 *   can record, never a boolean that hides which one happened.
 */
export function rearmSdkLoginMarker(storage) {
  const target = store(storage);
  if (!target) return 'unavailable';
  if (!hasMarker(target)) return 'not_marked';
  try {
    if (String(target.getItem(SDK_LOGIN_KEY) || '') === SDK_LOGIN_VALUE) return 'present';
    target.setItem(SDK_LOGIN_KEY, SDK_LOGIN_VALUE);
    return 'rearmed';
  } catch {
    return 'unavailable';
  }
}

/**
 * Does the SDK's own login marker stand? A PURE read — unlike
 * `rearmSdkLoginMarker()` this never writes, so it can gate a decision.
 *
 * The distinction it supports: our marker claims a login was ATTEMPTED, the
 * SDK's says the frame still HOLDS one. When the SDK's is gone (its
 * `isConnected()` catch deletes it, or the frame answered «not connected»),
 * our marker is describing a session nobody is owed — forgetting it is the
 * honest move. When the SDK's stands, a live frame session may be one
 * provider-poll away from attaching, and must not be logged out from under
 * the user.
 */
export function sdkLoginMarkerPresent(storage) {
  const target = store(storage);
  if (!target) return false;
  try {
    return String(target.getItem(SDK_LOGIN_KEY) || '') === SDK_LOGIN_VALUE;
  } catch {
    return false;
  }
}

/**
 * AppKit network definitions built FROM OUR OWN REGISTRY, so the embedded
 * wallet sees exactly the chains the rest of the app supports — including the
 * geo-friendly RPC order each chain curates. DEFAULT_CHAIN leads: AppKit treats
 * the first network as the default.
 */
export function buildNetworks() {
  const ids = [DEFAULT_CHAIN, ...Object.keys(EVM_CHAINS).map(Number).filter((id) => id !== DEFAULT_CHAIN)];
  return ids
    .filter((id) => EVM_CHAINS[id])
    .map((id) => {
      const cfg = EVM_CHAINS[id];
      return {
        id,
        caipNetworkId: `eip155:${id}`,
        chainNamespace: 'eip155',
        name: cfg.name,
        nativeCurrency: {
          name: cfg.native.symbol,
          symbol: cfg.native.symbol,
          decimals: cfg.native.decimals
        },
        rpcUrls: { default: { http: cfg.rpc.slice(0, 3) } },
        blockExplorers: cfg.explorer ? { default: { name: cfg.name, url: cfg.explorer } } : undefined
      };
    });
}

/**
 * The createAppKit() options for this surface — every isolation flag is a
 * measured decision:
 *
 *  • `emailShowWallets: false` — the wallet rows belong to the WalletConnect
 *    surface; on THIS instance `onConnectMobile()` can never fire (it needs
 *    `wcUri`, which only a pairing creates), so the rows would be silent
 *    dead ends.
 *  • `enableWallets: false` — AppKit's DEFAULT is TRUE, and
 *    `w3m-connect-view.walletListTemplate()` renders the whole "Continue with a
 *    wallet" surface from it. Without this the email popup grows a wallet list
 *    that cannot connect.
 *  • `enableInjected/enableCoinbase/enableEIP6963/enableWalletConnect: false` —
 *    the four surfaces the app already owns elsewhere; without this the email
 *    modal would offer the very flows it exists not to duplicate.
 *  • `manualWCControl` is NEVER set — that flag belongs to the
 *    ethereum-provider embedding, and here it would hijack `open()` to route
 *    MOBILE devices to the AllWallets list instead of the email box.
 */
export function emailOptions({ projectId, metadata }) {
  const networks = buildNetworks();
  return {
    networks,
    defaultNetwork: networks[0],
    projectId,
    metadata,
    themeMode: 'dark',
    features: {
      email: true,
      socials: [...SOCIAL_PROVIDERS],
      emailShowWallets: false
    },
    enableWallets: false,
    enableInjected: false,
    enableCoinbase: false,
    enableEIP6963: false,
    enableWalletConnect: false
  };
}

/** Exactly one instance per page lifetime: a second createAppKit() would only
 *  re-describe the same singletons. */
let instance = null;

/** Set when an instance was retired, so the next createAppKit() can trace the
 *  recreate as a distinct event — the report should be able to say «the
 *  instance was rebuilt», not just «it became ready». */
let retired = false;

/**
 * Does the SHARED controllers state still describe an embedded-wallet (AUTH)
 * connection?
 *
 * The singletons are process-wide, so this reads the same map
 * `w3m-email-login-widget` reads — and its render does
 * `?disabled=${hasAnyConnection('AUTH')}` on the email input. An entry left
 * there by an attempt whose teardown lost its race is what made the email box
 * open already disabled («the popup opens and email does nothing»).
 */
async function sharedAuthConnection() {
  try {
    const controllers = await import('@reown/appkit-controllers');
    return Boolean(controllers?.ConnectionController?.hasAnyConnection?.('AUTH'));
  } catch {
    return false;
  }
}

/**
 * Retire the current page's instance, bounded.
 *
 * Purging storage cleans what the NEXT boot reads; it cannot reach the
 * IN-MEMORY ConnectionController map of an instance that is already alive. When
 * a fresh login finds that map still describing an AUTH wallet, the instance is
 * disconnected (4s bound — a hung frame must not own the tap) and dropped, so
 * the replacement boots against state nothing stale describes.
 */
async function retireInstance(modal) {
  if (!modal) return;
  retired = true;
  wcEvent('email_instance_retired');
  try {
    await Promise.race([
      Promise.resolve(modal.disconnect?.()).catch(() => {}),
      sleep(TIMEOUT.teardown)
    ]);
  } catch {
    /* the recreate below does not depend on the disconnect succeeding */
  }
}

/**
 * Wait for the instance to finish booting BEFORE anything is opened on it.
 *
 * ─── THE «GREEN TICK, THEN NOTHING» REPORT ─────────────────────────────────
 * `createAppKit()` returns synchronously and starts `initialize()` in the
 * background (`this.readyPromise = this.initialize(options)`), and `open()` is
 * never gated on it. Everything the email box needs is created AT THE END of
 * that async boot:
 *
 *   initialize() → fetchRemoteFeatures() → createAuthProvider() →
 *   W3mFrameProviderSingleton.getInstance(…) → the secure.walletconnect.org
 *   iframe.
 *
 * Open the modal first and the email field renders — it is drawn from the
 * `features` we re-assert — while the provider that would have answered it does
 * not exist yet. The submit resolves into nothing, the OTP step never appears,
 * and the user's report is «I press continue and nothing happens».
 *
 * Bounded, and a timeout still opens the modal: a blocked Explorer API must
 * never turn into a dead Connect button.
 */
async function awaitReady(modal, ms = TIMEOUT.emailOpen) {
  const ready = modal?.readyPromise;
  if (!ready || typeof ready.then !== 'function') return 'not_promised';
  let timer = null;
  try {
    await Promise.race([
      Promise.resolve(ready).catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, Math.min(ms, 8_000));
      })
    ]);
    return 'ready';
  } catch {
    return 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Lazily create and return the AppKit instance.
 *
 * BOTH the root client and the ethers adapter are dynamic imports, so this
 * feature shares chunks with the WalletConnect modal instead of adding a second
 * copy to the first-paint graph.
 *
 * THE RE-ARM MUST HAPPEN BEFORE createAppKit(), NOT AFTER: `W3mFrameProvider`
 * reads the SDK marker in its constructor, so handing the key back afterwards
 * is one page-load too late. And when an EXISTING instance was built without a
 * frame, a later `setItem` does not resurrect it — only a new constructor does.
 * Without that recreate, a single slow-boot transient would make every later
 * restore wait the full window for an event an absent iframe can never emit.
 *
 * ─── `fresh` — THE CLEAN SLATE A NEW LOGIN ASKS FOR ─────────────────────────
 * `open()` passes it when NO login is claimed (`fresh: !hasMarker()`): the user
 * is starting over, so nothing a PREVIOUS session left behind may survive into
 * this boot. Four residues, four different layers, all handled:
 *
 *   1. localStorage — `purgeConnectionKeys()` (synchronously, before any boot
 *      can read it) removes `@appkit/connections`, `@appkit/connection_status`
 *      and friends — the keys whose survival made the SDK believe a
 *      DISCONNECTED email wallet was still attached, auto-reattach it, and open
 *      the «login» as a phantom account with a balance.
 *   2. the SHARED controllers' in-memory state — `ChainController`'s address/
 *      balance, the connector id, the `noAdapters` flag. The WalletConnect
 *      surface's adapter-less modal can never clear these on disconnect (its
 *      teardown listener never exists), so after a WalletConnect
 *      connect→disconnect cycle they keep describing the dead wallet — and the
 *      email modal opens on ITS Account view with ITS balance. Reset via
 *      `resetSharedConnectionState()` BEFORE anything opens.
 *   3. the in-memory ConnectionController map — invisible to any purge; when it
 *      still holds an AUTH entry the email input renders disabled. Detected via
 *      `sharedAuthConnection()` and answered by retiring the instance.
 *   4. the instance itself — recreated when anything above was dirty, so the
 *      new boot (`syncConnections`, `syncAuthConnector`) reads only clean state.
 *
 * When a login IS claimed (a restore or a claim in progress) nothing here
 * purges: those keys then describe a wallet the user is owed.
 *
 * @returns {Promise<object>} the AppKit instance.
 */
export async function getAppKit({ projectId = WC_PROJECT_ID, metadata = wcMetadata(), fresh = false } = {}) {
  const rearm = rearmSdkLoginMarker();
  if (rearm === 'rearmed' && instance) {
    await retireInstance(instance);
    /* disconnect()'s deleteAuthLoginCache removes the key we just restored. */
    try {
      const target = store();
      if (target && target.getItem(SDK_LOGIN_KEY) !== SDK_LOGIN_VALUE) {
        target.setItem(SDK_LOGIN_KEY, SDK_LOGIN_VALUE);
      }
    } catch { /* storage unavailable */ }
    instance = null;
  }
  if (fresh) {
    const purged = purgeConnectionKeys();
    if (purged) wcEvent('email_open_purged', purged);
    /* ─── THE IN-MEMORY HALF OF THE PHANTOM (2026-09-18 report) ───────────
     * The storage purge above answered every question the last report asked
     * and the modal STILL opened on a balance. What survived was the shared
     * controllers' in-memory state: the WalletConnect surface's modal is
     * created by ethereum-provider with ZERO adapters, so the SDK's own
     * disconnect handler (an ADAPTER listener) never runs for it, and
     * `ChainController.state.activeCaipAddress` — exactly what
     * `getIsConnectedState()` returns — keeps describing the wallet the user
     * disconnected, along with its balance and a `noAdapters` flag the SDK
     * only ever sets true. See appkit.js#resetSharedConnectionState.
     *
     * The reset runs BEFORE anything opens, deliberately: `w3m-modal` closes
     * itself when `activeCaipAddress` turns empty while it is open, so
     * clearing mid-open would slam the email form shut. */
    const shared = await readSharedConnectionFacts();
    const sharedDirty = shared.available
      && (shared.isConnected || Boolean(shared.connectorId) || shared.authConnection || shared.noAdapters);
    let sharedReset = false;
    if (sharedDirty) {
      sharedReset = await resetSharedConnectionState();
      wcEvent('email_shared_reset', sharedReset);
    }
    const dirty = purged > 0
      || sharedDirty
      || instance?.getIsConnectedState?.() === true
      || (await sharedAuthConnection());
    if (dirty && instance) {
      wcEvent('email_open_dirty_instance');
      await retireInstance(instance);
      instance = null;
    }
  }
  if (!instance) {
    const [{ createAppKit }, { EthersAdapter }] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-ethers')
    ]);
    if (retired) wcEvent('email_instance_recreated');
    retired = false;
    instance = createAppKit({ ...emailOptions({ projectId, metadata }), adapters: [new EthersAdapter()] });
    const boot = await awaitReady(instance);
    wcEvent(boot === 'ready' ? 'email_appkit_ready' : 'email_appkit_ready_pending');
  }
  reassertFeatures(instance);
  return instance;
}

/** The instance if one was already created — for paths that must NOT initialise. */
export function appKitIfCreated() {
  return instance;
}

/**
 * The pre-open re-assertion the shared-singleton contract requires.
 *
 * `updateOptions` shallow-merges, so passing `features` replaces the object
 * wholesale: a complete, deterministic description of this surface. Both
 * `manualWCControl` and `enableWallets` are re-asserted because BOTH are
 * singleton state the WalletConnect surface flips.
 */
export function reassertFeatures(modal) {
  if (!modal || typeof modal.updateOptions !== 'function') return false;
  modal.updateOptions({
    manualWCControl: false,
    enableWallets: false,
    features: {
      email: true,
      socials: [...SOCIAL_PROVIDERS],
      emailShowWallets: false
    }
  });
  return true;
}

/**
 * Wait for the embedded wallet to exist AND be usable.
 *
 * FIX 2026-09-17: The "green tick but no wallet" report. The previous version
 * required address AND provider atomically, and gave only 3s grace after modal
 * close. On slow Android WebViews the provider arrives 1-2s after the address,
 * and the modal closes quickly after OTP, so the check timed out and rollback
 * cleared the marker. Now:
 *  - provider getter tries multiple signatures (with/without namespace)
 *  - poll continues after modal close for extended grace
 *  - on timeout, returns address even if provider is temporarily null, so
 *    caller can retry attachExternal with backoff
 */
export async function awaitAccount(modal, {
  timeoutMs = TIMEOUT.emailOpen,
  closeGraceMs = TIMEOUT.emailCloseGrace,
  pollMs = 300
} = {}) {
  if (!modal) return null;

  const tryGetProvider = () => {
    try {
      let p = modal.getWalletProvider?.();
      if (p) return p;
      p = modal.getWalletProvider?.('eip155');
      if (p) return p;
      p = modal.getProvider?.('eip155');
      if (p) return p;
      p = modal.getProvider?.();
      if (p) return p;
      return null;
    } catch { return null; }
  };

  const tryGetAddress = () => {
    try {
      let a = modal.getAddress?.('eip155');
      if (a) return a;
      a = modal.getAddress?.();
      if (a) return a;
      return null;
    } catch { return null; }
  };

  const read = (allowProviderNull = false) => {
    try {
      const isConnected = modal.getIsConnectedState?.();
      if (!isConnected) return null;
      const address = tryGetAddress();
      if (!address) return null;
      const provider = tryGetProvider();
      if (!provider && !allowProviderNull) return null;
      return { address, provider: provider || null };
    } catch {
      return null;
    }
  };

  const ready = read(false);
  if (ready) return ready;

  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    let closeTimer = null;
    let postClosePoll = null;
    const subscriptions = [];

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(outer);
      clearInterval(poll);
      clearTimeout(closeTimer);
      clearInterval(postClosePoll);
      for (const off of subscriptions) {
        try { off?.(); } catch { /* cleanup */ }
      }
      resolve(value);
    };

    const checkStrict = () => {
      const hit = read(false);
      if (hit) finish(hit);
      return hit;
    };

    const outer = setTimeout(() => {
      const last = read(true);
      if (last?.address) finish(last);
      else finish(null);
    }, timeoutMs);

    const poll = setInterval(() => checkStrict(), pollMs);

    const subscribe = (off) => {
      if (settled) off?.();
      else subscriptions.push(off);
    };

    try {
      subscribe(modal.subscribeAccount?.(() => checkStrict(), 'eip155'));
      subscribe(
        modal.subscribeState?.((state) => {
          if (settled) return;
          if (state?.open) {
            opened = true;
            return;
          }
          if (state?.open === false && opened) {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
              const hit = read(false);
              if (hit) finish(hit);
              else {
                let extraAttempts = 0;
                const maxExtra = Math.ceil((closeGraceMs * 2.5) / pollMs);
                postClosePoll = setInterval(() => {
                  extraAttempts += 1;
                  const h = read(false);
                  if (h) finish(h);
                  else if (extraAttempts >= maxExtra) {
                    const lastResort = read(true);
                    finish(lastResort);
                  }
                }, pollMs);
              }
            }, closeGraceMs);
          }
        })
      );
    } catch {
      /* a modal that cannot subscribe can still be polled */
    }
  });
}

/**
 * The embedded wallet's own EIP-1193 provider, straight from the shared auth
 * connector — not from `ProviderController.state.providers`.
 *
 * ─── WHY ────────────────────────────────────────────────────────────────────
 * `getWalletProvider()` reads a different store than the one the login itself
 * populates: the address becomes visible (`ChainController.activeCaipAddress`)
 * the moment the frame answers, while `syncProvider()` fills
 * `providers['eip155']` a beat later — and on a slow Android WebView that beat
 * has outlived every retry, leaving the report «green tick, then nothing
 * works». The auth connector's `provider` IS the `W3mFrameProvider` — a real
 * EIP-1193 object (`request()` → frame RPC) and exactly what the ethers
 * adapter drives — so when the controller store lags, this is not a stand-in,
 * it is the same provider an earlier tick would have returned.
 */
export async function authConnectorProvider(namespace = 'eip155') {
  try {
    const controllers = await import('@reown/appkit-controllers');
    const connector = controllers?.ConnectorController?.getAuthConnector?.(namespace);
    return connector?.provider ?? null;
  } catch {
    return null;
  }
}

/**
 * The facts that say WHAT THE MODAL ACTUALLY OPENED ON.
 *
 * ─── WHY THIS EXISTS (the 2026-09-18 report) ───────────────────────────────
 * The report was taken mid-attempt with exactly ONE trace event
 * (`email_appkit_ready`) — nothing in it could say whether the modal had
 * opened on the email form, the Account view of a wallet nobody logged into,
 * or a wallet list. Every storage question had already been answered clean,
 * so the only suspects left (shared in-memory state) were precisely the ones
 * no event recorded. This snapshot closes that gap: it is taken the moment
 * `modal.open()` settles and again one second later, when late routing (the
 * SDK's own connect/reconnect handlers) has had its say.
 *
 * Every value is trace-safe by construction: booleans, plus tokens the trace
 * whitelist knows (view names, connector ids). The address is never recorded
 * — only that one exists.
 *
 * @returns {Promise<Record<string, boolean|string>>} the detail for
 *   wcEventDetail — see trace.js for what survives.
 */
export async function openSurfaceDetail(modal) {
  const shared = await readSharedConnectionFacts();
  let providerReady = false;
  let modalConnected = false;
  let modalHasAddress = false;
  try {
    providerReady = Boolean(
      modal?.getWalletProvider?.('eip155') ?? modal?.getWalletProvider?.() ?? modal?.getProvider?.('eip155')
    );
  } catch { /* a modal that cannot answer says false */ }
  try {
    modalConnected = Boolean(modal?.getIsConnectedState?.());
  } catch { /* same */ }
  try {
    modalHasAddress = Boolean(modal?.getAddress?.('eip155') ?? modal?.getAddress?.());
  } catch { /* same */ }
  return {
    view: shared.view || 'none',
    modal: shared.modalOpen,
    conn: modalConnected,
    addr: modalHasAddress,
    auth: shared.authConnection,
    cid: shared.connectorId || 'none',
    na: shared.noAdapters,
    prov: providerReady
  };
}

/**
 * Open the login modal and wait for the wallet.
 *
 * The marker is claimed BEFORE the modal opens, because on mobile the flow can
 * be cut off by the redirect before anything happens in this document.
 *
 * TWO GUARDS AROUND THE OPEN ITSELF:
 *
 *   • `fresh: !hasMarker()` — when no login is claimed, the boot gets a clean
 *     slate (see getAppKit). A previous session's leftovers — a persisted AUTH
 *     connection, a 'connected' status — are what turned «login with email»
 *     into «a popup showing the balance of the wallet you had disconnected».
 *
 *   • a bounded `modal.open()` — AppKit awaits `ApiController.prefetch()`
 *     (explorer API fan-out) before the Connect view exists; on a slow network
 *     one stalled call held the whole flow and the user stared at nothing for a
 *     full minute. The bound releases the flow to KEEP WAITING for the account
 *     (the modal may still appear); it only refuses to let a hung prefetch own
 *     the spinner forever.
 */
export async function open({ projectId, metadata } = {}) {
  const fresh = !hasMarker();
  const modal = await getAppKit({ projectId, metadata, fresh });
  setMarker(true);
  reassertFeatures(modal);
  let openError = null;
  const opening = Promise.resolve(modal.open({ view: 'Connect' })).catch((error) => {
    openError = error;
  });
  await Promise.race([opening, sleep(TIMEOUT.emailModalOpen)]);
  /* THE SURFACE SNAPSHOT — taken whether open() resolved, threw or outran the
     bound, because «what was on the screen» is the one fact every previous
     report had to guess at. The second sample one second later catches the
     SDK's own late routing (a reconnect handler flipping the view to Account
     after the Connect view was already set). */
  wcEventDetail('email_open_surface', await openSurfaceDetail(modal));
  setTimeout(() => {
    Promise.resolve(openSurfaceDetail(modal)).then(
      (detail) => wcEventDetail('email_open_surface_settled', detail),
      () => {}
    );
  }, 1000);
  if (openError) {
    wcEvent('email_open_failed');
    await rollback(modal);
    return { ok: false, code: 'CONNECT_FAILED' };
  }
  const account = await awaitAccount(modal, { timeoutMs: TIMEOUT.emailOpen, closeGraceMs: TIMEOUT.emailCloseGrace + 2000 });
  if (!account) {
    /* Two very different stories end at the same line, so the trace has to
       tell them apart: «AppKit says nothing is connected» (the OTP/iframe
       never happened) versus «AppKit says connected but never produced an
       address» (the frame answered, the account did not arrive). */
    wcEvent(
      modal?.getIsConnectedState?.()
        ? 'email_wait_no_address'
        : 'email_wait_timeout'
    );
    await rollback(modal);
    return { ok: false, code: 'CONNECT_FAILED' };
  }
  // If provider is still null but address exists, let caller retry attach — don't fail yet
  if (!account.provider && account.address) {
    // Wait a bit more for provider
    await sleep(800);
    try {
      const p = modal.getWalletProvider?.()
        || modal.getWalletProvider?.('eip155')
        || modal.getProvider?.('eip155')
        || (await authConnectorProvider());
      if (p) account.provider = p;
    } catch {}
  }
  if (!account.provider) {
    // Last chance: the auth connector's own frame provider (see its doc comment)
    try {
      const p = await authConnectorProvider();
      if (p) account.provider = p;
    } catch { /* reported below */ }
  }
  if (!account.provider) {
    // Still no provider — keep marker, but report pending so next cold start retries
    wcEvent('email_connected_no_provider');
    return { ok: true, ...account, provider: null, code: 'NO_PROVIDER_YET' };
  }
  wcEvent('email_connected');
  return { ok: true, ...account };
}

/**
 * Rehydrate a returning session. Single-flight is the caller's job (the context
 * owns it), because three events can ask for the same restore within a second.
 */
export async function restore({ projectId, metadata, timeoutMs = EMAIL_RESTORE_WINDOW_MS } = {}) {
  if (!hasMarker()) return { ok: false, code: 'NOT_MARKED' };
  let modal;
  try {
    modal = await getAppKit({ projectId, metadata });
  } catch {
    /* offline or a blocked chunk: the marker survives for the next cold start */
    wcEvent('email_restore_failed');
    return { ok: false, code: 'APPKIT_UNAVAILABLE' };
  }
  const account = await awaitAccount(modal, { timeoutMs, closeGraceMs: 0 });
  if (!account) {
    const cleared = await rollback(modal);
    wcEvent(cleared ? 'email_restore_none' : 'email_restore_pending');
    return { ok: false, code: cleared ? 'NO_SESSION' : 'PENDING' };
  }
  /* Same lag as open(): the address can beat `providers['eip155']` onto the
     screen by seconds on a slow WebView. The auth connector's frame provider is
     the same object either store would hand back, so a restore that has an
     account but no store entry is still a usable wallet — ask the connector
     before declaring the attach impossible. */
  if (account && !account.provider && account.address) {
    try {
      const p = await authConnectorProvider();
      if (p) account.provider = p;
    } catch { /* attach will report the miss */ }
  }
  wcEvent('email_session_restored');
  return { ok: true, ...account, restored: true };
}

/**
 * Give the boot marker back when an attempt ended with nothing to restore.
 * Now more conservative: if SDK says connected, keep marker even if address
 * is temporarily missing.
 */
export async function rollback(modal) {
  let connected = false;
  try {
    connected = Boolean(modal?.getIsConnectedState?.());
    if (!connected) {
      // Fallback: check address as secondary signal
      connected = Boolean(modal?.getAddress?.('eip155') || modal?.getAddress?.());
    }
  } catch {
    connected = false;
  }
  if (connected) return false;
  setMarker(false);
  return true;
}

/**
 * Forget the session: clear our marker, ask an existing instance to disconnect
 * too (bounded — a hung auth frame must never stall a mode switch), and then
 * PURGE the AppKit connection keys.
 *
 * The purge is not redundant with the disconnect: AppKit's own teardown writes
 * its tombstones and clears `@appkit/connections` only when the frame RPC
 * finishes, and `forget()` does not wait for it to. Without the purge, a
 * disconnect whose sign-out lost that race left the SDK still describing the
 * logged-out wallet as connected — the exact residue that made the next email
 * login open as a phantom account (address, balance, disabled input) instead of
 * the email form.
 */
export async function forget({ timeoutMs = TIMEOUT.teardown } = {}) {
  setMarker(false);
  const modal = instance;
  if (modal && typeof modal.disconnect === 'function') {
    try {
      await Promise.race([
        Promise.resolve(modal.disconnect()).catch(() => {}),
        sleep(timeoutMs)
      ]);
    } catch {
      /* logout is best-effort; the marker above is the state we own */
    }
  }
  purgeConnectionKeys();
  return true;
}
