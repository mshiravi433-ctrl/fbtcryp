import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWallet } from '../context/WalletContext';
import WalletButton from '../components/WalletButton';

export default function Trade() {
  const { t } = useTranslation();
  const { address } = useWallet();
  const [amount, setAmount] = useState('');

  const handleSwap = () => {
    // TODO: build the swap tx (e.g. PancakeSwap router `swapExactETHForTokens`)
    // and send it with the CONNECTED wallet's signer:
    //   const signer = await provider.getSigner();
    //   const router = new Contract(PANCAKE_ROUTER, routerAbi, signer);
    //   await router.swapExactETHForTokens(...);
    // The transaction always originates from `address` — never a bot-owned wallet.
    alert('Wire this up to your swap contract call — see the TODO in Trade.jsx');
  };

  return (
    <div className="page">
      <p className="section-label">{t('trade.title')}</p>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -10 }}>
        {t('trade.subtitle')}
      </p>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <p className="section-label" style={{ marginBottom: 6 }}>{t('trade.from')}</p>
          <div className="row-between">
            <span className="asset-icon">BN</span>
            <input type="text" placeholder="BNB" readOnly style={{ flex: 1, marginInlineStart: 10 }} />
          </div>
        </div>
        <div>
          <p className="section-label" style={{ marginBottom: 6 }}>{t('trade.to')}</p>
          <div className="row-between">
            <span className="asset-icon">CK</span>
            <input type="text" placeholder="CAKE" readOnly style={{ flex: 1, marginInlineStart: 10 }} />
          </div>
        </div>
        <div>
          <p className="section-label" style={{ marginBottom: 6 }}>{t('trade.amount')}</p>
          <input
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="row-between" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          <span>{t('trade.networkFee')}</span>
          <span className="mono-num">~0.0006 BNB</span>
        </div>
      </div>

      {address ? (
        <button className="btn-primary" onClick={handleSwap} disabled={!amount}>
          {t('trade.reviewSwap')}
        </button>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('trade.connectFirst')}</p>
          <WalletButton />
        </>
      )}

      <p className="custody-notice">{t('trade.custodyNotice')}</p>
    </div>
  );
}
