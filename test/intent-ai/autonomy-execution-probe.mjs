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
 *   4. BRIDGE is rejected before any generic/venue hook can quote, approve,
 *      simulate, build or send a transaction;
 *   5. the most specific venue wins (Base USDC → the fork-probed adapter);
 *   6. lending executes ONLY from a live review (exact token amount + unit,
 *      oracle price, rate, and for a borrow the projected health factor), every
 *      one re-read from the pool before the wallet is asked to sign, and any
 *      doubt fails closed with a named code;
 *   7. FARM / DEPOSIT / YIELD_SWEEP never map to an Aave supply and never fall
 *      through to the swap hooks;
 *   8. the mocks mirror the REAL library contracts (e.g. `runLendingPlan`
 *      reports per-step hashes in `completed`, with no top-level `hash`).
 */

import { runAction, runExecutionPlan } from '../../src/lib/intent-ai/executionRuntime.js';
import { formatExecutionResult } from '../../src/lib/intent-ai/humanResponse.js';
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

/* The same decimal-safe conversion lib/lending.js uses — including the part
   that TRUNCATES extra digits, which is why the executor checks precision. */
const realToUnits = (amount, decimals) => {
  const text = String(amount ?? '').trim().replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt((whole || '0') + (fraction + '0'.repeat(decimals)).slice(0, decimals));
};
/* …and the same plan builder contract (supply: approve exactly the amount when
   the allowance is short; borrow: a single borrow step when no collateral is
   passed). */
