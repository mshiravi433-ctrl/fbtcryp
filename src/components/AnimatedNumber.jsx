import { useEffect, useRef, useState } from 'react';
import { useStill } from './AnimatedIcon';

/**
 * Tweens between values instead of snapping, and optionally flashes green/red
 * on change. `format` receives the interpolated number.
 *
 * Initial hydration (`0 -> first real number`) and reduced-motion (`useStill`)
 * commit immediately so the first paint never counts up from zero or flashes.
 */
export default function AnimatedNumber({
  value,
  format = (v) => v.toFixed(2),
  duration = 520,
  flash = true,
  className = ''
}) {
  const still = useStill();
  const numericValue = Number(value) || 0;
  const [display, setDisplay] = useState(numericValue);
  const [dir, setDir] = useState(null);
  const fromRef = useRef(numericValue);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) return undefined;

    /* Initial hydration from 0 or reduced-motion: commit in one frame with
       zero rAF loop and zero colour flash. */
    if (still || duration <= 0 || (from === 0 && to !== 0)) {
      fromRef.current = to;
      setDisplay(to);
      setDir(null);
      return undefined;
    }

    let flashTimer;
    if (flash) {
      setDir(to > from ? 'up' : 'down');
      flashTimer = setTimeout(() => setDir(null), 650);
    }

    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
    };
  }, [value, duration, flash, still]);

  return (
    <span
      className={`mono ${className}`}
      style={{
        fontVariantNumeric: 'tabular-nums',
        color: dir === 'up' ? 'var(--up)' : dir === 'down' ? 'var(--down)' : undefined,
        transition: flash ? 'color 0.4s ease' : undefined
      }}
    >
      {format(display)}
    </span>
  );
}
