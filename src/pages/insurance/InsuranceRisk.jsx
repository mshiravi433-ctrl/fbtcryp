import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

const KINDS = [
  ['smartContract', 'Smart Contract'], ['bridge', 'Bridge'], ['stablecoin', 'Stablecoin'],
  ['lending', 'Lending'], ['lp', 'LP'], ['wallet', 'Wallet'], ['oracle', 'Oracle'], ['protocol', 'DeFi Protocol']
];
const DEFAULTS = [
  ['smartContract', '8000'], ['bridge', '5000'], ['stablecoin', '4000'], ['lp', '3000']
];

export default function InsuranceRisk() {
  const { wallet } = useOutletContext();
  const [rows, setRows] = useState(DEFAULTS.map(([k, v]) => ({ kind: k, amount: v })));
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  function setRow(i, k, v) { const n = rows.slice(); n[i] = { ...n[i], [k]: v }; setRows(n); }
  function add() { setRows([...rows, { kind: 'smartContract', amount: '1000' }]); }

  async function run() {
    setErr(''); setResult(null); setBusy(true);
    const exposures = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ kind: r.kind, amountUsd: r.amount, chainId: 56 }));
    if (!exposures.length) { setErr('Add at least one exposure.'); setBusy(false); return; }
    try {
      const res = await insuranceApi.protectPortfolio({ walletAddress: wallet, chainId: 56, durationDays: 30, exposures });
      setResult(res);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }

  const gap = result?.coverageGap;
  return (
    <div>
      <div className="ins-title">Portfolio Risk &amp; Coverage Gap</div>
      <div className="ins-sub">Declare your on-chain exposure (real balances come from your wallet in production — the server never invents balances). FBT analyses risk and recommends protection. It never buys automatically.</div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>Exposure (USD)</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <select className="ins-select" style={{ width: 180, margin: 0 }} value={r.kind} onChange={(e) => setRow(i, 'kind', e.target.value)}>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="ins-input" style={{ width: 160, margin: 0 }} value={r.amount} onChange={(e) => setRow(i, 'amount', e.target.value)} />
            <button className="ins-btn ghost small" onClick={() => setRows(rows.filter((_, x) => x !== i))}>×</button>
          </div>
        ))}
        <button className="ins-btn ghost small" onClick={add}>+ Add exposure</button>
        <div style={{ height: 8 }} />
        <button className="ins-btn" disabled={busy || !wallet} onClick={run}>{busy ? 'Analysing…' : 'Analyse my risk'}</button>
      </div>

      {err && <div className="ins-alert">{err}</div>}

      {result && (
        <>
          <div className="ins-grid">
            <div className="ins-stat"><div className="lbl">Total eligible exposure</div><div className="val" style={{ fontSize: 18 }}>${gap?.eligibleExposureUsd || '0'}</div></div>
            <div className="ins-stat"><div className="lbl">Active coverage</div><div className="val" style={{ fontSize: 18 }}>${gap?.activeCoverageUsd || '0'}</div></div>
            <div className="ins-stat"><div className="lbl">PROTECTION GAP</div><div className="val" style={{ fontSize: 18 }}>${gap?.coverageGapUsd || '0'}</div></div>
            <div className="ins-stat"><div className="lbl">Overall risk</div><div className="val" style={{ fontSize: 18 }}><span className={'ins-chip ' + (result.riskAnalysis?.overallRiskBand || 'LOW')}>{result.riskAnalysis?.overallRiskBand}</span></div></div>
          </div>

          <div className="ins-card">
            <div className="ins-sub" style={{ marginTop: 0 }}>Recommendation (autoExecute = false — review before buying)</div>
            {(result.recommendations || []).map((r, i) => (
              <div key={i} className="ins-card" style={{ background: 'transparent' }}>
                <div className="ins-row"><span><b>{r.protectionType}</b></span><span className="ins-muted">{r.riskKind} risk</span></div>
                <div className="ins-row"><span>Recommended coverage</span><b>${usd(r.recommendedCoverageMicro)}</b></div>
                {r.best ? (
                  <>
                    <div className="ins-row"><span>Best provider</span><span>{r.best.providerName}</span></div>
                    <div className="ins-row"><span>Premium</span><span>${r.best.premiumUsd}</span></div>
                    <div className="ins-row"><span>Total</span><span>${r.best.totalCostUsd}</span></div>
                    <button className="ins-btn small" onClick={() => nav(`/insurance/quote/${r.best.quoteId}`)}>Review &amp; buy</button>
                  </>
                ) : (
                  <div className="ins-muted">Provider quote exceeded your premium cap or unavailable. Cheapest option: ${r.cheapest?.totalCostUsd ?? '—'}</div>
                )}
              </div>
            ))}
            {result.recommendations?.length === 0 && <div className="ins-muted">{result.recommendation}</div>}
          </div>

          <div className="ins-card">
            <div className="ins-sub" style={{ marginTop: 0 }}>Plain-language explanation</div>
            {(result.plainLanguage || []).map((l, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>• {l}</div>)}
          </div>
        </>
      )}
    </div>
  );
}
