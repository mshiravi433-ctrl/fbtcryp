/**
 * FBT AI PROVIDER LAB — 15 CONNECTIVITY & RESILIENCE TESTS
 * ---------------------------------------------------------------------------
 * The question this file answers is not "is a key configured?" It is:
 *
 *   · did THIS provider return a real answer, with a model id and a latency?
 *   · does the gateway route to a DIFFERENT provider when one seat is cut?
 *   · is an invalid key classified as an authentication failure?
 *   · is a 429 classified as quota, and does the router stop retrying models?
 *   · does a timeout stay bounded instead of hanging the function?
 *   · do two models on the same question actually disagree?
 *   · how much did the run cost, in tokens and in estimated USD?
 *
 * ─── THREE METHODS, LABELLED IN THE OUTPUT ─────────────────────────────────
 *   LIVE           a real HTTP call to the provider, this run
 *   CONTROLLED_CUT the real router with one provider excluded for this request
 *                  (`routedChat({ excludeProviders })`) — a failover drill, not
 *                  a claim that the provider is down in production
 *   CLASSIFICATION a deterministic classification check of a synthetic error
 *                  body. We do NOT deliberately trip a live account's rate
 *                  limit: that is abusive, can get the key throttled, and would
 *                  make the diagnostic itself the outage.
 *
 * A provider is reported CONNECTED only when a LIVE call returned content and a
 * model id in this run. Configuration, a key, or a previous success is not
 * enough. Skipped tests are SKIPPED, never PASS.
 */

import { PROVIDER_CONFIGS, executeProviderChat, routedChat, parallelMultiProviderChat, classifyAiError, getAvailableProviders, getProviderHealth } from './aiGateway.js';
import { estimateCostUsd, PRICING_VERSION } from './aiBenchmark.js';
import { storeGet, storeSet } from './store.js';

export const LAB_SCHEMA = 'fbt.ai-provider-lab.v1';
export const LAB_VERSION = '1.0.0';
const LAB_STORE_KEY = 'ai:providerlab:last';
const LAB_STORE_TTL_MS = 14 * 24 * 3600_000;

export const TEST_CATALOG = Object.freeze([
  { id: 'gpt', fa: 'تست GPT', en: 'GPT direct test', provider: 'openai', method: 'LIVE', expects: 'پاسخ واقعی و شناسه مدل' },
  { id: 'claude', fa: 'تست Claude', en: 'Claude direct test', provider: 'anthropic', method: 'LIVE', expects: 'پاسخ واقعی و شناسه مدل' },
  { id: 'gemini', fa: 'تست Gemini', en: 'Gemini direct test', provider: 'gemini', method: 'LIVE', expects: 'پاسخ واقعی و شناسه مدل' },
  { id: 'grok', fa: 'تست Grok', en: 'Grok direct test', provider: 'xai', method: 'LIVE', expects: 'پاسخ واقعی و شناسه مدل' },
  { id: 'deepseek', fa: 'تست DeepSeek', en: 'DeepSeek direct test', provider: 'deepseek', method: 'LIVE', expects: 'پاسخ واقعی و شناسه مدل' },
  { id: 'openrouter', fa: 'تست OpenRouter', en: 'OpenRouter gateway test', provider: 'openrouter', method: 'LIVE', expects: 'مدل واقعی انتخاب‌شده' },
  { id: 'simultaneous', fa: 'تست هم‌زمان', en: 'Simultaneous test', provider: null, method: 'LIVE', expects: 'پاسخ مستقل تمام مدل‌های انتخاب‌شده' },
  { id: 'failover_gpt', fa: 'تست قطع GPT', en: 'GPT cut / failover', provider: 'openai', method: 'CONTROLLED_CUT', expects: 'انتقال درخواست به Provider جایگزین' },
  { id: 'failover_claude', fa: 'تست قطع Claude', en: 'Claude cut / failover', provider: 'anthropic', method: 'CONTROLLED_CUT', expects: 'ادامه کار با سایر مدل‌ها' },
  { id: 'invalid_api', fa: 'تست API نامعتبر', en: 'Invalid API key', provider: null, method: 'LIVE', expects: 'تشخیص خطای Authentication' },
  { id: 'rate_limit', fa: 'تست محدودیت درخواست', en: 'Rate limit handling', provider: null, method: 'CLASSIFICATION', expects: 'تشخیص Rate Limit و مدیریت آن' },
  { id: 'timeout', fa: 'تست Timeout', en: 'Timeout handling', provider: null, method: 'LIVE', expects: 'Retry و Failover کنترل‌شده' },
  { id: 'contradiction', fa: 'تست تناقض', en: 'Contradiction test', provider: null, method: 'LIVE', expects: 'شناسایی اختلاف بین پاسخ مدل‌ها' },
  { id: 'quality', fa: 'تست کیفیت', en: 'Quality test', provider: null, method: 'LIVE', expects: 'مقایسه پاسخ‌ها با معیارهای مشخص' },
  { id: 'cost', fa: 'تست هزینه', en: 'Cost test', provider: null, method: 'AGGREGATE', expects: 'ثبت مصرف توکن و هزینه هر Provider' }
]);

