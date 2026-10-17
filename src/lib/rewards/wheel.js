/**
 * FBT REWARDS HUB — the device-side ledger behind the gamified surfaces.
 * ---------------------------------------------------------------------------
 * The rewards API (lib/rewards/rewardsApi.js) remains the authority for every
 * POINT. This module owns only the things the API does not model:
 *
 *   · which day the daily wheel was last spun (one spin per local day),
 *   · bonus spins earned from confirmed referrals,
 *   · soulbound animal badges (never transferable, never a token),
 *   · airdrop-season entries collected from wheel/referral/focus,
 *   · achievement timestamps and opened tier-milestone boxes.
 *
 * Nothing here mints an APY, a token, a price or a fiat amount. The only
 * number with monetary meaning anywhere in this file is WHEEL_POINT_VALUE
 * — and that credit is routed through the store (awardPointsOnce) so the
 * server's daily cap and idempotency still apply.
 *
 * Storage is deliberately localStorage: the brief asked for the wheel to work
 * without a backend. A user clearing site data loses device-local badges and
 * entries, which is stated in the UI rather than hidden.
 */
import { useSyncExternalStore } from 'react';
import { TIERS, tierFor } from '../ranks.js';
import { localDayNumber } from '../dailyRewards.js';
import { WHEEL_POINT_VALUE } from './economy.js';
import { useAppStore } from '../../store/useAppStore.js';

const KEY = 'fbt-rewards-hub-v1';
const HISTORY_CAP = 40;

/** The eight sectors. Equal slices — no hidden weighting. */
export const DAILY_SEGMENTS = Object.freeze([
  { id: 'points', kind: 'points', pts: WHEEL_POINT_VALUE, color: '#00ff9d', glyph: '✦' },
  { id: 'nft', kind: 'nft', color: '#00e5ff', glyph: '◈' },
  { id: 'entry1', kind: 'entries', n: 1, color: '#7c4dff', glyph: '✧' },
  { id: 'entry2', kind: 'entries', n: 2, color: '#ff2d95', glyph: '✧' },
  { id: 'bonus', kind: 'bonus', color: '#ffb300', glyph: '↻' },
  { id: 'nft2', kind: 'nft', color: '#00e5ff', glyph: '◈' },
  { id: 'entry3', kind: 'entries', n: 1, color: '#7c4dff', glyph: '✧' },
  { id: 'points2', kind: 'points', pts: WHEEL_POINT_VALUE, color: '#00ff9d', glyph: '✦' }
]);

/** Bonus spins never pay points: one point-bearing spin per day, maximum. */
export const BONUS_SEGMENTS = Object.freeze([
  { id: 'nft', kind: 'nft', color: '#00e5ff', glyph: '◈' },
  { id: 'entry2', kind: 'entries', n: 2, color: '#ff2d95', glyph: '✧' },
  { id: 'entry1', kind: 'entries', n: 1, color: '#7c4dff', glyph: '✧' },
  { id: 'nft2', kind: 'nft', color: '#00e5ff', glyph: '◈' },
  { id: 'entry3', kind: 'entries', n: 3, color: '#7c4dff', glyph: '✧' },
  { id: 'nft3', kind: 'nft', color: '#00e5ff', glyph: '◈' },
  { id: 'entry4', kind: 'entries', n: 2, color: '#ff2d95', glyph: '✧' },
  { id: 'entry5', kind: 'entries', n: 1, color: '#7c4dff', glyph: '✧' }
]);

const EMPTY = {
  v: 1,
  lastSpinDay: null,
  bonusSpins: 0,
  entries: 0,
  nfts: [], // { id, tier, at, source, soulbound:true }
  achievements: {}, // id -> timestamp
  openedBoxes: [],
  refsSeen: 0,
  inviteeBonus: false,
  lastFocusDay: null,
  focusWins: 0,
  totalSpins: 0,
  history: []
};

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Local calendar stamp, independent of UTC/DST. */
export function dayStamp(at = Date.now()) {
  const day = localDayNumber(at);
  if (day == null) return null;
  return String(day);
}

