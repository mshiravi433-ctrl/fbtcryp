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
  withTimeout,
  WC_PRIMARY_RELAY_TIMEOUT_MS,
  WC_RELAY_URLS,
  isRelayClassError
} from '../lib/wcTimeout';
import { purgeWcStorage } from '../lib/wcStorage';
import { chainFromWcSession, parseChainId } from '../lib/wcChain';

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
 * Registered at dashboard.reown.com for https://fbtswap.ir,
 * https://localhost and the Android app ID ir.fbtswap.app.
 */
const WC_PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20';

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
 * Naming the failure is not fixing it. WalletConnect operates a second
 * relay hostname (`relay.walletconnect.org`) officially documented as the
 * answer to \"the default relay endpoint is blocked\" (docs.reown.com FAQ).
 * `initWcProvider()` below walks WC_RELAY_URLS: primary gets an 8s fuse,
 * the fallback gets the full budget. On an SNI/DNS-filtered network (the
 * shape Iranian ISP blocking actually takes) pairing now SUCCEEDS via the
 * fallback instead of only failing politely — and a network that blocks
 * both hostnames still lands on the same named error, sooner than before.
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
  const wcListenersRef = useRef(null);
  const injectedListenersRef = useRef(null);
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
      : providers[0].provider;
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
  const buildWcInitConfig = useCallback(() => {
    /* One canonical identity for every wallet prompt. publicAppUrl rejects
       the retired lawpoetics.ir env value; using the runtime origin here
       made Solana and EVM prompts disagree about which site was connecting. */
    const publicUrl = publicAppUrl('/').replace(/\/$/, '');
    const ios = isIOSDevice();
    return {
      projectId: WC_PROJECT_ID,
      chains: [DEFAULT_CHAIN],
      optionalChains: Object.keys(EVM_CHAINS).map(Number),
      showQrModal: true,
      /* MOBILE: on a phone the wallet is another app on the SAME device, so
         there is no second screen to point a camera at. The modal therefore
         renders quick "open this wallet" buttons that deep-link into each
         wallet app; the QR code stays as the fallback for a second device. */
      optionalMethods: ['eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
      qrModalOptions: {
        themeMode: 'dark',
        enableExplorer: true,
        explorerExcludedWalletIds: 'ALL',
        explorerRecommendedWalletIds: [
          'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
          '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust
          '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
          'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase Wallet
          '19177a98252e07ddfc9af2083ba8e07ef627cb6103467ffebb3f8f4205fd7927'  // Ledger Live
        ],
        /*
         * ON EVERY MOBILE PLATFORM, NOT JUST iOS: give the modal the exact
         * native + universal links for the wallets we surface, so tapping
         * one opens that wallet directly instead of depending on
         * `api.web3modal.org` to resolve a deep link at pairing time.
         *
         * ─── WHY THIS WAS iOS-ONLY AND WHY THAT WAS WRONG ────────────────
         * Without an explicit `mobileWallets` entry, the modal falls back to
         * fetching wallet metadata (including its deep-link template) from
         * the WalletConnect explorer API. That is a THIRD-PARTY network
         * dependency sitting directly in the connect path — reachable most
         * places, but Iranian mobile networks that filter WalletConnect's
         * infrastructure can filter this alongside the relay. The reported
         * "sometimes the wallet list appears but tapping Trust/MetaMask does
         * nothing" is exactly this failure mode: the LIST can render from a
         * cached/partial response while the actual deep-link template never
         * arrives, so the tap has nothing to open.
         *
         * Supplying the links ourselves removes that dependency entirely for
         * the three wallets we actually promote — the tap works even if
         * every WalletConnect-operated API (not just the relay) is blocked.
         * `explorerExcludedWalletIds: 'ALL'` already means nothing else is
         * offered, so this list is exhaustive for what a user can pick.
         */
        mobileWallets: [
          {
            id: 'metamask',
            name: 'MetaMask',
            links: {
              native: 'metamask://',
              universal: 'https://metamask.app.link/'
            }
          },
          {
            id: 'trust',
            name: 'Trust Wallet',
            links: {
              native: 'trust://',
              universal: 'https://link.trustwallet.com/'
            }
          },
          {
            id: 'rainbow',
            name: 'Rainbow',
            links: {
              native: 'rainbow://',
              universal: 'https://rnbwapp.com/'
            }
          }
        ]
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
   * Initialise an EthereumProvider against the first reachable relay.
   *
   * ─── WHY THIS EXISTS ────────────────────────────────────────────────────
   * `EthereumProvider.init()` opens the relay WebSocket itself — and it was
   * the one WalletConnect await with NO outer bound: `wc.connect()` had
   * withTimeout, init() did not, so on a network blocking
   * relay.walletconnect.com the "bounded" connect could still stall at
   * 60-90s inside the SDK's own retry loop before our timer ever started.
   * (Verified in this codebase's own incident history: the relay socket
   * opens during SignClient → Core start, i.e. inside init().)
   *
   * ─── WHAT IT DOES ───────────────────────────────────────────────────────
   * Walks WC_RELAY_URLS (lib/wcTimeout.js documents why the list exists):
   * the PRIMARY relay gets WC_PRIMARY_RELAY_TIMEOUT_MS (8s), the FALLBACK
   * gets WC_CONNECT_TIMEOUT_MS (20s). Fallback only retries relay-class
   * failures — a user cancel or an origin/project rejection is rethrown
   * at once (relay-switching cannot fix those; isRelayClassError() keeps
   * them out).
   *
   * ─── ORPHAN CLEANUP ─────────────────────────────────────────────────────
   * withTimeout abandons — it cannot cancel — the in-flight init(). If that
   * abandoned promise resolves LATER (the network recovered mid-attempt),
   * a live provider with a zombie socket would be left that no ref points
   * at: the exact state this context keeps exorcising. Any attempt we did
   * not await to completion is disconnected the moment it settles.
   *
   * Shared by connect() AND restore() so the two paths can never disagree
   * about which relay a revived session talks to — the same byte-identical
   * init contract buildWcInitConfig() already guarantees.
   */
  const initWcProvider = useCallback(async (EthereumProvider, baseConfig) => {
    let lastError = null;
    for (let i = 0; i < WC_RELAY_URLS.length; i += 1) {
      const isLast = i === WC_RELAY_URLS.length - 1;
      const budget = isLast ? WC_CONNECT_TIMEOUT_MS : WC_PRIMARY_RELAY_TIMEOUT_MS;
      wcEvent(i ? 'relay_fallback_try' : 'relay_try', Number(i));
      let orphaned = true;
      try {
        const attempt = Promise.resolve(
          EthereumProvider.init({ ...baseConfig, relayUrl: WC_RELAY_URLS[i] })
        );
        attempt.then((ghost) => {
          if (orphaned) {
            try { ghost?.disconnect?.(); } catch { /* zombie nothing-op */ }
          }
        }, () => { /* a late REJECTION needs no cleanup — nothing opened */ });
        // eslint-disable-next-line no-await-in-loop -- sequential failover is the point
        const wcInstance = await withTimeout(attempt, budget, 'WC_INIT_TIMEOUT');
        orphaned = false;
        wcEvent(i ? 'relay_fallback_ok' : 'relay_ok', Number(i));
        return wcInstance;
      } catch (e) {
        lastError = e;
        wcEvent(i ? 'relay_fallback_failed' : 'relay_failed', Number(i));
        if (!isLast && isRelayClassError(e)) continue;
        throw e;
      }
    }
    throw lastError; /* unreachable (the last attempt always throws), but explicit */
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
   * ─── WHY THE OLD REPAIR DID NOTHING ──────────────────────────────────────
   * It mutated `wc.signer.client.metadata`. Verified against the installed
   * @walletconnect/sign-client@2.23.10: the SignClient stores its metadata on
   * ITSELF (`this.metadata = populateAppMetadata(...)` in the constructor) and
   * the engine serializes the proposal from `this.client.metadata` where
   * `this.client` is the SIGN CLIENT, not the Core — `wc.signer.client` is the
   * Core, which has NO `metadata` property at all. The guard
   * `if (signClient?.metadata)` therefore never fired: the "repair" was a
   * silent no-op and every session proposed from the APK still carried
   * `https://localhost` as the dapp identity.
   *
   * The Core branch is kept defensively (an SDK upgrade that moves metadata
   * back onto the Core must not resurrect the bug), and the result is
   * verified and traced so a future SDK shape change fails LOUDLY in the
   * event trace instead of silently in front of the user.
   */
  const repairSignClientMetadata = useCallback((wc) => {
    const publicUrl = publicAppUrl('/').replace(/\/$/, '');
    try {
      const signClient = wc?.signer;
      if (signClient?.metadata) {
        signClient.metadata.url = publicUrl;
        signClient.metadata.icons = [`${publicUrl}/icon-512.png`];
      }
      if (wc?.signer?.client?.metadata) {
        wc.signer.client.metadata.url = publicUrl;
        wc.signer.client.metadata.icons = [`${publicUrl}/icon-512.png`];
      }
      return signClient?.metadata?.url === publicUrl;
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

  const connectWalletConnect = useCallback(async () => {
    // Prevent double-init: EthereumProvider.init() creates a new session every
    // time it runs, and rapid double-taps spawned two modals / two pairing URIs.
    if (wcInitingRef.current) return false;
    setError(null);
    setConnecting(true);
    wcInitingRef.current = true;
    /* Hold the refresh guard for the WHOLE pairing attempt: a refresh while
       the wallet's approval screen is up would strand the pairing, and a WebView
       reload at that moment is how sessions die before they exist. */
    const connectGuard = holdRefreshGuard('wc-connect');
    let wc;
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
      wc = await initWcProvider(EthereumProvider, buildWcInitConfig());
      wcEvent('init');

      /* populateAppMetadata() overwrite repair — see repairSignClientMetadata(). */
      wcEvent(repairSignClientMetadata(wc) ? 'metadata_repaired' : 'metadata_repair_failed');

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
       * Mobile deep links are handled by the WalletConnect modal itself
       * (showQrModal: true). It builds the correct `metamask://wc` /
       * `trust://wc` native links — and their https universal-link equivalents
       * — and encodes the pairing URI exactly once.
       *
       * A previous version ALSO registered a display_uri handler that, on iOS,
       * hard-navigated the page to metamask.app.link. That did two harmful
       * things: it forced every iOS user into MetaMask (so Trust and Rainbow
       * could never be selected), and it navigated the browser away
       * mid-pairing, dropping the in-memory client. Let the modal own deep
       * links on every platform instead.
       */
      /*
       * Bounded wait — see WC_CONNECT_TIMEOUT_MS above. This is what turns an
       * unreachable relay from "spins forever" into a named, actionable
       * failure the user can act on (switch network / VPN) within seconds
       * rather than minutes.
       */
      await withTimeout(wc.connect(), WC_CONNECT_TIMEOUT_MS, 'WC_CONNECT_TIMEOUT');
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
      wcEvent('connect_failed');
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
        /connection request reset/i.test(msg)
      ) {
        setError('USER_REJECTED');
      } else if (/origin not allowed|unauthorized|project id/i.test(msg)) {
        setError('WC_ORIGIN_BLOCKED');
      } else if (/proposal expired|expired/i.test(msg)) {
        setError('WC_EXPIRED');
      } else if (
        msg === 'WC_CONNECT_TIMEOUT' ||
        msg === 'WC_INIT_TIMEOUT' ||
        /websocket|socket stalled|network|failed to publish|relay|timeout|no internet connection/i.test(msg)
      ) {
        setError('WC_RELAY_UNREACHABLE');
      } else {
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
      setConnecting(false);
      wcInitingRef.current = false;
      connectGuard.release();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachWcListeners, buildWcInitConfig, initWcProvider, repairSignClientMetadata, detachInjectedListeners, refreshBalance]);

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
      wc = await initWcProvider(EthereumProvider, buildWcInitConfig());
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
    if (!loadVault()) {
      /* Quiet on cold start — the announce variant belongs to the two
         user-visible moments: returning from the wallet app, and Refresh. */
      void restoreWcSession({ announce: false });
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !addressRef.current) {
        void restoreWcSession({ announce: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
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
    }
  }, []);

  /** Attach a locally-stored wallet in LOCKED state (address only, no signer). */
  const attachLocal = useCallback(() => {
    const vault = loadVault();
    if (!vault) return false;
    setMode('local');
    setAddress(vault.address);
    setChainId(DEFAULT_CHAIN);
    setLocked(true);
    signerRef.current = null;
    eip1193Ref.current = null;
    refreshBalance(vault.address, DEFAULT_CHAIN);
    return true;
  }, [refreshBalance]);

  /**
   * Attach the memory-only signer returned while a new vault was encrypted.
   * This avoids immediately decrypting that just-written vault (and therefore
   * avoids a second PBKDF2 pass) while still checking it matches disk state.
   */
  const attachCreatedLocal = useCallback(
    async (createdSigner) => {
      const vault = loadVault();
      if (!vault || !createdSigner) return false;
      try {
        const signerAddress = createdSigner.address || await createdSigner.getAddress();
        if (signerAddress.toLowerCase() !== vault.address.toLowerCase()) return false;
        const provider = await getReadProvider(DEFAULT_CHAIN);
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
        eip1193Ref.current = createLocalEip1193Adapter({ signer, account: signerAddress, chainId: DEFAULT_CHAIN, getReadProvider });
        setMode('local');
        setAddress(signerAddress);
        setChainId(DEFAULT_CHAIN);
        setLocked(false);
        setError(null);
        // Balance RPC latency must not hold the creation sheet open.
        void refreshBalance(signerAddress, DEFAULT_CHAIN);
        return true;
      } catch {
        setError('UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, refreshBalance, releaseWc]
  );

  const unlockLocal = useCallback(
    async (password) => {
      setError(null);
      try {
        const provider = await getReadProvider(DEFAULT_CHAIN);
        const signer = await unlockVault(password, provider);
        /* Same mode-switch teardown as attachCreatedLocal() — and only AFTER
           the password has proven correct: a BAD_PASSWORD must leave an
           existing WalletConnect connection exactly as it was. */
        void releaseWc();
        signerRef.current = signer;
        eip1193Ref.current = createLocalEip1193Adapter({ signer, account: signer.address, chainId: DEFAULT_CHAIN, getReadProvider });
        setMode('local');
        setAddress(signer.address);
        setChainId(DEFAULT_CHAIN);
        setLocked(false);
        // Unlock succeeds as soon as signing is ready; slow mobile RPC runs behind it.
        void refreshBalance(signer.address, DEFAULT_CHAIN);
        return true;
      } catch (e) {
        setError(e.message === 'BAD_PASSWORD' ? 'BAD_PASSWORD' : 'UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, refreshBalance, releaseWc]
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
