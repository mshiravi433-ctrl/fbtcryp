/**
 * FBT CENTRAL INTELLIGENCE OS — The brain (spec §2, §5, §9, §13, §18, §19, §44).
 * ---------------------------------------------------------------------------
 * §44's chain is the code below, in that order, and the order is the product:
 *
 *   UNDERSTAND → RESOLVE CONTEXT → READ REAL STATE → DISCOVER CAPABILITIES →
 *   SELECT TOOLS → BUILD PLAN → CHECK POLICY → QUOTE/SIMULATE → ASK
 *   CONFIRMATION → EXECUTE → VERIFY → UPDATE STATE → PUBLISH EVENTS →
 *   UPDATE RELATED MODULES → RESPOND
 *
 * Three structural decisions, each answering a specific reported failure:
 *
 * 1. "Context is lost / it doesn't know which page I'm on." The context is
 *    rebuilt EVERY turn from (a) the client's page claim, (b) conversation
 *    memory, (c) the central state, and the intent object carries stage history,
 *    so a turn is a record, not a vibe. A follow-up like «انجامش بده» is
 *    resolved against memory BEFORE anything is asked, and asking is only allowed
 *    when `context.missingInformation` is non-empty.
 *
 * 2. "It only explains, it never does anything." Reading real state is a
 *    mandatory stage: the plan's steps are executed by the module registry, so a
 *    portfolio question ends with the wallet, portfolio, market and risk reads
 *    that made the numbers, not with a description of how one would compute them.
 *
 * 3. "When an API is broken it doesn't take an alternative path, and it repeats
 *    the same errors." Each read goes through `guarded()` (retry → failover →
 *    serve-stale-with-flag) and the error ledger, and every failed section is
 *    reported as UNAVAILABLE with its reason — which the reply composer turns
 *    into an explicit limitation line instead of a silent gap.
 *
 * WHAT THE BRAIN DELIBERATELY CANNOT DO
 * It holds no key and signs nothing. `execute` on a value-bearing action produces
 * an `AWAITING_SIGNATURE` handoff owned by the user's wallet. `verify` is the
 * step that turns "the wallet said it broadcast" into "the chain says it
 * happened", and only then does the state cascade run (§16).
 */
import {
  ANALYSIS_MINIMUM, CAPABILITY, CI_SCHEMA, MODULE_CONTRACT_FIELDS, PERMISSION, SAFE_STOP_CODES, round, usableNumber
} from '../../src/lib/central/schema.js';
import { createSystemState, writeSection, freshness, diffSections, stateDigest } from '../../src/lib/central/state.js';
import { hashString } from '../../src/lib/central/schema.js';
import { normalizeText } from '../../src/lib/central/context.js';
import { buildCentralContext, emptyMemory, applyTurn, resolvePage, FOLLOWUP_KINDS } from '../../src/lib/central/context.js';
import { classify, createIntent, transition } from '../../src/lib/central/intent.js';
import { buildPlan, validatePlan, templateFor } from '../../src/lib/central/planner.js';
import { synthesizeInternalAnswer } from '../aiInternalReasoner.js';
/*
 * The brain asks the SHARED gate, not its own copy of the rule. Two copies of
 * one rule is one copy too many: the brain's inline version drifted from the
 * gate within a day — the gate refused «ریسک X چیست؟» while the brain
 * answered it from a glossary. One rule, one place to be wrong.
 */
import { evaluateLocalFirst } from '../aiLocalFirstGate.js';
/*
 * The MODEL FALLBACK (step 5.2). The corpus answers what the corpus holds; the
 * chat path, one endpoint away, answers the rest with a model. The central
 * brain had NO provider path at all — so for a judgement, a scenario, or a
 * question the 36-rule registry does not cover, it refused, while the chat
 * beside it answered.
 *
 * Same gateway as the chat path, same turn budget, same free ladder. Not a
 * second, cheaper, private pipeline: one pipeline, so there is one place
 * where the quota is spent and one place where a failure can be observed.
 */
import {
  executeProviderChat,
  getPreferredProvidersForTask,
  isProviderConfigured,
  beginAiTurnBudget
} from '../aiGateway.js';
import { searchKnowledge } from '../../src/lib/intent-ai/os/knowledgeCenter.js';
import { evaluatePolicy, planDigest } from '../../src/lib/central/policy.js';
import { assessRisk } from '../../src/lib/central/risk.js';
import { buildRecommendation, possibleActionsFrom, fmtNum, fmtUsd } from '../../src/lib/central/recommend.js';
import { composeResponse } from '../../src/lib/central/human.js';
import { classifyError, createErrorLedger, humanizeError, nextRecovery } from '../../src/lib/central/errors.js';
import {
  analyzeConcentration, analyzeExposure, assessLendingSafety, assetIntelligence,
  computeBorrowCapacity, goalFeasibility, readGoalInputs, scanOpportunities, simulateShock
} from '../../src/lib/central/analysis.js';
import { buildCapabilityMatrix } from '../../src/lib/central/registry.js';
import { ingestTurn, conversationNeedsInput, readLastReplan } from './sessionBridge.js';
import { createModules } from './modules.js';
import { createActionEngine } from './actions.js';
import { healthSnapshot } from './sources.js';

export const BRAIN_SCHEMA = 'fbt.central-brain.v1';
const MEMORY_TTL_MS = 60 * 60_000;
const MAX_MEMORY_OWNERS = 400;
/** A single turn may not fan out to the whole registry — that is how a chat
 *  message becomes 30 upstream calls and a rate-limit ban. */
const MAX_STEPS_PER_TURN = 10;
const REFRESH_CONCURRENCY = 4;

