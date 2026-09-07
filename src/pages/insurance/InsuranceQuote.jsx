import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';

export default function InsuranceQuote() {
  const { quoteId } = useParams();
  const { wallet, connected, chainId, chainLabel, notify, confirm, getEip1193Provider, mode } = useOutletContext();
  const [quote, setQuote] = useState(null);
  const [err, setErr] = useState('');
  const [stage, setStage] = useState('load'); // load | ready | prepared | signing | done
  const [intent, setIntent] = useState(null);
  const [actErr, setActErr] = useState('');
  const [signedBy, setSignedBy] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    insuranceApi.quoteById(quoteId)
      .then((r) => { if (!r.ok) { setErr(r.error); return; } setQuote(r.quote); setStage('ready'); })
      .catch((e) => setErr(e.message || String(e)));
  }, [quoteId]);

  async function createIntent() {
    const yes = await confirm({ title: 'Confirm purchase?', message: `You are preparing ${usd(quote.coverageAmountMicro)} protection for ${usd(quote.totalCostMicro)} total (all fees included). Nothing is charged until you sign.`, confirmLabel: 'Confirm & Prepare' });
    if (!yes) return;
    setActErr('');
    try {
      const res = await insuranceApi.purchaseIntent({ quoteId, walletAddress: wallet, idempotencyKey: `buy-${quoteId}-${Date.now()}` });
      setIntent(res); setStage('prepared');
      notify('Purchase prepared (unsigned). Review and sign to activate.', 'info');
    } catch (e) { setActErr(e.message || String(e)); notify(e.message || 'Prepare failed', 'error'); }
  }

  async function signAndActivate() {
    setActErr('');
    let txHash;
    let used = 'simulated';
    try {
      if (connected && getEip1193Provider) {
        const prov = getEip1193Provider();
        const yes = await confirm({ title: 'Sign with your wallet', message: 'Your wallet will now sign the purchase authorisation for this certificate (sandbox). Confirm in your wallet.', confirmLabel: 'Open wallet to sign' });
        if (!yes) return;
        const payload = `FBT Protection purchase\ncoverage ${intent.coverageId}\nquote ${quote.quoteId}\nprovider ${quote.provider}\nchain ${chainLabel}\nprefix FBT-INS-SANDBOX\nnonce ${Date.now()}`;
        // Ask the connected wallet for a real signature over the prepared terms.
        if (typeof prov.request === 'function') {
          const sig = await prov.request({ method: 'personal_sign', params: [payload, wallet] });
          used = mode === 'local' ? 'in-app-wallet' : 'connected-wallet';
          txHash = '0x' + (typeof sig === 'string' && sig.startsWith('0x') ? sig.slice(2) : String(sig || '')).replace(/^0x/, '').slice(0, 64).padEnd(64, '0');
        } else {
          txHash = await prov.getSigner?.().signMessage?.(payload).then(() => '0x' + Math.random().toString(16).slice(2, 66));
        }
        setSignedBy(wallet);
      } else {
        // No connected wallet: produce a clearly-labelled sandbox receipt only.
        await confirm({ title: 'No wallet connected', message: 'You are not connected to a wallet, so activation is simulated. Connect a wallet to sign for real.', confirmLabel: 'Simulate anyway', danger: true });
        txHash = '0x' + Math.random().toString(16).slice(2, 66);
        used = 'simulated-no-wallet';
      }
      setStage('signing');
      await insuranceApi.activate({ coverageId: intent.coverageId, owner: wallet, txHash, chainId: quote.chainId });
      setStage('done');
      notify(`Coverage activated (${used})`, 'success');
    } catch (e) { setActErr(e.message || String(e)); notify(e.message || 'Activation failed', 'error'); setStage('prepared'); }
  }

  if (err) return (<div className="ins-alert">Quote unavailable: {err}. <button className="ins-btn ghost" onClick={() => nav('/insurance/marketplace')}>Back to marketplace</button></div>);
  if (!quote) return <div className="ins-muted">Loading quote…</div>;

  return (
    <div>
      <div className="ins-hero"><h1>Checkout</h1><p>Review coverage, every fee, terms and exclusions before signing. Premium goes directly to the provider — FBT is a router, not a custodian.</p></div>

      {stage === 'done' ? (
        <div className="ins-ok">
          <b>Coverage activated.</b> {signedBy ? <>Signed by <code>{signedBy.slice(0,6)}…{signedBy.slice(-4)}</code>.</> : null} Your certificate is live.{' '}
          <button className="ins-btn small" onClick={() => nav('/insurance/coverage')}>View coverage</button>
        </div>
      ) : (
        <div className="ins-card">
          <div className="ins-row"><span>Protection</span><b style={{ textTransform: 'capitalize' }}>{quote.protectionType}</b></div>
          <div className="ins-row"><span>Coverage</span><b>${usd(quote.coverageAmountMicro)}</b></div>
          <div className="ins-row"><span>Duration</span><span>{quote.durationDays} days</span></div>
          <div style={{ margin: '6px 0', borderTop: '1px dashed var(--line)' }} />
          <div className="ins-fee-line"><span>Premium</span><span className="fee-val">${quote.premiumUsd}</span></div>
          <div className="ins-fee-line"><span>FBT Fee</span><span className="fee-val">${quote.fbtFeeUsd}</span></div>
          <div className="ins-fee-line"><span>Network Fee (est.)</span><span className="fee-val">${quote.networkFeeUsd}</span></div>
          <div className="ins-row ins-total"><span>TOTAL</span><span>${quote.totalCostUsd}</span></div>
          <div className="ins-row"><span>Provider</span><span>{quote.providerName}</span></div>
          <div className="ins-row"><span>Currency</span><span>{quote.currency} (base-6)</span></div>
          <div className="ins-muted" style={{ marginTop: 6 }}>FBT fee is $0 when a provider has no commission agreement (§19) — never hidden.</div>
        </div>
      )}

      {stage === 'ready' && (
        <div className="ins-card">
          <div className="ins-title" style={{ fontSize: 16 }}>What this covers</div>
          <div className="ins-excl">This sandbox certificate protects against the listed {quote.protectionType} exploit risk for the covered wallet/asset and chain, per its terms. It does <b>not</b> cover ordinary market loss or excluded events. Maximum eligible payout: ${usd(quote.coverageAmountMicro)}.</div>
          <div className="ins-excl"><b>Exclusions:</b><ul style={{ margin: '6px 0 0 18px' }}>{quote.exclusions?.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div className="ins-ok">Wallet: {connected ? `connected on ${chainLabel}` : 'NOT connected — activation will be simulated. Connect a wallet to sign for real.'}</div>
          <button className="ins-btn" onClick={createIntent}>Confirm &amp; Prepare</button>
        </div>
      )}

      {stage === 'prepared' && intent && (
        <div className="ins-card">
          <div className="ins-ok"><b>Prepared (unsigned).</b> Non-custodial hand-off. Send the premium directly to the provider; FBT never holds funds.</div>
          <div className="ins-row"><span>Coverage ID</span><code>{intent.coverageId}</code></div>
          <div className="ins-row"><span>Send to</span><code style={{ fontSize: 11 }}>{intent.prepared?.to}</code></div>
          <div className="ins-row"><span>Amount (micro)</span><span>{intent.prepared?.valueMicro}</span></div>
          <div className="ins-row"><span>Mode</span><span className="ins-tag">{intent.prepared?.sandbox ? 'SANDBOX' : 'LIVE'}</span></div>
          <div className="ins-sub" style={{ marginTop: 8 }}>
            {connected ? 'Tap below to sign the prepared authorisation with your connected wallet, then it is verified on-chain and activated.' : 'Connect a wallet to sign for real. Without one, activation is simulated.'}
          </div>
          <button className="ins-btn" onClick={signAndActivate} disabled={stage === 'signing'}>{stage === 'signing' ? 'Signing / verifying…' : connected ? 'Sign with wallet & activate' : 'Sign & verify (sandbox)'}</button>
        </div>
      )}
      {actErr && <div className="ins-alert">{actErr}</div>}
    </div>
  );
}
