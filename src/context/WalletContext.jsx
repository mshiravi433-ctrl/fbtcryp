import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../lib/chains';
import { clearVault, loadVault, unlockVault } from '../lib/localWallet';
import { useSettingsStore } from '../store/useSettingsStore';
import { publicAppUrl } from '../lib/nativeShell';
import { isIOS as isIOSDevice } from '../lib/platform';

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

export function WalletProvider({ children }) {
  const [mode, setMode] = useState(null); // 'injected' | 'wc' | 'local'
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

  const chain = EVM_CHAINS[chainId] ?? EVM_CHAINS[DEFAULT_CHAIN];

  /* ----------------------------- read helpers ---------------------------- */

  const getReadProvider = useCallback(async (targetChain = DEFAULT_CHAIN) => {
    const { JsonRpcProvider, FallbackProvider } = await loadEthers();
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
     *
     * https only. An http endpoint would be blocked by the WebView's
     * usesCleartextTraffic=false anyway, and downgrading a wallet's RPC to
     * plaintext is worth refusing outright rather than failing obscurely.
     */
    const custom = useSettingsStore.getState().customEvmRpc;
    const rpcList =
      typeof custom === 'string' && /^https:\/\//.test(custom.trim())
        ? [custom.trim(), ...cfg.rpc]
        : cfg.rpc;

    const providers = rpcList.map((url, i) => ({
      provider: new JsonRpcProvider(url, targetChain, { staticNetwork: true }),
      priority: i + 1,
      /*
       * On iPhone the public BSC RPC endpoint is routinely >2s to first byte.
       * 2500ms was just fast enough to trip the stall timer and race a second
       * request before the first answered — on a flaky connection that meant
       * two requests, two seconds each, and a balance that looked like it
       * never loaded. Raise the timeout on slow devices and rely on the
       * priority order instead of racing.
       */
      stallTimeout: SLOW_DEVICE ? 6000 : 2500,
      weight: 1
    }));
    return providers.length > 1
      ? new FallbackProvider(providers, targetChain, { quorum: 1, cacheTimeout: 15_000 })
      : providers[0].provider;
  }, []);

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
    try {
      // Clean up any prior listeners before reattaching.
      detachInjectedListeners();

      let target = window.ethereum;
      // If there are multiple injected providers (EIP-6963) pick by rdns.
      if (rdns && eip6963Ref.current.size > 0) {
        for (const { info, provider } of eip6963Ref.current.values()) {
          if (info.rdns === rdns) { target = provider; break; }
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
    }
  }, [attachInjectedListeners, detachInjectedListeners, refreshBalance]);

  /* --------------------------- WalletConnect v2 -------------------------- */

  const connectWalletConnect = useCallback(async () => {
    // WalletConnect project IDs are public identifiers, not secrets — they
    // are designed to ship in client bundles. Override via env if needed.
    const projectId =
      import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID || '14bdc2642bb5f01972ffe799e43b978d';
    if (!projectId) {
      setError('NO_WC_PROJECT_ID');
      return false;
    }
    // Prevent double-init: EthereumProvider.init() creates a new session every
    // time it runs, and rapid double-taps spawned two modals / two pairing URIs.
    if (wcInitingRef.current) return false;
    setError(null);
    setConnecting(true);
    wcInitingRef.current = true;
    let wc;
    try {
      const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
      const { BrowserProvider } = await loadEthers();

      /*
       * WALLETCONNECT METADATA — why this is not just window.location.origin.
       *
       * Symptom: tapping Connect opened MetaMask, which then refused with an
       * invalid-URL error instead of showing an approval prompt.
       *
       * Two causes, both here:
       *
       *  1. `icons` pointed at `/icon.png`, which does not exist — the files
       *     are icon-192.png and icon-512.png. Wallets fetch this URL to draw
       *     the connection dialog and reject metadata whose icon 404s.
       *
       *  2. Inside the packaged Android app the page is served from
       *     `https://localhost`, so `window.location.origin` was literally
       *     "https://localhost". A wallet is a SEPARATE app: that origin means
       *     the wallet's own device, where nothing is listening. It cannot be
       *     fetched and cannot be shown to the user as "who is asking for
       *     permission", so the request is rejected outright.
       *
       * The dapp URL must therefore be a publicly reachable origin. We use the
       * deployed site, falling back to the live origin only when that really
       * is a public URL. VITE_PUBLIC_URL has no secret in it — this value is
       * shown to the user by their wallet and is meant to be public.
       */
      /*
       * The fallback used to be https://fbtcryp.vercel.app, which no longer
       * resolves — that deployment is gone and now answers DEPLOYMENT_NOT_FOUND.
       *
       * That matters more than a dead link: wallets FETCH this URL and its
       * icon to draw "who is asking to connect". A metadata URL that 404s is
       * grounds for the wallet to reject the request outright, so if
       * VITE_PUBLIC_URL were ever unset in a packaged build, every connection
       * attempt would fail with no obvious cause.
       *
       * Pointing at the live domain means the fallback is at least a real
       * site. VITE_PUBLIC_URL still overrides it for other deployments.
       */
      /* One canonical identity for every wallet prompt. publicAppUrl rejects
         the retired lawpoetics.ir env value; using the runtime origin here
         made Solana and EVM prompts disagree about which site was connecting. */
      const publicUrl = publicAppUrl('/').replace(/\/$/, '');

      const ios = isIOSDevice();

      // If there's already a connected instance (stale session), disconnect it
      // first so we never have two sessions fighting for the same state.
      if (wcRef.current) {
        try { await wcRef.current.disconnect(); } catch { /* noop */ }
        wcRef.current = null;
      }
      wc = await EthereumProvider.init({
        projectId,
        chains: [DEFAULT_CHAIN],
        optionalChains: Object.keys(EVM_CHAINS).map(Number),
        showQrModal: true,
        /*
         * MOBILE: on a phone the wallet is another app on the SAME device, so
         * there is no second screen to point a camera at. The modal therefore
         * renders quick "open this wallet" buttons that deep-link into each
         * wallet app; the QR code stays as the fallback for a second device.
         */
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
           * iOS: give the modal the exact native + universal links for the
           * wallets we surface, so tapping one opens that wallet directly
           * (universal links also fall back to the App Store when the app is
           * missing). Without this the modal falls back to explorer data.
           */
          ...(ios
            ? {
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
              }
            : {})
        },
        metadata: {
          name: 'FBT Swap',
          description: 'Non-custodial decentralized exchange',
          url: publicUrl,
          icons: [`${publicUrl}/icon-512.png`],
          redirect: {
            /*
             * On iOS there is no native app scheme registered (this repo has
             * no ios/ folder), so only the universal link matters — it brings
             * the user back to the PWA/Safari. On Android the capacitor://
             * scheme (ir.fbtswap.app://) is already declared and handled.
             */
            native: ios ? undefined : 'ir.fbtswap.app://',
            universal: publicUrl
          }
        }
      });

      /*
       * The WalletConnect SDK's SignClient runs our `metadata` through
       * populateAppMetadata(), which OVERWRITES `metadata.url` with
       * window.location.origin whenever the two hosts differ. Inside the
       * packaged app that origin is `https://localhost`; on a preview host it
       * is that preview URL. Either way the wallet (a separate app) cannot
       * fetch the URL, so MetaMask rejects the request with its "Invalid URL"
       * error and Trust simply fails to pair. Point the live sign client back
       * at the public origin immediately before connecting — this is the value
       * that actually lands in the session proposal the wallet renders.
       */
      try {
        const signClient = wc?.signer?.client;
        if (signClient?.metadata) {
          signClient.metadata.url = publicUrl;
          signClient.metadata.icons = [`${publicUrl}/icon-512.png`];
        }
      } catch {
        /* non-fatal: fall back to the SDK-derived metadata */
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
      let connected = false;
      const wcListeners = { disconnect: null, accountsChanged: null, chainChanged: null, sessionDelete: null };
      const cleanupWcListeners = () => {
        if (!wc) return;
        try { wc.removeListener('disconnect', wcListeners.disconnect); } catch { /* noop */ }
        try { wc.removeListener('accountsChanged', wcListeners.accountsChanged); } catch { /* noop */ }
        try { wc.removeListener('chainChanged', wcListeners.chainChanged); } catch { /* noop */ }
        try { wc.removeListener('session_delete', wcListeners.sessionDelete); } catch { /* noop */ }
      };
      try {
        await wc.connect();
        connected = true;
      } catch (err) {
        cleanupWcListeners();
        throw err;
      }
      const provider = new BrowserProvider(wc, 'any');
      const signer = await provider.getSigner();

      // Detach any prior injected listeners (they are for a different provider)
      detachInjectedListeners();
      wcRef.current = wc;
      eip1193Ref.current = wc;
      signerRef.current = signer;
      setMode('wc');
      setAddress(await signer.getAddress());
      setChainId(Number(wc.chainId));
      setLocked(false);
      await refreshBalance(await signer.getAddress(), Number(wc.chainId));

      wcListeners.disconnect = () => disconnectRef.current();
      wcListeners.accountsChanged = (accs) => (accs?.[0] ? setAddress(accs[0]) : disconnectRef.current());
      wcListeners.chainChanged = (cid) => setChainId(Number(cid));
      wcListeners.sessionDelete = () => disconnectRef.current();
      wc.on('disconnect', wcListeners.disconnect);
      wc.on('accountsChanged', wcListeners.accountsChanged);
      wc.on('chainChanged', wcListeners.chainChanged);
      wc.on('session_delete', wcListeners.sessionDelete);
      wcListenersRef.current = { cleanup: cleanupWcListeners };
      return true;
    } catch (e) {
      setError(e?.message?.includes('User rejected') || e?.code === 4001 ? 'USER_REJECTED' : 'CONNECT_FAILED');
      return false;
    } finally {
      setConnecting(false);
      wcInitingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBalance]);

  /* ------------------------------ local vault ---------------------------- */

  /** Attach a locally-stored wallet in LOCKED state (address only, no signer). */
  const attachLocal = useCallback(() => {
    const vault = loadVault();
    if (!vault) return false;
    setMode('local');
    setAddress(vault.address);
    setChainId(DEFAULT_CHAIN);
    setLocked(true);
    signerRef.current = null;
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
        signerRef.current = signer;
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
    [getReadProvider, refreshBalance]
  );

  const unlockLocal = useCallback(
    async (password) => {
      setError(null);
      try {
        const provider = await getReadProvider(DEFAULT_CHAIN);
        const signer = await unlockVault(password, provider);
        signerRef.current = signer;
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
    [getReadProvider, refreshBalance]
  );

  /** Drop the in-memory signer but keep the encrypted vault on disk. */
  const lock = useCallback(() => {
    signerRef.current = null;
    setLocked(true);
  }, []);

  const forgetLocalWallet = useCallback(() => {
    clearVault();
    signerRef.current = null;
    setMode(null);
    setAddress(null);
    setLocked(false);
    setNativeBalance(null);
  }, []);

  /* ------------------------------ disconnect ----------------------------- */

  const disconnect = useCallback(() => {
    // Clean up WalletConnect session listeners first
    try { wcListenersRef.current?.cleanup?.(); } catch { /* noop */ }
    wcListenersRef.current = null;
    try { wcRef.current?.disconnect?.(); } catch { /* already gone */ }
    // Clean up injected listeners
    detachInjectedListeners();
    wcRef.current = null;
    eip1193Ref.current = null;
    signerRef.current = null;
    setMode(null);
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
    if (!eip) {
      /*
       * A local ethers Wallet is connected to a concrete Provider. Merely
       * changing the React chain label leaves the signer broadcasting to the
       * old network — catastrophic for a same-address contract call. Reconnect
       * the in-memory signer to the target RPC before reporting success.
       */
      if (signerRef.current?.connect) {
        signerRef.current = signerRef.current.connect(await getReadProvider(targetId));
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
  }, [getReadProvider]);

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

  const value = useMemo(
    () => ({
      mode,
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
      attachLocal,
      attachCreatedLocal,
      unlockLocal,
      lock,
      forgetLocalWallet,
      disconnect,
      switchChain,
      refreshBalance,
      getReadProvider,
      getSigner: () => signerRef.current,
      clearError: () => setError(null)
    }),
    [
      mode,
      address,
      chainId,
      chain,
      nativeBalance,
      connecting,
      error,
      locked,
      connectInjected,
      connectWalletConnect,
      attachLocal,
      attachCreatedLocal,
      unlockLocal,
      lock,
      forgetLocalWallet,
      disconnect,
      switchChain,
      refreshBalance,
      getReadProvider
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext) ?? {};

export const shortAddress = (a, size = 4) => (a ? `${a.slice(0, 2 + size)}…${a.slice(-size)}` : '');
