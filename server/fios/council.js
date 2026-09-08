/**
 * FBT FINANCIAL INTELLIGENCE OS — AI Council (batch 6).
 * ---------------------------------------------------------------------------
 * SIX roles sit in the room for every decision, and they are allowed to
 * disagree:
 *
 *   FINANCIAL_ANALYST    best goal-adjusted return
 *   STRATEGY_ARCHITECT   lowest complexity + fees for the same outcome
 *   RISK_AUDITOR         vetoes what the user's risk profile cannot carry
 *   YIELD_ANALYST        best evidenced yield
 *   TRADING_ANALYST      entry timing / execution style
 *   GUARDIAN             consistency + suitability; can only block or warn
 *
 * (An external agent may attend as a SEVENTH, down-weighted and marked
 * untrusted — it is never one of the six, and never the tie-breaker.)
 *
 * WHAT THIS FILE ADDS OVER THE COMPETITION ENGINE
 * The competition (fios/competition.js) already runs the five internal
 * analysts over the candidate set and adjudicates a winner. The council is
 * the formal body that (a) adds the sixth role — the Guardian, run through
 * the shared `financialGuardian` so the supervised and the autonomous paths
 * are judged by the same instrument — and (b) makes the disagreement a
 * PERSISTED, QUERYABLE RECORD: every vote with its verdict, confidence and
 * reason, who dissented and why, and the capped confidence that results.
 *
 * AGGREGATION (lexical, not averaged)
 *   the worst verdict wins: one REJECT beats any number of APPROVEs;
 *   unanimity is measured over the votes that were not abstentions;
 *   confidence is the mean of the approving roles, capped: a single REJECT
 *   caps at 0.2 and every REVISE removes a fifth — so "bullish but risky"
 *   reads as low confidence instead of a split mean pretending it is not.
 *
 * The council NEVER grants permission — it can only withhold support
 * (`grantsPermission: false` on every record).
 */
import { randomUUID } from 'node:crypto';
import { financialGuardian } from '../../src/lib/central/council.js';
import { round } from '../../src/lib/central/schema.js';

export const COUNCIL_ENGINE_SCHEMA = 'fbt.fi.council.v1';

export const COUNCIL_ROLES = Object.freeze([
  'FINANCIAL_ANALYST', 'STRATEGY_ARCHITECT', 'RISK_AUDITOR',
  'YIELD_ANALYST', 'TRADING_ANALYST', 'GUARDIAN'
]);

