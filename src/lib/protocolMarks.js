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
 * The geometric accent, drawn on a 32×32 box and always white at 92% so it
 * reads on every gradient. Five shapes, five ideas:
 *   lending  an arch over a base — money placed under protection
 *   staking  a ring with a dot   — one token growing inside its own circle
 *   vault    three stacked bars  — layers of compounding
 *   pool     two overlapping discs — two assets, one pool
 *   perp     a rising line       — directional exposure
 *   bridge   two posts and a span — the same asset, another chain
 */
export const KIND_ACCENTS = {
  lending: 'M8 24V16.2a8 8 0 0 1 16 0V24h-3.4v-7.8a4.6 4.6 0 0 0-9.2 0V24z',
  staking: 'M16 5.6a10.4 10.4 0 1 0 0 20.8 10.4 10.4 0 0 0 0-20.8zm0 3.4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 4.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',
  vault: 'M6.4 8.6h19.2v3.6H6.4zm0 5.8h19.2v3.6H6.4zm0 5.8h13v3.6h-13z',
  pool: 'M12.6 9.4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm6.8 0a7 7 0 1 1 0 14 7 7 0 0 1 0-14z',
  perp: 'M6 22.4 13 15l4.4 4.2L26 9.6v3.2h3.2V5.6h-7.2v3.2h3.06L17.2 15.2 12.8 11 4 19.8z',
  bridge: 'M5 22.6V13h3.2v9.6zm18.8 0V13H27v9.6zM5 13a11 11 0 0 1 22 0H24a8.9 8.9 0 0 0-16 0z'
};

/** The letter is drawn, not typed — a font swap must not change a pool's mark. */
const LETTER_HINT = { /* slugs whose first letter is ambiguous are spelled out */
  'ether.fi-stake': 'E',
  'binance-staked-eth': 'B',
  woofi: 'W'
};

function hashHue(slug) {
  let h = 2166136261;
  const s = String(slug || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

function fromHue(hue, light) {
  return `hsl(${hue} ${light ? 88 : 72}% ${light ? 72 : 42}%)`;
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
    from: fromHue(hue, true),
    to: fromHue((hue + 18) % 360, false),
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
