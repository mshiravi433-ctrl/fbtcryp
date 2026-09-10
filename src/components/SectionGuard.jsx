import React from 'react';
import { releaseAllScrollLocks } from '../lib/scrollLock';

/**
 * SECTION-LEVEL CRASH ISOLATION, with self-healing.
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «صفحه سیگنال خیلی اوقات باگ میخوره و میگه مشکلی پیش اومده، دوباره تکرار
 *    کن»
 *
 * The Signals page renders ~10 independently-fed panels (pulse, focus card,
 * breakdown, AI outlook, smart money, history, modals) from five different
 * polls that resolve at different times. The route-level boundary
 * (RouteBoundary) is the safety net for the whole route — which means ONE bad
 * value in ONE panel blanks the ENTIRE screen into the crash card, even
 * though every other panel had perfectly good data an instant ago. On a
 * 30-second polling cadence the odds that some upstream glitches eventually
 * approach 1, so "sometimes" quickly reads as "all the time".
 *
 * ─── THE RULE THIS ENFORCES ─────────────────────────────────────────────────
 * A section that cannot render its current data hides ITSELF, never the page:
 *
 *   · The failure is confined to the panel whose data produced it. The rest
 *     of the screen — including the thing the user actually came to read —
 *     keeps working.
 *   · It HEALS ITSELF. Poll-delivered data is transient by nature: whatever
 *     made the section throw is usually gone at the next tick. When the
 *     caller's `resetKey` changes (a new poll landed, a different coin got
 *     selected), the guard drops the error and re-renders. A one-off bad
 *     shape therefore costs an invisible flicker, not a dead screen the user
 *     has to dismiss.
 *   · It is quiet on purpose. The fallback defaults to nothing: a missing
 *     panel reads as "this one has no data right now", which every panel
 *     already knows how to look like — not as an alarm. The route boundary
 *     remains for genuine, all-of-it failures.
 *
 * Why a class: function components cannot catch render errors; only
 * `static getDerivedStateFromError` can. This is the same pattern as
 * RouteBoundary, one level down, with the reload machinery traded for a
 * data-driven reset (reloads belong to chunk failures, not data failures).
 */
export default class SectionGuard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    /* A crashing sheet could leave the body scroll-locked behind it. */
    releaseAllScrollLocks();
    /* Let the caller react — e.g. close the modal whose content just died. */
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps) {
    /*
     * THE SELF-HEAL. `resetKey` is the caller's cheapest expression of "the
     * data below me changed" (a poll timestamp, the selected coin id…). When
     * it moves while an error is showing, retry the children: the bad input
     * has almost certainly been replaced. Without this, a transient glitch
     * would hide the panel for the rest of the session — only cosmetically
     * better than the full-page crash this file exists to replace.
     */
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}
