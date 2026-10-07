/**
 * FBT AI ORCHESTRATOR — Upgrade 14 (server)
 * ---------------------------------------------------------------------------
 * The turn, end to end, as one explicit state graph:
 *
 *   plan ──▶ gather ──▶ analyze ──▶ judge ──▶ decide ──▶ learn
 *    │         │           │          │          │         └─ ledger + memory
 *    │         │           │          │          └─ answer / clarify / abstain
 *    │         │           │          └─ evidence-weighted verdict, dissent kept
 *    │         │           └─ N independent models, N decided by the plan
 *    │         └─ only the tools the plan asked for, inside the deadline
 *    └─ what data does this turn need, and how much brain is it worth?
 *
 * What this replaces (nothing — it ADDS): the existing collaboration engine
 * owns full authored answers, the escalation ladder owns "walk the fleet until
 * someone can answer", and both stay exactly as they are. This graph is the
 * missing first step — reading the facts BEFORE asking a model — plus the
 * missing last step — a judge that resolves disagreement into a decision with
 * an explicit confidence, the dissent it kept, and what would change its mind.
 *
 * Wiring (server/aiIntentOS.js): used when the deterministic reply has a real
 * gap, or when a caller explicitly asks for the orchestrator. If the graph
 * cannot produce something usable inside the deadline, the caller falls back to
 * exactly the behaviour it had before — this layer can only improve an answer,
 * never remove one.
 *
 * Non-negotiables, enforced in code rather than in prose:
 *   · read-only: no node here signs, approves, sends or settles anything;
 *   · numbers come from tool rows, never from a model sentence;
 *   · no secrets reach a prompt (scrubber before prompt build) or memory;
 *   · one deadline for the whole turn, with the gather step capped inside it.
 */

import { createGraph, RUN_STATUS } from '../src/lib/intent-ai/orchestrator/graphEngine.js';
import { buildEvidencePlan, describeEvidencePlan, FACETS } from '../src/lib/intent-ai/orchestrator/evidencePlan.js';
import { createVectorStore } from '../src/lib/intent-ai/orchestrator/vectorStore.js';
import { createRagMemory } from '../src/lib/intent-ai/orchestrator/ragMemory.js';
import { createDecisionLedger, LEDGER_STORE_KEY } from '../src/lib/intent-ai/orchestrator/decisionLedger.js';
import { judge as defaultJudge, renderJudgment, DECISIONS } from '../src/lib/intent-ai/orchestrator/judge.js';
import { executeToolRequests, listTools } from './aiToolBroker.js';
import { containsSensitiveKeyOrPhrase, redactSecrets, REDACT_SCHEMA } from '../src/lib/intent-ai/orchestrator/redact.js';

export const ORCHESTRATOR_SCHEMA = 'fbt.ai-orchestrator.v1';
export const ORCHESTRATOR_VERSION = '14.0.0';

const DEFAULT_DEADLINE_MS = Number(process.env.AI_ORCH_DEADLINE_MS || 14_000);
const GATHER_SHARE = Number(process.env.AI_ORCH_GATHER_SHARE || 0.42);
const SEAT_MAX_TOKENS = Number(process.env.AI_ORCH_SEAT_TOKENS || 620);
const SEAT_TIMEOUT_MS = Number(process.env.AI_ORCH_SEAT_TIMEOUT_MS || 9000);
const MIN_ANSWER_CHARS = 24;

