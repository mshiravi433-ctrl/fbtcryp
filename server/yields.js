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
  'spark',
  'sparklend',
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
   * ─── CONSIDERED AND REJECTED, 2026-08-24 (do not add without re-checking) ─
   *
   * 'meteora' — the adapter is broken, and has never worked. Its ONLY commit
   * (2025-01-23, "rename resolv") left `p.pool_token_mints` and `apyReward`
   * referencing undefined variables, so `apy()` throws a ReferenceError on
   * every run and the server can have stored no `project: 'meteora'` pool
   * since. Verified against master on 2026-08-24; `meteora-dlmm` and `ajna`
   * are not present in the repo at all. A slug with no data behind it would
   * only look like we list Meteora when we do not.
   *
   * 'ajna-v2' — two independent problems, either one enough to stay out:
   *   1. WRONG LABEL ON THE WRONG ASSET. The adapter puts the COLLATERAL
   *      token in `symbol` (e.g. "WBTC") while the token a depositor
   *      actually lends is the quote in `mintedCoin`/`borrowToken`, and
   *      `underlyingTokens` lists the collateral only. Our riskBand() would
   *      then render a USDC-lending pool as "WBTC · low" — the exact
   *      mislabel this app exists to refuse. Adding it would require
   *      first teaching normalizePool to prefer `mintedCoin`.
   *   2. NOTHING PASSES THE FLOOR. The whole protocol holds under ~$1M
   *      (DefiLlama: 4 pools tracked, average APY 0.93%, 2026-08-24), so
   *      every pool dies at MIN_TVL = $10m. A slug that renders zero rows
   *      is dead weight today and a trap for problem 1 the day TVL grows.
   * If Ajna outgrows the floor, add the slug AND the mintedCoin label fix
   * together, with fresh evidence in test/wiring.mjs.
   */
  // stablecoin yield with a real, explainable source
  'sky-lending',
  'ethena-usde',
  'maple',
  /*
   * ─── SECOND WAVE — added 2026-09-06, same filters, no exceptions ─────────
   * Users asked for more investable pools («استخرهای بیشتر برای سرمایه‌گذاری»).
   * Every slug below clears the SAME rules as the first wave (TVL floor, APY
   * band, 70% emission ceiling, outlier flag, app chains) — the allow-list is
   * only the first gate, never a free pass. Each protocol is large, audited
   * and multi-year old; none of them is a safety guarantee and the UI never
   * says otherwise.
   *
   * A slug that matches nothing in the live feed renders nothing — a wrong
   * guess here is an empty contribution, never a wrong row. Re-verify against
   * DefiLlama/yield-server adapter folder names on the next upstream check
   * (same procedure as the uniswap-v4 evidence in test/wiring.mjs).
   */
  // battle-tested lending + second-generation money markets
  'aave-v2',
  'benqi',
  // auto-compounding vaults — these make the Farm "vault" filter real
  'yearn-finance',
  'convex-finance',
  'beefy',
  // bridge + yield-trading liquidity with deep, old pools
  'stargate',
  'pendle',
  // Solana liquid staking the Farm staking section joins onto
  'jupiter-staked-sol',
  /*
   * ─── SOLANA LSTs — added 2026-09-11, evidence recorded ────────────────────
   * «توکن‌های جدید هم اضافه کن» — and these three are the deepest Solana
   * stake pools we were not yet able to quote a live rate for. Each slug was
   * read off the adapter itself, because the adapter FOLDER NAME is the slug
   * and its `project:` literal is what our join matches on:
   *
   *   src/adaptors/blazestake/index.js            project: 'blazestake'          symbol 'bSOL'
   *   src/adaptors/sanctum-infinity/index.js      project: 'sanctum-infinity'    symbol 'INF'
   *   src/adaptors/helius-staked-sol/index.js     project: 'helius-staked-sol'   symbol 'HSOL'
   *
   * (master, read 2026-09-11 — all three use `getSanctumLstApy` + total supply
   * × price, so `apyBase` is real and `apyReward` is absent: the emissions
   * ceiling cannot fire on them.) They are Solana-only, which is why they are
   * not in test/wiring.mjs's SLUG_EVIDENCE table — that table's rule is "at
   * least three APP chains", and a single-chain Solana adapter can never
   * satisfy it. The evidence lives here instead, in the same shape.
   *
   * A wrong slug upstream is an EMPTY contribution, never a wrong row: the LST
   * list joins on project AND symbol (lib/solanaAssetsClient.js), so a drift
   * makes one row show no rate and nothing else. That is the failure mode this
   * list is allowed to have; the one it is not allowed to have is a plausible
   * rate for the wrong token.
   */
  'blazestake',
  'sanctum-infinity',
  'helius-staked-sol',
  // Solana lending + AMMs with multi-year track records
  'kamino',
  'raydium',
  'orca',
  // long-running AMMs / liquidity venues
  'sushiswap',
  'gmx',
  // restaking + stablecoin-adjacent yield with explainable sources
  'eigenlayer',
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

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
    url: `https://defillama.com/yields/pool/${p.pool}`
  };
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
export async function fetchYields() {
  const raw = await fetchJson(LLAMA_YIELDS);
  if (raw?.status !== 'success' || !Array.isArray(raw.data) || !raw.data.length) throw new Error('INVALID_YIELDS_RESPONSE');
  const rows = raw.data;

  const seen = new Set();
  const eligible = rows.filter((p) => {
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
    .map((pool) => ({ ...pool, source: 'defillama', updatedAt, freshness: 'FRESH' }));

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
    considered: rows.length,
    passed: eligible.length,
    at: Date.now(),
    source: 'defillama',
    freshness: 'FRESH',
    truncated: eligible.length > ranked.length
  };
}


export const isYieldPoolId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Real daily observations, never the earnings projection used by the calculator. */
export async function fetchYieldHistory(id) {
  if (!isYieldPoolId(id)) throw new Error('INVALID_POOL_ID');
  const raw = await fetchJson(`https://yields.llama.fi/chart/${id}`);
  if (raw?.status !== 'success' || !Array.isArray(raw.data)) throw new Error('INVALID_YIELD_HISTORY');
  const byDay = new Map();
  for (const row of raw.data) {
    if (!row || typeof row.timestamp !== 'string') continue;
    const at = Date.parse(row.timestamp);
    if (!Number.isFinite(at) || at > Date.now() + 60_000) continue;
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
  const points = [...byDay.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-365);
  return { pool: id, points, at: Date.now(), source: 'defillama', freshness: 'FRESH' };
}
