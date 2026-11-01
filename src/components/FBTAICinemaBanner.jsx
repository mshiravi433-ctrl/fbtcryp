import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { useStill } from './AnimatedIcon';
import { IconChevronRight } from './Icons';
/*
 * ITS OWN STYLESHEET (2026-11-01).
 *
 * These rules used to live in market-modern.css, which Market.jsx imports — so
 * 28 KB of banner CSS (and fifteen looping animations' worth of selectors)
 * shipped on the app's HOME route for a banner no screen currently renders.
 * Every other self-contained surface here owns its sheet (DecisionOrb →
 * decision-orb.css, MoreSheet → more-menu.css); this one now does too, and it
 * travels in whatever chunk eventually mounts it.
 */
import '../styles/fbt-ai-cinema.css';

/**
 * FBT AI — Living Intelligence.
 * ---------------------------------------------------------------------------
 * The Market screen's «سیگنال هوشمند» house ad.
 *
 * ─── WHAT WAS ACTUALLY WRONG WITH IT ────────────────────────────────────────
 *   «بنر سیگنال هوشمند خیلی بزرگه از عرض و طول، جملات و همه‌چیزش سمت چپ کشیده
 *    شده و سمت راست بنر خالیه، دکمه و جملات در یک خط هست به جای افقی بودن.»
 *
 * That report was not a taste complaint, it was a LAYOUT BUG, and the cause was
 * one line of CSS: `.fbt-ai-banner > * { position: relative }` painted over the
 * `position: absolute` of the three ambient layers (grid + two glows). They
 * stopped being a backdrop and became FLEX ITEMS — so the flex row had five
 * children instead of two, the two glows (62% and 58% wide, aspect-ratio 1)
 * ate the free space on one side, and the copy column was squeezed into the
 * ~87px that was left. Every symptom in that sentence follows from it: a 332px
 * tall banner on a 390px phone, sentences wrapping one word per line, the CTA
 * broken over two lines, and a large empty area where a glow was sitting.
 *
 * The fix is structural, not cosmetic: the ambient layers now live inside ONE
 * absolutely-positioned `.fbt-ai-ambient` wrapper, so no child-count change and
 * no future `> *` rule can ever turn the backdrop into layout again. The panel
 * itself is a two-column grid — copy on the reading side, mascot on the far
 * side — with the copy column owning all the free width.
 *
 * ─── THE MASCOT ─────────────────────────────────────────────────────────────
 * The old fox was drawn from thin outlines: two ear triangles poking through a
 * rounded skull, a face plate, a muzzle, a smile, and it read as a sketched
 * cat rather than a product's character. The new mark is built the way modern
 * app mascots are: one solid silhouette (a fox head with real cheek fur), a
 * single glass visor carrying two glowing eyes, a forehead crest that is the
 * FBT AI gem, and a dashed orbit that frames it. Fewer, bigger shapes; one
 * light source; no outline soup. It is still SVG and still animated with CSS
 * transforms/opacity only — no 3D engine, no asset request, no WebGL context.
 *
 * ─── MOTION BUDGET (unchanged, and now smaller) ─────────────────────────────
 * Every loop pauses when the panel is off-screen and freezes entirely under the
 * app's reduce-motion setting. The CTA's old infinite `box-shadow` pulse is
 * gone (a shadow animation repaints the button every frame); the CTA now has a
 * static glow and moves on hover only.
 */

/*
 * Holographic dust. Fixed seed — random values regenerated on every render
 * would re-trigger CSS transitions and make the field shimmer for no reason.
 *
 * `x/y` is the resting position inside the mascot stage (%), `tx/ty` the drift
 * vector and `d` the loop period. Deliberately sparse: ten motes read as
 * "energy" and twenty read as "confetti".
 */
