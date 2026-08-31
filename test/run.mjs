#!/usr/bin/env node
/**
 * Test runner:  npm test
 *
 * Three suites, all against the real source (no mocks of our own code):
 *
 *   1. boot      — builds the app as one classic script and boots it in jsdom
 *                  with every external host black-holed. This is the exact
 *                  condition that produced "it just spins forever".
 *   2. gate      — the four-part guide really does refuse to finish until all
 *                  four sections have been opened.
 *   3. flow      — first-launch order: onboarding → guide → app shell, plus
 *                  the replay path from Help.
 *
 * jsdom cannot execute ES modules, which is why each suite is pre-bundled with
 * Vite into a classic/SSR bundle first.
 */
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import './dca-execution-probe.mjs';

/*
 * server/app.js reads its rate budgets at module load, and the FIRST probe
 * to import it wins for the whole process. Pin both here so the learning
 * probe can exercise its own dedicated limiter (a small budget that trips
 * fast) without the broad /api limiter 429ing the rest of the HTTP suites.
 */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.LEARNING_EVENT_RATE_LIMIT = process.env.LEARNING_EVENT_RATE_LIMIT || '3';
/*
 * The sandbox operator (server/intentSandboxOps.js + intentSandboxEvidence.js)
 * self-attests the 21 evidence kinds in dev/preview, which would defeat the
 * fail-closed probes below ("no evidence → no launch"). The suite measures
 * the deployment-independent property, so the sandbox is pinned OFF for the
 * whole run; the real gate lives on the gate function itself (NODE_ENV=test
 * also disables it), and the settings dashboard marks sandbox mode clearly.
 */
process.env.INTENT_AI_SANDBOX_EVIDENCE = process.env.INTENT_AI_SANDBOX_EVIDENCE || '0';
/*
 * The same trap, one budget over: the intent probe walks the full
 * claim/dispute/adjudication/cross-chain lifecycle and exceeds the
 * production settlement budget of 20/min — which it raises to 100 BEFORE
 * importing server/app.js. Now that the calm probe (0d) boots the shared
 * app earlier in the process, the budget must be pinned HERE or whichever
 * probe imports app.js first decides it for everyone.
 */
process.env.INTENT_SETTLEMENT_RATE_LIMIT = process.env.INTENT_SETTLEMENT_RATE_LIMIT || '100';
/*
 * Same module-load trap, one door over: server/app.js captures the Telegram
 * bot token ONCE and hands it to the auth middleware, so whichever probe
 * imports app.js first decides whether an authenticated request is even
 * possible for the rest of the process. The ecosystem-registry probe needs to
 * prove that its write routes reject withdrawFunds/automaticExecution FOR AN
 * AUTHENTICATED CALLER (an anonymous 401 would prove nothing), so a throwaway
 * token is pinned here and the probe signs real initData with it. It is not a
 * secret and never leaves the process: nothing in the suite starts the bot.
 *
 * The pinned value carries a DELIBERATE trailing newline: env stores smuggle
 * exactly this byte into real secrets, and the suite must prove the server
 * trims it (the probes sign with the clean token, the way Telegram would).
 */
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '0000000000:test-only-token-not-a-real-bot\n';
/*
 * Registry writes have their own, much smaller budget than the broad /api one
 * (12/min in production). The probe walks every write route to prove none of
 * them 404s, which is more requests than a real caller makes in a minute, so
 * the budget is raised just enough to let the walk through — and the probe
 * then bursts past it on an isolated key to prove the limiter still bites.
 */
process.env.ECOSYSTEM_WRITE_RATE_LIMIT = process.env.ECOSYSTEM_WRITE_RATE_LIMIT || '25';

const npx = (args) => execFileSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });

/*
 * The shipped-bundle builds must measure what actually ships. Several
 * intent-ai probes set process.env.NODE_ENV = 'test' in-process (so server
 * modules take their fail-closed paths), and execFileSync forwards the whole
 * environment — which makes vite compile a DEVELOPMENT React bundle
 * (plugin-react keys the JSX transform off NODE_ENV) while the IIFE config's
 * define pins `production` in the code, crashing the blackout boot test with
 * "jsxDEV is not a function" and inflating the first-paint budget to the dev
 * artifact. Vercel builds with NODE_ENV=production, and vite itself defaults
 * to production for `build`, so strip the inherited value for the builds
 * that write the shipped `dist/` (boot checks, first-paint budget, and the
 * arcade/speculation chunk scans). The gate/flow/screens suites intentionally
 * keep the inherited value: they need react.development for act().
 */
const npxShip = (args) => {
  const env = { ...process.env };
  delete env.NODE_ENV;
  return execFileSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
};

