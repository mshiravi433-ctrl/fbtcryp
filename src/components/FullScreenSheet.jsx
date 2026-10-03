import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../lib/scrollLock';
import { useStill } from './AnimatedIcon';
import { IconX } from './Icons';
import '../styles/fullscreen-sheet.css';

/**
 * FULL-SCREEN SHEET — the app's "this deserves the whole screen" surface.
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS, AND WHY NOT JUST A BIGGER `Sheet`
 *
 * `Sheet` is a centred dialog: 440px (560 at `lg`), a title bar, and a body.
 * That is right for a confirmation and wrong for a page of analysis — a token's
 * specification, a pool's analytics, a position's review. Those are read, not
 * acknowledged, and on a phone the difference between a 440px card and the
 * viewport is the difference between scrolling a postage stamp and reading a
 * page.
 *
 * It is a SEPARATE component rather than another `size` because the contract
 * differs in three ways that would otherwise leak into every caller:
 *
 *   1. It is PORTALED to `document.body` (like `Sheet`, for the same reason:
 *      PageTransition animates a transform, and a transformed ancestor becomes
 *      the containing block for `position: fixed` — a full-screen panel
 *      rendered in place would be full-PAGE, not full-viewport).
 *   2. It owns the safe areas (`env(safe-area-inset-*)`), so the header clears
 *      a notch and the footer clears the home indicator — a "full screen" panel
 *      that tucks its close button under the status bar is a trap.
 *   3. It has a HEADER, a BODY that scrolls on its own, and an optional FOOTER
 *      that stays put. Nothing in it moves except the content between them.
 *
 * Reduced motion (the OS preference and the in-app setting, via `useStill`) is
 * honoured: the panel appears instead of sliding.
 */
export default function FullScreenSheet({
  open,
  onClose,
  kicker,
  title,
  subtitle,
  icon,
  hero,
  footer,
  children,
  className = '',
  testId,
  closeLabel = 'close'
}) {
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
          <motion.div
            className="fsh-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className={`fsh-panel ${className}`.trim()}
            role="dialog"
            aria-modal="true"
            data-testid={testId}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 26 }}
            animate={still ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: 18 }}
            transition={still ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
          >
            <span className="fsh-aurora" aria-hidden="true" />

            <header className="fsh-head">
              {icon ? <span className="fsh-head-icon" aria-hidden="true">{icon}</span> : null}
              <div className="fsh-head-copy">
                {kicker ? <p className="fsh-kicker">{kicker}</p> : null}
                {title ? <h2 className="fsh-title">{title}</h2> : null}
                {subtitle ? <p className="fsh-sub">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                className="fsh-close"
                onClick={onClose}
                aria-label={closeLabel}
                data-testid={testId ? `${testId}-close` : undefined}
              >
                <IconX width={16} height={16} />
              </button>
            </header>

            {hero ? <div className="fsh-hero">{hero}</div> : null}

            <div className="fsh-body">{children}</div>

            {footer ? <footer className="fsh-foot">{footer}</footer> : null}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
