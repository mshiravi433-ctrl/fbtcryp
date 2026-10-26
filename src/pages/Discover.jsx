import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Sheet from '../components/Sheet';
import CoinLogo from '../components/CoinLogo';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { openUrl } from '../lib/browser';
import { IconChevronLeft, IconCopy, IconExternal, IconSearch, IconShield } from '../components/Icons';
import { usePoll } from '../hooks/useMarket';
import { getTrending } from '../lib/api';

/**
 * Site logo with graceful fallback.
 *
 * Upstream: Google's public favicon service, which returns the favicon at
 * the requested size for any domain. Width 64 so the icon survives retina
 * without pixelating; `loading=lazy` so the 12+ rows don't fight each other
 * for bandwidth when the screen first renders.
 *
 * Fallback: the first letter of the localised name on the item's chosen
 * hue. The hue is here, in the data, so the fallback doesn't have to guess
 * a colour from a URL.
 *
 * `onError` flips the flag and the icon disappears — we render the
 * monogram instead, so a slow/blocked favicon service degrades to "letter
 * on coloured tile", not to a broken-image icon.
 */
function SiteLogo({ item, name }) {
  const [failed, setFailed] = useState(false);
  const host = useMemo(() => {
    try {
      return new URL(item.url).host.replace(/^www\./, '');
    } catch {
      return '';
    }
  }, [item.url]);

  if (failed || !host) {
    return (
      <span
        className="disc-mark disc-mark-fallback"
        aria-hidden="true"
        style={{ background: `linear-gradient(135deg, ${item.hue}, color-mix(in srgb, ${item.hue} 70%, #000))`, color: '#fff', boxShadow: `0 6px 14px color-mix(in srgb, ${item.hue} 22%, transparent)`, width: 40, height: 40, borderRadius: 12, fontSize: 16, fontWeight: 800 }}
      >
        {String(name || item.id).slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className="disc-mark"
      aria-hidden="true"
      style={{
        background: `linear-gradient(135deg, ${item.hue}, color-mix(in srgb, ${item.hue} 70%, #000))`,
        color: '#fff',
        boxShadow: `0 6px 14px color-mix(in srgb, ${item.hue} 22%, transparent)`,
        width: 40,
        height: 40,
        borderRadius: 12,
        overflow: 'hidden'
      }}
    >
      <img
        src={`https://www.google.com/s2/favicons?sz=64&domain=${host}`}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{ display: 'block' }}
      />
    </span>
  );
}

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

/* Which category a site belongs to, for the preview sheet's chip. */
const CAT_OF = Object.fromEntries(LINKS.flatMap((g) => g.items.map((it) => [it.id, g.cat])));
/* Every curated item by id, so the sheet and the recents strip share one source. */
const ITEM_BY_ID = Object.fromEntries(LINKS.flatMap((g) => g.items));

/*
 * ─── RECENTLY OPENED, KEPT ON THE DEVICE ────────────────────────────────────
 * The screen used to be a flat list: everything equally far from the thumb,
 * every visit starting from scratch. Remembering the last six sites the user
 * actually opened — in localStorage, ids only, nothing leaves the device —
 * turns it into a launcher. The strip only appears once there IS a recent,
 * so a first visit sees no empty box.
 */
const RECENT_KEY = 'fbt.discover.recent.v1';
const RECENT_MAX = 6;

const loadRecents = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => ITEM_BY_ID[id]).slice(0, RECENT_MAX) : [];
  } catch { return []; }
};

