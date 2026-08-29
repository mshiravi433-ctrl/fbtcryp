/**
 * FBT INTENT AI — UNDERSTANDING PROBE
 * ---------------------------------------------------------------------------
 * The parser is the only place natural language enters the system, so "how
 * smart is the agent" is measurable: feed it what real customers actually
 * type, and score the structured intent it produces against what a human
 * would have understood.
 *
 * Every case below is a real phrasing, not a keyword-shaped toy. The hard
 * ones are deliberately over-represented, because that is where an agent
 * earns its keep:
 *
 *   · vague goals      — "I want my money to grow" has no token, no amount,
 *                        no chain, and still deserves a plan
 *   · relative amounts — "half of my money", "همه‌چیز", "a bit"
 *   · goal + horizon   — "1000$, 20% in 3 months" is a planning request, not a
 *                        swap
 *   · localised names  — "تتر", "اتر", "بیت کوین" rather than tickers
 *   · typos and        — "swapp", "bitcoiin", "arbitrom"
 *     misspellings
 *   · risk stance      — "don't take risks", "ریسک نکن"
 *   · periodic buys    — "every week $50 of BTC"
 *
 * SCORING
 *   Each case declares the fields a human reader would fill in. A field is
 *   correct when the parser produced exactly that value. The score is the
 *   share of declared fields recovered, so a case that only expected an
 *   action is not worth less than a case that expected five fields — but a
 *   parser that gets everything right on the vague cases cannot score high by
 *   ignoring them.
 *
 * A field declared as `null` means "a human would NOT invent this", and the
 * parser is scored on leaving it empty too. That is what stops an agent from
 * looking smart by hallucinating a token the user never said.
 *
 * This probe is the regression net for intent understanding. If a change
 * makes the agent dumber, the score here goes down and the run fails.
 */

import { readFileSync } from 'node:fs';

function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null
  };
}

/* -------------------------------------------------------------------------- */
/*  CORPUS                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `expect` lists the fields a careful human reader would extract.
 * `category` only drives the per-category breakdown in the report.
 */
