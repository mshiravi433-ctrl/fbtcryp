import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { timeAgo } from '../lib/format';
import { openUrl } from '../lib/browser';
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
 * SOCIAL — a read-only Bluesky feed, on its own screen.
 * ---------------------------------------------------------------------------
 * The shape is modelled on harpy (a third-party Twitter client that died when
 * Twitter banned them): a timeline, topic tabs, search, profiles and threads,
 * all rendered by us so tapping the header icon never leaves the app.
 *
 * ─── WHAT IS DELIBERATELY MISSING, AND WHY ─────────────────────────────────
 *   • No like / repost / reply buttons. Those need the user's session token;
 *     holding it would let us speak as them, which this project has refused on
 *     every other surface. Each post instead has one button that opens it on
 *     Bluesky, where the reader can act with their own account.
 *   • No avatars or post images. A remote <img> hands the poster's server our
 *     user's IP and gives a stranger a slot to display anything inside our app
 *     — and images are ~20x the bytes of the text, which is the whole traffic
 *     budget of a feed like this. An initial + a media marker instead.
 *   • No infinite scroll on the wire. "Load more" re-reads the same cached
 *     topic at a larger page size rather than chasing cursors upstream, so a
 *     user's scrolling cannot multiply our upstream requests.
 *
 * ─── WHAT IS ON SCREEN ────────────────────────────────────────────────────
 * topic tabs (allow-listed server-side), search over posts and accounts, one
 * level of navigation into a profile or a thread, an offline state that says
 * the feed is unreachable instead of pretending it is empty, and a notice that
 * these posts are written by strangers and are not our endorsement.
 */

const PAGE = 25;
const MAX = 60;

/** Compact counts: 12.4k rather than 12400, in both languages. */
function compact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

const TOPICS = ['forYou', 'bitcoin', 'ethereum', 'defi', 'solana', 'fa'];

