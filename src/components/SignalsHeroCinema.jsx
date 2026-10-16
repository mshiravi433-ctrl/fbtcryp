import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useStill } from './AnimatedIcon';
import { isNativeShell } from '../lib/nativeShell';

/**
 * SIGNALS HERO CINEMA — the film behind the first box of /signals, and the
 * words that fade through it.
 * ---------------------------------------------------------------------------
 * Request (verbatim): «در صفحه سیگنال، باکس ابتدایی که جمله «سیگنال هوشمند»
 * داره، ۳۰ ثانیه یکبار فیلم زیر پخش شود، با کلماتی که … مثل سیگنال زودهنگام،
 * شتاب حرکتی، … میاد و با انیمیشن محو می‌شود و ۳۰ ثانیه جمله «سیگنال هوشمند»
 * را نشان می‌دهد، با بک‌گراند خالی، خیلی مدرن و زیبا، بدون افت سرعت»
 * + a Pixabay galaxy/nebula loop:
 *   https://pixabay.com/videos/galaxy-nebula-space-cosmos-381972/
 *
 * ─── THE FILM IS A URL, NOT A BUNDLED FILE ─────────────────────────────────
 * The clip the request named lives on Pixabay's own CDN —
 *   https://cdn.pixabay.com/video/2026-10-10/381972_large.mp4
 * (MP4, 2160×3840 vertical, 30 fps, free under the Pixabay Content License,
 * author doktorkleinmusic) — and that URL is what plays by default: it is
 * HERO_FILM_SRC below, so the film is on without anyone configuring anything.
 * What is NOT done is downloading the file and committing it, for the reasons
 * already written into `GalaxyBackdrop.jsx` and `MarketStories.jsx`:
 *
 *   • SIZE. A compressed galaxy loop is 2–5 MB and a 4K vertical one is more.
 *     The whole APK is ~7.5 MB, and this is decoration on ONE box of ONE screen.
 *   • IT WOULD OFTEN SHOW NOTHING. On a slow or filtered connection the hero is
 *     still buffering while the user is already reading the signals, so the
 *     first thing on the page is a black rectangle.
 *   • IT IS NOT OURS TO REDISTRIBUTE. Pixabay's licence allows use without
 *     permission, but a copy shipped inside a store binary is a different
 *     question from pointing at the library's own URL. So no file is committed:
 *     `VITE_SIGNALS_HERO_VIDEO` swaps the URL for the operator's own copy
 *     (`/media/signals-hero.mp4`) and `=none` switches the film off, both
 *     documented in `.env.example` next to the page it was asked for.
 *
 * Shipping a third-party URL is only defensible because every way it can fail
 * lands on the same picture: no network, a blocked or expired CDN link, refused
 * autoplay, an unsupported codec, `saveData`/2G, the native APK and reduced
 * motion all leave the drawn nebula standing. It is painted first and it never
 * waits for anything.
 *
 * ─── WHAT IS DRAWN WHEN THE FILM CANNOT PLAY ───────────────────────────────
 * The scene the clip was chosen for is drawn instead: a turbulent nebula
 * (`feTurbulence`, rendered ONCE into a static layer — it is the difference
 * between a one-off rasterisation and a per-frame one) with two drifting star
 * planes and a vignette that keeps the text readable. A few kB, first frame,
 * nothing to fetch, no codec that can fail — «بک‌گراند خالی» in the sense that
 * was meant: empty of assets, not empty of design.
 *
 * ─── WHY THIS DOES NOT COST SPEED («بدون افت سرعت») ────────────────────────
 *   • Only `transform` and `opacity` animate. No `filter` animation, no
 *     `backdrop-filter` — the two properties PageTransition.jsx documents as
 *     the cause of every stutter this app ever had.
 *   • The star planes are TWO animated elements, not sixty; each star only
 *     fades. Positions come from a seeded PRNG, so a re-render can never
 *     reshuffle the sky.
 *   • The drawn scene costs nothing when the film is actually playing: it
 *     unmounts on the video's first frame instead of painting behind it.
 *   • A film is fetched lazily (`preload="none"` + an explicit `load()` only
 *     when the hero is on screen), muted and inline so autoplay is legal, and
 *     PAUSED whenever the box scrolls out of view or the tab is hidden. A
 *     background video nobody is watching is a decoder running for nothing.
 *   • A film is NOT fetched on a link that cannot afford it: `saveData`, or an
 *     `effectiveType` of 2g/slow-2g, keeps the drawn scene instead. A 4K
 *     vertical loop on a metered connection is a cost the reader never asked
 *     for and cannot see the bill of.
 *   • The film never runs inside the APK (`isNativeShell`): a 7.5 MB binary
 *     does not get a video, and the WebView pays for decoding it in heat.
 *   • `prefers-reduced-motion` AND the app's own «reduce motion» setting (the
 *     existing `useStill()` hook) stop the rotation, freeze the scene and skip
 *     the film entirely — the title simply stays on screen.
 */

