/**
 * «فعلاً پاسخ‌گویی هوش مصنوعی در دسترس نیست» — the turn that never started.
 * ---------------------------------------------------------------------------
 * Reported on production: every chat message the local OS handed to the
 * server, and every intent that needed a confirmation card, failed at once —
 * while each provider probe was green and every hand-written request worked.
 *
 * The request the REAL screen sends was the difference. Its context object
 * carried a 250-row market feed with sparklines (kept for the in-browser
 * portfolio card): 300 KB+ of JSON against a 256 KB parser. The answer was a
 * 413 HTML page, which the client could only call INVALID_RESPONSE.
 *
 * So these tests are built on a body shaped like the screen's, not on a
 * convenient small one — a small body is exactly how this passed before.
 *
 *   A · the wire encoder (what leaves the browser)
 *   B · the client (what it sends, and how it names a refusal)
 *   C · the server: size, budgets, JSON errors, the guarded turn, evidence
 *   D · the same contract through real Express middleware, over HTTP
 *   E · wiring probes — the three mounts that make any of it true
 *   F · when the server was asked and could not answer: what is still said
 *
 * Offline: no provider, no key, no network beyond a loopback listener.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';

import {
  MAX_AI_BODY_BYTES,
  utf8ByteLength,
  compactWireContext,
  encodeWireBody
} from '../../src/lib/aiWireContext.js';
import { aiChat, aiContext, aiExecute } from '../../src/lib/aiIntentClient.js';
import { centralIngest } from '../../src/lib/centralClient.js';
import { offlineSocialFallback, unreachableSocialFallback } from '../../src/lib/intent-ai/chat/socialChat.js';
import {
  AI_JSON_BODY_LIMIT,
  AI_CONTEXT_BODY_PATHS,
  slimAiRequestBody,
  slimAiRequestMiddleware,
  createWindowLimiter,
  aiWriteClass,
  aiCallerIdentity,
  aiWriteBudgets,
  createAiWriteLimiter,
  describeApiError,
  createApiErrorHandler,
  summarizeChatReply,
  recordChatTurn,
  recordTransportEvent,
  chatTurnSnapshot,
  guardChatTurn,
  __resetChatTurnLog
} from '../../server/aiChatHardening.js';

const WALLET = '0x000000000000000000000000000000000000dEaD';

/** One market row as the screen keeps it: a week of hourly prices attached. */
const marketRow = (i) => ({
  id: `coin-${i}`,
  symbol: `C${i}`,
  name: `Coin ${i}`,
  image: `https://coin-images.coingecko.com/coins/images/${i}/large/coin.png`,
  price: 100 + i,
  change1h: 0.21,
  change24h: -1.24,
  change7d: 3.81,
  mcap: 2.07e12,
  volume: 4.1e10,
  rank: i + 1,
  sparkline: Array.from({ length: 168 }, (_, k) => 100 + Math.sin(k / 9) * 3.14159265358979 + i)
});

const balanceRow = (i, valueUsd) => ({
  symbol: `T${i}`,
  name: `Token number ${i}`,
  chain: 1,
  chainId: 1,
  amount: valueUsd > 0 ? valueUsd / 3 : 0,
  valueUsd,
  priceUsd: 3,
  priceProvenance: 'live',
  balanceFreshness: 'live',
  decimals: 18,
  address: `0x${String(i).padStart(40, '0')}`,
  logoURI: `https://assets.example/tokens/${i}.png`,
  sparkline: Array.from({ length: 48 }, (_, k) => k + i)
});

/** The context object as `IntentAIUnified` builds it once the market feed loads. */
function screenContext({ balances = 12, market = 250 } = {}) {
  const rows = Array.from({ length: balances }, (_, i) => balanceRow(i, (i % 3 === 0 ? 0 : 10 + i)));
  return {
    wallet: { connected: true, canSign: true, address: WALLET, evmAddresses: [WALLET], solanaAddresses: [], chainId: 1 },
    portfolio: {
      dataStatus: 'live',
      totalValueUsd: 15234.5,
      pnlUsd: 120.4,
      change24hPct: -1.2,
      holdings: rows.map((r) => ({ symbol: r.symbol, chainId: 1, valueUsd: r.valueUsd, amount: r.amount })),
      failedChains: [],
      marketRows: Array.from({ length: market }, (_, i) => marketRow(i))
    },
    balances: rows,
    openOrders: [],
    positions: [],
    activeIntents: [],
    recentActivity: [],
    currentPage: '/intent',
    selectedAsset: 'ETH',
    conversationSummary: 'کاربر دربارهٔ اتریوم پرسید.'
  };
}

const chatBody = (context = screenContext(), extra = {}) => ({
  locale: 'fa',
  message: 'یه جوک بگو',
  messages: [
    { role: 'user', content: 'سلام' },
    { role: 'ai', content: 'سلام! چه کمکی از من برمی‌آید؟' }
  ],
  surface: '/intent',
  conversationId: 'conv-test-1',
  context,
  intelligence: 'max',
  ...extra
});

const bytesOf = (value) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));

/* ── A. the wire encoder ───────────────────────────────────────────────────── */

test('A1 · the screen-shaped body is over the old 256 KB parser limit — the reported failure', () => {
  const raw = bytesOf(chatBody());
  assert.ok(raw > 256 * 1024, `expected the unencoded body to exceed 256 KB, got ${raw}`);
});

test('A2 · the encoded body fits the budget and drops only what the server never read', () => {
  const body = chatBody();
  const wire = encodeWireBody(body);
  assert.equal(wire.rung, 0);
  assert.ok(wire.bytes <= MAX_AI_BODY_BYTES);
  assert.ok(wire.bytes < 64 * 1024, `expected a small envelope, got ${wire.bytes}`);
  assert.equal(wire.bytes, bytesOf(wire.text));
  const sent = JSON.parse(wire.text);
  assert.equal(sent.message, 'یه جوک بگو');
  assert.equal(sent.messages.length, 2);
  assert.equal(sent.intelligence, 'max');
  assert.equal(sent.context.portfolio.marketRows, undefined);
  /* What the server's sanitizers DO read is all still there. */
  assert.deepEqual(sent.context.wallet, body.context.wallet);
  assert.equal(sent.context.portfolio.totalValueUsd, 15234.5);
  assert.equal(sent.context.portfolio.pnlUsd, 120.4);
  assert.equal(sent.context.portfolio.holdings.length, 12);
  assert.equal(sent.context.balances.length, 12);
  assert.equal(sent.context.balances[1].priceProvenance, 'live');
  assert.equal(sent.context.balances[1].address, body.context.balances[1].address);
  assert.equal(sent.context.currentPage, '/intent');
  assert.equal(sent.context.selectedAsset, 'ETH');
  /* Per-row series and decorations are not facts about a balance. */
  assert.equal(sent.context.balances[0].sparkline, undefined);
  assert.equal(sent.context.balances[0].logoURI, undefined);
});

