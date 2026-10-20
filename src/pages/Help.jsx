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
import { GlyphBook, GlyphHeadset, GlyphMail, GlyphTelegram, GlyphVerified } from '../components/learn/LearnGlyphs';
import '../styles/learn-hub.css';
import {
  IconChevronRight,
  IconDoc,
  IconInfo,
  IconLock,
  IconSearch,
  IconShield,
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
 * ─── TWO SUB-TABS ──────────────────────────────────────────────────────────
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
 *
 * ─── THE SUPPORT TAB, SECOND PASS ──────────────────────────────────────────
 * The first pass drew the three contact tiles with an icon tile that had no
 * background: a near-black glyph on transparent glass, invisible on the dark
 * theme («ایکون‌های تلگرام و ایمیل و تماس را درست کن»). The email tile was
 * also a bare <a>, so it inherited the browser's underline, and an auto-fit
 * grid of three left the third tile orphaned under one of the others.
 *
 * Now: the two OFFICIAL channels (the bot and the mailbox) sit side by side as
 * equals, each wearing a «کانال رسمی» badge and a duotone glyph on a lit
 * gradient tile; the contact page is one wide row underneath. The hint above
 * them already says there are exactly two official channels — the layout now
 * says the same thing.
 */

const SUBTABS = [
  { id: 'faq', Icon: IconInfo, a: '#00e5ff', b: '#7c4dff' },
  { id: 'support', Icon: GlyphHeadset, a: '#ff2d95', b: '#7c4dff' }
];

/**
 * The documents behind «منابع». One row each, in reading order, each with
 * its own hue so five identical grey rows become five things.
 *
 * `key` is explicit on every row on purpose. Deriving it as `help.${id}` looked
 * tidy and printed `help.terms` / `help.privacy` on the screen — those two
 * labels live under `terms.title` and `privacy.title` because the legal pages
 * own them, and a raw key in a list of documents is the kind of thing that
 * reads as a broken app rather than a missing translation.
 */
const RESOURCES = [
  { id: 'docs', key: 'help.docs', to: '/docs', Icon: GlyphBook, subKey: 'help.docsSub', hue: '#00e5ff' },
  { id: 'audit', key: 'help.audit', to: '/audit', Icon: IconShield, subKey: 'help.auditSub', hue: '#00ff9d' },
  { id: 'terms', key: 'terms.title', to: '/legal/terms', Icon: IconDoc, hue: '#7c4dff' },
  { id: 'privacy', key: 'privacy.title', to: '/legal/privacy', Icon: IconLock, hue: '#ffb300' },
  { id: 'github', key: 'help.github', to: '/contact', Icon: IconDoc, subKey: 'help.githubSub', hue: '#ff2d95' }
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
                  <GlyphBook width={24} height={24} style={{ position: 'relative', zIndex: 1 }} />
                </span>
                <span className="lh-cta-copy">
                  <span className="lh-cta-eyebrow">{t('learn.faq.startHere')}</span>
                  <span className="lh-cta-title">{t('help.guideCta')}</span>
                  <span className="lh-cta-sub">{t('help.guideCtaSub')}</span>
                </span>
                <span className="lh-cta-arrow lh-flip" aria-hidden="true">
                  <IconChevronRight width={17} height={17} />
                </span>
                <span className="lh-sheen" aria-hidden="true" />
              </motion.button>

              {/* ------------------------------ ask ------------------------ */}
              <motion.div className="lh-ask" variants={riseIn} initial="hidden" animate="show">
                <AskHelp />
              </motion.div>

              {/* ------------------------------ FAQ ------------------------ */}
              <motion.section variants={riseIn} initial="hidden" animate="show">
                <p className="lh-label">{t('help.faqTitle')}</p>

                <label className="lh-search">
                  <span className="lh-search-ico" aria-hidden="true">
                    <IconSearch width={16} height={16} style={{ position: 'relative', zIndex: 1 }} />
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('learn.faq.searchPlaceholder')}
                    aria-label={t('learn.faq.searchLabel')}
                  />
                  {/* «n / N», live: the count sits in the bar it describes. */}
                  <span className="lh-count lh-search-count" aria-live="polite">
                    <strong>{num(filtered.length)}</strong>
                    <span>/{num(faqs.length)}</span>
                  </span>
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
                          <span className="lh-faq-rail" aria-hidden="true" />
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
                      <IconSearch width={18} height={18} style={{ position: 'relative', zIndex: 1 }} />
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
                  {/* Telegram first: for this audience it is the channel that
                      actually gets answered, and the one most often faked. */}
                  <button
                    type="button"
                    className="lh-contact"
                    style={{ '--a': '#2aabee', '--b': '#7c4dff' }}
                    onClick={openTelegram}
                    data-testid="help-contact-telegram"
                  >
                    <span className="lh-contact-head">
                      <span className="lh-contact-icon" aria-hidden="true">
                        <GlyphTelegram width={23} height={23} />
                      </span>
                      <span className="lh-contact-badge">
                        <GlyphVerified width={12} height={12} aria-hidden="true" />
                        {t('learn.support.official')}
                      </span>
                    </span>
                    <span className="lh-contact-title">{t('help.telegram')}</span>
                    <p className="lh-contact-sub">{t('learn.support.telegramSub')}</p>
                    <span className="lh-contact-value" dir="ltr">@{TELEGRAM_BOT_USERNAME}</span>
                    <span className="lh-contact-cta">
                      {t('learn.support.open')}
                      <IconChevronRight width={13} height={13} className="lh-flip" aria-hidden="true" />
                    </span>
                  </button>

                  <a
                    className="lh-contact"
                    style={{ '--a': '#ffb300', '--b': '#ff5a3a' }}
                    href={SUPPORT_MAILTO}
                    data-testid="help-contact-email"
                  >
                    <span className="lh-contact-head">
                      <span className="lh-contact-icon" aria-hidden="true">
                        <GlyphMail width={23} height={23} />
                      </span>
                      <span className="lh-contact-badge">
                        <GlyphVerified width={12} height={12} aria-hidden="true" />
                        {t('learn.support.official')}
                      </span>
                    </span>
                    <span className="lh-contact-title">{t('help.email')}</span>
                    <p className="lh-contact-sub">{t('learn.support.emailSub')}</p>
                    <span className="lh-contact-value" dir="ltr">{SUPPORT_EMAIL}</span>
                    <span className="lh-contact-cta">
                      {t('learn.support.open')}
                      <IconChevronRight width={13} height={13} className="lh-flip" aria-hidden="true" />
                    </span>
                  </a>

                  <button
                    type="button"
                    className="lh-contact lh-contact--wide"
                    style={{ '--a': '#00e5ff', '--b': '#7c4dff' }}
                    onClick={() => {
                      haptic?.('light');
                      navigate('/contact');
                    }}
                    data-testid="help-contact-page"
                  >
                    <span className="lh-contact-head">
                      <span className="lh-contact-icon" aria-hidden="true">
                        <GlyphHeadset width={23} height={23} />
                      </span>
                    </span>
                    <span className="lh-contact-body">
                      <span className="lh-contact-title">{t('help.contactUs')}</span>
                      <p className="lh-contact-sub">{t('help.contactUsSub')}</p>
                    </span>
                    <span className="lh-contact-cta" aria-hidden="true">
                      <IconChevronRight width={15} height={15} className="lh-flip" />
                    </span>
                  </button>
                </div>
              </motion.section>

              {/* -------------------------- documents ---------------------- */}
              <motion.section variants={riseIn} initial="hidden" animate="show">
                <p className="lh-label">{t('help.resources')}</p>
                <div className="lh-links">
                  {RESOURCES.map(({ id, key, to, Icon, subKey, hue }) => (
                    <button
                      key={id}
                      type="button"
                      className="lh-link"
                      style={{ '--hue': hue }}
                      onClick={() => {
                        haptic?.('light');
                        navigate(to);
                      }}
                    >
                      <span className="lh-link-icon" aria-hidden="true">
                        <Icon width={18} height={18} style={{ position: 'relative', zIndex: 1 }} />
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
                    <span className="lh-alert-ring" />
                    <IconAlertTriangle width={19} height={19} />
                  </span>
                  <div style={{ minWidth: 0, position: 'relative', zIndex: 1 }}>
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
