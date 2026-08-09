import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn, stagger } from './PageTransition';
import { FARCASTER_HOME, fetchCommunity } from '../lib/community';
import { openUrl } from '../lib/browser';
import { timeAgo } from '../lib/format';
import { IconExternal } from './Icons';

/**
 * THE COMMUNITY FEED.
 *
 * ─── WHY WE DO NOT HOST THIS ────────────────────────────────────────────────
 * Measured before building: our own feed would exhaust the free storage tier
 * at roughly fifty active users, and hosting strangers' posts would make us
 * the publisher of whatever they write — a real rejection risk for an app
 * under store review. Farcaster carries both costs instead. Reading is free
 * and needs no account.
 *
 * ─── WHY IT IS READ-ONLY, AND SAYS SO ───────────────────────────────────────
 * Posting from inside this app would mean holding the user's Farcaster signing
 * key. We will not do that for the same reason we never hold a seed phrase.
 * So every row links out to a real client, and the panel states plainly that
 * these posts are not ours and not moderated by us — because a feed embedded
 * in an exchange looks endorsed unless you say otherwise.
 */

const CHANNELS = ['crypto', 'base', 'dev'];

function Cast({ row, lang }) {
  const { t } = useTranslation();

  return (
    <motion.div variants={riseIn} className="cmt-row">
      <div className="cmt-head">
        <span className="cmt-author">@{row.author}</span>
        <span className="cmt-time">{timeAgo(row.at, lang)}</span>
      </div>

      <p className="cmt-text">{row.text}</p>

      <div className="cmt-foot">
        {row.embeds > 0 ? (
          <span className="cmt-embed">{t('community.attachments', { n: row.embeds })}</span>
        ) : null}
        <button
          type="button"
          className="cmt-open"
          onClick={() => openUrl(row.url)}
          aria-label={t('community.openIn')}
        >
          {t('community.openIn')}
          <IconExternal width={12} height={12} />
        </button>
      </div>
    </motion.div>
  );
}

export default function CommunityPanel() {
  const { t, i18n } = useTranslation();

  const [channel, setChannel] = useState('crypto');
  const [state, setState] = useState({ rows: [], live: true });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (ch) => {
    setLoading(true);
    const data = await fetchCommunity(ch, 20);
    setState(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    /*
     * `alive` guards against a slow response for channel A landing after the
     * user has already switched to channel B — without it the feed would show
     * the wrong channel's posts under the wrong tab.
     */
    let alive = true;
    setLoading(true);
    (async () => {
      const data = await fetchCommunity(channel, 20);
      if (!alive) return;
      setState(data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [channel]);

  const lang = i18n.language?.startsWith('fa') ? 'fa' : 'en';

  return (
    <>
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('community.title')}</div>
        <p className="prose-sm" style={{ margin: 0 }}>{t('community.intro')}</p>
      </motion.section>

      <div className="cmt-tabs">
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            className={`cmt-tab${channel === c ? ' is-on' : ''}`}
            onClick={() => setChannel(c)}
          >
            {t(`community.channel.${c}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 82 }} />)}
        </div>
      ) : state.rows.length === 0 ? (
        <div className="empty" style={{ marginTop: 10 }}>
          <span className="empty-icon">💬</span>
          {state.live ? t('community.empty') : t('community.offline')}
          {!state.live ? (
            <div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => load(channel)}>
                {t('common.retry')}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <motion.div
          className="stack"
          style={{ gap: 9, marginTop: 10 }}
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {state.rows.map((row) => <Cast key={row.hash} row={row} lang={lang} />)}
        </motion.div>
      )}

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('community.joinTitle')}</div>
        <p className="prose-sm" style={{ marginTop: 0 }}>{t('community.joinBody')}</p>
        <button className="btn btn-ghost" onClick={() => openUrl(FARCASTER_HOME)}>
          {t('community.openFarcaster')}
        </button>
      </motion.section>

      {/*
        Not a disclaimer for its own sake. A feed rendered inside an exchange
        reads as endorsed unless it says otherwise, and these posts are written
        by strangers we cannot moderate.
      */}
      <p className="notice">{t('community.notice')}</p>
    </>
  );
}
