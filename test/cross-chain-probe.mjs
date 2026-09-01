#!/usr/bin/env node
/**
 * CROSS-CHAIN PROBE — the engine, the API and the wiring, against real code.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS EXISTS TO CATCH ──────────────────────────────────────────────
 * The Intent OS «میان‌زنجیره‌ای» tab shipped a rate that came from this literal
 * in server/intentBridgeQuote.js:
 *
 *     estimatedOutput: amount || '999000', fee: '1000', estimatedTime: 120
 *
 * A probe that only asked "does /api/intents/v1/bridge-quote return 200?"
 * would have passed every single day it was wrong. So this file asserts the
 * properties that a mock CANNOT satisfy:
 *
 *   · the numbers come from a provider payload and change when it changes;
 *   · a quote expires, and an expired one is refused;
 *   · the "best" route is the best by a scoring function, not routes[0];
 *   · COMPLETED is unreachable without a destination transaction hash;
 *   · a provider outage produces an error, never a rate;
 *   · the bridge page and Intent OS import the SAME service.
 *
 * The upstream is stubbed at the network boundary (li.quest), never inside our
 * own code — every line of normalisation, ranking, state machine and routing
 * under test is the real one that runs in production.
 */

process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.INTENT_AI_SANDBOX_EVIDENCE = process.env.INTENT_AI_SANDBOX_EVIDENCE || '0';
delete process.env.BLOB_READ_WRITE_TOKEN;

import { readFileSync } from 'node:fs';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ════════════════════════════════════════════════════════════════════════ */
/* 1. the pure engine                                                       */
/* ════════════════════════════════════════════════════════════════════════ */

const core = await import('../src/services/cross-chain/core.js');

const USDC_BASE = { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, chainId: 8453, priceUSD: '1' };
const ETH_MAINNET = { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18, chainId: 1, priceUSD: '3200' };

const lifiStep = (overrides = {}) => ({
  type: 'lifi',
  id: 'step-abc',
  tool: 'across',
  toolDetails: { key: 'across', name: 'Across' },
  action: {
    fromChainId: 8453,
    toChainId: 1,
    fromToken: USDC_BASE,
    toToken: ETH_MAINNET,
    fromAmount: '100000000',
    slippage: 0.005,
    fromAddress: '0x1111111111111111111111111111111111111111',
    toAddress: '0x1111111111111111111111111111111111111111'
  },
  estimate: {
    tool: 'across',
    fromAmount: '100000000',
    toAmount: '30756000000000000',
    toAmountMin: '30602220000000000',
    approvalAddress: '0x2222222222222222222222222222222222222222',
    executionDuration: 45,
    fromAmountUSD: '100.00',
    toAmountUSD: '98.42',
    feeCosts: [
      {
        name: 'LIFI Protocol Fee',
        amountUSD: '0.25',
        amount: '250000',
        included: true,
        token: USDC_BASE,
        feeSplit: { recipients: [{ name: 'lifi', fee: '150000' }, { name: 'fbt-swap', fee: '100000' }] }
      },
      { name: 'Across Relayer Fee', amountUSD: '0.59', amount: '590000', included: true, token: USDC_BASE }
    ],
    gasCosts: [{ type: 'SEND', amountUSD: '0.37', amount: '115000000000000', token: { symbol: 'ETH', decimals: 18, priceUSD: '3200' } }]
  },
  transactionRequest: { to: '0x3333333333333333333333333333333333333333', data: '0xdeadbeef', value: '0x0', gasLimit: '0x7a120', chainId: 8453 },
  ...overrides
});

const now = 1_700_000_000_000;
const quote = core.normalizeLifiStep(lifiStep(), { now });

t('a LI.FI step normalises into the internal quote schema', quote?.schema === 'fbt.cross-chain-quote.v1');
t('the output amount is the provider\'s, not a default', quote.toAmount === '30756000000000000');
t('gas is summed from the provider gas costs', Math.abs(quote.gasCostUsd - 0.37) < 1e-9);
t('the bridge fee and the protocol fee are itemised apart',
  Math.abs(quote.bridgeFeeUsd - 0.59) < 1e-9 && Math.abs(quote.protocolFeeUsd - 0.25) < 1e-9);
