import { create } from 'zustand';

/**
 * WHAT IS PLAYING, HELD ABOVE THE ROUTER.
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS EXISTS TO FIX ─────────────────────────────────────────────
 *   «امکان پخش در پس‌زمینه داشته باشد، مثلا وقتی پادکست را می‌زنی و می‌روی به
 *    صفحه سواپ»
 *
 * Playback died the instant you left the News screen. The reason was
 * structural rather than a missing feature: `RadioPanel` owned the "which
 * episode" state and `AudioPlayer` owned the `<audio>` element, and BOTH live
 * inside a route. Every route in this app is wrapped in `<AnimatePresence>`,
 * so navigating away unmounts the subtree — and `AudioPlayer`'s cleanup
 * correctly pauses and releases the element. The audio stopping was the code
 * working exactly as written.
 *
 * You cannot fix that from inside the component. Anything mounted under the
 * router is unmounted by the router. The selection has to live somewhere the
 * router cannot reach, which is what this store is.
 *
 * ─── WHY A STORE AND NOT A CONTEXT PROVIDER ─────────────────────────────────
 * A context around the router would also survive navigation, and would work.
 * It was rejected for one specific reason: a context value change re-renders
 * every consumer, and the player updates its position several times a second
 * while playing. With zustand each subscriber picks its own slice, so the
 * floating pill can subscribe to "is something playing" and re-render never,
 * while the transport subscribes to the track.
 *
 * The rest of this app already uses zustand for exactly this reason.
 *
 * ─── DELIBERATELY NOT PERSISTED ─────────────────────────────────────────────
 * `useAppStore` and `useSettingsStore` both persist to localStorage. This one
 * must not. Restoring "was playing" across a page load would mean audio
 * starting on its own when somebody reopens the app — which every browser
 * autoplay policy will refuse anyway, leaving a bar that claims to be playing
 * over silence. That state, a control that lies about what it is doing, is the
 * single most confusing thing an audio player can show, and the player already
 * has explicit handling to avoid it.
 */
export const useRadioStore = create((set, get) => ({
  /**
   * The episode object itself, not an id.
   *
   * The floating pill renders outside the News screen and has no access to the
   * feed, so an id would leave it unable to show a title. Carrying the whole
   * item is a few hundred bytes and removes an entire class of "the pill says
   * nothing because the list is not loaded" bug.
   */
  track: null,

  /**
   * The list the player advances through, captured at selection time.
   *
   * Held here rather than re-read from the feed because the queue is the
   * FILTERED list — if the user narrowed to one show, "next" must mean the
   * next episode of that show. Once they navigate away the filter is gone, so
   * the queue has to have been remembered.
   */
  queue: [],

  /**
   * Whether the element is actually producing sound.
   *
   * Written by the player from the real `play`/`pause` events, never optimistic
   * ally on tap. A pill that shows "playing" because a button was pressed,
   * while the CDN quietly refused the file, is precisely the dishonest state
   * this app keeps removing.
   */
  playing: false,

  play(track, queue = []) {
    if (!track?.audioUrl) return;
    set({ track, queue: Array.isArray(queue) ? queue : [] });
  },

  /** Change episode without disturbing the queue — next/previous, auto-advance. */
  setTrack(track) {
    if (!track?.audioUrl) return;
    set({ track });
  },

  setPlaying(playing) {
    set({ playing: Boolean(playing) });
  },

  /** Full stop: clears the track, which unmounts the transport entirely. */
  stop() {
    set({ track: null, queue: [], playing: false });
  },

  /** Selecting the episode that is already loaded means "stop", as in a list. */
  toggleTrack(track, queue = []) {
    if (get().track?.id === track?.id) {
      get().stop();
      return;
    }
    get().play(track, queue);
  }
}));
