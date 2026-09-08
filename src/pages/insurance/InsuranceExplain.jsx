import { useTranslation } from 'react-i18next';
import {
  InsIconWallet, InsIconShield, InsIconRisk, InsIconFee, InsIconChain, InsIconClaim,
  InsIconChevronDown, InsIconCheck, InsIconLock
} from './InsuranceIcons.jsx';

/* Theme-aware SVG icons (stroke: currentColor; 24×24 grid, no icon font).
   The names are kept so the probe can assert each section carries its glyph. */
const Icon = {
  Wallet: InsIconWallet,
  Shield: InsIconShield,
  Risk: InsIconRisk,
  Fee: InsIconFee,
  Chain: InsIconChain,
  Claim: InsIconClaim,
  Chev: InsIconChevronDown
};

const FLOW = ['flow1', 'flow2', 'flow3', 'flow4', 'flow5', 'flow6', 'flow7', 'flow8'];
const RISKS = ['risk1', 'risk2', 'risk3', 'risk4', 'risk5', 'risk6', 'risk7', 'risk8', 'risk9', 'risk10', 'risk11', 'risk12'];
const CLAIMS = ['claim1', 'claim2', 'claim3', 'claim4', 'claim5'];
const FEES = [
  ['insurance.fee.providerPremium', false],
  ['insurance.fee.fbtFee', false],
  ['insurance.fee.networkFee', false],
  ['insurance.fee.commission', false],
  ['insurance.fee.total', true]
];

/**
 * «توضیحات و ریسک» — the expandable transparency box rendered at the BOTTOM
 * of every insurance page (inside InsuranceShell): how the flow works, every
 * fee, the risk criteria, claims honesty and the compliance notice. One source
 * of truth for the whole module.
 *
 * Layout: one native <details> (works without JS, keyboard-accessible) whose
 * body is a stack of tone-washed sections — numbered steps for the purchase
 * flow, a two-column parameter grid for the risk inputs, an itemised fee
 * table and a check-list for claims — instead of a wall of bullets.
 */
export default function InsuranceExplain() {
  const { t } = useTranslation();
  return (
    <details className="ins-details ins-explain ins-tone-cyan">
      <summary>
        <span className="ins-ico"><Icon.Shield /></span>
        <span className="ins-explain-sum-text">
          <b>{t('insurance.explain.title')}</b>
          <small>{t('insurance.explain.summaryHint')}</small>
        </span>
        <span className="ins-explain-chev" aria-hidden="true"><Icon.Chev /></span>
      </summary>

      <div className="ins-explain-body">
        {/* wallet & custody */}
        <section className="ins-x ins-tone-magenta">
          <div className="ins-x-head">
            <span className="ins-ico"><Icon.Wallet /></span>
            <div>
              <h3>{t('insurance.info.walletTitle')}</h3>
              <small>{t('insurance.explain.sectionWallet')}</small>
            </div>
          </div>
          <p>{t('insurance.info.walletBody')}</p>
        </section>

        {/* purchase flow */}
        <section className="ins-x ins-tone-cyan">
          <div className="ins-x-head">
            <span className="ins-ico"><Icon.Chain /></span>
            <div>
              <h3>{t('insurance.info.flowTitle')}</h3>
              <small>{t('insurance.explain.sectionFlow', { count: FLOW.length })}</small>
            </div>
          </div>
          <ol className="ins-steps">
            {FLOW.map((k, i) => (
              <li key={k}><span className="ins-step-n">{i + 1}</span><span>{t(`insurance.info.${k}`)}</span></li>
            ))}
          </ol>
        </section>

        {/* risk parameters */}
        <section className="ins-x ins-tone-amber">
          <div className="ins-x-head">
            <span className="ins-ico"><Icon.Risk /></span>
            <div>
              <h3>{t('insurance.info.riskTitle')}</h3>
              <small>{t('insurance.explain.sectionRisk', { count: RISKS.length })}</small>
            </div>
          </div>
          <p>{t('insurance.info.riskIntro')}</p>
          <ul className="ins-params">
            {RISKS.map((k, i) => (
              <li key={k}><span className="ins-param-n">{String(i + 1).padStart(2, '0')}</span><span>{t(`insurance.info.${k}`)}</span></li>
            ))}
          </ul>
        </section>

        {/* fees */}
        <section className="ins-x ins-tone-mint">
          <div className="ins-x-head">
            <span className="ins-ico"><Icon.Fee /></span>
            <div>
              <h3>{t('insurance.info.feesTitle')}</h3>
              <small>{t('insurance.explain.sectionFees')}</small>
            </div>
          </div>
          <ul className="ins-fee-table">
            {FEES.map(([key, total], i) => (
              <li key={key} className={total ? 'total' : ''}>
                <span className="ins-fee-dot" aria-hidden="true" />
                <span>{t(key)}</span>
                <span className="ins-fee-plus" aria-hidden="true">{total ? '=' : i === 0 ? '' : '+'}</span>
              </li>
            ))}
          </ul>
          <p className="ins-x-note">{t('insurance.explain.feeNote')}</p>
        </section>

        {/* claims */}
        <section className="ins-x ins-tone-violet">
          <div className="ins-x-head">
            <span className="ins-ico"><Icon.Claim /></span>
            <div>
              <h3>{t('insurance.info.claimsTitle')}</h3>
              <small>{t('insurance.explain.sectionClaims')}</small>
            </div>
          </div>
          <ul className="ins-checks">
            {CLAIMS.map((k) => (
              <li key={k}><InsIconCheck /><span>{t(`insurance.info.${k}`)}</span></li>
            ))}
          </ul>
        </section>

        <div className="ins-legal-note"><InsIconLock /><span>{t('insurance.explain.legal')}</span></div>
      </div>
    </details>
  );
}
