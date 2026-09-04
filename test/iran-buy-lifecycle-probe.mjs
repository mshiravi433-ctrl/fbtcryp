#!/usr/bin/env node
/**
 * Iranian USDT-buy lifecycle probe.
 *
 * The safety probe proves the boundary refuses. This one proves the machine
 * actually runs: one order is driven from a wallet signature through a hosted
 * checkout, a verified payment, an OTC fill, a withdrawal and an on-chain
 * receipt, plus the paths that must NOT deliver USDT (an unverified gateway
 * return, an authority that belongs to someone else, and a market that moved
 * outside the approved slippage after the customer paid).
 *
 * Nothing external is contacted. Redis, Wallex, ZarinPal and the EVM RPC are
 * all served by one in-process stub, so the code under test is the real order
 * engine, the real adapters and the real verification logic.
 */
import { Wallet } from 'ethers';

const MERCHANT_ID = '00000000-1111-2222-3333-444444444444';
const AMOUNT_TOMAN = '1000000';
const QUOTE_PRICE = '62500';
const TX_HASH = `0x${'ab'.repeat(32)}`;
const TOKEN_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

Object.assign(process.env, {
  IRAN_BUY_ENABLED: 'true',
  WALLEX_API_BASE_URL: 'https://api.wallex.ir',
  WALLEX_API_KEY: 'server-only-test-key-1234567890',
  UPSTASH_REDIS_REST_URL: 'https://iran-buy-lifecycle.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token-1234567890',
  BLOB_READ_WRITE_TOKEN: '',
  IRAN_BUY_USDT_NETWORK: 'ERC20',
  IRAN_BUY_USDT_NETWORK_LABEL: 'Ethereum',
  IRAN_BUY_NETWORK_APPROVED: 'true',
  IRAN_BUY_WALLET_FAMILY: 'EVM',
  IRAN_BUY_EVM_CHAIN_ID: '1',
  IRAN_BUY_USDT_TOKEN_CONTRACT: TOKEN_CONTRACT,
  IRAN_BUY_USDT_DECIMALS: '6',
  IRAN_BUY_MIN_TOMAN: '500000',
  IRAN_BUY_MAX_TOMAN: '100000000',
  IRAN_BUY_MIN_CONFIRMATIONS: '3',
  IRAN_BUY_PAYMENT_ADAPTER: 'ZARINPAL',
  ZARINPAL_MERCHANT_ID: MERCHANT_ID,
  IRAN_BUY_PAYMENT_CALLBACK_URL: 'https://app.example/iran-buy/return',
  IRAN_BUY_PAYMENT_CONTRACT_VERIFIED: 'true',
  IRAN_BUY_APPROVED_PAYMENT_HOSTS: 'payment.zarinpal.com',
  IRAN_BUY_MAX_SLIPPAGE_BPS: '50',
  IRAN_BUY_TREASURY_COST_CAP_ACKNOWLEDGED: 'true',
  IRAN_BUY_WALLEX_WITHDRAWAL_LIFECYCLE_VERIFIED: 'true',
  IRAN_BUY_SETTLEMENT_RECONCILIATION_APPROVED: 'true'
});

/* ── one stub for every external system ──────────────────────────────────── */

