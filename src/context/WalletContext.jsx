import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../lib/chains';
import { clearVault, loadVault, unlockVault } from '../lib/localWallet';

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
    const providers = cfg.rpc.map((url, i) => ({
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

      const publicUrl =
        import.meta.env?.VITE_PUBLIC_URL?.replace(/\/$/, '') ||
        (isLocal ? 'https://fbtcryp.vercel.app' : runtimeOrigin);

      const wc = await EthereumProvider.init({
        projectId,
        chains: [DEFAULT_CHAIN],
        optionalChains: Object.keys(EVM_CHAINS).map(Number),
        showQrModal: true,
        metadata: {
          name: 'FBT Swap',
          description: 'Non-custodial decentralized exchange',
          url: publicUrl,
          icons: [`${publicUrl}/icon-512.png`]
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
