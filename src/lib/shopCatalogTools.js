/**
 * SHOP CATALOGUE TOOLS — Phase 1 Storefront Intelligence
 * ---------------------------------------------------------------------------
 * Pure, framework-free domain logic for the `/shop` storefront:
 *
 *   1. Quick Regions (`US`, `TR`, `AE`, `GB`, `DE`) — never guessed from
 *      `navigator.language` or IP; always chosen explicitly by the shopper.
 *   2. Regional Best-Sellers & Smart Ranking — surfaces high-demand global
 *      brands (Steam, Apple, PlayStation, Rewarble, Visa, Mastercard, Razer
 *      Gold, Netflix, Spotify, Xbox, Amazon, Google Play) that are actually
 *      in the active country's catalogue.
 *   3. Pinned / Favorite Brands (`localStorage`) — keyed by canonical
 *      `brandSlug` so shoppers re-buying subscriptions or game balances reach
 *      their brand in one tap.
 *   4. Quick Budget Filter — parses `brand.min` (including multi-currency
 *      notations such as `$10`, `25 USD`, `50 AED`, `250 TRY`, `€10`) into an
 *      approximate USD floor for budget chips (`all`, `10`, `25`, `50`, `100`).
 *   5. Use-Case Hub — maps the six highest-demand crypto-user jobs-to-be-done
 *      (AI, Trading Tools, Gaming, App Stores, Streaming, Virtual Cards) to
 *      compatible brands and open-loop payment cards in the active country.
 *   6. Smart Wallet & Internal Swap Shortfall Planner — compares selected
 *      denomination cost (`USDC` / `USDT`) against connected EVM or Solana
 *      balances and builds safe 1-click internal swap routes (`/swap` or
 *      `/solana`) so users convert inside the app (0.70% swap revenue).
 */

import { brandSlug } from './shopLinks.js';

export const SHOP_FAVORITES_KEY = 'fbt.shop.favorites.v1';

/** High-frequency gift-card & virtual-card regions surfaced in the quick bar. */
export const QUICK_REGIONS = Object.freeze(['US', 'TR', 'AE', 'GB', 'DE']);

/** Budget filter chips (USD-equivalent minimum denomination ceiling). */
export const BUDGET_TIERS = Object.freeze([
  { id: 'all', max: null },
  { id: '10', max: 10 },
  { id: '25', max: 25 },
  { id: '50', max: 50 },
  { id: '100', max: 100 }
]);

/** Six practical crypto-to-real-world use cases for the Use-Case Hub. */
export const SHOP_USE_CASES = Object.freeze([
  { id: 'ai', icon: 'spark' },
  { id: 'trading', icon: 'chart' },
  { id: 'gaming', icon: 'gamepad' },
  { id: 'appstore', icon: 'store' },
  { id: 'streaming', icon: 'play' },
  { id: 'virtualcard', icon: 'card' }
]);

/** Solana canonical mainnet mints matching `src/lib/solana.js`. */
export const SOLANA_MAINNET_MINTS = Object.freeze({
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
});

/** Ordered priority matchers for high-demand global brands. */
const FEATURED_BRAND_PATTERNS = Object.freeze([
  { key: 'steam', rx: /\bsteam\b/i },
  { key: 'apple', rx: /\b(apple|app\s*store|itunes)\b/i },
  { key: 'playstation', rx: /\b(playstation|psn)\b/i },
  { key: 'rewarble', rx: /\brewarble\b/i },
  { key: 'visa', rx: /\bvisa\b/i },
  { key: 'mastercard', rx: /\bmastercard\b/i },
  { key: 'razer', rx: /\brazer(\s*gold)?\b/i },
  { key: 'netflix', rx: /\bnetflix\b/i },
  { key: 'spotify', rx: /\bspotify\b/i },
  { key: 'xbox', rx: /\bxbox\b/i },
  { key: 'amazon', rx: /\bamazon\b/i },
  { key: 'google-play', rx: /\bgoogle\s*play\b/i }
]);