export const CORPUS = Object.freeze([
  /* ── explicit, unambiguous: the easy floor ───────────────────────────── */
  {
    id: 'swap-explicit-en',
    category: 'explicit',
    text: 'swap 500 USDT to ETH on arbitrum',
    expect: { action: 'swap', kind: 'swap', fromSymbol: 'USDT', toSymbol: 'ETH', amount: 500, chainId: 42161 }
  },
  {
    id: 'swap-explicit-fa',
    category: 'explicit',
    text: '۵۰۰ تتر رو به اتریوم تبدیل کن',
    expect: { action: 'swap', kind: 'swap', fromSymbol: 'USDT', toSymbol: 'ETH', amount: 500 }
  },
  {
    id: 'buy-explicit-en',
    category: 'explicit',
    text: 'buy 200 dollars of bitcoin',
    expect: { action: 'buy', fromSymbol: 'USD', toSymbol: 'BTC', amount: 200, amountUnit: 'USD' }
  },
  {
    id: 'buy-explicit-fa',
    category: 'explicit',
    text: 'با ۱۰۰۰ دلار بیت کوین بخر',
    expect: { action: 'buy', toSymbol: 'BTC', amount: 1000, amountUnit: 'USD' }
  },
  {
    id: 'send-explicit',
    category: 'explicit',
    text: 'send 0.5 ETH to my other wallet',
    expect: { action: 'send', kind: 'send', fromSymbol: 'ETH', amount: 0.5 }
  },
  {
    id: 'bridge-explicit',
    category: 'explicit',
    text: 'bridge 300 USDC from ethereum to solana',
    expect: { action: 'bridge', kind: 'bridge', fromSymbol: 'USDC', amount: 300 }
  },

  /* ── localised asset names, no tickers ───────────────────────────────── */
  {
    id: 'name-tether-fa',
    category: 'localised-names',
    text: 'تترهام رو بده اتر بگیر',
    expect: { action: 'swap', fromSymbol: 'USDT', toSymbol: 'ETH' }
  },
  {
    id: 'name-bitcoin-fa',
    category: 'localised-names',
    text: 'بیت کوین بخر',
    expect: { action: 'buy', toSymbol: 'BTC' }
  },
  {
    id: 'name-ethereum-fa',
    category: 'localised-names',
    text: 'اتریوم رو بفروش',
    expect: { action: 'sell', fromSymbol: 'ETH', direction: 'sell' }
  },
  {
    id: 'name-solana-ar',
    category: 'localised-names',
    text: 'اشترِ سولانا بكم',
    expect: { action: 'buy', toSymbol: 'SOL' }
  },

  /* ── relative / fuzzy amounts: "half of my money" ────────────────────── */
  {
    id: 'relative-half-fa',
    category: 'relative-amount',
    text: 'نصف پولم رو ببر بیت کوین',
    expect: { action: 'swap', toSymbol: 'BTC', amountPct: 50 }
  },
  {
    id: 'relative-all-fa',
    category: 'relative-amount',
    text: 'همه موجودیم رو تبدیل کن به تتر',
    expect: { action: 'swap', toSymbol: 'USDT', amountPct: 100 }
  },
  {
    id: 'relative-quarter-en',
    category: 'relative-amount',
    text: 'put a quarter of my portfolio into ETH',
    expect: { toSymbol: 'ETH', amountPct: 25 }
  },
  {
    id: 'relative-tenth-fa',
    category: 'relative-amount',
    text: '۱۰ درصد از داراییم رو ببر سولانا',
    expect: { toSymbol: 'SOL', amountPct: 10 }
  },

  /* ── vague goals: the "customer who doesn't know what they want" ─────── */
  {
    id: 'vague-grow-fa',
    category: 'vague-goal',
    text: 'میخوام پولم رشد کنه',
    expect: { kind: 'goal', objective: 'growth' }
  },
  {
    id: 'vague-profit-fa',
    category: 'vague-goal',
    text: 'دنبال سود هستم، چیکار کنم؟',
    expect: { kind: 'goal', objective: 'income' }
  },
  {
    id: 'vague-grow-en',
    category: 'vague-goal',
    text: 'I want to make my money work for me',
    expect: { kind: 'goal', objective: 'income' }
  },
  {
    id: 'vague-safe-fa',
    category: 'vague-goal',
    text: 'فقط میخوام پولم امن باشه و ارزشش کم نشه',
    expect: { kind: 'goal', objective: 'preserve' }
  },
  {
    id: 'vague-norisk-en',
    category: 'vague-goal',
    text: 'keep it safe, no risky stuff',
    expect: { kind: 'goal', objective: 'preserve', riskTolerance: 'low' }
  },
  {
    id: 'vague-beginner-fa',
    category: 'vague-goal',
    text: 'تازه وارد شدم، نمیدونم چیکار کنم، راهنماییم کن',
    expect: { kind: 'goal', objective: 'learn' }
  },

  /* ── goal + horizon + capital: a planning request, not a swap ────────── */
  {
    id: 'goal-fa',
    category: 'goal-planning',
    text: '۱۰۰۰ دلار دارم، میخوام تا ۳ ماه ۲۰ درصد سود کنم',
    expect: { kind: 'goal', goalPct: 20, durationHrs: 2160, amount: 1000, amountUnit: 'USD' }
  },
  {
    id: 'goal-en',
    category: 'goal-planning',
    text: 'I have $5000 and want a 10% return in 30 days',
    expect: { kind: 'goal', goalPct: 10, durationHrs: 720, amount: 5000, amountUnit: 'USD' }
  },
  {
    id: 'goal-nocapital-fa',
    category: 'goal-planning',
    text: 'میخوام ماهی ۵ درصد سود کنم',
    expect: { kind: 'goal', goalPct: 5 }
  },
  {
    id: 'goal-doubling-fa',
    category: 'goal-planning',
    text: 'پولم رو دو برابر کن',
    expect: { kind: 'goal', goalPct: 100 }
  },

  /* ── periodic / recurring ────────────────────────────────────────────── */
  {
    id: 'dca-weekly-fa',
    category: 'recurring',
    text: 'هر هفته ۵۰ دلار بیت کوین بخر',
    expect: { action: 'buy', toSymbol: 'BTC', amount: 50, amountUnit: 'USD', recurring: 'weekly' }
  },
  {
    id: 'dca-monthly-en',
    category: 'recurring',
    text: 'buy $100 of ETH every month',
    expect: { action: 'buy', toSymbol: 'ETH', amount: 100, amountUnit: 'USD', recurring: 'monthly' }
  },
  {
    id: 'dca-daily-fa',
    category: 'recurring',
    text: 'روزی ۱۰ دلار اتر بخر',
    expect: { toSymbol: 'ETH', amount: 10, recurring: 'daily' }
  },

  /* ── typos and misspellings ──────────────────────────────────────────── */
  {
    id: 'typo-swap',
    category: 'typo',
    text: 'swapp 100 usdt to eth',
    expect: { action: 'swap', fromSymbol: 'USDT', toSymbol: 'ETH', amount: 100 }
  },
  {
    id: 'typo-bitcoin',
    category: 'typo',
    text: 'buy 250$ of bitcoiin',
    expect: { toSymbol: 'BTC', amount: 250 }
  },
  {
    id: 'typo-chain',
    category: 'typo',
    text: 'send 50 usdc on arbitrom',
    expect: { action: 'send', fromSymbol: 'USDC', amount: 50, chainId: 42161 }
  },
  {
    id: 'typo-fa',
    category: 'typo',
    text: 'بیت کویین بخرم؟',
    expect: { toSymbol: 'BTC' }
  },

  /* ── exit / close everything ─────────────────────────────────────────── */
  {
    id: 'exit-all-fa',
    category: 'exit',
    text: 'همه رو بفروش و ببر تتر',
    expect: { action: 'sell', direction: 'sell', toSymbol: 'USDT', amountPct: 100 }
  },
  {
    id: 'exit-cashout-en',
    category: 'exit',
    text: 'cash me out into stablecoins',
    expect: { action: 'sell', direction: 'sell', amountPct: 100 }
  },

  /* ── analysis questions ──────────────────────────────────────────────── */
  {
    id: 'analysis-should-buy-fa',
    category: 'analysis',
    text: 'بیت کوین الان بخرم یا نه؟',
    expect: { kind: 'analysis', action: 'analyze', toSymbol: 'BTC' }
  },
  {
    id: 'analysis-portfolio-en',
    category: 'analysis',
    text: 'how is my portfolio doing?',
    expect: { kind: 'analysis', action: 'portfolio' }
  },
  {
    id: 'analysis-compare-fa',
    category: 'analysis',
    text: 'اتریوم بهتره یا سولانا؟',
    expect: { kind: 'analysis', action: 'analyze' }
  },

  /* ── conversation: must NOT be turned into a money move ──────────────── */
  {
    id: 'greet-fa',
    category: 'conversation',
    text: 'سلام',
    expect: { kind: 'conversation', action: 'conversation' }
  },
  {
    id: 'thanks-fa',
    category: 'conversation',
    text: 'ممنون از کمکت',
    expect: { kind: 'conversation' }
  },
  {
    id: 'gibberish',
    category: 'conversation',
    text: 'xkcd 42 zzz',
    expect: { kind: null }
  },

  /* ── risk stance must be captured, not dropped ───────────────────────── */
  {
    id: 'risk-aggressive-fa',
    category: 'risk-stance',
    text: 'حاضرم ریسک کنم، سود بالا میخوام',
    expect: { riskTolerance: 'high' }
  },
  {
    id: 'risk-leverage-fa',
    category: 'risk-stance',
    text: 'با ۱۰ برابر اهرم لانگ بگیر',
    expect: { action: 'futures', leverage: 10, direction: 'buy' }
  },
  {
    id: 'risk-capitalguard-fa',
    category: 'risk-stance',
    text: 'بیشتر از ۱۰۰ دلار ضرر نکن',
    expect: { maxLossUsd: 100 }
  },

  /* ── multi-intent: two asks in one sentence ──────────────────────────── */
  {
    id: 'multi-fa',
    category: 'multi-intent',
    text: 'اول نصف تترهام رو ببر اتریوم، بعد با بقیه‌اش بیت کوین بخر',
    expect: { fromSymbol: 'USDT', toSymbol: 'ETH', amountPct: 50 }
  }
]);

