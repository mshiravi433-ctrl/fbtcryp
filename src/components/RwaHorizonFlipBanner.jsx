import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { feePercentString } from '../lib/feeBps';

/*
 * RwaHorizonFlipBanner — v4 «Aurora Flip»
 *
 * Request: «بنر فلیپ کارتی برای افق جهانی و RWA خیلی مدرن‌تر، رنگ‌بندی بهتر،
 * استفاده از انیمیشن و SVG و خیلی جذاب‌تر» — and then:
 *
 *   «تب را حذف کن و داخل بنر بالا سمت چپ ایکون تعویض بزار بدون عنوان و اتوامات
 *    هر ۴۰ ثانیه خودش برگردد فلیپ کارت»
 *
 * What changed vs. v3:
 *  - THE SEGMENTED SWITCH IS GONE. The two tabs that sat above the card are
 *    deleted, and the switch is now a single icon-only button INSIDE the
 *    banner — no label, in the top-left corner of the card, exactly as asked.
 *    The ring drawn around that icon is the countdown the old progress bar
 *    carried: it fills over the full 40s, so the auto-flip is never a surprise.
 *  - AUTO_MS is 40s (was 12s) — «هر ۴۰ ثانیه خودش برگردد».
 *  - Copy is English for EVERY language except Persian. It used to key off
 *    `isRTL`, so Arabic, Hebrew and Urdu readers (RTL, not fa) got Persian
 *    copy — Persian text inside an Arabic app. See `isEn` below.
 *
 * What v3 brought:
 *  - Each face has its own palette: RWA = molten gold on deep plum/navy,
 *    Horizon = aqua/emerald on deep ocean-indigo. Rotating conic rim light.
 *  - Fully animated SVG: vault dial spins + gold bars shimmer (RWA), globe
 *    meridians roll + satellite orbits + chart draws itself (Horizon), an
 *    animated background sparkline, drifting particles and a grid mesh.
 *  - Pointer tilt/parallax on desktop, swipe to flip on mobile, keyboard
 *    accessible (the swap button and the faces are real buttons).
 *  - Autoplay pauses on hover / focus / hidden tab and is disabled entirely
 *    for prefers-reduced-motion.
 *  - No backdrop-filter inside the 3D context (Chrome flattens preserve-3d
 *    when a child has one — that caused the old "flicker" on Android).
 *  - Every SVG gradient id is namespaced with useId() so two banners (or
 *    other SVGs using the same ids) can never steal each other's paint.
 */

/*
 * 40s between auto-flips — «هر ۴۰ ثانیه خودش برگردد». The ring around the
 * swap button is driven by this same number (`animationDuration` is set from
 * it) so the countdown can never drift out of step with the flip.
 */
const AUTO_MS = 40000;

/**
 * The swap glyph — two arrows trading places.
 *
 * Drawn rather than borrowed from an icon set: it is 16px, it has to read on
 * both palettes, and it must not flip with the language. A "swap" icon that
 * mirrors under RTL is the same mistake as a mirrored logo.
 */
function IconSwap() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8.4h13.2M14 4.6l3.8 3.8-3.8 3.8M20 15.6H6.8M10 11.8 6.2 15.6 10 19.4" />
    </svg>
  );
}

/* ─── Animated hero icons ─────────────────────────────────────────────── */