t('our own cut is read out of the provider fee split, not from config',
  quote.integratorFeeUsd != null && Math.abs(quote.integratorFeeUsd - 0.1) < 1e-6);
t('the interface string fields are present (gasCost/bridgeFee/protocolFee)',
  typeof quote.gasCost === 'string' && typeof quote.bridgeFee === 'string' && typeof quote.protocolFee === 'string');
t('slippage and duration survive normalisation', quote.slippage === 0.005 && quote.estimatedTime === 45);
t('the quote is executable only because a transactionRequest exists', quote.executable === true);
t('a route with no transactionRequest is NOT executable',
  core.normalizeLifiStep(lifiStep({ transactionRequest: undefined }), { now }).executable === false);

/* quote identity + expiry */
const same = core.normalizeLifiStep(lifiStep(), { now: now + 5000 });
t('the same price produces the same quote id (a refresh is not a change)', same.quoteId === quote.quoteId);
const moved = lifiStep();
moved.estimate.toAmount = '30000000000000000';
t('a different output produces a different quote id (a change IS a change)',
  core.normalizeLifiStep(moved, { now }).quoteId !== quote.quoteId);
t('every quote carries createdAt and expiresAt', quote.createdAt === now && quote.expiresAt === now + core.QUOTE_TTL_MS);
t('an expired quote is reported expired', core.isQuoteExpired(quote, now + core.QUOTE_TTL_MS + 1));
t('a live quote is not', !core.isQuoteExpired(quote, now + 1000));
t('the countdown is seconds, floored at zero',
  core.quoteSecondsLeft(quote, now) === 60 && core.quoteSecondsLeft(quote, now + 999_999) === 0);

/* ranking */
const routeFixture = ({ id, tool, toAmount, toAmountUSD, gasCostUSD, duration, tags = [], steps = 1, feeUsd = 0, included = true }) => ({
  id,
  fromChainId: 8453,
  toChainId: 1,
  fromToken: USDC_BASE,
  toToken: ETH_MAINNET,
  fromAmount: '100000000',
  fromAmountUSD: '100.00',
  toAmount,
  toAmountMin: toAmount,
  toAmountUSD: String(toAmountUSD),
  gasCostUSD: String(gasCostUSD),
  tags,
  steps: Array.from({ length: steps }, (_, i) => ({
    type: i === 0 ? 'cross' : 'swap',
    tool,
    toolDetails: { name: tool },
    action: { fromChainId: 8453, toChainId: 1, slippage: 0.005 },
    estimate: {
      executionDuration: duration / steps,
      feeCosts: feeUsd ? [{ name: 'bridge fee', amountUSD: String(feeUsd), amount: '1', included }] : [],
      gasCosts: []
    }
  }))
});

const routes = [
  routeFixture({ id: 'a', tool: 'slowbridge', toAmount: '31000000000000000', toAmountUSD: 98.5, gasCostUSD: 0.4, duration: 10800, tags: [] }),
  routeFixture({ id: 'b', tool: 'across', toAmount: '30756000000000000', toAmountUSD: 98.4, gasCostUSD: 0.37, duration: 45, tags: ['RECOMMENDED'] }),
  routeFixture({ id: 'c', tool: 'gasguzzler', toAmount: '31200000000000000', toAmountUSD: 99.8, gasCostUSD: 4.2, duration: 120, tags: [] })
].map((r) => core.normalizeLifiRoute(r, { now }));

const ranked = core.rankRoutes(routes);
t('a route normalises without a transactionRequest (it is a comparison only)', routes[0].executable === false);
t('the biggest headline output does NOT win when its gas eats the difference',
  ranked[0].tool !== 'gasguzzler');
t('three hours in flight loses to a 45-second route worth a dime less', ranked[0].tool === 'across');
t('...but a materially better rate still wins — slowness is a cost, not a veto',
  core.selectBestRoute([
    routeFixture({ id: 'rich', tool: 'slowbridge', toAmount: '31500000000000000', toAmountUSD: 100.5, gasCostUSD: 0.4, duration: 3600 }),
    routeFixture({ id: 'fast', tool: 'across', toAmount: '30756000000000000', toAmountUSD: 98.4, gasCostUSD: 0.37, duration: 45, tags: ['RECOMMENDED'] })
  ].map((r) => core.normalizeLifiRoute(r, { now }))).tool === 'slowbridge');
