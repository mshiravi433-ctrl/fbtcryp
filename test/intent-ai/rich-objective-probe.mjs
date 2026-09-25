/**
 * FBT INTENT OS — rich objective + in-place replies (server /chat, OS layer, engine).
 *
 * The reported failure: «1000 دلار در ۳۰ روز به سود ۳۰ درصد با ریسک متوسط»
 * came back as a generic two-line suggestion, because the V1 lexicon called it
 * GENERAL, its label overwrote the correct STRATEGY_PLAN, and the turn died in
 * the generic renderer — which cannot emit a strategy card at all.
 *
 * This probe pins the fix at three layers (nothing here signs or broadcasts):
 *   1. POST /api/v1/ai/chat answers objectives with the same rich card
 *      contracts the browser OS emits (STRATEGY_PLAN_CARD + strategyRequest,
 *      GOAL_PLAN_CARD + goalRequest), asks for genuinely missing fields, and
 *      keeps the OS intent label instead of the V1 GENERAL one.
 *   2. The OS layer answers on /intent IN PLACE (no «باز کردم» navigation to
 *      the page the user is already on) and navigates from anywhere else.
 *   3. The strategy engine hands off to PREFILLED venue routes (asset, USD
 *      amount, chain, pool) — never a bare pathname.
 */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../../server/app.js';
import { createIntentOS } from '../../src/lib/intent-ai/os/index.js';
import { buildStages } from '../../src/lib/strategyBrain/strategyEngine.js';

const rows = [];
const t = (name, ok, err) => rows.push([name, Boolean(ok), err == null ? '' : String(err).slice(0, 200)]);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fbt-device': 'fbt-rich-objective-probe' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

