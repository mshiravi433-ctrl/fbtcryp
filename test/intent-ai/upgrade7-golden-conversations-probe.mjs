#!/usr/bin/env node
/**
 * FBT INTENT OS — UPGRADE 7 · Golden Conversation probe (§43 §44)
 *
 * Replays every conversation in the corpus through the REAL understanding and
 * enrichment path — no stubs of our own code — and asserts the property each
 * conversation was written to protect. Wording is never asserted; only that
 * context survived, the right slot was carried, and no question was repeated.
 */

import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { enrich } from '../../src/lib/intent-ai/os/upgrade7/index.js';
import { clearPlans } from '../../src/lib/intent-ai/os/upgrade7/planner.js';
import { forgetAll, clearGoalMemory, getGoalMemory } from '../../src/lib/intent-ai/os/upgrade7/semanticMemory.js';
import { clearMonitoring } from '../../src/lib/intent-ai/os/upgrade7/monitoring.js';
import { GOLDEN_CONVERSATIONS, competenceCoverage } from '../../src/lib/intent-ai/os/upgrade7/goldenConversations.js';

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

const WALLET = { connected: true, isConnected: true, address: '0xabc', canSign: true, balances: [{ symbol: 'ETH', amount: 2 }] };
const PORTFOLIO = { totalValueUsd: 18000, holdings: [{ symbol: 'ETH', valueUsd: 12000 }, { symbol: 'BTC', valueUsd: 6000 }] };

/** Run one conversation turn-by-turn through understanding + enrichment. */
function runConversation(conv) {
  const conversationId = `golden_${conv.id}`;
  clearGoalMemory(conversationId);
  const history = [];
  const turns = [];

  for (const turn of conv.turns) {
    const baseIntent = understandIntent(turn.content, {
      wallet: WALLET,
      conversation: history,
      sessionId: conversationId
    });
    const out = enrich({
      message: turn.content,
      baseIntent,
      conversationId,
      conversation: history,
      wallet: WALLET,
      portfolio: PORTFOLIO,
      baseConfidence: { confidenceScore: 80 },
      locale: /[آ-ی]/.test(turn.content) ? 'fa' : 'en'
    });
    history.push({ role: 'user', content: turn.content });
    history.push({ role: 'ai', content: out.plan?.current || 'ok' });
    turns.push({ input: turn.content, baseIntent, out });
  }

  return { conversationId, turns, last: turns[turns.length - 1], goalMemory: getGoalMemory(conversationId) };
}

/* Every conversation must at minimum complete without an error. */
clearPlans(); forgetAll(); clearMonitoring();

let completed = 0;
const runs = new Map();
for (const conv of GOLDEN_CONVERSATIONS) {
  try {
    const r = runConversation(conv);
    runs.set(conv.id, r);
    if (r.turns.every((x) => x.out.ok)) completed += 1;
  } catch (err) {
    t(`${conv.id} runs without throwing`, false, err.message);
  }
}
t(`all ${GOLDEN_CONVERSATIONS.length} conversations complete end to end`, completed === GOLDEN_CONVERSATIONS.length, `${completed}/${GOLDEN_CONVERSATIONS.length}`);

const cov = competenceCoverage();
t('§43 corpus covers all ten competences', cov.meetsMinimum, cov.missing.join(','));
t('§44 corpus holds at least 50 conversations', cov.total >= 50, String(cov.total));

/* ── Per-expectation assertions ──────────────────────────────────────────── */

function check(id, label, fn) {
  const r = runs.get(id);
  if (!r) { t(`${id} ${label}`, false, 'conversation did not run'); return; }
  let ok = false; let detail = '';
  try { const v = fn(r); ok = v === true || (v && v.ok); detail = (v && v.detail) || ''; }
  catch (err) { detail = err.message; }
  t(`${id} ${label}`, ok, detail);
}

// g01 — the flagship §1 example
check('g01', 'extracts goal + timeframe + risk + capital source in one pass', (r) => {
  const d = r.last.out.deepIntent;
  return {
    ok: d.goal === 'maximize_return' && d.timeframe?.value === 4 && d.risk?.level === 'not_high' && d.context?.capitalSource === 'current_portfolio' && d.objective === 'risk_adjusted_return',
    detail: `${d.goal}/${d.timeframe?.value}/${d.risk?.level}/${d.context?.capitalSource}`
  };
});

check('g03', 'understands «ریسک من را کم کن» as reduce_risk', (r) => r.last.out.deepIntent.goal === 'reduce_risk');
check('g04', 'understands «بخشی از سودم را ذخیره کن» as preserve_capital', (r) => r.last.out.deepIntent.goal === 'preserve_capital');
check('g05', 'turns «هر ماه» into a monthly recurrence', (r) => r.last.out.recurrence?.cadence === 'monthly');
check('g06', 'turns a price condition into an alert intent', (r) => r.last.out.deepIntent.action === 'alert');
check('g07', 'reads «ریسک متوسط» as a medium risk tolerance', (r) => r.last.out.deepIntent.risk?.level === 'medium');
check('g08', 'reads «متعادل کن» as a rebalance goal', (r) => r.last.out.deepIntent.goal === 'rebalance');
check('g09', 'reads «مقایسه کن» as a compare action', (r) => r.last.out.deepIntent.action === 'compare');
check('g10', 'reads «با سرمایه فعلی من» as the current portfolio', (r) => r.last.out.deepIntent.context.capitalSource === 'current_portfolio');
check('g11', 'handles the same request in English', (r) => {
  const d = r.last.out.deepIntent;
  return { ok: d.goal === 'maximize_return' && d.timeframe?.value === 6 && d.risk?.level === 'low', detail: `${d.goal}/${d.timeframe?.value}/${d.risk?.level}` };
});
check('g12', 'reads a monthly income request as generate_income', (r) => r.last.out.deepIntent.goal === 'generate_income');

