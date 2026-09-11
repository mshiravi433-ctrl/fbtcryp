/**
 * FBT INTENT OS — AI GLOBAL INTELLIGENCE (Phase 211).
 * ---------------------------------------------------------------------------
 * The user-facing surface of the Global Intelligence Engine: one screen that
 * shows what the AI's global brain actually READ — smart money, whales,
 * on-chain health, macro, news, stocks, forex, commodities, RWA — plus the
 * cross-asset regime and the proactive briefing, with the same honesty rules
 * the engine enforces server-side:
 *
 *   · a domain that was not read says «unread» with its reason — never zero
 *   · a provider light marked live means a real result, not a promise
 *   · every briefing item names its source; nothing carries execution
 *
 * This surface is available at /ai-global for existing deep links and is also
 * embedded as the Global tab in News. The standalone More-sheet doorway is
 * intentionally gone; both renderings talk to the FI's own additive
 * endpoints under /api/ai/global/*.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThinkingOrb } from './ThinkingOrb.jsx';
import { apiBase } from '../../lib/apiBase';

/* ── Styles (scoped, same visual language as the AI control center) ────── */
const STYLES = `
  .ai-global { width:100%; max-width:100%; box-sizing:border-box; padding:12px 14px 24px; min-height:100%; color:var(--text-1); overflow:hidden; }
  .aig-header { position:relative; display:flex; align-items:center; gap:12px; margin-bottom:16px; min-height:72px; padding:13px 14px; border:1px solid var(--line); border-radius:20px; background:linear-gradient(135deg,color-mix(in srgb,var(--rgb-1) 9%,var(--bg-panel-solid)),color-mix(in srgb,var(--rgb-2) 13%,var(--bg-panel-solid)) 55%,color-mix(in srgb,var(--rgb-3) 7%,var(--bg-panel-solid))); box-shadow:var(--glass-shadow); overflow:hidden; }
  .aig-header::after { content:""; position:absolute; width:100px; height:100px; inset-inline-end:-35px; top:-45px; border-radius:50%; background:var(--rgb-2); opacity:.12; filter:blur(22px); pointer-events:none; }
  .aig-title { flex:1; min-width:0; font-size:var(--fs-lg); line-height:var(--lh-tight); font-weight:800; color:var(--text-1); }
  .aig-chip { flex:0 0 auto; font-size:var(--fs-xs); font-weight:700; color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 13%,transparent); border:1px solid color-mix(in srgb,var(--rgb-2) 28%,transparent); padding:5px 9px; border-radius:999px; white-space:nowrap; }
  .aig-chip.warn { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 12%,transparent); }
  .aig-chip.bad { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); }
  .aig-tabs { display:flex; gap:8px; margin:0 0 16px; padding:6px; max-width:100%; box-sizing:border-box; background:color-mix(in srgb, var(--bg-panel) 80%, transparent); border-radius:18px; border:1px solid color-mix(in srgb, var(--line) 50%, transparent); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
  .aig-tab { flex:1 1 0; min-width:0; min-height:64px; padding:8px; border-radius:12px; font:inherit; font-size:11px; font-weight:700; line-height:1.4; color:var(--text-3); background:transparent; border:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; text-align:center; overflow-wrap:anywhere; transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .aig-tab:hover { color:var(--text-2); background:color-mix(in srgb, var(--bg-raised) 50%, transparent); }
  .aig-tab-icon { width:24px; height:24px; display:grid; place-items:center; flex:0 0 24px; transition:transform 0.3s ease; }
  .aig-tab-icon svg { width:100%; height:100%; }
  .aig-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .aig-tab.active { color:var(--text-1); background:linear-gradient(135deg,color-mix(in srgb,var(--rgb-1) 15%,var(--bg-panel-solid)),color-mix(in srgb,var(--rgb-2) 18%,var(--bg-panel-solid))); border:1px solid color-mix(in srgb,var(--rgb-2) 40%,transparent); box-shadow:0 6px 16px color-mix(in srgb,var(--rgb-2) 15%,transparent), inset 0 1px 1px rgba(255,255,255,0.05); transform:translateY(-2px); }
  .aig-tab.active .aig-tab-icon { transform:scale(1.1); color:var(--rgb-2); }
  .aig-refresh { width:100%; min-height:48px; margin-bottom:var(--sp-4); color:var(--text-1); background:linear-gradient(180deg, var(--bg-raised) 0%, var(--bg-panel) 100%); border:1px solid var(--line); border-radius:14px; font:inherit; font-size:var(--fs-sm); font-weight:700; cursor:pointer; transition:all 0.2s ease; box-shadow:0 2px 8px rgba(0,0,0,0.04); display:flex; align-items:center; justify-content:center; gap:8px; }
  .aig-refresh:hover:not(:disabled) { background:linear-gradient(180deg, color-mix(in srgb, var(--bg-raised) 90%, var(--rgb-2)) 0%, var(--bg-panel) 100%); border-color:var(--rgb-2); transform:translateY(-1px); box-shadow:0 4px 12px color-mix(in srgb,var(--rgb-2) 15%,transparent); }
  .aig-refresh:active:not(:disabled) { transform:translateY(0); box-shadow:none; }
  .aig-refresh:disabled { opacity:.6; cursor:wait; }
  @keyframes spin { 100% { transform:rotate(360deg); } }
  .aig-connection { display:flex; align-items:center; gap:8px; margin-bottom:var(--sp-3); padding:9px 12px; border:1px solid color-mix(in srgb,var(--down) 35%,var(--line)); border-radius:var(--radius-sm); color:var(--down); background:color-mix(in srgb,var(--down) 8%,var(--bg-panel-solid)); font-size:var(--fs-xs); }
  .aig-section { margin-bottom:var(--sp-4); background:var(--bg-panel); border:1px solid var(--line); border-radius:var(--radius); padding:var(--sp-4); box-shadow:var(--glass-shadow); }
  .aig-section-title { font-size:var(--fs-sm); font-weight:800; color:var(--text-1); margin-bottom:var(--sp-3); display:flex; align-items:center; gap:var(--sp-2); }
  .aig-item { padding:var(--sp-3); border-radius:var(--radius-sm); margin-bottom:var(--sp-2); background:var(--bg-raised); border:1px solid var(--line); }
  .aig-item-top { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .aig-prio { font-size:10px; font-weight:800; padding:2px 7px; border-radius:6px; letter-spacing:.3px; }
  .aig-prio.critical { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); }
  .aig-prio.high { color:#f97316; background:rgba(249,115,22,.12); }
  .aig-prio.normal { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 10%,transparent); }
  .aig-prio.info { color:var(--up); background:color-mix(in srgb,var(--up) 10%,transparent); }
  .aig-item-kind,.aig-item-meta { font-size:var(--fs-xs); color:var(--text-3); }
  .aig-item-title { font-size:var(--fs-sm); font-weight:700; color:var(--text-1); overflow-wrap:anywhere; }
  .aig-item-detail { font-size:var(--fs-xs); color:var(--text-2); margin-top:4px; line-height:var(--lh-normal); }
  .aig-item-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:8px; }
  .aig-item-action { color:var(--rgb-1); cursor:pointer; font-weight:700; }
  .aig-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--sp-2); }
  .aig-card { min-width:0; background:var(--bg-raised); border:1px solid var(--line); border-radius:var(--radius-sm); padding:var(--sp-3); }
  .aig-card-name { font-size:var(--fs-xs); color:var(--text-2); display:flex; align-items:center; gap:6px; }
  .aig-card-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; box-shadow:0 0 8px currentColor; }
  .aig-card-value { font-size:var(--fs-lg); font-weight:800; color:var(--text-1); margin-top:6px; }
  .aig-card-sub { font-size:11px; color:var(--text-2); margin-top:3px; line-height:1.45; overflow-wrap:anywhere; }
  .aig-light { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:var(--radius-sm); background:var(--bg-raised); border:1px solid var(--line); margin-bottom:6px; }
  .aig-light-name { min-width:0; font-size:var(--fs-xs); color:var(--text-1); flex:1; overflow-wrap:anywhere; }
  .aig-light-lamps { display:flex; flex:0 0 auto; gap:5px; direction:ltr; }
  .aig-lamp { width:9px; height:9px; border-radius:50%; background:var(--line-strong); }
  .aig-lamp.on { background:var(--up); box-shadow:0 0 7px color-mix(in srgb,var(--up) 60%,transparent); }
  .aig-empty { text-align:center; padding:24px 8px; color:var(--text-2); font-size:var(--fs-sm); line-height:var(--lh-loose); }
  .aig-reason { font-size:10px; color:var(--down); margin-top:4px; text-align:start; overflow-wrap:anywhere; }
  .aig-regime { padding:var(--sp-4); border-radius:var(--radius-sm); text-align:center; margin-bottom:var(--sp-3); border:1px solid var(--line); background:var(--bg-raised); }
  .aig-regime.risk_on { background:color-mix(in srgb,var(--up) 8%,var(--bg-raised)); border-color:color-mix(in srgb,var(--up) 28%,var(--line)); }
  .aig-regime.risk_off { background:color-mix(in srgb,var(--down) 8%,var(--bg-raised)); border-color:color-mix(in srgb,var(--down) 28%,var(--line)); }
  .aig-regime.mixed { background:color-mix(in srgb,var(--rgb-5) 8%,var(--bg-raised)); }
  .aig-regime-label { font-size:var(--fs-lg); font-weight:800; color:var(--text-1); overflow-wrap:anywhere; }
  .aig-regime-sub,.aig-note { font-size:var(--fs-xs); color:var(--text-2); line-height:var(--lh-normal); margin-top:6px; }
  .aig-outlook { padding:var(--sp-4); border-radius:var(--radius-sm); margin-bottom:var(--sp-3); border:1px solid var(--line); background:var(--bg-raised); }
  .aig-outlook.growth { border-color:color-mix(in srgb,var(--up) 30%,var(--line)); background:color-mix(in srgb,var(--up) 6%,var(--bg-raised)); }
  .aig-outlook.recession { border-color:color-mix(in srgb,var(--down) 30%,var(--line)); background:color-mix(in srgb,var(--down) 6%,var(--bg-raised)); }
  .aig-outlook-head { display:flex; align-items:center; justify-content:space-between; gap:var(--sp-2); }
  .aig-outlook-score { font-size:var(--fs-sm); font-weight:800; padding:3px 9px; border-radius:999px; background:color-mix(in srgb,var(--rgb-2) 12%,transparent); color:var(--text-1); }
  .aig-signal { display:flex; gap:8px; align-items:flex-start; padding:8px 0; border-top:1px solid var(--line); }
  .aig-signal:first-of-type { border-top:none; }
  .aig-signal-dir { flex:0 0 auto; font-size:10px; font-weight:800; padding:2px 6px; border-radius:6px; white-space:nowrap; margin-top:1px; }
  .aig-signal-dir.supportive { color:var(--up); background:color-mix(in srgb,var(--up) 11%,transparent); }
  .aig-signal-dir.cautionary { color:var(--down); background:color-mix(in srgb,var(--down) 11%,transparent); }
  .aig-signal-dir.neutral { color:var(--text-2); background:color-mix(in srgb,var(--rgb-5) 9%,transparent); }
  .aig-signal-body { min-width:0; flex:1; }
  .aig-signal-name { font-size:var(--fs-xs); font-weight:800; color:var(--text-1); }
  .aig-signal-ev { font-size:var(--fs-xs); color:var(--text-2); line-height:var(--lh-normal); overflow-wrap:anywhere; }
  .aig-ind-chg { font-size:11px; font-weight:700; }
  .aig-narrative { margin:var(--sp-3) 0; padding:var(--sp-3) var(--sp-4); border-radius:var(--radius-sm); border:1px solid color-mix(in srgb,var(--rgb-1) 22%,var(--line)); background:linear-gradient(135deg,color-mix(in srgb,var(--rgb-1) 6%,var(--bg-raised)),color-mix(in srgb,var(--rgb-2) 7%,var(--bg-raised))); }
  .aig-narrative-title { display:flex; align-items:center; gap:6px; font-size:var(--fs-xs); font-weight:800; color:var(--text-1); margin-bottom:6px; }
  .aig-narrative-text { font-size:var(--fs-xs); line-height:var(--lh-loose); color:var(--text-1); overflow-wrap:anywhere; }
  .aig-narrative-note { font-size:10px; color:var(--text-3); margin-top:6px; }
  .aig-commentary-provider { flex:0 0 auto; font-size:10px; font-weight:700; color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 12%,transparent); padding:2px 7px; border-radius:999px; }
  .aig-fallback-tag { display:inline-block; margin-inline-start:5px; font-size:9px; font-weight:700; color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 10%,transparent); padding:1px 6px; border-radius:6px; vertical-align:middle; }
  .aig-market-chart { margin:var(--sp-3) 0 var(--sp-4); padding:var(--sp-3); border:1px solid color-mix(in srgb,var(--rgb-1) 22%,var(--line)); border-radius:var(--radius-sm); background:linear-gradient(145deg,color-mix(in srgb,var(--rgb-1) 7%,var(--bg-raised)),var(--bg-raised)); }
  .aig-chart-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }
  .aig-chart-title { font-size:var(--fs-xs); font-weight:800; color:var(--text-1); }
  .aig-chart-source { font-size:10px; color:var(--text-3); }
  .aig-chart-svg { width:100%; height:auto; display:block; overflow:visible; }
  .aig-insight-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .aig-insight-card { min-width:0; position:relative; overflow:hidden; padding:11px; border-radius:14px; border:1px solid var(--line); background:linear-gradient(145deg,var(--bg-raised),color-mix(in srgb,var(--rgb-1) 5%,var(--bg-raised))); }
  .aig-insight-card::after { content:""; position:absolute; width:64px; height:64px; inset-inline-end:-25px; top:-25px; border-radius:50%; background:var(--insight-tone,var(--rgb-2)); opacity:.13; filter:blur(13px); }
  .aig-insight-kicker { display:flex; align-items:center; gap:6px; position:relative; z-index:1; font-size:10px; color:var(--text-2); line-height:1.35; }
  .aig-insight-icon { font-size:18px; line-height:1; }
  .aig-insight-logo { width:24px; height:24px; flex:0 0 24px; display:grid; place-items:center; overflow:hidden; border-radius:8px; color:var(--text-1); background:linear-gradient(135deg,var(--rgb-1),var(--rgb-2)); font-size:11px; font-weight:900; }
  .aig-insight-logo img { width:100%; height:100%; object-fit:cover; }
  .aig-insight-symbol { position:relative; z-index:1; display:flex; align-items:center; gap:6px; margin-top:9px; font-size:var(--fs-md); font-weight:900; color:var(--text-1); }
  .aig-insight-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; font-weight:600; color:var(--text-3); }
  .aig-insight-value { position:relative; z-index:1; margin-top:4px; font-size:var(--fs-sm); font-weight:900; }
  .aig-insight-meta { position:relative; z-index:1; margin-top:3px; font-size:10px; color:var(--text-2); line-height:1.35; overflow-wrap:anywhere; }
  .aig-insight-empty { position:relative; z-index:1; margin-top:9px; color:var(--text-3); font-size:11px; line-height:1.45; }
  /* ── icons + direction markers ─────────────────────────────────────────── */
  .aig-icon { flex:0 0 auto; display:inline-block; vertical-align:-3px; }
  .aig-dir { flex:0 0 auto; display:inline-block; vertical-align:-1px; }
  .aig-dir-up { color:var(--up); }
  .aig-dir-down { color:var(--down); }
  .aig-dir-flat { color:var(--text-3); }

  /* ── one card: the class chart AND the per-class readings ──────────────── */
  .aig-move { margin:0 0 var(--sp-3); padding:var(--sp-3) var(--sp-4) var(--sp-2); border-radius:var(--radius-sm); border:1px solid color-mix(in srgb,var(--rgb-1) 22%,var(--line)); background:linear-gradient(145deg,color-mix(in srgb,var(--rgb-1) 7%,var(--bg-raised)),var(--bg-raised)); }
  .aig-move-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:2px; }
  .aig-move-title { display:flex; align-items:center; gap:6px; font-size:var(--fs-xs); font-weight:800; color:var(--text-1); }
  .aig-move-src { font-size:10px; color:var(--text-3); white-space:nowrap; }
  .aig-move-list { list-style:none; margin:8px 0 0; padding:0; }
  .aig-move-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:8px; padding:7px 0; border-top:1px solid color-mix(in srgb,var(--line) 70%,transparent); }
  .aig-move-name { min-width:0; display:flex; align-items:center; gap:6px; font-size:var(--fs-xs); font-weight:700; color:var(--text-1); overflow:hidden; }
  .aig-move-breadth { flex:0 0 auto; font-size:10px; color:var(--text-3); white-space:nowrap; direction:ltr; }
  .aig-move-avg { flex:0 0 auto; font-size:var(--fs-sm); font-weight:900; direction:ltr; }
  .aig-move-avg.up { color:var(--up); }
  .aig-move-avg.down { color:var(--down); }
  .aig-move-avg.flat { color:var(--text-2); }

  /* ── the economic outlook, de-cluttered ───────────────────────────────── */
  .aig-outlook-score { display:inline-flex; align-items:center; gap:5px; }
  .aig-outlook-now { display:flex; align-items:baseline; gap:8px; margin-top:8px; padding:7px 10px; border-radius:10px; background:color-mix(in srgb,var(--bg-panel) 60%,transparent); }
  .aig-outlook-now-k { flex:0 0 auto; font-size:10px; color:var(--text-3); }
  .aig-outlook-now-v { min-width:0; font-size:var(--fs-xs); font-weight:800; color:var(--text-1); overflow-wrap:anywhere; }
  .aig-signal-src { margin-inline-start:6px; font-size:9px; font-weight:700; color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 11%,transparent); padding:1px 6px; border-radius:6px; vertical-align:middle; }

  /* ── the single system-analysis box ───────────────────────────────────── */
  .aig-analysis-lines { list-style:none; margin:0; padding:0; }
  .aig-analysis-line { display:flex; align-items:flex-start; gap:8px; padding:7px 0; border-top:1px solid color-mix(in srgb,var(--line) 70%,transparent); }
  .aig-analysis-line:first-child { border-top:none; }
  .aig-analysis-line .aig-dir { margin-top:4px; }
  .aig-analysis-text { min-width:0; flex:1; font-size:var(--fs-xs); line-height:var(--lh-loose); color:var(--text-1); overflow-wrap:anywhere; }
  .aig-analysis-line.is-flat .aig-analysis-text { color:var(--text-2); }
  .aig-analysis-ai { margin-top:var(--sp-3); padding-top:var(--sp-3); border-top:1px dashed color-mix(in srgb,var(--rgb-2) 30%,var(--line)); }

  .aig-insight-value.up { color:var(--up); }
  .aig-insight-value.down { color:var(--down); }
  .aig-insight-value.flat { color:var(--text-2); }

  @media (max-width:360px) { .ai-global { padding-inline:12px; } .aig-title { font-size:18px; } .aig-chip { font-size:10px; padding-inline:7px; } .aig-tabs { gap:6px; } .aig-tab { font-size:10px; min-height:56px; padding-inline:4px; } .aig-section { padding:13px; } .aig-move { padding-inline:11px; } .aig-move-row { grid-template-columns:minmax(0,1fr) auto; } .aig-move-breadth { display:none; } .aig-insight-grid { gap:6px; } }
  @media (min-width:480px) { .ai-global { padding-inline:16px; } .aig-tab { font-size:var(--fs-xs); } .aig-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
`;

