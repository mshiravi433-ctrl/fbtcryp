import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import { useTelegram } from '../context/TelegramContext';
import { useMarkets } from '../hooks/useMarket';
import { getNews } from '../lib/news';
import { timeAgo } from '../lib/format';
import { IconBell, IconChevronLeft, IconExternal, IconNews, IconSearch } from '../components/Icons';
import {
  getNotifySettings,
  notificationPermission,
  requestNotificationPermission,
  setNotifySettings
} from '../lib/notify';

/**
 * NEWS
 * ---------------------------------------------------------------------------
 * Headlines refresh once every 24 hours (pull-to-refresh forces it sooner).
 * Sources are named on every card and every link opens externally — we do not
 * reframe someone else's reporting as ours, and a market app quoting an
 * unattributed headline is how rumours become "news".
 *
 * When no feed is reachable the screen shows an auto-generated movers digest,
 * clearly labelled as generated rather than reported.
 */

const CATEGORIES = ['all', 'bitcoin', 'ethereum', 'defi', 'regulation'];

const CATEGORY_TERMS = {
  bitcoin: ['bitcoin', 'btc', 'satoshi', 'halving'],
  ethereum: ['ethereum', 'eth', 'vitalik', 'layer 2', 'l2'],
  defi: ['defi', 'dex', 'liquidity', 'yield', 'swap', 'staking', 'uniswap', 'pancake'],
  regulation: ['sec', 'regulat', 'lawsuit', 'ban', 'law', 'court', 'etf', 'compliance']
};

export default function News() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const { data: coins } = useMarkets(60);

  const [feed, setFeed] = useState({ items: [], at: 0 });
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [notifyOn, setNotifyOn] = useState(() => getNotifySettings().news);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        setFeed(await getNews({ force, coins: coins ?? [], lang: i18n.language }));
      } finally {
        setLoading(false);
      }
    },
    [coins, i18n.language]
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  const items = useMemo(() => {
    let out = feed.items ?? [];
    if (cat !== 'all') {
      const terms = CATEGORY_TERMS[cat] ?? [];
      out = out.filter((i) => {
        const hay = `${i.title} ${i.summary}`.toLowerCase();
        return terms.some((term) => hay.includes(term));
      });
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((i) => `${i.title} ${i.summary}`.toLowerCase().includes(q));
    }
    return out;
  }, [feed, cat, query]);

  const open = (url) => {
    if (!url) return;
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggleNotify = async () => {
    haptic?.('select');
    if (!notifyOn) {
      const perm = await requestNotificationPermission();
      if (perm !== 'granted') return;
    }
    const next = !notifyOn;
    setNotifySettings({ news: next });
    setNotifyOn(next);
  };

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10 }}>
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <div>
            <h1 className="h1" style={{ fontSize: 19 }}>{t('news.title')}</h1>
            <p className="muted" style={{ margin: 0 }}>{t('news.subtitle')}</p>
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={toggleNotify}
          aria-label={t('news.notifyToggle')}
          style={{ color: notifyOn ? 'var(--rgb-1)' : undefined }}
        >
          <IconBell width={18} height={18} />
        </button>
      </motion.div>

      <motion.div className="card card-tight row-between" variants={riseIn} initial="hidden" animate="show">
        <span className="faint">
          {feed.at ? t('news.updated', { ago: timeAgo(feed.at, i18n.language) }) : t('news.loading')}
        </span>
        <button className="btn btn-sm btn-ghost" style={{ width: 'auto' }} onClick={() => load(true)} disabled={loading}>
          {loading ? t('news.loading') : t('news.refresh')}
        </button>
      </motion.div>

      {feed.generated && <p className="notice">{t('news.generatedNotice')}</p>}

      <div className="row" style={{ gap: 8 }}>
        <span className="icon-btn" style={{ pointerEvents: 'none' }}>
          <IconSearch width={16} height={16} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('news.search')}
          style={{ flex: 1 }}
        />
      </div>

      <div className="tag-scroll">
        {CATEGORIES.map((c) => (
          <button key={c} className={`tag ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
            {t(`news.cat.${c}`)}
          </button>
        ))}
      </div>

      {loading && !items.length ? (
        <div className="stack">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 78 }} />
          ))}
        </div>
      ) : !items.length ? (
        <div className="empty">
          <span className="empty-icon"><IconNews width={26} height={26} /></span>
          {t('news.empty')}
        </div>
      ) : (
        <motion.div className="stack" style={{ gap: 9 }} variants={stagger} initial="hidden" animate="show">
          {items.map((n) => (
            <motion.article
              key={n.id}
              className="card lift"
              variants={riseIn}
              whileTap={n.url ? { scale: 0.99 } : undefined}
              onClick={() => open(n.url)}
              style={{ cursor: n.url ? 'pointer' : 'default' }}
            >
              <div className="row-between" style={{ marginBottom: 5 }}>
                <span className="pill pill-rgb" style={{ fontSize: 10 }}>
                  {n.digest ? t('news.digest') : n.source}
                </span>
                <span className="faint mono" style={{ fontSize: 10.5 }}>{timeAgo(n.at, i18n.language)}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.6 }}>{n.title}</div>
              {n.summary && (
                <p className="muted" style={{ fontSize: 12, marginTop: 5, lineHeight: 1.75 }}>{n.summary}</p>
              )}
              {n.url && (
                <div className="row" style={{ gap: 5, marginTop: 8, color: 'var(--rgb-1)', fontSize: 11.5 }}>
                  <IconExternal width={13} height={13} />
                  <span>{t('news.readAt', { source: n.source })}</span>
                </div>
              )}
            </motion.article>
          ))}
        </motion.div>
      )}

      <AdBanner slot="signals" />

      <p className="notice">{t('news.disclaimer')}</p>
    </PageTransition>
  );
}
