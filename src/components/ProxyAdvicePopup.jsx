import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useStill } from './AnimatedIcon';
import { useTelegram } from '../context/TelegramContext';
import { lockBodyScroll } from '../lib/scrollLock';
import '../styles/proxy-advice.css';

/**
 * «بسیاری از امکانات ما روی بستر خارج است — بهتر است با پروکسی وارد شوید»
 * ---------------------------------------------------------------------------
 * Shown on the language screen the moment Persian is chosen, because that is
 * the point at which the advice can still help: before the first quote, the
 * first bridge and the first AI answer time out against an unreachable host,
 * which is indistinguishable from «برنامه خراب است».
 *
 * WHY IT IS AN ALERT AND NOT A LINE OF TEXT
 *   A sentence under the language list is read by nobody — it is chrome next
 *   to the one control the user came to use. And this is the single piece of
 *   advice that decides whether the app appears to work at all on a filtered
 *   connection, so it gets a modal: one message, one action, dismissed by the
 *   person who has read it.
 *
 * WHY IT SAYS «پروکسی/فیلترشکن» AND NOT «VPN»
 *   Everyone in this market knows the word «فیلترشکن»; a Persian speaker who
 *   has never configured a proxy still knows what to do with it. Naming both
 *   is the difference between advice and jargon.
 *
 * WHY IT DOES NOT BLOCK ANYTHING
 *   There is no continue-gate behind it and no timer: it is advice, not a
 *   permission. The language choice is already made and kept; closing this
 *   changes nothing about the flow.
 *
 * It renders through a PORTAL for the same reason Sheet does: the welcome
 * stage is inside animated, transformed layers, and a `position: fixed` child
 * of a transformed ancestor is positioned against that ancestor instead of
 * the viewport — the popup would land wherever the animation happened to be.
 */
export default function ProxyAdvicePopup({ open, onClose }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const still = useStill();

  /* A light tap when it appears: the popup is the only thing on screen that
     has changed, and on a phone the user may be looking elsewhere. */
  useEffect(() => {
    if (open) haptic?.('light');
  }, [open, haptic]);

  useEffect(() => {
    if (!open) return undefined;
    const unlock = lockBodyScroll();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="proxyadv-layer" role="presentation">
          <motion.div
            className="proxyadv-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="proxyadv-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="proxyadv-title"
            aria-describedby="proxyadv-body"
            initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={still ? { duration: 0.12 } : { type: 'spring', stiffness: 320, damping: 26 }}
            /* A tap inside the card is not a tap on the backdrop. */
            onClick={(e) => e.stopPropagation()}
          >
            <div className="proxyadv-mark" aria-hidden="true">
              <ShieldAlert />
            </div>

            <h2 className="proxyadv-title" id="proxyadv-title">
              {t('welcome.proxy.title')}
            </h2>

            <p className="proxyadv-body" id="proxyadv-body">
              {t('welcome.proxy.body')}
            </p>

            <p className="proxyadv-note">{t('welcome.proxy.note')}</p>

            <button type="button" className="btn btn-primary proxyadv-cta" onClick={onClose}>
              {t('welcome.proxy.cta')}
            </button>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/** A shield with an exclamation — a warning, not a failure. */
function ShieldAlert() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5.5L12 2 4 5.5V12c0 6 8 10 8 10z" />
      <path d="M12 8.5v4.2" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}
