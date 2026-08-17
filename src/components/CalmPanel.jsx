import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn, stagger } from './PageTransition';
import InfoBox from './InfoBox';
import { getCalm, fmtDuration } from '../lib/audio';
import { onSoftRefresh } from '../lib/refresh';
import { openUrl } from '../lib/browser';
import { useRadioStore } from '../store/useRadioStore';
import { IconExternal } from './Icons';

/**
 * CALM MUSIC — the tab that is about the trader, not the market.
 * ---------------------------------------------------------------------------
 * Asked for:
 *   «یک تب از اهنگ های ارامشبخش ... ارامش در سرمایه گذاری، با فکر بهتر میشود
 *    تصمیم بهتر گرفت»
 *
 * ─── WHY THIS IS NOT DECORATION ─────────────────────────────────────────────
 * Background music next to somebody's money needs a justification, and the
 * owner supplied the right one: a calmer person makes a better decision. The
 * two most expensive habits in retail trading — panic selling and revenge
 * buying — are states of arousal, not failures of analysis. Nothing else in
 * this app addresses that half of the problem.
 *
 * So the collapsible box says exactly that, in the owner's own framing, rather
 * than treating the tab as a perk. It is the only honest way to put music on a
 * trading screen.
 *
 * ─── ONE PLAYER, SHARED WITH THE RADIO ──────────────────────────────────────
 * This writes to the same `useRadioStore` the podcast tab uses, so the docked
 * transport in `RadioDock` serves both and a track keeps playing when you
 * navigate to the swap screen. That is also why `server/calm.js` returns items
 * in the podcast item shape: a second track type would have meant a second
 * player, and two players means two things playing at once.
 *
 * ─── THE THREE STATES ARE NOW DISTINCT, AND THE BUG THAT DELETED THE MUSIC ──
 * This panel used to `return null` in BOTH failure modes — a fetch error AND
 * a genuinely empty list. Combined with a server that cached an empty
 * response for six hours, one archive.org outage emptied the tab for every
 * visitor with no message and no way to retry. The removal was never a
 * removal; it was a swallowed error.
 *
 * Now: loading is a skeleton, an error is a sentence plus a Retry button that
 * re-fetches for real, and the empty state only appears when the server
 * says — successfully — that today there is nothing to list.
 */
export default function CalmPanel() {
  const { t } = useTranslation();

  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  /* A second spinner-path while re-fetching with data already on screen:
     the list stays, only the Retry button shows progress. */
  const [retrying, setRetrying] = useState(false);

  const current = useRadioStore((s) => s.track);
  const toggleTrack = useRadioStore((s) => s.toggleTrack);

  const load = useCallback(async (force = false) => {
    setFailed(false);
    if (data) setRetrying(true);
    try {
      const d = await getCalm({ force });
      setData(d);
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    let alive = true;
    getCalm()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  /* Soft refresh (the header button) re-fetches through the same code path
     as Retry — one contract, no reload, nothing else disturbed. */
  useEffect(() => onSoftRefresh(() => getCalm({ force: true }).then(setData).catch(() => {})), []);

  const items = data?.items ?? [];

  return (
    <section style={{ marginTop: 4 }}>
      <p className="section-label">{t('calm.title')}</p>

      <InfoBox title={t('calm.whyTitle')} tone="info" id="calm-why" defaultOpen>
        <p>{t('calm.why1')}</p>
        <p>{t('calm.why2')}</p>
        <p>{t('calm.why3')}</p>
      </InfoBox>

      {!data && !failed && (
        /* LOADING — the skeleton, unchanged. */
        <div className="stack" style={{ gap: 9, marginTop: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 62 }} />
          ))}
        </div>
      )}

      {failed && (
        /* ERROR — said out loud, with a way back. */
        <div className="empty" role="alert">
          <span className="empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V6l10-2v11.5" />
              <circle cx="6.5" cy="18" r="2.5" />
              <circle cx="16.5" cy="15.5" r="2.5" />
            </svg>
          </span>
          <p className="prose-sm" style={{ textAlign: 'center' }}>{t('calm.error')}</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ width: 'auto', marginTop: 8 }}
            disabled={retrying}
            onClick={() => load(true)}
          >
            {retrying ? t('common.loading') : t('common.retry')}
          </button>
        </div>
      )}

      {data && items.length === 0 && !failed && (
        /*
         * GENUINELY EMPTY — the server answered fine and had nothing today.
         * Kept honest: this is the ONLY state this message is allowed to
         * describe, distinct from the error state above it.
         */
        <div className="empty">
          <span className="empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V6l10-2v11.5" />
              <circle cx="6.5" cy="18" r="2.5" />
              <circle cx="16.5" cy="15.5" r="2.5" />
            </svg>
          </span>
          <p className="prose-sm" style={{ textAlign: 'center' }}>{t('calm.empty')}</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ width: 'auto', marginTop: 8 }}
            disabled={retrying}
            onClick={() => load(true)}
          >
            {retrying ? t('common.loading') : t('common.retry')}
          </button>
        </div>
      )}

      <motion.div
        className="stack"
        style={{ gap: 9, marginTop: 10 }}
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {items.map((item) => {
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
              <div className="row" style={{ gap: 11, alignItems: 'center' }}>
                <button
                  className="icon-btn"
                  onClick={() => toggleTrack(item, items)}
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
                  <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.5 }}>{item.title}</div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <span className="faint" style={{ fontSize: 11 }}>{item.stationName}</span>
                    {dur && <span className="pill pill-neutral" style={{ fontSize: 10 }}>{dur}</span>}
                    {/*
                      The licence is shown on every row, not hidden in a
                      footer. For CC BY and CC BY-SA attribution is a CONDITION
                      of the licence — leaving it off would make the use
                      unlicensed, not merely impolite.
                    */}
                    <span className="pill" style={{ fontSize: 9.5 }}>{item.licence}</span>
                  </div>
                </div>

                {item.pageUrl && (
                  <button
                    className="icon-btn"
                    onClick={() => openUrl(item.pageUrl)}
                    aria-label={t('calm.source')}
                    style={{ flexShrink: 0, width: 32, height: 32 }}
                  >
                    <IconExternal width={13} height={13} />
                  </button>
                )}
              </div>
            </motion.article>
          );
        })}
      </motion.div>

      <p className="faint" style={{ fontSize: 11.3, marginTop: 10, lineHeight: 1.8 }}>
        {t('calm.credit')}
      </p>
    </section>
  );
}
