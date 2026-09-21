/**
 * useSolanaWallet — tiny React hook around the non-React Solana wallet layer.
 * The Solana provider (Phantom/Solflare/Backpack/MWA) lives on `window` and is
 * not part of WalletContext (which is EVM). Screens that need a Solana
 * signature (Solana swap, the On-Chain futures tab) subscribe to the one
 * `solana:wallet-change` event the wallet layer emits and read the address
 * from it.
 *
 * ─── WHY MORE THAN THE EVENT ────────────────────────────────────────────────
 * The event only fires for connections THIS app initiated. Two real races it
 * misses, both reported as "the button does nothing even though my wallet is
 * connected":
 *
 *   · late injection — the page (re)mounts before the extension injected
 *     `window.solana`, so the initial `solanaAddress()` read is null and no
 *     event ever follows;
 *   · connect-from-elsewhere — the user authorizes the site in another tab or
 *     straight from the extension; `provider.publicKey` appears with no
 *     `solana:wallet-change`.
 *
 * So detection ALSO follows the wallet's own `accountChanged`/`connect`
 * notifications when the provider offers them, plus a light 2.5s re-read of
 * `solanaAddress()` as the catch-all. All three converge on the same setState,
 * so the address is idempotent and the hook stays quiet when nothing changed.
 *
 * ─── AND THE UNIFIED LAYER ON TOP ───────────────────────────────────────────
 * Connecting is delegated to `createSolanaWalletLayer()` — the same object the
 * Intent OS path and the health panel read. Two reasons it matters here:
 *
 *   · CAPABILITIES, MEASURED. `methods()` answers per method whether the
 *     transport that is actually live can do it (Phantom's deep-link protocol
 *     has no `signAllTransactions`; Wallet Standard defines no such feature). A
 *     screen that offers a button the wallet cannot honour is a bug report
 *     waiting to happen, and the honest answer is already computed for us.
 *   · ONE SIGNING PATH. `signMessage` / `signTransaction` /
 *     `signAndSendTransaction` go through the layer, so the injected, Wallet
 *     Standard and deep-link routes are chosen in one place instead of at every
 *     call site. The legacy exports still exist and still work — the layer
 *     delegates to them — but new call sites should use this API.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  solanaAddress, getSolanaProvider,
  solanaWalletName, solanaWalletAvailable, canInjectSolana
} from '../lib/solanaWallet.js';
import { createSolanaWalletLayer } from '../lib/solana/walletLayer.js';

export function useSolanaWallet({ win } = {}) {
  const [address, setAddress] = useState(() => solanaAddress());
  /* One layer per mount, and its identity follows the window it was given. */
  const layer = useMemo(() => createSolanaWalletLayer({ win }), [win]);

  useEffect(() => {
    const sync = (next) => {
      setAddress((cur) => {
        const v = next || null;
        return cur === v ? cur : v;
      });
    };
    const readProvider = () => sync(solanaAddress());

    /* our own connect/disconnect */
    const onChange = (event) => sync(event?.detail?.address || solanaAddress() || null);
    window.addEventListener('solana:wallet-change', onChange);

    /* the wallet's own notifications, when it offers them */
    const provider = getSolanaProvider();
    const onAccountChanged = (pk) => sync(pk ? String(pk) : solanaAddress() || null);
    const onProviderDisconnect = () => sync(null);
    if (provider && typeof provider.on === 'function') {
      try {
        provider.on('accountChanged', onAccountChanged);
        provider.on('connect', readProvider);
        provider.on('disconnect', onProviderDisconnect);
      } catch { /* a provider with a broken .on must never break the screen */ }
    }

    /* the catch-all: covers late injection and cross-tab connects */
    const timer = setInterval(readProvider, 2500);
    /* and one immediate re-read, so a provider injected after the first render
       is picked up in this same tick cycle rather than the next interval */
    const raf = setTimeout(readProvider, 150);

    return () => {
      window.removeEventListener('solana:wallet-change', onChange);
      clearInterval(timer);
      clearTimeout(raf);
      try {
        if (provider && typeof provider.removeListener === 'function') {
          provider.removeListener('accountChanged', onAccountChanged);
          provider.removeListener('connect', readProvider);
          provider.removeListener('disconnect', onProviderDisconnect);
        }
      } catch { /* same */ }
    };
  }, []);

  const connect = useCallback(async (options = {}) => {
    const res = await layer.connect(options);
    const next = res?.address || solanaAddress() || null;
    setAddress(next);
    /* The failure CODE travels with the null, so a caller can tell «the user
       rejected it» from «no wallet exists» without reading a wallet's own
       prose — the layer already normalised it. */
    return res?.ok ? next : (res ?? { ok: false, code: 'CONNECT_FAILED' });
  }, [layer]);

  const disconnect = useCallback(async () => {
    const res = await layer.disconnect();
    setAddress(null);
    return res;
  }, [layer]);

  /*
   * The signing surface, exactly as wide as the live transport.
   *
   * `supported` is computed on every render rather than memoised from mount:
   * a wallet can be connected (or replaced) while this component is mounted —
   * `window.phantom` appears late, the user switches from a deeplink session to
   * an extension — and a cached capability list would answer for the transport
   * that was live when the screen opened.
   */
  const capabilities = layer.capabilities();
  const supported = useMemo(
    () => Object.fromEntries(
      Object.entries(capabilities.methods ?? {}).map(([name, info]) => [name, info?.supported === true])
    ),
    [capabilities]
  );

  return {
    address,
    isConnected: Boolean(address),
    connect,
    disconnect,
    walletName: solanaWalletName(),
    available: solanaWalletAvailable(),
    canInject: canInjectSolana(),
    /* ── the unified layer ─────────────────────────────────────────────── */
    transport: capabilities.transport ?? null,
    walletId: capabilities.walletId ?? null,
    capabilities,
    supported,
    methods: Object.keys(supported),
    detect: layer.detect,
    pendingRequest: layer.pendingRequest,
    getPublicKey: layer.getPublicKey,
    signMessage: supported.signMessage ? layer.signMessage : null,
    signTransaction: supported.signTransaction ? layer.signTransaction : null,
    signAllTransactions: supported.signAllTransactions ? layer.signAllTransactions : null,
    signAndSendTransaction: supported.signAndSendTransaction ? layer.signAndSendTransaction : null
  };
}
