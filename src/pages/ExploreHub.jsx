import TabbedPage from '../components/TabbedPage';
import Explore from './Explore';
import Discover from './Discover';
import { IconSearch, IconGlobe } from '../components/Icons';

/**
 * EXPLORE — the block explorer and the curated link list.
 *
 * Both answer "I want to look something up", so they belong behind one icon.
 * The explorer takes an address or a hash you already have; Discover is for
 * when you do not know where to look yet.
 */
export default function ExploreHub() {
  return (
    <TabbedPage
      titleKey="exploreHub.title"
      indicatorId="explore-tab"
      tabs={[
        { id: 'explorer', labelKey: 'nav.explore', Icon: IconSearch, Component: Explore },
        { id: 'discover', labelKey: 'nav.discover', Icon: IconGlobe, Component: Discover }
      ]}
    />
  );
}
