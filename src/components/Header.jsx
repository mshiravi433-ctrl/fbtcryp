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
        {/* Coin mark. The glyph is stroked with an explicit gradient rather
            than currentColor — the parent sets no colour and its ::after inset
            sits on top, which is why this rendered as an empty black box. */}
        <div className="brand-mark">
          <motion.svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={{ rotateY: [0, 360] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            style={{ position: 'relative', zIndex: 2 }}
          >
            <defs>
              <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="50%" stopColor="#7c4dff" />
                <stop offset="100%" stopColor="#ff2d95" />
              </linearGradient>
            </defs>
            <circle cx="12" cy="12" r="9.2" stroke="url(#brandGrad)" strokeWidth="2.1" />
            <path d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4" stroke="url(#brandGrad)" />
            <path d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4" stroke="url(#brandGrad)" />
            <path d="M14.6 6.6v2.9h-2.9" stroke="url(#brandGrad)" />
            <path d="M9.4 17.4v-2.9h2.9" stroke="url(#brandGrad)" />
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
