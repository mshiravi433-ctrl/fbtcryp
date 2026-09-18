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
  assertEmailNetwork,
  assertEmailRouting,
  clearPhantomAuthConnection,
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
 * Drop the frame's own chain residue when it names a chain the frame cannot
 * serve — on EVERY email path, not just the fresh one.
 *
 * ─── WHY «EVERY PATH» (hypothesis that turned out to be the bug) ────────────
 * This cleanup used to live inside `open()`'s `if (fresh)` block, and `fresh`
 * is `!hasMarker()`. A standing marker — `ourMarker: true`, exactly the state
 * the device report shows — therefore kept `@appkit-wallet/LAST_USED_CHAIN_KEY`
 * (= the chain the frame itself last served, written by `setLastUsedChainId()`
 * and read back by `getLastUsedChainId()` for `eth_chainId` and for `connect()`
 * when no chain is given). One abandoned attempt on a custom chain was enough
 * to make every later login ask the frame for that chain again.
 *
 * The frame's last-used chain is not session state — the session token lives in
 * `@appkit-wallet/SESSION_TOKEN_KEY` — so a residue that points outside the
 * frame's own network list is never something to keep. A supported value is
 * left alone: it is the user's genuine last choice, within the list the frame
 * can honour.
 *
 * @returns {{removed: string[], kept: number}} key NAMES only (never values) —
 *   the trace records the count, and a support reader can say which key was
 *   dropped without any chain or address leaking.
 */
export function clearFrameChainResidue(storage) {
  const target = store(storage);
  const removed = [];
  let kept = 0;
  if (!target) return { removed, kept };
  try {
    const names = [];
    const total = Number(target.length) || 0;
    for (let i = 0; i < total; i += 1) {
      const key = target.key(i) || '';
      if (key.includes('LAST_USED_CHAIN')) names.push(key);
    }
    for (const key of names) {
      const value = String(target.getItem(key) ?? '').trim();
      if (!value) {
        target.removeItem(key);
        removed.push(key);
        continue;
      }
      /* Values arrive as either a bare id (`56`) or a CAIP id (`eip155:56`). */
      const chainId = Number(value.includes(':') ? value.split(':').pop() : value);
      if (!Number.isFinite(chainId) || !isEmailFrameChain(chainId)) {
        target.removeItem(key);
        removed.push(key);
      } else {
        kept += 1;
      }
    }
  } catch {
    /* storage unavailable — nothing was removed, nothing else to do */
  }
  return { removed, kept };
}

/**
 * THE CHAINS THE SECURE FRAME ACTUALLY SERVES — the frame's own list.
 *
 * `W3mFrame#networks` (@reown/appkit-wallet 1.8.19) hard-codes these CAIP ids
 * and the frame's RPC/routing guards only answer for them:
 *
 *   eip155 1, 5, 11155111, 10, 420, 42161, 421613, 137, 80001, 42220,
 *          1313161554, 1313161555, 56, 97, 43114, 43113, 324, 280, 100,
 *          8453, 84531, 84532, 7777777, 999  (+ 3 solana ids we do not serve)
 *
 * This constant is the list as the SDK ships it, copied rather than probed for
 * one reason: the copy is what the NEXT upgrade has to be diffed against, and
 * an upgrade that changes it changes where an email wallet can live.
 *
 * The old code kept a second, hand-extended list that claimed Sonic/Mantle/
 * Linea/Scroll were "known to work via the Blockchain API". They are not on
 * the frame's list, and handing the frame a network it never advertised is
 * exactly the «Action not allowed» / «action not valid» the reports describe.
 * One list, the frame's.
 */
const FRAME_NETWORK_IDS = new Set([
  1, 5, 11155111, 10, 420, 42161, 421613, 137, 80001, 42220, 1313161554, 1313161555,
  56, 97, 43114, 43113, 324, 280, 100, 8453, 84531, 84532, 7777777, 999
]);

/**
 * Our registry ∩ the frame's list — the chains an email wallet may live on.
 * For this app's 16-chain registry that is 1, 10, 56, 137, 324, 8453, 42161,
 * 43114 (DEFAULT_CHAIN = 56 among them).
 */
export const EMAIL_FRAME_CHAIN_IDS = Object.freeze(
  Object.keys(EVM_CHAINS)
    .map(Number)
    .filter((id) => FRAME_NETWORK_IDS.has(id))
);

/** Is this chain one the secure frame can actually be asked to serve? */
export function isEmailFrameChain(id) {
  const chainId = Number(id);
  return Number.isFinite(chainId) && EMAIL_FRAME_CHAIN_IDS.includes(chainId);
}

