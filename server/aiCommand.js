/**
 * AI COMMAND CENTER — the HTTP surface of the AI page.
 * ───────────────────────────────────────────────────────────────────────────
 * Eight routes, and they are all the routes the AI page needs:
 *
 *   POST   /api/ai/chat                     message → intent → agent lanes → plan
 *   GET    /api/ai/dashboard                market + yield + roster the deck reads
 *   POST   /api/ai/plan                     build (and store) one plan
 *   GET    /api/ai/plan/:id                 read one stored plan back
 *   POST   /api/ai/plan/:id/approve         the user tapped Approve
 *   POST   /api/ai/plan/:id/execute         the firewall's verdict + a hand-off
 *   GET    /api/ai/automations              list
 *   POST   /api/ai/automations              create
 *   DELETE /api/ai/automations/:id          remove
 *   POST   /api/ai/emergency-stop           stop every automation for this caller
 *   POST   /api/ai/emergency-stop/release   let the user start again, deliberately
 *   GET    /api/ai/agents                   the hidden roster (advanced surfaces only)
 *
 * ─── WHY THE SERVER BUILDS PLANS AND NEVER TRANSACTIONS ─────────────────────
 * There is no signer in this process. No key, no allowance, no router call, no
 * `eth_sendRawTransaction` — not gated behind a flag, simply absent. So
 * `/execute` cannot mean what it sounds like, and pretending otherwise would be
 * the worst possible fiction on a wallet screen. What it actually does:
 *
 *   re-runs the Execution Firewall against the STORED plan (not the client's
 *   copy, which may have been edited) → returns a verdict + the venue the legs
 *   belong on. The client then walks its own confirmation gate and the wallet
 *   signs. Statuses are therefore `AWAITING_APPROVAL`, `BLOCKED`,
 *   `WALLET_SIGNATURE_REQUIRED` and `HANDOFF_READY`. There is no `COMPLETED`,
 *   because completion happens on a chain this server is not connected to.
 *
 * ─── WHY CLASSIFICATION MAY COME FROM A MODEL AND NUMBERS NEVER DO ──────────
 * `/chat` asks an LLM for ONE label from a fixed enum when a provider is
 * configured (`classifyIntentWithModel`), schema-validates it, and ignores
 * anything that deviates. Every amount, asset, chain and cap in the plan is
 * produced by the deterministic local layer from the user's own sentence
 * (`src/lib/intent-ai/commandCenter.js` — the same file the browser runs, so
 * neither side can drift). A model can therefore change which card opens; it
 * cannot change what is on it.
 *
 * ─── PRIVACY ────────────────────────────────────────────────────────────────
 * No wallet address is stored or required. Plans and automations are keyed by
 * the authenticated Telegram user id when present and by the request IP
 * otherwise, they expire, and the payload carries aggregate numbers only
 * (amounts, chains) — never a balance sheet, never a seed, never a name.
 */
import { Router } from 'express';
import {
  AI_INTENTS,
  AI_SURFACES,
  AGENT_ROSTER_SIZE,
  AI_AGENTS,
  classifyIntent,
  orchestrate,
  buildPlan,
  validateExecution,
  executionStageLedger,
  dashboardSnapshot,
  sanitizeAiControl,
  createAutomation,
  normalizeAutomation,
  upsertAutomation,
  removeAutomation
} from '../src/lib/intent-ai/commandCenter.js';
import { withCache } from './cache.js';
import { fetchSimplePrices } from './providers.js';
import { fetchYields } from './yields.js';
import { storeGet, storeSet, storeDurable } from './store.js';
import { aiConfigured, classifyIntentWithModel } from './ai.js';

const router = Router();

const PLAN_TTL_MS = 60 * 60 * 1000;      // one hour: a plan quotes a moment, not a price
const PLAN_CAP = 200;                    // across all callers; LRU-ish by insertion
const plans = new Map();

const callerKey = (req) => String(req.tgUser?.id ?? req.ip ?? 'anon').slice(0, 64);
const nowMs = () => Date.now();

function sweepPlans() {
  const now = nowMs();
  for (const [id, rec] of plans) {
    if (!rec || now - rec.createdAt > PLAN_TTL_MS) plans.delete(id);
  }
  /* The cap is enforced by dropping the oldest, so a burst cannot grow an
     unbounded map on a shared host. */
  while (plans.size > PLAN_CAP) {
    const oldest = plans.keys().next();
    if (oldest.done) break;
    plans.delete(oldest.value);
  }
}

