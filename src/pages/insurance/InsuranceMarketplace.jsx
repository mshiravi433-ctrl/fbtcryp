import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

const TYPES = ['smart-contract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'defi-protocol'];
const CHAINS = [
  { id: 1, name: 'Ethereum' }, { id: 56, name: 'BNB Chain' }, { id: 137, name: 'Polygon' },
  { id: 42161, name: 'Arbitrum' }, { id: 10, name: 'Optimism' }, { id: 8453, name: 'Base' },
  { id: 43114, name: 'Avalanche' }, { id: 59144, name: 'Linea' }
];

/* Inline theme-aware SVG icons (stroke: currentColor; no icon font). */
const Icon = {
  Wallet: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="14" rx="3"/><path d="M16 12.5h2.5"/><path d="M2.5 9.5h19"/></svg>),
  Shield: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2.5 4.5 5.5v6c0 4.7 3.2 8 7.5 10 4.3-2 7.5-5.3 7.5-10v-6L12 2.5Z"/><path d="m9 12 2 2 4-4.5"/></svg>),
  Risk: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor"/></svg>),
  Fee: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 15.2c.5.8 1.4 1.3 2.5 1.3 1.7 0 3-.9 3-2.3 0-2.8-5.4-1.5-5.4-4.1 0-1.2 1.1-2.1 2.6-2.1 1 0 1.9.4 2.4 1.1"/><path d="M12 6.5V8m0 8v1.5"/></svg>),
  Chain: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5"/><path d="M7.5 11.5 5 14a3.5 3.5 0 0 0 5 5l2.5-2.5"/><path d="M16.5 12.5 19 10a3.5 3.5 0 0 0-5-5l-2.5 2.5"/></svg>),
  Claim: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M15 3.5V7h4"/><path d="M9 12h7M9 15.5h5"/></svg>),
  Verify: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>),
  Chev: () => (<svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>)
};