/** Conservative FX multipliers to USD when `brand.min` carries an explicit non-USD unit. */
const APPROX_USD_PER_UNIT = Object.freeze({
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  AED: 1 / 3.6725,
  TRY: 1 / 34,
  SAR: 1 / 3.75,
  CAD: 0.73,
  AUD: 0.66,
  CHF: 1.13,
  JPY: 1 / 150,
  INR: 1 / 84,
  CNY: 1 / 7.2
});

function brandHaystack(brand) {
  if (!brand || typeof brand !== 'object') return '';
  const tags = Array.isArray(brand.tags) ? brand.tags.join(' ') : '';
  return `${brand.name ?? ''} ${brand.family ?? ''} ${brand.category ?? ''} ${tags}`.toLowerCase();
}

/** Canonical slug key used to persist a pinned/favorite brand across sessions. */
export function brandFavoriteKey(brandOrFamily) {
  if (!brandOrFamily) return '';
  const raw = typeof brandOrFamily === 'string'
    ? brandOrFamily
    : (brandOrFamily.family || brandOrFamily.name || brandOrFamily.id || '');
  return brandSlug(raw);
}

export function getShopFavorites(storage = globalThis?.localStorage) {
  try {
    if (!storage) return [];
    const raw = storage.getItem(SHOP_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const out = [];
    for (const item of parsed) {
      const k = String(item ?? '').trim().toLowerCase();
      if (/^[a-z0-9._-]{1,80}$/.test(k) && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
      if (out.length >= 50) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function setShopFavorites(keys, storage = globalThis?.localStorage) {
  const seen = new Set();
  const clean = [];
  for (const item of (Array.isArray(keys) ? keys : [])) {
    const k = String(item ?? '').trim().toLowerCase();
    if (/^[a-z0-9._-]{1,80}$/.test(k) && !seen.has(k)) {
      seen.add(k);
      clean.push(k);
    }
    if (clean.length >= 50) break;
  }
  try {
    if (storage) storage.setItem(SHOP_FAVORITES_KEY, JSON.stringify(clean));
  } catch { /* private mode / quota — in-memory state still works */ }
  return clean;
}

export function toggleShopFavorite(brandOrFamily, currentKeys, storage = globalThis?.localStorage) {
  const key = brandFavoriteKey(brandOrFamily);
  const base = Array.isArray(currentKeys) ? currentKeys : getShopFavorites(storage);
  if (!key) return base;
  const exists = base.includes(key);
  const next = exists ? base.filter((k) => k !== key) : [key, ...base];
  return setShopFavorites(next, storage);
}

/** Returns user's pinned brands that exist in the active country's catalogue, preserving pin order. */
export function pickFavoriteBrands(rows, favKeys) {
  if (!Array.isArray(rows) || !Array.isArray(favKeys) || favKeys.length === 0) return [];
  const byKey = new Map();
  for (const b of rows) {
    const k = brandFavoriteKey(b);
    if (k && !byKey.has(k)) byKey.set(k, b);
  }
  const out = [];
  for (const k of favKeys) {
    const hit = byKey.get(k);
    if (hit) out.push(hit);
  }
  return out;
}

/** Priority rank (`0..11`) if a brand matches one of the 12 flagship global brands, else `Infinity`. */
export function featuredBrandRank(brand) {
  if (!brand || typeof brand !== 'object') return Infinity;
  const label = `${brand.name ?? ''} ${brand.family ?? ''}`;
  for (let i = 0; i < FEATURED_BRAND_PATTERNS.length; i++) {
    if (FEATURED_BRAND_PATTERNS[i].rx.test(label)) return i;
  }
  return Infinity;
}

/**
 * Picks up to `limit` flagship best-seller brands available in `rows`.
 * Prefers in-stock cards and returns at most one card per flagship pattern
 * first (so three Visa variants don't crowd out Steam, Apple, and Spotify),
 * then backfills remaining flagship matches if space allows.
 */
export function pickFeaturedBrands(rows, limit = 12) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const candidates = rows
    .map((brand) => ({ brand, rank: featuredBrandRank(brand) }))
    .filter((x) => Number.isFinite(x.rank))
    .sort((a, b) => {
      if (Boolean(a.brand.outOfStock) !== Boolean(b.brand.outOfStock)) {
        return a.brand.outOfStock ? 1 : -1;
      }
      if (a.rank !== b.rank) return a.rank - b.rank;
      return String(a.brand.name ?? '').localeCompare(String(b.brand.name ?? ''));
    });

  const primary = [];
  const overflow = [];
  const seenRank = new Set();
  const seenId = new Set();

  for (const { brand, rank } of candidates) {
    const id = brand.id || brandFavoriteKey(brand);
    if (!id || seenId.has(id)) continue;
    seenId.add(id);
    if (!seenRank.has(rank)) {
      seenRank.add(rank);
      primary.push(brand);
    } else {
      overflow.push(brand);
    }
  }

  return [...primary, ...overflow].slice(0, Math.max(1, limit));
}

/** Smart sort: in-stock first -> user's pinned brands -> flagship priority -> alphabetical. */
export function sortShopBrands(rows, favKeys = []) {
  if (!Array.isArray(rows)) return [];
  const favSet = new Set(Array.isArray(favKeys) ? favKeys : []);
  return [...rows].sort((a, b) => {
    if (Boolean(a?.outOfStock) !== Boolean(b?.outOfStock)) {
      return a?.outOfStock ? 1 : -1;
    }
    const aFav = favSet.has(brandFavoriteKey(a));
    const bFav = favSet.has(brandFavoriteKey(b));
    if (aFav !== bFav) return aFav ? -1 : 1;
    const aRank = featuredBrandRank(a);
    const bRank = featuredBrandRank(b);
    if (aRank !== bRank) return aRank - bRank;
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  });
}

/**
 * Parses `brand.min` into an approximate USD numeric floor.
 * Returns `null` when `min` is missing, zero, negative, or unparseable.
 */
export function parseBrandMinUsdApprox(minRaw) {
  if (minRaw == null) return null;
  const s = String(minRaw).trim();
  if (!s) return null;
  const normalized = s.replace(/,/g, '');
  const numMatch = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const value = Number(numMatch[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const upper = normalized.toUpperCase();
  for (const [code, rate] of Object.entries(APPROX_USD_PER_UNIT)) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) return value * rate;
  }
  if (normalized.includes('€')) return value * APPROX_USD_PER_UNIT.EUR;
  if (normalized.includes('£')) return value * APPROX_USD_PER_UNIT.GBP;
  if (normalized.includes('₺')) return value * APPROX_USD_PER_UNIT.TRY;
  if (normalized.includes('₹')) return value * APPROX_USD_PER_UNIT.INR;
  if (normalized.includes('¥')) return value * APPROX_USD_PER_UNIT.JPY;
  return value;
}

/** Filters `rows` by a budget tier id (`'all' | '10' | '25' | '50' | '100'`). */
export function filterByBudget(rows, budgetId = 'all') {
  if (!Array.isArray(rows)) return [];
  const tier = BUDGET_TIERS.find((t) => t.id === String(budgetId));
  if (!tier || tier.max == null) return rows;
  return rows.filter((brand) => {
    const minUsd = parseBrandMinUsdApprox(brand?.min);
    return minUsd !== null && minUsd <= tier.max + 1e-6;
  });
}

/**
 * Scores how directly a brand satisfies one of the six Use-Case Hub cards:
 *   - `2`: direct native brand match (e.g. OpenAI / Rewarble / Visa on `ai`,
 *          Steam / PlayStation / Xbox on `gaming`)
 *   - `1`: compatible payment rail (e.g. Apple / Google Play in-app billing
 *          for `ai` & `trading`, or category tag match)
 *   - `0`: unrelated
 */
export function useCaseMatchScore(brand, useCaseId) {
  if (!brand || !useCaseId) return 0;
  const label = `${brand.name ?? ''} ${brand.family ?? ''}`.toLowerCase();
  const hay = brandHaystack(brand);
  const cat = String(brand.category ?? '').toLowerCase();

  switch (useCaseId) {
    case 'ai': {
      if (/\b(openai|chatgpt|claude|anthropic|midjourney|perplexity|rewarble|visa|mastercard|prepaid)\b/.test(label)) return 2;
      if (/\b(apple|itunes|app\s*store|google\s*play)\b/.test(label)) return 1;
      if (cat === 'e-money') return 1;
      return 0;
    }
    case 'trading': {
      if (/\b(tradingview|rewarble|visa|mastercard|paypal|payz|astropay|prepaid)\b/.test(label)) return 2;
      if (/\b(apple|itunes|app\s*store|google\s*play|neosurf|paysafecard|skrill|neteller)\b/.test(label)) return 1;
      if (cat === 'e-money') return 1;
      return 0;
    }
    case 'gaming': {
      if (/\b(steam|playstation|psn|xbox|nintendo|razer|roblox|riot|valorant|pubg|free\s*fire|blizzard|battle\.net|fortnite|epic\s*games|minecraft|ea\s*play|ea\s*sports)\b/.test(label)) return 2;
      if (/\b(games|gaming|esports)\b/.test(hay)) return 1;
      return 0;
    }
    case 'appstore': {
      if (/\b(apple|itunes|app\s*store|icloud|google\s*play)\b/.test(label)) return 2;
      return 0;
    }
    case 'streaming': {
      if (/\b(spotify|netflix|youtube|disney|hulu|twitch|crunchyroll|paramount|tidal|deezer|dazn|shahid|anghami|prime\s*video)\b/.test(label)) return 2;
      if (/\b(streaming|entertainment|music)\b/.test(hay)) return 1;
      if (/\b(apple|itunes|google\s*play)\b/.test(label)) return 1;
      return 0;
    }
    case 'virtualcard': {
      if (/\b(visa|mastercard|paypal|rewarble|payz|astropay|paysafecard|neosurf|skrill|neteller|venmo|cash\s*app|prepaid|virtual)\b/.test(label)) return 2;
      if (cat === 'e-money' || /\b(e-money|payment\s*card|virtual\s*card)\b/.test(hay)) return 1;
      return 0;
    }
    default:
      return 0;
  }
}

export function matchesUseCase(brand, useCaseId) {
  return useCaseMatchScore(brand, useCaseId) > 0;
}

export function filterByUseCase(rows, useCaseId, favKeys = []) {
  if (!Array.isArray(rows)) return [];
  if (!useCaseId) return sortShopBrands(rows, favKeys);
  const favSet = new Set(Array.isArray(favKeys) ? favKeys : []);
  return rows
    .map((brand) => ({ brand, score: useCaseMatchScore(brand, useCaseId) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (Boolean(a.brand.outOfStock) !== Boolean(b.brand.outOfStock)) {
        return a.brand.outOfStock ? 1 : -1;
      }
      if (a.score !== b.score) return b.score - a.score;
      const aFav = favSet.has(brandFavoriteKey(a.brand));
      const bFav = favSet.has(brandFavoriteKey(b.brand));
      if (aFav !== bFav) return aFav ? -1 : 1;
      const aRank = featuredBrandRank(a.brand);
      const bRank = featuredBrandRank(b.brand);
      if (aRank !== bRank) return aRank - bRank;
      return String(a.brand.name ?? '').localeCompare(String(b.brand.name ?? ''));
    })
    .map((x) => x.brand);
}

function toFiniteNonNegative(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatShortfallAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.ceil(n * 100) / 100;
  return rounded.toFixed(2).replace(/\.00$/, '');
}

/**
 * Computes balance sufficiency, shortfall, and 1-click internal swap routes
 * (`/swap` on EVM or `/solana` on Solana) for a selected denomination.
 *
 * Crucial safety invariant: `/swap`'s `amount=` query sets `fromToken` input
 * units, NOT `toToken` output units. Therefore `amount=` is ONLY appended when
 * `from` is the counterpart USD stablecoin (`USDT <-> USDC`), where 1 unit ≈ $1;
 * when swapping from volatile assets (ETH, BNB, SOL), `to`/`toMint` is
 * pre-selected cleanly without a misleading `from` unit count.
 */
export function buildSwapShortfallPlan({
  denom,
  pricingCoin = 'USDC',
  evmConnected = false,
  evmChainId = null,
  evmBalances = null,
  solConnected = false,
  solBalances = null
} = {}) {
  const coin = String(denom?.coin || pricingCoin || 'USDC').trim().toUpperCase() === 'USDT' ? 'USDT' : 'USDC';
  const otherCoin = coin === 'USDC' ? 'USDT' : 'USDC';
  const requiredAmount = toFiniteNonNegative(denom?.coinAmount);
  const spreadPct = typeof denom?.spreadPct === 'number' && Number.isFinite(denom.spreadPct)
    ? denom.spreadPct
    : null;

  const preferSolana = Boolean(solConnected && !evmConnected);
  const activeNetwork = preferSolana ? 'solana' : 'evm';
  const anyConnected = Boolean(evmConnected || solConnected);

  const activeBalances = preferSolana ? solBalances : evmBalances;
  const walletBalance = anyConnected && activeBalances
    ? toFiniteNonNegative(activeBalances[coin])
    : null;
  const otherStableBalance = anyConnected && activeBalances
    ? toFiniteNonNegative(activeBalances[otherCoin])
    : null;

  const hasEnough = Boolean(
    anyConnected
    && walletBalance !== null
    && requiredAmount !== null
    && walletBalance + 1e-6 >= requiredAmount
  );

  const rawDeficit = (requiredAmount !== null && walletBalance !== null)
    ? Math.max(0, requiredAmount - walletBalance)
    : requiredAmount;
  const deficitAmount = rawDeficit !== null ? Math.ceil(rawDeficit * 100) / 100 : null;
  const deficitStr = formatShortfallAmount(deficitAmount);

  /* EVM internal swap URL (`/swap`) */
  const evmParams = new URLSearchParams();
  if (evmConnected && Number.isInteger(Number(evmChainId)) && Number(evmChainId) > 0) {
    evmParams.set('chain', String(evmChainId));
  }
  const evmOtherBal = evmBalances ? toFiniteNonNegative(evmBalances[otherCoin]) : null;
  if (evmConnected && evmOtherBal !== null && evmOtherBal > 0 && deficitStr) {
    evmParams.set('from', otherCoin);
    evmParams.set('to', coin);
    evmParams.set('amount', deficitStr);
  } else {
    evmParams.set('to', coin);
  }
  const evmSwapRoute = `/swap?${evmParams.toString()}`;

  /* Solana internal swap URL (`/solana`) */
  const solParams = new URLSearchParams();
  const targetMint = SOLANA_MAINNET_MINTS[coin];
  const otherMint = SOLANA_MAINNET_MINTS[otherCoin];
  const solOtherBal = solBalances ? toFiniteNonNegative(solBalances[otherCoin]) : null;
  if (solConnected && solOtherBal !== null && solOtherBal > 0 && deficitStr) {
    solParams.set('fromMint', otherMint);
    solParams.set('toMint', targetMint);
    solParams.set('amount', deficitStr);
  } else {
    solParams.set('fromMint', SOLANA_MAINNET_MINTS.SOL);
    solParams.set('toMint', targetMint);
  }
  const solanaSwapRoute = `/solana?${solParams.toString()}`;

  return {
    coin,
    otherCoin,
    requiredAmount,
    spreadPct,
    anyConnected,
    activeNetwork,
    walletBalance,
    otherStableBalance,
    hasEnough,
    deficitAmount,
    evmSwapRoute,
    solanaSwapRoute,
    primarySwapRoute: preferSolana ? solanaSwapRoute : evmSwapRoute
  };
}
