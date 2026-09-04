#!/usr/bin/env node
/**
 * Iranian USDT-buy safety probe.
 *
 * The feature now has a real, reviewed payment adapter (ZarinPal) and a
 * bounded-execution price cap, so this probe checks two different things:
 *
 *  1. an *incomplete* deployment still cannot switch itself on — a flag, a
 *     free-text adapter name, or a missing cost cap keeps it fail-closed;
 *  2. a *complete* deployment activates only through exactly the reviewed
 *     contract, without ever leaking a credential to the browser.
 *
 * No request below reaches Wallex or ZarinPal: every provider call runs
 * against a local fetch stub that only pins request shape and containment.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MERCHANT_ID = '00000000-1111-2222-3333-444444444444';
const CALLBACK_URL = 'https://app.example/iran-buy/return';

/* A complete, valid deployment shape. Individual keys are removed further down
   to prove each one is genuinely load-bearing. */
Object.assign(process.env, {
  IRAN_BUY_ENABLED: 'true',
  WALLEX_API_BASE_URL: 'https://api.wallex.ir',
  WALLEX_API_KEY: 'server-only-test-key-1234567890',
  UPSTASH_REDIS_REST_URL: 'https://iran-buy-test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token-1234567890',
  IRAN_BUY_USDT_NETWORK: 'ERC20',
  IRAN_BUY_USDT_NETWORK_LABEL: 'Ethereum',
  IRAN_BUY_NETWORK_APPROVED: 'true',
  IRAN_BUY_WALLET_FAMILY: 'EVM',
  IRAN_BUY_EVM_CHAIN_ID: '1',
  IRAN_BUY_USDT_TOKEN_CONTRACT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  IRAN_BUY_USDT_DECIMALS: '6',
  IRAN_BUY_MIN_TOMAN: '50000',
  IRAN_BUY_MAX_TOMAN: '100000000',
  IRAN_BUY_PAYMENT_ADAPTER: 'ZARINPAL',
  ZARINPAL_MERCHANT_ID: MERCHANT_ID,
  IRAN_BUY_PAYMENT_CALLBACK_URL: CALLBACK_URL,
  IRAN_BUY_PAYMENT_CONTRACT_VERIFIED: 'true',
  IRAN_BUY_APPROVED_PAYMENT_HOSTS: 'payment.zarinpal.com',
  IRAN_BUY_MAX_SLIPPAGE_BPS: '50',
  IRAN_BUY_TREASURY_COST_CAP_ACKNOWLEDGED: 'true',
  IRAN_BUY_WALLEX_WITHDRAWAL_LIFECYCLE_VERIFIED: 'true',
  IRAN_BUY_SETTLEMENT_RECONCILIATION_APPROVED: 'true'
});

const [
  { default: app },
  { calculateIranBuyQuantity, __iranBuy },
  { iranBuyConfig, publicIranBuyCapability },
  { createWallexIranBuyProvider },
  { createZarinpalIranBuyProvider, tomanToRial },
  { normalizePublicUsdtTmnRate }
] = await Promise.all([
  import('../server/app.js'),
  import('../server/iranBuy.js'),
  import('../server/iranBuyConfig.js'),
  import('../server/providers/iranWallex.js'),
  import('../server/providers/iranZarinpal.js'),
  import('../server/providers/iranWallexPublic.js')
]);

const rows = [];
const check = (name, ok) => rows.push({ name, ok: Boolean(ok) });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = `http://127.0.0.1:${server.address().port}`;

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  return { response, body: await response.json().catch(() => null) };
}

