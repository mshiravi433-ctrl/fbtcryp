/**
 * PROTOCOL MARKS — a logo for every pool, without shipping a logo library.
 * ---------------------------------------------------------------------------
 * «قبل از اسم هر استخر یک آیکون مدرن از خود پروتکل/استخر لازم است»
 *
 * Farm listed pools with the CHAIN coin as their picture: an ETH disc in front
 * of «Aave v3», another ETH disc in front of «Lido», another in front of
 * «Pendle». Three different protocols, one identical dot — so the row's only
 * visual anchor carried no information, and scanning the list by eye was
 * impossible. The chain is already spelled out in the meta line; the tile in
 * front of the name should answer «which protocol», not «which chain».
 *
 * WHY NOT fetch the real logos? Two reasons, both practical:
 *
 *   1 · This app is built to work when the network is not. `lib/assetIconData.js`
 *       vendors its coin artwork as inline SVG for exactly that reason, and a
 *       remote `icons.defillama.com` URL would be a blank circle in a tunnel, on
 *       a plane, and inside the packaged app for two seconds on every row — and
 *       a pool row that is missing its logo looks broken in a way a missing
 *       price does not.
 *   2 · 28+ slugs here, hundreds in the feed, and a trademark-accurate copy of
 *       each is not something hand-drawing can promise. A wrong Aave is worse
 *       than an honest monogram: users judge a wallet by how carefully it draws
 *       the things they sign.
 *
 * So a mark is GENERATED, deterministically: the protocol's brand hue pair
 * where we know them, a hash of the slug otherwise; the initial letter; and a
 * small geometric accent that encodes the KIND of venue (lending, DEX pool,
 * auto-compounding vault, liquid staking, perp) so related pools look related.
 * Same slug → same mark, every render, offline, in the app and on the web, and
 * an unknown protocol still gets a stable, distinct tile instead of a hole.
 */

/**
 * Brand-adjacent hues, from each protocol's own palette. `accent` is one of
 * KIND_ACCENTS below. These are approximations chosen so a row reads at 34px,
 * not reproductions of the official marks.
 */
export const PROTOCOL_MARKS = {
  /* lending */
  'aave-v3': { from: '#b6509e', to: '#2ebac6', accent: 'lending' },
  'aave-v2': { from: '#b6509e', to: '#2ebac6', accent: 'lending' },
  'compound-v3': { from: '#00d395', to: '#00915f', accent: 'lending' },
  'compound-v2': { from: '#00d395', to: '#00915f', accent: 'lending' },
  morpho: { from: '#3b82f6', to: '#1d4ed8', accent: 'lending' },
  'morpho-blue': { from: '#3b82f6', to: '#1d4ed8', accent: 'lending' },
  'benqi-lending': { from: '#93c5fd', to: '#2563eb', accent: 'lending' },
  'venus-v1': { from: '#ffd75e', to: '#c98a12', accent: 'lending' },
  /* liquid staking / auto-compounding tokens */
  lido: { from: '#7dd3fc', to: '#0ea5e9', accent: 'staking' },
  'rocket-pool': { from: '#ff6b3d', to: '#d1341a', accent: 'staking' },
  'binance-staked-eth': { from: '#f0b90b', to: '#b8860b', accent: 'staking' },
  'ether.fi-stake': { from: '#6ee7b7', to: '#059669', accent: 'staking' },
  'jito-liquid-staking': { from: '#fde68a', to: '#f59e0b', accent: 'staking' },
  'marinade-liquid-staking': { from: '#c4b5fd', to: '#7c3aed', accent: 'staking' },
  'jupiter-staked-sol': { from: '#60a5fa', to: '#0f766e', accent: 'staking' },
  rocketpool: { from: '#ff6b3d', to: '#d1341a', accent: 'staking' },
  /* auto-compounding vaults */
  'yearn-finance': { from: '#06b6d4', to: '#0e7490', accent: 'vault' },
  'convex-finance': { from: '#34d399', to: '#047857', accent: 'vault' },
  beefy: { from: '#f97316', to: '#c2410c', accent: 'vault' },
  'vaults-dao': { from: '#06b6d4', to: '#0e7490', accent: 'vault' },
  /* AMM pools */
  'uniswap-v3': { from: '#ff5ca8', to: '#7c3aed', accent: 'pool' },
  'uniswap-v2': { from: '#ff5ca8', to: '#7c3aed', accent: 'pool' },
  'pancakeswap-amm': { from: '#f9a825', to: '#e65100', accent: 'pool' },
  'pancakeswap-amm-v3': { from: '#f9a825', to: '#e65100', accent: 'pool' },
  'sushi': { from: '#fa1996', to: '#9d174d', accent: 'pool' },
  'sushi_swap': { from: '#fa1996', to: '#9d174d', accent: 'pool' },
  'curve-dex': { from: '#ff6f91', to: '#6f42c1', accent: 'pool' },
  'balancer-v2': { from: '#ff6b9d', to: '#1f1f4b', accent: 'pool' },
  'aerodrome-slipstream': { from: '#4cc9f0', to: '#4361ee', accent: 'pool' },
  aerodrome: { from: '#4cc9f0', to: '#4361ee', accent: 'pool' },
  velodrome: { from: '#38bdf8', to: '#1e3a8a', accent: 'pool' },
  camelot: { from: '#a3e635', to: '#3f6212', accent: 'pool' },
  spookyswap: { from: '#c084fc', to: '#4c1d95', accent: 'pool' },
  'trader-joe': { from: '#22d3ee', to: '#0369a1', accent: 'pool' },
  woofi: { from: '#00d1b2', to: '#0b5e57', accent: 'pool' },
  /* structured yield / perps / bridges */
  pendle: { from: '#fbbf24', to: '#b45309', accent: 'pool' },
  gmx: { from: '#a78bfa', to: '#312e81', accent: 'perp' },
  'gmx-perps-v1': { from: '#a78bfa', to: '#312e81', accent: 'perp' },
  stargate: { from: '#facc15', to: '#7c3aed', accent: 'bridge' },
  'wombat-exchange': { from: '#22d3ee', to: '#155e75', accent: 'pool' },
  'magpie': { from: '#f472b6', to: '#9d174d', accent: 'vault' },
  'belt-finance': { from: '#f59e0b', to: '#92400e', accent: 'vault' }
};