const redis = new Map();
const world = {
  quotePrice: QUOTE_PRICE,
  paidAuthorities: new Set(),
  verifiedAuthorities: new Set(),
  withdrawals: new Map(),
  otcOrders: new Map(),
  receiptAvailable: true,
  confirmations: 12,
  transferAmountUnits: null,
  calls: []
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Minimal Redis over the Upstash REST shape: SET (NX/EX), GET, EVAL. */
function redisCommand(command) {
  const [verb, ...args] = command.map((part) => String(part));
  if (verb === 'SET') {
    const [key, value, ...flags] = args;
    if (flags.includes('NX') && redis.has(key)) return { result: null };
    redis.set(key, value);
    return { result: 'OK' };
  }
  if (verb === 'GET') return { result: redis.has(args[0]) ? redis.get(args[0]) : null };
  if (verb === 'DEL') return { result: redis.delete(args[0]) ? 1 : 0 };
  if (verb === 'EVAL') {
    const [script, , key, arg] = args;
    if (script.includes('DEL')) {
      if (redis.get(key) === arg) { redis.delete(key); return { result: 1 }; }
      return { result: 0 };
    }
    if (script.includes('INCR')) {
      const next = Number(redis.get(key) || 0) + 1;
      redis.set(key, String(next));
      return { result: next };
    }
  }
  return { result: null };
}

function wallexResponse(target, init) {
  const path = target.pathname;
  if (path === '/v1/otc/markets') {
    return json({ success: true, result: { symbols: { USDTTMN: {
      symbol: 'USDTTMN', baseAsset: 'USDT', quoteAsset: 'TMN', buyStatus: 'ENABLE',
      baseAssetPrecision: 8, stepSize: 6, minQty: '0.000001', minNotional: '50000', maxNotional: '1000000000'
    } } } });
  }
  if (path === '/v1/account/otc/price') {
    return json({ success: true, result: { price: world.quotePrice, price_expires_at: new Date(Date.now() + 120_000).toISOString() } });
  }
  if (path === '/v1/account/otc/orders' && init.method === 'POST') {
    const body = JSON.parse(init.body || '{}');
    const quantity = String(body.amount);
    const sum = String(Math.round(Number(quantity) * Number(world.quotePrice)));
    const order = {
      clientOrderId: 'OTC-lifecycle-1', status: 'FILLED',
      executedQty: quantity, executedSum: sum, executedPrice: world.quotePrice,
      fills: [{ quantity, fee: '0.016', feeAsset: 'USDT' }]
    };
    world.otcOrders.set(order.clientOrderId, order);
    return json({ success: true, result: order });
  }
  if (path.startsWith('/v1/account/orders/')) {
    return json({ success: true, result: world.otcOrders.get(decodeURIComponent(path.split('/').pop())) || null });
  }
  if (path === '/v1/account/crypto-withdrawal' && init.method === 'POST') {
    const body = JSON.parse(init.body || '{}');
    const record = {
      id: 4242, status: 'Accomplished', amount: String(body.value), fee: '0',
      txHash: TX_HASH, wallet_address: body.wallet_address, network: { name: body.network }
    };
    world.withdrawals.set(String(record.id), record);
    world.transferAmountUnits = BigInt(Math.round(Number(body.value) * 1e6));
    return json({ success: true, result: record });
  }
  if (path === '/v1/account/crypto-withdrawal') {
    return json({ success: true, result: [...world.withdrawals.values()] });
  }
  return json({ success: false }, 404);
}

function zarinpalResponse(target, init) {
  const body = JSON.parse(init.body || '{}');
  if (target.pathname.endsWith('/request.json')) {
    const authority = `A${String(world.paidAuthorities.size).padStart(35, '0')}`;
    return json({ data: { code: 100, authority, fee_type: 'Merchant', fee: 0 }, errors: [] });
  }
  if (target.pathname.endsWith('/verify.json')) {
    if (!world.paidAuthorities.has(body.authority)) {
      return json({ data: [], errors: { code: -51, message: 'Session is not valid' } });
    }
    const already = world.verifiedAuthorities.has(body.authority);
    world.verifiedAuthorities.add(body.authority);
    return json({ data: { code: already ? 101 : 100, ref_id: 987654321, card_pan: '502229******5995', fee: 0 }, errors: [] });
  }
  return json({ data: [], errors: [] });
}

function rpcResponse(init) {
  const { method, params } = JSON.parse(init.body || '{}');
  const result = method === 'eth_chainId' ? '0x1'
    : method === 'eth_blockNumber' ? `0x${(100 + world.confirmations - 1).toString(16)}`
      : method === 'eth_getBlockByNumber' ? { timestamp: '0x66d00000' }
        : method === 'eth_getTransactionReceipt' ? (world.receiptAvailable && params[0] === TX_HASH ? {
          status: '0x1',
          blockNumber: '0x64',
          logs: [{
            address: TOKEN_CONTRACT.toLowerCase(),
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x${'0'.repeat(24)}${'11'.repeat(20)}`,
              `0x${'0'.repeat(24)}${wallet.address.slice(2).toLowerCase()}`
            ],
            data: `0x${world.transferAmountUnits.toString(16)}`
          }]
        } : null) : null;
  return json({ jsonrpc: '2.0', id: 1, result });
}

const wallet = Wallet.createRandom();

globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  world.calls.push(`${init.method || 'GET'} ${target.host}${target.pathname}`);
  if (target.host.endsWith('.upstash.io')) return json(redisCommand(JSON.parse(init.body || '[]')));
  if (target.host === 'api.wallex.ir') return wallexResponse(target, init);
  if (target.host === 'payment.zarinpal.com') return zarinpalResponse(target, init);
  return rpcResponse(init);
};

const iranBuy = await import('../server/iranBuy.js');

/* ── the run ─────────────────────────────────────────────────────────────── */

const rows = [];
const check = (name, ok) => rows.push({ name, ok: Boolean(ok) });
const owner = '900100100';
const otherOwner = '900200200';
const failureOf = async (worker) => {
  try { await worker(); return null; }
  catch (error) { return error?.code || error?.message || 'UNKNOWN'; }
};

async function bindWallet(ownerId = owner) {
  const challenge = await iranBuy.createIranBuyWalletChallenge({ ownerId, address: wallet.address, chainId: 1 });
  const signature = await wallet.signMessage(challenge.message);
  return iranBuy.verifyIranBuyWalletChallenge({ ownerId, challengeId: challenge.challengeId, signature });
}

async function payAndConfirm(order, { ownerId = owner } = {}) {
  const authority = [...world.paidAuthorities].pop();
  return iranBuy.verifyIranBuyPayment({
    ownerId, orderId: order.orderId, orderAccessToken: order.accessToken, authority, status: 'OK'
  });
}

async function newOrder({ ownerId = owner } = {}) {
  const binding = await bindWallet(ownerId);
  const { preview } = await iranBuy.createIranBuyPreview({
    ownerId, amountToman: AMOUNT_TOMAN, walletBindingToken: binding.walletBindingToken
  });
  const created = await iranBuy.createIranBuyOrder({
    ownerId,
    previewId: preview.previewId,
    previewAccessToken: preview.accessToken,
    walletBindingToken: binding.walletBindingToken,
    idempotencyKey: `iran-order_${Math.random().toString(36).slice(2)}`
  });
  return { ...created.order, raw: created.order, accessToken: created.orderAccessToken, checkoutUrl: created.checkoutUrl };
}

try {
  /* 1. Order creation produces a real hosted-checkout hand-off. */
  const order = await newOrder();
  const authority = order.paymentCheckoutUrl.split('/').pop();
  world.paidAuthorities.add(authority); // the customer completes the checkout

  check('an order is created payment-pending with a hosted checkout on the approved host',
    order.status === 'PAYMENT_PENDING' && order.paymentStatus === 'AWAITING_GATEWAY'
    && order.paymentCheckoutUrl.startsWith('https://payment.zarinpal.com/pg/StartPay/')
    && order.paymentProvider === 'zarinpal');
  check('creating an order buys and withdraws nothing',
    !world.calls.some((entry) => entry.includes('otc/orders') || entry.includes('crypto-withdrawal')));
  /* The authority necessarily appears inside the redirect the customer must
     follow; what must never leave the server is the stored authority field,
     its hash, the owner hash and the session token hash. */
  check('the browser copy of the order carries no authority field, owner hash or token hash',
    !('paymentAuthority' in order.raw) && !('paymentAuthorityHash' in order.raw)
    && !('ownerIdHash' in order.raw) && !('accessTokenHash' in order.raw)
    && order.checkoutUrl === order.raw.paymentCheckoutUrl);

  /* 2. Only a verified payment counts. */
  check('a gateway return for a different authority never confirms the payment',
    (await failureOf(() => iranBuy.verifyIranBuyPayment({
      ownerId: owner, orderId: order.orderId, orderAccessToken: order.accessToken,
      authority: `A${'9'.repeat(35)}`, status: 'OK'
    }))) === 'PAYMENT_AUTHORITY_MISMATCH');
  check('another Telegram account cannot verify someone else\'s order',
    (await failureOf(() => iranBuy.verifyIranBuyPayment({
      ownerId: otherOwner, orderId: order.orderId, orderAccessToken: order.accessToken, authority, status: 'OK'
    }))) === 'ORDER_NOT_FOUND');

  const confirmed = (await payAndConfirm(order)).order;
  check('a verified payment moves the order to payment-confirmed with the payer\'s reference',
    confirmed.status === 'PAYMENT_CONFIRMED' && confirmed.paymentStatus === 'CONFIRMED'
    && confirmed.paymentReference === '987654321' && confirmed.requiresWalletSettlementAuthorization === true);
  check('confirming a payment still buys nothing before the destination is re-signed',
    !world.calls.some((entry) => entry.includes('otc/orders')));
  check('no card data survives anywhere in the customer-visible order',
    !JSON.stringify(confirmed).includes('5995') && !JSON.stringify(confirmed).includes('502229'));
  check('re-verifying the same authority is idempotent, not a second charge',
    (await payAndConfirm(order)).order.status === 'PAYMENT_CONFIRMED'
    && world.calls.filter((entry) => entry.includes('request.json')).length === 1);

  /* 3. Settlement requires a fresh signature from the same wallet. */
  const settlementChallenge = await iranBuy.createIranBuySettlementChallenge({
    ownerId: owner, orderId: order.orderId, orderAccessToken: order.accessToken
  });
  const stranger = Wallet.createRandom();
  check('a signature from any other wallet cannot release the USDT',
    (await failureOf(async () => iranBuy.authorizeIranBuySettlement({
      ownerId: owner, orderId: order.orderId, orderAccessToken: order.accessToken,
      challengeId: settlementChallenge.challengeId, signature: await stranger.signMessage(settlementChallenge.message)
    }))) === 'WALLET_SIGNATURE_INVALID');

  const authorized = (await iranBuy.authorizeIranBuySettlement({
    ownerId: owner, orderId: order.orderId, orderAccessToken: order.accessToken,
    challengeId: settlementChallenge.challengeId,
    signature: await wallet.signMessage(settlementChallenge.message)
  })).order;
  check('the authorized order executes the OTC buy and requests exactly the net withdrawal',
    world.calls.includes('POST api.wallex.ir/v1/account/otc/orders')
    && world.calls.includes('POST api.wallex.ir/v1/account/crypto-withdrawal')
    && authorized.actualUsdtAmount === '15.984');
  check('the executed Toman cost never exceeds the money actually collected',
    Number(world.otcOrders.get('OTC-lifecycle-1').executedSum) <= Number(AMOUNT_TOMAN));

  /* 4. Confirmation is an on-chain receipt, not a provider claim. */
  const settled = (await iranBuy.getIranBuyOrder({
    ownerId: owner, orderId: order.orderId, orderAccessToken: order.accessToken
  })).order;
  check('the order is confirmed only after the chain receipt matches recipient and amount',
    settled.status === 'CONFIRMED' && settled.txHash === TX_HASH
    && settled.explorerTxUrl?.startsWith('https://etherscan.io/tx/'));

  const audit = await iranBuy.getIranBuyOrderAudit({
    ownerId: owner, orderId: order.orderId, orderAccessToken: order.accessToken
  });
  const auditText = JSON.stringify(audit);
  check('the audit timeline records the payment and settlement events',
    ['PAYMENT_INTENT_CREATED', 'PAYMENT_VERIFIED', 'DESTINATION_REAUTHORIZED', 'OTC_ORDER_FILLED', 'WITHDRAWAL_REPORTED', 'BLOCKCHAIN_VERIFIED']
      .every((event) => auditText.includes(event)));
  check('the audit stores no authority, checkout URL, signature or card data',
    !auditText.includes(authority) && !auditText.includes('StartPay') && !auditText.includes('5995'));

  /* 5. A receipt that does not match must never become a delivery. */
  world.transferAmountUnits += 1n;
  const tampered = await newOrder();
  world.paidAuthorities.add(tampered.paymentCheckoutUrl.split('/').pop());
  await payAndConfirm(tampered);
  const tamperedChallenge = await iranBuy.createIranBuySettlementChallenge({
    ownerId: owner, orderId: tampered.orderId, orderAccessToken: tampered.accessToken
  });
  await iranBuy.authorizeIranBuySettlement({
    ownerId: owner, orderId: tampered.orderId, orderAccessToken: tampered.accessToken,
    challengeId: tamperedChallenge.challengeId,
    signature: await wallet.signMessage(tamperedChallenge.message)
  });
  world.transferAmountUnits -= 1n; // the chain paid a different amount than requested
  const mismatched = (await iranBuy.getIranBuyOrder({
    ownerId: owner, orderId: tampered.orderId, orderAccessToken: tampered.accessToken
  })).order;
  check('a transfer whose amount differs from the withdrawal is quarantined, not confirmed',
    mismatched.status === 'FAILED' && mismatched.verificationStatus === 'FAILED');

  /* 6. A market that moved after payment waits instead of under-delivering. */
  const jumpy = await newOrder();
  world.paidAuthorities.add(jumpy.paymentCheckoutUrl.split('/').pop());
  await payAndConfirm(jumpy);
  const jumpyChallenge = await iranBuy.createIranBuySettlementChallenge({
    ownerId: owner, orderId: jumpy.orderId, orderAccessToken: jumpy.accessToken
  });
  world.quotePrice = '64000'; // +2.4%, outside the 0.5% cap
  const otcCallsBefore = world.calls.filter((entry) => entry.includes('otc/orders')).length;
  const held = (await iranBuy.authorizeIranBuySettlement({
    ownerId: owner, orderId: jumpy.orderId, orderAccessToken: jumpy.accessToken,
    challengeId: jumpyChallenge.challengeId,
    signature: await wallet.signMessage(jumpyChallenge.message)
  })).order;
  check('a price outside the approved slippage holds the paid order instead of buying',
    held.status === 'PAYMENT_CONFIRMED'
    && world.calls.filter((entry) => entry.includes('otc/orders')).length === otcCallsBefore);
  world.quotePrice = QUOTE_PRICE;
  const resumed = (await iranBuy.getIranBuyOrder({
    ownerId: owner, orderId: jumpy.orderId, orderAccessToken: jumpy.accessToken
  })).order;
  check('once the market comes back inside the cap the same paid order settles',
    ['SENT', 'SETTLEMENT_PENDING', 'CONFIRMED'].includes(resumed.status)
    && world.calls.filter((entry) => entry.includes('otc/orders')).length > otcCallsBefore);

  /* 7. Cancelling is safe: unpaid orders close, paid ones refuse to close. */
  const abandoned = await newOrder();
  const cancelled = (await iranBuy.cancelIranBuyOrder({
    ownerId: owner, orderId: abandoned.orderId, orderAccessToken: abandoned.accessToken
  })).order;
  check('an unpaid order can be cancelled and stops offering a checkout',
    cancelled.status === 'CANCELLED' && !cancelled.paymentCheckoutUrl);

  const raced = await newOrder();
  world.paidAuthorities.add(raced.paymentCheckoutUrl.split('/').pop());
  check('an order paid seconds before the cancel click is kept, not cancelled',
    (await failureOf(() => iranBuy.cancelIranBuyOrder({
      ownerId: owner, orderId: raced.orderId, orderAccessToken: raced.accessToken
    }))) === 'CANCEL_UNAVAILABLE'
    && (await iranBuy.getIranBuyOrder({
      ownerId: owner, orderId: raced.orderId, orderAccessToken: raced.accessToken, poll: false
    })).order.paymentStatus === 'CONFIRMED');
} catch (error) {
  console.error(error);
  rows.push({ name: 'lifecycle execution', ok: false });
}

console.log(JSON.stringify({ probe: 'iran-buy-lifecycle', passed: rows.filter((row) => row.ok).length, total: rows.length, rows }, null, 2));
if (rows.some((row) => !row.ok)) process.exitCode = 1;
export default rows;
