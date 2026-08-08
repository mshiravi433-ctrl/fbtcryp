import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../lib/chains';
import { clearVault, loadVault, unlockVault } from '../lib/localWallet';
import { useSettingsStore } from '../store/useSettingsStore';

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
      stallTimeout: 2500,
      weight: 1
    }));
    return providers.length > 1 ? new FallbackProvider(providers, targetChain, { quorum: 1 }) : providers[0].provider;
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
      const publicUrl =
        import.meta.env?.VITE_PUBLIC_URL?.replace(/\/$/, '') ||
        (isLocal ? 'https://fbtswap.ir' : runtimeOrigin);

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
         * offer deep links, but it only lists wallets it has explicitly been
         * told about; with no explorer hints the sheet can come up empty, which
         * is the "I press connect and nothing happens" case.
         *
         * These IDs are WalletConnect's own registry entries for MetaMask,
         * Trust and Rainbow — the three most likely to already be installed.
         */
        optionalMethods: ['eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
        qrModalOptions: {
          themeMode: 'dark',
          explorerRecommendedWalletIds: [
            'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
            '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust
            '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369'  // Rainbow
          ]
        },
        metadata: {
          name: 'FBT Swap',
          description: 'Non-custodial decentralized exchange',
          url: publicUrl,
          icons: [`${publicUrl}/icon-512.png`],
          /*
           * RETURNING TO THIS APP AFTER APPROVAL.
           *
           * Symptom: the wallet opens, you approve, and then you are simply
           * left sitting in the wallet. Coming back by hand shows the app
           * still disconnected.
           *
           * Cause: `metadata.redirect` was absent. The approval genuinely
           * succeeds and the session is established, but the wallet has no
           * link to send the user back through, so control never returns.
           * `wc.connect()` keeps awaiting in a WebView that is now in the
           * background, and Android may freeze or evict it before it settles
           * — so the promise that would have set the address never resolves.
           *
           * `native` is the custom scheme declared in AndroidManifest.xml
           * (ir.fbtswap.app://), which the MainActivity intent-filter already
           * catches. `universal` gives wallets that refuse custom schemes an
           * https route to the same place.
           *
           * This is metadata about where to return, not a permission: it
           * cannot grant a wallet any additional access.
           */
          redirect: {
            native: 'ir.fbtswap.app://',
            universal: publicUrl
          }
        }
      });

      await wc.connect();
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
        await refreshBalance(signer.address, DEFAULT_CHAIN);
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
      setChainId(targetId); // local wallet: just point the RPC elsewhere
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
  }, []);

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
