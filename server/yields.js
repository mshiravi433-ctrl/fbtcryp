/**
 * LIVE YIELD DATA — real APYs, from DefiLlama, filtered for safety.
 * ---------------------------------------------------------------------------
 * ─── WHAT THE FARM SCREEN USED TO BE ────────────────────────────────────────
 * Four hard-coded pools with hand-written APR *ranges* ("15–40%"). The ranges
 * were honest about being ranges, but they were also written months ago and
 * had no relationship to what those pools actually pay today. A yield figure
 * that does not move is not a yield figure, and "15–40%" is wide enough to be
 * unfalsifiable, which is worse than being wrong.
 *
 * ─── WHY THIS RUNS ON THE SERVER ────────────────────────────────────────────
 * `https://yields.llama.fi/pools` is free and needs no key, which is why it is
 * usable at all here — but the response is every pool DefiLlama tracks, north
 * of 20,000 of them and several megabytes. Sending that to a phone on an
 * Iranian mobile connection to display eight rows would be indefensible.
 *
 * So the server fetches it, filters it down to a bounded list and caches the
 * result for an hour. At most 500 safety-filtered rows reach the client; the
 * screen renders them in pages, never the raw upstream dump.
 *
 * ─── THE SAFETY FILTER IS THE ENTIRE VALUE OF THIS FILE ─────────────────────
 * An unfiltered yield list is how people lose everything. Anyone can deploy a
 * pool advertising 90,000% APR paid in a token that cannot be sold, and it
 * will sit at the top of any list sorted by APY. Sorting by yield is, quite
 * literally, sorting by scam.
 *
 * Every rule below exists to stop that, and each one is explained where it is
 * applied rather than here.
 */

const LLAMA_YIELDS = 'https://yields.llama.fi/pools';

/*
 * Direct free Kamino Solana upstream (verified live 2026-10-26 against
 * https://api.kamino.finance — public JSON, no API key, no cost).
 *
 * Main Market (`7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`, SOL/BTC Market
 * on Solana mainnet-beta) exposes per-reserve supply/borrow USD and supply APY
 * on `/reserves/metrics` plus daily history on `/reserves/:reserve/metrics/history`.
 * Every mapped Kamino reserve passes through the EXACT same `isEligible()`
 * safety gates as DefiLlama rows ($5m withdrawable TVL floor, 0.5%–60% APY
 * band, 70% emission ceiling) and deduplicates against `kamino-lend` rows
 * already emitted by DefiLlama for the same Main Market mint.
 */
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const KAMINO_RESERVES_URL = `https://api.kamino.finance/kamino-market/${KAMINO_MAIN_MARKET}/reserves/metrics?env=mainnet-beta`;
const kaminoReserveHistoryUrl = (reserve) =>
  `https://api.kamino.finance/kamino-market/${KAMINO_MAIN_MARKET}/reserves/${encodeURIComponent(reserve)}/metrics/history?env=mainnet-beta&frequency=day`;
const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LLAMA_POOL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KAMINO_POOL_ID_RE = /^kamino-([1-9A-HJ-NP-Za-km-z]{32,44})$/;

/*
 * Mint-verified Solana USD stablecoins used when mapping direct Kamino
 * `/reserves/metrics` rows (which report `liquidityTokenMint` rather than a
 * boolean `stablecoin` flag). Never classify stablecoins by symbol substring.
 */
const KAMINO_USD_STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (Circle)
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT (Tether)
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD (PayPal USD)
  '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', // USDG (Global Dollar)
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',  // USDS (Sky Dollar)
  '9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u', // FDUSD (First Digital USD)
]);

const configuredTimeout = Number(process.env.UPSTREAM_TIMEOUT_MS);
const TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 30_000) : 12_000;

