/**
 * FBT INTENT AI — EXTERNAL AGENT VOICE (Phase 204)
 * ---------------------------------------------------------------------------
 * Reported as: «ارتباط ندادن ایجنت خارجی» — an external agent could be
 * DISCOVERED but never SAID anything, so the external-agent mode looked
 * exactly like the normal mode with extra steps.
 *
 * This module gives a discovered, analysis-eligible external agent ONE
 * deterministic, data-grounded line in the conversation — a second opinion
 * over the SAME sourced market block the assistant already shows:
 *
 *   · a market analyst voice speaks about the trend (the signal)
 *   · a risk auditor voice speaks about realised volatility (the risk)
 *   · anything else states its capabilities and that it is analysis-only
 *
 * The rules are written here so anyone can audit them; the numbers come from
 * the injected market analysis (never invented); and no line from this module
 * can authorize anything — `canExecute: false` is part of every result.
 */

export const EXTERNAL_VOICE_SCHEMA = 'fbt.external-agent-voice.v1';

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

/** Which persona an agent speaks with, derived from its own capabilities. */
export function agentPersona(agent = {}) {
  const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  if (capabilities.includes('risk-review') || capabilities.includes('policy-review')) return 'risk-auditor';
  if (capabilities.includes('market-analysis') || capabilities.includes('regime-review')) return 'market-analyst';
  return 'analyst';
}

/**
 * The external agent's one line, from real data.
 *
 * @param {object} view           the externalView summary attached to a reply:
 *                                { agentId, agentName, capabilities, eligibleForAnalysis }
 * @param {object} marketAnalysis the sourced market block (live, offline or
 *                                unavailable — the voice adapts honestly)
 * @returns {object|null}         { schema, agentId, agentName, persona,
 *                                i18nKey, params, canExecute:false } or null
 *                                when the agent has no standing to speak.
 */
export function externalAgentRead({ view = {}, marketAnalysis = {} } = {}) {
  if (!view || view.eligibleForAnalysis !== true) return null;
  const agent = {
    id: String(view.agentId || '').slice(0, 64),
    name: String(view.agentName || view.agentId || 'external agent').slice(0, 96),
    capabilities: Array.isArray(view.capabilities) ? view.capabilities.slice(0, 8) : []
  };
  if (!agent.id) return null;
  const persona = agentPersona(view);

  const rows = Array.isArray(marketAnalysis.assets) ? marketAnalysis.assets : [];
  const focus = rows.find((row) => row && row.dataStatus !== 'unavailable' && num(row.price) !== null) || null;

  /* No live data: the external agent says so instead of guessing. */
  if (!focus) {
    return {
      schema: EXTERNAL_VOICE_SCHEMA,
      agentId: agent.id,
      agentName: agent.name,
      persona,
      i18nKey: 'intentAI.external.readNoData',
      params: { agent: agent.name },
      canExecute: false
    };
  }

  const change = round1(num(focus.change24hPct));
  const signal = typeof focus.signal === 'string' ? focus.signal : 'unknown';
  const risk = typeof focus.risk === 'string' ? focus.risk : 'unknown';
  const volatility = round1(num(focus.volatilityPct));

  if (persona === 'risk-auditor') {
    return {
      schema: EXTERNAL_VOICE_SCHEMA,
      agentId: agent.id,
      agentName: agent.name,
      persona,
      i18nKey: 'intentAI.external.readAuditor',
      params: {
        agent: agent.name,
        symbol: focus.symbol,
        risk,
        volatility: volatility ?? '—'
      },
      canExecute: false
    };
  }

  return {
    schema: EXTERNAL_VOICE_SCHEMA,
    agentId: agent.id,
    agentName: agent.name,
    persona,
    i18nKey: 'intentAI.external.readAnalyst',
    params: {
      agent: agent.name,
      symbol: focus.symbol,
      signal,
      change: change ?? '—'
    },
    canExecute: false
  };
}

/**
 * Pick the external agent that participates in this session.
 * Deterministic: an explicitly selected id wins; otherwise the single
 * analysis-eligible candidate is used; two or more candidates without a
 * choice stay unselected (the user must choose — no silent default).
 */
export function selectExternalAgent({ candidates = [], selectedId = null } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (selectedId) {
    const chosen = list.find((c) => c?.passport?.id === String(selectedId));
    if (chosen?.eligibleForAnalysis === true) return chosen;
    return null;
  }
  const eligible = list.filter((c) => c?.eligibleForAnalysis === true);
  return eligible.length === 1 ? eligible[0] : null;
}