function withEnv(overrides, worker) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key]; else process.env[key] = value;
  }
  try { return worker(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
}

try {
  /* ---------------- Activation is a contract, not a flag ------------------ */
  check('a complete reviewed deployment is the only way the capability becomes available',
    iranBuyConfig().available === true && iranBuyConfig().prerequisites.length === 0);
  check('the explicit feature flag remains a required gate',
    withEnv({ IRAN_BUY_ENABLED: 'false' }, () => iranBuyConfig().prerequisites.includes('IRAN_BUY_DISABLED')));
  check('a free-text adapter name cannot stand in for the reviewed payment adapter',
    withEnv({ IRAN_BUY_PAYMENT_ADAPTER: 'IMPLEMENTED_REVIEWED_PROVIDER' },
      () => iranBuyConfig().prerequisites.includes('PAYMENT_COLLECTION_ADAPTER_REQUIRED')));
  check('a missing/malformed merchant id keeps payment collection closed',
    withEnv({ ZARINPAL_MERCHANT_ID: 'not-a-merchant-id' },
      () => iranBuyConfig().prerequisites.includes('PAYMENT_COLLECTION_ADAPTER_REQUIRED')));
  check('a return URL that already carries its own query is rejected',
    withEnv({ IRAN_BUY_PAYMENT_CALLBACK_URL: 'https://app.example/return?order=1' },
      () => iranBuyConfig().prerequisites.includes('PAYMENT_COLLECTION_ADAPTER_REQUIRED')));
  check('the hosted checkout host must be in the approved redirect allowlist',
    withEnv({ IRAN_BUY_APPROVED_PAYMENT_HOSTS: 'example.com' },
      () => iranBuyConfig().prerequisites.includes('PAYMENT_COLLECTION_ADAPTER_REQUIRED')));
  check('bounded execution is mandatory: no slippage cap means no live OTC buy',
    withEnv({ IRAN_BUY_MAX_SLIPPAGE_BPS: null },
      () => iranBuyConfig().prerequisites.includes('WALLEX_OTC_COST_CAP_CONTRACT_REQUIRED'))
    && withEnv({ IRAN_BUY_TREASURY_COST_CAP_ACKNOWLEDGED: 'false' },
      () => iranBuyConfig().prerequisites.includes('WALLEX_OTC_COST_CAP_CONTRACT_REQUIRED')));
  /* Upstash credentials are read once at module load, so this one is checked
     in a clean child process rather than by mutating process.env here. */
  const withoutUpstash = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const { iranBuyConfig } = await import('./server/iranBuyConfig.js');"
    + ' process.stdout.write(JSON.stringify(iranBuyConfig().prerequisites));'
  ], {
    encoding: 'utf8',
    env: { ...process.env, UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }
  });
  check('durable atomic storage is still required',
    JSON.parse(withoutUpstash).includes('UPSTASH_ATOMIC_IDEMPOTENCY_REQUIRED'));

  /* ---------------- Nothing sensitive crosses to the browser -------------- */
  const config = await call('/api/iran/buy/config');
  check('the public capability exposes only asset, network, limits and payment mode',
    config.response.status === 200 && config.body?.enabled === true
    && config.body?.asset === 'USDT' && config.body?.payment?.mode === 'REDIRECT'
    && config.body?.network?.chainId === 1 && config.body?.limits?.minToman === '50000');
  check('the public capability never exposes a credential, merchant id, host or checklist',
    !new RegExp(`${MERCHANT_ID}|api-key|apikey|secret|prerequisite|merchant`, 'i').test(JSON.stringify(config.body)));
  check('capability response is never cacheable', config.response.headers.get('cache-control') === 'no-store');

  const disabled = withEnv({ IRAN_BUY_ENABLED: 'false' }, () => publicIranBuyCapability());
  check('a disabled capability answers with coarse readiness groups, not the checklist',
    disabled.enabled === false && disabled.asset === null && Array.isArray(disabled.readiness)
    && disabled.readiness.includes('ACTIVATION')
    && !/wallex|upstash|env|token|key/i.test(JSON.stringify(disabled.readiness)));

  /* ---------------- Authentication on every mutating route ---------------- */
  const challenge = await call('/api/iran/buy/wallet-challenge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: '0x000000000000000000000000000000000000dEaD', chainId: 1 })
  });
  check('wallet binding cannot begin without a verified Telegram identity',
    challenge.response.status === 401 && challenge.body?.error === 'AUTH_REQUIRED');

  const preview = await call('/api/iran/buy/usdt/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountToman: '100000' })
  });
  check('no unauthenticated browser can obtain a quote/preview', preview.response.status === 401 && !preview.body?.preview);

  const paymentVerify = await call('/api/iran/buy/orders/irbo_x/payment/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ authority: 'A'.repeat(36), status: 'OK' })
  });
  check('a gateway return cannot confirm a payment without the Telegram owner',
    paymentVerify.response.status === 401 && paymentVerify.body?.error === 'AUTH_REQUIRED');

  const webhook = await call('/api/iran/buy/webhooks/payment', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-iran-buy-signature': '00'.repeat(32) },
    body: JSON.stringify({ eventId: 'payment-event-000000', orderId: 'irbo_x', status: 'CONFIRMED' })
  });
  check('no unsigned payment callback is mounted as settlement evidence', webhook.response.status === 404);

  const oldRoute = await call('/api/wallex/status');
  check('no legacy direct Wallex route is mounted', oldRoute.response.status === 404);

  /* ---------------- Public reference rate is public, and only that -------- */
  const rate = await call('/api/iran/buy/rate');
  check('the public rate route answers without any credential or session',
    rate.response.status === 200 && rate.body?.schema === 'fbt.iran-buy-rate.v1'
    && typeof rate.body?.available === 'boolean');
  check('an unexpected market payload produces no invented rate',
    normalizePublicUsdtTmnRate({ symbols: { USDTTMN: { baseAsset: 'USDT', quoteAsset: 'TMN', stats: {} } } }) === null
    && normalizePublicUsdtTmnRate({ symbols: { USDTTMN: { baseAsset: 'BTC', quoteAsset: 'TMN', stats: { askPrice: '1' } } } }) === null);
  check('a well-formed market payload yields the ask price as the buy reference',
    normalizePublicUsdtTmnRate({ symbols: { USDTTMN: { symbol: 'USDTTMN', baseAsset: 'USDT', quoteAsset: 'TMN', stats: { askPrice: '62500.0000000000000000', bidPrice: '62400.00', lastPrice: '62450', '24h_ch': -1.2 } } } })?.buyPrice === '62500');

  /* ---------------- Bounded execution ------------------------------------- */
  check('the price cap is exact decimal arithmetic, not a float estimate',
    __iranBuy.priceCapFor('62500', 50) === '62812.5' && __iranBuy.priceCapFor('62500', null) === null);
  check('quote quantity is rounded down at the provider market precision',
    calculateIranBuyQuantity({ tomanAmount: '100001', price: '62500', quantityDecimals: 6 }) === '1.600016');
  check('quote quantity rejects a missing/local price rather than manufacturing one',
    calculateIranBuyQuantity({ tomanAmount: '100000', price: '', quantityDecimals: 6 }) === null);

  /* ---------------- Wallex adapter request shape -------------------------- */
  const calls = [];
  const wallet = '0x000000000000000000000000000000000000dEaD';
  const provider = createWallexIranBuyProvider({
    apiBase: 'https://api.wallex.ir', apiKey: 'server-only-test-key-1234567890',
    fetchImpl: async (url, init = {}) => {
      const target = new URL(url);
      calls.push({ path: `${target.pathname}${target.search}`, method: init.method, headers: init.headers, body: init.body });
      let result;
      if (target.pathname === '/v1/otc/markets') {
        result = { symbols: { USDTTMN: { symbol: 'USDTTMN', baseAsset: 'USDT', quoteAsset: 'TMN', buyStatus: 'ENABLE', baseAssetPrecision: 8, stepSize: 6, minQty: '0.000001', minNotional: '50000', maxNotional: '100000000' } } };
      } else if (target.pathname === '/v1/account/otc/price') {
        result = { price: '62500', price_expires_at: new Date(Date.now() + 60_000).toISOString() };
      } else if (target.pathname === '/v1/account/otc/orders') {
        result = { clientOrderId: 'OTC-test-order', status: 'FILLED', executedQty: '1.6', executedSum: '100000', executedPrice: '62500', fills: [{ fee: '0.001', feeAsset: 'USDT', quantity: '1.6' }] };
      } else if (target.pathname === '/v1/account/crypto-withdrawal' && init.method === 'POST') {
        result = { id: 42, status: 'PENDING', amount: '1.599', fee: '0', wallet_address: wallet, network: { name: 'ERC20' } };
      } else if (target.pathname === '/v1/account/crypto-withdrawal') {
        result = [{ id: 42, status: 'Accomplished', amount: '1.599', fee: '0', txHash: `0x${'a'.repeat(64)}`, wallet_address: wallet, network: { name: 'ERC20' } }];
      } else {
        return new Response(JSON.stringify({ success: false }), { status: 404, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await provider.getUsdttmnMarket();
  await provider.getBuyQuote();
  await provider.createOtcBuy({ quantity: '1.6' });
  await provider.createUsdtWithdrawal({ network: 'ERC20', amount: '1.599', walletAddress: wallet });
  await provider.getWithdrawal('42', { network: 'ERC20', walletAddress: wallet });
  check('adapter uses only the documented OTC market, quote, order and withdrawal paths',
    calls.map((entry) => entry.path).join('|') === '/v1/otc/markets|/v1/account/otc/price?symbol=USDTTMN&side=BUY|/v1/account/otc/orders|/v1/account/crypto-withdrawal|/v1/account/crypto-withdrawal?page=1&per_page=100');
  check('quote requests are GET and carry fixed USDTTMN/BUY fields', calls[1]?.method === 'GET' && calls[1]?.body == null);
  check('only server adapter receives X-API-Key and mutating bodies contain no client-selected asset/network list',
    String(calls[0]?.headers?.['x-api-key'] || '') === 'server-only-test-key-1234567890'
    && calls[2]?.body === JSON.stringify({ symbol: 'USDTTMN', side: 'BUY', amount: 1.6 })
    && calls[3]?.body === JSON.stringify({ coin: 'USDT', network: 'ERC20', value: 1.599, wallet_address: wallet }));

  /* ---------------- ZarinPal adapter contract ----------------------------- */
  const paymentCalls = [];
  const paymentProvider = createZarinpalIranBuyProvider({
    merchantId: MERCHANT_ID,
    fetchImpl: async (url, init = {}) => {
      const target = new URL(url);
      paymentCalls.push({ origin: target.origin, path: target.pathname, method: init.method, body: JSON.parse(init.body || '{}') });
      const data = target.pathname.endsWith('/request.json')
        ? { code: 100, authority: `A${'0'.repeat(30)}wwOGYp`, fee_type: 'Merchant', fee: 0 }
        : target.pathname.endsWith('/verify.json')
          ? { code: 100, ref_id: 201_234_567, card_pan: '502229******5995', fee: 0 }
          : { authorities: [] };
      return new Response(JSON.stringify({ data, errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const intent = await paymentProvider.createPayment({ amountToman: '100000', callbackUrl: CALLBACK_URL, orderId: 'irbo_test' });
  const verified = await paymentProvider.verifyPayment({ amountToman: '100000', authority: intent.authority });
  check('payment intents use only the documented ZarinPal request/verify endpoints on a pinned host',
    paymentCalls.every((entry) => entry.origin === 'https://payment.zarinpal.com' && entry.method === 'POST')
    && paymentCalls.map((entry) => entry.path).join('|') === '/pg/v4/payment/request.json|/pg/v4/payment/verify.json');
  check('the customer is charged the stored amount in one explicit currency unit',
    tomanToRial('100000') === 1_000_000
    && paymentCalls[0].body.amount === 1_000_000 && paymentCalls[0].body.currency === 'IRR'
    && paymentCalls[1].body.amount === paymentCalls[0].body.amount
    && paymentCalls[0].body.callback_url === CALLBACK_URL);
  check('the checkout URL is composed from the pinned host, not from the provider payload',
    intent.checkoutUrl.startsWith('https://payment.zarinpal.com/pg/StartPay/'));
  check('verification is the only source of truth and keeps no card data',
    verified.verified === true && verified.refId === '201234567' && !('cardPan' in verified)
    && !JSON.stringify(verified).includes('5995'));
  check('an already-verified payment is idempotent rather than a second charge',
    (await createZarinpalIranBuyProvider({
      merchantId: MERCHANT_ID,
      fetchImpl: async () => new Response(JSON.stringify({ data: { code: 101, ref_id: 5 } }), { status: 200 })
    }).verifyPayment({ amountToman: '100000', authority: intent.authority })).alreadyVerified === true);
  check('an unpaid or failed authority never becomes a confirmed payment',
    (await createZarinpalIranBuyProvider({
      merchantId: MERCHANT_ID,
      fetchImpl: async () => new Response(JSON.stringify({ data: [], errors: { code: -51, message: 'unsuccessful' } }), { status: 200 })
    }).verifyPayment({ amountToman: '100000', authority: intent.authority })).verified === false);
  check('an unreviewed payment host cannot be configured at all',
    (() => {
      try {
        createZarinpalIranBuyProvider({ merchantId: MERCHANT_ID, apiBase: 'https://pay.example.com' });
        return false;
      } catch (error) { return error.code === 'PAYMENT_PROVIDER_UNAVAILABLE'; }
    })());

  /* ---------------- Browser-side containment ------------------------------ */
  const browserClient = readFileSync('src/lib/iranBuy.js', 'utf8');
  const browserPanel = readFileSync('src/components/IranianBuyPanel.jsx', 'utf8');
  const generalPanel = readFileSync('src/components/BuySellPanel.jsx', 'utf8');
  check('browser client has no Wallex credential or direct provider header', !/WALLEX_API_KEY|x-api-key/i.test(browserClient));
  check('the browser never composes a payment link or holds a merchant id',
    !/StartPay|merchant_id|merchantId|zarinpal\.com/i.test(browserClient + browserPanel));
  check('Iranian panel has no user-selectable asset/network control or manual destination input',
    !/<select[\s\S]{0,300}(asset|network)|manualWallet|walletAddress.*onChange/i.test(browserPanel));
  check('tab visibility is Persian language, not a live Wallex capability',
    /split\(\/\[-_\]\/\)\[0\] === 'fa'/.test(generalPanel) && /const iranBuyVisible = iranBuyLanguageAllowed/.test(generalPanel)
    && !/iranBuyCapability\?\.enabled === true/.test(generalPanel));
} catch (error) {
  console.error(error);
  rows.push({ name: 'probe execution', ok: false });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(JSON.stringify({ probe: 'iran-buy-safety', passed: rows.filter((row) => row.ok).length, total: rows.length, rows }, null, 2));
if (rows.some((row) => !row.ok)) process.exitCode = 1;
export default rows;