export function createCentralBrain({ stateStore, events = null, io = {}, log = () => {}, llm = null } = {}) {
  const memories = new Map();
  const errorLedger = createErrorLedger();
  const turns = { total: 0, byIntent: {}, blocked: 0, safeStops: 0, recoveries: 0, replays: 0, confirmations: 0 };
  /* §36's `GET /api/intent/:id` needs the record to outlive the response, and
     §35's trail (intent → plan → decision → policy → execution → verification →
     result) is exactly what is stored here. Bounded per owner, and it stores the
     public intent only — no raw message beyond the intent's own capped
     `userMessage`, no numbers that a later refresh would contradict. */
  const intentLog = new Map();
  const MAX_INTENT_LOG = 24;
  function recordIntent(owner, entry) {
    const key = String(owner || 'anon').slice(0, 80);
    if (!intentLog.has(key)) intentLog.set(key, []);
    const rows = intentLog.get(key);
    rows.unshift(entry);
    if (rows.length > MAX_INTENT_LOG) rows.length = MAX_INTENT_LOG;
    return entry;
  }

  /* The registry is per-owner because adapters close over `readState(owner)` and
     the owner's alert/goal scope. Rebuilding it is cheap; sharing it is not. */
  const buildRegistry = (owner) => {
    const list = createModules({
      owner,
      readState: (key) => stateStore.peek(owner).sections[key]?.data ?? null,
      state: () => stateStore.peek(owner),
      capabilities: () => ownerCapabilities(owner),
      recentEvents: () => events?.recent?.(owner, 20) || [],
      io
    });
    const map = {};
    for (const m of list) map[m.id] = m;
    /* The action engine is per-owner too: its ledger is "what has THIS user been
       asked to approve", and sharing it between owners would be a privacy and a
       safety bug at once. */
    const actions = createActionEngine({ modules: map, events, log });
    return { list, map, actions };
  };

  const ownerCache = new Map();
  function registryFor(owner) {
    const key = String(owner || 'anon').slice(0, 80);
    if (!ownerCache.has(key)) {
      if (ownerCache.size > MAX_MEMORY_OWNERS) ownerCache.delete(ownerCache.keys().next().value);
      ownerCache.set(key, buildRegistry(key));
    }
    return ownerCache.get(key);
  }

  function memoryFor(owner) {
    const key = `${owner}`;
    const hit = memories.get(key);
    if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return hit.memory;
    return emptyMemory();
  }
  function remember(owner, memory) {
    const key = `${owner}`;
    if (memories.size > MAX_MEMORY_OWNERS) memories.delete(memories.keys().next().value);
    memories.set(key, { memory, at: Date.now() });
  }

  function ownerCapabilities(owner) {
    const { list } = registryFor(owner);
    return buildCapabilityMatrix(list, cachedHealth).capabilities;
  }

  /* Health is probed, not assumed. Probes run on demand and are memoised briefly
     so one turn does not hit the same endpoint six times. */
  const cachedHealth = {};
  async function probeHealth(registry, { force = false } = {}) {
    const now = Date.now();
    await Promise.all(registry.list.map(async (m) => {
      const prev = cachedHealth[m.id];
      if (!force && prev && now - prev.at < 20_000) return;
      const out = await m.healthCheck({});
      cachedHealth[m.id] = { ...(out || {}), at: now };
    }));
    return cachedHealth;
  }

  const moduleForSection = {
    wallet: 'wallet', portfolio: 'portfolio', markets: 'crypto', lending: 'lending',
    borrowing: 'borrowing', farming: 'farming', liquidity: 'liquidity', futures: 'futures',
    dydx: 'dydx', signals: 'signals', news: 'news', goals: 'goals', alerts: 'alerts',
    transactions: 'transactions', events: 'events', risk: 'risk', profitPlan: 'profit-plan',
    globalIntel: 'global-intel', opportunityFit: 'opportunity-fit', macroGraph: 'macro-graph', goalScenarios: 'goal-scenarios', routeIntelligence: 'route-intelligence', whyDecision: 'why-decision',
    positions: 'lending', recentActions: 'transactions', pendingActions: 'transactions',
    errors: 'risk', eventsList: 'events'
  };

  /**
   * §16 + §39: refresh the sections this turn needs, concurrently, with each
   * failure classified and put through the recovery ladder once. A section that
   * still fails is written as UNAVAILABLE with the reason — never skipped, since a
   * missing section and an unreadable section produce different (honest) answers.
   */
  async function refreshSections(owner, sections, registry, { context = null } = {}) {
    const state = stateStore.peek(owner);
    const queue = Array.from(new Set(sections)).filter((key) => STATE_SECTION_EXISTS[key]);
    const results = {};
    const runOne = async (key) => {
      const module = registry.map[moduleForSection[key]];
      if (!module || typeof module.read !== 'function') {
        results[key] = { status: 'UNAVAILABLE', reason: 'NO_READER_FOR_SECTION' };
        return;
      }
      const wallet = state.sections.wallet?.data;
      const out = await module.read({ symbols: holdingsOf(wallet), now: Date.now() }, { owner, context, walletAddress: wallet?.addresses?.evm?.[0] || null });
      /* Anything that is not a usable answer is a failure: `UNAVAILABLE`, `ERROR`,
         `NOT_APPLICABLE`, a missing status. Listing only UNAVAILABLE once let an
         errored read be written into the shared state as if it had succeeded. */
      if (out.status !== 'OK' && out.status !== 'PARTIAL') {
        /* The code travels with the message: a module envelope that says
           `PROVIDER_DOWN` in `code` and leaves `reason` blank would otherwise be
           classified UNCLASSIFIED, and an unclassified error has no recovery ladder
           — so the ladder the reply promises would not exist. */
        const classified = classifyError(new Error([out.code, out.reason, out.detail, 'SOURCE_UNAVAILABLE'].filter(Boolean).join(' ')), { module: module.id });
        const recovery = nextRecovery(classified, { attempts: 0, providers: module.definition?.fallback || [] });
        const retried = recovery.done ? null : await module.read({ symbols: holdingsOf(wallet) }, { owner, retry: recovery.actions?.[0]?.type });
        if (retried && retried.status !== 'UNAVAILABLE') {
          writeIntoState(owner, key, retried, module);
          results[key] = retried;
          turns.recoveries += 1;
          return;
        }
        stateStore.fail(owner, key, out.reason || classified.code);
        /* The recovery ladder's decision travels with the error: §19 ends in
           VERIFY, and an audit that cannot see which rung was attempted cannot
           tell a graceful degradation from a silent give-up. */
        /* The ladder the module ALREADY ran beats one re-derived here: re-deciding
           the recovery in a second place is how the reply promises a failover that
           never happened. */
        const ledger = errorLedger.report({
          ...classified, module: module.id,
          recovery: out.recovery?.actions?.length
            ? { actions: out.recovery.actions, done: false }
            : recovery
        });
        results[key] = { status: 'UNAVAILABLE', reason: out.reason, recovery: recovery, showToUser: ledger.show, repeatCount: ledger.count };
        return;
      }
      writeIntoState(owner, key, out, module);
      results[key] = out;
    };
    /* Bounded concurrency: the point of the brain is fewer upstream calls, not more. */
    for (let i = 0; i < queue.length; i += REFRESH_CONCURRENCY) {
      await Promise.all(queue.slice(i, i + REFRESH_CONCURRENCY).map(runOne));
    }
    return results;
  }

  function writeIntoState(owner, key, out, module) {
    const before = stateStore.peek(owner);
    const freshnessBefore = freshness(before, key);
    stateStore.write(owner, key, {
      data: out.data ?? null,
      source: out.source || module.id,
      status: out.status === 'PARTIAL' ? 'PARTIAL' : 'OK',
      reason: out.reason || null,
      now: Date.now()
    });
    /* Deriving events from the diff (rather than trusting a module to announce
       its own change) is what makes "no module shows stale data" testable. */
    const after = stateStore.peek(owner);
    if (freshnessBefore.status !== 'MISSING') {
      const derived = diffSections(before, after).filter((e) => keyTouchesEvent(key, e));
      for (const event of derived) events?.publish({ ...event, owner, source: module.id });
    }
  }

  const holdingsOf = (wallet) => Array.from(new Set((wallet?.balances || []).map((b) => String(b.symbol || '').toUpperCase()).filter(Boolean))).slice(0, 10);
  /* Section ids are validated against the schema at module scope (see
     STATE_SECTION_EXISTS below), not by probing a live store, which would have
     created a phantom owner for every server process. */
  const keyTouchesEvent = (key, event) => {
    const map = { BALANCE_CHANGED: 'wallet', PRICE_CHANGED: 'markets', POSITION_CHANGED: 'portfolio', RISK_CHANGED: 'risk' };
    return !map[event.type] || map[event.type] === key;
  };

  /* ── the pipeline ─────────────────────────────────────────────────────── */
  async function handle({
    owner, message = '', page = null, confirm = false, actionId = null, planDigestSent = null,
    requestId = null, executionId = null, txHash = null, chainId = null, locale = 'en',
    hints = null, suggestions = null
  } = {}) {
    turns.total += 1;
    const registry = registryFor(owner);
    const startedAt = Date.now();
    await probeHealth(registry);
    const capabilities = buildCapabilityMatrix(registry.list, cachedHealth);

    await stateStore.get(owner);
    /* §7: the page claim is state, so a turn started from the server (Telegram,
       cron) has the last page the browser reported rather than none. */
    if (page) {
      stateStore.write(owner, 'activePage', { data: resolvePage(page), source: 'client-context', status: 'OK', now: Date.now() });
    }
    const pageClaim = stateStore.peek(owner).sections.activePage.data || resolvePage({});

    let state = stateStore.peek(owner);
    let memory = memoryFor(owner);

    /* 1–2. UNDERSTAND */
    let intent = createIntent({
      message,
      classification: { type: 'UNSUPPORTED', confidence: 0, definition: { modules: [], permission: PERMISSION.READ }, entities: {} },
      context: { page: pageClaim }, requestId, sessionId: null, owner, locale, now: startedAt
    });
    state = writeSection(state, 'session', { data: { memory: compactMemory(memory), at: startedAt }, source: 'client-context', status: 'OK', now: startedAt }).state;
    await stateStore.replace(owner, state);

    /* 1.5 §34 — ANTI-DUPLICATE, before anything is read or proposed. A client that
       retries a POST (flaky network, double tap, a re-mounted chat) must not get a
       second action card, a second quote, or a second spend of provider quota, so
       the request key is claimed here and a replay answers with the action that was
       already created. Ordering matters: doing this after the reads would let a
       duplicate still cost a wallet + market fetch. */
    const claimFingerprint = hashString(`${normalizeText(message)}|${JSON.stringify(hints || {})}|${pageClaim?.route || ''}`);
    const claimed = await registry.actions.claim({
      owner, requestId: requestId || null, executionId: executionId || null,
      intentId: null, fingerprint: claimFingerprint
    });
    if (claimed.ok === false) {
      turns.blocked += 1;
      intent = transition(intent, 'DUPLICATE', { reason: claimed.code });
      return {
        schema: BRAIN_SCHEMA, brain: CI_SCHEMA,
        intent: { ...publicIntent(intent), error: { code: claimed.code, detail: claimed.detail } },
        response: {
          mode: 'SAFE_STOP', locale, sections: [], planDigest: null, intentId: intent.intentId,
          text: claimed.detail || 'this request key was already used for a different payload',
          headline: null, actions: [], suggestions: [], duplicate: true, generic: false,
          requiresConfirmation: false, confirmationCard: null, executionBoundary: { serverSigns: false, holdsKeys: false, broadcasts: false, handsOffToWallet: true },
          confidence: null, ask: null, fingerprint: null, provenance: { toolSteps: 0, stateRevision: state.revision, policyVerdict: 'BLOCK', sources: [], evaluatedAt: Date.now() }
        },
        replay: true, code: claimed.code, replayedActionId: null
      };
    }
    if (claimed.replay) {
      turns.replays += 1;
      const prior = claimed.action || null;
      intent = transition(intent, 'DUPLICATE', { reason: prior ? 'request key already produced an action' : 'request key already seen' });
      const replayResponse = prior
        ? { summary: `این درخواست پیش‌تر ثبت شده است (${prior.actionType || prior.operation}) و در وضعیت ${prior.status} قرار دارد.`, actionId: prior.actionId, planDigest: prior.planDigest, expiresAt: prior.expiresAt }
        : { summary: 'این درخواست پیش‌تر ثبت شد و دوباره اجرا نمی‌شود.', actionId: null, planDigest: null, expiresAt: null };
      const text = `${replayResponse.summary}${prior?.requiresConfirmation && prior.status === 'AWAITING_CONFIRMATION' ? (locale === 'fa' ? ' همان کارت تأیید قبلی هنوز معتبر است؛ برای ادامه همان را تأیید یا لغو کنید.' : ' The earlier confirmation card is still valid; confirm or cancel that one.') : ''}`;
      return {
        schema: BRAIN_SCHEMA, brain: CI_SCHEMA,
        intent: publicIntent(intent), replay: true, replayScope: claimed.scope || 'instance',
        replayedActionId: replayResponse.actionId,
        context: { digest: state.digest || null, followUp: null, page: pageClaim },
        response: {
          mode: 'ANSWER', locale, sections: [{ id: 'result', label: locale === 'fa' ? 'نتیجه' : 'Result', value: text, source: 'anti-duplicate', tone: 'warn', attributable: true }],
          planDigest: replayResponse.planDigest, intentId: intent.intentId, text, headline: text,
          actions: [], suggestions: [], duplicate: true, generic: false, requiresConfirmation: false,
          confirmationCard: null, executionBoundary: { serverSigns: false, holdsKeys: false, broadcasts: false, handsOffToWallet: true },
          confidence: null, ask: null, fingerprint: null,
          provenance: { toolSteps: 0, stateRevision: state.revision, policyVerdict: 'REPLAY', sources: ['anti-duplicate'], evaluatedAt: Date.now() }
        },
        action: prior, stateDigest: await stateStore.snapshot(owner, { includeData: false }),
        meta: { at: Date.now(), tookMs: Date.now() - startedAt, sectionsRead: [], replayed: true, mode: 'ANSWER' }
      };
    }

    intent = transition(intent, 'UNDERSTANDING', { reason: 'lexical classification' });

    const context = buildCentralContext({
      message,
      memory,
      page: pageClaim,
      state,
      capabilities: capabilities.capabilities,
      health: cachedHealth,
      now: startedAt
    });
    const classification = classify(message, { context, state, suggestions: suggestions || (llm ? undefined : null) });
    intent = {
      ...intent,
      intentType: classification.type,
      confidence: classification.confidence,
      classification: { source: classification.source, evidence: classification.evidence, followUp: classification.followUp },
      entities: classification.entities,
      requiredModules: classification.definition?.modules || [],
      /* The legs survive onto the intent record so the planner builds ONE plan for
         the whole sentence, and so `GET /api/intent/:id` can show what was asked. */
      compound: classification.compound || null,
      executable: classification.executable
    };
    turns.byIntent[intent.intentType] = (turns.byIntent[intent.intentType] || 0) + 1;

    /*
     * ── THE CONVERSATION MACHINERY (path 16) ──────────────────────────────
     *
     * This is the session layer's half of the last dark engine.
     *
     * The conversation-state machine is NOT a capability and it is NOT a
     * module — it is the layer UNDER them. It knows which state the
     * conversation is in, which edges are legal, and which field the
     * current state still lacks. So it is read HERE, once per turn, and
     * its answer goes into two places:
     *
     *   · `context.missingInformation` — so the reply asks for the ONE
     *     field the conversation needs, instead of a questionnaire, and
     *     instead of pretending it had enough to answer;
     *   · the `session` section — so the conversation's own shape is
     *     durable and the NEXT turn starts where this one left off.
     *
     * The turn does not die if the machine is not mounted. A missing
     * conversation engine means no adaptive question — not a failed
     * turn.
     */
    let conversation = null;
    let conversationSuggestion = null;
    let adaptiveQuestion = null;
    let lastReplan = null;
    /*
     * The replan's own half. The event-replanning engine already listens
     * on the central bus, so it has already run when the world moved; the
     * turn's job here is to READ what it decided and to let the owner
     * know that the plan was reconsidered.
     *
     * It is read, not triggered: triggering belongs to the bus. A turn
     * that triggered its own replan would re-plan on every message, and
     * the machine's cooldowns exist precisely to prevent that.
     */
    try {
      const replanRead = await readLastReplan(owner, { limit: 3 });
      if (replanRead.ok) lastReplan = replanRead.replan || null;
    } catch {
      /* No replan to report is the common case, not a failure. */
    }
    try {
      const ingested = await ingestTurn(owner, { message, locale });
      if (ingested.ok) {
        conversation = ingested.conversation;
        conversationSuggestion = ingested.suggestion;
        adaptiveQuestion = ingested.question;
        const needed = conversationNeedsInput(conversation, adaptiveQuestion);
        if (needed) {
          /*
           * The missing field joins the turn's own missing-information
           * list, so the reply asks for it in the same voice as every
           * other missing field — and the machine's own question text
           * travels with it, because it is the machine's question and
           * the machine owns it.
           */
          context.missingInformation = Array.from(new Set([
            ...(context.missingInformation || []),
            needed.field || 'goal'
          ]));
          context.conversationQuestion = {
            state: needed.state,
            field: needed.field,
            missing: needed.missing,
            question: needed.question
          };
        }
      }
    } catch {
      /* The conversation machinery is best-effort; a turn without it is
         a shallower turn, not a broken one. */
    }

    /* 3. CONTEXT_RESOLUTION — including "resolve the pending action" paths. */
    intent = transition(intent, 'CONTEXT_RESOLUTION', { reason: classification.followUp });
    let followupHandled = null;
    if (classification.type === 'CONFIRM_PENDING') {
      const pending = (state.sections.pendingActions?.data || []).find((a) => a.status === 'AWAITING_CONFIRMATION');
      followupHandled = { kind: 'confirm', pending: pending || null };
    } else if (classification.type === 'CANCEL_PENDING') {
      followupHandled = { kind: 'cancel', actionId: actionId || memory.pendingConfirmation?.actionId || null };
    }
    if (!context.entities.asset && classification.entities.asset) context.entities.asset = classification.entities.asset;

    /* 4. READ REAL STATE (§44) — needed sections come from the plan template, not
       from a guess, so a quote request never runs on a stale balance. */
    intent = transition(intent, 'STATE_INSPECTION', { reason: 'plan-driven reads' });
    const neededSections = sectionsForIntent(classification, { context, state });
    const readResults = await refreshSections(owner, neededSections, registry, { context });
    state = stateStore.peek(owner);
    const wallet = state.sections.wallet.data;

    /* 5–6. DISCOVER CAPABILITIES + SELECT TOOLS */
    intent = transition(intent, 'PLANNING', { reason: `${classification.definition?.modules?.length || 0} modules in scope` });
    const built = buildPlan({
      intent: { ...intent, entities: { ...classification.entities, ...(intent.entities || {}) } },
      capabilities: capabilities.capabilities,
      health: cachedHealth,
      registry: registry.map,
      state
    });
    const plan = { ...built.plan, digest: planDigest(built.plan), problems: built.problems };
    /* A bounded fan-out, widened ONLY by the legs the user actually asked for: a
       two-part request is not 30 provider calls, it is the same modules once. */
    const stepBudget = MAX_STEPS_PER_TURN + (classification.compound?.length ? 6 * classification.compound.length : 0);
    const steps = plan.steps.slice(0, stepBudget);
    const planTruncated = plan.steps.length > steps.length ? plan.steps.length - steps.length : 0;
    intent = {
      ...intent,
      plan: steps.map((s) => ({ id: s.id, module: s.module, operation: s.operation, permission: s.permission })),
      requiredTools: steps.map((s) => `${s.module}.${s.operation}`)
    };

    /* §25 with teeth: nothing in the registry matched, so there is nothing to
       answer. An UNSUPPORTED turn used to fall through and publish whatever the
       portfolio happened to hold — a fluent, unrelated paragraph, which is the exact
       failure the brief forbids. Instead: no findings, no recommendation, and a
       question that names the closest things this brain can actually do. */
    if (intent.intentType === 'UNSUPPORTED' && !plan.steps.length) {
      /*
       * ─── THE CORPUS SHORT-CIRCUIT (2026-11-12) ──────────────────────────
       *
       * This branch used to answer «به هیچ مسیر ثبت‌شده‌ای نرساندم» for EVERY
       * question the 36-rule registry did not cover. That included questions
       * the repository already answers correctly — «کارمزد پلتفرم FBT چقدر
       * است؟», «بیت کوین چیست؟», «کیف پول من کجا ذخیره می شود؟».
       *
       * Measured before this change: 0 of 7 corpus-answerable questions got
       * an answer from this brain. The chat path answered all 7 with zero
       * provider calls.
       *
       * The brain asked "which of my 36 registered intents is this?" BEFORE
       * it asked "can I answer?". A question outside the registry therefore
       * never reached the part that could have answered it. This block puts
       * the corpus check FIRST, for the UNSUPPORTED case only.
       *
       * Three properties make this safe:
       *
       *   1. It runs ONLY when the registry found nothing and the plan has no
       *      steps — so it can never override a real read, a quote, a policy
       *      verdict or a safety refusal. Every one of those happens earlier
       *      in the chain and returns before this point.
       *   2. The gate's own safety floor applies (SAFETY_PRECHECK_RE), so a
       *      distressed person is never answered from a glossary.
       *   3. It costs ZERO provider calls, which is the whole point: the
       *      `:free` quota is 50 requests a day and a `max` turn is 6 calls.
       */
      let corpusAnswer = null;
      let corpusMatch = null;
      try {
        const rows = searchKnowledge(context.message || '', { locale, limit: 3 });
        const gate = evaluateLocalFirst({
          message: context.message || '',
          locale,
          knowledge: rows,
          context: {
            market: state.sections?.markets?.data
              ? { dataStatus: 'live', priceMap: state.sections.markets.data.prices || {} }
              : { dataStatus: 'unavailable' },
            portfolio: state.sections?.portfolio?.data || null
          },
          socialRead: classification.entities?.isDistress ? { distress: true } : null,
          emotionRead: null,
          env: process.env
        });
        if (gate?.used && gate.answer) {
          corpusAnswer = String(gate.answer).trim();
          corpusMatch = gate.evidence?.matched ? { id: gate.evidence.matched } : null;
        }
      } catch {
        corpusAnswer = null;
      }

      if (corpusAnswer) {
        /* Answered from the verified corpus: this is NOT an unsupported turn
           any more, and it is not a refusal. It is a grounded answer with a
           citation, and it says where it came from. */
        intent = {
          ...intent,
          unsupported: false,
          needsUserInput: false,
          answeredFromCorpus: true,
          corpusMatch: corpusMatch?.id || null,
          intentType: 'CORPUS_LOOKUP'
        };
        Object.assign(context, {
          missingInformation: Array.from(new Set((context.missingInformation || []).filter((m) => m !== 'intent'))),
          nearMisses: []
        });
        /* The recommendation is BUILT later from this intent (the brain's
           chain builds it after the reads), so the intent carries the answer
           and the citation, and the recommendation inherits both. */
        intent.corpusAnswer = corpusAnswer;
        intent.corpusSource = corpusMatch?.source || 'verified-knowledge';
        intent.corpusTitle = corpusMatch?.titleFa || corpusMatch?.titleEn || corpusMatch?.id || null;
      } else {
        /*
         * ─── THE MODEL FALLBACK (2026-11-12) ─────────────────────────────────
         *
         * The corpus declined. That leaves two honest options: refuse, or ask
         * a model. Refusing was the old behaviour and it was wrong here — the
         * chat path answers these questions, and the user cannot tell which
         * door they walked through.
         *
         * The budget shape is deliberate:
         *
         *   · ONE call. The brain has no six-role fan-out to pay for; the
         *     `:free` quota is 50 requests a day and a `max` turn costs 6.
         *     A question here costs 1, not 6.
         *   · `beginAiTurnBudget()` — the SAME ledger the chat path uses, so
         *     a provider that just failed in this turn is not asked again.
         *   · At most 3 seats, tried in the registry's health order.
         *   · `intelligence: 'balanced'` — a free tier's answer, not a
         *     flagship's, because the free tier IS the product here.
         *
         * And the rule that matters most: A FAILURE NEVER BECOMES AN ANSWER.
         * If no seat produces text, the brain falls through to the old honest
         * refusal. A refusal is a better answer than a fabrication.
         */
        let modelAnswer = null;
        let modelProvider = null;
        let modelId = null;
        try {
          const turnBudget = beginAiTurnBudget();
          /* `getPreferredProvidersForTask` returns provider IDS, and
             `executeProviderChat` takes an id. The `internal` seat is the
             deterministic local reasoner, not a model — asking it for a
             market answer would produce a template, so it is excluded. */
          const seats = (getPreferredProvidersForTask('general', { configuredOnly: true }) || [])
            .filter((id) => typeof id === 'string' && id !== 'internal' && isProviderConfigured(id))
            .slice(0, 3);
          const question = String(context.message || '').trim();
          for (const seat of seats) {
            try {
              const reply = await executeProviderChat(seat, {
                system: locale === 'fa'
                  ? 'تو دستیار صریح FBT هستی. به پرسش کاربر کوتاه و دقیق پاسخ بده. اگر چیزی را نمی‌دانی، صریح بگو که نمی‌دانی. عددی از خودت نساز.'
                  : 'You are FBT, an honest assistant. Answer the user briefly and precisely. If you do not know something, say so plainly. Never invent a number.',
                user: question,
                temperature: 0.3,
                maxTokens: 700,
                json: false,
                intelligence: 'balanced',
                budget: turnBudget
              });
              const text = String(reply?.text || reply?.content || reply?.answer || '').trim();
              if (text.length >= 20) {
                modelAnswer = text;
                modelProvider = seat;
                modelId = reply?.model || null;
                break;
              }
            } catch {
              /* try the next seat */
            }
          }
        } catch {
          modelAnswer = null;
        }

        if (modelAnswer) {
          intent = {
            ...intent,
            unsupported: false,
            needsUserInput: false,
            answeredFromModel: true,
            modelProvider,
            modelId,
            intentType: 'MODEL_ANSWER'
          };
          Object.assign(context, {
            missingInformation: Array.from(new Set((context.missingInformation || []).filter((m) => m !== 'intent'))),
            nearMisses: []
          });
          intent.modelAnswer = modelAnswer;
          intent.modelProvider = modelProvider;
          intent.modelId = modelId;
        } else {
      const near = (classification.evidence || []).map((e) => e.rule || e.pattern || null).filter(Boolean);
      const assetName = classification.entities.asset || classification.entities.fromAsset || null;
      /* The matrix's `capabilities` map holds a STATUS STRING per module, so the
         live check is against the string; the labels are the words a person would
         actually use, and only modules the registry calls AVAILABLE are offered. */
      const NEAR_MISS_ORDER = ['portfolio', 'crypto', 'swap', 'bridge', 'lending', 'borrowing', 'risk', 'signals', 'news', 'alerts', 'goals', 'transactions', 'lab', 'forecast'];
      const NEAR_MISS_FA = {
        portfolio: 'تحلیل پرتفوی', crypto: 'قیمت و وضعیت بازار', swap: 'نرخ سواپ', bridge: 'نرخ پل',
        lending: 'وضعیت وام و سلامت آن', borrowing: 'سقف وامگیری', risk: 'ارزیابی ریسک', signals: 'سیگنال‌های تکنیکال',
        news: 'اخبار و رویدادها', alerts: 'هشدار قیمت', goals: 'هدف و برنامهٔ سود', transactions: 'وضعیت تراکنش‌ها',
        lab: 'شبیه‌سازی و بک‌تست', forecast: 'پیش‌بینی'
      };
      const offered = NEAR_MISS_ORDER
        .filter((id) => capabilities.capabilities[id] === 'AVAILABLE')
        .map((id) => (locale === 'fa' ? NEAR_MISS_FA[id] : id))
        .filter(Boolean)
        .slice(0, 5);
      Object.assign(context, {
        missingInformation: Array.from(new Set([...(context.missingInformation || []), 'intent'])),
        nearMisses: Array.from(new Set(offered)).slice(0, 5)
      });
      intent = {
        ...intent,
        needsUserInput: true,
        unsupported: true,
        nearMiss: near.slice(0, 3),
        question: assetName
          ? `«${String(context.message || '').trim().slice(0, 60)}» را به هیچ برنامه‌ای در رجیستری نرساندم، پس هیچ عددی از این مسیر عرض نمی‌شود. اگر منظورت کاری با ${assetName} است، بگو کدام: ${offered.slice(0, 3).join('، ')}.`
          : `«${String(context.message || '').trim().slice(0, 60)}» را به هیچ برنامه‌ای در رجیستری نرساندم، پس هیچ عددی از این مسیر عرض نمی‌شود. مسیرهای آمادهٔ همین نشست: ${offered.slice(0, 4).join('، ')}.`
      };
        }
      }
    }

    /* §5/§20 — a money request with a hole in it is answered with a NAMED question,
       not with a venue call. The check runs on the bound inputs (the same binding the
       steps use) so the question and the plan can never disagree about what is
       missing, and the quote/prepare/simulate steps are withheld instead of being
       sent a null asset and reporting an opaque provider error. */
    /*
     * A MONEY STEP IS A STEP THAT CAN MOVE MONEY.
     *
     * `simulate` was in this list, and `GOAL_PLAN` has a `goals.plan`
     * simulate step. So «هدفت چیست؟» asked for «ارز مبدأ، ارز مقصد،
     * مبلغ» — the swap question — and answered nothing.
     *
     * The bug is that `simulate` was treated as a money operation. A
     * simulation of a GOAL or a PROFIT PLAN is arithmetic over the
     * owner's own numbers: it moves nothing and needs no asset. A
     * simulation of a TRADE quotes a swap: it needs the pair and the
     * amount, and without them it must ask.
     *
     * So the rule is about the INTENT, not about the verb: a READ-only
     * intent never asks for a trade's inputs, however it computes.
     */
    const intentPermission = intent?.permission || classification?.definition?.permission || 'READ';
    const intentCanMoveMoney = intentPermission === 'EXECUTE' || intentPermission === 'PREPARE';
    const moneySteps = intentCanMoveMoney
      ? steps.filter((st) => st.operation === 'quote' || st.operation === 'prepare' || st.operation === 'simulate' || st.operation === 'execute')
      : steps.filter((st) => st.operation === 'quote' || st.operation === 'prepare' || st.operation === 'execute');
    let missingInputs = [];
    let boundMoneyInput = null;
    if (moneySteps.length) {
      const probe = bindStepInput(moneyStepInput(moneySteps[0]), classification.entities, state, context, owner);
      boundMoneyInput = probe;
      if (!probe.from) missingInputs.push('fromAsset');
      if (!probe.to) missingInputs.push('toAsset');
      if (probe.amountUsd === null && probe.amount === null) missingInputs.push('amount');
      if (missingInputs.length) missingInputs = missingInputs.filter((f) => !(f === 'toAsset' && classification.entities.side === 'sell'));
    }

    if (missingInputs.length) {
      Object.assign(context, { missingInformation: Array.from(new Set([...(context.missingInformation || []), ...missingInputs])) });
      intent = { ...intent, needsUserInput: true, missingInputs };
    }

    /*
     * A FIELD THE CONVERSATION MACHINE IS MISSING IS ALSO A HOLE.
     *
     * The conversation machinery asked «این پول برای چیست؟» and the
     * goal field is missing. That is a hole in THIS turn, and the reply
     * has to ask it — but `needsUserInput` was set only by the money-step
     * check, so a turn whose only gap was the machine's own question
     * answered it instead of asking.
     *
     * It used to work by accident: `GOAL_PLAN` has a `goals.plan`
     * simulate step, the money-step check treated that simulate as a
     * swap and demanded «fromAsset / toAsset / amount», and the reply
     * happened to be in QUESTION mode — so the machine's question was
     * rendered with a swap's field list attached. A test passed because
     * of a bug, and the goal question asked for «ارز مبدأ» while the
     * user had asked about a goal.
     *
     * The gap is read from the machine's own missing list, so the reply
     * asks for the field that is actually missing.
     *
     * BUT NOT WHEN THE TURN WAS ANSWERED. A corpus answer and a model
     * answer both carry their own completion: «بیت کوین چیست؟» was
     * answered from the corpus, and the conversation machine's missing
     * «goal» field must not turn that answered turn back into a
     * question. The answer and the question would fight, and the
     * answer would lose — the user would see an empty reply.
     */
    const machineMissing = Array.isArray(context.conversationQuestion?.missing) ? context.conversationQuestion.missing : [];
    const turnWasAnswered = Boolean(intent?.answeredFromCorpus || intent?.answeredFromModel || intent?.corpusAnswer || intent?.modelAnswer);
    if (machineMissing.length && !intent.needsUserInput && !turnWasAnswered) {
      /*
       * The SOURCE of the need is part of the fact.
       *
       * Two different checks can set `needsUserInput`, and they do not mean
       * the same thing. The money-step check means «this turn is about to move
       * money and does not know the amount» — that must stay a question, or the
       * reply offers a button to approve a request nobody specified. The
       * conversation machinery means «I would like one more field to be more
       * useful» — and when the turn has ALREADY answered the question that was
       * asked, that is a follow-up, not a replacement.
       *
       * Without the marker the two are indistinguishable downstream, and every
       * read-only turn the machinery could find a field for became a QUESTION.
       */
      intent = {
        ...intent,
        needsUserInput: true,
        missingInputs: machineMissing,
        needsUserInputSource: 'conversation-machinery'
      };
    }

    const results = {};
    if (planTruncated) results['plan.truncated'] = { status: 'PARTIAL', summary: `${planTruncated} later step(s) were held back to bound upstream calls`, source: 'central-planner' };
    for (const key of neededSections) {
      if (readResults[key]) results[`${moduleForSection[key]}.read`] = summariseModuleRead(key, readResults[key]);
    }
    const runnableSteps = missingInputs.length ? steps.filter((st) => !moneySteps.includes(st)) : steps;
    const stepResults = await runSteps({
      owner, registry, steps: runnableSteps, intent, context, state, results, classification,
      ledger: (step, res) => {
        const classified = classifyError(new Error([res.code, res.reason, res.detail, 'TOOL_FAILURE'].filter(Boolean).join(' ')), { module: step.module });
        errorLedger.report({
          ...classified, module: step.module, stepId: step.id,
          recovery: res.recovery?.actions?.length
            ? { actions: res.recovery.actions, done: false }
            : nextRecovery(classified, { attempts: intent.attempts || 0, providers: registry.map[step.module]?.definition?.fallback || [] })
        });
      }
    });
    Object.assign(results, stepResults.results);
    state = stateStore.peek(owner);

    /* Security signals are collected AFTER the reads, because they are derived
       from what the reads said (token risk, oracle status, quote sanity). The
       risk engine and the policy engine are handed the SAME array, so a honeypot
       cannot be visible to one and invisible to the other. */
    const securitySignals = collectSecuritySignals({ results, stepResults, wallet, readResults });

    /* 7. RISK, then POLICY_CHECK (§18, §24, §33) */
    const riskContextKey = context.page.module && steps.some((s) => s.module === context.page.module) ? context.page.module : (steps.find((s) => s.riskContext)?.riskContext || 'portfolio');
    const risk = assessRisk({
      intent: { ...intent, entities: classification.entities },
      plan,
      state,
      context: riskContextKey,
      quote: stepResults.quote || null,
      simulation: stepResults.simulation || null,
      securitySignals,
      capabilities: capabilities.capabilities,
      now: Date.now()
    });
    state = writeSection(state, 'risk', { data: { level: risk.level, confidence: risk.confidence, factors: risk.factors.slice(0, 8), context: riskContextKey, at: Date.now() }, source: 'risk-engine', status: 'OK', now: Date.now() }).state;
    await stateStore.replace(owner, state);

    const confirmation = confirm || classification.type === 'CONFIRM_PENDING'
      ? { confirmed: true, intentId: intent.intentId, planDigest: planDigestSent || plan.digest, method: confirm ? 'user-card' : 'verbal-followup' }
      : null;
    let policy = evaluatePolicy({
      intent, plan, capabilities: capabilities.capabilities, state, risk,
      quote: stepResults.quote || null, confirmation,
      securitySignals,
      wallet: wallet ? { availableUsd: wallet.totalValueUsd } : null,
      now: Date.now(), page: context.page, actionType: actionTypeFor(intent, classification)
    });
    policy = { ...policy, planDigest: plan.digest };
    intent = transition(intent, 'POLICY_CHECK', { reason: policy.verdict });

    /* A capability the registry does not have is answered by the REGISTRY, not by
       the nearest available topic. Without this gate, «ETF بخرم؟» fell through to
       the portfolio analysis that happened to be readable and answered a different
       question confidently — which is worse than refusing, because it looks like an
       answer. Only when EVERY module the intent asked for is dead do we refuse; one
       live module is a partial answer, and partial is what §22 asks for. */
    const askedModules = (classification.definition?.modules || []).filter(Boolean);
    const deadFor = (m) => ['UNAVAILABLE', 'INCOMPLETE', 'UNREGISTERED'].includes(String(capabilities.capabilities[m] || 'UNREGISTERED'));
    const deadModules = askedModules.filter(deadFor);
    const liveModules = askedModules.filter((m) => !deadFor(m));
    const askedInstrument = classification.entities.instrument || null;
    const refusal = (askedModules.length && !liveModules.length) || (classification.type === 'INSTRUMENT_QUERY' && askedInstrument && deadFor(askedInstrument))
      ? {
        module: deadModules[0] || 'unknown',
        modules: deadModules,
        text: locale === 'fa'
          ? `«${classification.entities.instrument || classification.type.toLowerCase()}» با ابزارهای فعلی FBT انجام نمی‌شود: ماژول ${deadModules.join(', ')} در رجیستری مرکزی با وضعیت ${deadModules.map((m) => capabilities.capabilities[m] || 'UNREGISTERED').join('/')} ثبت شده است. مسیری ساخته نمی‌شود و عددی هم برای این کار عرض نمی‌شود.`
          : `«${classification.entities.instrument || classification.type.toLowerCase()}» is not possible with FBT's current tools: the ${deadModules.join(', ')} module is registered as ${deadModules.map((m) => capabilities.capabilities[m] || 'UNREGISTERED').join('/')}. No route is built and no number is offered for it.`,
        reason: locale === 'fa'
          ? 'وضعیت از ماتریس توانمندی خوانده شد؛ §8 اجازه نمی‌دهد قابلیتی که وجود ندارد اعلام شود و §40 یک ویژگی نیمه‌ساخته را «Incomplete» می‌شمارد'
          : 'status read from the capability matrix; §8 forbids claiming a capability that does not exist and §40 counts a half-built feature as incomplete',
        alternatives: [
          ...(Object.entries(capabilities.capabilities).filter(([, v]) => v === 'AVAILABLE' || v === 'READ_ONLY' || v === 'DEGRADED').length
            ? [locale === 'fa'
              ? `چیزهایی که همین حالا هست: تحلیل پرتفوی، نرخ سواپ و پل، وضعیت وام و سلامت آن، ریسک، اخبار و سیگنال‌ها`
              : 'what exists right now: portfolio analysis, swap and bridge quotes, loan status and health, risk, news and signals']
            : []),
          ...(classification.entities.instrument && ['stocks', 'forex', 'commodities', 'rwa'].includes(classification.entities.instrument) && capabilities.capabilities[classification.entities.instrument] !== 'UNAVAILABLE'
            ? [locale === 'fa'
              ? `قراردادهای sintetیک ${classification.entities.instrument} از venue (فقط‌خواندنی) قابل مشاهده است؛ خرید و فروش در کیف پول خودتان انجام می‌شود`
              : `read-only ${classification.entities.instrument} synthetic venues are visible; trading them happens in your own wallet`]
            : [])
        ],
        source: 'central-registry + capability-manager'
      }
      : null;

    /* Findings → recommendation (§26). Built from the same `results` the reply
       uses, so the advice and the numbers cannot diverge. */
    /*
     * ─── BOTH HALVES OF A TWO-PART QUESTION ──────────────────────────────
     *
     * The plan already merged the legs, so the DATA for both halves is in
     * `results`. But the findings were built for ONE intent, so the second
     * half's own numbers never became evidence and the reply showed the
     * first half alone — with a complete-looking headline, a reason, data
     * and a confidence.
     *
     * So the findings are built PER LEG: each leg gets its own intent
     * view, its own findings, and its own headline. The user asked two
     * questions and gets two answers, each attributable to the module
     * that produced it.
     *
     * The legs that the user did NOT ask for are the ones that must not
     * appear here: a compound READ is two READS, never a transaction.
     */
    const legIntents = (classification.compound || [])
      .map((c) => c && c.intent)
      .filter((t) => t && t !== intent.intentType);
    const findings = buildFindings({ intent, classification, state, results, risk, readResults, stepResults, context, locale, lastReplan });
    /* The per-leg findings ride ALONG with the main ones; the main ones
       stay first so the primary subject is still the headline. */
    const legFindings = [];
    for (const legIntent of legIntents) {
      const legView = { ...intent, intentType: legIntent, corpusAnswer: null, corpusMatch: null, modelAnswer: null };
      const legOut = buildFindings({ intent: legView, classification, state, results, risk, readResults, stepResults, context, locale, lastReplan });
      /*
       * A leg's findings are ITS OWN.
       *
       * The same reading can serve two legs — «ریسک» is read by the
       * portfolio leg and by the risk leg — and each leg needs its own
       * copy of it, because a leg's headline is built from that leg's
       * findings and nothing else. If the risk leg had no copy of the
       * risk finding, it would have no evidence and would fall back to
       * the generic tail: «نتیجهٔ خواندن وضعیت: HIGH».
       *
       * The copy is NOT a second reading — the module was read ONCE and
       * the `dataAt` is the same — it is the same fact attributed to
       * the question it answers.
       */
      const seenInThisLeg = new Set();
      for (const f of legOut) {
        if (!f) continue;
        const key = `${f.id}|${f.status}`;
        if (seenInThisLeg.has(key)) continue;
        seenInThisLeg.add(key);
        legFindings.push({ ...f, leg: legIntent });
      }
    }
    findings.push(...legFindings);
    const capabilitiesMap = capabilities.capabilities;
    const actions = possibleActionsFrom({ findings, capabilities: capabilitiesMap, risk, policy, walletConnected: Boolean(wallet?.connected) });
    /* When the answer is a refusal, the reply IS the refusal: the portfolio numbers
       that happen to be readable must not be dressed up as a response to a question
       we could not serve (§25 forbids filling the gap with whatever was at hand). */
    /*
     * The arguments are named so the recommendation can be built TWICE from
     * exactly the same inputs — see the rebuild after the why read below.
     */
    const recommendationArgs = {
      kind: policy.requiresConfirmation ? 'ACTIONABLE' : 'ANALYSIS',
      intent, risk, findings, capabilities: capabilitiesMap, policy, plan, locale,
      alternatives: alternativesFor({ findings, state, capabilities: capabilitiesMap, locale }),
      actions: policy.requiresConfirmation && !policy.allowExecute ? [] : actions,
      refusalMode: Boolean(refusal),
      now: Date.now()
    };
    let recommendation = refusal ? {
      schema: 'fbt.central-recommendation.v1', brain: CI_SCHEMA, ok: false,
      missing: ['capability'], reason: [], refusal: refusal.text, refusedModule: refusal.module
    } : buildRecommendation(recommendationArgs);

    /*
     * ── THE WHY READ (path 15) ────────────────────────────────────────────
     *
     * The why module is read AFTER the recommendation, because it
     * explains THAT recommendation. Reading it earlier would explain the
     * previous turn's decision — which is a different, and wrong, thing.
     *
     * The bundle it receives is the brain's OWN artefacts: the
     * recommendation, the findings it was built from, the risk view it
     * was judged against and the owner's own state. So the explanation
     * and the answer are made of the same numbers, and they cannot
     * disagree.
     *
     * It is a READ, like every other step, and it is OPTIONAL: a turn
     * with no recommendation has nothing to explain, and the reply says
     * so rather than inventing a reason.
     */
    if (intent.intentType === 'WHY_DECISION') {
      const whyModule = registry.map['why-decision'];
      if (whyModule && typeof whyModule.read === 'function') {
        try {
          const res = await whyModule.read({
            recommendation,
            findings,
            risk,
            state,
            routeIntelligence: readResults.routeIntelligence?.data || null,
            macroGraph: readResults.macroGraph?.data || null
          }, { owner, intentId: intent.intentId, context });
          results['why.read'] = {
            status: res.status,
            summary: summariseModuleRead('whyDecision', res),
            data: res.data,
            source: res.source || 'why-decision',
            dataAt: res.at || Date.now(),
            reason: res.reason || null,
            stale: res.status === 'PARTIAL'
          };
        } catch (err) {
          results['why.read'] = {
            status: 'UNAVAILABLE',
            summary: 'the why engine could not be read',
            data: null,
            source: 'why-decision',
            dataAt: Date.now(),
            reason: String(err?.message || err).slice(0, 160) || null,
            stale: true
          };
        }
      }
      /*
       * The finding that carries the explanation is built HERE, after the
       * read — not inside `buildFindings`, which runs before the
       * recommendation the read needs. This is the line that made the
       * engine dark: the finding was built first and could only ever
       * report a read that had not happened yet.
       */
      buildWhyFinding({ intent, results, readResults, findings, locale });

      /*
       * ─── THE RECOMMENDATION IS BUILT TWICE, AND THAT IS NOT WASTE ───────
       *
       * Three facts, and they cannot all be satisfied by one build:
       *
       *   · the why engine explains THIS recommendation, so a recommendation
       *     must exist before the read;
       *   · the finding that carries the explanation can only be built after
       *     the read (§5.19 — building it first is what made the engine dark);
       *   · the headline for «چرا این را گفتی؟» IS the explanation, so the
       *     reply's recommendation has to be built with the why finding in it.
       *
       * Without the second build the WHY_DECISION headline branch could never
       * fire: it looked for a finding appended after the headline had already
       * been written, so the reply fell through to «نتیجهٔ خواندن وضعیت: 100»
       * — a number with no subject, for the one question whose whole point is
       * the explanation.
       *
       * The expensive part is the why READ, and it still happens once.
       * `buildRecommendation` is pure arithmetic over findings already in hand,
       * and `findings` is the same array the read just pushed into.
       */
      if (!refusal && findings.some((f) => f && f.id === 'why-decision')) {
        recommendation = buildRecommendation({ ...recommendationArgs, now: Date.now() });
      }
    }

    /*
     * A CONCEPTUAL QUESTION IS A QUESTION ABOUT A CONCEPT.
     *
     * The marker «چیست» used to be enough on its own, so «هدفت چیست؟» —
     * "what is YOUR goal?" — was read as a request for the DEFINITION of
     * a goal, and the corpus answered with a Solana PDA. The user asked
     * about their own goal and got a glossary entry about an address.
     *
     * The distinction is the SUBJECT. «بیت‌کوین چیست؟» asks what a
     * thing is; «هدفت چیست؟» asks what the registry's GOAL_PLAN read.
     * When the registry already knows what the sentence is about, its
     * reading wins: the internal synthesis is a fallback for a sentence
     * the registry could not place, not a competitor to a reading it
     * already has.
     *
     * So the synthesis only runs when the registry matched nothing —
     * the UNSUPPORTED case — or when the sentence is genuinely about a
     * macro concept that no intent covers.
     */
    const registryPlacedTheSentence = Boolean(
      classification.type
      && classification.type !== 'UNSUPPORTED'
      && classification.type !== 'CORPUS_LOOKUP'
      && !/^(?:UNSUPPORTED|CORPUS_LOOKUP)$/.test(classification.type || '')
    );
    const macroConcept = /(?:تورم|نرخ\s*بهره|فدرال|دارایی[‌\s]*های\s*کمیاب|کارمزد|غیرامانی)/i.test(message);
    const isConceptualOrAdvisory = Boolean(
      !refusal
      && policy.verdict !== 'SAFE_STOP'
      && policy.verdict !== 'BLOCK'
      && !policy.requiresConfirmation
      && (
        classification.entities?.isDistress
        || classification.entities?.isDiscovery
        || macroConcept
        || (!registryPlacedTheSentence && /(?:چیست|چیه)/i.test(message))
      )
    );
    let internalSynthesisUsed = false;
    if (isConceptualOrAdvisory) {
      const mktData = state.sections.markets.data;
      const rawPrices = mktData?.prices && typeof mktData.prices === 'object' ? mktData.prices : {};
      const priceMap = {};
      for (const [sym, info] of Object.entries(rawPrices)) {
        const p = info?.priceUsd ?? info?.price ?? (typeof info === 'number' ? info : null);
        if (p != null && Number.isFinite(Number(p))) priceMap[String(sym).toUpperCase()] = Number(p);
      }
      const synth = synthesizeInternalAnswer({
        message,
        locale,
        context: {
          market: Object.keys(priceMap).length ? { dataStatus: 'live', priceMap } : { dataStatus: 'unavailable' },
          portfolio: state.sections.portfolio.data || null
        }
      });
      if (synth?.ok && synth.answer && (synth.safetyContainment || synth.knowledgeUsed || synth.internalSynthesis)) {
        internalSynthesisUsed = true;
        recommendation.ok = true;
        recommendation.recommendation = synth.answer;
        if (classification.entities?.isDistress) {
          recommendation.actions = [];
          recommendation.reason = [locale === 'fa' ? 'پاسخ ایمنی در شرایط فشار احساسی بدون پیشنهاد معامله' : 'emotional safety containment without trade recommendation'];
        } else {
          recommendation.reason = [...new Set([...(Array.isArray(recommendation.reason) ? recommendation.reason : []), locale === 'fa' ? 'تلفیق دانش تاییدشده و داده‌های خوانده‌شده' : 'verified knowledge + read tool data'])].slice(0, 4);
        }
      }
    }

    /* 8–11. QUOTE → SIMULATION → CONFIRMATION → EXECUTION */
    let execution = null;
    let created = null;
    if (policy.requiresConfirmation && !policy.allowExecute && policy.verdict === 'REQUIRE_CONFIRMATION') {
      intent = transition(intent, 'QUOTE', { reason: 'quote produced for confirmation' });
      if (stepResults.quote) intent = transition(intent, 'SIMULATION', { reason: 'simulation ran on the quote' });
      intent = transition(intent, 'CONFIRMATION', { reason: 'awaiting explicit user confirmation' });
      created = registry.actions.create({
        owner, intentId: intent.intentId, module: primaryModuleFor(intent, steps), actionType: actionTypeFor(intent, classification),
        /* The action stores the BOUND input the venue was quoted on, not the raw
           entity bag: `confirm` later hands this object to the module, and a card
           whose `input` disagrees with the numbers printed above it is the one
           inconsistency a user cannot check. */
        operation: 'execute', input: boundMoneyInput || { ...classification.entities, ...(hints || {}) },
        quote: stepResults.quote || null, riskSnapshot: risk, planDigest: plan.digest, requestId, executionId
      });
      /* The keys that were claimed at the door are bound to the action now that it
         exists, so the next retry finds THIS record instead of creating a sibling. */
      if (created?.action) registry.actions.markDedupe({ owner, action: created.action, claimResult: claimed });
      memory = applyTurn(memory, {
        intent: { type: intent.intentType, confidence: intent.confidence },
        entities: classification.entities,
        action: { actionId: created.action.actionId, type: created.action.actionType, module: created.action.module },
        pendingConfirmation: { actionId: created.action.actionId, planDigest: plan.digest, intentId: intent.intentId, createdAt: Date.now() },
        at: Date.now()
      });
      remember(owner, memory);
      turns.confirmations += 1;
    } else if (policy.allowExecute) {
      intent = transition(intent, 'EXECUTION', { reason: 'policy allowed execution after confirmation' });
      const module = registry.map[primaryModuleFor(intent, steps)] || registry.map.swap;
      const out = await module.execute({
        ...classification.entities, amountUsd: classification.entities.amountUsd, actionId: actionId || memory.pendingConfirmation?.actionId || null,
        quote: stepResults.quote || null, intentId: intent.intentId
      }, { owner, intentId: intent.intentId });
      execution = normalizeExecution(out, module.id);
      intent = transition(intent, 'VERIFICATION', { reason: execution.status === 'AWAITING_SIGNATURE' ? 'handoff to wallet' : 'verifiable immediately' });
      registry.actions.confirm({ owner, actionId: actionId || memory.pendingConfirmation?.actionId, planDigest: plan.digest, method: 'user-card' });
      if (execution.status === 'AWAITING_SIGNATURE') {
        registry.actions.recordHandoff({ owner, actionId: actionId || memory.pendingConfirmation?.actionId, handoff: execution });
      }
      memory = applyTurn(memory, {
        action: { actionId: actionId || memory.pendingConfirmation?.actionId || null, type: execution.actionType, status: execution.status, module: module.id },
        pendingConfirmation: null,
        intent: { type: intent.intentType, confidence: intent.confidence },
        entities: classification.entities,
        at: Date.now()
      });
      remember(owner, memory);
    } else if (policy.verdict === 'SAFE_STOP') {
      turns.safeStops += 1;
      /* A security stop is a TERMINAL state for this intent (§32): not an error to
         retry, not a block to negotiate. Any confirmation card still open for the
         same plan is cancelled here, because leaving it alive would let a click
         approve what the scan just refused. */
      const codes = (securitySignals || []).map((x) => x.code).filter(Boolean);
      intent = transition(intent, 'SAFE_STOP', { reason: codes.join(',') || 'policy' });
      if (memory.pendingConfirmation?.actionId) {
        registry.actions.cancel({ owner, actionId: memory.pendingConfirmation.actionId, reason: `superseded by a security stop (${codes.join(',') || 'policy'})` });
      }
      memory = applyTurn(memory, { pendingConfirmation: null, error: { code: codes[0] || 'SAFE_STOP', userMessage: 'عملیات به دلیل بررسی امنیتی متوقف شد', recoverable: false }, at: Date.now() });
      remember(owner, memory);
    } else if (policy.verdict === 'BLOCK') {
      turns.blocked += 1;
      intent = { ...intent, policy: { verdict: 'BLOCK', reasons: policy.reasons.slice(0, 3) } };
    }

    /* 12–13. STATE_UPDATE + EVENTS + related-module refresh (§16) */
    if (txHash) {
      const verified = await registry.actions.verify({ owner, actionId: actionId || memory.pendingConfirmation?.actionId, input: { txHash, chainId } });
      state = stateStore.peek(owner);
      const cascadeSections = registry.actions.sectionsToRefresh(verified.action || { module: 'swap' });
      const refreshed = await refreshSections(owner, cascadeSections, registry, { context });
      for (const [k, v] of Object.entries(refreshed)) results[`refresh.${k}`] = { status: v.status, summary: `refreshed after verification: ${v.status}` };
      execution = { ...(execution || {}), verification: verified.ok ? verified.action.verification : { status: verified.code } };
      if (['VERIFICATION', 'EXECUTION'].includes(intent.status)) {
        intent = transition(intent, 'STATE_UPDATE', { reason: 'receipt verified, dependents refreshed' });
      }
    }

    if (intent.status !== 'COMPLETED' && !['CANCELLED', 'SAFE_STOP', 'ERROR', 'DUPLICATE'].includes(intent.status)) {
      intent = transition(intent, 'COMPLETED', { reason: 'turn resolved' });
    }

    /* 14. RESPOND (§19, §43) */
    const response = composeResponse({
      intent, context, plan, policy, results, risk, recommendation, refusal,
      gapLead: (() => {
        if (internalSynthesisUsed) return null;
        const primary = (SECTION_FOR_INTENT[intent.intentType] || [])[0] || null;
        const failed = primary && readResults[primary] && readResults[primary].status === 'UNAVAILABLE' ? readResults[primary] : null;
        if (!failed) return null;
        const subject = classification.entities.asset || classification.entities.instrument || (SECTION_LABEL_FA[primary] || primary);
        const ladder = (failed.recovery?.actions || []).map((a) => a.type);
        return {
          source: moduleForSection[primary] || primary,
          code: failed.reason || 'SOURCE_UNAVAILABLE',
          text: locale === 'fa'
            ? `«${subject}» خوانده نشد: ماژول ${moduleForSection[primary] || primary} پاسخ نداد (${failed.reason || 'SOURCE_UNAVAILABLE'}). عددی جای آن نمایش نمی‌شود و حدسی هم زده نمی‌شود.`
            : `«${subject}» was not readable: the ${moduleForSection[primary] || primary} module did not answer (${failed.reason || 'SOURCE_UNAVAILABLE'}). No number is shown in its place and nothing is guessed.`,
          next: locale === 'fa'
            ? (ladder.length ? `سامانه این مسیر را امتحان کرد: ${ladder.join(' ← ')}. اگر باز هم پاسخ نیامد، عدد قدیمی جایگزین نشان داده نمی‌شود.` : 'منبع دوباره خوانده می‌شود؛ تا آن زمان عددی نمایش داده نمی‌شود.')
            : (ladder.length ? `the system tried: ${ladder.join(' then ')}. If it still fails, an old number will not be presented as a new one.` : 'the source is read again; until then no number is shown')
        };
      })(),
      confirmation: {
        quote: stepResults.quote || null,
        risk,
        actionType: actionTypeFor(intent, classification),
        input: boundMoneyInput || { ...classification.entities, ...(hints || {}) },
        actionId: created?.action?.actionId || null
      },
      error: internalSynthesisUsed ? null : firstError(readResults), execution, locale, state,
      lastFingerprint: memory.conversationContext?.lastReplyFingerprint, now: Date.now()
    });
    memory = applyTurn(memory, {
      intent: { type: intent.intentType, confidence: intent.confidence },
      entities: classification.entities,
      result: { summary: response.headline || null, data: null },
      fingerprint: response.fingerprint,
      askedUser: response.mode === 'QUESTION' ? (response.ask?.fields || []).join(',') : null,
      /* A security stop has to remain the last thing the brain remembers:
         clearing it on the same turn would let the next sentence be answered as
         if the scan had never run, and a retry would look innocent. */
      clearedError: !firstError(readResults) && policy.verdict !== 'SAFE_STOP',
      at: Date.now()
    });
    remember(owner, memory);
    /* The bookkeeping sections go THROUGH the store, not through a local copy of
       the state object: these five used to be written into `state` and then thrown
       away by the `peek` on the next line, so the error trail, the open cards and
       the capability snapshot were computed every turn and persisted never — which
       is how «این خطا ثبت شد» could be said while nothing had been written down. */
    await stateStore.write(owner, 'recentActions', { data: registry.actions.recent(owner), source: 'action-engine', status: 'OK', now: Date.now() });
    await stateStore.write(owner, 'pendingActions', { data: registry.actions.pending(owner), source: 'action-engine', status: 'OK', now: Date.now() });
    await stateStore.write(owner, 'errors', { data: errorLedger.recent(), source: 'error-engine', status: 'OK', now: Date.now() });
    await stateStore.write(owner, 'capabilities', { data: capabilities.capabilities, source: 'capability-manager', status: 'OK', now: Date.now() });
    /*
     * The conversation's own row goes into the SESSION section, beside the
     * compacted memory. The two are the same thing seen from two sides:
     * the memory is what the brain REMEMBERS, and the conversation row is
     * where the conversation IS.
     *
     * It is written here — after the turn resolved — because that is when
     * the conversation's state is known. The `session` section has a
     * fifteen-minute TTL, so a conversation that the user walks away from
     * ages out on its own instead of lingering as a stale state machine.
     */
    if (conversation) {
      await stateStore.write(owner, 'session', {
        data: {
          memory: compactMemory(memory),
          conversation: {
            id: conversation.id,
            state: conversation.state,
            turns: conversation.turns ?? null,
            locale: conversation.locale ?? null,
            suggested: conversationSuggestion?.to ?? null,
            because: conversationSuggestion?.because ?? null,
            missing: Array.isArray(adaptiveQuestion?.missing) ? adaptiveQuestion.missing : [],
            asked: context.conversationQuestion?.question ?? null
          },
          /*
           * The last replan, when the world moved. It is kept beside the
           * conversation because a replan IS a conversation event: the
           * plan was reconsidered, and the conversation has to know it.
           */
          replan: lastReplan
            ? {
                trigger: lastReplan.trigger ?? null,
                label: lastReplan.label ?? null,
                at: lastReplan.at ?? null,
                changed: lastReplan.changed ?? null,
                notify: lastReplan.notify === true
              }
            : null,
          at: Date.now()
        },
        source: 'conversation-state-engine',
        status: 'OK',
        now: Date.now()
      });
    }
    await stateStore.write(owner, 'health', { data: cachedHealth, source: 'capability-manager', status: 'OK', now: Date.now() });
    state = stateStore.peek(owner);
    const persist = await stateStore.persist(owner, state);

    /* The event names what actually happened. A confirmation request is not a
       block (nothing was refused — an approval is being ASKED FOR, `ACTION_PROPOSED`),
       and a security stop is not a policy disagreement; conflating them is how an
       alert stream becomes noise nobody reads. */
    if (policy.verdict === 'SAFE_STOP') {
      events?.publish({ type: 'SAFE_STOP', owner, intentId: intent.intentId, payload: { intentType: intent.intentType, codes: (securitySignals || []).map((x) => x.code) }, source: 'policy-engine' });
    } else if (policy.verdict === 'BLOCK') {
      events?.publish({ type: 'POLICY_BLOCKED', owner, intentId: intent.intentId, payload: { intentType: intent.intentType, reasons: policy.reasons.slice(0, 3) }, source: 'policy-engine' });
    } else if (response.requiresConfirmation) {
      events?.publish({ type: 'ACTION_PROPOSED', owner, intentId: intent.intentId, actionId: created?.action?.actionId || null, payload: { intentType: intent.intentType, actionType: created?.action?.actionType || null }, source: 'action-engine' });
    }
    /* publish() invalidates the cascaded sections itself; the generic
       CAPABILITY_CHANGED signal is only worth sending when something flipped. */

    const turn = {
      schema: BRAIN_SCHEMA,
      brain: CI_SCHEMA,
      intent: publicIntent(intent),
      context: { page: context.page, followUp: context.followUp.kind, entities: context.entities, missing: context.missingInformation, digest: context.contextDigest },
      /*
       * The conversation's own state travels with the turn. It is not a
       * user-facing capability — it is the machinery's own bookkeeping —
       * and it is here so an operator can see WHICH state the
       * conversation is in and which field it was asked for.
       */
      conversation: conversation
        ? {
            id: conversation.id,
            state: conversation.state,
            turns: conversation.turns ?? null,
            suggested: conversationSuggestion?.to ?? null,
            because: conversationSuggestion?.because ?? null,
            asked: context.conversationQuestion?.question ?? null,
            missing: Array.isArray(adaptiveQuestion?.missing) ? adaptiveQuestion.missing : []
          }
        : null,
      plan: { steps: plan.steps.map((s) => ({ id: s.id, module: s.module, operation: s.operation, permission: s.permission, degraded: s.degraded === true })), skipped: plan.skipped, problems: plan.problems, digest: plan.digest },
      policy: { verdict: policy.verdict, reasons: policy.reasons, gates: policy.gates, requiresConfirmation: policy.requiresConfirmation, safeStop: policy.safeStop, allowExecute: policy.allowExecute, planDigest: policy.planDigest },
      risk,
      recommendation,
      /*
       * The findings the recommendation was built from. They travel with
       * the turn because they ARE the evidence: the recommendation's
       * reasons point at them, and a reader who cannot see them cannot
       * check it. This is also how the new surfaces — the route
       * ranking, the why block, the replan — become observable without
       * each of them inventing a new field.
       */
      findings: findings.map((f) => ({
        id: f.id ?? null,
        status: f.status ?? null,
        source: f.source ?? null,
        detail: f.detail ?? null,
        reason: f.reason ?? null,
        dataAt: f.dataAt ?? null,
        partial: f.partial === true,
        /*
         * The surfaces carry their own numbers — the replan's risk level,
         * the route's cost, the why block's falsifiers — and those
         * numbers ARE the finding. A summary that dropped them would
         * report that something happened without saying what, which is
         * the «it was recorded» failure this repo keeps fixing. So the
         * known fields are carried through rather than re-invented here.
         */
        ...(f.riskLevel !== undefined ? { riskLevel: f.riskLevel } : {}),
        ...(f.trigger !== undefined ? { trigger: f.trigger } : {}),
        ...(f.changed !== undefined ? { changed: f.changed } : {}),
        ...(f.executionAuthorized !== undefined ? { executionAuthorized: f.executionAuthorized } : {}),
        ...(f.bestRoute !== undefined ? { bestRoute: f.bestRoute } : {}),
        ...(f.why !== undefined ? { why: f.why } : {}),
        ...(f.falsifiers !== undefined ? { falsifiers: f.falsifiers } : {}),
        ...(f.lines !== undefined ? { lines: f.lines } : {})
      })),
      execution,
      createdAction: created?.action || null,
      response,
      stateDigest: stateDigest(state, neededSections.length ? neededSections : ANALYSIS_MINIMUM, Date.now()),
      meta: {
        at: Date.now(), tookMs: Date.now() - startedAt, sectionsRead: neededSections,
        durable: persist.persisted === true, capabilities: capabilities.counts, coverage: capabilities.coverage,
        stateRevision: state.revision, mode: response.mode
      }
    };
    recordIntent(owner, {
      at: turn.meta.at,
      intentId: intent.intentId,
      intentType: intent.intentType,
      status: intent.status,
      stages: (intent.history || []).map((h) => h.state),
      mode: response.mode,
      verdict: policy.verdict,
      reasons: policy.reasons.slice(0, 3),
      actionId: created?.action?.actionId || actionId || null,
      planDigest: plan.digest,
      tookMs: turn.meta.tookMs,
      headline: response.headline,
      responseFingerprint: response.fingerprint
    });
    return turn;
  }

  /**
   * Confirmation → execution → verification, as its own entry point (§36's
   * `/api/intent/:id/confirm`). Going through `handle()` again would re-classify
   * the word "confirm" and re-quote — a second interpretation of one decision.
   */
  async function confirmAction({ owner, actionId, planDigest: sentDigest, execute = true }) {
    const registry = registryFor(owner);
    const result = registry.actions.confirm({ owner, actionId, planDigest: sentDigest, method: 'user-card' });
    if (!result.ok) return { ok: false, ...result };
    const action = result.action;
    if (!execute) return { ok: true, action, executed: false };
    const module = registry.map[action.module];
    if (!module) return { ok: false, code: 'MODULE_GONE', action };
    const out = await module.execute({ ...action.input, actionId, quote: action.quote }, { owner, intentId: action.intentId, actionId });
    const execution = normalizeExecution(out, module.id);
    registry.actions.recordHandoff({ owner, actionId, handoff: execution });
    const memory = applyTurn(memoryFor(owner), { action: { actionId, status: execution.status, module: module.id }, pendingConfirmation: null, at: Date.now() });
    remember(owner, memory);
    await stateStore.write(owner, 'pendingActions', { data: registry.actions.pending(owner), source: 'action-engine', status: 'OK', now: Date.now() });
    await stateStore.write(owner, 'recentActions', { data: registry.actions.recent(owner), source: 'action-engine', status: 'OK', now: Date.now() });
    /* TRANSACTION_PENDING, not TRANSACTION_CONFIRMED: the wallet has taken the
       payload, the chain has not answered yet, and pretending otherwise is how a
       UI ends up showing a swap that did not happen. */
    events?.publish({ type: 'TRANSACTION_PENDING', owner, actionId, intentId: action.intentId, payload: { module: module.id, status: execution.status }, source: 'execution-controller' });
    return { ok: true, action: registry.actions.find(owner, actionId), execution, executed: true };
  }

  async function cancelAction({ owner, actionId, reason }) {
    const registry = registryFor(owner);
    const out = registry.actions.cancel({ owner, actionId, reason });
    remember(owner, applyTurn(memoryFor(owner), { pendingConfirmation: null, at: Date.now() }));
    return out;
  }

  /**
   * The wallet reports what it signed, the brain verifies against the chain and
   * runs the §16 cascade. This is the ONLY place a transaction is treated as
   * done, and the reply that follows carries the refreshed numbers.
   */
  async function reportExecutionResult({ owner, actionId, txHash, chainId = null, status = 'BROADCAST' }) {
    const registry = registryFor(owner);
    if (status === 'REJECTED') {
      registry.actions.transition(registry.actions.find(owner, actionId), 'REJECTED', 'rejected in wallet');
      return { ok: true, status: 'REJECTED', refreshed: [], message: 'no signature, no transaction, no state change — nothing to refresh' };
    }
    const signed = registry.actions.recordSignature({ owner, actionId, txHash, chainId });
    if (!signed.ok) return signed;
    const verified = await registry.actions.verify({ owner, actionId, input: { txHash, chainId } });
    const action = verified.action || signed.action;
    const sections = registry.actions.sectionsToRefresh(action || { module: 'swap' });
    const refreshed = await refreshSections(owner, sections, registry, {});
    const state = stateStore.peek(owner);
    const snapshot = await stateStore.snapshot(owner, { includeData: false });
    return {
      ok: true,
      actionId,
      txHash: txHash || null,
      verification: action?.verification || null,
      status: action?.status || null,
      refreshed: Object.entries(refreshed).map(([key, value]) => ({ key, status: value.status, ageMs: freshness(state, key).ageMs })),
      stateRevision: state.revision,
      sections: snapshot.sections,
      pending: verified.pending === true
    };
  }

  async function directToolCall({ owner, module: moduleId, operation, input = {}, actionId = null }) {
    const registry = registryFor(owner);
    const module = registry.map[moduleId];
    if (!module) return { ok: false, code: 'MODULE_NOT_REGISTERED', module: moduleId };
    if (typeof module[operation] !== 'function') return { ok: false, code: 'OPERATION_NOT_AVAILABLE', module: moduleId, operation };
    /* §33: this endpoint is the AI's hand on the machine, and it must obey the same
       permission ladder as a plan. An EXECUTE through it is only possible against an
       action the user has already confirmed, so no caller — model, script, or
       curious engineer — reaches a signing boundary by calling a tool directly. */
    if (operation === 'execute') {
      const record = actionId ? actions.find(owner, actionId) : null;
      if (!record || record.status !== 'CONFIRMED') {
        return {
          ok: false, status: 'REFUSED_BY_POLICY', code: 'CONFIRMATION_REQUIRED', module: moduleId, operation,
          reason: 'execute is only reachable through an action this user confirmed',
          requiresConfirmation: true, verificationRequired: true
        };
      }
    }
    const state = await stateStore.get(owner);
    const out = await module[operation]({ ...input, wallet: state.sections.wallet?.data }, { owner, walletAddress: state.sections.wallet?.data?.addresses?.evm?.[0] || null });
    /* Only a READ may enter the shared state, and only through the section that
       module owns (moduleForSection maps section → module, so the lookup is
       inverted here). A quote/prepare/simulate result is deliberately NOT written
       back: those are offers, not facts, and the state must never hold an
       un-executed intention as if it had happened. */
    const writeBack = operation === 'read' ? Object.keys(moduleForSection).find((section) => moduleForSection[section] === moduleId) : null;
    if (writeBack && out?.status !== 'UNAVAILABLE' && out?.data != null) {
      await stateStore.write(owner, writeBack, { data: out.data, source: out.source || moduleId, status: out.status === 'PARTIAL' ? 'PARTIAL' : 'OK', now: Date.now() });
    }
    return {
      ok: out?.status === 'OK' || out?.status === 'PARTIAL', module: moduleId, operation,
      status: out?.status, data: out?.data ?? null, reason: out?.reason ?? null,
      source: out?.source || moduleId, at: out?.at || Date.now(),
      permission: { read: PERMISSION.READ, quote: PERMISSION.PREPARE, prepare: PERMISSION.PREPARE, simulate: PERMISSION.PREPARE, execute: PERMISSION.EXECUTE, verify: PERMISSION.READ }[operation],
      actionId: actionId || null,
      requiresConfirmation: operation === 'execute'
    };
  }

  function capabilitiesSnapshot(owner = 'anon') {
    const registry = registryFor(owner);
    return buildCapabilityMatrix(registry.list, cachedHealth);
  }

  return {
    schema: BRAIN_SCHEMA,
    brain: CI_SCHEMA,
    handle,
    confirmAction,
    cancelAction,
    reportExecutionResult,
    directToolCall,
    capabilities: capabilitiesSnapshot,
    registry: registryFor,
    moduleContract: MODULE_CONTRACT_FIELDS,
    health: async (owner) => {
      const registry = registryFor(owner);
      await probeHealth(registry, { force: true });
      return { modules: cachedHealth, sources: healthSnapshot(), at: Date.now() };
    },
    intentsFor: (owner) => (intentLog.get(String(owner || 'anon').slice(0, 80)) || []).slice(0, 10),
    findIntent: (owner, intentId) => (intentLog.get(String(owner || 'anon').slice(0, 80)) || []).find((t) => t.intentId === String(intentId)) || null,
    memoryFor: (owner) => compactMemory(memoryFor(owner)),
    resetMemory: (owner) => memories.delete(`${owner}`),
    errorsFor: (owner) => stateStore.peek(owner).sections.errors.data || [],
    stats: () => ({ ...turns, owners: memories.size, ledger: errorLedger.size(), brain: CI_SCHEMA }),
    resetHealth: () => { for (const k of Object.keys(cachedHealth)) delete cachedHealth[k]; }
  };
}