/** Deterministic hue from a handle, so an author keeps the same mark. */
function hueOf(handle) {
  let h = 0;
  const s = String(handle || '?');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function Avatar({ author }) {
  const hue = hueOf(author?.handle);
  return (
    <span
      className="soc-avatar"
      aria-hidden="true"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 82% 58%), hsl(${(hue + 48) % 360} 82% 50%))`
      }}
    >
      {String(author?.name || author?.handle || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

function Count({ glyph, value, label }) {
  return (
    <span className="soc-count" title={label} aria-label={`${label}: ${value}`}>
      <span aria-hidden="true">{glyph}</span>
      {compact(value)}
    </span>
  );
}

function PostCard({ row, lang, t, onOpenThread, onOpenProfile, index = 0 }) {
  const [open, setOpen] = useState(false);
  const long = (row.text?.length ?? 0) > 260;
  const shown = long && !open ? `${row.text.slice(0, 260)}…` : row.text;

  return (
    /* The card body opens the thread INSIDE the app; the small external
       button is the only way out to Bluesky. */
    <motion.article className="soc-card" variants={riseIn} custom={index}>
      <header className="soc-head">
        <button type="button" className="soc-author" onClick={() => onOpenProfile(row.author.handle)}>
          <Avatar author={row.author} />
          <span className="soc-author-copy">
            <strong>{row.author.name}</strong>
            <span className="soc-handle">@{row.author.handle}</span>
          </span>
        </button>
        <span className="soc-time">{timeAgo(row.at, lang)}</span>
      </header>

      <button type="button" className="soc-body" onClick={() => onOpenThread(row)}>
        <p className="soc-text">{shown}</p>
      </button>

      {long && (
        <button type="button" className="soc-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('social.less') : t('social.more')}
        </button>
      )}

      <div className="soc-foot">
        <div className="soc-counts">
          <Count glyph="♥" value={row.likes} label={t('social.likes')} />
          <Count glyph="⇄" value={row.reposts} label={t('social.reposts')} />
          <Count glyph="💬" value={row.replies} label={t('social.replies')} />
          {row.media ? <span className="soc-media" title={t('social.hasMedia')} aria-label={t('social.hasMedia')}>◫</span> : null}
        </div>
        <button
          type="button"
          className="soc-open"
          onClick={(event) => {
            event.stopPropagation();
            openUrl(row.url);
          }}
        >
          {t('social.openOnBsky')}
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        </button>
      </div>
    </motion.article>
  );
}

export default function Social() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language?.startsWith('fa') ? 'fa' : 'en';

  const [topic, setTopic] = useState('forYou');
  const [limit, setLimit] = useState(PAGE);
  const [feed, setFeed] = useState({ rows: [], live: true });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const [trending, setTrending] = useState([]);
  /* `reachable` is ours, `live` is the server's. A question about connectivity
     is already answered by whether a browser can reach our own API, so no
     request is spent on /api/social/status. Offline, the refresh button stays
     enabled and the feed is not asked for at all. */
  const [reachable, setReachable] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [view, setView] = useState(null); // { type:'profile'|'thread', ... }
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState('');

  /* Guards against a slow answer for tab A landing after the user switched to
     tab B. Same pattern as the existing community panel. */
  const reqRef = useRef(0);
  const searchRef = useRef(0);

  const load = useCallback(async (which, size, { quiet = false } = {}) => {
    const id = ++reqRef.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    /* Offline: show a cached-elsewhere feed as unreachable WITHOUT asking a
       server we cannot reach. Measured on a device with no radio this saves a
       doomed round trip on every open. */
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

  /* Trending is a separate, slower call: it rotates on Bluesky's schedule, not
     ours, and the server caches it for fifteen minutes. */
  useEffect(() => {
    let alive = true;
    fetchTrending(6).then((rows) => {
      if (alive) setTrending(rows);
    });
    const online = () => setReachable(true);
    const offline = () => setReachable(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      alive = false;
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
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

  const trendChips = useMemo(() => trending.slice(0, 6), [trending]);

  /* ── one sub-view: profile or thread ─────────────────────────────────── */
  const subView = view && (
    <motion.div className="soc-sub" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}>
      <div className="soc-sub-head">
        <button type="button" className="soc-back" onClick={() => setView(null)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={lang === 'fa' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
          </svg>
          {view.type === 'profile' ? `@${view.actor}` : t('social.thread')}
        </button>
        <button type="button" className="soc-sub-open" onClick={() => openUrl(view.type === 'profile'
          ? `${BSKY_HOME}/profile/${encodeURIComponent(view.actor)}`
          : view.root?.url)}>
          {t('social.openOnBsky')}
        </button>
      </div>

      {view.loading ? (
        <div className="soc-feed" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="soc-skel"><span /><span /><span /></div>)}
        </div>
      ) : view.type === 'profile' ? (
        view.rows.length ? (
          <div className="soc-feed">
            {view.rows.map((row) => (
              <PostCard key={row.id} row={row} lang={lang} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />
            ))}
          </div>
        ) : (
          <p className="soc-empty-copy">{view.live ? t('social.emptyProfile') : t('social.offline')}</p>
        )
      ) : (
        <div className="soc-feed">
          {view.root && <PostCard row={view.root} lang={lang} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />}
          <p className="soc-sub-label">{t('social.replyCount', { n: view.replies.length })}</p>
          {view.replies.map((row) => (
            <div key={row.id} className="soc-replydepth">
              <PostCard row={row} lang={lang} t={t} onOpenThread={openThread} onOpenProfile={openProfile} />
            </div>
          ))}
          {!view.replies.length && <p className="soc-empty-copy">{t('social.noReplies')}</p>}
        </div>
      )}
    </motion.div>
  );

  return (
    <PageTransition>
      <div className="soc-page">
        {/* ── header ────────────────────────────────────────────────────── */}
        <div className="soc-title-row">
          <div className="soc-title-copy">
            <div className="soc-title-line">
              <h1>{t('social.title')}</h1>
              <span className={`soc-badge${live ? '' : ' is-off'}`}>
                <i aria-hidden="true" />
                {live ? t('social.live') : t('social.offlineBadge')}
              </span>
            </div>
            <p className="soc-sub">{t('social.subtitle')}</p>
          </div>
          <button
            type="button"
            className="soc-refresh"
            onClick={() => (results ? runSearch(query.trim()) : load(topic, limit, { quiet: true }))}
            disabled={refreshing || loading || searching}
            aria-label={t('social.refresh')}
          >
            <svg className={refreshing || loading ? 'soc-spin' : ''} viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
            </svg>
          </button>
        </div>

        {/* ── search ────────────────────────────────────────────────────── */}
        <label className="soc-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('social.searchPlaceholder')}
            aria-label={t('social.searchPlaceholder')}
            enterKeyHint="search"
          />
          {query && <button type="button" className="soc-clear" onClick={() => setQuery('')} aria-label={t('social.clearSearch')}>×</button>}
        </label>

        {/* ── topic tabs (hidden while searching) ───────────────────────── */}
        {!results && (
          <div className="soc-tabs" role="tablist" aria-label={t('social.title')}>
            {TOPICS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={topic === id}
                className={`soc-tab${topic === id ? ' is-on' : ''}`}
                onClick={() => setTopic(id)}
              >
                {t(`social.topic.${id}`)}
              </button>
            ))}
          </div>
        )}

        {/* ── trending ──────────────────────────────────────────────────── */}
        {!results && trendChips.length > 0 && (
          <div className="soc-trends" aria-label={t('social.trending')}>
            <span className="soc-trends-label">{t('social.trending')}</span>
            {trendChips.map((trend) => (
              <button key={trend.label} type="button" className="soc-trend" onClick={() => openUrl(trend.url)}>
                {trend.label}
              </button>
            ))}
          </div>
        )}

        <AnimatePresence mode="wait">
          {subView || (
            <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* ── accounts (search only) ──────────────────────────────── */}
              {results && results.accounts.length > 0 && (
                <div className="soc-accounts">
                  <p className="soc-sub-label">{t('social.accounts')}</p>
                  {results.accounts.map((actor) => (
                    <button key={actor.did} type="button" className="soc-account" onClick={() => openProfile(actor.handle)}>
                      <Avatar author={actor} />
                      <span className="soc-author-copy">
                        <strong>{actor.name}</strong>
                        <span className="soc-handle">@{actor.handle}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* ── feed ────────────────────────────────────────────────── */}
              {(loading || searching) ? (
                <div className="soc-feed" aria-busy="true">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="soc-skel"><span /><span /><span /></div>)}
                </div>
              ) : rows.length === 0 ? (
                <div className="soc-empty">
                  <span aria-hidden="true">🛰️</span>
                  <p>{results ? t('social.noResults', { q: query }) : live ? t('social.empty') : t('social.offline')}</p>
                  {!live && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(topic, limit)}>
                      {t('social.retry')}
                    </button>
                  )}
                </div>
              ) : (
                <motion.div className="soc-feed" variants={stagger} initial="hidden" animate="show">
                  {rows.map((row, index) => (
                    <PostCard
                      key={row.id}
                      row={row}
                      index={index}
                      lang={lang}
                      t={t}
                      onOpenThread={openThread}
                      onOpenProfile={openProfile}
                    />
                  ))}
                </motion.div>
              )}

              {canLoadMore && (
                <button type="button" className="btn btn-ghost soc-loadmore" onClick={loadMore} disabled={refreshing}>
                  {t('social.loadMore')}
                </button>
              )}

              {updatedAt > 0 && !results && (
                <p className="soc-updated">{t('social.updated')} {timeAgo(updatedAt, lang)}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── compose: opens Bluesky's composer, never posts for the user ── */}
        <AnimatePresence>
          {composeOpen && (
            <motion.div className="soc-compose" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }}>
              <p className="soc-compose-note">{t('social.composeNote')}</p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 280))}
                placeholder={t('social.composePlaceholder')}
                rows={3}
                aria-label={t('social.composePlaceholder')}
              />
              <div className="soc-compose-actions">
                <span className="soc-charline">{280 - draft.length}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComposeOpen(false)}>
                  {t('social.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm soc-compose-go"
                  disabled={!draft.trim()}
                  onClick={() => {
                    openUrl(composeUrl(draft));
                    setComposeOpen(false);
                  }}
                >
                  {t('social.composeGo')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="soc-actions">
          <button type="button" className="btn soc-write" onClick={() => setComposeOpen((v) => !v)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            {t('social.write')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openUrl(BSKY_HOME)}>
            {t('social.openBluesky')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
            {t('social.settings')}
          </button>
        </div>

        {/* A feed inside an exchange reads as endorsed unless it says otherwise. */}
        <p className="soc-notice">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" />
          </svg>
          <span>{t('social.notice')}</span>
        </p>
      </div>
    </PageTransition>
  );
}
