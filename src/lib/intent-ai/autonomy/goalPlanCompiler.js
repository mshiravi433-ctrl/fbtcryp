/**
 * FBT INTENT AI — GOAL → PLAN COMPILER (autonomy core, layer 2 of 4)
 * ---------------------------------------------------------------------------
 * The user report that produced this file:
 *   «هدف درست کردن ایجاد اتوماسیون بود که مثلا اگر کاربر گفت سودم ۲ برابر شود
 *    بتونه سواپ کنه، سهام بخره و هر کاری در همان صفحه چت.»
 *
 * "Double my profit" is not a swap. It is a goal with a target, a horizon and
 * a risk appetite, and the only honest answer to it is arithmetic against the
 * rates that exist right now — not a motivational sentence and not a link to a
 * page. This compiler turns a goal into:
 *
 *   1. the APY the goal MATHEMATICALLY requires for the horizon given,
 *   2. the best APY actually available at this moment, read from live sources,
 *   3. a verdict: reachable / not reachable, with the real number of days,
 *   4. a ranked list of executable options, each one a list of VENUE ACTIONS
 *      the venue executors can actually sign (see ./venueExecutors.js).
 *
 * The law this file refuses to break: it never proposes a plan whose expected
 * return it cannot source, and it never turns "not reachable" into a softer
 * plan without saying so in the same breath. A 2× in 30 days needs 3 226 %
 * APY; when the best real lending rate is 4.6 %, the answer is that sentence,
 * with both numbers, and then the closest honest alternative.
 */

export const GOAL_PLAN_SCHEMA = 'fbt.ai-goal-plan.v1';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;

/* ── the arithmetic, exported so a probe can pin it ─────────────────────── */

/** APY (%) needed to turn 1 into `multiple` over `days`. */
export function requiredApyPctFor(multiple, days) {
  const m = Number(multiple);
  const d = Number(days);
  if (!(m > 1) || !(d > 0)) return null;
  return (m ** (DAYS_PER_YEAR / d) - 1) * 100;
}

/** Days needed to reach `multiple` at a fixed `apyPct`, compounded yearly. */
export function daysToMultipleAt(multiple, apyPct) {
  const m = Number(multiple);
  const r = Number(apyPct) / 100;
  if (!(m > 1) || !(r > 0)) return null;
  return (Math.log(m) / Math.log(1 + r)) * DAYS_PER_YEAR;
}

/** Multiple reached after `days` at a fixed `apyPct`. */
export function multipleAfterDays(apyPct, days) {
  const r = Number(apyPct) / 100;
  const d = Number(days);
  if (!Number.isFinite(r) || r <= -1 || !(d > 0)) return null;
  return (1 + r) ** (d / DAYS_PER_YEAR);
}

/** USD target value for a capital base. */
export function targetValueUsd({ capitalUsd, target }) {
  const base = Number(capitalUsd) || 0;
  const mode = target?.mode || 'multiple';
  const value = Number(target?.value);
  if (!Number.isFinite(value)) return null;
  if (mode === 'usd') return value;
  if (mode === 'pct') return base * (1 + value / 100);
  return base * value; // multiple
}

/** Normalise whatever the parser extracted into one target shape. */
export function normalizeGoalTarget(raw = {}) {
  const multiple = Number(raw.multiple ?? raw.multiplier ?? raw.factor);
  const pct = Number(raw.targetPct ?? raw.pct);
  const usd = Number(raw.targetUsd ?? raw.usd);
  /* `multiple` is ALWAYS set, whatever the input mode was: every consumer of a
     target needs it, and deriving it later from `value` is how a 2× target
     quietly became 1.02× (value/100+1) and the compiler declared a fantasy
     "reachable". One normalisation, one meaning. */
  if (Number.isFinite(multiple) && multiple > 1) return { mode: 'multiple', value: multiple, multiple };
  if (Number.isFinite(pct) && pct > 0) return { mode: 'pct', value: pct, multiple: 1 + pct / 100 };
  if (Number.isFinite(usd) && usd > 0) return { mode: 'usd', value: usd };
  if (raw.target && typeof raw.target === 'object') {
    const inner = normalizeGoalTarget(raw.target);
    if (inner) return inner;
  }
  return null;
}

