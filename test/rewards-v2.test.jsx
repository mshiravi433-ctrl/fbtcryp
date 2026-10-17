// @vitest-environment jsdom
/**
 * The gamified surfaces' device ledger.
 *
 * The points authority is the server; these tests pin the client-side rules
 * that must never double-mint on one device:
 *   · one point-bearing wheel spin per local day,
 *   · bonus spins never pay points,
 *   · confirmed referrals are reconciled exactly once,
 *   · a tier box pays one spin + one entry and retires the boxes below it,
 *   · the focus round pays one entry per day.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/rewards/rewardsReporter', () => ({
  reportActivity: vi.fn(),
  setMissionBonusHandler: vi.fn()
}));

import { useAppStore } from '../src/store/useAppStore';
import { LEARN_POINT_VALUE, WHEEL_POINT_VALUE } from '../src/lib/rewards/economy';
import { POINT_VALUES } from '../src/lib/ranks';
import { ACTIONS } from '../server/rewards/config.js';
import { achievementsFor } from '../src/lib/rewards/achievements';
import {
  DAILY_SEGMENTS, applySpin, completeFocus, focusAvailable, getHub,
  grantInviteeBonus, openTierBox, pendingTierBox, resetHub, syncConfirmedReferrals,
  wheelStatus
} from '../src/lib/rewards/wheel';

const reset = () => {
  localStorage.clear();
  resetHub();
  useAppStore.setState({ points: 0, pointsLog: [], streak: 0, lastClaim: 0 });
};

describe('daily wheel', () => {
  beforeEach(reset);

  it('credits the points sector exactly once, through the store ledger', () => {
    const draw = { index: 0, segment: DAILY_SEGMENTS[0], bonus: false };
    const first = applySpin(draw, { tierId: 'bronze' });
    expect(first?.pointsCredited).toBe(true);
    expect(useAppStore.getState().points).toBe(WHEEL_POINT_VALUE);
    expect(useAppStore.getState().pointsLog[0].action.startsWith('wheel:')).toBe(true);

    expect(applySpin(draw, { tierId: 'bronze' })).toBe(null);
    expect(useAppStore.getState().points).toBe(WHEEL_POINT_VALUE);
    expect(wheelStatus().canSpin).toBe(false);
  });

  it('never pays points from a bonus spin, even on the points sector', () => {
    const draw = { index: 0, segment: DAILY_SEGMENTS[0], bonus: true };
    /* No bonus spins yet → refused. */
    expect(applySpin(draw, { tierId: 'bronze' })).toBe(null);
    syncConfirmedReferrals(1, 'bronze');
    const applied = applySpin(draw, { tierId: 'bronze' });
    expect(applied).not.toBe(null);
    expect(useAppStore.getState().points).toBe(0);
  });
});

describe('referral reconciliation', () => {
  beforeEach(reset);

  it('converts each new confirmed friend to one entry + one bonus spin, and every third to a badge', () => {
    const gained = syncConfirmedReferrals(3, 'gold');
    expect(gained.newRefs).toBe(3);
    expect(getHub().entries).toBe(3);
    expect(getHub().bonusSpins).toBe(3);
    expect(getHub().nfts.map((n) => n.tier)).toEqual(['gold']);
    expect(getHub().nfts[0].soulbound).toBe(true);

    const again = syncConfirmedReferrals(3, 'gold');
    expect(again.newRefs).toBe(0);
    expect(getHub().entries).toBe(3);
  });

  it('does not mint a duplicate badge — the third-friend badge becomes an entry', () => {
    syncConfirmedReferrals(3, 'silver');
    const more = syncConfirmedReferrals(6, 'silver');
    expect(more.newRefs).toBe(3);
    expect(getHub().nfts.filter((n) => n.tier === 'silver')).toHaveLength(1);
    expect(getHub().entries).toBe(7); // 6 from friends + 1 duplicate conversion
  });
});

