#!/usr/bin/env node
/**
 * Iranian USDT-buy safety probe.
 *
 * It deliberately runs with the feature disabled. A test that opens a real
 * exchange account, customer payment, or withdrawal would prove the opposite
 * of the property this boundary promises. Provider calls below use a local
 * fetch stub solely to pin request shape and secret containment.
 */
import { readFileSync } from 'node:fs';

/* Fill every environment-shaped prerequisite before importing server modules.
   The probe must prove that a deployment cannot accidentally activate merely by
   setting flags/secrets: the reviewed adapter and bounded OTC cost contract are
   deliberate code-level blockers. No request below reaches these endpoints. */
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
  IRAN_BUY_PAYMENT_ADAPTER: 'IMPLEMENTED_REVIEWED_PROVIDER',
  IRAN_BUY_PAYMENT_CALLBACK_URL: 'https://collector.example',
  IRAN_BUY_PAYMENT_WEBHOOK_SECRET: '12345678901234567890123456789012',
  IRAN_BUY_PAYMENT_CONTRACT_VERIFIED: 'true',
  IRAN_BUY_APPROVED_PAYMENT_HOSTS: 'collector.example',
  IRAN_BUY_WALLEX_WITHDRAWAL_LIFECYCLE_VERIFIED: 'true',
  IRAN_BUY_SETTLEMENT_RECONCILIATION_APPROVED: 'true'
});

const [{ default: app }, { calculateIranBuyQuantity }, { iranBuyConfig }, { createWallexIranBuyProvider }] = await Promise.all([
  import('../server/app.js'),
  import('../server/iranBuy.js'),
  import('../server/iranBuyConfig.js'),
  import('../server/providers/iranWallex.js')
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

try {
  const internalConfig = iranBuyConfig();
  check('reviewed code blockers keep a fully configured Iran-buy environment disabled',
    internalConfig.available === false
    && internalConfig.prerequisites.includes('PAYMENT_COLLECTION_ADAPTER_NOT_IMPLEMENTED')
    && internalConfig.prerequisites.includes('WALLEX_OTC_COST_CAP_CONTRACT_REQUIRED'));
  process.env.IRAN_BUY_ENABLED = 'false';
  check('the explicit feature flag remains a required gate', iranBuyConfig().prerequisites.includes('IRAN_BUY_DISABLED'));
  process.env.IRAN_BUY_ENABLED = 'true';
  const config = await call('/api/iran/buy/config');
  check('public Iran-buy capability is reachable but disabled despite IRAN_BUY_ENABLED=true',
    config.response.status === 200 && config.body?.enabled === false && config.body?.schema === 'fbt.iran-buy.v1');
  check('disabled capability does not expose asset, network, secrets, or readiness internals',
    config.body?.asset === null && config.body?.network === null && config.body?.limits === null
    && !/key|secret|prerequisite|wallex/i.test(JSON.stringify(config.body)));
  check('capability response is never cacheable', config.response.headers.get('cache-control') === 'no-store');

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

  const webhook = await call('/api/iran/buy/webhooks/payment', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-iran-buy-signature': '00'.repeat(32) },
    body: JSON.stringify({ eventId: 'payment-event-000000', orderId: 'irbo_x', status: 'CONFIRMED' })
  });
  check('no undocumented payment callback is mounted as settlement evidence', webhook.response.status === 404);

  const oldRoute = await call('/api/wallex/status');
  check('no legacy direct Wallex route is mounted', oldRoute.response.status === 404);

  check('quote quantity is rounded down at the provider market precision',
    calculateIranBuyQuantity({ tomanAmount: '100001', price: '62500', quantityDecimals: 6 }) === '1.600016');
  check('quote quantity rejects a missing/local price rather than manufacturing one',
    calculateIranBuyQuantity({ tomanAmount: '100000', price: '', quantityDecimals: 6 }) === null);

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

  const browserClient = readFileSync('src/lib/iranBuy.js', 'utf8');
  const browserPanel = readFileSync('src/components/IranianBuyPanel.jsx', 'utf8');
  const generalPanel = readFileSync('src/components/BuySellPanel.jsx', 'utf8');
  check('browser client has no Wallex credential or direct provider header', !/WALLEX_API_KEY|x-api-key/i.test(browserClient));
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
