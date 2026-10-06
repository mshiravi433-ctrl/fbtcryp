/**
 * Global data probe — the server half of «داده‌های هوش جهانی ناقص است».
 *
 * Pins, one fact at a time, what made the console read «خوانده نشد» although
 * the prices were on the page:
 *   A. an Ostium row with no 24h move gets one from the venue's daily candles,
 *      and a pair that cannot be read stays NULL (never 0);
 *   B. a price of zero is «no price» (Avantis), not a price;
 *   C. a whale transfer party is a label or a short address — never
 *      «[object Object]»;
 *   D. a class that is `OK` but price-only is a class that needs the macro
 *      fallback (the gate that stayed shut in production);
 *   E. the macro graph activates the yield nodes the desk really publishes
 *      (US2Y / US10Y / US2S10S) and never invents a 0% class node;
 *   F. CoinGecko's top-250 yields gold/BTC/ETH anchors and a breadth;
 *   G. money in the briefing reads like money;
 *   H. the macro domain carries the last-good / desk diagnostics through.
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;

const rows = [];
const t = (name, ok, detail = '') => rows.push([name, Boolean(ok), ok ? '' : String(detail).slice(0, 260)]);

const originalFetch = globalThis.fetch;
const seen = [];
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(handler) {
  seen.length = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    seen.push(`${opts?.method || 'GET'} ${u}${opts?.body ? ` ${opts.body}` : ''}`);
    return handler(u, opts);
  };
}

const { ciSource } = await import('../server/ci/sources.js');
const { _resetOstiumDailyForTests } = await import('../server/ostiumDaily.js');
const gi = await import('../server/fios/globalIntel.js');
const { domainHasChange } = await import('../server/fios/crossAsset.js');
const { buildMacroGraph } = await import('../server/fios/macroGraph.js');
const { rankTokenCapitalFlows } = await import('../server/capitalFlows.js');
const { usdEn, usdFa } = await import('../server/fios/briefing.js');

/* ═══ A. Ostium rows get a move from daily candles ═════════════════════════ */
const DAY_S = 86_400;
const nowS = Math.floor(Date.now() / 1000);
const candles = (base, drift) => Array.from({ length: 10 }, (_, i) => {
  const close = base * (1 + drift * i);
  return { time: nowS - (9 - i) * DAY_S, open: close, high: close, low: close, close };
});
const PRICES = {
  prices: [
    { pair: 'XAU-USD', bid: 4172, mid: 4173.6, ask: 4175, isMarketOpen: true, timestampSeconds: nowS },
    { pair: 'EUR-USD', bid: 1.1257, mid: 1.1258, ask: 1.1259, isMarketOpen: true, timestampSeconds: nowS },
    { pair: 'US500-USD', bid: 7832, mid: 7833, ask: 7834, isMarketOpen: true, timestampSeconds: nowS },
    { pair: 'BTC-USD', bid: 85500, mid: 85547, ask: 85600, isMarketOpen: true, timestampSeconds: nowS }
  ]
};
_resetOstiumDailyForTests();
mockFetch((u, opts) => {
  if (u.endsWith('/v1/prices')) return json(PRICES);
  if (u.endsWith('/v1/ohlc')) {
    const body = JSON.parse(opts.body);
    if (body.pair === 'XAU-USD') return json({ data: candles(4000, 0.002) });
    if (body.pair === 'EUR-USD') return json({ data: candles(1.1, -0.001) });
    if (body.pair === 'US500-USD') return new Response('down', { status: 503 });
  }
  return new Response('unexpected', { status: 404 });
});
const rwa = await ciSource('rwaMarkets')();
const bySym = new Map((rwa.rows || []).map((r) => [r.symbol, r]));
t('A1 the feed answers and every priced row survives', rwa.ok && rwa.rows.length === 4, JSON.stringify(rwa.rows?.map((r) => r.symbol)));
t('A2 gold gets a positive 1d move from the venue\'s own daily candles',
  bySym.get('XAU/USD')?.change24hPct > 0 && bySym.get('XAU/USD')?.changeSource === 'ostium:1D-candles', JSON.stringify(bySym.get('XAU/USD')));
t('A3 EUR/USD gets a negative move (the candles fell)', bySym.get('EUR/USD')?.change24hPct < 0);
t('A4 a pair the venue could not serve stays NULL — never 0, never guessed', bySym.get('US500/USD')?.change24hPct === null, JSON.stringify(bySym.get('US500/USD')));
t('A5 a crypto perp is not asked for a daily candle (no wasted request)', !seen.some((s) => s.includes('BTC-USD') && s.includes('/v1/ohlc')), seen.join(' | '));
t('A6 the 7-day move rides along with its basis', Number.isFinite(bySym.get('XAU/USD')?.change7dPct));
const callsA = seen.length;
await ciSource('rwaMarkets')();
t('A7 a second pass inside 30 minutes re-reads only the price feed', seen.length - callsA === 1, `${seen.length - callsA} extra requests`);

