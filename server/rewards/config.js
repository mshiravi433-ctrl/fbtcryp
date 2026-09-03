/**
 * FBT REWARDS — canonical configuration.
 * ---------------------------------------------------------------------------
 * One definition of what is rewarded, how much, how often and how it is
 * verified. The rewards engine (engine.js) is pure: every number it applies
 * comes from this file, so a rule change is a config change, not a code
 * archaeology project.
 *
 * ─── THE NO-FAKE RULES THIS CONFIG ENFORCES ────────────────────────────────
 * · A point value exists only for an activity the app can actually emit with
 *   evidence. If a product cannot produce a real event (e.g. an LP flow that
 *   does not exist yet) its action is defined with `live:false` and the UI
 *   never lists it as earnable.
 * · `verify: 'rpc'` actions are credited only after the submitted transaction
 *   hash is confirmed on-chain (existing server RPC infra in chainIntel.js).
 * · `once: true` actions are credited once per account, forever.
 * · Daily caps bound everything else, so a client bug or a farming script can
 *   inflate the LOCAL ledger but never the server ledger.
 *
 * The values intentionally match src/lib/ranks.js POINT_VALUES for the
 * actions that exist client-side (swap, firstSwap, referral share, daily
 * check-in, quests). The engine is authoritative; the client mirrors it so the
 * number shown in the moment a swap completes equals the number that lands.
 */

/** Reward levels — configurable bands, Bronze → Diamond (spec §6). */
export const LEVELS = Object.freeze([
  { id: 'bronze', index: 0, min: 0 },
  { id: 'silver', index: 1, min: 500 },
  { id: 'gold', index: 2, min: 2000 },
  { id: 'platinum', index: 3, min: 6000 },
  { id: 'diamond', index: 4, min: 15000 }
]);

/** An action definition. */
/**
 * @typedef {Object} ActionDef
 * @property {number} points        - points awarded per credited event
 * @property {'rpc'|'lenient'|'none'} verify
 *   rpc     — an EVM/Solana txHash is REQUIRED and verified on-chain before
 *             credit. Used for money-moving actions.
 *   lenient — a txHash is verified when the chain can answer; if the RPC is
 *             unavailable the event is still credited (bounded by dailyCap)
 *             rather than silently dropping a real user's activity.
 *   none    — no on-chain evidence exists (check-in, goal creation, an
 *             analysis run). Credited from the idempotent event alone.
 * @property {boolean} [once]       - at most one credit per account, ever.
 * @property {number} [dailyCap]    - max credited events per local day.
 * @property {boolean} [live]       - false = product/flow not launched; the
 *                                    action exists so wiring lights it up.
 * @property {string} [kind]        - grouping used by missions/achievements.
 * @property {boolean} [qualifiesReferral] - an invited wallet performing this
 *                                    action counts as the qualifying activity.
 */
export const ACTIONS = Object.freeze({
  /* real, on-chain swap — credited once per confirmed transaction */
  swap: { points: 1, verify: 'lenient', dailyCap: 50, kind: 'trade', qualifiesReferral: true },
  /* first confirmed swap, once per account */
  firstSwap: { points: 300, verify: 'none', once: true, kind: 'milestone' },

  /* cross-chain bridge move with a confirmed tx */
  bridge: { points: 60, verify: 'lenient', dailyCap: 20, kind: 'move', qualifiesReferral: true },

  /* lending vault / protocol deposit (Loan page, real Aave V3 tx) */
  lending: { points: 80, verify: 'lenient', dailyCap: 10, kind: 'lend', qualifiesReferral: true },
  borrow: { points: 100, verify: 'lenient', dailyCap: 10, kind: 'borrow', qualifiesReferral: true },
  repay: { points: 30, verify: 'lenient', dailyCap: 10, kind: 'borrow' },
  withdraw: { points: 20, verify: 'lenient', dailyCap: 10, kind: 'lend' },

  /* LP / vault liquidity provision — defined, dormant until a real in-app
     liquidity deposit flow exists (Farm links out to venue-hosted pools, so
     no event can be emitted today; wiring it while nothing emits it would be
     an invented reward). */
  lp: { points: 150, verify: 'lenient', dailyCap: 5, kind: 'lp', live: false, qualifiesReferral: true },

  /* derivatives venues — the BFFs build unsigned orders; wire the event at
     the first confirmed fill surface. Until then: dormant, not advertised. */
  dydx: { points: 10, verify: 'lenient', dailyCap: 30, kind: 'trade', live: false, qualifiesReferral: true },
  futures: { points: 10, verify: 'lenient', dailyCap: 30, kind: 'trade', live: false, qualifiesReferral: true },

  /* product milestones (server-reference or none) */
  goals: { points: 40, verify: 'none', dailyCap: 10, kind: 'goals' },
  lab: { points: 15, verify: 'none', dailyCap: 10, kind: 'learn' },
  tokenAnalysis: { points: 25, verify: 'none', dailyCap: 10, kind: 'analysis' },
  /* security-analysis surfaces exist only as passive checklists today — no
     single on-demand scan emits an event yet, so this stays dormant. */
  securityAnalysis: { points: 25, verify: 'none', dailyCap: 10, kind: 'analysis', live: false },

  /* loyalty mechanics */
  dailyCheckin: { points: 15, verify: 'none', dailyCap: 1, kind: 'checkin' },
  shareApp: { points: 30, verify: 'none', dailyCap: 1, kind: 'growth' },
  connectWallet: { points: 100, verify: 'none', once: true, kind: 'milestone' },
  backupWallet: { points: 75, verify: 'none', once: true, kind: 'milestone' },
  enable2fa: { points: 60, verify: 'none', once: true, kind: 'milestone' },

  /* referral: +250 lands when a code OWNER's invitee completes their first
     qualifying activity (the invitee side awards `referralShare` once when
     they shared their own invite — the two are different moments and both
     are real). */
  referral: { points: 250, verify: 'none', dailyCap: 10, kind: 'referral' },
  referralShare: { points: 250, verify: 'none', once: true, kind: 'referral' },

  /* intent AI */
  intentAiPlan: { points: 10, verify: 'none', dailyCap: 10, kind: 'ai' },
  intentAiExecuted: { points: 25, verify: 'lenient', dailyCap: 10, kind: 'ai' }
});

