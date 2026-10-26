import { motion } from 'framer-motion';
import { fmtPct, fmtUsd } from '../lib/format';
import Sparkline from './Sparkline';
import CoinLogo from './CoinLogo';
import { riseIn } from './PageTransition';

/** A keyboard-accessible market row with a dedicated, full-row navigation target. */
export default function CoinRow({ coin, onClick, showSpark = true, rank, metric = null }) {
  const up = coin.change24h >= 0;

  return (
    <motion.div className="coin-row" variants={riseIn} whileTap={{ scale: 0.985 }} data-coin-id={coin.id}>
      <button
        type="button"
        className="coin-row-open"
        onClick={() => onClick?.(coin)}
        aria-label={`${coin.name} (${coin.symbol})`}
      >
        {rank != null && <span className="coin-row-rank mono">{rank}</span>}
        <CoinLogo coin={coin} />

        <div className="coin-meta">
          <div className="coin-sym">{coin.symbol}</div>
          <div className="coin-name">
            <span className="coin-name-text">{coin.name}</span>
            {metric && <span className="coin-row-metric">{metric}</span>}
          </div>
        </div>

        {showSpark && (
          <span className="coin-row-spark" aria-hidden="true">
            <Sparkline data={coin.sparkline?.slice(-40) ?? []} up={up} width={58} height={26} />
          </span>
        )}

        <div className="coin-right">
          <div className="coin-price mono">{fmtUsd(coin.price)}</div>
          <div className={`coin-change-pill mono ${up ? 'is-up' : 'is-down'}`}>
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            {fmtPct(coin.change24h, 2)}
          </div>
        </div>
      </button>
    </motion.div>
  );
}
