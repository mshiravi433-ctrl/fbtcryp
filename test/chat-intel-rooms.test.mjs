/**
 * CHAT = THE INTELLIGENCE ROOMS — INTENT WIRING
 * ---------------------------------------------------------------------------
 * The owner's ask, as two rules this file pins down:
 *
 *   1. «هوش بازار» is not a page to navigate to; the answer TO the question is
 *      the room. So the human layer must attach a room card and must NOT
 *      navigate:
 *        · «تحلیل بیت کوین» → TOKEN card carrying the CoinGecko id
 *        · «امروز چه خبر»   → MARKET room, nothing navigated
 *        · «فرصت‌های بازار» → MARKET room opened on the opportunities tab
 *        · «ریسک پرتفوی»    → PORTFOLIO card focused on its risk room
 *   2. Honesty survives the move: when a read fails the room still opens, and
 *      no number is invented to fill it.
 *
 * Everything is deterministic — no network, no wallet, no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildHumanResponse } from '../src/lib/intent-ai/os/humanResponse.js';

const tokenRead = {
  token: {
    coinId: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    priceUsd: 61_234.5,
    change1hPct: 0.2,
    change24hPct: 1.42,
    change7dPct: 4.1,
    high24h: 62_000,
    low24h: 59_800,
    marketCapUsd: 1_210_000_000_000,
    volume24hUsd: 32_000_000_000,
    rank: 1,
    sparkline: [60_000, 60_500, 61_234.5],
    dataStatus: 'live'
  }
};

const holdings = [
  { symbol: 'BTC', amount: 0.1, valueUsd: 8000, chainId: 42161 },
  { symbol: 'ETH', amount: 0.5, valueUsd: 1500, chainId: 42161 },
  { symbol: 'USDC', amount: 500, valueUsd: 500, chainId: 42161 }
];
const connectedContext = {
  wallet: { connected: true, address: '0xabc', chainId: 42161 },
  portfolio: { holdings, dataStatus: 'live', priceDataStatus: 'live' },
  balances: holdings
};

test('a token question opens the token room, on the real coin id', () => {
  const out = buildHumanResponse({
    intent: { type: 'ANALYZE_TOKEN', raw: 'تحلیل بیت کوین', entities: { token: 'BTC' } },
    results: tokenRead,
    locale: 'fa'
  });
  assert.equal(out.card?.kind, 'TOKEN');
  /* The compact card used to drop the id; the room then guessed a slug and
     could open an empty file. */
  assert.equal(out.card?.coinId, 'bitcoin');
  assert.equal(out.card?.symbol, 'BTC');
  assert.equal(out.ui.type, 'TOKEN_CARD');
});

test('a whole-market question opens the market room instead of a chart of rows', () => {
  const out = buildHumanResponse({
    intent: { type: 'MARKET_ANALYSIS', raw: 'وضعیت بازار چطوره', entities: {} },
    results: {
      market: {
        top: [
          { symbol: 'BTC', priceUsd: 61_234.5, change24hPct: 1.42 },
          { symbol: 'ETH', priceUsd: 3120.4, change24hPct: -0.81 }
        ],
        overview: { totalMarketCapUsd: 2_450_000_000_000 }
      }
    },
    locale: 'fa'
  });
  assert.equal(out.ui.type, 'MARKET_CARD');
  assert.equal(out.card?.kind, 'MARKET');
  assert.equal(out.card?.room, 'overview');
  assert.equal(out.navigated, undefined, 'the market answer must not navigate away');
});

test('the words choose the room: opportunities, screener, report', () => {
  const room = (raw) => buildHumanResponse({
    intent: { type: 'MARKET_ANALYSIS', raw, entities: {} },
    results: { market: { top: [{ symbol: 'BTC', priceUsd: 1, change24hPct: 0 }] } },
    locale: 'fa'
  }).card?.room;
  assert.equal(room('فرصت‌های بازار'), 'opportunities');
  assert.equal(room('اسکرینر بازار را فیلتر کن'), 'screener');
  assert.equal(room('گزارش روزانه بازار'), 'report');
  assert.equal(room('بازار چطوره'), 'overview');
});

test('«امروز چه خبر» is answered in the chat, not by opening the news page', () => {
  const out = buildHumanResponse({
    intent: { type: 'NEWS_SEARCH', raw: 'امروز چه خبر', entities: {} },
    results: { route: '/news' },
    locale: 'fa'
  });
  assert.equal(out.ui.type, 'MARKET_CARD');
  assert.equal(out.card?.kind, 'MARKET');
  assert.equal(out.navigated, undefined);
  assert.ok(out.actions?.some((a) => a.route === '/news'), 'headlines stay one tap away');
});

test('«اخبار» still opens the news page — the shortcut is not a takeover', () => {
  const out = buildHumanResponse({
    intent: { type: 'NEWS_SEARCH', raw: 'اخبار', entities: {} },
    results: { route: '/news' },
    locale: 'fa'
  });
  assert.notEqual(out.ui.type, 'MARKET_CARD');
});

test('a portfolio risk question lands on the risk room of the portfolio answer', () => {
  const out = buildHumanResponse({
    intent: { type: 'PORTFOLIO_ANALYSIS', raw: 'ریسک پرتفوی من چقدره', entities: {} },
    context: connectedContext,
    results: {},
    locale: 'fa'
  });
  assert.equal(out.card?.kind, 'PORTFOLIO');
  assert.equal(out.card?.focusRoom, 'risk');
});

test('a holdings question does not force the risk room open', () => {
  const out = buildHumanResponse({
    intent: { type: 'PORTFOLIO_ANALYSIS', raw: 'موجودی کیف پول من', entities: {} },
    context: connectedContext,
    results: {},
    locale: 'fa'
  });
  assert.equal(out.card?.kind, 'PORTFOLIO');
  assert.equal(out.card?.focusRoom, null);
});

test('when the market read fails the token room still opens — with no invented number', () => {
  const out = buildHumanResponse({
    intent: { type: 'ANALYZE_TOKEN', raw: 'تحلیل بیت کوین', entities: { token: 'BTC' } },
    results: { market: { top: [{ symbol: 'BTC', priceUsd: 61_234.5 }] } },
    locale: 'fa'
  });
  assert.equal(out.ui.type, 'TOKEN_ROOM');
  assert.equal(out.card?.kind, 'TOKEN_ROOM');
  assert.equal(out.card?.symbol, 'BTC');
  assert.equal(out.card?.priceUsd, undefined, 'a failed read carries no price');
});
