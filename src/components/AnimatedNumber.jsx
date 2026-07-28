import { useEffect, useRef, useState } from 'react';

/**
 * Tweens between values instead of snapping, and flashes green/red on change.
 * `format` receives the interpolated number.
 */
export default function AnimatedNumber({
  value,
  format = (v) => v.toFixed(2),
  duration = 600,
  flash = true,
  className = ''
}) {
  const [display, setDisplay] = useState(Number(value) || 0);
  const [dir, setDir] = useState(null);
  const fromRef = useRef(Number(value) || 0);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) return undefined;

    let flashTimer;
    if (flash) {
      setDir(to > from ? 'up' : 'down');
      flashTimer = setTimeout(() => setDir(null), 700);
    }

    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
    };
  }, [value, duration, flash]);

  return (
    <span
      className={`mono ${className}`}
      style={{
        color: dir === 'up' ? 'var(--up)' : dir === 'down' ? 'var(--down)' : undefined,
        transition: 'color 0.45s ease'
      }}
    >
      {format(display)}
    </span>
  );
}
