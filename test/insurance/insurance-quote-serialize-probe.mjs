/**
 * Regression: live Nexus/InsurAce quotes carry BigInt *Micro money.
 * Durable store + HTTP JSON.stringify used to throw
 * "Do not know how to serialize a BigInt" and leak that English into the UI.
 */
import assert from 'node:assert/strict';

let pass = 0;
const ok = (name) => { pass += 1; console.log('  ✓', name); };

const { jsonSafe, jsonStringify, parseMicro, toMicro } = await import('../../server/insurance/constants.js');
const { buildQuote } = await import('../../server/insurance/quote-engine.js');
const { computeFees } = await import('../../server/insurance/fee-engine.js');
const store = await import('../../server/insurance/store.js');
const { classifyQuoteError } = await import('../../server/insurance/service.js');
const { reasonLabel } = await import('../../src/pages/insurance/insStatus.js');
const { checksumAddress, classifyNexusHttpError, NexusMutualAdapter } = await import('../../server/insurance/adapters/nexus-mutual.js');

assert.equal(parseMicro(1_500_000n), 1_500_000n);
assert.equal(parseMicro('1500000'), 1_500_000n);
assert.equal(parseMicro('1.5'), 1_500_000n);
assert.equal(parseMicro('1500000'), toMicro('1.5'));
const fromString = computeFees({ premiumMicro: '1500000', provider: {}, network: 1 });
const fromBig = computeFees({ premiumMicro: 1_500_000n, provider: {}, network: 1 });
assert.equal(fromString.totalCostMicro, fromBig.totalCostMicro);
ok('parseMicro treats integer strings as already-micro (never re-scales as dollars)');

const quote = buildQuote({
  provider: { providerId: 'nexus-mutual', name: 'Nexus Mutual', settlementModel: 'DIRECT' },
  product: { id: 'nexus-97', name: 'Aave v3', kind: 'lending', claimMethod: 'nexus-assessment' },
  params: {
    chainId: 1, protectionType: 'lending',
    walletAddress: '0x1111111111111111111111111111111111111111',
    coverageAmountMicro: 10_000_000_000n, durationDays: 28
  },
  premiumMicro: 12_345_678n,
  network: 1,
  currency: 'usdc',
  raw: {
    premiumInAsset: 12345678n,
    buyCoverParams: { amount: '10000000000', owner: '0x1111111111111111111111111111111111111111' },
    poolAllocationRequests: [{ poolId: 1n, coverAmountInAsset: 10_000_000_000n }]
  }
});
assert.equal(typeof quote.premiumMicro, 'string');
assert.equal(quote.premiumMicro, '12345678');
assert.equal(typeof quote.coverageAmountMicro, 'string');
assert.equal(typeof quote.totalCostMicro, 'string');
assert.equal(typeof quote.fbtFeeMicro, 'string');
assert.equal(quote.providerQuoteRaw.premiumInAsset, '12345678');
assert.equal(quote.providerQuoteRaw.poolAllocationRequests[0].poolId, '1');
assert.doesNotThrow(() => JSON.stringify(quote));
assert.doesNotThrow(() => JSON.stringify({ value: quote, expires: Date.now() }));
assert.equal(jsonSafe(99n), '99');
assert.ok(jsonStringify({ n: 7n }).includes('"7"'));
ok('buildQuote jsonSafe: BigInt premium/coverage/fees/raw stringify; durable JSON.stringify does not throw');

await store.set('quotes', 'q-bigint-probe', {
  premiumMicro: 42n, nested: { coverageAmountMicro: 100n, arr: [1n, 2n] }
});
const stored = await store.get('quotes', 'q-bigint-probe');
assert.equal(stored.premiumMicro, '42');
assert.equal(stored.nested.coverageAmountMicro, '100');
assert.deepEqual(stored.nested.arr, ['1', '2']);
ok('insurance store.set jsonSafe-s BigInt money before durable write');