// Missing metrics are unknown, not zero (Number(null) === 0).
const metric = (value) => {
  if (value == null || (typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const rounded = (value, precision = 10) => {
  const n = metric(value);
  return n == null ? null : Math.round(n * precision) / precision;
};

/**
 * PROTOCOL ALLOW-LIST.
 *
 * Not a blocklist. A blocklist is unwinnable: new protocols appear daily and
 * you would be permanently one step behind whoever deployed this morning.
 *
 * These are protocols that have held nine or ten figures of deposits for
 * years, have been audited repeatedly, and — the part that actually matters —
 * have survived at least one major market crash without an insolvency. That
 * last criterion excludes a great many things that look respectable on a
 * dashboard.
 *
 * Being on this list is NOT a safety guarantee and the UI never says it is.
 * Aave, Compound and Curve have all had incidents. It means "large, old,
 * heavily reviewed", which is the strongest honest statement available about
 * a smart contract holding someone's money.
 */
const ALLOWED_PROJECTS = new Set([
  // lending
  'aave-v3',
  'compound-v3',
  'morpho-blue',
  'venus-core-pool',
  'sparklend',
  /*
   * ─── spark-savings — added 2026-10-26, replacing dead 'spark' slug ───────
   * Slug verified against github.com/DefiLlama/yield-server
   *   src/adaptors/spark-savings/index.ts (`project: 'spark-savings'`, chains
   *   ethereum, avax, base, arbitrum, robinhood).
   * Live feed 2026-10-26 (yields.llama.fi/pools):
   *   - Ethereum USDT (`a5d67f7e-5b51-4a9d-969d-caf051a7f5a4`): $647.95m @ 3.75% apyBase
   *   - Arbitrum USDS (`9d499222-a01a-45bb-bbc9-f01c7923693b`): $364.26m @ 3.80% apyBase
   *   - Ethereum USDC (`c5c74dd1-995c-4445-9d84-3e710bad7d52`): $295.29m @ 3.80% apyBase
   * Pinned in test/wiring.mjs SLUG_EVIDENCE.
   */
  'spark-savings',
  // liquid staking — the least complex thing in DeFi and the easiest to explain
  'lido',
  'rocket-pool',
  'binance-staked-eth',
  'ether.fi-stake',
  'jito-liquid-staking',
  'marinade-liquid-staking',
  // major AMMs
  'curve-dex',
  'uniswap-v3',
  /*
   * ─── uniswap-v4 — added 2026-08-24, verified against the real sources ───
   * Slug: DefiLlama's yield-server uses the adapter FOLDER NAME as the
   * `project` slug (its README says the adapter test fails on any mismatch),
   * and the adapter at
   *   github.com/DefiLlama/yield-server  src/adaptors/uniswap-v4/index.js
   * (master, read 2026-08-24) emits `project: 'uniswap-v4'` for chains
   * ethereum, base, arbitrum, polygon, unichain, bsc, avax, optimism.
   * Data shape: symbol is "TOKEN0-TOKEN1" (get-pair works), `apyBase` only
   * with no `apyReward`, so the 70% emission ceiling cannot fire.
   * Live feed the same day (yields.llama.fi/pools): ETH-WBTC 15.2m @ 5.86%,
   * ETH-USDC (Arbitrum) 18.2m @ 10.25%, ETH-AZTEC 15.4m @ 1.08%,
   * SYRUPUSDC-USDC 13.3m @ 1.45% — several pools clear MIN_TVL, so the
   * screen is not empty. test/wiring.mjs pins this evidence and fails if
   * the slug ever drifts from it.
   */
  'uniswap-v4',
  'pancakeswap-amm',
  'pancakeswap-amm-v3',
  'balancer-v2',
  'aerodrome-slipstream',
  /*
   * ─── CONSIDERED AND REJECTED (do not add without re-checking) ────────────
   *
   * 'meteora' — the adapter is broken, and has never worked. Its ONLY commit
   * (2025-01-23, "rename resolv") left `p.pool_token_mints` and `apyReward`
   * referencing undefined variables, so `apy()` throws a ReferenceError on
   * every run and the server can have stored no `project: 'meteora'` pool
   * since. Re-verified against master on 2026-10-26 (still broken, plus URLs
   * copied from raydium.io); `meteora-dlmm` and `ajna` are not present in the
   * repo at all. A slug with no data behind it would only look like we list
   * Meteora when we do not.
   *
   * 'ajna-v2' — two independent problems, either one enough to stay out
   * (re-verified on master 2026-10-26):
   *   1. WRONG LABEL ON THE WRONG ASSET. The adapter puts the COLLATERAL
   *      token in `symbol` (e.g. "WBTC") while the token a depositor
   *      actually lends is the quote in `mintedCoin`/`borrowToken`, and
   *      `underlyingTokens` lists the collateral only. Our riskBand() would
   *      then render a USDC-lending pool as "WBTC · low" — the exact
   *      mislabel this app exists to refuse.
   *   2. NOTHING PASSES THE FLOOR. Every tracked pool sits well below MIN_TVL.
   *
   * ─── 2026-10-26 AUDIT: DEAD SLUGS REMOVED & BROKEN ADAPTERS REJECTED ─────
   * Full audit of all 40 prior slugs against DefiLlama/yield-server master
   * (`src/adaptors/*`) and live `yields.llama.fi/pools` + `poolsEnriched`:
   *
   *   • Dead non-existent slugs removed (matched 0 pools because no adapter
   *     folder exists under these names):
   *       'kamino'     → replaced by 'kamino-lend' + 'kamino-liquidity' + direct api.kamino.finance
   *       'raydium'    → replaced by 'raydium-amm'
   *       'orca'       → replaced by 'orca-dex'
   *       'spark'      → replaced by 'spark-savings' ('sparklend' already present)
   *       'benqi'      → replaced by 'benqi-lending' + 'benqi-staked-avax'
   *       'stargate'   → removed; 'stargate-v1' also REJECTED (see below)
   *       'pendle'     → removed; 'pendle-v2' also REJECTED (see below)
   *       'gmx'        → removed; 'gmx-evm' / 'gmx-v1-perps' / 'gmx-solana' REJECTED (see below)
   *       'eigenlayer' → removed (no native restaking yield adapter in yield-server;
   *                      liquid restaking is already represented by 'ether.fi-stake')
   *
   *   • 'stargate-v1' — REJECTED: `src/adaptors/stargate-v1/index.js` sets
   *     `apyReward` only (`apyBase` undefined -> 100% emission share > 70%
   *     ceiling), uses `'Binance'` chain name instead of `'BSC'`, and live V1
   *     pools sit at 0.00% APY / <$300k TVL after V2 migration (`stargate-v2`
   *     has no yield-server adapter).
   *   • 'pendle-v2' — REJECTED: `src/adaptors/pendle-v2/index.js` mixes
   *     fixed-maturity Principal Tokens (`poolMeta: '(PT) ...'`) and expiring
   *     SY/PT LPs whose principal matures on a calendar date; unsafe to mix
   *     into a perpetual/spot yield board without maturity-date UX guards.
   *   • 'gmx-evm' / 'gmx-v1-perps' / 'gmx-solana' — REJECTED: `poolsEnriched`
   *     for GMX V2 (`99fbac4c-b8ab-4abb-b83e-6b280a17b93c`) returned `data: []`
   *     on 2026-10-26, and GM/GLP vaults carry directional trader-PnL
   *     counterparty exposure rather than passive lending or spot swap fees.
   *   • 'seamless-v2' — REJECTED: `src/adaptors/seamless-v2/index.js` tracks
   *     leveraged collateral/debt `LeverageToken` loops (`LeverageManager`),
   *     not passive spot lending.
   *   • 'radiant-v2' — REJECTED: `src/adaptors/radiant-v2/index.js` writes a
   *     raw contract address into `url` and markets remain deprecated post-Oct
   *     2024 exploit.
   */
  // stablecoin yield with a real, explainable source
  'sky-lending',
  'ethena-usde',
  'maple',
  // battle-tested lending + second-generation money markets
  'aave-v2',
  'benqi-lending',
  'benqi-staked-avax',
  // auto-compounding vaults — these make the Farm "vault" filter real
  'yearn-finance',
  'convex-finance',
  'beefy',
  // Solana liquid staking & lending — verified against DefiLlama/yield-server + live feed 2026-10-26:
  //   • kamino-lend        src/adaptors/kamino-lend/index.js        (SOL 525b2dab...: $19.17m avail @ 5.22% apyBase)
  //   • kamino-liquidity   src/adaptors/kamino-liquidity/index.js   (automated CLMM vaults on Solana; apyBase from 24h vault fees)
  //   • jupiter-lend       src/adaptors/jupiter-lend/index.js       (USDC Earn d783c8df...: $493.75m @ 4.96% apyBase; PYUSD $251.29m @ 3.92%)
  //   • save               src/adaptors/save/index.js               (Solana lending; adapter filters !isFullyBorrowed bad-debt reserves)
  //   • binance-staked-sol src/adaptors/binance-staked-sol/index.js (BNSOL 9e709e57...: $1.061b @ 4.51% apyBase)
  //   • drift-staked-sol   src/adaptors/drift-staked-sol/index.js   (DSOL 296651fc...: $279.88m @ 4.87% apyBase)
  //   • raydium-amm        src/adaptors/raydium-amm/index.js        (Solana AMM/CLMM; symbol A-B, apyBase from 24h swap fees)
  //   • orca-dex           src/adaptors/orca-dex/index.ts           (Solana Whirlpools; PYUSD-USDC 99203560...: $16.45m TVL)
  'jupiter-staked-sol',
  'blazestake',
  'sanctum-infinity',
  'helius-staked-sol',
  'binance-staked-sol',
  'drift-staked-sol',
  'kamino-lend',
  'kamino-liquidity',
  'jupiter-lend',
  'save',
  'raydium-amm',
  'orca-dex',
  // long-running AMMs / stablecoin-adjacent yield with explainable sources
  'sushiswap',
  'frax'
]);

/**
 * Chains we already support in the app.
 *
 * Listing a pool on a chain the user cannot reach from here is a dead end —
 * they tap through, discover they need a different wallet setup, and the
 * screen has wasted their time. Solana is included because the app has a
 * dedicated Solana swap screen. Linea and Sonic are included because the
 * swap registry (lib/chains.js TOKENS) and the yield chain map
 * (lib/yields.js LLAMA_CHAIN_IDS) both already cover them — a pool there
 * resolves to a real in-app swap route instead of a dead end.
 */
const ALLOWED_CHAINS = new Set([
  'Ethereum',
  'BSC',
  'Polygon',
  'Arbitrum',
  'Optimism',
  'Base',
  'Avalanche',
  'Solana',
  'Linea',
  'Sonic'
]);

/**
 * FLOORS AND CEILINGS.
 *
 * MIN_TVL — $5m (lowered from $10m on 2026-09-06 so the Farm screen lists
 * more investable pools). Below this a pool can be drained or exited by one
 * whale, and the APY figure is computed on a base too small to be stable.
 * The floor is still the single most effective scam filter available — a
 * fake pool almost never has millions of real deposits in it — and it now
 * works together with the protocol allow-list above: a pool must BOTH sit
 * in a large audited protocol AND clear $5m. The unit fixtures (a $900k
 * pool and a $4m pool, both rejected) still pin this boundary.
 *
 * MAX_APY — 60%. This is the rule people argue with, so: any sustainable
 * yield is paid out of real revenue (borrowing interest, swap fees, staking
 * rewards). Real revenue does not produce 200% a year. Anything above this
 * threshold is being paid in freshly-minted governance tokens whose price is
 * falling faster than the yield accrues, and the headline number is a
 * countdown rather than an income. Excluding them costs us the most
 * eye-catching rows on the screen, which is exactly the point.
 *
 * MIN_APY — 0.5%. A pool paying less than this is not a yield opportunity,
 * it is a line of noise between the user and something useful.
 */
const MIN_TVL = 5_000_000;
const MAX_APY = 60;
const MIN_APY = 0.5;

/**
 * How much of the yield may come from token emissions.
 *
 * `apyBase` is yield from the underlying activity — interest actually paid by
 * borrowers, fees actually paid by traders. `apyReward` is protocol tokens
 * minted and handed out. The second kind stops the day the incentive
 * programme ends, and the tokens are usually falling in price the whole time.
 *
 * A pool that is 90% emissions is an advertisement, not an investment. We
 * allow up to 70% because a large part of real DeFi yield genuinely is
 * incentivised and excluding all of it would leave a very short list — but
 * the split is passed to the client and shown, so the user can see how much
 * of the number is real.
 */
const MAX_EMISSION_SHARE = 0.7;

/**
 * ─── THE FIVE EXECUTION VENUES ARE PINNED, NOT FILTERED ──────────────────────
 * Reported as: «در The five venues, side by side فقط ۳ تاش از ۵ تا لایوه» —
 * the Farm's venue rail advertises five venues and only three of them carried
 * a live rate.
 *
 * The rail was never the problem. It is derived from this feed, and this feed
 * is a DISCOVERY list with a floor under it: MIN_APY (0.5%), MIN_TVL ($5m) and
 * a 500-row cap ranked by score. Those gates are right for a list of 4 000
 * anonymous pools — they are what stops a 90 000% scam token from topping the
 * screen. They are wrong for the five markets this app can actually sign for,
 * because a venue that exists, that we transact, and that pays 0.4% this week
 * is not a discovery candidate; it is a fact about a product we ship.
 *
 * The Morpho case is the concrete one, read off the live feed on 2026-09-14
 * (yields.llama.fi/poolsEnriched?pool=7d33d57d-…): tvlUsd 2 940 374 905,
 * apy 0, apyMean30d 0, outlier false. A $2.9bn market paying exactly nothing
 * because nobody is borrowing it — and MIN_APY turned that honest zero into a
 * missing row, which the rail then rendered as an em-dash. An em-dash reads
 * as "we could not look", not as "it pays 0%". The zero is the better answer.
 *
 * So pinned rows are returned in their OWN field (`venues`) rather than being
 * pushed into `pools`: the discovery list keeps every one of its gates, and a
 * 0% market never appears among the "investable" recommendations. The rail
 * reads `venues` first and falls back to `pools`.
 *
 * ─── WHAT IS STILL CHECKED ON A PINNED ROW ──────────────────────────────────
 * Pinning skips the RANKING gates, not the honesty gates. A pinned row must
 * still have a real UUID and symbol, must not carry DefiLlama's own outlier
 * flag, and its rate must be inside 0–100% — a lending market reporting 400%
 * is a feed glitch, and publishing it under our own brand would be worse than
 * publishing nothing. Nothing here is ever invented: a pin the feed does not
 * contain is reported in `venuesMissing`, and the rail shows an em-dash.
 *
 * ─── WHY THIS TABLE LIVES HERE AND NOT ONLY IN THE CLIENT ───────────────────
 * The client's adapter table (components/Farm/FarmPositionHub.jsx) is the
 * authority on what we can SIGN. This table is only "which feed row describes
 * that market", and it is kept next to the filters it exempts, because that is
 * where the exemption has to be justified. test/farm-venue-pins.test.js fails
 * if the two tables drift apart.
 */
export const VENUE_PINS = Object.freeze([
  Object.freeze({ venue: 'aave-base', project: 'aave-v3', chain: 'Base', symbol: 'USDC' }),
  Object.freeze({ venue: 'compound-base', project: 'compound-v3', chain: 'Base', symbol: 'USDC' }),
  Object.freeze({ venue: 'aave-arbitrum', project: 'aave-v3', chain: 'Arbitrum', symbol: 'USDC' }),
  /* Lido's feed row is the stETH pool itself; the adapter also accepts wstETH,
     but the rail pins the market the panel stakes into. */
  Object.freeze({ venue: 'lido', project: 'lido', chain: 'Ethereum', symbol: 'STETH' }),
  /*
   * Morpho is matched by UUID and never by symbol: the feed labels this market
   * "CBBTC" (its collateral) while the asset a depositor supplies is USDC. A
   * symbol match here would have bound our rate to whatever collateral label
   * upstream happens to use this month. The UUID is a data identifier only —
   * the transaction target stays the market id verified on-chain
   * (lib/defi/morphoBlueBase.js), exactly as docs/defi/morpho-blue-base-market.md
   * requires.
   */
  Object.freeze({ venue: 'morpho-base', project: 'morpho-blue', chain: 'Base', pool: '7d33d57d-36dc-414b-9538-22a223250468' })
]);

/** Does this upstream row describe this pinned venue? */
export function matchesVenuePin(pin, p) {
  if (!pin || !p) return false;
  if (String(p.project ?? '').toLowerCase() !== pin.project.toLowerCase()) return false;
  if (String(p.chain ?? '').toLowerCase() !== pin.chain.toLowerCase()) return false;
  if (pin.pool) return String(p.pool ?? '') === pin.pool;
  return String(p.symbol ?? '').toUpperCase().trim() === pin.symbol.toUpperCase();
}

/**
 * The honesty gates that survive pinning. Deliberately NOT isEligible(): that
 * function's job is to rank a stranger's pool, and MIN_APY/MIN_TVL/allow-list
 * ranking have no business deciding whether we can quote our own venue.
 */
export function isPinnableVenueRow(p) {
  if (!p || typeof p !== 'object') return false;
  if (!isYieldPoolIdLike(p.pool)) return false;
  if (typeof p.symbol !== 'string' || !p.symbol.trim() || p.symbol.length > 120) return false;
  if (p.outlier === true) return false;
  const apy = metric(p.apy);
  /* A pinned market may honestly pay 0 — that is the whole point of pinning.
     It may not pay 400%: that is a broken observation, not a yield. */
  if (apy == null || apy < 0 || apy > 100) return false;
  const tvl = metric(p.tvlUsd);
  return tvl != null && tvl >= 0;
}

/** Same UUID shape as `isYieldPoolId`, hoisted above its declaration. */
const isYieldPoolIdLike = (id) => typeof id === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * Pull the five venue rows out of the raw feed, whether or not they cleared
 * the discovery gates. Returns `{ venues, missing }` — `missing` is the list
 * of pin ids the feed did not contain, so an empty rail can be explained
 * instead of guessed at.
 */
export function extractVenueRows(rows, { updatedAt = new Date().toISOString() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const venues = [];
  const missing = [];
  for (const pin of VENUE_PINS) {
    /* Deterministic pick when a protocol lists two rows for one market (Lido
       has stETH on several chains, Aave has several USDC markets): the pin
       names chain + symbol, and among those the deepest TVL is the market a
       person would actually be pointed at. Ties break on the UUID so the same
       feed always produces the same row. */
    const candidates = list
      .filter((p) => matchesVenuePin(pin, p) && isPinnableVenueRow(p))
      .sort((a, b) => (Number(b.tvlUsd) || 0) - (Number(a.tvlUsd) || 0) || String(a.pool).localeCompare(String(b.pool)));
    const row = candidates[0];
    if (!row) {
      missing.push(pin.venue);
      continue;
    }
    venues.push({
      ...normalizePool(row),
      venue: pin.venue,
      pinned: true,
      /* Set when the row was one the discovery list would have dropped, so
         the client (and anyone reading the JSON) can see the exemption
         happened rather than trusting that it did not. */
      belowDiscoveryFloor: !isEligible(row),
      source: 'defillama',
      updatedAt,
      freshness: 'FRESH'
    });
  }
  return { venues, missing };
}

async function fetchJson(url, { timeout = TIMEOUT_MS } = {}) {
  const boundedTimeout = Math.max(250, Math.min(30_000, Number(timeout) || TIMEOUT_MS));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), boundedTimeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * RISK BANDING — three bands, assigned from properties, never from the APY.
 *
 * Banding by yield would be circular: "high yield is high risk" tells the user
 * only what they already inferred from the big number. These bands are about
 * what can actually go wrong with the position itself:
 *
 *   low    — single-asset, no impermanent loss, mostly stablecoin or staking.
 *            The failure mode is a contract exploit, not a price relationship.
 *   medium — single-asset but volatile, or a stable/stable pair. Real but
 *            bounded exposure.
 *   high   — a volatile pair. Impermanent loss applies and most people who
 *            lose money in DeFi lose it here, having never heard the term.
 */
export function riskBand(pool) {
  const il = pool.ilRisk === 'yes';
  const single = pool.exposure === 'single';
  if (!il && single && (pool.stablecoin || /eth|btc/i.test(pool.symbol ?? ''))) return 'low';
  if (!il) return 'medium';
  if (pool.stablecoin) return 'medium';
  return 'high';
}

/**
 * Normalise one upstream row into the shape the client renders.
 *
 * Everything is rounded here rather than in the UI: the raw feed carries five
 * decimal places of APY, and rendering "12.34567%" implies a precision that a
 * figure recomputed hourly from variable-rate borrowing simply does not have.
 */
export function normalizePool(p) {
  const apy = Number(p.apy) || 0;
  const base = metric(p.apyBase);
  const reward = metric(p.apyReward);

  return {
    id: p.pool,
    chain: p.chain,
    project: p.project,
    symbol: p.symbol,
    apy: Math.round(apy * 10) / 10,
    /*
     * The split, always. This is the number that tells someone whether the
     * headline is income or an incentive countdown, and it is the piece every
     * yield aggregator leaves out.
     */
    apyBase: rounded(base),
    apyReward: rounded(reward),
    /*
     * The 30-day mean, so the UI can show whether today's number is typical.
     * A pool at 40% today and 6% on average is not a 40% pool.
     */
    apyMean30d: rounded(p.apyMean30d),
    tvlUsd: Math.round(Number(p.tvlUsd) || 0),
    volumeUsd1d: rounded(p.volumeUsd1d, 1),
    /*
     * The 7-day volume next to the 24h one. A pool whose entire volume
     * happened yesterday is a different proposition from one that trades
     * every day, and the analytics panel shows both so the user can tell.
     * Null when the feed did not send it — never interpolated.
     */
    volumeUsd7d: rounded(p.volumeUsd7d, 1),
    // The pools API reports APY, not APR. Compounding frequency is unknown.
    apr: rounded(p.apr),
    rewardApr: rounded(p.rewardApr),
    /*
     * The pool's own label from the feed (e.g. a Curve factory tag or a
     * Uniswap fee tier). Display-only: it identifies WHICH pool this is
     * inside a protocol that runs hundreds of them.
     */
    poolMeta: typeof p.poolMeta === 'string' && p.poolMeta.trim() ? p.poolMeta.trim().slice(0, 120) : null,
    underlyingTokens: Array.isArray(p.underlyingTokens) ? p.underlyingTokens.filter((token) => typeof token === 'string').slice(0, 8) : [],
    stablecoin: p.stablecoin === true,
    ilRisk: p.ilRisk === 'yes',
    exposure: p.exposure ?? null,
    risk: riskBand(p),
    /*
     * DefiLlama publishes an ML prediction per pool. We deliberately do NOT
     * forward it. It is a black box we cannot explain, this app's entire
     * position is that a number the user cannot interrogate is worthless, and
     * forwarding someone else's forecast would be laundering a claim we
     * cannot stand behind.
     */
    url: p.source === 'kamino' && typeof p.url === 'string' && p.url.startsWith('https://kamino.com/')
      ? p.url
      : `https://defillama.com/yields/pool/${p.pool}`,
    ...(p.source === 'kamino' ? { source: 'kamino' } : {})
  };
}

/**
 * Map one raw Kamino Main Market `/reserves/metrics` entry into the raw pool
 * candidate shape consumed by `isEligible()` and `normalizePool()`.
 *
 * Verified against live `https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics?env=mainnet-beta`
 * on 2026-10-26:
 *   - `supplyApy` is a decimal ratio string (e.g. `"0.05213878863574353"` -> `5.213878863574353%`)
 *   - `totalSupplyUsd` and `totalBorrowUsd` are USD strings; withdrawable
 *     liquidity is `totalSupplyUsd - totalBorrowUsd` (matching DefiLlama's
 *     conservative lending TVL rule so 100%-utilized illiquid reserves get
 *     `tvlUsd = 0` and fail `MIN_TVL`).
 *   - LP-collateral wrapper reserves (`kSOLJITOSOLOrca`, `kSOLMSOLRaydium`,
 *     `kUXDUSDCOrca`) and corrupted rows (`totalBorrowUsd > totalSupplyUsd * 1.001`)
 *     are rejected upfront with `null`.
 */
export function mapKaminoReserveToPool(rawReserve, { market = KAMINO_MAIN_MARKET } = {}) {
  if (!rawReserve || typeof rawReserve !== 'object') return null;
  const reserve = typeof rawReserve.reserve === 'string' ? rawReserve.reserve.trim() : '';
  const mint = typeof rawReserve.liquidityTokenMint === 'string' ? rawReserve.liquidityTokenMint.trim() : '';
  const symbol = typeof rawReserve.liquidityToken === 'string' ? rawReserve.liquidityToken.trim() : '';
  if (!SOLANA_BASE58_RE.test(reserve) || !SOLANA_BASE58_RE.test(mint)) return null;
  if (!symbol || symbol.length > 60) return null;
  // Exclude Kamino kToken LP-collateral wrapper reserves (not passive spot lending).
  if (/^k[A-Z0-9]+(Orca|Raydium)$/i.test(symbol)) return null;

  const supplyRatio = metric(rawReserve.supplyApy);
  const totalSupplyUsd = metric(rawReserve.totalSupplyUsd);
  const totalBorrowUsd = metric(rawReserve.totalBorrowUsd);
  if (supplyRatio == null || supplyRatio < 0) return null;
  if (totalSupplyUsd == null || totalSupplyUsd < 0 || totalBorrowUsd == null || totalBorrowUsd < 0) return null;
  // Guard against corrupted upstream snapshots or unrecovered bad-debt insolvency.
  if (totalBorrowUsd > totalSupplyUsd * 1.001) return null;

  const availableUsd = Math.max(0, totalSupplyUsd - totalBorrowUsd);
  const apyPct = supplyRatio * 100;

  return {
    pool: `kamino-${reserve}`,
    chain: 'Solana',
    project: 'kamino-lend',
    symbol: symbol.toUpperCase(),
    poolMeta: 'SOL/BTC Market',
    tvlUsd: availableUsd,
    apy: apyPct,
    apyBase: apyPct,
    apyReward: null,
    apyMean30d: null,
    apyPct7D: null,
    volumeUsd1d: null,
    volumeUsd7d: null,
    stablecoin: KAMINO_USD_STABLE_MINTS.has(mint),
    ilRisk: 'no',
    exposure: 'single',
    outlier: false,
    underlyingTokens: [mint],
    rewardTokens: null,
    source: 'kamino',
    url: `https://kamino.com/borrow/reserve/${market}/${reserve}`
  };
}

/**
 * Fetch and map Kamino Main Market reserves directly from Kamino's free API.
 * Never throws into `fetchYields()` unless `strict: true` is passed by a caller:
 * an auxiliary upstream blip must never take down the primary Farm feed.
 */
export async function fetchKaminoMainMarketPools({ timeoutMs = 5_000, strict = false } = {}) {
  const timeout = Math.max(250, Math.min(15_000, Number(timeoutMs) || 5_000));
  try {
    const raw = await fetchJson(KAMINO_RESERVES_URL, { timeout });
    if (!Array.isArray(raw)) {
      if (strict) throw new Error('INVALID_KAMINO_RESERVES_RESPONSE');
      return [];
    }
    const out = [];
    for (const entry of raw) {
      const mapped = mapKaminoReserveToPool(entry);
      if (mapped) out.push(mapped);
    }
    return out;
  } catch (err) {
    if (strict) throw err;
    return [];
  }
}

/**
 * Should this pool be shown at all?
 *
 * Exported so the test suite can assert on the rules directly with synthetic
 * pools, rather than depending on whatever the live feed happens to contain
 * today — a test that fetches the network is a test that fails on a Sunday.
 */
export function isEligible(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.pool !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(p.pool)) return false;
  if (typeof p.symbol !== 'string' || !p.symbol.trim() || p.symbol.length > 120) return false;
  if (!ALLOWED_PROJECTS.has(p.project)) return false;
  if (!ALLOWED_CHAINS.has(p.chain)) return false;

  const tvl = metric(p.tvlUsd);
  if (!Number.isFinite(tvl) || tvl < MIN_TVL) return false;

  const apy = metric(p.apy);
  if (!Number.isFinite(apy) || apy < MIN_APY || apy > MAX_APY) return false;

  /*
   * DefiLlama's own outlier flag. It marks pools whose reported APY is
   * inconsistent with their history — usually a data glitch, occasionally
   * something worse. Either way we do not want it on a screen about money.
   */
  if (p.outlier === true) return false;

  const reward = Number(p.apyReward);
  if (Number.isFinite(reward) && apy > 0 && reward / apy > MAX_EMISSION_SHARE) return false;

  return true;
}

/**
 * Fetch, filter, rank.
 *
 * ─── WHY THE RANKING IS NOT BY APY ──────────────────────────────────────────
 * Sorting by yield puts the riskiest surviving row at the top, which
 * undermines every filter above it. So the ordering is by a score that pays
 * attention to size and to how much of the yield is real:
 *
 *   score = apy × (0.5 + 0.5 × realShare) × sizeFactor
 *
 * A 12% pool that is all real revenue with a billion in deposits outranks a
 * 20% pool that is two-thirds emissions with $12m. That is the correct order
 * to present them in and it is the opposite of what every yield aggregator
 * does.
 */
export async function fetchYields({ timeoutMs = TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const timeout = Math.max(250, Math.min(30_000, Number(timeoutMs) || TIMEOUT_MS));
  const raw = await fetchJson(LLAMA_YIELDS, { timeout });
  if (raw?.status !== 'success' || !Array.isArray(raw.data) || !raw.data.length) throw new Error('INVALID_YIELDS_RESPONSE');
  const rows = raw.data;

  // Supplement with direct Kamino Main Market reserves not already emitted by
  // DefiLlama's `kamino-lend` adapter for the same Main Market mint.
  const remainingMs = timeout - (Date.now() - startedAt);
  const kaminoCandidates = remainingMs >= 250
    ? await fetchKaminoMainMarketPools({ timeoutMs: Math.min(5_000, remainingMs) })
    : [];

  const llamaKaminoMainMints = new Set();
  for (const r of rows) {
    if (
      r?.project === 'kamino-lend' &&
      (r.poolMeta === 'SOL/BTC Market' || r.poolMeta === 'Main Market' || r.poolMeta == null) &&
      Array.isArray(r.underlyingTokens) &&
      typeof r.underlyingTokens[0] === 'string'
    ) {
      llamaKaminoMainMints.add(r.underlyingTokens[0]);
    }
  }
  const dedupedKamino = kaminoCandidates.filter((k) => !llamaKaminoMainMints.has(k.underlyingTokens?.[0]));
  const combinedRows = dedupedKamino.length ? [...rows, ...dedupedKamino] : rows;

  const seen = new Set();
  const eligible = combinedRows.filter((p) => {
    if (!isEligible(p) || seen.has(p.pool)) return false;
    seen.add(p.pool);
    return true;
  }).map(normalizePool);

  const score = (p) => {
    const realShare = p.apy > 0 && p.apyBase != null ? Math.max(0, Math.min(1, p.apyBase / p.apy)) : 0.5;
    // log10 of TVL in millions, so $1bn scores 3 and $10m scores 1 — a factor
    // that matters without letting the largest pool dominate outright.
    const sizeFactor = Math.log10(Math.max(10, p.tvlUsd / 1_000_000));
    return p.apy * (0.5 + 0.5 * realShare) * sizeFactor;
  };

  const updatedAt = new Date().toISOString();
  const ranked = eligible
    .sort((a, b) => score(b) - score(a))
    .slice(0, 500)
    .map((pool) => ({ ...pool, source: pool.source || 'defillama', updatedAt, freshness: 'FRESH' }));

  /*
   * The five execution venues, resolved against the SAME raw feed in the same
   * pass — never a second request, and never from the ranked slice, because
   * the ranking is exactly what a low-rate venue must not depend on.
   */
  const { venues, missing } = extractVenueRows(rows, { updatedAt });

  return {
    pools: ranked,
    venues,
    venuesMissing: missing,
    /*
     * Reported so the UI can show how many pools survived filtering. That
     * single line does more to explain what this screen is than any amount of
     * body copy: it makes the filtering visible instead of implicit.
     */
    considered: combinedRows.length,
    passed: eligible.length,
    at: Date.now(),
    source: ranked.some((p) => p.source === 'kamino') ? 'protocolDirect' : 'defillama',
    freshness: 'FRESH',
    truncated: eligible.length > ranked.length
  };
}


export const isYieldPoolId = (id) =>
  typeof id === 'string' && (LLAMA_POOL_UUID_RE.test(id) || KAMINO_POOL_ID_RE.test(id));

const YIELD_HISTORY_RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });
export const isYieldHistoryRange = (range) => Object.hasOwn(YIELD_HISTORY_RANGE_DAYS, range);

/** Real daily observations, never the earnings projection used by the calculator. */
export async function fetchYieldHistory(id, range = '30d') {
  if (!isYieldPoolId(id)) throw new Error('INVALID_POOL_ID');
  if (!isYieldHistoryRange(range)) throw new Error('INVALID_HISTORY_RANGE');

  const kaminoMatch = KAMINO_POOL_ID_RE.exec(id);
  if (kaminoMatch) {
    const reserve = kaminoMatch[1];
    const raw = await fetchJson(kaminoReserveHistoryUrl(reserve));
    if (!Array.isArray(raw?.history)) throw new Error('INVALID_YIELD_HISTORY');
    const now = Date.now();
    const byDay = new Map();
    for (const row of raw.history) {
      if (!row || typeof row.timestamp !== 'string') continue;
      const at = Date.parse(row.timestamp);
      if (!Number.isFinite(at) || at > now + 60_000) continue;
      const m = row.metrics ?? {};
      const supplyRatio = metric(m.supplyInterestAPY);
      const apy = supplyRatio != null ? Math.round(supplyRatio * 100 * 10) / 10 : null;
      const availDirect = metric(m.actualAvailableLiquidityUsd);
      const depUsd = metric(m.depositTvl);
      const borUsd = metric(m.borrowTvl);
      const tvlUsd = availDirect != null
        ? availDirect
        : (depUsd != null && borUsd != null ? Math.max(0, depUsd - borUsd) : null);
      if (apy == null && tvlUsd == null) continue;
      const day = new Date(at).toISOString().slice(0, 10);
      if (byDay.has(day) && byDay.get(day).timestamp > at) continue;
      byDay.set(day, {
        timestamp: at,
        apy,
        tvlUsd: tvlUsd != null && tvlUsd >= 0 ? Math.round(tvlUsd) : null,
        apyBase: apy,
        apyReward: null
      });
    }
    const cutoff = now - YIELD_HISTORY_RANGE_DAYS[range] * 86_400_000;
    const points = [...byDay.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((row) => row.timestamp >= cutoff);
    return { pool: id, range, points, at: now, source: 'kamino', freshness: 'FRESH' };
  }

  const raw = await fetchJson(`https://yields.llama.fi/chart/${id}`);
  if (raw?.status !== 'success' || !Array.isArray(raw.data)) throw new Error('INVALID_YIELD_HISTORY');
  const now = Date.now();
  const byDay = new Map();
  for (const row of raw.data) {
    if (!row || typeof row.timestamp !== 'string') continue;
    const at = Date.parse(row.timestamp);
    if (!Number.isFinite(at) || at > now + 60_000) continue;
    const apy = metric(row.apy);
    const tvlUsd = metric(row.tvlUsd);
    if (apy == null && tvlUsd == null) continue;
    const day = new Date(at).toISOString().slice(0, 10);
    if (byDay.has(day) && byDay.get(day).timestamp > at) continue;
    byDay.set(day, {
      timestamp: at, apy, tvlUsd: tvlUsd != null && tvlUsd >= 0 ? Math.round(tvlUsd) : null,
      apyBase: rounded(row.apyBase), apyReward: rounded(row.apyReward)
    });
  }
  const cutoff = now - YIELD_HISTORY_RANGE_DAYS[range] * 86_400_000;
  const points = [...byDay.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((row) => row.timestamp >= cutoff);
  return { pool: id, range, points, at: now, source: 'defillama', freshness: 'FRESH' };
}
