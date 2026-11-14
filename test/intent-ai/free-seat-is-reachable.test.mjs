/* THE FREE SEAT MUST BE REACHABLE (2026-11-12)
 * ==========================================================================
 *
 * `openrouterfree` is the SAME KEY as `openrouter` with a different model
 * list — the `:free` models. A free key asked for a PAID model answers 402
 * on every call, so a route that names only `openrouter` is a route that
 * FAILS on a free deployment.
 *
 * And the deployment's default fleet is
 * `['openrouterfree', 'groq', 'workersai']` — the free seat is the FIRST
 * seat. Yet `getPreferredProvidersForTask` named `openrouterfree` in NO
 * base candidate order at all: it was reachable only in `max` mode, through
 * `MAX_PROVIDER_ORDER`.
 *
 * The consequence was invisible and total: every direct caller using
 * `balanced` — which includes the central brain's model fallback — asked a
 * paid seat, got 402, and fell through to the honest refusal. The seat
 * existed, the fleet named it, and no route ever asked it.
 *
 * These tests pin the seat into every task's candidate order, and pin the
 * historical order (index 0) so the fix cannot quietly become a reshuffle.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  getPreferredProvidersForTask,
  isProviderConfigured,
  PROVIDER_CONFIGS
} from '../../server/aiGateway.js';

const TASKS = ['general', 'market', 'research', 'news', 'reasoning', 'risk', 'fast', 'intent'];

test('the free seat is in every task route', () => {
  for (const task of TASKS) {
    const route = getPreferredProvidersForTask(task);
    assert.ok(
      route.includes('openrouterfree'),
      `the free seat must be reachable from the "${task}" route`
    );
  }
});

test('the free seat is in every CONFIGURED route too', () => {
  /* `configuredOnly` filters by key AND fleet — the exact call the brain's
     fallback makes. If the seat is filtered out here, it is unreachable. */
  const previous = { key: process.env.OPENROUTER_API_KEY, fleet: process.env.FBT_AI_PROVIDERS };
  process.env.OPENROUTER_API_KEY = previous.key || 'test-key-for-the-free-seat';
  process.env.FBT_AI_PROVIDERS = 'openrouterfree';
  try {
    for (const task of TASKS) {
      const route = getPreferredProvidersForTask(task, { configuredOnly: true });
      assert.ok(
        route.includes('openrouterfree'),
        `the free seat must survive the configured filter on the "${task}" route`
      );
    }
  } finally {
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous.key;
    if (previous.fleet === undefined) delete process.env.FBT_AI_PROVIDERS;
    else process.env.FBT_AI_PROVIDERS = previous.fleet;
  }
});

test('the historical order does not move', () => {
  /* The mode test pins index 0; this pins the whole paid-first shape. */
  assert.equal(getPreferredProvidersForTask('general')[0], 'openrouter');
  assert.equal(getPreferredProvidersForTask('market')[0], 'openrouter');
  assert.equal(getPreferredProvidersForTask('research')[0], 'openrouter');
  /* The free seat comes IMMEDIATELY after the paid one: a deployment with
     paid access keeps its paid seat, and a free deployment falls through to
     the free seat on the next step. */
  assert.equal(getPreferredProvidersForTask('general')[1], 'openrouterfree');
});

test('no route names an unregistered provider', () => {
  for (const task of TASKS) {
    for (const id of getPreferredProvidersForTask(task)) {
      assert.ok(Boolean(PROVIDER_CONFIGS[id]), `"${task}" routes to unregistered provider "${id}"`);
    }
  }
});

test('the free seat is a configured provider when its key is present', () => {
  const previous = { key: process.env.OPENROUTER_API_KEY, fleet: process.env.FBT_AI_PROVIDERS };
  process.env.OPENROUTER_API_KEY = 'test-key-for-the-free-seat';
  process.env.FBT_AI_PROVIDERS = 'openrouterfree';
  try {
    assert.equal(isProviderConfigured('openrouterfree'), true);
  } finally {
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous.key;
    if (previous.fleet === undefined) delete process.env.FBT_AI_PROVIDERS;
    else process.env.FBT_AI_PROVIDERS = previous.fleet;
  }
});
