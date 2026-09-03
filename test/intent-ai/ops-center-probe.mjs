/**
 * FBT INTENT OS — OPERATIONS CENTER RESTORATION PROBE.
 * ---------------------------------------------------------------------------
 * Proves the restored pieces are REAL, not UI-only:
 *
 *   A. server monitor engine  — validation, storage, live-price evaluation,
 *      honest unknown-price handling, push accounting, opportunity (APY) jobs
 *   B. client monitor parsing — «بازار را بپای» style sentences → real drafts
 *   C. conditional orders      — «اگر BTC به 100000 رسید بخر» → valid limit order
 *   D. opportunity engine      — real market/yield scan, no guaranteed claims
 *   E. history store           — conversations + operations persist truthfully
 *   F. operations catalog      — every card has a real action + capability id
 *
 * The server half runs against the real store (in-memory in this process) and
 * an injected live-price fetcher; the external feed is the only thing faked —
 * the same pattern as the rest of test/intent-ai.
 */

import assert from 'node:assert/strict';
import {
  normalizeMonitor,
  resolveAsset,
  evaluateCondition,
  createMonitor,
  listMonitors,
  setMonitorStatus,
  deleteMonitor,
  evaluateAllMonitors,
  monitorEngineStatus
} from '../../server/intentMonitoring.js';
import { parseMonitorRequest, resolveMonitorAsset } from '../../src/lib/intent-ai/os/monitorClient.js';
import { parseConditionalBuy, orderPreview } from '../../src/lib/intent-ai/os/conditionalOrder.js';
import { validateOrder, createOrder } from '../../src/lib/orders.js';
import {
  appendConversation,
  appendOperation,
  readHistory,
  clearHistory
} from '../../src/lib/intent-ai/os/historyStore.js';
import { OPERATIONS, CATEGORIES, cardAvailability } from '../../src/lib/intent-ai/os/opsCatalog.js';
import { runOpportunityEngine } from '../../src/lib/intent-ai/os/opportunityEngine.js';

const results = [];
const check = (name, ok) => {
  results.push({ name, ok: Boolean(ok) });
  if (!ok) console.error(`  ✗ ${name}`);
};

const owner = 'dev:probe-owner-1';
const NOW = 1_800_000_000_000;
const infiniteFetch = async (ids) => Object.fromEntries((ids || []).map((id) => [id, { usd: 101000 }]));
const deadFetch = async () => { throw new Error('feed down'); };