test('A3 · encoding never mutates the object the in-browser OS keeps reading', () => {
  const body = chatBody();
  const before = structuredClone(body);
  encodeWireBody(body);
  encodeWireBody(body, { maxBytes: 2000 });
  assert.deepEqual(body, before);
  assert.equal(body.context.portfolio.marketRows.length, 250);
  assert.equal(body.context.portfolio.marketRows[0].sparkline.length, 168);
});

test('A4 · a body with nothing to drop is byte-identical to JSON.stringify', () => {
  const small = { locale: 'fa', message: 'سلام', context: { wallet: null, portfolio: null, balances: [] }, messages: [] };
  assert.equal(encodeWireBody(small).text, JSON.stringify(small));
  const execute = { action: { type: 'SWAP', amount: '10' }, plan: { steps: [{ id: 1 }] }, intentId: 'int_1' };
  assert.equal(encodeWireBody(execute).text, JSON.stringify(execute));
  assert.equal(encodeWireBody(null).text, undefined);
});

test('A5 · more rows than any server reader takes: the valuable ones travel, most valuable first', () => {
  const context = screenContext({ balances: 300 });
  /* The largest holding sits LAST — a plain slice(0, 80) would lose it. */
  context.balances[299] = balanceRow(299, 987654);
  context.portfolio.holdings[299] = { symbol: 'T299', chainId: 1, valueUsd: 987654, amount: 1 };
  const sent = JSON.parse(encodeWireBody(chatBody(context)).text);
  /* 120 = the widest reader (the central state store); the chat sanitizers
     read the first 80 of these, which are the 80 most valuable. */
  assert.equal(sent.context.balances.length, 120);
  assert.equal(sent.context.portfolio.holdings.length, 120);
  assert.equal(sent.context.balances[0].symbol, 'T299');
  assert.equal(sent.context.portfolio.holdings[0].symbol, 'T299');
  assert.ok(sent.context.balances.every((row) => row.valueUsd > 0), 'zero rows must not displace held ones');
  for (let i = 1; i < sent.context.balances.length; i += 1) {
    assert.ok(sent.context.balances[i - 1].valueUsd >= sent.context.balances[i].valueUsd, 'a cut list is ordered by value');
  }
});

test('A5b · a list no reader would cut is sent whole and in the order the screen keeps it', () => {
  const context = screenContext({ balances: 100 });
  const sent = JSON.parse(encodeWireBody(chatBody(context)).text);
  assert.equal(sent.context.balances.length, 100);
  assert.deepEqual(sent.context.balances.map((r) => r.symbol), context.balances.map((r) => r.symbol));
  assert.equal(sent.context.portfolio.holdings.length, 100);
  /* `tokens` is the other name the central readers accept for holdings. */
  const alt = screenContext({ balances: 4 });
  alt.portfolio.tokens = Array.from({ length: 200 }, (_, i) => ({ symbol: `K${i}`, valueUsd: i }));
  const tokens = JSON.parse(encodeWireBody(chatBody(alt)).text).context.portfolio.tokens;
  assert.equal(tokens.length, 120);
  assert.equal(tokens[0].symbol, 'K199');
});

test('A5c · only a SERIES is left behind: a short list or an object under a chart-like name is data', () => {
  const context = screenContext({ balances: 3 });
  const long = Array.from({ length: 40 }, (_, i) => i);
  context.portfolio.history = [{ at: 1, valueUsd: 10 }, { at: 2, valueUsd: 12 }];
  context.portfolio.chart = { range: '7d', points: 2 };
  context.portfolio.candles = long;
  context.history = ['swap', 'bridge'];
  context.markets = long;
  context.activeAutomations = [{ id: 'a1', type: 'DCA', history: [{ at: 1, ok: true }], runs: long }];
  const sent = JSON.parse(encodeWireBody(chatBody(context)).text).context;
  assert.deepEqual(sent.portfolio.history, context.portfolio.history);
  assert.deepEqual(sent.portfolio.chart, context.portfolio.chart);
  assert.equal(sent.portfolio.candles, undefined, 'a 40-point series under portfolio is a chart');
  assert.deepEqual(sent.history, ['swap', 'bridge']);
  assert.equal(sent.markets, undefined, 'a 40-row feed at the top of the context is a chart');
  assert.deepEqual(sent.activeAutomations[0].history, [{ at: 1, ok: true }], 'a row keeps its short lists');
  assert.equal(sent.activeAutomations[0].runs, undefined, 'a row loses a series');
  assert.equal(sent.portfolio.marketRows, undefined);
});

test('A5d · a body that is not a context is never rewritten, whatever its keys are called', () => {
  /* The shape POST /api/v1/ai/neuromorphic/infer reads. */
  const infer = {
    candles: Array.from({ length: 120 }, (_, i) => ({ t: i, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 })),
    markets: Array.from({ length: 100 }, (_, i) => ({ symbol: `M${i}`, change24h: i / 10 })),
    pulse: { fearGreed: 44 }
  };
  assert.equal(encodeWireBody(infer).text, JSON.stringify(infer));
  const automation = { type: 'DCA', asset: 'BTC', amount: '100', frequency: 'WEEKLY', history: Array.from({ length: 30 }, (_, i) => i) };
  assert.equal(encodeWireBody(automation).text, JSON.stringify(automation));
});

test('A6 · the ladder: whatever the budget, the turn still carries the message and the wallet', () => {
  const body = chatBody(screenContext({ balances: 300 }), {
    messages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', content: 'متن طولانی '.repeat(120) }))
  });
  let lastRung = -1;
  for (const maxBytes of [150_000, 30_000, 12_000, 3_000]) {
    const wire = encodeWireBody(body, { maxBytes });
    assert.ok(wire.bytes <= maxBytes, `budget ${maxBytes}: got ${wire.bytes} at rung ${wire.rung}`);
    assert.ok(wire.rung >= lastRung, 'a tighter budget never climbs back up the ladder');
    lastRung = wire.rung;
    const sent = JSON.parse(wire.text);
    assert.equal(sent.message, 'یه جوک بگو');
    assert.equal(sent.context.wallet.address, WALLET);
    assert.equal(sent.context.currentPage, '/intent');
  }
  assert.ok(lastRung >= 3, 'the tightest budget had to use the last rungs');
});

test('A7 · an execute/confirm body keeps its plan and action at every rung', () => {
  const body = {
    locale: 'fa',
    action: { type: 'SWAP', from: 'USDC', to: 'ETH', amount: '10' },
    plan: { id: 'plan_1', steps: [{ kind: 'approve' }, { kind: 'swap' }] },
    intentId: 'int_abc',
    context: screenContext({ balances: 300 })
  };
  for (const maxBytes of [150_000, 4_000]) {
    const sent = JSON.parse(encodeWireBody(body, { maxBytes }).text);
    assert.deepEqual(sent.action, body.action);
    assert.deepEqual(sent.plan, body.plan);
    assert.equal(sent.intentId, 'int_abc');
    assert.equal(sent.context.wallet.address, WALLET);
  }
});

