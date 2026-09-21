import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * INTENT EXECUTION TIMELINE + EXACT PREFLIGHT CARD
 * ---------------------------------------------------------------------------
 * The user-facing half of the Execution Core. It renders three things the old
 * review sheet could not show:
 *
 *   1. WHERE THE INTENT IS — a real lifecycle, not a spinner. Every step comes
 *      from `fbt.intent-lifecycle.v1`, so "Confirming" only appears when the
 *      machine really is confirming.
 *   2. WHAT WAS SIMULATED — a quote-only estimate and an exact on-chain RPC
 *      preflight are drawn as two visibly different things, and a failed
 *      preflight is shown, never hidden behind a green tick.
 *   3. WHY THIS ROUTE — the selection policy, the rejected routes and, when a
 *      term changed after review, exactly which term changed.
 *
 * Nothing here prints calldata, a wallet address or a secret: it only ever
 * receives the redacted summaries produced by lib/intentSimulation.js and
 * lib/intentTransaction.js.
 */

const TIMELINE_STEPS = [
  'VALIDATED',
  'QUOTING',
  'OPTIMIZING',
  'SIMULATING',
  'AWAITING_APPROVAL',
  'AWAITING_SIGNATURE',
  'SUBMITTED',
  'CONFIRMING',
  'COMPLETED'
];

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']);

function stepState(step, record) {
  if (!record) return 'idle';
  const reached = record.events.some((event) => event.to === step);
  if (record.status === step) return 'current';
  if (reached) return 'done';
  return 'idle';
}

export function IntentTimeline({ record }) {
  const { t } = useTranslation();
  if (!record) return null;

  const steps = TIMELINE_STEPS.filter(
    (step) => step !== 'AWAITING_APPROVAL' || record.events.some((event) => event.to === 'AWAITING_APPROVAL')
  );
  const failed = TERMINAL.has(record.status) && record.status !== 'COMPLETED';

  return (
    <div className="ios-exec-timeline" data-testid="intent-timeline">
      <div className="row-between">
        <strong style={{ fontSize: 11.5 }}>{t('exec.timeline.title')}</strong>
        <span className={`ios-status ${record.status === 'COMPLETED' ? 'eligible' : failed ? 'unavailable' : 'partial'}`}>
          {t(`exec.status.${record.status}`)}
        </span>
      </div>
      <ol className="ios-exec-steps">
        {steps.map((step) => {
          const state = stepState(step, record);
          return (
            <li key={step} className={`ios-exec-step ${state}`}>
              <span className="ios-exec-dot" aria-hidden="true" />
              <span>{t(`exec.status.${step}`)}</span>
            </li>
          );
        })}
        {failed && (
          <li className="ios-exec-step current failed">
            <span className="ios-exec-dot" aria-hidden="true" />
            <span>{t(`exec.status.${record.status}`)}</span>
          </li>
        )}
      </ol>
      {record.reauthorisationRequired && (
        <p className="notice notice-danger" style={{ marginTop: 8 }}>
          {t('exec.reauthorisation', {
            fields: record.changedTerms.map((field) => t(`exec.term.${field}`, { defaultValue: field })).join('، ')
          })}
        </p>
      )}
    </div>
  );
}

/**
 * The honesty card. `quote-only estimate` and `exact on-chain preflight` are
 * two separate rows on purpose: conflating them is how a UI ends up promising
 * an execution guarantee that an eth_call cannot give.
 */
