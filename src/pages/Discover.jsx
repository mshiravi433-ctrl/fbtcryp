import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconExternal, IconSearch } from '../components/Icons';
import { usePoll } from '../hooks/useMarket';
import { getTrending } from '../lib/api';

/**
 * DISCOVER — curated links, opened in the system browser.
 *
 * ─── WHY THIS IS A LIST AND NOT AN ADDRESS BAR ──────────────────────────────
 * A free-typing browser inside a wallet app is a phishing delivery mechanism.
 * The scam is well known: a message says "open pancakeswap.finance in your
 * wallet's browser", the user types it slightly wrong or follows a lookalike
 * domain, and the page asks them to approve a token allowance. Because the
 * page opened inside OUR app, our credibility is doing the vouching.
 *
 * A curated list removes the typing step entirely. Every destination here is
 * pinned to an exact https origin, so the user cannot land on
 * pancakeswaap.finance from this screen no matter what they were told.
 *
 * Pages still open through Custom Tabs (see lib/browser.js), so the real URL
 * stays visible and the browser's own TLS and Safe Browsing warnings apply —
 * we are not the thing asserting a site is genuine.
 *
 * ─── ON ADDING LINKS ────────────────────────────────────────────────────────
 * Only add an origin you have verified yourself, and only over https. Every
 * entry here is one the app already relies on elsewhere (the routers we quote
 * against, the explorers we link to, the wallets we support) — this screen
 * introduces no new trust relationships, it just makes the existing ones
 * reachable.
 */

const LINKS = [
  {
    cat: 'dex',
    items: [
      { id: 'pancakeswap', url: 'https://pancakeswap.finance', hue: '#f0b90b' },
      { id: 'uniswap', url: 'https://app.uniswap.org', hue: '#ff2d95' },
      { id: 'kyberswap', url: 'https://kyberswap.com', hue: '#00ff9d' },
      { id: 'quickswap', url: 'https://quickswap.exchange', hue: '#7c4dff' }
    ]
  },
  {
    cat: 'data',
    items: [
      { id: 'coingecko', url: 'https://www.coingecko.com', hue: '#00e5ff' },
      { id: 'geckoterminal', url: 'https://www.geckoterminal.com', hue: '#00ff9d' },
      { id: 'defillama', url: 'https://defillama.com', hue: '#7c4dff' },
      { id: 'dexscreener', url: 'https://dexscreener.com', hue: '#ffb300' }
    ]
  },
  {
    cat: 'explorer',
    items: [
      { id: 'bscscan', url: 'https://bscscan.com', hue: '#f0b90b' },
      { id: 'etherscan', url: 'https://etherscan.io', hue: '#7c4dff' },
      { id: 'polygonscan', url: 'https://polygonscan.com', hue: '#8247e5' },
      { id: 'arbiscan', url: 'https://arbiscan.io', hue: '#28a0f0' }
    ]
  },
  {
    cat: 'wallet',
    items: [
      { id: 'metamask', url: 'https://metamask.io', hue: '#ff6d00' },
      { id: 'trustwallet', url: 'https://trustwallet.com', hue: '#00e5ff' },
      { id: 'walletconnect', url: 'https://reown.com', hue: '#7c4dff' }
    ]
  },
  {
    cat: 'nft',
    items: [
      { id: 'opensea', url: 'https://opensea.io', hue: '#00e5ff' },
      { id: 'blur', url: 'https://blur.io', hue: '#ff6d00' },
      { id: 'magiceden', url: 'https://magiceden.io', hue: '#ff2d95' },
      { id: 'element', url: 'https://element.market', hue: '#00ff9d' }
    ]
  },
  {
    cat: 'learn',
    items: [
      { id: 'bnbchain', url: 'https://www.bnbchain.org', hue: '#f0b90b' },
      { id: 'ethereum', url: 'https://ethereum.org', hue: '#7c4dff' },
      { id: 'l2beat', url: 'https://l2beat.com', hue: '#00e5ff' }
    ]
  }
];

const CATEGORIES = ['all', ...LINKS.map((g) => g.cat)];

