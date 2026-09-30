/**
 * PERP ROUTES — which in-app venue settles which pair, and with whose wallet.
 * ---------------------------------------------------------------------------
 *   «توکن ها کاملا قابل معامله نیست … بیشتر جفت توکن ها اصلا نمیشه معامله کرد»
 *   «اصلا باید داخل اپ خودمون انجام شود … ۱۰۰ درصد عملیاتی شود»
 *
 * The perpetual ticket used to know ONE venue (Velocity, four markets, Solana)
 * and treated every other pair as «not listed» — which is how 95% of the
 * catalogue became untradable, and how a connected EVM wallet was handed a
 * Solana-only order and told to «connect a wallet».
 *
 * The app already ships three venues that are signed INSIDE it, none of which
 * ever holds a key:
 *
 *   velocity  Solana    (USDT)   built in the tab, signed by a Solana wallet
 *   ostium    Arbitrum  (USDC)   calldata built by the BFF, signed by an EVM wallet
 *   dydx      dYdX Chain (USDC)  client-signed session derived from an EVM wallet
 *
 * Together they list every pair a trader asks for. This module is the pure
 * half of using them as ONE catalogue: it merges their market lists by base
 * symbol and answers, for a pair and the wallets the user actually has,
 * «which route, and which wallet family does it need?» — so the ticket can
 * pick a route that MATCHES the wallet instead of failing inside the signer.
 *
 * No React, no network, no SDK: everything here is testable with plain data.
 */
import { velocityPerpIndex } from './velocityMarkets.js';

export const ROUTE = Object.freeze({ VELOCITY: 'velocity', OSTIUM: 'ostium', DYDX: 'dydx' });

/** Priority when the user has nothing connected (or both families): the order
 *  a trader would expect — the deepest, cheapest-to-enter venue first. */
export const ROUTE_ORDER = Object.freeze([ROUTE.VELOCITY, ROUTE.OSTIUM, ROUTE.DYDX]);

/**
 * Static facts about each route. `family` decides which wallet can sign it;
 * `collateral` is the asset the order actually spends (the ticket shows THIS,
 * not a chip that only changed a label); `providerId` is the BFF's id for it.
 */
export const ROUTE_META = Object.freeze({
  velocity: Object.freeze({
    id: 'velocity', providerId: 'drift', family: 'solana', collateral: 'USDT',
    chain: 'Solana', chainId: null, minCollateralUsd: 5, builtBy: 'server'
  }),
  ostium: Object.freeze({
    id: 'ostium', providerId: 'ostium', family: 'evm', collateral: 'USDC',
    chain: 'Arbitrum', chainId: 42161, minCollateralUsd: 5, builtBy: 'server'
  }),
  dydx: Object.freeze({
    id: 'dydx', providerId: 'dydx', family: 'evm', collateral: 'USDC',
    chain: 'dYdX Chain', chainId: null, minCollateralUsd: 5, builtBy: 'client'
  })
});

/** Product ceiling — the same one the futures engine enforces. */
export const HARD_MAX_LEVERAGE = 50;

const up = (v) => String(v ?? '').trim().toUpperCase();
const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** `BTC-USD` → `BTC`. Only USD-quoted dYdX perps are offered (every one is). */
export function dydxBase(ticker) {
  const [base, quote] = String(ticker ?? '').toUpperCase().split('-');
  return base && (!quote || quote === 'USD' || quote === 'USDC') ? base : null;
}

/** dYdX's max leverage is 1 / initialMarginFraction (cross margin). */
export function dydxMaxLeverage(market) {
  const imf = Number(market?.raw?.initialMarginFraction);
  return Number.isFinite(imf) && imf > 0 ? Math.max(1, Math.floor(1 / imf)) : null;
}

/** Only CRYPTO rows of the Ostium catalogue: its forex / indices / stocks
 *  tickers must never be matched by symbol against a coin (META, TON…). */
export const isOstiumCrypto = (m) => /crypto/i.test(String(m?.category ?? ''));

/**
 * Merge the venue catalogues into `Map<SYMBOL, { velocity?, ostium?, dydx? }>`.
 * Every route entry is `{ route, base, marketId, mid, maxLeverage, row }`.
 *
 * Velocity's static index is kept as a FALLBACK entry (marketId from the
 * committed table, no price) so the four majors stay routable when the live
 * feed is down — exactly the old behaviour, now one route among three.
 */
export function indexVenueMarkets({ velocity = [], ostium = [], dydx = [] } = {}) {
  const out = new Map();
  const put = (sym, route, entry) => {
    if (!sym) return;
    const cur = out.get(sym) ?? {};
    if (!cur[route]) cur[route] = entry;
    out.set(sym, cur);
  };

  for (const m of velocity ?? []) {
    const base = up(m?.base ?? String(m?.symbol ?? '').split('/')[0]);
    if (!base || m?.marketId == null) continue;
    put(base, ROUTE.VELOCITY, {
      route: ROUTE.VELOCITY, base, marketId: String(m.marketId), mid: positive(m.mid),
      maxLeverage: positive(m.maxLeverage), row: m
    });
  }
  for (const m of ostium ?? []) {
    if (!isOstiumCrypto(m)) continue;
    const base = up(m?.base ?? String(m?.symbol ?? '').split('/')[0]);
    if (!base || m?.marketId == null) continue;
    put(base, ROUTE.OSTIUM, {
      route: ROUTE.OSTIUM, base, marketId: String(m.marketId), mid: positive(m.mid),
      maxLeverage: positive(m.maxLeverage), row: m
    });
  }
  for (const m of dydx ?? []) {
    if (m?.status && m.status !== 'ACTIVE') continue;
    const base = dydxBase(m?.ticker);
    if (!base) continue;
    put(base, ROUTE.DYDX, {
      route: ROUTE.DYDX, base, marketId: String(m.ticker), mid: positive(m.oraclePrice),
      maxLeverage: dydxMaxLeverage(m), row: m
    });
  }

  /* the committed Velocity table — a fallback, never an override */
  for (const base of ['SOL', 'BTC', 'ETH', 'HYPE']) {
    const idx = velocityPerpIndex(base);
    if (idx != null) {
      put(base, ROUTE.VELOCITY, { route: ROUTE.VELOCITY, base, marketId: String(idx), mid: null, maxLeverage: null, row: null, fallback: true });
    }
  }
  return out;
}

