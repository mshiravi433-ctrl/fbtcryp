/**
 * P2P MARKET PROBE — the Hodl Hodl proxy contract, end to end over real HTTP
 * -----------------------------------------------------------------------------
 * The /buy and /p2p pages went from a link directory (revenue: zero) to an
 * in-app market over Hodl Hodl's public REST API, with the referral link
 * built server-side and the swap path deliberately untouched. This probe is
 * the contract that market must keep. It boots server/app.js on a real port
 * and stubs the upstream at globalThis.fetch, exactly like
 * test/solana-price-probe.mjs, so every row below exercises the same code a
 * phone does.
 *
 * What is proven, line by line as the owner demanded:
 *
 *   1.  SIDE MAPPING. side=buy asks upstream for direction=sell offers and
 *       side=sell for direction=buy — the inversion lives server-side where
 *       both tabs can never disagree. Ghost-side values refuse cleanly.
 *   2.  BOTH PAYMENT SHAPES parse: sell-direction offers carry
 *       payment_method_instructions, buy-direction offers carry
 *       payment_methods, plus plain-string variants. A normaliser that knew
 *       one shape would render the other tab chipless.
 *   3.  MIN/MAX enforcement: an amount outside an offer's range is flagged
 *       (fitsAmount=false) and rank-sunk beneath a pricier offer that fits,
 *       rather than presenting a card that only fails after selection.
 *   4.  REFERRAL: the code exists ONLY when HODLHODL_REF is set, appears in
 *       the join link then and only then, is rejected when malformed, and no
 *       fallback code is ever fabricated (no env ⇒ null joinUrl, everywhere).
 *       HODLHODL_API_KEY is attached as a server-side Bearer and never echoed.
 *   5.  ALLOW-LIST: arbitrary client parameters (evil=1, direction=buy,
 *       api_key=…, a second filters[side]) cannot reach upstream; the egress
 *       URL contains only what offersParams() built.
 *   6.  HONEST FAILURES: upstream 429 and 503 map to 429/UPSTREAM_RATE_LIMIT
 *       and 503/UPSTREAM_UNAVAILABLE — never a 500, never an invented number.
 *   7.  STALE SAFETY: once the TTL lapses and upstream fails, the cached
 *       page is served with stale:true rather than an error (moments-ago
 *       label in the UI relies on this flag).
 *   8.  STATUS HONESTY: before any traffic the state is "unknown", never
 *       "ok" — the /api/solana/oo/status lesson, applied on day one.
 *   9.  SORTING: the buyer sees offers by ascending effective price, the
 *       seller by descending — the desk paying the most fiat is not the one
 *       literally cheapest to buy from. Plus fee fractions → percent units.
 *   10. BITCOIN ADDRESSES: every BIP-173/350 vector accepted/rejected, incl.
 *       the bech32-vs-bech32m rule, mainnet-only policy and base58. A regex
 *       would pass half the invalid set; the checksum does not.
 *
 * Standalone:  node test/p2p-market-probe.mjs
 * The shared runner (test/run.mjs) imports the default export of rows.
 */

import { pathToFileURL } from 'node:url';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';

/* ---- env hygiene: the referral code and API key must behave like deploys - */
const prevRef = process.env.HODLHODL_REF;
const prevKey = process.env.HODLHODL_API_KEY;
delete process.env.HODLHODL_REF;
delete process.env.HODLHODL_API_KEY;

const realFetch = globalThis.fetch;

/* ------------------------------------------------------------------------- */
/* The upstream stub. Decides by URL params, records everything.              */
/* ------------------------------------------------------------------------- */

const seen = []; // { url, headers }

const offerBase = {
  id: 'zz0000',
  side: 'sell',
  asset_code: 'BTC',
  asset_layer: 'BTC',
  title: 'SELL BTC for your currency',
  description: 'Plain vanilla offer',
  currency_code: 'USD',
  price: '50000',
  price_source: 'fixed',
  min_amount: '100',
  max_amount: '60000',
  working_now: true,
  payment_window_minutes: 30,
  fee: { author_fee_rate: '0.005', intermediary_fee_rate: '0.0075' },
  payment_method_instructions: [
    { payment_method_id: 5, payment_method_name: 'SEPA (EU)' },
    'Zelle'
  ],
  trader: {
    login: 'dummy',
    online_status: 'online',
    rating: 0.99,
    trades_count: 241,
    verified: true,
    url: 'https://hodlhodl.com/users/dummy'
  }
};

