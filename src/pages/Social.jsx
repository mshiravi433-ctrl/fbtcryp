import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { openUrl } from '../lib/browser';
import { isRtl as isRtlLang } from '../i18n/languages.js';
import {
  BSKY_HOME,
  composeUrl,
  fetchProfile,
  fetchThread,
  fetchTopic,
  fetchTrending,
  search as searchSocial
} from '../lib/social';
import '../styles/social.css';

/**
 * SOCIAL — a self-contained, Harpy-shaped room inside the app.
 * ---------------------------------------------------------------------------
 * Requested: «شبکهٔ اجتماعی ... اصلاً یک صفحهٔ مجزا باشد، شکلش شبیه هارپی ...
 * منو به جای پایین بالا باشد و صفحات مثل مرورگر، ترندها و تایم‌لاین باشد از تم
 * مشکی هارپی ... نوشتن گوشهٔ راست با اسکرول بالا و پایین همراه صفحه بیاید».
 *
 * ─── WHY THIS SCREEN DOES NOT LOOK LIKE THE REST OF THE APP ────────────────
 * Every other page is a light column on the shared RGB canvas with the app's
 * header on top and its four-tab nav at the bottom. This one is deliberately a
 * different room: its own night sky, its own navigation at the TOP (Harpy's
 * signature: an amber pill that holds the active tab, sitting on a dark bar
 * over a starfield), and no bottom nav at all — App.jsx marks `/social`
 * headerless for exactly that reason, so the shell contributes neither bar.
 *
 * The palette is Harpy's own "crow" theme, lifted from
 * lib/core/harpy_theme/predefined_themes.dart in the upstream project:
 *
 *     background  #00030F → #12254A
 *     primary     #F3AA2F   (the amber pill)
 *     secondary   #4689FF
 *     card        a blue that is 90% dissolved into the background
 *
 * It is scoped under `.hsp` in styles/social.css and never touches a theme
 * token, so the rest of the app keeps its own colours while this page is open.
 *
 * ─── THE PAGES ARE THE FOUR THE BRIEF NAMED ────────────────────────────────
 *   · timeline — the feed (topic chips, posts, load-more)
 *   · trends   — Bluesky's own trending list, ranked like Harpy's
 *   · browser  — our existing Discover directory, embedded, so "browser" is a
 *                page here rather than a link that throws the reader out
 *   · search   — posts and people
 *   · settings — the Harpy-row list: write, open Bluesky, app settings, about,
 *                back to the app
 *
 * ─── WHAT IS STILL DELIBERATELY MISSING, AND WHY ───────────────────────────
 *   • No like / repost / reply ACTIONS. Those need the user's session token;
 *     holding it would let us speak as them, which this project has refused on
 *     every surface. The counts are read-only (and coloured the way Harpy
 *     colours its action row) and every post has one honest button that opens
 *     it on Bluesky, where the reader can act with their own account.
 *   • No avatars or post images from cdn.bsky.app. A remote <img> hands the
 *     poster's server our user's IP and gives a stranger a slot to display
 *     anything inside our app. An initial + gradient (stable per handle) and a
 *     media marker instead. See server/social.js.
 *   • No infinite scroll on the wire: "load more" re-reads the SAME cached
 *     topic at a larger page size rather than chasing upstream cursors, so a
 *     user's scrolling cannot multiply our requests.
 *
 * ─── THE WRITE BUTTON ─────────────────────────────────────────────────────
 * Harpy floats its compose button; the brief asked for it at the right corner
 * and for it to travel with the scroll. It therefore hides on a downward drag
 * and comes back on the first upward one (the same rule Harpy's
 * FloatingComposeButton uses), and pressing it opens our composer, which hands
 * the draft to Bluesky's own composer — nothing is posted by us.
 */

const PAGE = 25;
const MAX = 60;

const TOPICS = ['forYou', 'bitcoin', 'ethereum', 'defi', 'solana', 'fa'];
const TABS = ['timeline', 'trends', 'browser', 'search', 'settings'];

/* The browser tab is the Discover directory. Imported lazily so opening the
   social room does not pull the directory's own chunk (and its stylesheet)
   until that specific tab is pressed. */
