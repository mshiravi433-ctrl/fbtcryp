/**
 * A DETERMINISTIC MARKET API FOR VISUAL REVIEW — NOT SHIPPED, NOT DEPLOYED.
 * ---------------------------------------------------------------------------
 * The sandbox used for design work has no outbound access to CoinGecko or
 * CoinLore, so the real server answers `UPSTREAM_FAILED` and the market screen
 * can only be reviewed as skeleton rows. This stands up a tiny API that speaks
 * the same four routes the screen calls, with a fixed feed, so the layout can
 * be looked at and measured while it is being designed.
 *
 *   node scripts/preview-market-demo.mjs            # http://localhost:8799
 *   API_TARGET=http://localhost:8799 npx vite       # the web app on :5173
 *
 * Nothing in `src/` imports this file; it exists only for a local preview.
 */
import { createServer } from 'node:http';
import { DEMO_COINS, DEMO_GLOBAL, DEMO_TRENDING } from '../test/fixtures/market-demo-feed.js';

const PORT = Number(process.env.DEMO_API_PORT || 8799);

const routes = {
  '/api/markets': (url) => {
    const page = Number(url.searchParams.get('page') || 1);
    return page === 1 ? DEMO_COINS : [];
  },
  '/api/trending': () => DEMO_TRENDING,
  '/api/global': () => DEMO_GLOBAL,
  '/api/search': (url) => {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    return DEMO_COINS.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 12);
  }
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://demo');
  const path = url.pathname;
  const handler = routes[path] || (path.startsWith('/api/category/') ? () => DEMO_COINS.slice(0, 14) : null);
  const body = handler ? handler(url) : { error: 'NOT_IN_DEMO' };
  res.writeHead(handler ? 200 : 404, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`▸ demo market API on http://0.0.0.0:${PORT} (${DEMO_COINS.length} coins, fixed feed)`);
});