t('ranking is explained, not asserted', typeof ranked[0].score === 'number' && ranked[0].scoreBreakdown.gasUsd != null);
t('the winner is flagged and ranks are 1-based', ranked[0].best === true && ranked[0].rank === 1 && ranked[2].rank === 3);
t('selectBestRoute agrees with the ranking', core.selectBestRoute(routes).tool === ranked[0].tool);
t('an unpriceable route is ranked last rather than scored zero',
  core.rankRoutes([...routes, { ...routes[0], toAmountUsd: 0, toTokenDetail: { decimals: 18 }, tool: 'unpriced' }]).at(-1).tool === 'unpriced');
t('more hops means less reliability', core.routeReliability({ steps: [1, 2, 3], tags: [] }) < core.routeReliability({ steps: [1], tags: [] }));

/* the no-fake-success rule */
t('COMPLETED without a destination hash is downgraded, always',
  core.guardCompletion('COMPLETED', {}) === 'DESTINATION_PENDING');
t('COMPLETED with a destination hash stands',
  core.guardCompletion('COMPLETED', { destinationTxHash: '0xabc' }) === 'COMPLETED');
t('the state machine refuses to go backwards', !core.canTransition('COMPLETED', 'BRIDGING'));
t('...and refuses to skip straight from quoted to completed', !core.canTransition('QUOTED', 'COMPLETED'));
t('...but allows the real path', core.canTransition('SUBMITTED', 'BRIDGING') && core.canTransition('BRIDGING', 'DESTINATION_PENDING'));

t('provider DONE without a receiving tx is destination-pending, not completed',
  core.statusFromProvider({ status: 'DONE', sending: { txHash: '0xa' } }).status === 'DESTINATION_PENDING');
t('provider DONE with a receiving tx is completed',
  core.statusFromProvider({ status: 'DONE', sending: { txHash: '0xa' }, receiving: { txHash: '0xb', amount: '5' } }).status === 'COMPLETED');
t('a pending transfer waiting on the destination says so',
  core.statusFromProvider({ status: 'PENDING', substatus: 'WAIT_DESTINATION_TRANSACTION' }).status === 'DESTINATION_PENDING');
t('an unindexed transfer is submitted, never failed',
  core.statusFromProvider({ status: 'NOT_FOUND' }).status === 'SUBMITTED');
t('a failed transfer is failed', core.statusFromProvider({ status: 'FAILED' }).status === 'FAILED');
t('the received amount is carried through for the history row',
  core.statusFromProvider({ status: 'DONE', receiving: { txHash: '0xb', amount: '30700000000000000' } }).actualAmount === '30700000000000000');

/* addresses, per family */
t('an EVM address is refused for a Solana destination',
  core.validateDestinationAddress('0x1111111111111111111111111111111111111111', 'SOL').code === 'EVM_ADDRESS_ON_SOLANA');
t('a real Solana address is accepted for Solana',
  core.validateDestinationAddress('So11111111111111111111111111111111111111112', 'SOL').ok === true);
t('a base58 string of the wrong byte length is refused',
  core.validateDestinationAddress('1111111111111111111111111111111111', 'SOL').ok === false);
t('an EVM address is accepted for an EVM chain',
  core.validateDestinationAddress('0x1111111111111111111111111111111111111111', 1).ok === true);
t('a truncated EVM address is refused',
  core.validateDestinationAddress('0x111', 1).code === 'BAD_EVM_ADDRESS');

/* parameter validation */
t('same-chain is refused before any provider call',
  core.validateQuoteParams({ fromChain: 1, toChain: 1, fromToken: 'a', toToken: 'b', fromAmount: '1', fromAddress: '0x1111111111111111111111111111111111111111' }).code === 'SAME_CHAIN');
t('a zero or non-integer amount is refused',
  core.validateQuoteParams({ fromChain: 1, toChain: 8453, fromToken: 'a', toToken: 'b', fromAmount: '0', fromAddress: '0x1111111111111111111111111111111111111111' }).code === 'BAD_AMOUNT');
