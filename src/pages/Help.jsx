import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { faqList } from '../lib/faqLocal';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDoc,
  IconInfo,
  IconLock,
  IconShield
} from '../components/Icons';

/**
 * HELP
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO "ASK THE AI" HERE ANY MORE
 *
 * It was removed on purpose, and the reasoning is worth keeping.
 *
 * A chat box in a wallet app sets an expectation it cannot meet: that you can
 * ask anything and get a trustworthy answer about your money. In practice
 * three things went wrong. Without a configured model it answered from a
 * fixed knowledge base while still *looking* like a chatbot. With a model, it
 * could invent a fee, a network or a recovery path that does not exist — and
 * someone acting on an invented recovery path loses funds. And either way the
 * user had to guess the right question before they got anything at all.
 *
 * The knowledge base was always the honest part: twelve answers written by
 * hand, about this exact app, checked against what the code actually does. So
 * that is now the whole feature, presented as what it is — a browsable FAQ.
 * You can see every question at a glance instead of guessing, every answer is
 * one we can stand behind, and it works offline with nothing configured.
 *
 * Anything the FAQ does not cover routes to the two places that can actually
 * help: the step-by-step guide, and a human on Telegram.
 */
export default function Help() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const replayGuide = useSettingsStore((s) => s.replayGuide);

  // Which FAQ row is expanded. One at a time: an accordion where everything
  // can be open at once is just a wall of text with extra taps.
  const [openId, setOpenId] = useState(null);

  const faqs = useMemo(() => faqList(i18n.language), [i18n.language]);

  const toggle = (id) => {
    haptic?.('select');
    setOpenId((cur) => (cur === id ? null : id));
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('help.title')}</h1>
      </motion.div>

      {/* ---------- step-by-step guide: the highest-value destination ------- */}
      <motion.button
        className="card lift"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => {
          haptic?.('light');
          replayGuide();
        }}
        style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
      >
        <div className="row-between">
          <div className="row" style={{ gap: 11, minWidth: 0 }}>
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                color: '#000',
                background: 'linear-gradient(140deg, var(--rgb-1), var(--rgb-2))'
              }}
            >
              <IconInfo width={19} height={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('help.guideCta')}</div>
              <div className="faint" style={{ lineHeight: 1.6 }}>{t('help.guideCtaSub')}</div>
            </div>
          </div>
          <IconChevronRight width={17} height={17} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        </div>
      </motion.button>

      {/* -------------------------------- FAQ ------------------------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 4 }}>{t('help.faqTitle')}</p>
        <p className="faint" style={{ margin: '0 0 10px', lineHeight: 1.7 }}>
          {t('help.faqSubtitle')}
        </p>

        <motion.div className="stack" style={{ gap: 7 }} variants={stagger} initial="hidden" animate="show">
          {faqs.map(({ id, answer }) => {
            const isOpen = openId === id;
            return (
              <motion.div key={id} className="faq-item" data-open={isOpen} variants={riseIn}>
                <button
                  type="button"
                  className="faq-q"
                  onClick={() => toggle(id)}
                  aria-expanded={isOpen}
                >
                  <span>{t(`help.q.${id}`)}</span>
                  <motion.span
                    className="faq-chev"
                    animate={{ rotate: isOpen ? 90 : 0 }}
                    transition={{ duration: 0.18 }}
                    aria-hidden="true"
                  >
                    <IconChevronRight width={15} height={15} />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="a"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <p className="faq-a">{answer}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      </motion.section>

      {/* ------------------- nothing matched → talk to a human -------------- */}
      <motion.button
        className="card lift"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => navigate('/contact')}
        style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
      >
        <div className="row-between">
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('help.stillStuck')}</div>
            <div className="faint" style={{ lineHeight: 1.6 }}>{t('help.stillStuckSub')}</div>
          </div>
          <IconChevronRight width={17} height={17} style={{ color: 'var(--text-3)' }} />
        </div>
      </motion.button>

      {/* ---------- docs & legal ---------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('help.resources')}</p>
        <div className="set-group">
          <button className="set-row" onClick={() => navigate('/docs')}>
            <span className="set-row-icon"><IconDoc width={19} height={19} /></span>
            <span className="set-row-label">
              <div>{t('help.docs')}</div>
              <div className="set-row-sub">{t('help.docsSub')}</div>
            </span>
            <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)' }} />
          </button>

          <button className="set-row" onClick={() => navigate('/audit')}>
            <span className="set-row-icon"><IconShield width={19} height={19} /></span>
            <span className="set-row-label">
              <div>{t('help.audit')}</div>
              <div className="set-row-sub">{t('help.auditSub')}</div>
            </span>
            <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)' }} />
          </button>

          <button className="set-row" onClick={() => navigate('/legal/terms')}>
            <span className="set-row-icon"><IconDoc width={19} height={19} /></span>
            <span className="set-row-label"><div>{t('terms.title')}</div></span>
            <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)' }} />
          </button>

          <button className="set-row" onClick={() => navigate('/legal/privacy')}>
            <span className="set-row-icon"><IconShield width={19} height={19} /></span>
            <span className="set-row-label"><div>{t('privacy.title')}</div></span>
            <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)' }} />
          </button>

          <button className="set-row" onClick={() => navigate('/contact')}>
            <span className="set-row-icon"><IconLock width={19} height={19} /></span>
            <span className="set-row-label">
              <div>{t('help.github')}</div>
              <div className="set-row-sub">{t('help.githubSub')}</div>
            </span>
            <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)' }} />
          </button>
        </div>
      </motion.section>

      <p className="notice notice-danger">{t('help.scamWarning')}</p>
    </PageTransition>
  );
}
