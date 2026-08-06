import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn, stagger } from './PageTransition';
import InfoBox from './InfoBox';
import { getCalm, fmtDuration } from '../lib/audio';
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
 */
export default function CalmPanel() {
  const { t } = useTranslation();

  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const current = useRadioStore((s) => s.track);
  const toggleTrack = useRadioStore((s) => s.toggleTrack);

  useEffect(() => {
    let alive = true;
    getCalm()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return null;

  if (!data) {
    return (
      <section style={{ marginTop: 4 }}>
        <p className="section-label">{t('calm.title')}</p>
        <div className="stack" style={{ gap: 9, marginTop: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 62 }} />
          ))}
        </div>
      </section>
    );
  }

  const items = data.items ?? [];
  if (!items.length) return null;

  return (
    <section style={{ marginTop: 4 }}>
      <p className="section-label">{t('calm.title')}</p>

      <InfoBox title={t('calm.whyTitle')} tone="info" id="calm-why" defaultOpen>
        <p>{t('calm.why1')}</p>
        <p>{t('calm.why2')}</p>
        <p>{t('calm.why3')}</p>
      </InfoBox>

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
