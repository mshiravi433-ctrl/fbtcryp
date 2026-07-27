import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import {
  IconBuilding,
  IconChevronLeft,
  IconExternal,
  IconTelegram,
  IconMapPin,
  IconUser
} from '../components/Icons';

const TELEGRAM = 'Shiravi4333';
const TELEGRAM_URL = `https://t.me/${TELEGRAM}`;
const ADDRESS_FA = 'اصفهان، خمینی‌شهر، بلوار شهید بهشتی، جنب شهرداری منطقه ۴';
const MAPS_URL = `https://www.google.com/maps/search/${encodeURIComponent('خمینی شهر بلوار شهید بهشتی شهرداری منطقه 4')}`;

export default function Contact() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text);
    haptic?.('success');
    useAppStore.getState().notify(key, 'success');
  };

  const openLink = (url) => {
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
        <h1 className="h1" style={{ fontSize: 19 }}>{t('contact.title')}</h1>
      </motion.div>

      <p className="muted">{t('contact.intro')}</p>

      {/* ---------- instagram ---------- */}
      <motion.button
        className="card card-rgb card-glow-magenta"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => openLink(TELEGRAM_URL)}
        style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
      >
        <div className="sheen" />
        <div className="row-between">
          <div className="row" style={{ gap: 12 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 15,
                display: 'grid',
                placeItems: 'center',
                background: 'linear-gradient(135deg,#2AABEE,#229ED9)',
                color: '#fff',
                flexShrink: 0
              }}
            >
              <IconTelegram width={23} height={23} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{t('contact.telegram')}</div>
              <div className="mono" style={{ fontSize: 12.5, color: 'var(--rgb-1)' }}>@{TELEGRAM}</div>
              <div className="faint" style={{ marginTop: 2 }}>{t('contact.primaryChannel')}</div>
            </div>
          </div>
          <IconExternal width={18} height={18} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        </div>
      </motion.button>

      <motion.button
        className="btn btn-primary"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.97 }}
        onClick={() => openLink(TELEGRAM_URL)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <IconTelegram width={18} height={18} />
          {t('contact.openTelegram')}
        </span>
      </motion.button>

      {/* ---------- company card ---------- */}
      <motion.section className="card" variants={stagger} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('contact.companyInfo')}</p>

        <motion.div className="info-row" variants={riseIn}>
          <span className="info-row-icon"><IconBuilding width={18} height={18} /></span>
          <div style={{ flex: 1 }}>
            <div className="faint">{t('about.company')}</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{t('about.companyFull')}</div>
          </div>
        </motion.div>

        <motion.div className="info-row" variants={riseIn}>
          <span className="info-row-icon"><IconMapPin width={18} height={18} /></span>
          <div style={{ flex: 1 }}>
            <div className="faint">{t('about.address')}</div>
            <div style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.75 }}>{ADDRESS_FA}</div>
            <div className="row" style={{ gap: 8, marginTop: 9 }}>
              <button className="tag" onClick={() => copy(ADDRESS_FA, 'addressCopied')}>
                {t('common.copy')}
              </button>
              <button className="tag" onClick={() => openLink(MAPS_URL)}>
                {t('contact.viewMap')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* ---------- support expectations ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('contact.support')}</p>
        <p className="muted">{t('contact.supportBody')}</p>
      </motion.section>

      {/* ---------- anti-scam warning ---------- */}
      <p className="notice notice-danger">{t('contact.scamWarning')}</p>

      <button className="btn btn-ghost" onClick={() => navigate('/about')}>
        {t('about.title')}
      </button>
    </PageTransition>
  );
}