/* ═══ B. a price of zero is not a price ════════════════════════════════════ */
const stocks = gi.normalizeStocks({
  instruments: [
    { symbol: 'AAPL', name: 'Apple', price: 0, change24h: null },
    { symbol: 'TSLA', name: 'Tesla', price: null },
    { symbol: 'NVDA', name: 'Nvidia', price: 0 }
  ], source: 'equities-feed:avantis'
}, 1);
t('B1 an all-zero equity read is a PARTIAL domain, not fifteen $0 stocks', stocks.status === 'OK' && stocks.partial === true, JSON.stringify(stocks));
t('B2 …and no row carries a fabricated price', stocks.data.instruments.every((r) => r.priceUsd === null));
const stocksOk = gi.normalizeStocks({ instruments: [{ symbol: 'AAPL', price: 190.5, change24h: 1.2 }], source: 'x' }, 1);
t('B3 a real price survives and the domain is not flagged partial', stocksOk.data.instruments[0].priceUsd === 190.5 && stocksOk.partial !== true);

/* ═══ C. whale parties ═════════════════════════════════════════════════════ */
t('C1 a labelled party reads as its label', gi.partyLabel({ address: '0xabcdef0123456789abcdef', label: 'Binance' }) === 'Binance');
t('C2 an unlabelled address is shortened', gi.partyLabel({ address: '0x1234567890abcdef1234' }) === '0x1234…1234', gi.partyLabel({ address: '0x1234567890abcdef1234' }));
t('C3 a string passes through, an unknown shape is simply not read', gi.partyLabel('Coinbase') === 'Coinbase' && gi.partyLabel({}) === null && gi.partyLabel(42) === null);
const whales = gi.normalizeWhales({
  events: [{ symbol: 'USDC', valueUsd: 2e7, chain: 'ETH', flow: 'transfer', from: { address: '0xaaaaaaaaaaaaaaaaaaaaaa', label: 'Wintermute' }, to: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbb' }, timestamp: 1 }]
}, 1);
const w0 = whales.data.events[0];
t('C4 no event field is the literal «[object Object]»', JSON.stringify(whales).indexOf('[object Object]') === -1, JSON.stringify(w0));
t('C5 from/to carry the label and the short address', w0.from === 'Wintermute' && /^0xbbbb…bbbb$/.test(w0.to), JSON.stringify(w0));

/* ═══ D. the fallback gate ═════════════════════════════════════════════════ */
const priceOnly = { status: 'OK', data: { instruments: [{ symbol: 'XAU/USD', priceUsd: 4173, change24hPct: null }, { symbol: 'XAG/USD', priceUsd: 61, change24hPct: null }] } };
const withMove = { status: 'OK', data: { instruments: [{ symbol: 'XAU/USD', priceUsd: 4173, change24hPct: 0.4 }] } };
t('D1 an OK domain with prices only still NEEDS the fallback (the shut gate)', domainHasChange(priceOnly) === false);
t('D2 an OK domain with a real move does not', domainHasChange(withMove) === true);
t('D3 an unavailable domain needs it, and null is not a move', domainHasChange({ status: 'UNAVAILABLE' }) === false && domainHasChange(null) === false);
t('D4 a null change is not mistaken for zero', domainHasChange({ status: 'OK', data: { instruments: [{ change24hPct: null }, { changePct: '' }] } }) === false);

/* ═══ E. the macro graph ═══════════════════════════════════════════════════ */
const q = (symbol, kind, priceUsd, change1dPct, change7dPct = null) => ({ symbol, name: symbol, kind, priceUsd, change24hPct: change1dPct, change1dPct, change7dPct, source: 'x' });
const graph = buildMacroGraph({
  globalIntel: {
    domains: {
      macro: { status: 'OK', source: 'macro:classifier', data: {
        byTopic: { FED: 2 }, items: [],
        quotes: [q('DXY', 'currency', 101.8, -0.4), q('US10Y', 'rate', 5.31, 0.6), q('US2Y', 'rate', 4.84, 0.2), q('US2S10S', 'curve', 0.47, 5), q('SPX', 'equity', 7833, 0.3), q('SPY', 'equity', 700, 0.2), q('GOLD', 'safe_haven', 4173, 0.9), q('WTI', 'energy', 88.9, -1.1)],
        curve: { symbol: 'US2S10S', spreadPct: 0.47, change7dPct: 5 }
      } },
      rwa: { status: 'OK', source: 'rwa-feed:ostium', data: { instruments: [{ symbol: 'US100/USD', priceUsd: 31300, change24hPct: null }] } }
    }
  }
});
const ids = graph.nodes.map((n) => n.id);
t('E1 the 10-year and 2-year yield nodes now ACTIVATE', ids.includes('yields10y') && ids.includes('yields2y'), ids.join());
t('E2 the 2s10s node exists exactly once', ids.filter((id) => id === 'curve2s10s').length === 1);
t('E3 SPY never overwrites SPX (first reading wins) and ids are unique', new Set(ids).size === ids.length && graph.nodes.find((n) => n.id === 'spx').label === 'S&P 500');
t('E4 the yield edges light (yields10y → btc needs btc, but → spx exists)', graph.edges.some((e) => e.from === 'yields10y' && e.to === 'spx') && graph.edges.some((e) => e.from === 'dxy' && e.to === 'spx'));
t('E5 a class with prices but no move gets NO node (not a confident 0%)', !ids.includes('rwa'), ids.join());
const graph2 = buildMacroGraph({ globalIntel: { domains: { rwa: { status: 'OK', data: { instruments: [{ symbol: 'A', priceUsd: 1, change24hPct: 1.5 }, { symbol: 'B', priceUsd: 1, change24hPct: null }] } } } } });
const rn = graph2.nodes.find((n) => n.id === 'rwa');
t('E6 with one real move the class node averages ONLY real moves (1.5, not 0.75)', rn && rn.change24hPct === 1.5 && rn.withChange === 1, JSON.stringify(rn));

/* ═══ F. CoinGecko anchors + breadth ═══════════════════════════════════════ */
const cg = (id, symbol, price, c24, c7, mcap, dm) => ({ id, symbol, name: id, current_price: price, price_change_percentage_24h: c24, price_change_percentage_7d_in_currency: c7, market_cap: mcap, market_cap_change_24h: dm, market_cap_rank: 1 });
const many = Array.from({ length: 30 }, (_, i) => cg(`c${i}`, `C${i}`, 1, i % 3 === 0 ? -1 : 1, 0, 1e9, i % 3 === 0 ? -1e6 : 1e6));
const ranked = rankTokenCapitalFlows([
  cg('bitcoin', 'btc', 85547, -0.06, 3.19, 1.7e12, -1e9),
  cg('ethereum', 'eth', 2690.8, -0.64, 1.1, 3e11, -2e9),
  cg('pax-gold', 'paxg', 4170, 0.8, 2.4, 1e9, 1e7),
  ...many
]);
t('F1 BTC, ETH and the gold-backed token ride on the same call', ranked.anchors.BTC?.priceUsd === 85547 && ranked.anchors.ETH?.change24hPct === -0.64 && ranked.anchors.PAXG?.change24hPct === 0.8, JSON.stringify(ranked.anchors));
t('F2 the anchor keeps its 7d move', ranked.anchors.BTC.change7dPct === 3.19);
t('F3 breadth counts the whole list, not only the leaders', ranked.breadth?.count === 33 && ranked.breadth.advancing + ranked.breadth.declining === 33, JSON.stringify(ranked.breadth));
t('F4 a thin list produces no breadth rather than a noisy one', rankTokenCapitalFlows([cg('bitcoin', 'btc', 1, 1, 1, 1e9, 1e6)]).breadth === null);

/* ═══ G. money in the briefing ═════════════════════════════════════════════ */
t('G1 twenty-one million dollars is $21M, not $20975k', usdEn(20_975_000) === '$21M', usdEn(20_975_000));
t('G2 …and ۲۱ میلیون دلار with Persian digits', usdFa(20_975_000) === '۲۱ میلیون دلار', usdFa(20_975_000));
t('G3 3.6M keeps one decimal', usdEn(3_600_000) === '$3.6M' && usdFa(3_600_000) === '۳٫۶ میلیون دلار', `${usdEn(3_600_000)} / ${usdFa(3_600_000)}`);
t('G4 small amounts stay whole', usdEn(950) === '$950' && usdFa(950) === '۹۵۰ دلار', `${usdEn(950)} / ${usdFa(950)}`);
t('G5 a billion reads in the language\'s own word', usdFa(2_400_000_000) === '۲٫۴ میلیارد دلار' && usdEn(2_400_000_000) === '$2.4B');

/* ═══ H. the macro domain carries data-quality facts ═══════════════════════ */
const macro = gi.normalizeMacro({ status: 'OK', data: { items: [] } }, {
  items: [q('GOLD', 'safe_haven', 4173, 0.9)], source: 'macroData:ostium', stale: true, staleAgeMs: 3_600_000,
  desks: [{ desk: 'ostium', role: 'independent', count: 6, ok: true, ms: 300 }, { desk: 'ecb', role: 'independent', count: 0, ok: false, error: 'ECB_DEADLINE' }],
  fx: [{ ccy: 'JPY', perUsd: 158.09, change1dPct: -0.09, change7dPct: 0.5, at: 1, source: 'ecb:reference-rates' }]
}, 1);
t('H1 the last-good flag and its age reach the domain', macro.data.stale === true && macro.data.staleAgeMs === 3_600_000);
t('H2 per-desk diagnostics reach the domain (which desk is dark, and why)', macro.data.desks.length === 2 && macro.data.desks[1].error === 'ECB_DEADLINE');
t('H3 the currency table reaches the domain for the globe', macro.data.fx.length === 1 && macro.data.fx[0].ccy === 'JPY');

globalThis.fetch = originalFetch;
const failed = rows.filter((r) => !r[1]);
for (const [name, ok, detail] of rows) console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);
