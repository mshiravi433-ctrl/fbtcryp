/**
 * SPOT TRADE — the order flow with COUNTING MOCKS of every wallet-touching
 * function. The counters are the evidence: "no approve, swap or send without
 * the click" is asserted as "the counter is still zero".
 * Run: node --test test/spot-trade-flow.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSpotOrder, SPOT_STATUS, classifySpotError, isUserRejection } from '../src/lib/spot/spotFlow.js';

const USDC = { symbol: 'USDC', address: '0xA0b8', decimals: 6 };
const WETH = { symbol: 'WETH', address: '0xC02a', decimals: 18 };
const T0 = 1_700_000_000_000;

const quoteOf = (over = {}) => ({
  source: 'kyberswap',
  amountInWei: 1_000_000n,
  amountOutWei: 400_000_000_000_000n,
  minOutWei: 398_000_000_000_000n, // 0.5% below out
  spender: '0xspender',
  ...over
});

/** A reviewed order fetched at T0, plus a set of counting mocks. */
function harness({ quote = quoteOf(), fresh = quoteOf(), needApproval = false, approvalReject = false, swapReject = false, swapError = null, receiptStatus = 1 } = {}) {
  const calls = { needsApproval: 0, approveToken: 0, getQuote: 0, executeSwap: 0, wait: 0 };
  const deps = {
    needsApproval: async () => {
      calls.needsApproval += 1;
      return needApproval;
    },
    approveToken: async () => {
      calls.approveToken += 1;
      if (approvalReject) {
        const e = new Error('user rejected the request');
        e.code = 4001;
        throw e;
      }
      return { hash: '0xapprove', wait: async () => ({ status: 1 }) };
    },
    getQuote: async () => {
      calls.getQuote += 1;
      return fresh;
    },
    executeSwap: async () => {
      calls.executeSwap += 1;
      if (swapReject) {
        const e = new Error('ACTION_REJECTED');
        e.code = 'ACTION_REJECTED';
        throw e;
      }
      if (swapError) throw swapError;
      return {
        hash: '0xswap',
        wait: async () => {
          calls.wait += 1;
          return { status: receiptStatus };
        }
      };
    }
  };
  const reviewed = { quote, fetchedAt: T0, slippage: 0.5, fromToken: USDC, toToken: WETH, amountText: '1' };
  const context = { signer: {}, provider: {}, chainId: 1, owner: '0x1111', deadlineMinutes: 20 };
  const run = (over = {}) =>
    runSpotOrder({ confirmed: true, reviewed, context, deps, now: () => T0 + 1000, ...over });
  return { run, calls, reviewed };
}

describe('nothing reaches the wallet without the click', () => {
  it('confirmed=false → zero approve, zero swap, zero quote calls', async () => {
    const h = harness({ needApproval: true });
    const out = await h.run({ confirmed: false });
    assert.equal(out.status, SPOT_STATUS.BLOCKED);
    assert.equal(out.code, 'NOT_CONFIRMED');
    assert.deepEqual(h.calls, { needsApproval: 0, approveToken: 0, getQuote: 0, executeSwap: 0, wait: 0 });
  });

  it('a truthy-but-not-true confirmation is still refused', async () => {
    const h = harness();
    for (const confirmed of [1, 'yes', {}, undefined]) {
      const out = await h.run({ confirmed });
      assert.equal(out.code, 'NOT_CONFIRMED');
    }
    assert.equal(h.calls.executeSwap, 0);
    assert.equal(h.calls.approveToken, 0);
  });
});

describe('an expired quote is never executed', () => {
  it('a quote older than 20s → stale, zero wallet calls, zero re-quotes in the flow', async () => {
    const h = harness({ needApproval: true });
    const out = await h.run({ now: () => T0 + 20_000 });
    assert.equal(out.status, SPOT_STATUS.STALE);
    assert.equal(out.code, 'QUOTE_EXPIRED');
    assert.equal(h.calls.approveToken, 0);
    assert.equal(h.calls.executeSwap, 0);
    assert.equal(h.calls.getQuote, 0);
  });

  it('a quote with no timestamp is stale, not executed', async () => {
    const h = harness();
    const out = await h.run({ reviewed: { ...h.reviewed, fetchedAt: undefined } });
    assert.equal(out.status, SPOT_STATUS.STALE);
    assert.equal(h.calls.executeSwap, 0);
  });
});

describe('the quote must respect the accepted slippage', () => {
  it('a quote whose minimum is looser than the slippage → blocked before any wallet call', async () => {
    const loose = quoteOf({ minOutWei: 1n });
    const h = harness({ quote: loose });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.BLOCKED);
    assert.equal(out.code, 'SLIPPAGE_EXCEEDED');
    assert.equal(h.calls.approveToken + h.calls.executeSwap, 0);
  });
});

describe('the happy path runs in order, once each', () => {
  it('no approval needed: quote → sign → receipt', async () => {
    const h = harness();
    const stages = [];
    const out = await h.run({ onStage: (s) => stages.push(s) });
    assert.equal(out.status, SPOT_STATUS.CONFIRMED);
    assert.equal(out.hash, '0xswap');
    assert.equal(h.calls.approveToken, 0);
    assert.equal(h.calls.getQuote, 1);
    assert.equal(h.calls.executeSwap, 1);
    assert.equal(h.calls.wait, 1);
    assert.deepEqual(stages, ['preparing', 'quoting', 'signing', 'pending']);
  });

  it('approval needed: approve (exact amount) first, then re-quote, then sign once', async () => {
    const h = harness({ needApproval: true });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.CONFIRMED);
    assert.equal(h.calls.approveToken, 1);
    assert.equal(h.calls.executeSwap, 1);
  });

  it('a better fresh quote is taken', async () => {
    const better = quoteOf({ minOutWei: 399_000_000_000_000n, amountOutWei: 400_000_000_000_000n });
    const h = harness({ fresh: better });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.CONFIRMED);
  });
});

