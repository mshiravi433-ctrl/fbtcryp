export const FARM_RATE_ALERT_STATE_KEY = 'fbt-farm-rate-alert-state-v1';
export const FARM_RATE_ALERT_COOLDOWN_MS = 6 * 60 * 60_000;

function safeRate(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

function readState(storage) {
  try {
    const value = JSON.parse(storage?.getItem(FARM_RATE_ALERT_STATE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeState(storage, value) {
  try {
    storage?.setItem(FARM_RATE_ALERT_STATE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Update local rate baselines and return only false-to-true threshold crossings.
 * Rates are read from fresh APY fields only: APR is never treated as APY.
 */
export function processFarmRateAlerts({
  pools = [],
  watchlist = [],
  alerts = {},
  freshness = 'FRESH',
  notifyEnabled = true,
  storage = globalThis.localStorage,
  now = Date.now()
} = {}) {
  const rows = Array.isArray(pools) ? pools : [];
  const watched = [...new Set(Array.isArray(watchlist) ? watchlist.map(String) : [])];
  const byId = new Map(rows.filter((row) => row?.id != null).map((row) => [String(row.id), row]));
  const state = readState(storage);
  const events = [];
  const activeIds = new Set(watched);

  for (const id of Object.keys(state)) {
    if (!activeIds.has(id)) delete state[id];
  }

  if (freshness === 'STALE') {
    writeState(storage, state);
    return events;
  }

  for (const id of watched) {
    const config = alerts?.[id];
    if (!config?.enabled) {
      delete state[id];
      continue;
    }
    const threshold = safeRate(config.threshold);
    const direction = config.direction === 'below' ? 'below' : 'above';
    const pool = byId.get(id);
    const rate = safeRate(pool?.apy);
    if (threshold == null || rate == null || pool?.freshness === 'STALE') continue;

    const signature = `${direction}:${threshold}`;
    const condition = direction === 'below' ? rate <= threshold : rate >= threshold;
    const previous = state[id];
    if (
      notifyEnabled && previous?.signature === signature && previous.seen === true &&
      previous.condition === false && condition &&
      (previous.lastNotifiedAt == null || now - previous.lastNotifiedAt >= FARM_RATE_ALERT_COOLDOWN_MS)
    ) {
      events.push({ id, symbol: String(pool.symbol ?? id), direction, threshold, apy: rate, at: now });
      previous.lastNotifiedAt = now;
    }
    state[id] = { signature, seen: true, condition, apy: rate, checkedAt: now, lastNotifiedAt: previous?.lastNotifiedAt ?? null };
  }

  writeState(storage, state);
  return events;
}

export const __farmRateAlertInternals = Object.freeze({ safeRate, readState, writeState });
