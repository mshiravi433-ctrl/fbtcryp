/**
 * ACHIEVEMENTS — derived from the REAL points ledger, never from a timer.
 * ---------------------------------------------------------------------------
 * Every row below is a pure function of state the app already has:
 * `points`, `pointsLog`, `streak`, the server-confirmed referral count and the
 * soulbound badge collection. No achievement can be "claimed" by tapping it
 * and none of them mints points on its own.
 *
 * `tier` chooses which 3D animal represents the row, reusing the same
 * bronze→legend mapping as the wheel and the NFT shelf. `progress` is 0..1 for
 * the locked rows, so the UI can show an honest distance instead of a generic
 * padlock.
 *
 * The list is deliberately wide: this is the DISCOVERY wall of the rewards
 * tab. Twenty-eight cards, each one a different verifiable thing the user
 * has actually done, each one unlocking a different animal — so the shelf
 * always has a next card to hunt for.
 */
import { TIERS } from '../ranks.js';

const has = (log, actions) => (Array.isArray(log) ? log : []).some((row) => {
  const action = String(row?.action ?? '');
  if (actions.includes(action)) return true;
  return actions.some((wanted) => action.startsWith(`${wanted}:`));
});

/** How many ledger rows match the given actions (prefix-aware). */
const count = (log, actions) => (Array.isArray(log) ? log : []).filter((row) => {
  const action = String(row?.action ?? '');
  if (actions.includes(action)) return true;
  return actions.some((wanted) => action.startsWith(`${wanted}:`));
}).length;

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const ratio = (value, target) => clamp01(Number(value || 0) / target);

/**
 * @typedef {Object} AchievementInput
 * @property {number} points
 * @property {number} streak
 * @property {number} referrals
 * @property {Array} pointsLog
 * @property {Array} nfts
 */

