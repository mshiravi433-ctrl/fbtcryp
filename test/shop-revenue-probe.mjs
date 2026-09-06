/**
 * SHOP REVENUE PROBE — the three things the shop now does that it did not.
 * ---------------------------------------------------------------------------
 * Run: npm run test:shop-revenue   (also imported by `npm test`)
 *
 * Every assertion below calls the REAL exported function. Nothing here
 * re-implements the logic under test, which is the whole point: a spread
 * percentage computed by a copy of `spreadOverFace()` would pass while the
 * shipped one divides lira by dollars.
 *
 * Three changes are covered:
 *
 *   1. `spreadOverFace` in server/shop.js — the provider's margin over face
 *      value, surfaced instead of being discovered on their checkout. The
 *      dangerous failure is a CONFIDENT WRONG NUMBER: the Turkish catalogue
 *      prices Steam in lira, and lira-over-dollars produces a plausible
 *      percentage that is pure nonsense. So the interesting assertions are the
 *      ones that must come back null.
 *   2. `siteShareUrl` in src/lib/referral.js — a shareable deep link back into
 *      this app carrying the sharer's referral code.
 *   3. `brandSlug` in src/lib/shopLinks.js — the one slug used by BOTH the
 *      outbound provider URL and the inbound shared link, so the two cannot
 *      drift and leave a shared link selecting nothing.
 */
import assert from 'node:assert/strict';

/* ───────────────────────── 1. the spread, server side ─────────────────── */
const { fetchShopProducts } = await import('../server/shop.js');

/**
 * One call through the real mapper.
 *
 * `fetch` is replaced at the boundary because that is the only part of this
 * module that talks to the network; everything downstream of the JSON — the
 * cleaning, the pricing, the spread, the sort — is the shipped code.
 */
async function productsFor(products, coin = 'USDC', extra = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{ brand: 'Steam', family: 'Steam', logo_url: null, products, ...extra }]
  });
  try {
    return await fetchShopProducts({ country: 'US', family: 'Steam', coin }, { headers: {} });
  } finally {
    globalThis.fetch = real;
  }
}

const byId = (rows, id) => rows.find((r) => r.id === id);

/* The canonical case, straight off their own pricing: a $50 card costs
   $53.86, so the margin is 7.7% and it is now visible before checkout. */
{
  const out = await productsFor([{ product_id: 'a', localized_denomination: '$50', denomination: '50', coin_amount: '53.86' }]);
  assert.equal(byId(out.rows, 'a').spreadPct, 7.7);
  assert.equal(out.bestSpreadPct, 7.7);
}

/* Thousands separators must not turn $1,000 into a parse failure. */
{
  const out = await productsFor([{ product_id: 'b', localized_denomination: '$1,000', denomination: '1000', coin_amount: '1050' }]);
  assert.equal(byId(out.rows, 'b').spreadPct, 5);
}

/*
 * THE TRAP. A face value with no dollar sign and no stated currency — which is
 * what a Turkish catalogue returns for a lira-denominated card. Subtracting it
 * from a USDC price would produce a large, confident, entirely wrong number.
 * It must come back null, which renders as no line at all.
 */
{
  const out = await productsFor([{ product_id: 'c', localized_denomination: '250 TRY', denomination: '250', coin_amount: '7.2' }]);
  assert.equal(byId(out.rows, 'c').spreadPct, null);
  assert.equal(out.bestSpreadPct, null, 'a brand with no provable spread reports none');
}

/* An explicitly non-USD denomination currency is a definite "no", even when a
   numeric `denomination` sits right there looking usable. */
{
  const out = await productsFor([
    { product_id: 'd', localized_denomination: '$50', denomination_currency: 'TRY', denomination: '250', coin_amount: '53' }
  ]);
  assert.equal(byId(out.rows, 'd').spreadPct, null);
}

/* An explicit USD currency is accepted on the strength of the field alone. */
{
  const out = await productsFor([
    { product_id: 'e', denomination_currency: 'USD', denomination: '25', coin_amount: '26.5' }
  ]);
  assert.equal(byId(out.rows, 'e').spreadPct, 6);
}

/* Priced in something that is not a dollar stablecoin: the subtraction would
   compare two different units, so nothing is claimed. */
{
  const out = await productsFor(
    [{ product_id: 'f', localized_denomination: '$50', denomination: '50', coin_amount: '0.4' }],
    'SOL'
  );
  assert.equal(byId(out.rows, 'f').spreadPct, null);
}

/*
 * The gate follows the coin beside the NUMBER, not the coin we asked for.
 * We request USDC; they may answer in something else.
 *
 * The amount is chosen so that a WRONG gate produces a plausible percentage
 * rather than an absurd one: 48 EUR against a $50 face value is -4%, which
 * sails through the range guard. A SOL-priced example at 0.4 would have been
 * caught by the range check instead and proved nothing about the coin gate —
 * that version of this test passed while the bug was still in the code.
 */
{
  const out = await productsFor([
    { product_id: 'l', localized_denomination: '$50', denomination: '50', coin_amount: '48', coin: 'EUR' }
  ], 'USDC');
  assert.equal(byId(out.rows, 'l').coin, 'EUR', 'the row reports the coin they actually answered in');
  assert.equal(byId(out.rows, 'l').spreadPct, null, 'a euro price is not compared against a dollar face value');
}

