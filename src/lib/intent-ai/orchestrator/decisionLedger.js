/**
 * FBT AI ORCHESTRATOR — DECISION LEDGER + PRIORS (the "learning" half)
 * ---------------------------------------------------------------------------
 * The complaint this file answers is «یادگیری‌اش کم است»: the assistant ran,
 * answered, and remembered nothing about HOW it answered — which tool actually
 * produced the evidence, which provider agreed with the judge, whether the
 * second and third model seat changed anything, and where the answer ended up
 * abstaining because a fact was never read.
 *
 * The ledger is owner-scoped, redacted and capped, and it feeds exactly three
 * decisions back into the next turn:
 *
 *   1. tool order    — the tools that produced `observed` evidence for this
 *                      kind of question are tried first when the budget cannot
 *                      cover every facet;
 *   2. seat count    — an intent type whose panels keep disagreeing earns an
 *                      extra independent seat; one that always agrees does not
 *                      (that is how the fleet stops paying for a fourth opinion
 *                      on a question two models already settled);
 *   3. honesty flags — where we abstained before because a facet was never
 *                      read is shown to the planner as a standing gap.
 *
 * Laws:
 *   · Never a credential: every field passes the same scrubber as the memory.
 *   · Owner-scoped reads. A global prior is an AGGREGATE (counts), never a
 *     verbatim question from another user.
 *   · The priors can only re-order and adjust within bounds — they can never
 *     raise confidence, and never remove the judge on a HIGH-stakes turn.
 */

import { containsSensitiveKeyOrPhrase, redactSecrets, clipDeep } from './redact.js';

/** Names that must never be promoted by learning (the executor's own list). */
const EXECUTION_SHAPED = /(?:^|[_.\-\s])(sign|broadcast|execute|settle|withdraw|transfer|approve|send|swap_?now|drain|sweep)(?:$|[_.\-\s])/i;

export const LEDGER_SCHEMA = 'fbt.ai-orchestrator-ledger.v1';
export const LEDGER_VERSION = '14.0.0';
export const LEDGER_STORE_KEY = 'fbt.ai.orchestrator.decisions.v1';

const DEFAULT_MAX_ENTRIES = Number(process.env.AI_ORCH_LEDGER_MAX || 200);
const DEFAULT_MAX_PER_OWNER = Number(process.env.AI_ORCH_LEDGER_PER_OWNER || 30);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Strip a ledger entry down to what is safe to persist and useful to learn from. */
export function sanitizeLedgerEntry(entry = {}) {
  const tools = Array.isArray(entry.tools)
    ? entry.tools.slice(0, 12).map((t) => ({
      tool: String(t?.tool || '').slice(0, 60),
      facet: String(t?.facet || '').slice(0, 40),
      status: String(t?.status || '').slice(0, 20),
      durationMs: num(t?.durationMs)
    })).filter((t) => t.tool)
    : [];
  const providers = Array.isArray(entry.providers)
    ? entry.providers.slice(0, 6).map((p) => ({
      provider: String(p?.provider || '').slice(0, 40),
      model: p?.model ? String(p.model).slice(0, 60) : null,
      stance: p?.stance ? String(p.stance).slice(0, 16) : null
    }))
    : [];
  const question = String(entry.question || '').slice(0, 240);
  return {
    schema: LEDGER_SCHEMA,
    version: LEDGER_VERSION,
    at: num(entry.at) ?? Date.now(),
    owner: String(entry.owner || 'anon').slice(0, 80),
    question: containsSensitiveKeyOrPhrase(question) ? '[REDACTED]' : question,
    intentType: String(entry.intentType || 'GENERAL').toUpperCase().slice(0, 40),
    stakes: String(entry.stakes || 'MEDIUM').toUpperCase().slice(0, 10),
    decision: String(entry.decision || 'ABSTAIN').toUpperCase().slice(0, 10),
    confidence: num(entry.confidence),
    band: String(entry.band || '').slice(0, 8) || null,
    seats: num(entry.seats) ?? 0,
    agreement: num(entry.agreement),
    conflicts: Array.isArray(entry.conflicts) ? entry.conflicts.slice(0, 5).map((c) => String(c?.kind || c?.topic || 'CONFLICT').slice(0, 40)) : [],
    missing: Array.isArray(entry.missing) ? entry.missing.slice(0, 8).map((m) => String(m).slice(0, 30)) : [],
    tools,
    providers,
    latencyMs: num(entry.latencyMs),
    degraded: entry.degraded === true,
    answered: entry.decision === 'ANSWER'
  };
}

