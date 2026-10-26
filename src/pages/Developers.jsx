import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { publicAppUrl } from '../lib/nativeShell';
import { apiBase } from '../lib/apiBase';
import { createSandboxProject, loadProjectDrafts, PROJECT_SCOPES } from '../lib/developerProjects';
import DeveloperConsole from '../components/DeveloperConsole';
import ReviewerConsole from '../components/ReviewerConsole';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconGlobe,
  IconKey,
  IconLock,
  IconShield,
  IconSparkle
} from '../components/Icons';
import '../styles/developers-modern.css';

/**
 * DEVELOPERS — the quiet redesign.
 * ---------------------------------------------------------------------------
 *   «ریدیزاین صفحه توسعه‌دهندگان: هم از شلوغی صفحه کاسته شود، هم خیلی مدرن
 *    و بهترین UI/UX را داشته باشد»
 *
 * ─── WHAT WAS WRONG BEFORE THIS PASS ────────────────────────────────────────
 * The content was honest but the page was a wall: twelve equal-weight cards
 * stacked edge to edge — pills, notices, environment rows, rules, endpoints,
 * fair use, self-hosting, keys, SLA — so the two things an integrator
 * actually needs first (a request they can paste and the endpoint list) were
 * buried under eight cards of context they had not asked for yet.
 *
 * ─── THE SHAPE IT HAS NOW ───────────────────────────────────────────────────
 * A strict order of utility, and one visual weight per tier:
 *
 *   1. HERO — one gradient card: what this is, whether service discovery is
 *      live (read from the server, never asserted), and the two CTAs.
 *   2. QUICKSTART — the paste-and-run request, immediately under the hero,
 *      because it is the only paragraph on the page that must be believed
 *      with a terminal instead of with trust.
 *   3. THE RULES — six facts as a compact tile grid instead of a long card
 *      of hairline-separated rows.
 *   4. THE ENDPOINTS — the grouped accordion, unchanged in substance.
 *   5. PROJECTS + the two real consoles.
 *   6. EVERYTHING ELSE, FOLDED — ecosystem, environments, fair use,
 *      self-hosting and the key policy now live in collapsed InfoBoxes at
 *      the bottom. Same words, one tap away, zero scroll cost.
 *
 * ─── THE PRINCIPLE THE PAGE STILL KEEPS ─────────────────────────────────────
 * Only document what is true today and verifiable in one request. Every path
 * below was read out of `server/app.js` at the time of writing, not
 * remembered. The redesign moved pixels; it did not move a single fact.
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
    fetch(`${apiBase()}/environments`, { headers: { accept: 'application/json' } })
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
   * The line is derived from GET /api/environments: `available` rows mean
   * discovery is configured and answering. What it says when nothing is
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
    <PageTransition className="page devx-page">
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('dev.title')}</h1>
      </motion.div>

      {/* ------------------------------ hero ------------------------------ */}
      <motion.section className="devx-hero" variants={riseIn} initial="hidden" animate="show">
        <span className="devx-hero-glow a" aria-hidden="true" />
        <span className="devx-hero-glow b" aria-hidden="true" />
        <div className="devx-hero-top">
          <span className="devx-hero-mark" aria-hidden="true"><IconSparkle width={17} height={17} /></span>
          {/*
            The status pill is the answer to "why is it inactive". It is read
            from the server on every visit, so a deployment that has configured
            discovery says so, and one that has not says THAT — instead of both
            printing the same hard-coded sentence.
          */}
          <span className={`devx-status devx-status--${envStatus}`}>
            <span className="devx-status-dot" aria-hidden="true" />
            {t(`dev.status.${envStatus}`)}
          </span>
        </div>
        <h2 className="devx-hero-title">{t('dev.api')}</h2>
        <p className="devx-hero-sub">{t('dev.intro')}</p>
        <div className="devx-hero-actions">
          <button className="devx-btn devx-btn--primary" type="button" onClick={() => jumpTo(quickstartRef)}>
            <IconCopy width={15} height={15} />{t('dev.cta.sample')}
          </button>
          <button className="devx-btn devx-btn--ghost" type="button" onClick={() => jumpTo(projectInput)}>
            <IconKey width={15} height={15} />{t('dev.cta.projects')}
          </button>
        </div>
      </motion.section>

      {/* --------------------------- quickstart --------------------------- */}
      <motion.section className="devx-card devx-quick" variants={riseIn} initial="hidden" animate="show" ref={quickstartRef} tabIndex={-1}>
        <p className="devx-label">{t('dev.quickstart')}</p>
        <p className="devx-quick-sub">{t('dev.quickstartBody')}</p>
        <pre
          className="devx-code mono"
          tabIndex={0}
        >{sample}</pre>
        <button className="devx-btn devx-btn--copy" type="button" onClick={() => copy(sample)}>
          <IconCopy width={14} height={14} />{t('common.copy')}
        </button>
      </motion.section>

      {/* --------------------------- the rules ---------------------------- */}
      <section className="devx-block">
        <p className="devx-label devx-label--section">{t('dev.rules')}</p>
        <motion.div className="devx-facts" variants={stagger} initial="hidden" animate="show">
          {FACTS.map((k) => (
            <motion.div key={k} className="devx-fact" variants={riseIn}>
              <div className="devx-fact-k">{t(`dev.fact.${k}.k`)}</div>
              <div className="devx-fact-v">{t(`dev.fact.${k}.v`, { base })}</div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* -------------------------- the endpoints -------------------------- */}
      <section className="devx-block">
        <p className="devx-label devx-label--section">{t('dev.api')}</p>
        <p className="devx-api-intro">{t('dev.apiIntro')}</p>

        <div className="devx-groups">
          {GROUPS.map((g) => {
            const open = openGroup === g.id;
            return (
              <div key={g.id} className={`devx-group${open ? ' is-open' : ''}`}>
                {/*
                  Collapsed by default except the first. Thirty endpoints
                  expanded at once is the wall of text that made the previous
                  version unreadable in the other direction — it solved it by
                  listing six, which is worse.
                */}
                <button
                  className="devx-group-head"
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    haptic?.('select');
                    setOpenGroup(open ? null : g.id);
                  }}
                >
                  <span className="devx-group-name">{t(`dev.group.${g.id}`)}</span>
                  <span className="devx-group-side">
                    <span className="devx-group-count">{g.endpoints.length}</span>
                    <IconChevronRight
                      width={15}
                      height={15}
                      className="devx-group-chevron"
                      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
                    />
                  </span>
                </button>

                {open && (
                  <motion.div
                    className="devx-eps"
                    variants={stagger}
                    initial="hidden"
                    animate="show"
                  >
                    {g.endpoints.map((e) => (
                      <motion.div key={e.p} className="devx-ep" variants={riseIn}>
                        <div className="devx-ep-row">
                          <span className={`devx-method${e.m === 'GET' ? ' devx-method--get' : ''}`}>{e.m}</span>
                          <span className="devx-ep-path mono" dir="ltr">{e.p}</span>
                          <button
                            className="devx-ep-copy"
                            type="button"
                            onClick={() => copy(`${base}${e.p}`)}
                            aria-label={t('common.copy')}
                          >
                            <IconCopy width={13} height={13} />
                          </button>
                        </div>
                        <div className="devx-ep-desc">{t(`dev.ep.${e.d}`)}</div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------------------- projects ---------------------------- */}
      <section className="devx-card devx-projects" ref={projectInput} tabIndex={-1}>
        <p className="devx-label">{t('dev.projects')}</p>
        <p className="devx-quick-sub">{t('dev.projectsBody')}</p>
        <div className="devx-project-row">
          <input
            className="devx-input"
            value={projectName}
            maxLength={48}
            placeholder={t('dev.projectName')}
            onChange={(e) => { setProjectName(e.target.value); setProjectError(null); }}
            aria-label={t('dev.projectName')}
          />
          <button
            className="devx-btn devx-btn--primary"
            type="button"
            onClick={() => { const result = createSandboxProject({ name: projectName, environment: 'sandbox', scopes: PROJECT_SCOPES }); if (!result.ok) setProjectError(result.code); else { setProjects(result.projects); setProjectName(''); setProjectError(null); } }}
          >
            {t('dev.createDraft')}
          </button>
        </div>
        {projectError && <small className="devx-project-error" role="alert">{t('dev.projectUnavailable', { code: projectError })}</small>}
        {projects.length === 0 ? (
          <small className="devx-projects-empty">{t('dev.noProjects')}</small>
        ) : (
          <div className="devx-project-list">
            {projects.map((p) => (
              <div className="devx-project" key={p.id}>
                <span className="devx-project-name"><b>{p.name}</b><small>{p.environment} · {t('dev.scopes', { count: p.scopes.length })}</small></span>
                <span className="devx-project-status">{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <DeveloperConsole />
      <ReviewerConsole />

      {/* --------------------- everything else, folded --------------------- */}
      {/*
        ─── THE FOLD IS THE DECLUTTER ──────────────────────────────────────
        None of this was wrong; all of it was too much, too early. Ecosystem,
        environments, fair use, self-hosting and the key policy are reference
        material — read once, by a minority of visitors — so they keep their
        exact wording inside collapsed boxes, and the scroll above them gets
        shorter by roughly two screens.
      */}
      <div className="devx-folds">
        <InfoBox title={t('dev.ecosystem')} tone="info" id="devx-ecosystem">
          <p className="devx-fold-p">{t('dev.ecosystemBody')}</p>
          <div className="devx-pills">
            {['agents', 'strategies', 'liquidity', 'connect', 'sdk', 'environments', 'reputation', 'revenue'].map((item) => (
              <span className="devx-pill" key={item}>{t(`dev.pill.${item}`)}</span>
            ))}
          </div>
          <p className="devx-label devx-label--fold">{t('dev.environments')}</p>
          <div className="devx-envs">
            {(environments || [{ name: 'sandbox', status: 'checking' }, { name: 'testnet', status: 'not_configured' }, { name: 'mainnet', status: 'not_configured' }]).map((env) => (
              <span className="devx-env" key={env.name}>
                <b className="mono" dir="ltr">{env.name}</b>
                <span className={`devx-env-status${env.status === 'available' ? ' is-live' : ''}`}>{env.status}</span>
              </span>
            ))}
          </div>
          <p className="devx-fold-note">{t('dev.environmentsNote')}</p>
          {/*
            ─── THE BOUNDARY, WITH ITS REASON ────────────────────────────────
            Automatic execution and withdrawal are not a configuration anyone
            can turn on. They are absent because this product never holds
            funds — a design decision, not a broken install.
          */}
          <p className="devx-boundary"><IconShield width={13} height={13} />{t('dev.boundary')}</p>
        </InfoBox>

        <InfoBox title={t('dev.fairUse')} tone="info" id="devx-fairuse">
          <p className="devx-fold-p">{t('dev.fairUseBody')}</p>
        </InfoBox>

        <InfoBox title={t('dev.selfHost')} tone="info" id="devx-selfhost">
          <p className="devx-fold-p">{t('dev.selfHostBody')}</p>
          <pre className="devx-code mono">{`npm ci\ncp .env.example .env\nnpm run dev`}</pre>
          <p className="devx-fold-note">{t('dev.selfHostKeys')}</p>
        </InfoBox>

        <InfoBox title={t('dev.keysTitle')} tone="warn" id="devx-keys">
          <p className="devx-fold-p">{t('dev.keysBody')}</p>
          <button className="devx-source" type="button" onClick={() => navigate('/contact')}>
            <span className="devx-source-ico"><IconLock width={16} height={16} /></span>
            <span className="devx-source-text">
              <b>{t('dev.sourcePrivate')}</b>
              <small>{t('dev.sourcePrivateSub')}</small>
            </span>
            <IconChevronRight width={15} height={15} className="devx-source-arrow" />
          </button>
        </InfoBox>
      </div>

      <p className="devx-nosla"><IconGlobe width={13} height={13} />{t('dev.noSla')}</p>
    </PageTransition>
  );
}
