/**
 * FBT WORLD CONSOLE — the icon system.
 * ---------------------------------------------------------------------------
 * REPORTED: «آیکون‌ها را درست کن … باید آیکون‌های درست و SVG و زیبا باشد و
 * مدرن» + «ایکون انیمیشن انگار یک صفحه هواشناسی جذاب».
 *
 * Two sets live here, both inline SVG (stroke = currentColor, so every panel
 * tints them with its own accent):
 *
 *   · WIcon       — the 1.7px utility set used by gauges, lists and chips;
 *   · WeatherGlyph— the ANIMATED weather-station glyphs: a sun whose rays
 *                   turn, clouds that drift, rain that falls, a bolt that
 *                   flicks, wind that flows, a flame that breathes. Every
 *                   animation is transform/opacity only and the stylesheet
 *                   switches all of them off under prefers-reduced-motion.
 *   · TabIcon     — the eleven sub-tab glyphs of the console rail.
 */
import { memo, useId } from 'react';

/* ── 1 · the utility stroke set ─────────────────────────────────────────── */
export const W_PATHS = {
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" /></>,
  radar: <><path d="M19.07 4.93A10 10 0 1 0 22 12" /><path d="M15.54 8.46A5 5 0 1 0 17 12" /><circle cx="12" cy="12" r="1" /><path d="M12 12l7-7" /></>,
  chain: <><path d="M9 12h6" /><path d="M4 12a3 3 0 0 1 3-3h1a3 3 0 0 1 0 6H7a3 3 0 0 1-3-3Z" /><path d="M20 12a3 3 0 0 0-3-3h-1a3 3 0 0 0 0 6h1a3 3 0 0 0 3-3Z" /></>,
  flow: <><path d="M12 3v14" /><path d="m7 13 5 5 5-5" /><path d="M5 21h14" /></>,
  tree: <><path d="M12 3v18" /><path d="M12 7c-2.5 0-4-1.5-4.5-3.5C9.5 3.8 11 5 12 5s2.5-1.2 4.5-1.5C16 5.5 14.5 7 12 7Z" /><path d="M12 13c-3.5 0-5.5-2-6.5-5 3 .5 5 2 6.5 2s3.5-1.5 6.5-2c-1 3-3 5-6.5 5Z" /><path d="M12 21c-4.5 0-7-2.5-8.5-6.5 4 .7 6.5 2.7 8.5 2.7s4.5-2 8.5-2.7C19 18.5 16.5 21 12 21Z" /></>,
  dna: <><path d="M6 3c0 6 12 6 12 12" /><path d="M18 3c0 6-12 6-12 12" /><path d="M6 15c0 3 2 6 6 6" /><path d="M18 15c0 3-2 6-6 6" /><path d="M8 6.5h8" /><path d="M8 17.5h8" /></>,
  flame: <><path d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1.2-.4-2.2-1-3 2 .5 4 2.4 4 5a6 6 0 0 1-12 0c0-5 5-6.5 6-10Z" /></>,
  warning: <><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8" /><path d="M9.5 10v8" /><path d="M14.5 10v8" /><path d="M19 10v8" /><path d="M3 21h18" /></>,
  coin: <><ellipse cx="12" cy="6.5" rx="8" ry="3.5" /><path d="M4 6.5v6c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v-6" /><path d="M4 12.5v5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v-5" /></>,
  building: <><path d="M4 21V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15" /><path d="M13 10h5a2 2 0 0 1 2 2v9" /><path d="M2 21h20" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  pulse: <path d="M3 12h4l2.5-7 4 14L16 12h5" />,
  drop: <path d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z" />,
  spark: <><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><circle cx="12" cy="12" r="2.6" /></>,
  shield: <><path d="M12 3 4 6v6c0 4.5 3.5 7.5 8 9 4.5-1.5 8-4.5 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /><path d="m6.3 17.7-1.4 1.4" /></>,
  partly: <><path d="M8 5v2" /><path d="M3.5 9.5h2" /><path d="m4.9 6.4 1.4 1.4" /><circle cx="8" cy="11" r="3" /><path d="M13 20h6a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 10 12" /><path d="M13 20a3 3 0 0 1 0-6" /></>,
  cloud: <path d="M17.5 19a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.3 8.6 4.5 4.5 0 0 0 7 17.5" />,
  rain: <><path d="M17.5 15a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.3 4.6 4.5 4.5 0 0 0 7 13.5" /><path d="M8 18v2" /><path d="M12 17v3" /><path d="M16 18v2" /></>,
  storm: <><path d="M17.5 14a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.3 3.6 4.5 4.5 0 0 0 7 12.5" /><path d="m12 12-2.5 4.5H13l-2 4.5" /></>,
  wind: <><path d="M3 8h10a2.5 2.5 0 1 0-2.4-3.2" /><path d="M3 12h15a2.5 2.5 0 1 1-2.4 3.2" /><path d="M3 16h7a2 2 0 1 1-1.9 2.6" /></>,
  waves: <><path d="M2 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M2 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /></>,
  news: <><path d="M4 5h13v14H6a2 2 0 0 1-2-2V5Z" /><path d="M17 8h3v9a2 2 0 0 1-2 2" /><path d="M7 9h7" /><path d="M7 13h7" /><path d="M7 17h4" /></>,
  chart: <><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M7 15l3.5-4 3 2.6L20 7" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  thermometer: <><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z" /><path d="M12 9v6" /></>,
  gauge: <><path d="M12 14 16 9" /><path d="M4 18a8 8 0 1 1 16 0" /><circle cx="12" cy="18" r="1.6" /></>,
  factory: <><path d="M3 21h18" /><path d="M4 21V10l5 3V10l5 3V7l6 3v11" /><path d="M8 17h1" /><path d="M13 17h1" /><path d="M17 17h1" /></>,
  swap: <><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></>,
  funnel: <><path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" /></>,
  plug: <><path d="M9 3v6" /><path d="M15 3v6" /><path d="M6 9h12v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6V9Z" /><path d="M12 17v4" /></>,
  cube: <><path d="M12 3 3 8v8l9 5 9-5V8l-9-5Z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></>,
  atoms: <><circle cx="12" cy="12" r="2" /><path d="M12 4c4.5 0 8 3.6 8 8s-3.5 8-8 8-8-3.6-8-8 3.5-8 8-8Z" /><path d="M6.3 6.3c3.2 3.2 8.2 8.2 11.4 11.4" /><path d="M17.7 6.3C14.5 9.5 9.5 14.5 6.3 17.7" /></>,
  shieldHalf: <><path d="M12 3 4 6v6c0 4.5 3.5 7.5 8 9 4.5-1.5 8-4.5 8-9V6l-8-3Z" /><path d="M12 3v18" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="3" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M10 3v3" /><path d="M14 3v3" /><path d="M10 18v3" /><path d="M14 18v3" /><path d="M3 10h3" /><path d="M3 14h3" /><path d="M18 10h3" /><path d="M18 14h3" /></>,
  server: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01" /><path d="M7 16.5h.01" /></>,
  signal: <><path d="M4 20v-4" /><path d="M9 20V9" /><path d="M14 20V5" /><path d="M19 20V2" /></>,
  curve: <><path d="M3 20c5 0 6-16 9-16s4 16 9 16" /><path d="M3 20h18" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  brain: <><path d="M12 4a4 4 0 0 0-4 4 3 3 0 0 0-1 5.7V17a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-3.3A3 3 0 0 0 16 8a4 4 0 0 0-4-4Z" /><path d="M12 4v17" /><path d="M8.6 12h3.4" /><path d="M12 15.4h3.4" /></>,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M21 11h-4a2 2 0 0 0 0 4h4v-4Z" /></>
};