/* ── risk banding ──────────────────────────────────────────────────────────
   A plan is only allowed to use venues inside the user's own risk band. The
   band is a ceiling, not a suggestion: an aggressive profile may use the
   conservative venues, never the reverse.
   ──────────────────────────────────────────────────────────────────────── */

export const RISK_BANDS = Object.freeze({
  conservative: { maxRiskRank: 1, label: 'conservative', allowsLeverage: false },
  balanced: { maxRiskRank: 2, label: 'balanced', allowsLeverage: false },
  aggressive: { maxRiskRank: 3, label: 'aggressive', allowsLeverage: true }
});

const RISK_RANK = Object.freeze({ low: 1, medium: 2, high: 3, extreme: 4 });

export function riskRank(risk) {
  return RISK_RANK[String(risk || 'medium').toLowerCase()] ?? 2;
}

/* ── the compiler ─────────────────────────────────────────────────────── */

/**
 * @param {object} input
 * @param {object} input.goal         parser output: { multiple | targetPct | targetUsd, horizonDays, riskProfile, asset }
 * @param {number} input.capitalUsd   the user's REAL deployed capital (read, never assumed)
 * @param {object} input.sources      live rate sources, each `async () => ({ ok, rows })`
 * @param {number} [input.now]
 *
 * `sources` is injected for the same reason the venue drivers are: a probe must
 * be able to pin the honesty of the math without touching the network, and the
 * browser binds the real ones (Aave reserve reads, the farm feed, the LST feed).
 */
export async function buildGoalPlan({
  goal = {},
  capitalUsd = 0,
  sources = {},
  horizonDays = 365,
  riskProfile = 'balanced',
  now = Date.now(),
  locale = 'fa'
} = {}) {
  const target = normalizeGoalTarget(goal);
  const horizon = Math.max(1, Math.min(3650, Number(horizonDays) || 365));
  const band = RISK_BANDS[String(riskProfile).toLowerCase()] || RISK_BANDS.balanced;
  const capital = Number(capitalUsd) || 0;

  if (!target) {
    return { ok: false, schema: GOAL_PLAN_SCHEMA, code: 'NO_TARGET', detail: 'no multiple / pct / usd target' };
  }
  if (!(capital > 0)) {
    /* Without a real balance the plan would be a guess about someone's money.
       The chat must ask for the wallet or the amount instead. */
    return { ok: false, schema: GOAL_PLAN_SCHEMA, code: 'CAPITAL_REQUIRED', detail: 'no readable capital' };
  }

  const targetUsd = targetValueUsd({ capitalUsd: capital, target });
  const multiple = Number.isFinite(Number(target.multiple))
    ? Number(target.multiple)
    : (target.mode === 'usd' ? targetUsd / capital : target.value / 100 + 1);
  const required = requiredApyPctFor(multiple, horizon);

  /* ── read the real rate universe ───────────────────────────────────── */
  const readers = [
    ['lending', sources.lendingRates],
    ['farm', sources.farmPools],
    ['staking', sources.lstYields],
    ['perp', sources.perpFunding]
  ];
  const rows = [];
  const sourceStatus = {};
  for (const [kind, fn] of readers) {
    if (typeof fn !== 'function') { sourceStatus[kind] = 'absent'; continue; }
    try {
      const res = await fn();
      sourceStatus[kind] = res?.ok === false ? `failed:${res.code || 'unknown'}` : 'live';
      for (const row of Array.isArray(res?.rows) ? res.rows : []) {
        const apy = Number(row.apyPct);
        if (!Number.isFinite(apy)) continue;
        const rank = riskRank(row.risk);
        if (rank > band.maxRiskRank) continue;                 // outside the user's own band
        if (!band.allowsLeverage && Number(row.leverage) > 1) continue;
        rows.push({ ...row, apyPct: apy, kind, riskRank: rank, source: sourceStatus[kind] });
      }
    } catch (err) {
      sourceStatus[kind] = `failed:${String(err?.message || '').slice(0, 60)}`;
    }
  }

  const liveRows = rows.filter((r) => r.source === 'live');
  if (!liveRows.length) {
    /* No live rate anywhere. Refusing is the product here: a plan built on a
       remembered APY is how an app ends up promising a return it cannot source. */
    return {
      ok: false,
      schema: GOAL_PLAN_SCHEMA,
      code: 'NO_LIVE_RATES',
      detail: Object.entries(sourceStatus).map(([k, v]) => `${k}=${v}`).join(' ') || 'no sources bound',
      target: { ...target, targetUsd, multiple },
      requiredApyPct: required,
      horizonDays: horizon
    };
  }

  /* ── rank honestly: highest REAL apy inside the band, lowest risk first ── */
  const ranked = liveRows
    .slice()
    .sort((a, b) => (b.apyPct - a.apyPct) || (a.riskRank - b.riskRank));
  const best = ranked[0];
  const bestApy = best.apyPct;

  const daysNeeded = daysToMultipleAt(multiple, bestApy);
  const achievableMultiple = multipleAfterDays(bestApy, horizon);
  const reachable = required != null && bestApy >= required;

  /* ── executable options, best three, each a real venue-action list ──── */
  const options = ranked.slice(0, 3).map((row, i) => ({
    id: `goal-opt-${i + 1}`,
    venue: row.venue || row.kind,
    kind: row.kind,
    title: row.title || `${row.asset || row.kind} @ ${row.apyPct.toFixed(2)}%`,
    apyPct: row.apyPct,
    risk: row.risk || 'medium',
    chainId: row.chainId ?? null,
    asset: row.asset ?? null,
    source: row.source,
    daysToTarget: daysToMultipleAt(multiple, row.apyPct),
    multipleAtHorizon: multipleAfterDays(row.apyPct, horizon),
    expectedUsdAtHorizon: capital * (multipleAfterDays(row.apyPct, horizon) || 1),
    /* The steps are the actions the venue executors sign. A lending option is
       one supply; a perp option is a swap-into-collateral plus an open. Both
       are real, both fail closed without a receipt. */
    actions: buildOptionActions({ row, capitalUsd: capital, goal })
  }));

  const chosen = options[0] || null;

  return {
    ok: true,
    schema: GOAL_PLAN_SCHEMA,
    code: reachable ? 'REACHABLE' : 'NOT_REACHABLE_AT_LIVE_RATES',
    at: now,
    locale,
    capitalUsd: capital,
    horizonDays: horizon,
    riskProfile: band.label,
    target: { ...target, targetUsd, multiple },
    requiredApyPct: required,
    bestAvailableApyPct: bestApy,
    bestAvailable: { venue: best.venue || best.kind, title: best.title || null, asset: best.asset || null, chainId: best.chainId ?? null },
    verdict: {
      reachable,
      daysToTargetAtBestRate: daysNeeded,
      yearsToTargetAtBestRate: daysNeeded != null ? daysNeeded / DAYS_PER_YEAR : null,
      multipleAtHorizon: achievableMultiple,
      usdAtHorizon: capital * (achievableMultiple || 1),
      apyGapPct: required != null ? required - bestApy : null
    },
    options,
    chosen,
    sourceStatus,
    /* The sentence the chat is allowed to say. Built here so the numbers in
       the prose can never drift from the numbers in the plan. */
    honesty: honestyStatement({ multiple, horizon, required, bestApy, daysNeeded, reachable, capital, locale })
  };
}

