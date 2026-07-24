import { useTranslation } from 'react-i18next';
import { useWallet } from '../context/WalletContext';
import WalletButton from '../components/WalletButton';
import { mockPortfolio } from '../lib/mockData';

export default function Portfolio() {
  const { t } = useTranslation();
  const { address } = useWallet();

  if (!address) {
    return (
      <div className="page">
        <p className="section-label">{t('portfolio.title')}</p>
        <div className="card">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('portfolio.noWallet')}
          </p>
          <WalletButton />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <p className="section-label">{t('portfolio.title')}</p>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -10 }}>
        {t('portfolio.subtitle')}
      </p>

      <div className="card-raised">
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
          {t('portfolio.totalValue')}
        </p>
        <div className="stat-value mono-num" style={{ marginTop: 6 }}>
          ${mockPortfolio.totalUsd.toLocaleString()}
        </div>
      </div>

      <div>
        <p className="section-label">{t('portfolio.assets')}</p>
        <div className="card">
          {mockPortfolio.assets.map((a) => (
            <div className="asset-row" key={a.symbol}>
              <div className="asset-name">
                <span className="asset-icon">{a.symbol.slice(0, 2)}</span>
                <div>
                  <div>{a.symbol}</div>
                  <div className="mono-num" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {a.amount}
                  </div>
                </div>
              </div>
              <span className="mono-num">${a.usd.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
