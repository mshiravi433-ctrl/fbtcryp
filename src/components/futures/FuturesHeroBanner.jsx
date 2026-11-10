import { useTranslation } from 'react-i18next';
import '../../styles/futures-hero-banner.css';

/* Each tab describes its own product. No decorative graph is presented as a
   live futures curve, and no spot quote is relabelled as a futures price. */
const INFO = {
  overview: { name: 'PERPETUAL', network: 'MULTI-VENUE', settlement: 'futures.banner.variant.overviewSettlement' },
  dydx: { name: 'dYdX', network: 'dYdX CHAIN', settlement: 'USDC' },
  onchain: { name: 'ON-CHAIN', network: 'SOLANA', settlement: 'USDT' },
  spot: { name: 'SPOT', network: 'MULTI-CHAIN', settlement: 'futures.banner.variant.spotSettlement' }
};
export default function FuturesHeroBanner({ activeTab = 'overview' }) {
  const { t } = useTranslation();
  const mode = INFO[activeTab] ? activeTab : 'overview';
  const info = INFO[mode];
  return (
    <section className="fhb fhb-product" data-mode={mode} data-testid="futures-hero-banner">
      <div className="fhb-backdrop" aria-hidden="true" />
      <div className="fhb-product-copy">
        <div className="fhb-product-eyebrow">{info.network} · {info.name}</div>
        <h1 className="fhb-word-fa">{t(`futures.banner.variant.${mode}.title`)}</h1>
        <p>{t(`futures.banner.variant.${mode}.body`)}</p>
        <div className="fhb-product-pills"><span>{info.network}</span><span>{info.settlement.startsWith('futures.') ? t(info.settlement) : info.settlement}</span><span>{t('futures.banner.selfCustody')}</span></div>
      </div>
      <div className="fhb-product-mark" aria-hidden="true"><span>↗</span><span>↘</span></div>
    </section>
  );
}