const PING_SYSTEM = 'You are a connectivity probe. Reply with the single word: OK';
const PING_USER = 'ping';

const nowOf = (deps) => (typeof deps.now === 'function' ? deps.now : () => Date.now());

function providerRow(id) {
  return getAvailableProviders().find((p) => p.id === id) || null;
}

function skipped(test, reason, detail = null) {
  return {
    id: test.id,
    fa: test.fa,
    en: test.en,
    method: test.method,
    status: 'SKIPPED',
    reasonCode: reason,
    detail,
    provider: test.provider,
    at: Date.now()
  };
}

function result(test, { status, ...rest }) {
  return {
    id: test.id,
    fa: test.fa,
    en: test.en,
    method: test.method,
    expects: test.expects,
    status,
    provider: test.provider,
    at: Date.now(),
    ...rest
  };
}

/** A live ping. Returns the model, latency and tokens — the evidence that matters. */
async function livePing(test, { chat, now, providers }) {
  const p = (providers || []).find((x) => x.id === test.provider) || providerRow(test.provider);
  if (!p) return skipped(test, 'UNKNOWN_PROVIDER');
  if (!p.configured) {
    return skipped(test, 'NEEDS_KEY', `Set ${p.envVar} to run this test.`);
  }
  const started = now();
  try {
    const res = await chat(test.provider, {
      system: PING_SYSTEM,
      user: PING_USER,
      maxTokens: 12,
      temperature: 0,
      timeout: 25_000
    });
    const latencyMs = Number(res?.durationMs ?? (now() - started)) || (now() - started);
    const text = String(res?.text ?? '');
    const model = res?.model || null;
    if (!text.trim()) {
      return result(test, { status: 'FAIL', reasonCode: 'EMPTY_REPLY', latencyMs, model });
    }
    return result(test, {
      status: 'PASS',
      model,
      modelCandidates: p.modelCandidates,
      latencyMs,
      tokensIn: Number(res?.usage?.inputTokens ?? res?.usage?.promptTokens ?? 0) || 0,
      tokensOut: Number(res?.usage?.outputTokens ?? res?.usage?.completionTokens ?? 0) || 0,
      usageReported: Boolean(res?.usage),
      sample: text.slice(0, 40),
      keySourceEnv: p.keySourceEnv
    });
  } catch (err) {
    const cls = classifyAiError(err, test.provider);
    return result(test, {
      status: 'FAIL',
      reasonCode: cls.kind,
      error: cls.message.slice(0, 200),
      fix: cls.fix,
      latencyMs: now() - started,
      modelsTried: (err?.attempts || []).map((a) => a.model)
    });
  }
}

