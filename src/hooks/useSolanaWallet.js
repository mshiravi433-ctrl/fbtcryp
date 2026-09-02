/**
 * useSolanaWallet — tiny React hook around the non-React Solana wallet layer.
 * The Solana provider (Phantom/Solflare/Backpack/MWA) lives on `window` and is
 * not part of WalletContext (which is EVM). Screens that need a Solana
 * signature (Solana swap, Drift futures) subscribe to the one `solana:wallet-
 * change` event the wallet layer emits and read the address from it.
 */
import { useCallback, useEffect, useState } from 'react';
import { solanaAddress, connectSolana, disconnectSolana, solanaWalletName, solanaWalletAvailable, canInjectSolana } from '../lib/solanaWallet.js';

export function useSolanaWallet() {
  const [address, setAddress] = useState(() => solanaAddress());

  useEffect(() => {
    const onChange = (event) => setAddress(event?.detail?.address || solanaAddress() || null);
    window.addEventListener('solana:wallet-change', onChange);
    return () => window.removeEventListener('solana:wallet-change', onChange);
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
