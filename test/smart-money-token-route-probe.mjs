#!/usr/bin/env node
/**
 * TOKEN SMART-MONEY ROUTE — HTTP level, 24h only, no wallet index.
 * ---------------------------------------------------------------------------
 * «cpu ارور زده و گفته حجم داره تموم میشه … فقط دادهٔ ۲۴ ساعته بده، لیست
 *  کیف‌پول‌ها هم نمی‌خواهد.»
 *
 * This probe boots the real Express app, stubs every upstream with real-shaped
 * payloads and asks the token route a question the card never asks — a 7-day
 * window. What must come back:
 *
 *   1. 200 with `window: '24h'` and a `windowPolicy` that says the request was
 *      answered with 24h (nothing is silently relabelled);
 *   2. `smartMoneyFlow` for 24h, `singleWindow: true`;
 *   3. NO `verified` block at all — the wallet index is not read for a token
 *      page (that background rebuild was the CPU/memory killer);
 *   4. holders trimmed to aggregates — no wallet list in the payload;
 *   5. a cache header that lets the CDN hold the answer for five minutes;
 *   6. no candle (OHLCV) request anywhere in the upstream log.
 *
 * Run: node test/smart-money-token-route-probe.mjs
 */
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
delete process.env.BLOB_READ_WRITE_TOKEN;

const now = Date.now();
const MIN = 60_000;
const TOKEN = '0x55d398326f99059ff775485246999027b3197955';
const POOL = '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae';
const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

const calls = [];
const realFetch = global.fetch;

global.fetch = async (url, init) => {
  const u = String(url);
  /* The probe's OWN request to the local server must reach the network. */
  if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return realFetch(url, init);
  calls.push(u);
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

  /* GeckoTerminal — pools + one real trade page */
  if (u.startsWith('https://api.geckoterminal.com/api/v2')) {
    if (u.includes('/tokens/') && u.includes('/pools')) {
      return json({
        data: [{
          id: `bsc_${POOL}`,
          type: 'pool',
          attributes: {
            address: POOL,
            name: 'USDT/WBNB',
            base_token_price_usd: '1.0002',
            reserve_in_usd: '4120000.5',
            pool_created_at: new Date(now - 400 * 24 * 3600_000).toISOString(),
            volume_usd: { h24: '2300000' },
            transactions: { h24: { buys: 3600, sells: 3300 } }
          },
          relationships: { dex: { data: { id: 'pancakeswap' } } }
        }]
      });
    }
    if (u.includes('/trades')) {
      const trade = (side, usd, wallet, ago, hash) => ({
        id: hash,
        type: 'trade',
        attributes: {
          block_timestamp: new Date(now - ago).toISOString(),
          tx_hash: hash,
          tx_from_address: wallet,
          from_token_address: side === 'buy' ? POOL : TOKEN,
          to_token_address: side === 'buy' ? TOKEN : POOL,
          volume_in_usd: String(usd),
          kind: side
        }
      });
      return json({
        data: [
          trade('buy', 120_000, W1, 30 * MIN, '0x' + 'a'.repeat(64)),
          trade('sell', 40_000, W2, 40 * MIN, '0x' + 'b'.repeat(64))
        ]
      });
    }
    return json({}, 404);
  }

  /* DexScreener — pairs for analyzeToken */
  if (u.includes('api.dexscreener.com/latest/dex/tokens/')) {
    return json({
      pairs: [{
        chainId: 'bsc', dexId: 'pancakeswap', pairAddress: POOL,
        baseToken: { address: TOKEN, symbol: 'USDT', name: 'Tether USD' },
        quoteToken: { address: '0x' + 'c'.repeat(40), symbol: 'WBNB' },
        priceUsd: '1.0002', liquidity: { usd: 4_120_000 },
        volume: { h1: 90_000, h6: 410_000, h24: 2_300_000 },
        txns: { h24: { buys: 3600, sells: 3300 } },
        pairCreatedAt: now - 400 * 24 * 3600_000
      }]
    });
  }

  /* Blockscout — holders (aggregates) and info */
  if (u.includes('/api/v2/tokens/') && u.includes('/holders')) {
    return json({
      items: [
        { address: { hash: W1, is_contract: false }, value: '4000000000000000000000000' },
        { address: { hash: W2, is_contract: false }, value: '1000000000000000000000000' }
      ],
      total: 1_204_880
    });
  }
  if (u.includes('/api/v2/tokens/') && u.endsWith('/counters')) return json({ token_holders_count: '1204880', transfers_count: '9' });
  if (u.includes('/api/v2/tokens/') && !u.includes('/holders') && !u.includes('/transfers')) {
    return json({ total_supply: '10000000000000000000000000', decimals: '18', holders_count: '1204880' });
  }

  return json({}, 404);
};

const app = (await import('../server/app.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const { port } = server.address();

const rows = [];
const t = (name, ok, detail) => {
  rows.push([name, Boolean(ok)]);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${String(detail ?? '')}`}`);
};

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/smart-money/token/56/${TOKEN}?window=7d`);
  const body = await res.json();
  t('the token route answers 200', res.status === 200, `${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  t('it declares the 24h window, not the requested one', body.window === '24h', body.window);
  t('...and says out loud that a 7d request was answered with 24h',
    body.windowPolicy?.served === '24h' && body.windowPolicy?.requested === '7d', JSON.stringify(body.windowPolicy));
  t('the flow payload is the single-window 24h summary',
    body.smartMoneyFlow?.window === '24h' && body.smartMoneyFlow?.singleWindow === true
    && body.smartMoneyFlow?.requestedWindow === '24h'
    && body.smartMoneyFlow?.windowMs === 86_400_000,
    JSON.stringify({ w: body.smartMoneyFlow?.window, s: body.smartMoneyFlow?.singleWindow, r: body.smartMoneyFlow?.requestedWindow }));
  t('the flow numbers are the real trades (buy 120k / sell 40k)',
    body.smartMoneyFlow?.buyUsd === 120_000 && body.smartMoneyFlow?.sellUsd === 40_000,
    JSON.stringify({ buy: body.smartMoneyFlow?.buyUsd, sell: body.smartMoneyFlow?.sellUsd }));
  t('no wallet-index block is computed for a token page', !('verified' in body), Object.keys(body).join(','));
  t('holders ship as aggregates only — no wallet list',
    Boolean(body.holders) && !('top' in body.holders) && body.holders.total === 1_204_880,
    JSON.stringify(body.holders));
  t('the CDN may hold the answer for five minutes',
    /s-maxage=300/.test(res.headers.get('cache-control') || ''), res.headers.get('cache-control'));
  t('no OHLCV/candle request was made for the token',
    calls.every((u) => !u.includes('/ohlcv/')), calls.filter((u) => u.includes('/ohlcv/')).join(', '));
  t('the read stays a small, bounded fan-out (≤ 6 upstream calls)',
    calls.length <= 6, `${calls.length} calls: ${calls.map((u) => u.replace(/\?.*$/, '')).join(' | ')}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  global.fetch = realFetch;
}

let failed = 0;
for (const [, ok] of rows) if (!ok) failed += 1;
console.log(`\n${rows.length - failed}/${rows.length} token-route checks passed`);
/* The Express app installs many interval timers at import time; a probe must
   end the process itself. */
process.exit(failed ? 1 : 0);

export const summary = rows;
