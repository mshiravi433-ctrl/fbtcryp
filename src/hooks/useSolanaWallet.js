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
 */
import { useCallback, useEffect, useState } from 'react';
import {
  solanaAddress, connectSolana, disconnectSolana, getSolanaProvider,
  solanaWalletName, solanaWalletAvailable, canInjectSolana
} from '../lib/solanaWallet.js';

export function useSolanaWallet() {
  const [address, setAddress] = useState(() => solanaAddress());

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

  const connect = useCallback(async () => {
    const a = await connectSolana();
    setAddress(a || solanaAddress());
    return a;
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectSolana();
    setAddress(null);
  }, []);

  return {
    address,
    isConnected: Boolean(address),
    connect,
    disconnect,
    walletName: solanaWalletName(),
    available: solanaWalletAvailable(),
    canInject: canInjectSolana()
  };
}
