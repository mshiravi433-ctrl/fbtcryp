import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { useStill } from './AnimatedIcon';
import { IconChevronRight } from './Icons';

/**
 * FBT AI — Living Intelligence.
 * ---------------------------------------------------------------------------
 * The Market screen's «سیگنال هوشمند» house ad, rebuilt as a premium
 * interactive AI showcase instead of a flat promo card.
 *
 * WHY A DEDICATED COMPONENT RATHER THAN ANOTHER `premium` FLAG ON `AdBanner`:
 * `AdBanner` is a nine-screen utility — one slot per destination, one compact
 * row of layout, one set of shared inks. This slot is a different species of
 * object: a two-column cinematic panel with a hand-built animated mascot,
 * particle field, data streams and a live chart. Folding it into the shared
 * component would mean a `premium` branch that half the stylesheet has to keep
 * remembering exists. It is one instance, on one screen, so it lives in its own
 * file and `Market.jsx` wires it in directly.
 *
 * THE MASCOT IS SVG, NOT THREE.JS.
 * A glass cybernetic fox drawn as vector geometry and animated with CSS
 * transforms/opacity. That is deliberate: the brief asks for a premium 3D
 * feel without introducing a 3D engine for a single banner. SVG keeps the
 * whole thing weightless (no asset request, no WebGL context, no GPU ramp on
 * Android), scales crisply from a 200px desktop panel to a 96px phone, and
 * still gives per-part control — ears twitch, eyes blink, the head tracks the
 * pointer, the rings spin. The "3D" comes from layered translucency, volumetric
 * gradients and parallax, not from a rasterised model.
 *
 * EVERY PERPETUAL ANIMATION IS PAUSED OFF-SCREEN AND FREEZABLE.
 * The old banner had nine `repeat: Infinity` timers running on nine screens;
 * this one runs its loops only while it is actually in view, and stops dead
 * under `prefers-reduced-motion` or the app's own reduce-motion setting.
 */

/*
 * Holographic dust. Fixed seed — see `AdBanner`'s shimmer note. Random values
 * regenerated on every render would re-trigger CSS transitions and make the
 * field shimmer for no reason.
 *
 * `x/y` is the resting position inside the mascot stage (%), `tx/ty` the drift
 * vector and `d` the loop period. Deliberately sparse: twelve motes read as
 * "energy" and thirteen read as "confetti".
 */
