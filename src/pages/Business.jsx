import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { IconChevronLeft, IconBuilding, IconTrend, IconPools, IconKey, IconGlobe, IconExternal } from '../components/Icons';
import { openUrl } from '../lib/browser';
import { publicAppUrl } from '../lib/nativeShell';

/*
 * Resolved the same way share links are, rather than hard-coded. Inside the
 * APK `window.location` is https://localhost, so a literal would be wrong in
 * exactly the build where a partner is most likely to be shown the page.
 * `publicAppUrl('')` returns the configured public origin.
 */
const SITE_URL = publicAppUrl('');

const OFFERS = [
  { id: 'listing', Icon: IconTrend },
  { id: 'liquidity', Icon: IconPools },
  { id: 'whitelabel', Icon: IconBuilding },
  { id: 'integration', Icon: IconKey }
];

export default function Business() {
  const { t } = useTranslation();
  const navigate = useNavigate();

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
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }} className="gradient-text">{t('about.companyFull')}</div>
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
        <motion.button
          className="btn btn-primary"
          variants={riseIn}
          initial="hidden"
          animate="show"
          style={{ marginTop: 8 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/contact')}
        >
          {t('contact.title')}
        </motion.button>
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

        {/*
          ─── THE OFFICIAL DOMAIN, ON THE PAGE PARTNERS READ ─────────────────
          Requested: «اگر خوبه ادرس سایت را در بیزینس اضافه کن».

          It is more than a nicety here. This is the page a token issuer or an
          exchange opens before deciding whether we are real, and a business
          page with no address is the shape of a page nobody maintains.

          It also serves an anti-phishing purpose that matters for a money
          app: a partner who knows the one canonical domain can recognise a
          clone. Printed as text rather than only as a link, so it can be read
          and compared rather than merely clicked.
        */}
        <button
          className="info-row"
          onClick={() => openUrl(SITE_URL)}
          style={{
            width: '100%', background: 'none', border: 0, padding: 0,
            marginTop: 12, cursor: 'pointer', color: 'inherit', textAlign: 'start'
          }}
        >
          <span className="info-row-icon"><IconGlobe width={17} height={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="faint">{t('biz.website')}</div>
            <div
              className="mono"
              style={{ fontWeight: 600, fontSize: 12.5, marginTop: 2, direction: 'ltr' }}
            >
              {SITE_URL.replace(/^https:\/\//, '')}
            </div>
          </div>
          <IconExternal width={15} height={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        </button>
      </motion.section>

      <p className="notice">{t('biz.notice')}</p>
    </PageTransition>
  );
}
