import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../lib/chains';
import { clearVault, loadVault, unlockVault } from '../lib/localWallet';
import { useSettingsStore } from '../store/useSettingsStore';
import { isNativeShell, publicAppUrl } from '../lib/nativeShell';
import { isIOS as isIOSDevice } from '../lib/platform';
import { holdRefreshGuard, onSoftRefresh } from '../lib/refresh';
import { wcEvent } from '../lib/wcTrace';
import {
  WC_CONNECT_TIMEOUT_MS,
  WC_PAIRING_TTL_MS,
  withTimeout,
  WC_PRIMARY_RELAY_TIMEOUT_MS,
  WC_RELAY_URLS,
  isRelayClassError
} from '../lib/wcTimeout';
/*
 * THE RELAY PREFLIGHT — the measurement that was missing.
 * `EthereumProvider.init()` does not open a relay socket (measured in
 * @walletconnect/core@2.25.0: `Relayer.init()` calls `transportOpen()`
 * UN-awaited, and `transportOpen()` returns immediately while the client has no
 * topics), so the old `relay_ok` trace event described a provider object, not
 * the relay — and the failover below only fired when init() REJECTED, which a
 * blocked relay never does. lib/wcRelayProbe.js measures the socket for real,
 * hands back the try order that measurement justifies, and reads the SDK's own
 * `relayer.connected` afterwards.
 */
import {
  RELAY_PREFLIGHT_TIMEOUT_MS,
  clearRelayStateCache,
  getRelayState,
  isRelayBlocked,
  readRelaySocket
} from '../lib/wcRelayProbe';
import { purgeWcStorage } from '../lib/wcStorage';
import { storageFacts } from '../lib/walletHealth.js';
import {
  appKitCustomWallets,
  legacyModalWallets,
  looksLikePairingUri,
  repairPairingUri
} from '../lib/wcWallets';
import { installWalletOpenBridge } from '../lib/wcDeepLink';
import { waitForEmailConnection } from '../lib/emailConnection.js';
import { installAppKitLinkModePatch, resetAppKitPairingState, setLivePairingUri } from '../lib/wcAppKitPatch';
import {
  EMAIL_RESTORE_WINDOW_MS,
  clearEmailSocialSession,
  getEmailSocialAppKit,
  hasEmailSocialMarker,
  rollbackEmailSocialMarker,
  setEmailSocialMarker
} from '../lib/emailSocialWallet';
import { openWalletLink } from '../lib/browser';
import { chainFromWcSession, parseChainId } from '../lib/wcChain';
import { setCentralWalletState, snapshotFromAppWallet } from '../lib/intent-ai/os/centralWalletState.js';
import { bindRewardsIdentity } from '../lib/rewards/rewardsReporter';

/*
 * WALLETCONNECT PROJECT ID — a constant in source, deliberately NOT an env var.
 *
 * This ID is public by design (it ships in every client bundle), so there is
 * nothing to hide. What burned us was the opposite: THREE build pipelines
 * (Vercel, the APK workflow, local dev) each read
 * VITE_WALLETCONNECT_PROJECT_ID from their own copy of the environment, and a
 * stale value in any one of them silently shipped an OLD project whose
 * dashboard allowlist still named the retired lawpoetics.ir domain. The relay
 * then refused or the wallet rejected the prompt, and nothing in the code
 * could explain why, because the code was correct — the environment wasn't.
 *
 * Same rule as publicAppUrl(): production identity lives in source, where a
 * change is reviewable and deploys atomically with the code that uses it.
 * Dashboard requirement for this project: register https://fbtswap.ir,
 * https://localhost and the Android app ID ir.fbtswap.app.
 */
const WC_PROJECT_ID = '5997d5aee8bb42f43ddec4b1a5f94eb1';

const WC_APP_NAME = 'FBT Swap';
const WC_APP_DESCRIPTION = 'Non-custodial decentralized exchange';

/**
 * The identity every wallet prompt shows. Built from `publicAppUrl()` — never
 * from `window.location.origin`, which is `https://localhost` inside the APK
 * (see the note on populateAppMetadata() in repairSignClientMetadata()).
 */
function wcPublicMetadata() {
  const url = publicAppUrl('/').replace(/\/+$/, '');
  return {
    name: WC_APP_NAME,
    description: WC_APP_DESCRIPTION,
    url,
    icons: [`${url}/icon-512.png`]
  };
}

/**
 * Is this init() failure the MODAL failing, rather than the connection?
 *
 * EthereumProvider's init wraps the whole AppKit bootstrap — the dynamic
 * `import('@reown/appkit/core')` and the `createAppKit()` call — in one
 * try/catch and rethrows its own message:
 *
 *     throw new Error('To use QR modal, please install @reown/appkit package')
 *
 * (verified against the installed @walletconnect/ethereum-provider@2.23.10).
 * That single string covers every way the surface can fail to appear: the
 * chunk could not be fetched, `createAppKit` threw on a missing network list,
 * a bundler renamed the entry. None of them say anything about the relay, the
 * project id or the origin — so classifying them as a connection failure
 * would report "the relay is unreachable" for a modal that never rendered,
 * which is exactly the misdiagnosis this file has already paid for once.
 */
function isAppKitModalError(err) {
  const msg = String(err?.message || '');
  return /QR modal/i.test(msg) || /@reown\/appkit/i.test(msg);
}

const SLOW_DEVICE = (() => {
  if (typeof navigator === 'undefined') return false;
  if (isIOSDevice()) return true;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  return cores <= 4 || mem <= 2;
})();

/**
 * NON-CUSTODIAL WALLET LAYER
 * ---------------------------------------------------------------------------
 * Three connection modes, all self-custody. In every one of them the private
 * key stays with the user and this app never sees, stores or transmits it:
 *
 *   1. `injected`  — window.ethereum (MetaMask on desktop, wallet in-app browsers)
 *   2. `wc`        — WalletConnect v2 (the real path inside Telegram: QR/deep link)
 *   3. `local`     — an in-app wallet whose seed is AES-GCM encrypted on-device
 *
 * There is no operator wallet, no deposit address, and no server-side signing
 * anywhere in this codebase. Transactions are built client-side and signed by
 * whichever wallet the user chose.
 */

const WalletContext = createContext(null);

const loadEthers = () => import('ethers');

const toHexChainId = (value) => `0x${Number(value || DEFAULT_CHAIN).toString(16)}`;

function createLocalEip1193Adapter({ signer, account, chainId, getReadProvider }) {
  if (!signer || !account) return null;
  const activeChainId = Number(chainId || DEFAULT_CHAIN);
  return {
    async request({ method, params = [] } = {}) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
      if (method === 'eth_chainId') return toHexChainId(activeChainId);
      if (method === 'net_version') return String(activeChainId);
      if (method === 'personal_sign') {
        const [message] = params;
        const text = typeof message === 'string' && /^0x[0-9a-fA-F]*$/.test(message)
          ? new TextDecoder().decode(Uint8Array.from(message.slice(2).match(/.{1,2}/g) || [], (b) => parseInt(b, 16)))
          : String(message || '');
        return signer.signMessage(text);
      }
      if (method === 'eth_signTypedData_v4') {
        const [, typedRaw] = params;
        const typed = typeof typedRaw === 'string' ? JSON.parse(typedRaw) : typedRaw;
        const { domain = {}, types = {}, primaryType, message = {} } = typed || {};
        const cleanTypes = { ...types };
        delete cleanTypes.EIP712Domain;
        const selectedTypes = primaryType && cleanTypes[primaryType]
          ? { [primaryType]: cleanTypes[primaryType] }
          : cleanTypes;
        return signer.signTypedData(domain, selectedTypes, message);
      }
      if (method === 'eth_sendTransaction') {
        const tx = { ...(params[0] || {}) };
        delete tx.from;
        if (!signer.provider && typeof getReadProvider === 'function') {
          const provider = await getReadProvider(activeChainId);
          return (await signer.connect(provider).sendTransaction(tx)).hash;
        }
        return (await signer.sendTransaction(tx)).hash;
      }
      throw Object.assign(new Error(`Unsupported local wallet method: ${method}`), { code: 4200 });
    }
  };
}

/*
 * ─── THE "SPINS FOREVER" BUG ────────────────────────────────────────────────
 * `wc.connect()` never had an outer timeout. Inside the SDK, `Relayer.connect()`
 * retries the relay socket up to 5 times with an increasing backoff
 * (`sleep(attempt * 1000ms)` between attempts) BEFORE it ever rejects — on a
 * network that blocks `relay.walletconnect.com` outright (the Iranian case),
 * that is 5 stalled socket attempts, each waiting out its own internal
 * `Socket stalled when trying to connect` timeout (15s), before the promise
 * this file awaits ever settles. That is 60-90+ seconds of a spinner with
 * zero feedback — which reads exactly like "it just spins".
 *
 * `withTimeout` / `WC_CONNECT_TIMEOUT_MS` (lib/wcTimeout.js — a standalone
 * module so it is unit-testable without mounting React or a real WC client)
 * bounds our own wait. When it fires we do not touch the SDK's internal
 * socket (it keeps retrying on its own schedule and is simply abandoned —
 * see the `wc?.disconnect?.()` cleanup below), but the USER gets their
 * screen back immediately with an actionable `WC_RELAY_UNREACHABLE` message
 * instead of an endless spinner.
 *
 * ─── THE SECOND LAYER: RELAY FAILOVER ─────────────────────────────────────
 * Naming the failure is not fixing it. WalletConnect fronts its relay with
 * TWO hostnames, and the one this app used to force first
 * (`relay.walletconnect.com`) is the HISTORICAL one: the installed
 * `@walletconnect/core@2.25.0` declares
 * `RELAYER_DEFAULT_RELAY_URL = "wss://relay.walletconnect.org"`, and
 * docs.reown.com/advanced/faq answers \"the default relay endpoint is blocked\"
 * with `relayUrl: 'wss://relay.walletconnect.org'` — i.e. the second entry
 * in the old list was the host the SDK would have picked by itself, while
 * the app paid an 8s fuse on its own override first.
 *
 * `initWcProvider()` below still walks WC_RELAY_URLS — now in the SDK's own
 * order, default first, historical hostname second — with a short fuse on
 * every entry but the last. On an SNI/DNS-filtered network (the shape
 * Iranian ISP blocking actually takes) pairing succeeds through the entry
 * that answers instead of only failing politely; a network that blocks both
 * still lands on the same named error, sooner than before. Every hostname in
 * the list is also probed by lib/walletHealth.js, so a ❌ in the report is
 * never one hostname standing in for the whole relay.
 */

