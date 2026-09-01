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
import { evaluatePolicy, planDigest } from '../../src/lib/central/policy.js';
import { assessRisk } from '../../src/lib/central/risk.js';
import { buildRecommendation, possibleActionsFrom } from '../../src/lib/central/recommend.js';
import { composeResponse } from '../../src/lib/central/human.js';
import { classifyError, createErrorLedger, humanizeError, nextRecovery } from '../../src/lib/central/errors.js';
import {
  analyzeConcentration, analyzeExposure, assessLendingSafety, assetIntelligence,
  computeBorrowCapacity, goalFeasibility, scanOpportunities, simulateShock
} from '../../src/lib/central/analysis.js';
import { buildCapabilityMatrix } from '../../src/lib/central/registry.js';
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

    /* §5/§20 — a money request with a hole in it is answered with a NAMED question,
       not with a venue call. The check runs on the bound inputs (the same binding the
       steps use) so the question and the plan can never disagree about what is
       missing, and the quote/prepare/simulate steps are withheld instead of being
       sent a null asset and reporting an opaque provider error. */
    const moneySteps = steps.filter((st) => st.operation === 'quote' || st.operation === 'prepare' || st.operation === 'simulate' || st.operation === 'execute');
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

    /* Execute the READ/quote/simulate portion of the plan for real. */
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
    const findings = buildFindings({ intent, classification, state, results, risk, readResults, stepResults, context });
    const capabilitiesMap = capabilities.capabilities;
    const actions = possibleActionsFrom({ findings, capabilities: capabilitiesMap, risk, policy, walletConnected: Boolean(wallet?.connected) });
    /* When the answer is a refusal, the reply IS the refusal: the portfolio numbers
       that happen to be readable must not be dressed up as a response to a question
       we could not serve (§25 forbids filling the gap with whatever was at hand). */
    const recommendation = refusal ? {
      schema: 'fbt.central-recommendation.v1', brain: CI_SCHEMA, ok: false,
      missing: ['capability'], reason: [], refusal: refusal.text, refusedModule: refusal.module
    } : buildRecommendation({
      kind: policy.requiresConfirmation ? 'ACTIONABLE' : 'ANALYSIS',
      intent, risk, findings, capabilities: capabilitiesMap, policy, plan, locale,
      alternatives: alternativesFor({ findings, state, capabilities: capabilitiesMap, locale }),
      actions: policy.requiresConfirmation && !policy.allowExecute ? [] : actions,
      refusalMode: Boolean(refusal),
      now: Date.now()
    });

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
      error: firstError(readResults), execution, locale, state,
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
      plan: { steps: plan.steps.map((s) => ({ id: s.id, module: s.module, operation: s.operation, permission: s.permission, degraded: s.degraded === true })), skipped: plan.skipped, problems: plan.problems, digest: plan.digest },
      policy: { verdict: policy.verdict, reasons: policy.reasons, gates: policy.gates, requiresConfirmation: policy.requiresConfirmation, safeStop: policy.safeStop, allowExecute: policy.allowExecute, planDigest: policy.planDigest },
      risk,
      recommendation,
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
    const code = String(f.reason || '').split(/[^A-Z_]/)[0];
    const human = f.code ? humanizeError({ code: f.code, module: f.id }, { locale: 'fa' }) : null;
    return { detail: human?.userMessage || FA_CODE_FALLBACK[code] || `این بخش محاسبه نشد (${String(f.reason || 'NO_DATA').slice(0, 60)})`, reason: null };
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

function buildFindings({ intent, classification, state, results, risk, readResults, stepResults, context }) {
  const findings = [];
  const portfolio = state.sections.portfolio.data;
  const markets = state.sections.markets.data;
  const lendingSection = state.sections.lending.data;

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
    const feasibility = goalFeasibility({
      currentUsd: portfolio?.totalValueUsd ?? null,
      targetUsd: classification.entities.targetUsd ?? goal?.targetAmount ?? null,
      years: classification.entities.horizon?.years ?? (goal?.targetDate ? Math.max(0.1, (goal.targetDate - Date.now()) / (365 * 24 * 3600_000)) : null),
      monthlyContributionUsd: goal?.monthlyContribution ?? 0,
      volatilityPct: markets?.volatilityPct?.BTC ?? 60
    });
    if (feasibility.status === 'OK') findings.push({ id: 'goal-feasibility', targetUsd: feasibility.targetUsd, years: feasibility.years, probabilityPct: feasibility.probabilityPct, contribution: feasibility.contributionUsdMonthly, requiredContribution: feasibility.requiredContributionUsdMonthly, detail: `${feasibility.probabilityPct}% odds at ${feasibility.contributionUsdMonthly} USD/month; median ${feasibility.projectedMedianUsd} USD`, reason: `required CAGR is ${feasibility.requiredCagrPct}% — ${feasibility.level.toLowerCase()} for this horizon, and it is a model output, not a forecast`, source: 'goals-engine + market-data', dataAt: feasibility.at, partial: feasibility.status === 'PARTIAL' });
    else findings.push({ id: 'goal-feasibility', status: 'UNAVAILABLE', reason: `goal arithmetic incomplete: ${feasibility.reason}`, detail: null });
    const opportunities = scanOpportunities({ yields: state.sections.farming.data, portfolio, risk, capabilities: {} });
    if (opportunities.status === 'OK') findings.push({ id: 'opportunities', candidates: opportunities.rows, detail: `${opportunities.rows.length} eligible pools, best ${opportunities.rows[0]?.aprPct ?? '—'}% APR`, reason: opportunities.rows[0] ? `the top eligible pool pays ${opportunities.rows[0].aprPct}% with ${opportunities.rows[0].riskLevel} protocol risk` : 'nothing met the eligibility floor', source: 'yields-engine', dataAt: opportunities.at });
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
  const moneyTurn = ['EXECUTE_SWAP', 'EXECUTE_BRIDGE', 'EXECUTE_LEND', 'EXECUTE_BORROW', 'EXECUTE_REPAY', 'EXECUTE_REBALANCE', 'WHATIF_SIMULATION', 'CONCENTRATION_CHECK', 'FUTURES_RISK', 'LOAN_STATUS', 'BORROW_CAPACITY', 'PORTFOLIO_ANALYSIS', 'PROFIT_PLAN', 'GOAL_PLAN'].includes(intent.intentType);
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
  ASSET_ANALYSIS: ['markets', 'signals', 'news', 'portfolio'],
  BALANCE_QUERY: ['wallet'],
  LOAN_STATUS: ['wallet', 'lending', 'portfolio', 'risk'],
  BORROW_CAPACITY: ['wallet', 'lending', 'borrowing', 'portfolio', 'risk'],
  FUTURES_RISK: ['futures', 'dydx', 'portfolio', 'markets', 'risk'],
  MARKET_OVERVIEW: ['markets', 'signals', 'news'],
  NEWS_SUMMARY: ['news', 'signals', 'markets'],
  SIGNAL_READING: ['signals', 'markets', 'news'],
  GOAL_PLAN: ['wallet', 'portfolio', 'markets', 'goals', 'farming', 'risk'],
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
  CANCEL_PENDING: []
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
    error: intent.error, attempts: intent.attempts
  };
}

export { FOLLOWUP_KINDS, validatePlan, templateFor, CAPABILITY };
