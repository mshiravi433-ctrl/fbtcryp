import TabbedPage from '../components/TabbedPage';
import Help from './Help';
import Docs from './Docs';
import { IconInfo, IconDoc } from '../components/Icons';

/**
 * LEARN — help and documentation in one place.
 *
 * Someone stuck does not know whether their problem is a FAQ entry or a
 * tutorial, and making them guess between two menu items is the failure. Help
 * is first because a person arriving here usually has a specific question,
 * and the guides are what they read after it is answered.
 */
export default function Learn() {
  return (
    <TabbedPage
      titleKey="learn.title"
      indicatorId="learn-tab"
      tabs={[
        { id: 'help', labelKey: 'nav.help', Icon: IconInfo, Component: Help },
        { id: 'docs', labelKey: 'nav.docs', Icon: IconDoc, Component: Docs }
      ]}
    />
  );
}
