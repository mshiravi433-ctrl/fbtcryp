import { useState } from 'react';
import LaunchProgress from '../components/LaunchProgress';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import WalletConnectSheet from '../components/WalletConnectSheet';
import Sheet from '../components/Sheet';
import LanguagePicker from '../components/LanguagePicker';
import {
  IconChevronLeft,
  IconChevronRight,
  IconLanguages,
  IconShield,
  IconSwap,
  IconTrend,
  IconWallet,
  IconCheck
} from '../components/Icons';

/**
 * Five-step welcome: three feature slides, wallet connect, and terms.
 *
 * The terms step is a hard gate — you cannot enter the app without ticking it.
 * Wallet connect is skippable, because forcing it before someone has seen the
 * product is a good way to lose them, and every screen prompts for it anyway.
 *
 * LAYOUT — why it is built this way
 * The previous version put the slide content and the footer in one column with
 * no fixed regions, so a long Persian paragraph pushed the buttons off the
 * bottom of the screen: tapping "Next" appeared to jump you to the end of the
 * page. It also sized Back and Next from their own text, and Persian labels
 * are wider than English ones, so the two buttons came out visibly different
 * sizes — worse in RTL, where the eye lands on the wide one first.
 *
 * The fix, mirroring the guide screen:
 *   .onb-stage   fixed, full height, flex column — never animated
 *   .onb-scroll  the ONLY scrolling element      — never transformed
 *   .onb-foot    outside the scroll box, safe-area aware
 * and both footer buttons are `flex: 1` with a shared min-height, so they are
 * always exactly the same size in every language and both directions. The
 * chevrons flip under RTL so "forward" still points forward.
 */

const SLIDES = [
  { key: 'trade', Icon: IconTrend, hues: ['#00e5ff', '#7c4dff'] },
  { key: 'swap', Icon: IconSwap, hues: ['#7c4dff', '#ff2d95'] },
  { key: 'custody', Icon: IconShield, hues: ['#00ff9d', '#00e5ff'] }
];

/*
 * Steps: three feature slides, then wallet, then terms.
 *
 * The language step that used to sit at index 0 is GONE. Welcome already asks
 * for a language, so this was the second consecutive screen asking the same
 * question — before the user had seen anything the product does. The compact
 * language switch in the header (below) still lets anyone change it from any
 * step, which was the only real justification for keeping it here.
 */
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
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === 'rtl';
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const complete = useSettingsStore((s) => s.completeOnboarding);
  const acceptTerms = useSettingsStore((s) => s.acceptTerms);

  const [index, setIndex] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null);
  const [langOpen, setLangOpen] = useState(false);

  const isSlide = index < SLIDES.length;
  const isWallet = index === SLIDES.length;
  const isTerms = index === SLIDES.length + 1;
  const slide = isSlide ? SLIDES[index] : null;

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

  // Slide direction: forward is +1, back is -1, so the exit animation moves
  // the right way when the user taps Back instead of always sliding left.
  const [dir, setDir] = useState(1);
  const goTo = (i) => {
    setDir(i > index ? 1 : -1);
    setIndex(i);
  };

  return (
    <div className="onb-stage">
      <div className="onb-topbar">
        <button
          className="onb-link"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          style={{ visibility: index === 0 ? 'hidden' : 'visible' }}
        >
          {t('common.back')}
        </button>

        {/*
          The language switch stays reachable on every step. It matters more
          now that the dedicated language step is gone: someone who picked the
          wrong language on Welcome must be able to fix it here rather than
          reinstall.

          It opens a sheet. Removing the step left this button with no onClick
          at all for a moment — a control that looks live and does nothing,
          which is the exact failure this project keeps hitting.
        */}
        <button className="onb-link" onClick={() => setLangOpen(true)} aria-label={t('common.language')}>
          <IconLanguages width={16} height={16} />
        </button>

        <button
          className="onb-link"
          onClick={() => goTo(SLIDES.length)}
          style={{ visibility: isSlide ? 'visible' : 'hidden' }}
        >
          {t('onboarding.skip')}
        </button>
      </div>

      {/* The ONLY scrolling element. Never transformed — see the header note. */}
      <div className="onb-scroll">
      <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={index}
          custom={dir}
          initial={{ opacity: 0, x: 40 * dir * (rtl ? -1 : 1) }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 * dir * (rtl ? -1 : 1) }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* ---------------- feature slides ---------------- */}
          {isSlide && (
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
              <ul className="prose-list" style={{ marginTop: 12 }}>
                <li>{t('onboarding.wallet.why')}</li>
                <li>{t('onboarding.wallet.gain')}</li>
              </ul>

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
              <p className="muted" style={{ textAlign: 'center', marginTop: 6, fontSize: 12.5 }}>
                {t('onboarding.wallet.skipOk')}
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

      </div>

      {/* Footer lives outside the scroll box so it can never scroll away, and
          both buttons are flex:1 with the same min-height so they stay exactly
          the same size regardless of how wide the translated label is. */}
      <div className="onb-foot">
        <LaunchProgress step={2 + index} total={10} />
        <div className="onb-foot-row">
          <motion.button
            className="btn btn-ghost onb-btn"
            whileTap={{ scale: index === 0 ? 1 : 0.97 }}
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            style={{ opacity: index === 0 ? 0.35 : 1 }}
          >
            <IconChevronLeft width={17} height={17} />
            <span>{t('common.back')}</span>
          </motion.button>

          <motion.button
            className="btn btn-primary onb-btn"
            whileTap={{ scale: canAdvance ? 0.97 : 1 }}
            onClick={() => {
              setDir(1);
              next();
            }}
            disabled={!canAdvance}
          >
            <span>{isTerms ? t('onboarding.start') : t('onboarding.next')}</span>
            {!isTerms && <IconChevronRight width={17} height={17} />}
          </motion.button>
        </div>
      </div>

      <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={t('common.language')}>
        <LanguagePicker />
      </Sheet>

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