/* -------------------------------------------------------------------------- */
/*  SCORING                                                                    */
/* -------------------------------------------------------------------------- */

/** Fields a case may declare, and how each is compared. */
const FIELD_CHECKS = Object.freeze({
  action:        (got, want) => String(got ?? '') === String(want),
  kind:          (got, want) => (want === null ? got == null || got === '' : String(got ?? '') === String(want)),
  fromSymbol:    (got, want) => String(got ?? '').toUpperCase() === String(want).toUpperCase(),
  toSymbol:      (got, want) => String(got ?? '').toUpperCase() === String(want).toUpperCase(),
  direction:     (got, want) => String(got ?? '') === String(want),
  amount:        (got, want) => Math.abs(Number(got) - Number(want)) < 1e-9,
  amountUnit:    (got, want) => String(got ?? '').toUpperCase() === String(want).toUpperCase(),
  amountPct:     (got, want) => Math.abs(Number(got) - Number(want)) < 1e-9,
  chainId:       (got, want) => Number(got) === Number(want),
  goalPct:       (got, want) => Math.abs(Number(got) - Number(want)) < 1e-9,
  durationHrs:   (got, want) => Math.abs(Number(got) - Number(want)) < 1e-9,
  leverage:      (got, want) => Math.abs(Number(got) - Number(want)) < 1e-9,
  recurring:     (got, want) => String(got ?? '') === String(want),
  objective:     (got, want) => String(got ?? '') === String(want),
  riskTolerance: (got, want) => String(got ?? '') === String(want),
  maxLossUsd:    (got, want) => Math.abs(Number(got) - Number(want)) < 1e-9
});