export function createDecisionLedger({
  load = null,
  save = null,
  now = Date.now,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxPerOwner = DEFAULT_MAX_PER_OWNER
} = {}) {
  let entries = [];
  let loaded = false;
  let persistFailures = 0;

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    if (typeof load === 'function') {
      try {
        const rows = await load();
        entries = Array.isArray(rows) ? rows.filter((r) => r && r.schema === LEDGER_SCHEMA).slice(-maxEntries) : [];
      } catch { entries = []; }
    }
  }

  async function persist() {
    if (typeof save !== 'function') return { ok: true, skipped: true };
    try {
      await save(entries);
      return { ok: true };
    } catch (err) {
      /* A ledger that cannot persist must not break a turn. It is counted, so
         the health endpoint can say "learning is not durable right now"
         instead of silently pretending to learn. */
      persistFailures += 1;
      return { ok: false, error: String(err?.message || err).slice(0, 120) };
    }
  }

  const api = {
    schema: LEDGER_SCHEMA,
    version: LEDGER_VERSION,
    /** Where a caller persists this ledger if it wires load/save (store.js). */
    storeKey: LEDGER_STORE_KEY,

    async record(entry = {}) {
      await ensureLoaded();
      const row = sanitizeLedgerEntry({ ...entry, at: entry.at ?? now() });
      entries.push(row);
      /* Two caps: a global ring (bounded storage) and a per-owner slice, so one
         chatty device cannot evict every other user's learning history. */
      if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
      const mine = entries.filter((e) => e.owner === row.owner);
      if (mine.length > maxPerOwner) {
        const doomed = new Set(mine.slice(0, mine.length - maxPerOwner).map((e) => `${e.at}|${e.question}`));
        entries = entries.filter((e) => !(e.owner === row.owner && doomed.has(`${e.at}|${e.question}`)));
      }
      const saved = await persist();
      return { ok: true, entry: row, persisted: saved.ok === true, ...(saved.ok ? {} : { persistError: saved.error }) };
    },

    async recent({ owner = null, limit = 10 } = {}) {
      await ensureLoaded();
      const rows = owner ? entries.filter((e) => e.owner === owner) : entries.slice();
      return rows.slice(-Math.max(1, Math.min(50, limit))).reverse();
    },

    /**
     * Aggregated priors. `owner` scopes the read to one user's own history;
     * without it the aggregate is returned (counts only, never verbatim rows
     * from another owner).
     */
    async priors({ owner = null, intentType = null } = {}) {
      await ensureLoaded();
      const rows = entries.filter((e) => (!owner || e.owner === owner) && (!intentType || e.intentType === String(intentType).toUpperCase()));
      const tools = {};
      const providers = {};
      const seatOutcomes = {};
      for (const row of rows) {
        for (const t of row.tools) {
          const rec = tools[t.tool] || (tools[t.tool] = { uses: 0, observed: 0, degraded: 0, unavailable: 0, avgMs: 0 });
          rec.uses += 1;
          if (t.status === 'observed') rec.observed += 1;
          else if (t.status === 'degraded') rec.degraded += 1;
          else if (t.status === 'unavailable' || t.status === 'error') rec.unavailable += 1;
          if (t.durationMs) rec.avgMs = Math.round((rec.avgMs * (rec.uses - 1) + t.durationMs) / rec.uses);
        }
        for (const p of row.providers) {
          const rec = providers[p.provider] || (providers[p.provider] = { seats: 0, agreed: 0, dissented: 0 });
          rec.seats += 1;
          if (row.conflicts.length === 0 && row.decision === 'ANSWER') rec.agreed += 1;
          else if (row.conflicts.length) rec.dissented += 1;
        }
        const seatKey = String(row.seats);
        const rec = seatOutcomes[seatKey] || (seatOutcomes[seatKey] = { turns: 0, highConfidence: 0, abstained: 0, conflicts: 0 });
        rec.turns += 1;
        if ((row.confidence ?? 0) >= 70) rec.highConfidence += 1;
        if (row.decision === 'ABSTAIN' || row.decision === 'CLARIFY') rec.abstained += 1;
        if (row.conflicts.length) rec.conflicts += 1;
      }
      const toolScore = (t) => {
        if (!t?.uses) return 0;
        const observed = t.observed / t.uses;
        const unavailable = t.unavailable / t.uses;
        return Math.round((observed * 100 - unavailable * 40) * 100) / 100;
      };
      /* A tool that is never promoted is one that cannot be ordered by history
         — that is the safe default for anything the ledger has not seen. */
      const toolRanking = Object.entries(tools)
        .map(([tool, rec]) => ({
          tool,
          ...rec,
          score: toolScore(rec),
          /* Rates are what an operator (and the panel sizing) actually read:
             "this tool answered 4 of 5 times" beats a raw count. */
          observedRate: rec.uses ? Math.round((rec.observed / rec.uses) * 1e4) / 1e4 : 0,
          unavailableRate: rec.uses ? Math.round((rec.unavailable / rec.uses) * 1e4) / 1e4 : 0
        }))
        .sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));
      return {
        schema: LEDGER_SCHEMA,
        version: LEDGER_VERSION,
        sampleSize: rows.length,
        scope: owner ? 'owner' : 'aggregate',
        intentType: intentType ? String(intentType).toUpperCase() : null,
        tools,
        toolRanking,
        providers,
        seatOutcomes,
        /** Facets this scope keeps failing to read — a standing honesty flag. */
        standingGaps: (() => {
          const counts = {};
          for (const row of rows) for (const m of row.missing) counts[m] = (counts[m] || 0) + 1;
          return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([facet, count]) => ({ facet, count }));
        })()
      };
    },

    /** Re-order a tool list by prior usefulness (stable for unknown tools). */
    async rankTools(toolNames = [], { owner = null, intentType = null } = {}) {
      const p = await this.priors({ owner, intentType });
      const scoreOf = (tool) => p.tools?.[tool]?.score ?? null;
      const indexed = toolNames.map((tool, i) => ({ tool, i, score: scoreOf(tool), execution: EXECUTION_SHAPED.test(String(tool)) }));
      indexed.sort((a, b) => {
        /* An execution-shaped name is never promoted by history: it sorts to
           the end, in the caller's own order. The plan builder cannot emit one
           (evidencePlan's facets are all reads) — this is the second lock. */
        if (a.execution !== b.execution) return a.execution ? 1 : -1;
        if (a.score == null && b.score == null) return a.i - b.i;
        if (a.score == null) return 1;
        if (b.score == null) return -1;
        return b.score - a.score || a.i - b.i;
      });
      return { tools: indexed.map((x) => x.tool), priors: p, reordered: indexed.some((x, i) => x.i !== i) };
    },

    /**
     * Seat recommendation. Conservative by construction: it may RAISE the seat
     * count when this intent type keeps producing conflicts, and may lower 3→2
     * only for MEDIUM stakes with a real sample and no conflicts — never below
     * 2, and never for HIGH stakes.
     */
    async seatRecommendation({ owner = null, intentType = null, stakes = 'MEDIUM', defaultSeats = 2 } = {}) {
      const p = await this.priors({ owner, intentType });
      const level = String(stakes || 'MEDIUM').toUpperCase();
      const out = { seats: defaultSeats, reason: 'DEFAULT', sampleSize: p.sampleSize, priors: p };
      if (p.sampleSize < 3) return { ...out, reason: 'INSUFFICIENT_SAMPLE' };
      const conflictRate = p.seatOutcomes?.[String(defaultSeats)]?.conflicts / Math.max(1, p.seatOutcomes?.[String(defaultSeats)]?.turns || 1);
      if (level === 'HIGH') return { ...out, reason: 'HIGH_STAKES_KEEP_SEATS' };
      if (Number.isFinite(conflictRate) && conflictRate >= 0.4 && defaultSeats < 3) {
        return { ...out, seats: defaultSeats + 1, reason: `RAISED:CONFLICT_RATE=${Math.round(conflictRate * 100)}%` };
      }
      if (level === 'MEDIUM' && defaultSeats >= 3 && conflictRate === 0 && (p.seatOutcomes?.['3']?.highConfidence || 0) >= 2) {
        return { ...out, seats: 2, reason: 'LOWERED:NO_CONFLICTS' };
      }
      return out;
    },

    async stats() {
      await ensureLoaded();
      const byDecision = entries.reduce((acc, e) => { acc[e.decision] = (acc[e.decision] || 0) + 1; return acc; }, {});
      const confidences = entries.map((e) => e.confidence).filter((c) => Number.isFinite(c));
      return {
        schema: LEDGER_SCHEMA,
        version: LEDGER_VERSION,
        entries: entries.length,
        total: entries.length,
        averageConfidence: confidences.length
          ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10) / 10
          : null,
        byOwner: entries.reduce((acc, e2) => { acc[e2.owner] = (acc[e2.owner] || 0) + 1; return acc; }, {}),
        owners: new Set(entries.map((e) => e.owner)).size,
        byDecision,
        persistFailures,
        durable: typeof save === 'function',
        maxEntries,
        maxPerOwner
      };
    },

    /** Test hook + the persistence path used by the server. */
    exportEntries() { return entries.slice(); },
    async importEntries(rows = []) {
      entries = (Array.isArray(rows) ? rows : []).filter((r) => r && r.schema === LEDGER_SCHEMA).slice(-maxEntries);
      loaded = true;
      return { ok: true, entries: entries.length };
    },
    exportState() { return { schema: LEDGER_SCHEMA, version: LEDGER_VERSION, entries: entries.slice(), persistFailures }; },
    async importState(state = {}) {
      if (state.schema !== LEDGER_SCHEMA) return { ok: false, error: 'STATE_SCHEMA_MISMATCH' };
      persistFailures = Number(state.persistFailures) || 0;
      return this.importEntries(state.entries || []);
    },
    _reset() { entries = []; loaded = false; persistFailures = 0; },
    /** Deep-clip helper for callers building an entry from a live turn. */
    clip: (value) => clipDeep(redactSecrets(value), 300)
  };
  return api;
}

export default createDecisionLedger;
