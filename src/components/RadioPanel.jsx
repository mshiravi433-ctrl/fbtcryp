import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn, stagger } from './PageTransition';
import AudioPlayer from './AudioPlayer';
import InfoBox from './InfoBox';
import { timeAgo } from '../lib/format';
import { getAudio, fmtDuration } from '../lib/audio';
import { openUrl } from '../lib/browser';
import { IconExternal } from './Icons';

/**
 * CRYPTO RADIO — the news you can listen to.
 * ---------------------------------------------------------------------------
 * ─── WHAT CHANGED, AND WHY ──────────────────────────────────────────────────
 *   «در اخبار قسمت رادیو هم دیر میاد و mp player نداره تا بشه کنترلش کرد
 *    میخام mp player بسیار زیبا و مدرن باشد، سرعت اومدن زیاد شود و در دو تم
 *    هم پویا باشد»
 *
 * Three separate complaints, three separate fixes, in three separate places:
 *
 *   SLOW — was two problems compounding. The server re-fetched four RSS
 *     documents on every cold start (memory-only cache) and waited for the
 *     SLOWEST of them with a 12-second timeout. Fixed in `server/app.js`
 *     (persistent Blob cache) and `server/audio.js` (6-second timeout). Also
 *     fixed here: the list is fetched the moment the component mounts, and
 *     the skeleton has the SHAPE of the real rows rather than being one grey
 *     block, so the wait reads as loading rather than as emptiness.
 *
 *   NO CONTROLS — the whole of `AudioPlayer.jsx`. There was a play/pause
 *     button per row and nothing else: no seek, no elapsed time, no next, no
 *     speed, and the control scrolled off screen so stopping a 40-minute
 *     episode meant hunting for the row again.
 *
 *   BOTH THEMES — the player is styled entirely with `var(--…)` tokens, so it
 *     follows the theme instead of having a dark version and a light bug.
 *
 * ─── STATE LIVES HERE, PLAYBACK LIVES THERE ─────────────────────────────────
 * This component owns "which episode is selected"; `AudioPlayer` owns the
 * `<audio>` element and everything about it. That split is what makes
 * auto-advance and the next/previous buttons possible at all — the player
 * needs the QUEUE, not just one URL, and the queue is a property of the list.
 */
export default function RadioPanel() {
  const { t, i18n } = useTranslation();

  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(null);
  /* `null` = every station. A station id filters the list to one show. */
  const [station, setStation] = useState(null);

  useEffect(() => {
    let alive = true;
    getAudio()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return station ? all.filter((it) => it.station === station) : all;
  }, [data, station]);

  /*
   * The queue the player advances through is the FILTERED list, not the whole
   * feed. If you have narrowed to one show, "next" meaning "next episode of a
   * different show" would be a surprise, and undoing it means finding your
   * place again.
   */
  const queue = items;

  /* Upstream unreachable: say nothing rather than render an empty stage. */
  if (failed) return null;

  if (!data) {
    return (
      <section style={{ marginTop: 4 }}>
        <p className="section-label">{t('radio.title')}</p>
        {/*
          Row-shaped skeletons, not one grey slab. A placeholder that matches
          the layout it will become makes the wait feel like loading; a single
          block makes it feel like the feature is broken. Same reason the
          market list uses six 58px rows.
        */}
        <div className="stack" style={{ gap: 9, marginTop: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 74 }} />
          ))}
        </div>
      </section>
    );
  }

  if (!items.length && !station) return null;

  const stations = data.stations ?? [];

  return (
    <section style={{ marginTop: 4 }}>
      <p className="section-label">{t('radio.title')}</p>

      {/*
        The explanation and the attribution both moved into a collapsible box.

        Asked for generally — «همه هشدارها و نظرات را در هر صفحه بزار تو باکس
        باز شونده تا صفحه شلوغ بنظر نرسد» — and it is the right call here
        specifically: two paragraphs of "what this is" and "whose shows these
        are" sat between the heading and the first play button, so on a phone
        the feature began below the fold. The credit line is not optional
        content, it is just content that does not need to be in the way.
      */}
      <InfoBox title={t('radio.aboutTitle')} tone="info" id="radio-about">
        <p>{t('radio.intro')}</p>
        <p>{t('radio.credit')}</p>
      </InfoBox>

      {/*
        Honest partial-failure signal. When a station's host is down its
        episodes are simply absent, and without this line the show looks like
        it stopped publishing rather than like its server had a bad afternoon.
      */}
      {data.stationsOk < data.stationsTotal && (
        <p className="faint" style={{ fontSize: 11.4, margin: '9px 0', lineHeight: 1.75 }}>
          {t('radio.partial', { ok: data.stationsOk, total: data.stationsTotal })}
        </p>
      )}

      {/* Station filter. Four shows is exactly the count where a filter starts
          being useful and a search box is still overkill. */}
      {stations.length > 1 && (
        <div className="tag-scroll" style={{ margin: '9px 0' }}>
          <button
            className={`tag ${station == null ? 'active' : ''}`}
            onClick={() => setStation(null)}
          >
            {t('radio.allStations')}
          </button>
          {stations.map((s) => (
            <button
              key={s.id}
              className={`tag ${station === s.id ? 'active' : ''}`}
              onClick={() => setStation(station === s.id ? null : s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {!items.length ? (
        <div className="empty">{t('radio.emptyStation')}</div>
      ) : (
        <motion.div className="stack" style={{ gap: 9 }} variants={stagger} initial="hidden" animate="show">
          {items.slice(0, 12).map((item) => {
            const isCurrent = current?.id === item.id;
            const dur = fmtDuration(item.durationSec);
            return (
              <motion.article
                key={item.id}
                className="card card-tight"
                variants={riseIn}
                style={
                  isCurrent
                    ? { borderColor: 'var(--rgb-4)', background: 'rgba(0, 255, 157, 0.045)' }
                    : undefined
                }
              >
                <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                  <button
                    className="icon-btn"
                    onClick={() => setCurrent(isCurrent ? null : item)}
                    aria-label={isCurrent ? t('radio.stop') : t('radio.play')}
                    style={{
                      flexShrink: 0,
                      width: 38,
                      height: 38,
                      color: isCurrent ? 'var(--rgb-4)' : 'var(--rgb-1)',
                      borderColor: isCurrent ? 'var(--rgb-4)' : undefined
                    }}
                  >
                    {isCurrent ? (
                      /*
                        A STOP square, not a pause bar. Pause belongs to the
                        transport at the bottom of the screen; this button
                        chooses which episode is loaded, and labelling it
                        "pause" would make two different controls look like
                        they do the same thing.
                      */
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="3" y="3" width="10" height="10" rx="2" />
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
      )}

      {/*
        AnimatePresence so the bar slides away instead of vanishing. A control
        that disappears between frames leaves the user unsure whether they hit
        stop or the app crashed.
      */}
      <AnimatePresence>
        {current && (
          <AudioPlayer
            key="ap"
            track={current}
            queue={queue}
            onTrack={setCurrent}
            onClose={() => setCurrent(null)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
