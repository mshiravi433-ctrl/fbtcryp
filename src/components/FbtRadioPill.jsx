import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFbtRadioStore } from '../store/useFbtRadioStore';
import { pause, play } from '../lib/fbtRadioEngine';
import '../styles/fbt-radio-pill.css';

/**
 * FBT LIVE RADIO — the corner pill.
 * ---------------------------------------------------------------------------
 * The station lives outside React, so it keeps playing when the reader leaves
 * the News screen. That is only acceptable if there is always a way back to
 * the controls: a voice coming out of a phone with no visible owner is the
 * exact complaint that created `RadioDock` for podcasts.
 *
 * Hidden on the radio tab itself (the box is right there, and two transports
 * for one stream on one screen is noise), Persian-only for the same reason the
 * box is — the programme is in Persian.
 */
export default function FbtRadioPill() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const started = useFbtRadioStore((s) => s.started);
  const playing = useFbtRadioStore((s) => s.playing);
  const hidden = useFbtRadioStore((s) => s.pillHidden);
  const patch = useFbtRadioStore((s) => s.patch);

  const isFa = String(i18n.language || 'fa').toLowerCase().startsWith('fa');
  const onRadioTab =
    location.pathname.startsWith('/news') &&
    new URLSearchParams(location.search).get('tab') === 'listen';

  if (!isFa || !started || hidden || onRadioTab) return null;

  return (
    <AnimatePresence>
      <motion.div
        className={`fbr-pill ${playing ? 'is-live' : ''}`}
        dir="rtl"
        initial={{ opacity: 0, y: 12, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      >
        <button
          type="button"
          onClick={() => navigate('/news?tab=listen')}
          title="باز کردن رادیو اف‌بی‌تی"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: 0,
            background: 'none',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
            padding: 0
          }}
        >
          <span className="fbr-pill-dot" aria-hidden="true" />
          <span className="fbr-pill-eq" aria-hidden="true">
            <i style={{ animationDelay: '-0.2s' }} />
            <i style={{ animationDelay: '-0.5s' }} />
            <i style={{ animationDelay: '-0.35s' }} />
          </span>
          <span>رادیو اف‌بی‌تی</span>
        </button>

        <button
          type="button"
          className="fbr-pill-close"
          aria-label={playing ? 'توقف رادیو' : 'پخش رادیو'}
          onClick={() => (playing ? pause() : play())}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <button
          type="button"
          className="fbr-pill-close"
          aria-label="بستن پخش‌کن"
          onClick={() => {
            pause();
            patch({ pillHidden: true });
          }}
        >
          ✕
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
