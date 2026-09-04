/**
 * FBT INTENT AI — AI COMMAND CENTER
 * ───────────────────────────────────────────────────────────────────────────
 * The orchestrator, the intent engine, the execution firewall, the AI-control
 * budget and the automations ledger. One module, no React, no network, no
 * wallet: everything in here is a PURE function over data the caller already
 * has, which is what lets the same file run in the browser panel AND behind
 * `server/aiCommand.js` (Express imports it directly, see that file).
 *
 * ─── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
 * The product has seventeen AI capabilities. Putting seventeen cards in front
 * of a person is not a product, it is a build log. So the surface is FIVE
 * things — Ask · Trade · Earn · Protect · Plan — plus Automate, and every one
 * of them is a *route into* the machinery rather than a picture of it:
 *
 *   Ask FBT  →  classify intent  →  agent lanes  →  plan  →  firewall  →  gate
 *   Trade    →  trading lane        (execution · liquidity · fee · gas)
 *   Earn     →  yield lane          (market · liquidity · risk · exit)
 *   Protect  →  risk lane           (risk · guardian · hedge · exit · auditor)
 *   Plan     →  portfolio lane      (portfolio · risk · strategy · exit)
 *   Automate →  schedule lane       (execution · risk · guardian · exit)
 *
 * Nothing here executes anything. The three properties below are the whole
 * point of the module, and each is asserted in the tests:
 *
 *   1. **A plan is not an order.** Every object this file builds carries
 *      `requiresApproval: true` and `executionPermission: false`. `validate
 *      Execution` can only ever produce a *verdict*, never a transaction.
 *   2. **The firewall can only refuse.** It tightens; it never grants. A cap
 *      the user did not open cannot be opened by a plan, an agent vote or a
 *      model output.
 *   3. **No data, no number.** Every section reports its own `dataStatus`.
 *      An unavailable yield feed yields `opportunities: null` — NOT `0`, which
 *      is a claim about the world, and `0` is exactly the number that makes a
 *      stale screen look healthy.
 *
 * ─── WHY THE CLASSIFIER IS NOT A KEYWORD LOOP ───────────────────────────────
 * `text.includes('buy')` reads "should I buy?" as an order to buy, and it is
 * blind to every language the user actually speaks. So classification rides on
 * the audited semantic layer (`semanticIntent.analyzeUtterance`: 12 locales,
 * stems, typo tolerance, clause splitting, deliberation detection) and adds
 * only what that layer does not model — the ROUTE (which of the five surfaces
 * the request belongs to) and the CONFIDENCE (whether we should ask instead of
 * assume). A server-side LLM may later override the label with a schema-
 * validated answer (see `POST /api/ai/chat`), and when it does it may only
 * change `intent`, never an amount, a chain or a permission.
 */

import { analyzeUtterance } from './semanticIntent.js';
import { evaluateRisk } from './riskEngine.js';
import { INTENT_LIMITS, usdValueOf } from './intentLimits.js';
import { DEFAULT_POLICY_CAPS } from './permissions.js';
import { SPECIALIST_ROLES, SPECIALIST_SPECS } from './specialistAgents.js';
import { createRecurringIntent, applyLiveControl } from './liveRecurringIntents.js';

/* ============================== schemas ================================== */

export const COMMAND_CENTER_SCHEMA = 'fbt.ai-command-center.v1';
export const AI_PLAN_SCHEMA = 'fbt.ai-plan.v1';
export const AI_CONTROL_SCHEMA = 'fbt.ai-control.v1';
export const AI_AUTOMATION_SCHEMA = 'fbt.ai-automation.v1';
export const AI_DASHBOARD_SCHEMA = 'fbt.ai-dashboard.v1';

export const AI_CONTROL_STORE_KEY = 'fbt.ai.control.v1';
export const AI_AUTOMATION_STORE_KEY = 'fbt.ai.automations.v1';
export const AI_STOP_STORE_KEY = 'fbt.ai.emergencyStop.v1';

/* ============================== intents ================================== */

/** The seven internal routes. The user never sees this list. */
export const AI_INTENTS = Object.freeze([
  'TRADE', 'EARN', 'PORTFOLIO', 'PROTECT', 'RESEARCH', 'AUTOMATION', 'GENERAL'
]);

/** The five surfaces a person can actually tap, plus Automate. */
export const AI_SURFACES = Object.freeze([
  Object.freeze({
    id: 'trade', glyph: '↗', intent: 'TRADE',
    /* Prompt the composer receives. Kept as data so i18n can localise the
       sentence without touching the routing table. */
    promptKey: 'intentAI.cc.quick.trade.phrase',
    fallbackPrompt: 'help me trade: analyse the market and prepare a swap',
    lanes: ['strategy', 'execution', 'liquidity', 'fee', 'gas', 'risk', 'guardian']
  }),
  Object.freeze({
    id: 'earn', glyph: '◈', intent: 'EARN',
    promptKey: 'intentAI.cc.quick.earn.phrase',
    fallbackPrompt: 'find the best yield for idle stablecoins with low risk',
    lanes: ['market', 'liquidity', 'risk', 'portfolio', 'exit']
  }),
  Object.freeze({
    id: 'protect', glyph: '⌁', intent: 'PROTECT',
    promptKey: 'intentAI.cc.quick.protect.phrase',
    fallbackPrompt: 'check my risk and tell me how to protect the portfolio',
    lanes: ['risk', 'guardian', 'hedge', 'exit', 'auditor']
  }),
  Object.freeze({
    id: 'plan', glyph: '◎', intent: 'PORTFOLIO',
    promptKey: 'intentAI.cc.quick.plan.phrase',
    fallbackPrompt: 'build me a plan for my money over the next 90 days',
    lanes: ['portfolio', 'strategy', 'risk', 'exit']
  }),
  Object.freeze({
    id: 'automate', glyph: '⟳', intent: 'AUTOMATION',
    promptKey: 'intentAI.cc.quick.automate.phrase',
    fallbackPrompt: 'buy 100 USDC of BTC every week automatically',
    lanes: ['execution', 'risk', 'guardian', 'exit', 'learning']
  })
]);

/** The four tools under the quick actions — same routes, named by what they do. */
export const AI_TOOLS = Object.freeze([
  Object.freeze({ id: 'buy-sell', surface: 'trade', intent: 'TRADE', glyph: '⇄', actionType: 'SWAP', labelKey: 'intentAI.cc.tool.buy-sell.name' }),
  Object.freeze({ id: 'earn-yield', surface: 'earn', intent: 'EARN', glyph: '◈', actionType: 'DEPOSIT', labelKey: 'intentAI.cc.tool.earn-yield.name' }),
  Object.freeze({ id: 'rebalance', surface: 'plan', intent: 'PORTFOLIO', glyph: '⚖', actionType: 'REBALANCE', labelKey: 'intentAI.cc.tool.rebalance.name' }),
  Object.freeze({ id: 'protect', surface: 'protect', intent: 'PROTECT', glyph: '⛨', actionType: 'HEDGE', labelKey: 'intentAI.cc.tool.protect.name' })
]);

/* ============================== agents =================================== */

/**
 * The full internal roster — seventeen capabilities, kept (nothing is
 * deleted) and hidden (nothing here is rendered on the main surface). Each row
 * names the specialist contract it actually runs on, so a reviewer can check
 * the claim against `specialistAgents.js` instead of taking it on trust.
 *
 * `surfaces` is the reverse mapping the user asked for: which of the five
 * buttons wakes this agent up.
 */
export const AI_AGENTS = Object.freeze([
  ['financial', 'strategy', ['ask', 'plan'], 'Reads the goal and assembles the plan'],
  ['trading', 'execution', ['trade'], 'Builds the swap / bridge / futures leg'],
  ['futures', 'execution', ['trade'], 'Margin venue legs, leverage within policy'],
  ['arbitrage', 'liquidity', ['trade', 'earn'], 'Compares venues for the same pair'],
  ['market-maker', 'liquidity', ['trade'], 'Depth and price-impact awareness'],
  ['portfolio', 'portfolio', ['plan'], 'Exposure, concentration, allocation drift'],
  ['rebalancer', 'portfolio', ['plan'], 'Brings the weights back to target'],
  ['yield', 'market', ['earn'], 'Ranks live yield venues'],
  ['risk', 'risk', ['protect', 'trade', 'earn', 'plan'], 'Scores every plan against the risk budget'],
  ['hedging', 'hedge', ['protect'], 'Residual-risk reduction: stables, hedges, exits'],
  ['security', 'guardian', ['protect'], 'Approvals, allowances, address and token screening'],
  ['research', 'research', ['ask'], 'Evidence: sources, confidence, what is unknown'],
  ['news', 'market', ['ask'], 'Headline and regime context for a research answer'],
  ['tax', 'auditor', ['plan'], 'Cost-basis and disposal summary, advisory only'],
  ['automation', 'exit', ['automate'], 'Recurring intents: schedule, cadence, stop conditions'],
  ['dca', 'exit', ['automate'], 'Fixed-interval accumulation runs'],
  ['agent-to-agent', 'auditor', ['ask'], 'Multi-agent negotiation transcript, audited']
].map(([id, lane, surfaces, does]) => Object.freeze({
  id,
  lane,
  surfaces: Object.freeze([...surfaces]),
  does,
  /* The capability an agent is allowed to produce. Nothing here can execute —
     `noExecutionPermission` is also asserted structurally by the specialist
     spec it points at. */
  canExecute: false,
  specRole: SPECIALIST_ROLES.includes(lane) ? lane : 'guardian',
  specLive: SPECIALIST_SPECS[SPECIALIST_ROLES.includes(lane) ? lane : 'guardian']?.live === true
})));

