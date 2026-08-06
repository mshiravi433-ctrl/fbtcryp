import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { IconCheck } from './Icons';
import { useTelegram } from '../context/TelegramContext';

/**
 * "YOUR MONEY ARRIVED" — centred, themed, and impossible to miss.
 * ---------------------------------------------------------------------------
 * Requested: «در گوشی دریافت کننده پاپ اپی نشان بدهد که چه مقدار و چه نوع
 * دریافت شده با تم درست و وسط صفحه باشد».
 *
 * ─── WHY NOT A TOAST ────────────────────────────────────────────────────────
 * This app already has a toast host, and it was the wrong tool. A toast slides
 * in at the top edge, is deliberately small, and disappears on a timer whether
 * or not anyone looked. Receiving money in person is the one moment in the
 * whole app where the user is watching the screen and waiting for exactly one
 * piece of information — and where being unsure is actively harmful, because
 * the two people are standing in front of each other deciding whether the
 * payment worked.
 *
 * So: centre of the screen, dimmed backdrop, and it stays until dismissed.
 *
 * ─── WHY IT DOES NOT AUTO-DISMISS ───────────────────────────────────────────
 * A timer would be a small convenience and a real hazard: the receiver could
 * be putting their phone down or handing over goods at the moment it vanishes,
 * and then has no confirmation at all. It closes when a person closes it.
 *
 * ─── THEME ──────────────────────────────────────────────────────────────────
 * Everything is a CSS variable — `--bg-panel-solid`, `--line-strong`,
 * `--rgb-4`. Hard-coding a dark panel here is exactly how the light theme gets
 * broken by a component nobody re-tested, which has already happened once in
 * this repo with the ad banner's gradient stops.
 */
export default function ArrivalPopup({ open, amount, symbol, onClose }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();

  /*
   * A success haptic the instant it appears. The receiver may be looking at
   * the other person rather than the screen, and a buzz is the fastest way to
   * say "check your phone".
   */
  useEffect(() => {
    if (open) haptic?.('success');
  }, [open, haptic]);

  /* Escape closes it, like every other dismissible surface in the app. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="arrival-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            className="arrival-card"
            /*
              Scale from slightly small, NOT from zero. A 0→1 scale reads as a
              cartoon pop; 0.92→1 reads as the card stepping forward. The y
              offset is deliberately absent — see the note in index.css about
              transform-based centring being broken by Motion writing its own
              transform, which has bitten this codebase twice.
            */
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="arrival-tick">
              <IconCheck width={30} height={30} />
            </div>

            <div className="arrival-label">{t('tap.received')}</div>

            {/*
              The amount is the whole point of this popup, so it is the largest
              thing on it. `mono` because digits must not shift width — a
              proportional font makes a changing figure jitter.
            */}
            <div className="arrival-amount mono">
              {amount} <span className="arrival-symbol">{symbol}</span>
            </div>

            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onClose}>
              {t('common.done')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
