import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ethers } from 'ethers';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel, typeLabel, reasonLabel, claimLabel } from './insStatus.js';

export default function InsuranceQuote() {
  const { t } = useTranslation();
  const { quoteId } = useParams();
  const { wallet, connected, chainId, chainLabel, notify, confirm, getEip1193Provider, mode } = useOutletContext();
  const [quote, setQuote] = useState(null);
  const [err, setErr] = useState('');
  const [stage, setStage] = useState('load'); // load | ready | prepared | signing | done
  const [intent, setIntent] = useState(null);
  const [actErr, setActErr] = useState('');
  const [signedBy, setSignedBy] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    insuranceApi.quoteById(quoteId)
      .then((res) => { if (!res.ok) { setErr(res.errors?.[0]?.code || 'QUOTE_UNAVAILABLE'); return; } setQuote(res.data.quote); setStage('ready'); })
      .catch((e) => setErr(e.message || String(e)));
  }, [quoteId]);

  async function createIntent() {
    const yes = await confirm({
      title: t('insurance.quote.confirmTitle'),
      message: t('insurance.quote.confirmBody', { coverage: usd(quote.coverageAmountMicro), total: usd(quote.totalCostMicro) }),
      confirmLabel: t('insurance.quote.confirmPrepare')
    });
    if (!yes) return;
    setActErr('');
    try {
      const res = await insuranceApi.purchaseIntent({ quoteId, walletAddress: wallet, idempotencyKey: `buy-${quoteId}-${Date.now()}` });
      setIntent(res.data || res); setStage('prepared');
      notify(t('insurance.quote.preparedToast'), 'info');
    } catch (e) { setActErr(e.message || String(e)); notify(e.message || t('insurance.quote.prepareFailed'), 'error'); }
  }

  const isLive = intent?.prepared?.sandbox === false || quote?.sandbox === false;
  const prepared = intent?.prepared || null;
  const liveTx = prepared?.tx || null; // live unsigned EVM tx {to, data, value, from}
  const approvalTx = prepared?.approvalTx || null;

  /**
   * Non-custodial signing.
   *  - LIVE providers: the wallet signs and broadcasts the REAL transaction
   *    (ERC-20 approval first if required, then the provider buy call). The
   *    resulting txHash is verified on-chain by the server before activation.
   *  - Sandbox (dev/test only): a clearly-labelled simulated signature.
   */
  async function signAndActivate() {
    setActErr('');
    let finalHash = null;
    try {
      if (isLive && liveTx) {
        if (!connected || !getEip1193Provider) {
          notify(t('insurance.quote.connectToSign'), 'error');
          return;
        }
        const prov = getEip1193Provider();
        const yes = await confirm({ title: t('insurance.quote.signTitle'), message: t('insurance.quote.signBodyLive'), confirmLabel: t('insurance.quote.openWallet') });
        if (!yes) return;
        setStage('signing');
        const eip1193 = typeof prov.request === 'function' ? prov : null;
        if (!eip1193) throw new Error('EIP-1193 provider unavailable');
        // 1. ERC-20 approval (only when the provider contract needs it)
        if (approvalTx) {
          await eip1193.request({
            method: 'eth_sendTransaction',
            params: [{
              from: wallet,
              to: approvalTx.tokenAddress,
              data: new ethers.Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [approvalTx.spender, BigInt(approvalTx.amount)]),
              value: '0x0'
            }]
          });
          // Approval broadcast — wait briefly for inclusion before the buy call.
          await new Promise((r) => setTimeout(r, 4000));
        }
        // 2. The provider purchase transaction (CoverBroker.buyCover / buyCoverV3)
        finalHash = await eip1193.request({
          method: 'eth_sendTransaction',
          params: [{
            from: liveTx.from || wallet,
            to: liveTx.to,
            data: liveTx.data,
            value: ethers.toQuantity(BigInt(liveTx.value || '0'))
          }]
        });
        setSignedBy(wallet);
        setTxHash(finalHash);
      } else if (!isLive) {
        // SANDBOX path — never rendered in production (no sandbox providers there).
        const yes = await confirm({ title: t('insurance.quote.sandboxSignTitle'), message: t('insurance.quote.sandboxSignBody'), confirmLabel: t('insurance.quote.sandboxSignGo'), danger: true });
        if (!yes) return;
        setStage('signing');
        if (connected && getEip1193Provider) {
          const prov = getEip1193Provider();
          if (typeof prov.request === 'function') {
            const payload = `FBT Protection purchase\ncoverage ${intent.coverageId}\nquote ${quote.quoteId}\nprovider ${quote.provider}\nchain ${chainLabel}\nprefix FBT-INS-SANDBOX\nnonce ${Date.now()}`;
            await prov.request({ method: 'personal_sign', params: [payload, wallet] });
            setSignedBy(wallet);
          }
        }
        finalHash = '0x' + Math.random().toString(16).slice(2, 66);
      } else {
        notify(t('insurance.quote.connectToSign'), 'error');
        return;
      }

      const res = await insuranceApi.activate({ coverageId: intent.coverageId, owner: wallet, txHash: finalHash, chainId: quote.chainId });
      if (!res.ok) throw new Error(res.errors?.[0]?.detail || res.errors?.[0]?.code || 'ACTIVATION_FAILED');
      setStage('done');
      notify(t('insurance.quote.activatedToast'), 'success');
    } catch (e) {
      setActErr(e?.message || String(e));
      notify(e?.message || t('insurance.quote.activationFailed'), 'error');
      setStage('prepared');
    }
  }

  if (err) return (
    <div className="ins-state-card ins-state-card--sm">
      <div className="ins-state-ico">⏳</div>
      <h2>{t('insurance.quote.unavailableTitle')}</h2>
      <p>{t('insurance.quote.unavailable', { error: reasonLabel(t, err) })}</p>
      <div className="ins-state-actions">
        <button className="ins-btn ghost small" onClick={() => nav('/insurance/marketplace')}>{t('insurance.quote.backToMarket')}</button>
        <Link className="ins-btn ghost small" to="/insurance/marketplace">{t('insurance.unavailable.retry')}</Link>
      </div>
    </div>
  );
  if (!quote) return <div className="ins-muted">{t('insurance.quote.loading')}</div>;

  const feeZero = String(quote.fbtFeeMicro ?? '0') === '0';

  return (
    <div>
      <div className="ins-hero"><h1>{t('insurance.quote.title')}</h1><p>{t('insurance.quote.subtitle')}</p></div>

      {stage === 'done' ? (
        <div className="ins-ok">
          <b>{t('insurance.quote.doneTitle')}</b>{' '}
          {signedBy && <span>{t('insurance.quote.signedBy')} <code>{signedBy.slice(0, 6)}…{signedBy.slice(-4)}</code>. </span>}
          {txHash && <div style={{ marginTop: 6, wordBreak: 'break-all' }}>{t('insurance.quote.txHash')}: <code style={{ fontSize: 11 }}>{txHash}</code></div>}
          <div style={{ marginTop: 10 }}>
            <button className="ins-btn small" onClick={() => nav('/insurance/coverage')}>{t('insurance.quote.viewCoverage')}</button>
          </div>
        </div>
      ) : (
        <div className="ins-card">
          <div className="ins-row"><span>{t('insurance.quote.protection')}</span><b>{typeLabel(t, quote.protectionType)}</b></div>
          <div className="ins-row"><span>{t('insurance.market.coverage')}</span><b>${usd(quote.coverageAmountMicro)}</b></div>
          <div className="ins-row"><span>{t('insurance.market.duration')}</span><span>{t('insurance.quote.days', { count: quote.durationDays })}</span></div>
          <div style={{ margin: '6px 0', borderTop: '1px dashed var(--line)' }} />
          <div className="ins-fee-line"><span>{t('insurance.fee.providerPremium')}</span><span className="fee-val">${quote.premiumUsd}</span></div>
          <div className="ins-fee-line">
            <span>{t('insurance.fee.fbtFee')}</span>
            <span className="fee-val">${quote.fbtFeeUsd}</span>
          </div>
          {feeZero && <div className="ins-source" style={{ marginTop: 0 }}><span className="ins-fee-zero">{quote.fbtMarketplaceFeeDisclosure || t('insurance.fee.zero')}</span></div>}
          <div className="ins-fee-line"><span>{t('insurance.fee.networkFee')}</span><span className="fee-val">${quote.networkFeeUsd}</span></div>
          {String(quote.commissionMicro ?? '0') !== '0' && (
            <div className="ins-fee-line"><span>{t('insurance.fee.commission')}</span><span className="fee-val">${quote.commissionUsd}</span></div>
          )}
          <div className="ins-row ins-total"><span>{t('insurance.fee.total')}</span><span>${quote.totalCostUsd}</span></div>
          <div className="ins-row"><span>{t('insurance.quote.provider')}</span><span>{quote.providerName}</span></div>
          <div className="ins-row"><span>{t('insurance.quote.currency')}</span><span>{quote.currency}</span></div>
          <div className="ins-row"><span>{t('insurance.market.claimMethod')}</span><span>{claimLabel(t, quote.claimMethod)}</span></div>
          <div className="ins-source">
            <span><span className="k">{t('insurance.source.label')}:</span> {quote.quoteSource === 'provider-api' ? t('insurance.source.providerApi') : quote.quoteSource || 'UNKNOWN'} · {quote.providerName}</span>
            <span><span className="k">{t('insurance.source.freshness')}:</span> {t('insurance.source.live')}</span>
          </div>
          <div className="ins-muted" style={{ marginTop: 6 }}>{t('insurance.quote.feeNote')}</div>
        </div>
      )}

      {stage === 'ready' && (
        <div className="ins-card">
          <div className="ins-title" style={{ fontSize: 16 }}>{t('insurance.quote.coverageBox')}</div>
          <div className="ins-excl">{t('insurance.quote.coverageExplain', { type: quote.protectionType, max: usd(quote.coverageAmountMicro) })}</div>
          {quote.exclusions?.length > 0 && (
            <div className="ins-excl"><b>{t('insurance.quote.exclusions')}:</b><ul style={{ margin: '6px 0 0 18px' }}>{quote.exclusions.map((x, i) => <li key={i}>{typeof x === 'string' ? x : x?.source || x?.url || JSON.stringify(x)}</li>)}</ul></div>
          )}
          {(quote.termsUrl || quote.annexUrl) && (
            <div className="ins-source" style={{ marginBottom: 8 }}>
              {quote.termsUrl && <a href={quote.termsUrl} target="_blank" rel="noreferrer">{t('insurance.quote.termsLink')} ↗</a>}
              {quote.annexUrl && <a href={quote.annexUrl} target="_blank" rel="noreferrer">{t('insurance.quote.annexLink')} ↗</a>}
            </div>
          )}
          {connected ? (
            <>
              <div className="ins-ok">{t('insurance.quote.walletConnected', { chain: chainLabel })}</div>
              <button className="ins-btn" onClick={createIntent}>{t('insurance.quote.confirmPrepare')}</button>
            </>
          ) : (
            <div className="ins-state-card ins-state-card--sm">
              <div className="ins-state-ico">👛</div>
              <h2>{t('insurance.shell.walletRequiredTitle')}</h2>
              <p>{t('insurance.shell.walletRequiredBody')}</p>
              <div className="ins-state-actions"><Link className="ins-btn" to="/wallet">{t('insurance.shell.goWallet')}</Link></div>
            </div>
          )}
        </div>
      )}

      {stage === 'prepared' && intent && (
        <div className="ins-card">
          <div className="ins-ok"><b>{t('insurance.quote.preparedTitle')}</b> {t('insurance.quote.preparedBody')}</div>
          <div className="ins-row"><span>{t('insurance.quote.coverageId')}</span><code>{intent.coverageId}</code></div>
          {isLive && liveTx ? (
            <>
              <div className="ins-row"><span>{t('insurance.quote.contract')}</span><code style={{ fontSize: 11 }}>{liveTx.to}</code></div>
              <div className="ins-row"><span>{t('insurance.quote.mode')}</span><span className="ins-tag">{statusLabel(t, 'LIVE')} · {t('insurance.quote.unsigned')}</span></div>
              <div className="ins-sub" style={{ marginTop: 8 }}>{t('insurance.quote.liveSignNote')}</div>
              <button className="ins-btn" onClick={signAndActivate} disabled={stage === 'signing' || !connected}>{stage === 'signing' ? t('insurance.quote.signing') : t('insurance.quote.signLive')}</button>
            </>
          ) : (
            <>
              <div className="ins-row"><span>{t('insurance.quote.sendTo')}</span><code style={{ fontSize: 11 }}>{prepared?.to}</code></div>
              <div className="ins-row"><span>{t('insurance.quote.mode')}</span><span className="ins-tag">{statusLabel(t, 'SANDBOX')}</span></div>
              <div className="ins-sub" style={{ marginTop: 8 }}>{t('insurance.quote.sandboxNote')}</div>
              <button className="ins-btn" onClick={signAndActivate} disabled={stage === 'signing'}>{stage === 'signing' ? t('insurance.quote.signing') : t('insurance.quote.signSandbox')}</button>
            </>
          )}
        </div>
      )}
      {actErr && <div className="ins-alert">{actErr}</div>}
    </div>
  );
}
