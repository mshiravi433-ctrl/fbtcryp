import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import {
  IconChevronLeft, IconBuilding, IconTrend, IconPools, IconKey, IconGlobe, IconMail, IconCheck, IconShield, IconActivity, IconExternal, IconUser
} from '../components/Icons';
import { openUrl } from '../lib/browser';
import { publicAppUrl } from '../lib/nativeShell';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../lib/contact';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import '../styles/docs-modern.css';

const SITE_URL = publicAppUrl('');

const OFFERS = [
  { id: 'listing', Icon: IconTrend, hue: 'var(--rgb-1)', gradient: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))' },
  { id: 'liquidity', Icon: IconPools, hue: 'var(--rgb-4)', gradient: 'linear-gradient(135deg, #00ff9d, #00e5ff)' },
  { id: 'whitelabel', Icon: IconBuilding, hue: 'var(--rgb-2)', gradient: 'linear-gradient(135deg, #7c4dff, #00e5ff)' },
  { id: 'integration', Icon: IconKey, hue: 'var(--rgb-5)', gradient: 'linear-gradient(135deg, #ffb300, #ff5a3a)' }
];

const STATS = [
  { id: 'chains', valueEn: '10', valueFa: '۱۰' },
  { id: 'fee', valueEn: '0.10%', valueFa: '۰٫۱۰٪' },
  { id: 'open', valueEn: '24/7', valueFa: '۲۴/۷' }
];

const BENEFITS = [
  { id: 'custody', Icon: IconShield, hue: 'var(--rgb-1)' },
  { id: 'api', Icon: IconKey, hue: 'var(--rgb-2)' },
  { id: 'revenue', Icon: IconTrend, hue: 'var(--rgb-4)' }
];

const STEPS = [
  { n: 1, id: 'talk' },
  { n: 2, id: 'offer' },
  { n: 3, id: 'ship' }
];

