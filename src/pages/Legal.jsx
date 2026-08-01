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

/*
 * A standalone disclaimer, separate from Terms.
 *
 * Terms are a contract nobody reads. The disclaimer is the short, blunt list
 * of what this software is NOT - not a bank, not custodial, not advice, not
 * reversible - plus the copyright position now that the repository is public.
 * Keeping it as its own page means it can be linked directly from a store
 * listing, an exchange listing application, or a support reply.
 */
const DISCLAIMER_SECTIONS = [
  'nature', 'noCustody', 'noAdvice', 'irreversible', 'thirdParty',
  'availability', 'noWarranty', 'liability', 'ip', 'jurisdiction'
];

export default function Legal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { doc } = useParams();

  const isPrivacy = doc === 'privacy';
  const isDisclaimer = doc === 'disclaimer';
  const ns = isPrivacy ? 'privacy' : isDisclaimer ? 'disclaimer' : 'terms';
  const sections = isPrivacy ? PRIVACY_SECTIONS : isDisclaimer ? DISCLAIMER_SECTIONS : TERMS_SECTIONS;

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

      <div className="row" style={{ gap: 10 }}>
        {/* Cycle through all three rather than toggling between two. */}
        <button className="btn btn-ghost" onClick={() => navigate(isPrivacy ? '/legal/terms' : isDisclaimer ? '/legal/privacy' : '/legal/disclaimer')}>
          {isPrivacy ? t('terms.title') : isDisclaimer ? t('privacy.title') : t('disclaimer.title')}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate('/contact')}>
          {t('contact.title')}
        </button>
      </div>
    </PageTransition>
  );
}