const PARTICLES = [
  { x: 14, y: 18, tx: 7, ty: -9, d: 5.4 },
  { x: 30, y: 8, tx: -5, ty: -7, d: 6.1 },
  { x: 46, y: 20, tx: 8, ty: 6, d: 4.8 },
  { x: 62, y: 10, tx: -6, ty: -8, d: 6.6 },
  { x: 78, y: 22, tx: 9, ty: -5, d: 5.2 },
  { x: 88, y: 12, tx: -7, ty: -9, d: 6.0 },
  { x: 22, y: 46, tx: 6, ty: 8, d: 5.8 },
  { x: 42, y: 62, tx: -8, ty: 7, d: 6.4 },
  { x: 60, y: 76, tx: 7, ty: -8, d: 5.0 },
  { x: 80, y: 64, tx: -6, ty: 8, d: 6.2 }
];

/**
 * Reactive in-view flag, own IntersectionObserver — not framer-motion's
 * `useInView`.
 *
 * Two reasons. First, the component must run under the app's own motion
 * setting as well as the system's, and it must pause its loops when scrolled
 * away; a raw observer gives exactly that and nothing more. Second, this file
 * is imported by screens whose tests mock `framer-motion` down to a `motion`
 * stub and a `useReducedMotion` — a mock that grows every time some other
 * component decides to import a new hook from there. A local hook means the
 * banner has one less thing to break when that mock is refreshed.
 *
 * Falls back to "visible" where `IntersectionObserver` does not exist (older
 * WebViews, jsdom), so the panel still renders instead of being stuck invisible.
 */
function useInView(ref, { amount = 0.12, rootMargin = '140px' } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(Boolean(entry.isIntersecting));
      },
      { threshold: amount, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, amount, rootMargin]);
  return inView;
}

