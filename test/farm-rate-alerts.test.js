import { describe, expect, it } from 'vitest';
import { FARM_RATE_ALERT_COOLDOWN_MS, processFarmRateAlerts } from '../src/lib/farmRateAlerts.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); }
  };
}

const alert = { threshold: 5, direction: 'above', enabled: true };

describe('Farm rate alerts', () => {
  it('notifies only when a watched, fresh APY crosses the user threshold', () => {
    const storage = memoryStorage();
    const watched = ['pool-1'];
    const alerts = { 'pool-1': alert };
    expect(processFarmRateAlerts({ pools: [{ id: 'pool-1', apy: 4.9 }], watchlist: watched, alerts, storage, now: 1000 })).toEqual([]);
    expect(processFarmRateAlerts({ pools: [{ id: 'pool-1', apy: 5.1 }], watchlist: watched, alerts, storage, now: 2000 })).toEqual([
      { id: 'pool-1', symbol: 'pool-1', direction: 'above', threshold: 5, apy: 5.1, at: 2000 }
    ]);
    expect(processFarmRateAlerts({ pools: [{ id: 'pool-1', apy: 5.2 }], watchlist: watched, alerts, storage, now: 3000 })).toEqual([]);
  });

  it('ignores stale feeds and APR-only rows rather than converting APR to APY', () => {
    const storage = memoryStorage();
    expect(processFarmRateAlerts({
      pools: [{ id: 'pool-1', apy: 9, freshness: 'STALE' }],
      watchlist: ['pool-1'], alerts: { 'pool-1': alert }, storage, now: 1000
    })).toEqual([]);
    expect(processFarmRateAlerts({
      pools: [{ id: 'pool-1', apr: 9 }],
      watchlist: ['pool-1'], alerts: { 'pool-1': alert }, storage, now: 2000
    })).toEqual([]);
    expect(processFarmRateAlerts({
      pools: [{ id: 'pool-1', apy: 9 }],
      watchlist: ['pool-1'], alerts: { 'pool-1': alert }, freshness: 'STALE', storage, now: 3000
    })).toEqual([]);
  });

  it('ignores boolean rates instead of treating true as one percent APY', () => {
    expect(processFarmRateAlerts({
      pools: [{ id: 'pool-1', apy: true }],
      watchlist: ['pool-1'], alerts: { 'pool-1': alert }, storage: memoryStorage(), now: 1000
    })).toEqual([]);
  });

  it('honors alert direction, notification preferences, and the cooldown', () => {
    const storage = memoryStorage();
    const opts = { watchlist: ['pool-1'], alerts: { 'pool-1': { ...alert, direction: 'below', threshold: 2 } }, storage };
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 3 }], now: 1000 })).toEqual([]);
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 1.9 }], now: 2000, notifyEnabled: false })).toEqual([]);
    // Notification preference suppresses delivery but still records this crossing as the baseline.
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 3 }], now: 3000 })).toEqual([]);
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 1.8 }], now: 4000 })).toHaveLength(1);
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 3 }], now: 5000 })).toEqual([]);
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 1.7 }], now: 4000 + FARM_RATE_ALERT_COOLDOWN_MS - 1 })).toEqual([]);
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 3 }], now: 4000 + FARM_RATE_ALERT_COOLDOWN_MS })).toEqual([]);
    expect(processFarmRateAlerts({ ...opts, pools: [{ id: 'pool-1', apy: 1.6 }], now: 4001 + FARM_RATE_ALERT_COOLDOWN_MS })).toHaveLength(1);
  });
});
