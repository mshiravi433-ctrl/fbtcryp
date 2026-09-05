/**
 * FBT INTENT OS — UPGRADE 7 · Predictive Intent + Proactive Suggestions
 * ---------------------------------------------------------------------------
 * Spec §7 (guess the likely NEXT request and offer it — but never execute
 * without permission), §8 (proactive alerts worth interrupting for),
 * §19/§20 (do not ask what can be inferred; at most one short question).
 *
 * `os/suggestionEngine.js` already renders the chips and stays the renderer.
 * This module decides WHICH follow-ups are actually likely given what just
 * happened, and hands them over in the same `{ id, label, prompt }` shape the
 * chip component already understands — so no UI changes.
 */

import { GOALS } from './deepIntent.js';
import { ALERT_KIND, computeRelevance, shouldNotify } from './monitoring.js';

export const PREDICTIVE_SCHEMA = 'fbt.predictive-intent.v7';

/* -------------------------------------------------------------------------- */
/*  §7 NEXT-INTENT PREDICTION                                                   */
/* -------------------------------------------------------------------------- */

const CHIP = (id, fa, en, promptFa, promptEn) => ({ id, fa, en, promptFa, promptEn });

const AFTER_PORTFOLIO = [
  CHIP('risk_analysis', 'تحلیل ریسک', 'Analyze risk', 'ریسک پرتفوی من را تحلیل کن', 'analyze my portfolio risk'),
  CHIP('optimize', 'یافتن بهینه‌سازی', 'Find optimization', 'پرتفوی من را بهینه کن', 'optimize my portfolio'),
  CHIP('compare_btc', 'مقایسه با BTC', 'Compare with BTC', 'پرتفوی من را با بیت کوین مقایسه کن', 'compare my portfolio with BTC'),
  CHIP('strategy', 'ساخت استراتژی', 'Create strategy', 'یک استراتژی برای من بساز', 'create a strategy for me')
];

const AFTER_TOKEN = [
  CHIP('smart_money', 'پول هوشمند', 'Smart money', 'پول هوشمند این توکن را بررسی کن', 'check smart money for this token'),
  CHIP('risk_analysis', 'ریسک این توکن', 'Token risk', 'ریسک این توکن را بررسی کن', 'check the risk of this token'),
  CHIP('portfolio_impact', 'اثر روی پرتفوی', 'Portfolio impact', 'اثر این توکن روی پرتفوی من چیست', 'what is the impact on my portfolio'),
  CHIP('set_alert', 'هشدار قیمت', 'Price alert', 'اگر قیمت تغییر کرد خبرم کن', 'notify me if the price moves')
];

const AFTER_YIELD = [
  CHIP('compare_yield', 'مقایسه گزینه‌ها', 'Compare options', 'این فرصت‌ها را مقایسه کن', 'compare these opportunities'),
  CHIP('risk_analysis', 'ریسک این فرصت', 'Risk of this option', 'ریسک این فرصت را بررسی کن', 'check the risk of this option'),
  CHIP('allocate', 'تخصیص سرمایه', 'Allocate capital', 'با سرمایه فعلی من این را بررسی کن', 'evaluate this with my current capital')
];

const AFTER_MARKET = [
  CHIP('why', 'چرا این حرکت؟', 'Why this move?', 'چرا این حرکت اتفاق افتاد', 'why did this move happen'),
  CHIP('portfolio_impact', 'اثر روی پرتفوی', 'Portfolio impact', 'اثر بازار روی پرتفوی من چیست', 'how does the market affect my portfolio'),
  CHIP('signals', 'سیگنال‌ها', 'Signals', 'سیگنال‌های فعلی را نشان بده', 'show current signals')
];

const AFTER_EXECUTION = [
  CHIP('verify', 'وضعیت تراکنش', 'Transaction status', 'وضعیت تراکنش من چیست', 'what is my transaction status'),
  CHIP('portfolio', 'پرتفوی به‌روز', 'Updated portfolio', 'پرتفوی من را نشان بده', 'show my portfolio'),
  CHIP('next_step', 'قدم بعدی', 'Next step', 'قدم بعدی چیست', 'what is the next step')
];

const AFTER_GOAL = [
  CHIP('scenarios', 'سناریوها', 'Scenarios', 'سناریوهای ممکن را نشان بده', 'show the possible scenarios'),
  CHIP('risk_analysis', 'ریسک این هدف', 'Risk of this goal', 'ریسک این هدف را بررسی کن', 'assess the risk of this goal'),
  CHIP('track', 'پیگیری هدف', 'Track this goal', 'این هدف را پیگیری کن', 'track this goal for me')
];

/**
 * @returns chips in the exact shape suggestionEngine already emits:
 *          { id, label, prompt } — so the existing component renders them
 *          without a single style change (§37).
 */
