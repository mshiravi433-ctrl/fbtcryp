/**
 * FBT INTENT AI — AUTONOMY EXECUTION probe.
 * ---------------------------------------------------------------------------
 * The user report this locks down:
 *   «اتوماسیون نمی‌تونه هیچ‌کدام خرید و فروش سهام و فیوچرز و فارم، سواپ و وام را
 *    انجام بده و فقط می‌بره صفحه مورد نظر.»
 *
 * Before the venue executors existed, `runAction` handed EVERY action the swap
 * hook set, so a FARM/LEND/FUTURES/STOCKS action died at QUOTING with
 * VALIDATION_FAILED and the chat could only offer a link. This probe drives the
 * REAL runtime (`executionRuntime.runAction`) against the REAL venue executors
 * with only the chain boundary faked — the exact pattern the rest of the suite
 * uses — and asserts:
 *
 *   1. each venue reaches CONFIRMED, and only through a receipt the (fake)
 *      chain produced — the no-receipt-no-success rule still holds per venue;
 *   2. a matched venue with no driver fails by NAME at that venue and never
 *      silently falls through to the swap quoter (the original bug);
 *   3. the swap path is untouched when no drivers are bound (regression);
 *   4. the most specific venue wins (Base USDC → the fork-probed adapter).
 */

import { runAction, runExecutionPlan } from '../../src/lib/intent-ai/executionRuntime.js';
import {
  VENUE_EXECUTORS,
  describeVenueExecutors,
  getVenueExecutor,
  normalizeVenueAction,
  probeVenue,
  planVenue,
  resolveVenueHooks
} from '../../src/lib/intent-ai/autonomy/venueExecutors.js';

const results = [];
const check = (name, ok, extra = null) => { results.push({ name, ok: Boolean(ok), extra }); };

const WALLET = { connected: true, canSign: true, address: '0x1111111111111111111111111111111111111111', chainId: 8453 };
const SOL_WALLET = { connected: true, address: '0x1111111111111111111111111111111111111111', solana: { connected: true, address: 'So11111111111111111111111111111111111111112', adapter: { publicKey: 'pk' } } };

/* ── fake drivers: the chain boundary only ─────────────────────────────── */

const calls = [];
const note = (what) => calls.push(what);

function makeDrivers({ lendingFails = false, noReceipt = false, receiptFails = false, perpPrice = 65000 } = {}) {
  return {
    wallet: {
      getSigner: () => ({
        address: WALLET.address,
        /* The verified Base adapter builds its own transactions and sends them
           through the signer, so the fake signer has to be able to send. */
        sendTransaction: async () => ({ hash: '0xAAVEBASETX', wait: async () => ({ status: 1 }) })
      }),
      getReadProvider: async () => ({
        waitForTransaction: async () => ({ status: 1 }),
        /* The lending venue reads its receipt from the chain, never from its
           own awaited wait() — see the executor's waitForConfirmation. */
        getTransactionReceipt: async (hash) => (receiptFails ? null : { status: 1, transactionHash: hash, blockNumber: 19_000_001 })
      })
    },
    lending: {
      lendingVenue: (chainId) => ([1, 10, 56, 137, 8453, 42161, 43114].includes(Number(chainId)) ? { pool: '0xPOOL' } : null),
      lendingAssetsFor: () => ([
        { symbol: 'USDC', address: '0xUSDC', decimals: 6 },
        { symbol: 'WETH', address: '0xWETH', decimals: 18 }
      ]),
      readReserve: async () => ({ supplyApyPct: 4.31, borrowApyPct: 5.12, priceUsd: 1 }),
      readAllowance: async () => '0',
      toUnits: (amount, decimals) => String(BigInt(Math.round(Number(amount) * 10 ** Number(decimals)))),
      /* Mirrors the real lib/lending.js contract exactly — same arguments
         (`amount`, `decimals`, `allowanceWei`) and same `{ ok, action, steps }`
         return, with the approve step added only when the allowance is short. */
      buildLendingPlan: ({ action, amount, allowanceWei, decimals }) => {
        const need = BigInt(Math.round(Number(amount) * 10 ** Number(decimals)));
        const steps = [];
        if (allowanceWei == null || BigInt(String(allowanceWei)) < need) {
          steps.push({ id: 'approve', amountWei: need.toString() });
        }
        steps.push({ id: action, amountWei: need.toString() });
        return { ok: true, action, steps };
      },
      runLendingPlan: async ({ steps }) => {
        note(`lending:${steps.map((s) => s.id).join('+')}`);
        if (lendingFails) return { ok: false, failedStep: 'supply', code: 'SUPPLY_FAILED' };
        return { ok: true, hash: '0xLENDINGRECEIPT', completed: steps };
      }
    },
    aaveBase: {
      AAVE_V3_BASE: { usdcDecimals: 6 },
      getReserveStatus: async () => ({ supplyApyPct: 4.62 }),
      buildSupplyPlan: async ({ amountUsdc }) => {
        note(`aave-base:supply:${amountUsdc}`);
        return { ok: true, steps: ['approve', 'supply'], transactions: [{ data: '0xapprove' }, { data: '0xsupply' }] };
      }
    },
    perp: {
      velocityPerpIndex: (sym) => (['BTC', 'ETH', 'SOL'].includes(String(sym).toUpperCase()) ? { marketIndex: 0, priceUsd: perpPrice } : null),
      openVelocityPosition: async ({ marketIndex, side, notionalUsd, oraclePrice }) => {
        note(`perp:open:${side}:${notionalUsd}@${oraclePrice}`);
        return { signature: '5PERPSIG', marketIndex, side };
      },
      closeVelocityPosition: async () => ({ signature: '5CLOSESIG' }),
      confirmSignature: async () => (noReceipt ? { ok: true } : { ok: true, slot: 271828, confirmations: 32 })
    },
    equity: {
      USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      resolveAsset: (sym) => (String(sym).toUpperCase() === 'NVDA' ? { symbol: 'NVDA', mint: 'NVDAxMINT', name: 'NVIDIA (tokenised)' } : null),
      getOrder: async ({ amountUsd, outputMint }) => { note(`equity:quote:${amountUsd}:${outputMint}`); return { ok: true, outAmount: amountUsd / 130 }; },
      signOrder: async () => 'signed-tx',
      executeOrder: async () => ({ status: 'Success', code: 0, signature: '5EQSIG' }),
      executeSucceeded: (r) => r?.status === 'Success' && Number(r?.code) === 0,
      executeSignature: (r) => r?.signature,
      orderErrorKey: () => 'ORDER_FAILED',
      confirmSignature: async () => (noReceipt ? { ok: true } : { ok: true, slot: 271829, confirmations: 32 })
    },
    market: { priceOf: async (sym) => (String(sym).toUpperCase() === 'BTC' ? perpPrice : 1) }
  };
}

