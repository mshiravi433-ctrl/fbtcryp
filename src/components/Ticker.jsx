import { useMemo } from 'react';
import { fmtPct, fmtPrice } from '../lib/format';

/** Infinite marquee of live prices. The track is duplicated for a seamless loop. */
export default function Ticker({ coins = [] }) {
  const items = useMemo(() => (coins.length ? [...coins, ...coins] : []), [coins]);
  if (!items.length) return <div className="skel" style={{ height: 34 }} />;

  return (
    <div className="ticker">
      <div className="ticker-track">
        {items.map((c, i) => (
          <div className="ticker-item" key={`${c.id}-${i}`}>
            <span className="ticker-sym">{c.symbol}</span>
            <span className="mono">${fmtPrice(c.price)}</span>
            <span className={c.change24h >= 0 ? 'up mono' : 'down mono'}>{fmtPct(c.change24h, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
