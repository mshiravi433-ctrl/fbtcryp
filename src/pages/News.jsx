import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import { useTelegram } from '../context/TelegramContext';
import { getNews } from '../lib/api';
import { IconChevronLeft, IconExternal, IconGlobe } from '../components/Icons';

/**
 * Crypto news feed.
 *
 * Refreshed at most once every 6 hours (see getNews) and cached 30 minutes
 * server-side. Headlines don't need to be live, and every extra refresh spends
 * mobile data that many of our users pay for by the megabyte.
 *
 * Articles open in the system browser rather than an in-app webview: we do not
 * want a wallet-connected app rendering arbitrary third-party pages.
 */

function timeAgo(ts, t) {
  if (!ts) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return t('news.minsAgo', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('news.hoursAgo', { n: hours });
  return t('news.daysAgo', { n: Math.round(hours / 24) });
}

export default function News() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = () => {
    setLoading(true);
    setFailed(false);
    getNews(40)
      .then((n) => {
        setItems(Array.isArray(n) ? n : []);
        setFailed(!n?.length);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const open = (url) => {
    if (!url) return;
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const categories = useMemo(() => {
    const counts = new Map();
    for (const it of items) {
      for (const c of it.categories ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([c]) => c);
  }, [items]);

  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => (i.categories ?? []).includes(filter))),
    [items, filter]
  );

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('news.title')}</h1>
      </motion.div>

      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.8 }}>{t('news.intro')}</p>

      <AdBanner slot="swap" />

      {categories.length > 0 && (
        <div className="chip-row">
          <button className="chip" data-active={filter === 'all'} onClick={() => setFilter('all')}>
            {t('news.all')}
          </button>
          {categories.map((c) => (
            <button key={c} className="chip" data-active={filter === c} onClick={() => setFilter(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      )}

      {!loading && failed && (
        <div className="empty">
          <span className="empty-icon">📰</span>
          {t('news.failed')}
          <div className="faint" style={{ marginTop: 6, maxWidth: 290, lineHeight: 1.7 }}>
            {t('news.failedHint')}
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <motion.div className="stack" style={{ gap: 10 }} variants={stagger} initial="hidden" animate="show">
        {shown.map((n) => (
          <motion.button
            key={n.id}
            className="card lift news-card"
            variants={riseIn}
            whileTap={{ scale: 0.99 }}
            onClick={() => open(n.url)}
          >
            {n.image && (
              <div className="news-img">
                <img src={n.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} />
              </div>
            )}
            <div className="news-body">
              <div className="news-title">{n.title}</div>
              {n.body && <p className="news-excerpt">{n.body.slice(0, 170)}…</p>}
              <div className="news-foot">
                <span className="news-source">
                  <IconGlobe width={11} height={11} /> {n.source}
                </span>
                <span className="faint">{timeAgo(n.publishedAt, t)}</span>
                <IconExternal width={12} height={12} style={{ color: 'var(--text-3)' }} />
              </div>
            </div>
          </motion.button>
        ))}
      </motion.div>

      {!loading && !failed && shown.length === 0 && (
        <div className="empty"><span className="empty-icon">🔍</span>{t('news.noneInCategory')}</div>
      )}

      {!loading && shown.length > 0 && <p className="notice">{t('news.disclaimer')}</p>}
    </PageTransition>
  );
}
