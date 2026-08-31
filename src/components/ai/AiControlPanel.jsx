/**
 * FBT INTENT AI — ⚙ AI CONTROL
 * ---------------------------------------------------------------------------
 * The one box that decides how much the assistant may do, and the only place
 * those numbers can change.
 *
 * It is small on the page and load-bearing in the system:
 *
 *   · **Mode** maps onto the audited autonomy levels (manual = L1 analysis,
 *     assisted = L2 preparation, autonomous = L3 controlled). It is a rename of
 *     the thing a user could already reach, made legible — not a second,
 *     parallel permission system that could disagree with the first.
 *   · **The caps** ($ per transaction, $ per day, max risk) are read by
 *     `validateExecution()` in `commandCenter.js` — the SAME function the server
 *     runs — on every plan, approve and execute call. A budget shown here but
 *     enforced nowhere is decoration.
 *   · **Emergency stop** is persisted, because a stop that resets on refresh is
 *     not a stop. Releasing it is a second deliberate tap.
 *
 * What this box cannot do, and says out loud: `autonomous` removes the extra
 * "approve this plan" tap. It never removes the wallet signature — no setting
 * in this app can, which is the difference between delegation and custody.
 */
import { AI_CONTROL_CHAINS, AI_MODES, NON_EVM_VENUES } from '../../lib/intent-ai/commandCenter.js';

const usdShort = (v) => `$${Number(v || 0).toLocaleString()}`;

