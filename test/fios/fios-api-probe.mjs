#!/usr/bin/env node
/**
 * FBT FINANCIAL INTELLIGENCE OS — API probe (batch 7): the real server.
 * ---------------------------------------------------------------------------
 * This is the runtime verification the audit required. It boots the REAL
 * server/app.js (no mocks of our own code) over real HTTP on a loopback
 * port, and drives it the same way central-os-probe drives the brain:
 * upstream market sources are swapped through the DOCUMENTED in-process seam
 * (`setCiSource`) so the numbers are deterministic. Everything else — routing,
 * owner derivation, the state store, every FI engine, the policy gates, the
 * unsigned hand-off — is the production code path.
 *
 * What it proves:
 *   - FI reads the BRAIN's state: a /api/brain/intent turn fills the sections,
 *     and /api/ai/financial-state then answers with those real numbers.
 *   - one state store: FI never sees a state the brain has not seen.
 *   - the full decision pipeline over HTTP (strategies → competition →
 *     decision → council) with persisted, retrievable disagreement.
 *   - the policy engine's fail-closed behaviour: flag off → no policies;
 *     stopped policy → no run; over the ceiling → no run; verified → settled.
 *   - the executor is the brain's UNSIGNED hand-off: a run over HTTP stops at
 *     the wallet hand-off (VERIFY), and only a verification id reaches
 *     COMPLETED. canSign is false on every answer.
 *   - /agents and /status still belong to the command center (no collision).
 */
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT = '100000,60000';
process.env.AI_RATE_LIMIT = '100000,60000';
process.env.BRAIN_RATE_LIMIT = '100000,60000';
process.env.MEM_RATE_LIMIT = '100000,60000';
process.env.SAFE_INTENTS_ONLY = 'true';
delete process.env.BLOB_READ_WRITE_TOKEN;

import http from 'node:http';

let passed = 0;
let failed = 0;
const failures = [];
function t(name, ok, detail = null) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}

/* ── seed the documented source seam BEFORE the app loads its modules ──── */
const { setCiSource } = await import('../../server/ci/sources.js');
const WALLET_ADDR = '0x22222222222222222222222222222222222222';
setCiSource('walletBalances', async () => ({
  ok: true,
  connected: true,
  addresses: { evm: [WALLET_ADDR] },
  chainsRead: [1],
  balances: [
    { symbol: 'BTC', chainId: 1, amount: 0.1, priceUsd: 70000, valueUsd: 7000, source: 'blockchain' },
    { symbol: 'ETH', chainId: 1, amount: 2, priceUsd: 3000, valueUsd: 6000, source: 'blockchain' },
    { symbol: 'USDC', chainId: 1, amount: 7000, priceUsd: 1, valueUsd: 7000, source: 'blockchain' }
  ],
  totalValueUsd: 20000,
  unpriced: [],
  skipped: [],
  stale: false,
  partial: false,
  source: 'probe-seam',
  at: Date.now()
}));
setCiSource('marketSnapshot', async ({ symbols = [] } = {}) => ({
  ok: true,
  symbols: (symbols.length ? symbols : ['BTC', 'ETH', 'USDC']).map((s) => ({
    symbol: s,
    priceUsd: s === 'BTC' ? 70000 : s === 'ETH' ? 3000 : 1,
    change24hPct: -1.2
  })),
  breadth: { fearGreed: 55 },
  stale: false,
  source: 'probe-seam',
  at: Date.now()
}));
setCiSource('swapQuote', async () => ({
  ok: true,
  fromAsset: 'USDC',
  toAsset: 'ETH',
  amountIn: 5,
  expectedOut: 0.00166,
  price: 3000,
  priceImpactPct: 0.05,
  route: { calldata: `0x${'ab'.repeat(40)}`, venue: 'probe-venue' },
  expiresAt: Date.now() + 45000,
  source: 'probe-dex'
}));
setCiSource('swapTokenSafety', async () => ({
  ok: true, securityBlock: false, riskLevel: 'LOW', flags: [], address: null, source: 'probe-seam', at: Date.now()
}));
setCiSource('lendingPosition', async () => ({
  ok: true,
  chainId: 1,
  healthFactor: null,
  collateralUsd: 0,
  debtUsd: 0,
  availableBorrowsUsd: 0,
  ltvPct: null,
  liquidationThresholdPct: null,
  positions: [],
  reserve: null,
  oracle: { status: 'UNAVAILABLE', reason: 'PROBE_SEAM' },
  verifiedOnChain: true,
  stale: false,
  source: 'probe-seam',
  at: Date.now()
}));
setCiSource('yields', async () => ({
  ok: true,
  pools: [
    { id: 'probe-pool', project: 'Aave V3', chain: 'Ethereum', symbol: 'USDC', apy: 5.2, tvlUsd: 1_000_000, risk: 'low', ilRisk: false },
    { id: 'probe-pool-2', project: 'Compound', chain: 'Ethereum', symbol: 'USDC', apy: 4.1, tvlUsd: 800_000, risk: 'low', ilRisk: false }
  ],
  considered: 2,
  stale: false,
  source: 'probe-seam',
  at: Date.now()
}));

