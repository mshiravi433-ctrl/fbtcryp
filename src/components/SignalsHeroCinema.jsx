import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStill } from './AnimatedIcon';
import { isNativeShell } from '../lib/nativeShell';

/**
 * The first Signals banner: a lightweight, same-origin H.264 nebula loop with
 * a CSS/SVG fallback and a 30-second rotating phrase. No third-party hotlink
 * is needed to make the default experience work. The film is decorative and
 * never blocks the page; reduced motion, native shell and slow/data-saving
 * connections keep the still scene instead.
 *
 * THE BAND LAYOUT (the proportions live in signals-hero-cinema.css — a short,
 * wide cinematic band, two rows: an animated SVG medallion + title/tagline +
 * live status on the first row, and the rotating phrase as a full-width glass
 * ticker on the second): this file owns the three pieces the page mounts —
 * `SignalsHeroMark` (the animated SVG sigil: pulsing rings, an orbiting dot
 * and the signal trace itself), `SignalsHeroScene` (film + drawn cosmos,
 * shooting star and the one-pass sheen) and `SignalsHeroWords` (the ticker:
 * a per-phrase SVG glyph, a tap to advance, a press-and-hold to pause, and
 * segment ticks that can be tapped to jump).
 *
 * ANDROID GETS THE FILM TOO. The bundled loop is 640×240, six seconds and
 * ~37 KB of baseline H.264 — a decoder workload any Android Chrome/WebView of
 * the last decade shrugs off, and every failure mode (autoplay refused, codec
 * missing, network stall) still lands on the drawn nebula painted behind it.
 * What stays switched off is only what must: the packaged APK
 * (`isNativeShell()`), `saveData`/2G readers, reduced motion, and any moment
 * the box is off-screen or the tab is hidden. An earlier build denied Android
 * browsers the film outright, which left most readers with a frozen sky;
 * that guard was written for a 4K stock clip that no longer ships.
 */

/* The rotating line is the hero's own title plus four phrases. Slot 0 is the
   title — «سیگنال هوشمند» — held for HERO_TITLE_HOLD_MS; the four phrases below
   it share the rest of the 30 s cycle, 6 s each, so the sentence returns every
   30 seconds with each phrase fading in and out. */
export const HERO_WORD_KEYS = Object.freeze([
  'early',      // سیگنال زودهنگام
  'momentum',   // رادار شتاب
  'history',    // تاریخچه سیگنال‌ها
  'conclusion'  // نتیجه‌گیری با هوش مالی مدرن و زیبا
]);

/* Exported because the CSS side of this contract has to agree with it: the
   fade duration in signals-hero-cinema.css is the same number, and
   test/signals-hero-cinema.test.jsx reads both and compares them. A constant
   that only one half of the code can see is a constant that drifts. */
export const HERO_CYCLE_MS = 30_000;
export const HERO_TITLE_HOLD_MS = 6_000;
export const HERO_FADE_MS = 420;
/* The film's own cross-fade, mirrored by the `transition` in
   signals-hero-cinema.css and asserted equal by the test: a fade that lives in
   two files is a fade that drifts. */
export const HERO_FILM_CROSSFADE_MS = 900;

/* A small original loop, served from the same origin as the app. Operators can
   override or turn it off with VITE_SIGNALS_HERO_VIDEO. */
export const HERO_FILM_SRC = '/media/signals-hero.mp4';
export const HERO_FILM_CREDIT = '';


/* Explicit opt-out for the optional film. */
export const HERO_FILM_OFF = Object.freeze(['none', 'off', 'no', 'false', '0', '-']);

const isOff = (value) => HERO_FILM_OFF.includes(String(value ?? '').trim().toLowerCase());

/**
 * Which film this build plays. Read at RENDER time, not at module scope:
 * `import.meta.env` is inlined into the bundle as a constant object, and a
 * test (or an operator flipping the variable in `.env` and restarting Vite)
 * has to be able to change the answer without the module having cached it.
 *
 *   unset / empty  → the bundled loop    → HERO_FILM_SRC
 *   `none` / `off` → nothing at all         → ''  (drawn nebula, zero requests)
 *   anything else  → the operator's own URL → as given
 */
