/**
 * PAGES THAT POLL — a source-level probe.
 * ---------------------------------------------------------------------------
 * WHY A FILE THAT READS SOURCE CODE
 * The bug this pins cannot be seen in a rendered tree. `setInterval(load, ms)`
 * and `pollWhileVisible(load, ms)` produce IDENTICAL DOM in every test, and the
 * difference only exists when nobody is looking — which is exactly when no test
 * is running. On a serverless host that difference is money: three upstreams
 * twice a minute per mounted tab, forever.
 *
 * So the assertion is made where the mistake is made, in the source: a page or
 * component that starts a raw `setInterval` must also be one of the screens
 * that legitimately needs one (an animation frame, a countdown clock, a chart
 * that redraws). Everything that FETCHES must use the visibility-gated helper.
 *
 * This is a ratchet, not a style rule: the allowlist below is the current
 * state, and it may only shrink. A new name in it means someone added a poll
 * that keeps running in a background tab; a name disappearing means a poll was
 * fixed and should be removed from the list in the same commit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;

/**
 * Screens still holding a raw interval, each with the reason it is allowed to.
 * EVERY ONE of these is a data poll, not a clock — so the list is a to-do, not
 * a set of exceptions. It is recorded rather than silently tolerated so the
 * count cannot grow without a visible edit to this file.
 */
const KNOWN_RAW_INTERVALS = {
  'src/pages/DerivativesDashboard.jsx': 'reads venue positions — should move to pollWhileVisible',
  'src/pages/Dydx.jsx': 'reads subaccount/orders — should move to pollWhileVisible',
  'src/pages/FuturesOnchain.jsx': 'reads onchain positions — should move to pollWhileVisible',
  'src/pages/Ostium.jsx': 'reads Ostium positions — should move to pollWhileVisible',
  'src/pages/Orders.jsx': 'reads open orders — should move to pollWhileVisible',
  'src/pages/Market.jsx': 'reads the market row — should move to pollWhileVisible',
  'src/pages/SmartMoney.jsx': 'reads the wallet feed — should move to pollWhileVisible',
  'src/pages/SmartWallet.jsx': 'reads the wallet feed — should move to pollWhileVisible',
  'src/pages/Earn.jsx': 'reads yield rates — should move to pollWhileVisible',
  'src/pages/Explore.jsx': 'reads the token feed — should move to pollWhileVisible',
  'src/pages/Loan.jsx': 'reads loan state — should move to pollWhileVisible',
  'src/pages/Swap.jsx': 'reads quotes — should move to pollWhileVisible',
  'src/pages/Predict.jsx': 'reads market odds — should move to pollWhileVisible',
  'src/pages/Collective.jsx': 'reads the collective feed — should move to pollWhileVisible'
};

/**
 * Files that gate a raw interval BY HAND — `if (document.visibilityState ===
 * 'visible') tick()` plus its own visibilitychange listener. Same behaviour as
 * pollWhileVisible, written before the helper existed; they are correct, so
 * they are named here rather than rewritten, and a file that drops the manual
 * gate fails the first test below.
 */
/**
 * Intervals that repeat outbound work ON PURPOSE and are not tied to a screen
 * being looked at:
 *   · lib/intent-ai/os/appIntegration.js — the proactive agent's 5-minute
 *     check. It is an agent loop, not a view; it has an explicit cleanup() and
 *     is started by the Intent OS runtime, which owns its lifetime.
 */
const BACKGROUND_BY_DESIGN = {
  'src/lib/intent-ai/os/appIntegration.js': 'proactive agent loop, owned by the Intent OS runtime, has its own cleanup()'
};

const HAND_GATED = {
  'src/components/ProChart/TokenChart.jsx': 'checks document.visibilityState before every tick',
  'src/components/smart-wallet/SolTrackPanel.jsx': 'checks document.visibilityState before each data poll',
  'src/hooks/useFarmYields.js': 'interval calls a visibleRefresh() that checks visibilityState, plus visibilitychange',
  'src/lib/central/client.js': 'the SSE FALLBACK transport: it is only started when EventSource is absent, and the stream itself already closes on disconnect'
};

/** Does this source gate its intervals by hand? */
/*
 * Two ways a file can be gated by hand, and both are fine:
 *   · it checks `document.visibilityState` before the work  (in-interval gate)
 *   · it re-runs on `visibilitychange`                      (event gate)
 * The files in HAND_GATED each do at least one; this predicate is what keeps
 * them honest, and `.not hidden` counts because that is the same test with the
 * opposite spelling.
 */
