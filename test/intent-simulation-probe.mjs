/**
 * EXACT RPC PREFLIGHT SIMULATION PROBE
 * ---------------------------------------------------------------------------
 * Drives src/lib/intentSimulation.js against a mock provider so every branch
 * of a real preflight is exercised without a network:
 *
 *   passed · approval-required · insufficient-balance · chain-mismatch ·
 *   account-mismatch · reverted (Error(string), Panic, custom error) ·
 *   rpc-unavailable (timeout on call, refusal on estimateGas) · quote-expired
 *
 * Two invariants matter more than the individual cases:
 *   1. NO sendTransaction is ever reachable from the simulation path.
 *   2. A simulation is bound to the exact route+quote fingerprints and goes
 *      stale the moment either changes.
 */

const REQUEST = Object.freeze({
  schema: 'fbt.intent-transaction.v1',
  chainId: 42161,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  data: '0xabcdef',
  value: '0',
  deadline: Math.floor(Date.now() / 1000) + 600,
  routeFingerprint: 'route-aaa',
  quoteFingerprint: 'quote-bbb',
  spender: '0x2222222222222222222222222222222222222222',
  amountInWei: '1000000',
  minOutWei: '990000',
  minOutEncodedInCalldata: false,
  builtAt: Date.now(),
  expiresAt: Date.now() + 45_000
});

/** A provider that records every method that was called on it. */
function mockProvider({
  chainId = 42161,
  balance = 10n ** 18n,
  callImpl = async () => '0x',
  estimateImpl = async () => 210_000n,
  blockNumber = 250_000_000
} = {}) {
  const calls = [];
  return {
    calls,
    async getNetwork() { calls.push('getNetwork'); return { chainId: BigInt(chainId) }; },
    async getBalance() { calls.push('getBalance'); return balance; },
    async call(tx) { calls.push('call'); return callImpl(tx); },
    async estimateGas(tx) { calls.push('estimateGas'); return estimateImpl(tx); },
    async getBlockNumber() { calls.push('getBlockNumber'); return blockNumber; },
    /* Deliberately present so the probe can prove it is NEVER touched. */
    async sendTransaction() { calls.push('sendTransaction'); throw new Error('SIMULATION_MUST_NOT_SEND'); },
    async broadcastTransaction() { calls.push('broadcastTransaction'); throw new Error('SIMULATION_MUST_NOT_SEND'); }
  };
}

const erc20 = ({ balance = 10n ** 9n, allowance = 10n ** 9n } = {}) => ({
  balanceOf: async () => balance,
  allowance: async () => allowance
});

const rpcError = (message = 'timeout of 5000ms exceeded') => {
  const err = new Error(message);
  err.code = 'TIMEOUT';
  return err;
};

const revertError = (data) => {
  const err = new Error('execution reverted');
  err.code = 'CALL_EXCEPTION';
  err.data = data;
  return err;
};

