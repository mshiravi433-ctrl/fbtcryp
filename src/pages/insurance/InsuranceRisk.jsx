import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { insuranceApi, usd } from '../../lib/insuranceClient.js';
import { statusLabel } from './insStatus.js';

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
      <div>
        <div className="ins-title">{t('insurance.risk.title')}</div>
        <div className="ins-state-card ins-state-card--sm">
          <div className="ins-state-ico">👛</div>
          <h2>{t('insurance.shell.walletRequiredTitle')}</h2>
          <p>{t('insurance.shell.walletRequiredBody')}</p>
          <div className="ins-state-actions"><Link className="ins-btn" to="/wallet">{t('insurance.shell.goWallet')}</Link></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ins-title">{t('insurance.risk.title')}</div>
      <div className="ins-sub">{t('insurance.risk.subtitle')}</div>

      <div className="ins-card">
        <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.risk.exposures')}</div>
        {rows.map((r, i) => (
          <div key={i} className="ins-risk-row">
            <select className="ins-select" style={{ width: 'auto', minWidth: 150, margin: 0 }} value={r.kind} onChange={(e) => setRow(i, 'kind', e.target.value)} aria-label={t('insurance.risk.kindAria')}>
              {KIND_KEYS.map((k) => <option key={k} value={k}>{kindName(k)}</option>)}
            </select>
            <div style={{ flex: 1 }}>
              <input className="ins-input" style={{ margin: 0 }} type="number" min={0} value={r.amount} onChange={(e) => setRow(i, 'amount', e.target.value)} aria-label={t('insurance.risk.amountAria')} />
            </div>
            <button className="ins-btn ghost small" aria-label={t('insurance.risk.removeRow')} onClick={() => setRows(rows.filter((_, x) => x !== i))}>×</button>
          </div>
        ))}
        <button className="ins-btn ghost small" onClick={add}>+ {t('insurance.risk.addExposure')}</button>
        <div style={{ height: 10 }} />
        <button className="ins-btn ins-btn-lg" disabled={busy} onClick={run}>{busy ? t('insurance.risk.analysing') : t('insurance.risk.analyse')}</button>
      </div>

      {err && <div className="ins-alert">{err}</div>}

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
              <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.risk.summaryTitle')}</div>
              <div className="ins-info-text" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>• {t('insurance.risk.summaryBase', { eligible: `$${gap?.eligibleExposureUsd || '0'}`, active: `$${gap?.activeCoverageUsd || '0'}` })}</div>
                <div>• {t('insurance.risk.summaryGap', { gap: `$${gap?.coverageGapUsd || '0'}` })}</div>
                {openKinds.map((k, i) => (
                  <div key={i}>• {kindName(k.kind)}: {statusLabel(t, k.riskBand || 'LOW')} — {t('insurance.risk.summaryUncovered', { amount: `$${k.gapUsd || usd(k.gapMicro || '0')}` })}</div>
                ))}
              </div>
            </div>
          )}

          <div className="ins-card">
            <div className="ins-sub" style={{ marginTop: 0 }}>{t('insurance.risk.recTitle')}</div>
            {(result.recommendations || []).map((r, i) => (
              <div key={i} className="ins-card ins-rec-card" style={{ background: 'transparent' }}>
                <div className="ins-rec-head">
                  <b>{kindName(r.riskKind || r.protectionType)}</b>
                  <span className="ins-tag">{t('insurance.risk.recTag')}</span>
                </div>
                <div className="ins-row"><span>{t('insurance.risk.recommendedCoverage')}</span><b>${usd(r.recommendedCoverageMicro)}</b></div>
                {r.best ? (
                  <>
                    <div className="ins-row"><span>{t('insurance.risk.bestProvider')}</span><span>{r.best.providerName}</span></div>
                    <div className="ins-row"><span>{t('insurance.fee.providerPremium')}</span><span>${r.best.premiumUsd}</span></div>
                    <div className="ins-row"><span>{t('insurance.fee.total')}</span><span className="ins-total">${r.best.totalCostUsd}</span></div>
                    <button className="ins-btn small" onClick={() => nav(`/insurance/quote/${r.best.quoteId}`)}>{t('insurance.risk.buyReview')}</button>
                  </>
                ) : (
                  <div className="ins-muted">{r.blockedByPremium ? t('insurance.risk.premiumCapHit', { cheapest: r.cheapest?.totalCostUsd != null ? `$${r.cheapest.totalCostUsd}` : '—' }) : t('insurance.risk.quoteUnavailable')}</div>
                )}
              </div>
            ))}
            {result.recommendations?.length === 0 && (
              <div className="ins-ok">{t('insurance.risk.noRec', { gap: `$${gap?.coverageGapUsd || '0'}` })}</div>
            )}
            {!result.autoExecute && <div className="ins-muted" style={{ marginTop: 6 }}>{t('insurance.risk.autoNote')}</div>}
          </div>
        </>
      )}
    </div>
  );
}