/* The rotating line is the hero's own title plus eight signal words. Slot 0 is
   the title — «سیگنال هوشمند» — and the schedule below is built so the whole
   cycle is exactly HERO_CYCLE_MS, which is what «۳۰ ثانیه یکبار» asks for: the
   sentence returns every 30 seconds, with the words fading in between. */
export const HERO_WORD_KEYS = Object.freeze([
  'early',       // سیگنال زودهنگام
  'momentum',    // شتاب حرکتی
  'flow',        // جریان پول هوشمند
  'pulse',       // نبض بازار
  'volume',      // حجم غیرعادی
  'breakout',    // شکست سطح
  'convergence', // همگرایی اندیکاتورها
  'liquidity'    // چرخه نقدینگی
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

/* ─── THE FILM ITSELF ────────────────────────────────────────────────────────
   The Pixabay page the request named (galaxy-nebula-space-cosmos-381972) hands
   out this direct CDN URL from its own «Open video in new tab» menu: MP4,
   2160×3840 vertical, 30 fps, published 2026-10-12 by doktorkleinmusic, free
   under the Pixabay Content License. It plays by default — no configuration
   needed — and `VITE_SIGNALS_HERO_VIDEO` replaces or switches it off.
   Exported because `.env.example`, the docs and the test all have to agree with
   the same string; a URL typed twice is a URL that drifts. */
export const HERO_FILM_SRC = 'https://cdn.pixabay.com/video/2026-10-10/381972_large.mp4';

/* The licence does not require attribution. Hotlinking somebody's 4K render as
   the front page of a trading app is exactly the case where naming them costs
   nothing and is the decent default, so it ships with the default film — 7.5px
   in the corner, and only once a frame is really on screen. */
export const HERO_FILM_CREDIT = 'Pixabay · doktorkleinmusic';

/* «Draw the nebula, fetch nothing.» An empty variable can no longer mean that
   — empty now means «use the default above» — so the opt-out needs a word of
   its own. Compared case-insensitively. */
export const HERO_FILM_OFF = Object.freeze(['none', 'off', 'no', 'false', '0', '-']);

const isOff = (value) => HERO_FILM_OFF.includes(String(value ?? '').trim().toLowerCase());

/**
 * Which film this build plays. Read at RENDER time, not at module scope:
 * `import.meta.env` is inlined into the bundle as a constant object, and a
 * test (or an operator flipping the variable in `.env` and restarting Vite)
 * has to be able to change the answer without the module having cached it.
 *
 *   unset / empty  → the Pixabay default    → HERO_FILM_SRC
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
  return raw || (resolveHeroFilm(env) === HERO_FILM_SRC ? HERO_FILM_CREDIT : '');
}

/**
 * True when the connection cannot afford a 4K loop.
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

/* Derived, not chosen: the eight words share what is left of the 30 s after the
   sentence has had its slot, so the cycle length cannot drift away from the
   word count. Add a ninth word and each one simply holds a little less. */
export const HERO_WORD_HOLD_MS = (HERO_CYCLE_MS - HERO_TITLE_HOLD_MS) / HERO_WORD_KEYS.length; // 3000

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
 * the timer is cheap and the film is opt-in anyway.
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
 * THE SCENE — drawn nebula, or the configured film, never both at once.
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
  const cheap = useCheapLink();
  /* Resolved per render, not per module: the answer has to move when the
     environment does, and it is three lines of string work. */
  const film = resolveHeroFilm();
  const poster = String(import.meta.env?.VITE_SIGNALS_HERO_POSTER ?? '').trim() || undefined;
  const credit = resolveHeroCredit();
  /* Three separate reasons not to fetch, and all three land on the same drawn
     scene: the operator switched the film off (`none`), this is the APK, or the
     reader's own connection says it is saving data / on 2G. */
  const wantFilm = Boolean(film) && !native && !cheap;

  const [setHostNode, onScreen] = useOnScreen();
  const videoRef = useRef(null);
  const foreground = useForeground();
  /* 'idle' → nothing fetched yet · 'loading' → fetch started · 'live' → first
     frame painted (the drawn scene unmounts) · 'failed' → give up, stay drawn.
     A video that errors must not leave a black rectangle in the hero: the
     nebula behind it is the fallback and it is already painted. */
  const [filmState, setFilmState] = useState('idle');

  const far = useMemo(() => makeStars(24, 20261016), []);
  const near = useMemo(() => makeStars(14, 770113), []);
  const filmLive = filmState === 'live';

  /* Fetch nothing until the box is actually on screen and allowed to move. */
  useEffect(() => {
    if (!wantFilm || filmState !== 'idle' || !active || !onScreen || !foreground) return;
    const v = videoRef.current;
    if (!v) return;
    setFilmState('loading');
    try {
      if (typeof v.load === 'function') v.load();
      // Autoplay can still be refused (battery saver, a browser policy), and a
      // jsdom/SSR host implements no media element at all. Neither is an error
      // worth reporting: the drawn scene is right behind the film and already
      // looks finished.
      const p = typeof v.play === 'function' ? v.play() : null;
      if (p && typeof p.catch === 'function') p.catch(() => setFilmState('idle'));
    } catch {
      setFilmState('idle');
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
      className={`sigh-scene${active ? '' : ' is-still'}${filmLive ? ' is-film' : ''}`}
      data-testid="signals-hero-scene"
      data-film={wantFilm ? filmState : 'none'}
      aria-hidden="true"
    >
      {/*
        The drawn scene is unmounted — not merely hidden — once the film has a
        frame on screen. Two full-box layers painting behind an opaque video is
        work the GPU does for nobody.
      */}
      {!filmLive && (
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
              <filter id={`${gid}-clouds`} x="-18%" y="-18%" width="136%" height="136%">
                {/* Low baseFrequency: large soft structure. High frequency here
                    looks like television static, not gas. */}
                <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="11" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="30" xChannelSelector="R" yChannelSelector="G" />
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            {/* The filter runs once on a static group. Only the group's parent
                layer drifts, and it drifts with `transform`. */}
            <g filter={`url(#${gid}-clouds)`}>
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

          {/* Keeps the title legible over gas and stars alike. */}
          <div className="sigh-vignette" />
        </>
      )}

      {wantFilm && (
        <video
          ref={videoRef}
          className="sigh-film"
          src={film}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay={false}
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => setFilmState('live')}
          onLoadedData={() => {
            /* Some browsers never fire `playing` when autoplay is refused but
               the data is there; a decoded frame is enough to retire the drawn
               scene, and if it never plays the nebula simply stays. */
            setFilmState((s) => (s === 'loading' ? 'live' : s));
          }}
          onError={() => setFilmState('failed')}
          onStalled={() => setFilmState((s) => (s === 'loading' ? 'failed' : s))}
        />
      )}

      {/*
        Attribution for a film hotlinked from somebody else's library. The
        Pixabay licence does not require it; naming the author costs 7.5px in a
        corner at 34% opacity, and it only appears once a real frame is on
        screen. An operator's own URL gets no credit invented for it, and
        VITE_SIGNALS_HERO_VIDEO_CREDIT replaces this line — or removes it, with
        `none`. Deliberately a <span> and not a link: an outbound destination
        inside the hero would be a focus stop and a tap target nobody asked for.
      */}
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
  const [setHostNode, onScreen] = useOnScreen();
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
    if (still || slots.length < 2 || !onScreen || !foreground) return undefined;
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
  }, [still, slots.length, onScreen, foreground]);

  /* Re-entering the screen (or a language switch that changes the list) can
     leave `index` past the end. Clamping in render is cheaper than an effect. */
  const i = index % slots.length;
  const row = slots[i];

  return (
    <span ref={setHostNode} className={`sigh-words ${className}`.trim()}>
      <span
        className="sigh-words-slot"
        aria-live="polite"
        aria-atomic="true"
        aria-label={slotLabel || t('signals.hero.aria')}
      >
        {/*
          The default (overlapping) mode is what a cross-fade needs: `mode="wait"`
          would leave the slot empty for the whole fade, and `popLayout` would
          pull the exiting word out of flow — both read as a blink rather than a
          dissolve («با انیمیشن محو شود»).
        */}
        <AnimatePresence initial={false}>
          <motion.span
            key={row.key}
            className={`sigh-word${row.title ? ' is-title' : ''}`}
            data-testid="signals-hero-word"
            data-title={row.title ? 'true' : 'false'}
            initial={{ opacity: 0, y: still ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: still ? 0 : -4 }}
            transition={{ duration: still ? 0 : HERO_FADE_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
          >
            {row.text}
          </motion.span>
        </AnimatePresence>
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