export function WalletProvider({ children }) {
  const [mode, setMode] = useState(null); // 'injected' | 'wc' | 'local'
  /* Which injected wallet we attached (EIP-6963 info, never the provider
     object itself — state must stay JSON-clean). Drives the provider label
     on the Wallet page; null for wc/local modes. */
  const [injectedInfo, setInjectedInfo] = useState(null);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [nativeBalance, setNativeBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [locked, setLocked] = useState(false);

  // Kept in refs so the signer/provider never lands in React state (and thus
  // never in devtools snapshots or a serialized store).
  const signerRef = useRef(null);
  const eip1193Ref = useRef(null);
  const wcRef = useRef(null);
  // EIP-6963 discovered injected providers. Map<uuid, { info, provider }>
  const eip6963Ref = useRef(new Map());
  const wcInitingRef = useRef(false);
  /* Single-flight for the email/social restore: the cold start, a bfcache
     `pageshow` return and a foreground resume can all ask for the same
     restore within a second of each other (see restoreEmailSocial). */
  const emailRestoreRef = useRef(false);
  const wcListenersRef = useRef(null);
  const injectedListenersRef = useRef(null);
  /*
   * THE PAIRING URI THE SDK ISSUED — the one string the whole flow turns on.
   *
   * This is the `wc:<topic>@2?relay-protocol=irn&symKey=…` string the provider
   * emits on `display_uri`. Two surfaces can render it, and which one is up is
   * `wcModalActive` below: the SDK's own AppKit modal (the normal path, and the
   * surface users recognise) or the app's own pairing view — a real QR of
   * exactly those bytes plus one deep link per promoted wallet via
   * lib/wcWallets.js — which is what the user gets when the modal could not be
   * built, or when they ask for the QR by hand. Null outside a pairing attempt:
   * a URI left in state after the attempt settles is how a wallet gets opened
   * on a pairing that no longer exists.
   */
  const [wcPairUri, setWcPairUri] = useState(null);
  /*
   * True while the SDK's AppKit modal owns the pairing screen. The connection
   * sheet withdraws for that window (no second backdrop, no second scroll
   * lock — two stacked modals composited into the "grey box flickering" report
   * on the Android WebView) and comes back the moment the attempt settles.
   */
  const [wcModalActive, setWcModalActive] = useState(false);
  /* The email/social AppKit modal's open state — the sheet withdraws while
     EITHER modal owns the screen (two stacked blurred backdrops composited
     into the «grey box flickering» report on the Android WebView). */
  const [emailModalActive, setEmailModalActive] = useState(false);
  /*
   * THE MEASURED RELAY STATE — the fact the connect sheet was missing.
   *
   * One object from lib/wcRelayProbe.js: `{ verdict, hosts, openUrls, order }`,
   * measured on THIS device and network. It exists because the sheet used to
   * offer WalletConnect pairing as «recommended» on a network where the relay's
   * WebSocket is filtered — a route that cannot work, presented as the best one,
   * discovered only after a tap and a stalled SDK attempt. `wcRelayBlocked` is
   * the derived question the UI asks: is pairing possible here right now?
   */
  const [wcRelay, setWcRelay] = useState(null);
  const wcRelayBlocked = Boolean(wcRelay && isRelayBlocked(wcRelay.verdict));
  /* The in-flight provider, so Cancel can tear down the attempt that owns the
     URI (wcRef is only assigned on SUCCESS). */
  const wcPairingRef = useRef(null);
  /* Cancel switch for the in-flight connect: cancelling must settle the
     promise NOW, not wait for the 20s bound, or the next tap is swallowed by
     the wcInitingRef single-flight. */
  const wcCancelRef = useRef(null);
  // Forwarding ref so callbacks defined early can call the latest disconnect()
  // without creating a useCallback cycle through the deps array.
  const disconnectRef = useRef(() => {});
  /**
   * Render-time mirror of `address` for event handlers that must not close
   * over a stale copy (the visibilitychange session-restore path). Same
   * pattern as disconnectRef.
   */
  const addressRef = useRef(null);
  addressRef.current = address;
  /*
   * Render-time mirror of `chainId`, for the same reason: the vault callbacks
   * below need to know which network the user had selected BEFORE the unlock,
   * and closing over the state variable would capture the value from the
   * render in which the callback was created.
   */
  const chainIdRef = useRef(null);
  chainIdRef.current = chainId;

  /**
   * The network an in-app (local) wallet should come up on.
   *
   * Unlocking the vault used to hard-set DEFAULT_CHAIN in all three paths
   * below, which threw the user off the network they had just picked: choose
   * Base, unlock your in-app wallet, and the app is back on BNB Smart Chain
   * with the signer re-pointed at BSC's RPC. Nothing crashed — the label and
   * the signer agreed — but the next "send USDT" was a BSC transfer the user
   * never asked for, and the balance they were looking at was the wrong chain's.
   *
   * So: keep the selected chain when it is one this app supports, and fall back
   * to DEFAULT_CHAIN only when there is nothing to keep (first boot, or a chain
   * the registry does not know). The signer is always connected to whichever
   * chain this returns, so the two can never disagree.
   */
  const localTargetChain = useCallback(() => {
    const current = Number(chainIdRef.current);
    return EVM_CHAINS[current] ? current : DEFAULT_CHAIN;
  }, []);

  const chain = EVM_CHAINS[chainId] ?? EVM_CHAINS[DEFAULT_CHAIN];

  /* ----------------------------- read helpers ---------------------------- */

  /**
   * Build the individual read-only JsonRpcProviders for a chain, in priority
   * order. Shared by the fail-over wrapper (getReadProvider) and the raw list
   * handed to the multi-RPC preflight quorum (getReadProviders), so the two
   * can never drift about which endpoints exist or their order.
   *
   * https only. An http endpoint would be blocked by the WebView's
   * usesCleartextTraffic=false anyway, and downgrading a wallet's RPC to
   * plaintext is worth refusing outright rather than failing obscurely.
   */
  const buildReadProviders = useCallback(async (targetChain = DEFAULT_CHAIN) => {
    const { JsonRpcProvider } = await loadEthers();
    const cfg = EVM_CHAINS[targetChain];

    /*
     * The user's own node comes FIRST, if they set one.
     *
     * REAL BUG: Settings has a "custom RPC" field with a warning about only
     * using endpoints you trust. It stored the URL, redrew its own label from
     * it, and nothing ever connected to it — every read went to the built-in
     * public endpoints regardless. Someone who switched to their own node for
     * privacy or reliability got neither, while the UI told them they had.
     *
     * Placed ahead of the defaults rather than replacing them: a private node
     * that goes down would otherwise take the whole app with it, and
     * FallbackProvider already fails over on a stall.
     */
    const custom = useSettingsStore.getState().customEvmRpc;
    const rpcList =
      typeof custom === 'string' && /^https:\/\//.test(custom.trim())
        ? [custom.trim(), ...cfg.rpc]
        : cfg.rpc;

    return rpcList.map((url, i) => {
      const provider = new JsonRpcProvider(url, targetChain, { staticNetwork: true });
      /* Keep the priority metadata on a non-enumerable side-channel so the
         provider stays JSON-clean in devtools/snapshots. */
      Object.defineProperty(provider, '__rpcPriority', { value: i + 1, enumerable: false });
      /*
       * On iPhone the public BSC RPC endpoint is routinely >2s to first byte.
       * 2500ms was just fast enough to trip the stall timer and race a second
       * request before the first answered — on a flaky connection that meant
       * two requests, two seconds each, and a balance that looked like it
       * never loaded. Raise the timeout on slow devices and rely on the
       * priority order instead of racing.
       */
      Object.defineProperty(provider, '__stallTimeout', { value: SLOW_DEVICE ? 6000 : 2500, enumerable: false });
      return provider;
    });
  }, []);

  const getReadProvider = useCallback(async (targetChain = DEFAULT_CHAIN) => {
    const { FallbackProvider } = await loadEthers();
    const providers = await buildReadProviders(targetChain);
    /*
     * Single-endpoint chains return the JsonRpcProvider ITSELF. The previous
     * code returned `providers[0].provider` — but `providers[0]` IS already a
     * JsonRpcProvider, and `.provider` is undefined on it. That silently
     * broke EVERY read on chains with exactly one RPC entry (Robinhood 4663,
     * Avalanche, Linea, Sonic): balances, gas estimates, price-impact probes
     * and token imports all threw on an undefined provider while the wallet
     * screen answered «دوباره امتحان کنید». Fixed 2026-09-13.
     */
    return providers.length > 1
      ? new FallbackProvider(
          providers.map((provider, i) => ({
            provider,
            priority: i + 1,
            stallTimeout: SLOW_DEVICE ? 6000 : 2500,
            weight: 1
          })),
          targetChain,
          { quorum: 1, cacheTimeout: 15_000 }
        )
      : providers[0];
  }, [buildReadProviders]);

  /**
   * The raw, independent read nodes for a chain — the inputs to the multi-RPC
   * preflight quorum, where the exact bytes are simulated on several nodes and
   * `RPC_DISAGREEMENT` is only reported on a genuine passed-vs-reverted split.
   */
  const getReadProviders = useCallback(async (targetChain = DEFAULT_CHAIN) => {
    return buildReadProviders(targetChain);
  }, [buildReadProviders]);

  const refreshBalance = useCallback(
    async (addr = address, cid = chainId ?? DEFAULT_CHAIN) => {
      if (!addr) return;
      try {
        const { formatEther } = await loadEthers();
        const provider = await getReadProvider(cid);
        const wei = await provider.getBalance(addr);
        setNativeBalance(Number(formatEther(wei)));
      } catch {
        setNativeBalance(null);
      }
    },
    [address, chainId, getReadProvider]
  );

  /* ------------------------------- injected (EIP-6963 aware) -------------- */

  // Discover EIP-6963 providers on mount. Does NOT auto-connect; surfaces
  // options for the connection sheet.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onAnnounce = (ev) => {
      const { info, provider } = ev.detail || {};
      if (!info || !provider || !info.uuid) return;
      eip6963Ref.current.set(info.uuid, { info, provider });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  const attachInjectedListeners = useCallback((eip) => {
    if (!eip || !eip.on) return;
    const onAccounts = (accs) => (accs?.length ? setAddress(accs[0]) : disconnectRef.current());
    const onChain = (hex) => setChainId(Number(hex));
    const onDisconnect = () => disconnectRef.current();
    eip.on?.('accountsChanged', onAccounts);
    eip.on?.('chainChanged', onChain);
    eip.on?.('disconnect', onDisconnect);
    injectedListenersRef.current = { onAccounts, onChain, onDisconnect };
  }, []);

  const detachInjectedListeners = useCallback(() => {
    const listeners = injectedListenersRef.current;
    const eip = eip1193Ref.current;
    if (!listeners || !eip?.removeListener) { injectedListenersRef.current = null; return; }
    try { eip.removeListener('accountsChanged', listeners.onAccounts); } catch { /* noop */ }
    try { eip.removeListener('chainChanged', listeners.onChain); } catch { /* noop */ }
    try { eip.removeListener('disconnect', listeners.onDisconnect); } catch { /* noop */ }
    injectedListenersRef.current = null;
  }, []);

  /**
   * Connect an injected provider. Prefer an explicit EIP-6963 provider when a
   * wallet rdns is given (e.g. MetaMask, Trust); otherwise fall back to
   * window.ethereum. Never assumes window.ethereum is MetaMask.
   */
  const connectInjected = useCallback(async (rdns) => {
    setError(null);
    setConnecting(true);
    /* Same contract as the WalletConnect path: refresh/reload stays frozen
       while a wallet approval screen may be up. */
    const connectGuard = holdRefreshGuard('injected-connect');
    try {
      // Clean up any prior listeners before reattaching.
      detachInjectedListeners();

      let target = window.ethereum;
      let matchedInfo = null;
      // If there are multiple injected providers (EIP-6963) pick by rdns.
      if (rdns && eip6963Ref.current.size > 0) {
        for (const { info, provider } of eip6963Ref.current.values()) {
          if (info.rdns === rdns) { target = provider; matchedInfo = info; break; }
        }
      } else if (Array.isArray(window.ethereum?.providers) && window.ethereum.providers.length) {
        // Prefer MetaMask by default when multiple providers compete and no
        // explicit choice is given, but never assume the first is.
        target = window.ethereum.providers.find((p) => p.isMetaMask && !p.isTrust)
          || window.ethereum.providers.find((p) => p.isTrust)
          || window.ethereum.providers[0];
      }
      if (!target) throw new Error('NO_INJECTED_WALLET');

      const { BrowserProvider } = await loadEthers();
      const provider = new BrowserProvider(target, 'any');
      const accounts = await provider.send('eth_requestAccounts', []);
      if (!accounts?.[0]) throw new Error('NO_ACCOUNTS');
      const net = await provider.getNetwork();

      eip1193Ref.current = target;
      signerRef.current = await provider.getSigner();
      setMode('injected');
      setInjectedInfo(matchedInfo);
      setAddress(accounts[0]);
      setChainId(Number(net.chainId));
      setLocked(false);
      attachInjectedListeners(target);
      await refreshBalance(accounts[0], Number(net.chainId));
      return true;
    } catch (e) {
      const msg = String(e?.message || '');
      if (msg.includes('User rejected') || e?.code === 4001) {
        setError('USER_REJECTED');
      } else if (msg === 'NO_INJECTED_WALLET') {
        setError('NO_INJECTED_WALLET');
      } else {
        setError('CONNECT_FAILED');
      }
      return false;
    } finally {
      setConnecting(false);
      connectGuard.release();
    }
  }, [attachInjectedListeners, detachInjectedListeners, refreshBalance]);

  // Attach the embedded EIP-1193 provider to the same signer state as other wallets.
  const attachEmailProvider = useCallback(async (modal, acct) => {
    const eip = modal?.getWalletProvider?.();
    if (!eip || !acct) {
      wcEvent(!eip ? 'email_attach_no_provider' : 'email_attach_no_acct');
      return false;
    }
    try {
      const { BrowserProvider } = await loadEthers();
      const provider = new BrowserProvider(eip, 'any');
      const signer = await provider.getSigner();
      const net = await provider.getNetwork();
      const cid = Number(net.chainId);
      const honest = EVM_CHAINS[cid] ? cid : DEFAULT_CHAIN;
      detachInjectedListeners();
      eip1193Ref.current = eip;
      signerRef.current = signer;
      setMode('email');
      setInjectedInfo(null);
      setAddress(acct);
      setChainId(honest);
      setLocked(false);

      setEmailSocialMarker(true);
      attachInjectedListeners(eip);
      await refreshBalance(acct, honest);
      /* SUCCESS WAS INVISIBLE. attachEmailProvider emitted events only on its
         failure paths, so a working email login produced an EMPTY trace — and
         a later support report read as "nothing ran at all". One literal
         event names the outcome; the address stays out of the trace. */
      wcEvent('email_connected');
      return true;
    } catch {
      wcEvent('email_attach_failed');
      return false;
    }
  }, [attachInjectedListeners, detachInjectedListeners, refreshBalance]);

  const connectEmailSocial = useCallback(async () => {
    if (connecting) return false;
    setError(null);
    setConnecting(true);

    const connectGuard = holdRefreshGuard('email-connect');

    let modal = null;
    try {
      if (eip1193Ref.current || wcRef.current) disconnectRef.current?.();

      // Claim before OAuth can navigate away; roll back only without a live session.
      setEmailSocialMarker(true);

      modal = await getEmailSocialAppKit(WC_PROJECT_ID, wcPublicMetadata());
      if (!modal) throw new Error('APPKIT_UNAVAILABLE');

      const warm = modal.getIsConnectedState?.() && modal.getAddress?.('eip155');
      if (warm) {

        const attached = await attachEmailProvider(modal, warm).then(
          (ok) => Boolean(ok),
          () => {
            setError('CONNECT_FAILED');
            return false;
          }
        );

        if (!attached) rollbackEmailSocialMarker(modal);
        return attached;
      }

      setEmailModalActive(true);
      const attached = await waitForEmailConnection(modal, (acct) => attachEmailProvider(modal, acct), {
        onError: () => setError('CONNECT_FAILED')
      });
      if (!attached) rollbackEmailSocialMarker(modal);
      return attached;
    } catch {

      rollbackEmailSocialMarker(modal);
      setError('CONNECT_FAILED');
      return false;
    } finally {
      setEmailModalActive(false);
      setConnecting(false);
      connectGuard.release();
    }
  }, [connecting, attachEmailProvider]);

  const restoreEmailSocial = useCallback(async () => {
    if (typeof window === 'undefined' || addressRef.current) return false;
    if (!hasEmailSocialMarker()) return false;
    /* ONE RESTORE AT A TIME. Three callers can now ask for this within the
       same second — the cold start, a bfcache `pageshow` return, and a
       foreground resume — and each would build/consult the same singleton
       instance and arm its own window. Failing the second caller quietly is
       correct: the first one is already doing exactly what it asked for. */
    if (emailRestoreRef.current) return false;
    emailRestoreRef.current = true;
    try {
      const modal = await getEmailSocialAppKit(WC_PROJECT_ID, wcPublicMetadata());
      let acct = null;
      try { acct = modal.getIsConnectedState?.() ? modal.getAddress?.('eip155') : null; } catch { acct = null; }
      if (!acct) {
        acct = await new Promise((resolve) => {
          let off = null;
          let pollTimer = null;
          const finish = (val) => {
            clearTimeout(timer);
            clearInterval(pollTimer);
            try { off?.(); } catch { /* noop */ }
            resolve(val);
          };
          const timer = setTimeout(() => finish(null), EMAIL_RESTORE_WINDOW_MS);
          pollTimer = setInterval(() => {
            try {
              if (modal.getIsConnectedState?.()) {
                const a = modal.getAddress?.('eip155');
                if (a) finish(a);
              }
            } catch { /* poll is best effort */ }
          }, 600);
          try {
            off = modal.subscribeAccount?.((a) => {
              if (!a?.isConnected || !a?.address) return;
              finish(a.address);
            });
          } catch {
            // subscribe failed — polling still covers
          }
        });
      }
      if (!acct) {
        /*
         * A TIMEOUT IS NOT AN ANSWER — the previous code treated one as
         * "definitively gone" and called clearEmailSocialSession(), which
         * deleted the boot marker. That turned a SLOW boot (the SDK gives its
         * own iframe 20s; this window used to be 8s) into a PERMANENT loss:
         * every later cold start saw no marker and never consulted the — still
         * valid — session again. rollbackEmailSocialMarker() is the honest
         * rule and already exists: the marker is handed back only when AppKit
         * itself says nothing is connected, and kept when it cannot answer.
         */
        let cleared = false;
        try { cleared = rollbackEmailSocialMarker(modal); } catch { cleared = false; }
        wcEvent(cleared ? 'email_restore_none' : 'email_restore_pending');
        return false;
      }
      // The secure iframe's provider can lag the address event by 500–1500ms on a
      // slow WebView (observed on restore: isConnected true + address present,
      // but getWalletProvider() still null). A single attach attempt that hits
      // that window reports email_attach_no_provider and leaves the marker
      // orphaned until the next foreground retry — exactly the «ایمیل تأیید شد،
      // برگشتیم، والت نبود» report. Retry the attach with the same poll that
      // waitForEmailConnection uses for its close grace.
      let attached = await attachEmailProvider(modal, acct);
      if (!attached) {
        for (let attempt = 0; attempt < 6 && !attached; attempt += 1) {
          // eslint-disable-next-line no-await-in-loop -- sequential attach retry is the point
          await new Promise((r) => setTimeout(r, 500));
          let freshAcct = acct;
          try {
            if (modal.getIsConnectedState?.()) freshAcct = modal.getAddress?.('eip155') || acct;
            else break;
          } catch { /* keep original acct */ }
          // eslint-disable-next-line no-await-in-loop
          attached = await attachEmailProvider(modal, freshAcct);
        }
        if (!attached) wcEvent('email_attach_restore_failed');
      }
      if (attached) wcEvent('email_session_restored');
      return attached;
    } catch {
      wcEvent('email_restore_failed');
      return false; /* offline/blocked chunk: marker survives for the next cold start */
    } finally {
      emailRestoreRef.current = false;
    }
  }, [attachEmailProvider]);

  /* --------------------------- WalletConnect v2 -------------------------- */

  /**
   * The init config shared by connect AND session restore.
   *
   * Both paths MUST initialise with byte-identical metadata, chains and modal
   * options: a session restored with different metadata than it was created
   * with is exactly the kind of identity drift wallets (Trust especially)
   * re-verify against, and a mismatch there is a source of the wallet-side
   * re-prompts and silent session drops this context keeps hunting.
   */
  const buildWcInitConfig = useCallback((withModal = true) => {
    /* One canonical identity for every wallet prompt. publicAppUrl rejects
       the retired lawpoetics.ir env value; using the runtime origin here
       made Solana and EVM prompts disagree about which site was connecting. */
    const publicUrl = publicAppUrl('/').replace(/\/$/, '');
    const ios = isIOSDevice();
    return {
      projectId: WC_PROJECT_ID,
      chains: [DEFAULT_CHAIN],
      optionalChains: Object.keys(EVM_CHAINS).map(Number),
      /*
       * showQrModal: THE SDK MODAL IS THE SURFACE AGAIN — and this time the
       * last metre is fixed underneath it, not removed around it.
       *
       * ─── HISTORY, AND WHY THE PREVIOUS ROUND WAS WRONG ──────────────────
       * An earlier round set this to `false` and rendered its own pairing
       * sheet, on the reasoning that AppKit's modal had four places a pairing
       * could die (a wallet-list fetch, Lit components, its own link builder,
       * its own `window.open`). The report did not change, and the surface
       * users knew — the standard WalletConnect modal with wallet logos and a
       * QR — was replaced by something that read as broken («شکل عوض شده، زشت
       * و نادرست»). Removing the modal fixed nothing because the modal was
       * never what was failing.
       *
       * ─── WHAT WAS ACTUALLY FAILING (measured, not inferred) ─────────────
       * `@reown/appkit-controllers@1.8.19`,
       * ConnectionControllerUtil.onConnectMobile():
       *
       *     const target = CoreHelperUtil.isIframe() ? '_top' : '_self';
       *     CoreHelperUtil.openHref(universalLink, target);
       *
       * `window.open(url, '_self')` replaces the current document. The wallet
       * hand-off therefore DESTROYED the dApp mid-pairing: the WalletConnect
       * client, its relay socket and the pending connect() promise all died in
       * the same instant the wallet opened. The approval the user tapped in
       * Trust was published to a relay nobody was listening to any more, and
       * the tab was left on Trust's own "Download the app" page. That is the
       * whole report — «deep-link error», «the shape changed», «still not
       * connected» — from one argument to window.open.
       *
       * So the modal is back (this line), and the delivery target is fixed in
       * lib/browser.js (`openWalletLink`, which never navigates this document)
       * and enforced on the SDK's own call by the window.open bridge installed
       * in connectWalletConnect() below.
       *
       * ─── AND THE FALLBACK IS STILL HERE ─────────────────────────────────
       * The sheet's own pairing view (QR + one button per wallet + copyable
       * URI) is kept: it is what the user gets if the AppKit chunk cannot be
       * imported (a blocked CDN, an offline shell) — init() is retried
       * without a modal in that case — or if they open it by hand from the
       * choose view. `display_uri` feeds it either way.
       */
      showQrModal: withModal,
      /* MOBILE: on a phone the wallet is another app on the SAME device, so
         there is no second screen to point a camera at. Our pairing sheet
         therefore leads with "open this wallet" buttons that deep-link into
         each wallet app; the QR code stays as the fallback for a second
         device. */
      optionalMethods: ['eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
      qrModalOptions: {
        themeMode: 'dark',
        enableExplorer: true,
        explorerExcludedWalletIds: 'ALL',
        /*
         * 'NONE' on purpose — see applyAppKitWalletLinks().
         *
         * `explorerRecommendedWalletIds` is one of the few qrModalOptions that
         * convertWCMToAppKitOptions() DOES forward (as `featuredWalletIds`).
         * Leaving the five explorer ids here meant the promoted wallets were
         * rendered from the explorer API response — so on a network that
         * filters api.web3modal.org they vanished, and any copy we shipped
         * locally was filtered out of `customWallets` for carrying a
         * duplicate id. Clearing it makes lib/wcWallets.js the single source
         * for the promoted list, reachable or not.
         */
        explorerRecommendedWalletIds: 'NONE',
        /*
         * Kept for the legacy standalone-modal shape; AppKit only carries
         * `{ id, name, links }` forward and never reads `links`, so this list
         * alone cannot open a wallet. The links that actually ship are applied
         * in applyAppKitWalletLinks() after init().
         */
        mobileWallets: legacyModalWallets()
      },
      metadata: {
        name: 'FBT Swap',
        description: 'Non-custodial decentralized exchange',
        url: publicUrl,
        icons: [`${publicUrl}/icon-512.png`],
        redirect: {
          /*
           * `native` must ONLY be set inside the packaged app. It was sent
           * unconditionally, so a wallet approving a WEB session on Android
           * would try to bounce back to ir.fbtswap.app:// — an intent that
           * either fails (APK not installed) or yanks the user out of the
           * browser tab they were connecting from. On iOS there is no app
           * scheme registered at all (this repo has no ios/ folder), so
           * only the universal link applies there in every case.
           */
          native: isNativeShell() && !ios ? 'ir.fbtswap.app://' : undefined,
          universal: publicUrl
        }
      }
    };
  }, []);

  /**
   * Give the bundled AppKit modal a deterministic promoted-wallet table.
   *
   * ethereum-provider translates the legacy `mobileWallets` option into an
   * AppKit shape that has historically drifted across releases. Updating the
   * modal after init ensures every row has the explorer fields AppKit actually
   * reads (`mobile_link`, `link_mode`, image_url). Native links are primary;
   * link_mode remains available only as the Telegram/compatibility fallback.
   *
   * The compatibility wrapper also records the row the user tapped. That lets
   * wcDeepLink complete a rare bare `wc:` open request without guessing a
   * wallet. All failures here are best-effort: pairing and QR remain usable.
   */
  const applyAppKitWalletLinks = useCallback(async (wc) => {
    /*
     * NO MODAL, NOTHING TO PATCH. Reached only on the degraded path — an
     * init() that was retried WITHOUT the modal because the AppKit chunk
     * could not be imported (see connectWalletConnect). Returning here
     * (instead of falling through to the controllers singleton) keeps the
     * trace honest: writing options into a controller no modal reads would
     * report `appkit_links_applied` for work that changed nothing.
     */
    if (!wc?.modal) {
      wcEvent('appkit_modal_absent');
      return false;
    }
    const options = {
      /* The project id goes in because AppKit renders `image_url` for a
         customWallet and falls back to a generic grey glyph without one —
         and "every wallet wears the same icon" is half of why the promoted
         list read as broken. The URLs are the explorer's own logo CDN, the
         same ones AppKit would have used for the same wallets had they come
         from its explorer response. */
      customWallets: appKitCustomWallets(WC_PROJECT_ID),
      /* Native wallet schemes preserve the pairing payload end-to-end. The
         bridge routes Telegram to HTTPS and the APK to ACTION_VIEW itself. */
      experimental_preferUniversalLinks: false,
      metadata: wcPublicMetadata(),
      /* THE SHARED-SINGLETON TRUCE, THIS SURFACE'S HALF.
         ------------------------------------------------
         The email/social login runs its OWN AppKit instance (see
         lib/emailSocialWallet.js for why the provider's embedded modal can
         never offer it), and both instances share the OptionsController
         singleton and the one <w3m-modal> element. Every surface therefore
         re-asserts its own `features` immediately before opening its modal —
         cheap, idempotent and order-proof. On THIS surface the assertion is
         { email: false, socials: false }: an email row here would produce an
         auth connection that the pending wc.connect() can never settle on,
         and the user would sit under a spinning pairing that thinks it is
         still waiting for a wallet app. The twin assertion lives in
         reassertEmailFeatures() and runs before the email modal opens.

         `manualWCControl` and `enableWallets` are part of the same truce:
         the email surface asserts false for both (its open() would otherwise
         be hijacked to AllWallets, and its wallet rows would be dead ends);
         THIS surface needs manualWCControl true — ModalController.open()
         routes mobile devices to the wallet list from it — and the wallet
         rows ON. Without the re-assertion, whichever surface booted last
         decided what the other one rendered. */
      manualWCControl: true,
      enableWallets: true,
      features: { email: false, socials: false }
    };
    /* Explorer rows often omit link_mode. Fill that fallback and record the
       selected wallet without changing AppKit's native-first choice. */
    try {
      /* Emitted as an outcome IN THE NAME (the trace's own idiom, see
         metadata_repaired/metadata_repair_failed): the buffer must never be
         able to carry a value that is not a fixed fact. */
      if (await installAppKitLinkModePatch()) wcEvent('appkit_link_mode_patched');
      else wcEvent('appkit_link_mode_patch_failed');
    } catch { /* never blocks Connect */ }
    try {
      /* Primary: the modal instance ethereum-provider already built. */
      const update = wc?.modal?.updateOptions;
      if (typeof update === 'function') {
        update.call(wc.modal, options);
        wcEvent('appkit_links_applied');
        return true;
      }
    } catch {
      /* fall through to the controllers singleton */
    }
    try {
      /* Fallback: the same singleton the modal reads. Only reached when the
         instance API is missing, so a failure here is loud in the trace
         instead of silent in front of the user. */
      const controllers = await import('@reown/appkit-controllers');
      const C = controllers?.OptionsController;
      C?.setCustomWallets?.(options.customWallets);
      C?.setPreferUniversalLinks?.(options.experimental_preferUniversalLinks);
      C?.setMetadata?.(options.metadata);
      C?.setManualWCControl?.(options.manualWCControl);
      C?.setEnableWallets?.(options.enableWallets);
      /* Same features truce on the singleton fallback path — without it, a
         controllers-only write still inherits the email surface's flags. */
      C?.setFeatures?.(options.features);
      wcEvent('appkit_links_applied', 1);
      return true;
    } catch {
      wcEvent('appkit_links_failed');
      return false;
    }
  }, []);

  // Bounded SDK initialization with relay fallback and late-provider cleanup.
  const initWcProvider = useCallback(async (EthereumProvider, baseConfig, relayOrder) => {

    const urls = (Array.isArray(relayOrder) && relayOrder.length ? relayOrder : WC_RELAY_URLS).map(String);
    let lastError = null;
    for (let i = 0; i < urls.length; i += 1) {
      const isLast = i === urls.length - 1;
      const budget = isLast ? WC_CONNECT_TIMEOUT_MS : WC_PRIMARY_RELAY_TIMEOUT_MS;
      wcEvent(i ? 'relay_fallback_try' : 'relay_try', Number(i));
      let orphaned = true;
      try {
        const attempt = Promise.resolve(
          EthereumProvider.init({ ...baseConfig, relayUrl: urls[i] })
        );
        attempt.then((ghost) => {
          if (orphaned) {
            try { ghost?.disconnect?.(); } catch {  }
          }
        }, () => {  });
        // eslint-disable-next-line no-await-in-loop -- sequential failover is the point
        const wcInstance = await withTimeout(attempt, budget, 'WC_INIT_TIMEOUT');
        orphaned = false;

        wcEvent(i ? 'provider_ready_fallback' : 'provider_ready', Number(i));
        const socket = readRelaySocket(wcInstance);
        if (socket.connected) wcEvent('relay_socket_open', Number(i));
        else wcEvent('relay_socket_unopened');
        return wcInstance;
      } catch (e) {
        lastError = e;
        wcEvent(i ? 'relay_fallback_failed' : 'relay_failed', Number(i));
        if (!isLast && isRelayClassError(e)) continue;
        throw e;
      }
    }
    throw lastError;
  }, []);

  /**
   * Repair the SignClient's metadata in place.
   *
   * The SDK runs our metadata through populateAppMetadata(), which OVERWRITES
   * `metadata.url` with window.location.origin whenever the two hosts differ.
   * Inside the packaged app that origin is `https://localhost`; on a preview
   * host it is that preview URL. Either way the wallet (a separate app)
   * cannot fetch the URL, so MetaMask rejects with "Invalid URL" and Trust
   * fails the pairing — and Trust's security scanner, seeing a dapp that
   * claims to be `https://localhost`, shows exactly the red "Security risk /
   * the domain is flagged unsafe by multiple security providers" screen the
   * WalletConnect page kept reporting. Point the live sign client back at
   * the public origin — this is the value that lands in the session proposal
   * the wallet renders.
   *
   * ─── WHERE THE METADATA ACTUALLY LIVES (verified against the installed
   * ─── @walletconnect/universal-provider@2.23.10 + sign-client@2.23.10) ────
   * UniversalProvider.createClient() does `this.client = SignClient.init(…)`,
   * and the SignClient constructor does
   * `this.metadata = populateAppMetadata(opts.metadata)`. The engine then
   * serialises the proposal from `this.client.metadata`.
   *
   * So the object that reaches the wallet is `wc.signer.client.metadata` —
   * the SIGN CLIENT, not the Core. An earlier revision of this function
   * aimed at `wc.signer.metadata` (the UniversalProvider, which has no such
   * property) and reported `metadata_repair_failed` from that same dead
   * reference, so the trace claimed failure on every single connect even
   * though the second branch had repaired the live object. A diagnostic that
   * always cries wolf is worse than none: nobody believes it when it is
   * right. The branches below are ordered by what is true in this SDK, and
   * the return value reports the object that is actually read.
   *
   * The extra branches are kept defensively — an SDK upgrade that moves the
   * metadata onto a different object must not silently resurrect a dapp that
   * introduces itself to every wallet as https://localhost.
   */
  const repairSignClientMetadata = useCallback((wc) => {
    const { url, icons } = wcPublicMetadata();
    try {
      /* Ordered so `signClient` is the object the engine reads. */
      const signClient = wc?.signer?.client ?? wc?.signer;
      const targets = [
        signClient?.metadata,
        wc?.signer?.metadata,
        wc?.rpc?.metadata
      ].filter(Boolean);
      for (const target of targets) {
        target.url = url;
        target.icons = [...icons];
      }
      return Boolean(targets.length) && signClient?.metadata?.url === url;
    } catch {
      /* non-fatal: fall back to the SDK-derived metadata */
      return false;
    }
  }, []);

  /**
   * Register the WC provider listeners exactly ONCE per provider instance.
   *
   * Every handler is instance-scoped: it checks `wcRef.current === wc` BEFORE
   * touching state, so a STALE provider (the one we replaced during a
   * reconnect, or an init from a previous session restore racing a fresh
   * connect) can never wipe the live connection. The "Trust Wallet
   * disconnects itself a few minutes later" class of bug lives precisely in
   * handlers that don't do this check.
   *
   * accountsChanged policy, per transport:
   *   • injected (EIP-1193): [] means "the user revoked this site" — clear.
   *   • WalletConnect: an empty array is emitted spuriously by some wallets
   *     while they re-derive accounts (Trust does this around chain moves).
   *     It is NOT authoritative — session_delete/session_expire are. So a
   *     transient [] must not tear the session down.
   */
  const attachWcListeners = useCallback((wc) => {
    const onDisconnect = () => {
      wcEvent('disconnect');
      if (wcRef.current !== wc) return;
      disconnectRef.current();
    };
    const onAccountsChanged = (accs) => {
      if (wcRef.current !== wc) return;
      if (accs?.[0]) setAddress(accs[0]);
      /* transient empty accountsChanged on WC: keep the session */
    };
    const onChainChanged = (cid) => {
      if (wcRef.current !== wc) return;
      /* Wallets emit chain ids as numbers, hex strings and CAIP-2 strings
         depending on transport and version; Number('eip155:1') is NaN and a
         NaN chain id silently breaks every balance read downstream. */
      const n = parseChainId(cid);
      if (n == null) return;
      setChainId(n);
      wcEvent('chain_changed', Number(n));
    };
    const onSessionDelete = () => {
      wcEvent('session_delete');
      if (wcRef.current !== wc) return;
      disconnectRef.current();
    };
    const onSessionExpire = () => {
      wcEvent('session_expire');
      if (wcRef.current !== wc) return;
      /* The session really ended at the wallet/relay layer — say so instead
         of quietly reverting to "Connect wallet". */
      try { useAppStore.getState().notify('walletSessionExpired', 'info'); } catch { /* toasts are optional */ }
      disconnectRef.current();
    };
    const onSessionEvent = () => {
      if (wcRef.current !== wc) return;
      wcEvent('session_event');
    };
    const onDisplayUri = () => wcEvent('display_uri');
    const onProposal = () => wcEvent('session_proposal');
    /* A relay drop is transient: TRACE it, never translate it into a session
       teardown. Only session_delete / session_expire / explicit disconnect
       may clear a connection — that is the whole policy. */
    const onRelayConnect = () => wcEvent('relay_connect');
    const onRelayDisconnect = () => wcEvent('relay_disconnect');

    wc.on('disconnect', onDisconnect);
    wc.on('accountsChanged', onAccountsChanged);
    wc.on('chainChanged', onChainChanged);
    wc.on('session_delete', onSessionDelete);
    wc.signer?.client?.on?.('session_expire', onSessionExpire);
    wc.signer?.client?.on?.('session_event', onSessionEvent);
    wc.signer?.client?.on?.('display_uri', onDisplayUri);
    wc.signer?.client?.on?.('session_proposal', onProposal);
    wc.signer?.client?.core?.relayer?.on?.('relayer_connect', onRelayConnect);
    wc.signer?.client?.core?.relayer?.on?.('relayer_disconnect', onRelayDisconnect);

    return () => {
      try { wc.removeListener('disconnect', onDisconnect); } catch { /* noop */ }
      try { wc.removeListener('accountsChanged', onAccountsChanged); } catch { /* noop */ }
      try { wc.removeListener('chainChanged', onChainChanged); } catch { /* noop */ }
      try { wc.removeListener('session_delete', onSessionDelete); } catch { /* noop */ }
      try { wc.signer?.client?.off?.('session_expire', onSessionExpire); } catch { /* noop */ }
      try { wc.signer?.client?.off?.('session_event', onSessionEvent); } catch { /* noop */ }
      try { wc.signer?.client?.off?.('display_uri', onDisplayUri); } catch { /* noop */ }
      try { wc.signer?.client?.off?.('session_proposal', onProposal); } catch { /* noop */ }
      try { wc.signer?.client?.core?.relayer?.off?.('relayer_connect', onRelayConnect); } catch { /* noop */ }
      try { wc.signer?.client?.core?.relayer?.off?.('relayer_disconnect', onRelayDisconnect); } catch { /* noop */ }
    };
  }, []);

  const connectWalletConnect = useCallback(async ({ force = false } = {}) => {
    // Prevent double-init: EthereumProvider.init() creates a new session every
    // time it runs, and rapid double-taps spawned two modals / two pairing URIs.
    if (wcInitingRef.current) return false;
    setError(null);
    setConnecting(true);
    /* Wall clock for the attempt, so the failure the trace records carries how
       long it took: a relay that refuses in 1.5s and one that swallows packets
       for 20s are the same event name and two completely different networks. */
    const startedAt = Date.now();
    wcInitingRef.current = true;
    /* Hold the refresh guard for the WHOLE pairing attempt: a refresh while
       the wallet's approval screen is up would strand the pairing, and a WebView
       reload at that moment is how sessions die before they exist. */
    const connectGuard = holdRefreshGuard('wc-connect');
    let wc;
    /* The window.open bridge installed for this pairing attempt — removed in
       the finally block so a finished attempt cannot rewrite later links. */
    let uninstallWalletBridge = null;
    try {
      const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
      const { BrowserProvider } = await loadEthers();

      /*
       * WALLETCONNECT METADATA — why this is not just window.location.origin:
       * inside the packaged app the origin is https://localhost, which a wallet
       * (a SEPARATE app) cannot fetch, so the request is rejected outright; and
       * an icon URL that 404s is rejected likewise. The canonical URL is built
       * once in buildWcInitConfig() (publicAppUrl), shared by connect AND
       * session restore so the two can never drift.
       */

      // If there's already a connected instance (stale session), remove its
      // listeners BEFORE disconnecting it: the old instance's 'disconnect'
      // event must not be allowed to wipe the NEW state this flow is about
      // to set. Instance-scoped handlers (attachWcListeners) are the second
      // line of defence; removing them first is the deterministic one.
      // The disconnect itself is bounded: a dead relay must never make the
      // next Connect wait on a goodbye message the peer will never receive.
      if (wcRef.current) {
        try { wcListenersRef.current?.cleanup?.(); } catch { /* noop */ }
        wcListenersRef.current = null;
        try { await withTimeout(wcRef.current.disconnect().catch(() => {}), 4_000, 'WC_TEARDOWN_TIMEOUT'); } catch { /* noop */ }
        wcRef.current = null;
      }
      /*
       * EXPLICIT CONNECT = CLEAN SLATE.
       * The SDK's own storage writes are asynchronous, so relying on
       * disconnect() above to have finished clearing the persisted session
       * keys, the AppKit deep-link choice and the recent-wallet keys is a
       * race that periodically loses — and when it loses, init() below
       * resurrects the old session, AppKit answers isConnected() = true and
       * refuses to open the modal, while the stored mobile deep-link still
       * funnels the user into the wallet app with a pairing that no longer
       * exists. Purging the connection keys synchronously, right here, is
       * what makes the next attempt "exactly like the first time" (see
       * lib/wcStorage.js).
       */
      {
        const purged = purgeWcStorage();
        wcEvent('storage_purged', Number(purged));
      }

      // Advisory only: a browser diagnostic must never prevent the actual SDK attempt.
      let relay = null;
      try {
        relay = await getRelayState({
          projectId: WC_PROJECT_ID,
          timeoutMs: RELAY_PREFLIGHT_TIMEOUT_MS,
          force
        });
      } catch { relay = null; }
      if (relay) {
        setWcRelay(relay);
        /* One literal per verdict: the trace audit (test/wc-connect-probe.mjs)
           requires every event name to be a literal in this source, so a
           verdict can never ride into the log as data. The count that rides
           along goes through a lowercase local for the same reason — the audit
           only accepts `Number(<identifier>)`. */
        const opened = Array.isArray(relay.openUrls) ? relay.openUrls.length : 0;
        if (relay.verdict === 'OPEN') wcEvent('relay_preflight_open', Number(opened));
        else if (relay.verdict === 'WS_REFUSED') wcEvent('relay_preflight_ws_refused');
        else if (relay.verdict === 'UNREACHABLE') wcEvent('relay_preflight_unreachable');
        else if (relay.verdict === 'TIMEOUT') wcEvent('relay_preflight_timeout');
        else wcEvent('relay_preflight_unmeasured');
      }

      const relayOrder = Array.isArray(relay?.order) && relay.order.length ? relay.order : WC_RELAY_URLS;
      /*
       * INIT — WITH THE MODAL, AND HONESTLY WITHOUT IT IF IT CANNOT LOAD.
       *
       * `showQrModal: true` makes EthereumProvider `await import(
       * '@reown/appkit/core')` and call `createAppKit()`; when either fails it
       * throws "To use QR modal, please install @reown/appkit package" (read
       * out of the installed @walletconnect/ethereum-provider@2.23.10). That is
       * a SURFACE failure, not a connectivity one, and it must not cost the
       * user the connection: the attempt is retried once without the modal and
       * the app's own pairing sheet (QR + wallet buttons + copyable URI, fed
       * by `display_uri`) takes over. Anything else that init throws is a
       * relay/project failure and is rethrown untouched — retrying those with
       * a different surface would only hide them.
       */
      try {
        wc = await initWcProvider(EthereumProvider, buildWcInitConfig(true), relayOrder);
        wcEvent('init');
      } catch (modalErr) {
        if (!isAppKitModalError(modalErr)) throw modalErr;
        wcEvent('appkit_modal_unavailable');
        wc = await initWcProvider(EthereumProvider, buildWcInitConfig(false), relayOrder);
        wcEvent('init_without_modal');
      }
      /*
       * Which surface owns the pairing from here on. The sheet reads this to
       * withdraw while the SDK modal is up: two stacked modals means two
       * blurred backdrops and two scroll locks, which on the Android WebView
       * composited into the "grey box flickering like a fluorescent tube"
       * report. When there is no modal, the sheet stays and renders the
       * pairing itself.
       */
      setWcModalActive(Boolean(wc?.modal));

      /* populateAppMetadata() overwrite repair — see repairSignClientMetadata(). */
      wcEvent(repairSignClientMetadata(wc) ? 'metadata_repaired' : 'metadata_repair_failed');

      /* Apply deterministic native + fallback wallet metadata before connect()
         opens the modal. Best effort: QR/manual pairing remains available. */
      await applyAppKitWalletLinks(wc);

      /*
       * LAST METRE: own the URL the modal hands to the phone.
       *
       * Native custom schemes preserve `uri=wc:…` better than HTTPS redirect
       * services, but WebViews need a platform escape hatch. The bridge keeps
       * this dapp document alive and passes native + universal + raw URI to the
       * channel-aware opener: Android ACTION_VIEW, browser-native deep link,
       * or Telegram HTTPS fallback. It is installed before connect() opens the
       * modal and always removed in the finally block.
       */
      uninstallWalletBridge = installWalletOpenBridge({
        openWallet: (url, opts) => {
          /*
           * A URL that arrived with HTML-escaped `&`s (`&amp;`) is the
           * «Invalid Url:wc:…» report exactly: a pairing URI that came back
           * from an HTML surface and can never pair as-is. Recorded as its own
           * fact, because it says something different from a rewrite — the
           * damage existed above us, in whatever printed or stored the link.
           * Plain literal calls only: the trace audit reads event names out of
           * this source and must be able to see every one.
           */
          if (opts?.repaired) wcEvent('deeplink_uri_repaired');
          if (opts?.rewritten) wcEvent('deeplink_rewritten');
          else wcEvent('deeplink_opened');
          /* One settle handler for both outcomes, written as plain literal
             calls: the trace audit (test/wc-connect-probe.mjs) reads event
             names out of this source and must be able to see every one. */
          const settled = (ok) => {
            if (!ok) wcEvent('deeplink_open_failed');
          };
          void openWalletLink(url, opts).then(settled, () => settled(false));
        }
      });

      /*
       * init() also loads a persisted session when one is on disk. The purge
       * above should have removed it, but a concurrent tab can still race one
       * back in — and an explicit Connect means a NEW pairing, so a resurrected
       * session must be dropped before it can make AppKit skip the modal.
       */
      if (wc.session) {
        try {
          await withTimeout(
            Promise.resolve(wc.disconnect()).catch(() => {}),
            4_000,
            'WC_PRESESSION_TEARDOWN'
          );
        } catch { /* noop */ }
        wcEvent('stale_session_dropped');
      }

      /*
       * TAKE THE PAIRING URI FROM THE SDK, NOT FROM A MODAL.
       *
       * `display_uri` is the one event the WalletConnect SDK guarantees: it
       * carries the pairing URI as a plain string (UniversalProvider does
       * `this.uri = uri; this.events.emit('display_uri', uri)`, and
       * EthereumProvider re-emits it verbatim). From it the sheet renders a QR
       * of exactly those bytes and one deep link per promoted wallet — so the
       * last metre no longer depends on a wallet-list fetch, a Lit component
       * tree, or a `window.open` interception.
       *
       * Both payload shapes are accepted (string, or `{ uri }`) because the
       * SignClient/UniversalProvider pair has used both across versions; the
       * URI is validated with the same tolerant detector the repair path uses,
       * and `&amp;` damage is fixed BEFORE it can reach a QR or a wallet
       * (test/wc-uri-hygiene-probe.mjs measures why: an escaped URI cannot
       * pair at all).
       */
      wcPairingRef.current = wc;

      /*
       * TWO-PHASE BOUND — "the relay is dead" is not "the user is still
       * walking to their wallet". See WC_PAIRING_TTL_MS in lib/wcTimeout.js
       * for why one flat number here produced this file's worst
       * misdiagnosis: a healthy pairing cut off at 20s reported itself as an
       * unreachable relay, and sent users off to fix a network that was never
       * broken.
       */
      let cancelReject = null;
      let boundReject = null;
      let boundTimer = null;
      const armBound = (ms, code) => {
        clearTimeout(boundTimer);
        boundTimer = setTimeout(() => boundReject?.(new Error(code)), ms);
      };

      const onPairUri = (payload) => {
        const raw = typeof payload === 'string' ? payload : String(payload?.uri || '');
        if (!looksLikePairingUri(raw)) return;
        const uri = repairPairingUri(raw);
        setWcPairUri(uri);
        /* The hand-off authority: wcAppKitPatch reconciles AppKit's own
           `ConnectionController.state.wcUri` — which nothing resets between
           attempts in manualWCControl mode — to THIS uri before any tap is
           turned into a deep link, so a wallet is never opened on a dead
           previous pairing (the "wallet opens, no prompt" report). */
        setLivePairingUri(uri);
        /* The relay has now proven itself: hand the remaining wait to the
           human, bounded by the pairing's own lifetime. */
        armBound(WC_PAIRING_TTL_MS, 'WC_PAIRING_EXPIRED');
        wcEvent('pair_uri_ready');
      };
      wc.on('display_uri', onPairUri);

      /*
       * The cancel switch is raced in as well: the user dismissing our pairing
       * sheet must settle THIS promise immediately. Without it the attempt
       * would sit on the SDK's own wait for the rest of the bound while
       * holding `wcInitingRef`, and the very next tap on Connect would be
       * swallowed by the single-flight guard — which reads exactly like "the
       * button is dead".
       */
      const cancelled = new Promise((_, reject) => { cancelReject = reject; });
      const bound = new Promise((_, reject) => { boundReject = reject; });
      /* A cancel or an expiry that arrives after the race already settled
         rejects a promise nobody is listening to — swallow both here so a
         late event can never surface as an unhandled rejection. */
      cancelled.catch(() => {});
      bound.catch(() => {});
      wcCancelRef.current = () => cancelReject(new Error('WC_USER_CANCELLED'));
      armBound(WC_CONNECT_TIMEOUT_MS, 'WC_CONNECT_TIMEOUT');
      try {
        await Promise.race([wc.connect(), cancelled, bound]);
      } finally {
        clearTimeout(boundTimer);
        wcCancelRef.current = null;
        try { wc.removeListener('display_uri', onPairUri); } catch { /* noop */ }
        setWcPairUri(null);
      }
      wcEvent('session_settled');
      const provider = new BrowserProvider(wc, 'any');
      const signer = await provider.getSigner();

      /*
       * THE CHAIN THE SDK REPORTS IS NOT THE CHAIN THE WALLET IS ON.
       * connect() ends with setChainIds(this.rpc.chains), and rpc.chains is
       * the REQUIRED chain we passed to init() — DEFAULT_CHAIN — no matter
       * which network the wallet approved. Trust connected while on Ethereum
       * therefore reports 56, the Wallet tab filters its asset list to BSC,
       * and the user's WBTC on Ethereum is "missing". Derive the honest chain
       * from the session the wallet actually approved, and align BOTH the
       * React state and the SDK's internal chainId (which tags every RPC
       * request with `eip155:<id>`) — see lib/wcChain.js.
       */
      const sessionChain = chainFromWcSession(wc);
      const cid = sessionChain != null && EVM_CHAINS[sessionChain] ? sessionChain : DEFAULT_CHAIN;
      if (wc.chainId !== cid) {
        try {
          wc.chainId = cid;
          wc.persist?.();
          wcEvent('chain_synced', Number(cid));
        } catch { /* the SDK shape changed — state below is still honest */ }
      }

      // Detach any prior injected listeners (they are for a different provider)
      detachInjectedListeners();
      wcRef.current = wc;
      eip1193Ref.current = wc;
      signerRef.current = signer;
      setMode('wc');
      setAddress(await signer.getAddress());
      setChainId(cid);
      setLocked(false);
      await refreshBalance(await signer.getAddress(), cid);

      /* Instance-scoped, exactly-once listeners — see attachWcListeners(). */
      wcListenersRef.current = { cleanup: attachWcListeners(wc) };
      return true;
    } catch (e) {
      /*
       * Name the failure. Every WalletConnect breakage used to collapse into
       * one generic CONNECT_FAILED string, which is why "Trust bounces back"
       * and "MetaMask says invalid URL" reports arrived with zero context.
       * The SDK's error messages are stable enough to classify:
       *
       *  - "origin not allowed" / 3000-class auth errors: the relay refused
       *    THIS page's origin — the dashboard's Allowed Domains list does not
       *    contain it (inside the APK the origin is https://localhost, which
       *    is why that list must stay empty). Actionable, so say so.
       *  - socket/network errors: the relay is unreachable — some Iranian
       *    ISPs and corporate networks block relay.walletconnect.com.
       *  - "expired": the pairing sat unapproved past its TTL.
       */
      const msg = String(e?.message || '');
      /*
       * WHY THE REASON IS IN THE EVENT NAME.
       *
       * This line used to be a bare `wcEvent('connect_failed')` — so the report
       * that exposed the dead relay carried the single most important fact in
       * the whole flow («the pairing died») with nothing about WHY, and the next
       * investigation started from zero again. The trace contract
       * (lib/wcTrace.js + its audit in test/wc-connect-probe.mjs) forbids string
       * payloads, because a relay-controlled string in a support screenshot is a
       * leak vector. The classification below already exists for `setError`, so
       * each branch now emits its OWN literal name plus the elapsed
       * milliseconds — evidence without ever accepting a foreign string.
       */
      const elapsed = Math.max(0, Math.round(Date.now() - startedAt));
      /*
       * Our own bounded wait fired: the SDK's internal retry loop is still
       * spinning on a relay it cannot reach, but the USER is not left
       * staring at it. Treat exactly like a confirmed-unreachable relay, and
       * make sure the abandoned instance cannot outlive this attempt (see
       * the cleanup block below) — otherwise a retry a moment later would
       * find `wcRef.current` unset but the SDK's own zombie socket and
       * dangling modal still alive underneath it.
       */
      if (
        msg.includes('User rejected') ||
        e?.code === 4001 ||
        /*
         * The AppKit modal was CLOSED mid-pairing (user tapped the dimmed
         * backdrop). The SDK rejects with "Connection request reset. Please
         * try again." — that is a cancellation, not a failure, and presenting
         * it as a red "connection failed" invited exactly the mystified
         * re-taps that made the modal look like it was flickering.
         */
        /connection request reset/i.test(msg) ||
        /*
         * OUR OWN pairing sheet was dismissed (cancelWcPairing). Same class as
         * the two above: a cancellation, not a failure. Naming it here is what
         * stops a Cancel from being reported back as "connection failed" —
         * the mistake that turned one dismiss into a support report.
         */
        msg === 'WC_USER_CANCELLED'
      ) {
        wcEvent('connect_failed_cancel', Number(elapsed));
        setError('USER_REJECTED');
      } else if (/origin not allowed|unauthorized|project id/i.test(msg)) {
        wcEvent('connect_failed_origin', Number(elapsed));
        setError('WC_ORIGIN_BLOCKED');
      } else if (
        /*
         * Our own pairing TTL elapsed while the wallet still had not
         * approved. Named explicitly (and matched before the relay branch)
         * because the honest answer here is "try again", not "your network is
         * blocking the relay" — the relay demonstrably worked, it issued the
         * URI this attempt was showing.
         */
        msg === 'WC_PAIRING_EXPIRED' || /proposal expired|expired/i.test(msg)
      ) {
        wcEvent('connect_failed_expired', Number(elapsed));
        setError('WC_EXPIRED');
      } else if (
        msg === 'WC_CONNECT_TIMEOUT' ||
        msg === 'WC_INIT_TIMEOUT' ||
        /websocket|socket stalled|network|failed to publish|relay|timeout|no internet connection/i.test(msg)
      ) {
        wcEvent('connect_failed_relay', Number(elapsed));
        setError('WC_RELAY_UNREACHABLE');
        /*
         * THE CACHE IS WRONG, OR THE NETWORK JUST CHANGED. Either way the next
         * attempt must MEASURE again instead of being served a verdict that a
         * live failure just contradicted — including the OPEN verdict that let
         * this attempt run at all.
         */
        clearRelayStateCache();
      } else {
        wcEvent('connect_failed_unknown', Number(elapsed));
        setError('CONNECT_FAILED');
      }
      /*
       * Never leave a half-connected instance behind. On a plain rejection
       * the SDK already tore its own state down, but on OUR timeout the
       * SDK's socket is still retrying in the background — closing the
       * modal and disconnecting here prevents that zombie instance from
       * outliving the attempt and confusing the next tap.
       */
      try { wc?.disconnect?.(); } catch { /* already gone, or never finished initialising */ }
      return false;
    } finally {
      try { uninstallWalletBridge?.(); } catch { /* noop */ }
      /*
       * The pairing URI must not outlive the attempt on ANY exit path — the
       * success path (a connected wallet needs no QR), the cancel path, the
       * timeout path. A URI left on screen after the attempt is over is a
       * button that opens a wallet app on a pairing that no longer exists,
       * which is precisely the "invalid deep link" class of report.
       */
      setWcPairUri(null);
      setWcModalActive(false);
      wcPairingRef.current = null;
      wcCancelRef.current = null;
      setConnecting(false);
      wcInitingRef.current = false;
      connectGuard.release();
      /*
       * FORGET THE PAIRING EVERYWHERE, INCLUDING IN APPKIT'S STATE.
       * In manualWCControl mode nothing in the SDK resets
       * `ConnectionController.state.wcUri` when a pairing dies without a
       * session (EthereumProvider.disconnect() only acts on a session), so a
       * stale URI would otherwise survive until the next display_uri and the
       * first tap of the NEXT attempt could open a wallet on the dead
       * pairing. resetAppKitPairingState() clears our live-URI record and
       * calls ConnectionController.resetUri() — both best-effort, never
       * throwing, and irrelevant once a new pairing publishes its own URI.
       */
      void resetAppKitPairingState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachWcListeners, buildWcInitConfig, initWcProvider, repairSignClientMetadata, applyAppKitWalletLinks, detachInjectedListeners, refreshBalance]);

  /**
   * CANCEL AN IN-FLIGHT PAIRING — the button on our own pairing sheet.
   *
   * With the AppKit modal gone there is no backdrop tap to cancel with, so the
   * sheet needs a real control. Two things have to happen, in this order:
   *
   *   1. the connect promise must settle NOW. `UniversalProvider.
   *      abortPairingAttempt()` is a deprecated no-op in 2.23.10 (verified in
   *      the installed dist), so the switch is our own: the promise the
   *      connect flow races against. Settling it releases the
   *      `wcInitingRef` single-flight, so the very next tap can start a fresh
   *      pairing instead of being silently swallowed for up to 20 seconds.
   *   2. the abandoned provider must be torn down, bounded — a relay that is
   *      already unreachable must not make Cancel hang either.
   *
   * Safe to call when nothing is pairing: it is a no-op then.
   */
  const cancelWcPairing = useCallback(async () => {
    const wc = wcPairingRef.current;
    setWcPairUri(null);
    try { wcCancelRef.current?.(new Error('WC_USER_CANCELLED')); } catch { /* noop */ }
    if (!wc) return false;
    try {
      await withTimeout(
        Promise.resolve(wc.disconnect()).catch(() => {}),
        4_000,
        'WC_CANCEL_TEARDOWN'
      );
    } catch { /* a dead relay must never make Cancel hang */ }
    wcEvent('pair_cancelled');
    return true;
  }, []);

  /* ------------------------ WalletConnect session restore ----------------- */

  /**
   * Re-attach a persisted WalletConnect session WITHOUT a new pairing.
   *
   * ─── THE BUG THIS FIXES ────────────────────────────────────────────────
   * init() only ever ran from the Connect button, so anything that restarted
   * the WebView — page refresh, Android killing and resuming the app, a hard
   * refresh after a chunk 404 — left the wallet session in localStorage but
   * the app showing "not connected". Returning to the app looked EXACTLY like
   * "Trust Wallet disconnected me by itself". The disconnect was never sent by
   * the wallet; the app simply never picked the session back up.
   *
   * ─── THE COST DISCIPLINE ───────────────────────────────────────────────
   * EthereumProvider.init() opens a relay WebSocket. Doing that for EVERY
   * visitor (most of whom have never connected a wallet) would spend the
   * project's relay quota on nothing. So localStorage is probed FIRST: the
   * SignClient persists sessions under `wc@2:client:0.3//session`; when that
   * key is absent or empty, restore is a no-op that never touches the
   * network. The probe is a peek at a KEY NAME and an array length — no URI,
   * no topic, no account is read into memory here.
   *
   * Single-flight through the same wcInitingRef as connect(), so a restore
   * and a tap can never race into two SignClients (the double-modal bug).
   *
   * The probe scans KEY NAMES for `wc@2:client:` + `//session` rather than
   * hardcoding the store's schema version (`0.3`): an SDK upgrade that bumps
   * it must not silently turn restore into a permanent no-op. Only key NAMES
   * and an array LENGTH are ever read — never a topic, URI or account.
   */
  const restoreWcSession = useCallback(async ({ announce = false } = {}) => {
    if (typeof window === 'undefined') return false;
    if (wcInitingRef.current || wcRef.current) return false;

    let hasStoredSession = false;
    try {
      const ls = window.localStorage;
      if (!ls) return false;
      for (let i = 0; i < ls.length; i += 1) {
        const key = ls.key(i) || '';
        if (key.startsWith('wc@2:client:') && key.endsWith('//session')) {
          const raw = ls.getItem(key);
          const sessions = raw ? JSON.parse(raw) : null;
          if (Array.isArray(sessions) && sessions.length > 0) {
            hasStoredSession = true;
            break;
          }
        }
      }
    } catch {
      return false; /* storage unavailable or corrupt — fail quiet, do not init */
    }
    if (!hasStoredSession) return false;

    wcInitingRef.current = true;
    let wc;
    try {
      const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
      const { BrowserProvider } = await loadEthers();
      /*
       * Bounded restore with the SAME relay failover as connect(): every
       * init attempt is capped by initWcProvider, and getSigner() below can
       * still round-trip the relay for a session already on disk. On a
       * network blocking the primary relay the fallback is what turns
       * "returning to the app" from a quiet dead session into a restored
       * one; on a network blocking both, it fails quiet within seconds —
       * this path is opportunistic (the explicit Connect button is the real
       * one) and must never stall a resume either way.
       */
      /*
       * NO MODAL ON A SILENT RESTORE. This path is opportunistic — it revives
       * a session already on disk when the app resumes — so building the
       * AppKit instance (a dynamic import of `@reown/appkit/core` plus a
       * `createAppKit()` call) would be weight on first paint for a surface
       * that is never opened. The explicit Connect button is what asks for
       * the modal.
       */

      // Advisory only: a browser diagnostic must never prevent the actual SDK attempt.
      let relay = null;
      try {
        relay = await getRelayState({ projectId: WC_PROJECT_ID, timeoutMs: RELAY_PREFLIGHT_TIMEOUT_MS });
      } catch { relay = null; }
      if (relay) {
        setWcRelay(relay);

      }
      const relayOrder = Array.isArray(relay?.order) && relay.order.length ? relay.order : WC_RELAY_URLS;
      wc = await initWcProvider(EthereumProvider, buildWcInitConfig(false), relayOrder);
      wcEvent(repairSignClientMetadata(wc) ? 'metadata_repaired' : 'metadata_repair_failed');

      /* init() loads persisted sessions internally; if the wallet already
         deleted or expired it, there is nothing to restore. */
      if (!wc.session) {
        wcEvent('restore_none');
        return false;
      }

      const provider = new BrowserProvider(wc, 'any');
      const signer = await withTimeout(provider.getSigner(), WC_CONNECT_TIMEOUT_MS, 'WC_RESTORE_TIMEOUT').catch(() => null);
      if (!signer) {
        try { wc?.disconnect?.(); } catch { /* noop */ }
        return false;
      }

      /*
       * COMMIT GUARD: restore is async, so a wallet attached while it was in
       * flight (the local vault auto-attach runs synchronously on mount) must
       * not be overwritten by a slower session resume. The user's latest
       * explicit choice wins; the resumed provider is torn down instead.
       */
      if (addressRef.current) {
        try { wc?.disconnect?.(); } catch { /* noop */ }
        wcEvent('restore_skipped_local');
        return false;
      }

      /* Same honest-chain resolution as connect() — see lib/wcChain.js. */
      const sessionChain = chainFromWcSession(wc);
      const cid = sessionChain != null && EVM_CHAINS[sessionChain] ? sessionChain : DEFAULT_CHAIN;
      if (wc.chainId !== cid) {
        try {
          wc.chainId = cid;
          wc.persist?.();
          wcEvent('chain_synced', Number(cid));
        } catch { /* SDK shape changed — state below is still honest */ }
      }

      detachInjectedListeners();
      wcRef.current = wc;
      eip1193Ref.current = wc;
      signerRef.current = signer;
      setMode('wc');
      setAddress(await signer.getAddress());
      setChainId(cid);
      setLocked(false);
      /* Exactly-once, instance-scoped — the same contract as connect(). */
      wcListenersRef.current = { cleanup: attachWcListeners(wc) };
      wcEvent('session_restored');
      if (announce) {
        try { useAppStore.getState().notify('walletSessionRestored', 'success'); } catch { /* toasts are optional */ }
      }
      /* Balance must never keep the UI disconnected-looking; run behind. */
      void refreshBalance(await signer.getAddress(), cid);
      return true;
    } catch {
      /* A relay hiccup here must never surface as a connect error — restore
         is opportunistic; the explicit Connect button remains the real path.
         But an abandoned instance (our own timeout fired) must not linger:
         a wcRef never set here, plus a zombie socket left alive underneath,
         is exactly the state that made a LATER explicit Connect look broken
         for reasons nobody could see from the UI. */
      try { if (wcRef.current !== wc) wc?.disconnect?.(); } catch { /* noop */ }
      return false;
    } finally {
      wcInitingRef.current = false;
    }
  }, [attachWcListeners, buildWcInitConfig, initWcProvider, detachInjectedListeners, refreshBalance, repairSignClientMetadata]);

  /*
   * Run restore once on mount, and again whenever the app returns to the
   * FOREGROUND with no wallet attached — the Trust-bounce path: the user taps
   * Connect, Android switches to Trust for the approval, and on return the
   * WebView may have restarted entirely. A fresh relay socket is NOT opened
   * unless a session is actually on disk (see the probe inside).
   */
  useEffect(() => {
    /* A LOCAL VAULT WINS ON COLD START: restore is async while the vault
       auto-attach is synchronous, so without this skip the slower resume
       would overwrite the vault. The stored WC session is left on disk, and
       the commit guard inside restoreWcSession() backstops the foreground
       path. */
    /* The WalletConnect half of a return, in ONE place: a wedged instance (it
       exists without an account, which is what a page frozen mid-pairing
       leaves behind) is released first, then the persisted session is probed. */
    const resumeWc = (announce) => {
      if (wcRef.current && !wcInitingRef.current) {
        void releaseWc(false).then(() => restoreWcSession({ announce }));
        return;
      }
      void restoreWcSession({ announce });
    };

    /*
     * The email half, + THE ONE WAY IT IS ALLOWED TO HAND OVER.
     *
     * Email/social and WalletConnect restores stay mutually gated: a user
     * whose LAST connection was email must not have an older wc session
     * restored ON TOP of it, so nothing else runs while the marker stands.
     *
     * But the marker must not be able to STARVE WalletConnect either. There is
     * exactly one case where AppKit has spoken: rollbackEmailSocialMarker()
     * found no session and DELETED the marker. Then the claim is dead, the
     * stored `wc@2:` session — if one exists — is the user's real wallet, and
     * this pass probes it. A marker still standing means AppKit could not
     * answer (its frame is blocked or slow, so the session inside may yet be
     * live): no other wallet may preempt that, and the next foreground return
     * asks again — which is the difference between «one slow boot» and «the
     * wallet is gone forever».
     */
    const resumeEmailThenWc = (announce) => {
      void restoreEmailSocial().then((ok) => {
        if (ok || addressRef.current || hasEmailSocialMarker()) return;
        resumeWc(announce);
      });
    };

    // ── ORPHANED STORAGE HYGIENE: the report that arrived carried 5 appkit keys with 0 sessions.
    // A stale WALLETCONNECT_DEEPLINK_CHOICE or @appkit/recent_wallet makes the NEXT connect
    // skip the modal and open a wallet app with a dead pairing — so an idle cold start that
    // has nowhere to restore can clean the residue it can prove is dead. Vault-agnostic
    // (fbt:vault never uses @appkit/* keys) but email-guarded: when fbt_email_social_connected
    // stands, those @appkit/* keys belong to the email AppKit instance that just booted
    // (getEmailSocialAppKit) and must not be churned — purge would delete them and the
    // restore would recreate them, pinning the count at 4 forever (observed 5→4→4).
    // @appkit-wallet/* is a separate prefix and is never purged here in any case.
    try {
      const facts = storageFacts();
      if (facts.orphanKeys && !hasEmailSocialMarker() && !addressRef.current) {
        const purged = purgeWcStorage();
        if (purged) wcEvent('orphan_storage_purged', Number(purged));
      }
    } catch { /* storage check is advisory */ }

    if (!loadVault()) {
      if (hasEmailSocialMarker()) resumeEmailThenWc(false);
      else resumeWc(false);
    } else if (hasEmailSocialMarker()) {
      /*
       * THE EMPTY-TRACE REPORT, NAMED. A local vault wins the cold start by
       * design — but when an email marker ALSO stands, the skip used to be
       * completely silent: no restore ran, no event was recorded, and the
       * next health report arrived with `trace: []` + `ourMarker: true` +
       * `sdkLoginMarker: false`, which reads exactly like "the app did
       * nothing at all". One literal event makes that state visible in the
       * very next diagnostic, without changing the vault-first rule.
       */
      wcEvent('restore_skipped_vault');
    }
    /*
     * ─── COMING BACK TO A PAGE THAT WAS NEVER UNLOADED ─────────────────────
     *
     * The mount path above only runs for a FRESH document. Every mobile return
     * in this app's two flows can instead resume the SAME document:
     *
     *   • the APK's WebView never reloads when the user leaves for Trust and
     *     comes back — `visibilitychange` is the only signal it gets;
     *   • iOS Safari (and Chrome's back/forward cache) RESTORE a frozen page
     *     on return, which fires `pageshow` with `persisted === true` and no
     *     mount at all — so the email redirect return and the wallet bounce
     *     could both land on a page whose effects never re-ran;
     *   • while frozen, the relay socket the pairing was waiting on is closed
     *     by the browser, so "the promise will settle by itself" is not a
     *     property the page can rely on.
     *
     * Two narrow rules, both idempotent and both silent on failure:
     *   1. an email marker with no attached account means a login was started
     *      (possibly one page ago, in a storage that survives) — ask AppKit
     *      again, bounded by EMAIL_RESTORE_WINDOW_MS and single-flighted;
     *   2. a WalletConnect instance that exists WITHOUT an account is a wedged
     *      attempt (frozen mid-pairing). Its socket died with the freeze, so
     *      it is released and the persisted session is probed afresh — the
     *      session key on disk is what the wallet's approval actually wrote.
     */
    const onReturn = (announce) => {
      if (addressRef.current) return;
      if (hasEmailSocialMarker()) {
        resumeEmailThenWc(announce);
        return;
      }
      resumeWc(announce);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onReturn(true);
    };
    const onPageShow = (event) => {
      /* The initial load fires this too (persisted === false) — the mount path
         above already owns that one. */
      if (event?.persisted) onReturn(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ local vault ---------------------------- */

  /**
   * Tear down a live WalletConnect provider WITHOUT touching wallet state:
   * detach its listeners, tell the peer the session is over (bounded — a
   * dead relay must never stall a mode switch), and purge the SDK/AppKit
   * connection artifacts so the next init starts from a clean slate.
   * Fire-and-forget friendly: every await inside is bounded, and the
   * instance-scoped listener checks mean a late 'disconnect' event from the
   * dying instance can never wipe the state the caller is about to set.
   */
  const releaseWc = useCallback(async (purge = true) => {
    try { wcListenersRef.current?.cleanup?.(); } catch { /* noop */ }
    wcListenersRef.current = null;
    const wc = wcRef.current;
    wcRef.current = null;
    if (wc) {
      try {
        await withTimeout(
          Promise.resolve(wc.disconnect?.()).catch(() => {}),
          4_000,
          'WC_TEARDOWN_TIMEOUT'
        );
      } catch { /* the peer may already be gone */ }
    }
    if (purge) {
      try {
        const purged = purgeWcStorage();
        wcEvent('storage_purged', Number(purged));
      } catch { /* storage unavailable — nothing to purge */ }
      try { setTimeout(() => { try { purgeWcStorage(); } catch {} }, 700); } catch {}
      try { clearRelayStateCache(); } catch { /* noop */ }
    }
  }, []);

  /** Attach a locally-stored wallet in LOCKED state (address only, no signer). */
  const attachLocal = useCallback(() => {
    const vault = loadVault();
    if (!vault) return false;
    const cid = localTargetChain();
    setMode('local');
    setAddress(vault.address);
    setChainId(cid);
    setLocked(true);
    signerRef.current = null;
    eip1193Ref.current = null;
    refreshBalance(vault.address, cid);
    return true;
  }, [refreshBalance, localTargetChain]);

  /**
   * Attach the memory-only signer returned while a new vault was encrypted.
   * This avoids immediately decrypting that just-written vault (and therefore
   * avoids a second PBKDF2 pass) while still checking it matches disk state.
   */
  const attachCreatedLocal = useCallback(
    async (createdSigner) => {
      const vault = loadVault();
      if (!vault || !createdSigner) return false;
      const cid = localTargetChain();
      try {
        const signerAddress = createdSigner.address || await createdSigner.getAddress();
        if (signerAddress.toLowerCase() !== vault.address.toLowerCase()) return false;
        const provider = await getReadProvider(cid);
        const signer = createdSigner.provider ? createdSigner : createdSigner.connect(provider);
        /*
         * Only after the vault has PROVED it matches disk state: entering
         * local mode is an explicit mode switch, so a live WalletConnect
         * session must be torn down here — otherwise its still-attached
         * listeners keep updating address/chain state and the UI flips back
         * and forth between the WC account and the new vault. A failed
         * attach must NOT tear anything down (the failure path changes no
         * mode). Fire-and-forget: the teardown is bounded and can never
         * overwrite the state being set below.
         */
        void releaseWc();
        signerRef.current = signer;
        eip1193Ref.current = createLocalEip1193Adapter({ signer, account: signerAddress, chainId: cid, getReadProvider });
        setMode('local');
        setAddress(signerAddress);
        setChainId(cid);
        setLocked(false);
        setError(null);
        // Balance RPC latency must not hold the creation sheet open.
        void refreshBalance(signerAddress, cid);
        return true;
      } catch {
        setError('UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, refreshBalance, releaseWc, localTargetChain]
  );

  const unlockLocal = useCallback(
    async (password) => {
      setError(null);
      /*
       * The network the user had selected, not a hard-coded default. The
       * signer is connected to this chain's RPC below, so a send issued right
       * after unlock goes to the chain the screen says it goes to — before
       * this, unlocking snapped the app back to DEFAULT_CHAIN and the balance
       * on screen was a different network's than the one just chosen.
       */
      const cid = localTargetChain();
      try {
        const provider = await getReadProvider(cid);
        const signer = await unlockVault(password, provider);
        /* Same mode-switch teardown as attachCreatedLocal() — and only AFTER
           the password has proven correct: a BAD_PASSWORD must leave an
           existing WalletConnect connection exactly as it was. */
        void releaseWc();
        signerRef.current = signer;
        eip1193Ref.current = createLocalEip1193Adapter({ signer, account: signer.address, chainId: cid, getReadProvider });
        setMode('local');
        setAddress(signer.address);
        setChainId(cid);
        setLocked(false);
        // Unlock succeeds as soon as signing is ready; slow mobile RPC runs behind it.
        void refreshBalance(signer.address, cid);
        return true;
      } catch (e) {
        setError(e.message === 'BAD_PASSWORD' ? 'BAD_PASSWORD' : 'UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, refreshBalance, releaseWc, localTargetChain]
  );

  /** Drop the in-memory signer but keep the encrypted vault on disk. */
  const lock = useCallback(() => {
    signerRef.current = null;
    setLocked(true);
  }, []);

  /**
   * Delete the encrypted vault AND release every live connection.
   *
   * The old implementation cleared signerRef/mode/address/locked/nativeBalance
   * and left everything WalletConnect-shaped alone — so a WC session (or a
   * half-finished pairing) that predated the local wallet kept its refs, its
   * listeners and its localStorage artifacts, and the next Connect walked
   * straight into them. Delegating to disconnect() makes "forget the in-app
   * wallet" and "disconnect" leave the EXACT same clean slate, so the next
   * WalletConnect attempt behaves like the very first one.
   */
  const forgetLocalWallet = useCallback(() => {
    clearVault();
    disconnectRef.current();
  }, []);

  /* ------------------------------ disconnect ----------------------------- */

  const disconnect = useCallback(() => {
    wcEvent('local_disconnect');
    // Clean up WalletConnect session listeners first, then tell the peer the
    // session is over (bounded: a dead relay must never stall the UI) and
    // purge the SDK/AppKit storage artifacts — the stored deep-link choice,
    // the recent-wallet keys and the persisted session are exactly the
    // residue that made a later Connect skip the modal and open a wallet app
    // with a dead pairing. See releaseWc()/lib/wcStorage.js.
    try { wcListenersRef.current?.cleanup?.(); } catch { /* noop */ }
    wcListenersRef.current = null;
    const wc = wcRef.current;
    wcRef.current = null;
    if (wc) {
      withTimeout(Promise.resolve(wc.disconnect?.()).catch(() => {}), 4_000, 'WC_TEARDOWN_TIMEOUT')
        .catch(() => { /* fire-and-forget; the purge below is synchronous */ });
    }
    try { purgeWcStorage(); } catch { /* storage unavailable */ }
    // The SDK's wc.disconnect() writes its storage ASYNCHRONOUSLY; a late
    // write can resurrect @appkit/* keys after the synchronous purge above,
    // leaving 2 orphan keys that the health panel then reports as orphan:true
    // until the next cold-start purge. A delayed second purge catches that
    // window without blocking the UI (observed 2 keys after local_disconnect).
    try { setTimeout(() => { try { purgeWcStorage(); } catch {} }, 700); } catch {}
    try { clearRelayStateCache(); } catch { /* noop */ }
    /* An email/social session ends in the same pass: forget the boot marker
       and tell AppKit (bounded — see lib/emailSocialWallet.js). Without it,
       tomorrow's cold start would resurrect the very logout the user just
       performed, and the one-wallet-at-a-time rule in connectEmailSocial()
       would inherit a ghost. */
    try { void clearEmailSocialSession(); } catch { /* noop */ }
    // Clean up injected listeners
    detachInjectedListeners();
    eip1193Ref.current = null;
    signerRef.current = null;
    setMode(null);
    setInjectedInfo(null);
    setAddress(null);
    setChainId(null);
    setNativeBalance(null);
    setLocked(false);
    setError(null);
  }, [detachInjectedListeners]);

  // Keep the forwarding ref current so listener callbacks (registered before
  // `disconnect` is defined) always invoke the latest implementation.
  disconnectRef.current = disconnect;

  /* --------------------------- network switching ------------------------- */

  const switchChain = useCallback(async (targetId) => {
    const cfg = EVM_CHAINS[targetId];
    if (!cfg) return false;
    const eip = eip1193Ref.current;
    if (!eip || mode === 'local') {
      /*
       * A local ethers Wallet is connected to a concrete Provider. Merely
       * changing the React chain label leaves the signer broadcasting to the
       * old network — catastrophic for a same-address contract call. Reconnect
       * the in-memory signer to the target RPC before reporting success, then
       * refresh the local EIP-1193 adapter so Intent AI keeps seeing a real
       * connected signer.
       */
      if (signerRef.current?.connect) {
        signerRef.current = signerRef.current.connect(await getReadProvider(targetId));
        eip1193Ref.current = createLocalEip1193Adapter({ signer: signerRef.current, account: addressRef.current, chainId: targetId, getReadProvider });
      }
      setChainId(targetId);
      return true;
    }
    try {
      await eip.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.hexId }] });
      // chainChanged event will fire; let it update chainId rather than racing it
      return true;
    } catch (e) {
      const code = e?.code ?? e?.error?.code;
      if (code === 4902) {
        // Chain missing: propose adding it. Validate metadata from our own
        // registry — never accept client-supplied RPC/explorer URLs.
        try {
          await eip.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: cfg.hexId,
                chainName: cfg.name,
                nativeCurrency: {
                  name: cfg.native.symbol,
                  symbol: cfg.native.symbol,
                  decimals: cfg.native.decimals
                },
                rpcUrls: cfg.rpc,
                blockExplorerUrls: [cfg.explorer]
              }
            ]
          });
          return true;
        } catch (addErr) {
          return false;
        }
      }
      // 4001 = user rejected; -32002 = request already pending; both non-fatal
      return false;
    }
  }, [getReadProvider, mode]);

  /* ------------------------------ auto-attach ---------------------------- */

  useEffect(() => {
    if (!address && loadVault()) attachLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Attaching any OTHER wallet mode retires the email/social boot marker.
   * Otherwise the next cold start would resurrect the email wallet and
   * overwrite the very connection the user just chose. 'email' itself is
   * excluded — its marker is the one this transition is claiming (written at
   * the start of connectEmailSocial(), re-written inside
   * attachEmailProvider()), so clearing it here would erase the very fix.
   */
  useEffect(() => {
    if (mode && mode !== 'email') void clearEmailSocialSession().catch(() => {});
  }, [mode]);

  /*
   * ─── THE "CONNECT YOUR WALLET" QUEST, FIRED WHERE IT ACTUALLY HAPPENS ────
   * The Earn screen advertises "+100, connect your wallet" and nothing marked
   * it done. There are THREE ways to arrive connected — injected, WalletConnect
   * and the built-in vault — so putting the call in one of them would quietly
   * pay only a third of users.
   *
   * Watching `address` covers all three, including the auto-attach above,
   * which is the path a returning user takes without pressing anything.
   * `completeQuest` is idempotent, so re-renders and reconnects cannot pay
   * twice.
   */
  useEffect(() => {
    if (address) useAppStore.getState().completeQuest('connectWallet');
  }, [address]);

  /*
   * FBT Rewards: the reporter learns the connected EVM account so every
   * activity event carries wallet + chain evidence for on-chain verification.
   * (Solana connects through its own wallet layer and is followed inside the
   * reporter via the wallet-change event.)
   */
  useEffect(() => {
    bindRewardsIdentity({ evm: address || null, chainId: chainId ?? null });
  }, [address, chainId]);

  // Injected listeners are attached in connectInjected() via attachInjectedListeners()
  // and removed in disconnect() via detachInjectedListeners(). No duplicate effect here.

  // periodic balance refresh while connected
  useEffect(() => {
    if (!address) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshBalance();
    }, 30000);
    return () => clearInterval(id);
  }, [address, refreshBalance]);

  /*
   * Soft refresh: the header button re-reads the native balance through the
   * SAME refreshBalance the interval uses. Nothing is remounted and,
   * crucially, the WalletConnect session is not touched — verifying that
   * property is why this is a subscription rather than a reload.
   *
   * If no wallet is attached at all, try the session restore once instead —
   * the same thing the foreground watcher does.
   */
  useEffect(() => {
    const off = onSoftRefresh(() =>
      addressRef.current ? refreshBalance() : restoreWcSession({ announce: true })
    );
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Injected listeners are attached in connectInjected() via attachInjectedListeners()
  // and removed in disconnect() via detachInjectedListeners(). No duplicate effect here.

  const value = useMemo(
    () => ({
      mode,
      injectedInfo,
      address,
      chainId: chainId ?? DEFAULT_CHAIN,
      chain,
      chainOk: Boolean(chainId && EVM_CHAINS[chainId]),
      nativeBalance,
      connecting,
      error,
      locked,
      isConnected: Boolean(address) && !locked,
      hasLocalVault: Boolean(loadVault()),
      connectInjected,
      connectWalletConnect,
      /* Email & Social login (Reown AppKit embedded wallet): same attach
         contract as the injected path, mode 'email'. */
      connectEmailSocial,
      emailModalActive,
      /*
       * The pairing surface: the URI the SDK issued for the in-flight attempt
       * (null when there is none), which surface currently owns the screen,
       * and the control that ends the attempt. The sheet renders the QR and
       * the wallet buttons from that one string, and withdraws while
       * `wcModalActive` so two modals never stack.
       */
      wcPairUri,
      wcModalActive,
      /*
       * THE MEASURED RELAY, FOR THE SCREEN THAT OFFERS THE ROUTE.
       * `wcRelay` is the whole preflight state (verdict + per-host facts + the
       * try order it produced); `wcRelayBlocked` is the one question the sheet
       * asks before presenting WalletConnect pairing as an option. Keeping the
       * decision in the context (and not re-probing in the component) is what
       * makes the connect flow and the UI read the SAME measurement — the
       * health panel prints it too, so the three surfaces cannot disagree.
       */
      wcRelay,
      wcRelayBlocked,
      /* The WalletConnect project id, exposed so the sheet can build the same
         explorer logo URLs the modal uses (lib/wcWallets.js `walletLogo`)
         without a second copy of the id living in a component. */
      wcProjectId: WC_PROJECT_ID,
      cancelWcPairing,
      restoreWcSession,
      attachLocal,
      attachCreatedLocal,
      unlockLocal,
      lock,
      forgetLocalWallet,
      disconnect,
      switchChain,
      refreshBalance,
      getReadProvider,
      getReadProviders,
      getSigner: () => signerRef.current,
      /*
       * Phase 51 — the Intent AI execution path needs the RAW EIP-1193
       * provider, not an ethers wrapper: it asks the connected wallet to sign
       * the locked terms itself. Returning null (rather than a stand-in) is
       * what keeps `venueHealth` honest when nothing is connected.
       */
      getEip1193Provider: () => eip1193Ref.current || null,
      getWalletRuntime: () => ({
        provider: eip1193Ref.current || null,
        account: address || null,
        chainId: chainId ?? DEFAULT_CHAIN,
        connected: Boolean(address) && !locked && Boolean(eip1193Ref.current)
      }),
      clearError: () => setError(null)
    }),
    [
      mode,
      injectedInfo,
      address,
      chainId,
      chain,
      nativeBalance,
      connecting,
      error,
      locked,
      connectInjected,
      connectWalletConnect,
      connectEmailSocial,
      emailModalActive,
      wcPairUri,
      wcModalActive,
      wcRelay,
      wcRelayBlocked,
      cancelWcPairing,
      restoreWcSession,
      attachLocal,
      attachCreatedLocal,
      unlockLocal,
      lock,
      forgetLocalWallet,
      disconnect,
      switchChain,
      refreshBalance,
      getReadProvider,
      getReadProviders
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext) ?? {};

export const shortAddress = (a, size = 4) => (a ? `${a.slice(0, 2 + size)}…${a.slice(-size)}` : '');