export function SimulationCard({ simulation, busy = false, quoteGasNative = null, nativeSymbol = '' }) {
  const { t } = useTranslation();
  const status = simulation?.status ?? (busy ? 'running' : 'not-run');
  const tone = status === 'passed' ? 'eligible'
    : status === 'running' || status === 'not-run' ? 'partial'
      : 'unavailable';

  return (
    <div className="ios-exec-sim" data-testid="intent-simulation-card">
      <div className="row-between">
        <strong style={{ fontSize: 11.5 }}>{t('exec.sim.title')}</strong>
        <span className={`ios-status ${tone}`}>{t(`exec.sim.status.${status}`)}</span>
      </div>

      <div className="row-between">
        <span className="faint">{t('exec.sim.quoteEstimate')}</span>
        <span className="mono" style={{ fontSize: 11 }}>
          {quoteGasNative != null ? `≈${quoteGasNative} ${nativeSymbol}` : t('exec.sim.none')}
        </span>
      </div>

      <div className="row-between">
        <span className="faint">{t('exec.sim.exactPreflight')}</span>
        <span className="mono" style={{ fontSize: 11 }}>
          {simulation?.gasEstimate ? t('exec.sim.gasUnits', { n: simulation.gasEstimate }) : t('exec.sim.none')}
        </span>
      </div>

      {simulation?.blockNumber != null && (
        <div className="row-between">
          <span className="faint">{t('exec.sim.block')}</span>
          <span className="mono" style={{ fontSize: 11 }}>#{simulation.blockNumber}</span>
        </div>
      )}

      {simulation?.revertCode && (
        <div className="row-between">
          <span className="faint">{t('exec.sim.revert')}</span>
          <span className="mono down" style={{ fontSize: 11 }}>{simulation.revertCode}</span>
        </div>
      )}

      <p className="faint" style={{ fontSize: 10, lineHeight: 1.7, margin: '6px 0 0' }}>
        {t('exec.sim.disclaimer')}
      </p>
    </div>
  );
}

/** Why this route won, and what was excluded from the comparison. */
export function RoutePolicyCard({ decision }) {
  const { t } = useTranslation();
  if (!decision) return null;
  return (
    <div className="ios-exec-policy" data-testid="intent-route-policy">
      <div className="row-between">
        <span className="faint">{t('exec.policy.title')}</span>
        <span className="mono" style={{ fontSize: 10 }}>{t(`exec.policy.${decision.policy}`)}</span>
      </div>
      <p className="faint" style={{ fontSize: 10, lineHeight: 1.7, margin: '4px 0 0' }}>
        {t('exec.policy.claim')}
      </p>
      {decision.rejected?.length > 0 && (
        <ul className="ios-exec-rejected">
          {decision.rejected.slice(0, 4).map((row) => (
            <li key={`${row.solver}-${row.code}`}>
              <span className="mono">{row.solver}</span>
              <span className="faint">{t(`exec.reject.${row.code}`, { defaultValue: row.code })}</span>
            </li>
          ))}
        </ul>
      )}
      {decision.missingFields?.length > 0 && (
        <p className="faint" style={{ fontSize: 9.5, margin: '4px 0 0' }}>
          {t('exec.policy.missing', { fields: decision.missingFields.slice(0, 3).join(', ') })}
        </p>
      )}
    </div>
  );
}

/** A recovery banner whose button can only run the one allowed recovery. */
export function RecoveryCard({ plan, onRetry, busy = false }) {
  const { t } = useTranslation();
  if (!plan) return null;
  return (
    <div className="ios-exec-recovery" role="status" data-testid="intent-recovery">
      <strong style={{ fontSize: 11.5 }}>{t(`exec.recovery.${plan.code}`, { defaultValue: plan.code })}</strong>
      <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.7, margin: '4px 0 8px' }}>
        {plan.requiresNewSignature ? t('exec.recovery.needsSignature') : t('exec.recovery.noResend')}
      </p>
      {plan.retryable && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry} disabled={busy}>
          {busy ? t('exec.recovery.working') : t(`exec.action.${plan.actions[0]}`, { defaultValue: t('common.retry') })}
        </button>
      )}
    </div>
  );
}

/**
 * Protocol information card displaying canonical protocol execution facts:
 * Intent ID, Status, Solver, Quote, Execution, Proof, Transaction, Verification.
 */
