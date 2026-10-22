import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn, stagger } from './PageTransition';
import InfoBox from './InfoBox';
import { getCalm, fmtDuration } from '../lib/audio';
import { onSoftRefresh } from '../lib/refresh';
import { openUrl } from '../lib/browser';
import { useRadioStore } from '../store/useRadioStore';
import { IconExternal } from './Icons';

const MUSIC_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18V6l10-2v11.5" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" />
  </svg>
);

function Equalizer({ active = false }) {
  return (
    <span className={`calm-equalizer${active ? ' is-active' : ''}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

/**
 * Calm listening room. The catalogue, licences and shared background-audio
 * queue remain real; the visual layer is a compact, modern player rather than
 * a stack of generic cards. Loading, empty and failure are separate states so
 * a network error can never masquerade as an empty catalogue.
 */
export default function CalmPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const current = useRadioStore((s) => s.track);
  const playing = useRadioStore((s) => s.playing);
  const toggleTrack = useRadioStore((s) => s.toggleTrack);

  const load = useCallback(async (force = false) => {
    setFailed(false);
    if (data) setRetrying(true);
    try {
      setData(await getCalm({ force }));
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
    // The latest catalogue decides whether this is a first load or a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    let alive = true;
    getCalm()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => onSoftRefresh(() => loadRef.current(true)), []);

  const items = data?.items ?? [];
  const currentIsCalm = items.some((item) => item.id === current?.id);
  const heroTrack = currentIsCalm ? current : items[0];

  return (
    <section className="calm-panel">
      <motion.div className="calm-hero" variants={riseIn} initial="hidden" animate="show">
        <span className="calm-hero-orbit" aria-hidden="true" />
        <div className="calm-hero-top">
          <span className="calm-hero-mark">{MUSIC_ICON}</span>
          <span className="calm-hero-badge"><Equalizer active={currentIsCalm && playing} />{t('calm.heroBadge', { defaultValue: 'فضای تمرکز' })}</span>
        </div>
        <p className="calm-hero-kicker">{t('calm.kicker', { defaultValue: 'FBT · CALM SESSION' })}</p>
        <h2 className="calm-hero-title">{t('calm.title')}</h2>
        <p className="calm-hero-sub">{t('calm.heroSub', { defaultValue: 'چند دقیقه فاصله از هیاهوی بازار؛ برای تصمیم آرام‌تر و آگاهانه‌تر.' })}</p>
        <div className="calm-hero-actions">
          <button
            type="button"
            className="calm-play-all"
            disabled={!items.length}
            onClick={() => heroTrack && toggleTrack(heroTrack, items)}
          >
            {currentIsCalm ? (
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.6v10.8a.8.8 0 0 0 1.22.68l8.6-5.4a.8.8 0 0 0 0-1.36l-8.6-5.4A.8.8 0 0 0 4 2.6Z" /></svg>
            )}
            {currentIsCalm ? t('calm.stopSession', { defaultValue: 'توقف جلسه' }) : t('calm.playAll', { defaultValue: 'شروع جلسه آرامش' })}
          </button>
          <button type="button" className={`calm-refresh${retrying ? ' is-loading' : ''}`} onClick={() => load(true)} disabled={retrying} aria-label={t('common.refresh', { defaultValue: 'تازه‌سازی' })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 5.5" /><path d="M20 4v7h-7" /></svg>
          </button>
        </div>
        <div className="calm-hero-meta">
          <span>{t('calm.trackCount', { count: items.length, defaultValue: '{{count}} قطعه' })}</span>
          <span>{t('calm.backgroundNote', { defaultValue: 'پخش در پس‌زمینه ادامه دارد' })}</span>
        </div>
      </motion.div>

      <InfoBox title={t('calm.whyTitle')} tone="info" id="calm-why" defaultOpen={false}>
        <p>{t('calm.why1')}</p>
        <p>{t('calm.why2')}</p>
        <p>{t('calm.why3')}</p>
      </InfoBox>

      {!data && !failed && (
        <div className="stack calm-loading-list">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skel calm-track-skel" />)}
        </div>
      )}

      {failed && (
        <div className="empty calm-state" role="alert">
          <span className="empty-icon">{MUSIC_ICON}</span>
          <p className="prose-sm">{t('calm.error')}</p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={retrying} onClick={() => load(true)}>
            {retrying ? t('common.loading') : t('common.retry')}
          </button>
        </div>
      )}

      {data && items.length === 0 && !failed && (
        <div className="empty calm-state">
          <span className="empty-icon">{MUSIC_ICON}</span>
          <p className="prose-sm">{t('calm.empty')}</p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={retrying} onClick={() => load(true)}>
            {retrying ? t('common.loading') : t('common.retry')}
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="calm-list-head">
          <span>{t('calm.playlist', { defaultValue: 'فهرست پخش' })}</span>
          <span className="mono" dir="ltr">{String(items.length).padStart(2, '0')}</span>
        </div>
      )}

      <motion.div className="stack calm-track-list" variants={stagger} initial="hidden" animate="show">
        {items.map((item, index) => {
          const isCurrent = current?.id === item.id;
          const dur = fmtDuration(item.durationSec);
          return (
            <motion.article key={item.id} className={`calm-track${isCurrent ? ' is-current' : ''}`} variants={riseIn}>
              <span className="calm-track-index mono" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <button
                type="button"
                className="calm-track-play"
                onClick={() => toggleTrack(item, items)}
                aria-label={isCurrent ? t('radio.stop') : t('radio.play')}
              >
                {isCurrent ? (
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
                ) : (
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.6v10.8a.8.8 0 0 0 1.22.68l8.6-5.4a.8.8 0 0 0 0-1.36l-8.6-5.4A.8.8 0 0 0 4 2.6Z" /></svg>
                )}
              </button>

              <div className="calm-track-copy">
                <h3>{item.title}</h3>
                <div className="calm-track-meta">
                  <span>{item.stationName}</span>
                  {dur && <span className="calm-duration mono" dir="ltr">{dur}</span>}
                  <span className="calm-licence">{item.licence}</span>
                </div>
              </div>

              <div className="calm-track-side">
                {isCurrent && <Equalizer active={playing} />}
                {item.pageUrl && (
                  <button type="button" className="calm-source" onClick={() => openUrl(item.pageUrl)} aria-label={t('calm.source')}>
                    <IconExternal width={14} height={14} />
                  </button>
                )}
              </div>
            </motion.article>
          );
        })}
      </motion.div>

      <p className="calm-credit">{t('calm.credit')}</p>
    </section>
  );
}
