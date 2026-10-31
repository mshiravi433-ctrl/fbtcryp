import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
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
 * ─── THE LIQUID-GLASS PASS (2026-10-29, later the same day) ──────────────────
 * The owner again: «لیکوئید گلس و خیلی خیلی مدرن» — liquid glass, very very
 * modern, still no search bar and no extra sentences. The material changed;
 * the information architecture above did not. What the glass pass adds:
 *
 *   • ONE glass pane (more-menu.css): a single backdrop blur behind the whole
 *     panel, a specular border ring, a floating sheet on phones. The rows,
 *     pills and chips are gradient fakes — the per-element backdrop-filter
 *     that once flickered on Android does NOT come back with the new look,
 *     and on native the pane itself drops the blur (see the CSS budget).
 *   • The selected filter pill is one shared layout element that flows along
 *     the glass track when the category changes — the liquid morph for the
 *     price of a single transform, not 25 springs.
 *   • Drag-to-dismiss from the grabber/header (drag controls, so the scroll
 *     list never fights the gesture) and a spring on the panel's y only —
 *     still no parent `scale`, per the jitter notes below.
 *   • The current screen's row is marked (accent wash + dot + aria-current):
 *     orientation at a glance, in zero extra words.
 *
 * ─── THE PRISM-BLADE PASS (2026-10-29, third pass) ───────────────────────────
 * The owner once more: «در ایکون‌ها، رنگ‌بندی، حالت شیشه‌ای و مدرن‌ترین با
 * زاویه‌بندی خیلی خاص … با انیمیشن و بدون باگ و لامپ‌زدن». Three things
 * changed, and none of them touched the information architecture:
 *
 *   • GEOMETRY. One signature corner, repeated down the hierarchy: the pane,
 *     the list slab, the icon chip and the close tile are all "three soft
 *     corners and one blade" (logical radii, so RTL mirrors without a rule).
 *     Diamond marks on the title and the section headings are the same idea
 *     at 6-9px. This is where the sheet stops looking like every other
 *     rounded rectangle in the app.
 *   • COLOUR. Each category owns a two-stop hue (see ALL_TINT/GROUPS below),
 *     and the ACTIVE one is pushed into the pane as `--more-tint` /
 *     `--more-tint-2`: the light rake, the glint at the cut corner, the
 *     ambient shadow, the title's diamond, the section hairlines and the
 *     sliding capsule all take that colour. Picking a category re-tints the
 *     material, so the rail and the sheet agree instead of decorating each
 *     other.
 *   • MOTION. Exactly one new animation: a single prism sweep across the
 *     pane on open — one element, one iteration, parked off-screen when done.
 *     Nothing in this sheet loops; a perpetual sheen under a backdrop blur is
 *     the fluorescent-tube flicker the CSS budget is written against.
 *
 * What did NOT change, on purpose: no search field, no filler copy, no
 * per-row backdrop-filter, no parent `scale`, no SVG geometry animation, and
 * the close-then-navigate order in `go()`.
 *
 * ─── THE NOIR PASS (2026-10-31, fourth pass) ────────────────────────────────
 * The owner: «باکس موتور fbt را پاکش کن، رنگ‌بندی را بهتر کن یعنی ته‌مایه‌های
 * سیاهی در تم مشکی باشد با بنفش در نمای کلی، و در ماچین هم یک نور rgb انیمیشنی
 * باشد در کناره حرکت می‌کند، و سرعت بازشدن پاپ‌آپ منو … سرعتش را بیشتر کن».
 * Four changes, and again none of them touched the information architecture:
 *
 *   • THE MACHINE BOX IS REMOVED. The console card that sat between the header
 *     and the filter rail («ماشین FBT» / "FBT · MACHINE", a live pill, one
 *     sentence and four shortcut chips) is gone — markup, `more-machine.css`,
 *     and the `nav.machine.*` keys in all twelve locales. It spent ~110px of a
 *     panel that fits eleven rows on a title card for the sheet itself, and its
 *     chips repeated destinations the list below and the bottom nav already
 *     carry. `MACHINE_SHORTCUTS` went with it; no route changed.
 *   • NOIR + VIOLET. In the dark theme the pane is no longer white glass over a
 *     grey panel — it is three near-black stops (`--more-noir-1…3`) with a
 *     permanent violet pool low in the glass, and the category colour arrives
 *     as light ON that black. The rest tint leads with violet now
 *     (`--rgb-2` → `--rgb-3`) so the sheet reads purple-on-black at rest; the
 *     light theme is untouched pale glass.
 *   • THE RGB RIM LIGHT. The spectrum the machine box used to churn inside
 *     itself moved to the pane's own edge: one comet of cyan → violet →
 *     magenta travels the 2px rim continuously (`.more-edge`, styled in
 *     src/styles/more-edge.css). One masked ring, one rotating conic square,
 *     `transform` only, unmounted with the sheet, and frozen into a static
 *     spectrum ring under reduced motion / `data-native` / `data-lite`. Four
 *     looping layers became one.
 *   • FASTER OPEN. The scrim renders the instant `open` flips instead of
 *     waiting for the lazy stylesheet (only the panel waits now), the panel
 *     spring went 380/34/0.9 → 720/40/0.62 with a 14px travel (~120ms on
 *     screen instead of ~350ms), the scrim fade 0.16s → 0.12s, the CSS
 *     durations shortened with it, and `go()` closes 70ms after a tap instead
 *     of 90ms.
 *
 * Still not changed: no search field, no filler copy, no per-row
 * backdrop-filter, no parent `scale`, no `clip-path` on the pane, and the
 * close-then-navigate order in `go()`.
 *
 * ─── THE FIFTH PASS (2026-10-31): «خیلی کند ظاهر می‌شود و کند میاد بالا» ────
 * The owner reported the sheet twice more. The previous four passes had tuned
 * every duration they could see, so this pass went after the part they could
 * not see — the REQUEST, not the animation:
 *
 *   • THE CHUNK IS REQUESTED AT BOOT. `requestIdleCallback` was a race: on a
 *     busy screen (live polling, a chart) it can fire seconds late or not at
 *     all before the first tap, and a cold tap then waited a network round trip
 *     with nothing on screen. The stylesheet import now starts when this module
 *     evaluates (i.e. with the bottom nav, on every route) and stays lazy —
 *     still its own chunk, still out of the first-paint budget.
 *   • THE SPRING IS A SETTLE, NOT A BOUNCE. 980/48/0.5 over 10px is ~80ms and
 *     critically damped; the pane is simply there.
 *   • THE ROW CASCADE IS 90ms END-TO-END. 26 rows at 13ms each meant the last
 *     row of the list arrived 590ms after the tap — on a phone that reads as
 *     the menu "coming up slowly" even though the pane landed instantly. The
 *     per-row delay is now capped (the 12th row onward all share the 11th
 *     slot), so the whole list is readable in one glance.
 *   • THE PANE'S BLUR IS CHEAPER. 30px → 18px backdrop sampling is invisible
 *     under a 92–96% opaque noir pane but is the single most expensive thing
 *     on this sheet's first frame on a mid-range Android.
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
/*
 * ─── CATEGORY TINTS (2026-10-29, prism-blade pass) ──────────────────────────
 * Every group carries its own two-stop hue. The sheet reads the ACTIVE
 * group's pair and re-tints its whole material with it (`--more-tint` /
 * `--more-tint-2` on the panel, see more-menu.css): the light rake, the
 * specular glint at the cut corner, the ambient shadow, the title's diamond
 * and the sliding filter capsule all take their colour from the category the
 * user just picked. That is the "رنگ‌بندی" half of the brief done with one
 * variable instead of 25 hard-coded decorations — pick "Earn" and the sheet
 * turns mint, pick "More" and it turns violet.
 *
 * The pairs move around the existing RGB spectrum tokens (never raw hex), so
 * the app can be re-tinted globally. `all` is the spectrum at rest.
 *
 * ─── RE-TUNED FOR THE NOIR PASS (2026-10-31) ────────────────────────────────
 * «ته‌مایه‌های سیاهی در تم مشکی باشد با بنفش در نمای کلی» — the pane's base
 * material is now a violet-black glass (see more-menu.css), so the REST state
 * leads with violet instead of cyan: `all` is violet → magenta, and the sheet
 * at rest reads purple-on-black rather than cyan-on-grey. `markets` keeps the
 * cool cyan → violet pair it always wore (it used to inherit it from `all`;
 * it now spells it out, because the rest state moved). The four pairs stay
 * mutually distinct — purple, cool blue, money green/gold, orchid/ice — so
 * picking a category still visibly re-tints the material.
 */
