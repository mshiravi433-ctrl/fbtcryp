import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import { IconChevronLeft } from '../components/Icons';
import { SmCoinGlyph, SmSignalGlyph } from '../components/smart-money/SmGlyphs';
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
  /* A Solana URL (/smart-money/token/solana/<mint>) must stay Solana — the
     intel route serves base58 mints, and coercing the slug to 1 would ask it
     for an Ethereum contract. */
  const chainId = chain === 'solana' ? 'solana' : Number(chain) || 1;

  return (
    <PageTransition>
      <div className="sm-page">
        <motion.header className="smx-pagehead" variants={riseIn} initial="hidden" animate="show">
          <button type="button" className="smx-pagehead-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={17} height={17} />
          </button>
          <span className="smx-pagehead-ico" aria-hidden="true"><SmCoinGlyph width={17} height={17} /></span>
          <div className="smx-pagehead-text">
            <span className="smx-pagehead-kicker">FBT · SMART MONEY</span>
            <h1>{t('sm.tokenIntel')}</h1>
          </div>
          <span className="smx-pagehead-mark" aria-hidden="true"><SmSignalGlyph width={15} height={15} /></span>
        </motion.header>
        <TokenSmartMoney chainId={chainId} address={address} embedded={false} />
      </div>
    </PageTransition>
  );
}