/**
 * AppKit network definitions for the EMAIL surface.
 *
 * ─── ORDER IS THE FIX, NOT THE LENGTH ──────────────────────────────────────
 * The swap engine supports 16 chains and the WalletConnect surface boots its
 * AppKit instance from that full list — the two surfaces share the controllers
 * SINGLETONS, so shrinking the list here would shrink it for WalletConnect too
 * (a surface that works and must keep working). It also would not help: the
 * frame's chain comes from the ACTIVE network, not from the list's length.
 *
 * What matters is the ACTIVE one, and how it is chosen:
 *
 *   • `ChainController.initialize()` adopts a chain from storage when it is in
 *     this list — so an unsupported chain must never be the storage pick
 *     (`assertEmailNetwork()` prunes it before the boot), and
 *   • when there is no valid pick, the SDK falls back to the FIRST entry of the
 *     namespace's list (`getCaipNetwork()` → `requestedCaipNetworks[0]`) — so
 *     the frame-supported chains go FIRST, DEFAULT_CHAIN among them, and every
 *     chain the frame cannot serve goes after them.
 *
 * The email wallet is the *signer*, not the *route*: it can sign a BSC tx that
 * swaps on Sonic via LI.FI, so a wallet pinned to a frame chain is not a
 * limitation on what the app can trade. `switchEmbeddedNetwork()` refuses the
 * unsupported moves explicitly instead of letting the frame answer for itself.
 */