/* ── step execution ─────────────────────────────────────────────────────── */
/**
 * Runs the plan's PREPARE steps (quote/prepare/simulate) against the registry.
 * Read steps are skipped here because §4 stage reads were already performed in
 * STATE_INSPECTION — running them twice is the "duplicate answers" symptom in
 * miniature, and the second read is what changes the numbers mid-reply.
 */
async function runSteps({ owner, registry, steps, intent, context, state, results, classification, ledger = null }) {
  const out = { results, quote: null, quotes: [], simulation: null, security: [] };
  const entities = classification.entities || {};
  for (const step of steps) {
    if (step.permission === PERMISSION.READ || step.gate) continue;
    if (step.operation === 'confirmation') continue;
    if (step.module === 'session' || step.module === 'registry' || step.module === 'policy') continue;
    const module = registry.map[step.module];
    if (!module) continue;
    const input = bindStepInput(step.input || {}, entities, state, context, owner);
    const call = module[step.operation];
    if (typeof call !== 'function') continue;
    const res = await call(input, { owner, intentId: intent.intentId, context });
    /* A failed step is an ERROR INTELLIGENCE event, not a blank cell in the result
       table (§19). Without this, only a failed STATE read reached the ledger, and a
       reply could claim «the error was recorded» while the ledger held nothing. */
    if (res && res.status !== 'OK' && res.status !== 'PARTIAL' && typeof ledger === 'function') ledger(step, res);
    results[step.id] = {
      status: res.status,
      summary: summarise(step, res),
      data: res.data,
      source: res.source || step.module,
      dataAt: res.at || Date.now(),
      reason: res.reason || null,
      stale: res.status === 'PARTIAL'
    };
    if (step.operation === 'quote' && res.status !== 'UNAVAILABLE') {
      const quote = { ...res.data, at: res.at || Date.now(), source: res.source || step.module, stepId: step.id, module: step.module };
      out.quotes.push(quote);
      if (!out.quote) out.quote = quote;
    }
    if (step.operation === 'simulate' && res.status !== 'UNAVAILABLE') out.simulation = { ...res.data, at: res.at || Date.now() };
    if (step.operation === 'execute' && res.status === 'UNAVAILABLE') out.results[`blocked.${step.id}`] = { status: 'UNAVAILABLE', reason: res.reason };
  }
  return out;
}