/**
 * Pick the route for ONE pair given the wallets the user has.
 *
 *   · a route whose wallet family is connected wins, in ROUTE_ORDER
 *     (so an EVM-only user trading BTC lands on Ostium/dYdX, never on a
 *     Solana-only order they cannot sign);
 *   · with no matching wallet the FIRST listed route is returned and the
 *     caller is told which family it needs — that sentence is what replaces
 *     «connect a wallet» when a wallet IS connected, just the wrong kind;
 *   · an unlisted pair has no route and says so.
 */
export function pickRoute(entry, { solana = false, evm = false } = {}) {
  if (!entry) return { route: null, reason: 'NOT_LISTED', needs: null, options: [] };
  const options = ROUTE_ORDER.filter((r) => entry[r]);
  if (!options.length) return { route: null, reason: 'NOT_LISTED', needs: null, options };
  const have = { solana: Boolean(solana), evm: Boolean(evm) };
  const signable = options.find((r) => have[ROUTE_META[r].family]);
  if (signable) return { route: signable, reason: null, needs: null, options };
  /* Nothing signable. The app's own wallet is an EVM wallet, so when the pair
     has an EVM route that is the one offered to someone with no wallet yet —
     «connect wallet» then opens the in-app wallet sheet, not a Solana app. */
  const first = options.find((r) => ROUTE_META[r].family === 'evm') ?? options[0];
  return { route: first, reason: 'NEEDS_WALLET', needs: ROUTE_META[first].family, options };
}

/** Leverage ceiling for a ticket: the venue's own cap, never above the product's. */
export function leverageCeiling(entry) {
  const own = positive(entry?.maxLeverage);
  return Math.max(1, Math.min(HARD_MAX_LEVERAGE, own ?? HARD_MAX_LEVERAGE));
}

/**
 * dYdX order size in BASE units: notional ÷ price, rounded DOWN to the
 * market's step (stepBaseQuantums × 10^atomicResolution). An order the venue
 * would have to round is an order the user did not review; a notional smaller
 * than one step is «below the minimum», reported as null.
 */
export function dydxOrderSize({ notionalUsd, price, market } = {}) {
  const p = positive(price);
  const n = positive(notionalUsd);
  if (!p || !n) return null;
  let qty = n / p;
  const res = Number(market?.atomicResolution);
  const stepQuantums = Number(market?.stepBaseQuantums);
  let decimals = 8;
  if (Number.isFinite(res) && Number.isFinite(stepQuantums) && stepQuantums > 0) {
    const step = stepQuantums * 10 ** res;
    if (step > 0) {
      /* 500 / 0.00001 is 49999999.99999999 in floating point: a ratio within
         rounding noise of a whole step IS that step, anything else floors. */
      const ratio = qty / step;
      const nearest = Math.round(ratio);
      const steps = Math.abs(ratio - nearest) <= Math.max(1e-9, ratio * 1e-12) ? nearest : Math.floor(ratio);
      qty = steps * step;
      decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    }
  }
  const out = Number(qty.toFixed(Math.min(decimals, 12)));
  return out > 0 ? out : null;
}

/** Codes of the ticket's own flow that are not in the futures engine's table
 *  but DO have a sentence (perp.terminal.err.*). */
export const PERP_OWN_ERRORS = Object.freeze([
  'TX_TOO_LARGE', 'CANNOT_SIGN', 'NO_SIGNATURE', 'NO_POSITION', 'BROADCAST_FAILED', 'SIGN_FAILED', 'SOLANA_CONNECT_FAILED'
]);

/** A dYdX order failure → the `dydx:`-prefixed code the UI has a sentence for. */
export function classifyDydxOrderError(err) {
  const raw = String(err?.code ?? '');
  const msg = String(err?.message ?? err ?? '');
  if (raw.startsWith('dydx:')) return raw;
  if (raw === 'USER_REJECTED' || /reject|denied|cancell?ed|4001/i.test(msg)) return 'USER_REJECTED';
  if (raw === 'BELOW_MIN' || raw === 'MARKET_NOT_LISTED') return raw;
  if (/insufficient|does not exist|not found|collateral|undercollateral/i.test(msg)) return 'dydx:NO_COLLATERAL';
  const known = msg.match(/^(NOT_CONNECTED|BAD_SIZE|BAD_SLIPPAGE|BAD_MARKET|VALIDATOR_UNREACHABLE)$/);
  if (known) return `dydx:${known[1]}`;
  return 'dydx:ORDER_FAILED';
}
