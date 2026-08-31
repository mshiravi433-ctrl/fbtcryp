import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import { IconChevronLeft } from '../components/Icons';
import TokenSmartMoney from '../components/TokenSmartMoney';
import '../styles/smart-money.css';

/**
 * Smart Money → Token detail. Standalone page reached from the intelligence
 * feed and search. The same <TokenSmartMoney> card is embedded in CoinDetail.
 */
export default function SmartMoneyToken() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chain, address } = useParams();
  const chainId = Number(chain) || 1;

  return (
    <PageTransition>
      <div className="sm-page">
        <motion.div className="row" style={{ gap: 10, marginBottom: 12 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 18 }}>✦ {t('sm.tokenIntel')}</h1>
        </motion.div>
        <TokenSmartMoney chainId={chainId} address={address} embedded={false} />
      </div>
    </PageTransition>
  );
}
