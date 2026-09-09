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
 * This screen is ADDITIVE (Phase 211 rule): it adds the /ai-global route and
 * one tile in the More sheet; it replaces and removes nothing. It talks to
 * the FI's own additive endpoints under /api/ai/global/*.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThinkingOrb } from './ThinkingOrb.jsx';

/* ── Styles (scoped, same visual language as the AI control center) ────── */
const STYLES = `
  .ai-global { width:100%; max-width:100%; box-sizing:border-box; padding:12px 14px 24px; min-height:100%; color:var(--text-1); overflow:hidden; }
  .aig-header { position:relative; display:flex; align-items:center; gap:12px; margin-bottom:16px; min-height:72px; padding:13px 14px; border:1px solid var(--line); border-radius:20px; background:linear-gradient(135deg,color-mix(in srgb,var(--rgb-1) 9%,var(--bg-panel-solid)),color-mix(in srgb,var(--rgb-2) 13%,var(--bg-panel-solid)) 55%,color-mix(in srgb,var(--rgb-3) 7%,var(--bg-panel-solid))); box-shadow:var(--glass-shadow); overflow:hidden; }
  .aig-header::after { content:""; position:absolute; width:100px; height:100px; inset-inline-end:-35px; top:-45px; border-radius:50%; background:var(--rgb-2); opacity:.12; filter:blur(22px); pointer-events:none; }
  .aig-title { flex:1; min-width:0; font-size:var(--fs-lg); line-height:var(--lh-tight); font-weight:800; color:var(--text-1); }
  .aig-chip { flex:0 0 auto; font-size:var(--fs-xs); font-weight:700; color:var(--rgb-2); background:color-mix(in srgb,var(--rgb-2) 13%,transparent); border:1px solid color-mix(in srgb,var(--rgb-2) 28%,transparent); padding:5px 9px; border-radius:999px; white-space:nowrap; }
  .aig-chip.warn { color:var(--rgb-5); background:color-mix(in srgb,var(--rgb-5) 12%,transparent); }
  .aig-chip.bad { color:var(--down); background:color-mix(in srgb,var(--down) 12%,transparent); }
  .aig-tabs { display:flex; gap:8px; margin:0 0 12px; padding:0; max-width:100%; box-sizing:border-box; }
  .aig-tab { flex:1 1 0; min-width:0; min-height:58px; padding:8px 6px; border-radius:14px; font:inherit; font-size:11px; font-weight:700; line-height:1.3; color:var(--text-2); background:var(--bg-panel); border:1px solid var(--line); cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; text-align:center; overflow-wrap:anywhere; transition:.2s ease; }
  .aig-tab-icon { width:22px; height:22px; display:grid; place-items:center; flex:0 0 22px; }
  .aig-tab-icon svg { width:100%; height:100%; }
  .aig-sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .aig-tab.active { color:var(--text-1); background:linear-gradient(135deg,color-mix(in srgb,var(--rgb-1) 13%,var(--bg-panel-solid)),color-mix(in srgb,var(--rgb-2) 15%,var(--bg-panel-solid))); border-color:color-mix(in srgb,var(--rgb-2) 45%,var(--line)); box-shadow:inset 0 -2px var(--rgb-1),0 6px 18px color-mix(in srgb,var(--rgb-2) 13%,transparent); transform:translateY(-1px); }
  .aig-refresh { width:100%; min-height:46px; margin-bottom:var(--sp-4); color:var(--text-1); background:var(--bg-raised); border:1px solid var(--line-strong); border-radius:var(--radius-sm); font:inherit; font-size:var(--fs-sm); font-weight:700; cursor:pointer; }
  .aig-refresh:disabled { opacity:.6; cursor:wait; }
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
  @media (max-width:360px) { .ai-global { padding-inline:12px; } .aig-title { font-size:18px; } .aig-chip { font-size:10px; padding-inline:7px; } .aig-tabs { gap:6px; } .aig-tab { font-size:10px; min-height:56px; padding-inline:4px; } .aig-section { padding:13px; } }
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
    briefing: <><path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M8.5 8.5h6M8.5 12h6M8.5 15.5h4"/><path d="M18 8h1a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-1"/></>,
    domains: <><circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5C9.8 18.2 8.7 15.4 8.7 12S9.8 5.8 12 3.5z"/></>,
    cross: <><path d="M4 7h11.5a3.5 3.5 0 0 1 3.5 3.5V20"/><path d="m16 17 3 3 3-3"/><path d="M4 17h5.5a3.5 3.5 0 0 0 3.5-3.5V4"/><path d="m10 7 3-3 3 3"/></>,
    providers: <><path d="M9 4v5M15 4v5M7 9h10v2a5 5 0 0 1-5 5v4"/><path d="M9 20h6"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const DOMAIN_META = {
  smart_money: { icon: '🧠', fa: 'پول هوشمند', en: 'Smart money' },
  whales: { icon: '🐋', fa: 'نهنگ‌ها', en: 'Whales' },
  onchain: { icon: '⛓️', fa: 'روی زنجیره', en: 'On-chain' },
  news: { icon: '📰', fa: 'اخبار', en: 'News' },
  macro: { icon: '🏛️', fa: 'کلان', en: 'Macro' },
  stocks: { icon: '📈', fa: 'سهام', en: 'Stocks' },
  forex: { icon: '💱', fa: 'فارکس', en: 'Forex' },
  commodities: { icon: '🛢️', fa: 'کالاها', en: 'Commodities' },
  rwa: { icon: '🏛️', fa: 'دارایی واقعی', en: 'RWA' }
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
  MACRO_IS_DERIVED: { fa: 'کلان از خبر ساخته می‌شود', en: 'macro is derived from news' },
  MACRO_NEEDS_NEWS_AND_QUOTES: { fa: 'کلان به خبر یا داده کلان نیاز دارد', en: 'macro needs news or macro data' },
  NO_MACRO_HEADLINES_IN_WINDOW_AND_NO_QUOTES: { fa: 'نه خبر کلان و نه داده کلان در این بازه', en: 'no macro headlines or quotes in this window' },
  NO_MACRO_DATA_SOURCE: { fa: 'هیچ منبع داده کلان پاسخ نداد', en: 'no macro data source answered' }
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

function AiGlobalIntelligenceInner() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState('briefing');
  const [data, setData] = useState({ intelligence: null, briefing: null, cross: null, providers: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const language = String(i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const isPersian = language === 'fa';
  const isRTL = ['fa', 'ar', 'ur'].includes(language);
  const L = (fa, en) => (isPersian ? fa : en);

  const load = useCallback(async (refresh = false) => {
    const readJson = async (url) => {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || 'INVALID_RESPONSE');
      return payload;
    };
    try {
      if (refresh) setRefreshing(true);
      setConnectionError(null);
      const qs = refresh ? '?refresh=1' : '';
      const [intel, brief, crossAsset, providerState] = await Promise.all([
        readJson(`/api/ai/global/intelligence${qs}`),
        readJson(`/api/ai/global/briefing${qs}`),
        readJson('/api/ai/global/cross-asset'),
        readJson('/api/ai/global/providers')
      ]);
      setData({
        intelligence: intel.globalIntelligence || null,
        briefing: brief.briefing || null,
        cross: crossAsset || null,
        providers: providerState.providers || intel.globalIntelligence?.providers || null
      });
    } catch (error) {
      setConnectionError(error?.message || 'NETWORK_ERROR');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
            <span className="aig-sr">{t.marker}</span><span className="aig-tab-icon"><TabIcon name={t.icon} /></span><span>{t.id === 'briefing' ? L('بریفینگ', 'Briefing')
              : t.id === 'domains' ? L('دامنه‌ها', 'Domains')
              : t.id === 'cross' ? L('کراس-است', 'Cross-asset')
              : L('ارائه‌دهنده‌ها', 'Providers')}</span>
          </button>
        ))}
      </div>
      <button type="button" className="aig-refresh" onClick={() => load(true)} disabled={refreshing}>
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
            📰 {L('بریفینگ فعال هوش مصنوعی', 'Proactive AI briefing')}
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
          <div className="aig-section-title">🌍 {L('دامنه‌های هوش جهانی', 'Global intelligence domains')}</div>
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
                      {meta.icon} {isPersian ? meta.fa : meta.en}
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
          <div className="aig-section-title">🔀 {L('تحلیل کراس-است', 'Cross-asset intelligence')}</div>
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

              {/* ── THE ECONOMIC OUTLOOK (Phase 211.1) — the now AND the
                     direction: growth watch / recession watch, each named
                     signal citing the real read behind it ─────────────── */}
              {cross.outlook && (cross.outlook.label || cross.outlook.signals?.length) ? (
                <div className={`aig-outlook ${cross.outlook.label === 'GROWTH_WATCH' ? 'growth' : cross.outlook.label === 'RECESSION_WATCH' ? 'recession' : ''}`}>
                  <div className="aig-outlook-head">
                    <div className="aig-section-title" style={{ marginBottom: 0 }}>🌐 {L('چشم‌انداز اقتصادی', 'Economic outlook')}</div>
                    <span className="aig-outlook-score" style={{ color: cross.outlook.score > 0 ? 'var(--up)' : cross.outlook.score < 0 ? 'var(--down)' : 'var(--text-1)' }}>
                      {cross.outlook.label !== 'UNAVAILABLE'
                        ? `${mapLabel(AIG_OUTLOOK, cross.outlook.label, isPersian) || String(cross.outlook.label).replace(/_/g, ' ')}${cross.outlook.score != null ? ` · ${cross.outlook.score > 0 ? '+' : ''}${cross.outlook.score}` : ''}`
                        : L('دادهٔ کافی نیست', 'no data yet')}
                    </span>
                  </div>
                  <div className="aig-regime-sub">
                    {L('حال: ', 'now: ')}{cross.outlook.currentState?.regime ? mapLabel(AIG_REGIME, cross.outlook.currentState.regime, isPersian) || cross.outlook.currentState.regime : '—'}
                    {L(' · جهت کوتاه‌مدت از سیگنال‌های زیر', ' · short-term direction from the signals below')}
                  </div>
                  {(cross.outlook.signals || []).map((s) => (
                    <div key={s.id} className="aig-signal">
                      <span className={`aig-signal-dir ${s.direction}`}>{mapLabel(AIG_DIRECTION, s.direction, isPersian) || s.direction}</span>
                      <div className="aig-signal-body">
                        <div className="aig-signal-name">{s.name}{s.source ? ` · ${sourceLabel(s.source, isPersian)}` : ''}</div>
                        <div className="aig-signal-ev">{s.evidence}</div>
                      </div>
                    </div>
                  ))}
                  <div className="aig-note">
                    {L('ترکیب وزن‌دار خوانش‌های واقعی همین دور — داده، نه پیش‌بینی قطعی.', 'A weighted reading of this pass\u2019s real reads — data, not a guaranteed forecast.')}
                  </div>
                </div>
              ) : null}
              <div className="aig-grid">
                {Object.entries(cross.classes || {}).filter(([, c]) => c).map(([cls, c]) => (
                  <div key={cls} className="aig-card">
                    <div className="aig-card-name">{mapLabel(AIG_CLASS, cls, isPersian) || cls}</div>
                    <div className="aig-card-value" style={{ color: c.avgChangePct > 0 ? '#4ade80' : c.avgChangePct < 0 ? '#f87171' : '#f0f0ff' }}>
                      {c.avgChangePct > 0 ? '+' : ''}{c.avgChangePct?.toFixed(2)}%
                    </div>
                    <div className="aig-card-sub">{c.advancing}/{c.withChange} {L('در صعود', 'advancing')}</div>
                  </div>
                ))}
              </div>

              {/* ── the macro indicator layer — real quotes (dollar/gold/
                     crude/equity/rates/curve) with 1d + 7d changes ─────── */}
              {cross.macro?.indicators?.length ? (
                <>
                  <div className="aig-section-title" style={{ marginTop: 10, marginBottom: 6 }}>🏛️ {L('نشانگرهای کلان (۲۴س و ۷روز)', 'Macro indicators (1d / 7d)')}</div>
                  <div className="aig-grid">
                    {cross.macro.indicators.map((q) => (
                      <div key={q.symbol} className="aig-card">
                        <div className="aig-card-name">{q.symbol}{q.name ? <span style={{ color: 'var(--text-3)' }}> {q.name}</span> : null}</div>
                        <div className="aig-card-value" style={{ fontSize: 'var(--fs-md)' }}>
                          {q.priceUsd != null ? (q.priceUsd >= 100 ? q.priceUsd.toFixed(1) : q.priceUsd.toFixed(2)) : '—'}
                        </div>
                        <div className="aig-card-sub">
                          <span className="aig-ind-chg" style={{ color: q.change1dPct > 0 ? '#4ade80' : q.change1dPct < 0 ? '#f87171' : 'var(--text-2)' }}>
                            {q.change1dPct != null ? `${q.change1dPct > 0 ? '+' : ''}${q.change1dPct}% 1d` : L('۱روز: —', '1d: —')}
                          </span>
                          {' · '}
                          <span className="aig-ind-chg" style={{ color: q.change7dPct > 0 ? '#4ade80' : q.change7dPct < 0 ? '#f87171' : 'var(--text-2)' }}>
                            {q.change7dPct != null ? `${q.change7dPct > 0 ? '+' : ''}${q.change7dPct}% 7d` : L('۷روز: —', '7d: —')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {cross.macro.curve ? (
                    <div className="aig-note" style={{ color: cross.macro.curve.spreadPct < 0 ? 'var(--down)' : 'var(--text-2)' }}>
                      {L('منحنی بهره ۲/۱۰: ', '2s10s curve: ')}
                      {cross.macro.curve.spreadPct}pp
                      {cross.macro.curve.spreadPct < 0
                        ? ` — ${L('منحنی وارون؛ نشانهٔ کلاسیک ریسک رکود', 'inverted — the classic recession-risk gauge')}`
                        : ` — ${L('منحنی طبیعی', 'positive')}`}
                    </div>
                  ) : null}
                </>
              ) : null}
              {cross.divergences?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div className="aig-section-title" style={{ marginBottom: 6 }}>↔️ {L('واگرایی‌ها', 'Divergences')}</div>
                  {cross.divergences.map((d, i) => (
                    <div key={i} className="aig-item-detail" style={{ marginBottom: 4 }}>
                      {mapLabel(AIG_CLASS, d.classes[0], isPersian) || d.classes[0]} {d.avgChangePct[d.classes[0]]}% × {mapLabel(AIG_CLASS, d.classes[1], isPersian) || d.classes[1]} {d.avgChangePct[d.classes[1]]}% ({d.gapPct}pp)
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
                ? `${L('کلاس‌های خوانده‌نشده:', 'unread classes:')} ${cross.missing.map((c) => mapLabel(AIG_CLASS, c, isPersian) || mapLabel(AIG_MISSING, c, isPersian) || c).join(isPersian ? '، ' : ', ')}`
                : L('تحلیل کراس-است هنوز محاسبه نشده.', 'Cross-asset analysis has not been computed yet.')}
            </div>
          )}
        </div>
      )}

      {/* ── PROVIDERS — the five readiness lights per domain ───────────── */}
      {tab === 'providers' && (
        <div className="aig-section">
          <div className="aig-section-title">🔌 {L('چراغ‌های آمادگی ارائه‌دهنده', 'Provider readiness lights')}</div>
          {data.providers ? (
            <>
              {Object.entries(data.providers).map(([name, p]) => (
                <div key={name} className="aig-light">
                  <span className="aig-light-name">
                    {DOMAIN_META[name]?.icon || '•'} {DOMAIN_META[name] ? (isPersian ? DOMAIN_META[name].fa : DOMAIN_META[name].en) : name}
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