test('A8 · context fields at the TOP level of the body (/context, /system/state) are compacted too', () => {
  const body = { locale: 'fa', ...screenContext() };
  const wire = encodeWireBody(body);
  const sent = JSON.parse(wire.text);
  assert.ok(wire.bytes < 64 * 1024);
  assert.equal(sent.portfolio.marketRows, undefined);
  assert.equal(sent.balances.length, 12);
  assert.equal(sent.wallet.address, WALLET);
});

test('A9 · size is measured in bytes: Persian is two bytes a letter', () => {
  assert.equal(utf8ByteLength('سلام'), 8);
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength(''), 0);
  assert.equal(utf8ByteLength('😀'), 4);
});

test('A10 · a value that cannot be serialized fails like JSON.stringify did — never as an empty body', () => {
  const cyclic = { message: 'x' };
  cyclic.self = cyclic;
  assert.throws(() => encodeWireBody(cyclic), TypeError);
});

test('A11 · compactWireContext leaves non-objects alone', () => {
  assert.equal(compactWireContext(null), null);
  assert.equal(compactWireContext(undefined), undefined);
  assert.deepEqual(compactWireContext({ wallet: null }), { wallet: null });
});

/* ── B. the client ─────────────────────────────────────────────────────────── */

async function withFetch(impl, run) {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, bytes: init.body ? bytesOf(init.body) : 0 });
    return impl(String(url), init);
  };
  try { return await run(calls); } finally { globalThis.fetch = old; }
}

const okReply = () => new Response(JSON.stringify({ ok: true, reply: { text: 'سلام' } }), { status: 200 });

test('B1 · aiChat posts the screen context in a small envelope', async () => {
  await withFetch(okReply, async (calls) => {
    const context = screenContext();
    const res = await aiChat({ message: 'یه جوک بگو', context, messages: [], intelligence: 'balanced' });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/ai\/chat$/);
    assert.ok(calls[0].bytes < 64 * 1024, `chat body was ${calls[0].bytes} bytes`);
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.message, 'یه جوک بگو');
    assert.equal(sent.context.portfolio.marketRows, undefined);
    assert.equal(sent.context.wallet.address, WALLET);
    /* …and the caller's object still has its feed for the local portfolio card. */
    assert.equal(context.portfolio.marketRows.length, 250);
  });
});

test('B2 · execute, context and the central state push use the same rule', async () => {
  await withFetch(okReply, async (calls) => {
    const context = screenContext();
    await aiExecute({ action: { type: 'SWAP' }, context, intentId: 'int_1' });
    await aiContext(context);
    await centralIngest(context);
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.ok(call.bytes < 64 * 1024, `${call.url} sent ${call.bytes} bytes`);
      assert.doesNotMatch(call.init.body, /sparkline/);
    }
    assert.match(calls[2].url, /\/system\/state$/);
    assert.equal(JSON.parse(calls[0].init.body).action.type, 'SWAP');
  });
});

test('B3 · a size rejection is named, even when the body is a proxy HTML page', async () => {
  await withFetch(() => new Response('<html><body><pre>PayloadTooLargeError</pre></body></html>', { status: 413 }), async () => {
    const res = await aiChat({ message: 'x', intelligence: 'balanced' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 413);
    assert.equal(res.error, 'PAYLOAD_TOO_LARGE');
  });
  /* Any other unreadable body keeps the old, anonymous code. */
  await withFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }), async () => {
    const res = await aiChat({ message: 'x', intelligence: 'balanced' });
    assert.equal(res.error, 'INVALID_RESPONSE');
    assert.equal(res.status, 502);
  });
});

