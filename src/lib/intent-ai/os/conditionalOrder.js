/**
 * FBT INTENT OS — CONDITIONAL ORDER BRIDGE.
 * ---------------------------------------------------------------------------
 * Turns «اگر BTC به 100000 رسید بخر» into a REAL stored order that appears on
 * /orders and is watched by the same server-side watcher as every other limit
 * order (src/lib/orders.js + server/watch.js).
 *
 * The app is non-custodial and has no server signer, so the order is an HONEST
 * conditional alert/watch: when the price condition is met the user is
 * notified and one tap takes them to the swap screen with the pair pre-filled
 * (that is exactly what the Orders screen already does for a hand-made order).
 * This file never claims a fill happened.
 *
 * Pure parts are separated so the probe can test them without DOM/storage.
 */

import { createOrder, addOrder, validateOrder, loadOrders, syncWatches } from '../../orders.js';

export const CONDITIONAL_ORDER_DEFAULTS = Object.freeze({
  chainId: 42161, // Arbitrum — the app default for quotes/orders
  amountUsd: 100,
  expiryDays: 30
});

/**
 * Curated token table for order legs (symbol → the fields the order engine
 * needs: symbol + coingeckoId for the server watcher). Kept local — the full
 * chains.js table is browser-bundled and pulls in code that would make this
 * module unimportable in Node probes. Ids are the same CoinGecko ids chains.js
 * uses for these assets.
 */
const ORDER_TOKENS = Object.freeze({
  1: {
    USDT: { symbol: 'USDT', coingeckoId: 'tether' },
    WBTC: { symbol: 'WBTC', coingeckoId: 'bitcoin' },
    ETH: { symbol: 'ETH', coingeckoId: 'ethereum' },
    LINK: { symbol: 'LINK', coingeckoId: 'chainlink' },
    UNI: { symbol: 'UNI', coingeckoId: 'uniswap' }
  },
  42161: {
    USDT: { symbol: 'USDT', coingeckoId: 'tether' },
    USDC: { symbol: 'USDC', coingeckoId: 'usd-coin' },
    WBTC: { symbol: 'WBTC', coingeckoId: 'bitcoin' },
    ETH: { symbol: 'ETH', coingeckoId: 'ethereum' },
    ARB: { symbol: 'ARB', coingeckoId: 'arbitrum' },
    LINK: { symbol: 'LINK', coingeckoId: 'chainlink' },
    AAVE: { symbol: 'AAVE', coingeckoId: 'aave' },
    DAI: { symbol: 'DAI', coingeckoId: 'dai' }
  },
  56: {
    USDT: { symbol: 'USDT', coingeckoId: 'tether' },
    BNB: { symbol: 'BNB', coingeckoId: 'binancecoin' },
    ETH: { symbol: 'ETH', coingeckoId: 'ethereum' }
  },
  8453: {
    USDC: { symbol: 'USDC', coingeckoId: 'usd-coin' },
    ETH: { symbol: 'ETH', coingeckoId: 'ethereum' },
    cbBTC: { symbol: 'cbBTC', coingeckoId: 'bitcoin' }
  },
  137: {
    USDT: { symbol: 'USDT', coingeckoId: 'tether' },
    USDC: { symbol: 'USDC', coingeckoId: 'usd-coin' },
    ETH: { symbol: 'ETH', coingeckoId: 'ethereum' },
    MATIC: { symbol: 'MATIC', coingeckoId: 'matic-network' },
    POL: { symbol: 'POL', coingeckoId: 'matic-network' }
  }
});

const CHAIN_NAMES = Object.freeze({
  1: 'Ethereum', 42161: 'Arbitrum', 56: 'BNB Chain', 8453: 'Base', 137: 'Polygon', 10: 'Optimism', 43114: 'Avalanche'
});

/** Asset → token object on the supported order chains. */
export function tokenForAsset(asset, chainId = CONDITIONAL_ORDER_DEFAULTS.chainId) {
  const sym = String(asset || '').toUpperCase();
  const rows = ORDER_TOKENS[Number(chainId)] || {};
  return rows[sym] || rows[sym === 'BTC' ? 'WBTC' : sym] || null;
}