export function predictNextIntents({
  intentType = null, deepIntent = null, execution = null, financialContext = null, locale = 'fa', limit = 4
} = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const type = String(intentType || '').toUpperCase();
  const goal = deepIntent?.goal;
  let pool = [];

  if (type === 'PORTFOLIO_ANALYSIS' || type === 'REBALANCE') pool = AFTER_PORTFOLIO;
  else if (type === 'ANALYZE_TOKEN' || type === 'SMART_MONEY' || type === 'WHALE') pool = AFTER_TOKEN;
  else if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) pool = AFTER_YIELD;
  else if (['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'NEWS_SEARCH', 'SIGNALS'].includes(type)) pool = AFTER_MARKET;
  else if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(type)) pool = AFTER_EXECUTION;
  else if (goal === GOALS.MAXIMIZE_RETURN || goal === GOALS.ACCUMULATE || deepIntent?.targetReturn) pool = AFTER_GOAL;
  else pool = [...AFTER_PORTFOLIO.slice(0, 2), ...AFTER_MARKET.slice(0, 2)];

  // A suggestion the user cannot act on is noise: drop portfolio follow-ups when
  // there is no portfolio to talk about (§9 — never pretend data exists).
  const hasPortfolio = Boolean(financialContext?.portfolio?.available);
  const filtered = pool.filter((c) => !(!hasPortfolio && (c.id === 'portfolio_impact' || c.id === 'compare_btc' || c.id === 'optimize')));

  return filtered.slice(0, limit).map((c) => ({
    id: `p7_${c.id}`,
    label: fa ? c.fa : c.en,
    prompt: fa ? c.promptFa : c.promptEn,
    predicted: true
  }));
}

/**
 * §7 hard rule: prediction is an OFFER. Nothing here may execute.
 */
export function isExecutionAllowedFromPrediction() { return false; }

/* -------------------------------------------------------------------------- */
/*  §8 PROACTIVE SIGNAL DETECTION                                               */
/* -------------------------------------------------------------------------- */

/**
 * Look at whatever live numbers we already have and decide if anything crossed
 * the line into "worth interrupting the user". Each candidate is scored for
 * relevance against THIS user's holdings and passed through the cooldown gate.
 */
export function detectProactiveSignals({
  market = {}, portfolio = null, wallet = null, gas = null, bridge = null,
  monitors = [], locale = 'fa', now = Date.now()
} = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const candidates = [];

  const vol = Number(market?.btcVolatility ?? market?.volatility);
  if (Number.isFinite(vol) && vol > 0.05) {
    candidates.push({
      kind: ALERT_KIND.VOLATILITY, asset: 'BTC',
      title: fa ? 'نوسان بیت‌کوین افزایش یافت' : 'BTC volatility increased',
      body: fa ? `نوسان اخیر ${(vol * 100).toFixed(1)}٪ است.` : `Recent volatility is ${(vol * 100).toFixed(1)}%.`
    });
  }

  const holdings = portfolio?.holdings || [];
  const total = Number(portfolio?.totalValueUsd) || 0;
  if (holdings.length && total > 0) {
    const top = [...holdings].sort((a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0))[0];
    const weight = (Number(top?.valueUsd) || 0) / total;
    if (weight > 0.6) {
      candidates.push({
        kind: ALERT_KIND.EXPOSURE, asset: top.symbol,
        title: fa ? 'تمرکز پرتفوی تغییر کرد' : 'Portfolio exposure changed',
        body: fa ? `${top.symbol} حدود ${Math.round(weight * 100)}٪ پرتفوی شماست.` : `${top.symbol} is about ${Math.round(weight * 100)}% of your portfolio.`
      });
    }
  }

  const move = Number(wallet?.largestRecentMoveUsd);
  if (Number.isFinite(move) && move > 10_000) {
    candidates.push({
      kind: ALERT_KIND.WALLET_MOVE, asset: wallet?.moveAsset || null,
      title: fa ? 'جابه‌جایی بزرگ در کیف پول' : 'Large wallet movement detected',
      body: fa ? `حرکتی حدود ${Math.round(move).toLocaleString()} دلار ثبت شد.` : `A movement of about $${Math.round(move).toLocaleString()} was recorded.`
    });
  }

  const gasGwei = Number(gas?.gwei ?? gas);
  if (Number.isFinite(gasGwei) && gasGwei > 80) {
    candidates.push({
      kind: ALERT_KIND.GAS, asset: null,
      title: fa ? 'کارمزد شبکه گران شد' : 'Gas became expensive',
      body: fa ? `گس فعلی ${Math.round(gasGwei)} gwei است.` : `Gas is currently ${Math.round(gasGwei)} gwei.`
    });
  }

  const liq = Number(bridge?.liquidityUsd);
  if (Number.isFinite(liq) && liq < 50_000) {
    candidates.push({
      kind: ALERT_KIND.BRIDGE_LIQUIDITY, asset: bridge?.asset || null,
      title: fa ? 'نقدینگی پل کاهش یافت' : 'Bridge liquidity decreased',
      body: fa ? 'برای انتقال بین‌شبکه‌ای ممکن است لغزش بالا باشد.' : 'Cross-chain transfers may face high slippage.'
    });
  }

  const riskyPositions = (portfolio?.positions || []).filter((p) => Number(p?.healthFactor) < 1.3);
  for (const p of riskyPositions.slice(0, 2)) {
    candidates.push({
      kind: ALERT_KIND.POSITION_RISK, asset: p.symbol || null,
      title: fa ? 'ریسک پوزیشن افزایش یافت' : 'Position risk increased',
      body: fa ? `ضریب سلامت ${Number(p.healthFactor).toFixed(2)} است.` : `Health factor is ${Number(p.healthFactor).toFixed(2)}.`
    });
  }

  // Score, gate, and return only what is allowed to interrupt.
  return candidates
    .map((c) => {
      const relevance = computeRelevance({ kind: c.kind, asset: c.asset, portfolio, monitors });
      const gate = shouldNotify({ kind: c.kind, relevance, now });
      return { ...c, relevance, allowed: gate.allowed, blockedReason: gate.allowed ? null : gate.reason, requiresConfirmation: false };
    })
    .sort((a, b) => b.relevance - a.relevance);
}

