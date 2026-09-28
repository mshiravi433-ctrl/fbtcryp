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

export async function runSmartMoneyCadence({ alerts, intelligence, durable = () => false,
  alertBudgetMs = 18_000, indexBudgetMs = 35_000 }) {
  // Use last cycle's indexed snapshot for verified watches. The new sample
  // becomes eligible next time; alerts from older watches are never delayed
  // behind the indexer's explorer/RPC scan.
  const alertResult = await withinBudget(alerts, alertBudgetMs,
    { checked: null, fired: null, delivered: null, status: 'time-budget-exceeded' });
  const indexResult = await withinBudget(intelligence, indexBudgetMs,
    { status: 'time-budget-exceeded', durable: durable() });
  return { ...alertResult, intelligence: indexResult };
}
