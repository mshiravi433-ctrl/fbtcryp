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
 * So the server fetches it, filters it down to a few dozen rows and caches the
 * result for an hour. One upstream request per hour serves every user, and the
 * client downloads a few KB.
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

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

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
  'maple'
]);

/**
 * Chains we already support in the app.
 *
 * Listing a pool on a chain the user cannot reach from here is a dead end —
 * they tap through, discover they need a different wallet setup, and the
 * screen has wasted their time. Solana is included because the app has a
 * dedicated Solana swap screen.
 */
const ALLOWED_CHAINS = new Set([
  'Ethereum',
  'BSC',
  'Polygon',
  'Arbitrum',
  'Optimism',
  'Base',
  'Avalanche',
  'Solana'
]);

/**
 * FLOORS AND CEILINGS.
 *
 * MIN_TVL — $10m. Below this a pool can be drained or exited by one whale,
 * and the APY figure is computed on a base too small to be stable. It is also
 * the single most effective scam filter available: a fake pool almost never
 * has eight figures of real deposits in it.
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
const MIN_TVL = 10_000_000;
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
  const base = Number(p.apyBase);
  const reward = Number(p.apyReward);

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
    apyBase: Number.isFinite(base) ? Math.round(base * 10) / 10 : null,
    apyReward: Number.isFinite(reward) ? Math.round(reward * 10) / 10 : null,
    /*
     * The 30-day mean, so the UI can show whether today's number is typical.
     * A pool at 40% today and 6% on average is not a 40% pool.
     */
    apyMean30d: Number.isFinite(Number(p.apyMean30d)) ? Math.round(Number(p.apyMean30d) * 10) / 10 : null,
    tvlUsd: Math.round(Number(p.tvlUsd) || 0),
    stablecoin: Boolean(p.stablecoin),
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
  if (!ALLOWED_PROJECTS.has(p.project)) return false;
  if (!ALLOWED_CHAINS.has(p.chain)) return false;

  const tvl = Number(p.tvlUsd);
  if (!Number.isFinite(tvl) || tvl < MIN_TVL) return false;

  const apy = Number(p.apy);
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
  const rows = Array.isArray(raw?.data) ? raw.data : [];

  const eligible = rows.filter(isEligible).map(normalizePool);

  const score = (p) => {
    const realShare = p.apy > 0 && p.apyBase != null ? Math.max(0, Math.min(1, p.apyBase / p.apy)) : 0.5;
    // log10 of TVL in millions, so $1bn scores 3 and $10m scores 1 — a factor
    // that matters without letting the largest pool dominate outright.
    const sizeFactor = Math.log10(Math.max(10, p.tvlUsd / 1_000_000));
    return p.apy * (0.5 + 0.5 * realShare) * sizeFactor;
  };

  const ranked = eligible.sort((a, b) => score(b) - score(a)).slice(0, 40);

  return {
    pools: ranked,
    /*
     * Reported so the UI can say "40 of 312 pools passed the filter". That
     * single line does more to explain what this screen is than any amount of
     * body copy: it makes the filtering visible instead of implicit.
     */
    considered: rows.length,
    passed: eligible.length,
    at: Date.now(),
    source: 'defillama'
  };
}