/**
 * The geometric accent, drawn on a 32×32 box.
 *
 * ─── WHY EVERY SHAPE IS NOW A BERRY ─────────────────────────────────────────
 * «بقیه استخرها ایکون الان انگور زده … اگر از میوه‌های قرمز مثل گیلاس یا
 * آلبالو استفاده کنی قشنگ‌تره» — and they were right about the diagnosis. The
 * old set was built from bare DISCS (a ring, two overlapping circles), which at
 * 34px on a phone read as a bunch of grapes: three unrelated protocols in a row
 * all showed what looked like the same fruit, and the mark that is supposed to
 * answer «which protocol is this» answered nothing.
 *
 * So the accent family is redrawn as fruit — the *shapes* carry the meaning
 * that the discs used to fumble, and the colours stay the protocol's own:
 *
 *   lending  one berry under a three-point crown — a pomegranate, money held
 *            in something with a lid on it (the safest shape in the set)
 *   staking  a single cherry on its stalk with one leaf — one token growing
 *   vault    a cluster of three berries on one stem — layers compounding
 *   pool     two cherries on one stalk — two assets, one pool, and the pair
 *            reads as a pair at a glance (the old two-discs idea, kept)
 *   perp     a rising branch with a leaf — directional exposure that grows
 *   bridge   an arch carrying a berry at each end — the same asset, another
 *            chain, joined rather than stacked
 *
 * Every path is filled (berries) and/or stroked (stalks, leaves, crowns) by
 * `.farm-glyph-accent` in index.css, so one shape works on both themes.
 */
export const KIND_ACCENTS = {
  lending: 'M16 11.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2zM16 4.6l2.3 3.4h-4.6zM7.7 6.4l3.6 1.1-2.3 3.5zM24.3 6.4l-1.3 4.6-3.5-1.1z',
  staking: 'M16.4 12a7.1 7.1 0 1 1 0 14.2 7.1 7.1 0 0 1 0-14.2zM17.6 12.2c.3-2.9-.5-5.2-2.4-7M15.4 7.4c2.3-1.5 4.7-1.4 7.2.6-2.3 1.7-4.7 1.5-7.2-.6z',
  vault: 'M16 5.4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.4 17.2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM21.6 17.2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM16 10.4v6.4M13.2 18.6l2.8-1.8M18.8 18.6l-2.8-1.8',
  pool: 'M10.6 15.6a5.9 5.9 0 1 1 0 11.8 5.9 5.9 0 0 1 0-11.8zM21.4 15.6a5.9 5.9 0 1 1 0 11.8 5.9 5.9 0 0 1 0-11.8zM10.6 16.4c.2-3.4 1.9-6 5.4-8M21.4 16.4c-.1-1.6-.6-3-1.5-4.3M15.8 8.2c1.7-1.2 3.6-1.1 5.6.4-1.8 1.4-3.6 1.3-5.6-.4z',
  perp: 'M4.6 25.4c4.6-1.1 7.8-3.2 10.1-6.1 2.3-3 3.8-6.5 4.9-10.4l3.5 1c-1.2 4.4-3 8.4-5.7 11.9-2.9 3.7-6.9 6.2-12.4 7.3zM20.8 4.6c3-.7 5.7.3 8.4 3-2.8 2.7-5.5 3.3-8.4 2.7z',
  bridge: 'M5.4 20.8a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6zM26.6 20.8a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6zM5.6 22.6C7.1 13 11.2 7.4 16 7.4s8.9 5.6 10.4 15.2h-3.3C21.7 14.6 19.3 11 16 11s-5.7 3.6-7.1 11.6z'
};

