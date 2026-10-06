/**
 * FBT WORLD CONSOLE — the panel barrel.
 * ---------------------------------------------------------------------------
 * «FBT جهانی» renders eleven surfaces from ONE pass payload. Every surface
 * lives in its own module next to this file; this barrel is the single import
 * point the host screen uses, so the host never has to know the file layout.
 *
 *   · world  → WeatherPanel   (financial weather board + nine gauges)
 *   · globe  → GlobePanel     (3-D dot globe + all 48 economies)
 *   · radar  → RadarPanel     (sector radar + full signal tape)
 *   · cross  → OutlookPanel   (the weighted economic-outlook reading)
 *   · causal → CausalPanel    (server macro-graph, lazy once per session)
 *   · flows  → FlowPanel      (capital-flow map + macro transmission)
 *   · future → FuturePanel    (scenario tree + adversarial challenger)
 *   · dna    → DnaPanel       (market DNA: priors + this pass's readings)
 *   · domains→ DomainsPanel   (every field each domain returned)
 *   · provs  → ProvidersPanel (five readiness lamps, SVG icons)
 *
 * REPORTED (2026-10): «همه چیز را مدرن‌تر و بی‌نظیرتر کن … رنگ‌ها بنفش نباشد …
 * ایکون‌ها SVG درست … داده واقعی، هیچ عدد ساختگی». Each module owns its own
 * accent pair and its own honesty footnotes; nothing here invents data and
 * nothing here adds a request to the 60-second refresh loop.
 */
export { WORLD_STYLES } from './styles.js';
export { GLOBAL_PAGE_STYLES } from './ui.styles.js';

export { HeroPanel } from './HeroPanel.jsx';
export { BriefingPanel } from './BriefingPanel.jsx';
export { WorldStatePanel } from './WeatherPanel.jsx';
export { GlobePanel } from './GlobePanel.jsx';
export { RadarPanel } from './RadarPanel.jsx';
export { CausalPanel } from './CausalPanel.jsx';
export { FlowMapPanel } from './FlowPanel.jsx';
export { FutureTreePanel } from './FuturePanel.jsx';
export { DnaPanel } from './DnaPanel.jsx';
export { OutlookPanel } from './OutlookPanel.jsx';
export { DomainsView } from './DomainsPanel.jsx';
export { ProvidersPanel } from './ProvidersPanel.jsx';

/* the icon + format helpers, re-exported so the host keeps one import path */
export { WIcon, DirMark, WeatherGlyph, W_PATHS, TAB_PATHS, TabIcon, TAB_ACCENTS } from './icons.jsx';
export { QualityBadge, Ltr } from './parts.jsx';
export { faNum, pct, moneyK, timeAgo } from './format.jsx';

export { default } from './WeatherPanel.jsx';
