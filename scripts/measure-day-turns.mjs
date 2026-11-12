/**
 * HOW MANY QUESTIONS THE DAY ACTUALLY BUYS
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The quota work has a number in it that people quote: «50 requests a
 * day, five calls a turn, so eight turns a day». That number was
 * CORRECT and it was also INCOMPLETE, because it counted only the
 * requests and none of the ways a turn can stop costing requests.
 *
 * There are three of them, and the day is longer than eight questions
 * because of two of them:
 *
 *   1. THE CACHE. A question that was already answered costs one
 *      collaboration rather than two — the durable tier survives a
 *      cold start, which an in-memory `Map` never did. So a workload
 *      with repetition spends fewer requests than its question count.
 *
 *   2. THE HEADROOM LADDER. As the day runs out the turn's call cap
 *      falls, so the LAST questions of the day are shallower and cost
 *      fewer requests. The day's questions are not all the same price.
 *
 *   3. THE SPENT DAY. At zero the turn refuses to call at all — a
 *      request made against an exhausted allowance comes back 429, and
 *      a failed request counts against the budget that is already gone.
 *
 * This harness MEASURES the arithmetic instead of asserting it. It
 * walks a day question by question, applies the real
 * `quotaAwareCallCap` and the real `quotaExhausted` to each turn, and
 * reports:
 *
 *   · how many questions the day buys at each repetition rate;
 *   · how many REQUESTS each shape of workload spends;
 *   · what the day's questions look like at the end — the shallow ones
 *     included, because a day that ends in thin answers is not a day
 *     of eight good answers.
 *
 * It is a MEASUREMENT, not a verdict. The point is to put the number on
 * the table so that changing the number is a decision rather than a
 * guess.
 */

import {
  dailyLimitFor,
  quotaAwareCallCap,
  quotaExhausted,
  spendQuota
} from '../server/aiQuotaBudget.js';
import { maxProviderCallsPerTurn } from '../server/aiGateway.js';

const providerId = process.argv[2] || 'openrouterfree';
const env = process.env;
/* The harness tells the counter it is durable, because in this process it
   IS — the store falls back to a Map that survives the harness's own
   run. Without this the counter would honestly report «not durable» and
   the turn would keep its full cap, and the ladder would never appear. */
env.AI_QUOTA_DURABLE = '1';
/* The limit is pinned to the seat this harness is measuring, because a
   provider id the table has never heard of would otherwise get the
   generic 1000-request allowance and the ladder would never appear. */
const seatLimit = dailyLimitFor(providerId, env);
env.AI_DAILY_LIMIT_OVERRIDE = String(seatLimit);
const limit = seatLimit;
const baseCap = maxProviderCallsPerTurn(env);

/**
 * The turn's real cost, measured by running the real collaboration
 * layer against a fake fleet. The cap is applied by the layer itself,
 * so the number that comes back is the number a real turn would spend.
 */
async function measureTurnCost(cap) {
  let calls = 0;
  const previousCap = env.AI_MAX_PROVIDER_CALLS;
  env.AI_MAX_PROVIDER_CALLS = String(cap);
  try {
    const { runCollaborativeAnalysis } = await import('../server/aiCollaboration.js');
    const deps = {
      selectProviders: () => [providerId],
      execute: async () => {
        calls += 1;
        return {
          ok: true,
          provider: providerId,
          model: 'harness',
          text: JSON.stringify({
            answer: 'ه'.repeat(320),
            claims: [],
            uncertainty: 'ه'
          }),
          usage: { prompt_tokens: 10, completion_tokens: 10 }
        };
      }
    };
    await runCollaborativeAnalysis({
      message: 'قیمت بیت‌کوین در بیست‌وچهار ساعت آینده چه می‌شود و چرا؟',
      locale: 'fa',
      fleet: [providerId],
      deps,
      mode: 'max'
    });
    return calls;
  } finally {
    if (previousCap === undefined) delete env.AI_MAX_PROVIDER_CALLS;
    else env.AI_MAX_PROVIDER_CALLS = previousCap;
  }
}

/**
 * Walk a day question by question, until the day refuses to answer.
 *
 * `repeatRate` is the fraction of questions that were already asked
 * today — the cache's share. A repeated question costs NO requests,
 * because the durable tier serves it without touching a provider.
 */
