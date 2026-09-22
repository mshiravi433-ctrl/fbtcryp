/**
 * THE WALLETCONNECT SESSION
 * ---------------------------------------------------------------------------
 * One object owns the whole WalletConnect v2 lifecycle: init, pair, restore,
 * cancel, disconnect. It is framework-free — no React, no DOM state — so the
 * flow can be read top to bottom and tested without mounting anything.
 *
 * ─── WHAT IT PROMISES ──────────────────────────────────────────────────────
 *   • ONE ATTEMPT AT A TIME. `EthereumProvider.init()` creates a new session
 *     every time it runs; two concurrent inits are two modals and two pairing
 *     URIs, and the user taps the dead one.
 *   • EVERY WAIT IS BOUNDED. Nothing here can spin. The SDK's own socket keeps
 *     retrying on its schedule and is simply abandoned — but the user gets
 *     their screen back with a named reason.
 *   • NO ZOMBIES. Whatever path an attempt leaves by — success, cancel,
 *     timeout, throw — the provider's listeners come off, the pairing URI is
 *     cleared and AppKit's pairing state is reset. A URI left in state after an
 *     attempt settles is how a wallet gets opened on a pairing that is gone.
 *   • THE URI COMES FROM THE SDK. `display_uri` is the one event WalletConnect
 *     guarantees, and it carries the pairing URI as a plain string. The UI
 *     renders a QR of exactly those bytes; it never reconstructs them.
 *
 * Consumers subscribe (`on`) rather than poll. Nothing here throws into React.
 */

import { PAIRING_TTL_MS, RELAY_URLS, TIMEOUT, WC_PROJECT_ID, wcMetadata } from './config.js';
import { chainFromSession } from './chain.js';
import { applyWalletSurface, resetPairingState, setLivePairingUri } from './appkit.js';
import { installWalletOpenBridge, onWalletHandoff, openWalletHandoff } from './handoff.js';
import { measureRelay, clearRelayCache } from './relay.js';
import { installVerifyBudgetExtension, measureVerifyEnclave, warmVerifyEnclave } from './verify.js';
import { hasStoredSession, purgeConnectionKeys } from './storage.js';
import {
  classifyConnectError,
  isModalError,
  isRelayError,
  pauseBound,
  withTimeout
} from './timing.js';
import { wcEvent } from './trace.js';
import { looksLikePairingUri, repairPairingUri } from './uri.js';
import { legacyModalWallets } from './wallets.js';

/** The trace name for each hand-off route — the hop a pairing left from. */
const HANDOFF_EVENT = Object.freeze({
  'java-bridge': 'handoff_java_bridge',
  intent: 'handoff_intent',
  native: 'handoff_native',
  universal: 'handoff_universal'
});

/**
 * Stop the connect clock while this document is not on screen.
 *
 * A phone switches apps to show the wallet: the tab goes hidden, and while it
 * is hidden the user is not waiting for us — we are waiting for them. The old
 * flat timer burned its whole budget in that window and tore the provider down
 * from under an approval that was one tap away.
 *
 * @returns {() => void} the unsubscribe.
 */
export async function wakeWcTransport(instance) {
  /*
   * Android freezes the WebView while a wallet is in front. The wallet can
   * publish its approval during that freeze, after Chromium has suspended the
   * relay socket. Merely resuming the timeout does not resubscribe SignClient,
   * so the approval remains in relay history and `provider.connect()` waits
   * forever.
   *
   * Every supported WalletConnect v2 provider reaches the same Core Relayer,
   * although SDK patch releases expose it through slightly different object
   * paths. `transportOpen()` is idempotent in Core: when already connected it
   * is a no-op; after Android suspended it, it opens and restores subscriptions
   * so the queued proposal response is delivered to the ORIGINAL connect
   * promise. We deliberately never call connect() again — that would create a
   * second proposal and a second approval screen.
   */
  const candidates = [
    instance?.signer?.client?.core?.relayer,
    instance?.signer?.core?.relayer,
    instance?.client?.core?.relayer,
    instance?.core?.relayer
  ].filter(Boolean);
  const relayer = candidates.find((item, index) => candidates.indexOf(item) === index);
  if (!relayer || typeof relayer.transportOpen !== 'function') return false;
  try {
    await withTimeout(
      Promise.resolve(relayer.transportOpen()),
      TIMEOUT.initLast,
      'WC_FOREGROUND_RELAY_TIMEOUT'
    );
    wcEvent('pairing_relay_woke');
    return true;
  } catch {
    /* The SDK may report "already open" during a focus/visibility double-fire.
       The live connect promise remains authoritative, so never tear it down. */
    wcEvent('pairing_relay_wake_failed');
    return false;
  }
}