/** Next local midnight, for the wheel countdown and the disabled button. */
export function nextDayAt(at = Date.now()) {
  const d = new Date(num(at, Date.now()));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

function sanitize(raw) {
  const state = { ...EMPTY, ...(raw && typeof raw === 'object' ? raw : {}) };
  state.lastSpinDay = typeof state.lastSpinDay === 'string' ? state.lastSpinDay : null;
  state.bonusSpins = Math.max(0, Math.trunc(num(state.bonusSpins)));
  state.entries = Math.max(0, Math.trunc(num(state.entries)));
  state.refsSeen = Math.max(0, Math.trunc(num(state.refsSeen)));
  state.inviteeBonus = state.inviteeBonus === true;
  state.totalSpins = Math.max(0, Math.trunc(num(state.totalSpins)));
  state.focusWins = Math.max(0, Math.trunc(num(state.focusWins)));
  state.nfts = Array.isArray(state.nfts)
    ? state.nfts
      .filter((n) => n && TIERS.some((t) => t.id === n.tier))
      .map((n) => ({
        id: n.id || `nft-${n.tier}`,
        tier: n.tier,
        at: num(n.at, Date.now()),
        source: typeof n.source === 'string' ? n.source : 'wheel',
        soulbound: true
      }))
    : [];
  state.achievements = state.achievements && typeof state.achievements === 'object' ? state.achievements : {};
  state.openedBoxes = Array.isArray(state.openedBoxes)
    ? state.openedBoxes.filter((id) => TIERS.some((t) => t.id === id))
    : [];
  state.lastFocusDay = typeof state.lastFocusDay === 'string' ? state.lastFocusDay : null;
  state.history = Array.isArray(state.history) ? state.history.slice(0, HISTORY_CAP) : [];
  return state;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitize(null);
  }
}

let snapshot = typeof localStorage === 'undefined' ? sanitize(null) : load();
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch { /* a broken subscriber must not break the ledger */ }
  }
}

function save(next) {
  snapshot = sanitize(next);
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* private mode */ }
  emit();
  return snapshot;
}

export function getHub() {
  return snapshot;
}