/* `grad` ([from, to]) strokes the drawing with a two-colour gradient instead of
   the surrounding text colour — the world-state gauges use it so every
   measure carries its own colours (water blue, flame orange, money green). */
export const WIcon = memo(function WIcon({ name, size = 16, style, className, grad }) {
  const raw = useId();
  const gid = grad ? `wi${String(raw).replace(/[^a-zA-Z0-9_-]/g, '')}` : null;
  return (
    <svg className={className || 'aigw-icon'} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={gid ? `url(#${gid})` : 'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {gid ? (
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="3" y1="3" x2="21" y2="21">
            <stop offset="0%" stopColor={grad[0]} />
            <stop offset="100%" stopColor={grad[1] || grad[0]} />
          </linearGradient>
        </defs>
      ) : null}
      {W_PATHS[name] || W_PATHS.pulse}
    </svg>
  );
});

export function DirMark({ dir, size = 11 }) {
  const kind = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat';
  return (
    /* `aig-dir*` are the historical hook names the older probes and the host
       stylesheet use; `aigw-dir*` is the console's own token. Both are kept so
       one marker satisfies every reader. */
    <svg className={`aigw-dir aigw-dir-${kind} aig-dir aig-dir-${kind}`} width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {kind === 'up' ? <path d="M6 1 11 10H1z" /> : kind === 'down' ? <path d="M6 11 1 2h10z" /> : <rect x="1" y="5" width="10" height="2" rx="1" />}
    </svg>
  );
}

/* ── 2 · the ANIMATED weather glyphs — now in full colour ─────────────────
   REPORTED (2026-10-15): «وضعیت جهانی آیکون‌ها مدرن و درست رنگی بشه».
   The glyphs used to be one-colour line drawings tinted by whatever text
   colour sat around them, so a sun, a storm and a bank all came out the same
   grey-white. Each glyph is now a small illustration in the colours of the
   thing it shows — a golden sun, white clouds, blue rain, a yellow bolt under
   an indigo storm cloud, an orange flame, a gold shield, an emerald bank —
   drawn with gradients whose ids are unique per instance (two glyphs on one
   page never fight over `url(#…)`). The animation hooks (`aigw-g-*`) are the
   same as before: transform/opacity only, all switched off under
   prefers-reduced-motion. */