try {
  /* ── 1a. full objective → strategy card, not a suggestion line ────────── */
  const strat = await post('/api/v1/ai/chat', {
    message: '1000 دلار در ۳۰ روز به سود ۳۰ درصد با ریسک متوسط',
    locale: 'fa',
    surface: '/intent'
  });
  t('chat: profit objective is not GENERAL', strat.json?.reply?.intent?.type === 'STRATEGY_PLAN', strat.json?.reply?.intent?.type);
  t('chat: profit objective emits STRATEGY_PLAN_CARD', strat.json?.reply?.ui?.type === 'STRATEGY_PLAN_CARD', strat.json?.reply?.ui?.type);
  t('chat: profit objective carries strategyRequest', Boolean(strat.json?.reply?.strategyRequest?.text), JSON.stringify(strat.json?.reply?.strategyRequest || null).slice(0, 80));
  t('chat: profit objective flags goalDetected', strat.json?.reply?.goalDetected === true, strat.json?.reply?.goalDetected);
  t('chat: profit objective names the goal, not the fallback', /1,?000/.test(String(strat.json?.reply?.text || '')), String(strat.json?.reply?.text || '').slice(0, 80));

  /* ── 1b. named multiple → goal card ───────────────────────────────────── */
  const goal = await post('/api/v1/ai/chat', {
    message: 'سودم دو برابر شود',
    locale: 'fa',
    surface: '/intent'
  });
  t('chat: double-money emits GOAL_PLAN_CARD', goal.json?.reply?.ui?.type === 'GOAL_PLAN_CARD', goal.json?.reply?.ui?.type);
  t('chat: double-money carries goalRequest', Number(goal.json?.reply?.goalRequest?.multiple) === 2, JSON.stringify(goal.json?.reply?.goalRequest || null));

  /* ── 1c. genuinely missing fields → asked, never guessed ──────────────── */
  const missing = await post('/api/v1/ai/chat', {
    message: '۳۰ درصد سود میخوام',
    locale: 'fa',
    surface: '/intent'
  });
  t('chat: missing capital asks, not plans', missing.json?.reply?.strategyRequest == null && Boolean(missing.json?.reply?.intent?.minimalQuestion?.fa), String(missing.json?.reply?.text || '').slice(0, 80));
  t('chat: the unanswered strategy remembers only its missing-slot draft',
    Boolean(missing.json?.reply?.strategyDraft?.text) && !missing.json?.reply?.strategyRequest);
  const followUp = await post('/api/v1/ai/chat', {
    message: '۱۰۰۰ دلار در ۳۰ روز، ریسک متوسط', locale: 'fa', surface: '/intent',
    messages: [{ role: 'user', content: '۳۰ درصد سود میخوام' },
      { role: 'ai', content: missing.json?.reply?.text || '', strategyDraft: missing.json?.reply?.strategyDraft }]
  });
  t('chat: short answer completes the original goal in the same thread',
    followUp.json?.reply?.ui?.type === 'STRATEGY_PLAN_CARD'
      && /۱۰۰۰/.test(followUp.json?.reply?.strategyRequest?.text || '')
      && /۳۰ درصد/.test(followUp.json?.reply?.strategyRequest?.text || ''),
    JSON.stringify(followUp.json?.reply?.strategyRequest || followUp.json?.reply?.text));

  /* ── 1d. the chat IS the OS: in place on /intent ──────────────────────── */
  const inPlace = await post('/api/v1/ai/chat', {
    message: 'intent os را باز کن',
    locale: 'fa',
    surface: '/intent'
  });
  t('chat: on /intent answers in place', inPlace.json?.reply?.inPlace === true && inPlace.json?.reply?.openTab === 'chat', JSON.stringify({ inPlace: inPlace.json?.reply?.inPlace, openTab: inPlace.json?.reply?.openTab }));
  t('chat: on /intent never routes to /intent', !String(JSON.stringify(inPlace.json?.reply?.actions || [])).includes('"/intent"'), JSON.stringify(inPlace.json?.reply?.actions || []));

  const ops = await post('/api/v1/ai/chat', {
    message: 'مرکز عملیات',
    locale: 'fa',
    surface: '/intent'
  });
  t('chat: ops center opens in place on /intent', ops.json?.reply?.inPlace === true && ops.json?.reply?.openPanel === 'operations', JSON.stringify({ inPlace: ops.json?.reply?.inPlace, openPanel: ops.json?.reply?.openPanel }));

  /* ── 1e. …but navigates from anywhere else ────────────────────────────── */
  const away = await post('/api/v1/ai/chat', {
    message: 'intent os را باز کن',
    locale: 'fa',
    surface: '/swap'
  });
  t('chat: off /intent offers the /intent route', (away.json?.reply?.actions || []).some((a) => a?.route === '/intent'), JSON.stringify(away.json?.reply?.actions || []));

  /* ── 2. OS layer: same contract without HTTP ──────────────────────────── */
  const intentOS = createIntentOS({ locale: 'fa' });
  const osHere = await intentOS.process({ message: 'intent os را باز کن', currentPage: '/intent', locale: 'fa', services: {} });
  t('os: on /intent does not navigate', osHere?.navigated == null, osHere?.navigated);
  t('os: on /intent answers in place', osHere?.human?.inPlace === true, osHere?.human?.inPlace);
  const osOps = await intentOS.process({ message: 'مرکز عملیات', currentPage: '/intent', locale: 'fa', services: {} });
  t('os: ops center shows in place', osOps?.human?.inPlace === true && osOps?.human?.openPanel === 'operations', JSON.stringify({ inPlace: osOps?.human?.inPlace, openPanel: osOps?.human?.openPanel }));
  const osAway = await intentOS.process({ message: 'intent os را باز کن', currentPage: '/swap', locale: 'fa', services: {} });
  t('os: off /intent navigates to /intent', osAway?.navigated === '/intent', osAway?.navigated);

  /* ── 3. engine: prefilled stage handoffs ──────────────────────────────── */
  const stages = buildStages({
    candidate: { sleeves: [
      { family: 'lending', asset: 'USDC', venue: 'Aave', id: 'pool-1', chainId: null, weightPct: 40, returnPctAnnual: 5 },
      { family: 'crypto', asset: 'BTC', venue: 'spot', id: 'bitcoin', chainId: null, weightPct: 60, returnPctAnnual: 0, side: 'long' }
    ] },
    goal: { riskProfile: 'balanced', targetPct: 30 },
    capitalUsd: 1000,
    state: { domains: { wallet: { status: 'live', data: { chainId: 1 } } }, coverage: {}, gaps: [] },
    cost: { feePct: 0.3 },
    horizonDays: 30
  });
  const routes = stages.flatMap((s) => (s.actions || []).map((a) => a.route));
  const loan = routes.find((r) => String(r).startsWith('/loan'));
  const swap = routes.find((r) => String(r).startsWith('/swap'));
  t('engine: lending handoff is prefilled', /asset=USDC/.test(String(loan)) && /amount=400/.test(String(loan)), loan);
  t('engine: swap handoff is prefilled', /to=BTC/.test(String(swap)) && /amount=600/.test(String(swap)), swap);
  t('engine: no money handoff is a bare pathname', routes.filter((r) => ['/swap', '/bridge', '/loan', '/farm', '/perp'].includes(String(r))).length === 0, routes.join(' | '));
} finally {
  server.close();
}

const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok, err] of rows) console.log(`${ok ? 'PASS' : 'FAIL'} rich-objective :: ${name}${ok ? '' : ` :: ${err}`}`);
if (failed.length) {
  console.error(`rich-objective probe: ${failed.length}/${rows.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`rich-objective probe: ${rows.length}/${rows.length} passed`);
}
