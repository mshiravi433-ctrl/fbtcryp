import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sheet from '../Sheet';
import Portfolio from '../../pages/Portfolio';
import WalletPnl from '../WalletPnl';
import SecurityCenterCard from '../SecurityCenterCard';
import OpportunityDashboard from '../ai/OpportunityDashboard';
import { useOpportunityEngine } from '../../hooks/useOpportunityEngine';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { apiBase } from '../../lib/apiBase';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../../lib/chains';
import { fmtUsd } from '../../lib/format';
import { pushReallySubscribed, registerPushAnywhere, previewNotification } from '../../lib/notify';
import { IconChevronRight } from '../Icons';
import '../../styles/wallet-command.css';
import '../../styles/opportunity-dashboard.css';

/**
 * ONE SHEET FOR THE WHOLE WALLET BRAIN.
 *
 * The wallet used to offer a shallow « intelligence » popup, a separate P&L
 * popup and a separate security popup. This is the requested single, deep
 * command centre: the verified portfolio read is handed in by the page, the
 * opportunity and risk engines run ONLY while the sheet is open, and every
 * figure remains traceable to a local read or a connected source. The icon in
 * the header is the requested door to the Smart Wallet.
 */
export default function WalletCommandSheet({ open, onClose, initialTab = 'overview', portfolio = {}, intel = null, wallet = {} }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState(initialTab);

  useEffect(() => { if (open) setTab(initialTab || 'overview'); }, [open, initialTab]);

  const opportunity = useOpportunityEngine({ enabled: open, autoScan: open });
  const risk = useRiskEngine({ enabled: open });
  const [nftChains, setNftChains] = useState(null);
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || tab !== 'nft' || nftChains !== null) return;
    let alive = true;
    fetch(`${apiBase()}/nft/chains`).then((r) => r.json()).then((d) => {
      if (!alive) return;
      setNftChains({ configured: Boolean(d?.configured), list: Array.isArray(d?.chains) ? d.chains : [] });
    }).catch(() => { if (alive) setNftChains({ configured: false, list: [] }); });
    return () => { alive = false; };
  }, [open, tab, nftChains]);

  useEffect(() => { if (open) setPushOn(Boolean(pushReallySubscribed())); }, [open]);

  const go = useCallback((to) => { onClose?.(); navigate(to); }, [navigate, onClose]);
  const score = risk.report?.score || {};
  const families = useMemo(() => (risk.report?.families || [])
    .filter((f) => f.score != null)
    .sort((a, b) => Number(b.score) - Number(a.score)), [risk.report?.families]);

  const changes = useMemo(() => [
    ['24H', intel?.change24h], ['7D', intel?.change7d], ['30D', intel?.change30d]
  ].map(([k, v]) => ({ k, abs: v?.abs ?? null, from: v?.from ?? null })), [intel]);

  const maxChange = Math.max(1, ...changes.map((c) => Math.abs(c.abs ?? 0)));
  const smartButton = (
    <button
      type="button"
      className="wcmd-smart"
      aria-label={t('wnew.smartWallet')}
      title={t('wnew.smartWallet')}
      data-testid="wallet-command-smart"
      onClick={() => go('/smart-wallet')}
    >
      <IconChevronRight width={15} height={15} />
    </button>
  );

  const enablePush = async () => {
    setBusy(true);
    try {
      const res = await registerPushAnywhere();
      setPushOn(Boolean(res?.ok || pushReallySubscribed()));
      await previewNotification('ready', { lang: i18n.resolvedLanguage || i18n.language });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('wnew.title')} anchor="bottom" size="lg" headerAction={smartButton} testId="wallet-command-sheet">
      <div className="wcmd">
        {tab === 'overview' && (
          <div className="wcmd-panel" role="tabpanel">
            <div className="wcmd-grid">
              <div className="wcmd-stat"><span>{t('wnew.netWorth')}</span><b className="mono">{fmtUsd(portfolio.totalValue ?? intel?.total ?? 0)}</b></div>
              <div className="wcmd-stat"><span>{t('wnew.assets')}</span><b className="mono">{portfolio.totalCount ?? intel?.rows?.length ?? 0}</b></div>
              <div className="wcmd-stat"><span>{t('wnew.riskScore')}</span><b className="mono">{score.value == null ? '—' : Math.round(score.value)}</b></div>
              <div className="wcmd-stat"><span>{t('wnew.coverage')}</span><b className="mono">{portfolio.pricedCount != null && portfolio.totalCount ? `${portfolio.pricedCount}/${portfolio.totalCount}` : '—'}</b></div>
            </div>

            <div className="wcmd-card">
              <h3>{t('wnew.changeTitle')}</h3>
              <div className="wcmd-change">
                {changes.map((c) => (
                  <div key={c.k}>
                    <span>{c.k}</span>
                    <i style={{ '--w': `${Math.min(100, (Math.abs(c.abs ?? 0) / maxChange) * 100)}%`, '--c': (c.abs ?? 0) >= 0 ? '#00ff9d' : '#ff5c8a' }} />
                    <b className={(c.abs ?? 0) >= 0 ? 'up' : 'down'}>{c.abs == null ? '—' : `${c.from > 0 ? `${((c.abs / c.from) * 100).toFixed(1)}%` : fmtUsd(c.abs)}`}</b>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 8 }}>{t('wnew.changeNote')}</p>
            </div>

            <Portfolio embedded portfolio={portfolio} intel={intel} />
          </div>
        )}

        {tab === 'opportunity' && (
          <div className="wcmd-panel" role="tabpanel">
            {opportunity.scan ? (
              <OpportunityDashboard
                scan={opportunity.scan}
                locale={i18n.resolvedLanguage || i18n.language}
                onRescan={(o) => opportunity.scanNow({
                  capital: { ...opportunity.capital, investableUsd: Math.max(0, Number(o.capitalUsd) || 0) },
                  riskProfile: o.riskProfile,
                  horizonDays: Number(o.horizonDays) || 30
                })}
                onOpenRoom={() => go('/opportunities')}
              />
            ) : (
              <div className="wcmd-card">
                <h3>{t('wnew.opportunityTitle')}</h3>
                <p>{opportunity.error ? t('wnew.engineError') : t('wnew.engineLoading')}</p>
                <div className="wcmd-actions" style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => opportunity.scanNow()}>{t('common.retry')}</button>
                  <button type="button" className="btn btn-primary" onClick={() => go('/opportunities')}>{t('wnew.openEngine')}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'risk' && (
          <div className="wcmd-panel" role="tabpanel">
            <div className="wcmd-card">
              <h3>{t('wnew.riskTitle')}</h3>
              <div className="wcmd-grid">
                <div className="wcmd-stat"><span>{t('wnew.riskScore')}</span><b className="mono">{score.value == null ? '—' : Math.round(score.value)}</b></div>
                <div className="wcmd-stat"><span>{t('wnew.coverage')}</span><b className="mono">{score.coverage == null ? '—' : `${Math.round(score.coverage * 100)}%`}</b></div>
                <div className="wcmd-stat"><span>{t('wnew.measured')}</span><b className="mono">{score.measured ?? 0}/10</b></div>
                <div className="wcmd-stat"><span>{t('wnew.contracts')}</span><b className="mono">{risk.evidence?.contractsScanned ?? 0}</b></div>
              </div>
              <p style={{ marginTop: 9 }}>{t('wnew.riskBand')}: {i18n.resolvedLanguage?.startsWith('fa') ? score.band?.fa : score.band?.en || '—'}</p>
            </div>
            <div className="wcmd-card">
              <h3>{t('wnew.riskFamilies')}</h3>
              {families.length ? (
                <div className="wcmd-rows">
                  {families.slice(0, 6).map((f) => (
                    <div className="wcmd-row" key={f.id}>
                      <span>{i18n.resolvedLanguage?.startsWith('fa') ? f.labelFa : f.labelEn}</span>
                      <b className="mono">{Math.round(f.score)}/100</b>
                    </div>
                  ))}
                </div>
              ) : <p>{risk.loading ? t('wnew.engineLoading') : t('wnew.noRiskData')}</p>}
            </div>
            {risk.report?.unavailable?.length > 0 && (
              <div className="wcmd-card"><p>{t('wnew.unavailable')}: {risk.report.unavailable.slice(0, 6).join(' · ')}</p></div>
            )}
          </div>
        )}

        {tab === 'pnl' && (
          <div className="wcmd-panel" role="tabpanel">
            <WalletPnl intel={intel} />
            <div className="wcmd-card">
              <h3>{t('wnew.pnlByAsset')}</h3>
              {(intel?.rows || []).length ? (
                <div className="wcmd-rows">
                  {intel.rows.map((r) => (
                    <div className="wcmd-row" key={`${r.key || r.symbol}-${r.chainId}`}>
                      <span>{r.symbol} <small className="faint">· {r.chainId ?? '—'}</small></span>
                      <b className={r.pnl >= 0 ? 'up' : 'down'}>{r.pnl == null ? '—' : fmtUsd(r.pnl)}</b>
                    </div>
                  ))}
                </div>
              ) : <p>{t('wnew.noRiskData')}</p>}
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div className="wcmd-panel" role="tabpanel">
            <SecurityCenterCard />
            <div className="wcmd-card">
              <h3>{t('wnew.securityDeep')}</h3>
              <p>{t('wnew.securityBody')}</p>
              <div className="wcmd-actions" style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => go('/smart-wallet')}>{t('wnew.smartWallet')}</button>
                <button type="button" className="btn btn-primary" onClick={() => go('/audit')}>{t('wnew.revoke')}</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'defi' && (
          <div className="wcmd-panel" role="tabpanel">
            <div className="wcmd-card">
              <h3>{t('wnew.defiTitle')}</h3>
              <p>{t('wnew.defiBody')}</p>
            </div>
            <div className="wcmd-card">
              <h3>{t('wnew.defiStable')}</h3>
              <div className="wcmd-rows">
                {(portfolio.rows || []).filter((r) => /^(USDT|USDC|DAI|FDUSD|TUSD)$/i.test(r.symbol)).slice(0, 8).map((r) => (
                  <div className="wcmd-row" key={r.key}><span>{r.symbol} · {String(r.chainId)}</span><b>{fmtUsd(r.value)}</b></div>
                ))}
              </div>
              {!(portfolio.rows || []).some((r) => /^(USDT|USDC|DAI|FDUSD|TUSD)$/i.test(r.symbol)) && <p>{t('wnew.noStable')}</p>}
            </div>
            <div className="wcmd-actions">
              <button type="button" className="btn btn-primary" onClick={() => go('/farm')}>{t('nav.farm')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => go('/loan')}>{t('nav.loan')}</button>
            </div>
          </div>
        )}

        {tab === 'nft' && (
          <div className="wcmd-panel" role="tabpanel">
            <div className="wcmd-card">
              <h3>{t('wnew.nftTitle')}</h3>
              <p>{t('wnew.nftBody')}</p>
              <div className="wcmd-chainchips" style={{ marginTop: 10 }}>
                {EVM_CHAIN_ORDER.map((id) => {
                  const on = nftChains?.list?.map(Number).includes(Number(id));
                  return <span key={id} className={on ? 'is-on' : ''}>{EVM_CHAINS[id]?.short ?? id} · {on ? t('wnew.indexed') : t('wnew.notIndexed')}</span>;
                })}
              </div>
            </div>
            <button type="button" className="btn btn-primary" style={{ minHeight: 46, borderRadius: 14 }} onClick={() => go('/nft')}>{t('wnew.openNft')}</button>
          </div>
        )}

        {tab === 'alerts' && (
          <div className="wcmd-panel" role="tabpanel">
            <div className="wcmd-card">
              <h3>{t('wnew.alertsTitle')}</h3>
              <p>{t('wnew.alertsBody')}</p>
              <div className="wcmd-actions" style={{ marginTop: 11 }}>
                <button type="button" className="btn btn-primary" disabled={busy || pushOn} onClick={() => void enablePush()}>
                  {pushOn ? t('wnew.alertsOn') : t('wnew.alertsEnable')}
                </button>
                <button type="button" className="btn btn-ghost" disabled={!pushOn || busy} onClick={() => void previewNotification('ready', { lang: i18n.resolvedLanguage || i18n.language })}>
                  {t('wnew.alertsTest')}
                </button>
              </div>
            </div>
            <div className="wcmd-actions">
              <button type="button" className="btn btn-ghost" onClick={() => go('/orders')}>{t('nav.orders')}</button>
              <button type="button" className="btn btn-primary" onClick={() => go('/settings')}>{t('nav.settings')}</button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