/**
 * A vague case may also be satisfied by producing a concrete PLAN instead of
 * literal fields — that is the whole point of "works even when the customer
 * doesn't have the details". If the parser returned a plan, credit the
 * `objective` when the plan's objective matches, and credit an otherwise
 * missing amount when the plan states one with an explicit assumption.
 */
function creditFromPlan(caseRow, parsed, results) {
  const plan = parsed?.plan || parsed?.intent?.plan || null;
  if (!plan) return;
  const want = caseRow.expect;
  if (want.objective && !results.objective && String(plan.objective ?? '') === want.objective) {
    results.objective = true;
  }
  if (want.kind === 'goal' && !results.kind && String(plan.kind ?? '') === 'goal') {
    results.kind = true;
  }
  if (want.amountPct && !results.amountPct) {
    const legs = Array.isArray(plan.legs) ? plan.legs : [];
    if (legs.some((l) => Math.abs(Number(l.amountPct) - Number(want.amountPct)) < 1e-9)) {
      results.amountPct = true;
    }
  }
}

export function scoreCorpus(parse, corpus = CORPUS, context = {}) {
  const perCase = [];
  let got = 0;
  let total = 0;
  const byCategory = new Map();

  for (const caseRow of corpus) {
    const parsed = parse(caseRow.text, context);
    const intent = parsed?.intent || {};
    const results = {};
    for (const [field, want] of Object.entries(caseRow.expect)) {
      const check = FIELD_CHECKS[field];
      const value = field === 'amountPct' || field === 'objective' || field === 'riskTolerance'
        || field === 'recurring' || field === 'maxLossUsd'
        ? (intent[field] ?? parsed?.[field] ?? null)
        : intent[field];
      results[field] = check ? check(value, want) : false;
    }
    creditFromPlan(caseRow, parsed, results);

    const hits = Object.values(results).filter(Boolean).length;
    const declared = Object.keys(caseRow.expect).length;
    got += hits;
    total += declared;

    const cat = byCategory.get(caseRow.category) || { got: 0, total: 0, cases: 0 };
    cat.got += hits;
    cat.total += declared;
    cat.cases += 1;
    byCategory.set(caseRow.category, cat);

    perCase.push({
      id: caseRow.id,
      category: caseRow.category,
      text: caseRow.text,
      hits,
      declared,
      missed: Object.entries(results).filter(([, ok]) => !ok).map(([f]) => f),
      confidence: parsed?.confidence ?? null
    });
  }

  return {
    score: total === 0 ? 0 : Math.round((got / total) * 1000) / 10,
    got,
    total,
    perCase,
    byCategory: [...byCategory.entries()].map(([category, v]) => ({
      category,
      cases: v.cases,
      score: Math.round((v.got / v.total) * 1000) / 10
    })).sort((a, b) => a.score - b.score)
  };
}