describe('invitee side', () => {
  beforeEach(reset);

  it('pays the invited side exactly one entry, once per install', () => {
    expect(grantInviteeBonus('FBTABC123')).toBe(true);
    expect(getHub().entries).toBe(1);
    expect(getHub().inviteeBonus).toBe(true);
    expect(grantInviteeBonus('FBTABC123')).toBe(false);
    expect(getHub().entries).toBe(1);
    expect(grantInviteeBonus(null)).toBe(false);
  });
});

describe('tier box + focus', () => {
  beforeEach(reset);

  it('pays one spin + one entry and retires lower boxes', () => {
    expect(pendingTierBox(2500)?.id).toBe('gold');
    const opened = openTierBox('gold');
    expect(opened?.bonusAdded).toBe(1);
    expect(getHub().bonusSpins).toBe(1);
    expect(getHub().entries).toBe(1);
    expect(getHub().openedBoxes).toEqual(expect.arrayContaining(['silver', 'gold']));
    expect(pendingTierBox(2500)).toBe(null);
  });

  it('pays one focus entry per local day', () => {
    expect(focusAvailable()).toBe(true);
    expect(completeFocus()).toBe(true);
    expect(getHub().entries).toBe(1);
    expect(focusAvailable()).toBe(false);
    expect(completeFocus()).toBe(false);
    expect(getHub().entries).toBe(1);
  });
});

describe('economy pins', () => {
  it('the display values equal the server engine and never leak into POINT_VALUES', () => {
    expect(WHEEL_POINT_VALUE).toBe(ACTIONS.dailyWheel.points);
    expect(LEARN_POINT_VALUE).toBe(ACTIONS.learn.points);
    /* Leaderboard.jsx iterates POINT_VALUES to build its table. These two are
       deliberately NOT there, so that page's content is unchanged. */
    expect(Object.keys(POINT_VALUES)).not.toContain('dailyWheel');
    expect(Object.keys(POINT_VALUES)).not.toContain('learn');
  });
});

describe('achievements', () => {
  it('derives badges from the real ledger, not from taps', () => {
    const rows = achievementsFor({
      points: 2100,
      streak: 7,
      referrals: 1,
      pointsLog: [{ action: 'connectWallet' }, { action: 'firstSwap' }],
      nfts: []
    });
    expect(rows.find((r) => r.id === 'firstLight')?.earned).toBe(true);
    expect(rows.find((r) => r.id === 'walletOn')?.earned).toBe(true);
    expect(rows.find((r) => r.id === 'firstSwap')?.earned).toBe(true);
    expect(rows.find((r) => r.id === 'streak7')?.earned).toBe(true);
    expect(rows.find((r) => r.id === 'referrer')?.earned).toBe(true);
    expect(rows.find((r) => r.id === 'collector')?.earned).toBe(false);
    expect(rows.find((r) => r.id === 'legend')?.earned).toBe(false);
  });

  it('keeps the whole discovery wall honest — every card starts locked and derives from the ledger', () => {
    const empty = achievementsFor({ points: 0, streak: 0, referrals: 0, pointsLog: [], nfts: [] });
    expect(empty.length).toBe(28);
    expect(empty.every((row) => row.earned === false)).toBe(true);
    expect(empty.every((row) => row.progress === 0)).toBe(true);

    /* one real swap unlocks exactly the swap cards and nothing else */
    const afterSwap = achievementsFor({
      points: 0,
      streak: 0,
      referrals: 0,
      pointsLog: [{ action: 'swap' }],
      nfts: []
    });
    expect(afterSwap.find((r) => r.id === 'firstSwap')?.earned).toBe(true);
    expect(afterSwap.find((r) => r.id === 'swaps5')?.earned).toBe(false);
    expect(afterSwap.find((r) => r.id === 'swaps5')?.progress).toBeCloseTo(0.2);
    expect(afterSwap.filter((r) => r.earned).length).toBe(1);
  });
});