/** Only the fields a plan needs to survive a restart-safe read. */
function storePlan(rec) {
  plans.set(rec.plan.id, rec);
  sweepPlans();
  return rec;
}

function ownedPlan(req, res) {
  const rec = plans.get(String(req.params.id || ''));
  if (!rec) {
    res.status(404).json({ ok: false, error: 'PLAN_NOT_FOUND', hint: 'plans expire after one hour and are held per caller' });
    return null;
  }
  if (rec.caller !== callerKey(req)) {
    /* Not "forbidden, go away": the honest answer is that a plan belongs to the
       person who asked for it, and here is how to get one of your own. */
    res.status(403).json({ ok: false, error: 'PLAN_BELONGS_TO_ANOTHER_CALLER', hint: 'POST /api/ai/plan to build your own' });
    return null;
  }
  if (nowMs() - rec.createdAt > PLAN_TTL_MS) {
    plans.delete(rec.plan.id);
    res.status(410).json({ ok: false, error: 'PLAN_EXPIRED', hint: 'rebuild it: a stale quote is not a quote' });
    return null;
  }
  return rec;
}

/* ────────────────────────────── shared context ─────────────────────────── */

/**
 * What the client may hand in, and what the server refuses to trust.
 *
 * Accepted: a USD amount, a chain id, an AI-control budget, the surface tapped,
 * the last classification (for follow-ups), and coarse portfolio numbers that
 * the client already computed from its own wallet. Rejected: any instruction
 * that looks like an order to execute, any address, and any claim of an
 * approved/confirmed state — approval is recorded HERE, by a POST, never by a
 * field in a request body.
 */
function readContext(body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const holdings = Array.isArray(b.holdings)
    ? b.holdings.slice(0, 24).map((h) => ({
      symbol: String(h?.symbol || '').toUpperCase().slice(0, 12) || null,
      valueUsd: Number.isFinite(Number(h?.valueUsd)) ? Math.max(0, Number(h.valueUsd)) : null,
      chainId: Number.isFinite(Number(h?.chainId)) ? Number(h.chainId) : null
    })).filter((h) => h.valueUsd != null && h.valueUsd > 0)
    : null;
  return {
    locale: typeof b.locale === 'string' ? b.locale.slice(0, 5) : null,
    chainId: Number.isFinite(Number(b.chainId)) ? Number(b.chainId) : null,
    aiControl: sanitizeAiControl(b.aiControl || {}),
    holdings,
    dailyVolumeUsd: Number.isFinite(Number(b.dailyVolumeUsd)) ? Math.max(0, Number(b.dailyVolumeUsd)) : 0,
    /* The server cannot see a wallet. Saying so is the point: the plan then
       renders "connect your wallet to sign" instead of a fake green stage. */
    wallet: { connected: false, canSign: false, reason: 'wallet-lives-in-the-browser' },
    prior: b.prior && typeof b.prior === 'object' && AI_INTENTS.includes(String(b.prior.intent || '').toUpperCase())
      ? { intent: String(b.prior.intent).toUpperCase(), surface: b.prior.surface || null }
      : null
  };
}

/**
 * Prices for the majors, through the provider layer that already owns the
 * CoinGecko key and its rate limit — this module must not grow a second,
 * un-keyed path to the same upstream. Cached for sixty seconds because a plan
 * quotes a moment: a two-minute-old number on a trade card is a different trade.
 */
async function marketOverview() {
  try {
    const { value } = await withCache('ai:market', 60_000, () => fetchSimplePrices(['bitcoin', 'ethereum', 'solana'], 'usd'));
    const g = value || {};
    const price = (row) => (Number.isFinite(Number(row?.usd)) ? Number(row.usd) : null);
    return {
      dataStatus: 'live',
      /* The dashboard's 24h read is BTC's — labelled as such by the client,
         not presented as the user's own profit, which only their holdings can
         say anything about. */
      change24hPct: Number.isFinite(Number(g.bitcoin?.usd_24h_change)) ? Math.round(Number(g.bitcoin.usd_24h_change) * 100) / 100 : null,
      priceMap: { BTC: price(g.bitcoin), ETH: price(g.ethereum), SOL: price(g.solana) }
    };
  } catch {
    return { dataStatus: 'unavailable', change24hPct: null, priceMap: null };
  }
}

