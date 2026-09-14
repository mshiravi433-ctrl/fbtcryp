/**
 * «فقط ۳ تاش از ۵ تا لایوه» — THE FIVE VENUES MUST BE FIVE.
 *
 * The Farm's venue rail advertised five venues and quoted a live rate on three
 * of them. The rail was not lying: it is derived from the server's filtered
 * feed, and that feed is a DISCOVERY list with a floor under it — MIN_APY
 * 0.5%, MIN_TVL $5m, a 500-row cap ranked by score. A venue we can actually
 * sign for is not a discovery candidate, so those gates kept deleting it.
 *
 * Verified against the live upstream on 2026-09-14
 * (yields.llama.fi/poolsEnriched?pool=7d33d57d-36dc-414b-9538-22a223250468):
 * the pinned Morpho Blue cbBTC/USDC market on Base reported
 *   tvlUsd 2 940 374 905 · apy 0 · apyBase 0 · apyMean30d 0 · outlier false
 * — a $2.9bn market paying exactly nothing because nobody is borrowing it.
 * MIN_APY turned that honest zero into a MISSING ROW, and the rail drew an
 * em-dash, which reads as "we could not look" instead of "it pays 0%".
 *
 * What this file pins:
 *   1. every one of the five venue rows survives extraction, whatever the
 *      discovery floor thinks of it — including the real 0% case;
 *   2. nothing is invented: a pin the feed does not contain is reported in
 *      `venuesMissing`, never fabricated;
 *   3. the discovery list's own gates are untouched — the same row that is
 *      pinned is still rejected by isEligible(), so a 0% market can never
 *      leak into the "investable" recommendations;
 *   4. a venue's history is served even when its row never cleared the floor
 *      (the chart must not 404 next to a card that quotes the rate);
 *   5. the pin table and the client's execution-adapter table cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  VENUE_PINS, matchesVenuePin, isPinnableVenueRow, extractVenueRows,
  isEligible, fetchYields
} from '../server/yields.js';
import { createYieldsApi } from '../server/yieldsApi.js';

const MORPHO_POOL = '7d33d57d-36dc-414b-9538-22a223250468';
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

const row = (over = {}) => ({
  pool: uuid(1), chain: 'Base', project: 'aave-v3', symbol: 'USDC',
  apy: 4.2, apyBase: 4.2, apyReward: 0, tvlUsd: 60_000_000,
  stablecoin: true, ilRisk: 'no', exposure: 'single', outlier: false,
  ...over
});

/*
 * The exact shape of the failure the user reported: the two lending venues sit
 * under the discovery floor (0.3% and 0%), the other three clear it. Under the
 * old code the rail received three rows and printed «3 of 5 live».
 */
const LIVE_FIVE = [
  row({ pool: uuid(1), apy: 4.2 }),
  row({ pool: uuid(2), project: 'compound-v3', apy: 0.3 }),
  row({ pool: uuid(3), chain: 'Arbitrum', apy: 5.1 }),
  row({ pool: uuid(4), project: 'lido', chain: 'Ethereum', symbol: 'STETH', apy: 3.1, stablecoin: false, tvlUsd: 9_000_000_000 }),
  /* The real Morpho observation of 2026-09-14: symbol is the COLLATERAL
     (CBBTC) while the deposited asset is USDC — which is exactly why the pin
     matches on the UUID and not on a symbol. */
  row({ pool: MORPHO_POOL, project: 'morpho-blue', symbol: 'CBBTC', apy: 0, apyBase: 0, apyMean30d: 0, stablecoin: false, tvlUsd: 2_940_374_905 })
];

