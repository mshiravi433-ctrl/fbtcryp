/**
 * PERP ROUTING — which venue settles which pair, for which wallet.
 *
 *   «بیشتر جفت توکن‌ها اصلا نمیشه معامله کرد … باید داخل اپ خودمون انجام شود»
 *   «با وجود کیف پول داخلی وصل شده میگه کیف پول وصل کن»
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROUTE, ROUTE_META, HARD_MAX_LEVERAGE, indexVenueMarkets, pickRoute, leverageCeiling,
  dydxOrderSize, classifyDydxOrderError, PERP_OWN_ERRORS
} from '../src/lib/perpRoutes.js';

const dydx = (ticker, extra = {}) => ({
  ticker, status: 'ACTIVE', oraclePrice: 10, atomicResolution: -6, stepBaseQuantums: 1000,
  raw: { initialMarginFraction: '0.05' }, ...extra
});

describe('indexVenueMarkets', () => {
  const idx = indexVenueMarkets({
    velocity: [{ base: 'BTC', marketId: 1, mid: 60000 }],
    ostium: [
      { base: 'BTC', marketId: 0, category: 'crypto', mid: 60010, maxLeverage: 50 },
      { base: 'META', marketId: 7, category: 'stocks' },
      { base: 'EUR', marketId: 40, category: 'forex' }
    ],
    dydx: [dydx('PEPE-USD'), dydx('DEAD-USD', { status: 'PAUSED' }), dydx('BTC-USD')]
  });

  it('merges by base symbol across the three venues', () => {
    expect(Object.keys(idx.get('BTC')).sort()).toEqual(['dydx', 'ostium', 'velocity']);
    expect(idx.get('PEPE').dydx.marketId).toBe('PEPE-USD');
  });

  it('never matches a non-crypto Ostium row to a coin, nor lists an inactive dYdX market', () => {
    expect(idx.has('META')).toBe(false);
    expect(idx.has('EUR')).toBe(false);
    expect(idx.has('DEAD')).toBe(false);
  });

  it('keeps the committed Velocity majors routable when every live feed is down', () => {
    const down = indexVenueMarkets({});
    expect(down.get('SOL')?.velocity?.fallback).toBe(true);
    expect(down.has('PEPE')).toBe(false);
  });

  it('reads dYdX leverage from the initial margin fraction', () => {
    expect(idx.get('PEPE').dydx.maxLeverage).toBe(20);
  });
});

describe('pickRoute', () => {
  const all = indexVenueMarkets({
    velocity: [{ base: 'BTC', marketId: 1 }],
    ostium: [{ base: 'BTC', marketId: 0, category: 'crypto' }, { base: 'LINK', marketId: 9, category: 'crypto' }],
    dydx: [dydx('PEPE-USD')]
  });

  it('routes an EVM-only wallet to an EVM venue, never to the Solana-only one', () => {
    const r = pickRoute(all.get('BTC'), { evm: true });
    expect(r.route).toBe(ROUTE.OSTIUM);
    expect(r.reason).toBeNull();
    expect(ROUTE_META[r.route].family).toBe('evm');
  });

  it('routes a Solana-only wallet to Velocity', () => {
    expect(pickRoute(all.get('BTC'), { solana: true }).route).toBe(ROUTE.VELOCITY);
  });

  it('names the wallet family a pair needs when the connected one cannot sign it', () => {
    const r = pickRoute(all.get('LINK'), { solana: true });
    expect(r).toMatchObject({ route: ROUTE.OSTIUM, reason: 'NEEDS_WALLET', needs: 'evm' });
  });

  it('offers the EVM route to someone with no wallet at all (the in-app wallet is EVM)', () => {
    const r = pickRoute(all.get('BTC'), {});
    expect(r).toMatchObject({ route: ROUTE.OSTIUM, reason: 'NEEDS_WALLET', needs: 'evm' });
  });

  it('says an unlisted pair is unlisted', () => {
    expect(pickRoute(undefined, { evm: true })).toMatchObject({ route: null, reason: 'NOT_LISTED' });
    expect(pickRoute({}, { evm: true })).toMatchObject({ route: null, reason: 'NOT_LISTED' });
  });

  it('sends a dYdX-only pair to an EVM wallet', () => {
    expect(pickRoute(all.get('PEPE'), { evm: true }).route).toBe(ROUTE.DYDX);
  });
});

describe('leverageCeiling', () => {
  it('is the venue cap, never above the product ceiling, never below 1', () => {
    expect(leverageCeiling({ maxLeverage: 20 })).toBe(20);
    expect(leverageCeiling({ maxLeverage: 500 })).toBe(HARD_MAX_LEVERAGE);
    expect(leverageCeiling({ maxLeverage: 0 })).toBe(HARD_MAX_LEVERAGE);
    expect(leverageCeiling(null)).toBe(HARD_MAX_LEVERAGE);
    expect(leverageCeiling({ maxLeverage: 0.4 })).toBe(1);
  });
});

describe('dydxOrderSize', () => {
  const market = { atomicResolution: -6, stepBaseQuantums: 1000 }; /* step 0.001 */

  it('is notional ÷ price on the market step, without floating-point loss', () => {
    expect(dydxOrderSize({ notionalUsd: 500, price: 0.00001, market })).toBe(50000000);
    expect(dydxOrderSize({ notionalUsd: 500, price: 60000, market })).toBe(0.008);
  });

  it('rounds DOWN, never up, so the venue never has to alter the reviewed order', () => {
    expect(dydxOrderSize({ notionalUsd: 100, price: 3, market })).toBe(33.333);
  });

  it('reports a notional below one step as null (below the minimum)', () => {
    expect(dydxOrderSize({ notionalUsd: 1, price: 1e6, market })).toBeNull();
    expect(dydxOrderSize({ notionalUsd: 0, price: 10, market })).toBeNull();
    expect(dydxOrderSize({ notionalUsd: 10, price: 0, market })).toBeNull();
  });
});

