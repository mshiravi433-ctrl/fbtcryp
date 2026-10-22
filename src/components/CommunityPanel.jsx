import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn, stagger } from './PageTransition';
import { FARCASTER_HOME, fetchCommunity } from '../lib/community';
import { openUrl } from '../lib/browser';
import { timeAgo } from '../lib/format';
import { IconExternal } from './Icons';
import '../styles/community-modern.css';

/**
 * THE COMMUNITY FEED — modern redesign.
 * ===========================================================================
 * Requested: «در اخبار، تب فید گفتگو را خیلی مدرن‌تر و کارایی‌اش را بهتر کن».
 *
 * Still read-only and still hosted by Farcaster (see lib/community.js for
 * why we never hold a signing key) — what changed is everything around the
 * reading experience:
 *
 *   · A live hero with an animated orbit, a REAL live/offline badge, and the
 *     two facts a reader wants first: how many posts, updated when.
 *   · A working toolbar: instant in-feed search (text + author), a manual
 *     refresh that spins while it works, and an optional 90-second
 *     auto-refresh that pauses while the tab is hidden.
 *   · Channel pills with icons and an animated active state.
 *   · Richer post cards: deterministic gradient avatars, linkified URLs,
 *     highlighted #hashtags / $tickers / @mentions, expand/collapse for long
 *     posts, one-tap copy, and the external open action.
 *   · «Load more» that actually asks the hub for more (20 → 40 → 60),
 *     distinct empty states for "channel is quiet", "search found nothing"
 *     and "feed unreachable".
 *
 * Long-post clamping, linkification and search are pure render work over the
 * rows already on screen — no extra request, no new storage.
 */

const CHANNELS = [
  { id: 'crypto', glyph: '₿' },
  { id: 'base', glyph: 'B' },
  { id: 'dev', glyph: '</>' }
];

const PAGE = 20;
const MAX_LIMIT = 60;
const CLAMP_AT = 260;

/* A stable hue per author, so the same person always wears the same colour. */
function hueFor(name) {
  let h = 0;
  const s = String(name || '?');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/* URLs, #hashtags, $tickers and @mentions become styled spans; URLs open. */
const TOKEN_RE = /(https?:\/\/[^\s]+)|(#[\p{L}\p{N}_]+)|(\$[A-Za-z]{2,10})|(@[\p{L}\p{N}._-]+)/gu;

function RichText({ text }) {
  const parts = useMemo(() => {
    const out = [];
    let last = 0;
    let m;
    const src = String(text || '');
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(src)) !== null) {
      if (m.index > last) out.push({ t: src.slice(last, m.index), k: 'txt' });
      if (m[1]) out.push({ t: m[1], k: 'link' });
      else if (m[2] || m[3]) out.push({ t: m[0], k: 'tag' });
      else out.push({ t: m[0], k: 'mention' });
      last = m.index + m[0].length;
    }
    if (last < src.length) out.push({ t: src.slice(last), k: 'txt' });
    return out;
  }, [text]);

  return (
    <>
      {parts.map((p, i) =>
        p.k === 'link' ? (
          <button key={i} type="button" className="cmt2-link" onClick={() => openUrl(p.t.replace(/[).,]+$/, ''))}>
            {p.t}
          </button>
        ) : p.k === 'tag' ? (
          <span key={i} className="cmt2-tag">{p.t}</span>
        ) : p.k === 'mention' ? (
          <span key={i} className="cmt2-mention">{p.t}</span>
        ) : (
          <span key={i}>{p.t}</span>
        )
      )}
    </>
  );
}

