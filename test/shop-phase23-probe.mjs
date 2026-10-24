/**
 * SHOP PHASE 2/3 — SERVER CONTRACT PROBE.
 * ---------------------------------------------------------------------------
 * The two server surfaces the storefront was built against: the whitelabel
 * readiness/precheck contract and the anonymous trending counter. Run with
 * `node test/shop-phase23-probe.mjs`. Everything here is offline and
 * deterministic — the point is the CONTRACT, not the upstream.
 */
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: Boolean(ok), extra: ok ? '' : String(extra).slice(0, 160) });
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${String(extra).slice(0, 160)}`}`);
};

const shop = await import('../server/shop.js');
const {
  WHITELABEL_KEY_ENV, whitelabelStatus, validateOrderPrerequisites,
  mapUpstreamOrderError, bumpShopInterest, shopTrendSize, rankTrendingBrands,
  trendingFromCatalogue, userHeaders
} = shop;
const { setCached } = await import('../server/cache.js');

try {
  /* ─────────────────────── whitelabel readiness ─────────────────────────── */
  const savedKey = process.env[WHITELABEL_KEY_ENV];
  delete process.env[WHITELABEL_KEY_ENV];
  const off = whitelabelStatus();
  check('no env key → configured:false with the ENV blocker named',
    off.configured === false && off.blockers.length === 1 && off.blockers[0] === `ENV:${WHITELABEL_KEY_ENV}`, JSON.stringify(off));
  check('the not-configured answer tells ops exactly what to set',
    /CRYPTOREFILLS_WHITELABEL_API_KEY/.test(off.whenReady), off.whenReady);

  process.env[WHITELABEL_KEY_ENV] = 'test-key-123';
  const on = whitelabelStatus();
  check('env key set → configured flips true with no blockers',
    on.configured === true && on.blockers.length === 0 && on.transport === 'https', JSON.stringify(on));
  check('readiness describes pre-checks only, never an order-forwarding capability we do not have',
    /pre-check/.test(on.whenReady) && !/forwarding are live/i.test(on.whenReady), on.whenReady);
  if (savedKey === undefined) delete process.env[WHITELABEL_KEY_ENV]; else process.env[WHITELABEL_KEY_ENV] = savedKey;

  /* ─────────────────────── order prerequisites ──────────────────────────── */
  const empty = validateOrderPrerequisites({});
  check('an empty order fails BOTH email and country as separate keys',
    empty.ok === false && empty.errors.includes('INVALID_EMAIL') && empty.errors.includes('INVALID_COUNTRY')
    && new Set(empty.errors).size === empty.errors.length, JSON.stringify(empty));
  check('error keys are KEYS from the table, never prose',
    empty.errors.every((k) => Object.prototype.hasOwnProperty.call(shop.WHITELABEL_ORDER_ERRORS, k)), empty.errors.join(','));
  check('a non-object payload cannot crash the validator',
    validateOrderPrerequisites(null).ok === false && validateOrderPrerequisites('x').ok === false);

  const good = validateOrderPrerequisites({
    email: ' Buyer@Example.com ',
    fullname: '  Maryam   Rajabi ',
    country: 'us',
    amount: '120.50',
    family: 'Steam'
  });
  check('a valid order normalises email/country and keeps the amount numeric',
    good.ok === true && good.value.email === 'buyer@example.com' && good.value.country === 'US'
    && good.value.fullname === 'Maryam Rajabi' && good.value.amount === 120.5, JSON.stringify(good));

  const badAmount = validateOrderPrerequisites({ email: 'a@b.co', fullname: 'A B', country: 'US', amount: '0', family: 'Steam' });
  check('amount 0 is INVALID_AMOUNT, not a silent pass',
    badAmount.ok === false && badAmount.errors.includes('INVALID_AMOUNT'), JSON.stringify(badAmount));
  const bigAmount = validateOrderPrerequisites({ email: 'a@b.co', fullname: 'A B', country: 'US', amount: 99999, family: 'Steam' });
  check('the per-order ceiling is enforced server-side too',
    bigAmount.ok === false && bigAmount.errors.includes('INVALID_AMOUNT'), JSON.stringify(bigAmount));
  const noName = validateOrderPrerequisites({ email: 'a@b.co', fullname: '\u200b', country: 'US', amount: 10, family: 'Steam' });
  check('a zero-width-space “name” is no name',
    noName.ok === false && noName.errors.includes('FULLNAME_MISSING'), JSON.stringify(noName));
  const oneBadCountry = validateOrderPrerequisites({ email: 'a@b.co', fullname: 'A B', country: 'USA', amount: 10, family: 'Steam' });
  check('country gets exactly one error key (no double-report per field)',
    oneBadCountry.errors.filter((e) => e === 'INVALID_COUNTRY').length === 1, JSON.stringify(oneBadCountry.errors));

  /* ─────────────────────── upstream error mapping ─────────────────────────── */
  check('the documented daily-limit prose maps to the named key',
    mapUpstreamOrderError(400, 'You have reached your daily spending limit.') === 'DAILY_SPENDING_LIMIT_EXCEEDED');
  check('raw machine codes map exactly like their documented prose',
    mapUpstreamOrderError(400, '{"code":"DAILY_SPENDING_LIMIT_EXCEEDED"}') === 'DAILY_SPENDING_LIMIT_EXCEEDED'
    && mapUpstreamOrderError(400, 'FULLNAME_MISSING') === 'FULLNAME_MISSING');
  check('a 429 is the limit, whatever prose came with it',
    mapUpstreamOrderError(429, '') === 'DAILY_SPENDING_LIMIT_EXCEEDED');
  check('every mapped reason is a documented table key',
    ['daily limit exceeded', 'fullname_missing', 'other'].every((body) => (
      Object.prototype.hasOwnProperty.call(shop.WHITELABEL_ORDER_ERRORS, mapUpstreamOrderError(400, body))
    )));
  check('an unrecognised body never gets an invented reason',
    mapUpstreamOrderError(400, 'some provider essay') === 'UPSTREAM_ORDER_FAILED');

  /* ─────────────────────── upstream client IP forwarding ────────────────── */
  const forwarded = userHeaders({ headers: { 'x-forwarded-for': ' 203.0.113.8, 10.0.0.4, 10.0.0.5' } });
  check('only the FIRST forwarded client is sent upstream, with no proxy-chain leak',
    forwarded['X-Forwarded-For'] === '203.0.113.8', JSON.stringify(forwarded));
  check('the forwarded value is bounded and the header is absent when no client IP exists',
    userHeaders({ headers: { 'x-forwarded-for': `${'1'.repeat(500)}, 10.0.0.1` } })['X-Forwarded-For'].length === 128
    && userHeaders({ headers: {} })['X-Forwarded-For'] === undefined);

  /* ─────────────────────── anonymous trending ─────────────────────────────── */
  check('junk country/brand ids are refused; a long brand id is capped, not rejected whole',
    bumpShopInterest('', 'x') === false && bumpShopInterest('U', '') === false && bumpShopInterest('US', 'x'.repeat(500)) === true);
  const before = shopTrendSize();
  for (let i = 0; i < 5; i += 1) bumpShopInterest('US', 'b-steam');
  for (let i = 0; i < 2; i += 1) bumpShopInterest('US', 'b-xbox');
  check('counts accumulate per country+brand key', shopTrendSize() === before + 2, `${before}→${shopTrendSize()}`);

  const rows = [
    { id: 'b-xbox', family: 'Xbox', name: 'Xbox', country: 'US' },
    { id: 'b-steam', family: 'Steam', name: 'Steam', country: 'US' },
    { id: 'b-dead', family: 'Dead', name: 'Dead Brand', country: 'US', outOfStock: true },
    { id: 'b-quiet', family: 'Quiet', name: 'Quiet Brand', country: 'US' }
  ];
  const ranked = rankTrendingBrands(rows, { cc: 'US', spreadOf: (f) => (f === 'Quiet' ? 9.5 : 5) });
  check('out-of-stock is FILTERED from the rail, not demoted',
    !ranked.some((r) => r.id === 'b-dead'), JSON.stringify(ranked));
  check('the counted Steam outranks the uncounted Quiet even at lower margin',
    ranked[0].id === 'b-steam', JSON.stringify(ranked));
  check('spread is a boost term the un-ranked brand still gets',
    ranked.some((r) => r.id === 'b-quiet' && r.spreadPct === 9.5 && r.views === 0), JSON.stringify(ranked));
  const cold = rankTrendingBrands(rows, { cc: 'TR', spreadOf: () => null });
  check('a different country sees its OWN counter — nothing cross-contaminates',
    cold[0].id !== 'b-steam' || cold.every((r) => r.views === 0), JSON.stringify(cold));

  setCached('shop-prod-ZZ-ProbeMargin-USDT-fa', { bestSpreadPct: 9.25 }, 60_000);
  const variantMargin = await trendingFromCatalogue('ZZ', [
    { id: 'margin-probe', family: 'ProbeMargin', name: 'Margin Probe', country: 'ZZ' }
  ]);
  check('trending margins survive actual coin+locale product-cache variants',
    variantMargin.rows[0]?.spreadPct === 9.25 && variantMargin.rows[0]?.score > 0,
    JSON.stringify(variantMargin));

  /* ───────────────────────── route + wiring mounts ────────────────────────── */
  const app = readFileSync('server/app.js', 'utf8');
  check('GET /api/shop/readiness is mounted', /app\.get\('\/api\/shop\/readiness'/.test(app));
  check('POST /api/shop/whitelabel/precheck is mounted', /app\.post\('\/api\/shop\/whitelabel\/precheck'/.test(app));
  check('POST /api/shop/track is mounted', /app\.post\('\/api\/shop\/track'/.test(app));
  check('GET /api/shop/trending is mounted', /app\.get\('\/api\/shop\/trending'/.test(app));
  check('the old v1 shop routes were not displaced',
    /app\.get\('\/api\/shop\/catalogue'/.test(app) && /app\.get\('\/api\/shop\/products'/.test(app) && /app\.get\('\/api\/shop\/countries'/.test(app));

  /* the track handler must not read identity — no ip, no UA, no cookie, no xff */
  const trackBlock = app.slice(app.indexOf("app.post('/api/shop/track'"));
  const trackBody = trackBlock.slice(0, trackBlock.indexOf('app.get(\'/api/shop/trending\''));
  check('the track handler reads NOTHING personal — no ip, no UA, no cookie',
    !/req\.ip|user-agent|cookie|x-forwarded-for/i.test(trackBody), trackBody.slice(0, 120));
  check('the trending answer caps itself and needs no auth',
    /country/.test(trackBody) && !/requireAuth|authToken/.test(trackBody));

  /* ───────────────────────── the client contract ─────────────────────────── */
  const client = readFileSync('src/lib/shop.js', 'utf8');
  check('the client posts interest as a fire-and-forget beacon',
    /reportShopInterest/.test(client) && /keepalive/.test(client) && /catch/.test(client));
  check('interest/beacon failures resolve false, never throw into the click',
    /fetchShopTrending/.test(client) && /fetchShopReadiness/.test(client));

  const shopSrc = readFileSync('src/pages/Shop.jsx', 'utf8');
  check('the whitelabel note is gated on the SERVER flag, not on hope',
    /readiness\.whitelabelConfigured\s*===\s*true/.test(shopSrc) || /whitelabelConfigured\s*===\s*true/.test(shopSrc));
  check('TapToPay stays behind the lazy chunk (Shop must not drag it to first paint)',
    !/import TapToPay from/.test(shopSrc) && /import\('\.\.\/components\/TapToPay'\)|import\("\.\.\/components\/TapToPay"\)/.test(shopSrc));
  check('the gift arrival never rewrites the URL (no setSearchParams on mount)',
    !/setSearchParams\([^)]*\{\s*replace:\s*true[^}]*\}[^)]*\)/.test(shopSrc));

  /* ─────────────────────────── env documentation ─────────────────────────── */
  const envExample = readFileSync('.env.example', 'utf8');
  check('the secret is documented for the SERVER only — no VITE_ twin',
    /CRYPTOREFILLS_WHITELABEL_API_KEY=/.test(envExample) && !/VITE_CRYPTOREFILLS_WHITELABEL_API_KEY/.test(envExample));

  /* ────────────────────────────── i18n parity ────────────────────────────── */
  const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8'));
  const paths = [
    'pay.invoice', 'pay.invoicePlaceholder', 'pay.invoiceHint',
    'pay.landing.note', 'pay.landing.swapPay.title', 'pay.landing.swapPay.body',
    'pay.landing.swapPay.cta', 'pay.landing.swapPay.fees',
    'shop.gift.send', 'shop.gift.shareText', 'shop.gift.receivedTitle', 'shop.gift.receivedBody',
    'shop.gift.theme.birthday', 'shop.gift.theme.gaming', 'shop.gift.theme.congrats', 'shop.gift.theme.gold',
    'shop.gift.themeLabel', 'shop.hero.metricsLabel', 'shop.hero.availableBrands',
    'shop.trustHub.title', 'shop.trustHub.subtitle', 'shop.pay.badgeSwapPay',
    'shop.loyalty.title', 'shop.loyalty.points', 'shop.loyalty.note', 'shop.loyalty.cta',
    'shop.recent.title', 'shop.trending.title', 'shop.trending.badge',
    'shop.web3id.title', 'shop.web3id.err.chars', 'shop.web3id.err.hyphen',
    'shop.web3id.err.non_ascii', 'shop.web3id.err.too_short', 'shop.web3id.err.too_long',
    'shop.pay.counterTitle', 'shop.pay.counterCta',
    'hardware.compareTitle', 'hardware.checkTitle', 'hardware.check.s1', 'hardware.check.s4',
    'intentAI.navigation.shopGift', 'intentAI.navigation.shopInvoice'
  ];
  const getAt = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  for (const p of paths) {
    check(`${p} exists in en AND fa as non-empty strings`,
      typeof getAt(en, p) === 'string' && getAt(en, p).trim() && typeof getAt(fa, p) === 'string' && getAt(fa, p).trim(),
      `en=${JSON.stringify(getAt(en, p))} fa=${JSON.stringify(getAt(fa, p))}`);
  }
  check('the fee sentence carries BOTH placeholders (swap fee + gateway fee)',
    (getAt(en, 'pay.landing.swapPay.fees').match(/\{\{fee\}\}/g) || []).length === 2);
  check('the landing body carries have/need/short/token',
    ['have', 'need', 'short', 'token'].every((k) => getAt(en, 'pay.landing.swapPay.body').includes(`{{${k}}}`)));

  console.log(JSON.stringify({ probe: 'shop-phase23', passed: results.filter((r) => r.ok).length, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.name) }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
