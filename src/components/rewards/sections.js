import FlameIcon from '../FlameIcon';
import {
  IconSparkle, IconTrophy, IconUser, IconShield, IconGift, IconCoins, IconActivity, IconKey
} from '../Icons';

/**
 * THE SECTION REGISTRY — the rewards tab's sub-tabs.
 * ---------------------------------------------------------------------------
 * One list, imported by both the dock (which renders the chips) and the page
 * (which validates the `?section=` deep link), so a chip can never point at a
 * section that does not exist and a deep link can never land on nothing.
 *
 * The order is the journey: the daily ritual first, then the streak and the
 * real quests, then the social loop, then the collection, then the game, then
 * the season, then what the balance unlocks, and finally your own record.
 */
export const REWARD_SECTIONS = Object.freeze([
  { id: 'wheel', labelKey: 'rewards.v2.quicknavItems.wheel', Icon: IconSparkle },
  { id: 'streak', labelKey: 'rewards.v2.quicknavItems.streak', Icon: FlameIcon },
  { id: 'missions', labelKey: 'rewards.v2.quicknavItems.missions', Icon: IconTrophy },
  { id: 'referral', labelKey: 'rewards.v2.quicknavItems.referral', Icon: IconUser },
  { id: 'badges', labelKey: 'rewards.v2.quicknavItems.badges', Icon: IconShield },
  { id: 'learn', labelKey: 'rewards.v2.quicknavItems.learn', Icon: IconKey },
  { id: 'focus', labelKey: 'rewards.v2.quicknavItems.focus', Icon: IconActivity },
  { id: 'season', labelKey: 'rewards.v2.quicknavItems.season', Icon: IconGift },
  { id: 'perks', labelKey: 'rewards.v2.quicknavItems.perks', Icon: IconCoins },
  { id: 'profile', labelKey: 'rewards.v2.quicknavItems.profile', Icon: IconTrophy }
]);

export const REWARD_SECTION_IDS = Object.freeze(REWARD_SECTIONS.map((row) => row.id));

export const DEFAULT_REWARD_SECTION = 'wheel';
