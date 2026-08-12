import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { IconBuilding, IconChevronLeft, IconGlobe, IconMapPin, IconShield } from '../components/Icons';

export default function About() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const values = [
    { key: 'transparency', icon: IconShield, color: 'rgb-1' },
    { key: 'innovation', icon: IconShield, color: 'rgb-2' },
    { key: 'access', icon: IconGlobe, color: 'rgb-3' },
    { key: 'security', icon: IconShield, color: 'rgb-4' }
  ];

  const stats = [
    { number: '10', label: t('about.stats.chains') },
    { number: '50K+', label: t('about.stats.users') },
    { number: '12', label: t('about.stats.languages') }
  ];

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('about.title')}</h1>
      </motion.div>

      {/* ---------- Ultra Premium Hero ---------- */}
      <motion.section 
        className="card" 
        style={{ 
          background: 'linear-gradient(145deg, #0a0f1e 0%, #111827 100%)',
          border: '1px solid rgba(0,229,255,0.25)',
          position: 'relative',
          overflow: 'hidden',
          padding: '42px 24px 36px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
        }} 
        variants={riseIn} 
        initial="hidden" 
        animate="show"
      >
        {/* Decorative glow */}
        <div style={{ 
          position: 'absolute', 
          top: -80, 
          right: -60, 
          width: 280, 
          height: 280, 
          background: 'radial-gradient(circle, rgba(0,229,255,0.12) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none'
        }} />
        <div style={{ 
          position: 'absolute', 
          bottom: -60, 
          left: -40, 
          width: 200, 
          height: 200, 
          background: 'radial-gradient(circle, rgba(124,77,255,0.1) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none'
        }} />

        <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
          {/* Logo with premium glow */}
          <div style={{
            width: 92,
            height: 92,
            borderRadius: 26,
            margin: '0 auto 24px',
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(145deg, #00e5ff, #7c4dff, #ff2d95)',
            color: '#000',
            fontWeight: 900,
            fontSize: 30,
            fontFamily: 'var(--font-mono)',
            boxShadow: '0 16px 40px rgba(0,229,255,0.35), inset 0 2px 8px rgba(255,255,255,0.4)',
            border: '1px solid rgba(255,255,255,0.3)'
          }}>
            FBT
          </div>
          
          <h2 className="h2 gradient-text" style={{ 
            fontSize: 26, 
            marginBottom: 8,
            letterSpacing: '-0.5px'
          }}>
            {t('about.companyFull')}
          </h2>
          
          <p style={{ 
            color: '#94a3b8', 
            fontSize: 15.5, 
            maxWidth: 280, 
            margin: '0 auto 28px',
            lineHeight: 1.6
          }}>
            {t('about.tagline')}
          </p>

          {/* Beautiful Stats Row */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            gap: 36, 
            flexWrap: 'wrap'
          }}>
            {stats.map((stat, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: 26, 
                  fontWeight: 900, 
                  color: '#fff',
                  lineHeight: 1
                }}>
                  {stat.number}
                </div>
                <div style={{ 
                  fontSize: 12.5, 
                  color: '#64748b', 
                  marginTop: 4,
                  fontWeight: 500
                }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ---------- story ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ padding: '24px 20px' }}>
        <p className="section-label" style={{ marginBottom: 14, fontSize: 13 }}>{t('about.who')}</p>
        <div style={{ lineHeight: 1.75, color: '#cbd5e1' }}>
          <p style={{ marginBottom: 14 }}>{t('about.body1')}</p>
          <p style={{ marginBottom: 14 }}>{t('about.body2')}</p>
          <p>{t('about.body3')}</p>
        </div>
      </motion.section>

      {/* ---------- modern values ---------- */}
      <motion.section variants={stagger} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 14, paddingLeft: 4 }}>{t('about.values')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 12 }}>
          {values.map((v, i) => {
            const Icon = v.icon;
            return (
              <motion.div 
                key={v.key} 
                className="card" 
                variants={riseIn}
                style={{ 
                  padding: '18px 16px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(148,163,184,0.1)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    background: `var(--${v.color})`,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#000'
                  }}>
                    <Icon width={18} height={18} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{t(`about.value.${v.key}.title`)}</div>
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
                  {t(`about.value.${v.key}.body`)}
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      {/* ---------- company info (modern) ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ padding: '22px 20px' }}>
        <p className="section-label" style={{ marginBottom: 16 }}>{t('about.details')}</p>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="info-row" style={{ padding: '4px 0' }}>
            <span className="info-row-icon"><IconBuilding width={19} height={19} /></span>
            <div>
              <div style={{ fontSize: 12.5, color: '#64748b' }}>{t('about.company')}</div>
              <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{t('about.companyFull')}</div>
            </div>
          </div>

          <div className="info-row" style={{ padding: '4px 0' }}>
            <span className="info-row-icon"><IconMapPin width={19} height={19} /></span>
            <div>
              <div style={{ fontSize: 12.5, color: '#64748b' }}>{t('about.address')}</div>
              <div style={{ fontSize: 14, marginTop: 3, lineHeight: 1.65 }}>{t('about.addressValue')}</div>
            </div>
          </div>

          <div className="info-row" style={{ padding: '4px 0' }}>
            <span className="info-row-icon"><IconGlobe width={19} height={19} /></span>
            <div>
              <div style={{ fontSize: 12.5, color: '#64748b' }}>{t('about.network')}</div>
              <div style={{ fontSize: 14, marginTop: 3, color: '#e0e7ff' }}>
                10 Networks • BNB • Ethereum • Solana
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ---------- trust banner ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ 
        background: 'linear-gradient(90deg, rgba(16,185,129,0.1), transparent)',
        border: '1px solid rgba(16,185,129,0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ 
            width: 44, 
            height: 44, 
            borderRadius: 999, 
            background: 'rgba(16,185,129,0.15)',
            display: 'grid',
            placeItems: 'center'
          }}>
            <IconShield width={22} height={22} color="#10b981" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('about.custody')}</div>
            <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>{t('about.custodyBody')}</p>
          </div>
        </div>
      </motion.section>

      <p className="notice" style={{ marginTop: 8 }}>{t('about.riskDisclosure')}</p>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button 
          onClick={() => navigate('/contact')}
          style={{
            flex: 1,
            padding: '14px 20px',
            borderRadius: 16,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(148,163,184,0.2)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          {t('contact.title')}
        </button>
        <button 
          onClick={() => navigate('/audit')}
          style={{
            flex: 1,
            padding: '14px 20px',
            borderRadius: 16,
            background: 'linear-gradient(135deg, #00e5ff, #7c4dff)',
            color: '#000',
            fontWeight: 700,
            fontSize: 14,
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,229,255,0.3)',
            transition: 'all 0.2s ease'
          }}
        >
          {t('audit.title')}
        </button>
      </div>
    </PageTransition>
  );
}
// Force Vercel rebuild - Wed Aug 12 14:21:25 UTC 2026