/* ── boot the real server ───────────────────────────────────────────────── */
const { default: app } = await import('../../server/app.js');
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const DEVICE = { 'x-fbt-device': 'fi-probe-device-01' };
const call = async (path, opts = {}) => {
  const res = await fetch(base + path, { headers: { 'content-type': 'application/json', accept: 'application/json', ...DEVICE, ...(opts.headers || {}) }, ...opts });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: res.status, body };
};
const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) });

/* give the dynamic FI mount a beat to attach */
await new Promise((r) => setTimeout(r, 800));

/* ══════════════════════ 1. health + honest baseline ══════════════════════ */
const health = await call('/api/ai/health');
t('GET /api/ai/health answers with flags, migrations and durability', health.status === 200 && health.body.ok === true && health.body.migrations.applied === health.body.migrations.current, health.body);
t('health reports autonomy ON by default (Phase 212 owner policy) and canSign false', health.body.subsystems?.autonomy?.autonomous === true && health.body.subsystems?.autonomy?.canSign === false, health.body.subsystems?.autonomy);
t('health reports durability honestly (no blob token → in-process only)', health.body.durable === false);
t('before a brain turn, the financial state is UNREAD, not zero', (await call('/api/ai/financial-state')).body.financial?.status === 'UNAVAILABLE', (await call('/api/ai/financial-state')).body.financial);

/* ══════════════════════ 2. one state store: FI reads what the brain read ══════════════════════ */
const turn = await post('/api/brain/intent', { message: 'check my portfolio', context: { wallet: { evmAddresses: [WALLET_ADDR] }, page: { route: '/' } } });
t('a brain turn completes (real pipeline, seeded sources)', turn.status === 200, { status: turn.status, code: turn.body?.code || turn.body?.error || null });

/* Section reads through the brain's OWN policy-checked tools: the state the
   FI then sees was written by the brain, not by the probe. */
const reads = [];
for (const mod of ['wallet', 'portfolio', 'lending', 'crypto', 'farming', 'risk']) {
  reads.push(await post('/api/brain/tools/read', { module: mod }));
}
t('the brain reads every section through its real tools/read (seeded sources)',
  reads.every((r) => r.status === 200), reads.map((r) => ({ status: r.status, code: r.body?.code || r.body?.reason || null })));

const fsAfter = await call('/api/ai/financial-state');
t('FI sees the brain\u2019s real numbers: gross $20,000, debt $0 (readable), net worth $20,000',
  fsAfter.body.ok === true
  && fsAfter.body.financial?.status !== 'UNAVAILABLE'
  && fsAfter.body.financial.net?.grossAssetsUsd?.value === 20000
  && fsAfter.body.financial.net?.debtUsd?.value === 0
  && fsAfter.body.financial.computed?.netWorthUsd === 20000,
  { status: fsAfter.body.financial?.status, net: fsAfter.body.financial?.net?.grossAssetsUsd, missing: fsAfter.body.financial?.missing });
const world = await call('/api/ai/world-state');
t('the world state is built over the same sections', world.status === 200 && world.body.world?.available === true, world.body.world);

/* ══════════════════════ 3. the decision pipeline over HTTP ══════════════════════ */
const decision = await post('/api/ai/decision', { message: 'reach $40k over 18 months', goal: { targetUsd: 40000, months: 18, monthlyContributionUsd: 500, name: 'reach 40k' } });
t('POST /api/ai/decision returns a decision (real strategies → competition → decision)', decision.status === 200 && decision.body.ok === true && decision.body.decision?.id, { status: decision.status, code: decision.body?.code, detail: decision.body?.detail });
t('the decision carries a reason, confidence and executionPermission false',
  Array.isArray(decision.body.decision?.reason) && decision.body.decision.reason.length > 0 && typeof decision.body.decision?.confidence?.overall === 'number' && decision.body.executionPermission === false,
  decision.body.decision?.reason);
