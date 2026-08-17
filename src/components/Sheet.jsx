import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../lib/scrollLock';
import { useStill } from './AnimatedIcon';
import { IconX } from './Icons';

/**
 * Centered modal dialog.
 *
 * WHY THIS RENDERS THROUGH A PORTAL
 * ---------------------------------------------------------------------------
 * It didn't, and that was the bug behind "the swap settings popup isn't
 * centred". Every screen is wrapped in `PageTransition`, which animates
 * `transform` and `filter` on a `<motion.main>`. Per CSS spec, an element with
 * a transform or filter becomes the **containing block for fixed-position
 * descendants** — so `position: fixed; inset: 0` inside a page resolved
 * against the scrolled page box instead of the viewport. The sheet therefore
 * centred itself inside whatever slice of the page happened to be rendered,
 * which on a long screen like Swap put it well below the fold.
 *
 * Portalling to `document.body` moves the sheet out of every transformed
 * ancestor, so `fixed` means fixed and the flex wrapper centres it in the
 * viewport — on every screen, at every scroll position, in both directions.
 *
 * (The same reasoning is why the guide and onboarding stages are never
 * animated: the animated layer and the positioned layer must not be the same
 * element.)
 */
export default function Sheet({ open, onClose, children, title, size = 'md' }) {
  /*
   * prefers-reduced-motion (and the in-app reduce-motion setting): the dialog
   * appears/disappears instantly. A drop shadow that springs is a nicety; for
   * someone with a vestibular condition it is a reason to leave.
   */
  const still = useStill();

  useEffect(() => {
    if (!open) return undefined;
    const unlock = lockBodyScroll();

    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);

    return () => {
      unlock();
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // SSR / test harnesses have no document until mount.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/*
           * The backdrop is a SIBLING of the panel layer, not its parent:
           * clicks inside the panel can therefore never reach the backdrop's
           * onClick. The layer itself is pointer-events:none with the panel
           * re-armed (see index.css), so only a click on genuinely-empty
           * viewport area counts as a dismiss.
           */}
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.18 }}
            onClick={onClose}
          />
          <div className="sheet-layer">
            <motion.div
              className={`sheet sheet-${size}`}
              role="dialog"
              aria-modal="true"
              initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
              transition={still ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
            >
              {title && (
                <div className="sheet-title">
                  <h2 className="h2" style={{ margin: 0 }}>{title}</h2>
                  <button className="sheet-close" onClick={onClose} aria-label="close" type="button">
                    <IconX width={15} height={15} />
                  </button>
                </div>
              )}
              <div className="sheet-body">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
