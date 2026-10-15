import TabbedPage from '../components/TabbedPage';
import Help from './Help';
import Docs from './Docs';
import AparatVideos from './AparatVideos';
import { IconInfo, IconDoc, IconVideo } from '../components/Icons';

/**
 * LEARN — help, documentation and the Aparat video academy in one place.
 *
 * Someone stuck does not know whether their problem is a FAQ entry or a
 * tutorial, and making them guess between menu items is the failure. Help
 * is first because a person arriving here usually has a specific question,
 * the guides are what they read after it is answered, and Aparat videos walk
 * through each feature visually.
 */
export default function Learn() {
  return (
    <TabbedPage
      titleKey="learn.title"
      indicatorId="learn-tab"
      tabs={[
        { id: 'help', labelKey: 'nav.help', Icon: IconInfo, Component: Help },
        { id: 'docs', labelKey: 'nav.docs', Icon: IconDoc, Component: Docs },
        { id: 'aparat', labelKey: 'nav.aparat', Icon: IconVideo, Component: AparatVideos }
      ]}
    />
  );
}
