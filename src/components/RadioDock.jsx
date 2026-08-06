import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AudioPlayer from './AudioPlayer';
import { useRadioStore } from '../store/useRadioStore';

/**
 * THE RADIO, MOUNTED ABOVE THE ROUTER.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED FOR ─────────────────────────────────────────────────────
 *   «امکان پخش در پس‌زمینه داشته باشد، مثلا وقتی پادکست را می‌زنی و می‌روی به
 *    صفحه سواپ، با یک ایکون جعبه‌ای ریز در کنار صفحه به عنوان هشدار باشد که
 *    وقتی روش می‌زنی پلیر باز شود تا قطع کنی»
 *
 * Two things: keep playing when you navigate away, and leave a small marker at
 * the edge of the screen that reopens the transport so it can be stopped.
 *
 * ─── WHY THIS COMPONENT HAS TO SIT WHERE IT DOES ────────────────────────────
 * It is rendered in `App.jsx` OUTSIDE `<AnimatePresence>`, and that placement
 * is the entire feature. Every route is unmounted on navigation, so an
 * `<audio>` element owned by a page is destroyed on navigation — the audio
 * stopping was not a missing feature, it was the component tree working
 * correctly. Nothing inside the router can survive the router.
 *
 * ─── COLLAPSED AWAY FROM NEWS, FULL ON NEWS ─────────────────────────────────
 * On /news the reader is looking at the episode list, so the full transport
 * belongs on screen. Anywhere else the audio is background: a full-width bar
 * pinned over the swap form would be an obstruction, and the request was
 * explicitly for «یک ایکون جعبه‌ای ریز» — a small box at the edge.
 *
 * So the same playback, two presentations, and the route decides which. The
 * `<audio>` element never unmounts between them because `AudioPlayer` is
 * rendered either way — only its wrapper's CSS class changes. Unmounting it to
 * switch presentation would stop the audio, which is the bug.
 */
export default function RadioDock() {
  const { t } = useTranslation();
  const location = useLocation();

  const track = useRadioStore((s) => s.track);
  const playing = useRadioStore((s) => s.playing);
  const queue = useRadioStore((s) => s.queue);
  const setTrack = useRadioStore((s) => s.setTrack);
  const setPlaying = useRadioStore((s) => s.setPlaying);
  const stop = useRadioStore((s) => s.stop);

  /* Expanded by hand overrides the route rule, so the pill can open a full
     transport on the swap screen and then be dismissed back to a pill. */
  const [expanded, setExpanded] = useState(false);

  const onNews = location.pathname.startsWith('/news');

  /*
   * Leaving News collapses back to the pill.
   *
   * Without this, walking News → Swap would carry the full bar along and park
   * it over the swap form — the obstruction this design exists to avoid. The
   * user can still reopen it with one tap.
   */
  useEffect(() => {
    if (!onNews) setExpanded(false);
  }, [onNews, location.pathname]);

  if (!track) return null;

  const showFull = onNews || expanded;

  return (
    <>
      {/*
        ONE AudioPlayer, always mounted while a track is selected.

        The wrapper is hidden with CSS rather than conditionally rendered.
        Unmounting the player to show the pill would destroy the <audio>
        element and stop playback — the exact bug being fixed. `visibility`
        and `pointer-events`, not `display: none`: some mobile browsers treat
        a display:none media element as detached and suspend it.
      */}
      <div className={`radio-dock ${showFull ? '' : 'is-tucked'}`} aria-hidden={!showFull}>
        <AudioPlayer
          track={track}
          queue={queue}
          onTrack={setTrack}
          onPlayingChange={setPlaying}
          onClose={stop}
        />
      </div>

      <AnimatePresence>
        {!showFull && (
          <motion.button
            className="radio-pill"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            onClick={() => setExpanded(true)}
            /* The label says what tapping DOES, because the icon alone cannot:
               a speaker glyph reads as "mute" to about half of people. */
            aria-label={t('radio.dockOpen')}
            title={track.title}
          >
            {/*
              Animated bars while playing, static while paused. This is the
              only state indicator the pill has, and it has to be readable at
              a glance from the corner of the eye — a colour change alone
              would not survive being 22 pixels wide.
            */}
            <span className={`radio-pill-eq ${playing ? 'is-live' : ''}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