test('B4 · a rate refusal carries how long to wait', async () => {
  const refusal = (headers) => new Response(JSON.stringify({ ok: false, error: 'AI_RATE_LIMITED', retryAfterSec: 41 }), { status: 429, headers });
  await withFetch(() => refusal({ 'retry-after': '7' }), async () => {
    const res = await aiChat({ message: 'x', intelligence: 'balanced' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.equal(res.error, 'AI_RATE_LIMITED');
    assert.equal(res.retryAfterSec, 7, 'the header is the transport truth');
  });
  await withFetch(() => refusal({}), async () => {
    const res = await aiChat({ message: 'x', intelligence: 'balanced' });
    assert.equal(res.retryAfterSec, 41, 'without a header the body value stands');
  });
  /* An older server: bare 429, nothing to read — no invented number. */
  await withFetch(() => new Response(JSON.stringify({ error: 'AI_RATE_LIMITED' }), { status: 429 }), async () => {
    const res = await aiChat({ message: 'x', intelligence: 'balanced' });
    assert.equal(res.status, 429);
    assert.equal(res.retryAfterSec, undefined);
  });
});

test('B5 · the retry after a size rejection can ask for a smaller envelope', async () => {
  await withFetch(okReply, async (calls) => {
    const context = screenContext({ balances: 300 });
    await aiChat({ message: 'یه جوک بگو', context, intelligence: 'balanced' });
    await aiChat({ message: 'یه جوک بگو', context, intelligence: 'balanced', maxBodyBytes: 12_000 });
    assert.ok(calls[1].bytes <= 12_000, `tight retry sent ${calls[1].bytes} bytes`);
    assert.ok(calls[1].bytes < calls[0].bytes);
    const sent = JSON.parse(calls[1].init.body);
    assert.equal(sent.message, 'یه جوک بگو');
    assert.equal(sent.context.wallet.address, WALLET);
  });
});

/* ── C. the server ─────────────────────────────────────────────────────────── */

test('C1 · an already-installed client: the feed is accepted, then dropped before anything reads it', () => {
  const body = chatBody();
  const out = slimAiRequestBody(body);
  assert.ok(out.dropped >= 1);
  assert.equal(body.context.portfolio.marketRows, undefined);
  assert.equal(body.context.balances.length, 12, 'measured lists are not the slimmer’s business');
  assert.equal(body.message, 'یه جوک بگو');
  /* Top-level placement (/context, /resume, /system/state). */
  const flat = { ...screenContext() };
  slimAiRequestBody(flat);
  assert.equal(flat.portfolio.marketRows, undefined);
  assert.equal(flat.balances.length, 12);
  /* Never throws on junk. */
  for (const junk of [null, undefined, 'x', 7, [], { context: 'x' }, { context: { portfolio: 5 } }]) {
    assert.doesNotThrow(() => slimAiRequestBody(junk));
  }
});

test('C1b · the slimmer removes ONE key — another route’s input is never a "chart" to it', () => {
  /* POST /api/v1/ai/neuromorphic/infer reads exactly these from its body. */
  const infer = {
    candles: Array.from({ length: 120 }, (_, i) => ({ t: i, c: 100 + i })),
    markets: Array.from({ length: 100 }, (_, i) => ({ symbol: `M${i}` })),
    pulse: { fearGreed: 44 }
  };
  const before = structuredClone(infer);
  assert.deepEqual(slimAiRequestBody(infer), { dropped: 0 });
  assert.deepEqual(infer, before);
  /* The same holds inside a context: long lists under any other name stay. */
  const long = Array.from({ length: 200 }, (_, i) => i);
  const body = {
    history: long.slice(),
    context: { history: long.slice(), markets: long.slice(), portfolio: { history: long.slice(), chart: long.slice(), candles: long.slice(), sparkline: long.slice() } }
  };
  assert.deepEqual(slimAiRequestBody(body), { dropped: 0 });
  assert.equal(body.history.length, 200);
  assert.equal(body.context.history.length, 200);
  assert.equal(body.context.markets.length, 200);
  for (const key of ['history', 'chart', 'candles', 'sparkline']) assert.equal(body.context.portfolio[key].length, 200, key);
  /* All four positions of the one feed. */
  const four = { marketRows: [1], portfolio: { marketRows: [1] }, context: { marketRows: [1], portfolio: { marketRows: [1], totalValueUsd: 5 } } };
  assert.deepEqual(slimAiRequestBody(four), { dropped: 4 });
  assert.deepEqual(four, { portfolio: {}, context: { portfolio: { totalValueUsd: 5 } } });
});

test('C2 · the AI routes accept what installed clients send; the limit is named', () => {
  assert.equal(AI_JSON_BODY_LIMIT, '2mb');
  assert.deepEqual([...AI_CONTEXT_BODY_PATHS], ['/api/v1/ai', '/api/system/state', '/api/intent']);
});

test('C3 · three kinds of write, three budgets', () => {
  assert.equal(aiWriteClass('/learning/record'), 'bookkeeping');
  assert.equal(aiWriteClass('/feedback'), 'bookkeeping');
  assert.equal(aiWriteClass('/execution-result'), 'bookkeeping');
  assert.equal(aiWriteClass('/automations/abc123/result'), 'bookkeeping');
  for (const path of ['/chat', '/execute', '/confirm', '/resume', '/context', '/suggestions', '/chat/']) {
    assert.equal(aiWriteClass(path), 'turn', path);
  }
  for (const path of ['/gateway/chat', '/debate', '/research', '/orchestrator/run', '/benchmark/run', '/chat/stream', '/']) {
    assert.equal(aiWriteClass(path), 'model', path);
  }
  assert.deepEqual(aiWriteBudgets({}), { model: 10, turn: 20, bookkeeping: 40, sharedFactor: 3 });
  /* AI_RATE_LIMIT keeps its meaning for explicit model calls only. */
  assert.deepEqual(aiWriteBudgets({ AI_RATE_LIMIT: '4', AI_TURN_RATE_LIMIT: '30' }), { model: 4, turn: 30, bookkeeping: 40, sharedFactor: 3 });
  assert.deepEqual(aiWriteBudgets({ AI_RATE_LIMIT: 'nonsense', AI_TURN_RATE_LIMIT: '-1' }), { model: 10, turn: 20, bookkeeping: 40, sharedFactor: 3 });
  /* Raising the old single knob still raises everything: no class may be
     tighter than the one budget it replaced (probes run with 100000). */
  assert.deepEqual(aiWriteBudgets({ AI_RATE_LIMIT: '100000' }), { model: 100000, turn: 100000, bookkeeping: 100000, sharedFactor: 3 });
  assert.deepEqual(aiWriteBudgets({ AI_RATE_LIMIT: '50' }), { model: 50, turn: 50, bookkeeping: 50, sharedFactor: 3 });
  /* The `max,windowMs` spelling some deployments use: the first field counts. */
  assert.equal(aiWriteBudgets({ AI_RATE_LIMIT: '100000,60000' }).model, 100000);
});

test('C3b · with the single knob raised, nothing the old limiter allowed is refused', () => {
  const limiter = createAiWriteLimiter({ env: { AI_RATE_LIMIT: '50' } });
  const who = { ip: '203.0.113.33' };
  for (let i = 1; i <= 50; i += 1) assert.equal(hit(limiter, { ...who, path: '/chat' }).passed, true, `turn ${i}`);
  for (let i = 1; i <= 50; i += 1) assert.equal(hit(limiter, { ...who, path: '/learning/record' }).passed, true, `telemetry ${i}`);
  for (let i = 1; i <= 50; i += 1) assert.equal(hit(limiter, { ...who, path: '/gateway/chat' }).passed, true, `model ${i}`);
  assert.equal(hit(limiter, { ...who, path: '/gateway/chat' }).passed, false);
});

const fakeReq = ({ method = 'POST', path = '/chat', ip = '203.0.113.1', device = '', tgUser = null } = {}) => ({
  method,
  path,
  ip,
  tgUser,
  headers: device ? { 'x-fbt-device': device } : {},
  get(name) { return this.headers[String(name).toLowerCase()]; }
});

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    set(key, value) { this.headers[String(key).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; }
  };
}

function hit(limiter, reqInit) {
  const res = fakeRes();
  let passed = false;
  limiter(fakeReq(reqInit), res, () => { passed = true; });
  return { passed, res };
}

test('C4 · who is asking: Telegram identity, then the device, then the address', () => {
  assert.equal(aiCallerIdentity(fakeReq({ tgUser: { id: 42 }, device: 'device-abcdef' })).identity, 'tg:42');
  assert.equal(aiCallerIdentity(fakeReq({ device: 'device-abcdef' })).identity, 'dev:203.0.113.1:device-abcdef');
  assert.equal(aiCallerIdentity(fakeReq({})).identity, 'ip:203.0.113.1');
  /* A malformed device id cannot mint a budget. */
  assert.equal(aiCallerIdentity(fakeReq({ device: 'x' })).identity, 'ip:203.0.113.1');
  assert.equal(aiCallerIdentity(fakeReq({ device: 'a b c d e f g h' })).identity, 'ip:203.0.113.1');
  assert.equal(aiCallerIdentity(fakeReq({ device: 'device-abcdef' }), { useDevice: false }).identity, 'ip:203.0.113.1');
});

test('C5 · telemetry can no longer starve the conversation (the old single budget of 10)', () => {
  const limiter = createAiWriteLimiter({ env: {} });
  const who = { ip: '203.0.113.5', device: 'device-000001' };
  /* The real screen: one telemetry record AND one chat turn per message. Under
     the old shared budget the sixth message's chat was the 11th write → 429. */
  for (let message = 1; message <= 12; message += 1) {
    assert.equal(hit(limiter, { ...who, path: '/learning/record' }).passed, true, `telemetry ${message}`);
    assert.equal(hit(limiter, { ...who, path: '/chat' }).passed, true, `chat ${message}`);
  }
});

test('C6 · a turn budget still exists, and its refusal says when to come back', () => {
  const refused = [];
  const limiter = createAiWriteLimiter({ env: {}, onReject: (info) => refused.push(info) });
  const who = { ip: '203.0.113.6', device: 'device-000002', path: '/chat' };
  for (let i = 1; i <= 20; i += 1) assert.equal(hit(limiter, who).passed, true, `turn ${i}`);
  const { passed, res } = hit(limiter, who);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'AI_RATE_LIMITED');
  assert.equal(res.body.scope, 'turn');
  assert.equal(res.body.retryable, true);
  assert.ok(res.body.retryAfterSec >= 1 && res.body.retryAfterSec <= 60);
  assert.equal(res.headers['retry-after'], String(res.body.retryAfterSec));
  assert.deepEqual(refused.map((r) => [r.cls, r.scope]), [['turn', 'caller']]);
  /* Telemetry from the same person is a different budget and still passes. */
  assert.equal(hit(limiter, { ...who, path: '/learning/record' }).passed, true);
});

