import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fmtDuration } from '../lib/audio';

/**
 * THE RADIO PLAYER — a real transport, not a play button.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED FOR ─────────────────────────────────────────────────────
 *   «mp player نداره تا بشه کنترلش کرد میخام mp player بسیار زیبا و مدرن باشد
 *    ... و در دو تم هم پویا باشد»
 *
 * The old radio had one button per row: play, or pause. Once something was
 * playing there was no way to seek, no way to know how far in you were, no way
 * to skip to the next episode, and no way to change the volume — and, worst of
 * all, the controls scrolled away with the row, so the only way to stop a
 * forty-minute episode was to find the row again.
 *
 * ─── WHY IT IS A DOCKED BAR AND NOT AN EXPANDED ROW ─────────────────────────
 * Playing is a property of the SESSION, not of a list item. Once you have
 * started an episode you keep browsing headlines, and the transport has to
 * come with you. A bar pinned above the bottom navigation is the shape every
 * audio app converged on for that reason, and it is the only shape where
 * "stop this" is always one tap away.
 *
 * It sits ABOVE the nav rather than replacing it, because taking the
 * navigation away to play a podcast would be a strictly worse trade.
 *
 * ─── PROGRESS IS A rAF LOOP, NOT `timeupdate` ───────────────────────────────
 * `timeupdate` fires about four times a second, and irregularly. A bar driven
 * by it visibly steps. `requestAnimationFrame` runs at display rate and — this
 * is the part that matters on a phone — is automatically throttled to nothing
 * when the tab is hidden, so a backgrounded episode costs no frames at all.
 * The loop is torn down whenever playback stops, so it never runs over a
 * paused element.
 *
 * ─── BOTH THEMES, AND WHY THAT IS CSS AND NOT PROPS ─────────────────────────
 * Every colour here is a `var(--…)` token. The light theme redefines those
 * tokens, so the player follows automatically and cannot drift out of sync —
 * which is what happens the moment a component hard-codes even one hex value
 * for "the dark case". Asked for as «در دو تم هم پویا باشد».
 */

/** Seek step for the skip buttons. Fifteen seconds is the podcast convention. */
const SKIP = 15;

