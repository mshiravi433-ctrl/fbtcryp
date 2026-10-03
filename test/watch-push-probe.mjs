/**
 * ORDER-WATCH → PUSH DELIVERY PROBE
 * ---------------------------------------------------------------------------
 * REAL BUG, reported from a phone: auto-order alerts worked in-app (sound +
 * vibration) but never arrived with the app closed, on either Web Push or FCM.
 *
 * Root cause: server/watch.js's runWatchCycle() is a pure evaluator — it
 * decides WHICH orders triggered and then calls the injected `send` callback
 * to actually deliver. The daily cron (/api/cron/daily) invoked it as
 * `runWatchCycle()` with NO callback, so every triggered order hit
 * `send(...)` where `send` was undefined, threw a TypeError, was caught
 * silently, and the alert was dropped. Because the cooldown only starts on a
 * successful send, the same order re-triggered every day and never delivered.
 *
 * wiring.mjs asserts the daily cron passes the shared `sendWatchAlert`
 * callback by name. This probe is the runtime half: it runs the REAL
 * watch.js against a stubbed price feed and proves that
 *   (a) a cycle run WITHOUT a send callback never delivers (sent === 0),
 *   (b) the SAME cycle WITH a send callback delivers (sent === 1) and routes
 *       by the device's push identity,
 *   (c) a FAILED send starts no cooldown, so the alert is retryable,
 *   (d) a CLOCK-triggered plan (DCA / TWAP) fires even while the price feed is
 *       down, is marked `scheduled`, and has its due time advanced / its run
 *       count consumed after delivery — the second reported bug, «وقتی زمان
 *       سواپ فرا برسه … نمیرسه به گوشی»,
 *   (e) the public tick that makes those due times arrive ON TIME is throttled
 *       and never runs two cycles at once.
 *
 * It is not a mock of our own code — watch.js, store.js and providers.js are
 * the real modules; only the outbound price HTTP call is stubbed, because
 * this suite runs with no network.
 */

import { maybeWatchTick, putWatches, readWatches, runWatchCycle } from '../server/watch.js';

/**
 * The only network the cycle makes is fetchSimplePrices → CoinGecko. Stub it
 * so the probe is deterministic and offline. Both legs of the watched pair
 * return a price; the target is chosen so the order is triggered.
 */
function stubPrices() {
  global.fetch = async (url) => {
    const u = String(url);
    if (/ids=/.test(u)) {
      return {
        ok: true,
        json: async () => ({ bitcoin: { usd: 70000 }, tether: { usd: 1 } })
      };
    }
    return { ok: true, json: async () => ({}) };
  };
}

/** A level-triggered row that is already past its target at the stub price. */
const limitRow = (id) => ({
  id,
  type: 'limit',
  fromSym: 'BTC',
  toSym: 'USDT',
  fromId: 'bitcoin',
  toId: 'tether',
  priceOf: 'from',
  targetRate: 1,
  direction: 'above'
});

/** The stored rows belonging to one endpoint. */
const rowsFor = async (endpoint) => (await readWatches()).filter((w) => w.endpoint === endpoint);

