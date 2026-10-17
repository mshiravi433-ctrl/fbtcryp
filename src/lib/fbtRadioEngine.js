/**
 * FBT LIVE RADIO — the engine.
 * ---------------------------------------------------------------------------
 * One <audio> element for the whole app, created the first time it is needed
 * and never unmounted. React components come and go (tabs, routes), the
 * element does not — which is what makes this actually behave like a radio
 * rather than like a video that stops when you scroll away.
 *
 * ─── THE URL ────────────────────────────────────────────────────────────────
 * `/radio/fbt-radio-2h.mp3` is the 48 kbps mono stream build of the 2-hour
 * broadcast, served from this site's own origin (public/radio). Same origin
 * matters twice: no CORS dance for a media element, and Range requests work,
 * so seeking into the second hour does not re-download the first.
 *
 * `VITE_FBT_RADIO_URL` overrides it for a CDN without touching the component.
 *
 * ─── AUTOPLAY, HONESTLY ─────────────────────────────────────────────────────
 * Every current browser blocks audio with sound until the page has been
 * touched. Opening the radio tab IS a touch (the tab button), so in the normal
 * path `play()` succeeds. A cold load of `#/news?tab=listen` has no gesture,
 * so the promise rejects — and instead of showing a playing bar over silence,
 * we flip `blocked` and the box renders a labelled play button. The next tap
 * anywhere in the app retries, once.
 */
import { useFbtRadioStore } from '../store/useFbtRadioStore';
import { useRadioStore } from '../store/useRadioStore';

export const FBT_RADIO_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FBT_RADIO_URL) ||
  '/radio/fbt-radio-2h.mp3';

let el = null;
let wired = false;

const patch = (next) => useFbtRadioStore.getState().patch(next);

/** Create the element once; wire its events once. */
export function ensureAudio() {
  if (el) return el;

  el = new Audio();
  el.preload = 'metadata';
  el.src = FBT_RADIO_URL;
  el.volume = useFbtRadioStore.getState().volume;
  el.setAttribute('playsinline', '');
  /* Keeps the lock-screen / notification controls alive on Android. */
  el.setAttribute('data-fbt-radio', 'live');

  el.addEventListener('play', () => patch({ playing: true, started: true, blocked: false }));
  el.addEventListener('pause', () => patch({ playing: false }));
  el.addEventListener('waiting', () => patch({ error: false }));
  el.addEventListener('error', () => patch({ playing: false, error: true }));
  el.addEventListener('loadedmetadata', () =>
    patch({ duration: Number.isFinite(el.duration) ? el.duration : 7200 })
  );
  el.addEventListener('durationchange', () =>
    patch({ duration: Number.isFinite(el.duration) ? el.duration : 7200 })
  );
  el.addEventListener('timeupdate', () => patch({ time: el.currentTime || 0 }));
  el.addEventListener('progress', () => {
    try {
      if (el.buffered?.length) patch({ buffered: el.buffered.end(el.buffered.length - 1) });
    } catch {
      /* buffered ranges can be emptied mid-seek; not worth a state update */
    }
  });
  return el;
}

/**
 * Two sources, one speaker.
 *
 * Starting the live station stops whatever podcast `RadioDock` was playing,
 * and starting a podcast pauses the station. Without this the news screen can
 * produce two voices at once the moment somebody taps an episode while the
 * radio is on — which reads as a broken app, not as two features.
 */
function quietenTheOtherSource() {
  if (!wired) {
    wired = true;
    useRadioStore.subscribe((next, prev) => {
      if (next.track && next.track !== prev.track && el && !el.paused) {
        el.pause();
      }
    });
  }
}

export async function play() {
  const a = ensureAudio();
  quietenTheOtherSource();
  patch({ pillHidden: false });
  try {
    useRadioStore.getState().stop();
  } catch {
    /* the podcast store is independent; a stale stop must not block radio */
  }
  try {
    await a.play();
    patch({ blocked: false, error: false });
  } catch (err) {
    /* NotAllowedError = needs a gesture. Anything else = the file/host failed. */
    if (err && err.name === 'NotAllowedError') patch({ blocked: true });
    else patch({ error: true });
  }
}

export function pause() {
  ensureAudio().pause();
}

export function toggle() {
  const store = useFbtRadioStore.getState();
  if (store.playing) pause();
  else play();
}

export function seek(seconds) {
  const a = ensureAudio();
  const max = Number.isFinite(a.duration) ? a.duration : 7200;
  const next = Math.min(Math.max(0, seconds), Math.max(0, max - 0.5));
  try {
    a.currentTime = next;
  } catch {
    /* seeking before metadata is a no-op, not an error */
  }
  patch({ time: next });
}

export function skip(delta) {
  const a = ensureAudio();
  seek((a.currentTime || 0) + delta);
}

export function setVolume(v) {
  const a = ensureAudio();
  const vol = Math.min(1, Math.max(0, v));
  a.volume = vol;
  a.muted = vol === 0;
  patch({ volume: vol, muted: a.muted });
}

export function toggleMute() {
  const a = ensureAudio();
  a.muted = !a.muted;
  patch({ muted: a.muted });
}

const RATES = [1, 1.25, 1.5, 0.75];
export function cycleRate() {
  const a = ensureAudio();
  const i = RATES.indexOf(a.playbackRate);
  const rate = RATES[(i + 1) % RATES.length];
  a.playbackRate = rate;
  patch({ rate });
}

/**
 * Try without a gesture (normal path: the tab tap that mounted the box), and
 * arm a one-shot retry for the cold-load case.
 */
export function autoplayOnce() {
  if (useFbtRadioStore.getState().started) return;
  play();
  if (typeof document === 'undefined') return;
  const retry = () => {
    if (useFbtRadioStore.getState().blocked) play();
    document.removeEventListener('pointerdown', retry, true);
    document.removeEventListener('keydown', retry, true);
  };
  document.addEventListener('pointerdown', retry, true);
  document.addEventListener('keydown', retry, true);
}
