import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { IconBuilding, IconChevronLeft, IconGlobe, IconMapPin, IconShield, IconUsers, IconAward, IconZap } from '../components/Icons';

export default function About() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const values = [
    { key: 'transparency', icon: IconShield, color: 'rgb-1' },
    { key: 'innovation', icon: IconZap, color: 'rgb-2' },
    { key: 'access', icon: IconGlobe, color: 'rgb-3' },
    { key: 'security', icon: IconAward, color: 'rgb-4' }
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

      {/* ---------- premium hero ---------- */}
      <motion.section 
        className="card card-rgb" 
        style={{ 
          background: 'linear-gradient(135deg, #0a0f1e 0%, #111827 100%)',
          border: '1px solid rgba(0,229,255,0.2)',
          position: 'relative',
          overflow: 'hidden'
        }} 
        variants={riseIn} 
        initial="hidden" 
        animate="show"
      >
        <div style={{ 
          position: 'absolute', 
          top: -50, 
          right: -50, 
          width: 200, 
          height: 200, 
          background: 'radial-gradient(circle, rgba(0,229,255,0.15) 0%, transparent 70%)',
          borderRadius: '50%'
        }} />
        
        <div style={{ textAlign: 'center', padding: '32px 20px 24px', position: 'relative', zIndex: 1 }}>
          <div style={{
            width: 82,
            height: 82,
            borderRadius: 24,
            margin: '0 auto 20px',
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(145deg, #00e5ff, #7c4dff)',
            color: '#000',
            fontWeight: 900,
            fontSize: 26,
            fontFamily: 'var(--font-mono)',
            boxShadow: '0 10px 30px rgba(0,229,255,0.3)'
          }}>
            FBT
          </div>
          
          <h2 className="h2 gradient-text" style={{ fontSize: 24, marginBottom: 6 }}>
            {t('about.companyFull')}
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 15, maxWidth: 260, margin: '0 auto' }}>
            {t('about.tagline')}
          </p>

          {/* Stats */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            gap: 32, 
            marginTop: 28,
            flexWrap: 'wrap'
          }}>
            {stats.map((stat, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{stat.number}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
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

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/contact')}>
          {t('contact.title')}
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => navigate('/audit')}>
          {t('audit.title')}
        </button>
      </div>
    </PageTransition>
  );
}
