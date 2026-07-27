import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** ethers is ~300 kB — only pulled in when the user actually connects. */
const loadEthers = () => import('ethers');

/**
 * NON-CUSTODIAL BY DESIGN
 * ---------------------------------------------------------------------------
 * This app never holds, requests or displays a deposit address that belongs to
 * the bot/admin. The only wallet involved is the user's own, and it is used
 * purely to (a) read their balance and (b) let *them* sign *their own*
 * transactions.
 *
 * Everything on the trading / investing / gaming screens runs on a virtual
 * "NX" balance. Collecting real crypto into an operator wallet to trade,
 * invest or gamble on a user's behalf is exactly the shape of an unlicensed
 * money service — in most jurisdictions it needs a VASP/MSB registration,
 * KYC-AML, and for the betting side a gambling licence. Get those first, then
 * replace this layer with your licensed custodian's SDK. Don't bolt a hot
 * wallet onto a Telegram bot.
 *
 * For real in-Telegram wallet UX, the two supported routes are:
 *   • TON Connect (`@tonconnect/ui-react`) — native to Telegram.
 *   • WalletConnect v2 (`@walletconnect/ethereum-provider`) — EVM chains.
 * Both are drop-in at the marked TODO below.
 */

const CHAINS = {
  56: {
    chainId: '0x38',
    chainName: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed.binance.org/'],
    blockExplorerUrls: ['https://bscscan.com']
  }
};

const TARGET_CHAIN = 56;

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [nativeBalance, setNativeBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const readBalance = useCallback(async (addr) => {
    if (!window.ethereum || !addr) return;
    try {
      const { BrowserProvider, formatEther } = await loadEthers();
      const provider = new BrowserProvider(window.ethereum);
      const wei = await provider.getBalance(addr);
      setNativeBalance(Number(formatEther(wei)));
    } catch {
      setNativeBalance(null);
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      if (!window.ethereum) {
        // TODO: swap in TON Connect or WalletConnect v2 here — Telegram's
        // in-app browser exposes no injected provider.
        throw new Error('NO_INJECTED_WALLET');
      }

      const { BrowserProvider } = await loadEthers();
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const account = accounts[0];
      setAddress(account);

      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));

      if (Number(network.chainId) !== TARGET_CHAIN) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: CHAINS[TARGET_CHAIN].chainId }]
          });
          setChainId(TARGET_CHAIN);
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [CHAINS[TARGET_CHAIN]]
            });
            setChainId(TARGET_CHAIN);
          } else {
            throw switchErr;
          }
        }
      }

      await readBalance(account);
    } catch (e) {
      setError(e.message === 'NO_INJECTED_WALLET' ? 'NO_INJECTED_WALLET' : 'CONNECT_FAILED');
    } finally {
      setConnecting(false);
    }
  }, [readBalance]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setNativeBalance(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return undefined;
    const onAccounts = (accs) => {
      if (!accs.length) disconnect();
      else {
        setAddress(accs[0]);
        readBalance(accs[0]);
      }
    };
    const onChain = (hex) => setChainId(parseInt(hex, 16));
    window.ethereum.on?.('accountsChanged', onAccounts);
    window.ethereum.on?.('chainChanged', onChain);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccounts);
      window.ethereum.removeListener?.('chainChanged', onChain);
    };
  }, [disconnect, readBalance]);

  const value = useMemo(
    () => ({
      address,
      chainId,
      chainOk: chainId === TARGET_CHAIN,
      nativeBalance,
      connecting,
      error,
      connect,
      disconnect,
      refresh: () => readBalance(address),
      explorer: address ? `${CHAINS[TARGET_CHAIN].blockExplorerUrls[0]}/address/${address}` : null
    }),
    [address, chainId, nativeBalance, connecting, error, connect, disconnect, readBalance]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext) ?? {};

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