/** Ordered by difficulty; the UI renders them in this order. */
export const ACHIEVEMENT_DEFS = [
  /* ── the first light ─────────────────────────────────────────────────── */
  {
    id: 'firstLight',
    tier: 'bronze',
    test: (s) => Number(s.points) > 0,
    progress: (s) => (Number(s.points) > 0 ? 1 : 0)
  },
  {
    id: 'streak3',
    tier: 'bronze',
    test: (s) => Number(s.streak) >= 3,
    progress: (s) => ratio(s.streak, 3)
  },

  /* ── the wallet ─────────────────────────────────────────────────────── */
  {
    id: 'walletOn',
    tier: 'silver',
    test: (s) => has(s.pointsLog, ['connectWallet', 'quest:connectWallet']),
    progress: (s) => (has(s.pointsLog, ['connectWallet', 'quest:connectWallet']) ? 1 : 0)
  },
  {
    id: 'backupKey',
    tier: 'silver',
    test: (s) => has(s.pointsLog, ['backupWallet', 'quest:backupWallet']),
    progress: (s) => (has(s.pointsLog, ['backupWallet', 'quest:backupWallet']) ? 1 : 0)
  },
  {
    id: 'twoFactor',
    tier: 'silver',
    test: (s) => has(s.pointsLog, ['enable2fa', 'quest:enable2fa']),
    progress: (s) => (has(s.pointsLog, ['enable2fa', 'quest:enable2fa']) ? 1 : 0)
  },
  {
    id: 'rank500',
    tier: 'silver',
    test: (s) => Number(s.points) >= 500,
    progress: (s) => ratio(s.points, 500)
  },

  /* ── the market ─────────────────────────────────────────────────────── */
  {
    id: 'firstSwap',
    tier: 'gold',
    test: (s) => has(s.pointsLog, ['firstSwap', 'quest:firstSwap', 'swap']),
    progress: (s) => (has(s.pointsLog, ['firstSwap', 'quest:firstSwap', 'swap']) ? 1 : 0)
  },
  {
    id: 'swaps5',
    tier: 'gold',
    test: (s) => count(s.pointsLog, ['swap']) >= 5,
    progress: (s) => ratio(count(s.pointsLog, ['swap']), 5)
  },
  {
    id: 'swaps25',
    tier: 'gold',
    test: (s) => count(s.pointsLog, ['swap']) >= 25,
    progress: (s) => ratio(count(s.pointsLog, ['swap']), 25)
  },
  {
    id: 'crossChain',
    tier: 'gold',
    test: (s) => has(s.pointsLog, ['bridge']),
    progress: (s) => (has(s.pointsLog, ['bridge']) ? 1 : 0)
  },
  {
    id: 'lender',
    tier: 'gold',
    test: (s) => has(s.pointsLog, ['lending']),
    progress: (s) => (has(s.pointsLog, ['lending']) ? 1 : 0)
  },
  {
    id: 'borrower',
    tier: 'gold',
    test: (s) => has(s.pointsLog, ['borrow']),
    progress: (s) => (has(s.pointsLog, ['borrow']) ? 1 : 0)
  },
  {
    id: 'rank2000',
    tier: 'gold',
    test: (s) => Number(s.points) >= 2000,
    progress: (s) => ratio(s.points, 2000)
  },

  /* ── the rituals ────────────────────────────────────────────────────── */
  {
    id: 'wheelTurn',
    tier: 'platinum',
    test: (s) => has(s.pointsLog, ['wheel']),
    progress: (s) => (has(s.pointsLog, ['wheel']) ? 1 : 0)
  },
  {
    id: 'learned',
    tier: 'platinum',
    test: (s) => has(s.pointsLog, ['learn']),
    progress: (s) => (has(s.pointsLog, ['learn']) ? 1 : 0)
  },
  {
    id: 'streak7',
    tier: 'platinum',
    test: (s) => Number(s.streak) >= 7,
    progress: (s) => ratio(s.streak, 7)
  },
  {
    id: 'referrer',
    tier: 'platinum',
    test: (s) => Number(s.referrals) >= 1,
    progress: (s) => ratio(s.referrals, 1)
  },
  {
    id: 'goalSetter',
    tier: 'platinum',
    test: (s) => has(s.pointsLog, ['goals']),
    progress: (s) => (has(s.pointsLog, ['goals']) ? 1 : 0)
  },
  {
    id: 'labRat',
    tier: 'platinum',
    test: (s) => has(s.pointsLog, ['lab']),
    progress: (s) => (has(s.pointsLog, ['lab']) ? 1 : 0)
  },
  {
    id: 'analyst',
    tier: 'platinum',
    test: (s) => has(s.pointsLog, ['tokenAnalysis']),
    progress: (s) => (has(s.pointsLog, ['tokenAnalysis']) ? 1 : 0)
  },
  {
    id: 'rank6000',
    tier: 'platinum',
    test: (s) => Number(s.points) >= 6000,
    progress: (s) => ratio(s.points, 6000)
  },

  /* ── the deep game ──────────────────────────────────────────────────── */
  {
    id: 'streak30',
    tier: 'diamond',
    test: (s) => Number(s.streak) >= 30,
    progress: (s) => ratio(s.streak, 30)
  },
  {
    id: 'referrer3',
    tier: 'diamond',
    test: (s) => Number(s.referrals) >= 3,
    progress: (s) => ratio(s.referrals, 3)
  },
  {
    id: 'collector',
    tier: 'diamond',
    test: (s) => (Array.isArray(s.nfts) ? s.nfts.length : 0) >= 3,
    progress: (s) => ratio((Array.isArray(s.nfts) ? s.nfts.length : 0), 3)
  },
  {
    id: 'rank15000',
    tier: 'diamond',
    test: (s) => Number(s.points) >= 15000,
    progress: (s) => ratio(s.points, 15000)
  },

  /* ── the top of the ladder ──────────────────────────────────────────── */
  {
    id: 'referrer9',
    tier: 'legend',
    test: (s) => Number(s.referrals) >= 9,
    progress: (s) => ratio(s.referrals, 9)
  },
  {
    id: 'curator',
    tier: 'legend',
    test: (s) => (Array.isArray(s.nfts) ? s.nfts.length : 0) >= 6,
    progress: (s) => ratio((Array.isArray(s.nfts) ? s.nfts.length : 0), 6)
  },
  {
    id: 'legend',
    tier: 'legend',
    test: (s) => Number(s.points) >= 40000,
    progress: (s) => ratio(s.points, 40000)
  }
];

export function achievementsFor({ points = 0, streak = 0, referrals = 0, pointsLog = [], nfts = [] } = {}) {
  const state = { points, streak, referrals, pointsLog, nfts };
  return ACHIEVEMENT_DEFS.map((def) => {
    const earned = Boolean(def.test(state));
    return {
      id: def.id,
      tier: def.tier,
      tierMeta: TIERS.find((t) => t.id === def.tier) ?? TIERS[0],
      earned,
      progress: earned ? 1 : def.progress(state)
    };
  });
}

/** The subset that just became true — what `markAchievement` should persist. */
export function newlyEarned(input, stored = {}) {
  return achievementsFor(input)
    .filter((row) => row.earned && !stored?.[row.id])
    .map((row) => row.id);
}
