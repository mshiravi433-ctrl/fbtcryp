import { useId } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * ANIMATED SVG FLAME
 * ---------------------------------------------------------------------------
 * Replaces the 🔥 emoji in the "most profitable" highlight reel with a small
 * SVG flame whose layers flicker and breathe. The motion is transform-only
 * (scale / rotate / translate on the flame layers plus opacity on the spark),
 * so it never repaints the card or the carousel — the highlight reel keeps
 * scrolling at full speed while the flame moves.
 *
 * Motion is stopped when the user asks for reduced motion, matching the
 * pattern used by the other animated icons in the app.
 */
export default function FlameIcon({ size = 20, className = '', label, showSpark = true }) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const outerId = `flame-ever-outer-${rawId}`;
  const innerId = `flame-ever-inner-${rawId}`;

  const systemReduced = useReducedMotion();
  const appReduced = useSettingsStore((s) => s.reduceMotion);
  const still = Boolean(systemReduced || appReduced);

  return (
    <svg
      className={`flame-svg ${still ? 'is-still' : 'is-live'} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <defs>
        <linearGradient id={outerId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd166" />
          <stop offset="54%" stopColor="#ff8b22" />
          <stop offset="100%" stopColor="#e23a0e" />
        </linearGradient>
        <linearGradient id={innerId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff7bf" />
          <stop offset="55%" stopColor="#ffd34d" />
          <stop offset="100%" stopColor="#ff9b16" />
        </linearGradient>
      </defs>

      {/* Outer flame — the biggest movement, sways around the base. */}
      <path
        className="flame-layer flame-layer-outer"
        d="M12 2.6C13.5 5.6 16.5 6.9 17.4 10.7C18.3 14.4 16.5 18.6 12 20.2C7.5 18.6 5.7 14.4 6.6 10.7C7.5 6.9 10.5 5.6 12 2.6Z"
        fill={`url(#${outerId})`}
      />

      {/* Inner flame — warmer colour, slightly faster counter-sway. */}
      <path
        className="flame-layer flame-layer-inner"
        d="M12 7.9C13.1 9.9 15 10.8 15.5 13.4C16 16.1 14.4 18.2 12 19.1C9.6 18.2 8 16.1 8.5 13.4C9 10.8 10.9 9.9 12 7.9Z"
        fill={`url(#${innerId})`}
      />

      {/* Core — the brightest part, breathes a little. */}
      <path
        className="flame-layer flame-layer-core"
        d="M12 12.1C12.8 13.2 13.9 13.8 14 15.3C14.1 16.8 13.2 17.9 12 18.3C10.8 17.9 9.9 16.8 10 15.3C10.1 13.8 11.2 13.2 12 12.1Z"
        fill="#fff8cf"
      />

      {/* Rising spark — reads as the flame "moving", with no layout cost. */}
      {showSpark && (
        <circle
          className="flame-spark"
          cx="13.4"
          cy="6.5"
          r="1.05"
          fill="#ffd166"
        />
      )}
    </svg>
  );
}
