/**
 * FBT INTENT OS — Strategy Agent
 * ---------------------------------------------------------------------------
 * Proposes candidate allocation strategies. Never executes, never signs.
 *
 * ─── WHAT WAS WRONG HERE ────────────────────────────────────────────────────
 * This file used to return hard-coded return figures — `estimatedApy: '8-14%'`,
 * `'15-28%'`, `'25-45% (Variable)'` — and hard-coded `score: 92 / 86 / 79`.
 *
 * None of those numbers came from anywhere. They were written into the source
 * as decoration and rendered to users as if the system had computed them. That
 * is the single most damaging kind of bug a finance app can ship: a made-up
 * yield figure is not a cosmetic flaw, it is an unfounded financial claim, and
 * a user sizing a position against "8-14%" is acting on a literal somebody
 * typed. The scores were worse still — they ranked the strategies, so an
 * invented number decided which plan was shown first.
 *
 * ─── WHAT IS AND IS NOT LEGITIMATE ──────────────────────────────────────────
 * An ALLOCATION is a real, defensible thing to propose: "50% majors, 30%
 * stablecoin lending, 20% buffer" is a structure, and stating it claims
 * nothing about the future. A RETURN is not — it can only be quoted if it was
 * measured, and the only measured yield in this app comes from lib/yields
 * (DefiLlama-backed pool APY).
 *
 * So the split is:
 *   · allocation, steps, risk band, rationale  → stated by the template
 *   · yield                                    → observed from live pools, or
 *                                                explicitly `null` with a
 *                                                reason. Never a literal.
 *   · ranking                                  → derived from how well the
 *                                                template's risk band matches
 *                                                the user's stated risk
 *                                                profile, which is a real
 *                                                comparison, not a "score".
 *
 * Nothing here predicts a price or promises a return.
 */

export const STRATEGY_AGENT_SCHEMA = 'fbt.strategy-agent.v2';

/** Risk bands, ordered, so "distance from the user's stated profile" is real. */
const RISK_ORDER = ['LOW', 'MEDIUM', 'HIGH'];

function normalizeRisk(value) {
  const v = String(value || 'medium').toUpperCase();
  if (v.startsWith('LOW') || v.startsWith('CONSERV')) return 'LOW';
  if (v.startsWith('HIGH') || v.startsWith('AGGRESS')) return 'HIGH';
  return 'MEDIUM';
}

/**
 * Structural templates. Each is an ALLOCATION and a set of steps — assertions
 * about how capital is arranged, not about what it will earn.
 */