/** Race a promise against a clock; the losing branch is a labelled error. */
function raceTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timeout after ${ms}ms`);
        err.code = 'SEAT_TIMEOUT';
        reject(err);
      }, Math.max(200, ms));
    })
  ]).finally(() => clearTimeout(timer));
}

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null);

/** Numbers a human reads get the user's numerals; prompts keep raw ASCII. */
export function formatNumber(value, locale = 'fa') {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const fa = String(locale || 'fa').startsWith('fa');
  try {
    return new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US', { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}

/* -------------------------------------------------------------------------- */
/*  Process-level singletons (one index, one ledger per instance)               */
/* -------------------------------------------------------------------------- */

let ragSingleton = null;
let ledgerSingleton = null;

/** The orchestrator's RAG memory (indexed once per warm instance). */
export function getOrchestratorRag() {
  if (ragSingleton) return ragSingleton;
  ragSingleton = createRagMemory({
    store: createVectorStore({ mode: process.env.AI_ORCH_VECTOR || 'auto', dim: Number(process.env.AI_ORCH_VECTOR_DIM || 256) })
  });
  return ragSingleton;
}

/** The learning ledger, persisted through the app's KV store when configured. */
export function getOrchestratorLedger() {
  if (ledgerSingleton) return ledgerSingleton;
  ledgerSingleton = createDecisionLedger({
    load: async () => {
      const { storeGet } = await import('./store.js');
      return (await storeGet(LEDGER_STORE_KEY)) || [];
    },
    save: async (rows) => {
      const { storeSet, EPHEMERAL_TTL_MS } = await import('./store.js');
      await storeSet(LEDGER_STORE_KEY, rows, EPHEMERAL_TTL_MS);
    }
  });
  return ledgerSingleton;
}

/** Test/ops hook — drops the process-level singletons. */
export function _resetOrchestratorSingletons() {
  ragSingleton = null;
  ledgerSingleton = null;
}

/* -------------------------------------------------------------------------- */
/*  Prompts (the model is the LAST step, and it is told so)                    */
/* -------------------------------------------------------------------------- */

const SEAT_ROLES = Object.freeze({
  analyst: {
    fa: 'تحلیلگر ارشد FBT',
    en: 'FBT senior analyst',
    instruction: 'Answer the question from the EVIDENCE. State the few claims the answer stands on. If the evidence does not cover something the question needs, say so explicitly instead of filling it in.',
    faInstruction: 'فقط بر پایهٔ «شواهد» پاسخ بده. چند ادعای اصلی که پاسخ بر آن‌ها ایستاده را جدا کن. اگر شاهدی برای بخشی از پرسش نیست، همان را صریح بگو و جای خالی را پر نکن.'
  },
  'risk-reviewer': {
    fa: 'بازبین ریسک FBT',
    en: 'FBT risk reviewer',
    instruction: 'Take the opposite side: which part of the obvious answer could be wrong, and which risk is being under-weighted? Be concrete and cite the evidence that would settle it.',
    faInstruction: 'طرف مقابل را بگیر: کدام بخش از پاسخ بدیهی می‌تواند غلط باشد و کدام ریسک کم‌شمرده شده؟ دقیق باش و بگو چه شاهدی تعیین‌کننده است.'
  },
  'macro-reviewer': {
    fa: 'بازبین کلان و پرتفوی FBT',
    en: 'FBT macro & portfolio reviewer',
    instruction: 'Judge the question against the macro and portfolio evidence: does the portfolio context change the conclusion, and does the macro picture support it?',
    faInstruction: 'پرسش را با شواهد کلان و پرتفوی بسنج: آیا وضعیت پرتفوی نتیجه را عوض می‌کند و آیا تصویر کلان آن را تأیید می‌کند؟'
  }
});

const LAWS = [
  'You are part of FBT Swap, a non-custodial crypto app. You cannot execute, sign, approve or move funds — never imply otherwise.',
  'Every number you write must appear in the EVIDENCE. If it is not there, do not state it.',
  'Never invent a balance, a price, a fee or an APY.',
  'Reply with JSON only, no markdown fences, in this exact shape:',
  '{"summary":"<answer text in the user language, max 900 chars>","claims":[{"text":"<one claim>","kind":"number|claim|prediction"}],"stance":"bullish|bearish|neutral|mixed","confidence":0.0,"used_evidence":["facet_id"],"limits":["what you could not verify"]}'
].join('\n');

export function buildSeatPrompt({ question, role, locale, evidenceBlock, ragBlock, laws = LAWS }) {
  const r = SEAT_ROLES[role] || SEAT_ROLES.analyst;
  const fa = String(locale || 'fa').startsWith('fa');
  const system = [
    `${fa ? r.fa : r.en}.`,
    fa ? r.faInstruction : r.instruction,
    '',
    laws
  ].join('\n');
  /* The scrubber runs HERE, at the last moment before a prompt exists: a
     credential in the question or in a fetched row never reaches a provider. */
  const user = [
    `QUESTION:\n${clip(promptSafe(question), 900)}`,
    '',
    'EVIDENCE (the only facts you may use; `status` says how it was read):',
    clip(promptSafe(evidenceBlock), 2600) || '(no tool read succeeded this turn)',
    '',
    'RAG PASSAGES (verified FBT knowledge; cite the id if you use one):',
    clip(promptSafe(ragBlock), 1600) || '(none)',
    '',
    `Write the whole reply in ${fa ? 'Persian (فارسی)' : 'the user’s language (English unless the question is in another language)'}.`
  ].join('\n');
  return { system, user };
}

function parseSeatJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function normalizeSeat({ provider, model, raw, latencyMs }) {
  const parsed = parseSeatJson(raw);
  const summary = clip(parsed?.summary || raw, 1200);
  if (!summary || summary.trim().length < MIN_ANSWER_CHARS) {
    return { provider, model, ok: false, error: 'SEAT_TOO_SHORT', latencyMs };
  }
  const claims = Array.isArray(parsed?.claims)
    ? parsed.claims.slice(0, 8).map((c) => ({
      text: clip(typeof c === 'string' ? c : c?.text, 240),
      kind: clip(typeof c === 'object' ? c?.kind : 'claim', 16) || 'claim'
    })).filter((c) => c.text)
    : [];
  return {
    provider,
    model,
    ok: true,
    answer: summary,
    claims: claims.length ? claims : undefined, // judge extracts them when absent
    stance: ['bullish', 'bearish', 'neutral', 'mixed'].includes(String(parsed?.stance)) ? String(parsed.stance) : null,
    confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : null,
    usedEvidence: Array.isArray(parsed?.used_evidence) ? parsed.used_evidence.slice(0, 8).map((x) => clip(x, 40)) : [],
    limits: Array.isArray(parsed?.limits) ? parsed.limits.slice(0, 4).map((x) => clip(x, 160)) : [],
    latencyMs
  };
}

/* -------------------------------------------------------------------------- */
/*  Evidence-only answer (zero models, still useful)                            */
/* -------------------------------------------------------------------------- */

/**
 * When no external provider is configured or every seat failed, the turn still
 * has real tool reads. Answering from them is strictly better than a shrug —
 * and it says out loud what it could not read.
 */
export function composeEvidenceOnlyAnswer({ evidence = [], plan = null, locale = 'fa' } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const observed = (evidence || []).filter((r) => r.status === 'observed' && r.summary);
  const lines = [];
  const citations = [];

  for (const row of observed) {
    const s = row.summary || {};
    if (row.facetId === 'portfolio_state' && s.totalValueUsd != null) {
      const top = (s.holdings || []).slice(0, 3).map((h) => `${h.symbol}${h.valueUsd != null ? ` (~$${formatNumber(h.valueUsd, locale)})` : ''}`).join('، ');
      lines.push(fa
        ? `ارزش پرتفوی شما ≈ $${formatNumber(s.totalValueUsd, locale)}${top ? ` — بزرگ‌ترین دارایی‌ها: ${top}` : ''}${s.partial ? ' (خوانش ناقص)' : ''}.`
        : `Portfolio value ≈ $${formatNumber(s.totalValueUsd, locale)}${top ? ` — top: ${top}` : ''}${s.partial ? ' (partial read)' : ''}.`);
    } else if (row.facetId === 'market_prices' && Array.isArray(s.rows) && s.rows.length) {
      const parts = s.rows.slice(0, 3).map((c) => `${c.symbol} $${formatNumber(c.priceUsd, locale)}${c.change24hPct != null ? ` (${c.change24hPct >= 0 ? '+' : ''}${formatNumber(c.change24hPct, locale)}%)` : ''}`);
      lines.push((fa ? 'قیمت‌ها: ' : 'Prices: ') + parts.join(' · '));
    } else if (row.facetId === 'asset_regime' && s.asset) {
      lines.push(fa
        ? `${s.asset}: روند ${s.momentum || 'نامشخص'}، نوسان ${s.volatility || 'نامشخص'}${s.change24hPct != null ? `، ۲۴ ساعت ${s.change24hPct >= 0 ? '+' : ''}${s.change24hPct}%` : ''}.`
        : `${s.asset}: momentum ${s.momentum || 'unknown'}, volatility ${s.volatility || 'unknown'}${s.change24hPct != null ? `, 24h ${s.change24hPct >= 0 ? '+' : ''}${s.change24hPct}%` : ''}.`);
    } else if (row.facetId === 'yield_rates' && Array.isArray(s.rows) && s.rows.length) {
      const best = s.rows.filter((r) => r.apy != null).sort((a, b) => b.apy - a.apy)[0];
      if (best) lines.push(fa ? `بالاترین بازده خوانده‌شده: ${best.symbol || best.venue} در ${best.chain || '—'} با ${best.apy}٪.` : `Best rate read: ${best.symbol || best.venue} on ${best.chain || '—'} at ${best.apy}%.`);
    } else if (row.facetId === 'news_flow' && Array.isArray(s.items) && s.items.length) {
      lines.push((fa ? 'تیترهای تازه: ' : 'Latest headlines: ') + s.items.slice(0, 3).map((i) => clip(i.title, 120)).join(' · '));
    } else if (row.facetId === 'knowledge' && Array.isArray(s.passages) && s.passages.length) {
      for (const p of s.passages.slice(0, 2)) {
        lines.push(p.text);
        if (p.cite) citations.push(p.cite);
      }
    } else if (row.facetId === 'smart_money' && Array.isArray(s.consensus) && s.consensus.length) {
      lines.push((fa ? 'اسمارت مانی (تأییدشده): ' : 'Smart money (verified): ')
        + s.consensus.slice(0, 3).map((c) => `${c.asset} ${c.side}`).join(' · '));
    } else if (row.facetId === 'macro_state' && Array.isArray(s.rows) && s.rows.length) {
      lines.push((fa ? 'کلان: ' : 'Macro: ') + s.rows.slice(0, 4).map((r) => `${r.symbol}${r.value != null ? ` ${r.value}` : ''}${r.changePct != null ? ` (${r.changePct >= 0 ? '+' : ''}${r.changePct}%)` : ''}`).join(' · '));
    }
  }

  const missing = (plan?.facets?.requests || [])
    .filter((r) => !observed.some((o) => o.facetId === r.facetId))
    .map((r) => r.facetId);
  if (!lines.length) return null;
  if (missing.length) {
    lines.push(fa
      ? `⚠️ خوانده نشد: ${missing.join('، ')} — بدون آن‌ها پاسخ کامل نیست.`
      : `⚠️ Not read: ${missing.join(', ')} — the answer is incomplete without it.`);
  }
  if (citations.length) lines.push(fa ? `منبع: ${[...new Set(citations)].join('، ')}` : `Sources: ${[...new Set(citations)].join(', ')}`);
  return lines.join('\n').slice(0, 1600);
}

/* -------------------------------------------------------------------------- */
/*  Default dependencies (real FBT modules, resolved lazily)                    */
/* -------------------------------------------------------------------------- */

async function defaultDeps() {
  const gateway = await import('./aiGateway.js');
  const collaboration = await import('./aiCollaboration.js');
  const learning = await import('./aiLearning.js');
  return {
    planEvidence: buildEvidencePlan,
    gather: executeToolRequests,
    rag: getOrchestratorRag(),
    ledger: getOrchestratorLedger(),
    judge: defaultJudge,
    render: renderJudgment,
    recordDecision: learning.recordDecision,
    providers: () => gateway.getActiveProviderIds().filter((p) => p !== 'internal'),
    preferredFor: (task) => gateway.getPreferredProvidersForTask(task, { configuredOnly: true }).filter((p) => p !== 'internal'),
    isHealthy: collaboration.isProviderHealthy,
    callModel: (provider, params) => gateway.executeProviderChat(provider, params),
    now: Date.now
  };
}

/* -------------------------------------------------------------------------- */
/*  The graph                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build (or reuse) the orchestrator graph.
 *
 * deps (all optional, injected by probes):
 *   planEvidence, gather, rag, ledger, judge, render, callModel, providers,
 *   preferredFor, isHealthy, recordDecision, now
 */
export function createOrchestrator({ deps = {}, deadlineMs = DEFAULT_DEADLINE_MS } = {}) {
  let resolved = null;
  const D = async () => {
    if (!resolved) resolved = { ...(await defaultDeps()), ...deps };
    return resolved;
  };

  const graph = createGraph({
    id: 'fbt.ai-orchestrator.v1',
    version: ORCHESTRATOR_VERSION,
    entry: 'plan',
    nodes: {
      /* ── 1. plan: what data, which tools, how many models ─────────────── */
      async plan({ state, extra }) {
        const d = await D();
        const turn = extra || {};
        const intentType = state.intentType || turn.intentType || 'GENERAL';
        const basePlan = d.planEvidence({
          message: state.message,
          intentType,
          entities: state.entities || {},
          context: turn.context || {},
          locale: turn.locale || 'fa',
          deadlineMs: state.deadlineMs,
          availableProviders: (() => {
            try { return (d.providers?.() || []).length; } catch { return null; }
          })()
        });

        /* Learning: re-order tools by what actually produced evidence before,
           and let a history of conflicts earn an extra seat. Bounded by law:
           priors can never raise confidence, and never remove the judge. */
        let priors = null;
        let seatNote = null;
        try {
          const owner = turn.owner || null;
          const ranked = await d.ledger.rankTools(basePlan.facets.requests.map((r) => r.tool), { owner, intentType });
          if (ranked.reordered) {
            const order = new Map(ranked.tools.map((t, i) => [t, i]));
            basePlan.facets.requests.sort((a, b) => (order.get(a.tool) ?? 99) - (order.get(b.tool) ?? 99));
            basePlan.reasons = [...basePlan.reasons, 'PRIORS:TOOL_ORDER'];
          }
          priors = ranked.priors;
          const rec = await d.ledger.seatRecommendation({
            owner, intentType, stakes: basePlan.stakes.level, defaultSeats: basePlan.analysis.seats
          });
          if (rec.seats !== basePlan.analysis.seats && basePlan.analysis.seats > 0) {
            seatNote = rec.reason;
            basePlan.analysis.seats = rec.seats;
            basePlan.analysis.roles = ['analyst', 'risk-reviewer', 'macro-reviewer'].slice(0, rec.seats);
            basePlan.reasons = [...basePlan.reasons, `PRIORS:SEATS:${rec.reason}`];
          }
        } catch { /* priors are additive; their failure never blocks a plan */ }

        return {
          patch: { basePlan, priors, seatNote },
          note: describeEvidencePlan(basePlan, turn.locale || 'fa')
        };
      },

      /* ── 2. gather: only the planned tools, inside the deadline ───────── */
      async gather({ state, extra }) {
        const d = await D();
        const turn = extra || {};
        const plan = state.basePlan;
        const gatherBudget = Math.max(800, Math.min(
          (plan.budgetMs ?? state.deadlineMs) * GATHER_SHARE,
          state.deadlineMs - 1500
        ));
        const toolRun = await d.gather({
          requests: plan.facets.requests,
          turnCtx: {
            owner: turn.owner || null,
            clientData: turn.clientData || null,
            locale: turn.locale || 'fa',
            question: state.message,
            token: state.entities?.token || null,
            /* Scopes the broker's loop guard to this turn: the same read four
               times inside one turn is a bug, four times in a day is a user. */
            turnId: state.turnId || null
          },
          deadlineMs: gatherBudget,
          deps: { rag: d.rag, ...(d.toolDeps || {}) }
        });

        let passages = [];
        if (plan.facets.requests.some((r) => r.tool === 'fbt_rag_search') || !toolRun.rows.some((r) => r.status === 'observed')) {
          try {
            const recall = await d.rag.recall({ query: state.message, owner: turn.owner || null, locale: turn.locale || 'fa', limit: 4 });
            passages = recall?.passages || [];
          } catch { passages = []; }
        } else {
          const kb = toolRun.rows.find((r) => r.facetId === 'knowledge' && r.status === 'observed');
          passages = (kb?.summary?.passages || []).map((p) => ({ cite: p.cite, title: p.title, text: p.text, score: p.score, kind: 'knowledge' }));
        }

        return {
          patch: { evidence: toolRun.rows, toolRun: { ...toolRun, rows: undefined }, passages },
          note: `${toolRun.observed} observed / ${toolRun.executed} called`
        };
      },

      /* ── 3. analyze: N seats, decided above, not by this node ─────────── */
      async analyze({ state, extra }) {
        const d = await D();
        const turn = extra || {};
        const plan = state.basePlan;
        const seats = Math.max(0, Number(plan.analysis.seats) || 0);
        const roles = plan.analysis.roles?.length ? plan.analysis.roles : ['analyst'];

        if (seats === 0) return { patch: { analyses: [], seatErrors: ['NO_SEATS_PLANNED'] }, note: 'no model seats' };

        let fleet = [];
        try {
          const configured = d.providers?.() || [];
          const preferred = d.preferredFor?.(taskTypeFor(plan)) || [];
          fleet = [...preferred, ...configured.filter((p) => !preferred.includes(p))].slice(0, seats + 2);
          fleet = fleet.filter((p) => { try { return d.isHealthy ? d.isHealthy(p) !== false : true; } catch { return true; } });
          if (!fleet.length) fleet = configured.slice(0, seats + 2);
        } catch { fleet = []; }

        /* Each seat takes a different provider so the panel is genuinely
           multi-model (seats beyond the fleet wrap and report honestly). */
        const seatProviders = [];
        for (let i = 0; i < seats; i += 1) {
          if (!fleet.length) break;
          seatProviders.push(fleet[i % fleet.length]);
        }

        const evidenceBlock = buildEvidenceBlock(state.evidence);
        const ragBlock = (state.passages || []).slice(0, 4)
          .map((p) => `- [${p.cite}] ${clip(p.title, 90)}: ${clip(p.text, 320)}`).join('\n');

        /* Every seat is raced against the SHARED turn deadline, not just
           against the node timeout: one hanging provider must cost its own
           seat, never the whole panel. */
        const seatTimeoutMs = Math.max(
          1_200,
          Math.min(SEAT_TIMEOUT_MS, (state.deadlineMs || 14_000) - (Date.now() - state.startedAt) - 900)
        );
        const results = await Promise.all(seatProviders.map(async (provider, i) => {
          const role = roles[i % roles.length];
          const { system, user } = buildSeatPrompt({
            question: state.message, role, locale: turn.locale || 'fa', evidenceBlock, ragBlock
          });
          const started = Date.now();
          try {
            const out = await raceTimeout(
              d.callModel(provider, { system, user, json: true, maxTokens: SEAT_MAX_TOKENS, temperature: 0.25 }),
              seatTimeoutMs,
              `${provider} seat`
            );
            const text = out?.text ?? out?.answer ?? '';
            const seat = normalizeSeat({ provider, model: out?.model || null, raw: text, latencyMs: Date.now() - started });
            if (seat.ok && !seat.claims) seat.claims = undefined;
            return seat;
          } catch (err) {
            return { provider, ok: false, error: clip(err?.message, 140), reasonCode: err?.reasonCode || null, latencyMs: Date.now() - started };
          }
        }));

        /* Claims are extracted here when a seat did not return them, so the
           judge always has something to weigh. */
        const { extractClaims } = await import('../src/lib/intent-ai/orchestrator/judge.js');
        const analyses = results.map((a) => (a.ok && !a.claims ? { ...a, claims: extractClaims(a.answer) } : a));

        return {
          patch: {
            analyses,
            seatErrors: results.filter((r) => !r.ok).map((r) => `${r.provider}:${r.error}`)
          },
          note: `${analyses.filter((a) => a.ok).length}/${seatProviders.length} seats answered`
        };
      },

      /* ── 4. judge: evidence first, models last ─────────────────────────── */
      async judge({ state }) {
        const d = await D();
        const judgment = d.judge({
          question: state.message,
          plan: state.basePlan,
          analyses: state.analyses,
          evidence: state.evidence,
          intentType: state.intentType,
          locale: state.locale
        });
        return { patch: { judgment }, note: `${judgment.decision} @ ${judgment.confidence}` };
      },

      /* ── 5. decide: an answer, a clarification, or an honest abstention ── */
      async decide({ state, extra }) {
        const d = await D();
        const turn = extra || {};
        const locale = turn.locale || 'fa';
        const j = state.judgment;
        let answer = null;
        let source = null;

        if (j.decision === DECISIONS.ANSWER) {
          answer = d.render(j, { locale });
          source = 'panel+judge';
        } else if (j.decision === DECISIONS.CLARIFY) {
          answer = d.render(j, { locale });
          source = 'clarify';
        } else {
          /* ABSTAIN: never a model sentence as if it were a decision. Use real
             tool reads when they exist; otherwise let the caller keep whatever
             it had. */
          const evidenceOnly = composeEvidenceOnlyAnswer({ evidence: state.evidence, plan: state.basePlan, locale });
          if (evidenceOnly) { answer = evidenceOnly; source = 'evidence-only'; }
        }

        /* An evidence-only answer also fills a judge that found no usable seat. */
        if (!answer && (state.analyses || []).every((a) => !a.ok)) {
          const evidenceOnly = composeEvidenceOnlyAnswer({ evidence: state.evidence, plan: state.basePlan, locale });
          if (evidenceOnly) { answer = evidenceOnly; source = 'evidence-only'; }
        }

        const usable = Boolean(answer && answer.trim().length >= MIN_ANSWER_CHARS);
        return { patch: { answer, answerSource: source, usable }, note: source || 'no answer' };
      },

      /* ── 6. learn: ledger + memory + the asset decision log ───────────── */
      async learn({ state, extra }) {
        const d = await D();
        const turn = extra || {};
        const owner = turn.owner || null;
        const j = state.judgment || null;
        const rows = state.evidence || [];
        const out = { ledgerWritten: false, remembered: false, decisionLogged: false };

        try {
          await d.ledger.record({
            owner: owner || 'anon',
            question: state.message,
            intentType: state.intentType,
            stakes: state.basePlan?.stakes?.level || 'MEDIUM',
            decision: j?.decision || 'ABSTAIN',
            confidence: j?.confidence ?? null,
            band: j?.band || null,
            seats: (state.analyses || []).filter((a) => a.ok).length,
            agreement: j?.agreement?.agreement ?? null,
            conflicts: j?.conflicts || [],
            missing: j?.evidence?.missing || [],
            tools: rows.map((r) => ({ tool: r.tool, facet: r.facetId, status: r.status, durationMs: r.durationMs })),
            providers: (j?.provenance?.providers || []),
            latencyMs: state.turnLatencyMs ?? null,
            degraded: state.toolRun?.degraded > 0
          });
          out.ledgerWritten = true;
        } catch { /* never block an answer on learning */ }

        if (owner && state.usable) {
          try {
            const remember = await d.rag.remember({
              owner,
              question: state.message,
              answer: state.answer,
              intentType: state.intentType,
              lang: String(turn.locale || 'fa').slice(0, 2),
              sources: (state.passages || []).map((p) => ({ cite: p.cite })),
              payloadExtra: { decision: j?.decision || null, confidence: j?.confidence ?? null }
            });
            out.remembered = remember?.ok === true;
          } catch { /* additive */ }
        }

        /* The asset decision log (server/aiLearning.js) resolves later against
           a REAL price — this is the record it needs, not a second store. */
        if (owner && state.entities?.token && j?.decision === DECISIONS.ANSWER) {
          try {
            const priceRow = rows.find((r) => r.facetId === 'market_prices' && r.status === 'observed');
            const price = priceRow?.summary?.rows?.find((c) => String(c.symbol).toUpperCase() === String(state.entities.token).toUpperCase())?.priceUsd
              ?? priceRow?.summary?.rows?.[0]?.priceUsd ?? null;
            if (price != null) {
              await d.recordDecision({
                owner,
                asset: String(state.entities.token).toUpperCase(),
                price,
                thesis: clip(state.answer, 400),
                confidence: j.confidence,
                sources: (state.verdict?.evidenceBacked || []),
                action: 'ANALYSIS'
              });
              out.decisionLogged = true;
            }
          } catch { /* additive */ }
        }

        return { patch: { learning: out } };
      }
    },
    edges: {
      plan: 'gather',
      gather: 'analyze',
      analyze: 'judge',
      judge: 'decide',
      decide: 'learn',
      learn: null
    },
    policies: {
      maxSteps: 8,
      deadlineMs: Math.max(2_000, Number(deadlineMs) || DEFAULT_DEADLINE_MS),
      nodeTimeoutMs: Math.max(1_500, Math.round((Number(deadlineMs) || DEFAULT_DEADLINE_MS) * 0.75)),
      onError: 'skip',
      retries: 0
    }
  });

  return {
    schema: ORCHESTRATOR_SCHEMA,
    version: ORCHESTRATOR_VERSION,
    graph,
    describe: () => graph.describe(),

    /**
     * Run one orchestrated turn.
     *
     * @param {object} turn
     * @param {string} turn.message
     * @param {object} [turn.context]        state this turn already holds
     * @param {object} [turn.entities]
     * @param {string} [turn.intentType]
     * @param {string} [turn.owner]
     * @param {object} [turn.clientData]     wallet/portfolio snapshot the client supplied
     * @param {string} [turn.locale]
     * @param {number} [turn.deadlineMs]
     */
    async run(turn = {}) {
      const d = await D();
      const startedAt = d.now();
      const budgetMs = Math.max(1_500, Math.min(30_000, Number(turn.deadlineMs || deadlineMs)));
      const message = String(turn.message || '').slice(0, 1200);
      const turnId = turn.turnId || `turn:${turn.owner || 'anon'}:${d.now().toString(36)}`;
      const out = await graph.run({
        state: {
          turnId,
          startedAt: startedAt,
          message,
          intentType: String(turn.intentType || 'GENERAL').toUpperCase(),
          entities: turn.entities || {},
          locale: String(turn.locale || 'fa').slice(0, 5),
          deadlineMs: budgetMs
        },
        budget: { deadlineMs: budgetMs, maxSteps: 8, nodeTimeoutMs: Math.round(budgetMs * 0.8) },
        extra: {
          ...turn,
          turnId,
          context: turn.context || {},
          clientData: turn.clientData || null,
          owner: turn.owner || null,
          locale: String(turn.locale || 'fa').slice(0, 5)
        }
      });
      /* `turnLatencyMs` is set after the graph so the learn node can record it
         on the NEXT run as a prior; the decision itself is never delayed. */
      const latencyMs = d.now() - startedAt;
      const j = out.state.judgment || null;
      return {
        ok: out.ok && Boolean(out.state.usable),
        turnId,
        schema: ORCHESTRATOR_SCHEMA,
        version: ORCHESTRATOR_VERSION,
        status: out.status,
        answer: out.state.usable ? out.state.answer : null,
        answerSource: out.state.answerSource || null,
        decision: j?.decision || null,
        confidence: j?.confidence ?? null,
        band: j?.band || null,
        dissent: j?.dissent || [],
        conflicts: j?.conflicts || [],
        limits: j?.limits || [],
        whatWouldChangeMyMind: j?.whatWouldChangeMyMind || [],
        judgment: j,
        plan: out.state.basePlan || null,
        evidence: (out.state.evidence || []).map((r) => ({ facetId: r.facetId, tool: r.tool, status: r.status, error: r.error || null, durationMs: r.durationMs || null })),
        passages: (out.state.passages || []).map((p) => ({ cite: p.cite, title: p.title, score: p.score })),
        seats: (out.state.analyses || []).map((a) => ({ provider: a.provider, ok: a.ok, error: a.error || null, latencyMs: a.latencyMs })),
        seatErrors: out.state.seatErrors || [],
        learning: out.state.learning || null,
        trace: out.trace.map((r) => ({ node: r.node, ok: r.ok, durationMs: r.durationMs, note: r.note || null, next: r.next || null, why: r.why || null })),
        errors: out.errors,
        latencyMs,
        permissions: { canExecute: false, canSign: false, canMoveFunds: false },
        redact: REDACT_SCHEMA,
        at: d.now()
      };
    },

    /** Cheap, model-free plan preview (used by the API and by ops). */
    async planOnly(turn = {}) {
      const d = await D();
      return d.planEvidence({
        message: String(turn.message || '').slice(0, 1200),
        intentType: String(turn.intentType || 'GENERAL').toUpperCase(),
        entities: turn.entities || {},
        context: turn.context || {},
        locale: String(turn.locale || 'fa').slice(0, 5),
        availableProviders: (() => { try { return (d.providers?.() || []).length; } catch { return null; } })()
      });
    },

    /** Judge a set of analyses someone already has (pure, no model calls). */
    judgeOnly(input = {}) {
      return defaultJudge({ ...input, plan: input.plan || buildEvidencePlan({ message: input.question || '' }) });
    },

    async health() {
      const d = await D();
      let rag = null;
      let ledger = null;
      try { rag = await d.rag.stats(); } catch { rag = { ok: false }; }
      try { ledger = await d.ledger.stats(); } catch { ledger = { ok: false }; }
      let providers = [];
      try { providers = d.providers?.() || []; } catch { providers = []; }
      return {
        ok: true,
        schema: ORCHESTRATOR_SCHEMA,
        version: ORCHESTRATOR_VERSION,
        enabled: orchestratorEnabled(),
        deadlineMs: Number(deadlineMs) || DEFAULT_DEADLINE_MS,
        providers,
        tools: listTools().map((t) => ({ name: t.name, facet: t.facet, cost: t.cost, sideEffects: t.sideEffects })),
        rag,
        ledger,
        laws: { readOnly: true, canExecute: false, numbersFromToolsOnly: true, judgeEvidenceFirst: true },
        at: Date.now()
      };
    }
  };
}

/** Evidence rows → the compact block a model is allowed to see. */
export function buildEvidenceBlock(evidence = []) {
  const rows = (evidence || []).filter((r) => r.status === 'observed' || r.status === 'degraded');
  if (!rows.length) {
    const unavailable = (evidence || []).filter((r) => r.status === 'unavailable').map((r) => `${r.facetId} (${r.error || 'unavailable'})`);
    return unavailable.length ? `(no tool read succeeded: ${unavailable.join('; ')})` : '';
  }
  return rows.map((r) => `- ${r.facetId} [${r.status}] via ${r.tool}: ${clip(JSON.stringify(r.summary ?? {}), 700)}`).join('\n');
}

function taskTypeFor(plan = {}) {
  const facets = plan?.facets?.requests?.map((r) => r.facetId) || [];
  if (facets.includes('portfolio_state')) return 'reasoning';
  if (facets.includes('news_flow') || facets.includes('macro_state')) return 'market';
  if (facets.includes('yield_rates')) return 'research';
  return 'general';
}

/** Feature flag: the orchestrator is additive and can be switched off entirely. */
export function orchestratorEnabled() {
  const v = String(process.env.AI_ORCHESTRATOR ?? '').trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false' || v === 'disabled') return false;
  return true;
}

/** Secret guard used before a prompt is built (server-side entry point). */
export function promptSafe(text) {
  return containsSensitiveKeyOrPhrase(text) ? redactSecrets(String(text)) : String(text);
}

export { FACETS, listTools };
export default createOrchestrator;