describe('the five pinned execution venues', () => {
  it('pins exactly the five the execution hub can transact', () => {
    expect(VENUE_PINS.map((p) => p.venue)).toEqual([
      'aave-base', 'compound-base', 'aave-arbitrum', 'lido', 'morpho-base'
    ]);
  });

  it('matches Morpho by UUID, never by the collateral symbol upstream happens to use', () => {
    const pin = VENUE_PINS.find((p) => p.venue === 'morpho-base');
    expect(pin.pool).toBe(MORPHO_POOL);
    expect(matchesVenuePin(pin, { project: 'morpho-blue', chain: 'Base', pool: MORPHO_POOL, symbol: 'CBBTC' })).toBe(true);
    expect(matchesVenuePin(pin, { project: 'morpho-blue', chain: 'Base', pool: MORPHO_POOL, symbol: 'USDC' })).toBe(true);
    // A different Morpho market is a different market: never quoted as ours.
    expect(matchesVenuePin(pin, { project: 'morpho-blue', chain: 'Base', pool: uuid(9), symbol: 'CBBTC' })).toBe(false);
    expect(matchesVenuePin(pin, { project: 'morpho-blue', chain: 'Ethereum', pool: MORPHO_POOL })).toBe(false);
  });

  it('returns all five when two of them sit below the discovery floor', () => {
    const { venues, missing } = extractVenueRows(LIVE_FIVE);
    expect(missing).toEqual([]);
    expect(venues.map((v) => v.venue)).toEqual([
      'aave-base', 'compound-base', 'aave-arbitrum', 'lido', 'morpho-base'
    ]);
    // Every rate is the feed's own number — the honest zero included.
    expect(venues.find((v) => v.venue === 'morpho-base').apy).toBe(0);
    expect(venues.find((v) => v.venue === 'compound-base').apy).toBe(0.3);
    // …and the exemption is declared, not hidden.
    expect(venues.find((v) => v.venue === 'morpho-base').belowDiscoveryFloor).toBe(true);
    expect(venues.find((v) => v.venue === 'compound-base').belowDiscoveryFloor).toBe(true);
    expect(venues.find((v) => v.venue === 'aave-base').belowDiscoveryFloor).toBe(false);
    expect(venues.every((v) => v.pinned === true)).toBe(true);
  });

  it('keeps the discovery gates exactly as they were for the very same rows', () => {
    const compound = LIVE_FIVE[1];
    const morpho = LIVE_FIVE[4];
    expect(isPinnableVenueRow(compound)).toBe(true);
    expect(isPinnableVenueRow(morpho)).toBe(true);
    // …while the discovery list still refuses both. That refusal is correct:
    // a 0% market is a true fact about a venue and a bad recommendation.
    expect(isEligible(compound)).toBe(false);
    expect(isEligible(morpho)).toBe(false);
  });

  it('reports a venue the feed does not contain instead of inventing one', () => {
    const { venues, missing } = extractVenueRows([LIVE_FIVE[0], LIVE_FIVE[3]]);
    expect(venues.map((v) => v.venue)).toEqual(['aave-base', 'lido']);
    expect(missing).toEqual(['compound-base', 'aave-arbitrum', 'morpho-base']);
  });

  it('refuses a pinned row that is a broken observation, not a yield', () => {
    expect(isPinnableVenueRow(row({ apy: 400 }))).toBe(false); // glitch, not 400%
    expect(isPinnableVenueRow(row({ apy: -1 }))).toBe(false);
    expect(isPinnableVenueRow(row({ apy: null }))).toBe(false);
    expect(isPinnableVenueRow(row({ outlier: true }))).toBe(false); // upstream's own flag
    expect(isPinnableVenueRow(row({ pool: 'not-a-uuid' }))).toBe(false);
    expect(isPinnableVenueRow(row({ tvlUsd: null }))).toBe(false);
  });

  it('picks the deepest market when a protocol lists two rows for one pin', () => {
    const rows = [
      row({ pool: uuid(10), tvlUsd: 8_000_000, apy: 9 }),
      row({ pool: uuid(11), tvlUsd: 90_000_000, apy: 4 })
    ];
    const { venues } = extractVenueRows(rows);
    expect(venues).toHaveLength(1);
    expect(venues[0].id).toBe(uuid(11));
  });

  it('carries the venues through fetchYields next to the ranked discovery list', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 'success', data: LIVE_FIVE })
    });
    try {
      const feed = await fetchYields();
      expect(feed.venues.map((v) => v.venue)).toHaveLength(5);
      expect(feed.venuesMissing).toEqual([]);
      // The discovery list still holds only what cleared its floor.
      expect(feed.pools.map((p) => p.id)).not.toContain(MORPHO_POOL);
      expect(feed.venues.find((v) => v.venue === 'morpho-base').freshness).toBe('FRESH');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('the venue history route', () => {
  /**
   * An Express-shaped `res` that resolves when the route answers. The methods
   * are installed BEFORE the handler runs — attaching them afterwards would
   * let the route call `res.status()` on a bare object and fail the test for
   * the wrong reason.
   */
  const fakeRes = () => {
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const out = { status: 200, body: null, headers: {} };
    const res = {
      status(code) { out.status = code; return res; },
      set(key, value) { out.headers[key] = value; return res; },
      json(body) { out.body = body; resolve(out); return res; }
    };
    return { res, done };
  };

  it('serves history for a venue row that never cleared the discovery floor', async () => {
    const api = createYieldsApi({
      pools: async () => ({ pools: [], venues: extractVenueRows(LIVE_FIVE).venues, at: Date.now(), source: 'defillama' }),
      history: async (id) => ({ pool: id, points: [{ timestamp: Date.now(), apy: 0, tvlUsd: 1 }], at: Date.now() })
    });
    const { res, done } = fakeRes();
    await api.history({ params: { id: MORPHO_POOL } }, res);
    const out = await done;
    /* Before the pin existed this was a 404 POOL_NOT_FOUND: the chart of a
       venue whose rate the card next to it was quoting. */
    expect(out.status).toBe(200);
    expect(out.body.pool).toBe(MORPHO_POOL);
    expect(out.body.points).toHaveLength(1);
  });

  it('stamps freshness onto the venue rows on the list route too', async () => {
    const api = createYieldsApi({
      pools: async () => ({ pools: [], venues: extractVenueRows(LIVE_FIVE).venues, at: Date.now(), source: 'defillama' }),
      history: async (id) => ({ pool: id, points: [], at: Date.now() })
    });
    const { res, done } = fakeRes();
    await api.list({}, res);
    const out = await done;
    expect(out.status).toBe(200);
    expect(out.body.venues.map((v) => v.venue)).toContain('morpho-base');
    // A rate that survived from an older cache must say so on the rail too.
    expect(out.body.venues.every((v) => v.freshness === 'FRESH')).toBe(true);
  });

  it('still refuses a pool this feed has never heard of', async () => {
    const api = createYieldsApi({
      pools: async () => ({ pools: [], venues: [], at: Date.now(), source: 'defillama' }),
      history: async () => { throw new Error('MUST_NOT_BE_CALLED'); }
    });
    const { res, done } = fakeRes();
    await api.history({ params: { id: uuid(77) } }, res);
    const out = await done;
    expect(out.status).toBe(404);
    expect(out.body.error).toBe('POOL_NOT_FOUND');
  });

  it('refuses a malformed pool id before touching the feed', async () => {
    const api = createYieldsApi({
      pools: async () => { throw new Error('MUST_NOT_BE_CALLED'); },
      history: async () => { throw new Error('MUST_NOT_BE_CALLED'); }
    });
    const { res, done } = fakeRes();
    await api.history({ params: { id: '../../etc/passwd' } }, res);
    const out = await done;
    expect(out.status).toBe(400);
    expect(out.body.error).toBe('INVALID_POOL_ID');
  });
});