export default function FBTAICinemaBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const still = useStill();
  const hostRef = useRef(null);
  const inView = useInView(hostRef, { amount: 0.12, rootMargin: '140px' });
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const fx = (name) => `${name}-${uid}`;

  /*
   * Entrance is scroll-triggered, not mount-triggered: the banner sits below
   * the stories rail, so animating it on mount would play while it is still
   * off-screen and the user would see nothing happen. `entered` flips once the
   * panel actually intersects (or immediately under reduced motion, so the
   * panel is simply there). The animation itself is CSS — see
   * `.fbt-ai-banner.is-entered` — which keeps framer-motion out of this
   * component entirely and means a mocked-down `motion` in a screen's test
   * never gets between the banner and its own IntersectionObserver.
   */
  const entered = still || inView;

  /*
   * Pointer parallax — one rAF-throttled listener for the whole document.
   *
   * The mascot turns its head toward the cursor and the pupils follow. Both
   * effects are read as CSS custom properties on the banner, so the JS only
   * ever writes two numbers; the compositor does the rest. Gated on
   * `inView` so a banner scrolled out of the page costs nothing, and on
   * `still` so reduced-motion users get a static, dignified panel.
   */
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [touched, setTouched] = useState(false);

  /*
   * A tap gives the fox a quick breath. Pointer events cover touch, but a
   * tap produces no movement, so a passive pointermove would never reach the
   * mascot on a phone — which is exactly where the brief asks for a touch
   * reaction. The flag decays on its own; no timer leaks, no state piles up.
   */
  const onPointerDown = useCallback(() => {
    if (still) return;
    setTouched(true);
    window.setTimeout(() => setTouched(false), 750);
  }, [still]);

  useEffect(() => {
    if (!inView || still) return;
    let raf = 0;
    let nx = 0;
    let ny = 0;

    const commit = () => {
      raf = 0;
      setPointer({ x: nx, y: ny });
    };

    const onMove = (e) => {
      const el = hostRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Centre-relative, clamped to ±1, then flipped: moving right tilts the
      // head the other way, which reads as the fox looking at you.
      nx = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * -1));
      ny = Math.max(-1, Math.min(1, ((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * -1));
      if (!raf) raf = requestAnimationFrame(commit);
    };
    const onLeave = () => {
      nx = 0;
      ny = 0;
      if (!raf) raf = requestAnimationFrame(commit);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [inView, still]);

  /*
   * Same destination the plain `AdBanner slot="signals"` used: the app's own
   * Market Signals screen. No new route, no invented link.
   */
  const onCta = useCallback(() => {
    haptic?.('light');
    navigate('/signals');
  }, [haptic, navigate]);

  /*
   * The headline's last word gets the neon treatment. Splitting on the LAST
   * SPACE (not on a fixed phrase) keeps the accessible name identical to the
   * translated string in every one of the twelve locales — the h2 still reads
   * as one sentence to a screen reader, and a translator can never break the
   * layout by changing the wording.
   */
  const title = t('marketAiBanner.title');
  const titleCut = title.lastIndexOf(' ');
  const titleLead = titleCut > 0 ? title.slice(0, titleCut) : title;
  const titleTail = titleCut > 0 ? title.slice(titleCut + 1) : '';

  return (
    <article
      ref={hostRef}
      className={`fbt-ai-banner${entered ? ' is-entered' : ''}${touched ? ' is-touched' : ''}`}
      data-visible={inView ? 'true' : 'false'}
      data-still={still ? 'true' : undefined}
      onPointerDown={onPointerDown}
      style={{
        /* One source of truth for the neon pair; the stylesheet reads these
           rather than the page theme so the panel stays neon-on-dark in both
           light and dark mode — a premium promo panel that re-themed to white
           in light mode would lose the entire point of the asset. */
        '--fbt-a': '#7c4dff',
        '--fbt-b': '#00e5ff',
        '--fbt-c': '#3b6cff',
        '--fbt-px': pointer.x,
        '--fbt-py': pointer.y
      }}
      aria-label={title}
    >
      {/*
        ── AMBIENT LAYERS, IN ONE WRAPPER ───────────────────────────────────
        This wrapper is the fix. As siblings, the grid and the two glows were
        flex/grid ITEMS (a later `> *` rule repainted them `position: relative`)
        and they collapsed the copy column to 87px. Inside one absolutely
        positioned span they are a backdrop again — forever, regardless of what
        any future child-selector rule says.
      */}
      <span className="fbt-ai-ambient" aria-hidden="true">
        <i className="fbt-ai-glow fbt-ai-glow--a" />
        <i className="fbt-ai-glow fbt-ai-glow--b" />
        <i className="fbt-ai-grid" />
        <i className="fbt-ai-conic" />
        <i className="fbt-ai-sheen" />
      </span>

      {/* ── copy ─────────────────────────────────────────────────────────── */}
      <div className="fbt-ai-copy">
        <span className="fbt-ai-eyebrow">
          <span className="fbt-ai-dot" aria-hidden="true" />
          {t('marketAiBanner.eyebrow')}
        </span>
        <h2 className="fbt-ai-title">
          {titleLead}
          {titleTail ? <> <span className="fbt-ai-title-accent">{titleTail}</span></> : null}
        </h2>
        <p className="fbt-ai-desc">{t('marketAiBanner.desc')}</p>
        <button type="button" className="fbt-ai-cta" onClick={onCta}>
          <span className="fbt-ai-cta-label">{t('marketAiBanner.cta')}</span>
          <IconChevronRight width={14} height={14} />
        </button>
      </div>

      {/* ── the mascot stage ──────────────────────────────────────────────── */}
      <div className="fbt-ai-stage" aria-hidden="true">
        <span className="fbt-ai-stage-glow" />

        {/* Holographic financial read-out behind the fox. */}
        <svg className="fbt-ai-chart" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={fx('fbtai-area')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.34" />
              <stop offset="60%" stopColor="#3b6cff" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#3b6cff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={fx('fbtai-line')} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.25" />
              <stop offset="45%" stopColor="#58f5ff" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#a98bff" stopOpacity="0.95" />
            </linearGradient>
            {/* Both ends of the read-out run off the edge of the stage, and a
                filled area that stops on a hard vertical line at x=0 / x=320
                reads as a broken box rather than as a chart that continues
                beyond the frame. The fade makes the crop intentional. */}
            <linearGradient id={fx('fbtai-fade')} x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.18" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.84" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id={fx('fbtai-fademask')} maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="200">
              <rect x="0" y="0" width="320" height="200" fill={`url(#${fx('fbtai-fade')})`} />
            </mask>
          </defs>
          <g mask={`url(#${fx('fbtai-fademask')})`}>
          <path
            d="M0 158 C 26 150 44 166 68 148 S 108 118 132 128 S 172 92 200 100 S 244 68 268 58 S 300 48 320 40 L320 200 L0 200 Z"
            fill={`url(#${fx('fbtai-area')})`}
          />
          <path
            className="fbt-chart-line"
            d="M0 158 C 26 150 44 166 68 148 S 108 118 132 128 S 172 92 200 100 S 244 68 268 58 S 300 48 320 40"
            stroke={`url(#${fx('fbtai-line')})`}
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="fbt-chart-line fbt-chart-line--2"
            d="M0 178 C 30 176 52 182 80 170 S 122 152 150 160 S 200 150 232 162 S 288 158 320 168"
            stroke="#7c4dff"
            strokeWidth="1.4"
            fill="none"
            strokeOpacity="0.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          </g>
          <circle className="fbt-chart-dot" cx="316" cy="41" r="3.6" fill="#bffcff" />
          <circle className="fbt-chart-ring" cx="316" cy="41" r="7" fill="none" stroke="#7df9ff" strokeWidth="1.2" />
        </svg>

        <div className="fbt-ai-mascot">
          <svg className="fox-svg" viewBox="0 0 240 240" fill="none" role="img">
            <defs>
              <linearGradient id={fx('fbtai-edge')} x1="40" y1="20" x2="204" y2="216" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#8ff9ff" />
                <stop offset="0.42" stopColor="#3f8cff" />
                <stop offset="1" stopColor="#b06bff" />
              </linearGradient>
              <linearGradient id={fx('fbtai-head')} x1="72" y1="48" x2="176" y2="196" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#22356b" />
                <stop offset="0.46" stopColor="#121c40" />
                <stop offset="1" stopColor="#0a1129" />
              </linearGradient>
              <linearGradient id={fx('fbtai-ear')} x1="52" y1="26" x2="136" y2="122" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#31488a" />
                <stop offset="1" stopColor="#0d1633" />
              </linearGradient>
              <linearGradient id={fx('fbtai-ear-in')} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8ff9ff" stopOpacity="0.75" />
                <stop offset="1" stopColor="#b06bff" stopOpacity="0.12" />
              </linearGradient>
              <linearGradient id={fx('fbtai-visor')} x1="86" y1="110" x2="154" y2="134" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#0a1434" />
                <stop offset="1" stopColor="#060b1c" />
              </linearGradient>
              <radialGradient id={fx('fbtai-eye')} cx="50%" cy="44%" r="58%">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.28" stopColor="#cdfdff" />
                <stop offset="0.66" stopColor="#25d9f5" />
                <stop offset="1" stopColor="#25d9f5" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={fx('fbtai-halo')} cx="50%" cy="50%" r="50%">
                <stop offset="0" stopColor="#2ee6ff" stopOpacity="0.34" />
                <stop offset="0.58" stopColor="#6a5bff" stopOpacity="0.16" />
                <stop offset="1" stopColor="#b06bff" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={fx('fbtai-gem')} x1="114" y1="68" x2="126" y2="94" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.5" stopColor="#8ff9ff" />
                <stop offset="1" stopColor="#b06bff" />
              </linearGradient>
              <linearGradient id={fx('fbtai-rim')} x1="0" y1="52" x2="0" y2="128" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* volumetric core */}
            <circle className="fox-core" cx="120" cy="124" r="98" fill={`url(#${fx('fbtai-halo')})`} />

            {/* the orbit that frames the whole mark */}
            <circle
              className="fox-orbit"
              cx="120"
              cy="124"
              r="92"
              stroke={`url(#${fx('fbtai-edge')})`}
              strokeWidth="1"
              strokeOpacity="0.34"
              strokeDasharray="2 9"
            />

            {/* ears — drawn before the skull so it overlaps their bases */}
            <g className="fox-ear fox-ear--l" strokeLinejoin="round">
              <path d="M52 30 L78 118 L116 74 Z" fill={`url(#${fx('fbtai-ear')})`} stroke={`url(#${fx('fbtai-edge')})`} strokeWidth="2.4" />
              <path d="M65 52 L80 110 L107 78 Z" fill={`url(#${fx('fbtai-ear-in')})`} />
            </g>
            <g className="fox-ear fox-ear--r" strokeLinejoin="round">
              <path d="M188 30 L162 118 L124 74 Z" fill={`url(#${fx('fbtai-ear')})`} stroke={`url(#${fx('fbtai-edge')})`} strokeWidth="2.4" />
              <path d="M175 52 L160 110 L133 78 Z" fill={`url(#${fx('fbtai-ear-in')})`} />
            </g>

            {/* cheek fur */}
            <path d="M76 130 L54 150 L70 156 L80 142 Z" fill={`url(#${fx('fbtai-head')})`} stroke={`url(#${fx('fbtai-edge')})`} strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M164 130 L186 150 L170 156 L160 142 Z" fill={`url(#${fx('fbtai-head')})`} stroke={`url(#${fx('fbtai-edge')})`} strokeWidth="1.8" strokeLinejoin="round" />

            {/* skull */}
            <path
              d="M120 60 C 99 60 80 67 71 84 C 63 99 65 116 74 134 C 84 155 102 172 120 182 C 138 172 156 155 166 134 C 175 116 177 99 169 84 C 160 67 141 60 120 60 Z"
              fill={`url(#${fx('fbtai-head')})`}
              stroke={`url(#${fx('fbtai-edge')})`}
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
            {/* specular rim light along the top edge */}
            <path d="M120 61.6 C 99 61.6 81 68.6 72 84" stroke={`url(#${fx('fbtai-rim')})`} strokeWidth="1.3" strokeLinecap="round" />

            {/* visor + eyes */}
            <rect x="80" y="108" width="80" height="34" rx="17" fill={`url(#${fx('fbtai-visor')})`} stroke={`url(#${fx('fbtai-edge')})`} strokeWidth="1.4" strokeOpacity="0.85" />
            <g className="fox-eye fox-eye--l">
              <ellipse className="fox-eye-glow" cx="101" cy="125" rx="10.6" ry="9.8" fill={`url(#${fx('fbtai-eye')})`} />
              <g className="fox-pupil">
                <ellipse cx="102.6" cy="124" rx="3" ry="4.2" fill="#ffffff" />
              </g>
            </g>
            <g className="fox-eye fox-eye--r">
              <ellipse className="fox-eye-glow" cx="139" cy="125" rx="10.6" ry="9.8" fill={`url(#${fx('fbtai-eye')})`} />
              <g className="fox-pupil">
                <ellipse cx="140.6" cy="124" rx="3" ry="4.2" fill="#ffffff" />
              </g>
            </g>

            {/* nose + smile */}
            <path d="M113 152 L127 152 L120 161 Z" fill={`url(#${fx('fbtai-gem')})`} stroke={`url(#${fx('fbtai-edge')})`} strokeWidth="1.1" strokeLinejoin="round" />
            <path
              className="fox-line"
              d="M120 161 L120 165 M120 165 C 115 168 111 168 108 166 M120 165 C 125 168 129 168 132 166"
              stroke={`url(#${fx('fbtai-edge')})`}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeOpacity="0.85"
            />

            {/* forehead crest — the FBT AI gem, engraved rather than floating */}
            <g className="fox-crest">
              <path d="M120 70 L127 79 L120 92 L113 79 Z" fill={`url(#${fx('fbtai-gem')})`} stroke="#cdfdff" strokeWidth="0.9" strokeOpacity="0.55" />
              <path d="M120 74 L124 79 L120 87 L116 79 Z" fill="#ffffff" fillOpacity="0.55" />
            </g>
          </svg>
        </div>

        <div className="fbt-ai-particles">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="fbt-ai-particle"
              style={{
                '--px-x': `${p.x}%`,
                '--px-y': `${p.y}%`,
                '--px-tx': `${p.tx}px`,
                '--px-ty': `${p.ty}px`,
                '--px-d': `${p.d}s`,
                '--px-s': `${p.s ?? 3}px`
              }}
            />
          ))}
        </div>
      </div>
    </article>
  );
}