/** A step's own template input, if the planner bound anything into it. */
function moneyStepInput(step) {
  return step && typeof step === 'object' && step.input ? step.input : {};
}

function priceOfUsd(state, symbol) {
  if (!symbol) return null;
  const row = state?.sections?.markets?.data?.prices?.[symbol] ?? state?.sections?.markets?.data?.bySymbol?.[symbol] ?? null;
  const fromMarket = usableNumber(row?.priceUsd ?? row?.price ?? row);
  if (fromMarket !== null) return fromMarket;
  const held = (state?.sections?.portfolio?.data?.holdings || []).find((h) => String(h.symbol).toUpperCase() === String(symbol).toUpperCase());
  return usableNumber(held?.priceUsd);
}

function bindStepInput(input = {}, entities, state, context, owner) {
  const out = { ...input };
  /* NOTHING is defaulted into a money request. The previous version fell back to
     'BTC' and 'USDC', so a sentence that named no asset would have quoted a
     specific trade — a plausible, wrong action is the worst possible output of this
     system. A missing field stays missing, and the caller turns it into a precise
     question (§5) instead of a guess. */
  if (out.from === null || out.from === undefined) out.from = entities.fromAsset || entities.asset || context?.page?.selectedAsset || null;
  if (out.to === null || out.to === undefined) out.to = entities.toAsset || (entities.side === 'sell' ? 'USDC' : null) || context?.page?.selectedAsset || null;
  if (out.amountUsd === null || out.amountUsd === undefined) {
    /* A quantity in tokens («۰.۱ بیت‌کوین») becomes USD through the LIVE price that
       the markets section already holds, and a fraction of the book («نصف
       پرتفویم») through the value the wallet read returned. Both are arithmetic on
       read data, which is allowed; inventing a number is not. */
    const unit = priceOfUsd(state, out.from || entities.amount?.asset);
    const qty = usableNumber(entities.amount?.value);
    const share = usableNumber(entities.sharePct);
    const baseForShare = share !== null
      ? (usableNumber((state?.sections?.portfolio?.data?.holdings || []).find((h) => String(h.symbol).toUpperCase() === String(out.from || '').toUpperCase())?.valueUsd)
        ?? usableNumber(state?.sections?.wallet?.data?.totalValueUsd)
        ?? usableNumber(state?.sections?.portfolio?.data?.totalValueUsd))
      : null;
    if (usableNumber(entities.amountUsd) !== null) out.amountUsd = usableNumber(entities.amountUsd);
    else if (qty !== null && unit !== null) out.amountUsd = round(qty * unit, 2);
    else if (share !== null && baseForShare !== null) out.amountUsd = round((baseForShare * share) / 100, 2);
    else out.amountUsd = null;
    if (out.amount == null && qty !== null) out.amount = qty;
  }
  if (out.amount === null || out.amount === undefined) out.amount = usableNumber(entities.amount?.value);
  if (!out.asset) out.asset = entities.asset || context?.page?.selectedAsset || null;
  if (!out.network && entities.network) out.network = entities.network;
  if (!out.amountBasis && out.amountUsd !== null && usableNumber(entities.amountUsd) === null) out.amountBasis = entities.amount?.value != null ? 'token-quantity × live price' : entities.sharePct != null ? `${entities.sharePct}% of read value` : null;
  if (out.shockPct === undefined && entities.percent) out.shockPct = -(Math.abs(Number(entities.percent)) || 30);
  if (!out.owner) out.owner = owner;
  return out;
}

function summarise(step, res) {
  const d = res.data || {};
  switch (step.id) {
    case 'swap.quote': return d.expectedOut !== undefined ? `${round(d.amountUsd, 2)} ${d.fromAsset} → ${round(d.expectedOut, 6)} ${d.toAsset} via ${d.provider || 'aggregator'}` : 'quote unavailable';
    case 'bridge.quote': return d.expectedOut !== undefined ? `${round(d.amountUsd, 2)} USD ${d.asset} → chain ${d.toChain} (${d.estimatedSeconds ?? '?'}s est.)` : 'bridge quote unavailable';
    default: break;
  }
  if (res.status === 'UNAVAILABLE') return `unavailable: ${res.reason || 'source refused'}`;
  if (step.id.startsWith('risk')) return `${d.level || 'unknown'} risk from ${Array.isArray(d.factors) ? d.factors.length : 0} factors`;
  if (step.module === 'lending' || step.module === 'borrowing') return d.healthFactor !== undefined ? `HF ${d.healthFactor ?? 'unreadable'}, debt ${d.debtUsd ?? '—'} USD` : 'position read';
  return `${step.operation} ok`;
}

