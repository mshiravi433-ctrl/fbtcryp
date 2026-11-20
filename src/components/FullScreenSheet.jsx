import { AnimatePresence, motion } from 'framer-motion';
import { useContext, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../lib/scrollLock';
import { OverlayDepthContext } from './OverlayDepthContext';
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
 *      that stays put by default. A caller may fade it while an equivalent
 *      inline action row is visible, avoiding duplicate controls at the end.
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
  headerAction,
  manageFocus = false,
  footer,
  footerVisible = true,
  children,
  className = '',
  testId,
  closeLabel = 'close'
}) {
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const still = useStill();
  const overlayDepth = useContext(OverlayDepthContext) + 1;

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

  useEffect(() => {
    if (!open || !manageFocus) return;
    const panel = panelRef.current;
    const trigger = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    const onTab = (event) => {
      if (event.key !== 'Tab' || !panel) return;
      const controls = Array.from(panel.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'))
        .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!panel.contains(document.activeElement) || document.activeElement === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onTab);
    return () => {
      window.removeEventListener('keydown', onTab);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open, manageFocus]);

  // SSR / test harnesses have no document until mount.
  if (typeof document === 'undefined') return null;

  return (
    <OverlayDepthContext.Provider value={overlayDepth}>
      {createPortal(
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
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
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
                {title ? <h2 id={titleId} className="fsh-title" dir="auto">{title}</h2> : null}
                {subtitle ? <p className="fsh-sub" dir="auto">{subtitle}</p> : null}
              </div>
              {headerAction}
              <button
                type="button"
                ref={closeRef}
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

            {footer ? (
              <footer
                className={`fsh-foot${footerVisible ? '' : ' is-hidden'}`}
                aria-hidden={footerVisible ? undefined : 'true'}
                inert={footerVisible ? undefined : 'true'}
                data-footer-visible={footerVisible}
                data-testid={testId ? `${testId}-footer` : undefined}
              >
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
      )}
    </OverlayDepthContext.Provider>
  );
}
