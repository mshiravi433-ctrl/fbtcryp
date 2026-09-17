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
import { TIMEOUT, WC_PROJECT_ID, wcMetadata } from './config.js';
import { sleep } from './timing.js';
import { wcEvent } from './trace.js';

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
 */
export async function getAppKit({ projectId = WC_PROJECT_ID, metadata = wcMetadata() } = {}) {
  const rearm = rearmSdkLoginMarker();
  if (rearm === 'rearmed' && instance) {
    try { await instance.disconnect?.(); } catch { /* best effort */ }
    try { instance.close?.(); } catch { /* best effort */ }
    /* disconnect()'s deleteAuthLoginCache removes the key we just restored. */
    try {
      const target = store();
      if (target && target.getItem(SDK_LOGIN_KEY) !== SDK_LOGIN_VALUE) {
        target.setItem(SDK_LOGIN_KEY, SDK_LOGIN_VALUE);
      }
    } catch { /* storage unavailable */ }
    instance = null;
  }
  if (!instance) {
    const [{ createAppKit }, { EthersAdapter }] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-ethers')
    ]);
    instance = createAppKit({ ...emailOptions({ projectId, metadata }), adapters: [new EthersAdapter()] });
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
 * ─── WHY IT POLLS INSTEAD OF ONLY SUBSCRIBING ──────────────────────────────
 * On a slow mobile WebView the three facts arrive in any order and up to a
 * second apart: `isConnected` flips, `getAddress()` answers, and
 * `getWalletProvider()` is still null. A flow that treats the first two as
 * finished then tries to attach once reports "no provider" and leaves the
 * marker orphaned — exactly the «email confirmed, we came back, no wallet»
 * report. Polling for all three together is the honest test, and it makes the
 * caller's attach a one-liner that cannot hit that window.
 *
 * @returns {Promise<{address:string, provider:object}|null>} null on timeout,
 *   on a definite close, or when the user dismissed the modal.
 */
export async function awaitAccount(modal, {
  timeoutMs = TIMEOUT.emailOpen,
  closeGraceMs = TIMEOUT.emailCloseGrace,
  pollMs = 300
} = {}) {
  if (!modal) return null;
  const read = () => {
    try {
      if (!modal.getIsConnectedState?.()) return null;
      const address = modal.getAddress?.('eip155');
      const provider = modal.getWalletProvider?.();
      if (!address || !provider) return null;
      return { address, provider };
    } catch {
      return null;
    }
  };

  const ready = read();
  if (ready) return ready;

  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    let closeTimer = null;
    const subscriptions = [];

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(outer);
      clearInterval(poll);
      clearTimeout(closeTimer);
      for (const off of subscriptions) {
        try { off?.(); } catch { /* cleanup */ }
      }
      resolve(value);
    };
    const check = () => {
      const hit = read();
      if (hit) finish(hit);
    };

    const outer = setTimeout(() => finish(null), timeoutMs);
    const poll = setInterval(check, pollMs);

    const subscribe = (off) => {
      if (settled) off?.();
      else subscriptions.push(off);
    };

    try {
      subscribe(modal.subscribeAccount?.(() => check(), 'eip155'));
      subscribe(
        modal.subscribeState?.((state) => {
          if (settled) return;
          if (state?.open) {
            opened = true;
            return;
          }
          /* The modal CLOSED: either the user dismissed it (definitive) or the
             login completed and the frame's answer is still in flight. Wait out
             the grace, then stop. */
          if (state?.open === false && opened) {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => finish(read()), closeGraceMs);
          }
        })
      );
    } catch {
      /* a modal that cannot subscribe can still be polled */
    }
  });
}

/**
 * Open the login modal and wait for the wallet.
 *
 * The marker is claimed BEFORE the modal opens, because on mobile the flow can
 * be cut off by the redirect before anything happens in this document.
 */
export async function open({ projectId, metadata } = {}) {
  const modal = await getAppKit({ projectId, metadata });
  setMarker(true);
  reassertFeatures(modal);
  try {
    await modal.open({ view: 'Connect' });
  } catch {
    wcEvent('email_open_failed');
    await rollback(modal);
    return { ok: false, code: 'CONNECT_FAILED' };
  }
  const account = await awaitAccount(modal, { timeoutMs: TIMEOUT.emailOpen });
  if (!account) {
    await rollback(modal);
    return { ok: false, code: 'CONNECT_FAILED' };
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
    /* A TIMEOUT IS NOT AN ANSWER. Treating one as "definitively gone" used to
       delete the marker, which turned a slow boot into a PERMANENT loss: every
       later cold start saw no marker and never consulted the still-valid
       session again. Hand it back only when AppKit itself says nothing is
       connected, and keep it when it cannot answer. */
    const cleared = await rollback(modal);
    wcEvent(cleared ? 'email_restore_none' : 'email_restore_pending');
    return { ok: false, code: cleared ? 'NO_SESSION' : 'PENDING' };
  }
  wcEvent('email_session_restored');
  return { ok: true, ...account, restored: true };
}

/**
 * Give the boot marker back when an attempt ended with nothing to restore.
 *
 * HONEST, NOT BLIND — and that distinction is the point. AppKit's own answer
 * decides: if the instance still reports a connected account the session is
 * real even though THIS attempt failed (a chunk that refused to load, a
 * transient RPC timeout — cases where the next cold start is exactly the
 * recovery the marker exists for), so the marker stays.
 *
 * @returns {Promise<boolean>} whether it cleared the marker.
 */
export async function rollback(modal) {
  let connected = false;
  try {
    connected = Boolean(modal?.getIsConnectedState?.() && modal?.getAddress?.('eip155'));
  } catch {
    connected = false; /* an SDK that cannot answer is not an answer */
  }
  if (connected) return false;
  setMarker(false);
  return true;
}

/**
 * Forget the session: clear our marker, and if an instance exists in this page
 * lifetime ask it to disconnect too (bounded — a hung auth frame must never
 * stall a mode switch).
 */
export async function forget({ timeoutMs = TIMEOUT.teardown } = {}) {
  setMarker(false);
  const modal = instance;
  if (!modal || typeof modal.disconnect !== 'function') return true;
  try {
    await Promise.race([
      Promise.resolve(modal.disconnect()).catch(() => {}),
      sleep(timeoutMs)
    ]);
  } catch {
    /* logout is best-effort; the marker above is the state we own */
  }
  return true;
}
