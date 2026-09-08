import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from '../../components/Switch.jsx';
import { InsIconBell, InsIconLock } from './InsuranceIcons.jsx';

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
    <div className="ins-tone-cyan">
      <div className="ins-title">{t('insurance.settings.title')}</div>
      <div className="ins-sub">{t('insurance.settings.subtitle')}</div>
      <div className="ins-card">
        <div className="ins-card-title"><span className="ins-ico"><InsIconBell /></span>{t('insurance.settings.notifTitle')}</div>
        {toggles.map(([k, l]) => (
          <div key={k} className="ins-toggle-row">
            <span>{l}</span>
            <Switch on={!!pref[k]} onChange={() => save({ [k]: !pref[k] })} label={l} />
          </div>
        ))}
      </div>
      <div className="ins-card">
        <div className="ins-card-title"><span className="ins-ico"><InsIconLock /></span>{t('insurance.settings.legalTitle')}</div>
        <div className="ins-muted">{t('insurance.settings.legalBody')}</div>
      </div>
    </div>
  );
}