describe('classifyDydxOrderError', () => {
  it('maps known failures to codes the UI has sentences for', () => {
    expect(classifyDydxOrderError({ code: 'BELOW_MIN' })).toBe('BELOW_MIN');
    expect(classifyDydxOrderError({ message: 'User rejected the request' })).toBe('USER_REJECTED');
    expect(classifyDydxOrderError({ code: 'dydx:NO_COLLATERAL' })).toBe('dydx:NO_COLLATERAL');
    expect(classifyDydxOrderError(new Error('insufficient collateral'))).toBe('dydx:NO_COLLATERAL');
  });
  it('never returns an empty code', () => {
    expect(classifyDydxOrderError(new Error('something odd')).length).toBeGreaterThan(0);
    expect(classifyDydxOrderError(undefined).length).toBeGreaterThan(0);
  });
});

describe('every code the ticket can raise has a sentence, in fa and en', () => {
  const read = (l) => JSON.parse(readFileSync(resolve(__dirname, `../src/i18n/locales/${l}.json`), 'utf8'));
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  for (const lang of ['fa', 'en']) {
    it(`${lang}: own errors, route copy and ticket keys exist`, () => {
      const d = read(lang);
      for (const c of PERP_OWN_ERRORS) expect(get(d, `perp.terminal.err.${c}`), c).toBeTruthy();
      for (const r of Object.values(ROUTE)) expect(get(d, `perp.terminal.route.${r}`), r).toBeTruthy();
      for (const k of [
        'perp.fundingTitle', 'perp.terminal.goSub', 'perp.terminal.routeNote', 'perp.terminal.needsWallet',
        'perp.terminal.noRouteBtn', 'perp.terminal.connectSolana', 'perp.terminal.activateDydx',
        'perp.terminal.dydxEquity', 'perp.terminal.dydxUnfunded', 'perp.terminal.confirmDydx',
        'perp.terminal.tpSlUnsupported', 'perp.terminal.family.solana', 'perp.terminal.family.evm',
        'perp.terminal.err.UNKNOWN', 'futures.chartSpot',
        'dydx.err.NO_COLLATERAL', 'dydx.err.NOT_CONNECTED', 'futures.err.WALLET_NOT_CONNECTED'
      ]) expect(get(d, k), k).toBeTruthy();
    });
  }
});