test('C7 · two people behind one address are two people; a header-rotating loop is still bounded', () => {
  const limiter = createAiWriteLimiter({ env: {} });
  const ip = '203.0.113.7';
  for (let i = 1; i <= 20; i += 1) assert.equal(hit(limiter, { ip, device: 'device-person-a', path: '/chat' }).passed, true);
  assert.equal(hit(limiter, { ip, device: 'device-person-a', path: '/chat' }).passed, false, 'person A is over their own budget');
  for (let i = 1; i <= 20; i += 1) assert.equal(hit(limiter, { ip, device: 'device-person-b', path: '/chat' }).passed, true, `person B turn ${i}`);
  /* The address ceiling is 3× a personal budget = 60 turns a minute. */
  let passed = 0;
  for (let i = 0; i < 200; i += 1) {
    if (hit(limiter, { ip, device: `device-rotating-${String(i).padStart(4, '0')}`, path: '/chat' }).passed) passed += 1;
  }
  assert.equal(passed, 20, 'only what was left of the address ceiling (60 − 40) got through');
  /* Another address is untouched. */
  assert.equal(hit(limiter, { ip: '203.0.113.8', device: 'device-elsewhere', path: '/chat' }).passed, true);
});

test('C8 · explicit model calls keep the old 10/min, per address, whatever the device header says', () => {
  const limiter = createAiWriteLimiter({ env: {} });
  const ip = '203.0.113.9';
  let passed = 0;
  for (let i = 0; i < 30; i += 1) {
    if (hit(limiter, { ip, device: `device-rotating-${String(i).padStart(4, '0')}`, path: '/gateway/chat' }).passed) passed += 1;
  }
  assert.equal(passed, 10);
  const { res } = hit(limiter, { ip, path: '/debate' });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.scope, 'model');
});

test('C9 · reads are never throttled', () => {
  const limiter = createAiWriteLimiter({ env: { AI_RATE_LIMIT: '1', AI_TURN_RATE_LIMIT: '1', AI_BOOKKEEPING_RATE_LIMIT: '1' } });
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    for (let i = 0; i < 50; i += 1) assert.equal(hit(limiter, { method, path: '/chat/health' }).passed, true);
  }
});

test('C10 · the window resets, and a refunded hit is not charged', () => {
  const limiter = createWindowLimiter({ windowMs: 1000, max: 2 });
  assert.equal(limiter.take('k', 0).allowed, true);
  assert.equal(limiter.take('k', 10).allowed, true);
  const refused = limiter.take('k', 20);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSec, 1);
  assert.equal(limiter.take('k', 1001).allowed, true, 'a new window');
  limiter.refund('k');
  assert.equal(limiter.take('k', 1002).allowed, true);
  assert.equal(limiter.take('k', 1003).allowed, true);
  assert.equal(limiter.take('k', 1004).allowed, false);
  limiter.sweep(5000);
  assert.equal(limiter.size, 0);
});

test('C11 · every API failure has a JSON name', () => {
  assert.deepEqual(describeApiError({ type: 'entity.too.large', status: 413 }), { status: 413, error: 'PAYLOAD_TOO_LARGE', retryable: false });
  assert.deepEqual(describeApiError({ type: 'entity.parse.failed', status: 400 }), { status: 400, error: 'INVALID_JSON', retryable: false });
  assert.deepEqual(describeApiError(Object.assign(new SyntaxError('bad'), { status: 400 })), { status: 400, error: 'INVALID_JSON', retryable: false });
  assert.deepEqual(describeApiError({ type: 'request.aborted', status: 400 }), { status: 400, error: 'REQUEST_ABORTED', retryable: true });
  /* Other 4xx keep their status; the name is the error's code or the status' own. */
  assert.deepEqual(describeApiError({ status: 403, code: 'ORIGIN_NOT_ALLOWED' }), { status: 403, error: 'ORIGIN_NOT_ALLOWED', retryable: false });
  assert.deepEqual(describeApiError({ status: 401 }), { status: 401, error: 'UNAUTHORIZED', retryable: false });
  assert.deepEqual(describeApiError({ status: 415, type: 'charset.unsupported' }), { status: 415, error: 'UNSUPPORTED_MEDIA_TYPE', retryable: false });
  assert.deepEqual(describeApiError({ status: 418, code: 'not a code; just prose' }), { status: 418, error: 'BAD_REQUEST', retryable: false });
  assert.equal(describeApiError({ status: 429 }).retryable, true);
  /* A plain thrown error keeps the status Express would have used: only the
     body changes. Non-idempotent callers must not start auto-retrying. */
  assert.deepEqual(describeApiError(new Error('boom')), { status: 500, error: 'INTERNAL_ERROR', retryable: true });
  assert.deepEqual(describeApiError(null), { status: 500, error: 'INTERNAL_ERROR', retryable: true });
});

test('C12 · the error handler answers /api in JSON and leaves the rest to Express', () => {
  const seen = [];
  const handler = createApiErrorHandler({ onError: (info) => seen.push(info.status), log: () => {} });
  const res = fakeRes();
  let forwarded = null;
  handler({ type: 'entity.too.large', status: 413 }, { method: 'POST', originalUrl: '/api/v1/ai/chat?x=1' }, res, (err) => { forwarded = err; });
  assert.equal(forwarded, null);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { ok: false, error: 'PAYLOAD_TOO_LARGE', retryable: false, status: 413 });
  assert.deepEqual(seen, [413]);
  /* Headers the error carries for its status travel with it. */
  const res405 = fakeRes();
  handler({ status: 405, headers: { allow: 'GET, HEAD' } }, { method: 'POST', originalUrl: '/api/x' }, res405, () => {});
  assert.equal(res405.statusCode, 405);
  assert.equal(res405.headers.allow, 'GET, HEAD');
  assert.equal(res405.body.error, 'METHOD_NOT_ALLOWED');
  /* The message of an internal error never reaches the client. */
  const res500 = fakeRes();
  handler(new Error('secret detail at /var/task/server/x.js'), { method: 'POST', originalUrl: '/api/orders' }, res500, () => {});
  assert.deepEqual(res500.body, { ok: false, error: 'INTERNAL_ERROR', retryable: true, status: 500 });
  /* Not an API path → not ours. */
  const page = fakeRes();
  const err = new Error('page');
  handler(err, { method: 'GET', originalUrl: '/some-page' }, page, (e) => { forwarded = e; });
  assert.equal(forwarded, err);
  assert.equal(page.body, undefined);
  /* Headers already sent → nothing left to answer with. */
  const late = fakeRes();
  late.headersSent = true;
  handler(err, { method: 'POST', originalUrl: '/api/x' }, late, (e) => { forwarded = e; });
  assert.equal(late.body, undefined);
});

