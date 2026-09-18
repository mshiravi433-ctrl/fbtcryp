/**
 * PRICE-ALERT VALIDATION — the «BTC grew 40% when it grew 0.4%» report.
 *
 * The arithmetic in evaluatePriceAlerts() was never wrong; the INPUTS were.
 * When both market upstreams are unreachable the market screen falls back to
 * the deterministic offline snapshot (BTC seed: 67,450), and a baseline
 * recorded there against a later live price — or the reverse — manufactures
 * exactly the confident, wrong notification that was reported.
 *
 * These tests pin the three guards that make a manufactured number
 * impossible: provenance continuity, baseline freshness, and the short-window
 * plausibility ceiling — plus the behaviours that must NOT change (real
 * qualifying moves still alert, the cooldown still applies, and fixture rows
 * without provenance markers still work).
 */
import { describe, expect, it } from 'vitest';
import { evaluatePriceAlerts, ALERT_THRESHOLD_PCT } from '../src/lib/priceAlerts.js';

const now = 1_700_000_000_000;

describe('price alert validation guards', () => {
  it('never records a baseline from offline rows', () => {
    const r = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 67450, dataProvenance: 'offline' }], store: {}, now });
    expect(Object.keys(r.store)).toHaveLength(0);
    expect(r.alerts).toHaveLength(0);
  });

  it('re-arms silently on provenance flip (live→offline live price)', () => {
    const first = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 67450, dataProvenance: 'live' }], store: {}, now });
    // offline row arrives: no compare, no alert, baseline untouched
    const off = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 67450, dataProvenance: 'offline' }], store: first.store, now: now + 30000 });
    expect(off.alerts).toHaveLength(0);
    expect(off.store.bitcoin.base).toBe(67450);
  });

  it('re-arms a legacy (no-src) baseline once instead of trusting it', () => {
    const r = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 95000, dataProvenance: 'live' }], store: { bitcoin: { base: 67450, at: now - 1000 } }, now });
    expect(r.alerts).toHaveLength(0);
    expect(r.store.bitcoin.base).toBe(95000);
    expect(r.store.bitcoin.src).toBe('live');
  });

  it('swallows the reported 40%-in-30s jump (short-window ceiling)', () => {
    const first = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 67500, dataProvenance: 'live' }], store: {}, now });
    const r = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 95000, dataProvenance: 'live' }], store: first.store, now: now + 30000 });
    expect(r.alerts).toHaveLength(0);
    expect(r.store.bitcoin.base).toBe(95000);
  });

  it('re-arms a baseline older than the freshness window', () => {
    const r = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 80000, dataProvenance: 'live' }], store: { bitcoin: { base: 60000, src: 'live', seen: now - 8 * 86400000 } }, now });
    expect(r.alerts).toHaveLength(0);
    expect(r.store.bitcoin.base).toBe(80000);
  });

  it('still alerts on a genuine qualifying move (+6% over 2h)', () => {
    const r = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 10600, dataProvenance: 'live' }], store: { bitcoin: { base: 10000, src: 'live', seen: now - 2 * 3600000 } }, now });
    expect(r.alerts).toHaveLength(1);
    expect(Number(r.alerts[0].changePct.toFixed(1))).toBe(6);
  });

  it('still alerts on a large but SLOW move (+50% over 12h)', () => {
    const r = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 15000, dataProvenance: 'live' }], store: { bitcoin: { base: 10000, src: 'live', seen: now - 12 * 3600000 } }, now });
    expect(r.alerts).toHaveLength(1);
  });

  it('respects the cooldown after a real alert', () => {
    const r = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [{ id: 'bitcoin', symbol: 'btc', price: 10600, dataProvenance: 'live' }], store: { bitcoin: { base: 10000, src: 'live', seen: now - 3600000, at: now - 1800000 } }, now });
    expect(r.alerts).toHaveLength(0);
  });

  it('threshold still works with no provenance markers (fixtures)', () => {
    const first = evaluatePriceAlerts({ favorites: ['a'], coins: [{ id: 'a', symbol: 'A', price: 100 }], store: {}, now });
    const r = evaluatePriceAlerts({ favorites: ['a'], coins: [{ id: 'a', symbol: 'A', price: 106 }], store: first.store, now: now + 3600000 });
    expect(r.alerts).toHaveLength(1);
  });
});