try {
  /* ---------- 1. the registry is real and enumerable ---------- */
  check('registry exposes 5 venues', VENUE_EXECUTORS.length === 5);
  const ids = describeVenueExecutors().map((v) => v.id);
  check('registry covers swap, lending, the verified Base adapter, perps and equities',
    ['swap-evm', 'lend-aave', 'aave-base-usdc', 'perp-velocity', 'equity-solana'].every((id) => ids.includes(id)));

  /* ---------- 2. venue selection is by specificity, not by order ---------- */
  const baseUsdc = getVenueExecutor({ type: 'FARM', asset: 'USDC', chainId: 8453, amountUsd: 500 }, makeDrivers());
  check('a Base USDC farm picks the fork-probed adapter, not the generic pool',
    baseUsdc.executor?.id === 'aave-base-usdc', baseUsdc.executor?.id);
  const ethLend = getVenueExecutor({ type: 'LEND', asset: 'WETH', chainId: 42161, amountUsd: 500 }, makeDrivers());
  check('a non-Base lending action falls back to the generic Aave venue',
    ethLend.executor?.id === 'lend-aave', ethLend.executor?.id);
  const perp = getVenueExecutor({ type: 'FUTURES', asset: 'BTC', side: 'long', amountUsd: 200, leverage: 3 }, makeDrivers());
  check('a futures action resolves to the perp venue', perp.executor?.id === 'perp-velocity', perp.executor?.id);
  const equity = getVenueExecutor({ type: 'STOCKS', asset: 'NVDA', amountUsd: 150 }, makeDrivers());
  check('a stocks action resolves to the equity venue', equity.executor?.id === 'equity-solana', equity.executor?.id);

  /* ---------- 3. probes are honest ---------- */
  const noWallet = await probeVenue({ type: 'LEND', asset: 'USDC', chainId: 8453, amountUsd: 100 }, { wallet: { connected: false }, drivers: makeDrivers() });
  check('probe names WALLET_REQUIRED instead of pretending to be ready', noWallet.ok === false && noWallet.code === 'WALLET_REQUIRED');
  const badChain = await probeVenue({ type: 'LEND', asset: 'USDC', chainId: 999, amountUsd: 100 }, { wallet: WALLET, drivers: makeDrivers() });
  check('probe refuses a chain the venue does not have', badChain.ok === false && badChain.code === 'VENUE_UNSUPPORTED_CHAIN');
  const noMarket = await probeVenue({ type: 'FUTURES', asset: 'DOGE', side: 'long', amountUsd: 100 }, { wallet: SOL_WALLET, drivers: makeDrivers() });
  check('probe refuses an unlisted perp market by name', noMarket.ok === false && noMarket.code === 'MARKET_NOT_LISTED');

  /* ---------- 4. plans carry live numbers, never invented ones ---------- */
  const lendPlan = await planVenue({ type: 'LEND', asset: 'USDC', chainId: 42161, amountUsd: 1000 }, { wallet: WALLET, drivers: makeDrivers() });
  check('lending plan carries the live supply APY read from the pool',
    lendPlan.ok === true && lendPlan.supplyApyPct === 4.31 && lendPlan.op === 'supply');
  check('lending plan builds the approve step the venue actually needs',
    lendPlan.needsApproval === true && lendPlan.steps.some((s) => s.id === 'approve'));
  const perpPlan = await planVenue({ type: 'FUTURES', asset: 'BTC', side: 'long', amountUsd: 200, leverage: 3 }, { wallet: SOL_WALLET, drivers: makeDrivers() });
  check('perp plan computes notional from real collateral x leverage',
    perpPlan.ok === true && perpPlan.notionalUsd === 600 && perpPlan.priceUsd === 65000);

  /* ---------- 5. LENDING really executes end to end ---------- */
  calls.length = 0;
  const lendResult = await runAction(
    { type: 'LEND', asset: 'USDC', chainId: 42161, amountUsd: 1000 },
    { wallet: WALLET, drivers: makeDrivers() }
  );
  check('a lending action reaches CONFIRMED through the real state machine',
    lendResult.success === true && lendResult.status === 'CONFIRMED', `${lendResult.status}:${lendResult.error?.code}`);
  check('the lending receipt is the one the venue returned, not a fabricated hash',
    lendResult.txHash === '0xLENDINGRECEIPT');
  check('the venue ran approve THEN supply, in that order', calls[0] === 'lending:approve+supply', calls[0]);
  check('the result names the venue that executed it', lendResult.plan?.actions?.[0]?.venue === 'lend-aave', lendResult.plan?.actions?.[0]?.venue);

  /* ---------- 6. no receipt → no success, per venue ---------- */
  const failedLend = await runAction(
    { type: 'LEND', asset: 'USDC', chainId: 42161, amountUsd: 1000 },
    { wallet: WALLET, drivers: makeDrivers({ lendingFails: true }) }
  );
  check('a venue failure is reported as a failure carrying the venue\'s own reason',
    failedLend.success !== true
      && failedLend.error?.code === 'BROADCAST_FAILED'
      && failedLend.error?.message === 'SUPPLY_FAILED',
    `${failedLend.error?.code}/${failedLend.error?.message}`);

  const noReceiptLend = await runAction(
    { type: 'LEND', asset: 'USDC', chainId: 42161, amountUsd: 1000 },
    { wallet: WALLET, drivers: makeDrivers({ receiptFails: true }) }
  );
  check('a lending deposit with no chain receipt is refused, never confirmed',
    noReceiptLend.success !== true && noReceiptLend.error?.code === 'CONFIRMATION_FAILED',
    `${noReceiptLend.status}:${noReceiptLend.error?.code}`);

  /* ---------- 7. PERP really executes, and needs a real slot ---------- */
  calls.length = 0;
  const perpResult = await runAction(
    { type: 'FUTURES', asset: 'BTC', side: 'long', amountUsd: 200, leverage: 3, chainId: 501 },
    { wallet: SOL_WALLET, drivers: makeDrivers() }
  );
  check('a perp open reaches CONFIRMED through the same state machine',
    perpResult.success === true && perpResult.status === 'CONFIRMED', `${perpResult.status}:${perpResult.error?.code}`);
  check('the perp receipt is the venue signature', perpResult.txHash === '5PERPSIG');
  check('the perp order was placed long with the leveraged notional', calls[0] === 'perp:open:long:600@65000', calls[0]);

  const ghostPerp = await runAction(
    { type: 'FUTURES', asset: 'BTC', side: 'long', amountUsd: 200, leverage: 3, chainId: 501 },
    { wallet: SOL_WALLET, drivers: makeDrivers({ noReceipt: true }) }
  );
  check('a signature with no slot/confirmation count is refused, never confirmed',
    ghostPerp.success !== true && ghostPerp.error?.code === 'CONFIRMATION_FAILED', `${ghostPerp.status}:${ghostPerp.error?.code}`);

  /* ---------- 8. EQUITY really executes ---------- */
  calls.length = 0;
  const equityResult = await runAction(
    { type: 'STOCKS', asset: 'NVDA', amountUsd: 150, chainId: 501 },
    { wallet: SOL_WALLET, drivers: makeDrivers() }
  );
  check('a tokenised-equity buy reaches CONFIRMED through the real swap order',
    equityResult.success === true && equityResult.txHash === '5EQSIG', `${equityResult.status}:${equityResult.error?.code}`);
  check('the equity order quoted against the published mint, not the symbol',
    calls[0] === 'equity:quote:150:NVDAxMINT', calls[0]);

  /* ---------- 9. the original bug: no silent swap fallthrough ---------- */
  const bareHooks = { getQuote: async () => { note('SWAP_QUOTER_CALLED'); return { ok: true, fake: true }; } };
  const orphan = resolveVenueHooks({ type: 'LEND', asset: 'USDC', chainId: 8453, amountUsd: 10 }, { wallet: WALLET, drivers: {}, hooks: bareHooks });
  check('a lending action with no lending driver is refused by name', orphan.code === 'VENUE_DRIVER_MISSING', orphan.code);
  calls.length = 0;
  const orphanRun = await runAction({ type: 'LEND', asset: 'USDC', chainId: 8453, amountUsd: 10 }, { wallet: WALLET, drivers: {}, hooks: bareHooks });
  check('that refusal never reaches the swap quoter', !calls.includes('SWAP_QUOTER_CALLED'), calls.join(','));
  check('that refusal surfaces as a named provider failure carrying the venue code',
    orphanRun.success !== true && orphanRun.error?.code === 'PROVIDER_FAILED' && orphanRun.error?.message === 'VENUE_DRIVER_MISSING',
    `${orphanRun.error?.code}/${orphanRun.error?.message}`);

  /* ---------- 10. regression: the swap path is untouched ---------- */
  const swapHooks = {
    getQuote: async () => ({ ok: true, amountOut: '1' }),
    sendTransaction: async () => ({ txHash: '0xSWAP' }),
    waitForConfirmation: async () => ({ status: 1 })
  };
  const swapNoDrivers = await runAction(
    { type: 'SWAP', from: 'USDC', to: 'ETH', amountUsd: 100, chainId: 8453 },
    { wallet: WALLET, hooks: swapHooks }
  );
  check('a swap with no drivers bound still runs on the caller\'s own hooks (unchanged behaviour)',
    swapNoDrivers.success === true && swapNoDrivers.txHash === '0xSWAP', `${swapNoDrivers.status}:${swapNoDrivers.error?.code}`);
  check('the swap executor contributes no hooks of its own',
    Object.keys(resolveVenueHooks({ type: 'SWAP', from: 'USDC', to: 'ETH' }, { hooks: swapHooks }).hooks)
      .filter((k) => k !== 'getQuote' && k !== 'sendTransaction' && k !== 'waitForConfirmation').length === 0);

  /* ---------- 11. multi-step plans mix venues in one run ---------- */
  calls.length = 0;
  const plan = await runExecutionPlan({
    actions: [
      { type: 'SWAP', from: 'USDT', to: 'USDC', amountUsd: 400, chainId: 8453 },
      { type: 'FARM', asset: 'USDC', chainId: 8453, amountUsd: 400 }
    ],
    wallet: WALLET,
    drivers: makeDrivers(),
    hooks: swapHooks
  });
  check('runExecutionPlan forwards the venue drivers to every step',
    calls.includes('aave-base:supply:400'), calls.join('|'));
  check('one plan can swap and then farm, each through its own venue',
    plan.plan?.totalActions === 2 && plan.plan?.completedActions === 2 && calls.includes('aave-base:supply:400'),
    `${plan.plan?.completedActions}/${plan.plan?.totalActions} ${calls.join('|')}`);

  /* ---------- 12. normalisation keeps the fields venues need ---------- */
  const norm = normalizeVenueAction({ type: 'FUTURES', asset: 'BTC', side: 'SHORT', amountUsd: 100, leverage: 5, marketIndex: 2 });
  check('normalisation keeps side/leverage/marketIndex (the perp planner needs them)',
    norm.side === 'short' && norm.leverage === 5 && norm.marketIndex === 2);
} catch (err) {
  check('probe completed without throwing', false, String(err?.stack || err));
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nautonomy-execution probe: ${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error(results.filter((r) => !r.ok).map((r) => `  ✗ ${r.name}${r.extra ? ` [${r.extra}]` : ''}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/autonomy-execution-probe');

export default results;
