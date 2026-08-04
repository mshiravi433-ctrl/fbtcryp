import TabbedPage from '../components/TabbedPage';
import Predict from './Predict';
import Invest from './Invest';
import { IconActivity, IconTrend } from '../components/Icons';

/**
 * LAB — prediction and simulated investing, together.
 *
 * ─── WHY THESE TWO SHARE A SCREEN ───────────────────────────────────────────
 * They are the same kind of thing, and neither is real money. Both run on
 * virtual credits, both exist so someone can try an idea without risking
 * anything, and both were previously buried as separate entries in the More
 * menu where they read as two unrelated products.
 *
 * Naming the container "Lab" does the honest work that a shared title should:
 * it tells the user, before they open either tab, that this is where you
 * experiment. That is a far clearer signal than a disclaimer three
 * paragraphs into each screen.
 */
export default function Lab() {
  return (
    <TabbedPage
      titleKey="lab.title"
      indicatorId="lab-tab"
      tabs={[
        { id: 'predict', labelKey: 'nav.predict', Icon: IconActivity, Component: Predict },
        { id: 'invest', labelKey: 'nav.invest', Icon: IconTrend, Component: Invest }
      ]}
    />
  );
}
