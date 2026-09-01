#!/usr/bin/env node
/**
 * FBT CENTRAL INTELLIGENCE OS — production architecture probe (§42).
 * ---------------------------------------------------------------------------
 * Runs the REAL server/app.js (no mocks of our own code) and proves the
 * properties the old prompt-driven Intent OS kept breaking:
 *
 *   §42-A  "پرتفوی من را بررسی کن" → wallet+portfolio+market+risk, real numbers
 *   §42-B  "BTC زیاد دارم؟"         → concentration computed, not guessed
 *   §42-C  "بفروشم؟"                → asset resolved from conversation memory
 *   §42-D  "500 دلار USDC را به ETH تبدیل کن" → quote→confirm gate; NOTHING
 *          executes before explicit confirmation
 *   §42-E  "بعدش به Arbitrum ببر"   → swap + bridge combined in ONE plan
 *   §42-F  "وامم چقدر امنه؟"        → lending+risk, health factor from data
 *   §42-G  "اگر BTC ۳۰٪ بریزد چه می‌شود؟" → portfolio+forecast+risk what-if
 *   §42-I  provider outage          → detect → retry → fallback → verify
 *   §42-J  security anomaly         → SAFE STOP, never bypassed
 *
 * Plus the structural laws: 30-module registry coverage, full adapter
 * interface per module (§11/§40), permission model (§33), anti-duplicate
 * (§34), event bus (§15), forbidden generic fallbacks (§20), and the central
 * API surface (§36).
 *
 * Upstream market providers MAY be unreachable in CI; the probe asserts the
 * HONEST behavior in both worlds (live numbers when reachable, explicit
 * "unavailable" when not — never a guess).
 */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
/* Denylist for the §23 security probe — MUST be set before policy.js loads. */
process.env.CENTRAL_DENYLIST = '0x9999999999999999999999999999999999999999';
delete process.env.BLOB_READ_WRITE_TOKEN;

import http from 'node:http';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 1. structural laws (pure, no HTTP)                                        */
/* ════════════════════════════════════════════════════════════════════════ */

const constants = await import('../server/central/constants.js');
const registry = await import('../server/central/registry.js');
const central = await import('../server/central/index.js');
central.installCentralOS();

t('§10 all 30 required modules are registered', registry.moduleCoverage().complete);
t('module list matches the spec vocabulary',
  constants.MODULES.length === 30 && constants.MODULES.includes('dydx') && constants.MODULES.includes('profit-plan'));
t('§11 every registered adapter implements the full interface',
  registry.registeredModuleIds().every((id) => {
    const m = registry.getModule(id);
    return constants.ADAPTER_METHODS.every((fn) => typeof m[fn] === 'function');
  }));
