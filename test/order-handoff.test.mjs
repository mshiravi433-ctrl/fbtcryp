import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findExecutableOrder, orderSwapParams } from '../src/lib/orderHandoff.js';
import { buildStageAlert } from '../server/orderAlerts.js';

const imported = '0x1234567890123456789012345678901234567890';
const curated = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const order = { id: 'a/b ?&', status: 'active', chainId: 1, amountIn: '2.5',
  fromToken: { symbol: 'CUSTOM', address: imported },
  toToken: { symbol: 'USD', address: curated } };

test('execute selects only the matching active persisted order, including numeric ids', () => {
  assert.equal(findExecutableOrder([], order.id), null);
  assert.equal(findExecutableOrder([order], order.id), order);
  assert.equal(findExecutableOrder([order], 'missing'), null);
  assert.equal(findExecutableOrder([order], null), null);
  for (const status of ['paused', 'closed', 'cancelled', 'expired']) {
    assert.equal(findExecutableOrder([{ ...order, status }], order.id), null);
  }
  const numeric = { ...order, id: 42 };
  assert.equal(findExecutableOrder([numeric], '42'), numeric);
});

test('swap handoff preserves amount, chain, id and imported token addresses', () => {
  const params = orderSwapParams(order, [{ address: curated.toUpperCase() }]);
  assert.equal(params.get('fromAddress'), imported);
  assert.equal(params.has('toAddress'), false);
  assert.equal(params.get('fromOrder'), order.id);
  assert.equal(params.get('amount'), '2.5');
  assert.equal(params.get('chain'), '1');
  assert.equal(params.get('from'), 'CUSTOM');
  assert.equal(params.get('to'), 'USD');
  const both = orderSwapParams(order);
  assert.equal(both.get('toAddress'), curated);
  assert.equal(new URLSearchParams(both.toString()).get('fromOrder'), order.id);
  for (const address of [undefined, 'native', '0x1234', `0x${'g'.repeat(40)}`]) {
    assert.equal(orderSwapParams({ ...order, fromToken: { symbol: 'ETH', address } }).has('fromAddress'), false);
  }
});

test('only ready order alerts with real ids link to execute; copy/styles remain intact', () => {
  assert.equal(buildStageAlert({ stage: 'ready', id: order.id }).url,
    `/#/orders?execute=${encodeURIComponent(order.id)}`);
  for (const id of ['x', '', null, undefined]) {
    assert.equal(buildStageAlert({ stage: 'ready', id }).url, '/#/orders');
  }
  for (const stage of ['pending', 'closed']) {
    assert.equal(buildStageAlert({ stage, id: order.id }).url, '/#/orders');
  }
  assert.equal(buildStageAlert({ stage: 'ready', kind: 'intent', id: order.id }).url.includes('execute='), false);
});

test('native route allowlist preserves hash queries and rejects external origins', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../src/lib/notify.js', import.meta.url), 'utf8');
  const start = source.indexOf('const NATIVE_ROUTES =');
  const end = source.indexOf('async function sendNativeToken', start);
  const route = runInNewContext(`${source.slice(start, end)}; safeNativeRoute`, { URL });
  for (const value of ['/#/orders?execute=a%2Fb', '/#/swap?fromAddress=0x123&fromOrder=42', '/orders?execute=42']) {
    assert.equal(route(value), value.replace('/#', ''));
  }
  assert.equal(route('https://evil.example/#/orders?execute=42'), null);
  assert.equal(route('/#/settings?execute=42'), null);
});

test('service worker quick action preserves full hash query for existing and new windows', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const notices = [];
  const navigated = [];
  const opened = [];
  let windows = [];
  const self = {
    location: { origin: 'https://fbtswap.app' },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { showNotification: async (title, options) => { notices.push(options); } },
    clients: { matchAll: async () => windows, openWindow: async (url) => { opened.push(url); } }
  };
  runInNewContext(source.slice(source.indexOf('const RTL_LANGS =')), { self, URL });
  let pending;
  const waitUntil = (promise) => { pending = promise; };
  handlers.push({ data: { json: () => ({ stage: 'ready', lang: 'fa', url: '/#/orders?execute=a%2Fb' }) }, waitUntil });
  await pending;
  assert.equal(notices[0].actions[0].action, 'execute');
  assert.equal(notices[0].actions[0].title, '⚡ سواپ و امضا');
  const click = { action: 'execute', notification: { close() {}, data: notices[0].data }, waitUntil };
  handlers.notificationclick(click);
  await pending;
  assert.equal(opened[0], 'https://fbtswap.app/#/orders?execute=a%2Fb');
  windows = [{ navigate: async (url) => { navigated.push(url); }, focus: async () => {} }];
  handlers.notificationclick(click);
  await pending;
  assert.equal(navigated[0], opened[0]);
  handlers.push({ data: { json: () => ({ stage: 'closed' }) }, waitUntil });
  await pending;
  assert.equal(notices[1].actions, undefined);
});
