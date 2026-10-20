import { useId, useRef, useState } from 'react';
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
  IconX,
  IconShield,
  IconActivity,
  IconExternal,
  IconBriefcase,
  IconChart,
  IconBank,
  IconCard,
  IconCoins,
  IconPlus,
  IconRocket,
  IconTrophy,
  IconClock,
  IconLock,
  IconSparkle
} from '../components/Icons';
import { openUrl } from '../lib/browser';
import { publicAppUrl } from '../lib/nativeShell';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../lib/contact';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { NETWORK_REGISTRY } from '../lib/ecosystemData';
import { FEE_BPS, feePercentString } from '../lib/feeBps.js';
import '../styles/docs-modern.css';
import '../styles/business-modern.css';

const SITE_URL = publicAppUrl('');

/* ------------------------------------------------------------------ data */
const OFFERS = [
  { id: 'listing', Icon: IconTrend, a: '#00e5ff', b: '#7c4dff' },
  { id: 'liquidity', Icon: IconPools, a: '#00ff9d', b: '#00b8ff' },
  { id: 'whitelabel', Icon: IconBuilding, a: '#b06bff', b: '#ff2d95' },
  { id: 'integration', Icon: IconKey, a: '#ffb300', b: '#ff5a3a' }
];

const TABS = [
  { id: 'partnership', Icon: IconBriefcase, a: '#00e5ff', b: '#7c4dff' },
  { id: 'followup', Icon: IconActivity, a: '#ff2d95', b: '#7c4dff' }
];

const SUBTABS = {
  partnership: [
    { id: 'services', Icon: IconTrend, a: '#00e5ff', b: '#7c4dff' },
    { id: 'brands', Icon: IconBuilding, a: '#b06bff', b: '#ff2d95' }
  ],
  followup: [
    { id: 'requests', Icon: IconMail, a: '#ff2d95', b: '#ff8a3a' },
    { id: 'tracking', Icon: IconChart, a: '#00ff9d', b: '#00e5ff' }
  ]
};

const STATUS_CFG = {
  pending: { labelKey: 'biz.status.pending', color: '#ffb300', progress: 0.34 },
  review: { labelKey: 'biz.status.review', color: '#00c8ff', progress: 0.67 },
  responded: { labelKey: 'biz.status.responded', color: '#00d68f', progress: 1 }
};

/* Demo requests — every visible string comes from i18n (biz.demo.*). */
const REQUESTS = [
  { id: 'r1', companyKey: 'biz.demo.arta', topic: 'listing', status: 'responded', timeKey: 'biz.demo.hoursAgo', timeCount: 2 },
  { id: 'r2', companyKey: 'biz.demo.noor', topic: 'liquidity', status: 'review', timeKey: 'biz.demo.hoursAgo', timeCount: 14 },
  { id: 'r3', companyKey: 'biz.demo.bitplus', topic: 'whitelabel', status: 'pending', timeKey: 'biz.demo.daysAgo', timeCount: 3 }
];

const BRANDS = [
  { id: 'fbt', name: 'FBT Swap', mono: 'F', Icon: IconBank, a: '#00e5ff', b: '#7c4dff' },
  { id: 'solana', name: 'Solana', mono: 'S', Icon: IconRocket, a: '#9945ff', b: '#14f195' },
  { id: 'ethereum', name: 'Ethereum', mono: 'E', Icon: IconTrophy, a: '#627eea', b: '#a6b9ff' },
  { id: 'polygon', name: 'Polygon', mono: 'P', Icon: IconCard, a: '#8247e5', b: '#c4a6ff' },
  { id: 'bnb', name: 'BNB Chain', mono: 'B', Icon: IconCoins, a: '#f0b90b', b: '#ffd94d' },
  { id: 'arbitrum', name: 'Arbitrum', mono: 'A', Icon: IconLock, a: '#28a0f0', b: '#7cc7ff' }
];