export const AGENT_ROSTER_SIZE = AI_AGENTS.length;

/** Agents a surface wakes up — used by the "behind the scenes" disclosure. */
export function agentsForSurface(surfaceId) {
  const id = String(surfaceId || '');
  if (!id) return [];
  return AI_AGENTS.filter((a) => a.surfaces.includes(id));
}

/** The lanes a plan is running, resolved to their specialist contracts. */
export function lanesForIntent(intent) {
  const surface = AI_SURFACES.find((s) => s.intent === intent);
  const lanes = surface ? surface.lanes : ['research', 'portfolio', 'risk', 'strategy'];
  return lanes.map((lane) => ({
    lane,
    title: SPECIALIST_SPECS[lane]?.title || lane,
    live: SPECIALIST_SPECS[lane]?.live === true,
    /* What the lane is allowed to say: an observation, never a permission. */
    authority: 'advisory'
  }));
}

/* ========================= intent classification ========================= */

/** Action ids produced by the semantic layer, mapped onto our seven routes. */
const ACTION_TO_INTENT = Object.freeze({
  buy: ['TRADE', 3],
  sell: ['TRADE', 3],
  swap: ['TRADE', 3],
  bridge: ['TRADE', 2],
  send: ['TRADE', 1],
  futures: ['TRADE', 2],
  dydx: ['TRADE', 2],
  farm: ['EARN', 3],
  defi: ['EARN', 2],
  portfolio: ['PORTFOLIO', 3],
  analyze: ['RESEARCH', 2],
  news: ['RESEARCH', 2],
  goal: ['PORTFOLIO', 2],
  conversation: ['GENERAL', 1]
});

/**
 * Route vocabulary the semantic layer does not model as an ACTION, because it
 * is a *destination* rather than a verb. Stems (not whole words) so Persian and
 * Arabic inflections land: «بخرم»، «ریسکم»، «سوددهی».
 */
const ROUTE_LEXICON = Object.freeze({
  EARN: {
    weight: 2,
    words: ['yield', 'apy', 'apr', 'interest', 'lending', 'lend', 'borrow', 'staking', 'stake', 'lp', 'liquidity pool', 'farm', 'passive income', 'put to work', 'rate'],
    stems: ['سود', 'سوددهی', 'استخر', 'استیک', 'فارم', 'قرض', 'وام', 'ودیع', 'بازده', 'کارمزد', 'تنخواه', 'ریپ', 'ييلد', 'عائد', 'فائدة', 'رهن']
  },
  /*
   * PROTECT's strong tier is a request to make money safer — or a question
   * about the risk of the user's OWN portfolio («my risk», «portfolio risk»).
   * The bare word «risk» lives in `RISK_MENTION_LEXICON` below instead: in
   * «risk medium, 3 months» it is a constraint the user is stating, not a
   * hedge being asked for, and weighting it like one is how every planning
   * sentence turned into a risk report.
   */
  PROTECT: {
    weight: 3,
    words: ['hedge', 'protect', 'safeguard', 'stop loss', 'stop-loss', 'insurance', 'revoke', 'unlimited approval', 'allowance', 'approval hygiene', 'scam', 'drain', 'freeze', 'exit all', 'de-risk', 'derisk', 'audit my', 'my risk', 'portfolio risk', 'risk score', 'risk check'],
    stems: ['حفظ', 'محافظت', 'امنیت', 'هج', 'پوشش', 'حد ضرر', 'توقف', 'لغو مجوز', 'ریواک', 'رمزنگاری', 'کلاهبرداری', 'حمايه', 'حماية', 'تأمين', 'حمايت']
  },
  PORTFOLIO: {
    weight: 2,
    words: ['portfolio', 'allocation', 'split', 'weights', 'holdings', 'balance', 'net worth', 'pnl', 'performance', 'rebalance', 'tax', 'cost basis', 'my money', 'my assets', 'diversif'],
    stems: ['سبد', 'پرتفوی', 'پرتفو', 'توزیع', 'تخصیص', 'دارایی', 'دارائی', 'عملکرد', 'مالیات', 'سود کل', 'موجودی کل', 'سهم', 'محفظه', 'محفظة', 'портфель']
  },
  AUTOMATION: {
    weight: 3,
    words: ['every day', 'every week', 'every month', 'daily', 'weekly', 'monthly', 'recurring', 'automatically', 'automation', 'autopilot', 'dca', 'schedule', 'cron', 'each week', 'always'],
    stems: ['هر روز', 'هر هفته', 'هر ماه', 'هفتگی', 'روزانه', 'ماهانه', 'خودکار', 'اتوماتیک', 'زمان‌بندی', 'دائم', 'هر بار', 'كل يوم', 'كل أسبوع', 'تلقائي', 'شهري', 'еженед']
  },
  RESEARCH: {
    weight: 1,
    words: ['why', 'what is', 'what are', 'explain', 'report', 'news', 'outlook', 'compare', 'versus', 'forecast', 'study', 'evidence', 'tvl'],
    stems: ['چرا', 'چطور', 'چگونه', 'چیه', 'وضوح', 'گزارش', 'تحقیق', 'پژوهش', 'خبر', 'آینده', 'مدرک', 'چند برابر', 'لماذا', 'أخبار', 'تقرير', 'новости']
  }
});

/**
 * The soft tier for the Protect route: risk mentioned as a SUBJECT rather than
 * asked as a guard. Worth a nudge, never enough to win a route on its own —
 * see the note above PROTECT's strong tier.
 */
const RISK_MENTION_LEXICON = Object.freeze({
  weight: 1,
  words: ['risk', 'riskiest', 'exposure', 'drawdown', 'volatility', 'worst case', 'how safe', 'is it safe', 'dangerous'],
  stems: ['ریسک', 'ریزک', 'نوسان', 'مخاطره', 'خطر', 'ریسك']
});

/** Sentence punctuation that turns an imperative into a question. Paired with
   `analyzeUtterance`'s own deliberation flag below: «بخرم؟» has no question
   mark and must still be read as asking. */
const QUESTION_MARKERS = Object.freeze(['?', '؟']);

const clean = (v, max = 80) => {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u200b-\u200f]/g, ' ').trim();
  return s.length ? s.slice(0, max) : null;
};
/* `null` must stay null. `Number(null)` is 0 and 0 is finite, so a bare
   Number.isFinite test turns a missing timestamp into "the epoch" and a
   missing amount into a real zero — the two bugs that make a budget read as
   spent and a stop as ancient history. Empty string gets the same treatment. */
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The two readings an amount in a sentence can have, kept apart on purpose.
 *
 * `statedCapitalValue` is PRESENCE: the user named a number. The route
 * classifier only needs that much — a plan request is a shape, not a price.
 *
 * `statedCapitalUsd` is a VALUE: how many dollars it is. Only USD-denominated
 * or stable amounts qualify without a price feed (`usdValueOf` is the audited
 * rule the product limits are measured with), and a token amount converts only
 * when the caller supplied a real price for it. Otherwise it stays null and the
 * plan says so, rather than printing $5,000 for «۵۰۰۰ SOL».
 */
const statedCapitalValue = (utterance = {}) => num(utterance?.capital?.value ?? utterance?.capitalUsd ?? null);

