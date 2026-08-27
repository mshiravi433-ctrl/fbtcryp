/**
 * FBT — TOKEN APPROVALS (phase 83)
 * ---------------------------------------------------------------------------
 * The answer to "what have I allowed, and to whom?". Standard swap flows ask
 * for an unlimited approval once and then never mention it again; this panel
 * makes that list visible and gives every row an exit.
 *
 * It is deliberately READ-ONLY plus one intent: tapping Revoke does not send
 * anything, it raises a revoke plan that has to go through the same
 * confirmation as any other transaction. The component never invents a number:
 * an allowance it could not read is shown as unreadable, and a total that
 * would be partial is not shown at all.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { approvalInventory, revokePlan } from '../lib/intent-ai';

const short = (a) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || '');

export default function TokenApprovals({ entries = null, onRevoke = null, now = undefined }) {
  const { t } = useTranslation();

  const inventory = useMemo(
    () => (Array.isArray(entries) ? approvalInventory(entries, now ? { now } : {}) : null),
    [entries, now]
  );

  // No data is not an empty list. An unreadable inventory says so.
  if (!inventory) {
    return (
      <div className="ia-approvals" data-testid="token-approvals">
        <p className="section-label" style={{ marginBottom: 4 }}>{t('intentAI.approvals.title')}</p>
        <p className="notice" data-testid="approvals-unavailable">{t('intentAI.approvals.unavailable')}</p>
      </div>
    );
  }

  const rows = inventory.entries.filter((row) => row.kind !== 'none');

  return (
    <div className="ia-approvals" data-testid="token-approvals">
      <p className="section-label" style={{ marginBottom: 2 }}>{t('intentAI.approvals.title')}</p>
      <p className="faint" style={{ fontSize: 11, margin: '0 0 8px' }}>{t('intentAI.approvals.subtitle')}</p>

      {rows.length === 0 ? (
        <p className="notice" data-testid="approvals-empty">{t('intentAI.approvals.empty')}</p>
      ) : (
        <>
          <p className="faint" style={{ fontSize: 11, margin: '0 0 8px' }} data-testid="approvals-totals">
            {t('intentAI.approvals.totals', { active: inventory.activeCount, unlimited: inventory.unlimitedCount })}
          </p>
          <ul className="ia-approval-list">
            {rows.map((row) => (
              <li
                key={`${row.token}:${row.spender}`}
                className={`ia-approval-row is-${row.risk}`}
                data-testid="approval-row"
                data-risk={row.risk}
              >
                <div className="ia-approval-head">
                  <b>{row.symbol || short(row.token)}</b>
                  {row.unlimited && (
                    <span className="ia-approval-badge is-unlimited" data-testid="approval-unlimited">
                      {t('intentAI.approvals.unlimitedBadge')}
                    </span>
                  )}
                  {row.stale && (
                    <span className="ia-approval-badge">{t('intentAI.approvals.staleBadge')}</span>
                  )}
                </div>
                <p className="ia-approval-spender" dir="ltr">{row.spenderLabel || short(row.spender)}</p>
                <p className="faint" style={{ fontSize: 11, margin: '3px 0 0' }}>{t(row.reasonKey)}</p>
                <p className="faint" style={{ fontSize: 11, margin: '2px 0 0' }} data-testid="approval-exposure">
                  {row.exposureUsd == null
                    ? t('intentAI.approvals.exposureUnknown')
                    : t('intentAI.approvals.exposure', { amount: row.exposureUsd })}
                </p>
                {row.revocable && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    data-testid="approval-revoke"
                    onClick={() => {
                      // Raise a PLAN. Nothing is signed or sent from here.
                      const plan = revokePlan(row, now ? { now } : {});
                      if (typeof onRevoke === 'function') onRevoke(plan);
                    }}
                  >
                    {t('intentAI.approvals.revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
