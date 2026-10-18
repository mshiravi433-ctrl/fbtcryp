// @vitest-environment jsdom
/**
 * Signals hero: verifies the 30-second word cycle, lazy same-origin video,
 * visible fallback, translations, reduced-motion guards and page wiring.
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
  SignalsHeroMark,
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

const USER_AGENT_OWN = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
const setUserAgent = (value) =>
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
const restoreUserAgent = () => {
  delete navigator.userAgent;
  if (USER_AGENT_OWN) Object.defineProperty(navigator, 'userAgent', USER_AGENT_OWN);
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
  restoreUserAgent();
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
       sentence's own 6 s hold; every later slot holds 6 s too. Each advance below
       crosses exactly ONE transition — two landing in the same millisecond
       would make the visible phrase depend on callback order rather than on
       the schedule. */
    firstRotation();
    seen.push(shown());                                  // word 1 at 6 s
    for (let n = 1; n < words.length; n += 1) {
      oneWord();
      seen.push(shown());                                // phrases 2…4, 6 s apart
    }

    expect(seen).toEqual(['سیگنال هوشمند', ...words]);
    // The last phrase's 6 s is what brings the sentence back: 6 s + 4 × 6 s = 30 s
    // of cycle, every slot shown exactly once, the page's own phrase closing it.
    oneWord();
    expect(shown()).toBe('سیگنال هوشمند');
    expect(isTitle()).toBe('true');
  });

  it('adds up to the advertised cycle: title hold + every phrase hold = 30 000 ms', () => {
    expect(HERO_CYCLE_MS).toBe(30_000);
    expect(HERO_TITLE_HOLD_MS + HERO_WORD_HOLD_MS * HERO_WORD_KEYS.length).toBe(HERO_CYCLE_MS);
    expect(HERO_WORD_KEYS.length).toBe(4);
    // A hold per word is derived, not hand-picked, so the lap cannot drift.
    expect(HERO_WORD_HOLD_MS).toBe(6_000);
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

  it('gives every phrase its own SVG glyph — and the glyph adds no text of its own', () => {
    renderWords();
    settle();
    const word = () => screen.getByTestId('signals-hero-word');
    expect(word().dataset.glyph).toBe('title');
    expect(word().querySelector('.sigh-word-ic svg')).not.toBeNull();
    expect(word().querySelector('.sigh-word-ic svg').getAttribute('aria-hidden')).toBe('true');
    /* The chip is decoration: what is read off the element, by a screen
       reader or by `shown()` above, stays exactly the phrase. */
    expect(shown()).toBe('سیگنال هوشمند');
    firstRotation();
    expect(word().dataset.glyph).toBe('early');
    expect(shown()).toBe(fa.signals.hero.words.early);
  });

  it('lets a tap advance the phrase, and a tap on a tick jump straight to it', () => {
    renderWords();
    settle();
    fireEvent.click(document.querySelector('.sigh-words'));
    expect(shown()).toBe(fa.signals.hero.words.early);
    const ticks = [...document.querySelectorAll('.sigh-ticks i')];
    fireEvent.click(ticks[3]);
    expect(shown()).toBe(fa.signals.hero.words.history);
    expect(screen.getByTestId('signals-hero-word').dataset.glyph).toBe('history');
    /* …and the automatic cycle carries on from where the reader put it. */
    settle();
    act(() => { vi.advanceTimersByTime(SETTLE_MS + HERO_WORD_HOLD_MS); });
    expect(shown()).toBe(fa.signals.hero.words.conclusion);
  });

  it('pauses the cycle while the ticker is pressed, and resumes on release', () => {
    renderWords();
    settle();
    fireEvent.pointerDown(document.querySelector('.sigh-words'));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(shown()).toBe('سیگنال هوشمند');
    fireEvent.pointerUp(document.querySelector('.sigh-words'));
    firstRotation();
    expect(shown()).toBe(fa.signals.hero.words.early);
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

  it('keeps the rotating phrases alive if Android misses the observer report', () => {
    io.wasVisible = false;
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36');
    renderWords();
    firstRotation();
    expect(shown()).toBe(fa.signals.hero.words.early);
  });

  it('preserves visibility pausing on iPhone', () => {
    io.wasVisible = false;
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
    renderWords();
    settle();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(shown()).toBe('سیگنال هوشمند');
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
    expect(HERO_FILM_SRC).toBe('/media/signals-hero.mp4');
    expect(resolveHeroFilm({})).toBe(HERO_FILM_SRC);
    expect(resolveHeroFilm({ VITE_SIGNALS_HERO_VIDEO: '' })).toBe(HERO_FILM_SRC);
    expect(resolveHeroFilm({ VITE_SIGNALS_HERO_VIDEO: '   ' })).toBe(HERO_FILM_SRC);
    renderScene();
    expect(document.querySelector('video').getAttribute('src')).toBeNull();
    settle();
    expect(document.querySelector('video').getAttribute('src')).toBe(HERO_FILM_SRC);
  });

  it('does not invent a credit for the original bundled loop', () => {
    expect(HERO_FILM_CREDIT).toBe('');
    expect(resolveHeroCredit({})).toBe('');
    renderScene();
    settle();
    act(() => { io.emit(true); });
    fireEvent(document.querySelector('video'), new Event('playing'));
    expect(document.querySelector('.sigh-credit')).toBeNull();
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

  it('plays the film on an Android PHONE BROWSER — the bundled loop is 37 KB, not the old 4K clip', () => {
    /* The denied-Android guard was written for a 4K stock hotlink; the clip
       that ships now is a 640×240, six-second, ~37 KB same-origin loop.
       Android Chrome/WebView readers get the same cinema as iPhone, with
       the drawn sky kept cheaper behind it (18 stars, no turbulence). */
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36');
    renderScene();
    const scene = screen.getByTestId('signals-hero-scene');
    expect(scene.dataset.platform).toBe('android');
    expect(document.querySelector('video')).not.toBeNull();
    settle();
    expect(document.querySelector('video').getAttribute('src')).toBe(HERO_FILM_SRC);
    expect(scene.dataset.film).toBe('loading');
    // …while the drawn fallback behind it stays the cheap Android sky.
    expect(document.querySelectorAll('.sigh-star')).toHaveLength(18);
    expect(document.querySelector('.sigh-neb g').getAttribute('filter')).toBeNull();
  });

  it('still refuses the film inside the APK even on an Android user agent', () => {
    /* The APK's WebView also says "Android" — the native-shell answer, not
       the user agent, is what keeps a decoder out of the packaged app. */
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36');
    window.Capacitor = { isNativePlatform: () => true };
    renderScene();
    settle();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByTestId('signals-hero-scene').dataset.film).toBe('none');
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

  it('mounts no video decoder on Android either when the film is switched off', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile');
    const { container } = renderScene({ active: true });
    settle();
    expect(container.querySelector('video')).toBeNull();
  });

  it('uses a lighter static SVG sky on Android but keeps the iPhone scene intact', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36');
    const android = renderScene();
    expect(screen.getByTestId('signals-hero-scene').dataset.platform).toBe('android');
    expect(document.querySelectorAll('.sigh-star')).toHaveLength(18);
    expect(document.querySelector('.sigh-neb g').getAttribute('filter')).toBeNull();
    android.unmount();

    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
    renderScene();
    expect(screen.getByTestId('signals-hero-scene').dataset.platform).toBeUndefined();
    expect(document.querySelectorAll('.sigh-star')).toHaveLength(38);
    expect(document.querySelector('.sigh-neb g').getAttribute('filter')).toMatch(/^url\(#shc/);
  });
});

describe("an operator's own film (VITE_SIGNALS_HERO_VIDEO=/media/…)", () => {
  const FILM = '/media/custom.mp4';
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
    expect(v.getAttribute('src')).toBeNull();
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.hasAttribute('playsinline')).toBe(true);
    expect(v.getAttribute('preload')).toBe('none');
    expect(v.hasAttribute('autoplay')).toBe(true);
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
    expect(document.querySelector('.sigh-neb')).not.toBeNull();
    expect(document.querySelector('.sigh-vignette')).not.toBeNull();
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
   3b. THE MARK — the animated SVG sigil in the medallion
   ══════════════════════════════════════════════════════════════════════════ */
describe('the hero mark', () => {
  it('draws the orbit rail, two breathing rings, the satellite and the trace', () => {
    render(
      <I18nextProvider i18n={makeI18n('fa')}>
        <SignalsHeroMark />
      </I18nextProvider>
    );
    const mark = screen.getByTestId('signals-hero-mark');
    expect(mark.tagName.toLowerCase()).toBe('svg');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelectorAll('.sigh-mark-ring')).toHaveLength(2);
    expect(mark.querySelector('.sigh-mark-orbit')).not.toBeNull();
    expect(mark.querySelector('.sigh-mark-core')).not.toBeNull();
    expect(mark.querySelector('path')).not.toBeNull();
    /* A brand mark beside an h1 carries no words of its own. */
    expect(mark.textContent).toBe('');
  });

  it('freezes into the still sigil when motion is not allowed', () => {
    motionAllowed.still = true;
    render(
      <I18nextProvider i18n={makeI18n('fa')}>
        <SignalsHeroMark />
      </I18nextProvider>
    );
    expect(screen.getByTestId('signals-hero-mark').classList.contains('is-still')).toBe(true);
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
    expect(fa.signals.hero.words.momentum).toBe('رادار شتاب');
    expect(fa.signals.hero.words.history).toBe('تاریخچه سیگنال‌ها');
    expect(fa.signals.hero.words.conclusion).toBe('نتیجه‌گیری با هوش مالی مدرن و زیبا');
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
    /* The WORD fade is a CSS opacity transition matching HERO_FADE_MS; the
       FILM fade is this rule. Both halves of «با انیمیشن محو می‌شود», each
       pinned to a constant the other file can read. */
    expect(HERO_FADE_MS).toBeGreaterThan(0);
    expect(HERO_FILM_CROSSFADE_MS).toBeGreaterThan(HERO_FADE_MS);
    const rule = css().match(/\.sigh-film\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(new RegExp(`transition:\\s*opacity\\s+${HERO_FILM_CROSSFADE_MS}ms`));
    expect(rule).toMatch(/object-fit:\s*cover/);
    expect(css()).toMatch(/\.sigh-scene\.is-film \.sigh-film \{ opacity: 1; \}/);
  });

  it('lays the band out as two rows: the ticker owns the full width of row 2', () => {
    /* The proportions contract. The phrase row spans every column, which is
       what lets one line hold the longest Persian sentence and keeps the
       whole band ≈112–124px tall instead of stacking into ~160px. */
    expect(css()).toMatch(/\.sic-page-hero\.has-cinema > \.sigh-words\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(css()).toMatch(/--sigh-slot-h:\s*24px/);
    /* The live pill survives the narrow hero collapse in signals-intel.css —
       live/offline is information a phone keeps, in its compact form. */
    expect(css()).toMatch(/\.sic-page-hero\.has-cinema \.sic-hero-status \{\s*display:\s*flex/);
  });

  it('rests the big drawn layers while the film covers them', () => {
    expect(css()).toMatch(/\.sigh-scene\.is-film \.sigh-neb,[\s\S]*?animation-play-state:\s*paused/);
  });

  it('keeps the medallion sigil to composited motion only', () => {
    /* Rings scale around their own centre and the satellite rotates around
       the mark's: transform-box is what makes an SVG group spin in place
       instead of orbiting the page. */
    expect(css()).toMatch(/\.sigh-mark-orbit\s*\{[^}]*transform-box:\s*view-box/);
    expect(css()).toMatch(/\.sigh-mark-ring\s*\{[^}]*transform-box:\s*fill-box/);
    expect(css()).toMatch(/\.sigh-mark\.is-still \.sigh-mark-orbit \{\s*animation:\s*none/);
    expect(css()).toMatch(/:root\[data-native='true'\] \.sigh-mark-orbit,[\s\S]*?animation:\s*none/);
  });

  it('gives the rotating line a fixed slot so a long phrase cannot move the hero', () => {
    const slot = css().match(/\.sigh-words-slot\s*\{[^}]*\}/)[0];
    expect(slot).toMatch(/height:\s*var\(--sigh-slot-h\)/);
    expect(slot).toMatch(/min-width:\s*0/);
    expect(slot).toMatch(/width:\s*100%/);
    const word = css().match(/\.sigh-word\s*\{[^}]*\}/)[0];
    expect(word).toMatch(/position:\s*absolute/);
    expect(word).toMatch(/width:\s*100%/);
    expect(word).toMatch(/white-space:\s*nowrap/);
    expect(word).toMatch(/text-overflow:\s*ellipsis/);
    expect(css()).toMatch(/--sigh-slot-h:\s*\d+px/);
  });

  it('uses opaque text and a full-panel absolute scene for Chromium RTL grids', () => {
    expect(css()).toMatch(/grid-area:\s*auto/);
    expect(css()).toMatch(/top:\s*0; right:\s*0; bottom:\s*0; left:\s*0/);
    const title = css().match(/\.sigh-word\.is-title\s*\{[^}]*\}/)[0];
    expect(title).toMatch(/-webkit-text-fill-color:\s*currentColor/);
    expect(title).not.toMatch(/color:\s*transparent/);
  });

  it('fills the hero width and keeps Android motion to the phrase cycle', () => {
    const hero = css().match(/\.sic-page-hero\.has-cinema\s*\{[^}]*\}/)?.[0] || '';
    expect(hero).toMatch(/width:\s*100%/);
    expect(css()).toMatch(/\.sigh-words\s*\{[^}]*width:\s*100%/);
    expect(css()).toMatch(/\.sigh-scene\.is-android \.sigh-neb,[\s\S]*?animation:\s*none/);
    expect(css()).toMatch(/\.sigh-scene\.is-android \.sigh-star\s*\{[^}]*opacity:\s*var\(--dim/);
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
    expect(hero).toContain('<SignalsHeroMark />');
    /* The ticker is a DIRECT child of the band (its own grid row), not a
       third line inside the copy column — that placement is the whole
       proportions fix, so it is pinned here: the copy div closes before
       the ticker appears. */
    const copy = hero.slice(hero.indexOf('sic-hero-copy'), hero.indexOf('<SignalsHeroWords />'));
    expect(copy).toContain('</div>');
    expect(hero).toMatch(/<h1>\{t\('signals\.title'\)\}<\/h1>/);
    expect(src).toMatch(/import \{ SignalsHeroMark, SignalsHeroScene, SignalsHeroWords \} from '\.\.\/components\/SignalsHeroCinema'/);
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
    expect(block).toContain(HERO_FILM_SRC);
    // What an empty value now means, and the word that switches the film off.
    expect(block).toMatch(/اگر خالی بماند/);
    expect(block).toContain('none');
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

  it('ships a small same-origin video in the repository', () => {
    /* Playing the clip by default does not mean committing it: a 4K vertical
       loop does not ride along in the bundle or in a 7.5 MB APK for one box of
       one screen, and a library's file is theirs to keep serving. */
    expect(readFileSync(join(ROOT, 'public/media/signals-hero.mp4')).length).toBeGreaterThan(1000);
    const src = read('src/components/SignalsHeroCinema.jsx');
    expect(src).toContain(HERO_FILM_SRC);
    expect(src).not.toMatch(/from '\.\.\/assets\/.*\.(mp4|webm)'/);
  });
});