const TABS = [
  { id: 'briefing', icon: 'briefing', marker: '📰' },
  { id: 'domains', icon: 'domains', marker: '🌍' },
  { id: 'cross', icon: 'cross', marker: '🔀' },
  { id: 'providers', icon: 'providers', marker: '🔌' }
];

function TabIcon({ name }) {
  const paths = {
    briefing: <><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><polyline points="14 2 14 8 20 8"/><path d="M2 15h10"/><path d="M2 19h6"/><path d="M12 11h6"/><path d="M12 15h4"/></>,
    domains: <><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></>,
    cross: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></>,
    providers: <><path d="M19 11v-2a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v2"/><path d="M2 15h20"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><path d="M12 7v4"/><path d="M8 7v4"/><path d="M16 7v4"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

/* Domain card glyphs. These were emoji (🧠 🐋 ⛓️ 📰 🏛️ 📈 💱 🛢️): each OS
   draws them differently, they ignore the theme's accent colour and they sit
   in the middle of a Persian line with the wrong metrics. They are stroke icons
   now, drawn from the shared AIG_PATHS set. */
const DOMAIN_META = {
  smart_money: { icon: 'brain', fa: 'پول هوشمند', en: 'Smart money' },
  whales: { icon: 'waves', fa: 'نهنگ‌ها', en: 'Whales' },
  onchain: { icon: 'link', fa: 'روی زنجیره', en: 'On-chain' },
  news: { icon: 'news', fa: 'اخبار', en: 'News' },
  macro: { icon: 'bank', fa: 'کلان', en: 'Macro' },
  stocks: { icon: 'chart', fa: 'سهام', en: 'Stocks' },
  forex: { icon: 'exchange', fa: 'فارکس', en: 'Forex' },
  commodities: { icon: 'drop', fa: 'کالاها', en: 'Commodities' },
  rwa: { icon: 'building', fa: 'دارایی واقعی', en: 'RWA' }
};

/* ── Localised labels for the server's enum-like strings ──────────────────
 * The briefing/cross-asset/providers payloads carry English codes (priority,
 * kind, source, regime, class, topic, reason). The canonical English text
 * stays untouched — these maps only decide what a Persian UI shows. Unknown
 * values fall back to a prettified code, never to a blank. */
const AIG_PRIORITY = {
  critical: { fa: 'بحرانی', en: 'CRITICAL' }, high: { fa: 'مهم', en: 'HIGH' },
  normal: { fa: 'عادی', en: 'NORMAL' }, info: { fa: 'اطلاع', en: 'INFO' }
};
const AIG_KIND = {
  guardian: { fa: 'نگهبان', en: 'guardian' }, portfolio: { fa: 'پرتفوی', en: 'portfolio' },
  risk: { fa: 'ریسک', en: 'risk' }, goal: { fa: 'هدف', en: 'goal' },
  smart_money: { fa: 'پول هوشمند', en: 'smart money' }, whale: { fa: 'نهنگ', en: 'whale' },
  macro: { fa: 'کلان', en: 'macro' }, news: { fa: 'اخبار', en: 'news' },
  onchain: { fa: 'روی‌زنجیره', en: 'on-chain' }, stocks: { fa: 'سهام', en: 'stocks' },
  forex: { fa: 'فارکس', en: 'forex' }, commodities: { fa: 'کالاها', en: 'commodities' },
  rwa: { fa: 'دارایی واقعی', en: 'rwa' }, cross_asset: { fa: 'کراس‌است', en: 'cross-asset' },
  learning: { fa: 'یادگیری', en: 'learning' }
};
const AIG_SOURCE = {
  guardian: { fa: 'نگهبان', en: 'guardian' }, 'guardian:policies': { fa: 'نگهبان', en: 'guardian' },
  'guardian:alerts': { fa: 'نگهبان', en: 'guardian' }, 'financial-state': { fa: 'وضعیت مالی', en: 'financial state' },
  'financial-state:performance': { fa: 'وضعیت مالی', en: 'financial state' },
  'financial-state:risk': { fa: 'وضعیت مالی', en: 'financial state' },
  'goal-engine': { fa: 'موتور هدف', en: 'goal engine' },
  'smartMoney:overview': { fa: 'پول هوشمند', en: 'smart money' },
  'whales:scanner': { fa: 'اسکنر نهنگ', en: 'whale scanner' },
  'macro:classifier': { fa: 'دسته‌بند کلان', en: 'macro classifier' },
  'news-engine': { fa: 'موتور خبر', en: 'news engine' }, chainIntel: { fa: 'چین‌اینتل', en: 'chain intel' },
  'brain:stocks': { fa: 'سهام', en: 'stocks' }, 'brain:forex': { fa: 'فارکس', en: 'forex' },
  'brain:commodities': { fa: 'کالاها', en: 'commodities' }, 'brain:rwa': { fa: 'دارایی واقعی', en: 'rwa' },
  'equities-feed:avantis': { fa: 'سهام', en: 'stocks' }, 'rwa-feed:ostium': { fa: 'اوستیوم', en: 'ostium' },
  'cross-asset-engine': { fa: 'کراس‌است', en: 'cross-asset' },
  'learning:calibration': { fa: 'یادگیری', en: 'learning' },
  'macroData': { fa: 'داده کلان', en: 'macro data' }, 'macroData:stooq': { fa: 'داده کلان (stooq)', en: 'macro data (stooq)' },
  'macroData:yahoo': { fa: 'داده کلان (yahoo)', en: 'macro data (yahoo)' }, 'macroData:fred': { fa: 'داده کلان (FRED)', en: 'macro data (FRED)' },
  'stooq': { fa: 'داده کلان', en: 'macro data' }, 'yahoo': { fa: 'داده کلان', en: 'macro data' }, 'fred': { fa: 'داده کلان', en: 'macro data' }
};
const AIG_REGIME = {
  RISK_ON: { fa: 'ریسک‌پذیر', en: 'risk on' }, RISK_ON_LEANING: { fa: 'متمایل به ریسک‌پذیری', en: 'risk on leaning' },
  MIXED: { fa: 'ترکیبی', en: 'mixed' }, RISK_OFF_LEANING: { fa: 'متمایل به احتیاط', en: 'risk off leaning' },
  RISK_OFF: { fa: 'ریسک‌گریز', en: 'risk off' }
};
const AIG_CLASS = {
  crypto: { fa: 'رمزارز', en: 'crypto' }, stocks: { fa: 'سهام', en: 'stocks' },
  forex: { fa: 'فارکس', en: 'forex' }, commodities: { fa: 'کالاها', en: 'commodities' },
  rwa: { fa: 'دارایی واقعی', en: 'rwa' }
};
const AIG_TOPIC = {
  FED: { fa: 'فدرال‌رزرو', en: 'FED' }, RATES: { fa: 'نرخ بهره', en: 'RATES' },
  INFLATION: { fa: 'تورم', en: 'INFLATION' }, GROWTH: { fa: 'رشد', en: 'GROWTH' },
  ECB: { fa: 'اروپا', en: 'ECB' }, GEOPOLITICS: { fa: 'ژئوپلیتیک', en: 'GEOPOLITICS' },
  CRYPTO_POLICY: { fa: 'قانون رمزارز', en: 'CRYPTO POLICY' },
  POLITICS: { fa: 'سیاست', en: 'POLITICS' }, CURRENCIES: { fa: 'ارز و پولی', en: 'CURRENCIES' }
};
const AIG_OUTLOOK = {
  GROWTH_WATCH: { fa: 'چشم‌انداز رشد', en: 'growth watch' },
  RECESSION_WATCH: { fa: 'هشدار رکود', en: 'recession watch' },
  MIXED_SIGNALS: { fa: 'سیگنال‌های مختلط', en: 'mixed signals' },
  UNAVAILABLE: { fa: 'دادهٔ کافی نیست', en: 'no data yet' }
};
const AIG_DIRECTION = {
  supportive: { fa: 'پشتیبان', en: 'supportive' }, cautionary: { fa: 'هشداردهنده', en: 'cautionary' },
  neutral: { fa: 'خنثی', en: 'neutral' }
};
const AIG_MISSING = {
  guardian: { fa: 'نگهبان', en: 'guardian' }, financial: { fa: 'وضعیت مالی', en: 'financial' },
  goals: { fa: 'اهداف', en: 'goals' }, global_intelligence: { fa: 'هوش جهانی', en: 'global intelligence' },
  cross_asset: { fa: 'کراس‌است', en: 'cross-asset' }, learning: { fa: 'یادگیری', en: 'learning' },
  crypto: { fa: 'رمزارز', en: 'crypto' }, stocks: { fa: 'سهام', en: 'stocks' },
  forex: { fa: 'فارکس', en: 'forex' }, commodities: { fa: 'کالاها', en: 'commodities' },
  rwa: { fa: 'دارایی واقعی', en: 'rwa' }
};
const AIG_REASON = {
  NO_INSTRUMENTS_IN_CATEGORY: { fa: 'ابزاری در این دسته خوانده نشد', en: 'no instruments read in this category' },
  NO_WHALE_EVENTS: { fa: 'در این بازه انتقال بزرگی ثبت نشد', en: 'no large transfers in this window' },
  NO_WHALE_DATA: { fa: 'داده نهنگ خوانده نشد', en: 'whale data unread' },
  WHALE_PRICE_OUTAGE: { fa: 'سرویس قیمت قطع است', en: 'price service outage' },
  WHALES_UNAVAILABLE: { fa: 'اسکنر نهنگ در دسترس نیست', en: 'whale scanner unavailable' },
  NO_SMART_MONEY_DATA: { fa: 'داده پول هوشمند نیست', en: 'no smart-money data' },
  SMART_MONEY_STREAM_DOWN: { fa: 'جریان پول هوشمند قطع است', en: 'smart-money stream down' },
  SMART_MONEY_UNAVAILABLE: { fa: 'پول هوشمند در دسترس نیست', en: 'smart money unavailable' },
  NO_CHAIN_INTEL_SAMPLES: { fa: 'نمونه‌ای از چین‌اینتل نیست', en: 'no chain-intel samples' },
  CHAIN_INTEL_UNAVAILABLE: { fa: 'چین‌اینتل در دسترس نیست', en: 'chain intel unavailable' },
  NO_NEWS_ITEMS: { fa: 'خبری خوانده نشد', en: 'no news read' },
  NEWS_UNAVAILABLE: { fa: 'سرویس خبر در دسترس نیست', en: 'news unavailable' },
  MACRO_NEEDS_NEWS: { fa: 'تحلیل کلان به خبر نیاز دارد', en: 'macro needs the news domain' },
  NO_MACRO_HEADLINES_IN_WINDOW: { fa: 'در این بازه خبر کلان نیست', en: 'no macro headlines in this window' },
  NO_EQUITIES_READ: { fa: 'ابزار سهامی خوانده نشد', en: 'equities unread' },
  NO_EQUITY_INSTRUMENTS: { fa: 'ابزار سهامی خوانده نشد', en: 'no equity instruments' },
  NO_FOREX_READ: { fa: 'ابزار فارکس خوانده نشد', en: 'forex unread' },
  NO_FOREX_INSTRUMENTS: { fa: 'ابزار فارکس خوانده نشد', en: 'no forex instruments' },
  NO_COMMODITIES_READ: { fa: 'ابزار کالا خوانده نشد', en: 'commodities unread' },
  NO_COMMODITIES_INSTRUMENTS: { fa: 'ابزار کالا خوانده نشد', en: 'no commodity instruments' },
  NO_RWA_READ: { fa: 'ابزار دارایی واقعی خوانده نشد', en: 'rwa unread' },
  NO_RWA_INSTRUMENTS: { fa: 'ابزار دارایی واقعی خوانده نشد', en: 'no rwa instruments' },
  RWA_FEED_UNAVAILABLE: { fa: 'فید اوستیوم در دسترس نیست', en: 'ostium feed unavailable' },
  RWA_SHAPE_UNUSABLE: { fa: 'قالب فید اوستیوم تغییر کرده', en: 'ostium feed shape changed' },
  BRAIN_NOT_WIRED: { fa: 'مغز مرکزی وصل نیست', en: 'brain not wired' },
  BRAIN_READ_REFUSED: { fa: 'خوانش مغز رد شد', en: 'brain read refused' },
  PROVIDER_IMPORT_FAILED: { fa: 'ماژول ارائه‌دهنده بار نشد', en: 'provider failed to load' },
  PROVIDER_FUNCTION_MISSING: { fa: 'تابع ارائه‌دهنده یافت نشد', en: 'provider function missing' },
  /* Phase 211.2 — the upstream failure codes the brain/classifier actually
     emit, so «خوانده نشد» always says WHY. */
  UNCLASSIFIED_ERROR: { fa: 'منبع بالادستی خطای نامشخص داد', en: 'upstream returned an unclassified error' },
  PROVIDER_DOWN: { fa: 'منبع بالادستی از دسترس خارج است', en: 'upstream source is down' },
  SOURCE_NOT_WIRED: { fa: 'منبع در این استقرار وصل نیست', en: 'source not wired in this deployment' },
  SOURCE_REJECTED: { fa: 'منبع درخواست را رد کرد', en: 'source rejected the request' },
  SOURCE_UNAVAILABLE: { fa: 'منبع در دسترس نیست', en: 'source unavailable' },
  RPC_TIMEOUT: { fa: 'زمان خواندن منبع تمام شد', en: 'source read timed out' },
  PROVIDER_TIMEOUT: { fa: 'زمان خواندن منبع تمام شد', en: 'source read timed out' },
  NETWORK_UNAVAILABLE: { fa: 'شبکه در دسترس نیست', en: 'network unavailable' },
  UPSTREAM_HTTP_5XX: { fa: 'خطای سرور منبع بالادستی', en: 'upstream server error' },
  UPSTREAM_HTTP_4XX: { fa: 'درخواست منبع بالادستی رد شد', en: 'upstream rejected the request' },
  NO_FEEDS_REACHABLE: { fa: 'هیچ فید خبری در دسترس نبود', en: 'no news feed reachable' },
  NO_MACRO_DATA_SOURCE: { fa: 'هیچ منبع داده کلانی پاسخ نداد', en: 'no macro data source answered' },
  MODULE_NOT_REGISTERED: { fa: 'ماژول مغز ثبت نشده است', en: 'brain module not registered' },
  OPERATION_NOT_AVAILABLE: { fa: 'این عملیات در ماژول نیست', en: 'operation not available' },
  STATE_STORE_EMPTY: { fa: 'حافظهٔ وضعیت هنوز خالی بود', en: 'state store was empty' },
  NO_AI_PROVIDER: { fa: 'هیچ ارائه‌دهندهٔ هوش مصنوعی پیکربندی نشده — تحلیل محلی نمایش داده می‌شود', en: 'no AI provider configured — showing the local analysis' },
  COMMENTARY_TIMEOUT: { fa: 'زمان تولید تحلیل هوش مصنوعی تمام شد', en: 'AI commentary timed out' },
  COMMENTARY_PROVIDER_FAILED: { fa: 'ارائه‌دهندهٔ هوش مصنوعی پاسخ نداد', en: 'AI provider failed' },
  COMMENTARY_UNUSABLE: { fa: 'پاسخ هوش مصنوعی قابل استفاده نبود', en: 'AI answer was unusable' },
  MACRO_IS_DERIVED: { fa: 'کلان از خبر ساخته می‌شود', en: 'macro is derived from news' },
  MACRO_NEEDS_NEWS_AND_QUOTES: { fa: 'کلان به خبر یا داده کلان نیاز دارد', en: 'macro needs news or macro data' },
  NO_MACRO_HEADLINES_IN_WINDOW_AND_NO_QUOTES: { fa: 'نه خبر کلان و نه داده کلان در این بازه', en: 'no macro headlines or quotes in this window' }
};

const prettyCode = (code) => String(code || '').split(':')[0].replace(/_/g, ' ').trim().toLowerCase() || 'unread';
const mapLabel = (map, key, isPersian) => {
  const hit = map?.[String(key || '')];
  if (hit) return isPersian ? hit.fa : hit.en;
  return null;
};
const reasonLabel = (reason, isPersian) => {
  if (!reason) return '';
  const raw = String(reason);
  const hit = AIG_REASON[raw] || AIG_REASON[raw.split(':')[0]];
  if (hit) return isPersian ? hit.fa : hit.en;
  if (/TIMEOUT/.test(raw)) return isPersian ? 'زمان خواندن تمام شد' : 'read timed out';
  return isPersian ? 'خوانده نشد' : prettyCode(raw);
};
const sourceLabel = (source, isPersian) => {
  if (!source) return '';
  const raw = String(source);
  const direct = mapLabel(AIG_SOURCE, raw, isPersian);
  if (direct) return direct;
  /* `macro:FED`-style evidence sources and future `x:y` sources: label the tail. */
  const tail = raw.includes(':') ? raw.split(':').pop() : raw;
  return mapLabel(AIG_SOURCE, tail, isPersian)
    || mapLabel(AIG_KIND, String(tail).toLowerCase(), isPersian)
    || (isPersian ? tail : prettyCode(tail));
};

const fmtK = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};

const timeAgo = (at, isRTL) => {
  const s = Math.max(0, Math.round((Date.now() - Number(at || 0)) / 1000));
  if (s < 60) return isRTL ? `${s} ثانیه پیش` : `${s}s ago`;
  if (s < 3600) return isRTL ? `${Math.round(s / 60)} دقیقه پیش` : `${Math.round(s / 60)}m ago`;
  return isRTL ? `${Math.round(s / 3600)} ساعت پیش` : `${Math.round(s / 3600)}h ago`;
};

/* ── Modern inline icons ─────────────────────────────────────────────────────
 * «ایموجی‌های داخل باکس‌ها مدرن‌تر شود» — every glyph inside these boxes used
 * to be an emoji (📊 ✨ 🏆 📉 🌐 ⚠️ 💸 🪙 🌐). An emoji is drawn by the OS, so
 * the same box looks different on an iPhone, a Samsung and a desktop; it cannot
 * take the panel's accent colour; and it is announced inconsistently by screen
 * readers. These are the same shapes as a single 1.7px stroke that inherits
 * currentColor, so a direction icon is green when it is up and grey when it is
 * neutral — which is the whole point of the request.
 */
const AIG_PATHS = {
  chart: <><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M7 15l3.5-4 3 2.6L20 7" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M17 5h3v2a3 3 0 0 1-3 3" /><path d="M7 5H4v2a3 3 0 0 0 3 3" /><path d="M12 14v4" /><path d="M8.5 21h7l-.7-3h-5.6l-.7 3Z" /></>,
  warning: <><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M21 11h-4a2 2 0 0 0 0 4h4v-4Z" /></>,
  coin: <><ellipse cx="12" cy="6.5" rx="8" ry="3.5" /><path d="M4 6.5v6c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v-6" /><path d="M4 12.5v5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v-5" /></>,
  curve: <><path d="M3 20c5 0 6-16 9-16s4 16 9 16" /><path d="M3 20h18" /></>,
  pulse: <><path d="M3 12h4l2.5-7 4 14L16 12h5" /></>,
  brain: <><path d="M12 4a4 4 0 0 0-4 4 3 3 0 0 0-1 5.7V17a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-3.3A3 3 0 0 0 16 8a4 4 0 0 0-4-4Z" /><path d="M12 4v17" /><path d="M8.6 12h3.4" /><path d="M12 15.4h3.4" /></>,
  waves: <><path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  news: <><path d="M4 5h13v14H6a2 2 0 0 1-2-2V5Z" /><path d="M17 8h3v9a2 2 0 0 1-2 2" /><path d="M7 9h7" /><path d="M7 13h7" /><path d="M7 17h4" /></>,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8" /><path d="M9.5 10v8" /><path d="M14.5 10v8" /><path d="M19 10v8" /><path d="M3 21h18" /></>,
  exchange: <><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></>,
  drop: <path d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z" />,
  building: <><path d="M4 21V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15" /><path d="M13 10h5a2 2 0 0 1 2 2v9" /><path d="M2 21h20" /><path d="M7.5 8.5h1.5" /><path d="M7.5 13h1.5" /></>,
  spark: <><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><path d="m5.6 5.6 2.1 2.1" /><path d="m16.3 16.3 2.1 2.1" /><path d="m18.4 5.6-2.1 2.1" /><path d="m7.7 16.3-2.1 2.1" /><circle cx="12" cy="12" r="2.6" /></>
};

function AigIcon({ name, size = 16, style }) {
  return (
    <svg
      className="aig-icon"
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={style}
    >
      {AIG_PATHS[name] || AIG_PATHS.pulse}
    </svg>
  );
}

/**
 * One direction marker: up, down, or — deliberately — NEUTRAL.
 * «مثلاً رشد خنثی با رنگ طوسی و مدرن» — a flat reading used to inherit the
 * colour of whatever came before it; it now draws a grey bar of its own, so
 * "no change" is a visible state rather than an absent icon.
 */
function AigDir({ dir, size = 11 }) {
  const kind = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat';
  return (
    <svg className={`aig-dir aig-dir-${kind}`} width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {kind === 'up' ? <path d="M6 1 11 10H1z" /> : kind === 'down' ? <path d="M6 11 1 2h10z" /> : <rect x="1" y="5" width="10" height="2" rx="1" />}
    </svg>
  );
}

const dirOfPct = (v) => (Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : 'flat');

/* Persian digits for the numbers a Persian line quotes. A Latin `+0.80%`
   inside «۷ روز: …» renders left-to-right in the middle of an RTL sentence and
   reads as a foreign fragment — the same complaint as the English words. */
const FA_DIGITS = ['\u06f0', '\u06f1', '\u06f2', '\u06f3', '\u06f4', '\u06f5', '\u06f6', '\u06f7', '\u06f8', '\u06f9'];
const faNum = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]).replace(/-/g, '\u2212');
/** A signed percentage in the language the line is written in. */
const pctText = (v, isPersian) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const ascii = `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
  return isPersian ? `${faNum(ascii).replace('%', '\u066a')}` : ascii;
};
/** A plain number, localised the same way. */
const numText = (v, isPersian, digits = 2) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const ascii = Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
  return isPersian ? faNum(ascii) : ascii;
};

/* Names for the macro desk's own tickers. The SYMBOL stays the ticker the
   source returned (that is what a reader would look up); the human name is
   Persian in a Persian box, falling back to the feed's own wording. */
const AIG_MACRO_NAME = {
  DXY: { fa: 'شاخص دلار', en: 'US Dollar Index' },
  GOLD: { fa: 'طلا (دلار/اونس)', en: 'Gold (USD/oz)' },
  XAU: { fa: 'طلا (دلار/اونس)', en: 'Gold (USD/oz)' },
  WTI: { fa: 'نفت خام', en: 'Crude (WTI)' },
  SPX: { fa: 'شاخص اس‌اندپی ۵۰۰', en: 'S&P 500 futures' },
  NDX: { fa: 'شاخص نزدک ۱۰۰', en: 'Nasdaq 100' },
  US10Y: { fa: 'بازده ۱۰ سالهٔ آمریکا', en: 'US 10Y yield' },
  US2S10S: { fa: 'اختلاف ۲ و ۱۰ ساله', en: '2y vs 10y spread' }
};
const AIG_CHAIN = {
  ethereum: { fa: 'اتریوم', en: 'Ethereum' }, solana: { fa: 'سولانا', en: 'Solana' },
  bsc: { fa: 'بایننس‌اسمارت‌چین', en: 'BNB Chain' }, base: { fa: 'بیس', en: 'Base' },
  arbitrum: { fa: 'آربیتروم', en: 'Arbitrum' }, polygon: { fa: 'پلیگان', en: 'Polygon' },
  optimism: { fa: 'آپتیمیزم', en: 'Optimism' }, avalanche: { fa: 'اولانچ', en: 'Avalanche' }
};
const AIG_FLOW = {
  accumulation: { fa: 'انباشت', en: 'accumulation' },
  distribution: { fa: 'توزیع', en: 'distribution' }
};
const macroName = (q, isPersian) => (isPersian ? AIG_MACRO_NAME[q?.symbol]?.fa : AIG_MACRO_NAME[q?.symbol]?.en) || q?.name || '';

/* ══════════════════════════════════════════════════════════════════════════
   ONE CARD: the movement chart AND the per-class readings
   ──────────────────────────────────────────────────────────────────────────
   «باکس رمز ارز و نمودار پایینی داخل یک باکس باشد و مدرن‌تر و قشنگ‌تر» — the
   class tiles and the bar chart were two separate boxes stating the SAME
   numbers twice, one above the other. They are one card now: the chart on top,
   and under it one row per class carrying the average, its direction icon and
   the breadth behind it.
   ══════════════════════════════════════════════════════════════════════════ */
function CrossAssetMovement({ cross, L, isPersian }) {
  const classes = cross?.classes || {};
  const rows = Object.entries(classes)
    .filter(([, c]) => c && Number.isFinite(Number(c?.avgChangePct)))
    .map(([key, c]) => ({ key, avg: Number(c.avgChangePct), advancing: c.advancing, withChange: c.withChange, fallback: c.fallbackSource }));
  const chartRows = rows.filter((r) => Number.isFinite(r.avg));
  const max = Math.max(0.1, ...chartRows.map((r) => Math.abs(r.avg)));
  const label = (key) => (isPersian
    ? (AIG_CLASS[key]?.fa || key)
    : (AIG_CLASS[key]?.en || key).toUpperCase());
  const xStep = chartRows.length ? 340 / chartRows.length : 340;
  return (
    <section className="aig-move" aria-label={L('حرکت کلاس‌های دارایی', 'Asset-class movement')}>
      <header className="aig-move-head">
        <span className="aig-move-title"><AigIcon name="chart" /> {L('حرکت کلاس‌های دارایی', 'Asset-class movement')}</span>
        <span className="aig-move-src">{L('خوانش واقعی همین دور', 'reads from this pass')}</span>
      </header>

      {chartRows.length ? (
        <svg className="aig-chart-svg" viewBox="0 0 360 132" preserveAspectRatio="none" role="img" aria-label={L('نمودار تغییر ۲۴ ساعتهٔ کلاس‌های دارایی', '24-hour asset-class change chart')}>
          <line x1="8" y1="70" x2="352" y2="70" stroke="var(--line-strong)" strokeWidth="1" />
          {chartRows.map((row, index) => {
            const x = 12 + index * xStep + xStep / 2;
            const height = Math.max(3, (Math.abs(row.avg) / max) * 46);
            const y = row.avg >= 0 ? 70 - height : 70;
            const tone = row.avg > 0 ? 'var(--up)' : row.avg < 0 ? 'var(--down)' : 'var(--text-3)';
            return (
              <g key={row.key}>
                <rect x={x - Math.min(20, xStep * 0.26)} y={y} width={Math.min(40, xStep * 0.52)} height={height} rx="6" fill={tone} opacity=".9" />
                <text x={x} y="90" textAnchor="middle" fill="var(--text-2)" fontSize="9">{label(row.key)}</text>
                <text x={x} y={row.avg >= 0 ? y - 6 : y + height + 13} textAnchor="middle" fill="var(--text-1)" fontSize="9.5" fontWeight="700">
                  {pctText(row.avg, isPersian)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : <div className="aig-insight-empty">{L('برای نمودار دادهٔ تغییر معتبر نیست.', 'No measured change data is available for the chart.')}</div>}

      {rows.length ? (
        <ul className="aig-move-list">
          {rows.map((r) => (
            <li key={r.key} className="aig-move-row">
              <span className="aig-move-name">
                <AigDir dir={dirOfPct(r.avg)} />
                {label(r.key)}
                {r.fallback ? <span className="aig-fallback-tag" title={r.fallback}>{L('میز دادهٔ کلان', 'macro desk')}</span> : null}
              </span>
              <span className="aig-move-breadth">{r.withChange ? `${isPersian ? faNum(`${r.advancing}/${r.withChange}`) : `${r.advancing}/${r.withChange}`} ${L('صعودی', 'up')}` : L('بدون ابزار', 'no instruments')}</span>
              <b className={`aig-move-avg ${dirOfPct(r.avg) === 'up' ? 'up' : dirOfPct(r.avg) === 'down' ? 'down' : 'flat'}`}>
                {pctText(r.avg, isPersian)}
              </b>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ECONOMIC OUTLOOK — criteria with an up/down icon, in Persian
   «باکسش خیلی شلوغه باید معیارها با آیکون بالا و پایین و فارسی باشد»
   ══════════════════════════════════════════════════════════════════════════ */
function EconomicOutlook({ outlook, L, isPersian }) {
  const signals = Array.isArray(outlook?.signals) ? outlook.signals : [];
  const labelFa = mapLabel(AIG_OUTLOOK, outlook?.label, isPersian) || String(outlook?.label || '').replace(/_/g, ' ');
  const scoreDir = Number(outlook?.score) > 0 ? 'up' : Number(outlook?.score) < 0 ? 'down' : 'flat';
  return (
    <div className={`aig-outlook ${outlook.label === 'GROWTH_WATCH' ? 'growth' : outlook.label === 'RECESSION_WATCH' ? 'recession' : ''}`}>
      <div className="aig-outlook-head">
        <div className="aig-section-title" style={{ marginBottom: 0 }}>
          <AigIcon name="globe" /> {L('چشم‌انداز اقتصادی', 'Economic outlook')}
        </div>
        <span className="aig-outlook-score">
          <AigDir dir={scoreDir} size={9} />
          {outlook.label !== 'UNAVAILABLE'
            ? `${labelFa}${outlook.score != null ? ` · ${isPersian ? faNum(`${outlook.score > 0 ? '+' : ''}${outlook.score}`) : `${outlook.score > 0 ? '+' : ''}${outlook.score}`}` : ''}`
            : L('دادهٔ کافی نیست', 'no data yet')}
        </span>
      </div>

      <div className="aig-outlook-now">
        <span className="aig-outlook-now-k">{L('وضعیت کنونی', 'now')}</span>
        <span className="aig-outlook-now-v">
          {outlook.currentState?.regime ? (mapLabel(AIG_REGIME, outlook.currentState.regime, isPersian) || outlook.currentState.regime) : '—'}
        </span>
      </div>

      {signals.map((s) => (
        <div key={s.id} className="aig-signal">
          <span className={`aig-signal-dir ${s.direction}`}>
            <AigDir dir={s.direction === 'supportive' ? 'up' : s.direction === 'cautionary' ? 'down' : 'flat'} size={9} />
            {mapLabel(AIG_DIRECTION, s.direction, isPersian) || s.direction}
          </span>
          <div className="aig-signal-body">
            <div className="aig-signal-name">
              {(isPersian && s.nameFa) ? s.nameFa : s.name}
              {s.source ? <span className="aig-signal-src">{sourceLabel(s.source, isPersian)}</span> : null}
            </div>
            <div className="aig-signal-ev">{(isPersian && s.evidenceFa) ? s.evidenceFa : s.evidence}</div>
          </div>
        </div>
      ))}

      <div className="aig-note">
        {L('ترکیب وزن‌دار خوانش‌های واقعی همین دور — داده، نه پیش‌بینی قطعی.', 'A weighted reading of this pass\u2019s real reads — data, not a guaranteed forecast.')}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   GLOBAL ECONOMY LEADERS — from what was actually read
   ──────────────────────────────────────────────────────────────────────────
   The four cards here were built from `classes.stocks.top/bottom`, i.e. the
   tokenised-equity venue. On a deployment where that venue is read-only or
   dark, all four rendered «دادهٔ معتبر این کارت هنوز خوانده نشده است» — four
   identical empty boxes under a heading promising the world's best and worst
   stocks. «داده‌ها موجود نیست … ببین با چی می‌شه عوض کرد».

   So the cards now rank what the pass DID read: the macro desk's real quotes
   (dollar, gold, crude, the equity index, the 10-year yield), the yield curve,
   and the labelled smart-money outflows — and only fall back to the equity
   venue's own movers when that class was genuinely read. A card whose input
   was not read still says so; it never borrows a number from another card.
   ══════════════════════════════════════════════════════════════════════════ */
function LeaderCard({ icon, title, row, empty, tone = 'var(--rgb-2)' }) {
  return (
    <div className="aig-insight-card" style={{ '--insight-tone': tone }}>
      <div className="aig-insight-kicker">
        <span className="aig-insight-icon" aria-hidden="true"><AigIcon name={icon} size={17} /></span>
        <span>{title}</span>
      </div>
      {row ? (
        <>
          <div className="aig-insight-symbol">
            <AigDir dir={row.dir} />
            <span>{row.symbol}</span>
            {row.name ? <span className="aig-insight-name">{row.name}</span> : null}
          </div>
          <div className={`aig-insight-value ${row.dir === 'up' ? 'up' : row.dir === 'down' ? 'down' : 'flat'}`}>{row.value}</div>
          <div className="aig-insight-meta">{row.meta}</div>
        </>
      ) : (
        <div className="aig-insight-empty">{empty}</div>
      )}
    </div>
  );
}

function EconomyLeaders({ cross, domains, L, isPersian }) {
  const indicators = (Array.isArray(cross?.macro?.indicators) ? cross.macro.indicators : [])
    .filter((q) => q && Number.isFinite(Number(q.change1dPct)));
  const sorted = indicators.slice().sort((a, b) => Number(b.change1dPct) - Number(a.change1dPct));
  const best = sorted[0] || null;
  const worst = sorted[sorted.length - 1] || null;
  const pct = (v) => pctText(v, isPersian);
  const nameOf = (q) => (isPersian ? macroName(q, true) : (q?.name || ''));
  const flowMeta = (r) => [
    r.chain ? (mapLabel(AIG_CHAIN, String(r.chain).toLowerCase(), isPersian) || r.chain) : null,
    r.signal ? (mapLabel(AIG_FLOW, String(r.signal).toLowerCase(), isPersian) || r.signal) : null
  ].filter(Boolean).join(' · ');

  /* the equity index the macro desk reads (SPX futures), else the equity class */
  const equity = indicators.find((q) => q.kind === 'equity') || null;
  const stocksClass = cross?.classes?.stocks;
  const stockTop = (stocksClass?.top || [])[0] || null;
  const stockBottom = (stocksClass?.bottom || [])[0] || null;
  const curve = cross?.macro?.curve;

  const smartTokens = domains?.smart_money?.data?.topTokens || [];
  const outflows = smartTokens
    .map((r) => ({ ...r, amount: Number(r.exchangeOutflowUsd) }))
    .filter((r) => r.symbol && Number.isFinite(r.amount) && r.amount > 0);
  const hiOut = outflows.slice().sort((a, b) => b.amount - a.amount)[0] || null;
  const loOut = outflows.slice().sort((a, b) => a.amount - b.amount)[0] || null;
  const unread = L('در این دور خوانده نشد.', 'Not read in this pass.');

  return (
    <>
      <div className="aig-section-title" style={{ marginTop: 4 }}>
        <AigIcon name="trophy" /> {L('برترین‌های اقتصاد جهانی', 'Global economy leaders')}
      </div>
      <div className="aig-insight-grid">
        <LeaderCard
          icon="chart" tone="var(--up)"
          title={L('بیشترین رشد ۲۴ ساعته', 'Biggest 24h gainer')}
          row={best ? {
            symbol: best.symbol, name: nameOf(best), dir: dirOfPct(best.change1dPct),
            value: pct(best.change1dPct),
            meta: `${L('۷ روز', '7d')}: ${best.change7dPct != null ? pct(best.change7dPct) : '—'}${best.source ? ` · ${best.source}` : ''}`
          } : null}
          empty={unread}
        />
        <LeaderCard
          icon="warning" tone="var(--down)"
          title={L('بیشترین افت ۲۴ ساعته', 'Biggest 24h decline')}
          row={worst && worst.symbol !== best?.symbol ? {
            symbol: worst.symbol, name: nameOf(worst), dir: dirOfPct(worst.change1dPct),
            value: pct(worst.change1dPct),
            meta: `${L('۷ روز', '7d')}: ${worst.change7dPct != null ? pct(worst.change7dPct) : '—'}${worst.source ? ` · ${worst.source}` : ''}`
          } : null}
          empty={unread}
        />
        <LeaderCard
          icon="layers" tone="var(--rgb-1)"
          title={L('شاخص سهام', 'Equity index')}
          row={equity ? {
            symbol: equity.symbol, name: nameOf(equity), dir: dirOfPct(equity.change1dPct),
            value: equity.priceUsd != null ? numText(equity.priceUsd, isPersian) : pct(equity.change1dPct),
            meta: `${L('۲۴ ساعت', '1d')} ${pct(equity.change1dPct)}${equity.change7dPct != null ? ` · ${L('۷ روز', '7d')} ${pct(equity.change7dPct)}` : ''}`
          } : stockTop ? {
            symbol: stockTop.symbol, name: isPersian ? '' : (stockTop.name || ''), dir: dirOfPct(stockTop.changePct),
            value: pct(stockTop.changePct),
            meta: L('از فید سهام همین دور', 'from this pass\u2019s equity feed')
          } : null}
          empty={L('شاخص سهامی در این دور خوانده نشد.', 'No equity index was read in this pass.')}
        />
        <LeaderCard
          icon="curve" tone="var(--rgb-5)"
          title={L('منحنی بازده آمریکا', 'US yield curve')}
          row={curve && Number.isFinite(Number(curve.spreadPct)) ? {
            symbol: '2s10s', name: L('اختلاف ۲ و ۱۰ ساله', '2y vs 10y spread'),
            dir: Number(curve.spreadPct) < 0 ? 'down' : 'up',
            value: isPersian
              ? `${faNum(`${Number(curve.spreadPct) > 0 ? '+' : ''}${curve.spreadPct}`)} ${L('واحد درصد', 'pp')}`
              : `${Number(curve.spreadPct) > 0 ? '+' : ''}${curve.spreadPct}pp`,
            meta: Number(curve.spreadPct) < 0
              ? L('وارون — نشانهٔ کلاسیک فشار رکودی', 'inverted — the classic recession-pressure signal')
              : L('طبیعی', 'positive')}
          : null}
          empty={L('منحنی بازده خوانده نشد.', 'The yield curve was not read.')}
        />
        <LeaderCard
          icon="wallet" tone="var(--down)"
          title={L('بیشترین خروج پول', 'Highest observed outflow')}
          row={hiOut ? {
            symbol: hiOut.symbol, name: isPersian ? '' : (hiOut.name || ''), dir: 'down',
            value: `$${isPersian ? faNum(fmtK(hiOut.amount)) : fmtK(hiOut.amount)}`,
            meta: flowMeta(hiOut) || L('جریان برچسب‌خورده', 'labelled flow')
          } : null}
          empty={L('خروجی معتبر در این بازه خوانده نشد.', 'No measured outflow was read in this window.')}
        />
        <LeaderCard
          icon="coin" tone="var(--rgb-2)"
          title={L('کمترین خروج پول', 'Lowest observed outflow')}
          row={loOut && loOut.symbol !== hiOut?.symbol ? {
            symbol: loOut.symbol, name: isPersian ? '' : (loOut.name || ''), dir: 'down',
            value: `$${isPersian ? faNum(fmtK(loOut.amount)) : fmtK(loOut.amount)}`,
            meta: flowMeta(loOut) || L('جریان برچسب‌خورده', 'labelled flow')
          } : null}
          empty={L('خروجی معتبر در این بازه خوانده نشد.', 'No measured outflow was read in this window.')}
        />
      </div>
      {stockBottom ? (
        <div className="aig-note">
          {L('ضعیف‌ترین سهم خوانده‌شده: ', 'Weakest equity read: ')}{stockBottom.symbol} {pct(stockBottom.changePct)}
        </div>
      ) : null}
      <div className="aig-note">
        {L('این کارت‌ها فقط از ابزارهایی ساخته شده‌اند که منبع در همین دور خوانده است؛ نبود داده به‌صورت «خوانده نشد» نمایش داده می‌شود، نه با مقدار ساختگی.', 'These cards use only instruments read by the connected sources in this pass; missing data stays explicitly unread rather than becoming a fabricated value.')}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ONE SYSTEM ANALYSIS — lines with direction, and the AI synthesis inside it
   ──────────────────────────────────────────────────────────────────────────
   «این باکس را حذف کن و دوتا داده را داخل تحلیل سیستمی باشد و تکراری نباشد»
   — there were two stacked analysis boxes (the deterministic narrative and
   the model's synthesis) saying the same thing twice, and the narrative itself
   was one run-on paragraph mixing Persian copy with English symbol names.
   There is one box now: an ordered line per measured fact, each with its
   up/down/neutral marker, and — when a model answered — its synthesis as a
   clearly labelled part of the SAME box.
   ══════════════════════════════════════════════════════════════════════════ */
function SystemAnalysis({ cross, L, isPersian }) {
  const lines = Array.isArray(cross?.narrativeLines?.[isPersian ? 'fa' : 'en'])
    ? cross.narrativeLines[isPersian ? 'fa' : 'en']
    : [];
  const fallbackText = cross?.narrative?.[isPersian ? 'fa' : 'en'] || null;
  const commentary = cross?.commentary;
  const hasCommentary = commentary?.status === 'OK' && commentary.text;
  if (!lines.length && !fallbackText && !hasCommentary) return null;
  return (
    <div className="aig-narrative">
      <div className="aig-narrative-title">
        <AigIcon name="spark" size={15} /> {L('تحلیل سیستمی', 'System analysis')}
      </div>

      {lines.length ? (
        <ul className="aig-analysis-lines">
          {lines.map((line, i) => (
            <li key={`${line.id}-${i}`} className={`aig-analysis-line ${line.dir === 'up' ? 'is-up' : line.dir === 'down' ? 'is-down' : 'is-flat'}`}>
              <AigDir dir={line.dir} />
              <span className="aig-analysis-text">{line.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        /* An older server answers with the paragraph only — render it rather
           than showing an empty box. */
        <div className="aig-narrative-text">{fallbackText}</div>
      )}

      {hasCommentary ? (
        <div className="aig-analysis-ai">
          <div className="aig-narrative-title" style={{ marginTop: 0 }}>
            <AigIcon name="spark" size={14} /> {L('جمع‌بندی هوش مصنوعی', 'AI synthesis')}
            <span className="aig-commentary-provider">{commentary.providerName || commentary.provider || 'AI'}</span>
          </div>
          <div className="aig-narrative-text">{commentary.text}</div>
        </div>
      ) : commentary && commentary.status !== 'OK' && commentary.reason && commentary.reason !== 'NO_AI_PROVIDER' && commentary.reason !== 'NO_CROSS_ASSET_DATA' ? (
        <div className="aig-narrative-note">
          {L('تحلیل هوش مصنوعی: ', 'AI commentary: ')}{reasonLabel(commentary.reason, isPersian)}
        </div>
      ) : null}

      <div className="aig-narrative-note">
        {L('ساخته‌شده بر فراز اعداد واقعی همین دور — داده است، نه دستور.', 'Built over this pass\u2019s real reads — data, not authority.')}
      </div>
    </div>
  );
}

function AiGlobalIntelligenceInner() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState('briefing');
  const [data, setData] = useState({ intelligence: null, briefing: null, cross: null, providers: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const requestId = useRef(0);
  const language = String(i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const isPersian = language === 'fa';
  const isRTL = ['fa', 'ar', 'ur'].includes(language);
  const L = (fa, en) => (isPersian ? fa : en);

  const load = useCallback(async (refresh = false) => {
    const id = ++requestId.current;
    const readJson = async (path) => {
      // Relative /api URLs resolve against Capacitor's https://localhost in
      // Android. Resolve through the shared native-aware base so the embedded
      // News tab and the standalone route read the same backend.
      const response = await fetch(`${apiBase()}${path}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || 'INVALID_RESPONSE');
      return payload;
    };
    try {
      if (refresh) setRefreshing(true);
      setConnectionError(null);
      const qs = refresh ? `?refresh=1&lang=${language}` : `?lang=${language}`;
      const [intel, brief, crossAsset, providerState] = await Promise.all([
        readJson(`/ai/global/intelligence${qs}`),
        readJson(`/ai/global/briefing${qs}`),
        readJson(`/ai/global/cross-asset${qs}`),
        readJson('/ai/global/providers')
      ]);
      if (id !== requestId.current) return;
      setData({
        intelligence: intel.globalIntelligence || null,
        briefing: brief.briefing || null,
        cross: crossAsset || null,
        providers: providerState.providers || intel.globalIntelligence?.providers || null
      });
    } catch (error) {
      if (id === requestId.current) setConnectionError(error?.message || 'NETWORK_ERROR');
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [language]);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(false), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const domains = useMemo(() => data.intelligence?.domains || null, [data.intelligence]);
  const briefingItems = useMemo(() => data.briefing?.items || [], [data.briefing]);
  const cross = data.cross?.crossAsset || null;

  const statusColor = (status) => (status === 'OK' ? '#22c55e' : status === 'PARTIAL' ? '#eab308' : '#6b7280');
  const regimeClass = cross?.regime?.regime ? String(cross.regime.regime).toLowerCase() : 'partial';

  /* ── per-domain one-line summaries (only what was actually read) ─────── */
  const domainValue = (key, d) => {
    if (!d || d.status === 'UNAVAILABLE') return { value: L('خوانده نشد', 'unread'), sub: d?.reason || null, bad: true };
    const v = d.data || {};
    switch (key) {
      case 'smart_money': {
        const net = v.accumulationUsd != null && v.distributionUsd != null ? v.accumulationUsd - v.distributionUsd : null;
        return {
          value: net != null ? `${net >= 0 ? '+' : '−'}$${fmtK(Math.abs(net))}` : '—',
          sub: `${v.whaleActivity?.count ?? '—'} ${L('رویداد نهنگ', 'whale events')} · ${v.window || '24h'}`
        };
      }
      case 'whales':
        return { value: `${v.count ?? '—'}`, sub: v.events?.[0] ? `${v.events[0].symbol} $${fmtK(v.events[0].valueUsd)}` : null };
      case 'onchain':
        return { value: `${v.healthySources ?? 0}/${(v.sources || []).length}`, sub: v.downSources ? `${v.downSources} ${L('منبع خاموش', 'sources down')}` : L('همه سالم', 'all healthy') };
      case 'news':
        return { value: `${v.count ?? 0}`, sub: v.items?.[0] ? String(v.items[0].title).slice(0, 46) : null };
      case 'macro': {
        /* Phase 211.1 — the macro card shows BOTH sides of the domain: the
           classified headline topics (politics included) and, when a source
           answered, the real quote moves (dollar/gold/crude…). */
        const topics = Object.entries(v.byTopic || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t, n]) => `${mapLabel(AIG_TOPIC, t, isPersian) || t}×${n}`).join(' · ');
        const quotes = Array.isArray(v.instruments) ? v.instruments : (Array.isArray(v.quotes) ? v.quotes : []);
        const qmover = quotes
          .filter((q) => q.change1dPct != null)
          .sort((a, b) => Math.abs(b.change1dPct) - Math.abs(a.change1dPct))[0];
        const qSub = qmover ? `${qmover.symbol} ${qmover.change1dPct > 0 ? '+' : ''}${qmover.change1dPct}%` : null;
        return {
          value: `${v.attention ?? 0}${quotes.length ? `+${quotes.length}` : ''}`,
          sub: [topics, qSub].filter(Boolean).join(' · ') || null
        };
      }
      case 'stocks':
      case 'forex':
      case 'commodities':
      case 'rwa': {
        const inst = v.instruments || [];
        const withChange = inst.filter((i) => i.change24hPct != null);
        const top = withChange.sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))[0];
        return {
          value: `${inst.length}`,
          sub: top ? `${top.symbol} ${top.change24hPct > 0 ? '+' : ''}${top.change24hPct.toFixed(1)}%` : L('بدون تغییر ۲۴س', 'no 24h change'),
          note: L('دسترس فقط‌خواندنی', 'read-only venue')
        };
      }
      default:
        return { value: '—', sub: null };
    }
  };

  return (
    <div className="ai-global" dir={isRTL ? 'rtl' : 'ltr'}>
      <style>{STYLES}</style>

      <div className="aig-header">
        <ThinkingOrb state={loading || refreshing ? 'working' : 'idle'} size={26} />
        <div className="aig-title">{L('هوش جهانی FBT', 'FBT Global Intelligence')}</div>
        {data.intelligence && (
          <span className={`aig-chip ${data.intelligence.available >= 5 ? '' : data.intelligence.available >= 1 ? 'warn' : 'bad'}`}>
            {data.intelligence.available}/9 {L('دامنه زنده', 'domains live')}
          </span>
        )}
      </div>

      <div className="aig-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`aig-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="aig-sr">{t.marker}</span><span className="aig-tab-icon"><TabIcon name={t.icon} /></span><span>{t.id === 'briefing' ? L('گزارش وضعیت', 'Briefing')
              : t.id === 'domains' ? L('حوزه‌های داده', 'Domains')
              : t.id === 'cross' ? L('اقتصاد و دارایی', 'Cross-asset')
              : L('ارائه‌دهندگان', 'Providers')}</span>
          </button>
        ))}
      </div>
      <button type="button" className="aig-refresh" onClick={() => load(true)} disabled={refreshing}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
          <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
        {refreshing ? L('در حال دریافت داده…', 'Reading live data…') : L('به‌روزرسانی داده‌های زنده', 'Refresh live data')}
      </button>
      {connectionError ? (
        <div className="aig-connection" role="status">
          <span aria-hidden="true">●</span>
          <span>{L('ارتباط با سرور برقرار نشد. برای تلاش دوباره، به‌روزرسانی را بزنید.', 'Server connection failed. Tap refresh to try again.')}</span>
        </div>
      ) : null}

      {/* ── BRIEFING — the proactive layer ─────────────────────────────── */}
      {tab === 'briefing' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--rgb-2)'}}><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><polyline points="14 2 14 8 20 8"/><path d="M2 15h10"/><path d="M2 19h6"/><path d="M12 11h6"/><path d="M12 15h4"/></svg>
            {L('بریفینگ فعال هوش مصنوعی', 'Proactive AI briefing')}
            {data.briefing?.at ? <span className="aig-item-kind">{timeAgo(data.briefing.at, isRTL)}</span> : null}
          </div>
          {briefingItems.length ? briefingItems.map((item) => (
            <div key={item.id} className="aig-item">
              <div className="aig-item-top">
                <span className={`aig-prio ${item.priority}`}>{mapLabel(AIG_PRIORITY, item.priority, isPersian) || String(item.priority || '').toUpperCase()}</span>
                <span className="aig-item-kind">{mapLabel(AIG_KIND, item.kind, isPersian) || item.kind}</span>
              </div>
              <div className="aig-item-title">{isPersian && item.titleFa ? item.titleFa : item.title}</div>
              {(isPersian && item.detailFa ? item.detailFa : item.detail) ? <div className="aig-item-detail">{isPersian && item.detailFa ? item.detailFa : item.detail}</div> : null}
              <div className="aig-item-meta">
                <span>{sourceLabel(item.source, isPersian)}</span>
                {item.confidence != null ? <span>· {Math.round(item.confidence * 100)}%</span> : null}
                {item.untrusted ? <span>· {L('داده، نه دستور', 'data, not authority')}</span> : null}
                {item.action?.to ? (
                  <span
                    className="aig-item-action"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(item.action.to)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(item.action.to)}
                  >
                    {L('باز کن', 'open')} →
                  </span>
                ) : null}
              </div>
            </div>
          )) : (
            <div className="aig-empty">
              {L(
                'هنوز چیزی برای گفتن نیست — مغز مالی فقط از چیزی که واقعاً خوانده حرف می‌زند.',
                'Nothing to report yet — the financial brain only speaks from what it actually read.'
              )}
              {data.briefing?.missing?.length ? (
                <div className="aig-note">{L('ورودی‌های خوانده‌نشده:', 'unread inputs:')} {data.briefing.missing.map((m) => mapLabel(AIG_MISSING, m, isPersian) || m).join(isPersian ? '، ' : ', ')}</div>
              ) : null}
            </div>
          )}
          <div className="aig-note">
            {L(
              'بریفینگ یک توصیه به خواندن است؛ هیچ موردی مجوز اجرا ندارد. هر عدد از منبع خودش آمده.',
              'A briefing is a recommendation to read — no item carries execution permission. Every number cites its source.'
            )}
          </div>
        </div>
      )}

      {/* ── DOMAINS — the nine intelligence domains ────────────────────── */}
      {tab === 'domains' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--rgb-1)'}}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
            {L('حوزه‌های داده هوش جهانی', 'Global intelligence domains')}
          </div>
          {domains ? (
            <div className="aig-grid">
              {Object.keys(DOMAIN_META).map((key) => {
                const d = domains[key];
                const meta = DOMAIN_META[key];
                const summary = domainValue(key, d);
                return (
                  <div key={key} className="aig-card">
                    <div className="aig-card-name">
                      <span className="aig-card-dot" style={{ background: statusColor(d?.status) }} />
                      <AigIcon name={meta.icon} size={15} /> {isPersian ? meta.fa : meta.en}
                    </div>
                    <div className="aig-card-value">{summary.value}</div>
                    {summary.sub && !summary.bad ? <div className="aig-card-sub">{summary.sub}</div> : null}
                    {summary.bad && summary.sub ? <div className="aig-reason" title={summary.sub}>{reasonLabel(summary.sub, isPersian)}</div> : null}
                    {summary.note ? <div className="aig-card-sub">{summary.note}</div> : null}
                    {d?.data?.stale === true ? <div className="aig-card-sub">{L('آخرین دادهٔ موفق', 'last good data')}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="aig-empty">{L('اسنپ‌شات جهانی هنوز خوانده نشده.', 'The global snapshot has not been read yet.')}</div>
          )}
          <div className="aig-note">
            {L(
              'دامنه «خوانده نشد» یعنی دقیقاً همان — سیستم هیچ عددی را حدس نمی‌زند.',
              'An «unread» domain means exactly that — the system never guesses a number.'
            )}
          </div>
        </div>
      )}

      {/* ── CROSS-ASSET — regime, breadth, divergences ─────────────────── */}
      {tab === 'cross' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--up)'}}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>
            {L('تحلیل اقتصاد و دارایی‌ها', 'Cross-asset intelligence')}
          </div>
          {cross && cross.status !== 'UNAVAILABLE' ? (
            <>
              <div className={`aig-regime ${regimeClass}`}>
                <div className="aig-regime-label">
                  {cross.regime?.regime ? (mapLabel(AIG_REGIME, cross.regime.regime, isPersian) || String(cross.regime.regime).replace(/_/g, ' ')) : L('ترکیبی', 'MIXED')}
                </div>
                <div className="aig-regime-sub">
                  {cross.observedClasses?.length
                    ? `${cross.observedClasses.map((c) => mapLabel(AIG_CLASS, c, isPersian) || c).join(' · ')} — ${L('میانگین تغییر ۲۴ ساعته واقعی هر کلاس', 'real per-class average 24h change')}`
                    : L('کلاس کافی برای رژیم نیست', 'not enough classes for a regime')}
                </div>
              </div>

              {/* ── ONE CARD: the class chart AND the per-class readings ──
                     «باکس رمز ارز و نمودار پایینی داخل یک باکس باشد» — the
                     tiles and the chart were two boxes repeating the same
                     numbers; they are one card now. ────────────────────── */}
              <CrossAssetMovement cross={cross} L={L} isPersian={isPersian} />

              {/* ── THE ECONOMIC OUTLOOK (Phase 211.1) — criteria in Persian,
                     each with its own up/down/neutral marker ──────────── */}
              {cross.outlook && (cross.outlook.label || cross.outlook.signals?.length) ? (
                <EconomicOutlook outlook={cross.outlook} L={L} isPersian={isPersian} />
              ) : null}

              {/* ── THE SYSTEM ANALYSIS — one box: the measured lines and,
                     when a provider answered, its synthesis inside it.
                     «این باکس را حذف کن و دوتا داده را داخل تحلیل سیستمی
                     باشد و تکراری نباشد» ─────────────────────────────── */}
              <SystemAnalysis cross={cross} L={L} isPersian={isPersian} />

              {/* ── the global-economy leaders, built from the instruments
                     this pass actually read ──────────────────────────── */}
              <EconomyLeaders cross={cross} domains={domains} L={L} isPersian={isPersian} />

              {/* ── the macro indicator layer — real quotes (dollar/gold/
                     crude/equity/rates/curve) with 1d + 7d changes ─────── */}
              {cross.macro?.indicators?.length ? (
                <>
                  <div className="aig-section-title" style={{ marginTop: 10, marginBottom: 6 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--rgb-5)"}}><path d="M2 22h20"/><path d="M4 22V10"/><path d="M8 22V10"/><path d="M12 22V10"/><path d="M16 22V10"/><path d="M20 22V10"/><path d="M2 10l10-8 10 8"/></svg> {L('شاخص‌های اقتصاد کلان (۲۴س و ۷روز)', 'Macro indicators (1d / 7d)')}</div>
                  <div className="aig-grid">
                    {cross.macro.indicators.map((q) => {
                      /* The ticker stays the source's own symbol; the human
                         name and the numbers follow the box's language, so a
                         Persian line never mixes «+0.8% 1d» into RTL copy. */
                      const shown = isPersian ? macroName(q, true) : (q.name || '');
                      return (
                      <div key={q.symbol} className="aig-card">
                        <div className="aig-card-name">{q.symbol}{shown ? <span style={{ color: 'var(--text-3)' }}> {shown}</span> : null}</div>
                        <div className="aig-card-value" style={{ fontSize: 'var(--fs-md)' }}>
                          {q.priceUsd != null
                            ? (isPersian
                              ? numText(q.priceUsd, true, q.priceUsd >= 100 ? 1 : 2)
                              : (q.priceUsd >= 100 ? q.priceUsd.toFixed(1) : q.priceUsd.toFixed(2)))
                            : '—'}
                        </div>
                        <div className="aig-card-sub">
                          <span className="aig-ind-chg" style={{ color: q.change1dPct > 0 ? '#4ade80' : q.change1dPct < 0 ? '#f87171' : 'var(--text-2)' }}>
                            {q.change1dPct != null
                              ? (isPersian ? `${pctText(q.change1dPct, true)} ${L('۲۴س', '1d')}` : `${q.change1dPct > 0 ? '+' : ''}${q.change1dPct}% 1d`)
                              : L('۱روز: —', '1d: —')}
                          </span>
                          {' · '}
                          <span className="aig-ind-chg" style={{ color: q.change7dPct > 0 ? '#4ade80' : q.change7dPct < 0 ? '#f87171' : 'var(--text-2)' }}>
                            {q.change7dPct != null
                              ? (isPersian ? `${pctText(q.change7dPct, true)} ${L('۷روز', '7d')}` : `${q.change7dPct > 0 ? '+' : ''}${q.change7dPct}% 7d`)
                              : L('۷روز: —', '7d: —')}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  {cross.macro.curve ? (
                    <div className="aig-note" style={{ color: cross.macro.curve.spreadPct < 0 ? 'var(--down)' : 'var(--text-2)' }}>
                      {L('منحنی بهره ۲/۱۰: ', '2s10s curve: ')}
                      {isPersian
                        ? `${faNum(cross.macro.curve.spreadPct)} ${L('واحد درصد', 'pp')}`
                        : `${cross.macro.curve.spreadPct}pp`}
                      {cross.macro.curve.spreadPct < 0
                        ? ` — ${L('منحنی وارون؛ نشانهٔ کلاسیک ریسک رکود', 'inverted — the classic recession-risk gauge')}`
                        : ` — ${L('منحنی طبیعی', 'positive')}`}
                    </div>
                  ) : null}
                </>
              ) : null}
              {cross.divergences?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div className="aig-section-title" style={{ marginBottom: 6 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--rgb-1)"}}><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> {L('واگرایی‌های بازار', 'Market divergences')}</div>
                  {cross.divergences.map((d, i) => (
                    <div key={i} className="aig-item-detail" style={{ marginBottom: 4 }}>
                      {mapLabel(AIG_CLASS, d.classes[0], isPersian) || d.classes[0]} {pctText(d.avgChangePct[d.classes[0]], isPersian)}
                      {' × '}
                      {mapLabel(AIG_CLASS, d.classes[1], isPersian) || d.classes[1]} {pctText(d.avgChangePct[d.classes[1]], isPersian)}
                      {isPersian ? ` (شکاف ${faNum(d.gapPct)} واحد درصد)` : ` (${d.gapPct}pp)`}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="aig-note">
                {cross.correlations?.UNAVAILABLE
                  ? L('همبستگی فقط با سری زمانی جفتی واقعی محاسبه می‌شود؛ یک اسنپ‌شات همبستگی تولید نمی‌کند.', 'Correlations need real paired history; one snapshot cannot produce one.')
                  : null}
                {cross.readOnlyClasses?.length
                  ? ` · ${L('کلاس‌های فقط-خواندنی: ', 'read-only classes: ')}${cross.readOnlyClasses.map((c) => mapLabel(AIG_CLASS, c, isPersian) || c).join(isPersian ? '، ' : ', ')}`
                  : null}
              </div>
            </>
          ) : (
            <div className="aig-empty">
              {cross?.missing?.length
                ? `${L('کلاس‌های خوانده‌نشده:', 'unread classes:')} ${cross.missing.map((c) => `${mapLabel(AIG_CLASS, c, isPersian) || mapLabel(AIG_MISSING, c, isPersian) || c}${cross.missingReasons?.[c] ? ` (${reasonLabel(cross.missingReasons[c], isPersian)})` : ''}`).join(isPersian ? '، ' : ', ')}`
                : L('تحلیل کراس-است هنوز محاسبه نشده.', 'Cross-asset analysis has not been computed yet.')}
              {cross?.narrative?.[isPersian ? 'fa' : 'en'] ? (
                <div className="aig-narrative" style={{ marginTop: 12, textAlign: 'start' }}>
                  <div className="aig-narrative-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--rgb-3)"}}><path d="M2 10a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10Z"/><path d="M12 2v4"/><path d="M8 2v4"/><path d="M16 2v4"/></svg> {L('تحلیل سیستمی', 'System analysis')}</div>
                  <div className="aig-narrative-text">{cross.narrative[isPersian ? 'fa' : 'en']}</div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ── PROVIDERS — the five readiness lights per domain ───────────── */}
      {tab === 'providers' && (
        <div className="aig-section">
          <div className="aig-section-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--rgb-4)"}}><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg> {L('وضعیت پایداری منابع داده', 'Data provider status')}</div>
          {data.providers ? (
            <>
              {Object.entries(data.providers).map(([name, p]) => (
                <div key={name} className="aig-light">
                  <span className="aig-light-name">
                    {DOMAIN_META[name]?.icon ? <AigIcon name={DOMAIN_META[name].icon} size={14} /> : <span aria-hidden="true">•</span>} {DOMAIN_META[name] ? (isPersian ? DOMAIN_META[name].fa : DOMAIN_META[name].en) : name}
                    {p.reason ? <div className="aig-reason" title={p.reason}>{reasonLabel(p.reason, isPersian)}</div> : null}
                  </span>
                  <span className="aig-light-lamps" title={L('پیاده‌سازی · پیکربندی · دسترس‌پذیری ارائه‌دهنده · آمادهٔ اجرا · زنده', 'implemented · configured · provider_available · runtime_ready · live')}>
                    {['implemented', 'configured', 'provider_available', 'runtime_ready', 'live'].map((k) => (
                      <span key={k} className={`aig-lamp ${p[k] ? 'on' : 'off'}`} />
                    ))}
                  </span>
                </div>
              ))}
              <div className="aig-note">
                {L(
                  'پنج چراغ: پیاده‌سازی · پیکربندی · دسترس‌پذیری ارائه‌دهنده · آمادهٔ اجرا · زنده. «زنده» یعنی نتیجهٔ واقعی در همین فرایند.',
                  'Five lamps: implemented · configured · provider_available · runtime_ready · live. «live» means a real result in this process.'
                )}
              </div>
            </>
          ) : (
            <div className="aig-empty">{L('وضعیت ارائه‌دهنده‌ها هنوز خوانده نشده.', 'Provider status has not been read yet.')}</div>
          )}
        </div>
      )}
    </div>
  );
}

export const AiGlobalIntelligence = memo(AiGlobalIntelligenceInner);
export default AiGlobalIntelligence;
