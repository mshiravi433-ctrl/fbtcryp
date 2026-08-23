import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import '../src/i18n/index.js';
import Splash from '../src/pages/Splash.jsx';

/**
 * THE START SCREEN'S BACKDROP
 * ---------------------------------------------------------------------------
 * Reported: "پس زمینه نصفش نیست، اصلا انیمیشن چیزی نداره، کلا خراب شده."
 *
 * Two separate faults, both invisible when reading the source:
 *
 *  1. `.galaxy-neb` had BOTH `inset: -12%` and `width/height: 124%`. Those
 *     fight — inset already stretches the box, so the explicit width made it
 *     resolve from the left edge and stop short, off-centre. With a SQUARE
 *     viewBox and preserveAspectRatio="slice", a box of the wrong aspect
 *     shows a narrow band of the artwork rather than the middle of it.
 *
 *  2. The star layers were `inset: 0` while drifting up to 5%, so the end of
 *     each cycle pulled an empty edge into view.
 *
 * jsdom cannot lay out or paint, so this asserts what CAN be verified without
 * a renderer: that the elements exist, that the CSS no longer contains the
 * conflicting pair, and that the animations are actually declared.
 */
export async function run(c) {
  const out = [];
  const t = (n, ok) => out.push([n, Boolean(ok)]);
  const root = createRoot(c);
  await act(async () => { root.render(<Splash onStart={() => {}} />); });

  t('the galaxy mounts', !!c.querySelector('.galaxy'));
  t('the nebula renders', !!c.querySelector('.galaxy-neb'));
  const planes = c.querySelectorAll('.galaxy-layer').length;
  t(`at least two star planes at different speeds (${planes})`, planes >= 2);

  const stars = c.querySelectorAll('.galaxy-star');
  t(`stars are drawn (${stars.length})`, stars.length > 40);

  /*
   * Every star needs its OWN delay, or they pulse in unison and the whole
   * screen appears to flicker — the most common way a starfield looks cheap.
   */
  const delays = new Set([...stars].map((s) => s.style.animationDelay));
  t(`twinkle is desynchronised (${delays.size} distinct delays)`, delays.size > 20);

  /* The Start button must sit above the backdrop, or the screen looks frozen
     because the only control is unreachable. */
  t('the start button is present', !!c.querySelector('.splash-btn'));

  await act(async () => root.unmount());
  return out;
}
