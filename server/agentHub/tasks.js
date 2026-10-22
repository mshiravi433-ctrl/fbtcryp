/**
 * FBT EXTERNAL AGENT HUB — task broker (§10C, §12, §13).
 * ---------------------------------------------------------------------------
 * A BROKER, NOT AN AGENT RUNTIME.
 *
 * It resolves what the user asked for against the server's reviewed registry,
 * checks consent and eligibility, claims an idempotency key, records the task,
 * calls the provider ONCE, and then reports what actually happened. It does not
 * answer the question itself, and it never substitutes an FBT-written answer
 * for a provider result.
 *
 * THE RULES THAT MATTER, AND WHERE THEY ARE ENFORCED
 *
 *   Server-side resolution. `agentId` and `providerId` from the client are
 *   looked up in the registry; a URL, a price, a recipient or a remote agent id
 *   supplied by a client is never used. (§12)
 *
 *   One remote task per logical request. The idempotency claim is taken BEFORE
 *   the provider is called, and a claim that exists means "do not create".
 *   After a timeout or a lost response the task becomes `reconciling`: FBT will
 *   NOT send a second create, because the first one may be running at the
 *   provider. A new attempt requires a new key, which means a user decision.
 *   (§13)
 *
 *   Provider state is the truth. `completed` is only ever the provider's own
 *   completion; an unrecognised state is `reconciling`; a cancel is `canceled`
 *   only when the provider says so. (§13/§17)
 *
 *   Payment is a gate, not an ability. A provider whose model is
 *   DIRECT_CRYPTO_PAYMENT produces `payment_required` and nothing else: this
 *   build has no relayer, no custody and no way to mark a task paid, so it
 *   refuses rather than half-pays. (§15, Phase 3 deferred by design.)
 *
 *   Nothing here can move money. A result may contain a proposal; it cannot
 *   call a tool, sign, swap or transfer, and no field in this file feeds the
 *   execution path. (§16)
 */

import { randomUUID } from 'node:crypto';
import { buildConsentPayload, consentRecord } from './consent.js';
import { createTaskIdempotency, fingerprintOf } from './idempotency.js';
import {
  AGENT_HUB_TASK_SCHEMA,
  isActive,
  isTerminal,
  normalizeProviderError,
  normalizeResult,
  redactSecrets,
  sanitizeProviderText,
  TERMINAL_STATES,
  userMessageFor
} from './protocol.js';

export const BROKER_SCHEMA = 'fbt.agent-hub.broker.v1';

const TASK_TEXT_MAX = 2000;
const HEALTH_TTL_MS = 60_000;
const SYNC_MIN_INTERVAL_MS = 4_000;
const CREATE_RATE = { windowMs: 60_000 };
const MAX_TASKS_PER_OWNER_WINDOW = 20;

const truthy = (value) => ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value ?? '').trim().toLowerCase());

/**
 * Flags are read per call, never captured at import: an operator can stop the
 * Hub without a redeploy.
 *
 * `AGENT_HUB_ENABLED` now defaults to ON. The reason is the feature it guards:
 * the reviewed catalogue is empty until an operator writes a decision record,
 * so the old default made the External Agents view a permanent blank page for
 * every deployment that never opted in — a page that existed but could not do
 * anything. Nothing is reachable by default in either case: there is no
 * bundled provider, no commission, no payment path, and the only way any
 * third party is contacted is a card URL the user typed themselves. An
 * operator who wants the surface gone sets `AGENT_HUB_ENABLED=false` (or
 * trips the kill switch), and every route answers HUB_DISABLED again.
 */
function hubEnabled(env) {
  const raw = env?.AGENT_HUB_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  return truthy(raw);
}

export function hubFlags(env = process.env) {
  return {
    enabled: hubEnabled(env),
    paidTasksEnabled: truthy(env.AGENT_HUB_PAID_TASKS_ENABLED),
    devLoopback: truthy(env.AGENT_HUB_ALLOW_LOOPBACK) && String(env.NODE_ENV || '') !== 'production'
  };
}

const maskTaskId = (value) => (typeof value === 'string' && value.length > 8 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || null);

