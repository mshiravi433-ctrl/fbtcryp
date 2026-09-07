import { useTranslation } from 'react-i18next';

/* Inline theme-aware SVG icons (stroke: currentColor; no icon font). */
const Icon = {
  Wallet: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="14" rx="3"/><path d="M16 12.5h2.5"/><path d="M2.5 9.5h19"/></svg>),
  Shield: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2.5 4.5 5.5v6c0 4.7 3.2 8 7.5 10 4.3-2 7.5-5.3 7.5-10v-6L12 2.5Z"/><path d="m9 12 2 2 4-4.5"/></svg>),
  Risk: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor"/></svg>),
  Fee: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 15.2c.5.8 1.4 1.3 2.5 1.3 1.7 0 3-.9 3-2.3 0-2.8-5.4-1.5-5.4-4.1 0-1.2 1.1-2.1 2.6-2.1 1 0 1.9.4 2.4 1.1"/><path d="M12 6.5V8m0 8v1.5"/></svg>),
  Chain: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5"/><path d="M7.5 11.5 5 14a3.5 3.5 0 0 0 5 5l2.5-2.5"/><path d="M16.5 12.5 19 10a3.5 3.5 0 0 0-5-5l-2.5 2.5"/></svg>),
  Claim: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M15 3.5V7h4"/><path d="M9 12h7M9 15.5h5"/></svg>),
  Chev: () => (<svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>)
};

/**
 * «توضیحات و ریسک» — the expandable transparency box rendered at the BOTTOM
 * of every insurance page (inside InsuranceShell): how the flow works, every
 * fee, the risk criteria, claims honesty and the compliance notice. One source
 * of truth for the whole module.
 */
export default function InsuranceExplain() {
  const { t } = useTranslation();
  return (
    <details className="ins-details ins-explain">
      <summary>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon.Shield /> {t('insurance.explain.title')}
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
            <div className="ins-info-text" style={{ marginTop: 6 }}>{t('insurance.explain.feeNote')}</div>
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
        <div className="ins-legal-note">{t('insurance.explain.legal')}</div>
      </div>
    </details>
  );
}
