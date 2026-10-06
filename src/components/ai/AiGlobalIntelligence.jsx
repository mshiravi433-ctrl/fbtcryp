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
 * 2026-10: this surface is now its own page — «جهانی» in the More sheet, at
 * /global (and /ai-global for existing deep links). It is no longer a News tab.
 * Every rendering talks to the FI's own additive endpoints under
 * /api/ai/global/*.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThinkingOrb } from './ThinkingOrb.jsx';
import { apiBase } from '../../lib/apiBase';
import { getCapitalFlows } from '../../lib/capitalFlows';
/*
 * «FBT جهانی» WORLD CONSOLE upgrade — seven new sub-tabs (world state, globe,
 * radar, causal, capital-flow map, future tree + challenger, market DNA), all
 * derived from the payload this panel ALREADY fetched: the upgrade adds
 * surface, not traffic. The single extra request is the causal tab's lazy,
 * once-per-session read of the server's own /deep/macro-graph engine.
 */
import {
  WORLD_STYLES, GLOBAL_PAGE_STYLES, WorldStatePanel, GlobePanel, RadarPanel,
  CausalPanel, FlowMapPanel, FutureTreePanel, DnaPanel,
  OutlookPanel, DomainsView, ProvidersPanel, HeroPanel, BriefingPanel,
  TabIcon as WorldTabIcon, TAB_ACCENTS, faNum as worldFaNum
} from './worldState/WorldPanels.jsx';
import { buildBriefingTiles } from './worldState/worldModel.js';