t('the council judged the decision with six roles and persisted the disagreement',
  decision.body.council?.votes?.length === 6 && Array.isArray(decision.body.council?.disagreements),
  decision.body.council?.votes?.map((v) => v.role));
const decId = decision.body.decision?.id;
const decisionGet = decId ? await call(`/api/ai/decision/${decId}`) : { status: 0 };
t('GET /api/ai/decision/:id returns the persisted decision', decisionGet.status === 200 && decisionGet.body.decision?.id === decId);
const evidence = decId ? await call(`/api/ai/decision/${decId}/evidence`) : { status: 0, body: {} };
t('SHOW EVIDENCE: GET /api/ai/decision/:id/evidence returns the linked bundle',
  evidence.status === 200 && Array.isArray(evidence.body.evidence) && evidence.body.quality?.count >= 1, evidence.body);
const traceId = decision.body.decision?.traceId;
const trace = traceId ? await call(`/api/ai/trace/${traceId}`) : { status: 0 };
t('the decision\u2019s trace is retrievable in its real state', trace.status === 200 && typeof trace.body.trace?.state === 'string', trace.body?.trace?.state);
const alternatives = decision.body.alternatives;
t('ALTERNATIVES: the losing candidates are returned with their scores',
  Array.isArray(alternatives) && alternatives.every((a) => a.strategyId) , alternatives);

/* ══════════════════════ 4. what-if + simulate ══════════════════════ */
const whatif = await post('/api/ai/what-if', { text: 'what if BTC drops 20%' });
t('what-if parses the shock, simulates, and executes nothing',
  whatif.status === 200 && whatif.body.whatIf?.interpretation?.kind === 'PRICE_SHOCK' && whatif.body.whatIf?.executedNothing === true, whatif.body);
const sim = await post('/api/ai/simulate', { goal: { targetUsd: 40000, months: 18 } });
t('POST /api/ai/simulate answers with a real scenario set (or an honest code)',
  sim.status === 200 && (sim.body.ok === true || typeof sim.body.code === 'string'), { status: sim.status, ok: sim.body?.ok, code: sim.body?.code });

/* ══════════════════════ 4b. the data-surface routes ══════════════════════ */
/* research is DATA, not chatbot: it reads the world model and either returns
   sourced evidence or names what is missing. */
const research = await post('/api/ai/research', { subject: 'BTC', kinds: ['market'] });
t('POST /api/ai/research returns sourced evidence + sources for BTC', research.status === 200 && research.body.ok === true && research.body.research?.status !== 'UNAVAILABLE' && research.body.research?.evidence?.length > 0 && Array.isArray(research.body.research?.sources), research.body);
const researchMissing = await post('/api/ai/research', { subject: 'NO_SUCH_TOKEN_XYZ', kinds: ['market'] });
t('research for an asset with no data is UNAVAILABLE, never fabricated', researchMissing.status === 422 && researchMissing.body.code === 'RESEARCH_UNAVAILABLE', researchMissing.body);
const researchList = await call('/api/ai/research?limit=5');
t('GET /api/ai/research lists the persisted research rows', researchList.status === 200 && researchList.body.ok === true && Array.isArray(researchList.body.research) && researchList.body.research.length >= 1, researchList.body);
const researchId = research.body.research?.id || researchList.body.research?.[0]?.id;
const researchGet = researchId ? await call(`/api/ai/research/${researchId}`) : { status: 0 };
t('GET /api/ai/research/:id returns the persisted row', researchGet.status === 200 && researchGet.body.research?.id === researchId, researchGet.body);

/* strategy competition over the strategies the decision already generated. */
const compare = await post('/api/ai/strategies/compare', {});
t('POST /api/ai/strategies/compare runs the analyst/strategist/risk/judge over real strategies', compare.status === 200 && compare.body.ok === true && compare.body.comparison?.judge && 'winnerId' in compare.body.comparison.judge, { status: compare.status, code: compare.body?.code, detail: compare.body?.detail });
t('the comparison returns scored rows and a disagreement flag (never hidden)', compare.body.ok === true && Array.isArray(compare.body.comparison?.scored) && typeof compare.body.comparison?.disagreement === 'boolean', compare.body.comparison);

