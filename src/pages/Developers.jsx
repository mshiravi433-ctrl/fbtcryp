import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { publicAppUrl } from '../lib/nativeShell';
import { createSandboxProject, loadProjectDrafts, PROJECT_SCOPES } from '../lib/developerProjects';
import DeveloperConsole from '../components/DeveloperConsole';
import ReviewerConsole from '../components/ReviewerConsole';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconKey,
  IconLock,
  IconShield
} from '../components/Icons';

/**
 * DEVELOPERS.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS WRONG WITH THE OLD PAGE ───────────────────────────────────────
 * It listed six endpoints out of the fifty-two this server actually exposes,
 * gave no base URL, no rate limit in numbers, no error format, and no CORS
 * statement. An integrator reading it could not have made a single successful
 * request without guessing, and every guess they got wrong would arrive as a
 * support message.
 *
 * Worse, the one code sample said `https://your-host/api/...`. Copy it, run
 * it, get a DNS failure. A documentation page whose example cannot be pasted
 * is not documentation.
 *
 * ─── THE PRINCIPLE THIS PAGE IS BUILT ON ────────────────────────────────────
 * Only document what is true today and verifiable in one request. The
 * previous version advertised `/api/ai/faq`, which had been deleted from the
 * server — so the single most damaging thing this page can do is exactly what
 * it was doing: sending a developer to an endpoint that 404s and letting them
 * open a bug against us for our own stale text.
 *
 * Every path below was read out of `server/app.js` at the time of writing,
 * not remembered. Every one is a real registered route.
 */

/**
 * The public, read-only surface. Grouped, because a flat list of thirty paths
 * is a wall a reader skips.
 *
 * ─── WHAT IS DELIBERATELY NOT LISTED ────────────────────────────────────────
 * The write routes (`/api/orders/watch`, `/api/push/*`,
 * `/api/solana/execute`) exist and are not documented here. They are not
 * secret — anyone can read the network tab — but they mutate state tied to a
 * specific device or Telegram identity, and publishing them as though they
 * were a public API would invite integrations we would then break.
 *
 * `/api/cron/*` is likewise omitted: it is invoked by the scheduler, not by
 * callers, and documenting it would only encourage someone to trigger it.
 */
const GROUPS = [
  {
    id: 'market',
    endpoints: [
      { m: 'GET', p: '/api/global', d: 'globalStats' },
      { m: 'GET', p: '/api/markets?per_page=50', d: 'markets' },
      { m: 'GET', p: '/api/coin/:id', d: 'coin' },
      { m: 'GET', p: '/api/chart/:id?days=7', d: 'chart' },
      { m: 'GET', p: '/api/ohlc/:id?days=30', d: 'ohlc' },
      { m: 'GET', p: '/api/prices?ids=bitcoin,ethereum', d: 'prices' },
      { m: 'GET', p: '/api/trending', d: 'trending' },
      { m: 'GET', p: '/api/search?q=btc', d: 'search' },
      { m: 'GET', p: '/api/category/:slug', d: 'category' }
    ]
  },
  {
    id: 'chain',
    endpoints: [
      { m: 'GET', p: '/api/dex/:network', d: 'dexPools' },
      { m: 'GET', p: '/api/yields', d: 'yields' },
      { m: 'GET', p: '/api/perp/markets?symbol=BTC', d: 'perp' },
      { m: 'GET', p: '/api/coin-id/:chainId?addresses=0x…', d: 'coinId' },
      { m: 'GET', p: '/api/coin-venue/:id', d: 'coinVenue' },
      { m: 'GET', p: '/api/nft/chains', d: 'nftChains' },
      { m: 'GET', p: '/api/solana/assets', d: 'solanaAssets' }
    ]
  },
  {
    id: 'content',
    endpoints: [
      { m: 'GET', p: '/api/news', d: 'news' },
      { m: 'GET', p: '/api/audio', d: 'audio' }
    ]
  },
  {
    id: 'status',
    endpoints: [
      { m: 'GET', p: '/api/health', d: 'health' },
      { m: 'GET', p: '/api/bridge/status', d: 'bridgeStatus' },
      { m: 'GET', p: '/api/solana/status', d: 'solanaStatus' },
      { m: 'GET', p: '/api/gasless/status', d: 'gaslessStatus' },
      { m: 'GET', p: '/api/environments', d: 'environments' },
      { m: 'GET', p: '/api/ecosystem/agents', d: 'agentsCatalog' },
      { m: 'GET', p: '/api/ecosystem/strategies', d: 'strategiesCatalog' },
      { m: 'GET', p: '/api/ecosystem/liquidity', d: 'liquidityCatalog' },
      { m: 'GET', p: '/api/openapi.json', d: 'openapi' },
      { m: 'GET', p: '/api/network/overview?window=24h', d: 'networkOverview' }
    ]
  }
];

