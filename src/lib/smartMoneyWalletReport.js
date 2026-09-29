/**
 * SMART MONEY — the connected wallet's own intelligence, in the chat.
 * ---------------------------------------------------------------------------
 * Reported: «تحلیل وال اسمارت مانی هم باید باشه». The app HAS a real on-chain
 * intelligence layer (server/smartMoney, seven chains, verified swaps, scores
 * from observed behaviour) and it has a page — but Intent OS never asked it
 * anything about the wallet being used right now. Typing «کیف پول من را تحلیل
 * کن» produced a holdings answer with no smart-money layer, and the Smart Money
 * card in the menu simply navigated away.
 *
 * This module is the bridge: pure formatting of the server's answer, so the
 * chat's claims can be tested without a network. Everything here is either a
 * number the server returned with `dataStatus: 'live'` or an explicit absence —
 * no score, P&L or flow is ever invented, and an offline read is reported as
 * offline rather than rendered as a zero.
 */

const n = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const num = (v, d = 0) => (n(v) == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const pct = (v, d = 1) => (n(v) == null ? '—' : `${Number(v).toFixed(d)}%`);
const usd = (v, d = 0) => (n(v) == null ? '—' : `$${num(Math.abs(Number(v)), d)}`);
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a || '—'));
const dir = (v) => (n(v) == null ? '' : Number(v) >= 0 ? '▲' : '▼');

const TAG_FA = Object.freeze({
  SMART: 'هوشمند', WHALE: 'نهنگ', ACTIVE: 'فعال', FRESH: 'تازه‌ساخته',
  PROFITABLE: 'سودده', LOSING: 'در ضرر', INACTIVE: 'کم‌فعالیت', HIGH_RISK: 'پرخطر'
});

/** Which live sources actually answered — surfaced, never hidden. */
export function walletIntelSources(intel) {
  const s = intel?.sources || {};
  return Object.entries(s).filter(([, v]) => v === 'live').map(([k]) => k);
}

/**
 * Pure formatter for the analysis turn.
 * @returns {{ ok: boolean, code?: string, content: string, rows: Array, chips: Array }}
 */
