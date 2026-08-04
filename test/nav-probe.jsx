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
  const bar = container.querySelector('.bottom-nav');
  const tabs = container.querySelectorAll('.nav-item');
  const centre = container.querySelector('.nav-centre');
  const drop = container.querySelector('.nav-centre-drop');
  const gap = container.querySelector('.nav-notch-gap');

  t(`there are 4 tabs (got ${tabs.length})`, tabs.length === 4);
  t('the droplet button exists', Boolean(centre));
  t('the teardrop shape exists', Boolean(drop));
  t('the droplet is accessible', Boolean(centre?.getAttribute('aria-label')));

  /*
   * THE STRUCTURAL RULE THIS SCREEN DEPENDS ON.
   *
   * The bar masks a circular notch out of its own top edge, and a CSS mask
   * clips every descendant. So a droplet rendered INSIDE the bar would be
   * sliced in half by the very hollow meant to frame it — the exact "merged
   * into the menu" look that was reported.
   *
   * It must therefore be a sibling. This is easy to undo by accident while
   * tidying JSX, and the result would look subtly wrong rather than throw,
   * so it is asserted rather than trusted.
   */
  t('the droplet is NOT inside the masked bar', Boolean(centre) && !bar.contains(centre));

  /*
   * A zero-content spacer holds the horizontal room so the four tabs space
   * themselves around the hollow instead of sliding underneath it.
   */
  const kids = [...bar.children];
  t(`the notch gap sits between tab 2 and 3 (index ${kids.indexOf(gap)} of ${kids.length})`,
    kids.indexOf(gap) === 2 && kids.length === 5);
  await act(async () => root.unmount());
  return rows;
}
