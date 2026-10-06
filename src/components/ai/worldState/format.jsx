/**
 * FBT WORLD CONSOLE — formatting helpers shared by the panels.
 * Pure (no state): Persian digits, signed percentages, compact dollars and the
 * evidence vocabulary the gauges print next to every direction.
 */
import { faNum as faNumRaw, pctFa, pctEn, usdCompact, usdFaCompact } from './worldModel.js';

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
  topInflowChain: { fa: 'بیشترین ورودی', en: 'top inflow' },
  topOutflowChain: { fa: 'بیشترین خروجی', en: 'top outflow' },
  ledgerEvents: { fa: 'رویداد دفتر کل', en: 'ledger events' },
  /* calibrated stations (2026-10) */
  dollar1d: { fa: 'دلار (۱ روز)', en: 'dollar 1d' },
  dollar7d: { fa: 'دلار (۷ روز)', en: 'dollar 7d' },
  dollarPrice: { fa: 'سطح شاخص', en: 'index level' },
  gold1d: { fa: 'طلا (۱ روز)', en: 'gold 1d' },
  gold7d: { fa: 'طلا (۷ روز)', en: 'gold 7d' },
  goldPrice: { fa: 'قیمت هر اونس', en: 'per ounce' },
  equity1d: { fa: 'سهام (۱ روز)', en: 'equities 1d' },
  equity7d: { fa: 'سهام (۷ روز)', en: 'equities 7d' },
  equityPrice: { fa: 'سطح', en: 'level' },
  inflationPrice: { fa: 'قیمت نفت', en: 'crude price' },
  bondsPrice: { fa: 'سطح', en: 'level' },
  bonds7d: { fa: 'بازده (۷ روز)', en: 'yield 7d' },
  yieldLevel: { fa: 'بازده ۱۰ ساله', en: '10y yield' },
  tlt1d: { fa: 'صندوق TLT (۱ روز)', en: 'TLT 1d' },
  btc1d: { fa: 'بیت‌کوین (۱ روز)', en: 'BTC 1d' },
  eth1d: { fa: 'اتریوم (۱ روز)', en: 'ETH 1d' },
  breadthShare: { fa: 'ارز صعودی', en: 'advancing' },
  marketsRead: { fa: 'بازار خوانده‌شده', en: 'markets read' },
  maxZ: { fa: 'بیشترین حرکت', en: 'largest move' },
  topWhale: { fa: 'بزرگ‌ترین انتقال', en: 'largest transfer' },
  macroHeadlines: { fa: 'خبر کلان', en: 'macro headlines' }
};

const MONEY_KEYS = new Set(['stablecoinNet', 'smartMoneyNet', 'smartMoneyAcc', 'smartMoneyDist', 'netUsd']);
const PCT_KEYS = new Set([
  'stablecoinNetPct', 'wti', 'brent', 'wti1d', 'brent1d', 'wti7d', 'dxy', 'dxy1d', 'dxy7d', 'classAvg', 'avgChange', 'maxClassMove',
  'dollar1d', 'dollar7d', 'gold1d', 'gold7d', 'equity1d', 'equity7d', 'bonds7d', 'tlt1d', 'btc1d', 'eth1d'
]);
const PRICE_KEYS = new Set(['dollarPrice', 'goldPrice', 'equityPrice', 'inflationPrice', 'bondsPrice']);

export function evidenceLabel(key, isPersian) {
  const m = EVIDENCE_META[key];
  return m ? (isPersian ? m.fa : m.en) : key;
}

const thousands = (n, isPersian) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const text = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
  return isPersian ? faNum(text).replace(/,/g, '\u066c') : text;
};

export function evidenceValue(key, value, isPersian) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return isPersian ? faNum(value) : value;
  if (MONEY_KEYS.has(key)) return isPersian ? usdFaCompact(value, { signed: false }) : usdCompact(value).replace('+', '');
  if (PCT_KEYS.has(key)) return pct(value, isPersian);
  if (PRICE_KEYS.has(key)) return thousands(value, isPersian);
  if (key === 'yieldLevel') return isPersian ? `${faNum(Number(value).toFixed(2))}\u066a` : `${Number(value).toFixed(2)}%`;
  if (key === 'maxZ') return isPersian ? `\u00d7${faNum(Number(value).toFixed(1))}` : `\u00d7${Number(value).toFixed(1)}`;
  if (key === 'curve2s10s') return isPersian ? `${faNum(value)} واحد` : `${value}pp`;
  return isPersian ? faNum(value) : String(value);
}

export function evidenceText(evidence, isPersian) {
  return (evidence || []).map((e) => `${evidenceLabel(e.key, isPersian)}: ${isPersian && e.valueFa !== undefined ? e.valueFa : evidenceValue(e.key, e.value, isPersian)}`).join(' · ');
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

export { usdCompact, usdFaCompact, pctFa, pctEn };