const handGated = (src) => (
  /visibilityState\s*(===?|!==?)\s*['"](visible|hidden)['"]/.test(src)
  || /addEventListener\(\s*['"]visibilitychange['"]/.test(src)
);

const files = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
  .filter((f) => /\.(jsx?|mjs)$/.test(f));

test('the perpetual page does not poll a hidden tab', () => {
  const src = readFileSync(join(ROOT, 'src/pages/Perp.jsx'), 'utf8');
  const live = src.split('\n').filter((l) => !/^\s*\*|\/\//.test(l)).join('\n');
  assert.equal(/setInterval\s*\(/.test(live), false, 'Perp.jsx must use pollWhileVisible, not a raw interval');
  assert.ok(/pollWhileVisible\s*\(/.test(live), 'Perp.jsx should gate its poll on visibility');
  /* …and it must still actually poll: a "fix" that stops refreshing is worse
     than the bug. The one-minute cadence is intentional; returning to the tab
     still runs an immediate read through pollWhileVisible. */
  assert.ok(/pollWhileVisible\(load,\s*60_000\)/.test(live), 'the venue list refreshes once a minute');
});

test('the terminal keeps read-only venue polling bounded on the serverless API', () => {
  const src = readFileSync(join(ROOT, 'src/components/perp-terminal/PerpTerminalPane.jsx'), 'utf8');
  const live = src.split('\n').filter((l) => !/^\s*\*|\/\//.test(l)).join('\n');
  assert.match(live, /const MARKET_POLL_MS = 60_000;/);
  assert.match(live, /const BOOK_POLL_MS = 5_000;/, 'keep the trading order book fresh');
  assert.match(live, /const TAPE_POLL_MS = 5_000;/, 'keep the active trade tape fresh');
  assert.match(live, /const ACCOUNT_POLL_MS = 15_000;/, 'keep wallet state reasonably fresh');
  assert.match(live, /pollWhileVisible\(load, interval\)/, 'shared terminal polling pauses in hidden tabs');
  assert.match(live, /startTerminalPoll\(load, MARKET_POLL_MS\)/);
  assert.match(live, /useTerminalFeed\(tab === 'book' \? publicTicker : null, getDydxOrderbook, BOOK_POLL_MS/);
  assert.match(live, /useTerminalFeed\(tab === 'tape' \? publicTicker : null, readTape, TAPE_POLL_MS/);
});

test('futures position reads are paced, with immediate post-close refresh preserved', () => {
  const src = readFileSync(join(ROOT, 'src/components/FuturesPositionsCard.jsx'), 'utf8');
  assert.match(src, /pollWhileVisible\(refresh, 10_000\)/, 'keep visible position updates responsive');
  assert.match(src, /setTimeout\(\(\) => \{ refresh\(\); \}, 1200\)/);
});

test('Mission Control passive refresh is one minute; foreground and user actions still refresh', () => {
  const src = readFileSync(join(ROOT, 'src/components/MissionControl.jsx'), 'utf8');
  assert.match(src, /const MISSION_POLL_MS = 60_000;/);
  assert.match(src, /const onVisible = \(\) => \{ if \(document\.visibilityState === 'visible'\) load\(\); \}/);
  assert.match(src, /await refresh\(\)/);
});

/**
 * Does this source contain an interval whose CALLBACK does the fetching?
 *
 * The distinction matters and the first version of this test got it wrong: an
 * interval that waits for a race to finish (`lib/spot/solanaSpot.js` polls a
 * timestamp for 100 ms ticks, then clears itself) is not a poll of a server.
 * The pattern that actually costs money is `setInterval(async () => { …
 * await fetch … })` — a timer that repeats an outbound request. So the check
 * looks inside each callback, not at the file as a whole.
 */
const intervalBodies = (src) => {
  const out = [];
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    if (!/setInterval\s*\(/.test(l)) return;
    /* The callback, not the next sixteen lines: a window wide enough to see a
       real poll is also wide enough to catch the `await` of whatever the file
       does NEXT, which is how a self-clearing race timer got accused of being
       a network poll. Stop at the interval's own closing `}, ms);`. */
    const chunk = [];
    for (let k = i; k < Math.min(i + 20, lines.length); k++) {
      chunk.push(lines[k]);
      if (k > i && /^\s*\}\s*,\s*[\d_]/.test(lines[k])) break;
    }
    out.push(chunk.join('\n'));
  });
  return out;
};
const isOutboundPoll = (body) => {
  /* A callback whose only job is a state setter is a ticker, not a poll:
       setInterval(() => setNow(Date.now()), 1000)
     Those cost a render, not a request. Anything that awaits or fetches is a
     poll, even when the await is inside a helper it calls. */
  const settersOnly = /setInterval\s*\(\s*\(\s*\)\s*=>\s*(set[A-Z]\w*\(|\{\s*set[A-Z]\w*\([^;]*;\s*\})/.test(body);
  if (settersOnly && !/\bawait\b|\bfetch\s*\(/.test(body)) return false;
  return /\bawait\b|\bfetch\s*\(/.test(body);
};

test('no NEW interval repeats an outbound request on a hidden tab', () => {
  const offenders = [];
  for (const f of files('src')) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const live = src.split('\n').filter((l) => !/^\s*\*|\/\//.test(l)).join('\n');
    if (!/setInterval\s*\(/.test(live)) continue;
    if (f === 'src/lib/visibilityPoll.js') continue;      // the helper itself
    if (KNOWN_RAW_INTERVALS[f]) continue;                 // recorded debt
    if (BACKGROUND_BY_DESIGN[f]) continue;                // agent loop, not a view
    if (handGated(live)) continue;                         // gated by hand, correctly
    if (intervalBodies(live).some(isOutboundPoll)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `these files poll while hidden:\n${offenders.join('\n')}`);
});

test('the two hand-gated files keep their gate', () => {
  for (const [f, why] of Object.entries(HAND_GATED)) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(handGated(src), `${f} lost its visibility gate (${why})`);
  }
});

test('the recorded list only shrinks — a fixed screen is removed from it', () => {
  for (const [f, reason] of Object.entries(KNOWN_RAW_INTERVALS)) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(/setInterval\s*\(/.test(src), `${f} no longer uses setInterval — remove it from this list (${reason})`);
  }
});