function pauseOnHidden(bound, view, onForeground) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  const doc = win?.document;
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  let lastWake = 0;
  const wake = () => {
    const now = Date.now();
    /* Android commonly emits onResume, visibilitychange and focus together. */
    if (now - lastWake < 500) return;
    lastWake = now;
    try { void onForeground?.(); } catch { /* advisory recovery only */ }
  };
  const onVisibility = () => {
    try {
      if (doc.visibilityState === 'hidden') {
        if (bound.pause()) wcEvent('connect_paused');
      } else {
        if (bound.resume()) wcEvent('connect_resumed');
        wake();
      }
    } catch {
      /* a clock that cannot be paused is still a clock */
    }
  };
  const onFocus = () => {
    if (doc.visibilityState !== 'hidden') wake();
  };
  const onNativeResume = () => {
    /* Do not consult visibilityState here: this event exists precisely because
       some System WebViews leave that value stale after Activity.onResume(). */
    try { if (bound.resume()) wcEvent('connect_resumed'); } catch { /* noop */ }
    wake();
  };
  if (doc.visibilityState === 'hidden') onVisibility();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener?.('focus', onFocus);
  /* MainActivity emits this from the real Android lifecycle. WebView versions
     do not all update document.visibilityState when an external Activity
     covers them, so this signal is required rather than merely defensive. */
  win.addEventListener?.('fbt:app-resume', onNativeResume);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener?.('focus', onFocus);
    win.removeEventListener?.('fbt:app-resume', onNativeResume);
  };
}

/**
 * @param {object} options
 * @param {string} [options.projectId]
 * @param {object} [options.metadata]
 * @param {number[]} options.chains        required chains (the default network)
 * @param {number[]} options.optionalChains every other supported chain
 * @param {(chainId:number)=>boolean} [options.supportsChain]
 */
