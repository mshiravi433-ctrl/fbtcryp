/**
 * FBT FUTURES ENGINE — provider catalogue + status vocabulary (spec §3, §4).
 * ---------------------------------------------------------------------------
 * The STATIC facts about every futures venue the app knows: which chain it
 * settles on, who holds custody, which operations the adapter genuinely
 * implements, and whether an order path exists at all.
 *
 * Nothing here is a claim about *right now* — liveness comes from the
 * server-side registry's health probes (server/futures/registry.js). What this
 * file guarantees is that a venue can never be shown as tradeable when no
 * execution path has been built for it: `execution` is the honest label.
 *
 *   execution: 'ONCHAIN_UNSIGNED_TX'  — the server builds unsigned calldata and
 *                                        the user's wallet signs it (Ostium).
 *   execution: 'CLIENT_SIGNED_SESSION' — the browser derives a venue key from a
 *                                        wallet signature and signs itself
 *                                        (dYdX tab). The server only reads.
 *   execution: 'NOT_BUILT'             — no order path exists. READ or nothing.
 *
 * Centralised exchanges (Binance/Bybit/KuCoin/MEXC…) are deliberately absent:
 * the product rule is no CEX trading APIs, and a catalogue entry is the first
 * step toward one.
 *
 * The On-Chain tab of the Futures engine shows Velocity (Solana) ONLY — the
 * Drift-fork venue FBT is integrating; the provider id is still `drift`. Ostium
 * (Arbitrum) serves stocks/RWA in its own Stocks tab; it is kept in the
 * catalogue for the registry/ledger but is not part of the on-chain futures
 * page.
 */

export const PROVIDER_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  DEGRADED: 'DEGRADED',
  READ_ONLY: 'READ_ONLY',
  UNAVAILABLE: 'UNAVAILABLE',
  MAINTENANCE: 'MAINTENANCE',
  BLOCKED: 'BLOCKED'
});
export const PROVIDER_STATUSES = Object.freeze(Object.values(PROVIDER_STATUS));

/** Statuses under which the router may hand an order to a provider. */
export const EXECUTABLE_STATUSES = Object.freeze([PROVIDER_STATUS.AVAILABLE, PROVIDER_STATUS.DEGRADED]);

export const EXECUTION_MODEL = Object.freeze({
  ONCHAIN_UNSIGNED_TX: 'ONCHAIN_UNSIGNED_TX',
  CLIENT_SIGNED_SESSION: 'CLIENT_SIGNED_SESSION',
  CLIENT_BUILDS_TX: 'CLIENT_BUILDS_TX',
  NOT_BUILT: 'NOT_BUILT'
});

const flags = (overrides = {}) => Object.freeze({
  canReadMarkets: false,
  canReadFunding: false,
  canReadOpenInterest: false,
  canReadPositions: false,
  canQuote: false,
  canPrepare: false,
  canExecute: false,
  canManagePositions: false,
  supportsTakeProfit: false,
  supportsStopLoss: false,
  supportsPartialClose: false,
  supportsCollateralAdjust: false,
  supportsLimitOrders: false,
  supportsReduceOnly: false,
  ...overrides
});