/* ── findings for the recommendation engine ───────────────────────────── */
/* The findings engines emit English for logs and English-only replies would be the
   old bug in reverse, so every finding is rendered a second time in Persian from
   its OWN structured fields. Rendering from the numbers rather than translating the
   sentence is the point: a translated string can drift away from the value, and a
   Persian reply quoting a different figure than the log is the failure this whole
   layer exists to remove. */
const FA_LEVEL = { HIGH: 'بالا', ELEVATED: 'افزایشی', MODERATE: 'متوسط', LOW: 'پایین', WATCH: 'نیازمند توجه', CRITICAL: 'بحرانی', MISSING: 'ناخوانا', UNKNOWN: 'نامعلوم', OK: 'معمولی' };
const FA_CODE_FALLBACK = {
  NO_WALLET_ADDRESS: 'نشانی کیف پول در این نشست ثبت نشده است',
  NO_HOLDINGS: 'هیچ دارایی‌ای برای محاسبه خوانده نشد',
  NO_USD_VALUATIONS: 'قیمت دلاری برای دارایی‌ها خوانده نشد',
  NO_QUOTE_FROM_ANY_PROVIDER: 'هیچ ارائه‌دهنده‌ای نرخ نداد',
  CHAIN_UNSUPPORTED: 'این شبکه در FBT پشتیبانی نمی‌شود',
  TOKEN_NOT_ALLOWLISTED: 'این توکن در فهرست مجاز نیست',
  SOURCE_UNAVAILABLE: 'منبع داده پاسخ نداد',
  SOURCE_NOT_WIRED: 'این ماژول هنوز به منبع داده وصل نشده است',
  FEATURE_GATED: 'این قابلیت هنوز ساخته نشده و ثبت آن در رجیستری با وضعیت UNAVAILABLE است',
  AMOUNT_UNDETERMINED: 'مبلغ مشخص نبود و حدسی زده نشد',
  NO_DATA: 'داده‌ای خوانده نشد',
  PRICE_UNAVAILABLE: 'قیمت خوانده نشد',
  NETWORKS_REQUIRED: 'شبکهٔ مبدأ و مقصد لازم است',
  NOT_ENOUGH_DATA: 'دادهٔ کافی برای محاسبه وجود ندارد'
};

function faNum(v, max = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  try { return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: n < 1 ? 6 : max }).format(n); } catch { return String(n); }
}
const faUsd = (v) => (Number.isFinite(Number(v)) ? `${faNum(v)} دلار` : 'ناخواند');
const faPct = (v) => (Number.isFinite(Number(v)) ? `${faNum(v)}٪` : 'ناخواند');

function findingCopy(f) {
  if (!f) return null;
  if (f.status === 'UNAVAILABLE' || f.status === 'PARTIAL_MISSING') {
    /*
     * A CODE IS VOCABULARY; A SENTENCE IS NOT.
     *
     * The reason used to be sliced straight into the Persian fallback, so a
     * reply said «این بخش محاسبه نشد (the yields source returned nothing
     * usable)» — an English clause inside a Persian sentence, which is exactly
     * what a named refusal is supposed to avoid.
     *
     * So only an ALL-CAPS token is ever quoted: that is the machine's own
     * vocabulary (NO_YIELD_DATA, ROUTE_REQUEST_INCOMPLETE) and it is the same
     * token the logs carry, so it is useful rather than decorative. The old
     * split only found a code at the START of the reason, and most reasons
     * start with a lowercase word, so almost nothing matched. When there is no
     * code at all, the sentence simply says the section was not computed —
     * less text, and none of it in the wrong language.
     */
    const reasonText = String(f.reason || '');
    const code = String(f.code || (reasonText.match(/\b[A-Z][A-Z0-9_]{2,}\b/) || [])[0] || '');
    const human = code ? humanizeError({ code, module: f.id }, { locale: 'fa' }) : null;
    const named = human?.userMessage || FA_CODE_FALLBACK[code] || null;
    return {
      detail: named
        ? (code && !named.includes(code) ? `${named} (${code})` : named)
        : (code ? `این بخش محاسبه نشد (${code})` : 'این بخش محاسبه نشد'),
      reason: null
    };
  }
  switch (f.id) {
    case 'concentration':
      return {
        detail: `${f.asset} = ${faPct(f.sharePct)} از سرمایهٔ پرریسک (${(f.rows && f.rows.length) || 2} داراییِ قیمت‌شده)`,
        reason: f.level === 'HIGH' || f.level === 'ELEVATED'
          ? `یک دارایی ${faPct(f.sharePct)} از بودجهٔ ریسک را نگه داشته؛ شاخص HHI برابر ${faNum(f.hhi, 3)} است`
          : `دارایی غالبی وجود ندارد؛ بیشترین سهم ${faPct(f.sharePct)} است`
      };
    case 'concentration-share':
      return { detail: `بیشترین سهم: ${f.asset} با ${faPct(f.sharePct)} از سرمایهٔ پرریسک`, reason: f.reason ? `${f.asset} ${faPct(f.sharePct)} از ریسک و ${faPct(f.shareOfPortfolioPct)} از کل پرتفوی` : null };
    case 'exposure':
      return { detail: `خالص ${faUsd(f.netExposureUsd)}، ناخالص ${faUsd(f.grossExposureUsd)}، اهرم ترکیبی ${faNum(f.leverage, 2)}×`, reason: f.leverage > 1.5 ? `اهرم ترکیبی ${faNum(f.leverage, 2)}× در مجموع venues از باند راحت بالاتر است` : 'اهرمی فراتر از خودِ وثیقه نیست' };
    case 'asset-intelligence':
      return {
        detail: `${f.asset} اکنون ${faNum(f.price)} دلار؛ تغییر ۲۴ ساعت ${faPct(f.change24hPct)}${f.volatilityPct != null ? `، نوسان روزانه ${faPct(f.volatilityPct)}` : ''}${f.signal ? `، سیگنال ${f.signal.direction === 'bullish' ? 'صعودی' : f.signal.direction === 'bearish' ? 'نزولی' : 'خنثی'}` : ''}`,
        reason: f.missing && f.missing.length ? `اجزایی که برای جمع‌بندی خوانده نشد: ${f.missing.map((m) => ({ price: 'قیمت', funding: 'نرخ فاندینگ', volatility: 'نوسان', signal: 'سیگنال', news: 'اخبار', '24h change': 'تغییر ۲۴ ساعته' }[m] || m)).join('، ')}` : 'قیمت، سیگنال، اخبار و نوسان همه برای همین دارایی خوانده شد'
      };
    case 'market-overview': {
      const b = f.breadth || {};
      const movers = (list) => (list || []).slice(0, 3).map((r) => `${r.symbol} ${faPct(r.change24hPct ?? r.change24h)}`).join('، ');
      return {
        detail: `ارزش کل ${faUsd(b.totalMarketCapUsd)}، تغییر ۲۴ ساعته ${faPct(b.marketCapChange24hPct)}، دامنهٔ بیت‌کوین ${faPct(b.btcDominancePct)}`,
        reason: `${movers(f.gainers) ? `صعودی‌ها: ${movers(f.gainers)}` : ''}${movers(f.losers) ? `${movers(f.gainers) ? ' | ' : ''}نزولی‌ها: ${movers(f.losers)}` : ''}` || 'فقط ranks خوانده شد'
      };
    }
    case 'news-digest':
      return { detail: `${faNum(f.count, 0)} تیتر از ${f.source || 'news-engine'}`, reason: 'تیتر و زمان انتشار عیناً نقل شده‌اند؛ تفسیری افزوده نشده است' };
    case 'quote':
      return {
        detail: `${faNum(f.amountIn, 6)} ${f.fromAsset || ''} → ${faNum(f.received, 4)} ${f.toAsset || ''}${f.provider ? ` (از ${f.provider})` : ''}`,
        reason: `نرخ از ${f.provider || 'تجمیع‌کننده'}؛ ${f.priceImpactPct != null ? `اثر قیمتی ${faPct(f.priceImpactPct)}` : 'اثر قیمتی اعلام نشده'}${f.feeUsd != null ? ` و هزینهٔ تقریبی ${faUsd(f.feeUsd)}` : ''}`
      };
    case 'health-factor':
      return {
        detail: `فاکتور سلامت ${faNum(f.healthFactor, 3)}، وثیقه ${faUsd(f.collateral)}، بدهی ${faUsd(f.debt)}`,
        reason: f.distancePct != null ? `افت ${faPct(f.distancePct)} در وثیقه شما را به لیکوئیداسیون می‌رساند` : 'بدهی بازوجود ندارد'
      };
    case 'borrow-capacity':
      return {
        detail: `سقف نظری ${faUsd(f.capacityUsdByLtv)}، مبلغ قابل‌اتکا با کف سلامت ${faUsd(f.safeUsd)}`,
        reason: 'کف فاکتور سلامت، نه سقف LTV، مبلغی را که اجرا می‌کنیم محدود می‌کند'
      };
    case 'whatif':
      return {
        detail: `${faPct(f.shockPct)} ⇒ ارزش ${faUsd(f.afterUsd)}${f.liquidations ? ` و ${faNum(f.liquidations, 0)} موقعیت در آستانهٔ لیکوئیداسیون` : ''}`,
        reason: f.liquidations ? `${faNum(f.liquidations, 0)} موقعیت در این حرکت لیکوئید می‌شود؛ تصمیم کاهش ریسک برای الان است، نه بعد از آن` : 'در این اندازهٔ حرکت، هیچ موقعیتی لیکوئید نمی‌شود'
      };
    case 'goal-feasibility':
      return {
        detail: `شانس ${faPct(f.probabilityPct)} با سپردهٔ ماهانهٔ ${faUsd(f.contribution)}`,
        reason: `نرخ رشد لازم ${faPct(f.requiredCagrPct)} — این خروجی مدل است، نه پیش‌بینی بازار`
      };
    case 'opportunities':
      return { detail: `${faNum((f.candidates || []).length, 0)} استخر واجد شرایط؛ بهترین ${faPct(f.candidates?.[0]?.aprPct)} APR`, reason: f.candidates?.[0] ? `استخر برتر با ${faPct(f.candidates[0].aprPct)} و ریسک پروتکل ${f.candidates[0].riskLevel || '—'}` : 'هیچ استخری کف اهلیت را رد نکرد' };
    case 'risk':
      return { detail: `سطح ${FA_LEVEL[String(f.detail || '').split(' ')[0].toUpperCase()] || f.level || '—'} از ${faNum((f.factors || []).length, 0)} عامل محاسبه‌شده`, reason: null };
    case 'instrument-access':
      return {
        detail: f.venue
          ? (f.status === 'OK' ? `${f.venue.toUpperCase()} از طریق ماژول ${f.readFrom || f.venue} خوانده می‌شود` : `«${f.venue}» در رجیستری با وضعیت ${f.capability} ثبت شده است؛ از FBT Swap قابل اجرا نیست`)
          : 'ابزار مشخصی در جمله نام برده نشد، پس چیزی فرض نشد',
        reason: f.status === 'OK' ? 'خروجی همان venue نقل می‌شود، نه تفسیر آن' : 'مغز مرکزی ادعای مسیری را نمی‌کند که وجود ندارد (§8)؛ آنچه هست: ' + ((f.offered || []).join('، ') || 'هیچ ماژول خواندنی برای این ابزار ثبت نشده')
      };
    default:
      return null;
  }
}

/**
 * THE WHY FINDING — built AFTER the why read, not before it.
 *
 * This block used to live inside `buildFindings`, and that was the
 * ordering that made the why engine dark.
 *
 * The why engine explains the brain's RECOMMENDATION. The
 * recommendation is built from the findings. So the why read has to
 * happen after the recommendation exists — and the finding that carries
 * the explanation has to be built after the read. Putting the finding
 * inside `buildFindings` meant it was built BEFORE both, so it could
 * only ever see a read that had not happened, and the reply carried
 * NO_DECISION even when the engine was mounted and the owner had a
 * decision.
 *
 * It is a separate function now, called after the read, and it is the
 * read that counts: the one made with the recommendation in hand.
 */
function buildWhyFinding({ intent, results, readResults, findings, locale = 'en' }) {
  if (intent.intentType !== 'WHY_DECISION') return null;
  const whyRead = results['why.read'] || readResults.whyDecision || null;
  if (whyRead?.status === 'OK' && whyRead.data?.why) {
    const w = whyRead.data.why;
    const lines = [];
    for (const [key, value] of Object.entries(w.why || {})) {
      if (Array.isArray(value) && value.length) lines.push(...value.map((v) => String(v)));
    }
    const falsifiers = (w.falsifiers || []).map((f) => ({
      id: f.id ?? null,
      question: f.question ?? null,
      threshold: f.threshold ?? null,
      modelledImpactUsd: f.modelledImpactUsd ?? null,
      action: f.action ?? null,
      invalidates: f.invalidates ?? null
    }));
    findings.push({
      id: 'why-decision',
      status: 'OK',
      why: w.why || null,
      lines: lines.slice(0, 10),
      falsifiers,
      invalidationConditions: w.invalidationConditions || [],
      decisionId: w.decisionId ?? null,
      confidence: w.confidence ?? null,
      nextReviewAt: w.nextReviewAt ?? null,
      reviewWindowDays: w.reviewWindowDays ?? null,
      estimate: w.estimate === true,
      detail: lines.length
        ? `${lines.length} reason line(s) from the decision that was actually made; ${falsifiers.length} named falsifier(s) and ${(w.invalidationConditions || []).length} invalidation condition(s) travel with it`
        : 'the engine produced the why block but no readable reason line — nothing is filled in',
      reason: w.note || 'every because-line points at a number in the decision bundle; unread numbers are named, never invented',
      /* The falsifiers are the point of a why block: an explanation that
         cannot be contradicted is not an explanation. So the count travels in
         both languages, and the first reason line — which the engine wrote for
         the user — is quoted rather than paraphrased. */
      detailFa: lines.length
        ? `${fmtNum(lines.length, locale === 'fa')} خط دلیل از همان تصمیمی که واقعاً گرفته شد؛ ${fmtNum(falsifiers.length, locale === 'fa')} ابطال‌کنندهٔ نام‌دار و ${fmtNum((w.invalidationConditions || []).length, locale === 'fa')} شرط ابطال همراه آن می‌آید`
        : 'موتور بلوک «چرا» را ساخت ولی هیچ خط دلیل خواندنی‌ای نبود — چیزی هم جای آن پر نشد',
      reasonFa: lines.length && lines[0]?.text
        ? String(lines[0].text)
        : 'هر خط «چون» به یک عدد در همان بستهٔ تصمیم اشاره می‌کند؛ عددهای خوانده‌نشده نام برده می‌شوند، نه ساخته',
      source: 'why-engine',
      dataAt: w.at || Date.now(),
      partial: false
    });
    return findings[findings.length - 1];
  }
  if (whyRead?.status === 'UNAVAILABLE') {
    findings.push({
      id: 'why-decision',
      status: 'UNAVAILABLE',
      detail: null,
      reason: whyRead.reason === 'NO_DECISION'
        ? 'there is no decision to explain — the last turn produced no recommendation, so there is nothing to justify and nothing is invented'
        : `the why engine could not be read (${whyRead.reason || 'NO_DATA'})`,
      source: 'why-engine',
      partial: true
    });
    return findings[findings.length - 1];
  }
  return null;
}

/*
 * The fit engine's own vocabulary, in Persian.
 *
 * These are the engine's WORDS, not a paraphrase: the verdict it returned and
 * the tolerance it read. Translating a three-word enum is safe; translating a
 * sentence the engine wrote is how a reason turns into a rumour.
 */
const FIT_VERDICT_FA = Object.freeze({
  FITTED: 'مناسب',
  CONDITIONAL: 'مشروط',
  NOT_FITTED: 'نامناسب',
  UNRANKED: 'رتبه‌بندی‌نشده'
});
/* The scenario engine's own three profiles, in Persian — its vocabulary, not a
   paraphrase of a sentence it wrote. */
/* The engines' risk vocabulary, in Persian. Same rule as the two maps below:
   these are the ENGINE's words, so translating them is safe. */
const RISK_LEVEL_FA = Object.freeze({
  LOW: 'پایین', MODERATE: 'متوسط', MEDIUM: 'متوسط',
  ELEVATED: 'افزایش‌یافته', HIGH: 'بالا', CRITICAL: 'بحرانی'
});
const SCENARIO_PROFILE_FA = Object.freeze({
  CONSERVATIVE: 'محافظه‌کار',
  BALANCED: 'متعادل',
  AGGRESSIVE: 'پرریسک',
  GROWTH: 'رشد'
});
const FIT_TOLERANCE_FA = Object.freeze({
  conservative: 'محافظه‌کار',
  balanced: 'متعادل',
  moderate: 'متعادل',
  aggressive: 'پرریسک',
  growth: 'رشد'
});