const DiscoverPage = lazy(() => import('./Discover'));

/* ─── tiny inline icons ────────────────────────────────────────────────────
 * Harpy's whole icon language is 1.8px feather strokes. Drawing them here
 * keeps the screen at zero icon-library bytes and means the gear, the pen and
 * the hearts are exactly the weight of the ones in Harpy. */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.85,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

function Svg({ size = 20, children, viewBox = '0 0 24 24' }) {
  return (
    <svg viewBox={viewBox} width={size} height={size} aria-hidden="true" {...stroke}>
      {children}
    </svg>
  );
}

const IconMenu = () => (
  <Svg>
    <path d="M4 7h9M4 12h16M4 17h12" />
  </Svg>
);
const IconTimeline = () => (
  <Svg>
    <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2Z" />
  </Svg>
);
const IconTrends = () => (
  <Svg>
    <path d="M12 22c4.4 0 7-2.9 7-6.6 0-4.4-4.3-6.5-3.2-11.4-2.6.6-4.3 2.4-4.6 5-.8-.6-1.3-1.5-1.5-2.6C7.6 8.2 5 10.7 5 15.4 5 19.1 7.6 22 12 22Z" />
  </Svg>
);
const IconBrowser = () => (
  <Svg>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M2.8 12h18.4M12 2.8a15.3 15.3 0 0 1 4 9.2 15.3 15.3 0 0 1-4 9.2 15.3 15.3 0 0 1-4-9.2 15.3 15.3 0 0 1 4-9.2Z" />
  </Svg>
);
const IconSearch = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </Svg>
);
const IconSettings = () => (
  <Svg>
    <circle cx="12" cy="12" r="3.4" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Svg>
);
const IconPen = () => (
  <Svg>
    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
);
const IconHeart = ({ size = 17 }) => (
  <Svg size={size}>
    <path d="M12 20.7 4.3 13a4.8 4.8 0 0 1 6.8-6.8l.9.9.9-.9a4.8 4.8 0 0 1 6.8 6.8Z" />
  </Svg>
);
const IconRepeat = ({ size = 17 }) => (
  <Svg size={size}>
    <path d="m17 2 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
  </Svg>
);
const IconReply = ({ size = 17 }) => (
  <Svg size={size}>
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8Z" />
  </Svg>
);
const IconExternal = ({ size = 14 }) => (
  <Svg size={size}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
  </Svg>
);
const IconClose = ({ size = 18 }) => (
  <Svg size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
const IconRefresh = ({ size = 18 }) => (
  <Svg size={size}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </Svg>
);
const IconArrowUp = ({ size = 18 }) => (
  <Svg size={size}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Svg>
);
const IconImage = ({ size = 16 }) => (
  <Svg size={size}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="8.5" cy="9" r="1.4" />
    <path d="m21 15-4.5-4.5L7 20" />
  </Svg>
);
const IconShield = ({ size = 18 }) => (
  <Svg size={size}>
    <path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" />
  </Svg>
);
const IconInfo = ({ size = 18 }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
const IconChevron = ({ size = 18 }) => (
  <Svg size={size}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
const IconBackToApp = ({ size = 18 }) => (
  <Svg size={size}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);

const TAB_ICON = {
  timeline: IconTimeline,
  trends: IconTrends,
  browser: IconBrowser,
  search: IconSearch,
  settings: IconSettings
};

/* ─── small utilities ────────────────────────────────────────────────────── */

/** 12.4k rather than 12400, in both languages. */
function compact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

/** Deterministic hue from a handle, so an author keeps the same mark. */
function hueOf(handle) {
  let h = 0;
  const s = String(handle || '?');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/*
 * Harpy prints "9 days ago", not "9d". Intl gives that in the reader's own
 * language for free (fa → «۹ روز پیش») instead of us maintaining relative-time
 * strings in twelve locale files.
 */
const ageFormatters = new Map();
function ageLabel(ts, locale = 'en') {
  const seconds = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 1000));
  const table = [
    [60, 1, 'second'],
    [3600, 60, 'minute'],
    [86400, 3600, 'hour'],
    [Infinity, 86400, 'day']
  ];
  const row = table.find(([limit]) => seconds < limit) || table[table.length - 1];
  const value = -Math.max(1, Math.round(seconds / row[1]));
  try {
    if (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) {
      const key = String(locale || 'en');
      if (!ageFormatters.has(key)) {
        ageFormatters.set(key, new Intl.RelativeTimeFormat(key, { numeric: 'auto', style: 'narrow' }));
      }
      return ageFormatters.get(key).format(value, row[2]);
    }
  } catch {
    /* A runtime without full ICU falls through to the compact form. */
  }
  const short = { second: 's', minute: 'm', hour: 'h', day: 'd' };
  return `${Math.abs(value)}${short[row[2]]}`;
}

function Avatar({ author, size = 40 }) {
  const hue = hueOf(author?.handle);
  return (
    <span
      className="hsp-avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue} 78% 58%), hsl(${(hue + 46) % 360} 74% 44%))`
      }}
    >
      {String(author?.name || author?.handle || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** One count in the Harpy action row. Read-only on purpose (see the header). */
function Count({ icon, value, label, tone }) {
  return (
    <span className={`hsp-act hsp-act--${tone}`} title={`${label}: ${compact(value)}`} aria-label={`${label}: ${compact(value)}`}>
      {icon}
      <span className="hsp-act-num">{compact(value)}</span>
    </span>
  );
}

function PostCard({ row, locale, t, onOpenThread, onOpenProfile }) {
  const [open, setOpen] = useState(false);
  const long = (row.text?.length ?? 0) > 280;
  const shown = long && !open ? `${row.text.slice(0, 280)}…` : row.text;

  return (
    <motion.article className="hsp-post" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <header className="hsp-post-head">
        <button type="button" className="hsp-author" onClick={() => onOpenProfile(row.author.handle)}>
          <Avatar author={row.author} />
          <span className="hsp-author-copy">
            <strong>{row.author.name}</strong>
            <span className="hsp-meta">
              <span className="hsp-handle">@{row.author.handle}</span>
              <span aria-hidden="true">·</span>
              <span>{ageLabel(row.at, locale)}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          className="hsp-post-more"
          onClick={() => openUrl(row.url)}
          aria-label={t('social.openOnBsky')}
          title={t('social.openOnBsky')}
        >
          <IconExternal size={15} />
        </button>
      </header>

      {/* Body opens the thread INSIDE this room; only the small button leaves. */}
      <button type="button" className="hsp-post-body" onClick={() => onOpenThread(row)}>
        <p className="hsp-text">{shown}</p>
      </button>

      {long && (
        <button type="button" className="hsp-readmore" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('social.less') : t('social.more')}
        </button>
      )}

      <div className="hsp-post-foot">
        <div className="hsp-acts">
          <Count icon={<IconReply />} value={row.replies} label={t('social.replies')} tone="reply" />
          <Count icon={<IconRepeat />} value={row.reposts} label={t('social.reposts')} tone="repeat" />
          <Count icon={<IconHeart />} value={row.likes} label={t('social.likes')} tone="like" />
          {row.media ? (
            <span className="hsp-media" title={t('social.hasMedia')} aria-label={t('social.hasMedia')}>
              <IconImage />
            </span>
          ) : null}
        </div>
        <button type="button" className="hsp-open" onClick={() => openUrl(row.url)}>
          {t('social.openOnBsky')}
          <IconExternal size={12} />
        </button>
      </div>
    </motion.article>
  );
}

function PostSkeleton() {
  return (
    <div className="hsp-skel" aria-hidden="true">
      <span className="hsp-skel-avatar" />
      <div>
        <span />
        <span />
      </div>
    </div>
  );
}

export default function Social() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const still = useReducedMotion();
  const locale = i18n.language || 'en';
  /* Direction comes from the language registry, not from the router: every
     slide below (drawer, pushed page) has to start off the correct edge, and
     this screen is mounted outside the app's own page transition. */
  const rtl = isRtlLang(String(locale).slice(0, 2));

  /* ── navigation ───────────────────────────────────────────────────────── */
  const [tab, setTab] = useState('timeline');
  const [drawer, setDrawer] = useState(false);
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [browserSeen, setBrowserSeen] = useState(false);
  const [lifted, setLifted] = useState(false);
  const [fabOn, setFabOn] = useState(true);

  const scrollRef = useRef(null);
  const scrollMeta = useRef({ last: 0, raf: 0 });

  /* ── feed ─────────────────────────────────────────────────────────────── */
  const [topic, setTopic] = useState('forYou');
  const [limit, setLimit] = useState(PAGE);
  const [feed, setFeed] = useState({ rows: [], live: true });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  /* `reachable` is ours, `live` is the server's. Offline, the refresh stays
     enabled and the feed is not asked for at all. */
  const [reachable, setReachable] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  /* ── search ───────────────────────────────────────────────────────────── */
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);

  /* ── trends ───────────────────────────────────────────────────────────── */
  const [trending, setTrending] = useState(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  /* ── profile / thread, opened as a pushed page inside this room ─────────── */
  const [view, setView] = useState(null);

  const reqRef = useRef(0);
  const searchRef = useRef(0);

  const load = useCallback(async (which, size, { quiet = false } = {}) => {
    const id = ++reqRef.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    /* Offline: show an unreachable feed WITHOUT asking a server we cannot
       reach. Measured on a device with no radio this saves a doomed round
       trip on every open. */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFeed({ rows: [], live: false });
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const data = await fetchTopic(which, size);
    if (reqRef.current !== id) return;
    setFeed(data);
    setReachable(true);
    setUpdatedAt(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    setLimit(PAGE);
    load(topic, PAGE);
  }, [topic, load]);

  /* Trending rotates on Bluesky's schedule, not ours; the server caches it for
     fifteen minutes. Loaded the first time the tab is opened, not before. */
  const loadTrends = useCallback(async () => {
    setTrendsLoading(true);
    const rows = await fetchTrending(12);
    setTrending(rows);
    setTrendsLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'trends' && trending === null) loadTrends();
  }, [tab, trending, loadTrends]);

  useEffect(() => {
    if (tab === 'browser') setBrowserSeen(true);
  }, [tab]);

  useEffect(() => {
    const online = () => setReachable(true);
    const offline = () => setReachable(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  /* Leaving the room must release the scroll listener's pending frame. */
  useEffect(() => () => {
    if (scrollMeta.current.raf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(scrollMeta.current.raf);
    }
  }, []);

  const runSearch = useCallback(async (term) => {
    const id = ++searchRef.current;
    setSearching(true);
    const data = await searchSocial(term, PAGE);
    if (searchRef.current !== id) return;
    setResults(data);
    setSearching(false);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      searchRef.current += 1;
      setResults(null);
      setSearching(false);
      return undefined;
    }
    const timer = setTimeout(() => runSearch(term), 420);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  /* ── scroll: the condensed bar + the travelling write button ───────────── */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const commit = () => {
      scrollMeta.current.raf = 0;
      const dy = y - scrollMeta.current.last;
      if (Math.abs(dy) > 6) {
        if (y < 24) setFabOn(true);
        else if (dy > 0) setFabOn(false); // reading downwards: get out of the way
        else setFabOn(true); // coming back up: it returns
        scrollMeta.current.last = y;
      }
      setLifted(y > 10);
    };
    if (typeof requestAnimationFrame !== 'function') {
      commit();
      return;
    }
    if (scrollMeta.current.raf) return;
    scrollMeta.current.raf = requestAnimationFrame(commit);
  }, []);

  const toTop = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      el.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    } catch {
      el.scrollTop = 0;
    }
    setFabOn(true);
  }, [still]);

  const selectTab = useCallback(
    (id) => {
      setTab(id);
      setView(null);
      setDrawer(false);
      setFabOn(true);
      if (typeof scrollRef.current?.scrollTo === 'function') {
        try {
          scrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
        } catch {
          scrollRef.current.scrollTop = 0;
        }
      } else if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    },
    []
  );

  const openProfile = useCallback(async (handle) => {
    setView({ type: 'profile', actor: handle, rows: [], live: true, loading: true });
    const data = await fetchProfile(handle, 20);
    setView((current) =>
      current && current.type === 'profile' && current.actor === handle
        ? { ...current, ...data, loading: false }
        : current
    );
  }, []);

  const openThread = useCallback(async (row) => {
    setView({ type: 'thread', root: row, replies: [], live: true, loading: true });
    const data = await fetchThread(row.id, 20);
    setView((current) =>
      current && current.type === 'thread' && current.root?.id === row.id
        ? { ...current, root: data.root ?? current.root, replies: data.replies, live: data.live, loading: false }
        : current
    );
  }, []);

  const loadMore = () => {
    const next = Math.min(MAX, limit + PAGE);
    setLimit(next);
    load(topic, next, { quiet: true });
  };

  const rows = results ? results.posts : feed.rows;
  const live = reachable && (results ? results.live : feed.live);
  const canLoadMore = !results && !loading && feed.live && feed.rows.length >= limit && limit < MAX;

  const tabName = useCallback((id) => t(`social.tab.${id}`), [t]);

  /* ═══════════════════════════ PAGES ═════════════════════════════════════ */

  const statusStrip = (
    <div className="hsp-status">
      <span className={`hsp-live${live ? ' is-on' : ''}`}>
        <i aria-hidden="true" />
        {live ? t('social.live') : t('social.offlineBadge')}
      </span>
      <span className="hsp-updated">
        {updatedAt ? `${t('social.updated')} ${ageLabel(updatedAt, locale)}` : t('social.subtitle')}
      </span>
    </div>
  );

  const timelinePage = (
    <div className="hsp-page-body" role="tabpanel" aria-label={tabName('timeline')}>
      {statusStrip}

      {/* Topic tabs, Harpy's home filter chips. Hidden while searching. */}
      <div className="hsp-chips" role="tablist" aria-label={t('social.feedFilter')}>
        {TOPICS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={topic === id}
            className={`hsp-chip${topic === id ? ' is-on' : ''}`}
            onClick={() => setTopic(id)}
          >
            {t(`social.topic.${id}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="hsp-feed" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="hsp-empty">
          <span aria-hidden="true">🛰️</span>
          <p>{live ? t('social.empty') : t('social.offline')}</p>
          {!live && (
            <button type="button" className="hsp-btn" onClick={() => load(topic, limit)}>
              {t('social.retry')}
            </button>
          )}
        </div>
      ) : (
        <div className="hsp-feed">
          {rows.map((row) => (
            <PostCard key={row.id} row={row} locale={locale} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />
          ))}
        </div>
      )}

      {canLoadMore && (
        <button type="button" className="hsp-btn hsp-btn--wide" onClick={loadMore} disabled={refreshing}>
          {t('social.loadMore')}
        </button>
      )}

      <p className="hsp-footnote">{t('social.feedNote')}</p>
    </div>
  );

  const trendsPage = (
    <div className="hsp-page-body" role="tabpanel" aria-label={tabName('trends')}>
      {/* Harpy names the page ONLY in the pill; a second <h1> underneath says
          the same word twice. A one-line lead and the refresh control. */}
      <div className="hsp-lead">
        <p>{t('social.trendsSub')}</p>
        <button
          type="button"
          className="hsp-iconbtn"
          onClick={() => loadTrends()}
          disabled={trendsLoading}
          aria-label={t('social.refresh')}
          title={t('social.refresh')}
        >
          <span className={trendsLoading ? 'hsp-spin' : undefined}><IconRefresh /></span>
        </button>
      </div>

      {trendsLoading && !trending ? (
        <div className="hsp-feed" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      ) : (trending?.length ?? 0) === 0 ? (
        <div className="hsp-empty">
          <span aria-hidden="true">📈</span>
          <p>{t('social.trendsEmpty')}</p>
        </div>
      ) : (
        <ol className="hsp-trendlist">
          {trending.map((trend, index) => (
            <li key={`${trend.label}-${index}`}>
              <button type="button" className="hsp-trend" onClick={() => openUrl(trend.url)}>
                <span className="hsp-rank" aria-label={t('social.rank', { n: index + 1 })}>
                  {index + 1}
                </span>
                <span className="hsp-trend-copy">
                  <strong>{trend.label}</strong>
                  {trend.description ? <span>{trend.description}</span> : null}
                </span>
                <IconExternal size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}

      <p className="hsp-footnote">{t('social.trendsNote')}</p>
    </div>
  );

  const browserPage = (
    <div className="hsp-page-body hsp-page-body--browser" role="tabpanel" aria-label={tabName('browser')}>
      {/* No heading here on purpose: the embedded directory opens with its own
          titled hero, and two titles stacked read as a rendering fault. */}
      <p className="hsp-leadline">{t('social.browserSub')}</p>
      {browserSeen && (
        <Suspense fallback={<PostSkeleton />}>
          <div className="hsp-browser">
            <DiscoverPage embedded />
          </div>
        </Suspense>
      )}
    </div>
  );

  const searchPage = (
    <div className="hsp-page-body" role="tabpanel" aria-label={tabName('search')}>
      <label className="hsp-searchfield">
        <IconSearch size={17} />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchTouched(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim().length > 1) runSearch(query.trim());
          }}
          placeholder={t('social.searchPlaceholder')}
          aria-label={t('social.searchPlaceholder')}
          enterKeyHint="search"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="hsp-clear" onClick={() => setQuery('')} aria-label={t('social.clearSearch')}>
            <IconClose size={14} />
          </button>
        )}
      </label>

      {!searchTouched || query.trim().length < 2 ? (
        <div className="hsp-hint">
          <span aria-hidden="true">⌕</span>
          <p>{t('social.searchSub')}</p>
        </div>
      ) : searching ? (
        <div className="hsp-feed" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      ) : !results || (results.posts.length === 0 && results.accounts.length === 0) ? (
        <div className="hsp-empty">
          <span aria-hidden="true">🔍</span>
          <p>{t('social.noResults', { q: query.trim() })}</p>
        </div>
      ) : (
        <>
          {results.accounts.length > 0 && (
            <div className="hsp-accounts">
              <p className="hsp-label">{t('social.accounts')}</p>
              {results.accounts.map((actor) => (
                <button key={actor.did} type="button" className="hsp-account" onClick={() => openProfile(actor.handle)}>
                  <Avatar author={actor} size={34} />
                  <span className="hsp-author-copy">
                    <strong>{actor.name}</strong>
                    <span className="hsp-handle">@{actor.handle}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.posts.length > 0 && (
            <div className="hsp-feed">
              {results.posts.map((row) => (
                <PostCard key={row.id} row={row} locale={locale} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  const settingsPage = (
    <div className="hsp-page-body" role="tabpanel" aria-label={tabName('settings')}>
      <p className="hsp-leadline">{t('social.settingsSub')}</p>

      <div className="hsp-rows">
        <button type="button" className="hsp-row" onClick={() => setCompose(true)}>
          <span className="hsp-row-icon"><IconPen /></span>
          {t('social.write')}
        </button>
        <button type="button" className="hsp-row" onClick={() => openUrl(BSKY_HOME)}>
          <span className="hsp-row-icon"><IconExternal size={18} /></span>
          {t('social.openBluesky')}
        </button>
        <button type="button" className="hsp-row" onClick={() => navigate('/settings')}>
          <span className="hsp-row-icon"><IconSettings /></span>
          {t('social.settings')}
        </button>
        <button
          type="button"
          className="hsp-row hsp-row--toggle"
          onClick={() => setAboutOpen((v) => !v)}
          aria-expanded={aboutOpen}
        >
          <span className="hsp-row-icon"><IconInfo /></span>
          {t('social.about')}
        </button>
        <button type="button" className="hsp-row" onClick={() => navigate('/')}>
          <span className="hsp-row-icon"><IconBackToApp /></span>
          {t('social.backToApp')}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {aboutOpen && (
          <motion.p
            className="hsp-notice"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <IconShield size={16} />
            <span>{t('social.notice')}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <p className="hsp-footnote">{t('social.readOnly')} · Bluesky</p>
    </div>
  );

  /* ═════════════════════════ DRAWER + COMPOSE ════════════════════════════ */

  const drawerPanel = (
    <>
      <motion.div
        className="hsp-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: still ? 0 : 0.18 }}
        onClick={() => setDrawer(false)}
      />
      <motion.aside
        className="hsp-drawer"
        aria-label={t('social.drawerTitle')}
        initial={{ x: rtl ? '100%' : '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: rtl ? '100%' : '-100%' }}
        transition={{ type: 'tween', duration: still ? 0 : 0.24, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <div className="hsp-drawer-head">
          <span className="hsp-brandmark" aria-hidden="true">
            <IconBrowser size={20} />
          </span>
          <div>
            <strong>{t('social.title')}</strong>
            <span>{t('social.subtitle')}</span>
          </div>
          <button type="button" className="hsp-iconbtn hsp-drawer-close" onClick={() => setDrawer(false)} aria-label={t('social.closeMenu')}>
            <IconClose size={16} />
          </button>
        </div>

        <div className="hsp-chips hsp-chips--static">
          <span className={`hsp-chip${live ? ' is-on' : ''}`}>{live ? t('social.live') : t('social.offlineBadge')}</span>
          <span className="hsp-chip">{t('social.readOnly')}</span>
        </div>

        <div className="hsp-rows">
          {TABS.map((id) => {
            const Icon = TAB_ICON[id];
            return (
              <button
                key={id}
                type="button"
                className={`hsp-row${tab === id ? ' is-on' : ''}`}
                onClick={() => selectTab(id)}
                aria-current={tab === id ? 'page' : undefined}
              >
                <span className="hsp-row-icon"><Icon /></span>
                {tabName(id)}
              </button>
            );
          })}
        </div>

        <div className="hsp-rows">
          <button type="button" className="hsp-row" onClick={() => { setDrawer(false); setCompose(true); }}>
            <span className="hsp-row-icon"><IconPen /></span>
            {t('social.write')}
          </button>
          <button type="button" className="hsp-row" onClick={() => navigate('/')}>
            <span className="hsp-row-icon"><IconBackToApp /></span>
            {t('social.backToApp')}
          </button>
        </div>

        <p className="hsp-footnote">{t('social.notice')}</p>
      </motion.aside>
    </>
  );

  const composePanel = (
    <>
      <motion.div
        className="hsp-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: still ? 0 : 0.18 }}
        onClick={() => setCompose(false)}
      />
      <motion.section
        className="hsp-compose"
        aria-label={t('social.write')}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: still ? 0 : 0.26, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <header className="hsp-compose-head">
          <button type="button" className="hsp-iconbtn" onClick={() => setCompose(false)} aria-label={t('social.cancel')}>
            <IconClose size={16} />
          </button>
          <strong>{t('social.write')}</strong>
          <span className="hsp-counter">{280 - draft.length}</span>
        </header>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 280))}
          placeholder={t('social.composePlaceholder')}
          rows={4}
          aria-label={t('social.composePlaceholder')}
        />
        <p className="hsp-compose-note">{t('social.composeNote')}</p>
        <button
          type="button"
          className="hsp-btn hsp-btn--primary hsp-btn--wide"
          disabled={!draft.trim()}
          onClick={() => {
            openUrl(composeUrl(draft));
            setCompose(false);
            setDraft('');
          }}
        >
          {t('social.composeGo')}
          <IconExternal size={14} />
        </button>
      </motion.section>
    </>
  );

  /* ══════════════════════ PROFILE / THREAD (pushed page) ══════════════════ */

  const subPage = view && (
    <motion.section
      className="hsp-subpage"
      aria-label={view.type === 'profile' ? `@${view.actor}` : t('social.thread')}
      initial={{ opacity: 0, x: rtl ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: rtl ? -24 : 24 }}
      transition={{ duration: still ? 0 : 0.2 }}
    >
      <header className="hsp-subbar">
        <button type="button" className="hsp-iconbtn" onClick={() => setView(null)} aria-label={t('common.back')}>
          <span className="hsp-chevron" style={rtl ? { transform: 'scaleX(-1)' } : undefined}>
            <IconChevron />
          </span>
        </button>
        <strong>{view.type === 'profile' ? `@${view.actor}` : t('social.thread')}</strong>
        <button
          type="button"
          className="hsp-iconbtn"
          aria-label={t('social.openOnBsky')}
          onClick={() =>
            openUrl(
              view.type === 'profile'
                ? `${BSKY_HOME}/profile/${encodeURIComponent(view.actor)}`
                : view.root?.url
            )
          }
        >
          <IconExternal size={15} />
        </button>
      </header>

      <div className="hsp-subscroll">
        <div className="hsp-page-body">
          {view.loading ? (
            <div className="hsp-feed" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <PostSkeleton key={i} />
              ))}
            </div>
          ) : view.type === 'profile' ? (
            view.rows.length ? (
              <div className="hsp-feed">
                {view.rows.map((row) => (
                  <PostCard key={row.id} row={row} locale={locale} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />
                ))}
              </div>
            ) : (
              <p className="hsp-empty-copy">{view.live ? t('social.emptyProfile') : t('social.offline')}</p>
            )
          ) : (
            <div className="hsp-feed">
              {view.root && (
                <PostCard row={view.root} locale={locale} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />
              )}
              <p className="hsp-label">{t('social.replyCount', { n: view.replies.length })}</p>
              {view.replies.map((row) => (
                <div key={row.id} className="hsp-reply">
                  <PostCard row={row} locale={locale} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />
                </div>
              ))}
              {!view.replies.length && <p className="hsp-empty-copy">{t('social.noReplies')}</p>}
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );

  /* ═════════════════════════════ RENDER ══════════════════════════════════ */

  return (
    <motion.div
      className="hsp"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: still ? 0 : 0.2 }}
    >
      <div className="hsp-sky" aria-hidden="true">
        <span className="hsp-stars hsp-stars--a" />
        <span className="hsp-stars hsp-stars--b" />
        <span className="hsp-horizon" />
      </div>

      <div className="hsp-frame">
        <header className={`hsp-bar${lifted ? ' is-lifted' : ''}`}>
          <button
            type="button"
            className={`hsp-iconbtn hsp-menubtn${drawer ? ' is-on' : ''}`}
            onClick={() => setDrawer((v) => !v)}
            aria-label={drawer ? t('social.closeMenu') : t('social.openMenu')}
            aria-expanded={drawer}
            title={t('social.openMenu')}
          >
            <IconMenu size={21} />
          </button>

          <div className="hsp-tabs" role="tablist" aria-label={t('social.title')}>
            {TABS.map((id) => {
              const Icon = TAB_ICON[id];
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`hsp-tab${active ? ' is-on' : ''}`}
                  onClick={() => selectTab(id)}
                  aria-label={tabName(id)}
                  title={tabName(id)}
                >
                  <Icon size={19} />
                  {active && <span className="hsp-tab-label">{tabName(id)}</span>}
                </button>
              );
            })}
          </div>
        </header>

        <div className="hsp-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="hsp-body">
            {tab === 'timeline' && timelinePage}
            {tab === 'trends' && trendsPage}
            {tab === 'browser' && browserPage}
            {tab === 'search' && searchPage}
            {tab === 'settings' && settingsPage}
          </div>
        </div>

        {/* The travelling write button: right corner, hides going down,
            returns on the first upward drag — Harpy's floating compose. */}
        <AnimatePresence>
          {fabOn && (
            <motion.button
              type="button"
              className="hsp-fab"
              onClick={() => setCompose(true)}
              aria-label={t('social.write')}
              title={t('social.write')}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: still ? 0 : 0.18 }}
            >
              <IconPen size={22} />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Back-to-top, only once the timeline is long enough to be lost in. */}
        <AnimatePresence>
          {lifted && tab === 'timeline' && !fabOn && (
            <motion.button
              type="button"
              className="hsp-topbtn"
              onClick={toTop}
              aria-label={t('social.scrollTop')}
              title={t('social.scrollTop')}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: still ? 0 : 0.16 }}
            >
              <IconArrowUp size={17} />
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>{view && subPage}</AnimatePresence>
        <AnimatePresence>{drawer && drawerPanel}</AnimatePresence>
        <AnimatePresence>{compose && composePanel}</AnimatePresence>
      </div>
    </motion.div>
  );
}
