/**
 * The RGB light field behind everything.
 *
 * ─── WHY THE ORBS STOP MOVING ON THE PACKAGED APP ───────────────────────────
 * Three orbs sized 60vw / 55vw / 48vw, each with `filter: blur(70px)`, each on
 * an infinite CSS drift animation. On a 1080px-wide phone that is roughly a
 * million blurred pixels the compositor must re-blur EVERY FRAME, on EVERY
 * screen, for as long as the app is open — because this component sits above
 * the router and never unmounts.
 *
 * In a browser that is survivable: the tab gets a full GPU pipeline and the
 * work is discarded when the tab is backgrounded. Inside a Capacitor WebView
 * it is not. The WebView composites through the host app, competes with the
 * native layer for the same GPU, and never gets the browser's page-visibility
 * optimisations. It is the single biggest reason the APK feels heavier than
 * the site while running identical code.
 *
 * So on native the orbs render as a STATIC gradient: same palette, same depth,
 * zero per-frame cost. The web keeps the motion.
 *
 * --- AND THE iPHONE PWA IS THE NATIVE CASE, NOT THE BROWSER CASE -------------
 * `Capacitor.isNativePlatform()` is false in Safari, so this check let an
 * iPhone home-screen install pay the full price: WebKit, standalone mode, no
 * browser chrome to offload compositing to — the slowest combination this app
 * runs in. There is no iOS build of this product, so that install IS the
 * iPhone product. Reported as the iPhone web app being very slow.
 *
 * An installed PWA is frozen here, and the same class of device is written to
 * `<html data-lite>` by applyNativeFlag() so the CSS-side savings (the two
 * permanent backdrop-filters, the sheen sweeps) cannot drift away from this
 * decision.
 *
 * `prefers-reduced-motion` freezes it everywhere, which it should have done
 * from the start — a permanently drifting background is exactly the kind of
 * motion that triggers vestibular symptoms.
 *
 * Deciding here rather than in CSS keeps it one class on one element instead
 * of a media query duplicated across every orb rule.
 */
import { isStandalone } from '../lib/platform';

const isNative = () =>
  typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());

/** `deviceMemory` is Chromium-only; its absence means "unknown", never "slow". */
const isLowMemory = () =>
  typeof navigator !== 'undefined'
  && Number(navigator.deviceMemory || 0) > 0
  && Number(navigator.deviceMemory) <= 3;

/**
 * ─── PHONES PAY FOR THIS FIELD EVEN IN A BROWSER TAB ────────────────────────
 * Reported, twice: «هنوز در سرعت سایت و سرعت لود پایینه» and «وقتی اسکرول می‌کنی
 * پایین یا بالا صفحه سیاهه».
 *
 * The three orbs are 520/480/440px circles with `filter: blur(48px)` and
 * `will-change: transform`, drifting on infinite keyframes. `will-change`
 * pins each one as a GPU layer — at DPR 3 that is roughly 1,500×1,500 texels
 * per orb, three of them, held for the entire session, ON TOP of every
 * backdrop-filtered panel the page draws. A mobile GPU that runs out of
 * texture memory does not throw; it drops layers, and dropped layers look like
 * black rectangles while you scroll.
 *
 * The rule this file already had — freeze on native, on an installed PWA and
 * on a low-memory device — was simply too short a list. Below 900px the drift
 * is 40px of movement over 48 seconds: nobody has ever seen it move, and it
 * costs the same as on a desktop. So a phone-width viewport gets the static
 * field too. The palette, the depth and the vignette are identical; only the
 * 48-second drift is gone.
 */
const isSmallViewport = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(max-width: 900px)').matches;

export default function RgbBackground() {
  const still = isNative() || isStandalone() || isLowMemory() || isSmallViewport();

  return (
    <div className={`rgb-field${still ? ' rgb-still' : ''}`} aria-hidden="true">
      <div className="rgb-orb a" />
      <div className="rgb-orb b" />
      <div className="rgb-orb c" />
      <div className="rgb-grid" />
      <div className="rgb-vignette" />
    </div>
  );
}