/**
 * Client action strings → canonical action ids.
 * The client store logs legacy quest ids as `quest:<id>`; the ones below
 * correspond to real activity and are mapped onto canonical actions. Arcade /
 * play-money quest ids (firstTrade, firstStake) are deliberately absent —
 * fake-money activity must not feed the reputation ledger.
 */
export const ACTION_ALIASES = Object.freeze({
  'quest:firstSwap': 'firstSwap',
  'quest:connectWallet': 'connectWallet',
  'quest:backupWallet': 'backupWallet',
  'quest:enable2fa': 'enable2fa',
  'quest:inviteFriend': 'referralShare'
});

/** Resolve a reported action string to a canonical id, or null. */
export function canonicalAction(reported) {
  if (typeof reported !== 'string') return null;
  if (ACTIONS[reported] && ACTIONS[reported].live !== false) return reported;
  return ACTION_ALIASES[reported] && ACTIONS[ACTION_ALIASES[reported]].live !== false
    ? ACTION_ALIASES[reported]
    : null;
}

/**
 * Daily missions (spec §5 — "Today's Missions"). Every mission is derived from
 * real credited activity counters; a mission whose action is not live is
 * never returned by the engine.
 */
export const MISSIONS = Object.freeze([
  { id: 'checkin', target: 1, actions: ['dailyCheckin'], scope: 'day', pts: 0, kind: 'checkin' },
  { id: 'swap1', target: 1, actions: ['swap'], scope: 'day', pts: 10, kind: 'trade' },
  { id: 'swap5', target: 5, actions: ['swap'], scope: 'day', pts: 25, kind: 'trade' },
  { id: 'bridge1', target: 1, actions: ['bridge'], scope: 'day', pts: 15, kind: 'move' },
  { id: 'lend1', target: 1, actions: ['lending', 'withdraw'], scope: 'day', pts: 15, kind: 'lend' },
  { id: 'borrow1', target: 1, actions: ['borrow', 'repay'], scope: 'day', pts: 15, kind: 'borrow' },
  { id: 'lp1', target: 1, actions: ['lp'], scope: 'day', pts: 20, kind: 'lp' },
  { id: 'dydx1', target: 1, actions: ['dydx'], scope: 'day', pts: 15, kind: 'trade' },
  { id: 'futures1', target: 1, actions: ['futures'], scope: 'day', pts: 15, kind: 'trade' },
  { id: 'goals1', target: 1, actions: ['goals'], scope: 'day', pts: 15, kind: 'goals' },
  { id: 'lab1', target: 1, actions: ['lab'], scope: 'day', pts: 15, kind: 'learn' },
  { id: 'analysis1', target: 1, actions: ['tokenAnalysis', 'securityAnalysis'], scope: 'day', pts: 15, kind: 'analysis' },
  { id: 'share1', target: 1, actions: ['shareApp'], scope: 'day', pts: 10, kind: 'growth' },
  /* one-time milestone missions */
  { id: 'firstSwapEver', target: 1, actions: ['firstSwap'], scope: 'ever', pts: 0, kind: 'milestone' },
  { id: 'referralEver', target: 1, actions: ['referral'], scope: 'ever', pts: 0, kind: 'referral' },
  { id: 'streak3', target: 3, actions: ['streak'], scope: 'streak', pts: 30, kind: 'checkin' },
  { id: 'streak7', target: 7, actions: ['streak'], scope: 'streak', pts: 60, kind: 'checkin' }
]);

/**
 * Achievements — derived purely from the ledger counters, never from a
 * separate award event. `requires` is an action + a predicate on its count.
 */