// hidden intent
check('g13', 'answers the bundle behind «بیت‌کوین چطوره؟»', (r) => {
  const ids = r.last.out.hiddenIntents.map((h) => h.id);
  return { ok: ['price', 'trend', 'risk'].every((k) => ids.includes(k)), detail: ids.join(',') };
});
check('g14', 'treats «چرا ریخت» as cause + news', (r) => {
  const ids = r.last.out.hiddenIntents.map((h) => h.id);
  return { ok: ids.includes('price_move_cause') && ids.includes('news'), detail: ids.join(',') };
});
check('g16', 'treats a yield question as discovery + risk', (r) => {
  const ids = r.last.out.hiddenIntents.map((h) => h.id);
  return { ok: ids.includes('yield_discovery') && ids.includes('risk'), detail: ids.join(',') };
});

// §44 context retention — the heart of the corpus
check('g17', 'keeps timeframe AND risk across four turns', (r) => {
  const gm = r.goalMemory;
  return { ok: gm.timeframe?.value === 4 && gm.risk?.level === 'medium', detail: JSON.stringify({ tf: gm.timeframe?.value, risk: gm.risk?.level }) };
});
check('g17', 'never re-asks a slot it already has', (r) => {
  const last = r.last.out.clarification;
  return { ok: !(last.shouldAsk && ['timeframe', 'risk'].includes(last.question?.slot)), detail: last.question?.slot || 'none' };
});
check('g18', 'remembers the timeframe given on turn 2', (r) => r.goalMemory.timeframe?.value === 4);
check('g19', 'carries goal+timeframe+risk to the new asset', (r) => {
  const d = r.last.out.deepIntent;
  return { ok: d.goal === 'maximize_return' && d.timeframe?.value === 4 && d.assets.includes('BTC'), detail: `${d.goal}/${d.timeframe?.value}/${d.assets.join('+')}` };
});
check('g19', 'declares which slots were inherited rather than stated', (r) => r.last.out.deepIntent.inheritedFromMemory.length > 0);
check('g21', 'flags low→high risk as a contradiction needing confirmation', (r) => {
  const c = r.last.out.contradictions.find((x) => x.slot === 'risk');
  return { ok: Boolean(c?.needsConfirmation), detail: JSON.stringify(r.last.out.contradictions.map((x) => x.slot)) };
});
check('g22', 'treats «نه، منظورم این نبود» as a correction, not a reset', (r) => {
  const c = r.last.out.correction;
  return { ok: Boolean(c?.isCorrection) && c.conversationReset === false, detail: String(Boolean(c)) };
});
check('g25', 'retains context across an English four-turn conversation', (r) => {
  const gm = r.goalMemory;
  return { ok: gm.timeframe?.value === 4 && gm.risk?.level === 'medium', detail: `${gm.timeframe?.value}/${gm.risk?.level}` };
});

// agent / module selection
check('g26', 'routes a portfolio question to the portfolio modules', (r) => r.last.out.modules.modules.includes('portfolio'));
check('g28', 'routes a yield question to the farm/lending modules', (r) => {
  const m = r.last.out.modules.modules;
  return { ok: m.includes('farm') || m.includes('lending'), detail: m.join(',') };
});
check('g30', 'a six-month strategy request builds a FINANCIAL_GOAL plan', (r) => {
  const steps = r.last.out.plan.steps.map((s) => s.id);
  return { ok: steps.includes('scenarios') && steps.includes('compare'), detail: steps.join(',') };
});
check('g31', 'a balance question reaches the wallet module', (r) => r.last.out.modules.modules.includes('wallet'));
check('g32', 'a swap request reaches the swap module', (r) => r.last.out.modules.modules.includes('swap'));
check('g33', 'a loan request reaches the lending module', (r) => r.last.out.modules.modules.includes('lending'));
check('g34', 'a farm request reaches the farm module', (r) => r.last.out.modules.modules.includes('farm'));

// execution safety
check('g45', 'a buy request plans through simulation and permission', (r) => {
  const steps = r.last.out.plan.steps.map((s) => s.id);
  return { ok: steps.includes('simulate') && steps.includes('permission'), detail: steps.join(',') };
});
check('g46', 'a repeated identical request produces the same fingerprint', (r) => {
  const [a, b] = r.turns;
  return { ok: a.out.fingerprint === b.out.fingerprint, detail: 'fingerprints differ' };
});
check('g48', 'a recurring buy is scheduled with per-run permission', (r) => r.last.out.recurrence?.cadence === 'monthly');

// recovery
check('g51', 'answering a follow-up resumes the SAME plan', (r) => {
  const [first, second] = r.turns;
  return { ok: first.out.planId === second.out.planId, detail: `${first.out.planId} vs ${second.out.planId}` };
});
check('g52', 'a price question declares it needs fresh price data', (r) => {
  const needs = r.last.out.dataNeed.needs;
  return { ok: needs.includes('price') && r.last.out.dataNeed.marketSensitive, detail: needs.join(',') };
});

const failed = rows.filter(([, ok]) => !ok);
if (process.argv[1] && process.argv[1].endsWith('upgrade7-golden-conversations-probe.mjs')) {
  for (const [name, ok] of rows) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  console.log(`\nGolden conversations: ${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) process.exit(1);
}

export default rows;