/** The stablecoin leg of a buy order on the given chain. */
export function stableTokenForChain(chainId, prefer = 'USDT') {
  const rows = ORDER_TOKENS[Number(chainId)] || {};
  return rows[prefer] || rows.USDC || rows.DAI || null;
}

export function isEVMChain(chainId) {
  return Boolean(CHAIN_NAMES[Number(chainId)]);
}

/**
 * Pure parse of a Persian/English conditional-buy sentence.
 *
 * Examples:
 *   «اگر BTC به 100000 رسید بخر»        → { asset:'BTC', operator:'BELOW', target:100000, amountUsd:100 }
 *   «اگر ETH کمتر از 3000 شد 100 دلار بخر»
 *   «when BTC hits 100k, buy 50 USD»    → BELOW (buy on dip)
 *   «اگر BTC بالای 120000 شد 200 دلار بخر» → ABOVE (momentum buy)
 *
 * Only "buy" is modelled here; sell/swap conditions belong to the full Orders
 * form and must not be half-built by the AI (a wrong side fills at the wrong
 * time). Returns { order:input } or { error }.
 */
export function parseConditionalBuy(text, { chainId = CONDITIONAL_ORDER_DEFAULTS.chainId, amountUsd = null } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'EMPTY' };

  const assetHints = [
    ['btc', 'BTC'], ['bitcoin', 'BTC'], ['بیت‌کوین', 'BTC'], ['بیتکوین', 'BTC'], ['بیت کوین', 'BTC'],
    ['eth', 'ETH'], ['ethereum', 'ETH'], ['اتریوم', 'ETH'], ['اتريم', 'ETH'], ['اتیريوم', 'ETH'],
    ['sol', 'SOL'], ['solana', 'SOL'], ['سولانا', 'SOL'],
    ['bnb', 'BNB'], ['binance', 'BNB'], ['بایننس', 'BNB'],
    ['arb', 'ARB'], ['arbitrum', 'ARB'], ['ارب', 'ARB'],
    ['avax', 'AVAX'], ['avalanche', 'AVAX'], ['link', 'LINK'], ['chainlink', 'LINK'],
    ['doge', 'DOGE'], ['dogecoin', 'DOGE'], ['matic', 'MATIC'], ['polygon', 'MATIC']
  ];
  let asset = null;
  for (const [k, v] of assetHints) {
    if (new RegExp(`(^|[^a-z0-9])${k}($|[^a-z0-9])`, 'i').test(raw)) { asset = v; break; }
  }
  if (!asset) return { error: 'NO_ASSET' };
  // Sole-chain order engine: Solana asset would be dishonest to fake.
  if (asset === 'SOL') return { error: 'SOLANA_ORDERS_UNAVAILABLE', asset };
  if (!isEVMChain(chainId)) return { error: 'BAD_CHAIN', asset };

  const numFrom = (m) => {
    if (!m) return null;
    const fa = m.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const n = parseFloat(fa.replace(/[kK,]/g, ''));
    if (!Number.isFinite(n)) return null;
    return /k|K/.test(m) ? n * 1000 : n;
  };

  const above = raw.match(/(?:بالاتر|بالای|بیشتر از|بیشتر|فوق|بیش از|above|over|≥|>)\s*([0-9۰-۹.,kK]+)/i);
  const below = raw.match(/(?:کمتر از|کمتر|پایین‌تر از|پایین‌تر|زیر|below|under|≤|<|به)\s*([0-9۰-۹.,kK]+)/i);
  const target = numFrom(above?.[1] || below?.[1]);
  if (!target || target <= 0) return { error: 'NO_TARGET', asset };

  const amtMatch = raw.match(/([0-9۰-۹.,]+)\s*(?:دلار|\$|usd|dollar)/i);
  const amount = numFrom(amtMatch?.[1]) || Number(amountUsd) || CONDITIONAL_ORDER_DEFAULTS.amountUsd;
  if (amount <= 0) return { error: 'BAD_AMOUNT', asset };

  const isBuy = /بخر|buy|خرید/i.test(raw);
  if (!isBuy) return { error: 'NOT_BUY', asset };

  /**
   * "به 100000 رسید بخر" is a BUY-THE-DIP: buy when the asset falls to the
   * target (BELOW). Explicit "بالای/بیش از" with buy is a breakout buy (ABOVE).
   * A bare "رسید" (reached) with no direction is treated as the dip case the
   * user's example names, and the preview says so.
   */
  const direction = above ? 'ABOVE' : 'BELOW';

  return {
    order: {
      type: 'limit',
      chainId,
      asset,
      fromSymbol: 'USDT',
      toSymbol: asset,
      targetRate: target,
      direction,
      priceOf: 'to', // target is "1 USD = X asset" → observed rate = b/a inverted; priceOf 'to' means user priced in the TO token
      amountIn: String(amount),
      expiryDays: CONDITIONAL_ORDER_DEFAULTS.expiryDays
    },
    asset,
    direction,
    target,
    amount
  };
}