export default function Discover({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  /*
   * ─── LIVE TRENDING ────────────────────────────────────────────────────────
   * Discover was a static list of sixteen links and nothing else, so there
   * was no reason to open it twice. A live strip gives the screen something
   * that changes.
   *
   * Reuses `getTrending`, which the Market screen already polls and the
   * server already caches for 120s — so on a device that has visited Market
   * this costs ZERO extra requests, and at worst it is one cached call.
   * A 5-minute interval rather than the default 30s: trending coins do not
   * turn over in half a minute, and this screen is not the one people watch.
   */
  const { data: trending } = usePoll(getTrending, [], 300000);

  /*
   * Search filters the curated list only. It deliberately does NOT accept a
   * URL — see the header: a free-typing address bar inside a wallet is a
   * phishing delivery mechanism, and adding one here would undo the single
   * most important property of this screen.
   */
  const groups = useMemo(() => {
    const base = cat === 'all' ? LINKS : LINKS.filter((g) => g.cat === cat);
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          const name = t(`discover.site.${it.id}`).toLowerCase();
          return name.includes(needle) || it.url.toLowerCase().includes(needle);
        })
      }))
      .filter((g) => g.items.length > 0);
  }, [cat, q, t]);

  const go = async (item) => {
    haptic?.('light');
    await openUrl(item.url);
  };

  /** Show the origin, so the user reads the domain before tapping it. */
  const host = (u) => {
    try {
      return new URL(u).host.replace(/^www\./, '');
    } catch {
      return u;
    }
  };

  return (
    <PageTransition embedded={embedded}>
      {/* Suppressed when hosted in a tabbed page — the shell already draws a
          back button and a title, and two of each is clutter. */}
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('discover.title')}</h1>
        </motion.div>
      )}

      <p className="muted">{t('discover.subtitle')}</p>

      {/*
        ─── LIVE TRENDING ──────────────────────────────────────────────────
        Tapping a coin goes to OUR coin page, not out to a website. That is
        deliberate: this screen's job is to be useful without sending people
        away, and an internal route carries no phishing risk at all.
      */}
      {Array.isArray(trending) && trending.length > 0 && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('discover.trending')}</p>
          <div className="tag-scroll">
            {trending.slice(0, 10).map((c) => (
              <button
                key={c.id}
                className="tag tag-token"
                onClick={() => {
                  haptic?.('light');
                  navigate(`/coin/${c.id}`);
                }}
              >
                {c.image && <img src={c.image} alt="" width={16} height={16} style={{ borderRadius: '50%' }} loading="lazy" />}
                {c.symbol}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      {/*
        Search over the CURATED list only. It cannot navigate to a typed
        address — see the file header for why a free-typing address bar in a
        wallet app is a phishing vector.
      */}
      <label className="disc-search">
        <IconSearch width={15} height={15} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('discover.searchPlaceholder')}
          inputMode="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {q && (
          <button type="button" className="disc-search-clear" onClick={() => setQ('')} aria-label={t('common.close')}>
            ✕
          </button>
        )}
      </label>

      <div className="tag-scroll">
        {CATEGORIES.map((c) => (
          <button key={c} className={`tag ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
            {t(`discover.cat.${c}`)}
          </button>
        ))}
      </div>

      {groups.map((group) => (
        <motion.section key={group.cat} variants={stagger} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t(`discover.cat.${group.cat}`)}</p>
          <div className="disc-grid">
            {group.items.map((item) => (
              <motion.button
                key={item.id}
                className="disc-card"
                variants={riseIn}
                whileTap={{ scale: 0.975 }}
                onClick={() => go(item)}
                style={{ '--disc-hue': item.hue }}
              >
                <span className="disc-mark" aria-hidden="true">
                  {t(`discover.site.${item.id}`).slice(0, 1)}
                </span>
                <span className="disc-body">
                  <span className="disc-name">{t(`discover.site.${item.id}`)}</span>
                  {/* The domain is shown deliberately: it is the only thing
                      that distinguishes a real site from a lookalike, and a
                      user who reads it here learns what to check elsewhere. */}
                  <span className="disc-host mono">{host(item.url)}</span>
                </span>
                <span className="disc-go"><IconExternal width={12} height={12} /></span>
              </motion.button>
            ))}
          </div>
        </motion.section>
      ))}

      {/* A search that matches nothing must say so. An empty screen reads as
          a broken page rather than a filter with no results. */}
      {groups.length === 0 && (
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            {t('discover.noMatch', { q: q.trim() })}
          </p>
        </motion.div>
      )}

      <motion.p className="notice" variants={riseIn} initial="hidden" animate="show">
        {t('discover.safety')}
      </motion.p>
    </PageTransition>
  );
}
