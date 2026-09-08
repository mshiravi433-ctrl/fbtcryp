import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel } from './insStatus.js';
import ModernSelect from '../../components/ModernSelect.jsx';
import { InsIconRisk, InsIconWallet, InsIconChevronEnd, InsIconAlert, InsIconInfo, InsIconCheck, InsIconShield, InsIconSearch, INS_TYPE_ICONS } from './InsuranceIcons.jsx';

/** exposure kind (server risk engine id) -> marketplace protection type id */
const KIND_TYPE = {
  smartContract: 'smart-contract', bridge: 'bridge', stablecoin: 'stablecoin',
  lending: 'lending', lp: 'lp', wallet: 'wallet', oracle: 'oracle', protocol: 'defi-protocol'
};
const KIND_KEYS = Object.keys(KIND_TYPE);
const DEFAULTS = [
  ['smartContract', '8000'], ['bridge', '5000'], ['stablecoin', '4000'], ['lp', '3000']
];

export default function InsuranceRisk() {
  const { t } = useTranslation();
  const { wallet } = useOutletContext();
  const [rows, setRows] = useState(DEFAULTS.map(([k, v]) => ({ kind: k, amount: v })));
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const kindName = (kind) => t(`insurance.types.${KIND_TYPE[kind] || kind}`, { defaultValue: kind });

  function setRow(i, k, v) { const n = rows.slice(); n[i] = { ...n[i], [k]: v }; setRows(n); }
  function add() { setRows([...rows, { kind: 'smartContract', amount: '1000' }]); }

  async function run() {
    setErr(''); setResult(null); setBusy(true);
    const exposures = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ kind: r.kind, amountUsd: r.amount, chainId: 56 }));
    if (!exposures.length) { setErr(t('insurance.risk.needExposure')); setBusy(false); return; }
    try {
      const res = await insuranceApi.protectPortfolio({ walletAddress: wallet, chainId: 1, durationDays: 30, exposures });
      setResult(res.data || res);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }

  const gap = result?.coverageGap;
  const riskAnalysis = result?.riskAnalysis || {};
  const openKinds = (riskAnalysis?.kinds || []).filter((k) => String(k?.gapUsd !== undefined ? k.gapUsd : '0') !== '0').slice(0, 3);

  if (!wallet) {
    return (
      <div className="ins-tone-amber">
        <div className="ins-title">{t('insurance.risk.title')}</div>
        <div className="ins-state-card ins-state-card--sm ins-tone-magenta">
          <div className="ins-ico lg"><InsIconWallet /></div>
          <h2>{t('insurance.shell.walletRequiredTitle')}</h2>
          <p>{t('insurance.shell.walletRequiredBody')}</p>
          <div className="ins-state-actions"><Link className="ins-btn" to="/wallet">{t('insurance.shell.goWallet')} <InsIconChevronEnd /></Link></div>
        </div>
      </div>
    );
  }

  const kindOptions = KIND_KEYS.map((k) => {
    const Glyph = INS_TYPE_ICONS[KIND_TYPE[k]] || InsIconShield;
    return { value: k, label: kindName(k), iconNode: <span className="ins-ico sm"><Glyph /></span> };
  });

  return (
    <div className="ins-tone-amber">
      <div className="ins-hero">
        <div className="ins-ico lg"><InsIconRisk /></div>
        <div className="ins-hero-body">
          <h1>{t('insurance.risk.title')}</h1>
          <p>{t('insurance.risk.subtitle')}</p>
        </div>
      </div>

      <div className="ins-card ins-form-card">
        <div className="ins-card-title"><span className="ins-ico"><InsIconSearch /></span>{t('insurance.risk.exposures')}</div>
        {rows.map((r, i) => (
          <div key={i} className="ins-risk-row">
            <ModernSelect value={r.kind} onChange={(v) => setRow(i, 'kind', String(v))} options={kindOptions} title={t('insurance.risk.kindAria')} placeholder={t('insurance.risk.kindAria')} searchable={false} compact />
            <label className="ins-amount" style={{ minHeight: 52 }}>
              <span className="ins-amount-cur" aria-hidden="true">$</span>
              <input type="number" inputMode="decimal" min={0} value={r.amount} onChange={(e) => setRow(i, 'amount', e.target.value)} aria-label={t('insurance.risk.amountAria')} style={{ fontSize: 17 }} />
            </label>
            <button type="button" className="ins-btn ghost small" aria-label={t('insurance.risk.removeRow')} onClick={() => setRows(rows.filter((_, x) => x !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="ins-btn ghost small" onClick={add}>+ {t('insurance.risk.addExposure')}</button>
        <div className="ins-form-actions">
          <button className="ins-btn ins-cta" disabled={busy} onClick={run}>{busy ? t('insurance.risk.analysing') : (<><InsIconRisk /> {t('insurance.risk.analyse')}</>)}</button>
        </div>
      </div>

      {err && <div className="ins-alert"><InsIconAlert /><span>{err}</span></div>}

      {result && (
        <>
          <div className="ins-grid">
            <div className="ins-stat"><div className="lbl">{t('insurance.risk.eligibleExposure')}</div><div className="val" style={{ fontSize: 18 }}>${gap?.eligibleExposureUsd || '0'}</div></div>
            <div className="ins-stat"><div className="lbl">{t('insurance.risk.activeCoverage')}</div><div className="val" style={{ fontSize: 18 }}>${gap?.activeCoverageUsd || '0'}</div></div>
            <div className="ins-stat acc"><div className="lbl">{t('insurance.risk.gap')}</div><div className="val" style={{ fontSize: 18 }}>${gap?.coverageGapUsd || '0'}</div></div>
            <div className="ins-stat"><div className="lbl">{t('insurance.risk.overall')}</div><div className="val" style={{ fontSize: 18 }}><span className={'ins-chip ' + (riskAnalysis?.overallRiskBand || 'LOW')}>{statusLabel(t, riskAnalysis?.overallRiskBand || 'LOW')}</span></div></div>
          </div>

          {openKinds.length > 0 && (
            <div className="ins-card">
              <div className="ins-card-title"><span className="ins-ico"><InsIconInfo /></span>{t('insurance.risk.summaryTitle')}</div>
              <ul className="ins-checks">
                <li><InsIconCheck /><span>{t('insurance.risk.summaryBase', { eligible: `$${gap?.eligibleExposureUsd || '0'}`, active: `$${gap?.activeCoverageUsd || '0'}` })}</span></li>
                <li><InsIconCheck /><span>{t('insurance.risk.summaryGap', { gap: `$${gap?.coverageGapUsd || '0'}` })}</span></li>
                {openKinds.map((k, i) => (
                  <li key={i}><InsIconAlert /><span>{kindName(k.kind)}: {statusLabel(t, k.riskBand || 'LOW')} — {t('insurance.risk.summaryUncovered', { amount: `$${k.gapUsd || usd(k.gapMicro || '0')}` })}</span></li>
                ))}
              </ul>
            </div>
          )}

          <div className="ins-card">
            <div className="ins-card-title"><span className="ins-ico"><InsIconShield /></span>{t('insurance.risk.recTitle')}</div>
            {(result.recommendations || []).map((r, i) => (
              <div key={i} className="ins-card ins-rec-card">
                <div className="ins-rec-head">
                  <b>{kindName(r.riskKind || r.protectionType)}</b>
                  <span className="ins-tag tone">{t('insurance.risk.recTag')}</span>
                </div>
                <div className="ins-row"><span>{t('insurance.risk.recommendedCoverage')}</span><b>${usd(r.recommendedCoverageMicro)}</b></div>
                {r.best ? (
                  <>
                    <div className="ins-row"><span>{t('insurance.risk.bestProvider')}</span><span>{r.best.providerName}</span></div>
                    <div className="ins-row"><span>{t('insurance.fee.providerPremium')}</span><span>${r.best.premiumUsd}</span></div>
                    <div className="ins-row"><span>{t('insurance.fee.total')}</span><span className="ins-total">${r.best.totalCostUsd}</span></div>
                    <div style={{ marginTop: 8 }}><button className="ins-btn small" onClick={() => nav(`/insurance/quote/${r.best.quoteId}`)}>{t('insurance.risk.buyReview')} <InsIconChevronEnd /></button></div>
                  </>
                ) : (
                  <div className="ins-muted">{r.blockedByPremium ? t('insurance.risk.premiumCapHit', { cheapest: r.cheapest?.totalCostUsd != null ? `$${r.cheapest.totalCostUsd}` : '—' }) : t('insurance.risk.quoteUnavailable')}</div>
                )}
              </div>
            ))}
            {result.recommendations?.length === 0 && (
              <div className="ins-ok"><InsIconCheck /><span>{t('insurance.risk.noRec', { gap: `$${gap?.coverageGapUsd || '0'}` })}</span></div>
            )}
            {!result.autoExecute && <div className="ins-muted" style={{ marginTop: 6 }}>{t('insurance.risk.autoNote')}</div>}
          </div>
        </>
      )}
    </div>
  );
}
