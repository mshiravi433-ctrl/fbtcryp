import { useEffect, useId, useRef, useState } from 'react';
import '../styles/rwa-banners.css';

/*
 * RwaHorizonSwapBanners — the RWA / Global-Horizon banner on the stocks page
 * («سهام توکنیزه» tab). Two slides that swap HORIZONTALLY inside one
 * animated, theme-aware glass slab.
 *
 * Request, verbatim (2026-09-25): «دکمه چپ و راست را در بنر مخفی کن · تم
 * مناسب و زبان مناسب · بنر باید ایکون مدرن و انیمیشن بیشتر و باکس بسیار مدرن
 * تر و خاص تر شود … اندازه هم میتونی کمی بزرگتر شود».
 *
 * ─── THE «LEFT AND RIGHT BUTTONS» WERE A BUG, NOT A FEATURE ────────────────
 * The previous banner drew its two 5px indicator dots as <button>s. The app's
 * global tap-target rule (`button { min-height: 44px; min-width: 44px }`,
 * src/index.css) inflated each dot into a 44px disc, so what the owner saw
 * was two big grey circles sitting in the middle of the banner, on top of the
 * subtitle — one on the left, one on the right of centre. Those are gone:
 *
 *  - the indicator is now a pair of hairline SEGMENTS (<span>, not <button>),
 *    so no global button rule can ever touch them; the active segment fills
 *    over the 10-second dwell, which is also how the banner says «this
 *    rotates on its own» without a control;
 *  - the circular «go» arrow at the end of each slide is gone too — the whole
 *    slide was already the tap target, the arrow was a second, redundant
 *    button that read as a carousel control;
 *  - the ONLY <button>s left are the two slides themselves. Keyboard users
 *    switch with the arrow keys; touch users swipe; everyone else waits ten
 *    seconds.
 *
 * ─── WHAT THE BOX IS NOW ───────────────────────────────────────────────────
 *  - one glass surface built from the app's own tokens (var(--bg-panel),
 *    var(--line), var(--text-…)) so dark and light both read as native;
 *  - two aurora glow fields — one per slide's palette (gold/violet for RWA,
 *    cyan/mint for the horizon) — that drift slowly and cross-fade with the
 *    slide, so the whole box changes mood with the content;
 *  - a comet of light travelling around the border, a light sweep across the
 *    glass every few seconds, a faint dot grid for depth;
 *  - a 60px "orb" icon: two counter-rotating rings around a glass core that
 *    holds a drawn glyph with its own life (an orbiting token and a shimmer
 *    on the ingots; a turning meridian, a self-drawing trend line and a
 *    satellite on the globe);
 *  - a self-drawing sparkline in the trailing half of each slide, masked so
 *    it never competes with the title.
 *
 * Every animation is transform/opacity (compositor work), except the two
 * dash-offset line draws, which are tiny SVG paths. Decorations on the
 * inactive slide are paused; prefers-reduced-motion switches all of them off
 * and leaves a still, fully legible banner.
 *
 * Behaviour kept from the banner this replaces (it was earned, not
 * ornamental):
 *  - NO 3D anywhere — the iPhone face-over-face paint bug has no geometry to
 *    happen in; the track slides 50% along the inline axis, RTL-aware;
 *  - autoplay advances on its own (10s) and pauses on real hover only — a
 *    touch tap must never pause it (the synthetic-mouseenter bug);
 *  - a hidden tab or prefers-reduced-motion stops the motion;
 *  - the language rule is the one the owner set: Persian if and only if the
 *    language is Persian, English for everything else.
 */

/* 10s per slide — the swap is visible but never distracting. */
const AUTO_MS = 10000;
const COUNT = 2;

/* ─── the glyphs (drawn, not borrowed) ──────────────────────────────────── */

/**
 * RWA — three ingots with a shimmer, a token on its own orbit and a
 * four-point sparkle. `currentColor` is the slide accent; the secondary
 * accent comes through the `--acc2` custom property the stylesheet sets.
 */
function RwaGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g className="rhs-g-bars">
        <path d="M3.3 18.9h6.8l-1.4-4.4H4.7z" fill="currentColor" opacity="0.72" />
        <path d="M13.9 18.9h6.8l-1.4-4.4h-4z" fill="currentColor" opacity="0.72" />
        <path d="M8.6 13.4h6.8L14 9h-4z" fill="currentColor" />
        <path className="rhs-g-shine" d="M10.6 10.3h2.2" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
      </g>
      <path d="M3 20.7h18" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
      <g className="rhs-g-orbit">
        <circle cx="12" cy="3.1" r="1.55" fill="var(--acc2)" />
      </g>
      <path
        className="rhs-g-spark"
        d="M19.3 3.6l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Global Horizon — a globe whose meridian turns, a trend line that draws
 * itself across the lower-right, and a satellite on a slow orbit.
 */
function HorizonGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="12.4" r="7" stroke="currentColor" strokeWidth="1.5" />
      <ellipse className="rhs-g-meridian" cx="11" cy="12.4" rx="3" ry="7" stroke="currentColor" strokeWidth="1.1" opacity="0.72" />
      <path d="M4 12.4h14" stroke="currentColor" strokeWidth="1.1" opacity="0.72" />
      <path d="M5.4 8.9h11.2M5.4 15.9h11.2" stroke="currentColor" strokeWidth="0.9" opacity="0.38" />
      <path
        className="rhs-g-trend"
        d="M13.2 20.2l3-3.1 2 1.7 3.6-4.3"
        stroke="var(--acc2)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="rhs-g-trend-head"
        d="M19.4 14.4h2.5v2.5"
        stroke="var(--acc2)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="rhs-g-orbit">
        <circle cx="11" cy="3.4" r="1.4" fill="currentColor" />
      </g>
    </svg>
  );
}

