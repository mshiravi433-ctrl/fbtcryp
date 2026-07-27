import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { fmtNum } from '../lib/format';
import { IconSettings } from './Icons';
import AnimatedNumber from './AnimatedNumber';

export default function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const balance = useAppStore((s) => s.balance);
  const level = useAppStore((s) => s.level);

  return (
    <header className="top-bar">
      <motion.div
        className="brand"
        initial={{ opacity: 0, x: -14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className="brand-mark">
          <motion.svg
            width="17" height="17" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            animate={{ rotate: [0, 180, 360] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 1] }}
            style={{ position: 'relative', zIndex: 1 }}
          >
            <path d="M17 3.5a9 9 0 0 1 3.9 6.9" />
            <path d="M7 20.5a9 9 0 0 1-3.9-6.9" />
            <path d="M14.5 2 18 4.2l-2.4 3" />
            <path d="M9.5 22 6 19.8l2.4-3" />
            <path d="M3.2 10.4A9 9 0 0 1 12 3" />
            <path d="M20.8 13.6A9 9 0 0 1 12 21" />
          </motion.svg>
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

        <motion.button
          className="icon-btn"
          onClick={() => navigate('/settings')}
          whileTap={{ scale: 0.9, rotate: 45 }}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          aria-label="settings"
        >
          <IconSettings width={17} height={17} />
        </motion.button>

      </div>
    </header>
  );
}