test('C13 · the turn log keeps how a turn ended and nothing about what it said', () => {
  const summary = summarizeChatReply({
    ok: true,
    reply: {
      text: 'پاسخ محرمانه دربارهٔ کیف پول 0xabc',
      ui: { type: 'TEXT' },
      intent: { type: 'GENERAL' },
      intelligence: { mode: { id: 'max' }, modelsConsulted: ['a', 'b'], providersUsed: ['openrouter', 'groq'], degraded: false, latencyMs: 4200 }
    },
    context: { wallet: { evmAddresses: [WALLET] } }
  }, 200);
  assert.deepEqual(summary, {
    ok: true, status: 200, error: null, ui: 'TEXT', intent: 'GENERAL', mode: 'max',
    models: 2, providers: ['openrouter', 'groq'], degraded: false, collabMs: 4200, chars: 34
  });
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /محرمانه|0xabc|dEaD/);
  assert.equal(summarizeChatReply({ ok: false, error: 'EMPTY_MESSAGE' }, 400).ok, false);
  assert.equal(summarizeChatReply({ ok: false, error: 'EMPTY_MESSAGE' }, 400).error, 'EMPTY_MESSAGE');
  /* `ok: true` on a failing status is still a failure. */
  assert.equal(summarizeChatReply({ ok: true }, 503).ok, false);
});

test('C14 · a turn that throws ends in JSON the screen retries — and leaves a row', async () => {
  const rows = [];
  const guarded = guardChatTurn(async () => { throw new Error('DURABLE_STORE_WRITE_FAILED'); }, { record: async (row) => { rows.push(row); }, log: () => {} });
  const res = fakeRes();
  await guarded({ headers: { 'content-length': '512' }, body: { intelligence: 'max', context: { wallet: { connected: true } } } }, res, () => {});
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: 'CHAT_TURN_FAILED', retryable: true, status: 503 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].error, 'CHAT_TURN_FAILED');
  assert.equal(rows[0].cause, 'DURABLE_STORE_WRITE_FAILED');
  assert.equal(rows[0].bytes, 512);
  assert.equal(rows[0].asked, 'max');
  assert.equal(rows[0].wallet, true);
  assert.doesNotMatch(JSON.stringify(res.body), /DURABLE/, 'the cause stays in the log, not in the reply');
});

test('C14b · what a thrown turn records is safe to show on a public endpoint', async () => {
  const rows = [];
  const secret = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const guarded = guardChatTurn(async () => {
    throw new TypeError(`fetch failed for https://db.example.io/set/key?token=${secret} wallet 0x000000000000000000000000000000000000dEaD key ${secret}`);
  }, { record: async (row) => { rows.push(row); }, log: () => {} });
  await guarded({ headers: {}, body: {} }, fakeRes(), () => {});
  const row = rows[0];
  assert.match(row.cause, /^TypeError: fetch failed for \[url\]/);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(row), /example\.io|dEaD/);
  assert.ok(row.cause.length <= 100);
  /* The frame is a file and a line — never a path. */
  assert.match(row.where, /^[A-Za-z0-9_.-]+\.m?js:\d+$/);
  assert.doesNotMatch(row.where, /\//);
});

test('C15 · a normal turn is answered unchanged, once, after its row is written', async () => {
  const rows = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const guarded = guardChatTurn(async (_req, res) => res.json({ ok: true, reply: { text: 'سلام', ui: { type: 'TEXT' } } }), {
    record: (row) => { rows.push(row); return gate; },
    log: () => {}
  });
  const res = fakeRes();
  await guarded({ headers: {}, body: {} }, res, () => {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].kind, 'turn');
  assert.equal(res.body, undefined, 'the reply waits for the evidence write');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(res.body, { ok: true, reply: { text: 'سلام', ui: { type: 'TEXT' } } });
});

test('C16 · a failing evidence write never costs the user their answer', async () => {
  const guarded = guardChatTurn(async (_req, res) => res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' }), {
    record: () => Promise.reject(new Error('store down')),
    log: () => {}
  });
  const res = fakeRes();
  await guarded({ headers: {}, body: {} }, res, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, error: 'EMPTY_MESSAGE' });
  /* …and neither does a recorder that throws synchronously. */
  const guarded2 = guardChatTurn(async (_req, r) => r.json({ ok: true }), { record: () => { throw new Error('sync'); }, log: () => {} });
  const res2 = fakeRes();
  await guarded2({ headers: {}, body: {} }, res2, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(res2.body, { ok: true });
});

test('C17 · a reply that cannot be serialized is a failed turn, not an unhandled rejection', async () => {
  const guarded = guardChatTurn(async (_req, res) => res.json({ ok: true, reply: { text: 'x' } }), { record: async () => {}, log: () => {} });
  const res = fakeRes();
  let first = true;
  res.json = function json(payload) {
    if (first) { first = false; throw new TypeError('Do not know how to serialize a BigInt'); }
    this.body = payload; this.headersSent = true; return this;
  };
  await guarded({ headers: {}, body: {} }, res, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: 'CHAT_TURN_FAILED', retryable: true, status: 503 });
});

test('C18 · the snapshot reports turns and refusals, newest first, without a durable store', async () => {
  __resetChatTurnLog();
  await recordChatTurn({ kind: 'turn', ok: true, status: 200, ms: 1200, mode: 'max' }, { waitMs: 50 });
  await recordChatTurn({ kind: 'turn', ok: true, status: 200, ms: 800, mode: 'swift' }, { waitMs: 50 });
  await recordChatTurn({ kind: 'turn', ok: false, status: 503, ms: 300, error: 'CHAT_TURN_FAILED' }, { waitMs: 50 });
  const first = recordTransportEvent({ kind: 'rate-limited', status: 429, error: 'AI_RATE_LIMITED' });
  assert.ok(first, 'the first refusal is recorded');
  assert.equal(recordTransportEvent({ kind: 'rate-limited', status: 429 }), null, 'a burst of refusals is sampled, not stored one by one');
  await first;
  const snap = await chatTurnSnapshot({ limit: 10 });
  assert.equal(snap.summary.turns >= 3, true);
  assert.equal(snap.summary.failed >= 1, true);
  assert.equal(snap.summary.transportRefusals >= 1, true);
  assert.equal(snap.summary.lastFailure.status, 429);
  assert.ok(snap.summary.p50Ms >= 800);
  assert.ok(snap.recent.length >= 4 && snap.recent.length <= 10);
  assert.ok(snap.recent[0].at >= snap.recent[snap.recent.length - 1].at);
  for (const row of snap.recent) assert.equal(typeof row.id, 'string');
  __resetChatTurnLog();
});