t('crossing EVM→Solana without a destination address is refused',
  core.validateQuoteParams({ fromChain: 8453, toChain: 'SOL', fromToken: 'a', toToken: 'b', fromAmount: '10', fromAddress: '0x1111111111111111111111111111111111111111' }).code === 'DESTINATION_REQUIRED');
t('a wallet-less comparison is allowed when the caller says so',
  core.validateQuoteParams({ fromChain: 8453, toChain: 1, fromToken: 'a', toToken: 'b', fromAmount: '10' }, { requireAddress: false }).ok === true);
t('absurd slippage is refused',
  core.validateQuoteParams({ fromChain: 8453, toChain: 1, fromToken: 'a', toToken: 'b', fromAmount: '10', fromAddress: '0x1111111111111111111111111111111111111111', slippage: 0.9 }).code === 'BAD_SLIPPAGE');

/* amount maths */
t('0.1 at 18 decimals converts exactly (no float drift)', core.toBaseUnits('0.1', 18) === '100000000000000000');
t('base units convert back', core.fromBaseUnits('30756000000000000', 18) === '0.030756');
t('a nonsense amount is null rather than zero', core.toBaseUnits('abc', 6) === null);

/* the summary both surfaces render */
const summary = core.summariseQuote(quote);
t('the shared summary reduces to the numbers a person reads',
  summary.receive === '0.030756' && summary.receiveSymbol === 'ETH' && Math.abs(summary.totalCostUsd - 1.21) < 1e-9);

/* ════════════════════════════════════════════════════════════════════════ */
/* 2. the API, over real HTTP, with the provider stubbed at the boundary    */
/* ════════════════════════════════════════════════════════════════════════ */

const realFetch = globalThis.fetch;
let providerDown = false;
let statusPhase = 'pending';
const calls = [];

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

globalThis.fetch = async (input, init) => {
  const url = String(input?.url || input);
  if (!url.startsWith('https://li.quest/')) return realFetch(input, init);
  calls.push(url);
  if (providerDown) return json({ message: 'upstream exploded' }, 502);

  if (url.includes('/v1/chains')) {
    return json({
      chains: [
        { id: 1, key: 'eth', name: 'Ethereum', chainType: 'EVM', coin: 'ETH', metamask: { blockExplorerUrls: ['https://etherscan.io'], rpcUrls: ['https://rpc'] } },
        { id: 8453, key: 'bas', name: 'Base', chainType: 'EVM', coin: 'ETH', metamask: { blockExplorerUrls: ['https://basescan.org'], rpcUrls: ['https://rpc'] } },
        { id: 1151111081099710, key: 'sol', name: 'Solana', chainType: 'SVM', coin: 'SOL' },
        /* A chain LI.FI serves and our wallet cannot sign for — must NOT be
           offered to the user. */
        { id: 324, key: 'era', name: 'zkSync', chainType: 'EVM', coin: 'ETH' }
      ]
    });
  }
  if (url.includes('/v1/tools')) return json({ bridges: [{ key: 'across' }, { key: 'stargate' }], exchanges: [{ key: '1inch' }] });
  if (url.includes('/v1/tokens')) {
    const chain = new URL(url).searchParams.get('chains');
    const table = {
      8453: [USDC_BASE, { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, chainId: 8453, priceUSD: '3200' }],
      1: [{ ...USDC_BASE, chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, ETH_MAINNET]
    };
    return json({ tokens: { [chain]: table[chain] || [] } });
  }
  if (url.includes('/v1/integrators/')) return json({ integratorId: 'fbt-swap', feeBalances: [] });
  if (url.includes('/v1/quote')) return json(lifiStep());
  if (url.includes('/v1/advanced/routes')) {
    return json({
      routes: [
        routeFixture({ id: 'r-slow', tool: 'slowbridge', toAmount: '31000000000000000', toAmountUSD: 98.45, gasCostUSD: 0.4, duration: 10800 }),
        routeFixture({ id: 'r-across', tool: 'across', toAmount: '30756000000000000', toAmountUSD: 98.4, gasCostUSD: 0.37, duration: 45, tags: ['RECOMMENDED'] })
      ]
    });
  }
  if (url.includes('/v1/status')) {
    if (statusPhase === 'pending') return json({ status: 'PENDING', substatus: 'WAIT_DESTINATION_TRANSACTION', sending: { txHash: '0x' + 'a'.repeat(64) } });
    if (statusPhase === 'done-no-dest') return json({ status: 'DONE', sending: { txHash: '0x' + 'a'.repeat(64) } });
    return json({
      status: 'DONE',
      sending: { txHash: '0x' + 'a'.repeat(64), txLink: 'https://basescan.org/tx/0xaaa' },
      receiving: { txHash: '0x' + 'b'.repeat(64), amount: '30700000000000000', txLink: 'https://etherscan.io/tx/0xbbb' },
      tool: 'across'
    });
  }
  return json({ message: 'unstubbed li.fi path' }, 404);
};

const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) }));
const post = (p, body) => fetch(base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || {})
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const WALLET = '0x1111111111111111111111111111111111111111';

