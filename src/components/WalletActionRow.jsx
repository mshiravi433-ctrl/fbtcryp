import { useTranslation } from 'react-i18next';
import { IconSwap, IconSparkle, IconPlus } from './Icons';
import { IconSend, IconReceive, IconBitcoin } from './WalletArt';

/**
 * ACTION ROW — one equal-sized row of the primary actions plus the
 * Optimize button, all on the wallet screen (no new menu entries anywhere).
 *
 * Optimize ONLY proposes: it opens the Intent OS compose screen with a
 * prefilled draft. It never signs and never executes. When there is not
 * enough indexed data to build a meaningful draft it says why instead.
 *
 * ─── THE BITCOIN DOORWAY (between Receive and Swap) ─────────────────────────
 * Requested position, exactly: after Send and Receive, before Swap. It opens
 * a POPUP on this same page rather than navigating anywhere.
 *
 * It carries NO bitcoin dependency. `IconBitcoin` is eight path commands in
 * WalletArt.jsx and the handler is a plain callback the Wallet page owns, so
 * this file — which every wallet render pulls in — still imports nothing from
 * lib/btcWallet, lib/btcTx or lib/btcApi. The bitcoin code is fetched by the
 * sheet, at the moment of the tap, and never before.
 */
export default function WalletActionRow({ onSend, onReceive, onBitcoin, onSwap, onBridge, onBuy, onEarn, onOptimize, canOptimize }) {
  const { t } = useTranslation();

  const actions = [
    { key: 'send', label: t('send.title'), Icon: IconSend, tint: 'send', onClick: onSend },
    { key: 'receive', label: t('receive.title'), Icon: IconReceive, tint: 'recv', onClick: onReceive },
    { key: 'bitcoin', label: t('btc.hub.action'), Icon: IconBitcoin, tint: 'btc', onClick: onBitcoin },
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