export function resolveHeroFilm(env = import.meta.env) {
  const raw = String(env?.VITE_SIGNALS_HERO_VIDEO ?? '').trim();
  if (isOff(raw)) return '';
  return raw || HERO_FILM_SRC;
}

/** The credit line that belongs to whichever film `resolveHeroFilm` chose. */
export function resolveHeroCredit(env = import.meta.env) {
  const raw = String(env?.VITE_SIGNALS_HERO_VIDEO_CREDIT ?? '').trim();
  if (isOff(raw)) return '';
  /* An operator hosting their own file gets no credit invented for it — the
     name on somebody else's footage must not end up on theirs. */
  return raw;
}

/**
 * True when the connection asks us not to stream video.
 *
 * `navigator.connection` is Chrome/Android-only and absent in jsdom, so this
 * reads as `false` almost everywhere — including in the tests, which is why the
 * slow-link test installs the object itself. Where it does exist it is the
 * reader's own answer to «should this page spend my data?»: `saveData` is a
 * deliberate switch, and 2G is a link on which the film would still be
 * buffering long after the signals below it were read.
 */
function useCheapLink() {
  return useMemo(() => {
    const c = typeof navigator === 'undefined' ? undefined : navigator.connection;
    if (!c) return false;
    return c.saveData === true || /^(slow-)?2g$/.test(String(c.effectiveType ?? ''));
  }, []);
}

/** Android WebViews can miss the initial IntersectionObserver report for a
 * nested flex text slot. Detect the platform once: the phrase timer is cheap,
 * so Android gets a small reliability fallback without changing iPhone timing. */
function isAndroidClient() {
  return typeof navigator !== 'undefined' && /Android/i.test(String(navigator.userAgent ?? ''));
}

/* Derived, not chosen: the four phrases share what is left of the 30 s after the
   sentence has had its slot, so the cycle length cannot drift away from the
   phrase count. Add a fifth phrase and each one simply holds a little less. */
export const HERO_WORD_HOLD_MS = (HERO_CYCLE_MS - HERO_TITLE_HOLD_MS) / HERO_WORD_KEYS.length; // 6000

/* How long after the page settles before the first rotation. The hero enters
   with the route's own rise-in animation and the first market poll lands in
   the same second; starting a fade on top of both is motion for its own sake. */
const START_DELAY_MS = 1_600;

/**
 * On screen, and the tab is foregrounded.
 *
 * One IntersectionObserver, created only when the browser has one. Everything
 * that costs power on this box — the film decoder and the rotation timer —
 * keys off this, so a hero scrolled past or a backgrounded tab costs nothing.
 * Falls back to "visible" where the API is missing, which is the safe default:
 * the timer is cheap and the video source is only attached when visible.
 *
 * Returns a CALLBACK ref, not a `useRef`: an effect keyed on a ref object never
 * re-runs when the node attaches, so the observer would silently never be
 * created and the "pause when scrolled away" saving would not exist.
 */
function useOnScreen() {
  const [node, setNode] = useState(null);
  /*
   * Starts invisible where an observer exists, and visible where none does.
   * Optimistically starting at `true` is not a harmless default: it lets the
   * film effect fire a network request and spin up a decoder on the very first
   * commit, one frame before the observer has reported anything — exactly the
   * fetch-on-mount this guard exists to prevent. Where the API is missing there
   * is no report to wait for, so the honest answer is "assume visible": the
   * rotation timer is cheap and the film is opt-in anyway.
   */
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.05 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node]);

  return [setNode, visible];
}

