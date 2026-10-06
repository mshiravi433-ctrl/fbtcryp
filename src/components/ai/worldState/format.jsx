/**
 * FBT WORLD CONSOLE — formatting helpers shared by the panels.
 * Pure (no state): Persian digits, signed percentages, compact dollars and the
 * evidence vocabulary the gauges print next to every direction.
 */
import { faNum as faNumRaw, pctFa, pctEn, usdCompact } from './worldModel.js';

export const faNum = faNumRaw;

export const pct = (v, isPersian, d = 2) => (
  v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : (isPersian ? pctFa(v, d) : pctEn(v, d))
);

export const moneyK = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};

/** Evidence keys → bilingual labels (the panel prints these, never raw keys). */
export const EVIDENCE_META = {
  stablecoinNet: { fa: 'نتیجهٔ استیبل‌کوین', en: 'stablecoin net' },
  stablecoinNetPct: { fa: 'درصد تغییر استیبل‌کوین', en: 'stablecoin net %' },
  smartMoneyNet: { fa: 'نتیجهٔ پول هوشمند', en: 'smart-money net' },
  smartMoneyAcc: { fa: 'انباشت برچسب‌دار', en: 'labelled accumulation' },
  smartMoneyDist: { fa: 'توزیع برچسب‌دار', en: 'labelled distribution' },
  regime: { fa: 'رژیم', en: 'regime' },
  outlookScore: { fa: 'امتیاز چشم‌انداز', en: 'outlook score' },
  wti: { fa: 'نفت', en: 'WTI' },
  brent: { fa: 'برنت', en: 'Brent' },
  wti1d: { fa: 'نفت (۱ روز)', en: 'WTI 1d' },
  brent1d: { fa: 'برنت (۱ روز)', en: 'Brent 1d' },
  wti7d: { fa: 'نفت (۷ روز)', en: 'WTI 7d' },
  dxy: { fa: 'شاخص دلار', en: 'DXY' },
  dxy1d: { fa: 'شاخص دلار (۱ روز)', en: 'DXY 1d' },
  dxy7d: { fa: 'شاخص دلار (۷ روز)', en: 'DXY 7d' },
  curve2s10s: { fa: 'شیب ۲/۱۰', en: '2s10s curve' },
  classAvg: { fa: 'میانگین کلاس', en: 'class avg' },
  classesRead: { fa: 'کلاس خوانده‌شده', en: 'classes read' },
  advancing: { fa: 'صعودی', en: 'advancing' },
  topToken: { fa: 'برترین توکن', en: 'top token' },
  netUsd: { fa: 'جریان خالص', en: 'net flow' },
  headlines: { fa: 'سرفصل‌ها', en: 'headlines' },
  geopoliticsTopic: { fa: 'موضوع ژئوپلیتیک', en: 'geopolitics topic' },
  instruments: { fa: 'ابزارها', en: 'instruments' },
  avgChange: { fa: 'تغییر میانگین', en: 'avg change' },
  maxClassMove: { fa: 'بیشترین حرکت کلاس', en: 'max class move' },
  whaleEvents: { fa: 'رویداد نهنگ', en: 'whale events' },
  healthySources: { fa: 'منبع سالم', en: 'healthy sources' },
  downSources: { fa: 'منبع خاموش', en: 'sources down' },
  window: { fa: 'پنجره', en: 'window' },
  topInflowChain: { fa: 'برترین زنجیرهٔ ورودی', en: 'top inflow chain' },
  ledgerEvents: { fa: 'رویداد دفتر کل', en: 'ledger events' }
};

const MONEY_KEYS = new Set(['stablecoinNet', 'smartMoneyNet', 'smartMoneyAcc', 'smartMoneyDist', 'netUsd']);
const PCT_KEYS = new Set(['stablecoinNetPct', 'wti', 'brent', 'wti1d', 'brent1d', 'wti7d', 'dxy', 'dxy1d', 'dxy7d', 'classAvg', 'avgChange', 'maxClassMove']);

export function evidenceLabel(key, isPersian) {
  const m = EVIDENCE_META[key];
  return m ? (isPersian ? m.fa : m.en) : key;
}

export function evidenceValue(key, value, isPersian) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (MONEY_KEYS.has(key)) return usdCompact(value).replace('+', '');
  if (PCT_KEYS.has(key)) return pct(value, isPersian);
  if (key === 'curve2s10s') return isPersian ? `${faNum(value)} واحد` : `${value}pp`;
  return isPersian ? faNum(value) : String(value);
}

export function evidenceText(evidence, isPersian) {
  return (evidence || []).map((e) => `${evidenceLabel(e.key, isPersian)}: ${evidenceValue(e.key, e.value, isPersian)}`).join(' · ');
}

/** A short relative time in the reader's language. */
export function timeAgo(at, isPersian) {
  const t = Number(at);
  if (!Number.isFinite(t) || t <= 0) return null;
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  const m = Math.round(s / 60);
  const h = Math.round(m / 60);
  if (isPersian) {
    if (s < 90) return `${faNum(s)} ثانیه پیش`;
    if (m < 90) return `${faNum(m)} دقیقه پیش`;
    return `${faNum(h)} ساعت پیش`;
  }
  if (s < 90) return `${s}s ago`;
  if (m < 90) return `${m}m ago`;
  return `${h}h ago`;
}

export { usdCompact, pctFa, pctEn };
