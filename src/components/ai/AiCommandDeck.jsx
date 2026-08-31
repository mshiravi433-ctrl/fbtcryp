/**
 * FBT INTENT AI — AI COMMAND DECK (the parts of the AI page a person sees first)
 * ---------------------------------------------------------------------------
 * Quick actions · the portfolio read · the four tools · the plan · the stage
 * ledger · and the collapsed truth about which agents are doing the work.
 *
 * Deliberately PRESENTATIONAL: every number, verdict and lane arrives as a
 * prop computed by `src/lib/intent-ai/commandCenter.js`, so this file cannot
 * invent a figure and cannot be the place where a permission is granted. It
 * also mounts without a router, without a wallet and without a network — the AI
 * panel is mounted headless by the test suite, and a deck that needed a
 * provider there would make the whole page untestable.
 *
 * The rule this surface exists to enforce:
 *   seventeen agents work, five things are shown.
 * `AiAgentLanes` is the only place the roster appears, it starts closed, and it
 * says plainly that none of those agents can touch a key.
 */
import { useState } from 'react';
import { AI_AGENTS, AI_SURFACES, AI_TOOLS } from '../../lib/intent-ai/commandCenter.js';

const usd = (v) => (Number.isFinite(Number(v))
  ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: Number(v) >= 1000 ? 0 : 2 })}`
  : '—');
const pct = (v) => (Number.isFinite(Number(v)) ? `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '—');

