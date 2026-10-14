import { useTranslation } from 'react-i18next';
import AssetIcon from '../AssetIcon';
import { balancesHidden, fmtUsd } from '../../lib/format';

/**
 * The market list of the spot tab: one row per token on the selected network.
 *
 * A row shows what is known and nothing more:
 *   • price and 24h change from the market feed, or an honest dash when the
 *     feed has no coin for it (never a guessed number);
 *   • the wallet balance when a wallet is connected — «unavailable» when the
 *     read failed, never zero.
 * Direction is always written out with its arrow, so colour is never the only
 * signal.
 *
 * The artwork is AssetIcon — the vendored, offline SVG set (token mark with a
 * network badge), so the list looks the same on a phone that cannot reach any
 * icon CDN, which is where the empty-circle reports came from.
 */
export default function SpotMarketList({
  chainId,
  tokens,
  activeSymbol,
  priceFor,
  balanceFor,
  connected,
  query,
  onQuery,
  onPick,
  ariaLabel
}) {
  const { t } = useTranslation();
  const q = query.trim().toLowerCase();
  const shown = q
    ? tokens.filter((tk) => tk.symbol.toLowerCase().includes(q) || tk.name.toLowerCase().includes(q))
    : tokens;

  return (
    <div className="spot-market">
      <input
        type="search"
        className="spot-search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('market.search')}
        aria-label={t('market.search')}
      />
      <div className="spot-market-list" role="listbox" aria-label={ariaLabel}>
        {shown.length === 0 && <p className="spot-empty">{t('spot.market.empty')}</p>}
        {shown.map((tk) => {
          const active = tk.symbol === activeSymbol;
          const info = priceFor(tk);
          const change = info?.change24h;
          const up = Number(change) >= 0;
          const bal = connected ? balanceFor(tk) : undefined;
          return (
            <button
              key={tk.symbol}
              type="button"
              role="option"
              aria-selected={active}
              className={`spot-row${active ? ' is-active' : ''}`}
              onClick={() => onPick(tk)}
            >
              <AssetIcon symbol={tk.symbol} chain={chainId} size={30} />
              <span className="spot-row-meta">
                <strong dir="ltr">{tk.symbol}</strong>
                <small>{tk.name}</small>
              </span>
              <span className="spot-row-num">
                <span className="mono" dir="ltr">
                  {info?.price != null ? fmtUsd(info.price) : '—'}
                </span>
                {change != null && Number.isFinite(Number(change)) && (
                  <span className={`mono spot-change ${up ? 'up' : 'down'}`} dir="ltr">
                    {up ? '▲' : '▼'} {Math.abs(Number(change)).toFixed(2)}%
                  </span>
                )}
              </span>
              {connected && (
                <span className="spot-row-bal mono" dir="ltr">
                  {bal === undefined
                    ? ''
                    : bal === null
                      ? t('spot.balanceUnavailable')
                      : balancesHidden()
                        ? '•••'
                        : `${bal.formatted} ${tk.symbol}`}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
