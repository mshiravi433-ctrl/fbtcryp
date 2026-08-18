import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import {
  IconChevronLeft, IconChevronRight, IconExternal, IconSwap,
  IconPools, IconWallet, IconActivity, IconShield, IconTrend,
  IconSparkle, IconFingerprint, IconGlobe, IconUser, IconClock
} from '../components/Icons';
import '../styles/docs-modern.css';

/**
 * In-app documentation for beginners.
 *
 * Each section explains one screen: what it does, the steps to use it, and the
 * mistake people actually make there. The "pitfall" line matters more than the
 * steps — most losses come from not knowing what can go wrong, not from being
 * unable to find a button.
 *
 * Every section carries a `level` (beginner / intermediate / pro) so someone
 * starting from zero knows the order to follow:
 *   security → start → swap → farm/staking → signals/trade →
 *   then the professional instruments (dydx, intentos, derivatives).
 */

const youtube = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const SECTIONS = [
  { id: 'security', Icon: IconShield, steps: 5, level: 'beginner', hue: 'var(--rgb-3)', en: youtube('crypto wallet security seed phrase') },
  { id: 'start', Icon: IconWallet, steps: 4, level: 'beginner', hue: 'var(--rgb-4)', en: youtube('how to use metamask beginner') },
  { id: 'why', Icon: IconTrend, steps: 5, level: 'beginner', hue: 'var(--rgb-1)' },
  { id: 'strategy', Icon: IconPools, steps: 5, level: 'beginner', hue: 'var(--rgb-2)' },
  {
    id: 'swap',
    Icon: IconSwap,
    steps: 5,
    level: 'beginner',
    hue: 'var(--rgb-1)',
    en: youtube('how to swap tokens dex beginner')
  },
  {
    id: 'portfolio',
    Icon: IconGlobe,
    steps: 4,
    level: 'beginner',
    hue: 'var(--rgb-4)'
  },
  {
    id: 'farm',
    Icon: IconPools,
    steps: 4,
    level: 'intermediate',
    hue: 'var(--rgb-5)',
    en: youtube('liquidity pool impermanent loss explained')
  },
  {
    id: 'signals',
    Icon: IconActivity,
    steps: 3,
    level: 'intermediate',
    hue: 'var(--rgb-3)',
    en: youtube('rsi macd explained beginners')
  },
  { id: 'trade', Icon: IconTrend, steps: 3, level: 'intermediate', hue: 'var(--rgb-2)' },
  {
    id: 'smartwallet',
    Icon: IconFingerprint,
    steps: 4,
    level: 'intermediate',
    hue: 'var(--rgb-4)'
  },
  {
    id: 'p2p',
    Icon: IconUser,
    steps: 4,
    level: 'intermediate',
    hue: 'var(--rgb-5)'
  },
  {
    id: 'orders',
    Icon: IconClock,
    steps: 4,
    level: 'intermediate',
    hue: 'var(--rgb-2)'
  },
  {
    id: 'intentos',
    Icon: IconSparkle,
    steps: 5,
    level: 'pro',
    hue: 'var(--rgb-1)',
    en: youtube('intent based trading explained')
  },
  {
    id: 'dydx',
    Icon: IconTrend,
    steps: 5,
    level: 'pro',
    hue: 'var(--rgb-1)',
    en: youtube('dydx how to deposit fund account tutorial dydx.trade')
  }
];

export default function Docs({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const [openId, setOpenId] = useState('start');

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition embedded={embedded}>
      {!embedded && (
        <motion.div className="row" style={{ gap: 12 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 20 }}>{t('docs.title')}</h1>
        </motion.div>
      )}

      {/* Hero — spacious, friendly */}
      <motion.section className="docs-hero" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: embedded ? 0 : 12 }}>
        <div className="docs-hero-title">{t('docs.title')}</div>
        <p className="docs-hero-sub">{t('docs.intro')}</p>
      </motion.section>

      <motion.div className="docs-grid" variants={stagger} initial="hidden" animate="show" style={{ marginTop: 16 }}>
        {SECTIONS.map(({ id, Icon, steps, hue, en, level }) => {
          const isOpen = openId === id;
          return (
            <motion.div
              key={id}
              className="docs-card"
              data-open={isOpen ? 'true' : 'false'}
              variants={riseIn}
              layout
              style={{ '--card-hue': hue }}
            >
              <button
                className="docs-card-header"
                onClick={() => {
                  haptic?.('select');
                  setOpenId(isOpen ? null : id);
                }}
                aria-expanded={isOpen}
              >
                <span className="docs-icon" aria-hidden="true">
                  <Icon width={20} height={20} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="row" style={{ gap: 7, alignItems: 'center' }}>
                    <span className="docs-card-title">{t(`docs.${id}.title`)}</span>
                    {level && <span className={`docs-level-badge docs-level-${level}`}>{t(`docs.level.${level}`)}</span>}
                  </span>
                  <span className="docs-card-sub" style={{ display: 'block' }}>{t(`docs.${id}.sub`)}</span>
                </span>
                <motion.span
                  className="docs-chevron"
                  animate={{ rotate: isOpen ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                  aria-hidden="true"
                >
                  <IconChevronRight width={16} height={16} />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ paddingTop: 16 }}>
                      {Array.from({ length: steps }).map((_, i) => (
                        <motion.div
                          key={i}
                          className="docs-step"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <span className="docs-step-num">{i + 1}</span>
                          <span className="docs-step-text">{t(`docs.${id}.step${i + 1}`)}</span>
                        </motion.div>
                      ))}

                      <div className="docs-pitfall">
                        <strong>{t('docs.pitfall')}:</strong> {t(`docs.${id}.pitfall`)}
                      </div>

                      {en && (
                        <div className="docs-videos">
                          <button className="doc-video" onClick={() => open(en)} style={{ '--card-hue': hue }}>
                            <IconExternal width={13} height={13} />
                            {t('docs.watchEn')}
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>

      <p className="prose-sm" style={{ marginTop: 16, color: 'var(--text-2)', lineHeight: 1.85 }}>{t('docs.videoNote')}</p>

      <div className="row" style={{ gap: 12, marginTop: 18 }}>
        <button className="btn btn-ghost" style={{ flex: 1, minHeight: 44 }} onClick={() => navigate('/help')}>{t('help.title')}</button>
        <button className="btn btn-ghost" style={{ flex: 1, minHeight: 44 }} onClick={() => navigate('/legal/disclaimer')}>{t('disclaimer.title')}</button>
      </div>
    </PageTransition>
  );
}