function Glyph({ children }) {
  return (
    <svg className="aigw-glyph-svg" width="46" height="46" viewBox="0 0 48 48" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A DOM-safe, per-instance id prefix for SVG paint servers (React's «:r1:» → «r1»). */
export function useSvgId(prefix = 'g') {
  const raw = useId();
  return `${prefix}${String(raw).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

const stops = (cols) => cols.map((c, i) => {
  const [color, opacity] = Array.isArray(c) ? c : [c, undefined];
  const offset = cols.length === 1 ? 0 : Math.round((i / (cols.length - 1)) * 100);
  return <stop key={i} offset={`${offset}%`} stopColor={color} stopOpacity={opacity} />;
});
/* user-space gradients: a straight stroke has a zero-width bounding box, and a
   bounding-box gradient on it would paint nothing */
const lin = (id, cols, x1 = 0, y1 = 0, x2 = 0, y2 = 48) => (
  <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>{stops(cols)}</linearGradient>
);
const rad = (id, cols, cx = 24, cy = 24, r = 24) => (
  <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r}>{stops(cols)}</radialGradient>
);
const url = (id) => `url(#${id})`;

/* the palette — weather in its own colours, readable on dark and light cards */
export const GLYPH_PALETTE = Object.freeze({
  sunCore: ['#FFF8D6', '#FFD23F', '#FF9500'],
  sunRay: ['#FFE066', '#FF8A00'],
  sunGlow: '#FFC83D',
  cloudLight: ['#FFFFFF', '#C9D4E3'],
  cloudMid: ['#CBD5E1', '#7B8BA3'],
  cloudRain: ['#A9B6CA', '#4B5B74'],
  cloudStorm: ['#7C86A2', '#2E2A5E'],
  rain: ['#9BE3FF', '#2F7BF6'],
  bolt: ['#FFF6B0', '#FFC21A', '#F08A00']
});
const P = GLYPH_PALETTE;

/* one cloud outline (three puffs over a flat base), x 9–40 · y 11.5–34 */
export const CLOUD_D = 'M16 34A7 7 0 0 1 15.56 20.02A9.5 9.5 0 0 1 34.47 20.15A7 7 0 0 1 33 34Z';
/* one rain drop, centred on 0,0 */
const DROP_D = 'M0-3.6C1.6-1.5 2.5-.2 2.5 1.2A2.5 2.5 0 0 1-2.5 1.2C-2.5-.2-1.6-1.5 0-3.6Z';
const SHIELD_D = 'M24 6 10 12v12c0 9 7 15 14 18 7-3 14-9 14-18V12L24 6Z';

export function WeatherGlyph({ name = 'cloud', size = 46 }) {
  const u = useSvgId('wg');
  const key = GLYPHS[name] ? name : 'cloud';
  return <span className={`aigw-glyph g-${key}`} style={{ width: size, height: size }}>{GLYPHS[key](u)}</span>;
}

const GLYPHS = {
  sun: (u) => (
    <Glyph>
      <defs>
        {rad(`${u}c`, P.sunCore, 21.5, 21, 11)}
        {lin(`${u}r`, P.sunRay, 6, 6, 42, 42)}
        {rad(`${u}h`, [[P.sunGlow, 0.5], [P.sunGlow, 0]], 24, 24, 21)}
      </defs>
      <circle className="aigw-g-halo" cx="24" cy="24" r="21" fill={url(`${u}h`)} stroke="none" />
      <g className="aigw-g-sun-rays" stroke={url(`${u}r`)} strokeWidth="2.6">
        <path d="M24 4.5V9" /><path d="M24 39v4.5" /><path d="M4.5 24H9" /><path d="M39 24h4.5" />
        <path d="m10.2 10.2 3.2 3.2" /><path d="m34.6 34.6 3.2 3.2" /><path d="m37.8 10.2-3.2 3.2" /><path d="m13.4 34.6-3.2 3.2" />
      </g>
      <circle className="aigw-g-sun-core" cx="24" cy="24" r="9.2" fill={url(`${u}c`)} stroke="#FFB020" strokeWidth=".9" />
    </Glyph>
  ),
  partly: (u) => (
    <Glyph>
      <defs>
        {rad(`${u}c`, P.sunCore, 15.5, 15, 8)}
        {lin(`${u}r`, P.sunRay, 5, 5, 27, 27)}
        {lin(`${u}k`, P.cloudLight, 0, 11, 0, 34)}
      </defs>
      <g className="aigw-g-sun-rays" style={{ transformOrigin: '17px 17px' }} stroke={url(`${u}r`)} strokeWidth="2.4">
        <path d="M17 5.2v3" /><path d="M5.2 17h3" /><path d="m8.7 8.7 2.2 2.2" /><path d="m25.3 8.7-2.2 2.2" /><path d="m8.7 25.3 2.2-2.2" />
      </g>
      <circle className="aigw-g-sun-core" cx="17" cy="17" r="6.4" fill={url(`${u}c`)} stroke="#FFB020" strokeWidth=".8" />
      <g transform="translate(4 5)">
        <path className="aigw-g-cloud" d={CLOUD_D} fill={url(`${u}k`)} stroke="rgba(71,85,105,.3)" strokeWidth="1" />
      </g>
    </Glyph>
  ),
  cloud: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}b`, P.cloudMid, 0, 11, 0, 34)}
        {lin(`${u}k`, P.cloudLight, 0, 11, 0, 34)}
      </defs>
      <g transform="translate(-4.5 -6) scale(.78)">
        <path className="aigw-g-cloud d1" d={CLOUD_D} fill={url(`${u}b`)} stroke="rgba(71,85,105,.32)" strokeWidth="1.2" />
      </g>
      <g transform="translate(3.5 4)">
        <path className="aigw-g-cloud" d={CLOUD_D} fill={url(`${u}k`)} stroke="rgba(71,85,105,.3)" strokeWidth="1" />
      </g>
    </Glyph>
  ),
  rain: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}k`, P.cloudRain, 0, 11, 0, 34)}
        {lin(`${u}d`, P.rain, 0, -4, 0, 4)}
      </defs>
      <g transform="translate(0 -5)">
        <path className="aigw-g-cloud" d={CLOUD_D} fill={url(`${u}k`)} stroke="rgba(30,41,59,.32)" strokeWidth="1" />
      </g>
      {[[16.5, 36.5, ''], [24, 39.5, 'd1'], [31.5, 36.5, 'd2']].map(([x, y, d]) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <path className={`aigw-g-drop ${d}`} d={DROP_D} fill={url(`${u}d`)} stroke="none" />
        </g>
      ))}
    </Glyph>
  ),
  storm: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}k`, P.cloudStorm, 0, 11, 0, 34)}
        {lin(`${u}b`, P.bolt, 0, 27, 0, 47)}
        {lin(`${u}d`, P.rain, 0, -4, 0, 4)}
      </defs>
      <g transform="translate(0 -6)">
        <path className="aigw-g-cloud" d={CLOUD_D} fill={url(`${u}k`)} stroke="rgba(15,23,42,.38)" strokeWidth="1" />
      </g>
      <path className="aigw-g-bolt" d="M26.6 27 19.6 37.6h5.2L22 46.6l9.6-12.4h-5.4l3.3-7.2Z" fill={url(`${u}b`)} stroke="#C2410C" strokeWidth=".7" />
      <g transform="translate(14.5 35.5)"><path className="aigw-g-drop d2" d={DROP_D} fill={url(`${u}d`)} stroke="none" /></g>
      <g transform="translate(35 35.5)"><path className="aigw-g-drop d1" d={DROP_D} fill={url(`${u}d`)} stroke="none" /></g>
    </Glyph>
  ),
  wind: (u) => (
    <Glyph>
      <defs>{lin(`${u}w`, ['#5EEAD4', '#38BDF8', '#818CF8'], 6, 0, 42, 0)}</defs>
      <g stroke={url(`${u}w`)} strokeWidth="2.6">
        <path className="aigw-g-wind" d="M7 17h22a4 4 0 1 0-3.8-5.1" />
        <path className="aigw-g-wind d1" d="M7 25h28a4 4 0 1 1-3.8 5.1" />
        <path className="aigw-g-wind d2" d="M7 33h14a3.4 3.4 0 1 1-3.2 4.4" />
      </g>
    </Glyph>
  ),
  flame: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}o`, ['#FFD34E', '#FF8A1F', '#F43F3F'], 0, 6, 0, 42)}
        {lin(`${u}i`, ['#FFFBEA', '#FFE58A', '#FFB648'], 0, 24, 0, 40)}
      </defs>
      <g className="aigw-g-flame">
        <path d="M24 5c2 6.2 9.2 10.4 10.2 19.2C35.2 33.4 30.4 41.5 24 41.5c-6.9 0-11-5.9-10.6-12.6.3-5.3 3.8-8 5.4-12.6 1 3.7 2.6 5.3 4.1 5.8C22.4 16.4 22 10.2 24 5Z"
          fill={url(`${u}o`)} stroke="#C2410C" strokeWidth=".8" />
        <path d="M24.2 23.6c2.2 3.2 5 5.6 5 9.8 0 3.5-2.3 6-5.2 6s-5-2.2-4.8-5.3c.2-3 2.3-4.4 3.2-6.4.6 1.4 1.2 2 2 2.4-.4-2.1-.6-4.2-.2-6.5Z"
          fill={url(`${u}i`)} stroke="none" />
      </g>
    </Glyph>
  ),
  drop: (u) => (
    <Glyph>
      <defs>{lin(`${u}d`, ['#7DF0FF', '#38BDF8', '#4F46E5'], 0, 6, 0, 40)}</defs>
      <path className="aigw-g-wave" d="M24 6s12 12.4 12 21a12 12 0 0 1-24 0C12 18.4 24 6 24 6Z" fill={url(`${u}d`)} stroke="#2563EB" strokeWidth=".8" />
      <path className="aigw-g-drop d1" d="M18.6 28.2c.3 3.4 2.6 5.9 5.9 6.6" stroke="rgba(255,255,255,.85)" strokeWidth="2.2" />
      <ellipse cx="20.6" cy="20" rx="1.8" ry="3" fill="rgba(255,255,255,.6)" stroke="none" transform="rotate(28 20.6 20)" />
    </Glyph>
  ),
  waves: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}t`, ['#7DD3FC', '#3B82F6', '#4338CA'], 0, 13, 0, 32)}
        {lin(`${u}w`, ['#22D3EE', '#3B82F6', '#6366F1'], 4, 0, 44, 0)}
      </defs>
      {/* a whale fluke over the swell — «فعالیت نهنگ‌ها» */}
      <path className="aigw-g-coin" d="M22.5 31c.4-4.6.6-7.6.2-10.3-2.9.2-6.9-1.3-9.9-5.7 4 1 7.6 1.5 11.2 3.6 3.6-2.1 7.2-2.6 11.2-3.6-3 4.4-7 5.9-9.9 5.7-.4 2.7-.2 5.7.2 10.3Z"
        fill={url(`${u}t`)} stroke="#1E40AF" strokeWidth=".7" />
      <g stroke={url(`${u}w`)} strokeWidth="2.5">
        <path className="aigw-g-wind" d="M5 33c3.2-3 6.4-3 9.6 0s6.4 3 9.6 0 6.4-3 9.6 0 6.4 3 9.6 0" />
        <path className="aigw-g-wind d1" d="M5 40c3.2-3 6.4-3 9.6 0s6.4 3 9.6 0 6.4-3 9.6 0 6.4 3 9.6 0" opacity=".7" />
      </g>
    </Glyph>
  ),
  pulse: (u) => (
    <Glyph>
      <defs>{lin(`${u}p`, ['#F472B6', '#A78BFA', '#60A5FA'], 5, 0, 43, 0)}</defs>
      <path className="aigw-g-wind" d="M5 24h8.5l4-11 6.5 22 4-11h13" stroke={url(`${u}p`)} strokeWidth="2.7" />
      <circle className="aigw-g-sun-core" cx="42.5" cy="24" r="2.4" fill="#60A5FA" stroke="none" />
    </Glyph>
  ),
  thermometer: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}m`, ['#FDA4AF', '#F43F5E', '#BE123C'], 0, 14, 0, 42)}
        {rad(`${u}b`, ['#FFC2C2', '#F43F5E', '#BE123C'], 22.5, 34.5, 6.5)}
      </defs>
      <path d="M28 30.4V11a4 4 0 1 0-8 0v19.4a8 8 0 1 0 8 0Z" fill="rgba(148,163,184,.14)" stroke="#94A3B8" strokeWidth="1.6" />
      <path className="aigw-g-thermo" d="M24 34V15.5" stroke={url(`${u}m`)} strokeWidth="3.6" />
      <circle cx="24" cy="36" r="5.2" fill={url(`${u}b`)} stroke="none" />
      <g stroke="#94A3B8" strokeWidth="1.3"><path d="M31 13h2.6" /><path d="M31 18h2" /><path d="M31 23h2.6" /></g>
      <path d="M21.7 10.6v15.6" stroke="rgba(255,255,255,.42)" strokeWidth="1" />
    </Glyph>
  ),
  coin: (u) => {
    const coinAt = (y, top) => (
      <g key={y}>
        <path d={`M10 ${y}v5.5c0 3.3 6.3 6 14 6s14-2.7 14-6V${y}`} fill={url(`${u}s`)} stroke="#B45309" strokeWidth=".8" />
        <ellipse cx="24" cy={y} rx="14" ry="6" fill={url(`${u}t`)} stroke="#D97706" strokeWidth=".8" />
        {top ? <ellipse cx="24" cy={y} rx="8.6" ry="3.4" fill="none" stroke="#B45309" strokeWidth="1.1" opacity=".7" /> : null}
      </g>
    );
    return (
      <Glyph>
        <defs>
          {lin(`${u}t`, ['#FFF1B8', '#FCD34D', '#F59E0B'], 10, 0, 38, 0)}
          {lin(`${u}s`, ['#F59E0B', '#D97706', '#92400E'], 10, 0, 38, 0)}
        </defs>
        {coinAt(31, false)}
        {coinAt(23.5, false)}
        <g className="aigw-g-coin">{coinAt(15.5, true)}</g>
      </Glyph>
    );
  },
  building: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}a`, ['#C7D2FE', '#818CF8', '#4F46E5'], 0, 8, 0, 42)}
        {lin(`${u}b`, ['#DDD6FE', '#A78BFA', '#7C3AED'], 0, 19, 0, 42)}
      </defs>
      <path d="M10 42V12a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v30Z" fill={url(`${u}a`)} stroke="#4338CA" strokeWidth=".8" />
      <path d="M26 42V22a2.5 2.5 0 0 1 2.5-2.5h6A2.5 2.5 0 0 1 37 22v20Z" fill={url(`${u}b`)} stroke="#6D28D9" strokeWidth=".8" />
      <path d="M6 42h36" stroke="#94A3B8" strokeWidth="1.8" />
      <g fill="#FDE68A" stroke="none">
        <rect className="aigw-g-rise" x="14" y="14" width="3.2" height="3.2" rx=".8" />
        <rect className="aigw-g-rise d1" x="19" y="14" width="3.2" height="3.2" rx=".8" />
        <rect className="aigw-g-rise d2" x="14" y="21" width="3.2" height="3.2" rx=".8" />
        <rect className="aigw-g-rise" x="19" y="21" width="3.2" height="3.2" rx=".8" />
        <rect className="aigw-g-rise d1" x="14" y="28" width="3.2" height="3.2" rx=".8" />
        <rect className="aigw-g-rise d2" x="19" y="28" width="3.2" height="3.2" rx=".8" />
        <rect className="aigw-g-rise d2" x="29.5" y="25" width="4" height="2.6" rx=".8" />
        <rect className="aigw-g-rise" x="29.5" y="31" width="4" height="2.6" rx=".8" />
      </g>
      <rect x="16" y="35.5" width="4" height="6.5" rx="1" fill="#312E81" stroke="none" />
    </Glyph>
  ),
  bank: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}r`, ['#A7F3D0', '#34D399', '#059669'], 0, 7, 0, 20)}
        {lin(`${u}c`, ['#ECFDF5', '#6EE7B7', '#34D399'], 0, 23, 0, 36)}
        {lin(`${u}b`, ['#34D399', '#047857'], 0, 37, 0, 41)}
      </defs>
      <path d="M6.5 19 24 7.5 41.5 19Z" fill={url(`${u}r`)} stroke="#047857" strokeWidth=".8" />
      <circle cx="24" cy="14.6" r="2.1" fill="#ECFDF5" stroke="none" />
      <rect x="8" y="19.5" width="32" height="2.8" rx="1" fill="#10B981" stroke="none" />
      {[11, 18.5, 26, 33.5].map((x) => <rect key={x} x={x} y="23.4" width="3.6" height="12.6" rx="1.2" fill={url(`${u}c`)} stroke="none" />)}
      <rect x="6" y="37" width="36" height="3.4" rx="1.2" fill={url(`${u}b`)} stroke="none" />
      <rect x="4" y="41.2" width="40" height="2.4" rx="1.2" fill="#065F46" stroke="none" />
    </Glyph>
  ),
  shield: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}s`, ['#FFF3C4', '#FBBF24', '#D97706'], 10, 6, 38, 42)}
        <clipPath id={`${u}k`}><path d={SHIELD_D} /></clipPath>
      </defs>
      <path d={SHIELD_D} fill={url(`${u}s`)} stroke="#B45309" strokeWidth=".9" />
      <path d="M24 9.4 13.4 13.9V24c0 7 5.1 11.9 10.6 14.5Z" fill="rgba(255,255,255,.22)" stroke="none" />
      <g clipPath={url(`${u}k`)}>
        <path className="aigw-g-glint" d="M6 4h5L1 46h-5Z" fill="rgba(255,255,255,.6)" stroke="none" />
      </g>
      <path d="m18 24.5 4.2 4.2 8-8.7" stroke="#FFFFFF" strokeWidth="2.8" />
    </Glyph>
  ),
  news: (u) => (
    <Glyph>
      <defs>
        {lin(`${u}p`, ['#FFFFFF', '#E2E8F0', '#CBD5E1'], 0, 11, 0, 39)}
        {lin(`${u}h`, ['#818CF8', '#22D3EE'], 13, 0, 27, 0)}
      </defs>
      <path d="M30 17.5h7.5V34a4 4 0 0 1-4 4H30Z" fill="#CBD5E1" stroke="#94A3B8" strokeWidth=".8" />
      <path d="M10 11.5h20V38H14a4 4 0 0 1-4-4V11.5Z" fill={url(`${u}p`)} stroke="#94A3B8" strokeWidth=".9" />
      <rect x="13.5" y="15" width="13" height="3.6" rx="1.2" fill={url(`${u}h`)} stroke="none" />
      <rect x="13.5" y="21.5" width="5.5" height="5" rx="1" fill="#F472B6" stroke="none" opacity=".85" />
      <g stroke="#94A3B8" strokeWidth="1.6">
        <path className="aigw-g-rise" d="M21 22.5h5.5" />
        <path className="aigw-g-rise d1" d="M21 26h5.5" />
        <path className="aigw-g-rise d2" d="M13.5 30h13" />
        <path className="aigw-g-rise" d="M13.5 33.5h9" />
      </g>
    </Glyph>
  ),
  na: () => (
    <Glyph>
      <g className="aigw-g-sun-rays" opacity=".45" stroke="#64748B">
        <path d="M24 8v4" /><path d="M24 36v4" /><path d="M8 24h4" /><path d="M36 24h4" />
      </g>
      <circle cx="24" cy="24" r="10" stroke="#64748B" strokeDasharray="3 5" />
      <path d="M20 28c1.6-3 6.4-4 8-1" stroke="#64748B" opacity=".7" />
    </Glyph>
  )
};

/* ── 2b · the Persian lion ───────────────────────────────────────────────
   REPORTED (2026-10-15): «یه ایکون زیبای شیر هم کنار ایران بزار svg».
   A front-facing lion head: a two-layer swirling mane in amber and burnt
   orange, a golden face, dark almond eyes under a regal brow, a cream muzzle.
   It is ONE drawing in ONE place: the React component renders this markup,
   and the globe canvas draws the very same markup as an image — so the lion
   on the chip, on the country card and on the sphere can never differ. */
function manePath(cx, cy, r0, r1, n, phase, curl, alt = 1) {
  const pt = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const step = (Math.PI * 2) / n;
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const a0 = phase + i * step - Math.PI / 2;
    const tip = a0 + step * (0.5 + curl);
    const a2 = a0 + step;
    /* alternate long and short locks so the outline reads as hair, not as a gear */
    const r = r1 * (i % 2 ? alt : 1);
    if (i === 0) d += `M${pt(r0, a0)}`;
    d += `Q${pt(r * 0.9, a0 + step * 0.12)} ${pt(r, tip)}`;
    d += `Q${pt(r0 + (r - r0) * 0.5, a2 - step * 0.02)} ${pt(r0, a2)}`;
  }
  return `${d}Z`;
}
const LION_MANE_BACK = manePath(32, 34, 20, 31.5, 11, 0.3, 0.3, 0.9);
const LION_MANE_MID = manePath(32, 34, 18.5, 28.5, 13, 0.12, 0.28, 0.88);
const LION_MANE_FRONT = manePath(32, 33.5, 16.5, 24, 15, 0, 0.26, 0.9);

export function lionMarkup(id = 'lion') {
  const g = (k) => `${id}-${k}`;
  return [
    '<defs>',
    `<radialGradient id="${g('mb')}" gradientUnits="userSpaceOnUse" cx="32" cy="34" r="32"><stop offset="55%" stop-color="#C2410C"/><stop offset="100%" stop-color="#7C2D12"/></radialGradient>`,
    `<radialGradient id="${g('mm')}" gradientUnits="userSpaceOnUse" cx="32" cy="33" r="29"><stop offset="50%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#C2410C"/></radialGradient>`,
    `<radialGradient id="${g('mf')}" gradientUnits="userSpaceOnUse" cx="32" cy="30" r="25"><stop offset="45%" stop-color="#FDE68A"/><stop offset="80%" stop-color="#FBBF24"/><stop offset="100%" stop-color="#EA8A0B"/></radialGradient>`,
    `<radialGradient id="${g('fc')}" gradientUnits="userSpaceOnUse" cx="32" cy="27" r="22"><stop offset="0%" stop-color="#FDE7A6"/><stop offset="55%" stop-color="#F8C24C"/><stop offset="100%" stop-color="#E48A0E"/></radialGradient>`,
    `<linearGradient id="${g('ns')}" gradientUnits="userSpaceOnUse" x1="0" y1="36" x2="0" y2="41"><stop offset="0%" stop-color="#6B3410"/><stop offset="100%" stop-color="#2B1404"/></linearGradient>`,
    '</defs>',
    `<path d="${LION_MANE_BACK}" fill="url(#${g('mb')})"/>`,
    `<path d="${LION_MANE_MID}" fill="url(#${g('mm')})"/>`,
    `<path d="${LION_MANE_FRONT}" fill="url(#${g('mf')})" stroke="#C2410C" stroke-width=".45"/>`,
    /* ears */
    '<path d="M17.2 22.4c-1.6-4.2.4-8 4.3-8.4 2.6-.2 4.4 1.4 4.8 3.4Z" fill="#F59E0B" stroke="#B45309" stroke-width=".6"/>',
    '<path d="M46.8 22.4c1.6-4.2-.4-8-4.3-8.4-2.6-.2-4.4 1.4-4.8 3.4Z" fill="#F59E0B" stroke="#B45309" stroke-width=".6"/>',
    '<path d="M19.2 20.4c-.7-2.4.4-4.4 2.4-4.6 1.4-.1 2.4.7 2.7 1.8Z" fill="#9A3412"/>',
    '<path d="M44.8 20.4c.7-2.4-.4-4.4-2.4-4.6-1.4-.1-2.4.7-2.7 1.8Z" fill="#9A3412"/>',
    /* face: broad brow, wide cheeks, a strong muzzle */
    `<path d="M32 16c7.6 0 13.4 4.6 14.2 11.6.6 5.4-1.6 9.6-4.6 12.6-1.6 1.6-2.2 3.6-3.4 5.6-1.4 2.4-3.6 3.6-6.2 3.6s-4.8-1.2-6.2-3.6c-1.2-2-1.8-4-3.4-5.6-3-3-5.2-7.2-4.6-12.6C18.6 20.6 24.4 16 32 16Z" fill="url(#${g('fc')})" stroke="#C2410C" stroke-width=".55"/>`,
    /* shading: brow bones and cheeks, so the face has relief */
    '<path d="M20.6 27.4c2.2-3.8 6.8-5 10-3.2l-.9 2.2c-2.8-1.2-6.2-.6-9.1 1Z" fill="#D97706" opacity=".45"/>',
    '<path d="M43.4 27.4c-2.2-3.8-6.8-5-10-3.2l.9 2.2c2.8-1.2 6.2-.6 9.1 1Z" fill="#D97706" opacity=".45"/>',
    '<ellipse cx="21.8" cy="35.4" rx="3.2" ry="4.8" fill="#D97706" opacity=".28"/>',
    '<ellipse cx="42.2" cy="35.4" rx="3.2" ry="4.8" fill="#D97706" opacity=".28"/>',
    /* the bridge of the nose, lighter */
    '<path d="M30.1 27.4c.9 3.5.7 6.2-.6 9.2h5c-1.3-3-1.5-5.7-.6-9.2Z" fill="#FFF0C4" opacity=".9"/>',
    /* brow and eyes: angled, amber, regal */
    '<path d="M21.4 26.3c2.7-2.2 6.1-2.5 8.9-.8M42.6 26.3c-2.7-2.2-6.1-2.5-8.9-.8" fill="none" stroke="#8A3A10" stroke-width="1.35" stroke-linecap="round" opacity=".9"/>',
    '<path d="M22.6 29.7c1.7-2.4 5-2.8 7.2-.6-1.6 1.9-5 2.2-7.2.6Z" fill="#FBBF24" stroke="#2B1404" stroke-width=".9" stroke-linejoin="round"/>',
    '<path d="M41.4 29.7c-1.7-2.4-5-2.8-7.2-.6 1.6 1.9 5 2.2 7.2.6Z" fill="#FBBF24" stroke="#2B1404" stroke-width=".9" stroke-linejoin="round"/>',
    '<circle cx="26.5" cy="29.2" r="1.15" fill="#1C0A02"/><circle cx="37.5" cy="29.2" r="1.15" fill="#1C0A02"/>',
    '<circle cx="26.9" cy="28.8" r=".4" fill="#FFF"/><circle cx="37.9" cy="28.8" r=".4" fill="#FFF"/>',
    /* muzzle, chin, nose, mouth */
    '<path d="M32 47.2c-2 0-3.4-.7-3.9-1.8 1.3.5 2.6.7 3.9.7s2.6-.2 3.9-.7c-.5 1.1-1.9 1.8-3.9 1.8Z" fill="#E9B866"/>',
    '<ellipse cx="28.6" cy="41.5" rx="4.4" ry="3.4" fill="#FFF3D4"/>',
    '<ellipse cx="35.4" cy="41.5" rx="4.4" ry="3.4" fill="#FFF3D4"/>',
    `<path d="M27.4 36.6c0-1.5 9.2-1.5 9.2 0 0 2.1-2.9 4.2-4.6 4.2s-4.6-2.1-4.6-4.2Z" fill="url(#${g('ns')})"/>`,
    '<path d="M29.3 36.5c1-.45 2.3-.55 3.3-.4" fill="none" stroke="#A0602E" stroke-width=".75" stroke-linecap="round"/>',
    '<path d="M32 40.8v1.8M32 42.6c-1 1.4-2.7 1.8-4.1 1M32 42.6c1 1.4 2.7 1.8 4.1 1" fill="none" stroke="#3B1A06" stroke-width="1" stroke-linecap="round"/>',
    '<g fill="#B45309"><circle cx="26.8" cy="40.9" r=".5"/><circle cx="28.4" cy="42.5" r=".5"/><circle cx="26.6" cy="43.1" r=".42"/><circle cx="37.2" cy="40.9" r=".5"/><circle cx="35.6" cy="42.5" r=".5"/><circle cx="37.4" cy="43.1" r=".42"/></g>'
  ].join('');
}

/** The lion as a standalone SVG document (the globe canvas draws it as an image). */
export function lionSvgDocument(size = 96) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${lionMarkup('cv')}</svg>`;
}

