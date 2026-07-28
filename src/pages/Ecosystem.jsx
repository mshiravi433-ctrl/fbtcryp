import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconExternal } from '../components/Icons';

/** Protocols this app builds on, plus the wider BSC ecosystem. */
const GROUPS = [
  {
    id: 'infra',
    items: [
      { id: 'bnb', url: 'https://www.bnbchain.org', hue: '#f0b90b' },
      { id: 'pancake', url: 'https://pancakeswap.finance', hue: '#00e5ff' },
      { id: 'kyber', url: 'https://kyberswap.com', hue: '#00ff9d' }
    ]
  },
  {
    id: 'tools',
    items: [
      { id: 'bscscan', url: 'https://bscscan.com', hue: '#7c4dff' },
      { id: 'coingecko', url: 'https://coingecko.com', hue: '#00e676' },
      { id: 'geckoterminal', url: 'https://geckoterminal.com', hue: '#18ffff' }
    ]
  },
  {
    id: 'wallets',
    items: [
      { id: 'metamask', url: 'https://metamask.io', hue: '#ff6d00' },
      { id: 'trust', url: 'https://trustwallet.com', hue: '#00e5ff' },
      { id: 'walletconnect', url: 'https://reown.com', hue: '#3b99fc' }
    ]
  }
];

export default function Ecosystem() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('eco.title')}</h1>
      </motion.div>

      <p className="muted">{t('eco.intro')}</p>

      {GROUPS.map((g) => (
        <section key={g.id}>
          <p className="section-label">{t(`eco.group.${g.id}`)}</p>
          <motion.div className="grid-2" style={{ marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {g.items.map((it) => (
              <motion.button
                key={it.id}
                className="card lift"
                variants={riseIn}
                whileTap={{ scale: 0.96 }}
                onClick={() => open(it.url)}
                style={{ textAlign: 'start', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              >
                <motion.div
                  style={{
                    position: 'absolute', top: -30, insetInlineEnd: -30, width: 80, height: 80,
                    borderRadius: '50%', background: it.hue, filter: 'blur(30px)', opacity: 0.28
                  }}
                  animate={{ scale: [1, 1.25, 1], opacity: [0.22, 0.36, 0.22] }}
                  transition={{ duration: 5, repeat: Infinity }}
                />
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: 11, marginBottom: 9,
                      display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)',
                      fontSize: 11, fontWeight: 700, color: '#000', background: it.hue
                    }}
                  >
                    {t(`eco.item.${it.id}.short`)}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t(`eco.item.${it.id}.name`)}</div>
                  <div className="faint" style={{ marginTop: 2, lineHeight: 1.55 }}>{t(`eco.item.${it.id}.desc`)}</div>
                  <IconExternal width={13} height={13} style={{ color: 'var(--text-3)', marginTop: 7 }} />
                </div>
              </motion.button>
            ))}
          </motion.div>
        </section>
      ))}

      <p className="notice">{t('eco.notice')}</p>
    </PageTransition>
  );
}