export const ACHIEVEMENTS = Object.freeze([
  { id: 'firstSwap', label: 'rewards.ach.firstSwap', icon: '🔄', action: 'firstSwap', min: 1 },
  { id: 'firstBridge', label: 'rewards.ach.firstBridge', icon: '🌉', action: 'bridge', min: 1 },
  { id: 'firstLending', label: 'rewards.ach.firstLending', icon: '🏦', action: 'lending', min: 1 },
  { id: 'firstBorrow', label: 'rewards.ach.firstBorrow', icon: '🧮', action: 'borrow', min: 1 },
  { id: 'firstGoal', label: 'rewards.ach.firstGoal', icon: '🎯', action: 'goals', min: 1 },
  { id: 'firstLab', label: 'rewards.ach.firstLab', icon: '🧪', action: 'lab', min: 1 },
  { id: 'firstAnalysis', label: 'rewards.ach.firstAnalysis', icon: '🔍', action: 'tokenAnalysis', min: 1 },
  { id: 'firstSecurity', label: 'rewards.ach.firstSecurity', icon: '🛡️', action: 'securityAnalysis', min: 1 },
  { id: 'firstReferral', label: 'rewards.ach.firstReferral', icon: '🤝', action: 'referral', min: 1 },
  { id: 'streak3', label: 'rewards.ach.streak3', icon: '🔥', action: 'streak3', min: 1 },
  { id: 'streak7', label: 'rewards.ach.streak7', icon: '🔥', action: 'streak7', min: 1 }
]);

/** Referral rules (spec §7). */
export const REFERRAL = Object.freeze({
  /** Qualifying actions for an invitee (must be rpc-verified). */
  qualifying: ['swap', 'bridge', 'lending', 'borrow'],
  /** Max new attributed wallets per code, per day — anti-farming. */
  maxPerCodePerDay: 20,
  /** Max total attributed wallets kept per code. */
  maxAttributedPerCode: 500,
  /** A code can only be bound to one owner. */
  bindMessagePrefix: 'FBT Rewards referral code',
  bindTtlMs: 15 * 60_000,
  /** Same code used from the same device as its owner → self-referral. */
  rejectSelfDevice: true,
  rejectSelfWallet: true
});

/** Claim (spec §11) — dormant until a real distributor exists. */
export const CLAIM = Object.freeze({
  /** Env-driven distributor contract. Empty until the FBT token launches. */
  distributorChain: Number(process.env.FBT_REWARDS_DISTRIBUTOR_CHAIN || 0) || null,
  distributorAddress: String(process.env.FBT_REWARDS_DISTRIBUTOR_ADDRESS || '').trim() || null,
  tokenAddress: String(process.env.FBT_REWARDS_TOKEN_ADDRESS || '').trim() || null,
  /** A claim nonce is single-use and short-lived. */
  nonceTtlMs: 15 * 60_000,
  /** Max prepared-but-unused nonces kept per account (bounded storage). */
  maxPendingNonces: 10,
  /** Cooldown between two claims of the same kind. */
  cooldownMs: 24 * 3600_000
});

/** FBT token / market status (spec §8/§10). Honest, config-driven. */
export const FBT = Object.freeze({
  /** FBT is not an issued token; balance is the loyalty ledger, 1 point = 1 FBT. */
  tokenLaunched: Boolean(
    process.env.FBT_REWARDS_TOKEN_ADDRESS &&
    process.env.FBT_REWARDS_DISTRIBUTOR_CHAIN &&
    process.env.FBT_REWARDS_DISTRIBUTOR_ADDRESS
  )
});

/* Client mirrors (src/lib/ranks.js POINT_VALUES) that MUST stay aligned. */
export const CLIENT_ALIGNMENT = Object.freeze({
  swap: 1, firstSwap: 300, referral: 250, dailyCheckin: 15, shareApp: 30,
  connectWallet: 100, backupWallet: 75, enable2fa: 60,
  intentAiPlan: 10, intentAiExecuted: 25
});

/** Level for a points total, from a (configurable) level table. */
export function levelFor(points, levels = LEVELS) {
  const pts = Number.isFinite(Number(points)) ? Math.max(0, Number(points)) : 0;
  let current = levels[0];
  for (const l of levels) if (pts >= l.min) current = l;
  const next = levels.find((l) => l.min > pts) ?? null;
  return { level: current, next, progress: levelProgress(pts, current, next) };
}

export function levelProgress(points, current, next) {
  if (!next) return 1;
  const span = next.min - current.min;
  return span > 0 ? Math.min(1, Math.max(0, (points - current.min) / span)) : 1;
}

/** FBT tier benefit rows (mirror src/lib/fbt.js FBT_TIERS). */
export const FBT_BENEFITS = Object.freeze([
  { id: 'bronze', min: 500, feeBps: 5, adDays: 0 },
  { id: 'silver', min: 2000, feeBps: 10, adDays: 1 },
  { id: 'gold', min: 6000, feeBps: 15, adDays: 7 },
  { id: 'diamond', min: 15000, feeBps: 20, adDays: 30 }
]);
