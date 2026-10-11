/**
 * FBT NEURAL CORE — the signature AI emblem for Intent OS.
 * ---------------------------------------------------------------------------
 * A lightweight, GPU-friendly SVG mark: a central energy nucleus, thin orbital
 * rings and a few drifting particles. Three honest states, driven only by real
 * props from the parent (never invented):
 *
 *   idle       — slow breathing glow while nothing is running.
 *   processing — faster orbital sweep while an AI request is in flight.
 *   warn       — amber/red tint when a service failure is observed.
 *   offline    — dimmed, monochrome, when the server is unreachable.
 *
 * Accessibility: all motion is CSS keyframes on transform/opacity (compositor
 * only), and `prefers-reduced-motion` freezes every orbit. The SVG is
 * aria-hidden; the parent owns the accessible status text.
 */
import { memo } from 'react';

const CORE_STATE = Object.freeze({
  idle: 'idle',
  processing: 'processing',
  warn: 'warn',
  offline: 'offline'
});

export function resolveCoreState({ thinkingState, serverReachable, hasError } = {}) {
  if (hasError === true) return CORE_STATE.warn;
  if (serverReachable === false) return CORE_STATE.offline;
  if (thinkingState && thinkingState !== 'idle') return CORE_STATE.processing;
  return CORE_STATE.idle;
}

const NeuralCore = memo(function NeuralCore({
  state = 'idle',
  size = 40,
  label = 'FBT Neural Core'
}) {
  const s = CORE_STATE[state] || CORE_STATE.idle;
  return (
    <span
      className="fbt-core"
      data-state={s}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id="fbtCoreNucleus" cx="50%" cy="50%" r="50%">
            <stop offset="0%" className="fbt-core-stop-hot" />
            <stop offset="55%" className="fbt-core-stop-mid" />
            <stop offset="100%" className="fbt-core-stop-cold" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fbtCoreRing" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0" className="fbt-core-stop-a" />
            <stop offset="0.55" className="fbt-core-stop-b" />
            <stop offset="1" className="fbt-core-stop-c" />
          </linearGradient>
        </defs>

        {/* ambient halo */}
        <circle cx="24" cy="24" r="21" className="fbt-core-halo" />

        {/* outer orbit — slow */}
        <g className="fbt-core-orbit fbt-core-orbit-outer">
          <ellipse cx="24" cy="24" rx="20" ry="8.5" className="fbt-core-ring" />
          <circle cx="43.2" cy="26.5" r="1.6" className="fbt-core-particle" />
        </g>

        {/* middle orbit — counter-rotating */}
        <g className="fbt-core-orbit fbt-core-orbit-mid">
          <ellipse cx="24" cy="24" rx="15.5" ry="15.5" className="fbt-core-ring fbt-core-ring-faint" />
          <circle cx="24" cy="8.5" r="1.3" className="fbt-core-particle" />
          <circle cx="11" cy="32.5" r="1" className="fbt-core-particle fbt-core-particle-dim" />
        </g>

        {/* inner orbit — fast sweep while processing */}
        <g className="fbt-core-orbit fbt-core-orbit-inner">
          <ellipse cx="24" cy="24" rx="11" ry="11" className="fbt-core-ring" strokeDasharray="42 27" />
          <circle cx="34" cy="17.5" r="1.4" className="fbt-core-particle" />
        </g>

        {/* nucleus */}
        <circle cx="24" cy="24" r="9.5" fill="url(#fbtCoreNucleus)" className="fbt-core-nucleus-glow" />
        <path
          d="M24 17.2c0 3.7-3 6.8-6.8 6.8 3.8 0 6.8 3 6.8 6.8 0-3.8 3-6.8 6.8-6.8-3.8 0-6.8-3.1-6.8-6.8Z"
          className="fbt-core-spark"
        />
        <circle cx="24" cy="24" r="1.7" className="fbt-core-nucleus-dot" />
      </svg>
    </span>
  );
});

export default NeuralCore;
