// @vitest-environment jsdom
/*
 * LEVEL 2 ORDERS — what this file pins.
 *
 *   1. A notification fires only when a REAL quotation meets the floor.
 *      Below the floor, or when the quotation failed, nothing is sent.
 *   2. Trailing stops and bracket orders are held to a quotation floor too.
 *   3. A filled order keeps its fill details, and unknown values stay null.
 *   4. The stats are computed over closed orders only, with the window applied.
 *   5. The history lists every filled order, not just ten, and its filters work.
 *
 * Pure logic is tested directly. No network: the quotation fetch is injected
 * as a fake. The two UI components are rendered with a fixed translator.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}|${JSON.stringify(opts)}` : key) })
}));

let mockOrders = [];
vi.mock('../src/lib/orders', async (original) => ({
  ...(await original()),
  loadOrders: () => mockOrders
}));

import {
  advanceOrder,
  createQuoteGate,
  evaluateBracketWithQuote,
  evaluateForNotification,
  evaluateTrailingWithQuote,
  fillDetailsFields,
  fillFromReadyQuote,
  readyQuoteFields,
  READY_QUOTE_MAX_AGE_MS
} from '../src/lib/orders.js';
import {
  BEST_TYPE_MIN_CLOSED,
  computeOrderStats,
  describeFill,
  selectFilledHistory
} from '../src/lib/orderHistory.js';
import OrderStats from '../src/components/OrderStats.jsx';
import OrderHistory from '../src/pages/OrderHistory.jsx';

afterEach(() => {
  cleanup();
  mockOrders = [];
});

const DAY = 24 * 3600000;
const NOW = new Date(2026, 9, 14, 15, 0, 0).getTime(); // local 14 Oct 2026, 15:00

const TO6 = { symbol: 'USDT', decimals: 6, coingeckoId: 'tether' };
const FROM18 = { symbol: 'BNB', decimals: 18, coingeckoId: 'binancecoin' };

const limitOrder = (over = {}) => ({
  id: 'L1',
  type: 'limit',
  status: 'active',
  chainId: 56,
  fromToken: FROM18,
  toToken: TO6,
  amountIn: '1.5',
  targetRate: 700,
  direction: 'above',
  priceOf: 'from',
  createdAt: NOW - 2 * DAY,
  lastNotifiedAt: 0,
  ...over
});

const trailOrder = (over = {}) => ({
  id: 'T1',
  type: 'trailing',
  status: 'active',
  chainId: 56,
  fromToken: FROM18,
  toToken: TO6,
  amountIn: '2',
  trailPct: 10,
  peakRate: 100,
  priceOf: 'from',
  createdAt: NOW - 3 * DAY,
  lastNotifiedAt: 0,
  ...over
});

const bracketOrder = (over = {}) => ({
  id: 'B1',
  type: 'bracket',
  status: 'active',
  chainId: 56,
  fromToken: FROM18,
  toToken: TO6,
  amountIn: '1',
  takeProfitRate: 120,
  stopLossRate: 90,
  priceOf: 'from',
  createdAt: NOW - DAY,
  lastNotifiedAt: 0,
  ...over
});

/* -------------------------------------------------------------------------- */
/* 1. notification waits for a real quotation                                  */
/* -------------------------------------------------------------------------- */

