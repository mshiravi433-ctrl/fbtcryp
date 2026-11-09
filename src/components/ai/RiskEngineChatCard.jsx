import { useMemo } from 'react';
import { useRiskEngine } from '../../hooks/useRiskEngine.js';
import '../../styles/intent-risk-chat.css';

/** Read-only portfolio risk answer rendered inside the Intent AI conversation. */
export default function RiskEngineChatCard({ locale = 'en' }) {
  const fa = String(locale).startsWith('fa');
  const { loading, connected, report, evidence } = useRiskEngine({ enabled: true });
  const score = report?.score || {};
  const families = useMemo(() => (report?.families || [])
    .filter((family) => family.score != null)
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, 4), [report?.families]);
  const band = fa ? score.band?.fa : score.band?.en;

  return (
    <section className="intent-risk-answer" data-testid="intent-risk-answer" aria-live="polite">
      <header>
        <strong>{fa ? 'ارزیابی ریسک پرتفوی' : 'Portfolio risk assessment'}</strong>
        <span>{loading ? (fa ? 'در حال خواندن داده‌ها…' : 'Reading evidence…') : connected ? (fa ? 'دادهٔ کیف پول' : 'Wallet evidence') : (fa ? 'بدون اتصال کیف پول' : 'No connected wallet')}</span>
      </header>
      <div className="intent-risk-score">
        <b>{score.value == null ? '—' : Math.round(score.value)}<small>/100</small></b>
        <span>{band || (fa ? 'اندازه‌گیری‌نشده' : 'Unmeasured')}</span>
        <span>{fa ? 'پوشش' : 'Coverage'}: {score.coverage == null ? '—' : `${Math.round(score.coverage * 100)}%`}</span>
        <span>{report?.totalUsd > 0 ? `$${Number(report.totalUsd).toLocaleString(fa ? 'fa-IR' : 'en-US', { maximumFractionDigits: 0 })}` : '—'}</span>
      </div>
      {families.length ? (
        <ul>
          {families.map((family) => (
            <li key={family.id}>
              <span>{fa ? family.labelFa : family.labelEn}</span>
              <b>{Math.round(family.score)}/100</b>
            </li>
          ))}
        </ul>
      ) : !loading ? (
        <p>{fa ? 'هنوز دادهٔ کافی برای امتیاز ریسک اندازه‌گیری نشده است.' : 'There is not enough measured data to score risk yet.'}</p>
      ) : null}
      {report?.unavailable?.length ? (
        <p className="intent-risk-missing">
          {fa ? 'داده‌های در دسترس نیست:' : 'Unavailable inputs:'} {report.unavailable.slice(0, 5).join(', ')}
        </p>
      ) : null}
      <small className="intent-risk-note">
        {fa
          ? `مدل تحلیلی توضیح‌پذیر است، نه پیش‌بینی زبانی؛ اجرا/امضا مجاز نیست. پوشش داده: ${score.measured ?? 0} از ۱۰ خانواده.`
          : `Explainable analytical model, not a language-model forecast. No execution or signing. Coverage: ${score.measured ?? 0}/10 families.`}
        {evidence?.contractsScanned ? ` · ${fa ? 'اسکن قرارداد' : 'contract scans'}: ${evidence.contractsScanned}` : ''}
      </small>
    </section>
  );
}
