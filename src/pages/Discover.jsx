import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconExternal } from '../components/Icons';

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

export default function Discover() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [cat, setCat] = useState('all');

  const groups = useMemo(() => (cat === 'all' ? LINKS : LINKS.filter((g) => g.cat === cat)), [cat]);

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
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('discover.title')}</h1>
      </motion.div>

      <p className="muted">{t('discover.subtitle')}</p>

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

      <motion.p className="notice" variants={riseIn} initial="hidden" animate="show">
        {t('discover.safety')}
      </motion.p>
    </PageTransition>
  );
}