export default async function run() {
  const rows = [];
  stubPrices();

  // A fresh, unique endpoint per run so the in-memory store cannot collide
  // with other suites that run in the same process.
  const endpoint = `https://probe-${Date.now()}.example.com/device`;
  await putWatches(endpoint, [limitRow('w1')], 'fa');

  // ── (a) the buggy shape: runWatchCycle() with NO send callback ───────────
  const dead = await runWatchCycle(undefined, Date.now());
  rows.push([
    `a watch cycle run with NO send callback never delivers (sent=${dead.sent})`,
    dead.triggered === 1 && dead.sent === 0
  ]);
  rows.push([
    'a silent send is not counted as delivered',
    dead.sent === 0
  ]);

  // ── (b) the fixed shape: the SAME cycle with a send callback delivers ────
  let delivered = null;
  const live = await runWatchCycle(async (_endpoint, lang, payload) => {
    delivered = payload;
    return true;
  }, Date.now() + 2000);
  rows.push([
    'the same cycle WITH a send callback delivers (sent=' + live.sent + ')',
    live.triggered === 1 && live.sent === 1
  ]);
  rows.push([
    'the delivered payload is the triggered order',
    delivered?.id === 'w1' && delivered?.type === 'limit'
  ]);
  rows.push([
    'a level-triggered alert is NOT marked scheduled',
    delivered?.scheduled === false
  ]);

  // ── (c) the cooldown only starts on a successful send ────────────────────
  // A dead endpoint (send throws) must NOT be silenced for 6h; the send that
  // failed must be retryable. This is what kept the bug from self-healing: the
  // row kept re-triggering every day and the alert kept being dropped.
  const deadEndpoint = `https://dead-${Date.now()}.example.com/device`;
  await putWatches(deadEndpoint, [limitRow('d1')], 'fa');

  const failedSend = await runWatchCycle(async () => { throw new Error('push channel down'); }, Date.now() + 4000);
  rows.push([
    'a throwing send is not counted as delivered',
    failedSend.sent === 0 && failedSend.triggered >= 1
  ]);

  let retried = null;
  await runWatchCycle(async (_endpoint, _lang, payload) => {
    if (payload.id === 'd1') retried = payload;
    return true;
  }, Date.now() + 5000);
  rows.push([
    'a failed push stays armed, so the next cycle retries it',
    retried?.id === 'd1'
  ]);

  /* ── (d) SCHEDULED PLANS: THE REPORTED «نمیرسه به گوشی» BUG ─────────────
   * A DCA or TWAP has no price level and may have no CoinGecko id at all. Its
   * trigger is the clock. Three things must hold or the phone stays silent
   * while the user waits:
   *   · it is accepted with symbols + a due time only;
   *   · a price-feed OUTAGE cannot suppress it (the outage is not its trigger);
   *   · after delivery the due time moves forward and one run is consumed, so
   *     a phone left closed for a week is not told about the same run daily.
   */
  const schedEndpoint = `https://sched-${Date.now()}.example.com/device`;
  const due = Date.now() - 1500;
  const stored = await putWatches(schedEndpoint, [
    // No fromId/toId on purpose: this is a plan, not a price target.
    { id: 'planA', type: 'dca', fromSym: 'BTC', toSym: 'USDT', nextRunAt: due, intervalMs: 86_400_000, runsLeft: 2 },
    { id: 'planB', type: 'twap', fromSym: 'ETH', toSym: 'USDT', nextRunAt: due, intervalMs: 300_000, runsLeft: 1 },
    // A plan with no due time is not a plan: it must be rejected, not stored
    // with a silent `0` that the copy would describe as "any moment now".
    { id: 'planC', type: 'dca', fromSym: 'SOL', toSym: 'USDT', intervalMs: 86_400_000, runsLeft: 3 }
  ], 'fa');
  rows.push([
    'a scheduled plan needs no CoinGecko id, and one with no due time is refused',
    stored.stored === 2
  ]);

  // Break the price feed entirely. Level-triggered rows go quiet (an unknown
  // price must never count as "hit"); clock-triggered plans must not care.
  global.fetch = async () => { throw new Error('coingecko down'); };

  const fired = new Map();
  const outage = await runWatchCycle(async (_endpoint, _lang, payload) => {
    fired.set(payload.id, payload);
    return true;
  }, Date.now());
  rows.push([
    'a price outage is reported rather than hidden',
    outage.pricesOk === false && outage.error === undefined
  ]);
  rows.push([
    'a price outage still fires a clock-triggered plan',
    fired.get('planA')?.id === 'planA' && fired.get('planB')?.id === 'planB'
  ]);
  rows.push([
    'a scheduled alert says it was the clock, and names the plan type',
    fired.get('planA')?.scheduled === true && fired.get('planA')?.type === 'dca'
  ]);
  rows.push([
    'a scheduled alert carries no invented price',
    fired.get('planA')?.rate === due
  ]);

  const afterFirst = await rowsFor(schedEndpoint);
  const planA = afterFirst.find((w) => w.id === 'planA');
  rows.push([
    'delivery advances the due time past now (no repeated alert for one run)',
    Number(planA?.nextRunAt) > Date.now()
  ]);
  rows.push([
    'delivery consumes exactly one run',
    planA?.runsLeft === 1
  ]);
  rows.push([
    'a plan whose last run was announced is dropped, not parked',
    !afterFirst.some((w) => w.id === 'planB')
  ]);

  stubPrices();

  // ── (e) the public tick: throttled, single-flight ────────────────────────
  // This is what turns a due time into a timely push (the app and a scheduled
  // GitHub Action both call it). Two properties matter: the window is honoured,
  // and a burst cannot run two cycles at once.
  const tickEndpoint = `https://tick-${Date.now()}.example.com/device`;
  await putWatches(tickEndpoint, [limitRow('t1')], 'fa');

  const first = await maybeWatchTick({ send: async () => true, force: true });
  rows.push([
    'a forced tick actually runs the cycle',
    typeof first.checked === 'number' && first.skipped === undefined
  ]);
  const again = await maybeWatchTick({ send: async () => true });
  rows.push([
    'an immediate second tick is THROTTLED, not a second alert',
    again.skipped === 'THROTTLED'
  ]);
  const noSender = await maybeWatchTick({ force: true });
  rows.push([
    'a tick with no sender reports NO_SENDER instead of pretending',
    noSender.skipped === 'NO_SENDER'
  ]);

  return rows;
}