export default function AudioPlayer({
  track,
  queue = [],
  onTrack,
  onClose
}) {
  const { t } = useTranslation();

  const audio = useRef(null);
  const raf = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [expanded, setExpanded] = useState(false);
  /* While the thumb is held, the bar must follow the FINGER, not the audio. */
  const [scrub, setScrub] = useState(null);

  /* --------------------------- the element ------------------------------- */

  /*
   * One <audio>, created once, reused for every track.
   *
   * Constructing a new element per track leaks the old one in several mobile
   * browsers, and — worse — the previous element keeps buffering, so switching
   * episodes five times leaves five downloads running on a metered connection.
   */
  if (!audio.current && typeof Audio !== 'undefined') {
    audio.current = new Audio();
    audio.current.preload = 'metadata';
  }

  const index = queue.findIndex((it) => it.id === track?.id);
  const next = index >= 0 && index < queue.length - 1 ? queue[index + 1] : null;
  const prev = index > 0 ? queue[index - 1] : null;

  /* Stop and release on unmount — navigating away must not leave audio on. */
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      if (audio.current) {
        audio.current.pause();
        audio.current.src = '';
      }
    },
    []
  );

  const tick = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    setPosition(el.currentTime || 0);
    raf.current = requestAnimationFrame(tick);
  }, []);

  /* Load whenever the track changes. */
  useEffect(() => {
    const el = audio.current;
    if (!el || !track?.audioUrl) return undefined;

    setFailed(false);
    setStalled(true);
    setPosition(0);
    /*
     * Seed the duration from the feed's `itunes:duration` so the bar has a
     * scale BEFORE any bytes arrive. Without it the first second of playback
     * shows a full-width bar that suddenly collapses, which reads as a glitch.
     */
    setDuration(Number.isFinite(track.durationSec) ? track.durationSec : 0);

    el.src = track.audioUrl;
    el.playbackRate = rate;
    el.play()
      .then(() => setPlaying(true))
      .catch(() => {
        /*
         * Autoplay policy, or a CDN refusing a range request. Either way the
         * promise rejects; swallowing it silently would leave a bar that looks
         * pressed and plays nothing.
         */
        setPlaying(false);
        setFailed(true);
      });

    return () => {
      el.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, track?.audioUrl]);

  /* Element events → state. Attached once; the handlers read refs. */
  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;

    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    const onPlay = () => {
      setPlaying(true);
      setStalled(false);
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf.current);
    };
    const onWaiting = () => setStalled(true);
    const onPlayable = () => setStalled(false);
    const onError = () => {
      setPlaying(false);
      setStalled(false);
      setFailed(true);
    };
    /*
     * Auto-advance. A radio that stops dead after one episode is a player;
     * one that rolls into the next is a station. Falls back to simply
     * stopping when this was the last item, rather than looping — looping the
     * same episode forever is a worse surprise than silence.
     */
    const onEnded = () => {
      setPlaying(false);
      if (next) onTrack?.(next);
    };

    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('play', onPlay);
    el.addEventListener('playing', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('canplay', onPlayable);
    el.addEventListener('error', onError);
    el.addEventListener('ended', onEnded);

    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('playing', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('canplay', onPlayable);
      el.removeEventListener('error', onError);
      el.removeEventListener('ended', onEnded);
    };
  }, [next, onTrack, tick]);

  /*
   * ─── LOCK-SCREEN CONTROLS ─────────────────────────────────────────────────
   * The Media Session API puts the title, the show name and working
   * play/pause/skip buttons on the phone's lock screen and in the headphone
   * controls. For news radio — which is listened to with the screen off, by
   * definition — that is the difference between a player and a web page that
   * happens to make noise.
   *
   * Feature-detected, because it does not exist in every browser and touching
   * it unguarded would throw during render on the ones that lack it.
   */
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
    if (!ms || !track) return;
    try {
      ms.metadata = new window.MediaMetadata({
        title: track.title ?? '',
        artist: track.stationName ?? 'FBT Swap',
        album: t('radio.title')
      });
      ms.setActionHandler('play', () => audio.current?.play().catch(() => {}));
      ms.setActionHandler('pause', () => audio.current?.pause());
      ms.setActionHandler('nexttrack', next ? () => onTrack?.(next) : null);
      ms.setActionHandler('previoustrack', prev ? () => onTrack?.(prev) : null);
    } catch {
      /* MediaMetadata missing, or a handler this browser rejects. Cosmetic. */
    }
  }, [track, next, prev, onTrack, t]);

  /* ---------------------------- transport -------------------------------- */

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) el.pause();
    else el.play().catch(() => setFailed(true));
  };

  const seekTo = (seconds) => {
    const el = audio.current;
    if (!el || !Number.isFinite(seconds)) return;
    /*
     * Clamped. Seeking past the end throws in Firefox and silently ends
     * playback in Safari; seeking below zero is rejected outright.
     */
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
    el.currentTime = Math.max(0, Math.min(seconds, max > 0 ? max - 0.25 : seconds));
    setPosition(el.currentTime);
  };

  const cycleRate = () => {
    /*
     * 1 → 1.25 → 1.5 → 2 → 1. No 0.75: nobody slows down a news podcast, and
     * every extra stop is another tap to get back to normal.
     */
    const order = [1, 1.25, 1.5, 2];
    const nextRate = order[(order.indexOf(rate) + 1) % order.length];
    setRate(nextRate);
    if (audio.current) audio.current.playbackRate = nextRate;
  };

  if (!track) return null;

  const shown = scrub ?? position;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  return (
    <motion.div
      className="ap"
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 90, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      role="region"
      aria-label={t('radio.playerLabel')}
    >
      {/*
        The scrubber is the top edge of the bar, full width.

        A native <input type="range"> because it is the only control that is
        keyboard-accessible, screen-reader-labelled and touch-draggable for
        free. It is styled beyond recognition in CSS — a hand-rolled div with
        pointer events would have to reimplement all three and would get at
        least one of them wrong.
      */}
      <input
        className="ap-seek"
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.5}
        value={shown}
        disabled={duration <= 0}
        aria-label={t('radio.seek')}
        style={{ '--ap-pct': `${pct}%` }}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={() => {
          if (scrub != null) seekTo(scrub);
          setScrub(null);
        }}
        onKeyUp={() => {
          if (scrub != null) seekTo(scrub);
          setScrub(null);
        }}
      />

      <div className="ap-body">
        <button
          className={`ap-play ${playing ? 'is-playing' : ''}`}
          onClick={toggle}
          aria-label={playing ? t('radio.pause') : t('radio.play')}
        >
          {/*
            The buffering ring replaces nothing — it sits BEHIND the glyph. A
            spinner that swaps out the play/pause icon makes the button
            un-pressable exactly when a user on a slow connection is most
            likely to press it again.
          */}
          {stalled && <span className="ap-ring" aria-hidden="true" />}
          {playing ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3.2" y="2" width="3.6" height="12" rx="1.2" />
              <rect x="9.2" y="2" width="3.6" height="12" rx="1.2" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2.6v10.8a.8.8 0 0 0 1.22.68l8.6-5.4a.8.8 0 0 0 0-1.36l-8.6-5.4A.8.8 0 0 0 4 2.6Z" />
            </svg>
          )}
        </button>

        <button
          className="ap-meta"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="ap-title">{track.title}</span>
          <span className="ap-sub">
            <span className="ap-station">{track.stationName}</span>
            <span className="ap-time mono">
              {fmtDuration(shown) ?? '0:00'}
              {duration > 0 && ` / ${fmtDuration(duration)}`}
            </span>
          </span>
        </button>

        <button className="ap-btn" onClick={onClose} aria-label={t('radio.stop')}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>

      {/*
        The extra transport lives behind a tap.

        Six controls on one row is 44px targets shrinking to 28px on a narrow
        phone, and the bar competes with the bottom navigation directly below
        it. Play, title and stop are what you need while listening; skip, rate
        and station-hop are what you need occasionally.
      */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="ap-more"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="ap-more-row">
              <button
                className="ap-btn"
                onClick={() => prev && onTrack?.(prev)}
                disabled={!prev}
                aria-label={t('radio.previous')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M12.4 2.6v10.8a.8.8 0 0 1-1.22.68l-8.6-5.4a.8.8 0 0 1 0-1.36l8.6-5.4a.8.8 0 0 1 1.22.68Z" />
                </svg>
              </button>

              <button
                className="ap-btn ap-btn-wide"
                onClick={() => seekTo(position - SKIP)}
                aria-label={t('radio.back15')}
              >
                −{SKIP}s
              </button>

              <button
                className="ap-btn ap-btn-wide"
                onClick={() => seekTo(position + SKIP)}
                aria-label={t('radio.fwd15')}
              >
                +{SKIP}s
              </button>

              <button
                className="ap-btn ap-btn-wide"
                onClick={cycleRate}
                aria-label={t('radio.speed')}
              >
                {rate}×
              </button>

              <button
                className="ap-btn"
                onClick={() => next && onTrack?.(next)}
                disabled={!next}
                aria-label={t('radio.next')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.6 2.6v10.8a.8.8 0 0 0 1.22.68l8.6-5.4a.8.8 0 0 0 0-1.36l-8.6-5.4a.8.8 0 0 0-1.22.68Z" />
                </svg>
              </button>
            </div>

            {/*
              A failure has to be SAID. Silence plus a pressed-looking button
              is the single most confusing state an audio player can be in —
              the user cannot tell our bug from their connection.
            */}
            {failed && <p className="ap-err">{t('radio.failed')}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
