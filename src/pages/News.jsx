import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import RadioPanel from '../components/RadioPanel';
import FbtRadioBox from '../components/FbtRadioBox';
import { play as playFbtRadio } from '../lib/fbtRadioEngine';
import CalmPanel from '../components/CalmPanel';
import CommunityPanel from '../components/CommunityPanel';
import MarketInsightsPanel from '../components/MarketInsightsPanel';
import WhaleTrackingPanel from '../components/WhaleTrackingPanel';
import SegIndicator from '../components/SegIndicator';
import '../styles/whales.css';
import '../styles/news-modern.css';
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
 * The five top-level tabs, in render order. Shared between the button row and
 * the ?tab= deep link so a URL like #/news?tab=calm cannot open a tab that
 * does not exist, and the row and the URL cannot drift apart.
 *
 * «هوش جهانی» is NOT one of them any more: it is its own page (More → «جهانی»,
 * route /global). A link that still says #/news?tab=global is forwarded there
 * by the wrapper below — see `News`.
 */
const NEWS_TABS = ['read', 'community', 'listen', 'insights', 'calm'];

const NEWS_TAB_PATHS = {
  read: <><path d="M5 4.5h14v15H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  community: <><path d="M4 5.5h16v10H9l-5 4z" /><path d="M8 9h8M8 12h5" /></>,
  listen: <><path d="M9 17V6l10-2v11" /><circle cx="6" cy="17" r="3" /><circle cx="16" cy="15" r="3" /></>,
  insights: <><path d="M4 18V6M4 18h16" /><path d="m7 14 4-4 3 2 5-6" /></>,
  calm: <><path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /><path d="M16 4v4M14 6h4" /></>
};

function NewsTabIcon({ tab }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {NEWS_TAB_PATHS[tab]}
    </svg>
  );
}

const CATEGORY_TERMS = {
  bitcoin: ['bitcoin', 'btc', 'satoshi', 'halving'],
  ethereum: ['ethereum', 'eth', 'vitalik', 'layer 2', 'l2'],
  defi: ['defi', 'dex', 'liquidity', 'yield', 'swap', 'staking', 'uniswap', 'pancake']
};

/**
 * The route component. It only decides whether this page should render at all:
 * an old link, a bookmark or a refreshed WebView that still says
 * #/news?tab=global belongs to the Global page now. Deciding here — before any
 * of the page's hooks run — means the redirect costs no news or market request.
 */
export default function News() {
  const [params] = useSearchParams();
  if (params.get('tab') === 'global') return <Navigate to="/global" replace />;
  return <NewsPage />;
}

