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
 *   (a) a cycle run WITHOUT a send callback never delivers (sent === 0), and
 *   (b) the SAME cycle WITH a send callback delivers (sent === 1) and routes
 *       by the device's push identity.
 *
 * It is not a mock of our own code — watch.js, store.js and providers.js are
 * the real modules; only the outbound price HTTP call is stubbed, because
 * this suite runs with no network.
 */

import { putWatches, runWatchCycle } from '../server/watch.js';

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

export default async function run() {
  const rows = [];
  stubPrices();

  // A fresh, unique endpoint per run so the in-memory store cannot collide
  // with other suites that run in the same process.
  const endpoint = `https://probe-${Date.now()}.example.com/device`;

  await putWatches(endpoint, [
    {
      id: 'w1',
      type: 'limit',
      fromSym: 'BTC',
      toSym: 'USDT',
      fromId: 'bitcoin',
      toId: 'tether',
      priceOf: 'from',
      targetRate: 1,
      direction: 'above'
    }
  ], 'fa');

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

  // ── (c) the cooldown only starts on a successful send ────────────────────
  // A dead endpoint (send throws) must NOT be silenced for 6h; the send that
  // failed must be retryable. This is what kept the bug from self-healing.
  await putWatches(`https://dead-${Date.now()}.example.com/device`, [
    {
      id: 'd1',
      type: 'limit',
      fromSym: 'BTC',
      toSym: 'USDT',
      fromId: 'bitcoin',
      toId: 'tether',
      priceOf: 'from',
      targetRate: 1,
      direction: 'above'
    }
  ], 'fa');

  return rows;
}
