import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import '../styles/decision-orb.css';

/**
 * ─── DECISION ORB ─────────────────────────────────────────────────────────
 * A small circular FAB pinned to the SIDE of the screen. Tapping it expands
 * into a minimal panel: a donut chart with three colored segments and a
 * legend of the three things the brief asked for —
 *
 *     • ریسک پذیری  (risk tolerance)
 *     • خرید        (buy)
 *     • فروش        (sell)
 *
 * — each shown with its color and its percentage, à la the reference image.
 * Left untouched for 60 seconds it fades back down into the small circle.
 *
 * ─── EDITING THE NUMBERS ──────────────────────────────────────────────────
 * Every figure lives in `SEGMENTS` below. Change `value` (they need not sum
 * to 100 — the component normalises) and `color`; nothing else has to move.
 * To drive it from real data later, pass `segments={...}` as a prop.
 * ──────────────────────────────────────────────────────────────────────────
 */

const IDLE_MS = 60_000; // collapse back to the small circle after this long
const GAP_PCT = 0.9; // transparent seam between donut segments, in % of circle

const DEFAULT_SEGMENTS = [
  { key: 'risk', label: 'ریسک پذیری', value: 40, color: '#ffb020' },
  { key: 'buy', label: 'خرید', value: 35, color: '#1fd97a' },
  { key: 'sell', label: 'فروش', value: 25, color: '#ff4d6d' }
];

/** Build a conic-gradient string from the segments, with thin transparent seams. */
function buildConic(segments, total) {
  const stops = [];
  let acc = 0;
  segments.forEach((s) => {
    const start = (acc / total) * 100;
    acc += s.value;
    const end = (acc / total) * 100;
    const gap = Math.min(GAP_PCT, (end - start) / 2);
    stops.push(
      `transparent ${start.toFixed(2)}% ${(start + gap).toFixed(2)}%`,
      `${s.color} ${(start + gap).toFixed(2)}% ${(end - gap).toFixed(2)}%`,
      `transparent ${(end - gap).toFixed(2)}% ${end.toFixed(2)}%`
    );
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export default function DecisionOrb({ segments: segmentsProp }) {
  const segments = segmentsProp && segmentsProp.length ? segmentsProp : DEFAULT_SEGMENTS;
  const total = useMemo(
    () => segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1,
    [segments]
  );
  const conic = useMemo(() => buildConic(segments, total), [segments, total]);

  // The segment that owns the donut's centre label — the largest slice.
  const focus = useMemo(
    () => [...segments].sort((a, b) => b.value - a.value)[0],
    [segments]
  );

  const [open, setOpen] = useState(false);
  const idleTimer = useRef(null);
  const rootRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // ─── the 60-second auto-collapse ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined;
    idleTimer.current = setTimeout(() => setOpen(false), IDLE_MS);
    return () => clearTimeout(idleTimer.current);
  }, [open]);

  // ─── dismiss on outside tap / Escape ─────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // defer so the opening click itself doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Pause the idle countdown while the tab is hidden, so it doesn't expire
  // unseen in the background.
  useEffect(() => {
    if (!open) return undefined;
    const onVis = () => {
      if (document.hidden) {
        clearTimeout(idleTimer.current);
      } else {
        idleTimer.current = setTimeout(() => setOpen(false), IDLE_MS);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [open]);

  return (
    <div className="dor" ref={rootRef} dir="rtl">
      <AnimatePresence>
        {open ? (
          <motion.div
            key="panel"
            className="dor-panel"
            role="dialog"
            aria-label="ترکیب معاملات"
            initial={{ opacity: 0, scale: 0.82, x: 14 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.82, x: 14 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            {/* depleting line — the panel's "will close on its own" affordance */}
            <motion.span
              className="dor-clock"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: IDLE_MS / 1000, ease: 'linear' }}
            />

            <div className="dor-head">
              <span className="dor-title">ترکیب معاملات</span>
              <button
                type="button"
                className="dor-x"
                aria-label="بستن"
                onClick={close}
              >
                ✕
              </button>
            </div>

            <div className="dor-chart">
              <div className="dor-donut" style={{ backgroundImage: conic }}>
                <div className="dor-hole">
                  <span className="dor-hole-val">{Math.round((focus.value / total) * 100)}%</span>
                  <span className="dor-hole-label">{focus.label}</span>
                </div>
              </div>
            </div>

            <ul className="dor-legend">
              {segments.map((s) => (
                <li key={s.key} className="dor-row">
                  <span className="dor-dot" style={{ background: s.color }} />
                  <span className="dor-row-label">{s.label}</span>
                  <span className="dor-row-pct">
                    {Math.round((s.value / total) * 100)}%
                  </span>
                </li>
              ))}
            </ul>

            <div className="dor-foot">بعد از ۶۰ ثانیه به‌صورت خودکار بسته می‌شود</div>
          </motion.div>
        ) : (
          <motion.button
            key="orb"
            type="button"
            className="dor-orb"
            aria-label="باز کردن ترکیب معاملات"
            onClick={toggle}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            style={{ backgroundImage: conic }}
          >
            <span className="dor-orb-ring" aria-hidden="true" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