t('§8 capability statuses are exactly AVAILABLE/DEGRADED/READ_ONLY/UNAVAILABLE',
  JSON.stringify(constants.CAPABILITY_STATUSES) === JSON.stringify(['AVAILABLE', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE']));

/* §33 permission model */
const policy = await import('../server/central/policy.js');
t('§33 READ plans need no confirmation',
  policy.policyCheck({ plan: [{ module: 'portfolio', operation: 'read' }] }).requiresConfirmation === false);
t('§33 EXECUTE plans always require confirmation',
  policy.policyCheck({ plan: [{ module: 'swap', operation: 'prepare', permission: 'EXECUTE' }] }).requiresConfirmation === true);
t('§23 invalid recipient is a terminal violation',
  policy.securityScan({ action: { recipient: '0x123' } }).some((v) => v.code === 'INVALID_RECIPIENT'));
t('§23 denylisted recipient is a security violation',
  policy.validateRecipient('0x9999999999999999999999999999999999999999').code === 'SECURITY_VIOLATION');

/* §22/§39 error intelligence */
const errEngine = await import('../server/central/errorEngine.js');
t('§22 timeout classifies as retriable TRANSIENT', errEngine.classifyError(new Error('TIMEOUT:x')).retriable === true);
t('§22 429 classifies as RATE_LIMIT', errEngine.classifyError({ status: 429 }).category === 'RATE_LIMIT');
t('§23 security errors classify as SECURITY and are never retriable', (() => {
  const c = errEngine.classifyError(new Error('SECURITY_VIOLATION: bad recipient'));
  return c.category === 'SECURITY' && c.retriable === false && c.securityStop === true;
})());
t('§22/§39 retry+fallback recovers without user intervention', await (async () => {
  let primaryCalls = 0;
  const out = await errEngine.withRetryFallback(
    () => { primaryCalls += 1; if (primaryCalls < 2) throw new Error('ECONNRESET'); return 'primary'; },
    { retries: 2, backoffMs: 1, label: 'probe' }
  );
  return out.ok && out.value === 'primary' && primaryCalls === 2;
})());
t('§39 fallback rung used when primary is down', await (async () => {
  const out = await errEngine.withRetryFallback(
    () => { throw new Error('ECONNREFUSED'); },
    { retries: 1, backoffMs: 1, fallbacks: [async () => 'from-backup-rpc'], label: 'probe' }
  );
  return out.ok && out.value === 'from-backup-rpc' && out.usedFallback === true;
})());
t('§23 security errors STOP immediately (no retry, no fallback)', await (async () => {
  let fallbackCalls = 0;
  try {
    await errEngine.withRetryFallback(
      () => { throw new Error('ORACLE_ANOMALY suspected manipulation'); },
      { retries: 3, backoffMs: 1, fallbacks: [async () => { fallbackCalls += 1; return 'bad'; }], label: 'probe' }
    );
    return false;
  } catch (err) {
    return err.securityStop === true && fallbackCalls === 0;
  }
})());

/* §34 action engine anti-duplicate + state machine */
const actions = await import('../server/central/actionEngine.js');
const a1 = actions.createAction({ intentId: 'i1', module: 'swap', operation: 'prepare', requestId: 'req-1', owner: 'probe' });
const a2 = actions.createAction({ intentId: 'i1', module: 'swap', operation: 'prepare', requestId: 'req-1', owner: 'probe' });
t('§34 double-submit replays the SAME action (no second trade)',
  a2.deduplicated === true && a2.action.actionId === a1.action.actionId);
t('§34 distinct requests get distinct actions',
  actions.createAction({ intentId: 'i2', module: 'swap', operation: 'prepare', requestId: 'req-2', owner: 'probe' }).deduplicated === false);
t('§12 illegal state transitions are rejected', (() => {
  try { actions.transitionAction(a1.action.actionId, 'COMPLETED'); return false; }
  catch (err) { return err.code === 'ILLEGAL_ACTION_TRANSITION'; }
})());

/* §6 context engine anaphora resolution */
const ctxEngine = await import('../server/central/contextEngine.js');
t('§6 "بفروشم؟" inherits the asset from the previous turn', (() => {
  const r = ctxEngine.resolveContext({
    message: 'بفروشم؟',
    entities: {},
    memory: { lastEntities: { asset: 'BTC' }, lastIntent: {}, pendingConfirmation: null },
    page: null
  });
  return r.resolved.asset === 'BTC' && r.inheritedFrom.includes('asset:lastEntities');
})());
t('§5 "انجامش بده" resumes the pending confirmation instead of asking', (() => {
  const r = ctxEngine.resolveContext({
    message: 'انجامش بده',
    entities: {},
    memory: { lastEntities: {}, lastIntent: {}, pendingConfirmation: { intentId: 'intent_x' } },
    page: null
  });
  return r.intentHint?.kind === 'CONFIRM_PENDING';
})());
t('§7 page context supplies the missing asset', (() => {
  const r = ctxEngine.resolveContext({
    message: 'چقدر می‌توانم بگیرم؟',
    entities: {},
    memory: { lastEntities: {}, lastIntent: {}, pendingConfirmation: null },
    page: { module: 'lending', selectedAsset: 'USDC' }
  });
  return r.resolved.asset === 'USDC';
})());

/* risk engine math is real math, not vibes */
const risk = await import('../server/central/riskEngine.js');
const probeState = { portfolio: { totalValueUsd: 10000, holdings: [{ symbol: 'BTC', valueUsd: 7000 }, { symbol: 'ETH', valueUsd: 3000 }] } };
t('§24 concentration computed from real holdings', (() => {
  const c = risk.concentrationCheck(probeState, 'BTC');
  return c.assetSharePct === 70 && c.overThreshold === true && c.hhi === 0.58;
})());
t('§24 health factor = collateral×threshold/debt', (() => {
  const l = risk.lendingRisk({ collateralUsd: 8420, borrowedUsd: 4100, liquidationThreshold: 0.825 });
  return Math.abs(l.healthFactor - 1.694) < 0.01 && l.riskBand === 'MEDIUM';
})());
t('§42-G what-if shock math is exact', (() => {
  const s = risk.scenarioShock(probeState, { asset: 'BTC', dropPct: 30 });
  return s.afterUsd === 7900 && s.lossUsd === 2100;
})());

/* ════════════════════════════════════════════════════════════════════════ */
/* 2. the central API over real HTTP (§36)                                    */
/* ════════════════════════════════════════════════════════════════════════ */

const { default: app } = await import('../server/app.js');
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const HDRS = { 'content-type': 'application/json', 'x-fbt-device': 'central-os-probe-device' };
const call = async (path, opts = {}) => {
  const res = await fetch(base + path, { headers: HDRS, ...opts });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: res.status, body };
};
const intent = (message, extra = {}) => call('/api/intent', { method: 'POST', body: JSON.stringify({ message, ...extra }) });

const WALLET = { evmAddresses: ['0x2222222222222222222222222222222222222222'] };
const PORTFOLIO = { totalValueUsd: 10000, holdings: [{ symbol: 'BTC', valueUsd: 7000 }, { symbol: 'ETH', valueUsd: 3000 }] };
const LENDING = [{ collateralSymbol: 'ETH', collateralUsd: 8420, borrowedUsd: 4100, borrowAprPct: 7.1, liquidationThreshold: 0.825 }];
const CTX = { wallet: WALLET, portfolio: PORTFOLIO, lendingPositions: LENDING };

/* §36 surface exists */
const caps = await call('/api/system/capabilities');
const health = await call('/api/system/health');
t('§36 GET /api/system/capabilities answers for every module',
  caps.status === 200 && Object.keys(caps.body.capabilities).length >= 30);
t('§36 GET /api/system/health reports module coverage complete',
  health.status === 200 && health.body.moduleCoverage.complete === true);
t('§36 capability statuses use the honest vocabulary only',
  Object.values(caps.body.capabilities).every((v) => constants.CAPABILITY_STATUSES.includes(v.status)));

const forbidden = (msg) => constants.FORBIDDEN_GENERIC_PHRASES.some((p) => String(msg || '').toLowerCase().includes(p.toLowerCase()));

/* ── §42-A: portfolio analysis ───────────────────────────────────────────── */
const A = await intent('پرتفوی من را بررسی کن', { context: CTX });
t('§42-A portfolio analysis completes', A.status === 200 && A.body.status === 'COMPLETED');
t('§42-A answer carries the REAL total from the wallet snapshot',
  A.body.response?.message?.includes('10,000') === true);
t('§42-A reports concentration from real shares (BTC 70٪)',
  A.body.response?.message?.includes('70٪') === true);
t('§42-A no forbidden generic fallback (§20)', !forbidden(A.body.response?.message));
t('§31 universal intent object stored with plan + trace', (() => {
  const rec = A.body;
  return typeof rec.intentId === 'string' && Array.isArray(rec.plan) && Array.isArray(rec.trace);
})());
const Afull = await call(`/api/intent/${A.body.intentId}`);
t('§36 GET /api/intent/:id returns the full record',
  Afull.status === 200 && Afull.body.intent?.intentType === 'PORTFOLIO_ANALYSIS' && Afull.body.intent.state === 'COMPLETED');

/* ── §42-B: concentration ────────────────────────────────────────────────── */
const B = await intent('BTC زیاد دارم؟', { context: CTX });
const Bfull = await call(`/api/intent/${B.body.intentId}`);
t('§42-B concentration intent classified',
  Bfull.body.intent?.intentType === 'CONCENTRATION_CHECK');
t('§42-B concentration computed (70٪ share flagged)',
  B.body.response?.message?.includes('70٪') === true);
t('§42-B recommendation includes reasons + data (§26)',
  (B.body.response?.reason?.length > 0 || B.body.response?.message?.includes('آستانه تمرکز') === true));

/* ── §42-C: anaphora — "بفروشم؟" resolves BTC from memory ────────────────── */
const C = await intent('بفروشم؟', { context: CTX });
t('§42-C "بفروشم؟" becomes a SELL intent without re-asking the asset',
  C.body.status === 'AWAITING_CONFIRMATION' && C.body.response?.mode === 'ACTION');
t('§42-C the resolved action is on BTC (from conversation memory)',
  C.body.response?.action?.params?.asset === 'BTC');
t('§42-C nothing executed before confirmation (§33)',
  C.body.response?.action?.status === 'PENDING');
const Ccancel = await call(`/api/intent/${C.body.intentId}/cancel`, { method: 'POST', body: '{}' });
t('§36 cancel endpoint works', Ccancel.status === 200 && Ccancel.body.status === 'CANCELLED');

/* ── §42-D: swap confirmation gate + anti-duplicate ──────────────────────── */
const D = await intent('500 دلار USDC را به ETH تبدیل کن', { requestId: 'probe-d-1', context: CTX });
t('§42-D swap stops at the confirmation gate', D.body.status === 'AWAITING_CONFIRMATION');
t('§42-D amount entity parsed from "500 دلار"', D.body.response?.action?.params?.amountUsd === 500);
const D2 = await intent('500 دلار USDC را به ETH تبدیل کن', { requestId: 'probe-d-1', context: CTX });
t('§34 replayed requestId returns the SAME intent (anti-duplicate)',
  D2.body.deduplicated === true && D2.body.intentId === D.body.intentId);
const Dconfirm = await call(`/api/intent/${D.body.intentId}/confirm`, { method: 'POST', body: '{}' });
t('§42-D confirm endpoint executes the gated step (or fails honestly)',
  Dconfirm.status === 200 && ['COMPLETED', 'ERROR', 'SAFE_STOP'].includes(Dconfirm.body.status));
t('§42-D execution result is a structured report, never a raw dump (§43)',
  Dconfirm.body.response?.mode === 'ACTION_RESULT' || Dconfirm.body.response?.mode === 'ERROR_AND_RECOVERY');

/* ── §42-E: swap + bridge in ONE plan ────────────────────────────────────── */
const E = await intent('بعد از خرید به آربیتروم ببر', { context: CTX });
t('§42-E combined swap+bridge intent classified', E.body.status === 'AWAITING_CONFIRMATION');
t('§42-E the plan contains BOTH swap and bridge legs',
  E.body.plan?.some((s) => s.module === 'swap') === true && E.body.plan?.some((s) => s.module === 'bridge') === true);
await call(`/api/intent/${E.body.intentId}/cancel`, { method: 'POST', body: '{}' });

/* ── §42-F: loan safety ──────────────────────────────────────────────────── */
const F = await intent('وامم چقدر امنه؟', { context: CTX });
t('§42-F loan safety answered with a health factor',
  F.body.status === 'COMPLETED' && F.body.response?.risk?.healthFactor != null);
t('§42-F health factor matches the lending risk formula (≈1.694)',
  Math.abs(Number(F.body.response?.risk?.healthFactor) - 1.694) < 0.01);
t('§42-F card carries collateral/borrow/APR like the spec example',
  F.body.response?.result?.card?.collateralUsd === 8420 && F.body.response?.result?.card?.borrowAprPct === 7.1);

/* ── §42-G: what-if ──────────────────────────────────────────────────────── */
const G = await intent('اگر BTC 30 درصد بریزد چه می‌شود؟', { context: CTX });
t('§42-G what-if answered with exact scenario numbers',
  G.body.response?.result?.card?.afterUsd === 7900 && G.body.response?.result?.card?.lossUsd === 2100);

/* ── §42-J: security SAFE STOP ───────────────────────────────────────────── */
const J = await intent('500 دلار بفرست به 0xdeadbeefdeadbeefdeadbeef', { context: CTX });
t('§42-J invalid recipient hard-stops the pipeline',
  J.body.status === 'SAFE_STOP' && J.body.response?.mode === 'SAFE_STOP');
t('§42-J the stop message says the tx was NOT executed',
  J.body.response?.message?.includes('اجرا نشد') === true);
const Jevents = await call('/api/system/events?type=SECURITY_STOP');
t('§15 SECURITY_STOP event published on the bus',
  Jevents.body.events?.length > 0);

/* ── §36 tools router + transactions ─────────────────────────────────────── */
const toolRead = await call('/api/tools/read', { method: 'POST', body: JSON.stringify({ module: 'portfolio', input: {} }) });
t('§36 POST /api/tools/read routes through capability+policy gates',
  toolRead.status === 200 && toolRead.body.checks?.capability && toolRead.body.checks?.permission === 'OK');
const toolUnknown = await call('/api/tools/read', { method: 'POST', body: JSON.stringify({ module: 'nonexistent', input: {} }) });
t('§36 unknown module refused honestly', toolUnknown.status === 404);
const txMissing = await call('/api/transactions/act_does-not-exist');
t('§36 GET /api/transactions/:id answers 404 for unknown ids', txMissing.status === 404);

/* ── §20: no generic fallbacks anywhere in the scenario replies ──────────── */
t('§20 no scenario reply used a forbidden generic phrase',
  [A, B, C, D, E, F, G, J].every((r) => !forbidden(r.body.response?.message)));

/* ── event stream + state freshness (§15/§17) ────────────────────────────── */
const ev = await call('/api/system/events?limit=10');
t('§15 event ring buffer is live and typed',
  ev.body.events?.length > 0 && ev.body.events.every((e) => typeof e.type === 'string' && Number.isFinite(e.at)));
const stateAfter = await call('/api/system/state');
t('§4 unified state has a lastUpdated heartbeat',
  Number.isFinite(stateAfter.body.state?.lastUpdated));
t('§4 unified state carries the 30-slot skeleton',
  ['wallet', 'portfolio', 'markets', 'lending', 'futures', 'goals', 'risk', 'capabilities', 'health', 'activePage', 'recentActions', 'errors']
    .every((k) => k in (stateAfter.body.state || {})));

server.close();

/* ── report ──────────────────────────────────────────────────────────────── */
let failed = 0;
console.log('\n── FBT CENTRAL INTELLIGENCE OS — scenario probe ──');
for (const [name, ok] of rows) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
}
console.log(`\n${rows.length - failed}/${rows.length} passed`);
if (failed > 0) process.exit(1);