async function simultaneousTest(test, { parallel, providers, now }) {
  const configured = providers.filter((p) => p.configured && p.id !== 'internal').map((p) => p.id);
  if (configured.length < 2) {
    return skipped(test, 'NEEDS_TWO_PROVIDERS', `Only ${configured.length} external provider(s) configured.`);
  }
  const started = now();
  const rows = await parallel({
    providers: configured.slice(0, 5),
    system: 'Answer in one short sentence. Different models must answer independently.',
    user: 'In one sentence: what is the main risk of leverage in crypto?',
    temperature: 0.4,
    maxTokens: 80,
    json: false
  });
  const ok = rows.filter((r) => r && r.ok !== false && String(r.text || '').trim());
  return result(test, {
    status: ok.length >= 2 ? 'PASS' : 'FAIL',
    reasonCode: ok.length >= 2 ? null : 'INSUFFICIENT_ANSWERS',
    latencyMs: now() - started,
    answered: ok.map((r) => ({ provider: r.provider, model: r.model, latencyMs: r.durationMs, sample: String(r.text).slice(0, 80) })),
    failed: rows.filter((r) => !r || r.ok === false).map((r) => ({ provider: r?.provider, reasonCode: r?.reasonCode || 'UNKNOWN', error: r?.error || null })),
    independentlyAttributed: new Set(ok.map((r) => r.provider)).size === ok.length
  });
}

/**
 * Failover drill through the REAL router. The cut provider is excluded from
 * this one request (`excludeProviders`), which is precisely the branch a real
 * outage takes once the circuit is open — no env mutation, no fake transport.
 */
