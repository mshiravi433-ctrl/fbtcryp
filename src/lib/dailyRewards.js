import { POINT_VALUES } from './ranks.js';

const DAY_MS = 86_400_000;

/**
 * A local calendar-day number that is stable across daylight-saving changes.
 *
 * Daily check-in is a calendar promise ("come back tomorrow"), not a rolling
 * 20/48-hour timer. Converting the local date parts through UTC lets us compare
 * dates without a 23-hour DST day looking early or a 25-hour day looking late.
 */
export function localDayNumber(at) {
  const date = new Date(Number(at));
  if (!Number.isFinite(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/** The next local midnight, used only to keep the disabled-button countdown live. */
export function nextLocalDayAt(at = Date.now()) {
  const date = new Date(Number(at));
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/**
 * Pure daily-reward state shared by the store and the Earn screen.
 *
 * - one claim per local calendar day;
 * - yesterday continues the streak;
 * - skipping a calendar day resets the next claim to day one;
 * - a clock moved backwards never opens a second claim.
 */
export function dailyRewardStatus({ now = Date.now(), lastClaim = 0, streak = 0 } = {}) {
  const today = localDayNumber(now);
  const claimedDay = Number(lastClaim) > 0 ? localDayNumber(lastClaim) : null;
  const gap = claimedDay == null || today == null ? null : today - claimedDay;
  const savedStreak = Math.max(0, Math.trunc(Number(streak) || 0));
  const canClaim = claimedDay == null || (gap != null && gap > 0);
  const activeStreak = claimedDay != null && (gap === 0 || gap === 1) ? savedStreak : 0;

  let nextStreak;
  if (claimedDay == null || (gap != null && gap > 1)) nextStreak = 1;
  else if (gap === 0 || gap === 1) nextStreak = savedStreak + 1;
  else nextStreak = savedStreak; // invalid/future clock: stay closed and unchanged

  const reward =
    POINT_VALUES.dailyCheckin
    + Math.min(Math.max(nextStreak, 1), 7) * POINT_VALUES.streakBonus;
  const nextAt = canClaim ? Number(now) : nextLocalDayAt(now);

  return {
    canClaim,
    gap,
    activeStreak,
    nextStreak,
    reward,
    nextAt,
    hoursLeft: canClaim || !nextAt
      ? 0
      : Math.max(1, Math.ceil((nextAt - Number(now)) / 3_600_000))
  };
}
