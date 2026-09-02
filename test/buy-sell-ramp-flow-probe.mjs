/**
 * Ramp Network hosted-checkout FULL LIFECYCLE probe.
 *
 * The production adapter is fail-closed without real credentials, so this
 * probe configures a synthetic deployment and mocks the NETWORK LAYER ONLY
 * (Ramp REST API, Upstash REST store, EVM JSON-RPC). No application code is
 * mocked: the real quote, order, checkout-URL, webhook-signature and
 * on-chain-verification code paths run end to end.
 *
 * It asserts the acceptance contract:
 *   1.  quote comes from the provider (fees visible, FBT fee = 0)
 *   2.  order is created BEFORE checkout, with idempotency + access tokens
 *   3.  checkout URL is the official Ramp host with documented params only,
 *       destination wallet prefilled via userAddress, no partner-fee param
 *   4.  a signed RELEASED webhook records the settlement tx (and a forged
 *       signature is rejected)
 *   5.  the order is COMPLETED only after independent on-chain verification
 *       of chain / recipient / token / amount / confirmations
 */
import { createSign, generateKeyPairSync } from 'node:crypto';

/* ── deployment configuration (synthetic, set before importing the app) ── */
const WEBHOOK_KEYS = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
process.env.UPSTASH_REDIS_REST_URL = 'https://mock-buy-sell-probe.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-upstash-token-0123456789';
process.env.RAMP_HOST_API_KEY = 'test_ramp_host_api_key';
process.env.RAMP_ENVIRONMENT = 'demo';
process.env.RAMP_HOST_APP_NAME = 'FBT';
process.env.RAMP_FINAL_URL_BASE = 'https://fbt.example';
process.env.RAMP_WEBHOOK_STATUS_URL = 'https://fbt.example/api/v1/buy-sell/webhooks/ramp';
process.env.RAMP_WEBHOOK_PUBLIC_KEY_PEM = WEBHOOK_KEYS.publicKey.export({ type: 'spki', format: 'pem' }).toString();
process.env.BUY_SELL_MIN_CONFIRMATIONS = '3';

