import { useEffect, useState } from 'react';
import { insuranceApi } from '../../lib/insuranceClient.js';

export default function InsuranceProviders() {
  const [providers, setProviders] = useState([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    insuranceApi.providers().then(setProviders).catch(() => {});
  }, [refresh]);

  return (
    <div>
      <div className="ins-title">Protection Providers</div>
      <div className="ins-sub">Provider registry. Every provider is adapter-pluggable — the frontend never depends on one provider. Unhealthy providers are never recommended for new purchases, but existing coverage stays visible.</div>
      <button className="ins-btn ghost small" onClick={() => setRefresh((r) => r + 1)}>Refresh health</button>

      {providers.map((p) => (
        <div className="ins-card" key={p.providerId}>
          <div className="ins-row"><span><b>{p.displayName || p.name}</b></span>
            <span style={{ display: 'flex', gap: 6 }}>
              <span className={'ins-chip ' + (p.healthStatus || 'UNKNOWN')}>{p.healthStatus}</span>
              <span className="ins-tag">{p.enabled ? 'ENABLED' : 'DISABLED'}</span>
            </span>
          </div>
          <div className="ins-row"><span>Status</span><span>{p.status}</span></div>
          <div className="ins-row"><span>Configured</span><span>{p.configured ? 'yes' : 'no'}</span></div>
          <div className="ins-row"><span>Settlement</span><span>{p.settlementModel} (non-custodial)</span></div>
          <div className="ins-row"><span>Chains</span><span>{p.supportedChains?.length ? p.supportedChains.join(', ') : 'none'}</span></div>
          <div className="ins-row"><span>Commission model</span><span>{p.commissionModel?.note || p.commissionModel?.type}</span></div>
          <div className="ins-row"><span>Audit</span><span>{p.auditStatus}</span></div>
          <div className="ins-row"><span>Risk score</span><span>{p.riskScore || '—'}</span></div>
          {p.disclaimer && <div className="ins-muted" style={{ marginTop: 6 }}>{p.disclaimer}</div>}
        </div>
      ))}
    </div>
  );
}