describe('evaluateForNotification — notify only when the quotation meets the floor', () => {
  it('notifies when the quotation is at or above the limit', async () => {
    // 1.5 BNB at 700 → floor 1050 USDT
    const fetchQuote = vi.fn(async () => ({ amountOut: 1050, selectedSolver: 'kyberswap' }));
    const res = await evaluateForNotification(limitOrder(), 710, fetchQuote, NOW);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    expect(res.notify).toBe(true);
    expect(res.reason).toBe('QUOTE_READY');
    expect(res.minAmountOut).toBe(1050);
    expect(res.quoteOut).toBe(1050);
    expect(res.quoteSource).toBe('kyberswap');
  });

  it('does NOT notify when the quotation is below the limit', async () => {
    const fetchQuote = vi.fn(async () => ({ amountOut: 1048.5 }));
    const res = await evaluateForNotification(limitOrder(), 710, fetchQuote, NOW);
    expect(res.notify).toBe(false);
    expect(res.reason).toBe('QUOTE_BELOW_LIMIT');
  });

  it('does NOT notify when the quotation failed', async () => {
    const fetchQuote = vi.fn(async () => ({ error: 'NO_ROUTE' }));
    const res = await evaluateForNotification(limitOrder(), 710, fetchQuote, NOW);
    expect(res.notify).toBe(false);
    expect(res.reason).toBe('QUOTE_UNAVAILABLE');
  });

  it('does NOT notify when the fetch throws — a thrown error is not a fill', async () => {
    const fetchQuote = vi.fn(async () => {
      throw new Error('network down');
    });
    const res = await evaluateForNotification(limitOrder(), 710, fetchQuote, NOW);
    expect(res.notify).toBe(false);
    expect(res.reason).toBe('QUOTE_UNAVAILABLE');
  });

  it('never asks for a quotation while the price condition is not met', async () => {
    const fetchQuote = vi.fn(async () => ({ amountOut: 9999 }));
    const res = await evaluateForNotification(limitOrder(), 650, fetchQuote, NOW);
    expect(fetchQuote).not.toHaveBeenCalled();
    expect(res.notify).toBe(false);
    expect(res.needsQuote).toBe(false);
  });

  it('types without a quote check keep the price-only rule and make no request', async () => {
    const twap = {
      id: 'W1',
      type: 'twap',
      status: 'active',
      runsDone: 0,
      totalRuns: 3,
      nextRunAt: NOW - 1000,
      lastNotifiedAt: 0
    };
    const fetchQuote = vi.fn(async () => ({ amountOut: 0 }));
    const res = await evaluateForNotification(twap, null, fetchQuote, NOW);
    expect(fetchQuote).not.toHaveBeenCalled();
    expect(res.notify).toBe(true);
    expect(res.needsQuote).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. trailing and bracket with quotation floors                               */
/* -------------------------------------------------------------------------- */

describe('evaluateTrailingWithQuote', () => {
  // peak 100, trail 10% → stopAt 90. Rate 85 is below it → the stop is hit.
  // Floor = 2 BNB × 90 = 180 USDT.

  it('is ready when the quotation meets the stop-price floor', () => {
    const res = evaluateTrailingWithQuote(trailOrder(), 85, { amountOut: 181 }, NOW);
    expect(res.ready).toBe(true);
    expect(res.reason).toBe('QUOTE_READY');
    expect(res.minAmountOut).toBe(180);
  });

  it('stays pending when the quotation is below the floor', () => {
    const res = evaluateTrailingWithQuote(trailOrder(), 85, { amountOut: 170 }, NOW);
    expect(res.ready).toBe(false);
    expect(res.reason).toBe('QUOTE_BELOW_LIMIT');
    expect(res.quoteOut).toBe(170);
  });

  it('is unavailable — never ready — when the quotation failed', () => {
    const res = evaluateTrailingWithQuote(trailOrder(), 85, null, NOW);
    expect(res.ready).toBe(false);
    expect(res.reason).toBe('QUOTE_UNAVAILABLE');
  });

  it('keeps the peak for the caller to persist, even when not ready', () => {
    const res = evaluateTrailingWithQuote(trailOrder(), 95, { amountOut: 999 }, NOW);
    expect(res.ready).toBe(false);
    expect(res.reason).toBe('WAITING');
    expect(res.peak).toBe(100);
  });
});

describe('evaluateBracketWithQuote', () => {
  it('take-profit: held to the take-profit rate (floor 120 × 1 BNB)', () => {
    const ready = evaluateBracketWithQuote(bracketOrder(), 125, { amountOut: 121 }, NOW);
    expect(ready.ready).toBe(true);
    expect(ready.reason).toBe('QUOTE_READY');
    expect(ready.side).toBe('takeProfit');
    expect(ready.minAmountOut).toBe(120);

    const below = evaluateBracketWithQuote(bracketOrder(), 125, { amountOut: 119 }, NOW);
    expect(below.ready).toBe(false);
    expect(below.reason).toBe('QUOTE_BELOW_LIMIT');
    expect(below.side).toBe('takeProfit');
  });

  it('stop-loss: held to the stop-loss rate (floor 90 × 1 BNB)', () => {
    const ready = evaluateBracketWithQuote(bracketOrder(), 85, { amountOut: 91 }, NOW);
    expect(ready.ready).toBe(true);
    expect(ready.side).toBe('stopLoss');
    expect(ready.minAmountOut).toBe(90);

    const below = evaluateBracketWithQuote(bracketOrder(), 85, { amountOut: 89 }, NOW);
    expect(below.ready).toBe(false);
    expect(below.reason).toBe('QUOTE_BELOW_LIMIT');
  });

  it('a price between the two rates is still WAITING, with no quote needed', () => {
    const res = evaluateBracketWithQuote(bracketOrder(), 100, null, NOW);
    expect(res.ready).toBe(false);
    expect(res.reason).toBe('WAITING');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. fill details                                                             */
/* -------------------------------------------------------------------------- */

describe('advanceOrder — fill details', () => {
  it('still works with the old call shapes', () => {
    const a = advanceOrder(limitOrder());
    expect(a.status).toBe('filled');
    expect(a.filledRate).toBeNull();
    expect(a.filledAmountOut).toBeNull();

    const b = advanceOrder(limitOrder(), NOW);
    expect(b.filledAt).toBe(NOW);
    expect(b.filledAmountOut).toBeNull();
  });

  it('stores the quotation the order was judged ready on', () => {
    const fill = { rate: 700, amountOut: 1050, minAmountOut: 1050, source: 'kyberswap', side: null };
    const out = advanceOrder(limitOrder(), fill, NOW);
    expect(out).toMatchObject({
      status: 'filled',
      filledAt: NOW,
      filledRate: 700,
      filledAmountOut: 1050,
      filledMinAmountOut: 1050,
      filledQuoteSource: 'kyberswap',
      filledSide: null
    });
  });

  it('records which bracket side fired', () => {
    const out = advanceOrder(bracketOrder(), { rate: 91, amountOut: 91, minAmountOut: 90, source: 'openocean', side: 'stopLoss' }, NOW);
    expect(out.status).toBe('filled');
    expect(out.filledSide).toBe('stopLoss');
    expect(out.filledQuoteSource).toBe('openocean');
  });

  it('turns unknown or non-numeric values into null, never 0', () => {
    expect(fillDetailsFields({ amountOut: '', rate: 'abc' })).toMatchObject({ filledRate: null, filledAmountOut: null });
    expect(fillDetailsFields(null).filledAmountOut).toBeNull();
  });
});

describe('ready quotation → fill details', () => {
  it('builds the fill from the ready quotation within the age limit', () => {
    const order = limitOrder({
      ...readyQuoteFields({ quoteOut: 1050, minAmountOut: 1050, quoteSource: 'kyberswap' }, NOW - 60000)
    });
    const fill = fillFromReadyQuote(order, NOW);
    expect(fill).toEqual({ rate: 1050 / 1.5, amountOut: 1050, minAmountOut: 1050, source: 'kyberswap', side: null });
  });

  it('returns null for a stale quotation — it would describe an old price', () => {
    const order = limitOrder({
      ...readyQuoteFields({ quoteOut: 1050, minAmountOut: 1050 }, NOW - READY_QUOTE_MAX_AGE_MS - 1)
    });
    expect(fillFromReadyQuote(order, NOW)).toBeNull();
  });

  it('returns null when no quotation was ever recorded', () => {
    expect(fillFromReadyQuote(limitOrder(), NOW)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 4. statistics                                                               */
/* -------------------------------------------------------------------------- */

describe('computeOrderStats', () => {
  it('computes rates over CLOSED orders, not over open ones', () => {
    const orders = [
      limitOrder({ id: 'a', status: 'filled', filledAt: NOW - DAY, createdAt: NOW - 2 * DAY }),
      limitOrder({ id: 'b', status: 'filled', filledAt: NOW - DAY, createdAt: NOW - 2 * DAY }),
      limitOrder({ id: 'c', status: 'filled', filledAt: NOW - DAY, createdAt: NOW - 2 * DAY }),
      limitOrder({ id: 'd', status: 'expired' }),
      limitOrder({ id: 'e', status: 'active' }),
      limitOrder({ id: 'f', status: 'paused' })
    ];
    const s = computeOrderStats(orders, { now: NOW });
    expect(s.total).toBe(6);
    expect(s.open).toBe(2);
    expect(s.filled).toBe(3);
    expect(s.expired).toBe(1);
    expect(s.closed).toBe(4);
    expect(s.fillRate).toBe(75);
    expect(s.expireRate).toBe(25);
  });

  it('averages the time to fill in days', () => {
    const orders = [
      limitOrder({ id: 'x', status: 'filled', createdAt: NOW - 10 * DAY, filledAt: NOW - 8 * DAY }), // 2 days
      limitOrder({ id: 'y', status: 'filled', createdAt: NOW - 10 * DAY, filledAt: NOW - 6 * DAY })  // 4 days
    ];
    expect(computeOrderStats(orders, { now: NOW }).avgFillTimeDays).toBeCloseTo(3, 6);
  });

  it('applies the 30-day window to creation time', () => {
    const orders = [
      limitOrder({ id: 'new', status: 'filled', createdAt: NOW - 5 * DAY, filledAt: NOW - 4 * DAY }),
      limitOrder({ id: 'old', status: 'expired', createdAt: NOW - 60 * DAY })
    ];
    const all = computeOrderStats(orders, { windowDays: 0, now: NOW });
    const month = computeOrderStats(orders, { windowDays: 30, now: NOW });
    expect(all.total).toBe(2);
    expect(month.total).toBe(1);
    expect(month.fillRate).toBe(100);
  });

  it('reports a best type only once it has enough closed orders', () => {
    const many = (n, status) =>
      Array.from({ length: n }, (_, i) => limitOrder({ id: `${status}-${i}`, status, type: 'trailing', createdAt: NOW - DAY, filledAt: NOW }));
    expect(computeOrderStats(many(BEST_TYPE_MIN_CLOSED - 1, 'filled'), { now: NOW }).bestType).toBeNull();
    expect(computeOrderStats(many(BEST_TYPE_MIN_CLOSED, 'filled'), { now: NOW }).bestType).toBe('trailing');
  });

  it('leaves DCA and TWAP out of the fill rate', () => {
    const orders = [
      limitOrder({ id: 'l', status: 'filled' }),
      { id: 'd', type: 'dca', status: 'paused', createdAt: NOW - DAY }
    ];
    const s = computeOrderStats(orders, { now: NOW });
    expect(s.total).toBe(1);
    expect(s.open).toBe(0);
  });

  it('is all null on an empty list, never NaN or Infinity', () => {
    const s = computeOrderStats([], { now: NOW });
    expect(s.total).toBe(0);
    expect(s.fillRate).toBeNull();
    expect(s.avgFillTimeDays).toBeNull();
    expect(s.bestType).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 5. history                                                                  */
/* -------------------------------------------------------------------------- */

describe('selectFilledHistory', () => {
  const filled = (id, type, filledAt) =>
    limitOrder({ id, type, status: 'filled', filledAt, createdAt: filledAt - DAY });

  it('returns every filled order, not just the ten the Orders screen shows', () => {
    const orders = Array.from({ length: 14 }, (_, i) => filled(`f${i}`, 'limit', NOW - i * 1000));
    const rows = selectFilledHistory(orders, { now: NOW });
    expect(rows).toHaveLength(14);
  });

  it('sorts newest first and leaves out non-filled orders', () => {
    const orders = [
      filled('old', 'limit', NOW - 5 * DAY),
      filled('new', 'limit', NOW - DAY),
      limitOrder({ id: 'act', status: 'active' })
    ];
    expect(selectFilledHistory(orders, { now: NOW }).map((o) => o.id)).toEqual(['new', 'old']);
  });

  it('filters by type', () => {
    const orders = [filled('a', 'limit', NOW), filled('b', 'trailing', NOW), filled('c', 'trailing', NOW)];
    expect(selectFilledHistory(orders, { type: 'trailing', now: NOW }).map((o) => o.id).sort()).toEqual(['b', 'c']);
  });

  it('filters "today" from local midnight', () => {
    const orders = [
      filled('today', 'limit', new Date(2026, 9, 14, 1, 0).getTime()),
      filled('yesterday', 'limit', new Date(2026, 9, 13, 23, 0).getTime()),
      filled('week', 'limit', NOW - 3 * DAY)
    ];
    expect(selectFilledHistory(orders, { range: 'today', now: NOW }).map((o) => o.id)).toEqual(['today']);
    expect(selectFilledHistory(orders, { range: 'week', now: NOW }).map((o) => o.id)).toEqual(['today', 'yesterday', 'week']);
  });

  it('describeFill: above-floor is the margin over the user minimum, and P&L is never invented', () => {
    const d = describeFill({ filledAmountOut: 1060, filledMinAmountOut: 1050, filledRate: 706.6, filledQuoteSource: 'kyberswap' });
    expect(d.aboveFloor).toBeCloseTo(10, 6);
    expect(d.pnl).toBeNull();
    expect(d.pnlReason).toBe('NO_COST_BASIS');
    expect(describeFill({}).aboveFloor).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 6. quotation throttle                                                       */
/* -------------------------------------------------------------------------- */

describe('createQuoteGate', () => {
  it('allows one request in flight per order and waits between checks', () => {
    const gate = createQuoteGate({ minIntervalMs: 30000 });
    expect(gate.canStart('o1', 1000)).toBe(true);
    gate.start('o1');
    expect(gate.canStart('o1', 1000)).toBe(false); // in flight
    gate.finish('o1', 1000);
    expect(gate.canStart('o1', 2000)).toBe(false); // too soon
    expect(gate.canStart('o1', 31000)).toBe(true);
    expect(gate.canStart('o2', 2000)).toBe(true); // other orders are independent
  });
});

/* -------------------------------------------------------------------------- */
/* 7. the stats card                                                           */
/* -------------------------------------------------------------------------- */

describe('OrderStats component', () => {
  it('shows nothing when there are no price-triggered orders', () => {
    const { container } = render(<OrderStats orders={[]} now={NOW} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the counts and the fill rate as a number', () => {
    const orders = [
      limitOrder({ id: 'a', status: 'filled', createdAt: NOW - DAY, filledAt: NOW }),
      limitOrder({ id: 'b', status: 'filled', createdAt: NOW - DAY, filledAt: NOW }),
      limitOrder({ id: 'c', status: 'expired', createdAt: NOW - DAY }),
      limitOrder({ id: 'd', status: 'active', createdAt: NOW - DAY })
    ];
    render(<OrderStats orders={orders} now={NOW} />);
    expect(screen.getByText('2 (67%)')).toBeTruthy(); // 2 of 3 closed
    expect(screen.getByText('1 (33%)')).toBeTruthy();
  });

  it('applies the window when the user switches to 30 days', () => {
    const orders = [
      limitOrder({ id: 'new', status: 'filled', createdAt: NOW - DAY, filledAt: NOW }),
      limitOrder({ id: 'old', status: 'expired', createdAt: NOW - 60 * DAY })
    ];
    render(<OrderStats orders={orders} now={NOW} />);
    // all time: 1 filled and 1 expired of 2 closed — both read "1 (50%)"
    expect(screen.getAllByText('1 (50%)')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'orders.stats.win30' }));
    expect(screen.getByText('1 (100%)')).toBeTruthy(); // 30 days: only the new one
  });
});

/* -------------------------------------------------------------------------- */
/* 8. the history page                                                         */
/* -------------------------------------------------------------------------- */

describe('OrderHistory page', () => {
  const page = () =>
    render(
      <MemoryRouter>
        <OrderHistory />
      </MemoryRouter>
    );

  it('lists all filled orders and shows the honest caveat', () => {
    mockOrders = Array.from({ length: 13 }, (_, i) =>
      limitOrder({ id: `f${i}`, status: 'filled', createdAt: NOW - 2 * DAY, filledAt: NOW - i * 60000, filledAmountOut: 1050, filledMinAmountOut: 1050 })
    );
    page();
    expect(screen.getByText('orders.fullHistory.count|{"n":13}')).toBeTruthy();
    expect(screen.getByText('orders.fullHistory.honest')).toBeTruthy();
  });

  it('filters by type from the chips', () => {
    mockOrders = [
      limitOrder({ id: 'a', type: 'limit', status: 'filled', filledAt: Date.now() }),
      trailOrder({ id: 'b', status: 'filled', filledAt: Date.now() }),
      trailOrder({ id: 'c', status: 'filled', filledAt: Date.now() })
    ];
    page();
    expect(screen.getByText('orders.fullHistory.count|{"n":3}')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'orders.typeName.trailing' }));
    expect(screen.getByText('orders.fullHistory.count|{"n":2}')).toBeTruthy();
  });

  it('shows an empty state when nothing was filled', () => {
    mockOrders = [limitOrder({ id: 'x', status: 'active' })];
    page();
    expect(screen.getByText('orders.fullHistory.empty')).toBeTruthy();
  });
});