export const PROVIDER_CATALOGUE = Object.freeze({
  ostium: Object.freeze({
    id: 'ostium',
    name: 'Ostium',
    family: 'evm',
    chainId: 42161,
    chainName: 'Arbitrum One',
    custody: 'onchain',
    collateral: 'USDC',
    execution: EXECUTION_MODEL.ONCHAIN_UNSIGNED_TX,
    /* Ostium enforces the builder fee inside the signed transaction and pays it
       atomically on open; there is no claim step. Charged on OPEN only. */
    fbtFeeModel: 'builder-in-calldata',
    fbtFeeChargedOn: 'open',
    venueFeeCapBps: 50,
    markets: ['crypto', 'forex', 'commodities', 'indices', 'stocks', 'etfs'],
    capabilities: flags({
      canReadMarkets: true,
      canReadFunding: true,
      canReadOpenInterest: true,
      canReadPositions: true,
      canQuote: true,
      canPrepare: true,
      canExecute: true,
      canManagePositions: true,
      supportsTakeProfit: true,
      supportsStopLoss: true,
      supportsPartialClose: true,
      supportsCollateralAdjust: true,
      supportsLimitOrders: false,
      supportsReduceOnly: true
    }),
    /* Ostium lives in the Stocks tab (src/pages/Ostium.jsx); it is not part of
       the on-chain futures screen, which shows Drift (Solana) only. */
    tab: null
  }),
  dydx: Object.freeze({
    id: 'dydx',
    name: 'dYdX Chain',
    family: 'cosmos',
    chainId: null,
    chainName: 'dYdX Chain',
    custody: 'onchain',
    collateral: 'USDC',
    execution: EXECUTION_MODEL.CLIENT_SIGNED_SESSION,
    fbtFeeModel: 'builder-code-on-fill',
    fbtFeeChargedOn: 'fill',
    venueFeeCapBps: 100,
    markets: ['crypto'],
    capabilities: flags({
      canReadMarkets: true,
      canReadFunding: true,
      canReadOpenInterest: true,
      canReadPositions: true,
      canQuote: true,
      /* Orders are signed by the in-memory dYdX session in the dYdX tab; the
         server can neither prepare nor broadcast one, so it says so. */
      canPrepare: false,
      canExecute: false,
      canManagePositions: false,
      supportsLimitOrders: true,
      supportsReduceOnly: true
    }),
    tab: 'dydx'
  }),
  gmx: Object.freeze({
    id: 'gmx',
    name: 'GMX',
    family: 'evm',
    chainId: 42161,
    chainName: 'Arbitrum One',
    custody: 'onchain',
    collateral: 'multi',
    execution: EXECUTION_MODEL.NOT_BUILT,
    fbtFeeModel: 'none',
    fbtFeeChargedOn: null,
    venueFeeCapBps: null,
    markets: ['crypto'],
    capabilities: flags(),
    tab: null
  }),
  avantis: Object.freeze({
    id: 'avantis',
    name: 'Avantis',
    family: 'evm',
    chainId: 8453,
    chainName: 'Base',
    custody: 'onchain',
    collateral: 'USDC',
    execution: EXECUTION_MODEL.NOT_BUILT,
    fbtFeeModel: 'none',
    fbtFeeChargedOn: null,
    venueFeeCapBps: null,
    markets: ['crypto', 'forex', 'commodities', 'indices'],
    capabilities: flags(),
    tab: null
  }),
  hyperliquid: Object.freeze({
    id: 'hyperliquid',
    name: 'Hyperliquid',
    family: 'hyperliquid',
    chainId: null,
    chainName: 'Hyperliquid L1',
    custody: 'onchain',
    collateral: 'USDC',
    execution: EXECUTION_MODEL.NOT_BUILT,
    fbtFeeModel: 'none',
    fbtFeeChargedOn: null,
    venueFeeCapBps: 10,
    markets: ['crypto'],
    capabilities: flags(),
    tab: null
  }),
  /* Velocity (Solana) — the venue of the On-Chain futures tab.
     Drift's program was PAUSED; the protocol continues as Velocity Protocol, a
     fork of Drift v2 with its own program ID, its own Data API host
     (data.velocity.exchange) and USDT — not USDC — as the quote asset. The
     public Data API feeds live markets/prices/funding/OI (READ).

     The ORDER path is CLIENT_BUILDS_TX: @drift-labs/sdk was replaced by
     @velocity-exchange/sdk (prebundled to public/vendor/velocity-sdk.js), so
     the tab builds real Velocity instructions against the vELoC1… program —
     initializeUserAccount → USDT deposit → placePerpOrder → cancel/place
     trigger orders — and the CONNECTED WALLET signs and sends every one of
     them (src/lib/velocityTrade.js). FBT never holds a Solana key, so a live
     feed means the venue is genuinely tradeable here.

     The provider id stays `drift` (ledger rows, the UI tab and the tests all
     key off it); only the venue NAME and the facts changed. */
  drift: Object.freeze({
    id: 'drift',
    name: 'Velocity',
    family: 'solana',
    chainId: 'solana:mainnet',
    chainName: 'Solana',
    custody: 'onchain',
    collateral: 'USDT',
    execution: EXECUTION_MODEL.CLIENT_BUILDS_TX,
    fbtFeeModel: 'referrer-on-fill',
    fbtFeeChargedOn: 'fill',
    venueFeeCapBps: 20,
    markets: ['crypto'],
    capabilities: flags({
      canReadMarkets: true,
      canReadFunding: true,
      canReadOpenInterest: true,
      /* positions are decoded client-side by the venue SDK
         (getVelocityPositions → user.getActivePerpPositions + open triggers). */
      canReadPositions: true,
      canQuote: true,
      canPrepare: true,
      canExecute: true,
      /* TP/SL are Velocity reduce-only TRIGGER_MARKET orders; close is a
         reduce-only market order. Partial close / collateral adjust / limit
         orders are not exposed in the UI yet, so they stay false. */
      canManagePositions: true,
      supportsTakeProfit: true,
      supportsStopLoss: true,
      supportsPartialClose: false,
      supportsCollateralAdjust: false,
      supportsLimitOrders: false,
      supportsReduceOnly: true
    }),
    tab: 'onchain'
  })
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDER_CATALOGUE));