describe('a rejection stops the order: the next transaction is never sent', () => {
  it('the user rejects the APPROVAL → cancelled, the swap is not sent', async () => {
    const h = harness({ needApproval: true, approvalReject: true });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.CANCELLED);
    assert.equal(out.code, 'USER_REJECTED');
    assert.equal(h.calls.approveToken, 1);
    assert.equal(h.calls.executeSwap, 0);
  });

  it('the user rejects the SWAP → cancelled, executed exactly once, not retried', async () => {
    const h = harness({ swapReject: true });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.CANCELLED);
    assert.equal(h.calls.executeSwap, 1);
    assert.equal(h.calls.wait, 0);
  });

  it('a rejection with EIP-1193 code 4001 is recognised too', () => {
    const e = new Error('nope');
    e.code = 4001;
    assert.equal(isUserRejection(e), true);
    assert.equal(classifySpotError(e), 'USER_REJECTED');
  });
});

describe('the price or route moved after review → stale, not silently executed', () => {
  it('a fresh quote that pays less than the reviewed minimum is not signed', async () => {
    // Internally valid at 0.5% (floor 397.005e12), but below the reviewed minimum (398e12).
    const worse = quoteOf({ minOutWei: 397_100_000_000_000n, amountOutWei: 399_000_000_000_000n });
    const h = harness({ fresh: worse });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.STALE);
    assert.equal(out.code, 'PRICE_MOVED');
    assert.equal(h.calls.executeSwap, 0);
  });

  it('a fresh route that needs a NEW spender approval is not signed', async () => {
    const other = quoteOf({ source: 'openocean', spender: '0xother' });
    const h = harness({ fresh: other });
    // The reviewed route (kyberswap) needs no approval; the fresh one does.
    const calls = { executeSwap: 0 };
    const out = await runSpotOrder({
      confirmed: true,
      reviewed: h.reviewed,
      context: { signer: {}, provider: {}, chainId: 1, owner: '0x1111', deadlineMinutes: 20 },
      deps: {
        needsApproval: async ({ quote }) => quote?.source === 'openocean',
        approveToken: async () => ({ hash: '0xa', wait: async () => ({}) }),
        getQuote: async () => other,
        executeSwap: async () => {
          calls.executeSwap += 1;
          return { hash: '0xs', wait: async () => ({ status: 1 }) };
        }
      },
      now: () => T0 + 1000
    });
    assert.equal(out.status, SPOT_STATUS.STALE);
    assert.equal(out.code, 'ROUTE_CHANGED');
    assert.equal(calls.executeSwap, 0);
  });
});

describe('failures are classified, with the raw text kept out of the headline', () => {
  it('a reverted receipt is FAILED with TX_REVERTED', async () => {
    const h = harness({ receiptStatus: 0 });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.FAILED);
    assert.equal(out.code, 'TX_REVERTED');
    assert.equal(out.hash, '0xswap');
  });

  it('known route codes pass through; RPC trouble is RPC_ERROR; the rest is TX_FAILED', () => {
    assert.equal(classifySpotError(new Error('NO_ROUTE')), 'NO_ROUTE');
    assert.equal(classifySpotError(Object.assign(new Error('x'), { code: 'NETWORK_ERROR' })), 'RPC_ERROR');
    assert.equal(classifySpotError(new Error('fetch failed')), 'RPC_ERROR');
    assert.equal(classifySpotError(Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' })), 'INSUFFICIENT_GAS');
    assert.equal(classifySpotError(new Error('something odd')), 'TX_FAILED');
  });

  it('an error during signing is FAILED and reports the stage it happened in', async () => {
    const h = harness({ swapError: new Error('FEE_NOT_APPLIED') });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.FAILED);
    assert.equal(out.code, 'FEE_NOT_APPLIED');
    assert.equal(out.stage, 'signing');
  });

  it('a quote that disappears after approval is FAILED, not executed', async () => {
    const h = harness({ needApproval: true, fresh: { error: 'NO_ROUTE' } });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.FAILED);
    assert.equal(h.calls.executeSwap, 0);
  });
});

describe('a route that changes after review is shown again, never signed', () => {
  it('same source, different token path → ROUTE_CHANGED, zero swap calls', async () => {
    const reviewedPath = quoteOf({ path: ['0xUSDC', '0xWETH'] });
    const movedPath = quoteOf({ path: ['0xUSDC', '0xWBTC', '0xWETH'] });
    const h = harness({ quote: reviewedPath, fresh: movedPath });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.STALE);
    assert.equal(out.code, 'ROUTE_CHANGED');
    assert.equal(h.calls.executeSwap, 0);
  });

  it('the same path with different letter case is the same route', async () => {
    const h = harness({
      quote: quoteOf({ path: ['0xAbC', '0xDeF'] }),
      fresh: quoteOf({ path: ['0xabc', '0xdef'] })
    });
    const out = await h.run();
    assert.equal(out.status, SPOT_STATUS.CONFIRMED);
    assert.equal(h.calls.executeSwap, 1);
  });
});