const realBuildLendingPlan = ({ action, asset, amount, collateral = null, allowanceWei = null, decimals = null }) => {
  const dec = Number(decimals ?? asset?.decimals ?? 18);
  const need = realToUnits(action === 'borrow' ? collateral : amount, dec);
  const have = allowanceWei == null ? null : BigInt(String(allowanceWei));
  const steps = [];
  if (action === 'supply') {
    if (need == null || need <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    if (have == null || have < need) steps.push({ id: 'approve', symbol: asset?.symbol, amountWei: need.toString() });
    steps.push({ id: 'supply', symbol: asset?.symbol, amountWei: need.toString() });
    return { ok: true, action, steps };
  }
  if (action === 'borrow') {
    const units = realToUnits(amount, dec);
    if (units == null || units <= 0n) return { ok: false, error: 'AMOUNT_REQUIRED', steps: [] };
    if (need != null && need > 0n) {
      steps.push({ id: 'approve', symbol: asset?.symbol, amountWei: need.toString() });
      steps.push({ id: 'supply', symbol: asset?.symbol, amountWei: need.toString(), asCollateral: true });
    }
    steps.push({ id: 'borrow', symbol: asset?.symbol, amountWei: units.toString() });
    return { ok: true, action, steps };
  }
  return { ok: false, error: 'UNKNOWN_ACTION', steps: [] };
};

const USDC = { id: 'USDC', symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 };
const WETH = { id: 'WETH', symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 };
const POOL_ADDR = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const nowSec = () => Math.floor(Date.now() / 1000);

/** The confirmed review a lending action must carry (what the chat card shows). */
const reviewOf = (side, over = {}) => ({
  requireLiveRateReview: true,
  reviewedAt: Date.now(),
  reviewedPriceUsd: 1,
  reviewedSupplyApyPct: side === 'supply' ? 4.31 : null,
  reviewedBorrowApyPct: side === 'borrow' ? 5.12 : null,
  reviewedProjectedHealthFactor: side === 'borrow' ? 5.47 : null,
  reviewedAvailableBorrowsUsd: side === 'borrow' ? 5000 : null,
  ...over
});
const supplyAction = (over = {}) => ({
  type: 'LEND', asset: 'USDC', amount: '1000', amountUnit: 'USDC', amountUsd: 1000, chainId: 42161,
  venue: 'lend-aave', protocol: 'Aave V3', market: USDC.address, parameters: reviewOf('supply'), ...over
});
const borrowAction = (over = {}) => ({
  type: 'BORROW', asset: 'USDC', amount: '500', amountUnit: 'USDC', amountUsd: 500, chainId: 42161,
  venue: 'lend-aave', protocol: 'Aave V3', market: USDC.address, parameters: reviewOf('borrow'), ...over
});

function makeDrivers({
  lendingFailsAt = null, noReceipt = false, receiptFails = false, perpPrice = 65000,
  signerChainId = null, signerAddress = null, nativeWei = 10n ** 17n,
  reserve = {}, oracle = {}, oracleTop = {}, position = {}, account = {}, noSignerForChain = false
} = {}) {
  const makeSigner = () => ({
    address: WALLET.address,
    getAddress: async () => signerAddress || WALLET.address,
    /* The verified Base adapter builds its own transactions and sends them
       through the signer, so the fake signer has to be able to send. */
    sendTransaction: async (tx) => { note(`signer.send:${tx?.to}`); return ({ hash: '0xAAVEBASETX', wait: async () => ({ status: 1 }) }); }
  });
  return {
    wallet: {
      getSigner: () => makeSigner(),
      ...(noSignerForChain ? {} : {
        getSignerForChain: async (chainId) => (signerChainId != null && Number(signerChainId) !== Number(chainId)
          ? { ok: false, code: 'CHAIN_MISMATCH' }
          : { ok: true, signer: makeSigner() })
      }),
      getReadProvider: async () => ({
        getBalance: async () => nativeWei,
        waitForTransaction: async () => ({ status: 1 }),
        /* The lending venue reads its receipt from the chain, never from its
           own awaited wait() — see the executor's waitForConfirmation. */
        getTransactionReceipt: async (hash) => (receiptFails ? null : { status: 1, transactionHash: hash, blockNumber: 19_000_001 })
      })
    },
    lending: {
      lendingVenue: (chainId) => ([1, 10, 56, 137, 8453, 42161, 43114].includes(Number(chainId)) ? { pool: POOL_ADDR } : null),
      lendingAssetsFor: () => ([USDC, WETH]),
      /* The real readReserve shape: protocol-read rates, status, caps, totals. */
      readReserve: async ({ asset }) => ({
        ok: true, listed: true, status: 'active', dataStatus: 'live',
        supplyApyPct: 4.31, borrowApyPct: 5.12, lastUpdateTimestamp: nowSec() - 30,
        decimals: asset.decimals, decimalsMatch: true, borrowingEnabled: true,
        totalSupplyWei: String(10n ** 15n), totalDebtWei: String(4n * 10n ** 14n), availableLiquidityWei: String(6n * 10n ** 14n),
        supplyCapWei: null, borrowCapWei: null,
        ...reserve
      }),
      /* …and the real readOraclePrices shape: prices keyed by asset id. */
      readOraclePrices: async ({ assets }) => ({
        ok: true, status: 'ok', source: 'protocol-oracle',
        prices: Object.fromEntries(assets.map((a) => [a.id, { valid: true, stale: false, priceUsd: a.symbol === 'WETH' ? 3000 : 1, ...oracle }])),
        ...oracleTop
      }),
      readAssetPosition: async () => ({ ok: true, walletWei: '5000000000', suppliedWei: '0', debtWei: '0', ...position }),
      readUserAccount: async () => ({
        ok: true, totalCollateralUsd: 10000, totalDebtUsd: 1000, availableBorrowsUsd: 5000,
        liquidationThresholdPct: 82, ltvPct: 75, healthFactor: 8.2, ...account
      }),
      readAllowance: async () => '0',
      toUnits: realToUnits,
      buildLendingPlan: realBuildLendingPlan,
      /* The REAL runLendingPlan contract: per-step hashes live in `completed`
         and there is NO top-level `hash` on success. A mock that returned one
         would have hidden a production bug where every confirmed deposit was
         reported as NO_TX_HASH. */
      runLendingPlan: async ({ steps }) => {
        note(`lending:${steps.map((s) => s.id).join('+')}`);
        const completed = [];
        for (const step of steps) {
          if (lendingFailsAt === step.id) {
            return { ok: false, completed, failedStep: step.id, code: `${step.id.toUpperCase()}_FAILED`, message: null, hash: null };
          }
          completed.push({ id: step.id, hash: `0xHASH_${step.id.toUpperCase()}`, asset: 'USDC' });
        }
        return { ok: true, completed };
      }
    },
    aaveBase: {
      AAVE_V3_BASE: { usdcDecimals: 6, usdc: USDC.address, pool: POOL_ADDR, chainId: 8453 },
      getReserveStatus: async () => ({ supplyApyPct: 4.62 }),
      buildSupplyPlan: async ({ amountUsdc, nativeBalance }) => {
        note(`aave-base:supply:${amountUsdc}`);
        if (nativeBalance == null) return { steps: [], checks: { blocked: ['AAVE_NATIVE_BALANCE_UNKNOWN'] } };
        return {
          steps: [
            { kind: 'approve', to: USDC.address, data: '0xapprove', value: 0n },
            { kind: 'supply', to: POOL_ADDR, data: '0xsupply', value: 0n }
          ],
          checks: { blocked: [], amountWei: realToUnits(amountUsdc, 6) }
        };
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
  const baseUsdc = getVenueExecutor(supplyAction({ chainId: 8453, venue: null }), makeDrivers());
  check('a Base USDC supply picks the fork-probed adapter, not the generic pool',
    baseUsdc.executor?.id === 'aave-base-usdc', baseUsdc.executor?.id);
  const noChainSupply = getVenueExecutor(supplyAction({ chainId: null, venue: null }), makeDrivers());
  check('a supply that names no chain is NOT assumed to be Base',
    noChainSupply.executor?.id === 'lend-aave', noChainSupply.executor?.id);
  const ethLend = getVenueExecutor(supplyAction({ asset: 'WETH', chainId: 42161 }), makeDrivers());
  check('a non-Base lending action falls back to the generic Aave venue',
    ethLend.executor?.id === 'lend-aave', ethLend.executor?.id);
  const baseBorrow = getVenueExecutor(borrowAction({ chainId: 8453 }), makeDrivers());
  check('a borrow — even USDC on Base — is never routed to the supply-only adapter',
    baseBorrow.executor?.id === 'lend-aave', baseBorrow.executor?.id);
  for (const type of ['FARM', 'DEPOSIT', 'YIELD_SWEEP']) {
    const picked = getVenueExecutor({ type, asset: 'USDC', chainId: 8453, amountUsd: 500 }, makeDrivers());
    check(`${type} resolves to NO venue — it is never an Aave supply`, picked.executor === null, picked.executor?.id);
  }
  const perp = getVenueExecutor({ type: 'FUTURES', asset: 'BTC', side: 'long', amountUsd: 200, leverage: 3 }, makeDrivers());
  check('a futures action resolves to the perp venue', perp.executor?.id === 'perp-velocity', perp.executor?.id);
  const equity = getVenueExecutor({ type: 'STOCKS', asset: 'NVDA', amountUsd: 150 }, makeDrivers());
  check('a stocks action resolves to the equity venue', equity.executor?.id === 'equity-solana', equity.executor?.id);

  /* ---------- 3. probes are honest ---------- */
  const noWallet = await probeVenue(supplyAction({ chainId: 8453 }), { wallet: { connected: false }, drivers: makeDrivers() });
  check('probe names WALLET_REQUIRED instead of pretending to be ready', noWallet.ok === false && noWallet.code === 'WALLET_REQUIRED');
  const badChain = await probeVenue(supplyAction({ chainId: 999 }), { wallet: WALLET, drivers: makeDrivers() });
  check('probe refuses a chain the venue does not have', badChain.ok === false && badChain.code === 'VENUE_UNSUPPORTED_CHAIN');
  const noChain = await probeVenue(supplyAction({ chainId: null }), { wallet: WALLET, drivers: makeDrivers() });
  check('probe never defaults the chain from the wallet', noChain.ok === false && noChain.code === 'CHAIN_REQUIRED', noChain.code);
  const noMarket = await probeVenue({ type: 'FUTURES', asset: 'DOGE', side: 'long', amountUsd: 100 }, { wallet: SOL_WALLET, drivers: makeDrivers() });
  check('probe refuses an unlisted perp market by name', noMarket.ok === false && noMarket.code === 'MARKET_NOT_LISTED');

  /* ---------- 4. plans carry live numbers, never invented ones ---------- */
  const lendPlan = await planVenue(supplyAction(), { wallet: WALLET, drivers: makeDrivers() });
  check('lending plan carries the live supply APY read from the pool',
    lendPlan.ok === true && lendPlan.supplyApyPct === 4.31 && lendPlan.op === 'supply', `${lendPlan.code}`);
  check('lending plan builds the approve step the venue actually needs',
    lendPlan.needsApproval === true && lendPlan.steps.some((s) => s.id === 'approve'));
  check('the plan uses the exact decimal amount the user confirmed (no float math)',
    lendPlan.amountWei === '1000000000' && lendPlan.amount === '1000', `${lendPlan.amountWei}/${lendPlan.amount}`);
  check('the plan is valued from the protocol oracle, not a default price',
    lendPlan.priceUsd === 1 && lendPlan.amountUsd === 1000, `${lendPlan.priceUsd}/${lendPlan.amountUsd}`);
  const perpPlan = await planVenue({ type: 'FUTURES', asset: 'BTC', side: 'long', amountUsd: 200, leverage: 3 }, { wallet: SOL_WALLET, drivers: makeDrivers() });
  check('perp plan computes notional from real collateral x leverage',
    perpPlan.ok === true && perpPlan.notionalUsd === 600 && perpPlan.priceUsd === 65000);

  /* ---------- 5. LENDING really executes end to end — from a live review ---------- */
  calls.length = 0;
  const lendResult = await runAction(supplyAction(), { wallet: WALLET, drivers: makeDrivers() });
  check('a reviewed lending action reaches CONFIRMED through the real state machine',
    lendResult.success === true && lendResult.status === 'CONFIRMED', `${lendResult.status}:${lendResult.error?.code}/${lendResult.error?.message}`);
  check('the receipt is the SUPPLY step\'s own hash from lib/lending.js `completed`, never an approval hash',
    lendResult.txHash === '0xHASH_SUPPLY', lendResult.txHash);
  check('the venue ran approve THEN supply, in that order', calls[0] === 'lending:approve+supply', calls[0]);
  check('the result names the venue that executed it', lendResult.plan?.actions?.[0]?.venue === 'lend-aave', lendResult.plan?.actions?.[0]?.venue);
  check('the runtime keeps the reviewed venue metadata on the action (no field is dropped)',
    lendResult.plan?.actions?.[0]?.parameters?.requireLiveRateReview === true
      && lendResult.plan?.actions?.[0]?.amountUnit === 'USDC'
      && lendResult.plan?.actions?.[0]?.market === USDC.address);

  /* ---------- 6. lending FAILS CLOSED on any unproven term ---------- */
  const lend = async (action, opts = {}) => {
    calls.length = 0;
    const result = await runAction(action, { wallet: WALLET, drivers: makeDrivers(opts) });
    return { result, calls: [...calls], reason: result.error?.message, code: result.error?.code };
  };
  const refused = async (name, action, opts, expected, { signsNothing = true } = {}) => {
    const r = await lend(action, opts);
    check(name, r.result.success !== true && r.reason === expected
      && (!signsNothing || !r.calls.some((c) => c.startsWith('lending:') || c.startsWith('signer.send') || c.startsWith('aave-base:supply'))),
      `${r.code}/${r.reason} calls=${r.calls.join('|')}`);
    return r;
  };

  await refused('a supply with no attached review is refused', supplyAction({ parameters: {}, amountUnit: null }), {}, 'LENDING_REVIEW_REQUIRED');
  await refused('a USD-denominated amount is refused (the unit must be the token)', supplyAction({ amountUnit: 'USD' }), {}, 'LENDING_REVIEW_REQUIRED');
  await refused('an expired review is refused', supplyAction({ parameters: reviewOf('supply', { reviewedAt: Date.now() - 6 * 60_000 }) }), {}, 'LENDING_REVIEW_EXPIRED');
  await refused('a review from the future is refused', supplyAction({ parameters: reviewOf('supply', { reviewedAt: Date.now() + 10 * 60_000 }) }), {}, 'LENDING_REVIEW_EXPIRED');
  await refused('a paused reserve is refused', supplyAction(), { reserve: { status: 'paused' } }, 'RESERVE_PAUSED');
  await refused('a frozen reserve is refused', supplyAction(), { reserve: { status: 'frozen' } }, 'RESERVE_NOT_ACTIVE');
  await refused('an unreadable reserve configuration is refused (never "active" by default)', supplyAction(), { reserve: { status: 'unknown' } }, 'RESERVE_NOT_ACTIVE');
  await refused('a partial reserve read is refused', supplyAction(), { reserve: { dataStatus: 'partial' } }, 'RESERVE_DATA_PARTIAL');
  await refused('a stale reserve is refused', supplyAction(), { reserve: { lastUpdateTimestamp: nowSec() - 7200 } }, 'RATE_STALE');
  await refused('an unavailable oracle is refused', supplyAction(), { oracleTop: { ok: false, status: 'unavailable', prices: {} } }, 'ORACLE_PRICE_UNAVAILABLE');
  await refused('a stale oracle price is refused', supplyAction(), { oracle: { valid: false, stale: true, priceUsd: null } }, 'ORACLE_PRICE_UNAVAILABLE');
  await refused('an oracle price that moved more than 1% since the review is refused', supplyAction(), { oracle: { priceUsd: 1.03 } }, 'QUOTE_CHANGED');
  await refused('a supply rate that moved beyond tolerance since the review is refused', supplyAction(), { reserve: { supplyApyPct: 7.9 } }, 'QUOTE_CHANGED');
  await refused('an on-chain balance below the amount is refused', supplyAction(), { position: { walletWei: '100' } }, 'INSUFFICIENT_FUNDS');
  await refused('an unverifiable balance is refused', supplyAction(), { position: { ok: false } }, 'BALANCE_UNVERIFIED');
  await refused('a supply that would exceed the reserve cap is refused', supplyAction(),
    { reserve: { supplyCapWei: String(10n ** 15n), totalSupplyWei: String(10n ** 15n - 1n) } }, 'SUPPLY_CAP_EXCEEDED');
  await refused('an amount beyond the token precision is refused, never rounded', supplyAction({ amount: '1.1234567' }), {}, 'AMOUNT_PRECISION_INVALID');
  await refused('a decimals disagreement between chain and registry is refused', supplyAction(), { reserve: { decimals: 18 } }, 'DECIMALS_UNVERIFIED');
  await refused('an asset address that differs from the reviewed market is refused',
    supplyAction({ market: '0x0000000000000000000000000000000000000001' }), {}, 'ASSET_MISMATCH');

  const wrongChain = await refused('a wallet on another network is never signed against (CHAIN_MISMATCH)', supplyAction(), { signerChainId: 1 }, 'CHAIN_MISMATCH');
  check('…and the lending plan was not even attempted on that network', !wrongChain.calls.some((c) => c.startsWith('lending:')), wrongChain.calls.join('|'));
  await refused('a driver set that cannot prove the signer\'s network fails closed', supplyAction(), { noSignerForChain: true }, 'CHAIN_UNVERIFIED');
  await refused('a signer that is not the reviewed account is refused', supplyAction(),
    { signerAddress: '0x2222222222222222222222222222222222222222' }, 'WALLET_ACCOUNT_CHANGED');

  const partial = await lend(supplyAction(), { lendingFailsAt: 'supply' });
  check('an approval that landed before the main step failed is reported as PARTIAL, never "nothing moved"',
    partial.result.success !== true && partial.reason === 'LENDING_PARTIAL', `${partial.code}/${partial.reason}`);
  const approveFail = await lend(supplyAction(), { lendingFailsAt: 'approve' });
  check('a failure at the approval step carries the venue\'s own reason',
    approveFail.result.success !== true && approveFail.reason === 'APPROVE_FAILED', `${approveFail.code}/${approveFail.reason}`);
  const noReceiptLend = await lend(supplyAction(), { receiptFails: true });
  check('a lending deposit with no chain receipt is refused, never confirmed',
    noReceiptLend.result.success !== true && noReceiptLend.code === 'CONFIRMATION_FAILED', `${noReceiptLend.result.status}:${noReceiptLend.code}`);

  const spoken = formatExecutionResult({ result: (await lend(supplyAction(), { reserve: { lastUpdateTimestamp: nowSec() - 7200 } })).result, locale: 'en' });
  check('a venue refusal is spoken in plain, specific words (not the generic provider message)',
    /could not be verified/i.test(spoken.message) && !/quote or routing provider/i.test(spoken.message), spoken.message);
  const spokenFa = formatExecutionResult({ result: (await lend(supplyAction({ parameters: {} }))).result, locale: 'fa' });
  check('…and in Persian', /بررسی زنده/.test(spokenFa.message), spokenFa.message);

  /* ---------- 6b. BORROW: capacity, liquidity, caps and health factor ---------- */
  const borrowOk = await lend(borrowAction());
  check('a reviewed borrow reaches CONFIRMED with the borrow step\'s own hash',
    borrowOk.result.success === true && borrowOk.result.txHash === '0xHASH_BORROW', `${borrowOk.result.status}:${borrowOk.code}/${borrowOk.reason}`);
  check('a borrow runs ONLY the reviewed leg', borrowOk.calls[0] === 'lending:borrow', borrowOk.calls[0]);
  const borrowNoExtra = await lend(borrowAction({ collateral: '999' }));
  check('extra collateral smuggled into a borrow is ignored — no unreviewed supply leg',
    borrowNoExtra.result.success === true && borrowNoExtra.calls[0] === 'lending:borrow', borrowNoExtra.calls[0]);
  await refused('a borrow with no attached review is refused', borrowAction({ parameters: {} }), {}, 'LENDING_REVIEW_REQUIRED');
  await refused('a borrow review missing its health-factor baseline is refused',
    borrowAction({ parameters: reviewOf('borrow', { reviewedProjectedHealthFactor: null }) }), {}, 'LENDING_REVIEW_REQUIRED');
  await refused('a borrow that would drop the health factor below the safety minimum is refused',
    borrowAction(), { account: { totalDebtUsd: 8000 } }, 'HEALTH_FACTOR_TOO_LOW');
  await refused('a borrow beyond the pool\'s own borrowing capacity is refused',
    borrowAction({ amount: '6000', amountUsd: 6000 }), {}, 'BORROW_LIMIT_EXCEEDED');
  await refused('a borrow beyond the reserve\'s available liquidity is refused',
    borrowAction(), { reserve: { availableLiquidityWei: '100000000' } }, 'BORROW_LIQUIDITY_EXCEEDED');
  await refused('a borrow on a reserve with borrowing disabled is refused', borrowAction(), { reserve: { borrowingEnabled: false } }, 'BORROW_DISABLED');
  await refused('a borrow with an unreadable account is refused', borrowAction(), { account: { ok: false } }, 'BORROW_POSITION_UNAVAILABLE');
  await refused('a borrow with no collateral is refused', borrowAction(), { account: { totalCollateralUsd: 0 } }, 'BORROW_CAPACITY_UNAVAILABLE');
  await refused('a borrow whose capacity shrank since the review is refused', borrowAction(), { account: { availableBorrowsUsd: 2000 } }, 'QUOTE_CHANGED');
  await refused('a borrow against an unverifiable borrow cap is refused',
    borrowAction(), { reserve: { borrowCapWei: '1000000000000', totalDebtWei: null } }, 'BORROW_CAP_UNVERIFIED');
  await refused('a borrow on a wallet in another network is refused', borrowAction(), { signerChainId: 1 }, 'CHAIN_MISMATCH');

  /* ---------- 6c. Base USDC supply through the verified adapter ---------- */
  calls.length = 0;
  const baseRun = await runAction(supplyAction({ chainId: 8453, venue: 'aave-base-usdc', amount: '400', amountUsd: 400 }), { wallet: WALLET, drivers: makeDrivers() });
  check('a reviewed Base USDC supply goes through the verified adapter and is confirmed',
    baseRun.success === true && baseRun.plan?.actions?.[0]?.venue === 'aave-base-usdc' && calls.includes('aave-base:supply:400'),
    `${baseRun.status}:${baseRun.error?.code}/${baseRun.error?.message} ${calls.join('|')}`);
  check('the adapter\'s signed steps carry only {to,data,value}, to the USDC token and the Aave pool',
    calls.filter((c) => c.startsWith('signer.send')).every((c) => [`signer.send:${USDC.address}`, `signer.send:${POOL_ADDR}`].includes(c)), calls.join('|'));
  const baseNoReview = await lend(supplyAction({ chainId: 8453, venue: 'aave-base-usdc', parameters: {} }));
  check('the verified adapter refuses a supply that was never reviewed',
    baseNoReview.result.success !== true && baseNoReview.reason === 'LENDING_REVIEW_REQUIRED' && !baseNoReview.calls.some((c) => c.startsWith('signer.send')),
    `${baseNoReview.reason} ${baseNoReview.calls.join('|')}`);
  const baseGas = await lend(supplyAction({ chainId: 8453, venue: 'aave-base-usdc' }), { nativeWei: null });
  check('the adapter gets integer wei from the chain (an unreadable native balance fails closed)',
    baseGas.result.success !== true && baseGas.reason === 'AAVE_NATIVE_BALANCE_UNKNOWN', `${baseGas.code}/${baseGas.reason}`);
  const baseWrongChain = await lend(supplyAction({ chainId: 8453, venue: 'aave-base-usdc' }), { signerChainId: 1 });
  check('the verified adapter never signs on the wrong network',
    baseWrongChain.result.success !== true && baseWrongChain.reason === 'CHAIN_MISMATCH' && !baseWrongChain.calls.some((c) => c.startsWith('signer.send')),
    `${baseWrongChain.reason} ${baseWrongChain.calls.join('|')}`);

  /* ---------- 6d. FARM is not Aave, and not a swap ---------- */
  const farmCalls = [];
  const farmHooks = {
    getQuote: async () => { farmCalls.push('swap.getQuote'); return { ok: true, fake: true }; },
    sendTransaction: async () => { farmCalls.push('swap.send'); return { txHash: '0xMUST_NOT_SEND' }; },
    waitForConfirmation: async () => { farmCalls.push('swap.wait'); return { status: 1 }; }
  };
  calls.length = 0;
  for (const type of ['FARM', 'DEPOSIT', 'YIELD_SWEEP']) {
    const farmRun = await runAction({ type, asset: 'USDC', chainId: 8453, amountUsd: 500, amount: '500' }, { wallet: WALLET, drivers: makeDrivers(), hooks: farmHooks });
    check(`${type} is refused by name — no Aave supply, no swap`,
      farmRun.success === false && farmRun.error?.code === 'FARM_EXECUTOR_UNAVAILABLE' && farmRun.txHash == null, `${farmRun.error?.code}`);
  }
  const swapShapedFarm = await runAction({ type: 'FARM', from: 'USDT', to: 'STETH', amount: 10, chainId: 1 }, { wallet: WALLET, drivers: makeDrivers(), hooks: farmHooks });
  check('a swap-shaped FARM is refused too — it never degrades into a swap',
    swapShapedFarm.error?.code === 'FARM_EXECUTOR_UNAVAILABLE', swapShapedFarm.error?.code);
  const farmViaVenue = await runAction({ type: 'FARM', venue: 'lend-aave', asset: 'USDC', chainId: 42161, amount: '10', amountUnit: 'USDC', parameters: reviewOf('supply') },
    { wallet: WALLET, drivers: makeDrivers(), hooks: farmHooks });
  check('naming the Aave venue on a FARM action does not unlock it', farmViaVenue.error?.code === 'FARM_EXECUTOR_UNAVAILABLE', farmViaVenue.error?.code);
  const exitRun = await runAction({ type: 'WITHDRAW', asset: 'USDC', chainId: 8453, amount: '5', amountUnit: 'USDC' }, { wallet: WALLET, drivers: makeDrivers(), hooks: farmHooks });
  check('a lending operation with no reviewed path (withdraw/repay) never falls through to the swap hooks',
    exitRun.error?.code === 'LENDING_VENUE_UNAVAILABLE', exitRun.error?.code);
  check('no lending driver, signer or swap hook was touched by any of those refusals',
    farmCalls.length === 0 && calls.length === 0, `${farmCalls.join(',')} | ${calls.join(',')}`);

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

  /* ---------- BRIDGE fails closed before *any* public execution hook ---------- */
  const bridgeHookCalls = [];
  const bridgeHook = (name, result) => async () => { bridgeHookCalls.push(name); return result; };
  const bridgeHooks = {
    getQuote: bridgeHook('getQuote', { ok: true, fake: true }),
    getBalance: bridgeHook('getBalance', { ok: true, raw: '1000000000' }),
    checkAllowance: bridgeHook('checkAllowance', false),
    approve: bridgeHook('approve', { ok: true }),
    simulate: bridgeHook('simulate', { ok: true }),
    buildTransaction: bridgeHook('buildTransaction', { to: '0xFAKE' }),
    sendTransaction: bridgeHook('sendTransaction', { txHash: '0xMUST_NOT_SEND' }),
    waitForConfirmation: bridgeHook('waitForConfirmation', { status: 1 }),
    onProgress: bridgeHook('onProgress', null)
  };
  const bridgeAdapter = {
    simulate: bridgeHook('adapter.simulate', { ok: true }),
    buildTransaction: bridgeHook('adapter.buildTransaction', { to: '0xFAKE' }),
    sendTransaction: bridgeHook('adapter.sendTransaction', { txHash: '0xMUST_NOT_SEND' }),
    waitForConfirmation: bridgeHook('adapter.waitForConfirmation', { status: 1 })
  };
  const bridgeRun = await runAction({
    type: 'BRIDGE', from: 'USDC', to: 'USDC', amount: 10, amountUnit: 'USDC',
    chainId: 1, destinationChainId: 8453
  }, { wallet: WALLET, hooks: bridgeHooks, adapter: bridgeAdapter, drivers: makeDrivers() });
  check('a bridge action is rejected with BRIDGE_EXECUTE_UNAVAILABLE',
    bridgeRun.success === false && bridgeRun.error?.code === 'BRIDGE_EXECUTE_UNAVAILABLE',
    `${bridgeRun.status}:${bridgeRun.error?.code}`);
  check('the blocked bridge remains explicitly non-transactional (no hash or receipt)',
    bridgeRun.txHash == null && bridgeRun.plan?.actions?.[0]?.status === 'BRIDGE_EXECUTE_UNAVAILABLE'
      && bridgeRun.plan?.actions?.[0]?.txHash == null && bridgeRun.plan?.actions?.[0]?.receipt == null);
  check('BRIDGE invokes no quote, balance, approval, simulation, build, send, receipt or progress hook',
    bridgeHookCalls.length === 0, bridgeHookCalls.join(','));

  const bridgeAliasRun = await runAction({ kind: 'BRIDGE', from: 'USDC', to: 'USDC', amount: 10 }, {
    wallet: WALLET, hooks: bridgeHooks, adapter: bridgeAdapter
  });
  check('the kind-form bridge alias is blocked before dispatch too',
    bridgeAliasRun.error?.code === 'BRIDGE_EXECUTE_UNAVAILABLE'
      && bridgeAliasRun.plan?.actions?.[0]?.type === 'BRIDGE'
      && bridgeHookCalls.length === 0, `${bridgeAliasRun.error?.code}:${bridgeHookCalls.join(',')}`);

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
      supplyAction({ chainId: 8453, venue: 'aave-base-usdc', amount: '400', amountUsd: 400 })
    ],
    wallet: WALLET,
    drivers: makeDrivers(),
    hooks: swapHooks
  });
  check('runExecutionPlan forwards the venue drivers to every step',
    calls.includes('aave-base:supply:400'), calls.join('|'));
  check('one plan can swap and then supply, each through its own venue',
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
