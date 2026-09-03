import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import RadioPanel from '../components/RadioPanel';
import CalmPanel from '../components/CalmPanel';
import CommunityPanel from '../components/CommunityPanel';
import MarketInsightsPanel from '../components/MarketInsightsPanel';
import WhaleTrackingPanel from '../components/WhaleTrackingPanel';
import SegIndicator from '../components/SegIndicator';
import '../styles/whales.css';
import { useTelegram } from '../context/TelegramContext';
import { useMarkets } from '../hooks/useMarket';
import { getNews } from '../lib/news';
import { onSoftRefresh } from '../lib/refresh';
import { timeAgo } from '../lib/format';
import { IconChevronLeft, IconExternal, IconNews } from '../components/Icons';
import { AnimatedBell, AnimatedSearch, useStill } from '../components/AnimatedIcon';
import {
  getNotifySettings,
  requestNotificationPermission,
  registerPushAnywhere,
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

/*
 * Tabs.
 *
 * The first group is the desk-style categories, which come pre-tagged from
 * lib/news.js (it knows which feed each story came from, so a story from the
 * regulation desk is tagged 'policy' even if its headline never says
 * "regulation"). The second group is the old topic filters, which are pure
 * keyword matches over the text.
 *
 * Keeping both matters: 'policy' answers "what are governments doing", while
 * 'bitcoin' answers "what about this asset". They are different questions.
 */
const DESK_CATEGORIES = ['all', 'regional', 'policy', 'events', 'future', 'lang'];
const TOPIC_CATEGORIES = ['bitcoin', 'ethereum', 'defi'];
const CATEGORIES = [...DESK_CATEGORIES, ...TOPIC_CATEGORIES];

/*
 * The six top-level tabs, in render order. Shared between the button row and
 * the ?tab= deep link so a URL like #/news?tab=calm cannot open a tab that
 * does not exist, and the row and the URL cannot drift apart.
 */
const NEWS_TABS = ['read', 'community', 'listen', 'insights', 'calm'];

const CATEGORY_TERMS = {
  bitcoin: ['bitcoin', 'btc', 'satoshi', 'halving'],
  ethereum: ['ethereum', 'eth', 'vitalik', 'layer 2', 'l2'],
  defi: ['defi', 'dex', 'liquidity', 'yield', 'swap', 'staking', 'uniswap', 'pancake']
};

export default function News() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const { data: coins, loading: marketsLoading, updatedAt: marketsUpdatedAt } = useMarkets(60);

  const [feed, setFeed] = useState({ items: [], at: 0 });
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  /*
   * ─── TWO TABS: HEADLINES AND RADIO ──────────────────────────────────────
   * Requested: «دو تب اخبار و رادیو بزار داخل صفحه اخبار».
   *
   * The radio was previously a section at the FOOT of this page, below the
   * headline list, the ad slot and the disclaimer. On a phone that is several
   * screens of scrolling, so in practice it did not exist — a feature nobody
   * reaches is the same as a feature nobody has.
   *
   * A tab makes it one tap and, more usefully, makes it discoverable: the
   * label is visible before any scrolling happens.
   */
  /*
   * The active tab is mirrored into the URL search (?tab=calm) so a refresh —
   * including the hard WebView reload the Android app can be given — returns
   * the user to the tab they were reading, and so a shared link to the radio
   * or the calm music lands there instead of on headlines.
   *
   * HashRouter keeps this query inside the hash (#/news?tab=calm), which is
   * exactly what survives a reload intact.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTabState] = useState(() => {
    const fromUrl = searchParams.get('tab');
    return NEWS_TABS.includes(fromUrl) ? fromUrl : 'read';
  });
  const setTab = useCallback(
    (next) => {
      if (!NEWS_TABS.includes(next)) return;
      setTabState(next);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'read') p.delete('tab');
          else p.set('tab', next);
          return p;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [notifyOn, setNotifyOn] = useState(() => getNotifySettings().news);
  // Bumped on each toggle so the bell re-rings, confirming the tap.
  const [ring, setRing] = useState(0);
  const still = useStill();

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

  /*
   * Soft refresh. The header Refresh button re-runs the headline fetch with
   * the cache forced off — no reload, no remount, and the active tab (and
   * any playing audio, owned by RadioDock above the router) is untouched.
   * `load` closes over the current coins/language, so the subscription reads
   * a stable ref rather than re-subscribing on every render.
   */
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => onSoftRefresh(() => loadRef.current(true)), []);

  const items = useMemo(() => {
    let out = feed.items ?? [];
    if (cat !== 'all') {
      if (DESK_CATEGORIES.includes(cat)) {
        // Pre-tagged by lib/news.js from the source desk plus keyword scoring.
        // Older cached items predate `cats`, so fall back to the raw text
        // rather than showing an empty tab after an upgrade.
        out = out.filter((i) =>
          Array.isArray(i.cats)
            ? i.cats.includes(cat)
            : `${i.title} ${i.summary}`.toLowerCase().includes(cat)
        );
      } else {
        const terms = CATEGORY_TERMS[cat] ?? [];
        out = out.filter((i) => {
          const hay = `${i.title} ${i.summary}`.toLowerCase();
          return terms.some((term) => hay.includes(term));
        });
      }
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
    if (next) {
      setRing((n) => n + 1);
      registerPushAnywhere().catch(() => {});
    }
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
            <p className="prose-sm">{t('news.subtitle')}</p>
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={toggleNotify}
          aria-label={t('news.notifyToggle')}
          style={{ color: notifyOn ? 'var(--rgb-1)' : undefined }}
        >
          <AnimatedBell key={ring} active={notifyOn} still={still} width={18} height={18} />
        </button>
      </motion.div>

      <div className="segmented news-mode-tabs">
        {/*
          Intelligence sits immediately after Radio as requested. Calm remains
          last because it is about the reader rather than the market. All five
          labels stay in one fixed strip on phones; CSS reduces only this
          strip's type slightly rather than making the requested tab scroll out
          of sight.
        */}
        {/*
          ─── THE COMMUNITY FEED MOVED HERE FROM P2P ───────────────────────
          Asked for directly: «گفتگو نباید در p2p باشد باید در صفحه اخبار باشد».
          It belongs here. P2P is a place where money moves — an untrusted
          feed of strangers' posts sitting one tab away from a send form is
          exactly the adjacency a scammer wants ("I posted my address in the
          community tab, just send it"). On the news screen the same feed is
          simply what people are saying about the headlines above it, which
          is what it actually is.
        */}
        {NEWS_TABS.map((k) => (
          <button
            key={k}
            className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}
            title={t(`news.tab.${k}`)}
            style={{ isolation: 'isolate' }}
          >
            {tab === k && <SegIndicator id="newstab" />}
            {t(`news.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'community' ? (
        /*
          Read-only Farcaster feed, hosted by the protocol rather than by us:
          no storage cost, no moderation duty — see components/CommunityPanel.jsx.
        */
        <CommunityPanel />
      ) : tab === 'calm' ? (
        <CalmPanel />
      ) : tab === 'listen' ? (
        /*
          ─── RADIO, NOT TELEVISION, AND THE REASON IS UNCHANGED ───────────
          Asked again for TV. It is still not buildable honestly: a video tab
          means an embedded YouTube player, and youtube.com does not resolve
          on most Iranian networks — the whole tab would be a grey box for the
          audience this app is built for. That is the dead-button failure the
          Aparat links were removed for.

          Podcast audio is plain MP3 over HTTPS from reachable CDNs, needs no
          iframe or SDK, survives a slow connection, and keeps playing with
          the screen off. It is the honest version of the same request.
        */
        <RadioPanel />
      ) : tab === 'insights' ? (
        <MarketInsightsPanel
          markets={coins ?? []}
          newsItems={feed.items ?? []}
          marketsLoading={marketsLoading}
          marketsUpdatedAt={marketsUpdatedAt}
          newsUpdatedAt={feed.at}
        />
      ) : (
        <>
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
          <AnimatedSearch active={Boolean(query)} still={still} width={16} height={16} />
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
              className="docs-card"
              data-open="false"
              variants={riseIn}
              whileTap={n.url ? { scale: 0.985 } : undefined}
              onClick={() => open(n.url)}
              style={{ cursor: n.url ? 'pointer' : 'default', '--card-hue': 'var(--rgb-1)', padding: 16 }}
            >
              <div className="row-between" style={{ marginBottom: 5 }}>
                <span className="row" style={{ gap: 5 }}>
                  <span className="pill pill-rgb" style={{ fontSize: 10 }}>
                    {n.digest ? t('news.digest') : n.source}
                  </span>
                  {/*
                    Language badge. Without it the "other languages" tab is a
                    trap: you tap a headline expecting your own language and
                    land on a German page. Shown only when the article is NOT
                    in the language the UI is already set to, so it stays quiet
                    in the common case.
                  */}
                  {n.lang && n.lang !== i18n.language && (
                    <span className="pill" style={{ fontSize: 9.5, textTransform: 'uppercase' }}>
                      {n.lang}
                    </span>
                  )}
                </span>
                <span className="faint mono" style={{ fontSize: 10.5 }}>{timeAgo(n.at, i18n.language)}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.6 }}>{n.title}</div>
              {n.summary && (
                <p className="prose-sm" style={{ marginTop: 5 }}>{n.summary}</p>
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
        </>
      )}

      <p className="prose-sm" style={{ marginTop: 12 }}>{t('news.disclaimer')}</p>
    </PageTransition>
  );
}
