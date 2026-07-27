import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconMail, IconTelegram, IconBuilding, IconTrend, IconPools, IconKey } from '../components/Icons';

const TELEGRAM_URL = 'https://t.me/Shiravi4333';
const EMAIL = 'Mshiravi433@gmail.com';

const OFFERS = [
  { id: 'listing', Icon: IconTrend },
  { id: 'liquidity', Icon: IconPools },
  { id: 'whitelabel', Icon: IconBuilding },
  { id: 'integration', Icon: IconKey }
];

export default function Business() {
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
        <h1 className="h1" style={{ fontSize: 19 }}>{t('biz.title')}</h1>
      </motion.div>

      <motion.section className="card card-rgb edge-ember" variants={riseIn} initial="hidden" animate="show">
        <div className="aurora" />
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }} className="gradient-text">FBT iran</div>
        <p className="muted" style={{ fontSize: 12.4, margin: 0 }}>{t('biz.intro')}</p>
      </motion.section>

      <section>
        <p className="section-label">{t('biz.services')}</p>
        <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {OFFERS.map(({ id, Icon }) => (
            <motion.div key={id} className="card lift" variants={riseIn}>
              <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                <span className="wallet-badge" style={{ width: 36, height: 36 }}>
                  <Icon width={18} height={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.3 }}>{t(`biz.offer.${id}.title`)}</div>
                  <p className="muted" style={{ fontSize: 12, margin: '3px 0 0' }}>{t(`biz.offer.${id}.body`)}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section>
        <p className="section-label">{t('biz.contact')}</p>
        <motion.div className="grid-2" style={{ marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          <motion.button className="btn btn-primary" variants={riseIn} whileTap={{ scale: 0.96 }} onClick={() => open(TELEGRAM_URL)}>
            <span style={{ display: 'inline-flex', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
              <IconTelegram width={16} height={16} /> {t('help.telegram')}
            </span>
          </motion.button>
          <motion.button className="btn btn-ghost" variants={riseIn} whileTap={{ scale: 0.96 }} onClick={() => open(`mailto:${EMAIL}`)}>
            <span style={{ display: 'inline-flex', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
              <IconMail width={16} height={16} /> {t('help.email')}
            </span>
          </motion.button>
        </motion.div>
      </section>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 9 }}>{t('biz.company')}</p>
        <div className="info-row">
          <span className="info-row-icon"><IconBuilding width={17} height={17} /></span>
          <div>
            <div className="faint">{t('about.company')}</div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{t('about.companyFull')}</div>
          </div>
        </div>
        <div className="info-row">
          <span className="info-row-icon"><IconMail width={17} height={17} /></span>
          <div>
            <div className="faint">{t('help.email')}</div>
            <div className="mono" style={{ fontSize: 11.5, marginTop: 2, wordBreak: 'break-all' }}>{EMAIL}</div>
          </div>
        </div>
      </motion.section>

      <p className="notice">{t('biz.notice')}</p>
    </PageTransition>
  );
}
