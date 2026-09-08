import { useEffect, useState } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel } from './insStatus.js';
import ModernSelect from '../../components/ModernSelect.jsx';
import {
  InsIconClaims, InsIconClaim, InsIconWallet, InsIconChevronEnd, InsIconAlert, InsIconInfo, InsIconCheck, InsIconHourglass, InsIconShield,
  INS_TYPE_ICONS
} from './InsuranceIcons.jsx';

/** Claim statuses are painted with the chip palette directly (insurance.css). */
const INCIDENTS = ['smart-contract-exploit', 'bridge-incident', 'depeg-event', 'oracle-failure', 'protocol-exploit', 'wallet-custody-loss'];
const INCIDENT_TYPE_ICON = {
  'smart-contract-exploit': 'smart-contract', 'bridge-incident': 'bridge', 'depeg-event': 'stablecoin',
  'oracle-failure': 'oracle', 'protocol-exploit': 'defi-protocol', 'wallet-custody-loss': 'wallet'
};

export default function InsuranceClaims() {
  const { t } = useTranslation();
  const { wallet, notify } = useOutletContext();
  const loc = useLocation();
  const initialCoverage = loc.state?.coverageId || '';
  const [claims, setClaims] = useState([]);
  const [coverageId, setCoverageId] = useState(initialCoverage);
  const [incidentType, setIncidentType] = useState('smart-contract-exploit');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (wallet) insuranceApi.claims(wallet).then((d) => setClaims(d.claims || [])).catch(() => {}); }, [wallet]);

  async function create() {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const body = {
        coverageId, walletAddress: wallet, incidentType,
        description: desc, evidenceHash: '0x' + 'ab'.repeat(32)
      };
      if (amount) body.affectedAmountMicro = amount;
      const r = await insuranceApi.createClaim(body);
      setMsg(t('insurance.claims.created', { number: r.data.claim.claimNumber, status: statusLabel(t, r.data.claim.status) }));
      notify(t('insurance.claims.createdToast', { number: r.data.claim.claimNumber }), 'success');
      const d = await insuranceApi.claims(wallet); setClaims(d.claims || []);
    } catch (e) { setErr(e.message || String(e)); notify(e.message || t('insurance.claims.failed'), 'error'); }
    setBusy(false);
  }

  async function submit(claimId) {
    try { await insuranceApi.submitClaim(claimId, { walletAddress: wallet }); const d = await insuranceApi.claims(wallet); setClaims(d.claims || []); notify(t('insurance.claims.submitted'), 'success'); } catch (e) { notify(e.message || t('insurance.claims.submitFailed'), 'error'); }
  }

  if (!wallet) {
    return (
      <div className="ins-tone-magenta">
        <div className="ins-title">{t('insurance.claims.title')}</div>
        <div className="ins-state-card ins-state-card--sm">
          <div className="ins-ico lg"><InsIconWallet /></div>
          <h2>{t('insurance.shell.walletRequiredTitle')}</h2>
          <p>{t('insurance.shell.walletRequiredBody')}</p>
          <div className="ins-state-actions"><Link className="ins-btn" to="/wallet">{t('insurance.shell.goWallet')} <InsIconChevronEnd /></Link></div>
        </div>
      </div>
    );
  }

  const incidentOptions = INCIDENTS.map((v) => {
    const Glyph = INS_TYPE_ICONS[INCIDENT_TYPE_ICON[v]] || InsIconShield;
    return {
      value: v,
      label: t(`insurance.claims.incidents.${v}`),
      iconNode: <span className="ins-ico sm ins-tone-magenta"><Glyph /></span>
    };
  });

  return (
    <div className="ins-tone-magenta">
      <div className="ins-hero">
        <div className="ins-ico lg"><InsIconClaims /></div>
        <div className="ins-hero-body">
          <h1>{t('insurance.claims.title')}</h1>
          <p>{t('insurance.claims.subtitle')}</p>
        </div>
      </div>

      <div className="ins-card ins-form-card">
        <div className="ins-card-title"><span className="ins-ico"><InsIconClaim /></span>{t('insurance.claims.fileTitle')}</div>
        <div className="ins-field">
          <div className="ins-label"><span>{t('insurance.claims.coverageId')}</span></div>
          <input className="ins-input" value={coverageId} onChange={(e) => setCoverageId(e.target.value)} placeholder="cov-…" aria-label={t('insurance.claims.coverageId')} />
        </div>
        <div className="ins-field-row">
          <div className="ins-field">
            <div className="ins-label"><span>{t('insurance.claims.incidentType')}</span></div>
            <ModernSelect value={incidentType} onChange={(v) => setIncidentType(String(v))} options={incidentOptions} title={t('insurance.claims.incidentType')} placeholder={t('insurance.claims.incidentType')} searchable={false} compact />
          </div>
          <div className="ins-field">
            <div className="ins-label"><span>{t('insurance.claims.affectedAmount')}</span></div>
            <label className="ins-amount" style={{ minHeight: 52 }}>
              <span className="ins-amount-cur" aria-hidden="true">$</span>
              <input type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" aria-label={t('insurance.claims.affectedAmount')} style={{ fontSize: 18 }} />
            </label>
          </div>
        </div>
        <div className="ins-field">
          <div className="ins-label"><span>{t('insurance.claims.description')}</span></div>
          <textarea className="ins-textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('insurance.claims.descPlaceholder')} aria-label={t('insurance.claims.description')} />
        </div>
        <div className="ins-form-actions">
          <button className="ins-btn ins-cta" disabled={busy || !coverageId} onClick={create}>{busy ? t('insurance.claims.creating') : (<><InsIconClaim /> {t('insurance.claims.createBtn')}</>)}</button>
        </div>
      </div>
      {err && <div className="ins-alert"><InsIconAlert /><span>{err}</span></div>}
      {msg && <div className="ins-ok"><InsIconCheck /><span>{msg}</span></div>}

      {(claims || []).length === 0 && <div className="ins-ok neutral"><InsIconInfo /><span>{t('insurance.claims.empty')}</span></div>}
      {(claims || []).length > 0 && (
        <div className="ins-sec-title">
          <span className="ins-ico"><InsIconHourglass /></span>
          {t('insurance.claims.title')}
          <span className="ins-sec-count">{claims.length}</span>
        </div>
      )}
      {(claims || []).map((c) => (
        <div className="ins-card" key={c.claimId}>
          <div className="ins-row">
            <span><b>{c.claimNumber}</b> · <Link to={`/insurance/coverage/${c.coverageId}`} className="ins-link" style={{ minHeight: 26 }}>{t('insurance.claims.linkCoverage')}</Link></span>
            <span className={'ins-chip ' + c.status}>{statusLabel(t, c.status)}</span>
          </div>
          <div className="ins-row"><span>{t('insurance.claims.incidentType')}</span><span>{t(`insurance.claims.incidents.${c.incidentType}`, { defaultValue: c.incidentType })}</span></div>
          <div className="ins-row"><span>{t('insurance.claims.requestPayout')}</span><b>${usd(c.requestedPayoutUsd || '0')}</b></div>
          <div className="ins-row"><span>{t('insurance.claims.approved')}</span><span>${c.approvedPayoutUsd ?? '—'}</span></div>
          <div className="ins-row"><span>{t('insurance.claims.paid')}</span><span>${c.payoutUsd ?? '—'}</span></div>
          <div className="ins-row"><span>{t('insurance.claims.evidence')}</span><code>{c.evidenceHash?.slice(0, 20)}…</code></div>
          <div className="ins-label" style={{ marginTop: 10 }}><span>{t('insurance.claims.timeline')}</span></div>
          <ol className="ins-steps">
            {(c.timeline || []).map((tl, i) => (
              <li key={i}><span className="ins-step-n">{i + 1}</span><span style={{ flex: 1 }}>{statusLabel(t, tl.status)}</span><span className="ins-event-time">{new Date(tl.at).toLocaleString()}</span></li>
            ))}
          </ol>
          {(c.status === 'DRAFT' || c.status === 'ADDITIONAL_INFORMATION_REQUIRED') && (
            <div style={{ marginTop: 10 }}><button className="ins-btn small" onClick={() => submit(c.claimId)}>{t('insurance.claims.submitBtn')} <InsIconChevronEnd /></button></div>
          )}
          {c.status === 'REJECTED' && c.rejectReason && <div className="ins-alert"><InsIconAlert /><span>{t('insurance.claims.rejectReason')}: {c.rejectReason}</span></div>}
        </div>
      ))}
    </div>
  );
}
