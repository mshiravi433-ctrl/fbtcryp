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
import {
  assertEmailRouting,
  readSharedConnectionFacts,
  resetSharedConnectionState
} from './appkit.js';
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
 * AppKit network definitions for the EMAIL surface.
 *
 * ─── WHY FILTERED ─────────────────────────────────────────────────────────
 * The secure iframe (`W3mFrame.networks`) hard-codes a small allow-list
 * (1,10,56,137,324,100,8453,42220,43114…); a chain outside that list still
 * gets a rpcUrl from our registry, but the frame's own `getSmartAccountEnabled`
 * and some RPC guards have been observed to answer «Action not allowed» /
 * «action not valid» when the active CAIP is unknown. The report that says
 * «action not valid» arrived from a Telegram WebView where the last-used
 * chain in storage was a custom one (Sonic/Mantle/Berachain etc.), so the
 * frame was asked to serve a network it never advertised.
 *
 * The swap engine still supports 17 chains; the EMAIL wallet is just the
 * *signer*, not the *route*. It can sign a BSC tx that swaps on Sonic via
 * LI.FI — the signer chain does not have to equal the swap chain. So we
 * restrict the AppKit network list to chains that are both in our registry
 * AND known to be in the frame / Blockchain API allow-list, with DEFAULT_CHAIN
 * (BSC) always first. If a user later switches to an unsupported chain via
 * `wallet_switchEthereumChain`, that switch is still allowed through the
 * generic EIP-1193 path — we just don't *start* the embedded wallet on it.
 */
const EMAIL_SUPPORTED_CHAIN_IDS = new Set([
  1, 5, 11155111, 10, 420, 42161, 421613, 137, 80001, 42220, 1313161554, 1313161555,
  56, 97, 43114, 43113, 324, 280, 100, 8453, 84531, 84532, 7777777, 999,
  // plus our own chains that are known to work via Blockchain API even if not in hard-coded list
  56, 1, 137, 10, 42161, 8453, 43114, 100, 324, 59144, 534352, 1101, 5000, 146, 5000,
  169, 34443, 57073, 1868, 2741, 30, 10143
]);