export default function InsuranceMarketplace() {
  const { t } = useTranslation();
  const { wallet } = useOutletContext();
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState(sp.get('type') || 'smart-contract');
  const [chainId, setChainId] = useState(Number(sp.get('chain') || 1));
  const [amount, setAmount] = useState('10000');
  const [duration, setDuration] = useState('28');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [sandboxOnly, setSandboxOnly] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    insuranceApi.providers().then((providers) => {
      const live = (providers || []).some((p) => p.status === 'LIVE' && p.enabled);
      const sandbox = (providers || []).some((p) => p.status === 'SANDBOX');
      setSandboxOnly(sandbox && !live);
    }).catch(() => {});
  }, []);

  async function getQuotes() {
    setErr(''); setResult(null); setWarnings([]); setBusy(true);
    try {
      const res = await insuranceApi.quote({
        walletAddress: wallet, chainId, protectionType: type,
        coverageAmount: amount, durationDays: Number(duration),
        termsAccepted
      });
      if (!res.ok) {
        setErr(res.errors?.[0]?.detail || t('insurance.market.noEligible'));
        setWarnings(res.warnings || []);
      } else {
        setResult(res.data.quotes);
        setWarnings(res.warnings || []);
      }
    } catch (e) { setErr(e?.message || String(e)); }
    setBusy(false);
  }

  const fmtFresh = (q) => {
    if (!q?.quoteUpdatedAt) return null;
    const d = new Date(Number(q.quoteUpdatedAt) || q.quoteUpdatedAt);
    return isNaN(d) ? null : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  };

  return (
    <div>
      <div className="ins-hero">
        <h1>{t('insurance.market.title')}</h1>
        <p>{t('insurance.market.subtitle')}</p>
        {sandboxOnly && <p style={{ marginTop: 8, fontWeight: 600 }}>{t('insurance.market.sandboxOnlyNote')}</p>}
      </div>

      {/* Transparency accordion — wallet, flow, risk criteria, fees, claims */}
      <details className="ins-details">
        <summary>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon.Shield /> {t('insurance.market.howItWorks')}
          </span>
          <Icon.Chev />
        </summary>
        <div className="ins-details-body">
          <div className="ins-info-row">
            <span className="ins-info-icon"><Icon.Wallet /></span>
            <div>
              <div className="ins-info-title">{t('insurance.info.walletTitle')}</div>
              <div className="ins-info-text">{t('insurance.info.walletBody')}</div>
            </div>
          </div>
          <div className="ins-info-row">
            <span className="ins-info-icon"><Icon.Chain /></span>
            <div>
              <div className="ins-info-title">{t('insurance.info.flowTitle')}</div>
              <ol>
                {['flow1', 'flow2', 'flow3', 'flow4', 'flow5', 'flow6', 'flow7', 'flow8'].map((k) => <li key={k}>{t(`insurance.info.${k}`)}</li>)}
              </ol>
            </div>
          </div>
          <div className="ins-info-row">
            <span className="ins-info-icon"><Icon.Risk /></span>
            <div>
              <div className="ins-info-title">{t('insurance.info.riskTitle')}</div>
              <div className="ins-info-text">{t('insurance.info.riskIntro')}</div>
              <ul>
                {['risk1', 'risk2', 'risk3', 'risk4', 'risk5', 'risk6', 'risk7', 'risk8', 'risk9', 'risk10', 'risk11', 'risk12'].map((k) => <li key={k}>{t(`insurance.info.${k}`)}</li>)}
              </ul>
            </div>
          </div>
          <div className="ins-info-row">
            <span className="ins-info-icon"><Icon.Fee /></span>
            <div>
              <div className="ins-info-title">{t('insurance.info.feesTitle')}</div>
              <ul>
                <li>{t('insurance.fee.providerPremium')}</li>
                <li>{t('insurance.fee.fbtFee')}</li>
                <li>{t('insurance.fee.networkFee')}</li>
                <li>{t('insurance.fee.commission')}</li>
                <li>{t('insurance.fee.total')}</li>
              </ul>
              <div style={{ marginTop: 8 }}>
                <span className="ins-fee-zero"><Icon.Verify /> {t('insurance.fee.zero')}</span>
              </div>
            </div>
          </div>
          <div className="ins-info-row">
            <span className="ins-info-icon"><Icon.Claim /></span>
            <div>
              <div className="ins-info-title">{t('insurance.info.claimsTitle')}</div>
              <ul>
                {['claim1', 'claim2', 'claim3', 'claim4', 'claim5'].map((k) => <li key={k}>{t(`insurance.info.${k}`)}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </details>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.market.protectionType')}</div>
        <div className="ins-tabs" role="tablist" aria-label={t('insurance.market.protectionType')}>
          {TYPES.map((typeId) => (
            <button key={typeId} role="tab" aria-selected={type === typeId} className={'ins-tab' + (type === typeId ? ' active' : '')} onClick={() => setType(typeId)}>{t(`insurance.types.${typeId}`)}</button>
          ))}
        </div>
        <div className="ins-sub">{t('insurance.market.chain')}</div>
        <select className="ins-select" value={chainId} onChange={(e) => setChainId(Number(e.target.value))} aria-label={t('insurance.market.chain')}>
          {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="ins-grid">
          <div><div className="ins-sub">{t('insurance.market.coverageAmount')}</div>
            <input className="ins-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('insurance.market.coverageAmount')} /></div>
          <div><div className="ins-sub">{t('insurance.market.duration')}</div>
            <input className="ins-input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} aria-label={t('insurance.market.duration')} /></div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-2)', margin: '4px 0 12px' }}>
          <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} style={{ marginTop: 2 }} />
          <span>{t('insurance.market.termsAccept')}</span>
        </label>
        <button className="ins-btn" disabled={busy || !wallet} onClick={getQuotes}>
          {busy ? t('insurance.market.gettingQuotes') : t('insurance.market.getQuotes')}
        </button>
        {!wallet && <div className="ins-muted" style={{ marginTop: 8 }}>{t('insurance.market.needWallet')}</div>}
      </div>

      {err && (
        <div className="ins-alert">
          {err}
          {(warnings || []).includes('LIVE_QUOTE_NOT_AVAILABLE') && (
            <div className="ins-muted" style={{ marginTop: 6 }}>{t('insurance.market.liveQuoteUnavailable')}</div>
          )}
        </div>
      )}

      {result && result.length > 0 && (
        <div className="ins-sub" style={{ marginTop: 16 }}>{t('insurance.market.compare', { count: result.length })}</div>
      )}
      {result?.map((quote) => (
        <div className="ins-card" key={quote.quoteId}>
          <div className="ins-row"><span><b>{quote.providerName}</b></span>
            <span className={'ins-chip ' + (quote.providerHealth || 'HEALTHY')}>{t('insurance.market.health')}: {quote.providerHealth}</span></div>
          <div className="ins-grid">
            <div className="ins-stat"><div className="lbl">{t('insurance.market.coverage')}</div><div className="val" style={{ fontSize: 18 }}>${usd(quote.coverageAmountMicro)}</div></div>
            <div className="ins-stat"><div className="lbl">{t('insurance.fee.providerPremium')}</div><div className="val" style={{ fontSize: 18 }}>${quote.premiumUsd}</div></div>
            <div className="ins-stat"><div className="lbl">{t('insurance.fee.fbtFeeShort')}</div><div className="val" style={{ fontSize: 18 }}>${quote.fbtFeeUsd}</div></div>
            <div className="ins-stat"><div className="lbl">{t('insurance.fee.total')}</div><div className="val" style={{ fontSize: 18 }}>${quote.totalCostUsd}</div></div>
          </div>
          <div className="ins-row"><span>{t('insurance.market.settlement')}</span><span>{quote.settlementModel} ({t('insurance.market.nonCustodial')})</span></div>
          <div className="ins-row"><span>{t('insurance.market.claimMethod')}</span><span>{quote.claimMethod}</span></div>
          <div className="ins-row"><span>{t('insurance.market.termsHash')}</span><code style={{ fontSize: 11 }}>{quote.termsHash?.slice(0, 20)}…</code></div>
          <div className="ins-source">
            <span><span className="k">{t('insurance.source.label')}:</span> {quote.quoteSource === 'provider-api' ? t('insurance.source.providerApi') : quote.quoteSource || 'UNKNOWN'} · {quote.providerName}</span>
            {fmtFresh(quote) && <span><span className="k">{t('insurance.source.updated')}:</span> {fmtFresh(quote)}</span>}
            <span><span className="k">{t('insurance.source.freshness')}:</span> {t('insurance.source.live')}</span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button className="ins-btn" onClick={() => nav(`/insurance/quote/${quote.quoteId}`)}>{t('insurance.market.reviewBuy')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
