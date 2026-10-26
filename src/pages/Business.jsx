import { useCallback, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import {
  IconChevronLeft,
  IconBuilding,
  IconTrend,
  IconPools,
  IconKey,
  IconGlobe,
  IconMail,
  IconCheck,
  IconShield,
  IconActivity,
  IconExternal,
  IconBriefcase,
  IconChart,
  IconBank,
  IconCard,
  IconCoins,
  IconRocket,
  IconTrophy,
  IconClock,
  IconLock,
  IconSparkle
} from '../components/Icons';
import BusinessOrbMark from '../components/business/BusinessOrbMark';
import { openUrl } from '../lib/browser';
import { publicAppUrl } from '../lib/nativeShell';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../lib/contact';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { NETWORK_REGISTRY } from '../lib/ecosystemData';
import { FEE_BPS } from '../lib/feeBps.js';
import '../styles/docs-modern.css';
import '../styles/business-modern.css';

const SITE_URL = publicAppUrl('');

/* ------------------------------------------------------------------ data */

/**
 * The two partnership offers per service. Keys are shared across services on
 * purpose (`biz.point.*`) — eight strings cover four cards, so a translator
 * touches eight lines instead of sixteen and the wording stays consistent
 * between cards that mention the same capability.
 */
const OFFERS = [
  { id: 'listing', Icon: IconTrend, a: '#00e5ff', b: '#7c4dff', points: ['listing', 'data'] },
  { id: 'liquidity', Icon: IconPools, a: '#00ff9d', b: '#00b8ff', points: ['depth', 'slippage'] },
  { id: 'whitelabel', Icon: IconBuilding, a: '#b06bff', b: '#ff2d95', points: ['brand', 'domain'] },
  { id: 'integration', Icon: IconKey, a: '#ffb300', b: '#ff5a3a', points: ['docs', 'keys'] }
];

/*
 * ─── TWO TABS, AND NOTHING PRETENDS TO BE A BACKEND ─────────────────────────
 *   «تب پیگیری اطلاعات غیر واقعی هست — ببرش … چیزی در سرور ثبت نمی‌شود پس
 *    جالب هم نیست بنویسیم پیگیری وضعیت … تغییر بده به درخواست»
 *
 * What this page used to carry: a «پیگیری» tab with a status ring, a
 * three-step timeline with two steps marked done, and a filterable list of
 * three named demo requests with timestamps. None of it was connected to
 * anything — the form opens the user's own mail app and the server stores
 * nothing, so no status could ever be read back, and every number on that
 * panel was set dressing that a partner could mistake for a promise.
 *
 * So the second tab is now «درخواست»: the honest half of the old flow — the
 * explanation card and the form — with the invented half deleted. Picking a
 * service on the first tab still lands here, with that topic preselected.
 */
const TABS = [
  { id: 'partnership', Icon: IconBriefcase, a: '#00e5ff', b: '#7c4dff' },
  { id: 'request', Icon: IconMail, a: '#ff2d95', b: '#7c4dff' }
];

const SUBTABS = {
  partnership: [
    { id: 'services', Icon: IconTrend, a: '#00e5ff', b: '#7c4dff' },
    { id: 'brands', Icon: IconBuilding, a: '#b06bff', b: '#ff2d95' }
  ]
};

const BRANDS = [
  { id: 'fbt', name: 'FBT Swap', mono: 'F', Icon: IconBank, a: '#00e5ff', b: '#7c4dff' },
  { id: 'solana', name: 'Solana', mono: 'S', Icon: IconRocket, a: '#9945ff', b: '#14f195' },
  { id: 'ethereum', name: 'Ethereum', mono: 'E', Icon: IconTrophy, a: '#627eea', b: '#a6b9ff' },
  { id: 'polygon', name: 'Polygon', mono: 'P', Icon: IconCard, a: '#8247e5', b: '#c4a6ff' },
  { id: 'bnb', name: 'BNB Chain', mono: 'B', Icon: IconCoins, a: '#f0b90b', b: '#ffd94d' },
  { id: 'arbitrum', name: 'Arbitrum', mono: 'A', Icon: IconLock, a: '#28a0f0', b: '#7cc7ff' }
];

/* The three real steps of a request, in reading order. The numbers are
   rendered from the reader's locale, not typed into the JSX. */
const INTRO_STEPS = ['step1', 'step2', 'step3'];

const MESSAGE_MAX = 600;
const FIELD_ORDER = ['company', 'name', 'email', 'message'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const grad = (a, b) => `linear-gradient(135deg, ${a}, ${b})`;

function num(value, locale) {
  return new Intl.NumberFormat(locale || 'en').format(value);
}

/**
 * Arrow-key navigation for a roving-tabindex tablist.
 *
 * `tablistId` is read BEFORE the animation frame: React nulls
 * `event.currentTarget` once the handler returns, so reading it inside the
 * rAF callback throws a TypeError on the very first arrow press.
 */
function onTabListKeyDown(event, items, activeId, onPick) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const tablistId = event.currentTarget.dataset.tablistId;
  const idx = Math.max(0, items.findIndex((i) => i.id === activeId));
  let next = idx;
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const rtl = document.documentElement.dir === 'rtl';
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (forward) next = (idx + (rtl ? -1 : 1) + items.length) % items.length;
  else if (backward) next = (idx + (rtl ? 1 : -1) + items.length) % items.length;
  const item = items[next];
  if (item) {
    onPick(item);
    requestAnimationFrame(() => document.getElementById(`${tablistId}-${item.id}`)?.focus());
  }
}

/* ------------------------------------------------------------------ page */

export default function Business() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const uid = useId().replace(/[:]/g, '');
  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  const networkCount = NETWORK_REGISTRY.length;
  const evmNetworkCount = NETWORK_REGISTRY.filter((n) => n.type === 'EVM').length;
  /* Locale-safe: format from the number, never from a formatted string.
     Number() on \"0,7\" (a European decimal comma) is NaN, and a fee tile that
     reads NaN% is worse than one that reads nothing. */
  const feeNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(FEE_BPS / 100);
  const feeLabel = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(FEE_BPS / 10_000);

  const [activeTab, setActiveTab] = useState('partnership');
  const [activeSubTab, setActiveSubTab] = useState('services');
  const [interest, setInterest] = useState('listing');
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', message: '' });
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const formRef = useRef(null);

  const subTabs = SUBTABS[activeTab] || [];
  const activeOffer = OFFERS.find((o) => o.id === interest) || OFFERS[0];

  const pickTab = useCallback((tab) => {
    setActiveTab(tab.id);
    setActiveSubTab(SUBTABS[tab.id]?.[0]?.id || null);
    setErrors({});
    haptic?.('light');
  }, [haptic]);

  const pickSubTab = useCallback((st) => {
    setActiveSubTab(st.id);
    setErrors({});
    haptic?.('light');
  }, [haptic]);

  const openLink = useCallback((url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }, [haptic, tg]);

  /*
   * Selecting a topic goes straight to the request form. There is no list to
   * land on any more — the «درخواست» tab IS the form, so the jump only has to
   * pick the topic, switch the tab and bring the form into view.
   */
  const startRequest = useCallback((offerId) => {
    if (offerId) setInterest(offerId);
    setActiveTab('request');
    setActiveSubTab(null);
    setErrors({});
    haptic?.('light');
    requestAnimationFrame(() => setTimeout(() => formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 240));
  }, [haptic]);

  const setField = (k, v) => {
    setForm((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  /** Per-field validation, so the message sits under the field it is about. */
  const validate = () => {
    const next = {};
    if (!form.company.trim()) next.company = t('biz.form.companyError');
    if (!form.name.trim()) next.name = t('biz.form.nameError');
    /* An empty address is simply an invalid one — no separate \"required\"
       wording that then disagrees with the field label's own asterisk. */
    if (!EMAIL_RE.test(form.email.trim())) next.email = t('biz.form.emailError');
    if (form.message.trim().length < 12) next.message = t('biz.form.messageError');
    return next;
  };

  const submitBusiness = (event) => {
    event?.preventDefault();
    const next = validate();
    setErrors(next);
    const firstBad = FIELD_ORDER.find((k) => next[k]);
    if (firstBad) {
      useAppStore.getState().notify(t('biz.form.requiredError'), 'error');
      haptic?.('error');
      document.getElementById(`${uid}-${firstBad}`)?.focus();
      return;
    }
    setSending(true);
    haptic?.('light');
    const subject = encodeURIComponent(t('biz.form.mailSubject', { topic: t(`biz.offer.${interest}.title`), company: form.company.trim() }));
    const body = encodeURIComponent(t('biz.form.emailBody', {
      company: form.company.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || t('biz.form.notProvided'),
      topic: t(`biz.offer.${interest}.title`),
      message: form.message.trim()
    }));
    const mailto = `${SUPPORT_MAILTO}?subject=${subject}&body=${body}`;
    if (tg?.openLink) tg.openLink(mailto);
    else window.location.href = mailto;
    setTimeout(() => {
      setSending(false);
      setForm({ company: '', name: '', email: '', phone: '', message: '' });
      useAppStore.getState().notify(t('biz.form.ready'), 'success');
      haptic?.('success');
    }, 600);
  };

  const panelId = `${uid}-panel`;
  const stats = [
    { Icon: IconGlobe, a: '#00e5ff', b: '#7c4dff', value: t('biz.stats.networks.value', { count: num(networkCount, locale) }), label: t('biz.stats.networks.label'), sub: t('biz.stats.networks.sub', { evmCount: num(evmNetworkCount, locale) }) },
    { Icon: IconChart, a: '#00ff9d', b: '#00b8ff', value: t('biz.stats.fee.value', { fee: feeNumber }), label: t('biz.stats.fee.label'), sub: t('biz.stats.fee.sub') },
    { Icon: IconClock, a: '#ff2d95', b: '#ffb300', value: t('biz.stats.alwaysOpen.value'), label: t('biz.stats.alwaysOpen.label'), sub: t('biz.stats.alwaysOpen.sub') }
  ];

  const subtabCount = {
    services: OFFERS.length,
    brands: BRANDS.length
  };

  return (
    <PageTransition className="page biz-page">
      <div className="biz-shell">
        <div className="biz-orb a" aria-hidden="true" />
        <div className="biz-orb b" aria-hidden="true" />
        <div className="biz-orb c" aria-hidden="true" />

        {/* ---------------- Header ---------------- */}
        <motion.header className="biz-header" variants={riseIn} initial="hidden" animate="show">
          <button type="button" className="biz-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={19} height={19} className="biz-flip" />
          </button>
          <div className="biz-header-text">
            <h1 className="biz-title">{t('biz.title')}</h1>
            <p className="biz-header-sub">{t('biz.heroKicker')}</p>
          </div>
          <span className="biz-pill">
            <span className="biz-live-dot" aria-hidden="true" />
            {t('biz.badge')}
          </span>
        </motion.header>

        {/* ---------------- Hero — compact & balanced ---------------- */}
        <motion.section className="biz-hero" variants={riseIn} initial="hidden" animate="show">
          <div className="biz-hero-grid">
            <div className="biz-hero-copy">
              <span className="biz-hero-kicker">
                <IconSparkle width={12} height={12} />
                {t('about.companyFull')}
              </span>
              {/* The page <h1> above already names the section. Repeating it
                  here was a second identical line 32px lower: pure height,
                  no meaning. This line is the promise instead. */}
              <h2 className="biz-hero-title">{t('biz.heroTitle')}</h2>
              <p className="biz-hero-sub">{t('biz.intro')}</p>
              <div className="biz-hero-chips">
                <span className="biz-chip"><IconShield width={13} height={13} />{t('biz.heroChip.nonCustodial')}</span>
                <span className="biz-chip"><IconKey width={13} height={13} />{t('biz.heroChip.api')}</span>
                <span className="biz-chip"><IconClock width={13} height={13} />{t('biz.heroChip.support')}</span>
              </div>
              <div className="biz-hero-actions">
                <button type="button" className="biz-btn biz-btn--primary" onClick={() => startRequest(interest)}>
                  <IconBriefcase width={17} height={17} />{t('biz.requestPartnership')}
                </button>
                <button type="button" className="biz-btn biz-btn--ghost" onClick={() => openLink(SITE_URL)}>
                  <IconGlobe width={17} height={17} /><span dir="ltr">{SITE_URL.replace(/^https:\/\//, '')}</span>
                </button>
              </div>
              <p className="biz-hero-live">
                <span className="biz-live-dot biz-live-dot--sm" aria-hidden="true" />
                {t('biz.headerLive')}
              </p>
            </div>
            <div className="biz-hero-art">
              <BusinessOrbMark size={96} />
            </div>
          </div>
        </motion.section>

        {/* ---------------- Stats — compact ---------------- */}
        <motion.div className="biz-stats" variants={stagger} initial="hidden" animate="show" aria-label={t('biz.atGlance')}>
          {stats.map(({ Icon, a, b, value, label, sub }) => (
            <motion.div key={label} className="biz-stat" variants={riseIn} style={{ '--a': a, '--b': b }}>
              <span className="biz-stat-icon" style={{ background: grad(a, b) }}><Icon width={17} height={17} /></span>
              <div className="biz-stat-value">{value}</div>
              <div className="biz-stat-label">{label}</div>
              <div className="biz-stat-sub">{sub}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* ---------------- Main tabs (2) ---------------- */}
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <p className="biz-label" id={`${uid}-tabs-label`}>{t('biz.chooseArea')}</p>
          <div
            className="biz-tabs" role="tablist" aria-labelledby={`${uid}-tabs-label`}
            data-tablist-id={`${uid}-tab`}
            onKeyDown={(e) => onTabListKeyDown(e, TABS, activeTab, pickTab)}
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id} type="button" role="tab" id={`${uid}-tab-${tab.id}`}
                  aria-selected={active} aria-controls={panelId} tabIndex={active ? 0 : -1}
                  className={`biz-tab${active ? ' is-active' : ''}`}
                  onClick={() => pickTab(tab)}
                  style={{ '--a': tab.a, '--b': tab.b }}
                >
                  {active && (
                    <motion.span
                      className="biz-tab-pill" layoutId={`${uid}-tabpill`}
                      style={{ background: grad(tab.a, tab.b) }}
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="biz-tab-inner">
                    <span className="biz-tab-badge"><tab.Icon width={19} height={19} /></span>
                    <span className="biz-tab-text">
                      <span className="biz-tab-name">{t(`biz.tabs.${tab.id}`)}</span>
                      <span className="biz-tab-hint">{t(`biz.tabsSub.${tab.id}`)}</span>
                    </span>
                    <span className="biz-tab-tick" aria-hidden="true"><IconCheck width={13} height={13} /></span>
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ---------------- Sub-tabs (partnership only) ---------------- */}
        {subTabs.length > 0 && (
        <motion.div className="biz-subwrap" variants={riseIn} initial="hidden" animate="show">
          <div
            className="biz-subtabs" role="tablist" aria-label={t('biz.subtabsTitle')}
            data-tablist-id={`${uid}-sub`}
            onKeyDown={(e) => onTabListKeyDown(e, subTabs, activeSubTab, pickSubTab)}
          >
            {subTabs.map((st) => {
              const active = activeSubTab === st.id;
              return (
                <button
                  key={st.id} type="button" role="tab" id={`${uid}-sub-${st.id}`}
                  aria-selected={active} aria-controls={panelId} tabIndex={active ? 0 : -1}
                  className={`biz-subtab${active ? ' is-active' : ''}`}
                  onClick={() => pickSubTab(st)}
                  style={{ '--a': st.a, '--b': st.b }}
                >
                  {active && (
                    <motion.span
                      className="biz-subtab-pill" layoutId={`${uid}-subpill`}
                      style={{ background: grad(st.a, st.b) }}
                      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                    />
                  )}
                  <span className="biz-subtab-inner">
                    <st.Icon width={16} height={16} />
                    <span className="biz-subtab-label">{t(`biz.subtab.${st.id}`)}</span>
                    <span className="biz-subtab-count">{num(subtabCount[st.id], locale)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {/* The hint is a sibling of the tablist, not a child: a tablist may
              only contain tabs, and a stray span inside it breaks screen
              readers that count the tabs to announce \"2 of 4\". */}
          <p className="biz-panel-hint">{t(`biz.panelHint.${activeSubTab}`)}</p>
        </motion.div>
        )}

        {/* ---------------- Panels (3 views) ---------------- */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeTab}/${activeSubTab}`}
            id={panelId} role="tabpanel"
            aria-labelledby={activeSubTab ? `${uid}-sub-${activeSubTab}` : `${uid}-tab-${activeTab}`}
            className="biz-section"
            initial={{ opacity: 0, y: 14, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.995 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* ===== Partnership / Services ===== */}
            {activeTab === 'partnership' && activeSubTab === 'services' && (
              <>
                <p className="biz-label">{t('biz.servicesTitle')}</p>
                <motion.div className="biz-offer-grid" variants={stagger} initial="hidden" animate="show">
                  {OFFERS.map(({ id, Icon, a, b, points }, index) => (
                    <motion.article
                      key={id} className={`biz-card biz-offer${interest === id ? ' is-picked' : ''}`}
                      variants={riseIn} style={{ '--a': a, '--b': b }}
                    >
                      <span className="biz-offer-index" aria-hidden="true">{num(index + 1, locale).padStart(2, '0')}</span>
                      <span className="biz-offer-icon" style={{ background: grad(a, b) }}><Icon width={24} height={24} /></span>
                      <span className="biz-offer-eyebrow">{t(`biz.offerMeta.${id}`)}</span>
                      <h3 className="biz-offer-title">{t(`biz.offer.${id}.title`)}</h3>
                      <p className="biz-offer-text">{t(`biz.offer.${id}.body`)}</p>
                      <div className="biz-offer-points">
                        {points.map((p) => (
                          <span key={p} className="biz-offer-point">
                            <IconCheck width={12} height={12} />{t(`biz.point.${p}`)}
                          </span>
                        ))}
                      </div>
                      <button type="button" className="biz-offer-cta" onClick={() => startRequest(id)}>
                        {t('biz.selectTopic')}
                        <IconChevronLeft width={14} height={14} className="biz-flip biz-cta-arrow" />
                      </button>
                      <span className="biz-offer-sheen" aria-hidden="true" />
                    </motion.article>
                  ))}
                </motion.div>

                {/* --- Conditions & method --- */}
                <div className="biz-card biz-conditions">
                  <p className="biz-label biz-label--card">{t('biz.conditions.title')}</p>
                  <div className="biz-conditions-grid">
                    <div className="biz-cond" style={{ '--a': '#00e5ff', '--b': '#7c4dff' }}>
                      <span className="biz-cond-icon" style={{ background: grad('#00e5ff', '#7c4dff') }}><IconShield width={18} height={18} /></span>
                      <div className="biz-cond-body">
                        <h3 className="biz-cond-title">{t('biz.conditions.eligible.title')}</h3>
                        <p className="biz-cond-text">{t('biz.conditions.eligible.body', { fee: feeLabel })}</p>
                      </div>
                    </div>
                    <div className="biz-cond" style={{ '--a': '#b06bff', '--b': '#ff2d95' }}>
                      <span className="biz-cond-icon" style={{ background: grad('#b06bff', '#ff2d95') }}><IconActivity width={18} height={18} /></span>
                      <div className="biz-cond-body">
                        <h3 className="biz-cond-title">{t('biz.conditions.method.title')}</h3>
                        <p className="biz-cond-text">{t('biz.conditions.method.body')}</p>
                      </div>
                    </div>
                    <div className="biz-cond" style={{ '--a': '#00ff9d', '--b': '#00b8ff' }}>
                      <span className="biz-cond-icon" style={{ background: grad('#00ff9d', '#00b8ff') }}><IconClock width={18} height={18} /></span>
                      <div className="biz-cond-body">
                        <h3 className="biz-cond-title">{t('biz.conditions.timeline.title')}</h3>
                        <p className="biz-cond-text">{t('biz.conditions.timeline.body')}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* --- Why us + guarantee --- */}
                <div className="biz-card biz-why">
                  <p className="biz-label biz-label--card">{t('biz.whyUsTitle')}</p>
                  <motion.div className="biz-why-list" variants={stagger} initial="hidden" animate="show">
                    {[
                      { id: 'nonCustodial', Icon: IconShield, a: '#00e5ff', b: '#7c4dff' },
                      { id: 'integration', Icon: IconKey, a: '#b06bff', b: '#ff2d95' },
                      { id: 'revenue', Icon: IconTrend, a: '#00ff9d', b: '#00b8ff' }
                    ].map(({ id, Icon, a, b }) => (
                      <motion.div key={id} className="biz-why-row" variants={riseIn} style={{ '--a': a, '--b': b }}>
                        <span className="biz-why-icon" style={{ background: grad(a, b) }}><Icon width={19} height={19} /></span>
                        <div className="biz-why-body">
                          <h3 className="biz-why-title">{t(`biz.benefits.${id}.title`)}</h3>
                          <p className="biz-why-text">{t(`biz.benefits.${id}.body`, { fee: feeLabel })}</p>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                  <div className="biz-guarantee">
                    <span className="biz-guarantee-icon"><IconCheck width={14} height={14} /></span>
                    <p className="biz-guarantee-yes">{t('biz.guarantee.yes')}</p>
                    <p className="biz-guarantee-no">{t('biz.guarantee.no')}</p>
                  </div>
                </div>
              </>
            )}

            {/* ===== Partnership / Brands ===== */}
            {activeTab === 'partnership' && activeSubTab === 'brands' && (
              <>
                <p className="biz-label">{t('biz.brandsTitle')}</p>
                <p className="biz-lead">{t('biz.brandsSub')}</p>
                <motion.div className="biz-brand-grid" variants={stagger} initial="hidden" animate="show">
                  {BRANDS.map(({ id, name, mono, Icon, a, b }) => (
                    <motion.div key={id} className="biz-card biz-brand" variants={riseIn} style={{ '--a': a, '--b': b }}>
                      <span className="biz-brand-halo" aria-hidden="true" style={{ background: grad(a, b) }} />
                      <span className="biz-brand-mark" style={{ background: grad(a, b) }}>
                        <span className="biz-brand-mono">{mono}</span>
                        <span className="biz-brand-icon"><Icon width={15} height={15} /></span>
                      </span>
                      <div className="biz-brand-name">{name}</div>
                      <div className="biz-brand-role">{t(`biz.brand.${id}`)}</div>
                      <span className="biz-brand-tag">{t(`biz.brandTag.${id}`)}</span>
                    </motion.div>
                  ))}
                </motion.div>
                <div className="biz-card biz-trust-card">
                  <p className="biz-label biz-label--card">{t('biz.trust.title')}</p>
                  <div className="biz-trust-grid">
                    <div className="biz-trust-item" style={{ '--a': '#00e5ff', '--b': '#7c4dff' }}>
                      <span className="biz-trust-icon" style={{ background: grad('#00e5ff', '#7c4dff') }}><IconLock width={18} height={18} /></span>
                      <div><strong>{t('biz.trust.nonCustodial.title')}</strong><p>{t('biz.trust.nonCustodial.body')}</p></div>
                    </div>
                    <div className="biz-trust-item" style={{ '--a': '#ffb300', '--b': '#ff5a3a' }}>
                      <span className="biz-trust-icon" style={{ background: grad('#ffb300', '#ff5a3a') }}><IconBuilding width={18} height={18} /></span>
                      <div><strong>{t('biz.trust.company.title')}</strong><p>{t('biz.trust.company.body')}</p></div>
                    </div>
                    <div className="biz-trust-item" style={{ '--a': '#00ff9d', '--b': '#00b8ff' }}>
                      <span className="biz-trust-icon" style={{ background: grad('#00ff9d', '#00b8ff') }}><IconMail width={18} height={18} /></span>
                      <div><strong>{t('biz.trust.response.title')}</strong><p>{t('biz.trust.response.body')}</p></div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ===== Request — the form, and only the form ===== */}
            {activeTab === 'request' && (
              <>
                {/* Intro — in plain language, what submitting actually does */}
                <div className="biz-card biz-intro-card">
                  <div className="biz-intro-head">
                    <span className="biz-intro-badge"><IconShield width={13} height={13} />{t('biz.requestsIntroLabel')}</span>
                    <h3 className="biz-intro-title">{t('biz.requestsIntro.title')}</h3>
                  </div>
                  <p className="biz-intro-body">{t('biz.requestsIntro.body')}</p>
                  <ol className="biz-intro-steps">
                    {INTRO_STEPS.map((key, index) => (
                      <li key={key} className="biz-intro-step">
                        <span className="biz-intro-num" aria-hidden="true">{num(index + 1, locale)}</span>
                        <span className="biz-intro-step-text">{t(`biz.requestsIntro.${key}`)}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="biz-intro-trust">
                    <span className="biz-intro-trust-item"><IconLock width={12} height={12} />{t('biz.trust.noStorage')}</span>
                    <span className="biz-intro-trust-item"><IconShield width={12} height={12} />{t('biz.trust.noDeposit')}</span>
                    <span className="biz-intro-trust-item"><IconClock width={12} height={12} />{t('biz.trust.humanReply')}</span>
                  </div>
                </div>

                {/*
                  The form itself, always on screen. There is no «new request»
                  toggle any more: a tab called Request whose content is a
                  button that reveals a form is one tap of theatre around the
                  only thing this panel does.
                */}
                <motion.form
                  ref={formRef} id={`${uid}-form`} noValidate
                  className="biz-card biz-form-card"
                  onSubmit={submitBusiness}
                  aria-labelledby={`${uid}-formtitle`}
                  variants={riseIn} initial="hidden" animate="show"
                  style={{ '--a': activeOffer.a, '--b': activeOffer.b }}
                >
                  <div className="biz-form-head">
                    <span className="biz-form-icon" style={{ background: grad(activeOffer.a, activeOffer.b) }}>
                      <IconMail width={20} height={20} />
                    </span>
                    <div className="biz-form-heading">
                      <h3 className="biz-form-title" id={`${uid}-formtitle`}>{t('biz.newRequest')}</h3>
                      <span className="biz-form-kicker">{t(`biz.offer.${interest}.title`)}</span>
                    </div>
                  </div>
                  <p className="biz-form-desc">{t('biz.form.description')}</p>

                  <span className="biz-field-label" id={`${uid}-topic-label`}>{t('biz.form.topic')}</span>
                  <div className="biz-topic-pills" role="group" aria-labelledby={`${uid}-topic-label`}>
                    {OFFERS.map((o) => (
                      <button
                        key={o.id} type="button" aria-pressed={interest === o.id}
                        className={`biz-topic-pill${interest === o.id ? ' is-active' : ''}`}
                        onClick={() => { setInterest(o.id); haptic?.('light'); }}
                        style={{ '--a': o.a, '--b': o.b }}
                      >
                        <o.Icon width={15} height={15} />{t(`biz.offer.${o.id}.title`)}
                      </button>
                    ))}
                  </div>

                  <div className="biz-field-row">
                    <label className="biz-field" htmlFor={`${uid}-company`}>
                      <span className="biz-field-label">{t('biz.form.company')} *</span>
                      <input
                        id={`${uid}-company`} className={`biz-input${errors.company ? ' is-invalid' : ''}`}
                        value={form.company} onChange={(e) => setField('company', e.target.value)}
                        placeholder={t('biz.form.companyPlaceholder')} autoComplete="organization"
                        aria-invalid={Boolean(errors.company)}
                        aria-describedby={errors.company ? `${uid}-company-err` : undefined}
                      />
                      {errors.company && <span className="biz-field-error" id={`${uid}-company-err`}>{errors.company}</span>}
                    </label>
                    <label className="biz-field" htmlFor={`${uid}-name`}>
                      <span className="biz-field-label">{t('biz.form.name')} *</span>
                      <input
                        id={`${uid}-name`} className={`biz-input${errors.name ? ' is-invalid' : ''}`}
                        value={form.name} onChange={(e) => setField('name', e.target.value)}
                        placeholder={t('biz.form.namePlaceholder')} autoComplete="name"
                        aria-invalid={Boolean(errors.name)}
                        aria-describedby={errors.name ? `${uid}-name-err` : undefined}
                      />
                      {errors.name && <span className="biz-field-error" id={`${uid}-name-err`}>{errors.name}</span>}
                    </label>
                  </div>
                  <div className="biz-field-row">
                    <label className="biz-field" htmlFor={`${uid}-email`}>
                      <span className="biz-field-label">{t('biz.form.workEmail')} *</span>
                      <input
                        id={`${uid}-email`} className={`biz-input${errors.email ? ' is-invalid' : ''}`}
                        type="email" inputMode="email" dir="ltr" spellCheck="false"
                        value={form.email} onChange={(e) => setField('email', e.target.value)}
                        placeholder={t('biz.form.workEmailPlaceholder')} autoComplete="email"
                        aria-invalid={Boolean(errors.email)}
                        aria-describedby={errors.email ? `${uid}-email-err` : undefined}
                      />
                      {errors.email && <span className="biz-field-error" id={`${uid}-email-err`}>{errors.email}</span>}
                    </label>
                    <label className="biz-field" htmlFor={`${uid}-phone`}>
                      <span className="biz-field-label">{t('biz.form.phoneOptional')}</span>
                      <input
                        id={`${uid}-phone`} className="biz-input" type="tel" inputMode="tel" dir="ltr"
                        value={form.phone} onChange={(e) => setField('phone', e.target.value)}
                        placeholder={t('biz.form.phonePlaceholder')} autoComplete="tel"
                      />
                    </label>
                  </div>
                  <label className="biz-field" htmlFor={`${uid}-message`}>
                    <span className="biz-field-label">
                      {t('biz.form.message')} *
                      <span className="biz-counter">
                        {t('biz.form.chars', { count: num(form.message.length, locale), max: num(MESSAGE_MAX, locale) })}
                      </span>
                    </span>
                    <textarea
                      id={`${uid}-message`} className={`biz-textarea${errors.message ? ' is-invalid' : ''}`}
                      value={form.message} onChange={(e) => setField('message', e.target.value.slice(0, MESSAGE_MAX))}
                      placeholder={t('biz.form.messagePlaceholder')} rows={4}
                      aria-invalid={Boolean(errors.message)}
                      aria-describedby={errors.message ? `${uid}-message-err` : undefined}
                    />
                    {errors.message && <span className="biz-field-error" id={`${uid}-message-err`}>{errors.message}</span>}
                  </label>

                  <button
                    type="submit" className="biz-btn biz-btn--primary biz-btn--full" disabled={sending}
                    style={{ background: grad(activeOffer.a, activeOffer.b) }}
                  >
                    <IconMail width={17} height={17} />
                    {sending ? t('biz.form.preparing') : t('biz.form.submit', { topic: t(`biz.offer.${interest}.title`) })}
                  </button>

                  <div className="biz-form-tags">
                    <button type="button" className="biz-tag" onClick={() => openUrl(SUPPORT_MAILTO)}>
                      <IconMail width={14} height={14} /><span dir="ltr">{SUPPORT_EMAIL}</span>
                    </button>
                    <button type="button" className="biz-tag" onClick={() => openLink(SITE_URL)}>
                      <IconGlobe width={14} height={14} /><span dir="ltr">{SITE_URL.replace(/^https:\/\//, '')}</span>
                    </button>
                  </div>
                  <p className="biz-form-note"><IconLock width={12} height={12} />{t('biz.form.privacy')}</p>
                  <p className="biz-form-note biz-form-note--muted">{t('biz.form.responseTime')}</p>
                </motion.form>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* ---------------- Company ---------------- */}
        <motion.section className="biz-card biz-company" variants={riseIn} initial="hidden" animate="show">
          <p className="biz-label biz-label--card">{t('biz.company')}</p>
          <div className="biz-company-row">
            <span className="biz-company-icon" style={{ background: grad('#00e5ff', '#7c4dff') }}><IconBuilding width={20} height={20} /></span>
            <div className="biz-company-body">
              <div className="biz-company-eyebrow">{t('about.company')}</div>
              <div className="biz-company-name">{t('about.companyFull')}</div>
              <div className="biz-company-tagline">{t('about.tagline')}</div>
            </div>
          </div>
          <button type="button" className="biz-company-row biz-company-row--link" onClick={() => openLink(SITE_URL)}>
            <span className="biz-company-icon" style={{ background: grad('#00ff9d', '#00b8ff') }}><IconGlobe width={20} height={20} /></span>
            <span className="biz-company-body">
              <span className="biz-company-eyebrow">{t('biz.website')}</span>
              <span className="biz-company-name biz-company-name--mono" dir="ltr">{SITE_URL.replace(/^https:\/\//, '')}</span>
            </span>
            <IconExternal width={17} height={17} className="biz-company-arrow" />
          </button>
          <button type="button" className="biz-company-row biz-company-row--link" onClick={() => openUrl(SUPPORT_MAILTO)}>
            <span className="biz-company-icon" style={{ background: grad('#ff2d95', '#ffb300') }}><IconMail width={20} height={20} /></span>
            <span className="biz-company-body">
              <span className="biz-company-eyebrow">{t('biz.contact')}</span>
              <span className="biz-company-name biz-company-name--mono" dir="ltr">{SUPPORT_EMAIL}</span>
            </span>
            <IconExternal width={17} height={17} className="biz-company-arrow" />
          </button>
        </motion.section>

        <motion.p className="biz-notice" variants={riseIn} initial="hidden" animate="show">{t('biz.notice')}</motion.p>

        <motion.div className="biz-footer-actions" variants={riseIn} initial="hidden" animate="show">
          <button type="button" className="biz-btn biz-btn--ghost" onClick={() => navigate('/contact')}>
            <IconMail width={17} height={17} />{t('contact.title')}
          </button>
          <button type="button" className="biz-btn biz-btn--ghost" onClick={() => navigate('/about')}>
            <IconBuilding width={17} height={17} />{t('about.title')}
          </button>
        </motion.div>
      </div>
    </PageTransition>
  );
}