function respondOffers(u) {
  const p = u.searchParams;
  const side = p.get('filters[side]');
  const amount = p.get('filters[amount]');
  const limit = Number(p.get('pagination[limit]') || 20);
  const offset = Number(p.get('pagination[offset]') || 0);

  let offers = [];
  if (amount === '50') {
    /* Rank trap: cheaper-but-out-of-range must sink BELOW the fit. */
    offers = [
      { ...offerBase, id: 'cheapout', price: '40000', min_amount: '100', max_amount: '1000' },
      { ...offerBase, id: 'pricyfit', price: '70000', min_amount: '5', max_amount: '5000' }
    ];
  } else if (side === 'buy') {
    /* Our SELL tab: three bids out of order — the desc sort must repair it. */
    offers = [
      { ...offerBase, id: 'bid480', side: 'buy', price: '48000',
        payment_methods: [{ id: 11, name: 'SEPA (EU)' }, { id: 12, name: 'Wise' }] },
      { ...offerBase, id: 'bid520', side: 'buy', price: '52000',
        payment_methods: [{ id: 11, name: 'SEPA (EU)' }, { id: 12, name: 'Wise' }] },
      { ...offerBase, id: 'bid510', side: 'buy', price: '51000',
        payment_methods: [{ id: 11, name: 'SEPA (EU)' }, { id: 12, name: 'Wise' }] }
    ];
  } else {
    /* Our BUY tab (direction=sell), also scrambled, plus a Lightning desk and
       the second payment-method shape, plus a junk offer that must survive
       normalisation (missing name) instead of crashing the page. */
    offers = [
      { ...offerBase, id: 'ask510', price: '51000', description: 'x'.repeat(310) },
      { ...offerBase, id: 'ask480', price: '48000' },
      { ...offerBase, id: 'ask500', price: '50000', first_trade_limit: '200' },
      { ...offerBase, id: 'lnFast', price: '49000', asset_layer: 'LN', working_now: false,
        payment_method_instructions: [] },
      { ...offerBase, id: 'noMethod', price: '49500',
        payment_method_instructions: null, payment_methods: null }
    ];
  }

  return {
    status: 'success',
    filters: {},
    sort: { by: 'price', direction: p.get('sort[direction]') || 'asc' },
    pagination: { limit, offset, total: offers.length },
    offers
  };
}

const stubResponds = async (url, init) => {
  const u = new URL(String(url));
  seen.push({ url: String(url), headers: init?.headers || {} });

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (!u.hostname.endsWith('hodlhodl.com') && !u.hostname.includes('example')) {
    throw new Error('PROXY EGRESS TO UNEXPECTED HOST: ' + u.hostname);
  }

  if (u.pathname.startsWith('/api/v1/offers')) {
    if (u.searchParams.get('filters[currency_code]') === 'XRF') {
      return json(429, { status: 'error', error_code: 'rate_limit_exceeded', message: 'rate limit is 2 per 60s' });
    }
    if (u.searchParams.get('filters[currency_code]') === 'XXU') {
      return json(503, { status: 'error', error_code: 'not_available' });
    }
    if (u.searchParams.get('filters[currency_code]') === 'XFL') {
      return new Response('<html>cf interstitial</html>', { status: 500 });
    }
    return json(200, respondOffers(u));
  }
  if (u.pathname.startsWith('/api/v1/payment_methods')) {
    return json(200, {
      status: 'success',
      payment_methods: [
        { id: 1, type: 'bank_transfer', name: 'SEPA (EU)', country_codes: ['DE', 'FR'], global: true },
        { id: 2, type: 'cash', name: 'Cash in person', country_codes: [], global: false },
        { id: 1, type: 'bank_transfer', name: 'SEPA (EU)', country_codes: ['DE', 'FR'], global: true }
      ]
    });
  }
  if (u.pathname.startsWith('/api/v1/currencies')) {
    return json(200, { status: 'success', currencies: [{ code: 'USD', name: 'US Dollar' }, { code: 'EUR', name: 'Euro' }] });
  }
  if (u.pathname.startsWith('/api/v1/countries')) {
    return json(200, { status: 'success', countries: [{ code: 'TR', name: 'Turkey' }] });
  }
  return json(404, { status: 'error', error_code: 'not_found' });
};

