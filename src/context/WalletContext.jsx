import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../lib/chains';
import { clearVault, loadVault, unlockVault } from '../lib/localWallet';
import { useSettingsStore } from '../store/useSettingsStore';
import { isIOS as isIOSDevice } from '../lib/platform';
import { holdRefreshGuard, onSoftRefresh } from '../lib/refresh';
import { bindRewardsIdentity } from '../lib/rewards/rewardsReporter';
import {
  WC_PROJECT_ID,
  createWcSession,
  forgetEmbeddedWallet,
  hasEmailMarker,
  openEmbeddedWallet,
  purgeConnectionKeys,
  restoreEmbeddedWallet,
  sdkLoginMarkerPresent,
  setEmailMarker,
  storageFacts,
  wcEvent,
  wcEventDetail,
  wcMetadata
} from '../lib/wc';

/**
 * NON-CUSTODIAL WALLET LAYER
 * ---------------------------------------------------------------------------
 * Four connection modes, all self-custody. In every one of them the private key
 * stays with the user and this app never sees, stores or transmits it:
 *
 *   1. `injected` — window.ethereum / EIP-6963 (desktop extensions, a wallet's
 *      own in-app browser)
 *   2. `wc`       — WalletConnect v2 (QR on desktop, deep link on a phone)
 *   3. `email`    — the secure embedded wallet, provisioned behind an email or
 *      social login (src/lib/wc/embedded.js)
 *   4. `local`    — an in-app wallet whose seed is AES-GCM encrypted on-device
 *
 * There is no operator wallet, no deposit address and no server-side signing
 * anywhere in this codebase. Transactions are built client-side and signed by
 * whichever wallet the user chose.
 *
 * ─── SHAPE OF THIS FILE ────────────────────────────────────────────────────
 * The mechanics live in src/lib/wc/ and are framework-free. This component owns
 * React state and nothing else: it subscribes to the WalletConnect session,
 * adapts every transport into the same { signer, eip1193, address, chainId }
 * shape, and hands that to the app. A connection bug is therefore either in the
 * transport (one directory) or in the adaptation (this file) — never spread
 * across both.
 */

const WalletContext = createContext(null);

const loadEthers = () => import('ethers');

const toHexChainId = (value) => `0x${Number(value || DEFAULT_CHAIN).toString(16)}`;

/** A low core count or little memory means a public RPC needs more rope. */
const SLOW_DEVICE = (() => {
  if (typeof navigator === 'undefined') return false;
  if (isIOSDevice()) return true;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  return cores <= 4 || mem <= 2;
})();

