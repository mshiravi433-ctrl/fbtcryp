import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function InsuranceSettings() {
  const { t } = useTranslation();
  const [pref, setPref] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fbt-ins-prefs') || '{}'); } catch { return {}; }
  });
  const save = (p) => { const next = { ...pref, ...p }; setPref(next); try { localStorage.setItem('fbt-ins-prefs', JSON.stringify(next)); } catch { /* ignore */ } };

  const toggles = [
    ['notifyExpiry', t('insurance.settings.toggleExpiry')],
    ['notifyIncident', t('insurance.settings.toggleIncident')],
    ['notifyStatus', t('insurance.settings.toggleStatus')],
    ['notifyGap', t('insurance.settings.toggleGap')]
  ];

  return (
    <div>
      <div className="ins-title">{t('insurance.settings.title')}</div>
      <div className="ins-sub">{t('insurance.settings.subtitle')}</div>
      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.settings.notifTitle')}</div>
        {toggles.map(([k, l]) => (
          <label key={k} className="ins-row" style={{ cursor: 'pointer' }}>
            <span>{l}</span>
            <input type="checkbox" checked={!!pref[k]} onChange={(e) => save({ [k]: e.target.checked })} />
          </label>
        ))}
      </div>
      <div className="ins-card">
        <div className="ins-title" style={{ fontSize: 15 }}>{t('insurance.settings.legalTitle')}</div>
        <div className="ins-muted">{t('insurance.settings.legalBody')}</div>
      </div>
    </div>
  );
}
