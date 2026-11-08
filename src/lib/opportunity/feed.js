/**
 * OPPORTUNITY ENGINE — THE LIVE FEED ADAPTER
 * ---------------------------------------------------------------------------
 * «فرصت‌ها بر اساس موجودی کیف پول، شبکه‌های فعال، سرمایه قابل استفاده و میزان
 *  ریسک‌پذیری کاربر پیشنهاد شوند»
 *
 * The engine (`lib/brain/opportunityEngine.js`) is pure: it prices whatever rows
 * it is handed and never invents one. This module is the other half — it reads
 * the four things the owner named and turns them into exactly the rows the
 * engine understands:
 *
 *   1. WALLET BALANCE     → investable capital (free balance only, never the
 *                           whole net worth, never a locked signer's guess)
 *   2. ACTIVE NETWORKS    → a chain-coverage report + a per-chain fit score, so
 *                           an Ethereum pool that would eat a $40 position in
 *                           gas is ranked down instead of dressed up
 *   3. INVESTABLE CAPITAL → the engine's `userCapitalUsd` (the number the fees
 *                           are actually charged against)
 *   4. RISK APPETITE      → the engine's `riskProfile`/tolerance
 *
 * ─── WHAT THIS MODULE WILL NOT DO ───────────────────────────────────────────
 * · It never turns a stale or offline price into a capital number. A wallet
 *   total built from stale quotes is reported as `capitalStatus: 'stale'` and
 *   the caller must say so.
 * · It never treats an attached-but-locked signer as spendable.
 * · It never fabricates an arbitrage spread, an RWA yield or a token age. The
 *   feed families that need an adapter we do not have simply report
 *   `unavailable` in the coverage table — the engine already models that.
 *
 * ─── WHY THE ROWS ARE NORMALISED HERE ───────────────────────────────────────
 * The yields endpoint speaks DefiLlama (`project`, `symbol`, `apyBase`), the
 * farm registry speaks venue ids (`venue`, `poolId`), the market API speaks
 * CoinGecko (`id`, `current_price`). The engine reads one shape; the mapping
 * belongs next to the feeds, not inside the ranking code.
 */

import { scanOpportunities, OPPORTUNITY_CATEGORIES } from '../brain/opportunityEngine.js';

/** Yield-feed projects that are money markets rather than farms. */
const LENDING_RE = /^(aave|compound|morpho|spark|kamino-lend|jupiter-lend|fluid-lending|venus|save|sky-lending|maple|benqi-lending|radiant|euler)/i;

/** The only chains the app can actually route a wallet to (see server/yields.js). */
export const SUPPORTED_CHAINS = Object.freeze([
  'ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche', 'solana', 'linea', 'sonic'
]);

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const list = (v) => (Array.isArray(v) ? v : []);
const chainKey = (v) => String(v ?? '').trim().toLowerCase();
const pairSymbol = (s) => /[-/]/.test(String(s ?? ''));

/* ═══════════════════════ 1 · WALLET → CAPITAL ═══════════════════════ */

/**
 * The user's investable capital, from what the portfolio reader actually
 * verified this session.
 *
 * ─── THREE NUMBERS, AND WHICH ONE IS HONEST ─────────────────────────────────
 *   totalValue     what the wallet is worth (includes a $3 JPEG and a locked
 *                  staking receipt nobody can spend today)
 *   stableUsd      the part that is already a unit of account — instantly
 *                  deployable with no swap, no slippage and no gas spike
 *   investableUsd  the number the engine prices fees against
 *
 * `investableUsd` is stable value PLUS the priced volatile value, because a
 * user holding $900 of ETH may absolutely choose the ETH pool — but it is
 * reported alongside `stableUsd` so the UI can be explicit about which part
 * needs a swap first. A locked signer contributes NOTHING: it can be read, it
 * cannot be spent.
 *
 * Anything unpriced is excluded from the sum and counted in `unpricedRows`, so
 * a missing quote can never inflate the number the fee model divides by.
 */