function statedCapitalUsd(utterance = {}, priceMap = null) {
  const cap = utterance?.capital || {};
  const value = num(cap.value);
  if (value == null || value <= 0) return null;
  const usd = usdValueOf({ amount: value, amountUnit: cap.unit || 'USD' });
  if (usd != null) return usd;
  const symbol = String(cap.unit || '').toUpperCase();
  const price = num(priceMap?.[symbol] ?? priceMap?.[symbol.toLowerCase()] ?? null);
  if (price == null || price <= 0) return null;
  return Math.round(value * price * 100) / 100;
}
const bounded = (v, lo, hi, fallback) => {
  const n = num(v);
  if (n === null) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Classify one utterance into a route.
 *
 * @param {string} text       what the user typed
 * @param {object} [options]
 * @param {string} [options.surface]  a tapped quick action pins the route
 * @param {string} [options.locale]
 * @param {object} [options.prior]    previous classification (context carry-over)
 * @returns {{ok:true, schema:string, intent:string, confidence:number,
 *            source:string, votes:Array, matched:Array, utterance:object,
 *            requiresClarification:boolean, deliberating:boolean}}
 */
export function classifyIntent(text, { surface = null, locale = null, prior = null } = {}) {
  const raw = String(text ?? '');
  const tapped = AI_SURFACES.find((s) => s.id === String(surface || ''));
  const utterance = analyzeUtterance(raw, { locale: locale || undefined });

  /* A tap on a quick action IS the intent. No guesswork, no inference: the
     user said which door they walked through. */
  if (tapped) {
    return {
      ok: true,
      schema: COMMAND_CENTER_SCHEMA,
      intent: tapped.intent,
      confidence: 1,
      source: 'surface-tap',
      surface: tapped.id,
      votes: [{ intent: tapped.intent, score: 1, via: 'tap' }],
      matched: utterance.matched || [],
      utterance,
      deliberating: false,
      requiresClarification: false
    };
  }

  const votes = new Map();
  const add = (intent, score, via) => {
    if (!AI_INTENTS.includes(intent) || !(score > 0)) return;
    votes.set(intent, { intent, score: (votes.get(intent)?.score || 0) + score, via: [...(votes.get(intent)?.via || []), via] });
  };

  for (const action of utterance.actions || []) {
    const mapped = ACTION_TO_INTENT[action.action];
    if (mapped) add(mapped[0], (action.score || 1) * mapped[1], `action:${action.action}`);
  }

  const normalized = utterance.normalized || '';
  const hitsIn = (row) => {
    let hits = 0;
    for (const word of row.words) if (normalized.includes(String(word).toLowerCase())) hits += 1;
    for (const stem of row.stems) if (stem && normalized.includes(stem)) hits += 1;
    return hits;
  };
  for (const [intent, row] of Object.entries(ROUTE_LEXICON)) {
    const hits = hitsIn(row);
    if (hits > 0) add(intent, Math.min(hits, 4) * row.weight, `${intent.toLowerCase()}-lexicon`);
  }

  /* Structural signals the semantic layer already extracted, weighted by what
     they mean for a route rather than for a sentence. */
  if (utterance.recurring) add('AUTOMATION', 4, `recurrence:${utterance.recurring}`);
  if (utterance.objective === 'preserve') add('PROTECT', 3, 'objective:preserve');
  if (utterance.objective === 'income' || utterance.objective === 'yield') add('EARN', 2, `objective:${utterance.objective}`);
  if (utterance.objective === 'growth') add('TRADE', 1, 'objective:growth');
  if (utterance.goalPct != null) add('PORTFOLIO', 1, 'goal');
  if (utterance.assets?.length && !utterance.actions?.length) add('RESEARCH', 1, 'assets-without-verb');
  if (utterance.maxLossUsd != null) add('PROTECT', 2, 'loss-guard');

  /* A bare mention of risk is a SOFT signal, and it goes quiet when the
     sentence is already stating a tolerance: «risk medium for 3 months» is the
     user filling in a constraint of a plan, not asking for a hedge. */
  if (hitsIn(RISK_MENTION_LEXICON) > 0) {
    add('PROTECT', utterance.riskTolerance ? 0.5 : 1.5, 'risk-mention');
  }

  /* The PLAN TRIANGLE: an amount, a horizon or a stated risk tolerance, and no
     action verb of its own — «۵۰۰۰ دلار، ریسک متوسط، ۳ ماه» — is a request for
     a strategy. It is also exactly the shape a keyword classifier files under
     "nothing matched", so it is decided on structure rather than vocabulary. */
  const statedCapital = statedCapitalValue(utterance);
  const hasActionVerb = (utterance.actions || []).some((a) => ['buy', 'sell', 'swap', 'bridge', 'send', 'futures', 'farm', 'defi'].includes(a.action));
  if (statedCapital > 0 && (utterance.durationHrs != null || utterance.goalPct != null || utterance.riskTolerance) && !hasActionVerb) {
    add('PORTFOLIO', 4, 'goal-triangle');
  }
  if (utterance.leverage != null) add('TRADE', 1, 'leverage');

  /* A question is never an order. «الان بخرم؟» asking whether to buy must land
     on RESEARCH, not on a drafted swap — the same rule the parser follows for
     the guided flow, applied one layer up so the right SURFACE opens. */
  const isQuestion = QUESTION_MARKERS.some((m) => raw.includes(m)) || utterance.deliberating === true;

  const ranked = [...votes.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0] || { intent: 'GENERAL', score: 0, via: ['no-signal'] };
  const second = ranked[1]?.score || 0;
  let intent = top.intent;

  if (isQuestion && intent === 'TRADE') {
    intent = 'RESEARCH';
    ranked.unshift({ intent: 'RESEARCH', score: top.score, via: ['deliberation-downgrade'] });
  }

  /* Confidence is the margin between the winning route and the runner-up, not
     a mood. Three rules, each earned by a failure mode:
       · nothing matched → LOW, whatever the clamp would otherwise say;
       · a question is never answered with certainty → capped;
       · one lonely signal beating an empty field → capped at 0.98, because a
         single keyword should still leave room for the UI to confirm. */
  const denominator = top.score + second + 1;
  const confidence = top.score <= 0
    ? 0.2
    : Math.round(Math.min(
      isQuestion ? 0.6 : 0.98,
      (top.score + (second > 0 ? 0 : 1)) / denominator
    ) * 100) / 100;

  const hasMoney = statedCapitalValue(utterance) != null;
  const requiresClarification = !isQuestion && (top.score < 2 || (!hasMoney && !(utterance.assets || []).length));

  /* Context carry-over: a follow-up like «okay do it» with no signal of its own
     keeps the route the previous turn established. */
  if (top.score === 0 && prior?.intent && AI_INTENTS.includes(prior.intent)) {
    return {
      ok: true, schema: COMMAND_CENTER_SCHEMA, intent: prior.intent, confidence: 0.4,
      source: 'context-carry-over', surface: prior.surface || null,
      votes: ranked, matched: utterance.matched || [], utterance,
      deliberating: Boolean(isQuestion), requiresClarification: true
    };
  }

  return {
    ok: true,
    schema: COMMAND_CENTER_SCHEMA,
    intent,
    confidence,
    source: top.score > 0 ? 'semantic-votes' : 'fallback',
    surface: AI_SURFACES.find((s) => s.intent === intent)?.id || 'ask',
    votes: ranked,
    matched: utterance.matched || [],
    utterance,
    deliberating: Boolean(isQuestion),
    requiresClarification
  };
}

/* ============================== planning ================================= */

/** A stable, readable allocation for a plan with no explicit weights. */
const DEFAULT_ALLOCATION = Object.freeze([
  { symbol: 'BTC', pct: 40, why: 'core' },
  { symbol: 'ETH', pct: 30, why: 'core' },
  { symbol: 'USDC', pct: 20, why: 'yield' },
  { symbol: 'CASH', pct: 10, why: 'buffer' }
]);

function allocationFor(intent, { riskTolerance, objective } = {}) {
  if (intent === 'PROTECT') {
    return riskTolerance === 'high'
      ? [{ symbol: 'USDC', pct: 50, why: 'stable' }, { symbol: 'BTC', pct: 30, why: 'core' }, { symbol: 'ETH', pct: 20, why: 'core' }]
      : [{ symbol: 'USDC', pct: 70, why: 'stable' }, { symbol: 'BTC', pct: 20, why: 'core' }, { symbol: 'CASH', pct: 10, why: 'buffer' }];
  }
  if (intent === 'EARN') {
    return [{ symbol: 'USDC', pct: 45, why: 'yield' }, { symbol: 'ETH', pct: 25, why: 'core' }, { symbol: 'BTC', pct: 20, why: 'core' }, { symbol: 'CASH', pct: 10, why: 'buffer' }];
  }
  if (objective === 'growth' || riskTolerance === 'high') {
    return [{ symbol: 'BTC', pct: 35, why: 'core' }, { symbol: 'ETH', pct: 35, why: 'core' }, { symbol: 'SOL', pct: 15, why: 'growth' }, { symbol: 'USDC', pct: 15, why: 'yield' }];
  }
  if (intent === 'TRADE') {
    return [{ symbol: 'BTC', pct: 50, why: 'core' }, { symbol: 'ETH', pct: 30, why: 'core' }, { symbol: 'USDC', pct: 20, why: 'buffer' }];
  }
  return DEFAULT_ALLOCATION.map((row) => ({ ...row }));
}

/**
 * Portfolio risk, 0–100, from what is actually held.
 *
 * Concentration is the dominant term for a retail wallet; a stablecoin buffer
 * buys the score back. With no holdings there is NOTHING to score, and
 * `score: null` is the only honest answer — a "0/100" on an unread wallet is a
 * green light invented out of an empty map.
 */
export function portfolioRiskScore({ holdings = null, market = null, aiControl = null } = {}) {
  const rows = Array.isArray(holdings) ? holdings.filter((h) => num(h?.valueUsd) != null && num(h.valueUsd) > 0) : null;
  const factors = [];
  if (!rows || rows.length === 0) {
    return {
      score: null, label: 'unknown', dataStatus: 'unavailable',
      factors: [{ code: 'NO_ATTESTED_BALANCES', detail: 'holdings-unread' }],
      concentrationPct: null, stableSharePct: null, chainCount: null
    };
  }
  const total = rows.reduce((sum, r) => sum + Number(r.valueUsd), 0);
  if (!(total > 0)) {
    return { score: null, label: 'unknown', dataStatus: 'unavailable', factors: [{ code: 'UNPRICED_HOLDINGS', detail: 'no-priced-value' }], concentrationPct: null, stableSharePct: null, chainCount: null };
  }
  const bySymbol = new Map();
  for (const r of rows) {
    const key = String(r.symbol || r.name || 'UNKNOWN').toUpperCase();
    bySymbol.set(key, (bySymbol.get(key) || 0) + Number(r.valueUsd));
  }
  const largest = Math.max(...bySymbol.values());
  const concentrationPct = Math.round((largest / total) * 1000) / 10;
  const STABLES = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD', 'CASH']);
  const stableSharePct = Math.round((([...bySymbol.entries()].reduce((sum, [s, v]) => (STABLES.has(s) ? sum + v : sum), 0)) / total) * 1000) / 10;
  const chains = new Set(rows.map((r) => r.chainId ?? r.chain ?? null).filter((v) => v !== null && v !== undefined));
  const chainCount = chains.size || null;

  let score = 18;
  score += Math.min(40, Math.max(0, (concentrationPct - 30) * 0.7));
  score -= Math.min(22, stableSharePct * 0.4);
  score += Math.min(10, Math.max(0, (rows.length <= 1 ? 12 : 0)));
  score += Math.min(8, chainCount && chainCount > 3 ? 6 : 0);
  if (market?.volatility === 'high') score += 8;
  if (market?.regime === 'risk-off') score += 6;
  if (num(market?.change24hPct) != null && Math.abs(Number(market.change24hPct)) > 6) score += 5;
  if (aiControl?.mode === 'autonomous') score += 4;

  const clamped = Math.round(Math.min(100, Math.max(0, score)));
  if (concentrationPct > 60) factors.push({ code: 'HIGH_CONCENTRATION', detail: `${concentrationPct}% in one asset`, severity: 'risk' });
  if (stableSharePct < 10) factors.push({ code: 'LOW_STABLE_BUFFER', detail: `${stableSharePct}% stable`, severity: 'risk' });
  if (rows.length === 1) factors.push({ code: 'SINGLE_ASSET', detail: 'one holding', severity: 'risk' });
  if (market?.volatility === 'high') factors.push({ code: 'HIGH_VOLATILITY', detail: 'market', severity: 'risk' });
  if (chainCount > 3) factors.push({ code: 'MULTI_CHAIN_OPERATIONAL_RISK', detail: `${chainCount} networks`, severity: 'note' });
  if (stableSharePct >= 40) factors.push({ code: 'DEFENSIVE_BUFFER', detail: `${stableSharePct}% stable`, severity: 'ok' });

  const label = clamped >= 70 ? 'high' : clamped >= 45 ? 'medium' : 'low';
  return {
    score: clamped,
    label,
    dataStatus: 'computed',
    factors,
    concentrationPct,
    stableSharePct,
    chainCount,
    totalValueUsd: Math.round(total * 100) / 100
  };
}

/**
 * A plan. Every field here is either (a) something the user said, (b)
 * something a feed reported, or (c) an assumption the planner had to make —
 * and (c) is always listed in `assumptions` so the UI can say it out loud.
 */
export function buildPlan({ message = '', classification = null, surface = null, context = {} } = {}) {
  const cls = classification || classifyIntent(message, { surface, locale: context.locale });
  const u = cls.utterance || {};
  const intent = cls.intent;
  const now = num(context.now) || Date.now();

  const aiControl = sanitizeAiControl(context.aiControl);
  const capitalUsdRaw = statedCapitalUsd(u, context.priceMap);
  const capitalUsd = capitalUsdRaw != null && capitalUsdRaw > 0
    ? Math.min(capitalUsdRaw, INTENT_LIMITS.maxTotalInputUsd)
    : null;
  const durationDays = num(u.durationHrs) != null ? Math.round(Number(u.durationHrs) / 24) : (intent === 'PORTFOLIO' ? 90 : null);

  const risk = portfolioRiskScore({ holdings: context.holdings, market: context.market, aiControl });
  const allocation = intent === 'RESEARCH' || intent === 'GENERAL' ? [] : allocationFor(intent, u);
  const yields = Array.isArray(context.yields) ? context.yields.filter((y) => num(y?.apy) != null) : [];
  const bestYield = yields.length ? [...yields].sort((a, b) => Number(b.apy) - Number(a.apy))[0] : null;
  /* Expected yield is ONLY ever a real venue number the feed reported for the
     stable leg of this plan. No feed, no promise — the card prints «—». */
  const expectedYieldPct = (() => {
    if (!bestYield || !allocation.length) return null;
    const stablePct = allocation.reduce((sum, a) => (a.why === 'yield' || a.why === 'stable' ? sum + a.pct : sum), 0);
    if (stablePct <= 0) return null;
    return Math.round((Number(bestYield.apy) * (stablePct / 100)) * 100) / 100;
  })();

  const actions = planActions({ intent, utterance: u, aiControl, bestYield, capitalUsd, context });
  const gate = evaluateRisk({
    priceImpactPct: num(context.market?.priceImpactPct),
    slippagePct: num(context.quote?.slippagePct ?? null),
    simulation: context.simulation || null,
    tokenRisk: context.tokenRisk || null,
    walletRisk: context.walletRisk || null,
    mev: context.mev || null
  });

  const assumptions = [];
  if (capitalUsd == null) assumptions.push({ code: 'CAPITAL_ASSUMED', detail: 'amount-not-stated' });
  if (durationDays == null) assumptions.push({ code: 'HORIZON_ASSUMED', detail: 'no-duration' });
  if (risk.dataStatus === 'unavailable') assumptions.push({ code: 'RISK_UNATTESTED', detail: 'no-balances' });
  if (!yields.length) assumptions.push({ code: 'NO_YIELD_FEED', detail: 'yield-unavailable' });
  if (u.assets?.length) {
    for (const a of u.assets.slice(0, 6)) assumptions.push({ code: 'ASSET_READ', detail: `${a.word}→${a.symbol}`, via: a.via });
  }

  const riskScore = risk.score != null
    ? Math.min(100, risk.score + (actions.length > 2 ? 6 : 0) + (gate.decision === 'block' ? 30 : gate.decision === 'acknowledge' ? 12 : 0))
    : null;

  return {
    schema: AI_PLAN_SCHEMA,
    id: `plan_${new Date(now).toISOString().slice(2, 10).replace(/-/g, '')}_${Math.abs(hash32(`${intent}|${capitalUsd}|${actions.length}|${now}`)).toString(36).slice(0, 6)}`,
    createdAt: now,
    intent,
    surface: cls.surface || AI_SURFACES.find((s) => s.intent === intent)?.id || 'ask',
    confidence: cls.confidence,
    source: cls.source,
    summaryFrom: clean(message, 240) || null,
    capitalUsd,
    durationDays,
    riskTolerance: u.riskTolerance || null,
    objective: u.objective || null,
    allocation: allocation.map((a) => ({ ...a })),
    actions,
    expectedYieldPct,
    riskScore,
    riskLabel: risk.label,
    riskFindings: risk.factors,
    executionRisk: { decision: gate.decision, level: gate.level, blocked: gate.blocked, warnings: gate.warnings },
    agentLanes: lanesForIntent(intent),
    /* Two invariants, asserted by the probes: a plan is never an order, and
       this module never holds a signing role. */
    requiresApproval: true,
    executionPermission: false,
    canSelfApprove: false,
    dataStatus: {
      portfolio: risk.dataStatus === 'computed' ? 'live' : 'unavailable',
      market: context.market?.dataStatus || 'unavailable',
      yield: yields.length ? 'live' : 'unavailable',
      quote: context.quote?.ok ? 'live' : 'unavailable'
    },
    assumptions,
    cannotDo: Object.freeze([
      'hold-keys', 'sign-without-wallet', 'move-funds-without-confirmation', 'bypass-guardian'
    ])
  };
}

/** The legs a plan would run. Type + asset + amount; never calldata. */
function planActions({ intent, utterance, aiControl, bestYield, capitalUsd, context }) {
  const chains = aiControl.allowedChains;
  const chainId = (context.chainId && chains.includes(Number(context.chainId)))
    ? Number(context.chainId)
    : (chains[0] ?? 42161);
  const assets = (utterance.assets || []).map((a) => a.symbol);
  const from = assets[0] || (capitalUsd != null ? 'USD' : null);
  const to = assets[1] || (assets[0] && assets.length > 1 ? assets[1] : null);
  const amount = capitalUsd != null ? String(capitalUsd) : null;

  const mk = (type, extra = {}) => ({
    type,
    asset: extra.asset || to || from || null,
    amount: extra.amount ?? amount,
    chainId: extra.chainId ?? chainId,
    venue: extra.venue || null,
    descriptionKey: `intentAI.cc.action.${String(type).toLowerCase()}`,
    /* Structured plan metadata the unified AI OS uses to build a real DCA /
       goal / rebalance record without guessing what the user said. */
    cadence: extra.cadence || null,
    leverage: extra.leverage || null,
    from: extra.from || null,
    parameters: extra.parameters || null,
    /* The hand-off target: the screen where this leg really executes. A plan
       that does not know where it goes is a decoration. */
    handoffRoute: extra.route || routeForType(type, { chainId })
  });

  switch (intent) {
    case 'TRADE': {
      const legs = [mk('SWAP', { asset: to || 'BTC', from })];
      if ((utterance.actions || []).some((a) => a.action === 'bridge')) legs.push(mk('BRIDGE', { asset: to || 'USDC', route: '/bridge' }));
      if (utterance.leverage != null) legs.unshift(mk('FUTURES_OPEN', { leverage: utterance.leverage, route: '/perp?tab=onchain' }));
      return legs;
    }
    case 'EARN':
      return [mk('DEPOSIT', { asset: from || 'USDC', venue: bestYield?.protocol || null, route: '/farm' }),
        ...(bestYield ? [mk('YIELD_SWEEP', { asset: from || 'USDC', amount: null, venue: bestYield.protocol, apy: Number(bestYield.apy) })] : [])];
    case 'PROTECT': {
      const legs = [mk('STABLE_SHIELD', { asset: 'USDC', route: '/loan' })];
      if (context.approvals?.unsafeCount > 0) legs.unshift(mk('REVOKE_APPROVAL', { asset: null, route: '/wallet' }));
      legs.push(mk('STOP_LOSS', { asset: to || 'BTC' }));
      return legs;
    }
    case 'PORTFOLIO':
      return [mk('REBALANCE', { asset: null })];
    case 'AUTOMATION':
      return [mk('AUTOMATION_CREATE', {
        asset: to || from || 'BTC',
        amount,
        cadence: utterance.recurring || 'weekly',
        route: '/intent-ai'
      })];
    case 'RESEARCH':
      return [mk('ANALYZE', { asset: from || to || 'BTC' })];
    default:
      return [mk('ANALYZE', { asset: assets[0] || 'BTC' })];
  }
}

function routeForType(type, { chainId }) {
  switch (String(type)) {
    case 'SWAP': return `/swap${chainId ? `?chain=${chainId}` : ''}`;
    case 'BRIDGE': return '/bridge';
    case 'DEPOSIT':
    case 'YIELD_SWEEP': return '/farm';
    case 'STABLE_SHIELD': return '/loan';
    case 'FUTURES_OPEN': return '/perp?tab=onchain';
    case 'REVOKE_APPROVAL': return '/wallet';
    case 'REBALANCE': return '/portfolio';
    case 'AUTOMATION_CREATE': return '/intent-ai';
    default: return '/intent';
  }
}

/* ============================ the firewall ============================== */

export const FIREWALL_CHECKS = Object.freeze([
  'EMERGENCY_STOP', 'NO_ACTIONS', 'MODE_NOT_ALLOWED', 'SURFACE_DISABLED',
  'CHAIN_NOT_ALLOWED', 'PER_TX_LIMIT', 'DAILY_LIMIT', 'RISK_LIMIT',
  'SIMULATION_BLOCKED', 'WALLET_REQUIRED', 'APPROVAL_REQUIRED'
]);

/**
 * The Execution Firewall. It can only ever make a plan MORE blocked.
 *
 * Order matters and is deliberate: a stop is checked before anything else (a
 * stopped session must not be able to compute a "would have been allowed"), and
 * the signature requirement is LAST because it is the one thing that is always
 * true — the user's wallet is the boundary, not a fallback.
 */
export function validateExecution(plan, {
  aiControl: rawControl = null,
  automations = null,
  dailyVolumeUsd = null,
  wallet = null,
  sessionLevel = null,
  now = Date.now()
} = {}) {
  const aiControl = sanitizeAiControl(rawControl);
  const checks = [];
  const push = (code, ok, detail = null) => checks.push({ code, status: ok ? 'pass' : 'fail', detail });

  const stopped = aiControl.stopActive === true;
  push('EMERGENCY_STOP', !stopped, stopped ? `since ${new Date(aiControl.stoppedAt || now).toISOString()}` : null);

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  push('NO_ACTIONS', actions.length > 0, actions.length ? null : 'plan-has-no-legs');

  const modeAllowed = aiControl.mode !== 'manual';
  push('MODE_NOT_ALLOWED', modeAllowed, modeAllowed ? null : 'manual-mode-is-analysis-only');

  /* The composer route is always open: analysis is what the assistant is for,
     and a switch that could mute it would leave no way to ask anything. The
     four money routes (trade · earn · protect · plan) are what the box governs. */
  const surface = String(plan?.surface || '');
  const surfaceEnabled = !surface || surface === 'ask' || aiControl.enabledSurfaces.includes(surface);
  push('SURFACE_DISABLED', surfaceEnabled, surfaceEnabled ? null : `surface:${surface}`);

  const chains = aiControl.allowedChains;
  const badChain = actions.find((a) => a?.chainId != null && !chains.includes(Number(a.chainId)));
  push('CHAIN_NOT_ALLOWED', !badChain, badChain ? `chain:${badChain.chainId}` : null);

  const amount = num(plan?.capitalUsd);
  const perTxOk = amount == null || amount <= aiControl.maxPerTxUsd;
  push('PER_TX_LIMIT', perTxOk, perTxOk ? null : `want ${amount}, cap ${aiControl.maxPerTxUsd}`);

  const spent = num(dailyVolumeUsd) ?? 0;
  const projected = spent + (amount || 0);
  const dailyOk = projected <= aiControl.maxDailyUsd;
  push('DAILY_LIMIT', dailyOk, dailyOk ? null : `spent ${Math.round(spent)} + plan ${amount || 0} > cap ${aiControl.maxDailyUsd}`);

  const riskScore = num(plan?.riskScore);
  const riskOk = riskScore == null || riskScore <= aiControl.maxRiskScore;
  push('RISK_LIMIT', riskOk, riskOk ? null : `risk ${riskScore} > cap ${aiControl.maxRiskScore}`);

  const simBlocked = plan?.executionRisk?.decision === 'block';
  push('SIMULATION_BLOCKED', !simBlocked, simBlocked ? (plan.executionRisk.blocked || []).join(',') : null);

  push('WALLET_REQUIRED', wallet?.connected === true && wallet?.canSign === true, wallet?.connected ? 'connected-but-cannot-sign' : 'no-wallet');

  /* Always the last one: approval is not a fallback, it is the design. */
  const approvalWaived = aiControl.mode === 'autonomous';
  push('APPROVAL_REQUIRED', true, approvalWaived ? 'autonomous: plan approval waived, wallet signature still required' : 'user must tap Approve, then sign');

  const failed = checks.filter((c) => c.status === 'fail');
  const blocking = failed.filter((c) => c.code !== 'APPROVAL_REQUIRED');

  return {
    ok: blocking.length === 0,
    allowed: blocking.length === 0,
    schema: COMMAND_CENTER_SCHEMA,
    reason: blocking[0]?.code || null,
    reasonDetail: blocking[0]?.detail || null,
    requiresApproval: !approvalWaived,
    /* The invariant the panel renders: nothing here signs. */
    requiresUserSignature: true,
    autonomousAllowed: false,
    riskScore,
    budget: {
      spentTodayUsd: Math.round(spent * 100) / 100,
      remainingTodayUsd: Math.max(0, Math.round((aiControl.maxDailyUsd - projected) * 100) / 100),
      maxPerTxUsd: aiControl.maxPerTxUsd,
      maxDailyUsd: aiControl.maxDailyUsd,
      maxRiskScore: aiControl.maxRiskScore
    },
    automationsRunning: Array.isArray(automations) ? automations.filter((a) => a?.active).length : null,
    sessionLevel: num(sessionLevel),
    checks
  };
}

/* ============================ execution stages ========================== */

/**
 * The pipeline a plan walks: Plan → Risk → Simulation → Fresh Quotes →
 * Execution Firewall → Wallet → Signature → Blockchain.
 *
 * Each stage reports what THIS software can attest to. `plan`, `risk`,
 * `simulation` and `firewall` are computed here; `wallet`, `signature` and
 * `blockchain` belong to the user's wallet and the network — they are reported
 * as `handoff` (we sent the user there) or `unavailable` (we cannot see), and
 * never as `done`. An app that paints its own checkmark on someone else's
 * confirmation is lying about money.
 */
export const EXECUTION_STAGES = Object.freeze(['plan', 'risk', 'simulation', 'quotes', 'firewall', 'wallet', 'signature', 'blockchain']);

export function executionStageLedger(plan, verdict, { wallet = null, broadcast = null, simulation = null, quote = null, now = Date.now() } = {}) {
  const has = (v) => v !== null && v !== undefined;
  const stage = (id, status, detail, attested) => ({ id, status, detail, attested, at: attested ? now : null });
  return {
    schema: COMMAND_CENTER_SCHEMA,
    planId: plan?.id || null,
    stages: [
      stage('plan', plan ? 'done' : 'unavailable', plan ? `${plan.actions?.length || 0} leg(s) · ${plan.intent}` : 'no-plan', Boolean(plan)),
      stage('risk', has(verdict?.riskScore) ? 'done' : 'unavailable', has(verdict?.riskScore) ? `${verdict.riskScore}/100 · ${plan?.riskLabel || 'unknown'}` : 'no-attested-balances', has(verdict?.riskScore)),
      stage('simulation', simulation?.ok ? 'done' : 'unavailable', simulation?.ok ? 'fork simulation passed' : 'no-simulation-provider-attached', Boolean(simulation?.ok)),
      stage('quotes', quote?.ok ? 'done' : 'unavailable', quote?.ok ? `fresh ${quote.venue || 'venue'} quote` : 'a live quote is fetched at the venue, not here', Boolean(quote?.ok)),
      stage('firewall', verdict ? (verdict.ok ? 'done' : 'blocked') : 'unavailable', verdict?.reason || (verdict?.ok ? 'within-budget' : null), Boolean(verdict)),
      stage('wallet', wallet?.connected ? 'ready' : 'unavailable', wallet?.connected ? 'connected' : 'connect-a-wallet-to-sign', false),
      stage('signature', 'handoff', 'the signature belongs to your wallet, never to this app', false),
      stage('blockchain', 'handoff', 'settles only if you sign and the network accepts it', false)
    ]
  };
}

/** The "thinking" rail: which real reads a plan of this intent performs. */
export function thinkingStages(intent) {
  const base = [
    { id: 'understanding', labelKey: 'intentAI.cc.think.understanding' },
    { id: 'portfolio', labelKey: 'intentAI.cc.think.portfolio' }
  ];
  const tail = {
    TRADE: [{ id: 'market', labelKey: 'intentAI.cc.think.market' }, { id: 'quote', labelKey: 'intentAI.cc.think.quote' }],
    EARN: [{ id: 'market', labelKey: 'intentAI.cc.think.market' }, { id: 'yield', labelKey: 'intentAI.cc.think.yield' }, { id: 'protocolRisk', labelKey: 'intentAI.cc.think.protocolRisk' }],
    PROTECT: [{ id: 'risk', labelKey: 'intentAI.cc.think.risk' }, { id: 'approvals', labelKey: 'intentAI.cc.think.approvals' }],
    PORTFOLIO: [{ id: 'market', labelKey: 'intentAI.cc.think.market' }, { id: 'risk', labelKey: 'intentAI.cc.think.risk' }],
    RESEARCH: [{ id: 'market', labelKey: 'intentAI.cc.think.market' }, { id: 'sources', labelKey: 'intentAI.cc.think.sources' }],
    AUTOMATION: [{ id: 'schedule', labelKey: 'intentAI.cc.think.schedule' }, { id: 'risk', labelKey: 'intentAI.cc.think.risk' }],
    GENERAL: [{ id: 'market', labelKey: 'intentAI.cc.think.market' }]
  }[intent] || [];
  return [...base, ...tail, { id: 'strategy', labelKey: 'intentAI.cc.think.strategy' }];
}

/* ============================== AI control ============================== */

export const AI_MODES = Object.freeze([
  Object.freeze({ id: 'manual', level: 1, labelKey: 'intentAI.cc.mode.manual' }),
  Object.freeze({ id: 'assisted', level: 2, labelKey: 'intentAI.cc.mode.assisted' }),
  Object.freeze({ id: 'autonomous', level: 3, labelKey: 'intentAI.cc.mode.autonomous' })
]);

/** Networks the intent layer can actually route. Solana is deliberately not
 *  among them — see `NON_EVM_VENUES`: it has its own screen and no intent
 *  adapter, so offering it as a checkbox would be offering a broken promise. */
export const AI_CONTROL_CHAINS = Object.freeze([
  { chainId: 1, short: 'Ethereum' },
  { chainId: 10, short: 'Optimism' },
  { chainId: 56, short: 'BSC' },
  { chainId: 137, short: 'Polygon' },
  { chainId: 8453, short: 'Base' },
  { chainId: 42161, short: 'Arbitrum' },
  { chainId: 501, short: 'Solana' }
]);

export const NON_EVM_VENUES = Object.freeze([
  { id: 'solana', route: '/solana', reason: 'own venue · no intent adapter' },
  { id: 'tron', route: '/wallet', reason: 'own venue · no intent adapter' }
]);

export const AI_CONTROL_DEFAULTS = Object.freeze({
  /*
   * ─── DEFAULT MODE IS AUTONOMOUS: THE LADDER IS NO LONGER A USER CHOICE ───
   * This was `'assisted'` (level 2 of the manual → assisted → autonomous
   * ladder), and the client never sends an `aiControl` of its own — so every
   * live turn was sanitised onto `assisted`, which sets
   * `requiresApproval: true` in the command centre. That is the leftover
   * version-1 behaviour the product owner asked to have removed: a level the
   * USER was supposed to pick, still silently capping what the assistant may
   * do on every single request.
   *
   * What changing this actually does, precisely, because it touches money:
   *
   *   · REMOVED — the extra in-chat «tap Approve» step before a plan is
   *     handed over. `commandCenter.js` derives `requiresApproval` from this
   *     mode and nothing else.
   *   · UNCHANGED — `requiresUserSignature: true` and `autonomousAllowed:
   *     false` are hard-coded in the command centre, not derived from the
   *     mode. The wallet signature is still the only thing that moves funds.
   *   · UNCHANGED — every other gate still runs on every plan: emergency
   *     stop, chain allowlist, per-transaction cap, daily cap, risk score,
   *     simulation block, wallet-required.
   *
   * So this removes a redundant confirmation layer the assistant imposed on
   * itself. It does not remove the authorisation that protects the money.
   */
  mode: 'autonomous',
  /*
   * The user owns their wallet and their money. There is no artificial
   * $100/$500/$1000 ceiling inside the AI OS: the default budget is the
   * product's hard safety boundary, not a small starter allowance. Mandatory
   * checks (balance, slippage, gas, validation, simulation, wallet signature)
   * still run on every execution via the Guardian and the wallet.
   */
  maxPerTxUsd: DEFAULT_POLICY_CAPS.maxTransactionUsd,
  maxDailyUsd: DEFAULT_POLICY_CAPS.maxCapitalUsd,
  maxRiskScore: 100,
  allowedChains: Object.freeze([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144, 501]),
  enabledSurfaces: Object.freeze(['trade', 'earn', 'protect', 'plan', 'automate']),
  stopActive: false,
  stoppedAt: null
});

/**
 * Clamp user-supplied control state into something the firewall may trust.
 * Caps are the PRODUCT caps (intentLimits / DEFAULT_POLICY_CAPS): the AI
 * control box can only ever choose a tighter number than the product allows,
 * which is what makes it safe to persist.
 */
export function sanitizeAiControl(input = {}) {
  const d = AI_CONTROL_DEFAULTS;
  const mode = AI_MODES.some((m) => m.id === input?.mode) ? input.mode : d.mode;
  const chainsIn = Array.isArray(input?.allowedChains) && input.allowedChains.length
    ? input.allowedChains
    : d.allowedChains;
  const allowedChains = [...new Set(chainsIn.map((c) => Number(c)).filter((c) => AI_CONTROL_CHAINS.some((x) => x.chainId === c)))];
  const surfacesIn = Array.isArray(input?.enabledSurfaces) ? input.enabledSurfaces : d.enabledSurfaces;
  const enabledSurfaces = [...new Set(surfacesIn.filter((s) => AI_SURFACES.some((x) => x.id === s)))];
  const maxPerTxUsd = Math.round(bounded(input?.maxPerTxUsd, 1, DEFAULT_POLICY_CAPS.maxTransactionUsd, d.maxPerTxUsd));
  const maxDailyUsd = Math.round(bounded(input?.maxDailyUsd, 1, DEFAULT_POLICY_CAPS.maxCapitalUsd, d.maxDailyUsd));
  return {
    schema: AI_CONTROL_SCHEMA,
    mode,
    level: AI_MODES.find((m) => m.id === mode).level,
    /* A per-transaction cap above the daily cap is a typo, not a policy: one
       transaction could then spend the whole day's budget AND leave room for
       another. Reconciled AFTER clamping, on the values that will actually be
       enforced — a raw `-5` in the daily field is clamped to $1 first, and the
       per-tx cap follows it down. */
    maxPerTxUsd: Math.min(maxPerTxUsd, maxDailyUsd),
    maxDailyUsd,
    maxRiskScore: Math.round(bounded(input?.maxRiskScore, 0, 100, d.maxRiskScore)),
    allowedChains: allowedChains.length ? allowedChains : [...d.allowedChains],
    enabledSurfaces,
    stopActive: input?.stopActive === true,
    stoppedAt: num(input?.stoppedAt)
  };
}

/** How much room the AI control leaves inside the session policy ceilings. */
export function aiControlPreview(aiControl = {}) {
  const c = sanitizeAiControl(aiControl);
  const mode = AI_MODES.find((m) => m.id === c.mode);
  return {
    schema: AI_CONTROL_SCHEMA,
    mode: c.mode,
    level: mode.level,
    prepares: mode.level >= 2,
    /* Rendered honestly: even at L3 the app stops at the signature. */
    executesWithoutYou: false,
    caps: {
      perTxUsd: c.maxPerTxUsd,
      dailyUsd: c.maxDailyUsd,
      risk: c.maxRiskScore,
      chains: c.allowedChains
    },
    stopActive: c.stopActive
  };
}

/* ============================== storage ================================= */

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* private mode / SSR */ }
  return null;
}

