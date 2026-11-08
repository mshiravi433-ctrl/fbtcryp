import React, { useState } from 'react';
import '../../styles/opportunity-dashboard.css';

const categories = {
  LIQUIDITY_POOL: ['استخر نقدینگی', 'Liquidity pools'], FARMING: ['فارمینگ', 'Farming'],
  LENDING: ['وام‌دهی', 'Lending'], ARBITRAGE: ['آربیتراژ', 'Arbitrage'],
  EMERGING_TOKEN: ['توکن نوظهور', 'Emerging tokens'], RWA: ['دارایی واقعی', 'Real-world assets'],
  WHALE_FLOW: ['جریان نهنگ‌ها', 'Whale flows']
};
const money = (v) => v == null || !Number.isFinite(Number(v)) ? '—' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const n = (v) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function OpportunityDashboard({ scan, locale = 'fa', onRescan }) {
  const fa = locale.startsWith('fa');
  const t = (a, b) => fa ? a : b;
  const [capital, setCapital] = useState(scan.profile?.capitalUsd || '');
  const [risk, setRisk] = useState(scan.profile?.riskProfile || 'MODERATE');
  const [days, setDays] = useState(scan.profile?.horizonDays || 30);
  const [filter, setFilter] = useState('ALL');
  const [showRejected, setShowRejected] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = showRejected ? scan.rejected || [] : scan.opportunities || [];
  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.category === filter);
  const submit = async (e) => {
    e.preventDefault();
    if (!onRescan || busy) return;
    setBusy(true);
    try { await onRescan({ capitalUsd: Number(capital) || 0, riskProfile: risk, horizonDays: Number(days) }); }
    finally { setBusy(false); }
  };
  return <section className="opd" data-testid="opportunity-dashboard" dir={fa ? 'rtl' : 'ltr'}>
    <header className="opd-head"><div><span className="opd-eyebrow">✦ FBT INTELLIGENCE / OPPORTUNITY RADAR</span><h3>{t('رادار هوشمند فرصت‌ها', 'Intelligent opportunity radar')}</h3><p>{t('داده‌های موجود، تحلیل شفاف، تصمیم با شما', 'Available data, transparent analysis, your decision')}</p></div><span className="opd-status">● {scan.dataStatus === 'live' ? t('اسکن انجام شد', 'SCANNED') : t('داده محدود', 'LIMITED')}</span></header>
    <div className="opd-stats"><div><small>{t('بررسی‌شده', 'Candidates')}</small><b>{Object.values(scan.coverage || {}).reduce((a, b) => a + b, 0)}</b></div><div><small>{t('متناسب با معیارها', 'Eligible')}</small><b>{scan.eligibleTotal ?? scan.total}</b></div><div><small>{t('خارج از معیار', 'Excluded')}</small><b>{scan.rejectedTotal}</b></div><div><small>CORTEX</small><b>{scan.cortex?.connected ? t('متصل', 'Connected') : t('ناموجود', 'Unavailable')}</b></div></div>
    <form className="opd-form" onSubmit={submit}>
      <label>{t('سرمایه قابل سرمایه‌گذاری ($)', 'Investable capital ($)')}<input type="number" min="0" max="1000000000" step="any" value={capital} onChange={(e) => setCapital(e.target.value)} placeholder={t('مبلغ را وارد کنید', 'Enter amount')} /></label>
      <label>{t('میزان ریسک', 'Risk profile')}<select value={risk} onChange={(e) => setRisk(e.target.value)}><option value="CONSERVATIVE">{t('محافظه‌کار', 'Conservative')}</option><option value="MODERATE">{t('متوسط', 'Moderate')}</option><option value="BALANCED">{t('متعادل', 'Balanced')}</option><option value="AGGRESSIVE">{t('جسورانه', 'Aggressive')}</option></select></label>
      <label>{t('افق (روز)', 'Horizon (days)')}<input type="number" min="1" max="3650" required value={days} onChange={(e) => setDays(e.target.value)} /></label>
      <button disabled={busy || !onRescan} type="submit">↻ {busy ? t('در حال بررسی', 'Scanning') : t('اسکن مجدد', 'Rescan')}</button>
    </form>
    {!scan.profile?.capitalUsd && <p className="opd-notice">{t('برای محاسبه سود و کارمزد، سرمایه قابل سرمایه‌گذاری را وارد و اسکن را تکرار کنید. ارزش کل کیف پول به معنی سرمایه آزاد نیست.', 'Enter investable capital and rescan to estimate profit and fees. Total wallet value is not assumed to be available capital.')}</p>}
    <div className="opd-section-title"><b>{t('پوشش منابع', 'Source coverage')}</b><small>{t('فقط منابع متصل؛ نه کل بازار', 'Connected sources only; not the entire market')}</small></div>
    <div className="opd-coverage">{(scan.coverageDetails || []).map((c) => <button type="button" key={c.category} className={filter === c.category ? 'active' : ''} onClick={() => setFilter(filter === c.category ? 'ALL' : c.category)}><span>{categories[c.category]?.[fa ? 0 : 1]}</span><small>{c.status === 'live' || c.status === 'observed' ? `${c.count} ${t('مورد', 'rows')}` : c.status === 'empty' ? t('بدون مورد', 'No rows') : c.status === 'insufficient-evidence' ? t('شواهد ناکافی', 'Insufficient evidence') : t('منبع ناموجود', 'Source unavailable')}</small></button>)}</div>
    <p className="opd-provenance">{t('نرخ‌ها از فهرست محدود بازده، توکن‌های نوظهور از استخرهای جدید و نهنگ‌ها از مبادلات تأییدشده‌اند. RWA دسته‌بندی توکن‌های مرتبط است، نه لزوماً مالکیت دارایی؛ فقط قیمت بازار نمایش داده می‌شود؛ آربیتراژ نیازمند قیمت هم‌زمان قابل‌اجراست.', 'Rates use the bounded yield feed, emerging tokens use new pools, and whale signals use verified swaps. RWA rows are sector-token prices, not necessarily ownership of underlying assets; arbitrage needs simultaneous executable quotes.')} {scan.sources?.yields?.at ? `${t('زمان نرخ‌ها:', 'Rates as of:')} ${new Date(scan.sources.yields.at).toLocaleString(fa ? 'fa-IR' : undefined)}` : ''} · {t('زمان اسکن:', 'Scanned:')} {new Date(scan.updatedAt).toLocaleString(fa ? 'fa-IR' : undefined)}</p>
    <div className="opd-section-title"><b>{showRejected ? t('خارج از معیارهای شما', 'Outside your criteria') : t('فرصت‌های رتبه‌بندی‌شده', 'Ranked opportunities')}</b><button type="button" onClick={() => setShowRejected(!showRejected)}>{showRejected ? t('نمایش برگزیده‌ها', 'Show eligible') : `${t('بررسی موارد حذف‌شده', 'Review excluded')} (${scan.rejectedTotal})`}</button></div>
    {!showRejected && scan.eligibleTotal > scan.total && <p className="opd-provenance">{t('۳۰ رتبهٔ نخست نمایش داده می‌شوند.', 'Showing the top 30 ranks.')}</p>}
    <div className="opd-results">{filtered.length ? filtered.map((o, i) => <article className="opd-card" key={o.opportunityId}><div className="opd-card-top"><span className="opd-rank">{showRejected ? '×' : `#${o.rank || i + 1}`}</span><div><small>{categories[o.category]?.[fa ? 0 : 1]} · {o.chain || '—'}</small><strong>{o.title}</strong></div><span className="opd-score">{n(o.score)}<small>/ 100</small></span></div>
      <div className="opd-metrics"><div><small>{t('سود خالص تخمینی', 'Estimated net')}</small><b>{money(o.economics?.netProfitUsd)}</b></div><div><small>{t('کارمزد تخمینی', 'Estimated fees')}</small><b>{money(o.economics?.fees?.totalUsd ?? o.feesIfActedUsd)}</b></div><div><small>{t('ریسک مدل', 'Model risk')}</small><b>{n(o.risk?.score)} / 10</b></div><div><small>{o.category === 'ARBITRAGE' ? t('بازده خالص یک‌بار', 'Net one-off') : t('بازده خالص سالانه', 'Net annualized')}</small><b>{(o.category === 'ARBITRAGE' ? o.economics?.netReturnPct : o.economics?.netApyPct) == null ? '—' : `${n(o.category === 'ARBITRAGE' ? o.economics.netReturnPct : o.economics.netApyPct)}%`}</b></div></div>
      {o.evidence?.map((e, j) => <p className="opd-evidence" key={j}>{e.detail}</p>)}
      {showRejected && <p className="opd-warning">{(o.exclusionReasons || []).map((x) => x.code === 'risk-above-tolerance' ? t('ریسک بالاتر از حد انتخابی', 'Risk above tolerance') : x.code === 'capital-below-min-viable' ? t('سرمایه کمتر از حد لازم', 'Capital below minimum') : t('سود پس از هزینه مثبت نیست', 'Net profit is not positive')).join(' · ')}</p>}
      <details><summary>{t('جزئیات محاسبه و ریسک', 'Fee and risk details')}</summary><p>{t('سود ناخالص', 'Gross')} {money(o.economics?.grossProfitUsd)} · {t('شبکه', 'Network')} {money(o.economics?.fees?.networkGasUsd)} · {t('ورود/خروج', 'Entry/exit')} {money(o.economics?.fees ? o.economics.fees.swapEntryUsd + o.economics.fees.swapExitUsd : null)} · {t('لغزش', 'Slippage')} {money(o.economics?.fees?.slippageUsd)}</p><p>{t('سربه‌سر (روز)', 'Break-even (days)')}: {n(o.economics?.breakEvenDays)} · {t('حداقل سرمایه برآوردی', 'Estimated minimum capital')}: {money(o.economics?.minViableCapitalUsd)}</p><p>{Object.entries(o.risk?.components || {}).filter(([, v]) => v != null).map(([k,v]) => `${k}: ${n(v)}`).join(' · ')}</p></details>
    </article>) : <p className="opd-empty">{t('در این دسته موردی برای نمایش نیست؛ پوشش و موارد حذف‌شده را بررسی کنید.', 'No rows here. Check coverage and excluded candidates.')}</p>}</div>
    <p className="opd-disclaimer">{t('بازده بر اساس نرخ فعلی و افق انتخابی تخمین زده می‌شود؛ نرخ، گس و لغزش تغییر می‌کنند. ریسک مدل تقریبی است و همه خطرات را پوشش نمی‌دهد. جریان نهنگ پیش‌بینی سود نیست. این توصیه مالی یا تضمین سود نیست.', 'Yield is estimated from the current rate and selected horizon; rates, gas and slippage change. Model risk is approximate and incomplete. Whale flow is not a return forecast. Not financial advice or a guarantee.')}</p>
  </section>;
}
