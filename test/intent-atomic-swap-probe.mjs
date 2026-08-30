/**
 * ATOMIC SWAP (HTLC) PROBE — Phase 4d
 * ---------------------------------------------------------------------------
 * Cross-chain atomicity is the strongest claim this product can make, so the
 * probe asserts BOTH directions:
 *
 *   1. the claim is REAL when it is made — two legs, one hashlock, enforced
 *      timelock ordering, real contract calldata, and the server never signs;
 *   2. the claim is NEVER made when the mechanism is absent — no configured
 *      contracts means unavailable with a published block code, and the
 *      pre-existing sequential path is never re-labelled as atomic.
 *
 * A mis-ordered HTLC pair is the classic burn: claim here, refund there. The
 * compiler must refuse it BEFORE any calldata exists. That refusal has a test
 * of its own, because a swap that pays out on one chain and refunds on the
 * other is worse than no atomic swap at all.
 */

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  const { Interface } = await import('ethers');

  const mod = await import('../server/intentAtomicSwap.js');
  const {
    ATOMIC_SWAP_SCHEMA,
    MIN_TIMELOCK_MARGIN_SECONDS,
    buildAtomicSwapPlan,
    parseAtomicSwapAddresses,
    atomicSwapConfigured,
    atomicSwapProtocolStatus,
    verifyAtomicSwapLeg,
    ATOMIC_SWAP_ABI
  } = mod;

  const USER = '0x1111111111111111111111111111111111111111';
  const SOLVER = '0x2222222222222222222222222222222222222222';
  const HASHLOCK = '0x' + 'ab'.repeat(32);
  const ADDR_BNB = '0x3333333333333333333333333333333333333333';
  const ADDR_ARB = '0x4444444444444444444444444444444444444444';

  const envWas = process.env.INTENT_ATOMIC_SWAP_ADDRESSES;
  const restoreEnv = () => {
    if (envWas === undefined) delete process.env.INTENT_ATOMIC_SWAP_ADDRESSES;
    else process.env.INTENT_ATOMIC_SWAP_ADDRESSES = envWas;
  };

  /* ---------------------- 1. unconfigured honesty ------------------------- */
  delete process.env.INTENT_ATOMIC_SWAP_ADDRESSES;
  const unconfigured = atomicSwapProtocolStatus();
  t('schema is fbt.atomic-swap.v1', ATOMIC_SWAP_SCHEMA === 'fbt.atomic-swap.v1');
  t('unconfigured reports available:false', unconfigured.available === false);
  t('unconfigured NEVER claims crossChainAtomic', unconfigured.crossChainAtomic === false);
  t('unconfigured publishes the block code', unconfigured.blockCode === 'ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED');
  t('unconfigured still discloses escrow mechanism honestly',
    unconfigured.custody === 'on-chain-contract-escrow-while-open' && unconfigured.escrowDuringSwap === true);
  t('zero or one configured chain is not enough (needs a pair)',
    atomicSwapConfigured(new Map([[56, ADDR_BNB]])) === false);

  /* ------------------------- 2. address parsing --------------------------- */
  const jsonParsed = parseAtomicSwapAddresses(`{"56":"${ADDR_BNB}","42161":"${ADDR_ARB}"}`);
  t('JSON address map parses to 2 chains', jsonParsed.size === 2);
  const pairParsed = parseAtomicSwapAddresses(`56:${ADDR_BNB},42161:${ADDR_ARB}`);
  t('comma-pair address format parses identically', pairParsed.size === 2 && pairParsed.get(42161) === ADDR_ARB);
  t('invalid entries are dropped, not guessed at',
    parseAtomicSwapAddresses(`{"56":"not-an-address","999":"${ADDR_ARB}","137":42}`).size === 0);
  t('two configured chains activate the capability',
    atomicSwapConfigured(parseAtomicSwapAddresses(`{"56":"${ADDR_BNB}","42161":"${ADDR_ARB}"}`)) === true);

  /* --------------------------- 3. plan compile ---------------------------- */
  const now = Math.floor(Date.now() / 1000);
  process.env.INTENT_ATOMIC_SWAP_ADDRESSES = `{"56":"${ADDR_BNB}","42161":"${ADDR_ARB}"}`;
  const plan = buildAtomicSwapPlan({
    schema: ATOMIC_SWAP_SCHEMA,
    hashlock: HASHLOCK,
    source: { chainId: 56, sender: USER, recipient: SOLVER, token: { native: true }, amount: '1000000000', timeout: now + 7200 },
    destination: { chainId: 42161, sender: SOLVER, recipient: USER, token: { native: false, address: '0x5555555555555555555555555555555555555555' }, amount: '2000000000', timeout: now + 3600 }
  }, now);
  t('a valid EVM<->EVM pair compiles', plan.ok === true);
  t('plan id is a sha256 hex', /^0x[a-f0-9]{64}$/.test(plan.swapId || ''));
  t('the plan pins one shared hashlock under mode htlc-evm-evm',
    plan.hashlock === HASHLOCK && plan.mode === 'htlc-evm-evm');
  t('both legs target their configured contract',
    plan.legs?.[0]?.to === ADDR_BNB && plan.legs?.[1]?.to === ADDR_ARB && plan.legs?.every((leg) => leg.configured === true));
  t('native leg value equals the amount, token leg value is 0',
    plan.legs?.[0]?.value === '1000000000' && plan.legs?.[1]?.value === '0');
  t('the calldata is REAL newSwap calldata and decodes back', (() => {
    try {
      const iface = new Interface(ATOMIC_SWAP_ABI);
      const decoded = iface.parseTransaction({ data: plan.legs[0].data, value: BigInt(plan.legs[0].value) });
      return decoded.name === 'newSwap' && decoded.args.hashlock === HASHLOCK
        && decoded.args.recipient === SOLVER && Number(decoded.args.timeout) === now + 7200;
    } catch { return false; }
  })());
  t('server never signs or executes anything',
    plan.executableByServer === false && plan.serverExecutesTransactions === false && plan.userSignatureRequired === true);
  t('escrow is disclosed, FBT keylessness is pinned',
    plan.custody === 'on-chain-contract-escrow-while-open' && plan.fbtHoldsKeys === false && plan.fbtCustody === false);
  t('the preimage stays on the user device (server sees only the hashlock)',
    plan.safety?.preimageHolder === 'user-device-only' && plan.safety?.serverNeverSeesPreimage === true);
  t('atomicity is attributed to the contracts, not to a promise',
    plan.atomicity?.enforcedBy === 'on-chain-hash-timelock-contracts' && plan.atomicity?.eitherBothLegsClaimedOrBothRefund === true);
  t('the sequential cross-chain path is never re-labelled by this plan',
    plan.sequentialCrossChainPathUnchanged === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE');

  /* ----------------------- 4. the refusals that matter -------------------- */
  const misOrdered = buildAtomicSwapPlan({
    hashlock: HASHLOCK,
    source: { chainId: 56, sender: USER, recipient: SOLVER, token: { native: true }, amount: '1', timeout: now + 4000 },
    destination: { chainId: 42161, sender: SOLVER, recipient: USER, token: { native: true }, amount: '1', timeout: now + 3600 }
  }, now);
  t('a mis-ordered HTLC pair is refused (claim-here-refund-there)',
    misOrdered.ok === false && misOrdered.code === 'ATOMIC_SWAP_TIMELOCK_ORDER_UNSAFE');
  t('the margin equals the published safety margin', MIN_TIMELOCK_MARGIN_SECONDS === 3600);
  const sameChain = buildAtomicSwapPlan({
    hashlock: HASHLOCK,
    source: { chainId: 56, sender: USER, recipient: SOLVER, token: { native: true }, amount: '1', timeout: now + 7200 },
    destination: { chainId: 56, sender: SOLVER, recipient: USER, token: { native: true }, amount: '1', timeout: now + 3600 }
  }, now);
  t('same-chain pairs are refused (that is the workflow batch, not an HTLC)',
    sameChain.ok === false && sameChain.code === 'ATOMIC_SWAP_SAME_CHAIN');
  const solanaLeg = buildAtomicSwapPlan({
    hashlock: HASHLOCK,
    source: { chainId: 56, sender: USER, recipient: SOLVER, token: { native: true }, amount: '1', timeout: now + 7200 },
    destination: { chainId: 1151111081099710, sender: SOLVER, recipient: USER, token: { native: true }, amount: '1', timeout: now + 3600 }
  }, now);
  t('Solana legs are refused — no program exists and "soon" is never atomic',
    solanaLeg.ok === false && solanaLeg.code === 'ATOMIC_SWAP_UNSUPPORTED_CHAIN');
  const badHash = buildAtomicSwapPlan({ hashlock: '0x00' }, now);
  t('a non-32-byte hashlock is refused', badHash.ok === false && badHash.code === 'ATOMIC_SWAP_HASHLOCK_REQUIRED');
  const decimalAmount = buildAtomicSwapPlan({
    hashlock: HASHLOCK,
    source: { chainId: 56, sender: USER, recipient: SOLVER, token: { native: true }, amount: '1.5', timeout: now + 7200 },
    destination: { chainId: 42161, sender: SOLVER, recipient: USER, token: { native: true }, amount: '1', timeout: now + 3600 }
  }, now);
  t('decimal amounts never reach uint256 calldata', decimalAmount.ok === false && decimalAmount.code === 'ATOMIC_SWAP_BAD_AMOUNT');
  const zeroAmount = buildAtomicSwapPlan({
    hashlock: HASHLOCK,
    source: { chainId: 56, sender: USER, recipient: SOLVER, token: { native: true }, amount: '0', timeout: now + 7200 },
    destination: { chainId: 42161, sender: SOLVER, recipient: USER, token: { native: true }, amount: '1', timeout: now + 3600 }
  }, now);
  t('zero amounts are refused', zeroAmount.ok === false && zeroAmount.code === 'ATOMIC_SWAP_BAD_AMOUNT');

  /* ----------------- 5. plan without configured contracts ------------------ */
  delete process.env.INTENT_ATOMIC_SWAP_ADDRESSES;
  const unconfiguredPlan = buildAtomicSwapPlan({
    hashlock: HASHLOCK,
    source: { chainId: 56, sender: USER, recipient: SOLVER, token: { native: true }, amount: '1', timeout: now + 7200 },
    destination: { chainId: 42161, sender: SOLVER, recipient: USER, token: { native: true }, amount: '1', timeout: now + 3600 }
  }, now);
  t('an unconfigured plan still compiles as review-only with the block code published',
    unconfiguredPlan.ok === true && unconfiguredPlan.configured === false
    && unconfiguredPlan.blockCode === 'ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED');
  t('unconfigured legs have no target address and never pretend to be live',
    unconfiguredPlan.legs.every((leg) => leg.to === null && leg.configured === false));

  /* --------------------------- 6. leg verification ------------------------- */
  const noRpc = await verifyAtomicSwapLeg({ chainId: 56, swapId: plan.swapId, rpcUrls: [] });
  t('verification without RPCs is refused, not guessed', noRpc.ok === false && noRpc.code === 'ATOMIC_SWAP_RPC_UNCONFIGURED');
  const noContract = await verifyAtomicSwapLeg({ chainId: 137, swapId: plan.swapId, rpcUrls: ['https://rpc.example'] });
  t('verification on an unconfigured chain is refused', noContract.ok === false && noContract.code === 'ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED');

  process.env.INTENT_ATOMIC_SWAP_ADDRESSES = `{"56":"${ADDR_BNB}","42161":"${ADDR_ARB}"}`;
  const fakeProvider = (stateUint) => () => ({
    call: async () => new Interface(ATOMIC_SWAP_ABI)
      .encodeFunctionResult('swaps', [USER, SOLVER, ADDR_BNB, 1000n, HASHLOCK, 4242, stateUint]),
    destroy: async () => {}
  });
  const locked = await verifyAtomicSwapLeg({
    chainId: 56, swapId: plan.swapId,
    rpcUrls: ['https://a.example', 'https://b.example'],
    providerFactory: fakeProvider(1)
  });
  t('a locked leg reads as locked with RPC consensus',
    locked.ok === true && locked.state === 'locked' && locked.consensus === true && locked.leg?.sender === USER);
  const claimed = await verifyAtomicSwapLeg({
    chainId: 56, swapId: plan.swapId, rpcUrls: ['https://a.example'],
    providerFactory: fakeProvider(2)
  });
  t('a claimed leg reads as claimed', claimed.ok === true && claimed.state === 'claimed');
  const refunded = await verifyAtomicSwapLeg({
    chainId: 56, swapId: plan.swapId, rpcUrls: ['https://a.example'],
    providerFactory: fakeProvider(3)
  });
  t('a refunded leg reads as refunded', refunded.ok === true && refunded.state === 'refunded');
  t('verification is read-only and never settles',
    locked.verificationOnly === true && locked.serverExecutesTransactions === false);

  const disagreeFactory = (url) => ({
    call: async () => new Interface(ATOMIC_SWAP_ABI)
      .encodeFunctionResult('swaps', [USER, SOLVER, ADDR_BNB, 1000n, HASHLOCK, 4242, url.includes('b.') ? 2 : 1]),
    destroy: async () => {}
  });
  const disagreement = await verifyAtomicSwapLeg({
    chainId: 56, swapId: plan.swapId,
    rpcUrls: ['https://a.example', 'https://b.example'],
    providerFactory: (url) => disagreeFactory(url)
  });
  t('an RPC passed-vs-claimed split is reported as rpc-disagreement, never averaged',
    disagreement.ok === true && disagreement.state === 'rpc-disagreement' && disagreement.consensus === false);

  /* --------------- 7. the rest of the Intent OS is unchanged -------------- */
  /* intents.js snapshots its env at first import; drop the var first so the
     unconfigured assertion below is deterministic in every run order. */
  delete process.env.INTENT_ATOMIC_SWAP_ADDRESSES;
  const workflow = await import('../server/intentWorkflow.js');
  t('the workflow-batch compiler itself still refuses cross-chain (unchanged)',
    workflow.buildWorkflowBatchCalldata({
      schema: workflow.WORKFLOW_SCHEMA,
      nodes: [
        { id: 'a', action: 'send', chainId: 56, asset: { symbol: 'BNB' }, amount: '1', allowedContracts: [ADDR_BNB], revertPolicy: 'abort-all', deadline: now + 3600 },
        { id: 'b', action: 'send', chainId: 137, asset: { symbol: 'BNB' }, amount: '1', allowedContracts: [ADDR_BNB], revertPolicy: 'abort-all', deadline: now + 3600 }
      ]
    }).code === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE');
  const wfStatus = workflow.workflowProtocolStatus();
  t('workflow status still says crossChainAtomic:false for the batch path',
    wfStatus.crossChainAtomic === false);
  t('workflow status now exposes the HTLC mechanism block',
    wfStatus.crossChainAtomicSwap?.schema === 'fbt.atomic-swap.v1'
    && typeof wfStatus.crossChainAtomicSwap?.crossChainAtomic === 'boolean');

  const capabilities = await import('../server/intents.js');
  const adapter = capabilities.INTENT_CAPABILITIES.adapters.find((row) => row.id === 'fbt-htlc-atomic-swap');
  t('the HTLC adapter is published in capabilities', Boolean(adapter));
  t('the adapter pins serverExecutes:false and FBT keylessness',
    adapter?.serverExecutes === false && adapter?.fbtHoldsKeys === false);
  t('atomicCrossChainWorkflows stays unavailable while unconfigured',
    capabilities.INTENT_CAPABILITIES.unavailable.atomicCrossChainWorkflows === true);

  restoreEnv();
  return rows;
}