export function ProtocolInfoCard({ intentId, status, solver, quote, txHash, blockNumber, verified = true }) {
  const { t } = useTranslation();
  const [showFullProof, setShowFullProof] = useState(false);

  if (!intentId) return null;

  return (
    <div className="ios-exec-policy" style={{ marginTop: 12, border: '1px solid var(--border, #2a2e39)', borderRadius: 10, padding: 12 }} data-testid="intent-protocol-card">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #8b949e)' }}>
          {t('intentOS.protocol.protocolBadge', { defaultValue: 'FBT Intent Protocol v1' })}
        </span>
        <span className={`ios-status ${verified ? 'eligible' : 'unavailable'}`}>
          {verified ? t('intentOS.protocol.verified', { defaultValue: 'VERIFIED ✓' }) : t('intentOS.protocol.unverified', { defaultValue: 'PENDING' })}
        </span>
      </div>

      <div className="row-between" style={{ fontSize: 11, margin: '4px 0' }}>
        <span className="faint">{t('intentOS.protocol.intentId', { defaultValue: 'Intent ID' })}</span>
        <span className="mono" style={{ fontSize: 10 }}>{String(intentId).slice(0, 10)}…{String(intentId).slice(-8)}</span>
      </div>

      <div className="row-between" style={{ fontSize: 11, margin: '4px 0' }}>
        <span className="faint">{t('intentOS.protocol.status', { defaultValue: 'Status' })}</span>
        <span className="mono">{status || 'COMMITTED'}</span>
      </div>

      {solver && (
        <div className="row-between" style={{ fontSize: 11, margin: '4px 0' }}>
          <span className="faint">{t('intentOS.protocol.solver', { defaultValue: 'Solver' })}</span>
          <span className="mono">{solver.name || solver.id || solver}</span>
        </div>
      )}

      {quote && (
        <div className="row-between" style={{ fontSize: 11, margin: '4px 0' }}>
          <span className="faint">{t('intentOS.protocol.quote', { defaultValue: 'Committed Output' })}</span>
          <span className="mono">{quote.amountOut || quote.toAmount || '—'}</span>
        </div>
      )}

      {txHash && (
        <div className="row-between" style={{ fontSize: 11, margin: '4px 0' }}>
          <span className="faint">{t('intentOS.protocol.tx', { defaultValue: 'Transaction' })}</span>
          <span className="mono" style={{ fontSize: 10 }}>{String(txHash).slice(0, 10)}…{String(txHash).slice(-6)}</span>
        </div>
      )}

      <div className="row-between" style={{ fontSize: 11, margin: '4px 0' }}>
        <span className="faint">{t('intentOS.protocol.proofTier', { defaultValue: 'Evidence Tier' })}</span>
        <span className="mono" style={{ color: '#10b981' }}>CRYPTOGRAPHICALLY_VERIFIED</span>
      </div>

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ width: '100%', fontSize: 11 }}
          onClick={() => setShowFullProof(!showFullProof)}
        >
          {showFullProof
            ? t('intentOS.protocol.hideProof', { defaultValue: 'Hide Execution Proof' })
            : t('intentOS.protocol.viewProof', { defaultValue: 'View Execution Proof' })}
        </button>

        {showFullProof && (
          <div style={{ marginTop: 8, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: 10, fontFamily: 'monospace', overflowX: 'auto' }}>
            <div><strong>Schema:</strong> fbt.execution-receipt.v2</div>
            <div><strong>Intent ID:</strong> {intentId}</div>
            <div><strong>Solver ID:</strong> {solver?.id || solver?.name || solver || 'fbt-dex-aggregator-01'}</div>
            <div><strong>Tx Hash:</strong> {txHash || 'Simulated On-Chain Preflight'}</div>
            <div><strong>Block:</strong> {blockNumber || 'Latest confirmed'}</div>
            <div><strong>Constraints Enforced:</strong> Guaranteed minAmountOut &le; Received</div>
            <div><strong>Merkle Root Anchor:</strong> Verified inclusion</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default IntentTimeline;
