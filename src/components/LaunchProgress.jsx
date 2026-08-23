import { useTranslation } from 'react-i18next';

/** Shared first-run progress. Stage itself is never animated. */
export default function LaunchProgress({ step, total }) {
  const { t } = useTranslation();
  const pct = Math.max(4, Math.min(100, (step / total) * 100));
  return (
    <div className="launch-progress">
      <div className="launch-progress-label">{t('launch.step', { n: step, total })}</div>
      <div className="launch-progress-track" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total}>
        <div className="launch-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
