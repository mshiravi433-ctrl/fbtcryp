import { useState } from 'react';
import { motion } from 'framer-motion';
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
  IconPlus,
  IconRocket,
  IconTrophy,
  IconClock,
  IconLock
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

const OFFERS = [
  { id: 'listing', Icon: IconTrend, hue: 'var(--rgb-1)', gradient: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))' },
  { id: 'liquidity', Icon: IconPools, hue: 'var(--rgb-4)', gradient: 'linear-gradient(135deg, #00ff9d, #00e5ff)' },
  { id: 'whitelabel', Icon: IconBuilding, hue: 'var(--rgb-2)', gradient: 'linear-gradient(135deg, #7c4dff, #00e5ff)' },
  { id: 'integration', Icon: IconKey, hue: 'var(--rgb-5)', gradient: 'linear-gradient(135deg, #ffb300, #ff5a3a)' }
];

const TABS = [
  { id: 'partnership', Icon: IconBriefcase, labelKey: 'biz.tabs.partnership', hue: 'var(--rgb-1)', gradient: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', glow: 'rgba(0,229,255,0.42)' },
  { id: 'followup', Icon: IconActivity, labelKey: 'biz.tabs.followup', hue: 'var(--rgb-3)', gradient: 'linear-gradient(135deg, var(--rgb-3), var(--rgb-4))', glow: 'rgba(255,45,149,0.42)' }
];

const SUBTABS = {
  partnership: [
    { id: 'services', Icon: IconTrend, labelKey: 'biz.subtab.services', a: 'var(--rgb-1)', b: 'var(--rgb-2)' },
    { id: 'brands', Icon: IconBuilding, labelKey: 'biz.subtab.brands', a: 'var(--rgb-2)', b: 'var(--rgb-3)' }
  ],
  followup: [
    { id: 'requests', Icon: IconMail, labelKey: 'biz.subtab.requests', a: 'var(--rgb-3)', b: 'var(--rgb-4)' },
    { id: 'tracking', Icon: IconChart, labelKey: 'biz.subtab.tracking', a: 'var(--rgb-4)', b: 'var(--rgb-1)' }
  ]
};

const STATUS_CFG = {
  pending: { labelKey: 'biz.status.pending', bg: 'rgba(255,179,0,0.13)', text: '#ffb300', border: 'rgba(255,179,0,0.34)' },
  review: { labelKey: 'biz.status.review', bg: 'rgba(0,229,255,0.13)', text: '#00e5ff', border: 'rgba(0,229,255,0.34)' },
  responded: { labelKey: 'biz.status.responded', bg: 'rgba(0,255,157,0.13)', text: '#00ff9d', border: 'rgba(0,255,157,0.34)' }
};

const REQUESTS = [
  { id: 'r1', company: 'آرتا کوین', topic: 'listing', status: 'responded', time: '۲ ساعت قبل' },
  { id: 'r2', company: 'نور دیجیتال', topic: 'liquidity', status: 'review', time: '۱۴ ساعت قبل' },
  { id: 'r3', company: 'بیت پلس', topic: 'whitelabel', status: 'pending', time: '۳ روز قبل' }
];

const BRANDS = [
  { id: 'fbt', name: 'FBT Swap', role: 'biz.brand.fbt', Icon: IconBank, hue: 'var(--rgb-1)' },
  { id: 'solana', name: 'Solana', role: 'biz.brand.solana', Icon: IconRocket, hue: 'var(--rgb-4)' },
  { id: 'ethereum', name: 'Ethereum', role: 'biz.brand.ethereum', Icon: IconTrophy, hue: 'var(--rgb-2)' },
  { id: 'polygon', name: 'Polygon', role: 'biz.brand.polygon', Icon: IconCard, hue: 'var(--rgb-3)' },
  { id: 'bnb', name: 'BNB Chain', role: 'biz.brand.bnb', Icon: IconCoins, hue: 'var(--rgb-5)' },
  { id: 'arbitrum', name: 'Arbitrum', role: 'biz.brand.arbitrum', Icon: IconLock, hue: 'var(--rgb-4)' }
];

function localizedFee(locale) {
  return new Intl.NumberFormat(locale || 'en', { style: 'percent', maximumFractionDigits: 2 }).format(FEE_BPS / 10_000);
}

function localizedCount(value, locale) {
  return new Intl.NumberFormat(locale || 'en').format(value);
}

export default function Business() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const feeNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(feePercentString(FEE_BPS)));
  const feeLabel = localizedFee(locale);
  const networkCount = NETWORK_REGISTRY.length;
  const evmNetworkCount = NETWORK_REGISTRY.filter((network) => network.type === 'EVM').length;

  const [activeTab, setActiveTab] = useState('partnership');
  const [activeSubTab, setActiveSubTab] = useState('services');
  const [interest, setInterest] = useState('listing');
  const [openRequest, setOpenRequest] = useState(false);
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', message: '' });
  const [sending, setSending] = useState(false);

  const subTabs = SUBTABS[activeTab] || [];
  const subTab = subTabs.find((s) => s.id === activeSubTab) || subTabs[0];

  const openLink = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
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
    const body = encodeURIComponent(
      t('biz.form.emailBody', {
        company: form.company,
        name: form.name,
        email: form.email,
        phone: form.phone || '—',
        topic: t(`biz.offer.${interest}.title`),
        message: form.message
      })
    );
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

  const tabItem = TABS.find((t) => t.id === activeTab);
  const tabGlow = tabItem ? tabItem.glow : 'rgba(0,229,255,0.42)';

  return (
    <PageTransition className="page biz-page">
      <div className="biz-shell">
        <div className="biz-orb a" />
        <div className="biz-orb b" />
        <div className="biz-surface">
          {/* Header */ }
          <motion.div className="biz-header" variants={riseIn} initial="hidden" animate="show">
            <button className="biz-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
              <IconChevronLeft width={18} height={18} />
            </button>
            <h1 className="biz-title">{t('biz.title')}</h1>
            <span className="biz-pill">B2B</span>
          </motion.div>

          {/* Hero */}
          <motion.section className="biz-hero" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
            <div className="biz-hero-kicker">
              <IconBriefcase width={13} height={13} style={{ flexShrink: 0 }} /> {t('about.companyFull')}
            </div>
            <div className="biz-hero-title">{t('biz.title')}</div>
            <p className="biz-hero-sub">{t('biz.intro')}</p>
            <div className="biz-hero-actions">
              <button className="btn btn-primary" style={{ flex: '1 1 170px', minHeight: 48, gap: 9 }} onClick={() => document.getElementById('biz-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <IconBriefcase width={16} height={16} /> {t('biz.requestPartnership')}
              </button>
              <button className="btn btn-ghost" style={{ flex: '1 1 150px', minHeight: 48, gap: 9 }} onClick={() => openLink(SITE_URL)}>
                <IconGlobe width={16} height={16} /> {SITE_URL.replace(/^https:\/\//, '')}
              </button>
            </div>
          </motion.section>

          {/* Stats */}
          <motion.div className="biz-stats" variants={stagger} initial="hidden" animate="show">
            <div className="biz-stat">
              <div className="biz-stat-value">{t('biz.stats.networks.value', { count: localizedCount(networkCount, locale) })}</div>
              <div className="biz-stat-label">{t('biz.stats.networks.label')}</div>
              <div className="biz-stat-sub">{t('biz.stats.networks.sub', { evmCount: localizedCount(evmNetworkCount, locale) })}</div>
            </div>
            <div className="biz-stat">
              <div className="biz-stat-value">{t('biz.stats.fee.value', { fee: feeNumber })}</div>
              <div className="biz-stat-label">{t('biz.stats.fee.label')}</div>
              <div className="biz-stat-sub">{t('biz.stats.fee.sub')}</div>
            </div>
            <div className="biz-stat">
              <div className="biz-stat-value">{t('biz.stats.alwaysOpen.value')}</div>
              <div className="biz-stat-label">{t('biz.stats.alwaysOpen.label')}</div>
              <div className="biz-stat-sub">{t('biz.stats.alwaysOpen.sub')}</div>
            </div>
          </motion.div>

          {/* Main tabs */}
          <motion.div className="biz-tabs-wrap" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 4 }}>
            <div className="biz-tab-label" style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8, paddingInlineStart: 2 }}>
              {t('biz.chooseArea')}
            </div>
            <div className="biz-tabs" role="tablist" aria-label={t('biz.tabsTitle')}>
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className={`biz-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setActiveSubTab(SUBTABS[tab.id][0].id);
                    haptic?.('light');
                  }}
                  style={{ '--tab-glow': tab.glow }}
                >
                  <tab.Icon width={19} height={19} />
                  <span>{t(tab.labelKey)}</span>
                </button>
              ))}
            </div>
          </motion.div>

          {/* Sub-tabs */}
          {subTabs.length > 0 && (
            <motion.div className="biz-tabs-wrap" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 0 }}>
              <div className="biz-subtabs" role="tablist" aria-label={t('biz.subtabsTitle')}>
                {subTabs.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    role="tab"
                    aria-selected={activeSubTab === st.id}
                    tabIndex={activeSubTab === st.id ? 0 : -1}
                    className={`biz-subtab ${activeSubTab === st.id ? 'is-active' : ''}`}
                    onClick={() => {
                      setActiveSubTab(st.id);
                      haptic?.('light');
                    }}
                    style={{ '--sub-a': st.a, '--sub-b': st.b }}
                  >
                    <st.Icon width={16} height={16} />
                    <span>{t(st.labelKey)}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Panels */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.28 }}
            key={`${activeTab}/${activeSubTab}`}
            className="biz-section"
            style={{ marginTop: 6 }}
          >
            {activeTab === 'partnership' && activeSubTab === 'services' && (
              <>
                <p className="biz-section-label">{t('biz.servicesTitle')}</p>
                <motion.div className="stack" style={{ gap: 14 }} variants={stagger} initial="hidden" animate="show">
                  {OFFERS.map(({ id, Icon, hue, gradient }) => (
                    <motion.div key={id} className="biz-card biz-offer-card" variants={riseIn} style={{ '--card-hue': hue, '--offer-hue': hue }}>
                      <span className="biz-offer-icon" style={{ background: gradient }}>
                        <Icon width={24} height={24} />
                      </span>
                      <div className="biz-offer-body-flex">
                        <div className="biz-offer-title">{t(`biz.offer.${id}.title`)}</div>
                        <p className="biz-offer-text">{t(`biz.offer.${id}.body`)}</p>
                        <button
                          className="biz-offer-select"
                          onClick={() => {
                            setInterest(id);
                            setActiveTab('followup');
                            setActiveSubTab('requests');
                            document.getElementById('biz-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            haptic?.('light');
                          }}
                        >
                          {t('biz.selectTopic')} <IconChevronLeft width={12} height={12} style={{ transform: 'rotate(180deg)' }} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
                <div className="biz-card" style={{ marginTop: 16, padding: 20, '--card-hue': 'var(--rgb-2)' }}>
                  <p className="biz-section-label" style={{ marginBottom: 10 }}>{t('biz.whyUsTitle')}</p>
                  <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
                    {[
                      { id: 'nonCustodial', Icon: IconShield },
                      { id: 'integration', Icon: IconKey },
                      { id: 'revenue', Icon: IconTrend }
                    ].map((b) => (
                      <motion.div key={b.id} className="biz-card" variants={riseIn} style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start', '--card-hue': `var(--rgb-${{ nonCustodial: 1, integration: 2, revenue: 4 }[b.id]})` }}>
                        <span className="biz-offer-icon" style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, color-mix(in srgb, var(--card-hue) 20%, rgba(255,255,255,0.06)), color-mix(in srgb, var(--card-hue) 6%, transparent))`, color: `var(--card-hue)`, boxShadow: `0 8px 20px color-mix(in srgb, var(--card-hue) 20%, transparent)` }}>
                          <b.Icon width={18} height={18} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 900, fontSize: 13.5 }}>{t(`biz.benefits.${b.id}.title`)}</div>
                          <p className="muted" style={{ fontSize: 12.2, lineHeight: 1.8, margin: '3px 0 0', color: 'var(--text-2)' }}>{t(`biz.benefits.${b.id}.body`, { fee: feeLabel })}</p>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              </>
            )}

            {activeTab === 'partnership' && activeSubTab === 'brands' && (
              <>
                <p className="biz-section-label">{t('biz.brandsTitle')}</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.75, marginBottom: 14 }}>{t('biz.brandsSub')}</p>
                <div className="biz-brand-grid" variants={stagger} initial="hidden" animate="show">
                  {BRANDS.map(({ id, name, role, Icon, hue }) => (
                    <motion.div key={id} className="biz-brand" variants={riseIn} style={{ '--brand-hue': hue }}>
                      <span className="biz-brand-icon">
                        <Icon width={18} height={18} />
                      </span>
                      <div className="biz-brand-name">{name}</div>
                      <div className="biz-brand-role">{t(role)}</div>
                    </motion.div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'followup' && activeSubTab === 'requests' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div>
                    <p className="biz-section-label">{t('biz.requestsTitle')}</p>
                    <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{t('biz.requestsSub')}</p>
                  </div>
                  <button className="biz-btn-primary" style={{ width: 'auto', padding: '0 18px', fontSize: 12.5 }} onClick={() => { setOpenRequest(true); haptic?.('light'); }}>
                    <IconPlus width={16} height={16} /> {t('biz.newRequest')}
                  </button>
                </div>
                <div className="biz-request-list" variants={stagger} initial="hidden" animate="show">
                  {REQUESTS.length > 0 ? (
                    REQUESTS.map((r) => {
                      const s = STATUS_CFG[r.status];
                      return (
                        <motion.div key={r.id} className="biz-request" variants={riseIn} style={{ '--req-hue': s.text, '--req-b': s.text }}>
                          <span className="biz-request-avatar">{r.company.slice(0, 2)}</span>
                          <div className="biz-request-meta">
                            <div className="biz-request-topic">{t(`biz.offer.${r.topic}.title`)} — {r.company}</div>
                            <div className="biz-request-company">{t('biz.requests.kind')}</div>
                          </div>
                          <div className="biz-request-side">
                            <span className="biz-request-chip" style={{ background: s.bg, color: s.text, borderColor: s.border }}>{t(s.labelKey)}</span>
                            <span className="biz-request-time">{r.time}</span>
                          </div>
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="biz-empty">
                      <div className="biz-empty-icon"><IconMail width={30} height={30} /></div>
                      <div className="biz-empty-title">{t('biz.requestsEmptyTitle')}</div>
                      <div className="biz-empty-text">{t('biz.requestsEmptyText')}</div>
                    </div>
                  )}
                </div>

                {openRequest && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.25 }}
                    className="biz-card biz-form-card"
                    style={{ marginTop: 16, '--card-hue': 'var(--rgb-1)' }}
                  >
                    <div className="biz-form-head">
                      <span className="biz-form-icon"><IconMail width={20} height={20} /></span>
                      <div className="biz-form-title">{t('biz.newRequest')}</div>
                    </div>
                    <p className="biz-form-desc">{t('biz.form.description')}</p>

                    <div style={{ marginTop: 14 }}>
                      <span className="biz-field-label">{t('biz.form.topic')}</span>
                      <div className="biz-select-pills">
                        {OFFERS.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className={`biz-pill-topic ${interest === o.id ? 'is-active' : ''}`}
                            onClick={() => setInterest(o.id)}
                            style={{ gap: 7 }}
                          >
                            <o.Icon width={14} height={14} /> {t(`biz.offer.${o.id}.title`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="biz-field-row">
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span className="biz-field-label">{t('biz.form.company')} *</span>
                        <input className="biz-input" value={form.company} onChange={(e) => setField('company', e.target.value)} placeholder={t('biz.form.companyPlaceholder')} />
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span className="biz-field-label">{t('biz.form.name')} *</span>
                        <input className="biz-input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('biz.form.namePlaceholder')} />
                      </label>
                    </div>

                    <div className="biz-field-row">
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span className="biz-field-label">{t('biz.form.workEmail')} *</span>
                        <input className="biz-input" type="email" inputMode="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="name@company.com" dir="ltr" />
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span className="biz-field-label">{t('biz.form.phoneOptional')}</span>
                        <input className="biz-input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder={t('biz.form.phonePlaceholder')} />
                      </label>
                    </div>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="biz-field-label">{t('biz.form.message')} *</span>
                      <textarea className="biz-textarea" value={form.message} onChange={(e) => setField('message', e.target.value)} placeholder={t('biz.form.messagePlaceholder')} />
                    </label>

                    <button className="biz-btn-primary" disabled={sending} onClick={submitBusiness} style={{ marginTop: 4 }}>
                      <IconMail width={16} height={16} /> {sending ? t('biz.form.preparing') : t('biz.form.submit', { topic: t(`biz.offer.${interest}.title`) })}
                    </button>

                    <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                      <button className="tag" onClick={() => openUrl(SUPPORT_MAILTO)} style={{ gap: 6 }}><IconMail width={14} height={14} /> {SUPPORT_EMAIL}</button>
                      <button className="tag" onClick={() => openUrl(SITE_URL)} style={{ gap: 6 }}><IconGlobe width={14} height={14} /> {SITE_URL.replace(/^https:\/\//, '')}</button>
                    </div>
                    <p className="faint" style={{ fontSize: 11, lineHeight: 1.7, textAlign: 'center', margin: 0 }}>{t('biz.form.responseTime')}</p>
                  </motion.div>
                )}
              </>
            )}

            {activeTab === 'followup' && activeSubTab === 'tracking' && (
              <>
                <p className="biz-section-label">{t('biz.trackingTitle')}</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.75, marginBottom: 16 }}>{t('biz.trackingSub')}</p>

                <div className="biz-stats" style={{ marginBottom: 18 }}>
                  <div className="biz-stat">
                    <div className="biz-stat-value">{REQUESTS.length}</div>
                    <div className="biz-stat-label">{t('biz.tracking.totalRequests')}</div>
                    <div className="biz-stat-sub">{t('biz.tracking.totalSub')}</div>
                  </div>
                  <div className="biz-stat">
                    <div className="biz-stat-value">{REQUESTS.filter((r) => r.status === 'responded').length}</div>
                    <div className="biz-stat-label">{t('biz.tracking.responded')}</div>
                    <div className="biz-stat-sub">{t('biz.tracking.respondedSub')}</div>
                  </div>
                  <div className="biz-stat">
                    <div className="biz-stat-value">۲۴/۷</div>
                    <div className="biz-stat-label">{t('biz.tracking.support')}</div>
                    <div className="biz-stat-sub">{t('biz.tracking.supportSub')}</div>
                  </div>
                </div>

                <div className="biz-card" style={{ padding: 20, '--card-hue': 'var(--rgb-4)' }}>
                  <p className="biz-section-label" style={{ marginBottom: 12 }}>{t('biz.tracking.pathTitle')}</p>
                  <div className="biz-timeline" variants={stagger} initial="hidden" animate="show">
                    {[
                      { id: 'conversation', done: true },
                      { id: 'proposal', done: true },
                      { id: 'launch', done: false }
                    ].map((step, index) => (
                      <motion.div key={step.id} className={`biz-step ${step.done ? 'is-done' : ''}`} variants={riseIn} style={{ transition: { delay: index * 0.08 } }}>
                        <span className="biz-step-marker">{index + 1}</span>
                        <div>
                          <div className="biz-step-title">{t(`biz.steps.${step.id}.title`)}</div>
                          <div className="biz-step-desc">{t(`biz.steps.${step.id}.description`)}</div>
                        </div>
                        {step.done ? <IconCheck width={16} height={16} style={{ color: '#021215', marginTop: 2 }} /> : <IconClock width={16} height={16} style={{ color: 'var(--text-3)', marginTop: 2 }} />}
                      </motion.div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </motion.div>

          {/* Company details */}
          <motion.section className="biz-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 20, padding: 18, '--card-hue': 'var(--rgb-2)' }}>
            <p className="biz-section-label" style={{ marginBottom: 12 }}>{t('biz.company')}</p>
            <div className="info-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className="info-row-icon" style={{ width: 44, height: 44, borderRadius: 14 }}><IconBuilding width={20} height={20} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="faint">{t('about.company')}</div>
                <div style={{ fontWeight: 900, fontSize: 15, marginTop: 2 }}>{t('about.companyFull')}</div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{t('about.tagline')}</div>
              </div>
            </div>

            <button className="info-row" onClick={() => openUrl(SITE_URL)} style={{ width: '100%', background: 'none', border: 0, padding: 0, marginTop: 14, cursor: 'pointer', color: 'inherit', textAlign: 'start', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: 14, flexShrink: 0 }}><IconGlobe width={20} height={20} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="faint">{t('biz.website')}</div>
                <div className="mono" style={{ fontWeight: 800, fontSize: 13, marginTop: 2, direction: 'ltr' }}>{SITE_URL.replace(/^https:\/\//, '')}</div>
              </div>
              <IconExternal width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </button>
          </motion.section>

          <p className="biz-notice">{t('biz.notice')}</p>

          <div className="biz-footer-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1, minHeight: 46, gap: 9 }} onClick={() => navigate('/contact')}>
              <IconMail width={16} height={16} /> {t('contact.title')}
            </button>
            <button className="btn btn-ghost" style={{ flex: 1, minHeight: 46, gap: 9 }} onClick={() => navigate('/about')}>
              <IconBuilding width={16} height={16} /> {t('about.title')}
            </button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
