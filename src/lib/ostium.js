/**
 * OSTIUM — the first builder-code venue, and the first time this app earns on
 * a trade it did not itself execute.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS IS AND WHY IT IS DIFFERENT FROM EVERY REFERRAL WE SHIP ───────
 * `lib/venueReferral.js` decorates a URL and hopes. This does not: the fee is
 * a field inside the transaction the user signs, enforced by Ostium's own
 * contract, and it is transferred to our address atomically when the trade
 * opens. There is no accrual, no claim step, and nothing to trust us for.
 *
 * That is also why it had to be built rather than configured. A builder code
 * pays only when WE construct the order.
 *
 * ─── WHY WE ENCODE THE CALLDATA OURSELVES INSTEAD OF SHIPPING THEIR SDK ─────
 * `@ostium/builder-sdk` does exactly this job and is the obvious choice. It
 * was measured and rejected on one number: bundled for the browser it is
 * **177 KB gzipped**, against an entire current entry bundle of ~237 KB. It
 * drags in viem, permissionless, graphql-request and a Safe/account-abstraction
 * stack, none of which we use — we already have ethers and a wallet layer.
 *
 * So the encoder below was verified BYTE-FOR-BYTE against the SDK rather than
 * written from the docs and hoped over. Five cases — long, short, take-profit
 * and stop-loss set, a day trade, 100x, 2.25x, 0 bps and 20 bps — all produce
 * calldata identical to `client.getOpenTradeTx()`. The ABI itself was
 * extracted from the SDK's own bundle, not guessed: two fields differ from
 * what their public docs imply (`isDayTrade` is a tenth struct member, and
 * `slippageP` is `uint256`, not `uint16`), and either mistake would produce a
 * transaction that reverts after the user had already signed it.
 *
 * ─── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────────
 * It does not submit anything. It returns an unsigned `{ to, data }` and the
 * caller's wallet signs it, exactly like `aggregator.js`. Nothing here can
 * move money on its own.
 */

import { BUILDER_BPS, BUILDER_BPS_MAX, BUILDER_VENUES } from './builderCodes';
import { PAYOUT_ADDRESSES } from './payout';

const loadEthers = () => import('ethers');

/**
 * Ostium's Trading contract on Arbitrum.
 *
 * Cross-checked two ways rather than copied once: it is the `tradingAddress`
 * in Ostium's published audit/deployment table, and it is the `to` address the
 * SDK itself produces when asked to build an openTrade. A hard-coded contract
 * address that is wrong sends a user's collateral to nowhere.
 */
export const OSTIUM_TRADING = '0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411';

/** Arbitrum One. Ostium is not deployed anywhere else we support. */
export const OSTIUM_CHAIN_ID = 42161;

/** USDC on Arbitrum — Ostium's only collateral asset. */
export const OSTIUM_COLLATERAL = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

/**
 * WHO THE USDC ALLOWANCE GOES TO — AND IT IS NOT THE CONTRACT WE CALL.
 *
 * This is the trap in the whole integration. We send `openTrade` to Trading
 * (`0x6D0b…`), but the collateral is pulled by TRADINGSTORAGE (`0xccd5…`). An
 * approval granted to the address we call would look completely reasonable,
 * pass review, cost the user a gas fee, and then every trade would revert on
 * `transferFrom` with no clue as to why.
 *
 * Not deduced — read off the SDK's own `getApproveUsdcTx()`, whose calldata
 * decodes to `approve(0xccd5891083a8acd2074690f65d3024e7d13d66e7, amount)`.
 * That address matches `tradingStorageAddress` in Ostium's published
 * deployment table, so two independent sources agree.
 */
export const OSTIUM_SPENDER = '0xcCd5891083A8acD2074690F65d3024E7D13d66E7';

/**
 * The public market-data API. Keyless, and already answering — the price
 * snapshot below was read from it live before this module was written.
 */
export const OSTIUM_API = 'https://builder.prod.bedrock.ostium.io';