/** jsdom lacks a handful of globals React and framer-motion expect. */
function installDom(html = '<!doctype html><html><body><div id="r"></div></body></html>') {
  const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  global.window = w;
  global.document = w.document;
  for (const k of ['HTMLElement', 'Element', 'localStorage', 'CustomEvent', 'Node', 'SVGElement', 'Event', 'MutationObserver']) {
    if (w[k]) global[k] = w[k];
  }
  for (const k of ['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
    if (w[k]) global[k] = w[k].bind(w);
  }
  global.matchMedia = w.matchMedia
    ? w.matchMedia.bind(w)
    : () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  Object.defineProperty(global, 'navigator', { value: w.navigator, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

let failed = 0;
const report = (suite, rows) => {
  console.log(`\n── ${suite} ─────────────────────────────`);
  for (const row of rows) {
    const [name, ok] = Array.isArray(row) ? row : [row?.name, row?.ok];
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
};

// Silence React's act() advice and framer-motion's SSR useLayoutEffect notice;
// neither indicates a problem and both drown out real output.
const realError = console.error;
console.error = (...a) => {
  const s = String(a[0] ?? '');
  if (s.includes('useLayoutEffect') || s.includes('act(')) return;
  realError(...a);
};

/* ------------------------------ 0. intent OS client logic ------------------- */
/* Pure logic suite first: the intent compiler, normalizer, memory store and
   solver capabilities. Fast to run, no bundler or DOM needed. */
console.log('▸ probing the intent compiler (pure logic, no DOM)…');
{
  const { default: runIntent } = await import('./intent-probe.mjs');
  report('intent compiler', await runIntent());
}

/* Telegram Mini App login verification: genuine initData must verify even
   when the stored bot token carries a trailing newline or padding spaces
   (the classic env-store poisoning that presents as BAD_SIGNATURE), while
   forged hashes, tampered fields and wrong tokens still fail closed. */
console.log('▸ probing Telegram initData verification (token normalization)…');
{
  const { default: runTelegramAuth } = await import('./telegram-auth-probe.mjs');
  report('telegram auth', await runTelegramAuth());
}

/* --------------------- 0a. intent execution core v2 ------------------------ */
/* Pure logic, no DOM and no network: the lifecycle state machine, the exact
   RPC preflight (against a mock provider), the deterministic route policy and
   the recovery table. These are the modules that stand between "the user
   approved this" and "the wallet signed that", so they run early and fast. */
console.log('▸ probing the intent lifecycle state machine…');
{
  const { default: runLifecycle } = await import('./intent-lifecycle-probe.mjs');
  report('intent lifecycle', await runLifecycle());
}

console.log('▸ probing the exact RPC preflight simulation (mock provider, no network)…');
{
  const { default: runSimulation } = await import('./intent-simulation-probe.mjs');
  report('intent simulation', await runSimulation());
}

console.log('▸ probing deterministic route scoring v2…');
{
  const { default: runRoutePolicy } = await import('./intent-route-policy-probe.mjs');
  report('intent route policy', await runRoutePolicy());
}

console.log('▸ probing the recovery engine…');
{
  const { default: runRecovery } = await import('./intent-recovery-probe.mjs');
  report('intent recovery', await runRecovery());
}

console.log('▸ probing the cross-chain ATOMIC swap (HTLC) boundary…');
{
  const { default: runAtomicSwap } = await import('./intent-atomic-swap-probe.mjs');
  report('intent atomic swap', await runAtomicSwap());
}

console.log('▸ probing actual output extraction from receipt logs…');
{
  const { default: runReceipt } = await import('./intent-receipt-probe.mjs');
  report('intent receipt output', await runReceipt());
}

console.log('▸ probing replaced-transaction tracking…');
{
  const { default: runReplacement } = await import('./intent-replacement-probe.mjs');
  report('intent replacement tracking', await runReplacement());
}

/* --------------------- 0a-1b. anchor fail-safe boundary -------------------- */
/* Pure logic with an injected fake RPC: the optional Phase 6 on-chain anchors
   must stay strictly additive. Config parsing is fail-closed, every RPC /
   receipt / event / confirmation failure is a typed refusal, a failed anchor
   NEVER invalidates the signed auction close, and duplicate submits converge
   on one stored record instead of conflicting documents. */
console.log('▸ probing the anchor fail-safe boundary (fake RPC, no network)…');
{
  const { default: runAnchors } = await import('./intent-anchor-probe.mjs');
  report('intent anchor fail-safe', await runAnchors());
}

/* --------------------- 0a-2. wallet risk / verification helpers ----------- */
/* Pure logic, no DOM and no network: recipient risk classification, gas
   estimates that return null (never zero) when the fee feed is missing, the
   WC-style chain gate, cross-chain asset grouping and the security score. */
console.log('▸ probing the wallet risk / verification helpers…');
{
  const { default: runRisk } = await import('./wallet-risk-probe.mjs');
  report('wallet risk helpers', await runRisk());
}

/* --------------------- 0a-3. FBT Intent AI — Phase 1 Foundation ---------- */
/* Pure logic, no DOM and no network: intent parser, permission levels,
   policy model, Guardian, Strategy Agent, Execution Orchestrator, Draft
   Orders, Human↔AI session, Social Protocol, Stickers, and Audit log.
   Every safety property from the master spec is locked here. */
console.log('▸ probing FBT Intent AI — Phase 1 Foundation (parser · permissions · guardian · agents · audit)…');
{
  const { default: runIntentAI } = await import('./intent-ai/intent-ai-foundation-probe.mjs');
  report('intent-ai phase-1 foundation', await runIntentAI());
}

/* Pure logic, no DOM and no network: intent UNDERSTANDING, measured. The
   parser is the only place natural language enters the system, so this scores
   it against 43 realistic utterances in Persian, English and Arabic — vague
   goals, relative amounts, localised asset names, typos, conjugated verbs,
   recurring buys and questions that must NOT become orders — and fails if the
   recovered-field share drops below the recorded floor. It also locks the
   planner's guarantees: a vague ask still yields a reviewable plan, every
   assumption it had to make is stated, weights sum to 100%, and nothing it
   produces is auto-executed. */
console.log('▸ probing FBT Intent AI — understanding & planning (43-utterance corpus)…');
{
  const { default: runUnderstanding } = await import('./intent-ai/intent-understanding-probe.mjs');
  report('intent-ai understanding & planning', await runUnderstanding());
}

/* Pure logic + source wiring, no DOM and no network: the product limits
   (400k total / 5k per tx / 60% goal / 30 days) enforced with a friendly
   warning, the step-by-step guided chat flow, the visible two-agent
   routing with chat execution, the multi-step continuation, and the UI
   wiring for the interactive confirmation screen, countdown, examples
   accordion, external-agent info modal and dvh chat layout. */
console.log('▸ probing FBT Intent AI — guided flow, product limits & interactive confirmation UI…');
{
  const { default: runGuidedFlow } = await import('./intent-ai/guided-flow-limits-probe.mjs');
  report('intent-ai guided flow & limits', await runGuidedFlow());
}

/* Deep market analysis chat, local tx history and the preparation gate:
   the parser's full asset list, the pending→live analysis enrichment, the
   localStorage receipt record, and the proof that preparation (quote/draft)
   is never gated to L3 while execution always is. */
console.log('▸ probing FBT Intent AI — market analysis chat, local tx history & preparation gate…');
{
  const { default: runMarketChat } = await import('./intent-ai/market-chat-history-probe.mjs');
  report('intent-ai market chat & history', await runMarketChat());
}

console.log('▸ probing FBT Intent AI — Phase 2 Controlled Execution…');
{
  const { default: runGate } = await import('./intent-ai/phase2-confirmation-gate-probe.mjs');
  report('intent-ai phase-2 confirmation gate', await runGate());
  const { default: runRisk } = await import('./intent-ai/phase2-risk-engine-probe.mjs');
  report('intent-ai phase-2 risk engine', await runRisk());
  const { default: runSk } = await import('./intent-ai/phase2-session-key-probe.mjs');
  report('intent-ai phase-2 session keys', await runSk());
  const { default: runFail } = await import('./intent-ai/phase2-fail-closed-probe.mjs');
  report('intent-ai phase-2 fail-closed', await runFail());
  const { default: runE2e } = await import('./intent-ai/phase2-e2e-probe.mjs');
  report('intent-ai phase-2 e2e', await runE2e());
}

console.log('▸ probing FBT Intent AI — Phase 3 Multi-Agent Ecosystem…');
{
  const { default: runCap } = await import('./intent-ai/phase3-capability-token-probe.mjs');
  report('intent-ai phase-3 capability token', await runCap());
  const { default: runDir } = await import('./intent-ai/phase3-directory-probe.mjs');
  report('intent-ai phase-3 agent directory', await runDir());
  const { default: runMa } = await import('./intent-ai/phase3-multi-agent-probe.mjs');
  report('intent-ai phase-3 multi-agent', await runMa());
  const { default: runLearn } = await import('./intent-ai/phase3-learning-optin-probe.mjs');
  report('intent-ai phase-3 learning opt-in', await runLearn());
  const { default: runFail3 } = await import('./intent-ai/phase3-fail-closed-probe.mjs');
  report('intent-ai phase-3 fail-closed', await runFail3());
}

console.log('▸ probing FBT Intent AI — Phase 4 Agent Scoring & Specialist Marketplace…');
{
  const { default: runSc } = await import('./intent-ai/phase4-scoring-probe.mjs');
  report('intent-ai phase-4 agent scoring', await runSc());
  const { default: runMk } = await import('./intent-ai/phase4-marketplace-probe.mjs');
  report('intent-ai phase-4 specialist marketplace', await runMk());
  const { default: runFail4 } = await import('./intent-ai/phase4-fail-closed-probe.mjs');
  report('intent-ai phase-4 fail-closed', await runFail4());
}

console.log('▸ probing FBT Intent AI — Phase 5 Local-First Adaptive Learning…');
{
  const { default: runMem } = await import('./intent-ai/phase5-adaptive-memory-probe.mjs');
  report('intent-ai phase-5 adaptive memory', await runMem());
  const { default: runRef } = await import('./intent-ai/phase5-refine-probe.mjs');
  report('intent-ai phase-5 strategy refine', await runRef());
  const { default: runConf } = await import('./intent-ai/phase5-confidential-probe.mjs');
  report('intent-ai phase-5 confidential collab', await runConf());
}

console.log('▸ probing FBT Intent AI — Phase 6 Live Adapter Wiring (honest, fail-closed)…');
{
  const { default: runLive } = await import('./intent-ai/phase6-live-wiring-probe.mjs');
  report('intent-ai phase-6 live wiring', await runLive());
  const { default: runUnav } = await import('./intent-ai/phase6-unavailable-honest-probe.mjs');
  report('intent-ai phase-6 unavailable honest', await runUnav());
}

console.log('▸ probing FBT Intent AI — Phase 7 Product UI, i18n & Honest Activation…');
{
  const { default: run7 } = await import('./intent-ai/phase7-ui-i18n-probe.mjs');
  report('intent-ai phase-7 ui/i18n/activation', await run7());
}

console.log('▸ probing FBT Intent AI — Phase 8 Production Activation & Secret Boundary…');
{
  const { default: run8 } = await import('./intent-ai/phase8-activation-probe.mjs');
  report('intent-ai phase-8 activation/secret boundary', await run8());
}

console.log('▸ probing FBT Intent AI — Phase 9 Intent OS contracts…');
{
  const { default: run9 } = await import('./intent-ai/phase9-intent-os-probe.mjs');
  report('intent-ai phase-9 intent OS', await run9());
}

/* Phase 10 is a fail-closed contract probe. It runs as a standalone module so
 * it can also be invoked directly with `npm run test:phase10`; importing it
 * here keeps the normal test command from silently skipping the trust plane. */
console.log('▸ probing FBT Intent AI — Phase 10 External Agent trust plane…');
await import('./intent-ai/phase10-agent-trust-probe.mjs');

/* The official specification phases 11–20 are imported into the normal test
 * command as well as exposed as individual npm scripts. Their probes use
 * injected doubles only for deterministic boundaries; the runtime status still
 * stays unavailable unless real provider/evidence is present. */
const laterPhaseProbes = [
  [11, './intent-ai/phase11-strategy-competition-probe.mjs'],
  [12, './intent-ai/phase12-smart-wallet-policy-probe.mjs'],
  [13, './intent-ai/phase13-live-recurring-probe.mjs'],
  [14, './intent-ai/phase14-genome-memory-probe.mjs'],
  [15, './intent-ai/phase15-external-runtime-probe.mjs'],
  [16, './intent-ai/phase16-adapter-activation-probe.mjs'],
  [17, './intent-ai/phase17-onchain-policy-probe.mjs'],
  [18, './intent-ai/phase18-observability-proof-probe.mjs'],
  [19, './intent-ai/phase19-security-compliance-probe.mjs'],
  [20, './intent-ai/phase20-launch-governance-probe.mjs'],
  [21, './intent-ai/phase21-operational-activation-probe.mjs'],
  [22, './intent-ai/phase22-registry-ca-ops-probe.mjs'],
  [23, './intent-ai/phase23-sandbox-mesh-probe.mjs'],
  [24, './intent-ai/phase24-sim-monitor-ops-probe.mjs'],
  [25, './intent-ai/phase25-signer-guardian-ops-probe.mjs'],
  [26, './intent-ai/phase26-venue-federation-probe.mjs'],
  [27, './intent-ai/phase27-rpc-policy-ops-probe.mjs'],
  [28, './intent-ai/phase28-audit-dr-ops-probe.mjs'],
  [29, './intent-ai/phase29-assurance-network-probe.mjs'],
  [30, './intent-ai/phase30-launch-control-plane-probe.mjs'],
  [31, './intent-ai/phase31-incident-command-probe.mjs'],
  [32, './intent-ai/phase32-secret-rotation-probe.mjs'],
  [33, './intent-ai/phase33-failover-capacity-probe.mjs'],
  [34, './intent-ai/phase34-abuse-rate-limits-probe.mjs'],
  [35, './intent-ai/phase35-public-disclosure-probe.mjs'],
  [36, './intent-ai/phase36-residency-hold-probe.mjs'],
  [37, './intent-ai/phase37-dependency-attestation-probe.mjs'],
  [38, './intent-ai/phase38-continuous-verification-probe.mjs'],
  [39, './intent-ai/phase39-gameday-rehearsal-probe.mjs'],
  [40, './intent-ai/phase40-sustainment-governance-probe.mjs'],
  [41, './intent-ai/phase41-release-train-probe.mjs'],
  [42, './intent-ai/phase42-break-glass-probe.mjs'],
  [43, './intent-ai/phase43-cost-kill-spend-probe.mjs'],
  [44, './intent-ai/phase44-workforce-access-probe.mjs'],
  [45, './intent-ai/phase45-telemetry-integrity-probe.mjs'],
  [46, './intent-ai/phase46-model-supply-probe.mjs'],
  [47, './intent-ai/phase47-agent-fleet-probe.mjs'],
  [48, './intent-ai/phase48-capital-bond-probe.mjs'],
  [49, './intent-ai/phase49-regulatory-reporting-probe.mjs'],
  [50, './intent-ai/phase50-program-control-probe.mjs'],
  /* Arc A — real execution (phases 51-57). */
  [51, './intent-ai/phase51-wallet-signing-probe.mjs'],
  [52, './intent-ai/phase52-live-quote-probe.mjs'],
  [53, './intent-ai/phase53-broadcast-tracking-probe.mjs'],
  [54, './intent-ai/phase54-bridge-execution-probe.mjs'],
  [55, './intent-ai/phase55-mev-shield-probe.mjs'],
  [56, './intent-ai/phase56-receipt-taxonomy-probe.mjs'],
  [57, './intent-ai/phase57-live-dca-probe.mjs'],
  [58, './intent-ai/phase58-live-market-regime-probe.mjs'],
  [59, './intent-ai/phase59-alert-proposals-probe.mjs'],
  [60, './intent-ai/phase60-live-why-probe.mjs'],
  [61, './intent-ai/phase61-live-goal-progress-probe.mjs'],
  [62, './intent-ai/phase62-honest-backtest-probe.mjs'],
  [80, './intent-ai/phase80-adaptive-risk-probe.mjs'],
  [81, './intent-ai/phase81-asset-screening-probe.mjs'],
  [82, './intent-ai/phase82-address-shield-probe.mjs'],
  [83, './intent-ai/phase83-approval-hygiene-probe.mjs'],
  [84, './intent-ai/phase84-simulation-gate-probe.mjs'],
  [63, './intent-ai/phase63-session-persistence-probe.mjs'],
  [64, './intent-ai/phase64-cross-device-probe.mjs'],
  [65, './intent-ai/phase65-portfolio-ledger-probe.mjs'],
  [66, './intent-ai/phase66-consented-memory-probe.mjs'],
  [67, './intent-ai/phase67-notifications-probe.mjs'],
  [68, './intent-ai/phase68-access-recovery-probe.mjs'],
  [75, './intent-ai/phase75-onchain-receipt-probe.mjs'],
  [76, './intent-ai/phase76-audit-timeline-probe.mjs'],
  [77, './intent-ai/phase77-terms-diff-probe.mjs'],
  [78, './intent-ai/phase78-third-party-verification-probe.mjs'],
  [79, './intent-ai/phase79-bug-bounty-probe.mjs'],
  [69, './intent-ai/phase69-agent-protocol-v2-probe.mjs'],
  [70, './intent-ai/phase70-agent-escrow-probe.mjs'],
  [71, './intent-ai/phase71-agent-sandbox-probe.mjs'],
  [72, './intent-ai/phase72-agent-dispute-probe.mjs'],
  [73, './intent-ai/phase73-live-venue-routing-probe.mjs'],
  [74, './intent-ai/phase74-live-marketplace-probe.mjs'],
  [85, './intent-ai/phase85-regional-edge-probe.mjs'],
  [86, './intent-ai/phase86-parser-locale-parity-probe.mjs'],
  [87, './intent-ai/phase87-regional-compliance-probe.mjs'],
  [88, './intent-ai/phase88-fiat-ramp-boundary-probe.mjs'],
  [89, './intent-ai/phase89-intent-chaos-probe.mjs'],
  [90, './intent-ai/phase90-fee-integrity-probe.mjs'],
  [91, './intent-ai/phase91-plan-governance-probe.mjs'],
  [92, './intent-ai/phase92-data-lifecycle-probe.mjs'],
  [93, './intent-ai/phase93-accessibility-probe.mjs'],
  [94, './intent-ai/phase94-offline-queue-probe.mjs'],
  /* Arc I — governance and closing (phases 95-100). */
  [95, './intent-ai/phase95-public-api-probe.mjs'],
  [96, './intent-ai/phase96-param-governance-probe.mjs'],
  [97, './intent-ai/phase97-gradual-autonomy-probe.mjs'],
  [98, './intent-ai/phase98-human-oversight-probe.mjs'],
  [99, './intent-ai/phase99-long-term-survival-probe.mjs'],
  [100, './intent-ai/phase100-user-sovereignty-probe.mjs'],
  /* Phases 151–200 share one bounded-autonomy control-plane probe. */
  [151, './intent-ai/phase151-autonomous-recovery-probe.mjs']
];
for (const [phase, probe] of laterPhaseProbes) {
  console.log(`▸ probing FBT Intent AI — Phase ${phase} contract…`);
  const module = await import(probe);
  if (Array.isArray(module.default)) report(`intent-ai phase-${phase}`, module.default);
}

/*
 * Arc K — the control rail and whether it can be operated (phases 141-142).
 *
 * These two are run as child processes rather than imported, because they
 * self-execute and report through their exit code instead of exporting rows.
 * They were also NOT part of `npm test` until now, which is how a control
 * could be deleted from one screen and never rebuilt on another while every
 * imported probe stayed green. Phase 142 exists for exactly that regression:
 * it asserts the gate is reachable from a screen, not merely that the state
 * machine works when called directly.
 */
const RAIL_PROBES = [
  [141, './intent-ai/phase141-rail-layout-probe.mjs'],
  [142, './intent-ai/phase142-reachability-probe.mjs']
];
for (const [phase, probe] of RAIL_PROBES) {
  console.log(`▸ probing FBT Intent AI — Phase ${phase} contract…`);
  let ok = false;
  let detail = '';
  try {
    const out = execFileSync(process.execPath, [new URL(probe, import.meta.url).pathname], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    ok = true;
    detail = String(out).trim().split('\n').slice(-1)[0].slice(0, 80);
  } catch (error) {
    detail = String(error?.stdout || error?.message || '').trim().split('\n').slice(-1)[0].slice(0, 160);
  }
  report(`intent-ai phase-${phase}`, [[`phase ${phase} passes${detail ? ` — ${detail}` : ''}`, ok]]);
}
console.log('▸ probing FBT Intent AI — draft → transaction bridge…');
{
  const { default: bridgeResults } = await import('./intent-ai/draft-transaction-bridge-probe.mjs');
  if (Array.isArray(bridgeResults)) report('intent-ai draft-transaction-bridge', bridgeResults);
  const { default: upgradeResults } = await import('./intent-ai/phase201-207-upgrade-probe.mjs');
  if (Array.isArray(upgradeResults)) report('intent-ai phase 201-207 upgrades', upgradeResults);
}

console.log('▸ probing the Financial OS — Financial Goals (engine · storage · API · wiring)…');
{
  const { default: goalRows } = await import('./financial-goals-probe.mjs');
  if (Array.isArray(goalRows)) report('financial goals', goalRows);
}

console.log('▸ probing FBT Intent AI — authoritative status routes…');
console.log('▸ probing the free Upstash durable-store fallback…');
{
  const module = await import('./upstash-store-probe.mjs');
  if (Array.isArray(module.default)) report('upstash durable store', module.default);
}

await import('./intent-ai/phase-status-probe.mjs');

console.log('▸ probing FBT Intent AI — operational drills (backup/restore · rollback · sandbox · policy)…');
{
  const { default: opsRows } = await import('./intent-ai/ops-drill-probe.mjs');
  if (Array.isArray(opsRows)) report('intent-ai ops drills', opsRows);
}

console.log('▸ probing FBT Intent AI — stage 3 (signer · guardian · broker · bridge · review intake)…');
{
  const { default: stage3Rows } = await import('./intent-ai/stage3-probe.mjs');
  if (Array.isArray(stage3Rows)) report('intent-ai stage 3', stage3Rows);
}

console.log('▸ probing FBT Intent AI — later-phase 31–100 (in-process work, honest third-party gaps)…');
{
  const { default: laterRows } = await import('./intent-ai/later-phase-probe.mjs');
  if (Array.isArray(laterRows)) report('intent-ai later-phase', laterRows);
}

/* ------------------------------ 0b. WalletConnect wiring -------------------- */
/* Static analysis of WalletContext.jsx for the two historical bugs (localhost
   origin, icon 404) and the project-id single-source-of-truth rule. */
console.log('▸ checking WalletConnect wiring (no bundler, no DOM)…');
{
  const { default: runWcWiring } = await import('./walletconnect-wiring.mjs');
  report('WalletConnect wiring', runWcWiring());
}

/* ------------------------------ 0c. WalletConnect behavior ------------------ */
/* Structural tests of the connect/disconnect guards in WalletContext.jsx. */
console.log('▸ checking WalletConnect behavior guards…');
{
  const { default: runWcConnect } = await import('./wc-connect-probe.mjs');
  report('WalletConnect behavior', runWcConnect());
}

/* ------------------------------ 0c-2. WC "spins forever" regression --------- */
/* Runtime probe (not a grep): proves a blocked-relay connect attempt is
   bounded by a real timeout instead of spinning for 60-90+ seconds. */
console.log('▸ probing the WalletConnect connect timeout (the "spins forever" fix)…');
{
  const { default: runWcTimeout } = await import('./wc-timeout-probe.mjs');
  report('WalletConnect connect timeout', await runWcTimeout());
}

/* ------------------------------ 0c-3. WC storage hygiene ------------------- */
/* Runtime probe: purgeWcStorage removes exactly the SDK/AppKit connection
   artifacts — the stale deep-link choice and persisted session that made the
   next connect skip the modal and open a wallet app with a dead pairing. */
console.log('▸ probing WalletConnect storage hygiene (stale deep-link/session cleanup)…');
{
  const { default: runWcStorage } = await import('./wc-storage-probe.mjs');
  report('WalletConnect storage hygiene', runWcStorage());
}

/* ------------------------------ 0c-4. WC chain resolution ------------------ */
/* Runtime probe: the connected chain must come from the session the wallet
   approved, not the SDK's required-chain default — the difference between
   showing the user's real tokens and hiding them on the wrong network. */
console.log('▸ probing WalletConnect chain resolution (Trust-on-Ethereum reports 56)…');
{
  const { default: runWcChain } = await import('./wc-chain-probe.mjs');
  report('WalletConnect chain resolution', runWcChain());
}

/* ------------------------------ 0d. calm music (HTTP + filters) ------------ */
/* Real HTTP against the real route with a stubbed archive.org: the bug was
   an empty catalogue being cached for six hours while the panel rendered
   nothing. Locks both ends of that failure. */
console.log('▸ probing the calm music endpoint and filters…');
{
  const { default: calmRows } = await import('./calm-probe.mjs');
  report('calm music', calmRows);
}

/* --------------------- 0d2. Solana price (the 2026-08 outage) ------------- */
/* Real HTTP against the real Solana routes with both upstreams stubbed. The
   bug: OpenOcean's Solana endpoint moved behind a whitelist, so keyless
   server calls were refused and the client read that as a dead network — no
   price, on every user network, no matter how often it refreshed. The server
   half proves the refusal passes through, the key is attached server-side,
   and status/readiness report honestly; the client half (Vite-bundled, like
   units) proves the error tags and the Jupiter fallback that keep the screen
   alive without a key. */
console.log('▸ probing the Solana price path (OpenOcean whitelist + Jupiter fallback)…');
{
  const { default: solanaServerRows } = await import('./solana-price-probe.mjs');
  report('solana price (server: key, status, fallback proxy)', solanaServerRows);
  npx(['vite', 'build', '-c', 'test/vite.solana-client.mjs', '--logLevel', 'error']);
  const { default: solanaClientRows } = await import('./.out/solana-client/solana-client-probe.js');
  report('solana price (client: error tags, Jupiter fallback)', solanaClientRows);
}

/* --------------------------- 0d₂. P2P market proxy -------------------------- */
/*
 * The /buy + /p2p directory became an in-app market over Hodl Hodl. The whole
 * contract — the side inversion, both payment-method shapes, min/max, the
 * env-only referral, the parameter allow-list, honest 429/503 mapping, stale
 * serving, and the BIP-173/350 address validator — is exercised end to end
 * over real HTTP with the upstream stubbed. A regression in any of them was
 * precisely a bug that very nearly shipped.
 */
console.log('▸ probing the P2P market proxy (side mapping · allow-list · referrals · bech32)…');
{
  const { default: p2pRows } = await import('./p2p-market-probe.mjs');
  report('P2P market (server: proxy contract)', await p2pRows);
}

/* ------------------------ 0d₂. Wallex buy/sell proxy ------------------------ */
/*
 * The Iranians-only tab: key custody (user header wins; env key only behind
 * the explicit WALLEX_SERVER_KEY_ALLOW opt-in, trimmed), fail-closed private
 * routes, order-body validation before egress, the never-echo guarantee, and
 * the Persian-only gate + full-locale copy + light-theme rules on the client.
 */
console.log('▸ probing the Wallex buy/sell proxy (key custody · validation · fa-only gate)…');
{
  const { default: wallexRows } = await import('./wallex-proxy-probe.mjs');
  report('Wallex proxy (key custody · fa-only tab)', wallexRows);
}


/* ------------------------- 0d₃. Internal BTC wallet ------------------------- */
/*
 * The BIP-84 leg on the same seed: derivation pinned to the official BIP-84
 * vector, the BIP-143 P2WPKH signature reproduced byte-for-byte from the
 * BIP's own example, the all-UTXO builder's failure modes, and the /api/btc
 * proxy contract (checksum allow-list before any egress, integer sats,
 * honest 429/503/502 — never 500).
 */
console.log('▸ probing the internal BTC wallet (BIP-84 · BIP-143 · /api/btc proxy)…');
{
  const { default: btcRows } = await import('./btc-wallet-probe.mjs');
  report('BTC wallet (BIP-84 · BIP-143 · proxy)', btcRows);
}

/* ------------------------------ 0e. safe refresh ---------------------------- */
/* The refresh contract: single-flight, guard-respecting, storage-untouching. */
console.log('▸ probing the safe-refresh contract…');
{
  const { default: refreshRows } = await import('./refresh-probe.mjs');
  report('safe refresh', refreshRows);
}

/* ------------------------------ 0f. signals page --------------------------- */
/*
 * The enhanced Signals page (asset tabs, market regime chip, completed signal
 * card, derivatives layer, on-chain row, Create Intent) is verified in three
 * ways against the real code: the Solana on-chain module is fail-closed (no
 * key ⇒ { configured:false }, a key never leaks, an empty upstream nulls its
 * metrics); the signal card hides every data-less section rather than showing
 * an empty box; and the JSX carries no hardcoded fa/ar. Pure logic + source
 * read, no bundler or DOM.
 */
console.log('▸ probing the Signals page (fail-closed + no hardcoded fa/ar)…');
{
  const { default: signalsRows } = await import('./signals-probe.mjs');
  report('signals page', await signalsRows());
}

/* ------------------------------ 1. units -------------------------------- */
/* Pure logic first: it is the fastest suite and the one whose failures point
   most precisely at a cause. Bundled with Vite so extensionless imports and
   `import.meta.env` resolve exactly as they do in the app. */
console.log('▸ building unit suite…');
npx(['vite', 'build', '-c', 'test/vite.units.mjs', '--logLevel', 'error']);
installDom();
const { default: runUnits } = await import('./.out/units/units.js');
report('units (tokens · payout · faq · news)', await runUnits());

/* ------------------------------- 1. boot -------------------------------- */
/* The repository intentionally does not track dist/. Build the shipped static
   bundle here so `npm test` is self-contained in a fresh clone rather than
   depending on somebody having run `npm run build` first. */
console.log('▸ building shipped static bundle for boot checks…');
npxShip(['vite', 'build', '--logLevel', 'error']);
console.log('▸ building app as a classic script for jsdom…');
npxShip(['vite', 'build', '-c', 'test/vite.iife.mjs', '--logLevel', 'error']);
console.log('▸ running boot test with all external hosts unreachable…');
const bootRows = (await import('./boot-e2e.mjs')).default;
report('boot under a dead network', bootRows);

/* ------------------------------- 2. gate -------------------------------- */
console.log('\n▸ building guide-gate suite…');
npx(['vite', 'build', '-c', 'test/vite.gate.mjs', '--logLevel', 'error']);
installDom();
const { run: runGate } = await import('./.out/gate/guide-gate.js');
report('guide gate', await runGate(document.getElementById('r')));

/* ------------------------------- 3. flow -------------------------------- */
console.log('\n▸ building first-launch-flow suite…');
npx(['vite', 'build', '-c', 'test/vite.flow.mjs', '--logLevel', 'error']);
installDom();
const { run: runFlow } = await import('./.out/flow/first-launch-flow.js');
report('first-launch flow', await runFlow(document.getElementById('r')));

/* ------------------------------ 4. screens ------------------------------- */
/* Lazy routes fail silently: a broken import in News or Swap does not break
   the build and does not break the boot test either — it breaks for whoever
   taps that tab. Mount each one directly. */
console.log('\n▸ building screen smoke suite…');
npx(['vite', 'build', '-c', 'test/vite.screens.mjs', '--logLevel', 'error']);
installDom();
const { run: runScreens } = await import('./.out/screens/screens.js');
report('screen smoke (all 12 languages)', await runScreens(document.getElementById('r')));

/* --------------- 4a. the Iranians-only Wallex tab (fa ONLY) --------------- */
/* The owner's hard rule, proven BEHAVIORALLY: the Buy page is walked through
   en → fa → ar → tr → fa with the real i18n, and the Wallex tab + panel may
   exist only while the live language is Persian. */
console.log('\n▸ building Wallex fa-only gate suite…');
npx(['vite', 'build', '-c', 'test/vite.wallex-gate.mjs', '--logLevel', 'error']);
installDom();
const { run: runWallexGate } = await import('./.out/wallex-gate/wallex-gate.js');
report('Wallex tab (fa-only gate, live walk)', await runWallexGate(document.getElementById('r')));

/* --------------------- 4b. coin detail under real data -------------------- */
/*
 * The screen suite mounts `<CoinDetail />` with NO id, which takes the
 * not-found branch and exercises almost nothing — analyze(), VerdictPanel,
 * HistoryPanel and CandleChart are all skipped.
 *
 * That gap is why «بعضی اوقات ... کرش میکنه» could be reported while the suite
 * stayed green. This mounts the page against sixteen real response shapes in
 * both chart modes, and asserts the route boundary recovers from the actual
 * cause: a lazy chunk that fails to load after a deploy.
 */
console.log('\n▸ building coin-detail data suite…');
npx(['vite', 'build', '-c', 'test/vite.coindetail.mjs', '--logLevel', 'error']);
installDom();
const { run: runCoinDetail } = await import('./.out/coindetail/coindetail-probe.js');
report('coin detail (real data shapes · chunk recovery)', await runCoinDetail(document.getElementById('r')));

/* ------------------ 4c. Intent AI panel, driven like a user ------------------ */
/*
 * Every intent-ai probe so far tests the LOGIC. None of them can catch the
 * wiring bug the user actually reported: «the Confirm and Reauthorize
 * buttons do not work» — an onClick nobody wired, a state flag nobody
 * sets, a handler that silently returns. Source-level greps prove a
 * literal exists somewhere in the file; they cannot prove the button
 * does anything when pressed.
 *
 * So this mounts the REAL panel and drives it through the keyboard:
 * greeting + task chips, a guided-flow quick reply, the interactive
 * confirmation screen with an over-limit edit (warning + blocked
 * confirm), the final confirm that runs the real executeConfirmed path,
 * REAUTHORIZE re-opening the gate, a timed goal's live countdown, the
 * examples accordion, and the external-agent info modal. The network is
 * dead on purpose — the panel must work with discovery unavailable.
 */
console.log('\n▸ building intent-ai panel interaction suite…');
npx(['vite', 'build', '-c', 'test/vite.intentai.mjs', '--logLevel', 'error']);
installDom();
const { run: runIntentAIPanel } = await import('./.out/intentai/intent-ai-panel-probe.js');
report('intent AI panel (guided flow · interactive confirm · real execution)', await runIntentAIPanel(document.getElementById('r')));

/* ------------------- 4b2. Phase 201-207 upgrades (mounted) ------------------- */
/*
 * Everything the owner reported on #/intent-ai, driven as a user: the visible
 * AI-to-AI conversation, the mission strip, the section links, the teach /
 * recall memory, the points integration, and the REAL broadcast path with a
 * stub EIP-1193 wallet plus a stub broadcast bridge (the real one runs the
 * same quote -> approval -> swap path the swap screen uses, and is covered by
 * its own logic probe).
 */
console.log('\n▸ building the intent AI upgrade suite…');
npx(['vite', 'build', '-c', 'test/vite.intentai2.mjs', '--logLevel', 'error']);
installDom();
const { run: runIntentAIUpgrade } = await import('./.out/intentai2/phase201-ai-panel-upgrade-probe.js');
report('intent AI upgrade (AI dialogue · teach memory · points · real broadcast)', await runIntentAIUpgrade(document.getElementById('r')));


/* ------------- 4b3. the AI page as a Command Center (mounted) ------------- */
/*
 * The redesign brief for #/intent-ai was three claims, two of them negative:
 * seventeen agents work, FIVE things are shown, and the assistant never trades
 * by itself. A grep cannot prove a negative about a UI, so this mounts the real
 * panel and looks: the ask box is the only composer, the quick actions are the
 * five surfaces, the agent roster sits behind a closed disclosure, ⚙ AI control
 * writes the caps the firewall reads, an automation is stored as a plan to
 * confirm, a stop taken after a plan is built kills its Approve button on the
 * same paint — and the stub signer is never called by any of it.
 */
console.log('\n▸ building the AI command-deck suite…');
npx(['vite', 'build', '-c', 'test/vite.intentai3.mjs', '--logLevel', 'error']);
installDom();
const { run: runCommandDeck } = await import('./.out/intentai3/phase209-command-deck-probe.js');
report('intent AI command deck (five surfaces · AI control · automations · approve signs nothing)', await runCommandDeck(document.getElementById('r')));


/* ------------------- 4c. Intent OS page wiring (mounted) ------------------- */
/*
 * The Loan → compile SAME_TOKEN report, the tab-wiring report and the dead
 * AI-panel hand-off button are all INTERACTION bugs: an onClick nobody wired,
 * state read once when it must follow the URL, a hand-off built for a screen
 * that cannot review it. No pure-logic probe can see any of them, so this
 * mounts the REAL /intent page (in the REAL router shape — Routes keyed by
 * pathname, exactly like AnimatedRoutes) and drives it:
 *
 *   · the Loan supply & borrow hand-offs compile into reviewable plans
 *   · the real Loan page (asset → amount → confirm sheet) drives the hand-off
 *   · every one of the nine tabs switches and renders its real surface
 *   · URL-driven tab changes land even when the page does not remount
 *   · a dead network yields the honest catalog error state + a working Retry
 *   · a compiled swap walks the review gate into the swap screen
 *   · the AI chat's "open in swap screen" button exists and routes the draft
 */
/* ------------------- 4c0. the loan screen, to the last step --------------- */
/*
 * Reported (fa): «صفحه وام باید ۱۰۰٪ در همان صفحه کامل شود» — the screen used
 * to hand a deposit to Intent OS, which executes nothing, so nothing was ever
 * supplied. It now talks to the Aave V3 pool itself, and the only way to prove
 * that is to drive it with a wallet: a stub EIP-1193 provider and a stubbed
 * JSON-RPC chain, then decode the calldata the app actually signed
 * (approve → supply → withdraw) and check the amounts, the beneficiary and
 * the receipt against what the review sheet promised.
 */
console.log('\n▸ building the loan execution suite…');
npx(['vite', 'build', '-c', 'test/vite.loan.mjs', '--logLevel', 'error']);
installDom();
const { run: runLoanExecution } = await import('./.out/loan/loan-execution-probe.js');
report('loan screen (live pool reads · signed supply/withdraw · no hand-off)', await runLoanExecution(document.getElementById('r')));


console.log('\n▸ building Intent OS wiring suite…');
npx(['vite', 'build', '-c', 'test/vite.intentos.mjs', '--logLevel', 'error']);
installDom();
const { run: runIntentOSWiring } = await import('./.out/intentos/intentos-wiring-probe.js');
report('Intent OS wiring (loan hand-off · tabs · URL sync · AI draft hand-off)', await runIntentOSWiring(document.getElementById('r')));


/* --------------------------- 5. store-safe build -------------------------- */
/*
 * Two separate guarantees are checked here, and they are not the same thing:
 *
 *   A. THE ARCADE IS GONE FROM EVERY BUILD. It used to be a flag
 *      (VITE_ENABLE_GAMES) that store builds left off and the website turned
 *      on. It is now deleted from the repository, so the correct assertion is
 *      no longer "the default build excludes it" — it is "no build can
 *      include it, because there is nothing to include". A flag check would
 *      pass forever while someone re-added a Play route.
 *
 *   B. THE SPECULATION SCREENS ARE STILL A WORKING FLAG. Off for stores, on
 *      for the website. A flag nobody can turn on is a deletion with extra
 *      steps, so the opt-in is asserted to really emit its chunks.
 *
 * Asserting on the EMITTED FILENAMES rather than on the source is what caught
 * the original bug: reading the flag from import.meta.env left Rollup unable
 * to prove the lazy import was dead, so a 22KB Play chunk shipped even with
 * games "disabled".
 */
console.log('\n▸ verifying the arcade is absent and the speculation flag works…');
{
  const { readdirSync, rmSync, existsSync, readFileSync } = await import('node:fs');
  const rows = [];
  const gameChunk = /^(Play|Crash|Dice|Mines|Wheel|CoinFlip)/i;
  const specChunk = /^(Predict|Perp|Invest)/i;

  /* ---- A. deleted, not flagged ---- */
  for (const gone of [
    'src/pages/Play.jsx',
    'src/games',
    'src/lib/fairness.js',
    'src/hooks/useFairSession.js'
  ]) {
    rows.push([`${gone} is deleted from the repo`, !existsSync(gone)]);
  }

  rmSync('dist', { recursive: true, force: true });
  {
    const env = { ...process.env, VITE_ENABLE_SPECULATION: 'false' };
    delete env.NODE_ENV;
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });
  }
  const defaultAssets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
  rows.push(['store build emits no arcade chunk', !defaultAssets.some((f) => gameChunk.test(f))]);
  rows.push(['store build emits no speculation chunk when explicitly disabled', !defaultAssets.some((f) => specChunk.test(f))]);
  rows.push(['store build still produced a bundle', defaultAssets.length > 5]);

  /* ---- B. the speculation opt-in still works, and still has no games ---- */
  rmSync('dist', { recursive: true, force: true });
  {
    /* Ship-flavor build too (see npxShip): this writes dist/ for the budget. */
    const env = { ...process.env, VITE_ENABLE_SPECULATION: 'true' };
    delete env.NODE_ENV;
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });
  }
  const fullAssets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
  rows.push([
    'VITE_ENABLE_SPECULATION=true does emit those screens',
    fullAssets.some((f) => specChunk.test(f))
  ]);
  /*
   * The point the owner made: the website build is the one a first-time user
   * and Google both see. Whatever else it turns on, it must never bring the
   * arcade back.
   */
  rows.push(['the full build STILL has no arcade chunk', !fullAssets.some((f) => gameChunk.test(f))]);

  /*
   * And the arcade VOCABULARY must be gone from the full build too, not just
   * its chunks — the locale JSON is inlined by Rollup, which is exactly how
   * "removed" screens kept shipping their words last time.
   */
  {
    const text = fullAssets
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(`dist/assets/${f}`, 'utf8'))
      .join('\n');
    const arcadeWords = ['gambling-style', 'house edge', 'Provably fair', 'قمار'];
    const found = arcadeWords.filter((w) => text.includes(w));
    rows.push([
      `the full build ships no arcade vocabulary${found.length ? ` — found: ${found.join(', ')}` : ''}`,
      found.length === 0
    ]);
    rows.push(['there was actually a full bundle to scan', text.length > 100000]);
  }

  // Leave the tree in the store-safe state.
  rmSync('dist', { recursive: true, force: true });
  {
    const env = { ...process.env, VITE_ENABLE_SPECULATION: 'false' };
    delete env.NODE_ENV;
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: ['ignore', 'pipe', 'pipe'], env });
  }

  /*
   * ─── THE VOCABULARY A CONTENT FILTER ACTUALLY SEES ────────────────────────
   * APKPure rejected ir.fbt.swap with "Not involve illegal sensitive words."
   *
   * Removing the ROUTES was not enough, and finding that out the slow way is
   * the reason this check exists. The speculation screens were gated and no
   * Predict/Perp/Invest chunk was emitted — but the WORDS were still in the
   * bundle, because the locale files are static imports and Rollup inlines
   * the whole JSON. A runtime `delete` cannot touch them.
   *
   * A filter scans strings, not call graphs. So this greps the BUILT OUTPUT,
   * in every language, for the vocabulary that gets a crypto app rejected.
   * Checking the source would miss exactly the case that bit us.
   */
  {
    const banned = [
      // English
      'Price prediction', 'Call the next candle', 'Perpetuals',
      'Leveraged futures', 'fixed-term yield', 'gambling-style', 'house edge',
      // Persian and Arabic equivalents — a filter reads these too, and the
      // Persian chunk was the last one still dirty after everything else
      // looked clean.
      'پیش‌بینی قیمت', 'قمار', 'اهرم', 'المضاربة'
    ];

    const assetDir = 'dist/assets';
    const files = existsSync(assetDir) ? readdirSync(assetDir) : [];
    const text = files
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(`${assetDir}/${f}`, 'utf8'))
      .join('\n');

    const found = banned.filter((w) => text.includes(w));
    rows.push([
      `the store build ships none of the flagged vocabulary${found.length ? ` — found: ${found.join(', ')}` : ''}`,
      found.length === 0
    ]);
    // If the bundle were empty this would pass vacuously.
    rows.push(['there was actually a bundle to scan', text.length > 100000]);
  }

  report('store-safe build', rows);
}