async function run() {
  globalThis.fetch = stubResponds;

  const [mod, appMod, cacheMod, addrMod] = await Promise.all([
    import('../server/hodlhodl.js'),
    import('../server/app.js'),
    import('../server/cache.js'),
    import('../src/lib/btcAddress.js')
  ]);
  const { _resetHealthForTests } = mod;
  const app = appMod.default || appMod;
  const { memoryStore } = cacheMod;
  const { btcAddressInfo } = addrMod;

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const get = async (path) => {
    const r = await realFetch(base + path);
    let body = null;
    try { body = await r.json(); } catch { /* non-json */ }
    return { status: r.status, body };
  };
  const lastUrls = (re) => seen.map((s) => s.url).filter((x) => re.test(x));

  try {
    /* -------------------------------------------------- 8. status honesty */
    _resetHealthForTests();
    {
      const s = await get('/api/p2p/status');
      t('status answers 200', s.status === 200);
      t('status is UNKNOWN before any upstream traffic, never "ok"',
        s.body.upstreamState === 'unknown');
      t('status reports refConfigured:false without the env var',
        s.body.refConfigured === false && s.body.keyConfigured === false);
      t('status promises read-only behaviour',
        Array.isArray(s.body.notes) && s.body.notes.some((n) => /read-only/.test(n)));
    }

    /* ------------------------------------------------------ 1. side mapping */
    {
      seen.length = 0;
      const buy = await get('/api/p2p/offers?side=buy');
      const sell = await get('/api/p2p/offers?side=sell');
      const urls = lastUrls(/\/api\/v1\/offers/).map((x) => new URL(x));
      t('our buy tab asks upstream for direction=sell offers',
        urls[0].searchParams.get('filters[side]') === 'sell');
      t('...and sorts ascending (cheapest to buy from, first)',
        urls[0].searchParams.get('sort[direction]') === 'asc');
      t('our sell tab asks upstream for direction=buy offers',
        urls[1].searchParams.get('filters[side]') === 'buy');
      t('...and sorts descending (the best bid, first)',
        urls[1].searchParams.get('sort[direction]') === 'desc');
      t('both tabs answer 200', buy.status === 200 && sell.status === 200);
      t('the proxy echoes back OUR vocabulary, not upstream\'s',
        buy.body.side === 'buy' && sell.body.side === 'sell');
      const bad = await get('/api/p2p/offers?side=horse');
      t('a nonsense side is refused with 400, not proxied',
        bad.status === 400 && bad.body.error === 'BAD_SIDE');
    }

    /* --------------------------------- 2. both payment-method shapes parse */
    {
      const buy = await get('/api/p2p/offers?side=buy');
      const sell = await get('/api/p2p/offers?side=sell');
      const names = (o) => o.paymentMethods.map((m) => m.name);
      const ask = buy.body.offers.find((o) => o.id === 'ask480');
      const bid = sell.body.offers.find((o) => o.id === 'bid480');
      t('payment_method_instructions objects parse (sell-direction offer)',
        names(ask).includes('SEPA (EU)') && names(ask).includes('Zelle'));
      t('payment_methods objects parse (buy-direction offer)',
        names(bid).includes('SEPA (EU)') && names(bid).includes('Wise'));
      t('an offer with NEITHER shape still renders, chipless rather than crashing',
        Boolean(buy.body.offers.find((o) => o.id === 'noMethod')));
      /* The raw field names must not leak into the small stable shape. */
      const raw = JSON.stringify(buy.body.offers[0]);
      t('raw upstream field names stay upstream', !raw.includes('payment_method_instructions'));
    }

    /* ------------------------------------------------ 9. sort + fee units */
    {
      const buy = await get('/api/p2p/offers?side=buy');
      const sell = await get('/api/p2p/offers?side=sell');
      const eff = buy.body.offers.filter((o) => o.effectivePrice != null).map((o) => o.effectivePrice);
      t('buy tab: effective prices non-decreasing',
        eff.every((v, i) => i === 0 || v >= eff[i - 1] - 1e-9));
      const sellPrices = sell.body.offers.filter((o) => o.price != null).map((o) => o.price);
      t('sell tab: bids non-increasing',
        sellPrices.every((v, i) => i === 0 || v <= sellPrices[i - 1] + 1e-9));
      const o = buy.body.offers[0];
      t('fee fractions arrive as percents (0.0075 -> 0.75)',
        Math.abs((o.fee?.takerPct ?? 0) - 0.75) < 1e-9 &&
        Math.abs((o.fee?.authorPct ?? 0) - 0.5) < 1e-9);
      const long = buy.body.offers.find((x) => x.id === 'ask510');
      t('multi-kilobyte descriptions are trimmed to card size',
        (long.description ?? '').length <= 280);
    }

    /* ------------------------------------------------- 3. min/max + quote */
    {
      const r = await get('/api/p2p/offers?side=buy&currency=USD&amount=50');
      const cheapOut = r.body.offers.find((o) => o.id === 'cheapout');
      const pricyFit = r.body.offers.find((o) => o.id === 'pricyfit');
      t('an amount below the offer minimum is rejected (fitsAmount=false)',
        cheapOut.fitsAmount === false);
      t('an amount inside the range fits', pricyFit.fitsAmount === true);
      t('the fitting offer outranks a cheaper out-of-range one',
        r.body.offers.indexOf(pricyFit) < r.body.offers.indexOf(cheapOut));
      t('the requested amount was forwarded upstream too',
        lastUrls(/\/offers/).some((x) => new URL(x).searchParams.get('filters[amount]') === '50'));

      const qb = await get('/api/p2p/offers?side=buy&currency=USD&amount=5000');
      const ob = qb.body.offers.find((o) => o.id === 'ask500') ?? qb.body.offers[0];
      t('buy quote: you pay fiat, you get net BTC after the desk fee',
        ob.quote.direction === 'buy' && ob.quote.payFiat === 5000 &&
        Math.abs(ob.quote.grossBtc - 0.1) < 1e-8 && Math.abs(ob.quote.netBtc - 0.09925) < 1e-8);

      const qs = await get('/api/p2p/offers?side=sell&currency=USD&amount=2000');
      const os = qs.body.offers[0];
      t('sell quote: deposit = trade + fee, receive fiat unchanged',
        os.quote.direction === 'sell' && os.quote.receiveFiat === 2000 &&
        os.quote.tradeBtc != null && os.quote.depositBtc > os.quote.tradeBtc);
    }

    /* ------------------------------------------------------- layer filter */
    {
      const onOnly = await get('/api/p2p/offers?side=buy&layer=onchain');
      const fastOnly = await get('/api/p2p/offers?side=buy&layer=fast');
      t('layer=onchain keeps only BTC-layer desks',
        onOnly.body.offers.length > 0 && onOnly.body.offers.every((o) => o.onchain));
      t('layer=fast keeps only the fast-layer desks',
        fastOnly.body.offers.length > 0 && fastOnly.body.offers.every((o) => !o.onchain));
      t('a non-working desk is marked, not removed',
        Boolean(fastOnly.body.offers.find((o) => o.id === 'lnFast' && o.workingNow === false)));
    }

    /* ----------------------------------------------------- 5. allow-list */
    {
      seen.length = 0;
      await get('/api/p2p/offers?side=buy&currency=USD&evil=1&direction=buy&api_key=abc' +
                '&filters[side]=buy&filters[amount]=999' +
                '&paymentMethod=hacked&country=!!&amount=12.345');
      const bad = lastUrls(/\/offers/).length;
      t('parameter junk the validator refuses never produces an upstream call',
        bad === 0);

      seen.length = 0;
      await get('/api/p2p/offers?side=buy&currency=USD&evil=1&direction=buy&api_key=abc&filters[side]=buy');
      const u = new URL(lastUrls(/\/offers/)[0]);
      t('arbitrary parameters cannot leak upstream',
        !u.searchParams.has('evil') && !u.searchParams.has('direction') &&
        !u.searchParams.has('api_key'));
      t('the client cannot override the side mapping',
        u.searchParams.getAll('filters[side]').join(',') === 'sell');
      /* paymentMethod must be the numeric id upstream expects */
      const pm = await get('/api/p2p/offers?side=buy&currency=USD&paymentMethod=hacked');
      t('a non-numeric payment method id is refused with 400',
        pm.status === 400 && pm.body.error === 'BAD_PAYMENT_METHOD');
      const am = await get('/api/p2p/offers?side=buy&currency=USD&amount=12.345');
      t('an over-precise amount is refused with 400',
        am.status === 400 && am.body.error === 'BAD_AMOUNT');
    }

    /* -------------------------------------------------- 6. honest failures */
    {
      const r429 = await get('/api/p2p/offers?side=buy&currency=XRF');
      t('upstream 429 -> 429 UPSTREAM_RATE_LIMIT, retryable — not a 500',
        r429.status === 429 && r429.body.error === 'UPSTREAM_RATE_LIMIT' && r429.body.retryable === true);
      const r503 = await get('/api/p2p/offers?side=buy&currency=XXU');
      t('upstream 503 -> 503 UPSTREAM_UNAVAILABLE, retryable — not a 500',
        r503.status === 503 && r503.body.error === 'UPSTREAM_UNAVAILABLE' && r503.body.retryable === true);
      const rFail = await get('/api/p2p/offers?side=buy&currency=XFL');
      t('upstream junk -> 502 UPSTREAM_FAILED, retryable — still not a 500',
        rFail.status === 502 && rFail.body.error === 'UPSTREAM_FAILED' && rFail.body.retryable === true);
    }

    /* ----------------------------------------------------- 7. stale safety */
    {
      /* Warm the USD page, then expire the TTL by hand (only reachable in
         tests via the exported memoryStore seam) and fail upstream next. */
      const warm = await get('/api/p2p/offers?side=buy&currency=USD&layer=fast');
      t('the fast-page warmed the cache', warm.status === 200 && warm.body.offers.length > 0);
      for (const [k, v] of memoryStore) {
        if (k.startsWith('hh:offers:')) memoryStore.set(k, { ...v, expires: Date.now() - 1 });
      }
      const orig = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), headers: init?.headers || {} });
        return new Response('upstream exploded', { status: 500 });
      };
      const cold = await get('/api/p2p/offers?side=buy&currency=USD&layer=fast');
      globalThis.fetch = orig;
      t('a dead upstream serves the cached page with stale:true, not an error',
        cold.status === 200 && cold.body.stale === true && cold.body.offers.length > 0);
    }

    /* ------------------------------------------------------ 4. referral */
    {
      /* unset: honest and complete without it */
      const r = await get('/api/p2p/offers?side=buy&currency=EUR');
      const o = r.body.offers[0];
      t('without HODLHODL_REF: refConfigured=false', r.body.refConfigured === false);
      t('...the offer link still opens the specific offer',
        o.trade.offerUrl.startsWith('https://hodlhodl.com/offers/'));
      t('...and NO join link is fabricated', o.trade.joinUrl === null);
      t('...and response text contains no referral param at all',
        !JSON.stringify(r.body).includes('ref=') && !JSON.stringify(r.body).includes('affiliate'));

      process.env.HODLHODL_REF = 'YPLJ';
      const r2 = await get('/api/p2p/offers?side=buy&currency=GBP');
      const o2 = r2.body.offers[0];
      t('with HODLHODL_REF set: refConfigured=true', r2.body.refConfigured === true);
      t('...the join link carries exactly our code',
        o2.trade.joinUrl === 'https://hodlhodl.com/join/YPLJ');
      t('the status route says the code is configured',
        (await get('/api/p2p/status')).body.refConfigured === true);

      process.env.HODLHODL_REF = 'invalid code!';
      const r3 = await get('/api/p2p/offers?side=buy&currency=TRY');
      t('a malformed env value disables referral instead of building junk links',
        r3.body.refConfigured === false && r3.body.offers[0].trade.joinUrl === null);
      delete process.env.HODLHODL_REF;
    }

    /* -------------------------------------- 4b. API key: attached, not echo */
    {
      process.env.HODLHODL_API_KEY = 'probe-SECRET-key-9911';
      seen.length = 0;
      const r = await get('/api/p2p/offers?side=buy&currency=AED');
      const auth = seen.find((s) => /\/offers/.test(s.url))?.headers?.authorization;
      t('the optional key is attached as a server-side Bearer', auth === 'Bearer probe-SECRET-key-9911');
      t('no route ever echoes the key back',
        !JSON.stringify(r.body).includes('probe-SECRET-key-9911'));
      const s = await get('/api/p2p/status');
      t('...not even the status route', !JSON.stringify(s.body).includes('probe-SECRET-key-9911'));
      delete process.env.HODLHODL_API_KEY;
    }

    /* ----------------------------------------- meta routes + final status */
    {
      const pm = await get('/api/p2p/payment-methods');
      t('payment methods parse and de-dupe by id',
        pm.status === 200 && pm.body.paymentMethods.length === 2 &&
        pm.body.paymentMethods[0].id === '1' && pm.body.paymentMethods[0].global === true);
      const cur = await get('/api/p2p/currencies');
      const ctr = await get('/api/p2p/countries');
      t('currencies and countries answer in the small shape',
        cur.body.currencies[0].code === 'USD' && ctr.body.countries[0].code === 'TR');
      const badC = await get('/api/p2p/payment-methods?country=!!');
      t('a garbage country on the meta route is refused with 400',
        badC.status === 400 && badC.body.error === 'BAD_COUNTRY');

      _resetHealthForTests();
      const ok = await get('/api/p2p/offers?side=buy&currency=RUB');
      const s = await get('/api/p2p/status');
      t('after real traffic the status turns ok from the traffic itself',
        ok.status === 200 && s.body.upstreamState === 'ok' && typeof s.body.lastOkAt === 'number');
    }

    /* ------------------------------------------- 10. bitcoin addresses */
    {
      const valid = {
        'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4': 'segwit_v0',
        'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3': 'segwit_v0',
        'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0': 'segwit_v1',
        'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y': 'segwit_v1',
        'BC1SW50QGDZ25J': 'segwit_v16',
        'bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs': 'segwit_v2',
        '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH': 'p2pkh',
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy': 'p2sh'
      };
      let badV = [];
      for (const [addr, want] of Object.entries(valid)) {
        const i = btcAddressInfo(addr);
        if (!i.valid || i.type !== want) badV.push(`${addr}:${i.type}`);
      }
      t(`all 8 spec-valid addresses parse with the right class${badV.length ? ' — failed: ' + badV.join(', ') : ''}`,
        badV.length === 0);

      const invalid = [
        'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',       // valid TESTNET — mainnet-only policy
        'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd', // v1 in plain bech32
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh',       // v0 in bech32m
        'bc1pw5dgrnzv',                                    // 1-byte witness program
        'BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R', // bad version
        'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z2e72q4k9hcz7vq47Zagq',   // mixed case
        'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf', // >4-bit zero padding
        '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMJ',              // base58 checksum broken (last char)
        '0x7130d2A12B9BCbFAe4f2634d864A1E1Ce3Ead9c',       // an EVM address is NOT a BTC address
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'       // one-char-off segwit
      ];
      const passed = invalid.filter((a) => btcAddressInfo(a).valid);
      t(`all 10 bad addresses are refused (checksum, not regex)${passed.length ? ' — wrongly valid: ' + passed.join(', ') : ''}`,
        passed.length === 0);
    }
  } finally {
    server.close();
    globalThis.fetch = realFetch;
    if (prevRef != null) process.env.HODLHODL_REF = prevRef; else delete process.env.HODLHODL_REF;
    if (prevKey != null) process.env.HODLHODL_API_KEY = prevKey; else delete process.env.HODLHODL_API_KEY;
  }

  return rows;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const promise = run();

export default await promise;

if (isMain) {
  let failed = 0;
  for (const [name, ok] of await promise) {
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} ${name}`);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}
