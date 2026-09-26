#!/usr/bin/env node
/**
 * CRAWLABLE LANDING PAGES
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS GENERATOR CAN AND CANNOT PROVE ───────────────────────────────
 * The app uses hash-based routes (for example `/#/swap`). A fragment is not
 * sent in an HTTP request, so those in-app screens do not become separate
 * crawlable documents merely because a router has a route for them. The
 * explicit, server-rendered landing pages below provide distinct HTML URLs.
 *
 * This script also writes the sitemap and robots file into the build output,
 * but a successful build does NOT prove that Google fetched or indexed them.
 * Use Google Search Console URL Inspection and the submitted sitemap after
 * deployment; a `site:` query is not a reliable substitute for that evidence.
 *
 * The current workspace cannot confirm live index status, Search Console
 * ownership or production delivery. Do not describe those states as verified
 * until they have been checked against the live property.
 *
 * ─── WHY STATIC HTML AND NOT SSR ────────────────────────────────────────────
 * Server-side rendering would mean a rendering server, a second code path for
 * every screen, and a per-request cost. The owner's constraint is explicit:
 * «فعلا پول نمیشه خرج کرد» — no money to spend.
 *
 * These pages cost nothing. They are generated at build time, served as plain
 * files by the hosting we already pay nothing for, and each one immediately
 * hands the visitor into the real app. No server, no runtime, no maintenance
 * beyond the table below.
 *
 * ─── WHY THIS IS NOT CLOAKING ───────────────────────────────────────────────
 * Worth stating plainly, because generated pages for crawlers can be exactly
 * that and Google penalises it hard.
 *
 * A crawler and a person are served the SAME file. There is no user-agent
 * sniffing anywhere. The content is genuine, human-written prose describing a
 * real feature that really exists, and the link into the app is a normal
 * anchor a person is meant to click. That is a landing page, which is
 * ordinary and allowed. Cloaking is showing different content to the crawler
 * than to the user, and nothing here does that.
 *
 * ─── THE HONESTY RULE FOR THE COPY ──────────────────────────────────────────
 * Every claim below has to be true of the shipped app. The old <title>
 * advertised "9 Chains" and Tron support that does not exist. If inaccurate
 * copy is surfaced in search, it misleads visitors; this repository alone
 * cannot confirm which version Google currently shows. Do not add a page here
 * for a feature until it works.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderLandingV2, V2_PAGE } from './landing-v2/index.mjs';
import {
  MARKET_DASHBOARD_STYLES,
  marketDashboardScript as renderMarketDashboardScript,
  renderMarketDashboard
} from './landing-v2/market-dashboard.mjs';

/*
 * ─── THE CANONICAL HOME IS NOW fbtswap.ir ───────────────────────────────────
 * The primary hostname is `fbtswap.ir`; this keeps canonical URLs consistent
 * with the product identity and avoids splitting signals across hostnames. A
 * matching brand/domain can improve recognition and trust for people, but it
 * does not by itself guarantee a ranking or prove that a page is indexed.
 *
 * `fbtswap.ir` also matches the APK id (`ir.fbt.swap`) and the X handle.
 * SITE is overridable so a preview deploy does not claim to be production —
 * canonical tags must point at the intended public version of each page.
 */
const SITE = (process.env.VITE_PUBLIC_URL || 'https://fbtswap.ir').replace(/\/+$/, '');
const OUT = 'dist';

/**
 * Encode a slug for a URL. `encodeURIComponent` on the whole slug would
 * turn the `/` in the Persian-language paths (`fa/crypto-swap-without-kyc`)
 * into `%2F`, which is a different (and uglier) URL — so each segment is
 * encoded on its own. ASCII slugs pass through untouched.
 */
const slugPath = (slug) => slug.split('/').map(encodeURIComponent).join('/');

/*
 * ─── THE ICON SET ────────────────────────────────────────────────────────────
 * One hand-tuned stroke icon per topic, drawn as inline SVG so the pages stay
 * single-file (no sprite request, no layout shift: every chip has a fixed
 * size). `pathLength` is NOT set, because these icons animate by transform
 * and glow rather than by stroking — the motion budget at the bottom of the
 * stylesheet decides which of these ever moves on a phone.
 */
