import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { lockBodyScroll } from '../lib/scrollLock';
import { useTelegram } from '../context/TelegramContext';
import { SPECULATION_ENABLED, SPOT_TRADE_ENABLED } from '../lib/features';
import { useStill } from './AnimatedIcon';
import {
  IconActivity,
  IconBriefcase,
  IconBuilding,
  IconChevronRight,
  IconDoc,
  IconGlobe,
  IconInfo,
  IconKey,
  IconMarket,
  IconRocket,
  IconNews,
  IconPools,
  IconSettings,
  IconShield,
  IconSmartMoney,
  IconSwap,
  IconTrend,
  IconTrophy,
  IconX,
  IconSearch,
  IconClock,
  IconWorld
} from './Icons';

/**
 * «بیشتر» — the everything-else sheet.
 *
 * ─── WHAT CHANGED AND WHY (2026-10-29) ───────────────────────────────────────
 * The owner's brief: «بدون نوار جستجو و جملات اضافه» — no search bar, no filler
 * sentences, just the best-looking, fastest way to reach every screen.
 *
 * The previous version answered "where is it?" with three pieces of chrome and
 * one of copy: an uppercase eyebrow, a one-line mission statement, a search
 * field with an ESC hint, category chips carrying item counts, and a footer
 * counting destinations in two languages. Twenty-five rows of real content sat
 * underneath all of it — inside a panel that only fits eleven of them.
 *
 * So the chrome is gone and the content moved up:
 *
 *   • No search. It was doing the work of a filter rail badly: on a phone the
 *     keyboard covered half the list you were searching, and every label is
 *     one or two words long — a filter is one tap, a search is a tap, a
 *     keyboard, and typing.
 *   • No eyebrow, no sentence under the title, no footer. The title says what
 *     the sheet is; the rows say what is in it.
 *   • Filter pills carry no counts. A count next to a category label is
 *     decoration that changes nothing about what you tap.
 *   • Rows instead of tiles: a 52px row fits a two-word Persian label at a
 *     readable weight and gives a full-width tap target. A 96px tile in a
 *     three-up grid shrank the label to 11px so two of them could sit side by
 *     side — that is the trade the old grid made, and it lost.
 *
 * Motion is unchanged in kind, on purpose. The panel still fades and slides
 * only (opacity + y, no parent `scale`), and the rows still arrive as one CSS
 * animation rather than 25 springs: re-rasterising the whole subtree on every
 * frame is what made this sheet stutter on Android, and the fix stays. See
 * src/styles/more-menu.css for the compositor budget.
 *
 * The "More" drawer.
 *
 * WHY THE ANIMATION WAS JITTERY — and what changed
 * ---------------------------------------------------------------------------
 * The first version tried to be clever and paid for it on real hardware. On
 * open it ran, all at once:
 *
 *   • the panel animating `scale` 0.93 → 1
 *   • 18 tiles each with their own spring on opacity/y/scale
 *   • 18 icon wrappers with a second spring
 *   • hand-authored SVG icons animating `pathLength` on 2-4 paths each
 *
 * That is roughly 90 simultaneous animations, most of them on SVG geometry,
 * inside a parent that was itself scaling. Two things make that specifically
 * bad rather than merely heavy:
 *
 *   1. Animating `scale` on a parent forces the browser to re-rasterise every
 *      descendant on every frame. Normally cheap; not with 18 clip-paths and
 *      dozens of animating SVG paths inside.
 *   2. `pathLength` is not a compositor property. Each step runs on the main
 *      thread, so they compete with React's own render work during the exact
 *      frames the panel is moving.
 *
 * The fix is to stop asking for so much:
 *   • The panel fades and slides (opacity + y). No scale, so children are not
 *     re-rasterised mid-flight.
 *   • Tiles fade in as ONE group via a CSS animation on the grid, not 18
 *     independent springs.
 *   • Icons are static during the open. They still animate on tap, which is
 *     the moment feedback actually means something.
 *
 * The result reads as one deliberate motion instead of a swarm, and it costs
 * a fraction of the frames. That is the better design as well as the faster
 * one — a menu that explodes into 18 separately-springing tiles is noise.
 */
