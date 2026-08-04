import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import BottomNav from '../src/components/BottomNav.jsx';

/**
 * THE BOTTOM NAV'S SHAPE
 * ---------------------------------------------------------------------------
 * Requested: four tabs with a fifth, raised control between them.
 *
 * Asserted in the DOM rather than by reading the source, because the centre
 * button's whole point is WHERE it sits. It is emitted from inside the
 * `.map()` as a sibling of the second tab, which is easy to break with an
 * innocent-looking refactor: move it outside the loop and it silently lands
 * at the end of the row, still rendering, still styled, just in the wrong
 * place. A source grep would not notice.
 */
export async function run(container) {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TelegramProvider><HashRouter><BottomNav /></HashRouter></TelegramProvider>);
  });
  const tabs = container.querySelectorAll('.nav-item');
  const centre = container.querySelector('.nav-centre');
  const drop = container.querySelector('.nav-centre-drop');
  t(`there are 4 tabs (got ${tabs.length})`, tabs.length === 4);
  t('the centre button exists', Boolean(centre));
  t('the droplet element exists', Boolean(drop));
  t('the centre button is accessible', Boolean(centre?.getAttribute('aria-label')));
  // position: must be the 3rd child so it sits between tab2 and tab3
  const kids = [...container.querySelector('.bottom-nav').children];
  t(`the centre sits in the middle (index ${kids.indexOf(centre)} of ${kids.length})`,
    kids.indexOf(centre) === 2 && kids.length === 5);
  await act(async () => root.unmount());
  return rows;
}
