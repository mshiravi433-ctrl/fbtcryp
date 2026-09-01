import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtUsd } from '../../lib/format';
import { crossChainService, fromBaseUnits } from '../../services/cross-chain';
import { chainName, explorerLink } from './CrossChainStatus';
import '../../styles/cross-chain.css';

const STATUS_TONE = {
  COMPLETED: 'ok',
  FAILED: 'bad',
  BRIDGING: 'wait',
  PENDING: 'wait'
};

function amountOf(raw, decimals, symbol) {
  if (raw == null) return null;
  const human = decimals != null ? fromBaseUnits(raw, decimals) : raw;
  if (human == null) return null;
  const n = Number(human);
  const text = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : human;
  return symbol ? `${text} ${symbol}` : text;
}

/**
 * CROSS-CHAIN HISTORY — real rows, one source, both screens.
 * ---------------------------------------------------------------------------
 * Every row here was written by an actual broadcast: the ledger row is created
 * in `crossChainService.execute()` only after the wallet returned a hash, and
 * its status is moved forward by the SERVER re-reading the bridge. Nothing in
 * this component can promote a row to Completed.
 *
 * Rendered by the Intent OS cross-chain desk and the bridge page from the same
 * endpoint, so "where did my transfer go" has one answer.
 */
export default function CrossChainHistory({ wallet, limit = 10, refreshKey = 0, chains = [], onSelect = null }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('idle');

  const load = useCallback(async () => {
    if (!wallet) {
      setRows([]);
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const history = await crossChainService.getHistory(wallet, { limit });
      setRows(history);
      setState('ready');
    } catch {
      /* An unreachable history endpoint shows as unavailable rather than as an
         empty list: "you have no transfers" is a different claim from "we
         could not read your transfers". */
      setState('unavailable');
    }
  }, [wallet, limit]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!wallet) return null;

  return (
    <section className="ios-panel xcc-history">
      <div className="xcc-history-head">
        <h3>{t('crossChain.historyTitle', { defaultValue: 'Cross-chain history' })}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={state === 'loading'}>
          {state === 'loading' ? t('crossChain.checking', { defaultValue: 'Checking…' }) : t('crossChain.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>

      {state === 'unavailable' && (
        <p className="xcc-error">{t('crossChain.historyUnavailable', { defaultValue: 'History is unavailable right now.' })}</p>
      )}

      {state === 'ready' && rows.length === 0 && (
        <p className="xcc-note">{t('crossChain.historyEmpty', { defaultValue: 'No cross-chain transfers from this wallet yet.' })}</p>
      )}

      <div className="xcc-history-list">
        {rows.map((row) => {
          const tone = STATUS_TONE[row.status] || 'wait';
          const sent = amountOf(row.fromAmount, row.fromTokenDecimals, row.fromTokenSymbol);
          const received = amountOf(row.actualAmount ?? row.expectedAmount, row.toTokenDecimals, row.toTokenSymbol);
          const took = row.completedAt && row.createdAt
            ? Math.max(1, Math.round((row.completedAt - row.createdAt) / 1000))
            : null;
          return (
            <article
              key={row.id}
              className={`xcc-history-row ${tone}`}
              onClick={onSelect ? () => onSelect(row) : undefined}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={onSelect ? (e) => { if (e.key === 'Enter') onSelect(row); } : undefined}
            >
              <header>
                <span className={`xcc-badge ${tone}`}>
                  {row.status === 'COMPLETED' && '✓ '}
                  {row.status === 'FAILED' && '✕ '}
                  {(row.status === 'PENDING' || row.status === 'BRIDGING') && '⏳ '}
                  {t(`crossChain.rowStatus.${row.executionStatus}`, { defaultValue: row.executionStatus })}
                </span>
                <strong dir="ltr">{sent || '—'}</strong>
              </header>

              <div className="xcc-history-meta" dir="ltr">
                {chainName(row.fromChain, chains)} → {chainName(row.toChain, chains)}
                {row.toolName ? ` · ${row.toolName}` : row.tool ? ` · ${row.tool}` : ''}
                {row.provider ? ` · ${row.provider}` : ''}
              </div>

              <div className="xcc-history-meta">
                {received && (
                  <span dir="ltr">
                    {row.actualAmount
                      ? t('crossChain.received', { defaultValue: 'received' })
                      : t('crossChain.expected', { defaultValue: 'expected' })}: {received}
                  </span>
                )}
                {row.feesUsd?.total != null && <span> · {fmtUsd(row.feesUsd.total)} {t('crossChain.fee', { defaultValue: 'fee' })}</span>}
                {took != null && <span> · {took}s</span>}
              </div>

              <div className="xcc-status-links">
                {explorerLink(row.fromChain, row.sourceTxHash) && (
                  <a
                    href={explorerLink(row.fromChain, row.sourceTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="ltr"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t('crossChain.sourceTx', { defaultValue: 'Source tx' })} ↗
                  </a>
                )}
                {explorerLink(row.toChain, row.destinationTxHash) && (
                  <a
                    href={explorerLink(row.toChain, row.destinationTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="ltr"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t('crossChain.destinationTx', { defaultValue: 'Destination tx' })} ↗
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
