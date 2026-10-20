/**
 * BUSINESS CONSOLE — THE ANIMATED EMBLEM
 * -------------------------------------------------------------------------
 * The hero of ‎/business needed a signature mark the way ‎/p2p has
 * `P2PHeroMark`: something that reads as "this is a real product surface",
 * not "another settings page with a title".
 *
 * ─── WHY CSS AND NOT JAVASCRIPT ──────────────────────────────────────────
 * Every moving part here is a CSS keyframe on `transform` (plus one on
 * `stroke-dashoffset`). No React state, no `requestAnimationFrame`, no
 * re-render on any frame. A JS-driven loop on this page would share the main
 * thread with the network registry read and the mount animation, and the
 * cost would show up as scroll jank — which is the exact failure the P2P mark
 * was written to avoid.
 *
 * ─── WHY NOTHING BLINKS ──────────────────────────────────────────────────
 * A mark that fades to zero and back reads as a loading placeholder, and at
 * 60fps for minutes it reads as a hardware fault. So: no keyframe touches
 * `opacity` from 0 to 1, the breathing halo stays between .28 and .62, and
 * every loop starts and ends on the same frame — there is no visible seam
 * when the animation restarts.
 *
 * ─── DIRECTION ───────────────────────────────────────────────────────────
 * The rings orbit clockwise and the orbit arms counter-clockwise, so the mark
 * has depth without a 3D transform (which would cost a layer per frame on
 * low-end Android). Decorative: `aria-hidden`, and the accessible name of the
 * hero comes from the heading text, not from here.
 */

import { IconBriefcase } from '../Icons';

export default function BusinessOrbMark({ size = 148 }) {
  return (
    <div className="bizmark" style={{ '--mark-size': `${size}px` }} aria-hidden="true">
      <span className="bizmark-halo" />
      <span className="bizmark-ring bizmark-ring--outer" />
      <span className="bizmark-ring bizmark-ring--inner" />
      <span className="bizmark-orbit">
        <span className="bizmark-node bizmark-node--a" />
      </span>
      <span className="bizmark-orbit bizmark-orbit--slow">
        <span className="bizmark-node bizmark-node--b" />
      </span>
      <span className="bizmark-core">
        <IconBriefcase width={30} height={30} />
      </span>
      <span className="bizmark-bars">
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