/**
 * An EIP-1193 view of the in-app vault's ethers signer, so the rest of the app
 * (and Intent AI's execution path) talks to it exactly as it talks to an
 * injected wallet. Unsupported methods answer 4200 rather than guessing.
 */
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
        const text =
          typeof message === 'string' && /^0x[0-9a-fA-F]*$/.test(message)
            ? new TextDecoder().decode(
                Uint8Array.from(message.slice(2).match(/.{1,2}/g) || [], (b) => parseInt(b, 16))
              )
            : String(message || '');
        return signer.signMessage(text);
      }
      if (method === 'eth_signTypedData_v4') {
        const [, typedRaw] = params;
        const typed = typeof typedRaw === 'string' ? JSON.parse(typedRaw) : typedRaw;
        const { domain = {}, types = {}, primaryType, message = {} } = typed || {};
        const cleanTypes = { ...types };
        delete cleanTypes.EIP712Domain;
        const selectedTypes =
          primaryType && cleanTypes[primaryType] ? { [primaryType]: cleanTypes[primaryType] } : cleanTypes;
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

export function WalletProvider({ children }) {
  const [mode, setMode] = useState(null); // 'injected' | 'wc' | 'email' | 'local'
  /* Which injected wallet we attached (EIP-6963 info, never the provider
     object itself — state must stay JSON-clean). Drives the provider label on
     the Wallet page; null for the other modes. */
  const [injectedInfo, setInjectedInfo] = useState(null);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [nativeBalance, setNativeBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [locked, setLocked] = useState(false);

  /* Kept in refs so a signer or provider never lands in React state (and thus
     never in a devtools snapshot or a serialized store). */
  const signerRef = useRef(null);
  const eip1193Ref = useRef(null);
  /** EIP-6963 discovered providers: Map<uuid, { info, provider }>. */
  const eip6963Ref = useRef(new Map());
  const injectedListenersRef = useRef(null);
  /** One WalletConnect session object for the page lifetime. */
  const wcRef = useRef(null);
  /** Single-flight for the email/social restore: a cold start, a bfcache
   *  `pageshow` return and a foreground resume can all ask within a second. */
  const emailRestoreRef = useRef(false);

  /* Pairing surface: the URI the SDK issued for the in-flight attempt (null
     when there is none), and which surface currently owns the screen. A URI
     left in state after an attempt settles is how a wallet gets opened on a
     pairing that no longer exists. */
  const [wcPairUri, setWcPairUri] = useState(null);
  const [wcModalActive, setWcModalActive] = useState(false);
  const [emailModalActive, setEmailModalActive] = useState(false);
  /** The measured relay state — see src/lib/wc/relay.js. */
  const [wcRelay, setWcRelay] = useState(null);
  const wcRelayBlocked = Boolean(wcRelay && ['WS_REFUSED', 'UNREACHABLE', 'TIMEOUT'].includes(wcRelay.verdict));

  /* Render-time mirrors for event handlers that must not close over a stale
     copy (the visibilitychange restore path, the commit guards). */
  const addressRef = useRef(null);
  addressRef.current = address;
  const chainIdRef = useRef(null);
  chainIdRef.current = chainId;
  /* The connection mode, mirrored for the same reason: `connectEmailSocial`
     must know whether an email wallet is ALREADY attached at tap time, not at
     render time of the callback it was captured in. */
  const modeRef = useRef(null);
  modeRef.current = mode;
  const disconnectRef = useRef(() => {});

  const chain = EVM_CHAINS[chainId] ?? EVM_CHAINS[DEFAULT_CHAIN];

  /* ----------------------------- read helpers ---------------------------- */

  /**
   * The individual read-only JsonRpcProviders for a chain, in priority order.
   * Shared by the fail-over wrapper (getReadProvider) and the raw list handed to
   * the multi-RPC preflight quorum, so the two can never drift.
   *
   * https only: an http endpoint would be blocked by the WebView's
   * usesCleartextTraffic=false anyway, and downgrading a wallet's RPC to
   * plaintext is worth refusing outright rather than failing obscurely.
   */
  const buildReadProviders = useCallback(async (targetChain = DEFAULT_CHAIN) => {
    const { JsonRpcProvider } = await loadEthers();
    const cfg = EVM_CHAINS[targetChain];

    /* The user's own node comes FIRST, if they set one. Settings has a custom
       RPC field, and it used to store the URL, redraw its own label and never
       actually connect to it. Ahead of the defaults rather than replacing them:
       a private node that goes down would otherwise take the whole app with it,
       and FallbackProvider already fails over on a stall. */
    const custom = useSettingsStore.getState().customEvmRpc;
    const rpcList =
      typeof custom === 'string' && /^https:\/\//.test(custom.trim()) ? [custom.trim(), ...cfg.rpc] : cfg.rpc;

    return rpcList.map((url, i) => {
      const provider = new JsonRpcProvider(url, targetChain, { staticNetwork: true });
      /* Priority on a non-enumerable side-channel, so the provider stays
         JSON-clean in devtools. */
      Object.defineProperty(provider, '__rpcPriority', { value: i + 1, enumerable: false });
      /* On iPhone the public BSC endpoint is routinely >2s to first byte; 2500ms
         tripped the stall timer and raced a second request before the first
         answered. Slow devices get more rope and rely on the priority order. */
      Object.defineProperty(provider, '__stallTimeout', {
        value: SLOW_DEVICE ? 6000 : 2500,
        enumerable: false
      });
      return provider;
    });
  }, []);

  const getReadProvider = useCallback(
    async (targetChain = DEFAULT_CHAIN) => {
      const { FallbackProvider } = await loadEthers();
      const providers = await buildReadProviders(targetChain);
      /* Single-endpoint chains return the JsonRpcProvider ITSELF. Returning
         `providers[0].provider` broke every read on chains with exactly one
         entry — `.provider` is undefined on a JsonRpcProvider. */
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
    },
    [buildReadProviders]
  );

  /** The raw, independent read nodes — the inputs to the preflight quorum. */
  const getReadProviders = useCallback(
    (targetChain = DEFAULT_CHAIN) => buildReadProviders(targetChain),
    [buildReadProviders]
  );

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

  // Discover EIP-6963 providers on mount. Does NOT auto-connect; it surfaces
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

  /**
   * Per-instance listeners on one EIP-1193 object.
   *
   * `destructive: false` for the remote transports (WalletConnect, the embedded
   * wallet). Some wallets — Trust among them — emit an EMPTY accountsChanged
   * around a chain move while they re-derive accounts; treating that as "the
   * wallet went away" is precisely the «Trust Wallet disconnects by itself»
   * report. On those transports the authoritative end of a session is
   * session_delete / session_expire, which src/lib/wc/session.js emits as
   * `closed`. An injected wallet has no such event, so losing its last account
   * really does mean the connection is over.
   */
  const attachInjectedListeners = useCallback((eip, { destructive = true } = {}) => {
    if (!eip?.on) return;
    const onAccounts = (accs) => {
      if (accs?.length) setAddress(accs[0]);
      else if (destructive) disconnectRef.current();
    };
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
    if (!listeners || !eip?.removeListener) {
      injectedListenersRef.current = null;
      return;
    }
    try { eip.removeListener('accountsChanged', listeners.onAccounts); } catch { /* noop */ }
    try { eip.removeListener('chainChanged', listeners.onChain); } catch { /* noop */ }
    try { eip.removeListener('disconnect', listeners.onDisconnect); } catch { /* noop */ }
    injectedListenersRef.current = null;
  }, []);

  /**
   * Connect an injected provider. Prefers an explicit EIP-6963 provider when a
   * wallet rdns is given; never assumes window.ethereum is MetaMask.
   */
  const connectInjected = useCallback(
    async (rdns) => {
      setError(null);
      setConnecting(true);
      /* Same contract as every other path: a refresh/reload stays frozen while
         a wallet approval screen may be up. */
      const connectGuard = holdRefreshGuard('injected-connect');
      try {
        detachInjectedListeners();
        let target = window.ethereum;
        let matchedInfo = null;
        if (rdns && eip6963Ref.current.size > 0) {
          for (const { info, provider } of eip6963Ref.current.values()) {
            if (info.rdns === rdns) {
              target = provider;
              matchedInfo = info;
              break;
            }
          }
        } else if (Array.isArray(window.ethereum?.providers) && window.ethereum.providers.length) {
          target =
            window.ethereum.providers.find((p) => p.isMetaMask && !p.isTrust) ||
            window.ethereum.providers.find((p) => p.isTrust) ||
            window.ethereum.providers[0];
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
        if (msg.includes('User rejected') || e?.code === 4001) setError('USER_REJECTED');
        else if (msg === 'NO_INJECTED_WALLET') setError('NO_INJECTED_WALLET');
        else setError('CONNECT_FAILED');
        return false;
      } finally {
        setConnecting(false);
        connectGuard.release();
      }
    },
    [attachInjectedListeners, detachInjectedListeners, refreshBalance]
  );

  /* --------------------- one adapter for every transport ------------------ */

  /**
   * Attach an external EIP-1193 provider — WalletConnect or the embedded
   * wallet — to the same signer state an injected wallet uses.
   *
   * `chainId` is passed in by the caller because both transports know the
   * network the wallet actually approved, which is NOT what the EIP-1193 object
   * reports on its first tick (see src/lib/wc/chain.js).
   *
   * ─── WHY THIS IS NOW TWO-STAGE ───────────────────────────────────────────
   * The 2026-09-18 report: email login succeeded (frame session exists,
   * storedConnectors: ['AUTH']) but `attachExternal` threw on every attempt,
   * so the UI showed «کیف پول در این صفحه آماده نشد». The throw came from
   * `BrowserProvider.getSigner()` which internally does `eth_accounts` — on a
   * slow WebView the frame answers that a beat after the address is already
   * visible via `getAddress()`. Treating ANY throw as fatal turned one slow
   * tick into a permanent loss. The new version:
   *   1. tries direct `eth_accounts` / `eth_chainId` first (no ethers);
   *   2. tries BrowserProvider, but if it throws, falls back to a minimal
   *      attach that still sets eip1193 + address + chainId, so the header
   *      shows connected and the next foreground return can upgrade the signer;
   *   3. emits the actual error message (sanitized) into the trace, so the
   *      NEXT report names the failing RPC instead of «attach_failed».
   */
  const attachExternal = useCallback(
    async ({ eip, address: acct, chainId: cid, mode: nextMode }) => {
      if (!eip || !acct) {
        wcEvent(nextMode === 'email' ? 'email_attach_no_provider' : 'wc_attach_no_provider');
        return false;
      }

      // ── 1. Resolve address / chainId directly via EIP-1193, no ethers ──
      let resolvedAddr = acct;
      let resolvedCid = cid != null ? Number(cid) : null;

      if (!resolvedAddr) {
        try {
          const accs = await eip.request?.({ method: 'eth_accounts' });
          if (Array.isArray(accs) && accs[0]) resolvedAddr = accs[0];
        } catch {}
      }
      if (!resolvedCid) {
        try {
          const hex = await eip.request?.({ method: 'eth_chainId' });
          if (hex) {
            const n = typeof hex === 'string' && hex.startsWith('0x') ? parseInt(hex, 16) : Number(hex);
            if (Number.isInteger(n) && n > 0) resolvedCid = n;
          }
        } catch {}
      }

      // Still need at least an address to attach
      if (!resolvedAddr) {
        wcEvent(nextMode === 'email' ? 'email_attach_no_addr' : 'wc_attach_no_addr');
        return false;
      }

      const honestChain = (() => {
        if (resolvedCid && EVM_CHAINS[resolvedCid]) return resolvedCid;
        if (cid && EVM_CHAINS[Number(cid)]) return Number(cid);
        return DEFAULT_CHAIN;
      })();

      // ── 2. Try full BrowserProvider path ──
      try {
        const { BrowserProvider } = await loadEthers();
        const provider = new BrowserProvider(eip, 'any');
        // getSigner may throw "Action not allowed" / "action not valid" if frame not ready
        const signer = await provider.getSigner();
        let addrFromSigner = null;
        try {
          addrFromSigner = await signer.getAddress();
        } catch {}
        const finalAddr = addrFromSigner || resolvedAddr;

        let netChain = honestChain;
        try {
          const net = await provider.getNetwork();
          const n = Number(net?.chainId);
          if (Number.isInteger(n) && n > 0) netChain = EVM_CHAINS[n] ? n : (EVM_CHAINS[honestChain] ? honestChain : DEFAULT_CHAIN);
        } catch {
          // keep honestChain
        }

        detachInjectedListeners();
        eip1193Ref.current = eip;
        signerRef.current = signer;
        setMode(nextMode);
        setInjectedInfo(null);
        setAddress(finalAddr);
        setChainId(netChain);
        setLocked(false);
        attachInjectedListeners(eip, { destructive: false });
        void refreshBalance(finalAddr, netChain);
        if (nextMode === 'email') wcEvent('email_attach_ok');
        return true;
      } catch (err) {
        const msg = String(err?.message || err || '').slice(0, 120);
        try {
          wcEventDetail(nextMode === 'email' ? 'email_attach_err' : 'wc_attach_err', { m: msg });
        } catch {}
        wcEvent(nextMode === 'email' ? 'email_attach_failed' : 'wc_attach_failed');

        // ── 3. Fallback: minimal attach for email — keep eip + address, no signer yet ──
        // This is what turns «کیف پول آماده نشد» from a dead end into a retryable state.
        // The header shows connected (address + balance via public RPC), and the next
        // foreground return / restore upgrades the signer. For WC we don't fallback,
        // because a WC provider that can't produce a signer is truly broken.
        if (nextMode === 'email') {
          try {
            // Create a tiny signer wrapper that proxies to eip.request so that
            // `getSigner()` still returns something that can sign, even without ethers.
            const fallbackSigner = {
              _isFallback: true,
              address: resolvedAddr,
              getAddress: async () => resolvedAddr,
              provider: null,
              connect: function () { return this; },
              signMessage: async (message) => {
                const text = typeof message === 'string' ? message : String(message || '');
                // personal_sign expects hex
                let hex = text;
                try {
                  if (!/^0x[0-9a-fA-F]*$/.test(text)) {
                    const enc = new TextEncoder().encode(text);
                    hex = '0x' + Array.from(enc).map((b) => b.toString(16).padStart(2, '0')).join('');
                  }
                } catch {}
                return eip.request({ method: 'personal_sign', params: [hex, resolvedAddr] });
              },
              signTypedData: async (domain, types, message) => {
                // Try v4 first
                try {
                  const payload = JSON.stringify({
                    domain: domain || {},
                    types: types || {},
                    primaryType: Object.keys(types || {})[0] || 'Message',
                    message: message || {}
                  });
                  return await eip.request({ method: 'eth_signTypedData_v4', params: [resolvedAddr, payload] });
                } catch {
                  // fallback to eth_signTypedData
                  const payload = JSON.stringify({
                    domain: domain || {},
                    types: types || {},
                    primaryType: Object.keys(types || {})[0] || 'Message',
                    message: message || {}
                  });
                  return await eip.request({ method: 'eth_signTypedData', params: [resolvedAddr, payload] });
                }
              }
            };

            detachInjectedListeners();
            eip1193Ref.current = eip;
            signerRef.current = fallbackSigner;
            setMode(nextMode);
            setInjectedInfo(null);
            setAddress(resolvedAddr);
            setChainId(honestChain);
            setLocked(false);
            attachInjectedListeners(eip, { destructive: false });
            void refreshBalance(resolvedAddr, honestChain);
            wcEvent('email_attach_fallback_ok');
            return true;
          } catch {
            // fallback itself failed — will be reported as pending by caller
            return false;
          }
        }
        return false;
      }
    },
    [attachInjectedListeners, detachInjectedListeners, refreshBalance]
  );

  /* --------------------------- WalletConnect v2 -------------------------- */

  /**
   * The one session object for this page, created on first use.
   *
   * Its events are the only channel from src/lib/wc/ into React, and they are
   * deliberately narrow: a pairing URI, the relay measurement, which surface
   * owns the screen, account/chain changes, and the end of a session.
   */
  const getWcSession = useCallback(() => {
    if (wcRef.current) return wcRef.current;
    const session = createWcSession({
      metadata: wcMetadata(),
      chains: [DEFAULT_CHAIN],
      optionalChains: Object.keys(EVM_CHAINS).map(Number),
      supportsChain: (id) => Boolean(EVM_CHAINS[id]),
      defaultChain: DEFAULT_CHAIN
    });

    session.on('uri', ({ uri }) => setWcPairUri(uri));
    session.on('relay', (relay) => setWcRelay(relay));
    session.on('modal', ({ active }) => setWcModalActive(Boolean(active)));
    session.on('accounts', ({ address: next }) => setAddress(next));
    session.on('chain', ({ chainId: next }) => setChainId(EVM_CHAINS[next] ? next : DEFAULT_CHAIN));

    session.on('closed', ({ reason }) => {
      /* Only session_delete / session_expire / an explicit disconnect end a
         session. A relay drop is transient and is traced, never translated
         into a teardown — that policy is the whole answer to "Trust Wallet
         disconnects by itself". */
      if (reason === 'session_expire') {
        try { useAppStore.getState().notify('walletSessionExpired', 'info'); } catch { /* toasts are optional */ }
      }
      disconnectRef.current();
    });

    wcRef.current = session;
    return session;
  }, []);

  /** Start a new pairing. */
  const connectWalletConnect = useCallback(
    async ({ force = false } = {}) => {
      if (connecting) return false;
      setError(null);
      setConnecting(true);
      const connectGuard = holdRefreshGuard('wc-connect');
      try {
        const result = await getWcSession().connect({ force });
        if (!result.ok) {
          if (result.code !== 'WC_BUSY') setError(result.code);
          return false;
        }
        const attached = await attachExternal({
          eip: result.provider,
          address: result.address,
          chainId: result.chainId,
          mode: 'wc'
        });
        if (!attached) setError('CONNECT_FAILED');
        return attached;
      } finally {
        setConnecting(false);
        connectGuard.release();
      }
    },
    [attachExternal, connecting, getWcSession]
  );

  /**
   * Re-attach a persisted session without a new pairing.
   *
   * Opportunistic: it fails quiet, because the explicit Connect button is the
   * real path and a resume must never stall behind a relay probe. The session
   * object itself refuses to even open a socket unless a session is on disk.
   */
  const restoreWcSession = useCallback(
    async ({ announce = false } = {}) => {
      if (addressRef.current) return false;
      const session = getWcSession();
      const result = await session.restore();
      if (!result.ok) return false;
      /* COMMIT GUARD: restore is async, so a wallet attached while it was in
         flight (the local vault auto-attach runs synchronously on mount) must
         not be overwritten by a slower session resume. The user's latest
         explicit choice wins; the resumed provider is torn down instead. */
      if (addressRef.current) {
        await session.disconnect();
        wcEvent('restore_skipped_local');
        return false;
      }
      const attached = await attachExternal({
        eip: result.provider,
        address: result.address,
        chainId: result.chainId,
        mode: 'wc'
      });
      if (attached && announce) {
        try { useAppStore.getState().notify('walletSessionRestored', 'success'); } catch { /* optional */ }
      }
      return attached;
    },
    [attachExternal, getWcSession]
  );

  /** Cancel an in-flight pairing. Safe when nothing is pairing. */
  const cancelWcPairing = useCallback(async () => {
    setWcPairUri(null);
    const session = wcRef.current;
    if (!session) return false;
    return session.cancel();
  }, []);

  /* --------------------- email & social (embedded wallet) ---------------- */

  const connectEmailSocial = useCallback(async () => {
    if (connecting) return false;
    setError(null);
    setConnecting(true);
    const connectGuard = holdRefreshGuard('email-connect');
    try {
      if (eip1193Ref.current || wcRef.current?.provider) disconnectRef.current();
      /*
       * AWAITED, NOT FIRED-AND-FORGOTTEN — the stale-marker race (report
       * 2026-09-18: `ourMarker:true`, `sdkLoginMarker:false`).
       *
       * Every other cleanup of the embedded wallet runs as `void
       * forgetEmbeddedWallet()` — the `[mode]` effect, `disconnect()` — which
       * means the marker can still be standing when the user's NEXT tap reads
       * it. `openEmbeddedWallet` treats a standing marker as «a login is
       * claimed» and skips the whole clean-slate path (no purge, no shared
       * reset, no dirty-retire) — so one abandoned attempt could poison every
       * later one. Awaiting the bounded forget (4s cap inside) converts the
       * tap itself into the barrier: by the time `open()` reads the marker it
       * is honestly gone.
       *
       * TWO guards, because the marker alone cannot tell stale from owed:
       *   • mode 'email' — an email wallet IS attached; its marker describes
       *     a session the user is owed. Never forgotten on a re-tap.
       *   • the SDK's own login marker still standing — the frame may hold a
       *     live session one provider-poll away from attaching (the
       *     EMAIL_PROVIDER_PENDING retry). Forgetting it would log the user
       *     out from under themselves. When it is GONE (the reported state:
       *     the frame answered «not connected» and deleted its record), our
       *     marker is a claim nobody can honour — forget it.
       */
      if (modeRef.current !== 'email' && !sdkLoginMarkerPresent()) {
        try {
          await forgetEmbeddedWallet();
        } catch { /* bounded best-effort: the fresh path still purges */ }
      }
      setEmailModalActive(true);
      let result = await openEmbeddedWallet({ projectId: WC_PROJECT_ID, metadata: wcMetadata() });

      // If provider is missing but address exists, retry — slow WebViews + Telegram
      if (result.ok && !result.provider && result.address) {
        wcEvent('email_retry_provider');
        const { getAppKit, authConnectorProvider } = await import('../lib/wc/embedded.js');
        for (let i = 0; i < 10; i += 1) {
          await new Promise((r) => setTimeout(r, 600));
          try {
            const modal = await getAppKit({ projectId: WC_PROJECT_ID, metadata: wcMetadata() });
            const p = modal.getWalletProvider?.()
              || modal.getWalletProvider?.('eip155')
              || modal.getProvider?.('eip155')
              || modal.getProvider?.()
              || (await authConnectorProvider());
            if (p) {
              // Verify it doesn't throw Action not allowed
              try {
                await p.request?.({ method: 'eth_accounts' });
                result = { ...result, provider: p, code: undefined };
                break;
              } catch (e) {
                const m = String(e?.message || '').toLowerCase();
                if (!m.includes('not allowed') && !m.includes('not valid')) {
                  result = { ...result, provider: p, code: undefined };
                  break;
                }
                // else keep retrying — frame not ready yet
              }
            }
          } catch { /* retry */ }
        }
      }

      if (!result.ok) {
        setError(result.code === 'CONNECT_FAILED' ? 'CONNECT_FAILED' : result.code);
        return false;
      }

      // Normal path with provider — now with fallback attach that never throws away address
      let attached = false;
      if (result.provider) {
        attached = await attachExternal({
          eip: result.provider,
          address: result.address,
          chainId: null,
          mode: 'email'
        });
      }

      // Retry attach up to 3 times with backoff (provider may need a tick after OTP)
      for (let attempt = 0; attempt < 3 && !attached && result.provider && result.address; attempt += 1) {
        await new Promise((r) => setTimeout(r, 800 + attempt * 400));
        try {
          // Re-fetch provider in case it became usable
          const { getAppKit, authConnectorProvider } = await import('../lib/wc/embedded.js');
          let freshProvider = result.provider;
          try {
            const modal = await getAppKit({ projectId: WC_PROJECT_ID, metadata: wcMetadata() });
            freshProvider = modal.getWalletProvider?.()
              || modal.getWalletProvider?.('eip155')
              || modal.getProvider?.('eip155')
              || (await authConnectorProvider())
              || freshProvider;
          } catch {}
          attached = await attachExternal({
            eip: freshProvider,
            address: result.address,
            chainId: null,
            mode: 'email'
          });
        } catch {}
      }

      // Last resort: if we have address but provider still not attachable, try minimal attach
      // (attachExternal's fallback already does this, but we also try direct)
      if (!attached && result.address) {
        try {
          // Try to get any provider again
          const { getAppKit, authConnectorProvider } = await import('../lib/wc/embedded.js');
          const modal = await getAppKit({ projectId: WC_PROJECT_ID, metadata: wcMetadata() });
          const p = modal.getWalletProvider?.()
            || modal.getProvider?.('eip155')
            || (await authConnectorProvider())
            || result.provider;
          if (p) {
            attached = await attachExternal({
              eip: p,
              address: result.address,
              chainId: null,
              mode: 'email'
            });
          }
        } catch {}
      }

      if (attached) {
        setEmailMarker(true);
        wcEvent('email_connected_final');
      } else {
        // Even if attach failed, keep marker so next cold start / foreground return retries.
        // The fallback in attachExternal should have made this rare — if we are here,
        // the frame really isn't ready, so we surface EMAIL_PROVIDER_PENDING which
        // tells user «اتصال شما از دست نرفته» and retry will work.
        if (result.address) {
          setEmailMarker(true);
          setError('EMAIL_PROVIDER_PENDING');
          wcEvent('email_attach_failed_pending');
        } else {
          setError('CONNECT_FAILED');
          wcEvent('email_attach_failed_final');
        }
      }
      return attached;
    } catch (e) {
      wcEvent('email_connect_exception');
      setError('CONNECT_FAILED');
      return false;
    } finally {
      setEmailModalActive(false);
      setConnecting(false);
      connectGuard.release();
    }
  }, [attachExternal, connecting]);

  /**
   * Rehydrate a returning embedded wallet.
   *
   * Single-flight: three callers can ask within the same second (cold start, a
   * bfcache `pageshow`, a foreground resume) and each would otherwise arm its
   * own wait. Failing the second quietly is correct — the first is already
   * doing exactly what it asked for.
   */
  const restoreEmailSocial = useCallback(async () => {
    if (addressRef.current) return false;
    if (!hasEmailMarker()) return false;
    if (emailRestoreRef.current) return false;
    emailRestoreRef.current = true;
    try {
      const result = await restoreEmbeddedWallet({ projectId: WC_PROJECT_ID, metadata: wcMetadata() });
      /* A STALE marker was already forgotten by the stack (storage + shared
         controllers + instance). The marker check at the top of `resume()`
         therefore lets the WalletConnect restore run on this same boot instead
         of leaving the user with neither wallet. */
      if (result.code === 'STALE_CLEARED') wcEvent('email_restore_stale');
      if (!result.ok) return false;
      if (addressRef.current) return false;
      return await attachExternal({
        eip: result.provider,
        address: result.address,
        chainId: null,
        mode: 'email'
      });
    } catch {
      /* offline or a blocked chunk: the marker survives for the next boot */
      wcEvent('email_restore_failed');
      return false;
    } finally {
      emailRestoreRef.current = false;
    }
  }, [attachExternal]);

  /* ------------------------------ local vault ---------------------------- */

  /**
   * The network an in-app wallet should come up on.
   *
   * Unlocking used to hard-set DEFAULT_CHAIN, which threw the user off the
   * network they had just picked: choose Base, unlock, and the app is back on
   * BNB Smart Chain with the signer re-pointed at BSC's RPC. Nothing crashed —
   * the label and the signer agreed — but the next "send USDT" was a BSC
   * transfer the user never asked for. The signer is always connected to
   * whichever chain this returns, so the two can never disagree.
   */
  const localTargetChain = useCallback(() => {
    const current = Number(chainIdRef.current);
    return EVM_CHAINS[current] ? current : DEFAULT_CHAIN;
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
   * Attach the memory-only signer returned while a new vault was encrypted —
   * avoiding a second PBKDF2 pass while still checking it matches disk state.
   */
  const attachCreatedLocal = useCallback(
    async (createdSigner) => {
      const vault = loadVault();
      if (!vault || !createdSigner) return false;
      const cid = localTargetChain();
      try {
        const signerAddress = createdSigner.address || (await createdSigner.getAddress());
        if (signerAddress.toLowerCase() !== vault.address.toLowerCase()) return false;
        const provider = await getReadProvider(cid);
        const signer = createdSigner.provider ? createdSigner : createdSigner.connect(provider);
        /* Only after the vault has PROVED it matches disk state: entering local
           mode is an explicit mode switch, so a live WalletConnect session is
           torn down here. A FAILED attach must not tear anything down. */
        void wcRef.current?.disconnect();
        signerRef.current = signer;
        eip1193Ref.current = createLocalEip1193Adapter({
          signer,
          account: signerAddress,
          chainId: cid,
          getReadProvider
        });
        setMode('local');
        setAddress(signerAddress);
        setChainId(cid);
        setLocked(false);
        setError(null);
        void refreshBalance(signerAddress, cid);
        return true;
      } catch {
        setError('UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, refreshBalance, localTargetChain]
  );

  const unlockLocal = useCallback(
    async (password) => {
      setError(null);
      const cid = localTargetChain();
      try {
        const provider = await getReadProvider(cid);
        const signer = await unlockVault(password, provider);
        /* Same teardown — and only AFTER the password has proven correct: a
           BAD_PASSWORD must leave an existing connection exactly as it was. */
        void wcRef.current?.disconnect();
        signerRef.current = signer;
        eip1193Ref.current = createLocalEip1193Adapter({
          signer,
          account: signer.address,
          chainId: cid,
          getReadProvider
        });
        setMode('local');
        setAddress(signer.address);
        setChainId(cid);
        setLocked(false);
        void refreshBalance(signer.address, cid);
        return true;
      } catch (e) {
        setError(e?.message === 'BAD_PASSWORD' ? 'BAD_PASSWORD' : 'UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, refreshBalance, localTargetChain]
  );

  /** Drop the in-memory signer but keep the encrypted vault on disk. */
  const lock = useCallback(() => {
    signerRef.current = null;
    setLocked(true);
  }, []);

  /**
   * Delete the encrypted vault AND release every live connection, so
   * "forget the in-app wallet" and "disconnect" leave the same clean slate.
   */
  const forgetLocalWallet = useCallback(() => {
    clearVault();
    disconnectRef.current();
  }, []);

  /* ------------------------------ disconnect ----------------------------- */

  const disconnect = useCallback(() => {
    wcEvent('local_disconnect');
    /* WalletConnect first: tell the peer the session is over (bounded — a dead
       relay must never stall the UI) and purge the storage artifacts, then
       retire the email/social session, then the injected listeners. */
    void wcRef.current?.disconnect();
    void forgetEmbeddedWallet();
    /* The SDK writes its storage asynchronously; a late write can resurrect
       keys after the synchronous purge, so a delayed second purge catches that
       window without blocking anything. */
    try {
      setTimeout(() => {
        try { purgeConnectionKeys(); } catch { /* storage unavailable */ }
      }, 700);
    } catch { /* no timers either — nothing to do */ }
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
    setWcPairUri(null);
  }, [detachInjectedListeners]);

  disconnectRef.current = disconnect;

  /* --------------------------- network switching ------------------------- */

  const switchChain = useCallback(
    async (targetId) => {
      const cfg = EVM_CHAINS[targetId];
      if (!cfg) return false;
      const eip = eip1193Ref.current;
      if (!eip || mode === 'local') {
        /* A local ethers Wallet is connected to a concrete Provider: merely
           changing the React label would leave the signer broadcasting to the
           old network — catastrophic for a same-address contract call. */
        if (signerRef.current?.connect) {
          signerRef.current = signerRef.current.connect(await getReadProvider(targetId));
          eip1193Ref.current = createLocalEip1193Adapter({
            signer: signerRef.current,
            account: addressRef.current,
            chainId: targetId,
            getReadProvider
          });
        }
        setChainId(targetId);
        return true;
      }
      /*
       * THE EMBEDDED WALLET NEVER SEES `wallet_switchEthereumChain`.
       *
       * The secure frame's guard accepts only the methods on its SAFE/NOT_SAFE
       * lists, and `wallet_switchEthereumChain` is on NEITHER: AppKit answers
       * such a request by OPENING the modal, showing «Action not allowed» and
       * calling `provider.rejectRpcRequests()` — which aborts every pending
       * RPC, a login included. That is the error string the device reports
       * carry. The frame DOES implement a switch, through the adapter
       * (`APP_SWITCH_NETWORK`), so the email mode goes that way and a chain
       * the frame cannot serve is refused locally instead of being asked for.
       */
      if (mode === 'email') {
        const { switchEmbeddedNetwork } = await import('../lib/wc');
        const result = await switchEmbeddedNetwork(targetId);
        return result === 'ok';
      }
      try {
        await eip.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.hexId }] });
        /* chainChanged fires next; let it set chainId rather than racing it. */
        return true;
      } catch (e) {
        const code = e?.code ?? e?.error?.code;
        if (code === 4902) {
          /* Chain missing: propose adding it, from our own registry — never
             accept client-supplied RPC/explorer URLs. */
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
          } catch {
            return false;
          }
        }
        /* 4001 = user rejected; -32002 = request already pending. Both non-fatal. */
        return false;
      }
    },
    [getReadProvider, mode]
  );

  /* --------------------- cold start and foreground return ---------------- */

  useEffect(() => {
    /*
     * ORPHANED STORAGE HYGIENE.
     *
     * A stale deep-link choice or recent-wallet key makes the NEXT connect skip
     * the modal and open a wallet app with a dead pairing, so an idle cold
     * start that has nowhere to restore may clean the residue it can prove is
     * dead. Vault-agnostic (the encrypted vault never uses these keys) but
     * email-guarded: when the email marker stands, those @appkit/* keys belong
     * to the embedded wallet's own instance and must not be churned.
     */
    try {
      const facts = storageFacts();
      if (facts.orphanKeys && !hasEmailMarker() && !addressRef.current) {
        const purged = purgeConnectionKeys();
        if (purged) wcEvent('orphan_storage_purged', Number(purged));
      }
    } catch { /* the check is advisory */ }

    /*
     * THE TWO RESTORES, MUTUALLY GATED.
     *
     * A user whose LAST connection was the embedded wallet must not have an
     * older WalletConnect session restored ON TOP of it — so nothing else runs
     * while that marker stands. But the marker must not be able to STARVE
     * WalletConnect either: restoreEmbeddedWallet() hands the marker back when
     * AppKit itself says nothing is connected, and only then is the stored
     * `wc@2:` session — the user's real wallet — probed.
     *
     * A marker still standing means AppKit could not answer (its frame is
     * blocked or slow, so the session inside may yet be live): no other wallet
     * may preempt that, and the next foreground return asks again. That is the
     * difference between «one slow boot» and «the wallet is gone forever».
     */
    const resumeWc = (announce) => {
      void restoreWcSession({ announce });
    };
    const resumeEmailThenWc = (announce) => {
      void restoreEmailSocial().then((ok) => {
        if (ok || addressRef.current || hasEmailMarker()) return;
        resumeWc(announce);
      });
    };
    const resume = (announce) => {
      if (addressRef.current) return;
      if (hasEmailMarker()) resumeEmailThenWc(announce);
      else resumeWc(announce);
    };

    /* A LOCAL VAULT WINS ON COLD START: restore is async while the vault
       auto-attach is synchronous, so without this skip the slower resume would
       overwrite the vault. The stored session is left on disk either way. */
    if (!loadVault()) resume(false);
    else if (hasEmailMarker()) wcEvent('restore_skipped_vault');

    /*
     * COMING BACK TO A PAGE THAT WAS NEVER UNLOADED.
     *
     * The mount path above only runs for a FRESH document. Every mobile return
     * can instead resume the SAME document:
     *   • the APK's WebView never reloads when the user leaves for Trust and
     *     comes back — `visibilitychange` is the only signal it gets;
     *   • iOS Safari (and Chrome's bfcache) RESTORE a frozen page, firing
     *     `pageshow` with `persisted === true` and no mount at all;
     *   • while frozen, the relay socket the pairing was waiting on is closed by
     *     the browser, so "the promise will settle by itself" is not a property
     *     the page can rely on.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') resume(true);
    };
    const onPageShow = (event) => {
      /* The initial load fires this too (persisted === false) — the mount path
         above already owns that one. */
      if (event?.persisted) resume(false);
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

  useEffect(() => {
    if (!address && loadVault()) attachLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Attaching any OTHER wallet mode retires the email/social boot marker —
   * otherwise the next cold start would resurrect the email wallet and
   * overwrite the connection the user just chose. 'email' is excluded: its
   * marker is the one this transition claims.
   */
  useEffect(() => {
    if (mode && mode !== 'email') void forgetEmbeddedWallet().catch(() => {});
  }, [mode]);

  /* The "connect your wallet" quest, fired where it actually happens: watching
     `address` covers all four modes, including the auto-attach path a returning
     user takes without pressing anything. `completeQuest` is idempotent. */
  useEffect(() => {
    if (address) useAppStore.getState().completeQuest('connectWallet');
  }, [address]);

  /* FBT Rewards learns the connected EVM account so every activity event
     carries wallet + chain evidence for on-chain verification. */
  useEffect(() => {
    bindRewardsIdentity({ evm: address || null, chainId: chainId ?? null });
  }, [address, chainId]);

  useEffect(() => {
    if (!address) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshBalance();
    }, 30000);
    return () => clearInterval(id);
  }, [address, refreshBalance]);

  /* Soft refresh: the header button re-reads the native balance through the
     same refreshBalance the interval uses. Nothing is remounted and, crucially,
     the WalletConnect session is not touched. If no wallet is attached, try the
     session restore once instead. */
  useEffect(() => {
    const off = onSoftRefresh(() =>
      addressRef.current ? refreshBalance() : restoreWcSession({ announce: true })
    );
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      /* Email & social login — the secure embedded wallet. Same attach contract
         as every other transport, mode 'email'. */
      connectEmailSocial,
      emailModalActive,
      /* The pairing surface: the URI the SDK issued for the in-flight attempt
         (null when there is none), which surface owns the screen, and the
         control that ends the attempt. The sheet renders the QR and the wallet
         buttons from that one string. */
      wcPairUri,
      wcModalActive,
      /* The measured relay, so the sheet and the health panel read the SAME
         measurement the connect flow used. */
      wcRelay,
      wcRelayBlocked,
      /* Exposed so the sheet builds the same explorer logo URLs with no second
         copy of the project id. */
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
      /* Phase 51 — the Intent AI execution path needs the RAW EIP-1193 provider,
         not an ethers wrapper: it asks the connected wallet to sign the locked
         terms itself. Returning null (rather than a stand-in) is what keeps
         `venueHealth` honest when nothing is connected. */
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
