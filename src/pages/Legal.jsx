import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import { IconChevronLeft } from '../components/Icons';

/**
 * Terms of Service and Privacy Policy.
 *
 * Written to describe what this app *actually* does rather than copying a
 * generic template. The privacy section in particular is short because the
 * app genuinely collects very little — overstating data collection would be
 * as misleading as understating it.
 *
 * This is not legal advice and is not a substitute for a lawyer reviewing it
 * against Iranian law and the rules of any market you distribute in.
 */

const TERMS_SECTIONS = [
  'nature',
  'noCustody',
  'fees',
  'risk',
  'noAdvice',
  'eligibility',
  'prohibited',
  'thirdParty',
  'availability',
  'liability',
  'changes'
];

const PRIVACY_SECTIONS = ['collect', 'notCollect', 'onchain', 'thirdPartyData', 'storage', 'analytics', 'rights', 'contact'];

export default function Legal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { doc } = useParams();

  const isPrivacy = doc === 'privacy';
  const ns = isPrivacy ? 'privacy' : 'terms';
  const sections = isPrivacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t(`${ns}.title`)}</h1>
      </motion.div>

      <motion.p className="faint" variants={riseIn} initial="hidden" animate="show">
        {t(`${ns}.updated`)}
      </motion.p>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="muted" style={{ margin: 0 }}>{t(`${ns}.intro`)}</p>
      </motion.section>

      {sections.map((key, i) => (
        <motion.section
          key={key}
          className="card"
          variants={riseIn}
          initial="hidden"
          animate="show"
          transition={{ delay: Math.min(i * 0.03, 0.25) }}
        >
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span
              className="mono"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--rgb-1)',
                minWidth: 20,
                paddingTop: 2
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 5 }}>
                {t(`${ns}.${key}.title`)}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                {t(`${ns}.${key}.body`)}
              </p>
            </div>
          </div>
        </motion.section>
      ))}

      <p className="notice notice-danger">{t(`${ns}.disclaimer`)}</p>

      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-ghost" onClick={() => navigate(isPrivacy ? '/legal/terms' : '/legal/privacy')}>
          {isPrivacy ? t('terms.title') : t('privacy.title')}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate('/contact')}>
          {t('contact.title')}
        </button>
      </div>
    </PageTransition>
  );
}