const PARTICLES = [
  { x: 14, y: 18, tx: 7, ty: -9, d: 5.4 },
  { x: 30, y: 8, tx: -5, ty: -7, d: 6.1 },
  { x: 46, y: 20, tx: 8, ty: 6, d: 4.8 },
  { x: 60, y: 10, tx: -6, ty: -8, d: 6.6 },
  { x: 74, y: 22, tx: 9, ty: -5, d: 5.2 },
  { x: 86, y: 12, tx: -7, ty: -9, d: 6.0 },
  { x: 22, y: 44, tx: 6, ty: 8, d: 5.8 },
  { x: 40, y: 58, tx: -8, ty: 7, d: 6.4 },
  { x: 58, y: 70, tx: 7, ty: -8, d: 5.0 },
  { x: 78, y: 62, tx: -6, ty: 8, d: 6.2 },
  { x: 88, y: 46, tx: 8, ty: 6, d: 5.6 },
  { x: 64, y: 84, tx: -7, ty: -7, d: 6.8 }
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
      aria-label={t('marketAiBanner.title')}
    >
      {/* ── ambient layers ───────────────────────────────────────────────── */}
      <span className="fbt-ai-grid" aria-hidden="true" />
      <span className="fbt-ai-glow fbt-ai-glow--a" aria-hidden="true" />
      <span className="fbt-ai-glow fbt-ai-glow--b" aria-hidden="true" />

      {/* ── copy ─────────────────────────────────────────────────────────── */}
      <div className="fbt-ai-copy">
        <span className="fbt-ai-eyebrow">
          <span className="fbt-ai-dot" aria-hidden="true" />
          {t('marketAiBanner.eyebrow')}
        </span>
        <h2 className="fbt-ai-title">{t('marketAiBanner.title')}</h2>
        <p className="fbt-ai-desc">{t('marketAiBanner.desc')}</p>
        <button type="button" className="fbt-ai-cta" onClick={onCta}>
          <span className="fbt-ai-cta-label">{t('marketAiBanner.cta')}</span>
          <IconChevronRight width={15} height={15} />
        </button>
      </div>

      {/* ── the mascot stage ──────────────────────────────────────────────── */}
      <div className="fbt-ai-stage" aria-hidden="true">
        {/* Holographic financial read-out behind the fox. */}
        <svg className="fbt-ai-chart" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="fbtai-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 150 L40 140 L80 146 L120 120 L160 128 L200 96 L240 104 L280 70 L320 60 L320 200 L0 200 Z"
            fill="url(#fbtai-area)"
          />
          <path
            className="fbt-chart-line"
            d="M0 150 L40 140 L80 146 L120 120 L160 128 L200 96 L240 104 L280 70 L320 60"
            stroke="#00e5ff"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="fbt-chart-line fbt-chart-line--2"
            d="M0 172 L40 168 L80 174 L120 160 L160 168 L200 180 L240 174 L280 184 L320 178"
            stroke="#7c4dff"
            strokeWidth="1.4"
            fill="none"
            strokeOpacity="0.55"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle className="fbt-chart-dot" cx="280" cy="70" r="3.4" fill="#00e5ff" />
          <circle className="fbt-chart-ring" cx="280" cy="70" r="7" fill="none" stroke="#00e5ff" strokeWidth="1.2" />
        </svg>

        <div className="fbt-ai-mascot">
          <svg className="fox-svg" viewBox="0 0 240 240" fill="none" role="img">
            <defs>
              <linearGradient id="fbtai-edge" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="55%" stopColor="#3b6cff" />
                <stop offset="100%" stopColor="#7c4dff" />
              </linearGradient>
              <linearGradient id="fbtai-glass" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.36)" />
                <stop offset="55%" stopColor="rgba(124,77,255,0.18)" />
                <stop offset="100%" stopColor="rgba(0,229,255,0.12)" />
              </linearGradient>
              <linearGradient id="fbtai-glass2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.24)" />
                <stop offset="100%" stopColor="rgba(124,77,255,0.10)" />
              </linearGradient>
              <radialGradient id="fbtai-eye" cx="50%" cy="42%" r="62%">
                <stop offset="0%" stopColor="#eafdff" />
                <stop offset="38%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor="#7c4dff" stopOpacity="0.35" />
              </radialGradient>
              <radialGradient id="fbtai-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.55" />
                <stop offset="55%" stopColor="#7c4dff" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#7c4dff" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="fbtai-gem" cx="50%" cy="40%" r="65%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="40%" stopColor="#00e5ff" />
                <stop offset="100%" stopColor="#7c4dff" />
              </radialGradient>
            </defs>

            {/* volumetric core */}
            <ellipse className="fox-core" cx="120" cy="120" rx="80" ry="80" fill="url(#fbtai-core)" />

            {/* holographic rings */}
            <g className="fox-rings" transform="translate(120 120)">
              <circle className="fox-ring" r="96" />
              <circle className="fox-ring fox-ring--2" r="110" />
            </g>

            {/* ears — drawn under the head so the skull overlaps their bases */}
            <g className="fox-ear fox-ear--l">
              <path
                className="fox-fill-2"
                d="M74 102 L52 16 L112 74 Z"
                stroke="url(#fbtai-edge)"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
              <path d="M84 94 L76 44 L106 80 Z" fill="rgba(0,229,255,0.24)" />
            </g>
            <g className="fox-ear fox-ear--r">
              <path
                className="fox-fill-2"
                d="M166 102 L188 16 L128 74 Z"
                stroke="url(#fbtai-edge)"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
              <path d="M156 94 L164 44 L134 80 Z" fill="rgba(0,229,255,0.24)" />
            </g>

            {/* skull */}
            <path
              className="fox-fill"
              d="M120 54 C 84 54 60 78 54 104 C 50 122 58 134 68 146 C 80 162 100 170 120 170 C 140 170 160 162 172 146 C 182 134 190 122 186 104 C 180 78 156 54 120 54 Z"
              stroke="url(#fbtai-edge)"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />

            {/* face plate */}
            <path
              className="fox-face"
              d="M120 86 C 96 86 80 98 76 114 C 73 128 80 140 92 148 C 104 156 136 156 148 148 C 160 140 167 128 164 114 C 160 98 144 86 120 86 Z"
              stroke="url(#fbtai-edge)"
              strokeWidth="1.2"
              strokeOpacity="0.65"
            />

            {/* muzzle */}
            <path
              className="fox-muzzle"
              d="M120 128 C 106 128 96 136 96 146 C 96 155 104 162 120 162 C 136 162 144 155 144 146 C 144 136 134 128 120 128 Z"
              stroke="url(#fbtai-edge)"
              strokeWidth="1.2"
              strokeOpacity="0.6"
            />

            {/* nose + mouth */}
            <path
              d="M113 146 L127 146 L120 154 Z"
              fill="url(#fbtai-gem)"
              stroke="url(#fbtai-edge)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              className="fox-line"
              d="M120 154 L120 158 M120 158 C 114 160 110 162 108 161 M120 158 C 126 160 130 162 132 161"
              stroke="url(#fbtai-edge)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />

            {/* eyes — glow, pupil and a single specular hit */}
            <g className="fox-eye fox-eye--l">
              <ellipse className="fox-eye-glow" cx="96" cy="112" rx="13" ry="15.5" fill="url(#fbtai-eye)" />
              <g className="fox-pupil">
                <ellipse cx="98" cy="114" rx="5.6" ry="7.4" fill="#07091a" />
              </g>
              <circle className="fox-eye-hit" cx="93" cy="108" r="2.6" fill="#ffffff" />
            </g>
            <g className="fox-eye fox-eye--r">
              <ellipse className="fox-eye-glow" cx="144" cy="112" rx="13" ry="15.5" fill="url(#fbtai-eye)" />
              <g className="fox-pupil">
                <ellipse cx="146" cy="114" rx="5.6" ry="7.4" fill="#07091a" />
              </g>
              <circle className="fox-eye-hit" cx="141" cy="108" r="2.6" fill="#ffffff" />
            </g>

            {/* cheek tech seams */}
            <path
              className="fox-line"
              d="M58 122 C 72 124 80 126 84 130 M182 122 C 168 124 160 126 156 130"
              stroke="url(#fbtai-edge)"
              strokeWidth="1.3"
              strokeOpacity="0.7"
              strokeLinecap="round"
            />

            {/* chest + chestplate gem */}
            <path
              className="fox-fill fox-chest"
              d="M86 164 C 80 190 92 210 120 212 C 148 210 160 190 154 164 C 142 172 98 172 86 164 Z"
              stroke="url(#fbtai-edge)"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <g className="fox-gem">
              <circle cx="120" cy="192" r="12" fill="url(#fbtai-gem)" stroke="url(#fbtai-edge)" strokeWidth="1.4" />
              <path d="M120 183 L127 189 L120 195 L113 189 Z" fill="rgba(255,255,255,0.65)" />
            </g>

            {/* data streams orbiting the head */}
            <path
              className="fox-stream"
              d="M28 116 C 48 74 96 46 130 62 C 162 77 188 104 212 140"
              stroke="url(#fbtai-edge)"
              strokeWidth="1.6"
              strokeOpacity="0.75"
              fill="none"
              strokeLinecap="round"
            />
            <path
              className="fox-stream fox-stream--2"
              d="M214 124 C 190 166 144 196 108 180 C 74 165 50 138 26 104"
              stroke="url(#fbtai-edge)"
              strokeWidth="1.6"
              strokeOpacity="0.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>

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
      </div>
    </article>
  );
}
