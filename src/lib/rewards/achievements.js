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
 */
import { TIERS } from '../ranks.js';

const has = (log, actions) => (Array.isArray(log) ? log : []).some((row) => {
  const action = String(row?.action ?? '');
  if (actions.includes(action)) return true;
  return actions.some((wanted) => action.startsWith(`${wanted}:`));
});

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

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
  {
    id: 'firstLight',
    tier: 'bronze',
    test: (s) => Number(s.points) > 0,
    progress: (s) => (Number(s.points) > 0 ? 1 : 0)
  },
  {
    id: 'walletOn',
    tier: 'silver',
    test: (s) => has(s.pointsLog, ['connectWallet', 'quest:connectWallet']),
    progress: (s) => (has(s.pointsLog, ['connectWallet', 'quest:connectWallet']) ? 1 : 0)
  },
  {
    id: 'firstSwap',
    tier: 'gold',
    test: (s) => has(s.pointsLog, ['firstSwap', 'quest:firstSwap', 'swap']),
    progress: (s) => (has(s.pointsLog, ['firstSwap', 'quest:firstSwap', 'swap']) ? 1 : 0)
  },
  {
    id: 'streak7',
    tier: 'platinum',
    test: (s) => Number(s.streak) >= 7,
    progress: (s) => clamp01(Number(s.streak) / 7)
  },
  {
    id: 'referrer',
    tier: 'gold',
    test: (s) => Number(s.referrals) >= 1,
    progress: (s) => clamp01(Number(s.referrals) / 1)
  },
  {
    id: 'collector',
    tier: 'diamond',
    test: (s) => (Array.isArray(s.nfts) ? s.nfts.length : 0) >= 3,
    progress: (s) => clamp01((Array.isArray(s.nfts) ? s.nfts.length : 0) / 3)
  },
  {
    id: 'legend',
    tier: 'legend',
    test: (s) => Number(s.points) >= 40000,
    progress: (s) => clamp01(Number(s.points) / 40000)
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
