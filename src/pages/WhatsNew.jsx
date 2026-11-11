import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { isRtl } from '../i18n/languages';
import '../styles/whats-new.css';

/* ==========================================================================
   WHAT'S NEW — «چه چیزی جدید است؟»
   --------------------------------------------------------------------------
   ─── THE QUESTION THIS ANSWERS ────────────────────────────────────────────
   «برای ارتقا و دیدن تغییرات باید صفحه‌ای باشد که تغییرات را دید.» Until now
   the only record of what shipped was CHANGELOG.md in the repository: correct,
   complete, and invisible to anyone using the product. Every release therefore
   looked like no release — the site renders the same shell before and after.

   ─── WHY THERE IS NO SERVER CALL HERE ─────────────────────────────────────
   The data is a static file generated at build time by
   scripts/gen-whats-new.mjs. This screen must be the cheapest screen in the
   app: it is read-only, it changes once per deploy, and the deployment that
   shipped it is exactly the last entry. A route on the API would mean a
   function invocation and a cold start for a list of dates — which is the
   class of cost that produced the 2026-11-10 `fluidCpuDuration` soft block.

   The fetch is lazy in the real sense: this component is a route-level chunk,
   so nothing is requested until someone opens /#/whats-new.

   ─── WHAT IT WILL NOT SHOW ────────────────────────────────────────────────
   · Nothing that is not in the changelog. No "improvements and bug fixes"
     filler, no marketing line, no invented version number.
   · No relative-time guessing («۳ ساعت پیش»). A date that is shown must be
     the date the work landed, and that is a fact in the file.
   · No total-count lie: when the JSON carries only the newest 80 entries, the
     footer says how many older ones exist and links to the full file.
   ========================================================================== */

/** The build-time asset, resolved against the app's base so the packaged
    Android shell (https://localhost) reads its own bundled copy rather than a
    backend that is not reachable from inside the WebView. */
const DATA_URL = `${import.meta.env?.BASE_URL || '/'}whats-new.json`;

const FILTERS = [
  { id: 'all', days: 0 },
  { id: 'month', days: 30 },
  { id: 'week', days: 7 }
];

const DAY_MS = 86_400_000;

/** ISO date → the reader's calendar, in the reader's digits. */
function formatDate(iso, locale) {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  } catch {
    return iso;
  }
}

function useWhatsNew() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const ctrlRef = useRef(null);

  const load = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await fetch(DATA_URL, { signal: ctrl.signal, credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.entries)) throw new Error('BAD_SHAPE');
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setState({ status: 'error', data: null, error: String(err?.message || err).slice(0, 80) });
    }
  }, []);

  useEffect(() => {
    load();
    return () => ctrlRef.current?.abort();
  }, [load]);

  return { ...state, reload: load };
}