const serErr = new TypeError('Do not know how to serialize a BigInt');
assert.equal(classifyQuoteError(serErr), 'QUOTE_ERROR');
assert.equal(classifyQuoteError({ code: 'PROVIDER_UNAVAILABLE', message: 'timeout' }), 'PROVIDER_UNAVAILABLE');
const t = (k) => k;
assert.equal(reasonLabel(t, 'Do not know how to serialize a BigInt'), 'insurance.reason.ADAPTER_ERROR');
assert.equal(reasonLabel(t, 'Nexus Mutual: Do not know how to serialize a BigInt'), 'insurance.reason.ADAPTER_ERROR');
assert.equal(reasonLabel(t, 'QUOTE_REJECTED_BY_PROVIDER'), 'insurance.reason.QUOTE_REJECTED_BY_PROVIDER');
ok('serialize TypeError maps to QUOTE_ERROR / ADAPTER_ERROR — never leaked as English to the UI');

const lower = '0x1111111111111111111111111111111111111111';
const cs = checksumAddress(lower);
assert.ok(cs && /^0x[a-fA-F0-9]{40}$/.test(cs));
assert.equal(checksumAddress(cs.toLowerCase()), cs);
assert.equal(checksumAddress('not-an-address'), null);
const nexus = new NexusMutualAdapter();
assert.equal(nexus.amountToBaseUnits(10_000_000_000n, { decimals: 6 }), '10000000000');
assert.equal(nexus.amountToBaseUnits('10000000000', { decimals: 6 }), '10000000000');
ok('Nexus checksums wallet addresses (EIP-55) and treats *Micro integer strings as micro-units');

assert.equal(classifyNexusHttpError({ kind: 'timeout', body: 'not enough capacity', action: '/quote' }), 'PROVIDER_UNAVAILABLE');
assert.equal(classifyNexusHttpError({ kind: 'network', body: '', action: '/quote' }), 'PROVIDER_UNAVAILABLE');
assert.equal(classifyNexusHttpError({ kind: 'parse', body: 'insufficient capacity', action: '/quote' }), 'PROVIDER_UNAVAILABLE');
ok('classifyNexusHttpError: non-status → PROVIDER_UNAVAILABLE (never a fake capacity shortage)');

assert.equal(classifyNexusHttpError({ kind: 'status', body: 'not enough capacity', action: '/quote' }), 'CAPACITY_UNAVAILABLE');
assert.equal(classifyNexusHttpError({ kind: 'status', body: 'Insufficient capacity for this cover', action: '/quote' }), 'CAPACITY_UNAVAILABLE');
assert.equal(classifyNexusHttpError({ kind: 'status', body: 'unable to allocate pool', action: '/quote' }), 'CAPACITY_UNAVAILABLE');
ok('classifyNexusHttpError: /quote + real shortage → CAPACITY_UNAVAILABLE');

const swaggerBody = 'Cannot GET /v2/capacity/{productId}';
assert.equal(classifyNexusHttpError({ kind: 'status', body: swaggerBody, action: '/quote' }), 'PROVIDER_HTTP_ERROR');
assert.equal(classifyNexusHttpError({ kind: 'status', body: '<html>GET /v2/capacity/{productId}</html>', action: '/quote' }), 'PROVIDER_HTTP_ERROR');
ok('classifyNexusHttpError: swagger HTML GET /v2/capacity/{productId} on /quote stays PROVIDER_HTTP_ERROR');

assert.equal(classifyNexusHttpError({ kind: 'status', body: 'not enough capacity', action: 'cover-metadata' }), 'PROVIDER_HTTP_ERROR');
assert.equal(classifyNexusHttpError({ kind: 'status', body: swaggerBody, action: 'cover-metadata' }), 'PROVIDER_HTTP_ERROR');
ok('classifyNexusHttpError: cover-metadata never becomes CAPACITY_UNAVAILABLE');

assert.equal(nexus._httpError({ status: 0, error: { kind: 'timeout', body: 'not enough capacity' } }, '/quote').code, 'PROVIDER_UNAVAILABLE');
assert.equal(nexus._httpError({ status: 400, error: { kind: 'status', body: 'not enough capacity' } }, '/quote').code, 'CAPACITY_UNAVAILABLE');
assert.equal(nexus._httpError({ status: 404, error: { kind: 'status', body: swaggerBody } }, '/quote').code, 'PROVIDER_HTTP_ERROR');
assert.equal(nexus._httpError({ status: 400, error: { kind: 'status', body: 'not enough capacity' } }, 'cover-metadata').code, 'PROVIDER_HTTP_ERROR');
ok('_httpError wires classifyNexusHttpError (greedy /capacit|insufficient|not enough/ regex gone)');

console.log(`\nPASS ${pass} insurance-quote-serialize assertions`);