/** The letter is drawn, not typed — a font swap must not change a pool's mark. */
const LETTER_HINT = { /* slugs whose first letter is ambiguous are spelled out */
  'ether.fi-stake': 'E',
  'binance-staked-eth': 'B',
  woofi: 'W'
};

/**
 * BERRY_HUES — the palette an UNCATALOGUED protocol falls back to.
 *
 * ─── WHY THE FALLBACK IS NO LONGER THE WHOLE HUE WHEEL ──────────────────────
 * It used to be, and that was the other half of the complaint above. A feed row
 * for a protocol we have not catalogued could land anywhere on the wheel, so
 * one screen mixed grape-purple, mint, amber and cyan tiles that looked like
 * six different design systems — and none of them this app's. On top of the
 * disc-shaped accents, the whole list read as «انگور زده».
 *
 * Every hue below is a RED FRUIT — cherry, sour cherry, pomegranate,
 * raspberry, redcurrant, watermelon, mulberry — plus one deep blackcurrant
 * plum. `hashHue` still derives the slot from the slug, so two unknowns never
 * collide into one tile and a protocol keeps its colour between reloads; what
 * changed is that the family is coherent. Catalogued protocols keep THEIR OWN
 * brand colours, because an Aave tile that is not Aave's colour is a worse lie
 * than an ugly one.
 */
const BERRY_HUES = Object.freeze([
  { hue: 348, sat: 82, light: 84 }, // cherry
  { hue: 356, sat: 78, light: 78 }, // sour cherry
  { hue: 12, sat: 76, light: 78 },  // pomegranate
  { hue: 330, sat: 74, light: 80 }, // raspberry
  { hue: 20, sat: 82, light: 80 },  // redcurrant / watermelon
  { hue: 318, sat: 62, light: 76 }, // mulberry
  { hue: 288, sat: 54, light: 74 }  // blackcurrant
]);

function hashHue(slug) {
  let h = 2166136261;
  const s = String(slug || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % BERRY_HUES.length;
}

/** One stop of a berry ramp; `deep` darkens the foot of the gradient. */
function fromHue(berry, deep) {
  const sat = Math.max(30, berry.sat - (deep ? 10 : 0));
  const light = deep ? Math.max(28, berry.light - 34) : berry.light;
  return `hsl(${berry.hue} ${sat}% ${light}%)`;
}

/**
 * @param {string} slug  the feed's `project` value, e.g. 'aave-v3'
 * @returns {{from:string,to:string,accent:string,letter:string,known:boolean}}
 */
export function protocolMark(slug) {
  const key = String(slug || '').trim().toLowerCase();
  const known = PROTOCOL_MARKS[key];
  if (known) {
    return {
      from: known.from,
      to: known.to,
      accent: known.accent || 'pool',
      letter: LETTER_HINT[key] || (key.replace(/[^a-z0-9]/g, ' ').trim()[0] || '?').toUpperCase(),
      known: true
    };
  }
  /* An unseen protocol still gets its OWN tile, stable across renders: the hue
     comes from the slug, so two unknowns never collide into the same grey blob
     and a protocol keeps its colour between reloads. */
  const hue = hashHue(key);
  const words = key.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return {
    from: fromHue(hue, false),
    to: fromHue(hue, true),
    accent: guessAccent(key),
    letter: (words[0] || '?').charAt(0).toUpperCase(),
    known: false
  };
}

/** Vocabulary, not a registry: a slug says what it is in its own name. */
function guessAccent(slug) {
  const s = String(slug || '');
  if (/lend|borrow|margin|radio/.test(s)) return 'lending';
  if (/staking|stake|steth|stsol|liquid-st/.test(s)) return 'staking';
  if (/vault|yield|aggregator|beefy|yearn|convex|money-market/.test(s)) return 'vault';
  if (/perp|futures|orderly|drift/.test(s)) return 'perp';
  if (/bridge|stargate|hop|across|layerzero/.test(s)) return 'bridge';
  return 'pool';
}

/**
 * The token legs of a pool, for the small badge on the tile. `pool.symbol` is
 * 'WBTC-WETH' / 'USDC-USDT' / 'stETH' — split it so the badge shows what is
 * actually being deposited, which is the second question a yield list raises.
 */
export function poolLegs(pool, max = 2) {
  const sym = String(pool?.symbol || '').trim();
  if (!sym) return [];
  const parts = sym
    .split(/[-/·|]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= 12);
  return parts.slice(0, max);
}
