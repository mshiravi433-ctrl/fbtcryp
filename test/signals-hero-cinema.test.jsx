// @vitest-environment jsdom
/**
 * SIGNALS HERO CINEMA — the first box of /signals.
 * ---------------------------------------------------------------------------
 * Request (verbatim): «در صفحه سیگنال، باکس ابتدایی که جمله «سیگنال هوشمند»
 * داره، ۳۰ ثانیه یکبار فیلم زیر پخش شود، با کلماتی که … مثل سیگنال زودهنگام،
 * شتاب حرکتی، … میاد و با انیمیشن محو می‌شود و ۳۰ ثانیه جمله «سیگنال هوشمند»
 * را نشان می‌دهد، با بک‌گراند خالی، خیلی مدرن و زیبا، بدون افت سرعت» +
 * https://pixabay.com/videos/galaxy-nebula-space-cosmos-381972/
 *
 * A decorative box is the easiest thing in an app to get subtly wrong and the
 * hardest to notice. A cycle that is 34 s instead of 30, a timer left running
 * behind a screen the user scrolled past, a film that paints a black rectangle
 * while it buffers, or one animated `filter` that costs frames on the exact
 * phone this app ships to — none of that shows up in a screenshot. So all of it
 * is asserted here instead:
 *
 *   · THE SCHEDULE — the sentence returns every 30 000 ms exactly, each of the
 *     eight words holds 3 000 ms, every slot is shown once per lap, and the
 *     order matches the locale file;
 *   · THE GUARDS — reduced motion freezes it, scrolling away stops it, a hidden
 *     tab stops it, unmounting clears it;
 *   · THE FILM — the Pixabay clip the request named is the DEFAULT source: its
 *     exact CDN URL is asserted against the constant in the component (a typo in
 *     a hotlinked URL cannot silently ship), `none` opts out, an operator's URL
 *     replaces it, and nothing at all is fetched until the box is on screen. The
 *     video is muted/inline/loop/preload=none — the only combination mobile
 *     browsers autoplay — a decoded frame retires the drawn scene, and a
 *     failure, the native APK or a saveData/2G link all leave the nebula
 *     standing instead of a black rectangle;
 *   · THE COPY — fa/en/ar carry every word, and the nine partial locales stay
 *     honest about falling back to English rather than half-translating a
 *     decoration;
 *   · THE CSS — every keyframe animates only `transform`/`opacity`, the fade
 *     agrees with the JS constant, the word slot has a fixed height (so a long
 *     Persian phrase cannot push the hero's layout), and every rule is scoped to
 *     this one box;
 *   · THE WIRING — the hero still owns its `h1`, the scene and the cycle are
 *     really mounted in the page, and the three env vars are documented with the
 *     default URL, the opt-out word and every case where nothing is fetched.
 *
 * Only framework plumbing is stubbed (framer-motion, IntersectionObserver,
 * matchMedia, the media-element methods jsdom does not implement). The
 * component, the settings store, the locale JSON, the CSS file and the page
 * source are all real.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';
import ar from '../src/i18n/locales/ar.json';
import es from '../src/i18n/locales/es.json';

/* ── framer-motion: render the element, drop the animation props ─────────── */
vi.mock('framer-motion', async () => {
  const R = await import('react');
  const IGNORE = ['initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'layout', 'layoutId'];
  return {
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => false,
    motion: new Proxy({}, {
      get: (_, tag) => ({ children, ...props }) => {
        const clean = Object.fromEntries(Object.entries(props).filter(([k]) => !IGNORE.includes(k)));
        return R.createElement(String(tag), clean, children);
      }
    })
  };
});

/* ── the still/motion guard, controllable per test ─────────────────────────
   The real `useStill()` is `prefers-reduced-motion || settings.reduceMotion`.
   jsdom has no matchMedia at all, so the system half cannot be exercised here;
   the hook is mocked so both halves of the contract (frozen / running) are. */
const motionAllowed = { still: false };
vi.mock('../src/components/AnimatedIcon', () => ({ useStill: () => motionAllowed.still }));

import {
  HERO_CYCLE_MS,
  HERO_FADE_MS,
  HERO_FILM_CREDIT,
  HERO_FILM_CROSSFADE_MS,
  HERO_FILM_OFF,
  HERO_FILM_SRC,
  HERO_TITLE_HOLD_MS,
  HERO_WORD_HOLD_MS,
  HERO_WORD_KEYS,
  SignalsHeroScene,
  SignalsHeroWords,
  resolveHeroCredit,
  resolveHeroFilm
} from '../src/components/SignalsHeroCinema.jsx';

/* Vitest runs with the repo root as cwd, and `import.meta.url` is NOT a file:
   URL inside a jsdom-transformed module ("The URL must be of scheme file"), so
   source paths are built from cwd the way the wiring probes build them. */
const ROOT = process.cwd();
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const css = () => read('src/styles/signals-hero-cinema.css');
/** Comments off before any source scan: this stylesheet documents the forbidden
    properties in prose, and prose is not a declaration. */
const cssCode = () => css().replace(/\/\*[\s\S]*?\*\//g, '');
const page = () => read('src/pages/Signals.jsx');

/* ── one i18next instance per language, built synchronously ────────────────
   Driving a single shared instance with `changeLanguage()` under fake timers is
   a promise race a test should not have to win, and a leaked `en` is what makes
   six unrelated Persian assertions fail. These bundles are static imports, so
   `init` has nothing to load and `useTranslation` reads the instance straight
   off the provider. */
const makeI18n = (lng, extra = {}) => {
  const inst = i18next.createInstance();
  inst.use(initReactI18next).init({
    resources: { en: { translation: en }, fa: { translation: fa }, ar: { translation: ar }, ...extra },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  });
  return inst;
};

function renderWords(props, lng = 'fa') {
  return render(
    <I18nextProvider i18n={makeI18n(lng)}>
      <SignalsHeroWords {...props} />
    </I18nextProvider>
  );
}
function renderScene(props, lng = 'fa') {
  return render(
    <I18nextProvider i18n={makeI18n(lng)}>
      <SignalsHeroScene {...props} />
    </I18nextProvider>
  );
}

/* ── IntersectionObserver the test drives by hand ────────────────────────── */
const io = {
  instances: [],
  /* What the observer reports the moment it is attached. The hero is the first
     box on the page, so a real IntersectionObserver reports it INTERSECTING —
     a stub that reported the opposite would silently freeze every rotation
     test on the first phrase and prove nothing. Tests that need "scrolled
     away" or "not yet on screen" say so explicitly. */
  wasVisible: true,
  emit(isIntersecting) {
    for (const inst of io.instances) inst.cb([{ isIntersecting }]);
  }
};
class FakeIO {
  constructor(cb) { this.cb = cb; io.instances.push(this); }
  /* Asynchronously, like the real one: a report delivered inside observe()
     lands while the effect is still mounting, and React then re-runs that
     effect — which restarts a chained timer from scratch. */
  observe() { setTimeout(() => this.cb([{ isIntersecting: io.wasVisible }]), 0); }
  unobserve() {}
  disconnect() {}
}

/** The phrase currently shown in the slot. */
const shown = () => screen.getByTestId('signals-hero-word').textContent;
const isTitle = () => screen.getByTestId('signals-hero-word').dataset.title;
/**
 * Let the observer's first report land.
 *
 * One millisecond, not zero: `advanceTimersByTime(0)` runs timers due NOW, and
 * a `setTimeout(…, 0)` queued during mount is not due until the clock moves —
 * so a zero advance flushes nothing and every assertion after it silently tests
 * the pre-observation state. A real observer delivers its first report on the
 * next frame, which is what this stands in for.
 */
const settle = () => act(() => { vi.advanceTimersByTime(1); });
/** The first rotation: the observer's report, the page-settle delay, and the
    sentence's own hold. */
const SETTLE_MS = 1_600;
const firstRotation = () => {
  settle();
  act(() => { vi.advanceTimersByTime(SETTLE_MS + HERO_TITLE_HOLD_MS); });
};
const oneWord = () => act(() => { vi.advanceTimersByTime(HERO_WORD_HOLD_MS); });

/* `document.visibilityState` is a getter on the Document PROTOTYPE, so an own
   data property shadows it — and a shadow left behind makes every later test in
   the file think the tab is hidden. Capture the original own-descriptor state at
   module load (before any test touches it) and restore by deleting the shadow,
   which puts the prototype getter back in charge. */
const VISIBILITY_OWN = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const setVisibility = (value) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
const restoreVisibility = () => {
  delete document.visibilityState;
  if (VISIBILITY_OWN) Object.defineProperty(document, 'visibilityState', VISIBILITY_OWN);
};

/* `navigator.connection` does not exist in jsdom (or in Safari/Firefox), so the
   slow-link guard has to be exercised with the object installed by hand — and
   removed again, or every later test in the file inherits a 2G radio. */
const CONNECTION_OWN = Object.getOwnPropertyDescriptor(Navigator.prototype, 'connection');
const setConnection = (value) =>
  Object.defineProperty(navigator, 'connection', { configurable: true, get: () => value });
const restoreConnection = () => {
  delete navigator.connection;
  if (CONNECTION_OWN) Object.defineProperty(Navigator.prototype, 'connection', CONNECTION_OWN);
};

beforeEach(() => {
  motionAllowed.still = false;
  io.instances = [];
  io.wasVisible = true;
  global.IntersectionObserver = FakeIO;
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.useFakeTimers();
  /* jsdom implements play()/load() as "not implemented" no-ops, and its
     `paused` is a getter-only property the component reads to decide whether a
     paused decoder is worth resuming — so it has to be redefined before a mock
     can move it. */
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    writable: true,
    value: true
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function () { this.paused = false; return Promise.resolve(); });
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function () { this.paused = true; });
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(function () {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete global.IntersectionObserver;
  delete window.Capacitor;
  restoreVisibility();
  restoreConnection();
});

/* ══════════════════════════════════════════════════════════════════════════
   1. THE SCHEDULE — «۳۰ ثانیه یکبار … جمله سیگنال هوشمند»
   ══════════════════════════════════════════════════════════════════════════ */
describe('the 30-second cycle', () => {
  it("opens on the page's own sentence, before any timer fires", () => {
    renderWords();
    expect(shown()).toBe('سیگنال هوشمند');
    expect(isTitle()).toBe('true');
  });

  it('shows every word once, in locale order, then the sentence again at exactly 30 s', () => {
    renderWords();
    settle();
    const words = HERO_WORD_KEYS.map((k) => fa.signals.hero.words[k]);
    const seen = [shown()]; // slot 0: the page's own sentence, before any timer

    /* The first rotation waits for the page to settle (1.6 s) plus the
       sentence's own 6 s hold; every later slot holds 3 s. Each advance below
       crosses exactly ONE transition — two landing in the same millisecond
       would make the visible phrase depend on callback order rather than on
       the schedule. */
    firstRotation();
    seen.push(shown());                                  // word 1 at 6 s
    for (let n = 1; n < words.length; n += 1) {
      oneWord();
      seen.push(shown());                                // words 2…8, 3 s apart
    }

    expect(seen).toEqual(['سیگنال هوشمند', ...words]);
    // The last word's 3 s is what brings the sentence back: 6 s + 8 × 3 s = 30 s
    // of cycle, every slot shown exactly once, the page's own phrase closing it.
    oneWord();
    expect(shown()).toBe('سیگنال هوشمند');
    expect(isTitle()).toBe('true');
  });

  it('adds up to the advertised cycle: title hold + every word hold = 30 000 ms', () => {
    expect(HERO_CYCLE_MS).toBe(30_000);
    expect(HERO_TITLE_HOLD_MS + HERO_WORD_HOLD_MS * HERO_WORD_KEYS.length).toBe(HERO_CYCLE_MS);
    expect(HERO_WORD_KEYS.length).toBe(8);
    // A hold per word is derived, not hand-picked, so the lap cannot drift.
    expect(HERO_WORD_HOLD_MS).toBe(3_000);
    expect(HERO_TITLE_HOLD_MS).toBe(6_000);
  });

  it('keeps ticking: the sentence is there at every multiple of the cycle', () => {
    renderWords();
    settle();
    /* 1.6 s settle + one full 30 s cycle, three laps running: the sentence is
       what the reader finds at every multiple of the cycle, which is the whole
       meaning of «۳۰ ثانیه یکبار جمله سیگنال هوشمند». */
    for (let lap = 1; lap <= 3; lap += 1) {
      act(() => { vi.advanceTimersByTime(lap === 1 ? SETTLE_MS + HERO_CYCLE_MS : HERO_CYCLE_MS); });
      expect(shown(), `lap ${lap}`).toBe('سیگنال هوشمند');
      expect(isTitle(), `lap ${lap}`).toBe('true');
    }
  });

  it('shows one tick per slot and lights only the current one', () => {
    renderWords();
    settle();
    const ticks = () => [...document.querySelectorAll('.sigh-ticks i')];
    expect(ticks()).toHaveLength(HERO_WORD_KEYS.length + 1);
    expect(ticks()[0].dataset.on).toBe('true');
    firstRotation();
    expect(ticks()[1].dataset.on).toBe('true');
    expect(ticks()[0].dataset.on).toBe('false');
  });

  it('reads the English cycle in the English locale', () => {
    renderWords({}, 'en');
    expect(shown()).toBe(en.signals.title);
    expect(document.querySelector('.sigh-words-slot').getAttribute('aria-label')).toBe(en.signals.hero.aria);
    firstRotation();
    expect(shown()).toBe(en.signals.hero.words.early);
  });

  it('reads the Arabic cycle in the Arabic locale', () => {
    renderWords({}, 'ar');
    expect(shown()).toBe(ar.signals.title);
    firstRotation();
    expect(shown()).toBe(ar.signals.hero.words.early);
  });

  it('announces itself as a live region, and names the slot for a screen reader', () => {
    renderWords();
    settle();
    const slot = document.querySelector('.sigh-words-slot');
    expect(slot.getAttribute('aria-live')).toBe('polite');
    expect(slot.getAttribute('aria-atomic')).toBe('true');
    expect(slot.getAttribute('aria-label')).toBe(fa.signals.hero.aria);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2. THE GUARDS — «بدون افت سرعت» is a claim about timers, not about taste
   ══════════════════════════════════════════════════════════════════════════ */
describe('when motion is not allowed, nothing rotates', () => {
  it('freezes on the sentence, hides the ticks, and schedules no timer', () => {
    motionAllowed.still = true;
    renderWords();
    expect(shown()).toBe('سیگنال هوشمند');
    expect(document.querySelector('.sigh-ticks')).toBeNull();
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(shown()).toBe('سیگنال هوشمند');
  });

  it('marks the scene still, so the CSS freezes the drift too', () => {
    motionAllowed.still = true;
    renderScene({ active: false });
    expect(screen.getByTestId('signals-hero-scene').className).toContain('is-still');
  });
});

describe('the timers stop when nobody is watching', () => {
  it('does not rotate while the box is scrolled out of view', () => {
    renderWords();
    settle();
    act(() => { io.emit(false); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(shown()).toBe('سیگنال هوشمند');
    // …and picks the cycle up again when it scrolls back into view.
    act(() => { io.emit(true); });
    firstRotation();
    expect(shown()).toBe(fa.signals.hero.words.early);
  });

  it('does not rotate while the tab is hidden', () => {
    renderWords();
    settle();
    setVisibility('hidden');
    act(() => { fireEvent(document, new Event('visibilitychange')); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(shown()).toBe('سیگنال هوشمند');
  });

  it('clears its pending timer on unmount', () => {
    const clear = vi.spyOn(global, 'clearTimeout');
    const { unmount } = renderWords();
    settle();
    act(() => { vi.advanceTimersByTime(1_000); });
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3. THE BACKGROUND — the film the request named by default, and the drawn
      nebula in every case where that film cannot or must not play
   ══════════════════════════════════════════════════════════════════════════ */
describe('the film the request named is the DEFAULT — nothing to configure', () => {
  beforeEach(() => {
    /* A build with no `.env` at all. This is what every visitor gets, so the
       default is asserted here rather than assumed. */
    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO', '');
    vi.stubEnv('VITE_SIGNALS_HERO_POSTER', '');
    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO_CREDIT', '');
  });

  it('is the exact Pixabay CDN URL, in the component and on the mounted video', () => {
    /* Compared against a literal, not against "some https URL": this is a
       hotlink to a third-party CDN, and a mistyped date or id ships a 404 that
       shows up only as a hero that quietly never plays. */
    expect(HERO_FILM_SRC).toBe('https://cdn.pixabay.com/video/2026-10-10/381972_large.mp4');
    expect(resolveHeroFilm({})).toBe(HERO_FILM_SRC);
    expect(resolveHeroFilm({ VITE_SIGNALS_HERO_VIDEO: '' })).toBe(HERO_FILM_SRC);
    expect(resolveHeroFilm({ VITE_SIGNALS_HERO_VIDEO: '   ' })).toBe(HERO_FILM_SRC);
    renderScene();
    expect(document.querySelector('video').getAttribute('src')).toBe(HERO_FILM_SRC);
  });

  it('names the author of the film it hotlinks — and only once a frame is up', () => {
    /* The Pixabay Content License does not require attribution. A 4K render
       hotlinked as the front page of a trading app is still somebody's work,
       and the credit must not appear before the film does. */
    expect(HERO_FILM_CREDIT).toContain('Pixabay');
    expect(resolveHeroCredit({})).toBe(HERO_FILM_CREDIT);
    renderScene();
    settle();
    expect(document.querySelector('.sigh-credit')).toBeNull();
    act(() => { io.emit(true); });
    fireEvent(document.querySelector('video'), new Event('playing'));
    expect(document.querySelector('.sigh-credit').textContent).toBe(HERO_FILM_CREDIT);
  });

  it('still fetches nothing until the box is on screen', () => {
    /* The default being on makes this guard the whole performance story: a
       4K vertical loop must not enter the critical path of a page the reader
       has not scrolled to. */
    io.wasVisible = false;
    renderScene();
    settle();
    expect(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('idle');
    act(() => { io.emit(true); });
    expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
  });

  it('switches off on `none`, and never mistakes a real URL for an opt-out', () => {
    for (const off of HERO_FILM_OFF) {
      expect(resolveHeroFilm({ VITE_SIGNALS_HERO_VIDEO: off.toUpperCase() })).toBe('');
      // No film, no credit: an attribution for nothing is a lie in small type.
      expect(resolveHeroCredit({ VITE_SIGNALS_HERO_VIDEO: off })).toBe('');
    }
    expect(resolveHeroFilm({ VITE_SIGNALS_HERO_VIDEO: '/media/x.mp4' })).toBe('/media/x.mp4');

    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO', 'none');
    renderScene();
    settle();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('none');
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
    expect(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });

  it('never mounts the default film inside the native APK — the drawing instead', () => {
    window.Capacitor = { isNativePlatform: () => true };
    renderScene();
    settle();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('none');
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
    expect(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });

  it('keeps the film off a reader who asked to save data', () => {
    setConnection({ saveData: true, effectiveType: '4g' });
    renderScene();
    settle();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('none');
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
  });

  it('keeps the film off 2G, and on for anything faster', () => {
    const mounted = (conn) => {
      setConnection(conn);
      const { unmount } = renderScene();
      const yes = document.querySelector('video') !== null;
      unmount();
      return yes;
    };
    expect(mounted({ effectiveType: 'slow-2g' })).toBe(false);
    expect(mounted({ effectiveType: '2g' })).toBe(false);
    expect(mounted({ effectiveType: '3g' })).toBe(true);
    expect(mounted({ effectiveType: '4g' })).toBe(true);
    expect(mounted({})).toBe(true);
    expect(mounted(undefined)).toBe(true);
  });
});

describe('the drawn scene (film switched off — VITE_SIGNALS_HERO_VIDEO=none)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO', 'none');
    vi.stubEnv('VITE_SIGNALS_HERO_POSTER', '');
    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO_CREDIT', '');
  });

  it('paints the nebula and two star planes, and fetches no video at all', () => {
    renderScene();
    settle();
    const scene = screen.getByTestId('signals-hero-scene');
    expect(scene.dataset.film).toBe('none');
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
    expect(document.querySelectorAll('.sigh-plane')).toHaveLength(2);
    expect(document.querySelectorAll('.sigh-star').length).toBeGreaterThan(20);
    expect(document.querySelector('.sigh-vignette')).not.toBeNull();
    expect(document.querySelector('video')).toBeNull();
    expect(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });

  it('is hidden from assistive tech — decoration, never content', () => {
    renderScene();
    expect(screen.getByTestId('signals-hero-scene').getAttribute('aria-hidden')).toBe('true');
  });

  it('lays the same sky out twice: star positions are seeded, not random', () => {
    const positions = () => {
      const { unmount } = renderScene();
      const p = [...document.querySelectorAll('.sigh-star')]
        .map((star) => `${star.style.left}/${star.style.top}`)
        .join(',');
      unmount();
      return p;
    };
    expect(positions()).toBe(positions());
  });
});

describe("an operator's own film (VITE_SIGNALS_HERO_VIDEO=/media/…)", () => {
  const FILM = '/media/signals-hero.mp4';
  beforeEach(() => {
    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO', FILM);
    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO_CREDIT', 'Pixabay');
  });

  it('replaces the default URL, and invents no credit for a file it does not own', () => {
    /* The point of the slot: a deployment that would rather self-host a smaller
       rendition points here, and the Pixabay attribution must not follow the
       operator's own file. */
    expect(resolveHeroFilm()).toBe(FILM);
    vi.stubEnv('VITE_SIGNALS_HERO_VIDEO_CREDIT', '');
    expect(resolveHeroCredit()).toBe('');
    renderScene();
    settle();
    expect(document.querySelector('video').getAttribute('src')).toBe(FILM);
    act(() => { io.emit(true); });
    fireEvent(document.querySelector('video'), new Event('playing'));
    expect(document.querySelector('.sigh-credit')).toBeNull();
  });

  it('mounts a video that a mobile browser is actually allowed to autoplay', () => {
    renderScene();
    const v = document.querySelector('video');
    expect(v).not.toBeNull();
    expect(v.getAttribute('src')).toBe(FILM);
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.hasAttribute('playsinline')).toBe(true);
    expect(v.getAttribute('preload')).toBe('none');
    expect(v.hasAttribute('controls')).toBe(false);
    // Nothing is fetched by mounting alone.
    expect(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });

  it('starts the fetch only once the box is on screen', () => {
    /* A hero the reader has not scrolled to yet must cost nothing: no request,
       no decoder. This is the guard that keeps a 3 MB clip off the critical
       path of the page it decorates. */
    io.wasVisible = false;
    renderScene();
    settle();
    expect(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('idle');
    act(() => { io.emit(true); });
    expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('loading');
  });

  it('retires the drawn scene once a real frame is on screen', () => {
    renderScene();
    settle();
    act(() => { io.emit(true); });
    const v = document.querySelector('video');
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
    act(() => { fireEvent(v, new Event('playing')); });
    const scene = screen.getByTestId('signals-hero-scene');
    expect(scene.dataset.film).toBe('live');
    expect(scene.className).toContain('is-film');
    expect(document.querySelector('.sigh-neb')).toBeNull();
    expect(document.querySelectorAll('.sigh-star')).toHaveLength(0);
    // The operator's credit line appears with the film, never before it.
    expect(document.querySelector('.sigh-credit').textContent).toBe('Pixabay');
  });

  it('keeps the nebula when the film fails — never a black rectangle', () => {
    renderScene();
    settle();
    act(() => { io.emit(true); });
    const v = document.querySelector('video');
    act(() => { fireEvent(v, new Event('error')); });
    const scene = screen.getByTestId('signals-hero-scene');
    expect(scene.dataset.film).toBe('failed');
    expect(scene.className).not.toContain('is-film');
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
    expect(document.querySelector('.sigh-credit')).toBeNull();
  });

  it('pauses the decoder when the box scrolls away and resumes when it returns', () => {
    renderScene();
    settle();
    act(() => { io.emit(true); });
    const v = document.querySelector('video');
    act(() => { fireEvent(v, new Event('playing')); });
    const pause = window.HTMLMediaElement.prototype.pause;
    const play = window.HTMLMediaElement.prototype.play;
    const playsBefore = play.mock.calls.length;
    act(() => { io.emit(false); });
    // Scrolled past: the decoder stops instead of running for an empty viewport.
    expect(pause).toHaveBeenCalled();
    act(() => { io.emit(true); });
    // Scrolled back: it resumes, and it resumes because of THIS test's action —
    // counted against the calls already made, not against a magic total.
    expect(play.mock.calls.length).toBeGreaterThan(playsBefore);
  });

  it('never mounts a film inside the native APK — the 7.5 MB binary gets the drawing', () => {
    window.Capacitor = { isNativePlatform: () => true };
    renderScene();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('none');
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
  });

  it('does not fetch a film when motion is not allowed', () => {
    renderScene({ active: false });
    settle();
    act(() => { io.emit(true); });
    expect(window.HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('idle');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4. THE COPY — three complete locales, nine honest fallbacks
   ══════════════════════════════════════════════════════════════════════════ */
describe('the rotating words are real translations', () => {
  it('fa, en and ar carry every slot the component rotates', () => {
    for (const [code, bundle] of Object.entries({ fa, en, ar })) {
      expect(Object.keys(bundle.signals.hero.words), code).toEqual([...HERO_WORD_KEYS]);
      for (const k of HERO_WORD_KEYS) {
        const value = bundle.signals.hero.words[k];
        expect(typeof value, `${code}.${k}`).toBe('string');
        expect(value.trim().length, `${code}.${k}`).toBeGreaterThan(1);
      }
      expect(typeof bundle.signals.hero.aria, `${code}.aria`).toBe('string');
    }
  });

  it('keeps the requested Persian wording, verbatim', () => {
    expect(fa.signals.hero.words.early).toBe('سیگنال زودهنگام');
    expect(fa.signals.hero.words.momentum).toBe('شتاب حرکتی');
  });

  it('never prints a promise the disclaimer two boxes below contradicts', () => {
    /* These are names of measurements the page really makes. «buy now»,
       «guaranteed», «100%» or a price target on a decorative line would sit
       directly against `signals.disclaimer`, which says indicators do not
       predict anything. */
    const banned = /(بخرید|بخرد|تضمین|سود قطعی|۱۰۰٪|100%|guarantee|buy now|profit)/i;
    for (const bundle of [fa, en, ar]) {
      for (const value of Object.values(bundle.signals.hero.words)) expect(value).not.toMatch(banned);
    }
  });

  it('leaves the nine partial locales to the documented English fallback', () => {
    /* src/i18n/index.js: «fa/en/ar are complete; the rest carry the core
       surface … and fall back to English elsewhere». Those bundles do not even
       hold signals.subtitle, so a decoration is not where that changes — and
       scripts/add-signals-hero-copy.mjs records why. */
    for (const bundle of [es]) {
      expect(bundle.signals.hero).toBeUndefined();
      expect(bundle.signals.subtitle, 'control: also untranslated').toBeUndefined();
    }
    /* Checked as JSON, not as a substring: other namespaces in those bundles
       have their own `hero` keys, and a grep for the word proves nothing. */
    for (const code of ['fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
      const bundle = JSON.parse(read('src/i18n/locales/' + code + '.json'));
      expect(bundle.signals.hero, code).toBeUndefined();
    }
  });

  it('still rotates for a locale that has no hero copy at all', () => {
    /* i18next resolves the missing keys through the English fallback, so the
       cycle is a short English line rather than a printed key or an empty slot.
       A Spanish instance is exactly that situation. */
    render(
      <I18nextProvider i18n={makeI18n('es', { es: { translation: es } })}>
        <SignalsHeroWords />
      </I18nextProvider>
    );
    settle();
    /* The title EXISTS in Spanish (it is part of the core surface), so the
       sentence stays Spanish; only the hero words are missing, and those come
       through the English fallback instead of printing a key. */
    expect(shown()).toBe(es.signals.title);
    firstRotation();
    expect(shown()).toBe(en.signals.hero.words.early);
    expect(shown()).not.toContain('signals.hero');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5. THE CSS — the «بدون افت سرعت» half of the request, measured
   ══════════════════════════════════════════════════════════════════════════ */
describe('the stylesheet keeps its performance promises', () => {
  /** The property name of every declaration in a block, comments stripped. */
  const declarations = (block) =>
    block
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((d) => d.split(':')[0].trim())
      .filter((d) => d && !d.includes('{') && !d.includes('}'));

  it('animates only transform and opacity — never filter, never geometry', () => {
    const frames = cssCode().match(/@keyframes[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g) ?? [];
    expect(frames.length).toBeGreaterThanOrEqual(4);
    for (const frame of frames) {
      const name = frame.match(/@keyframes\s+([\w-]+)/)[1];
      for (const prop of declarations(frame.slice(frame.indexOf('{')))) {
        expect(['transform', 'opacity'], `${name} animates ${prop}`).toContain(prop);
      }
    }
  });

  it('animates and transitions no expensive property anywhere in the box', () => {
    /* `filter`, `backdrop-filter`, `box-shadow`, `width`, `height`, `top`,
       `left` inside an animation or transition is what PageTransition.jsx
       documents as the source of every stutter this app ever shipped. */
    const animated = cssCode().match(/(?:animation|transition):[^;]+;/g) ?? [];
    expect(animated.length).toBeGreaterThan(0);
    for (const a of animated) {
      expect(a, a).not.toMatch(/filter|box-shadow|width|height|top|left|margin|padding/);
    }
    expect(cssCode()).not.toMatch(/backdrop-filter/);
    expect(cssCode()).not.toMatch(/(animation|transition):[^;]*filter/);
  });

  it('cross-fades the film at exactly the speed the JS constant says', () => {
    /* The WORD fade is a framer-motion transition built from HERO_FADE_MS; the
       FILM fade is this rule. Both halves of «با انیمیشن محو می‌شود», each
       pinned to a constant the other file can read. */
    expect(HERO_FADE_MS).toBeGreaterThan(0);
    expect(HERO_FILM_CROSSFADE_MS).toBeGreaterThan(HERO_FADE_MS);
    const rule = css().match(/\.sigh-film\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(new RegExp(`transition:\\s*opacity\\s+${HERO_FILM_CROSSFADE_MS}ms`));
    expect(rule).toMatch(/object-fit:\s*cover/);
  });

  it('gives the rotating line a fixed slot so a long phrase cannot move the hero', () => {
    const slot = css().match(/\.sigh-words-slot\s*\{[^}]*\}/)[0];
    expect(slot).toMatch(/height:\s*var\(--sigh-slot-h\)/);
    const word = css().match(/\.sigh-word\s*\{[^}]*\}/)[0];
    expect(word).toMatch(/position:\s*absolute/);
    expect(word).toMatch(/white-space:\s*nowrap/);
    expect(word).toMatch(/text-overflow:\s*ellipsis/);
    expect(css()).toMatch(/--sigh-slot-h:\s*\d+px/);
  });

  it('frees the box from the glass wash that would hide the scene behind it', () => {
    /* signals-intel.css paints the hero with two white surfaces at ~94% combined
       opacity. A background paints BELOW every child, so without this rule the
       nebula would be a rumour. The gradient hairline (border-box layer) stays. */
    const hero = css().match(/\.sic-page-hero\.has-cinema\s*\{[^}]*padding-box[^}]*\}/);
    expect(hero).not.toBeNull();
    expect(hero[0]).toMatch(/border-box/);
    expect(css()).toMatch(/:root\[data-theme='light'\] \.sic-page-hero\.has-cinema\s*\{/);
  });

  it('freezes everything under reduced motion AND inside the native APK', () => {
    expect(css()).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css()).toMatch(/\.sigh-scene\.is-still \.sigh-neb[\s\S]{0,240}animation:\s*none/);
    expect(css()).toMatch(/:root\[data-native='true'\] \.sigh-neb[\s\S]{0,240}animation:\s*none/);
  });

  it('has a light-theme version, so the box is not a hole in the light UI', () => {
    expect(css()).toMatch(/:root\[data-theme='light'\] \.sigh-scene\s*\{/);
    expect(css()).toMatch(/:root\[data-theme='light'\] \.sigh-vignette/);
    expect(css()).toMatch(/:root\[data-theme='light'\] \.sigh-word\.is-title/);
  });

  it('scopes every rule to this box — no other screen can be touched', () => {
    const selectors = cssCode()
      .replace(/@keyframes[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
      .replace(/@media[^{]+\{/g, '')
      .replace(/@supports[^{]+\{/g, '')
      .split('}')
      .map((chunk) => chunk.split('{')[0].trim())
      .filter((sel) => sel && !sel.startsWith('@'));
    /* No bare `*` selector and nothing reaching into another screen. The one
       `> *` in this file is scoped by `.sic-page-hero.has-cinema` on its left,
       which is exactly what it is for: lifting the hero's own children above the
       scene layer. */
    expect(selectors.length).toBeGreaterThan(20);
    for (const sel of selectors) {
      const ok = sel.split(',').every((part) => {
        const p = part.trim();
        return (
          p.startsWith('.sigh-') ||
          p.startsWith('.sic-page-hero.has-cinema') ||
          /* The app-level hooks every stylesheet in this repo keys off: theme,
             native shell, OS motion preference. Still no other screen in here. */
          p.startsWith(':root[data-theme=') ||
          p.startsWith(':root[data-native=')
        ) && !/(^|[,\s])\*(\s|$|,)/.test(p);
      });
      expect(ok, `unscoped selector: ${sel}`).toBe(true);
    }
  });

  it("hands the hero's content a layer above the scene, and switches the old aurora off", () => {
    expect(css()).toMatch(/\.sic-page-hero\.has-cinema > \*:not\(\.sigh-scene\)\s*\{[^}]*z-index:\s*1/);
    expect(css()).toMatch(/\.sic-page-hero\.has-cinema::before\s*\{[^}]*animation:\s*none/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6. THE WIRING — the page really mounts it, and the hero keeps its contract
   ══════════════════════════════════════════════════════════════════════════ */
describe('the Signals page wiring', () => {
  it('mounts the scene and the cycle inside the first box, and keeps the h1', () => {
    const src = page();
    const hero = src.slice(src.indexOf('className="sic-page-hero has-cinema"'));
    expect(hero).toContain('<SignalsHeroScene active={!still} />');
    expect(hero).toContain('<SignalsHeroWords />');
    expect(hero).toMatch(/<h1>\{t\('signals\.title'\)\}<\/h1>/);
    expect(src).toMatch(/import \{ SignalsHeroScene, SignalsHeroWords \} from '\.\.\/components\/SignalsHeroCinema'/);
    expect(src).toMatch(/import '\.\.\/styles\/signals-hero-cinema\.css'/);
  });

  it("drives the scene from the app's own reduce-motion guard, not a private one", () => {
    const src = page();
    /* `useStill()` is the shared hook (system prefers-reduced-motion OR the
       app's own setting) that AnimatedIcon, AdBanner and ShopPromo already use.
       A distance-bounded regex across a 2400-line page proves nothing, so each
       half is asserted where it lives. */
    expect(src).toMatch(/const \{ t, i18n \} = useTranslation\(\);\n[\s\S]{0,420}?const still = useStill\(\);/);
    expect(src).toMatch(/<SignalsHeroScene active=\{!still\} \/>/);
  });

  it('does not touch the hero rules the rest of the app depends on', () => {
    const intel = read('src/styles/signals-intel.css');
    expect(intel).toMatch(
      /\.sic-page-hero \{[\s\S]*?position: relative;[\s\S]*?overflow: hidden;[\s\S]*?isolation: isolate;/
    );
  });

  it('documents all three env vars, the default URL and the opt-out word', () => {
    const env = read('.env.example');
    expect(env).toMatch(/^VITE_SIGNALS_HERO_VIDEO=$/m);
    expect(env).toMatch(/^VITE_SIGNALS_HERO_POSTER=$/m);
    expect(env).toMatch(/^VITE_SIGNALS_HERO_VIDEO_CREDIT=$/m);

    /* Everything between the section banner and the last of the three
       variables. Sliced rather than distance-bounded with a regex: the block is
       Persian prose, its length is not the contract, and a `{0,1400}` window
       over it breaks every time a sentence is added. */
    const from = env.indexOf('# ─── صفحهٔ سیگنال');
    const to = env.indexOf('VITE_SIGNALS_HERO_VIDEO_CREDIT=');
    expect(from).toBeGreaterThan(-1);
    const block = env.slice(from, to);
    expect(to).toBeGreaterThan(from);

    /* The page the request named AND the CDN file it resolves to: whoever reads
       this next should not have to repeat the discovery, and should know the
       file is a 4K vertical. */
    expect(block).toContain('pixabay.com/videos/galaxy-nebula-space-cosmos-381972');
    expect(block).toContain(HERO_FILM_SRC);
    expect(block).toContain('2160×3840');
    // What an empty value now means, and the word that switches the film off.
    expect(block).toMatch(/اگر خالی بماند/);
    expect(block).toContain('none');
    expect(block).toContain(HERO_FILM_CREDIT);
    /* The three cases where nothing is fetched at all, written down where an
       operator debugging «why is my film not playing» will find them. */
    expect(block).toContain('saveData');
    expect(block).toContain('APK');
    expect(block).toMatch(/prefers-reduced-motion/);
  });

  it('keeps the hero vars out of the APK workflow — the binary is never told to fetch a film', () => {
    /* `isNativeShell()` already refuses the film in the APK, so a repository
       variable could only create the illusion of a switch. The workflow's
       explicit `vars.VITE_*` allowlist stays without these three. */
    expect(read('.github/workflows/build-apk.yml')).not.toContain('VITE_SIGNALS_HERO');
  });

  it('ships no video asset in the repository — the film is a URL, not a file', () => {
    /* Playing the clip by default does not mean committing it: a 4K vertical
       loop does not ride along in the bundle or in a 7.5 MB APK for one box of
       one screen, and a library's file is theirs to keep serving. */
    expect(() => read('public/media/signals-hero.mp4')).toThrow();
    const src = read('src/components/SignalsHeroCinema.jsx');
    expect(src).toContain(HERO_FILM_SRC);
    expect(src).not.toMatch(/from '\.\.\/assets\/.*\.(mp4|webm)'/);
  });
});
