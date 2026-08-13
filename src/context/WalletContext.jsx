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

  /* ------------------------------- injected ------------------------------ */

  const connectInjected = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      if (!window.ethereum) throw new Error('NO_INJECTED_WALLET');
      const { BrowserProvider } = await loadEthers();
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const net = await provider.getNetwork();

      eip1193Ref.current = window.ethereum;
      signerRef.current = await provider.getSigner();
      setMode('injected');
      setAddress(accounts[0]);
      setChainId(Number(net.chainId));
      setLocked(false);
      await refreshBalance(accounts[0], Number(net.chainId));
      return true;
    } catch (e) {
      setError(e.message === 'NO_INJECTED_WALLET' ? 'NO_INJECTED_WALLET' : 'CONNECT_FAILED');
      return false;
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance]);

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
    setError(null);
    setConnecting(true);
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
      const runtimeOrigin = window.location.origin;
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|\[::1\])/.test(runtimeOrigin)
        || runtimeOrigin.startsWith('capacitor://')
        || runtimeOrigin.startsWith('file://');

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
      void isLocal;
      void runtimeOrigin;

      const ios = isIOSDevice();

      const wc = await EthereumProvider.init({
        projectId,
        chains: [DEFAULT_CHAIN],
        optionalChains: Object.keys(EVM_CHAINS).map(Number),
        showQrModal: true,
        /*
         * MOBILE: the QR modal alone is not enough.
         *
         * On a phone the wallet is another app on the SAME device, so there is
         * no second screen to point a camera at. WalletConnect's modal does
         * offer deep links, but on iOS it has been observed to sit on a white
         * "Loading..." screen ("در حال بارگذاری مرورگر اپل") when the wallet
         * app doesn't have a working universal link registered — the modal
         * opens an SFSafariViewController bridge that never returns. Turning
         * OFF the auth-mode bridge on iOS and relying on direct wallet deeplink
         * navigation skips that bridge entirely.
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
           * iOS: tell WalletConnect's modal NOT to use the headless browser
           * bridge that shows the "Loading..." webview. Direct native deeplinks
           * back to each wallet app.
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
       * iOS: WalletConnect's default behaviour is to navigate to the wallet
       * through an SFSafariViewController redirect ("Redirecting to..."), which
       * is the infamous "Loading Apple browser" screen. Setting `redirectMode:
       * 'manual'` and firing a location change to the deeplink ourselves skips
       * that bridge and goes straight to the wallet app. We keep QR-modal
       * desktop behaviour untouched.
       */
      let connected = false;
      if (ios) {
        const onDisplayUri = (uri) => {
          try {
            // Offer all three major wallets via their universal deeplinks —
            // iOS will resolve the one the user has installed.
            const encoded = encodeURIComponent(uri);
            const links = [
              `https://metamask.app.link/wc?uri=${encoded}`,
              `https://link.trustwallet.com/wc?uri=${encoded}`,
              `rainbow://wc?uri=${encoded}`
            ];
            // Small delay so the modal has painted before navigation leaves.
            setTimeout(() => {
              window.location.href = links[0];
            }, 250);
            void links;
          } catch {
            /* navigation blocked; the QR code in the modal still works */
          }
        };
        wc.on('display_uri', onDisplayUri);
        try {
          await wc.connect();
          connected = true;
        } finally {
          wc.removeListener('display_uri', onDisplayUri);
        }
      } else {
        await wc.connect();
        connected = true;
      }
      const provider = new BrowserProvider(wc);
      const signer = await provider.getSigner();

      wcRef.current = wc;
      eip1193Ref.current = wc;
      signerRef.current = signer;
      setMode('wc');
      setAddress(await signer.getAddress());
      setChainId(Number(wc.chainId));
      setLocked(false);
      await refreshBalance(await signer.getAddress(), Number(wc.chainId));

      wc.on('disconnect', () => disconnect());
      wc.on('accountsChanged', (accs) => (accs?.[0] ? setAddress(accs[0]) : disconnect()));
      wc.on('chainChanged', (cid) => setChainId(Number(cid)));
      return true;
    } catch (e) {
      setError(e?.message?.includes('User rejected') ? 'USER_REJECTED' : 'CONNECT_FAILED');
      return false;
    } finally {
      setConnecting(false);
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
    try {
      wcRef.current?.disconnect?.();
    } catch {
      /* already gone */
    }
    wcRef.current = null;
    eip1193Ref.current = null;
    signerRef.current = null;
    setMode(null);
    setAddress(null);
    setChainId(null);
    setNativeBalance(null);
    setLocked(false);
    setError(null);
  }, []);

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
      setChainId(targetId);
      return true;
    } catch (e) {
      if (e.code === 4902) {
        await eip.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: cfg.hexId,
              chainName: cfg.name,
              nativeCurrency: { name: cfg.native.symbol, symbol: cfg.native.symbol, decimals: cfg.native.decimals },
              rpcUrls: cfg.rpc,
              blockExplorerUrls: [cfg.explorer]
            }
          ]
        });
        setChainId(targetId);
        return true;
      }
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

  useEffect(() => {
    const eip = window.ethereum;
    if (!eip || mode !== 'injected') return undefined;
    const onAccounts = (accs) => (accs?.length ? setAddress(accs[0]) : disconnect());
    const onChain = (hex) => setChainId(parseInt(hex, 16));
    eip.on?.('accountsChanged', onAccounts);
    eip.on?.('chainChanged', onChain);
    return () => {
      eip.removeListener?.('accountsChanged', onAccounts);
      eip.removeListener?.('chainChanged', onChain);
    };
  }, [mode, disconnect]);

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