const ICON_PATHS = {
  swap: '<path d="M7 4 3.5 7.5 7 11"/><path d="M3.5 7.5H16a4 4 0 0 1 4 4v1"/><path d="m17 20 3.5-3.5L17 13"/><path d="M20.5 16.5H8a4 4 0 0 1-4-4v-1"/>',
  wallet: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5v2.5"/><path d="M3.5 7.5V17A2.5 2.5 0 0 0 6 19.5h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2.5H6"/><circle cx="16.2" cy="13.8" r="1.2"/>',
  shield: '<path d="M12 3.5 5.2 6.1v5.2c0 4.3 2.9 7.3 6.8 8.7 3.9-1.4 6.8-4.4 6.8-8.7V6.1Z"/><path d="m9.2 11.9 2.1 2.1 3.7-3.9"/>',
  bell: '<path d="M6.2 9.7a5.8 5.8 0 0 1 11.6 0c0 3.1.8 4.5 1.6 5.5.3.4 0 .8-.5.8H5.1c-.5 0-.8-.4-.5-.8.8-1 1.6-2.4 1.6-5.5Z"/><path d="M10 19.2a2 2 0 0 0 4 0"/>',
  chart: '<path d="M4 4.5v15h16"/><path d="m7 14.5 3.2-4 2.9 2.5 4.4-6"/><path d="M17.5 7h.01"/>',
  history: '<path d="M4.6 7.4A8.5 8.5 0 1 1 3.5 12"/><path d="M3.5 7.5V12H8"/><path d="M12 8v4l2.8 1.9"/>',
  leaf: '<path d="M12 20.5v-9.3"/><path d="M12 13.2c0-3.7-3-6.7-6.7-6.7 0 3.7 3 6.7 6.7 6.7Z"/><path d="M12 10.8c0-3 2.5-5.4 5.4-5.4.3 3-2.4 5.4-5.4 5.4Z"/>',
  solana: '<path d="M7.2 5.2h11.6l-3.2 3.6H4Z"/><path d="M7.2 10.2h11.6l-3.2 3.6H4Z"/><path d="M7.2 15.2h11.6l-3.2 3.6H4Z"/>',
  book: '<path d="M4.5 6.3A2.3 2.3 0 0 1 6.8 4h12.7v13.7H6.8a2.3 2.3 0 0 0-2.3 2.3Z"/><path d="M4.5 20V6.3"/><path d="M8.6 8.3h6.9M8.6 11.5h4.6"/>',
  code: '<path d="m8.7 7.2-4.9 4.8 4.9 4.8"/><path d="m15.3 7.2 4.9 4.8-4.9 4.8"/>',
  pulse: '<path d="M3 12.5h3.6l2.6-6.8 4.4 12 2.4-5.2H21"/>',
  globe: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.7 2.3 4 5.1 4 8.4s-1.3 6.1-4 8.4c-2.7-2.3-4-5.1-4-8.4s1.3-6.1 4-8.4Z"/>',
  receipt: '<path d="M6.3 3.5h11.4V20l-2.1-1.5-1.6 1.2-2-1.4-2 1.4-1.6-1.2L6.3 20Z"/><path d="M9.3 8.2h5.4M9.3 11.7h5.4"/>',
  key: '<circle cx="7.8" cy="15" r="4"/><path d="m10.8 12 8.4-8.4"/><path d="m16.2 6.6 2.6 2.6M13.6 9.2l2 2"/>',
  privacy: '<path d="m4 4.5 16 15"/><path d="M9.6 5.6a9.8 9.8 0 0 1 2.4-.3c4.4 0 7.9 3 9.4 6.7a13.8 13.8 0 0 1-2.8 4M6.3 7.2A13 13 0 0 0 2.6 12c1.5 3.7 5 6.7 9.4 6.7 1.5 0 2.9-.3 4.1-.9"/><path d="M10.1 10.3a2.7 2.7 0 0 0 3.7 3.9"/>',
  grid: '<rect x="4" y="4" width="7.2" height="7.2" rx="2.2"/><rect x="12.8" y="4" width="7.2" height="7.2" rx="2.2"/><rect x="4" y="12.8" width="7.2" height="7.2" rx="2.2"/><rect x="12.8" y="12.8" width="7.2" height="7.2" rx="2.2"/>',
  spark: '<path d="M12 3.6 13.9 10l6.5 2-6.5 2L12 20.4 10.1 14l-6.5-2 6.5-2Z"/>',
  alert: '<path d="M12 4.3 2.9 19.4h18.2Z"/><path d="M12 10.2v4.1"/><path d="M12 16.9h.01"/>',
  layers: '<path d="m12 3.6 8.4 4.6L12 12.8 3.6 8.2Z"/><path d="m3.6 12.3 8.4 4.6 8.4-4.6"/><path d="m3.6 16.2 8.4 4.6 8.4-4.6"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.6 3.6V16h-.9A2.5 2.5 0 0 1 4 13.5Z"/><path d="M8.3 9h7.4M8.3 12h4.6"/>',
  arrow: '<path d="M7 17 17 7"/><path d="M9.5 7H17v7.5"/>',
  network: '<circle cx="5.6" cy="12" r="2.3"/><circle cx="18.4" cy="5.9" r="2.3"/><circle cx="18.4" cy="18.1" r="2.3"/><path d="m7.8 10.9 8.4-4M7.8 13.1l8.4 4"/>',
  check: '<path d="m5.5 12.6 4.3 4.3L18.5 7.4"/>'
};
const iconSvg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.spark}</svg>`;
/** A fixed-size icon tile. Never layout-shifts: the chip is sized in CSS. */
const iconChip = (name, extra = '') =>
  `<span class="icon-chip${extra ? ' ' + extra : ''}" aria-hidden="true">${iconSvg(name)}</span>`;

/* Icons for the "at a glance" cards when a page does not name its own.
   Deterministic per position, so every build renders the same page. */
const FACT_ICON_CYCLE = ['wallet', 'shield', 'chart', 'bell', 'leaf', 'globe', 'key', 'receipt', 'pulse', 'book', 'layers', 'history', 'spark', 'network', 'code', 'solana'];
/* The four idle animations an icon chip may run. Assigned round-robin so a
   grid of cards never pulses in unison — the wave reads as life, not as a
   strobe. All of them are switched off by the motion budget below. */
const FX_CYCLE = ['fx-float', 'fx-breathe', 'fx-orbit', 'fx-tilt'];

/* The library groups its directory by these topics; the labels are part of
   the visible page in both languages. */
const TOPICS = {
  swap: { en: 'Swap & custody', fa: 'سواپ و نگهداری دارایی' },
  market: { en: 'Markets, charts & alerts', fa: 'بازار، نمودار و هشدار قیمت' },
  invest: { en: 'Investing, yield & stocks', fa: 'سرمایه‌گذاری، بازده و سهام' },
  learn: { en: 'Learning, guides & blog', fa: 'آموزش، راهنماها و وبلاگ' }
};
const TOPIC_ORDER = ['swap', 'market', 'invest', 'learn'];

/**
 * One entry per page.
 *
 * Kept deliberately short. A handful of pages about things people actually
 * search for beats thirty thin pages, which search engines treat as a quality
 * signal against the whole domain.
 *
 * `route` is the in-app hash destination the visitor is sent to.
 */
const PAGES = [
  {
    slug: 'non-custodial-crypto-swap',
    icon: 'key',
    topic: 'swap',
    lang: 'en',
    route: '/#/swap',
    title: 'Non-Custodial Crypto Swap — Keep Your Own Keys | FBT Swap',
    description:
      'Swap tokens across 17 supported networks without giving up your private keys. No account, no email, no identity check. You sign every trade from your own wallet.',
    h1: 'Swap crypto without giving up your keys',
    body: [
      'FBT Swap is a non-custodial exchange interface. You connect a wallet you already own, you swap, and your assets never leave your control. There is no account to create, no email to hand over and no identity check to pass.',
      'It does not run an order book and holds no liquidity of its own. It asks public aggregators for the best route across the decentralised exchanges on the network you chose, shows you the quote, the price impact and the fee, then hands the transaction to your wallet. You are the one who signs it, and the swap settles on-chain directly between your wallet and the protocol.',
      'Because nobody here holds your keys, this also means what you would expect: we cannot reverse a transaction, freeze funds, or recover a lost recovery phrase. Nobody can.'
    ],
    facts: [
      ['Networks', 'BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Berachain, Unichain, Monad, Mantle, Scroll, zkSync Era, Robinhood Chain and Solana'],
      ['Platform fee', '0.70% of the input amount, shown on screen before you sign, on every supported network'],
      ['Custody', 'None. Your keys stay in your wallet'],
      ['Signup', 'Not required']
    ],
    faqs: [
      {
        q: 'Do I need an account or identity check to swap?',
        a: 'No FBT Swap account is required for the on-chain swap interface. You connect a wallet you control and sign the transaction there. Your wallet or a third-party protocol can still show its own security checks.'
      },
      {
        q: 'Does FBT Swap hold my crypto or recovery phrase?',
        a: 'No. FBT Swap does not take deposits, hold a recovery phrase, or sign in place of a user. Assets remain in the connected wallet and each transaction requires the wallet holder’s approval.'
      },
      {
        q: 'Which networks can I use?',
        a: 'The supported networks are BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Berachain, Unichain, Monad, Mantle, Scroll, zkSync Era, Robinhood Chain and Solana. Check the selected network carefully before sending or signing.'
      }
    ]
  },
  {
    slug: 'crypto-price-alerts-and-dca',
    icon: 'bell',
    topic: 'market',
    lang: 'en',
    route: '/#/orders',
    title: 'Crypto Price Alerts and Recurring Buys | FBT Swap',
    description:
      'Set a crypto price target, trailing stop or recurring-buy reminder without granting custody. You decide whether to sign every swap.',
    h1: 'Price alerts and recurring buys',
    body: [
      'Set a target price on a supported pair and FBT Swap keeps the condition with your order. When notification delivery is enabled and available, a price-triggered alert can reach your device; otherwise the order remains visible when you next open the app.',
      'Recurring buys work as reminders: choose an amount and an interval, then review and sign each swap yourself. Spreading entries over time is what most people mean by dollar-cost averaging, and it removes the pressure to choose one exact entry point.',
      'These are alerts, not automatic trades, and the difference is deliberate. Filling an order while you sleep requires somebody to hold your funds or an unlimited spending allowance over them. This app does neither, so nothing can move money without you signing for it. A limit order that silently does not fill would be worse than no feature at all, so the limitation is stated on the screen itself.'
    ],
    facts: [
      ['Order types', 'Price target, trailing stop, take-profit/stop-loss, ladder and recurring-buy reminder'],
      ['Alerts', 'Delivered when notifications are enabled and available; otherwise retained in the app'],
      ['Execution', 'You sign every swap — nothing is automatic'],
      ['Custody', 'None. No spending allowance is requested']
    ],
    faqs: [
      {
        q: 'Will FBT Swap trade automatically when my target is reached?',
        a: 'No. It records and watches a condition, then asks you to review and sign the swap. The service does not hold funds or keep an allowance that could move them without your approval.'
      },
      {
        q: 'Can a price alert reach me when the app is closed?',
        a: 'A price-triggered alert can be delivered outside the app when notifications are enabled and the delivery service is available. Delivery depends on device settings and connectivity, so it is a reminder rather than a guaranteed execution service.'
      },
      {
        q: 'What does recurring buy mean here?',
        a: 'It is a scheduled reminder to review a planned purchase at your chosen interval. Each swap remains a separate transaction that you approve in your own wallet.'
      }
    ]
  },
  {
    slug: 'crypto-market-history-analysis',
    icon: 'history',
    topic: 'market',
    lang: 'en',
    route: '/#/signals',
    title: 'Crypto Chart History — What the Past Actually Says | FBT Swap',
    description:
      'See how often a price level has held, the worst drawdown in the window, and how today’s volume compares to normal. Measurements from real data, not predictions.',
    h1: 'What the past actually says',
    body: [
      'Most chart tools give you a snapshot: an RSI reading, a moving average, one support line. None of that answers the question people actually ask before setting a target price — has the market been here before, and what happened?',
      'This app measures repeated behaviour across the whole series. It finds the levels price keeps returning to and counts the touches, reports how often each one held versus broke, shows the worst peak-to-trough fall in the window, and compares today’s volume to this coin’s own median rather than to some absolute number.',
      'Nothing here forecasts anything, and that is the point. "This level was tested four times and held three" is a fact about data that already exists. "This level will hold" is a guess. A level that held four times can break on the fifth, and the app says so on the same screen.'
    ],
    facts: [
      ['Levels', 'Counted touches, with a held-versus-broke record'],
      ['Drawdown', 'Worst peak-to-trough fall in the window'],
      ['Volume', 'Compared to this coin’s own median, not an absolute figure'],
      ['Forecasts', 'None. Every figure describes data that already happened']
    ],
    faqs: [
      {
        q: 'Does this chart analysis predict the next price?',
        a: 'No. It summarizes measurements from past price and volume data. A support level that held before can still break, and no historical indicator guarantees a future result.'
      },
      {
        q: 'What does a held-versus-broke level show?',
        a: 'It counts how often price returned to a level in the selected history and whether it held or moved through it. It is context for research, not a trading instruction.'
      },
      {
        q: 'Is this financial advice?',
        a: 'No. Crypto assets are volatile and on-chain transactions are irreversible. Make your own decision and never trade money you cannot afford to lose.'
      }
    ]
  },

  /*
   * ─── THE DEX LANDING MOVED TO ITS OWN GENERATOR ─────────────────────────
   * «/صرافی-غیرمتمرکز» is no longer rendered from this table. It became the
   * flagship bilingual landing page (English default + full Persian, live
   * market data, the whole FBT Financial OS story) and genuinely outgrew
   * this shared template: it now lives in scripts/landing-v2/ and main()
   * below emits it alongside these pages, to the same URL, into the same
   * sitemap. Its hreflang pairing with 'non-custodial-crypto-swap' was
   * dropped rather than kept stale: the new page is not a translation of
   * that guide, it self-declares en + fa + x-default for its own two
   * languages, and the English guide stands alone — a missing pair is
   * honest, a wrong one is not.
   *
   * The other Persian guide pages stay exactly where they were.
   */

  /*
   * Persian search intent pages. These are deliberately feature pages, not
   * token-pair templates: each answers a distinct question a real visitor has
   * and points to the screen that performs the described task.
   */
  {
    slug: 'fa/crypto-price-alerts-and-dca',
    icon: 'bell',
    topic: 'market',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/orders',
    title: 'هشدار قیمت ارز دیجیتال و خرید پله‌ای | اف‌بی‌تی سواپ',
    description:
      'برای قیمت هدف، حد ضرر متحرک یا خرید پله‌ای ارز دیجیتال یادآور بگذار. دارایی پیش خودت می‌ماند و هیچ سواپی بدون امضای تو انجام نمی‌شود.',
    h1: 'هشدار قیمت ارز دیجیتال و خرید پله‌ای، بدون سپردن دارایی',
    body: [
      'اگر نمی‌خواهی تمام روز نمودار را نگاه کنی، برای یک جفت‌ارز قیمت هدف بگذار تا وقتی بازار به آن رسید، بتوانی دوباره بررسی‌اش کنی. اف‌بی‌تی سواپ قیمت هدف، حد ضرر متحرک، حد سود همراه با حد ضرر و فروش پله‌ای را به‌عنوان شرط نگه می‌دارد؛ نه به‌عنوان اجازه‌ای برای جابه‌جا کردن پول تو.',
      'برای خرید پله‌ای هم مبلغ و فاصلهٔ زمانی را انتخاب می‌کنی و برنامه سرِ هر نوبت یادآور می‌شود. این یعنی فرصت بررسی دوباره پیش از هر خرید؛ خریدها روی یک حساب یا موجودیِ امانی جمع نمی‌شوند.',
      'این تفاوت مهم است: هشدار با سفارش خودکار یکی نیست. برای معاملهٔ خودکار، یک سرویس باید دارایی تو را نگه دارد یا اجازهٔ برداشت از کیف پولت داشته باشد. اف‌بی‌تی سواپ هیچ‌کدام را نمی‌گیرد؛ وقتی شرط برقرار شد، خودت نرخ را می‌بینی و تراکنش را در کیف پول خودت امضا می‌کنی.',
      'اگر اعلان‌ها را فعال کرده باشی و سرویس ارسال در دسترس باشد، هشدارِ قیمت می‌تواند بیرون از برنامه هم برسد. تنظیمات گوشی، اینترنت و سرویس اعلان روی رسیدن آن اثر می‌گذارند؛ پس هشدار جای تضمین انجام معامله نیست و شرط ثبت‌شده در برنامه هم باقی می‌ماند.'
    ],
    facts: [
      ['نوع‌ها', 'قیمت هدف، حد ضرر متحرک، حد سود + حد ضرر، فروش پله‌ای و یادآور خرید پله‌ای'],
      ['اجرا', 'هر سواپ با امضای خودت انجام می‌شود؛ هیچ‌چیز خودکار نیست'],
      ['اعلان', 'با فعال‌بودن اعلان و در دسترس بودن سرویس ارسال می‌شود؛ در غیر این صورت داخل برنامه می‌ماند'],
      ['امانت‌داری', 'هیچ. مجوز برداشت یا دارایی تو در اختیار سرویس نیست']
    ],
    faqs: [
      {
        q: 'آیا وقتی قیمت به هدف برسد اف‌بی‌تی سواپ خودش معامله می‌کند؟',
        a: 'نه. برنامه شرط را نگه می‌دارد و وقتی برقرار شد از تو می‌خواهد سواپ را بررسی و امضا کنی. سرویس نه دارایی را نگه می‌دارد و نه مجوزی دارد که بدون تأیید تو آن را جابه‌جا کند.'
      },
      {
        q: 'آیا هشدار قیمت وقتی برنامه بسته است هم می‌رسد؟',
        a: 'اگر اعلان‌ها فعال باشند و سرویس ارسال و اینترنت در دسترس باشد، هشدارِ قیمت می‌تواند بیرون از برنامه هم برسد. دریافت اعلان به تنظیمات دستگاه و اتصال وابسته است؛ بنابراین یادآور است، نه تضمین اجرا.'
      },
      {
        q: 'خرید پله‌ای در اینجا یعنی چه؟',
        a: 'خرید پله‌ای یک یادآور زمان‌بندی‌شده برای بررسی خرید در فاصله‌های انتخابی توست. هر خرید یک تراکنش جداست که در کیف پول خودت تأیید می‌کنی.'
      }
    ],
    ctaLabel: 'تنظیم هشدار و خرید پله‌ای',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'هشدار، پیشنهاد خرید یا فروش نیست و رسیدن اعلان تضمین نمی‌شود. ارزهای دیجیتال پرنوسان‌اند و تراکنش روی زنجیره برگشت‌ناپذیر است؛ ممکن است همهٔ پولت را از دست بدهی.'
  },
  {
    slug: 'fa/crypto-market-history-analysis',
    icon: 'history',
    topic: 'market',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/signals',
    title: 'تحلیل تکنیکال ارز دیجیتال | RSI، MACD و حمایت مقاومت | اف‌بی‌تی سواپ',
    description:
      'تاریخچهٔ قیمت ارز دیجیتال را با RSI، MACD، میانگین متحرک، نوسان، حمایت و مقاومت بخوان. دادهٔ گذشته است، نه پیش‌بینی قیمت.',
    h1: 'تحلیل تکنیکال ارز دیجیتال؛ خواندن داده، نه وعدهٔ پیش‌بینی',
    body: [
      'تحلیل تکنیکال وقتی مفید است که بدانی چه می‌گوید و چه نمی‌گوید. در اف‌بی‌تی سواپ، RSI، MACD، باند بولینگر، میانگین‌های متحرک، نوسان و سطح‌های حمایت و مقاومت از تاریخچهٔ واقعی قیمت محاسبه می‌شوند تا بتوانی وضعیت فعلی نمودار را در کنار هم ببینی.',
      'به‌جای اینکه یک عدد را «سیگنال قطعی» بدانی، می‌توانی ببینی اندیکاتورها چقدر با هم هم‌نظرند، قیمت چند بار به یک سطح برگشته و آن سطح چند بار نگه داشته یا شکسته شده است. حجم هم با میانهٔ همان دارایی مقایسه می‌شود، نه با یک عدد دل‌بخواهی برای همهٔ کوین‌ها.',
      'هیچ‌کدام از این اندازه‌گیری‌ها آینده را تضمین نمی‌کنند. سطح حمایتی که چند بار دوام آورده ممکن است دفعهٔ بعد بشکند و بازارِ پرنوسان می‌تواند در چند دقیقه نتیجه را عوض کند. این صفحه برای تحقیق و فهم بهتر داده است، نه توصیهٔ مالی یا فرمان خرید و فروش.'
    ],
    facts: [
      ['اندیکاتورها', 'RSI، MACD، باند بولینگر و میانگین‌های متحرک'],
      ['سطح‌ها', 'تعداد برخوردها و سابقهٔ نگه‌داشتن یا شکستن قیمت'],
      ['ریسک', 'بدترین افت از سقف تا کف در بازهٔ انتخاب‌شده'],
      ['پیش‌بینی', 'ندارد؛ همهٔ عددها دربارهٔ داده‌ای هستند که قبلاً رخ داده است']
    ],
    faqs: [
      {
        q: 'آیا تحلیل تکنیکال این صفحه قیمت بعدی را پیش‌بینی می‌کند؟',
        a: 'نه. این صفحه اندازه‌گیری‌هایی از قیمت و حجم گذشته را خلاصه می‌کند. هیچ اندیکاتور یا سطحی نتیجهٔ آینده را تضمین نمی‌کند.'
      },
      {
        q: 'نگه‌داشتن یا شکستن یک سطح یعنی چه؟',
        a: 'برنامه می‌شمارد قیمت در تاریخچهٔ انتخاب‌شده چند بار به یک سطح برگشته و آن سطح چند بار حفظ شده یا از آن عبور کرده است. این فقط زمینه‌ای برای تحقیق است، نه دستور معامله.'
      },
      {
        q: 'آیا این محتوا توصیهٔ مالی است؟',
        a: 'نه. ارزهای دیجیتال پرنوسان‌اند و تراکنش‌های روی زنجیره برگشت‌ناپذیرند. تصمیم و مسئولیت معامله با خود توست.'
      }
    ],
    ctaLabel: 'باز کردن تحلیل بازار',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'اندیکاتورهای تکنیکال دربارهٔ دادهٔ گذشته‌اند، نه تضمین آینده. این صفحه توصیهٔ مالی نیست و ممکن است در ارزهای دیجیتال همهٔ پولت را از دست بدهی.'
  },
  {
    slug: 'fa/non-custodial-wallet',
    icon: 'wallet',
    topic: 'swap',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/wallet',
    title: 'کیف پول غیرامانی ارز دیجیتال | کلید خصوصی در کنترل تو | اف‌بی‌تی سواپ',
    description:
      'کیف پول خودت را با WalletConnect وصل کن یا یک کیف پول داخلیِ رمزنگاری‌شده روی دستگاه بساز. کلید خصوصی به سرور اف‌بی‌تی سواپ فرستاده نمی‌شود.',
    h1: 'کیف پول غیرامانی؛ کلید خصوصی و دارایی در کنترل تو',
    body: [
      'کیف پول غیرامانی یعنی کلید خصوصی یا عبارت بازیابی در اختیار خودت است، نه یک صرافی یا وب‌سایت. می‌توانی کیف پول موجودت را با WalletConnect یا مرورگرِ کیف پول متصل کنی، موجودی را ببینی و هر تراکنش را در همان کیف پول تأیید کنی.',
      'برای شبکه‌های سازگار با EVM، برنامه امکان ساخت یا واردکردن یک کیف پول داخلیِ ۱۲ کلمه‌ای هم دارد. عبارت آن روی همان دستگاه و با رمز عبور رمزنگاری می‌شود و به سرور فرستاده نمی‌شود. با این حال، کیف پول داخلی داخل فضای مرورگر یا WebView است و به‌اندازهٔ کیف پول سخت‌افزاری یا یک کیف پول خارجیِ معتبر برای مبلغ مهم امن نیست.',
      'عبارت بازیابی را فقط خودت می‌توانی نگه داری و بازیابی کنی. اگر آن را گم کنی، هیچ تیم پشتیبانی، صرافی یا اپلیکیشنی نمی‌تواند دارایی را برگرداند. اگر کسی در پیام، تماس یا فرم وب این عبارت یا رمز را خواست، کلاهبردار است؛ حتی اگر نام اف‌بی‌تی سواپ را نوشته باشد.'
    ],
    facts: [
      ['روش اتصال', 'WalletConnect، کیف پول مرورگر و کیف پول داخلیِ EVM'],
      ['کلید خصوصی', 'در کیف پول خارجی می‌ماند؛ کیف پول داخلی فقط به‌صورت رمزنگاری‌شده روی دستگاه ذخیره می‌شود'],
      ['توصیهٔ امنیتی', 'برای مبلغ مهم از کیف پول خارجی معتبر یا سخت‌افزاری استفاده کن'],
      ['بازیابی', 'عبارت بازیابی فقط نزد خودت است؛ گم‌شدن آن قابل جبران نیست']
    ],
    faqs: [
      {
        q: 'آیا اف‌بی‌تی سواپ عبارت بازیابی کیف پول خارجی من را می‌بیند؟',
        a: 'نه. هنگام اتصال کیف پول خارجی، عبارت بازیابی و کلید خصوصی داخل همان کیف پول باقی می‌ماند. اف‌بی‌تی سواپ هرگز نباید عبارت بازیابی یا رمز کیف پول تو را در پیام، ایمیل یا فرم درخواست کند.'
      },
      {
        q: 'کیف پول داخلی برای چه چیزی مناسب است؟',
        a: 'کیف پول داخلی برای مبالغ کم و آشنایی با برنامه طراحی شده است؛ عبارت ۱۲ کلمه‌ای آن روی دستگاه با رمز عبور رمزنگاری می‌شود و به سرور فرستاده نمی‌شود. برای مبلغ مهم، کیف پول خارجی معتبر یا سخت‌افزاری انتخاب امن‌تری است.'
      },
      {
        q: 'اگر عبارت بازیابی را گم کنم چه می‌شود؟',
        a: 'راهی برای بازیابی آن از سمت اف‌بی‌تی سواپ وجود ندارد. عبارت را روی کاغذ و دور از اینترنت نگه دار و آن را با هیچ‌کس به اشتراک نگذار.'
      }
    ],
    ctaLabel: 'باز کردن کیف پول',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'عبارت بازیابی و کلید خصوصی را با هیچ‌کس به اشتراک نگذار. دارایی دیجیتال و تراکنش‌های روی زنجیره برگشت‌ناپذیرند و ممکن است همهٔ پولت را از دست بدهی.'
  },

  /* ═══════════════════════════════════════════════════════════════════════
   * THE THREE THINGS PEOPLE ACTUALLY SEARCH FOR
   * ═══════════════════════════════════════════════════════════════════════
   * «سواپ ، کریپتو ، سرمایه گذاری» — swap, crypto, investing.
   *
   * Those three intents had no page. The Persian guides that existed answered
   * questions people ask *after* they have decided to use the product (price
   * alerts, RSI, wallet safety). The query that brings somebody to the door —
   * «سواپ ارز دیجیتال», "swap crypto without kyc", «سرمایه گذاری در ارز
   * دیجیتال» — landed on a page that assumed they were already inside.
   *
   * Six pages, in three genuinely translated pairs. Translated, not templated:
   * each Persian page is written for a reader who is deciding whether to trust
   * a .ir domain with a wallet connection, and each English page for a reader
   * who is trying to find out what the thing is at all. Machine-copying one
   * into the other would produce the thin, duplicated pages Google's helpful-
   * content system exists to demote, and an hreflang pair that points at two
   * different claims is worse than no pair at all.
   *
   * THE HONESTY RULE STILL APPLIES, and it is tighter here than anywhere else
   * on the site, because these are the pages a stranger reads first. Nothing
   * below promises a return, a price, a ranking or a saving. Where a feature
   * has a limit — reminders are not automatic trades, yield carries contract
   * risk, nobody can reverse a transaction — the limit is written on the same
   * page as the feature, in the same paragraph. The fee is quoted at the same
   * 0.70% the engine charges, from the same variable the app reads, and never
   * appears without the sentence that it is shown before signing.
   * ═══════════════════════════════════════════════════════════════════════ */

  {
    slug: 'fa/crypto-swap-without-kyc',
    icon: 'swap',
    topic: 'swap',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/swap',
    title: 'سواپ ارز دیجیتال بدون ثبت‌نام و بدون سپردن دارایی | اف‌بی‌تی سواپ',
    description:
      'تبدیل و سواپ ارز دیجیتال روی ۱۷ شبکه بدون حساب، بدون ایمیل و بدون سپردن دارایی. نرخ، اثر قیمت و کارمزد پیش از امضا دیده می‌شود و تو تراکنش را امضا می‌کنی.',
    h1: 'سواپ ارز دیجیتال؛ تبدیل توکن بدون ثبت‌نام و بدون سپردن دارایی',
    howTo: [
      [
        'کیف پولت را وصل کن',
        'کیف پول موجودت را با WalletConnect یا مرورگرِ کیف پول وصل کن، یا برای شبکه‌های سازگار با EVM یک کیف پول داخلی بساز. هیچ حسابی در اف‌بی‌تی سواپ ساخته نمی‌شود.'
      ],
      [
        'جفت‌ارز و مقدار را انتخاب کن',
        'توکن ورودی و خروجی را از فهرست دارایی‌های همان شبکه انتخاب کن و مقدار را وارد کن. موجودی همان لحظه خوانده می‌شود.'
      ],
      [
        'نرخ، اثر قیمت و کارمزد را ببین',
        'پیش از هر امضا، نرخ نهایی، اثر قیمت و کارمزد ۰٫۷٪ روی همان صفحه نشان داده می‌شود. اگر عددی را نمی‌پسندی، همین‌جا رهایش کن؛ تا این مرحله هیچ‌چیز امضا نشده است.'
      ],
      [
        'تراکنش را در کیف پول خودت امضا کن',
        'سواپ با امضای تو از کیف پول خودت انجام می‌شود و روی زنجیره تسویه می‌شود. اف‌بی‌تی سواپ دارایی را نگه نمی‌دارد و نمی‌تواند تراکنش را برگرداند.'
      ]
    ],
    body: [
      'سواپ ارز دیجیتال یعنی تبدیل یک توکن به توکن دیگر روی زنجیره، بدون اینکه لازم باشد دارایی‌ات را به یک حساب واسط بریزی. در اف‌بی‌تی سواپ کیف پول خودت را وصل می‌کنی، جفت‌ارز و مقدار را انتخاب می‌کنی و نرخ را می‌بینی؛ تراکنش را خودت در همان کیف پول امضا می‌کنی و سواپ بین کیف پول تو و پروتکل روی زنجیره تسویه می‌شود.',
      'برای این کار نه حساب کاربری لازم است، نه ایمیل و نه احراز هویت. اف‌بی‌تی سواپ دفتر سفارش و نقدینگیِ خودش را ندارد؛ نرخ را از تجمیع‌کننده‌های عمومی می‌پرسد تا بهترین مسیر میان صرافی‌های غیرمتمرکز همان شبکه پیدا شود. چون توکن بین حساب‌های میانی جابه‌جا نمی‌شود، نشستن در یک پلتفرم و انتظار برای برداشت هم لازم نیست.',
      'شبکه‌های پشتیبانی‌شده هفده‌تا هستند: بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک، براچین، یونی‌چین، موناد، منتل، اسکرول، زی‌کی‌سینک، زنجیرهٔ رابین‌هود و سولانا. کارمزد پلتفرم ۰٫۷٪ از مقدار ورودی است و پیش از امضا روی همان صفحه نوشته می‌شود؛ کارمزد شبکه (گس) هم جدا از آن، مستقیماً به شبکه پرداخت می‌شود.',
      'یک چیز را باید صریح گفت: چون کلید خصوصی نزد خودت است، هیچ‌کس نمی‌تواند تراکنش را برگرداند، دارایی را قفل کند یا عبارت بازیابیِ گم‌شده را بازیابی کند — نه ما و نه هیچ‌کس دیگر. همین ویژگی که دارایی را از دسترس صرافی بیرون می‌آورد، مسئولیت انتخاب شبکه و مقصد را هم به خودت می‌سپارد؛ پس آدرس مقصد و شبکه را همیشه دو بار چک کن، چون روی زنجیره «اشتباه زدم» برگشت‌پذیر نیست.',
      'این صفحه یک ابزار را توضیح می‌دهد، نه یک پیشنهاد سرمایه‌گذاری. هیچ‌کدام از این‌ها تضمین سود نیست و بازار می‌تواند در چند ساعت ارزش دارایی را کم کند.'
    ],
    facts: [
      ['شبکه‌ها (۱۷)', 'بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک، براچین، یونی‌چین، موناد، منتل، اسکرول، زی‌کی‌سینک، زنجیرهٔ رابین‌هود و سولانا'],
      ['کارمزد پلتفرم', '۰٫۷٪ از مقدار ورودی، روی همان صفحه و پیش از امضا'],
      ['امانت‌داری', 'هیچ. کلید خصوصی در کیف پول تو می‌ماند'],
      ['حساب کاربری', 'لازم نیست؛ ایمیل و احراز هویت هم گرفته نمی‌شود'],
      ['تأمین نرخ', 'تجمیع‌کننده‌های عمومی DEX روی همان شبکه']
    ],
    faqs: [
      {
        q: 'برای سواپ ارز دیجیتال در اف‌بی‌تی سواپ باید ثبت‌نام کنم یا احراز هویت بدهم؟',
        a: 'نه. برای رابط سواپ روی زنجیره، حساب کاربری، ایمیل و احراز هویت لازم نیست؛ کیف پول خودت را وصل می‌کنی و تراکنش را امضا می‌کنی. کیف پول یا پروتکل‌های دیگر ممکن است بررسی‌های امنیتی خودشان را نشان بدهند.'
      },
      {
        q: 'کارمزد سواپ چقدر است و کجا دیده می‌شود؟',
        a: 'کارمزد پلتفرم ۰٫۷٪ از مقدار ورودی است و پیش از امضا روی همان صفحه نشان داده می‌شود. جدا از آن، کارمزد شبکه یا گس هم وجود دارد که مستقیماً به شبکه پرداخت می‌شود و مقدار آن به شلوغی شبکه بستگی دارد.'
      },
      {
        q: 'اگر آدرس اشتباهی وارد کنم، تراکنش برمی‌گردد؟',
        a: 'تراکنش‌های روی زنجیره برگشت‌ناپذیرند. وقتی تراکنش تأیید شد، نه اف‌بی‌تی سواپ و نه هیچ‌کس دیگری نمی‌تواند آن را لغو یا دارایی را بازگرداند. پیش از امضا، شبکه و آدرس مقصد را با دقت بررسی کن.'
      },
      {
        q: 'نرخ سواپ از کجا می‌آید؟',
        a: 'از تجمیع‌کننده‌های عمومی صرافی‌های غیرمتمرکز روی همان شبکه. اف‌بی‌تی سواپ نقدینگی و دفتر سفارش خودش را ندارد و نرخ را نمی‌سازد؛ نرخ نمایش‌داده‌شده همان چیزی است که مسیر پیشنهادی برمی‌گرداند و اثر قیمت آن روی صفحه دیده می‌شود.'
      }
    ],
    ctaLabel: 'شروع سواپ ارز دیجیتال',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'سواپ ارز دیجیتال تضمین سود نیست. ارزهای دیجیتال پرنوسان‌اند، تراکنش روی زنجیره برگشت‌ناپذیر است و ممکن است همهٔ پولت را از دست بدهی. این صفحه توصیهٔ مالی نیست.'
  },
  {
    slug: 'crypto-swap-without-kyc',
    icon: 'swap',
    topic: 'swap',
    lang: 'en',
    route: '/#/swap',
    title: 'Crypto Swap Without KYC — No Signup, No Custody | FBT Swap',
    description:
      'Swap tokens on 17 networks with no account, no email and no identity upload. The rate, the price impact and the 0.70% fee are shown before you sign.',
    h1: 'Swap crypto without KYC, without an account and without custody',
    howTo: [
      [
        'Connect a wallet you already own',
        'Use WalletConnect or a browser wallet, or create an in-app wallet on the EVM networks. No FBT Swap account is created at any point.'
      ],
      [
        'Pick the pair and the amount',
        'Choose the input and output token on the selected network and enter an amount. Your balance is read live from the chain.'
      ],
      [
        'Read the rate, the impact and the fee',
        'Before anything is signed, the page shows the rate you would get, the price impact and the 0.70% platform fee. Nothing has been signed at this point, so leaving is free.'
      ],
      [
        'Sign in your own wallet',
        'The swap is signed by you, from your wallet, and settles on-chain. FBT Swap never holds the asset and cannot reverse the transaction.'
      ]
    ],
    body: [
      'A crypto swap on-chain is an exchange of one token for another without moving your assets onto somebody else\u2019s balance sheet. In FBT Swap you connect a wallet you control, choose the pair and the amount, read the quote, and sign. The trade settles between your wallet and the protocol, on the network you picked.',
      'There is no account to create, no email to hand over and no identity document to upload. FBT Swap runs no order book and holds no liquidity of its own: it asks public aggregators for the best route across the decentralised exchanges on that network. Because the tokens never sit in an intermediate account, there is no deposit step and no withdrawal step either.',
      'The supported networks are seventeen: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Berachain, Unichain, Monad, Mantle, Scroll, zkSync Era, Robinhood Chain and Solana. The platform fee is 0.70% of the input amount and is shown on screen before you sign, on every supported network; network gas is separate and is paid straight to the chain.',
      'One consequence is worth stating plainly rather than hiding in a footnote: because the key is yours, nobody can reverse a transaction, freeze an asset, or recover a lost recovery phrase. Not us, and not anyone else. The same property that keeps your balance out of an exchange\u2019s reach also makes network and destination address your responsibility, so check them twice \u2014 on-chain, "I typed it wrong" is final.',
      'This page describes a tool. It is not investment advice, nothing here is a promise of profit, and the market can move against a position within hours.'
    ],
    facts: [
      ['Networks (17)', 'BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Berachain, Unichain, Monad, Mantle, Scroll, zkSync Era, Robinhood Chain, Solana'],
      ['Platform fee', '0.70% of the input amount, shown on screen before you sign'],
      ['Custody', 'None. The private key stays in your wallet'],
      ['Account', 'Not required — no email, no identity document'],
      ['Pricing', 'Public DEX aggregator routes on the selected network']
    ],
    faqs: [
      {
        q: 'Do I need an account or a KYC check to swap?',
        a: 'No. The on-chain swap interface needs no account, no email and no identity document: you connect a wallet you control and sign the transaction there. Your wallet or a third-party protocol can still show its own security checks.'
      },
      {
        q: 'How much is the fee, and where is it shown?',
        a: 'The platform fee is 0.70% of the input amount and is displayed before you sign. Network gas is charged separately by the chain and varies with congestion.'
      },
      {
        q: 'What happens if I send to the wrong address?',
        a: 'On-chain transactions are irreversible. Once a transaction is confirmed, neither FBT Swap nor anyone else can cancel it or return the asset. Check the network and the destination address before signing.'
      },
      {
        q: 'Where does the quoted rate come from?',
        a: 'From public decentralised-exchange aggregators on the selected network. FBT Swap holds no liquidity and does not set the price; the quoted rate is what the routed path returns, with the price impact shown alongside it.'
      }
    ],
    ctaLabel: 'Start a swap',
    glanceLabel: 'At a glance'
  },
  {
    slug: 'fa/crypto-investing-yield-and-lending',
    icon: 'leaf',
    topic: 'invest',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/farm',
    title: 'سرمایه‌گذاری در ارز دیجیتال: نگهداری، بازده و ریسک‌ها | اف‌بی‌تی سواپ',
    description:
      'ابزارهای سرمایه‌گذاری در ارز دیجیتال بدون سپردن دارایی: نگهداری در کیف پول خودت، خرید پله‌ای، استیکینگ مایع، وام‌دهی، فارم بازده و پورتفوی. بدون وعدهٔ سود.',
    h1: 'سرمایه‌گذاری در ارز دیجیتال؛ ابزارها، بازده و ریسکی که باید بدانی',
    howTo: [
      [
        'اول کیف پول خودت را داشته باش',
        'سرمایه‌گذاری با نگهداری شروع می‌شود. دارایی در کیف پول غیرامانی می‌ماند و هیچ‌جا سپرده نمی‌شود؛ اف‌بی‌تی سواپ مجوز برداشت از کیف پول تو را ندارد.'
      ],
      [
        'خرید را پله‌ای کن، به‌جای یک نقطهٔ زمانی',
        'برای خرید پله‌ای مبلغ و فاصله را انتخاب می‌کنی و برنامه سرِ هر نوبت یادآور می‌شود. این یادآور است، نه معاملهٔ خودکار: هر خرید را خودت بررسی و امضا می‌کنی.'
      ],
      [
        'گزینه‌های بازده را با منبعشان ببین',
        'استیکینگ مایع، وام‌دهی و استخرهای بازده با عدد و منبع داده نشان داده می‌شوند تا بتوانی نرخ، ریسک و مدت را کنار هم ببینی — نه اینکه فقط بالاترین عدد را بگیری.'
      ],
      [
        'ریسک هر گزینه را قبل از ورود بخوان',
        'بازده یعنی پذیرش ریسک: قرارداد هوشمند، نوسان، نقدشوندگی، و در وام‌دهیِ با وثیقه احتمال تسویه. هر ابزار صفحهٔ خودش را دارد و محدودیت‌ها همان‌جا نوشته شده است.'
      ]
    ],
    body: [
      'سرمایه‌گذاری در ارز دیجیتال با «کجا نگهش دارم» شروع می‌شود، نه با «چقدر سود می‌دهد». در اف‌بی‌تی سواپ دارایی در کیف پول غیرامانی خودت می‌ماند؛ برنامه رابط است، نه صندوق و نه متولی دارایی. یعنی هیچ‌وقت موجودی‌ات در حساب یک صرافی گرفتار نمی‌شود و برداشت هم منتظر تأیید کسی نمی‌ماند.',
      'گام بعدی، ورود پله‌ای است. برای خرید پله‌ای مبلغ و فاصلهٔ زمانی را انتخاب می‌کنی و برنامه سرِ هر نوبت یادآور می‌شود. اما این یادآور است و نه معاملهٔ خودکار؛ اگر انتظار داری چیزی بدون تأیید تو پول جابه‌جا کند، این ابزار آن کار را نمی‌کند و عمداً هم نمی‌کند. معاملهٔ خودکار نیازمند سپردن دارایی یا مجوز برداشت است و اف‌بی‌تی سواپ هیچ‌کدام را نمی‌گیرد.',
      'برای بازده، گزینه‌ها در یک صفحه جمع شده‌اند: استیکینگ مایع روی دارایی‌هایی مثل اتریوم و سولانا، وام‌دهی و استقراض روی بازارهای شناخته‌شدهٔ دیفای، و استخرهای بازدهی که دادهٔ آن‌ها از منبع عمومی گرفته می‌شود. عدد بازده بدون منبعش معنا ندارد؛ پس هر جا عددی می‌بینی، منبع هم کنارش هست و هر جا داده نرسد، جای عدد خالی می‌ماند و عدد ساختگی نوشته نمی‌شود.',
      'نرخ APY اگر به دلار یا استیبل‌کوین نمایش داده شود همچنان برآوردی متغیر است، نه سود دلاری ثابت. واحد نمایش اصل سرمایه، برابری استیبل‌کوین با دلار یا مبلغ پرداختی را تضمین نمی‌کند؛ روش محاسبه، دوره، قیمت دارایی و ریسک پروتکل را جدا بررسی کن.',
      'و ریسک، که بخش اصلی ماجراست: نرخ بازده ثابت نیست و با شرایط بازار و مقدار کل نقدینگی تغییر می‌کند؛ در وام‌دهیِ با وثیقه، افت قیمت وثیقه می‌تواند به تسویه ختم شود؛ در استخرهای بازده، ترکیب دارایی‌ها ریسک نامانایی (impermanent loss) دارد؛ و در همهٔ این ابزارها، باگ یا حمله به قرارداد هوشمند یک احتمال واقعی است. در استیکینگ مایع هم توکن دریافتی معادل ۱ به ۱ دارایی اصلی نیست و نرخش می‌تواند کمی بالاتر یا پایین‌تر معامله شود.',
      'پس روش درست این است: هر گزینه را با ریسک و مدت خودش بسنج، پولی که به آن نیاز داری وارد نکن، و انتظار سود تضمینی نداشته باش. اف‌بی‌تی سواپ این گزینه‌ها را نشان می‌دهد و اجرای هر تراکنش را به امضای تو می‌سپارد؛ تصمیم و مسئولیتش با خودت است.'
    ],
    facts: [
      ['نگهداری دارایی', 'در کیف پول غیرامانی خودت؛ هیچ سپرده‌ای نزد سرویس نیست'],
      ['خرید پله‌ای', 'یادآور زمان‌بندی‌شده — هر خرید با امضای خودت'],
      ['بازده', 'استیکینگ مایع، وام‌دهی و استخرهای بازده با ذکر منبع داده'],
      ['سود تضمینی', 'ندارد؛ هیچ نرخ ثابتی وعده داده نمی‌شود'],
      ['سود دلاری', 'نمایش نرخ به دلار، اصل پول یا پرداخت را تضمین نمی‌کند'],
      ['ریسک‌ها', 'نوسان قیمت، قرارداد هوشمند، نقدشوندگی، نامانایی و احتمال تسویه در وثیقه']
    ],
    faqs: [
      {
        q: 'آیا اف‌بی‌تی سواپ پول من را مدیریت می‌کند؟',
        a: 'نه. اف‌بی‌تی سواپ دارایی را نگه نمی‌دارد، مجوز برداشت نمی‌گیرد و به‌جای کاربر معامله نمی‌کند. هر جابه‌جایی نیاز به امضای صاحب کیف پول دارد و مسئولیت تصمیم‌ها با خودِ کاربر است.'
      },
      {
        q: 'بازدهی که نشان می‌دهید تضمینی است؟',
        a: 'نه. نرخ بازده متغیر است و به شرایط بازار، مقدار نقدینگی و کارمزدها بستگی دارد. هیچ‌جا عدد ثابتی به‌عنوان سود وعده داده نمی‌شود و هر عدد با منبع داده‌اش نمایش داده می‌شود.'
      },
      {
        q: 'آیا APY که به دلار نمایش داده می‌شود سود دلاری را تضمین می‌کند؟',
        a: 'خیر. دلار فقط واحد نمایش است، نه پرداخت ثابت یا تضمین اصل سرمایه. نرخ، قیمت توکن، برابری استیبل‌کوین با دلار، نقدشوندگی و ریسک پروتکل می‌توانند نتیجه را تغییر دهند.'
      },
      {
        q: 'خرید پله‌ای خودکار انجام می‌شود؟',
        a: 'نه. خرید پله‌ای یک یادآور زمان‌بندی‌شده است. هر خرید یک تراکنش جداست که خودت آن را بررسی و امضا می‌کنی؛ این طراحی عمدی است تا هیچ‌چیز بدون تأیید تو دارایی را جابه‌جا نکند.'
      },
      {
        q: 'بزرگ‌ترین ریسک‌ها در این ابزارها کدام‌اند؟',
        a: 'نوسان شدید قیمت، ریسک قرارداد هوشمند و باگ پروتکل، ریسک نقدشوندگی (بیرون‌آمدن از موقعیت در قیمت نامناسب)، نامانایی در استخرهای دونمادی، و در وام‌دهیِ وثیقه‌ای احتمال تسویه در صورت افت وثیقه. پیش از ورود، شرط‌ها و محدودیت‌های هر ابزار را بخوان.'
      }
    ],
    ctaLabel: 'دیدن ابزارهای بازده',
    glanceLabel: 'یک نگاه کلی',
    links: [
      { href: '/fa/tokenized-global-stocks', text: 'سهام جهانی توکنی‌شده؛ مالکیت و محدودیت دسترسی' },
      { href: '/fa/crypto-education', text: 'مفاهیم پایهٔ کریپتو و امنیت کیف پول' },
      { href: '/fa/crypto-market-charts-signals', text: 'قیمت، نمودار و خوانش روند بازار' }
    ],
    riskText:
      'هیچ بازدهی تضمین‌شده نیست و ممکن است سرمایه‌ات کم یا از دست برود. نگهداری در کیف پول غیرامانی یعنی مسئولیت کلید هم با خودت است: اگر عبارت بازیابی را گم کنی، هیچ‌کس نمی‌تواند بازیابی کند. این صفحه توصیهٔ مالی نیست.'
  },
  {
    slug: 'crypto-investing-yield-and-lending',
    icon: 'leaf',
    topic: 'invest',
    lang: 'en',
    route: '/#/farm',
    title: 'Crypto Investing Without Giving Up Custody — Yield, Lending, Risk | FBT Swap',
    description:
      'Tools for putting crypto to work without handing it over: self-custody, staged buying reminders, liquid staking, lending and yield pools with their data source shown. No promised returns.',
    h1: 'Crypto investing: the tools, the yield, and the risk you are taking',
    howTo: [
      [
        'Start with a wallet you control',
        'Investing here starts with self-custody. Assets stay in your own non-custodial wallet and are never deposited with FBT Swap, which never holds an allowance that could move them.'
      ],
      [
        'Stage your buying instead of timing it',
        'A recurring-buy reminder asks you to review a planned purchase on your own schedule. It is a reminder, not an automatic trade: you review and sign each one.'
      ],
      [
        'Compare yield options with their source',
        'Liquid staking, lending markets and yield pools are shown with the figure and the source of that figure, so the rate, the duration and the risk can be read together instead of chasing the highest number.'
      ],
      [
        'Read each instrument\u2019s risk before entering',
        'Yield is compensation for risk: smart-contract risk, volatility, liquidity, and liquidation in collateralised lending. Every instrument keeps its limits on its own screen rather than in a footnote.'
      ]
    ],
    body: [
      'Putting money into crypto starts with where it is held, not with what it earns. In FBT Swap the asset stays in your own non-custodial wallet — the app is an interface, not a fund and not a custodian. Your balance is never stuck inside an exchange account, and a withdrawal never waits for someone else\u2019s approval.',
      'The second step is staging entries rather than timing one. A recurring-buy reminder lets you choose an amount and an interval and then prompts you to review the purchase. It is a reminder, not an automatic trade: each buy is a separate transaction you approve yourself. That is a deliberate limit — automatic execution requires either custody of your funds or an unlimited allowance over them, and this app takes neither.',
      'For yield, the options sit on one screen: liquid staking on assets such as ETH and SOL, lending and borrowing against established DeFi markets, and yield pools whose figures come from a public data source. A yield number without its source means nothing, so the source travels with the figure — and where a figure is unavailable, the space stays empty rather than being filled with an invented one.',
      'An APY quoted in dollars or a dollar-pegged token is still a variable estimate, not fixed dollar income. The displayed unit does not guarantee principal, a USD peg or a payout; check how the rate is calculated, its period, the asset price and the protocol risks.',
      'The risk belongs in the same paragraph as the return. Yield rates move with market conditions and total liquidity. In collateralised lending, a fall in the collateral price can trigger liquidation. In two-asset pools, impermanent loss is a real cost when the pair diverges. Every one of these instruments carries smart-contract risk — a bug or an exploit is a possibility, not a hypothetical. And a liquid-staking token is not a 1:1 claim you can always redeem at par; it trades at whatever the market pays for it.',
      'So the workable approach is to judge each option on its own risk and duration, never to commit money you need, and never to expect a guaranteed return. FBT Swap shows the options and hands every execution to your signature. The decision, and the responsibility, stay yours.'
    ],
    facts: [
      ['Custody', 'Your own non-custodial wallet; nothing deposited with the service'],
      ['Recurring buys', 'Reminder-only \u2014 each buy is signed by you'],
      ['Yield', 'Liquid staking, lending markets and pools, each with its data source'],
      ['Guaranteed returns', 'None, and no fixed rate is advertised'],
      ['Dollar-denominated yield', 'A USD quote does not fix principal or payout'],
      ['Risks', 'Price volatility, smart contracts, liquidity, impermanent loss, liquidation']
    ],
    faqs: [
      {
        q: 'Does FBT Swap manage my money or trade for me?',
        a: 'No. FBT Swap does not hold assets, does not take an allowance, and does not sign in place of the user. Every movement requires the wallet holder\u2019s approval, and the decisions remain the user\u2019s.'
      },
      {
        q: 'Are the yields you show guaranteed?',
        a: 'No. Yield rates vary with market conditions, available liquidity and fees. No fixed return is promised anywhere, and every figure is displayed together with the source it came from.'
      },
      {
        q: 'Does an APY shown in dollars guarantee dollar income?',
        a: 'No. Dollar denomination is a display unit, not a fixed payout or a guarantee of principal. Rates vary, and token prices, stablecoin pegs, liquidity and protocol risks can change the outcome.'
      },
      {
        q: 'Do recurring buys execute automatically?',
        a: 'No. A recurring buy is a scheduled reminder. Each purchase is a separate transaction you review and sign, which is deliberate: nothing should be able to move funds without your approval.'
      },
      {
        q: 'What are the main risks?',
        a: 'Severe price volatility, smart-contract bugs and exploits, liquidity risk when exiting a position, impermanent loss in two-asset pools, and liquidation risk in collateralised lending. Read each instrument\u2019s own conditions before entering it.'
      }
    ],
    ctaLabel: 'See the yield tools',
    glanceLabel: 'At a glance',
    links: [
      { href: '/tokenized-global-stocks', text: 'Tokenised global stocks: ownership and access limits' },
      { href: '/crypto-education', text: 'Learn crypto fundamentals and wallet safety' },
      { href: '/crypto-market-charts-signals', text: 'Live crypto prices, charts and trend readings' }
    ]
  },
  {
    slug: 'fa/solana-token-swap',
    icon: 'solana',
    topic: 'swap',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/solana',
    title: 'سواپ سولانا: تبدیل توکن‌های SPL با کیف پول خودت | اف‌بی‌تی سواپ',
    description:
      'تبدیل توکن‌های SPL و Token-2022 روی سولانا با کیف پول خودت. موجودی از دو مسیر خوانده می‌شود، نرخ و کارمزد پیش از امضا دیده می‌شود و دارایی نزد تو می‌ماند.',
    h1: 'سواپ سولانا؛ تبدیل توکن‌های SPL بدون سپردن دارایی',
    howTo: [
      [
        'کیف پول سولانا را وصل کن',
        'کیف پول سولانای خودت را وصل کن یا در مرورگر کیف پول، همان اتصال را تأیید کن. هیچ سپرده‌ای به اف‌بی‌تی سواپ منتقل نمی‌شود.'
      ],
      [
        'توکن و مقدار را انتخاب کن',
        'توکن‌های SPL و Token-2022 پشتیبانی می‌شوند. موجودی از روی زنجیره خوانده می‌شود و تا وقتی مقدار با دسیمالِ تأییدشده تطبیق داده نشود، دروازهٔ مقدار ساکت می‌ماند.'
      ],
      [
        'نرخ و کارمزد را ببین',
        'نرخ مسیر پیشنهادی و کارمزد ۰٫۷٪ پیش از امضا نشان داده می‌شود. اگر ورودی SOL باشد، مقدار لازم برای اجارهٔ اکانت مقصد (در صورت نیاز) هم در محاسبه دیده می‌شود.'
      ],
      [
        'در کیف پول خودت امضا کن',
        'تراکنش در کیف پول تو امضا و روی شبکهٔ سولانا ارسال می‌شود. اگر خواندن موجودی از یک نود ناموفق باشد، برنامه درِ دوم (سرور خودش) را هم امتحان می‌کند و نتیجه را بدون ساختن عدد، گزارش می‌دهد.'
      ]
    ],
    body: [
      'سولانا برای تبدیل توکن سریع و کم‌هزینه است، اما دو چیز است که در عمل باعث خطا می‌شود: دسیمالِ توکن و کیفیت خواندن موجودی. اف‌بی‌تی سواپ دسیمال را از خودِ زنجیره تأیید می‌کند و مقدار را با مقیاس تأییدشده مقایسه می‌کند، تا خطای «موجودی کم است» روی یک توکن شش‌دسیمالی به‌اشتباه ظاهر نشود.',
      'خواندن موجودی روی سولانا از دو مسیر انجام می‌شود: اول خودِ دستگاه از نودهای عمومی، و کمی بعد سرور اف‌بی‌تی سواپ؛ اولین جوابِ صادقانه برنده است. اگر همهٔ نودها رد کنند، برنامه عددی نمی‌سازد و در گزارش می‌گوید کدام مسیر جواب داد، کدام نود چه گفت و چرا — چون «موجودی کم است» باید یعنی موجودی کم است، نه اینکه یک نود عمومی جواب نداده.',
      'توکن‌های استاندارد SPL و توکن‌های Token-2022 هر دو پشتیبانی می‌شوند. اگر ورودی SOL باشد، مقداری هم برای اجارهٔ اکانت مقصد (در صورت نیاز به ساخت آن) در نظر گرفته می‌شود تا تراکنش به‌خاطر کسری گس شکست نخورد؛ همان شود که روی صفحه به تو نشان داده می‌شود.',
      'کارمزد پلتفرم روی سولانا هم مثل شبکه‌های دیگر ۰٫۷٪ از مقدار ورودی است و پیش از امضا روی همان صفحه نوشته می‌شود. تراکنش را خودت امضا می‌کنی، دارایی به کیف پول تو می‌رسد و اف‌بی‌تی سواپ در میان مسیر نه دارایی نگه می‌دارد و نه کلید می‌خواهد.',
      'و مثل هر سواپ دیگری: برگشت‌ناپذیر است. آدرس مقصد و شبکه را دو بار چک کن و انتظار سود از تبدیل نداشته باش.'
    ],
    facts: [
      ['شبکه', 'سولانا'],
      ['توکن‌ها', 'SPL و Token-2022'],
      ['کارمزد پلتفرم', '۰٫۷٪ از مقدار ورودی، پیش از امضا روی صفحه'],
      ['خواندن موجودی', 'از دستگاه و سرور اف‌بی‌تی سواپ؛ اولین جوابِ صادقانه برنده است'],
      ['اجارهٔ اکانت مقصد', 'در صورت نیاز، در محاسبهٔ کسریِ گس دیده می‌شود']
    ],
    faqs: [
      {
        q: 'چرا برای سواپ سولانا خطای «موجودی کم یا RPC را چک کنید» می‌دیدم؟',
        a: 'ریشهٔ آن خطا در بیشتر موارد یک خواندنِ ناموفق بود، نه کمبود واقعی موجودی: دسیمال می‌توانست حدس زده شود، مینت‌های Token-2022 درست خوانده نمی‌شدند و حکم دکمه روی جواب یک نود تک بود. حالا دسیمال از زنجیره تأیید می‌شود، هر دو استاندارد توکن خوانده می‌شوند و خواندن از دو مسیر (دستگاه و سرور) با گزارش گره‌ها انجام می‌شود.'
      },
      {
        q: 'کدام کیف پول‌های سولانا پشتیبانی می‌شوند؟',
        a: 'کیف پول‌های سولانای سازگار با اتصال مرورگر و WalletConnect. اتصال در همان صفحه انجام می‌شود و عبارت بازیابی هرگز از تو خواسته نمی‌شود؛ هر پیام، ایمیل یا فرمی که عبارت بازیابی یا رمز کیف پول را بخواهد، کلاهبرداری است.'
      },
      {
        q: 'چرا گاهی مقدار کارمزد بیشتر از تصور من است؟',
        a: 'اگر اکانت مقصد روی زنجیره وجود نداشته باشد، ساخت آن به اجارهٔ حدود ۲٬۱۰۰٬۰۰۰ لامپورت نیاز دارد و همان مقدار در کسری محاسبه می‌شود. این مبلغ کارمزد پلتفرم نیست؛ اجارهٔ اکانت روی زنجیره است.'
      }
    ],
    ctaLabel: 'باز کردن سواپ سولانا',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'تبدیل توکن تضمین سود نیست و تراکنش‌های سولانا برگشت‌ناپذیرند. اگر مقدار یا آدرس مقصد اشتباه باشد، بازیابی ممکن نیست. این صفحه توصیهٔ مالی نیست.'
  },
  {
    slug: 'solana-token-swap',
    icon: 'solana',
    topic: 'swap',
    lang: 'en',
    route: '/#/solana',
    title: 'Solana Token Swap — SPL and Token-2022, Signed in Your Wallet | FBT Swap',
    description:
      'Swap SPL and Token-2022 tokens on Solana from your own wallet. Balances are read from two paths, the rate and the 0.70% fee are shown before you sign, and custody never moves.',
    h1: 'Solana token swap: SPL and Token-2022, signed by you',
    howTo: [
      [
        'Connect a Solana wallet',
        'Connect the Solana wallet you already control, or approve the same connection in a browser wallet. Nothing is deposited with FBT Swap.'
      ],
      [
        'Choose the token and the amount',
        'Both SPL and Token-2022 tokens are supported. The balance is read from the chain, and the amount gate stays silent until the value has been matched against a verified decimal scale.'
      ],
      [
        'Read the rate and the fee',
        'The routed rate and the 0.70% platform fee are shown before signing. When the input is SOL, the rent needed for a destination token account (if one has to be created) is included in the shortfall figure.'
      ],
      [
        'Sign in your wallet',
        'The transaction is signed in your wallet and submitted to Solana. If one node fails to answer a balance read, a second path \u2014 our own server \u2014 is tried, and the result is reported rather than invented.'
      ]
    ],
    body: [
      'Solana makes token swaps fast and cheap, but two things break them in practice: decimal places and the quality of a balance read. FBT Swap resolves decimals from the chain itself and compares the amount only against a verified scale, so a six-decimal token does not produce a false "insufficient balance".',
      'Balance reads take two paths: the device asks public nodes first, and the FBT Swap server is asked shortly after. The first honest answer wins. If every node refuses, the app does not invent a number — the report says which path answered, what each node said and why, because "insufficient balance" should mean the balance is insufficient, not that a public endpoint was rate-limited.',
      'Both SPL and Token-2022 tokens are supported. When the input is SOL, the rent for creating a destination token account is included in the shortfall calculation, so a transaction does not fail for a missing 2,100,000 lamports that nobody mentioned.',
      'The platform fee on Solana is the same 0.70% of the input amount as on every other supported network, shown on screen before you sign. You sign the transaction, the asset arrives in your wallet, and FBT Swap neither holds the asset in between nor asks for a key.',
      'And, as with any on-chain swap: it is final. Check the destination address and the network twice, and do not expect a swap to produce a profit.'
    ],
    facts: [
      ['Network', 'Solana'],
      ['Tokens', 'SPL and Token-2022'],
      ['Platform fee', '0.70% of the input amount, on screen before you sign'],
      ['Balance reads', 'Device and FBT Swap server, first honest answer wins'],
      ['Account rent', 'Included in the shortfall when a destination account must be created']
    ],
    faqs: [
      {
        q: 'Why did I keep seeing "low balance or check your RPC" on Solana swaps?',
        a: 'In most cases the cause was a failed read rather than a genuinely low balance: decimals could be guessed, Token-2022 mints were not read correctly, and the button state depended on a single node\u2019s answer. Decimals are now confirmed from the chain, both token standards are read together, and balance reads run over two paths with per-node reporting.'
      },
      {
        q: 'Which Solana wallets are supported?',
        a: 'Solana wallets that support browser or WalletConnect connections. The connection happens on the page and your recovery phrase is never requested — any message, email or form asking for a recovery phrase or wallet password is a scam.'
      },
      {
        q: 'Why is the required amount sometimes higher than I expected?',
        a: 'If the destination token account does not exist on-chain, creating it costs roughly 2,100,000 lamports of rent, and that rent is included in the shortfall calculation. It is not a platform fee; it is an on-chain account deposit.'
      }
    ],
    ctaLabel: 'Open the Solana swap',
    glanceLabel: 'At a glance'
  }
];

/**
 * Pages that are the SAME CONTENT in different languages.
 *
 * Kept as an explicit list rather than inferred, because an incorrect
 * hreflang pairing is worse than none: it tells Google two unrelated pages
 * are translations of each other, and it will then serve the wrong one to
 * half the audience.
 */
/*
 * ─── THE BLOG ────────────────────────────────────────────────────────────────
 * Long-form answers to the questions people type BEFORE they are ready to
 * swap: what a fee actually costs, what custody means, what "no KYC" does and
 * does not buy you. Each one is written in its own language rather than
 * translated word for word, and each one ends by linking to the page that
 * does the thing it just explained — a guide that answers a question and
 * leaves the reader with nowhere to go is a dead end for the reader and for
 * the crawl.
 *
 * THE RULE THAT KEEPS THESE PAGES HONEST: a guide may explain a cost, a risk
 * or a limitation, and it may NOT promise a return, a price, a saving or a
 * ranking. Where the app cannot do something, the guide says so in the same
 * paragraph as the feature that comes close — the failure mode of SEO
 * writing is a page that describes a product nobody can actually use.
 *
 * Posts and hubs are pushed into PAGES below, so the sitemap, the reciprocal
 * hreflang pairs, the sibling links on every other page and the IndexNow
 * submission list all pick them up without a second code path. The one thing
 * that does NOT happen automatically is that list — test/wiring.mjs fails if
 * a page reaches the generator and never reaches submit-indexnow.mjs.
 */
const POSTS = [
  {
    kind: 'post',
    slug: 'how-crypto-swap-fees-work',
    icon: 'receipt',
    topic: 'learn',
    lang: 'en',
    route: '/#/swap',
    datePublished: '2026-09-24',
    title: 'How a crypto swap fee actually works — and what 0.7% does not cover | FBT Swap',
    description:
      'A swap has three separate costs: the network fee, the liquidity provider fee inside the pool price, and the platform fee. Here is who gets each one, and how to check them before you sign.',
    h1: 'How a swap fee actually works',
    body: [
      'Almost every argument about swap fees compares the wrong number. The percentage a platform advertises is one of three costs in the same transaction, and on a small trade it is usually not the largest one. This page separates them.',
      'Nothing here is a recommendation to trade, and no number here is a promise about your execution. The point is that each cost is visible before you sign, and a cost you cannot name is a cost you cannot check.'
    ],
    sections: [
      [
        'Three costs in one swap',
        [
          'The network fee — gas — is paid to the validators of the chain, in that chain’s own coin. It does not depend on how much you swap: it depends on how busy the chain is and what the transaction does. A swap with an approval in front of it costs more than one without. This is the cost people forget when a $30 trade on a congested chain loses money.',
          'The liquidity provider fee is inside the price you are quoted. Every pool charges the people who supply it — typically a fraction of a percent — and it is already subtracted from what you receive. It never appears as a line item, which is exactly why it is worth knowing it exists.',
          'The platform fee is what the interface charges for assembling the trade. On FBT Swap it is 0.70% of the input amount, on every supported network, and it is shown on the screen before the wallet is asked to sign anything.'
        ]
      ],
      [
        'Why the number you were quoted is not the number you get',
        [
          'Two forces move the quote between the moment you see it and the moment the transaction is mined. Price impact is the effect of your own trade on the pool: in a deep pool a small trade moves the price almost not at all, and in a shallow pool even a modest trade moves it against you. Slippage is everything else moving — other people’s trades landing first.',
          'A swap interface handles this with a minimum-received value. If the trade cannot fill at or above that floor, the transaction reverts instead of executing at a bad price. You pay the gas for the attempt and keep your tokens. That is the honest behaviour, but it is also why "the swap failed" and "you were charged" are not a contradiction.'
        ]
      ],
      [
        'What the 0.70% does and does not pay for',
        [
          'It pays for the interface: routing across the pools on the network you chose, the quote you read, the transaction your wallet signs. It is taken in the input token on the same chain, and it is the only part of the transaction that goes to us.',
          'It does not cover gas, it does not cap price impact, and it does not buy reversibility. Nobody can reverse an on-chain trade — not the interface, not the pool, not the validators. A swap you signed is a swap that happened.'
        ]
      ],
      [
        'The pre-signature checklist',
        [
          'Before approving, confirm five things: the network matches the token you actually hold; the price impact is a number you are willing to accept; the minimum received is above your own floor, not just the default; the fee line names the amount and the chain; and the deadline is short enough that a stuck transaction cannot execute at a stale price later.',
          'If any of those is missing from the screen, the correct move is not to sign and check somewhere else. A quote that hides one of its own costs is not a cheaper quote, it is an incomplete one.'
        ]
      ],
      [
        'Where to look in the app',
        [
          'On every swap the app shows the route, the platform fee, the price impact and the minimum received before your wallet is opened. After signing, the transaction hash is on the explorer of that chain for anyone to verify — including you.',
          'If a fee line ever disagrees with what left your wallet, that is a bug worth reporting, not something to explain away.'
        ]
      ]
    ],
    facts: [
      ['Platform fee', '0.70% of the input amount, on every supported network, shown before you sign'],
      ['Network fee', 'Paid to the chain’s validators in its own coin — never to the platform'],
      ['Pool fee', 'Already inside the quoted price; it has no line of its own'],
      ['On screen before signing', 'Route, fee, price impact and minimum received']
    ],
    faqs: [
      {
        q: 'Is the 0.70% fee charged on top of gas?',
        a: 'Yes, they are separate. The platform fee is taken from the input token on the same chain; gas is paid to the network in that chain’s native coin and is set by the chain, not by the platform.'
      },
      {
        q: 'Why did my swap fail and still cost me a network fee?',
        a: 'A failed swap means the trade could not fill at or above the minimum received you set, so it reverted instead of executing at a worse price. The network still processed the attempt, and gas is paid for work the validators did, not for a successful outcome.'
      },
      {
        q: 'Can a swap fee be refunded?',
        a: 'No. A settled on-chain transaction cannot be reversed, which means a platform fee taken in it cannot be refunded by anyone — not by the interface, the pool or the chain.'
      }
    ],
    links: [
      { href: '/crypto-swap-without-kyc', text: 'Swap without an account or identity check' },
      { href: '/crypto-market-history-analysis', text: 'Check how a price level behaved before you trade it' },
      { href: '/non-custodial-crypto-swap', text: 'Why the keys stay in your wallet' }
    ]
  },
  {
    kind: 'post',
    slug: 'fa/how-crypto-swap-fees-work',
    icon: 'receipt',
    topic: 'learn',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/swap',
    datePublished: '2026-09-24',
    title: 'کارمزد سواپ ارز دیجیتال چطور حساب می‌شود؟ ۰٫۷٪ چه چیزی را پوشش می‌دهد و چه چیزی را نه | FBT Swap',
    description:
      'هر سواپ سه هزینهٔ جدا دارد: کارمزد شبکه، کارمزد تأمین‌کنندهٔ نقدینگی که داخل قیمت است، و کارمزد پلتفرم. این‌جا می‌گوید هر کدام به کی می‌رسد و پیش از امضا کجا باید ببینی‌شان.',
    h1: 'کارمزد سواپ چطور حساب می‌شود',
    body: [
      'تقریباً هر بحثی دربارهٔ کارمزد سواپ، عدد اشتباهی را مقایسه می‌کند. درصدی که یک پلتفرم اعلام می‌کند یکی از سه هزینهٔ همان تراکنش است و در معامله‌های کوچک، معمولاً بزرگ‌ترینشان نیست. این صفحه این سه را از هم جدا می‌کند.',
      'هیچ‌کدام از این‌ها توصیه به معامله نیست و هیچ عددی این‌جا وعدهٔ قیمت اجرای تو نیست. موضوع این است که هر هزینه پیش از امضا دیده می‌شود و هزینه‌ای که نتوانی نامش را ببری، نمی‌توانی بررسی‌اش کنی.'
    ],
    sections: [
      [
        'سه هزینه در یک سواپ',
        [
          'کارمزد شبکه (گس) به اعتبارسنج‌های همان زنجیره پرداخت می‌شود، با کوین خودِ آن زنجیره. این عدد به بزرگی معاملهٔ تو بستگی ندارد؛ به شلوغی زنجیره و به کاری که تراکنش انجام می‌دهد بستگی دارد. سواپی که پیش از آن یک approve دارد از سواپ بدون آن گران‌تر است. همین هزینه است که در معاملهٔ کوچک روی زنجیرهٔ شلوغ فراموش می‌شود.',
          'کارمزد تأمین‌کنندهٔ نقدینگی داخل همان قیمتی است که به تو نشان داده می‌شود. هر استخر از کسانی که نقدینگی می‌دهند کارمزد می‌گیرد — معمولاً کسری از درصد — و این مبلغ از قبل از چیزی که دریافت می‌کنی کم شده است. هیچ‌وقت به‌صورت یک خط جدا نمایش داده نمی‌شود؛ دقیقاً به همین دلیل ارزش دانستن دارد.',
          'کارمزد پلتفرم همان چیزی است که رابط برای چیدن معامله می‌گیرد. در FBT Swap این عدد ۰٫۷٪ از مقدار ورودی است، روی همهٔ شبکه‌های پشتیبانی‌شده، و روی همان صفحه پیش از آنکه کیف پول چیزی برای امضا ببیند نوشته می‌شود.'
        ]
      ],
      [
        'چرا نرخی که دیدی، همان نرخی نیست که می‌گیری',
        [
          'دو نیرو نرخ را از لحظه‌ای که می‌بینی تا لحظه‌ای که تراکنش تأیید می‌شود جابه‌جا می‌کنند. اثر قیمت، تأثیر خودِ معاملهٔ تو بر استخر است: در استخر عمیق، معاملهٔ کوچک تقریباً هیچ حرکتی ایجاد نمی‌کند و در استخر کم‌عمق حتی یک معاملهٔ متوسط قیمت را به زیان تو جابه‌جا می‌کند. لغزش، همهٔ چیزهای دیگری است که حرکت می‌کنند — معامله‌های دیگران که زودتر می‌نشینند.',
          'رابط سواپ این را با «حداقل دریافتی» مدیریت می‌کند. اگر معامله نتواند روی آن کف یا بالاتر پر شود، تراکنش برگشت می‌خورد و با قیمت بد اجرا نمی‌شود. گسِ همان تلاش را می‌پردازی و توکن‌هایت سر جایشان می‌مانند. این رفتار درست است، ولی همین است که می‌گوید «سواپ انجام نشد» و «هزینه کم شد» با هم تناقض ندارند.'
        ]
      ],
      [
        '۰٫۷٪ چه چیزی را می‌پوشاند و چه چیزی را نه',
        [
          'کارمزد برای رابط است: مسیریابی بین استخرهای همان شبکه‌ای که انتخاب کرده‌ای، نرخی که می‌خوانی، تراکنشی که کیف پولت امضا می‌کند. از توکن ورودی روی همان زنجیره گرفته می‌شود و تنها بخشی از تراکنش است که به ما می‌رسد.',
          'گس را پوشش نمی‌دهد، اثر قیمت را محدود نمی‌کند و بازگشت‌پذیری نمی‌خرد. هیچ‌کس نمی‌تواند یک معاملهٔ روی‌زنجیره را برگرداند — نه رابط، نه استخر، نه اعتبارسنج‌ها. سواپی که امضا کردی، سواپی است که انجام شده.'
        ]
      ],
      [
        'چک‌لیست پیش از امضا',
        [
          'پیش از تأیید، پنج چیز را ببین: شبکه با توکنی که واقعاً داری می‌خواند؛ اثر قیمت عددی است که حاضری بپذیری؛ حداقل دریافتی از کفِ خودت بالاتر است نه فقط از پیش‌فرض؛ خط کارمزد هم مبلغ و هم زنجیره را نام می‌برد؛ و مهلت (deadline) آن‌قدر کوتاه است که تراکنش گیرکرده بعداً با قیمت کهنه اجرا نشود.',
          'اگر هر کدام از این‌ها روی صفحه نیست، کار درست امضا نکردن است و بررسی از جای دیگر. نرخی که یکی از هزینه‌های خودش را پنهان می‌کند نرخ ارزان‌تر نیست، ناقص است.'
        ]
      ],
      [
        'در برنامه کجا را ببینیم',
        [
          'در هر سواپ، برنامه مسیر، کارمزد پلتفرم، اثر قیمت و حداقل دریافتی را پیش از باز شدن کیف پول نشان می‌دهد. بعد از امضا، هش تراکنش روی اکسپلورر همان زنجیره برای هر کسی — از جمله خودت — قابل بررسی است.',
          'اگر خط کارمزد روزی با آن‌چه از کیف پولت بیرون رفت نخواند، آن یک باگ است که باید گزارش شود، نه چیزی که بشود با توضیح ردش کرد.'
        ]
      ]
    ],
    facts: [
      ['کارمزد پلتفرم', '۰٫۷٪ از مقدار ورودی، روی هر شبکهٔ پشتیبانی‌شده، پیش از امضا روی صفحه'],
      ['کارمزد شبکه', 'با کوین خودِ زنجیره به اعتبارسنج‌ها پرداخت می‌شود — هرگز به پلتفرم'],
      ['کارمزد استخر', 'از قبل داخل نرخ است و خط جدا ندارد'],
      ['پیش از امضا روی صفحه', 'مسیر، کارمزد، اثر قیمت و حداقل دریافتی']
    ],
    faqs: [
      {
        q: 'کارمزد ۰٫۷٪ جدا از گس است؟',
        a: 'بله، این دو جدا هستند. کارمزد پلتفرم از توکن ورودی روی همان زنجیره گرفته می‌شود؛ گس با کوین بومی همان زنجیره به شبکه پرداخت می‌شود و را تنظیم‌کنندهٔ آن خودِ زنجیره است، نه پلتفرم.'
      },
      {
        q: 'چرا سواپ انجام نشد ولی کارمزد شبکه کم شد؟',
        a: 'سواپ انجام‌نشده یعنی معامله نتوانست روی حداقل دریافتی که تعیین کردی یا بالاتر پر شود، پس برگشت خورد و با قیمت بدتر اجرا نشد. شبکه همان تلاش را پردازش کرده و گس برای کاری است که اعتبارسنج‌ها انجام دادند، نه برای نتیجهٔ موفق.'
      },
      {
        q: 'کارمزد سواپ برگشت‌پذیر است؟',
        a: 'نه. تراکنش روی‌زنجیره‌ای که نهایی شده برگشت‌پذیر نیست، پس کارمزدی هم که در همان تراکنش گرفته شده توسط هیچ‌کس — نه رابط، نه استخر، نه زنجیره — قابل بازگشت نیست.'
      }
    ],
    links: [
      { href: '/fa/crypto-swap-without-kyc', text: 'سواپ بدون حساب کاربری و بدون احراز هویت' },
      { href: '/fa/crypto-market-history-analysis', text: 'پیش از معامله ببین یک سطح قیمتی قبلاً چطور رفتار کرده' },
      { href: '/fa/non-custodial-wallet', text: 'چرا کلیدها در کیف پول خودت می‌مانند' }
    ]
  },

  {
    kind: 'post',
    slug: 'custodial-vs-non-custodial-wallets',
    icon: 'key',
    topic: 'learn',
    lang: 'en',
    route: '/#/wallet',
    datePublished: '2026-09-24',
    title: 'Custodial vs non-custodial wallets: what you actually give up | FBT Swap',
    description:
      'Custody is not a feature you switch on. It decides who can move your assets, who can freeze them, and who answers when something goes wrong. A plain comparison, including the parts self-custody does not solve.',
    h1: 'Custodial vs non-custodial, without the slogans',
    body: [
      '“Not your keys, not your coins” is true and incomplete. Self-custody removes one class of risk and adds another, and the useful question is not which one is better in the abstract, but which risks you are personally able to carry.',
      'This page is a comparison, not an advertisement for either shape. FBT Swap is a non-custodial interface, so the bias is on the table.'
    ],
    sections: [
      [
        'What custody decides',
        [
          'Custody decides who holds the key that can move an asset. When a platform holds it, the balance on your screen is a record in that platform’s database — a claim against them — and the asset moves when they say it moves. When you hold it, the balance is on the chain and only a signature from your device moves it.',
          'That single difference produces the long list of consequences people usually argue about: whether your account can be frozen, whether a withdrawal can be delayed for review, whether a lost password can be reset, and what happens to your balance if the operator becomes insolvent.'
        ]
      ],
      [
        'What you give up by holding your own keys',
        [
          'Recovery. There is no password reset for a wallet. If the recovery phrase is lost and the device is gone, the assets are gone, permanently. Every non-custodial product is built around this and none of them can undo it.',
          'Reversibility. A signed transaction is final. Nobody can call it back, and nobody can intervene if you were tricked into signing a transfer or an approval that hands over spending rights.',
          'Support. A support desk cannot restore access to an asset it has no key to. What a non-custodial app can do is tell you exactly what happened and where to look, which is less comforting than it sounds, but it is also the reason it cannot lose your funds for you.'
        ]
      ],
      [
        'The middle ground is real, and it is still self-custody',
        [
          'Hardware signers keep the key off the machine that browses the internet. Browser wallets hold it in the extension. Mobile wallets, sometimes with biometric unlock and a local encrypted vault, keep it on the phone. All three are non-custodial in the sense that matters here: the operator cannot move your assets.',
          'What changes between them is where the single point of failure sits — a piece of paper, a device, or a passphrase — and how much friction stands between an attacker and your balance. There is no configuration where the failure point disappears.'
        ]
      ],
      [
        'A short checklist for choosing',
        [
          'Ask four questions. Who can move the asset without my involvement? If this company disappears tomorrow, what do I still have? If my device is lost, what is the recovery path and have I actually written it down? And: do I understand what I am being asked to sign, line by line?',
          'If the answer to the last one is no, the custody model is not your biggest risk yet. Approval screens are where most losses actually start, custodial or not.'
        ]
      ]
    ],
    facts: [
      ['Custody in this app', 'None. FBT Swap does not take deposits and holds no keys'],
      ['Recovery phrase', 'Never requested by the app — anyone who asks for it is not this app'],
      ['What we can do', 'Show you the quote, the route, the fee and the exact transaction to sign'],
      ['What nobody can do', 'Reverse a signed transaction or recover a lost phrase']
    ],
    faqs: [
      {
        q: 'Does FBT Swap hold my funds at any point?',
        a: 'No. The swap interface never takes deposits, never holds a recovery phrase and never signs on a user’s behalf. Assets stay in the connected wallet and every swap needs that wallet’s approval.'
      },
      {
        q: 'If I lose my phone, can support restore my wallet?',
        a: 'No, and no non-custodial service can. Access is restored by the recovery phrase or the backup you made, which is why writing it down — offline, in more than one place — is part of using self-custody rather than an optional extra.'
      },
      {
        q: 'Is a custodial account safer for a beginner?',
        a: 'It removes the recovery-phrase risk and adds counterparty risk: the operator can freeze, delay or lose your balance, and you hold a claim rather than an asset. Neither model is risk-free; they fail in different ways.'
      }
    ],
    links: [
      { href: '/non-custodial-crypto-swap', text: 'How a non-custodial swap is actually executed' },
      { href: '/crypto-swap-without-kyc', text: 'Swapping without an account or identity check' },
      { href: '/crypto-investing-yield-and-lending', text: 'What changes when custody is involved in yield' }
    ]
  },
  {
    kind: 'post',
    slug: 'fa/custodial-vs-non-custodial-wallets',
    icon: 'key',
    topic: 'learn',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/wallet',
    datePublished: '2026-09-24',
    title: 'تفاوت کیف پول امانی و غیرامانی: چه چیزی را واقعاً از دست می‌دهی؟ | FBT Swap',
    description:
      'امانت‌داری یک گزینه نیست که روشن و خاموش شود؛ تعیین می‌کند چه کسی می‌تواند دارایی‌ات را جابه‌جا کند، چه کسی می‌تواند مسدودش کند و وقتی مشکلی پیش آمد چه کسی پاسخ می‌دهد.',
    h1: 'امانی و غیرامانی، بدون شعار',
    body: [
      '«کلید مال تو نباشد، سکه مال تو نیست» درست است و ناقص. نگه‌داشتن کلید یک دسته ریسک را برمی‌دارد و دستهٔ دیگری را اضافه می‌کند. پرسش درست این نیست که کدام بهتر است، این است که تو شخصاً کدام ریسک را می‌توانی حمل کنی.',
      'این صفحه یک مقایسه است، نه تبلیغ یکی از دو طرف. FBT Swap یک رابط غیرامانی است، پس سوگیری‌اش روی میز گذاشته شده.'
    ],
    sections: [
      [
        'امانت‌داری دقیقاً چه چیزی را تعیین می‌کند',
        [
          'تعیین می‌کند کلیدی که می‌تواند دارایی را جابه‌جا کند دست کیست. وقتی یک پلتفرم آن را نگه می‌دارد، موجودی‌ای که روی صفحه می‌بینی یک رکورد در دیتابیس آن پلتفرم است — یعنی طلبی از آن‌ها — و دارایی وقتی جابه‌جا می‌شود که آن‌ها بگویند. وقتی خودت نگه می‌داری، موجودی روی زنجیره است و فقط امضای دستگاهِ تو آن را حرکت می‌دهد.',
          'همین یک تفاوت، تمام آن فهرست بلندی را می‌سازد که معمولاً دربارهٔ آن بحث می‌شود: اینکه حساب قابل مسدود شدن است یا نه، برداشت می‌تواند برای بررسی عقب بیفتد یا نه، رمز فراموش‌شده قابل بازنشانی است یا نه، و اگر اپراتور ورشکست شود موجودی تو چه می‌شود.'
        ]
      ],
      [
        'با نگه‌داشتن کلید، چه چیزی را از دست می‌دهی',
        [
          'بازگرداندن دسترسی. برای کیف پول، «بازنشانی رمز» وجود ندارد. اگر عبارت بازیابی گم شود و دستگاه هم از دست برود، دارایی‌ها برای همیشه رفته‌اند. هر محصول غیرامانی حول همین واقعیت ساخته شده و هیچ‌کدام نمی‌توانند از آن عبور کنند.',
          'بازگشت‌پذیری. تراکنش امضاشده نهایی است. هیچ‌کس نمی‌تواند برش گرداند و اگر با فریب تراکنشی یا مجوز خرجی امضا کرده باشی، هیچ‌کس نمی‌تواند وسط این ماجرا وارد شود.',
          'پشتیبانی. میز پشتیبانی به دارایی‌ای که کلیدش را ندارد دسترسی برنمی‌گرداند. کاری که یک برنامهٔ غیرامانی می‌تواند بکند این است که دقیق بگوید چه اتفاقی افتاد و کجا را نگاه کنی؛ این به‌اندازهٔ آنچه از «پشتیبانی» انتظار می‌رود دلگرم‌کننده نیست، ولی همان دلیلی است که آن برنامه هم نمی‌تواند دارایی‌ات را از دست تو بدهد.'
        ]
      ],
      [
        'راه میانه وجود دارد، و همچنان غیرامانی است',
        [
          'کیف پول سخت‌افزاری کلید را از دستگاهی که با اینترنت کار می‌کند دور نگه می‌دارد. کیف پول مرورگری آن را در افزونه نگه می‌دارد. کیف پول موبایل — گاهی با قفل بیومتریک و گاوصندوق رمزگذاری‌شدهٔ محلی — روی گوشی نگهش می‌دارد. هر سه در همان معنایی که مهم است غیرامانی‌اند: اپراتور نمی‌تواند دارایی را جابه‌جا کند.',
          'آنچه بین شان عوض می‌شود، جای همان یک نقطهٔ شکست است — یک تکه کاغذ، یک دستگاه، یا یک عبارت عبور — و مقدار فاصله‌ای که بین یک مهاجم و موجودی تو می‌ایستد. هیچ پیکربندی‌ای وجود ندارد که در آن این نقطه حذف شود.'
        ]
      ],
      [
        'چک‌لیست کوتاه انتخاب',
        [
          'چهار پرسش بپرس. بدون دخالت من، چه کسی می‌تواند دارایی را جابه‌جا کند؟ اگر این شرکت فردا ناپدید شود، من چه چیزی دارم؟ اگر دستگاهم گم شود، مسیر بازیابی چیست و آیا واقعاً آن را جایی نوشته‌ام؟ و: آیا می‌فهمم چه چیزی را خط‌به‌خط امضا می‌کنم؟',
          'اگر پاسخ پرسش آخر «نه» است، مدل امانت‌داری بزرگ‌ترین ریسک فعلی تو نیست. صفحهٔ تأیید مجوزها همان جایی است که بیشتر زیان‌ها در واقع شروع می‌شوند — امانی یا غیرامانی.'
        ]
      ]
    ],
    facts: [
      ['امانت‌داری در این برنامه', 'هیچ. FBT Swap سپرده نمی‌گیرد و کلیدی نگه نمی‌دارد'],
      ['عبارت بازیابی', 'برنامه هرگز آن را نمی‌خواهد — هر کسی که بخواهد، این برنامه نیست'],
      ['کاری که از ما برمی‌آید', 'نشان دادن نرخ، مسیر، کارمزد و همان تراکنشی که باید امضا شود'],
      ['کاری که از هیچ‌کس برنمی‌آید', 'برگرداندن تراکنش امضاشده یا بازگرداندن عبارت گم‌شده']
    ],
    faqs: [
      {
        q: 'آیا FBT Swap در هیچ مرحله‌ای دارایی من را نگه می‌دارد؟',
        a: 'نه. رابط سواپ نه سپرده می‌گیرد، نه عبارت بازیابی نگه می‌دارد و نه به‌جای کاربر امضا می‌کند. دارایی در کیف پول متصل می‌ماند و هر سواپ به تأیید همان کیف پول نیاز دارد.'
      },
      {
        q: 'اگر گوشی‌ام گم شود، پشتیبانی می‌تواند کیف پولم را برگرداند؟',
        a: 'نه، و هیچ سرویس غیرامانی دیگری هم نمی‌تواند. دسترسی با عبارت بازیابی یا نسخهٔ پشتیبانی که خودت گرفته‌ای برمی‌گردد؛ به همین دلیل نوشتن آن روی کاغذ و در بیش از یک جا بخشی از استفاده از کیف پول غیرامانی است، نه کار اضافه.'
      },
      {
        q: 'برای تازه‌کار، حساب امانی امن‌تر نیست؟',
        a: 'ریسک عبارت بازیابی را برمی‌دارد و ریسک طرف مقابل را اضافه می‌کند: اپراتور می‌تواند موجودی را مسدود یا عقب بیندازد یا از دست بدهد، و تو به‌جای دارایی، طلب نگه می‌داری. هیچ‌کدام بی‌ریسک نیستند؛ فقط شکل شکستشان فرق دارد.'
      }
    ],
    links: [
      { href: '/fa/non-custodial-wallet', text: 'کیف پول غیرامانی دقیقاً یعنی چه' },
      { href: '/fa/crypto-swap-without-kyc', text: 'سواپ بدون حساب کاربری و بدون احراز هویت' },
      { href: '/fa/crypto-investing-yield-and-lending', text: 'وقتی امانت‌داری وارد بازده می‌شود، چه چیزی عوض می‌شود' }
    ]
  },

  {
    kind: 'post',
    slug: 'what-stays-private-without-kyc',
    icon: 'privacy',
    topic: 'learn',
    lang: 'en',
    route: '/#/swap',
    datePublished: '2026-09-24',
    title: 'Swapping without KYC: what stays private and what does not | FBT Swap',
    description:
      'No account and no identity check is a real difference — and it is not anonymity. Here is exactly what this app never collects, and what the chain, the RPC endpoint and analytics firms can still see.',
    h1: 'Swapping without KYC: what stays private',
    body: [
      '“No KYC” describes what a service asks of you. It does not describe what the rest of the world can observe about the same transaction. Those are different questions, and confusing them is how people end up less private than they assumed.',
      'So this page does both halves: what this app never asks for, and what remains visible anyway.'
    ],
    sections: [
      [
        'What the app never collects',
        [
          'There is no account, so there is no email, phone number, name, address or document to hand over — not at signup, because there is no signup. The swap interface does not take custody, so it does not need an identity to give you a balance back. Your wallet address is what the app talks to, and it is a pseudonymous string, not a person.',
          'That is the whole claim, and it is deliberately narrow. It means: this service cannot leak an identity record it never had, and cannot hand one to anyone who asks for it.'
        ]
      ],
      [
        'What the chain still shows',
        [
          'Everything. Every balance, every transfer, every swap — permanently, publicly, to anyone with the address. A blockchain is an append-only public ledger; “non-custodial” and “no account” change nothing about that.',
          'Worse, it is correlatable. Send funds from an address that was funded by a KYC exchange and the link exists on-chain forever, whether or not any single service knows your name. Analysis firms build exactly this graph, and it only gets easier to build over time.'
        ]
      ],
      [
        'What leaks outside the chain',
        [
          'The endpoint that answers your requests sees your IP address. Public RPC nodes are run by someone; a wallet connection can reveal an address to the site you connect to. Both are metadata, both are outside the ledger, and both are often enough to connect an address to a network location.',
          'The practical consequence: privacy here is about what you decide to link together, not about a checkbox. Using a wallet that has never touched a KYC’d exchange, connected from a connection you are comfortable with, is a different posture from reusing your main address — and no interface can make that decision for you.'
        ]
      ],
      [
        'What “no KYC” does not mean',
        [
          'It does not mean sanctions or embargo rules stop applying to you, and it is not a promise that a transaction will be accepted by any particular counterparty. A decentralised pool does not ask who you are, but the chain, the token issuer, and any centralised party you later interact with still have their own rules — and a permissioned token can block a transfer regardless of who is signing.',
          'It also does not mean the app is anonymous software. The company behind it is named in the footer of every page, and the transaction hashes are on public explorers. The claim is narrow because a wide claim would be false.'
        ]
      ],
      [
        'Practical hygiene, in order of effect',
        [
          'Use an address that has never been funded from a KYC’d venue. Keep a separate address for anything you would not want linked to the rest. Check what you are approving before you sign, since an unlimited approval is a bigger privacy and security event than any of the above. And prefer your own RPC endpoint when you have one — it is the single largest metadata improvement available to you.',
          'None of this makes you invisible. It makes you harder to casually correlate, which is the realistic goal.'
        ]
      ]
    ],
    facts: [
      ['Account', 'None — no signup, so no email, phone or document is collected'],
      ['Custody', 'None — the app does not hold balances or keys'],
      ['On-chain', 'Every transfer and swap is public and permanent on the explorer'],
      ['Outside the chain', 'Your IP is visible to whichever RPC endpoint answers your requests']
    ],
    faqs: [
      {
        q: 'Is swapping without KYC the same as being anonymous?',
        a: 'No. It means no identity document is collected by this service. The transaction and the addresses involved remain public on the blockchain, and the RPC endpoint that serves your requests can see your IP address.'
      },
      {
        q: 'Does the app store my wallet address?',
        a: 'The app needs the address to read balances and build a transaction, and it needs the chain to broadcast it. That is public information by design, so it is not a secret the service is keeping for you or about you.'
      },
      {
        q: 'Can a swap be blocked if I do not identify myself?',
        a: 'A permissioned token or a restricted pool can refuse a transfer regardless of who signs it, and centralised services you interact with later apply their own rules. No interface can make a third-party restriction disappear.'
      }
    ],
    links: [
      { href: '/crypto-swap-without-kyc', text: 'How the swap flow works without an account' },
      { href: '/solana-token-swap', text: 'Solana swaps, SPL and Token-2022 — and what Token-2022 can restrict' },
      { href: '/non-custodial-crypto-swap', text: 'Who signs what, and where the keys stay' }
    ]
  },
  {
    kind: 'post',
    slug: 'fa/what-stays-private-without-kyc',
    icon: 'privacy',
    topic: 'learn',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/swap',
    datePublished: '2026-09-24',
    title: 'سواپ بدون احراز هویت: چه چیزی خصوصی می‌ماند و چه چیزی نه | FBT Swap',
    description:
      'بدون حساب کاربری و بدون احراز هویت یک تفاوت واقعی است — و ناشناس‌بودن نیست. این‌جا دقیقاً می‌گوید این برنامه چه چیزی را هرگز جمع نمی‌کند و زنجیره، گرهٔ RPC و شرکت‌های تحلیل داده چه چیزی را می‌بینند.',
    h1: 'سواپ بدون احراز هویت: چه چیزی خصوصی می‌ماند',
    body: [
      '«بدون احراز هویت» توصیف چیزی است که یک سرویس از تو نمی‌خواهد؛ توصیف آنچه بقیهٔ دنیا می‌تواند دربارهٔ همان تراکنش ببیند نیست. این دو پرسش متفاوت‌اند و قاطی‌کردنشان باعث می‌شود آدم‌ها فکر کنند از آنچه هست خصوصی‌ترند.',
      'این صفحه هر دو نیمه را می‌گوید: آنچه این برنامه هرگز نمی‌پرسد، و آنچه با این حال دیده می‌شود.'
    ],
    sections: [
      [
        'آنچه برنامه هرگز جمع نمی‌کند',
        [
          'حساب کاربری وجود ندارد، پس ایمیل، شمارهٔ تلفن، نام، نشانی یا مدرکی برای تحویل دادن نیست — در ثبت‌نام نه، چون ثبت‌نامی وجود ندارد. رابط سواپ امانت‌دار نیست، پس برای برگرداندن موجودی به کسی به هویت نیاز ندارد. چیزی که برنامه با آن کار می‌کند آدرس کیف پول توست، و آن یک رشتهٔ مستعار است نه یک شخص.',
          'کل ادعا همین است و عمداً باریک: این سرویس نمی‌تواند پروندهٔ هویتی‌ای که هرگز نداشته را لو بدهد یا به کسی که سراغش را می‌گیرد تحویل دهد.'
        ]
      ],
      [
        'آنچه زنجیره همچنان نشان می‌دهد',
        [
          'همه‌چیز. هر موجودی، هر انتقال، هر سواپ — به‌صورت دائمی، عمومی و برای هر کسی که آدرس را داشته باشد. بلاکچین یک دفتر عمومیِ فقط-افزودنی است و «غیرامانی» یا «بدون حساب» هیچ چیزی از این واقعیت را عوض نمی‌کند.',
          'بدتر اینکه قابل تطبیق است. اگر دارایی‌ای را از آدرسی بفرستی که از یک صرافی با احراز هویت تغذیه شده، آن پیوند برای همیشه روی زنجیره می‌ماند، چه هیچ سرویسی نام تو را بداند و چه نداند. شرکت‌های تحلیل داده دقیقاً همین گراف را می‌سازند و با گذر زمان فقط ساختنش آسان‌تر می‌شود.'
        ]
      ],
      [
        'آنچه بیرون از زنجیره لو می‌رود',
        [
          'گرهی که به درخواست‌هایت جواب می‌دهد نشانی IP تو را می‌بیند. گره‌های عمومی RPC را کسی اداره می‌کند؛ و اتصال یک کیف پول می‌تواند آدرس را به همان سایتی که وصل می‌شوی نشان دهد. هر دو «فراداده» هستند، هر دو بیرون دفتر زنجیره‌اند، و هر دو اغلب برای وصل‌کردن یک آدرس به یک موقعیت شبکه کافی‌اند.'
        ]
      ],
      [
        '«بدون احراز هویت» چه معنایی ندارد',
        [
          'معنایش این نیست که قواعد تحریم و ممنوعیت‌ها دربارهٔ تو اجرا نمی‌شوند، و وعدهٔ این هم نیست که هر طرف مقابل، تراکنشت را می‌پذیرد. یک استخر غیرمتمرکز نمی‌پرسد تو کی هستی، ولی زنجیره، صادرکنندهٔ توکن و هر طرف متمرکزی که بعداً با آن معامله کنی قواعد خودشان را دارند — و یک توکن مجوزدار می‌تواند انتقال را بدون توجه به اینکه چه کسی امضا می‌کند رد کند.',
          'همچنین معنایش این نیست که برنامه نرم‌افزاری ناشناس است. شرکت پشت آن در پاورقی هر صفحه نام برده شده و هش تراکنش‌ها روی اکسپلوررهای عمومی است. ادعا باریک است چون ادعای پهن، دروغ می‌بود.'
        ]
      ],
      [
        'بهداشت خصوصی، به ترتیب اثر',
        [
          'از آدرسی استفاده کن که هرگز از یک صرافی با احراز هویت تغذیه نشده باشد. برای هر چیزی که نمی‌خواهی به بدنهٔ اصلی‌ات وصل شود، آدرس جدا نگه دار. پیش از امضا ببین مجوز چه چیزی را می‌دهد، چون یک مجوز نامحدود رویدادی بزرگ‌تر از کل این فهرست است — هم از نظر امنیتی هم از نظر حریم خصوصی. و اگر RPC خودت را داری، از آن استفاده کن؛ این بزرگ‌ترین بهبود فراداده‌ای است که در اختیار خودت است.'
        ]
      ]
    ],
    facts: [
      ['حساب کاربری', 'ندارد — ثبت‌نامی نیست، پس ایمیلی، شماره‌ای و مدرکی جمع نمی‌شود'],
      ['امانت‌داری', 'ندارد — برنامه موجودی و کلید نگه نمی‌دارد'],
      ['روی زنجیره', 'هر انتقال و سواپ روی اکسپلورر عمومی و دائمی است'],
      ['بیرون زنجیره', 'IP تو برای هر گرهی که پاسخ می‌دهد قابل دیدن است']
    ],
    faqs: [
      {
        q: 'سواپ بدون احراز هویت یعنی ناشناس ماندن؟',
        a: 'نه. یعنی این سرویس هیچ مدرک هویتی جمع نمی‌کند. تراکنش و آدرس‌های دخیل روی بلاکچین عمومی می‌مانند و گرهی که درخواست‌ها را پاسخ می‌دهد IP تو را می‌بیند.'
      },
      {
        q: 'برنامه آدرس کیف پول من را ذخیره می‌کند؟',
        a: 'برنامه برای خواندن موجودی و ساختن تراکنش به آدرس نیاز دارد و زنجیره برای انتشار تراکنش به آن نیاز دارد. این اطلاعات بنا بر طراحی عمومی است، پس رازی نیست که سرویس برای تو نگه دارد.'
      },
      {
        q: 'اگر هویتم را نگویم، تراکنش می‌تواند مسدود شود؟',
        a: 'یک توکن مجوزدار یا استخر محدودشده می‌تواند بدون توجه به امضاکننده انتقال را رد کند، و سرویس‌های متمرکزی که بعداً با آن‌ها کار می‌کنی قواعد خودشان را دارند. هیچ رابطی نمی‌تواند محدودیت طرف سوم را ناپدید کند.'
      }
    ],
    links: [
      { href: '/fa/crypto-swap-without-kyc', text: 'جریان سواپ بدون حساب کاربری چطور کار می‌کند' },
      { href: '/fa/solana-token-swap', text: 'سواپ سولانا، SPL و Token-2022 — و آنچه Token-2022 می‌تواند محدود کند' },
      { href: '/fa/non-custodial-wallet', text: 'چه کسی امضا می‌کند و کلیدها کجا می‌مانند' }
    ]
  }
];

const BLOG_HUBS = [
  {
    kind: 'hub',
    slug: 'blog',
    icon: 'book',
    topic: 'learn',
    lang: 'en',
    route: '/#/help',
    title: 'Crypto Blog & Practical Guides: Swaps, Wallets and Markets | FBT Swap',
    description:
      'The FBT Swap crypto blog explains swap fees, wallet custody and privacy, beginner crypto concepts, developer APIs, charts, market signals and tokenised global stocks.',
    h1: 'Crypto blog and practical guides',
    body: [
      'Start with a clear answer to a practical question: what a swap quote contains, what a non-custodial wallet changes, what public market data can tell you, or how to use the read-only API.',
      'The guides are grouped by language and topic. Each describes its limits alongside the feature, uses real examples where available and avoids presenting historical market movement or a displayed yield as a promise.'
    ],
    factLabel: 'Guides',
    facts: [
      ['Crypto basics', 'Networks, tokens, wallet safety and informed signing'],
      ['Swap costs', 'Network gas, pool pricing and the disclosed platform fee'],
      ['Developer API', 'Read-only market, chart and candle endpoints'],
      ['Charts and signals', 'Historical market readings, not predictions or advice'],
      ['Tokenised equities', 'Issuer, ownership, liquidity and access limits']
    ]
  },
  {
    kind: 'hub',
    slug: 'fa/blog',
    icon: 'book',
    topic: 'learn',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/help',
    title: 'وبلاگ ارز دیجیتال و راهنماهای کاربردی | سواپ، کیف پول و بازار | FBT Swap',
    description:
      'راهنماهای FBT Swap دربارهٔ کارمزد سواپ، امنیت و امانت‌داری کیف پول، حریم خصوصی، آموزش پایهٔ کریپتو، API توسعه‌دهندگان، نمودار و سهام توکنی‌شده.',
    h1: 'وبلاگ ارز دیجیتال و راهنماهای کاربردی',
    body: [
      'از یک پرسش عملی شروع کن: نرخ سواپ از چه چیزی ساخته شده، کیف پول غیرامانی چه چیزی را عوض می‌کند، دادهٔ عمومی بازار چه چیزی را نشان می‌دهد یا چطور از API فقط‌خواندنی استفاده کنی.',
      'راهنماها بر پایهٔ زبان و موضوع کنار هم آمده‌اند. هر صفحه محدودیت را کنار قابلیت توضیح می‌دهد، نمونه‌های واقعی را به کار می‌برد و حرکت گذشتهٔ بازار یا نرخ نمایش‌داده‌شده را وعدهٔ سود معرفی نمی‌کند.'
    ],
    factLabel: 'راهنماها',
    facts: [
      ['مفاهیم پایهٔ کریپتو', 'شبکه، توکن، امنیت کیف پول و امضای آگاهانه'],
      ['هزینه‌های سواپ', 'گس شبکه، قیمت استخر و کارمزد شفاف پلتفرم'],
      ['API توسعه‌دهندگان', 'مسیرهای فقط‌خواندنی بازار، نمودار و کندل'],
      ['نمودار و سیگنال', 'خوانش دادهٔ گذشته؛ نه پیش‌بینی یا توصیه'],
      ['سهام توکنی‌شده', 'محدودیت ناشر، مالکیت، نقدشوندگی و دسترسی']
    ]
  }
];

/*
 * Intent-led learning and data landings. Each page answers a distinct question
 * in useful, language-specific copy; none is a keyword-only doorway. The market
 * pair progressively enhances a crawlable static explanation with 30 live
 * API rows, 7-day sparklines and a transparent, non-prescriptive trend read.
 */
const SEARCH_LANDINGS = [
  {
    slug: 'fa/crypto-education',
    icon: 'book',
    topic: 'learn',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/learn',
    title: 'آموزش ارز دیجیتال از پایه | سواپ، کیف پول و نمودار | FBT Swap',
    description: 'راهنمای شروع ارز دیجیتال: تفاوت شبکه و توکن، کیف پول غیرامانی، سواپ، نمودار و ریسک بازده دیفای را روشن و بدون وعدهٔ سود یاد بگیر.',
    h1: 'آموزش ارز دیجیتال؛ از شبکه و کیف پول تا سواپ و نمودار',
    body: [
      'این راهنما برای کسی است که می‌خواهد پیش از وصل‌کردن کیف پول یا تبدیل توکن، بداند هر مرحله چه کاری انجام می‌دهد. از شبکه و آدرس قرارداد شروع می‌کنیم، بعد سراغ امنیت کیف پول، قیمت‌خوانی و ریسک می‌رویم؛ نه از وعدهٔ سود و نه از یک فهرست خرید.',
      'در FBT Swap، سواپِ روی زنجیره با کیف پول خودت امضا می‌شود. این تفاوت مهم است: برنامه دارایی را نگه نمی‌دارد و نمی‌تواند تراکنش نهایی را برگرداند. در هر گام، کارمزد، محدودیت‌ها و چیزی را که هنوز نمی‌دانیم باید جدا از تبلیغات دید.',
      'اگر تازه شروع کرده‌ای، راه را به ترتیب برو: اول مفاهیم، بعد یک کیف پول آزمایشی یا شبیه‌ساز، سپس خواندن قیمت و در آخر آشنایی با ابزارهای دیفای. برای تمرین واقعی، هیچ‌وقت از پول ضروری یا مبلغی که توان ازدست‌دادنش را نداری استفاده نکن.'
    ],
    sections: [
      ['۱. شبکه، کوین و توکن چه فرقی دارند؟', [
        'شبکه دفترکل و قواعدی است که تراکنش روی آن ثبت می‌شود؛ کوین بومی برای پرداخت کارمزد و فعالیت همان شبکه به کار می‌رود؛ توکن قراردادی است که روی یک شبکه ساخته شده است. یک نماد می‌تواند روی چند شبکه قراردادهای متفاوت داشته باشد، پس نام و لوگو برای شناسایی کافی نیست.',
        'پیش از ارسال یا سواپ، شبکهٔ کیف پول، آدرس قرارداد و دارایی مقصد را دوباره بررسی کن. ارسال دارایی روی شبکهٔ اشتباه ممکن است برگشت‌پذیر نباشد. FBT Swap فهرست شبکه‌های پشتیبانی‌شده را در صفحهٔ شبکه‌ها نشان می‌دهد؛ پشتیبانی از یک شبکه به‌تنهایی تضمین نمی‌کند هر توکنی نقدینگی یا مسیر سواپ داشته باشد.'
      ]],
      ['۲. کیف پول غیرامانی و عبارت بازیابی', [
        'در کیف پول غیرامانی، کلید یا عبارت بازیابی دست خود کاربر است. عبارت بازیابی را در وب‌سایت، چت، فرم پشتیبانی یا کد برنامه وارد نکن و آن را در فضای ابریِ بی‌رمز ذخیره نکن. هرکس آن را داشته باشد می‌تواند دارایی را جابه‌جا کند.',
        'پیش از امضا، متن درخواست کیف پول را بخوان: اتصال ساده با مجوز انتقال توکن یکی نیست. اگر مقصد، مقدار یا مجوز نامفهوم است، درخواست را رد کن و از مسیر رسمی کیف پول بررسی کن.'
      ]],
      ['۳. سواپ ارز دیجیتال از نرخ تا امضا', [
        'رابط سواپ از تجمیع‌کننده‌های عمومی برای پیدا کردن مسیر در صرافی‌های غیرمتمرکز همان شبکه قیمت می‌گیرد. نرخ، اثر قیمت، حداقل دریافتی و کارمزد پلتفرم را پیش از بازشدن کیف پول بررسی کن. کارمزد گس جداست و به شبکه پرداخت می‌شود؛ کارمزد استخر نیز ممکن است در نرخ پیشنهادی منعکس شود.',
        'بعد از بررسی جزئیات، کیف پول تراکنش را امضا می‌کند و زنجیره آن را اجرا می‌کند. تراکنش تأییدشده را نمی‌توان مانند پرداخت بانکی لغو کرد. هیچ سرویس غیرامانی نمی‌تواند عبارت بازیابی گم‌شده یا دارایی فرستاده‌شده به نشانی اشتباه را بازیابی کند.'
      ]],
      ['۴. نمودار و سیگنال را چطور بخوانیم؟', [
        'نمودار قیمت می‌گوید در یک بازهٔ گذشته چه اتفاقی افتاده است. بازهٔ زمانی، منبع داده، نقدینگی و نوسان روی برداشت اثر می‌گذارند. سیگنال‌های آماری می‌توانند حرکت چند بازه را خلاصه کنند؛ اما از گذشته آینده را معلوم نمی‌کنند و جای برنامهٔ مدیریت ریسک را نمی‌گیرند.',
        'صفحهٔ بازار FBT Swap قیمت‌ها، نمودار هفت‌روزه و مقایسهٔ تغییر ۲۴ساعته با هفت‌روزه را نشان می‌دهد. برچسب روندِ آن صفحه صرفاً خلاصهٔ دادهٔ گذشته است، نه دستور خریدوفروش یا توصیهٔ شخصی.'
      ]],
      ['۵. «سود دلاری» در دیفای یعنی سود تضمینی نیست', [
        'وقتی نرخ بازده با دلار یا استیبل‌کوین نمایش داده می‌شود، واحد نمایش به‌تنهایی اصل سرمایه یا مبلغ سود را تضمین نمی‌کند. نرخ استخر و وام‌دهی متغیر است؛ قرارداد هوشمند، نقدشوندگی، افت قیمت دارایی و جداشدن قیمت استیبل‌کوین از یک دلار هم ریسک‌اند.',
        'سهام جهانیِ توکنی‌شده نیز لزوماً همان مالکیت مستقیم سهم در کارگزاری نیست. صادرکننده، حق بازخرید، بازار ثانویه، کارمزد و محدودیت منطقه‌ای را بررسی کن. صفحهٔ FBT فعلاً دادهٔ بعضی دارایی‌های توکنی‌شده را دنبال می‌کند؛ این به معنی تضمین معامله یا دسترسی در هر کشور نیست.'
      ]]
    ],
    facts: [
      ['ترتیب یادگیری', 'شبکه و توکن ← کیف پول ← نرخ و کارمزد ← نمودار و ریسک'],
      ['امضای تراکنش', 'فقط در کیف پولی که خودت کنترل می‌کنی'],
      ['نمودار و سیگنال', 'خلاصهٔ دادهٔ گذشته؛ نه پیش‌بینی و نه توصیه'],
      ['بازده دیفای', 'متغیر و پرریسک؛ سود ثابت یا دلاری تضمین نمی‌شود']
    ],
    faqs: [
      { q: 'برای شروع یادگیری ارز دیجیتال چه چیزی را اول یاد بگیرم؟', a: 'اول تفاوت شبکه، کوین و توکن و روش نگهداری عبارت بازیابی را یاد بگیر. بعد هزینهٔ گس، قیمت پیشنهادی، اثر قیمت و حداقل دریافتی را پیش از امضای یک سواپ بررسی کن.' },
      { q: 'آیا نمودار یا سیگنال سود آینده را تضمین می‌کند؟', a: 'نه. نمودار و سیگنال خلاصه‌ای از داده‌های تاریخی‌اند. بازار می‌تواند برخلاف هر الگو حرکت کند و این محتوا توصیهٔ مالی نیست.' },
      { q: 'آیا سود دلاری دیفای ثابت است؟', a: 'خیر. نرخ‌ها ممکن است تغییر کنند و ریسک قرارداد، نقدشوندگی، دارایی پایه و استیبل‌کوین باقی است. نمایش یک عدد به دلار به معنی تضمین اصل پول یا بازده نیست.' }
    ],
    links: [
      { href: '/fa/blog', text: 'وبلاگ و راهنماهای بلند ارز دیجیتال' },
      { href: '/fa/non-custodial-wallet', text: 'امنیت کیف پول غیرامانی و عبارت بازیابی' },
      { href: '/fa/crypto-investing-yield-and-lending', text: 'بازده دیفای و ریسک سرمایه‌گذاری' },
      { href: '/fa/crypto-market-charts-signals', text: 'قیمت ۳۰ دارایی، نمودار و خوانش بازار' }
    ]
  },
  {
    slug: 'crypto-education',
    icon: 'book',
    topic: 'learn',
    lang: 'en',
    route: '/#/learn',
    title: 'Crypto Education for Beginners: Wallets, Swaps and Charts | FBT Swap',
    description: 'A practical crypto learning guide to networks, tokens, wallet safety, DEX swaps, charts, DeFi yield and risk — without profit promises.',
    h1: 'Crypto education: networks, wallets, swaps and charts',
    body: [
      'This guide is for someone who wants to understand a crypto transaction before connecting a wallet or exchanging a token. It starts with networks and token contracts, then covers wallet safety, price quotes, charts and risk — not a list of coins to buy.',
      'On-chain swaps in FBT Swap are signed in your own wallet. The interface does not hold assets and cannot reverse a settled transaction. Read the fee, limitations and unknowns at each step rather than relying on a marketing claim.',
      'A sensible learning path is concepts first, then a test wallet or simulator, then price and chart literacy, and only then DeFi tools. Do not use essential money or funds you cannot afford to lose for practice.'
    ],
    sections: [
      ['1. Network, coin and token are different things', [
        'A network is the ledger and the rules that record a transaction; its native coin pays for network activity; a token is a contract deployed on a network. The same ticker can refer to different contracts on different networks, so a name or logo is not enough to identify an asset.',
        'Before sending or swapping, check the wallet network, token contract and destination asset. A transfer on the wrong network may not be recoverable. FBT Swap lists its supported networks, but network support alone does not mean every token has liquidity or a swap route.'
      ]],
      ['2. Non-custodial wallets and recovery phrases', [
        'With a non-custodial wallet, the user controls the key or recovery phrase. Never enter a recovery phrase into a website, chat, support form or application code, and do not leave an unencrypted copy in cloud storage. Anyone who obtains it can move the assets.',
        'Read wallet prompts before signing: a connection request is not the same as a token-transfer approval. If the destination, amount or permission is unclear, reject the request and verify it through the wallet’s official route.'
      ]],
      ['3. From a swap quote to a signed transaction', [
        'A swap interface asks public aggregators for routes through decentralised exchanges on the selected network. Check the quote, price impact, minimum received and platform fee before the wallet opens. Network gas is separate and paid to the chain; a pool fee may already be reflected in the quoted rate.',
        'After you review the details, your wallet signs and the chain executes the transaction. A confirmed on-chain transaction cannot be cancelled like a bank payment. A non-custodial service cannot recover a lost recovery phrase or reverse a transfer to the wrong address.'
      ]],
      ['4. Reading a chart or signal without treating it as a forecast', [
        'A price chart records what happened in a past window. Timeframe, data source, liquidity and volatility all affect what a chart can tell you. Statistical signals can summarise movement across windows, but historical data does not reveal the future or replace risk management.',
        'The FBT market page shows prices, a seven-day chart and a comparison of 24-hour with seven-day change. Its trend label is a summary of past data, not a buy/sell instruction or personalised recommendation.'
      ]],
      ['5. Dollar-denominated DeFi yield is not guaranteed dollar profit', [
        'A yield displayed in dollars or a dollar-pegged token does not guarantee principal or a cash return. Pool and lending rates vary; smart-contract, liquidity, underlying-asset and stablecoin depeg risks remain.',
        'A tokenised global stock is not automatically the same as direct ownership of a share held at a brokerage. Check the issuer, redemption rights, secondary-market liquidity, fees and regional eligibility. FBT currently tracks selected tokenised-asset data; that does not promise trading access in every country.'
      ]]
    ],
    facts: [
      ['Learning order', 'Network and token → wallet → quote and fees → chart and risk'],
      ['Transaction approval', 'Signed only in a wallet you control'],
      ['Charts and signals', 'Summaries of past data, not forecasts or advice'],
      ['DeFi yield', 'Variable and risky; no fixed or dollar return is promised']
    ],
    faqs: [
      { q: 'What should a beginner learn first about crypto?', a: 'Start with the difference between a network, a coin and a token, and how to protect a recovery phrase. Then learn to review gas, the quote, price impact and minimum received before signing a swap.' },
      { q: 'Can a chart or market signal guarantee a future return?', a: 'No. Charts and signals summarise historical data. Markets can move against any pattern, and this material is not financial advice.' },
      { q: 'Is dollar-denominated DeFi yield fixed?', a: 'No. Rates can change and contract, liquidity, underlying-asset and stablecoin risks remain. Quoting a figure in dollars does not guarantee principal or returns.' }
    ],
    links: [
      { href: '/blog', text: 'Crypto blog and long-form guides' },
      { href: '/custodial-vs-non-custodial-wallets', text: 'Custodial and non-custodial wallets' },
      { href: '/crypto-investing-yield-and-lending', text: 'DeFi yield and investing risks' },
      { href: '/crypto-market-charts-signals', text: 'Thirty assets, charts and market readings' }
    ]
  },
  {
    slug: 'fa/developers',
    icon: 'code',
    topic: 'learn',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/developers',
    title: 'آموزش توسعه‌دهندگان وب۳ | شروع کار با API بازار FBT Swap',
    description: 'راهنمای عملی توسعه‌دهندگان برای API عمومی بازار FBT: نمونهٔ واقعی curl و JavaScript، نمودار و کندل، کنترل خطا و نگهداری امن کلیدها.',
    h1: 'آموزش توسعه‌دهندگان وب۳؛ اولین درخواست به API بازار',
    body: [
      'این آموزش برای ساخت کلاینتی است که دادهٔ عمومی بازار را می‌خواند؛ نه برای امضای تراکنش یا جابه‌جایی دارایی کاربر. هر دو نمونه از endpoint بازار استفاده می‌کنند و کلید API خصوصی لازم ندارند.',
      'پاسخ‌های API می‌توانند به محدودیت منبع بالادستی، کش یا اختلال شبکه وابسته باشند. وضعیت HTTP را بررسی کن، پاسخ را cache کن و در صورت محدودشدن، backoff داشته باش. این سرویس قرارداد uptime یا SLA برای برنامهٔ تو ارائه نمی‌دهد.',
      'برای هرپارامتر و endpoint تازه، قرارداد ماشین‌خوان را پیش از توسعه بخوان. مستندات اجرایی باید با پاسخ واقعی سرویس یکی باشد؛ اگر چیزی در OpenAPI نیست، فرض نکن که پشتیبانی می‌شود.'
    ],
    sections: [
      ['۱. API عمومی را با یک درخواست امن شروع کن', [
        'GET /api/markets?per_page=5 فهرست بازار را از همان دامنه می‌خواند. برای مسیرهای عمومی این راهنما کلید کاربر لازم نیست. پاسخ را JSON فرض کن، اما همیشه response.ok و شکل داده را بررسی کن؛ upstream ممکن است موقتاً در دسترس نباشد.',
        'در رابط وب، از مسیر نسبی /api استفاده کن تا مرورگر همان دامنه را صدا بزند. برای سرویس بیرونی از آدرس عمومی https://fbtswap.ir/api استفاده کن و محدودیت CORS و شرایط استفاده را از OpenAPI و پاسخ سرور بررسی کن.'
      ]],
      ['۲. نمودار خطی و کندل را از endpoint درست بگیر', [
        'GET /api/chart/bitcoin?days=7 تاریخچهٔ قیمت را برمی‌گرداند. برای نمودار شمعی، GET /api/ohlc/bitcoin?days=30 دادهٔ باز، سقف، کف و بسته‌شدن (OHLC) را می‌دهد. هر دو مسیر دادهٔ تاریخی‌اند و تضمین نمی‌کنند قیمت آینده چه می‌شود.',
        'برای فهرست ۳۰ دارایی، یک درخواست /api/markets?per_page=30 کافی است؛ همان پاسخ سری sparkline هفت‌روزه را همراه اطلاعات بازار می‌آورد. برای ساخت جدول، از ۳۰ درخواست جداگانهٔ نمودار استفاده نکن.'
      ]],
      ['۳. خطا، cache و کلیدها را جدی بگیر', [
        'پاسخ‌های 4xx و 5xx را از دادهٔ معتبر جدا کن و درخواست ناموفق را به‌عنوان قیمت صفر ذخیره نکن. نتایج را متناسب با نوع داده cache کن، retryها را با فاصلهٔ افزایشی انجام بده و در برابر 429 یا Retry-After مطابق پاسخ سرور رفتار کن.',
        'کلید ارائه‌دهندهٔ داده یا مدل را در متغیری با پیشوند VITE_، کد فرانت‌اند یا APK نگذار؛ این متغیرها عمومی می‌شوند. کلید خصوصی فقط در محیط سرور نگهداری شود. API بازار FBT برای استفادهٔ عمومی کلید کاربر نمی‌خواهد.'
      ]],
      ['۴. از قرارداد API ماشین‌خوان استفاده کن', [
        'فهرست endpointهای خواندنی، پارامترها و مرزهای سرویس در /api/openapi.json است. از همان مستندات برای ساخت typeها و اعتبارسنجی ورودی استفاده کن و مسیرهای write یا داخلی را به‌عنوان API عمومی فرض نکن.',
        'قبل از انتشار integration، سناریوی دادهٔ خالی، timeout، پاسخ نامعتبر، rate limit و قطع منبع را آزمایش کن. اگر برنامه‌ات برای تصمیم مالی یا نمایش قیمت به feed نیاز دارد، وضعیت «داده در دسترس نیست» را به‌جای مقدار ساختگی نشان بده.'
      ]]
    ],
    codeSamples: [
      { label: 'درخواست curl', language: 'bash', code: ['curl -fsS "https://fbtswap.ir/api/markets?per_page=5" ' + String.fromCharCode(92), '  -H "accept: application/json"'].join(String.fromCharCode(10)) },
      { label: 'خواندن همان API در JavaScript', language: 'javascript', code: [
        'const response = await fetch("/api/markets?per_page=5", {',
        '  headers: { accept: "application/json" }',
        '});',
        'if (!response.ok) throw new Error("HTTP " + response.status);',
        'const markets = await response.json();',
        'console.table(markets.slice(0, 5));'
      ].join(String.fromCharCode(10)) }
    ],
    facts: [
      ['نوع داده', 'عمومی و فقط‌خواندنی در endpointهای نمونه'],
      ['احراز هویت', 'برای endpointهای بازار این راهنما لازم نیست'],
      ['نمودار', 'تاریخچهٔ قیمت و OHLC از مسیرهای جداگانه'],
      ['قابلیت اطمینان', 'پاسخ upstream را cache و خطا را صریح مدیریت کن']
    ],
    faqs: [
      { q: 'برای API بازار باید کلید بسازم؟', a: 'نمونه‌های عمومی این راهنما برای خواندن بازار به کلید کاربر نیاز ندارند. جزئیات هر مسیر و مرزهای دسترسی را در /api/openapi.json بررسی کن.' },
      { q: 'آیا API قیمت یا uptime را تضمین می‌کند؟', a: 'نه. داده به سرویس‌های بالادستی و کش وابسته است و uptime یا SLA تضمین‌شده‌ای اعلام نشده. خطا و دادهٔ ناموجود را در برنامهٔ خودت صریح نمایش بده.' },
      { q: 'آیا باید هر توکن را با یک درخواست نمودار بخوانم؟', a: 'برای جدول ۳۰ دارایی از /api/markets?per_page=30 استفاده کن؛ پاسخ فهرست، دادهٔ sparkline هفت‌روزه هم دارد. درخواست بیشتر از نیاز، سهمیهٔ مشترک را مصرف می‌کند.' }
    ],
    links: [
      { href: '/api/openapi.json', text: 'قرارداد ماشین‌خوان API بازار' },
      { href: '/developers', text: 'راهنمای توسعه‌دهندگان به زبان انگلیسی' },
      { href: '/fa/crypto-market-charts-signals', text: 'نمونهٔ فهرست ۳۰ دارایی و نمودار زنده' },
      { href: '/fa/crypto-education', text: 'مفاهیم پایهٔ ارز دیجیتال' }
    ]
  },
  {
    slug: 'developers',
    icon: 'code',
    topic: 'learn',
    lang: 'en',
    route: '/#/developers',
    title: 'Web3 Developer Guide: FBT Market API Quickstart | FBT Swap',
    description: 'A practical guide to the public FBT market API: working curl and JavaScript examples, chart and candle endpoints, error handling and key safety.',
    h1: 'Web3 developer guide: your first market API request',
    body: [
      'This quickstart is for a client that reads public market data — not one that signs transactions or moves a user’s funds. Both examples call the market endpoint, and neither needs a private API key.',
      'API responses depend on upstream limits, caching and network availability. Check HTTP status, cache results and back off when rate-limited. This service does not promise uptime or an SLA for your application.',
      'Before building against a new route, read the machine-readable contract. Documentation used by an integration should match the server response; do not assume an endpoint is supported if it is absent from OpenAPI.'
    ],
    sections: [
      ['1. Start with one safe public request', [
        'GET /api/markets?per_page=5 reads a ranked market list from the same origin. The public market endpoints in this guide do not need a user API key. Still check response.ok and validate the response shape; an upstream provider can be temporarily unavailable.',
        'In a browser client, use the relative /api path so the request stays on the same origin. From another service, use https://fbtswap.ir/api and verify CORS and usage details in OpenAPI and the server response.'
      ]],
      ['2. Use the right endpoint for lines and candles', [
        'GET /api/chart/bitcoin?days=7 returns price history. For candlesticks, GET /api/ohlc/bitcoin?days=30 returns open, high, low and close data. Both describe historical observations; neither promises a future price.',
        'One request to /api/markets?per_page=30 can supply a 30-asset table and each row’s seven-day sparkline. Do not fan out to thirty separate chart requests for that view.'
      ]],
      ['3. Handle errors, caching and credentials deliberately', [
        'Keep 4xx and 5xx responses separate from valid market data; never store a failed request as a zero price. Cache according to the data type, use exponential backoff, and respect 429 or Retry-After when present.',
        'Do not put a provider or model key in a VITE_ variable, frontend bundle or APK: those values are public. Keep private credentials in the server environment. The public FBT market examples do not require a user key.'
      ]],
      ['4. Build from the machine-readable API contract', [
        'The read endpoints, parameters and service boundaries are described at /api/openapi.json. Use it to generate types and validate inputs; do not treat write or internal routes as a public integration surface.',
        'Before release, test empty data, timeouts, malformed responses, rate limits and upstream outages. If your application depends on a feed for a financial decision or a displayed price, show “data unavailable” rather than a made-up value.'
      ]]
    ],
    codeSamples: [
      { label: 'curl request', language: 'bash', code: ['curl -fsS "https://fbtswap.ir/api/markets?per_page=5" ' + String.fromCharCode(92), '  -H "accept: application/json"'].join(String.fromCharCode(10)) },
      { label: 'Read the same API in JavaScript', language: 'javascript', code: [
        'const response = await fetch("/api/markets?per_page=5", {',
        '  headers: { accept: "application/json" }',
        '});',
        'if (!response.ok) throw new Error("HTTP " + response.status);',
        'const markets = await response.json();',
        'console.table(markets.slice(0, 5));'
      ].join(String.fromCharCode(10)) }
    ],
    facts: [
      ['Data scope', 'Public, read-only for the example market endpoints'],
      ['Authentication', 'Not required for the public market examples'],
      ['Charts', 'Price history and OHLC use separate endpoints'],
      ['Reliability', 'Cache upstream data and surface failures honestly']
    ],
    faqs: [
      { q: 'Do I need an API key for market data?', a: 'The public read-only examples in this guide do not require a user key. Check /api/openapi.json for the exact access boundary of each route.' },
      { q: 'Does the API guarantee prices or uptime?', a: 'No. Data depends on upstream services and caching, and there is no guaranteed uptime or SLA. Your client should make missing or failed data explicit.' },
      { q: 'Should I fetch a separate chart for each of 30 tokens?', a: 'For a 30-asset table, use /api/markets?per_page=30; the response includes seven-day sparkline data. Unnecessary fan-out consumes shared upstream quota.' }
    ],
    links: [
      { href: '/api/openapi.json', text: 'Machine-readable FBT market API contract' },
      { href: '/fa/developers', text: 'Developer guide in Persian' },
      { href: '/crypto-market-charts-signals', text: 'A 30-asset chart and market dashboard' },
      { href: '/crypto-education', text: 'Crypto concepts for beginners' }
    ]
  },
  {
    slug: 'fa/crypto-market-charts-signals',
    icon: 'pulse',
    topic: 'market',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/signals',
    marketDashboard: true,
    title: 'قیمت ارز دیجیتال و نمودار ۳۰ دارایی | سیگنال بازار | FBT Swap',
    description: 'قیمت و نمودار هفت‌روزهٔ حداکثر ۳۰ دارایی، نبض بازار و خوانش شفاف روند بر پایهٔ تغییر ۲۴ساعته و هفت‌روزه؛ بدون پیش‌بینی یا توصیهٔ خریدوفروش.',
    h1: 'بازار کریپتو؛ قیمت ۳۰ دارایی، نمودار و خوانش روند',
    body: [
      'این صفحه برای بررسی دادهٔ بازار ساخته شده است، نه برای وعده‌دادن دربارهٔ حرکت بعدی قیمت. فهرست زنده از API عمومی FBT می‌آید، بر پایهٔ ترتیب ارزش بازار همان پاسخ مرتب می‌شود و همراه هر دارایی نمودار خطی هفت‌روزه نمایش می‌دهد.',
      'بخش «نبض بازار» خلاصه‌ای از جهت کلی، گستردگی تغییرات و ریسک مشاهده‌شده در دادهٔ بازار است. برچسب هر توکن فقط مقایسهٔ علامت تغییر ۲۴ساعته با هفت‌روزه است؛ اگر دو بازه هم‌جهت نباشند، نتیجه ترکیبی نشان داده می‌شود.',
      'مقادیر ممکن است با منبع و کش API تأخیر داشته باشند. اگر فید در دسترس نباشد، صفحه قیمت یا نمودار ساختگی نمی‌سازد. هیچ‌کدام از این خوانش‌ها سیگنال شخصی، توصیهٔ مالی یا تضمین بازده نیست.'
    ],
    sections: [
      ['۳۰ توکن مهم، اما نه یک فهرست ثابت و همیشگی', [
        'جدول زنده حداکثر ۳۰ دارایی را از پاسخ بازار می‌گیرد. ترتیب فهرست به رتبهٔ ارزش بازار در همان داده وابسته است و با گذر زمان تغییر می‌کند. فهرست نمونهٔ قابل‌خواندن در صفحه فقط نام دارایی‌های شناخته‌شده را برای آشنایی می‌آورد و رتبهٔ زنده نیست.',
        'قیمت مرجع دلاری برای مقایسه است؛ قیمت اجرا روی یک شبکه یا استخر مشخص ممکن است به‌دلیل نقدینگی، کارمزد و اثر قیمت متفاوت باشد. پیش از هر تراکنش، قیمت و حداقل دریافتی همان مسیر را داخل کیف پول و رابط سواپ بررسی کن.'
      ]],
      ['شبکه‌های سواپ پشتیبانی‌شده', [
        'مسیر سواپ فعلی ۱۷ شبکه دارد: BNB Chain، Ethereum، Polygon، Arbitrum، Base، Optimism، Avalanche، Linea، Sonic، Berachain، Unichain، Monad، Mantle، Scroll، zkSync Era، Robinhood Chain و Solana. هر توکن روی همهٔ این شبکه‌ها موجود نیست و نماد یکسان لزوماً به معنی قرارداد یکسان نیست.',
        'سواپ بین دو شبکهٔ متفاوت همیشه یک کار سادهٔ توکن‌به‌توکن نیست. در صفحهٔ سواپ، شبکهٔ ورودی و خروجی، کیف پول، مسیر، گس، اثر قیمت و کارمزد را پیش از امضا بررسی کن.'
      ]],
      ['این سیگنال‌ها دقیقاً چه می‌گویند؟', [
        'خوانش ردیف توکن از دادهٔ موجود تغییر ۲۴ساعته و هفت‌روزه را مقایسه می‌کند: مثبت‌بودن هر دو «هر دو بازه مثبت»، منفی‌بودن هر دو «هر دو بازه منفی» و اختلاف جهت «ترکیبی» است. نبود یکی از مقادیر به‌عنوان دادهٔ ناکافی نمایش داده می‌شود.',
        'این دسته‌بندی تحلیل سادهٔ جهت گذشته است؛ نه پیش‌بینی، نه نقطهٔ ورود یا خروج و نه دستور خرید یا فروش. حتی روند هم‌جهت هم می‌تواند برگردد. نقدشوندگی، نوسان، ریسک قرارداد و احتمال ازدست‌رفتن سرمایه را جداگانه بسنج.'
      ]]
    ],
    facts: [
      ['فهرست زنده', 'حداکثر ۳۰ دارایی بر اساس ترتیب فعلی پاسخ API بازار'],
      ['نمودار', 'سری قیمت هفت‌روزه که همراه پاسخ بازار می‌آید'],
      ['روش خوانش', 'مقایسهٔ تغییر ۲۴ساعته و هفت‌روزه؛ بدون توصیهٔ خریدوفروش'],
      ['شبکه‌های سواپ', '۱۷ شبکه؛ موجودبودن مسیر برای هر توکن باید جدا بررسی شود']
    ],
    faqs: [
      { q: 'آیا رتبهٔ ۳۰ دارایی همیشه ثابت است؟', a: 'نه. جدول از پاسخ فعلی API بازار مرتب می‌شود و ترتیب بازار تغییر می‌کند. فهرست نام‌های ثابت پایین جدول نمونهٔ آموزشی است، نه رتبه‌بندی لحظه‌ای.' },
      { q: 'سیگنال سبز یعنی الان بخرم؟', a: 'نه. برچسب فقط هم‌جهتی تغییرهای تاریخی ۲۴ساعته و هفت‌روزه را نشان می‌دهد. پیشنهاد معامله، پیش‌بینی قیمت یا توصیهٔ شخصی نیست.' },
      { q: 'چرا قیمت این صفحه با قیمت سواپ فرق دارد؟', a: 'قیمت بازار مقدار مرجع است. نرخ اجرا به استخر و مسیر همان شبکه، نقدینگی، کارمزد و اثر قیمت بستگی دارد؛ نرخ نهایی را پیش از امضای تراکنش بررسی کن.' }
    ],
    links: [
      { href: '/fa/crypto-market-history-analysis', text: 'راهنمای خواندن تحلیل و نمودار' },
      { href: '/fa/crypto-swap-without-kyc', text: 'راهنمای سواپ و بررسی نرخ پیش از امضا' },
      { href: '/fa/crypto-education', text: 'آموزش پایهٔ کریپتو و کیف پول' }
    ]
  },
  {
    slug: 'crypto-market-charts-signals',
    icon: 'pulse',
    topic: 'market',
    lang: 'en',
    route: '/#/signals',
    marketDashboard: true,
    title: 'Crypto Prices, 30 Charts and Market Signals | FBT Swap',
    description: 'Prices and seven-day charts for up to 30 crypto assets, a market pulse and a transparent trend reading based on 24-hour and seven-day changes — not a forecast or trade advice.',
    h1: 'Crypto market data: 30 assets, charts and trend readings',
    body: [
      'This page is for inspecting market data, not promising what prices will do next. The live list comes from the public FBT API, follows the market-cap order returned by that response and shows a seven-day line chart alongside each asset.',
      'The market-pulse panel summarises broad direction, breadth and observed market risk. Each token trend label compares only the signs of its 24-hour and seven-day changes; if the two windows disagree, the reading is mixed.',
      'Values may be delayed by the data source or API cache. If a feed is unavailable, the page does not invent prices or charts. None of these readings is a personalised signal, financial advice or a return guarantee.'
    ],
    sections: [
      ['Thirty notable tokens, not a permanent ranking', [
        'The live table requests up to 30 assets from the market API. The order follows the market-cap ranking in that response and changes over time. A separate readable example list names familiar assets for orientation; it is not a live rank.',
        'A dollar reference price is useful for comparison, but an execution quote on a particular chain or pool can differ because of liquidity, fees and price impact. Before a transaction, review the route and minimum received in the swap interface.'
      ]],
      ['Supported swap networks', [
        'The current swap routes cover 17 networks: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Berachain, Unichain, Monad, Mantle, Scroll, zkSync Era, Robinhood Chain and Solana. A token is not available on every network, and a shared ticker does not prove two contracts are the same asset.',
        'Moving value between different networks is not always a simple token-for-token swap. In the swap interface, check the source and destination network, wallet, route, gas, price impact and fee before signing.'
      ]],
      ['What the trend reading actually says', [
        'The row label compares the available 24-hour and seven-day percentage changes: both positive is “positive on both windows,” both negative is “negative on both windows,” and different directions are “mixed.” If either reading is missing, the page says there is insufficient data.',
        'This is a simple description of past direction, not a forecast, entry or exit point, or instruction to buy or sell. Even aligned trends can reverse. Evaluate liquidity, volatility, contract risk and the possibility of losing capital separately.'
      ]]
    ],
    facts: [
      ['Live list', 'Up to 30 assets in the current market API response order'],
      ['Chart', 'Seven-day price series returned with the market response'],
      ['Trend method', '24-hour versus seven-day change; no trade recommendation'],
      ['Swap networks', '17 supported; route availability is token-specific']
    ],
    faqs: [
      { q: 'Is the ranking of the 30 assets fixed?', a: 'No. The table follows the current market API response, and market rankings change. The separate static list is an educational reference, not a live ranking.' },
      { q: 'Does a positive signal mean I should buy?', a: 'No. The label only compares historical 24-hour and seven-day changes. It is not a trade recommendation, price forecast or personalised advice.' },
      { q: 'Why can this reference price differ from a swap quote?', a: 'A market price is a reference. Execution depends on the selected network and pool, the route, liquidity, fees and price impact; review the live quote before signing.' }
    ],
    links: [
      { href: '/crypto-market-history-analysis', text: 'A guide to reading chart history' },
      { href: '/crypto-swap-without-kyc', text: 'Reviewing a swap quote before signing' },
      { href: '/crypto-education', text: 'Crypto fundamentals and wallet safety' }
    ]
  },
  {
    slug: 'fa/tokenized-global-stocks',
    icon: 'globe',
    topic: 'invest',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/stocks',
    title: 'سهام جهانی توکنی‌شده | دادهٔ بازار و ریسک‌ها | FBT Swap',
    description: 'دادهٔ بازارِ برخی سهام توکنی‌شده را بررسی کن؛ تفاوت توکن با مالکیت مستقیم سهم، ریسک صادرکننده، نقدشوندگی و محدودیت دسترسی را بشناس.',
    h1: 'سهام جهانی توکنی‌شده؛ نمایش قیمت با مالکیت مستقیم یکی نیست',
    body: [
      'عبارت «سهام جهانی» در دنیای کریپتو گاهی به توکنی اشاره می‌کند که قیمت یا ادعایی به یک دارایی بورسی مرتبط دارد. ساختار حقوقی، صادرکننده و حق بازخرید هر توکن می‌تواند متفاوت باشد؛ بنابراین نباید صرفاً از روی نام یا نمودار فرض کرد همان سهمی است که در کارگزاری خریده می‌شود.',
      'FBT برخی دارایی‌های سهام توکنی‌شده را در دادهٔ بازارِ سولانا دنبال می‌کند. این قابلیت به معنی کارگزاری سهام، مالکیت مستقیم سهم، یا امکان معامله برای همهٔ کاربران نیست؛ دسترسی معاملاتی به محل ارائه‌دهنده، دارایی و منطقه وابسته است و عرضهٔ مستقیم هنوز در حال گسترش است.',
      'پیش از هر تصمیم، مستندات صادرکننده و شبکه، دارایی پایه، نقدشوندگی، حق بازخرید، ساعت بازار، هزینه، ریسک طرف مقابل و وضعیت قانونی در محل زندگی‌ات را بررسی کن. قیمت نمایشی به‌تنهایی نه مالکیت را ثابت می‌کند و نه بازده را تضمین.'
    ],
    sections: [
      ['سهام توکنی‌شده چه چیزی را نشان می‌دهد؟', [
        'یک توکن ممکن است نمایندهٔ ادعای قراردادی، محصول مشتقه یا سازوکار دیگری باشد؛ تعریف دقیق را فقط مستندات رسمی صادرکننده روشن می‌کند. قوانین، امکان انتقال و حق دریافت دارایی پایه بین محصولات یکسان نیست.',
        'در FBT، بخشی از این دارایی‌ها برای ردیابی قیمت و اطلاعات بازار فهرست می‌شوند. پیش از فرض مالکیت یا امکان بازخرید، قرارداد توکن و شرایط صادرکننده را مستقل بررسی کن.'
      ]],
      ['محدودیت دسترسی و معامله', [
        'دیدن نماد یا قیمت به معنی آن نیست که همان سهم جهانی را در این برنامه می‌توان خریدوفروش کرد. ارائه‌دهندهٔ توکن، نقدینگی بازار، شبکه، کیف پول و محدودیت‌های منطقه‌ای روی دسترسی اثر دارند. صفحهٔ سهام داخل برنامه، وضعیت هر دارایی را در همان زمان نشان می‌دهد.',
        'اگر بازار بسته باشد، نقدینگی کم باشد یا سرویس داده قطع شود، ممکن است قیمت مرجع یا امکان معامله در دسترس نباشد. هیچ قیمت یا بازدهی ثابت وعده داده نمی‌شود.'
      ]],
      ['چه چیزهایی را پیش از استفاده بررسی کنی؟', [
        'نام صادرکننده و قرارداد رسمی؛ دارایی پایه و روش نگهداری یا وثیقه؛ امکان و شرایط بازخرید؛ حجم و عمق بازار؛ هزینه‌های شبکه و پلتفرم؛ ساعت بازار و اختلاف قیمت؛ صلاحیت منطقه‌ای و مالیاتی؛ و این‌که چه کسی می‌تواند قرارداد را متوقف یا توکن را فریز کند.',
        'دارایی توکنی‌شده ممکن است علاوه بر نوسان سهم پایه، ریسک قرارداد و صادرکننده هم داشته باشد. ارزش آن می‌تواند کاهش یابد و سرمایهٔ واردشده ممکن است بخشی یا تماماً از دست برود.'
      ]],
      ['سهام جهانی با «سود دلاری» فرق دارد', [
        'افزایش قیمت سهم تضمین نمی‌شود و پرداخت سود سهام به ساختار توکن و ناشر آن وابسته است. قیمت‌گذاری به دلار یا اتصال به یک سهم، سود دلاری ثابت ایجاد نمی‌کند.',
        'همین قاعده برای بازده دیفای هم برقرار است: نرخ نمایش‌داده‌شده متغیر است و ریسک قرارداد، نقدشوندگی و استیبل‌کوین را حذف نمی‌کند.'
      ]]
    ],
    facts: [
      ['وضعیت FBT', 'ردیابی دادهٔ بازار برخی سهام توکنی‌شده؛ نه کارگزاری سهام سنتی'],
      ['مالکیت', 'باید از مستندات صادرکننده و شرایط همان توکن فهمیده شود'],
      ['دسترسی', 'به ارائه‌دهنده، نقدشوندگی، شبکه و منطقه وابسته است'],
      ['بازده', 'قیمت دلاری یا توکنی، سود تضمینی نیست']
    ],
    faqs: [
      { q: 'آیا با دیدن سهام توکنی‌شده مالک مستقیم سهم می‌شوم؟', a: 'نه لزوماً. حق مالکیت، بازخرید و مطالبه به ساختار صادرکننده و شرایط توکن بستگی دارد؛ مستندات رسمی آن محصول را بخوان.' },
      { q: 'آیا FBT Swap کارگزاری سهام جهانی است؟', a: 'خیر. FBT برخی داده‌های دارایی سهام توکنی‌شده را دنبال می‌کند؛ این صفحه وعدهٔ کارگزاری، مالکیت مستقیم سهم یا دسترسی معاملاتی در هر منطقه نمی‌دهد.' },
      { q: 'آیا سهام توکنی‌شده یا قیمت دلاری سود ثابت می‌دهد؟', a: 'خیر. قیمت می‌تواند کاهش یابد و پرداخت، نقدشوندگی، صادرکننده، قرارداد و مقررات ریسک دارند. سود یا بازده تضمین‌شده‌ای وعده داده نمی‌شود.' }
    ],
    links: [
      { href: '/tokenized-global-stocks', text: 'راهنمای سهام توکنی‌شده به انگلیسی' },
      { href: '/fa/crypto-investing-yield-and-lending', text: 'بازده دیفای و ریسک سرمایه‌گذاری' },
      { href: '/fa/crypto-market-charts-signals', text: 'قیمت ارز دیجیتال، نمودار و روند بازار' }
    ]
  },
  {
    slug: 'tokenized-global-stocks',
    icon: 'globe',
    topic: 'invest',
    lang: 'en',
    route: '/#/stocks',
    title: 'Tokenised Global Stocks: Market Data, Access and Risks | FBT Swap',
    description: 'Explore market data for selected tokenised equities and learn how a token differs from direct share ownership, including issuer, liquidity and access risks.',
    h1: 'Tokenised global stocks: a displayed price is not direct ownership',
    body: [
      'In crypto, “global stocks” can refer to a token linked to an equity-market asset or price. The legal structure, issuer and redemption rights vary by token; a ticker or chart alone does not prove that it is the same share held through a brokerage.',
      'FBT tracks market data for selected tokenised-equity assets on Solana. This is not a stock brokerage, direct share ownership or a promise that every visitor can trade. Availability depends on the issuer, asset and region, and direct trading access is still being rolled out carefully.',
      'Before deciding, check the issuer and network documentation, underlying asset, liquidity, redemption terms, market hours, fees, counterparty risk and local eligibility. A displayed price alone proves neither ownership nor a guaranteed return.'
    ],
    sections: [
      ['What does a tokenised equity represent?', [
        'A token can represent a contractual claim, a derivative or another structure; the issuer’s official documentation defines which one. Legal rights, transferability and redemption are not the same across products.',
        'FBT lists some assets for price and market-data tracking. Independently check the token contract and issuer terms before assuming ownership or redemption rights.'
      ]],
      ['Trading access and regional limits', [
        'Seeing a symbol or price does not mean that the corresponding global share can be bought or sold in this app. Issuer availability, secondary-market liquidity, network, wallet and regional restrictions can all affect access. The in-app Stocks page shows the status available for an asset at that time.',
        'When a market is closed, liquidity is thin or a data service is unavailable, a reference price or trade may not be available. No fixed price or return is promised.'
      ]],
      ['What to check before interacting', [
        'Verify the issuer and official contract; the underlying asset and backing; redemption terms; market depth and trading volume; network and platform fees; market hours and price differences; regional and tax eligibility; and who can pause the contract or freeze a token.',
        'A tokenised asset may carry issuer and contract risks in addition to the underlying share’s price risk. Its value can fall, and some or all of the amount committed can be lost.'
      ]],
      ['Global stocks are not “dollar yield”', [
        'A share-price increase is not guaranteed, and any dividend depends on the token’s issuer and structure. A dollar quote or a link to an equity does not create fixed dollar income.',
        'The same applies to DeFi yield: displayed rates vary, and contract, liquidity and stablecoin risks remain.'
      ]]
    ],
    facts: [
      ['What FBT offers', 'Market-data tracking for selected tokenised equities, not a traditional brokerage'],
      ['Ownership', 'Defined by the issuer documentation and the token’s terms'],
      ['Availability', 'Depends on issuer, liquidity, network and region'],
      ['Returns', 'A dollar or token price does not promise a return']
    ],
    faqs: [
      { q: 'Does seeing a tokenised stock make me the direct shareholder?', a: 'Not necessarily. Ownership, redemption and claim rights depend on the issuer and the token’s terms; read the product’s official documentation.' },
      { q: 'Is FBT Swap a global stock brokerage?', a: 'No. FBT tracks market data for selected tokenised-equity assets. This page does not promise brokerage services, direct share ownership or trading access in every region.' },
      { q: 'Do tokenised stocks or dollar quotes provide fixed income?', a: 'No. Prices can fall, and issuer, liquidity, contract and regulatory risks remain. No fixed or guaranteed return is promised.' }
    ],
    links: [
      { href: '/fa/tokenized-global-stocks', text: 'سهام جهانی توکنی‌شده: راهنمای فارسی' },
      { href: '/crypto-investing-yield-and-lending', text: 'DeFi yield and investing risks' },
      { href: '/crypto-market-charts-signals', text: 'Crypto prices, charts and market readings' }
    ]
  }
];

/*
 * ─── THE LIBRARY: ONE REFERENCE PAGE FOR EVERY SEO PAGE ─────────────────────
 * The owner's ask, in his words: every page should live somewhere a person
 * can find it, «در جایی مرجع باشد که کاربر خواست برود پیدایش کند» — including
 * the Persian pages. The library is that reference: a bilingual pair of
 * directory pages that list EVERY published landing, grouped by topic, with
 * the flagship landing pinned on top. It is rendered from the same PAGES
 * array as the sitemap, so a page cannot exist without being listed here.
 *
 * The Persian library lives at `/fa/` on purpose: it doubles as the landing
 * of the whole Persian section, and every Persian page now sits one level
 * below it (`/fa/crypto-swap-without-kyc`, …) — English-looking, indexable
 * URLs under the .ir domain, exactly as requested.
 */
const LIBRARY_PAGES = [
  {
    kind: 'library',
    slug: 'library',
    lang: 'en',
    icon: 'grid',
    topic: 'learn',
    route: '/#/swap',
    title: 'FBT Swap Library — Every Crypto Guide, Tool and Market Page in One Place',
    description:
      'The complete directory of FBT Swap pages: non-custodial swap without KYC, price alerts, investing and yield, market charts, developer API, long guides and the blog — in English and Persian.',
    h1: 'The FBT Swap library — every page, one place',
    body: [
      'Every page FBT Swap publishes for search is listed here, grouped by topic and marked by language. The English pages sit directly under the domain; the Persian pages live under /fa/ with the same English address, so both are easy to read, easy to index and easy to share.',
      'Start with the flagship landing for the full product tour, or open any card below. Each page states its own limits next to its features — the same honesty rule applies to every link in this directory.'
    ],
    facts: [
      ['Topics', 'Swap & custody, markets & charts, investing & yield, learning & guides'],
      ['Languages', 'English and Persian (فارسی), each page written for its own reader'],
      ['URLs', 'English addresses under the .ir domain — Persian pages live under /fa/'],
      ['Promises', 'None. No guaranteed return, no fabricated ranking, no hidden fee']
    ]
  },
  {
    kind: 'library',
    slug: 'fa/',
    lang: 'fa',
    dir: 'rtl',
    icon: 'grid',
    topic: 'learn',
    route: '/#/swap',
    title: 'کتابخانهٔ اف‌بی‌تی سواپ — همهٔ صفحات، راهنماها و بازار در یک‌جا',
    description:
      'فهرست کامل صفحات اف‌بی‌تی سواپ: سواپ بدون احراز هویت، هشدار قیمت، سرمایه‌گذاری و بازده، نمودار بازار، API توسعه‌دهندگان، راهنماهای بلند و وبلاگ — به فارسی و انگلیسی.',
    h1: 'کتابخانهٔ اف‌بی‌تی سواپ؛ هر صفحه در یک‌جا',
    body: [
      'هر صفحه‌ای که اف‌بی‌تی سواپ برای جست‌وجو منتشر کرده این‌جا فهرست شده است: به تفکیک موضوع و با برچسب زبان. صفحه‌های انگلیسی مستقیم زیر دامنه نشسته‌اند و صفحه‌های فارسی زیر /fa/ با همان نشانی انگلیسی — تا هم برای خواننده راحت باشد و هم برای ایندکس‌شدن.',
      'از لندینگ اصلی برای دیدن تور کامل محصول شروع کن، یا هر کارت را که خواستی باز کن. هر صفحه محدودیت‌هایش را کنار قابلیت‌هایش می‌نویسد؛ همین قاعدهٔ صداقت برای همهٔ لینک‌های این فهرست برقرار است.'
    ],
    facts: [
      ['موضوع‌ها', 'سواپ و نگهداری، بازار و نمودار، سرمایه‌گذاری و بازده، آموزش و راهنماها'],
      ['زبان‌ها', 'فارسی و انگلیسی؛ هر صفحه برای خوانندهٔ خودش نوشته شده'],
      ['نشانی‌ها', 'آدرس انگلیسی زیر دامنهٔ ir. — صفحات فارسی زیر /fa/'],
      ['وعده‌ها', 'ندارد. نه سود تضمینی، نه رتبهٔ ساختگی، نه کارمزد پنهان']
    ]
  }
];

/*
 * Search landings, posts and hubs join PAGES so the sitemap, reciprocal
 * hreflang pairs, sibling links and IndexNow sync check share one source.
 */
SEARCH_LANDINGS.forEach((page) => { page.kind = 'resource'; });
PAGES.push(...SEARCH_LANDINGS, ...POSTS, ...BLOG_HUBS, ...LIBRARY_PAGES);

const ALTERNATES = [
  /*
   * The old ['non-custodial-crypto-swap', 'decentralized-crypto-exchange'] pair was
   * removed on purpose: the slug now hosts a bilingual English-default
   * super-landing (scripts/landing-v2/) that is NOT a translation of the
   * non-custodial guide. It declares its own en/fa/x-default hreflang
   * instead. Pairing the guide with it would be the incorrect-annotation
   * case the comment above warns about.
   */
  ['crypto-price-alerts-and-dca', 'fa/crypto-price-alerts-and-dca'],
  ['crypto-market-history-analysis', 'fa/crypto-market-history-analysis'],
  /*
   * The three pairs added with the swap / crypto / investing pages. Each one
   * is a real translation: the same claims, the same limits, the same fee
   * sentence, written for the reader of that language rather than copied
   * across. That is the test for whether a page belongs in this list — if the
   * Persian page says something the English page does not, the pair is a bug.
   */
  ['crypto-swap-without-kyc', 'fa/crypto-swap-without-kyc'],
  ['crypto-investing-yield-and-lending', 'fa/crypto-investing-yield-and-lending'],
  ['solana-token-swap', 'fa/solana-token-swap'],
  /*
   * The three guides. Same rule as above: each pair is the same argument in
   * two languages, not a summary of the other one.
   */
  ['how-crypto-swap-fees-work', 'fa/how-crypto-swap-fees-work'],
  ['custodial-vs-non-custodial-wallets', 'fa/custodial-vs-non-custodial-wallets'],
  ['what-stays-private-without-kyc', 'fa/what-stays-private-without-kyc'],
  /* Matched, language-specific learning, data and tokenised-equity pages. */
  ['crypto-education', 'fa/crypto-education'],
  ['developers', 'fa/developers'],
  ['crypto-market-charts-signals', 'fa/crypto-market-charts-signals'],
  ['tokenized-global-stocks', 'fa/tokenized-global-stocks'],
  /* Each hub lists the corresponding guides in its own language. */
  ['blog', 'fa/blog'],
  /* The two directories mirror each other exactly — same pages, same order,
     labels translated. */
  ['library', 'fa/']
];

const SOCIAL_CARD = `${SITE}/social-card.png`;
const SOCIAL_CARD_ALT = 'FBT Swap — Non-custodial crypto swap';

/** Escape anything that goes into HTML text or an attribute. */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Escape a JSON-LD payload so a content edit can never close its script tag. */
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function copyFor(lang) {
  return lang === 'fa'
    ? {
        home: 'صفحهٔ اصلی',
        breadcrumb: 'مسیر صفحه',
        faq: 'پرسش‌های رایج',
        eyebrow: 'شفاف، غیرامانی، در کنترل تو',
        story: 'چیزی که باید بدانی',
        details: 'دیدن جزئیات',
        highlights: 'در یک نگاه',
        risk: 'هشدار ریسک',
        related: 'راهنماهای بیشتر',
        faqHint: 'پاسخ‌های کوتاه و روشن، پیش از اینکه تصمیم بگیری.',
        byline: 'نوشتهٔ FBT Swap',
        readNext: 'ادامهٔ مطالعه',
        guides: 'راهنماها',
        minRead: 'دقیقه مطالعه',
        /* Library (مرجع صفحات) — the reference directory every page links to. */
        library: 'کتابخانهٔ صفحات',
        allPages: 'همهٔ صفحات',
        libraryKicker: 'فهرست مرجع',
        flagship: 'صفحهٔ اصلی محصول',
        flagshipHint: 'تور کامل اف‌بی‌تی سواپ؛ سواپ، کیف پول، بازار، سهام و سولانا',
        langVersion: 'English version',
        langAria: 'نسخهٔ انگلیسی همین صفحه',
        /* The two defaults that used to be hardcoded English strings in
           render(): a Persian page that forgot its own riskText shipped an
           English risk paragraph. A default is only safe when it is in the
           reader's language. */
        ctaDefault: 'باز کردن برنامه',
        riskText:
          'دارایی‌های کریپتو پرنوسان‌اند و تراکنش روی زنجیره برگشت‌ناپذیر است؛ ممکن است همهٔ پولت را از دست بدهی. هیچ‌چیز این‌جا توصیهٔ مالی نیست.'
      }
    : {
        home: 'Home',
        breadcrumb: 'Breadcrumb',
        faq: 'Frequently asked questions',
        eyebrow: 'Transparent, non-custodial, yours',
        story: 'What you should know',
        details: 'See the details',
        highlights: 'At a glance',
        risk: 'Risk notice',
        related: 'Explore more guides',
        faqHint: 'Clear answers before you decide.',
        byline: 'By FBT Swap',
        readNext: 'Read next',
        guides: 'Guides',
        minRead: 'min read',
        /* Library (the page directory) — the reference every page links to. */
        library: 'Page library',
        allPages: 'All pages',
        libraryKicker: 'Reference directory',
        flagship: 'The flagship landing',
        flagshipHint: 'The full FBT Swap tour: swap, wallet, markets, stocks and Solana',
        langVersion: 'نسخهٔ فارسی',
        langAria: 'Persian version of this page',
        ctaDefault: 'Open the app',
        riskText:
          'Crypto assets are volatile and on-chain transactions cannot be reversed. You can lose money, including all of it. Nothing here is financial advice.'
      };
}

/**
 * The FAQ JSON-LD mirrors visible `<details>` content below. That matters:
 * structured data is useful only when a visitor can read the same answer; a
 * hidden keyword block would be spam, not documentation.
 */
function landingStructuredData(page, url) {
  const ui = copyFor(page.lang);
  const pageId = `${url}#webpage`;
  const faqId = `${url}#faq`;
  const organizationId = `${SITE}/#organization`;
  const websiteId = `${SITE}/#website`;
  const graph = [
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: 'FBT Swap',
      alternateName: ['FBTSwap', 'اف‌بی‌تی سواپ', 'اف بی تی سواپ'],
      legalName: 'Fanous Bazaar Pishgam Co.',
      url: `${SITE}/`,
      email: 'fbtswap@gmail.com',
      /* The one public identity this project actually controls. `sameAs` is how
         an answer engine links a brand mention back to the entity it means,
         and it only works if the account is real — so it is the account that
         exists, and nothing else. */
      sameAs: ['https://x.com/CompanyFbt'],
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png`, width: 512, height: 512 }
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: `${SITE}/`,
      name: 'FBT Swap',
      alternateName: ['FBTSwap', 'FBT Swap', 'اف‌بی‌تی سواپ', 'اف بی تی سواپ'],
      inLanguage: ['fa', 'en'],
      publisher: { '@id': organizationId }
    },
    {
      '@type': 'WebPage',
      '@id': pageId,
      url,
      name: page.title,
      description: page.description,
      inLanguage: page.lang === 'fa' ? 'fa-IR' : 'en',
      isPartOf: { '@id': websiteId },
      publisher: { '@id': organizationId },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: SOCIAL_CARD,
        width: 1024,
        height: 500,
        caption: SOCIAL_CARD_ALT
      },
      ...(page.faqs?.length ? { mainEntity: { '@id': faqId } } : {})
    },
    {
      /* Three crumbs now, matching the visible breadcrumb: Home / Library /
         page. The library is the reference directory every page hangs off. */
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: ui.home, item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: ui.library, item: `${SITE}/${slugPath(page.lang === 'fa' ? 'fa/' : 'library')}` },
        { '@type': 'ListItem', position: 3, name: page.h1, item: url }
      ]
    }
  ];

  /*
   * The library additionally exposes its whole directory as an ItemList, so
   * the single page that lists everything also hands crawlers every URL in
   * one structured block. Built from PAGES itself — never a second list that
   * could drift.
   */
  if (page.kind === 'library') {
    const items = PAGES.filter((p) => p.kind !== 'library');
    graph.push({
      '@type': 'ItemList',
      '@id': `${url}#directory`,
      name: page.h1,
      numberOfItems: items.length + 1,
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'FBT Swap — decentralized crypto exchange',
          url: `${SITE}/${slugPath(V2_PAGE.slug)}`
        },
        ...items.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 2,
          name: p.h1,
          url: `${SITE}/${slugPath(p.slug)}`
        }))
      ]
    });
  }

  /*
   * A guide is a BlogPosting, and it says so — with a real date, a named
   * publisher and the collection it belongs to. The author is the company,
   * not an invented byline: this project has no individual writer to credit,
   * and a fake one is a lie a reviewer can catch in one click.
   */
  if (page.kind === 'post') {
    const hubSlug = page.lang === 'fa' ? 'fa/blog' : 'blog';
    graph.push({
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      headline: page.h1,
      description: page.description,
      inLanguage: page.lang === 'fa' ? 'fa-IR' : 'en',
      datePublished: page.datePublished,
      dateModified: page.dateModified || page.datePublished,
      author: { '@id': organizationId },
      publisher: { '@id': organizationId },
      isPartOf: { '@id': `${SITE}/${slugPath(hubSlug)}#blog` },
      mainEntityOfPage: { '@id': pageId },
      articleSection: 'Guides',
      image: { '@type': 'ImageObject', url: SOCIAL_CARD, width: 1024, height: 500 }
    });
  }

  /*
   * The hub declares the collection. `blogPost` lists only guides that are
   * actually published by this generator, so the markup can never advertise
   * an article that 404s.
   */
  if (page.kind === 'hub') {
    graph.push({
      '@type': 'Blog',
      '@id': `${url}#blog`,
      name: page.h1,
      description: page.description,
      inLanguage: page.lang === 'fa' ? 'fa-IR' : 'en',
      publisher: { '@id': organizationId },
      blogPost: POSTS.filter((p) => (p.lang || 'en') === (page.lang || 'en')).map((p) => ({
        '@type': 'BlogPosting',
        headline: p.h1,
        description: p.description,
        url: `${SITE}/${slugPath(p.slug)}`,
        datePublished: p.datePublished
      }))
    });
  }

  if (page.faqs?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': faqId,
      mainEntity: page.faqs.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a }
      }))
    });
  }

  /*
   * ─── HOWTO, FOR THE READER THAT NEVER CLICKS ───────────────────────────────
   * Google retired the HowTo *rich result* in 2023, so this is not here for a
   * blue link with a picture of a wrench. It is here because the way people
   * arrive now is a question typed into an assistant — «چطور ارز دیجیتال سواپ
   * کنم؟» — and an ordered list of steps that a crawler can extract without
   * executing JavaScript is what makes a page quotable in that answer.
   *
   * Two rules keep it honest, and both are structural rather than editorial:
   * the steps are RENDERED ON THE PAGE as a visible ordered list (see
   * render()), so nothing is marked up that a human cannot read; and the text
   * is the same string in both places, so the two can never drift apart.
   */
  if (page.howTo?.length) {
    graph.push({
      '@type': 'HowTo',
      '@id': `${url}#howto`,
      name: page.h1,
      description: page.description,
      inLanguage: page.lang === 'fa' ? 'fa-IR' : 'en',
      totalTime: 'PT3M',
      step: page.howTo.map(([name, text], i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name,
        text,
        url: `${url}#step-${i + 1}`
      }))
    });
  }

  return jsonForScript({ '@context': 'https://schema.org', '@graph': graph });
}