/**
 * The exact function this app encodes.
 *
 * ─── THE TWO FIELDS THE DOCUMENTATION DOES NOT SHOW ─────────────────────────
 * Ostium's developer page documents the struct as nine members ending at
 * `buy`, and their older Python example shows `slippage` as a small integer.
 * The deployed contract disagrees on both counts, and this signature is taken
 * from the ABI inside their own SDK:
 *
 *   • `isDayTrade` is a TENTH struct member. Omitting it shifts every
 *     following word and changes the selector — the transaction would not
 *     revert on a bad value, it would fail to decode at all.
 *   • `slippageP` is `uint256`.
 *
 * Both were caught by diffing against the SDK's output. Neither would have
 * been caught by reading the docs, which is the entire argument for having
 * done the diff.
 */
const OPEN_TRADE_ABI = [
  'function openTrade((uint256 collateral,uint192 openPrice,uint192 tp,uint192 sl,address trader,uint32 leverage,uint16 pairIndex,uint8 index,bool buy,bool isDayTrade) t,(address builder,uint32 builderFee) bf,uint8 orderType,uint256 slippageP)'
];

/** Ostium's OpenOrderType enum, in its on-chain order. */
export const ORDER_TYPE = { market: 0, limit: 1, stop: 2 };

/**
 * Minimum position size Ostium accepts, in USDC of collateral.
 *
 * Read from the SDK's exported `MIN_OPEN_SIZE_USD`, not chosen by us. Below
 * this the contract rejects the trade, and letting a user sign a transaction
 * that is guaranteed to fail costs them gas for nothing.
 */
export const MIN_COLLATERAL_USD = 5;

/**
 * Where the builder fee lands.
 *
 * Same EVM payout address the swap fee already uses. Deliberately NOT a
 * separate address: a second one is a second thing to lose the keys to, and
 * this is the address the owner already controls and already receives on.
 */
export function builderAddress() {
  return PAYOUT_ADDRESSES.evm;
}

/**
 * Our fee, clamped to the SMALLER of our own ceiling and Ostium's.
 *
 * ─── A BUG THIS FUNCTION SHIPPED WITH FOR ONE HOUR ──────────────────────────
 * The first version was `Math.min(n, venueCap)` and its comment claimed our
 * 10 bps cap won. It did not: `ostiumFeeBps(999)` returned **50**, Ostium's
 * limit, because `BUILDER_BPS_MAX` is only applied while PARSING the env var
 * in builderCodes.js. Any caller passing `bps` directly — a future screen with
 * a fee input, a test, a mistake — sailed straight past our own product limit
 * to ten times our intended rate, and the comment above it said otherwise.
 *
 * Caught by asserting the claim instead of trusting it. Both caps are applied
 * here now, and the test pins the result to 10 rather than to "something
 * smaller than 999".
 *
 * Two caps, because they mean different things: ours is a product decision
 * about what is fair to charge, Ostium's is a contract rule. Exceeding theirs
 * reverts AFTER the user signs, which is the worst place to find a limit.
 */
export function ostiumFeeBps(bps = BUILDER_BPS) {
  const cap = Math.min(BUILDER_BPS_MAX, BUILDER_VENUES.ostium.capBps);
  const n = Number(bps);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, cap);
}

/**
 * `builderFee` as the contract wants it: a fraction scaled by 1e6, expressed
 * as a PERCENT rather than a basis point.
 *
 * 5 bps is 0.05%, and 0.05 × 1e6 / 100 = 50000. Verified against the SDK's
 * own encoding: 5 bps produced the word `0x…c350` (50000) and 20 bps produced
 * `0x…30d40` (200000).
 *
 * This is the single most error-prone number in the file — a factor-of-100
 * slip here charges a trader 5% instead of 0.05% — so it is one exported
 * function with one test rather than an inline multiplication at the call
 * site.
 */
export function feeBpsToContractUnits(bps) {
  const n = Number(bps);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10_000);
}

/**
 * Notional, the number every Ostium fee is charged on.
 *
 * Collateral × leverage. Separate function because this is the multiplication
 * users get wrong, and because both the fee preview and the size validation
 * need the same answer.
 */
export function notionalUsd({ collateralUsd, leverage }) {
  const c = Number(collateralUsd);
  const x = Number(leverage);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!Number.isFinite(x) || x <= 0) return null;
  return c * x;
}

