import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { IconX } from './Icons';

/**
 * Centered modal dialog.
 *
 * Was a bottom sheet, but on tall phones that pinned content to the very
 * bottom edge and looked cramped. A centered dialog reads better and keeps the
 * primary action near the thumb without hugging the screen edge.
 */
export default function Sheet({ open, onClose, children, title }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <div className="sheet-layer">
            <motion.div
              className="sheet"
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              {title && (
                <div className="sheet-title">
                  <h2 className="h2" style={{ margin: 0 }}>{title}</h2>
                  <button className="sheet-close" onClick={onClose} aria-label="close" type="button">
                    <IconX width={15} height={15} />
                  </button>
                </div>
              )}
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