function NewsPage() {
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
      /*
       * Start the live station INSIDE the click handler, not in an effect.
       *
       * Chrome allows a deferred play() after a tap, but iOS Safari only
       * counts an audio call made synchronously inside the gesture — a
       * play() from useEffect a frame later is refused there and the box
       * would show its start button on every iPhone. Calling it here makes
       * «پخش خودکار» true on the platform where it is hardest to get.
       * Persian-only, like the box itself.
       */
      if (next === 'listen' && String(i18n.language || 'fa').toLowerCase().startsWith('fa')) {
        playFbtRadio();
      }
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
    [setSearchParams, i18n.language]
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
    <PageTransition className="page news-page">
      <motion.div className="row-between news-header" variants={riseIn} initial="hidden" animate="show">
        <div className="news-header-main">
          <button className="icon-btn news-header-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <div className="news-header-copy">
            <div className="news-title-line">
              <h1 className="h1 news-title">{t('news.title')}</h1>
              <span className="news-live-badge"><i aria-hidden="true" />{t('news.live', { defaultValue: 'زنده' })}</span>
            </div>
            <p className="prose-sm news-subtitle">{t('news.subtitle')}</p>
          </div>
        </div>
        <button
          className={`icon-btn news-notify${notifyOn ? ' is-on' : ''}`}
          onClick={toggleNotify}
          aria-label={t('news.notifyToggle')}
          style={{ color: notifyOn ? 'var(--rgb-1)' : undefined }}
        >
          <AnimatedBell key={ring} active={notifyOn} still={still} width={18} height={18} />
        </button>
      </motion.div>

      <div className="segmented news-mode-tabs" role="tablist" aria-label={t('news.title')}>
        {/* Calm stays last because it is about the reader rather than the
            market. (Global Intelligence used to sit before it; it is its own
            page now — see NEWS_TABS.) */}
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
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}
            title={t(`news.tab.${k}`)}
            style={{ isolation: 'isolate' }}
          >
            {tab === k && <SegIndicator id="newstab" />}
            <span className="news-tab-icon"><NewsTabIcon tab={k} /></span>
            <span className="news-tab-label">{t(`news.tab.${k}`)}</span>
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
        <>
          {/*
            ─── FBT LIVE RADIO, FIRST ────────────────────────────────────────
            Asked for directly: «در صفحه اخبار، تب رادیو یک باکس خیلی مدرن
            ایجاد کن و رادیو پخش خودکار باشد … و تنها در زبان فارسی بیاد».

            It is the station this project actually owns — two hours, recorded
            in Persian and built for this app — so it sits above the podcast
            list rather than being one row inside it. The component renders
            nothing at all outside the Persian interface, and it starts itself
            as soon as the tab is opened.

            ─── AND WHY THE PODCAST LIST BELOW IS STILL AUDIO, NOT VIDEO ─────
            Asked again for TV. It is still not buildable honestly: a video tab
            means an embedded YouTube player, and youtube.com does not resolve
            on most Iranian networks — the whole tab would be a grey box for
            the audience this app is built for. That is the dead-button failure
            the Aparat links were removed for.

            Podcast audio is plain MP3 over HTTPS from reachable CDNs, needs no
            iframe or SDK, survives a slow connection, and keeps playing with
            the screen off. It is the honest version of the same request.
          */}
          <FbtRadioBox />
          <RadioPanel />
        </>
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
      <motion.section className="news-desk" variants={riseIn} initial="hidden" animate="show">
        <div className="news-desk-status">
          <span className="news-desk-updated" role="status">
            <i aria-hidden="true" />
            {feed.at ? t('news.updated', { ago: timeAgo(feed.at, i18n.language) }) : t('news.loading')}
          </span>
          <button className={`news-refresh${loading ? ' is-loading' : ''}`} onClick={() => load(true)} disabled={loading} aria-label={t('news.refresh')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 5.5" /><path d="M20 4v7h-7" /></svg>
            <span>{loading ? t('news.loading') : t('news.refresh')}</span>
          </button>
        </div>

        <label className="news-search">
          <span className="news-search-icon" aria-hidden="true">
            <AnimatedSearch active={Boolean(query)} still={still} width={17} height={17} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('news.search')}
            aria-label={t('news.search')}
          />
          {query && <button type="button" className="news-search-clear" onClick={() => setQuery('')} aria-label={t('common.clear')}>×</button>}
        </label>

        <div className="tag-scroll news-categories" aria-label={t('news.categories', { defaultValue: 'دسته‌بندی خبرها' })}>
          {CATEGORIES.map((c) => (
            <button key={c} className={`tag ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)} aria-pressed={cat === c}>
              {t(`news.cat.${c}`)}
            </button>
          ))}
        </div>
      </motion.section>

      {feed.generated && <p className="notice news-generated">{t('news.generatedNotice')}</p>}

      {loading && !items.length ? (
        <div className="stack news-loading-list">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel news-story-skel" />
          ))}
        </div>
      ) : !items.length ? (
        <div className="empty news-empty">
          <span className="empty-icon"><IconNews width={26} height={26} /></span>
          <strong>{t('news.empty')}</strong>
          {(query || cat !== 'all') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setCat('all'); }}>{t('news.clearFilters', { defaultValue: 'پاک کردن فیلترها' })}</button>}
        </div>
      ) : (
        <motion.div className="stack news-story-list" variants={stagger} initial="hidden" animate="show">
          {items.map((n, index) => (
            <motion.article
              key={n.id}
              className={`docs-card news-story${index === 0 ? ' is-lead' : ''}`}
              data-open="false"
              variants={riseIn}
              whileTap={n.url ? { scale: 0.988 } : undefined}
              onClick={() => open(n.url)}
              onKeyDown={(event) => {
                if (n.url && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  open(n.url);
                }
              }}
              role={n.url ? 'link' : undefined}
              tabIndex={n.url ? 0 : undefined}
              style={{ cursor: n.url ? 'pointer' : 'default', '--card-hue': 'var(--rgb-1)' }}
            >
              {index === 0 && <span className="news-lead-label"><i aria-hidden="true" />{t('news.topStory', { defaultValue: 'تیتر نخست' })}</span>}
              <div className="news-story-top">
                <div className="news-source">
                  <span className="news-source-mark" aria-hidden="true">{n.digest ? 'AI' : String(n.source || 'N').trim().charAt(0).toUpperCase()}</span>
                  <span className="news-source-name">{n.digest ? t('news.digest') : n.source}</span>
                </div>
                <time className="news-story-time mono">{timeAgo(n.at, i18n.language)}</time>
              </div>
              <h2 className="news-story-title">{n.title}</h2>
              {n.summary && <p className="news-story-summary">{n.summary}</p>}
              <div className="news-story-foot">
                <span className="news-story-badges">
                  {n.lang && n.lang !== i18n.language && <span className="news-language">{n.lang}</span>}
                </span>
                {n.url && (
                  <span className="news-read-link">
                    <span>{t('news.readAt', { source: n.source })}</span>
                    <IconExternal width={13} height={13} />
                  </span>
                )}
              </div>
            </motion.article>
          ))}
        </motion.div>
      )}

      <AdBanner slot="signals" />
        </>
      )}

      <p className="prose-sm news-disclaimer">{t('news.disclaimer')}</p>
    </PageTransition>
  );
}