/* ── Styles (scoped, same visual language as the AI control center) ────── */
const STYLES = `
  /* ══════════════════════════════════════════════════════════════════════
     FBT GLOBAL INTELLIGENCE — the modernised surface.
     ──────────────────────────────────────────────────────────────────────
     REPORTED: «در صفحه اخبار تب هوش جهانی fbt را خیلی مدرن‌تر و بی‌نظیرتر کن».

     The old sheet was correct and flat: one bordered box per band, eleven
     identical raised cards, a tab strip of four 64px buttons. Everything had
     the same weight, so nothing had any. What changed here is HIERARCHY and
     MATERIAL, not the data:

       · a hero that states the one thing the screen is for — how many of the
         nine domains answered — with the count as a meter, not a sentence;
       · one accent per band (cyan → violet → mint), carried by a hairline
         gradient border instead of a heavier box;
       · cards that lift on hover and press on touch, because a grid of tiles
         that never reacts reads as an image;
       · spacing and line-height sized for Persian copy (1.8–1.9 on body
         lines), which is what made the old 11px/1.45 text feel cramped.

     Every class name below is the one the component already renders, so this
     is a re-skin — no element moved, nothing that reads the DOM had to change.
     ══════════════════════════════════════════════════════════════════════ */
  .ai-global {
    width:100%; max-width:100%; box-sizing:border-box;
    padding:12px 14px 28px; min-height:100%; color:var(--text-1);
    overflow:hidden;
    background:
      radial-gradient(120% 40% at 100% -6%, color-mix(in srgb,var(--rgb-2) 9%,transparent), transparent 62%),
      radial-gradient(120% 40% at 0% -6%, color-mix(in srgb,var(--rgb-1) 9%,transparent), transparent 62%);
  }

  /* ── the hero: what the screen is, and how alive it is ───────────────── */
  .aig-header {
    position:relative; display:flex; align-items:center; gap:13px;
    margin-bottom:14px; padding:16px 15px;
    border:1px solid color-mix(in srgb,var(--rgb-1) 24%,var(--line));
    border-radius:24px;
    background:
      radial-gradient(130% 130% at 100% 0%, color-mix(in srgb,var(--rgb-2) 20%,transparent), transparent 58%),
      radial-gradient(130% 130% at 0% 0%, color-mix(in srgb,var(--rgb-1) 18%,transparent), transparent 60%),
      linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.012));
    box-shadow:0 24px 56px -42px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.05);
    overflow:hidden;
  }
  .aig-header::after {
    content:""; position:absolute; width:150px; height:150px;
    inset-inline-end:-50px; top:-70px; border-radius:50%;
    background:var(--rgb-2); opacity:.2; filter:blur(30px); pointer-events:none;
  }
  .aig-live {
    position:relative; z-index:1; flex:0 0 auto; display:grid; place-items:center;
    width:46px; height:46px; border-radius:16px;
    border:1px solid color-mix(in srgb,var(--rgb-1) 30%,transparent);
    background:linear-gradient(140deg, color-mix(in srgb,var(--rgb-1) 18%,transparent), color-mix(in srgb,var(--rgb-2) 16%,transparent));
    box-shadow:0 0 22px -6px color-mix(in srgb,var(--rgb-1) 60%,transparent);
  }
  .aig-live.is-working { animation:aig-breathe 2.6s ease-in-out infinite; }
  @keyframes aig-breathe { 0%,100% { box-shadow:0 0 20px -8px color-mix(in srgb,var(--rgb-1) 60%,transparent); } 50% { box-shadow:0 0 30px -4px color-mix(in srgb,var(--rgb-1) 80%,transparent); } }
  .aig-header-copy { position:relative; z-index:1; min-width:0; flex:1; }
  .aig-title { font-size:var(--fs-lg); line-height:1.35; font-weight:900; letter-spacing:-0.02em; color:var(--text-1); }
  .aig-sub { margin-top:5px; font-size:11px; line-height:1.9; color:var(--text-3); font-weight:650; }
  .aig-chip {
    position:relative; z-index:1; flex:0 0 auto;
    font-size:var(--fs-xs); font-weight:800;
    color:var(--rgb-2);
    background:color-mix(in srgb,var(--rgb-2) 13%,transparent);
    border:1px solid color-mix(in srgb,var(--rgb-2) 30%,transparent);
    padding:6px 10px; border-radius:999px; white-space:nowrap;
  }
  .aig-chip.warn { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 12%,transparent); border-color:color-mix(in srgb,var(--rgb-5) 30%,transparent); }
  .aig-chip.bad { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); border-color:color-mix(in srgb,var(--down) 30%,transparent); }

  /* the domain meter — nine segments, lit = answered */
  .aig-meter { position:relative; z-index:1; display:flex; gap:4px; margin-top:12px; }
  .aig-meter i {
    flex:1 1 0; height:5px; border-radius:999px;
    background:color-mix(in srgb,var(--text-1) 12%,transparent);
  }
  .aig-meter i.on { background:linear-gradient(90deg, var(--rgb-1), var(--rgb-2)); box-shadow:0 0 10px -2px color-mix(in srgb,var(--rgb-1) 70%,transparent); }
  .aig-meter i.warn { background:var(--rgb-5); }
  .aig-meter i.off { background:color-mix(in srgb,var(--down) 40%,transparent); }

  /* ── the tab rail ──────────────────────────────────────────────────────
     The WORLD CONSOLE upgrade grew the rail from four tabs to eleven, so it
     became a horizontal scroll rail: every tab keeps its full icon + label
     (nothing wraps to three lines), and the row itself never grows taller —
     «به اپ و فضا فشار نیاید». */
  .aig-tabs {
    display:flex; gap:7px; margin:0 0 14px; padding:6px;
    max-width:100%; box-sizing:border-box;
    overflow-x:auto; scrollbar-width:none;
    background:linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), color-mix(in srgb, var(--bg-panel) 88%, transparent);
    border-radius:20px;
    border:1px solid color-mix(in srgb, var(--line) 70%, transparent);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);
  }
  .aig-tabs::-webkit-scrollbar { display:none; }
  .aig-tab {
    /* one accent per tab, set inline from TAB_ACCENTS — the rail was eleven
       identical violet buttons before, which is exactly the «همه بنفش» the
       report called out. Colour now encodes the tab, and every accent exists
       in the theme already. */
    --tab-acc:var(--rgb-2); --tab-acc2:var(--rgb-1);
    position:relative; flex:0 0 auto; min-width:72px; min-height:62px; padding:9px 8px;
    border-radius:15px; font:inherit; font-size:11px; font-weight:780;
    line-height:1.45; color:var(--text-3); background:transparent;
    border:1px solid transparent; cursor:pointer;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:6px; text-align:center; overflow-wrap:anywhere;
    transition:color .22s cubic-bezier(.4,0,.2,1), background .22s cubic-bezier(.4,0,.2,1), border-color .22s cubic-bezier(.4,0,.2,1), transform .22s cubic-bezier(.4,0,.2,1);
  }
  .aig-tab:hover { color:var(--text-1); background:color-mix(in srgb, var(--bg-raised) 55%, transparent); }
  .aig-tab-icon { width:24px; height:24px; display:grid; place-items:center; flex:0 0 24px;
    color:color-mix(in srgb, var(--tab-acc) 70%, var(--text-3));
    transition:transform .3s cubic-bezier(.4,0,.2,1), color .22s ease; }
  .aig-tab-icon svg { width:100%; height:100%; }
  .aig-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .aig-tab.active {
    color:var(--text-1);
    background:linear-gradient(140deg,color-mix(in srgb,var(--tab-acc) 22%,var(--bg-panel-solid)),color-mix(in srgb,var(--tab-acc2) 14%,var(--bg-panel-solid)));
    border-color:color-mix(in srgb,var(--tab-acc) 46%,transparent);
    box-shadow:0 12px 26px -18px color-mix(in srgb,var(--tab-acc) 90%,transparent), inset 0 1px 0 rgba(255,255,255,0.08);
    transform:translateY(-2px);
  }
  .aig-tab.active::after {
    content:''; position:absolute; inset-inline:18%; bottom:4px; height:2px; border-radius:999px;
    background:linear-gradient(90deg, transparent, var(--tab-acc), var(--tab-acc2), transparent);
    box-shadow:0 0 10px color-mix(in srgb,var(--tab-acc) 70%,transparent);
  }
  .aig-tab.active .aig-tab-icon { transform:scale(1.12); color:var(--tab-acc); }

  .aig-refresh {
    width:100%; min-height:50px; margin-bottom:16px;
    color:#fff; font:inherit; font-size:var(--fs-sm); font-weight:850; cursor:pointer;
    background:linear-gradient(135deg, var(--rgb-1), var(--rgb-2));
    border:1px solid color-mix(in srgb,var(--rgb-1) 45%,transparent);
    border-radius:16px;
    box-shadow:0 14px 30px -20px var(--rgb-1), inset 0 1px 0 rgba(255,255,255,0.25);
    display:flex; align-items:center; justify-content:center; gap:9px;
    transition:transform .18s ease, filter .18s ease, box-shadow .18s ease;
  }
  .aig-refresh:hover:not(:disabled) { filter:brightness(1.07); transform:translateY(-1px); }
  .aig-refresh:active:not(:disabled) { transform:scale(.99); }
  .aig-refresh:disabled { opacity:.62; cursor:wait; filter:saturate(.7); }
  @keyframes spin { 100% { transform:rotate(360deg); } }

  .aig-connection {
    display:flex; align-items:center; gap:9px; margin-bottom:12px; padding:11px 13px;
    border:1px solid color-mix(in srgb,var(--down) 35%,var(--line));
    border-radius:14px; color:var(--down);
    background:color-mix(in srgb,var(--down) 8%,var(--bg-panel-solid));
    font-size:var(--fs-xs); line-height:1.7;
  }

  /* ── section bands ───────────────────────────────────────────────────── */
  .aig-section {
    position:relative; margin-bottom:14px; padding:15px;
    background:linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012) 60%), var(--bg-panel);
    border:1px solid color-mix(in srgb,var(--line) 80%, transparent);
    border-radius:20px;
    box-shadow:0 20px 44px -40px rgba(0,0,0,0.9);
  }
  .aig-section-title {
    display:flex; align-items:center; gap:9px;
    font-size:12.6px; font-weight:900; color:var(--text-1);
    line-height:1.6; margin-bottom:12px;
  }
  .aig-section-title svg { flex:none; }

  /* ── briefing items ──────────────────────────────────────────────────── */
  .aig-item {
    position:relative; padding:13px 13px 13px 14px; margin-bottom:9px;
    border-radius:16px;
    background:linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), var(--bg-raised);
    border:1px solid color-mix(in srgb,var(--line) 75%, transparent);
    overflow:hidden;
  }
  .aig-item::before {
    content:''; position:absolute; inset-block:0; inset-inline-start:0; width:3px;
    background:linear-gradient(180deg, var(--rgb-1), var(--rgb-2)); opacity:.8;
  }
  .aig-item-top { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
  .aig-prio { font-size:10px; font-weight:850; padding:3px 8px; border-radius:8px; letter-spacing:.3px; }
  .aig-prio.critical { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); border:1px solid color-mix(in srgb,var(--down) 30%,transparent); }
  .aig-prio.high { color:#f97316; background:rgba(249,115,22,.12); border:1px solid rgba(249,115,22,.3); }
  .aig-prio.normal { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 10%,transparent); border:1px solid color-mix(in srgb,var(--rgb-5) 26%,transparent); }
  .aig-prio.info { color:var(--up); background:color-mix(in srgb,var(--up) 10%,transparent); border:1px solid color-mix(in srgb,var(--up) 26%,transparent); }
  .aig-item-kind,.aig-item-meta { font-size:var(--fs-xs); color:var(--text-3); }
  .aig-item-title { font-size:var(--fs-sm); font-weight:800; color:var(--text-1); line-height:1.75; overflow-wrap:anywhere; }
  .aig-item-detail { font-size:var(--fs-xs); color:var(--text-2); margin-top:6px; line-height:1.9; }
  .aig-item-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:9px; }
  .aig-item-action { color:var(--rgb-1); cursor:pointer; font-weight:800; }

  /* ── tiles ───────────────────────────────────────────────────────────── */
  .aig-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
  .aig-card {
    position:relative; min-width:0; padding:12px;
    border-radius:16px;
    background:linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012) 62%), var(--bg-raised);
    border:1px solid color-mix(in srgb,var(--line) 78%, transparent);
    transition:transform .18s ease, border-color .18s ease, box-shadow .18s ease;
  }
  .aig-card:hover {
    transform:translateY(-2px);
    border-color:color-mix(in srgb,var(--rgb-1) 30%,var(--line));
    box-shadow:0 16px 34px -26px color-mix(in srgb,var(--rgb-1) 80%,transparent);
  }
  .aig-card-name { font-size:var(--fs-xs); color:var(--text-2); display:flex; align-items:center; gap:7px; line-height:1.6; }
  .aig-card-value { font-size:var(--fs-lg); font-weight:900; color:var(--text-1); margin-top:7px; line-height:1.35; font-variant-numeric:tabular-nums; }
  .aig-card-sub { font-size:11px; color:var(--text-2); margin-top:4px; line-height:1.65; overflow-wrap:anywhere; }

  /* ── providers ───────────────────────────────────────────────────────── */
  .aig-light {
    display:flex; align-items:center; gap:9px; padding:11px 12px;
    border-radius:14px;
    background:linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008)), var(--bg-raised);
    border:1px solid color-mix(in srgb,var(--line) 72%, transparent);
    margin-bottom:7px;
  }
  .aig-light-name { min-width:0; font-size:var(--fs-xs); color:var(--text-1); flex:1; overflow-wrap:anywhere; line-height:1.6; }
  .aig-light-lamps { display:flex; flex:0 0 auto; gap:5px; direction:ltr; }
  .aig-lamp { width:9px; height:9px; border-radius:50%; background:var(--line-strong); }
  .aig-lamp.on { background:var(--up); box-shadow:0 0 8px color-mix(in srgb,var(--up) 60%,transparent); }

  .aig-empty {
    text-align:center; padding:26px 12px; color:var(--text-2);
    font-size:var(--fs-sm); line-height:1.95;
    border:1px dashed color-mix(in srgb,var(--line) 80%, transparent);
    border-radius:16px;
    background:rgba(127,127,127,0.05);
  }

  /* ── regime / outlook ────────────────────────────────────────────────── */
  .aig-regime {
    padding:16px; border-radius:18px; text-align:center; margin-bottom:12px;
    border:1px solid color-mix(in srgb,var(--line) 80%, transparent);
    background:linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01)), var(--bg-raised);
  }
  .aig-regime.risk_on { background:linear-gradient(160deg, color-mix(in srgb,var(--up) 16%,transparent), transparent), var(--bg-raised); border-color:color-mix(in srgb,var(--up) 32%,var(--line)); }
  .aig-regime.risk_off { background:linear-gradient(160deg, color-mix(in srgb,var(--down) 16%,transparent), transparent), var(--bg-raised); border-color:color-mix(in srgb,var(--down) 32%,var(--line)); }
  .aig-regime.mixed { background:linear-gradient(160deg, color-mix(in srgb,var(--rgb-5) 14%,transparent), transparent), var(--bg-raised); }
  .aig-regime-label { font-size:var(--fs-lg); font-weight:900; color:var(--text-1); overflow-wrap:anywhere; letter-spacing:-0.01em; }
  .aig-regime-sub,.aig-note { font-size:var(--fs-xs); color:var(--text-2); line-height:1.9; margin-top:7px; }


  .aig-signal { display:flex; gap:9px; align-items:flex-start; padding:10px 0; border-top:1px solid color-mix(in srgb,var(--line) 70%,transparent); }
  .aig-signal:first-of-type { border-top:none; }
  .aig-signal-dir { flex:0 0 auto; font-size:10px; font-weight:850; padding:3px 7px; border-radius:7px; white-space:nowrap; margin-top:2px; }
  .aig-signal-dir.supportive { color:var(--up); background:color-mix(in srgb,var(--up) 11%,transparent); }
  .aig-signal-dir.cautionary { color:var(--down); background:color-mix(in srgb,var(--down) 11%,transparent); }
  .aig-signal-dir.neutral { color:var(--text-2); background:color-mix(in srgb,var(--rgb-5) 9%,transparent); }
  .aig-signal-body { min-width:0; flex:1; }
  .aig-signal-name { font-size:var(--fs-xs); font-weight:850; color:var(--text-1); line-height:1.65; }
  .aig-signal-ev { font-size:var(--fs-xs); color:var(--text-2); line-height:1.85; overflow-wrap:anywhere; }
  .aig-signal-src { margin-inline-start:6px; font-size:9px; font-weight:800; color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 12%,transparent); padding:2px 7px; border-radius:7px; vertical-align:middle; }
  .aig-ind-chg { font-size:11px; font-weight:800; font-variant-numeric:tabular-nums; }

  .aig-narrative {
    margin:12px 0; padding:14px 15px; border-radius:18px;
    border:1px solid color-mix(in srgb,var(--rgb-1) 26%,var(--line));
    background:linear-gradient(150deg,color-mix(in srgb,var(--rgb-1) 10%,transparent),color-mix(in srgb,var(--rgb-2) 10%,transparent));
  }
  .aig-narrative-title { display:flex; align-items:center; gap:7px; font-size:var(--fs-xs); font-weight:900; color:var(--text-1); margin-bottom:7px; }
  .aig-narrative-text { font-size:var(--fs-xs); line-height:2; color:var(--text-1); overflow-wrap:anywhere; }
  .aig-narrative-note { font-size:10px; color:var(--text-3); margin-top:7px; line-height:1.7; }
  .aig-commentary-provider { flex:0 0 auto; font-size:10px; font-weight:800; color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 12%,transparent); padding:3px 8px; border-radius:999px; }
  .aig-fallback-tag { display:inline-block; margin-inline-start:5px; font-size:9px; font-weight:800; color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 10%,transparent); padding:2px 7px; border-radius:7px; vertical-align:middle; }

  .aig-market-chart {
    margin:12px 0 15px; padding:14px; border-radius:18px;
    border:1px solid color-mix(in srgb,var(--rgb-1) 24%,var(--line));
    background:linear-gradient(150deg,color-mix(in srgb,var(--rgb-1) 9%,transparent), rgba(255,255,255,0.012));
  }
  .aig-chart-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
  .aig-chart-title { font-size:var(--fs-xs); font-weight:900; color:var(--text-1); }
  .aig-chart-source { font-size:10px; color:var(--text-3); }
  .aig-chart-svg { width:100%; height:auto; display:block; overflow:visible; }

  .aig-insight-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
  .aig-insight-card {
    position:relative; min-width:0; overflow:hidden; padding:12px; border-radius:16px;
    border:1px solid color-mix(in srgb,var(--line) 78%, transparent);
    background:linear-gradient(150deg, rgba(255,255,255,0.045), color-mix(in srgb,var(--rgb-1) 7%, var(--bg-raised)));
  }
  .aig-insight-card::after { content:""; position:absolute; width:70px; height:70px; inset-inline-end:-26px; top:-26px; border-radius:50%; background:var(--insight-tone,var(--rgb-2)); opacity:.16; filter:blur(14px); }
  .aig-insight-kicker { display:flex; align-items:center; gap:6px; position:relative; z-index:1; font-size:10px; color:var(--text-2); line-height:1.5; }
  .aig-insight-icon { font-size:18px; line-height:1; }
  .aig-insight-logo { width:26px; height:26px; flex:0 0 26px; display:grid; place-items:center; overflow:hidden; border-radius:9px; color:#fff; background:linear-gradient(135deg,var(--rgb-1),var(--rgb-2)); font-size:11px; font-weight:900; }
  .aig-insight-logo img { width:100%; height:100%; object-fit:cover; }
  .aig-insight-symbol { position:relative; z-index:1; display:flex; align-items:center; gap:7px; margin-top:10px; font-size:var(--fs-md); font-weight:900; color:var(--text-1); }
  .aig-insight-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; font-weight:650; color:var(--text-3); }
  .aig-insight-value { position:relative; z-index:1; margin-top:5px; font-size:var(--fs-sm); font-weight:900; font-variant-numeric:tabular-nums; }
  .aig-insight-value.up { color:var(--up); }
  .aig-insight-value.down { color:var(--down); }
  .aig-insight-value.flat { color:var(--text-2); }
  .aig-insight-meta { position:relative; z-index:1; margin-top:4px; font-size:10px; color:var(--text-2); line-height:1.6; overflow-wrap:anywhere; }
  .aig-insight-empty { position:relative; z-index:1; margin-top:10px; color:var(--text-3); font-size:11px; line-height:1.7; }

  .aig-market-list { list-style:none; margin:9px 0 0; padding:0; }
  .aig-market-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:10px; padding:10px 0; border-top:1px solid color-mix(in srgb,var(--line) 65%,transparent); }
  .aig-market-name { min-width:0; font-size:var(--fs-xs); font-weight:850; color:var(--text-1); overflow-wrap:anywhere; line-height:1.6; }
  .aig-market-meta { margin-top:3px; font-size:10px; line-height:1.6; color:var(--text-3); overflow-wrap:anywhere; }
  .aig-market-values { min-width:0; display:flex; flex-direction:column; align-items:flex-end; gap:3px; text-align:end; }
  .aig-market-usd { font-size:var(--fs-xs); font-weight:900; color:var(--text-1); white-space:nowrap; direction:ltr; font-variant-numeric:tabular-nums; }
  .aig-market-toman { font-size:10px; font-weight:850; color:var(--rgb-2); white-space:nowrap; }
  .aig-market-tag { display:inline-flex; align-items:center; margin-inline-start:5px; padding:2px 6px; border-radius:7px; font-size:9px; font-weight:850; color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 11%,transparent); vertical-align:1px; }
  .aig-market-tag.stale { color:var(--down); background:color-mix(in srgb,var(--down) 10%,transparent); }
  .aig-market-banner { margin-top:11px; padding:10px 11px; border-radius:12px; border:1px solid color-mix(in srgb,var(--rgb-2) 24%,var(--line)); background:color-mix(in srgb,var(--rgb-2) 7%,var(--bg-raised)); font-size:10px; line-height:1.75; color:var(--text-2); overflow-wrap:anywhere; }
  .aig-market-banner.stale { border-color:color-mix(in srgb,var(--down) 26%,var(--line)); background:color-mix(in srgb,var(--down) 6%,var(--bg-raised)); }
  .aig-market-status { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:6px; margin-top:7px; font-size:10px; color:var(--text-2); }
  .aig-market-count { font-weight:850; color:var(--text-1); }

  /* ── icons + direction markers ───────────────────────────────────────── */
  .aig-icon { flex:0 0 auto; display:inline-block; vertical-align:-3px; }
  .aig-dir { flex:0 0 auto; display:inline-block; vertical-align:-1px; }
  .aig-dir-up { color:var(--up); }
  .aig-dir-down { color:var(--down); }
  .aig-dir-flat { color:var(--text-3); }

  /* ── one card: the class chart AND the per-class readings ────────────── */
  .aig-move { margin:0 0 12px; padding:14px 15px 10px; border-radius:18px; border:1px solid color-mix(in srgb,var(--rgb-1) 24%,var(--line)); background:linear-gradient(150deg,color-mix(in srgb,var(--rgb-1) 9%,transparent), rgba(255,255,255,0.012)); }
  .aig-move-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:3px; }
  .aig-move-title { display:flex; align-items:center; gap:7px; font-size:var(--fs-xs); font-weight:900; color:var(--text-1); }
  .aig-move-src { font-size:10px; color:var(--text-3); white-space:nowrap; }
  .aig-move-list { list-style:none; margin:9px 0 0; padding:0; }
  .aig-move-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:9px; padding:9px 0; border-top:1px solid color-mix(in srgb,var(--line) 65%,transparent); }
  .aig-move-name { min-width:0; display:flex; align-items:center; gap:7px; font-size:var(--fs-xs); font-weight:800; color:var(--text-1); overflow:hidden; }
  .aig-move-breadth { flex:0 0 auto; font-size:10px; color:var(--text-3); white-space:nowrap; direction:ltr; }
  .aig-move-avg { flex:0 0 auto; font-size:var(--fs-sm); font-weight:900; direction:ltr; font-variant-numeric:tabular-nums; }
  .aig-move-avg.up { color:var(--up); }
  .aig-move-avg.down { color:var(--down); }
  .aig-move-avg.flat { color:var(--text-2); }

  /* ── the single system-analysis box ──────────────────────────────────── */
  .aig-analysis-lines { list-style:none; margin:0; padding:0; }
  .aig-analysis-line { display:flex; align-items:flex-start; gap:9px; padding:9px 0; border-top:1px solid color-mix(in srgb,var(--line) 65%,transparent); }
  .aig-analysis-line:first-child { border-top:none; }
  .aig-analysis-line .aig-dir { margin-top:5px; }
  .aig-analysis-text { min-width:0; flex:1; font-size:var(--fs-xs); line-height:2; color:var(--text-1); overflow-wrap:anywhere; }
  .aig-analysis-line.is-flat .aig-analysis-text { color:var(--text-2); }
  .aig-analysis-ai { margin-top:12px; padding-top:12px; border-top:1px dashed color-mix(in srgb,var(--rgb-2) 32%,var(--line)); }

  /* ── light theme ─────────────────────────────────────────────────────── */
  :root[data-theme='light'] .aig-header { background:linear-gradient(140deg, rgba(10,117,184,0.08), rgba(124,77,255,0.08)); border-color:rgba(13,16,32,0.1); }
  :root[data-theme='light'] .aig-section { background:#ffffff; border-color:rgba(13,16,32,0.09); }
  :root[data-theme='light'] .aig-card,
  :root[data-theme='light'] .aig-item,
  :root[data-theme='light'] .aig-light,
  :root[data-theme='light'] .aig-insight-card { background:#ffffff; border-color:rgba(13,16,32,0.09); }
  :root[data-theme='light'] .aig-tabs { background:#ffffff; border-color:rgba(13,16,32,0.1); }
  :root[data-theme='light'] .aig-tab.active { color:#0b1020; }

  @media (max-width:360px) {
    .ai-global { padding-inline:12px; }
    .aig-title { font-size:17px; }
    .aig-sub { font-size:10.5px; }
    .aig-chip { font-size:10px; padding-inline:7px; }
    .aig-tabs { gap:5px; padding:5px; }
    .aig-tab { font-size:10px; min-height:56px; padding-inline:4px; }
    .aig-header { padding:13px; border-radius:20px; }
    .aig-section { padding:13px; border-radius:18px; }
    .aig-move { padding-inline:11px; }
    .aig-move-row { grid-template-columns:minmax(0,1fr) auto; }
    .aig-move-breadth { display:none; }
    .aig-insight-grid { gap:7px; }
  }
  @media (min-width:480px) {
    .ai-global { padding-inline:16px; }
    .aig-tab { font-size:var(--fs-xs); }
    .aig-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .aig-live.is-working { animation:none; }
    .aig-tab, .aig-card, .aig-refresh { transition:none; }
    .aig-card:hover, .aig-tab.active { transform:none; }
  }
`;