export function loadAiControl(storage = defaultStorage()) {
  if (!storage) return { ...AI_CONTROL_DEFAULTS, schema: AI_CONTROL_SCHEMA };
  try {
    const raw = storage.getItem(AI_CONTROL_STORE_KEY);
    if (!raw) return { ...AI_CONTROL_DEFAULTS, schema: AI_CONTROL_SCHEMA };
    return sanitizeAiControl(JSON.parse(raw));
  } catch {
    return { ...AI_CONTROL_DEFAULTS, schema: AI_CONTROL_SCHEMA };
  }
}

export function saveAiControl(prefs, storage = defaultStorage()) {
  const next = sanitizeAiControl(prefs);
  if (storage) {
    try { storage.setItem(AI_CONTROL_STORE_KEY, JSON.stringify(next)); } catch { /* quota — in-memory copy still returned */ }
  }
  return next;
}

/**
 * The kill switch. Persisted, because "stop everything" that resets on a page
 * refresh is not a stop. Releasing it is an explicit user action in the AI
 * control box, and it never resumes an automation by itself.
 */
export function readStopFlag(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AI_STOP_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.active === true ? { active: true, at: num(parsed.at) ?? Date.now(), reason: clean(parsed.reason, 80) } : null;
  } catch {
    return null;
  }
}

