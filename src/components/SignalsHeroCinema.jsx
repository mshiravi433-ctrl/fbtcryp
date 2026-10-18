import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStill } from './AnimatedIcon';
import { isNativeShell } from '../lib/nativeShell';

/**
 * The first Signals banner — a compact GLASS capsule: a lightweight,
 * same-origin H.264 nebula loop seen THROUGH a frosted glass veil, with a
 * CSS/SVG nebula fallback, a small scrolling signal-wave etched along the
 * bottom edge and a 30-second rotating phrase. No third-party hotlink is
 * needed to make the default experience work. The film is decorative and
 * never blocks the page; reduced motion, native shell and slow/data-saving
 * connections keep the still scene instead.
 *
 * The glass is painted (translucent gradients over the scene), never blurred:
 * a backdrop blur on this box is the one effect the performance law in
 * signals-hero-cinema.css forbids, and the film behind the veil already
 * supplies the softness a blur would fake.
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

/**
 * The signal wave etched along the bottom of the glass — one 200-unit pulse
 * segment (flat → blip → spike → flat) repeated across an 800-unit strip.
 * The strip is rendered at 200% width and slid by -50% in CSS (`transform`
 * only, per the performance law), so the segment must tile seamlessly:
 * every repeat starts and ends on the same baseline point. Built here, once,
 * instead of hand-writing four copies of the same path in JSX.
 */
const HERO_WAVE_PATH = (() => {
  const seg = (x) =>
    `L${x + 44} 24 L${x + 54} 15 L${x + 63} 30 L${x + 70} 24 ` +
    `L${x + 104} 24 L${x + 114} 7 L${x + 127} 35 L${x + 136} 24 L${x + 200} 24`;
  return `M0 24 ${[0, 200, 400, 600].map(seg).join(' ')}`;
})();

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
    // Calmer than the old sky: the glass capsule is a header, not a planetarium.
    duration: 4.8 + rand() * 5.2,
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
  /* Opt-out, native shell and data-saving connections use the drawn scene. */
  const wantFilm = Boolean(film) && !native && !cheap && !android;

  const [setHostNode, onScreen] = useOnScreen();
  const videoRef = useRef(null);
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

      {wantFilm && (
        <video
          ref={videoRef}
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

      {/* Aurora glows over the film: two painted colour washes that drift a
          few percent and back. They are what makes the loop read as light
          moving inside glass rather than as a video glued to a card. */}
      <div className="sigh-aurora" />

      <div className="sigh-vignette" />

      {/* THE GLASS — a frosted veil painted over scene + film: translucent
          white gradients and a hard top highlight. No backdrop blur (see the
          performance law in the CSS); the film behind it is already soft. */}
      <div className="sigh-glass" />

      {/* A small live signal wave etched on the glass along the bottom edge.
          30 px tall, one tiled path sliding on `transform` — the box's own
          ECG, sized to garnish the capsule rather than headline it. */}
      <div className="sigh-wave">
        <svg viewBox="0 0 800 40" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id={`${gid}-wave`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00e5ff" />
              <stop offset="52%" stopColor="#7c4dff" />
              <stop offset="100%" stopColor="#ff2d95" />
            </linearGradient>
          </defs>
          <path d={HERO_WAVE_PATH} fill="none" stroke={`url(#${gid}-wave)`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
          <path d={HERO_WAVE_PATH} fill="none" stroke={`url(#${gid}-wave)`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.16" transform="translate(0 5)" />
        </svg>
      </div>

      {/* One slow light sweep across the pane, then a long rest. */}
      <div className="sigh-shine" />

      {/* Optional credit for an operator-supplied video. */}
      {wantFilm && filmLive && credit && <span className="sigh-credit">{credit}</span>}
    </div>
  );
}

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
    if (still || slots.length < 2 || !rotationVisible || !foreground) return undefined;
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
  }, [still, slots.length, rotationVisible, foreground]);

  /* Re-entering the screen (or a language switch that changes the list) can
     leave `index` past the end. Clamping in render is cheaper than an effect. */
  const i = index % slots.length;
  const row = slots[i];

  return (
    <span ref={setHostNode} className={`sigh-words${still ? ' is-still' : ''} ${className}`.trim()}>
      <span
        className="sigh-words-slot"
        aria-live="polite"
        aria-atomic="true"
        aria-label={slotLabel || t('signals.hero.aria')}
      >
        {/* A plain, keyed glyph layer avoids Android's transparent text-clip
            compositing bug. CSS fades the next phrase without a blank frame. */}
        <span
          key={row.key}
          className={`sigh-word${row.title ? ' is-title' : ''}`}
          data-testid="signals-hero-word"
          data-title={row.title ? 'true' : 'false'}
        >
          {row.text}
        </span>
      </span>

      {/*
        Position ticks. A silent cross-fade gives the reader no hint that there
        is more than one phrase, so the box reads as a label instead of a cycle;
        these are the affordance, and they are hidden from assistive tech
        because the live region above already says the same thing in words.
      */}
      {!still && slots.length > 1 && (
        <span className="sigh-ticks" aria-hidden="true">
          {slots.map((s, n) => (
            <i key={s.key} data-on={n === i} />
          ))}
        </span>
      )}
    </span>
  );
}

export default SignalsHeroScene;