export function createTaskBroker({
  registry,
  adapters,
  store,
  connections,
  userSources = null,
  sourceCredentials = null,
  native = null,
  env = process.env,
  now = () => Date.now(),
  log = () => {}
} = {}) {
  const idempotency = createTaskIdempotency({ now, log });
  /* Operator-tunable, defaulting low: this is a per-owner burst limit layered
     on top of the /api/ai gateway budget, not a business rule. */
  const createLimit = Math.max(1, Math.min(1000, Number(env.AGENT_HUB_CREATE_RATE) || 8));
  const healthCache = new Map(); // providerId -> { result, at }
  const createWindows = new Map(); // owner -> { count, reset }
  let globalKillCache = null;

  /* ── health ─────────────────────────────────────────────────────────────── */

  async function healthFor(provider, { force = false } = {}) {
    const adapter = adapters.for(provider);
    if (!adapter) return { ok: false, status: 'UNCONFIGURED', code: 'PROVIDER_ADAPTER_NOT_IMPLEMENTED', checkedAt: now() };
    const hit = healthCache.get(provider.id);
    if (!force && hit && now() - hit.at < HEALTH_TTL_MS) return { ...hit.result, cached: true };
    const result = await adapter.healthCheck();
    healthCache.set(provider.id, { result, at: now() });
    return { ...result, cached: false };
  }

  async function killState(provider) {
    const global = await store.getKillSwitch('global');
    const perProvider = await store.getKillSwitch(`provider:${provider.id}`);
    const envKill = truthy(env.AGENT_HUB_KILL_SWITCH);
    return {
      global: envKill || global.tripped,
      provider: perProvider.tripped,
      reason: envKill ? 'operator switch (env)' : (global.reason || perProvider.reason || null)
    };
  }

  function rateLimited(owner) {
    const window = createWindows.get(owner);
    const at = now();
    if (!window || at > window.reset) {
      createWindows.set(owner, { count: 1, reset: at + CREATE_RATE.windowMs });
      return false;
    }
    window.count += 1;
    return window.count > createLimit;
  }

  /* ── catalog ────────────────────────────────────────────────────────────── */

  function agentStatus({ accessModel, health, hasConnection }) {
    if (health.status === 'DISABLED') return 'DISABLED';
    if (health.status === 'UNCONFIGURED') return 'UNCONFIGURED';
    if (!health.ok) return 'UNAVAILABLE';
    /* Paid is a status, not a capability: this build can never complete a paid
       task, so the label does not depend on the flag. */
    if (accessModel === 'DIRECT_CRYPTO_PAYMENT') return 'PAYMENT_REQUIRED';
    if ((accessModel === 'FREE_ACCOUNT' || accessModel === 'EXTERNAL_SUBSCRIPTION') && !hasConnection) return 'ACCOUNT_REQUIRED';
    return health.status === 'DEGRADED' ? 'DEGRADED' : 'LIVE';
  }

  async function catalog({ owner }) {
    const flags = hubFlags(env);
    if (!flags.enabled) {
      return {
        ok: true,
        enabled: false,
        status: 'DISABLED',
        durable: store.durable(),
        agents: [],
        providers: [],
        reason: 'AGENT_HUB_DISABLED',
        detail: 'External agents are not enabled on this deployment.'
      };
    }
    const global = await store.getKillSwitch('global');
    if (truthy(env.AGENT_HUB_KILL_SWITCH) || global.tripped) {
      return {
        ok: true,
        enabled: false,
        status: 'DISABLED',
        durable: store.durable(),
        agents: [],
        providers: [],
        reason: 'KILL_SWITCH',
        detail: 'External agents are stopped by an operator switch.'
      };
    }

    let connectionsList = [];
    try {
      connectionsList = (await connections.list(owner)).connections || [];
    } catch {
      connectionsList = [];
    }

    const agents = [];
    const providers = [];

    /* Two sources of providers, one pipeline. Reviewed listings come from the
       server registry; user-supplied ones come from this owner's own rows.
       They are merged only HERE — and each one keeps its `source` label all
       the way to the card, so a user's own agent can never be displayed as an
       FBT-reviewed provider (or the reverse). */
    let userProviders = [];
    if (userSources) {
      try {
        userProviders = (await userSources.providersFor({ owner })).providers || [];
      } catch (error) {
        log(`agenthub:user-sources-read-failed:${String(error?.message || error).slice(0, 80)}`);
        userProviders = [];
      }
    }
    const nativeOn = Boolean(native?.enabled?.());
    const merged = [
      ...(nativeOn ? [{ provider: native.provider, source: 'native' }] : []),
      ...registry.list().map((provider) => ({ provider, source: 'reviewed' })),
      ...userProviders.map((provider) => ({ provider, source: 'user' }))
    ];

    for (const { provider, source } of merged) {
      const kill = await killState(provider);
      const health = kill.provider || kill.global
        ? { ok: false, status: 'DISABLED', checkedAt: now(), code: kill.provider ? 'PROVIDER_KILL_SWITCH' : 'GLOBAL_KILL_SWITCH', cached: false }
        : await healthFor(provider);
      const connected = source === 'reviewed'
        && connectionsList.some((c) => c.providerId === provider.id && c.status === 'ACTIVE');
      const providerView = {
        ...(source === 'native' ? native.publicView()
          : source === 'user' ? userSources.publicView(provider) : registry.publicView(provider)),
        source,
        health: { status: health.status, ok: health.ok === true, checkedAt: health.checkedAt || null, latencyMs: health.latencyMs ?? null, code: health.code || null },
        connections: connected ? 1 : 0
      };
      providers.push(providerView);
      if (!health.ok) continue;

      const adapter = adapters.for(provider);
      if (!adapter) continue;
      const discovered = await adapter.discoverAgents();
      if (!discovered.ok) continue;
      for (const agent of discovered.agents) {
        agents.push({
          id: agent.remoteAgentId,
          providerId: provider.id,
          providerName: provider.name,
          source,
          name: agent.name,
          nameFa: agent.nameFa || null,
          summary: agent.summary,
          summaryFa: agent.summaryFa || null,
          category: agent.category,
          capabilities: agent.capabilities,
          examples: agent.examples,
          examplesFa: agent.examplesFa || null,
          inputHint: agent.inputHint || null,
          inputHintFa: agent.inputHintFa || null,
          dataSources: Array.isArray(agent.dataSources) ? agent.dataSources : [],
          native: source === 'native',
          accessModel: provider.accessModel,
          costSummary: provider.costSummary,
          requiresAccount: provider.accessModel === 'FREE_ACCOUNT' || provider.accessModel === 'EXTERNAL_SUBSCRIPTION',
          requiresPayment: provider.accessModel === 'DIRECT_CRYPTO_PAYMENT',
          paidInvocationEnabled: false,
          supportsCancellation: typeof adapter.cancelTask === 'function',
          supportsStreaming: false,
          status: agentStatus({ accessModel: provider.accessModel, health, hasConnection: connected }),
          lastLiveCheckAt: health.checkedAt || null,
          cardVersion: discovered.card?.version || null,
          inputModes: agent.inputModes,
          outputModes: agent.outputModes,
          provider: {
            source,
            websiteUrl: provider.websiteUrl,
            documentationUrl: provider.documentationUrl,
            termsUrl: provider.termsUrl || null,
            privacyUrl: provider.privacyUrl || null,
            supportUrl: provider.supportUrl || null,
            reviewedAt: provider.approvalEvidence?.reviewedAt || null,
            jurisdiction: providerView.jurisdiction,
            dataPolicy: providerView.dataPolicy
          }
        });
      }
    }

    return {
      ok: true,
      enabled: true,
      status: agents.length ? 'LIVE' : 'EMPTY',
      durable: store.durable(),
      paidInvocationEnabled: false,
      providers,
      agents,
      registryErrors: registry.errors,
      sources: {
        cap: userSources ? userSources.cap : 0,
        added: userProviders.length,
        durable: store.durable()
      },
      at: now()
    };
  }

  /** The provider that owns `agentId`, from either source, for this owner only. */
  async function providerForAgentId(id, owner) {
    if (native?.enabled?.() && (id === `${native.provider.id}:default` || id.startsWith(`${native.provider.id}:`))) {
      return native.provider;
    }
    const fromRegistry = registry.list().find((p) => id === `${p.id}:default` || id.startsWith(`${p.id}:`));
    if (fromRegistry) return fromRegistry;
    if (!userSources || !owner) return null;
    try {
      const mine = (await userSources.providersFor({ owner })).providers || [];
      return mine.find((p) => id === `${p.id}:default` || id.startsWith(`${p.id}:`)) || null;
    } catch {
      return null;
    }
  }

  async function resolveAgent(agentId, { owner } = {}) {
    const id = String(agentId || '');
    const provider = await providerForAgentId(id, owner);
    if (!provider) return { ok: false, code: 'AGENT_NOT_FOUND' };
    const adapter = adapters.for(provider);
    if (!adapter) return { ok: false, code: 'PROVIDER_ADAPTER_NOT_IMPLEMENTED', provider };
    const discovered = await adapter.discoverAgents();
    if (!discovered.ok) return { ok: false, code: 'AGENT_DISCOVERY_FAILED', provider, detail: discovered.code };
    const agent = discovered.agents.find((a) => a.remoteAgentId === id);
    if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND', provider };
    return { ok: true, provider, agent, adapter, card: discovered.card };
  }

  async function getAgent({ owner, agentId }) {
    const flags = hubFlags(env);
    if (!flags.enabled) return { ok: false, code: 'HUB_DISABLED' };
    const resolved = await resolveAgent(agentId, { owner });
    if (!resolved.ok) return { ok: false, code: resolved.code };
    const { provider, agent, adapter } = resolved;
    const source = provider.native === true ? 'native' : provider.userSupplied ? 'user' : 'reviewed';
    const kill = await killState(provider);
    const health = kill.provider || kill.global
      ? { ok: false, status: 'DISABLED', code: 'KILL_SWITCH', checkedAt: now() }
      : await healthFor(provider);
    let hasConnection = false;
    try {
      hasConnection = ((await connections.list(owner)).connections || []).some((c) => c.providerId === provider.id);
    } catch {
      hasConnection = false;
    }
    return {
      ok: true,
      agent: {
        id: agent.remoteAgentId,
        providerId: provider.id,
        providerName: provider.name,
        source,
        name: agent.name,
        nameFa: agent.nameFa || null,
        summary: agent.summary,
        summaryFa: agent.summaryFa || null,
        category: agent.category,
        capabilities: agent.capabilities,
        examples: agent.examples,
        examplesFa: agent.examplesFa || null,
        inputHint: agent.inputHint || null,
        inputHintFa: agent.inputHintFa || null,
        dataSources: Array.isArray(agent.dataSources) ? agent.dataSources : [],
        native: source === 'native',
        accessModel: provider.accessModel,
        costSummary: provider.costSummary,
        requiresAccount: provider.accessModel === 'FREE_ACCOUNT' || provider.accessModel === 'EXTERNAL_SUBSCRIPTION',
        requiresPayment: provider.accessModel === 'DIRECT_CRYPTO_PAYMENT',
        paidInvocationEnabled: false,
        supportsCancellation: typeof adapter.cancelTask === 'function',
        supportsStreaming: false,
        status: agentStatus({ accessModel: provider.accessModel, health, hasConnection }),
        lastLiveCheckAt: health.checkedAt || null,
        cardVersion: resolved.card?.version || null,
        connected: hasConnection,
        inputModes: agent.inputModes,
        outputModes: agent.outputModes,
        provider: {
          ...(source === 'native' ? native.publicView()
            : source === 'user' ? userSources.publicView(provider) : registry.publicView(provider)),
          health: { status: health.status, ok: health.ok === true, checkedAt: health.checkedAt || null, code: health.code || null }
        }
      }
    };
  }

  /* ── task rows ──────────────────────────────────────────────────────────── */

  function publicTask(task, extra = {}) {
    return {
      id: task.id,
      agentId: task.agentId,
      agentName: task.agentName,
      providerId: task.providerId,
      providerName: task.providerName,
      state: task.state,
      providerState: task.providerState || null,
      createdAt: task.createdAt,
      startedAt: task.startedAt || null,
      completedAt: task.completedAt || null,
      lastProviderSyncAt: task.lastProviderSyncAt || null,
      approvedContextHash: task.approvedContextHash,
      contextCategories: task.contextCategories || [],
      /* What was approved — categories, hash, policy versions — never the
         values. This is the receipt the user can hold FBT to. */
      consent: task.consent ? {
        providerId: task.consent.providerId,
        contextCategories: task.consent.contextCategories,
        approvedContextHash: task.consent.approvedContextHash,
        termsVersion: task.consent.termsVersion,
        privacyVersion: task.consent.privacyVersion,
        scope: task.consent.scope,
        at: task.consent.at
      } : null,
      taskTitle: task.taskTitle,
      priceQuote: task.priceQuote || null,
      costReported: task.costReported || null,
      remoteTaskId: task.remoteTaskId || null,
      remoteTaskRef: maskTaskId(task.remoteTaskId),
      providerRef: task.providerRef || null,
      errorCode: task.errorCode || null,
      safeErrorMessage: task.safeErrorMessage || null,
      needsReconciliation: task.state === 'reconciling' || task.outcomeUnknown === true,
      cancelRequestedAt: task.cancelRequestedAt || null,
      supportsCancellation: task.supportsCancellation === true,
      terminal: isTerminal(task.state),
      active: isActive(task.state),
      result: task.result || null,
      ...extra
    };
  }

  async function recordEvent(owner, task, type, payload = {}) {
    await store.appendEvent(owner, task.id, { type, state: task.state, payload }).catch(() => null);
  }

  function fail(code, extra = {}) {
    return { ok: false, code, detail: userMessageFor(code), ...extra };
  }

  /* ── create ─────────────────────────────────────────────────────────────── */

  async function createTask({ owner, agentId, body = {}, idempotencyKey = null }) {
    const flags = hubFlags(env);
    if (!flags.enabled) return fail('HUB_DISABLED');

    const resolved = await resolveAgent(agentId, { owner });
    if (!resolved.ok) return fail(resolved.code);
    const { provider, agent, adapter } = resolved;

    const kill = await killState(provider);
    if (kill.global) return fail('HUB_DISABLED', { reason: 'KILL_SWITCH' });
    if (kill.provider) return fail('AGENT_UNAVAILABLE', { reason: 'PROVIDER_KILL_SWITCH' });

    const health = await healthFor(provider);
    if (!health.ok) return fail('AGENT_UNAVAILABLE', { providerStatus: health.status, detail: health.code || health.status });

    if (rateLimited(owner)) return { ok: false, code: 'RATE_LIMITED', detail: 'Too many tasks for this account. Try again in a minute.', status: 429 };

    /* Payment: this build has no relayer and will not pretend otherwise. */
    if (provider.accessModel === 'DIRECT_CRYPTO_PAYMENT' || provider.accessModel === 'PROVIDER_SPONSORED') {
      return {
        ok: false,
        status: 409,
        code: 'PAYMENT_REQUIRED',
        paymentRequired: true,
        paidInvocationEnabled: false,
        detail: provider.accessModel === 'PROVIDER_SPONSORED'
          ? 'This agent is provider-sponsored; paid invocation is not enabled in this build.'
          : 'This agent is paid directly to the provider. Paid invocation is not enabled in this build, so nothing was requested and nothing was charged.'
      };
    }

    const needsAccount = provider.accessModel === 'FREE_ACCOUNT' || provider.accessModel === 'EXTERNAL_SUBSCRIPTION';
    let credential = null;
    if (provider.userSupplied === true && sourceCredentials) {
      /* Optional by design: many A2A agents are public. If the user stored a
         key for this source, it is attached here — and only here. */
      const got = await sourceCredentials.credentialFor({ owner, sourceId: provider.id }).catch(() => ({ ok: false }));
      if (got.ok) credential = got.credential;
    }
    if (needsAccount) {
      /* The user-facing reason first: "connect an account" is actionable, while
         "the deployment has no durable store" is an operator problem. Only once
         a connection EXISTS does the durability requirement bite. */
      const got = await connections.credentialFor(owner, provider.id);
      if (!got.ok) return { ok: false, status: 401, code: 'AUTH_REQUIRED', requiresConnection: true, detail: 'Connect your provider account before using this agent.' };
      if (!store.durable()) return fail('DURABLE_STORE_REQUIRED');
      credential = got.credential;
    }

    const taskText = sanitizeProviderText(body.taskText ?? body.task, TASK_TEXT_MAX).trim();
    if (taskText.length < 4) return fail('TASK_TEXT_REQUIRED');
    if (taskText.length > TASK_TEXT_MAX) return fail('TASK_TEXT_TOO_LONG');

    const consent = body.consent || {};
    if (consent.approved !== true) return fail('CONSENT_REQUIRED');
    const built = buildConsentPayload({ taskText, categories: consent.categories, context: body.context || {} });
    if (!built.ok) return { ok: false, status: 400, code: built.code, field: built.field || null, detail: built.detail || null };

    const key = String(idempotencyKey || body.idempotencyKey || '');
    const fingerprint = fingerprintOf({ owner, agentId: agent.remoteAgentId, taskText, categories: built.categories, contextHash: built.hash });
    const claim = await idempotency.claim({ owner, agentId: agent.remoteAgentId, key, fingerprint });
    if (!claim.ok) {
      if (claim.code === 'REQUEST_IN_PROGRESS') return { ok: false, status: 409, code: claim.code, detail: userMessageFor(claim.code), retryAfterMs: claim.retryAfterMs || 2000 };
      return { ok: false, status: claim.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 400, code: claim.code, detail: userMessageFor(claim.code) };
    }
    if (claim.replay && claim.taskId) {
      const existing = await store.getTask(owner, claim.taskId);
      if (existing.ok) return { ok: true, replay: true, task: publicTask(existing.task), durable: store.durable() };
      /* The claim points at a task this owner cannot read: refuse rather than
         create a second one under the same key. */
      return fail('REQUEST_IN_PROGRESS');
    }

    const taskId = `task_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const at = now();
    const task = {
      schema: AGENT_HUB_TASK_SCHEMA,
      id: taskId,
      owner,
      externalAgentId: agent.remoteAgentId,
      agentId: agent.remoteAgentId,
      agentName: agent.name,
      agentVersion: resolved.card?.version || null,
      providerId: provider.id,
      providerName: provider.name,
      idempotencyKey: key,
      remoteTaskId: null,
      state: 'queued',
      approvedContextHash: built.hash,
      contextCategories: built.categories,
      consent: consentRecord({ provider, categories: built.categories, hash: built.hash, termsVersion: consent.termsVersion, privacyVersion: consent.privacyVersion, at }),
      taskTitle: taskText.slice(0, 90),
      taskText,
      priceQuote: {
        model: provider.accessModel,
        amount: 0,
        asset: null,
        network: null,
        recipient: null,
        providerBilled: true,
        notes: 'This build does not charge on behalf of the provider.'
      },
      supportsCancellation: typeof adapter.cancelTask === 'function',
      createdAt: at,
      startedAt: null,
      completedAt: null,
      lastProviderSyncAt: null,
      errorCode: null,
      safeErrorMessage: null,
      diagnostic: null,
      outcomeUnknown: false,
      userAgent: sanitizeProviderText(body?.surface || '', 40) || null
    };

    const saved = await store.putTask(owner, task);
    if (!saved.ok) {
      await idempotency.fail(claim, saved.code || 'STORE_WRITE_FAILED');
      return fail('STORE_WRITE_FAILED');
    }
    await recordEvent(owner, task, 'created', { agentId: task.agentId, categories: task.contextCategories });

    /* ── the single remote call ─────────────────────────────────────────── */
    let remote;
    try {
      remote = await adapter.createTask({
        text: built.text,
        messageId: key,
        remoteAgentId: agent.remoteAgentId,
        remoteSkillId: agent.remoteSkillId || null
      }, credential);
    } catch (error) {
      remote = { ok: false, code: normalizeProviderError(error, { stage: 'create' }).code };
    }

    if (remote.ok) {
      task.remoteTaskId = remote.remoteTaskId || null;
      task.providerState = remote.providerStatus || null;
      task.state = remote.state || 'reconciling';
      task.startedAt = task.state === 'running' || task.state === 'completed' ? now() : null;
      task.lastProviderSyncAt = now();
      task.result = remote.result || null;
      if (task.state === 'completed') {
        task.completedAt = now();
      }
      if (task.state === 'failed') {
        task.errorCode = remote.errorCode || 'PROVIDER_FAILED';
        task.safeErrorMessage = userMessageFor('PROVIDER_ERROR');
      }
      if (task.remoteTaskId) {
        await store.linkRemoteTask(provider.id, task.remoteTaskId, { owner, taskId: task.id }).catch(() => null);
      }
      if (!task.remoteTaskId && isActive(task.state)) {
        /* The provider answered without a task id (a bare Message). There is
           nothing to poll, and FBT will not claim the work is progressing. */
        task.state = 'reconciling';
        task.outcomeUnknown = true;
      }
      const updated = await store.putTask(owner, task);
      await idempotency.complete(claim, task.id);
      await recordEvent(owner, task, 'provider_accepted', { state: task.state, remoteTaskId: task.remoteTaskId, durable: updated.durable });
      if (isTerminal(task.state)) await recordUsage(owner, task);
      return { ok: true, task: publicTask(task), durable: updated.durable };
    }

    /* Failure AFTER the row exists. This is the branch that must never create a
       second remote task: a timeout or a lost response means "unknown", not
       "did not happen". */
    const code = remote.code || 'PROVIDER_ERROR';
    const retryable = remote.retryable === true;
    task.diagnostic = remote.diagnostic ? { code: remote.diagnostic.code, message: redactSecrets(remote.diagnostic.message, 300) } : null;
    task.lastProviderSyncAt = now();

    if (code === 'PROVIDER_TIMEOUT' || code === 'PROVIDER_UNREACHABLE' || code === 'PROVIDER_UNAVAILABLE') {
      task.state = 'reconciling';
      task.outcomeUnknown = true;
      task.errorCode = code;
      task.safeErrorMessage = userMessageFor(code);
    } else if (code === 'PROVIDER_AUTH_REQUIRED') {
      task.state = 'auth_required';
      task.errorCode = code;
      task.safeErrorMessage = userMessageFor(code);
    } else if (code === 'PROVIDER_RATE_LIMITED') {
      task.state = 'failed';
      task.errorCode = code;
      task.safeErrorMessage = userMessageFor(code);
    } else {
      task.state = 'failed';
      task.errorCode = code;
      task.safeErrorMessage = userMessageFor(code, 'The provider rejected the task.');
    }

    /* A task that never reached the provider is safe to retry with a NEW key;
       a task whose outcome is unknown keeps its claim so the same key cannot
       create a second one. Either way, the claim is settled with the task id so
       a replay returns this row instead of creating another. */
    const updated = await store.putTask(owner, task);
    await idempotency.complete(claim, task.id);
    await recordEvent(owner, task, 'provider_failed', { code, state: task.state, retryable, durable: updated.durable });
    if (isTerminal(task.state)) await recordUsage(owner, task);
    return { ok: true, task: publicTask(task, { retryable: retryable && !task.outcomeUnknown }), durable: updated.durable };
  }

  /* ── sync ───────────────────────────────────────────────────────────────── */

  async function recordUsage(owner, task) {
    await store.appendUsage(owner, {
      taskId: task.id,
      providerId: task.providerId,
      agentId: task.agentId,
      state: task.state,
      contextCategories: task.contextCategories,
      costReported: task.costReported || null,
      at: task.completedAt || now()
    }).catch(() => null);
  }

  /**
   * The provider row for a task, from either source. A task created against a
   * user-supplied agent must keep syncing and cancelling for that owner even
   * though the provider is not in the reviewed registry.
   */
  async function providerForTask(owner, task) {
    if (native?.enabled?.() && task.providerId === native.provider.id) return native.provider;
    const reviewed = registry.get(task.providerId);
    if (reviewed) return reviewed;
    if (!userSources) return null;
    return userSources.providerFor({ owner, providerId: task.providerId });
  }

  async function syncTask(owner, task, { force = false } = {}) {
    if (!task.remoteTaskId) return task;
    if (isTerminal(task.state)) return task;
    const since = now() - Number(task.lastProviderSyncAt || 0);
    if (!force && since < SYNC_MIN_INTERVAL_MS) return task;
    const provider = await providerForTask(owner, task);
    const adapter = provider ? adapters.for(provider) : null;
    if (!adapter) {
      task.state = 'reconciling';
      task.errorCode = 'PROVIDER_ADAPTER_NOT_IMPLEMENTED';
      return task;
    }
    const hasConnection = provider.accessModel === 'FREE_ACCOUNT' || provider.accessModel === 'EXTERNAL_SUBSCRIPTION';
    let credential = null;
    if (hasConnection) {
      const got = await connections.credentialFor(owner, provider.id);
      if (got.ok) credential = got.credential;
    } else if (provider.userSupplied === true && sourceCredentials) {
      const got = await sourceCredentials.credentialFor({ owner, sourceId: provider.id }).catch(() => ({ ok: false }));
      if (got.ok) credential = got.credential;
    }
    const remote = await adapter.getTask(task.remoteTaskId, credential);
    task.lastProviderSyncAt = now();
    if (!remote.ok) {
      if (remote.code === 'PROVIDER_TASK_NOT_FOUND') {
        task.state = 'reconciling';
        task.outcomeUnknown = true;
        task.errorCode = 'PROVIDER_TASK_NOT_FOUND';
        task.safeErrorMessage = userMessageFor('PROVIDER_TASK_NOT_FOUND');
      } else {
        task.errorCode = remote.code || 'PROVIDER_ERROR';
        task.safeErrorMessage = userMessageFor(task.errorCode, 'The provider status could not be read.');
      }
      await store.putTask(owner, task);
      await recordEvent(owner, task, 'sync_failed', { code: task.errorCode });
      return task;
    }
    const previous = task.state;
    task.state = remote.state || 'reconciling';
    task.providerState = remote.providerStatus || task.providerState;
    task.result = remote.result || task.result;
    if (task.state !== previous) {
      task.errorCode = remote.errorCode || null;
      task.safeErrorMessage = task.state === 'failed' ? userMessageFor('PROVIDER_ERROR') : null;
    }
    if (task.state === 'completed' || task.state === 'canceled') {
      task.completedAt = now();
      task.outcomeUnknown = false;
    }
    if (task.state === 'failed') {
      task.completedAt = now();
      task.errorCode = task.errorCode || 'PROVIDER_FAILED';
    }
    const saved = await store.putTask(owner, task);
    await store.linkRemoteTask(task.providerId, task.remoteTaskId, { owner, taskId: task.id }).catch(() => null);
    if (previous !== task.state) await recordEvent(owner, task, 'state_changed', { from: previous, to: task.state });
    if (isTerminal(task.state) && !TERMINAL_STATES.includes(previous)) await recordUsage(owner, task);
    return task;
  }

  async function getTask({ owner, taskId, sync = true }) {
    const found = await store.getTask(owner, taskId);
    if (!found.ok) return fail(found.code || 'TASK_NOT_FOUND', { status: found.code === 'TASK_NOT_FOUND' ? 404 : 400 });
    let task = found.task;
    if (sync && !isTerminal(task.state)) {
      try {
        task = await syncTask(owner, task, { force: false });
      } catch (error) {
        log(`agenthub:sync-failed:${String(error?.message || error).slice(0, 120)}`);
      }
    }
    const events = await store.listEvents(owner, task.id);
    return { ok: true, task: publicTask(task), events: (events.events || []).slice(-30), durable: store.durable() };
  }

  async function listTasks({ owner, limit = 30 }) {
    const out = await store.listTasks(owner, Math.max(1, Math.min(100, Number(limit) || 30)));
    const tasks = (out.tasks || [])
      /* Concurrent readers of one owner's history see only this owner's rows:
         the key already contains the owner, and the row is re-checked. */
      .filter((t) => t && t.owner === owner)
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      .slice(0, Math.max(1, Math.min(MAX_TASKS_PER_OWNER_WINDOW, Number(limit) || 30)));
    return { ok: true, tasks: tasks.map((t) => publicTask(t)), durable: out.durable };
  }

  async function cancelTask({ owner, taskId }) {
    const found = await store.getTask(owner, taskId);
    if (!found.ok) return fail('TASK_NOT_FOUND', { status: 404 });
    const task = found.task;
    if (isTerminal(task.state)) {
      return { ok: false, status: 409, code: 'TASK_ALREADY_TERMINAL', task: publicTask(task) };
    }
    const provider = await providerForTask(owner, task);
    const adapter = provider ? adapters.for(provider) : null;
    if (!adapter || typeof adapter.cancelTask !== 'function') {
      return { ok: false, status: 409, code: 'CANCELLATION_UNSUPPORTED', task: publicTask(task) };
    }
    if (!task.remoteTaskId) {
      /* Nothing remote to cancel: the provider never acknowledged a task id. */
      task.state = 'canceled';
      task.completedAt = now();
      task.safeErrorMessage = null;
      await store.putTask(owner, task);
      await recordEvent(owner, task, 'canceled_locally', {});
      return { ok: true, canceled: true, task: publicTask(task) };
    }
    const remote = await adapter.cancelTask(task.remoteTaskId);
    task.cancelRequestedAt = now();
    task.lastProviderSyncAt = now();
    if (!remote.ok) {
      task.safeErrorMessage = userMessageFor(remote.code, 'The provider did not confirm the cancellation. The task may still be running.');
      task.errorCode = remote.code || 'CANCEL_FAILED';
      await store.putTask(owner, task);
      await recordEvent(owner, task, 'cancel_failed', { code: task.errorCode });
      return { ok: false, status: 502, code: task.errorCode, detail: task.safeErrorMessage, task: publicTask(task) };
    }
    const previous = task.state;
    task.state = remote.state || 'canceled';
    task.result = remote.result || task.result;
    if (task.state === 'canceled') {
      task.completedAt = now();
      task.outcomeUnknown = false;
    } else {
      /* The provider answered "not canceled" (or still working). Report that. */
      task.safeErrorMessage = 'The provider did not cancel the task; it is still in progress.';
    }
    await store.putTask(owner, task);
    await recordEvent(owner, task, 'cancel_result', { from: previous, to: task.state });
    return { ok: true, canceled: task.state === 'canceled', task: publicTask(task) };
  }

  /* ── operator surfaces ──────────────────────────────────────────────────── */

  async function health({ force = false } = {}) {
    const flags = hubFlags(env);
    const global = await store.getKillSwitch('global');
    const providers = [];
    for (const provider of registry.all()) {
      const kill = await killState(provider);
      const adapter = adapters.for(provider);
      const live = adapter ? await healthFor(provider, { force }) : { ok: false, status: 'UNCONFIGURED', code: 'PROVIDER_ADAPTER_NOT_IMPLEMENTED' };
      providers.push({
        id: provider.id,
        name: provider.name,
        approvalStatus: provider.approvalStatus,
        accessModel: provider.accessModel,
        enabled: provider.enabled,
        killSwitch: { global: kill.global || truthy(env.AGENT_HUB_KILL_SWITCH), provider: kill.provider, reason: kill.reason },
        health: { status: live.status, ok: live.ok === true, latencyMs: live.latencyMs ?? null, code: live.code || null, checkedAt: live.checkedAt || null }
      });
    }
    if (native?.enabled?.()) {
      const live = await healthFor(native.provider, { force });
      providers.unshift({
        id: native.provider.id,
        name: native.provider.name,
        approvalStatus: 'FBT_FIRST_PARTY',
        accessModel: 'FREE_PUBLIC',
        enabled: true,
        killSwitch: { global: global.tripped || truthy(env.AGENT_HUB_KILL_SWITCH), provider: false, reason: global.reason || null },
        health: { status: live.status, ok: live.ok === true, latencyMs: live.latencyMs ?? null, code: live.code || null, checkedAt: live.checkedAt || null }
      });
    }
    return {
      ok: true,
      enabled: flags.enabled,
      paidTasksEnabled: false,
      killSwitch: { global: truthy(env.AGENT_HUB_KILL_SWITCH) || global.tripped, reason: global.reason || null },
      durable: store.durable(),
      connections: connections.capability(),
      providers,
      registryErrors: registry.errors,
      at: now()
    };
  }

  async function setKill({ scope = 'global', providerId = null, tripped, reason = null, by = 'ops' }) {
    const target = scope === 'provider' ? `provider:${providerId}` : 'global';
    if (scope === 'provider' && !providerId) return fail('PROVIDER_ID_REQUIRED');
    const saved = await store.setKillSwitch(target, { tripped: tripped === true, reason, by });
    return { ok: saved.ok, target, tripped: tripped === true, durable: saved.durable };
  }

  return {
    schema: BROKER_SCHEMA,
    flags: () => hubFlags(env),
    catalog,
    getAgent,
    createTask,
    getTask,
    listTasks,
    cancelTask,
    health,
    setKill,
    /**
     * Webhook ingestion, AFTER the signature and replay checks (§12).
     *
     * The provider knows only its own task id, so the link written when the
     * remote id was recorded is what makes the event attributable. Without a
     * link the event is refused — guessing an owner is not an option, and an
     * unattributed status change could otherwise edit someone else's history.
     */
    applyWebhook: async ({ providerId, remoteTaskId, state, text = null, providerReportedCost = null, providerStatus = null }) => {
      const provider = registry.get(providerId);
      if (!provider) return fail('PROVIDER_NOT_FOUND');
      if (!remoteTaskId) return fail('WEBHOOK_PAYLOAD_INVALID');
      const link = await store.resolveRemoteTask(providerId, remoteTaskId);
      if (!link.ok) return fail(link.code);
      const found = await store.getTask(link.owner, link.taskId);
      if (!found.ok) return fail('TASK_NOT_FOUND');
      const task = found.task;

      /* A late event must not resurrect a finished task, and must not overwrite
         a terminal state with a stale one. It is recorded, not applied. */
      if (isTerminal(task.state) && state && state !== task.state) {
        await recordEvent(link.owner, task, 'webhook_ignored', { state, reason: 'TASK_ALREADY_TERMINAL' });
        return { ok: true, applied: false, reason: 'TASK_ALREADY_TERMINAL', task: publicTask(task) };
      }

      const previous = task.state;
      task.state = state || task.state;
      task.providerState = providerStatus || task.providerState;
      task.lastProviderSyncAt = now();
      if (text) task.result = normalizeResult({ text: sanitizeProviderText(text, 20000), providerRef: remoteTaskId });
      if (providerReportedCost && typeof providerReportedCost === 'object') task.costReported = providerReportedCost;
      if (task.state === 'completed' || task.state === 'canceled' || task.state === 'failed') {
        task.completedAt = now();
        task.outcomeUnknown = false;
      }
      if (task.state === 'failed') {
        task.errorCode = task.errorCode || 'PROVIDER_FAILED';
        task.safeErrorMessage = userMessageFor('PROVIDER_ERROR');
      }
      const saved = await store.putTask(link.owner, task);
      await recordEvent(link.owner, task, 'webhook_applied', { from: previous, to: task.state });
      if (isTerminal(task.state) && !TERMINAL_STATES.includes(previous)) await recordUsage(link.owner, task);
      return { ok: true, applied: true, task: publicTask(task), durable: saved.durable };
    },
    _reset: () => { healthCache.clear(); createWindows.clear(); idempotency._reset(); },
    _idempotency: idempotency
  };
}
