import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { IconChevronLeft, IconChevronRight, IconCopy, IconKey, IconLock, IconShield } from '../components/Icons';

/**
 * The repository is private (it holds the signing key, release config and fee
 * infrastructure), so there is no public URL to link to. Linking to a private
 * repo would send every user to a GitHub 404 and look broken.
 */

/** Public read-only endpoints this app already exposes. */
const ENDPOINTS = [
  { m: 'GET', p: '/api/global', d: 'globalStats' },
  { m: 'GET', p: '/api/markets?per_page=50', d: 'markets' },
  { m: 'GET', p: '/api/chart/:id?days=7', d: 'chart' },
  { m: 'GET', p: '/api/trending', d: 'trending' },
  { m: 'GET', p: '/api/dex/bsc', d: 'dexPools' },
  { m: 'POST', p: '/api/ai/outlook', d: 'aiOutlook' }
  /*
   * `/api/ai/faq` was listed here and does not exist — it was removed from the
   * server along with the Help chat box, and this page kept advertising it.
   * Publishing an endpoint that 404s sends integrators to open a bug against
   * us for our own stale documentation, which is exactly the kind of avoidable
   * inbound this page should not generate.
   *
   * The remaining AI routes are rate-limited separately from the cached market
   * data (see the /api/ai budget in server/app.js): they spend shared upstream
   * quota, so the documented example must not be loopable into an outage for
   * everyone else.
   */
];

export default function Developers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const copy = (text) => {
    navigator.clipboard?.writeText(text);
    haptic?.('success');
    useAppStore.getState().notify('copied', 'success');
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('dev.title')}</h1>
      </motion.div>

      <p className="muted">{t('dev.intro')}</p>

      <motion.button
        className="card card-rgb lift"
        variants={riseIn} initial="hidden" animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => navigate('/contact')}
        style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
      >
        <div className="aurora" />
        <div className="row-between">
          <div className="row" style={{ gap: 11 }}>
            <span className="wallet-badge"><IconLock width={20} height={20} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('dev.openSource')}</div>
              <div className="faint">{t('dev.openSourceSub')}</div>
            </div>
          </div>
          <IconChevronRight width={17} height={17} style={{ color: 'var(--text-3)' }} />
        </div>
      </motion.button>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-1)' }}><IconShield width={19} height={19} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('dev.sourcePrivate')}</div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t('dev.sourcePrivateBody')}</p>
          </div>
        </div>
      </motion.section>

      <section>
        <p className="section-label">{t('dev.api')}</p>
        <p className="faint" style={{ marginTop: 6, marginBottom: 9, lineHeight: 1.7 }}>{t('dev.apiIntro')}</p>
        <motion.div className="stack" style={{ gap: 7 }} variants={stagger} initial="hidden" animate="show">
          {ENDPOINTS.map((e) => (
            <motion.div key={e.p} className="card card-tight" variants={riseIn}>
              <div className="row-between">
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <span className={`pill ${e.m === 'GET' ? 'pill-up' : 'pill-rgb'}`} style={{ fontSize: 9.5 }}>{e.m}</span>
                  <span className="mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.p}</span>
                </div>
                <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => copy(e.p)}>
                  <IconCopy width={13} height={13} />
                </button>
              </div>
              <div className="faint" style={{ marginTop: 4 }}>{t(`dev.ep.${e.d}`)}</div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 9 }}>{t('dev.example')}</p>
        <pre
          className="mono"
          style={{
            fontSize: 10.5, lineHeight: 1.75, margin: 0, overflowX: 'auto',
            background: 'rgba(0,0,0,.35)', padding: 12, borderRadius: 11,
            border: '1px solid var(--line)', direction: 'ltr', textAlign: 'left'
          }}
        >{`fetch('https://your-host/api/markets?per_page=10')
  .then(r => r.json())
  .then(coins => console.log(coins))`}</pre>
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }}
          onClick={() => copy("fetch('https://your-host/api/markets?per_page=10').then(r=>r.json()).then(console.log)")}>
          {t('common.copy')}
        </button>
      </motion.section>

      <section>
        <p className="section-label">{t('dev.selfHost')}</p>
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 8 }}>
          <p className="muted" style={{ fontSize: 12.2 }}>{t('dev.selfHostBody')}</p>
          <pre
            className="mono"
            style={{
              fontSize: 10.5, lineHeight: 1.8, marginTop: 10, marginBottom: 0, overflowX: 'auto',
              background: 'rgba(0,0,0,.35)', padding: 12, borderRadius: 11,
              border: '1px solid var(--line)', direction: 'ltr', textAlign: 'left'
            }}
          >{`npm install
cp .env.example .env
npm run dev`}</pre>
        </motion.div>
      </section>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-5)' }}><IconKey width={19} height={19} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('dev.keysTitle')}</div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t('dev.keysBody')}</p>
          </div>
        </div>
      </motion.section>

      <p className="notice">{t('dev.rateLimit')}</p>
    </PageTransition>
  );
}