const grad = (a, b) => `linear-gradient(135deg, ${a}, ${b})`;

function localizedFee(locale) {
  return new Intl.NumberFormat(locale || 'en', { style: 'percent', maximumFractionDigits: 2 }).format(FEE_BPS / 10_000);
}
function num(value, locale) {
  return new Intl.NumberFormat(locale || 'en').format(value);
}
function pct(value, locale) {
  return new Intl.NumberFormat(locale || 'en', { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

/* Arrow-key navigation for a roving-tabindex tablist. */
function onTabListKeyDown(event, items, activeId, onPick) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
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
    requestAnimationFrame(() => document.getElementById(event.currentTarget.dataset.tablistId + '-' + item.id)?.focus());
  }
}

export default function Business() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const uid = useId().replace(/[:]/g, '');
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const feeNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(feePercentString(FEE_BPS)));
  const feeLabel = localizedFee(locale);
  const networkCount = NETWORK_REGISTRY.length;
  const evmNetworkCount = NETWORK_REGISTRY.filter((n) => n.type === 'EVM').length;
  const respondedCount = REQUESTS.filter((r) => r.status === 'responded').length;

  const [activeTab, setActiveTab] = useState('partnership');
  const [activeSubTab, setActiveSubTab] = useState('services');
  const [interest, setInterest] = useState('listing');
  const [openRequest, setOpenRequest] = useState(false);
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', message: '' });
  const [sending, setSending] = useState(false);
  const formRef = useRef(null);

  const subTabs = SUBTABS[activeTab] || [];
  const activeOffer = OFFERS.find((o) => o.id === interest) || OFFERS[0];

  const pickTab = (tab) => {
    setActiveTab(tab.id);
    setActiveSubTab(SUBTABS[tab.id][0].id);
    haptic?.('light');
  };
  const pickSubTab = (st) => { setActiveSubTab(st.id); haptic?.('light'); };

  const openLink = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  /* Selecting a service jumps to the request form — and actually opens it. */
  const startRequest = (offerId) => {
    setInterest(offerId);
    setActiveTab('followup');
    setActiveSubTab('requests');
    setOpenRequest(true);
    haptic?.('light');
    requestAnimationFrame(() => setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 260));
  };

  const setField = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submitBusiness = () => {
    if (!form.company.trim() || !form.name.trim() || !form.email.trim() || !form.message.trim()) {
      useAppStore.getState().notify(t('biz.form.requiredError'), 'error');
      haptic?.('error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      useAppStore.getState().notify(t('biz.form.emailError'), 'error');
      haptic?.('error');
      return;
    }
    setSending(true);
    haptic?.('light');
    const subject = encodeURIComponent(`[Business] ${interest} — ${form.company}`);
    const body = encodeURIComponent(t('biz.form.emailBody', {
      company: form.company, name: form.name, email: form.email,
      phone: form.phone || '—', topic: t(`biz.offer.${interest}.title`), message: form.message
    }));
    const mailto = `${SUPPORT_MAILTO}?subject=${subject}&body=${body}`;
    if (tg?.openLink) tg.openLink(mailto);
    else window.location.href = mailto;
    setTimeout(() => {
      setSending(false);
      setOpenRequest(false);
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
          <span className="biz-pill"><IconSparkle width={11} height={11} />{t('biz.badge')}</span>
        </motion.header>

        {/* ---------------- Hero ---------------- */}
        <motion.section className="biz-hero" variants={riseIn} initial="hidden" animate="show">
          <div className="biz-hero-glow" aria-hidden="true" />
          <span className="biz-hero-kicker"><IconBriefcase width={13} height={13} />{t('about.companyFull')}</span>
          <h2 className="biz-hero-title">{t('biz.title')}</h2>
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
        </motion.section>

        {/* ---------------- Stats ---------------- */}
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
                  {active && <motion.span className="biz-tab-pill" layoutId={`${uid}-tabpill`} style={{ background: grad(tab.a, tab.b) }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="biz-tab-inner">
                    <tab.Icon width={20} height={20} />
                    <span className="biz-tab-text">
                      <span className="biz-tab-name">{t(`biz.tabs.${tab.id}`)}</span>
                      <span className="biz-tab-hint">{t(`biz.tabsSub.${tab.id}`)}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ---------------- Sub-tabs (2 per tab) ---------------- */}
        <motion.div variants={riseIn} initial="hidden" animate="show">
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
                  {active && <motion.span className="biz-subtab-pill" layoutId={`${uid}-subpill`} style={{ background: grad(st.a, st.b) }} transition={{ type: 'spring', stiffness: 480, damping: 36 }} />}
                  <span className="biz-subtab-inner"><st.Icon width={16} height={16} />{t(`biz.subtab.${st.id}`)}</span>
                </button>
              );
            })}
            <span className="biz-panel-hint">{t(`biz.panelHint.${activeSubTab}`)}</span>
          </div>
        </motion.div>

        {/* ---------------- Panels (4 views) ---------------- */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeTab}/${activeSubTab}`}
            id={panelId} role="tabpanel"
            aria-labelledby={`${uid}-sub-${activeSubTab}`}
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
                  {OFFERS.map(({ id, Icon, a, b }) => (
                    <motion.article key={id} className="biz-card biz-offer" variants={riseIn} style={{ '--a': a, '--b': b }}>
                      <span className="biz-offer-icon" style={{ background: grad(a, b) }}><Icon width={24} height={24} /></span>
                      <h3 className="biz-offer-title">{t(`biz.offer.${id}.title`)}</h3>
                      <p className="biz-offer-text">{t(`biz.offer.${id}.body`)}</p>
                      <span className="biz-offer-meta"><IconCheck width={12} height={12} />{t(`biz.offerMeta.${id}`)}</span>
                      <button type="button" className="biz-offer-cta" onClick={() => startRequest(id)}>
                        {t('biz.selectTopic')}
                        <IconChevronLeft width={14} height={14} className="biz-flip biz-cta-arrow" />
                      </button>
                    </motion.article>
                  ))}
                </motion.div>

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
                    <motion.div key={id} className="biz-brand" variants={riseIn} style={{ '--a': a, '--b': b }}>
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
              </>
            )}

            {/* ===== Follow-up / Requests ===== */}
            {activeTab === 'followup' && activeSubTab === 'requests' && (
              <>
                <div className="biz-row-head">
                  <div>
                    <p className="biz-label">{t('biz.requestsTitle')}</p>
                    <p className="biz-lead biz-lead--inline">{t('biz.requestsSub')}</p>
                  </div>
                  <button type="button" className="biz-btn biz-btn--primary biz-btn--sm" onClick={() => { setOpenRequest((v) => !v); haptic?.('light'); }}>
                    <IconPlus width={16} height={16} />{t('biz.newRequest')}
                  </button>
                </div>

                <motion.div className="biz-request-list" variants={stagger} initial="hidden" animate="show">
                  {REQUESTS.map((r) => {
                    const s = STATUS_CFG[r.status];
                    const OfferIcon = (OFFERS.find((o) => o.id === r.topic) || OFFERS[0]).Icon;
                    const company = t(r.companyKey);
                    return (
                      <motion.article key={r.id} className="biz-request" variants={riseIn} style={{ '--status': s.color }}>
                        <span className="biz-request-avatar" style={{ background: grad(s.color, '#7c4dff') }}>{company.slice(0, 1)}</span>
                        <div className="biz-request-meta">
                          <div className="biz-request-topic">
                            <OfferIcon width={14} height={14} className="biz-request-topic-icon" />
                            {t(`biz.offer.${r.topic}.title`)} · {company}
                          </div>
                          <div className="biz-request-kind">{t('biz.requests.kind')}</div>
                          <div className="biz-progress" role="progressbar" aria-label={t('biz.progress.label')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)}>
                            <motion.span className="biz-progress-fill" style={{ background: grad(s.color, '#7c4dff') }} initial={{ width: 0 }} animate={{ width: `${s.progress * 100}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                          </div>
                        </div>
                        <div className="biz-request-side">
                          <span className="biz-chip-status">{t(s.labelKey)}</span>
                          <span className="biz-request-time">{t(r.timeKey, { count: num(r.timeCount, locale) })}</span>
                        </div>
                      </motion.article>
                    );
                  })}
                </motion.div>

                <button type="button" className="biz-link-row" onClick={() => pickSubTab(SUBTABS.followup[1])}>
                  <IconChart width={16} height={16} />{t('biz.viewTracking')}
                  <IconChevronLeft width={15} height={15} className="biz-flip" />
                </button>

                <AnimatePresence initial={false}>
                  {openRequest && (
                    <motion.div
                      ref={formRef}
                      className="biz-card biz-form-card"
                      initial={{ opacity: 0, y: 16, scale: 0.99 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.99 }}
                      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                      style={{ '--a': activeOffer.a, '--b': activeOffer.b }}
                    >
                      <div className="biz-form-head">
                        <span className="biz-form-icon" style={{ background: grad(activeOffer.a, activeOffer.b) }}><IconMail width={20} height={20} /></span>
                        <h3 className="biz-form-title">{t('biz.newRequest')}</h3>
                        <button type="button" className="biz-icon-btn" onClick={() => setOpenRequest(false)} aria-label={t('biz.form.close')}>
                          <IconX width={17} height={17} />
                        </button>
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
                          <input id={`${uid}-company`} className="biz-input" value={form.company} onChange={(e) => setField('company', e.target.value)} placeholder={t('biz.form.companyPlaceholder')} autoComplete="organization" />
                        </label>
                        <label className="biz-field" htmlFor={`${uid}-name`}>
                          <span className="biz-field-label">{t('biz.form.name')} *</span>
                          <input id={`${uid}-name`} className="biz-input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('biz.form.namePlaceholder')} autoComplete="name" />
                        </label>
                      </div>
                      <div className="biz-field-row">
                        <label className="biz-field" htmlFor={`${uid}-email`}>
                          <span className="biz-field-label">{t('biz.form.workEmail')} *</span>
                          <input id={`${uid}-email`} className="biz-input" type="email" inputMode="email" dir="ltr" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="name@company.com" autoComplete="email" />
                        </label>
                        <label className="biz-field" htmlFor={`${uid}-phone`}>
                          <span className="biz-field-label">{t('biz.form.phoneOptional')}</span>
                          <input id={`${uid}-phone`} className="biz-input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder={t('biz.form.phonePlaceholder')} autoComplete="tel" />
                        </label>
                      </div>
                      <label className="biz-field" htmlFor={`${uid}-message`}>
                        <span className="biz-field-label">{t('biz.form.message')} *</span>
                        <textarea id={`${uid}-message`} className="biz-textarea" value={form.message} onChange={(e) => setField('message', e.target.value)} placeholder={t('biz.form.messagePlaceholder')} rows={4} />
                      </label>

                      <button type="button" className="biz-btn biz-btn--primary biz-btn--full" disabled={sending} onClick={submitBusiness} style={{ background: grad(activeOffer.a, activeOffer.b) }}>
                        <IconMail width={17} height={17} />
                        {sending ? t('biz.form.preparing') : t('biz.form.submit', { topic: t(`biz.offer.${interest}.title`) })}
                      </button>
                      <button type="button" className="biz-btn biz-btn--ghost biz-btn--full" onClick={() => setOpenRequest(false)}>
                        {t('biz.form.cancel')}
                      </button>

                      <div className="biz-form-tags">
                        <button type="button" className="biz-tag" onClick={() => openUrl(SUPPORT_MAILTO)}><IconMail width={14} height={14} /><span dir="ltr">{SUPPORT_EMAIL}</span></button>
                        <button type="button" className="biz-tag" onClick={() => openLink(SITE_URL)}><IconGlobe width={14} height={14} /><span dir="ltr">{SITE_URL.replace(/^https:\/\//, '')}</span></button>
                      </div>
                      <p className="biz-form-note">{t('biz.form.responseTime')}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* ===== Follow-up / Tracking ===== */}
            {activeTab === 'followup' && activeSubTab === 'tracking' && (
              <>
                <p className="biz-label">{t('biz.trackingTitle')}</p>
                <p className="biz-lead">{t('biz.trackingSub')}</p>

                <div className="biz-card biz-progress-card">
                  <div className="biz-progress-head">
                    <span className="biz-progress-title">{t('biz.tracking.progressLabel')}</span>
                    <span className="biz-progress-value">{pct(2 / 3, locale)}</span>
                  </div>
                  <div className="biz-progress biz-progress--lg" role="progressbar" aria-label={t('biz.tracking.progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={67}>
                    <motion.span className="biz-progress-fill" initial={{ width: 0 }} animate={{ width: '67%' }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                  <p className="biz-progress-sub">{t('biz.tracking.progressSub')}</p>
                </div>

                <motion.div className="biz-stats biz-stats--tracking" variants={stagger} initial="hidden" animate="show">
                  {[
                    { Icon: IconMail, a: '#ff2d95', b: '#ff8a3a', value: num(REQUESTS.length, locale), label: t('biz.tracking.totalRequests'), sub: t('biz.tracking.totalSub') },
                    { Icon: IconCheck, a: '#00ff9d', b: '#00b8ff', value: num(respondedCount, locale), label: t('biz.tracking.responded'), sub: t('biz.tracking.respondedSub') },
                    { Icon: IconClock, a: '#00e5ff', b: '#7c4dff', value: t('biz.stats.alwaysOpen.value'), label: t('biz.tracking.support'), sub: t('biz.tracking.supportSub') }
                  ].map(({ Icon, a, b, value, label, sub }) => (
                    <motion.div key={label} className="biz-stat" variants={riseIn} style={{ '--a': a, '--b': b }}>
                      <span className="biz-stat-icon" style={{ background: grad(a, b) }}><Icon width={17} height={17} /></span>
                      <div className="biz-stat-value">{value}</div>
                      <div className="biz-stat-label">{label}</div>
                      <div className="biz-stat-sub">{sub}</div>
                    </motion.div>
                  ))}
                </motion.div>

                <div className="biz-card biz-timeline-card">
                  <p className="biz-label biz-label--card">{t('biz.tracking.pathTitle')}</p>
                  <motion.ol className="biz-timeline" variants={stagger} initial="hidden" animate="show">
                    {[
                      { id: 'conversation', done: true },
                      { id: 'proposal', done: true },
                      { id: 'launch', done: false }
                    ].map((step, index) => (
                      <motion.li key={step.id} className={`biz-step${step.done ? ' is-done' : ''}`} variants={riseIn}>
                        <span className="biz-step-marker">{step.done ? <IconCheck width={15} height={15} /> : num(index + 1, locale)}</span>
                        <div className="biz-step-body">
                          <h3 className="biz-step-title">{t(`biz.steps.${step.id}.title`)}</h3>
                          <p className="biz-step-desc">{t(`biz.steps.${step.id}.description`)}</p>
                        </div>
                        <span className={`biz-step-state${step.done ? ' is-done' : ''}`}>
                          {step.done ? <IconCheck width={13} height={13} /> : <IconClock width={13} height={13} />}
                          {step.done ? t('biz.progress.done') : t('biz.status.pending')}
                        </span>
                      </motion.li>
                    ))}
                  </motion.ol>
                  <button type="button" className="biz-btn biz-btn--primary biz-btn--full" onClick={() => startRequest(interest)}>
                    <IconPlus width={17} height={17} />{t('biz.tracking.cta')}
                  </button>
                </div>
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
