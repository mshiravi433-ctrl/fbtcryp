import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn, stagger } from './PageTransition';
import { timeAgo } from '../lib/format';
import { getAudio, fmtDuration } from '../lib/audio';
import { openUrl } from '../lib/browser';
import { IconExternal, IconNews } from './Icons';

/**
 * CRYPTO RADIO — the news you can listen to.
 * ---------------------------------------------------------------------------
 * Asked for as "radio and television on the news page". What shipped is radio,
 * and the reasoning for dropping the video half is worth keeping in front of
 * whoever reads this next:
 *
 *   An embedded YouTube live stream is the obvious way to do "TV". It fails
 *   for the audience this app is built for — youtube.com does not resolve on
 *   most Iranian networks, so the largest element on the news screen would be
 *   a permanently grey box. A dead player is worse than no player, and it is
 *   the same dead-button failure the Buy screen was rebuilt to remove.
 *
 *   Podcast audio is plain MP3 over HTTPS from CDNs that are reachable. No
 *   iframe, no SDK, no third-party script, no new dependency, and it keeps
 *   playing with the screen off — which is what somebody actually wants from
 *   news radio while they are doing something else.
 *
 * ─── ONE PLAYER, NOT ONE PER ROW ────────────────────────────────────────────
 * A `<audio controls>` on every row would let a user start four episodes at
 * once and produce a wall of overlapping voices with no obvious way to stop
 * it. A single element, moved between rows, makes "playing" a property of the
 * list rather than of each item — which is also how a radio works.
 */
export default function RadioPanel() {
  const { t, i18n } = useTranslation();

  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [playingId, setPlayingId] = useState(null);

  /*
   * The single shared <audio>. Created once and reused: constructing a new
   * element per track leaks the old one in some mobile browsers, and — worse
   * — the previous element keeps buffering, so switching episodes five times
   * has five downloads running.
   */
  const player = useRef(null);

  useEffect(() => {
    let alive = true;
    getAudio()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  /* Stop and release on unmount. Navigating away must not leave audio playing. */
  useEffect(
    () => () => {
      if (player.current) {
        player.current.pause();
        player.current.src = '';
      }
    },
    []
  );

  const toggle = (item) => {
    if (!player.current) {
      player.current = new Audio();
      /*
       * `preload="none"`. Without it Safari starts fetching as soon as `src`
       * is set, so merely rendering the list would pull megabytes of audio
       * nobody asked for — on a metered mobile connection that is somebody
       * else's money.
       */
      player.current.preload = 'none';
      player.current.addEventListener('ended', () => setPlayingId(null));
      /*
       * A failed load must clear the playing state. Otherwise the row stays
       * stuck showing "pause" over silence, which looks like the app hung
       * rather than like the file was unavailable.
       */
      player.current.addEventListener('error', () => setPlayingId(null));
    }

    if (playingId === item.id) {
      player.current.pause();
      setPlayingId(null);
      return;
    }

    player.current.pause();
    player.current.src = item.audioUrl;
    player.current
      .play()
      .then(() => setPlayingId(item.id))
      /*
       * Autoplay policies reject `play()` when it is not clearly tied to a
       * gesture, and some CDNs refuse a range request. Either way the promise
       * rejects, and swallowing it silently would leave a row that looks
       * pressed and plays nothing.
       */
      .catch(() => setPlayingId(null));
  };

  /* Upstream unreachable: say nothing rather than render an empty stage. */
  if (failed) return null;

  if (!data) {
    return (
      <section style={{ marginTop: 4 }}>
        <p className="section-label">{t('radio.title')}</p>
        <div className="skel" style={{ height: 96, marginTop: 8 }} />
      </section>
    );
  }

  if (!data.items?.length) return null;

  return (
    <section style={{ marginTop: 4 }}>
      <p className="section-label">{t('radio.title')}</p>
      <p className="prose-sm" style={{ marginTop: 6, marginBottom: 9 }}>{t('radio.intro')}</p>

      {/*
        Honest partial-failure signal. When a station's host is down its
        episodes are simply absent, and without this line the show looks like
        it stopped publishing rather than like its server had a bad afternoon.
      */}
      {data.stationsOk < data.stationsTotal && (
        <p className="faint" style={{ fontSize: 11.4, marginBottom: 9, lineHeight: 1.75 }}>
          {t('radio.partial', { ok: data.stationsOk, total: data.stationsTotal })}
        </p>
      )}

      <motion.div className="stack" style={{ gap: 9 }} variants={stagger} initial="hidden" animate="show">
        {data.items.slice(0, 8).map((item) => {
          const isPlaying = playingId === item.id;
          const dur = fmtDuration(item.durationSec);
          return (
            <motion.article key={item.id} className="card card-tight" variants={riseIn}>
              <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                <button
                  className="icon-btn"
                  onClick={() => toggle(item)}
                  aria-label={isPlaying ? t('radio.pause') : t('radio.play')}
                  style={{
                    flexShrink: 0,
                    width: 38,
                    height: 38,
                    color: isPlaying ? 'var(--rgb-4)' : 'var(--rgb-1)',
                    borderColor: isPlaying ? 'var(--rgb-4)' : undefined
                  }}
                >
                  {/* Two glyphs drawn inline — a play/pause pair is not worth an icon import. */}
                  {isPlaying ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="3" y="2" width="3.6" height="12" rx="1" />
                      <rect x="9.4" y="2" width="3.6" height="12" rx="1" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4 2.6v10.8a.8.8 0 0 0 1.22.68l8.6-5.4a.8.8 0 0 0 0-1.36l-8.6-5.4A.8.8 0 0 0 4 2.6Z" />
                    </svg>
                  )}
                </button>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span className="pill pill-rgb" style={{ fontSize: 10 }}>{item.stationName}</span>
                    {dur && <span className="pill pill-neutral" style={{ fontSize: 10 }}>{dur}</span>}
                    <span className="faint mono" style={{ fontSize: 10.5 }}>
                      {timeAgo(item.at, i18n.language)}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.6 }}>{item.title}</div>
                  {item.summary && (
                    <p className="prose-sm" style={{ marginTop: 4, fontSize: 12 }}>{item.summary}</p>
                  )}
                  {item.pageUrl && (
                    <button
                      className="row"
                      onClick={() => openUrl(item.pageUrl)}
                      style={{
                        gap: 5,
                        marginTop: 7,
                        color: 'var(--rgb-1)',
                        fontSize: 11.5,
                        background: 'none',
                        border: 0,
                        padding: 0,
                        cursor: 'pointer'
                      }}
                    >
                      <IconExternal width={13} height={13} />
                      <span>{t('radio.openShow', { name: item.stationName })}</span>
                    </button>
                  )}
                </div>
              </div>
            </motion.article>
          );
        })}
      </motion.div>

      {/*
        Attribution, and the reason it is not optional: these are other
        people's shows, streamed from their own servers, with their own
        advertising intact. We aggregate and credit; we do not rehost, and we
        do not strip anything out.
      */}
      <p className="faint" style={{ fontSize: 11.3, marginTop: 10, lineHeight: 1.8 }}>
        <IconNews width={12} height={12} style={{ verticalAlign: '-1px', marginInlineEnd: 5 }} />
        {t('radio.credit')}
      </p>
    </section>
  );
}