export function subscribeHub(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React binding; the snapshot object changes only when the ledger changes. */
export function useRewardsHub() {
  return useSyncExternalStore(subscribeHub, getHub, getHub);
}

export function refreshHub() {
  if (typeof localStorage === 'undefined') return snapshot;
  return save(load());
}

function historyRow(row) {
  return {
    id: `${row.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    ...row
  };
}

/** Today's spin availability. `lastSpinDay` is a local day number string. */
export function wheelStatus(now = Date.now()) {
  const today = dayStamp(now);
  const last = snapshot.lastSpinDay;
  const canSpin = Boolean(today) && last !== today;
  const nextAt = canSpin ? num(now) : nextDayAt(now);
  const hoursLeft = canSpin || !nextAt
    ? 0
    : Math.max(1, Math.ceil((nextAt - num(now)) / 3_600_000));
  return {
    canSpin,
    nextAt,
    hoursLeft,
    bonusSpins: snapshot.bonusSpins,
    totalSpins: snapshot.totalSpins
  };
}

/** Draw a sector without mutating anything (the UI animates to its index). */
export function drawSpin({ bonus = false, random = Math.random } = {}) {
  const pool = bonus ? BONUS_SEGMENTS : DAILY_SEGMENTS;
  const roll = Math.max(0, Math.min(0.999999, Number(random()) || 0));
  const index = Math.floor(roll * pool.length);
  return { index, segment: pool[index], bonus, pool };
}

/**
 * Apply a drawn sector exactly once.
 *
 * Point credit goes through the store's `awardPointsOnce` with a day-scoped
 * action (`wheel:<day>`), so:
 *   · a second spin on the same device/day cannot mint a second 25 points,
 *   · the reporter maps it to the server action `dailyWheel` (dailyCap: 1),
 *   · if the local ledger was cleared but the store still has the award, the
 *     points branch honestly downgrades to one airdrop entry instead of
 *     promising a credit that will not arrive.
 */
export function applySpin(draw, { tierId = 'bronze' } = {}) {
  if (!draw?.segment) return null;
  const state = snapshot;
  const segment = draw.segment;
  const day = dayStamp();
  if (!day) return null;

  if (!draw.bonus && state.lastSpinDay === day) return null;
  if (draw.bonus && state.bonusSpins <= 0) return null;

  const next = {
    ...state,
    lastSpinDay: draw.bonus ? state.lastSpinDay : day,
    bonusSpins: draw.bonus ? state.bonusSpins - 1 : state.bonusSpins,
    totalSpins: state.totalSpins + 1,
    nfts: [...state.nfts],
    entries: state.entries,
    history: [...state.history]
  };

  let pointsCredited = false;
  let fallbackEntry = false;
  let nftAdded = false;
  let nftTier = null;
  let entryAdded = 0;
  let bonusAdded = 0;

  if (segment.kind === 'points') {
    /* Hard invariant: a bonus spin NEVER reaches the points ledger, even if a
       future caller hands this function a points sector. The bonus pool has no
       points sectors today; this guard keeps that true by construction. */
    if (draw.bonus) {
      next.entries += 1;
      entryAdded += 1;
      fallbackEntry = true;
    } else {
      const credited = useAppStore.getState().awardPointsOnce(
        `wheel:${day}`,
        segment.pts || WHEEL_POINT_VALUE,
        { rewardId: `wheel-${day}` }
      );
      pointsCredited = credited === true;
      if (!pointsCredited) {
        next.entries += 1;
        entryAdded += 1;
        fallbackEntry = true;
      }
    }
  } else if (segment.kind === 'nft') {
    nftTier = tierId;
    const owned = next.nfts.some((n) => n.tier === tierId);
    if (owned) {
      next.entries += 1;
      entryAdded += 1;
    } else {
      next.nfts.push({
        id: `nft-${tierId}`,
        tier: tierId,
        at: Date.now(),
        source: draw.bonus ? 'referral-spin' : 'wheel',
        soulbound: true
      });
      nftAdded = true;
    }
  } else if (segment.kind === 'entries') {
    const n = Math.max(0, Math.trunc(num(segment.n)));
    next.entries += n;
    entryAdded += n;
  } else if (segment.kind === 'bonus') {
    next.bonusSpins += 1;
    bonusAdded = 1;
  }

  next.history.unshift(historyRow({
    kind: segment.kind,
    segment: segment.id,
    pts: pointsCredited ? (segment.pts || WHEEL_POINT_VALUE) : 0,
    entries: entryAdded,
    tier: nftAdded ? tierId : null,
    bonus: bonusAdded,
    source: draw.bonus ? 'bonus-spin' : 'daily-wheel',
    fallbackEntry
  }));
  next.history = next.history.slice(0, HISTORY_CAP);

  save(next);
  return {
    segment,
    pointsCredited,
    fallbackEntry,
    nftAdded,
    nftTier,
    entryAdded,
    bonusAdded
  };
}

/**
 * Reconcile the server's CONFIRMED referral count with this device.
 *
 * The server (GET /v1/rewards/referral + summary) is the only authority on
 * whether a friend qualified. Each newly seen confirmed referral grants one
 * airdrop entry and one bonus spin; every third cumulative confirmed referral
 * also mints the current tier's soulbound animal badge. A duplicate badge is
 * converted to one entry rather than minted twice.
 */
export function syncConfirmedReferrals(total, tierId = 'bronze') {
  const confirmed = Math.max(0, Math.trunc(num(total)));
  if (confirmed <= snapshot.refsSeen) return { newRefs: 0, entryAdded: 0, bonusAdded: 0, nftAdded: false };

  const next = { ...snapshot, nfts: [...snapshot.nfts], history: [...snapshot.history] };
  const newRefs = confirmed - snapshot.refsSeen;
  next.refsSeen = confirmed;
  next.entries += newRefs;
  next.bonusSpins += newRefs;

  let nftAdded = false;
  let converted = 0;
  for (let k = snapshot.refsSeen + 1; k <= confirmed; k += 1) {
    if (k % 3 !== 0) continue;
    if (next.nfts.some((n) => n.tier === tierId)) {
      next.entries += 1;
      converted += 1;
    } else {
      next.nfts.push({
        id: `nft-${tierId}`,
        tier: tierId,
        at: Date.now(),
        source: 'referral',
        soulbound: true
      });
      nftAdded = true;
    }
  }

  next.history.unshift(historyRow({
    kind: 'referral',
    refs: newRefs,
    entries: newRefs + converted,
    bonus: newRefs,
    tier: nftAdded ? tierId : null,
    source: 'confirmed-referral'
  }));
  next.history = next.history.slice(0, HISTORY_CAP);
  save(next);
  return {
    newRefs,
    entryAdded: newRefs + converted,
    bonusAdded: newRefs,
    nftAdded
  };
}

/**
 * The INVITEE side of a two-sided referral.
 *
 * The code owner is paid by the engine when a friend qualifies; this device
 * pays itself the entry that the brief asked the invited side to receive. It
 * is one entry, once per install, and it is explicitly device-local — there is
 * no endpoint that pays the invited user a point bonus, and pretending there
 * were would be the kind of fake reward this module avoids.
 */
export function grantInviteeBonus(code) {
  if (!code || snapshot.inviteeBonus) return false;
  save({
    ...snapshot,
    inviteeBonus: true,
    entries: snapshot.entries + 1,
    achievements: { ...snapshot.achievements, invited: snapshot.achievements.invited || Date.now() },
    history: [
      historyRow({ kind: 'invited', entries: 1, source: 'invitee-bonus' }),
      ...snapshot.history
    ].slice(0, HISTORY_CAP)
  });
  return true;
}

/** The highest reached tier that still has an unopened milestone box. */
export function pendingTierBox(points) {
  const current = tierFor(Number(points) || 0);
  const currentIndex = TIERS.findIndex((t) => t.id === current.id);
  if (currentIndex < 1) return null;
  for (let i = currentIndex; i >= 1; i -= 1) {
    const tier = TIERS[i];
    if (!snapshot.openedBoxes.includes(tier.id)) return tier;
  }
  return null;
}

/** Open the milestone box: one bonus spin + one entry. No points are minted. */
export function openTierBox(tierId) {
  const index = TIERS.findIndex((t) => t.id === tierId);
  if (index < 1) return null;
  /* Opening a box retires every box up to that tier, so a user who jumps two
     tiers at once is not handed a backlog of surprise boxes. */
  const opened = new Set(snapshot.openedBoxes);
  for (let i = 1; i <= index; i += 1) opened.add(TIERS[i].id);
  const next = {
    ...snapshot,
    openedBoxes: [...opened],
    bonusSpins: snapshot.bonusSpins + 1,
    entries: snapshot.entries + 1,
    history: [
      historyRow({ kind: 'tierBox', tier: tierId, entries: 1, bonus: 1, source: 'milestone' }),
      ...snapshot.history
    ].slice(0, HISTORY_CAP)
  };
  save(next);
  return { tier: TIERS[index], bonusAdded: 1, entryAdded: 1 };
}

/** Persist an achievement the moment its condition becomes true. */
export function markAchievement(id) {
  if (!id || snapshot.achievements[id]) return false;
  save({
    ...snapshot,
    achievements: { ...snapshot.achievements, [id]: Date.now() }
  });
  return true;
}

/** Focus round completion: one airdrop entry per local day, never points. */
export function completeFocus() {
  const today = dayStamp();
  if (!today || snapshot.lastFocusDay === today) return false;
  save({
    ...snapshot,
    lastFocusDay: today,
    focusWins: snapshot.focusWins + 1,
    entries: snapshot.entries + 1,
    achievements: { ...snapshot.achievements, focusFirst: snapshot.achievements.focusFirst || Date.now() },
    history: [
      historyRow({ kind: 'focus', entries: 1, source: 'focus-round' }),
      ...snapshot.history
    ].slice(0, HISTORY_CAP)
  });
  return true;
}

export function focusAvailable(now = Date.now()) {
  return snapshot.lastFocusDay !== dayStamp(now);
}

/**
 * Test/maintenance helper: wipe only this hub's device ledger. Used by no UI
 * today; exported so a future settings reset never has to know the key name.
 */
export function resetHub() {
  save(sanitize(null));
}