/** Venue actions for one option — the shape `runExecutionPlan` consumes. */
function buildOptionActions({ row, capitalUsd, goal }) {
  const venue = String(row.venue || row.kind || '').toLowerCase();
  const amountUsd = Number(capitalUsd);
  const chainId = row.chainId ?? null;
  const asset = row.asset || 'USDC';

  if (venue.includes('aave') || row.kind === 'lending') {
    return [{
      type: 'SUPPLY',
      venue: chainId === 8453 && String(asset).toUpperCase() === 'USDC' ? 'aave-base-usdc' : 'lend-aave',
      asset,
      chainId,
      amountUsd,
      label: `Supply ${asset} @ ${row.apyPct.toFixed(2)}% APY`
    }];
  }
  if (row.kind === 'staking') {
    /* On this app a liquid-staking deposit IS the stake: buying the LST is the
       position, no deposit contract, no lock-up (see pages/Farm.jsx). */
    return [{
      type: 'BUY',
      venue: row.mint ? 'equity-solana' : 'swap-evm',
      from: 'USDC',
      to: asset,
      mint: row.mint || null,
      asset,
      chainId,
      amountUsd,
      label: `Buy ${asset} @ ${row.apyPct.toFixed(2)}% APY`
    }];
  }
  if (row.kind === 'farm') {
    return [{
      type: 'FARM',
      venue: row.venue || null,
      asset,
      chainId,
      amountUsd,
      label: `Deposit into ${row.title || row.id} @ ${row.apyPct.toFixed(2)}% APY`
    }];
  }
  if (row.kind === 'perp') {
    const leverage = Number(row.leverage) > 1 ? Number(row.leverage) : 1;
    return [{
      type: 'FUTURES',
      venue: 'perp-velocity',
      asset,
      side: row.side || 'long',
      leverage,
      chainId: 501,
      amountUsd,
      label: `Open ${row.side || 'long'} ${asset} ${leverage}x — funding-based, high risk`
    }];
  }
  return [];
}

