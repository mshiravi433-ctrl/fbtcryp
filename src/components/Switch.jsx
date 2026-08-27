import { motion } from 'framer-motion';

/**
 * The app's toggle switch.
 *
 * ─── WHY THIS WAS EXTRACTED ─────────────────────────────────────────────────
 * It lived as a private `function Switch` inside Settings.jsx. The moment a
 * second screen needed a toggle — expert mode, mirrored into the swap settings
 * sheet where it actually takes effect — there were two options: copy it, or
 * reach for `<input type="checkbox" className="switch">`.
 *
 * Both are wrong, and the second is wrong in the specific way this repo keeps
 * getting caught by: `.switch` in index.css styles a BUTTON with a `data-on`
 * attribute and an animated `.switch-knob` child. A checkbox carrying the same
 * class name matches the selector, inherits the track, and then renders the
 * browser's native tick INSIDE it with no knob and no on-state — a control
 * that looks broken rather than one that fails loudly. That is the same class
 * of bug as the invented `className="seg"` that shipped once already.
 *
 * ─── THE RTL DETAIL THAT IS EASY TO LOSE IN A COPY ──────────────────────────
 * The knob is positioned with `inset-inline-start`, which flips sides in RTL,
 * but `x` is a physical transform that always moves right. In Persian the knob
 * therefore starts at the right edge and slides further right, out of the
 * track. Travel has to follow the writing direction — which is exactly the
 * kind of correction that gets dropped when a component is duplicated by hand.
 */
export default function Switch({ on, onChange, label, disabled = false }) {
  const rtl = typeof document !== 'undefined'
    && document.documentElement.getAttribute('dir') === 'rtl';
  const travel = rtl ? -19 : 19;

  return (
    <button
      className="switch"
      data-on={Boolean(on)}
      onClick={onChange}
      disabled={disabled}
      type="button"
      role="switch"
      aria-checked={Boolean(on)}
      aria-label={label}
    >
      <motion.span
        className="switch-knob"
        animate={{ x: on ? travel : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}