/** True while the document is in the foreground. */
function useForeground() {
  const [fg, setFg] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const on = () => setFg(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return fg;
}

/** Deterministic PRNG (mulberry32) — same sky on every render and in tests. */
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
    // Sub-pixel boxes render as a grey smudge rather than a point: the floor is
    // 1px and the variety comes from opacity instead.
    size: rand() < 0.84 ? 1 : 2,
    /* Independent schedules. Without the random delay every star pulses
       together and the whole box reads as flickering. */
    delay: rand() * 6,
    duration: 3.4 + rand() * 4.2,
    dim: 0.2 + rand() * 0.5
  }));
}

/**
 * THE SCENE — drawn nebula under a same-origin film, when motion is allowed.
 *
 * `active` is false when motion is not allowed; the scene then renders as a
 * still picture (the nebula without its drift), which still looks like deep
 * space and costs one paint.
 */
export function SignalsHeroScene({ active = true }) {
  const rawId = useId();
  /* useId() contains ':' in React 18, which is not legal inside
     `url(#…)` / `filter="url(#…)"`. Strip it. */
  const gid = `shc${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const native = useMemo(() => isNativeShell(), []);
  const android = useMemo(() => isAndroidClient(), []);
  const cheap = useCheapLink();
  /* Resolved per render, not per module: the answer has to move when the
     environment does, and it is three lines of string work. */
  const film = resolveHeroFilm();
  const poster = String(import.meta.env?.VITE_SIGNALS_HERO_POSTER ?? '').trim() || undefined;
  const credit = resolveHeroCredit();
  /* Opt-out, native shell and data-saving connections use the drawn scene.
     Android BROWSERS play the film (see the file header): the guard that
     remains for them is the cheap-link one above, which is the reader's own
     answer about spending data. */
  const wantFilm = Boolean(film) && !native && !cheap;

  const [setHostNode, onScreen] = useOnScreen();
  const videoRef = useRef(null);
  /* React's `muted` prop alone does not reliably set the muted PROPERTY (it
     writes the attribute, and a browser that has already decided the element
     is unmuted keeps refusing autoplay — the classic "works on Android,
     frozen on iPhone" report). Setting both on the node the moment it
     attaches is what makes the muted+playsInline autoplay contract real on
     iOS Safari and in-app WebViews alike. */
  const setVideoNode = useCallback((node) => {
    videoRef.current = node;
    if (node) {
      node.muted = true;
      node.defaultMuted = true;
    }
  }, []);
  const foreground = useForeground();
  /* 'idle' → no source attached · 'loading' → fetch started · 'live' → playing
     over the drawn scene · 'failed' → give up, stay drawn.
     A video that errors must not leave a black rectangle in the hero: the
     nebula behind it is the fallback and it is already painted. */
  const [filmState, setFilmState] = useState('idle');

  /* Android gets a lighter static sky: the title/phrase cycle remains live,
     while the SVG turbulence, extra stars and moving planes are removed. */
  const far = useMemo(() => makeStars(android ? 12 : 24, 20261016), [android]);
  const near = useMemo(() => makeStars(android ? 6 : 14, 770113), [android]);
  const filmLive = filmState === 'live';

  /* Attach the src only after visibility has been confirmed. `preload=none`
     alone does not guarantee that a browser will make zero requests. */
  useEffect(() => {
    if (wantFilm && filmState === 'idle' && active && onScreen && foreground) {
      setFilmState('loading');
    }
  }, [wantFilm, filmState, active, onScreen, foreground]);

  useEffect(() => {
    if (!wantFilm || filmState !== 'loading' || !active || !onScreen || !foreground) return;
    const v = videoRef.current;
    if (!v) return;
    try {
      if (typeof v.load === 'function') v.load();
      // Autoplay can still be refused (battery saver, a browser policy), and a
      // jsdom/SSR host implements no media element at all. Neither is an error
      // worth reporting: the drawn scene is right behind the film and already
      // looks finished.
      const p = typeof v.play === 'function' ? v.play() : null;
      if (p && typeof p.catch === 'function') p.catch(() => setFilmState('failed'));
    } catch {
      setFilmState('failed');
    }
  }, [wantFilm, filmState, active, onScreen, foreground]);

  /* Pause the decoder whenever nobody can see it. */
  useEffect(() => {
    if (!wantFilm || !filmLive) return;
    const v = videoRef.current;
    if (!v) return;
    if (onScreen && foreground && active) {
      const p = typeof v.play === 'function' ? v.play() : null;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (!v.paused && typeof v.pause === 'function') {
      v.pause();
    }
  }, [wantFilm, filmLive, onScreen, foreground, active]);

  return (
    <div
      ref={setHostNode}
      className={`sigh-scene${active ? '' : ' is-still'}${filmLive ? ' is-film' : ''}${android ? ' is-android' : ''}`}
      data-testid="signals-hero-scene"
      data-platform={android ? 'android' : undefined}
      data-film={wantFilm ? filmState : 'none'}
      aria-hidden="true"
    >
      {/* Keep the drawn scene behind the video, including during its fade and
          when playback is paused or a browser cannot decode the film. */}
      <>
          <svg
            className="sigh-neb"
            viewBox="0 0 400 160"
            preserveAspectRatio="xMidYMid slice"
            focusable="false"
          >
            <defs>
              <radialGradient id={`${gid}-core`} cx="30%" cy="38%" r="62%">
                <stop offset="0%" stopColor="#7c4dff" stopOpacity="0.5" />
                <stop offset="52%" stopColor="#00e5ff" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#000814" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`${gid}-rose`} cx="76%" cy="72%" r="48%">
                <stop offset="0%" stopColor="#ff2d95" stopOpacity="0.26" />
                <stop offset="100%" stopColor="#000814" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`${gid}-ice`} cx="58%" cy="12%" r="40%">
                <stop offset="0%" stopColor="#9fd8ff" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#000814" stopOpacity="0" />
              </radialGradient>
              {!android && (
                <filter id={`${gid}-clouds`} x="-18%" y="-18%" width="136%" height="136%">
                  {/* Low baseFrequency: large soft structure. High frequency here
                      looks like television static, not gas. Older Android WebViews
                      skip this one-time turbulence pass for a much cheaper sky. */}
                  <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="11" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="30" xChannelSelector="R" yChannelSelector="G" />
                  <feGaussianBlur stdDeviation="6" />
                </filter>
              )}
            </defs>
            {/* The filter runs once on a static group outside Android. On Android
                the radial gradients alone provide the cloud, avoiding a costly
                SVG turbulence pass that some WebViews composite as a blank wash. */}
            <g filter={android ? undefined : `url(#${gid}-clouds)`}>
              <rect width="400" height="160" fill={`url(#${gid}-core)`} />
              <rect width="400" height="160" fill={`url(#${gid}-rose)`} />
              <rect width="400" height="160" fill={`url(#${gid}-ice)`} />
            </g>
            {/* The constellation IS a signal trace: one faint polyline and its
                nodes, drawn once with the nebula (zero per-frame cost), so the
                still sky — APK, data-saver, reduced motion — still says what
                this page measures instead of reading as generic space art. */}
            <g opacity="0.5">
              <polyline
                points="18,118 92,96 150,108 214,64 268,82 330,44 384,58"
                fill="none"
                stroke="#7dd7ff"
                strokeOpacity="0.34"
                strokeWidth="1.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {[[18, 118], [92, 96], [150, 108], [214, 64], [268, 82], [330, 44], [384, 58]].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" fill="#bfeaff" fillOpacity="0.65" />
              ))}
            </g>
          </svg>

          <div className="sigh-plane sigh-plane-far">
            {far.map((s, i) => (
              <span
                key={i}
                className="sigh-star"
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
          <div className="sigh-plane sigh-plane-near">
            {near.map((s, i) => (
              <span
                key={i}
                className="sigh-star sigh-star-bright"
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

      </>

      {/* One shooting star on a long, lazy schedule and one sheen pass as the
          band mounts: the two moments of "cinema" that cost a single
          transform each and then get out of the way. Both freeze with the
          rest of the scene (still / native / Android-static / film-live). */}
      <div className="sigh-meteor" />
      <div className="sigh-sheen" />

      {wantFilm && (
        <video
          ref={setVideoNode}
          className="sigh-film"
          src={filmState === 'loading' || filmLive ? film : undefined}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => setFilmState('live')}
          onError={() => setFilmState('failed')}
          onStalled={() => setFilmState((s) => (s === 'loading' ? 'failed' : s))}
        />
      )}

      <div className="sigh-vignette" />

      {/* Optional credit for an operator-supplied video. */}
      {wantFilm && filmLive && credit && <span className="sigh-credit">{credit}</span>}
    </div>
  );
}

/**
 * THE MARK — the animated SVG sigil in the band's medallion.
 *
 * Three motions, each a single `transform`/`opacity` loop on its own layer
 * (the stylesheet's performance law applies to this file's CSS, and the test
 * enforces it): two rings breathe outward around the core, one dot orbits
 * the dashed rail, and the signal trace through the middle simply holds —
 * it is the one element that stays put, which is what makes the rest read
 * as motion *around a measurement*. `useStill()` freezes all of it into a
 * complete static sigil; the native shell and reduced-motion CSS do the
 * same without this component's help.
 *
 * The paths carry no text and the svg is `aria-hidden`: the medallion is a
 * brand mark next to an h1 that already says «سیگنال هوشمند», never the
 * only carrier of the page's name.
 */
export function SignalsHeroMark() {
  const still = useStill();
  const rawId = useId();
  const gid = `shm${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      className={`sigh-mark${still ? ' is-still' : ''}`}
      viewBox="0 0 48 48"
      fill="none"
      focusable="false"
      aria-hidden="true"
      data-testid="signals-hero-mark"
    >
      <defs>
        <linearGradient id={`${gid}-sig`} x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00e5ff" />
          <stop offset="55%" stopColor="#7c4dff" />
          <stop offset="100%" stopColor="#ff2d95" />
        </linearGradient>
      </defs>
      {/* the rail the orbit rides on */}
      <circle cx="24" cy="24" r="19" stroke={`url(#${gid}-sig)`} strokeOpacity="0.4" strokeWidth="1.3" strokeDasharray="3 5" strokeLinecap="round" />
      {/* breathing rings — transform-box keeps the scale centred on the core */}
      <circle className="sigh-mark-ring" cx="24" cy="24" r="12.5" stroke="#00e5ff" strokeOpacity="0.55" strokeWidth="1.2" />
      <circle className="sigh-mark-ring sigh-mark-ring-late" cx="24" cy="24" r="12.5" stroke="#b47cff" strokeOpacity="0.45" strokeWidth="1.2" />
      {/* the orbiting satellite dot */}
      <g className="sigh-mark-orbit">
        <circle cx="24" cy="5" r="2.6" fill="#00e5ff" />
        <circle cx="24" cy="5" r="1.1" fill="#eafcff" />
      </g>
      {/* the signal trace itself */}
      <path
        d="M9 26h6.2l2.8-7.4 4.6 13.2 3-6.6 1.5 2.8H39"
        stroke={`url(#${gid}-sig)`}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="sigh-mark-core" cx="22.6" cy="31.8" r="2.1" fill="#fff" />
    </svg>
  );
}

/* One glyph per phrase — the ticker's words name real sections of this page
   (early signals, the momentum radar, the ledger, the AI's conclusion), so
   each carries the icon of the thing it names rather than one repeated
   sparkle. Pure stroke SVG, currentColor, no text node anywhere: the
   word element's textContent stays exactly the phrase, in every locale. */
const wordGlyph = (paths) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
    {paths}
  </svg>
);
export const HERO_WORD_GLYPHS = Object.freeze({
  /* the title slot — a broadcast source: one measured point, signal leaving it */
  title: wordGlyph(<><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" /><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>),
  /* early signal — the bolt: it arrived before the crowd did */
  early: wordGlyph(<path d="M13 2.5 4.5 13.5H11l-1 8L18.5 10H12l1-7.5Z" />),
  /* momentum radar — the trace breaking upward, with its direction read */
  momentum: wordGlyph(<><path d="M3 17.5 8.5 12l3.5 3.5L19 8.5" /><path d="M14.5 8.5H19V13" /></>),
  /* signal history — the ledger's clock, wound back */
  history: wordGlyph(<><path d="M3.5 12a8.5 8.5 0 1 1 2.5 6" /><path d="M3.5 12H7M3.5 12l2.8-2.8" /><path d="M12 8v4.4l3 1.8" /></>),
  /* the conclusion — a verdict reached: ring closed, tick inside */
  conclusion: wordGlyph(<><circle cx="12" cy="12" r="8.5" /><path d="m8.6 12.4 2.4 2.4 4.4-5" /></>)
});

/**
 * THE ROTATING LINE.
 *
 * One chained timer, not one interval per word: slot 0 (the title) holds longer
 * than the words, so a fixed interval could not produce the 30 s cycle anyway.
 * Each step schedules exactly the next one and clears itself on unmount, on
 * scroll-away, on tab-hide and under reduced motion — where the title simply
 * stays and nothing rotates at all.
 *
 * The slot has a fixed height and the words are stacked absolutely inside it, so
 * a long Persian phrase can never push the hero's layout (the icon and the
 * status column beside it) around. That is the failure mode the early-signals
 * card CSS was rebuilt to fix, and it is not repeated here.
 */
export function SignalsHeroWords({ className = '', slotLabel }) {
  const { t } = useTranslation();
  const still = useStill();
  const android = useMemo(() => isAndroidClient(), []);
  const [setHostNode, onScreen] = useOnScreen();
  /* Android WebViews occasionally fail to report this tiny flex slot as
     intersecting. Keeping one 6-second timeout alive is cheaper and safer than
     losing the headline rotation; iOS and desktop retain visibility pausing. */
  const rotationVisible = onScreen || android;
  const foreground = useForeground();
  const [index, setIndex] = useState(0);
  /* The ticker is touchable, because a line that names the sections below
     should let the reader drive it: a tap moves to the next phrase (a tap
     on a tick jumps to that one), and pressing & holding pauses the cycle
     while a long Persian phrase is being read. `held` simply joins the
     existing pause conditions; `epoch` restarts the chained timer after a
     manual jump so the phrase the reader just asked for earns a full hold
     instead of being dismissed by a step scheduled for its predecessor.
     Under reduced motion there is no timer to restart — the tap still
     browses, instantly and without animation, which is exactly the
     user-initiated motion that setting exists to allow. */
  const [held, setHeld] = useState(false);
  const [epoch, setEpoch] = useState(0);

  /* Slots: 0 = the title, then one per word, in order. */
  const slots = useMemo(() => {
    const rows = [{ key: 'title', text: t('signals.title'), title: true }];
    for (const k of HERO_WORD_KEYS) {
      const path = `signals.hero.words.${k}`;
      const text = t(path);
      /* A locale that has not translated a word falls back to English through
         i18next, and if even that is missing the key itself comes back. Never
         print a key: drop the slot and let the cycle be a little shorter. */
      if (text && text !== path) rows.push({ key: k, text });
    }
    return rows;
  }, [t]);

  /* Where the cycle is, for the effect to RESUME from. Every rotation sets
     `index`, but the effect must not depend on it: an effect that re-ran on
     every rotation would tear down and rebuild its own chain once per word. */
  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    if (still || slots.length < 2 || !rotationVisible || !foreground || held) return undefined;
    let timer = null;
    let cancelled = false;

    /*
     * ONE chained timeout, each step scheduling exactly the next. A single
     * `setInterval` cannot express this cycle — the sentence holds 6 s and a
     * word holds 3 s — and one interval per word would leave timers running
     * behind a box the user has already scrolled past.
     *
     * Three details here are each worth a bug report of their own:
     *
     *   • The step CARRIES its own index instead of reading it back from state
     *     or from a ref. `setIndex(n)` inside a timeout does not re-render
     *     synchronously, so the very next line — the one scheduling the next
     *     step — would still read the OLD index and schedule the same slot
     *     again: two timers, one skipped word, and a cycle that no longer adds
     *     up to 30 s. Passing `from` down the chain makes that impossible.
     *   • The delay is the hold of the slot ON SCREEN — how long the phrase the
     *     reader is looking at has already earned. Slot 0 is the sentence, so it
     *     holds 6 s; every other slot is a word and holds 3 s. Taking the hold
     *     of the slot being entered instead reads almost the same and is wrong
     *     where it matters: the sentence would be dismissed after 3 s and the
     *     last word would linger for 6 s, so «۳۰ ثانیه یکبار جمله سیگنال
     *     هوشمند» would become a 30 s cycle that shows the sentence for half
     *     the time it promises.
     *   • On resume the chain starts from wherever the cycle already is. This
     *     effect re-runs when the box scrolls back into view or the tab
     *     returns to the foreground; starting at slot 0 there would throw the
     *     reader back onto the sentence in the middle of a word.
     */
    const step = (from, isFirst) => {
      const next = (from + 1) % slots.length;
      const delay = from === 0 ? HERO_TITLE_HOLD_MS : HERO_WORD_HOLD_MS;
      timer = setTimeout(() => {
        if (cancelled) return;
        setIndex(next);
        step(next, false);
      }, isFirst ? START_DELAY_MS + delay : delay);
    };
    step(indexRef.current, true);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    /* `epoch` is in this list for one reason: a manual jump. It changes
       nowhere else, so the chain is still never rebuilt by a rotation —
       only by the reader's own tap. */
  }, [still, slots.length, rotationVisible, foreground, held, epoch]);

  /* Re-entering the screen (or a language switch that changes the list) can
     leave `index` past the end. Clamping in render is cheaper than an effect. */
  const i = index % slots.length;
  const row = slots[i];

  const jumpTo = (n) => {
    if (slots.length < 2) return;
    setIndex(((n % slots.length) + slots.length) % slots.length);
    setEpoch((e) => e + 1);
  };
  const onTap = (event) => {
    const tick = event.target?.closest?.('[data-tick]');
    jumpTo(tick ? Number(tick.dataset.tick) : i + 1);
  };

  return (
    <span
      ref={setHostNode}
      className={`sigh-words${still ? ' is-still' : ''} ${className}`.trim()}
      onClick={onTap}
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
    >
      <span
        className="sigh-words-slot"
        aria-live="polite"
        aria-atomic="true"
        aria-label={slotLabel || t('signals.hero.aria')}
      >
        {/* A plain, keyed glyph layer avoids Android's transparent text-clip
            compositing bug. CSS fades the next phrase without a blank frame.
            The glyph chip and the text ride in one flex line: the svg has no
            text node, so what a screen reader (and the test) reads off this
            element is still exactly the phrase. */}
        <span
          key={row.key}
          className={`sigh-word${row.title ? ' is-title' : ''}`}
          data-testid="signals-hero-word"
          data-title={row.title ? 'true' : 'false'}
          data-glyph={row.key}
        >
          <span className="sigh-word-ic" aria-hidden="true">{HERO_WORD_GLYPHS[row.key] || HERO_WORD_GLYPHS.title}</span>
          <span className="sigh-word-tx">{row.text}</span>
        </span>
      </span>

      {/*
        Position ticks. A silent cross-fade gives the reader no hint that there
        is more than one phrase, so the box reads as a label instead of a cycle;
        these are the affordance, and they are hidden from assistive tech
        because the live region above already says the same thing in words.
        Each one is also a jump target (`data-tick`) — the affordance and the
        control are the same pixels.
      */}
      {!still && slots.length > 1 && (
        <span className="sigh-ticks" aria-hidden="true">
          {slots.map((s, n) => (
            <i key={s.key} data-on={n === i} data-tick={n} />
          ))}
        </span>
      )}
    </span>
  );
}

export default SignalsHeroScene;
