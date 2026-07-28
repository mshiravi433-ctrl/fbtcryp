import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { aiStatus, askFaq } from '../lib/aiClient';
import { IconChevronLeft, IconChevronRight, IconDoc, IconInfo, IconLock, IconShield } from '../components/Icons';
import { useSettingsStore } from '../store/useSettingsStore';

/** Questions worth surfacing without the user having to think of them. */
const QUICK = ['fees', 'custody', 'seedLost', 'realMoney', 'network', 'slippage'];

export default function Help() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const replayGuide = useSettingsStore((s) => s.replayGuide);

  const [ai, setAi] = useState({ enabled: false });
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    aiStatus().then(setAi);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [thread, busy]);

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const ask = async (q) => {
    const text = String(q ?? question).trim();
    if (!text || busy) return;

    setThread((prev) => [...prev, { role: 'user', text }]);
    setQuestion('');
    setBusy(true);
    haptic?.('light');

    try {
      const res = await askFaq(text, i18n.language);
      if (res?.answer) {
        // Label where the answer came from. A canned answer presented as a
        // live model is a small lie that erodes trust in every other answer.
        setThread((prev) => [...prev, { role: 'ai', text: res.answer, source: res.source }]);
      } else {
        setThread((prev) => [...prev, { role: 'ai', text: t('help.aiNoAnswer'), source: 'none' }]);
      }
    } catch {
      setThread((prev) => [...prev, { role: 'error', text: t('help.aiFailed') }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('help.title')}</h1>
      </motion.div>

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
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('help.contactUs')}</div>
            <div className="faint">{t('help.contactUsSub')}</div>
          </div>
          <IconChevronRight width={17} height={17} style={{ color: 'var(--text-3)' }} />
        </div>
      </motion.button>

      {/* ---------- AI FAQ ---------- */}
      <motion.section className="card card-rgb edge-orchid" variants={riseIn} initial="hidden" animate="show">
        <div className="aurora" />
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <motion.span animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 2.4, repeat: Infinity }}>✦</motion.span>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t('help.askAi')}</span>
        </div>
        <p className="faint" style={{ marginBottom: 11 }}>{t('help.askAiSub')}</p>

        {/* There is no "AI unavailable" dead end any more. With no backend and
            no packaged key, answers come from the built-in knowledge base —
            which for questions about fees, gas and failed swaps is written by
            us about this exact app, and is therefore better than a general
            model guessing. We just say which one answered. */}
        {ai.mode === 'local' && <p className="notice">{t('help.aiLocalMode')}</p>}
        {(
          <>
            {thread.length === 0 && (
              <div className="stack" style={{ gap: 6, marginBottom: 11 }}>
                {QUICK.map((k, i) => (
                  <motion.button
                    key={k}
                    className="set-row"
                    style={{ borderRadius: 12, border: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => ask(t(`help.q.${k}`))}
                  >
                    <span className="set-row-label" style={{ fontSize: 12.5 }}>{t(`help.q.${k}`)}</span>
                    <IconChevronRight width={15} height={15} style={{ color: 'var(--text-3)' }} />
                  </motion.button>
                ))}
              </div>
            )}

            <div className="stack" style={{ gap: 9, maxHeight: 340, overflowY: 'auto' }}>
              <AnimatePresence initial={false}>
                {thread.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '88%',
                      padding: '10px 13px',
                      borderRadius: 15,
                      fontSize: 12.5,
                      lineHeight: 1.75,
                      background:
                        m.role === 'user'
                          ? 'linear-gradient(135deg,var(--rgb-1),var(--rgb-2))'
                          : m.role === 'error'
                            ? 'rgba(255,59,107,.12)'
                            : 'rgba(127,127,127,.12)',
                      color: m.role === 'user' ? '#000' : 'var(--text-1)',
                      border: m.role === 'error' ? '1px solid rgba(255,59,107,.3)' : '1px solid var(--line)'
                    }}
                  >
                    {m.text}
                    {m.role === 'ai' && m.source && m.source !== 'none' && (
                      <div className="faint" style={{ fontSize: 9.5, marginTop: 6, opacity: 0.8 }}>
                        {m.source === 'local' ? t('help.aiSourceLocal') : t('help.aiSourceModel')}
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {busy && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="row"
                  style={{ gap: 5, alignSelf: 'flex-start', padding: '10px 13px' }}
                >
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                      style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--rgb-1)' }}
                    />
                  ))}
                </motion.div>
              )}
              <div ref={endRef} />
            </div>

            <div className="row" style={{ gap: 8, marginTop: 11 }}>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder={t('help.askPlaceholder')}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                style={{ width: 'auto', padding: '12px 16px' }}
                onClick={() => ask()}
                disabled={busy || !question.trim()}
              >
                →
              </button>
            </div>

            <p className="faint" style={{ marginTop: 8, lineHeight: 1.7 }}>{t('help.aiCaveat')}</p>
          </>
        )}
      </motion.section>

      {/* ---------- docs & legal ---------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('help.resources')}</p>
        <div className="set-group">
          {/* Replaying the guide clears guideReadAt, which App.jsx watches, so
              the four-part guide takes over immediately. */}
          <button
            className="set-row"
            onClick={() => {
              haptic?.('light');
              replayGuide();
            }}
          >
            <span className="set-row-icon"><IconInfo width={19} height={19} /></span>
            <span className="set-row-label">
              <div>{t('help.guide')}</div>
              <div className="set-row-sub">{t('help.guideSub')}</div>
            </span>
            <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)' }} />
          </button>

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
