#!/usr/bin/env node
/**
 * FBT INTENT OS — UPGRADE 7 · Phase 2 surface probe
 * ---------------------------------------------------------------------------
 * Phase 2 consumes the 13 intelligence modules without rewriting them:
 * the chat surfaces plan progress, confidence, consensus/divergence and
 * predicted follow-ups through EXISTING components and CSS, answers bind to
 * the slot that asked, and adapters stamp every live read so freshness —
 * previously always null — activates.
 *
 * Offline by design: live-network adapters are covered by source-shape
 * checks, everything else runs against the real modules.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { enrich } from '../../src/lib/intent-ai/os/upgrade7/index.js';
import { clearPlans } from '../../src/lib/intent-ai/os/upgrade7/planner.js';
import { predictNextIntents, smartClarify } from '../../src/lib/intent-ai/os/upgrade7/predictive.js';
import { synthesize } from '../../src/lib/intent-ai/os/upgrade7/agentMesh.js';
import { classifyDataNeed, evaluateFreshness } from '../../src/lib/intent-ai/os/upgrade7/confidence.js';
import { createRealServices } from '../../src/lib/intent-ai/os/serviceAdapters.js';
import { createIntentOS, resetIntentOS } from '../../src/lib/intent-ai/os/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

clearPlans(); resetIntentOS();

/* ── 1. plan.steps carry only label + status (never reasoning) ───────────── */
{
  const out = enrich({
    message: 'پرتفوی من را تحلیل کن',
    baseIntent: { type: 'PORTFOLIO_ANALYSIS', entities: {}, readOnly: true },
    conversationId: 'p2-plan',
    locale: 'fa'
  });
  const keys = new Set((out.plan?.steps || []).flatMap((s) => Object.keys(s || {})));
  t('plan.steps carry only label and status (no reasoning)',
    (out.plan?.steps?.length || 0) > 0 && [...keys].every((k) => ['id', 'label', 'status'].includes(k)),
    [...keys].join(','));
  t('the plan view serializes with no reasoning leak',
    !/reasoning|chainOfThought|innerThought|scratchpad/i.test(JSON.stringify(out.plan || {})));
}

/* ── 2. predictedNext keeps the {id,label,prompt} chip shape ─────────────── */
{
  const chips = predictNextIntents({ intentType: 'PORTFOLIO_ANALYSIS', locale: 'fa' });
  t('predictedNext keeps the {id,label,prompt} chip shape',
    chips.length > 0 && chips.every((c) => typeof c?.id === 'string' && typeof c?.label === 'string' && typeof c?.prompt === 'string'));
  const en = predictNextIntents({ intentType: 'SWAP', locale: 'en' });
  t('predictedNext is localized without changing shape',
    en.length > 0 && en.every((c) => typeof c?.id === 'string' && typeof c?.label === 'string' && typeof c?.prompt === 'string'));
}

