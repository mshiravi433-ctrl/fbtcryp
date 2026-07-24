import { useTranslation } from 'react-i18next';
import { useWallet } from '../context/WalletContext';

function shorten(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

export default function WalletButton() {
  const { t } = useTranslation();
  const { address, connecting, connect, disconnect, error } = useWallet();

  if (address) {
    return (
      <button className="btn-secondary" onClick={disconnect}>
        <span className="mono-num">{shorten(address)}</span> · {t('wallet.disconnect')}
      </button>
    );
  }

  return (
    <div>
      <button className="btn-primary" onClick={connect} disabled={connecting}>
        {connecting ? '…' : t('home.connectWallet')}
      </button>
      {error === 'NO_INJECTED_WALLET' && (
        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
          No wallet detected in this browser — hook up WalletConnect (see
          WalletContext.jsx TODO) for MetaMask/Trust Wallet support inside Telegram.
        </p>
      )}
    </div>
  );
}
