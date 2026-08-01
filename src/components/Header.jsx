import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { AnimatedSettings, useStill } from './AnimatedIcon';

/**
 * Top bar: brand and settings.
 *
 * News and language used to sit here too. Four icon buttons plus a balance
 * chip is a crowded 44px row on a small phone, and the two extras were
 * shortcuts to places that already have a home — news is a nav destination,
 * language now lives in Settings (and on the welcome screen, where a new user
 * actually needs it). One icon, one job.
 */
export default function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const [cogSpin, setCogSpin] = useState(false);

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
        {/*
          THE VIRTUAL BALANCE CHIP IS GONE.
          
          It showed `useAppStore.balance` — NX credits, the play-money used by
          the arcade and paper-trading screens. In the header it sat next to
          the brand on EVERY page, so the first number a user saw on a
          non-custodial exchange was a fake balance that looked like their
          money. On a screen whose entire promise is "you hold your own keys",
          that is the most misleading pixel in the app.
          
          Real balances live on /wallet, where they are labelled and where the
          on-chain wallet now sits above the virtual one.
        */}

        {/* The cog turns rather than the button rotating whole — the gear
            teeth moving is what reads as a mechanism. */}
        <motion.button
          className="icon-btn"
          onClick={() => {
            setCogSpin(true);
            navigate('/settings');
          }}
          onHoverStart={() => setCogSpin(true)}
          onHoverEnd={() => setCogSpin(false)}
          whileTap={{ scale: 0.9 }}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          aria-label={t('nav.settings')}
        >
          <AnimatedSettings active={cogSpin} still={still} width={17} height={17} />
        </motion.button>

      </div>
    </header>
  );
}
