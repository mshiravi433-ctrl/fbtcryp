#!/usr/bin/env node
/**
 * DRAFT → TRANSACTION BRIDGE PROBE
 *
 * The bridge is the only module in src/lib/intent-ai/ that can turn economic
 * intent into something a chain will accept, so every refusal path matters
 * more than the happy path. These checks exist to prove that a missing,
 * malformed or unaffordable input STOPS rather than being guessed.
 */

import {
  DRAFT_BRIDGE_SCHEMA,
  resolveDraftToken,
  amountToBaseUnits,
  usdToTokenAmount,
  prepareDraftTransaction,
  broadcastEnabled,
  assertBroadcastAllowed
} from '../../src/lib/intent-ai/index.js';
import { CAUSE_CODES } from '../../src/lib/intent-ai/failureModes.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

/* A deterministic stand-in for getToken() from src/lib/chains.js. */
const TOKENS = {
  42161: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'ETH', address: null, decimals: 18, native: true },
    { symbol: 'BADDEC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5832' },
    { symbol: 'BADADDR', address: '0xnothex', decimals: 18 }
  ]
};
const tokenSource = (chainId, symbol) => (TOKENS[chainId] || []).find((t) => t.symbol === symbol);

const ADDR = '0x1111111111111111111111111111111111111111';

