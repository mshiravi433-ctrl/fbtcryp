import { useTranslation } from 'react-i18next';
import { IconSwap, IconSparkle, IconPlus } from './Icons';
import { IconSend, IconReceive } from './WalletArt';

/**
 * ACTION ROW — one equal-sized row of the six primary actions plus the
 * Optimize button, all on the wallet screen (no new menu entries anywhere).
 *
 * Optimize ONLY proposes: it opens the Intent OS compose screen with a
 * prefilled draft. It never signs and never executes. When there is not
 * enough indexed data to build a meaningful draft it says why instead.
 */
export default function WalletActionRow({ onSend, onReceive, onSwap, onBridge, onBuy, onEarn, onOptimize, canOptimize }) {
  const { t } = useTranslation();

  const actions = [
    { key: 'send', label: t('send.title'), Icon: IconSend, tint: 'send', onClick: onSend },
    { key: 'receive', label: t('receive.title'), Icon: IconReceive, tint: 'recv', onClick: onReceive },
    { key: 'swap', label: t('swap.title'), Icon: IconSwap, tint: 'swap', onClick: onSwap },
    { key: 'bridge', label: t('nav.bridge'), Icon: IconSwap, tint: 'bridge', onClick: onBridge },
    { key: 'buy', label: t('nav.buy'), Icon: IconPlus, tint: 'buy', onClick: onBuy },
    { key: 'earn', label: t('nav.earn'), Icon: IconSparkle, tint: 'earn', onClick: onEarn }
  ];

  return (
    <div className="wallet-actions-v2">
      <div className="wallet-action-strip" role="list" aria-label={t('wallet.actions')}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            role="listitem"
            className={`wallet-action-v2 wal-action-${a.tint}`}
            onClick={a.onClick}
            aria-label={a.label}
          >
            <span className="wallet-action-v2-icon" aria-hidden="true"><a.Icon width={19} height={19} /></span>
            <span className="wallet-action-v2-label">{a.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="wallet-optimize" onClick={onOptimize}>
        <IconSparkle width={15} height={15} />
        <span>{t('wallet.optimize')}</span>
        <span className="wallet-optimize-note">{t('wallet.optimizeNote')}</span>
      </button>
      {canOptimize === false && (
        <p className="muted" style={{ fontSize: 10.5, margin: '6px 2px 0', lineHeight: 1.6 }}>
          {t('wallet.optimizeWhy')}
        </p>
      )}
    </div>
  );
}