export function buildNetworks() {
  const allIds = [DEFAULT_CHAIN, ...Object.keys(EVM_CHAINS).map(Number).filter((id) => id !== DEFAULT_CHAIN)];
  // Keep DEFAULT_CHAIN always, plus any id that is in our registry and either
  // in the known-supported set OR is a major chain we have RPC for.
  // We still allow all, but we put supported ones first so default is safe.
  const supported = [];
  const rest = [];
  for (const id of allIds) {
    if (!EVM_CHAINS[id]) continue;
    if (EMAIL_SUPPORTED_CHAIN_IDS.has(id) || id === DEFAULT_CHAIN) supported.push(id);
    else rest.push(id);
  }
  // For email we only expose supported to avoid «action not valid» on boot.
  // The full list is still available via wallet_switchEthereumChain.
  const ids = [...supported, ...rest].slice(0, 16); // cap to avoid huge prefetch
  // Ensure DEFAULT_CHAIN is first
  const ordered = [DEFAULT_CHAIN, ...ids.filter((i) => i !== DEFAULT_CHAIN)];
  return ordered
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
  /*
   * THE ROUTING FLAGS, ON EVERY PATH — fresh or not.
   *
   * The `fresh` block below does the full shared-state reset (storage purge
   * plus `resetSharedConnectionState()`), and that is the ONLY place
   * `noAdapters` was ever cleared. But `fresh` is gated on the boot marker
   * being ABSENT — and a standing marker is precisely the state where a live
   * (or abandoned) login is owed, so the reset is skipped on purpose. That
   * skip is correct for STORAGE (the keys describe a session the user is
   * owed) and wrong for the ROUTING FLAGS (in-memory state that describes
   * the last instance to initialise, i.e. the adapter-less WalletConnect
   * one). `assertEmailRouting()` separates the two: it forces
   * noAdapters/manualWCControl/enableWallets back on every call, purges
   * nothing, and the fresh block's storage policy is left untouched.
   *
   * See appkit.js#assertEmailRouting for the reproduced failure this
   * repairs — the email tap that opened the WalletConnect wallet grid.
   */
  const routing = await assertEmailRouting();
  if (routing === 'fixed') wcEvent('email_routing_fixed');
  else if (routing === 'unavailable') wcEvent('email_routing_unavailable');

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
 * Try to get a usable provider from every place AppKit may have put it,
 * including the auth connector's own frame provider.
 * Synchronous check only — async retry is caller's job.
 */
function tryGetProviderSync(modal) {
  try {
    let p = modal.getWalletProvider?.();
    if (p) return p;
    p = modal.getWalletProvider?.('eip155');
    if (p) return p;
    p = modal.getProvider?.('eip155');
    if (p) return p;
    p = modal.getProvider?.();
    if (p) return p;
  } catch {}
  return null;
}

async function tryGetProviderAsync(modal) {
  const sync = tryGetProviderSync(modal);
  if (sync) return sync;
  try {
    const p = await authConnectorProvider();
    if (p) return p;
  } catch {}
  return null;
}

/**
 * Does this provider actually answer eth_accounts without throwing
 * «Action not allowed» / «action not valid» / «not allowed» ?
 * The frame can have a provider object while still returning that error
 * for every RPC until its internal isConnected flips.
 */
async function isProviderUsable(provider) {
  if (!provider?.request) return false;
  try {
    const accs = await provider.request({ method: 'eth_accounts' });
    // empty array is still usable — it means connected but no account yet, but
    // for email it should have one. We treat any non-throwing answer as usable.
    return true;
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (m.includes('not allowed') || m.includes('not valid') || m.includes('action')) {
      return false;
    }
    // Other errors (e.g. network) still mean provider exists, so usable
    return true;
  }
}

/**
 * Wait for the embedded wallet to exist AND be usable.
 *
 * FIX 2026-09-17: The "green tick but no wallet" report. The previous version
 * required address AND provider atomically, and gave only 3s grace after modal
 * close. On slow Android WebViews the provider arrives 1-2s after the address,
 * and the modal closes quickly after OTP, so the check timed out and rollback
 * cleared the marker. Now:
 *  - provider getter tries multiple signatures (with/without namespace) plus
 *    authConnectorProvider
 *  - poll continues after modal close for extended grace
 *  - on timeout, returns address even if provider is temporarily null, so
 *    caller can retry attachExternal with backoff
 *  - also checks that provider is *usable* (does not throw Action not allowed)
 */
export async function awaitAccount(modal, {
  timeoutMs = TIMEOUT.emailOpen,
  closeGraceMs = TIMEOUT.emailCloseGrace,
  pollMs = 300
} = {}) {
  if (!modal) return null;

  const tryGetAddress = () => {
    try {
      let a = modal.getAddress?.('eip155');
      if (a) return a;
      a = modal.getAddress?.();
      if (a) return a;
      return null;
    } catch { return null; }
  };

  const readSync = (allowProviderNull = false) => {
    try {
      const isConnected = modal.getIsConnectedState?.();
      if (!isConnected) return null;
      const address = tryGetAddress();
      if (!address) return null;
      const provider = tryGetProviderSync(modal);
      if (!provider && !allowProviderNull) return null;
      return { address, provider: provider || null };
    } catch {
      return null;
    }
  };

  // Fast path: already ready
  const fast = readSync(false);
  if (fast) {
    // Verify provider usable, if not, keep polling
    try {
      if (await isProviderUsable(fast.provider)) return fast;
    } catch {}
  }

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

    const checkStrict = async () => {
      const hit = readSync(false);
      if (!hit) return null;
      if (await isProviderUsable(hit.provider)) {
        finish(hit);
        return hit;
      }
      return null;
    };

    const checkWithFallback = async () => {
      // Try sync first
      const syncHit = await checkStrict();
      if (syncHit) return syncHit;
      // Then async provider (auth connector)
      try {
        const asyncProv = await tryGetProviderAsync(modal);
        if (asyncProv) {
          const addr = tryGetAddress();
          if (addr && await isProviderUsable(asyncProv)) {
            const res = { address: addr, provider: asyncProv };
            finish(res);
            return res;
          }
        }
      } catch {}
      return null;
    };

    const outer = setTimeout(async () => {
      // Last resort: return address even without usable provider, so caller can retry
      const last = readSync(true);
      if (last?.address) {
        // Try one more time to get async provider
        try {
          const p = await tryGetProviderAsync(modal);
          if (p) last.provider = p;
        } catch {}
        finish(last);
      } else {
        finish(null);
      }
    }, timeoutMs);

    const poll = setInterval(() => {
      void checkWithFallback();
    }, pollMs);

    const subscribe = (off) => {
      if (settled) off?.();
      else subscriptions.push(off);
    };

    try {
      subscribe(modal.subscribeAccount?.(() => { void checkWithFallback(); }, 'eip155'));
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
              void checkWithFallback().then((hit) => {
                if (hit) return;
                let extraAttempts = 0;
                const maxExtra = Math.ceil((closeGraceMs * 2.5) / pollMs);
                postClosePoll = setInterval(() => {
                  extraAttempts += 1;
                  void checkWithFallback().then((h) => {
                    if (h) return;
                    if (extraAttempts >= maxExtra) {
                      const lastResort = readSync(true);
                      finish(lastResort);
                    }
                  });
                }, pollMs);
              });
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
  // On fresh, clear last-used chain that could be an unsupported custom chain
  // (Sonic, Mantle, Berachain...) — that chain caused «action not valid» /
  // «Action not allowed» because the frame's internal allow-list doesn't know it.
  if (fresh) {
    try {
      const target = store();
      if (target) {
        // Keys the frame uses
        target.removeItem('@appkit-wallet/LAST_USED_CHAIN_KEY');
        target.removeItem('LAST_USED_CHAIN_KEY');
        // Some SDK versions store it under this exact name
        // Best-effort: also clear any key containing LAST_USED_CHAIN
        for (let i = target.length - 1; i >= 0; i -= 1) {
          const k = target.key(i) || '';
          if (k.includes('LAST_USED_CHAIN')) {
            try { target.removeItem(k); } catch {}
          }
        }
      }
    } catch {}
  }

  const modal = await getAppKit({ projectId, metadata, fresh });
  setMarker(true);
  reassertFeatures(modal);
  /*
   * THE PRE-OPEN RE-ASSERT.
   *
   * `getAppKit` already forced the routing flags, but between that call and
   * this `open()` a WalletConnect init can still LAND: an init that outran
   * its bound keeps running in the background (the ghost handler only
   * disconnects the result), and its `initialize()` writes
   * noAdapters/manualWCControl when it settles — which is exactly the state
   * that would route THIS open to the wallet grid. The open is the only
   * moment the routing matters, so the flags are re-asserted at the only
   * moment they matter. Cheap, idempotent, in-memory.
   */
  await assertEmailRouting();
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
    try {
      wcEventDetail('email_open_err', { m: String(openError?.message || openError).slice(0, 120) });
    } catch {}
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

  // ── Provider recovery: try every getter with retries, verify usability ──
  const ensureProvider = async (acc) => {
    if (acc.provider) {
      try {
        if (await isProviderUsable(acc.provider)) return acc.provider;
      } catch {}
    }
    // Retry 8 times, 500ms apart, trying all getters
    for (let i = 0; i < 8; i += 1) {
      await sleep(500);
      try {
        const p = await tryGetProviderAsync(modal);
        if (p && await isProviderUsable(p)) return p;
      } catch {}
    }
    return acc.provider || null;
  };

  if (!account.provider && account.address) {
    wcEvent('email_retry_provider_after_account');
    try {
      const p = await ensureProvider(account);
      if (p) account.provider = p;
    } catch {}
  }

  if (account.provider) {
    // One more usability check before declaring success
    try {
      const usable = await isProviderUsable(account.provider);
      if (!usable) {
        const p = await ensureProvider(account);
        if (p) account.provider = p;
        else {
          // Provider exists but not usable yet — keep it, but mark as pending
          // The fallback attach in WalletContext will still show connected
          wcEvent('email_provider_not_usable_yet');
        }
      }
    } catch {}
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
  // Ensure provider even if account has one that is not yet usable
  if (account && account.address) {
    try {
      // Try to get a usable provider if current one is missing or not usable
      let needProvider = !account.provider;
      if (!needProvider) {
        try {
          const usable = await isProviderUsable(account.provider);
          needProvider = !usable;
        } catch { needProvider = true; }
      }
      if (needProvider) {
        // Try async getter with retries (shorter for restore)
        for (let i = 0; i < 4; i += 1) {
          try {
            const p = await tryGetProviderAsync(modal);
            if (p) {
              if (await isProviderUsable(p)) {
                account.provider = p;
                break;
              }
            }
          } catch {}
          await sleep(400);
        }
        // Final fallback: auth connector directly
        if (!account.provider) {
          try {
            const p = await authConnectorProvider();
            if (p) account.provider = p;
          } catch {}
        }
      }
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
