import { useState } from 'react';

export default function InsuranceSettings() {
  const [pref, setPref] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fbt-ins-prefs') || '{}'); } catch { return {}; }
  });
  const save = (p) => { const next = { ...pref, ...p }; setPref(next); try { localStorage.setItem('fbt-ins-prefs', JSON.stringify(next)); } catch { /* ignore */ } };

  const toggles = [
    ['notifyExpiry', 'Coverage expiration reminders'],
    ['notifyIncident', 'Incident / eligible-claim alerts'],
    ['notifyStatus', 'Claim status + payout notifications'],
    ['notifyGap', 'Coverage gap alerts']
  ];

  return (
    <div>
      <div className="ins-title">Insurance Settings</div>
      <div className="ins-sub">In-app notification preferences (server push integration is wired via the module event bus).</div>
      <div className="ins-card">
        {toggles.map(([k, l]) => (
          <label key={k} className="ins-row" style={{ cursor: 'pointer' }}>
            <span>{l}</span>
            <input type="checkbox" checked={!!pref[k]} onChange={(e) => save({ [k]: e.target.checked })} />
          </label>
        ))}
      </div>
      <div className="ins-card">
        <div className="ins-title" style={{ fontSize: 15 }}>Legal &amp; compliance</div>
        <div className="ins-muted">
          FBT is not an insurance company and does not underwrite. Coverage is offered by external providers according to their own legal structure
          (protection/mutual/insurance/warranty). Nothing here is "guaranteed protection", "zero risk" or "guaranteed profit". Real provider terms,
          exclusions, jurisdiction and claim process are shown before purchase. Sandbox providers are simulations.
        </div>
      </div>
    </div>
  );
}