/** ABI-encode Error(string) the way a node returns it. */
function encodeErrorString(reason) {
  const hex = [...reason].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return '0x08c379a0'
    + '0000000000000000000000000000000000000000000000000000000000000020'
    + reason.length.toString(16).padStart(64, '0')
    + padded;
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const sim = await import('../src/lib/intentSimulation.js');
  const now = Date.now();

  t('schema is fbt.intent-simulation.v1', sim.INTENT_SIMULATION_SCHEMA === 'fbt.intent-simulation.v1');
  t('mode is exact-rpc-preflight', sim.SIMULATION_MODE === 'exact-rpc-preflight');

  /* ------------------------------- passed --------------------------------- */
  const okProvider = mockProvider();
  const passed = await sim.simulateIntentTransaction({
    provider: okProvider,
    request: REQUEST,
    erc20: erc20(),
    account: REQUEST.from,
    chainId: 42161,
    intentId: 'in_sim_1',
    now
  });
  t('a clean preflight passes', passed.status === 'passed');
  t('eth_call was actually executed', okProvider.calls.includes('call'));
  t('estimateGas was actually executed', okProvider.calls.includes('estimateGas'));
  t('the gas estimate is reported', passed.gasEstimate === '210000');
  t('the block number is reported', passed.blockNumber === 250_000_000);
  t('the result is bound to the route fingerprint', passed.routeFingerprint === 'route-aaa');
  t('the result is bound to the quote fingerprint', passed.quoteFingerprint === 'quote-bbb');
  t('exactTransactionSimulated is claimed only after a real call',
    passed.claims.exactTransactionSimulated === true);
  t('stateDiffAvailable stays false', passed.claims.stateDiffAvailable === false);
  t('outputGuaranteeProven stays false', passed.claims.outputGuaranteeProven === false);
  t('privateRelayAttested stays false', passed.claims.privateRelayAttested === false);
  t('NO transaction was sent during simulation',
    !okProvider.calls.includes('sendTransaction') && !okProvider.calls.includes('broadcastTransaction'));

  /* --------------------------- approval required --------------------------- */
  const approval = await sim.simulateIntentTransaction({
    provider: mockProvider(),
    request: REQUEST,
    erc20: erc20({ allowance: 0n }),
    account: REQUEST.from,
    now
  });
  t('a missing allowance yields approval-required', approval.status === 'approval-required');
  t('approval-required is not a pass', approval.status !== 'passed');
  t('the allowance shortfall is reported', approval.evidence.requiredWei === '1000000');

  /* ---------------------------- balance shortfall -------------------------- */
  const poor = await sim.simulateIntentTransaction({
    provider: mockProvider(),
    request: REQUEST,
    erc20: erc20({ balance: 1n }),
    account: REQUEST.from,
    now
  });
  t('an insufficient token balance is reported', poor.status === 'insufficient-balance');

  const poorNative = await sim.simulateIntentTransaction({
    provider: mockProvider({ balance: 5n }),
    request: { ...REQUEST, value: '1000000000000000000' },
    account: REQUEST.from,
    now
  });
  t('an insufficient native balance is reported', poorNative.status === 'insufficient-balance');

  /* ------------------------------- mismatches ------------------------------ */
  const wrongChain = await sim.simulateIntentTransaction({
    provider: mockProvider({ chainId: 8453 }),
    request: REQUEST,
    account: REQUEST.from,
    now
  });
  t('a chain mismatch is caught', wrongChain.status === 'chain-mismatch');

  const wrongAccount = await sim.simulateIntentTransaction({
    provider: mockProvider(),
    request: REQUEST,
    account: '0x9999999999999999999999999999999999999999',
    now
  });
  t('an account mismatch is caught', wrongAccount.status === 'account-mismatch');

  /* --------------------------------- reverts ------------------------------- */
  const revertReason = await sim.simulateIntentTransaction({
    provider: mockProvider({
      callImpl: async () => { throw revertError(encodeErrorString('INSUFFICIENT_OUTPUT_AMOUNT')); }
    }),
    request: REQUEST,
    account: REQUEST.from,
    now
  });
  t('a revert with a reason string is decoded',
    revertReason.status === 'reverted' && revertReason.revertCode === 'REVERT:INSUFFICIENT_OUTPUT_AMOUNT');

  const customError = await sim.simulateIntentTransaction({
    provider: mockProvider({ callImpl: async () => { throw revertError('0xdeadbeef'); } }),
    request: REQUEST,
    account: REQUEST.from,
    now
  });
  t('a custom error selector is reported verbatim',
    customError.status === 'reverted' && customError.revertCode === 'CUSTOM:0xdeadbeef');

  const panic = await sim.simulateIntentTransaction({
    provider: mockProvider({
      callImpl: async () => {
        throw revertError('0x4e487b71' + '11'.padStart(64, '0'));
      }
    }),
    request: REQUEST,
    account: REQUEST.from,
    now
  });
  t('a panic code is decoded', panic.status === 'reverted' && panic.revertCode.startsWith('PANIC:'));

  const revertOnEstimate = await sim.simulateIntentTransaction({
    provider: mockProvider({
      estimateImpl: async () => { throw revertError(encodeErrorString('EXPIRED')); }
    }),
    request: REQUEST,
    account: REQUEST.from,
    now
  });
  t('a revert during estimateGas is still a revert, not a pass',
    revertOnEstimate.status === 'reverted' && revertOnEstimate.revertCode === 'REVERT:EXPIRED');

  /* ------------------------------ rpc failures ----------------------------- */
  const timeout = await sim.simulateIntentTransaction({
    provider: mockProvider({ callImpl: async () => { throw rpcError(); } }),
    request: REQUEST,
    account: REQUEST.from,
    now
  });
  t('an RPC timeout is rpc-unavailable', timeout.status === 'rpc-unavailable');
  t('an RPC failure never becomes passed', timeout.status !== 'passed');
  t('an RPC failure claims no exact simulation', timeout.claims.exactTransactionSimulated === false);

  const estimateRefused = await sim.simulateIntentTransaction({
    provider: mockProvider({
      estimateImpl: async () => { throw rpcError('the method eth_estimateGas is not supported'); }
    }),
    request: REQUEST,
    account: REQUEST.from,
    now
  });
  t('a provider that refuses estimateGas is rpc-unavailable, not passed',
    estimateRefused.status === 'rpc-unavailable' && estimateRefused.revertCode === 'ESTIMATE_UNAVAILABLE');

  const noProvider = await sim.simulateIntentTransaction({ provider: null, request: REQUEST, now });
  t('a missing provider is rpc-unavailable', noProvider.status === 'rpc-unavailable');

  /* -------------------------------- expiry --------------------------------- */
  const expired = await sim.simulateIntentTransaction({
    provider: mockProvider(),
    request: { ...REQUEST, expiresAt: now - 1 },
    account: REQUEST.from,
    now
  });
  t('an expired build is quote-expired', expired.status === 'quote-expired');
  const deadlinePassed = await sim.simulateIntentTransaction({
    provider: mockProvider(),
    request: { ...REQUEST, deadline: Math.floor(now / 1000) - 5 },
    account: REQUEST.from,
    now
  });
  t('a passed deadline is quote-expired', deadlinePassed.status === 'quote-expired');

  /* --------------------------- fingerprint binding -------------------------- */
  t('a simulation matches its own request', sim.simulationMatches(passed, REQUEST));
  t('a simulation does not match a changed route',
    !sim.simulationMatches(passed, { ...REQUEST, routeFingerprint: 'route-zzz' }));
  t('a simulation does not match a changed quote',
    !sim.simulationMatches(passed, { ...REQUEST, quoteFingerprint: 'quote-zzz' }));
  t('a simulation is fresh right after it runs',
    sim.simulationIsFresh(passed, REQUEST, { now: passed.simulatedAt + 1000 }));
  t('a simulation goes stale with age',
    !sim.simulationIsFresh(passed, REQUEST, { now: passed.simulatedAt + 120_000 }));
  t('a simulation is stale after a route change',
    !sim.simulationIsFresh(passed, { ...REQUEST, routeFingerprint: 'route-new' }, { now: passed.simulatedAt + 10 }));

  /* ------------------------- decoding helpers, directly --------------------- */
  t('decodeRevert handles Error(string)',
    sim.decodeRevert(encodeErrorString('TOO_LITTLE_RECEIVED')) === 'REVERT:TOO_LITTLE_RECEIVED');
  t('decodeRevert handles an unknown selector', sim.decodeRevert('0x12345678') === 'CUSTOM:0x12345678');
  t('decodeRevert ignores junk', sim.decodeRevert('nope') === null);
  t('isRpcFailure separates transport from revert',
    sim.isRpcFailure(rpcError()) === true && sim.isRpcFailure(revertError('0xdeadbeef')) === false);

  /* ------------------------- experimental override label -------------------- */
  const experimental = await sim.simulateIntentTransaction({
    provider: mockProvider(),
    request: REQUEST,
    account: REQUEST.from,
    now,
    experimentalStateOverride: true
  });
  t('a state-override run is labelled unsupported-experimental',
    experimental.mode === 'unsupported-experimental-state-override');
  t('the production mode label is used by default', passed.mode === 'exact-rpc-preflight');

  /* -------------------------- summary is privacy-safe ----------------------- */
  const summary = sim.simulationSummary(passed);
  const summaryText = JSON.stringify(summary);
  t('the summary carries no calldata', !summaryText.includes('0xabcdef'));
  t('the summary carries no address', !/0x[0-9a-fA-F]{40}/.test(summaryText));

  /* ----------------------- the send path is a separate module --------------- */
  const tx = await import('../src/lib/intentTransaction.js');
  const sendWithoutSim = await tx.sendIntentTransaction({
    signer: { sendTransaction: async () => { throw new Error('MUST_NOT_BE_CALLED'); } },
    request: REQUEST,
    simulation: null
  });
  t('sending without a simulation is refused', !sendWithoutSim.ok && sendWithoutSim.code === 'SIMULATION_REQUIRED');
  const sendWithStale = await tx.sendIntentTransaction({
    signer: { sendTransaction: async () => { throw new Error('MUST_NOT_BE_CALLED'); } },
    request: REQUEST,
    simulation: { ...passed, routeFingerprint: 'route-other' }
  });
  t('sending with a stale simulation is refused', !sendWithStale.ok && sendWithStale.code === 'SIMULATION_STALE');
  const sendWithFailed = await tx.sendIntentTransaction({
    signer: { sendTransaction: async () => { throw new Error('MUST_NOT_BE_CALLED'); } },
    request: REQUEST,
    simulation: timeout
  });
  t('sending after an rpc-unavailable simulation is refused', !sendWithFailed.ok);

  let sent = null;
  const sendOk = await tx.sendIntentTransaction({
    signer: { sendTransaction: async (payload) => { sent = payload; return { hash: '0x' + 'ab'.repeat(32), wait: async () => ({ status: 1 }) }; } },
    request: REQUEST,
    simulation: passed,
    account: REQUEST.from,
    chainId: 42161
  });
  t('a passed simulation permits exactly one send', sendOk.ok && sendOk.code === 'SUBMITTED');
  t('the sent bytes are the simulated bytes', sent?.to === REQUEST.to && sent?.data === REQUEST.data);
  const sendWrongAccount = await tx.sendIntentTransaction({
    signer: { sendTransaction: async () => { throw new Error('MUST_NOT_BE_CALLED'); } },
    request: REQUEST,
    simulation: passed,
    account: '0x9999999999999999999999999999999999999999'
  });
  t('a switched account blocks the send', !sendWrongAccount.ok && sendWrongAccount.code === 'ACCOUNT_CHANGED');
  const sendWrongChain = await tx.sendIntentTransaction({
    signer: { sendTransaction: async () => { throw new Error('MUST_NOT_BE_CALLED'); } },
    request: REQUEST,
    simulation: passed,
    chainId: 8453
  });
  t('a switched chain blocks the send', !sendWrongChain.ok && sendWrongChain.code === 'CHAIN_CHANGED');
  const sendExpired = await tx.sendIntentTransaction({
    signer: { sendTransaction: async () => { throw new Error('MUST_NOT_BE_CALLED'); } },
    request: { ...REQUEST, expiresAt: now - 1 },
    simulation: passed
  });
  t('an expired request blocks the send', !sendExpired.ok && sendExpired.code === 'QUOTE_EXPIRED');

  /* --------------------- exact builder: fee and fingerprints ---------------- */
  const builders = {
    buildAggregatorTx: async () => ({
      calldata: '0x' + 'ee'.repeat(20),
      routerAddress: '0x2222222222222222222222222222222222222222',
      amountOutWei: 1_000_000n,
      minAmountOutWei: 990_000n,
      gasLimit: 200_000n,
      value: 0n
    }),
    buildOpenOceanSwap: async () => ({ to: '0x3333333333333333333333333333333333333333', data: '0x1234', value: 0n, minOutWei: 990_000n, amountOutWei: 1_000_000n }),
    verifyOpenOceanFee: async () => true
  };
  const quote = {
    source: 'aggregator',
    routeSummary: { extraFee: { feeAmount: '70', feeReceiver: '0x4444444444444444444444444444444444444444' } },
    routerAddress: '0x2222222222222222222222222222222222222222',
    amountInWei: 1_000_000n,
    amountOutWei: 1_000_000n,
    minOutWei: 990_000n,
    feeBps: 70,
    slippage: 0.5
  };
  const built = await tx.buildIntentTransactionRequest({
    chainId: 42161,
    account: REQUEST.from,
    quote,
    fromToken: { symbol: 'USDC', address: '0x5555555555555555555555555555555555555555', decimals: 6 },
    toToken: { symbol: 'ETH', native: true, decimals: 18 },
    slippage: 0.5,
    expectFeeBps: 70,
    expectFeeReceiver: '0x4444444444444444444444444444444444444444',
    builders
  });
  t('the exact builder returns a request without sending', built.ok && built.request.schema === 'fbt.intent-transaction.v1');
  t('the request carries both fingerprints',
    Boolean(built.request.routeFingerprint) && Boolean(built.request.quoteFingerprint));

  const wrongFee = await tx.buildIntentTransactionRequest({
    chainId: 42161,
    account: REQUEST.from,
    quote: { ...quote, routeSummary: { extraFee: { feeAmount: '0', feeReceiver: '0x4444444444444444444444444444444444444444' } } },
    fromToken: { symbol: 'USDC', address: '0x5555555555555555555555555555555555555555', decimals: 6 },
    toToken: { symbol: 'ETH', native: true, decimals: 18 },
    expectFeeBps: 70,
    expectFeeReceiver: '0x4444444444444444444444444444444444444444',
    builders
  });
  t('a route that drops our fee is refused before signing', !wrongFee.ok && wrongFee.code === 'FEE_NOT_APPLIED');

  const wrongReceiver = await tx.buildIntentTransactionRequest({
    chainId: 42161,
    account: REQUEST.from,
    quote: { ...quote, routeSummary: { extraFee: { feeAmount: '70', feeReceiver: '0x8888888888888888888888888888888888888888' } } },
    fromToken: { symbol: 'USDC', address: '0x5555555555555555555555555555555555555555', decimals: 6 },
    toToken: { symbol: 'ETH', native: true, decimals: 18 },
    expectFeeBps: 70,
    expectFeeReceiver: '0x4444444444444444444444444444444444444444',
    builders
  });
  t('a redirected fee receiver is refused', !wrongReceiver.ok && wrongReceiver.code === 'FEE_RECIPIENT_MISMATCH');

  const worseMin = await tx.buildIntentTransactionRequest({
    chainId: 42161,
    account: REQUEST.from,
    quote,
    fromToken: { symbol: 'USDC', address: '0x5555555555555555555555555555555555555555', decimals: 6 },
    toToken: { symbol: 'ETH', native: true, decimals: 18 },
    expectFeeBps: 70,
    expectFeeReceiver: '0x4444444444444444444444444444444444444444',
    builders: { ...builders, buildAggregatorTx: async () => ({
      calldata: '0x' + 'ee'.repeat(20),
      routerAddress: '0x2222222222222222222222222222222222222222',
      amountOutWei: 1_000_000n,
      minAmountOutWei: 500_000n,
      value: 0n
    }) }
  });
  t('a rebuilt route with a worse minimum output is refused',
    !worseMin.ok && worseMin.code === 'MIN_OUTPUT_REGRESSED');

  const otherRouter = await tx.buildIntentTransactionRequest({
    chainId: 42161,
    account: REQUEST.from,
    quote,
    fromToken: { symbol: 'USDC', address: '0x5555555555555555555555555555555555555555', decimals: 6 },
    toToken: { symbol: 'ETH', native: true, decimals: 18 },
    expectFeeBps: 70,
    expectFeeReceiver: '0x4444444444444444444444444444444444444444',
    builders: { ...builders, buildAggregatorTx: async () => ({
      calldata: '0x' + 'ee'.repeat(20),
      routerAddress: '0x7777777777777777777777777777777777777777',
      amountOutWei: 1_000_000n,
      minAmountOutWei: 990_000n,
      value: 0n
    }) }
  });
  t('a build that swaps the router address is refused', !otherRouter.ok && otherRouter.code === 'ROUTER_MISMATCH');

  const unsupported = await tx.buildIntentTransactionRequest({
    chainId: 42161,
    account: REQUEST.from,
    quote: { ...quote, source: 'direct-router' },
    fromToken: { symbol: 'USDC', decimals: 6 },
    toToken: { symbol: 'ETH', native: true, decimals: 18 },
    builders
  });
  t('an unsupported adapter is refused rather than guessed',
    !unsupported.ok && unsupported.code === 'UNSUPPORTED_SOURCE');

  /* a material change must move the fingerprint */
  const rebuilt = await tx.buildIntentTransactionRequest({
    chainId: 42161,
    account: REQUEST.from,
    quote: { ...quote, amountInWei: 2_000_000n },
    fromToken: { symbol: 'USDC', address: '0x5555555555555555555555555555555555555555', decimals: 6 },
    toToken: { symbol: 'ETH', native: true, decimals: 18 },
    expectFeeBps: 70,
    expectFeeReceiver: '0x4444444444444444444444444444444444444444',
    builders
  });
  t('a changed amount changes the quote fingerprint',
    rebuilt.request.quoteFingerprint !== built.request.quoteFingerprint);

  const redacted = tx.redactTransactionRequest(built.request);
  const redactedText = JSON.stringify(redacted);
  t('the redacted view has no calldata', !('data' in redacted) && !redactedText.includes('eeee'));
  t('the redacted view has no addresses', !/0x[0-9a-fA-F]{40}/.test(redactedText));
  t('minOutAppearsInCalldata is evidence only, and false here',
    tx.minOutAppearsInCalldata('0x1234', 990_000n) === false);

  return rows;
}
