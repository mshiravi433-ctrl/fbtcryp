/**
 * FBT Insurance OS — MARKETPLACE probe: "select product → quote with productId".
 *
 * The bug this guards against: the quote form used to send only
 * `protectionType`, so every LIVE provider that prices per product (Nexus
 * Mutual, code PRODUCT_REQUIRED) refused to quote and the user saw "no
 * eligible protection" while the provider was healthy.
 *
 * Offline-friendly: runs the real Express router against the sandbox
 * providers (dev/test) and asserts the pure adapter/engine behaviour for the
 * live adapter without ever needing the provider API.
 *
 *   1. GET /products?chainId=…  → real rows with id/kind/supportedChains.
 *   2. Picking a product of the selected kind and POSTing its productId to
 *      /quote returns quotes for THAT product (quote.productId echoes it).
 *   3. The productId → product resolution also works with a foreign
 *      productId (wrong kind for the type): the engine quotes by product,
 *      never by guessing.
 *   4. Live adapter honesty: Nexus without productId → PRODUCT_REQUIRED;
 *      with productId the request proceeds past product validation.
 *   5. UI contract: the marketplace loads products for the selected chain,
 *      sends productId in the quote body, renders product details before the
 *      quote and the honest "no product for this network" empty state; the
 *      PRODUCT_REQUIRED copy is the user-facing one in fa; new labels exist
 *      in all 12 locales.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0;
const ok = (name) => { pass += 1; console.log('  ✓', name); };
const ROOT = new URL('../../', import.meta.url).pathname;
const WALLET = '0x1111111111111111111111111111111111111111';

/* ------------------------------ 1–3. HTTP flow ------------------------------ */
{
  const express = (await import('express')).default;
  const { insuranceRouter } = await import('../../server/insurance/router.js');
  const app = express();
  app.use(express.json());
  app.use('/api/insurance', insuranceRouter());
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  const get = async (p) => (await fetch(`http://127.0.0.1:${port}/api/insurance${p}`)).json();
  const post = async (p, b) => (await fetch(`http://127.0.0.1:${port}/api/insurance${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  // 1. products for the selected chain — the selector's data source
  const chainId = 56;
  const productsRes = await get(`/products?chainId=${chainId}`);
  assert.equal(productsRes.ok, true);
  const products = productsRes.data.products;
  assert.ok(Array.isArray(products) && products.length > 0, 'sandbox products expected in dev/test');
  for (const p of products) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0, 'product id');
    assert.ok(typeof p.kind === 'string', 'product kind');
    assert.ok(Array.isArray(p.supportedChains) && p.supportedChains.includes(chainId), 'product on requested chain');
    assert.ok(p.providerId && p.providerName, 'router annotates providerId/providerName');
  }
  ok(`GET /products?chainId=${chainId} → ${products.length} real product rows (id/kind/supportedChains/provider)`);

  // the UI filters by the selected protection type (product.kind)
  const type = 'lending';
  const typeProducts = products.filter((p) => p.kind === type);
  assert.ok(typeProducts.length >= 1, `at least one ${type} product`);
  assert.ok(typeProducts.every((p) => p.kind === type));
  ok(`filter by kind="${type}" → ${typeProducts.length} product(s): ${typeProducts.map((p) => p.id).join(', ')}`);

  // a product not on this chain must NOT be returned for it
  const other = await get('/products?chainId=1');
  assert.ok(other.data.products.every((p) => p.supportedChains.includes(1)));
  ok('chain filter is strict: /products?chainId=1 only lists products that support chain 1');

  // 2. select product → quote with productId
  const selected = typeProducts[0];
  const quote = await post('/quote', {
    walletAddress: WALLET, chainId, protectionType: type, productId: selected.id,
    coverageAmount: '10000', durationDays: 28, termsAccepted: true
  });
  assert.equal(quote.ok, true, JSON.stringify(quote.errors));
  assert.ok(quote.data.quotes.length >= 1, 'quote returned for the selected product');
  const mine = quote.data.quotes.find((q) => q.provider === selected.providerId);
  assert.ok(mine, 'the provider that published the selected product quoted it');
  assert.equal(mine.productId, selected.id, 'quote.productId echoes the selected productId');
  assert.equal(mine.product?.id, selected.id);
  assert.equal(mine.protectionType, type);
  assert.equal(mine.chainId, chainId);
  assert.equal(mine.durationDays, 28);
  assert.ok(mine.quoteId && mine.termsHash && typeof mine.totalCostUsd === 'string');
  ok(`POST /quote with productId=${selected.id} → quote ${mine.quoteId} for that product (premium $${mine.premiumUsd}, total $${mine.totalCostUsd})`);

  // the quote is retrievable and still carries the productId (review page)
  const byId = await get(`/quotes/${mine.quoteId}`);
  assert.equal(byId.ok, true);
  assert.equal(byId.data.quote.productId, selected.id);
  ok('GET /quotes/:id keeps productId on the stored quote');

  // 3. productId wins over protectionType: a product of a different kind is
  //    still quoted by id (the engine resolves by product, never by guessing)
  const foreign = products.find((p) => p.kind !== type && p.providerId === selected.providerId);
  if (foreign) {
    const q2 = await post('/quote', {
      walletAddress: WALLET, chainId, protectionType: type, productId: foreign.id,
      coverageAmount: '10000', durationDays: 28, termsAccepted: true
    });
    assert.equal(q2.ok, true);
    const hit = q2.data.quotes.find((q) => q.provider === foreign.providerId);
    assert.ok(hit && hit.productId === foreign.id, 'engine resolved the product by id');
    ok(`productId takes precedence over protectionType (quoted ${foreign.id} of kind ${foreign.kind})`);
  }

  // without productId the sandbox still quotes by kind (dev only) — the LIVE
  // adapter path is asserted separately below
  const q3 = await post('/quote', { walletAddress: WALLET, chainId, protectionType: type, coverageAmount: '10000', durationDays: 28, termsAccepted: true });
  assert.equal(q3.ok, true);
  ok('sandbox quote by kind still works when the form has no product (dev/test only)');

  server.close();
}

/* --------------------- 4. LIVE adapter honesty (offline) --------------------- */
{
  const { NexusMutualAdapter } = await import('../../server/insurance/adapters/nexus-mutual.js');
  const nexus = new NexusMutualAdapter();
  const base = { walletAddress: WALLET, chainId: 1, coverageAmountMicro: 10_000_000n, durationDays: 28, termsAccepted: true, protectionType: 'lending' };

  const noProduct = await nexus.getQuote({ ...base });
  assert.equal(noProduct.ok, false);
  assert.equal(noProduct.error, 'PRODUCT_REQUIRED', 'Nexus needs a concrete product — this is the bug the selector fixes');
  ok('nexus getQuote WITHOUT productId → PRODUCT_REQUIRED (protectionType alone is not enough)');

  const withProduct = await nexus.getQuote({ ...base, productId: 'nexus-97' });
  assert.equal(withProduct.ok, false, 'offline: no API, so no fabricated quote');
  assert.notEqual(withProduct.error, 'PRODUCT_REQUIRED', 'productId accepted → validation moves past the product check');
  assert.ok(['PROVIDER_UNAVAILABLE', 'QUOTE_REJECTED_BY_PROVIDER', 'PROVIDER_HTTP_ERROR', 'NOT_CONFIGURED'].includes(withProduct.error), withProduct.error);
  ok(`nexus getQuote WITH productId=nexus-97 → passes product validation (offline result: ${withProduct.error})`);

  const outOfRange = await nexus.getQuote({ ...base, productId: 'nexus-97', durationDays: 7 });
  assert.equal(outOfRange.error, 'DURATION_OUT_OF_RANGE');
  ok('nexus rejects 7 days (28–365) — the form defaults to 28 and only offers 28/90/180/365');

  // the server accepts productId in the quote body (no server change needed)
  const { normalizeQuoteInput } = await import('../../server/insurance/service.js');
  const n = normalizeQuoteInput({ walletAddress: WALLET, chainId: 1, protectionType: 'lending', productId: 'nexus-97', coverageAmount: '10000', durationDays: 28, termsAccepted: true });
  assert.equal(n.productId, 'nexus-97');
  assert.equal(n.protectionType, 'lending');
  assert.equal(n.termsAccepted, true);
  ok('normalizeQuoteInput carries productId through unchanged');
}

/* --------------------------- 5. UI source contract --------------------------- */
{
  const market = readFileSync(`${ROOT}src/pages/insurance/InsuranceMarketplace.jsx`, 'utf8');
  assert.ok(market.includes('insuranceApi.products(chainId)'), 'marketplace must load products for the selected chain');
  assert.ok(/productId:\s*selectedProduct\?\.id/.test(market), 'quote body must carry the selected productId');
  assert.ok(market.includes('insuranceApi.quote({'), 'quote call present');
  assert.ok(/p\.kind === type/.test(market), 'products are filtered by the selected protection type (product.kind)');
  ok('marketplace: loads /products?chainId, filters by kind, sends productId in POST /quote');

  for (const field of ['minPrice', 'gracePeriodDays', 'coverAssets', 'termsUrl', 'annexUrl', 'exclusions']) {
    assert.ok(market.includes(`selectedProduct.${field}`), `product details must show ${field}`);
  }
  assert.ok(market.includes('ins-product-details'), 'product details panel rendered before quoting');
  ok('marketplace: product details (minPrice, gracePeriodDays, coverAssets, terms/annex links, exclusions) shown before the quote');

  assert.ok(market.includes("t('insurance.market.noProductsForChain')"), 'honest empty state when no product exists for the chain');
  assert.ok(market.includes("t('insurance.reason.PRODUCT_REQUIRED')"), 'PRODUCT_REQUIRED copy used as the inline hint');
  assert.ok(/disabled=\{busy \|\| !wallet \|\| needsProduct\}/.test(market), 'CTA disabled until a product is chosen (when products exist)');
  assert.ok(!market.includes('<details'), 'marketplace must not duplicate the transparency accordion');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(market), 'no emoji icons in the marketplace');
  ok('marketplace: honest empty state, PRODUCT_REQUIRED hint, CTA gated on product selection, SVG icons only');

  const fa = JSON.parse(readFileSync(`${ROOT}src/i18n/locales/fa.json`, 'utf8'));
  assert.equal(fa.insurance.reason.PRODUCT_REQUIRED, 'ابتدا پروتکل مورد بیمه را انتخاب کنید');
  assert.equal(fa.insurance.market.noProductsForChain, 'برای این شبکه محصولی موجود نیست');
  ok('fa: PRODUCT_REQUIRED → «ابتدا پروتکل مورد بیمه را انتخاب کنید»; empty state → «برای این شبکه محصولی موجود نیست»');

  const REQUIRED = ['product', 'productPlaceholder', 'productRequiredHint', 'loadingProducts', 'productsLoadFailed', 'noProductsForChain', 'noProductsForType', 'noProductsHint', 'switchToEthereum', 'minPrice', 'minPriceValue', 'gracePeriod', 'coverAssets', 'productId', 'priceNote', 'membershipRequired', 'productHint', 'durationHint', 'daysShort'];
  for (const locale of ['en', 'fa', 'ar', 'es', 'fr', 'tr', 'ru', 'hi', 'id', 'pt', 'ur', 'zh']) {
    const doc = JSON.parse(readFileSync(`${ROOT}src/i18n/locales/${locale}.json`, 'utf8'));
    for (const k of REQUIRED) assert.ok(doc.insurance?.market?.[k], `${locale} missing insurance.market.${k}`);
    assert.ok(doc.insurance?.market?.productCount_other, `${locale} missing insurance.market.productCount_other`);
    assert.ok(doc.insurance?.market?.graceDays_other, `${locale} missing insurance.market.graceDays_other`);
    assert.ok(doc.insurance?.reason?.PRODUCT_REQUIRED, `${locale} missing insurance.reason.PRODUCT_REQUIRED`);
    for (const k of ['summaryHint', 'sectionWallet', 'sectionFlow', 'sectionRisk', 'sectionFees', 'sectionClaims']) assert.ok(doc.insurance?.explain?.[k], `${locale} missing insurance.explain.${k}`);
  }
  ok('all 12 locales carry the new marketplace + transparency labels');
}

console.log(`\nPASS ${pass} insurance-marketplace assertions`);
process.exit(0);
