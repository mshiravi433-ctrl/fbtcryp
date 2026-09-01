import { useTranslation } from 'react-i18next';
import { EVM_CHAINS } from '../../lib/chains';
import { isSolanaChain } from '../../services/cross-chain';

/**
 * Explorer link for a hash on a chain, with an honest fallback.
 *
 * scan.li.fi understands a bridge transfer end-to-end, which is what the user
 * actually wants to look at; the per-chain explorer is used when we know it.
 */
export function explorerLink(chainId, hash) {
  if (!hash) return null;
  if (isSolanaChain(chainId)) return `https://solscan.io/tx/${hash}`;
  const base = EVM_CHAINS[Number(chainId)]?.explorer;
  return base ? `${base}/tx/${hash}` : `https://scan.li.fi/tx/${hash}`;
}

/** The chain's display name, from the app's own registry when we have it. */
export function chainName(chainId, chains = []) {
  const match = chains.find((c) => String(c.id) === String(chainId));
  if (match?.name) return match.name;
  if (isSolanaChain(chainId)) return 'Solana';
  return EVM_CHAINS[Number(chainId)]?.name || `chain ${chainId}`;
}

/**
 * LIVE TRANSFER STATUS — the anti-fake-success component.
 * ---------------------------------------------------------------------------
 * The states are the real ones the server tracks:
 *
 *   AWAITING_SIGNATURE → SIGNED → SUBMITTED → BRIDGING →
 *   DESTINATION_PENDING → COMPLETED | FAILED
 *
 * DESTINATION_PENDING exists precisely so that a confirmed SOURCE transaction
 * is never rendered as "Completed". Its copy is the sentence the spec asks
 * for: «تراکنش اولیه انجام شد. در حال تکمیل انتقال بین‌زنجیره‌ای هستیم…».
 */
export default function CrossChainStatus({ transaction, chains = [], onRefresh = null, busy = false }) {
  const { t } = useTranslation();
  if (!transaction) return null;

  const status = transaction.executionStatus;
  const steps = [
    { id: 'SUBMITTED', label: t('crossChain.step.submitted', { defaultValue: 'Source transaction sent' }) },
    { id: 'BRIDGING', label: t('crossChain.step.bridging', { defaultValue: 'Bridge processing' }) },
    { id: 'DESTINATION_PENDING', label: t('crossChain.step.destination', { defaultValue: 'Destination pending' }) },
    { id: 'COMPLETED', label: t('crossChain.step.completed', { defaultValue: 'Destination confirmed' }) }
  ];
  const order = ['AWAITING_SIGNATURE', 'SIGNED', 'SUBMITTED', 'BRIDGING', 'DESTINATION_PENDING', 'COMPLETED'];
  const reached = (id) => order.indexOf(status) >= order.indexOf(id);

  const failed = status === 'FAILED';
  const sourceUrl = explorerLink(transaction.fromChain, transaction.sourceTxHash);
  const destUrl = explorerLink(transaction.toChain, transaction.destinationTxHash);

  return (
    <div className={`xcc-status${failed ? ' failed' : ''}`}>
      <div className="xcc-status-head">
        <strong>
          {failed
            ? t('crossChain.status.failed', { defaultValue: 'Transfer failed' })
            : status === 'COMPLETED'
              ? t('crossChain.status.completed', { defaultValue: 'Transfer completed' })
              : t('crossChain.status.inFlight', { defaultValue: 'Transfer in progress' })}
        </strong>
        {onRefresh && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={busy}>
            {busy ? t('crossChain.checking', { defaultValue: 'Checking…' }) : t('crossChain.checkStatus', { defaultValue: 'Check status' })}
          </button>
        )}
      </div>

      {!failed && (
        <ol className="xcc-steps">
          {steps.map((s) => (
            <li key={s.id} className={reached(s.id) ? 'done' : ''}>
              <span className="xcc-dot" aria-hidden="true" />
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      {/* The honest interim sentence: source done, destination not yet. */}
      {(status === 'SUBMITTED' || status === 'BRIDGING' || status === 'DESTINATION_PENDING') && (
        <p className="xcc-note">
          {t('crossChain.pendingBody', {
            defaultValue: 'The source transaction went through. The cross-chain transfer is still completing — this is not finished yet.'
          })}
        </p>
      )}

      {failed && (
        <p className="xcc-error">
          {transaction.cancelled
            ? t('crossChain.cancelledBody', { defaultValue: 'Cancelled before broadcast. Nothing was sent.' })
            : (transaction.failureReason || t('crossChain.failedBody', { defaultValue: 'The bridge reported a failure. Funds stay where the provider says they are — open the explorer links.' }))}
        </p>
      )}

      <div className="xcc-status-links">
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
            {t('crossChain.sourceTx', { defaultValue: 'Source tx' })} ↗
          </a>
        )}
        {destUrl && (
          <a href={destUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
            {t('crossChain.destinationTx', { defaultValue: 'Destination tx' })} ↗
          </a>
        )}
        {transaction.sourceTxHash && (
          <a href={`https://scan.li.fi/tx/${transaction.sourceTxHash}`} target="_blank" rel="noopener noreferrer" dir="ltr">
            {t('crossChain.bridgeScan', { defaultValue: 'Bridge tracker' })} ↗
          </a>
        )}
      </div>

      <div className="xcc-status-meta" dir="ltr">
        {chainName(transaction.fromChain, chains)} → {chainName(transaction.toChain, chains)}
        {transaction.toolName ? ` · ${transaction.toolName}` : ''}
        {transaction.providerStatus ? ` · ${transaction.providerStatus}` : ''}
      </div>
    </div>
  );
}
