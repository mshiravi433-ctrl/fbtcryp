/**
 * Reputation points and rank tiers.
 *
 * Replaces the old "virtual NX credits" reward, which implied a balance that
 * looked like money but could never be withdrawn — a confusing and slightly
 * dishonest signal in an app where other screens move real funds.
 *
 * Points are explicitly a score, not a currency: they buy nothing, transfer to
 * nobody, and the UI never renders them next to a fiat symbol. What they do is
 * rank you against other users, which is a real incentive without pretending
 * to be value.
 */

export const TIERS = [
  { id: 'bronze', min: 0, color: '#cd7f32', glow: 'rgba(205,127,50,.5)', icon: '🥉' },
  { id: 'silver', min: 500, color: '#c0c8d4', glow: 'rgba(192,200,212,.5)', icon: '🥈' },
  { id: 'gold', min: 2000, color: '#ffc93c', glow: 'rgba(255,201,60,.55)', icon: '🥇' },
  { id: 'platinum', min: 6000, color: '#4dd0e1', glow: 'rgba(77,208,225,.55)', icon: '💠' },
  { id: 'diamond', min: 15000, color: '#b388ff', glow: 'rgba(179,136,255,.6)', icon: '💎' },
  { id: 'legend', min: 40000, color: '#ff2d95', glow: 'rgba(255,45,149,.6)', icon: '👑' }
];

/** Points awarded per action. Weighted toward things that build the product. */
export const POINT_VALUES = {
  referral: 250, // highest — a new user is worth far more than a tap
  firstSwap: 300,
  swap: 40, // repeatable, scaled by volume elsewhere
  addLiquidity: 150,
  dailyCheckin: 15,
  streakBonus: 10, // × streak day
  quest: 50,
  shareApp: 30,
  connectWallet: 100,
  backupWallet: 75,
  enable2fa: 60
};

export function tierFor(points) {
  let current = TIERS[0];
  for (const t of TIERS) if (points >= t.min) current = t;
  return current;
}

export function nextTier(points) {
  return TIERS.find((t) => t.min > points) ?? null;
}

/** Progress toward the next tier, 0..1. Returns 1 at the top tier. */
export function tierProgress(points) {
  const cur = tierFor(points);
  const next = nextTier(points);
  if (!next) return 1;
  const span = next.min - cur.min;
  return span > 0 ? Math.min(1, (points - cur.min) / span) : 1;
}

/* -------------------------------------------------------------------------- */
/* Leaderboard                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Seed entries for the leaderboard.
 *
 * An empty leaderboard makes a new app look abandoned, so the board is
 * pre-populated. These are clearly-labelled sample entries — the UI marks the
 * list as a demo board until a real backend supplies live rankings, because
 * passing invented users off as real ones would be a lie a user could later
 * catch, and that costs more trust than an empty list ever would.
 *
 * Names are generic handles, deliberately not real people.
 */
const SEED_NAMES = [
  'CryptoFalcon', 'AliTrader', 'MoonHunter', 'SaraFX', 'BlockSmith', 'ZarrinCoin',
  'NightSwap', 'PersianBull', 'DeFiNomad', 'ShahinX', 'TokenWolf', 'ArzDigital',
  'HodlKing', 'NovaTrade', 'ParsChain', 'SilkRoute', 'AtlasFin', 'YaldaCrypto',
  'IronLedger', 'SwiftSwap', 'KavehOne', 'MetaVahid', 'BazaarPro', 'CyrusCap',
  'OrionDeFi', 'RoyaTrade', 'SepehrX', 'GoldenPars', 'ChainMehdi', 'VelvetBull',
  'AmirLiquid', 'QuantumRial', 'DariushFX', 'NeonTrader', 'FarsiWhale', 'EchoStake',
  'TitanArz', 'LunaKaveh', 'RapidHodl', 'ZenithSwap', 'MahsaChain', 'BorjTrade',
  'PixelYield', 'SamanBlock', 'ArashDeFi', 'CobaltFin', 'NimaSwaps', 'HelixArz',
  'RostamCap', 'AzarLedger'
];

/**
 * Deterministic pseudo-random so the board is stable between renders —
 * a leaderboard that reshuffles on every navigation looks broken.
 */
function seeded(i, salt = 0) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function buildLeaderboard(userPoints = 0, username = '') {
  const rows = SEED_NAMES.map((name, i) => {
    // Steep decay so the top looks competitive and the tail looks reachable
    const base = Math.round(52000 * Math.pow(0.93, i) + seeded(i) * 400);
    return {
      id: `seed-${i}`,
      name,
      points: base,
      swaps: Math.round(20 + seeded(i, 3) * 400),
      referrals: Math.round(seeded(i, 7) * 60),
      seed: true
    };
  });

  if (userPoints > 0 || username) {
    rows.push({
      id: 'me',
      name: username || 'You',
      points: userPoints,
      swaps: 0,
      referrals: 0,
      isUser: true
    });
  }

  rows.sort((a, b) => b.points - a.points);
  return rows.map((r, i) => ({ ...r, rank: i + 1, tier: tierFor(r.points) }));
}

export const TOP_N = 50;