export function buildCapitalSnapshot({ rows = [], priceDataStatus = null, walletCanSign = false, connected = false, failures = [], staleChains = [] } = {}) {
  const held = list(rows).filter((r) => Number(r.amount) > 0);
  const priced = list(rows).filter((r) => num(r.value) != null && num(r.value) > 0);
  const stableRows = priced.filter((r) => /^(usdt|usdc|dai|usde|usds|fdusd|busd|tusd|usdp|pyusd|susde|susds)$/i.test(String(r.symbol ?? '')));
  const totalValue = priced.reduce((s, r) => s + Number(r.value), 0);
  const stableUsd = stableRows.reduce((s, r) => s + Number(r.value), 0);
  const unpriced = list(rows).filter((r) => Number(r.amount) > 0 && num(r.value) == null);
  /* A chain is ACTIVE when the user holds anything on it — including a token we
     could not price. The unpriced row is excluded from the money (above), but
     the network it sits on is still a network the user is using, and the
     per-chain fit must know that. */
  const chains = [...new Set(held.map((r) => String(r.chainName ?? r.chainId ?? r.chain ?? '')).map(chainKey).filter(Boolean))];

  /* Capital is only "live" when every quote behind it came from a live feed and
     no chain read failed. A partial read is a lower bound, and it says so. */
  const capitalStatus = !connected ? 'disconnected'
    : priceDataStatus === 'live' && !failures.length && !staleChains.length ? 'live'
      : 'partial';

  return {
    connected: Boolean(connected),
    canSign: Boolean(walletCanSign),
    totalValue: Math.round(totalValue * 100) / 100,
    stableUsd: Math.round(stableUsd * 100) / 100,
    /* Only a spendable wallet contributes an investable number. */
    investableUsd: walletCanSign ? Math.round(totalValue * 100) / 100 : 0,
    stableInvestableUsd: walletCanSign ? Math.round(stableUsd * 100) / 100 : 0,
    pricedRows: priced.length,
    unpricedRows: unpriced.length,
    activeChains: chains,
    chainCount: chains.length,
    failures: list(failures),
    staleChains: list(staleChains),
    priceDataStatus,
    capitalStatus
  };
}

/* ═══════════════════════ 2 · RISK PROFILE ═══════════════════════ */

export const RISK_PROFILES = Object.freeze([
  { id: 'CONSERVATIVE', fa: 'محافظه‌کار', en: 'Conservative', blurbFa: 'اول حفظ سرمایه؛ فقط بازارهای پخته', blurbEn: 'Preserve first; mature markets only' },
  { id: 'MODERATE', fa: 'میانه', en: 'Moderate', blurbFa: 'تعادل بازده و ریسک', blurbEn: 'Balance of yield and risk' },
  { id: 'BALANCED', fa: 'متعادل', en: 'Balanced', blurbFa: 'کمی ماجراجو، با سقف ریسک مشخص', blurbEn: 'Slightly adventurous, bounded' },
  { id: 'AGGRESSIVE', fa: 'جسور', en: 'Aggressive', blurbFa: 'بازده بالا با پذیرش افت‌های بزرگ', blurbEn: 'High yield, large drawdowns accepted' }
]);

/** Risk appetite persists per device — it is a preference, not a fact about the market. */
export const RISK_STORAGE_KEY = 'fbt.opportunity.risk.v1';

export function readRiskProfile() {
  try {
    const raw = globalThis.localStorage?.getItem(RISK_STORAGE_KEY);
    if (raw && RISK_PROFILES.some((p) => p.id === raw)) return raw;
  } catch { /* private mode */ }
  return 'MODERATE';
}

