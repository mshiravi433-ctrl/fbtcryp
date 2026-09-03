import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { loadSwapHistory, removeSwap, clearSwapHistory } from '../lib/swapHistory';
import { explorerTx } from '../lib/chains';
import { fmtQty, timeAgo } from '../lib/format';
import { IconClock } from './Icons';

const STATUS_STYLES = {
  confirmed: { cls: 'pill pill-up', key: 'confirmed' },
  pending: { cls: 'pill pill-neutral', key: 'pending' },
  cancelled: { cls: 'pill pill-down', key: 'cancelled' },
  failed: { cls: 'pill pill-down', key: 'failed' }
};

/**
 * SWAP HISTORY — reads the on-device ledger prepared by lib/swapHistory.js.
 *
 * The ledger is written to localStorage (never bare React memory), so the
 * history survives a reload and a tab reopen, and it is capped. Each row is
 * tagged by status: confirmed / pending / cancelled / failed. A single list
 * is used for both EVM and Solana swaps, filtered to the current `network` or
 * shown together with `all`.
 */
export default function SwapHistoryPanel({ network = 'all', limit = 20 }) {
  const { t, i18n } = useTranslation();
  const [version, setVersion] = useState(0);
  const [cleared, setCleared] = useState(false);

  const rows = useMemo(() => {
    // version is read only to re-read after a delete/clear.
    void version;
    const all = loadSwapHistory();
    const filtered = network === 'all'
      ? all
      : all.filter((r) => r.network === network);
    return filtered.slice(0, limit);
  }, [network, limit, version]);

  if (!rows.length && !cleared) return null;

  const handleRemove = (id) => {
    removeSwap(id);
    setCleared(false);
    setVersion((v) => v + 1);
  };

  const handleClear = () => {
    clearSwapHistory();
    setCleared(true);
    setVersion((v) => v + 1);
  };

  return (
    <section className="shist-panel">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 7 }}>
          <IconClock width={15} height={15} />
          <strong style={{ fontSize: 13 }}>{t('swap.historyTitle')}</strong>
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={handleClear}
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            {t('swap.historyClear')}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {cleared ? (
          <p className="faint" style={{ fontSize: 12, margin: 0, padding: '8px 0' }}>
            {t('swap.historyCleared')}
          </p>
        ) : (
          <ul className="shist-list">
            {rows.map((r) => {
              const st = STATUS_STYLES[r.status] ?? STATUS_STYLES.failed;
              return (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="shist-item"
                >
                  <div className="shist-main">
                    <div className="shist-route">
                      <span className="mono" dir="ltr">
                        {r.amountIn != null ? fmtQty(Number(r.amountIn)) : ''} {r.fromSymbol}
                        {' → '}
                        {r.amountOut != null ? fmtQty(Number(r.amountOut)) : '—'} {r.toSymbol}
                      </span>
                    </div>
                    <div className="shist-meta">
                      <span className="shist-chain">{r.chainName || r.network}</span>
                      <span className="shist-time">{timeAgo(r.at, i18n.language)}</span>
                    </div>
                  </div>

                  <div className="shist-right">
                    <span className={`pill ${st.cls}`} style={{ fontSize: 10 }}>
                      {t(`swap.historyStatus.${st.key}`)}
                    </span>
                    {r.txHash && r.network === 'evm' && r.chainId && (
                      <a
                        href={explorerTx(r.chainId, r.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono faint"
                        style={{ fontSize: 9.5, wordBreak: 'break-all', maxWidth: 150 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.txHash.slice(0, 10)}…
                      </a>
                    )}
                    <button
                      type="button"
                      className="shist-remove"
                      aria-label={t('swap.historyRemove')}
                      onClick={() => handleRemove(r.id)}
                    >
                      ×
                    </button>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </AnimatePresence>
    </section>
  );
}
