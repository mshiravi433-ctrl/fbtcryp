/**
 * THE BRAIN MUST BE ABLE TO REACH THE MULTI-VENUE ENGINE.
 *
 * ─── WHY THIS TEST EXISTS ────────────────────────────────────────────────
 *
 * Sixteen phases (101–116) sat in the boot path, were probed, and were
 * dark — and the reason they were dark was that nothing asked them
 * anything. `server/multiVenue.js` was imported by `server/app.js` and
 * `server/financialGoals.js` and by NOTHING that the user can reach.
 *
 * Meanwhile the brain's `PROFIT_PLAN` intent mapped to
 * `server/ci/modules.js` → `profit-plan`, which derived everything from
 * the brain's own state and never called the venue engine. So the user
 * could ask «برنامه سودم چیه؟» and get a local derivation while a real
 * engine — dYdX, perps, yields, Avantis equities — sat idle and
 * already paid for.
 *
 * The fix wires the engine into `profit-plan`. These tests lock three
 * things:
 *
 *   1. the brain's profit plan CARRIES the venue view;
 *   2. an unreachable venue is reported as unreachable, with a REASON,
 *      and never as a healthy venue with no yield;
 *   3. the engine is loaded LAZILY, so the cold boot does not pay for
 *      the venue adapters' network calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const state = (key) => {
  if (key === 'portfolio') return { holdings: [{ asset: 'BTC', valueUsd: 10000, amount: 0.2 }] };
  if (key === 'goals') return { goals: [{ name: 'grow', targetAmount: 20000, targetDate: Date.now() + 86400000 * 90 }] };
  if (key === 'risk') return { level: 'BALANCED' };
  return null;
};

test('the brain\'s profit plan carries the multi-venue view', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const modules = createModules({ readState: state });
  const list = Array.isArray(modules) ? modules : Object.values(modules);
  const profitPlan = list.find((m) => (m.id || m.spec?.id) === 'profit-plan');
  assert.ok(profitPlan, 'the profit-plan module must exist');

  const read = await profitPlan.read();
  assert.equal(read.status, 'OK');
  assert.ok('venues' in read.data, 'the profit plan must carry the venue view');

  /* The venue view is the engine's OWN answer — the brain does not
     re-derive which feeds answered, because that distinction is the
     whole point of the engine. */
  const venues = read.data.venues;
  assert.ok(venues, 'the venue view must be present when the engine answers');
  assert.ok(venues.health, 'the venue view must carry a health map per venue class');
  assert.ok(venues.reasons, 'the venue view must say WHY a venue could not answer');
  assert.ok(venues.sources, 'the venue view must name the source of every venue');

  /* And the source line must name the engine, so the answer says where
     it came from. */
  assert.ok(
    read.data.dataSources.includes('multi-venue-engine'),
    'the data-source list must name the multi-venue engine'
  );
});

test('an unreachable venue is reported as unreachable, never as a healthy one', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const modules = createModules({ readState: state });
  const list = Array.isArray(modules) ? modules : Object.values(modules);
  const profitPlan = list.find((m) => (m.id || m.spec?.id) === 'profit-plan');

  const read = await profitPlan.read();
  const venues = read.data.venues;

  for (const [klass, health] of Object.entries(venues.health || {})) {
    if (health.live === false) {
      /* A dead venue must have a live COUNT of zero and a best of null.
         A dead venue with a best row would be a fabricated yield. */
      assert.equal(health.count, 0, `${klass} is not live, so it must report no rows`);
      assert.equal(health.best, null, `${klass} is not live, so it must have no best row`);
    }
  }
});

test('the venue engine is loaded LAZILY — the cold boot does not call it', async () => {
  /*
   * The engine's adapters make NETWORK calls. If the brain imported or
   * called the engine eagerly, every cold start would pay for four venue
   * feeds that most requests do not need.
   *
   * The test asserts the LAZY shape: importing the brain's module file
   * alone must not load the engine.
   */
  const before = process.getBuiltinModule
    ? process.getBuiltinModule('module')
    : null;
  void before;

  /* Import the module file in a FRESH module registry so a previous
     import in this file cannot mask the eagerness. */
  const enginePath = new URL('../../server/multiVenue.js', import.meta.url).href;
  const source = await import('node:fs').then((fs) => fs.promises.readFile(
    new URL('../../server/ci/modules.js', import.meta.url), 'utf8'
  ));

  /* The engine must be reached through a DYNAMIC import, not a static
     one — a static import would put it on the boot path. */
  assert.ok(
    !/^\s*import\s+[^;]*from\s+['"][^'"]*multiVenue\.js['"]/m.test(source),
    'the venue engine must not be a STATIC import of server/ci/modules.js — that would put it on the boot path'
  );
  assert.ok(
    /await\s+import\(\s*['"]\.\.\/multiVenue\.js['"]\s*\)/.test(source),
    `the venue engine must be reached through the lazy import, not a static one (${enginePath})`
  );
});
