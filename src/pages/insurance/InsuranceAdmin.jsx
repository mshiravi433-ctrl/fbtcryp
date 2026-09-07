import { useState } from 'react';
import { insuranceApi } from '../../lib/insuranceClient.js';

export default function InsuranceAdmin() {
  const [key, setKey] = useState(sessionStorage.getItem('fbt-ins-admin-key') || '');
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('fbt-ins-admin-key'));
  const [dash, setDash] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [incident, setIncident] = useState({ protectionType: 'smart-contract', severity: 'MEDIUM', description: '' });
  const [claimId, setClaimId] = useState('');
  const [decision, setDecision] = useState('APPROVED');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [pause, setPause] = useState(false);

  async function login() {
    sessionStorage.setItem('fbt-ins-admin-key', key);
    setAuthed(true);
    await loadDash();
  }
  async function loadDash() {
    try { const d = await insuranceApi.admin.dashboard(key); setDash(d); setErr(''); }
    catch (e) { setErr(e.message || String(e)); }
  }
  async function run(fn, okMsg) {
    setErr(''); setMsg('');
    try { const r = await fn; setMsg(okMsg || JSON.stringify(r)); }
    catch (e) { setErr(e.message || String(e)); }
  }

  if (!authed) {
    return (
      <div className="ins-card">
        <div className="ins-title">Insurance Admin</div>
        <div className="ins-sub">Production admin actions must be multisig-gated. This sandbox admin is gated by the server's INSURANCE_ADMIN_KEY.</div>
        <input className="ins-input" type="password" placeholder="INSURANCE_ADMIN_KEY" value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="ins-btn" onClick={login}>Unlock</button>
        <div className="ins-muted">The server returns 403 'ADMIN_DISABLED' unless INSURANCE_ADMIN_KEY is configured.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="ins-title">Insurance Admin</div>
      <div className="ins-sub">Claim decisions, payout recording (on-chain verified), incidents, provider controls and emergency pause.</div>
      {err && <div className="ins-alert">{err}</div>}
      {msg && <div className="ins-ok">{msg}</div>}

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>Claim decision</div>
        <input className="ins-input" placeholder="claimId" value={claimId} onChange={(e) => setClaimId(e.target.value)} />
        <select className="ins-select" value={decision} onChange={(e) => setDecision(e.target.value)}>
          {['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'ADDITIONAL_INFORMATION_REQUIRED', 'DISPUTED'].map((d) => <option key={d}>{d}</option>)}
        </select>
        <input className="ins-input" placeholder="payout amount (USD, integer)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="ins-btn" onClick={() => run(insuranceApi.admin.decide(claimId, { decision, payoutAmountMicro: amount }, key), 'Decision recorded')}>Decide</button>
      </div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>Record on-chain payout (must be verified)</div>
        <input className="ins-input" placeholder="claimId" value={claimId} onChange={(e) => setClaimId(e.target.value)} />
        <input className="ins-input" placeholder="payout tx hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
        <button className="ins-btn" onClick={() => run(insuranceApi.admin.recordPayout(claimId, { txHash, amountMicro: amount }, key), 'Payout recorded after verification')}>Verify &amp; record payout</button>
      </div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>Register incident (monitoring)</div>
        <select className="ins-select" value={incident.protectionType} onChange={(e) => setIncident({ ...incident, protectionType: e.target.value })}>
          {['smart-contract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'defi-protocol'].map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="ins-select" value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value })}>
          {['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <textarea className="ins-input" rows={2} value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} placeholder="Incident description" />
        <button className="ins-btn" onClick={() => run(insuranceApi.admin.registerIncident({ ...incident, chainId: 56 }, key), 'Incident detected (potential only — never auto-claims)')}>Register incident</button>
      </div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>Emergency pause</div>
        <button className="ins-btn warn" onClick={() => run(insuranceApi.admin.pause(true, key), 'Insurance emergency-paused. New purchases blocked.')}>Pause new purchases</button>{' '}
        <button className="ins-btn ghost" onClick={() => run(insuranceApi.admin.pause(false, key), 'Resumed')}>Resume</button>
      </div>

      <button className="ins-btn ghost small" onClick={loadDash}>Reload analytics</button>
      {dash && (
        <div className="ins-card">
          <div className="ins-sub" style={{ marginTop: 0 }}>Providers ({dash.providers?.length})</div>
          {dash.providers?.map((p) => (
            <div className="ins-row" key={p.providerId}>
              <span>{p.name}</span>
              <span className={'ins-chip ' + (p.healthStatus || 'UNKNOWN')}>{p.enabled ? 'ENABLED' : 'DISABLED'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
