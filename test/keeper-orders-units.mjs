/**
 * Unit tests for the automatic-execution (keeper) layer.
 *
 * Money-deciding logic only: the EIP-712 payload and its signature, the
 * exact-amount allowance rule, the BigInt `buyAmount` math, the server's
 * refusals of forged or misdirected orders (these return BEFORE any network
 * call, so they are deterministic offline), the fill-watch cycle, and the
 * order model. Network-dependent behaviour is covered by the probes, not here.
 */
import { Wallet, TypedDataEncoder, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';
import {
  COW_CHAIN_IDS,
  COW_ORDER_TYPES,
  COW_SETTLEMENT,
  COW_VAULT_RELAYER,
  MAX_UINT256,
  PLATFORM_FEE_BPS,
  approvalAmountFor,
  buildCowAppData,
  buildCowOrder,
  computeBuyAmountRaw,
  cowCancelTypedData,
  cowExplorerUrl,
  cowOrderTypedData,
  cowSupports,
  cowValidTo,
  formatRawAmount,
  isCowUid,
  needsApproval,
  toBaseUnits
} from '../src/lib/cowOrders.js';
import { PAYOUT_ADDRESSES } from '../src/lib/payout.js';
import { applyKeeperState, createOrder, sanitizeKeeper } from '../src/lib/orders.js';
import { keeperCopyFor } from '../src/lib/keeperCopy.js';
import { buildStageAlert } from '../server/orderAlerts.js';
import { relayCowCancel, relayCowCreate, normaliseCowStatus } from '../server/cowOrders.js';
import {
  createSolanaLimitOrder,
  normaliseSolanaStatus,
  solanaLimitFeeStatus
} from '../server/solanaLimitOrders.js';
import { solanaKeeperAmounts } from '../src/lib/solanaOrders.js';
import { clearWatches, putWatches, readWatches, runWatchCycle } from '../server/watch.js';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const uid = (byte) => `0x${byte.repeat(56)}`;

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ─────────────────────────── EIP-712 ─────────────────────────── */

  {
    /* The type hash is the protocol's own. If a field order or a type name
       drifts, every signature we produce becomes one the settlement contract
       rejects — so this pins the struct against the published GPv2Order hash. */
    const encoded = TypedDataEncoder.from(COW_ORDER_TYPES).encodeType('Order');
    t('the Order struct hashes to the published GPv2Order type hash',
      keccak256(toUtf8Bytes(encoded)) === '0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489');
    t('kind "sell" hashes to the published KIND_SELL constant',
      keccak256(toUtf8Bytes('sell')) === '0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775');
  }

  const wallet = Wallet.createRandom();
  const appData = await buildCowAppData();
  const validTo = Math.floor(Date.now() / 1000) + 3600;
  const sellRaw = toBaseUnits('1.5', 18);
  const buyRaw = computeBuyAmountRaw({ sellAmountRaw: sellRaw.toString(), sellDecimals: 18, buyDecimals: 6, targetRate: '3000.123456' });
  const order = buildCowOrder({
    owner: wallet.address,
    sellToken: WETH,
    buyToken: USDC,
    sellAmountRaw: sellRaw,
    buyAmountRaw: buyRaw,
    validTo,
    appDataHash: appData.hash
  });

  {
    const td = cowOrderTypedData(1, order);
    t('the EIP-712 domain is the protocol domain, bound to the chain and settlement',
      td.domain.name === 'Gnosis Protocol' && td.domain.version === 'v2'
      && td.domain.chainId === 1 && td.domain.verifyingContract === COW_SETTLEMENT);
    t('the order is a fill-or-kill sell with ERC-20 balances and no fee amount',
      order.kind === 'sell' && order.partiallyFillable === false
      && order.sellTokenBalance === 'erc20' && order.buyTokenBalance === 'erc20' && order.feeAmount === '0');
    t('the receiver is the owner, so proceeds never go to another address', order.receiver === wallet.address);

    const sig = await wallet.signTypedData(td.domain, td.types, td.message);
    t('the wallet signature recovers to the owner over the exact payload',
      verifyTypedData(td.domain, td.types, td.message, sig) === wallet.address);

    const tampered = { ...td.message, buyAmount: (BigInt(order.buyAmount) - 1n).toString() };
    t('lowering the buyAmount after signing breaks the signature',
      verifyTypedData(td.domain, td.types, tampered, sig) !== wallet.address);

    const otherChain = { ...td.domain, chainId: 137 };
    t('a signature is bound to its chain: replaying it on another chain fails',
      verifyTypedData(otherChain, td.types, td.message, sig) !== wallet.address);
  }

  {
    const cancel = cowCancelTypedData(8453, [uid('ab')]);
    const sig = await wallet.signTypedData(cancel.domain, cancel.types, cancel.message);
    t('the cancellation signature recovers to the owner over the order UID',
      verifyTypedData(cancel.domain, cancel.types, cancel.message, sig) === wallet.address);
    t('a cancellation with a malformed UID is refused before signing',
      (() => { try { cowCancelTypedData(8453, ['0x1234']); return false; } catch { return true; } })());
  }

  /* ───────────────────────── allowance ───────────────────────── */

  {
    t('an allowance below the sell amount needs an approval', needsApproval('0', '1000') === true && needsApproval('999', '1000') === true);
    t('an allowance that already covers the sell amount sends nothing',
      needsApproval('1000', '1000') === false && needsApproval('5000', '1000') === false);
    t('the approval amount is exactly the sell amount', approvalAmountFor('1000') === 1000n);
    t('an unlimited approval is refused outright', (() => { try { approvalAmountFor(MAX_UINT256); return false; } catch { return true; } })());
    t('a zero approval is refused', (() => { try { approvalAmountFor('0'); return false; } catch { return true; } })());
    const samples = ['1', '1000000', '123456789012345678901234567890'];
    t('no sampled approval is ever MaxUint256 or a rounded-up buffer',
      samples.every((s) => approvalAmountFor(s).toString() === s && approvalAmountFor(s) !== MAX_UINT256));
    t('the relayer address is the GPv2VaultRelayer', COW_VAULT_RELAYER === '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110');
  }

  /* ─────────────────────── exact buyAmount math ─────────────────────── */

  {
    t('a plain decimal converts to base units exactly', toBaseUnits('1.5', 18) === 1500000000000000000n);
    t('an amount with more decimals than the token has is refused, not rounded',
      toBaseUnits('1.0000001', 6) === null);
    t('signs, exponents and separators are refused', toBaseUnits('-1', 6) === null && toBaseUnits('1e3', 6) === null && toBaseUnits('1,5', 6) === null);

    t('1.5 WETH at 3000.123456 USDC/WETH is exactly 4500.185184 USDC',
      computeBuyAmountRaw({ sellAmountRaw: '1500000000000000000', sellDecimals: 18, buyDecimals: 6, targetRate: '3000.123456' }) === 4500185184n);
    t('1000 USDC at 0.00033333 WETH/USDC is exactly 0.33333 WETH (decimals 6 → 18)',
      computeBuyAmountRaw({ sellAmountRaw: '1000000000', sellDecimals: 6, buyDecimals: 18, targetRate: '0.00033333' }) === 333330000000000000n);

    /* Rounding is UP: the buyAmount is the floor the solver must meet, so the
       fill is never worse than the target. The smallest possible sell still
       yields at least one unit rather than zero. */
    t('a tiny sell rounds the buyAmount UP to at least one unit',
      computeBuyAmountRaw({ sellAmountRaw: '1', sellDecimals: 18, buyDecimals: 6, targetRate: '1' }) === 1n);

    /* At full 18-decimal precision a float cannot hold the value, so verify the
       ceiling property against the exact rational bound instead of against a
       second float computation. */
    const sell = 123456789123456789123n;
    const rate = { num: 2000000000000000001n, den: 1000000000000000000n };
    const buy = computeBuyAmountRaw({ sellAmountRaw: sell.toString(), sellDecimals: 18, buyDecimals: 18, targetRate: '2.000000000000000001' });
    // Both tokens have 18 decimals, so the decimal factors cancel: buy must equal
    // ceil(sell × num / den). The exact bound is sell × num over den.
    const bound = sell * rate.num;
    t('high-precision buyAmount is the exact ceiling of sell×rate (no float drift)',
      buy * rate.den >= bound && (buy - 1n) * rate.den < bound);

    t('a zero, negative or unparseable rate is refused',
      ['0', '-1', '1e3', 'abc', ''].every((r) => computeBuyAmountRaw({ sellAmountRaw: '100', sellDecimals: 6, buyDecimals: 6, targetRate: r }) === null));
    t('a formatted amount reads back to the same decimal', formatRawAmount(4500185184n, 6) === '4500.185184');

    t('an out-of-range decimals value is refused',
      computeBuyAmountRaw({ sellAmountRaw: '1', sellDecimals: 40, buyDecimals: 6, targetRate: '1' }) === null
      && computeBuyAmountRaw({ sellAmountRaw: '1', sellDecimals: 6, buyDecimals: -1, targetRate: '1' }) === null);
  }

  /* ───────────────────── appData, fee, chains, links ───────────────────── */

  {
    const doc = JSON.parse(appData.json);
    t('appData carries the partner fee at the platform rate to our EVM payout address',
      doc.metadata.partnerFee.volumeBps === PLATFORM_FEE_BPS && doc.metadata.partnerFee.recipient === PAYOUT_ADDRESSES.evm);
    t('appData is a limit order class and its hash is keccak of the exact JSON string',
      doc.metadata.orderClass.orderClass === 'limit' && appData.hash === keccak256(toUtf8Bytes(appData.json)));
    t('the appData hash is deterministic across calls', (await buildCowAppData()).hash === appData.hash);
    t('the platform fee is 70 basis points', PLATFORM_FEE_BPS === 70);
  }

  {
    t('exactly the six production CoW networks are supported',
      JSON.stringify([...COW_CHAIN_IDS].sort((a, b) => a - b)) === JSON.stringify([1, 56, 137, 8453, 42161, 43114]));
    t('an unsupported network is refused', !cowSupports(10) && !cowSupports(100) && !cowSupports(59144));
    t('a CoW explorer link is built only for a well-formed UID',
      (cowExplorerUrl(1, uid('ab')) ?? '').startsWith('https://explorer.cow.fi/orders/') && cowExplorerUrl(1, '0x12') === null);
    t('a UID is 56 bytes, i.e. 112 hex characters', isCowUid(uid('cd')) && !isCowUid(`0x${'cd'.repeat(55)}`));
    t('the states the order book reports are normalised to the four the app shows',
      normaliseCowStatus('fulfilled') === 'fulfilled' && normaliseCowStatus('cancelled') === 'cancelled'
      && normaliseCowStatus('expired') === 'expired' && normaliseCowStatus('open') === 'open'
      && normaliseCowStatus('weird') === 'unknown');
    t('a valid-to in the past is never produced', cowValidTo(3600_000, Date.now()) > Math.floor(Date.now() / 1000));
  }

  /* ─────────────── the server refuses what it must refuse ─────────────── */

  {
    const base = {
      chainId: 1,
      from: wallet.address,
      signingScheme: 'eip712',
      order,
      appData: appData.json
    };
    const sign = async (o, chain = 1) => wallet.signTypedData(cowOrderTypedData(chain, o).domain, COW_ORDER_TYPES, cowOrderTypedData(chain, o).message);

    const unsupported = await relayCowCreate({ ...base, chainId: 10, signature: await sign(order) });
    t('the relay refuses an unsupported network before any network call',
      unsupported.status === 400 && unsupported.body.error === 'UNSUPPORTED_CHAIN');

    const mismatchAppData = await relayCowCreate({ ...base, appData: '{"appCode":"x"}', signature: await sign(order) });
    t('the relay refuses appData that does not hash to what was signed',
      mismatchAppData.status === 400 && mismatchAppData.body.error === 'APP_DATA_HASH_MISMATCH');

    const wrongRecipientDoc = JSON.stringify({
      appCode: 'FBTCryp',
      metadata: { orderClass: { orderClass: 'limit' }, partnerFee: { volumeBps: 70, recipient: wallet.address } },
      version: '1.1.0'
    });
    const wrongRecipientOrder = { ...order, appData: keccak256(toUtf8Bytes(wrongRecipientDoc)) };
    const wrongRecipient = await relayCowCreate({
      ...base,
      order: wrongRecipientOrder,
      appData: wrongRecipientDoc,
      signature: await sign(wrongRecipientOrder)
    });
    t('the relay refuses an order whose partner fee does not pay our address',
      wrongRecipient.status === 400 && wrongRecipient.body.error === 'PARTNER_FEE_RECIPIENT_MISMATCH');

    const other = Wallet.createRandom();
    const forged = await relayCowCreate({
      ...base,
      signature: await other.signTypedData(cowOrderTypedData(1, order).domain, COW_ORDER_TYPES, cowOrderTypedData(1, order).message)
    });
    t('the relay refuses an order signed by someone other than the claimed owner',
      forged.status === 400 && forged.body.error === 'SIGNER_MISMATCH');

    const badOrder = { ...order, kind: 'buy' };
    const buySide = await relayCowCreate({ ...base, order: badOrder, signature: await sign(order) });
    t('the relay refuses anything that is not a sell order', buySide.status === 400);

    const forgedCancel = await relayCowCancel({
      chainId: 1,
      from: wallet.address,
      orderUids: [uid('ef')],
      signature: await other.signTypedData(cowCancelTypedData(1, [uid('ef')]).domain, cowCancelTypedData(1, [uid('ef')]).types, cowCancelTypedData(1, [uid('ef')]).message)
    });
    t('the relay refuses a cancellation signed by someone other than the owner',
      forgedCancel.status === 400 && forgedCancel.body.error === 'SIGNER_MISMATCH');
  }

  /* ─────────────────────────── Solana ─────────────────────────── */

  {
    const amounts = solanaKeeperAmounts({ amountIn: '2.5', inputDecimals: 9, outputDecimals: 6, minOut: '150.25' });
    t('2.5 SOL at 150.25 USDC/SOL is exactly 375.625 USDC in raw units',
      amounts.makingAmount === '2500000000' && amounts.takingAmount === '375625000');
    t('a Solana amount with more decimals than the mint is refused',
      solanaKeeperAmounts({ amountIn: '0.0000001', inputDecimals: 6, outputDecimals: 9, minOut: '1' }).error === 'BAD_AMOUNT');
    t('a zero rate is refused', solanaKeeperAmounts({ amountIn: '1', inputDecimals: 6, outputDecimals: 6, minOut: '0' }).error === 'BAD_RATE');
    t('the Solana fee owner is our Solana payout address', solanaLimitFeeStatus().payoutOwner === PAYOUT_ADDRESSES.solana);

    const badMint = await createSolanaLimitOrder({
      maker: 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4',
      inputMint: 'not-a-mint',
      outputMint: 'So11111111111111111111111111111111111111112',
      makingAmount: '1000',
      takingAmount: '1000'
    });
    t('a Solana order with a malformed mint is refused before any upstream call',
      badMint.status === 400 && badMint.body.error === 'BAD_MINT');
    const fractional = await createSolanaLimitOrder({
      maker: 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4',
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      makingAmount: '1.5',
      takingAmount: '1000'
    });
    t('Solana raw amounts must be whole integers, never decimals',
      fractional.status === 400 && fractional.body.error === 'BAD_MAKING_AMOUNT');

    t('Jupiter status words map to the four app states',
      normaliseSolanaStatus('Open') === 'open' && normaliseSolanaStatus('Filled') === 'fulfilled'
      && normaliseSolanaStatus('Cancelled') === 'cancelled' && normaliseSolanaStatus('Expired') === 'expired'
      && normaliseSolanaStatus('???') === 'unknown');
  }

  /* ─────────────────────── the order model ─────────────────────── */

  {
    const from = { symbol: 'WETH', address: WETH, decimals: 18, coingeckoId: null };
    const to = { symbol: 'USDC', address: USDC, decimals: 6, coingeckoId: null };
    const made = createOrder({
      type: 'limit',
      chainId: 1,
      fromToken: from,
      toToken: to,
      amountIn: '1.5',
      targetRate: '3000',
      direction: 'above',
      priceOf: 'from',
      expiryKey: '24h',
      keeper: { provider: 'cow', chainId: 1, uid: uid('ab'), extra: 'signature-blob-must-not-persist' }
    });
    t('a keeper limit order is stored with its execution mode and its on-chain reference',
      made.order?.execMode === 'keeper' && made.order.keeper.provider === 'cow' && made.order.keeper.uid === uid('ab'));
    t('a keeper order never persists fields outside its reference', made.order?.keeper && !('extra' in made.order.keeper));
    const plain = createOrder({ type: 'limit', chainId: 1, fromToken: from, toToken: to, amountIn: '1', targetRate: '3000', direction: 'below', priceOf: 'from', expiryKey: '24h' });
    t('an ordinary limit order is unchanged: no execution mode, no keeper', plain.order && plain.order.execMode === undefined && plain.order.keeper === undefined);
    t('a keeper reference with an unknown provider is dropped', sanitizeKeeper({ provider: 'mystery' }) === null);

    const k = made.order;
    t('a keeper fill moves the order to filled and records the state',
      applyKeeperState(k, 'fulfilled', 42).status === 'filled' && applyKeeperState(k, 'fulfilled', 42).keeper.state === 'fulfilled');
    t('a cancelled keeper is recorded as cancelled, not filled',
      applyKeeperState(k, 'cancelled').status === 'cancelled');
    t('an open keeper stays active until the network says otherwise',
      applyKeeperState(k, 'open').status === 'active');
  }

  /* ──────────────── the alert: the fill copy and nothing else ──────────────── */

  {
    const filled = buildStageAlert({ stage: 'closed', filled: true, lang: 'fa', base: 'WETH', quote: 'USDC', id: 'o1' });
    t('a keeper fill sends the exact fill sentence, in the closed stage',
      filled.body === 'سفارش حد شما با موفقیت در قیمت هدف پر شد.' && filled.stage === 'closed' && filled.filled === true);
    const closed = buildStageAlert({ stage: 'closed', lang: 'fa', base: 'WETH', quote: 'USDC', id: 'o1' });
    t('an ordinary close keeps its own copy and is not marked as a fill', closed.filled === false && closed.body !== filled.body);
    const fillEn = buildStageAlert({ stage: 'closed', filled: true, lang: 'en-US', base: 'WETH', quote: 'USDC', id: 'o1' });
    t('a fill in an unlisted language falls back to English, never to nothing', fillEn.body.length > 0 && fillEn.filled === true);
  }

  /* ─────────────── the copy the sheet shows, in both languages ─────────────── */

  {
    const fa = keeperCopyFor('fa');
    t('mode 1 carries the exact Persian label', fa.mode1Title === '⚡ اجرای خودکار روی زنجیره (On-Chain Keeper)');
    t('mode 2 carries the exact Persian label', fa.mode2Title === '🔔 رصد قیمت + تأیید یک‌لمسی با اعلان');
    t('the Solver badge and the confirm-after-alert badge are the exact Persian strings',
      fa.badgeKeeper === 'اجرای خودکار (Solver)' && fa.badgeWatch === 'نیازمند امضا پس از اعلان');
    t('an unlisted language falls back to English copy', keeperCopyFor('xx').mode1Title.includes('On-Chain Keeper'));
    t('the mode 1 copy never promises a guaranteed fee', !/guarantee|تضمین/i.test(`${fa.mode1Body}${fa.mode1Note}`));
  }

  /* ───────────────────── the watcher's fill path ───────────────────── */

  {
    const endpoint = 'https://keeper-test.invalid/push/endpoint-for-units';
    await clearWatches(endpoint);

    const uidFilled = uid('11');
    const uidOpen = uid('22');
    const uidCancelled = uid('33');
    const uidFailingSend = uid('44');
    const stored = await putWatches(endpoint, [
      { id: 'k-filled', type: 'limit', fromSym: 'WETH', toSym: 'USDC', cowUid: uidFilled, cowChainId: 1 },
      { id: 'k-open', type: 'limit', fromSym: 'WETH', toSym: 'USDC', cowUid: uidOpen, cowChainId: 1 },
      { id: 'k-cancelled', type: 'limit', fromSym: 'WETH', toSym: 'USDC', cowUid: uidCancelled, cowChainId: 1 },
      { id: 'k-failing', type: 'limit', fromSym: 'WETH', toSym: 'USDC', cowUid: uidFailingSend, cowChainId: 1 },
      { id: 'k-malformed', type: 'limit', fromSym: 'WETH', toSym: 'USDC', cowUid: '0x12', cowChainId: 1 }
    ], 'fa');
    t('keeper rows are stored without a price id, and a malformed one is dropped',
      stored.stored === 4);

    const sent = [];
    const states = { [uidFilled]: 'fulfilled', [uidOpen]: 'open', [uidCancelled]: 'cancelled', [uidFailingSend]: 'fulfilled' };
    const send = async (ep, lang, payload) => {
      sent.push({ ep, lang, payload });
      return payload.id !== 'k-failing';
    };
    await runWatchCycle(send, Date.now(), {
      checkCow: async (_chain, u) => states[u] ?? 'unknown',
      checkSol: async () => 'unknown'
    });

    const filledSends = sent.filter((s) => s.payload.id === 'k-filled');
    t('a filled keeper order sends exactly one closed alert',
      filledSends.length === 1 && filledSends[0].payload.stage === 'closed' && filledSends[0].payload.filled === true);
    t('an open keeper order sends nothing', !sent.some((s) => s.payload.id === 'k-open'));
    t('a cancelled keeper order sends nothing', !sent.some((s) => s.payload.id === 'k-cancelled'));
    t('a keeper whose alert failed is retried, not silently consumed', sent.filter((s) => s.payload.id === 'k-failing').length === 1);

    const after = (await readWatches()).filter((w) => w.endpoint === endpoint).map((w) => w.id).sort();
    t('after the cycle only the open row and the unsent fill remain watched',
      JSON.stringify(after) === JSON.stringify(['k-failing', 'k-open']));

    sent.length = 0;
    await runWatchCycle(send, Date.now(), {
      checkCow: async (_chain, u) => states[u] ?? 'unknown',
      checkSol: async () => 'unknown'
    });
    t('a delivered fill is never announced twice', sent.filter((s) => s.payload.id === 'k-filled').length === 0);
    await clearWatches(endpoint);
  }

  return rows;
}