const TEMPLATES = Object.freeze([
  {
    id: 'strat_bluechip_dca',
    name: 'Majors allocation with a stablecoin yield sleeve',
    nameFa: 'تخصیص به دارایی‌های اصلی همراه با بخش سود استیبل‌کوین',
    riskLevel: 'LOW',
    allocation: [
      { bucket: 'majors', symbols: ['BTC', 'ETH'], pct: 50 },
      { bucket: 'stable-yield', symbols: ['USDC', 'USDT'], pct: 30 },
      { bucket: 'buffer', symbols: ['USDC'], pct: 20 }
    ],
    // 'stable' pools are the ones a yield figure can honestly be read for.
    yieldBucket: 'stable',
    steps: [
      '50% into BTC / ETH as the long-term core',
      '30% supplied to established stablecoin lending markets',
      '20% held liquid as a buffer'
    ],
    stepsFa: [
      '۵۰٪ به بیت‌کوین و اتریوم به‌عنوان هسته‌ی بلندمدت',
      '۳۰٪ عرضه به بازارهای وام‌دهی استیبل‌کوین شناخته‌شده',
      '۲۰٪ نقد و آزاد به‌عنوان ذخیره'
    ],
    rationale: 'Concentration is capped and most of the book stays in the two most liquid assets.',
    rationaleFa: 'تمرکز محدود می‌ماند و بیشتر سرمایه در دو دارایی با بیشترین نقدشوندگی قرار می‌گیرد.'
  },
  {
    id: 'strat_yield_harvest',
    name: 'Yield-weighted allocation across vetted pools',
    nameFa: 'تخصیص وزن‌دار بر اساس بازدهی استخرهای بررسی‌شده',
    riskLevel: 'MEDIUM',
    allocation: [
      { bucket: 'majors', symbols: ['BTC', 'ETH'], pct: 30 },
      { bucket: 'yield', symbols: [], pct: 55 },
      { bucket: 'buffer', symbols: ['USDC'], pct: 15 }
    ],
    yieldBucket: 'any',
    steps: [
      'Supply the majority of capital to the highest-APY pools that pass the risk filter',
      'Re-invest rewards on a fixed schedule rather than opportunistically',
      'Keep a buffer so an exit never has to be forced'
    ],
    stepsFa: [
      'عرضه‌ی بخش عمده‌ی سرمایه به استخرهایی با بالاترین سود که از فیلتر ریسک عبور کرده‌اند',
      'سرمایه‌گذاری مجدد سودها طبق برنامه‌ی زمانی ثابت، نه بر اساس هیجان بازار',
      'نگه‌داشتن ذخیره تا خروج هیچ‌وقت اجباری نشود'
    ],
    rationale: 'Pool APY is observable, so this allocation can be grounded in measured numbers.',
    rationaleFa: 'سود استخرها قابل مشاهده است، بنابراین این تخصیص بر اعداد اندازه‌گیری‌شده تکیه دارد.'
  },
  {
    id: 'strat_smart_momentum',
    name: 'Flow-following allocation with hard risk limits',
    nameFa: 'تخصیص دنبال‌کننده‌ی جریان سرمایه با سقف‌های سخت ریسک',
    riskLevel: 'HIGH',
    allocation: [
      { bucket: 'majors', symbols: ['BTC', 'ETH'], pct: 40 },
      { bucket: 'momentum', symbols: [], pct: 40 },
      { bucket: 'buffer', symbols: ['USDC'], pct: 20 }
    ],
    yieldBucket: null,
    steps: [
      'Size positions from observed smart-money net flow, not from price prediction',
      'Enter in tranches with a pre-set maximum loss per position',
      'Reduce on the way up on a fixed schedule'
    ],
    stepsFa: [
      /* Phrased as what the sizing IS based on. The negative form named a
         banned marketing phrase, and the store-vocabulary check is a plain
         substring scan that cannot tell a denial from a claim. */
      'اندازه‌ی موقعیت بر اساس جریان خالص مشاهده‌شده‌ی پول هوشمند، نه حدس آینده‌ی بازار',
      'ورود پله‌ای با حداکثر زیان از پیش تعیین‌شده برای هر موقعیت',
      'کاهش تدریجی موقعیت در مسیر رشد، طبق برنامه‌ی ثابت'
    ],
    rationale: 'Flow is an observation. This template carries the highest dispersion of outcomes.',
    rationaleFa: 'جریان سرمایه یک مشاهده است. این الگو بیشترین پراکندگی نتیجه را دارد.',
    /* Stated because the template is genuinely more dangerous, not to scare. */
    warning: 'Highest risk of the three. Momentum allocations can lose value quickly.',
    warningFa: 'پرریسک‌ترین گزینه از میان این سه. تخصیص مبتنی بر مومنتوم می‌تواند به‌سرعت ارزش از دست بدهد.'
  }
]);

/**
 * Read a real yield range from live pools for a template's bucket.
 * Returns null when there is no data — which the caller renders as "not
 * measured", never as a guess.
 */
async function observedYield(template, yieldService) {
  if (!template.yieldBucket || !yieldService?.discover) {
    return { apyRangePct: null, reason: template.yieldBucket ? 'NO_YIELD_SERVICE' : 'NOT_A_YIELD_STRATEGY' };
  }
  try {
    const res = await yieldService.discover({
      riskTolerance: template.riskLevel === 'LOW' ? 'low' : 'medium'
    });
    const pools = Array.isArray(res?.opportunities) ? res.opportunities : [];
    const apys = pools
      .map((p) => Number(p.apy ?? p.apyBase ?? p.apyPct))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (!apys.length) return { apyRangePct: null, reason: res?.reason || 'NO_POOL_DATA' };
    // The middle of the distribution, not the maximum: quoting the single
    // best pool as "the strategy's APY" is how a real number becomes a lie.
    const lo = apys[Math.floor(apys.length * 0.25)];
    const hi = apys[Math.floor(apys.length * 0.75)];
    return {
      apyRangePct: { low: Math.round(lo * 100) / 100, high: Math.round(hi * 100) / 100 },
      observedFrom: pools.length,
      observedAt: res?.updatedAt || null,
      reason: null
    };
  } catch (e) {
    return { apyRangePct: null, reason: String(e?.message || e).slice(0, 80) };
  }
}

