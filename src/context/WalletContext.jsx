import { createContext, useContext, useState, useCallback } from 'react';
import { BrowserProvider } from 'ethers';

const BSC_CHAIN = {
  chainId: '0x38', // 56
  chainName: 'BNB Smart Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: ['https://bsc-dataseed.binance.org/'],
  blockExplorerUrls: ['https://bscscan.com']
};

const WalletContext = createContext(null);

/**
 * IMPORTANT ARCHITECTURE NOTE
 * ----------------------------------------------------------------
 * This app is non-custodial: it only ever asks the user's own wallet
 * to sign transactions that the user's own wallet also submits.
 * There is no bot-owned or admin-owned deposit address anywhere in
 * this codebase, and none should ever be added. All "trade" actions
 * must go through a swap contract (e.g. PancakeSwap router) invoked
 * FROM the connected address, never a transfer to a third-party wallet.
 *
 * Telegram's in-app browser usually has no injected window.ethereum,
 * so a production build should add WalletConnect v2
 * (@walletconnect/ethereum-provider) to support MetaMask / Trust Wallet
 * via QR/deep link. That wiring is left as a clearly marked TODO below
 * so you can drop in your own WalletConnect projectId.
 */
export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      if (window.ethereum) {
        // Desktop browser / wallet-in-app-browser path
        const provider = new BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        setAddress(accounts[0]);

        const network = await provider.getNetwork();
        if (network.chainId !== 56n) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: BSC_CHAIN.chainId }]
            });
          } catch (switchErr) {
            if (switchErr.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [BSC_CHAIN]
              });
            } else {
              throw switchErr;
            }
          }
        }
        setChainOk(true);
      } else {
        // TODO: replace with WalletConnect v2 flow for Telegram's in-app browser:
        //   import { EthereumProvider } from '@walletconnect/ethereum-provider';
        //   const provider = await EthereumProvider.init({
        //     projectId: 'YOUR_WALLETCONNECT_PROJECT_ID',
        //     chains: [56],
        //     showQrModal: true,
        //   });
        //   await provider.connect();
        throw new Error('NO_INJECTED_WALLET');
      }
    } catch (e) {
      setError(e.message === 'NO_INJECTED_WALLET' ? 'NO_INJECTED_WALLET' : 'CONNECT_FAILED');
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainOk(false);
  }, []);

  return (
    <WalletContext.Provider value={{ address, chainOk, connecting, error, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