export function writeStopFlag(active, { reason = 'user-stop', storage = defaultStorage() } = {}) {
  const next = active ? { active: true, at: Date.now(), reason: clean(reason, 80) } : null;
  if (storage) {
    try {
      if (next) storage.setItem(AI_STOP_STORE_KEY, JSON.stringify(next));
      else storage.removeItem(AI_STOP_STORE_KEY);
    } catch { /* fail closed: without persistence the flag still lives in memory */ }
  }
  return next;
}

/* ============================= automations ============================== */

export const AUTOMATION_KINDS = Object.freeze(['dca', 'rebalance', 'protect', 'yield']);

const CADENCE_MS = Object.freeze({
  daily: 24 * 3600_000,
  weekly: 7 * 24 * 3600_000,
  biweekly: 14 * 24 * 3600_000,
  monthly: 30 * 24 * 3600_000
});

export const AUTOMATION_CADENCES = Object.freeze(Object.keys(CADENCE_MS));

function automationId() {
  return `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalise one stored/typed row. Strict on purpose: a half-shaped automation
 * that "looks fine" is how a recurring buy ends up running with no amount, or
 * with an amount the user never typed. Returns null rather than guessing.
 */
export function normalizeAutomation(row) {
  if (!row || typeof row !== 'object') return null;
  const kind = AUTOMATION_KINDS.includes(row.kind) ? row.kind : null;
  const cadence = CADENCE_MS[row.cadence] ? row.cadence : null;
  if (!kind || !cadence) return null;
  const amountUsd = num(row.amountUsd);
  if (kind === 'dca' && (amountUsd === null || amountUsd <= 0)) return null;
  const asset = clean(row.asset, 16)?.toUpperCase() || null;
  const chainId = num(row.chainId);
  const statuses = ['ACTIVE', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED'];
  const status = statuses.includes(String(row.status || '').toUpperCase())
    ? String(row.status).toUpperCase()
    : (row.active === false ? 'PAUSED' : 'ACTIVE');
  return {
    schema: AI_AUTOMATION_SCHEMA,
    id: clean(row.id, 40) || automationId(),
    kind,
    cadence,
    asset,
    amountUsd: amountUsd != null && amountUsd >= 0 ? amountUsd : null,
    chainId: Number.isInteger(chainId) ? chainId : null,
    targetPct: bounded(row.targetPct, 0, 100, null),
    note: clean(row.note, 120),
    active: row.active !== false,
    createdAt: num(row.createdAt) ?? Date.now(),
    lastRunAt: num(row.lastRunAt),
    nextRunAt: num(row.nextRunAt),
    runs: Number.isInteger(Number(row.runs)) && Number(row.runs) >= 0 ? Number(row.runs) : 0,
    /* Honest provenance: nothing in this app has ever fired an automation.
       `prepared` means "the next run is a plan waiting for your confirm". */
    execution: 'per-run-confirmation',
    stopOnEmergency: true,
    /* Unified AI OS fields (preserved, never invented). */
    status,
    frequency: String(cadence || row.frequency || '').toUpperCase() || null,
    nextExecution: num(row.nextExecution) ?? num(row.nextRunAt) ?? null,
    lastExecution: num(row.lastExecution) ?? num(row.lastRunAt) ?? null,
    result: clean(row.result, 240),
    transactionHash: clean(row.transactionHash, 128),
    error: clean(row.error, 240),
    updatedAt: num(row.updatedAt) ?? null
  };
}

/**
 * Create one automation. The schedule itself is validated by the audited
 * recurring-intent state machine, so this cannot mint a cadence that state
 * machine would refuse (under a minute, in the past, unbounded runs).
 */
export function createAutomation(input, { now = Date.now() } = {}) {
  const base = normalizeAutomation({ ...input, createdAt: input?.createdAt ?? now });
  if (!base) return { ok: false, code: 'AUTOMATION_INVALID' };
  const intervalMs = CADENCE_MS[base.cadence];
  const firstRunAt = base.nextRunAt && base.nextRunAt > now ? base.nextRunAt : now + intervalMs;
  const recurring = createRecurringIntent({
    id: base.id,
    intent: { kind: base.kind, asset: base.asset, amountUsd: base.amountUsd, chainId: base.chainId },
    schedule: { intervalMs, firstRunAt },
    maxRuns: Number.isInteger(Number(input?.maxRuns)) && Number(input.maxRuns) > 0 ? Number(input.maxRuns) : null,
    now
  });
  if (!recurring.ok) return { ok: false, code: recurring.code || recurring.error || 'SCHEDULE_INVALID' };
  return {
    ok: true,
    automation: {
      ...base,
      nextRunAt: firstRunAt,
      /* The recurring record's own authority flags, carried through so the UI
         cannot imply more than the state machine permits. */
      perRunAuthorization: recurring.recurring.userAuthorizationPerRun === true,
      policyRecheckRequired: recurring.recurring.policyRecheckRequired === true
    }
  };
}

export function loadAutomations(storage = defaultStorage()) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(AI_AUTOMATION_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAutomation).filter(Boolean).slice(0, 24);
  } catch {
    return [];
  }
}

export function saveAutomations(rows, storage = defaultStorage()) {
  const next = (Array.isArray(rows) ? rows : []).map(normalizeAutomation).filter(Boolean).slice(0, 24);
  if (storage) {
    try { storage.setItem(AI_AUTOMATION_STORE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }
  return next;
}

/** Add / replace / remove — each returns the FULL new list so the caller can
 *  set state once and never race a stale array against itself. */
export function upsertAutomation(rows, automation, { now = Date.now() } = {}) {
  const made = automation?.schema === AI_AUTOMATION_SCHEMA ? automation : createAutomation(automation, { now }).automation;
  if (!made) return { rows, ok: false, code: 'AUTOMATION_INVALID' };
  const next = [made, ...(rows || []).filter((r) => r.id !== made.id)];
  return { rows: next, ok: true, automation: made };
}

export function removeAutomation(rows, id) {
  const key = String(id || '');
  return (rows || []).filter((r) => String(r.id) !== key);
}

/**
 * Toggle an automation without inventing a state the live-intent machine does
 * not have: `applyLiveControl` is what maps STOP/PAUSE onto real transitions,
 * so pausing here is the same operation the audited engine performs.
 */
export function setAutomationActive(rows, id, active, { now = Date.now() } = {}) {
  const key = String(id || '');
  return (rows || []).map((r) => {
    if (String(r.id) !== key) return r;
    if (active) return { ...r, active: true, pausedAt: null };
    const applied = applyLiveControl({
      schema: 'fbt.live-intent.v1',
      id: r.id,
      status: 'QUEUED',
      controls: { stopped: false, paused: false, revoked: false, disconnected: false, emergency_exit: false },
      expiresAt: null
    }, 'PAUSE', { now });
    return { ...r, active: false, pausedAt: now, pauseObserved: applied.ok === true };
  });
}

/** What the automations would spend inside a UTC day — the firewall's input. */
export function automationSpendToday(rows = [], now = Date.now()) {
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  let total = 0;
  let dueToday = 0;
  for (const row of rows || []) {
    if (!row?.active) continue;
    const amount = num(row.amountUsd) || 0;
    const cadenceMs = CADENCE_MS[row.cadence] || CADENCE_MS.weekly;
    /* Runs scheduled inside this calendar day count against today's budget;
       a weekly DCA spends at most once a week, so scale it rather than
       charging the whole amount to a day it may not fire in. */
    const nextRun = num(row.nextRunAt);
    const firesToday = nextRun != null && nextRun >= dayStart && nextRun < dayStart + 86_400_000;
    if (firesToday) dueToday += 1;
    const share = cadenceMs <= 86_400_000 ? 1 : (86_400_000 / cadenceMs);
    total += amount * share;
  }
  return { usd: Math.round(total * 100) / 100, dueToday, cadenceMs: CADENCE_MS };
}

export function automationTotals(rows = []) {
  const list = (rows || []).filter(Boolean);
  return {
    total: list.length,
    active: list.filter((r) => r.active).length,
    weeklyCommitmentUsd: Math.round(list.reduce((sum, r) => {
      if (!r.active) return sum;
      const amount = num(r.amountUsd) || 0;
      const cadenceMs = CADENCE_MS[r.cadence] || CADENCE_MS.weekly;
      return sum + amount * (7 * 86_400_000 / cadenceMs);
    }, 0) * 100) / 100,
    dataStatus: list.length ? 'local' : 'empty'
  };
}

export const automationCadenceMs = (cadence) => CADENCE_MS[cadence] || null;

/* ============================== dashboard =============================== */

/**
 * Everything the AI page paints, in one snapshot: portfolio value, risk, the
 * count of opportunities and risks the AI actually found, the running
 * automations and the budget the firewall is guarding.
 *
 * `opportunities` and `risks` are `null` when their feed is down. A zero is a
 * claim; null is a fact.
 */
export function dashboardSnapshot({
  aiControl = null,
  automations = null,
  txHistory = null,
  holdings = null,
  market = null,
  yields = null,
  approvals = null,
  plan = null,
  now = Date.now()
} = {}) {
  const control = sanitizeAiControl(aiControl);
  const risk = portfolioRiskScore({ holdings, market, aiControl: control });
  const yieldRows = Array.isArray(yields) ? yields.filter((y) => num(y?.apy) != null) : null;
  const rows = Array.isArray(txHistory) ? txHistory : [];
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const SPENT = new Set(['completed', 'submitted', 'authorized', 'pending', 'partial']);
  const dailyVolumeUsd = rows
    .filter((r) => SPENT.has(r?.status) && num(r?.at) != null && Number(r.at) >= dayStart)
    .reduce((sum, r) => sum + (num(r?.amountUsd) || 0), 0);

  const opportunities = yieldRows == null ? null : (() => {
    /* An "opportunity" is a venue the feed reports above 4% APY with an
       eligible flag — the product's own threshold, not a mood. */
    const list = yieldRows
      .filter((y) => Number(y.apy) >= 4)
      .sort((a, b) => Number(b.apy) - Number(a.apy))
      .slice(0, 5);
    return {
      count: list.length,
      best: list[0] ? { protocol: clean(list[0].protocol, 40), apy: Math.round(Number(list[0].apy) * 100) / 100, symbol: clean(list[0].symbol, 12) } : null,
      items: list.map((y) => ({ protocol: clean(y.protocol, 40), symbol: clean(y.symbol, 12), apy: Math.round(Number(y.apy) * 100) / 100, riskBand: clean(y.riskBand, 16) || null }))
    };
  })();

  const risks = (() => {
    const found = [];
    for (const f of risk.factors || []) if (f.severity === 'risk') found.push({ code: f.code, detail: f.detail, source: 'portfolio' });
    if (num(approvals?.unsafeCount) > 0) found.push({ code: 'UNSAFE_APPROVALS', detail: `${approvals.unsafeCount} standing approval(s)`, source: 'wallet' });
    if (market?.regime === 'risk-off') found.push({ code: 'RISK_OFF_REGIME', detail: 'market regime', source: 'market' });
    if (control.stopActive) found.push({ code: 'EMERGENCY_STOP_ACTIVE', detail: 'no plan can run', source: 'control' });
    if (risk.dataStatus === 'unavailable' && !rows.length) found.push({ code: 'NOTHING_ATTESTED', detail: 'no balances, no history', source: 'data' });
    return { count: found.length, items: found.slice(0, 6), dataStatus: 'computed' };
  })();

  const totals = automationTotals(Array.isArray(automations) ? automations : null);
  const commitment = automationSpendToday(Array.isArray(automations) ? automations : [], now);

  return {
    schema: AI_DASHBOARD_SCHEMA,
    at: now,
    portfolio: {
      totalValueUsd: risk.totalValueUsd ?? null,
      riskScore: risk.score,
      riskLabel: risk.label,
      concentrationPct: risk.concentrationPct,
      stableSharePct: risk.stableSharePct,
      pnl24hPct: num(market?.change24hPct),
      dataStatus: risk.dataStatus === 'computed' ? 'live' : 'unavailable',
      /* Whose numbers these are: the app can price a connected wallet, and it
         says so, instead of pretending the total is a server-side fact. */
      source: risk.dataStatus === 'computed' ? 'connected-wallet' : 'none'
    },
    insights: { opportunities, risks },
    automations: { ...totals, spendTodayUsd: commitment.usd, dueToday: commitment.dueToday },
    agents: {
      roster: AGENT_ROSTER_SIZE,
      visibleOnSurface: 0,
      hidden: true,
      activeLanes: plan ? (plan.agentLanes || []).map((l) => l.lane) : []
    },
    execution: {
      dailyVolumeUsd: Math.round(dailyVolumeUsd * 100) / 100,
      dailyCapUsd: control.maxDailyUsd,
      remainingTodayUsd: Math.max(0, Math.round((control.maxDailyUsd - dailyVolumeUsd) * 100) / 100),
      perTxCapUsd: control.maxPerTxUsd,
      maxRiskScore: control.maxRiskScore,
      mode: control.mode,
      level: control.level,
      emergencyStop: control.stopActive === true
    }
  };
}

/* ============================ orchestration ============================= */

/**
 * One call, start to finish: classify → route to lanes → build the plan → run
 * the firewall → hand back the stage ledger.
 *
 * This is the ONLY entry point the UI needs, and it is the whole reason the
 * five buttons can stay simple: everything below them is data, not screens.
 */
export function orchestrate({ message = '', surface = null, context = {} } = {}) {
  const classification = classifyIntent(message, { surface, locale: context.locale, prior: context.prior });
  const plan = buildPlan({ message, classification, surface, context });
  const aiControl = sanitizeAiControl(context.aiControl);
  const verdict = validateExecution(plan, {
    aiControl,
    automations: context.automations,
    dailyVolumeUsd: context.dailyVolumeUsd,
    wallet: context.wallet,
    sessionLevel: context.sessionLevel,
    now: context.now
  });
  const stages = executionStageLedger(plan, verdict, {
    wallet: context.wallet,
    simulation: context.simulation,
    quote: context.quote
  });
  return {
    ok: true,
    schema: COMMAND_CENTER_SCHEMA,
    classification,
    plan,
    verdict,
    stages,
    thinking: thinkingStages(plan.intent),
    agents: agentsForSurface(plan.surface),
    /* The one line the UI must never be able to derive wrongly. */
    executed: false,
    broadcasts: false,
    requiresUserSignature: true
  };
}

/* ================================ utils ================================= */

function hash32(text) {
  let h = 5381;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export { AI_PLAN_SCHEMA as PLAN_SCHEMA };
export const intentForSurface = (surfaceId) => AI_SURFACES.find((s) => s.id === String(surfaceId || ''))?.intent || 'GENERAL';
export const surfaceForIntent = (intent) => AI_SURFACES.find((s) => s.intent === String(intent || ''))?.id || 'ask';