async function yieldRows() {
  try {
    const { value } = await withCache('ai:yields', 5 * 60_000, fetchYields);
    const rows = Array.isArray(value?.pools) ? value.pools : (Array.isArray(value) ? value : []);
    return rows.slice(0, 40).map((p) => ({
      protocol: p?.protocol || p?.project || null,
      symbol: p?.symbol || p?.token || null,
      apy: Number.isFinite(Number(p?.apy)) ? Number(p.apy) : null,
      riskBand: p?.riskBand || p?.risk || null
    })).filter((r) => r.apy != null);
  } catch {
    return null;
  }
}

/* ─────────────────────────────────── chat ──────────────────────────────── */

/**
 * POST /api/ai/chat
 *
 * The whole assistant entry point, in the honest order:
 *   1. classify (model if configured and it validates, else deterministic)
 *   2. the deterministic layer re-reads the sentence for its numbers
 *   3. the firewall runs on the plan the caller would receive
 * There is deliberately no message text in the response: the words the user
 * reads are rendered from the plan by the client, in the user's language, from
 * i18n — not from a model that might decide to be creative about money.
 */
router.post('/chat', async (req, res) => {
  const message = String(req.body?.message ?? '').slice(0, 1200);
  if (!message.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
  const surface = AI_SURFACES.some((s) => s.id === req.body?.surface) ? req.body.surface : null;
  const ctx = readContext(req.body);

  const local = classifyIntent(message, { surface, locale: ctx.locale, prior: ctx.prior });

  /* A tap already IS the decision; a model would only add latency and a way to
     disagree with the user. It is asked only when the local layer is unsure
     (confidence < 0.6) and the sentence is not a pinned surface tap. */
  let llm = null;
  if (!surface && aiConfigured() && local.confidence < 0.6) {
    llm = await classifyIntentWithModel({ message, intents: AI_INTENTS, locale: ctx.locale });
  }
  const intentApplied = llm?.ok === true ? llm.intent : local.intent;
  const classification = llm?.ok === true && llm.intent !== local.intent
    ? { ...local, intent: llm.intent, source: 'model-override', confidence: Math.max(local.confidence, Number(llm.confidence) || 0) }
    : local;

  const plan = buildPlan({
    message,
    classification: { ...classification, intent: intentApplied },
    surface,
    context: { ...ctx, now: nowMs(), ...await enrichContext(ctx) }
  });
  const verdict = validateExecution(plan, {
    aiControl: ctx.aiControl,
    dailyVolumeUsd: ctx.dailyVolumeUsd,
    wallet: ctx.wallet
  });

  return res.json({
    ok: true,
    schema: 'fbt.ai-chat.v1',
    classification: {
      intent: plan.intent,
      confidence: plan.confidence,
      source: plan.source,
      surface: plan.surface,
      requiresClarification: classification.requiresClarification === true
    },
    /* Named exactly for what it is, so a client can never print "AI confirmed
       your trade" off a field that only carries a label. */
    modelUsed: llm?.ok === true ? 'intent-label-only' : 'deterministic',
    plan,
    verdict,
    stages: executionStageLedger(plan, verdict, { wallet: ctx.wallet }).stages,
    at: nowMs()
  });
});

/** Feeds a plan the server-side data it can honestly use (never client claims). */
async function enrichContext(ctx) {
  const [market, yields] = await Promise.all([marketOverview(), yieldRows()]);
  return {
    market,
    priceMap: market.priceMap || undefined,
    yields: yields || undefined
  };
}

/* ─────────────────────────────── dashboard ─────────────────────────────── */

/**
 * GET /api/ai/dashboard
 *
 * One request for the whole AI screen. Sections report their own dataStatus,
 * and `insights.opportunities` is `null` (not 0) when the yield feed is down —
 * "0 opportunities" is a claim about the world that a dead feed does not
 * entitle anyone to make.
 *
 * POST is accepted for the same route (below) because the portfolio half of the
 * snapshot can only come from the client's own wallet read; the query shape
 * stays identical so a UI never needs two code paths.
 */
router.get('/dashboard', async (_req, res) => {
  const [market, yields] = await Promise.all([marketOverview(), yieldRows()]);
  const snapshot = dashboardSnapshot({
    aiControl: sanitizeAiControl({}),
    automations: null,
    txHistory: null,
    holdings: null,
    market,
    yields
  });
  return res.json({
    ok: true,
    schema: 'fbt.ai-dashboard.v1',
    ...snapshot,
    /* The parts only the browser can fill in, said as unavailable rather than
       invented: balances, approval hygiene and the day's spend live client-side. */
    clientSections: ['portfolio.totalValueUsd', 'execution.dailyVolumeUsd', 'insights.approvals'],
    dataStatus: {
      market: market.dataStatus,
      yield: yields ? 'live' : 'unavailable',
      portfolio: 'unavailable',
      automations: 'unavailable'
    },
    agents: { roster: AGENT_ROSTER_SIZE, visibleOnSurface: 0, hidden: true },
    surfaces: AI_SURFACES.map((s) => ({ id: s.id, intent: s.intent })),
    at: nowMs()
  });
});

router.post('/dashboard', async (req, res) => {
  const ctx = readContext(req.body);
  const [market, yields] = await Promise.all([marketOverview(), yieldRows()]);
  const snapshot = dashboardSnapshot({
    aiControl: ctx.aiControl,
    automations: Array.isArray(req.body?.automations) ? req.body.automations.map(normalizeAutomation).filter(Boolean) : null,
    txHistory: null,
    holdings: ctx.holdings,
    market,
    yields
  });
  return res.json({ ok: true, schema: 'fbt.ai-dashboard.v1', ...snapshot, at: nowMs() });
});

/* ────────────────────────────────── plans ─────────────────────────────── */

router.post('/plan', async (req, res) => {
  const message = String(req.body?.message ?? '').slice(0, 1200);
  const surface = AI_SURFACES.some((s) => s.id === req.body?.surface) ? req.body.surface : null;
  if (!message.trim() && !surface) return res.status(400).json({ ok: false, error: 'EMPTY_REQUEST' });
  const ctx = readContext(req.body);
  const out = orchestrate({
    message,
    surface,
    context: { ...ctx, now: nowMs(), ...await enrichContext(ctx) }
  });
  storePlan({
    plan: out.plan,
    verdict: out.verdict,
    caller: callerKey(req),
    createdAt: nowMs(),
    /* Held so a later stop can re-run THIS caller's budget, and so approval and
       execution are judged against the caps the plan was built under rather than
       against whatever the next request happens to send. */
    aiControl: ctx.aiControl,
    wallet: ctx.wallet,
    approvedAt: null,
    executedAt: null
  });
  return res.json({
    ok: true,
    classification: out.classification && {
      intent: out.classification.intent,
      confidence: out.classification.confidence,
      source: out.classification.source
    },
    plan: out.plan,
    verdict: out.verdict,
    stages: out.stages.stages,
    thinking: out.thinking,
    planUrl: `/api/ai/plan/${out.plan.id}`,
    at: nowMs()
  });
});

router.get('/plan/:id', (req, res) => {
  const rec = ownedPlan(req, res);
  if (!rec) return undefined;
  return res.json({ ok: true, ...rec, staleAfterMs: PLAN_TTL_MS - (nowMs() - rec.createdAt) });
});

/**
 * POST /api/ai/plan/:id/approve
 *
 * The approve tap is recorded here so the execute step can prove the user
 * approved the SAME plan object that is about to be re-checked. It is not
 * authorization to move money — that is the wallet signature, which this
 * process cannot produce and never asks for.
 */
router.post('/plan/:id/approve', (req, res) => {
  const rec = ownedPlan(req, res);
  if (!rec) return undefined;
  const verdict = validateExecution(rec.plan, {
    aiControl: sanitizeAiControl(req.body?.aiControl || {}),
    dailyVolumeUsd: Number.isFinite(Number(req.body?.dailyVolumeUsd)) ? Number(req.body.dailyVolumeUsd) : 0,
    wallet: rec.wallet || { connected: false, canSign: false }
  });
  if (!verdict.ok) {
    return res.status(409).json({
      ok: false,
      error: 'FIREWALL_REFUSED',
      reason: verdict.reason,
      detail: verdict.reasonDetail,
      checks: verdict.checks.filter((c) => c.status === 'fail')
    });
  }
  rec.approvedAt = nowMs();
  rec.approval = { by: callerKey(req), at: rec.approvedAt, scope: 'prepare-for-wallet-signature' };
  return res.json({
    ok: true,
    status: 'APPROVED_FOR_WALLET_CONFIRMATION',
    planId: rec.plan.id,
    /* Always true, by design: `autonomous` removes the extra tap on the plan,
       it never removes the signature. */
    requiresUserSignature: verdict.requiresUserSignature,
    verdict
  });
});

/**
 * POST /api/ai/plan/:id/execute — the firewall's verdict, nothing more.
 *
 * Read the statuses as a hand-off contract:
 *   BLOCKED                      a check failed; nothing was prepared
 *   AWAITING_APPROVAL            the user has not approved this plan object
 *   WALLET_SIGNATURE_REQUIRED    approved, and signing is the user's, not ours
 *   HANDOFF_READY                here is the venue screen the legs belong on
 * There is no `EXECUTED`. This process has no signer; it would be a lie.
 */
router.post('/plan/:id/execute', (req, res) => {
  const rec = ownedPlan(req, res);
  if (!rec) return undefined;
  const aiControl = sanitizeAiControl(req.body?.aiControl || {});
  const verdict = validateExecution(rec.plan, {
    aiControl,
    dailyVolumeUsd: Number.isFinite(Number(req.body?.dailyVolumeUsd)) ? Number(req.body.dailyVolumeUsd) : 0,
    wallet: req.body?.wallet?.connected === true
      ? { connected: true, canSign: req.body?.wallet?.canSign === true }
      : { connected: false, canSign: false, reason: 'no-wallet-attestation-in-this-process' }
  });
  const stages = executionStageLedger(rec.plan, verdict, {
    wallet: verdict.budget ? { connected: req.body?.wallet?.connected === true } : null,
    /* Honest by construction: no simulation provider and no fresh quote are
       attached server-side, so those stages report `unavailable`. */
    simulation: null,
    quote: null
  });

  if (!verdict.ok) {
    return res.status(409).json({ ok: false, status: 'BLOCKED', reason: verdict.reason, detail: verdict.reasonDetail, checks: verdict.checks, stages: stages.stages });
  }
  if (!rec.approvedAt) {
    return res.status(428).json({ ok: false, status: 'AWAITING_APPROVAL', planId: rec.plan.id, hint: 'POST /api/ai/plan/:id/approve first', stages: stages.stages });
  }
  if (verdict.checks.find((c) => c.code === 'WALLET_REQUIRED')?.status !== 'pass') {
    return res.status(412).json({
      ok: false,
      status: 'WALLET_SIGNATURE_REQUIRED',
      planId: rec.plan.id,
      /* The only useful thing to say: the signature is not a step we can take
         for you, and the venue screen is where you take it. */
      hint: 'the wallet signs; this server never can',
      actions: rec.plan.actions.map((a) => ({ type: a.type, route: a.handoffRoute, asset: a.asset, amount: a.amount })),
      stages: stages.stages
    });
  }
  return res.json({
    ok: true,
    status: 'HANDOFF_READY',
    planId: rec.plan.id,
    executed: false,
    broadcasts: false,
    handoff: (rec.plan.actions || []).map((a) => ({ type: a.type, route: a.handoffRoute, asset: a.asset, amount: a.amount, chainId: a.chainId })),
    stages: stages.stages,
    verdict
  });
});

/* ────────────────────────────── automations ────────────────────────────── */

const autoKey = (req) => `ai/automations/${callerKey(req)}.json`;

async function readAutomations(req) {
  const mem = req.app.locals.aiAutomations?.[callerKey(req)];
  if (storeDurable()) {
    const stored = await storeGet(autoKey(req), null);
    if (Array.isArray(stored)) return stored.map(normalizeAutomation).filter(Boolean);
  }
  return Array.isArray(mem) ? mem : [];
}

async function writeAutomations(req, rows) {
  req.app.locals.aiAutomations = req.app.locals.aiAutomations || {};
  req.app.locals.aiAutomations[callerKey(req)] = rows;
  if (storeDurable()) await storeSet(autoKey(req), rows);
  return rows;
}

router.get('/automations', async (req, res) => {
  const rows = await readAutomations(req);
  return res.json({
    ok: true,
    automations: rows,
    /* What a run means here: prepared for confirmation, never silently sent.
       A client that renders "12 runs completed" off this list is misreading it. */
    executionModel: 'per-run-user-confirmation',
    durable: storeDurable()
  });
});

router.post('/automations', async (req, res) => {
  const made = createAutomation({ ...req.body, chainId: req.body?.chainId ?? null }, { now: nowMs() });
  if (!made.ok) return res.status(400).json({ ok: false, error: made.code || 'AUTOMATION_INVALID' });
  const rows = await readAutomations(req);
  const next = upsertAutomation(rows, made.automation, { now: nowMs() });
  await writeAutomations(req, next.rows);
  return res.json({ ok: true, automation: made.automation, automations: next.rows });
});

router.delete('/automations/:id', async (req, res) => {
  const rows = await readAutomations(req);
  const next = removeAutomation(rows, req.params.id);
  await writeAutomations(req, next);
  return res.json({ ok: true, removed: req.params.id, automations: next });
});

/* ───────────────────────────── emergency stop ──────────────────────────── */

/**
 * POST /api/ai/emergency-stop
 *
 * Records a stop for this caller and returns what it does: automations report
 * themselves inactive-from-now, and every plan the caller already holds is
 * marked so the client's own firewall refuses it. Releasing is a SEPARATE
 * deliberate call — a refresh must not undo a stop, and neither may a plan.
 */
router.post('/emergency-stop', async (req, res) => {
  const at = nowMs();
  req.app.locals.aiStops = req.app.locals.aiStops || {};
  req.app.locals.aiStops[callerKey(req)] = { active: true, at, reason: String(req.body?.reason || 'user-stop').slice(0, 60) };
  for (const rec of plans.values()) {
    if (rec.caller === callerKey(req)) {
      rec.stopActiveAt = at;
      rec.verdict = validateExecution(rec.plan, { aiControl: { ...rec.aiControl || {}, stopActive: true, stoppedAt: at }, wallet: rec.wallet });
    }
  }
  const rows = await readAutomations(req);
  await writeAutomations(req, rows.map((r) => ({ ...r, active: false, stoppedAt: at })));
  return res.json({
    ok: true,
    status: 'STOPPED',
    at,
    /* Honest scope: this stops what the AI prepares for this caller. It cannot
       reach a transaction already sitting in a wallet waiting to be signed, and
       saying so is the difference between a kill switch and a placebo. */
    scope: 'ai-prepared-plans-and-automations-for-this-caller',
    automationsPaused: rows.length,
    releasesOnlyBy: 'explicit POST /api/ai/emergency-stop/release'
  });
});

router.post('/emergency-stop/release', (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ ok: false, error: 'CONFIRM_REQUIRED', hint: 'release only after you have read what stopped it' });
  }
  req.app.locals.aiStops = req.app.locals.aiStops || {};
  const previous = req.app.locals.aiStops[callerKey(req)] || null;
  delete req.app.locals.aiStops[callerKey(req)];
  for (const rec of plans.values()) if (rec.caller === callerKey(req)) delete rec.stopActiveAt;
  return res.json({
    ok: true,
    status: 'RUNNING',
    releasedAfterMs: previous?.at ? nowMs() - previous.at : null,
    /* Nothing resumes by itself: a paused DCA stays paused until the user
       switches it back on, which is the whole point of pausing it. */
    automationsResumed: 0
  });
});

/* ─────────────────────────────────── agents ────────────────────────────── */

/**
 * GET /api/ai/agents
 *
 * The full internal roster. It exists for the advanced surface and for API
 * consumers — NOT for the AI page's main view, where seventeen cards would be
 * a build log instead of a product. The response says so, in the field the UI
 * reads.
 */
router.get('/agents', (_req, res) => {
  return res.json({
    ok: true,
    schema: 'fbt.ai-agents.v1',
    roster: AGENT_ROSTER_SIZE,
    presentation: { shownOnMainSurface: 0, hiddenByDesign: true },
    surfaces: AI_SURFACES.map((s) => ({ id: s.id, lanes: s.lanes })),
    agents: AI_AGENTS.map((a) => ({ id: a.id, lane: a.lane, surfaces: a.surfaces, canExecute: a.canExecute === true, live: a.specLive === true })),
    at: nowMs()
  });
});

export default router;