try {
  /* ---------------------------------------------------------------- schema */
  check('module publishes a versioned schema', DRAFT_BRIDGE_SCHEMA === 'fbt.draft-transaction-bridge.v1');

  /* -------------------------------------------------------- token resolver */
  const usdc = resolveDraftToken({ chainId: 42161, symbol: 'USDC', tokenSource });
  check('a known symbol resolves to its real address', usdc.ok && usdc.token.address === '0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
  check('the resolver carries the true decimals, not an assumed 18', usdc.ok && usdc.token.decimals === 6);
  check('the resolved token is frozen', usdc.ok && Object.isFrozen(usdc.token));

  const native = resolveDraftToken({ chainId: 42161, symbol: 'ETH', tokenSource });
  check('a native asset resolves with an explicit native flag', native.ok && native.token.native === true && native.token.address === null);

  const unknown = resolveDraftToken({ chainId: 42161, symbol: 'NOSUCH', tokenSource });
  check('an unknown symbol is MISSING_DATA, never a guessed address', !unknown.ok && unknown.error.code === 'MISSING_DATA');

  const noDec = resolveDraftToken({ chainId: 42161, symbol: 'BADDEC', tokenSource });
  check('a token without decimals is refused rather than defaulted to 18', !noDec.ok && noDec.error.code === 'MISSING_DATA');

  const badAddr = resolveDraftToken({ chainId: 42161, symbol: 'BADADDR', tokenSource });
  check('a malformed address is refused', !badAddr.ok && badAddr.error.code === 'MISSING_DATA');

  check('a missing chain id is refused', !resolveDraftToken({ symbol: 'USDC', tokenSource }).ok);
  check('a missing token source is refused', !resolveDraftToken({ chainId: 42161, symbol: 'USDC' }).ok);
  check('a throwing token source becomes PROVIDER_ERROR', resolveDraftToken({
    chainId: 42161, symbol: 'USDC', tokenSource: () => { throw new Error('boom'); }
  }).error.code === 'PROVIDER_ERROR');

  /* Number(null)===0 and Number('')===0 — the classic silent-zero trap. */
  check('null chain id does not read as chain 0', !resolveDraftToken({ chainId: null, symbol: 'USDC', tokenSource }).ok);
  check('empty-string chain id does not read as chain 0', !resolveDraftToken({ chainId: '', symbol: 'USDC', tokenSource }).ok);
  check('boolean chain id is refused', !resolveDraftToken({ chainId: true, symbol: 'USDC', tokenSource }).ok);

  /* ------------------------------------------------------ base-unit maths */
  const six = amountToBaseUnits({ amount: '100', decimals: 6 });
  check('100 USDC becomes 100000000 base units', six.ok && six.baseUnits === '100000000');

  const eighteen = amountToBaseUnits({ amount: '1.5', decimals: 18 });
  check('1.5 at 18 decimals is exact', eighteen.ok && eighteen.baseUnits === '1500000000000000000');

  const tiny = amountToBaseUnits({ amount: '0.000001', decimals: 6 });
  check('the smallest representable unit survives', tiny.ok && tiny.baseUnits === '1');

  const big = amountToBaseUnits({ amount: '123456789.123456789012345678', decimals: 18 });
  check('a value beyond float precision stays exact', big.ok && big.baseUnits === '123456789123456789012345678');

  check('precision finer than the token is refused, never truncated', !amountToBaseUnits({ amount: '1.0000001', decimals: 6 }).ok);
  check('zero is refused', !amountToBaseUnits({ amount: '0', decimals: 6 }).ok);
  check('a negative amount is refused', !amountToBaseUnits({ amount: '-5', decimals: 6 }).ok);
  check('null is not zero', !amountToBaseUnits({ amount: null, decimals: 6 }).ok);
  check('empty string is not zero', !amountToBaseUnits({ amount: '', decimals: 6 }).ok);
  check('true is not one', !amountToBaseUnits({ amount: true, decimals: 6 }).ok);
  check('a bare dot is refused', !amountToBaseUnits({ amount: '.', decimals: 6 }).ok);
  check('letters are refused', !amountToBaseUnits({ amount: '10abc', decimals: 6 }).ok);
  check('fractional decimals are refused', !amountToBaseUnits({ amount: '1', decimals: 6.5 }).ok);
  check('missing decimals are refused', !amountToBaseUnits({ amount: '1' }).ok);

  /* --------------------------------------------------------- USD → amount */
  const conv = usdToTokenAmount({ amountUsd: 100, unitPriceUsd: 2000 });
  check('100 USD at 2000/unit is 0.05', conv.ok && Math.abs(conv.amount - 0.05) < 1e-12);
  check('a USD figure without a price is refused, never priced by guess', !usdToTokenAmount({ amountUsd: 100 }).ok);
  check('a zero price is refused rather than dividing by zero', !usdToTokenAmount({ amountUsd: 100, unitPriceUsd: 0 }).ok);
  check('a null price is not a zero price', !usdToTokenAmount({ amountUsd: 100, unitPriceUsd: null }).ok);

  /* ------------------------------------------------- full preparation path */
  const goodQuote = async () => ({ source: 'aggregator', routeSummary: { extraFee: null }, expiresAt: Date.now() + 60_000 });
  const goodBuilder = async () => ({ ok: true, request: { schema: 'fbt.intent-transaction.v1', to: ADDR, data: '0xabcd', value: '0' } });

  const draft = { chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: 100, slippagePct: 0.5 };

  const prepared = await prepareDraftTransaction({
    draft, account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder
  });
  check('a complete draft prepares a real request', prepared.ok && prepared.request.data === '0xabcd');
  check('the prepared amount is in base units', prepared.ok && prepared.amountBaseUnits === '100000000');
  check('preparing does NOT broadcast', prepared.ok && prepared.broadcast === false && prepared.txHash === null);

  const noWallet = await prepareDraftTransaction({
    draft, account: null, tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder
  });
  check('no connected wallet stops with USER_AUTHORIZATION_REQUIRED', !noWallet.ok && noWallet.error.code === 'USER_AUTHORIZATION_REQUIRED');

  const badAccount = await prepareDraftTransaction({
    draft, account: '0x123', tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder
  });
  check('a malformed account is refused', !badAccount.ok);

  const noQuote = await prepareDraftTransaction({
    draft, account: ADDR, tokenSource, quoteSource: async () => null, requestBuilder: goodBuilder
  });
  check('a missing quote is SIMULATION_UNAVAILABLE, never an executed hope', !noQuote.ok && noQuote.error.code === 'SIMULATION_UNAVAILABLE');

  const erroredQuote = await prepareDraftTransaction({
    draft, account: ADDR, tokenSource, quoteSource: async () => ({ error: 'NO_ROUTE' }), requestBuilder: goodBuilder
  });
  check('an errored quote is refused', !erroredQuote.ok && erroredQuote.error.code === 'SIMULATION_UNAVAILABLE');

  const throwingQuote = await prepareDraftTransaction({
    draft, account: ADDR, tokenSource, quoteSource: async () => { throw new Error('rpc down'); }, requestBuilder: goodBuilder
  });
  check('a throwing quote source becomes PROVIDER_ERROR', !throwingQuote.ok && throwingQuote.error.code === 'PROVIDER_ERROR');

  const expired = await prepareDraftTransaction({
    draft, account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: async () => ({ ok: false, code: 'QUOTE_EXPIRED' })
  });
  check('an expired quote maps to DEADLINE_PASSED', !expired.ok && expired.error.code === 'DEADLINE_PASSED');

  const feeMismatch = await prepareDraftTransaction({
    draft, account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: async () => ({ ok: false, code: 'FEE_MISMATCH' })
  });
  check('a fee mismatch maps to TERMS_CHANGED', !feeMismatch.ok && feeMismatch.error.code === 'TERMS_CHANGED');

  const overFee = await prepareDraftTransaction({
    draft, account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder, expectFeeBps: 5000
  });
  check('a fee above the product ceiling is TERMS_CHANGED', !overFee.ok && overFee.error.code === 'TERMS_CHANGED');

  const noSlippage = await prepareDraftTransaction({
    draft: { chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: 100 },
    account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder
  });
  check('a missing slippage limit is refused rather than defaulted', !noSlippage.ok && noSlippage.error.code === 'MISSING_DATA');

  const sameToken = await prepareDraftTransaction({
    draft: { chainId: 42161, fromSymbol: 'USDC', toSymbol: 'USDC', amountIn: 100, slippagePct: 0.5 },
    account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder
  });
  check('a swap into the same token is refused', !sameToken.ok);

  const usdDraft = { chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountUsd: 100, slippagePct: 0.5 };
  const noPrice = await prepareDraftTransaction({
    draft: usdDraft, account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder
  });
  check('a USD-denominated draft without a price is refused', !noPrice.ok && noPrice.error.code === 'MISSING_DATA');

  const withPrice = await prepareDraftTransaction({
    draft: usdDraft, account: ADDR, tokenSource, quoteSource: goodQuote, requestBuilder: goodBuilder, unitPriceUsd: 1
  });
  check('a USD draft with an explicit price prepares', withPrice.ok && withPrice.amountBaseUnits === '100000000');

  /* ------------------------------------------------------- broadcast gate */
  check('broadcasting is OFF by default', broadcastEnabled({}) === false);
  check('an unrelated value does not enable broadcasting', broadcastEnabled({ VITE_INTENT_BROADCAST_ENABLED: '1' }) === false);
  check('only the exact string "true" enables broadcasting', broadcastEnabled({ VITE_INTENT_BROADCAST_ENABLED: 'true' }) === true);

  check('a disabled build refuses to broadcast even with opt-in',
    assertBroadcastAllowed({ env: {}, userOptIn: true }).ok === false);
  check('an enabled build still refuses without an explicit opt-in',
    assertBroadcastAllowed({ env: { VITE_INTENT_BROADCAST_ENABLED: 'true' }, userOptIn: false }).ok === false);
  check('a truthy non-true opt-in is not an opt-in',
    assertBroadcastAllowed({ env: { VITE_INTENT_BROADCAST_ENABLED: 'true' }, userOptIn: 'yes' }).ok === false);
  check('both flag and opt-in together are allowed',
    assertBroadcastAllowed({ env: { VITE_INTENT_BROADCAST_ENABLED: 'true' }, userOptIn: true }).ok === true);

  /* --------------------------------------------- closed cause-code set */
  const emitted = [
    unknown.error.code, noDec.error.code, badAddr.error.code, noWallet.error.code,
    noQuote.error.code, throwingQuote.error.code, expired.error.code,
    feeMismatch.error.code, overFee.error.code, noSlippage.error.code
  ];
  const knownCodes = Object.keys(CAUSE_CODES);
  check('every emitted code belongs to the closed set', emitted.every((c) => knownCodes.includes(c)));
  check('the bridge invents no new cause code', new Set(emitted).size <= knownCodes.length);

  console.log(JSON.stringify({ probe: 'draft-transaction-bridge', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