async function failoverTest(test, { routed, providers, now }) {
  const cut = test.provider;
  const configuredOthers = providers.filter((p) => p.configured && p.id !== 'internal' && p.id !== cut);
  if (!configuredOthers.length) {
    return skipped(test, 'NO_ALTERNATIVE_PROVIDER', `No provider other than ${cut} is configured, so failover cannot be proven.`);
  }
  const started = now();
  try {
    const res = await routed({
      taskType: 'reasoning',
      preferredProvider: cut,
      excludeProviders: [cut],
      system: 'You are a failover drill. Answer in one short sentence.',
      user: 'Say which provider answered this drill.',
      maxTokens: 40,
      temperature: 0,
      allowInternalFallback: true
    });
    const served = res?.provider || null;
    const trail = Array.isArray(res?.failoverTrail) ? res.failoverTrail : [];
    const external = served && served !== 'internal' && Boolean(res?.model);
    return result(test, {
      status: external && served !== cut ? 'PASS' : 'FAIL',
      reasonCode: external && served !== cut ? null : (served === 'internal' ? 'FELL_BACK_TO_INTERNAL' : 'CUT_PROVIDER_SERVED'),
      cutProvider: cut,
      servedBy: served === 'internal' ? 'internal' : served,
      servedModel: res?.model || null,
      engine: res?.engine || null,
      degraded: Boolean(res?.degraded),
      latencyMs: res?.durationMs ?? (now() - started),
      trail: trail.map((t) => ({ provider: t.provider, reasonCode: t.reasonCode }))
    });
  } catch (err) {
    return result(test, {
      status: 'FAIL',
      reasonCode: err?.reasonCode || 'FAILOVER_EXCEPTION',
      error: String(err?.message || err).slice(0, 200),
      latencyMs: now() - started
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Invalid key — a real call to a real endpoint with a deliberately bad key    */
/* -------------------------------------------------------------------------- */

function authProbeRequest(providerId, fetchImpl) {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) return Promise.resolve({ status: 0, body: 'UNKNOWN_PROVIDER' });
  const fake = 'fbt-invalid-key-for-auth-probe';
  if (providerId === 'gemini') {
    const url = `${cfg.url}/${cfg.defaultModel}:generateContent`;
    return fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': fake },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] })
    });
  }
  if (providerId === 'anthropic') {
    return fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': fake, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.defaultModel, max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] })
    });
  }
  if (providerId === 'workersai') {
    return Promise.resolve({ status: 0, body: 'SKIPPED_ACCOUNT_SCOPED' });
  }
  return fetchImpl(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${fake}` },
    body: JSON.stringify({ model: cfg.defaultModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 })
  });
}

async function invalidApiTest(test, { fetchImpl, now }) {
  const targets = ['openai', 'anthropic', 'gemini', 'xai', 'deepseek', 'openrouter'];
  const rows = [];
  for (const id of targets) {
    const started = now();
    try {
      const res = await authProbeRequest(id, fetchImpl);
      const status = Number(res?.status) || 0;
      const body = typeof res?.body === 'string' ? res.body : JSON.stringify(res?.body || {});
      const cls = classifyAiError(Object.assign(new Error(`HTTP ${status}: ${body}`), { status }), id);
      const reached = status > 0;
      rows.push({
        provider: id,
        httpStatus: status,
        reasonCode: cls.kind,
        classifiedAsAuth: cls.kind === 'AUTH',
        reached,
        latencyMs: now() - started,
        /* A provider that answers 401 with a bad key is PROVING it is reachable
           and authenticating — the opposite of "connected", and exactly what a
           correctly wired client must distinguish. */
        verdict: !reached ? 'UNREACHABLE' : (cls.kind === 'AUTH' ? 'PASS' : 'MISCLASSIFIED'),
        error: reached ? body.slice(0, 120) : 'NETWORK_UNAVAILABLE'
      });
    } catch (err) {
      rows.push({ provider: id, httpStatus: 0, reasonCode: 'NETWORK', classifiedAsAuth: false, reached: false, verdict: 'INCONCLUSIVE', error: String(err?.message || err).slice(0, 120), latencyMs: now() - started });
    }
  }
  const reached = rows.filter((r) => r.reached);
  const anyAuth = rows.some((r) => r.classifiedAsAuth);
  const status = !reached.length ? 'INCONCLUSIVE' : (anyAuth ? 'PASS' : 'FAIL');
  return result(test, {
    status,
    reasonCode: !reached.length ? 'NETWORK_UNAVAILABLE' : (anyAuth ? null : 'AUTH_NOT_DETECTED'),
    providers: rows,
    note: 'A 401/403 here is the expected result: the endpoint is reachable and rejects a bad key. It is not reported as connected.'
  });
}

/* -------------------------------------------------------------------------- */
/* Deterministic resilience checks                                            */
/* -------------------------------------------------------------------------- */

function rateLimitTest(test) {
  const synthetic = Object.assign(
    new Error('HTTP 429: {"error":{"message":"rate limit exceeded, too many requests"}}'),
    { status: 429 }
  );
  const cls = classifyAiError(synthetic, 'openai');
  const ok = cls.kind === 'QUOTA' && cls.retryNextModel === false;
  return result(test, {
    status: ok ? 'PASS' : 'FAIL',
    reasonCode: ok ? null : 'MISCLASSIFIED',
    classification: { kind: cls.kind, retryNextModel: cls.retryNextModel, fix: cls.fix },
    note: 'Synthetic 429 through the real classifier. The live account rate limit is NOT deliberately tripped: that would be abusive and could get the key throttled.'
  });
}

async function timeoutTest(test, { chat, providers, now }) {
  const configured = providers.filter((p) => p.configured && p.id !== 'internal');
  if (!configured.length) return skipped(test, 'NEEDS_ONE_PROVIDER');
  const target = configured[0];
  const started = now();
  try {
    /* 1ms is a weaponised deadline: the call MUST not hang. A provider that
       still answers within the guard is fine too — what matters is that the
       process regains control and classifies the outcome. */
    await chat(target.id, { system: 'ping', user: 'ping', maxTokens: 4, temperature: 0, timeout: 1 });
    const elapsed = now() - started;
    return result(test, {
      status: elapsed < 10_000 ? 'PASS' : 'FAIL',
      reasonCode: elapsed < 10_000 ? null : 'HUNG',
      provider: target.id,
      latencyMs: elapsed,
      note: 'Answered despite a 1ms deadline; the important fact is that the call returned control in bounded time.'
    });
  } catch (err) {
    const cls = classifyAiError(err, target.id);
    const elapsed = now() - started;
    const bounded = elapsed < 10_000;
    const classified = ['TIMEOUT', 'NETWORK', 'QUOTA', 'UNKNOWN'].includes(cls.kind);
    return result(test, {
      status: bounded && classified ? 'PASS' : 'FAIL',
      reasonCode: bounded && classified ? null : 'UNBOUNDED_OR_UNCLASSIFIED',
      provider: target.id,
      latencyMs: elapsed,
      classification: { kind: cls.kind, fix: cls.fix },
      error: cls.message.slice(0, 160),
      note: 'The failure is expected. A bounded, classified timeout is the pass condition.'
    });
  }
}

const YES_RE = /(^|\s)(بله|بلی|آری|yes)(\s|$|\.|،|!)/i;
const NO_RE = /(^|\s)(خیر|نه|no)(\s|$|\.|،|!)/i;

function stanceOf(text) {
  const s = String(text || '');
  if (YES_RE.test(s) && !NO_RE.test(s)) return 'YES';
  if (NO_RE.test(s) && !YES_RE.test(s)) return 'NO';
  if (YES_RE.test(s) && NO_RE.test(s)) return 'MIXED';
  return 'UNCLEAR';
}

async function contradictionTest(test, { parallel, providers, now }) {
  const configured = providers.filter((p) => p.configured && p.id !== 'internal').map((p) => p.id);
  if (configured.length < 2) return skipped(test, 'NEEDS_TWO_PROVIDERS');
  const started = now();
  const rows = await parallel({
    providers: configured.slice(0, 4),
    system: 'Answer with exactly one word first (yes or no), then one short sentence of reasoning. Persian is fine.',
    user: 'آیا بیت‌کوین در ۱۲ ماه آینده بهتر از طلا عمل می‌کند؟ فقط با بله یا خیر شروع کن.',
    temperature: 0.5,
    maxTokens: 90,
    json: false
  });
  const answered = rows.filter((r) => r && r.ok !== false && String(r.text || '').trim());
  if (answered.length < 2) {
    return result(test, { status: 'FAIL', reasonCode: 'INSUFFICIENT_ANSWERS', latencyMs: now() - started, answered: answered.length });
  }
  const stances = answered.map((r) => ({ provider: r.provider, model: r.model, stance: stanceOf(r.text), sample: String(r.text).slice(0, 120) }));
  const distinct = new Set(stances.map((s) => s.stance).filter((s) => s !== 'UNCLEAR'));
  return result(test, {
    status: 'PASS',
    reasonCode: null,
    latencyMs: now() - started,
    divergenceDetected: distinct.size > 1,
    stances,
    note: distinct.size > 1
      ? 'The models genuinely disagreed on the same question — the consensus layer has something to judge.'
      : 'The models agreed (or gave no parseable stance). Agreement is not proof; the evidence layer still leads.'
  });
}

async function qualityTest(test, { parallel, providers, now }) {
  const configured = providers.filter((p) => p.configured && p.id !== 'internal').map((p) => p.id);
  if (!configured.length) return skipped(test, 'NEEDS_ONE_PROVIDER');
  const started = now();
  const rows = await parallel({
    providers: configured.slice(0, 4),
    system: 'Follow the instruction exactly. No preamble, no explanation.',
    user: 'فقط عدد ۱۷ را بنویس و هیچ چیز دیگری ننویس.',
    temperature: 0,
    maxTokens: 20,
    json: false
  });
  const scored = rows.map((r) => {
    const text = String(r?.text || '').trim();
    const ok = r && r.ok !== false && text.length > 0;
    const hasNumber = /\b17\b|۱۷/.test(text);
    const brief = text.length <= 24;
    const noPreamble = !/(حتما|البته|در اینجا|sure|here)/i.test(text);
    const score = !ok ? 0 : (hasNumber ? 70 : 0) + (brief ? 20 : 0) + (noPreamble ? 10 : 0);
    return {
      provider: r?.provider || null,
      model: r?.model || null,
      ok: Boolean(ok),
      score,
      text: text.slice(0, 60),
      checks: { hasNumber, brief, noPreamble },
      reasonCode: r?.reasonCode || null
    };
  });
  const executed = scored.filter((s) => s.ok);
  const avg = executed.length ? executed.reduce((a, b) => a + b.score, 0) / executed.length : 0;
  return result(test, {
    status: executed.length && avg >= 70 ? 'PASS' : 'FAIL',
    reasonCode: executed.length && avg >= 70 ? null : 'QUALITY_BELOW_THRESHOLD',
    latencyMs: now() - started,
    averageScore: Math.round(avg),
    providers: scored,
    note: 'Instruction-following on a single exact-answer probe. A narrow but reproducible quality signal — not a general intelligence ranking.'
  });
}

/* -------------------------------------------------------------------------- */
/* Orchestrator                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} opts
 * @param {string[]} [opts.tests]  subset of catalog ids
 * @param {object} [opts.deps]     injectable for offline tests
 */
export async function runProviderLab({ tests = null, deps = {} } = {}) {
  const now = nowOf(deps);
  const chat = deps.chat || ((id, opts) => executeProviderChat(id, opts));
  const routed = deps.routed || ((opts) => routedChat(opts));
  const parallel = deps.parallel || ((opts) => parallelMultiProviderChat(opts));
  const providers = deps.getAvailableProviders ? deps.getAvailableProviders() : getAvailableProviders();
  /* A bounded fetch: an unreachable provider endpoint must become an
     INCONCLUSIVE row in seconds, not hold the whole lab open. */
  const fetchImpl = deps.fetchImpl || ((url, opts = {}) => fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(8000) }));

  const wanted = Array.isArray(tests) && tests.length
    ? TEST_CATALOG.filter((t) => tests.includes(t.id))
    : TEST_CATALOG;

  const startedAt = now();
  const rows = [];

  /* Live direct pings can run in parallel — they are one tiny call each and
     sequential pings turn a 6-provider check into a 30-second wait. */
  const live = wanted.filter((t) => ['gpt', 'claude', 'gemini', 'grok', 'deepseek', 'openrouter'].includes(t.id));
  const liveResults = await Promise.all(live.map((t) => livePing(t, { chat, now, providers })));
  const liveById = new Map(liveResults.map((r) => [r.id, r]));

  for (const test of wanted) {
    if (liveById.has(test.id)) { rows.push(liveById.get(test.id)); continue; }
    if (test.id === 'simultaneous') { rows.push(await simultaneousTest(test, { parallel, providers, now })); continue; }
    if (test.id === 'failover_gpt' || test.id === 'failover_claude') { rows.push(await failoverTest(test, { routed, providers, now })); continue; }
    if (test.id === 'invalid_api') { rows.push(await invalidApiTest(test, { fetchImpl, now })); continue; }
    if (test.id === 'rate_limit') { rows.push(rateLimitTest(test)); continue; }
    if (test.id === 'timeout') { rows.push(await timeoutTest(test, { chat, providers, now })); continue; }
    if (test.id === 'contradiction') { rows.push(await contradictionTest(test, { parallel, providers, now })); continue; }
    if (test.id === 'quality') { rows.push(await qualityTest(test, { parallel, providers, now })); continue; }
    if (test.id === 'cost') {
      const usageRows = rows.flatMap((r) => ([
        r.tokensIn ? { provider: r.provider, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut } : null
      ]).filter(Boolean));
      const byProvider = {};
      for (const u of usageRows) {
        const key = u.provider || 'unknown';
        byProvider[key] = byProvider[key] || { tokensIn: 0, tokensOut: 0, model: u.model };
        byProvider[key].tokensIn += u.tokensIn;
        byProvider[key].tokensOut += u.tokensOut;
        byProvider[key].model = byProvider[key].model || u.model;
      }
      const rowsOut = Object.entries(byProvider).map(([id, v]) => {
        const cost = estimateCostUsd(id, v.model, { promptTokens: v.tokensIn, completionTokens: v.tokensOut });
        return { provider: id, ...v, estimatedUsd: cost.usd, priced: cost.priced, note: cost.priced ? 'ESTIMATE' : cost.reason };
      });
      const totalUsd = Number(rowsOut.reduce((a, r) => a + r.estimatedUsd, 0).toFixed(6));
      rows.push(result(test, {
        status: rowsOut.length ? 'PASS' : 'INCONCLUSIVE',
        reasonCode: rowsOut.length ? null : 'NO_USAGE_REPORTED',
        perProvider: rowsOut,
        totalTokensIn: rowsOut.reduce((a, r) => a + r.tokensIn, 0),
        totalTokensOut: rowsOut.reduce((a, r) => a + r.tokensOut, 0),
        estimatedUsd: totalUsd,
        pricingVersion: PRICING_VERSION,
        note: 'Prices are an explicit ESTIMATE table, not a bill. Providers that do not report usage are counted as unknown, never as free.'
      }));
      continue;
    }
    rows.push({ id: test.id, status: 'SKIPPED', reasonCode: 'NOT_IMPLEMENTED' });
  }

  const finishedAt = now();
  const count = (s) => rows.filter((r) => r.status === s).length;
  /* Only the six DIRECT provider pings are connectivity evidence. A timeout or
     drill that passed is a resilience result, not proof that a provider is
     connected — conflating them is how a fleet reports 6/6 while one model
     answered. */
  const PING_IDS = new Set(['gpt', 'claude', 'gemini', 'grok', 'deepseek', 'openrouter']);
  const connectedProviders = rows
    .filter((r) => PING_IDS.has(r.id) && r.status === 'PASS' && r.provider && r.provider !== 'internal')
    .map((r) => ({ provider: r.provider, model: r.model || null, latencyMs: r.latencyMs ?? null }));

  const report = {
    schema: LAB_SCHEMA,
    version: LAB_VERSION,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    total: rows.length,
    summary: {
      passed: count('PASS'),
      failed: count('FAIL'),
      skipped: count('SKIPPED'),
      inconclusive: count('INCONCLUSIVE'),
      /* Pass count alone is misleading: 6 skipped out of 15 is not 9/15. */
      executed: rows.filter((r) => !['SKIPPED'].includes(r.status)).length,
      connectedProviderCount: connectedProviders.length,
      connectedProviders
    },
    /* `ok` is TRUE only when every executed test passed and at least one LIVE
       provider answered. A run where everything was skipped is not "ok". */
    ok: rows.every((r) => r.status === 'PASS' || r.status === 'SKIPPED') && connectedProviders.length > 0,
    tests: rows,
    fleet: getFleetSummaryLite(),
    health: getProviderHealth(),
    at: now()
  };

  try { await storeSet(LAB_STORE_KEY, report, LAB_STORE_TTL_MS); } catch { /* response still carries it */ }
  return report;
}

function getFleetSummaryLite() {
  const providers = getAvailableProviders();
  const external = providers.filter((p) => p.id !== 'internal');
  return {
    registered: external.length,
    configured: external.filter((p) => p.configured).length,
    keysMissing: external.filter((p) => !p.configured).map((p) => ({ id: p.id, envVar: p.envVar }))
  };
}

export async function getLastLabRun() {
  return storeGet(LAB_STORE_KEY, null);
}

export default runProviderLab;