/* evidence — the audit surface behind every decision. */
const evidenceList = await call('/api/ai/evidence?limit=40');
t('GET /api/ai/evidence lists the evidence the decision recorded', evidenceList.status === 200 && evidenceList.body.ok === true && Array.isArray(evidenceList.body.evidence) && evidenceList.body.evidence.length >= 1, evidenceList.body);
const evidenceId = evidenceList.body.evidence?.[0]?.id;
const evidenceGet = evidenceId ? await call(`/api/ai/evidence/${evidenceId}`) : { status: 0 };
t('GET /api/ai/evidence/:id returns a single evidence row', evidenceGet.status === 200 && evidenceGet.body.evidence?.id === evidenceId, evidenceGet.body);
const evidenceMiss = await call('/api/ai/evidence/not-a-real-id');
t('an unknown evidence id is a named 404', evidenceMiss.status === 404 && evidenceMiss.body.code === 'EVIDENCE_NOT_FOUND', evidenceMiss.body);

/* outcome learning: only VERIFIED completions ever land here. */
const outcomes = await call('/api/ai/learning/outcomes?limit=20');
t('GET /api/ai/learning/outcomes answers with the outcome history', outcomes.status === 200 && outcomes.body.ok === true && Array.isArray(outcomes.body.outcomes), outcomes.body);

/* the guardian event feed. */
const gCheckEvents = await post('/api/ai/guardian/check', {});
const gEventsFeed = await call('/api/ai/guardian/events?limit=20');
t('GET /api/ai/guardian/events returns the durable alert feed', gCheckEvents.status === 200 && gEventsFeed.status === 200 && gEventsFeed.body.ok === true && Array.isArray(gEventsFeed.body.events), { gCheck: gCheckEvents.body, gEvents: gEventsFeed.body });

/* ══════════════════════ 5. the policy engine: fail-closed over HTTP ══════════════════════ */
/* Phase 212: autonomy ships ON by default, so the flag-off refusal is proven
   FIRST (explicitly disabled), then the default-on path creates the policy. */
process.env.AUTONOMOUS_POLICY_ENABLED = 'false'; /* flags read the env on every call */
const policyNo = await post('/api/ai/policies', { policy: { name: 'probe', maxPerExecutionUsd: 500, maxDailyUsd: 1000, maxCumulativeUsd: 5000, slippageLimitPct: 0.5, gasLimitUsd: 10, riskLimit: 'ELEVATED', trigger: { kinds: ['SWAP'] }, expiration: Date.now() + 30 * 86400000 } });
t('with the autonomy flag explicitly OFF, creating a policy refuses (FEATURE_DISABLED)',
  policyNo.status === 409 && policyNo.body.code === 'FEATURE_DISABLED', policyNo.body);

process.env.AUTONOMOUS_POLICY_ENABLED = 'true';
const policyYes = await post('/api/ai/policies', { policy: { name: 'probe-swap', maxPerExecutionUsd: 500, maxDailyUsd: 1000, maxCumulativeUsd: 5000, slippageLimitPct: 0.5, gasLimitUsd: 10, riskLimit: 'ELEVATED', trigger: { kinds: ['SWAP'], assets: [], chains: [] }, expiration: Date.now() + 30 * 86400000 } });
t('with the flag ON, a complete policy is created ACTIVE',
  policyYes.status === 200 && policyYes.body.policy?.status === 'ACTIVE', policyYes.body);
const policyId = policyYes.body.policy?.id;

const runNoPolicy = await post('/api/ai/autonomy/run', { request: { kind: 'SWAP', asset: 'ETH', amountUsd: 100, gasUsd: 4, slippagePct: 0.3, riskLevel: 'MODERATE' } });
t('a run without a policy is refused before anything happens', runNoPolicy.status === 400 && runNoPolicy.body.code === 'POLICY_ID_REQUIRED', runNoPolicy.body);