export function buildNetworks() {
  const allIds = [DEFAULT_CHAIN, ...Object.keys(EVM_CHAINS).map(Number).filter((id) => id !== DEFAULT_CHAIN)];
  const frameFirst = [];
  const rest = [];
  for (const id of allIds) {
    if (!EVM_CHAINS[id]) continue;
    if (isEmailFrameChain(id) || id === DEFAULT_CHAIN) frameFirst.push(id);
    else rest.push(id);
  }
  const ids = [...frameFirst, ...rest].slice(0, 16); // cap to avoid huge prefetch
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
 * WHOSE CLAIM IS THE STANDING MARKER? — `'none' | 'owed' | 'stale'`.
 *
 * ─── THE STATE THE DEVICE REPORT SHOWS ─────────────────────────────────────
 *   ourMarker: true · sdkLoginMarker: false · storedConnectors: [] ·
 *   connectionStatus: 'disconnected' · wcSessionKeys: 0
 *
 * `ourMarker` is claimed when an attempt STARTS (email OTP is redirect-shaped,
 * so the claim must outlive the document). It is released by `rollback()` when
 * AppKit says nothing is connected — but the marker survives any path that
 * never reaches rollback: a WebView that kills the document mid-OTP, a
 * `restore()` whose 30s window expires while the frame is suspended, a login
 * that produced an address but no usable provider (the EMAIL_PROVIDER_PENDING
 * state). The SDK's own marker is gone by then, because
 * `W3mFrameProvider.isConnected()` DELETES it (`deleteAuthLoginCache()`) the
 * moment the frame reports «not connected» or throws.
 *
 * The old code could not tell that state from a session the user is owed, so:
 *   • every cold start spent the full 30s restore window waiting for a frame
 *     that had already said «no», and
 *   • while that window (or the marker) stood, WalletConnect's restore was
 *     gated OFF («a marker means a frame session may be live»), so a returning
 *     user got neither wallet.
 *
 * The distinction, and it is the whole point: our marker claims an ATTEMPT, the
 * SDK's marker is the only evidence a frame session still HOLDS one. When the
 * SDK's is gone and nothing is connected — no address on the instance, no AUTH
 * connection in the shared map — the standing claim is stale, and forgetting it
 * is the honest move (and the only way the next tap gets the clean-slate path
 * it needs: purge + shared reset + a fresh boot).
 *
 * @returns {Promise<'none'|'owed'|'stale'>}
 */
export async function classifyEmailMarker({ modal = instance, storage } = {}) {
  const target = store(storage);
  if (!hasMarker(target)) return 'none';
  try {
    if (modal?.getIsConnectedState?.() === true) return 'owed';
  } catch { /* an instance that cannot answer does not vote */ }
  if (sdkLoginMarkerPresent(target)) return 'owed';
  /*
   * THE GHOST IN THE SHARED MAP (the «email box opens and does nothing» half
   * of the 2026-09-18 reports).
   *
   * `hasAnyConnection('AUTH')` is what renders the email input DISABLED, and
   * it checks the connector ID and nothing else. A live AUTH connection can
   * never exist without accounts (the adapter writes them with the
   * connection), so an entry with no accounts is residue — an attempt whose
   * teardown lost its race. Counting that as «a session is owed» left the
   * marker standing, the clean-slate path skipped, and the ghost in the map:
   * the user tapped email, the box opened, the input was disabled, and the
   * trace stayed empty because nothing was ever submitted.
   *
   * So the ghost does not vote. Only a connection that carries an account is
   * a session worth protecting — and when the facts cannot be read at all
   * (the controllers chunk unreachable), the answer stays the conservative
   * one: an unreadable map is not evidence of residue.
   */
  const shared = await readSharedConnectionFacts();
  if (!shared.available) return 'owed';
  if (shared.authAccounts > 0) return 'owed';
  return 'stale';
}

/**
 * Forget a stale claim completely, in the order that matters.
 *
 * Storage first (the keys the NEXT boot reads), then the in-memory shared
 * controllers (invisible to any purge — a leftover `activeCaipAddress` is what
 * made an email login open on a phantom account), then the instance itself, and
 * finally the frame's chain residue. The marker LAST is deliberate: everything
 * above is what "forgetting" means, and a crash in the middle leaves a marker
 * that still describes the mess — which is exactly what makes it re-cleaned on
 * the next boot.
 *
 * @returns {Promise<{purged:number, sharedReset:boolean, chainResidue:number}>}
 */
export async function clearStaleEmailState({ modal = instance } = {}) {
  let purged = 0;
  try {
    purged = purgeConnectionKeys();
  } catch { /* storage unavailable — the in-memory half below still runs */ }
  let sharedReset = false;
  try {
    sharedReset = Boolean(await resetSharedConnectionState());
  } catch { /* same */ }
  if (modal) await retireInstance(modal);
  if (modal && instance === modal) instance = null;
  const residue = clearFrameChainResidue();
  setMarker(false);
  return { purged, sharedReset, chainResidue: residue.removed.length };
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
 *   3. the in-memory ConnectionController map — invisible to any purge; an AUTH
 *      entry WITHOUT accounts renders the email input disabled (it is what
 *      `hasAnyConnection('AUTH')` reads) and is removed outright by
 *      `clearPhantomAuthConnection()` before anything renders; an entry that
 *      carries accounts is a real one and is answered by retiring the
 *      instance.
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

  /*
   * THE NETWORK, BEFORE THE PROVIDER EXISTS.
   *
   * `createAppKit()` builds the auth provider during `initialize()` and the
   * provider captures `chainId: this.getCaipNetwork(namespace)?.caipNetworkId`
   * AT CONSTRUCTION — the iframe URL is built from it. So this has to run
   * before the instance is created (and again before every open, because a
   * WalletConnect init landing in between can still adopt a chain of its own).
   * See appkit.js#assertEmailNetwork for what is pruned and why a live address
   * makes it refuse.
   */
  const networkFix = await assertEmailNetwork({
    networks: buildNetworks(),
    supportedChainIds: EMAIL_FRAME_CHAIN_IDS,
    defaultChainId: DEFAULT_CHAIN
  });
  if (networkFix === 'fixed') wcEvent('email_network_fixed');
  else if (networkFix === 'blocked') wcEvent('email_network_blocked');
  else if (networkFix === 'unavailable') wcEvent('email_network_unavailable');

  /*
   * THE GHOST IN THE SHARED MAP — on EVERY path, before anything opens.
   *
   * `w3m-email-login-widget` renders the email input's `disabled` attribute
   * from `ConnectionController.hasAnyConnection('AUTH')`, which checks the
   * connector ID and nothing else. An AUTH entry whose account list is empty
   * is residue from an attempt that lost its teardown — and while it sits
   * there the box opens with the input disabled and the tap does NOTHING AT
   * ALL (no request, no error, an empty trace: exactly the shape of the
   * 2026-09-18 device report). It is not reachable by any storage purge, so
   * it is removed through the official setter before the surface renders —
   * and it is removed on the marker-owed path too, where the storage policy
   * deliberately leaves everything alone: a ghost is not a session.
   */
  const phantoms = await clearPhantomAuthConnection();
  if (phantoms > 0) wcEvent('email_phantom_auth_cleared', phantoms);

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
      /* Same map `hasAnyConnection('AUTH')` reads — the ghosts are already
         gone by now (cleared above), so what remains here is a real entry. */
      || shared.authConnection;
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
/**
 * The last message the frame answered `eth_accounts` with — the one fact a
 * failed wait has and the trace did not.
 *
 * «Email login finished but the wallet never became ready» is a sentence with
 * no cause in it, and the reports that carried it had `email_wait_timeout` and
 * nothing else. The probe below already asks the frame the SAFEST possible
 * question (`eth_accounts` is on the frame's SAFE_RPC_METHODS list, so asking
 * it can never trigger the «Action not allowed» path or abort a pending RPC) —
 * whatever it answers with is exactly the diagnosis, so it is kept for the
 * trace instead of being thrown away by a boolean.
 */
let lastProbeError = null;

/** @returns {string|null} sanitized already (see wcEventDetail's 'm' contract). */
export function lastProviderProbeError() {
  return lastProbeError;
}

async function isProviderUsable(provider) {
  if (!provider?.request) return false;
  try {
    const accs = await provider.request({ method: 'eth_accounts' });
    // empty array is still usable — it means connected but no account yet, but
    // for email it should have one. We treat any non-throwing answer as usable.
    lastProbeError = null;
    return true;
  } catch (e) {
    const m = String(e?.message || '');
    lastProbeError = m.slice(0, 120) || null;
    if (/not allowed|not valid|action/i.test(m)) {
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
export async function openSurfaceDetail(modal, openState = 'pending') {
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
    prov: providerReady,
    /* Did `modal.open()` itself ever settle? 'pending' here — with a modal that
       never opened — is the difference between «AppKit is slow» and «the tap
       never reached AppKit», which no other fact in the report separates. */
    op: openState
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
  /*
   * ─── A STALE CLAIM IS NOT A LOGIN (device report, 2026-09-18) ────────────
   * `fresh` used to be `!hasMarker()` — so a marker left behind by an attempt
   * nobody can honour (ourMarker true, the SDK's marker gone, nothing
   * connected — see `classifyEmailMarker`) disabled the very clean slate the
   * next attempt needs: no purge, no shared reset, no chain-residue cleanup,
   * and the frame's last-used custom chain still in storage. The state
   * self-corrected only if the user let a 30s restore window expire first.
   * Now the marker is CLASSIFIED before it is trusted, and a stale one is
   * cleared (storage + shared controllers + instance + chain residue) so this
   * tap really does start from nothing.
   */
  const markerState = await classifyEmailMarker();
  if (markerState === 'stale') {
    const cleared = await clearStaleEmailState();
    wcEvent('email_marker_stale', cleared.purged);
  }
  const fresh = !hasMarker() || markerState === 'stale';

  /* On EVERY path — not just fresh: the frame reads its last-used chain back
     for `eth_chainId` and for `connect()`'s default, and a residue pointing at
     a chain the frame cannot serve is what asks it for «action not valid». */
  const residue = clearFrameChainResidue();
  if (residue.removed.length > 0) {
    wcEventDetail('email_chain_residue', { n: residue.removed.length, kept: residue.kept });
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
  /* The same late-landing race the routing flags have: a WalletConnect init
     that outlived its bound can adopt one of ITS chains between `getAppKit`
     and here — and the frame stamps every RPC with the active one. */
  const lateNetworkFix = await assertEmailNetwork({
    networks: buildNetworks(),
    supportedChainIds: EMAIL_FRAME_CHAIN_IDS,
    defaultChainId: DEFAULT_CHAIN
  });
  if (lateNetworkFix === 'fixed') wcEvent('email_network_fixed');
  else if (lateNetworkFix === 'blocked') wcEvent('email_network_blocked');
  await assertEmailRouting();
  let openError = null;
  /* The open is wrapped so a SYNCHRONOUS throw from `modal.open()` reaches the
     trace too: `Promise.resolve(modal.open(...))` evaluates the call first, so
     a throw used to escape `open()` entirely and be reported by the caller as
     a bare `email_connect_exception` with no message. */
  let openState = 'pending';
  const opening = (async () => {
    try {
      await modal.open({ view: 'Connect' });
      openState = 'settled';
    } catch (error) {
      openError = error;
      openState = 'failed';
    }
  })();
  await Promise.race([opening, sleep(TIMEOUT.emailModalOpen)]);
  /* THE SURFACE SNAPSHOT — taken whether open() resolved, threw or outran the
     bound, because «what was on the screen» is the one fact every previous
     report had to guess at. The second sample one second later catches the
     SDK's own late routing (a reconnect handler flipping the view to Account
     after the Connect view was already set). */
  wcEventDetail('email_open_surface', await openSurfaceDetail(modal, openState));
  setTimeout(() => {
    Promise.resolve(openSurfaceDetail(modal, openState)).then(
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
       address» (the frame answered, the account did not arrive). And the third
       fact both were missing: WHAT the frame answered the last time it was
       asked anything (see `lastProviderProbeError`) — «Action not allowed»,
       «Please try again after N seconds», an iframe timeout, or nothing. */
    const probe = lastProviderProbeError();
    wcEventDetail(
      modal?.getIsConnectedState?.() ? 'email_wait_no_address' : 'email_wait_timeout',
      probe ? { m: probe } : { prov: false }
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
          // The fallback attach in WalletContext will still show connected.
          // WHY it is not usable rides along: this is the exact state that
          // reaches the user as «EMAIL_PROVIDER_PENDING», so the next report
          // must carry the frame's own answer, not just the fact of a stall.
          const probe = lastProviderProbeError();
          wcEventDetail('email_provider_not_usable_yet', probe ? { m: probe } : { prov: false });
        }
      }
    } catch {}
  }

  if (!account.provider) {
    // Still no provider — keep marker, but report pending so next cold start retries
    const probe = lastProviderProbeError();
    wcEventDetail('email_connected_no_provider', probe ? { m: probe } : { prov: false });
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
  /*
   * ─── THE 30 SECONDS A STALE MARKER COST EVERY COLD START ────────────────
   * A marker nobody can honour used to be indistinguishable from a session the
   * user is owed, so a returning user spent the whole restore window waiting
   * for a frame that had already answered «not connected» — with the app
   * showing «no wallet» and, because WalletContext gates the WalletConnect
   * restore on this marker, the stored WalletConnect session never resumed
   * either. `classifyEmailMarker` separates the two claims; a stale one is
   * FORGOTTEN here (and the caller's marker check then lets WalletConnect
   * restore on the same boot), instead of being waited on.
   */
  const markerState = await classifyEmailMarker();
  if (markerState === 'stale') {
    const cleared = await clearStaleEmailState();
    wcEvent('email_restore_stale_cleared', cleared.purged);
    return { ok: false, code: 'STALE_CLEARED' };
  }
  /* Even a genuine restore must not ask for a chain the frame cannot serve. */
  const residue = clearFrameChainResidue();
  if (residue.removed.length > 0) {
    wcEventDetail('email_chain_residue', { n: residue.removed.length, kept: residue.kept });
  }
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
 * Move the embedded wallet to another chain — THE WAY THE FRAME ALLOWS.
 *
 * ─── WHY NOT `wallet_switchEthereumChain` ───────────────────────────────────
 * A raw EIP-1193 switch is the one request the secure frame is guaranteed to
 * refuse. `checkIfRequestExists()` accepts only the methods on the frame's
 * SAFE/NOT_SAFE lists, and `wallet_switchEthereumChain` is on NEITHER — so
 * AppKit answers by OPENING THE MODAL, showing «Action not allowed» and calling
 * `provider.rejectRpcRequests()`, which aborts every pending RPC (including a
 * login that is mid-flight). It is the exact error string the reports carry,
 * and the generic EIP-1193 path in WalletContext would produce it every time a
 * page asked the email wallet to move.
 *
 * AppKit's own `switchNetwork()` goes through the adapter → the auth connector
 * → `W3mFrameProvider.switchNetwork()` → APP_SWITCH_NETWORK, which the frame
 * implements. Chains outside the frame's list are refused HERE, before any
 * request is sent: the email wallet is the signer, not the route, and a
 * refused move must never poison the session (see the module header).
 *
 * @returns {Promise<'ok'|'unsupported_chain'|'no_instance'|'not_in_list'|'failed'>}
 */
export async function switchEmbeddedNetwork(chainId) {
  /* The chain verdict is a POLICY check, so it comes first: it must not depend
     on whether an instance happens to exist (a refusal has to be the same
     answer before and after the boot), and a chain outside the frame's list
     must never reach the frame at all. */
  const target = Number(chainId);
  if (!EVM_CHAINS[target]) return 'unsupported_chain';
  if (!isEmailFrameChain(target)) {
    wcEvent('email_switch_unsupported');
    return 'unsupported_chain';
  }
  const modal = instance;
  if (!modal) return 'no_instance';
  let network = null;
  try {
    const list = modal.getCaipNetworks?.('eip155') ?? [];
    network = list.find((entry) => Number(entry?.id) === target) ?? null;
  } catch { /* an instance that cannot list networks cannot switch either */ }
  if (!network) return 'not_in_list';
  try {
    await modal.switchNetwork(network);
    wcEvent('email_switch_network');
    return 'ok';
  } catch {
    wcEvent('email_switch_network_failed');
    return 'failed';
  }
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