/**
 * Everything the review screen has to show before the user signs.
 *
 * ─── WHY THE OPENING FEE IS INCLUDED AND NOT JUST OURS ──────────────────────
 * Ours is 5 bps. Ostium's own opening fee is 3-10 bps and there is a flat
 * $0.10 oracle fee on top. Showing only our slice would make the trade look
 * cheaper than it is, and the number the user needs is the total that leaves
 * their collateral.
 *
 * `pairOpenFeeBps` is passed in rather than assumed, because it differs per
 * pair and `getPairs()` returns it live. When it is unknown this returns null
 * for the total instead of quietly pretending the venue is free — the same
 * rule the perp funding screen follows.
 */
export function tradeCosts({
  collateralUsd,
  leverage,
  pairOpenFeeBps = null,
  oracleFeeUsd = 0.1,
  bps = BUILDER_BPS
}) {
  const notional = notionalUsd({ collateralUsd, leverage });
  if (notional == null) return null;

  const ourBps = ostiumFeeBps(bps);
  const ourFee = (notional * ourBps) / 10_000;

  const venueBps = pairOpenFeeBps == null ? null : Number(pairOpenFeeBps);
  const venueFee =
    venueBps == null || !Number.isFinite(venueBps) ? null : (notional * venueBps) / 10_000;

  const oracle = Number(oracleFeeUsd);
  const oracleFee = Number.isFinite(oracle) && oracle >= 0 ? oracle : 0;

  return {
    notional,
    ourBps,
    ourFee,
    venueBps,
    venueFee,
    oracleFee,
    /* Null, not a partial sum, when a component is unknown. A total that
       silently omits the venue's own fee is worse than no total. */
    totalFee: venueFee == null ? null : ourFee + venueFee + oracleFee,
    /*
     * The honesty line. Our 5 bps of NOTIONAL at 20x is 1% of what the trader
     * actually put up, and that multiplication is invisible in "5 bps".
     */
    ourFeePctOfCollateral: (ourFee / Number(collateralUsd)) * 100
  };
}

/**
 * Why this trade cannot be submitted, or null when it can.
 *
 * Returns a CODE, not a sentence — the locale files own the wording, and a
 * hard-coded English string here would be untranslatable and would ship in
 * the Persian build.
 *
 * Ordered cheapest-check-first, and deliberately checks the market being
 * closed before the size: telling someone their position is too small when
 * the real problem is that the London market shut an hour ago sends them to
 * fix the wrong thing.
 */
export function validateTrade({
  collateralUsd,
  leverage,
  maxLeverage = null,
  isMarketOpen = true,
  chainId = null
}) {
  if (chainId != null && Number(chainId) !== OSTIUM_CHAIN_ID) return 'WRONG_CHAIN';
  if (!isMarketOpen) return 'MARKET_CLOSED';

  const c = Number(collateralUsd);
  if (!Number.isFinite(c) || c <= 0) return 'NO_AMOUNT';
  if (c < MIN_COLLATERAL_USD) return 'BELOW_MIN';

  const x = Number(leverage);
  if (!Number.isFinite(x) || x <= 0) return 'NO_LEVERAGE';
  /*
   * `maxLeverage` comes from getPairs() and differs per pair (and again
   * overnight). Null means we have not loaded it, and in that case we do NOT
   * invent a ceiling — the contract is authoritative and will reject. What we
   * must not do is let a guessed limit block a legal trade.
   */
  if (maxLeverage != null && Number.isFinite(Number(maxLeverage)) && x > Number(maxLeverage)) {
    return 'LEVERAGE_TOO_HIGH';
  }
  return null;
}

/**
 * Build the unsigned transaction that opens a position.
 *
 * Returns `{ to, data, chainId }`. The caller signs it. This function performs
 * no network I/O and cannot submit.
 *
 * ─── THE PRICE ARGUMENT IS NOT A LIMIT, FOR A MARKET ORDER ──────────────────
 * `price` is the price the order is quoted against; for a market order the
 * contract fills at the oracle price and `slippageBps` bounds how far it may
 * differ. Passing a stale `price` with a tight slippage is how a market order
 * silently cancels, so callers should pass the freshest mid they have.
 */
