import TabbedPage from '../components/TabbedPage';
import Earn from './Earn';
import Leaderboard from './Leaderboard';
import { IconSparkle, IconTrophy } from '../components/Icons';

/**
 * POINTS & RANKING — earning and the leaderboard, together.
 *
 * The ranking table was a separate menu entry, which meant the score and the
 * standing it produces lived on different screens. Points are only
 * interesting relative to other people, so the two halves belong side by side.
 */
export default function Rewards() {
  return (
    <TabbedPage
      titleKey="rewards.title"
      indicatorId="rewards-tab"
      tabs={[
        { id: 'earn', labelKey: 'nav.earn', Icon: IconSparkle, Component: Earn },
        { id: 'ranking', labelKey: 'nav.leaderboard', Icon: IconTrophy, Component: Leaderboard }
      ]}
    />
  );
}
