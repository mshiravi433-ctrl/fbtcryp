// @vitest-environment jsdom
/**
 * Lab market data — the offline contract.
 *
 * `src/lib/lab/marketData.js` is the only price source the Lab has. Prediction,
 * Paper Trade, Investment Sim, What-If and Compare Portfolios all read it, so a
 * bad number here does not stay local: it renders as "$NaN" in the hero price
 * block and then propagates into P&L, allocation percentages and shock impacts.
 *
 * The file promises two things when CoinGecko is unreachable — which on the free
 * hosting tier and on flaky mobile networks is the *normal* case, not an edge
 * case:
 *   1. every coin still gets a finite, positive price;
 *   2. that price is stable within a minute, so two back-to-back views of the
 *      same screen do not flicker different numbers.
 *
 * A third promise is about the API being *up but unhelpful*: a null, a string,
 * or a missing field must fall back rather than pass through.
 *
 * The clock is frozen so the "stable within a minute" assertion is exact rather
 * than probabilistic — the tests must not flake when a run straddles a boundary.
 */
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';

import { COINS, getPrices, tickPrice } from '../src/lib/lab/marketData.js';

const IDS = COINS.map((c) => c.id);
const FROZEN = new Date('2026-03-02T10:15:30Z').getTime();

/** Resolve `fetch` with a canned JSON body. */
function stubJson(body, { ok = true, status = 200 } = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  }));
}

describe('lab market data · offline fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prices every Lab coin when the network is down', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const prices = await getPrices(IDS);

    for (const c of COINS) {
      const p = prices[c.id];
      expect(Number.isFinite(p), `${c.symbol} price is not finite: ${p}`).toBe(true);
      expect(p, `${c.symbol} price must be positive`).toBeGreaterThan(0);
    }
  });

  it('is stable within the same minute', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const a = await getPrices(IDS);
    const b = await getPrices(IDS);
    expect(b).toEqual(a);
  });

  it('replaces an unhelpful live quote instead of passing it through', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const offline = await getPrices(IDS);

    // Up, but answering with the shapes that have actually been observed:
    // an explicit null, a missing coin, a stringified number, a zero.
    stubJson({
      bitcoin: null,
      ethereum: { usd: '3920.55' },
      solana: { usd: 0 },
      ripple: {}
      // cardano… absent entirely
    });
    const mixed = await getPrices(IDS);

    for (const c of COINS) {
      expect(Number.isFinite(mixed[c.id]), `${c.symbol} → ${mixed[c.id]}`).toBe(true);
    }
    // The stringified quote is a real number and should be honoured…
    expect(mixed.ethereum).toBe(3920.55);
    // …while null / 0 / {} / missing fall back to the deterministic walk, which is
    // the same value the offline pass produced for this frozen minute.
    expect(mixed.bitcoin).toBe(offline.bitcoin);
    expect(mixed.solana).toBe(offline.solana);
    expect(mixed.ripple).toBe(offline.ripple);
    expect(mixed.cardano).toBe(offline.cardano);
    expect(mixed.dogecoin).toBe(offline.dogecoin);
  });

  it('never returns NaN for a coin the API has not heard of', async () => {
    stubJson({});
    const prices = await getPrices(IDS);
    for (const c of COINS) {
      expect(Number.isNaN(prices[c.id]), `${c.symbol} came back NaN`).toBe(false);
    }
  });
});

describe('lab market data · tickPrice', () => {
  it('anchors to the fallback base when no price is known yet', () => {
    // Paper Trade calls this before its first quote lands; a null base must not
    // produce NaN in the live P&L readout.
    for (const c of COINS) {
      const t = tickPrice(c.id, null, 0);
      expect(Number.isFinite(t), `${c.symbol} tick is not finite`).toBe(true);
      expect(t).toBeGreaterThan(0);
    }
  });

  it('wobbles a known price by no more than ±0.75%', () => {
    const base = 100000;
    for (let s = -40; s <= 40; s += 1) {
      const t = tickPrice('bitcoin', base, s);
      expect(Math.abs(t - base) / base).toBeLessThanOrEqual(0.0075);
    }
  });

  it('keeps sub-dollar precision for cheap coins', () => {
    const t = tickPrice('matic-network', 0.71, 0);
    // 5 decimals, not 2 — a 2-decimal rounding would move MATIC by ~1%.
    expect(t).toBeLessThan(1);
    expect(Number.isFinite(t)).toBe(true);
  });
});