const TABS = [
  { id: 'briefing', icon: 'briefing', marker: '📰' },
  /* ── the WORLD CONSOLE sub-tabs (FBT جهانی upgrade) ── */
  { id: 'world', icon: 'world', marker: '🌐' },
  { id: 'globe', icon: 'globeMap', marker: '🗺️' },
  { id: 'radar', icon: 'radar', marker: '📡' },
  { id: 'cross', icon: 'cross', marker: '🔀' },
  { id: 'causal', icon: 'causal', marker: '⛓️' },
  { id: 'flows', icon: 'flows', marker: '💸' },
  { id: 'future', icon: 'future', marker: '🌳' },
  { id: 'dna', icon: 'dna', marker: '🧬' },
  { id: 'domains', icon: 'domains', marker: '🌍' },
  { id: 'providers', icon: 'providers', marker: '🔌' }
];

/* The tab glyphs now come from the console's own icon module, so the rail and
   the panel headers can never drift apart again. */
function TabIcon({ name, size }) {
  return <WorldTabIcon name={name} size={size || 24} />;
}

/* Coloured section-header variant of the tab icons, used by the WORLD
   CONSOLE sub-tabs' headers. */
function TabIconGadget({ name }) {
  const pair = TAB_ACCENTS[name] || [];
  return (
    <span style={{ color: pair[0] || 'var(--rgb-2)', display: 'inline-flex' }}>
      <TabIcon name={name} size={17} />
    </span>
  );
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
  /* The macro desk reads more than one upstream now, and a topped-up
     instrument keeps the desk that produced it — so the mixed source and each
     individual one both need a Persian name. */
  'macroData:fredcsv': { fa: 'داده کلان (FRED بدون کلید)', en: 'macro data (keyless FRED)' },
  'macroData:av': { fa: 'داده کلان (آلفا ونتیج)', en: 'macro data (Alpha Vantage)' },
  'macroData:stooq+topup': { fa: 'داده کلان (stooq + تکمیل)', en: 'macro data (stooq + top-up)' },
  'macroData:yahoo+topup': { fa: 'داده کلان (yahoo + تکمیل)', en: 'macro data (yahoo + top-up)' },
  'macroData:fredcsv+topup': { fa: 'داده کلان (FRED + تکمیل)', en: 'macro data (FRED + top-up)' },
  'macroData:av+topup': { fa: 'داده کلان (آلفا ونتیج + تکمیل)', en: 'macro data (Alpha Vantage + top-up)' },
  'stooq': { fa: 'داده کلان', en: 'macro data' }, 'yahoo': { fa: 'داده کلان', en: 'macro data' }, 'fred': { fa: 'داده کلان', en: 'macro data' },
  'fredcsv': { fa: 'FRED بدون کلید', en: 'keyless FRED' }, 'av': { fa: 'آلفا ونتیج', en: 'Alpha Vantage' },
  'coingecko': { fa: 'کوین‌گکو', en: 'CoinGecko' }, 'defillama': { fa: 'دیفای‌لاما', en: 'DefiLlama' },
  'sec-edgar': { fa: 'گزارش‌های SEC', en: 'SEC filings' }
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
  const n = (v) => (isRTL ? worldFaNum(v) : v);
  if (s < 5) return isRTL ? 'همین حالا' : 'just now';
  if (s < 60) return isRTL ? `${n(s)} ثانیه پیش` : `${s}s ago`;
  if (s < 3600) return isRTL ? `${n(Math.round(s / 60))} دقیقه پیش` : `${Math.round(s / 60)}m ago`;
  return isRTL ? `${n(Math.round(s / 3600))} ساعت پیش` : `${Math.round(s / 3600)}h ago`;
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
  SPX: { fa: 'قرارداد آتی ای‌مینی اس‌اندپی ۵۰۰', en: 'S&P 500 E-mini futures' },
  /* The two index ETFs exist because stooq/yahoo can both be dark on an
     Iranian network: an ETF price is shown AS an ETF price (its own symbol and
     unit), never relabelled as the index it tracks. */
  SPY: { fa: 'صندوق قابل معامله اس‌اندپی ۵۰۰', en: 'S&P 500 ETF (SPDR)' },
  QQQ: { fa: 'صندوق قابل معامله نزدک ۱۰۰', en: 'Nasdaq-100 ETF (Invesco)' },
  NDX: { fa: 'شاخص نزدک ۱۰۰', en: 'Nasdaq 100' },
  US10Y: { fa: 'بازده ۱۰ سالهٔ آمریکا', en: 'US 10Y yield' },
  US2Y: { fa: 'بازده ۲ سالهٔ آمریکا', en: 'US 2Y yield' },
  US30Y: { fa: 'بازده ۳۰ سالهٔ آمریکا', en: 'US 30Y yield' },
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

const COMMODITY_ORDER = Object.freeze(['GOLD', 'SILVER', 'WTI', 'BRENT', 'COPPER']);
const COMMODITY_INFO = Object.freeze({
  GOLD: { en: 'Gold', fa: 'طلا', unit: 'USD/troy oz' },
  SILVER: { en: 'Silver', fa: 'نقره', unit: 'USD/troy oz' },
  WTI: { en: 'WTI crude', fa: 'نفت خام WTI', unit: 'USD/barrel' },
  BRENT: { en: 'Brent crude', fa: 'نفت برنت', unit: 'USD/barrel' },
  COPPER: { en: 'Copper', fa: 'مس', unit: 'USD/lb' }
});
const COMMODITY_SYMBOLS = Object.freeze({
  GOLD: 'GOLD', XAU: 'GOLD', XAUUSD: 'GOLD',
  SILVER: 'SILVER', XAG: 'SILVER', XAGUSD: 'SILVER',
  WTI: 'WTI', CL: 'WTI', CLF: 'WTI', USOIL: 'WTI', WTIUSD: 'WTI',
  BRENT: 'BRENT', BRN: 'BRENT', BRNF: 'BRENT', BZF: 'BRENT', UKOIL: 'BRENT',
  COPPER: 'COPPER', HG: 'COPPER', HGF: 'COPPER', XCU: 'COPPER'
});
const finiteMarketNumber = (value) => (
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null
);
const marketEpoch = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};
const commoditySymbol = (value) => {
  const key = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return COMMODITY_SYMBOLS[key] || null;
};

