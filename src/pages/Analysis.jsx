import { useTranslation } from 'react-i18next';
import { aiAnalysis } from '../lib/mockData';

export default function Analysis() {
  const { t } = useTranslation();
  const data = aiAnalysis.BNB;

  return (
    <div className="page">
      <p className="section-label">{t('analysis.title')}</p>

      <div className="card">
        <div className="row-between">
          <span style={{ fontWeight: 700 }}>BNB · {t('analysis.sentiment')}</span>
          <span className={`pill pill-${data.sentiment.label}`}>
            {t(`analysis.${data.sentiment.label}`)}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 10 }}>
          {t('analysis.confidence')}: {(data.sentiment.score * 100).toFixed(0)}% ·{' '}
          {data.sentiment.sources} sources
        </p>
      </div>

      <div className="card">
        <div className="row-between">
          <span style={{ fontWeight: 700 }}>{t('analysis.pricePrediction')}</span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {t('analysis.horizon24h')}
          </span>
        </div>
        <div className="stat-value mono-num" style={{ marginTop: 10, color: 'var(--green)' }}>
          +{data.prediction.changePct}%
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
          {t('analysis.confidence')}: {(data.prediction.confidence * 100).toFixed(0)}%
        </p>
      </div>

      <p className="custody-notice">{t('analysis.disclaimer')}</p>
    </div>
  );
}
