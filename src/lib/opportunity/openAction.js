/**
 * OPPORTUNITY — OPEN ACTION (where a card's button actually goes)
 * ---------------------------------------------------------------------------
 * «برای هر فرصت دکمه بازکردن باشد تا به صفحه توکن در اپ، یا هر فرصت پیدا شده
 *  مثل استخر بره»
 *
 * A card is only useful if its button lands somewhere real. This module is the
 * single mapping from one opportunity row to the in-app destination that best
 * serves it — and, when there is no honest in-app destination, to the feed's own
 * page with the label that says so. It never returns a route the app does not
 * mount (a dead button is worse than an external link).
 *
 * The precedence is deliberate:
 *   1. TOKEN PAGE    — when we know the CoinGecko id, the token screen is the
 *                      richest view (chart, forecast, swap). This is the case the
 *                      owner named first.
 *   2. EXECUTION     — a venue we can sign for (Aave/Compound/Morpho/Lido/Kamino
 *                      fork…) opens the Farm row itself, so «Open» is one tap
 *                      from a real position.
 *   3. SECTION       — no id and no venue means the family's own screen
 *                      (/farm, /loan, /smart-money, /discover) with the row's
 *                      chain as context.
 *   4. EXTERNAL      — the feed's own pool page, clearly marked as leaving.
 *   5. NONE          — nothing honest exists; the caller renders no button.
 */

const list = (v) => (Array.isArray(v) ? v : []);

/** Yield-feed chains → the /discover network filter value. */
const CHAIN_TO_FILTER = Object.freeze({
  ethereum: 'ethereum', bsc: 'bsc', polygon: 'polygon', arbitrum: 'arbitrum',
  optimism: 'optimism', base: 'base', avalanche: 'avalanche', solana: 'solana',
  linea: 'linea', sonic: 'sonic'
});

const chainKey = (c) => String(c ?? '').trim().toLowerCase();

/**
 * @typedef {object} OpenAction
 * @property {'token'|'farm'|'lending'|'smart-money'|'discover'|'external'|'none'} kind
 * @property {string|null} to      in-app route (null for external/none)
 * @property {string|null} href    external URL (external only)
 * @property {'fa'|'en'|object} labelKey  i18n key under `opportunities.open.*`
 */

/**
 * @param {object} opportunity a row from scanOpportunities()
 * @param {object} [caps]      capability flags: { speculation, spotTrade }
 * @returns {OpenAction}
 */
export function openActionFor(opportunity, caps = {}) {
  if (!opportunity) return { kind: 'none', to: null, href: null, labelKey: 'none' };
  const ref = opportunity.ref || {};
  const chain = chainKey(opportunity.chain);
  const symbol = String(opportunity.symbol || '').trim();

  /* ── 1 · token page ─────────────────────────────────────────────────────── */
  if (ref.tokenId) {
    return { kind: 'token', to: `/coin/${encodeURIComponent(ref.tokenId)}`, href: null, labelKey: 'token', symbol };
  }

  /* ── 2 · a pool row we can open in the Farm ─────────────────────────────── */
  if (ref.poolId && (opportunity.category === 'LIQUIDITY_POOL' || opportunity.category === 'FARMING')) {
    return {
      kind: 'farm',
      to: `/farm?tab=pools&pool=${encodeURIComponent(ref.poolId)}`,
      href: null, labelKey: 'pool', symbol
    };
  }
  if (ref.poolId && opportunity.category === 'LENDING') {
    return {
      kind: 'lending',
      to: `/farm?tab=market&pool=${encodeURIComponent(ref.poolId)}`,
      href: null, labelKey: 'lend', symbol
    };
  }

  /* ── 2b · an execution venue with no pool id: the in-app deposit rail ───── */
  if (ref.venue) {
    return {
      kind: opportunity.category === 'LENDING' ? 'lending' : 'farm',
      to: '/farm?tab=inapp',
      href: null,
      labelKey: opportunity.category === 'LENDING' ? 'lend' : 'pool',
      symbol
    };
  }

  /* ── 3 · the family's own screen ────────────────────────────────────────── */
  const filter = CHAIN_TO_FILTER[chain];
  switch (opportunity.category) {
    case 'ARBITRAGE':
      return {
        kind: 'discover',
        to: `/discover${chain ? `?network=${encodeURIComponent(chain)}` : ''}`,
        href: null, labelKey: 'compare', symbol
      };
    case 'WHALE_FLOW':
      return {
        kind: 'smart-money',
        to: `/smart-money${chain ? `?chain=${encodeURIComponent(chain)}` : ''}`,
        href: null, labelKey: 'whales', symbol
      };
    case 'EMERGING_TOKEN':
      return {
        kind: 'discover',
        to: `/discover?view=new${filter ? `&network=${filter}` : ''}`,
        href: null, labelKey: 'discover', symbol
      };
    case 'RWA':
      return { kind: 'discover', to: '/discover?category=rwa', href: null, labelKey: 'rwa', symbol };
    case 'LIQUIDITY_POOL':
    case 'FARMING':
      return { kind: 'farm', to: '/farm?tab=pools', href: null, labelKey: 'pool', symbol };
    case 'LENDING':
      return { kind: 'lending', to: '/loan', href: null, labelKey: 'lend', symbol };
    default:
      break;
  }

  /* ── 4 · the feed's own page ────────────────────────────────────────────── */
  if (ref.externalUrl) {
    return { kind: 'external', to: null, href: ref.externalUrl, labelKey: 'external', symbol };
  }

  /* ── 5 · nothing honest ─────────────────────────────────────────────────── */
  return { kind: 'none', to: null, href: null, labelKey: 'none', symbol };
}

/** A deep-link route to the analysis page for one row (or the scan). */
export function analysisRoute(opportunityId = null) {
  return opportunityId
    ? `/opportunities/${encodeURIComponent(opportunityId)}`
    : '/opportunities';
}

/**
 * The "why this matched" line for the scanner room: the first evidence row,
 * already formatted by the engine, with its type as the machine-readable tag.
 */
export function primaryReason(opportunity) {
  const first = list(opportunity?.evidence)[0];
  if (!first) return null;
  return { type: first.type ?? null, detail: String(first.detail ?? '') };
}

/** Category tone for the card ring / icon colour. Kept next to the routes so a
    new family cannot ship without a colour. */
export const CATEGORY_TONE = Object.freeze({
  LIQUIDITY_POOL: 'cyan',
  FARMING: 'mint',
  LENDING: 'sky',
  ARBITRAGE: 'amber',
  EMERGING_TOKEN: 'violet',
  RWA: 'gold',
  WHALE_FLOW: 'rose'
});

export const RISK_TONE = Object.freeze({
  LOW: 'mint', MEDIUM: 'amber', HIGH: 'rose', CRITICAL: 'rose', UNKNOWN: 'slate'
});

/** Remaining validity of an opportunity, in ms (never negative). */
export function msRemaining(opportunity, now = Date.now()) {
  const at = Number(opportunity?.expiresAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now);
}