function buildFindings({ intent, classification, state, results, risk, readResults, stepResults, context, locale = 'en', lastReplan = null }) {
  const findings = [];
  const portfolio = state.sections.portfolio.data;
  const markets = state.sections.markets.data;
  const lendingSection = state.sections.lending.data;

  /*
   * ─── THE CORPUS FINDING (2026-11-12) ───────────────────────────────────
   *
   * When the registry did not match but the verified corpus could answer,
   * the brain already holds the answer on the intent (`intent.corpusAnswer`).
   * The recommendation is built from FINDINGS, so without this the answer
   * would be carried by the intent and never reach the reply.
   *
   * It is a finding like any other: it carries its source and its reason, so
   * the composer attributes it and the user can see that it was RETRIEVED
   * rather than generated. The section it produces is a `result` — the
   * headline — because that is what it is: the answer to the question.
   */
  /*
   * A GENERATED answer, labelled as one. The corpus finding above says
   * «retrieved, not generated»; this one says the opposite, because the
   * difference is the whole point: a retrieved fact carries a citation and
   * cannot drift, a generated one can. The user must always be able to tell
   * which they received.
   */
  if (intent?.modelAnswer) {
    findings.push({
      id: 'model-answer',
      value: intent.modelAnswer,
      detail: intent.modelAnswer,
      detailFa: intent.modelAnswer,
      reason: locale === 'fa'
        ? `تولیدشده توسط ${intent.modelProvider || 'مدل'} — تولید، نه بازیابی`
        : `generated by ${intent.modelProvider || 'the model'} — generated, not retrieved`,
      reasonFa: locale === 'fa'
        ? `تولیدشده توسط ${intent.modelProvider || 'مدل'} — تولید، نه بازیابی`
        : `generated by ${intent.modelProvider || 'the model'} — generated, not retrieved`,
      source: intent.modelProvider || 'model',
      dataAt: Date.now(),
      status: 'OK'
    });
  }

  if (intent?.corpusAnswer) {
    findings.push({
      id: intent.corpusMatch || 'kb.verified',
      value: intent.corpusAnswer,
      detail: intent.corpusAnswer,
      detailFa: intent.corpusAnswer,
      reason: locale === 'fa'
        ? `از دانش تاییدشدهٔ محصول بازیابی شد (${intent.corpusMatch || 'kb'}) — بازیابی، نه تولید`
        : `retrieved from the verified product corpus (${intent.corpusMatch || 'kb'}) — retrieved, not generated`,
      reasonFa: locale === 'fa'
        ? `از دانش تاییدشدهٔ محصول بازیابی شد (${intent.corpusMatch || 'kb'}) — بازیابی، نه تولید`
        : `retrieved from the verified product corpus (${intent.corpusMatch || 'kb'}) — retrieved, not generated`,
      source: intent.corpusSource || 'verified-knowledge',
      label: intent.corpusTitle || null,
      dataAt: Date.now(),
      status: 'OK'
    });
  }

  /*
   * ─── THE WALLET BALANCES (2026-11-13) ──────────────────────────────────
   *
   * «موجودی من چقدره؟» read the wallet and then said «wallet.read: 2
   * balances across 2 chain(s)». The NUMBER was there — `totalValueUsd`,
   * every `amount`, every `valueUsd` — and the reply showed none of it.
   *
   * A count is not a balance. The user asked how much they have, and
   * the answer said how many rows were read.
   *
   * This matters beyond the one-part question: it is the second half of
   * «قیمت بیت‌کوین چقدره و موجودی من چقدره», so while it was missing
   * the compound question could not be answered in full either.
   */
  const walletRead = readResults?.wallet?.data || state.sections?.wallet?.data || null;
  if (walletRead && (Array.isArray(walletRead.balances) || walletRead.totalValueUsd != null)) {
    const balances = Array.isArray(walletRead.balances) ? walletRead.balances : [];
    const total = walletRead.totalValueUsd != null
      ? Number(walletRead.totalValueUsd)
      : balances.reduce((sum, b) => sum + (Number(b?.valueUsd) || 0), 0);
    const rows = balances
      .filter((b) => b && (b.amount != null || b.valueUsd != null))
      .map((b) => ({
        symbol: b.symbol || null,
        amount: b.amount != null ? Number(b.amount) : null,
        valueUsd: b.valueUsd != null ? Number(b.valueUsd) : null,
        chainId: b.chainId ?? null
      }));
    findings.push({
      id: 'wallet-balances',
      value: total,
      totalUsd: total,
      rows,
      rowCount: rows.length,
      chainCount: Array.isArray(walletRead.chainsRead) ? walletRead.chainsRead.length : null,
      detail: rows.length
        ? `${rows.length} asset(s) across ${Array.isArray(walletRead.chainsRead) ? walletRead.chainsRead.length : '?'} chain(s); total $${round(total, 2)}`
        : `no priced balance; total $${round(total, 2)}`,
      reason: rows.length
        ? `the wallet returned ${rows.length} balance(s); the total is the sum of their USD values`
        : 'the wallet returned no priced balance to total',
      /* A finding with no Persian voice is rendered in English inside a
         Persian reply — the `reason` section showed «the wallet returned 2
         balance(s)» next to «یک دارایی ۱۰۰٪ از بودجهٔ ریسک». The convention
         in this codebase is `detailFa`/`reasonFa` beside the English pair,
         and the numbers come from the SAME formatter the recommendation
         engine uses, so one turn cannot quote the total two ways. */
      detailFa: rows.length
        ? `${fmtNum(rows.length, locale === 'fa')} دارایی در ${fmtNum(Array.isArray(walletRead.chainsRead) ? walletRead.chainsRead.length : null, locale === 'fa')} شبکه؛ مجموع ${fmtUsd(total, locale === 'fa')}`
        : `موجودی قیمت‌گذاری‌شده‌ای نبود؛ مجموع ${fmtUsd(total, locale === 'fa')}`,
      reasonFa: rows.length
        ? `کیف پول ${fmtNum(rows.length, locale === 'fa')} موجودی برگرداند و مجموع، جمع ارزش دلاری همان‌هاست`
        : 'کیف پول موجودی قیمت‌گذاری‌شده‌ای برای جمع زدن برنگرداند',
      source: 'wallet-service',
      dataAt: walletRead.at || Date.now(),
      status: rows.length || total ? 'OK' : 'PARTIAL'
    });
  }

  const concentration = analyzeConcentration(portfolio);
  if (concentration.status === 'OK') {
    findings.push({
      id: 'concentration', value: concentration.topSharePct, asset: concentration.topAsset, sharePct: concentration.topSharePct,
      shareOfPortfolioPct: concentration.topShareOfPortfolioPct, top3SharePct: concentration.top3SharePct, hhi: concentration.hhi, level: concentration.level,
      detail: `${concentration.topAsset} = ${concentration.topSharePct}% of risk capital (${concentration.rows.length} valued holdings)`, rowCount: concentration.rows.length,
      source: 'portfolio-service + market-data', dataAt: concentration.at,
      reason: concentration.level === 'HIGH' || concentration.level === 'ELEVATED'
        ? `one asset carries ${concentration.topSharePct}% of the risk budget; the HHI is ${concentration.hhi}`
        : `no single asset dominates: top share is ${concentration.topSharePct}%`
    });
  } else findings.push({ id: 'concentration', status: 'UNAVAILABLE', reason: `concentration not computable: ${concentration.reason}`, detail: null });

  const exposure = analyzeExposure({ portfolio, lending: lendingSection, futures: state.sections.futures.data, dydx: state.sections.dydx.data, farming: state.sections.farming.data, liquidity: state.sections.liquidity.data });
  if (exposure.status === 'OK') findings.push({ id: 'exposure', equityUsd: exposure.equityUsd, leverage: exposure.leverageRatio, leverageRatio: exposure.leverageRatio, debtUsd: exposure.debtUsd, grossUsd: exposure.grossExposureUsd, grossExposureUsd: exposure.grossExposureUsd, netExposureUsd: exposure.netExposureUsd, missingSources: exposure.missingSources || [], detail: `net ${exposure.netExposureUsd} USD, gross ${exposure.grossExposureUsd} USD, combined leverage ${exposure.leverageRatio}×`, reason: exposure.leverageRatio > 1.5 ? `combined leverage ${exposure.leverageRatio}× across venues is above the comfort band` : 'no leverage beyond the collateral itself', source: 'portfolio + lending + futures', dataAt: exposure.at });

  if (['LOAN_STATUS', 'BORROW_CAPACITY'].includes(intent.intentType)) {
    const position = Array.isArray(lendingSection?.positions) ? lendingSection.positions[0] : lendingSection;
    if (position) {
      const safety = assessLendingSafety({ position, oracle: lendingSection?.oracle });
      if (safety.status === 'OK') findings.push({ id: 'health-factor', healthFactor: safety.healthFactor, distancePct: safety.distanceToLiquidationPct, level: safety.level, collateral: safety.collateralUsd, debt: safety.debtUsd, apr: safety.borrowAprPct, detail: `collateral ${safety.collateralUsd} USD, debt ${safety.debtUsd} USD, HF ${safety.healthFactor}`, reason: safety.hasDebt ? `a ${safety.distanceToLiquidationPct}% move in collateral reaches liquidation` : 'no outstanding debt', source: 'lending-protocol', dataAt: safety.at });
      if (intent.intentType === 'BORROW_CAPACITY') {
        const capacity = computeBorrowCapacity({ position: { collateralUsd: position.collateralUsd, debtUsd: position.debtUsd, ltv: position.ltv ? position.ltv : lendingSection.ltvPct ? lendingSection.ltvPct / 100 : null } });
        if (capacity.status === 'OK') findings.push({ id: 'borrow-capacity', capacityUsd: capacity.capacityUsdByLtv, safeUsd: capacity.capacityUsdRespectingFloor, detail: `LTV ceiling ${capacity.capacityUsdByLtv} USD, health-factor-capped ${capacity.capacityUsdRespectingFloor} USD`, reason: capacity.bindingConstraint === 'health-factor floor' ? 'the health-factor floor, not the LTV ceiling, limits what we will act on' : 'LTV is the binding constraint', source: 'lending-protocol', dataAt: capacity.at });
      }
    } else findings.push({ id: 'lending-safety', status: 'UNAVAILABLE', reason: `the protocol position could not be read (${lendingSection?.reason || readResults.lending?.reason || 'NO_DATA'})`, detail: null });
  }

  if (intent.intentType === 'WHATIF_SIMULATION' || context.followUp.kind === 'QUERY_LAST_ASSET') {
    const shock = stepResults.simulation?.deltaUsd !== undefined ? stepResults.simulation : simulateShock({ portfolio, lending: lendingSection, futures: state.sections.futures.data, dydx: state.sections.dydx.data }, Math.abs(Number(classification.entities.percent) || 30) * -1);
    if (shock.status === 'OK') findings.push({ id: 'whatif', value: `−${Math.abs(shock.shockPct)}% ⇒ ${shock.valueAfterUsd} USD`, shockPct: shock.shockPct, beforeUsd: shock.valueBeforeUsd, afterUsd: shock.valueAfterUsd, liquidations: shock.liquidation.count, detail: `${shock.valueBeforeUsd} → ${shock.valueAfterUsd} USD, ${shock.liquidation.count} position(s) liquidated, ${shock.nearLiquidation.count} near it`, reason: shock.liquidation.count ? `${shock.liquidation.count} position(s) would be liquidated at this move — the deleverage decision is now, not then` : 'no position liquidates at this move', source: 'lab + portfolio-service', dataAt: shock.at });
  }

  if (intent.intentType === 'GOAL_PLAN' || intent.intentType === 'PROFIT_PLAN') {
    const goal = state.sections.goals.data?.goals?.[0] || null;
      /* The goal is read through ONE reader, so the brain and the goals
         module cannot disagree about which shape the goal has. */
      const goalInputs = readGoalInputs(goal);
      const feasibility = goalFeasibility({
        currentUsd: classification.entities.currentUsd ?? goalInputs.currentUsd ?? portfolio?.totalValueUsd ?? null,
        targetUsd: classification.entities.targetUsd ?? goalInputs.targetUsd ?? null,
        years: classification.entities.horizon?.years ?? goalInputs.years ?? null,
        monthlyContributionUsd: goalInputs.monthlyContributionUsd,
        volatilityPct: markets?.volatilityPct?.BTC ?? 60
      });
    if (feasibility.status === 'OK') findings.push({ id: 'goal-feasibility', targetUsd: feasibility.targetUsd, years: feasibility.years, probabilityPct: feasibility.probabilityPct, contribution: feasibility.contributionUsdMonthly, requiredContribution: feasibility.requiredContributionUsdMonthly, detail: `${feasibility.probabilityPct}% odds at ${feasibility.contributionUsdMonthly} USD/month; median ${feasibility.projectedMedianUsd} USD`, reason: `required CAGR is ${feasibility.requiredCagrPct}% — ${feasibility.level.toLowerCase()} for this horizon, and it is a model output, not a forecast`, source: 'goals-engine + market-data', dataAt: feasibility.at, partial: feasibility.status === 'PARTIAL' });
    else findings.push({ id: 'goal-feasibility', status: 'UNAVAILABLE', reason: `goal arithmetic incomplete: ${feasibility.reason}`, detail: null });
    const opportunities = scanOpportunities({ yields: state.sections.farming.data, portfolio, risk, capabilities: {} });
    if (opportunities.status === 'OK') findings.push({ id: 'opportunities', candidates: opportunities.rows, detail: `${opportunities.rows.length} eligible pools, best ${opportunities.rows[0]?.aprPct ?? '—'}% APR`, reason: opportunities.rows[0] ? `the top eligible pool pays ${opportunities.rows[0].aprPct}% with ${opportunities.rows[0].riskLevel} protocol risk` : 'nothing met the eligibility floor', source: 'yields-engine', dataAt: opportunities.at });

    /*
     * The three profiles (path 13). The feasibility figure above answers
     * "can this target be reached"; the scenarios answer "what does the
     * road look like, and how likely is each version of it to arrive".
     *
     * Each profile carries its drawdown and its probability of loss, and
     * the engine says `estimate: true` — a modelled distribution over a
     * chosen return, not a promise. The finding carries the flag, so the
     * answer cannot be read as a forecast.
     */
    const scenarioRead = readResults.goalScenarios;
    if (scenarioRead?.status === 'OK' && scenarioRead.data) {
      const sc = scenarioRead.data;
      const profiles = Array.isArray(sc.scenarios) ? sc.scenarios : [];
      if (profiles.length) {
        const recommended = profiles.find((r) => r.profile === (sc.recommended?.profile || sc.recommended)) || sc.recommended || null;
        findings.push({
          id: 'goal-scenarios',
          status: 'OK',
          profiles: profiles.map((r) => ({
            profile: r.profile,
            expectedReturnPct: r.expectedReturnPct ?? null,
            expectedValueUsd: r.expectedValueUsd ?? null,
            maxDrawdownPct: r.maxDrawdownPct ?? null,
            probabilityOfLossPct: r.probabilityOfLossPct ?? null,
            probabilityOfHalvingPct: r.probabilityOfHalvingPct ?? null,
            allocation: r.allocation ?? null,
            p10: r.percentiles?.p10 ?? null,
            p50: r.percentiles?.p50 ?? null,
            p90: r.percentiles?.p90 ?? null
          })),
          recommended: recommended?.profile || null,
          targetUsd: sc.targetUsd ?? null,
          startUsd: sc.startUsd ?? null,
          months: sc.months ?? null,
          detail: `${profiles.length} profiles from ${sc.startUsd ?? '—'} USD over ${sc.months ?? '—'} month(s) toward ${sc.targetUsd ?? '—'} USD; the recommended one is ${recommended?.profile || 'none'}${recommended?.maxDrawdownPct != null ? ` with a ${recommended.maxDrawdownPct}% modelled drawdown` : ''}`,
          reason: recommended
            ? `${recommended.profile} is the recommended profile: ${recommended.expectedReturnPct ?? '—'}% modelled return with a ${recommended.probabilityOfLossPct ?? '—'}% modelled probability of loss — a model over a chosen return, not a forecast`
            : 'the profiles were built but the engine recommended none; the reason travels with the numbers',
          /* The qualifier «a model over a chosen return, not a forecast» is the
             honest half of this finding — it is what keeps a modelled 12%
             reading as a promise. It has to survive translation, and the
             numbers come from the same formatter the headline uses. */
          detailFa: `${fmtNum(profiles.length, locale === 'fa')} پروفایل از ${fmtUsd(sc.startUsd, locale === 'fa')} در ${fmtNum(sc.months, locale === 'fa')} ماه به سمت ${fmtUsd(sc.targetUsd, locale === 'fa')}${recommended ? `؛ پیشنهادی ${SCENARIO_PROFILE_FA[String(recommended.profile || '').toUpperCase()] || recommended.profile} است` : ''}${recommended?.maxDrawdownPct != null ? ` با افت مدل‌شدهٔ ${fmtNum(recommended.maxDrawdownPct, locale === 'fa')}٪` : ''}`,
          reasonFa: recommended
            ? `${SCENARIO_PROFILE_FA[String(recommended.profile || '').toUpperCase()] || recommended.profile} پروفایل پیشنهادی است: بازده مدل‌شدهٔ ${fmtNum(recommended.expectedReturnPct, locale === 'fa')}٪ با احتمال زیان مدل‌شدهٔ ${fmtNum(recommended.probabilityOfLossPct, locale === 'fa')}٪ — یک مدل روی بازده انتخابی، نه پیش‌بینی`
            : 'پروفایل‌ها ساخته شدند ولی موتور هیچ‌کدام را پیشنهاد نکرد؛ دلیل همراه همان عددها می‌آید',
          estimate: sc.estimate === true,
          source: 'goal-scenarios-engine',
          dataAt: sc.at || Date.now(),
          partial: false
        });
      }
    } else if (scenarioRead?.status === 'UNAVAILABLE' && scenarioRead.reason === 'NO_STARTING_CAPITAL') {
      findings.push({
        id: 'goal-scenarios',
        status: 'UNAVAILABLE',
        detail: null,
        reason: 'a scenario needs real capital; nothing was modelled and nothing was guessed',
        reasonFa: 'سناریو به سرمایهٔ واقعی نیاز دارد؛ هیچ چیزی مدل نشد و هیچ چیزی هم حدس زده نشد',
        source: 'goal-scenarios-engine',
        partial: true
      });
    }
  }

  /*
   * ── THE REPLAN SURFACE (path 16) ─────────────────────────────────────────
   *
   * The event-replanning engine listens on the central bus and re-plans
   * when the world moves under a plan: a price changed, a balance
   * changed, the risk level moved, a module degraded. It has cooldowns
   * per trigger family, so a busy market does not produce a replan
   * storm.
   *
   * The finding is what makes the machine's decision VISIBLE. It carries:
   *
   *   · what CHANGED — the macro impulse, the risk level, the council's
   *     decision, whether a guardian line was crossed;
   *   · whether the owner should be TOLD. A replan that changed nothing
   *     decision-relevant is recorded and not announced: a notification
   *     for every price tick is how an alert stream becomes noise.
   *   · the fact that NO execution was authorised by the replan. The
   *     machine reconsiders; it never acts.
   */
  if (lastReplan && lastReplan.notify === true) {
    const changed = lastReplan.changed || {};
    findings.push({
      id: 'event-replan',
      status: 'OK',
      trigger: lastReplan.trigger ?? null,
      family: lastReplan.family ?? null,
      label: lastReplan.label ?? null,
      changed,
      impulse: lastReplan.impulse ?? null,
      riskLevel: lastReplan.riskLevel ?? null,
      council: lastReplan.council ?? null,
      recommendation: lastReplan.recommendation ?? null,
      executionAuthorized: false,
      at: lastReplan.at ?? null,
      detail: `${lastReplan.label || lastReplan.trigger || 'an event'} — ${lastReplan.recommendation || 'the plan was reconsidered'}${changed.riskLevel ? `; risk is now ${lastReplan.riskLevel}` : ''}${changed.macroImpulse ? `; the macro impulse moved to ${lastReplan.impulse}` : ''}${changed.guardianAlert ? '; a guardian line was crossed' : ''}`,
      reason: 'the world moved under the plan and the decision engine was re-read; nothing was executed and no permission was granted by the replan',
      source: 'event-replanning-engine',
      dataAt: lastReplan.at || Date.now(),
      partial: false
    });
  }

  /*
   * ── THE WHY SURFACE (path 15) ───────────────────────────────────────────
   *
   * «چرا این را گفتی؟» used to be UNSUPPORTED. The product had a why
   * engine — five why-lines, four named falsifiers, invalidation
   * conditions — and no way to reach it.
   *
   * The finding carries the engine's own content, and its discipline:
   *
   *   · the five why-lines travel as they were written, so the answer
   *     and the explanation are the same words;
   *   · the FALSIFIERS travel with them, because «why» without «what
   *     would prove this wrong» is a justification, not an explanation;
   *   · it is an EXPLANATION, not a new recommendation. It moves nothing.
   */
  /*
   * ── THE ROUTE SURFACE (path 14) ─────────────────────────────────────────
   *
   * The route-intelligence engine was complete and dark. It ranked
   * candidates across five honest dimensions and had no customers,
   * because it waits for candidates and nothing ever asked it for any.
   *
   * This finding is what makes it visible. It carries the same discipline
   * the engine has:
   *
   *   · the best route is named WITH its cost, its time and its risk, so
   *     «this one» is never a bare opinion;
   *   · the UNREAD dimensions travel with it, because a ranking that
   *     silently drops half its dimensions is a ranking the reader
   *     cannot audit;
   *   · it is ADVISORY. The finding says so, and the execution path
   *     re-quotes with a real address and keeps its own gates.
   */
  if (intent.intentType === 'ROUTE_INTELLIGENCE') {
    const routeRead = readResults.routeIntelligence;
    if (routeRead?.status === 'OK' && routeRead.data) {
      const ri = routeRead.data;
      const best = ri.bestRoute || null;
      const ranked = Array.isArray(ri.ranked) ? ri.ranked : [];
      const runnerUp = ranked.find((r) => r.routeId !== best?.routeId) || null;
      const cost = best?.totalCostUsd ?? null;
      const seconds = best?.dimensions?.time?.value ?? null;
      const unknown = Array.isArray(best?.unknownDimensions) ? best.unknownDimensions : [];
      findings.push({
        id: 'route-intelligence',
        status: best ? 'OK' : 'PARTIAL',
        source: ri.source || 'route-intelligence-engine',
        dataAt: ri.at || Date.now(),
        estimate: true,
        executionPermission: false,
        bestRoute: best
          ? {
              routeId: best.routeId ?? null,
              tool: best.tool ?? null,
              score: best.score ?? null,
              totalCostUsd: cost,
              estimatedSeconds: seconds,
              failureProbabilityPct: best.failureProbabilityPct ?? null,
              riskLevel: best.riskLevel ?? null,
              unknownDimensions: unknown
            }
          : null,
        ranked: ranked.slice(0, 5).map((r) => ({
          routeId: r.routeId ?? null,
          tool: r.tool ?? null,
          score: r.score ?? null,
          totalCostUsd: r.totalCostUsd ?? null,
          estimatedSeconds: r.dimensions?.time?.value ?? null,
          failureProbabilityPct: r.failureProbabilityPct ?? null,
          unknownDimensions: Array.isArray(r.unknownDimensions) ? r.unknownDimensions : []
        })),
        rejected: (ri.rejected || []).slice(0, 5),
        unranked: (ri.unranked || []).slice(0, 5),
        routeCount: ri.routeCount ?? 0,
        detail: best
          ? `${ranked.length} live candidate route(s); the best is ${best.tool || best.routeId}${cost != null ? ` at ${cost} USD` : ''}${seconds != null ? ` in ~${seconds}s` : ''}${runnerUp?.totalCostUsd != null && cost != null ? ` against ${runnerUp.totalCostUsd} USD for the runner-up` : ''}`
          : `${ri.routeCount ?? 0} candidate route(s) were read but none could be ranked — none of them had a readable dimension`,
        reason: best
          ? (unknown.length
              ? `chosen over ${runnerUp?.tool || runnerUp?.routeId || 'the other candidates'}; ${unknown.length} of the dimensions were unread (${unknown.join(', ')}) and the margin over the runner-up is therefore unverified — advisory only, the execution path re-quotes`
              : `chosen over ${runnerUp?.tool || runnerUp?.routeId || 'the other candidates'} on the dimensions the provider actually priced — advisory only, the execution path re-quotes`)
          : 'no candidate route had a single readable dimension — nothing is recommended and nothing is faked',
        partial: !best
      });
    } else if (routeRead?.status === 'UNAVAILABLE') {
      findings.push({
        id: 'route-intelligence',
        status: 'UNAVAILABLE',
        detail: null,
        reason: routeRead.reason === 'ROUTE_REQUEST_INCOMPLETE'
          ? 'a route comparison needs a source chain, a destination chain, both tokens and an amount — none of them was specified, so no route was quoted'
          : `the live route source could not be read (${routeRead.reason || 'NO_DATA'})`,
        source: 'route-intelligence-engine',
        partial: true
      });
    }
  }

  /*
   * ── THE YIELD SURFACE (2026-11-12) ─────────────────────────────────────
   *
   * Three capabilities were readable and never asked for. These findings
   * are what makes them visible.
   *
   * The important property is that a yield is NEVER quoted alone. A pool
   * with 24 % APR and a one-sided pool is a loss waiting to happen, so the
   * finding carries the risk level, the depth and the impermanent-loss
   * flag beside the number — and the REASON says which of them made the
   * row a candidate and which made it a review.
   */
  if (intent.intentType === 'YIELD_OPPORTUNITY' || intent.intentType === 'STAKING_REWARD') {
    const opportunities = scanOpportunities({
      yields: state.sections.farming.data,
      portfolio,
      risk,
      capabilities: {}
    });
    if (opportunities.status === 'OK') {
      const rows = opportunities.rows;
      const best = rows[0] || null;
      /* For a STAKING question, the honest answer is the liquid-staking
         row — not the highest APR, which on a DEX pool is usually an
         impermanent-loss trap rather than a return. */
      const stakingRows = rows.filter((r) => /lido|rocket|etherfi|jito|marinade|coinbase|binance|stak/i.test(`${r.project || ''} ${r.id || ''}`));
      const pick = intent.intentType === 'STAKING_REWARD' ? (stakingRows[0] || best) : best;
      findings.push({
        id: 'yield-opportunity',
        status: 'OK',
        pools: rows,
        best: pick,
        detail: pick ? `${pick.project || pick.id} ${pick.symbol || ''} pays ${pick.aprPct}% APR on ${pick.chain || 'its chain'}${pick.depthUsd ? ` with ${Math.round(pick.depthUsd / 1_000_000)}M USD depth` : ''}` : `no pool passed the eligibility floor out of ${opportunities.considered}`,
        reason: pick
          ? `the top eligible pool pays ${pick.aprPct}% with ${pick.riskLevel} protocol risk; APR is a trailing figure, not a promise`
          : `nothing met the eligibility floor out of ${opportunities.considered} considered`,
        /* The qualifier «APR is a trailing figure, not a promise» is the whole
           honesty of a yield answer, so it travels in both languages. The
           project, symbol and chain are NAMES and stay as the venue wrote
           them; only the sentence around them is Persian. */
        detailFa: pick
          ? `${pick.project || pick.id} ${pick.symbol || ''} با APR ${fmtNum(pick.aprPct, locale === 'fa')}٪ روی ${pick.chain || 'همان شبکه'}${pick.depthUsd ? ` و عمق ${fmtUsd(pick.depthUsd, locale === 'fa')}` : ''}`
          : `از میان ${fmtNum(opportunities.considered, locale === 'fa')} گزینه، هیچ استخری از کفِ صلاحیت عبور نکرد`,
        reasonFa: pick
          ? `بالاترین استخر واجد شرایط ${fmtNum(pick.aprPct, locale === 'fa')}٪ با ریسک پروتکل ${RISK_LEVEL_FA[String(pick.riskLevel || '').toUpperCase()] || pick.riskLevel || 'ناخواند'} می‌دهد؛ APR یک عدد گذشته‌نگر است، نه وعده`
          : `از میان ${fmtNum(opportunities.considered, locale === 'fa')} گزینهٔ بررسی‌شده، هیچ‌کدام به کفِ صلاحیت نرسید`,
        source: 'yields-engine',
        dataAt: opportunities.at,
        partial: false
      });
    } else {
      findings.push({ id: 'yield-opportunity', status: 'UNAVAILABLE', reason: `the yields source did not answer: ${opportunities.reason || readResults.farming?.reason || 'NO_YIELD_DATA'}`, reasonFa: `منبع ییلد پاسخ نداد: ${opportunities.reason || readResults.farming?.reason || 'NO_YIELD_DATA'}`, detail: null, source: 'yields-engine' });
    }
  }

  if (intent.intentType === 'LIQUIDITY_RISK') {
    const pools = Array.isArray(state.sections.liquidity.data?.pools) ? state.sections.liquidity.data.pools : [];
    /* An LP is a DIRECTIONAL position wearing a yield costume. The finding
       therefore leads with the impermanent-loss flag and the depth, and the
       APR comes after — not before. */
    const withIl = pools.filter((p) => p.ilRisk === true);
    const safe = pools.filter((p) => p.ilRisk !== true);
    findings.push({
      id: 'liquidity-risk',
      status: pools.length ? 'OK' : 'UNAVAILABLE',
      totalPools: pools.length,
      impermanentLossPools: withIl.length,
      cleanPools: safe.length,
      ilPools: withIl.slice(0, 3).map((p) => ({ id: p.id, project: p.project, symbol: p.symbol, apy: p.apy, tvlUsd: p.tvlUsd, risk: p.risk })),
      cleanPoolsSample: safe.slice(0, 3).map((p) => ({ id: p.id, project: p.project, symbol: p.symbol, apy: p.apy, tvlUsd: p.tvlUsd, risk: p.risk })),
      detail: pools.length
        ? `${pools.length} pools read; ${withIl.length} carry an impermanent-loss flag and ${safe.length} do not`
        : `the liquidity source did not answer: ${readResults.liquidity?.reason || 'NO_LIQUIDITY_DATA'}`,
      reason: withIl.length
        ? `${withIl.length} of ${pools.length} pools carry an impermanent-loss flag — the APR on those is not a free return`
        : (pools.length ? 'no pool carries an impermanent-loss flag, and the APRs are still trailing figures' : 'no liquidity data to judge'),
      /* The qualifier is the point of this finding — «the APR on those is not
         a free return» is the sentence that keeps a 40% number honest — so it
         has to survive translation. An English-only qualifier inside a Persian
         reply is a qualifier the user will skim past. */
      detailFa: pools.length
        ? `${fmtNum(pools.length, locale === 'fa')} استخر خوانده شد؛ ${fmtNum(withIl.length, locale === 'fa')} پرچم زیان ناپایدار دارند و ${fmtNum(safe.length, locale === 'fa')} ندارند`
        : `منبع نقدینگی پاسخ نداد: ${readResults.liquidity?.reason || 'NO_LIQUIDITY_DATA'}`,
      reasonFa: withIl.length
        ? `${fmtNum(withIl.length, locale === 'fa')} از ${fmtNum(pools.length, locale === 'fa')} استخر پرچم زیان ناپایدار دارند — APR آن‌ها بازدهی رایگان نیست`
        : (pools.length
          ? 'هیچ استخری پرچم زیان ناپایدار ندارد و APRها همچنان اعداد گذشته‌نگرند'
          : 'دادهٔ نقدینگی برای قضاوت در دسترس نیست'),
      source: 'yields-engine',
      dataAt: state.sections.liquidity.data?.at || Date.now(),
      partial: pools.length === 0
    });
  }

  /*
   * ── THE FIT SURFACE (2026-11-12) ───────────────────────────────────────
   *
   * "Which of these suits me?" is answered by the fit engine: each
   * opportunity is scored against the OWNER's risk tolerance, capital,
   * liquidity need and goal, and comes back FITTED / CONDITIONAL /
   * NOT_FITTED with a reason for every dimension.
   *
   * The finding carries the verdict AND the reason it failed, because a
   * verdict without a reason is not an answer — «NOT_FITTED because your
   * capital does not cover the minimum» is a decision, «NOT_FITTED» is
   * a shrug. It also carries the profile the score was made against, so
   * the answer says WHOSE fit.
   */
  if (intent.intentType === 'OPPORTUNITY_FIT') {
    const fitRead = readResults.opportunityFit;
    const ranked = Array.isArray(fitRead?.data?.ranked) ? fitRead.data.ranked : [];
    if (fitRead?.status === 'OK' && ranked.length) {
      const best = ranked[0];
      findings.push({
        id: 'opportunity-fit',
        status: 'OK',
        ranked: ranked.slice(0, 5),
        best,
        verdict: best?.verdict || null,
        score: best?.score ?? null,
        riskTolerance: fitRead.data?.riskTolerance || null,
        capitalUsd: fitRead.data?.capitalUsd ?? null,
        detail: `${ranked.length} opportunit${ranked.length === 1 ? 'y' : 'ies'} scored against a ${fitRead.data?.riskTolerance || 'unreadable'} risk profile; the top one is ${best?.verdict || 'unranked'}${best?.score != null ? ` (score ${best.score})` : ''}`,
        reason: best?.reason || best?.reasons?.[0] || 'the fit engine gave no reason for its verdict',
        /*
         * The fit engine speaks English only, so the Persian voice is built
         * HERE from the engine's own verdict and score — never by passing the
         * English prose through. The words that carry the meaning are the
         * engine's (FITTED / CONDITIONAL / NOT_FITTED, the score, the
         * tolerance); only the sentence around them is translated.
         *
         * When the engine produced a Persian reason of its own, that wins.
         */
        detailFa: `${fmtNum(ranked.length, locale === 'fa')} گزینه با پروفایل ریسک ${FIT_TOLERANCE_FA[String(fitRead.data?.riskTolerance || '').toLowerCase()] || 'خوانده‌نشده'} سنجیده شد؛ گزینهٔ اول ${FIT_VERDICT_FA[String(best?.verdict || '').toUpperCase()] || 'رتبه‌بندی‌نشده'} است${best?.score != null ? ` (امتیاز ${fmtNum(best.score, locale === 'fa')})` : ''}`,
        reasonFa: best?.reasonFa || best?.reasonsFa?.[0]
          || `${FIT_VERDICT_FA[String(best?.verdict || '').toUpperCase()] || 'بی‌رتبه'}: ${fmtNum(best?.score ?? null, locale === 'fa')} امتیاز در برابر پروفایل ریسک ${FIT_TOLERANCE_FA[String(fitRead.data?.riskTolerance || '').toLowerCase()] || 'خوانده‌نشده'}`,
        source: 'fit-engine',
        dataAt: fitRead.data?.at || Date.now(),
        partial: false
      });
    } else {
      findings.push({
        id: 'opportunity-fit',
        status: 'UNAVAILABLE',
        ranked: [],
        detail: null,
        reason: `the fit engine did not rank anything: ${fitRead?.reason || fitRead?.data?.detail || 'NO_FIT_DATA'}`,
        reasonFa: `موتور تناسب چیزی را رتبه‌بندی نکرد: ${fitRead?.reason || fitRead?.data?.detail || 'NO_FIT_DATA'}`,
        source: 'fit-engine',
        partial: true
      });
    }
  }

  /*
   * ── THE GLOBAL SURFACE (2026-11-12) ───────────────────────────────────
   *
   * The brain could not reach the global engines, so a question about
   * smart money was answered with a price summary.
   *
   * The finding carries the flows AND what they are NOT: a whale
   * transfer is a proxy, not a paired trade, and the smart-money engine
   * says so in its own data (`whaleTransferProxy.note`). An answer that
   * quoted «nنهنگ‌ها ۱۲ میلیون دلار خریدند» without that qualifier would
   * be a fabrication dressed as a fact, so the qualifier travels with the
   * number.
   */
  if (intent.intentType === 'SMART_MONEY_READ') {
    const global = readResults.globalIntel;
    const domains = global?.data?.domains || {};
    const smart = domains.smart_money || null;
    const whales = domains.whales || null;
    const onchain = domains.onchain || null;
    const failed = global?.data?.failed || {};
    if (smart || whales || onchain) {
      const d = smart?.data || {};
      const proxy = d.whaleTransferProxy || {};
      findings.push({
        id: 'global-intelligence',
        status: 'OK',
        domains: Object.keys(domains),
        netFlowUsd: d.netFlowUsd ?? null,
        accumulationUsd: d.accumulationUsd ?? null,
        distributionUsd: d.distributionUsd ?? null,
        topTokens: (d.topTokens || []).slice(0, 5),
        whaleTransferProxy: {
          count: proxy.whaleActivity?.count ?? null,
          netFlowUsd: proxy.netFlowUsd ?? null,
          exchangeInflowUsd: proxy.exchangeInflowUsd ?? null,
          exchangeOutflowUsd: proxy.exchangeOutflowUsd ?? null,
          note: proxy.note || 'transfer aggregates and exchange labels are proxies, not paired trades'
        },
        whaleEvents: (whales?.data?.events || []).slice(0, 5),
        onchainActivity: onchain?.data || null,
        detail: d.netFlowUsd !== null && d.netFlowUsd !== undefined
          ? `net flow ${d.netFlowUsd} USD over ${d.window || '24h'}, confidence ${smart?.confidence ?? '—'}`
          : `${Object.keys(domains).length} global domain(s) read; smart money has no verified flow yet`,
        reason: d.dataStatus === 'insufficient-evidence' || d.verifiedStatus === 'insufficient-evidence'
          ? 'the smart-money engine has no verified paired-swap consensus for this window, so the whale transfers below are PROXIES, not trades'
          : `read from the ${smart?.source || 'global-intelligence engine'}; the window is ${d.window || '24h'} and it moves`,
        /* «the whale transfers below are PROXIES, not trades» is the qualifier
           that keeps a whale number from reading as a fact about paired
           trades — §5.9 called a claim without it «a fabrication dressed as a
           fact». It must survive translation, or the Persian reply is the one
           that overstates. */
        detailFa: d.netFlowUsd !== null && d.netFlowUsd !== undefined
          ? `جریان خالص ${fmtUsd(d.netFlowUsd, locale === 'fa')} در بازهٔ ${d.window || '۲۴ ساعت'}، اطمینان ${fmtNum(smart?.confidence, locale === 'fa')}`
          : `${fmtNum(Object.keys(domains).length, locale === 'fa')} دامنهٔ جهانی خوانده شد؛ پول هوشمند هنوز جریان تأییدشده‌ای ندارد`,
        reasonFa: d.dataStatus === 'insufficient-evidence' || d.verifiedStatus === 'insufficient-evidence'
          ? 'موتور پول هوشمند برای این بازه اجماع تأییدشدهٔ جفت‌معامله ندارد، پس انتقال‌های نهنگ که در ادامه می‌آید PROXY است، نه معامله'
          : `از ${smart?.source || 'موتور هوش جهانی'} خوانده شد؛ بازه ${d.window || '۲۴ ساعت'} است و تغییر می‌کند`,
        source: smart?.source || 'global-intelligence-engine',
        dataAt: smart?.at || Date.now(),
        partial: Boolean(smart?.partial)
      });
    } else {
      const named = Object.entries(failed).map(([k, v]) => `${k}: ${v}`).slice(0, 6);
      findings.push({
        id: 'global-intelligence',
        status: 'UNAVAILABLE',
        domains: [],
        failed,
        detail: named.length ? `no global domain answered — ${named.join('; ')}` : `the global engine answered with nothing (${global?.reason || 'NO_GLOBAL_SNAPSHOT'})`,
        reason: global?.reason ? `the global engine could not be read: ${global.reason}` : 'no global domain answered in this pass',
        source: 'global-intelligence-engine',
        dataAt: Date.now(),
        partial: true
      });
    }
  }

  if (['ASSET_ANALYSIS', 'SIGNAL_READING', 'QUOTE_SWAP'].includes(intent.intentType) || (classification.entities.asset && intent.intentType === 'CONCENTRATION_CHECK')) {
    const ai = assetIntelligence({ asset: classification.entities.asset, markets, signals: state.sections.signals.data, news: state.sections.news.data, risk: { level: risk.level }, derivatives: state.sections.futures.data });
    if (ai.status !== 'UNAVAILABLE') findings.push({ id: 'asset-intelligence', status: ai.status === 'PARTIAL' ? 'PARTIAL' : 'OK', detail: `${ai.asset} ${ai.price} USD, ${ai.change24hPct}% 24h, stance ${ai.stance}`, reason: ai.missing.length ? `combined view is missing: ${ai.missing.join(', ')}` : 'price, signal, news and volatility all read for this asset', source: 'market + signals + news engines', dataAt: ai.at || Date.now(), value: `${ai.asset}: ${ai.price} USD (${ai.change24hPct ?? '—'}%)`, partial: ai.status === 'PARTIAL', missing: ai.missing, asset: ai.asset, price: ai.price, change24hPct: ai.change24hPct, volatilityPct: ai.volatilityPct, fundingAprPct: ai.fundingAprPct, signal: ai.signal, newsCount: (ai.news || []).length, news: ai.news, stance: ai.stance, confidence: ai.confidence });
    else findings.push({ id: 'asset-intelligence', status: 'UNAVAILABLE', reason: ai.reason || 'no price readable for this asset', detail: null });
  }

  if (intent.intentType === 'MARKET_OVERVIEW') {
    const b = markets?.breadth || null;
    const gainers = (markets?.topGainers || []).slice(0, 3);
    const losers = (markets?.topLosers || []).slice(0, 3);
    if (b || gainers.length || losers.length) {
      findings.push({
        id: 'market-overview', status: b ? 'OK' : 'PARTIAL',
        breadth: b, gainers, losers,
        detail: [b?.totalMarketCapUsd ? `total cap ${b.totalMarketCapUsd}` : null, b?.marketCapChange24hPct !== undefined && b?.marketCapChange24hPct !== null ? `24h ${b.marketCapChange24hPct}%` : null, b?.btcDominancePct ? `BTC dominance ${b.btcDominancePct}%` : null].filter(Boolean).join(', ') || 'top movers only (breadth source did not answer)',
        reason: b ? `breadth read from ${b.provider || 'market-data'}; movers from the same fetch` : 'the breadth endpoint did not answer, so only the ranked movers are quoted',
        source: markets?.source || 'market-data', dataAt: markets?.at || Date.now(), partial: !b
      });
    } else findings.push({ id: 'market-overview', status: 'UNAVAILABLE', reason: readResults.markets?.reason || 'the market-data source returned nothing', detail: null });
  }

  /*
   * The regime (path 12). A market overview that quotes breadth and the
   * top movers answers "what is moving" — not "what kind of market is
   * this". The macro graph is the second half: the global snapshot, the
   * world model and the portfolio read TOGETHER, with the transmission
   * edges between them.
   *
   * It is an ENRICHMENT, not the source: when the graph is unreadable
   * the overview still stands on the prices it did read. And the graph
   * says what it is — `estimate: true` — so the finding says it too.
   */
  if (intent.intentType === 'MARKET_OVERVIEW') {
    const graphRead = readResults.macroGraph;
    if (graphRead?.status === 'OK' && graphRead.data) {
      const g = graphRead.data;
      const domainsRead = Array.isArray(g.coverage?.domainsRead) ? g.coverage.domainsRead : [];
      const impulse = g.portfolioRiskImpulse ?? null;
      findings.push({
        id: 'market-regime',
        status: domainsRead.length ? 'OK' : 'PARTIAL',
        domainsRead,
        nodeCount: Array.isArray(g.nodes) ? g.nodes.length : 0,
        edgeCount: Array.isArray(g.edges) ? g.edges.length : 0,
        portfolioRiskImpulse: impulse,
        impulse: g.impulse ?? null,
        pressure: g.pressure ?? null,
        detail: domainsRead.length
          ? `the regime is read from ${domainsRead.join(', ')}; ${g.coverage?.nodes ?? 0} node(s) and ${g.coverage?.edges ?? 0} transmission edge(s)`
          : 'the macro graph read no domain this pass',
        reason: impulse !== null && impulse !== undefined
          ? `the portfolio risk impulse is ${impulse} — a first-order model over the read domains, not a forecast`
          : 'no portfolio risk impulse was derivable: the graph is a model, and it says which domains it read',
        estimate: g.estimate === true,
        source: 'macro-graph-engine',
        dataAt: g.at || Date.now(),
        partial: domainsRead.length === 0
      });
    }
  }

  if (intent.intentType === 'NEWS_SUMMARY') {
    const news = state.sections.news.data;
    const items = Array.isArray(news?.items) ? news.items : [];
    if (items.length) findings.push({ id: 'news-digest', status: 'OK', count: items.length, items: items.slice(0, 5), detail: `${items.length} headline(s), newest first`, reason: 'titles and timestamps are copied from the news engine; no interpretation was added to them', source: news?.source || 'news-engine', dataAt: news?.at || Date.now() });
    else findings.push({ id: 'news-digest', status: 'UNAVAILABLE', reason: readResults.news?.reason || 'the news engine returned no items', detail: null });
  }

  /* The quote a module produced is the most load-bearing finding of the turn: the
     confirmation card, the policy verdict and the headline all read these numbers,
     and they must be the same object, not three parses of the same payload. */
  for (const extra of (stepResults.quotes || []).slice(1)) {
    findings.push({
      id: 'quote-next', status: 'OK', module: extra.module, provider: extra.provider || null,
      fromAsset: extra.fromAsset || null, toAsset: extra.toAsset || null, amountUsd: usableNumber(extra.amountUsd),
      received: usableNumber(extra.expectedOut), feeUsd: usableNumber(extra.feeUsd), priceImpactPct: usableNumber(extra.priceImpactPct),
      detail: `leg 2: ${extra.amountIn ?? '—'} ${extra.fromAsset || ''} → ${extra.expectedOut ?? '—'} ${extra.toAsset || ''}${extra.toChain ? ` (chain ${extra.toChain})` : ''}`,
      detailFa: `مرحلهٔ بعدی: ${extra.expectedOut ?? '—'} ${extra.toAsset || ''}${extra.toChain ? ` روی شبکهٔ ${extra.toChain}` : ''}`,
      reason: `the second leg is quoted from ${extra.provider || 'its own venue'} and needs its own confirmation`,
      reasonFa: 'مرحلهٔ دوم از venue خودش نرخ گرفته و تأییدیهٔ جدا می‌خواهد',
      source: extra.source || 'venue', dataAt: extra.at || Date.now()
    });
  }
  const q = stepResults.quote;
  if (q) findings.push({
    id: 'quote', status: q.priceImpactPct === undefined && q.feeUsd === undefined ? 'PARTIAL' : 'OK',
    fromAsset: q.fromAsset || classification.entities.from || null, toAsset: q.toAsset || classification.entities.to || null,
    amountUsd: usableNumber(q.amountUsd), amountIn: usableNumber(q.amountIn), received: usableNumber(q.expectedOut), minOut: usableNumber(q.minOut),
    feeUsd: usableNumber(q.feeUsd), gasUsd: usableNumber(q.gasUsd), priceImpactPct: usableNumber(q.priceImpactPct),
    provider: q.provider || null, expiresAt: q.expiresAt || null, slippagePct: usableNumber(q.slippagePct), route: q.route || null,
    detail: `${q.amountIn ?? '—'} ${q.fromAsset || ''} → ${q.expectedOut ?? '—'} ${q.toAsset || ''} via ${q.provider || 'aggregator'}`,
    reason: `quote from ${q.provider || 'the DEX aggregator'}${q.priceImpactPct != null ? `, price impact ${q.priceImpactPct}%` : ''}${q.feeUsd != null ? `, fee ${q.feeUsd} USD` : ''}`,
    source: q.source || 'dex-aggregator', dataAt: q.at || Date.now(), actionType: q.toChain || q.fromChain ? 'BRIDGE' : 'SWAP'
  });

  if (intent.intentType === 'CONCENTRATION_CHECK' && concentration.status === 'OK') {
    findings.push({ id: 'concentration-share', detail: `top asset ${concentration.topAsset} is ${concentration.topSharePct}% of risk capital`, reason: `${concentration.topAsset}: ${concentration.topSharePct}% of risk capital and ${concentration.topShareOfPortfolioPct}% of the whole portfolio (top 3 together ${concentration.top3SharePct}%)`, source: 'portfolio-service', dataAt: concentration.at, asset: concentration.topAsset, sharePct: concentration.topSharePct, value: `${concentration.topAsset} ${concentration.topSharePct}%` });
  }

  const riskIsInformative = risk?.level && risk.level !== 'MISSING';
  /*
   * `RISK_OVERVIEW` is in this list because the risk verdict IS its
   * answer: without it the intent had no evidence and no headline, and
   * «ریسک چقدره؟» fell back to the generic tail.
   */
  const moneyTurn = ['EXECUTE_SWAP', 'EXECUTE_BRIDGE', 'EXECUTE_LEND', 'EXECUTE_BORROW', 'EXECUTE_REPAY', 'EXECUTE_REBALANCE', 'WHATIF_SIMULATION', 'CONCENTRATION_CHECK', 'FUTURES_RISK', 'LOAN_STATUS', 'BORROW_CAPACITY', 'PORTFOLIO_ANALYSIS', 'PROFIT_PLAN', 'GOAL_PLAN', 'RISK_OVERVIEW'].includes(intent.intentType);
  if (risk?.factors?.length && (riskIsInformative || moneyTurn)) findings.push({ id: 'risk', level: risk.level, detail: `${risk.level} overall from ${risk.factors.length} computed factors`, reason: risk.reasons[0] || `risk level ${risk.level}`, reasonFa: risk.reasonsFa?.[0] || null, decision: risk.decision, source: 'central-risk-engine', dataAt: Date.now(), factors: risk.factors.slice(0, 5) });

  for (const [key, value] of Object.entries(results)) {
    if (value?.status === 'UNAVAILABLE' && !findings.some((f) => f.id === key)) findings.push({ id: key, status: 'UNAVAILABLE', reason: `no data: ${value.reason || 'source unavailable'}`, detail: null, source: value.source || key });
  }
  if (intent.intentType === 'INSTRUMENT_QUERY') {
    const wanted = classification.entities.instrument || null;
    const caps = context.capabilities || {};
    const READABLE = ['AVAILABLE', 'DEGRADED', 'READ_ONLY'];
    const venueStatus = wanted ? (caps[wanted] || 'UNREGISTERED') : null;
    const offered = ['stocks', 'etf', 'funds', 'forex', 'commodities', 'rwa'].filter((m) => READABLE.includes(caps[m] || 'UNAVAILABLE'));
    const instrumentRead = ['stocks', 'forex', 'commodities', 'rwa', 'etf', 'funds']
      .map((m) => ({ module: m, out: results[`${m}.read`] || null }))
      .find((r) => r.out && r.out.status !== 'UNAVAILABLE') || null;
    findings.push({
      id: 'instrument-access',
      status: venueStatus && READABLE.includes(venueStatus) ? 'OK' : 'UNAVAILABLE',
      venue: wanted, capability: venueStatus, offered, instrument: wanted,
      rows: instrumentRead?.out?.data?.instruments || instrumentRead?.out?.data?.rows || null,
      readFrom: instrumentRead?.module || null,
      detail: wanted
        ? (READABLE.includes(venueStatus)
          ? `${wanted} is served by the ${instrumentRead?.module || wanted} module${instrumentRead?.out?.data ? ' with live rows' : ''}`
          : `${wanted} is registered as ${venueStatus}: no order can be placed from FBT Swap for it`)
        : 'no instrument was named, so nothing was assumed',
      reason: wanted && READABLE.includes(venueStatus)
        ? `the venue module answered, so its rows are quoted directly`
        : `the central registry records ${wanted || 'this instrument'} as ${venueStatus}, and the brain will not claim a route it does not have (§8)`,
      source: 'central-registry + capability-matrix', dataAt: Date.now()
    });
  }

  /* A finding either says what it read or says it could not read it. `status` is
     what the recommendation engine filters on, and a finding that omits it used to
     vanish — turning a real number into "no data". Defaulting here keeps the
     producers free to be brief without losing evidence. */
  return findings.filter(Boolean).map((f) => {
    const status = f.status || (f.detail || f.value !== undefined || f.reason ? 'OK' : 'UNAVAILABLE');
    const copy = findingCopy({ ...f, status }) || {};
    return { ...f, status, detailFa: f.detailFa || copy.detail || null, reasonFa: f.reasonFa || copy.reason || null };
  });
}

