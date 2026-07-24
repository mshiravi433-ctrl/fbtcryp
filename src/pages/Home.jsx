import { useTranslation } from 'react-i18next';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import WalletButton from '../components/WalletButton';
import { marketPulse } from '../lib/mockData';

export default function Home() {
  const { t } = useTranslation();
  const { user } = useTelegram();
  const { address } = useWallet();

  return (
    <div className="page">
      <div className="card-raised">
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('home.greeting', { name: user?.first_name ?? '' })}
        </p>
        <div style={{ marginTop: 14 }}>
          {address ? (
            <WalletButton />
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                {t('home.walletPrompt')}
              </p>
              <WalletButton />
            </>
          )}
        </div>
      </div>

      <div>
        <p className="section-label">{t('home.marketPulse')}</p>
        <div className="card">
          <div className="row-between">
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {t('home.sentimentLabel')}
            </span>
            <span className="pill pill-bullish">
              {t(`analysis.${marketPulse.label}`)} · {(marketPulse.sentimentScore * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      <div>
        <p className="section-label">{t('home.topMovers')}</p>
        <div className="card">
          {marketPulse.topMovers.map((m) => (
            <div className="asset-row" key={m.symbol}>
              <div className="asset-name">
                <span className="asset-icon">{m.symbol.slice(0, 2)}</span>
                <span>{m.symbol}</span>
              </div>
              <span
                className="mono-num"
                style={{ color: m.changePct >= 0 ? 'var(--green)' : 'var(--red)' }}
              >
                {m.changePct >= 0 ? '+' : ''}
                {m.changePct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