function collectCommodityQuotes(cross, domains) {
  const rows = new Map();
  const add = (quote, envelope = {}, origin = 'feed') => {
    const symbol = commoditySymbol(quote?.symbol);
    const priceUsd = finiteMarketNumber(quote?.priceUsd);
    if (!symbol || priceUsd === null || priceUsd <= 0 || rows.has(symbol)) return;
    const at = marketEpoch(quote?.at) ?? marketEpoch(envelope.at);
    const stale = quote?.stale === true || envelope.stale === true
      || (at !== null && Date.now() - at > 48 * 60 * 60_000);
    rows.set(symbol, {
      symbol,
      sourceSymbol: String(quote?.symbol || symbol).slice(0, 24),
      name: COMMODITY_INFO[symbol].en,
      nameFa: COMMODITY_INFO[symbol].fa,
      unit: String(quote?.unit || COMMODITY_INFO[symbol].unit),
      priceUsd,
      change1dPct: finiteMarketNumber(quote?.change1dPct ?? quote?.change24hPct),
      source: String(quote?.source || envelope.source || 'unknown').slice(0, 60),
      at,
      stale,
      origin
    });
  };

  /* Macro daily-series reads carry exact units and are preferred. The global
     commodities domain fills only instruments absent from that desk; duplicate
     symbols never overwrite the source already selected for this pass. */
  for (const quote of Array.isArray(cross?.macro?.indicators) ? cross.macro.indicators : []) {
    if (COMMODITY_ORDER.includes(commoditySymbol(quote?.symbol))) add(quote, {}, 'macro');
  }
  const domain = domains?.commodities;
  if (domain?.status === 'OK') {
    const domainData = domain.data || {};
    for (const quote of Array.isArray(domainData.instruments) ? domainData.instruments : []) {
      if (COMMODITY_ORDER.includes(commoditySymbol(quote?.symbol))) {
        add(quote, { source: domain.source, at: domain.at, stale: domainData.stale === true }, 'commodities-domain');
      }
    }
  }
  return COMMODITY_ORDER.map((symbol) => rows.get(symbol)).filter(Boolean);
}

