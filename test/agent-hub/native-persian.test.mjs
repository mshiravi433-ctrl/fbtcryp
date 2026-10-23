/**
 * FIRST-PARTY AGENTS, IN PERSIAN — the reader, not a second agent runtime.
 * ---------------------------------------------------------------------------
 * The reported bug was "FBT's native agents show English with a Persian prompt
 * and do not work". The agents were fine; `extractRequest` was Latin-only, so
 * every Persian sentence arrived empty and each agent answered «ورودی لازم
 * است» — a completed run that reads like a broken provider connection.
 *
 * These tests pin the three things that fix it:
 *
 *   ۱. Persian/Arabic digits, ZWNJ and letter variants parse to the SAME
 *      symbol, chain, amount and protocol the agents already understood.
 *   ۲. A Persian run answers in Persian, under the Persian agent name, and
 *      reports `awaiting_input` explicitly instead of looking like a failure.
 *   ۳. FBT's own links are hash routes (`/#/help`), because the app is a
 *      HashRouter and `/help` on the server is a 404.
 *
 * Every read here is injected — no network, no live provider, deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractRequest, CHAINS } from '../../server/agentHub/native/data.js';
import { runNativeAgent, nativeAgentCatalog } from '../../server/agentHub/native/agents.js';
import { createNativeProvider, hashUrl } from '../../server/agentHub/native/index.js';

const COIN = {
  id: 'ethereum',
  symbol: 'ETH',
  name: 'Ethereum',
  price: 2500.25,
  marketCap: 300_000_000_000,
  volume24h: 12_000_000_000,
  change24h: 2.1,
  rank: 2
};
const CANDLES = Array.from({ length: 120 }, (_, i) => ({ c: 2000 + i * 5 + Math.sin(i) * 20 }));

const data = {
  schema: 'test',
  async searchCoins(query) {
    const q = String(query || '').toLowerCase();
    if (q === 'eth' || q === 'ethereum' || q === 'btc') return q === 'btc' ? [{ ...COIN, id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }] : [COIN];
    return [];
  },
  async coinDetail() { return COIN; },
  async candles() { return CANDLES; },
  async markets() { return [COIN]; },
  async yields() { return { pools: [] }; },
  async protocols() { return []; },
  async protocolDetail() { return null; },
  async incidents() { return []; },
  async tokenRisk() { return null; },
  async tokenIntel() { return null; },
  async topTraders() { return []; },
  async walletIntel() { return null; },
  async smartMoneyOverview() { return null; },
  async tokenInfo() { return null; },
  async bridgeQuote() { return { ok: false }; }
};

const symbols = (text) => extractRequest(text).symbolCandidates;

test('Persian coin names resolve to the symbols the agents already use', () => {
  assert.deepEqual(symbols('قیمت بیت کوین چقدره؟'), ['BTC']);
  assert.deepEqual(symbols('اتریوم را تحلیل کن'), ['ETH']);
  assert.deepEqual(symbols(' تحلیل اتریوم '), ['ETH']);
  assert.deepEqual(symbols('روند و نوسان BTC'), ['BTC']);
  /* ZWNJ (نیم‌فاصله) and Arabic letter variants are the same word. */
  assert.deepEqual(symbols('قیمت بیت‌کوین'), ['BTC']);
  assert.deepEqual(symbols('قیمت بيتكوين'), ['BTC']);
  /* An unknown Persian word is still not a coin — no invented symbol. */
  assert.deepEqual(symbols('این چطور کار می‌کند؟'), []);
});

test('Persian chain names resolve, in the order the sentence names them', () => {
  assert.deepEqual(extractRequest('اتریوم را تحلیل کن').chains, [1]);
  assert.deepEqual(extractRequest('بهترین بازده روی آربیتروم').chains, [42161]);
  /* Position, not alias length, decides source and destination. */
  assert.deepEqual(extractRequest('از بیس به آربیتروم').chains, [8453, 42161]);
  assert.deepEqual(extractRequest('از آربیتروم به بیس').chains, [42161, 8453]);
  /* English still works: this is additive, not a swap of the parser. */
  assert.deepEqual(extractRequest('from Base to Arbitrum').chains, [8453, 42161]);
});

test('Persian and Arabic-Indic digits are amounts, not unknown tokens', () => {
  const fa = extractRequest('۱۰۰ USDC را از آربیتروم به بیس سواپ کن');
  assert.equal(fa.amount, 100);
  assert.equal(fa.amountToken, 'USDC');
  assert.deepEqual(fa.chains, [42161, 8453]);

  const ar = extractRequest('١٠٠ USDC من آربیتروم إلى بیس');
  assert.equal(ar.amount, 100);
  assert.equal(ar.amountToken, 'USDC');
});

