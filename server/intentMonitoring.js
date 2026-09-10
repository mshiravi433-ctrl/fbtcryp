/**
 * FBT INTENT OS — USER MARKET MONITORING ENGINE (server side).
 * ---------------------------------------------------------------------------
 * This is the real, persistent half of "بازار را بپای" (watch the market).
 * It stores monitor jobs per device, evaluates them against LIVE prices and
 * records honest events. It never fabricates a price, a trigger or a push:
 *
 *   · prices come from the same provider feed the market screens use
 *   · an unknown asset or a missing price leaves the monitor UNCHECKED
 *     (status stays ACTIVE, lastCheck records the error), never "triggered"
 *   · a triggered monitor becomes TRIGGERED and records an event; if the
 *     device registered a push endpoint, a notification is attempted and the
 *     record says whether it was sent — if it was not, the event still exists
 *     and the in-app History shows it
 *   · no signing, no keys, no execution: this engine only watches and alerts
 *
 * Storage lives in the same durable store as the rest of the Intent OS
 * (storeGet/storeSet), keyed by a hashed device identity like the V1 AI
 * gateway does — a device-scoped behavioural profile, never a name.
 */

import { createHash } from 'node:crypto';
import { storeGet, storeSet, storeDurable } from './store.js';

export const MONITOR_STORE_KEY = 'intent-os.monitors.v1';
export const MONITOR_SCHEMA = 'fbt.intent-monitor.v2';
export const MONITOR_MAX = 40;

export const MONITOR_STATUSES = Object.freeze([
  'ACTIVE', 'PAUSED', 'TRIGGERED', 'COMPLETED', 'CANCELLED', 'ERROR'
]);

export const MONITOR_METRICS = Object.freeze([
  'PRICE', 'PERCENT_CHANGE', 'VOLATILITY', 'OPPORTUNITY',
  /* Smart-money / flow metrics — evaluated against the live smart-money
     overview (same feed the Intelligence page reads). Never fabricated. */
  'VOLUME', 'WHALE', 'SMART_MONEY_NET', 'EXCHANGE_FLOW'
]);
export const MONITOR_OPERATORS = Object.freeze(['ABOVE', 'BELOW']);
export const MONITOR_INTERVALS = Object.freeze([5, 15, 30, 60, 180, 360, 720, 1440]);

/** Metrics that do not need a single priced asset (they read feeds). */
export const FEED_METRICS = Object.freeze(['OPPORTUNITY', 'VOLUME', 'WHALE', 'SMART_MONEY_NET', 'EXCHANGE_FLOW']);

/**
 * Symbol → CoinGecko id for the assets this app can actually price and trade.
 * Sources are the same ids used by src/lib/chains.js. An unknown symbol is
 * refused at creation time — watching a price we cannot fetch is exactly the
 * "wired to nothing" failure this module exists to prevent.
 */
export const SYMBOL_COINGECKO = Object.freeze({
  BTC: 'bitcoin',
  WBTC: 'bitcoin',
  'cbBTC': 'bitcoin',
  ETH: 'ethereum',
  WETH: 'ethereum',
  SOL: 'solana',
  WSOL: 'solana',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
  BNB: 'binancecoin',
  ARB: 'arbitrum',
  AVAX: 'avalanche-2',
  WAVAX: 'avalanche-2',
  LINK: 'chainlink',
  UNI: 'uniswap',
  MATIC: 'matic-network',
  POL: 'matic-network',
  DOGE: 'dogecoin',
  AAVE: 'aave',
  OP: 'optimism',
  LDO: 'lido-dao',
  STETH: 'staked-ether',
  PAXG: 'pax-gold',
  XAUT: 'tether-gold',
  S: 'sonic-3',
  SEI: 'sei-network',
  INJ: 'injective-protocol',
  TIA: 'celestia',
  SUI: 'sui',
  APT: 'aptos',
  NEAR: 'near',
  FIL: 'filecoin',
  DOT: 'polkadot',
  ATOM: 'cosmos',
  XRP: 'ripple',
  ADA: 'cardano',
  TRX: 'tron',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  'BONK': 'bonk'
});