export default function Business() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const [interest, setInterest] = useState('listing');
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', message: '' });
  const [sending, setSending] = useState(false);

  const openLink = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const setField = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submitBusiness = () => {
    // simple validation
    if (!form.company.trim() || !form.name.trim() || !form.email.trim() || !form.message.trim()) {
      useAppStore.getState().notify(t('biz.form.needFields'), 'error');
      haptic?.('error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      useAppStore.getState().notify(t('biz.form.needEmail'), 'error');
      haptic?.('error');
      return;
    }
    setSending(true);
    haptic?.('light');
    const subject = encodeURIComponent(`[Business] ${interest} — ${form.company}`);
    const body = encodeURIComponent(t('biz.form.mailBody', {
      company: form.company,
      name: form.name,
      email: form.email,
      phone: form.phone || '—',
      topic: interest,
      message: form.message
    }));
    const mailto = `${SUPPORT_MAILTO}?subject=${subject}&body=${body}`;
    // open mail client
    if (tg?.openLink) tg.openLink(mailto);
    else window.location.href = mailto;

    setTimeout(() => {
      setSending(false);
      useAppStore.getState().notify(t('biz.form.ready'), 'success');
      haptic?.('success');
    }, 600);
  };

  return (
    <PageTransition>
      {/* Header */}
      <motion.div className="row" style={{ gap: 12 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 20 }}>{t('biz.title')}</h1>
        <span className="pill" style={{ marginInlineStart: 'auto', background: 'rgba(0,229,255,0.08)', borderColor: 'rgba(0,229,255,0.18)', color: 'var(--rgb-1)', fontSize: 10, fontWeight: 800 }}>B2B</span>
      </motion.div>

      {/* Hero */}
      <motion.section className="docs-hero" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1.2 }} className="gradient-text">{t('about.companyFull')}</div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: 'var(--text-3)', marginTop: 4 }}>{t('about.tagline')}</div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.9, marginTop: 10 }}>{t('biz.intro')}</p>
        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ flex: '1 1 160px', minHeight: 44 }} onClick={() => document.getElementById('biz-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {t('biz.cta')}
          </button>
          <button className="btn btn-ghost" style={{ flex: '1 1 140px', minHeight: 44 }} onClick={() => openLink(SITE_URL)}>
            <IconGlobe width={16} height={16} /> {SITE_URL.replace(/^https:\/\//, '')}
          </button>
        </div>
      </motion.section>

      {/* Stats — functional: credibility at a glance */}
      <motion.div className="stack" variants={stagger} initial="hidden" animate="show" style={{ gap: 0, marginTop: 16 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>{t('biz.atGlance')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {STATS.map((s) => (
            <motion.div key={s.id} className="card" variants={riseIn} style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: -0.3 }}>{i18n.language === 'fa' ? s.valueFa : s.valueEn}</div>
              <div style={{ fontWeight: 700, fontSize: 11.5, marginTop: 2 }}>{t(`biz.stat.${s.id}.label`)}</div>
              <div className="faint" style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.6 }}>{t(`biz.stat.${s.id}.sub`)}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Offers — beautiful, with CTA per card */}
      <section style={{ marginTop: 18 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>{t('biz.services')}</p>
        <motion.div className="stack" style={{ gap: 14 }} variants={stagger} initial="hidden" animate="show">
          {OFFERS.map(({ id, Icon, hue, gradient }) => (
            <motion.div
              key={id}
              className="docs-card"
              data-open="false"
              variants={riseIn}
              style={{ '--card-hue': hue, padding: 16, cursor: 'default' }}
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span className="docs-icon" style={{ width: 48, height: 48, borderRadius: 14, background: gradient, color: '#fff', border: 'none', boxShadow: `0 10px 24px ${hue === 'var(--rgb-1)' ? 'rgba(0,229,255,0.24)' : hue === 'var(--rgb-2)' ? 'rgba(124,77,255,0.24)' : 'rgba(255,179,0,0.24)'}` }}>
                  <Icon width={22} height={22} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5 }}>{t(`biz.offer.${id}.title`)}</div>
                  <p className="muted" style={{ fontSize: 12.7, lineHeight: 1.85, margin: '6px 0 0' }}>{t(`biz.offer.${id}.body`)}</p>
                  <button
                    className="tag"
                    style={{ marginTop: 10, gap: 6 }}
                    onClick={() => {
                      setInterest(id);
                      document.getElementById('biz-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      haptic?.('light');
                    }}
                  >
                    {t('biz.pickTopic')} <IconChevronLeft width={12} height={12} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Benefits — why us */}
      <section style={{ marginTop: 18 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>{t('biz.whyUs')}</p>
        <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
          {BENEFITS.map((b) => (
            <motion.div key={b.id} className="card" variants={riseIn} style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'flex-start', width: '100%', boxSizing: 'border-box' }}>
              <span className="docs-icon" style={{ '--card-hue': b.hue, width: 40, height: 40, borderRadius: 12 }}>
                <b.Icon width={18} height={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t(`biz.benefit.${b.id}.title`)}</div>
                <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85, margin: '4px 0 0' }}>{t(`biz.benefit.${b.id}.body`)}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Steps — how to start */}
      <section style={{ marginTop: 18 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>{t('biz.path')}</p>
        <motion.div className="stack" style={{ gap: 10 }} variants={stagger} initial="hidden" animate="show">
          {STEPS.map((s) => (
            <motion.div key={s.n} className="card" variants={riseIn} style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
              <span className="docs-step-num" style={{ minWidth: 30, height: 30, borderRadius: 10, fontSize: 13, background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#000', display: 'grid', placeItems: 'center', fontWeight: 900 }}>{s.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t(`biz.step.${s.id}.title`)}</div>
                <div className="faint" style={{ fontSize: 12.3, lineHeight: 1.7, marginTop: 2 }}>{t(`biz.step.${s.id}.desc`)}</div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Inline Business Form — functional */}
      <motion.section id="biz-form" className="docs-card" data-open="true" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18, '--card-hue': 'var(--rgb-1)', padding: 18 }}>
        <div style={{ fontWeight: 900, fontSize: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="docs-icon" style={{ width: 36, height: 36, borderRadius: 10 }}><IconMail width={18} height={18} /></span>
          {t('biz.form.title')}
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85, marginTop: 8 }}>
          {t('biz.form.intro')}
        </p>

        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label className="field-label">{t('biz.form.topic')}</label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {OFFERS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`tag ${interest === o.id ? 'active' : ''}`}
                  onClick={() => setInterest(o.id)}
                  style={{ gap: 6 }}
                >
                  <o.Icon width={14} height={14} /> {t(`biz.offer.${o.id}.title`)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="field-label">{t('biz.form.company')}</span>
              <input value={form.company} onChange={(e) => setField('company', e.target.value)} placeholder={t('biz.form.companyPh')} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="field-label">{t('biz.form.name')}</span>
              <input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('biz.form.namePh')} />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="field-label">{t('biz.form.email')}</span>
              <input type="email" inputMode="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="name@company.com" dir="ltr" />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="field-label">{t('biz.form.phone')}</span>
              <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder={t('biz.form.phonePh')} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="field-label">{t('biz.form.message')}</span>
            <textarea
              value={form.message}
              onChange={(e) => setField('message', e.target.value)}
              placeholder={t('biz.form.messagePh')}
              rows={4}
              style={{ resize: 'vertical', minHeight: 96 }}
            />
          </label>

          <button
            className="btn btn-primary"
            disabled={sending}
            onClick={submitBusiness}
            style={{ width: '100%', minHeight: 46, gap: 8 }}
          >
            <IconMail width={16} height={16} /> {sending ? t('biz.form.sending') : t('biz.form.submit', { topic: t(`biz.offer.${interest}.title`) })}
          </button>

          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="tag" onClick={() => openUrl(SUPPORT_MAILTO)} style={{ gap: 6 }}><IconMail width={14} height={14} /> {SUPPORT_EMAIL}</button>
            <button className="tag" onClick={() => openUrl(SITE_URL)} style={{ gap: 6 }}><IconGlobe width={14} height={14} /> {SITE_URL.replace(/^https:\/\//, '')}</button>
          </div>
          <p className="faint" style={{ fontSize: 11, lineHeight: 1.7, textAlign: 'center', margin: 0 }}>
            با ارسال، مستقیماً به ایمیل پشتیبانی ما وصل می‌شوی — پاسخ معمولاً ۲۴ ساعت کاری.
          </p>
        </div>
      </motion.section>

      {/* Company details — spacious */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18, padding: 18 }}>
        <p className="section-label" style={{ marginBottom: 12 }}>{t('biz.company')}</p>
        <div className="info-row">
          <span className="info-row-icon" style={{ width: 40, height: 40, borderRadius: 12 }}><IconBuilding width={18} height={18} /></span>
          <div>
            <div className="faint">{t('about.company')}</div>
            <div style={{ fontWeight: 800, fontSize: 14, marginTop: 3 }}>{t('about.companyFull')}</div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{t('about.tagline')}</div>
          </div>
        </div>

        <button
          className="info-row"
          onClick={() => openUrl(SITE_URL)}
          style={{ width: '100%', background: 'none', border: 0, padding: 0, marginTop: 14, cursor: 'pointer', color: 'inherit', textAlign: 'start' }}
        >
          <span className="info-row-icon" style={{ width: 40, height: 40, borderRadius: 12 }}><IconGlobe width={18} height={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="faint">{t('biz.website')}</div>
            <div className="mono" style={{ fontWeight: 700, fontSize: 13, marginTop: 3, direction: 'ltr' }}>{SITE_URL.replace(/^https:\/\//, '')}</div>
          </div>
          <IconExternal width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        </button>
      </motion.section>

      <p className="notice" style={{ marginTop: 16, lineHeight: 1.85 }}>{t('biz.notice')}</p>

      <div className="row" style={{ gap: 12, marginTop: 14 }}>
        <button className="btn btn-ghost" style={{ flex: 1, minHeight: 44 }} onClick={() => navigate('/contact')}>
          <IconMail width={16} height={16} /> {t('contact.title')}
        </button>
        <button className="btn btn-ghost" style={{ flex: 1, minHeight: 44 }} onClick={() => navigate('/about')}>
          <IconBuilding width={16} height={16} /> {t('about.title')}
        </button>
      </div>
    </PageTransition>
  );
}
