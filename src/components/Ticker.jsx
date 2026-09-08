import { useMemo } from 'react';
import { fmtPct, fmtPrice } from '../lib/format';
import CoinLogo from './CoinLogo';

/** Compact market rail: four live assets, then an in-rail RWA/gold promo. */
function Promo({ kind }) {
  const gold = kind === 'gold';
  return (
    <div className={`ticker-promo ${gold ? 'ticker-promo-gold' : ''}`}>
      <span className="ticker-promo-logo">{gold ? 'Au' : 'R'}</span>
      <span className="ticker-promo-copy">
        <b>{gold ? 'توکن طلا' : 'RWA توکنایز'}</b>
        <small>{gold ? 'دارایی امن و دیجیتال' : 'دارایی واقعی، روی زنجیره'}</small>
      </span>
      <span className="ticker-promo-growth">+{gold ? '8.4' : '12.6'}%</span>
      <svg className="ticker-promo-chart" viewBox="0 0 34 22" aria-hidden="true">
        <path d="M2 19 L10 14 L15 16 L23 7 L31 3" />
        <path d="M25 3h6v6" />
      </svg>
    </div>
  );
}

export default function Ticker({ coins = [] }) {
  const items = useMemo(() => {
    const first = coins.slice(0, 4);
    const second = coins.slice(4, 8);
    const sequence = [
      ...first.map((coin) => ({ type: 'coin', coin })),
      { type: 'promo', kind: 'rwa' },
      ...second.map((coin) => ({ type: 'coin', coin })),
      { type: 'promo', kind: 'gold' }
    ];
    return sequence.length ? [...sequence, ...sequence] : [];
  }, [coins]);
  if (!items.length) return <div className="skel" style={{ height: 42 }} />;

  return (
    <div className="ticker" aria-label="قیمت‌های زنده بازار">
      <div className="ticker-track">
        {items.map((item, i) => item.type === 'promo' ? (
          <Promo key={`${item.kind}-${i}`} kind={item.kind} />
        ) : (
          <div className="ticker-item" key={`${item.coin.id}-${i}`}>
            <CoinLogo coin={item.coin} size={22} />
            <span className="ticker-sym">{item.coin.symbol}</span>
            <span className="mono">${fmtPrice(item.coin.price)}</span>
            <span className={item.coin.change24h >= 0 ? 'up mono' : 'down mono'}>{fmtPct(item.coin.change24h, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