const GROUPS = [
  {
    id: 'markets',
    items: [
      { to: '/', key: 'nav.market', Icon: IconMarket, hue: 'var(--rgb-1)' },
      /*
        Perp and Predict only exist when SPECULATION_ENABLED is set at build
        time; their routes are absent otherwise, so leaving the links here
        would send a tap to the catch-all — a menu item that appears to do
        nothing. See lib/features.js for why they are off by default.
      */
      ...(SPECULATION_ENABLED
        ? [
            { to: '/perp', key: 'nav.perp', Icon: IconTrend, hue: 'var(--rgb-3)' },
            /*
             * ─── dydx / ostium / derivatives REMOVED FROM MENU ──────────────
             * روی درخواست: «سه صفحه dydx ,بازار مشتقه و بازار واقعی را از منو
             * حذف کن چون در صفحه سهام هست»
             * این سه صفحه حالا تب‌های داخل /stocks هستن (STOCK_TABS در
             * src/pages/Stocks.jsx) و از منو حذف شدن تا منو خلوت و بدون
             * تکرار باشد. Route های /dydx و /ostium و /derivatives در
             * App.jsx همچنان وجود دارن تا لینک قدیمی/مستقیم نشکنه — فقط
             * ورودی منو حذف شده، مثل کاری که قبلا برای /solana شد.
             */
            { to: '/lab', key: 'lab.title', Icon: IconActivity, hue: 'var(--rgb-8)' }
          ]
        : []),
      { to: '/stocks', key: 'nav.stocks', Icon: IconBuilding, hue: 'var(--rgb-5)' },
      /*
       * ─── ETF & GOLD REMOVED FROM MENU ──────────────────────────────────
       * روی درخواست: «صفحه etf و طلا را حذف کن و از منو بخش بازار هم ببر
       * خیلی مبتدی و به درد نخوره تا بعدا درستش کنیم»
       */
      /*
       * Spend crypto on real things. Sits in `markets` rather than `more`
       * because it is a destination people arrive wanting, not a setting they
       * go hunting for.
       */
      /*
       * The spot tab, in the build where the futures screens are absent (its
       * own entry, because /perp is not in this build). Where speculation is on,
       * the same tab sits in the Futures rail instead, so there is no duplicate.
       * /trade redirects to the spot tab whenever the spot flag is on.
       */
      ...(SPOT_TRADE_ENABLED && !SPECULATION_ENABLED
        ? [{ to: '/trade', key: 'nav.trade', Icon: IconSwap, hue: 'var(--rgb-4)' }]
        : []),
      { to: '/shop', key: 'nav.shop', Icon: IconBriefcase, hue: 'var(--rgb-9)' },
      { to: '/buy', key: 'nav.buy', Icon: IconSwap, hue: 'var(--rgb-4)' },
      /* Cross-chain. Sits next to Swap because that is the question it
         answers: "my token is on the wrong network". */
      { to: '/bridge', key: 'nav.bridge', Icon: IconSwap, hue: 'var(--rgb-3)' },
      { to: '/p2p', key: 'nav.p2p', Icon: IconSwap, hue: 'var(--rgb-6)' },
      /* FBT Launch — token & liquidity launchpad. Sits with the trading
         destinations because that is the question it answers: "I want my
         own token trading on FBT Swap". Non-custodial: the user's wallet
         signs every step (see src/pages/Launch.jsx). */
      { to: '/launch', key: 'nav.launch', Icon: IconRocket, hue: 'var(--rgb-1)' }
      /*
       * ─── SOLANA IS NOT LISTED HERE ANY MORE ─────────────────────────────
       * It is a TAB inside /swap now, on the owner's instruction: «سواپ و
       * سواپ سولانا را داخل یک صفحه در دو تب بزار و از منو سواپ سولانا را
       * پاک کن».
       *
       * The old comment here argued it deserved its own entry because it
       * uses a different aggregator, wallet and signing scheme. All true,
       * and all invisible to the user — who is asking one question, "swap
       * this for that", and was being made to hunt through a menu for half
       * the answer.
       *
       * The /solana ROUTE still exists and still works. Removing it would
       * break every link already shared, and the Stocks and Farm screens
       * hand off to it with ?to=<mint>. A menu entry is discovery; a route
       * is a contract.
       */
    ]
  },
  {
    id: 'earn',
    items: [
      { to: '/farm', key: 'nav.farm', Icon: IconPools, hue: 'var(--rgb-4)' },
      /*
       * ─── FBT SMART COLLECTIVE IS HIDDEN FROM THE MENU FOR NOW ────────────
       * Owner instruction (2026-10-21): «مجموعه هوشمند fbt را الان از منو محو
       * کن و ناپدید کن که در منو دیگر نباشد فعلا».
       *
       * The /collective ROUTE stays mounted in App.jsx exactly like the
       * /solana and /portfolio doorways: a menu entry is discovery, a route is
       * a contract, and saved/shared links must keep resolving. Only this
       * doorway is removed — re-add the tile (and the IconActivity import if
       * nothing else uses it) when the feature is ready to surface again.
       */
      // { to: '/collective', key: 'nav.collective', Icon: IconActivity, hue: 'var(--rgb-5)' },
      /*
       * Loan — lending & borrowing page.
       * FBT acts as Router + Fee layer only; non-custodial.
       */
      { to: '/loan', key: 'nav.loan', Icon: IconShield, hue: 'var(--rgb-2)' },
      /* FBT Insurance OS — /insurance (sandbox providers, non-custodial). */
      { to: '/insurance', key: 'nav.protection', Icon: IconShield, hue: 'var(--rgb-8)' },
      /* Intent OS now owns the raised centre button. Orders therefore needs a
         direct discovery path again; it remains the specialised editor for
         limit, DCA, TWAP and rebalance plans compiled by the OS. */
      { to: '/orders', key: 'nav.orders', Icon: IconClock, hue: 'var(--rgb-1)' },
      /*
       * ─── PORTFOLIO IS NOT LISTED HERE ANY MORE ───────────────────────────
       * The Portfolio intelligence dashboard now lives INSIDE the wallet
       * screen (the Intelligence tile on /wallet opens the embedded
       * dashboard). The /portfolio ROUTE still exists and still works so a
       * saved or shared link resolves — only the menu doorway was removed,
       * the same rule the /solana and /nft entries follow.
       */
      /* Points and ranking are one screen now — a score is only meaningful
         next to the standing it produces. */
      { to: '/rewards', key: 'rewards.title', Icon: IconTrophy, hue: 'var(--rgb-5)' },
      ...(SPECULATION_ENABLED
        ? []
        : [])
    ]
  },
  {
    id: 'more',
    items: [
      /*
       * «در منو smart money را مثل بقیه ایکون ها کن نه برجسته» — the tile
       * used to carry `featured: true` (glowing border + label weight),
       * which made it stand out from every other destination. It is a normal
       * tile now: same size, same stroke icon (IconSmartMoney in Icons.jsx),
       * same flat treatment.
       */
      { to: '/smart-money', key: 'sm.title', Icon: IconSmartMoney, hue: 'var(--rgb-7)' },
      { to: '/news', key: 'nav.news', Icon: IconNews, hue: 'var(--rgb-1)' },
      /*
       * The world console left the News tabs and is its own page now, named
       * «جهانی» in this menu. It sits right under News because that is where
       * people came from, and uses its own icon (a globe with an orbit) so it
       * never reads as the Ecosystem tile next to it. The /ai-global URL
       * stays as an alias.
       */
      { to: '/global', key: 'nav.global', Icon: IconWorld, hue: 'var(--rgb-2)' },
      { to: '/explore-hub', key: 'exploreHub.title', Icon: IconSearch, hue: 'var(--rgb-4)' },
      /* Auto Orders moved into the Earn group when Intent OS became the raised
         centre action. Keeping this note here prevents a later refactor from
         adding a second duplicate doorway in the More group. */
      /*
        NFTs are NOT listed here. The collection lives inside the real-wallet
        tab, where it belongs — an NFT is a thing you hold, so it sits with
        the rest of what you hold rather than as a separate destination.

        The `/nft` route still exists and still works, so an old bookmark or
        a shared link resolves. What is removed is the duplicate doorway: a
        "More" list earns its length only in proportion to how little of it
        repeats what the user can already reach.
      */
      /*
       * ─── «ویدیوهای آموزشی» IS NOT A MENU TILE ───────────────────────────
       * روی درخواست: «دکمه فیلم‌های آموزشی را از منو بیشتر ببر و بزار داخل
       * صفحه آزمایشگاه، بخش امکانات بیشتر، و اینکه فقط با زبان فارسی که
       * انتخاب می‌شه این گزینه بیاد».
       *
       * The Aparat video academy is a PERSIAN-ONLY destination — every course
       * is recorded in Farsi. Listing it in a menu shown to all twelve
       * languages put a doorway in front of eleven audiences that leads to a
       * room they cannot understand, which is worse than no doorway.
       *
       * So it moved into the Lab's «امکانات بیشتر» disclosure, gated on
       * `resolvedLanguage === 'fa'` (see src/pages/Lab.jsx). The `/aparat`
       * ROUTE still exists and still works for bookmarks, deep links and the
       * Learn tab — the same rule the /solana and /nft entries below follow:
       * a menu entry is discovery, a route is a contract.
       *
       * The video-glyph import that the removed tile used was dropped with it;
       * leaving an icon imported by nothing is how a tile quietly comes back
       * in a later merge (and `test/lab-screens.test.jsx` now fails the build
       * if the symbol reappears anywhere in this file, comment included).
       */
      { to: '/learn', key: 'learn.title', Icon: IconInfo, hue: 'var(--rgb-9)' },
      { to: '/audit', key: 'nav.audit', Icon: IconShield, hue: 'var(--rgb-4)' },
      { to: '/developers', key: 'nav.developers', Icon: IconKey, hue: 'var(--rgb-2)' },
      { to: '/ecosystem', key: 'nav.ecosystem', Icon: IconGlobe, hue: 'var(--rgb-3)' },
      { to: '/business', key: 'nav.business', Icon: IconBuilding, hue: 'var(--rgb-5)' },
      { to: '/about', key: 'nav.about', Icon: IconInfo, hue: 'var(--rgb-8)' },
      { to: '/settings', key: 'nav.settings', Icon: IconSettings, hue: 'var(--rgb-6)' }
    ]
  }
];