function Cast({ row, lang }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hue = hueFor(row.author);
  const long = String(row.text || '').length > CLAMP_AT;
  const shown = !long || open ? row.text : `${String(row.text).slice(0, CLAMP_AT).trimEnd()}…`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(row.text || ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard needs a secure context; the Open action still works. */
    }
  };

  return (
    <motion.article variants={riseIn} className="cmt2-row">
      <div className="cmt2-head">
        <span
          className="cmt2-avatar"
          aria-hidden="true"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${(hue + 55) % 360} 85% 52%))`
          }}
        >
          {String(row.author || '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="cmt2-author">@{row.author}</span>
        <span className="cmt2-time">{timeAgo(row.at, lang)}</span>
      </div>

      <p className="cmt2-text"><RichText text={shown} /></p>

      {long && (
        <button type="button" className="cmt2-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('community.less', { defaultValue: 'کمتر' }) : t('community.more', { defaultValue: 'خواندن ادامه' })}
        </button>
      )}

      <div className="cmt2-foot">
        {row.embeds > 0 ? (
          <span className="cmt2-embed">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 1 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/></svg>
            {t('community.attachments', { n: row.embeds })}
          </span>
        ) : null}
        <span className="cmt2-actions">
          <button type="button" className={`cmt2-act${copied ? ' is-done' : ''}`} onClick={copy}>
            {copied ? `✓ ${t('community.copied', { defaultValue: 'کپی شد' })}` : t('community.copy', { defaultValue: 'کپی' })}
          </button>
          <button type="button" className="cmt2-act cmt2-act--open" onClick={() => openUrl(row.url)} aria-label={t('community.openIn')}>
            {t('community.openIn')}
            <IconExternal width={12} height={12} />
          </button>
        </span>
      </div>
    </motion.article>
  );
}

export default function CommunityPanel() {
  const { t, i18n } = useTranslation();

  const [channel, setChannel] = useState('crypto');
  const [limit, setLimit] = useState(PAGE);
  const [state, setState] = useState({ rows: [], live: true });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  /* Guards against a slow response for channel A landing after the user has
     already switched to channel B (kept from the previous implementation). */
  const reqRef = useRef(0);

  const load = useCallback(async (ch, lim, { quiet = false } = {}) => {
    const id = ++reqRef.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    const data = await fetchCommunity(ch, lim);
    if (reqRef.current !== id) return;
    setState(data);
    setUpdatedAt(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    setLimit(PAGE);
    load(channel, PAGE);
  }, [channel, load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load(channel, limit, { quiet: true });
    }, 90_000);
    return () => clearInterval(timer);
  }, [autoRefresh, channel, limit, load]);

  const loadMore = () => {
    const next = Math.min(MAX_LIMIT, limit + PAGE);
    setLimit(next);
    load(channel, next, { quiet: true });
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.rows;
    return state.rows.filter((r) =>
      `${r.text || ''} @${r.author || ''}`.toLowerCase().includes(q)
    );
  }, [state.rows, query]);

  const lang = i18n.language?.startsWith('fa') ? 'fa' : 'en';
  const canLoadMore = !query && state.live && state.rows.length >= limit && limit < MAX_LIMIT;

  return (
    <div className="cmt2">
      {/* ── hero ──────────────────────────────────────────────────────── */}
      <motion.section className="cmt2-hero" variants={riseIn} initial="hidden" animate="show">
        <div className="cmt2-orbit" aria-hidden="true">
          <span className="cmt2-orbit-ring" />
          <span className="cmt2-orbit-ring cmt2-orbit-ring--2" />
          <span className="cmt2-orbit-sat" />
          <span className="cmt2-orbit-core">✦</span>
        </div>
        <div className={`cmt2-live${state.live ? '' : ' is-off'}`}>
          <span aria-hidden="true" />
          {state.live
            ? t('community.liveNow', { defaultValue: 'FARCASTER · زنده' })
            : t('community.offlineBadge', { defaultValue: 'FARCASTER · قطع' })}
        </div>
        <h2>{t('community.title')}</h2>
        <p>{t('community.intro')}</p>
        <div className="cmt2-hero-stats">
          <span className="cmt2-chip">
            <strong className="mono">{state.rows.length}</strong>
            {t('community.postsCount', { defaultValue: 'پست' })}
          </span>
          <span className="cmt2-chip">{t(`community.channel.${channel}`)}</span>
          {updatedAt > 0 && (
            <span className="cmt2-chip">
              {t('community.updated', { defaultValue: 'به‌روزرسانی' })} {timeAgo(updatedAt, lang)}
            </span>
          )}
        </div>
      </motion.section>

      {/* ── toolbar: channels + search + refresh ──────────────────────── */}
      <div className="cmt2-toolbar">
        <div className="cmt2-tabs" role="tablist" aria-label={t('community.title')}>
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={channel === c.id}
              className={`cmt2-tab${channel === c.id ? ' is-on' : ''}`}
              onClick={() => setChannel(c.id)}
            >
              <span className="cmt2-tab-glyph" aria-hidden="true">{c.glyph}</span>
              {t(`community.channel.${c.id}`)}
            </button>
          ))}
        </div>

        <div className="cmt2-tools">
          <label className="cmt2-search">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('community.search', { defaultValue: 'جستجو در فید…' })}
              aria-label={t('community.search', { defaultValue: 'جستجو در فید…' })}
            />
            {query && (
              <button type="button" className="cmt2-clear" onClick={() => setQuery('')} aria-label="×">×</button>
            )}
          </label>
          <button
            type="button"
            className={`cmt2-iconbtn${autoRefresh ? ' is-on' : ''}`}
            onClick={() => setAutoRefresh((v) => !v)}
            aria-pressed={autoRefresh}
            title={t('community.autoRefresh', { defaultValue: 'به‌روزرسانی خودکار' })}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button
            type="button"
            className="cmt2-iconbtn"
            onClick={() => load(channel, limit, { quiet: true })}
            aria-label={t('community.refresh', { defaultValue: 'تازه‌سازی' })}
            disabled={refreshing || loading}
          >
            <svg className={(refreshing || loading) ? 'cmt2-spin' : ''} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
          </button>
        </div>
      </div>

      {/* ── feed ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="cmt2-feed" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="cmt2-skel">
              <span className="cmt2-skel-avatar" />
              <span className="cmt2-skel-line" style={{ width: '38%' }} />
              <span className="cmt2-skel-line" />
              <span className="cmt2-skel-line" style={{ width: '72%' }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="cmt2-empty">
          <span className="cmt2-empty-icon" aria-hidden="true">💬</span>
          <p>
            {query
              ? t('community.noSearchResults', { defaultValue: 'چیزی با این جستجو پیدا نشد.', q: query })
              : state.live
                ? t('community.empty')
                : t('community.offline')}
          </p>
          {query ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setQuery('')}>
              {t('community.clearSearch', { defaultValue: 'پاک کردن جستجو' })}
            </button>
          ) : !state.live ? (
            <button className="btn btn-ghost btn-sm" onClick={() => load(channel, limit)}>
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <motion.div
            key={`${channel}-${query ? 'q' : 'all'}`}
            className="cmt2-feed"
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {rows.map((row) => <Cast key={row.hash} row={row} lang={lang} />)}
          </motion.div>
          {canLoadMore && (
            <button type="button" className="btn btn-ghost cmt2-loadmore" onClick={loadMore} disabled={refreshing}>
              {t('community.loadMore', { defaultValue: 'پست‌های بیشتر' })}
            </button>
          )}
        </>
      )}

      {/* ── join CTA ──────────────────────────────────────────────────── */}
      <motion.section className="cmt2-join" variants={riseIn} initial="hidden" animate="show">
        <div className="cmt2-join-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>
        </div>
        <div className="cmt2-join-copy">
          <strong>{t('community.joinTitle')}</strong>
          <p>{t('community.joinBody')}</p>
        </div>
        <button className="btn cmt2-join-btn" onClick={() => openUrl(FARCASTER_HOME)}>
          {t('community.openFarcaster')}
        </button>
      </motion.section>

      {/* A feed inside an exchange reads as endorsed unless it says otherwise. */}
      <p className="cmt2-notice">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z"/></svg>
        <span>{t('community.notice')}</span>
      </p>
    </div>
  );
}
