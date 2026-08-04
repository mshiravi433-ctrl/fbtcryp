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

  /*
   * Slice a CSS rule to its ACTUAL closing brace.
   *
   * The first version of these checks took a fixed number of characters
   * after the selector, and the long explanatory comments inside these rules
   * pushed the declarations outside that window — so a correct stylesheet
   * reported a failure. Same brittle-window trap that bit the button-row
   * check earlier: guess a length and it silently stops matching. Find the
   * brace instead; there is nothing to outgrow.
   */
  const rule = (selector) => {
    const at = css.indexOf(selector);
    if (at < 0) return '';
    const close = css.indexOf('\n}', at);
    return close < 0 ? '' : css.slice(at, close + 2);
  };

  const BAR_TOP_EDGE = 78; // 14px bar offset + 64px bar box (9 + 46 + 9)

  const num = (re) => {
    const m = css.match(re);
    return m ? Number(m[1]) : NaN;
  };

  /*
   * Read every breakpoint OUT OF the stylesheet rather than restating the
   * numbers here. A duplicated constant in a test is a second place to
   * forget: the first version hardcoded the small-phone and landscape values
   * and kept reporting success after the real ones changed, which is a test
   * that has quietly stopped testing anything.
   */
  const block = (mediaQuery) => {
    const at = css.indexOf(mediaQuery);
    return at < 0 ? '' : css.slice(at, at + 600);
  };
  const pick = (src, re) => {
    const m = src.match(re);
    return m ? Number(m[1]) : NaN;
  };

  const defaults = rule('.nav-centre {');
  const smallBlk = block('@media (max-width: 360px)');
  const landBlk = block('@media (max-height: 480px) and (orientation: landscape)');

  const sizes = [
    {
      name: 'default',
      d: pick(defaults, /width: (\d+)px/),
      b: pick(defaults, /bottom: calc\((\d+)px/),
      r: num(/--notch-r: (\d+)px/)
    },
    {
      name: 'small phone',
      d: pick(smallBlk, /\.nav-centre \{[\s\S]*?width: (\d+)px/),
      b: pick(smallBlk, /bottom: calc\((\d+)px/),
      r: pick(smallBlk, /--notch-r: (\d+)px/)
    },
    {
      name: 'landscape',
      d: pick(landBlk, /\.nav-centre \{[\s\S]*?width: (\d+)px/),
      b: pick(landBlk, /bottom: calc\((\d+)px/),
      r: pick(landBlk, /--notch-r: (\d+)px/)
    }
  ];

  /* If a regex stops matching the numbers become NaN and every comparison
     below silently passes as false — assert they were found at all. */
  for (const z of sizes) {
    t(`${z.name}: the stylesheet values were found`,
      Number.isFinite(z.d) && Number.isFinite(z.b) && Number.isFinite(z.r));
  }

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
  const dropRule = rule('.nav-centre-drop {');
  t('the drop is a plain circle', /border-radius: 50%;/.test(dropRule));
  /*
   * Requested: RGB like the rest of the app. But the reason a gradient was
   * removed before still holds — a busy ramp on a 42px circle is noise. So
   * it must be the app palette in its calmest form: exactly TWO stops.
   * Three or more and it is detail nobody can resolve at this size.
   */
  t('the drop uses the app RGB palette', /--rgb-1/.test(dropRule) && /--rgb-2/.test(dropRule));
  t('...but only two stops, so it stays calm at 42px', !/--rgb-3/.test(dropRule));
  /*
   * A coloured glow is what made the earlier version look inflated. Black
   * reads as depth instead.
   */
  /*
   * ─── WHY THE SHADOW IS CHECKED FOR TIGHTNESS ───────────────────────────
   * Reported: «توپ به کف چسبیده» — the drop looked stuck to the floor.
   *
   * There WAS a gap; the shadow was hiding it. At `0 4px 12px` it fell four
   * pixels downward and blurred twelve, which spanned the whole clearance
   * and visually welded the drop to the rim.
   *
   * So two properties matter and both are asserted: the shadow must be
   * NEUTRAL (a coloured one reads as a glow and inflates the shape), and it
   * must be TIGHT — a large downward offset or blur bridges the gap again,
   * however correct the geometry is.
   */
  const shadow = dropRule.match(/box-shadow: 0 (\d+)px (\d+)px/);
  t('the drop has a shadow', Boolean(shadow));
  t('the shadow is neutral, not a coloured glow', /box-shadow:[^;]*rgba\(0, 0, 0/.test(dropRule));
  t(`the shadow does not bridge the gap (offset ${shadow?.[1]}px, blur ${shadow?.[2]}px)`,
    Boolean(shadow) && Number(shadow[1]) <= 2 && Number(shadow[2]) <= 8);

  /*
   * ─── THE TRANSFORM CONFLICT THAT MADE IT JUMP ───────────────────────────
   * Reported: «دکمه پس از زدن به سمت راست میرود» — after tapping, the button
   * moved right and stayed there.
   *
   * The button is centred with `transform: translateX(-50%)`. Framer Motion
   * does not add to an existing transform, it writes the whole property. So
   * `whileTap={{ scale }}` on the BUTTON replaced the centring with
   * `scale(...)`, shoving it 21px right — and Framer kept owning the
   * property afterwards, so it never came back.
   *
   * The rule: nothing in JS or CSS may animate the transform of the element
   * that carries the centring. The press scales the inner `.nav-centre-drop`
   * instead, which has no centring of its own.
   */
  const jsx = readFileSync('src/components/BottomNav.jsx', 'utf8');
  const centreFn = jsx.slice(jsx.indexOf('function CentreAction'), jsx.indexOf('export default function BottomNav'));
  t('the press does not animate the centred button itself',
    !/whileTap=\{still \? undefined : \{/.test(centreFn));
  t('the press scales the inner drop instead', /variants=\{\{ rest:/.test(centreFn));

  const centreRule = rule('.nav-centre {');
  t('the button keeps its CSS centring', /transform: translateX\(-50%\)/.test(centreRule));
  /*
   * The active state must not use a transform either — it would be wiped by
   * the first tap and never reapplied, which is the same bug wearing a
   * different hat.
   */
  const activeRule = rule('.nav-centre.active .nav-centre-drop {');
  t('the active state does not fight Framer for the transform', !/transform:/.test(activeRule));

  /* The glyph must match where the button actually goes. A home icon on a
     Buy button was already caught once; now it points at Automatic Orders. */
  t('the centre button goes to automatic orders', /to: '\/orders'/.test(jsx));

  await act(async () => root.unmount());
  return rows;
}
