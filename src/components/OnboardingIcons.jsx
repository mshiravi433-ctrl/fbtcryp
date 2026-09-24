import { useId } from 'react';

/*
 * ONBOARDING ICONS — modern duotone glyphs for Welcome + Onboarding.
 * ---------------------------------------------------------------------------
 * Request: «صفحات بعدی آن هم آیکون‌ها قشنگ‌تر و مدرن‌تر برای هر دو تم شود».
 *
 * The first-run screens used generic 24px line icons painted solid black on a
 * flat gradient square. On the light theme that read as a heavy black glyph on
 * a neon brick, and on dark it looked like a placeholder.
 *
 * These are hand-drawn 64px duotone illustrations: gradient fills in each
 * slide's own hues, white highlights ON the filled shapes only (so they never
 * vanish against a white tile), and gentle CSS micro-motion. They sit inside
 * `OnbTile`, a glass tile whose surface is theme-aware in CSS
 * (styles/onboarding-icons.css): dark glass + coloured glow on dark, frosted
 * white + soft coloured shadow on light.
 *
 * Every gradient id is namespaced with useId() so two tiles on screen (or the
 * AnimatePresence exit/enter overlap) never steal each other's paint.
 */

function useIds(prefix) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (n) => `${prefix}${raw}-${n}`;
}

function Grad({ id, a, b, x1 = 0, y1 = 0, x2 = 1, y2 = 1 }) {
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      <stop offset="0" stopColor={a} />
      <stop offset="1" stopColor={b} />
    </linearGradient>
  );
}

