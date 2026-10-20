import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { faqList } from '../lib/faqLocal';
import AskHelp from '../components/AskHelp';
import { useSettingsStore } from '../store/useSettingsStore';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../lib/contact';
import { TELEGRAM_BOT_URL, TELEGRAM_BOT_USERNAME } from '../lib/telegramBot';
import { openUrl } from '../lib/browser';
import SubTabRail from '../components/learn/SubTabRail';
import { LearnTop } from '../components/learn/LearnHero';
import '../styles/learn-hub.css';
import {
  IconChevronRight,
  IconDoc,
  IconInfo,
  IconLock,
  IconMail,
  IconSearch,
  IconShield,
  IconTelegram,
  IconUser,
  IconX,
  IconAlertTriangle
} from '../components/Icons';

/**
 * HELP — the «راهنما» tab of the Learn hub.
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO "ASK THE AI" AS A CHATBOT ANY MORE
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
 * The knowledge base was always the honest part: answers written by hand,
 * about this exact app, checked against what the code actually does. So the
 * assistant is now presented as what it is, and next to it sits the thing
 * that never guesses — the browsable FAQ below it.
 *
 * ─── THE 2026 REDESIGN: TWO SUB-TABS ───────────────────────────────────────
 * The old page was one unbroken column: a guide button, an assistant, 37
 * questions, five resource rows and a scam warning, in that order, always.
 * Someone looking for the support address scrolled past 37 accordions to find
 * it. Splitting it in two is the whole fix:
 *
 *   · پرسش‌های پرتکرار — the guide, the assistant, and a SEARCHABLE FAQ
 *     (37 entries with a filter is a list; 37 entries is a wall).
 *   · پشتیبانی و منابع — how to reach a human, and the five documents.
 *
 * The scam warning is on the support tab, next to the only two channels we
 * actually answer through: that is where someone is about to be told by a
 * stranger that they are "support".
 */

const SUBTABS = [
  { id: 'faq', Icon: IconInfo, a: '#00e5ff', b: '#7c4dff' },
  { id: 'support', Icon: IconLock, a: '#ff2d95', b: '#7c4dff' }
];

/**
 * The documents behind «منابع». One row each, in reading order.
 *
 * `key` is explicit on every row on purpose. Deriving it as `help.${id}` looked
 * tidy and printed `help.terms` / `help.privacy` on the screen — those two
 * labels live under `terms.title` and `privacy.title` because the legal pages
 * own them, and a raw key in a list of documents is the kind of thing that
 * reads as a broken app rather than a missing translation.
 */
const RESOURCES = [
  { id: 'docs', key: 'help.docs', to: '/docs', Icon: IconDoc, subKey: 'help.docsSub' },
  { id: 'audit', key: 'help.audit', to: '/audit', Icon: IconShield, subKey: 'help.auditSub' },
  { id: 'terms', key: 'terms.title', to: '/legal/terms', Icon: IconDoc },
  { id: 'privacy', key: 'privacy.title', to: '/legal/privacy', Icon: IconShield },
  { id: 'github', key: 'help.github', to: '/contact', Icon: IconLock, subKey: 'help.githubSub' }
];

