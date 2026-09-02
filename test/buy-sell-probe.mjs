/**
 * Buy / Sell gateway safety probe (unconfigured deployment).
 *
 * It uses the real Express app with NO provider credentials configured: the
 * required result before the legitimate Ramp production credential exists is
 * a transparent, non-cacheable CONFIGURATION_REQUIRED state — not a quote,
 * checkout URL, fake availability, or completed order. The full configured
 * lifecycle is covered by test/buy-sell-ramp-flow-probe.mjs.
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
  check('Ramp is registered as provider #1 in HOSTED_CHECKOUT mode', provider?.id === 'ramp' && provider?.mode === 'HOSTED_CHECKOUT');
  check('an unconfigured deployment reports CONFIGURATION_REQUIRED, never fake availability',
    provider?.available === false && provider?.status === 'CONFIGURATION_REQUIRED'
    && provider?.prerequisites?.includes('RAMP_HOST_API_KEY_REQUIRED')
    && provider?.prerequisites?.includes('RAMP_WEBHOOK_PUBLIC_KEY_REQUIRED'));
  check('the missing credential is a Ramp integration credential, not a CEX API',
    provider?.requiresCexApi === false && provider?.requiresRampProductionCredential === true
    && !provider?.prerequisites?.some((p) => /CEX|BINANCE|BYBIT|KUCOIN|MEXC/i.test(p)));
  check('capabilities declare non-custody, zero FBT fee, zero partner fee and no CEX API',
    capabilities.body?.custody === 'NON_CUSTODIAL' && capabilities.body?.fbtFee === 0
    && capabilities.body?.noCexApi === true && provider?.partnerFee === 0);

  const request = {
    side: 'BUY', asset: 'USDT', network: 'arbitrum', fiatCurrency: 'USD', fiatAmount: 100,
    country: 'DE', paymentMethod: 'CARD_PAYMENT', walletAddress: '0x000000000000000000000000000000000000dEaD'
  };
  const quote = await call('/api/v1/buy-sell/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
  });
  check('unconfigured provider produces no quote', quote.response.status === 503 && quote.body?.error === 'PROVIDER_UNAVAILABLE' && !quote.body?.quote);
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
  check('checkout never opens without an order capability and a configured provider',
    (checkout.response.status === 404 || checkout.response.status === 503) && !checkout.body?.checkoutUrl);

  const audit = await call('/api/v1/buy-sell/order/bso_not_real/audit');
  check('audit access requires the opaque order capability', audit.response.status === 404 && audit.response.headers.get('cache-control') === 'no-store');

  const webhook = await call('/api/v1/buy-sell/webhooks/ramp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-body-signature': 'Z3Vlc3NlZA==' }, body: JSON.stringify({ type: 'RELEASED', purchase: { status: 'RELEASED' } })
  });
  check('webhooks are rejected until Ramp\u2019s signing key is configured — never parsed as settlement',
    webhook.response.status === 503 && webhook.body?.error === 'PROVIDER_REQUIRES_INTEGRATION'
    && webhook.body?.detail === 'RAMP_WEBHOOK_PUBLIC_KEY_REQUIRED');
  check('disabled webhook response is non-cacheable', webhook.response.headers.get('cache-control') === 'no-store');

  const unknown = await call('/api/v1/buy-sell/webhooks/unknown_provider', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({})
  });
  check('an unknown provider callback is not routable', unknown.response.status === 404);

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