/*
 * STACKING ORDER — a modal must never open behind the thing that opened it.
 *
 * Real bug this catches: the onboarding stage is `position: fixed; z-index:
 * 95`, while the Sheet backdrop was 60 and the sheet 61. So tapping "Terms of
 * Service" on the onboarding terms step mounted the dialog UNDERNEATH the
 * onboarding screen. It rendered, it locked body scroll, it was simply
 * invisible — indistinguishable from a dead button, and invisible to a test
 * that only asserts the element exists.
 *
 * jsdom does not composite, so no render test can catch this. Reading the
 * declared z-index out of the stylesheet can.
 */
/*
 * LAZY LOCALES.
 *
 * All twelve locale files (508 KB) used to be static imports in
 * src/i18n/index.js, so every one of them shipped in the entry chunk and a
 * Persian user downloaded eleven languages they will never see before the
 * first frame could paint. They are dynamic now — which introduces a new way
 * to break: a language that fails to load silently, leaving raw keys or the
 * wrong language on screen. This asserts the switch really works.
 */
/*
 * BODY SCROLL LOCK.
 *
 * The old implementation snapshotted body.style.overflow on lock and restored
 * that snapshot on unlock. With two overlapping modals (SendSheet opening
 * QrScanner) the inner lock snapshots 'hidden', so if the unlocks run in any
 * order other than strict reverse the last one restores 'hidden' and the page
 * can never scroll again until reload. React does not guarantee sibling
 * unmount order, so that ordering could not be relied on.
 */
