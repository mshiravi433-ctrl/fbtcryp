import { create } from 'zustand';

/**
 * FBT LIVE RADIO — playback state, held above every screen.
 * ---------------------------------------------------------------------------
 * The box on the News → Radio tab is only a CONTROL SURFACE. The <audio>
 * element lives in `lib/fbtRadioEngine.js`, outside React, so this station
 * keeps playing when:
 *
 *   • the reader switches News tabs (RadioPanel is unmounted by the tab row),
 *   • the reader navigates to Swap or Market (every route is unmounted by
 *     <AnimatePresence>),
 *   • the phone screen is off.
 *
 * That is the difference between "a player widget" and "a radio".
 *
 * ─── WHY NOT REUSE useRadioStore ────────────────────────────────────────────
 * `useRadioStore` drives the podcast transport (`AudioPlayer`) which renders
 * its own <audio> in `RadioDock`. Feeding this station through it would create
 * a second element and a second transport bar on the same screen. The two
 * stores are therefore deliberately separate — and the engine quietens one
 * when the other starts, so two things can never play at once.
 */
export const useFbtRadioStore = create((set) => ({
  /** True only after the element's own `play` event fired — never optimistic. */
  playing: false,

  /** Set once playback has been attempted, so the UI can tell "idle" from
   *  "the browser said no". */
  started: false,

  /** Autoplay was refused (no user gesture yet). The box shows a real button
   *  instead of pretending to play silence. */
  blocked: false,

  /** File/CDN failure, distinct from a policy refusal. */
  error: false,

  time: 0,
  duration: 7200,
  buffered: 0,

  muted: false,
  volume: 0.85,
  rate: 1,

  /** The floating pill can be dismissed without stopping the station flag;
   *  the next `play()` brings it back. */
  pillHidden: false,

  patch(next) {
    set(next);
  }
}));