/* chains */
const chains = await get('/api/cross-chain/chains');
t('GET /api/cross-chain/chains answers from the provider registry', chains.status === 200 && Array.isArray(chains.body.chains));
t('...filtered to chains this wallet can actually sign for',
  chains.body.chains.some((c) => c.id === 8453) && !chains.body.chains.some((c) => c.id === 324));
t('...and Solana is offered as an SVM chain, not as an EVM one',
  chains.body.chains.find((c) => c.id === 1151111081099710)?.family === 'SVM');

/* tokens + resolution */
const tokens = await get('/api/cross-chain/tokens?chain=8453&q=usdc');
t('the token registry is searchable per chain', tokens.status === 200 && tokens.body.tokens[0].symbol === 'USDC');
const missing = await get('/api/cross-chain/resolve-token?chain=8453&token=NOPECOIN');
t('a token that does not exist on the chain is refused, not invented', missing.status === 404 && missing.body.error === 'TOKEN_NOT_ON_CHAIN');

/* quote */
const quoteRes = await get(`/api/cross-chain/quote?fromChain=8453&toChain=1&fromToken=${USDC_BASE.address}&toToken=${ETH_MAINNET.address}&fromAmount=100000000&fromAddress=${WALLET}`);
t('GET /api/cross-chain/quote returns a normalised quote', quoteRes.status === 200 && quoteRes.body.quote.schema === 'fbt.cross-chain-quote.v1');
t('...with the provider\'s output, its fees and its duration',
  quoteRes.body.quote.toAmount === '30756000000000000' && quoteRes.body.quote.estimatedTime === 45);
t('...carrying an expiry', Number(quoteRes.body.quote.expiresAt) > Date.now());
t('...and is never cached (a cached rate is a stale rate)', /no-store/.test(quoteRes.headers.get('cache-control') || ''));
t('the integrator id is attached server-side, never by the caller',
  calls.some((u) => u.includes('/v1/quote') && u.includes('integrator=fbt-swap')));

const sameChain = await get(`/api/cross-chain/quote?fromChain=1&toChain=1&fromToken=${USDC_BASE.address}&toToken=${ETH_MAINNET.address}&fromAmount=100000000&fromAddress=${WALLET}`);
t('a same-chain request is refused with a specific code', sameChain.status === 400 && sameChain.body.error === 'SAME_CHAIN');

const solanaNoDest = await get(`/api/cross-chain/quote?fromChain=8453&toChain=1151111081099710&fromToken=${USDC_BASE.address}&toToken=x&fromAmount=100000000&fromAddress=${WALLET}`);
t('EVM→Solana without a Solana address is refused', solanaNoDest.status === 400 && solanaNoDest.body.error === 'DESTINATION_REQUIRED');

const solanaEvmDest = await get(`/api/cross-chain/quote?fromChain=8453&toChain=1151111081099710&fromToken=${USDC_BASE.address}&toToken=x&fromAmount=100000000&fromAddress=${WALLET}&toAddress=${WALLET}`);
t('...and an EVM address as a Solana destination is refused by name',
  solanaEvmDest.status === 400 && solanaEvmDest.body.error === 'EVM_ADDRESS_ON_SOLANA');

