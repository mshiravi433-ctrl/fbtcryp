import TabbedPage from '../components/TabbedPage';
import RewardsDashboard from '../components/RewardsDashboard';
import Earn from './Earn';
import Leaderboard from './Leaderboard';
import { IconActivity, IconCoins, IconTrophy } from '../components/Icons';

/**
 * POINTS & REWARDS — the FBT Rewards home.
 *
 * Three tabs:
 *   dashboard — the API-first FBT Rewards dashboard: points, level, FBT
 *               balance, missions, benefits, referral, achievements,
 *               utilities and market state, all read from the rewards engine
 *               (/api/v1/rewards/summary).
 *   earn      — real yield products + points quests.
 *   ranking   — your points history (the private, per-device ledger).
 */
export default function Rewards() {
  return (
    <TabbedPage
      titleKey="rewards.title"
      indicatorId="rewards-tab"
      tabs={[
        { id: 'dashboard', labelKey: 'rewards.tab.dashboard', Icon: IconActivity, Component: RewardsDashboard },
        { id: 'earn', labelKey: 'nav.earn', Icon: IconCoins, Component: Earn },
        { id: 'ranking', labelKey: 'nav.leaderboard', Icon: IconTrophy, Component: Leaderboard }
      ]}
    />
  );
}
