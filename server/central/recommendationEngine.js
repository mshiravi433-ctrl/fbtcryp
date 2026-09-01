/**
 * FBT CENTRAL INTELLIGENCE OS — Central Recommendation Engine (§26).
 * ---------------------------------------------------------------------------
 * A recommendation is ONLY produced from real data, and it always carries:
 *   { recommendation, reason[], data[], risk{}, confidence, alternatives[],
 *     actions[] }
 * No data → no recommendation (the brain says what is missing instead of
 * inventing advice).
 */
import { emptyRecommendation } from './constants.js';

/** Concentration recommendation (scenario B → action suggestions). */
export function concentrationRecommendation({ concentration, signals = null, news = null }) {
  const rec = emptyRecommendation();
  if (!concentration || concentration.dataStatus !== 'live' || !concentration.found) return rec;
  const { asset, assetSharePct, assetValueUsd, totalValueUsd } = concentration;

  if (!concentration.overThreshold) {
    rec.recommendation = `سهم ${asset} در پرتفوی شما ${assetSharePct}٪ است؛ در محدوده عادی تمرکز قرار دارد.`;
    rec.reason.push(`سهم فعلی ${asset} = ${assetSharePct}٪ (آستانه تمرکز: ${concentration.concentrationThresholdPct}٪)`);
    rec.data.push({ source: 'portfolio', metric: 'assetSharePct', value: assetSharePct });
    rec.confidence = 0.8;
    return rec;
  }

  rec.recommendation = `سهم ${asset} در پرتفوی ${assetSharePct}٪ است — بالاتر از آستانه تمرکز. کاهش تدریجی یا پوشش ریسک منطقی‌تر از نگهداری کامل است.`;
  rec.reason.push(`سهم ${asset} = ${assetSharePct}٪ از کل ${Number(totalValueUsd).toLocaleString('en-US')} دلار`);
  rec.reason.push(`HHI = ${concentration.hhi} — پرتفوی متمرکز (آستانه 0.45)`);
  rec.data.push({ source: 'portfolio', metric: 'hhi', value: concentration.hhi });
  rec.data.push({ source: 'portfolio', metric: 'assetValueUsd', value: assetValueUsd });

  const sig = signals?.rows?.find?.((r) => r.symbol === asset);
  if (sig) {
    rec.reason.push(`مومنتوم ۲۴ساعته ${asset}: ${sig.momentum} (تغییر ${sig.change24hPct ?? '—'}٪)`);
    rec.data.push({ source: 'signals', metric: 'momentum', value: sig.momentum });
    rec.confidence += 0.05;
  }
  if (news?.items?.length) {
    rec.reason.push(`${news.items.length} خبر اخیر درباره ${asset} ثبت شده — قبل از تصمیم مرور کنید.`);
    rec.data.push({ source: 'news', metric: 'items', value: news.items.length });
    rec.confidence += 0.05;
  }

  rec.risk = {
    type: 'CONCENTRATION',
    severity: assetSharePct > 60 ? 'HIGH' : 'MEDIUM',
    note: 'فروش یکجا ریسک قیمتی لحظه‌ای دارد؛ تقسیم به چند پله معمولاً کم‌هزینه‌تر است.'
  };
  rec.confidence = Math.min(0.95, rec.confidence || 0.7);
  rec.alternatives = [
    'تنظیم هشدار قیمت به‌جای فروش فوری',
    'استفاده از Lending برای کسب بازده روی دارایی بدون فروش'
  ];
  rec.actions = [
    { type: 'SELL', asset, module: 'swap', note: 'کاهش پله‌ای تمرکز', requiresConfirmation: true },
    { type: 'SET_ALERT', asset, module: 'alerts', note: 'هشدار افت قیمت', requiresConfirmation: false }
  ];
  return rec;
}

/** Loan safety recommendation (scenario F). */
export function loanSafetyRecommendation({ lendingRisk }) {
  const rec = emptyRecommendation();
  if (!lendingRisk || lendingRisk.dataStatus !== 'live') return rec;
  const hf = lendingRisk.healthFactor;
  rec.data.push({ source: 'lending', metric: 'healthFactor', value: hf });
  rec.data.push({ source: 'lending', metric: 'ltvPct', value: lendingRisk.ltvPct });
  rec.reason.push(`Collateral: $${lendingRisk.collateralUsd.toLocaleString('en-US')} / Borrowed: $${lendingRisk.borrowedUsd.toLocaleString('en-US')}`);
  rec.reason.push(`Health Factor = ${hf} — باند ریسک: ${lendingRisk.riskBand}`);
  if (lendingRisk.distanceToLiquidationPct != null) {
    rec.reason.push(`فاصله تا محدوده لیکوئید شدن حدود ${lendingRisk.distanceToLiquidationPct}٪ است.`);
  }
  if (hf == null || hf >= 2) {
    rec.recommendation = 'وام شما در محدوده امن است؛ افزایش وام با احتیاط تا سقف معقول امکان‌پذیر است.';
    rec.confidence = 0.8;
  } else if (hf >= 1.6) {
    rec.recommendation = 'وضعیت وام قابل قبول است اما نزدیک شدن به آستانه ریسک توصیه نمی‌شود؛ افزایش وام جدید انجام ندهید.';
    rec.confidence = 0.8;
  } else {
    rec.recommendation = 'وام در محدوده پرریسک است؛ بازپرداخت بخشی از بدهی یا افزایش وثیقه را در اولویت بگذارید.';
    rec.risk = { type: 'LIQUIDATION', severity: hf < 1.2 ? 'CRITICAL' : 'HIGH' };
    rec.actions.push({ type: 'REPAY', module: 'borrowing', requiresConfirmation: true, note: 'بازپرداخت بخشی از بدهی' });
    rec.confidence = 0.85;
  }
  return rec;
}

/** What-if narration (scenario G). */
export function whatIfRecommendation({ scenario }) {
  const rec = emptyRecommendation();
  if (!scenario || scenario.dataStatus !== 'live') return rec;
  rec.recommendation = `اگر ${scenario.asset} به‌اندازه ${scenario.dropPct}٪ بریزد، ارزش پرتفوی از $${scenario.beforeUsd.toLocaleString('en-US')} به $${scenario.afterUsd.toLocaleString('en-US')} می‌رسد (افت ${scenario.portfolioDropPct}٪).`;
  rec.reason.push(`ارزش فعلی ${scenario.asset}: $${scenario.assetValueUsd.toLocaleString('en-US')}`);
  rec.data.push({ source: 'portfolio', metric: 'scenarioLossUsd', value: scenario.lossUsd });
  if (scenario.liquidationWarning) {
    rec.reason.push(`Health Factor پس از شوک: ${scenario.liquidationWarning.postShockHealthFactor}${scenario.liquidationWarning.liquidates ? ' — منجر به لیکوئید شدن می‌شود!' : ''}`);
    rec.risk = { type: 'LIQUIDATION_UNDER_SHOCK', severity: scenario.liquidationWarning.liquidates ? 'CRITICAL' : 'MEDIUM' };
    rec.confidence = 0.85;
  } else {
    rec.confidence = 0.8;
  }
  rec.alternatives = ['کاهش سهم دارایی پرنوسان', 'تنظیم هشدار قیمت', 'پوشش با پوزیشن معکوس در Futures'];
  return rec;
}