export const COUNCIL_VERDICTS = Object.freeze(['APPROVE', 'REVISE', 'REJECT', 'ABSTAIN']);
const RANK = Object.freeze({ ABSTAIN: 0, APPROVE: 1, REVISE: 2, REJECT: 3 });
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Map one competition agent report to a council vote.
 *  - no pick and low confidence → the role had nothing readable → ABSTAIN
 *  - a veto → REJECT (the Risk Auditor's veto is the loudest voice in the room)
 *  - a pick different from the winner → REVISE (disagreement, with the reason)
 *  - otherwise → APPROVE
 */
function voteFromAgentReport(role, report, winnerId) {
  if (!report) return { role, verdict: 'ABSTAIN', confidence: 0, reason: 'the role produced no report', evidence: [] };
  const pickId = report.proposalId || report.pick?.id || null;
  const vetoes = Array.isArray(report.veto) ? report.veto : [];
  if (vetoes.length) {
    return { role, verdict: 'REJECT', confidence: num(report.confidence) ?? 0.8, reason: report.reasoning || 'veto issued', veto: vetoes.map((v) => v.reason || v.strategyId), evidence: [] };
  }
  if (pickId === null) {
    return { role, verdict: 'ABSTAIN', confidence: 0, reason: report.reasoning || 'nothing readable for this role', evidence: [] };
  }
  if (winnerId && pickId !== winnerId) {
    return { role, verdict: 'REVISE', confidence: num(report.confidence) ?? 0.5, reason: `${report.reasoning || 'a different candidate fits better'} (prefers ${pickId} over ${winnerId})`, evidence: [] };
  }
  return { role, verdict: 'APPROVE', confidence: num(report.confidence) ?? 0.5, reason: report.reasoning || 'supports the leading candidate', evidence: [] };
}

/** The sixth role: the shared financial guardian, translated to a verdict.
 *  A finding the guardian COULD NOT JUDGE is an abstention, not a revise —
 *  "I did not read that input" is honest silence, not opposition. */
function voteFromGuardian(guardianOut) {
  if (!guardianOut) return { role: 'GUARDIAN', verdict: 'ABSTAIN', confidence: 0, reason: 'the guardian produced no evaluation', findings: [] };
  const raw = guardianOut.findings || [];
  const findings = raw.map((f) => ({ id: f.id, ok: f.ok, unknown: f.unknown === true, severity: f.severity, detail: String(f.detail || '').slice(0, 200) }));
  const blocking = raw.filter((f) => !f.ok && !f.unknown && f.severity === 'BLOCK');
  const hardWarns = raw.filter((f) => !f.ok && !f.unknown && f.severity !== 'BLOCK');
  const unknowns = raw.filter((f) => f.unknown);
  if (guardianOut.status === 'BLOCK' || blocking.length) {
    return { role: 'GUARDIAN', verdict: 'REJECT', confidence: 0.95, reason: blocking.map((b) => b.detail || b.id).join('; '), findings };
  }
  if (hardWarns.length) {
    return { role: 'GUARDIAN', verdict: 'REVISE', confidence: 0.55, reason: hardWarns.map((w) => w.detail || w.id).slice(0, 3).join('; '), findings };
  }
  if (unknowns.length) {
    return { role: 'GUARDIAN', verdict: 'ABSTAIN', confidence: 0, reason: `${unknowns.length} finding(s) could not be judged (unread input): ${unknowns.map((u) => u.id).slice(0, 4).join(', ')}`, findings };
  }
  return { role: 'GUARDIAN', verdict: 'APPROVE', confidence: 0.7, reason: 'every suitability and consistency check passed on readable input', findings };
}

export function createCouncil({ collections, competition = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  /**
   * Convene the council on a candidate set.
   *
   * @param {object} p
   * @param {string} p.owner
   * @param {object[]} p.strategies    normalised proposals (competition input)
   * @param {object} [p.preferences]
   * @param {object} [p.goal]
   * @param {object} [p.competition]   a pre-run competition (reused when given —
   *                                   one decision, one competition)
   * @param {object} [p.risk]          { level, securitySignals }
   * @param {object} [p.financial]     canonical financial state
   * @param {object} [p.world]         world model (freshness)
   * @param {object} [p.decision]      the decision row this council judges
   * @param {object} [p.goalSpec]      goal for the guardian ({ type, name, horizonMonths })
   * @param {object} [p.externalAgent] optional seventh seat (see header)
   * @param {string} [p.correlationId]
   */
  async function convene({
    owner, strategies = [], preferences = null, goal = null, competition: preRun = null,
    risk = null, financial = null, world = null, decision = null, goalSpec = null,
    externalAgent = null, correlationId = null
  } = {}) {
    const at = now();

    /* The five internal analysts: reuse a pre-run competition when the
       caller already ran one for the same candidates; otherwise run it. */
    let comp = preRun;
    if (!comp) {
      if (!competition) return { ok: false, code: 'COMPETITION_NOT_WIRED', detail: 'the council needs the competition engine (or a pre-run competition)' };
      comp = await competition.compete({ owner, strategies, preferences, goal, externalAgent, correlationId });
      if (!comp.ok) return { ok: false, code: comp.code, detail: 'the council could not convene: the competition itself failed' };
    }
    const compResult = comp.competition;
    const winnerId = compResult?.judge?.winnerId || null;

    const votes = [];
    const agentFor = (role) => (compResult?.agents || []).find((a) => a.role === role);
    for (const role of COUNCIL_ROLES.slice(0, 5)) {
      votes.push(voteFromAgentReport(role, agentFor(role), winnerId));
    }

    /* ── the sixth role: the guardian ─────────────────────────────────── */
    /* An empty stale list is not "everything was live" — when the financial
       state was not read at all, freshness is UNKNOWN, and the guardian must
       abstain on it instead of rubber-stamping it. */
    const winnerRow = (strategies || []).find((s) => s?.id === winnerId) || null;
    const guardianOut = financialGuardian({
      decision: {
        id: decision?.id || null,
        type: decision?.decision || decision?.type || null,
        riskLevel: String(risk?.level || decision?.riskLevel || '').toUpperCase() || null,
        expectedReturnPct: decision?.expectedReturnPct ?? (winnerRow ? num(winnerRow.expectedReturnPct) : null),
        capitalRequiredUsd: num(decision?.capitalRequiredUsd),
        downside: decision?.downside
          || (winnerRow ? `modelled: ${winnerRow.potentialLossPct ?? 'unmodelled'}% potential loss on ${winnerRow.name || winnerRow.id}` : null)
      },
      goal: goalSpec || null,
      profile: { riskProfile: { value: String(preferences?.riskTolerance || '').toUpperCase() || null } },
      financialState: {
        availableCapitalUsd: financial ? num(readEnv(financial.net?.availableCapitalUsd)) : null,
        netWorthUsd: financial ? num(readEnv(financial.net?.netWorthUsd)) : null
      },
      freshnessReport: financial ? { stale: (financial.provenance?.stale || []).map((s) => ({ key: s })), unavailable: (financial.provenance?.unavailable || []).map((s) => ({ key: s })) } : null,
      reversible: decision?.reversible ?? null,
      now: at
    });
    votes.push(voteFromGuardian(guardianOut));

    /* ── optional seventh seat: the external agent ────────────────────── */
    let externalVote = null;
    if (externalAgent) {
      const extAgent = (compResult?.agents || []).find((a) => a.role === 'EXTERNAL_AGENT');
      if (extAgent?.excluded) {
        externalVote = { role: 'EXTERNAL_AGENT', verdict: 'ABSTAIN', confidence: 0, reason: `excluded: ${extAgent.reason || 'not authorized or not trusted'}`, untrusted: true, counted: false };
      } else if (extAgent) {
        externalVote = {
          role: 'EXTERNAL_AGENT',
          verdict: voteFromAgentReport('EXTERNAL_AGENT', extAgent, winnerId).verdict,
          confidence: num(extAgent.confidence) ?? 0.3,
          reason: extAgent.reasoning || 'external preference',
          untrusted: true,
          downWeighted: true,
          counted: false
        };
      }
    }

    /* ── aggregate: the worst verdict wins, dissent is the record ─────── */
    const counting = votes;
    const abstained = counting.filter((v) => v.verdict === 'ABSTAIN').map((v) => v.role);
    const voting = counting.filter((v) => v.verdict !== 'ABSTAIN');
    const verdict = voting.length
      ? voting.reduce((worst, v) => (RANK[v.verdict] > RANK[worst] ? v.verdict : worst), 'APPROVE')
      : 'ABSTAIN';
    const unanimous = voting.length > 0 && voting.every((v) => v.verdict === 'APPROVE');
    const disagreements = voting.filter((v) => v.verdict !== 'APPROVE').map((v) => ({ role: v.role, verdict: v.verdict, confidence: v.confidence, reason: v.reason, ...(v.veto ? { veto: v.veto } : {}) }));

    const approvals = voting.filter((v) => v.verdict === 'APPROVE');
    const rejects = voting.filter((v) => v.verdict === 'REJECT').length;
    const revises = voting.filter((v) => v.verdict === 'REVISE').length;
    const base = approvals.length ? approvals.reduce((a, v) => a + v.confidence, 0) / approvals.length : 0;
    const cap = rejects ? 0.2 : Math.max(0.15, 1 - revises * 0.2);
    const confidence = voting.length ? round(Math.min(base, cap), 3) : 0;

    const narrative = disagreements.length && approvals.length
      ? `${approvals.map((a) => a.role).join(', ')} support the candidate; ${disagreements.map((d) => `${d.role} says ${d.verdict.toLowerCase()}`).join('; ')} — the disagreement is why confidence is ${Math.round(confidence * 100)}% and not higher.`
      : disagreements.length
        ? `no role supported the candidate: ${disagreements.map((d) => `${d.role} ${d.verdict.toLowerCase()}`).join(', ')}.`
        : voting.length
          ? `all ${approvals.length} voting roles agreed (abstentions: ${abstained.length || 'none'}).`
          : 'no role had anything readable to judge; the council abstains entirely.';

    const record = {
      schema: COUNCIL_ENGINE_SCHEMA,
      id: `cnc_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      owner: null,
      at,
      decisionId: decision?.id || null,
      competitionId: compResult?.id || null,
      winnerId,
      roles: COUNCIL_ROLES,
      votes: votes.map(({ role, verdict: v, confidence: c, reason, findings, veto }) => ({ role, verdict: v, confidence: c, reason, findings: findings || null, veto: veto || null })),
      externalAgent: externalVote,
      abstained,
      unanimous,
      disagreement: disagreements.length > 0,
      disagreements,
      verdict,
      confidence,
      narrative,
      grantsPermission: false,
      durable: null
    };

    /* Persist: the disagreement is a first-class, queryable row. */
    if (collections) {
      const res = await collections.put('strategy_comparisons', owner, record, { idKey: 'id' });
      record.durable = res.durable ?? collections.durable();
    }
    if (observability) {
      observability.emit({
        type: 'strategy.selected', owner, correlationId,
        payload: { councilId: record.id, verdict, disagreement: record.disagreement, dissenters: disagreements.map((d) => d.role), confidence }
      });
    }
    return { ok: true, council: record, durable: record.durable };
  }

  async function recent(owner, { limit = 10 } = {}) {
    if (!collections) return { ok: false, code: 'COLUMNS_NOT_WIRED', records: [] };
    const { rows } = await collections.read('strategy_comparisons', owner);
    const records = rows.filter((r) => r?.schema === COUNCIL_ENGINE_SCHEMA).slice(0, Math.max(1, limit));
    return { ok: true, records, durable: collections.durable() };
  }

  async function get(owner, id) {
    if (!collections) return { ok: false, code: 'COLUMNS_NOT_WIRED', record: null };
    const { rows } = await collections.read('strategy_comparisons', owner);
    const record = rows.find((r) => r?.id === String(id)) || null;
    return { ok: Boolean(record), record, code: record ? null : 'COUNCIL_NOT_FOUND', durable: collections.durable() };
  }

  return {
    schema: COUNCIL_ENGINE_SCHEMA,
    ROLES: COUNCIL_ROLES,
    VERDICTS: COUNCIL_VERDICTS,
    convene, get, recent
  };
}

function readEnv(env) {
  return env && typeof env === 'object' && 'value' in env ? env.value : env;
}
