import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import SpotTrade from '../components/spot/SpotTrade';

/**
 * `/perp` in a build WITHOUT the futures screens (SPECULATION_ENABLED off) but
 * WITH the spot flag on. It shows the same spot tab that Perp shows in the
 * full build, and nothing else: no futures tab, no futures copy. The page
 * title is the trade title, never the futures one.
 */
export default function SpotPage() {
  const { t } = useTranslation();
  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('trade.title')}</h1>
        <p className="muted">{t('spot.subtitle')}</p>
      </motion.div>
      <SpotTrade />
    </PageTransition>
  );
}
