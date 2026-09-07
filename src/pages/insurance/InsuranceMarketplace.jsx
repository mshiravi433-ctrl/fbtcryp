import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

const TYPES = ['smart-contract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'defi-protocol'];
const CHAINS = [
  { id: 1, name: 'Ethereum' }, { id: 56, name: 'BNB Chain' }, { id: 137, name: 'Polygon' },
  { id: 42161, name: 'Arbitrum' }, { id: 10, name: 'Optimism' }, { id: 8453, name: 'Base' },
  { id: 43114, name: 'Avalanche' }, { id: 59144, name: 'Linea' }, { id: 900, name: 'Solana (sandbox)' }
];

export default function InsuranceMarketplace() {
  const { wallet } = useOutletContext();
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState(sp.get('type') || 'smart-contract');
  const [chainId, setChainId] = useState(Number(sp.get('chain') || 56));
  const [amount, setAmount] = useState('10000');
  const [duration, setDuration] = useState('30');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  async function getQuotes() {
    setErr(''); setResult(null); setBusy(true);
    try {
      const res = await insuranceApi.quote({
        walletAddress: wallet, chainId, protectionType: type,
        coverageAmount: amount, durationDays: Number(duration)
      });
      if (!res.ok) setErr(res.reason || 'No eligible protection is currently available.');
      else setResult(res.quotes);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }

  return (
    <div>
      <div className="ins-title">Protection Marketplace</div>
      <div className="ins-sub">Compare quotes across providers. You see every fee before signing; nothing is purchased without your signature.</div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>Protection type</div>
        <div className="ins-tabs">
          {TYPES.map((t) => (
            <button key={t} className={'ins-tab' + (type === t ? ' active' : '')} onClick={() => setType(t)}>{t.replace('-', ' ')}</button>
          ))}
        </div>
        <div className="ins-sub">Chain</div>
        <select className="ins-select" value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
          {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="ins-grid">
          <div><div className="ins-sub">Coverage amount (USD)</div>
            <input className="ins-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><div className="ins-sub">Duration (days)</div>
            <input className="ins-input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
        </div>
        <button className="ins-btn" disabled={busy || !wallet} onClick={getQuotes}>
          {busy ? 'Getting quotes…' : 'Get Protection Quotes'}
        </button>
        {!wallet && <div className="ins-muted" style={{ marginTop: 8 }}>Set a wallet address first.</div>}
      </div>

      {err && <div className="ins-alert">{err}</div>}

      {result && result.length > 0 && (
        <div className="ins-sub" style={{ marginTop: 16 }}>Compare providers ({result.length})</div>
      )}
      {result?.map((q) => (
        <div className="ins-card" key={q.quoteId}>
          <div className="ins-row"><span><b>{q.providerName}</b></span>
            <span className={'ins-chip ' + (q.providerHealth || 'HEALTHY')}>Health: {q.providerHealth}</span></div>
          <div className="ins-grid">
            <div className="ins-stat"><div className="lbl">Coverage</div><div className="val" style={{ fontSize: 18 }}>${usd(q.coverageAmountMicro)}</div></div>
            <div className="ins-stat"><div className="lbl">Premium</div><div className="val" style={{ fontSize: 18 }}>${q.premiumUsd}</div></div>
            <div className="ins-stat"><div className="lbl">FBT fee</div><div className="val" style={{ fontSize: 18 }}>${q.fbtFeeUsd}</div></div>
            <div className="ins-stat"><div className="lbl">TOTAL</div><div className="val" style={{ fontSize: 18 }}>${q.totalCostUsd}</div></div>
          </div>
          <div className="ins-row"><span>Settlement</span><span>{q.settlementModel} (non-custodial)</span></div>
          <div className="ins-row"><span>Claim method</span><span>{q.claimMethod}</span></div>
          <div className="ins-row"><span>Terms hash</span><code style={{ fontSize: 11 }}>{q.termsHash?.slice(0, 20)}…</code></div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button className="ins-btn" onClick={() => nav(`/insurance/quote/${q.quoteId}`)}>Review &amp; Buy</button>
            <button className="ins-btn ghost" onClick={() => { sessionStorage.setItem('fbt-ins-quote', JSON.stringify(q)); nav('/insurance/coverage'); }}>View terms</button>
          </div>
        </div>
      ))}
    </div>
  );
}