/* ─── the orb: two rings around a glass core ────────────────────────────── */

function Orb({ children }) {
  return (
    <span className="rhs-orb" aria-hidden="true">
      <svg className="rhs-ring" viewBox="0 0 64 64" fill="none">
        <circle className="rhs-ring-dash" cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1" strokeDasharray="2.5 5.5" strokeLinecap="round" />
        <circle className="rhs-ring-arc" cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="1.6" strokeDasharray="34 130" strokeLinecap="round" />
      </svg>
      <span className="rhs-orb-core">{children}</span>
    </span>
  );
}

/* ─── the sparkline art in the trailing half of a slide ─────────────────── */

const SPARK = {
  /* a steady, bond-like climb */
  rwa: 'M0 50C18 48 30 43 48 40S82 34 98 29 130 21 150 15',
  /* a livelier, forex-like climb */
  hz: 'M0 52L18 44 34 47 52 36 70 41 88 26 106 31 124 18 138 22 150 9'
};
const SPARK_END = { rwa: [150, 15], hz: [150, 9] };

function SparkArt({ tone }) {
  const gid = useId().replace(/:/g, '');
  const d = SPARK[tone];
  const [ex, ey] = SPARK_END[tone];
  return (
    <span className="rhs-art" aria-hidden="true">
      <svg viewBox="0 0 160 64" preserveAspectRatio="xMaxYMax meet">
        <defs>
          <linearGradient id={`rhs-fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            {/* stop-color is set as a style, not an attribute: `currentColor`
                in a <stop> attribute resolves against the gradient's own
                inherited colour, which some engines take from the root, not
                the accent — a black wash under a gold line. */}
            <stop offset="0" style={{ stopColor: 'var(--acc)' }} stopOpacity="0.26" />
            <stop offset="1" style={{ stopColor: 'var(--acc)' }} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="rhs-spark-fill" d={`${d}L150 64H0Z`} fill={`url(#rhs-fill-${gid})`} />
        <path className="rhs-spark-line" d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="rhs-spark-halo" cx={ex} cy={ey} r="3.2" fill="currentColor" />
        <circle className="rhs-spark-dot" cx={ex} cy={ey} r="2.4" fill="currentColor" />
      </svg>
    </span>
  );
}

/* ─── one slide ─────────────────────────────────────────────────────────── */

function Slide({ tone, active, title, sub, ariaLabel, onGo, children }) {
  /* «Gold · Treasuries · Robinhood» — one line, but the separators are drawn
     as accent dots rather than typed, so the line reads as designed. */
  const parts = String(sub).split(' · ');
  return (
    <button
      type="button"
      className={`rhs-slide rhs-slide--${tone} ${active ? 'is-active' : ''}`}
      aria-label={ariaLabel}
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      onClick={onGo}
    >
      <SparkArt tone={tone} />
      <Orb>{children}</Orb>
      <span className="rhs-text">
        <span className="rhs-title">{title}</span>
        <span className="rhs-sub">
          {parts.map((p, i) => (
            <span key={i} className="rhs-sub-part">
              {i > 0 && <i className="rhs-sep" aria-hidden="true" />}
              {p}
            </span>
          ))}
        </span>
      </span>
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
   * ─── ONLY PERSIAN GETS PERSIAN — the rule the owner set («وقتی روی زبانی به
   * غیر فارسی و انگلیسی باشد … باید انگلیسی باشد»). `isRTL` says which way
   * the text runs, never which language it is.
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

  /* keyboard: the arrow that points at the next slide advances — physically
     RIGHT in LTR, physically LEFT in RTL. With no indicator buttons left
     this is how a keyboard user moves between the two. */
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const forward = isRTL ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
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
      onKeyDown={onKeyDown}
      aria-roledescription={isEn ? 'auto-rotating banner' : 'بنر چرخشی'}
    >
      <div className="rhs-viewport">
        {/* the two aurora fields; the one for the current slide is lit */}
        <div className="rhs-glow rhs-glow--rwa" aria-hidden="true" />
        <div className="rhs-glow rhs-glow--hz" aria-hidden="true" />
        <div className="rhs-grid" aria-hidden="true" />
        <div className="rhs-sweep" aria-hidden="true" />

        <div className="rhs-track" style={{ transform: `translateX(${shift}%)` }}>
          <Slide tone="rwa" active={index === 0} title={rwa.title} sub={rwa.sub} ariaLabel={rwa.ariaLabel} onGo={go('rwa')}>
            <RwaGlyph />
          </Slide>
          <Slide tone="hz" active={index === 1} title={hz.title} sub={hz.sub} ariaLabel={hz.ariaLabel} onGo={go('hz')}>
            <HorizonGlyph />
          </Slide>
        </div>

        {/*
          The indicator: two hairline segments, NOT buttons — see the header
          comment for the 44px discs that a <button> here became. The active
          one fills over the dwell; it is re-keyed on every slide change and
          on every pause/resume so the fill and the timer can never drift
          apart (the timer restarts from zero on resume, and so does this).
        */}
        <div className="rhs-timeline" aria-hidden="true">
          {[0, 1].map((i) => (
            <span key={i} className={`rhs-seg ${index === i ? 'is-on' : ''}`}>
              {index === i && (
                <i
                  key={`${index}-${autoplay ? 'run' : 'hold'}`}
                  className="rhs-seg-fill"
                  style={{ animationDuration: `${AUTO_MS}ms` }}
                />
              )}
            </span>
          ))}
        </div>
      </div>

      {/* the comet: one light travelling around the border, in the slide's accent */}
      <div className="rhs-frame" aria-hidden="true" />
    </section>
  );
}