function IconRwaVault({ uid, size = 60 }) {
  const g = (n) => `${uid}-rv-${n}`;
  return (
    <svg className="rhb-svg" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={g('ring')} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F3E8FF" />
          <stop offset="0.5" stopColor="#C084FC" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id={g('bar')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FAF5FF" />
          <stop offset="0.45" stopColor="#D8B4FE" />
          <stop offset="1" stopColor="#9333EA" />
        </linearGradient>
        <linearGradient id={g('shine')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
          <animateTransform attributeName="gradientTransform" type="translate" values="-1 0; 1.2 0; 1.2 0" keyTimes="0;0.55;1" dur="5s" repeatCount="indefinite" />
        </linearGradient>
        <radialGradient id={g('core')} cx="0.5" cy="0.45" r="0.6">
          <stop stopColor="#3A1D5C" />
          <stop offset="1" stopColor="#140A26" />
        </radialGradient>
        <radialGradient id={g('glow')} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#A855F7" stopOpacity="0.5" />
          <stop offset="1" stopColor="#A855F7" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="32" r="30" fill={`url(#${g('glow')})`} className="rhb-pulse" />
      {/* spinning dial ring */}
      <g className="rhb-spin-slow">
        <circle cx="32" cy="32" r="24" stroke={`url(#${g('ring')})`} strokeWidth="1.4" strokeDasharray="2 4.3" opacity="0.9" />
      </g>
      <g className="rhb-spin-rev">
        <circle cx="32" cy="32" r="20" stroke={`url(#${g('ring')})`} strokeWidth="0.8" strokeDasharray="14 6" opacity="0.55" />
      </g>
      {/* vault core */}
      <circle cx="32" cy="32" r="16" fill={`url(#${g('core')})`} stroke={`url(#${g('ring')})`} strokeWidth="1.6" />
      {/* gold bars pyramid */}
      <g className="rhb-float">
        <path d="M22.5 38h8.2l-1.6-5h-5z" fill={`url(#${g('bar')})`} />
        <path d="M33.3 38h8.2l-1.6-5h-5z" fill={`url(#${g('bar')})`} />
        <path d="M27.9 32.2h8.2l-1.6-5h-5z" fill={`url(#${g('bar')})`} />
        <path d="M22.5 38h8.2l-1.6-5h-5zM33.3 38h8.2l-1.6-5h-5zM27.9 32.2h8.2l-1.6-5h-5z" fill={`url(#${g('shine')})`} opacity="0.9" />
      </g>
      {/* orbiting token */}
      <g className="rhb-orbit">
        <circle cx="32" cy="8" r="3.2" fill="#E9D5FF" stroke="#1A0F2E" strokeWidth="0.8" />
        <path d="M30.8 8h2.4" stroke="#1A0F2E" strokeWidth="0.9" strokeLinecap="round" />
      </g>
      {/* sparkles */}
      <path className="rhb-twinkle" d="M52 12l1.1 2.5 2.5 1.1-2.5 1.1L52 19.2l-1.1-2.5-2.5-1.1 2.5-1.1z" fill="#F5E8FF" />
      <path className="rhb-twinkle d2" d="M11 48l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" fill="#F0ABFC" />
    </svg>
  );
}

function IconHorizonGlobe({ uid, size = 60 }) {
  const g = (n) => `${uid}-hg-${n}`;
  const orbit = 'M6 32a26 10 0 1 0 52 0a26 10 0 1 0 -52 0';
  return (
    <svg className="rhb-svg" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={g('ring')} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5EF6FF" />
          <stop offset="0.55" stopColor="#3AE8B0" />
          <stop offset="1" stopColor="#8B7CFF" />
        </linearGradient>
        <linearGradient id={g('chart')} x1="12" y1="46" x2="52" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3AE8B0" />
          <stop offset="1" stopColor="#E4FF6B" />
        </linearGradient>
        <radialGradient id={g('core')} cx="0.38" cy="0.35" r="0.75">
          <stop stopColor="#0F4A63" />
          <stop offset="1" stopColor="#071427" />
        </radialGradient>
        <radialGradient id={g('glow')} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#3AE8B0" stopOpacity="0.4" />
          <stop offset="1" stopColor="#3AE8B0" stopOpacity="0" />
        </radialGradient>
        <clipPath id={g('clip')}>
          <circle cx="32" cy="32" r="16" />
        </clipPath>
      </defs>

      <circle cx="32" cy="32" r="30" fill={`url(#${g('glow')})`} className="rhb-pulse" />
      {/* globe */}
      <circle cx="32" cy="32" r="16" fill={`url(#${g('core')})`} stroke={`url(#${g('ring')})`} strokeWidth="1.6" />
      <g clipPath={`url(#${g('clip')})`} stroke={`url(#${g('ring')})`} strokeWidth="0.9" opacity="0.75">
        {/* rolling meridians */}
        <ellipse cx="32" cy="32" rx="4" ry="16">
          <animate attributeName="rx" values="16;0.5;16" dur="9s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx="32" cy="32" rx="10" ry="16">
          <animate attributeName="rx" values="8;16;0.5;8" dur="9s" repeatCount="indefinite" />
        </ellipse>
        <path d="M16 32h32M18 24h28M18 40h28" />
      </g>
      {/* orbit + satellite */}
      <path d={orbit} stroke={`url(#${g('ring')})`} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" transform="rotate(-18 32 32)" />
      <g transform="rotate(-18 32 32)">
        <circle r="2.6" fill="#E4FF6B" stroke="#061220" strokeWidth="0.8">
          <animateMotion dur="8s" repeatCount="indefinite" path={orbit} />
        </circle>
      </g>
      {/* self-drawing chart */}
      <path className="rhb-draw" d="M10 50l10-9 7 4 11-12 6 4 10-11" stroke={`url(#${g('chart')})`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" pathLength="100" />
      <circle className="rhb-blip" cx="54" cy="26" r="2.4" fill="#E4FF6B" />
    </svg>
  );
}

/* ─── tiny chip glyphs ─────────────────────────────────────────────────── */

const Glyph = {
  gold: (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 12.5h5.2L6.1 9H3.1zM8.8 12.5H14L12.9 9H9.9zM5.4 8h5.2L9.5 4.5h-3z" fill="currentColor" /></svg>
  ),
  treasury: (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 6.5 8 3l6 3.5M3.5 7v5M6.5 7v5M9.5 7v5M12.5 7v5M2 13.5h12" /></svg>
  ),
  stocks: (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 2.5v11M8 4v9M12 2v10" /><rect x="2.8" y="5" width="2.4" height="4.5" rx=".6" fill="currentColor" /><rect x="6.8" y="7" width="2.4" height="3.5" rx=".6" fill="currentColor" /><rect x="10.8" y="4" width="2.4" height="5" rx=".6" fill="currentColor" /></svg>
  ),
  forex: (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5.5h9.5L10 3M13 10.5H3.5L6 13" /></svg>
  ),
  index: (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12l3.5-4 3 2.5L14 4M10.5 4H14v3.5" /></svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
  )
};

/* ─── background sparkline (decorative) ───────────────────────────────── */

function Sparkline({ uid, tone }) {
  const id = `${uid}-sp-${tone}`;
  const d = tone === 'rwa'
    ? 'M0 70 C 30 64, 50 72, 80 58 S 130 44, 160 50 S 220 30, 250 34 S 300 14, 340 18 L 400 6'
    : 'M0 64 C 26 70, 54 50, 86 56 S 140 36, 170 42 S 222 18, 256 28 S 316 8, 350 14 L 400 4';
  return (
    <svg className="rhb-spark" viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--rhb-a)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--rhb-a)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--rhb-a)" stopOpacity="0" />
          <stop offset="0.4" stopColor="var(--rhb-a)" />
          <stop offset="1" stopColor="var(--rhb-b)" />
        </linearGradient>
      </defs>
      <path d={`${d} L 400 90 L 0 90 Z`} fill={`url(#${id}-f)`} className="rhb-spark-area" />
      <path d={d} fill="none" stroke={`url(#${id}-s)`} strokeWidth="2" pathLength="100" className="rhb-spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Particles() {
  return (
    <div className="rhb-particles" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => <i key={i} style={{ '--i': i }} />)}
    </div>
  );
}