export async function buildOpenTrade({
  trader,
  pairId,
  buy,
  price,
  collateralUsd,
  leverage,
  takeProfit = '0',
  stopLoss = '0',
  orderType = 'market',
  slippageBps = 25,
  isDayTrade = false,
  bps = BUILDER_BPS
}) {
  const { Interface, parseUnits, isAddress, getAddress } = await loadEthers();

  if (!isAddress(trader)) throw new Error('INVALID_TRADER');

  const builder = builderAddress();
  /*
   * A malformed payout address would encode fine and pay a black hole. This
   * is the one field where being wrong is silent AND permanent, so it is
   * checked here rather than trusted from config.
   */
  if (!isAddress(builder)) throw new Error('INVALID_BUILDER');

  const type = ORDER_TYPE[orderType];
  if (type == null) throw new Error('INVALID_ORDER_TYPE');

  const lev = Number(leverage);
  if (!Number.isFinite(lev) || lev <= 0) throw new Error('INVALID_LEVERAGE');

  const col = Number(collateralUsd);
  if (!Number.isFinite(col) || col < MIN_COLLATERAL_USD) throw new Error('BELOW_MIN');

  const iface = new Interface(OPEN_TRADE_ABI);

  const data = iface.encodeFunctionData('openTrade', [
    {
      /* USDC is 6 decimals; prices and TP/SL are 18. Mixing these up is the
         other factor-of-1e12 way to build a transaction that reverts. */
      collateral: parseUnits(String(collateralUsd), 6),
      openPrice: parseUnits(String(price), 18),
      tp: parseUnits(String(takeProfit ?? '0'), 18),
      sl: parseUnits(String(stopLoss ?? '0'), 18),
      trader: getAddress(trader),
      /* Leverage is scaled by 1e2, so 7.5x is 750. Rounded, because 2.25x
         would otherwise be a non-integer and ethers would throw. */
      leverage: Math.round(lev * 100),
      pairIndex: Number(pairId),
      index: 0,
      buy: Boolean(buy),
      isDayTrade: Boolean(isDayTrade)
    },
    { builder: getAddress(builder), builderFee: feeBpsToContractUnits(ostiumFeeBps(bps)) },
    type,
    Math.round(Number(slippageBps))
  ]);

  return { to: OSTIUM_TRADING, data, chainId: OSTIUM_CHAIN_ID };
}

/** Full or partial market close, verified against SDK 0.7.0 ABI/scaling. */
export async function buildCloseTrade({ pairId, index, closePercent = 100, price, slippageBps = 25 }) {
  const { Interface, parseUnits } = await loadEthers();
  const pct = Number(closePercent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('BAD_CLOSE_PERCENT');
  if (!Number.isFinite(Number(price)) || Number(price) <= 0) throw new Error('BAD_PRICE');
  const iface = new Interface([
    'function closeTradeMarket(uint16 pairIndex,uint8 index,uint16 closePercentage,uint192 marketPrice,uint32 slippageP)'
  ]);
  return {
    to: OSTIUM_TRADING,
    data: iface.encodeFunctionData('closeTradeMarket', [
      Number(pairId), Number(index), Math.round(pct * 100), parseUnits(String(price), 18), Math.round(Number(slippageBps))
    ]),
    chainId: OSTIUM_CHAIN_ID
  };
}

/** Update one risk control at a time, matching the SDK's explicit rule. */
export async function buildModifyPosition({ pairId, index, takeProfit = null, stopLoss = null }) {
  const { Interface, parseUnits } = await loadEthers();
  const hasTp = takeProfit != null && takeProfit !== '';
  const hasSl = stopLoss != null && stopLoss !== '';
  if (hasTp === hasSl) throw new Error('ONE_CHANGE_AT_A_TIME');
  const name = hasTp ? 'updateTp' : 'updateSl';
  const value = hasTp ? takeProfit : stopLoss;
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('BAD_PRICE');
  const iface = new Interface([
    'function updateTp(uint16 pairIndex,uint8 index,uint192 newTp)',
    'function updateSl(uint16 pairIndex,uint8 index,uint192 newSl)'
  ]);
  return {
    to: OSTIUM_TRADING,
    data: iface.encodeFunctionData(name, [Number(pairId), Number(index), parseUnits(String(value), 18)]),
    chainId: OSTIUM_CHAIN_ID
  };
}

/** Positive adds collateral; negative removes it. USDC uses six decimals. */
export async function buildUpdateCollateral({ pairId, index, amountUsd }) {
  const { Interface, parseUnits } = await loadEthers();
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount === 0) throw new Error('BAD_COLLATERAL_CHANGE');
  const name = amount > 0 ? 'topUpCollateral' : 'removeCollateral';
  const iface = new Interface([
    'function topUpCollateral(uint16 pairIndex,uint8 index,uint256 topUpAmount)',
    'function removeCollateral(uint16 pairIndex,uint8 index,uint256 removeAmount)'
  ]);
  return {
    to: OSTIUM_TRADING,
    data: iface.encodeFunctionData(name, [Number(pairId), Number(index), parseUnits(String(Math.abs(amount)), 6)]),
    chainId: OSTIUM_CHAIN_ID,
    needsApproval: amount > 0
  };
}

