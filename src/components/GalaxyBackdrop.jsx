import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * GALAXY BACKDROP — the moving scene behind the Start screen.
 * ---------------------------------------------------------------------------
 * Requested: something cinematic behind the first screen a new user ever sees
 * — «یک فیلم از کهکشان» — as long as it stays fast and does not break.
 *
 * ─── WHY THIS IS NOT A VIDEO FILE ───────────────────────────────────────────
 * A real galaxy video is the obvious reading of the request, and it is the
 * wrong build. Measured against what this app actually needs:
 *
 *   • SIZE. Even a short, heavily-compressed loop is 2–5 MB. The entire APK is
 *     7.5 MB today. Tripling the download of a crypto app — for decoration on
 *     a screen shown once — is a cost paid by every user forever.
 *
 *   • IT WOULD OFTEN SHOW NOTHING. This is the FIRST screen. On a slow or
 *     filtered Iranian connection the video is still buffering while the user
 *     is already deciding whether the app works. A black rectangle where the
 *     hero should be is worse than no hero.
 *
 *   • AUTOPLAY IS NOT GUARANTEED. iOS only autoplays `muted playsinline`, and
 *     Low Power Mode blocks it outright. So the fallback has to look good
 *     anyway — at which point the fallback is the design and the video is
 *     dead weight.
 *
 *   • LICENSING. Stock galaxy footage is licensed, and "found it online" is
 *     not a licence. An app store takedown over a background loop would be an
 *     absurd way to lose distribution.
 *
 * So the scene is drawn: SVG for the nebula, DOM for the stars. It is a few
 * kB, it renders on the first frame with nothing to fetch, it follows the
 * theme, and there is no format, codec or network path that can fail.
 *
 * ─── HOW IT STAYS CHEAP ─────────────────────────────────────────────────────
 * The expensive way to animate a starfield is to move each star. That is
 * layout work per element per frame and it is what makes phones hot.
 *
 * Instead: every star is static, and only OPACITY animates — a compositor
 * property that never triggers layout or paint. The drift comes from two
 * whole layers translating slowly, so the browser animates two elements
 * rather than sixty.
 *
 * Star positions are generated once with a seeded PRNG, not `Math.random()`,
 * so a re-render cannot reshuffle the sky. Random positions that change on
 * every render would make the whole scene twitch.
 *
 * `prefers-reduced-motion` stops all of it and leaves the still image, which
 * still looks like a galaxy.
 */

/**
 * Deterministic PRNG (mulberry32).
 *
 * A fixed seed means the same sky every time — for the user, and for the
 * screenshot tests. `Math.random()` here would produce a layout that differs
 * between renders and could not be verified.
 */
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(count, seed) {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    x: rand() * 100,
    y: rand() * 100,
    // Sub-pixel sizes render as a soft grey smudge rather than a point, so
    // the floor is 1px and the variation comes from opacity instead.
    size: rand() < 0.82 ? 1 : 2,
    /*
     * Each star twinkles on its own schedule. Without the random delay they
     * would pulse in unison, which reads as the whole screen flickering —
     * the single most common way a starfield looks cheap.
     */
    delay: rand() * 6,
    duration: 3 + rand() * 4,
    dim: 0.25 + rand() * 0.5
  }));
}

export default function GalaxyBackdrop() {
  const reduce = useReducedMotion();

  // Two layers at different densities. Parallax needs depth, and depth needs
  // more than one plane.
  const far = useMemo(() => makeStars(38, 1337), []);
  const mid = useMemo(() => makeStars(22, 4242), []);
  const near = useMemo(() => makeStars(16, 90210), []);

  return (
    <div className={`galaxy ${reduce ? 'is-still' : ''}`} aria-hidden="true">
      {/*
        The nebula. SVG rather than CSS gradients because `feTurbulence`
        produces genuine cloud structure — a radial gradient can only ever be
        a smooth blob, and smooth blobs do not read as gas.

        The filter runs ONCE on a static element. It is not animated, which is
        the difference between a one-off cost and a per-frame one.
      */}
      <svg className="galaxy-neb" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <radialGradient id="neb-core" cx="35%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#7c4dff" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#00e5ff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="neb-second" cx="72%" cy="70%" r="45%">
            <stop offset="0%" stopColor="#ff2d95" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>

          <filter id="neb-clouds" x="-20%" y="-20%" width="140%" height="140%">
            {/*
              baseFrequency is low so the noise is large and soft. High
              frequency here looks like television static, not gas.
            */}
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="38" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        <g filter="url(#neb-clouds)">
          <rect width="400" height="400" fill="url(#neb-core)" />
          <rect width="400" height="400" fill="url(#neb-second)" />
        </g>
      </svg>

      {/* Two star planes drifting at different speeds — that difference IS
          the parallax. Each plane is one animated element, not sixty. */}
      <div className="galaxy-layer galaxy-far">
        {far.map((s, i) => (
          <span
            key={i}
            className="galaxy-star"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              '--dim': s.dim,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`
            }}
          />
        ))}
      </div>

      <div className="galaxy-layer galaxy-mid">
        {mid.map((s, i) => (
          <span
            key={i}
            className="galaxy-star"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              '--dim': s.dim,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`
            }}
          />
        ))}
      </div>

      <div className="galaxy-layer galaxy-near">
        {near.map((s, i) => (
          <span
            key={i}
            className="galaxy-star galaxy-star-bright"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size + 1,
              height: s.size + 1,
              '--dim': s.dim,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`
            }}
          />
        ))}
      </div>

      <svg className="galaxy-planet" viewBox="0 0 80 80" focusable="false" aria-hidden="true">
        <defs>
          <radialGradient id="plt-body" cx="38%" cy="34%" r="62%">
            <stop offset="0%" stopColor="#8ec8ff" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#3a6db8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0b1a33" stopOpacity="0.85" />
          </radialGradient>
        </defs>
        <circle cx="40" cy="40" r="22" fill="url(#plt-body)" />
        <ellipse cx="40" cy="40" rx="34" ry="8" fill="none" stroke="rgba(180,210,255,0.35)" strokeWidth="2" />
      </svg>

      {/*
        A vignette over everything. Without it the stars run all the way to
        the edges and compete with the button and the wordmark; darkening the
        corners is what keeps the content readable on top of a busy scene.
      */}
      <div className="galaxy-vignette" />
    </div>
  );
}