function Arrow({ isRTL }) {
  return (
    <svg className="rhb-cta-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isRTL ? 'scaleX(-1)' : 'none' }} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/* ─── Face ─────────────────────────────────────────────────────────────── */

function Face({ tone, uid, active, isRTL, onGo, eyebrow, badge, title, accent, sub, subIcon, chips, feats, cta, ariaLabel }) {
  return (
    <div
      className={`rhb-face rhb-face--${tone}`}
      role="button"
      tabIndex={active ? 0 : -1}
      aria-hidden={!active}
      aria-label={ariaLabel}
      onClick={onGo}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(e); } }}
    >
      <div className="rhb-rim" aria-hidden="true" />
      <div className="rhb-bg" aria-hidden="true">
        <span className="rhb-blob b1" />
        <span className="rhb-blob b2" />
        <span className="rhb-blob b3" />
        <span className="rhb-grid" />
      </div>
      <Sparkline uid={uid} tone={tone} />
      <Particles />
      <span className="rhb-sheen" aria-hidden="true" />

      <div className="rhb-body">
        <div className="rhb-head">
          <div className="rhb-icon">
            {tone === 'rwa' ? <IconRwaVault uid={uid} /> : <IconHorizonGlobe uid={uid} />}
          </div>
          <div className="rhb-head-txt">
            <span className="rhb-eyebrow">{eyebrow}</span>
            <span className="rhb-badge"><i className="rhb-live" />{badge}</span>
          </div>
        </div>

        <h3 className="rhb-title">
          {title} <span className="rhb-accent">{accent}</span>
        </h3>
        <p className="rhb-sub">{subIcon}{sub}</p>

        <div className="rhb-chips">
          {chips.map((c, i) => (
            <span className="rhb-chip" key={c.label} style={{ '--c': c.color, '--d': `${i * 90}ms` }}>
              <span className="rhb-chip-ic">{c.icon}</span>
              {c.label}
            </span>
          ))}
        </div>

        <div className="rhb-foot">
          <div className="rhb-feats">
            {feats.map((f) => (
              <span className="rhb-feat" key={f.label}>{f.icon}{f.label}</span>
            ))}
          </div>
          <span className="rhb-cta">
            <span>{cta}</span>
            <Arrow isRTL={isRTL} />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Main ────────────────────────────────────────────────────────────── */

export default function RwaHorizonFlipBanner({ onGoRwa, onGoHorizon, haptic, isRTL, lang }) {
  const rawId = useId();
  const uid = `rhb${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [side, setSide] = useState('rwa');
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [canHover, setCanHover] = useState(true);
  const tiltRef = useRef(null);
  const touchRef = useRef(null);

  const l = String(lang || '').toLowerCase();
  /*
   * ─── ONLY PERSIAN GETS PERSIAN. EVERYTHING ELSE GETS ENGLISH ─────────────
   * Reported: «وقتی روی زبانی به غیر فارسی و انگلیسی باشد فلیپ کارت فارسی هست
   * در صورتی که باید انگلیسی باشد» — with the language set to Arabic or Urdu
   * the card showed Persian copy.
   *
   * The cause was `isEn = ... || (!isRTL && !l.startsWith('fa'))`: it decided
   * the language by asking whether the layout is RTL, so every RTL language
   * other than `fa` — Arabic, Hebrew, Urdu — fell through to the Persian
   * branch. RTL-ness says which way the text runs, never which language it is.
   *
   * The rule is now the one the owner stated: Persian if and only if the
   * language is Persian. Every other language gets English, which is the
   * fallback this app is already configured with everywhere else — an
   * untranslated string appears in English, never as a raw key. Translating
   * this card properly means twelve sets of these strings in the locale files;
   * until somebody writes them, English is the honest answer and Persian is
   * still exactly where it was.
   */
  const isEn = !l.startsWith('fa');
  const fee = feePercentString();
  const flipped = side === 'hz';

  /* reduced motion + page visibility */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduced(Boolean(mq?.matches));
    onMq();
    mq?.addEventListener?.('change', onMq);
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);

    /*
     * Hover-to-pause only exists where there is a real hover.
     *
     * A touch tap fires a synthetic `mouseenter` that nothing ever follows
     * with a `mouseleave` — the finger left no pointer behind — so on a phone
     * the FIRST tap used to pause the banner permanently and the auto-flip
     * everybody was promised would quietly never happen again. Guarding on
     * `(hover: hover)` is the difference between the 40s rhythm working on
     * mobile and not.
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

  /* autoplay — one timeout per cycle so the ring and the flip stay in sync */
  useEffect(() => {
    if (!autoplay) return undefined;
    const t = setTimeout(() => {
      setSide((s) => (s === 'rwa' ? 'hz' : 'rwa'));
      setCycle((c) => c + 1);
    }, AUTO_MS);
    return () => clearTimeout(t);
  }, [autoplay, cycle]);

  const choose = useCallback((next) => {
    haptic?.('select');
    setSide(next);
    setCycle((c) => c + 1);
  }, [haptic]);

  const go = (tone) => (e) => {
    e?.stopPropagation?.();
    haptic?.('select');
    if (tone === 'rwa') onGoRwa?.();
    else onGoHorizon?.();
  };

  /* pointer tilt (fine pointers only) */
  const onMove = (e) => {
    if (reduced || e.pointerType !== 'mouse' || !tiltRef.current) return;
    const r = tiltRef.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    tiltRef.current.style.setProperty('--rx', `${(-py * 6).toFixed(2)}deg`);
    tiltRef.current.style.setProperty('--ry', `${(px * 8).toFixed(2)}deg`);
    tiltRef.current.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
    tiltRef.current.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
  };
  const resetTilt = () => {
    if (!tiltRef.current) return;
    tiltRef.current.style.setProperty('--rx', '0deg');
    tiltRef.current.style.setProperty('--ry', '0deg');
  };

  /* swipe to flip on touch */
  const onTouchStart = (e) => {
    const t = e.touches?.[0];
    if (t) touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const s = touchRef.current;
    touchRef.current = null;
    const t = e.changedTouches?.[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      choose(side === 'rwa' ? 'hz' : 'rwa');
    }
  };

  const rwa = {
    eyebrow: isEn ? 'Real World Assets' : 'دارایی‌های واقعی',
    badge: 'RWA',
    title: isEn ? 'Own real assets,' : 'دارایی واقعی،',
    accent: isEn ? 'on-chain' : 'روی زنجیره',
    sub: isEn ? 'Tokenized gold, US Treasuries & Robinhood stocks' : 'طلا، اوراق خزانه آمریکا و سهام رابین‌هود به‌صورت توکن',
    subIcon: Glyph.gold,
    chips: [
      { label: isEn ? 'Gold' : 'طلا', icon: Glyph.gold, color: '#D8B4FE' },
      { label: isEn ? 'Treasury' : 'خزانه', icon: Glyph.treasury, color: '#F0ABFC' },
      { label: isEn ? 'Robinhood' : 'رابین‌هود', icon: Glyph.stocks, color: '#A5B4FC' }
    ],
    feats: [
      { label: isEn ? 'Self-custody' : 'کیف شخصی', icon: Glyph.shield },
      { label: isEn ? `Fee ${fee}%` : `کارمزد ${fee}٪`, icon: Glyph.bolt }
    ],
    cta: isEn ? 'Explore RWA' : 'ورود به RWA',
    ariaLabel: isEn ? 'Open Real World Assets' : 'ورود به بخش دارایی‌های واقعی RWA'
  };

  const hz = {
    eyebrow: isEn ? 'Global Horizon' : 'افق جهانی',
    badge: isEn ? 'Live markets' : 'بازار زنده',
    title: isEn ? 'Trade the world,' : 'بازارهای جهان،',
    accent: isEn ? 'with USDC' : 'با USDC',
    sub: isEn ? 'Forex, gold, stocks & indices — leveraged, settled on Arbitrum' : 'فارکس، طلا، سهام و شاخص‌ها — اهرمی، تسویه آنچین روی آربیتروم',
    subIcon: Glyph.index,
    chips: [
      { label: isEn ? 'Forex' : 'فارکس', icon: Glyph.forex, color: '#5EF6FF' },
      { label: isEn ? 'Gold' : 'طلا', icon: Glyph.gold, color: '#E4FF6B' },
      { label: isEn ? 'Stocks' : 'سهام', icon: Glyph.stocks, color: '#3AE8B0' },
      { label: isEn ? 'Indices' : 'شاخص‌ها', icon: Glyph.index, color: '#A99BFF' }
    ],
    feats: [
      { label: 'Arbitrum', icon: Glyph.shield },
      { label: isEn ? 'Leverage' : 'اهرم', icon: Glyph.bolt }
    ],
    cta: isEn ? 'Enter Horizon' : 'ورود به افق جهانی',
    ariaLabel: isEn ? 'Open Global Horizon markets' : 'ورود به بازارهای افق جهانی'
  };

  return (
    <section
      className={`rhb ${flipped ? 'is-flipped' : ''} ${autoplay ? '' : 'is-paused'}`}
      data-side={side}
      dir={isRTL ? 'rtl' : 'ltr'}
      onMouseEnter={() => { if (canHover) setPaused(true); }}
      onMouseLeave={() => { if (canHover) setPaused(false); resetTilt(); }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-roledescription={isEn ? 'flip banner' : 'بنر چرخشی'}
    >
      <div
        className="rhb-stage"
        onPointerMove={onMove}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="rhb-tilt" ref={tiltRef}>
          <div className="rhb-card">
            <Face tone="rwa" uid={uid} active={!flipped} isRTL={isRTL} onGo={go('rwa')} {...rwa} />
            <Face tone="hz" uid={uid} active={flipped} isRTL={isRTL} onGo={go('hz')} {...hz} />
          </div>
        </div>
      </div>

      {/*
        ─── THE SWITCH, INSIDE THE BANNER AND WITHOUT A TITLE ────────────────
        «داخل بنر بالا سمت چپ ایکون تعویض بزار بدون عنوان».

        It lives OUTSIDE the 3D stage on purpose. Inside it, the button would
        be a child of a `preserve-3d` card whose back face is rotated 180°, and
        whether it paints above or through the card then depends on the
        browser's 3D hit-testing — the same class of bug that made the old
        banner flicker on Android. Out here it is a plain absolutely
        positioned button, always on top, always tappable, and it still reads
        as "inside the card" because it sits over the card's own corner.

        The ring is the old progress bar, redrawn around the icon: it empties
        over AUTO_MS so the tap that is about to happen on its own is never a
        surprise. `key={cycle}` restarts it after every flip, manual included.
      */}
      <button
        type="button"
        className="rhb-swap"
        onClick={(e) => { e.stopPropagation(); choose(side === 'rwa' ? 'hz' : 'rwa'); }}
        aria-label={isEn ? 'Switch to the other market' : 'تعویض به بازار دیگر'}
      >
        <span className="rhb-swap-ic"><IconSwap /></span>
        <svg className="rhb-swap-ring" viewBox="0 0 40 40" aria-hidden="true">
          <circle
            key={cycle}
            cx="20"
            cy="20"
            r="18.4"
            pathLength="100"
            style={{ animationDuration: `${AUTO_MS}ms` }}
          />
        </svg>
      </button>
    </section>
  );
}