/**
 * The USDC approval that must land before the first trade ever can.
 *
 * Returns an unsigned `{ to, data }` like `buildOpenTrade`. The spender is
 * TradingStorage and NOT the contract we call — see `OSTIUM_SPENDER`.
 *
 * ─── WHY THIS APPROVES AN EXACT AMOUNT, NOT MaxUint256 ──────────────────────
 * Infinite approval is the industry default and it is the wrong default for a
 * venue this app has just met. An unlimited allowance survives every future
 * upgrade of a contract we do not control; an exact one cannot be drained
 * beyond the trade the user is looking at. The cost is one approval per
 * top-up, which is a real annoyance and still the right trade for collateral.
 */
export async function buildApproveCollateral({ amountUsd }) {
  const { Interface, parseUnits } = await loadEthers();
  const amt = Number(amountUsd);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('INVALID_AMOUNT');

  const iface = new Interface(['function approve(address spender,uint256 amount)']);
  const data = iface.encodeFunctionData('approve', [
    OSTIUM_SPENDER,
    parseUnits(String(amountUsd), 6)
  ]);
  return { to: OSTIUM_COLLATERAL, data, chainId: OSTIUM_CHAIN_ID };
}

/**
 * Live prices, straight from Ostium's keyless market-data API.
 *
 * ─── WHY THIS ONE IS ALLOWED TO BE CLIENT-SIDE ──────────────────────────────
 * The perp and yield screens fetch through our server because their upstream
 * returns the entire universe and would be indefensible on a phone. This
 * response is a few dozen rows — the whole tradable list — so proxying it
 * would add a hop and a cache to save nothing.
 *
 * Returns `{ pairs: [], live: false }` rather than throwing, so a dead feed
 * renders an empty state instead of a crashed screen.
 */
const OSTIUM_SUBGRAPH = `${OSTIUM_API}/v1/subgraph/gn`;

/*
 * The Builder API intentionally keeps /v1/prices small; pair ids, fee rates
 * and leverage limits live in the public subgraph.  We query only the fields
 * the ticket needs instead of shipping the 177 KB SDK merely to render a
 * picker.  The conversion constants below are copied from (and golden-tested
 * against) the SDK: leverage is x100 and takerFeeP is bps x 1e4.
 */
const PAIRS_QUERY = `query FbtOstiumPairs {
  pairs(orderBy: id, orderDirection: asc, subgraphError: allow) {
    id from to maxLeverage overnightMaxLeverage takerFeeP
    group { name maxLeverage }
  }
}`;

const POSITIONS_QUERY = `query FbtOstiumPositions($trader: String!) {
  trades(where: { isOpen: true, trader: $trader }, first: 100, orderBy: timestamp, orderDirection: desc) {
    id tradeID isBuy isDayTrade index collateral tradeNotional leverage
    openPrice stopLossPrice takeProfitPrice timestamp
    pair { id from to }
  }
}`;

const scaled = (value, decimals) => {
  try {
    const raw = BigInt(value ?? 0);
    const base = 10n ** BigInt(decimals);
    return Number(raw / base) + Number(raw % base) / Number(base);
  } catch {
    return 0;
  }
};

