/**
 * FBT INTENT AI — LOCAL TRANSACTION HISTORY VIEW
 * ---------------------------------------------------------------------------
 * Renders the rows the Intent AI panel wrote to localStorage
 * (`fbt.intent.txHistory`, see txHistory.js). This is a READ VIEW over a
 * local-only record:
 *
 *   · nothing is fetched and nothing is sent — the server never holds keys,
 *     never signs, and never sees this list
 *   · statuses are rendered as recorded (authorized / submitted / failed /
 *     queued...), never upgraded to something nicer-looking
 *   · a user can wipe the whole record with one tap
 *
 * Mobile-first: the tab exists because the history must be readable on a
 * phone without scrolling through the whole chat thread.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadIntentTxHistory, clearIntentTxHistory } from '../lib/intent-ai';
import { EVM_CHAINS } from '../lib/chains';

function fmtWhen(ts) {
  try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function shortHash(hash) {
  return typeof hash === 'string' && hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

export default function IntentTxHistory() {
  const { t } = useTranslation();
  const [rows, setRows] = useState(() => loadIntentTxHistory());

  const wipe = () => {
    setRows(clearIntentTxHistory());
  };

  return (
    <section className="ios-history" data-testid="intent-tx-history">
      <div className="ios-proof-intro">
        <span>⌗</span>
        <div>
          <h2>{t('intentAI.history.title', { defaultValue: 'Transaction history' })}</h2>
          <p>{t('intentAI.history.subtitle', { defaultValue: 'What the Intent AI did on this device — every receipt it recorded, newest first.' })}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <section className="ios-empty-proof">
          <span>◇</span>
          <h3>{t('intentAI.history.emptyTitle', { defaultValue: 'Nothing here yet' })}</h3>
          <p>{t('intentAI.history.emptyBody', { defaultValue: 'Receipts the Intent AI produces — authorized, submitted, failed or queued — are listed here.' })}</p>
        </section>
      ) : (
        <>
          <ul className="ios-history-list">
            {rows.map((row) => (
              <li key={row.id} className="ios-history-row" data-testid="intent-tx-history-row">
                <div className="row-between">
                  <b className="ios-history-route">
                    {row.action ? t(`intentAI.history.action.${row.action}`, { defaultValue: row.action }) : t('intentAI.history.action.unknown', { defaultValue: 'action' })}
                    {' · '}
                    {row.fromSymbol || '—'} → {row.toSymbol || '—'}
                  </b>
                  <span className={`ios-status ${['completed', 'submitted', 'authorized'].includes(row.status) ? 'eligible' : 'unavailable'}`}>
                    {t(`intentAI.history.status.${row.status}`)}
                  </span>
                </div>
                <small>
                  {fmtWhen(row.at)}
                  {row.amountUsd != null ? ` · $${Number(row.amountUsd).toLocaleString()}` : ''}
                  {row.chainId ? ` · ${EVM_CHAINS[row.chainId]?.short || EVM_CHAINS[row.chainId]?.name || `#${row.chainId}`}` : ''}
                </small>
                {row.txHash && (
                  <small className="mono">{t('intentAI.history.txHash', { defaultValue: 'tx' })}: {shortHash(row.txHash)}</small>
                )}
                {row.feeAmount != null && (
                  <small>{t('intentAI.history.feeLine', { amount: row.feeAmount, symbol: row.feeSymbol || '', defaultValue: `fee ${row.feeAmount} ${row.feeSymbol || ''}` })}</small>
                )}
                {row.reasonKey && (
                  <small className="ios-history-reason">{t(row.reasonKey, { defaultValue: '' })}</small>
                )}
              </li>
            ))}
          </ul>
          <div className="ios-history-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={wipe} data-testid="intent-tx-history-clear">
              {t('intentAI.history.clear', { defaultValue: 'Clear history' })}
            </button>
          </div>
        </>
      )}

      <p className="ios-honesty-note">{t('intentAI.history.localNote', { defaultValue: 'Stored only in this browser. Clearing browser data removes it; it is never uploaded and never used to sign anything.' })}</p>
    </section>
  );
}