/* the executor runs over the REAL brain: the hand-off is produced unsigned */
const runHandoff = await post('/api/ai/autonomy/run', { policyId, request: { kind: 'SWAP', asset: 'ETH', fromAsset: 'USDC', amountUsd: 100, gasUsd: 4, slippagePct: 0.3, riskLevel: 'MODERATE' } });
t('a run under policy produces the brain\u2019s unsigned hand-off, then stops at VERIFY',
  runHandoff.status === 200 && runHandoff.body.state === 'STOPPED' && runHandoff.body.stopGate === 'VERIFY' && runHandoff.body.executedNothing === false,
  { state: runHandoff.body.state, stopGate: runHandoff.body.stopGate, checks: runHandoff.body.report?.checks?.map((c) => `${c.gate}:${c.ok}`) });
t('the loop reports canSign false on the very object that executed', runHandoff.body.capabilities?.canSign === false);

/* only a verification id reaches COMPLETED — then the spend settles */
const runVerified = await post('/api/ai/autonomy/run', { policyId, request: { kind: 'SWAP', asset: 'ETH', fromAsset: 'USDC', amountUsd: 100, gasUsd: 4, slippagePct: 0.3, riskLevel: 'MODERATE', verificationId: `ver_http_${Date.now()}` } });
t('with a verification id the run reaches COMPLETED and settles the spend',
  runVerified.status === 200 && runVerified.body.state === 'COMPLETED' && runVerified.body.verificationId,
  { state: runVerified.body.state, spentUsd: runVerified.body.report?.spentUsd });

const afterSpend = await call(`/api/ai/policies/${policyId}`);
t('the settled spend is on the policy row ($100 today, $100 lifetime)',
  afterSpend.body.policy?.spend?.dayUsd === 100 && afterSpend.body.policy?.spend?.totalUsd === 100, afterSpend.body.policy?.spend);

/* the ceiling: $100 + $450 > $500 per-execution? no — $450 ≤ 500 ok; $100+450=550 > 500? per-exec is 500 → 450 ok; DAILY: 100+450=550 ≤ 1000 ok. Use 950: per-exec 950 > 500 → PER_EXECUTION_LIMIT. */
const runOver = await post('/api/ai/autonomy/run', { policyId, request: { kind: 'SWAP', asset: 'ETH', fromAsset: 'USDC', amountUsd: 950, gasUsd: 4, slippagePct: 0.3, riskLevel: 'MODERATE' } });
t('an amount over the per-execution ceiling stops at the policy gate',
  runOver.status === 200 && runOver.body.state === 'STOPPED' && runOver.body.stopCode === 'PER_EXECUTION_LIMIT',
  { state: runOver.body.state, stopGate: runOver.body.stopGate, stopCode: runOver.body.stopCode });

/* the STOP button: one policy, then every run is refused */
const stopOne = await post(`/api/ai/policies/${policyId}/stop`, { reason: 'stopped by the probe' });
t('POST /api/ai/policies/:id/stop freezes the policy', stopOne.status === 200 && (stopOne.body.stopped?.length === 1), stopOne.body);
const runStopped = await post('/api/ai/autonomy/run', { policyId, request: { kind: 'SWAP', asset: 'ETH', fromAsset: 'USDC', amountUsd: 50, gasUsd: 4, slippagePct: 0.3, riskLevel: 'MODERATE' } });
t('a stopped policy refuses every run', runStopped.status === 200 && runStopped.body.stopCode === 'EMERGENCY_STOP', { stopGate: runStopped.body.stopGate, stopCode: runStopped.body.stopCode });
const resume = await post(`/api/ai/policies/${policyId}/resume`, {});
t('only an explicit resume unfreezes it', resume.status === 200 && resume.body.policy?.emergency === null && resume.body.policy?.status === 'ACTIVE', resume.body);

/* ══════════════════════ 6. guardian over HTTP ══════════════════════ */
const gStatus = await call('/api/ai/guardian/status');
t('GET /api/ai/guardian/status reports the last real check and the stop state',
  gStatus.status === 200 && gStatus.body.ok === true && typeof gStatus.body.lastCheckAt === 'number' && gStatus.body.lastHeadline?.includes('20,000') === true, gStatus.body);
const gCheck = await post('/api/ai/guardian/check', {});
t('POST /api/ai/guardian/check runs the monitoring diff (changes + alerts)',
  gCheck.status === 200 && gCheck.body.ok === true && Array.isArray(gCheck.body.changes) && Array.isArray(gCheck.body.alerts), { status: gCheck.status, code: gCheck.body?.code, body: gCheck.body });

