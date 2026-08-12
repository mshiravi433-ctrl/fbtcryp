import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../lib/contact';
import {
  IconBuilding,
  IconInstagram,
  IconBriefcase,
  IconMail,
  IconChevronLeft,
  IconExternal,
  IconXLogo,
  IconLinkedin,
  IconMapPin,
  IconUser
} from '../components/Icons';

const SOCIALS = [
  /*
   * Telegram removed at the owner's request - email is the contact route.
   * X and LinkedIn are the public company profiles.
   *
   * The LinkedIn URL is stored WITHOUT its utm_source/utm_content/utm_medium
   * parameters. Those were on the shared link and would have told LinkedIn
   * every visit came from an Android share sheet, which is both wrong and a
   * needless detail about our users to hand over.
   */
  {
    id: 'x',
    url: 'https://x.com/CompanyFbt',
    grad: 'linear-gradient(135deg,#1a1a1a,#4a4a4a)',
    handle: '@CompanyFbt'
  },
  {
    id: 'linkedin',
    url: 'https://www.linkedin.com/in/mohammad-shiravi-a8891321b',
    grad: 'linear-gradient(135deg,#0a66c2,#004182)',
    handle: 'Mohammad Shiravi'
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
    url: SUPPORT_MAILTO,
    grad: 'linear-gradient(135deg,var(--rgb-5),var(--rgb-6))',
    handle: SUPPORT_EMAIL
  }
];
/*
 * REAL BUG: the office address rendered in PERSIAN on every language, because
 * it was a hardcoded `ADDRESS_FA` constant instead of a translation lookup.
 * An English or Arabic reader saw a line of Persian script in the middle of
 * an otherwise translated page.
 *
 * `about.addressValue` already existed and was already translated for en, fa
 * and ar — the string was sitting in the locale files, unused. The other nine
 * languages fall back to English, which is the correct behaviour here: an
 * address is a place, and the English transliteration is readable everywhere,
 * whereas a machine translation of a street name is actively harmful to
 * someone trying to find the building.
 *
 * The map query stays in Persian deliberately and is NOT translated: it is
 * sent to Google Maps, which resolves this location far more reliably from
 * the local-language name than from a transliteration.
 */
const MAPS_URL = `https://www.google.com/maps/search/${encodeURIComponent('خمینی شهر بلوار شهید بهشتی شهرداری منطقه 4')}`;

function SocialIcon({ id }) {
  const size = { width: 21, height: 21 };
  if (id === 'x') return <IconXLogo {...size} />;
  if (id === 'linkedin') return <IconLinkedin {...size} />;
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

      {/* ---------- social channels (modern premium) ---------- */}
      <motion.div 
        style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: 14 
        }} 
        variants={stagger} 
        initial="hidden" 
        animate="show"
      >
        {SOCIALS.map((soc) => (
          <motion.button
            key={soc.id}
            variants={riseIn}
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            onClick={() => openLink(soc.url)}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              width: '100%',
              padding: '18px 20px',
              borderRadius: 20,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(148,163,184,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              transition: 'all 0.2s cubic-bezier(0.23, 1, 0.32, 1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                background: soc.grad,
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                flexShrink: 0,
                boxShadow: '0 4px 14px rgba(0,0,0,0.15)'
              }}>
                <SocialIcon id={soc.id} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{t(`contact.social.${soc.id}`)}</div>
                <div className="mono" style={{ 
                  fontSize: 12.5, 
                  color: '#94a3b8', 
                  marginTop: 3,
                  wordBreak: 'break-all' 
                }}>
                  {soc.handle}
                </div>
              </div>
            </div>
            <IconExternal width={18} height={18} style={{ color: '#64748b', flexShrink: 0 }} />
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
            <div style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.75 }}>{t('about.addressValue')}</div>
            <div className="row" style={{ gap: 8, marginTop: 9 }}>
              <button className="tag" onClick={() => copy(t('about.addressValue'), 'addressCopied')}>
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

      <div style={{ marginTop: 28 }}>
        <button 
          onClick={() => navigate('/about')}
          style={{
            width: '100%',
            padding: '15px 24px',
            borderRadius: 18,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(148,163,184,0.2)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 15,
            cursor: 'pointer'
          }}
        >
          {t('about.title')}
        </button>
      </div>
    </PageTransition>
  );
}