/**
 * The facts an integrator needs before their first request, in the order they
 * will need them. Every value is a literal read from the server rather than a
 * round number, because "about a hundred a minute" is not something anyone can
 * build a retry policy against.
 */
const FACTS = ['base', 'auth', 'limit', 'errors', 'cors', 'caching'];

export default function Developers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [openGroup, setOpenGroup] = useState('market');
  const [environments, setEnvironments] = useState(null);
  const [projects, setProjects] = useState(() => loadProjectDrafts());
  const [projectName, setProjectName] = useState('');
  const [projectError, setProjectError] = useState(null);
  /*
   * ─── DISCOVERY ANSWERED ≠ DISCOVERY WORKED ────────────────────────────────
   * `environments` used to be null both before the fetch resolved AND after it
   * failed, so the page could not tell "still asking" from "the server said
   * no". That is the whole difference between a status line that means
   * something and one that is printed unconditionally — which is what this
   * card did before.
   */
  const [envFailed, setEnvFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/environments', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => {
        if (!active) return;
        setEnvironments(x?.data || null);
        setEnvFailed(!x?.data);
      })
      .catch(() => {
        if (!active) return;
        setEnvironments(null);
        setEnvFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  /*
   * ─── THE STATUS IS READ, NOT ASSERTED ─────────────────────────────────────
   * The owner asked why this section said "not configured" and to activate it.
   * The answer is that the sentence was static: it printed on every deployment,
   * including one where discovery answers and the catalog is live, and the two
   * things it named — automatic execution and withdrawal — are not a
   * configuration anyone can turn on. They are absent because this product
   * never holds funds.
   *
   * So the line is now derived from GET /api/environments: `available` rows
   * mean discovery is configured and answering. What it says when nothing is
   * configured is different from what it says when the request failed, and
   * both are different from what it says while it is still in flight.
   */
  const envConfigured = Array.isArray(environments) && environments.some((e) => e?.status === 'available');
  const envStatus = environments ? (envConfigured ? 'live' : 'none') : (envFailed ? 'unreachable' : 'checking');

  /* The two things on this page that work right now, made one tap away. */
  const projectInput = useRef(null);
  const quickstartRef = useRef(null);
  const jumpTo = (ref) => {
    haptic?.('select');
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    /* Only the project card has a field to focus; the other is a copy target. */
    ref.current?.querySelector?.('input, pre')?.focus?.();
  };

  /*
   * A REAL host, resolved the same way share links are. The old page printed
   * `https://your-host/api/...` — a placeholder that fails the moment anyone
   * pastes it, which is the only thing a code sample is for.
   */
  const base = publicAppUrl('');

  const copy = (text) => {
    navigator.clipboard?.writeText(text);
    haptic?.('success');
    useAppStore.getState().notify('copied', 'success');
  };

  const sample = `curl -s "${base}/api/markets?per_page=5" \\
  -H "accept: application/json"`;

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('dev.title')}</h1>
      </motion.div>

      <p className="prose-sm">{t('dev.intro')}</p>
      <section className="card" style={{ marginTop: 12 }}>
        {/*
          The status pill is the answer to "why is it inactive". It is read
          from the server on every visit, so a deployment that has configured
          discovery says so, and one that has not says THAT — instead of both
          printing the same hard-coded sentence.
        */}
        <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
          <p className="section-label" style={{ margin: 0 }}>{t('dev.ecosystem')}</p>
          <span className={`pill ${envStatus === 'live' ? 'pill-up' : 'pill-neutral'}`} style={{ flexShrink: 0 }}>
            {t(`dev.status.${envStatus}`)}
          </span>
        </div>
        <p className="prose-sm">{t('dev.ecosystemBody')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {['agents', 'strategies', 'liquidity', 'connect', 'sdk', 'environments', 'reputation', 'revenue'].map((item) => <span className="pill pill-neutral" key={item}>{t(`dev.pill.${item}`)}</span>)}
        </div>

        {/*
          ─── THE BOUNDARY, WITH ITS REASON ──────────────────────────────────
          The old line read «پیکربندی نشده · اجرای خودکار در دسترس نیست ·
          برداشت وجه: هرگز در دسترس نیست» — three facts and no cause, so it
          looked like a broken install. The cause is that we are
          non-custodial: there is no execution to automate and no balance to
          withdraw, because the keys never leave the user's wallet. That is a
          design decision and the wiring suite fails if a control appears here
          that could ever do either.
        */}
        <p className="notice" style={{ marginTop: 10 }}>{t('dev.boundary')}</p>

        {/*
          ─── WHAT DOES WORK, ONE TAP AWAY ───────────────────────────────────
          An explanation of what is missing is only half an answer. Both of
          these are real and work on this deployment today: a sandbox draft is
          created locally by `createSandboxProject`, and the sample request
          below needs no key at all — which is the honest answer to "how do I
          get an API key".
        */}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" type="button" onClick={() => jumpTo(projectInput)}>
            {t('dev.cta.projects')}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => jumpTo(quickstartRef)}>
            {t('dev.cta.sample')}
          </button>
        </div>
      </section>
      <section className="card" style={{ marginTop: 12 }} ref={projectInput} tabIndex={-1}>
        <p className="section-label">{t('dev.projects')}</p>
        <p className="prose-sm">{t('dev.projectsBody')}</p>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" value={projectName} maxLength={48} placeholder={t('dev.projectName')} onChange={(e) => { setProjectName(e.target.value); setProjectError(null); }} aria-label={t('dev.projectName')} />
          <button className="btn btn-primary" type="button" onClick={() => { const result = createSandboxProject({ name: projectName, environment: 'sandbox', scopes: PROJECT_SCOPES }); if (!result.ok) setProjectError(result.code); else { setProjects(result.projects); setProjectName(''); setProjectError(null); } }}>{t('dev.createDraft')}</button>
        </div>
        {projectError && <small role="alert">{t('dev.projectUnavailable', { code: projectError })}</small>}
        {projects.length === 0 ? <small style={{ display: 'block', marginTop: 10, opacity: .75 }}>{t('dev.noProjects')}</small> : <div className="stack" style={{ marginTop: 10, gap: 8 }}>{projects.map((p) => <div className="row-between" key={p.id}><span><b>{p.name}</b><small style={{ display: 'block' }}>{p.environment} · {t('dev.scopes', { count: p.scopes.length })}</small></span><span className="pill pill-neutral">{p.status}</span></div>)}</div>}
      </section>
      <DeveloperConsole />
      <ReviewerConsole />

      <section className="card" style={{ marginTop: 12 }}>
        <p className="section-label">{t('dev.environments')}</p>
        <div className="stack" style={{ gap: 8 }}>
          {(environments || [{ name: 'sandbox', status: 'checking' }, { name: 'testnet', status: 'not_configured' }, { name: 'mainnet', status: 'not_configured' }]).map((env) => <div className="row-between" key={env.name}><b>{env.name}</b><span className="pill pill-neutral">{env.status}</span></div>)}
        </div>
        <small style={{ display: 'block', marginTop: 10, opacity: .75 }}>{t('dev.environmentsNote')}</small>
      </section>

      {/* ------------------------- start here ------------------------- */}
      <motion.section className="card card-rgb edge-mint" variants={riseIn} initial="hidden" animate="show" ref={quickstartRef}>
        <div className="aurora" />
        <p className="section-label" style={{ marginBottom: 9 }}>{t('dev.quickstart')}</p>
        <p className="prose-sm" style={{ marginBottom: 10 }}>{t('dev.quickstartBody')}</p>
        <pre
          className="mono"
          style={{
            fontSize: 10.5, lineHeight: 1.8, margin: 0, overflowX: 'auto',
            background: 'rgba(0,0,0,.35)', padding: 12, borderRadius: 11,
            border: '1px solid var(--line)', direction: 'ltr', textAlign: 'left'
          }}
        >{sample}</pre>
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => copy(sample)}>
          {t('common.copy')}
        </button>
      </motion.section>

      {/* --------------------------- the rules --------------------------- */}
      <section>
        <p className="section-label">{t('dev.rules')}</p>
        <motion.div className="card stack" style={{ gap: 0, marginTop: 8 }} variants={riseIn} initial="hidden" animate="show">
          {FACTS.map((k, i) => (
            <div
              key={k}
              style={{
                padding: '11px 0',
                borderBottom: i === FACTS.length - 1 ? 0 : '1px solid var(--line)'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 12.8, marginBottom: 3 }}>{t(`dev.fact.${k}.k`)}</div>
              <div className="prose-sm" style={{ fontSize: 12.2 }}>{t(`dev.fact.${k}.v`, { base })}</div>
            </div>
          ))}
        </motion.div>
      </section>

      {/* -------------------------- the endpoints -------------------------- */}
      <section>
        <p className="section-label">{t('dev.api')}</p>
        <p className="prose-sm" style={{ marginTop: 6, marginBottom: 9 }}>{t('dev.apiIntro')}</p>

        <div className="stack" style={{ gap: 9 }}>
          {GROUPS.map((g) => {
            const open = openGroup === g.id;
            return (
              <div key={g.id} className="card card-tight">
                {/*
                  Collapsed by default except the first. Thirty endpoints
                  expanded at once is the wall of text that made the previous
                  version unreadable in the other direction — it solved it by
                  listing six, which is worse.
                */}
                <button
                  className="row-between"
                  onClick={() => {
                    haptic?.('select');
                    setOpenGroup(open ? null : g.id);
                  }}
                  style={{
                    width: '100%', background: 'none', border: 0, padding: 0,
                    cursor: 'pointer', textAlign: 'start', color: 'inherit'
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{t(`dev.group.${g.id}`)}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="pill pill-neutral" style={{ fontSize: 10 }}>{g.endpoints.length}</span>
                    <IconChevronRight
                      width={15}
                      height={15}
                      style={{
                        color: 'var(--text-3)',
                        transform: open ? 'rotate(90deg)' : 'none',
                        transition: 'transform .18s'
                      }}
                    />
                  </span>
                </button>

                {open && (
                  <motion.div
                    className="stack"
                    style={{ gap: 7, marginTop: 11 }}
                    variants={stagger}
                    initial="hidden"
                    animate="show"
                  >
                    {g.endpoints.map((e) => (
                      <motion.div key={e.p} variants={riseIn}>
                        <div className="row-between">
                          <div className="row" style={{ gap: 8, minWidth: 0 }}>
                            <span className={`pill ${e.m === 'GET' ? 'pill-up' : 'pill-rgb'}`} style={{ fontSize: 9.5 }}>
                              {e.m}
                            </span>
                            <span
                              className="mono"
                              style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr' }}
                            >
                              {e.p}
                            </span>
                          </div>
                          <button
                            className="icon-btn"
                            style={{ width: 28, height: 28, flexShrink: 0 }}
                            onClick={() => copy(`${base}${e.p}`)}
                            aria-label={t('common.copy')}
                          >
                            <IconCopy width={13} height={13} />
                          </button>
                        </div>
                        <div className="faint" style={{ marginTop: 4, lineHeight: 1.7 }}>{t(`dev.ep.${e.d}`)}</div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* -------------------------- fair use -------------------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-5)' }}><IconShield width={19} height={19} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('dev.fairUse')}</div>
            <p className="prose-sm">{t('dev.fairUseBody')}</p>
          </div>
        </div>
      </motion.section>

      {/* -------------------------- self-hosting -------------------------- */}
      <section>
        <p className="section-label">{t('dev.selfHost')}</p>
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 8 }}>
          <p className="prose-sm">{t('dev.selfHostBody')}</p>
          <pre
            className="mono"
            style={{
              fontSize: 10.5, lineHeight: 1.8, marginTop: 10, marginBottom: 0, overflowX: 'auto',
              background: 'rgba(0,0,0,.35)', padding: 12, borderRadius: 11,
              border: '1px solid var(--line)', direction: 'ltr', textAlign: 'left'
            }}
          >{`npm ci
cp .env.example .env
npm run dev`}</pre>
          <p className="prose-sm" style={{ marginTop: 10 }}>{t('dev.selfHostKeys')}</p>
        </motion.div>
      </section>

      {/* ------------------------ source & keys ------------------------ */}
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
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('dev.sourcePrivate')}</div>
              <div className="faint">{t('dev.sourcePrivateSub')}</div>
            </div>
          </div>
          <IconChevronRight width={17} height={17} style={{ color: 'var(--text-3)' }} />
        </div>
      </motion.button>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-2)' }}><IconKey width={19} height={19} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('dev.keysTitle')}</div>
            <p className="prose-sm">{t('dev.keysBody')}</p>
          </div>
        </div>
      </motion.section>

      <p className="notice">{t('dev.noSla')}</p>
    </PageTransition>
  );
}