export function writeRiskProfile(id) {
  if (!RISK_PROFILES.some((p) => p.id === id)) return false;
  try {
    globalThis.localStorage?.setItem(RISK_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** A short, honest sentence describing what the chosen appetite does to the scan. */
export function riskProfileNote(id, fa) {
  const p = RISK_PROFILES.find((x) => x.id === id) || RISK_PROFILES[1];
  return fa ? p.blurbFa : p.blurbEn;
}

/* ═══════════════════════ 3 · FEED NORMALISATION ═══════════════════════ */

/**
 * The yield feed (server/yields.js `normalizePool`) → engine rows.
 *
 * Every row keeps its identity (`id`) and its own DefiLlama page, because a card
 * that cannot be opened is a card nobody can act on. `venues` are the pools we
 * can sign for; a pool that is also in that list keeps its venue id so the
 * Farm screen can open the exact row.
 */
export function normalizeYieldRows({ pools = [], venues = [] } = {}) {
  const venueByPool = new Map();
  for (const v of list(venues)) {
    if (v?.id) venueByPool.set(String(v.id), v.venue || v.venueId || null);
  }
  const liquidityPools = [];
  const farms = [];
  const lendingMarkets = [];
  for (const p of list(pools)) {
    const apy = num(p.apy);
    if (apy == null || apy <= 0) continue;
    const shared = {
      id: p.id ?? null,
      poolId: p.id ?? null,
      url: p.url ?? null,
      venue: venueByPool.get(String(p.id)) ?? null,
      chain: p.chain ?? null,
      protocol: p.project ?? null,
      tvlUsd: num(p.tvlUsd),
      apy,
      samples: Array.isArray(p.samples) ? p.samples.length : num(p.sampleCount)
    };
    if (pairSymbol(p.symbol) || p.exposure === 'multi') {
      liquidityPools.push({
        ...shared,
        pair: p.symbol ?? null,
        feeApy: num(p.apyBase),
        rewardApy: num(p.apyReward),
        volume24hUsd: num(p.volumeUsd1d),
        impermanentLossRisk: p.ilRisk === true ? 7 : null,
        riskScore: p.risk === 'high' ? 7 : p.risk === 'medium' ? 4.5 : 2.5
      });
      continue;
    }
    if (LENDING_RE.test(String(p.project ?? ''))) {
      lendingMarkets.push({
        ...shared,
        asset: p.symbol ?? null,
        supplyApy: apy,
        utilizationPct: num(p.utilizationPct),
        ltvPct: num(p.ltvPct),
        riskScore: p.risk === 'high' ? 7 : p.risk === 'medium' ? 4.5 : 2.5
      });
      continue;
    }
    farms.push({
      ...shared,
      symbol: p.symbol ?? null,
      asset: p.symbol ?? null,
      lockDays: num(p.lockDays),
      riskScore: p.risk === 'high' ? 7 : p.risk === 'medium' ? 4.5 : 2.5
    });
  }
  return { liquidityPools, farms, lendingMarkets };
}

/** Whale-flow consensus rows (verified swaps only) → engine rows. */
export function normalizeWhaleRows(consensusRows = []) {
  return list(consensusRows).map((r) => ({
    asset: r.symbol ?? null,
    chain: r.chain ?? null,
    direction: /ACCUM/i.test(String(r.signal ?? '')) ? 'accumulation' : 'distribution',
    netFlowUsd: num(r.netFlowUsd),
    walletCount: num(r.independentVotes ?? r.independentBuyers),
    confidence: num(r.confidence) != null ? Number(r.confidence) / 100 : null
  }));
}

/** Early-token rows → engine rows. A past 24h move never becomes a forecast. */
export function normalizeEmergingRows(tokens = []) {
  return list(tokens).map((t) => ({
    symbol: t.symbol ?? null,
    name: t.name ?? null,
    chain: t.chain ?? null,
    ageDays: num(t.ageHours) != null ? Number(t.ageHours) / 24 : null,
    liquidityUsd: num(t.liquidityUsd),
    change24h: num(t.priceChangeH24),
    mcap: num(t.fdv),
    priceUsd: num(t.priceUsd)
  }));
}

/* ═══════════════════════ 4 · CHAIN FIT ═══════════════════════ */

/**
 * How well one chain fits this user's capital and active networks.
 *
 * Two separate questions, because they have different answers:
 *   `active` — is this a network the wallet is already using? (a network the
 *              user has never touched costs a bridge or a withdrawal first)
 *   `viable` — can the user's capital support a position here at all? A $40
 *              position on Ethereum mainnet is $4.50 of gas per leg; the fee
 *              model will reject it, and the card should say so BEFORE the tap.
 */
export function chainFit({ chain, capitalUsd = 0, activeChains = [], gasUsdPerLeg = null } = {}) {
  const key = chainKey(chain);
  const active = list(activeChains).map(chainKey).includes(key);
  const gas = num(gasUsdPerLeg);
  const capital = Math.max(0, num(capitalUsd) ?? 0);
  /* Five round trips is already a materially wrong position for a small
     account; below that the network is merely expensive, not impossible. */
  const gasSharePct = gas != null && capital > 0 ? Math.min(100, (gas * 100) / capital) : null;
  return {
    chain: key,
    supported: SUPPORTED_CHAINS.includes(key),
    active,
    gasUsdPerLeg: gas,
    gasSharePct,
    viable: gasSharePct == null ? null : gasSharePct <= 5
  };
}

/* ═══════════════════════ 5 · THE SCAN ═══════════════════════ */

/**
 * Personalised scan: feeds + wallet + appetite → ranked, personalised
 * opportunities, with an honest coverage report and a scan log for the
 * "AI Scanner" room (what was just discovered, and WHY each row matched).
 *
 * @param {object} input
 * @param {object} input.capital     buildCapitalSnapshot() output
 * @param {string} input.riskProfile CONSERVATIVE | MODERATE | BALANCED | AGGRESSIVE
 * @param {number} input.horizonDays default 30
 * @param {object} input.feeds       { yields, venues, whaleConsensus, emergingTokens, arbitrage, rwaAssets }
 * @param {object} [input.cortexReadout]
 */
export function scanPersonalised({
  capital = null, riskProfile = 'MODERATE', horizonDays = 30,
  feeds = {}, cortexReadout = null, now = Date.now(), limit = 40
} = {}) {
  /* Accept either shape a caller has at hand: `feeds.yields` (the array the
     yields endpoint returns) or `feeds.pools` (the same array under the name the
     server uses). A caller that passes neither gets an empty family, reported in
     coverage — never an invented row. */
  const yieldRows = normalizeYieldRows({
    pools: Array.isArray(feeds.yields) ? feeds.yields : list(feeds.pools),
    venues: list(feeds.venues)
  });
  const whaleFlows = normalizeWhaleRows(feeds.whaleConsensus);
  const emergingTokens = normalizeEmergingRows(feeds.emergingTokens);

  const scan = scanOpportunities({
    now,
    userCapitalUsd: capital?.investableUsd ?? 0,
    riskProfile,
    horizonDays,
    limit,
    liquidityPools: yieldRows.liquidityPools,
    farms: yieldRows.farms,
    lendingMarkets: yieldRows.lendingMarkets,
    whaleFlows,
    emergingTokens,
    arbitrage: list(feeds.arbitrage),
    rwaAssets: list(feeds.rwaAssets),
    venuePrices: list(feeds.venuePrices),
    marketContext: feeds.marketContext ?? null,
    cortexReadout
  });

  /* Coverage is about SOURCES, not results: a family with a live feed but no
     qualifying row is `empty` (we looked, nothing passed), never `unavailable`. */
  const coverage = [
    { id: 'LIQUIDITY_POOL', source: 'yield-feed', rows: yieldRows.liquidityPools.length },
    { id: 'FARMING', source: 'yield-feed', rows: yieldRows.farms.length },
    { id: 'LENDING', source: 'yield-feed', rows: yieldRows.lendingMarkets.length },
    { id: 'WHALE_FLOW', source: 'smart-money', rows: whaleFlows.length },
    { id: 'EMERGING_TOKEN', source: 'early-tokens', rows: emergingTokens.length },
    { id: 'ARBITRAGE', source: 'quotes', rows: list(feeds.arbitrage).length + list(feeds.venuePrices).length },
    { id: 'RWA', source: 'rwa-sectors', rows: list(feeds.rwaAssets).length }
  ].map((c) => ({
    ...c,
    label: OPPORTUNITY_CATEGORIES.find((x) => x.id === c.id) || { id: c.id, fa: c.id, en: c.id },
    status: c.rows > 0 ? (c.source === 'smart-money' ? 'observed' : 'live') : 'empty'
  }));

  const discovered = [...scan.opportunities, ...scan.rejected].sort((a, b) => b.discoveredAt - a.discoveredAt);

  return {
    ...scan,
    capital,
    coverage,
    scannedAt: now,
    /* Personalisation provenance: which of the four inputs actually contributed.
       Included so the UI can be explicit rather than implying knowledge. */
    personalisation: {
      capitalUsd: capital?.investableUsd ?? 0,
      capitalStatus: capital?.capitalStatus ?? 'disconnected',
      activeChains: capital?.activeChains ?? [],
      riskProfile: scan.profile?.riskProfile ?? riskProfile,
      riskTolerance: scan.profile?.riskTolerance ?? null,
      horizonDays: scan.profile?.horizonDays ?? horizonDays,
      candidates: Object.values(scan.coverage || {}).reduce((a, b) => a + b, 0)
    },
    /* The AI Scanner room: newest discoveries with the reason each matched. */
    scanner: discovered.slice(0, 24).map((o) => ({
      opportunityId: o.opportunityId,
      category: o.category,
      title: o.title,
      chain: o.chain,
      discoveredAt: o.discoveredAt,
      expiresAt: o.expiresAt,
      confidence: o.confidence,
      score: o.score,
      eligible: o.eligible,
      reasons: list(o.evidence).map((e) => ({ type: e.type, detail: e.detail })),
      caveats: o.caveats,
      exclusionCodes: list(o.exclusionReasons).map((r) => r.code)
    })),
    top: scan.opportunities.slice(0, 6)
  };
}