test('a Persian protocol name reaches the same slug the review uses', () => {
  assert.equal(extractRequest('گزارش امنیتی آوه').protocolQuery, 'aave');
  assert.equal(extractRequest('ریسک کامپاند').protocolQuery, 'compound');
  assert.equal(extractRequest('protocol curve').protocolQuery, 'curve');
});

test('a Persian run answers in Persian, under the Persian agent name', async () => {
  const out = await runNativeAgent('ai-trading-analyst', { text: 'اتریوم را تحلیل کن' }, data, { now: () => 1_700_000_000_000 });
  assert.equal(out.ok, true);
  assert.equal(out.dataStatus, 'live');
  assert.equal(out.data.lang, 'fa');
  /* The card said «تحلیل‌گر معامله»; the result must not say "AI Trading Analyst". */
  assert.match(out.title, /تحلیل‌گر معامله/);
  assert.doesNotMatch(out.title, /AI Trading Analyst/);
  assert.match(out.text, /##/);
  assert.match(out.text, /[آ-ی]/);
  assert.equal(out.data.request.symbol, 'ETH');
});

test('an empty input is a completed run that SAYS it needs input', async () => {
  const out = await runNativeAgent('ai-trading-analyst', { text: 'سلام' }, data, { now: () => 1_700_000_000_000 });
  assert.equal(out.ok, true);
  assert.equal(out.dataStatus, 'awaiting_input');
  assert.equal(out.data.needsInput, true);
  assert.match(out.text, /ورودی لازم است/);
  /* Still localised title, and no invented analysis. */
  assert.match(out.title, /تحلیل‌گر معامله/);
});

test('a blocked coin search still resolves a major symbol by its canonical id', async () => {
  /* This is the production failure users described: CoinGecko search is one
     call with no backup, so a filtered network made every Persian or English
     request look like "the agent cannot work". The map is a name only; the
     agent still reads live data and reports which source answered. */
  const blocked = { ...data, async searchCoins() { throw new Error('EGRESS_BLOCKED'); } };
  const out = await runNativeAgent('ai-trading-analyst', { text: 'تحلیل بیت کوین' }, blocked, { now: () => 1_700_000_000_000 });
  assert.equal(out.ok, true);
  assert.notEqual(out.dataStatus, 'awaiting_input');
  assert.equal(out.data.request.symbol, 'BTC');
  /* An unknown word is still unknown: the map does not guess. */
  const unknown = await runNativeAgent('ai-trading-analyst', { text: 'تحلیل زوربای' }, blocked, { now: () => 1_700_000_000_000 });
  assert.equal(unknown.dataStatus, 'awaiting_input');
});

test('every native agent advertises a Persian name, a Persian summary and examples', () => {
  const catalog = nativeAgentCatalog();
  assert.equal(catalog.length, 11);
  for (const agent of catalog) {
    assert.ok(agent.nameFa && agent.nameFa.length > 2, `${agent.slug} has no Persian name`);
    assert.ok(agent.summaryFa && agent.summaryFa.length > 8, `${agent.slug} has no Persian summary`);
    assert.ok(Array.isArray(agent.examplesFa) && agent.examplesFa.length, `${agent.slug} has no Persian example`);
  }
});

test("FBT's own provider links are hash routes, never server paths that 404", () => {
  const provider = createNativeProvider({ env: {} });
  assert.equal(hashUrl('https://fbtswap.ir', '/help'), 'https://fbtswap.ir/#/help');
  assert.equal(provider.documentationUrl, 'https://fbtswap.ir/#/help');
  assert.equal(provider.termsUrl, 'https://fbtswap.ir/#/legal/terms');
  assert.equal(provider.privacyUrl, 'https://fbtswap.ir/#/legal/privacy');
  assert.equal(provider.supportUrl, 'https://fbtswap.ir/#/help');
  assert.equal(provider.websiteUrl, 'https://fbtswap.ir/');
  assert.equal(provider.approvalEvidence.documentUrl, 'https://fbtswap.ir/#/legal/disclaimer');
  /* Nothing may point at a bare route again. */
  for (const url of [provider.documentationUrl, provider.termsUrl, provider.privacyUrl]) {
    const path = new URL(url).pathname;
    assert.equal(path, '/', `${url} still has a server path`);
    assert.ok(new URL(url).hash.startsWith('#/'));
  }
  /* A different deployment keeps its own origin. */
  const other = createNativeProvider({ env: { PUBLIC_APP_ORIGIN: 'https://app.example' } });
  assert.equal(other.termsUrl, 'https://app.example/#/legal/terms');
});

test('the chain table still only contains chains the app can read', () => {
  for (const [, id] of Object.entries(CHAINS)) {
    assert.ok(id === 'solana' || Number.isInteger(id));
  }
});