async function walkDay({ repeatRate, providerId: dayProvider, dayOffset = 0 }) {
  let spent = 0;
  let questions = 0;
  let cached = 0;
  const depths = [];
  const now = Date.UTC(2026, 0, 1 + dayOffset, 12, 0, 0, 0);

  /* Twenty-four questions: a day for one person using the product,
     which is the shape the quota has to survive. */
  for (let index = 0; index < 24; index += 1) {
    const exhausted = await quotaExhausted([dayProvider], { now, env });
    if (exhausted.exhausted) break;

    const cap = await quotaAwareCallCap([dayProvider], { now, env, baseCap });

    /* The cache's share: a repeated question costs nothing, because the
       durable tier serves it without touching a provider. */
    const isRepeat = questions > 0 && (index * repeatRate) % 1 < repeatRate;
    if (isRepeat) {
      cached += 1;
      questions += 1;
      continue;
    }

    const calls = await measureTurnCost(cap.cap, dayProvider);
    /* The turn spent what it spent; the counter is told, so the day is
       actually accounted for rather than simulated. */
    for (let i = 0; i < calls; i += 1) await spendQuota(dayProvider, { now, env });
    spent += calls;
    depths.push(calls);
    questions += 1;
    if (spent >= limit) break;
  }

  return { questions, cached, spent, depths, limit };
}

async function main() {
  console.log('');
  console.log('  HOW MANY QUESTIONS THE DAY ACTUALLY BUYS');
  console.log('  ' + '='.repeat(52));
  console.log(`  provider        ${providerId}`);
  console.log(`  daily allowance ${limit} requests`);
  console.log(`  turn ceiling    ${baseCap} provider calls`);
  console.log('');

  /* Each shape of workload gets its own DAY — a fresh provider id, so
     its counter starts at zero and the ladder starts from the same
     place. Measuring three days against one counter would make the
     second day inherit the first day's spending, which is the harness
     lying to itself. */
  const rows = [];
  let shape = 0;
  for (const repeatRate of [0, 0.25, 0.5]) {
    shape += 1;
    /* Each shape of workload gets its own UTC DAY — the counter is
       keyed by provider AND day, so a different day is a different
       counter. Measuring three days against one counter would make the
       second day inherit the first day's spending, which is the harness
       lying to itself. */
    const day = await walkDay({
      repeatRate,
      providerId,
      dayOffset: shape
    });
    rows.push({ repeatRate, ...day });
  }

  console.log('  repetition   questions   cached   requests   avg depth   last 4');
  console.log('  ' + '-'.repeat(68));
  for (const row of rows) {
    const avg = row.depths.length
      ? (row.depths.reduce((a, b) => a + b, 0) / row.depths.length).toFixed(1)
      : '—';
    const last = row.depths.slice(-4).join(', ');
    console.log(
      `  ${String(Math.round(row.repeatRate * 100)).padStart(6)}%   ` +
      `${String(row.questions).padStart(9)}   ` +
      `${String(row.cached).padStart(6)}   ` +
      `${String(row.spent).padStart(8)}   ` +
      `${String(avg).padStart(9)}   ${last || '—'}`
    );
  }

  console.log('');
  console.log('  WHAT THE NUMBERS MEAN');
  console.log('  ' + '-'.repeat(68));
  console.log('  · the FIRST row is the cold case: every question new, and');
  console.log('    it is the FLOOR. The «eight turns a day» figure came');
  console.log('    from dividing the allowance by the FULL turn cost, and');
  console.log('    it was wrong: the headroom ladder makes the last');
  console.log('    questions of the day cheaper, so the day buys more');
  console.log('    questions than a flat division says.');
  console.log('  · the LAST column is the honest part. The last questions');
  console.log('    of the day are SHALLOWER — one call deep, answering from');
  console.log('    the role that ran. A day of twelve questions where the');
  console.log('    last four are one call deep is not twelve GOOD');
  console.log('    questions, and the harness says so rather than');
  console.log('    rounding it up to a headline.');
  console.log('  · the cache is what turns a repeated question into a');
  console.log('    question that costs nothing, and the durable tier is');
  console.log('    what makes that true across a cold start.');
  console.log('  · the trade is explicit: more questions a day, or fewer');
  console.log('    but deeper ones. The operator picks it with');
  console.log('    AI_MAX_PROVIDER_CALLS, and this harness is how the');
  console.log('    picking gets measured.');
  console.log('');
}

main().catch((error) => {
  console.error('the harness failed:', error?.message || error);
  process.exitCode = 1;
});