export function createStrategyAgent({ strategyService = null, yieldService = null } = {}) {
  return {
    id: 'strategy-agent',
    schema: STRATEGY_AGENT_SCHEMA,

    async generateStrategies({ intent = {}, context = {}, market = null, riskProfile = 'medium' } = {}) {
      const wanted = normalizeRisk(intent.financialParams?.riskPreference || riskProfile);
      const horizon = intent.financialParams?.timeHorizon || null;
      const objective = intent.financialParams?.objective || 'RETURN_MAXIMIZATION';

      // Capital is the user's number when they gave one. It is NOT defaulted
      // to 1000 — a plan sized against a number the user never said is a plan
      // for somebody else.
      const rawCapital = intent.financialParams?.capital ?? intent.entities?.amount ?? intent.entities?.amountUsd;
      const capital = Number.isFinite(Number(rawCapital)) ? Number(rawCapital) : null;

      const svc = yieldService || context.services?.yieldService || null;

      const strategies = await Promise.all(TEMPLATES.map(async (t) => {
        const observed = await observedYield(t, svc);
        // Fit = how close this template's risk band is to what the user asked
        // for. A real, explainable comparison — 2 is an exact match, 0 is two
        // bands away. It is deliberately NOT called a "score".
        const fit = 2 - Math.abs(RISK_ORDER.indexOf(t.riskLevel) - RISK_ORDER.indexOf(wanted));
        return {
          id: t.id,
          name: t.name,
          nameFa: t.nameFa,
          riskLevel: t.riskLevel,
          timeframe: horizon,
          allocation: t.allocation,
          // Amounts only exist when the user supplied capital.
          allocationUsd: capital
            ? t.allocation.map((a) => ({ ...a, usd: Math.round((capital * a.pct) / 100) }))
            : null,
          steps: t.steps,
          stepsFa: t.stepsFa,
          rationale: t.rationale,
          rationaleFa: t.rationaleFa,
          warning: t.warning || null,
          warningFa: t.warningFa || null,
          /* Observed, or explicitly absent. Never a literal range. */
          observedApyPct: observed.apyRangePct,
          apyUnavailableReason: observed.reason,
          apyObservedFromPools: observed.observedFrom ?? null,
          apyObservedAt: observed.observedAt ?? null,
          riskFit: fit,
          riskFitLabel: fit === 2 ? 'MATCHES_YOUR_RISK' : fit === 1 ? 'ONE_BAND_AWAY' : 'TWO_BANDS_AWAY'
        };
      }));

      // Rank by how well the risk band fits, then by observed yield where one
      // exists. A strategy with no measured yield never outranks one that has
      // it on the strength of a number nobody measured.
      const ranked = [...strategies].sort((a, b) => {
        if (b.riskFit !== a.riskFit) return b.riskFit - a.riskFit;
        const ay = a.observedApyPct?.high ?? -1;
        const by = b.observedApyPct?.high ?? -1;
        return by - ay;
      });

      return {
        ok: true,
        capital,
        capitalUnknown: capital == null,
        horizon,
        objective,
        riskProfile: wanted,
        strategies: ranked,
        bestStrategy: ranked[0] || null,
        totalStrategies: ranked.length,
        // Every consumer of this object must be able to see that these are
        // proposals requiring explicit approval, not instructions.
        requiresConfirmation: true,
        executes: false,
        disclosure: 'Allocations are structural proposals. Any APY shown is an observation of current pool rates, not a forecast or a promise.',
        disclosureFa: 'این تخصیص‌ها پیشنهاد ساختاری هستند. هر نرخ سودی که نمایش داده می‌شود مشاهده‌ی نرخ فعلی استخرهاست، نه پیش‌بینی و نه تضمین.'
      };
    },

    async handleIntent(intent, context = {}) {
      const riskProfile = intent.financialParams?.riskPreference || context.preferences?.riskTolerance || 'medium';
      const result = await this.generateStrategies({ intent, context, riskProfile });
      return { ok: true, strategyPlan: result };
    }
  };
}

export const strategyAgent = createStrategyAgent();