/* ─────────────────────────── network-layer mock ─────────────────────────── */
const WALLET = '0x000000000000000000000000000000000000dEaD';
const USDT_ARB = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const TX_HASH = `0x${'ab'.repeat(32)}`;
const UNITS = '98000000'; // 98 USDT at 6 decimals
const redis = new Map();

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' }
});

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
  const body = init.body ? JSON.parse(init.body) : null;

  if (url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const [cmd, key, value, nx] = body;
    if (cmd === 'SET') {
      if (String(nx).toUpperCase() === 'NX' && redis.has(key)) return jsonResponse({ result: null });
      redis.set(key, value);
      return jsonResponse({ result: 'OK' });
    }
    if (cmd === 'GET') return jsonResponse({ result: redis.get(key) ?? null });
    if (cmd === 'DEL') { redis.delete(key); return jsonResponse({ result: 1 }); }
    return jsonResponse({ result: null });
  }

  if (url.includes('api.demo.rampnetwork.com/api/host-api/v3/assets')) {
    return jsonResponse({
      currencyCode: 'USD', minPurchaseAmount: 4, maxPurchaseAmount: 20000, minFeeAmount: 2.49, minFeePercent: 0.49, maxFeePercent: 2.9,
      assets: [
        { symbol: 'USDT', chain: 'ARBITRUM', name: 'Tether USD', decimals: 6, type: 'ERC20', address: USDT_ARB, enabled: true, hidden: false, minPurchaseAmount: 4, maxPurchaseAmount: -1, networkFee: 0.4, logoUrl: null },
        { symbol: 'ETH', chain: 'ETH', name: 'Ether', decimals: 18, type: 'NATIVE', enabled: true, hidden: false, minPurchaseAmount: -1, maxPurchaseAmount: -1, networkFee: 1.2, logoUrl: null },
        { symbol: 'DOT', chain: 'POLKADOT', name: 'Polkadot', decimals: 10, type: 'NATIVE', enabled: true, hidden: false } // unverifiable chain → must be filtered out
      ]
    });
  }
  if (url.includes('api.demo.rampnetwork.com/api/host-api/v3/onramp/quote/all')) {
    return jsonResponse({
      asset: { symbol: 'USDT', chain: 'ARBITRUM', decimals: 6, address: USDT_ARB, type: 'ERC20', name: 'Tether USD' },
      CARD_PAYMENT: { fiatCurrency: 'USD', cryptoAmount: UNITS, fiatValue: 100, baseRampFee: 2.2, appliedFee: 1.62, networkFee: 0.4, assetExchangeRate: 1.0 },
      APPLE_PAY: { fiatCurrency: 'USD', cryptoAmount: '97500000', fiatValue: 100, baseRampFee: 2.4, appliedFee: 2.1, networkFee: 0.4, assetExchangeRate: 1.0 }
    });
  }

  /* EVM JSON-RPC (Arbitrum) — a real-looking, self-consistent receipt. */
  if (body?.jsonrpc === '2.0') {
    const respond = (result) => jsonResponse({ jsonrpc: '2.0', id: body.id, result });
    switch (body.method) {
      case 'eth_chainId': return respond('0xa4b1');
      case 'eth_blockNumber': return respond('0x1010');
      case 'eth_getTransactionByHash':
        return respond({ hash: TX_HASH, to: USDT_ARB, value: '0x0', blockNumber: '0x1000' });
      case 'eth_getTransactionReceipt':
        return respond({
          status: '0x1', blockNumber: '0x1000', transactionHash: TX_HASH,
          logs: [{
            address: USDT_ARB.toLowerCase(),
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x${'00'.repeat(12)}${'11'.repeat(20)}`,
              `0x000000000000000000000000${WALLET.slice(2).toLowerCase()}`
            ],
            data: `0x${BigInt(UNITS).toString(16).padStart(64, '0')}`
          }]
        });
      case 'eth_getBlockByNumber': return respond({ timestamp: '0x68b6d000' });
      default: return respond(null);
    }
  }
  throw new Error(`UNEXPECTED_NETWORK_CALL:${url}`);
};

/* ───────────────────────────────── probe ────────────────────────────────── */
const { default: app } = await import('../server/app.js');
const { stableStringify } = await import('../server/providers/rampNetwork.js');

const rows = [];
const check = (name, ok) => rows.push({ name, ok: Boolean(ok) });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  return { response, body: await response.json().catch(() => null) };
};
const signWebhook = (event) => createSign('sha256').update(Buffer.from(stableStringify(event), 'utf8')).sign(WEBHOOK_KEYS.privateKey).toString('base64');

try {
  /* 1 ─ capabilities: Ramp is available, honest, zero-fee, no CEX API */
  const caps = await call('/api/v1/buy-sell/providers');
  const provider = caps.body?.providers?.[0];
  check('Ramp provider is AVAILABLE once legitimately configured', provider?.id === 'ramp' && provider?.available === true && provider?.status === 'AVAILABLE');
  check('capability engine reports hosted checkout + direct wallet settlement + no CEX API',
    provider?.checkoutMode === 'HOSTED_CHECKOUT' && provider?.directWalletSettlement === true
    && provider?.requiresCexApi === false && provider?.requiresRampProductionCredential === true);
  check('FBT fee and partner fee are structurally zero', provider?.fbtFee === 0 && provider?.partnerFee === 0);
  check('buy is available WITHOUT any CEX API key', caps.body?.buyAvailable === true && caps.body?.noCexApi === true);

  /* 2 ─ catalog: only independently verifiable EVM assets are offered */
  const assets = await call('/api/v1/buy-sell/assets?side=BUY');
  check('asset catalog comes from the provider', assets.body?.available === true && assets.body.assets.some((a) => a.asset === 'USDT' && a.network === 'arbitrum'));
  check('assets on unverifiable chains are not offered', !assets.body.assets.some((a) => a.asset === 'DOT'));

  /* 3 ─ quote: real provider numbers, visible fees, zero FBT fee */
  const quoteReq = { side: 'BUY', asset: 'USDT', network: 'arbitrum', fiatCurrency: 'USD', fiatAmount: 100, paymentMethod: 'CARD_PAYMENT', country: 'DE', walletAddress: WALLET };
  const quoted = await call('/api/v1/buy-sell/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(quoteReq) });
  const quote = quoted.body?.quote;
  check('a live quote is produced', quoted.response.status === 200 && quote?.provider === 'ramp' && quote?.cryptoAmount === '98');
  check('the Ramp fee is visible and not hidden behind "total fee = 0"', quote?.providerFee === 1.62 && quote?.networkFee?.amount === 0.4);
  check('FBT charges exactly zero on the quote', quote?.fbtFee === 0);
  check('total payable equals the provider figure, not an FBT-marked-up one', quote?.totalPayable === 100);

  /* 4 ─ order before checkout */
  const orderRes = await call('/api/v1/buy-sell/order', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'ramp-flow-probe-idem-000000000001' },
    body: JSON.stringify({ quoteId: quote.quoteId, quoteAccessToken: quote.accessToken, walletAddress: WALLET, requestId: 'ramp-flow-probe-request-000001' })
  });
  const order = orderRes.body?.order;
  const orderToken = orderRes.body?.orderAccessToken;
  check('the FBT order exists before any checkout', orderRes.response.status === 201 && order?.status === 'AWAITING_CONFIRMATION');
  check('order tracks requestId / orderId / provider / zero fee', Boolean(order?.requestId && order?.orderId) && order?.provider === 'ramp' && order?.fbtFee === 0);
  check('order never leaks capability hashes or webhook secrets', !('accessTokenHash' in order) && !('webhookAuth' in order) && !('webhookAuthHash' in order));

  /* 5 ─ hosted checkout: official URL, documented params, userAddress prefilled */
  const checkout = await call(`/api/v1/buy-sell/order/${order.orderId}/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'ramp-flow-probe-idem-000000000002', 'x-buy-sell-order-token': orderToken },
    body: JSON.stringify({ orderId: order.orderId, confirmed: true })
  });
  const checkoutUrl = new URL(checkout.body?.checkoutUrl || 'https://invalid.example');
  check('checkout is the OFFICIAL Ramp hosted widget', checkoutUrl.origin === 'https://app.demo.rampnetwork.com');
  check('destination wallet is prefilled via the documented userAddress param', checkoutUrl.searchParams.get('userAddress') === WALLET);
  check('asset/network/fiat are prefilled with documented params',
    checkoutUrl.searchParams.get('swapAsset') === 'ARBITRUM_USDT' && checkoutUrl.searchParams.get('fiatCurrency') === 'USD' && checkoutUrl.searchParams.get('fiatValue') === '100');
  check('the flow is locked to on-ramp and returns to FBT',
    checkoutUrl.searchParams.get('enabledFlows') === 'ONRAMP' && (checkoutUrl.searchParams.get('finalUrl') || '').startsWith(`https://fbt.example/order/result/${order.orderId}`));
  check('no partner-fee or invented parameter is appended',
    ![...checkoutUrl.searchParams.keys()].some((k) => /fee|partner|commission/i.test(k)));
  check('order is PAYMENT_PENDING after opening checkout — success is never assumed', checkout.body?.order?.status === 'PAYMENT_PENDING');

  /* 6 ─ webhook: forged signature rejected; signed RELEASED accepted */
  const webhookQuery = new URL(checkoutUrl.searchParams.get('webhookStatusUrl')).searchParams;
  const event = {
    type: 'RELEASED',
    purchase: { id: 'ramp-purchase-777', status: 'RELEASED', receiverAddress: WALLET, finalTxHash: TX_HASH, cryptoAmount: UNITS }
  };
  const hookPath = `/api/v1/buy-sell/webhooks/ramp?orderId=${webhookQuery.get('orderId')}&hookToken=${webhookQuery.get('hookToken')}`;
  const forged = await call(hookPath, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-body-signature': Buffer.from('forged').toString('base64') },
    body: JSON.stringify(event)
  });
  check('a forged webhook signature is rejected', forged.response.status === 401 && forged.body?.error === 'WEBHOOK_SIGNATURE_INVALID');

  const released = await call(hookPath, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-body-signature': signWebhook(event) },
    body: JSON.stringify(event)
  });
  check('the genuinely signed RELEASED webhook is accepted', released.response.status === 200 && released.body?.received === true && released.body?.matched === true);

  /* 7 ─ completion only via independent on-chain verification */
  const finalState = await call(`/api/v1/buy-sell/order/${order.orderId}/status`, { headers: { 'x-buy-sell-order-token': orderToken } });
  const finalOrder = finalState.body?.order;
  check('order is COMPLETED after blockchain verification', finalOrder?.status === 'COMPLETED' && finalOrder?.verificationStatus === 'VERIFIED');
  check('verification pinned chain, recipient, token, amount and confirmations',
    finalState.body?.verification?.txHash === TX_HASH
    && finalState.body?.verification?.chainId === 42161
    && finalState.body?.verification?.recipient === WALLET
    && finalState.body?.verification?.amount === UNITS
    && finalState.body?.verification?.confirmations >= 3);
  check('the provider transaction reference and explorer link are recorded',
    finalOrder?.providerReference === 'ramp-purchase-777' && String(finalOrder?.explorerTxUrl || '').includes(`arbiscan.io/tx/${TX_HASH}`));
  check('the completed order still charged an FBT fee of exactly zero', finalOrder?.fbtFee === 0);
} catch (error) {
  console.error(error);
  rows.push({ name: 'probe execution', ok: false });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(JSON.stringify({ probe: 'buy-sell-ramp-flow', passed: rows.filter((row) => row.ok).length, total: rows.length, rows }, null, 2));
if (rows.some((row) => !row.ok)) process.exitCode = 1;
export default rows;