/* routes */
const routesRes = await get(`/api/cross-chain/routes?fromChain=8453&toChain=1&fromToken=${USDC_BASE.address}&toToken=${ETH_MAINNET.address}&fromAmount=100000000&fromAddress=${WALLET}`);
t('GET /api/cross-chain/routes ranks every route it was given',
  routesRes.status === 200 && routesRes.body.routes.length === 2 && routesRes.body.routes[0].rank === 1);
t('...and the best is chosen by score, not by provider order',
  routesRes.body.best.tool === 'across' && routesRes.body.routes[0].tool === 'across');

/* the ledger: create → track → complete */
const created = await post('/api/cross-chain/transactions', {
  walletAddress: WALLET,
  fromChain: '8453',
  toChain: '1',
  fromToken: USDC_BASE.address,
  toToken: ETH_MAINNET.address,
  fromTokenSymbol: 'USDC',
  toTokenSymbol: 'ETH',
  fromTokenDecimals: 6,
  toTokenDecimals: 18,
  fromAmount: '100000000',
  expectedAmount: '30756000000000000',
  provider: 'lifi',
  tool: 'across',
  quoteId: quoteRes.body.quote.quoteId,
  source: 'intent-os',
  sourceTxHash: '0x' + 'a'.repeat(64),
  gasCostUsd: 0.37,
  bridgeFeeUsd: 0.59,
  protocolFeeUsd: 0.25,
  totalCostUsd: 1.21
});
t('a transfer is recorded once a real source hash exists', created.status === 201 && created.body.transaction.executionStatus === 'SUBMITTED');
const txId = created.body.transaction.id;

const pending = await get(`/api/cross-chain/transactions/${txId}/status`);
t('a pending transfer waiting on the destination is DESTINATION_PENDING',
  pending.body.transaction.executionStatus === 'DESTINATION_PENDING' && pending.body.transaction.status === 'BRIDGING');

statusPhase = 'done-no-dest';
const doneNoDest = await get(`/api/cross-chain/transactions/${txId}/status`);
t('NO FAKE SUCCESS: provider DONE with no destination hash is still not completed',
  doneNoDest.body.transaction.executionStatus === 'DESTINATION_PENDING'
  && doneNoDest.body.transaction.status !== 'COMPLETED'
  && doneNoDest.body.transaction.completedAt == null);

statusPhase = 'done';
const done = await get(`/api/cross-chain/transactions/${txId}/status`);
t('a real destination hash completes the transfer',
  done.body.transaction.executionStatus === 'COMPLETED'
  && done.body.transaction.destinationTxHash === '0x' + 'b'.repeat(64));
t('...and records what actually arrived, not what was quoted',
  done.body.transaction.actualAmount === '30700000000000000');
t('...with a completion timestamp for the history row', Number(done.body.transaction.completedAt) > 0);
t('the transition history is kept', done.body.transaction.history.length >= 2);

const late = await get(`/api/cross-chain/transactions/${txId}/status`);
t('a late poll on a terminal row is a no-op, not a downgrade', late.body.transaction.executionStatus === 'COMPLETED');

const cancelBroadcast = await post(`/api/cross-chain/transactions/${txId}/cancel`);
t('a broadcast transfer cannot be "cancelled" — the honest 409', cancelBroadcast.status === 409 && cancelBroadcast.body.error === 'ALREADY_BROADCAST');

const preSign = await post('/api/cross-chain/transactions', {
  walletAddress: WALLET, fromChain: '8453', toChain: '1', fromAmount: '1', provider: 'lifi'
});
const cancelled = await post(`/api/cross-chain/transactions/${preSign.body.transaction.id}/cancel`);
t('cancelling before broadcast is allowed and recorded as such',
  cancelled.status === 200 && cancelled.body.transaction.executionStatus === 'FAILED' && cancelled.body.transaction.cancelled === true);

/* history */
const history = await get(`/api/cross-chain/history?wallet=${WALLET}`);
t('history is per wallet and includes the completed transfer',
  history.status === 200 && history.body.transactions.some((r) => r.id === txId && r.status === 'COMPLETED'));
