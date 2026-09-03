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
  swap: 1, // every confirmed swap, repeatable
  addLiquidity: 150,
  dailyCheckin: 15,
  streakBonus: 10, // × streak day
  quest: 50,
  shareApp: 30,
  connectWallet: 100,
  backupWallet: 75,
  enable2fa: 60,
  /* Intent AI — using the assistant is part of the product now, and the
     points screen says where points come from, so the AI names its own.
     A real broadcast is the rare, valuable event and pays the most. */
  intentAiPlan: 10, // a structured plan made it to the confirmation screen
  intentAiExecuted: 25, // an intent actually reached a network (real txHash)

  /* Product activity — the same table the rewards engine enforces server-side
     (server/rewards/config.js). Only WIRED products appear here: a row that
     nothing can emit is a fake reward, so bridge/lending/borrow/goals/lab/
     token analysis live here because their screens really emit, and
     dydx/futures/lp/security analysis deliberately do not (yet). */
  bridge: 60, // one confirmed cross-chain move
  lending: 80, // a confirmed supply/collateral deposit
  borrow: 100, // a confirmed borrow
  repay: 30, // a confirmed repay
  withdraw: 20, // a confirmed withdraw
  goals: 40, // one real goal created (server-stored)
  lab: 15, // one lab challenge completed (once per scenario)
  tokenAnalysis: 25 // a token analysed on the Signals verdict surface
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
/* No ranking, by design                                                       */
/* -------------------------------------------------------------------------- */

/*
 * ─── THIS FILE ONCE HELD FIFTY INVENTED RIVALS, THEN A REAL BOARD, NOW NONE ─
 * First it exported `buildLeaderboard()` and a `SEED_NAMES` list of fifty
 * handles — CryptoFalcon, MoonHunter, PersianBull — so a brand-new user opened
 * the board and found fifty strangers already above them. Those were deleted
 * as a lie the user could catch by scrolling.
 *
 * The real API board that replaced them is now gone too, on the owner's
 * instruction: the screen shows only your own points and compares you with
 * nobody. `TOP_N` went with it — it capped how many rows of OTHER people were
 * rendered, and there are no other people on the screen to cap.
 *
 * What remains is deliberately small: the tiers you climb on your own, and the
 * table of what each action is worth. Both are used by the points screen and
 * by the Earn screen, and they are the only two things a private score needs.
 */