function alternativesFor({ findings, state, capabilities, locale }) {
  const fa = locale === 'fa';
  const out = [];
  const concentration = findings.find((f) => f.id === 'concentration');
  if (concentration?.sharePct >= 30) {
    out.push({ id: 'do-nothing-monitor', label: fa ? 'همین حالا چیزی نفروش؛ فقط هشدار قیمت بگذار' : 'Sell nothing now; set a price alert instead', note: fa ? 'بدون کارمزد، بدون ریسک اجرا' : 'no fees, no execution risk', costUsd: 0, capability: capabilities.alerts });
    if (capabilities.lending === 'AVAILABLE') out.push({ id: 'collateralise', label: fa ? 'به‌جای فروش، وثیقه بگذار و سود بگیر' : 'Use it as collateral instead of selling', note: fa ? 'همان قرار گرفتن در ریسک، با درآمد' : 'same exposure, with income', costUsd: null, capability: capabilities.lending });
  }
  const opportunities = findings.find((f) => f.id === 'opportunities');
  if (opportunities?.candidates?.length) out.push({ id: 'yield-idle', label: fa ? 'نقدینهٔ بی‌کار را در استخر کم‌ریسک بگذار' : 'Put idle stables into the lowest-risk pool', note: `${opportunities.candidates[0].aprPct}% APR, ${opportunities.candidates[0].riskLevel} risk`, costUsd: null });
  out.push({ id: 'hedge-size', label: fa ? 'اندازهٔ ریسک را با کاهش حجم کم کن، نه با پیش‌بینی جهت' : 'Reduce the size of the bet rather than predicting direction', note: fa ? 'تنها اهرمی که به دادهٔ بیشتری نیاز ندارد' : 'the only lever that needs no extra data', costUsd: 0 });
  return out;
}

