import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../lib/chains';
import { clearVault, loadVault, unlockVault } from '../lib/localWallet';
import { clearPortfolioSnapshot } from '../lib/portfolioSnapshot';
import { useSettingsStore } from '../store/useSettingsStore';
import { isIOS as isIOSDevice } from '../lib/platform';
import { holdRefreshGuard, onSoftRefresh } from '../lib/refresh';
import { bindRewardsIdentity } from '../lib/rewards/rewardsReporter';
import {
  WC_PROJECT_ID,
  bringWalletToFront,
  clearWalletLease,
  createWcSession,
  guardEip1193,
  hasStoredSession,
  purgeConnectionKeys,
  purgeEmbeddedWalletKeys,
  readWalletLease,
  rememberedMobileWallet,
  storageFacts,
  walletLeaseMinutes,
  walletLeaseRemainingMinutes,
  walletRestoreDelay,
  walletRestorePlan,
  wcEvent,
  wcEventDetail,
  wcMetadata,
  writeWalletLease
} from '../lib/wc';

/**
 * NON-CUSTODIAL WALLET LAYER
 * ---------------------------------------------------------------------------
 * Three connection modes, all self-custody. In every one of them the private
 * key stays with the user and this app never sees, stores or transmits it:
 *
 *   1. `injected` — window.ethereum / EIP-6963 (desktop extensions, a wallet's
 *      own in-app browser)
 *   2. `wc`       — WalletConnect v2 (QR on desktop, deep link on a phone)
 *   3. `local`    — an in-app wallet whose seed is AES-GCM encrypted on-device
 *
 * There USED to be a fourth: `email`, the Reown AppKit "embedded wallet"
 * provisioned behind an email OTP or a social login. It was retired on
 * 2026-09-18 at the owner's request — it needed a second `createAppKit()`
 * instance sharing AppKit's controllers (and the one `<w3m-modal>`) with
 * WalletConnect, and that sharing is what made an email tap open the
 * WalletConnect wallet grid and a WalletConnect cycle leave the shared state
 * describing a dead wallet. The only thing left of it here is the boot purge of
 * the keys an older build wrote (`purgeEmbeddedWalletKeys`), so a returning
 * user's device does not resurrect a frame this app has no surface for.
 *
 * There is no operator wallet, no deposit address and no server-side signing
 * anywhere in this codebase. Transactions are built client-side and signed by
 * whichever wallet the user chose.
 *
 * ─── A CONNECTION SURVIVES THE DOCUMENT ────────────────────────────────────
 * React state dies with the tab, and an injected provider dies with it too, so
 * «connected» used to mean «connected until the next refresh» — the reported
 * bug («پس از رفرش کیف پول متصل دیسکانکت می‌شه»). What carries the connection
 * across a reload is a SESSION LEASE (src/lib/wc/lease.js): a small localStorage
 * record naming the transport, the address and an expiry, rolled while the app
 * is in use and read by the cold start, which then re-attaches
 *
 *   • WalletConnect  — by resuming the stored `wc@2:` session,
 *   • injected       — by a SILENT `eth_accounts` re-attach (never a prompt),
 *   • local vault    — by the existing synchronous attach,
 *
 * with a bounded retry ladder behind all three and a `restoring` flag the UI
 * shows instead of «وصل نیست». How long the window lasts is the user's answer in
 * Settings → Security (`walletSessionMinutes`, 60 by default, 0 = until they
 * disconnect). An explicit disconnect clears the lease FIRST, so «قطع اتصال»
 * means it on the next document as well as this one.
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

/** Only the three transports can hold a lease; anything else is WalletConnect. */
const leaseModeOf = (value) => (value === 'injected' || value === 'local' ? value : 'wc');

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
  const [mode, setMode] = useState(null); // 'injected' | 'wc' | 'local'
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
  /*
   * THE SESSION LEASE — «this device has a wallet until <time>».
   *
   * `lease` is the render-time view of the record in localStorage (mode,
   * address, expiry) and `restoring` is the sentence the UI needs while the
   * app is re-attaching it after a reload: without that flag a user watching a
   * silent re-attach sees «وصل نیست» and taps Connect again — which is how a
   * working background resume turns into a second approval screen.
   * See src/lib/wc/lease.js for the whole design.
   */
  const [lease, setLease] = useState(() => readWalletLease());
  const leaseRef = useRef(lease);
  leaseRef.current = lease;
  const [restoring, setRestoring] = useState(false);
  /** One re-attach timer at a time, plus how many attempts it has made. */
  const restoreTimerRef = useRef(null);
  const restoreAttemptRef = useRef(0);
  /**
   * A terminal answer about the session the lease describes.
   *
   * Two facts stop the ladder for good: the window the user chose lapsed, and
   * the WalletConnect session is gone from this device. Both are explained on
   * the connect sheet, and neither is «وصل نیست» — but neither justifies
   * promising a re-attach that cannot happen either, so `restoring` comes down
   * for them and only for them (see settleRestoring). Cleared by the next
   * successful attach and by a fresh Connect.
   */
  const restoreBlockedRef = useRef(null);
  /** Last time the lease was rolled forward, so a busy tab writes rarely. */
  const leaseTouchedRef = useRef(0);
  /** Which address `nativeBalance` describes — see refreshBalance(). */
  const balanceAddressRef = useRef(null);

  /* Kept in refs so a signer or provider never lands in React state (and thus
     never in a devtools snapshot or a serialized store). */
  const signerRef = useRef(null);
  const eip1193Ref = useRef(null);
  /** EIP-6963 discovered providers: Map<uuid, { info, provider }>. */
  const eip6963Ref = useRef(new Map());
  const injectedListenersRef = useRef(null);
  /** One WalletConnect session object for the page lifetime. */
  const wcRef = useRef(null);

  /* Pairing surface: the URI the SDK issued for the in-flight attempt (null
     when there is none), and which surface currently owns the screen. A URI
     left in state after an attempt settles is how a wallet gets opened on a
     pairing that no longer exists. */
  const [wcPairUri, setWcPairUri] = useState(null);
  const [wcModalActive, setWcModalActive] = useState(false);
  /** The measured relay state — see src/lib/wc/relay.js. */
  const [wcRelay, setWcRelay] = useState(null);
  const wcRelayBlocked = Boolean(wcRelay && ['WS_REFUSED', 'UNREACHABLE', 'TIMEOUT'].includes(wcRelay.verdict));

  /* Render-time mirrors for event handlers that must not close over a stale
     copy (the visibilitychange restore path, the commit guards). */
  const addressRef = useRef(null);
  addressRef.current = address;
  const chainIdRef = useRef(null);
  chainIdRef.current = chainId;
  const modeRef = useRef(null);
  modeRef.current = mode;
  const disconnectRef = useRef(() => {});
  /** The user's «how long should the wallet stay connected» answer. */
  const walletSessionMinutes = useSettingsStore((s) => s.walletSessionMinutes);

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

  /**
   * Read the native balance.
   *
   * ─── THE LAST GOOD VALUE IS KEPT (2026-09-18 report) ─────────────────────
   * This used to `setNativeBalance(null)` on ANY throw. A public RPC that
   * answered slowly, a rate limit, a moment of bad signal — each one replaced a
   * correct number the user was reading with an empty state, and the interval
   * below runs every 30 seconds, so the wallet's balance flickered between a
   * real figure and nothing while nothing was actually wrong. A failed read is
   * not evidence of a zero balance, and it is certainly not evidence that the
   * number we already had is wrong.
   *
   * So the last value survives a failed refresh and is only ever replaced by a
   * NEWER, successful read of the SAME address. A different address (the user
   * switched wallets) clears it first, because showing wallet A's balance under
   * wallet B's address is a money-screen error rather than a stale one.
   */
  const refreshBalance = useCallback(
    async (addr = address, cid = chainId ?? DEFAULT_CHAIN) => {
      if (!addr) return;
      const key = String(addr).toLowerCase();
      if (balanceAddressRef.current && balanceAddressRef.current !== key) setNativeBalance(null);
      try {
        const { formatEther } = await loadEthers();
        const provider = await getReadProvider(cid);
        const wei = await provider.getBalance(addr);
        balanceAddressRef.current = key;
        setNativeBalance(Number(formatEther(wei)));
      } catch {
        /* Keep the last known number: see the note above. */
      }
    },
    [address, chainId, getReadProvider]
  );

  /* ----------------------------- session lease ---------------------------- */
  /*
   * ONE RECORD, THREE TRANSPORTS.
   *
   * Everything below is the answer to «پس از رفرش کیف پول متصل دیسکانکت می‌شه»:
   * a small localStorage record saying which transport carries the connection,
   * on which address, and until when — written when a wallet attaches, rolled
   * while the app is in use, and read by the cold start to re-attach silently.
   * See src/lib/wc/lease.js for the record itself and the restore policy.
   */

  /** Write the lease for an attach that just succeeded. */
  const grantLease = useCallback(({ address: acct, chainId: cid, mode: leaseMode, rdns = null }) => {
    if (!acct) return null;
    const minutes = walletLeaseMinutes(useSettingsStore.getState().walletSessionMinutes);
    const record = writeWalletLease({
      address: acct,
      chainId: cid,
      mode: leaseModeOf(leaseMode),
      rdns,
      minutes
    });
    if (!record) {
      /* Storage blocked (private mode / partitioned WebView): the connection
         still works for this document — only the resume across a reload is
         lost, and the trace says so instead of pretending it was saved. */
      wcEvent('lease_write_failed');
      return null;
    }
    const stored = readWalletLease() ?? record;
    leaseRef.current = stored;
    setLease(stored);
    leaseTouchedRef.current = Date.now();
    restoreAttemptRef.current = 0;
    /* A wallet is attached: whatever we last said about a missing session is
       no longer true, and the ladder may start again from the first rung. */
    restoreBlockedRef.current = null;
    setRestoring(false);
    wcEvent('lease_granted', minutes);
    return record;
  }, []);

  /**
   * Roll the lease forward while the app is open and a wallet is attached.
   *
   * A connection IN USE must not lapse under the user's hands, so every visit,
   * refresh and minute of use restarts the window. It is also what repairs a
   * connection made before this feature existed: no lease on disk plus a
   * connected address writes one on the first touch.
   */
  const rollLease = useCallback(
    ({ force = false } = {}) => {
      const current = leaseRef.current;
      const acct = addressRef.current || current?.address || null;
      if (!acct) return null;
      if (current && !current.alive) return null;
      const now = Date.now();
      const since = leaseTouchedRef.current || current?.issuedAt || 0;
      if (!force && current && now - since < 60_000) return current;
      return grantLease({
        address: acct,
        chainId: chainIdRef.current ?? current?.chainId ?? null,
        mode: current?.mode ?? modeRef.current ?? 'wc',
        rdns: current?.rdns ?? null
      });
    },
    [grantLease]
  );

  /** Forget the lease and cancel every scheduled re-attach. */
  const dropLease = useCallback(() => {
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    restoreAttemptRef.current = 0;
    leaseTouchedRef.current = 0;
    const had = Boolean(leaseRef.current);
    leaseRef.current = null;
    setLease(null);
    clearWalletLease();
    if (had) wcEvent('lease_cleared');
  }, []);

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
   * `destructive: false` for the remote transport (WalletConnect). Some
   * wallets — Trust among them — emit an EMPTY accountsChanged
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
        /* THE LINE THAT MAKES AN INJECTED WALLET SURVIVE A RELOAD.
           Nothing about an injected provider can be persisted — the provider
           object belongs to the extension and dies with the document — so what
           survives is the DECISION: this address, this rdns, until <time>. The
           cold start re-reads it and re-attaches silently (see
           restoreInjected), which is why MetaMask no longer disappears when the
           page is refreshed. */
        grantLease({
          address: accounts[0],
          chainId: Number(net.chainId),
          mode: 'injected',
          rdns: matchedInfo?.rdns ?? rdns ?? null
        });
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
    [attachInjectedListeners, detachInjectedListeners, grantLease, refreshBalance]
  );

  /**
   * SILENTLY re-attach the injected wallet the lease remembers.
   *
   * ─── WHY `eth_accounts` AND NEVER `eth_requestAccounts` ──────────────────
   * `eth_accounts` answers with the accounts this origin is ALREADY permitted
   * to see, and opens nothing: for a wallet that has approved us it returns the
   * address, and for one that has not it returns `[]`. `eth_requestAccounts`
   * would open the wallet on every page load — a prompt the user did not ask
   * for, and for a locked wallet a permanent one.
   *
   * A wallet that answers `[]` (locked, or the permission was revoked) leaves
   * the lease alone and the scheduled retry ladder keeps trying, so unlocking
   * the wallet is enough to bring the connection back — no Connect tap needed.
   */
  const restoreInjected = useCallback(
    async (rdns, expected) => {
      const announced = eip6963Ref.current;
      let target = null;
      let matchedInfo = null;
      if (rdns) {
        for (const { info, provider } of announced.values()) {
          if (info.rdns === rdns) {
            target = provider;
            matchedInfo = info;
            break;
          }
        }
        /* A named wallet that has not announced itself yet is ABSENT, not
           replaced by window.ethereum: attaching Trust because MetaMask was
           slower to announce would connect the wrong wallet on the strength of
           a record that names the other one. */
        if (!target) {
          wcEvent('lease_injected_absent', announced.size);
          return false;
        }
      } else if (typeof window !== 'undefined' && window.ethereum) {
        target = window.ethereum;
      }
      if (!target) {
        wcEvent('lease_injected_absent', 0);
        return false;
      }

      let accounts = [];
      try {
        accounts = await target.request?.({ method: 'eth_accounts' });
      } catch {
        accounts = [];
      }
      const acct = Array.isArray(accounts) ? accounts[0] : null;
      if (!acct) {
        wcEvent('lease_injected_locked');
        return false;
      }
      if (expected && String(acct).toLowerCase() !== String(expected).toLowerCase()) {
        /* The wallet is on a different account than the lease recorded. The
           WALLET is the authority on which account is active — the lease only
           ever remembers — so the new account is honoured. */
        wcEvent('lease_injected_account_changed');
      }

      try {
        const { BrowserProvider } = await loadEthers();
        const provider = new BrowserProvider(target, 'any');
        let cid = leaseRef.current?.chainId ?? DEFAULT_CHAIN;
        try {
          const net = await provider.getNetwork();
          const n = Number(net?.chainId);
          if (EVM_CHAINS[n]) cid = n;
        } catch { /* the leased chain stands */ }
        const signer = await provider.getSigner();
        detachInjectedListeners();
        eip1193Ref.current = target;
        signerRef.current = signer;
        setMode('injected');
        setInjectedInfo(matchedInfo);
        setAddress(acct);
        setChainId(cid);
        setLocked(false);
        setError(null);
        attachInjectedListeners(target);
        void refreshBalance(acct, cid);
        wcEvent('lease_injected_restored');
        return true;
      } catch (err) {
        wcEventDetail('lease_injected_attach_err', { m: String(err?.message || err || '') });
        return false;
      }
    },
    [attachInjectedListeners, detachInjectedListeners, refreshBalance]
  );

  /* ─────────── the signing boundary (see lib/wc/signing.js) ───────────────
   *
   * Every signature and every transaction this app asks a remote wallet for
   * goes through one wrapper: it preflights the request against the session
   * (method, chain, account, relay socket), bounds the wait on a clock that
   * pauses while the user is in the wallet, and names the failure honestly
   * instead of reporting «شبکه در دسترس نیست» for a request the wallet never
   * received.
   */
  const nudgeRef = useRef(0);

  /**
   * Bring the wallet the session belongs to back to the front, once, right
   * after a request is published.
   *
   * Phone browsers only: a desktop session paired over a QR must never have an
   * app launched at it, and inside a wallet's own browser the injected
   * transport is in use anyway (this runs for WalletConnect sessions only).
   */
  const nudgeWalletApp = useCallback(({ method }) => {
    try {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
      if (!/Android|iPhone|iPad|iPod/i.test(String(navigator.userAgent || ''))) return;
      const wallet = rememberedMobileWallet();
      if (!wallet) return;
      const now = Date.now();
      /* One nudge per request burst: an approval flow can publish two requests
         (permit, then deposit) and the second must not yank the phone back out
         of the wallet mid-signature. */
      if (now - nudgeRef.current < 4000) return;
      nudgeRef.current = now;
      window.setTimeout?.(() => {
        void bringWalletToFront(wallet);
        try {
          wcEventDetail('sign_wallet_nudged', { m: String(method || '') });
        } catch { /* the trace ring is not load-bearing */ }
      }, 120);
    } catch {
      /* A nudge that fails is not a failed signature. */
    }
  }, []);

  /* --------------------- one adapter for every transport ------------------ */

  /**
   * Attach an external EIP-1193 provider — a WalletConnect session — to the
   * same signer state an injected wallet uses.
   *
   * `chainId` is passed in by the caller because the transport knows the
   * network the wallet actually approved, which is NOT what the EIP-1193
   * object reports on its first tick (see src/lib/wc/chain.js).
   *
   * ─── WHY ADDRESS AND CHAIN ARE READ WITHOUT ETHERS FIRST ─────────────────
   * `BrowserProvider.getSigner()` internally does `eth_accounts`, and on a slow
   * mobile WebView that answer can land a beat after the session is already
   * usable. Treating ANY throw as fatal turned one slow tick into a permanent
   * loss («کیف پول در این صفحه آماده نشد»), so the direct EIP-1193 reads run
   * first, and the error a failed attach carries is sanitized into the trace —
   * the next report names the failing RPC instead of «attach_failed».
   *
   * There is deliberately NO degraded fallback any more. The one that existed
   * (a hand-rolled signer proxying `personal_sign`) was written for the email
   * frame, whose `eth_accounts` answered empty while a session was being
   * rehydrated; a WalletConnect provider that cannot produce a signer is
   * broken, and attaching it as "connected" only moves the failure into the
   * user's next swap.
   */
  const attachExternal = useCallback(
    async ({ eip, address: acct, chainId: cid, mode: nextMode, rdns = null }) => {
      if (!eip || !acct) {
        wcEvent('wc_attach_no_provider');
        return false;
      }

      // ── 1. Resolve address / chainId directly via EIP-1193, no ethers ──
      let resolvedAddr = acct;
      let resolvedCid = cid != null ? Number(cid) : null;

      if (!resolvedAddr) {
        try {
          const accs = await eip.request?.({ method: 'eth_accounts' });
          if (Array.isArray(accs) && accs[0]) resolvedAddr = accs[0];
        } catch { /* nothing answered — the guard below decides */ }
      }
      if (!resolvedCid) {
        try {
          const hex = await eip.request?.({ method: 'eth_chainId' });
          if (hex) {
            const n = typeof hex === 'string' && hex.startsWith('0x') ? parseInt(hex, 16) : Number(hex);
            if (Number.isInteger(n) && n > 0) resolvedCid = n;
          }
        } catch { /* same */ }
      }

      // Still need at least an address to attach
      if (!resolvedAddr) {
        wcEvent('wc_attach_no_addr');
        return false;
      }

      const honestChain = (() => {
        if (resolvedCid && EVM_CHAINS[resolvedCid]) return resolvedCid;
        if (cid && EVM_CHAINS[Number(cid)]) return Number(cid);
        return DEFAULT_CHAIN;
      })();

      // ── 2. The ethers path: signer first, then the network it reports ──
      try {
        const { BrowserProvider } = await loadEthers();
        /*
         * THE GUARDED PROVIDER.
         *
         * `guardEip1193` is installed for the remote transport only, and it is
         * handed to ethers — so every signer the app builds from here inherits
         * it: the farm panels' `signer.sendTransaction`, the send sheet, the
         * insurance flow, Intent AI's execution path. One boundary instead of a
         * guard remembered at each call site.
         *
         * Local and injected wallets are deliberately NOT wrapped: their
         * failures are already local and legible, and a local vault signs
         * without ever leaving the page.
         */
        const guarded = nextMode === 'wc'
          ? guardEip1193(eip, {
              onSignatureRequest: nudgeWalletApp,
              onTrace: (name, detail) => {
                try {
                  wcEventDetail(name, detail);
                } catch { /* never load-bearing */ }
              }
            })
          : eip;
        const provider = new BrowserProvider(guarded, 'any');
        const signer = await provider.getSigner();
        let addrFromSigner = null;
        try {
          addrFromSigner = await signer.getAddress();
        } catch { /* the resolved address above stands */ }
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
        eip1193Ref.current = guarded;
        signerRef.current = signer;
        setMode(nextMode);
        setInjectedInfo(null);
        setAddress(finalAddr);
        setChainId(netChain);
        setLocked(false);
        attachInjectedListeners(eip, { destructive: false });
        /* Same record as the injected path: which transport, which address,
           until when. Written HERE — the one place every external provider is
           adapted — so a WalletConnect connect, a WalletConnect RESUME and an
           adopted legacy session all leave the same evidence behind. */
        grantLease({ address: finalAddr, chainId: netChain, mode: nextMode, rdns });
        void refreshBalance(finalAddr, netChain);
        wcEvent('wc_attach_ok');
        return true;
      } catch (err) {
        const msg = String(err?.message || err || '').slice(0, 120);
        try {
          wcEventDetail('wc_attach_err', { m: msg });
        } catch { /* a full trace ring is not an error */ }
        wcEvent('wc_attach_failed');
        return false;
      }
    },
    [attachInjectedListeners, detachInjectedListeners, grantLease, refreshBalance, nudgeWalletApp]
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
      restoreBlockedRef.current = null;
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
    /* The vault lives on disk, so this attach is already durable; the lease is
       what makes the REST of the app agree — the wallet page can say «connected
       until <time>» instead of re-deriving it, and an expired lease is what
       eventually stops the silent auto-attach on a device someone else picks up
       (the vault itself is still there, still locked). */
    grantLease({ address: vault.address, chainId: cid, mode: 'local' });
    refreshBalance(vault.address, cid);
    return true;
  }, [grantLease, refreshBalance, localTargetChain]);

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
        grantLease({ address: signerAddress, chainId: cid, mode: 'local' });
        void refreshBalance(signerAddress, cid);
        return true;
      } catch {
        setError('UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, grantLease, refreshBalance, localTargetChain]
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
        grantLease({ address: signer.address, chainId: cid, mode: 'local' });
        void refreshBalance(signer.address, cid);
        return true;
      } catch (e) {
        setError(e?.message === 'BAD_PASSWORD' ? 'BAD_PASSWORD' : 'UNLOCK_FAILED');
        return false;
      }
    },
    [getReadProvider, grantLease, refreshBalance, localTargetChain]
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
    /* The portfolio snapshot is keyed by address and is a display cache, but
       «forget this wallet» is the one action that means the device should stop
       remembering anything about it — including the numbers it last showed. */
    try {
      clearPortfolioSnapshot();
    } catch { /* storage unavailable: nothing was cached anyway */ }
    disconnectRef.current();
  }, []);

  /* ---------------------- resume across a reload ------------------------- */
  /*
   * THE COLD START, AS ONE FUNCTION.
   *
   * `attemptWalletRestore()` reads the lease, asks lib/wc/lease.js what the
   * situation calls for, and performs exactly that — silently, with no prompt,
   * for all three transports. `scheduleWalletRestore()` is the part that was
   * missing before: a bounded retry ladder, so ONE slow relay handshake on a
   * phone that is still loading the rest of the app is no longer the end of the
   * connection. Both are idempotent: whenever an address is already attached
   * they do nothing.
   */
  /**
   * Decide what «restoring» means now that an attempt has ended.
   *
   * ─── WHY A FUNCTION AND NOT `setRestoring(false)` ────────────────────────
   * The old code cleared the flag on every exit path, including between two
   * rungs of the retry ladder. On a phone whose relay handshake loses the race,
   * that produced exactly the reported symptom: «در حال اتصال مجدد…» for a
   * few seconds, then «وصل نیست» — while the app was, in fact, still trying,
   * and would try again sixty seconds later. A user who refreshed and waited a
   * minute concluded the connection had been dropped.
   *
   * So the flag now means one thing: THE APP STILL OWES THE USER A WALLET.
   * A live lease with nothing attached is a promise, not an absence — the flag
   * stays up until the wallet is back, the window the user chose lapses, or a
   * terminal fact says the session itself is gone. The ladder is background
   * work; the sentence on screen does not blink with it.
   */
  const settleRestoring = useCallback(() => {
    if (addressRef.current) {
      setRestoring(false);
      return false;
    }
    if (restoreBlockedRef.current) {
      setRestoring(false);
      return false;
    }
    const lease = readWalletLease() ?? leaseRef.current;
    const keep = Boolean(lease?.alive);
    setRestoring(keep);
    return keep;
  }, []);

  const attemptWalletRestore = useCallback(async () => {
    if (addressRef.current) {
      setRestoring(false);
      return true;
    }
    /* The FRESH read wins over the in-memory snapshot: `alive` is computed when
       the record is read, and a document that sat hidden past the window must
       not be judged by a flag set the last time it was visible. */
    const current = readWalletLease() ?? leaseRef.current;
    const hasVault = Boolean(loadVault());
    const plan = walletRestorePlan({
      lease: current,
      hasVault,
      hasStoredSession: hasStoredSession()
    });

    if (plan.expired) {
      /*
       * THE WINDOW THE USER CHOSE HAS CLOSED.
       *
       * Nothing re-attaches on its own any more, and the stored session goes
       * with it: an expired lease plus a live `wc@2:` session is exactly the
       * state that makes the NEXT Connect look dead (init() resurrects the
       * session and the modal refuses to open — see storage.js). Reconnecting
       * is one tap and asks the wallet for a fresh approval, which is the
       * honest price of a window that lapsed.
       */
      const purged = hasStoredSession() ? purgeConnectionKeys() : 0;
      clearWalletLease();
      leaseRef.current = null;
      setLease(null);
      restoreBlockedRef.current = 'expired';
      setRestoring(false);
      /* Named, not silent. «It disconnected by itself» is what an unexplained
         end of a connection looks like; this says which setting ended it. */
      setError('SESSION_EXPIRED');
      wcEvent('lease_expired', purged);
      return false;
    }

    if (plan.action === 'none') {
      if (plan.stale) wcEvent('lease_vault_missing');
      settleRestoring();
      return false;
    }

    if (plan.action === 'local') {
      /* The vault auto-attach effect owns this path (it is synchronous, so it
         has already run by the time this is called). Report honestly. */
      setRestoring(false);
      return Boolean(addressRef.current);
    }

    /*
     * A WALLETCONNECT LEASE WITH NO `wc@2:` SESSION BEHIND IT.
     *
     * This is not a slow handshake, it is an impossible one: the wallet revoked
     * the session, or this browser's storage was cleared while the lease in
     * another key survived. Running the retry ladder here would spend a hundred
     * seconds showing «در حال اتصال مجدد…» for a resume that can never succeed,
     * so the lease is dropped now and the user is told the one true thing:
     * connect once more.
     */
    if (plan.action === 'wc' && !hasStoredSession()) {
      dropLease();
      restoreBlockedRef.current = 'missing';
      setRestoring(false);
      setError('SESSION_MISSING');
      wcEvent('lease_session_missing');
      return false;
    }

    setRestoring(true);
    try {
      const ok = plan.action === 'injected'
        ? await restoreInjected(current?.rdns ?? null, current?.address ?? null)
        : await restoreWcSession({ announce: false });
      if (ok) {
        /* attachExternal() already wrote the lease for the wc path; this covers
           the adopted (pre-lease) install and re-anchors the window. */
        rollLease({ force: true });
        wcEvent('lease_restore_ok');
        return true;
      }
      wcEvent('lease_restore_failed');
      return false;
    } finally {
      /* NOT `setRestoring(false)`: a failed rung is not a failed resume. While
         the lease is alive the app owes the user this wallet, and the ladder
         behind it is background work — see settleRestoring(). */
      settleRestoring();
    }
  }, [restoreInjected, restoreWcSession, rollLease, dropLease, settleRestoring]);

  const scheduleWalletRestore = useCallback(() => {
    if (restoreTimerRef.current) return;
    const current = leaseRef.current ?? readWalletLease();
    if (!current?.alive || addressRef.current) return;
    const delay = walletRestoreDelay(restoreAttemptRef.current);
    restoreAttemptRef.current += 1;
    wcEvent('lease_retry_scheduled', Math.round(delay / 1000));
    try {
      restoreTimerRef.current = setTimeout(() => {
        restoreTimerRef.current = null;
        /* A hidden document is not where a relay handshake belongs; the next
           visibility change restarts the ladder instead of burning it off
           screen. */
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          restoreAttemptRef.current = 0;
          return;
        }
        attemptWalletRestore().then(
          (ok) => {
            if (!ok && !addressRef.current && (leaseRef.current?.alive ?? false)) scheduleWalletRestore();
          },
          () => scheduleWalletRestore()
        );
      }, delay);
    } catch {
      /* no timers: the visibility/focus path still retries */
    }
  }, [attemptWalletRestore]);

  /**
   * Try NOW (a tap on «تلاش دوباره», a soft refresh, a visibility change) and
   * fall back to the ladder when it fails.
   */
  const reconnectWallet = useCallback(async () => {
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    restoreAttemptRef.current = 0;
    /* «تلاش دوباره» is a new decision: an earlier terminal answer (a lapsed
       window, a session the device no longer has) must not silently refuse the
       tap that was made precisely because the user wants to try again. */
    restoreBlockedRef.current = null;
    const ok = await attemptWalletRestore();
    if (!ok) scheduleWalletRestore();
    return ok;
  }, [attemptWalletRestore, scheduleWalletRestore]);

  /* ------------------------------ disconnect ----------------------------- */

  const disconnect = useCallback(() => {
    wcEvent('local_disconnect');
    /* THE LEASE GOES FIRST, AND IT IS THE POINT OF THE WHOLE MODULE.
       Every other teardown below is synchronous-but-eventual: the SDK writes
       its storage asynchronously, the delayed purge catches that window. The
       lease is the one record the COLD START reads, so if it survived even a
       moment of the teardown a refresh right here would happily re-attach the
       wallet the user just disconnected. Clearing it first makes «قطع اتصال»
       mean it, on this document and on the next one. */
    dropLease();
    balanceAddressRef.current = null;
    /* WalletConnect first: tell the peer the session is over (bounded — a dead
       relay must never stall the UI) and purge the storage artifacts, then the
       injected listeners. */
    void wcRef.current?.disconnect();
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
    restoreBlockedRef.current = null;
    setRestoring(false);
  }, [detachInjectedListeners, dropLease]);

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
     * THE RETIRED EMAIL/SOCIAL SURFACE — ITS STORAGE GOES FIRST.
     *
     * A user who logged in with an email address or a social account on an
     * older build still carries that surface's keys, and one of them is read by
     * the SDK in a CONSTRUCTOR: `W3mFrameProvider` sees
     * `@appkit-wallet/EMAIL_LOGIN_USED_KEY` and creates the
     * secure.walletconnect.org iframe whether this page has a surface for it or
     * not. So they are removed before anything else runs — including the
     * hygiene below, which would otherwise count them as live state.
     */
    try {
      const legacy = purgeEmbeddedWalletKeys();
      if (legacy) wcEvent('embedded_legacy_purged', Number(legacy));
    } catch { /* storage unavailable — nothing to clean */ }

    /*
     * ORPHANED STORAGE HYGIENE.
     *
     * A stale deep-link choice or recent-wallet key makes the NEXT connect skip
     * the modal and open a wallet app with a dead pairing, so an idle cold
     * start that has nowhere to restore may clean the residue it can prove is
     * dead: AppKit connection keys with no `wc@2:` session behind them.
     * Vault-agnostic — the encrypted vault never uses these keys.
     */
    try {
      const facts = storageFacts();
      if (facts.orphanKeys && !addressRef.current) {
        const purged = purgeConnectionKeys();
        if (purged) wcEvent('orphan_storage_purged', Number(purged));
      }
    } catch { /* the check is advisory */ }

    /*
     * ONE RESUME, DRIVEN BY THE LEASE.
     *
     * `walletRestorePlan()` decides — from the record on disk, not from a
     * guess — whether the cold start re-attaches a WalletConnect session, an
     * injected wallet, the in-app vault, or nothing at all, and it is the same
     * function the retry ladder consults. Reads only: the plan NEVER attaches
     * anything by itself.
     */
    const storedLease = readWalletLease();
    leaseRef.current = storedLease;
    setLease(storedLease);
    /*
     * THE FIRST FRAME ALREADY OWES THE USER A WALLET.
     *
     * `restoring` used to go up only once the resume call was in flight, so a
     * returning user's first frame was the «وصل نیست» hero — and a reload is
     * exactly the moment that sentence reads as «the connection was dropped».
     * A live lease is a promise the app made; the hero says so from the start,
     * and `settleRestoring()` takes it down when the promise is kept or a
     * terminal fact breaks it.
     */
    if (storedLease?.alive && !addressRef.current && !loadVault()) setRestoring(true);

    const resume = () => {
      if (addressRef.current) {
        /* An address is still attached. If the window the user chose ended
           while the app was away, the connection ends here — deliberately, and
           by name — instead of sitting on screen as a wallet that no longer has
           a lease behind it. */
        const held = readWalletLease() ?? leaseRef.current;
        if (held && !held.alive) {
          wcEvent('lease_lapsed_while_open');
          disconnectRef.current();
          setError('SESSION_EXPIRED');
          return;
        }
        /* Otherwise roll the window instead of re-attaching. */
        rollLease({ force: true });
        return;
      }
      void attemptWalletRestore().then(
        (ok) => { if (!ok) scheduleWalletRestore(); },
        () => scheduleWalletRestore()
      );
    };

    /* A LOCAL VAULT WINS ON COLD START: restore is async while the vault
       auto-attach is synchronous, so without this skip the slower resume would
       overwrite the vault. The stored session is left on disk either way. */
    const vault = loadVault();
    const plan = walletRestorePlan({
      lease: storedLease,
      hasVault: Boolean(vault),
      hasStoredSession: hasStoredSession()
    });
    /*
     * Exactly two cases start a resume here:
     *
     *   • the lease LAPSED — `attemptWalletRestore()` is what clears the record
     *     and purges the session it described, so even the expired path goes
     *     through it (and it attaches nothing);
     *   • there is no vault and the plan says WalletConnect or an injected
     *     wallet — a vault always wins the cold start (above).
     *
     * 'local' needs no call: the vault effect below attaches synchronously.
     * 'none' means there is nothing to do, and saying so with no call is the
     * whole point of the plan.
     */
    if (plan.expired || (!vault && (plan.action === 'wc' || plan.action === 'injected'))) resume();

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
      if (document.visibilityState === 'visible') resume();
    };
    const onPageShow = (event) => {
      /* The initial load fires this too (persisted === false) — the mount path
         above already owns that one. */
      if (event?.persisted) resume();
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
   * A vault that is present but whose lease is missing gets one written now.
   *
   * This is the upgrade path: an install that connected before the lease
   * existed has an address attached and no record, so nothing would roll and
   * the wallet would look like a first-time connection on the next reload. The
   * effect is a no-op for every other state.
   */
  useEffect(() => {
    if (address && !leaseRef.current) rollLease({ force: true });
  }, [address, rollLease]);

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
      if (document.visibilityState !== 'visible') return;
      refreshBalance();
      /* IN USE MEANS CONNECTED. Every tick of this interval is evidence that
         the user is still here, so the lease rolls forward with the same
         cadence the balance does — throttled inside rollLease() to one write a
         minute, which is the difference between a durable record and a
         localStorage write per second. */
      rollLease();
    }, 30000);
    return () => clearInterval(id);
  }, [address, refreshBalance, rollLease]);

  /*
   * The user changed «how long should the wallet stay connected».
   *
   * The lease carries its own expiry, so the setting only takes effect for an
   * ALREADY connected wallet when the record is re-issued — which is exactly
   * what this does: pick 15 minutes and the current connection now expires in
   * 15; pick «تا قطع دستی» and it stops expiring at all.
   */
  useEffect(() => {
    if (!addressRef.current) return;
    if (!leaseRef.current) return;
    rollLease({ force: true });
  }, [walletSessionMinutes, rollLease]);

  /* Soft refresh: the header button re-reads the native balance through the
     same refreshBalance the interval uses. Nothing is remounted and, crucially,
     the WalletConnect session is not touched. If no wallet is attached, try the
     session restore once instead. */
  useEffect(() => {
    const off = onSoftRefresh(() => {
      if (addressRef.current) {
        refreshBalance();
        /* A refresh is a user action: roll the window and renew nothing else.
           The WalletConnect session is NOT touched — that is the contract of a
           soft refresh (see lib/refresh.js). */
        rollLease({ force: true });
        return;
      }
      /* Nothing attached: the same plan-driven resume the cold start uses, with
         the retry ladder behind it — never a bare one-shot attempt. */
      void attemptWalletRestore().then((ok) => { if (!ok) scheduleWalletRestore(); });
    });
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
      /* The session lease — see lib/wc/lease.js.
         `restoring` is true while the app is re-attaching a connection it
         already had, which is the state the UI must show instead of «not
         connected» (otherwise a working silent resume looks like a lost
         wallet). `lease` is the record itself, `leaseMinutesLeft` the number
         the wallet page prints, and `reconnectWallet` the manual retry the
         banner offers. */
      restoring,
      lease,
      leaseMinutesLeft: walletLeaseRemainingMinutes(lease),
      reconnectWallet,
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
      restoring,
      lease,
      walletSessionMinutes,
      reconnectWallet,
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
