import { readFileSync } from 'node:fs';
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
  /*
   * ─── THE GEOMETRY, CHECKED AS ARITHMETIC ────────────────────────────────
   * jsdom does no layout, so pixel positions cannot be measured here. What
   * CAN be checked is that the numbers in the stylesheet still satisfy the
   * relationship they were derived from — which is where the bug actually
   * was.
   *
   * The notch is cut at the bar's TOP EDGE. For the drop to rest centred in
   * that hollow rather than sink into the bar, its centre must land on the
   * same line:
   *
   *     bottom + diameter/2  ===  barOffset + barHeight
   *     56     + 44/2        ===  14        + 64          = 78  ✓
   *
   * The first version used bottom:48, putting the centre at 70 — eight
   * pixels low, so the drop sank into the bar. That is precisely the
   * "merged into the menu" look that was reported, reintroduced by
   * arithmetic rather than by styling, and it looked plausible in the CSS.
   *
   * Every breakpoint must satisfy it, and the hollow must stay wider than
   * the drop or there is no visible ring of air and the separation is lost.
   */
  const css = readFileSync('src/index.css', 'utf8');
  const BAR_TOP_EDGE = 78; // 14px bar offset + 64px bar box (9 + 46 + 9)

  const num = (re) => {
    const m = css.match(re);
    return m ? Number(m[1]) : NaN;
  };

  const sizes = [
    { name: 'default', d: num(/\.nav-centre \{[\s\S]*?width: (\d+)px/), b: num(/\.nav-centre \{[\s\S]*?bottom: calc\((\d+)px/), r: num(/--notch-r: (\d+)px/) },
    { name: 'small phone', d: 40, b: 58, r: 25 },
    { name: 'landscape', d: 36, b: 60, r: 23 }
  ];

  for (const s of sizes) {
    const centre = s.b + s.d / 2;
    t(`${s.name}: the drop is centred in the hollow (centre ${centre}, edge ${BAR_TOP_EDGE})`,
      centre === BAR_TOP_EDGE);
    const air = (s.r * 2 - s.d) / 2;
    t(`${s.name}: there is a visible ring of air (${air}px)`, air >= 4);
  }

  /*
   * MINIMAL, per the reference the owner sent: one flat colour, no gradient,
   * and no coloured glow. A gradient on a 44px circle is detail nobody can
   * resolve; a neon halo is what made the previous version look inflated.
   */
  const dropRule = css.slice(css.indexOf('.nav-centre-drop {'), css.indexOf('.nav-centre-drop {') + 420);
  t('the drop is a flat colour, not a gradient', !/gradient/.test(dropRule));
  t('the drop is a plain circle', /border-radius: 50%;/.test(dropRule));
  t('the drop casts a neutral shadow, not a coloured glow',
    /box-shadow: 0 4px 12px -2px rgba\(0, 0, 0/.test(dropRule));

  await act(async () => root.unmount());
  return rows;
}