/* Implausible readings are parse mistakes, not prices. */
{
  const out = await productsFor([
    { product_id: 'g', localized_denomination: '$50', denomination: '50', coin_amount: '20' },
    { product_id: 'h', localized_denomination: '$50', denomination: '50', coin_amount: '900' }
  ]);
  assert.equal(byId(out.rows, 'g').spreadPct, null, 'a 60% discount is a bad parse');
  assert.equal(byId(out.rows, 'h').spreadPct, null, 'a 1700% margin is a bad parse');
}

/* A missing price stays unpriced rather than becoming 0 — the same reflex the
   existing sort test pins, now on the new field. */
{
  const out = await productsFor([{ product_id: 'i', localized_denomination: '$50', denomination: '50', coin_amount: null }]);
  assert.equal(byId(out.rows, 'i').coinAmount, null);
  assert.equal(byId(out.rows, 'i').spreadPct, null);
}

/* The brand-level figure is the cheapest spread, not the first row: the list
   is ordered by absolute price, and the smallest note is not always the best
   deal. */
{
  const out = await productsFor([
    { product_id: 'j', localized_denomination: '$10', denomination: '10', coin_amount: '12' },
    { product_id: 'k', localized_denomination: '$100', denomination: '100', coin_amount: '103' }
  ]);
  assert.equal(out.rows[0].id, 'j', 'the list is still cheapest-first by price');
  assert.equal(out.bestSpreadPct, 3, '...but the best deal is the 3% card, not the 20% one');
}

/* ─────────────── 2. the client passes the figure through ──────────────── */
const client = await import('../src/lib/shop.js');

{
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ brand: 'Steam', rows: [{ id: 'a', label: '$50', coinAmount: 53.86, coin: 'USDC', spreadPct: 7.7 }], bestSpreadPct: 7.7 })
  });
  try {
    const d = await client.fetchShopProducts('US', 'Steam');
    assert.equal(d.bestSpreadPct, 7.7);
    assert.equal(d.live, true);
  } finally {
    globalThis.fetch = real;
  }
}

/* A non-numeric value from upstream must not reach a sentence as "undefined%". */
{
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [], bestSpreadPct: 'n/a' }) });
  try {
    const d = await client.fetchShopProducts('US', 'Steam');
    assert.equal(d.bestSpreadPct, null);
  } finally {
    globalThis.fetch = real;
  }
}

/* ─────────────── 3. shared links: one slug, both directions ───────────── */
const { brandSlug } = await import('../src/lib/shopLinks.js');
const { siteShareUrl, captureReferral } = await import('../src/lib/referral.js');

/* The slug is URL-safe and keeps the dot, which their own catalogue needs. */
assert.equal(brandSlug('Amazon.com'), 'amazon.com');
assert.equal(brandSlug('Travel & Flights'), 'travel_flights');
assert.equal(brandSlug('  Steam  '), 'steam');

/* The link a share produces must be readable by the page that receives it.
   This is the round trip, asserted as a round trip rather than as two
   separate strings that happen to match today. */
for (const family of ['Steam', 'Amazon.com', 'Travel & Flights']) {
  const slug = brandSlug(family);
  const url = siteShareUrl(`/shop?c=TR&b=${encodeURIComponent(slug)}`, 'FBT123ABC');
  const received = new URL(url);
  const [, hashQuery] = received.hash.split('?');
  const params = new URLSearchParams(hashQuery);
  assert.equal(params.get('c'), 'TR');
  assert.equal(brandSlug(params.get('b')), slug, `${family}: the slug survives the round trip`);
  assert.equal(params.get('ref'), 'FBT123ABC', 'the referral code rides along');
  assert.ok(url.startsWith('https://'), 'the link is absolute, never relative');
}

/*
 * End to end, through the REAL capture function: the link one user shares is
 * the link another user's app reads at boot. `captureReferral` takes the hash
 * separately because HashRouter keeps the query after `#`, and this is the
 * assertion that would catch a link built with `?ref=` before the hash — the
 * shape that looks right in the address bar and attributes nobody.
 */
{
  const url = siteShareUrl('/shop?c=TR&b=steam', 'FBTSHARE1');
  const hash = new URL(url).hash;
  assert.equal(captureReferral('', '', hash), 'FBTSHARE1', 'a shared shop link is a working referral');
}

/* A missing or malformed code degrades to a plain link — the share still
   works, it simply credits nobody. Never a broken URL. */
{
  const url = siteShareUrl('/shop?c=TR&b=steam', null);
  assert.ok(!/[?&]ref=/.test(url), 'no empty ref parameter');
  assert.ok(url.includes('/#/shop?c=TR&b=steam'));
  assert.ok(siteShareUrl('/shop', 'a b c').includes('/#/shop'), 'an invalid code is dropped, not encoded');
}

/* A path with no query of its own still gets a well-formed separator. */
assert.ok(siteShareUrl('/shop', 'FBT123ABC').includes('/#/shop?ref=FBT123ABC'));

console.log('shop revenue probe passed');