/* ── helpers ───────────────────────────────────────────────────────────── */
const SECTION_LABEL_FA = {
  markets: 'بازار', wallet: 'کیف پول', portfolio: 'پرتفوی', lending: 'وضعیت وام',
  positions: 'موقعیت‌ها', futures: 'فیوچرز', dydx: 'dYdX', signals: 'سیگنال‌ها',
  news: 'اخبار', goals: 'اهداف', alerts: 'هشدارها', transactions: 'تراکنش‌ها',
  risk: 'ریسک', yields: 'بازدهی', liquidity: 'نقدینگی', farming: 'فارمینگ'
};

const SECTION_FOR_INTENT = {
  PORTFOLIO_ANALYSIS: ['wallet', 'portfolio', 'markets', 'lending', 'risk'],
  CONCENTRATION_CHECK: ['wallet', 'portfolio', 'markets', 'risk'],
  /* The plain risk verdict needs the portfolio it is judged against, and
     the risk engine that judges it. */
  RISK_OVERVIEW: ['wallet', 'portfolio', 'markets', 'risk'],
  ASSET_ANALYSIS: ['markets', 'signals', 'news', 'portfolio'],
  BALANCE_QUERY: ['wallet'],
  LOAN_STATUS: ['wallet', 'lending', 'portfolio', 'risk'],
  BORROW_CAPACITY: ['wallet', 'lending', 'borrowing', 'portfolio', 'risk'],
  FUTURES_RISK: ['futures', 'dydx', 'portfolio', 'markets', 'risk'],
  /* The market overview also reads the global section (path 12): the
     regime is not a price list, it is what the global snapshot, the
     world model and the portfolio say TOGETHER. `globalIntel` is a state
     section, and a module with no section is a module nothing ever asks. */
  MARKET_OVERVIEW: ['markets', 'signals', 'news', 'globalIntel', 'macroGraph'],
  NEWS_SUMMARY: ['news', 'signals', 'markets'],
  SIGNAL_READING: ['signals', 'markets', 'news'],
  /* The goal scenarios travel with the goal plan (path 13): the three
     profiles for the target, each with its drawdown and its probability
     of loss. The feasibility figure answers "can it be reached"; the
     scenarios answer "what does the road look like". */
  GOAL_PLAN: ['wallet', 'portfolio', 'markets', 'goals', 'farming', 'risk', 'goalScenarios'],
  PROFIT_PLAN: ['wallet', 'portfolio', 'markets', 'farming', 'goals', 'signals', 'risk'],
  WHATIF_SIMULATION: ['wallet', 'portfolio', 'markets', 'lending', 'futures', 'risk'],
  QUOTE_SWAP: ['wallet', 'markets', 'portfolio', 'risk'],
  QUOTE_BRIDGE: ['wallet', 'markets'],
  EXECUTE_SWAP: ['wallet', 'markets', 'portfolio', 'risk'],
  EXECUTE_BRIDGE: ['wallet', 'markets', 'portfolio', 'risk'],
  EXECUTE_LEND: ['wallet', 'lending', 'portfolio', 'risk'],
  EXECUTE_BORROW: ['wallet', 'lending', 'borrowing', 'portfolio', 'markets', 'risk'],
  EXECUTE_REPAY: ['wallet', 'lending', 'portfolio', 'risk'],
  EXECUTE_REBALANCE: ['wallet', 'portfolio', 'markets', 'risk'],
  CREATE_GOAL: ['wallet', 'portfolio', 'goals', 'markets'],
  SET_ALERT: ['markets', 'alerts'],
  CONFIRM_PENDING: ['wallet', 'markets', 'portfolio'],
  CANCEL_PENDING: [],
  /*
   * The yield surface. These three sections were READABLE and NEVER ASKED
   * FOR — `farming` and `liquidity` are state sections, and `staking` reads
   * `farming`. The words `yield`, `farm` and `apy` belonged to
   * ASSET_ANALYSIS, whose modules are the crypto ones, so the yields
   * engine was never consulted for a question about a pool.
   */
  YIELD_OPPORTUNITY: ['farming', 'portfolio', 'risk'],
  LIQUIDITY_RISK: ['liquidity', 'portfolio', 'risk'],
  STAKING_REWARD: ['farming', 'portfolio', 'risk'],
  /*
   * `globalIntel` IS a state section, and it has to be: the brain reads
   * modules THROUGH the state store, so a module with no section is a
   * module nothing ever asks. The snapshot is per-owner — the state store
   * is per-owner — so two users cannot see each other's flows.
   */
  SMART_MONEY_READ: ['globalIntel', 'markets', 'risk'],
  /*
   * The fit question needs the ranking AND the risk view beside it: a
   * ranking that says «FITTED» is meaningless without the risk number it
   * was scored against. `opportunityFit` is a state section for the same
   * reason `globalIntel` is — the brain reads modules THROUGH the state
   * store, so a module with no section is a module nothing ever asks.
   */
  OPPORTUNITY_FIT: ['opportunityFit', 'portfolio', 'risk'],
  /* The route ranking (path 14): the live candidates for the transfer,
     the market they are crossing, and the risk of the crossing. The
     markets read is optional in effect but declared here, because a
     route priced without any market context is a price and not an
     answer. */
  ROUTE_INTELLIGENCE: ['routeIntelligence', 'markets', 'risk'],
  /* The why surface (path 15): the brain's own decision, explained. It
     needs the portfolio and the risk view, because those are what the
     decision was sized and judged against — an explanation that omits
     them is an explanation of a decision nobody made.

     `whyDecision` is NOT in this list, and that is deliberate. The why
     engine explains the RECOMMENDATION, and the recommendation is built
     AFTER these reads — so reading the why section here would ask the
     engine to explain a decision that does not exist yet, and the
     honest answer it would give is NO_DECISION. The why section is read
     in its own step, once the recommendation stands (see the why read
     below), and the read there is the one that counts. */
  WHY_DECISION: ['portfolio', 'risk']
};
function sectionsForIntent(classification, { context, state }) {
  const base = SECTION_FOR_INTENT[classification.type] || ANALYSIS_MINIMUM;
  const pageModule = context?.page?.module;
  const extra = pageModule === 'lending' ? ['lending'] : pageModule === 'futures' || pageModule === 'dydx' ? ['futures'] : [];
  const withPositions = base.includes('lending') ? base : [...base, ...extra];
  /* A conversation with no wallet read at all still needs the state check, so
     that "not connected" is an answer the brain produced, not an absence. */
  return Array.from(new Set(withPositions.filter((k) => STATE_SECTION_EXISTS[k])));
}
const STATE_SECTION_EXISTS = Object.fromEntries(Object.keys(createSystemState().sections).map((k) => [k, true]));

function primaryModuleFor(intent, steps) {
  const preferred = steps.find((s) => s.permission === PERMISSION.EXECUTE && s.operation === 'execute')?.module;
  if (preferred) return preferred;
  const byIntent = {
    EXECUTE_SWAP: 'swap', EXECUTE_BRIDGE: 'bridge', EXECUTE_LEND: 'lending', EXECUTE_BORROW: 'borrowing',
    EXECUTE_REPAY: 'borrowing', EXECUTE_REBALANCE: 'swap', CREATE_GOAL: 'goals', SET_ALERT: 'alerts'
  };
  return byIntent[intent.intentType] || steps[0]?.module || 'portfolio';
}

const ACTION_BY_INTENT = {
  EXECUTE_SWAP: 'SWAP', QUOTE_SWAP: 'SWAP', EXECUTE_BRIDGE: 'BRIDGE', QUOTE_BRIDGE: 'BRIDGE',
  EXECUTE_LEND: 'LEND', EXECUTE_BORROW: 'BORROW', EXECUTE_REPAY: 'REPAY', EXECUTE_REBALANCE: 'REBALANCE',
  CREATE_GOAL: 'CREATE_GOAL', SET_ALERT: 'SET_ALERT'
};
function actionTypeFor(intent, classification) {
  return ACTION_BY_INTENT[intent.intentType] || (classification.type && ACTION_BY_INTENT[classification.type]) || 'ANALYZE';
}

/**
 * Security signals are collected from every read that could produce one, because
 * §23 must not depend on one module remembering to raise it. A token flagged as a
 * honeypot by the risk service, an oracle that will not certify freshness, and a
 * quote whose numbers fail internal consistency all arrive here.
 */
function collectSecuritySignals({ results = {}, stepResults = {}, wallet = null, readResults = {} }) {
  const signals = [];
  const seen = new Set();
  const push = (signal) => { if (signal && !seen.has(`${signal.code}|${signal.detail}`)) { seen.add(`${signal.code}|${signal.detail}`); signals.push(signal); } };
  /* A module that REFUSED because of a security code is itself the signal. This
     scan is deliberately generic: any step or read whose failure carries one of the
     SAFE_STOP codes becomes a stop, so a new module cannot accidentally report a
     security verdict as a plain error that the recovery ladder would retry. */
  for (const [key, value] of Object.entries({ ...results, ...readResults })) {
    const code = value?.reason || value?.code || null;
    if (code && SAFE_STOP_CODES.includes(code)) push({ code, detail: `${key}: ${String(value?.detail || value?.reason || '').slice(0, 140)}` });
  }
  const quote = stepResults.quote || {};
  if (quote.tokenRisk?.honeypot === true) signals.push({ code: 'HONEYPOT_DETECTED', detail: 'the destination token cannot be sold' });
  if ((quote.tokenRisk?.flags || []).some((f) => ['BLACKLIST_FUNCTION', 'OWNERSHIP_RISK'].includes(f))) signals.push({ code: 'SECURITY_VIOLATION', detail: `token contract exposes ${quote.tokenRisk.flags.join(', ')}` });
  if (quote.contractMismatch === true) signals.push({ code: 'CONTRACT_MISMATCH', detail: 'quote token does not match the allowlisted address' });
  if (Number.isFinite(Number(quote.priceImpactPct)) && Number(quote.priceImpactPct) > 12) push({ code: 'TAMPERED_QUOTE', detail: `impact ${quote.priceImpactPct}% is far outside any honest route` });
  const lending = readResults.lending?.data || results['lending.read']?.data;
  if (lending?.oracle && lending.oracle.status !== 'ok' && lending.oracle.status !== 'OK' && lending.oracle.status !== undefined) push({ code: 'ORACLE_MANIPULATION_SUSPECTED', detail: `oracle reported ${lending.oracle.status}` });
  if (wallet?.address && !/^0x[0-9a-fA-F]{40}$/.test(String(wallet.address))) push({ code: 'INVALID_RECIPIENT', detail: 'the wallet address in context is not well-formed' });
  return signals;
}

function firstError(readResults = {}) {
  const failed = Object.entries(readResults).find(([, v]) => v?.status === 'UNAVAILABLE' && v?.showToUser !== false);
  if (!failed) return null;
  const [key, value] = failed;
  return { code: value.reason || 'SOURCE_UNAVAILABLE', module: key, userMessage: humanizeError({ code: value.reason, module: key }, { locale: 'fa', recovery: value.recovery }), recovery: value.recovery, repeatCount: value.repeatCount || 1 };
}

function normalizeExecution(out, moduleId) {
  const data = out?.data || {};
  return {
    status: out?.status || 'UNKNOWN',
    module: moduleId,
    actionType: data.actionType || null,
    actionId: data.actionId || null,
    handoff: data.handoff || null,
    serverSigned: data.serverSigned === true,
    serverHoldsKey: data.serverHoldsKey === true,
    requiresUserSignature: data.requiresUserSignature !== false,
    verification: data.verification || null,
    finalResult: data.result || null,
    amountLabel: data.quote?.amountUsd ? `${round(data.quote.amountUsd, 2)} USD` : null,
    feeLabel: data.quote?.feeUsd !== undefined && data.quote?.feeUsd !== null ? `${data.quote.feeUsd} USD` : null,
    network: data.handoff?.chainId ? `chain:${data.handoff.chainId}` : null,
    txHash: data.txHash || null,
    raw: out
  };
}

function summariseModuleRead(key, value) {
  if (!value || value.status === 'UNAVAILABLE') return { status: 'UNAVAILABLE', summary: `${key}: unavailable (${value?.reason || 'no source'})` };
  const d = value.data || {};
  const summary = key === 'wallet' ? `${(d.balances || []).length} balances across ${(d.chainsRead || []).length} chain(s)${d.stale ? ' (stale)' : ''}`
    : key === 'portfolio' ? `${round(d.totalValueUsd, 2)} USD across ${(d.holdings || []).length} assets`
      : key === 'markets' ? `${Object.keys(d.prices || {}).length} prices${d.stale ? ' (stale)' : ''}`
        : key === 'lending' ? `HF ${d.healthFactor ?? 'unreadable'}, debt ${d.debtUsd ?? '—'} USD`
          : key === 'goals' ? `${(d.goals || []).length} goal(s)` : `${key} read`;
  return { status: value.status, summary, source: value.source, dataAt: value.at || Date.now(), stale: value.stale === true, data: d };
}

/** Memory keeps resolution power, not transcripts: only the fields that resolve
 *  references, never the user's message text (§35). */
function compactMemory(memory) {
  if (!memory) return emptyMemory();
  return {
    lastIntent: memory.lastIntent || null,
    lastEntities: memory.lastEntities || null,
    lastAction: memory.lastAction ? { actionId: memory.lastAction.actionId, type: memory.lastAction.type, module: memory.lastAction.module, status: memory.lastAction.status } : null,
    lastError: memory.lastError || null,
    pendingConfirmation: memory.pendingConfirmation || null,
    conversationContext: { focus: memory.conversationContext?.focus || [], turnCount: memory.conversationContext?.turnCount || 0, lastQuestionAt: memory.conversationContext?.lastQuestionAt || null, askedFor: memory.conversationContext?.askedFor || [], lastReplyFingerprint: memory.conversationContext?.lastReplyFingerprint || null }
  };
}

function publicIntent(intent) {
  return {
    intentId: intent.intentId, status: intent.status, intentType: intent.intentType, confidence: intent.confidence,
    entities: intent.entities, requiredModules: intent.requiredModules, requiredTools: intent.requiredTools,
    plan: intent.plan, risk: intent.risk, policy: intent.policy, compound: intent.compound || null,
    confirmationRequired: intent.confirmationRequired, executionRequired: intent.executionRequired, verificationRequired: intent.verificationRequired,
    history: intent.history, followUp: intent.classification?.followUp || null, classificationSource: intent.classification?.source || null,
    error: intent.error, attempts: intent.attempts,
    /* The corpus citation. A retrieved answer must say WHERE it was
       retrieved from — that is the difference between a lookup and a
       generation, and it is the thing the user can check. */
    answeredFromCorpus: intent.answeredFromCorpus === true,
    corpusMatch: intent.corpusMatch || null,
    /* And the same for a generated answer: which provider produced it. */
    answeredFromModel: intent.answeredFromModel === true,
    modelProvider: intent.modelProvider || null,
    modelId: intent.modelId || null
  };
}

export { FOLLOWUP_KINDS, validatePlan, templateFor, CAPABILITY };
