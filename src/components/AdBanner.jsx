import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronRight, IconExternal } from './Icons';

/**
 * Promo banner.
 *
 * These are HOUSE ADS — they point at our own screens, which is the honest
 * thing to run before any ad network is integrated. Every slot drives users
 * toward the parts of the app that actually generate the 0.5% fee, so the
 * banner earns its screen space rather than just filling it.
 *
 * If you later sell placements to third parties, label them as sponsored.
 * An unlabelled paid ad inside a finance app is a regulatory problem in most
 * markets, and users who feel tricked don't come back.
 */

const SLOTS = {
  swap: { to: '/swap', hues: ['#00e5ff', '#7c4dff'], icon: '⇄' },
  farm: { to: '/farm', hues: ['#00ff9d', '#00e5ff'], icon: '◈' },
  signals: { to: '/signals', hues: ['#7c4dff', '#ff2d95'], icon: '✦' },
  p2p: { to: '/p2p', hues: ['#ffb300', '#ff6d00'], icon: '⇅' },
  referral: { to: '/earn', hues: ['#ff2d95', '#d500f9'], icon: '★' }
};

export default function AdBanner({ slot = 'swap', compact = false, external = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const cfg = SLOTS[slot] ?? SLOTS.swap;

  // Deterministic shimmer offset so multiple banners on one screen aren't
  // animating in lockstep — that reads as a glitch rather than a design.
  const delay = useMemo(() => (slot.charCodeAt(0) % 5) * 0.4, [slot]);

  const go = () => {
    haptic?.('light');
    if (external) {
      if (tg?.openLink) tg.openLink(external);
      else window.open(external, '_blank', 'noopener,noreferrer');
    } else {
      navigate(cfg.to);
    }
  };

  return (
    <motion.button
      className="ad-banner"
      onClick={go}
      whileTap={{ scale: 0.985 }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        '--ad-a': cfg.hues[0],
        '--ad-b': cfg.hues[1],
        padding: compact ? '11px 13px' : '14px 15px'
      }}
    >
      <span className="ad-shine" style={{ animationDelay: `${delay}s` }} />

      <span className="ad-icon" aria-hidden="true">
        {cfg.icon}
      </span>

      <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: compact ? 12.5 : 13.5 }}>
          {t(`ads.${slot}.title`)}
        </span>
        {!compact && (
          <span className="set-row-sub" style={{ marginTop: 2 }}>
            {t(`ads.${slot}.body`)}
          </span>
        )}
      </span>

      <span className="ad-cta">
        {t(`ads.${slot}.cta`)}
        {external ? <IconExternal width={13} height={13} /> : <IconChevronRight width={14} height={14} />}
      </span>
    </motion.button>
  );
}