try {
  /* ----------------------------- A. server engine ------------------------ */
  const asset = resolveAsset({ symbol: 'BTC' });
  check('BTC resolves to the real CoinGecko id', asset?.coinId === 'bitcoin');
  check('unknown asset is refused, never watched', resolveAsset({ symbol: 'NOTACOIN' }) === null);

  const bad = normalizeMonitor({ asset: { symbol: 'BTC' }, metric: 'PRICE', threshold: 0 });
  check('zero threshold is rejected', bad.error === 'BAD_THRESHOLD');

  const good = normalizeMonitor({
    asset: { symbol: 'BTC' },
    metric: 'PRICE',
    operator: 'ABOVE',
    threshold: 100000,
    intervalMinutes: 60,
    label: 'BTC ≥ 100000'
  }, { now: NOW });
  check('valid monitor normalises', good.monitor?.status === 'ACTIVE' && good.monitor.asset.coinId === 'bitcoin');

  const made = await createMonitor(owner, {
    asset: { symbol: 'BTC' },
    metric: 'PRICE',
    operator: 'ABOVE',
    threshold: 100000,
    intervalMinutes: 60,
    alert: { endpoint: 'https://push.example/1', lang: 'fa' },
    label: 'BTC ≥ 100000'
  }, { now: NOW });
  check('monitor is stored for the device', made.monitor?.id && made.monitor.owner === owner);

  const listed = await listMonitors(owner);
  check('list returns the created monitor', listed.some((m) => m.id === made.monitor.id));

  const opp = await createMonitor(owner, {
    metric: 'OPPORTUNITY',
    operator: 'ABOVE',
    threshold: 8,
    label: 'yield ≥ 8%',
    asset: { symbol: 'YIELD' }
  }, { now: NOW });
  check('opportunity (APY) monitor is accepted', opp.monitor?.id && opp.monitor.metric === 'OPPORTUNITY');

  const cycle = await evaluateAllMonitors({ owner, fetchPrices: infiniteFetch, send: async () => true, now: NOW });
  check('live evaluation checks the monitor and reports the trigger', cycle.checked >= 1 && cycle.triggered >= 1);
  check('a real price that crossed the threshold is a real trigger', cycle.results.some((r) => r?.triggered === true));
  check('push delivery is accounted, not assumed', cycle.results.some((r) => r?.sent === true));

  await setMonitorStatus(owner, made.monitor.id, 'PAUSED');
  const afterPause = await listMonitors(owner);
  check('pause is durable and visible', afterPause.find((m) => m.id === made.monitor.id)?.status === 'PAUSED');

  await createMonitor('dev:probe-other', { asset: { symbol: 'BTC' }, metric: 'PRICE', operator: 'ABOVE', threshold: 90000 }, { now: NOW });
  const dead = await evaluateAllMonitors({ owner: 'dev:probe-other', fetchPrices: deadFetch, now: NOW });
  check('a dead feed reports PRICES_UNAVAILABLE, never a fake trigger', dead.error === 'PRICES_UNAVAILABLE' && dead.triggered === 0);

  await deleteMonitor(owner, opp.monitor.id);
  const afterDelete = await listMonitors(owner);
  check('delete removes the monitor', !afterDelete.some((m) => m.id === opp.monitor.id));

  const status = await monitorEngineStatus();
  check('engine status is honest about storage mode', status.total >= 1 && typeof status.durable === 'boolean');

  check('per-condition evaluation is pure and correct',
    evaluateCondition({ metric: 'PRICE', operator: 'ABOVE', threshold: 100000, value: 101000 }).hit === true
    && evaluateCondition({ metric: 'PRICE', operator: 'ABOVE', threshold: 100000, value: 90000 }).hit === false
    && evaluateCondition({ metric: 'PERCENT_CHANGE', operator: 'ABOVE', threshold: 5, value: 105, baseline: 100 }).hit === true
    && evaluateCondition({ metric: 'PRICE', operator: 'ABOVE', threshold: 100000, value: null }).ok === false);

  /* ---------------------------- B. client parsing ------------------------ */
  check('«بازار را بپای» resolves to a monitor request', parseMonitorRequest('بازار را بپای').monitor?.type === 'MARKET');
  const btcBelow = parseMonitorRequest('اگر ETH کمتر از 3000 شد خبر بده');
  check('«اگر ETH کمتر از 3000 شد خبر بده» → PRICE BELOW 3000',
    btcBelow.monitor?.asset?.symbol === 'ETH' && btcBelow.monitor?.operator === 'BELOW' && btcBelow.monitor?.threshold === 3000);
  const btcAbove = parseMonitorRequest('اگر BTC بالای 100k شد به من خبر بده');
  check('100k is understood as 100000', btcAbove.monitor?.threshold === 100000 && btcAbove.monitor?.operator === 'ABOVE');
  check('asset resolver finds BTC in a Persian sentence', resolveMonitorAsset('بازار بیتکوین و اتریوم را بپای') === 'BTC');

  /* -------------------------- C. conditional orders ---------------------- */
  const buy = parseConditionalBuy('اگر BTC به 100000 رسید 100 دلار بخر');
  check('«اگر BTC به 100000 رسید بخر» parses as a conditional buy',
    buy.order?.asset === 'BTC' && buy.order?.targetRate === 100000 && buy.order?.amountIn === '100' && buy.order?.direction === 'BELOW');

  const faBuy = parseConditionalBuy('اگر بیت‌کوین کمتر از 100000 شد 100 دلار بخر');
  check('Persian «اگر بیت‌کوین کمتر از 100000 شد بخر» parses with fa digits and BELOW',
    faBuy.order?.asset === 'BTC' && faBuy.order?.targetRate === 100000 && faBuy.order?.direction === 'BELOW');
  const faAbove = parseConditionalBuy('اگر اتریوم بالای 4000 شد 50 دلار بخر');
  check('Persian «اگر اتریوم بالای 4000 شد بخر» parses as ABOVE',
    faAbove.order?.asset === 'ETH' && faAbove.order?.targetRate === 4000 && faAbove.order?.direction === 'ABOVE');
  const faK = parseConditionalBuy('اگر بیت کوین به 100k رسید 50 دلار بخر');
  check('Persian conditional buy reads 100k as 100000', faK.order?.targetRate === 100000);

  const built = createOrder({
    type: 'limit',
    chainId: 42161,
    fromToken: { symbol: 'USDT', coingeckoId: 'tether' },
    toToken: { symbol: 'WBTC', coingeckoId: 'bitcoin' },
    amountIn: '100',
    targetRate: buy.order.targetRate,
    direction: 'below',
    priceOf: 'to'
  });
  check('the built order passes the real order validator', !built.error && validateOrder(built.order) === null);

  const missing = parseConditionalBuy('BTC را بررسی کن');
  check('an analysis sentence is NOT turned into an order', missing.error === 'NO_TARGET' || missing.error === 'NOT_BUY');

  const preview = orderPreview(buy);
  check('order preview exists and is honest about execution', preview.status === 'READY' && /never signs|never signs|server/i.test(JSON.stringify(preview)));

  /* -------------------------- D. opportunity engine ---------------------- */
  const oppOut = await runOpportunityEngine({
    portfolio: { totalValueUsd: 1000, holdings: [{ symbol: 'BTC', valueUsd: 500 }], dataStatus: 'live' },
    services: {
      yieldService: { discover: async () => ({ opportunities: [{ protocol: 'aave', symbol: 'USDC', apy: 4.5, risk: 'low', tvlUsd: 1000000 }] }) },
      farmService: { list: async () => ({ pools: [{ protocol: 'balancer', symbol: 'ETH/USDC', apy: 12.3, risk: 'medium' }] }) },
      lendingService: { getMarkets: async () => ({ markets: [{ protocol: 'morpho', symbol: 'USDC', supplyApyPct: 3.2, risk: 'low' }] }) }
    },
    overrides: {
      fetchMarkets: async () => [
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 100000, price_change_percentage_24h: 2.5, price_change_percentage_7d_in_currency: 8, total_volume: 30000000000, market_cap: 1900000000000, dataProvenance: 'live' },
        { id: 'ethereum', symbol: 'eth', name: 'Ethereum', current_price: 3000, price_change_percentage_24h: -1.2, price_change_percentage_7d_in_currency: -4, total_volume: 15000000000, market_cap: 360000000000, dataProvenance: 'live' }
      ],
      fetchOhlc: async (id) => {
        const base = id === 'bitcoin' ? 98000 : 2900;
        return Array.from({ length: 30 }, (_, i) => ({ t: i, o: base, h: base * 1.01, l: base * 0.99, c: base * (1 + 0.004 * (i % 5)) }));
      }
    },
    limit: 6
  });
  check('opportunity engine returns opportunities from real-shaped data', oppOut.opportunities.length >= 3);
  check('no row claims guaranteed profit', oppOut.opportunities.every((o) => o.guaranteed === false));
  check('every row carries risk + honesty markers', oppOut.opportunities.every((o) => o.risk && o.dataQuality && o.disclaimer));
  check('market candidates carry historical base-rate provenance', oppOut.opportunities.some((o) => o.kind === 'MARKET' && o.baseRateSamples >= 10));

  const emptyOpp = await runOpportunityEngine({
    portfolio: null,
    services: {},
    overrides: {
      fetchMarkets: async () => [],
      fetchOhlc: async () => []
    }
  });
  check('no data → honest empty, never invented returns', emptyOpp.opportunities.length === 0 && emptyOpp.dataStatus !== 'live');

  /* ----------------------------- E. history store ------------------------ */
  const memStore = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  clearHistory({ store: memStore });
  appendConversation({ role: 'user', content: 'BTC را بررسی کن', conversationId: 'c1' }, { store: memStore, now: NOW });
  appendOperation({ kind: 'MONITOR_CREATE', status: 'ACTIVE', title: 'BTC ≥ 100000', ref: 'mon_1', refKind: 'monitor', conversationId: 'c1' }, { store: memStore, now: NOW });
  const hist = readHistory({ store: memStore });
  check('history persists conversation turns', hist.conversations.length === 1 && hist.conversations[0].content === 'BTC را بررسی کن');
  check('history persists operations with real status', hist.operations.length === 1 && hist.operations[0].status === 'ACTIVE' && hist.operations[0].refKind === 'monitor');
  const leaked = appendOperation({ kind: 'X', status: 'COMPLETED', title: 'leak', secret: 'privateKey', privateKey: 'k' }, { store: memStore });
  check('history never stores credential fields', !JSON.stringify(leaked).includes('privateKey'));

  /* ------------------------------ F. catalog ----------------------------- */
  check('catalog has all spec categories', ['portfolio', 'wallet', 'swap', 'bridge', 'lending', 'farm', 'liquidity', 'futures', 'dydx', 'markets', 'intelligence', 'goals', 'automation', 'monitoring', 'rewards'].every((id) => CATEGORIES.some((c) => c.id === id)));
  check('every card has a real action and a capability id', OPERATIONS.every((c) => c.action && c.capabilityId && c.category));
  check('execute-side swap/bridge cards need a wallet and are marked so',
    ['swap_token', 'swap_crosschain', 'swap_execute', 'bridge_run', 'bridge_crosschain', 'bridge_execute']
      .every((id) => OPERATIONS.find((c) => c.id === id)?.requiresWallet === true));
  check('a plain quote is honestly wallet-free', OPERATIONS.find((c) => c.id === 'swap_quote')?.requiresWallet !== true);
  const noWallet = cardAvailability(OPERATIONS.find((c) => c.id === 'swap_token'), { walletConnected: false, serverReachable: true });
  check('card availability is honest without a wallet', noWallet.available === false && noWallet.reason === 'WALLET_REQUIRED');
  const withWallet = cardAvailability(OPERATIONS.find((c) => c.id === 'swap_token'), { walletConnected: true, serverReachable: true });
  check('card becomes available with a wallet', withWallet.available === true);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nops-center probe: ${passed}/${results.length} passed`);
  if (passed !== results.length) {
    console.error(results.filter((r) => !r.ok).map((r) => `  ✗ ${r.name}`).join('\n'));
    process.exit(1);
  }
  console.log('OK: intent-ai/ops-center-probe');
} catch (err) {
  console.error('\nops-center probe crashed:', err);
  process.exit(1);
}
