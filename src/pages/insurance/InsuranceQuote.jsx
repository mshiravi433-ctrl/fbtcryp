import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ethers } from 'ethers';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel, typeLabel, reasonLabel, claimLabel } from './insStatus.js';
import { insuranceError } from './insErrors.js';
import InsAlert from './InsAlert.jsx';
import {
  InsIconFee, InsIconHourglass, InsIconWallet, InsIconChevronEnd, InsIconCheck, InsIconInfo, InsIconExternal, InsIconLock, InsIconShield,
  INS_TYPE_ICONS, INS_TYPE_TONES
} from './InsuranceIcons.jsx';

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
      /* The heading below runs this through reasonLabel, so a code stays a
         code and a sentence stays a sentence — one line either way. */
      .catch((e) => setErr(insuranceError(e, t).text));
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
    } catch (e) {
      /* One line, named by cause — see ./insErrors.js. The raw envelope is
         behind the alert's details toggle, never in the toast. */
      const mapped = insuranceError(e, t);
      setActErr(mapped);
      notify(mapped.text, 'error');
    }
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
      if (!res.ok) {
        const e0 = res.errors?.[0] || {};
        /* keep the machine code on the Error so the mapper can translate it by
           code instead of re-guessing from prose. */
        const err = new Error(e0.detail || e0.code || 'ACTIVATION_FAILED');
        err.code = e0.code || 'ACTIVATION_FAILED';
        err.detail = res.errors;
        throw err;
      }
      setStage('done');
      notify(t('insurance.quote.activatedToast'), 'success');
    } catch (e) {
      /* THE FIX, in one line: the balance case used to be guessed with a regex
         over `e.message`, which MetaMask fills with «Internal JSON-RPC error.»
         while the real reason sits in `e.data.data[<hash>].message` — so an
         empty wallet got «Activation failed», and any provider that *does* put
         the dump in `message` got three lines of JSON. Both paths now go through
         insuranceError(), which digs for the reason and returns one sentence.
         The «موجودی کافی نیست…» Persian literal that used to sit in
         `defaultValue:` (a key that exists in no locale file) is gone with it:
         hardcoded target text is not translation. */
      const mapped = insuranceError(e, t);
      setActErr(mapped);
      /* A rejection is not a fault — say it quietly and briefly. */
      notify(mapped.text, 'error');
      setStage('prepared');
    }
  }

  if (err) return (
    <div className="ins-state-card ins-state-card--sm ins-tone-amber">
      <div className="ins-ico lg"><InsIconHourglass /></div>
      <h2>{t('insurance.quote.unavailableTitle')}</h2>
      <p>{t('insurance.quote.unavailable', { error: reasonLabel(t, err) })}</p>
      <div className="ins-state-actions">
        <button className="ins-btn ghost small" onClick={() => nav('/insurance/marketplace')}>{t('insurance.quote.backToMarket')}</button>
        <Link className="ins-btn ghost small" to="/insurance/marketplace">{t('insurance.unavailable.retry')}</Link>
      </div>
    </div>
  );
  if (!quote) return <div className="ins-skel" aria-busy="true">{t('insurance.quote.loading')}</div>;

  const feeZero = String(quote.fbtFeeMicro ?? '0') === '0';
  const TypeGlyph = INS_TYPE_ICONS[quote.protectionType] || InsIconShield;

  return (
    <div className={`ins-tone-${INS_TYPE_TONES[quote.protectionType] || 'violet'}`}>
      <div className="ins-hero">
        <div className="ins-ico lg"><TypeGlyph /></div>
        <div className="ins-hero-body">
          <span className="ins-hero-badge"><InsIconLock /> {t('insurance.market.nonCustodial')}</span>
          <h1>{t('insurance.quote.title')}</h1>
          <p>{t('insurance.quote.subtitle')}</p>
        </div>
      </div>

      {stage === 'done' ? (
        <div className="ins-ok">
          <InsIconCheck />
          <div style={{ minWidth: 0 }}>
            <b>{t('insurance.quote.doneTitle')}</b>{' '}
            {signedBy && <span>{t('insurance.quote.signedBy')} <code>{signedBy.slice(0, 6)}…{signedBy.slice(-4)}</code>. </span>}
            {txHash && <div style={{ marginTop: 6, wordBreak: 'break-all' }}>{t('insurance.quote.txHash')}: <code style={{ fontSize: 11 }}>{txHash}</code></div>}
            <div style={{ marginTop: 10 }}>
              <button className="ins-btn small" onClick={() => nav('/insurance/coverage')}>{t('insurance.quote.viewCoverage')} <InsIconChevronEnd /></button>
            </div>
          </div>
        </div>
      ) : (
        <div className="ins-card">
          <div className="ins-card-title"><span className="ins-ico"><InsIconFee /></span>{t('insurance.info.feesTitle')}</div>
          <div className="ins-quote-stats">
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.quote.protection')}</span><b style={{ fontFamily: 'var(--font-display)' }}>{quote.product?.name || typeLabel(t, quote.protectionType)}</b></div>
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.market.coverage')}</span><b>${usd(quote.coverageAmountMicro)}</b></div>
            <div className="ins-quote-stat"><span className="lbl">{t('insurance.market.duration')}</span><b>{t('insurance.quote.days', { count: quote.durationDays })}</b></div>
            <div className="ins-quote-stat acc"><span className="lbl">{t('insurance.fee.total')}</span><b>${quote.totalCostUsd}</b></div>
          </div>
          {quote.product?.name && <div className="ins-row"><span>{t('insurance.market.product')}</span><b>{quote.product.name}</b></div>}
          <div className="ins-divider" />
          <div className="ins-fee-line"><span>{t('insurance.fee.providerPremium')}</span><span className="fee-val">${quote.premiumUsd}</span></div>
          <div className="ins-fee-line">
            <span>{t('insurance.fee.fbtFee')}</span>
            <span className="fee-val">${quote.fbtFeeUsd}</span>
          </div>
          {feeZero && <div className="ins-source" style={{ marginTop: 0 }}><span className="ins-fee-zero"><InsIconCheck style={{ width: 13, height: 13 }} /> {quote.fbtMarketplaceFeeDisclosure || t('insurance.fee.zero')}</span></div>}
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
          <div className="ins-note" style={{ marginTop: 10 }}><InsIconInfo /><span>{t('insurance.quote.feeNote')}</span></div>
        </div>
      )}

      {stage === 'ready' && (
        <div className="ins-card">
          <div className="ins-card-title"><span className="ins-ico"><InsIconShield /></span>{t('insurance.quote.coverageBox')}</div>
          <div className="ins-note" style={{ marginTop: 0 }}><InsIconInfo /><span>{t('insurance.quote.coverageExplain', { type: quote.product?.name || typeLabel(t, quote.protectionType), max: usd(quote.coverageAmountMicro) })}</span></div>
          {quote.exclusions?.length > 0 && (
            <div className="ins-excl"><b>{t('insurance.quote.exclusions')}</b><ul>{quote.exclusions.map((x, i) => <li key={i}>{typeof x === 'string' ? x : x?.source || x?.url || JSON.stringify(x)}</li>)}</ul></div>
          )}
          {(quote.termsUrl || quote.annexUrl) && (
            <div className="ins-links" style={{ marginBottom: 10 }}>
              {quote.termsUrl && <a className="ins-link" href={quote.termsUrl} target="_blank" rel="noopener noreferrer"><InsIconExternal /> {t('insurance.quote.termsLink')}</a>}
              {quote.annexUrl && <a className="ins-link" href={quote.annexUrl} target="_blank" rel="noopener noreferrer"><InsIconExternal /> {t('insurance.quote.annexLink')}</a>}
            </div>
          )}
          {connected ? (
            <>
              <div className="ins-ok"><InsIconCheck /><span>{t('insurance.quote.walletConnected', { chain: chainLabel })}</span></div>
              <button className="ins-btn ins-cta" onClick={createIntent}>{t('insurance.quote.confirmPrepare')} <InsIconChevronEnd /></button>
            </>
          ) : (
            <div className="ins-state-card ins-state-card--sm ins-tone-magenta">
              <div className="ins-ico lg"><InsIconWallet /></div>
              <h2>{t('insurance.shell.walletRequiredTitle')}</h2>
              <p>{t('insurance.shell.walletRequiredBody')}</p>
              <div className="ins-state-actions"><Link className="ins-btn" to="/wallet">{t('insurance.shell.goWallet')} <InsIconChevronEnd /></Link></div>
            </div>
          )}
        </div>
      )}

      {stage === 'prepared' && intent && (
        <div className="ins-card">
          <div className="ins-ok"><InsIconCheck /><span><b>{t('insurance.quote.preparedTitle')}</b> {t('insurance.quote.preparedBody')}</span></div>
          <div className="ins-row"><span>{t('insurance.quote.coverageId')}</span><code>{intent.coverageId}</code></div>
          {isLive && liveTx ? (
            <>
              <div className="ins-row"><span>{t('insurance.quote.contract')}</span><code>{liveTx.to}</code></div>
              <div className="ins-row"><span>{t('insurance.quote.mode')}</span><span className="ins-chip LIVE">{statusLabel(t, 'LIVE')} · {t('insurance.quote.unsigned')}</span></div>
              <div className="ins-note"><InsIconLock /><span>{t('insurance.quote.liveSignNote')}</span></div>
              <div className="ins-form-actions"><button className="ins-btn ins-cta" onClick={signAndActivate} disabled={stage === 'signing' || !connected}>{stage === 'signing' ? t('insurance.quote.signing') : t('insurance.quote.signLive')}</button></div>
            </>
          ) : (
            <>
              <div className="ins-row"><span>{t('insurance.quote.sendTo')}</span><code>{prepared?.to}</code></div>
              <div className="ins-row"><span>{t('insurance.quote.mode')}</span><span className="ins-chip SANDBOX">{statusLabel(t, 'SANDBOX')}</span></div>
              <div className="ins-note"><InsIconInfo /><span>{t('insurance.quote.sandboxNote')}</span></div>
              <div className="ins-form-actions"><button className="ins-btn ins-cta" onClick={signAndActivate} disabled={stage === 'signing'}>{stage === 'signing' ? t('insurance.quote.signing') : t('insurance.quote.signSandbox')}</button></div>
            </>
          )}
        </div>
      )}
      {actErr ? <InsAlert error={actErr} /> : null}
    </div>
  );
}
