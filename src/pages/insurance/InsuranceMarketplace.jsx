import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel, typeLabel, reasonLabel, settlementLabel, claimLabel } from './insStatus.js';

const TYPES = ['smart-contract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'defi-protocol'];
const DURATION_CHOICES = [28, 90, 180, 365];
const AMOUNT_CHOICES = [1000, 5000, 10000, 25000, 50000, 100000];
const CHAINS = [
  { id: 1, name: 'Ethereum' }, { id: 56, name: 'BNB Chain' }, { id: 137, name: 'Polygon' },
  { id: 42161, name: 'Arbitrum' }, { id: 10, name: 'Optimism' }, { id: 8453, name: 'Base' },
  { id: 43114, name: 'Avalanche' }, { id: 59144, name: 'Linea' }
];

const FEE_CHOICES = AMOUNT_CHOICES;

/* Inline theme-aware SVG icons (stroke: currentColor; no icon font). */
const Icon = {
  Search: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>),
  Retry: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>),
  Chev: () => (<svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>)
};

export default function InsuranceMarketplace() {
  const { t } = useTranslation();
  const { wallet } = useOutletContext();
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState(sp.get('type') || 'smart-contract');
  const [chainId, setChainId] = useState(Number(sp.get('chain') || 1));
  const [amount, setAmount] = useState(sp.get('amount') || '10000');
  const [duration, setDuration] = useState(sp.get('duration') || '28');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState('');
  const [failures, setFailures] = useState([]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [providers, setProviders] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    insuranceApi.providers().then((list) => {
      setProviders(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  const sandboxOnly = providers.length > 0 && providers.every((p) => p.status !== 'LIVE' || !p.enabled) && providers.some((p) => p.status === 'SANDBOX');
  const liveProviders = providers.filter((p) => p.status === 'LIVE' && p.enabled);
  const providerName = (id) => providers.find((p) => p.providerId === id)?.displayName || id;
  const noLiveQuote = (warnings || []).includes('LIVE_QUOTE_NOT_AVAILABLE');

  async function getQuotes() {
    setErr(''); setResult(null); setFailures([]); setBusy(true);
    try {
      const res = await insuranceApi.quote({
        walletAddress: wallet, chainId, protectionType: type,
        coverageAmount: amount, durationDays: Number(duration),
        termsAccepted
      });
      if (!res.ok) {
        const code = res.errors?.[0]?.code;
        setErr(code || res.errors?.[0]?.detail || t('insurance.market.noEligible'));
        setWarnings(res.warnings || []);
        setFailures(Array.isArray(res.data?.detail) ? res.data.detail : []);
      } else {
        setResult(res.data.quotes);
        setWarnings(res.warnings || []);
      }
    } catch (e) { setErr(e?.message || String(e)); setWarnings(e?.warnings || []); setFailures(Array.isArray(e?.data?.detail) ? e.data.detail : []); }
    setBusy(false);
  }

  const fmtFresh = (q) => {
    if (!q?.quoteUpdatedAt) return null;
    const d = new Date(Number(q.quoteUpdatedAt) || q.quoteUpdatedAt);
    return isNaN(d) ? null : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  };

  return (
    <div className="ins-market">
      <div className="ins-hero">
        <h1>{t('insurance.market.title')}</h1>
        <p>{t('insurance.market.subtitle')}</p>
        {sandboxOnly && <p style={{ marginTop: 8, fontWeight: 600 }}>{t('insurance.market.sandboxOnlyNote')}</p>}
      </div>

      <div className="ins-card ins-form-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.market.protectionType')}</div>
        <div className="ins-tabs" role="tablist" aria-label={t('insurance.market.protectionType')}>
          {TYPES.map((typeId) => (
            <button key={typeId} role="tab" aria-selected={type === typeId} className={'ins-tab' + (type === typeId ? ' active' : '')} onClick={() => setType(typeId)}>{typeLabel(t, typeId)}</button>
          ))}
        </div>

        <div className="ins-grid ins-form-grid">
          <div>
            <div className="ins-sub">{t('insurance.market.chain')}</div>
            <select className="ins-select" value={chainId} onChange={(e) => setChainId(Number(e.target.value))} aria-label={t('insurance.market.chain')}>
              {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div className="ins-sub">{t('insurance.market.duration')}</div>
            <div className="ins-chip-row">
              {DURATION_CHOICES.map((d) => (
                <button key={d} className={'ins-mini' + (Number(duration) === d ? ' active' : '')} onClick={() => setDuration(String(d))}>{d}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="ins-sub">{t('insurance.market.coverageAmount')}</div>
        <div className="ins-chip-row ins-chip-row-amount">
          {FEE_CHOICES.map((a) => (
            <button key={a} className={'ins-mini' + (Number(amount) === a ? ' active' : '')} onClick={() => setAmount(String(a))}>${a.toLocaleString('en-US')}</button>
          ))}
        </div>
        <input className="ins-input" type="number" min={100} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('insurance.market.coverageAmount')} />

        <label className="ins-terms">
          <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
          <span>{t('insurance.market.termsAccept')}</span>
        </label>

        <div className="ins-form-actions">
          <button className="ins-btn ins-btn-lg" disabled={busy || !wallet} onClick={getQuotes}>
            {busy ? t('insurance.market.gettingQuotes') : (<><Icon.Search /> {t('insurance.market.getQuotes')}</>)}
          </button>
          {!wallet && (
            <div className="ins-wallet-cta">
              <span>{t('insurance.market.needWallet')}</span>
              <Link className="ins-btn ghost small" to="/wallet">{t('insurance.shell.goWallet')}</Link>
            </div>
          )}
        </div>
      </div>

      {/* One honest, fully translated unavailable state */}
      {(err || noLiveQuote) && (
        <div className="ins-state-card">
          <div className="ins-state-ico">🛡️</div>
          <h2>{err === 'NO_ELIGIBLE_PROTECTION' || noLiveQuote ? t('insurance.unavailable.title') : t('insurance.unavailable.titleGeneric')}</h2>
          <p>{t('insurance.unavailable.body')}</p>

          {liveProviders.length === 0 && providers.length > 0 && (
            <div className="ins-state-row">
              <span className="k">{t('insurance.unavailable.providerState')}:</span>
              {providers.filter((p) => p.status !== 'SANDBOX').map((p) => (
                <span key={p.providerId} className="ins-tag">{p.displayName || p.name} · {statusLabel(t, p.enabled && p.status === 'LIVE' ? 'LIVE' : p.status === 'NOT_CONFIGURED' ? 'DISABLED' : p.status)}</span>
              ))}
            </div>
          )}

          {failures.length > 0 && (
            <div className="ins-state-detail">
              <div className="k">{t('insurance.unavailable.detail')}</div>
              {failures.map((f, i) => (
                <div key={i} className="ins-state-detail-row">• {providerName(f.providerId)}: {reasonLabel(t, f.reason)}</div>
              ))}
            </div>
          )}

          <div className="ins-state-actions">
            <button className="ins-btn ghost small" onClick={getQuotes} disabled={busy}><Icon.Retry /> {t('insurance.unavailable.retry')}</button>
            <Link className="ins-btn ghost small" to="/insurance/providers">{t('insurance.unavailable.providersLink')}</Link>
          </div>
          {sandboxOnly && <p className="ins-muted">{t('insurance.market.sandboxOnlyNote')}</p>}
        </div>
      )}
      {err && !noLiveQuote && !(failures.length || liveProviders.length === 0) && <div className="ins-alert">{err}</div>}

      {result && result.length > 0 && (
        <div className="ins-sec-title">{t('insurance.market.compare', { count: result.length })}</div>
      )}
      {result?.map((quote) => (
        <div className="ins-card ins-quote-card" key={quote.quoteId}>
          <div className="ins-quote-head">
            <div>
              <div className="ins-quote-provider">{quote.providerName} {quote.sandbox && <span className="ins-tag">{t('insurance.market.sandbox')}</span>}</div>
              <div className="ins-muted">{typeLabel(t, quote.protectionType)} · {t('insurance.quote.days', { count: quote.durationDays })}</div>
            </div>
            <span className={'ins-chip ' + (quote.providerHealth || 'HEALTHY')}>{statusLabel(t, quote.providerHealth || 'HEALTHY')}</span>
          </div>
          <div className="ins-quote-stats">
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.market.coverage')}</span><b>${usd(quote.coverageAmountMicro)}</b></div>
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.fee.providerPremium')}</span><b>${quote.premiumUsd}</b></div>
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.fee.fbtFeeShort')}</span><b>${quote.fbtFeeUsd}</b></div>
            <div className="ins-quote-stat acc"><span className="lbl">{t('insurance.fee.total')}</span><b>${quote.totalCostUsd}</b></div>
          </div>
          <div className="ins-row"><span>{t('insurance.market.settlement')}</span><span>{settlementLabel(t, quote.settlementModel)}</span></div>
          <div className="ins-row"><span>{t('insurance.market.claimMethod')}</span><span>{claimLabel(t, quote.claimMethod)}</span></div>
          <div className="ins-row"><span>{t('insurance.market.termsHash')}</span><code style={{ fontSize: 11 }}>{quote.termsHash?.slice(0, 20)}…</code></div>
          <div className="ins-source">
            <span><span className="k">{t('insurance.source.label')}:</span> {quote.quoteSource === 'provider-api' ? t('insurance.source.providerApi') : quote.quoteSource || 'UNKNOWN'} · {quote.providerName}</span>
            {fmtFresh(quote) && <span><span className="k">{t('insurance.source.updated')}:</span> {fmtFresh(quote)}</span>}
            <span><span className="k">{t('insurance.source.freshness')}:</span> {quote.sandbox ? t('insurance.source.simulated') : t('insurance.source.live')}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="ins-btn" onClick={() => nav(`/insurance/quote/${quote.quoteId}`)}>{t('insurance.market.reviewBuy')}</button>
          </div>
        </div>
      ))}

      {result && result.length === 0 && !err && <div className="ins-ok">{t('insurance.market.noQuoteResult')}</div>}
    </div>
  );
}
