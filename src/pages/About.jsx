import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { IconBuilding, IconChevronLeft, IconGlobe, IconMapPin, IconShield, IconUser } from '../components/Icons';

export default function About() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const values = ['transparency', 'innovation', 'access', 'security'];

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('about.title')}</h1>
      </motion.div>

      {/* ---------- hero ---------- */}
      <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            style={{
              width: 66,
              height: 66,
              borderRadius: 20,
              margin: '0 auto 12px',
              display: 'grid',
              placeItems: 'center',
              background: 'conic-gradient(from 0deg,#00e5ff,#7c4dff,#ff2d95,#00ff9d,#00e5ff)',
              color: '#000',
              fontWeight: 800,
              fontSize: 19,
              fontFamily: 'var(--font-mono)'
            }}
          >
            FBT
          </motion.div>
          <h2 className="h2 gradient-text" style={{ fontSize: 21 }}>{t('about.companyFull')}</h2>
          <p className="faint" style={{ marginTop: 4 }}>{t('about.tagline')}</p>
        </div>
      </motion.section>

      {/* ---------- story ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('about.who')}</p>
        <p className="muted">{t('about.body1')}</p>
        <p className="muted" style={{ marginTop: 10 }}>{t('about.body2')}</p>
        <p className="muted" style={{ marginTop: 10 }}>{t('about.body3')}</p>
      </motion.section>

      {/* ---------- values ---------- */}
      <motion.section variants={stagger} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('about.values')}</p>
        <div className="stack" style={{ gap: 8 }}>
          {values.map((v, i) => (
            <motion.div key={v} className="card card-tight" variants={riseIn}>
              <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 10,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 700,
                    background: `linear-gradient(135deg, var(--rgb-${(i % 3) + 1}), transparent)`,
                    color: '#fff'
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t(`about.value.${v}.title`)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{t(`about.value.${v}.body`)}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ---------- leadership + registry ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('about.details')}</p>

        <div className="info-row">
          <span className="info-row-icon"><IconBuilding width={18} height={18} /></span>
          <div>
            <div className="faint">{t('about.company')}</div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 2 }}>FBT iran</div>
          </div>
        </div>

        <div className="info-row">
          <span className="info-row-icon"><IconMapPin width={18} height={18} /></span>
          <div>
            <div className="faint">{t('about.address')}</div>
            <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.7 }}>{t('about.addressValue')}</div>
          </div>
        </div>

        <div className="info-row">
          <span className="info-row-icon"><IconGlobe width={18} height={18} /></span>
          <div>
            <div className="faint">{t('about.network')}</div>
            <div style={{ fontSize: 12.5, marginTop: 2 }}>BNB Smart Chain · PancakeSwap V2</div>
          </div>
        </div>
      </motion.section>

      {/* ---------- honest disclosure ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}><IconShield width={20} height={20} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('about.custody')}</div>
            <p className="muted" style={{ fontSize: 12 }}>{t('about.custodyBody')}</p>
          </div>
        </div>
      </motion.section>

      <p className="notice">{t('about.riskDisclosure')}</p>

      <button className="btn btn-ghost" onClick={() => navigate('/contact')}>
        {t('contact.title')}
      </button>
    </PageTransition>
  );
}
