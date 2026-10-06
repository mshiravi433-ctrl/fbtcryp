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
import { memo } from 'react';

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

export const WIcon = memo(function WIcon({ name, size = 16, style, className }) {
  return (
    <svg className={className || 'aigw-icon'} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
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

/* ── 2 · the ANIMATED weather glyphs ─────────────────────────────────────
   Each glyph is a 48×48 stroke drawing whose PARTS carry animation classes
   (defined in styles.js). `tone` picks the glyph the station's reading maps
   to; `name` lets a station keep its semantic icon (a flame for energy, a
   building for institutional flow) while staying animated. */
function Glyph({ children }) {
  return (
    <svg className="aigw-glyph-svg" width="46" height="46" viewBox="0 0 48 48" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function WeatherGlyph({ name = 'cloud', size = 46 }) {
  const g = GLYPHS[name] || GLYPHS.cloud;
  return <span className="aigw-glyph" style={{ width: size, height: size }}>{g}</span>;
}

const CLOUD = (d = '') => (
  <path className={`aigw-g-cloud ${d}`} d="M31 30a7 7 0 0 0 .6-14A9.4 9.4 0 0 0 13.4 17.6 7 7 0 0 0 14.5 31.5" />
);

const GLYPHS = {
  sun: (
    <Glyph>
      <g className="aigw-g-sun-rays">
        <path d="M24 6v4" /><path d="M24 38v4" /><path d="M6 24h4" /><path d="M38 24h4" />
        <path d="m11.3 11.3 2.8 2.8" /><path d="m33.9 33.9 2.8 2.8" /><path d="m36.7 11.3-2.8 2.8" /><path d="m14.1 33.9-2.8 2.8" />
      </g>
      <circle className="aigw-g-sun-core" cx="24" cy="24" r="8.5" />
    </Glyph>
  ),
  partly: (
    <Glyph>
      <g className="aigw-g-sun-rays">
        <path d="M18 8v3" /><path d="M8 18h3" /><path d="m11.4 11.4 2.1 2.1" />
      </g>
      <circle className="aigw-g-sun-core" cx="18" cy="18" r="5.5" />
      {CLOUD()}
    </Glyph>
  ),
  cloud: <Glyph>{CLOUD()}<path className="aigw-g-cloud d1" d="M22 40a5.5 5.5 0 0 0 .5-11A7.4 7.4 0 0 0 8 30.6 5.5 5.5 0 0 0 9 40.5" opacity=".55" /></Glyph>,
  rain: (
    <Glyph>
      {CLOUD()}
      <path className="aigw-g-drop" d="M17 35v3" /><path className="aigw-g-drop d1" d="M24 36v3" /><path className="aigw-g-drop d2" d="M31 35v3" />
    </Glyph>
  ),
  storm: (
    <Glyph>
      {CLOUD()}
      <path className="aigw-g-bolt" d="m25 33-4 8h6l-3 7" />
      <path className="aigw-g-drop d2" d="M16 35v2" /><path className="aigw-g-drop d1" d="M33 35v2" />
    </Glyph>
  ),
  wind: (
    <Glyph>
      <path className="aigw-g-wind" d="M8 17h22a4 4 0 1 0-3.8-5.1" />
      <path className="aigw-g-wind d1" d="M8 25h28a4 4 0 1 1-3.8 5.1" />
      <path className="aigw-g-wind d2" d="M8 33h14a3.4 3.4 0 1 1-3.2 4.4" />
    </Glyph>
  ),
  flame: (
    <Glyph>
      <path className="aigw-g-flame" d="M24 6c2 6-6 9-6 16a6 6 0 0 0 12 0c0-2.4-.8-4.4-2-6 4 1 8 4.8 8 10a12 12 0 0 1-24 0c0-10 10-13 12-20Z" />
    </Glyph>
  ),
  drop: (
    <Glyph>
      <path className="aigw-g-wave" d="M24 8s10 11 10 18a10 10 0 0 1-20 0C14 19 24 8 24 8Z" />
      <path className="aigw-g-drop d1" d="M20 30c1.5 2 4 2.6 6 1.4" />
    </Glyph>
  ),
  waves: (
    <Glyph>
      <path className="aigw-g-wind" d="M6 18c4-4 8-4 12 0s8 4 12 0 8-4 12 0" />
      <path className="aigw-g-wind d1" d="M6 26c4-4 8-4 12 0s8 4 12 0 8-4 12 0" />
      <path className="aigw-g-wind d2" d="M6 34c4-4 8-4 12 0s8 4 12 0 8-4 12 0" />
    </Glyph>
  ),
  pulse: (
    <Glyph>
      <path className="aigw-g-wind" d="M6 24h8l4-11 6 22 4-11h8" />
    </Glyph>
  ),
  thermometer: (
    <Glyph>
      <path d="M28 30.4V12a4 4 0 1 0-8 0v18.4a8 8 0 1 0 8 0Z" />
      <path className="aigw-g-thermo" d="M24 20v10" />
      <circle className="aigw-g-sun-core" cx="24" cy="36" r="4" />
    </Glyph>
  ),
  coin: (
    <Glyph>
      <ellipse cx="24" cy="16" rx="14" ry="6" />
      <path d="M10 16v8c0 3.3 6.3 6 14 6s14-2.7 14-6v-8" />
      <path className="aigw-g-coin" d="M10 26v6c0 3.3 6.3 6 14 6s14-2.7 14-6v-6" />
    </Glyph>
  ),
  coin1: null,
  building: (
    <Glyph>
      <path d="M10 42V12a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v30" />
      <path d="M26 20h8a3 3 0 0 1 3 3v19" />
      <path d="M6 42h36" />
      <path className="aigw-g-rise" d="M16 17h4" /><path className="aigw-g-rise d1" d="M16 25h4" /><path className="aigw-g-rise d2" d="M16 33h4" />
    </Glyph>
  ),
  bank: (
    <Glyph>
      <path d="M8 18 24 8l16 10" />
      <path d="M12 20v16" /><path d="M20 20v16" /><path d="M28 20v16" /><path d="M36 20v16" />
      <path d="M8 40h32" />
    </Glyph>
  ),
  shield: (
    <Glyph>
      <path d="M24 6 10 12v12c0 9 7 15 14 18 7-3 14-9 14-18V12L24 6Z" />
      <path className="aigw-g-bolt" d="m19 24 4 4 7-8" />
    </Glyph>
  ),
  news: (
    <Glyph>
      <path d="M10 12h20v26H14a4 4 0 0 1-4-4V12Z" />
      <path d="M30 18h8v16a4 4 0 0 1-4 4" />
      <path className="aigw-g-rise" d="M16 19h10" /><path className="aigw-g-rise d1" d="M16 26h10" /><path className="aigw-g-rise d2" d="M16 33h6" />
    </Glyph>
  ),
  cloudSun: null,
  na: (
    <Glyph>
      <g className="aigw-g-sun-rays" opacity=".5">
        <path d="M24 8v4" /><path d="M24 36v4" /><path d="M8 24h4" /><path d="M36 24h4" />
      </g>
      <circle cx="24" cy="24" r="10" strokeDasharray="3 5" />
      <path d="M20 28c1.6-3 6.4-4 8-1" opacity=".7" />
    </Glyph>
  )
};

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
