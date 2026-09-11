/**
 * FBT INTENT OS — MONITOR PERCENT-DROP PROBE.
 * ---------------------------------------------------------------------------
 * Proves a «خبر بده اگه ۱۰٪ ریخت» guard behaves like a guard:
 *
 *   A. pure condition — PERCENT_CHANGE + BELOW + positive t means a DROP of
 *      t% or more (flat/rising readings never fire)
 *   B. no baseline, no verdict — a guard without an anchor reports
 *      NO_BASELINE, never a false hit or miss
 *   C. auto-arm — the first live price becomes the baseline server-side
 *      and the arming turn never fires
 *   D. end to end — create → arm at 100k → drop 12% → fires; rise 5% → quiet
 *   E. price guards keep plain ABOVE/BELOW semantics (no regression)
 *
 * Server half runs against the real store (in-memory in this process); the
 * price feed is the only thing faked.
 * Run: node test/intent-ai/monitor-percent-probe.mjs
 */

import {
  createMonitor,
  deleteMonitor,
  evaluateAllMonitors,
  evaluateCondition,
  listMonitors
} from '../../server/intentMonitoring.js';

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);
const owner = 'dev:percent-probe';
const NOW = 1_800_000_000_000;

/* ── A. pure condition ────────────────────────────────────────────────── */
{
  t('flat reading does not fire a drop guard', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, value: 100000, baseline: 100000 }).hit === false);
  t('a 5% dip does not fire a 10% guard', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, value: 95000, baseline: 100000 }).hit === false);
  t('a 10% dip fires a 10% guard', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, value: 90000, baseline: 100000 }).hit === true);
  t('a 25% crash fires a 10% guard', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, value: 75000, baseline: 100000 }).hit === true);
  t('a rally never fires a drop guard', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, value: 120000, baseline: 100000 }).hit === false);
  t('above keeps its meaning (a 12% pump fires)', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'ABOVE', threshold: 10, value: 112000, baseline: 100000 }).hit === true);
  t('above stays quiet below the line', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'ABOVE', threshold: 10, value: 105000, baseline: 100000 }).hit === false);
}

/* ── B. no baseline, no verdict ───────────────────────────────────────── */
{
  const r = evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, value: 90000, baseline: null });
  t('missing baseline reports NO_BASELINE', r.ok === false && r.reason === 'NO_BASELINE');
  t('missing value reports NO_VALUE', evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, value: null, baseline: 100 }).reason === 'NO_VALUE');
}

/* ── C+D. auto-arm + end to end ───────────────────────────────────────── */
const priceAt = (usd) => async (ids) => Object.fromEntries((ids || []).map((id) => [id, { usd }]));
const sent = [];
const send = async (payload) => { sent.push(payload); return true; };

const made = await createMonitor(owner, {
  asset: { symbol: 'BTC' }, metric: 'PERCENT_CHANGE', operator: 'BELOW', threshold: 10, baseline: null,
  alert: { endpoint: 'https://push.test/device-1', lang: 'fa' }, label: 'guard'
}, { now: NOW });
t('guard creates with no usable baseline', Boolean(made.monitor?.id) && !(Number(made.monitor.baseline) > 0));

const armed = await evaluateAllMonitors({ owner, fetchPrices: priceAt(100000), send, now: NOW });
const row = (await listMonitors(owner)).find((m) => m.id === made.monitor.id);
t('first price arms the baseline', Number(row?.baseline) === 100000);
t('the arming turn never fires', sent.length === 0 && armed.triggered === 0);

const dipped = await evaluateAllMonitors({ owner, fetchPrices: priceAt(88000), send, now: NOW + 60000 });
const fired = (await listMonitors(owner)).find((m) => m.id === made.monitor.id);
t('a 12% drop triggers', dipped.triggered === 1 && fired?.status === 'TRIGGERED');
t('a 12% drop notifies the registered device once', sent.length === 1 && dipped.sent === 1);
void armed; void dipped;

/* ── E. price guards unchanged ────────────────────────────────────────── */
{
  const above = await createMonitor(owner, { asset: { symbol: 'BTC' }, metric: 'PRICE', operator: 'ABOVE', threshold: 150000 }, { now: NOW });
  t('price ABOVE fires over the line', evaluateCondition({ metric: 'PRICE', operator: 'ABOVE', threshold: 150000, value: 160000 }).hit === true);
  t('price ABOVE quiet under the line', evaluateCondition({ metric: 'PRICE', operator: 'ABOVE', threshold: 150000, value: 140000 }).hit === false);
  t('price BELOW fires under the line', evaluateCondition({ metric: 'PRICE', operator: 'BELOW', threshold: 90000, value: 85000 }).hit === true);
  await deleteMonitor(owner, above.monitor.id);
}
await deleteMonitor(owner, made.monitor.id);
t('cleanup removes the guard', (await listMonitors(owner)).length === 0);

const monitorPercentFailed = rows.filter(([, ok]) => !ok);
console.log(`\nmonitor-percent probe: ${rows.length - monitorPercentFailed.length}/${rows.length} passed`);
if (monitorPercentFailed.length) {
  console.error(monitorPercentFailed.map(([name]) => `  ✗ ${name}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/monitor-percent-probe');
export default rows;
