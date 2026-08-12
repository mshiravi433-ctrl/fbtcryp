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

      <p className="muted" style={{ marginBottom: 24, fontSize: 14.5 }}>{t('contact.intro')}</p>

      {/* ---------- Premium Social Grid ---------- */}
      <div style={{ marginBottom: 32 }}>
        <p className="section-label" style={{ marginBottom: 14, paddingLeft: 4 }}>{t('contact.socialTitle')}</p>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
          gap: 16 
        }}>
          {SOCIALS.map((soc, index) => (
            <motion.button
              key={soc.id}
              variants={riseIn}
              initial="hidden"
              animate="show"
              custom={index}
              whileHover={{ y: -4, scale: 1.01 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => openLink(soc.url)}
              style={{
                textAlign: 'left',
                padding: '22px 24px',
                borderRadius: 24,
                background: 'linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
                border: '1px solid rgba(148,163,184,0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 10px 30px rgba(0,0,0,0.1)'
              }}
            >
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                background: soc.grad,
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                flexShrink: 0,
                boxShadow: '0 8px 20px rgba(0,0,0,0.2)'
              }}>
                <SocialIcon id={soc.id} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t(`contact.social.${soc.id}`)}</div>
                <div className="mono" style={{ 
                  fontSize: 13, 
                  color: '#94a3b8',
                  wordBreak: 'break-all'
                }}>
                  {soc.handle}
                </div>
              </div>
              <IconExternal width={20} height={20} style={{ color: '#64748b' }} />
            </motion.button>
          ))}
        </div>
      </div>

      {/* ---------- Elegant Company Info ---------- */}
      <motion.section 
        className="card" 
        variants={riseIn} 
        initial="hidden" 
        animate="show"
        style={{ 
          padding: '28px 24px',
          background: 'linear-gradient(145deg, rgba(255,255,255,0.03), transparent)',
          border: '1px solid rgba(148,163,184,0.12)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ 
            width: 42, 
            height: 42, 
            borderRadius: 14, 
            background: 'linear-gradient(135deg, #00e5ff, #7c4dff)',
            display: 'grid',
            placeItems: 'center'
          }}>
            <IconBuilding width={22} height={22} color="#000" />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{t('contact.companyInfo')}</div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{t('about.companyFull')}</div>
          </div>
        </div>

        <div style={{ paddingLeft: 54 }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>{t('about.address')}</div>
            <div style={{ fontSize: 14.5, lineHeight: 1.7 }}>{t('about.addressValue')}</div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button 
              onClick={() => copy(t('about.addressValue'), 'addressCopied')}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(148,163,184,0.2)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {t('common.copy')}
            </button>
            <button 
              onClick={() => openLink(MAPS_URL)}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                background: 'rgba(0,229,255,0.1)',
                border: '1px solid rgba(0,229,255,0.3)',
                color: '#00e5ff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {t('contact.viewMap')}
            </button>
          </div>
        </div>
      </motion.section>

      {/* ---------- Support Card ---------- */}
      <motion.section 
        className="card" 
        variants={riseIn} 
        initial="hidden" 
        animate="show"
        style={{ marginTop: 20 }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ 
            width: 44, 
            height: 44, 
            borderRadius: 14, 
            background: 'rgba(124,77,255,0.15)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0
          }}>
            <IconMail width={22} height={22} color="#7c4dff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{t('contact.support')}</div>
            <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.7 }}>{t('contact.supportBody')}</p>
          </div>
        </div>
      </motion.section>

      {/* ---------- Scam Warning (Premium) ---------- */}
      <div style={{
        marginTop: 24,
        padding: '18px 20px',
        borderRadius: 18,
        background: 'rgba(255,59,107,0.08)',
        border: '1px solid rgba(255,59,107,0.2)'
      }}>
        <p style={{ 
          fontSize: 13.5, 
          color: '#ff3b6b', 
          lineHeight: 1.65,
          margin: 0
        }}>
          {t('contact.scamWarning')}
        </p>
      </div>

      {/* ---------- Back to About ---------- */}
      <div style={{ marginTop: 32 }}>
        <button 
          onClick={() => navigate('/about')}
          style={{
            width: '100%',
            padding: '16px 0',
            borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
            border: '1px solid rgba(148,163,184,0.25)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          {t('about.title')}
        </button>
      </div>
    </PageTransition>
  );
}
