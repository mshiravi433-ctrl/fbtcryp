import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

export default function InsuranceQuote() {
  const { quoteId } = useParams();
  const { wallet } = useOutletContext();
  const [quote, setQuote] = useState(null);
  const [err, setErr] = useState('');
  const [stage, setStage] = useState('load'); // load | ready | prepared | done
  const [intent, setIntent] = useState(null);
  const [actErr, setActErr] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    insuranceApi.quoteById(quoteId)
      .then((r) => { if (!r.ok) { setErr(r.error); return; } setQuote(r.quote); setStage('ready'); })
      .catch((e) => setErr(e.message || String(e)));
  }, [quoteId]);

  async function createIntent() {
    setActErr('');
    try {
      const res = await insuranceApi.purchaseIntent({ quoteId, walletAddress: wallet, idempotencyKey: `buy-${quoteId}-${Date.now()}` });
      setIntent(res); setStage('prepared');
    } catch (e) { setActErr(e.message || String(e)); }
  }

  async function confirmAndSign() {
    // Sandbox: the wallet would sign the prepared tx. Here we simulate the mined
    // tx hash; production replaces this with a real wallet signature + broadcast.
    setActErr('');
    try {
      const txHash = '0x' + `${quoteId}-${wallet}-signed`.split('').map(() => Math.floor(Math.random() * 16).toString(16)).join('').slice(0, 64);
      await insuranceApi.activate({ coverageId: intent.coverageId, owner: wallet, txHash, chainId: quote.chainId });
      setStage('done');
    } catch (e) { setActErr(e.message || String(e)); }
  }

  if (err) return (<div className="ins-alert">Quote unavailable: {err}. <button className="ins-btn ghost" onClick={() => nav('/insurance/marketplace')}>Back to marketplace</button></div>);
  if (!quote) return <div className="ins-muted">Loading quote…</div>;

  return (
    <div>
      <div className="ins-title">Checkout</div>
      {stage === 'done' ? (
        <div className="ins-ok">
          <b>Coverage activated.</b> Your certificate is live. <button className="ins-btn small" onClick={() => nav('/insurance/coverage')}>View coverage</button>
        </div>
      ) : (
        <div className="ins-card">
          <div className="ins-row"><span>Protection</span><b style={{ textTransform: 'capitalize' }}>{quote.protectionType}</b></div>
          <div className="ins-row"><span>Coverage</span><b>${usd(quote.coverageAmountMicro)}</b></div>
          <div className="ins-row"><span>Duration</span><span>{quote.durationDays} days</span></div>
          <div className="ins-row"><span>Premium</span><span>${quote.premiumUsd}</span></div>
          <div className="ins-row"><span>FBT Fee</span><span>${quote.fbtFeeUsd}</span></div>
          <div className="ins-row"><span>Network Fee</span><span>${quote.networkFeeUsd}</span></div>
          <div className="ins-row ins-total"><span>TOTAL</span><span>${quote.totalCostUsd}</span></div>
          <div className="ins-row"><span>Provider</span><span>{quote.providerName}</span></div>
          <div className="ins-row"><span>Currency</span><span>{quote.currency} (base-6)</span></div>
        </div>
      )}

      {stage === 'ready' && (
        <div className="ins-card">
          <div className="ins-title" style={{ fontSize: 15 }}>What this covers</div>
          <div className="ins-excl">This sandbox certificate protects against the listed {quote.protectionType} exploit risk for the covered wallet/asset and chain, per its terms. It does <b>not</b> cover ordinary market loss or excluded events. Maximum eligible payout: ${usd(quote.coverageAmountMicro)}.</div>
          <div className="ins-excl"><b>Exclusions:</b><ul style={{ margin: '6px 0 0 18px' }}>{quote.exclusions?.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <button className="ins-btn" onClick={createIntent}>Confirm &amp; Prepare</button>
        </div>
      )}

      {stage === 'prepared' && intent && (
        <div className="ins-card">
          <div className="ins-ok"><b>Prepared (unsigned).</b> Non-custodial hand-off — send the premium directly to the provider. FBT never holds funds.</div>
          <div className="ins-row"><span>Coverage ID</span><code>{intent.coverageId}</code></div>
          <div className="ins-row"><span>Send to</span><code style={{ fontSize: 11 }}>{intent.prepared?.to}</code></div>
          <div className="ins-row"><span>Amount (micro)</span><span>{intent.prepared?.valueMicro}</span></div>
          <div className="ins-row"><span>Mode</span><span className="ins-tag">{intent.prepared?.sandbox ? 'SANDBOX' : 'LIVE'}</span></div>
          <div className="ins-sub">In production your wallet signs this exact payload. In sandbox we simulate the mined transaction below.</div>
          <button className="ins-btn" onClick={confirmAndSign}>Sign &amp; Verify (sandbox)</button>
        </div>
      )}
      {actErr && <div className="ins-alert">{actErr}</div>}
    </div>
  );
}