export default function Discover({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  /*
   * ─── THE HALF-POPUP ───────────────────────────────────────────────────────
   *   «هر باکس را روش میزنی اطلاعات اولیه به صورت نیمه پاپ‌اپ بیاد از پایین و
   *    بعد دکمه بازکردن لینک باشه»
   *
   * A tap on a card no longer leaves the app immediately. It raises a bottom
   * sheet with what the site IS — name, exact domain, category and one honest
   * sentence — and the outbound button lives inside it. That extra half-second
   * is the whole point: the domain is read on OUR glass, on the same screen
   * that explained the site, before the browser takes over. Leaving the app
   * becomes a decision instead of a reflex.
   */
  const [pickedId, setPickedId] = useState(null);
  const picked = pickedId ? ITEM_BY_ID[pickedId] : null;
  const [recents, setRecents] = useState(loadRecents);

  /* Re-read after every open, so the strip and the sheet never disagree. */
  const remember = useCallback((id) => {
    try {
      const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecents(next);
    } catch { /* storage blocked (private mode): the strip just stays as it was */ }
  }, []);

  const closeSheet = useCallback(() => setPickedId(null), []);
  const pick = useCallback((item) => {
    haptic?.('light');
    setPickedId(item.id);
  }, [haptic]);

  const openPicked = useCallback(async () => {
    if (!picked) return;
    haptic?.('medium');
    remember(picked.id);
    await openUrl(picked.url);
  }, [picked, haptic, remember]);

  const copyPicked = useCallback(() => {
    if (!picked) return;
    navigator.clipboard?.writeText(picked.url);
    haptic?.('success');
    useAppStore.getState().notify(t('discover.sheet.copied'), 'success');
  }, [picked, haptic, t]);

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
                <CoinLogo coin={c} size="thumb" px={16} className="coin-chip coin-chip-round" />
                {c.symbol}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      {/*
        ─── RECENTLY OPENED ────────────────────────────────────────────────
        The six sites this device actually opened last, newest first. A tap
        raises the SAME preview sheet — the shortcut skips the scrolling, not
        the confirmation. Rendered only once there is a recent to show.
      */}
      {recents.length > 0 && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('discover.recent')}</p>
          <div className="tag-scroll">
            {recents.map((id) => {
              const item = ITEM_BY_ID[id];
              const name = t(`discover.site.${id}`);
              return (
                <button key={id} className="tag tag-token disc-recent" style={{ '--disc-hue': item.hue }} onClick={() => pick(item)}>
                  <SiteLogo item={item} name={name} />
                  {name}
                </button>
              );
            })}
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
            {group.items.map((item) => {
              const name = t(`discover.site.${item.id}`);
              return (
                <motion.button
                  key={item.id}
                  className="disc-card"
                  variants={riseIn}
                  whileTap={{ scale: 0.975 }}
                  onClick={() => pick(item)}
                  aria-haspopup="dialog"
                  data-testid={`disc-card-${item.id}`}
                  style={{ '--disc-hue': item.hue, background: 'rgba(255,255,255,0.06)', border: 'none', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                >
                  <SiteLogo item={item} name={name} />
                  <span className="disc-body">
                    <span className="disc-name">{name}</span>
                    {/* The domain is shown deliberately: it is the only thing
                        that distinguishes a real site from a lookalike, and a
                        user who reads it here learns what to check elsewhere. */}
                    <span className="disc-host mono">{host(item.url)}</span>
                  </span>
                  <span className="disc-go"><IconExternal width={12} height={12} /></span>
                </motion.button>
              );
            })}
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

      <InfoBox title={t('discover.safetyTitle')} tone="warn" id="discover-safety">
        <p>{t('discover.safety')}</p>
      </InfoBox>

      {/*
        ─── THE PREVIEW SHEET ──────────────────────────────────────────────
        Half a screen, from the bottom, exactly as asked. What it shows:
        the mark and the name, the EXACT origin that will be opened (mono,
        LTR, on its own tinted row — the anti-lookalike check), the category,
        one honest sentence about what the site does, and only then the two
        buttons: open in the browser (primary) and copy the link. Nothing in
        here signs, connects or installs; it reads and it leaves.
      */}
      <Sheet
        open={Boolean(picked)}
        onClose={closeSheet}
        anchor="bottom"
        size="md"
        className="disc-sheet"
        testId="disc-sheet"
      >
        {picked && (
          <div className="disc-sheet-body" style={{ '--disc-hue': picked.hue }}>
            <div className="disc-sheet-head">
              <SiteLogo item={picked} name={t(`discover.site.${picked.id}`)} />
              <div className="disc-sheet-title">
                <div className="disc-sheet-name">{t(`discover.site.${picked.id}`)}</div>
                <span className="disc-sheet-cat">{t(`discover.cat.${CAT_OF[picked.id]}`)}</span>
              </div>
            </div>
            <div className="disc-sheet-host mono" dir="ltr">
              <IconShield width={13} height={13} />
              {host(picked.url)}
            </div>
            <p className="disc-sheet-desc">{t(`discover.desc.${picked.id}`)}</p>
            <div className="disc-sheet-actions">
              <button type="button" className="btn btn-primary disc-sheet-open" onClick={openPicked} data-testid="disc-sheet-open">
                <IconExternal width={15} height={15} />
                {t('discover.sheet.open')}
              </button>
              <button type="button" className="btn btn-ghost disc-sheet-copy" onClick={copyPicked}>
                <IconCopy width={15} height={15} />
                {t('discover.sheet.copy')}
              </button>
            </div>
            <p className="disc-sheet-hint">{t('discover.sheet.hint')}</p>
          </div>
        )}
      </Sheet>
    </PageTransition>
  );
}
