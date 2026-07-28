import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import WalletConnectSheet from '../components/WalletConnectSheet';
import Sheet from '../components/Sheet';
import LanguagePicker from '../components/LanguagePicker';
import {
  IconChevronRight,
  IconShield,
  IconSwap,
  IconTrend,
  IconWallet,
  IconCheck,
  IconGlobe
} from '../components/Icons';

/**
 * Five-step welcome: three feature slides, then wallet connect, then the
 * terms agreement.
 *
 * The terms step is a hard gate — you cannot enter the app without ticking it.
 * Wallet connect is skippable, because forcing it before someone has seen the
 * product is a good way to lose them, and every screen prompts for it anyway.
 */

const SLIDES = [
  { key: 'trade', Icon: IconTrend, hues: ['#00e5ff', '#7c4dff'] },
  { key: 'swap', Icon: IconSwap, hues: ['#7c4dff', '#ff2d95'] },
  { key: 'custody', Icon: IconShield, hues: ['#00ff9d', '#00e5ff'] }
];

// Language first: everything that follows is text, and asking someone to read
// a welcome screen in a language they don't speak is a strange first impression.
const TOTAL = SLIDES.length + 3; // language + slides + wallet + terms

function Art({ Icon, hues, index }) {
  return (
    <div className="onb-art">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={`${index}-${i}`}
          className="onb-ring"
          style={{ width: 110 + i * 62, height: 110 + i * 62 }}
          initial={{ opacity: 0, scale: 0.75 }}
          animate={{ opacity: 0.5 - i * 0.1, scale: 1, rotate: i % 2 ? 8 : -8 }}
          transition={{ delay: i * 0.07, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}

      <motion.div
        key={`glow-${index}`}
        style={{
          position: 'absolute',
          width: 230,
          height: 230,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${hues[0]}55, transparent 68%)`,
          filter: 'blur(38px)'
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: [1, 1.12, 1] }}
        transition={{ scale: { duration: 4.5, repeat: Infinity }, opacity: { duration: 0.6 } }}
      />

      <motion.div
        key={`icon-${index}`}
        initial={{ scale: 0.4, opacity: 0, y: 18 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        style={{
          position: 'relative',
          width: 92,
          height: 92,
          borderRadius: 28,
          display: 'grid',
          placeItems: 'center',
          background: `linear-gradient(140deg, ${hues[0]}, ${hues[1]})`,
          boxShadow: `0 18px 50px -18px ${hues[0]}`,
          color: '#000'
        }}
      >
        <Icon width={44} height={44} strokeWidth={1.6} />
      </motion.div>
    </div>
  );
}

export default function Onboarding({ onDone }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const complete = useSettingsStore((s) => s.completeOnboarding);
  const acceptTerms = useSettingsStore((s) => s.acceptTerms);

  const [index, setIndex] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null);

  const isLang = index === 0;
  const isSlide = index > 0 && index <= SLIDES.length;
  const isWallet = index === SLIDES.length + 1;
  const isTerms = index === SLIDES.length + 2;
  const slide = isSlide ? SLIDES[index - 1] : null;

  const finish = () => {
    acceptTerms();
    complete();
    onDone?.();
  };

  const next = () => {
    haptic?.('light');
    if (isTerms) {
      if (!agreed) return;
      finish();
    } else {
      setIndex((i) => i + 1);
    }
  };

  const canAdvance = !isTerms || agreed;

  return (
    <div className="onb-stage">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px 0' }}>
        {index > 0 ? (
          <button
            onClick={() => setIndex((i) => i - 1)}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', padding: 8 }}
          >
            {t('common.back')}
          </button>
        ) : (
          <span />
        )}
        {isSlide && (
          <button
            onClick={() => setIndex(SLIDES.length + 1)}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', padding: 8 }}
          >
            {t('onboarding.skip')}
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* ---------------- language ---------------- */}
          {isLang && (
            <div style={{ padding: '6px 22px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <Art Icon={IconGlobe} hues={['#00e5ff', '#ffb300']} index={index} />
              <h1 className="h1" style={{ fontSize: 23, textAlign: 'center', marginBottom: 8 }}>
                {t('lang.title')}
              </h1>
              <p className="muted" style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.75 }}>
                {t('lang.subtitle')}
              </p>
              <div style={{ overflowY: 'auto', minHeight: 0, paddingBottom: 6 }}>
                <LanguagePicker />
              </div>
              <p className="faint" style={{ textAlign: 'center', marginTop: 8, lineHeight: 1.7 }}>
                {t('lang.changeLater')}
              </p>
            </div>
          )}

          {/* ---------------- feature slides ---------------- */}
          {isSlide && slide && (
            <>
              <Art Icon={slide.Icon} hues={slide.hues} index={index} />
              <div style={{ padding: '0 26px', textAlign: 'center' }}>
                <motion.h1
                  className="h1"
                  style={{ fontSize: 25, marginBottom: 10 }}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 }}
                >
                  {t(`onboarding.${slide.key}.title`)}
                </motion.h1>
                <motion.p
                  className="muted"
                  style={{ fontSize: 13.5, lineHeight: 1.75 }}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  {t(`onboarding.${slide.key}.body`)}
                </motion.p>
              </div>
            </>
          )}

          {/* ---------------- wallet connect ---------------- */}
          {isWallet && (
            <div style={{ padding: '10px 22px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Art Icon={IconWallet} hues={['#00e5ff', '#00ff9d']} index={index} />
              <h1 className="h1" style={{ fontSize: 23, textAlign: 'center', marginBottom: 8 }}>
                {t('onboarding.wallet.title')}
              </h1>
              <p className="muted" style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.75 }}>
                {t('onboarding.wallet.body')}
              </p>

              {wallet.address ? (
                <motion.div
                  className="card card-rgb"
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{ marginTop: 16 }}
                >
                  <div className="sheen" />
                  <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
                    <span style={{ color: 'var(--up)' }}><IconCheck width={19} height={19} /></span>
                    <span className="mono" style={{ fontSize: 13 }}>{shortAddress(wallet.address)}</span>
                  </div>
                  <div className="faint" style={{ textAlign: 'center', marginTop: 5 }}>
                    {t('onboarding.wallet.connected')}
                  </div>
                </motion.div>
              ) : (
                <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => setConnectOpen(true)}>
                  {t('wallet.connect')}
                </button>
              )}

              <p className="faint" style={{ textAlign: 'center', marginTop: 12, lineHeight: 1.7 }}>
                {t('onboarding.wallet.skipNote')}
              </p>
            </div>
          )}

          {/* ---------------- terms gate ---------------- */}
          {isTerms && (
            <div style={{ padding: '10px 22px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Art Icon={IconShield} hues={['#7c4dff', '#ff2d95']} index={index} />
              <h1 className="h1" style={{ fontSize: 23, textAlign: 'center', marginBottom: 8 }}>
                {t('onboarding.terms.title')}
              </h1>
              <p className="muted" style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.75 }}>
                {t('onboarding.terms.body')}
              </p>

              <div className="row" style={{ gap: 9, marginTop: 14 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setLegalDoc('terms')}>
                  {t('terms.title')}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setLegalDoc('privacy')}>
                  {t('privacy.title')}
                </button>
              </div>

              <motion.label
                whileTap={{ scale: 0.985 }}
                className="card"
                style={{
                  display: 'flex',
                  gap: 11,
                  alignItems: 'flex-start',
                  marginTop: 14,
                  cursor: 'pointer',
                  borderColor: agreed ? 'var(--rgb-1)' : 'var(--line)'
                }}
              >
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => {
                    setAgreed(e.target.checked);
                    haptic?.('select');
                  }}
                  style={{ width: 19, height: 19, marginTop: 1, accentColor: '#00e5ff', flexShrink: 0 }}
                />
                <span className="muted" style={{ fontSize: 12.3, lineHeight: 1.7 }}>
                  {t('onboarding.terms.agree')}
                </span>
              </motion.label>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="onb-dots">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <div key={i} className="onb-dot" data-active={i === index} />
        ))}
      </div>

      <div style={{ padding: '0 20px' }}>
        <motion.button
          className="btn btn-primary"
          whileTap={{ scale: 0.97 }}
          onClick={next}
          disabled={!canAdvance}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'center' }}>
            {isTerms ? t('onboarding.start') : t('onboarding.next')}
            {!isTerms && <IconChevronRight width={17} height={17} />}
          </span>
        </motion.button>
      </div>

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />

      <Sheet open={Boolean(legalDoc)} onClose={() => setLegalDoc(null)} title={t(`${legalDoc ?? 'terms'}.title`)}>
        <div style={{ maxHeight: '58dvh', overflowY: 'auto' }}>
          <LegalInline doc={legalDoc} />
        </div>
      </Sheet>
    </div>
  );
}

/** Terms/Privacy body rendered inside the onboarding modal. */
function LegalInline({ doc }) {
  const { t } = useTranslation();
  if (!doc) return null;
  const keys =
    doc === 'privacy'
      ? ['collect', 'notCollect', 'onchain', 'thirdPartyData', 'storage', 'analytics', 'rights', 'contact']
      : ['nature', 'noCustody', 'fees', 'risk', 'noAdvice', 'eligibility', 'prohibited', 'thirdParty', 'availability', 'liability', 'changes'];

  return (
    <>
      <p className="muted" style={{ fontSize: 12.3 }}>{t(`${doc}.intro`)}</p>
      {keys.map((k, i) => (
        <div key={k} style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 12.8, marginBottom: 3 }}>
            <span className="mono" style={{ color: 'var(--rgb-1)', marginInlineEnd: 6, fontSize: 10.5 }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            {t(`${doc}.${k}.title`)}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t(`${doc}.${k}.body`)}</p>
        </div>
      ))}
    </>
  );
}