t('...and each row carries route, provider, both hashes, fees and timing',
  (() => {
    const row = history.body.transactions.find((r) => r.id === txId);
    return row.tool === 'across' && row.provider === 'lifi' && row.sourceTxHash && row.destinationTxHash
      && row.feesUsd.total === 1.21 && row.createdAt && row.completedAt;
  })());
t('a history request without a wallet is refused', (await get('/api/cross-chain/history')).status === 400);

/* the Intent OS endpoint that used to be a mock */
const intentQuote = await get('/api/intents/v1/bridge-quote?fromChain=8453&toChain=1&token=USDC&amount=100000000');
t('/api/intents/v1/bridge-quote now answers from the real engine',
  intentQuote.status === 200 && intentQuote.body.quote?.provider === 'lifi');
t('...and no longer returns the mock 999000 / fee 1000 shape',
  intentQuote.body.estimatedOutput === undefined && intentQuote.body.fee === undefined);
t('...resolving symbols to real contracts per chain',
  intentQuote.body.fromToken?.address === USDC_BASE.address);
t('...and refusing a symbol the destination chain does not have',
  (await get('/api/intents/v1/bridge-quote?fromChain=8453&toChain=1&token=NOPECOIN&amount=1000')).status === 404);

/* health */
const health = await get('/api/health/cross-chain');
t('GET /api/health/cross-chain reports every component',
  health.status === 200 && ['lifi', 'bridges', 'integrator', 'database', 'wallet', 'indexer']
    .every((c) => health.body.components.some((x) => x.component === c)));
t('...including whether history is actually durable',
  health.body.components.find((c) => c.component === 'database')?.durable === false);

/* provider down: an error, never a rate */
providerDown = true;
const downQuote = await get(`/api/cross-chain/quote?fromChain=8453&toChain=1&fromToken=${USDC_BASE.address}&toToken=${ETH_MAINNET.address}&fromAmount=100000000&fromAddress=${WALLET}`);
t('with the provider down a quote is an ERROR, never an invented number',
  downQuote.status >= 400 && downQuote.body.quote === undefined);
const { _resetLifiCache } = await import('../server/lifi.js');
_resetLifiCache();
const downHealth = await get('/api/health/cross-chain');
t('...and health says degraded with 503 so the UI can hide rates',
  downHealth.status === 503 && downHealth.body.degraded === true);
providerDown = false;
_resetLifiCache();

server.close();
globalThis.fetch = realFetch;

/* ════════════════════════════════════════════════════════════════════════ */
/* 3. wiring: one engine, two screens, no second path                       */
/* ════════════════════════════════════════════════════════════════════════ */

