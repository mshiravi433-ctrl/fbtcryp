/**
 * FBT INTENT AI — ACTIVE AUTOMATIONS
 * ---------------------------------------------------------------------------
 * The list under the deck, and the only place an automation can be created from
 * the AI page.
 *
 * The honesty this component exists to protect is the wording. A recurring
 * intent in FBT is a PREPARATION with a schedule: the state machine behind it
 * (`liveRecurringIntents.createRecurringIntent`) sets
 * `userAuthorizationPerRun: true`, and nothing in this app holds a key. So a row
 * reads "ready to run · asks you each time", never "running $100/week" in a tense
 * that implies money is moving on its own. The difference is the entire product
 * claim of a self-custody wallet.
 *
 * `onCreate` is called with a plain proposal object; validation (cadence
 * sanity, amount presence, chain allowlist) happens in
 * `commandCenter.createAutomation`, and a refusal is returned as
 * `{ ok: false, code }` rather than thrown, so the form can name the reason
 * inline instead of dying.
 */
import { useState } from 'react';
import { AUTOMATION_CADENCES } from '../../lib/intent-ai/commandCenter.js';

const KIND_GLYPH = { dca: '⟳', rebalance: '⚖', protect: '⛨', yield: '◈' };
const usd = (v) => (Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString()}` : '—');
const day = (ts) => {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  try { return new Date(n).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return null; }
};

export default function AiAutomations({ t, rows = [], totals = null, spendTodayUsd = 0, onCreate, onToggle, onDelete, busy = false, lastCode = null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ kind: 'dca', asset: 'BTC', amountUsd: 100, cadence: 'weekly' });
  const list = Array.isArray(rows) ? rows : [];

  return (
    <section className="acc-auto" data-testid="ai-automations" data-count={list.length}>
      <header className="acc-auto-head">
        <span className="acc-label">
          <span aria-hidden="true">⟳</span>
          {t('intentAI.cc.automation.title', { defaultValue: 'Active automations' })}
        </span>
        <span className="acc-tag" data-testid="ai-automation-count">
          {t('intentAI.cc.automation.count', {
            active: totals?.active ?? list.filter((r) => r.active).length,
            total: totals?.total ?? list.length,
            defaultValue: `${totals?.active ?? 0} of ${totals?.total ?? list.length} armed`
          })}
        </span>
      </header>

      {list.length === 0 ? (
        <p className="acc-auto-empty" data-testid="ai-automation-empty">
          {t('intentAI.cc.automation.none', {
            defaultValue: 'No automations yet. Ask “buy 100 USDC of BTC every week”, or add one here — it stays a plan you confirm each run.'
          })}
        </p>
      ) : (
        <ul className="acc-auto-list">
          {list.map((row) => (
            <li key={row.id} className={`acc-auto-row${row.active ? '' : ' is-paused'}`} data-testid={`ai-automation-${row.kind}`} data-active={row.active ? 'true' : 'false'}>
              <span className="acc-auto-glyph" aria-hidden="true">{KIND_GLYPH[row.kind] || '⟳'}</span>
              <span className="acc-auto-body">
                <b data-testid={`ai-automation-label-${row.kind}`}>
                  {row.asset ? `${row.asset} ` : ''}
                  {t(`intentAI.cc.automation.kind.${row.kind}`, { defaultValue: row.kind })}
                </b>
                <small data-testid={`ai-automation-schedule-${row.kind}`}>
                  {row.kind === 'dca' ? `${usd(row.amountUsd)} / ${t(`intentAI.cc.cadence.${row.cadence}`, { defaultValue: row.cadence })}` : t(`intentAI.cc.cadence.${row.cadence}`, { defaultValue: row.cadence })}
                  {day(row.nextRunAt) ? ` · ${t('intentAI.cc.automation.next', { date: day(row.nextRunAt), defaultValue: `next ${day(row.nextRunAt)}` })}` : ''}
                </small>
                <small className="acc-auto-perms" data-testid={`ai-automation-perms-${row.kind}`}>
                  {row.active
                    ? t('intentAI.cc.automation.asksEachRun', { defaultValue: 'ready · asks you to confirm each run' })
                    : t('intentAI.cc.automation.paused', { defaultValue: 'paused · nothing will be prepared' })}
                </small>
              </span>
              <span className="acc-auto-actions">
                <button
                  type="button"
                  className="acc-btn acc-btn-sm"
                  onClick={() => onToggle(row.id, !row.active)}
                  aria-pressed={row.active}
                  data-testid={`ai-automation-toggle-${row.kind}`}
                >
                  {row.active
                    ? t('intentAI.cc.automation.pause', { defaultValue: 'Pause' })
                    : t('intentAI.cc.automation.arm', { defaultValue: 'Arm' })}
                </button>
                <button type="button" className="acc-btn acc-btn-sm is-ghost" onClick={() => onDelete(row.id)} data-testid={`ai-automation-delete-${row.kind}`}>
                  {t('intentAI.cc.automation.remove', { defaultValue: 'Remove' })}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {list.length > 0 && (
        <p className="acc-auto-foot" data-testid="ai-automation-commitment">
          {t('intentAI.cc.automation.commitment', {
            weekly: usd(totals?.weeklyCommitmentUsd ?? 0),
            today: usd(spendTodayUsd || 0),
            defaultValue: `Planned weekly spend ${usd(totals?.weeklyCommitmentUsd ?? 0)} · ${usd(spendTodayUsd || 0)} of today's budget reserved`
          })}
        </p>
      )}

      <div className="acc-auto-add">
        <button type="button" className="acc-btn acc-btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="ai-automation-form-toggle">
          {open ? t('intentAI.cc.automation.close', { defaultValue: 'Close' }) : t('intentAI.cc.automation.add', { defaultValue: 'Add an automation' })}
        </button>
        {open && (
          <div className="acc-auto-form" data-testid="ai-automation-form">
            <label className="acc-field">
              <span className="acc-field-label">{t('intentAI.cc.automation.field.kind', { defaultValue: 'Type' })}</span>
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} data-testid="ai-automation-field-kind">
                {['dca', 'rebalance', 'protect', 'yield'].map((k) => (
                  <option key={k} value={k}>{t(`intentAI.cc.automation.kind.${k}`, { defaultValue: k })}</option>
                ))}
              </select>
            </label>
            <label className="acc-field">
              <span className="acc-field-label">{t('intentAI.cc.automation.field.asset', { defaultValue: 'Asset' })}</span>
              <input value={draft.asset} onChange={(e) => setDraft({ ...draft, asset: e.target.value.toUpperCase().slice(0, 12) })} data-testid="ai-automation-field-asset" />
            </label>
            <label className="acc-field">
              <span className="acc-field-label">{t('intentAI.cc.automation.field.amount', { defaultValue: 'Amount (USD)' })}</span>
              <input
                type="number"
                min="0"
                inputMode="decimal"
                value={draft.amountUsd}
                onChange={(e) => setDraft({ ...draft, amountUsd: Number(e.target.value) })}
                data-testid="ai-automation-field-amount"
              />
            </label>
            <label className="acc-field">
              <span className="acc-field-label">{t('intentAI.cc.automation.field.cadence', { defaultValue: 'Every' })}</span>
              <select value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value })} data-testid="ai-automation-field-cadence">
                {AUTOMATION_CADENCES.map((c) => (
                  <option key={c} value={c}>{t(`intentAI.cc.cadence.${c}`, { defaultValue: c })}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="acc-btn is-primary"
              disabled={busy}
              onClick={() => { onCreate({ ...draft }); setOpen(false); }}
              data-testid="ai-automation-create"
            >
              {t('intentAI.cc.automation.save', { defaultValue: 'Save automation' })}
            </button>
            {lastCode ? (
              <small className="acc-note is-warn" data-testid="ai-automation-refused">
                {t(`intentAI.cc.automation.refuse.${lastCode}`, { defaultValue: `Refused: ${lastCode}` })}
              </small>
            ) : (
              <small className="acc-note">
                {t('intentAI.cc.automation.formNote', { defaultValue: 'Saved on this device (and on the API when reachable). It schedules a plan, not a payment.' })}
              </small>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
