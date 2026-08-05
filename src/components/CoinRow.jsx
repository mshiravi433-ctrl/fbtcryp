import { motion } from 'framer-motion';
import { fmtPct, fmtPrice } from '../lib/format';
import Sparkline from './Sparkline';
import CoinLogo from './CoinLogo';
import { riseIn } from './PageTransition';

export default function CoinRow({ coin, onClick, showSpark = true, rank }) {
  const up = coin.change24h >= 0;
  return (
    <motion.div
      className="coin-row"
      variants={riseIn}
      whileTap={{ scale: 0.985 }}
      onClick={() => onClick?.(coin)}
      layout
    >
      {rank != null && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', width: 16 }}>
          {rank}
        </span>
      )}
      <CoinLogo coin={coin} />

      <div className="coin-meta">
        <div className="coin-sym">{coin.symbol}</div>
        <div className="coin-name">{coin.name}</div>
      </div>

      {showSpark && (
        <Sparkline data={coin.sparkline?.slice(-40) ?? []} up={up} width={58} height={26} />
      )}

      <div className="coin-right">
        <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
          ${fmtPrice(coin.price)}
        </div>
        <div className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
          {fmtPct(coin.change24h, 2)}
        </div>
      </div>
    </motion.div>
  );
}
