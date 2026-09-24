import { useEffect, useRef, useState } from 'react';
import '../styles/rwa-banners.css';

/*
 * RwaHorizonSwapBanners — two minimal banners that swap HORIZONTALLY.
 *
 * Request, verbatim: «ببین اصلا فلیپ کارت نباشه یجور دوتا بنر به صورت سواپ
 * افقی باشد و مینیمال تر با گردی گوشه ها باشد متناسب با تم و زبان و ایفون و
 * اندروید و کامپیوتر و متن کمتر و مینیمال تر قشنگ باشد خیلی مینیمال و مدرن تر
 * و قشنگ تر» — the RWA / Global-Horizon flip card on the stocks page was
 * «خیلی بزرگه و شلوغه، خیلی متن داره», and on iPhone the two faces painted on
 * top of each other while rotating.
 *
 * What this is instead:
 *
 *  - NO 3D. No preserve-3d, no backface-visibility, no rotateY — the class of
 *    paint bug that made the iPhone show both faces at once simply cannot
 *    exist. One slide is visible at a time; the track slides 50% sideways.
 *  - TWO SLIDES, HORIZONTAL SWAP — the track translates along the inline
 *    axis, direction-aware (RTL slides the other way an RTL reader expects).
 *  - MINIMAL TEXT — a title, one short line, a dot indicator. The old card
 *    carried an eyebrow, a badge, a two-part title, a sub, three or four
 *    chips, two feature lines and a CTA button; every one of those is gone.
 *  - THEME-AWARE — the surface, line and text colours come from the app's
 *    tokens (var(--bg-panel) …), so light and dark themes both read, unlike
 *    the old always-dark glass.
 *  - ROUNDED CORNERS, one radius, on every platform; the slide sizes are
 *    fluid (no 3D stage to overflow), so iPhone, Android and desktop all get
 *    the same layout with nothing to clip.
 *
 * Behaviour kept from the card it replaces (it was earned, not ornamental):
 *  - autoplay advances on its own (10s) and pauses on real hover only — a
 *    touch tap must never pause it (the synthetic-mouseenter bug);
 *  - a hidden tab or prefers-reduced-motion stops the motion;
 *  - the language rule is the one the owner set: Persian if and only if the
 *    language is Persian, English for everything else.
 */

/* 10s per slide — the swap is visible but never distracting. */
const AUTO_MS = 10000;
const COUNT = 2;

/* ─── tiny animated glyphs (drawn, not borrowed) ───────────────────────── */

/** Gold bars — RWA's whole pitch in one stroke picture. */
function RwaGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g className="rhs-float">
        <path d="M4.2 19.5h5.6l-1.5-4.6H5.7z" fill="currentColor" opacity="0.9" />
        <path d="M14.2 19.5h5.6l-1.5-4.6h-2.6z" fill="currentColor" opacity="0.65" />
        <path d="M9.2 14.2h5.6l-1.5-4.6h-2.6z" fill="currentColor" />
        <path className="rhs-shine" d="M4.2 19.5h15.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.5" />
      </g>
    </svg>
  );
}

/** Globe + orbiting node — the horizon in one picture. */
function HorizonGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="3.1" ry="7.2" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <path d="M4.8 12h14.4" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <g className="rhs-orbit">
        <circle cx="12" cy="3.2" r="1.5" fill="currentColor" />
      </g>
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/* ─── one slide ─────────────────────────────────────────────────────────── */

function Slide({ tone, active, title, sub, ariaLabel, onGo, children }) {
  return (
    <button
      type="button"
      className={`rhs-slide rhs-slide--${tone} ${active ? 'is-active' : ''}`}
      aria-label={ariaLabel}
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      onClick={onGo}
    >
      <span className={`rhs-icon rhs-icon--${tone}`} aria-hidden="true">{children}</span>
      <span className="rhs-text">
        <span className="rhs-title">{title}</span>
        <span className="rhs-sub">{sub}</span>
      </span>
      <span className="rhs-go" aria-hidden="true"><Arrow /></span>
    </button>
  );
}

/* ─── main ──────────────────────────────────────────────────────────────── */