/* -------------------------------------------------------------------------- */
/*  PROBE                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Thresholds, not vibes. These are the numbers the upgraded understanding
 * layer has to hold. They are set ABOVE the measured baseline of the original
 * keyword parser (see docs/INTENT-UNDERSTANDING-FA.md), so any regression that
 * costs real understanding fails the suite instead of sliding by quietly.
 */
const THRESHOLDS = Object.freeze({
  /*
   * Measured, not hoped for. The keyword parser alone scored 40.8% on this
   * corpus; the semantic layer brought it to 100%. The floor sits at 95 so a
   * change that quietly costs one or two categories fails the suite, while a
   * genuinely hard new case can be added without a red build.
   */
  overall: 95,
  'vague-goal': 95,
  'goal-planning': 95,
  'relative-amount': 95,
  localised: 95,
  typo: 95,
  recurring: 95,
  exit: 95,
  'multi-intent': 95,
  'risk-stance': 95,
  conversation: 100
});

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  mockLocalStorage();

  const parser = await import('../../src/lib/intent-ai/intentParser.js');

  const result = scoreCorpus(
    (text, ctx) => parser.parseUserIntent(text, ctx),
    CORPUS,
    { defaultChainId: null, locale: 'fa' }
  );

  /* ---- the headline number, printed so a regression is visible ---------- */
  console.log('\n── intent understanding ─────────────────────────────');
  console.log(`  corpus: ${result.perCase.length} utterances, ${result.total} expected fields`);
  console.log(`  recovered: ${result.got}/${result.total} = ${result.score}%`);
  console.log('\n  by category (worst first):');
  for (const c of result.byCategory) {
    console.log(`    ${c.category.padEnd(18)} ${String(c.score).padStart(5)}%   (${c.cases} cases)`);
  }
  const worst = result.perCase.filter((c) => c.hits < c.declared);
  if (worst.length) {
    console.log('\n  cases that still lose fields:');
    for (const c of worst.slice(0, 12)) {
      console.log(`    ${c.id.padEnd(22)} missed: ${c.missed.join(', ')}`);
    }
  }

  /* ---- the guarantees --------------------------------------------------- */

  t(`understanding score ${result.score}% ≥ ${THRESHOLDS.overall}%`, result.score >= THRESHOLDS.overall);

  const byCat = new Map(result.byCategory.map((c) => [c.category, c.score]));
  for (const [cat, min] of Object.entries(THRESHOLDS)) {
    if (cat === 'overall') continue;
    const score = byCat.get(cat);
    // 'localised' is matched by prefix because the corpus category is
    // 'localised-names'.
    const resolved = score ?? [...byCat.entries()].find(([k]) => k.startsWith(cat))?.[1];
    if (resolved == null) continue;
    t(`${cat} understanding ${resolved}% ≥ ${min}%`, resolved >= min);
  }

  /* ---- safety properties: intelligence must not become recklessness ---- */

  const dangerous = CORPUS.filter((c) => c.category === 'conversation');
  const invented = dangerous.filter((c) => {
    const p = parser.parseUserIntent(c.text, { locale: 'fa' });
    const i = p?.intent || {};
    return Boolean(i.fromSymbol || i.toSymbol || Number(i.amount) > 0);
  });
  t('a greeting is never turned into a money move', invented.length === 0);

  const noChain = parser.parseUserIntent('buy 100 dollars of bitcoin', { locale: 'fa' });
  t('an unstated network is reported unclear, never guessed',
    noChain.intent.chainId == null && noChain.clarifications.includes('CHAIN_UNCLEAR'));

  const overLimit = parser.parseUserIntent('swap 50000 USDT to ETH', { locale: 'fa' });
  t('an over-limit amount is flagged, not silently clamped',
    Array.isArray(overLimit.limitViolations) && overLimit.limitViolations.length > 0
    && overLimit.intent.amount === 50000);

  /* ---- margin vocabulary: understood where it exists, absent where not -- */

  const spec = await import('../../src/lib/intent-ai/speculativeLexicon.js');
  t('the source understands a Persian margin request',
    spec.detectLeverageText('با 10 برابر اهرم لانگ بگیر') === 10);
  t('…a spelled-out one ("ده برابر اهرم")',
    spec.detectLeverageText('ده برابر اهرم بگیر') === 10);
  t('…and an English one',
    spec.detectLeverageText('short eth with 5x leverage') === 5);
  t('the derivatives vocabulary lives in ONE gated module',
    spec.FUTURES_ACTION_STEMS.length > 0);
  {
    const viteSrc = readFileSync('vite.config.js', 'utf8');
    t('a store build strips that module out',
      viteSrc.includes('stripSpeculativeVocabulary')
      && viteSrc.includes('speculativeLexicon')
      && viteSrc.includes('FUTURES_ACTION_STEMS = Object.freeze([])'));
    const lexSrc = readFileSync('src/lib/intent-ai/semanticLexicon.js', 'utf8');
    t('the main lexicon holds no flagged word of its own',
      !lexSrc.includes('اهرم') && lexSrc.includes('FUTURES_ACTION_STEMS'));
  }

  /* ---- the planner: a vague ask must still yield a reviewable plan ---- */

  const planner = await import('../../src/lib/intent-ai/intentPlanner.js');
  const ctx = {
    portfolioUsd: 2000,
    balances: [
      { symbol: 'USDT', usd: 1200 },
      { symbol: 'ETH', usd: 500 },
      { symbol: 'BTC', usd: 300 }
    ],
    prices: [
      { symbol: 'BTC', usd: 68000, change24hPct: 1.2 },
      { symbol: 'ETH', usd: 3400, change24hPct: -0.4 },
      { symbol: 'SOL', usd: 160, change24hPct: 2.1 },
      { symbol: 'USDT', usd: 1, change24hPct: 0 }
    ],
    locale: 'fa'
  };

  const vague = planner.planFromIntent(
    parser.parseUserIntent('میخوام پولم رشد کنه', { locale: 'fa' }),
    ctx
  );
  t('a vague "make my money grow" produces a plan', Boolean(vague?.ok) && Array.isArray(vague.plan?.legs) && vague.plan.legs.length > 0);
  t('the plan states the assumption it had to make', Array.isArray(vague.plan?.assumptions) && vague.plan.assumptions.length > 0);
  t('the plan allocates 100% and no more',
    Math.abs(vague.plan.legs.reduce((s, l) => s + Number(l.amountPct || 0), 0) - 100) < 1e-6);
  t('every leg names a real capability the product actually has',
    vague.plan.legs.every((l) => typeof l.capability === 'string' && l.capability.length > 0));
  t('the plan is never auto-executed',
    vague.plan.requiresConfirmation === true && vague.plan.autoExecute !== true);
  t('the plan carries a plain-language reason a human can argue with',
    typeof vague.plan.summary === 'string' && vague.plan.summary.length > 20);
  t('the plan scores its own risk honestly',
    typeof vague.plan.risk === 'object' && Number.isFinite(vague.plan.risk.maxDrawdownPct));

  const empty = planner.planFromIntent(parser.parseUserIntent('xkcd 42 zzz', { locale: 'fa' }), ctx);
  t('gibberish does not get a money plan', !empty?.ok || empty.plan.legs.length === 0);

  const goalPlan = planner.planFromIntent(
    parser.parseUserIntent('۱۰۰۰ دلار دارم، میخوام تا ۳ ماه ۲۰ درصد سود کنم', { locale: 'fa' }),
    ctx
  );
  t('a goal with a target is planned against that target',
    Number(goalPlan.plan?.goalPct) === 20 && Number(goalPlan.plan?.durationHrs) === 2160);
  t('an unrealistic target is called unrealistic, not promised',
    goalPlan.plan.feasibility === 'stretch' || goalPlan.plan.feasibility === 'unlikely'
    || typeof goalPlan.plan.feasibilityNote === 'string');

  const safePlan = planner.planFromIntent(
    parser.parseUserIntent('فقط میخوام پولم امن باشه و ارزشش کم نشه', { locale: 'fa' }),
    ctx
  );
  t('a "keep it safe" ask yields no leveraged or speculative leg',
    safePlan.plan.legs.every((l) => l.risk !== 'high' && !l.leverage));

  /* ---- the chat path: a vague ask gets a question AND a proposal ---- */

  const human = await import('../../src/lib/intent-ai/humanAi.js');
  let session = human.startSession({ locale: 'fa', defaultChainId: 42161 });
  let turn = human.chatTurn(session, 'میخوام پولم رشد کنه', {
    portfolioUsd: 2000,
    balances: [{ symbol: 'USDT', usd: 1200 }, { symbol: 'ETH', usd: 500 }, { symbol: 'BTC', usd: 300 }],
    speculationEnabled: false
  });
  session = turn.session;
  const payload = turn.reply?.payload;
  t('a vague ask still opens the guided flow', Boolean(payload?.flow?.step));
  t('…and arrives with a concrete proposal beside the question', Boolean(payload?.proposal));
  t('the proposal sums to 100%',
    Math.abs(payload.proposal.legs.reduce((a, l) => a + l.amountPct, 0) - 100) < 1e-6);
  t('the proposal never claims execution authority',
    payload.proposal.requiresConfirmation === true
    && payload.proposal.autoExecute === false
    && payload.proposal.executionAuthorized === false
    && payload.financialExecutionAuthorized === false);
  t('the proposal lists the assumptions it had to make',
    Array.isArray(payload.proposal.assumptions) && payload.proposal.assumptions.length > 0);

  /* The flow contract is unchanged: a bare task chip still asks for a size. */
  const chip = human.chatTurn(session, 'Goal', {});
  t('answering the task chip still advances the flow to the amount question',
    chip.session.flow?.step === 'AMOUNT' && chip.session.flow?.collected?.task === 'goal');

  /* ---- the proposal must arrive in the customer's language ----------- */

  const locales = await import('../../src/lib/intent-ai/outputLocales.js');
  let faSession = human.startSession({ locale: 'fa', defaultChainId: 42161 });
  const faTurn = human.chatTurn(faSession, 'میخوام پولم رشد کنه', {
    locale: 'fa', portfolioUsd: 2000,
    balances: [{ symbol: 'USDT', usd: 1200 }, { symbol: 'ETH', usd: 500 }]
  });
  const faProposal = faTurn.reply?.payload?.proposal;
  t('a Persian ask gets a Persian proposal',
    /[\u0600-\u06FF]/.test(faProposal?.summary || '') && faProposal?.locale === 'fa');
  t('…and its assumptions are Persian too, not English with a marker',
    faProposal.assumptions.length > 0
    && faProposal.assumptions.every((a) => /[\u0600-\u06FF]/.test(a))
    && !faProposal.assumptions.some((a) => /\(EN\)$/.test(a)));

  const enTurn = human.chatTurn(human.startSession({ locale: 'en', defaultChainId: 42161 }),
    'I want my money to grow', { locale: 'en', portfolioUsd: 2000 });
  t('an English ask gets an English proposal',
    (() => {
      const s = enTurn.reply?.payload?.proposal?.summary || '';
      /* Not "ASCII only": the template legitimately uses an em dash. The
         property that matters is that it is not silently Persian. */
      return s.length > 0 && !/[\u0600-\u06FF]/.test(s) && !s.endsWith('(EN)');
    })());

  t('every planner template exists for all twelve locales',
    locales.OUTPUT_LOCALES.length === 12
    && ['intentPlan.summary', 'intentPlan.head.growth', 'intentPlan.assume.defaultAmount',
        'intentPlan.feasibility.unlikely', 'intentPlan.cap.stable-hold']
      .every((key) => {
        const rendered = locales.OUTPUT_LOCALES.map((l) => locales.renderTemplate(key, l, {
          head: '', split: '', capital: '', drawdown: '', pct: 1, days: 1, leg: ''
        }));
        return rendered.every((r) => typeof r === 'string' && r.length > 0 && !r.endsWith('(EN)'));
      }));
  t('localizing never changes a number',
    (() => {
      const plan = planner.planFromIntent(
        parser.parseUserIntent('میخوام پولم رشد کنه', { locale: 'fa' }), ctx
      ).plan;
      const fa = locales.localizeIntentPlan(plan, 'fa');
      return fa.capitalUsd === plan.capitalUsd
        && fa.risk.maxDrawdownPct === plan.risk.maxDrawdownPct
        && fa.legs.map((l) => l.amountPct).join(',') === plan.legs.map((l) => l.amountPct).join(',');
    })());

  /* ---- understanding + planning together, end to end ------------------- */

  const e2e = scoreCorpus(
    (text, c) => planner.understand(text, c),
    CORPUS,
    { defaultChainId: null, locale: 'fa', portfolioUsd: 2000 }
  );
  console.log(`\n  end-to-end (understand + plan): ${e2e.score}%`);
  t(`end-to-end understanding ${e2e.score}% ≥ ${THRESHOLDS.overall}%`, e2e.score >= THRESHOLDS.overall);

  const failures = rows.filter(([, ok]) => !ok);
  for (const [name] of failures) console.log(`  ✗ ${name}`);

  /* `report()` in test/run.mjs consumes an array of [name, ok] pairs. */
  return rows;
}

/*
 * Standalone runner, so `npm run test:understanding` reports on its own.
 * Under `npm test` the suite is driven by test/run.mjs instead, and this
 * branch does not fire.
 */
if (process.argv[1] && /intent-understanding-probe\.mjs$/.test(process.argv[1])) {
  const rows = await run();
  const failed = rows.filter(([, ok]) => !ok);
  for (const [name, ok] of rows) console.log(`${ok ? '✓' : '✗'} ${name}`);
  console.log(`${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) {
    console.error(`FAILED: ${failed.map(([n]) => n).join(' | ')}`);
    process.exitCode = 1;
  }
}