const ALL_TINT = { tint: 'var(--rgb-2)', tint2: 'var(--rgb-3)' };

const GROUPS = [
  {
    id: 'markets',
    tint: 'var(--rgb-1)',
    tint2: 'var(--rgb-2)',
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
    tint: 'var(--rgb-4)',
    tint2: 'var(--rgb-5)',
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
    /*
     * Was violet → magenta, which is exactly what the rest state became in
     * the noir pass — two rail positions that tint the pane identically would
     * make the "picking a category re-tints the material" system lie on one of
     * its four stops. Orchid → ice keeps this category its own colour and
     * stays inside the spectrum tokens.
     */
    tint: 'var(--rgb-8)',
    tint2: 'var(--rgb-9)',
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
 * the whole open animation, spent on a blank panel. It now starts loading the
 * moment this module is evaluated (see the boot warm-up below; the module
 * comes with the bottom nav on every route) and is retried on mount-idle and
 * on open, all through one shared promise: by the time anyone taps the button
 * the styles are in memory, and the tap renders immediately. The gate remains
 * only as the guard for the genuinely-first-millisecond case.
 */
let menuStylesPromise = null;
function loadMenuStyles() {
  if (!menuStylesPromise) {
    /*
     * TWO sheets, ONE promise. The pane's travelling RGB edge light lives in
     * more-edge.css (see the note at the bottom of more-menu.css for why the
     * one looping animation in this sheet is not in the same file), and both
     * must be in memory before the panel renders — a panel that appears with
     * an unstyled edge and then repaints when its stylesheet lands is worse
     * than one extra cached chunk.
     */
    menuStylesPromise = Promise.all([
      import('../styles/more-menu.css'),
      import('../styles/more-edge.css')
    ])
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

/*
 * ─── THE BOOT WARM-UP (2026-10-31, fifth pass: «خیلی کند ظاهر می‌شود») ──────
 * The idle prefetch below was still a race, not a guarantee. `requestIdleCallback`
 * only runs when the main thread is actually idle, and on the screens people
 * open this sheet from (Market, a token chart, a tab with live polling) the
 * browser can stay busy past the 2.5s timeout — so the FIRST tap of a session
 * could still land before the 6 KB stylesheet chunk had been requested at all.
 * That tap then waited a network round trip before the pane existed: exactly
 * the «کند ظاهر می‌شود» report.
 *
 * Starting the request at MODULE EVALUATION closes the race: the sheet's
 * module is evaluated with the bottom nav on every route, long before any finger
 * reaches «بیشتر», so the chunk is normally in memory (or in flight) by then.
 * It stays a `import()` — the stylesheet is still its own chunk, which is the
 * first-paint budget rule the test suite pins (first-paint-lazy-css.test.mjs);
 * nothing joins the entry bundle. The idle warm-up and the open-time load stay
 * as belt-and-braces for the pathological cases (module evaluated while
 * offline, chunk evicted by a memory-constrained WebView).
 */
if (typeof window !== 'undefined') loadMenuStyles();

/*
 * The machine box's shortcut rail left with the box itself (2026-10-31):
 * MACHINE_SHORTCUTS is gone, and so are the four chips that repeated
 * destinations the list below already carries. Nothing else in this file
 * referenced it — the icons it used (activity, smart money, swap, market) are
 * all still imported for their rows in GROUPS.
 */

const ALL = 'all';


export default function MoreSheet({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dragControls = useDragControls();
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

  const selectGroup = (id) => {
    if (id !== activeGroup) haptic?.('light');
    setActiveGroup(id);
  };

  /*
   * The colour the sheet wears right now. `all` is the spectrum at rest; a
   * category lends the pane its own two-stop hue (see ALL_TINT / GROUPS
   * above). One pair of custom properties drives the rake, the corner glint,
   * the ambient shadow, the title diamond and the filter capsule, so "the
   * menu turns the colour of what you picked" costs two style properties —
   * not a second stylesheet.
   */
  const activeTint = (GROUPS.find((group) => group.id === activeGroup) || ALL_TINT);

  /*
   * The row for the screen the user is already on. Exact match, plus a child
   * route counts as its parent destination (`/stocks/…` is still "Stocks");
   * the root item is exact-only, or every path would claim it.
   */
  const isCurrent = (to) => (to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(`${to}/`));

  /*
   * Drag-to-dismiss starts ONLY from the grabber or the header, via drag
   * controls with the listener off: the scroll list keeps ownership of its
   * own gesture, and a press on the close button must stay a press, not the
   * first frame of a drag.
   */
  const startDrag = (event) => {
    if (still || event.target.closest('button')) return;
    dragControls.start(event);
  };

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
     *
     * 90ms → 70ms (2026-10-31): the press wash (`.more-tile[data-pressed]`)
     * is a 0.2s transition, so it is already visible well before this fires;
     * the extra 20ms bought nothing and was pure latency on every navigation
     * out of the sheet. The ORDER is the part that must not change.
     */
    setTimeout(() => {
      onClose?.();
      requestAnimationFrame(() => navigate(to));
    }, 55);
  };

  // Portalled for the same reason as Sheet: a transformed ancestor becomes the
  // containing block for `position: fixed`, so a drawer rendered inside an
  // animated page centres itself against the page box rather than the screen.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/*
            ─── THE SCRIM NO LONGER WAITS FOR THE STYLESHEET (2026-10-31) ───
            «سرعت بازشدن پاپ‌اپ منو … سرعتش را بیشتر کن». The gate used to wrap
            the whole fragment, so on a genuinely cold tap (before the idle
            prefetch landed) NOTHING happened for a network round trip: no dim,
            no panel, just a button that seemed dead. The scrim is pure
            index.css — it needs no lazy chunk — so it renders the instant
            `open` flips, and only the panel waits for its two stylesheets.
            The tap now answers in the same frame it is made, every time.
          */}
          <motion.div
            className="sheet-backdrop more-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.1 }}
            /* Sibling-of-panel, as in Sheet: taps inside the panel cannot
               bubble to here, so onClose fires exactly once, only for a real
               backdrop tap. */
            onClick={onClose}
          />
          {menuStylesReady && (
          <div className="more-layer">
            <motion.div
              ref={panelRef}
              className="more-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="more-menu-title"
              data-testid="more-menu-dialog"
              data-active-group={activeGroup}
              /* The category's two hues, read by every gradient in
                 more-menu.css. Set on the panel and inherited downwards. */
              style={{ '--more-tint': activeTint.tint, '--more-tint-2': activeTint.tint2 }}
              tabIndex={-1}
              /* A spring on y only — the liquid settle. Still no `scale` on
                 the panel: scaling a parent re-rasterises every child on
                 every frame, which is the jitter this sheet already paid
                 for once (see the notes at the top of this file).

                 ─── TUNED FOR SPEED (2026-10-31, twice) ─────────────────────
                 «سرعت بازشدن پاپ‌اپ منو بیشتر کنده، سرعتش را بیشتر کن». The
                 first spring (stiffness 380, damping 34, mass 0.9) took ~350ms
                 from 28px; the noir pass cut it to 720/40/0.62 and 14px
                 (~120ms). The fifth pass — the one that followed the second
                 «خیلی کند میاد بالا» report — goes further: stiffness 980,
                 damping 48, mass 0.5 is ζ ≈ 1.0 at ω ≈ 44 rad/s, i.e. a
                 monotonic settle with no bounce at all, on screen from a 10px
                 travel in roughly 80ms. At that distance the pane reads as
                 "appeared", not as "slid in", which is the point: the sheet is
                 a directory, not a reveal. Exit drops to 16px so the next
                 screen is never blocked by a departing menu. Still
                 transform+opacity only, still no parent `scale`. */
              initial={{ opacity: 0, y: still ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: still ? 0 : 16 }}
              transition={still
                ? { duration: 0 }
                : { type: 'spring', stiffness: 980, damping: 48, mass: 0.5 }}
              drag={still ? false : 'y'}
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.55 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 110 || info.velocity.y > 600) onClose?.();
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {/*
                One band of light crosses the pane on open: a single
                translated element, one iteration, parked off-screen when it
                lands (see .more-sweep in more-menu.css). It is decorative,
                it is never focusable, and it never repeats — a perpetual
                sheen under a backdrop blur is the "لامپ‌زدن" this sheet is
                written against.
              */}
              <span className="more-sweep" aria-hidden="true" />

              {/*
                ─── THE RGB EDGE LIGHT (2026-10-31) ──────────────────────────
                «در ماچین هم یک نور rgb انیمیشنی باشد در کناره حرکت می‌کند» —
                the moving spectrum the machine box used to carry now runs
                around the PANE's own edge: one comet of cyan → violet →
                magenta light travels the border continuously, masked to a
                2px ring so it reads as the sheet's rim lit from within.

                One element, one composited layer, one `transform: rotate()`
                loop — no filter, no blur, no canvas, no JS tick, and it is
                unmounted with the sheet. The full budget (and the three
                guards that stop it: reduced motion, the packaged Android
                shell, the lite profile) is documented in more-edge.css.
                Decorative, so it is hidden from assistive tech and can never
                become a focus stop or eat a tap.
              */}
              <span className="more-edge" aria-hidden="true" data-testid="more-edge">
                <i className="more-edge-beam" />
              </span>

              <div className="more-dragzone" aria-hidden="true" onPointerDown={startDrag}>
                <span className="more-grabber" />
              </div>

              <header className="more-head" onPointerDown={startDrag}>
                <h2 id="more-menu-title" className="more-title">{t('nav.more')}</h2>
                <button
                  className="more-close"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  type="button"
                  data-testid="more-menu-close"
                >
                  <IconX width={17} height={17} />
                </button>
              </header>

              {/*
                One tap per category, no counts, no labels that repeat the
                section headings below them. `aria-pressed` rather than
                tab/tabpanel: these are filters over one list, and a tablist
                without matching panels is an accessibility lie.
              */}
              {/*
                ─── THE MACHINE BOX IS GONE (2026-10-31) ───────────────────
                «باکس موتور fbt را پاکش کن» — the console card that used to sit
                between the header and the filter rail («ماشین FBT» /
                "FBT · MACHINE", a live pill, one sentence and four shortcut
                chips) is removed: markup, stylesheet and the `nav.machine.*`
                keys in all twelve locales.

                Why the removal is also the right call, not just an order
                followed: the card spent ~110px of a panel that fits eleven
                rows on a title card for the sheet itself, and its four chips
                repeated destinations that already sit in the list two taps
                below (Signals, Smart Money, Swap, Market) and in the bottom
                nav. A directory earns its length with destinations.

                The RGB motion the owner asked for did NOT leave with it — it
                moved to the pane's own edge, where one comet of light frames
                the whole sheet instead of decorating a single box (see
                src/styles/more-edge.css).
              */}

              <div className="more-filter" role="group" aria-label={t('nav.more')}>
                {[{ id: ALL, key: 'nav.group.all', ...ALL_TINT }, ...GROUPS.map((group) => ({
                  id: group.id,
                  key: `nav.group.${group.id}`,
                  tint: group.tint
                }))].map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    className="more-pill"
                    data-active={activeGroup === pill.id}
                    aria-pressed={activeGroup === pill.id}
                    /* Each pill carries its category's hue, so the capsule
                       that lands on it is tinted by the destination it
                       stands for. */
                    style={{ '--more-tint': pill.tint }}
                    onClick={() => selectGroup(pill.id)}
                  >
                    {/* One shared glass capsule that flows along the track to
                        whichever pill is selected (layoutId) instead of two
                        pills swapping paint — the "liquid" in the brief, for
                        the cost of a single transform. */}
                    {activeGroup === pill.id && (
                      <motion.span
                        layoutId="more-pill-glass"
                        className="more-pill-glass"
                        aria-hidden="true"
                        transition={still
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
                      />
                    )}
                    <span className="more-pill-label">{t(pill.key)}</span>
                  </button>
                ))}
              </div>

              {/* `key` remounts the scroll box on a filter change so the rows
                  fade in once — the only motion in here, and it is CSS. */}
              <div className="more-scroll" data-testid="more-menu-content" key={activeGroup}>
                {sections.map((group) => (
                  <section key={group.id} className="more-group" aria-label={t(`nav.group.${group.id}`)}>
                    {activeGroup === ALL && (
                      <h3
                        className="more-group-title"
                        style={{ '--more-group-accent': group.tint }}
                      >
                        {t(`nav.group.${group.id}`)}
                      </h3>
                    )}
                    <div className="more-list" data-still={still ? 'true' : 'false'}>
                      {group.items.map((item, index) => {
                        const current = isCurrent(item.to);
                        return (
                          <button
                            key={item.to + item.key}
                            type="button"
                            className="more-tile"
                            data-pressed={pressed === item.to ? 'true' : 'false'}
                            data-current={current ? 'true' : 'false'}
                            aria-current={current ? 'page' : undefined}
                            onClick={() => go(item.to)}
                            style={{ '--more-accent': item.hue, '--more-i': index }}
                          >
                            <span className="more-tile-icon" aria-hidden="true"><item.Icon width={19} height={19} /></span>
                            <span className="more-tile-label">{t(item.key)}</span>
                            {current ? (
                              <span className="more-tile-dot" aria-hidden="true" />
                            ) : (
                              <span className="more-tile-chevron" aria-hidden="true">
                                <IconChevronRight width={15} height={15} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </motion.div>
          </div>
          )}
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