const bridgePage = read('src/pages/Bridge.jsx');
const intentPanel = read('src/components/IntentCrossChainPanel.jsx');
const desk = read('src/components/crosschain/CrossChainDesk.jsx');
const client = read('src/services/cross-chain/client.js');
const serverEngine = read('server/crossChain.js');
const serverBridge = read('server/bridge.js');
const intentAdapter = read('server/intentBridgeQuote.js');
/* Comments quote the mock they replaced; only executable code is asserted on. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const store = read('server/crossChainStore.js');
const appSrc = read('server/app.js');

t('the bridge page quotes through the shared service', /crossChainService\.getQuote\s*\(/.test(bridgePage));
t('...ranks routes through it as well', /crossChainService\.getRoutes\s*\(/.test(bridgePage));
t('...executes through the shared pipeline', /crossChainService\.execute\s*\(/.test(bridgePage));
t('...and tracks the destination instead of stopping at the source hash',
  /crossChainService\.trackTransaction\s*\(/.test(bridgePage) && /CrossChainStatus/.test(bridgePage));
t('...and renders the shared history', /CrossChainHistory/.test(bridgePage));

t('the Intent OS cross-chain tab renders the shared desk', /<CrossChainDesk/.test(intentPanel));
t('the desk uses the shared service for quotes, routes and execution',
  /crossChainService\.getRoutes/.test(desk) && /crossChainService\.getQuote/.test(desk) && /crossChainService\.execute/.test(desk));
t('the desk refuses to show a rate while the provider is down', /providerDown/.test(desk));
t('the desk re-quotes when the wallet switches network', /wallet\.chainId/.test(desk) && /runQuote\(\{ silent: true \}\)/.test(desk));
t('the desk asks for a Solana address when the destination is Solana', /isSolanaChain\(toChain\)/.test(desk));

t('the execution pipeline validates the allowance before signing', /allowance\(/.test(client) && /approve\(/.test(client));
t('...approves the exact amount, never infinite', /approve\(spender, need\)/.test(client) && !/MaxUint256/.test(client));
t('...validates the balance first', /INSUFFICIENT_BALANCE/.test(client));
t('...refuses to sign on the wrong network', /WRONG_NETWORK/.test(client));
t('...re-quotes immediately before signing', /QUOTE_CHANGED/.test(client) && /getQuote\(/.test(client));
t('...and reports a user rejection as such', /USER_REJECTED/.test(client));

t('there is exactly ONE LI.FI client in the server',
  /li\.quest/.test(read('server/lifi.js'))
  && !/li\.quest\/v1'/.test(serverEngine)
  && !/const LIFI_BASE/.test(serverBridge));
t('the legacy bridge route delegates instead of duplicating the client', /from '\.\/lifi\.js'/.test(serverBridge));
t('the intent adapter no longer carries a hard-coded rate',
  !/estimatedOutput/.test(stripComments(intentAdapter)) && !/999000/.test(stripComments(intentAdapter)));
t('...and calls the real engine', /from '\.\/crossChain\.js'/.test(intentAdapter));

t('the store enforces the state machine rather than trusting the client',
  /canTransition/.test(store) && /guardCompletion/.test(store));
t('the four collections the spec names exist',
  ['cross_chain_transactions', 'cross_chain_quotes', 'cross_chain_routes', 'cross_chain_intents']
    .every((c) => store.includes(c)));

t('the server exposes the shared cross-chain surface',
  ['/api/cross-chain/chains', '/api/cross-chain/quote', '/api/cross-chain/routes',
    '/api/cross-chain/history', '/api/health/cross-chain'].every((r) => appSrc.includes(r)));

/* preimage: never leaves the device */
t('the HTLC preimage is never sent to the server',
  !/preimageHex/.test(intentPanel.split('planAtomicSwap')[1] || '')
  || !/body[^\n]*preimage/i.test(intentPanel));
t('...and is never logged or put in an error path',
  !/console\.(log|warn|error)[^\n]*preimage/i.test(intentPanel));
t('...only its keccak256 hashlock is shared', /keccak256\(preimage\)/.test(intentPanel) && /hashlock/.test(intentPanel));

/* the HTLC section stays honestly gated */
t('the HTLC section is gated on a computed checklist, not a constant',
  /htlcChecks/.test(intentPanel) && /htlcActive = htlcChecks\.every/.test(intentPanel));
t('...and says "not available" when any item fails', /htlcComingSoon/.test(intentPanel));

/* the chain list the wallet can sign for stays in step with the app's own */
const chainsLib = read('src/lib/chains.js');
const evmOrder = /EVM_CHAIN_ORDER = \[([^\]]+)\]/.exec(chainsLib)?.[1]?.split(',').map((x) => Number(x.trim())) || [];
const walletSupported = /WALLET_SUPPORTED_CHAIN_IDS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(serverEngine)?.[1] || '';
t('every EVM chain the app supports is offered cross-chain',
  evmOrder.length > 0 && evmOrder.every((id) => new RegExp(`\\b${id}\\b`).test(walletSupported)));

/* ── report ─────────────────────────────────────────────────────────────── */

/*
 * Under `npm test` the runner prints these rows itself (see test/run.mjs);
 * run directly (`node test/cross-chain-probe.mjs`) the probe reports its own
 * result so it stays usable on its own during development.
 */
export default rows;

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  let failed = 0;
  console.log('\nCROSS-CHAIN PROBE');
  for (const [name, ok] of rows) {
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  console.log(failed ? `\n${failed} FAILED\n` : `\nAll ${rows.length} cross-chain checks passed.\n`);
  if (failed) process.exitCode = 1;
}