export function formatSmartMoneyWalletReport({
  intel = null, overview = null, address = null, chainId = null, locale = 'fa', error = null
} = {}) {
  const fa = String(locale).startsWith('fa');
  const chips = [
    { id: 'open-smart-money', route: '/smart-money', label: fa ? 'صفحهٔ اسمارت مانی' : 'Smart Money page' }
  ];
  const addrLine = `${short(address)}${chainId ? ` · ${fa ? 'زنجیره' : 'chain'} ${chainId}` : ''}`;

  if (error || !intel) {
    return {
      ok: false,
      code: error || 'SMART_MONEY_UNAVAILABLE',
      content: fa
        ? `تحلیل اسمارت مانی این کیف پول در دسترس نیست (${error || 'SMART_MONEY_UNAVAILABLE'}). چیزی حدس نمی‌زنم و عدد ساختگی هم نمی‌سازم؛ چند لحظه بعد دوباره امتحان کن.`
        : `Smart-money intelligence for this wallet is unavailable (${error || 'SMART_MONEY_UNAVAILABLE'}). I will not guess or invent numbers; try again in a moment.`,
      rows: [], chips
    };
  }

  const status = String(intel.dataStatus || 'unavailable');
  const liveSources = walletIntelSources(intel);
  const score = n(intel.smartMoney?.score);
  const coverage = n(intel.smartMoney?.coverage);
  const rep = intel.reputation || null;
  const risk = intel.risk || null;
  const pnl = intel.pnl || null;
  const holdings = Array.isArray(intel.holdings) ? intel.holdings.slice(0, 5) : [];
  const tags = Array.isArray(intel.tags) ? intel.tags.slice(0, 4) : [];
  const tagText = tags.map((t) => (fa ? (TAG_FA[t] || t) : t)).join(' · ');

  const rows = [];
  if (score != null) rows.push({
    id: 'score', label: fa ? 'امتیاز اسمارت مانی' : 'Smart-money score',
    value: `${Math.round(score)}/100`, hint: coverage != null ? (fa ? `پوشش ${pct(coverage, 0)}` : `coverage ${pct(coverage, 0)}`) : null
  });
  if (rep?.score != null) rows.push({
    id: 'reputation', label: fa ? 'اعتبار' : 'Reputation', value: `${Math.round(Number(rep.score))}/100`,
    hint: rep.band || null
  });
  if (risk?.score != null) rows.push({
    id: 'risk', label: fa ? 'ریسک' : 'Risk', value: `${Math.round(Number(risk.score))}/100`, hint: risk.band || null
  });
  if (pnl?.realizedUsd != null) rows.push({
    id: 'pnl', label: fa ? 'سود/زیان محقق‌شده' : 'Realised P&L',
    value: `${dir(pnl.realizedUsd)} ${usd(pnl.realizedUsd)}`,
    hint: pnl.winRate != null ? (fa ? `نرخ برد ${pct(pnl.winRate, 0)}` : `win rate ${pct(pnl.winRate, 0)}`) : null
  });
  if (n(intel.portfolioUsd) != null) rows.push({
    id: 'portfolio', label: fa ? 'ارزش خوانده‌شده' : 'Read value', value: usd(intel.portfolioUsd), hint: null
  });

  const lines = [];
  if (fa) {
    lines.push(`تحلیل اسمارت مانی کیف پول ${addrLine}:`);
    if (status !== 'live') {
      lines.push(`وضعیت داده «${status}» است — پس هر عددی که سرویس نداده، این‌جا خالی می‌ماند (حدس نمی‌زنم).`);
    }
    if (score != null) {
      lines.push(`امتیاز رفتاری اسمارت مانی: ${Math.round(score)} از ۱۰۰${coverage != null ? ` (پوشش داده ${pct(coverage, 0)})` : ''}.`);
    } else {
      lines.push('امتیاز اسمارت مانی قابل محاسبه نبود: تاریخچهٔ معاملات این آدرس از منابع زنده کافی نبود.');
    }
    if (rep?.score != null) lines.push(`اعتبار: ${Math.round(Number(rep.score))}/100${rep.band ? ` (${rep.band})` : ''}.`);
    if (risk?.score != null) lines.push(`ریسک: ${Math.round(Number(risk.score))}/100${risk.band ? ` (${risk.band})` : ''}${Array.isArray(risk.reasons) && risk.reasons.length ? ` — ${risk.reasons.slice(0, 2).join('؛ ')}` : ''}.`);
    if (pnl?.realizedUsd != null) {
      lines.push(`سود/زیان محقق‌شده ${dir(pnl.realizedUsd)} ${usd(pnl.realizedUsd)}${pnl.winRate != null ? ` با نرخ برد ${pct(pnl.winRate, 0)}` : ''}${pnl.best ? ` — بهترین معامله ${pnl.best.symbol}` : ''}.`);
    }
    if (holdings.length) {
      lines.push(`دارایی‌ها: ${holdings.map((h) => `${String(h.symbol || '').toUpperCase()} ${n(h.valueUsd) != null ? usd(h.valueUsd) : ''}`.trim()).join('، ')}.`);
    }
    if (tagText) lines.push(`برچسب‌ها: ${tagText}.`);
    const flow = overview?.flows?.windows?.['24h'] || null;
    if (flow) {
      const net = n(flow.netUsd);
      lines.push(`جریان ۲۴ ساعتهٔ بازار: ورود ${usd(flow.inflowUsd)}، خروج ${usd(flow.outflowUsd)}${net != null ? ` ⇒ خالص ${dir(net)} ${usd(net)}` : ''}.`);
    }
    if (liveSources.length) lines.push(`منابع زنده: ${liveSources.join('، ')}.`);
    lines.push('این اعداد مشاهده‌اند، نه پیش‌بینی؛ هیچ سود یا قیمتی از آن‌ها وعده داده نمی‌شود.');
  } else {
    lines.push(`Smart-money analysis for wallet ${addrLine}:`);
    if (status !== 'live') lines.push(`Data status is “${status}” — anything the service did not return stays blank here (no guessing).`);
    if (score != null) lines.push(`Behavioural smart-money score: ${Math.round(score)} of 100${coverage != null ? ` (data coverage ${pct(coverage, 0)})` : ''}.`);
    else lines.push('The smart-money score could not be computed: not enough live trade history for this address.');
    if (rep?.score != null) lines.push(`Reputation: ${Math.round(Number(rep.score))}/100${rep.band ? ` (${rep.band})` : ''}.`);
    if (risk?.score != null) lines.push(`Risk: ${Math.round(Number(risk.score))}/100${risk.band ? ` (${risk.band})` : ''}.`);
    if (pnl?.realizedUsd != null) lines.push(`Realised P&L ${dir(pnl.realizedUsd)} ${usd(pnl.realizedUsd)}${pnl.winRate != null ? ` at a ${pct(pnl.winRate, 0)} win rate` : ''}.`);
    if (holdings.length) lines.push(`Holdings: ${holdings.map((h) => `${String(h.symbol || '').toUpperCase()} ${n(h.valueUsd) != null ? usd(h.valueUsd) : ''}`.trim()).join(', ')}.`);
    if (tagText) lines.push(`Tags: ${tagText}.`);
    const flow = overview?.flows?.windows?.['24h'] || null;
    if (flow) {
      const net = n(flow.netUsd);
      lines.push(`Market 24h flow: in ${usd(flow.inflowUsd)}, out ${usd(flow.outflowUsd)}${net != null ? ` ⇒ net ${dir(net)} ${usd(net)}` : ''}.`);
    }
    if (liveSources.length) lines.push(`Live sources: ${liveSources.join(', ')}.`);
    lines.push('These are observations, not forecasts; no profit or price is promised from them.');
  }

  return { ok: true, code: 'SMART_MONEY_WALLET_REPORT', content: lines.join('\n'), rows, chips, dataStatus: status };
}
