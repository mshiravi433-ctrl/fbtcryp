import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { applyDirection } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { fmtNum } from '../lib/format';
import AnimatedNumber from './AnimatedNumber';

const LANGS = ['fa', 'en', 'ar'];

export default function Header() {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const balance = useAppStore((s) => s.balance);
  const level = useAppStore((s) => s.level);

  const setLang = (lng) => {
    i18n.changeLanguage(lng);
    applyDirection(lng);
  };

  return (
    <header className="top-bar">
      <motion.div
        className="brand"
        initial={{ opacity: 0, x: -14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className="brand-mark">
          <span>⇄</span>
        </div>
        <div className="brand-text">
          <span className="brand-name gradient-text">FBT Swap</span>
          <span className="brand-sub">decentralized exchange</span>
        </div>
      </motion.div>

      <div className="row" style={{ gap: 8 }}>
        <motion.button
          className="balance-chip"
          onClick={() => navigate('/wallet')}
          whileTap={{ scale: 0.94 }}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ border: 'none', color: 'var(--text-1)', cursor: 'pointer' }}
          aria-label={t('common.balance')}
        >
          <span style={{ fontSize: 11 }}>💎</span>
          <AnimatedNumber value={balance} format={(v) => fmtNum(v, 0)} />
          <span style={{ color: 'var(--text-3)', fontSize: 10 }}>L{level}</span>
        </motion.button>

        <div className="lang-switch">
          {LANGS.map((lng) => {
            const active = i18n.language === lng;
            return (
              <button
                key={lng}
                className={`lang-btn ${active ? 'active' : ''}`}
                onClick={() => setLang(lng)}
                style={{ isolation: 'isolate' }}
              >
                <AnimatePresence>
                  {active && (
                    <motion.span
                      layoutId="lang-pill"
                      className="lang-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    />
                  )}
                </AnimatePresence>
                {lng}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