export default function RwaHorizonSwapBanners({ onGoRwa, onGoHorizon, haptic, isRTL, lang }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [canHover, setCanHover] = useState(true);
  const touchRef = useRef(null);

  const l = String(lang || '').toLowerCase();
  /*
   * ─── ONLY PERSIAN GETS PERSIAN — the same rule the flip card was pinned to
   * («وقتی روی زبانی به غیر فارسی و انگلیسی باشد … باید انگلیسی باشد»).
   * `isRTL` says which way the text runs, never which language it is.
   */
  const isEn = !l.startsWith('fa');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduced(Boolean(mq?.matches));
    onMq();
    mq?.addEventListener?.('change', onMq);
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    /*
     * Hover-to-pause only exists where there is a real hover. A touch tap
     * fires a synthetic `mouseenter` nothing ever answers with a
     * `mouseleave`, so on a phone the first tap would pause the swap for
     * good — the exact capability this component is meant to have.
     */
    const hoverMq = window.matchMedia?.('(hover: hover)');
    const onHover = () => setCanHover(Boolean(hoverMq?.matches));
    onHover();
    hoverMq?.addEventListener?.('change', onHover);
    return () => {
      mq?.removeEventListener?.('change', onMq);
      hoverMq?.removeEventListener?.('change', onHover);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const autoplay = !paused && !reduced && !hidden;

  /* one timeout per position, so the rhythm can never stack up */
  useEffect(() => {
    if (!autoplay) return undefined;
    const t = setTimeout(() => setIndex((i) => (i + 1) % COUNT), AUTO_MS);
    return () => clearTimeout(t);
  }, [autoplay, index]);

  const choose = (next) => {
    haptic?.('select');
    setIndex(((next % COUNT) + COUNT) % COUNT);
  };

  const go = (tone) => (e) => {
    e?.stopPropagation?.();
    haptic?.('select');
    if (tone === 'rwa') onGoRwa?.();
    else onGoHorizon?.();
  };

  /* swipe: in RTL the "next" slide sits physically LEFT of the current one,
     so a finger moving RIGHT advances — the mirror of an LTR reader. */
  const onTouchStart = (e) => {
    const t = e.touches?.[0];
    if (t) touchRef.current = { x: t.clientX };
  };
  const onTouchEnd = (e) => {
    const s = touchRef.current;
    touchRef.current = null;
    const t = e.changedTouches?.[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    if (Math.abs(dx) < 36) return;
    const forward = isRTL ? dx > 0 : dx < 0;
    choose(index + (forward ? 1 : -1));
  };

  const rwa = {
    title: isEn ? 'Real-World Assets' : 'دارایی‌های واقعی',
    sub: isEn ? 'Gold · Treasuries · Robinhood' : 'طلا · خزانه · رابین‌هود',
    ariaLabel: isEn ? 'Open Real-World Assets' : 'ورود به بخش دارایی‌های واقعی RWA'
  };
  const hz = {
    title: isEn ? 'Global Horizon' : 'افق جهانی',
    sub: isEn ? 'Forex · Gold · Stocks · Indices' : 'فارکس · طلا · سهام · شاخص‌ها',
    ariaLabel: isEn ? 'Open Global Horizon markets' : 'ورود به بازارهای افق جهانی'
  };

  /* The track keeps the page direction, so in RTL slide 0 sits at the right
     edge and "next" travels to the left — the shift below is its sign. */
  const shift = index * (isRTL ? 50 : -50);

  return (
    <section
      className={`rhs ${autoplay ? '' : 'is-paused'}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-slide={index === 0 ? 'rwa' : 'hz'}
      onMouseEnter={() => { if (canHover) setPaused(true); }}
      onMouseLeave={() => { if (canHover) setPaused(false); }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      aria-roledescription={isEn ? 'auto-rotating banner' : 'بنر چرخشی'}
    >
      <div className="rhs-viewport">
        <div className="rhs-track" style={{ transform: `translateX(${shift}%)` }}>
          <Slide tone="rwa" active={index === 0} title={rwa.title} sub={rwa.sub} ariaLabel={rwa.ariaLabel} onGo={go('rwa')}>
            <RwaGlyph />
          </Slide>
          <Slide tone="hz" active={index === 1} title={hz.title} sub={hz.sub} ariaLabel={hz.ariaLabel} onGo={go('hz')}>
            <HorizonGlyph />
          </Slide>
        </div>
      </div>

      {/* The whole indicator: two dots. The active one stretches into a pill. */}
      <div className="rhs-dots">
        {[0, 1].map((i) => (
          <button
            key={i}
            type="button"
            className={`rhs-dot ${index === i ? 'is-on' : ''}`}
            aria-label={i === 0 ? (isEn ? 'Real-World Assets banner' : 'بنر دارایی‌های واقعی') : (isEn ? 'Global Horizon banner' : 'بنر افق جهانی')}
            aria-current={index === i}
            onClick={() => choose(i)}
          />
        ))}
      </div>
    </section>
  );
}
