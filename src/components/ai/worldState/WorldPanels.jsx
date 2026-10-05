/**
 * FBT WORLD CONSOLE — the visual layer of the «FBT جهانی» upgrade.
 * ---------------------------------------------------------------------------
 * REPORTED: «از آیکون‌های SVG و گراف‌های جذاب، مثلاً کره زمین که روی هر کشوری
 * بزنی خلاصهٔ گراف از وضعیت اقتصادی بده … زیرتب‌های بی‌نظیر و بی‌همتا.»
 *
 * Seven new sub-tabs under the Global Intelligence tab, all drawn with inline
 * SVG (no images, no external tiles, no GeoJSON — the bundle stays light and
 * nothing new hits the network on refresh):
 *
 *   · WorldStatePanel  — GLOBAL FINANCIAL STATE + FINANCIAL WEATHER + radar
 *   · GlobePanel       — an interactive network-globe; tap a country, get its
 *                        economic snapshot from what THIS pass actually read
 *   · RadarPanel       — the permanent FBT GLOBAL RADAR (animated sweep)
 *   · CausalPanel      — CAUSAL INTELLIGENCE: the server's own macro-graph,
 *                        fetched lazily ONCE on first open, with a local
 *                        fallback chain when it cannot be reached
 *   · FlowMapPanel     — GLOBAL CAPITAL FLOW MAP (USD → … → RWA), every node
 *                        lit only by a real reading
 *   · FutureTreePanel  — FUTURE TREE (bull/base/stress) + ADVERSARIAL AI
 *   · DnaPanel         — MARKET DNA per asset (model priors + observed)
 *
 * All numbers come from worldModel.js derivations over the pass's payload —
 * the upgrade adds surface, not traffic.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { apiBase } from '../../../lib/apiBase.js';
import {
  buildWorldState, buildWeather, buildRadar, buildCountrySnapshot,
  buildFlowMap, buildFutureTree, buildChallenger, buildDna, buildCausalLocal,
  COUNTRIES, FUTURE_ASSETS, DNA_ASSETS, num, round
} from './worldModel.js';

/* ── tiny localisers shared by the panels (same rules as the host panel) ── */
const FA_DIGITS = ['\u06f0', '\u06f1', '\u06f2', '\u06f3', '\u06f4', '\u06f5', '\u06f6', '\u06f7', '\u06f8', '\u06f9'];
const faNum = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]).replace(/-/g, '\u2212');
const pct = (v, isPersian) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const ascii = `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
  return isPersian ? faNum(ascii).replace('%', '\u066a') : ascii;
};
const moneyK = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};

/* ── the panel icon set (stroke, inherits currentColor) ────────────────── */
const W_PATHS = {
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
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>
};
function WIcon({ name, size = 16, style, className }) {
  return (
    <svg className={className || 'aigw-icon'} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {W_PATHS[name] || W_PATHS.pulse}
    </svg>
  );
}
function DirMark({ dir, size = 11 }) {
  const kind = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat';
  return (
    <svg className={`aigw-dir aigw-dir-${kind}`} width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {kind === 'up' ? <path d="M6 1 11 10H1z" /> : kind === 'down' ? <path d="M6 11 1 2h10z" /> : <rect x="1" y="5" width="10" height="2" rx="1" />}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   STYLES — scoped with the aigw- prefix, same material as the host panel.
   ══════════════════════════════════════════════════════════════════════════ */
export const WORLD_STYLES = `
  /* ── shared bits ─────────────────────────────────────────────────────── */
  .aigw-icon { flex:0 0 auto; display:inline-block; vertical-align:-3px; }
  .aigw-dir { flex:0 0 auto; display:inline-block; vertical-align:-1px; }
  .aigw-dir-up { color:var(--up); } .aigw-dir-down { color:var(--down); } .aigw-dir-flat { color:var(--text-3); }
  .aigw-note { font-size:10px; color:var(--text-3); line-height:1.8; margin-top:10px; }
  .aigw-chips { display:flex; gap:7px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none; }
  .aigw-chips::-webkit-scrollbar { display:none; }
  .aigw-chip {
    flex:0 0 auto; display:inline-flex; align-items:center; gap:6px;
    padding:7px 11px; border-radius:999px; cursor:pointer; font:inherit;
    font-size:11px; font-weight:800; color:var(--text-2);
    border:1px solid color-mix(in srgb,var(--line) 80%,transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.008)), var(--bg-raised);
    transition:color .2s, border-color .2s, transform .2s;
  }
  .aigw-chip:hover { color:var(--text-1); }
  .aigw-chip.active {
    color:var(--text-1); border-color:color-mix(in srgb,var(--rgb-2) 45%,transparent);
    background:linear-gradient(140deg,color-mix(in srgb,var(--rgb-1) 16%,var(--bg-panel-solid)),color-mix(in srgb,var(--rgb-2) 18%,var(--bg-panel-solid)));
    box-shadow:0 10px 22px -16px color-mix(in srgb,var(--rgb-2) 90%,transparent);
    transform:translateY(-1px);
  }
  .aigw-pill { display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:999px; font-size:10px; font-weight:850; white-space:nowrap; }
  .aigw-pill.up { color:var(--up); background:color-mix(in srgb,var(--up) 12%,transparent); border:1px solid color-mix(in srgb,var(--up) 30%,transparent); }
  .aigw-pill.down { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); border:1px solid color-mix(in srgb,var(--down) 30%,transparent); }
  .aigw-pill.flat { color:var(--text-2); background:color-mix(in srgb,var(--rgb-5) 10%,transparent); border:1px solid color-mix(in srgb,var(--rgb-5) 26%,transparent); }
  .aigw-pill.warn { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 11%,transparent); border:1px solid color-mix(in srgb,var(--rgb-5) 28%,transparent); }
  .aigw-pill.bad { color:var(--down); background:color-mix(in srgb,var(--down) 11%,transparent); border:1px solid color-mix(in srgb,var(--down) 28%,transparent); }
  .aigw-pill.info { color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 12%,transparent); border:1px solid color-mix(in srgb,var(--rgb-2) 30%,transparent); }
  .aigw-pill.ghost { color:var(--text-3); background:transparent; border:1px dashed color-mix(in srgb,var(--line) 90%,transparent); }
  .aigw-ltr { direction:ltr; unicode-bidi:embed; font-variant-numeric:tabular-nums; }

  /* ── WORLD STATE ─────────────────────────────────────────────────────── */
  .aigw-weather { display:flex; gap:8px; overflow-x:auto; padding:2px 1px 6px; scrollbar-width:none; }
  .aigw-weather::-webkit-scrollbar { display:none; }
  .aigw-weather-card {
    flex:0 0 auto; width:92px; padding:11px 8px 9px; text-align:center; border-radius:16px;
    border:1px solid color-mix(in srgb,var(--line) 75%,transparent);
    background:linear-gradient(170deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01)), var(--bg-raised);
  }
  .aigw-weather-card.tone-sun { border-color:color-mix(in srgb,var(--up) 30%,var(--line)); }
  .aigw-weather-card.tone-rain, .aigw-weather-card.tone-storm { border-color:color-mix(in srgb,var(--down) 30%,var(--line)); }
  .aigw-weather-card.tone-windy { border-color:color-mix(in srgb,var(--rgb-5) 32%,var(--line)); }
  .aigw-weather-icon { display:grid; place-items:center; width:34px; height:34px; margin:0 auto 7px; border-radius:12px;
    color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 10%,transparent); }
  .aigw-weather-card.tone-sun .aigw-weather-icon { color:var(--up); background:color-mix(in srgb,var(--up) 11%,transparent); }
  .aigw-weather-card.tone-rain .aigw-weather-icon, .aigw-weather-card.tone-storm .aigw-weather-icon { color:var(--down); background:color-mix(in srgb,var(--down) 11%,transparent); }
  .aigw-weather-card.tone-windy .aigw-weather-icon { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 11%,transparent); }
  .aigw-weather-name { font-size:10px; font-weight:800; color:var(--text-2); line-height:1.5; }
  .aigw-weather-val { margin-top:4px; font-size:11px; font-weight:900; color:var(--text-1); }
  .aigw-weather-card.tone-sun .aigw-weather-icon svg { animation:aigw-bob 3.2s ease-in-out infinite; }
  .aigw-weather-card.tone-storm .aigw-weather-icon svg { animation:aigw-shake 1.6s ease-in-out infinite; }
  @keyframes aigw-bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-2px); } }
  @keyframes aigw-shake { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-1.2px); } 75% { transform:translateX(1.2px); } }

  .aigw-gauge {
    display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:11px;
    padding:11px 12px; margin-bottom:8px; border-radius:16px;
    border:1px solid color-mix(in srgb,var(--line) 74%,transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.008)), var(--bg-raised);
  }
  .aigw-gauge-icon { display:grid; place-items:center; width:34px; height:34px; border-radius:12px; color:var(--rgb-1);
    background:linear-gradient(140deg,color-mix(in srgb,var(--rgb-1) 13%,transparent),color-mix(in srgb,var(--rgb-2) 12%,transparent)); }
  .aigw-gauge-name { font-size:11.5px; font-weight:850; color:var(--text-1); line-height:1.55; }
  .aigw-gauge-ev { margin-top:3px; font-size:10px; color:var(--text-3); line-height:1.65; overflow-wrap:anywhere; }
  .aigw-gauge-side { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .aigw-gauge-meter { display:flex; gap:3px; direction:ltr; }
  .aigw-gauge-meter i { width:13px; height:5px; border-radius:99px; background:color-mix(in srgb,var(--text-1) 11%,transparent); }
  .aigw-gauge-meter i.on { background:linear-gradient(90deg,var(--rgb-1),var(--rgb-2)); box-shadow:0 0 8px -2px color-mix(in srgb,var(--rgb-1) 75%,transparent); }
  .aigw-gauge-meter i.on.bad { background:linear-gradient(90deg,var(--down),color-mix(in srgb,var(--down) 60%,var(--rgb-5))); }

  .aigw-ribbon {
    display:flex; align-items:center; gap:9px; margin-top:12px; padding:11px 13px; border-radius:16px; cursor:pointer;
    border:1px solid color-mix(in srgb,var(--rgb-2) 28%,var(--line));
    background:linear-gradient(140deg,color-mix(in srgb,var(--rgb-1) 9%,transparent),color-mix(in srgb,var(--rgb-2) 10%,transparent));
    font:inherit; text-align:start; width:100%;
  }
  .aigw-ribbon:hover { filter:brightness(1.06); }
  .aigw-ribbon-dots { display:flex; gap:7px; align-items:center; }
  .aigw-ribbon-dots b { display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:850; color:var(--text-2); }

  /* radar tone dots (shared) */
  .aigw-dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
  .aigw-dot.t-critical { background:#ef4444; box-shadow:0 0 8px rgba(239,68,68,.7); }
  .aigw-dot.t-emerging { background:#f97316; box-shadow:0 0 8px rgba(249,115,22,.6); }
  .aigw-dot.t-developing { background:#eab308; box-shadow:0 0 8px rgba(234,179,8,.5); }
  .aigw-dot.t-stable { background:#22c55e; }
  .aigw-dot.t-opportunity { background:#38bdf8; box-shadow:0 0 8px rgba(56,189,248,.6); }

  /* ── GLOBE ───────────────────────────────────────────────────────────── */
  /* max-width matches the svg's own cap so the %-positioned country label
     always sits over the sphere, even on wider layouts. */
  .aigw-globe-wrap { position:relative; display:grid; place-items:center; width:100%; max-width:332px; margin-inline:auto; padding:4px 0 2px; }
  .aigw-globe { width:100%; max-width:332px; height:auto; display:block; }
  .aigw-globe-graticule { opacity:.5; }
  .aigw-orbit-a, .aigw-orbit-b { transform-origin:50% 50%; transform-box:view-box; }
  .aigw-orbit-a { animation:aigw-orbit 30s linear infinite; }
  .aigw-orbit-b { animation:aigw-orbit 44s linear infinite reverse; }
  @keyframes aigw-orbit { to { transform:rotate(360deg); } }
  .aigw-globe-dot { cursor:pointer; }
  .aigw-globe-dot .aigw-dot-core { transition:r .2s ease; }
  .aigw-globe-dot:hover .aigw-dot-core { r:7; }
  .aigw-globe-halo { transform-origin:50% 50%; transform-box:fill-box; animation:aigw-halo 2.2s ease-out infinite; }
  @keyframes aigw-halo { 0% { opacity:.55; transform:scale(.5); } 100% { opacity:0; transform:scale(1.9); } }
  .aigw-globe-arc { stroke-dasharray:4 5; animation:aigw-dash 26s linear infinite; }
  @keyframes aigw-dash { to { stroke-dashoffset:-360; } }
  .aigw-country-label {
    position:absolute; transform:translate(-50%,-165%); pointer-events:none;
    padding:3px 9px; border-radius:999px; font-size:10px; font-weight:900; white-space:nowrap; color:var(--text-1);
    background:color-mix(in srgb,var(--bg-panel-solid) 86%,transparent);
    border:1px solid color-mix(in srgb,var(--rgb-2) 40%,transparent);
    box-shadow:0 8px 18px -12px rgba(0,0,0,.8);
  }
  .aigw-country-card {
    margin-top:12px; padding:14px; border-radius:18px;
    border:1px solid color-mix(in srgb,var(--rgb-1) 24%,var(--line));
    background:linear-gradient(150deg,color-mix(in srgb,var(--rgb-1) 9%,transparent), rgba(255,255,255,0.012));
  }
  .aigw-country-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:9px; }
  .aigw-country-name { font-size:13.5px; font-weight:900; color:var(--text-1); }
  .aigw-country-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; padding:8px 0; border-top:1px solid color-mix(in srgb,var(--line) 62%,transparent); }
  .aigw-country-sym { font-size:11px; font-weight:850; color:var(--text-1); }
  .aigw-country-sub { font-size:9.5px; color:var(--text-3); margin-top:2px; overflow-wrap:anywhere; line-height:1.6; }
  .aigw-country-bar { position:relative; width:110px; height:6px; border-radius:99px; direction:ltr;
    background:color-mix(in srgb,var(--text-1) 10%,transparent); overflow:hidden; }
  .aigw-country-bar i { position:absolute; top:0; bottom:0; border-radius:99px; transition:width .5s cubic-bezier(.4,0,.2,1); }
  .aigw-country-bar i.up { inset-inline-start:50%; background:var(--up); }
  .aigw-country-bar i.down { inset-inline-end:50%; background:var(--down); }
  .aigw-country-val { font-size:11px; font-weight:900; color:var(--text-1); min-width:52px; text-align:end; }

  /* ── RADAR ───────────────────────────────────────────────────────────── */
  .aigw-radar-wrap { display:grid; place-items:center; }
  .aigw-radar { width:100%; max-width:312px; height:auto; display:block; }
  .aigw-sweep { transform-origin:50% 50%; transform-box:view-box; animation:aigw-sweep 4.8s linear infinite; }
  @keyframes aigw-sweep { to { transform:rotate(360deg); } }
  .aigw-blip { cursor:pointer; }
  .aigw-blip circle.b-core { transition:r .18s ease; }
  .aigw-blip:hover circle.b-core { r:6.5; }
  .aigw-blip-ping { transform-origin:50% 50%; transform-box:fill-box; animation:aigw-halo 1.9s ease-out infinite; }
  .aigw-blip-detail {
    margin-top:11px; padding:11px 13px; border-radius:14px;
    border:1px solid color-mix(in srgb,var(--line) 74%,transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.008)), var(--bg-raised);
  }

  /* ── CAUSAL ──────────────────────────────────────────────────────────── */
  .aigw-chain { margin:10px 0 4px; }
  .aigw-chain-node {
    position:relative; display:flex; align-items:center; gap:10px;
    padding:11px 13px; border-radius:15px;
    border:1px solid color-mix(in srgb,var(--line) 74%,transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.042), rgba(255,255,255,0.008)), var(--bg-raised);
  }
  .aigw-chain-node.state-read { border-color:color-mix(in srgb,var(--rgb-1) 30%,var(--line)); }
  .aigw-chain-node.state-proxy { border-style:dashed; }
  .aigw-chain-node.state-unread { opacity:.72; }
  .aigw-chain-ico { display:grid; place-items:center; width:30px; height:30px; border-radius:10px; flex:0 0 auto;
    color:var(--rgb-1); background:color-mix(in srgb,var(--rgb-1) 11%,transparent); }
  .aigw-chain-arrow { display:grid; place-items:center; height:26px; color:var(--text-3); position:relative; }
  .aigw-chain-arrow.lit { color:var(--rgb-2); }
  .aigw-chain-arrow.lit::before {
    content:''; position:absolute; inset-inline-start:50%; top:0; bottom:0; width:2px; margin-inline-start:-1px; border-radius:99px;
    background:linear-gradient(180deg,transparent,var(--rgb-2));
    animation:aigw-fall 1.8s ease-in-out infinite;
  }
  @keyframes aigw-fall { 0% { opacity:0; transform:translateY(-6px);} 45% {opacity:.9;} 100% { opacity:0; transform:translateY(7px);} }
  .aigw-causal-cols { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:10px 0; }
  .aigw-causal-col { min-width:0; }
  .aigw-causal-col h4 { margin:0 0 6px; font-size:10px; font-weight:900; color:var(--text-3); letter-spacing:.2px; }
  .aigw-node-chip {
    display:flex; align-items:center; gap:7px; padding:7px 9px; margin-bottom:6px; border-radius:11px;
    font-size:10.5px; font-weight:800; color:var(--text-1);
    border:1px solid color-mix(in srgb,var(--line) 72%,transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.008)), var(--bg-raised);
    overflow-wrap:anywhere; line-height:1.5;
  }
  .aigw-node-chip.risk-up { border-color:color-mix(in srgb,var(--down) 34%,var(--line)); }
  .aigw-node-chip.risk-down { border-color:color-mix(in srgb,var(--up) 30%,var(--line)); }
  .aigw-driver { display:flex; gap:9px; padding:9px 0; border-top:1px solid color-mix(in srgb,var(--line) 62%,transparent); }
  .aigw-driver:first-child { border-top:none; }
  .aigw-driver-bar { position:relative; flex:0 0 64px; align-self:center; height:6px; border-radius:99px; direction:ltr;
    background:color-mix(in srgb,var(--text-1) 10%,transparent); overflow:hidden; }
  .aigw-driver-bar i { position:absolute; inset-block:0; border-radius:99px; }

  /* ── FLOW MAP ────────────────────────────────────────────────────────── */
  .aigw-flow-node {
    display:flex; align-items:center; gap:11px; padding:12px 13px; border-radius:16px;
    border:1px solid color-mix(in srgb,var(--line) 74%,transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.042), rgba(255,255,255,0.008)), var(--bg-raised);
  }
  .aigw-flow-node.on { border-color:color-mix(in srgb,var(--rgb-1) 30%,var(--line));
    box-shadow:0 14px 30px -26px color-mix(in srgb,var(--rgb-1) 85%,transparent); }
  .aigw-flow-ico { display:grid; place-items:center; width:38px; height:38px; border-radius:50%; flex:0 0 auto; color:#fff;
    background:linear-gradient(140deg,var(--rgb-1),var(--rgb-2)); box-shadow:0 0 18px -6px color-mix(in srgb,var(--rgb-2) 80%,transparent); }
  .aigw-flow-node:not(.on) .aigw-flow-ico { filter:grayscale(.85) brightness(.75); box-shadow:none; }
  .aigw-flow-conn { position:relative; height:30px; width:3px; margin:0 auto; border-radius:99px;
    background:color-mix(in srgb,var(--text-1) 13%,transparent); overflow:hidden; }
  .aigw-flow-conn.on::after {
    content:''; position:absolute; inset-inline:0; height:12px; border-radius:99px;
    background:linear-gradient(180deg,var(--rgb-1),var(--rgb-2));
    animation:aigw-fallconn 1.7s cubic-bezier(.4,0,.6,1) infinite;
  }
  @keyframes aigw-fallconn { 0% { top:-12px; opacity:0; } 30% { opacity:1; } 100% { top:30px; opacity:0; } }
  /* a quiet chevron BELOW the connector — outside the clipped 3px rail */
  .aigw-flow-chevron { display:grid; place-items:center; height:0; color:var(--text-3); }
  .aigw-flow-chevron svg { transform:translateY(-3px); opacity:.8; }

  /* ── FUTURE TREE ─────────────────────────────────────────────────────── */
  .aigw-tree-root {
    display:flex; align-items:center; justify-content:space-between; gap:10px;
    padding:13px 15px; border-radius:17px; margin-bottom:2px;
    border:1px solid color-mix(in srgb,var(--rgb-2) 34%,var(--line));
    background:linear-gradient(140deg,color-mix(in srgb,var(--rgb-1) 13%,transparent),color-mix(in srgb,var(--rgb-2) 15%,transparent));
  }
  .aigw-tree-trunk { display:block; width:min(240px,70%); height:44px; margin:0 auto; }
  .aigw-branch {
    position:relative; padding:12px 13px 13px 15px; margin-bottom:9px; border-radius:16px; overflow:hidden;
    border:1px solid color-mix(in srgb,var(--line) 76%,transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.042), rgba(255,255,255,0.008)), var(--bg-raised);
  }
  .aigw-branch::before { content:''; position:absolute; inset-block:0; inset-inline-start:0; width:3px; border-radius:99px; background:var(--branch-tone,var(--rgb-2)); }
  .aigw-branch-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .aigw-branch-name { display:flex; align-items:center; gap:7px; font-size:11.5px; font-weight:900; color:var(--text-1); }
  .aigw-branch-weight { font-size:16px; font-weight:950; color:var(--branch-tone,var(--rgb-2)); direction:ltr; font-variant-numeric:tabular-nums; }
  .aigw-branch-bar { position:relative; height:6px; border-radius:99px; margin:9px 0 8px; direction:ltr;
    background:color-mix(in srgb,var(--text-1) 10%,transparent); overflow:hidden; }
  .aigw-branch-bar i { position:absolute; inset-block:0; inset-inline-start:0; border-radius:99px; background:var(--branch-tone,var(--rgb-2));
    transition:width .7s cubic-bezier(.3,.7,.2,1); }
  .aigw-driver-tags { display:flex; flex-wrap:wrap; gap:5px; }
  .aigw-tag { font-size:9.5px; font-weight:800; padding:3px 8px; border-radius:8px; color:var(--text-2);
    background:color-mix(in srgb,var(--rgb-5) 10%,transparent); border:1px solid color-mix(in srgb,var(--rgb-5) 22%,transparent); }

  .aigw-adv { margin-top:13px; padding:14px; border-radius:18px;
    border:1px solid color-mix(in srgb,var(--down) 26%,var(--line));
    background:linear-gradient(155deg,color-mix(in srgb,var(--down) 8%,transparent), rgba(255,255,255,0.01)); }
  .aigw-adv-row { display:flex; gap:9px; align-items:flex-start; padding:8px 0; border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent); }
  .aigw-adv-row:first-of-type { border-top:none; }
  .aigw-adv-ico { flex:0 0 auto; margin-top:1px; }
  .aigw-adv-ico.observed { color:var(--down); }
  .aigw-adv-ico.standing { color:var(--text-3); }
  .aigw-adv-title { font-size:11px; font-weight:850; color:var(--text-1); line-height:1.6; }
  .aigw-adv-ev { font-size:10px; color:var(--text-3); line-height:1.7; overflow-wrap:anywhere; }

  /* ── DNA ─────────────────────────────────────────────────────────────── */
  .aigw-dna-helix { display:block; width:100%; height:56px; margin:2px 0 10px; }
  .aigw-dna-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:10px; padding:8px 0;
    border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent); }
  .aigw-dna-row:first-of-type { border-top:none; }
  .aigw-dna-name { font-size:11px; font-weight:850; color:var(--text-1); display:flex; align-items:center; gap:7px; line-height:1.5; }
  .aigw-dna-track { position:relative; height:7px; border-radius:99px; margin-top:6px; direction:ltr;
    background:color-mix(in srgb,var(--text-1) 10%,transparent); overflow:hidden; }
  .aigw-dna-track i { position:absolute; inset-block:0; inset-inline-start:0; border-radius:99px;
    background:linear-gradient(90deg,var(--rgb-1),var(--rgb-2)); transition:width .6s cubic-bezier(.3,.7,.2,1); }
  .aigw-dna-obs { display:flex; flex-wrap:wrap; gap:6px; margin-top:11px; }

  /* ── skeleton / empty ────────────────────────────────────────────────── */
  .aigw-skel { border-radius:14px; background:linear-gradient(90deg, rgba(127,127,127,.09), rgba(127,127,127,.18), rgba(127,127,127,.09));
    background-size:200% 100%; animation:aigw-shimmer 1.4s linear infinite; }
  @keyframes aigw-shimmer { to { background-position:-200% 0; } }

  :root[data-theme='light'] .aigw-gauge, :root[data-theme='light'] .aigw-chain-node,
  :root[data-theme='light'] .aigw-flow-node, :root[data-theme='light'] .aigw-branch,
  :root[data-theme='light'] .aigw-blip-detail, :root[data-theme='light'] .aigw-weather-card,
  :root[data-theme='light'] .aigw-node-chip { background:#ffffff; border-color:rgba(13,16,32,0.09); }
  :root[data-theme='light'] .aigw-country-card { background:#ffffff; border-color:rgba(13,16,32,0.12); }

  @media (max-width:360px) {
    .aigw-gauge { grid-template-columns:auto minmax(0,1fr); }
    .aigw-gauge-side { grid-column:1 / -1; flex-direction:row; align-items:center; justify-content:space-between; }
    .aigw-country-bar { width:84px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .aigw-orbit-a, .aigw-orbit-b, .aigw-sweep, .aigw-globe-halo, .aigw-blip-ping,
    .aigw-chain-arrow.lit::before, .aigw-flow-conn.on::after,
    .aigw-weather-card.tone-sun .aigw-weather-icon svg,
    .aigw-weather-card.tone-storm .aigw-weather-icon svg { animation:none; }
  }
`;

/* ══════════════════════════════════════════════════════════════════════════
   PANEL 1 — FBT WORLD STATE (gauges + financial weather + radar ribbon)
   ══════════════════════════════════════════════════════════════════════════ */
const METRIC_META = {
  liquidity: { fa: 'نقدینگی جهانی', en: 'Global liquidity' },
  risk: { fa: 'ریسک جهانی', en: 'Global risk' },
  inflation: { fa: 'فشار تورم (انرژی)', en: 'Inflation pressure (energy)' },
  dollar: { fa: 'قدرت دلار', en: 'Dollar strength' },
  cryptoFlow: { fa: 'جریان رمزارز', en: 'Crypto flow' },
  institutional: { fa: 'جریان نهادی', en: 'Institutional flow' },
  geopolitics: { fa: 'ریسک ژئوپلیتیک', en: 'Geopolitical risk' },
  rwa: { fa: 'پذیرش RWA', en: 'RWA adoption' },
  volatility: { fa: 'نوسان جهانی', en: 'Global volatility' }
};
const EVIDENCE_META = {
  stablecoinNet: { fa: 'نتیجهٔ استیبل‌کوین', en: 'stablecoin net' },
  smartMoneyNet: { fa: 'نتیجهٔ پول هوشمند', en: 'smart-money net' },
  regime: { fa: 'رژیم', en: 'regime' },
  outlookScore: { fa: 'امتیاز چشم‌انداز', en: 'outlook score' },
  wti: { fa: 'نفت', en: 'WTI' }, brent: { fa: 'برنت', en: 'Brent' },
  dxy: { fa: 'شاخص دلار', en: 'DXY' },
  classAvg: { fa: 'میانگین کلاس', en: 'class avg' },
  topToken: { fa: 'برترین توکن', en: 'top token' },
  netUsd: { fa: 'جریان خالص', en: 'net flow' },
  headlines: { fa: 'سرفصل‌ها', en: 'headlines' },
  instruments: { fa: 'ابزارها', en: 'instruments' },
  avgChange: { fa: 'تغییر میانگین', en: 'avg change' },
  maxClassMove: { fa: 'بیشترین حرکت کلاس', en: 'max class move' }
};
const LEVEL_META = {
  high: { fa: 'بالا', en: 'HIGH', cls: 'bad' }, medium: { fa: 'متوسط', en: 'MEDIUM', cls: 'warn' }, low: { fa: 'پایین', en: 'LOW', cls: 'up' }
};
const WEATHER_META = {
  liquidity: { fa: 'آسمان نقدینگی', en: 'Liquidity sky' },
  volatility: { fa: 'تلاطم', en: 'Volatility' },
  whales: { fa: 'فعالیت نهنگ‌ها', en: 'Whale activity' },
  macro: { fa: 'باد کلان', en: 'Macro wind' },
  chains: { fa: 'افق زنجیره‌ها', en: 'Chain horizon' },
  dollarWind: { fa: 'باد دلار', en: 'Dollar wind' },
  news: { fa: 'دمای خبر', en: 'News temperature' }
};
const WEATHER_ICON = { sun: 'sun', partly: 'partly', cloud: 'cloud', rain: 'rain', storm: 'storm', wind: 'wind', wavesIcon: 'waves', newsIcon: 'news' };
const WEATHER_WORD = {
  sun: { fa: 'صاف', en: 'clear' }, partly: { fa: 'نیمه‌ابری', en: 'partly' }, cloud: { fa: 'ابری', en: 'cloudy' },
  rain: { fa: 'بارانی', en: 'rain' }, storm: { fa: 'طوفانی', en: 'storm' }, windy: { fa: 'تندباد', en: 'windy' }, na: { fa: '—', en: '—' }
};

export function WorldStatePanel({ world, L, isPersian, onGoTab }) {
  const model = useMemo(() => buildWorldState(world), [world]);
  const weather = useMemo(() => buildWeather(world), [world]);
  const radar = useMemo(() => buildRadar(world), [world]);

  const evidenceText = (m) => m.evidence.map((e) => {
    const name = isPersian ? (EVIDENCE_META[e.key]?.fa || e.key) : (EVIDENCE_META[e.key]?.en || e.key);
    const val = typeof e.value === 'number'
      ? (Math.abs(e.value) >= 1000 ? `$${moneyK(e.value)}` : (isPersian ? faNum(round(e.value)) : round(e.value)))
      : String(e.value);
    return `${name}: ${val}`;
  }).join(' · ');

  return (
    <>
      {/* ── financial weather ── */}
      <div className="aigw-weather" role="list" aria-label={L('آب‌وهوای مالی', 'Financial weather')}>
        {weather.map((w) => (
          <div key={w.id} className={`aigw-weather-card tone-${w.tone}`} role="listitem">
            <span className="aigw-weather-icon"><WIcon name={WEATHER_ICON[w.icon] || 'cloud'} size={19} /></span>
            <div className="aigw-weather-name">{isPersian ? WEATHER_META[w.id]?.fa : WEATHER_META[w.id]?.en}</div>
            <div className="aigw-weather-val">{isPersian ? WEATHER_WORD[w.tone]?.fa : WEATHER_WORD[w.tone]?.en}</div>
          </div>
        ))}
      </div>

      {/* ── the nine world-state gauges ── */}
      <div style={{ marginTop: 12 }}>
        {model.metrics.map((m) => {
          const meta = METRIC_META[m.id] || { fa: m.id, en: m.id };
          const lit = Math.max(m.status === 'ok' ? 1 : 0, Math.round(m.meter * 5));
          const bad = m.id === 'risk' || m.id === 'volatility' || m.id === 'geopolitics';
          return (
            <div key={m.id} className="aigw-gauge">
              <span className="aigw-gauge-icon"><WIcon name={m.icon === 'flame' ? 'flame' : m.icon} size={17} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="aigw-gauge-name">{isPersian ? meta.fa : meta.en}</div>
                <div className="aigw-gauge-ev">
                  {m.status === 'ok' ? (evidenceText(m) || L('از خوانش همین دور', 'from this pass')) : L('در این دور خوانده نشد', 'not read in this pass')}
                  {m.proxy && m.status === 'ok' ? ` · ${L('پروکسی', 'proxy')}` : ''}
                </div>
              </div>
              <div className="aigw-gauge-side">
                {m.kind === 'dir' ? (
                  <span className={`aigw-pill ${m.status !== 'ok' ? 'ghost' : m.dir === 'up' ? 'up' : m.dir === 'down' ? 'down' : 'flat'}`}>
                    {m.status === 'ok' ? <DirMark dir={m.dir} size={9} /> : null}
                    {m.status !== 'ok' ? L('—', '—') : m.valuePct !== null && m.valuePct !== undefined ? pct(m.valuePct, isPersian) : (m.dir === 'up' ? (isPersian ? 'صعودی' : 'rising') : m.dir === 'down' ? (isPersian ? 'نزولی' : 'falling') : (isPersian ? 'خنثی' : 'flat'))}
                  </span>
                ) : (
                  <span className={`aigw-pill ${m.status !== 'ok' ? 'ghost' : LEVEL_META[m.level]?.cls || 'flat'}`}>
                    {m.status !== 'ok' ? L('—', '—') : isPersian ? LEVEL_META[m.level]?.fa : LEVEL_META[m.level]?.en}
                  </span>
                )}
                <span className="aigw-gauge-meter" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <i key={i} className={`${i < lit ? 'on' : ''} ${bad ? 'bad' : ''}`} />
                  ))}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── the radar ribbon, jumping to the radar tab ── */}
      <button type="button" className="aigw-ribbon" onClick={() => onGoTab && onGoTab('radar')}>
        <WIcon name="radar" size={17} style={{ color: 'var(--rgb-2)' }} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 900, color: 'var(--text-1)' }}>{L('رادار جهانی FBT', 'FBT Global Radar')}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
            {L('سیگنال‌های زندهٔ همین دور — برای نقشهٔ کامل لمس کن', 'this pass\u2019s live signals — tap for the full map')}
          </span>
        </span>
        <span className="aigw-ribbon-dots">
          {['critical', 'emerging', 'developing', 'stable', 'opportunity'].map((t) => (
            radar.counts[t] ? <b key={t}><span className={`aigw-dot t-${t}`} />{isPersian ? faNum(radar.counts[t]) : radar.counts[t]}</b> : null
          ))}
        </span>
      </button>

      <div className="aigw-note">
        {L(
          'هر جهت و سطح از یک خوانش واقعی همین دور گرفته شده و شواهدش کنارش نوشته شده است؛ ردیف «—» یعنی داده‌ای خوانده نشد، نه اینکه عددی پنهان باشد.',
          'Every direction and level is taken from a real reading of this pass with its evidence beside it; a «—» row means nothing was read, not that a number is hidden.'
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PANEL 2 — THE INTERACTIVE GLOBE
   ══════════════════════════════════════════════════════════════════════════ */
const GLOBE_ARCS = [['us', 'eu'], ['eu', 'gulf'], ['gulf', 'cn'], ['cn', 'jp'], ['us', 'br'], ['ir', 'cn'], ['ru', 'cn']];
const MOOD_PILL = {
  up: { fa: 'برآیند صعودی', en: 'net positive', cls: 'up' },
  down: { fa: 'برآیند نزولی', en: 'net negative', cls: 'down' },
  flat: { fa: 'خنثی', en: 'neutral', cls: 'flat' }
};

export function GlobePanel({ world, L, isPersian }) {
  const [sel, setSel] = useState('us');
  const snaps = useMemo(() => {
    const map = new Map();
    for (const c of COUNTRIES) map.set(c.id, buildCountrySnapshot(c, world, { isPersian }));
    return map;
  }, [world, isPersian]);
  const snap = snaps.get(sel) || snaps.get('us');
  const byId = useMemo(() => new Map(COUNTRIES.map((c) => [c.id, c])), []);

  const arcPath = (a, b) => {
    const p = byId.get(a); const q = byId.get(b);
    if (!p || !q) return '';
    const mx = (p.x + q.x) / 2 + (160 - (p.x + q.x) / 2) * 0.3;
    const my = (p.y + q.y) / 2 + (160 - (p.y + q.y) / 2) * 0.3;
    return `M ${p.x} ${p.y} Q ${mx} ${my} ${q.x} ${q.y}`;
  };

  return (
    <>
      <div className="aigw-globe-wrap">
        <svg className="aigw-globe" viewBox="0 0 320 320" dir="ltr" role="img" aria-label={L('کرهٔ اقتصاد جهانی', 'Global economy globe')}>
          <defs>
            <radialGradient id="aigw-sphere" cx="32%" cy="28%" r="85%">
              <stop offset="0%" stopColor="var(--rgb-1)" stopOpacity="0.32" />
              <stop offset="52%" stopColor="var(--rgb-2)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
            </radialGradient>
            <radialGradient id="aigw-glow" cx="50%" cy="50%" r="50%">
              <stop offset="62%" stopColor="var(--rgb-2)" stopOpacity="0" />
              <stop offset="100%" stopColor="var(--rgb-2)" stopOpacity="0.28" />
            </radialGradient>
            <clipPath id="aigw-clip"><circle cx="160" cy="160" r="140" /></clipPath>
          </defs>

          <circle cx="160" cy="160" r="152" fill="url(#aigw-glow)" />
          <circle cx="160" cy="160" r="140" fill="url(#aigw-sphere)" stroke="color-mix(in srgb,var(--rgb-1) 45%,var(--line-strong))" strokeWidth="1.2" />

          {/* graticule */}
          <g className="aigw-globe-graticule" clipPath="url(#aigw-clip)" fill="none" stroke="color-mix(in srgb,var(--text-1) 34%,transparent)" strokeWidth="0.7">
            {[-90, -45, 0, 45, 90].map((dy) => {
              const half = Math.sqrt(Math.max(0, 140 * 140 - dy * dy));
              return <ellipse key={dy} cx="160" cy={160 + dy} rx={half} ry={Math.max(4, half * 0.14)} />;
            })}
            {[0.28, 0.55, 0.8, 1].map((k, i) => (
              <ellipse key={`m${i}`} cx="160" cy="160" rx={140 * k} ry="140" />
            ))}
            <line x1="20" y1="160" x2="300" y2="160" />
          </g>

          {/* orbits */}
          <g className="aigw-orbit-a" fill="none">
            <circle cx="160" cy="160" r="151" stroke="color-mix(in srgb,var(--rgb-2) 55%,transparent)" strokeWidth="0.8" strokeDasharray="3 14" />
          </g>
          <g className="aigw-orbit-b" fill="none">
            <circle cx="160" cy="160" r="157" stroke="color-mix(in srgb,var(--rgb-1) 45%,transparent)" strokeWidth="0.7" strokeDasharray="2 18" />
          </g>

          {/* trade-style arcs between hubs */}
          <g fill="none" stroke="color-mix(in srgb,var(--rgb-2) 42%,transparent)" strokeWidth="1">
            {GLOBE_ARCS.map(([a, b]) => <path key={`${a}${b}`} className="aigw-globe-arc" d={arcPath(a, b)} />)}
          </g>

          {/* country dots */}
          {COUNTRIES.map((c) => {
            const s = snaps.get(c.id);
            const active = sel === c.id;
            const fill = s.status === 'unread'
              ? 'color-mix(in srgb,var(--text-1) 42%,transparent)'
              : s.mood === 'up' ? 'var(--up)' : s.mood === 'down' ? 'var(--down)' : 'var(--rgb-2)';
            return (
              <g key={c.id} className="aigw-globe-dot" onClick={() => setSel(c.id)} role="button" tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSel(c.id)}
                aria-label={isPersian ? c.fa : c.en}>
                {active ? <circle className="aigw-globe-halo" cx={c.x} cy={c.y} r="12" fill="none" stroke={fill} strokeWidth="1.6" /> : null}
                <circle cx={c.x} cy={c.y} r={active ? 11 : 9} fill={fill} opacity={active ? 0.22 : 0.12} />
                <circle className="aigw-dot-core" cx={c.x} cy={c.y} r={active ? 6.5 : 5} fill={fill} stroke="rgba(0,0,0,.35)" strokeWidth="0.6" />
              </g>
            );
          })}
        </svg>

        {/* selected country label as HTML (proper RTL shaping) */}
        {snap ? (
          <span className="aigw-country-label" style={{ left: `${(snap.country.x / 320) * 100}%`, top: `${(snap.country.y / 320) * 100}%` }}>
            {isPersian ? snap.country.fa : snap.country.en}
          </span>
        ) : null}
      </div>

      {/* quick-select rail — the dot carries the country's read mood */}
      <div className="aigw-chips" style={{ marginTop: 10 }}>
        {COUNTRIES.map((c) => {
          const s = snaps.get(c.id);
          const dotColor = s?.status === 'unread' ? 'var(--line-strong)'
            : s.mood === 'up' ? 'var(--up)' : s.mood === 'down' ? 'var(--down)' : 'var(--rgb-2)';
          return (
            <button key={c.id} type="button" className={`aigw-chip ${sel === c.id ? 'active' : ''}`} onClick={() => setSel(c.id)}>
              <span className="aigw-dot" style={{ background: dotColor }} />
              {isPersian ? c.fa : c.en}
            </button>
          );
        })}
      </div>

      {/* the snapshot card */}
      {snap ? (
        <div className="aigw-country-card" key={snap.country.id}>
          <div className="aigw-country-head">
            <span className="aigw-country-name"><WIcon name="globe" size={15} style={{ color: 'var(--rgb-1)', verticalAlign: '-2px' }} /> {isPersian ? snap.country.fa : snap.country.en}</span>
            {snap.status === 'unread'
              ? <span className="aigw-pill ghost">{L('خوانده نشد', 'unread')}</span>
              : <span className={`aigw-pill ${MOOD_PILL[snap.mood].cls}`}>
                  {snap.net !== null ? <DirMark dir={snap.mood} size={9} /> : null}
                  {isPersian ? MOOD_PILL[snap.mood].fa : MOOD_PILL[snap.mood].en}
                  {snap.net !== null ? ` ${pct(snap.net, isPersian)}` : ''}
                </span>}
          </div>

          {snap.rows.length ? snap.rows.map((r, i) => (
            <div key={`${r.sym}-${i}`} className="aigw-country-row">
              <div style={{ minWidth: 0 }}>
                <div className="aigw-country-sym"><span className="aigw-ltr">{r.sym}</span> {r.name ? <span style={{ color: 'var(--text-2)', fontWeight: 650, fontSize: 10 }}> {r.name}</span> : null}</div>
                <div className="aigw-country-sub">{r.source ? `${L('منبع', 'source')}: ${r.source}` : ''}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                {r.change !== null ? (
                  <span className="aigw-country-bar" aria-hidden="true">
                    <i className={r.dir === 'down' ? 'down' : 'up'} style={{ width: `${Math.min(48, Math.abs(r.change) * 16)}%` }} />
                  </span>
                ) : null}
                <span className="aigw-country-val aigw-ltr">
                  {r.change !== null ? pct(r.change, isPersian) : (r.value || '—')}
                </span>
              </div>
            </div>
          )) : (
            <div className="aig-empty">{L('در این دور خوانشی برای این کشور ثبت نشد.', 'No reading was recorded for this country in this pass.')}</div>
          )}

          {snap.country.proxyNote ? (
            <div className="aigw-note" style={{ marginTop: 8 }}>
              {L('این خوانش‌ها پروکسی‌های اقتصادی‌اند (مثلاً مس برای رشد، نفت برای درآمد انرژی) — نه دادهٔ مستقیم اقتصاد این کشور.', 'These readings are economic proxies (e.g. copper for growth, oil for energy revenue) — not direct data for this economy.')}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="aigw-note">
        {L(
          'هر کشور فقط به سازوکارهایی وصل است که این اپ واقعاً می‌خواند (شاخص دلار، بازده‌ها، کالاها، برابری ارزها، نرخ مرجع ریال)؛ هرچه خوانده نشد «خوانده نشد» می‌ماند.',
          'Each country links only to instruments this app actually reads (dollar index, yields, commodities, FX parities, the rial reference); whatever was not read stays explicitly unread.'
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PANEL 3 — FBT GLOBAL RADAR
   ══════════════════════════════════════════════════════════════════════════ */
const TONE_META = {
  critical: { fa: 'بحرانی', en: 'Critical', color: '#ef4444' },
  emerging: { fa: 'نوظهور', en: 'Emerging', color: '#f97316' },
  developing: { fa: 'در حال شکل‌گیری', en: 'Developing', color: '#eab308' },
  stable: { fa: 'پایدار', en: 'Stable', color: '#22c55e' },
  opportunity: { fa: 'فرصت', en: 'Opportunity', color: '#38bdf8' }
};

export function RadarPanel({ world, L, isPersian }) {
  const radar = useMemo(() => buildRadar(world), [world]);
  const [sel, setSel] = useState(0);
  const blip = radar.blips[sel] || null;
  const C = 150; const R = 138;

  return (
    <>
      <div className="aigw-radar-wrap">
        <svg className="aigw-radar" viewBox="0 0 300 300" dir="ltr" role="img" aria-label={L('رادار جهانی', 'Global radar')}>
          <defs>
            <linearGradient id="aigw-sweepg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--rgb-1)" stopOpacity="0" />
              <stop offset="100%" stopColor="var(--rgb-1)" stopOpacity="0.30" />
            </linearGradient>
          </defs>
          {[0.2, 0.4, 0.6, 0.8, 1].map((k) => (
            <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="color-mix(in srgb,var(--text-1) 16%,transparent)" strokeWidth="0.8" />
          ))}
          <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="color-mix(in srgb,var(--text-1) 13%,transparent)" strokeWidth="0.8" />
          <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="color-mix(in srgb,var(--text-1) 13%,transparent)" strokeWidth="0.8" />

          <g className="aigw-sweep">
            <path d={`M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 0 1 ${C + R * Math.sin(Math.PI / 5)} ${C - R * Math.cos(Math.PI / 5)} Z`} fill="url(#aigw-sweepg)" />
            <line x1={C} y1={C} x2={C} y2={C - R} stroke="var(--rgb-1)" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
          </g>

          {radar.blips.map((b, i) => {
            const rr = b.r * R;
            const x = C + rr * Math.cos(b.angle);
            const y = C + rr * Math.sin(b.angle);
            const tone = TONE_META[b.tone]?.color || '#94a3b8';
            return (
              <g key={b.id} className="aigw-blip" onClick={() => setSel(i)} role="button" tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSel(i)}>
                {b.tone === 'critical' ? <circle className="aigw-blip-ping" cx={x} cy={y} r="9" fill="none" stroke={tone} strokeWidth="1.4" /> : null}
                <circle cx={x} cy={y} r={sel === i ? 10 : 8} fill={tone} opacity={sel === i ? 0.28 : 0.15} />
                <circle className="b-core" cx={x} cy={y} r={sel === i ? 5.5 : 4.2} fill={tone} stroke="rgba(0,0,0,.4)" strokeWidth="0.5" />
              </g>
            );
          })}
          <circle cx={C} cy={C} r="3.2" fill="var(--rgb-2)" />
        </svg>
      </div>

      {/* legend */}
      <div className="aigw-chips" style={{ justifyContent: 'center', marginTop: 6 }}>
        {Object.entries(TONE_META).map(([t, m]) => (
          radar.counts[t] ? (
            <span key={t} className="aigw-chip" style={{ cursor: 'default' }}>
              <span className={`aigw-dot t-${t}`} />
              {isPersian ? m.fa : m.en} · {isPersian ? faNum(radar.counts[t]) : radar.counts[t]}
            </span>
          ) : null
        ))}
      </div>

      {blip ? (
        <div className="aigw-blip-detail" key={blip.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span className={`aigw-dot t-${blip.tone}`} />
            <span style={{ fontSize: 10.5, fontWeight: 900, color: TONE_META[blip.tone]?.color }}>{isPersian ? TONE_META[blip.tone]?.fa : TONE_META[blip.tone]?.en}</span>
            <span className="aigw-pill ghost" style={{ marginLeft: 'auto' }}>{blip.kind}</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 850, color: 'var(--text-1)', lineHeight: 1.8, overflowWrap: 'anywhere' }}>
            {isPersian && blip.titleFa ? blip.titleFa : blip.title}
          </div>
          {blip.meta ? <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{L('منبع', 'source')}: {blip.meta}</div> : null}
        </div>
      ) : (
        <div className="aig-empty">{L('هنوز سیگنالی در این دور ثبت نشده است.', 'No signal was recorded in this pass yet.')}</div>
      )}

      <div className="aigw-note">
        {L(
          'جای هر نقطه معنادار است: حلقهٔ نزدیک‌تر به مرکز یعنی شدت بالاتر؛ رنگ یعنی دسته. همهٔ نقاط از اقلام واقعی همین دور ساخته شده‌اند.',
          'Each blip\u2019s position is meaningful: a ring closer to the centre means higher severity; colour is the category. Every blip comes from this pass\u2019s real items.'
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PANEL 4 — CAUSAL INTELLIGENCE
   The server's OWN macro-graph engine, fetched lazily ONCE the first time
   this tab is opened (module-level cache), with the local fallback chain.
   ══════════════════════════════════════════════════════════════════════════ */
const causalCache = { state: 'idle', body: null };
const CAUSAL_NODE_FA = {
  'topic:FED': 'فدرال‌رزرو', 'topic:INFLATION': 'تورم', 'topic:GEOPOLITICS': 'ژئوپلیتیک',
  'topic:GROWTH': 'رشد', 'topic:RATES': 'نرخ بهره', 'topic:ECB': 'اروپا', 'topic:POLITICS': 'سیاست',
  'topic:CRYPTO_POLICY': 'قانون رمزارز', 'topic:CRYPTO POLICY': 'قانون رمزارز', 'topic:POLITICS ': 'سیاست',
  dxy: 'دلار (DXY)', yields2y: 'بازده ۲ ساله', yields10y: 'بازده ۱۰ ساله', curve2s10s: 'اختلاف ۲/۱۰',
  spx: 'اس‌اندپی ۵۰۰', gold: 'طلا', wti: 'نفت (WTI)', btc: 'بیت‌کوین', eth: 'اتریوم', sol: 'سولانا',
  rwa: 'دارایی واقعی', portfolio: 'پرتفوی شما'
};
const causalLabel = (node, isPersian) => {
  if (!isPersian) return node.label || node.id;
  return CAUSAL_NODE_FA[node.id] || (node.id.startsWith('topic:') ? node.id.slice(6) : node.label || node.id);
};

export function CausalPanel({ world, L, isPersian }) {
  const [phase, setPhase] = useState(causalCache.state === 'idle' ? 'idle' : causalCache.state);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (causalCache.state !== 'idle') { setPhase(causalCache.state); return undefined; }
    causalCache.state = 'loading'; setPhase('loading');
    let cancelled = false;
    fetch(`${apiBase()}/deep/macro-graph?asset=BTC`, { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok && body?.graph?.nodes?.length) { causalCache.state = 'done'; causalCache.body = body; }
        else { causalCache.state = 'error'; }
        setPhase(causalCache.state);
      })
      .catch(() => { if (!cancelled) { causalCache.state = 'error'; setPhase('error'); } });
    return () => { cancelled = true; mounted.current = false; };
  }, []);

  const local = useMemo(() => buildCausalLocal(world), [world]);
  const graph = phase === 'done' ? causalCache.body : null;
  const nodes = graph?.graph?.nodes || [];
  const cols = {
    event: nodes.filter((n) => n.kind === 'event'),
    instrument: nodes.filter((n) => n.kind === 'instrument'),
    asset: nodes.filter((n) => n.kind === 'asset' || n.kind === 'class'),
    portfolio: nodes.filter((n) => n.kind === 'portfolio')
  };
  const why = graph?.whyRiskier;
  const impulse = graph?.portfolioRiskImpulse ?? graph?.graph?.portfolioRiskImpulse;

  return (
    <>
      {phase === 'loading' && (
        <div className="aig-section" style={{ padding: 18 }}>
          <div className="aigw-skel" style={{ height: 16, width: '55%', marginBottom: 12 }} />
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="aigw-skel" style={{ height: 46, marginBottom: 8 }} />)}
          <div className="aigw-note">{L('در حال خواندن گراف علّی مغز جهانی…', 'Reading the global brain\u2019s causal graph…')}</div>
        </div>
      )}

      {phase === 'done' && graph && (
        <>
          <div className="aig-section-title" style={{ marginBottom: 6 }}>
            <WIcon name="chain" size={17} style={{ color: 'var(--rgb-2)' }} />
            {L('گراف علّی مغز جهانی', 'The global brain\u2019s causal graph')}
            {typeof impulse === 'number' ? (
              <span className={`aigw-pill ${impulse > 0.05 ? 'bad' : impulse < -0.05 ? 'up' : 'flat'}`} style={{ marginInlineStart: 'auto' }}>
                {L('تکانهٔ ریسک پرتفوی', 'portfolio risk impulse')} <span className="aigw-ltr">{impulse > 0 ? '+' : ''}{impulse}</span>
              </span>
            ) : null}
          </div>

          <div className="aigw-causal-cols">
            {[
              ['event', L('رویدادها', 'Events')],
              ['instrument', L('سازوکارها', 'Instruments')],
              ['asset', L('دارایی‌ها', 'Assets')],
              ['portfolio', L('پرتفوی', 'Portfolio')]
            ].map(([k, title]) => (
              <div key={k} className="aigw-causal-col">
                <h4>{title}</h4>
                {cols[k].length ? cols[k].map((n) => (
                  <div key={n.id} className={`aigw-node-chip ${n.riskDirection === 'risk_up' ? 'risk-up' : n.riskDirection === 'risk_down' ? 'risk-down' : ''}`}>
                    <DirMark dir={n.change24hPct === null ? 'flat' : n.change24hPct > 0 ? 'up' : n.change24hPct < 0 ? 'down' : 'flat'} size={9} />
                    <span style={{ minWidth: 0 }}>{causalLabel(n, isPersian)}
                      {n.change24hPct !== null ? <span className="aigw-ltr" style={{ color: n.change24hPct >= 0 ? 'var(--up)' : 'var(--down)' }}> {n.change24hPct > 0 ? '+' : ''}{n.change24hPct}%</span> : null}
                      {n.attention ? <span style={{ color: 'var(--rgb-5)' }}> ×{isPersian ? faNum(n.attention) : n.attention}</span> : null}
                    </span>
                  </div>
                )) : <div className="aigw-note" style={{ marginTop: 0 }}>{L('—', '—')}</div>}
              </div>
            ))}
          </div>

          {why?.available && Array.isArray(why.drivers) && why.drivers.length ? (
            <div style={{ marginTop: 6 }}>
              <div className="aig-section-title" style={{ marginBottom: 2 }}>
                <WIcon name="warning" size={16} style={{ color: 'var(--rgb-5)' }} />
                {L('چرا BTC امروز ریسک دارد؟ — راننده‌های علّی', 'Why is BTC riskier today? — causal drivers')}
              </div>
              {why.drivers.map((d, i) => {
                const maxAbs = Math.max(0.0001, ...why.drivers.map((x) => Math.abs(x.contribution || 0)));
                const wPct = Math.min(100, (Math.abs(d.contribution || 0) / maxAbs) * 100);
                const up = (d.contribution || 0) >= 0;
                return (
                  <div key={`${d.from}-${i}`} className="aigw-driver">
                    <span className="aigw-driver-bar" aria-hidden="true">
                      <i style={{ insetInlineStart: up ? 0 : undefined, insetInlineEnd: up ? undefined : 0, width: `${wPct}%`, background: up ? 'var(--up)' : 'var(--down)' }} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 850, color: 'var(--text-1)', lineHeight: 1.6 }}>
                        {isPersian ? (CAUSAL_NODE_FA[d.from] || d.fromLabel || d.from) : (d.fromLabel || d.from)}
                        {d.fromChange24hPct !== null && d.fromChange24hPct !== undefined
                          ? <span className="aigw-ltr" style={{ color: d.fromChange24hPct >= 0 ? 'var(--up)' : 'var(--down)' }}> {d.fromChange24hPct > 0 ? '+' : ''}{d.fromChange24hPct}%</span>
                          : d.attention ? <span style={{ color: 'var(--rgb-5)' }}> ×{isPersian ? faNum(d.attention) : d.attention}</span> : null}
                        <span style={{ color: 'var(--text-3)', fontWeight: 700 }}> → {why.assetLabel || 'BTC'}</span>
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--text-3)', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                        <span className="aigw-ltr">w={d.sensitivity}</span> · {d.why}
                      </div>
                    </div>
                    <b className="aigw-ltr" style={{ fontSize: 11, color: up ? 'var(--up)' : 'var(--down)' }}>
                      {up ? '+' : ''}{d.contribution}
                    </b>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="aigw-note">
            {L(
              'حرکت گره‌ها واقعی و از همین دور است؛ وزن یال‌ها حساسیت‌های مرتبهٔ اولِ مدل‌اند، نه بتای اندازه‌گیری‌شده. یال فقط وقتی فعال است که هر دو سرش خوانده شده باشد.',
              'Node moves are real readings of this pass; edge weights are first-order model sensitivities, not measured betas. An edge activates only when both endpoints were read.'
            )}
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <div className="aig-section-title" style={{ marginBottom: 4 }}>
            <WIcon name="chain" size={17} style={{ color: 'var(--rgb-2)' }} />
            {L('زنجیرهٔ انتقال کلان', 'The macro transmission chain')}
            <span className="aigw-pill ghost" style={{ marginInlineStart: 'auto' }}>{L('ساخته‌شده از همین دور', 'built from this pass')}</span>
          </div>
          <div className="aigw-chain">
            {local.nodes.map((n, i) => (
              <div key={n.id}>
                {i > 0 ? (
                  <div className={`aigw-chain-arrow ${local.edges[i - 1]?.lit ? 'lit' : ''}`} aria-hidden="true">
                    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M7 1v11" /><path d="m2.5 8.5 4.5 5 4.5-5" />
                    </svg>
                  </div>
                ) : null}
                <div className={`aigw-chain-node state-${n.state}`}>
                  <span className="aigw-chain-ico"><WIcon name={n.id === 'oil' ? 'flame' : n.id === 'inflation' ? 'pulse' : n.id === 'yields' ? 'chart' : n.id === 'usd' ? 'bank' : n.id === 'em' ? 'globe' : 'coin'} size={16} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 850, color: 'var(--text-1)' }}>{isPersian ? n.fa : n.en}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>
                      {n.state === 'read' ? (n.source ? `${L('منبع', 'source')}: ${n.source}` : L('خوانده شد', 'read'))
                        : n.state === 'proxy' ? L('پروکسی — از حرکت انرژی', 'proxy — from the energy move')
                        : L('خوانده نشد', 'unread')}
                    </div>
                  </div>
                  {n.value ? (
                    <span className={`aigw-pill ${n.dir === 'up' ? 'up' : n.dir === 'down' ? 'down' : 'flat'}`}>
                      <DirMark dir={n.dir} size={9} /><span className="aigw-ltr">{n.value}</span>
                    </span>
                  ) : <span className="aigw-pill ghost">—</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="aigw-note">
            {L(
              'گراف علّی سرور در این دور در دسترس نبود؛ این زنجیرهٔ استاندارد انتقال است که فقط با خوانش‌های واقعی همین دور روشن شده — هر گرهٔ خاکستری یعنی داده‌ای نبود، نه اینکه اثری نبود.',
              'The server\u2019s causal graph was unreachable this pass; this is the standard transmission chain lit only by this pass\u2019s real reads — a grey node means no data, not no effect.'
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PANEL 5 — GLOBAL CAPITAL FLOW MAP
   ══════════════════════════════════════════════════════════════════════════ */
const FLOW_ICON = { usd: 'bank', treasuries: 'layers', gold: 'coin', btc: 'pulse', defi: 'waves', rwa: 'building' };

export function FlowMapPanel({ world, L, isPersian }) {
  const model = useMemo(() => buildFlowMap(world), [world]);
  return (
    <>
      {model.nodes.map((n, i) => (
        <div key={n.id}>
          {i > 0 ? (
            <>
              <div className={`aigw-flow-conn ${model.edges[i - 1]?.active ? 'on' : ''}`} aria-hidden="true" />
              <span className="aigw-flow-chevron" aria-hidden="true">
                <svg width="12" height="7" viewBox="0 0 12 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m1 1 5 5 5-5" /></svg>
              </span>
            </>
          ) : null}
          <div className={`aigw-flow-node ${n.status === 'ok' ? 'on' : ''}`}>
            <span className="aigw-flow-ico"><WIcon name={FLOW_ICON[n.id] || 'coin'} size={18} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-1)' }}>{isPersian ? n.fa : n.en}</div>
              <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>
                {n.status === 'ok' ? (n.source ? `${L('منبع', 'source')}: ${n.source}` : L('خوانده شد', 'read')) : L('در این دور خوانده نشد', 'not read in this pass')}
              </div>
            </div>
            {n.status === 'ok' ? (
              <span className={`aigw-pill ${n.dir === 'up' ? 'up' : n.dir === 'down' ? 'down' : 'flat'}`}>
                <DirMark dir={n.dir} size={9} /><span className="aigw-ltr">{n.value}</span>
              </span>
            ) : <span className="aigw-pill ghost">—</span>}
          </div>
        </div>
      ))}
      <div className="aigw-note">
        {L(
          'نقشهٔ «پول کجا می‌رود»: هر گره با عدد واقعی همین دور روشن می‌شود و خط میان دو گره فقط وقتی جان می‌گیرد که هر دو طرف خوانده شده باشند. جهت پیکان، مسیر مرجع جریان سرمایه است، نه جابه‌جایی لحظه‌ای.',
          'The «where money goes» map: each node lights up with this pass\u2019s real number, and a connector animates only when both ends were read. The arrow path is the reference capital route, not a live transfer.'
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PANEL 6 — FUTURE TREE + ADVERSARIAL CHALLENGER
   ══════════════════════════════════════════════════════════════════════════ */
const FUTURE_META = {
  btc: { fa: 'رمزارز (کلاس)', en: 'Crypto (class)' }, gold: { fa: 'طلا', en: 'Gold' },
  dollar: { fa: 'دلار', en: 'Dollar' }, equity: { fa: 'سهام', en: 'Equity' }
};
const CASE_META = {
  bull: { fa: 'سناریوی صعودی', en: 'Bull case', color: 'var(--up)' },
  base: { fa: 'سناریوی خنثی', en: 'Base case', color: 'var(--rgb-5)' },
  stress: { fa: 'سناریوی فشار', en: 'Stress case', color: 'var(--down)' }
};
const FUTURE_DRIVER_FA = {
  stablecoinInflow: 'ورود استیبل‌کوین', smartMoneyAccumulation: 'انباشت پول هوشمند',
  riskOnRegime: 'رژیم ریسک‌پذیر', rangeMarket: 'بازار رِنج',
  crossClassDivergence: 'واگرایی کلاس‌ها', invertedCurve: 'منحنی بازده وارون',
  recessionWatch: 'هشدار رکود', dollarStrength: 'دلار قوی', stablecoinOutflow: 'خروج استیبل‌کوین'
};
const ADV_ARG_FA = {
  macroRisk: 'ریسک کلان', liquidityRisk: 'ریسک نقدینگی', dollarHeadwind: 'باد مخالف دلار',
  whaleExitRisk: 'ریسک خروج نهنگ', divergenceRisk: 'ریسک واگرایی', dataGapRisk: 'شکاف داده', modelRisk: 'ریسک مدل'
};
const ADV_ARG_EN = {
  macroRisk: 'Macro risk', liquidityRisk: 'Liquidity risk', dollarHeadwind: 'Dollar headwind',
  whaleExitRisk: 'Whale exit risk', divergenceRisk: 'Divergence risk', dataGapRisk: 'Data gap risk', modelRisk: 'Model risk'
};

export function FutureTreePanel({ world, L, isPersian }) {
  const [asset, setAsset] = useState('btc');
  const tree = useMemo(() => buildFutureTree(world, asset), [world, asset]);
  const challenge = useMemo(() => buildChallenger(world), [world]);
  const anchorUp = tree.anchor.change === null ? null : tree.anchor.change >= 0;

  return (
    <>
      <div className="aigw-chips">
        {FUTURE_ASSETS.map((a) => (
          <button key={a} type="button" className={`aigw-chip ${asset === a ? 'active' : ''}`} onClick={() => setAsset(a)}>
            {isPersian ? FUTURE_META[a].fa : FUTURE_META[a].en}
          </button>
        ))}
      </div>

      <div className="aigw-tree-root" style={{ marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 950, color: 'var(--text-1)' }}>
            {isPersian ? FUTURE_META[asset].fa : FUTURE_META[asset].en}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 3 }}>
            {L('درخت آینده — سناریوهای مشتق‌شده از خوانش‌های همین دور', 'Future tree — scenarios derived from this pass\u2019s reads')}
          </div>
        </div>
        <span className={`aigw-pill ${anchorUp === null ? 'ghost' : anchorUp ? 'up' : 'down'}`}>
          {tree.anchor.change !== null ? <><DirMark dir={anchorUp ? 'up' : 'down'} size={9} /><span className="aigw-ltr">{pct(tree.anchor.change, isPersian)}</span></> : L('خوانده نشد', 'unread')}
        </span>
      </div>

      <svg className="aigw-tree-trunk" viewBox="0 0 240 44" fill="none" dir="ltr" aria-hidden="true">
        <path d="M120 0 C120 18 40 20 34 44" stroke="var(--up)" strokeWidth="2" strokeLinecap="round" opacity=".85" />
        <path d="M120 0 C120 16 120 24 120 44" stroke="var(--rgb-5)" strokeWidth="2" strokeLinecap="round" opacity=".85" />
        <path d="M120 0 C120 18 200 20 206 44" stroke="var(--down)" strokeWidth="2" strokeLinecap="round" opacity=".85" />
      </svg>

      {['bull', 'base', 'stress'].map((k) => (
        <div key={k} className="aigw-branch" style={{ '--branch-tone': CASE_META[k].color }}>
          <div className="aigw-branch-head">
            <span className="aigw-branch-name"><span className="aigw-dot" style={{ background: CASE_META[k].color }} /> {isPersian ? CASE_META[k].fa : CASE_META[k].en}</span>
            <span className="aigw-branch-weight">{isPersian ? `${faNum(tree.weights[k])}\u066a` : `${tree.weights[k]}%`}</span>
          </div>
          <div className="aigw-branch-bar" aria-hidden="true"><i style={{ width: `${tree.weights[k]}%` }} /></div>
          <div className="aigw-driver-tags">
            {tree.drivers[k].length
              ? tree.drivers[k].map((d) => (
                <span key={d} className="aigw-tag">
                  {d.startsWith('topInflow:') ? `${L('ورود سرمایه', 'inflow')}: ${d.slice(10)}` : (isPersian ? FUTURE_DRIVER_FA[d] || d : d)}
                </span>
              ))
              : <span className="aigw-tag" style={{ opacity: .7 }}>{L('بدون رانندهٔ خوانده‌شده', 'no read driver')}</span>}
          </div>
        </div>
      ))}

      <div className="aigw-driver-tags" style={{ marginTop: 2 }}>
        {tree.nudges.map((n, i) => (
          <span key={i} className="aigw-tag" style={{ background: 'transparent' }}>
            {n.key} <span className="aigw-ltr">{n.value}</span> {n.amount > 0 ? '+' : ''}{n.amount}
          </span>
        ))}
      </div>

      {/* ── the adversarial challenger ── */}
      <div className="aigw-adv">
        <div className="aig-section-title" style={{ marginBottom: 6, color: 'var(--down)' }}>
          <WIcon name="shield" size={17} />
          {L('هوش مدعی: چرا این فرصت ممکن است اشتباه باشد؟', 'Adversarial AI: why this thesis could be wrong')}
        </div>
        {challenge.opportunity ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className="aigw-pill info">{L('فرصت این دور', 'this pass\u2019s opportunity')}</span>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: 'var(--text-1)' }}>{challenge.opportunity.label}</span>
              <span className="aigw-ltr" style={{ fontSize: 11, fontWeight: 850, color: 'var(--up)', marginInlineStart: 'auto' }}>{challenge.opportunity.value}</span>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginBottom: 6 }}>{challenge.opportunity.detail}</div>
            {challenge.arguments.map((a) => (
              <div key={a.id} className="aigw-adv-row">
                <span className={`aigw-adv-ico ${a.observed ? 'observed' : 'standing'}`}>
                  <WIcon name={a.observed ? 'warning' : 'cloud'} size={14} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="aigw-adv-title">
                    {isPersian ? ADV_ARG_FA[a.key] : ADV_ARG_EN[a.key]}
                    {a.observed
                      ? <span className="aigw-pill bad" style={{ marginInlineStart: 6 }}>{L('مشاهده شد', 'observed')}</span>
                      : <span className="aigw-pill ghost" style={{ marginInlineStart: 6 }}>{L('ریسک دائمی', 'standing')}</span>}
                  </div>
                  {a.observed && a.evidence ? <div className="aigw-adv-ev">{a.evidence}</div> : null}
                </div>
              </div>
            ))}
            <div className="aigw-note" style={{ marginTop: 6 }}>
              {isPersian
                ? `${faNum(challenge.observed)} دلیل از ${faNum(challenge.arguments.length)} در همین دور مشاهده شد. مدعی فقط از دادهٔ خوانده‌شده حرف می‌زند — ریسک‌های دائمی همیشه فهرست می‌شوند.`
                : `${challenge.observed} of ${challenge.arguments.length} risks were observed in this pass. The challenger speaks only from read data — standing risks are always listed.`}
            </div>
          </>
        ) : (
          <div className="aig-empty" style={{ padding: 16 }}>{L('در این دور فرصت صعودی برجسته‌ای ثبت نشد که مدعی به آن حمله کند.', 'No prominent positive opportunity was recorded this pass for the challenger to attack.')}</div>
        )}
      </div>

      <div className="aigw-note">
        {L(
          'وزن سناریوها تابعی شفاف از خوانش‌های همین دور است (هر تنظیم در برچسب‌ها فهرست شده) — مدل است و سناریو، نه پیش‌بینی قطعی و نه مجوز اجرا.',
          'Scenario weights are a transparent function of this pass\u2019s reads (every nudge is listed as a tag) — a model and a scenario, not a forecast and never an execution order.'
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PANEL 7 — MARKET DNA
   ══════════════════════════════════════════════════════════════════════════ */
const SENS_FA = {
  liquidity: 'حساسیت نقدینگی', macro: 'حساسیت کلان', whale: 'حساسیت نهنگ',
  usd: 'حساسیت دلار', riskOn: 'حساسیت ریسک‌پذیری', etf: 'حساسیت ETF'
};
const SENS_EN = {
  liquidity: 'Liquidity sensitivity', macro: 'Macro sensitivity', whale: 'Whale sensitivity',
  usd: 'USD sensitivity', riskOn: 'Risk-on sensitivity', etf: 'ETF sensitivity'
};
const VOL_FA = { high: 'پرنوسان', medium: 'متوسط', low: 'آرام' };
const VOL_EN = { high: 'volatile', medium: 'moderate', low: 'calm' };

export function DnaPanel({ world, L, isPersian }) {
  const [sym, setSym] = useState('BTC');
  const dna = useMemo(() => buildDna(world, sym), [world, sym]);

  /* the decorative helix strip */
  const helix = useMemo(() => {
    const rungs = [];
    for (let x = 8; x <= 312; x += 16) rungs.push(x);
    return rungs;
  }, []);

  return (
    <>
      <div className="aigw-chips">
        {DNA_ASSETS.map((a) => (
          <button key={a} type="button" className={`aigw-chip ${sym === a ? 'active' : ''}`} onClick={() => setSym(a)}>
            <span className="aigw-ltr">{a}</span>
          </button>
        ))}
      </div>

      <svg className="aigw-dna-helix" viewBox="0 0 320 60" dir="ltr" aria-hidden="true">
        <defs>
          <linearGradient id="aigw-dna-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--rgb-1)" /><stop offset="100%" stopColor="var(--rgb-2)" />
          </linearGradient>
        </defs>
        <path d="M0 30 C 20 6, 40 6, 60 30 S 100 54, 120 30 S 160 6, 180 30 S 220 54, 240 30 S 280 6, 300 30 S 320 42, 320 34"
          fill="none" stroke="url(#aigw-dna-a)" strokeWidth="2" opacity=".8" />
        <path d="M0 30 C 20 54, 40 54, 60 30 S 100 6, 120 30 S 160 54, 180 30 S 220 6, 240 30 S 280 54, 300 30 S 320 18, 320 26"
          fill="none" stroke="url(#aigw-dna-a)" strokeWidth="2" opacity=".45" />
        {helix.map((x) => <line key={x} x1={x} y1={16 + 14 * Math.abs(Math.sin(x / 26))} x2={x} y2={44 - 14 * Math.abs(Math.sin(x / 26))} stroke="color-mix(in srgb,var(--rgb-2) 35%,transparent)" strokeWidth="1" />)}
      </svg>

      <div className="aig-section" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {Object.entries(dna.priors).map(([k, v]) => (
          <div key={k} className="aigw-dna-row">
            <div style={{ minWidth: 0 }}>
              <div className="aigw-dna-name">
                <WIcon name={k === 'liquidity' ? 'drop' : k === 'macro' ? 'bank' : k === 'whale' ? 'waves' : k === 'usd' ? 'chart' : k === 'riskOn' ? 'pulse' : 'layers'} size={14} style={{ color: 'var(--rgb-1)' }} />
                {isPersian ? SENS_FA[k] : SENS_EN[k]}
              </div>
              <div className="aigw-dna-track" aria-hidden="true"><i style={{ width: `${Math.round(v * 100)}%` }} /></div>
            </div>
            <span className="aigw-pill flat" style={{ flexShrink: 0 }}>{isPersian ? `${faNum(Math.round(v * 100))}\u066a` : `${Math.round(v * 100)}%`}</span>
          </div>
        ))}

        <div className="aigw-dna-obs">
          {dna.observed.change !== null ? (
            <span className={`aigw-pill ${dna.observed.change >= 0 ? 'up' : 'down'}`}>
              <DirMark dir={dna.observed.change >= 0 ? 'up' : 'down'} size={9} />
              <span className="aigw-ltr">{pct(dna.observed.change, isPersian)}</span>
            </span>
          ) : <span className="aigw-pill ghost">{L('قیمتی در این دور خوانده نشد', 'no price read this pass')}</span>}
          {dna.observed.volatility ? (
            <span className={`aigw-pill ${dna.observed.volatility === 'high' ? 'bad' : dna.observed.volatility === 'medium' ? 'warn' : 'up'}`}>
              {L(`نوسان: ${VOL_FA[dna.observed.volatility]}`, `volatility: ${VOL_EN[dna.observed.volatility]}`)}
            </span>
          ) : null}
          {dna.observed.usdAlignment ? (
            <span className={`aigw-pill ${dna.observed.usdAlignment === 'opposite' ? 'warn' : 'info'}`}>
              {dna.observed.usdAlignment === 'opposite'
                ? L('خلاف‌جهت با دلار در این دور', 'opposite the dollar this pass')
                : L('هم‌جهت با دلار در این دور', 'with the dollar this pass')}
            </span>
          ) : null}
          {dna.observed.whaleTouched ? <span className="aigw-pill info">{L('در جریان‌های برچسب‌دار این دور دیده شد', 'seen in this pass\u2019s labelled flows')}</span> : null}
          {dna.observed.etfLinked ? <span className="aigw-pill flat">{L('پیوند ETF', 'ETF-linked')}</span> : null}
        </div>
      </div>

      <div className="aigw-note">
        {L(
          'نوارهای حساسیت، پیش‌فرض‌های مدل‌اند (برچسب‌دار و ثابت)؛ برچسب‌های مشاهده از خوانش واقعی همین دور می‌آیند: تغییر دارایی، هم‌جهتی با دلار، حضور در جریان نهنگ‌ها. هیچ‌کدام مجوز اجرا نیست.',
          'The sensitivity bars are model priors (labelled, fixed); the observation chips come from this pass\u2019s real reads: the asset\u2019s move, its dollar alignment, its presence in whale flows. None of it is execution authority.'
        )}
      </div>
    </>
  );
}

export default WorldStatePanel;