/** Names that must never appear as a provider — the no-CEX-trading rule as data. */
export const FORBIDDEN_PROVIDER_IDS = Object.freeze(['binance', 'bybit', 'kucoin', 'mexc', 'okx', 'bitget', 'gate']);

/**
 * Derive a provider status from health facts. Pure, so the registry, the tests
 * and the UI agree on what each word means:
 *
 *   BLOCKED      — an operator kill-switch or policy block (never auto-cleared)
 *   MAINTENANCE  — operator-declared window
 *   UNAVAILABLE  — no execution path built/configured, or no data at all
 *   READ_ONLY    — data answers but orders are not possible here
 *   DEGRADED     — data answers but is stale / partially failing
 *   AVAILABLE    — data live and order path ready
 */
export function resolveProviderStatus({
  execution = EXECUTION_MODEL.NOT_BUILT,
  configured = false,
  enabled = true,
  maintenance = false,
  blocked = false,
  dataLive = false,
  dataStale = false,
  recentErrors = 0
} = {}) {
  if (blocked) return { status: PROVIDER_STATUS.BLOCKED, reason: 'POLICY_BLOCKED' };
  if (maintenance) return { status: PROVIDER_STATUS.MAINTENANCE, reason: 'MAINTENANCE_WINDOW' };
  if (!enabled) return { status: PROVIDER_STATUS.UNAVAILABLE, reason: 'DISABLED_BY_FLAG' };
  if (execution === EXECUTION_MODEL.NOT_BUILT || !configured) {
    return { status: dataLive ? PROVIDER_STATUS.READ_ONLY : PROVIDER_STATUS.UNAVAILABLE, reason: 'NOT_CONFIGURED' };
  }
  if (!dataLive) return { status: PROVIDER_STATUS.UNAVAILABLE, reason: 'FEED_UNAVAILABLE' };
  if (execution === EXECUTION_MODEL.CLIENT_SIGNED_SESSION) {
    /* dYdX signs inside its OWN tab via an in-memory session, so the on-chain
       tab can only read it. */
    return { status: PROVIDER_STATUS.READ_ONLY, reason: 'EXECUTES_IN_OWN_TAB' };
  }
  /* CLIENT_BUILDS_TX (Velocity) builds and signs in THIS tab with the user's own
     wallet, so a live feed means it is genuinely tradeable here. */
  if (recentErrors >= 5) return { status: PROVIDER_STATUS.READ_ONLY, reason: 'ERROR_BUDGET_EXHAUSTED' };
  if (dataStale || recentErrors >= 2) return { status: PROVIDER_STATUS.DEGRADED, reason: dataStale ? 'FEED_STALE' : 'RECENT_ERRORS' };
  return { status: PROVIDER_STATUS.AVAILABLE, reason: null };
}

export const isExecutableStatus = (status) => EXECUTABLE_STATUSES.includes(status);