export default function AiControlPanel({
  t,
  aiControl,
  onChange,
  onStop,
  onRelease,
  usage = null,
  level = 1,
  automationsActive = 0,
  serverState = null
}) {
  const set = (patch) => onChange({ ...aiControl, ...patch });
  const spent = Number(usage?.spentTodayUsd || 0);
  const cap = Number(aiControl.maxDailyUsd || 0);
  const usedPct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;

  return (
    <section className="acc-control" data-testid="ai-control" data-mode={aiControl.mode} data-stopped={aiControl.stopActive ? 'true' : 'false'}>
      <header className="acc-control-head">
        <span className="acc-label">
          <span aria-hidden="true">⚙</span>
          {t('intentAI.cc.control.title', { defaultValue: 'AI control' })}
        </span>
        <span className={`acc-tag${aiControl.stopActive ? ' is-warn' : ''}`} data-testid="ai-control-state">
          {aiControl.stopActive
            ? t('intentAI.cc.control.stopped', { defaultValue: 'stopped' })
            : t('intentAI.cc.control.running', { defaultValue: 'armed' })}
        </span>
      </header>

      {/* ── AI MODE ─────────────────────────────────────────────────────── */}
      <div className="acc-field" data-testid="ai-control-mode">
        <span className="acc-field-label">{t('intentAI.cc.control.mode', { defaultValue: 'AI mode' })}</span>
        <div className="acc-modes" role="group" aria-label={t('intentAI.cc.control.mode', { defaultValue: 'AI mode' })}>
          {AI_MODES.map((m) => {
            const on = aiControl.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                className={`acc-mode${on ? ' is-on' : ''}`}
                onClick={() => set({ mode: m.id })}
                aria-pressed={on}
                data-testid={`ai-control-mode-${m.id}`}
              >
                <b>{t(m.labelKey, { defaultValue: m.id })}</b>
                <small>{t(`intentAI.cc.control.modeNote.${m.id}`, { defaultValue: `L${m.level}` })}</small>
              </button>
            );
          })}
        </div>
        <p className="acc-note" data-testid="ai-control-mode-note">
          {aiControl.mode === 'autonomous'
            ? t('intentAI.cc.control.autonomousNote', {
              defaultValue: 'Autonomous: the assistant skips the “approve this plan” tap and prepares the leg straight away. Your wallet still signs every transaction — nothing here can skip that.'
            })
            : aiControl.mode === 'assisted'
              ? t('intentAI.cc.control.assistedNote', { defaultValue: 'Assisted: the assistant prepares drafts, you approve each one.' })
              : t('intentAI.cc.control.manualNote', { defaultValue: 'Manual: analysis and plans only. No draft is prepared, nothing is queued.' })}
        </p>
      </div>

      {/* ── BUDGET ──────────────────────────────────────────────────────── */}
      <div className="acc-control-grid">
        <label className="acc-field">
          <span className="acc-field-label">{t('intentAI.cc.control.maxPerTx', { defaultValue: 'Maximum per transaction' })}</span>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={aiControl.maxPerTxUsd}
            onChange={(e) => set({ maxPerTxUsd: Number(e.target.value) })}
            data-testid="ai-control-max-per-tx"
          />
        </label>
        <label className="acc-field">
          <span className="acc-field-label">{t('intentAI.cc.control.maxDaily', { defaultValue: 'Maximum daily' })}</span>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={aiControl.maxDailyUsd}
            onChange={(e) => set({ maxDailyUsd: Number(e.target.value) })}
            data-testid="ai-control-max-daily"
          />
        </label>
        <label className="acc-field">
          <span className="acc-field-label">
            {t('intentAI.cc.control.maxRisk', { defaultValue: 'Maximum risk' })}
            <b className="acc-inline-value" data-testid="ai-control-max-risk-value">{aiControl.maxRiskScore}/100</b>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={aiControl.maxRiskScore}
            onChange={(e) => set({ maxRiskScore: Number(e.target.value) })}
            data-testid="ai-control-max-risk"
          />
        </label>
        <div className="acc-field">
          <span className="acc-field-label">{t('intentAI.cc.control.session', { defaultValue: 'Session' })}</span>
          <div className="acc-session">
            <span data-testid="ai-control-level">{`L${level}`}</span>
            <span className="acc-sep" aria-hidden="true">·</span>
            <span>{automationsActive} {t('intentAI.cc.control.automations', { defaultValue: 'automation(s) armed' })}</span>
            {serverState ? (
              <>
                <span className="acc-sep" aria-hidden="true">·</span>
                <span data-testid="ai-control-server">{serverState}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Today's spend, against the cap it is measured by. */}
      <div className="acc-budget" data-testid="ai-control-budget">
        <div className="acc-budget-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPct}>
          <span style={{ width: `${usedPct}%` }} />
        </div>
        <div className="acc-budget-legend">
          <span data-testid="ai-control-spent">{usdShort(spent)} {t('intentAI.cc.control.spentToday', { defaultValue: 'signed today' })}</span>
          <span>{usdShort(Math.max(0, cap - spent))} {t('intentAI.cc.control.left', { defaultValue: 'left of' })} {usdShort(cap)}</span>
        </div>
        <small className="acc-note">
          {t('intentAI.cc.control.spentSource', { defaultValue: 'Counted from your own local receipt history — never from a server guess.' })}
        </small>
      </div>

      {/* ── SCOPE ───────────────────────────────────────────────────────── */}
      <div className="acc-field" data-testid="ai-control-chains">
        <span className="acc-field-label">{t('intentAI.cc.control.chains', { defaultValue: 'Allowed networks' })}</span>
        <div className="acc-checks">
          {AI_CONTROL_CHAINS.map((chain) => {
            const on = aiControl.allowedChains.includes(chain.chainId);
            return (
              <label key={chain.chainId} className={`acc-check${on ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => set({
                    allowedChains: on
                      ? aiControl.allowedChains.filter((c) => c !== chain.chainId)
                      : [...aiControl.allowedChains, chain.chainId]
                  })}
                  data-testid={`ai-control-chain-${chain.chainId}`}
                />
                <span>{chain.short}</span>
              </label>
            );
          })}
        </div>
        <small className="acc-note">
          {t('intentAI.cc.control.chainsNone', {
            defaultValue: 'Untick everything and the AI has nowhere to prepare a leg — that is allowed, and it is enforced.'
          })}
          {' · '}
          {NON_EVM_VENUES.map((v) => `${v.id}: ${v.reason}`).join(' · ')}
        </small>
      </div>

      <div className="acc-field" data-testid="ai-control-surfaces">
        <span className="acc-field-label">{t('intentAI.cc.control.surfaces', { defaultValue: 'What the AI may act on' })}</span>
        <div className="acc-checks">
          {['trade', 'earn', 'protect', 'plan', 'automate'].map((surface) => {
            const on = (aiControl.enabledSurfaces || []).includes(surface);
            return (
              <label key={surface} className={`acc-check${on ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => set({
                    enabledSurfaces: on
                      ? aiControl.enabledSurfaces.filter((s) => s !== surface)
                      : [...aiControl.enabledSurfaces, surface]
                  })}
                  data-testid={`ai-control-surface-${surface}`}
                />
                <span>{t(`intentAI.cc.quick.${surface}.title`, { defaultValue: surface })}</span>
              </label>
            );
          })}
        </div>
        <small className="acc-note">
          {t('intentAI.cc.control.surfacesNote', { defaultValue: 'Asking anything is always allowed — this list governs what a plan may prepare.' })}
        </small>
      </div>

      {/* ── THE STOP ────────────────────────────────────────────────────── */}
      <div className="acc-stop" data-testid="ai-control-stop">
        {aiControl.stopActive ? (
          <>
            <p className="acc-stop-note" data-testid="ai-control-stop-note">
              {t('intentAI.cc.control.stopActive', {
                defaultValue: 'Stopped. No plan can be approved, prepared or executed, and every automation is on pause. Releasing the stop does not restart anything by itself.'
              })}
            </p>
            <button type="button" className="acc-btn is-primary" onClick={onRelease} data-testid="ai-control-release">
              {t('intentAI.cc.control.release', { defaultValue: 'I checked — release the stop' })}
            </button>
          </>
        ) : (
          <>
            <p className="acc-stop-note">
              {t('intentAI.cc.control.stopHint', { defaultValue: 'Stops every AI-prepared plan and pauses every automation for you, on this device and on the API.' })}
            </p>
            <button type="button" className="acc-btn is-danger" onClick={onStop} data-testid="ai-control-emergency-stop">
              {t('intentAI.cc.control.stop', { defaultValue: 'Emergency stop' })}
            </button>
          </>
        )}
        <small className="acc-note" data-testid="ai-control-stop-scope">
          {t('intentAI.cc.control.stopScope', { defaultValue: 'A transaction already sitting open in your wallet is yours to cancel, not ours — we never hold it.' })}
        </small>
      </div>
    </section>
  );
}