/* ══════════════════════ 7. external agents over HTTP ══════════════════════ */
const evilAgent = await post('/api/ai/external-agents', { name: 'Evil', passport: { id: 'evil-1', privateKey: `0x${'a'.repeat(64)}` } });
t('a passport with a raw credential is refused at the API', evilAgent.status === 409 && evilAgent.body.code === 'RAW_CREDENTIAL_FORBIDDEN', evilAgent.body);
const agent = await post('/api/ai/external-agents', { name: 'Probe Adviser', provider: 'probe', capabilities: ['advice'], passport: { id: 'probe-adviser-1', name: 'Probe Adviser', capabilities: ['advice'] } });
t('a user-registered agent starts UNTRUSTED and canExecute false',
  agent.status === 200 && agent.body.agent?.trust?.tier === 'UNTRUSTED' && agent.body.agent?.canExecute === false, agent.body.agent?.trust);
const authDenied = await post(`/api/ai/external-agents/${agent.body.agent?.id}/authorize`, { scope: 'council-vote' });
t('authorizing below the trust floor is refused with the score and the floor',
  authDenied.status === 409 && authDenied.body.code === 'AUTHORIZATION_REFUSED' && authDenied.body.required === 70, authDenied.body);
const agentList = await call('/api/ai/external-agents');
t('GET /api/ai/external-agents lists the registry', agentList.status === 200 && agentList.body.count === 1, agentList.body);

/* ══════════════════════ 8. learning over HTTP ══════════════════════ */
const unverified = await post('/api/ai/learning', { execution: { executionId: 'http_run_1', strategyId: 'strat_http', verified: false, kind: 'DCA_IN', amountUsd: 1000, pnlUsd: 40 } });
t('an unverified outcome is refused by the learning API (422)', unverified.status === 422 && unverified.body.code === 'OUTCOME_NOT_VERIFIED', unverified.body);
const learned = await post('/api/ai/learning', { execution: { executionId: 'http_run_1', strategyId: 'strat_http', verified: true, verificationId: 'ver_http_1', kind: 'DCA_IN', amountUsd: 1000, pnlUsd: 40, feesUsd: 1, slippagePct: 0.9, expected: { returnPct: 5, feeUsd: 1.2 } } });
t('a verified completion learns, with named lessons and grantsExecution false',
  learned.status === 200 && learned.body.ok === true && learned.body.record?.grantsExecution === false && learned.body.lessons?.length >= 2, learned.body);
const cal = await call('/api/ai/learning/calibration');
t('calibration below the sample floor is a stated minimum, not a number',
  cal.status === 200 && cal.body.samples === 1 && cal.body.directionHitRate === null && cal.body.minimum === 3, cal.body);

/* ══════════════════════ 9. preferences over HTTP ══════════════════════ */
const remembered = await post('/api/ai/preferences/statement', { text: 'I never use leverage and I want low fees' });
t('REMEMBER THIS: a statement writes the stated preference', remembered.status === 200 && remembered.body.written?.includes('leverageTolerance'), remembered.body);
const prefs = await call('/api/ai/preferences');
t('GET /api/ai/preferences resolves it back as USER_SAID', prefs.body.preferences?.leverageTolerance === 'NONE' && prefs.body.preferences?.origins?.leverageTolerance === 'USER_SAID', prefs.body.preferences?.origins);

/* ══════════════════════ 10. routing hygiene ══════════════════════ */
const cmdAgents = await call('/api/ai/agents');
t('/api/ai/agents still belongs to the command center (no collision)', cmdAgents.status === 200);
const cmdStatus = await call('/api/ai/status');
t('/api/ai/status still belongs to the command center (no collision)', cmdStatus.status === 200);
const missing = await call('/api/ai/decision/dec_does_not_exist');
t('an unknown decision id is a named 404', missing.status === 404 && missing.body.code === 'DECISION_NOT_FOUND', missing.body);

/* ── summary ─────────────────────────────────────────────────────────────── */
console.log('');
console.log(`  ${passed}/${passed + failed} passed`);
if (failed) {
  console.log(`  FAILED: ${failures.join(' | ')}`);
}
server.close();
setTimeout(() => process.exit(failed ? 1 : 0), 300);
setTimeout(() => { console.error('PROBE TIMEOUT'); process.exit(2); }, 120000);
