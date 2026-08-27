/**
 * Route wrapper for the Intent AI panel.
 * ---------------------------------------------------------------------------
 * Phase 51: the panel itself stays free of wallet-library imports (it is
 * mounted headless by the test suite), so the CONNECTED wallet is handed to it
 * here as a plain EIP-1193 runtime: { provider, account, chainId, connected }.
 *
 * When nothing is connected this is `null` — and the panel then reports an
 * honest "wallet signature required" instead of signing with a stand-in.
 */
import { useMemo } from 'react';
import { useWallet } from '../context/WalletContext';
import IntentAIPanel from './IntentAIPanel';

export default function IntentAIRoute(props) {
  const wallet = useWallet();
  const walletRuntime = useMemo(() => {
    if (typeof wallet?.getWalletRuntime === 'function') return wallet.getWalletRuntime();
    return null;
    // The identity of the runtime only changes with the connection itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address, wallet?.chainId, wallet?.locked, wallet?.isConnected, wallet?.getWalletRuntime]);

  return <IntentAIPanel {...props} walletRuntime={walletRuntime} />;
}
