import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconExternal, IconSearch } from '../components/Icons';

/**
 * ECOSYSTEM — the protocols and tools this app is built on.
 *
 * ─── WHAT WAS WRONG WITH THE OLD SCREEN ─────────────────────────────────────
 *
 * 1. NINE PERMANENT ANIMATIONS. Every card ran a `repeat: Infinity` pulse on
 *    an 80px `filter: blur(30px)` layer. Blur is the single most expensive
 *    filter to composite, and nine of them animating forever kept the GPU busy
 *    for as long as the screen was open — on a mid-range Android phone that is
 *    visible jank while scrolling and a real battery cost. This reads to a
 *    user as "the page is buggy", which is exactly how it was described.
 *
 * 2. IT BYPASSED THE SAFE LINK PATH. It called `window.open` directly instead
 *    of `openUrl` from lib/browser. Inside the packaged app that opens a bare
 *    WebView with no address bar drawn by US — so the user cannot see which
 *    domain they are on, and we are implicitly vouching for the site's
 *    identity. `openUrl` uses Custom Tabs, which shows the real domain and is
 *    the whole reason that helper exists. A wallet app is a high-value
 *    phishing target; this is not a cosmetic difference.
 *
 * 3. FAKE LOGOS. Each tile drew two or three letters on a coloured square.
 *    Real favicons make the list scannable at a glance.
 *
 * 4. NO WAY TO FIND ANYTHING once the list grew.
 *
 * Icons load from Google's favicon service, which needs no key and no
 * account. If one fails we fall back to the monogram rather than showing a
 * broken-image glyph — a missing logo must never leave a hole in the grid.
 */

const GROUPS = [
  {
    id: 'infra',
    items: [
      { id: 'bnb', url: 'https://www.bnbchain.org', hue: '#f0b90b' },
      { id: 'pancake', url: 'https://pancakeswap.finance', hue: '#00e5ff' },
      { id: 'kyber', url: 'https://kyberswap.com', hue: '#00ff9d' },
      { id: 'uniswap', url: 'https://uniswap.org', hue: '#ff007a' },
      { id: 'arbitrum', url: 'https://arbitrum.io', hue: '#28a0f0' },
      { id: 'base', url: 'https://base.org', hue: '#0052ff' }
    ]
  },
  {
    id: 'tools',
    items: [
      { id: 'bscscan', url: 'https://bscscan.com', hue: '#7c4dff' },
      { id: 'coingecko', url: 'https://coingecko.com', hue: '#00e676' },
      { id: 'geckoterminal', url: 'https://geckoterminal.com', hue: '#18ffff' },
      { id: 'defillama', url: 'https://defillama.com', hue: '#2172e5' },
      { id: 'dexscreener', url: 'https://dexscreener.com', hue: '#ff5c00' },
      { id: 'chainlist', url: 'https://chainlist.org', hue: '#facc15' }
    ]
  },
  {
    id: 'wallets',
    items: [
      { id: 'metamask', url: 'https://metamask.io', hue: '#ff6d00' },
      { id: 'trust', url: 'https://trustwallet.com', hue: '#00e5ff' },
      { id: 'walletconnect', url: 'https://reown.com', hue: '#3b99fc' },
      { id: 'rabby', url: 'https://rabby.io', hue: '#8697ff' },
      { id: 'safe', url: 'https://safe.global', hue: '#12ff80' }
    ]
  }
];

/** Two-letter monogram, used before the logo loads and if it never does. */
function monogram(name) {
  return String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
}

function Logo({ url, name, hue }) {
  const [failed, setFailed] = useState(false);
  const host = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }, [url]);

  if (failed || !host) {
    return (
      <span className="eco-logo eco-logo-text" style={{ background: hue }}>
        {monogram(name)}
      </span>
    );
  }

  return (
    <span className="eco-logo" style={{ '--eco-hue': hue }}>
      <img
        src={`https://www.google.com/s2/favicons?sz=64&domain=${host}`}
        alt=""
        width={22}
        height={22}
        loading="lazy"
        decoding="async"
        /* No referrer: the icon host does not need to learn our users' paths. */
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export default function Ecosystem() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  /*
   * openUrl (lib/browser) opens a Custom Tab, which shows the real domain in
   * a bar the OS draws. window.open inside the packaged app would hide it,
   * making every link here indistinguishable from a lookalike.
   */
  const open = (url) => openUrl(url);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const name = t(`eco.item.${it.id}.name`, { defaultValue: it.id });
        const desc = t(`eco.item.${it.id}.desc`, { defaultValue: '' });
        return (
          it.id.includes(q) ||
          String(name).toLowerCase().includes(q) ||
          String(desc).toLowerCase().includes(q)
        );
      })
    })).filter((g) => g.items.length > 0);
  }, [query, t]);

  const total = useMemo(() => GROUPS.reduce((n, g) => n + g.items.length, 0), []);

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('eco.title')}</h1>
      </motion.div>

      <p className="muted">{t('eco.intro')}</p>

      {/* Only worth showing once the list is long enough to need it. */}
      {total > 8 && (
        <motion.label className="eco-search" variants={riseIn} initial="hidden" animate="show">
          <IconSearch width={15} height={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('eco.search')}
            aria-label={t('eco.search')}
          />
        </motion.label>
      )}

      {groups.map((g) => (
        <section key={g.id}>
          <p className="section-label">{t(`eco.group.${g.id}`)}</p>
          <motion.div className="eco-grid" variants={stagger} initial="hidden" animate="show">
            {g.items.map((it) => {
              const name = t(`eco.item.${it.id}.name`, { defaultValue: it.id });
              return (
                <motion.button
                  key={it.id}
                  type="button"
                  className="eco-card"
                  variants={riseIn}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => open(it.url)}
                  style={{ '--eco-hue': it.hue }}
                >
                  <Logo url={it.url} name={name} hue={it.hue} />
                  <span className="eco-name">{name}</span>
                  <span className="eco-desc">
                    {t(`eco.item.${it.id}.desc`, { defaultValue: '' })}
                  </span>
                  <IconExternal className="eco-ext" width={12} height={12} aria-hidden="true" />
                </motion.button>
              );
            })}
          </motion.div>
        </section>
      ))}

      {groups.length === 0 && (
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="muted">{t('eco.noResults', { q: query })}</p>
        </motion.div>
      )}

      <InfoBox title={t('eco.noticeTitle')} tone="info" id="eco-notice">
        <p>{t('eco.notice')}</p>
      </InfoBox>
    </PageTransition>
  );
}