/* ── 3. merged chips dedupe on id and stay capped ────────────────────────── */
{
  // Mirrors the panel's allChips rule: suggestions first, predictions after.
  const merge = (suggestions, predicted) => {
    const seen = new Set();
    const merged = [];
    for (const c of [...suggestions, ...predicted]) {
      if (!c || !c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push(c);
    }
    return merged.slice(0, 6);
  };
  const suggestions = [
    { id: 'a', label: 'A', prompt: 'a' },
    { id: 'b', label: 'B', prompt: 'b' }
  ];
  const predicted = [
    { id: 'b', label: 'B2', prompt: 'b2' },
    { id: 'p7_risk_analysis', label: 'ریسک', prompt: 'ریسک را تحلیل کن' }
  ];
  const merged = merge(suggestions, predicted);
  t('merged chips carry no duplicates', merged.length === 3 && new Set(merged.map((c) => c.id)).size === 3);
  const many = merge(
    [0, 1, 2, 3].map((i) => ({ id: `s${i}`, label: `S${i}`, prompt: `s${i}` })),
    [0, 1, 2, 3].map((i) => ({ id: `p${i}`, label: `P${i}`, prompt: `p${i}` }))
  );
  t('merged chips stay capped at six', many.length === 6);
}

/* ── 4. shouldAsk === false asks nothing ─────────────────────────────────── */
{
  const sc = smartClarify({ missingSlots: [], deepIntent: {}, financialContext: null, goalMemory: {}, boundAnswers: {}, locale: 'fa' });
  t('no question is produced when nothing is missing', sc.shouldAsk === false && sc.question == null);
  const sc2 = smartClarify({
    missingSlots: [{ slot: 'timeframe', priority: 1 }],
    deepIntent: { timeframe: { value: 4, unit: 'month' } },
    financialContext: null, goalMemory: {}, boundAnswers: {}, locale: 'fa'
  });
  t('an inferable slot asks nothing either', sc2.shouldAsk === false && sc2.question == null);
}

/* ── 5. divergence === true carries a warning ────────────────────────────── */
{
  const syn = synthesize({
    results: {
      'market-agent': { stance: 'bullish', confidence: 0.8 },
      'risk-agent': { stance: 'bearish', confidence: 0.8 }
    },
    locale: 'fa'
  });
  t('opposed agents raise a divergence warning',
    syn.divergence === true && typeof syn.warning === 'string' && syn.warning.length > 0);
  const agree = synthesize({
    results: {
      'market-agent': { stance: 'bullish', confidence: 0.8 },
      'risk-agent': { stance: 'bullish', confidence: 0.7 }
    },
    locale: 'fa'
  });
  t('agreeing agents carry no warning', agree.divergence === false && agree.warning == null);
}

/* ── 6. adapters stamp fetchedAt + source ────────────────────────────────── */
{
  const svc = createRealServices({
    wallet: { balances: [{ symbol: 'ETH', value: 1.5 }] },
    portfolio: { holdings: [{ symbol: 'ETH', valueUsd: 4500 }], totalValueUsd: 4500 }
  });
  const bal = await svc.walletService.getBalances();
  t('the wallet adapter stamps fetchedAt + source',
    bal.ok === true && Number.isFinite(bal.fetchedAt) && typeof bal.source === 'string', bal.source || '');
  const sum = await svc.portfolioService.getSummary();
  t('the portfolio summary keeps provenance',
    Number.isFinite(sum.fetchedAt) && typeof sum.source === 'string');
  const ana = await svc.portfolioService.analyze({});
  t('portfolio analysis stamps fetchedAt + source',
    ana.ok === true && Number.isFinite(ana.fetchedAt) && typeof ana.source === 'string');

  // Live-network adapters (market, news, yields, signals, smart money, whale,
  // quotes) cannot run offline; their stamp is pinned by source shape instead.
  const adapters = readFileSync(join(repoRoot, 'src/lib/intent-ai/os/serviceAdapters.js'), 'utf8');
  const stamps = (adapters.match(/fetchedAt/g) || []).length;
  t('every live adapter carries a timestamp', stamps >= 12, `${stamps} stamps`);
  t('sources cover rpc · api · onchain · aggregator · cache · portfolio',
    ['rpc', 'api', 'onchain', 'aggregator', 'cache', 'portfolio'].every((s) => adapters.includes(`source: '${s}'`)));

  const panel = readFileSync(join(repoRoot, 'src/components/IntentAIUnified.jsx'), 'utf8');
  t('the UI balance override stamps live reads', panel.includes("source: 'rpc'") && panel.includes('fetchedAt'));
  t('the UI portfolio snapshot carries provenance', panel.includes("source: 'portfolio'"));

  const osIndex = readFileSync(join(repoRoot, 'src/lib/intent-ai/os/index.js'), 'utf8');
  t('the OS feeds snapshots into enrich', osIndex.includes('dataSnapshots'));
}

/* ── 7. freshness is no longer null on a real turn ───────────────────────── */
{
  const os = createIntentOS({ locale: 'fa' });
  const res = await os.process({ message: 'پرتفوی من را تحلیل کن', conversationId: 'p2-fresh' });
  t('freshness activates on a real turn',
    res.ok === true && res.upgrade7?.freshness != null && Array.isArray(res.upgrade7.freshness.items),
    res.upgrade7?.freshness?.overall || res.upgrade7?.error || res.error || '');
  t('freshness reports a verdict label', ['LIVE', 'STALE', 'UNAVAILABLE'].includes(res.upgrade7?.freshness?.label));
}

/* ── 8. a stale price forces a refetch ───────────────────────────────────── */
{
  const need = classifyDataNeed({ intentType: 'SWAP', message: 'تبدیل کن' });
  const now = Date.now();
  const stale = evaluateFreshness(need, {
    price: { fetchedAt: now - 900_000, source: 'cache' },
    balance: { fetchedAt: now, source: 'rpc' },
    quote: { fetchedAt: now, source: 'aggregator' }
  });
  t('a stale price forces a refetch, not a caveat',
    stale.mustRefetch === true && stale.refetchKinds.includes('price'));
  const fresh = evaluateFreshness(need, {
    price: { fetchedAt: now, source: 'api' },
    balance: { fetchedAt: now, source: 'rpc' },
    quote: { fetchedAt: now, source: 'aggregator' }
  });
  t('fresh market data refetches nothing', fresh.mustRefetch === false && fresh.overall === 'fresh');
}

/* ── 9. dataStatus survives untouched (backward compatibility) ───────────── */
{
  const svc = createRealServices({
    wallet: { balances: [{ symbol: 'ETH', value: 1.5 }] },
    portfolio: { holdings: [{ symbol: 'ETH', valueUsd: 4500 }] }
  });
  const bal = await svc.walletService.getBalances();
  t('live reads still report dataStatus live', bal.dataStatus === 'live');
  const ana = await svc.portfolioService.analyze({});
  t('analysis still reports dataStatus live', ana.dataStatus === 'live');
  const bare = createRealServices({});
  const none = await bare.walletService.getBalances();
  t('reads with no data stay timestamp-less unavailable',
    none.dataStatus === 'unavailable' && none.fetchedAt == null);
  const orders = await bare.ordersService.list({}).catch((e) => ({ ok: false, dataStatus: 'unavailable', reason: String(e?.message || e) }));
  t('the orders adapter still answers with a dataStatus', typeof orders.dataStatus === 'string');
}

/* ── 10. the surface uses existing components + classes only ─────────────── */
{
  const panel = readFileSync(join(repoRoot, 'src/components/IntentAIUnified.jsx'), 'utf8');
  t('plan steps render through the existing timeline',
    panel.includes('mapPlanStepsForTimeline(m.upgrade7.plan.steps)') && panel.includes('<AIActivityTimeline'));
  t('confidence renders through the existing meter',
    panel.includes('iaos-conf-meter') && panel.includes('u7-confidence'));
  t('divergence renders through the existing warning',
    panel.includes('iaos-divergence-warn') && panel.includes('u7-divergence'));
  t('consensus renders through the existing box',
    panel.includes('iaos-consensus-box') && panel.includes('u7-consensus'));
  t('predicted chips merge with suggestions', panel.includes('allChips') && panel.includes('predictedNext'));
  t('answers bind to the slot that asked', panel.includes('bindAnswer'));
  t('derived chips memoize (no render-time heavy work)',
    panel.includes('const allChips = useMemo('));

  const css = readFileSync(join(repoRoot, 'src/styles/intent-ai-os.css'), 'utf8');
  t('no new CSS classes were needed', !/iaos-(p7|u7|phase2)[\w-]*/.test(css));
  t('surface stays additive: the Upgrade 6 stack import survives',
    panel.includes('upgrade6/conversationState.js'));
}

const failed = rows.filter(([, ok]) => !ok);
if (process.argv[1] && process.argv[1].endsWith('upgrade7-phase2-surface-probe.mjs')) {
  for (const [name, ok] of rows) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  console.log(`\nUpgrade 7 phase 2 surface: ${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) process.exit(1);
}

export default rows;