export function LionIcon({ size = 18, className = '', title }) {
  const id = useSvgId('lion');
  return (
    <svg className={`aigw-lion ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64"
      role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : 'true'}
      dangerouslySetInnerHTML={{ __html: lionMarkup(id) }} />
  );
}

/* ── 3 · the console rail glyphs (eleven sub-tabs) ───────────────────────
   Modernised: every tab has a distinctive drawing rather than the old
   near-duplicate circles, and the rail tints each one with its accent. */
export const TAB_PATHS = {
  briefing: <><path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" /><path d="M17 8h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2" /><path d="M8 8h6" /><path d="M8 12h6" /><path d="M8 16h4" /></>,
  world: <><circle cx="12" cy="12" r="9" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" /><path d="M3 12h7" /><path d="M14 12h7" /><path d="M15 8h4" /><path d="M6 15.5h3" /></>,
  globeMap: <><circle cx="11" cy="11" r="7" /><path d="M11 4c3 3 3 11 0 14" /><path d="M4 11h14" /><ellipse cx="12" cy="17" rx="9.5" ry="3.4" /><path d="M7.6 19.4 6 22" /><path d="M16.4 19.4 18 22" /></>,
  radar: <><path d="M20.5 5.5A10 10 0 1 0 18 20" /><path d="M16.2 9.8A5 5 0 1 0 14 16.6" /><circle cx="12" cy="12" r="1.2" /><path d="M12 12l7.5-4.5" /></>,
  cross: <><path d="M4 17 12 5l8 12" /><path d="M7 15h10" /><path d="M12 5v14" /><path d="M5 20h14" /></>,
  causal: <><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="12" r="2.4" /><circle cx="7" cy="18" r="2.4" /><path d="M8.3 7.8 15.8 11" /><path d="M8.3 12.4 15.7 16" /><path d="M6 9.4v6.2" /></>,
  flows: <><path d="M3 7h11a4 4 0 0 1 0 8H8" /><path d="M21 17H10a4 4 0 0 1 0-8h3" /><path d="m6 12 3 3-3 3" /><path d="m18 12-3-3 3-3" /></>,
  future: <><path d="M12 21V9" /><path d="M12 12c-3 0-4.5-2-5-5 2 .5 3.5 1.6 5 1.6S15.5 7.5 17.5 7c-.5 3-2 5-5.5 5Z" /><circle cx="12" cy="5" r="2" /><circle cx="6" cy="15" r="1.6" /><circle cx="18" cy="15" r="1.6" /></>,
  dna: <><path d="M8 3c0 7 8 7 8 14 0 3-1 5-3 6" /><path d="M16 3c0 7-8 7-8 14 0 3 1 5 3 6" /><path d="M9.6 7.5h4.8" /><path d="M9.6 16.5h4.8" /></>,
  domains: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><path d="M13.5 17h7" /><path d="M17 13.5v7" /></>,
  providers: <><path d="M8 3v6" /><path d="M16 3v6" /><path d="M5 9h14v1a7 7 0 0 1-7 7 7 7 0 0 1-7-7V9Z" /><path d="M12 17v4" /><path d="M8 21h8" /></>
};

export const TAB_ACCENTS = Object.freeze({
  briefing: ['#7c4dff', '#00e5ff'],
  world: ['#22d3ee', '#34d399'],
  globeMap: ['#38bdf8', '#818cf8'],
  radar: ['#4ade80', '#facc15'],
  cross: ['#fbbf24', '#f472b6'],
  causal: ['#fb923c', '#f472b6'],
  flows: ['#2dd4bf', '#22d3ee'],
  future: ['#a3e635', '#22d3ee'],
  dna: ['#e879f9', '#38bdf8'],
  domains: ['#60a5fa', '#a78bfa'],
  providers: ['#7dd3fc', '#94a3b8']
});

export function TabIcon({ name, size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {TAB_PATHS[name] || TAB_PATHS.world}
    </svg>
  );
}

export default WIcon;
