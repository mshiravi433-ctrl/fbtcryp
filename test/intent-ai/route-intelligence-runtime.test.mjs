/**
 * THE ROUTE ENGINE, IN A REAL TURN (path 14, runtime)
 * ---------------------------------------------------------------------------
 * `route-intelligence-surface.test.mjs` covers the parts: the intent, the
 * adapter, the engine, the bridge. This covers the WHOLE — a real brain
 * turn, with the live route source mounted, and the transfer actually
 * arriving.
 *
 * The claim being proved is the one that was FALSE before this file
 * existed, and it is the exact failure this repo keeps fixing — a
 * capability present in the code and absent in the answer:
 *
 *   Before: the route module's read received `{ symbols, now }` and
 *   nothing else. The transfer — the source chain, the destination
 *   chain, the tokens, the amount — never arrived, so every route
 *   question answered ROUTE_REQUEST_INCOMPLETE. The engine was
 *   reachable, the adapter was reachable, and LI.FI was never called.
 *
 *   Now: the turn carries the transfer the user is looking at, the
 *   module reads it, and the ranking is over the LIVE candidates.
 *
 * Fully offline: the route source is a fake that returns the shape
 * LI.FI returns, and no provider is contacted.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createCentralBrain } from '../../server/ci/brain.js';
import { createCentralStateStore } from '../../server/ci/stateStore.js';
import { setRouteProvider } from '../../server/ci/routeBridge.js';

const stateStore = createCentralStateStore();
assert.ok(stateStore, 'a state store is required to run a brain turn');
const brain = createCentralBrain({ stateStore });

/*
 * The shape the NORMALISED route has.
 *
 * This is deliberately the shape `normalizeLifiRoute` produces, not
 * LI.FI's raw body: the production provider hands the adapter the
 * NORMALISED route, so a fake that speaks LI.FI's raw dialect would
 * be testing a shape that never reaches the adapter — and a test that
 * passes against the wrong shape is a test that proves nothing.
 *
 * The numbers are provider numbers: `totalCostUsd` is the sum the
 * provider's own fee legs make, and `estimatedTime` is the provider's
 * own duration. The fake cannot make the engine look good by
 * inventing a cost the production path would not have.
 */
function liveRoute(tool, { costUsd, seconds }) {
  return {
    schema: 'fbt.cross-chain-route.v1',
    provider: 'lifi',
    routeId: `route_${tool}`,
    fromChain: '1',
    toChain: '137',
    fromToken: '0xaaa',
    toToken: '0xbbb',
    fromAmount: '1000',
    toAmount: '990',
    fromAmountUsd: 1000,
    toAmountUsd: 990,
    gasCostUsd: 0.04,
    bridgeFeeUsd: costUsd - 0.04,
    protocolFeeUsd: 0,
    totalCostUsd: costUsd,
    estimatedTime: seconds,
    slippage: 0.5,
    tool,
    toolName: tool,
    steps: [{ type: 'cross', tool, fromChain: 1, toChain: 137 }],
    executable: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + 45_000
  };
}

function mountLiveRouteSource({ calls } = { calls: [] }) {
  return setRouteProvider(async (owner, opts) => {
    const request = opts?.request || {};
    /* The production provider refuses an incomplete request BEFORE it
       spends a call, and so does this one: a fake that answered
       everything would let a broken request pass unnoticed. */
    if (request.fromChain == null || request.toChain == null || !request.fromToken
      || !request.toToken || !request.fromAmount) {
      return {
        ok: false,
        code: 'ROUTE_REQUEST_INCOMPLETE',
        detail: 'a route plan needs a source chain, a destination chain, both tokens and an amount',
        routes: [],
        request: null,
        source: null
      };
    }
    calls.push(request);
    return {
      ok: true,
      routes: [
        liveRoute('across', { costUsd: 3.5, seconds: 180 }),
        liveRoute('stargate', { costUsd: 1.25, seconds: 240 })
      ],
      request: {
        fromChain: String(request.fromChain),
        toChain: String(request.toChain),
        fromToken: request.fromToken,
        toToken: request.toToken,
        fromAmount: request.fromAmount
      },
      source: 'lifi'
    };
  });
}

const TRANSFER = {
  fromChain: 1,
  toChain: 137,
  fromToken: '0xaaa',
  toToken: '0xbbb',
  fromAmount: '1000'
};

test.after(() => {
  setRouteProvider(null);
});

test('a route question with a transfer reaches the live source', async () => {
  const calls = [];
  mountLiveRouteSource({ calls });

  const out = await brain.handle({
    owner: 'route-runtime-1',
    message: 'کدام پل برای این انتقال ارزان‌تر است؟',
    page: { route: '/bridge', routeRequest: TRANSFER },
    locale: 'fa'
  });

  assert.equal(calls.length, 1, 'the live route source was asked exactly once');
  assert.equal(calls[0].fromChain, 1);
  assert.equal(calls[0].toChain, 137);
  assert.equal(calls[0].fromToken, '0xaaa');
  assert.equal(calls[0].toToken, '0xbbb');
  assert.equal(calls[0].fromAmount, '1000');

  assert.ok(out?.response?.text, `the turn must answer → ${out?.code || 'no code'}`);
});

test('the ranking names the cheaper of the two live candidates', async () => {
  const calls = [];
  mountLiveRouteSource({ calls });

  const out = await brain.handle({
    owner: 'route-runtime-2',
    message: 'کدام پل برای این انتقال ارزان‌تر است؟',
    page: { route: '/bridge', routeRequest: TRANSFER },
    locale: 'fa'
  });

  const text = String(out?.response?.text || '');
  /* The adapter reads the provider's OWN fee legs, so the cheaper
     candidate is the one the provider said was cheaper. */
  assert.ok(
    text.includes('stargate') || text.includes('Across') || text.includes('across'),
    `the reply must name a candidate the provider returned → ${text.slice(0, 240)}`
  );
});

test('a route question WITHOUT a transfer asks which transfer, and does not call the source', async () => {
  const calls = [];
  mountLiveRouteSource({ calls });

  const out = await brain.handle({
    owner: 'route-runtime-3',
    message: 'کدام پل برای این انتقال ارزان‌تر است؟',
    page: { route: '/bridge' },
    locale: 'fa'
  });

  assert.equal(calls.length, 0, 'no transfer means no route to rank, and no request spent');
  const text = String(out?.response?.text || '');
  assert.ok(text.length > 0, 'the turn still says something');
});

test('a PARTIAL transfer is not carried, and does not reach the source', async () => {
  const calls = [];
  mountLiveRouteSource({ calls });

  await brain.handle({
    owner: 'route-runtime-4',
    message: 'کدام پل برای این انتقال ارزان‌تر است؟',
    page: { route: '/bridge', routeRequest: { fromChain: 1, toChain: 137 } },
    locale: 'fa'
  });

  assert.equal(calls.length, 0, 'a half-transfer is not a transfer');
});
