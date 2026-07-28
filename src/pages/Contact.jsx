import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import {
  IconBuilding,
  IconInstagram,
  IconBriefcase,
  IconMail,
  IconChevronLeft,
  IconExternal,
  IconTelegram,
  IconMapPin,
  IconUser
} from '../components/Icons';

const SOCIALS = [
  {
    id: 'telegram',
    url: 'https://t.me/Shiravi4333',
    grad: 'linear-gradient(135deg,#2AABEE,#229ED9)',
    handle: '@Shiravi4333'
  },
  {
    id: 'instagram',
    url: 'https://www.instagram.com/fbt_company_',
    grad: 'linear-gradient(135deg,#f9ce34,#ee2a7b 45%,#6228d7)',
    handle: '@fbt_company_'
  },
  {
    id: 'crunchbase',
    url: 'https://www.crunchbase.com/organization/fbt-company',
    grad: 'linear-gradient(135deg,#146aff,#0b47b3)',
    handle: 'FBT Company'
  },
  {
    id: 'email',
    url: 'mailto:Mshiravi433@gmail.com',
    grad: 'linear-gradient(135deg,var(--rgb-5),var(--rgb-6))',
    handle: 'Mshiravi433@gmail.com'
  }
];
const ADDRESS_FA = 'اصفهان، خمینی‌شهر، بلوار شهید بهشتی، جنب شهرداری منطقه ۴';
const MAPS_URL = `https://www.google.com/maps/search/${encodeURIComponent('خمینی شهر بلوار شهید بهشتی شهرداری منطقه 4')}`;

function SocialIcon({ id }) {
  const size = { width: 21, height: 21 };
  if (id === 'telegram') return <IconTelegram {...size} />;
  if (id === 'instagram') return <IconInstagram {...size} />;
  if (id === 'crunchbase') return <IconBriefcase {...size} />;
  return <IconMail {...size} />;
}

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

      {/* ---------- social channels ---------- */}
      <motion.div className="stack" style={{ gap: 9 }} variants={stagger} initial="hidden" animate="show">
        {SOCIALS.map((soc) => (
          <motion.button
            key={soc.id}
            className="card lift"
            variants={riseIn}
            whileTap={{ scale: 0.98 }}
            onClick={() => openLink(soc.url)}
            style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
          >
            <div className="row-between">
              <div className="row" style={{ gap: 12, minWidth: 0 }}>
                <motion.span
                  whileHover={{ rotate: 8, scale: 1.08 }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: 'grid',
                    placeItems: 'center',
                    background: soc.grad,
                    color: '#fff',
                    flexShrink: 0
                  }}
                >
                  <SocialIcon id={soc.id} />
                </motion.span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t(`contact.social.${soc.id}`)}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', wordBreak: 'break-all' }}>
                    {soc.handle}
                  </div>
                </div>
              </div>
              <IconExternal width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </div>
          </motion.button>
        ))}
      </motion.div>

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