function render(page) {
  /*
   * Every URL under .ir is now an ENGLISH path — the owner's requirement for
   * better indexing («بعد از .ir باید انگلیسی باشد»). The Persian pages moved
   * from Arabic-script slugs to `/fa/<english-slug>`; slugPath() encodes each
   * segment on its own so the `/` survives while anything non-ASCII would
   * still be percent-encoded (a sitemap with raw non-ASCII is invalid per the
   * spec and rejected whole, taking every URL down with it).
   */
  const url = `${SITE}/${slugPath(page.slug)}`;
  const appUrl = `${SITE}${page.route}`;
  const lang = page.lang || 'en';
  const dir = page.dir || 'ltr';
  const isLibrary = page.kind === 'library';
  /* The language-mate of this page, when one exists: shown as a pill in the
     top bar and in the footer, so a reader can always cross over. */
  const langMate = (() => {
    const group = ALTERNATES.find((g) => g.includes(page.slug) && g.length > 1);
    if (!group) return null;
    const other = group.find((slug) => slug !== page.slug);
    if (!other) return null;
    const mate = PAGES.find((x) => x.slug === other);
    return mate ? { url: `${SITE}/${slugPath(mate.slug)}`, lang: mate.lang || 'en' } : null;
  })();

  /*
   * hreflang, and specifically the RECIPROCAL pair.
   *
   * Google ignores an hreflang annotation unless each page in the set points
   * at every other one INCLUDING itself. A one-way link is silently dropped,
   * which is the usual reason people conclude "hreflang does not work".
   *
   * Only same-topic pages are paired. The Persian swap, alert and analysis
   * pages each have an English counterpart. The wallet page is intentionally
   * Persian-only because it has no equivalent English long-form page yet —
   * claiming an alternate that does not exist is worse than claiming none.
   */
  const altGroup = ALTERNATES.find((g) => g.includes(page.slug));
  const hreflang = altGroup
    ? (() => {
        const pages = altGroup.map((slug) => PAGES.find((x) => x.slug === slug));
        const defaultPage = pages.find((p) => p.lang === 'en') ?? pages[0];
        return [
          ...pages.map(
            (other) =>
              `<link rel="alternate" hreflang="${other.lang || 'en'}" href="${esc(
                `${SITE}/${slugPath(other.slug)}`
              )}">`
          ),
          `<link rel="alternate" hreflang="x-default" href="${esc(
            `${SITE}/${slugPath(defaultPage.slug)}`
          )}">`
        ].join('\n');
      })()
    : '';
  const ui = copyFor(lang);
  /*
   * Guides (kind: 'post') and the two blog hubs reuse this whole template —
   * the breadcrumb, the risk panel, the sibling links, the canonical and the
   * hreflang set are identical on purpose. What changes is the body: a guide
   * is built out of <h2> sections rather than one wall of prose, because the
   * outline is what an answer engine extracts and what a reader skims.
   */
  const isPost = page.kind === 'post';
  const postDate = page.datePublished
    ? new Date(page.datePublished).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '';
  const postMeta = isPost
    ? `<p class="post-meta">${esc(ui.byline)} \u00b7 <time datetime="${esc(page.datePublished)}">${esc(postDate)}</time></p>`
    : '';
  const postSections = page.sections?.length
    ? `<section class="story-card panel reveal post-body" style="--delay:170ms">
      ${page.sections
        .map(
          ([heading, paragraphs]) => `<div class="post-block">
        <h2>${esc(heading)}</h2>
        ${paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('\n        ')}
      </div>`
        )
        .join('\n      ')}
    </section>`
    : '';
  /*
   * The blog/resource index is rendered from the same page objects as the
   * sitemap. Every post and topic guide is discoverable from its language hub,
   * so adding a crawlable page cannot silently create an orphan URL.
   */
  const hubGuides = [
    ...POSTS.filter((p) => (p.lang || 'en') === lang),
    ...PAGES.filter((p) => p.kind === 'resource' && (p.lang || 'en') === lang)
  ];
  /** True for the two directory pages themselves — they never list themselves. */
  const isLibraryOf = (p) => p.kind === 'library';
  const hubIndex =
    page.kind === 'hub'
      ? `<section class="story-card panel reveal" style="--delay:170ms">
      <div class="post-index">
        ${hubGuides
          .map((p, i) => {
            const meta = p.datePublished
              ? new Date(p.datePublished).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })
              : lang === 'fa' ? 'راهنمای موضوعی' : 'Topic guide';
            return `<a class="post-index-item" href="/${slugPath(p.slug)}">
          ${iconChip(p.icon || 'book', `icon-md ${FX_CYCLE[i % FX_CYCLE.length]}`)}
          <span class="post-index-body">
            <span class="post-index-date">${esc(meta)}</span>
            <h3>${esc(p.h1)}</h3>
            <p>${esc(p.description)}</p>
          </span>
          <span class="card-arrow" aria-hidden="true">${iconSvg('arrow')}</span>
        </a>`;
          })
          .join('\n        ')}
      </div>
    </section>`
      : '';
  /*
   * THE LIBRARY DIRECTORY. Rendered from PAGES itself — grouped by topic,
   * every card carrying its page icon, a language badge and the description.
   * The flagship landing gets its own banner card on top, because it is the
   * one page that shows the whole product rather than one topic.
   */
  const libraryMarkup = isLibrary
    ? `<section class="library-panel panel reveal" aria-labelledby="library-heading" style="--delay:150ms">
    <a class="lib-flagship" href="/${slugPath(V2_PAGE.slug)}">
      ${iconChip('spark', 'icon-lg fx-breathe')}
      <span class="lib-flagship-copy">
        <span class="lib-flagship-kicker">${esc(ui.flagship)}</span>
        <strong>FBT Swap — ${lang === 'fa' ? 'صرافی غیرمتمرکز و هوش مالی' : 'decentralized crypto exchange & financial OS'}</strong>
        <span class="lib-flagship-hint">${esc(ui.flagshipHint)}</span>
      </span>
      <span class="card-arrow" aria-hidden="true">${iconSvg('arrow')}</span>
    </a>
    <div class="lib-groups">
      ${TOPIC_ORDER.map((topicId) => {
        /* Same-language pages first: the Persian directory leads with the
           Persian pages, the English one with the English pages. */
        const all = PAGES.filter((p) => p.topic === topicId && !isLibraryOf(p));
        const members = [
          ...all.filter((p) => (p.lang || 'en') === lang),
          ...all.filter((p) => (p.lang || 'en') !== lang)
        ];
        if (!members.length) return '';
        return `<div class="lib-group">
        <h3 class="lib-group-title">${iconSvg('layers')}<span>${esc(TOPICS[topicId][lang])}</span></h3>
        <div class="lib-grid">
          ${members
            .map((p, i) => `<a class="lib-card" href="/${slugPath(p.slug)}">
            ${iconChip(p.icon || 'spark', `icon-md ${FX_CYCLE[i % FX_CYCLE.length]}`)}
            <span class="lib-card-copy">
              <span class="lib-card-top"><span class="lang-badge ${p.lang === 'fa' ? 'lang-fa' : 'lang-en'}">${p.lang === 'fa' ? 'فارسی' : 'EN'}</span>${p.kind === 'post' ? `<span class="lib-card-date">${esc(p.datePublished || '')}</span>` : ''}</span>
              <h4>${esc(p.h1)}</h4>
              <p>${esc(p.description)}</p>
            </span>
            <span class="card-arrow" aria-hidden="true">${iconSvg('arrow')}</span>
          </a>`)
            .join('\n          ')}
        </div>
      </div>`;
      }).join('\n      ')}
    </div>
  </section>`
    : '';
  const postLinks = page.links?.length
    ? `<section class="related-panel panel reveal" aria-labelledby="next-heading" style="--delay:120ms">
    <div class="section-heading">
      ${iconChip('book', 'icon-md fx-float')}
      <div class="section-heading-copy">
        <p class="section-kicker">${esc(ui.readNext)}</p>
        <h2 id="next-heading">${esc(ui.readNext)}</h2>
      </div>
    </div>
    <div class="related-links">
      ${page.links.map((l) => `<a href="${esc(l.href)}"><span>${esc(l.text)}</span> <span class="card-arrow" aria-hidden="true">${iconSvg('arrow')}</span></a>`).join('\n      ')}
    </div>
  </section>`
    : '';
  const bodyExtra = page.kind === 'hub' ? hubIndex : isLibrary ? libraryMarkup : postSections;
  const codeSamplesMarkup = page.codeSamples?.length
    ? `<section class="code-samples panel reveal" aria-labelledby="code-samples-heading" style="--delay:140ms">
      <div class="section-heading">
        ${iconChip('code', 'icon-md fx-tilt')}
        <div class="section-heading-copy">
          <p class="section-kicker">API</p>
          <h2 id="code-samples-heading">${esc(page.lang === 'fa' ? 'نمونهٔ درخواست' : 'Request examples')}</h2>
        </div>
      </div>
      <div class="code-sample-list">
        ${page.codeSamples.map((sample) => `<figure class="code-sample">
          <figcaption>${esc(sample.label)}</figcaption>
          <pre><code class="language-${esc(sample.language)}">${esc(sample.code)}</code></pre>
        </figure>`).join('\n        ')}
      </div>
    </section>`
    : '';
  const marketDashboardMarkup = page.marketDashboard ? renderMarketDashboard(lang) : '' ;
  const marketDashboardScript = page.marketDashboard ? `<script>${renderMarketDashboardScript(lang)}</script>` : '';
  /*
   * "At a glance" cards. Each one now carries an animated icon chip and a
   * monospace index; the icon is the page's own topic icon for the first
   * card and a deterministic cycle after that, so builds are reproducible.
   */
  const factCards = page.facts
    .map(
      ([label, value], index) => `<article class="fact-card" style="--item:${index}">
        ${iconChip(
          index === 0 ? page.icon || 'spark' : FACT_ICON_CYCLE[(index + 3) % FACT_ICON_CYCLE.length],
          `icon-md ${FX_CYCLE[index % FX_CYCLE.length]}`
        )}
        <span class="fact-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <h3>${esc(label)}</h3>
        <p>${esc(value)}</p>
      </article>`
    )
    .join('\n      ');
  const highlights = page.facts
    .slice(0, 3)
    .map(
      ([label, value], i) => `<div class="highlight">
        <span class="hl-dot" aria-hidden="true"></span>
        <span class="hl-label">${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>`
    )
    .join('\n      ');
  const siblingLinks = PAGES.filter((p) => p.slug !== page.slug && (p.lang || 'en') === lang)
    .map((p) => `<a href="/${slugPath(p.slug)}"><span>${esc(p.h1)}</span> <span class="card-arrow" aria-hidden="true">${iconSvg('arrow')}</span></a>`)
    .join('\n        ');
  const faqMarkup = page.faqs?.length
    ? `<section class="faq-panel panel reveal" aria-labelledby="faq-heading" style="--delay:140ms">
      <div class="section-heading">
        ${iconChip('chat', 'icon-md fx-breathe')}
        <div class="section-heading-copy">
          <p class="section-kicker">FAQ</p>
          <h2 id="faq-heading">${esc(ui.faq)}</h2>
          <p>${esc(ui.faqHint)}</p>
        </div>
      </div>
      <div class="faq-list">
        ${page.faqs
          .map(
            ({ q, a }) => `<details>
          <summary><span>${esc(q)}</span><span class="faq-plus" aria-hidden="true">+</span></summary>
          <p>${esc(a)}</p>
        </details>`
          )
          .join('\n        ')}
      </div>
    </section>`
    : '';
  /*
   * The same steps the HowTo JSON-LD describes, rendered where a person can
   * read them. Keeping one source (page.howTo) for both is the point: markup
   * that describes content the page does not show is exactly what the
   * structured-data guidelines forbid, and it is the failure mode nobody
   * notices until a manual action arrives.
   */
  const howToMarkup = page.howTo?.length
    ? `<section class="howto-panel panel reveal" aria-labelledby="howto-heading" style="--delay:120ms">
    <div class="section-heading">
      ${iconChip('layers', 'icon-md fx-orbit')}
      <div class="section-heading-copy">
        <p class="section-kicker">${esc(page.lang === 'fa' ? 'گام‌به‌گام' : 'Step by step')}</p>
        <h2 id="howto-heading">${esc(page.lang === 'fa' ? 'چطور انجام می‌شود' : 'How it works')}</h2>
      </div>
    </div>
    <ol class="howto-list">
      ${page.howTo
        .map(
          ([name, text], i) => `<li id="step-${i + 1}">
        <span class="howto-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <div><h3>${esc(name)}</h3><p>${esc(text)}</p></div>
      </li>`
        )
        .join('\n      ')}
    </ol>
  </section>`
    : '';

  const structuredData = landingStructuredData(page, url);

  /*
   * The redirect is a <link rel="canonical"> plus a normal link, NOT a
   * meta-refresh or a JS redirect.
   *
   * An instant redirect on a landing page is treated as a doorway page and is
   * penalised. More practically, a bounced visitor who never saw the content
   * learns nothing about what the app does — the page has to be worth reading
   * on its own or it should not exist.
   */
  /*
   * ─── THE 2026 TEMPLATE ─────────────────────────────────────────────────────
   * One shared design system for every SEO page: aurora-glass panels on a
   * deep-space background, a strict spacing scale, animated line icons in
   * fixed-size chips (they can never shift the layout), and a motion budget
   * at the bottom that decides how much of that movement a phone ever paints.
   * The CTA stays a plain anchor — the page is worth reading, not a doorway.
   */
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${esc(dir)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(url)}">
${hreflang}
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#05060d">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

<meta property="og:type" content="website">
<meta property="og:site_name" content="FBT Swap">
<meta property="og:locale" content="${lang === 'fa' ? 'fa_IR' : 'en_US'}">
<meta property="og:locale:alternate" content="${lang === 'fa' ? 'en_US' : 'fa_IR'}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SOCIAL_CARD)}">
<meta property="og:image:secure_url" content="${esc(SOCIAL_CARD)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="500">
<meta property="og:image:alt" content="${esc(SOCIAL_CARD_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@CompanyFbt">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${esc(SOCIAL_CARD)}">
<meta name="twitter:image:alt" content="${esc(SOCIAL_CARD_ALT)}">
<script type="application/ld+json">${structuredData}</script>

${
  dir === 'rtl'
    ? `<link rel="preload" href="/fonts/Vazirmatn-var.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Vazirmatn';src:url('/fonts/Vazirmatn-var.woff2') format('woff2-variations');font-weight:100 900;font-display:swap}</style>`
    : ''
}
<style>
  :root {
    color-scheme: dark;
    --bg: #05060d;
    --ink: #eef2ff;
    --muted: #a9b4d0;
    --quiet: #6f7d9e;
    --line: rgba(168, 186, 236, .14);
    --line-strong: rgba(168, 186, 236, .26);
    --cy: #54e8ff;
    --vi: #9b7bff;
    --pi: #ff6ec7;
    --li: #5ef2b8;
    --am: #ffc35c;
    --grad: linear-gradient(118deg, #54e8ff, #9b7bff 55%, #ff6ec7);
    --panel: linear-gradient(150deg, rgba(21, 27, 51, .82), rgba(9, 12, 25, .68));
    --panel-solid: linear-gradient(150deg, rgba(19, 24, 45, .97), rgba(9, 12, 25, .95));
    --r-lg: 28px;
    --r-md: 20px;
    --r-sm: 14px;
    --gap: clamp(16px, 2.4vw, 22px);
  }
  * { box-sizing: border-box; }
  html { min-height: 100%; background: var(--bg); scroll-behavior: smooth; }
  body {
    min-height: 100svh;
    margin: 0;
    overflow-x: hidden;
    background:
      radial-gradient(950px 540px at 14% -9%, rgba(88, 68, 200, .22), transparent 62%),
      radial-gradient(820px 520px at 94% 12%, rgba(0, 190, 250, .14), transparent 63%),
      radial-gradient(700px 480px at 55% 115%, rgba(255, 110, 199, .07), transparent 65%),
      var(--bg);
    color: var(--ink);
    font: 16px/${dir === 'rtl' ? '1.95' : '1.75'} ${
      dir === 'rtl' ? "'Vazirmatn', " : ''
    }system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color: inherit; }
  ::selection { background: rgba(84, 232, 255, .28); }

  .skip-link {
    position: fixed;
    z-index: 30;
    inset-block-start: 10px;
    inset-inline-start: 10px;
    transform: translateY(-220%);
    padding: 10px 16px;
    border-radius: 12px;
    color: #051018;
    background: var(--cy);
    font-weight: 800;
    text-decoration: none;
    transition: transform .18s ease;
  }
  .skip-link:focus { transform: translateY(0); }

  /* ── ambient background: static art, cheap motion ─────────────────────── */
  .ambient { position: fixed; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }
  .ambient-grid {
    position: absolute;
    inset: -32%;
    opacity: .38;
    background-image:
      linear-gradient(rgba(116, 130, 186, .10) 1px, transparent 1px),
      linear-gradient(90deg, rgba(116, 130, 186, .10) 1px, transparent 1px);
    background-size: 56px 56px;
    mask-image: radial-gradient(ellipse 66% 46% at 50% 24%, #000, transparent 76%);
    transform: perspective(520px) rotateX(61deg) translateY(-9%);
    animation: grid-drift 26s linear infinite;
  }
  .orb {
    position: absolute;
    width: clamp(280px, 36vw, 580px);
    aspect-ratio: 1;
    border-radius: 50%;
    filter: blur(18px);
    opacity: .32;
    mix-blend-mode: screen;
  }
  .orb-one {
    inset: -16% auto auto -12%;
    background: radial-gradient(circle at 58% 52%, #7b52ff, transparent 66%);
    animation: orb-one 22s ease-in-out infinite alternate;
  }
  .orb-two {
    inset: 14% -13% auto auto;
    background: radial-gradient(circle at 42% 42%, #00d5ff, transparent 64%);
    animation: orb-two 26s ease-in-out infinite alternate;
  }

  /* ── page column: one grid, one spacing scale ─────────────────────────── */
  .landing-page {
    position: relative;
    z-index: 1;
    display: grid;
    gap: var(--gap);
    width: min(100% - 36px, 1080px);
    margin: 0 auto;
    padding: clamp(18px, 3.6vw, 40px) 0 clamp(56px, 8vw, 88px);
  }
  .hero-panel, .panel, .risk-panel, footer {
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: 0 26px 70px rgba(0, 0, 0, .30), inset 0 1px 0 rgba(255, 255, 255, .05);
    backdrop-filter: blur(14px);
  }
  .panel { padding: clamp(24px, 4.4vw, 44px); border-radius: var(--r-lg); }

  /* ── hero ─────────────────────────────────────────────────────────────── */
  .hero-panel {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    padding: clamp(22px, 4.4vw, 46px) clamp(22px, 4.6vw, 50px) clamp(24px, 4.6vw, 48px);
    border-radius: clamp(26px, 4vw, 40px);
  }
  .hero-panel::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: -58% -16% auto auto;
    width: min(660px, 72vw);
    aspect-ratio: 1;
    border: 1px dashed rgba(122, 150, 255, .26);
    border-radius: 50%;
    box-shadow: 0 0 0 52px rgba(133, 104, 255, .045), 0 0 0 104px rgba(84, 232, 255, .026);
    animation: spin-slow 46s linear infinite;
  }
  .hero-panel::after {
    content: '';
    position: absolute;
    z-index: -1;
    inset: 0;
    opacity: .6;
    background: linear-gradient(110deg, transparent 26%, rgba(111, 237, 255, .075) 46%, transparent 62%);
    transform: translateX(-130%);
    animation: sheen 9.5s ease-in-out infinite;
  }
  [dir="rtl"] .hero-panel::after { transform: translateX(130%); }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: clamp(24px, 4vw, 40px);
  }
  .crumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--quiet);
    font-size: 12px;
    letter-spacing: .01em;
  }
  .crumb a { color: var(--muted); text-decoration: none; transition: color .18s ease; }
  .crumb a:hover { color: var(--cy); }
  .crumb-sep { opacity: .5; }
  .crumb span[aria-current] { max-width: min(520px, 62vw); overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
  .lang-pill {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 7px;
    padding: 7px 13px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--muted);
    background: rgba(10, 14, 30, .5);
    font-size: 12px;
    font-weight: 700;
    text-decoration: none;
    transition: border-color .2s ease, color .2s ease, transform .2s ease;
  }
  .lang-pill svg { width: 14px; height: 14px; color: var(--cy); }
  .lang-pill:hover { border-color: rgba(84, 232, 255, .55); color: var(--ink); transform: translateY(-1px); }

  .brand-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 11px;
    color: var(--ink);
    font-size: 14.5px;
    font-weight: 800;
    letter-spacing: .01em;
    text-decoration: none;
  }
  .brand-mark {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 1px solid rgba(119, 241, 255, .34);
    border-radius: 13px;
    background: linear-gradient(145deg, rgba(84, 232, 255, .22), rgba(155, 123, 255, .22));
    box-shadow: 0 10px 26px rgba(23, 200, 255, .16);
    transition: transform .3s cubic-bezier(.16, 1, .3, 1);
  }
  .brand:hover .brand-mark { transform: rotate(-6deg) scale(1.05); }
  .brand-mark img { width: 28px; height: 28px; border-radius: 9px; }
  .pages-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 15px;
    border: 1px solid rgba(155, 123, 255, .34);
    border-radius: 999px;
    color: #cdbdfc;
    background: rgba(155, 123, 255, .09);
    font-size: 12.5px;
    font-weight: 750;
    text-decoration: none;
    transition: border-color .2s ease, background .2s ease, transform .2s ease;
  }
  .pages-pill svg { width: 15px; height: 15px; color: var(--vi); }
  .pages-pill:hover { border-color: rgba(155, 123, 255, .66); background: rgba(155, 123, 255, .16); transform: translateY(-1px); }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: clamp(20px, 4vw, 48px);
    margin-top: clamp(26px, 4.6vw, 50px);
  }
  .hero-copy { min-width: 0; max-width: 780px; }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    margin: 0 0 16px;
    padding: 7px 15px;
    border: 1px solid rgba(84, 232, 255, .26);
    border-radius: 999px;
    background: rgba(84, 232, 255, .065);
    color: #9deeff;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .10em;
    text-transform: uppercase;
  }
  .eyebrow-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--li);
    animation: dot-breathe 3.4s ease-in-out infinite;
  }
  h1, h2, h3, h4, p { margin-top: 0; }
  h1 {
    max-width: 860px;
    margin-bottom: 20px;
    color: #f5f7ff;
    font-size: clamp(31px, 5.6vw, 58px);
    font-weight: 850;
    letter-spacing: -.04em;
    line-height: 1.16;
    text-wrap: balance;
  }
  h1::after {
    content: '';
    display: block;
    width: 92px;
    height: 4px;
    margin-top: 22px;
    border-radius: 2px;
    background: var(--grad);
  }
  .lede {
    max-width: 720px;
    margin-bottom: 0;
    color: #c4cde3;
    font-size: clamp(15.5px, 2vw, 18.5px);
    line-height: ${dir === 'rtl' ? '2' : '1.8'};
    text-wrap: pretty;
  }
  .post-meta { margin: 14px 0 0; color: var(--quiet); font-size: 12.5px; letter-spacing: .01em; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
  .cta, .soft-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 54px;
    border-radius: 16px;
    font-size: 15px;
    font-weight: 800;
    text-decoration: none;
    transition: transform .24s ease, box-shadow .24s ease, border-color .24s ease, color .24s ease;
  }
  .cta {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    gap: 11px;
    padding: 14px 26px;
    color: #061019;
    background: linear-gradient(118deg, #54e8ff, #8f7bff 60%, #c86ef7);
    box-shadow: 0 16px 40px rgba(80, 170, 255, .26), inset 0 1px 0 rgba(255, 255, 255, .4);
  }
  .cta svg { width: 18px; height: 18px; }
  .cta::before {
    position: absolute;
    z-index: -1;
    inset: 0;
    background: linear-gradient(110deg, transparent 24%, rgba(255, 255, 255, .7) 48%, transparent 70%);
    content: '';
    transform: translateX(-135%);
    transition: transform .6s ease;
  }
  [dir="rtl"] .cta::before { transform: translateX(135%); }
  .cta:hover { box-shadow: 0 22px 52px rgba(80, 170, 255, .4); transform: translateY(-2px); }
  .cta:hover::before { transform: translateX(135%); }
  [dir="rtl"] .cta:hover::before { transform: translateX(-135%); }
  .cta-arrow { font-size: 18px; line-height: 1; transition: transform .24s ease; }
  .cta:hover .cta-arrow { transform: translateX(4px); }
  [dir="rtl"] .cta-arrow { transform: scaleX(-1); }
  [dir="rtl"] .cta:hover .cta-arrow { transform: scaleX(-1) translateX(4px); }
  .soft-cta {
    gap: 9px;
    padding: 14px 22px;
    border: 1px solid var(--line-strong);
    color: var(--muted);
    background: rgba(255, 255, 255, .026);
  }
  .soft-cta:hover { border-color: rgba(84, 232, 255, .6); color: var(--ink); transform: translateY(-2px); }

  /* the hero emblem: a floating icon medallion with two slow rings */
  .hero-emblem { position: relative; display: grid; place-items: center; width: clamp(200px, 24vw, 280px); aspect-ratio: 1; }
  .emblem-ring { position: absolute; inset: 0; border: 1px dashed rgba(122, 150, 255, .3); border-radius: 50%; animation: spin-slow 44s linear infinite; }
  .emblem-ring-2 { inset: 13%; border-style: solid; border-color: rgba(84, 232, 255, .17); animation: spin-rev 62s linear infinite; }
  .emblem-glow { position: absolute; inset: 24%; border-radius: 50%; background: radial-gradient(circle, rgba(84, 232, 255, .17), transparent 70%); animation: glow-breathe 7.5s ease-in-out infinite; }
  .sparkle { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: #cfeaff; animation: twinkle 6s ease-in-out infinite; }
  .sparkle-a { inset: 9% 22% auto auto; }
  .sparkle-b { inset: auto 12% 16% auto; animation-delay: 2s; }
  .sparkle-c { inset: auto auto 8% 20%; animation-delay: 4s; }

  .highlight-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-top: clamp(30px, 5vw, 52px);
  }
  .highlight {
    position: relative;
    min-width: 0;
    padding: 15px 16px 14px;
    border: 1px solid rgba(163, 181, 227, .13);
    border-radius: 17px;
    background: rgba(5, 8, 18, .42);
    transition: border-color .22s ease, transform .22s ease;
  }
  .highlight:hover { border-color: rgba(84, 232, 255, .4); transform: translateY(-2px); }
  .hl-dot {
    position: absolute;
    inset-block-start: 17px;
    inset-inline-start: 16px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--grad);
    box-shadow: 0 0 12px rgba(84, 232, 255, .55);
  }
  .hl-label { display: block; margin: 0 0 6px; padding-inline-start: 17px; color: var(--quiet); font-size: 11px; font-weight: 780; letter-spacing: .04em; }
  .highlight strong { display: -webkit-box; overflow: hidden; color: #e5eaf8; font-size: 12.5px; font-weight: 640; line-height: 1.6; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }

  /* ── icon chips: one size per role, four idle animations, four tones ──── */
  .icon-chip {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border: 1px solid rgba(122, 205, 255, .24);
    border-radius: 14px;
    color: var(--cy);
    background: linear-gradient(145deg, rgba(84, 232, 255, .13), rgba(155, 123, 255, .13));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .09), 0 8px 20px rgba(20, 110, 200, .12);
    transition: border-color .3s ease, color .3s ease, box-shadow .3s ease;
  }
  .icon-chip svg { width: 22px; height: 22px; }
  .icon-md { width: 46px; height: 46px; border-radius: 15px; }
  .icon-lg { width: 58px; height: 58px; border-radius: 18px; }
  .icon-lg svg { width: 28px; height: 28px; }
  .icon-xl { width: 92px; height: 92px; border-radius: 28px; border-color: rgba(122, 205, 255, .36); }
  .icon-xl svg { width: 44px; height: 44px; }
  /* tone cycle — every 2nd/3rd/4th chip in a list gets a different hue so a
     grid of icons reads as a set, not a stamp */
  :where(.facts-grid, .lib-grid, .post-index) > :nth-child(4n+2) .icon-chip { color: var(--vi); border-color: rgba(168, 140, 255, .3); background: linear-gradient(145deg, rgba(155, 123, 255, .16), rgba(84, 232, 255, .08)); }
  :where(.facts-grid, .lib-grid, .post-index) > :nth-child(4n+3) .icon-chip { color: var(--li); border-color: rgba(94, 242, 184, .3); background: linear-gradient(145deg, rgba(94, 242, 184, .13), rgba(0, 200, 255, .07)); }
  :where(.facts-grid, .lib-grid, .post-index) > :nth-child(4n+4) .icon-chip { color: var(--pi); border-color: rgba(255, 110, 199, .3); background: linear-gradient(145deg, rgba(255, 110, 199, .12), rgba(155, 123, 255, .08)); }
  /* idle animations — transform/opacity only, all switched off below */
  .fx-float { animation: fx-float 5.6s ease-in-out infinite alternate; }
  .fx-breathe { animation: fx-breathe 4.8s ease-in-out infinite; }
  .fx-tilt { animation: fx-tilt 6.6s ease-in-out infinite alternate; }
  .fx-orbit::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 6px;
    margin: -3px 0 0 -3px;
    border-radius: 50%;
    background: var(--li);
    box-shadow: 0 0 9px var(--li);
    animation: orbit-dot 9.5s linear infinite;
  }

  /* ── section headings ─────────────────────────────────────────────────── */
  .section-heading { display: flex; align-items: flex-start; gap: 16px; max-width: 760px; }
  .section-heading-copy { min-width: 0; }
  .section-kicker {
    margin: 0 0 6px;
    color: var(--cy);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .section-heading h2 { margin-bottom: 6px; color: #eff3ff; font-size: clamp(22px, 3vw, 30px); font-weight: 820; letter-spacing: -.025em; line-height: 1.3; }
  .section-heading > .section-heading-copy > p:last-child { margin-bottom: 0; color: var(--quiet); font-size: 13.5px; }

  .story-copy { max-width: 780px; margin-top: 24px; }
  .story-copy p { margin-bottom: 17px; color: #bcc5db; font-size: 15.5px; line-height: ${dir === 'rtl' ? '2.05' : '1.9'}; }
  .story-copy p:last-child { margin-bottom: 0; }

  /* ── guides ───────────────────────────────────────────────────────────── */
  .post-body .post-block { margin-top: 30px; }
  .post-body .post-block:first-child { margin-top: 8px; }
  .post-block h2 { margin: 0 0 12px; font-size: clamp(18.5px, 2.4vw, 23.5px); line-height: 1.4; letter-spacing: -.015em; }
  .post-block p { margin: 0 0 15px; color: #b6c0d6; font-size: 15px; line-height: ${dir === 'rtl' ? '2.05' : '1.9'}; }
  .post-block p:last-child { margin-bottom: 0; }
  .post-index { display: grid; gap: 13px; margin-top: 26px; }
  .post-index-item {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 17px 18px;
    border: 1px solid rgba(163, 181, 227, .13);
    border-radius: var(--r-md);
    background: rgba(8, 11, 24, .5);
    text-decoration: none;
    transition: border-color .2s ease, transform .2s ease, background .2s ease;
  }
  .post-index-item:hover { border-color: rgba(155, 123, 255, .5); background: rgba(12, 15, 34, .7); transform: translateY(-2px); }
  .post-index-item:hover .icon-chip { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .09), 0 0 22px rgba(120, 160, 255, .25); }
  .post-index-body { min-width: 0; }
  .post-index-date { display: block; margin-bottom: 6px; color: var(--quiet); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: .04em; }
  .post-index-item h3 { margin: 0 0 6px; color: #edf2ff; font-size: 15.5px; letter-spacing: -.01em; line-height: 1.45; }
  .post-index-item p { margin: 0; overflow: hidden; color: #aeb8ce; font-size: 13px; line-height: 1.75; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }

  /* ── library directory ────────────────────────────────────────────────── */
  .lib-flagship {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 18px;
    margin-top: 26px;
    padding: 20px 22px;
    border: 1px solid transparent;
    border-radius: var(--r-md);
    background: var(--panel-solid) padding-box, linear-gradient(120deg, rgba(84, 232, 255, .55), rgba(155, 123, 255, .55), rgba(255, 110, 199, .45)) border-box;
    text-decoration: none;
    transition: transform .22s ease, box-shadow .22s ease;
  }
  .lib-flagship:hover { transform: translateY(-2px); box-shadow: 0 18px 44px rgba(90, 120, 255, .18); }
  .lib-flagship-copy { display: grid; gap: 3px; min-width: 0; }
  .lib-flagship-kicker { color: var(--cy); font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
  .lib-flagship strong { color: #f2f5ff; font-size: clamp(15.5px, 2vw, 18px); letter-spacing: -.01em; }
  .lib-flagship-hint { color: var(--muted); font-size: 12.5px; line-height: 1.7; }
  .lib-groups { display: grid; gap: 26px; margin-top: 30px; }
  .lib-group-title {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 0 0 13px;
    color: #dbe3f7;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .lib-group-title svg { width: 16px; height: 16px; color: var(--vi); }
  .lib-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
  .lib-card {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 15px;
    padding: 17px 18px;
    border: 1px solid rgba(163, 181, 227, .13);
    border-radius: var(--r-md);
    background: rgba(8, 11, 24, .5);
    text-decoration: none;
    transition: border-color .2s ease, transform .2s ease, background .2s ease;
  }
  .lib-card:hover { border-color: rgba(84, 232, 255, .46); background: rgba(11, 15, 32, .72); transform: translateY(-2px); }
  .lib-card:hover .icon-chip { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .09), 0 0 22px rgba(84, 232, 255, .22); }
  .lib-card-copy { min-width: 0; }
  .lib-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
  .lang-badge { padding: 2px 8px; border-radius: 999px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 700; letter-spacing: .05em; }
  .lang-en { color: #9deeff; border: 1px solid rgba(84, 232, 255, .36); background: rgba(84, 232, 255, .07); }
  .lang-fa { color: #cdbdfc; border: 1px solid rgba(155, 123, 255, .4); background: rgba(155, 123, 255, .09); }
  .lib-card-date { color: var(--quiet); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }
  .lib-card h4 { margin: 0 0 5px; color: #edf2ff; font-size: 14.5px; font-weight: 780; letter-spacing: -.01em; line-height: 1.45; }
  .lib-card p { margin: 0; overflow: hidden; color: #a7b1c8; font-size: 12.5px; line-height: 1.7; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .card-arrow { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto; border: 1px solid var(--line); border-radius: 50%; color: var(--quiet); transition: color .2s ease, border-color .2s ease, transform .2s ease; }
  .card-arrow svg { width: 14px; height: 14px; }
  [dir="rtl"] .card-arrow svg { transform: scaleX(-1); }
  a:hover > .card-arrow, .lib-card:hover .card-arrow, .lib-flagship:hover .card-arrow, .post-index-item:hover .card-arrow { color: var(--cy); border-color: rgba(84, 232, 255, .5); transform: translate(2px, -2px); }
  [dir="rtl"] .lib-card:hover .card-arrow, [dir="rtl"] .lib-flagship:hover .card-arrow, [dir="rtl"] .post-index-item:hover .card-arrow, [dir="rtl"] a:hover > .card-arrow { transform: translate(-2px, -2px); }

  /* ── facts ────────────────────────────────────────────────────────────── */
  .facts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 26px; }
  .fact-card {
    position: relative;
    min-width: 0;
    padding: 21px 20px 20px;
    border: 1px solid rgba(164, 182, 229, .13);
    border-radius: var(--r-md);
    background: linear-gradient(148deg, rgba(30, 38, 70, .46), rgba(9, 13, 27, .42));
    transition: transform .26s ease, border-color .26s ease, background .26s ease;
  }
  .fact-card:hover { border-color: rgba(84, 232, 255, .44); background: linear-gradient(148deg, rgba(37, 49, 90, .62), rgba(9, 13, 27, .6)); transform: translateY(-4px); }
  .fact-card:hover .icon-chip { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .09), 0 0 24px rgba(84, 232, 255, .24); }
  .fact-card .icon-chip { margin-bottom: 16px; }
  .fact-index { position: absolute; inset-block-start: 22px; inset-inline-end: 20px; color: rgba(155, 123, 255, .85); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
  .fact-card h3 { margin-bottom: 7px; color: #edf1ff; font-size: 15px; letter-spacing: -.01em; }
  .fact-card p { margin-bottom: 0; color: var(--muted); font-size: 13.5px; line-height: 1.8; }

  /* ── how-to rail ──────────────────────────────────────────────────────── */
  .howto-list { position: relative; margin: 26px 0 0; padding: 0; list-style: none; display: grid; gap: 13px; counter-reset: howto; }
  .howto-list::before {
    content: '';
    position: absolute;
    inset-block: 26px;
    inset-inline-start: 25px;
    width: 1px;
    background: linear-gradient(rgba(84, 232, 255, 0), rgba(122, 150, 255, .3) 18%, rgba(122, 150, 255, .3) 82%, rgba(84, 232, 255, 0));
  }
  .howto-list li { position: relative; display: grid; grid-template-columns: 50px minmax(0, 1fr); gap: 16px; align-items: start; padding: 17px 18px; border: 1px solid rgba(163, 181, 227, .12); border-radius: var(--r-md); background: rgba(8, 11, 24, .5); transition: border-color .2s ease, transform .2s ease; }
  .howto-list li:hover { border-color: rgba(84, 232, 255, .4); transform: translateY(-2px); }
  .howto-list h3 { margin: 0 0 7px; font-size: 15px; letter-spacing: -.01em; line-height: 1.5; }
  .howto-list p { margin: 0; color: #aeb8ce; font-size: 13.5px; line-height: 1.9; }
  .howto-num {
    display: grid;
    place-items: center;
    width: 50px;
    height: 50px;
    border: 1px solid rgba(122, 205, 255, .28);
    border-radius: 16px;
    background: linear-gradient(150deg, rgba(20, 26, 50, .95), rgba(10, 13, 28, .95));
    color: var(--cy);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 750;
  }

  /* ── faq ──────────────────────────────────────────────────────────────── */
  .faq-list { margin-top: 26px; border-top: 1px solid var(--line); }
  .faq-list details { border-bottom: 1px solid var(--line); }
  .faq-list summary { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 19px 2px; color: #e8edf9; cursor: pointer; font-size: 15px; font-weight: 740; line-height: 1.6; list-style: none; transition: color .18s ease; }
  .faq-list summary:hover { color: var(--cy); }
  .faq-list summary::-webkit-details-marker { display: none; }
  .faq-plus { display: grid; width: 29px; height: 29px; flex: 0 0 29px; place-items: center; border: 1px solid rgba(135, 150, 195, .28); border-radius: 10px; color: var(--cy); font-size: 18px; font-weight: 400; transition: transform .24s ease, background .24s ease, border-color .24s ease; }
  details[open] .faq-plus { background: rgba(84, 232, 255, .12); border-color: rgba(84, 232, 255, .45); transform: rotate(45deg); }
  .faq-list details p { max-width: 750px; margin: -3px 0 19px; color: var(--muted); font-size: 14px; line-height: 1.9; }

  /* ── risk ─────────────────────────────────────────────────────────────── */
  .risk-panel {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    padding: 20px 22px;
    border: 1px solid rgba(255, 195, 92, .3);
    border-radius: var(--r-md);
    background: linear-gradient(140deg, rgba(70, 46, 15, .5), rgba(16, 14, 22, .72));
  }
  .risk-panel .icon-chip { color: var(--am); border-color: rgba(255, 195, 92, .42); background: linear-gradient(145deg, rgba(255, 195, 92, .16), rgba(255, 110, 110, .08)); }
  .risk-panel h2 { margin-bottom: 5px; color: #ffe4b5; font-size: 14px; letter-spacing: .01em; }
  .risk-panel p { margin-bottom: 0; color: #d3c5ad; font-size: 13px; line-height: 1.85; }

  /* ── related ──────────────────────────────────────────────────────────── */
  .related-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
  .related-links a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    padding: 15px 16px;
    border: 1px solid rgba(163, 181, 227, .13);
    border-radius: 16px;
    background: rgba(8, 11, 24, .45);
    color: #c5cee2;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.6;
    text-decoration: none;
    transition: border-color .2s ease, color .2s ease, transform .2s ease;
  }
  .related-links a > span:first-child { min-width: 0; }
  .related-links a:hover { border-color: rgba(84, 232, 255, .5); color: var(--ink); transform: translateY(-2px); }

  /* ── footer ───────────────────────────────────────────────────────────── */
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px 22px;
    padding: 20px 24px;
    border-radius: var(--r-md);
    color: var(--quiet);
    font-size: 12px;
    line-height: 1.9;
  }
  footer p { margin: 0; }
  footer a { color: var(--muted); text-decoration: none; text-underline-offset: 4px; transition: color .18s ease; }
  footer a:hover { color: var(--cy); }
  .footer-nav { display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .footer-nav a { display: inline-flex; align-items: center; gap: 6px; font-weight: 650; }
  .footer-nav svg { width: 13px; height: 13px; color: var(--vi); }

  /* ── code samples (developer guide) ───────────────────────────────────── */
  .code-sample-list { display: grid; gap: 17px; margin-top: 24px; }
  .code-sample { min-width: 0; margin: 0; }
  .code-sample figcaption { color: var(--muted); font-size: 13px; font-weight: 750; }
  .code-sample pre { max-width: 100%; margin: 9px 0 0; padding: 17px; overflow: auto; border: 1px solid rgba(163, 181, 227, .14); border-radius: var(--r-sm); color: #d5e5ff; background: #070912; direction: ltr; text-align: left; tab-size: 2; }
  .code-sample code { font: 12.5px/1.8 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }

  /* ── reveal: CSS fallback first, JS scroll-reveal enhances it ─────────── */
  .reveal { animation: rise-in .8s cubic-bezier(.16, 1, .3, 1) both; animation-delay: var(--delay, 0ms); }
  html.js .reveal { animation: none; opacity: 0; transform: translateY(26px); }
  html.js .reveal.in {
    opacity: 1;
    transform: none;
    transition: opacity .8s ease, transform .8s cubic-bezier(.16, 1, .3, 1);
    transition-delay: var(--delay, 0ms);
  }

  @keyframes rise-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes grid-drift { from { transform: perspective(520px) rotateX(61deg) translate3d(0, -9%, 0); } to { transform: perspective(520px) rotateX(61deg) translate3d(56px, -9%, 0); } }
  @keyframes orb-one { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(10vw, 8vh, 0) scale(1.15); } }
  @keyframes orb-two { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(-11vw, 10vh, 0) scale(1.12); } }
  @keyframes spin-slow { to { transform: rotate(360deg); } }
  @keyframes spin-rev { to { transform: rotate(-360deg); } }
  @keyframes sheen { 0%, 38% { transform: translateX(-130%); } 64%, 100% { transform: translateX(130%); } }
  @keyframes dot-breathe { 0%, 100% { opacity: .55; transform: scale(1); box-shadow: 0 0 0 0 rgba(94, 242, 184, .3); } 50% { opacity: 1; transform: scale(1.22); box-shadow: 0 0 0 5px rgba(94, 242, 184, 0); } }
  @keyframes glow-breathe { 0%, 100% { opacity: .5; transform: scale(.96); } 50% { opacity: .95; transform: scale(1.05); } }
  @keyframes twinkle { 0%, 100% { opacity: .18; transform: scale(.8); } 50% { opacity: .9; transform: scale(1.15); } }
  @keyframes fx-float { from { transform: translateY(2.5px); } to { transform: translateY(-3.5px); } }
  @keyframes fx-breathe { 0%, 100% { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .09), 0 8px 20px rgba(20, 110, 200, .12); } 50% { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .09), 0 8px 20px rgba(20, 110, 200, .12), 0 0 22px 1px rgba(84, 232, 255, .24); } }
  @keyframes fx-tilt { from { transform: rotate(-3.5deg); } to { transform: rotate(3.5deg); } }
  @keyframes orbit-dot { from { transform: rotate(0deg) translateY(-28px); } to { transform: rotate(360deg) translateY(-28px); } }

  /* Letter-spacing tears Arabic-script glyphs apart — Persian renders with
     tracking back at zero everywhere a kicker/label might carry it. */
  [dir="rtl"] .eyebrow, [dir="rtl"] .section-kicker, [dir="rtl"] .lib-group-title,
  [dir="rtl"] .lib-flagship-kicker, [dir="rtl"] .hl-label, [dir="rtl"] .fact-index,
  [dir="rtl"] .post-index-date, [dir="rtl"] .lang-badge { letter-spacing: 0; }

  @media (max-width: 900px) {
    .hero-grid { grid-template-columns: 1fr; }
    .hero-emblem { display: none; }
  }
  @media (max-width: 680px) {
    :root { --gap: 14px; }
    .landing-page { width: min(100% - 24px, 1080px); }
    .topbar { margin-bottom: 24px; }
    .crumb span[aria-current] { max-width: 52vw; }
    h1 { font-size: clamp(29px, 9vw, 44px); }
    h1::after { margin-top: 16px; }
    .hero-actions { display: grid; grid-template-columns: 1fr; }
    .cta, .soft-cta { width: 100%; }
    .highlight-grid { grid-template-columns: 1fr; }
    .facts-grid, .related-links, .lib-grid { grid-template-columns: 1fr; }
    .panel { padding: 22px 20px; border-radius: 22px; }
    .lib-flagship { grid-template-columns: auto minmax(0, 1fr); }
    .lib-flagship .card-arrow { display: none; }
    .post-index-item { grid-template-columns: auto minmax(0, 1fr); }
    .post-index-item .card-arrow { display: none; }
    .howto-list::before { display: none; }
    .howto-list li { grid-template-columns: 1fr; gap: 12px; }
    .howto-num { width: 44px; height: 44px; border-radius: 14px; }
    footer { display: block; }
    footer p + p { margin-top: 8px; }
    .footer-nav { margin-top: 10px; }
  }

  /*
   * ─── MOTION BUDGET ─────────────────────────────────────────────────────────
   * The hard-earned rule of this codebase: a device that cannot hover is a
   * device whose frame budget is spent on reading, not on ambience. The art
   * stays — grid, orbs, medallion — but every infinite animation holds its
   * first frame, the blur kernels come off, and backdrop-filter is traded for
   * near-opaque panels. Short finite reveals are untouched. No user-agent
   * sniffing anywhere: one document, two budgets.
   */
  @media (hover: none), (max-width: 999px) {
    .ambient-grid, .orb-one, .orb-two { animation: none; }
    .hero-panel::before, .hero-panel::after { animation: none; }
    .hero-panel::after { opacity: 0; }
    .eyebrow-dot, .emblem-glow, .sparkle { animation: none; }
    .emblem-ring, .emblem-ring-2 { animation: none; }
    .fx-float, .fx-breathe, .fx-tilt { animation: none; }
    .fx-orbit::after { display: none; }
    .orb { filter: none; opacity: .24; }
    .hero-panel, .panel, .risk-panel, footer { backdrop-filter: none; background: var(--panel-solid); }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
  }
  ${page.marketDashboard ? MARKET_DASHBOARD_STYLES : ''}
</style>
</head>
<body class="landing-body">
<a class="skip-link" href="#content">${esc(ui.details)}</a>
<div class="ambient" aria-hidden="true">
  <span class="ambient-grid"></span>
  <span class="orb orb-one"></span>
  <span class="orb orb-two"></span>
</div>
<main id="content" class="landing-page" tabindex="-1">
  <header class="hero-panel reveal" style="--delay:20ms">
    <div class="topbar">
      <nav class="crumb" aria-label="${esc(ui.breadcrumb)}">
        <a href="${esc(SITE)}/">${esc(ui.home)}</a>
        <span class="crumb-sep" aria-hidden="true">/</span>
        ${isLibrary
          ? `<span aria-current="page">${esc(ui.library)}</span>`
          : `<a href="${esc(SITE)}/${slugPath(lang === 'fa' ? 'fa/' : 'library')}">${esc(ui.library)}</a>
        <span class="crumb-sep" aria-hidden="true">/</span>
        <span aria-current="page">${esc(page.h1)}</span>`}
      </nav>
      ${langMate ? `<a class="lang-pill" href="${esc(langMate.url)}" aria-label="${esc(ui.langAria)}">${iconSvg('globe')}<span>${esc(ui.langVersion)}</span></a>` : ''}
    </div>

    <div class="brand-row">
      <a class="brand" href="${esc(SITE)}/" aria-label="FBT Swap">
        <span class="brand-mark"><img src="/icon-192.png" alt="" width="28" height="28"></span>
        <span>FBT Swap</span>
      </a>
      ${isLibrary ? '' : `<a class="pages-pill" href="${esc(SITE)}/${slugPath(lang === 'fa' ? 'fa/' : 'library')}">${iconSvg('grid')}<span>${esc(ui.allPages)}</span></a>`}
    </div>

    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>${esc(ui.eyebrow)}</p>
        <h1>${esc(page.h1)}</h1>
        <p class="lede">${esc(page.description)}</p>
        ${postMeta}
        <div class="hero-actions">
          <a class="cta" href="${esc(appUrl)}">${iconSvg('spark')}<span>${esc(page.ctaLabel || ui.ctaDefault)}</span><span class="cta-arrow" aria-hidden="true">\u2192</span></a>
          ${isLibrary ? `<a class="soft-cta" href="#directory-top"><span>${esc(ui.details)}</span><span aria-hidden="true">\u2193</span></a>` : `<a class="soft-cta" href="#facts"><span>${esc(ui.details)}</span><span aria-hidden="true">\u2193</span></a>`}
        </div>
      </div>
      <div class="hero-emblem" aria-hidden="true">
        <span class="emblem-ring"></span>
        <span class="emblem-ring emblem-ring-2"></span>
        <span class="emblem-glow"></span>
        <span class="sparkle sparkle-a"></span>
        <span class="sparkle sparkle-b"></span>
        <span class="sparkle sparkle-c"></span>
        ${iconChip(page.icon || 'spark', 'icon-xl fx-float')}
      </div>
    </div>

    <div class="highlight-grid" aria-label="${esc(ui.highlights)}">
      ${highlights}
    </div>
  </header>

  <section class="story-card panel reveal" aria-labelledby="story-heading" style="--delay:60ms">
    <div class="section-heading">
      ${iconChip(isLibrary ? 'grid' : 'spark', 'icon-md fx-breathe')}
      <div class="section-heading-copy">
        <p class="section-kicker">${isLibrary ? esc(ui.libraryKicker) : 'FBT Swap'}</p>
        <h2 id="story-heading">${esc(ui.story)}</h2>
      </div>
    </div>
    <div class="story-copy">
      ${page.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('\n      ')}
    </div>
  </section>

  ${bodyExtra}

  ${codeSamplesMarkup}

  ${marketDashboardMarkup}

  ${howToMarkup}

  <section id="${isLibrary ? 'directory-top' : 'facts'}" class="facts-panel panel reveal" aria-labelledby="facts-heading" style="--delay:80ms">
    <div class="section-heading">
      ${iconChip(page.icon || 'spark', 'icon-md fx-float')}
      <div class="section-heading-copy">
        <p class="section-kicker">${esc(ui.highlights)}</p>
        <h2 id="facts-heading">${esc(page.glanceLabel || ui.highlights)}</h2>
      </div>
    </div>
    <div class="facts-grid">
      ${factCards}
    </div>
  </section>

  ${faqMarkup}

  <section class="risk-panel reveal" aria-labelledby="risk-heading" style="--delay:100ms">
    ${iconChip('alert', 'icon-md')}
    <div>
      <h2 id="risk-heading">${esc(ui.risk)}</h2>
      <p>${esc(page.riskText || ui.riskText)}</p>
    </div>
  </section>

  ${postLinks}

  ${isLibrary ? '' : `<section class="related-panel panel reveal" aria-labelledby="related-heading" style="--delay:110ms">
    <div class="section-heading">
      ${iconChip('grid', 'icon-md fx-tilt')}
      <div class="section-heading-copy">
        <p class="section-kicker">FBT Swap</p>
        <h2 id="related-heading">${esc(ui.related)}</h2>
      </div>
    </div>
    <div class="related-links">
      ${siblingLinks}
    </div>
  </section>`}

  <footer class="reveal" style="--delay:120ms">
    <p><a href="${esc(SITE)}/">FBT Swap</a> &middot; Fanous Bazaar Pishgam Co., Isfahan, Iran</p>
    <nav class="footer-nav" aria-label="${esc(ui.breadcrumb)}">
      <a href="${esc(SITE)}/${slugPath(lang === 'fa' ? 'fa/' : 'library')}">${iconSvg('grid')}<span>${esc(ui.library)}</span></a>
      ${langMate ? `<a href="${esc(langMate.url)}">${iconSvg('globe')}<span>${esc(ui.langVersion)}</span></a>` : ''}
      <a href="${esc(SITE)}/#/legal/privacy"><span>Privacy</span></a>
      <a href="${esc(SITE)}/#/legal/terms"><span>Terms</span></a>
    </nav>
  </footer>
</main>
<script>
  /* Scroll reveal: the CSS-only rise-in above is the no-JS fallback; when a
     browser has both JS and IntersectionObserver, panels animate as they
     enter the viewport instead of all at once on load. Reduced-motion users
     get everything immediately, with no transition. */
  (function () {
    var d = document.documentElement;
    d.classList.add('js');
    var els = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -7% 0px' });
    els.forEach(function (el) { io.observe(el); });
  })();
</script>
${marketDashboardScript}
</body>
</html>
`;
}

/* -------------------------------------------------------------------------- */

/*
 * ─── MOVED: the old Arabic-script URLs ───────────────────────────────────────
 * Every URL under the .ir domain is English now (owner requirement for better
 * indexing). The Persian pages moved to /fa/<english-slug> and the flagship
 * landing to /decentralized-crypto-exchange. The old addresses were live and
 * indexed, so they get TWO layers of redirect:
 *
 *   1. vercel.json — real 308 server redirects. This is the one crawlers hit.
 *   2. The static stubs below — a noindex document with a canonical pointing
 *      at the new URL, a JS replace and a visible link. Insurance for any
 *      host that serves dist/ without the Vercel routing config.
 *
 * The stubs are deliberately NOT meta-refresh redirects: an instant refresh
 * page is the doorway-page pattern the wiring audit bans, and a JS replace +
 * canonical is equally effective behind a real 308.
 */
const MOVED = {
  'هشدار-قیمت-ارز-دیجیتال': 'fa/crypto-price-alerts-and-dca',
  'تحلیل-تکنیکال-ارز-دیجیتال': 'fa/crypto-market-history-analysis',
  'کیف-پول-غیرامانی': 'fa/non-custodial-wallet',
  'سواپ-ارز-دیجیتال': 'fa/crypto-swap-without-kyc',
  'سرمایه-گذاری-در-ارز-دیجیتال': 'fa/crypto-investing-yield-and-lending',
  'سواپ-سولانا': 'fa/solana-token-swap',
  'آموزش-ارز-دیجیتال': 'fa/crypto-education',
  'آموزش-توسعه-دهندگان': 'fa/developers',
  'بازار-کریپتو-نمودار-سیگنال': 'fa/crypto-market-charts-signals',
  'سهام-جهانی-توکنی‌شده': 'fa/tokenized-global-stocks',
  'کارمزد-سواپ-ارز-دیجیتال': 'fa/how-crypto-swap-fees-work',
  'تفاوت-کیف-پول-امانی-و-غیرامانی': 'fa/custodial-vs-non-custodial-wallets',
  'بدون-احراز-هویت-چه-چیزی-خصوصی-می-ماند': 'fa/what-stays-private-without-kyc',
  'وبلاگ': 'fa/blog',
  'صرافی-غیرمتمرکز': V2_PAGE.slug
};
function renderMovedStub(newSlug) {
  const target = `${SITE}/${slugPath(newSlug)}`;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>انتقال به نشانی جدید | FBT Swap</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(target)}">
<meta name="theme-color" content="#05060d">
<script>window.location.replace(${JSON.stringify(target)} + (window.location.hash || ''));</script>
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#05060d;color:#eef2ff;font:16px/2 system-ui,'Vazirmatn',sans-serif;text-align:center}main{padding:32px;max-width:420px}a{color:#54e8ff;font-weight:700}</style>
</head>
<body>
<main>
<p>این صفحه به نشانی تازهٔ انگلیسی منتقل شده است و اکنون به‌صورت خودکار باز می‌شود.</p>
<p><a href="${esc(target)}">ادامهٔ مطلب در نشانی جدید</a></p>
</main>
</body>
</html>
`;
}

function main() {
  for (const page of PAGES) {
    /*
     * A DIRECTORY with index.html, not `slug.html`. Static hosts serve
     * `/slug/` from `/slug/index.html`, giving a clean URL with no extension
     * — and a URL that ends in `.html` looks abandoned in 2026. Persian
     * pages are nested one level down (`fa/<slug>/index.html`).
     */
    const dir = join(OUT, page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), render(page), 'utf8');
  }

  /*
   * The flagship bilingual landing. It used to live in PAGES above as a
   * plain Persian guide; it is now the FBT Financial OS landing 2.0 with
   * its own template and live market data. Its URL moved to the English
   * slug /decentralized-crypto-exchange; the old address gets a 308 (see
   * vercel.json) plus a static stub below.
   */
  const v2Dir = join(OUT, V2_PAGE.slug);
  mkdirSync(v2Dir, { recursive: true });
  writeFileSync(join(v2Dir, 'index.html'), renderLandingV2({ site: SITE }), 'utf8');

  for (const [oldSlug, newSlug] of Object.entries(MOVED)) {
    const dir = join(OUT, oldSlug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderMovedStub(newSlug), 'utf8');
  }

  /*
   * Rewrite the sitemap so the new pages are actually discoverable. Submitting
   * a sitemap that omits them would leave the whole exercise depending on
   * Google finding the links on its own.
   */
  /*
   * Do not manufacture a <lastmod> date here. This generator runs on every
   * deployment, including deployments that only change JavaScript or server
   * code; stamping every landing page with "today" would tell crawlers its
   * editorial content changed when it did not. Omission is more honest than
   * stale or synthetic metadata, and new URLs are still discoverable through
   * this sitemap, robots.txt, internal links and IndexNow.
   */
  const urls = [
    `  <url>\n    <loc>${SITE}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    `  <url>\n    <loc>${SITE}/${slugPath(V2_PAGE.slug)}</loc>\n    <changefreq>${V2_PAGE.changefreq}</changefreq>\n    <priority>${V2_PAGE.priority}</priority>\n  </url>`,
    ...PAGES.map(
      (p) =>
        `  <url>\n    <loc>${SITE}/${slugPath(p.slug)}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`
    )
  ];

  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by scripts/gen-landing.mjs — do not edit by hand.

  Only real, server-rendered URLs are listed. In-app routes are hash-based
  (/#/swap) and a crawler never sees anything after the '#', so listing them
  would add entries that resolve to the same single document.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`,
    'utf8'
  );

  // Sanity check: the app's own index must still be there. A generator that
  // overwrote it would take the whole site down.
  readFileSync(join(OUT, 'index.html'), 'utf8');

  console.log(`▸ generated ${PAGES.length + 1} landing pages + sitemap`);
  for (const p of PAGES) console.log(`  /${p.slug}`);
  console.log(`  /${V2_PAGE.slug} (bilingual landing 2.0)`);
}

main();