/* -------------------------------------------------------------------------- */
/*  §19/§20 SMART CLARIFICATION                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Before asking anything, look everywhere the answer could already be:
 * known context → wallet → portfolio → previous answer → current intent →
 * defaults. Only what survives all six is worth a question, and only ONE.
 */
export function smartClarify({
  missingSlots = [], deepIntent = null, financialContext = null, goalMemory = {},
  boundAnswers = {}, defaults = {}, locale = 'fa'
} = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const inferred = {};
  const stillMissing = [];

  for (const m of missingSlots) {
    const slot = m.slot || m;

    // 1 already answered in this conversation
    if (boundAnswers[slot] != null) { inferred[slot] = { value: boundAnswers[slot], from: 'previous_answer' }; continue; }
    // 2 remembered goal
    if (goalMemory[slot] != null) { inferred[slot] = { value: goalMemory[slot], from: 'goal_memory' }; continue; }
    // 3 already in the current intent
    if (deepIntent?.[slot] != null && deepIntent[slot] !== false) { inferred[slot] = { value: deepIntent[slot], from: 'current_intent' }; continue; }
    // 4 derivable from wallet / portfolio
    if (slot === 'amount' && financialContext?.portfolio?.available) {
      inferred[slot] = { value: { source: 'current_portfolio', totalValueUsd: financialContext.portfolio.value?.totalValueUsd ?? null }, from: 'portfolio' };
      continue;
    }
    if (slot === 'asset' && financialContext?.assets?.available) {
      const assets = financialContext.assets.value || [];
      const largest = [...assets].sort((a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0))[0];
      if (largest?.symbol && assets.length === 1) { inferred[slot] = { value: largest.symbol, from: 'wallet' }; continue; }
    }
    // 5 a safe default
    if (defaults[slot] != null) { inferred[slot] = { value: defaults[slot], from: 'default', assumed: true }; continue; }

    stillMissing.push(m);
  }

  stillMissing.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const ask = stillMissing[0] || null;

  return {
    inferred,
    stillMissing,
    // At most one question, ever (§20).
    shouldAsk: Boolean(ask),
    question: ask ? questionFor(ask, fa) : null,
    assumptions: Object.entries(inferred).filter(([, v]) => v.assumed).map(([slot, v]) => ({ slot, value: v.value }))
  };
}

function questionFor(missing, fa) {
  const slot = missing.slot || missing;
  const map = {
    timeframe: { fa: 'در چه بازه‌ای؟', en: 'Over what timeframe?' },
    risk: { fa: 'چه سطح ریسکی برایتان قابل قبول است؟', en: 'What level of risk is acceptable?' },
    amount: { fa: 'چه مقدار؟', en: 'What amount?' },
    asset: { fa: 'کدام دارایی؟', en: 'Which asset?' },
    goal: { fa: 'هدف اصلی‌تان چیست؟', en: 'What is your main goal?' }
  };
  const q = map[slot] || { fa: `${slot}?`, en: `${slot}?` };
  return {
    slot,
    expectedType: missing.expectedType || 'text',
    text: fa ? q.fa : q.en,
    priority: missing.priority ?? 5
  };
}