export default function Help({ embedded = false }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const replayGuide = useSettingsStore((s) => s.replayGuide);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  const [sub, setSub] = useState('faq');
  // Which FAQ row is expanded. One at a time: an accordion where everything
  // can be open at once is just a wall of text with extra taps.
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState('');

  const faqs = useMemo(() => faqList(i18n.language), [i18n.language]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faqs;
    return faqs.filter(({ id, answer }) => {
      const question = t(`help.q.${id}`).toLowerCase();
      return question.includes(q) || String(answer).toLowerCase().includes(q);
    });
  }, [faqs, query, t]);

  const toggle = (id) => {
    haptic?.('select');
    setOpenId((cur) => (cur === id ? null : id));
  };

  const openTelegram = () => {
    haptic?.('light');
    openUrl(TELEGRAM_BOT_URL);
  };

  const num = (n) => new Intl.NumberFormat(locale).format(n);

  return (
    <PageTransition embedded={embedded}>
      {/* Suppressed when hosted in the hub — the shell already draws a back
          button, a hero and the title, and two of each is clutter. */}
      {!embedded && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <LearnTop
            title={t('help.title')}
            sub={t('learn.tabsSub.help')}
            onBack={() => navigate(-1)}
            backLabel={t('common.back')}
          />
        </motion.div>
      )}

      <motion.div variants={riseIn} initial="hidden" animate="show">
        <SubTabRail
          items={SUBTABS.map((s) => ({
            ...s,
            count: s.id === 'faq' ? faqs.length : RESOURCES.length
          }))}
          value={sub}
          onChange={setSub}
          labelPrefix="learn.subtab"
          label={t('learn.subtabsTitle')}
          hint={t(`learn.hint.${sub}`)}
          locale={locale}
        />
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={sub}
          className="lh-panel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {sub === 'faq' ? (
            <>
              {/* ---------- the step-by-step guide: the best first read ----- */}
              <motion.button
                className="lh-cta"
                variants={riseIn}
                initial="hidden"
                animate="show"
                onClick={() => {
                  haptic?.('light');
                  replayGuide();
                }}
              >
                <span className="lh-cta-icon" aria-hidden="true">
                  <IconInfo width={21} height={21} />
                </span>
                <span className="lh-cta-copy">
                  <span className="lh-cta-title">{t('help.guideCta')}</span>
                  <span className="lh-cta-sub">{t('help.guideCtaSub')}</span>
                </span>
                <span className="lh-cta-arrow lh-flip" aria-hidden="true">
                  <IconChevronRight width={17} height={17} />
                </span>
                <span className="lh-sheen" aria-hidden="true" />
              </motion.button>

              {/* ------------------------------ ask ------------------------ */}
              <motion.div variants={riseIn} initial="hidden" animate="show">
                <AskHelp />
              </motion.div>

              {/* ------------------------------ FAQ ------------------------ */}
              <motion.section variants={riseIn} initial="hidden" animate="show">
                <div className="lh-rowhead">
                  <p className="lh-label">{t('help.faqTitle')}</p>
                  <span className="lh-count" aria-live="polite">
                    <strong>{num(filtered.length)}</strong>
                    <span> / {num(faqs.length)}</span>
                  </span>
                </div>

                <label className="lh-search">
                  <IconSearch width={16} height={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('learn.faq.searchPlaceholder')}
                    aria-label={t('learn.faq.searchLabel')}
                  />
                  {query ? (
                    <button
                      type="button"
                      className="lh-search-clear"
                      onClick={() => setQuery('')}
                      aria-label={t('learn.faq.clear')}
                    >
                      <IconX width={13} height={13} />
                    </button>
                  ) : null}
                </label>

                {filtered.length > 0 ? (
                  <motion.div
                    className="lh-faq-stack"
                    style={{ marginTop: 11 }}
                    variants={stagger}
                    initial="hidden"
                    animate="show"
                  >
                    {filtered.map(({ id, answer }, i) => {
                      const isOpen = openId === id;
                      return (
                        <motion.div key={id} className="lh-faq" data-open={isOpen} variants={riseIn}>
                          <button
                            type="button"
                            className="lh-faq-q"
                            onClick={() => toggle(id)}
                            aria-expanded={isOpen}
                          >
                            <span className="lh-faq-num" aria-hidden="true">{num(i + 1)}</span>
                            <span className="lh-faq-text">{t(`help.q.${id}`)}</span>
                            <motion.span
                              className="lh-faq-chev"
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
                                <div className="lh-faq-body">
                                  <div className="lh-faq-body-inner">
                                    <p className="lh-faq-a">{answer}</p>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                ) : (
                  <div className="lh-empty" style={{ marginTop: 11 }} role="status">
                    <span className="lh-empty-icon" aria-hidden="true">
                      <IconSearch width={18} height={18} />
                    </span>
                    <p className="lh-empty-title">{t('learn.faq.emptyTitle')}</p>
                    <p className="lh-empty-body">{t('learn.faq.emptyBody')}</p>
                  </div>
                )}
              </motion.section>
            </>
          ) : (
            <>
              {/* --------------------- reach a human ----------------------- */}
              <motion.section variants={riseIn} initial="hidden" animate="show">
                <p className="lh-label">{t('learn.support.title')}</p>
                <div className="lh-contact-grid">
                  <button
                    type="button"
                    className="lh-contact"
                    style={{ '--a': '#00e5ff', '--b': '#7c4dff' }}
                    onClick={() => {
                      haptic?.('light');
                      navigate('/contact');
                    }}
                  >
                    <span className="lh-contact-icon" aria-hidden="true">
                      <IconUser width={20} height={20} />
                    </span>
                    <span className="lh-contact-title">{t('help.contactUs')}</span>
                    <p className="lh-contact-sub">{t('help.contactUsSub')}</p>
                    <span className="lh-contact-cta">
                      {t('learn.support.open')}
                      <span className="lh-flip" aria-hidden="true">
                        <IconChevronRight width={13} height={13} />
                      </span>
                    </span>
                  </button>

                  <a
                    className="lh-contact"
                    style={{ '--a': '#ffb300', '--b': '#ff5a3a' }}
                    href={SUPPORT_MAILTO}
                  >
                    <span className="lh-contact-icon" aria-hidden="true">
                      <IconMail width={20} height={20} />
                    </span>
                    <span className="lh-contact-title">{t('help.email')}</span>
                    <p className="lh-contact-sub">{t('learn.support.emailSub')}</p>
                    <span className="lh-contact-value" dir="ltr">{SUPPORT_EMAIL}</span>
                  </a>

                  <button
                    type="button"
                    className="lh-contact"
                    style={{ '--a': '#2aabee', '--b': '#7c4dff' }}
                    onClick={openTelegram}
                  >
                    <span className="lh-contact-icon" aria-hidden="true">
                      <IconTelegram width={20} height={20} />
                    </span>
                    <span className="lh-contact-title">{t('help.telegram')}</span>
                    <p className="lh-contact-sub">{t('learn.support.telegramSub')}</p>
                    <span className="lh-contact-value" dir="ltr">@{TELEGRAM_BOT_USERNAME}</span>
                  </button>
                </div>
              </motion.section>

              {/* -------------------------- documents ---------------------- */}
              <motion.section variants={riseIn} initial="hidden" animate="show">
                <p className="lh-label">{t('help.resources')}</p>
                <div className="lh-links">
                  {RESOURCES.map(({ id, key, to, Icon, subKey }) => (
                    <button
                      key={id}
                      type="button"
                      className="lh-link"
                      onClick={() => {
                        haptic?.('light');
                        navigate(to);
                      }}
                    >
                      <span className="lh-link-icon" aria-hidden="true">
                        <Icon width={18} height={18} />
                      </span>
                      <span className="lh-link-body">
                        <span className="lh-link-title">{t(key)}</span>
                        {subKey ? <span className="lh-link-sub">{t(subKey)}</span> : null}
                      </span>
                      <span className="lh-link-chev lh-flip" aria-hidden="true">
                        <IconChevronRight width={15} height={15} />
                      </span>
                    </button>
                  ))}
                </div>
              </motion.section>

              {/* -------------------------- scam warning ------------------- */}
              <motion.section variants={riseIn} initial="hidden" animate="show">
                <div className="lh-alert" role="note">
                  <span className="lh-alert-icon" aria-hidden="true">
                    <IconAlertTriangle width={18} height={18} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p className="lh-alert-title">{t('learn.support.scamTitle')}</p>
                    <p className="lh-alert-body">{t('help.scamWarning')}</p>
                  </div>
                </div>
              </motion.section>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </PageTransition>
  );
}
