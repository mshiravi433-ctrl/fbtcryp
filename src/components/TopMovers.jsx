import { motion } from 'framer-motion';
import CoinLogo from './CoinLogo';
import TokenIcon from '../lib/tokenIcon';
import Sparkline from './Sparkline';
import { fmtPct, fmtPrice } from '../lib/format';
import '../styles/top-movers.css';

/**
 * TOP MOVERS — the most profitable tokens of a list, as modern glass cards.
 *
 * ─── WHY A CAROUSEL AND NOT A TABLE ─────────────────────────────────────────
 * The full list below already IS a table. Repeating the same rows sorted by
 * gain would add nothing; a horizontal snap carousel gives the "most
 * profitable" its own visual language — rank medals, glow by gain intensity,
 * sparklines — so the eye reads it as a highlight reel, not a duplicate.
 *
 * Two flavours through one component:
 *   • coins  (CoinGecko rows: price, change24h, sparkline) → tap opens /coin/:id
 *   • equity (xStock rows: usdPrice, change24h, no series) → tap buys
 *
 * Items must be pre-sorted by the parent (highest gain first) and pre-shaped:
 *   { key, symbol, name, price, change, sparkline?, logo }
 * where `logo` is the original coin object (CoinLogo) or asset (TokenIcon).
 */
export default function TopMovers({
  title,
  subtitle,
  items,
  onSelect,
  logoKind = 'coin',
  testId = 'top-movers'
}) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <section className="tm-wrap" data-testid={testId}>
      <div className="tm-head">
        <div style={{ minWidth: 0 }}>
          <p className="section-label tm-title">{title}</p>
          {subtitle ? <p className="faint tm-sub">{subtitle}</p> : null}
        </div>
        <span className="tm-flame" aria-hidden="true">🔥</span>
      </div>

      <div className="tm-scroll" role="list">
        {items.map((it, i) => {
          const up = (it.change ?? 0) >= 0;
          /* Glow follows the gain: a +2% card barely glows, a +40% card burns. */
          const heat = Math.max(0, Math.min(1, (it.change ?? 0) / 25));
          const rank = i + 1;
          return (
            <motion.button
              key={it.key}
              role="listitem"
              type="button"
              className={`tm-card tm-r${rank <= 3 ? rank : 'x'} ${up ? 'tm-up' : 'tm-down'}`}
              style={{ '--tm-heat': heat.toFixed(2) }}
              whileTap={{ scale: 0.95 }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.3 }}
              onClick={() => onSelect?.(it)}
            >
              <span className={`tm-rank tm-rank-${rank <= 3 ? rank : 'x'}`}>{rank}</span>
              <span className="tm-id">
                {logoKind === 'coin' ? (
                  <CoinLogo coin={it.logo} px={30} />
                ) : (
                  <TokenIcon token={it.logo} size={30} />
                )}
                <span className="tm-names">
                  <span className="tm-sym">{it.symbol}</span>
                  <span className="tm-name">{it.name}</span>
                </span>
              </span>
              <span className="tm-price mono">${fmtPrice(it.price)}</span>
              <span className="tm-foot">
                <span className={`tm-chg mono ${up ? 'up' : 'down'}`}>
                  {up ? '▲' : '▼'} {fmtPct(it.change ?? 0, 1)}
                </span>
                {Array.isArray(it.sparkline) && it.sparkline.length >= 2 ? (
                  <Sparkline data={it.sparkline.slice(-36)} up={up} width={64} height={26} strokeWidth={1.8} />
                ) : it.depth != null ? (
                  <span className="tm-depth mono">{it.depth}</span>
                ) : null}
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