console.log('\n▸ checking body scroll lock…');
{
  npx(['vite', 'build', '-c', 'test/vite.scrolllock.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runLock } = await import('./.out/scrolllock/scrolllock-probe.js');
  report('scroll lock', await runLock());
}

/*
 * Wiring audit — pure file analysis, no bundler or DOM needed, so it runs
 * first and fails fast. Catches the class of bug where everything renders and
 * the build is green but a button does nothing or shows a raw key.
 */
console.log('\n▸ auditing wiring (keys · routes · dead files)…');
{
  const { default: runWiring } = await import('./wiring.mjs');
  report('wiring', runWiring());
}

/* Real HTTP coverage for registry discovery, signature authentication,
   immutable nonce admission, and public inclusion evidence. */
console.log('\n▸ probing the signed solver commitment API…');
{
  const intentApiRows = (await import('./intent-api-probe.mjs')).default;
  report('intent commitment API', intentApiRows);
}

/* Real HTTP + module coverage for the authenticated agent/strategy registry:
   ownership, the honest live/unavailable split, the read-side fail-closed pass
   and — the point of the suite — write routes that refuse withdrawFunds,
   executeWithoutUser and automatic execution for an AUTHENTICATED caller. */
console.log('\n\u25b8 probing the authenticated ecosystem registry\u2026');
{
  const registryRows = (await import('./ecosystem-registry-probe.mjs')).default;
  report('ecosystem registry', registryRows);
}

/* Real HTTP + strict-validation coverage for privacy-safe execution
   observation: opt-in enforcement, unknown/address/tx-hash/free-text
   rejection, fail-closed storage, and the honest capabilities block. */
console.log('\n▸ probing privacy-safe intent execution observation…');
{
  const observationRows = (await import('./intent-observation-probe.mjs')).default;
  report('intent execution observation', observationRows);
}

console.log('\n▸ probing the execution-observation empirical trainer…');
{
  const execObsRows = (await import('./exec-observation-model-probe.mjs')).default;
  report('execution-observation model', execObsRows);
}

/* Real HTTP coverage for the learning core: opt-in enforcement (401), the
   dedicated event rate limiter (429), the in-memory params hot path (<1 ms),
   and the honest not-configured shapes when Blob is off. */
console.log('\n▸ probing the learning telemetry API…');
{
  const learningApiRows = (await import('./learning-api-probe.mjs')).default;
  report('learning telemetry API', learningApiRows);
}

/*
 * Native notification probe — runs the REAL notify.js with `Notification`
 * deleted and Capacitor injected, which is the one environment shape that
 * exists on the APK and can never occur in jsdom or a browser. This is the
 * suite that catches "Settings crashes on the phone but not on the web".
 *
 * It installs its own DOM per case, so it must run before anything that
 * depends on the shared jsdom set up by installDom().
 */
console.log('\n▸ probing notifications with no web Notification API…');
{
  const { default: runNative } = await import('./native-notify-probe.mjs');
  report('native notifications', await runNative());
}

/*
 * ORDER-WATCH → PUSH DELIVERY PROBE.
 *
 * The server-side watcher that fires auto-order alerts with the app closed.
 * Real bug: the daily cron ran runWatchCycle() with NO send callback, so a
 * triggered order hit `send(...)` where send was undefined, threw, was
 * caught, and the alert was silently dropped. This runs the real watch.js
 * against a stubbed price feed and asserts delivery only happens when a send
 * callback is wired, so the fix (and the wiring.mjs check) cannot regress.
 */
console.log('\n▸ probing order-watch push delivery…');
{
  const { default: runWatchPush } = await import('./watch-push-probe.mjs');
  report('order-watch → push', await runWatchPush());
}

/*
 * QR CAMERA LIFECYCLE.
 *
 * Wiring check #32 proves the dependency array was written correctly. It
 * cannot prove the camera stays alive across a re-render — that is a runtime
 * property. This drives the real component with an instrumented getUserMedia
 * and counts opens and stops.
 */
/*
 * The bottom nav's geometry. The raised centre button must sit BETWEEN the
 * second and third tab; a refactor that moves it out of the map would leave
 * it rendering correctly at the wrong end of the row.
 */
/*
 * Multi-aggregator quoting must not be slower than single-aggregator quoting.
 * Measured, not assumed — see the probe's header.
 */
console.log('\n▸ timing the multi-aggregator quote race…');
{
  const { default: runRace } = await import('./quote-race-probe.mjs');
  report('quote race', await runRace());
}

/*
 * The wallet panel. Its geometry broke twice from class-cascade conflicts, so
 * the structure is now asserted rather than assumed.
 */
/*
 * The Start screen's backdrop. Its sizing broke in a way that only shows on a
 * real viewport, so the probe asserts what jsdom CAN see: the elements exist,
 * and the twinkle is desynchronised per star.
 */
console.log('\n▸ checking the start screen backdrop…');
{
  npx(['vite', 'build', '-c', 'test/vite.splash.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runSplash } = await import('./.out/splash/splash-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('start screen', await runSplash(host));
}

console.log('\n▸ checking the wallet panel…');
{
  npx(['vite', 'build', '-c', 'test/vite.wallet.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runWallet } = await import('./.out/wallet/wallet-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('wallet panel', await runWallet(host));
}

/*
 * The wallet command center (Smart Wallet 2.0) renders only after a wallet is
 * CONNECTED, which the wallet panel probe above cannot reach — it mounts the
 * page in the disconnected empty state. This drives each new component
 * directly with representative props and asserts the honest states.
 */
console.log('\n▸ checking the wallet command center components…');
{
  npx(['vite', 'build', '-c', 'test/vite.wcc.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runWcc } = await import('./.out/wcc/wallet-command-center-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('wallet command center', await runWcc(host));
}

console.log('\n▸ checking the bottom nav layout…');
{
  npx(['vite', 'build', '-c', 'test/vite.nav.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runNav } = await import('./.out/nav/nav-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('bottom nav', await runNav(host));
}

console.log('\n▸ checking the QR camera survives re-renders…');
{
  npx(['vite', 'build', '-c', 'test/vite.qr.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runQr } = await import('./.out/qr/qr-camera-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('qr camera', await runQr(host));
}

console.log('\n▸ checking lazy locale loading…');
{
  npx(['vite', 'build', '-c', 'test/vite.i18n.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runI18n } = await import('./.out/i18n/i18n-probe.js');
  report('lazy locales', await runI18n());
}

console.log('\n▸ checking modal stacking order…');
{
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/index.css', 'utf8');

  // Last declaration wins in CSS, so take the final value for each selector.
  const zOf = (selector) => {
    const re = new RegExp(`\\${selector}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
    let m, last = null;
    while ((m = re.exec(css))) {
      const z = /z-index:\s*(-?\d+)/.exec(m[1]);
      if (z) last = Number(z[1]);
    }
    return last;
  };

  const sheetLayer = zOf('.sheet-layer');
  const sheetBackdrop = zOf('.sheet-backdrop');
  const moreLayer = zOf('.more-layer');
  const onb = zOf('.onb-stage');
  const guide = zOf('.guide-stage');
  const welcome = zOf('.welcome-stage') ?? onb;

  const topStage = Math.max(onb ?? 0, guide ?? 0, welcome ?? 0);

  report('modal stacking', [
    ['every z-index was found', [sheetLayer, sheetBackdrop, moreLayer, onb, guide].every((v) => typeof v === 'number')],
    [`sheet backdrop (${sheetBackdrop}) is above the top stage (${topStage})`, sheetBackdrop > topStage],
    [`sheet layer (${sheetLayer}) is above the top stage (${topStage})`, sheetLayer > topStage],
    ['sheet panel sits above its own backdrop', sheetLayer > sheetBackdrop],
    [`more drawer (${moreLayer}) is above the top stage (${topStage})`, moreLayer > topStage],
    ['more drawer sits above the shared backdrop', moreLayer > sheetBackdrop]
  ]);
}

/*
 * LIGHT-THEME CONTRAST.
 *
 * Real bug: the palette is neon, designed to glow against black. On a white
 * card the same colours measured 1.33-1.79:1 against their own background,
 * where WCAG AA wants 4.5:1 for text — so promo banners rendered as
 * near-invisible text on near-white. Nothing was broken structurally, which
 * is why it survived: only a colour measurement catches it.
 */
console.log('\n▸ measuring light-theme contrast…');
{
  const { readFileSync } = await import('node:fs');
  const ad = readFileSync('src/components/AdBanner.jsx', 'utf8');

  const relLum = (hex) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [la, lb] = [relLum(a), relLum(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // Pull every `inks: [...]` pair out of the slot table.
  const inks = [...ad.matchAll(/inks:\s*\['(#[0-9a-fA-F]{6})',\s*'(#[0-9a-fA-F]{6})'\]/g)];
  const rows = [];
  rows.push(['every slot defines a readable ink pair', inks.length === 5]);

  for (const [, a] of inks) {
    const r = ratio(a, '#ffffff');
    rows.push([`ink ${a} reaches AA on white (${r.toFixed(2)}:1)`, r >= 4.5]);
  }

  // And the neon originals must still be the ones used for the dark theme,
  // otherwise we have "fixed" light mode by dulling both.
  const hues = [...ad.matchAll(/hues:\s*\['(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
  rows.push(['dark theme keeps the neon hues', hues.includes('#00e5ff') && hues.includes('#00ff9d')]);

  report('light-theme contrast', rows);
}

/* --------------------------- ecosystem safety --------------------------- */
{
  const { validateAgent, validateStrategy, validateIntentGraph } = await import('../server/ecosystemSchemas.js');
  report('ecosystem safety schemas', [
    ['agent with withdrawal permission is rejected', !validateAgent({ schema: 'fbt.agent.v1', id: 'x-agent', permissions: { withdrawFunds: true }, supportedChains: [], executionMode: 'manual' }).ok],
    ['agent automatic execution is rejected', !validateAgent({ schema: 'fbt.agent.v1', id: 'x-agent', permissions: { executeWithoutUser: true }, supportedChains: [], executionMode: 'manual' }).ok],
    ['strategy automatic execution is rejected', !validateStrategy({ schema: 'fbt.strategy.v1', id: 'x-strategy', policy: { maxAmountUsd: 10, maxSlippageBps: 50, allowedChains: [1] }, action: { automaticExecution: true } }).ok],
    ['strategy requires bounded policy', !validateStrategy({ schema: 'fbt.strategy.v1', id: 'x-strategy', policy: { allowedChains: [] } }).ok],
    ['cyclic intent graph is rejected', !validateIntentGraph({ schema: 'fbt.intent-graph.v1', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }).ok],
    ['valid graph is accepted', validateIntentGraph({ schema: 'fbt.intent-graph.v1', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] }).ok]
  ]);
  const { validateProject, createSandboxProject } = await import('../src/lib/developerProjects.js');
  const storage = { value: null, getItem() { return this.value; }, setItem(_k, v) { this.value = v; } };
  const created = createSandboxProject({ name: 'Demo', environment: 'sandbox', scopes: ['read_network'] }, storage);
  report('sandbox project boundary', [
    ['mainnet project is rejected', !validateProject({ name: 'x', environment: 'mainnet', scopes: ['read_network'] }).ok],
    ['project without scope is rejected', !validateProject({ name: 'x', environment: 'sandbox', scopes: [] }).ok],
    ['sandbox draft is local and created', created.ok && created.project.ownerRef === 'local-device'],
    ['draft has no key or signer fields', created.ok && !('apiKey' in created.project) && !('signer' in created.project)]
  ]);
  /*
   * The catalog TABS are wired to the real endpoint and stay read-only.
   * Static assertions, because the failure they guard against is a future
   * edit: an "install", "run" or "enable" button on a listing would turn a
   * self-reported directory into an execution surface, and the honesty note
   * printed next to it into a lie.
   */
  const { readFileSync: readSrc } = await import('node:fs');
  const intentOsSource = readSrc('src/pages/IntentOS.jsx', 'utf8');
  const catalogClient = readSrc('src/lib/ecosystemCatalog.js', 'utf8');
  const localeFiles = ['en', 'fa', 'ar'].map((code) => JSON.parse(readSrc(`src/i18n/locales/${code}.json`, 'utf8')));
  const catalogKeys = [
    ['agents', 'loading'], ['agents', 'errorTitle'], ['agents', 'total'], ['agents', 'unverified'],
    ['agents', 'listNote'], ['agents', 'emptyLiveBody'], ['strategies', 'loading'], ['strategies', 'maxAmount'],
    ['strategies', 'maxSlippage'], ['strategies', 'trigger'], ['strategies', 'listNote'], ['strategies', 'emptyLiveBody'],
    ['catalog', 'certified'], ['catalog', 'certifiedBy'], ['catalog', 'observed'], ['catalog', 'noReputation'],
    ['catalog', 'showEvidence'], ['catalog', 'evidenceNone'], ['catalog', 'issuedBy'], ['catalog', 'openEvidence']
  ];
  /*
   * The developer/reviewer consoles are the first screens that can CHANGE
   * registry state, so the static checks here are about what they must never
   * grow: a client-side trust decision, a write from the public catalog
   * module, or a control that runs a listing.
   */
  const consoleClient = readSrc('src/lib/developerConsole.js', 'utf8');
  const devConsole = readSrc('src/components/DeveloperConsole.jsx', 'utf8');
  const reviewerConsole = readSrc('src/components/ReviewerConsole.jsx', 'utf8');
  const session = readSrc('src/lib/telegramSession.js', 'utf8');
  report('developer + reviewer console', [
    ['the console sends the signed initData, never initDataUnsafe',
      /x-telegram-init-data/.test(session)
        /* comments explain WHY initDataUnsafe is refused; the code must not use it */
        && !/initDataUnsafe/.test(session.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))],
    ['no session means no request instead of a guaranteed 401',
      /if \(!headers\) return \{ ok: false, code: 'AUTH_REQUIRED'/.test(consoleClient)],
    ['every mutation carries a fresh idempotency key', /'idempotency-key': idempotencyKey\(\)/.test(consoleClient)],
    ['the console never posts a status, permission or verification field',
      !/status:\s*'(published|submitted)'/.test(consoleClient) && !/verification:/.test(consoleClient) && !/withdrawFunds/.test(consoleClient)],
    ['lifecycle moves go through the server state machine', /moveListing\(type, row\.id/.test(devConsole)],
    ['the console has no run, execute or sign control',
      !/(execute|runListing|signListing|withdraw)\s*\(/i.test(devConsole)],
    ['a published-but-invisible listing explains itself', /blockedReason/.test(devConsole)],
    ['a refused write shows a translated operational hint under the code',
      /dev\.console\.hint\./.test(devConsole)
      && localeFiles.every((locale) => ['REGISTRY_STORE_UNAVAILABLE', 'CERTIFIER_NOT_CONFIGURED', 'CERTIFIER_NOT_AUTHORIZED', '_default']
        .every((key) => typeof locale?.dev?.console?.hint?.[key] === 'string' && locale.dev.console.hint[key].length > 0))],
    ['the reviewer console renders nothing for a non-reviewer',
      /if \(!status\.isCertifier\) return null;/.test(reviewerConsole)],
    ['the setup card appears only while no reviewer is configured',
      /if \(!status\.configured\) \{/.test(reviewerConsole)],
    ['the reviewer console requires checkable evidence', /evidenceHint/.test(reviewerConsole) && /buildEvidence/.test(reviewerConsole)],
    ['evidence is only accepted as an https link or a sha256 digest',
      /\[a-f0-9\]\{64\}/.test(consoleClient) && /sha256/.test(consoleClient)],
    ['console copy is translated in en, fa and ar',
      localeFiles.every((locale) => ['title', 'signedOut', 'refused', 'listings'].every((key) => typeof locale?.dev?.console?.[key] === 'string')
        && ['title', 'body', 'evidenceHint'].every((key) => typeof locale?.dev?.review?.[key] === 'string'))],
    ['the consoles hold no hardcoded Persian or Arabic string',
      !/[\u0600-\u06ff]/.test(devConsole) && !/[\u0600-\u06ff]/.test(reviewerConsole)]
  ]);

  report('ecosystem catalog UI', [
    ['the agents/strategies tabs fetch the real catalog', /fetchCatalog\(/.test(intentOsSource) && /TAB_CATALOG/.test(intentOsSource)],
    ['listings render through the read-only catalog section', /<CatalogSection/.test(intentOsSource)],
    ['an unavailable registry still shows the honest empty state', /state === 'unavailable'/.test(intentOsSource) && /emptyBody/.test(intentOsSource)],
    ['a live but empty registry says something different from unavailable', /emptyLiveBody/.test(intentOsSource)],
    ['no listing carries an execute, sign or install control',
      !/(onClick|onSubmit)=\{[^}]*(execute|runStrategy|signListing|install|enableAgent)/i.test(intentOsSource)],
    ['the catalog client never writes', !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(catalogClient)],
    ['the catalog client derives verified from a server-issued certification',
      /status !== 'certified'/.test(catalogClient) && /verified: Boolean\(certified\)/.test(catalogClient)],
    ['the catalog client drops an under-sampled reputation', /sampleSize < 5/.test(catalogClient)],
    ['the certified badge is rendered from the derived certification only',
      /entry\.certification/.test(intentOsSource) && /catalog\.certifiedBy/.test(intentOsSource)],
    ['an uncertified listing still renders as unverified', /\$\{ns\}\.unverified/.test(intentOsSource)],
    ['the catalog pages with the server cursor instead of inventing one',
      /cursor=\$\{encodeURIComponent\(cursor\)\}/.test(catalogClient) && /onLoadMore/.test(intentOsSource)],
    ['a failed page keeps the rows already on screen', /pageError/.test(intentOsSource)],
    ['an operator with no reviewer configured is shown the exact fix',
      /setupTitle/.test(reviewerConsole) && /status\.callerId/.test(reviewerConsole)],
    ['a badge can be checked: the card opens the certification evidence',
      /fetchCertifications/.test(intentOsSource) && /EvidenceDrawer/.test(intentOsSource)],
    ['evidence links are proved https before they are rendered',
      /httpsOnly/.test(catalogClient) && /protocol === 'https:'/.test(catalogClient)],
    ['an evidence link opens with noreferrer and noopener', /rel="noreferrer noopener"/.test(intentOsSource)],
    ['catalog copy is translated in en, fa and ar',
      localeFiles.every((locale) => catalogKeys.every(([group, key]) => typeof locale?.intentOS?.[group]?.[key] === 'string'))],
    ['the catalog page holds no hardcoded Persian or Arabic string',
      !/[\u0600-\u06ff]/.test(intentOsSource)]
  ]);
  const { validatePortfolioAgent, validateRevenueEvent, validateCertification, reputationRelationship } = await import('../server/phase2Schemas.js');
  report('phase 2/3 fail-closed schemas', [
    ['portfolio agent cannot withdraw', !validatePortfolioAgent({ schema: 'fbt.portfolio-agent.v1', allocations: [{ asset: 'ETH' }], permissions: { withdrawFunds: true }, rebalance: { maxTradeUsd: 10, maxSlippageBps: 50 } }).ok],
    ['portfolio agent requires approval mode', validatePortfolioAgent({ schema: 'fbt.portfolio-agent.v1', allocations: [{ asset: 'ETH' }], permissions: {}, rebalance: { maxTradeUsd: 10, maxSlippageBps: 50 } }).value?.rebalance.mode === 'approval_required'],
    ['revenue is unavailable without accounting', validateRevenueEvent({ schema: 'fbt.revenue-event.v1', projectId: 'p', status: 'unavailable' }).ok],
    ['active certification requires evidence array', !validateCertification({ schema: 'fbt.certification.v1', subjectId: 'a', certificationType: 'api_verified', issuer: 'fbt', issuedAt: 1, status: 'active' }).ok],
    ['small reputation samples are insufficient', reputationRelationship({ sampleSize: 2 }).status === 'insufficient_data']
  ]);
}

console.log(failed ? `\n${failed} FAILED\n` : '\nAll suites passed.\n');
process.exit(failed ? 1 : 0);