export function createWcSession({
  projectId = WC_PROJECT_ID,
  metadata = wcMetadata(),
  chains = [],
  optionalChains = [],
  methods = ['eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
  supportsChain = () => true,
  defaultChain = chains[0]
} = {}) {
  const listeners = new Map();

  /** The live EthereumProvider, or null. */
  let provider = null;
  /** Single-flight: an init and a tap can never race into two SignClients. */
  let busy = false;
  /** Tear-down for the provider's listeners, so a stale instance cannot wipe live state. */
  let detach = null;
  /** The window.open bridge, installed for one pairing attempt only. */
  let uninstallBridge = null;
  /** Settle-switch for the in-flight connect, so Cancel has immediate effect. */
  let settleConnect = null;
  /** Tear-down for the connect clock's listeners, for ANY exit path. */
  let stopConnectWatchers = null;

  function on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }

  function emit(type, payload) {
    for (const fn of listeners.get(type) ?? []) {
      try {
        fn(payload);
      } catch {
        /* one bad subscriber must not stop the flow */
      }
    }
  }

  /** The init config, identical for connect AND restore: a session restored
   *  with different metadata than it was created with is exactly the identity
   *  drift wallets re-verify against. */
  function initConfig(withModal) {
    return {
      projectId,
      chains,
      optionalChains,
      showQrModal: withModal,
      optionalMethods: methods,
      qrModalOptions: {
        themeMode: 'dark',
        enableExplorer: true,
        explorerExcludedWalletIds: 'ALL',
        /* 'NONE' on purpose: this is one of the few qrModalOptions that
           convertWCMToAppKitOptions() forwards (as `featuredWalletIds`). Leaving
           the five explorer ids here meant the promoted wallets were rendered
           from the explorer API — so on a network that filters
           api.web3modal.org they vanished, and our local copy was filtered out
           as a duplicate. Clearing it makes wallets.js the single source,
           reachable or not. */
        explorerRecommendedWalletIds: 'NONE',
        mobileWallets: legacyModalWallets()
      },
      metadata
    };
  }

  /**
   * Bounded init with relay failover.
   *
   * Walk the measured host order: a short fuse on every entry but the last, the
   * full budget on the last. On a network that filters one hostname the entry
   * that answers wins; a network that blocks both fails within seconds instead
   * of inside the SDK's own five-attempt backoff.
   */
  async function initProvider({ modal, relayOrder }) {
    const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
    const urls = Array.isArray(relayOrder) && relayOrder.length ? relayOrder : RELAY_URLS;
    let lastError = null;
    for (let i = 0; i < urls.length; i += 1) {
      const isLast = i === urls.length - 1;
      const budget = isLast ? TIMEOUT.initLast : TIMEOUT.initFirst;
      wcEvent(i ? 'relay_fallback_try' : 'relay_try', i);
      let orphaned = true;
      try {
        const pending = Promise.resolve(
          EthereumProvider.init({ ...initConfig(modal), relayUrl: urls[i] })
        );
        /* Our bound fired but the SDK is still working: the instance that
           eventually resolves is abandoned, so close it. */
        pending.then((ghost) => {
          if (orphaned) ghost?.disconnect?.().catch?.(() => {});
        }, () => {});
        // eslint-disable-next-line no-await-in-loop -- sequential failover is the point
        const instance = await withTimeout(pending, budget, 'WC_INIT_TIMEOUT');
        orphaned = false;
        wcEvent(i ? 'provider_ready_fallback' : 'provider_ready', i);
        return instance;
      } catch (error) {
        lastError = error;
        wcEvent(i ? 'relay_fallback_failed' : 'relay_failed', i);
        if (!isLast && isRelayError(error)) continue;
        throw error;
      }
    }
    throw lastError ?? new Error('WC_INIT_FAILED');
  }

  /**
   * Point the live sign client back at the public origin.
   *
   * The SDK runs our metadata through `populateAppMetadata()`, which OVERWRITES
   * `metadata.url` with `window.location.origin` whenever the two hosts differ.
   * Inside the APK that origin is `https://localhost`; a wallet — a separate
   * app — cannot fetch it, so MetaMask rejects with "Invalid URL" and Trust
   * fails the pairing and shows its red "domain flagged unsafe" screen.
   *
   * The object the engine serialises the proposal from is
   * `wc.signer.client.metadata` (UniversalProvider.createClient does
   * `this.client = SignClient.init(…)`); the extra branches are defensive, so an
   * SDK upgrade that moves the metadata cannot silently resurrect a dApp that
   * introduces itself to every wallet as https://localhost.
   */
  /**
   * Give the attestation a second, longer chance — evidence-gated.
   *
   * The SDK's register() has a flat 5s budget and fails silently past it;
   * on a slow-but-working network that IS the «Cannot verify» story. The
   * wrap installs once per WC core (the brand makes re-entry a no-op), and
   * installs NOTHING where verify is not exposed.
   */
  function extendVerifyBudget(instance) {
    const core = [
      instance?.signer?.client?.core,
      instance?.signer?.core,
      instance?.client?.core,
      instance?.core
    ].filter(Boolean).find((item, index, list) => list.indexOf(item) === index);
    const result = installVerifyBudgetExtension({
      core,
      win: typeof window !== 'undefined' ? window : null,
      projectId,
      onEvent: (name, extra) => wcEvent(name, extra?.ms ?? 1)
    });
    if (result.installed) wcEvent('verify_budget_extension_installed', result.extraBudgetMs);
    return Boolean(result.installed);
  }

  function repairMetadata(instance) {
    const { url, icons, verifyUrl } = metadata;
    try {
      const signClient = instance?.signer?.client ?? instance?.signer;
      const targets = [signClient?.metadata, instance?.signer?.metadata, instance?.rpc?.metadata].filter(
        Boolean
      );
      for (const target of targets) {
        target.url = url;
        target.icons = [...icons];
        /* The verify URL must travel WITH the metadata: a page running on
           https://www.fbtswap.ir sends `verifyUrl = https://fbtswap.ir`, and a
           wallet reading the cached metadata after our repair sees the bare
           origin the dashboard registered. Without this line the SDK leaves
           the cached value behind and the prompt the wallet renders names a
           host the dashboard does not know about. */
        if (verifyUrl) target.verifyUrl = verifyUrl;
      }
      return Boolean(targets.length) && signClient?.metadata?.url === url;
    } catch {
      return false;
    }
  }

  /**
   * Attach listeners exactly once per instance, instance-scoped.
   *
   * Every handler checks `provider === instance` before touching anything, so a
   * STALE provider — one we replaced during a reconnect, or an init from a
   * previous restore racing a fresh connect — can never wipe the live
   * connection. The "Trust Wallet disconnects itself a few minutes later" class
   * of bug lives precisely in handlers that skip that check.
   *
   * accountsChanged is deliberately non-destructive here: some wallets emit an
   * empty array spuriously while they re-derive accounts (Trust does this
   * around chain moves). On WalletConnect, session_delete / session_expire are
   * the authoritative end of a session — not a transient [].
   */
  function attach(instance) {
    const isLive = () => provider === instance;
    const onDisconnect = () => {
      if (!isLive()) return;
      wcEvent('disconnect');
      emit('closed', { reason: 'disconnect' });
    };
    const onAccountsChanged = (accounts) => {
      if (!isLive() || !accounts?.[0]) return;
      emit('accounts', { address: accounts[0] });
    };
    const onChainChanged = (cid) => {
      if (!isLive()) return;
      const next = Number(String(cid).startsWith('eip155:') ? cid.slice(7) : cid);
      if (!Number.isInteger(next) || next <= 0) return;
      wcEvent('chain_changed', next);
      emit('chain', { chainId: next });
    };
    const onSessionDelete = () => {
      if (!isLive()) return;
      wcEvent('session_delete');
      emit('closed', { reason: 'session_delete' });
    };
    const onSessionExpire = () => {
      if (!isLive()) return;
      wcEvent('session_expire');
      emit('closed', { reason: 'session_expire' });
    };
    const onDisplayUri = (uri) => {
      const text = repairPairingUri(typeof uri === 'string' ? uri : uri?.uri);
      if (!looksLikePairingUri(text)) return;
      setLivePairingUri(text);
      wcEvent('display_uri');
      emit('uri', { uri: text });
    };

    instance.on?.('disconnect', onDisconnect);
    instance.on?.('accountsChanged', onAccountsChanged);
    instance.on?.('chainChanged', onChainChanged);
    instance.on?.('session_delete', onSessionDelete);
    instance.signer?.client?.on?.('session_expire', onSessionExpire);
    instance.signer?.client?.on?.('display_uri', onDisplayUri);

    return () => {
      try { instance.removeListener?.('disconnect', onDisconnect); } catch { /* noop */ }
      try { instance.removeListener?.('accountsChanged', onAccountsChanged); } catch { /* noop */ }
      try { instance.removeListener?.('chainChanged', onChainChanged); } catch { /* noop */ }
      try { instance.removeListener?.('session_delete', onSessionDelete); } catch { /* noop */ }
      try { instance.signer?.client?.off?.('session_expire', onSessionExpire); } catch { /* noop */ }
      try { instance.signer?.client?.off?.('display_uri', onDisplayUri); } catch { /* noop */ }
    };
  }

  /**
   * Tear down an instance without touching any subscriber's state.
   *
   * Any in-flight connect() is settled here too: an attempt is over the moment
   * its provider is torn down, and letting it wait out the full bound would
   * keep the UI's spinner (and the single-flight guard) held for up to 20
   * seconds after the user has already moved on.
   */
  async function release({ purge = false } = {}) {
    settleConnect?.();
    settleConnect = null;
    try { uninstallBridge?.(); } catch { /* noop */ }
    uninstallBridge = null;
    try { detach?.(); } catch { /* noop */ }
    detach = null;
    const dying = provider;
    provider = null;
    if (purge) purgeConnectionKeys();
    if (dying) {
      try {
        await withTimeout(Promise.resolve(dying.disconnect()).catch(() => {}), TIMEOUT.teardown, 'WC_TEARDOWN');
      } catch {
        /* a dead relay must never stall the next attempt */
      }
    }
  }

  /**
   * Start a new pairing.
   *
   * @returns {Promise<{ok:true, provider, address, chainId, session}
   *                 | {ok:false, code:string}>}
   */
  async function connect({ force = false } = {}) {
    if (busy) return { ok: false, code: 'WC_BUSY' };
    if (provider) return { ok: false, code: 'WC_BUSY' };
    busy = true;
    const startedAt = Date.now();
    let instance = null;

    try {
      /* AN EXPLICIT CONNECT IS A CLEAN SLATE. The SDK's storage writes are
         asynchronous, so relying on disconnect() to have finished clearing the
         persisted session, the deep-link choice and the recent-wallet keys is a
         race that periodically loses — and when it loses, init() resurrects the
         old session and AppKit refuses to open the modal. Purging
         synchronously, here, is what makes the next attempt exactly like the
         first. */
      const purged = purgeConnectionKeys();
      if (purged) wcEvent('storage_purged', purged);

      /* THE ATTESTATION HAS A FIVE-SECOND BUDGET, AND IT STARTS LATE.
         ─────────────────────────────────────────────────────────────────────
         When this connect proposes, the SDK appends a hidden iframe to
         `verify.walletconnect.org/v3/attestation` and waits five seconds for a
         signed JWT. If nothing arrives, `register()` returns an empty string,
         the wallet finds no attestation, and the user reads «Cannot verify» —
         with no hint that the network, not the domain, is what failed.

         On a filtered network the DNS + TLS handshake alone can eat most of
         that window. Warming the connection here — while we still have to
         measure the relay and init the provider — hands the enclave a
         connection that is already open by the time the SDK asks for it.
         Advisory: it can never fail the attempt. */
      try {
        const warmed = warmVerifyEnclave({ projectId });
        if (warmed?.warmed) wcEvent('verify_warmed', warmed.reason);
      } catch { /* a warm-up is an optimisation, never a gate */ }

      /* MEASURE THE ENCLAVE BEFORE THE PAIRING NEEDS IT. The extended-budget
         wrap installed below opens only for a network where the enclave page
         actually loads: this measurement (bounded, fire-and-forget) is the
         evidence that decides it. Measured here — seconds before register()
         runs — and also at boot in main.jsx, so most pairings read a ready
         answer and none pays twice. */
      try {
        measureVerifyEnclave({}).then(
          (state) => { if (state?.verdict) wcEvent(state.verdict === 'LOADED' ? 'verify_enclave_loaded' : 'verify_enclave_unloaded', state.ms ?? 0); },
          () => {}
        );
      } catch { /* advisory */ }

      /* ADVISORY: a browser diagnostic must never prevent the real attempt. */
      let relay = null;
      try {
        relay = await measureRelay({ projectId, force });
      } catch {
        relay = null;
      }
      if (relay) {
        emit('relay', relay);
        wcEvent(
          relay.verdict === 'OPEN'
            ? 'relay_preflight_open'
            : relay.verdict === 'WS_REFUSED'
              ? 'relay_preflight_ws_refused'
              : relay.verdict === 'UNREACHABLE'
                ? 'relay_preflight_unreachable'
                : relay.verdict === 'TIMEOUT'
                  ? 'relay_preflight_timeout'
                  : 'relay_preflight_unmeasured',
          relay.openUrls?.length ?? 0
        );
      }

      /* INIT WITH THE MODAL, AND HONESTLY WITHOUT IT IF THE CHUNK CANNOT LOAD.
         A surface failure must not cost the user the connection: the attempt is
         retried without the modal and our own pairing sheet takes over from
         `display_uri`. Anything else init throws is a relay/project failure and
         is rethrown untouched — retrying those with a different surface would
         only hide them. */
      try {
        instance = await initProvider({ modal: true, relayOrder: relay?.order });
        wcEvent('init');
      } catch (error) {
        if (!isModalError(error)) throw error;
        wcEvent('appkit_modal_unavailable');
        instance = await initProvider({ modal: false, relayOrder: relay?.order });
        wcEvent('init_without_modal');
      }

      provider = instance;
      emit('modal', { active: Boolean(instance?.modal) });
      wcEvent(repairMetadata(instance) ? 'metadata_repaired' : 'metadata_repair_failed');
      try { extendVerifyBudget(instance); } catch { /* the wrap is advisory */ }
      if (instance?.modal) {
        const applied = await applyWalletSurface({ modal: instance.modal, projectId, metadata });
        wcEvent(applied ? 'appkit_links_applied' : 'appkit_links_failed');
      }
      detach = attach(instance);

      /* THE CLOCK, ARMED BEFORE THE PAIRING CAN LEAVE THE PAGE.
         ───────────────────────────────────────────────────────────────────
         The flat 20s fuse this used to run is shorter than one mobile round
         trip: tap → app switch → unlock → read → approve → publish. On the
         2026-09-17 20:36Z report the wallet row was tapped 4.5s after init and
         the attempt was destroyed 20s later, while the user was standing in
         Trust Wallet reading the approval — and the failure was then reported
         as «the relay is unreachable». See timing.js#pauseBound. */
      const bound = pauseBound(TIMEOUT.connect, 'WC_CONNECT_TIMEOUT', {
        hardCapMs: TIMEOUT.connectHardCap
      });
      settleConnect = (code = 'WC_USER_CANCELLED') => bound.cancel(code);
      const stopVisibilityPause = pauseOnHidden(
        bound,
        typeof window !== 'undefined' ? window : null,
        () => wakeWcTransport(instance)
      );

      /* A HAND-OFF IS NOT A NETWORK WAIT. From the moment the pairing leaves
         for a wallet app the clock belongs to the user: they may still have to
         unlock, read and decide. Grant the in-wallet budget, and name the
         route, so the next report says which hop the pairing left from. */
      const stopHandoffWatch = onWalletHandoff(({ route }) => {
        wcEvent(HANDOFF_EVENT[route] ?? 'handoff_other', 1);
        if (bound.extend(TIMEOUT.connectInWallet)) wcEvent('connect_extended');
      });
      stopConnectWatchers = () => {
        bound.stop();
        stopVisibilityPause();
        stopHandoffWatch();
      };

      /* LAST METRE: own the URL the modal hands to the phone, so the hand-off
         never navigates this document (which would take the relay socket and
         the pending connect() promise with it).

         CRITICAL: the synchronous open happens first, inside the user's
         gesture — an async open is what a popup blocker refuses, and the old
         fallback to location.assign destroyed fbtswap.ir and sent the user to
         https://uniswap.org/app/wc?uri=… — the exact bug this replaced. */
      uninstallBridge = installWalletOpenBridge({
        openWallet: (url, opts) => {
          if (opts?.repaired) wcEvent('deeplink_uri_repaired');
          wcEvent(
            opts?._syncAlreadySucceeded
              ? opts?.rewritten
                ? 'deeplink_rewritten_sync'
                : 'deeplink_opened_sync'
              : opts?.rewritten
                ? 'deeplink_rewritten'
                : 'deeplink_opened'
          );
          if (opts?._syncAlreadySucceeded) return;
          /* The gesture is gone, but the https fallback is a destination
             rather than a launch, so it is still worth trying. */
          openWalletHandoff(url, opts).then(
            (result) => {
              if (!result.ok) wcEvent('deeplink_open_failed');
            },
            () => wcEvent('deeplink_open_failed')
          );
        }
      });

      /* init() also loads a persisted session when one is on disk. The purge
         should have removed it, but a concurrent tab can race one back in — and
         an explicit Connect means a NEW pairing, so a resurrected session must
         be dropped before it can make AppKit skip the modal. */
      if (instance.session) {
        await withTimeout(
          Promise.resolve(instance.disconnect()).catch(() => {}),
          TIMEOUT.teardown,
          'WC_PRESESSION_TEARDOWN'
        ).catch(() => {});
        wcEvent('stale_session_dropped');
      }

      try {
        await Promise.race([instance.connect(), bound.promise]);
      } finally {
        bound.stop();
        stopVisibilityPause();
        stopHandoffWatch();
        settleConnect = null;
        setLivePairingUri(null);
        emit('uri', { uri: null });
      }
      wcEvent('session_settled');

      const chainId = honestChain(instance);
      syncChain(instance, chainId);
      const address = instance.accounts?.[0] ?? null;
      wcEvent('connected');
      return { ok: true, provider: instance, address, chainId };
    } catch (error) {
      const code = classifyConnectError(error);
      const elapsed = Math.max(0, Math.round(Date.now() - startedAt));
      wcEvent(
        code === 'USER_REJECTED'
          ? 'connect_failed_cancel'
          : code === 'WC_ORIGIN_BLOCKED'
            ? 'connect_failed_origin'
            : code === 'WC_EXPIRED'
              ? 'connect_failed_expired'
              : code === 'WC_TIMEOUT'
                ? 'connect_failed_timeout'
                : code === 'WC_RELAY_UNREACHABLE'
                  ? 'connect_failed_relay'
                  : 'connect_failed_unknown',
        elapsed
      );
      /* Only a REAL relay failure invalidates the measurement. Our own bound
         says nothing about the network — the relay issued the URI the wallet
         was opened with — so forgetting the (open) measurement on a timeout
         would make the next attempt re-probe and report a network it already
         proved healthy. */
      if (code === 'WC_RELAY_UNREACHABLE') clearRelayCache();
      /* Never leave a half-connected instance behind: on OUR timeout the SDK's
         socket is still retrying in the background, and that zombie is what
         made a later Connect look broken for reasons nobody could see. */
      await release({ purge: false });
      await resetPairingState();
      return { ok: false, code };
    } finally {
      busy = false;
      settleConnect = null;
      try { stopConnectWatchers?.(); } catch { /* noop */ }
      stopConnectWatchers = null;
      try { uninstallBridge?.(); } catch { /* noop */ }
      uninstallBridge = null;
      setLivePairingUri(null);
      emit('uri', { uri: null });
      emit('modal', { active: false });
      void resetPairingState();
    }
  }

  /**
   * Re-attach a persisted session WITHOUT a new pairing.
   *
   * ─── THE BUG THIS FIXES ────────────────────────────────────────────────
   * init() only ever ran from the Connect button, so anything that restarted
   * the WebView — a refresh, Android resuming the app, a hard reload — left the
   * session in localStorage while the app showed "not connected". Returning to
   * the app looked EXACTLY like "Trust Wallet disconnected me by itself". The
   * disconnect was never sent by the wallet; the app never picked the session
   * back up.
   *
   * Opportunistic by design: it fails quiet, because the explicit Connect
   * button is the real path and a resume must never stall behind a relay probe.
   */
  async function restore() {
    if (busy || provider) return { ok: false, code: 'WC_BUSY' };
    if (!hasStoredSession()) return { ok: false, code: 'WC_NO_SESSION' };
    busy = true;
    let instance = null;
    try {
      /*
       * NO RELAY PROBE ON A SILENT RESTORE.
       *
       * A cold start's first job is the session, and `measureRelay()` is up to
       * eight seconds of socket handshakes before `init()` is even allowed to
       * start — a delay that lands squarely on the one thing the user is
       * watching («پس از رفرش کیف پول متصل دیسکانکت می‌شه» is a report about a
       * page that looked disconnected for the whole of it).
       *
       * The measurement is an ORDERING hint and nothing more: `initProvider()`
       * already walks every configured host with a short fuse on each and the
       * full budget on the last, so an unmeasured network costs a few extra
       * seconds on a host that would have failed anyway — and the health panel
       * still measures for real when the user opens it.
       */
      emit('relay', null);

      /* NO MODAL ON A SILENT RESTORE: this path runs on first paint for
         returning users, and building the AppKit instance there would be weight
         on a surface that is never opened. */
      instance = await initProvider({ modal: false, relayOrder: null });
      provider = instance;
      wcEvent(repairMetadata(instance) ? 'metadata_repaired' : 'metadata_repair_failed');
      try { extendVerifyBudget(instance); } catch { /* the wrap is advisory */ }

      if (!instance.session) {
        wcEvent('restore_none');
        await release({ purge: false });
        return { ok: false, code: 'WC_NO_SESSION' };
      }

      detach = attach(instance);
      const chainId = honestChain(instance);
      syncChain(instance, chainId);
      const address = instance.accounts?.[0] ?? null;
      wcEvent('session_restored');
      return { ok: true, provider: instance, address, chainId, restored: true };
    } catch (error) {
      /* A relay hiccup here must never surface as a connect error. But an
         abandoned instance must not linger: a provider never published, plus a
         zombie socket left alive underneath, is exactly the state that made a
         LATER explicit Connect look broken. */
      await release({ purge: false });
      wcEvent('restore_failed');
      return { ok: false, code: classifyConnectError(error) };
    } finally {
      busy = false;
    }
  }

  /**
   * Settle an in-flight pairing NOW.
   *
   * The SDK's `abortPairingAttempt()` is a deprecated no-op, so the switch is
   * ours: settling it releases the single-flight, and the very next tap can
   * start a fresh pairing instead of being silently swallowed for 20 seconds.
   * Safe to call when nothing is pairing.
   */
  async function cancel() {
    emit('uri', { uri: null });
    settleConnect?.();
    if (!provider && !busy) return false;
    wcEvent('pair_cancelled');
    await release({ purge: true });
    await resetPairingState();
    return true;
  }

  /** End the session and forget everything that described it. */
  async function disconnect() {
    await resetPairingState();
    await release({ purge: true });
    wcEvent('disconnected');
    return true;
  }

  /**
   * The chain the wallet actually approved — see chain.js for why the provider's
   * own answer cannot be trusted right after connect().
   */
  function honestChain(instance) {
    const fromSession = chainFromSession(instance);
    if (fromSession != null && supportsChain(fromSession)) return fromSession;
    return defaultChain ?? fromSession ?? null;
  }

  /**
   * Align the SDK's internal chain id with the honest one.
   *
   * `chainId` is what tags every RPC request with `eip155:<id>`; leaving it at
   * the required-chain default sends calls to a namespace the session does not
   * have, which the wallet rejects.
   */
  function syncChain(instance, chainId) {
    if (instance.chainId === chainId) return;
    try {
      instance.chainId = chainId;
      instance.persist?.();
      wcEvent('chain_synced', Number(chainId));
    } catch {
      /* the SDK shape changed — the caller's state is still honest */
    }
  }

  return {
    on,
    connect,
    restore,
    cancel,
    disconnect,
    get provider() {
      return provider;
    },
    get busy() {
      return busy;
    },
    get session() {
      return provider?.session ?? null;
    },
    hasStoredSession,
    pairingTtlMs: PAIRING_TTL_MS,
    /* Test/inspection hook. */
    _initConfig: initConfig
  };
}