/* ─── Trade: candles + a rising trend that draws itself ───────────────── */
export function GlyphTrade({ a = '#00e5ff', b = '#7c4dff', size = 56 }) {
  const g = useIds('ot');
  return (
    <svg className="onbi" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <Grad id={g('f')} a={a} b={b} />
        <Grad id={g('s')} a={b} b={a} x1={0} y1={1} x2={1} y2={0} />
      </defs>
      <rect x="8" y="10" width="48" height="44" rx="12" fill={`url(#${g('f')})`} opacity="0.16" />
      <path d="M8 42h48M8 30h48" stroke={`url(#${g('f')})`} strokeOpacity="0.28" strokeDasharray="2 4" />
      <g className="onbi-rise">
        <path d="M20 22v24" stroke={`url(#${g('f')})`} strokeWidth="2" strokeLinecap="round" />
        <rect x="16" y="28" width="8" height="12" rx="2.5" fill={`url(#${g('f')})`} />
        <path d="M32 16v26" stroke={`url(#${g('f')})`} strokeWidth="2" strokeLinecap="round" />
        <rect x="28" y="20" width="8" height="15" rx="2.5" fill={`url(#${g('f')})`} />
        <path d="M44 12v22" stroke={`url(#${g('f')})`} strokeWidth="2" strokeLinecap="round" />
        <rect x="40" y="15" width="8" height="12" rx="2.5" fill={`url(#${g('f')})`} />
        <rect x="17.5" y="29.5" width="2" height="6" rx="1" fill="#fff" opacity="0.55" />
        <rect x="29.5" y="21.5" width="2" height="7" rx="1" fill="#fff" opacity="0.55" />
        <rect x="41.5" y="16.5" width="2" height="6" rx="1" fill="#fff" opacity="0.55" />
      </g>
      <path className="onbi-draw" d="M10 50l12-9 9 4 13-13 10-4" pathLength="100" stroke={`url(#${g('s')})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="onbi-ping" cx="54" cy="28" r="3.2" fill={a} />
    </svg>
  );
}

/* ─── Swap: two coins trading places on a circular route ─────────────── */
export function GlyphSwap({ a = '#7c4dff', b = '#ff2d95', size = 56 }) {
  const g = useIds('os');
  return (
    <svg className="onbi" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <Grad id={g('a')} a={a} b={b} />
        <Grad id={g('b')} a={b} b={a} />
      </defs>
      <g className="onbi-spin">
        <path d="M38 13.5A20 20 0 0 1 51.5 30" stroke={`url(#${g('a')})`} strokeWidth="3" strokeLinecap="round" />
        <path d="M47 27.5l4.6 3.4 3.4-4.6" stroke={`url(#${g('a')})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M26 50.5A20 20 0 0 1 12.5 34" stroke={`url(#${g('b')})`} strokeWidth="3" strokeLinecap="round" />
        <path d="M17 36.5l-4.6-3.4-3.4 4.6" stroke={`url(#${g('b')})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="onbi-float">
        <circle cx="23" cy="23" r="11" fill={`url(#${g('a')})`} />
        <circle cx="23" cy="23" r="7.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.4" />
        <path d="M23 18.5l3.6 4.5-3.6 4.5-3.6-4.5z" fill="#fff" opacity="0.9" />
      </g>
      <g className="onbi-float d2">
        <circle cx="41" cy="41" r="11" fill={`url(#${g('b')})`} />
        <circle cx="41" cy="41" r="7.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.4" />
        <path d="M38 41h6M41 38v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
      </g>
    </svg>
  );
}

/* ─── Custody: shield with a keyhole, orbit spark ───────────────────── */
export function GlyphShield({ a = '#00ff9d', b = '#00e5ff', size = 56 }) {
  const g = useIds('oh');
  return (
    <svg className="onbi" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <Grad id={g('f')} a={a} b={b} x1={0} y1={0} x2={0.4} y2={1} />
        <linearGradient id={g('hl')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle className="onbi-orbit" cx="32" cy="32" r="27" stroke={`url(#${g('f')})`} strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="3 6" />
      <g className="onbi-float">
        <path d="M32 7l19 7.5v14.8c0 12.3-8.2 21.6-19 26.7-10.8-5.1-19-14.4-19-26.7V14.5z" fill={`url(#${g('f')})`} />
        <path d="M32 7l19 7.5v14.8c0 3-.5 5.9-1.4 8.5L14.3 21.9V14.5z" fill={`url(#${g('hl')})`} />
        <circle cx="32" cy="28" r="5.4" fill="#fff" />
        <path d="M29.8 31.5h4.4l1.2 9.5h-6.8z" fill="#fff" />
      </g>
      <path className="onbi-twinkle" d="M52 8l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" fill={b} />
    </svg>
  );
}

/* ─── Wallet: stacked card slipping out of a wallet ─────────────────── */
export function GlyphWallet({ a = '#00e5ff', b = '#00ff9d', size = 56 }) {
  const g = useIds('ow');
  return (
    <svg className="onbi" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <Grad id={g('f')} a={a} b={b} />
        <Grad id={g('c')} a={b} b={a} x1={1} y1={0} x2={0} y2={1} />
      </defs>
      <g className="onbi-peek">
        <rect x="15" y="9" width="32" height="20" rx="5" transform="rotate(-8 31 19)" fill={`url(#${g('c')})`} opacity="0.75" />
        <rect x="19" y="13" width="14" height="2.6" rx="1.3" transform="rotate(-8 31 19)" fill="#fff" opacity="0.7" />
      </g>
      <rect x="8" y="21" width="48" height="34" rx="10" fill={`url(#${g('f')})`} />
      <path d="M8 31h48" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.4" />
      <rect x="38" y="34" width="20" height="13" rx="6.5" fill="#fff" opacity="0.92" />
      <circle cx="45" cy="40.5" r="2.6" fill={`url(#${g('f')})`} />
      <rect x="14" y="44" width="14" height="2.6" rx="1.3" fill="#fff" opacity="0.55" />
    </svg>
  );
}

/* ─── Terms: document with a verified seal ──────────────────────────── */
export function GlyphTerms({ a = '#7c4dff', b = '#ff2d95', size = 56 }) {
  const g = useIds('om');
  return (
    <svg className="onbi" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <Grad id={g('f')} a={a} b={b} />
        <Grad id={g('d')} a={a} b={b} x1={0} y1={0} x2={0} y2={1} />
      </defs>
      <g className="onbi-float">
        <path d="M16 12a6 6 0 0 1 6-6h15l11 11v31a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z" fill={`url(#${g('d')})`} opacity="0.2" />
        <path d="M16 12a6 6 0 0 1 6-6h15l11 11v31a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z" stroke={`url(#${g('f')})`} strokeWidth="2.2" />
        <path d="M37 6v7a4 4 0 0 0 4 4h7" stroke={`url(#${g('f')})`} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M23 25h16M23 32h12M23 39h8" stroke={`url(#${g('f')})`} strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <g className="onbi-pop">
        <circle cx="45" cy="45" r="11" fill={`url(#${g('f')})`} />
        <path className="onbi-check" d="M40 45.2l3.5 3.5 6.6-7" pathLength="100" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/* ─── Languages: globe with a speech bubble ─────────────────────────── */
export function GlyphLanguages({ a = '#00e5ff', b = '#7c4dff', size = 30 }) {
  const g = useIds('ol');
  return (
    <svg className="onbi" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <Grad id={g('f')} a={a} b={b} />
        <clipPath id={g('clip')}><circle cx="28" cy="32" r="20" /></clipPath>
      </defs>
      <circle cx="28" cy="32" r="20" fill={`url(#${g('f')})`} />
      <g clipPath={`url(#${g('clip')})`} stroke="#fff" strokeOpacity="0.7" strokeWidth="1.8">
        <ellipse className="onbi-meridian" cx="28" cy="32" rx="9" ry="20" />
        <path d="M8 32h40M11 22h34M11 42h34" />
      </g>
      <g className="onbi-float">
        <path d="M40 8h14a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-6l-5 5v-5h-3a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z" fill="#fff" />
        <path d="M40 8h14a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-6l-5 5v-5h-3a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z" stroke={`url(#${g('f')})`} strokeWidth="2" />
        <path d="M42 23l4-10 4 10M43.4 19.6h5.2" stroke={`url(#${g('f')})`} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/* ─── Tile ──────────────────────────────────────────────────────────── */
export function OnbTile({ hues = ['#00e5ff', '#7c4dff'], size = 96, radius = 30, className = '', children }) {
  return (
    <span
      className={`onb-tile ${className}`}
      style={{ '--onb-a': hues[0], '--onb-b': hues[1], width: size, height: size, borderRadius: radius }}
    >
      <span className="onb-tile-rim" aria-hidden="true" />
      <span className="onb-tile-glint" aria-hidden="true" />
      <span className="onb-tile-ic">{children}</span>
    </span>
  );
}