export default function WhatsNew() {
  const { i18n } = useTranslation();
  const lang = String(i18n.language || 'fa');
  const fa = lang.startsWith('fa');
  /* Two languages are written here; the other ten read the English copy rather
     than the i18next key path (`whatsNew.title`), which is what shipped before
     and looks like a bug on a screen whose whole job is credibility. */
  const tr = useCallback((faText, enText) => (fa ? faText : enText), [fa]);
  const { status, data, error, reload } = useWhatsNew();
  const [filter, setFilter] = useState('all');

  const entries = data?.entries ?? [];

  /* Newest date in the file decides what "این هفته" means — not the visitor's
     clock, which can be days ahead of the last release and would then show an
     empty screen that looks broken. */
  const newest = useMemo(() => {
    const iso = data?.latest || entries[0]?.date;
    const t = iso ? new Date(`${iso}T12:00:00Z`).getTime() : NaN;
    return Number.isNaN(t) ? null : t;
  }, [data, entries]);

  const visible = useMemo(() => {
    const days = FILTERS.find((f) => f.id === filter)?.days ?? 0;
    if (!days || newest == null) return entries;
    const cutoff = newest - (days - 1) * DAY_MS;
    return entries.filter((entry) => {
      const t = new Date(`${entry.date}T12:00:00Z`).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [entries, filter, newest]);

  const locale = useMemo(() => {
    const base = String(i18n.language || 'en');
    try {
      /* Falls back to the raw tag when the browser lacks the locale, so a
         missing fa-IR does not silently render US dates on a Persian screen. */
      new Intl.DateTimeFormat(base);
      return base;
    } catch {
      return 'en-GB';
    }
  }, [i18n.language]);

  useEffect(() => {
    const title = tr('تغییرات و به‌روزرسانی‌ها | FBT Swap', "What's New | FBT Swap");
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [tr]);

  const dir = isRtl(lang) ? 'rtl' : 'ltr';

  return (
    <PageTransition>
      <div className="wn-page" dir={dir}>
        <header className="wn-head">
          <p className="wn-eyebrow">✦ {tr('تغییرات محصول', 'PRODUCT UPDATES')}</p>
          <h1 className="wn-title">{tr('چه چیزی جدید است؟', "What's new")}</h1>
          <p className="wn-sub">
            {data?.latest ? (
              <>
                {tr('آخرین به‌روزرسانی: ', 'Latest update: ')}
                <b>{formatDate(data.latest, locale)}</b>
                {' · '}
                {tr(`${data.shown} مورد اخیر`, `last ${data.shown} entries`)}
              </>
            ) : (
              tr('هر تغییری که روی سایت اعمال می‌شود، این‌جا ثبت می‌شود.', 'Every change shipped to the site is recorded here.')
            )}
          </p>
        </header>

        {status === 'ready' && entries.length > 0 && (
          <>
            <div className="wn-filters" role="group" aria-label={tr('بازهٔ نمایش', 'Range')}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="wn-chip"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.id === 'all'
                    ? tr('همه', 'All')
                    : f.id === 'month'
                      ? tr('۳۰ روز گذشته', 'Last 30 days')
                      : tr('۷ روز گذشته', 'Last 7 days')}
                </button>
              ))}
            </div>
            <p className="wn-count">
              {visible.length === 0
                ? tr('در این بازه تغییری ثبت نشده است.', 'No changes in this range.')
                : tr(`${visible.length} مورد`, `${visible.length} entries`)}
            </p>
          </>
        )}

        {status === 'loading' && (
          <div className="wn-list" aria-busy="true">
            <div className="wn-skel" />
            <div className="wn-skel" />
            <div className="wn-skel" />
          </div>
        )}

        {status === 'error' && (
          <div className="wn-state" role="alert">
            <p>{tr('لیست تغییرات خوانده نشد.', 'Could not read the change list.')}</p>
            <p style={{ opacity: 0.65, fontSize: 11 }}>{error}</p>
            <button type="button" onClick={reload}>
              {tr('تلاش دوباره', 'Try again')}
            </button>
          </div>
        )}

        {status === 'ready' && entries.length === 0 && (
          <div className="wn-state">
            <p>{tr('هنوز تغییری ثبت نشده است.', 'No changes recorded yet.')}</p>
            <p style={{ opacity: 0.65, fontSize: 11 }}>
              {tr(
                'این صفحه از CHANGELOG.md ساخته می‌شود و در هر بیلد به‌روز می‌شود.',
                'This page is generated from CHANGELOG.md on every build.'
              )}
            </p>
          </div>
        )}

        {status === 'ready' && visible.length > 0 && (
          <ul className="wn-list">
            {visible.map((entry) => {
              const isNewest = data?.latest && entry.date === data.latest;
              return (
                <li key={`${entry.date}-${entry.title}`} className="wn-card">
                  <div className="wn-card-top">
                    <time className="wn-date" dateTime={entry.date}>
                      {formatDate(entry.date, locale)}
                    </time>
                    {isNewest && <span className="wn-new">{tr('جدید', 'NEW')}</span>}
                  </div>
                  <h2 className="wn-card-title">{entry.title}</h2>
                  {entry.bullets?.length > 0 && (
                    <ul className="wn-points">
                      {entry.bullets.map((point, index) => (
                        <li key={index}>{point}</li>
                      ))}
                    </ul>
                  )}
                  {entry.detail && (
                    <a
                      className="wn-detail"
                      href={entry.detail}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {tr('جزئیات کامل', 'Full details')} ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {status === 'ready' && data?.olderCount > 0 && (
          <p className="wn-foot">
            {tr(
              `${data.olderCount} تغییر قدیمی‌تر در فایل کامل تاریخچه است.`,
              `${data.olderCount} older entries are in the full changelog.`
            )}{' '}
            <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">
              {tr('مشاهدهٔ همه', 'See all')}
            </a>
          </p>
        )}

        <p className="wn-foot">
          <Link to="/help">{tr('سؤالی داری؟ پشتیبانی', 'Questions? Support')}</Link>
        </p>
      </div>
    </PageTransition>
  );
}
