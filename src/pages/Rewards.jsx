import TabbedPage from '../components/TabbedPage';
import Earn from './Earn';
import Leaderboard from './Leaderboard';
import { IconCoins, IconTrophy } from '../components/Icons';

/**
 * POINTS & REWARDS — the FBT Rewards home.
 *
 * Two tabs:
 *   earn      — real yield products + points quests.
 *   ranking   — your points history (the private, per-device ledger). Every
 *               recorded action — including sharing — lands here as points,
 *               on both the app and the site. The old API dashboard tab was
 *               removed because it duplicated data the earn + ranking tabs
 *               already surface.
 */
export default function Rewards() {
  return (
    <TabbedPage
      titleKey="rewards.title"
      indicatorId="rewards-tab"
      tabs={[
        { id: 'earn', labelKey: 'nav.earn', Icon: IconCoins, Component: Earn },
        { id: 'ranking', labelKey: 'nav.leaderboard', Icon: IconTrophy, Component: Leaderboard }
      ]}
    />
  );
}
