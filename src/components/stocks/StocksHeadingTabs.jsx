import { motion } from 'framer-motion';
import SegIndicator from '../SegIndicator';
import { riseIn } from '../PageTransition';

export default function StocksHeadingTabs({ t, tabs, tab, setTab }) {
  return (
    <>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('stocks.title')}</h1>
        <p className="muted">{t('stocks.subtitle')}</p>
      </motion.div>

      <div className="segmented" role="tablist" aria-label={t('stocks.title')}>
        {tabs.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}
            style={{ isolation: 'isolate' }}
          >
            {tab === k && <SegIndicator id="stk" />}
            {t(`stocks.tab.${k}`)}
          </button>
        ))}
      </div>
    </>
  );
}