/**
 * One honest sentence pair. The chat renders this instead of writing its own
 * prose, so a plan that is not reachable cannot be described as if it were.
 */
function honestyStatement({ multiple, horizon, required, bestApy, daysNeeded, reachable, capital, locale }) {
  const fa = locale !== 'en';
  const fmt = (n, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : '—');
  const years = daysNeeded != null ? daysNeeded / DAYS_PER_YEAR : null;

  if (reachable) {
    return fa
      ? `برای ${fmt(multiple, 2)} برابر شدن سرمایه در ${horizon} روز به ${fmt(required)}٪ سود سالانه نیاز است؛ بهترین نرخ واقعیِ الان ${fmt(bestApy)}٪ است — پس شدنی است. در همین نرخ، ${fmt(daysNeeded, 0)} روز طول می‌کشد.`
      : `Reaching ${fmt(multiple, 2)}× in ${horizon} days needs ${fmt(required)}% APY; the best live rate right now is ${fmt(bestApy)}% — so it is reachable. At that rate it takes ${fmt(daysNeeded, 0)} days.`;
  }
  return fa
    ? `${fmt(multiple, 2)} برابر شدن در ${horizon} روز به ${fmt(required)}٪ سود سالانه نیاز دارد، اما بهترین نرخ واقعیِ الان ${fmt(bestApy)}٪ است. هیچ مسیر کم‌ریسکی این را نمی‌دهد و من وانمود نمی‌کنم که می‌دهد: در همین نرخ، ${fmt(multipleAfterYears(bestApy, horizon), 2)} برابر در ${horizon} روز می‌شود، و ${fmt(multiple, 2)} برابر حدود ${years != null ? fmt(years, 1) : '—'} سال طول می‌کشد.`
    : `${fmt(multiple, 2)}× in ${horizon} days needs ${fmt(required)}% APY, and the best live rate right now is ${fmt(bestApy)}%. No low-risk route delivers that and I will not pretend otherwise: at that rate you reach ${fmt(multipleAfterYears(bestApy, horizon), 2)}× in ${horizon} days, and ${fmt(multiple, 2)}× takes about ${years != null ? fmt(years, 1) : '—'} years.`;
}

function multipleAfterYears(apyPct, days) {
  return multipleAfterDays(apyPct, days);
}

/**
 * A recurring DCA towards the same goal. Kept beside the compiler because the
 * honest version of "double my profit" for most users is time plus a fixed
 * schedule, and that schedule has to be built from the same real rate.
 */
export function buildGoalSchedule({ capitalUsd, targetUsd, monthlyAddUsd, apyPct, horizonDays = 365 * 5 }) {
  const capital = Number(capitalUsd) || 0;
  const target = Number(targetUsd);
  const add = Number(monthlyAddUsd) || 0;
  const r = (Number(apyPct) || 0) / 100;
  if (!(target > capital)) return { ok: false, code: 'ALREADY_AT_TARGET' };
  if (!(add > 0) && !(r > 0)) return { ok: false, code: 'NO_PROGRESS_POSSIBLE' };

  const monthlyRate = (1 + r) ** (1 / 12) - 1;
  let value = capital;
  let months = 0;
  const maxMonths = Math.max(1, Math.min(1200, Math.round(Number(horizonDays) / 30)));
  while (value < target && months < maxMonths) {
    value = value * (1 + monthlyRate) + add;
    months += 1;
  }
  const reached = value >= target;
  return {
    ok: true,
    code: reached ? 'REACHABLE' : 'NOT_REACHABLE_IN_HORIZON',
    months: reached ? months : null,
    years: reached ? months / 12 : null,
    projectedUsd: value,
    monthlyAddUsd: add,
    apyPct: Number(apyPct) || 0,
    targetUsd: target
  };
}
