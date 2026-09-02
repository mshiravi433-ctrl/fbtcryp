/**
 * Buy / Sell gateway safety probe. It uses the real Express app with no mocked
 * provider: the required result before a signed provider contract exists is a
 * transparent, non-cacheable unavailable response—not a quote, checkout URL,
 * or completed order.
 */
import app from '../server/app.js';

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
  const capabilities = await call('/api/v1/buy-sell/providers');
  const provider = capabilities.body?.providers?.[0];
  check('capabilities are available over the versioned first-party endpoint', capabilities.response.status === 200);
  check('capabilities are non-cacheable', capabilities.response.headers.get('cache-control') === 'no-store');
  check('provider remains unavailable pending its official settlement contract',
    provider?.available === false && provider?.prerequisites?.includes('PROVIDER_REQUIRES_INTEGRATION')
    && provider?.prerequisites?.includes('OFFICIAL_CALLBACK_AND_SETTLEMENT_CONTRACT_REQUIRED'));
  check('capabilities declare non-custody, zero FBT fee and no CEX API',
    capabilities.body?.custody === 'NON_CUSTODIAL' && capabilities.body?.fbtFee === 0 && capabilities.body?.noCexApi === true);

  const request = {
    side: 'BUY', asset: 'USDT', network: 'bsc', fiatCurrency: 'USD', fiatAmount: 100,
    country: 'US', paymentMethod: 'VISA_MC1', walletAddress: '0x000000000000000000000000000000000000dEaD'
  };
  const quote = await call('/api/v1/buy-sell/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
  });
  check('unintegrated provider produces no quote', quote.response.status === 503 && quote.body?.error === 'PROVIDER_UNAVAILABLE' && !quote.body?.quote);
  check('unavailable quote is non-cacheable', quote.response.headers.get('cache-control') === 'no-store');

  const order = await call('/api/v1/buy-sell/order', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'buy-sell-safety-test-idempotency-0001' },
    body: JSON.stringify({ quoteId: 'bsq_not_real', quoteAccessToken: 'none', walletAddress: request.walletAddress })
  });
  check('order creation is provider-gated before a payment record can be created',
    order.response.status === 503 && order.body?.error === 'PROVIDER_REQUIRES_INTEGRATION' && !order.body?.order);

  const checkout = await call('/api/v1/buy-sell/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'buy-sell-safety-test-idempotency-0002' },
    body: JSON.stringify({ orderId: 'bso_not_real', confirmed: true })
  });
  check('checkout is provider-gated before an order capability can be dereferenced',
    checkout.response.status === 503 && checkout.body?.error === 'PROVIDER_REQUIRES_INTEGRATION' && !checkout.body?.checkoutUrl);

  const audit = await call('/api/v1/buy-sell/order/bso_not_real/audit');
  check('audit access requires the opaque order capability', audit.response.status === 404 && audit.response.headers.get('cache-control') === 'no-store');

  const webhook = await call('/api/v1/buy-sell/webhooks/changenow_fiat', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fbt-provider-signature': 'guessed-signature' }, body: JSON.stringify({ status: 'settled' })
  });
  check('undocumented callback data is rejected rather than parsed as settlement',
    webhook.response.status === 503 && webhook.body?.error === 'PROVIDER_REQUIRES_INTEGRATION');
  check('disabled webhook response is non-cacheable', webhook.response.headers.get('cache-control') === 'no-store');

  const legacy = await call('/api/fiat/status');
  check('legacy direct-fiat endpoint is removed', legacy.response.status === 404);
} catch (error) {
  console.error(error);
  rows.push({ name: 'probe execution', ok: false });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(JSON.stringify({ probe: 'buy-sell-safety', passed: rows.filter((row) => row.ok).length, rows }, null, 2));
if (rows.some((row) => !row.ok)) process.exitCode = 1;
export default rows;