/*
 * The stylesheet is a separate (6 KB) chunk, loaded on demand, because this
 * sheet is not on the first paint of any screen — that policy stays.
 *
 * What changed is WHEN it is requested. It used to load on `open`, gated
 * behind a `menuStylesReady` flag, so the first tap on «بیشتر» had to wait for
 * a network round trip before anything was rendered — on a cold start that was
 * the whole open animation, spent on a blank panel. It now loads when this
 * component mounts (i.e. with the nav bar, on idle) AND on open, through one
 * shared promise: by the time anyone taps the button the styles are in memory,
 * and the tap renders immediately. The gate remains only as the guard for the
 * genuinely-first-millisecond case.
 */
let menuStylesPromise = null;
function loadMenuStyles() {
  if (!menuStylesPromise) {
    menuStylesPromise = import('../styles/more-menu.css')
      .then(() => true)
      /*
       * A failed chunk must not leave a dead button behind. The rejection is
       * swallowed (the sheet still opens, unstyled, which is ugly but usable),
       * and the cache is cleared so the next open retries instead of
       * re-returning the same rejection for the rest of the session.
       */
      .catch(() => {
        menuStylesPromise = null;
        return false;
      });
  }
  return menuStylesPromise;
}

const ALL = 'all';

export default function MoreSheet({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const still = useStill();
  const [pressed, setPressed] = useState(null);
  const [activeGroup, setActiveGroup] = useState(ALL);
  const [menuStylesReady, setMenuStylesReady] = useState(false);
  const panelRef = useRef(null);

  // Idle prefetch — see the note on loadMenuStyles above.
  useEffect(() => {
    let alive = true;
    let idle = null;
    let timer = null;
    const warm = () => {
      loadMenuStyles().then(() => { if (alive) setMenuStylesReady(true); });
    };
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(warm, { timeout: 2500 });
    } else {
      timer = window.setTimeout(warm, 1200);
    }
    return () => {
      alive = false;
      if (idle !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open || menuStylesReady) return undefined;
    let alive = true;
    loadMenuStyles().then(() => { if (alive) setMenuStylesReady(true); });
    return () => { alive = false; };
  }, [open, menuStylesReady]);

  /*
   * Scroll lock, Escape, and a focus loop that cannot leak behind the panel.
   *
   * Focus goes to the DIALOG, not to its first control: a screen reader should
   * announce «بیشتر» and the list, not read out the close button and leave the
   * user to guess what they are standing in. Tab from there walks the rows.
   */
  useEffect(() => {
    if (!open || !menuStylesReady) return undefined;
    const unlock = lockBodyScroll();
    const returnFocusTo = document.activeElement;
    const focusTimer = window.requestAnimationFrame(() => panelRef.current?.focus());
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      unlock();
      window.removeEventListener('keydown', onKey);
      if (returnFocusTo?.isConnected) returnFocusTo.focus?.();
    };
  }, [open, menuStylesReady, onClose]);

  // Reset the tap highlight and the filter when the drawer closes, or both
  // would still be set the next time it opens.
  useEffect(() => {
    if (!open) {
      setPressed(null);
      setActiveGroup(ALL);
    }
  }, [open]);

  const sections = (activeGroup === ALL ? GROUPS : GROUPS.filter((group) => group.id === activeGroup))
    .filter((group) => group.items.length > 0);

  const go = (to) => {
    haptic?.('light');
    setPressed(to);
    /*
     * Let the tap feedback land, then CLOSE FIRST and navigate one frame
     * later. The old order (navigate → onClose in the same tick) swapped the
     * route underneath a drawer whose exit animation had not started, so the
     * drawer, the page transition and the scroll-lock release all fought in
     * the same frame — visible as the menu's stutter on slower phones.
     * Closing first means exactly one panel and one backdrop exist at every
     * instant, and the outgoing page never morphs beneath the drawer.
     */
    setTimeout(() => {
      onClose?.();
      requestAnimationFrame(() => navigate(to));
    }, 90);
  };

  // Portalled for the same reason as Sheet: a transformed ancestor becomes the
  // containing block for `position: fixed`, so a drawer rendered inside an
  // animated page centres itself against the page box rather than the screen.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && menuStylesReady && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.16 }}
            /* Sibling-of-panel, as in Sheet: taps inside the panel cannot
               bubble to here, so onClose fires exactly once, only for a real
               backdrop tap. */
            onClick={onClose}
          />
          <div className="more-layer">
            <motion.div
              ref={panelRef}
              className="more-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="more-menu-title"
              data-testid="more-menu-dialog"
              tabIndex={-1}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: still ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="more-grabber" aria-hidden="true" />

              <header className="more-head">
                <h2 id="more-menu-title" className="more-title">{t('nav.more')}</h2>
                <button
                  className="more-close"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  type="button"
                  data-testid="more-menu-close"
                >
                  <IconX width={16} height={16} />
                </button>
              </header>

              {/*
                One tap per category, no counts, no labels that repeat the
                section headings below them. `aria-pressed` rather than
                tab/tabpanel: these are filters over one list, and a tablist
                without matching panels is an accessibility lie.
              */}
              <div className="more-filter" role="group" aria-label={t('nav.more')}>
                <button
                  type="button"
                  className="more-pill"
                  data-active={activeGroup === ALL}
                  aria-pressed={activeGroup === ALL}
                  onClick={() => setActiveGroup(ALL)}
                >
                  {t('nav.group.all')}
                </button>
                {GROUPS.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className="more-pill"
                    data-active={activeGroup === group.id}
                    aria-pressed={activeGroup === group.id}
                    onClick={() => setActiveGroup(group.id)}
                  >
                    {t(`nav.group.${group.id}`)}
                  </button>
                ))}
              </div>

              {/* `key` remounts the scroll box on a filter change so the rows
                  fade in once — the only motion in here, and it is CSS. */}
              <div className="more-scroll" data-testid="more-menu-content" key={activeGroup}>
                {sections.map((group) => (
                  <section key={group.id} className="more-group" aria-label={t(`nav.group.${group.id}`)}>
                    {activeGroup === ALL && (
                      <h3 className="more-group-title">{t(`nav.group.${group.id}`)}</h3>
                    )}
                    <div className="more-list" data-still={still ? 'true' : 'false'}>
                      {group.items.map((item) => (
                        <button
                          key={item.to + item.key}
                          type="button"
                          className="more-tile"
                          data-pressed={pressed === item.to ? 'true' : 'false'}
                          onClick={() => go(item.to)}
                          style={{ '--more-accent': item.hue }}
                        >
                          <span className="more-tile-icon" aria-hidden="true"><item.Icon width={18} height={18} /></span>
                          <span className="more-tile-label">{t(item.key)}</span>
                          <span className="more-tile-chevron" aria-hidden="true">
                            <IconChevronRight width={15} height={15} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