/** The five doors. A tap pins the intent: no classifier guessing at a click. */
export function AiQuickActions({ t, onPick, activeSurface = null, busy = false }) {
  return (
    <div className="acc-quick" data-testid="ai-quick-actions">
      <p className="acc-label">{t('intentAI.cc.quick.title', { defaultValue: 'Quick actions' })}</p>
      <div className="acc-quick-row">
        {AI_SURFACES.map((surface) => (
          <button
            key={surface.id}
            type="button"
            className={`acc-quick-card${activeSurface === surface.id ? ' is-active' : ''}`}
            onClick={() => onPick(surface.id)}
            disabled={busy}
            aria-pressed={activeSurface === surface.id}
            data-testid={`ai-quick-${surface.id}`}
          >
            <span className="acc-quick-glyph" aria-hidden="true">{surface.glyph}</span>
            <span className="acc-quick-name">{t(`intentAI.cc.quick.${surface.id}.title`, { defaultValue: surface.id })}</span>
            <small className="acc-quick-sub">{t(`intentAI.cc.quick.${surface.id}.sub`, { defaultValue: '' })}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The portfolio read.
 *
 * Three honesty rules, each visible in the markup: an unread wallet says "not
 * connected", not "$0"; a risk score without attested balances is hidden rather
 * than zeroed; and the opportunity count is a number only when the yield feed
 * actually answered.
 */
export function AiPortfolioCard({ t, snapshot, onReview, onPlan }) {
  const p = snapshot?.portfolio || {};
  const insights = snapshot?.insights || {};
  const opportunities = insights.opportunities;
  const risks = insights.risks;
  const live = p.dataStatus === 'live';
  return (
    <section className="acc-portfolio" data-testid="ai-portfolio-card" data-status={p.dataStatus || 'unavailable'}>
      <header className="acc-portfolio-head">
        <span className="acc-label">
          <span aria-hidden="true">✦</span>
          {t('intentAI.cc.portfolio.title', { defaultValue: 'AI portfolio read' })}
        </span>
        <span className={`acc-tag${live ? ' is-live' : ''}`}>
          {live
            ? t('intentAI.cc.data.fromWallet', { defaultValue: 'from your wallet' })
            : t('intentAI.cc.data.notConnected', { defaultValue: 'no wallet read yet' })}
        </span>
      </header>

      <div className="acc-portfolio-value">
        <b className="acc-value" data-testid="ai-portfolio-value">{live ? usd(p.totalValueUsd) : '—'}</b>
        <span className={`acc-delta ${Number(p.pnl24hPct) > 0 ? 'up' : Number(p.pnl24hPct) < 0 ? 'down' : ''}`} data-testid="ai-portfolio-delta">
          {Number.isFinite(Number(p.pnl24hPct)) ? `${pct(p.pnl24hPct)} 24h` : t('intentAI.cc.portfolio.noPnl', { defaultValue: 'no 24h read' })}
        </span>
      </div>

      <div className="acc-portfolio-meta">
        <div className="acc-meta" data-testid="ai-portfolio-risk">
          <span>{t('intentAI.cc.portfolio.risk', { defaultValue: 'Risk' })}</span>
          <strong>
            {p.riskScore == null
              ? t('intentAI.cc.portfolio.riskUnknown', { defaultValue: 'unknown' })
              : `${p.riskScore}/100`}
            {p.riskScore != null && p.riskLabel
              ? <em>{t(`intentAI.cc.risk.${p.riskLabel}`, { defaultValue: p.riskLabel })}</em>
              : null}
          </strong>
        </div>
        <div className="acc-meta">
          <span>{t('intentAI.cc.portfolio.concentration', { defaultValue: 'Largest position' })}</span>
          <strong>{Number.isFinite(Number(p.concentrationPct)) ? `${p.concentrationPct}%` : '—'}</strong>
        </div>
        <div className="acc-meta">
          <span>{t('intentAI.cc.portfolio.stable', { defaultValue: 'Stable buffer' })}</span>
          <strong>{Number.isFinite(Number(p.stableSharePct)) ? `${p.stableSharePct}%` : '—'}</strong>
        </div>
      </div>

      <p className="acc-ai-line" data-testid="ai-portfolio-insight">
        <span aria-hidden="true">✦</span>
        {opportunities?.count == null
          ? t('intentAI.cc.portfolio.noYieldFeed', { defaultValue: 'The yield feed did not answer, so no opportunity count is shown.' })
          : t('intentAI.cc.portfolio.found', {
            n: opportunities.count,
            r: risks?.count ?? 0,
            defaultValue: `AI found ${opportunities.count} opportunit${opportunities.count === 1 ? 'y' : 'ies'} and ${risks?.count ?? 0} risk${risks?.count === 1 ? '' : 's'}.`
          })}
      </p>

      <div className="acc-portfolio-actions">
        <button type="button" className="acc-btn is-primary" onClick={onReview} data-testid="ai-portfolio-review">
          {t('intentAI.cc.portfolio.review', { defaultValue: 'Review portfolio' })}
        </button>
        <button type="button" className="acc-btn" onClick={onPlan} data-testid="ai-portfolio-plan">
          {t('intentAI.cc.portfolio.buildPlan', { defaultValue: 'Build a plan' })}
        </button>
      </div>

      {opportunities?.best ? (
        <p className="acc-foot-note" data-testid="ai-portfolio-best-yield">
          {t('intentAI.cc.portfolio.bestYield', {
            protocol: opportunities.best.protocol || '—',
            apy: opportunities.best.apy,
            defaultValue: `Best ranked venue right now: ${opportunities.best.protocol} at ${opportunities.best.apy}% APY`
          })}
        </p>
      ) : null}
    </section>
  );
}

/** The four tools. Same five routes, named by the job they do. */
export function AiToolGrid({ t, onPick, busy = false }) {
  return (
    <div className="acc-tools" data-testid="ai-tool-grid">
      <p className="acc-label">{t('intentAI.cc.tools.title', { defaultValue: 'AI actions' })}</p>
      <div className="acc-tools-grid">
        {AI_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="acc-tool"
            onClick={() => onPick(tool)}
            disabled={busy}
            data-testid={`ai-tool-${tool.id}`}
          >
            <span className="acc-tool-glyph" aria-hidden="true">{tool.glyph}</span>
            <span className="acc-tool-name">{t(tool.labelKey, { defaultValue: tool.id })}</span>
            <small className="acc-tool-sub">{t(`intentAI.cc.tool.${tool.id}.sub`, { defaultValue: '' })}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The live read-out while the plan is being assembled. Every row is a real
 * fetch or a real refusal: a stage with no provider ends `unavailable`, which
 * is printed as such instead of spinning or pretending.
 */
export function AiThinkRail({ t, stages = [], busy = null }) {
  if (!busy && !stages.length) return null;
  const rows = stages.length ? stages : [];
  const active = Boolean(busy);
  return (
    <div className={`acc-think${active ? ' is-live' : ''}`} data-testid="ai-think-rail" role="status" aria-live="polite">
      {rows.map((stage, index) => {
        const status = active ? (index < busy.index ? 'done' : index === busy.index ? 'working' : 'waiting') : (stage.status || 'done');
        return (
          <div key={stage.id} className={`acc-think-row is-${status}`} data-testid={`ai-think-${stage.id}`} data-status={status}>
            <span className="acc-think-dot" aria-hidden="true" />
            <span className="acc-think-label">{t(stage.labelKey, { defaultValue: stage.id })}</span>
            <span className="acc-think-state">
              {status === 'done'
                ? t('intentAI.cc.think.done', { defaultValue: 'done' })
                : status === 'working'
                  ? t('intentAI.cc.think.working', { defaultValue: 'working…' })
                  : status === 'unavailable'
                    ? t('intentAI.cc.think.unavailable', { defaultValue: 'unavailable' })
                    : t('intentAI.cc.think.waiting', { defaultValue: 'waiting' })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const fmtCadence = (t, cadence) => t(`intentAI.cc.cadence.${cadence}`, { defaultValue: cadence });

/**
 * The plan. What the AI proposes, what it costs, what it refuses to do.
 *
 * `Approve` is deliberately the ONLY action here that changes state, and the
 * text under it says what approval buys: a prepared hand-off to a venue screen,
 * not a filled order. The stage ledger below is what makes that claim checkable
 * rather than decorative — three of its rows belong to the wallet and the chain,
 * and they stay `handoff` here because this app cannot attest them.
 */
export function AiPlanCard({
  t, plan, verdict, stages = [], busy = false, onApprove, onSaved, savedLabel = null, automationProposal = null, onAcceptAutomation
}) {
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  const blocked = verdict && verdict.ok === false;
  const failed = (verdict?.checks || []).filter((c) => c.status === 'fail' && c.code !== 'APPROVAL_REQUIRED');
  return (
    <section className={`acc-plan${blocked ? ' is-blocked' : ''}`} data-testid="ai-plan-card" data-intent={plan.intent}>
      <header className="acc-plan-head">
        <span className="acc-label">
          <span aria-hidden="true">✦</span>
          {t('intentAI.cc.plan.title', { defaultValue: 'Your AI plan' })}
        </span>
        <span className={`acc-tag${blocked ? ' is-warn' : ''}`} data-testid="ai-plan-verdict">
          {blocked
            ? t(`intentAI.cc.plan.block.${verdict.reason}`, { defaultValue: verdict.reason || 'blocked' })
            : t('intentAI.cc.plan.ready', { defaultValue: 'ready for your approval' })}
        </span>
      </header>

      <div className="acc-plan-grid">
        <div className="acc-plan-cell">
          <span>{t('intentAI.cc.plan.capital', { defaultValue: 'Capital' })}</span>
          {/* 0 is not a number the AI chose, it is the absence of one. Printing
              "$0" would read as a plan the user could shrink to nothing. */}
          <strong>{Number(plan.capitalUsd) > 0 ? usd(plan.capitalUsd) : t('intentAI.cc.plan.noCapital', { defaultValue: 'not stated' })}</strong>
        </div>
        <div className="acc-plan-cell">
          <span>{t('intentAI.cc.plan.duration', { defaultValue: 'Duration' })}</span>
          <strong>{plan.durationDays ? `${plan.durationDays}d` : '—'}</strong>
        </div>
        <div className="acc-plan-cell">
          <span>{t('intentAI.cc.plan.risk', { defaultValue: 'Risk' })}</span>
          <strong>{t(`intentAI.cc.risk.${plan.riskTolerance || plan.riskLabel || 'unknown'}`, { defaultValue: plan.riskTolerance || plan.riskLabel || 'unknown' })}</strong>
        </div>
        <div className="acc-plan-cell">
          <span>{t('intentAI.cc.plan.expectedYield', { defaultValue: 'Expected yield' })}</span>
          <strong data-testid="ai-plan-yield">
            {plan.expectedYieldPct == null
              ? t('intentAI.cc.plan.noYield', { defaultValue: '—' })
              : `${plan.expectedYieldPct}%`}
          </strong>
          {plan.expectedYieldPct == null ? (
            <small>{t('intentAI.cc.plan.noYieldNote', { defaultValue: 'no yield feed at plan time' })}</small>
          ) : (
            <small>{t('intentAI.cc.plan.yieldNote', { defaultValue: 'venue APY × the stable share of this plan — not a promise' })}</small>
          )}
        </div>
        <div className="acc-plan-cell">
          <span>{t('intentAI.cc.plan.riskScore', { defaultValue: 'Risk score' })}</span>
          <strong data-testid="ai-plan-risk-score">{plan.riskScore == null ? '—' : `${plan.riskScore} / 100`}</strong>
        </div>
        <div className="acc-plan-cell">
          <span>{t('intentAI.cc.plan.confidence', { defaultValue: 'Read confidence' })}</span>
          <strong>{Math.round((plan.confidence || 0) * 100)}%</strong>
          <small>{t(`intentAI.cc.plan.source.${plan.source}`, { defaultValue: plan.source })}</small>
        </div>
      </div>

      {Array.isArray(plan.allocation) && plan.allocation.length > 0 && (
        <div className="acc-alloc" data-testid="ai-plan-allocation">
          <span className="acc-label">{t('intentAI.cc.plan.strategy', { defaultValue: 'Strategy' })}</span>
          <div className="acc-alloc-bar" aria-hidden="true">
            {plan.allocation.map((a) => (
              <span key={a.symbol} style={{ flexGrow: a.pct }} className={`acc-alloc-seg is-${a.why}`} data-testid={`ai-alloc-seg-${a.symbol}`} />
            ))}
          </div>
          <ul className="acc-alloc-list">
            {plan.allocation.map((a) => (
              <li key={a.symbol}>
                <b>{a.symbol}</b>
                <span>{a.pct}%</span>
                <small>{t(`intentAI.cc.alloc.${a.why}`, { defaultValue: a.why })}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked && failed.length > 0 && (
        <div className="acc-blocked" data-testid="ai-plan-blocked">
          <strong>{t('intentAI.cc.plan.blockedTitle', { defaultValue: 'Your own limits stopped this' })}</strong>
          {failed.map((c) => (
            <p key={c.code}>
              <b>{t(`intentAI.cc.check.${c.code}`, { defaultValue: c.code })}</b>
              {c.detail ? ` · ${c.detail}` : ''}
            </p>
          ))}
          <small>{t('intentAI.cc.plan.blockedNote', { defaultValue: 'Raise a limit in AI Control, or shrink the plan. The AI never raises them for you.' })}</small>
        </div>
      )}

      {stages.length > 0 && (
        <ol className="acc-stages" data-testid="ai-plan-stages">
          {stages.map((stage) => (
            <li key={stage.id} className={`acc-stage is-${stage.status}`} data-testid={`ai-stage-${stage.id}`} data-status={stage.status}>
              <span className="acc-stage-name">{t(`intentAI.cc.stage.${stage.id}`, { defaultValue: stage.id })}</span>
              <span className="acc-stage-state">{t(`intentAI.cc.stageState.${stage.status}`, { defaultValue: stage.status })}</span>
              {stage.detail ? <small>{stage.detail}</small> : null}
            </li>
          ))}
        </ol>
      )}

      <div className="acc-plan-actions">
        <button
          type="button"
          className="acc-btn is-primary"
          onClick={() => onApprove(plan)}
          disabled={blocked || busy}
          data-testid="ai-plan-approve"
        >
          {busy ? t('intentAI.cc.plan.working', { defaultValue: 'Checking…' }) : t('intentAI.cc.plan.approve', { defaultValue: 'Approve plan' })}
        </button>
        <button type="button" className="acc-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="ai-plan-details-toggle">
          {open
            ? t('intentAI.cc.plan.hideDetails', { defaultValue: 'Hide details' })
            : t('intentAI.cc.plan.viewDetails', { defaultValue: 'View details' })}
        </button>
      </div>

      {open && (
        <div className="acc-plan-details" data-testid="ai-plan-details">
          <p className="acc-label">{t('intentAI.cc.plan.actions', { defaultValue: 'What this plan would do' })}</p>
          <ul>
            {(plan.actions || []).map((a, i) => (
              <li key={`${a.type}-${i}`} data-testid={`ai-plan-action-${a.type}`}>
                <b>{t(`intentAI.cc.action.${a.type}`, { defaultValue: a.type })}</b>
                {a.asset ? <span>{a.asset}</span> : null}
                {a.amount ? <span>{usd(a.amount)}</span> : null}
                {a.chainId ? <span>#{a.chainId}</span> : null}
                {a.venue ? <span>{a.venue}</span> : null}
              </li>
            ))}
          </ul>
          {plan.assumptions?.length ? (
            <>
              <p className="acc-label">{t('intentAI.cc.plan.assumptions', { defaultValue: 'What the AI assumed' })}</p>
              <ul>
                {plan.assumptions.map((a) => (
                  <li key={`${a.code}-${a.detail || ''}`}>
                    <b>{t(`intentAI.cc.assumption.${a.code}`, { defaultValue: a.code })}</b>
                    {a.detail ? <span>{a.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="acc-label">{t('intentAI.cc.plan.cannot', { defaultValue: 'What this assistant cannot do' })}</p>
          <ul className="acc-cannot">
            {(plan.cannotDo || []).map((c) => (
              <li key={c}>{t(`intentAI.cc.cannot.${c}`, { defaultValue: c.replace(/-/g, ' ') })}</li>
            ))}
          </ul>
        </div>
      )}

      {automationProposal?.ok ? (
        <div className="acc-automation-ask" data-testid="ai-automation-proposal">
          <p>{t('intentAI.cc.automation.proposed', {
            amount: usd(automationProposal.automation.amountUsd),
            asset: automationProposal.automation.asset || '—',
            cadence: fmtCadence(t, automationProposal.automation.cadence),
            defaultValue: 'A weekly accumulation is ready to save.'
          })}</p>
          <button type="button" className="acc-btn" onClick={() => onAcceptAutomation(automationProposal.automation)} data-testid="ai-automation-accept">
            {t('intentAI.cc.automation.save', { defaultValue: 'Save this automation' })}
          </button>
          <small>{t('intentAI.cc.automation.eachRun', { defaultValue: 'Every run still asks you to confirm. Nothing self-sends.' })}</small>
        </div>
      ) : null}

      {savedLabel ? (
        <p className="acc-handoff" data-testid="ai-plan-handoff">{savedLabel}</p>
      ) : null}
    </section>
  );
}

/**
 * Who is actually working, kept where it belongs: closed, below the plan, and
 * explicit that none of it holds a key. The roster stays in the product (it is
 * what the four routes are made of) — it is simply not the interface.
 */
export function AiAgentLanes({ t, plan }) {
  const [open, setOpen] = useState(false);
  const lanes = plan?.agentLanes || [];
  const surface = AI_SURFACES.find((s) => s.intent === plan?.intent);
  const roster = surface ? AI_AGENTS.filter((a) => a.surfaces.includes(surface.id)) : [];
  return (
    <details
      className="acc-agents"
      data-testid="ai-agent-lanes"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <summary className="acc-agents-summary">
        <span>{t('intentAI.cc.agents.title', { defaultValue: 'Behind this plan' })}</span>
        <span className="acc-agents-count" data-testid="ai-agent-count">
          {t('intentAI.cc.agents.count', {
            n: lanes.length || 1,
            total: AI_AGENTS.length,
            defaultValue: `${lanes.length || 1} of ${AI_AGENTS.length} agents · hidden by default`
          })}
        </span>
      </summary>
      <div className="acc-agents-body">
        <ul className="acc-lanes">
          {(lanes.length ? lanes : AI_SURFACES[0].lanes.map((lane) => ({ lane, live: false }))).map((l) => (
            <li key={l.lane}>
              <b>{l.title || l.lane}</b>
              <span className={`acc-tag${l.live ? ' is-live' : ''}`}>
                {l.live
                  ? t('intentAI.cc.agent.live', { defaultValue: 'runtime attached' })
                  : t('intentAI.cc.agent.specOnly', { defaultValue: 'specification, no runtime' })}
              </span>
              <small>{t('intentAI.cc.agent.advisory', { defaultValue: 'advisory only · cannot execute' })}</small>
            </li>
          ))}
        </ul>
        {roster.length > 0 && (
          <p className="acc-agents-roster" data-testid="ai-agent-roster">
            {t('intentAI.cc.agents.roster', {
              names: roster.map((a) => a.id).join(' · '),
              defaultValue: `Woken by this surface: ${roster.map((a) => a.id).join(' · ')}`
            })}
          </p>
        )}
        <p className="acc-foot-note">
          {t('intentAI.cc.agents.note', {
            defaultValue: 'None of these agents can hold a key, sign, or move funds. Market-maker, agent-to-agent, multi-agent and research run here only when a route needs them — they are not menu items.'
          })}
        </p>
      </div>
    </details>
  );
}

export { usd as formatUsd, pct as formatPct };