/**
 * Build a real stored order from a parsed condition. Returns
 * { order, added, syncStatus } or { error }.
 */
export function createConditionalOrder(parsed, { chainId = CONDITIONAL_ORDER_DEFAULTS.chainId } = {}) {
  const input = parsed?.order || parsed;
  if (!input?.type) return { error: 'NO_ORDER' };

  const asset = tokenForAsset(input.asset || input.toSymbol, chainId);
  if (!asset) return { error: 'UNSUPPORTED_ASSET', asset: input.asset || input.toSymbol };
  const stable = stableTokenForChain(chainId);
  if (!stable) return { error: 'NO_STABLE_LEG' };

  const built = createOrder({
    type: 'limit',
    chainId,
    fromToken: stable,
    toToken: asset,
    amountIn: String(input.amountIn ?? '100'),
    targetRate: Number(input.targetRate),
    direction: String(input.direction || 'BELOW').toLowerCase() === 'above' ? 'above' : 'below',
    priceOf: 'to',
    expiryDays: Number(input.expiryDays) || CONDITIONAL_ORDER_DEFAULTS.expiryDays
  });
  if (built.error) return { error: built.error };

  const validation = validateOrder(built.order);
  if (validation) return { error: validation };

  const added = addOrder(built.order);
  if (added.error) return { error: added.error };

  return {
    order: built.order,
    added: true,
    visibleOn: '/orders',
    watchSync: 'pending' // set after syncWatches below
  };
}

/** Fire the background-watch sync; best-effort, never blocks the order. */
export async function syncOrderWatches() {
  try {
    await syncWatches(loadOrders());
    return 'synced';
  } catch {
    return 'unsynced';
  }
}

/**
 * Build the confirmation preview for the chat. Pure — numbers the user will
 * confirm before anything is saved.
 */
export function orderPreview(parsed, { chainId = CONDITIONAL_ORDER_DEFAULTS.chainId } = {}) {
  const asset = tokenForAsset(parsed?.asset, chainId);
  if (!asset) return { status: 'UNAVAILABLE', reason: 'UNSUPPORTED_ASSET' };
  const stable = stableTokenForChain(chainId);
  const chain = { name: CHAIN_NAMES[Number(chainId)] || String(chainId) };
  return {
    status: 'READY',
    kind: 'CONDITIONAL_BUY',
    title: `${parsed.asset} buy when ${parsed.operator === 'ABOVE' ? '≥' : '≤'} ${parsed.target} USD`,
    rows: [
      { key: 'asset', value: parsed.asset },
      { key: 'condition', value: `${parsed.operator === 'ABOVE' ? 'above' : 'below'} ${parsed.target} USD` },
      { key: 'amount', value: `${parsed.amount} USD (${stable?.symbol || 'USDT'})` },
      { key: 'network', value: chain?.name || String(chainId) },
      { key: 'execution', value: 'alert + one-tap swap (no custody, server never signs)' },
      { key: 'risk', value: 'INFORMATIONAL — conditions are not guaranteed to trigger' }
    ],
    order: {
      type: 'limit',
      chainId,
      fromSymbol: stable?.symbol || 'USDT',
      toSymbol: asset.symbol,
      targetRate: parsed.target,
      direction: parsed.operator === 'ABOVE' ? 'above' : 'below',
      priceOf: 'to',
      amountIn: String(parsed.amount)
    }
  };
}
