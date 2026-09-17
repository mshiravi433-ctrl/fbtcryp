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
  const account = await awaitAccount(modal, { timeoutMs: TIMEOUT.emailOpen, closeGraceMs: TIMEOUT.emailCloseGrace + 2000 });
  if (!account) {
    await rollback(modal);
    return { ok: false, code: 'CONNECT_FAILED' };
  }
  // If provider is still null but address exists, let caller retry attach — don't fail yet
  if (!account.provider && account.address) {
    // Wait a bit more for provider
    await sleep(800);
    try {
      const p = modal.getWalletProvider?.() || modal.getWalletProvider?.('eip155') || modal.getProvider?.('eip155') || null;
      if (p) account.provider = p;
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