/* ── D. the same contract through real Express middleware, over HTTP ─────── */

async function withServer(build, run) {
  const app = express();
  build(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

/** The mounts, in the order server/app.js uses them. */
function mountLikeProduction(app, { limiterEnv = {} } = {}) {
  app.use(AI_CONTEXT_BODY_PATHS, express.json({ limit: AI_JSON_BODY_LIMIT }), slimAiRequestMiddleware);
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/v1/ai', createAiWriteLimiter({ env: limiterEnv }));
  app.post('/api/v1/ai/chat', guardChatTurn(async (req, res) => {
    if (req.body?.message === 'throw') throw new Error('handler exploded');
    res.json({
      ok: true,
      reply: { text: 'ok', ui: { type: 'TEXT' } },
      seen: {
        message: req.body?.message || null,
        marketRows: req.body?.context?.portfolio?.marketRows?.length ?? 0,
        balances: req.body?.context?.balances?.length ?? 0
      }
    });
  }, { record: async () => {}, log: () => {} }));
  app.post('/api/v1/ai/learning/record', (_req, res) => res.json({ ok: true }));
  /* Same reads as server/aiNeuromorphicRoutes.js `POST /neuromorphic/infer`. */
  app.post('/api/v1/ai/neuromorphic/infer', (req, res) => res.json({
    ok: true,
    candles: Array.isArray(req.body?.candles) ? req.body.candles.slice(-120).length : null,
    markets: Array.isArray(req.body?.markets) ? req.body.markets.slice(0, 100).length : null
  }));
  app.post('/api/system/state', (req, res) => res.json({
    ok: true,
    marketRows: req.body?.portfolio?.marketRows?.length ?? 0,
    balances: req.body?.balances?.length ?? 0
  }));
  app.post('/api/orders', (req, res) => res.json({ ok: true, size: JSON.stringify(req.body || {}).length }));
  app.post('/api/orders/throw', () => { throw new Error('orders exploded'); });
  app.use(createApiErrorHandler({ log: () => {} }));
}

const postJson = (url, body, headers = {}) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('D1 · an old client’s 300 KB+ chat body is answered 200 — it was 413', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const body = JSON.stringify(chatBody());
    assert.ok(bytesOf(body) > 256 * 1024);
    const res = await postJson(`${base}/api/v1/ai/chat`, body);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.seen.message, 'یه جوک بگو');
    assert.equal(json.seen.marketRows, 0, 'the feed is dropped before the handler runs');
    assert.equal(json.seen.balances, 12);
  });
});

test('D2 · the new client’s body passes untouched', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const wire = encodeWireBody(chatBody());
    const res = await postJson(`${base}/api/v1/ai/chat`, wire.text);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).seen.balances, 12);
  });
});

test('D2b · a route under the same prefix that takes series as INPUT receives all of it', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const res = await postJson(`${base}/api/v1/ai/neuromorphic/infer`, {
      candles: Array.from({ length: 120 }, (_, i) => ({ t: i, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 })),
      markets: Array.from({ length: 100 }, (_, i) => ({ symbol: `M${i}`, change24h: i / 10 })),
      pulse: { fearGreed: 44 }
    }, { 'x-fbt-device': 'device-infer-0001' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, candles: 120, markets: 100 });
  });
});

test('D2c · the central state route: an old client’s top-level context is accepted, without the feed', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const body = JSON.stringify({ locale: 'fa', ...screenContext() });
    assert.ok(bytesOf(body) > 256 * 1024);
    const res = await postJson(`${base}/api/system/state`, body);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, marketRows: 0, balances: 12 });
  });
});

test('D3 · past the AI limit the refusal is JSON, with a name', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const huge = JSON.stringify({ message: 'x', blob: 'a'.repeat(2_300_000) });
    const res = await postJson(`${base}/api/v1/ai/chat`, huge);
    assert.equal(res.status, 413);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    assert.deepEqual(await res.json(), { ok: false, error: 'PAYLOAD_TOO_LARGE', retryable: false, status: 413 });
  });
});

test('D4 · every other route keeps its 256 KB limit — now with a JSON refusal', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const res = await postJson(`${base}/api/orders`, { blob: 'a'.repeat(400_000) });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, 'PAYLOAD_TOO_LARGE');
    const fine = await postJson(`${base}/api/orders`, { blob: 'a'.repeat(1000) });
    assert.equal(fine.status, 200);
  });
});

test('D5 · malformed JSON is a 400 with a name, not an HTML page', async () => {
  await withServer(mountLikeProduction, async (base) => {
    for (const path of ['/api/v1/ai/chat', '/api/orders']) {
      const res = await postJson(`${base}${path}`, '{"message": "x",,}');
      assert.equal(res.status, 400, path);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      assert.equal((await res.json()).error, 'INVALID_JSON');
    }
  });
});

test('D6 · a thrown chat turn is a retryable 503 in JSON; a thrown non-AI route keeps its 500', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const chat = await postJson(`${base}/api/v1/ai/chat`, { message: 'throw' });
    assert.equal(chat.status, 503);
    assert.deepEqual(await chat.json(), { ok: false, error: 'CHAT_TURN_FAILED', retryable: true, status: 503 });
    const other = await postJson(`${base}/api/orders/throw`, {});
    assert.equal(other.status, 500);
    const json = await other.json();
    assert.equal(json.error, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(json), /exploded/);
  });
});

test('D7 · over HTTP: twelve messages with their telemetry all pass; the 21st turn of a minute is told when to return', async () => {
  await withServer(mountLikeProduction, async (base) => {
    const headers = { 'x-fbt-device': 'device-http-0001' };
    for (let i = 1; i <= 12; i += 1) {
      assert.equal((await postJson(`${base}/api/v1/ai/learning/record`, { n: i }, headers)).status, 200, `telemetry ${i}`);
      assert.equal((await postJson(`${base}/api/v1/ai/chat`, { message: 'سلام' }, headers)).status, 200, `chat ${i}`);
    }
    for (let i = 13; i <= 20; i += 1) assert.equal((await postJson(`${base}/api/v1/ai/chat`, { message: 'سلام' }, headers)).status, 200);
    const refused = await postJson(`${base}/api/v1/ai/chat`, { message: 'سلام' }, headers);
    assert.equal(refused.status, 429);
    const retryAfter = Number(refused.headers.get('retry-after'));
    assert.ok(retryAfter >= 1 && retryAfter <= 60);
    const json = await refused.json();
    assert.equal(json.error, 'AI_RATE_LIMITED');
    assert.equal(json.retryAfterSec, retryAfter);
  });
});