/* ------------------------------------------------------------------------- */
/* pure helpers (kept separate so the probe can test them without storage)    */
/* ------------------------------------------------------------------------- */

export function makeId() {
  return `mon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ownerFromRequest(req) {
  const device = String(req?.get?.('x-fbt-device') || '').trim();
  if (!device) return null;
  return `dev:${createHash('sha256').update(device).digest('hex').slice(0, 24)}`;
}

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Resolve a monitor's price asset. Returns { coinId, symbol } or null. */
export function resolveAsset({ symbol = '', coinId = '' } = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  const id = String(coinId || '').trim().toLowerCase();
  if (id) return { coinId: id, symbol: sym || id };
  if (sym && SYMBOL_COINGECKO[sym]) return { coinId: SYMBOL_COINGECKO[sym], symbol: sym };
  // CoinGecko ids are often given directly as the "symbol".
  if (Object.values(SYMBOL_COINGECKO).includes(sym.toLowerCase())) {
    return { coinId: sym.toLowerCase(), symbol: sym };
  }
  return null;
}

/**
 * Validate a monitor draft. Returns { error } or { monitor } — the monitor is
 * the durable record shape (no owner, no store ids).
 */
export function normalizeMonitor(input = {}, { now = Date.now() } = {}) {
  const metric = String(input?.metric || 'PRICE').toUpperCase();
  if (!MONITOR_METRICS.includes(metric)) return { error: 'BAD_METRIC' };

  /* Feed metrics (yield / volume / whale / smart-money) do not need a single
     priced asset — they read live feeds. Asset is optional context only. */
  const asset = FEED_METRICS.includes(metric)
    ? {
        symbol: String(input?.asset?.symbol || (
          metric === 'OPPORTUNITY' ? 'YIELD'
            : metric === 'VOLUME' ? 'VOLUME'
              : metric === 'WHALE' ? 'WHALE'
                : metric === 'SMART_MONEY_NET' ? 'SM_NET'
                  : 'FLOW'
        )).toUpperCase().slice(0, 12),
        coinId: null
      }
    : resolveAsset({ symbol: input?.asset?.symbol, coinId: input?.asset?.coinId });
  if (!asset) return { error: 'UNKNOWN_ASSET' };

  const operator = String(input?.operator || 'ABOVE').toUpperCase();
  if (!MONITOR_OPERATORS.includes(operator)) return { error: 'BAD_OPERATOR' };

  const threshold = num(input?.threshold);
  if (threshold == null || threshold <= 0) return { error: 'BAD_THRESHOLD' };

  const intervalMinutes = num(input?.intervalMinutes);
  const interval = MONITOR_INTERVALS.includes(intervalMinutes) ? intervalMinutes : 60;

  const label = String(input?.label || '').trim().slice(0, 120);
  const goalText = String(input?.goalText || '').trim().slice(0, 240);
  const targetReturnPct = num(input?.targetReturnPct);

  const monitor = {
    id: String(input?.id || '').trim() || makeId(),
    schema: MONITOR_SCHEMA,
    type: String(input?.type || 'MARKET').toUpperCase().slice(0, 24),
    asset,
    metric,
    operator,
    threshold,
    baseline: num(input?.baseline),
    intervalMinutes: interval,
    status: 'ACTIVE',
    label: label || (
      metric === 'PRICE'
        ? `${asset.symbol} ${operator === 'ABOVE' ? '≥' : '≤'} ${threshold}`
        : metric === 'VOLUME'
          ? `volume ${operator === 'ABOVE' ? '≥' : '≤'} $${threshold}`
          : metric === 'WHALE'
            ? `whale events ${operator === 'ABOVE' ? '≥' : '≤'} ${threshold}`
            : metric === 'SMART_MONEY_NET'
              ? `smart-money net ${operator === 'ABOVE' ? '≥' : '≤'} $${threshold}`
              : metric === 'EXCHANGE_FLOW'
                ? `exchange flow ${operator === 'ABOVE' ? '≥' : '≤'} $${threshold}`
                : `${asset.symbol} ${operator} ${threshold}${metric === 'OPPORTUNITY' || metric === 'PERCENT_CHANGE' || metric === 'VOLATILITY' ? '%' : ''}`
    ),
    goalText,
    targetReturnPct,
    conditions: Array.isArray(input?.conditions) ? input.conditions.slice(0, 12) : [],
    alert: {
      endpoint: String(input?.alert?.endpoint || '').trim().slice(0, 320) || null,
      lang: String(input?.alert?.lang || 'fa').slice(0, 5)
    },
    createdAt: now,
    updatedAt: now,
    lastCheckAt: null,
    nextCheckAt: now + interval * 60_000,
    lastValue: null,
    lastError: null,
    eventCount: 0,
    lastEvent: null,
    events: [],
    source: String(input?.source || 'intent-os').slice(0, 24),
    conversationId: String(input?.conversationId || '').trim().slice(0, 64) || null
  };
  return { monitor };
}

/** Apply the metric/operator/threshold to a live sample. Pure. */
export function evaluateCondition({
  metric = 'PRICE',
  operator = 'ABOVE',
  threshold = 0,
  value = null,
  baseline = null
} = {}) {
  const v = num(value);
  /* Count/flow metrics (WHALE, SMART_MONEY_NET, EXCHANGE_FLOW, VOLUME) may
     legitimately read 0 — that is an observation, not a missing feed. Price
     and percent still require a positive sample. */
  const allowZero = ['WHALE', 'SMART_MONEY_NET', 'EXCHANGE_FLOW', 'VOLUME'].includes(String(metric || '').toUpperCase());
  if (v == null || (!allowZero && v <= 0)) return { ok: false, reason: 'NO_VALUE' };
  if (allowZero && v < 0) return { ok: false, reason: 'NO_VALUE' };
  const t = num(threshold);
  if (t == null || t <= 0) return { ok: false, reason: 'NO_THRESHOLD' };

  let sample = v;
  let display = v;
  if (metric === 'PERCENT_CHANGE') {
    const b = num(baseline);
    if (b == null || b <= 0) return { ok: false, reason: 'NO_BASELINE' };
    sample = ((v - b) / b) * 100;
    display = sample;
  }
  /* OPPORTUNITY value is the best real APY in percent — compared like a price.
     VOLUME / WHALE / SMART_MONEY_NET / EXCHANGE_FLOW compare absolute units. */
  const hit = operator === 'ABOVE' ? sample >= t : sample <= t;
  return { ok: true, hit, sample, display, value: v, threshold: t };
}

/** Human-readable (localizable by key, not hard-coded strings) event summary. */
export function eventCopy(monitor, evaluation, lang = 'fa') {
  const symbol = monitor.asset.symbol;
  const metric = monitor.metric;
  const isPrice = metric === 'PRICE';
  const isOpp = metric === 'OPPORTUNITY';
  const isWhale = metric === 'WHALE';
  const isVolume = metric === 'VOLUME';
  const isSm = metric === 'SMART_MONEY_NET' || metric === 'EXCHANGE_FLOW';
  const op = monitor.operator === 'ABOVE' ? 'above' : 'below';
  if (lang === 'en') {
    return {
      title: isOpp ? 'Opportunity alert'
        : isWhale ? 'Whale activity alert'
          : isVolume ? 'Volume alert'
            : isSm ? 'Smart-money flow alert'
              : isPrice ? `${symbol} price alert`
                : `${symbol} ${metric.toLowerCase()} alert`,
      body: isOpp
        ? `Best real yield reached ${evaluation.display}% (target ${monitor.threshold}%).`
        : isWhale
          ? `Whale events reached ${evaluation.display} (target ${monitor.threshold}).`
          : isVolume
            ? `Market volume is ${op} $${monitor.threshold} (observed $${evaluation.display}).`
            : isSm
              ? `Smart-money/exchange flow is ${op} $${monitor.threshold} (observed $${evaluation.display}).`
              : isPrice
                ? `${symbol} is now ${op} ${monitor.threshold} USD (${evaluation.display}).`
                : `${symbol} ${metric.toLowerCase()} is ${op} ${monitor.threshold}% (${evaluation.display}%).`
    };
  }
  if (lang === 'ar') {
    return {
      title: isOpp ? 'تنبيه فرصة' : isWhale ? 'تنبيه الحيتان' : isPrice ? `تنبيه سعر ${symbol}` : `تنبيه ${symbol}`,
      body: isOpp
        ? `أفضل عائد حقيقي بلغ ${evaluation.display}٪ (الهدف ${monitor.threshold}٪).`
        : isWhale
          ? `أحداث الحيتان بلغت ${evaluation.display} (الهدف ${monitor.threshold}).`
          : isPrice
            ? `${symbol} الآن ${op === 'above' ? 'فوق' : 'تحت'} ${monitor.threshold} دولار (${evaluation.display}).`
            : `${symbol} ${op === 'above' ? 'فوق' : 'تحت'} ${monitor.threshold}٪ (${evaluation.display}٪).`
    };
  }
  return {
    title: isOpp ? 'هشدار فرصت'
      : isWhale ? 'هشدار فعالیت نهنگ'
        : isVolume ? 'هشدار حجم'
          : isSm ? 'هشدار جریان smart money'
            : isPrice ? `هشدار قیمت ${symbol}`
              : `هشدار ${symbol}`,
    body: isOpp
      ? `بهترین بازده واقعی به ${evaluation.display}٪ رسید (هدف ${monitor.threshold}٪).`
      : isWhale
        ? `تعداد رویداد نهنگ به ${evaluation.display} رسید (هدف ${monitor.threshold}).`
        : isVolume
          ? `حجم بازار ${op === 'above' ? 'بالای' : 'زیر'} $${monitor.threshold} است (مشاهده $${evaluation.display}).`
          : isSm
            ? `جریان smart money ${op === 'above' ? 'بالای' : 'زیر'} $${monitor.threshold} است (مشاهده $${evaluation.display}).`
            : isPrice
              ? `${symbol} ${op === 'above' ? 'به' : 'به'} ${monitor.threshold} دلار رسید (${evaluation.display}).`
              : `${symbol} ${op === 'above' ? 'بالاتر' : 'پایین‌تر'} از ${monitor.threshold}٪ شد (${evaluation.display}٪).`
  };
}

/* ------------------------------------------------------------------------- */
/* storage-backed API                                                         */
/* ------------------------------------------------------------------------- */

export async function readMonitors() {
  const rows = await storeGet(MONITOR_STORE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export async function writeMonitors(rows) {
  return storeSet(MONITOR_STORE_KEY, rows.slice(0, MONITOR_MAX * 8));
}

export async function listMonitors(owner) {
  const all = await readMonitors();
  const rows = owner ? all.filter((m) => m.owner === owner) : all;
  return rows
    .map((m) => ({ ...m, events: Array.isArray(m.events) ? m.events.slice(-5) : [] }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Create one monitor for a device. Returns { monitor } or { error }. */
export async function createMonitor(owner, input = {}, { now = Date.now() } = {}) {
  if (!owner) return { error: 'NO_OWNER' };
  const { monitor, error } = normalizeMonitor(input, { now });
  if (error) return { error };
  const all = await readMonitors();
  const mine = all.filter((m) => m.owner === owner);
  if (mine.filter((m) => m.status === 'ACTIVE' || m.status === 'PAUSED').length >= MONITOR_MAX) {
    return { error: 'TOO_MANY' };
  }
  const row = { ...monitor, owner, updatedAt: now };
  await writeMonitors([row, ...all]);
  return { monitor: row };
}

export async function getMonitor(owner, id, { now = Date.now() } = {}) {
  const all = await readMonitors();
  const row = all.find((m) => m.owner === owner && m.id === id);
  if (!row) return null;
  return row;
}

export async function patchMonitor(owner, id, patch, { now = Date.now() } = {}) {
  const all = await readMonitors();
  let found = null;
  const next = all.map((m) => {
    if (m.owner === owner && m.id === id) {
      found = { ...m, ...patch, updatedAt: now };
      return found;
    }
    return m;
  });
  if (!found) return null;
  await writeMonitors(next);
  return found;
}

export async function setMonitorStatus(owner, id, status, { now = Date.now() } = {}) {
  if (!MONITOR_STATUSES.includes(String(status || '').toUpperCase())) {
    return { error: 'BAD_STATUS' };
  }
  const row = await patchMonitor(owner, id, { status: String(status).toUpperCase() }, { now });
  if (!row) return { error: 'NOT_FOUND' };
  return { monitor: row };
}

export async function deleteMonitor(owner, id) {
  const all = await readMonitors();
  const next = all.filter((m) => !(m.owner === owner && m.id === id));
  if (next.length === all.length) return { error: 'NOT_FOUND' };
  await writeMonitors(next);
  return { deleted: true, id };
}

/**
 * Evaluate one monitor against live prices.
 *
 * @param {object} row      stored monitor (owner included)
 * @param {object} opts
 * @param {object} [opts.prices]  { coinId: { usd } } — injected for tests
 * @param {function} [opts.fetchPrices]  async (ids) => prices (default: providers)
 * @param {function} [opts.send] async ({ endpoint, message, lang }) => boolean
 * @param {number} [opts.now]
 * @returns {Promise<{monitor, evaluation, triggered, sent, error?}>}
 */
export async function evaluateMonitor(row, {
  prices = null,
  fetchPrices = null,
  fetchSmartMoney = null,
  fetchGlobalVolume = null,
  send = null,
  now = Date.now()
} = {}) {
  if (!row || row.status !== 'ACTIVE') {
    return { monitor: row, evaluation: null, triggered: false, skipped: row?.status || 'INACTIVE' };
  }
  let value = null;
  if (row.metric === 'OPPORTUNITY') {
    try {
      const { fetchYields } = await import('./yields.js');
      const yields = await fetchYields();
      const rows = yields?.rows || yields?.yields || (Array.isArray(yields) ? yields : []);
      const apys = rows.map((r) => Number(r.apy ?? r.apyPct)).filter(Number.isFinite);
      value = apys.length ? Math.max(...apys) : null;
      if (value == null || value <= 0) value = null;
    } catch (err) {
      const patched = await patchMonitor(row.owner, row.id, {
        lastCheckAt: now,
        nextCheckAt: now + row.intervalMinutes * 60_000,
        lastError: 'YIELDS_UNAVAILABLE',
        updatedAt: now
      }, { now });
      return { monitor: patched, evaluation: null, triggered: false, error: 'YIELDS_UNAVAILABLE', detail: String(err?.message || '').slice(0, 120) };
    }
  } else if (row.metric === 'VOLUME') {
    /* Global 24h market volume from the same providers the markets screen uses. */
    try {
      let vol = null;
      if (typeof fetchGlobalVolume === 'function') {
        vol = await fetchGlobalVolume();
      } else {
        const { fetchGlobal } = await import('./providers.js');
        const g = await fetchGlobal();
        vol = Number(g?.volume);
      }
      value = Number.isFinite(vol) && vol > 0 ? vol : null;
    } catch (err) {
      const patched = await patchMonitor(row.owner, row.id, {
        lastCheckAt: now,
        nextCheckAt: now + row.intervalMinutes * 60_000,
        lastError: 'VOLUME_UNAVAILABLE',
        updatedAt: now
      }, { now });
      return { monitor: patched, evaluation: null, triggered: false, error: 'VOLUME_UNAVAILABLE', detail: String(err?.message || '').slice(0, 120) };
    }
  } else if (['WHALE', 'SMART_MONEY_NET', 'EXCHANGE_FLOW'].includes(row.metric)) {
    /* Smart-money / whale metrics — same overview the Intelligence page reads. */
    try {
      let overview = null;
      if (typeof fetchSmartMoney === 'function') {
        overview = await fetchSmartMoney({ window: '24h' });
      } else {
        const sm = await import('./smartMoney/index.js');
        overview = await sm.getOverview({ window: '24h' });
      }
      const m = overview?.metrics || {};
      if (row.metric === 'WHALE') {
        value = Number(m.whaleActivity?.value);
      } else if (row.metric === 'SMART_MONEY_NET') {
        const net = m.netFlow?.value ?? overview?.flows?.windows?.['24h']?.netUsd;
        value = net != null ? Math.abs(Number(net)) : null;
      } else {
        /* EXCHANGE_FLOW — max of inflow/outflow magnitude. */
        const inn = Number(m.exchangeInflow?.value ?? overview?.flows?.windows?.['24h']?.inflowUsd);
        const out = Number(m.exchangeOutflow?.value ?? overview?.flows?.windows?.['24h']?.outflowUsd);
        const candidates = [inn, out].filter(Number.isFinite);
        value = candidates.length ? Math.max(...candidates.map(Math.abs)) : null;
      }
      if (!Number.isFinite(value) || value < 0) value = null;
      if (overview?.dataStatus === 'unavailable' && value == null) {
        const patched = await patchMonitor(row.owner, row.id, {
          lastCheckAt: now,
          nextCheckAt: now + row.intervalMinutes * 60_000,
          lastError: 'SMART_MONEY_UNAVAILABLE',
          updatedAt: now
        }, { now });
        return { monitor: patched, evaluation: null, triggered: false, error: 'SMART_MONEY_UNAVAILABLE' };
      }
    } catch (err) {
      const patched = await patchMonitor(row.owner, row.id, {
        lastCheckAt: now,
        nextCheckAt: now + row.intervalMinutes * 60_000,
        lastError: 'SMART_MONEY_UNAVAILABLE',
        updatedAt: now
      }, { now });
      return { monitor: patched, evaluation: null, triggered: false, error: 'SMART_MONEY_UNAVAILABLE', detail: String(err?.message || '').slice(0, 120) };
    }
  } else {
    const id = row.asset.coinId;
    let priceMap = prices;
    if (!priceMap) {
      if (!fetchPrices) {
        const { fetchSimplePrices } = await import('./providers.js');
        fetchPrices = fetchSimplePrices;
      }
      try {
        priceMap = await fetchPrices([id]);
      } catch (err) {
        const patched = await patchMonitor(row.owner, row.id, {
          lastCheckAt: now,
          nextCheckAt: now + row.intervalMinutes * 60_000,
          lastError: 'PRICES_UNAVAILABLE',
          updatedAt: now
        }, { now });
        return { monitor: patched, evaluation: null, triggered: false, error: 'PRICES_UNAVAILABLE', detail: String(err?.message || '').slice(0, 120) };
      }
    }
    value = priceMap?.[id]?.usd;
  }
  const evaluation = evaluateCondition({
    metric: row.metric,
    operator: row.operator,
    threshold: row.threshold,
    value,
    baseline: row.baseline
  });

  const basePatch = {
    lastCheckAt: now,
    nextCheckAt: now + row.intervalMinutes * 60_000,
    lastValue: value ?? null,
    lastError: evaluation.ok ? null : (evaluation.reason || 'NO_VALUE'),
    updatedAt: now
  };

  if (!evaluation.ok) {
    const patched = await patchMonitor(row.owner, row.id, basePatch, { now });
    return { monitor: patched, evaluation, triggered: false, error: evaluation.reason };
  }

  if (!evaluation.hit) {
    const patched = await patchMonitor(row.owner, row.id, basePatch, { now });
    return { monitor: patched, evaluation, triggered: false };
  }

  /* Triggered. Record the event, then attempt the push. */
  const copy = eventCopy(row, evaluation, row.alert?.lang || 'fa');
  const event = {
    at: now,
    kind: ['WHALE', 'SMART_MONEY_NET', 'EXCHANGE_FLOW'].includes(row.metric)
      ? 'SMART_MONEY'
      : row.metric === 'VOLUME'
        ? 'VOLUME'
        : row.metric === 'OPPORTUNITY'
          ? 'OPPORTUNITY'
          : 'PRICE',
    metric: row.metric,
    value: evaluation.display,
    threshold: row.threshold,
    message: copy.body,
    sent: false,
    pushError: null
  };
  let sent = false;
  if (row.alert?.endpoint && send) {
    try {
      sent = Boolean(await send({
        endpoint: row.alert.endpoint,
        lang: row.alert.lang || 'fa',
        title: copy.title,
        body: copy.body
      })) === true;
      event.sent = sent;
      if (!sent) event.pushError = 'SEND_FAILED';
    } catch (err) {
      event.pushError = String(err?.message || 'SEND_FAILED').slice(0, 120);
    }
  } else {
    event.pushError = 'NO_ENDPOINT';
  }
  const patched = await patchMonitor(row.owner, row.id, {
    ...basePatch,
    status: 'TRIGGERED',
    eventCount: (row.eventCount || 0) + 1,
    lastEvent: event,
    events: [...(Array.isArray(row.events) ? row.events : []), event].slice(-20)
  }, { now });
  return { monitor: patched, evaluation, triggered: true, sent };
}

/**
 * Evaluate every ACTIVE monitor (optionally scoped to one owner).
 * Returns honest per-monitor outcomes; one failing monitor never stops the
 * others — they are settled, not awaited sequentially.
 */
export async function evaluateAllMonitors({
  owner = null,
  fetchPrices = null,
  send = null,
  now = Date.now()
} = {}) {
  const all = await readMonitors();
  const rows = all.filter((m) => (owner ? m.owner === owner : true) && m.status === 'ACTIVE');
  const uniqueIds = [...new Set(rows.map((m) => m.asset?.coinId).filter(Boolean))];
  let prices = null;
  if (uniqueIds.length) {
    try {
      if (!fetchPrices) {
        const { fetchSimplePrices } = await import('./providers.js');
        fetchPrices = fetchSimplePrices;
      }
      prices = await fetchPrices(uniqueIds);
    } catch (err) {
      return {
        checked: rows.length,
        triggered: 0,
        sent: 0,
        error: 'PRICES_UNAVAILABLE',
        detail: String(err?.message || '').slice(0, 120),
        results: []
      };
    }
  }
  const results = await Promise.allSettled(
    rows.map((row) => evaluateMonitor(row, { prices, send, now }))
  );
  const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : { error: String(r.reason || 'EVAL_FAILED') }));
  return {
    checked: rows.length,
    triggered: outcomes.filter((o) => o?.triggered).length,
    sent: outcomes.filter((o) => o?.sent).length,
    errored: outcomes.filter((o) => o?.error && !o?.triggered).length,
    results: outcomes,
    at: now
  };
}

/** Engine health / status read for the Status page and /monitor-status. */
export async function monitorEngineStatus({ now = Date.now() } = {}) {
  const all = await readMonitors().catch(() => []);
  const byStatus = all.reduce((acc, m) => {
    const s = m.status || 'UNKNOWN';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  /* "Active" in the Operations/Status strip means a monitor that is still
     armed and watching: ACTIVE (ready), PAUSED (user-held) and TRIGGERED
     (condition matched but still a live record). Counting only `ACTIVE` made
     the summary disagree with History's monitoring tab, which uses all three
     — one panel said 4/8 where the other showed 8. */
  const live = (byStatus.ACTIVE || 0) + (byStatus.PAUSED || 0) + (byStatus.TRIGGERED || 0);
  return {
    ok: true,
    schema: MONITOR_SCHEMA,
    total: all.length,
    byStatus,
    active: live,
    triggered: byStatus.TRIGGERED || 0,
    paused: byStatus.PAUSED || 0,
    lastCheckAt: all.reduce((max, m) => Math.max(max, m.lastCheckAt || 0), 0) || null,
    durable: storeDurable(),
    cronSecretSet: Boolean(process.env.CRON_SECRET),
    now
  };
}
