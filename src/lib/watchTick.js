/**
 * ADVANCE THE SERVER'S ORDER-WATCH CLOCK — one request, no secret.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 * `pingWatchTick` started life inside lib/orders.js, which was fine where it
 * was first called from (pages/Orders.jsx, which needs the order engine
 * anyway). Then App.jsx started calling it on every app open — and App is the
 * FIRST-PAINT entry, so a six-line `fetch` pulled the entire order engine
 * (types, validators, the DCA/TWAP state machine, the ladder maths) into the
 * boot graph for every visitor, including the ones who never open the orders
 * screen. Splitting it out is not tidiness: it is ~10 KB of JavaScript that
 * nobody on the market screen will ever execute.
 *
 * ─── WHY A BROWSER PINGS A CRON AT ALL ──────────────────────────────────────
 * This hosting plan allows a cron to fire at most once a day, and a ten-minute
 * expression is rejected outright — a rejected cron table fails the WHOLE
 * deployment (docs/VERCEL-CRON-HOBBY-FA.md has the afternoon). So a swap that
 * comes due at 09:01 could not be announced until the next daily run: up to
 * twenty-four hours late, which is what «وقتی زمان سواپ فرا برسه … نمیرسه به
 * گوشی» actually was. The alert machinery was never the problem; nothing was
 * waking it.
 *
 * So ordinary traffic wakes it. The endpoint runs the cycle at most once per
 * window (server-side throttle shared with the cron path — see maybeWatchTick
 * in server/watch.js), which makes this cheap, bounded and safe to call at any
 * frequency, and it takes no secret because a browser cannot keep one: a
 * "secret" in a shipped bundle is worse than none. The honest design is a
 * bounded, idempotent, read-only trigger — it cannot act on anybody's money
 * (this path has no signer) and an abuser can only cause a price read the
 * cycle would have done anyway.
 *
 * Fire-and-forget by contract: returns a boolean, never throws, and a failure
 * costs nothing because the next call or the next app open will tick again.
 */
import { apiBase } from './apiBase.js';

export async function pingWatchTick() {
  try {
    const res = await fetch(`${apiBase()}/cron/tick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      /* `keepalive` so a ping fired as the page is being closed or backgrounded
         still leaves the device — which is exactly when a phone is most likely
         to be put down mid-session. */
      keepalive: true
    });
    return res.ok;
  } catch {
    return false;
  }
}