/* ── E. wiring probes: the mounts that make the above true in production ─── */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('E1 · the AI body parser is mounted BEFORE the global 256 KB parser', () => {
  const app = read('server/app.js');
  const ai = app.indexOf('app.use(AI_CONTEXT_BODY_PATHS, express.json({ limit: AI_JSON_BODY_LIMIT }), slimAiRequestMiddleware);');
  const global = app.indexOf("app.use(express.json({\n  limit: '256kb'");
  assert.ok(ai > 0, 'AI parser mount not found');
  assert.ok(global > 0, 'global parser mount not found');
  assert.ok(ai < global, 'the larger limit must be the one that reads AI bodies');
});

test('E2 · the JSON error handler is the LAST middleware of the app', () => {
  const app = read('server/app.js');
  const handler = app.lastIndexOf('app.use(createApiErrorHandler(');
  assert.ok(handler > 0);
  const tail = app.slice(handler);
  assert.doesNotMatch(tail, /\n(app|router)\.(get|post|put|patch|delete|use)\(/, 'nothing may be mounted after the error handler');
  assert.match(tail, /export default app;\s*$/);
});

test('E3 · /api/v1/ai is limited by class, not by one shared counter', () => {
  const app = read('server/app.js');
  assert.match(app, /app\.use\('\/api\/v1\/ai', aiV1WriteLimiter\);/);
  assert.doesNotMatch(app, /const aiV1Hits = new Map\(\)/);
});

test('E4 · the chat turn is guarded, a pending intent cannot fail it, and the health route is public', () => {
  const route = read('server/aiIntentOS.js');
  assert.match(route, /router\.post\('\/chat', guardChatTurn\(async \(req, res\) => \{/);
  assert.match(route, /router\.get\('\/chat\/health'/);
  /* The pending write races a bounded wait and never rejects into the turn. */
  assert.match(route, /\.then\(\(\) => true, \(\) => false\)/);
  assert.match(route, /PENDING_WRITE_WAIT_MS/);
  /* `log` was never declared in this module. */
  assert.doesNotMatch(route, /\blog\?\.\(/);
});

test('E5 · both clients encode for the wire instead of stringifying the screen object', () => {
  for (const file of ['src/lib/aiIntentClient.js', 'src/lib/centralClient.js']) {
    const src = read(file);
    assert.match(src, /encodeWireBody\(/, file);
    assert.doesNotMatch(src, /body: body \? JSON\.stringify\(body\) : undefined/, file);
  }
});

test('E6 · the chat screen answers each refusal in kind, and never asks a wallet for a question', () => {
  const ui = read('src/components/IntentAIUnified.jsx');
  assert.match(ui, /const tooLarge = status === 413 \|\| res\?\.error === 'PAYLOAD_TOO_LARGE'/);
  assert.match(ui, /const rateLimited = status === 429/);
  assert.match(ui, /tooLarge \? \{ maxBodyBytes: 48000 \} : \{\}/);
  assert.match(ui, /waitable \? retryAfterSec \* 1000 \+ 250 : 800/);
  assert.match(ui, /maxBodyBytes: opts\.maxBodyBytes \|\| undefined/);
  /* Still one automatic retry, not a loop. */
  assert.match(ui, /const canRetry = attempt < 1 && transient && !connect/);
  /* A delayed retry must not land on top of a newer question. */
  assert.match(ui, /if \(turnSeqRef\.current !== turnSeq\) return;/);
  /* «verify before EXECUTION» does not gate a turn the local OS could not read. */
  assert.match(ui, /const serverOwnsReading = osResult\?\.understood === false && !needsFinancialConfirmation;/);
  assert.match(ui, /if \(!serverOwnsReading && !verifyResult\.ok && verifyResult\.reason === 'WALLET_NOT_CONNECTED'\)/);
});

/* ── F. the server was asked and could not answer ──────────────────────────── */

test('F1 · a pleasantry the server could not answer is still answered as one', () => {
  const prior = { intent: 'ASSET_ANALYSIS' };
  /* The contextual rule itself is untouched: with a previous answer on screen
     a bare «خوبی؟» is not answered locally — it goes to the server. */
  assert.equal(offlineSocialFallback('خوبی؟', { locale: 'fa', prior }), null);
  assert.equal(offlineSocialFallback('حالت چطوره', { locale: 'fa', prior }), null);
  /* …and once that attempt has failed, it gets its answer anyway. */
  for (const text of ['خوبی؟', 'حالت چطوره', 'چطوری']) {
    const row = unreachableSocialFallback(text, { locale: 'fa', prior });
    assert.ok(row, text);
    assert.equal(row.role, 'ai');
    assert.equal(row.kind, 'assistant');
    assert.equal(row.social.act, 'HOW_ARE_YOU');
    assert.equal(row.social.offline, true);
    assert.deepEqual(row.actions, []);
    assert.match(row.content, /[\u0600-\u06FF]/);
    assert.doesNotMatch(row.content, /\d/, 'a pleasantry carries no number');
  }
  const en = unreachableSocialFallback('how are you', { locale: 'en', prior });
  assert.ok(en && /[a-z]/i.test(en.content));
  /* Without a previous turn it is exactly the existing fallback. */
  assert.ok(unreachableSocialFallback('خوبی؟', { locale: 'fa' }));
});

test('F2 · a real request never gets a pleasantry in place of its error', () => {
  const prior = { intent: 'ASSET_ANALYSIS' };
  for (const text of ['قیمت بیت‌کوین چنده؟', 'چرا؟', 'باشه', 'تأیید', '۱۰ دلار اتریوم بخر', 'سلام، امروز بازار چطوره؟']) {
    assert.equal(unreachableSocialFallback(text, { locale: 'fa', prior }), null, text);
    assert.equal(unreachableSocialFallback(text, { locale: 'fa' }), offlineSocialFallback(text, { locale: 'fa' }), text);
  }
  /* «چخبر» asks for a live brief: it keeps the honest "needs the server" line. */
  const news = unreachableSocialFallback('چخبر؟', { locale: 'fa', prior });
  assert.equal(news?.social?.needsServer, true);
});

test('F3 · the screen uses the unreachable fallback only where the server has already failed', () => {
  const ui = read('src/components/IntentAIUnified.jsx');
  /* Before the pipeline: the contextual rule decides (a follow-up goes to the server). */
  assert.match(ui, /const socialRow = offlineSocialFallback\(message, \{/);
  /* After a failed turn, and in the catch around the whole turn. */
  assert.match(ui, /const socialRow = !canRetry \? unreachableSocialFallback\(message, \{/);
  assert.match(ui, /return unreachableSocialFallback\(message, \{/);
  assert.equal((ui.match(/unreachableSocialFallback\(/g) || []).length, 2);
});