function inspectTomanReference(payload, now = Date.now()) {
  if (payload?.schema !== 'fbt.iran-buy-rate.v1' || payload?.available !== true) {
    return { status: 'unavailable', value: null, at: null, source: null };
  }
  const value = finiteMarketNumber(payload.buyPrice);
  const at = marketEpoch(payload.at);
  if (value === null || value <= 0 || at === null) return { status: 'unavailable', value: null, at: null, source: null };
  const ageMs = now - at;
  if (ageMs < -60_000 || ageMs > 120_000) return { status: 'stale', value: null, at, source: payload.source || null };
  return { status: 'fresh', value, at, source: payload.source || null };
}

function CommodityQuotes({ rows, rate, domains, L, isPersian, isRTL }) {
  const missing = COMMODITY_ORDER.filter((symbol) => !rows.some((row) => row.symbol === symbol));
  const missingReason = domains?.commodities?.reason || null;
  return (
    <section className="aig-section" aria-label={L('قیمت‌های کالاهای جهانی', 'Global commodity prices')}>
      <div className="aig-section-title">
        <AigIcon name="drop" /> {L('کالاهای جهانی · قیمت مشاهده‌شده', 'Global commodities · observed prices')}
        <span className="aig-market-count">{isPersian ? `${faNum(rows.length)}/۵` : `${rows.length}/5`}</span>
      </div>
      {rows.length ? (
        <ul className="aig-market-list">
          {rows.map((row) => (
            <li className="aig-market-row aig-commodity-row" key={row.symbol}>
              <div>
                <div className="aig-market-name">
                  {row.symbol} <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{isPersian ? row.nameFa : row.name}</span>
                  {row.stale ? <span className="aig-market-tag stale">{L('قدیمی', 'stale')}</span> : null}
                </div>
                <div className="aig-market-meta">
                  {row.sourceSymbol !== row.symbol ? `${row.sourceSymbol} · ` : ''}{sourceLabel(row.source, isPersian)}
                  {row.at !== null ? ` · ${timeAgo(row.at, isRTL)}` : ''}
                  {row.change1dPct !== null ? ` · ${pctText(row.change1dPct, isPersian)} ${L('۲۴س', '1d')}` : ''}
                </div>
              </div>
              <div className="aig-market-values">
                <span className="aig-market-usd">${numText(row.priceUsd, false, row.priceUsd >= 100 ? 2 : 4)} <small>USD/{row.unit.replace(/^USD\/?/i, '')}</small></span>
                {isPersian && rate.status === 'fresh' ? (
                  <span className="aig-market-toman" dir="rtl">≈ {numText(Math.round(row.priceUsd * rate.value), true, 0)} تومان</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="aig-empty">{L('در این دور قیمت کالای قابل‌تأییدی خوانده نشد.', 'No verifiable commodity price was read in this pass.')}</div>
      )}
      {missing.length ? (
        <div className="aig-note">
          {L('خوانده‌نشده: ', 'Not read: ')}{missing.map((symbol) => `${symbol} (${isPersian ? COMMODITY_INFO[symbol].fa : COMMODITY_INFO[symbol].en})`).join(isPersian ? '، ' : ', ')}
          {missingReason ? ` · ${reasonLabel(missingReason, isPersian)}` : ''}
        </div>
      ) : null}
      {isPersian ? (
        <div className={`aig-market-banner ${rate.status === 'stale' ? 'stale' : ''}`}>
          {rate.status === 'fresh'
            ? <><b>۱ USDT ≈ {numText(rate.value, true, 0)} تومان</b> · {L('مرجع عمومی USDT/TMN از والکس', 'public Wallex USDT/TMN reference')} · {timeAgo(rate.at, true)}.</>
            : rate.status === 'stale'
              ? L('نرخ مرجع USDT/TMN قدیمی است؛ تبدیل تومانی پنهان شد و فقط قیمت دلاری نمایش داده می‌شود.', 'The USDT/TMN reference is stale; toman conversions are hidden and only USD values are shown.')
              : L('نرخ تازهٔ عمومی USDT/TMN در دسترس نیست؛ تبدیل تومانی نمایش داده نمی‌شود.', 'A fresh public USDT/TMN reference is unavailable; no toman conversion is shown.')}
          <div style={{ marginTop: 4 }}>{L('معادل تومان تقریبی است (قیمت USD × نرخ مرجع USDT/TMN)؛ نرخ اجرایی USD/TMN یا قیمت سفارش نیست.', 'Toman values are indicative (USD price × public USDT/TMN reference), not an executable USD/TMN or order quote.')}</div>
        </div>
      ) : null}
      <div className="aig-note">{L('دادهٔ مشاهده‌شده و فقط‌خواندنی است؛ قیمت‌های روزانه ممکن است مربوط به آخرین بسته‌شدن بازار باشند.', 'Read-only observed data; daily series may reflect the last market close.')}</div>
    </section>
  );
}

function GoldEtfQuotes({ market, rate, L, isPersian, isRTL }) {
  const rows = Array.isArray(market?.rows) ? market.rows : [];
  return (
    <section className="aig-section" aria-label={L('قیمت صندوق‌های قابل معامله طلا', 'Gold ETF quotes')}>
      <div className="aig-section-title">
        <AigIcon name="building" /> {L('ETFهای طلا · دادهٔ بازار', 'Gold ETFs · market data')}
        <span className={`aig-market-tag ${market?.stale ? 'stale' : ''}`}>
          {market?.available ? (market.stale ? L('قدیمی', 'stale') : L('با تأخیر', 'delayed')) : L('دسترس‌ناپذیر', 'unavailable')}
        </span>
      </div>
      {rows.length ? (
        <ul className="aig-market-list">
          {rows.map((row) => {
            const price = finiteMarketNumber(row.priceUsd);
            const change = finiteMarketNumber(row.changePct);
            return (
              <li className="aig-market-row aig-etf-row" key={row.symbol}>
                <div>
                  <div className="aig-market-name">{row.symbol} <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{row.name || ''}</span></div>
                  <div className="aig-market-meta">
                    {row.latestTradingDay ? `${L('آخرین روز معاملاتی: ', 'last trading day: ')}${row.latestTradingDay}` : L('روز معاملاتی نامشخص', 'trading day unavailable')}
                    {change !== null ? ` · ${pctText(change, isPersian)}` : ''}
                    {row.meta?.stale || market?.stale ? ` · ${L('دادهٔ قدیمی', 'stale quote')}` : ''}
                  </div>
                </div>
                <div className="aig-market-values">
                  <span className="aig-market-usd">{price === null ? '—' : `$${numText(price, false, price >= 100 ? 2 : 4)}`}</span>
                  {isPersian && rate.status === 'fresh' && price !== null ? (
                    <span className="aig-market-toman" dir="rtl">≈ {numText(Math.round(price * rate.value), true, 0)} تومان</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="aig-empty">
          {market?.reason
            ? `${L('قیمت ETF خوانده نشد: ', 'ETF quotes unavailable: ')}${String(market.reason).replace(/_/g, ' ').toLowerCase()}`
            : L('در این دور قیمت زنده/با‌تأخیر ETF دریافت نشد؛ فهرست نمادها به‌عنوان نرخ نمایش داده نمی‌شود.', 'No current ETF quote was returned; a supported-symbol list is not presented as market rates.')}
        </div>
      )}
      {market?.available && market.rows?.length < 5 ? (
        <div className="aig-note">{L('فقط ', 'Only ')}{isPersian ? faNum(market.rows.length) : market.rows.length}{L(' از ۵ قیمت ETF در این دور خوانده شد؛ بقیه بدون قیمت‌اند.', ' of 5 ETF quotes were read in this pass; the rest remain unpriced.')}</div>
      ) : null}
      <div className="aig-note">{L('منبع آلفا ونتیج؛ داده با تأخیر، فقط‌خواندنی و غیرقابل‌اجرا از این پنل.', 'Alpha Vantage source; delayed, read-only market data, not executable from this panel.')}</div>
      {isPersian && rate.status !== 'fresh' ? (
        <div className={`aig-market-banner ${rate.status === 'stale' ? 'stale' : ''}`}>
          {rate.status === 'stale'
            ? L('نرخ USDT/TMN قدیمی است؛ تبدیل ETF به تومان پنهان شد.', 'The USDT/TMN reference is stale; ETF toman conversions are hidden.')
            : L('نرخ مرجع تازهٔ USDT/TMN موجود نیست؛ قیمت ETF فقط به USD نمایش داده می‌شود.', 'No fresh USDT/TMN reference; ETF prices remain in USD only.')}
        </div>
      ) : null}
    </section>
  );
}

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
            {row.tag ? <span className="aig-fallback-tag" title={row.tagTitle || row.tag}>{row.tag}</span> : null}
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

function EconomyLeaders({ cross, domains, flows, L, isPersian }) {
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

  /* The equity index the macro desk reads — the S&P future, or one of the two
     index ETFs it now falls back to — else the tokenised-equity class. */
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

  /* ── WHAT THE SAME PASS ALREADY READ ──────────────────────────────────────
     «در این دور خوانده نشد.» used to be the ONLY answer these six cards had
     whenever the macro desk was dark — even though the very same pass had
     usually read the crypto class movers, and even though three free public
     sources (CoinGecko capital deltas, DefiLlama stablecoin supply, SEC
     reported profit) are one request away on /api/insights/flows.

     A card now falls back to a real reading from THIS pass and says so with
     the same tag the movement rows already use. It still says «خوانده نشد»
     when nothing answered, and it never borrows a number from another card's
     subject: a chain's stablecoin burn is shown as a chain, not as a token. */
  const cryptoTop = (cross?.classes?.crypto?.top || [])[0] || null;
  const cryptoBottom = (cross?.classes?.crypto?.bottom || [])[0] || null;
  const tokenFlows = flows?.tokenFlows?.status === 'OK' ? flows.tokenFlows : null;
  const chainFlows = flows?.chainFlows?.status === 'OK' ? flows.chainFlows : null;
  const srcTag = L('منبع جایگزین', 'fallback source');

  /* The curve from two real reads when the spread series itself was not read:
     10y minus 2y, both from the same desk pass, both sources named. This is
     arithmetic on observations, not an estimate of anything. */
  const ten = indicators.find((q) => q.symbol === 'US10Y');
  const two = indicators.find((q) => q.symbol === 'US2Y');
  const derivedSpread = ten && two && Number.isFinite(Number(ten.priceUsd)) && Number.isFinite(Number(two.priceUsd))
    ? Math.round((Number(ten.priceUsd) - Number(two.priceUsd)) * 100) / 100
    : null;

  /* Chain-level stablecoin flows: supply is burned when money leaves, so a
     chain's 24h delta IS an observed outflow rather than a price move dressed
     up as one. */
  const chainOuts = Array.isArray(chainFlows?.chainOutflows) ? chainFlows.chainOutflows : [];
  const hiChainOut = chainFlows?.topOutflowChain || chainOuts[0] || null;
  const loChainOut = chainOuts.length > 1 ? chainOuts[chainOuts.length - 1] : null;

  const gainerRow = best ? {
    symbol: best.symbol, name: nameOf(best), dir: dirOfPct(best.change1dPct),
    value: pct(best.change1dPct),
    meta: `${L('۷ روز', '7d')}: ${best.change7dPct != null ? pct(best.change7dPct) : '—'}${best.source ? ` · ${sourceLabel(best.source, isPersian)}` : ''}`
  } : cryptoTop && Number(cryptoTop.changePct) > 0 ? {
    symbol: cryptoTop.symbol, name: isPersian ? '' : (cryptoTop.name || ''), dir: dirOfPct(cryptoTop.changePct),
    value: pct(cryptoTop.changePct), tag: srcTag,
    tagTitle: L('میز کلان خوانده نشد؛ این عدد از کلاس رمزارز همین دور است', 'The macro desk was unread; this number is from the same pass\u2019s crypto class'),
    meta: L('از کلاس رمزارز همین دور', 'from this pass\u2019s crypto class')
  } : tokenFlows?.topInflow ? {
    symbol: tokenFlows.topInflow.symbol, name: isPersian ? '' : (tokenFlows.topInflow.name || ''),
    dir: dirOfPct(tokenFlows.topInflow.mcapChangePct), value: pct(tokenFlows.topInflow.mcapChangePct), tag: srcTag,
    tagTitle: L('تغییر ارزش بازار ۲۴ ساعته از کوین‌گکو', 'CoinGecko 24h market-cap change'),
    meta: `${L('جذب سرمایه', 'capital in')}: $${isPersian ? faNum(fmtK(tokenFlows.topInflow.mcapChangeUsd)) : fmtK(tokenFlows.topInflow.mcapChangeUsd)}`
  } : null;

  const loserRow = worst && worst.symbol !== best?.symbol ? {
    symbol: worst.symbol, name: nameOf(worst), dir: dirOfPct(worst.change1dPct),
    value: pct(worst.change1dPct),
    meta: `${L('۷ روز', '7d')}: ${worst.change7dPct != null ? pct(worst.change7dPct) : '—'}${worst.source ? ` · ${sourceLabel(worst.source, isPersian)}` : ''}`
  } : cryptoBottom && Number(cryptoBottom.changePct) < 0 && cryptoBottom.symbol !== cryptoTop?.symbol ? {
    symbol: cryptoBottom.symbol, name: isPersian ? '' : (cryptoBottom.name || ''), dir: dirOfPct(cryptoBottom.changePct),
    value: pct(cryptoBottom.changePct), tag: srcTag,
    tagTitle: L('میز کلان خوانده نشد؛ این عدد از کلاس رمزارز همین دور است', 'The macro desk was unread; this number is from the same pass\u2019s crypto class'),
    meta: L('از کلاس رمزارز همین دور', 'from this pass\u2019s crypto class')
  } : tokenFlows?.topOutflow ? {
    symbol: tokenFlows.topOutflow.symbol, name: isPersian ? '' : (tokenFlows.topOutflow.name || ''),
    dir: dirOfPct(tokenFlows.topOutflow.mcapChangePct), value: pct(tokenFlows.topOutflow.mcapChangePct), tag: srcTag,
    tagTitle: L('تغییر ارزش بازار ۲۴ ساعته از کوین‌گکو', 'CoinGecko 24h market-cap change'),
    meta: `${L('خروج سرمایه', 'capital out')}: $${isPersian ? faNum(fmtK(tokenFlows.topOutflow.mcapChangeUsd)) : fmtK(tokenFlows.topOutflow.mcapChangeUsd)}`
  } : null;

  return (
    <>
      <div className="aig-section-title" style={{ marginTop: 4 }}>
        <AigIcon name="trophy" /> {L('برترین‌های اقتصاد جهانی', 'Global economy leaders')}
      </div>
      <div className="aig-insight-grid">
        <LeaderCard
          icon="chart" tone="var(--up)"
          title={L('بیشترین رشد ۲۴ ساعته', 'Biggest 24h gainer')}
          row={gainerRow}
          empty={unread}
        />
        <LeaderCard
          icon="warning" tone="var(--down)"
          title={L('بیشترین افت ۲۴ ساعته', 'Biggest 24h decline')}
          row={loserRow}
          empty={unread}
        />
        <LeaderCard
          icon="layers" tone="var(--rgb-1)"
          title={L('شاخص سهام', 'Equity index')}
          row={equity ? {
            symbol: equity.symbol, name: nameOf(equity), dir: dirOfPct(equity.change1dPct),
            value: equity.priceUsd != null ? numText(equity.priceUsd, isPersian) : pct(equity.change1dPct),
            meta: `${L('۲۴ ساعت', '1d')} ${pct(equity.change1dPct)}${equity.change7dPct != null ? ` · ${L('۷ روز', '7d')} ${pct(equity.change7dPct)}` : ''}${equity.source ? ` · ${sourceLabel(equity.source, isPersian)}` : ''}`
          } : stockTop ? {
            symbol: stockTop.symbol, name: isPersian ? '' : (stockTop.name || ''), dir: dirOfPct(stockTop.changePct),
            value: pct(stockTop.changePct), tag: srcTag,
            tagTitle: L('از فید سهام همین دور', 'from this pass\u2019s equity feed'),
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
              : L('طبیعی', 'positive')
          } : derivedSpread !== null ? {
            symbol: '2s10s', name: L('اختلاف ۲ و ۱۰ ساله', '2y vs 10y spread'),
            dir: derivedSpread < 0 ? 'down' : 'up',
            value: isPersian
              ? `${faNum(`${derivedSpread > 0 ? '+' : ''}${derivedSpread}`)} ${L('واحد درصد', 'pp')}`
              : `${derivedSpread > 0 ? '+' : ''}${derivedSpread}pp`,
            tag: srcTag,
            tagTitle: L('از دو خوانش واقعیِ بازده ۲ و ۱۰ سالهٔ همین دور محاسبه شد', 'computed from this pass\u2019s real 2y and 10y reads'),
            meta: `${L('۱۰ساله', '10y')} ${numText(ten.priceUsd, isPersian)}% − ${L('۲ساله', '2y')} ${numText(two.priceUsd, isPersian)}%${ten.source ? ` · ${sourceLabel(ten.source, isPersian)}` : ''}`
          } : null}
          empty={L('منحنی بازده خوانده نشد.', 'The yield curve was not read.')}
        />
        <LeaderCard
          icon="wallet" tone="var(--down)"
          title={L('بیشترین خروج پول', 'Highest observed outflow')}
          row={hiOut ? {
            symbol: hiOut.symbol, name: isPersian ? '' : (hiOut.name || ''), dir: 'down',
            value: `$${isPersian ? faNum(fmtK(hiOut.amount)) : fmtK(hiOut.amount)}`,
            meta: flowMeta(hiOut) || L('جریان برچسب‌خورده', 'labelled flow')
          } : hiChainOut ? {
            symbol: hiChainOut.chain, name: L('استیبل‌کوین', 'stablecoin'), dir: 'down',
            value: `$${isPersian ? faNum(fmtK(Math.abs(hiChainOut.net24hUsd))) : fmtK(Math.abs(hiChainOut.net24hUsd))}`,
            tag: srcTag,
            tagTitle: L('استیبل‌کوین سوخته‌شده روی این زنجیره = پول واقعیِ خارج‌شده', 'stablecoin burned on this chain = real money out'),
            meta: `${L('۲۴ ساعت', '24h')}${hiChainOut.net24hPct != null ? ` · ${pct(hiChainOut.net24hPct)}` : ''}${chainFlows?.source ? ` · ${sourceLabel(chainFlows.source, isPersian)}` : ''}`
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
          } : loChainOut && loChainOut.chain !== hiChainOut?.chain ? {
            symbol: loChainOut.chain, name: L('استیبل‌کوین', 'stablecoin'), dir: 'down',
            value: `$${isPersian ? faNum(fmtK(Math.abs(loChainOut.net24hUsd))) : fmtK(Math.abs(loChainOut.net24hUsd))}`,
            tag: srcTag,
            tagTitle: L('کوچک‌ترین خروج در میان زنجیره‌های رتبه‌بندی‌شدهٔ همین دور', 'the smallest outflow among this pass\u2019s ranked chains'),
            meta: `${L('۲۴ ساعت', '24h')}${chainFlows?.source ? ` · ${sourceLabel(chainFlows.source, isPersian)}` : ''}`
          } : null}
          empty={L('خروجی معتبر در این بازه خوانده نشد.', 'No measured outflow was read in this window.')}
        />
      </div>
      {stockBottom ? (
        <div className="aig-note">
          {L('ضعیف‌ترین سهم خوانده‌شده: ', 'Weakest equity read: ')}{stockBottom.symbol} {pct(stockBottom.changePct)}
        </div>
      ) : null}
      {chainFlows ? (
        <div className="aig-note">
          {L('جریان استیبل‌کوین ۲۴ ساعتهٔ کل بازار: ', 'Whole-market 24h stablecoin flow: ')}
          {`${chainFlows.net24hUsd >= 0 ? '+' : '−'}$${isPersian ? faNum(fmtK(Math.abs(chainFlows.net24hUsd))) : fmtK(Math.abs(chainFlows.net24hUsd))}`}
          {chainFlows.source ? ` · ${sourceLabel(chainFlows.source, isPersian)}` : ''}
          {chainFlows.at ? ` · ${timeAgo(chainFlows.at, isPersian)}` : ''}
        </div>
      ) : null}
      <div className="aig-note">
        {L('این کارت‌ها فقط از ابزارهایی ساخته شده‌اند که منبع در همین دور خوانده است؛ نبود داده به‌صورت «خوانده نشد» نمایش داده می‌شود، نه با مقدار ساختگی. برچسب «منبع جایگزین» یعنی عدد از همان دور است ولی از میز دیگری خوانده شده.', 'These cards use only instruments read by the connected sources in this pass; missing data stays explicitly unread rather than becoming a fabricated value. A «fallback source» tag means the number is still from this pass, read by a different desk.')}
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
  const [data, setData] = useState({ intelligence: null, briefing: null, cross: null, providers: null, tomanRate: null, goldEtfs: null, flows: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
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
    const readTomanRate = async () => {
      if (language !== 'fa') return null;
      try {
        const response = await fetch(`${apiBase()}/iran/buy/rate`, { headers: { Accept: 'application/json' } });
        if (!response.ok) return { schema: 'fbt.iran-buy-rate.v1', available: false };
        const payload = await response.json();
        return payload?.schema === 'fbt.iran-buy-rate.v1'
          ? payload
          : { schema: 'fbt.iran-buy-rate.v1', available: false };
      } catch {
        return { schema: 'fbt.iran-buy-rate.v1', available: false };
      }
    };
    const readGoldEtfs = async () => {
      try {
        const response = await fetch(`${apiBase()}/etf?category=gold`, {
          headers: { Accept: 'application/json' }, cache: 'default'
        });
        const payload = await response.json().catch(() => null);
        const rows = payload?.ok === true && Array.isArray(payload.rows)
          ? payload.rows.filter((row) => row?.symbol && finiteMarketNumber(row.priceUsd) > 0).slice(0, 5)
          : [];
        return {
          available: rows.length > 0,
          rows,
          stale: payload?.meta?.stale === true || rows.some((row) => row.meta?.stale === true)
            || response.headers?.get?.('x-data-stale') === '1',
          at: marketEpoch(payload?.meta?.fetchedAt),
          reason: rows.length ? null : String(payload?.error || payload?.code || 'ETF_QUOTES_UNAVAILABLE').slice(0, 80)
        };
      } catch {
        return { available: false, rows: [], stale: false, at: null, reason: 'ETF_QUOTES_UNAVAILABLE' };
      }
    };
    try {
      if (refresh) setRefreshing(true);
      setConnectionError(null);
      const qs = refresh ? `?refresh=1&lang=${language}` : `?lang=${language}`;
      const results = await Promise.allSettled([
        readJson(`/ai/global/intelligence${qs}`),
        readJson(`/ai/global/briefing${qs}`),
        readJson(`/ai/global/cross-asset${qs}`),
        readJson('/ai/global/providers'),
        readTomanRate(),
        readGoldEtfs(),
        /* The capital-flow read is shared with the News → هوشمندی tab through
           lib/capitalFlows.js, so both surfaces cost ONE request per window
           even when the user switches between them. */
        getCapitalFlows({ force: refresh === true })
      ]);
      if (id !== requestId.current) return;
      const [intelRes, briefRes, crossRes, providerRes, rateRes, etfRes, flowRes] = results;
      const intel = intelRes.status === 'fulfilled' ? intelRes.value : null;
      const brief = briefRes.status === 'fulfilled' ? briefRes.value : null;
      const crossAsset = crossRes.status === 'fulfilled' ? crossRes.value : null;
      const providerState = providerRes.status === 'fulfilled' ? providerRes.value : null;
      const tomanRate = rateRes.status === 'fulfilled' ? rateRes.value : null;
      const goldEtfs = etfRes.status === 'fulfilled' ? etfRes.value : null;
      const flows = flowRes.status === 'fulfilled' ? flowRes.value : null;

      if (!intel && !brief && !crossAsset && !providerState) {
        throw (intelRes.reason || briefRes.reason || crossRes.reason || providerRes.reason || new Error('NETWORK_ERROR'));
      }

      setData({
        intelligence: intel?.globalIntelligence || null,
        briefing: brief?.briefing || null,
        cross: crossAsset || null,
        providers: providerState?.providers || intel?.globalIntelligence?.providers || null,
        tomanRate,
        goldEtfs,
        flows
      });
      setLoadedAt(Date.now());
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
  const commodityRows = useMemo(() => collectCommodityQuotes(cross, domains), [cross, domains]);
  const tomanReference = useMemo(() => inspectTomanReference(data.tomanRate), [data.tomanRate]);

  /* The WORLD CONSOLE sub-tabs (world state, globe, radar, causal, flow map,
     future tree + challenger, market DNA) all derive from this SAME pass
     payload — they add surface, not requests. */
  const worldData = useMemo(() => ({
    intelligence: data.intelligence,
    briefing: data.briefing,
    cross,
    flows: data.flows,
    toman: tomanReference,
    goldEtfs: data.goldEtfs
  }), [data.intelligence, data.briefing, cross, data.flows, tomanReference, data.goldEtfs]);

  /* The status report and the hero read ONE board derived from the same pass
     payload: every tile is a view of a calibrated station, so the number on a
     tile and the number on the station board can never disagree. */
  const board = useMemo(() => buildBriefingTiles(worldData), [worldData]);

  /* the server's own briefing messages, translated and labelled for the board */
  const briefingMessages = useMemo(() => briefingItems.map((item) => {
    const conf = item.confidence != null ? Math.round(item.confidence * 100) : null;
    return {
      id: item.id, kind: item.kind, priority: item.priority,
      priorityLabel: mapLabel(AIG_PRIORITY, item.priority, isPersian) || String(item.priority || '').toUpperCase(),
      kindLabel: mapLabel(AIG_KIND, item.kind, isPersian) || item.kind,
      title: isPersian && item.titleFa ? item.titleFa : item.title,
      detail: isPersian && item.detailFa ? item.detailFa : item.detail,
      sourceLabel: sourceLabel(item.source, isPersian),
      confidencePct: conf, confidencePctFa: conf === null ? null : worldFaNum(conf),
      to: item.action?.to || null
    };
  }), [briefingItems, isPersian]);

  /*
   * The nine cells of the header meter — one per domain, in the same order and
   * from the SAME `status` the domains tab prints, so the two can never
   * disagree. When the snapshot carries no domains object the meter falls back
   * to the count: «four answered, the rest unknown» is true, inventing nine
   * statuses would not be.
   */
  const meterCells = useMemo(() => {
    if (domains) return Object.keys(DOMAIN_META).map((k) => domains[k]?.status);
    const read = Number(data.intelligence?.available) || 0;
    return Array.from({ length: 9 }, (_, i) => (i < read ? 'OK' : 'UNAVAILABLE'));
  }, [domains, data.intelligence]);
  const meterClass = (status) => (status === 'OK' ? 'on' : status === 'PARTIAL' ? 'warn' : 'off');
  const regimeClass = cross?.regime?.regime ? String(cross.regime.regime).toLowerCase() : 'partial';

  /* ── per-domain one-line summaries (only what was actually read) ─────── */

  return (
    <div className="ai-global gw-root" dir={isRTL ? 'rtl' : 'ltr'}>
      <style>{STYLES}</style>
      <style>{WORLD_STYLES}</style>
      <style>{GLOBAL_PAGE_STYLES}</style>

      <HeroPanel
        L={L}
        isPersian={isPersian}
        working={loading || refreshing}
        available={data.intelligence ? Number(data.intelligence.available) : null}
        meterCells={meterCells}
        meterClass={meterClass}
        board={board}
        updatedLabel={loadedAt ? timeAgo(loadedAt, isRTL) : null}
      />

      <div className="aig-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`aig-tab ${tab === t.id ? 'active' : ''}`}
            style={{
              /* TAB_ACCENTS holds a PAIR per tab (accent + partner). Never assign
                 the array itself to a custom property: it is not a valid CSS
                 value and the icon silently falls back to grey. */
              '--tab-acc': (TAB_ACCENTS[t.icon] || [])[0] || 'var(--rgb-2)',
              '--tab-acc2': (TAB_ACCENTS[t.icon] || [])[1] || 'var(--rgb-1)'
            }}
            onClick={() => setTab(t.id)}
          >
            <span className="aig-sr">{t.marker}</span><span className="aig-tab-icon"><TabIcon name={t.icon} /></span><span>{t.id === 'briefing' ? L('گزارش وضعیت', 'Briefing')
              : t.id === 'world' ? L('وضعیت جهان', 'World state')
              : t.id === 'globe' ? L('کره زمین', 'Globe')
              : t.id === 'radar' ? L('رادار', 'Radar')
              : t.id === 'causal' ? L('زنجیره علت', 'Causal')
              : t.id === 'flows' ? L('جریان سرمایه', 'Flow map')
              : t.id === 'future' ? L('درخت آینده', 'Future tree')
              : t.id === 'dna' ? L('DNA بازار', 'Market DNA')
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

      {/* ── BRIEFING — the status report board ───────────────────────────── */}
      {tab === 'briefing' && (
        <BriefingPanel
          board={board}
          messages={briefingMessages}
          briefingAt={data.briefing?.at || null}
          ageLabel={data.briefing?.at ? timeAgo(data.briefing.at, isRTL) : null}
          unreadInputs={data.briefing?.missing?.length ? data.briefing.missing.map((m) => mapLabel(AIG_MISSING, m, isPersian) || m).join(isPersian ? '، ' : ', ') : null}
          L={L}
          isPersian={isPersian}
          onGoTab={setTab}
          navigate={navigate}
        />
      )}

      {/* ── WORLD CONSOLE — the sub-tabs ────────────────
         Everything below is drawn from the pass's own payload (worldData):
         gauges, weather, the globe, the radar, the causal chain, the capital
         flow map, the future tree + challenger, and market DNA. */}
      {tab === 'world' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <TabIconGadget name="world" />
            {L('وضعیت جهان مالی', 'Global financial state')}
            {data.intelligence ? <span className="aig-item-kind">{L('زنده از همین دور', 'live from this pass')}</span> : null}
          </div>
          <WorldStatePanel world={worldData} L={L} isPersian={isPersian} onGoTab={setTab} />
        </div>
      )}

      {tab === 'globe' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <TabIconGadget name="globeMap" />
            {L('کرهٔ اقتصاد جهانی', 'The global economy globe')}
          </div>
          <GlobePanel world={worldData} L={L} isPersian={isPersian} />
        </div>
      )}

      {tab === 'radar' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <TabIconGadget name="radar" />
            {L('رادار جهانی', 'Global Radar')}
          </div>
          <RadarPanel world={worldData} L={L} isPersian={isPersian} />
        </div>
      )}

      {tab === 'causal' && (
        <div className="aig-section">
          <CausalPanel world={worldData} L={L} isPersian={isPersian} />
        </div>
      )}

      {tab === 'flows' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <TabIconGadget name="flows" />
            {L('نقشهٔ جریان سرمایه جهانی', 'Global capital flow map')}
          </div>
          <FlowMapPanel world={worldData} L={L} isPersian={isPersian} />
        </div>
      )}

      {tab === 'future' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <TabIconGadget name="future" />
            {L('درخت آینده', 'Possible futures')}
          </div>
          <FutureTreePanel world={worldData} L={L} isPersian={isPersian} />
        </div>
      )}

      {tab === 'dna' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <TabIconGadget name="dna" />
            {L('DNA دارایی‌ها', 'Market DNA')}
          </div>
          <DnaPanel world={worldData} L={L} isPersian={isPersian} />
        </div>
      )}

      {/* ── DOMAINS — the nine intelligence domains ────────────────────── */}
      {tab === 'domains' && (
        <div className="aig-section">
          <div className="aig-section-title">
            <TabIconGadget name="domains" />
            {L('حوزه‌های داده هوش جهانی', 'Global intelligence domains')}
          </div>
          {domains ? (
            <DomainsView domains={domains} L={L} isPersian={isPersian} reasonLabel={reasonLabel} />
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
            <TabIconGadget name="cross" />
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
                     each with its own up/down/neutral marker. Reported again
                     as «دادهٔ کافی نیست»: the block now shows the weighted
                     reading, its coverage and every missing input with its
                     reason, instead of a bare UNAVAILABLE label. ─────────── */}
              {cross.outlook || cross.status === 'OK' || Object.keys(cross.classes || {}).length ? (
                <OutlookPanel world={worldData} L={L} isPersian={isPersian} />
              ) : null}

              {/* ── THE SYSTEM ANALYSIS — one box: the measured lines and,
                     when a provider answered, its synthesis inside it.
                     «این باکس را حذف کن و دوتا داده را داخل تحلیل سیستمی
                     باشد و تکراری نباشد» ─────────────────────────────── */}
              <SystemAnalysis cross={cross} L={L} isPersian={isPersian} />

              {/* ── the global-economy leaders, built from the instruments
                     this pass actually read ──────────────────────────── */}
              <EconomyLeaders cross={cross} domains={domains} flows={data.flows} L={L} isPersian={isPersian} />

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
          <CommodityQuotes rows={commodityRows} rate={tomanReference} domains={domains} L={L} isPersian={isPersian} isRTL={isRTL} />
          <GoldEtfQuotes market={data.goldEtfs} rate={tomanReference} L={L} isPersian={isPersian} isRTL={isRTL} />
        </div>
      )}

      {/* ── PROVIDERS — the five readiness lights per domain ───────────── */}
      {tab === 'providers' && (
        <div className="aig-section">
          <div className="aig-section-title"><TabIconGadget name="providers" /> {L('وضعیت پایداری منابع داده', 'Data provider status')}</div>
          <ProvidersPanel
            providers={data.providers}
            domains={domains}
            L={L}
            isPersian={isPersian}
            reasonLabel={reasonLabel}
          />

        </div>
      )}
    </div>
  );
}

export const AiGlobalIntelligence = memo(AiGlobalIntelligenceInner);
export default AiGlobalIntelligence;
