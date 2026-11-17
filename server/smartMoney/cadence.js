/**
 * Best-effort cron orchestration within api/index.js's 60-second Vercel limit.
 * Historical watch alerts run first; discovery cannot hold them hostage.
 * Budget exhaustion means UNKNOWN, never "delivered" or "indexed". A Promise
 * timeout cannot cancel arbitrary upstream work, so neither step is presented
 * as a durable worker / real-time subscription service.
 */
async function withinBudget(run, ms, timedOut) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(run).catch((err) => ({ status: 'unavailable', error: String(err?.message || err).slice(0, 100) })),
      new Promise((resolve) => { timer = setTimeout(() => resolve(timedOut), ms); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HOW FRESH IS FRESH ENOUGH FOR ANOTHER INDEX PASS?
 *
 * The smart-money indexer walks up to six wallets with their own RPC and
 * explorer scans. It is the most expensive thing in the daily cron.
 *
 * It is also scheduled TWICE A DAY by two different crons:
 *
 *   · /api/cron/daily     at 09:00 UTC
 *   · /api/cron/smart-money at 21:41 UTC
 *
 * and BOTH call this exact function. So the wallet scan was running twice
 * a day, and the second pass had nothing new to say — the rotation picks
 * never-analysed wallets first and then the oldest analysis, and a pass
 * that ran twelve hours ago had already taken those slots.
 *
 * `minIndexGapMs` is the honest answer to "how often is a fresh pass
 * actually worth the scan". Twelve hours is the gap between the two
 * schedules, so a pass that ran less than that ago is skipped — with a
 * named status, not a silent one.
 *
 * WHAT IS NOT SKIPPED
 *
 * The ALERT cycle always runs. An alert is a push to a person who asked
 * for it; skipping it because the indexer ran recently would silently
 * stop delivering the thing they subscribed to. Only the expensive INDEX
 * pass is skipped.
 */
export const DEFAULT_MIN_INDEX_GAP_MS = 12 * 60 * 60_000;

export async function runSmartMoneyCadence({
  alerts,
  intelligence,
  durable = () => false,
  alertBudgetMs = 18_000,
  indexBudgetMs = 35_000,
  /** `null` = "I do not know when the last pass ran" ⇒ always run. */
  lastIndexAt = null,
  now = Date.now(),
  minIndexGapMs = DEFAULT_MIN_INDEX_GAP_MS
} = {}) {
  // Use last cycle's indexed snapshot for verified watches. The new sample
  // becomes eligible next time; alerts from older watches are never delayed
  // behind the indexer's explorer/RPC scan.
  const alertResult = await withinBudget(alerts, alertBudgetMs,
    { checked: null, fired: null, delivered: null, status: 'time-budget-exceeded' });

  const lastAt = Number(lastIndexAt) || 0;
  const age = lastAt ? now - lastAt : null;
  const fresh = age !== null && age >= 0 && age < minIndexGapMs;
  if (fresh) {
    /* The index pass is skipped and SAYS SO. A skipped pass reported as
       "indexed" would be a lie about work that never happened. */
    return {
      ...alertResult,
      intelligence: {
        status: 'skipped-recent-index',
        reason: `the last index pass ran ${Math.round(age / 60_000)} min ago; another pass would find the same rotation slots empty`,
        lastIndexAt: lastAt,
        ageMs: age,
        durable: durable()
      }
    };
  }

  const indexResult = await withinBudget(intelligence, indexBudgetMs,
    { status: 'time-budget-exceeded', durable: durable() });
  return { ...alertResult, intelligence: indexResult };
}