async function ostiumGraph(query, variables = {}, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(OSTIUM_SUBGRAPH, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.errors?.length) throw new Error('SUBGRAPH_ERROR');
    return json?.data ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pair metadata merged with the same live bid/mid/ask feed used for signing. */
export async function getOstiumMarkets({ timeout = 12000 } = {}) {
  try {
    const [graph, feed] = await Promise.all([
      ostiumGraph(PAIRS_QUERY, {}, timeout),
      getOstiumPrices({ timeout })
    ]);
    if (!feed.live || !Array.isArray(graph?.pairs)) return { pairs: [], live: false };

    const prices = new Map(
      feed.pairs.map((p) => [
        String(p.pair || `${p.from}/${p.to}`).replace('-', '/').toUpperCase(),
        p
      ])
    );
    const pairs = graph.pairs.map((p) => {
      const from = String(p.from || '').toUpperCase();
      const to = String(p.to || 'USD').toUpperCase();
      const price = prices.get(`${from}/${to}`) || prices.get(`${from}-${to}`);
      const ownMax = Number(p.maxLeverage || 0);
      const groupMax = Number(p.group?.maxLeverage || 0);
      return {
        pairId: String(p.id),
        from,
        to,
        name: `${from}/${to}`,
        category: String(p.group?.name || 'Other'),
        maxLeverage: (ownMax || groupMax) / 100,
        overnightMaxLeverage: Number(p.overnightMaxLeverage || 0) / 100,
        openFeeBps: Number(p.takerFeeP || 0) / 10_000,
        bid: Number(price?.bid),
        mid: Number(price?.mid),
        ask: Number(price?.ask),
        isMarketOpen: price?.isMarketOpen === true,
        isDayTradingClosed: price?.isDayTradingClosed === true,
        timestampSeconds: Number(price?.timestampSeconds || 0)
      };
    }).filter((p) => Number.isFinite(p.mid) && p.mid > 0);
    return { pairs, live: pairs.length > 0, generatedAt: feed.generatedAt };
  } catch {
    return { pairs: [], live: false, generatedAt: null };
  }
}

/**
 * Lightweight account view.  PnL is deliberately not invented here: the SDK
 * projects rollover at the current Arbitrum block, and showing spot-only PnL
 * would overstate the account.  The UI shows entry/current/collateral instead.
 */
export async function getOstiumPositions({ trader, markets = [], timeout = 12000 }) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(trader || ''))) return { positions: [], live: false };
  try {
    const graph = await ostiumGraph(POSITIONS_QUERY, { trader: trader.toLowerCase() }, timeout);
    if (!Array.isArray(graph?.trades)) throw new Error('BAD_SHAPE');
    const byId = new Map(markets.map((m) => [String(m.pairId), m]));
    return {
      live: true,
      positions: graph.trades.map((tr) => {
        const market = byId.get(String(tr.pair?.id));
        return {
          id: tr.id,
          pairId: String(tr.pair?.id),
          index: Number(tr.index || 0),
          name: `${String(tr.pair?.from || '').toUpperCase()}/${String(tr.pair?.to || '').toUpperCase()}`,
          buy: Boolean(tr.isBuy),
          collateral: scaled(tr.collateral, 6),
          leverage: Number(tr.leverage || 0) / 100,
          entryPrice: scaled(tr.openPrice, 18),
          currentPrice: market?.mid ?? null,
          takeProfit: scaled(tr.takeProfitPrice, 18),
          stopLoss: scaled(tr.stopLossPrice, 18),
          openedAt: Number(tr.timestamp || 0) * 1000
        };
      })
    };
  } catch {
    return { positions: [], live: false };
  }
}

export async function getOstiumPrices({ timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${OSTIUM_API}/v1/prices`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.prices)) throw new Error('BAD_SHAPE');
    return {
      pairs: data.prices,
      /* Their own staleness flag, surfaced rather than ignored — a stale
         price behind a leverage button is a liquidation waiting to happen. */
      live: data.stale !== true,
      generatedAt: data.generatedAt ?? null
    };
  } catch {
    return { pairs: [], live: false, generatedAt: null };
  } finally {
    clearTimeout(timer);
  }
}
