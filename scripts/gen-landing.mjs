#!/usr/bin/env node
/**
 * CRAWLABLE LANDING PAGES
 * ---------------------------------------------------------------------------
 * ─── THE PROBLEM, MEASURED ──────────────────────────────────────────────────
 * The app has 33 routes. Google has indexed ONE page.
 *
 * That is not bad luck, it is arithmetic: every route is behind a hash
 * (`/#/swap`), and everything after the `#` is never sent to the server. A
 * crawler asking for `/#/swap` receives the identical HTML it got for `/`, so
 * there is exactly one indexable document no matter how many screens exist.
 *
 * Verified against the live site: `site:lawpoetics.ir` returns a single
 * result, and `sitemap.xml` honestly lists one URL because inventing hash
 * entries would just 404 on inspection.
 *
 * Meanwhile `/api/orders/watch/status` still reports `watches: 0`. Zero real
 * users. Everything else built recently — the history engine, the second
 * aggregator, the wallet redesign — is worth nothing until somebody arrives,
 * and search is the only arrival channel that costs no money and keeps
 * working while nobody is watching it.
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
 * advertised "9 Chains" and Tron support that does not exist — that text was
 * what Google had indexed, so the one thing search engines knew about us was
 * partly false. Anyone arriving to swap on Tron would find nothing and leave.
 * Do not add a page here for a feature until it works.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * ─── THE CANONICAL HOME IS NOW fbtswap.ir ───────────────────────────────────
 * The site ran on `www.lawpoetics.ir`, a domain whose name has nothing to do
 * with the product. That is not merely untidy — for search it is actively
 * expensive:
 *
 *   • EXACT-MATCH SIGNAL. Somebody searching "FBT Swap" sees a result on
 *     "lawpoetics.ir" and has no reason to believe it is the same thing. The
 *     click-through rate on a mismatched domain is measurably worse, and
 *     click-through feeds back into ranking.
 *   • TRUST. On a money app, a domain that does not match the brand is the
 *     single most common shape of a phishing clone. We were training our own
 *     users to ignore the one check that protects them.
 *   • BRAND SEARCH. Every mention of the app anywhere sends people to a name
 *     they then cannot find.
 *
 * `fbtswap.ir` matches the app name, the APK id (`ir.fbt.swap`) and the X
 * handle. Overridable by env so a preview deploy does not claim to be
 * production — a canonical tag pointing at production from a staging build
 * tells Google to index production instead of the page it is looking at,
 * which is how preview URLs quietly vanish from the index.
 */
const SITE = (process.env.VITE_PUBLIC_URL || 'https://fbtswap.ir').replace(/\/+$/, '');
const OUT = 'dist';

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
    lang: 'en',
    route: '/#/swap',
    title: 'Non-Custodial Crypto Swap — Keep Your Own Keys | FBT Swap',
    description:
      'Swap tokens across 10 supported networks without giving up your private keys. No account, no email, no identity check. You sign every trade from your own wallet.',
    h1: 'Swap crypto without giving up your keys',
    body: [
      'FBT Swap is a non-custodial exchange interface. You connect a wallet you already own, you swap, and your assets never leave your control. There is no account to create, no email to hand over and no identity check to pass.',
      'It does not run an order book and holds no liquidity of its own. It asks public aggregators for the best route across the decentralised exchanges on the network you chose, shows you the quote, the price impact and the fee, then hands the transaction to your wallet. You are the one who signs it, and the swap settles on-chain directly between your wallet and the protocol.',
      'Because nobody here holds your keys, this also means what you would expect: we cannot reverse a transaction, freeze funds, or recover a lost recovery phrase. Nobody can.'
    ],
    facts: [
      ['Networks', 'BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Solana'],
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
        a: 'The supported networks are BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic and Solana. Check the selected network carefully before sending or signing.'
      }
    ]
  },
  {
    slug: 'crypto-price-alerts-and-dca',
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
   * ═══════════════════════════════════════════════════════════════════════
   * THE PERSIAN PAGE — the highest-value single page on this list.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ─── WHY IT WAS MISSING AND WHY THAT COST US ────────────────────────────
   * The app is Persian-first. The interface defaults to Persian, the owner is
   * in Isfahan, and the domain is now a `.ir`. Every crawlable page we had
   * was in English.
   *
   * That is a straightforward mismatch of supply and demand. The English
   * queries these pages target — "non-custodial crypto swap", "crypto price
   * alerts" — are among the most contested phrases on the web, competing
   * with Uniswap, MetaMask and Trust Wallet, all of whom have a decade of
   * domain authority. We will not rank for them for years.
   *
   * The Persian equivalents («صرافی غیرمتمرکز», «سواپ ارز دیجیتال بدون
   * احراز هویت») have a fraction of the competition and a far higher
   * proportion of searchers who would actually use this app. It is the one
   * place where being small is not a disadvantage.
   *
   * ─── WHY IT IS NOT A TRANSLATION OF THE ENGLISH PAGE ────────────────────
   * A translated page ranks badly and deserves to: it answers the questions
   * an English speaker asks. A Persian speaker searching for this arrives
   * with different questions — can I use it without ID, does it work without
   * a foreign bank card, is my money held by anyone — and the copy answers
   * those instead. It is written, not translated.
   *
   * ─── AND WHY IT DOES NOT OVERSELL ───────────────────────────────────────
   * It does not claim the fiat on-ramp works from Iran, because it does not:
   * the card networks are disconnected at network level. Claiming otherwise
   * would rank us for a query we cannot satisfy, and a visitor who bounces
   * immediately is a ranking signal against the whole domain — as well as
   * being a lie.
   */
  {
    slug: 'صرافی-غیرمتمرکز',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/swap',
    title: 'صرافی غیرمتمرکز و سواپ ارز دیجیتال بدون احراز هویت | اف‌بی‌تی سواپ',
    description:
      'سواپ ارز دیجیتال روی ۱۰ شبکه، از کیف پول خودت. بدون ثبت‌نام، بدون احراز هویت و بدون اینکه دارایی‌ات دست کسی بیفتد. کلیدها پیش خودت می‌مانند.',
    h1: 'سواپ ارز دیجیتال، بدون اینکه کلیدهایت را به کسی بدهی',
    body: [
      'اف‌بی‌تی سواپ یک رابط صرافی غیرمتمرکز است. کیف پولی را که خودت داری وصل می‌کنی، معامله می‌کنی، و دارایی‌ات هیچ‌وقت از کنترل تو خارج نمی‌شود. حسابی برای ساختن نیست، ایمیلی برای دادن نیست و احراز هویتی برای گذراندن نیست.',
      'این برنامه دفتر سفارش ندارد و نقدینگی خودش را هم نگه نمی‌دارد. از تجمیع‌کننده‌های عمومی می‌پرسد بهترین مسیر روی شبکه‌ای که انتخاب کرده‌ای کدام است، قیمت و اثر قیمتی و کارمزد را نشانت می‌دهد، و بعد تراکنش را به کیف پول خودت می‌سپارد. امضا با توست و معامله مستقیم روی زنجیره بین کیف پول تو و پروتکل تسویه می‌شود.',
      'چون هیچ‌کس اینجا کلید تو را ندارد، نتیجه‌اش هم همان است که انتظار داری: ما نمی‌توانیم تراکنشی را برگردانیم، دارایی‌ای را مسدود کنیم، یا عبارت بازیابی گم‌شده‌ای را پس بدهیم. هیچ‌کس نمی‌تواند. این هزینه‌ی غیرامانی بودن است و پیش از هر معامله روی همان صفحه نوشته شده.',
      'برای استفاده از سواپ، کیف پول، نمودارها و هشدارهای قیمت به هیچ حسابی در هیچ‌جا نیاز نداری و هیچ محدودیت کشوری هم اعمال نمی‌شود — این‌ها روی خودِ بلاکچین اجرا می‌شوند. تنها بخشی که محدودیت دارد خرید با پول نقد است، چون آن یکی از طریق یک شریک پرداخت دارای مجوز انجام می‌شود و شبکه‌های کارت بین‌المللی از سال ۲۰۱۲ به سیستم بانکی ایران متصل نیستند. این را همان‌جا صریح نوشته‌ایم تا کسی وقتش را تلف نکند.'
    ],
    facts: [
      ['شبکه‌ها', 'بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک، سولانا'],
      ['کارمزد پلتفرم', '۰٫۷۰٪ از مقدار ورودی، پیش از امضا روی صفحه نمایش داده می‌شود؛ روی همهٔ شبکه‌های پشتیبانی‌شده'],
      ['امانت‌داری', 'هیچ. کلیدها داخل کیف پول خودت می‌مانند'],
      ['ثبت‌نام', 'لازم نیست'],
      ['احراز هویت', 'برای رابط سواپ لازم نیست']
    ],
    faqs: [
      {
        q: 'آیا برای سواپ در اف‌بی‌تی سواپ احراز هویت لازم است؟',
        a: 'برای استفاده از رابط سواپ روی زنجیره، حساب اف‌بی‌تی سواپ یا احراز هویت لازم نیست؛ کیف پول خودت را وصل می‌کنی و همان‌جا تراکنش را امضا می‌کنی. ممکن است خودِ کیف پول یا پروتکلِ ثالث بررسی امنیتی جداگانه داشته باشد.'
      },
      {
        q: 'آیا اف‌بی‌تی سواپ دارایی یا عبارت بازیابی من را نگه می‌دارد؟',
        a: 'نه. اف‌بی‌تی سواپ واریز نمی‌گیرد، عبارت بازیابی را نمی‌خواهد و به‌جای کاربر امضا نمی‌کند. دارایی داخل کیف پول متصل می‌ماند و هر تراکنش تأیید صاحب کیف پول را می‌خواهد.'
      },
      {
        q: 'کدام شبکه‌ها پشتیبانی می‌شوند؟',
        a: 'بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک و سولانا پشتیبانی می‌شوند. قبل از ارسال یا امضا، شبکهٔ انتخاب‌شده را با دقت بررسی کن.'
      }
    ],
    ctaLabel: 'باز کردن برنامه',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'ارزهای دیجیتال پرنوسان‌اند و تراکنش روی زنجیره برگشت‌ناپذیر است. ممکن است پول از دست بدهی، حتی همه‌اش را. هیچ‌چیز اینجا توصیه مالی نیست.'
  },

  /*
   * Persian search intent pages. These are deliberately feature pages, not
   * token-pair templates: each answers a distinct question a real visitor has
   * and points to the screen that performs the described task.
   */
  {
    slug: 'هشدار-قیمت-ارز-دیجیتال',
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
    slug: 'تحلیل-تکنیکال-ارز-دیجیتال',
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
    slug: 'کیف-پول-غیرامانی',
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
const ALTERNATES = [
  ['non-custodial-crypto-swap', 'صرافی-غیرمتمرکز'],
  ['crypto-price-alerts-and-dca', 'هشدار-قیمت-ارز-دیجیتال'],
  ['crypto-market-history-analysis', 'تحلیل-تکنیکال-ارز-دیجیتال']
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
        faqHint: 'پاسخ‌های کوتاه و روشن، پیش از اینکه تصمیم بگیری.'
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
        faqHint: 'Clear answers before you decide.'
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
      legalName: 'Fanous Bazaar Pishgam Co.',
      url: `${SITE}/`,
      email: 'fbtswap@gmail.com',
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png`, width: 512, height: 512 }
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: `${SITE}/`,
      name: 'FBT Swap',
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
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: ui.home, item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: page.h1, item: url }
      ]
    }
  ];

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

  return jsonForScript({ '@context': 'https://schema.org', '@graph': graph });
}

function render(page) {
  /*
   * The Persian slug contains Arabic-script characters, which are legal in a
   * URL path but MUST be percent-encoded before they go into `<link
   * rel="canonical">` or a sitemap. An unencoded non-ASCII character makes a
   * sitemap invalid per the spec, and an invalid sitemap is rejected whole —
   * taking the English pages down with it.
   *
   * `encodeURIComponent` and not `encodeURI`: the latter leaves `/` alone,
   * which is right for a whole path and wrong for a single segment.
   */
  const url = `${SITE}/${encodeURIComponent(page.slug)}`;
  const appUrl = `${SITE}${page.route}`;
  const lang = page.lang || 'en';
  const dir = page.dir || 'ltr';

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
                `${SITE}/${encodeURIComponent(other.slug)}`
              )}">`
          ),
          `<link rel="alternate" hreflang="x-default" href="${esc(
            `${SITE}/${encodeURIComponent(defaultPage.slug)}`
          )}">`
        ].join('\n');
      })()
    : '';
  const ui = copyFor(lang);
  const factCards = page.facts
    .map(
      ([label, value], index) => `<article class="fact-card" style="--item:${index}">
        <span class="fact-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <h3>${esc(label)}</h3>
        <p>${esc(value)}</p>
      </article>`
    )
    .join('\n      ');
  const highlights = page.facts
    .slice(0, 3)
    .map(
      ([label, value]) => `<div class="highlight">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>`
    )
    .join('\n      ');
  const siblingLinks = PAGES.filter((p) => p.slug !== page.slug && (p.lang || 'en') === lang)
    .map((p) => `<a href="/${encodeURIComponent(p.slug)}">${esc(p.h1)} <span aria-hidden="true">↗</span></a>`)
    .join('\n        ');
  const faqMarkup = page.faqs?.length
    ? `<section class="faq-panel panel reveal" aria-labelledby="faq-heading" style="--delay:260ms">
      <div class="section-heading">
        <p class="section-kicker">FAQ</p>
        <h2 id="faq-heading">${esc(ui.faq)}</h2>
        <p>${esc(ui.faqHint)}</p>
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
<meta name="theme-color" content="#06070c">
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
    --ink: #edf2ff;
    --muted: #aab5cf;
    --quiet: #75819f;
    --line: rgba(174, 191, 234, .16);
    --glass: rgba(13, 17, 31, .72);
    --glass-strong: rgba(13, 17, 31, .9);
    --cyan: #4eeaff;
    --violet: #9476ff;
    --pink: #ff68ca;
    --lime: #63f5bb;
  }
  * { box-sizing: border-box; }
  html { min-height: 100%; background: #04050b; scroll-behavior: smooth; }
  body {
    min-height: 100svh;
    margin: 0;
    overflow-x: hidden;
    background:
      radial-gradient(900px 520px at 12% -8%, rgba(80, 63, 191, .20), transparent 62%),
      radial-gradient(760px 500px at 96% 13%, rgba(0, 198, 255, .13), transparent 63%),
      #04050b;
    color: var(--ink);
    font: 16px/${dir === 'rtl' ? '1.95' : '1.75'} ${
      dir === 'rtl' ? "'Vazirmatn', " : ''
    }system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color: inherit; }
  .skip-link {
    position: fixed;
    z-index: 20;
    inset-block-start: 10px;
    inset-inline-start: 10px;
    transform: translateY(-180%);
    padding: 9px 14px;
    border-radius: 10px;
    color: #041018;
    background: var(--cyan);
    font-weight: 800;
    text-decoration: none;
    transition: transform .18s ease;
  }
  .skip-link:focus { transform: translateY(0); }
  .ambient { position: fixed; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }
  .ambient::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(4, 5, 11, .05), rgba(4, 5, 11, .92) 82%, #04050b);
  }
  .ambient-grid {
    position: absolute;
    inset: -35%;
    opacity: .42;
    background-image:
      linear-gradient(rgba(113, 127, 180, .11) 1px, transparent 1px),
      linear-gradient(90deg, rgba(113, 127, 180, .11) 1px, transparent 1px);
    background-size: 54px 54px;
    mask-image: radial-gradient(ellipse 68% 48% at 50% 26%, #000, transparent 76%);
    transform: perspective(500px) rotateX(62deg) translateY(-10%);
    animation: grid-drift 22s linear infinite;
  }
  .orb {
    position: absolute;
    width: clamp(260px, 35vw, 570px);
    aspect-ratio: 1;
    border-radius: 50%;
    filter: blur(24px);
    opacity: .34;
    mix-blend-mode: screen;
  }
  .orb-one {
    inset: -17% auto auto -13%;
    background: radial-gradient(circle at 58% 52%, #8b5cff, transparent 66%);
    animation: orb-one 18s ease-in-out infinite alternate;
  }
  .orb-two {
    inset: 12% -14% auto auto;
    background: radial-gradient(circle at 42% 42%, #00d9ff, transparent 64%);
    animation: orb-two 21s ease-in-out infinite alternate;
  }
  .orb-three {
    inset: auto 18% -26% auto;
    width: clamp(220px, 28vw, 470px);
    background: radial-gradient(circle at 50% 50%, #e851c6, transparent 66%);
    animation: orb-three 16s ease-in-out infinite alternate;
  }
  .landing-page {
    position: relative;
    z-index: 1;
    width: min(100% - 32px, 1060px);
    margin: 0 auto;
    padding: clamp(22px, 5vw, 58px) 0 72px;
  }
  .hero-panel,
  .panel,
  .risk-panel,
  .related-panel,
  footer {
    border: 1px solid var(--line);
    background: linear-gradient(140deg, rgba(20, 26, 47, .86), rgba(9, 12, 24, .70));
    box-shadow: 0 24px 80px rgba(0, 0, 0, .28), inset 0 1px 0 rgba(255, 255, 255, .045);
    backdrop-filter: blur(16px);
  }
  .hero-panel {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    padding: clamp(24px, 5vw, 54px);
    border-radius: clamp(24px, 4vw, 38px);
  }
  .hero-panel::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: -55% -14% auto auto;
    width: min(680px, 72vw);
    aspect-ratio: 1;
    border: 1px solid rgba(78, 234, 255, .22);
    border-radius: 50%;
    box-shadow: 0 0 0 48px rgba(133, 104, 255, .045), 0 0 0 96px rgba(78, 234, 255, .025);
    animation: halo-spin 32s linear infinite;
  }
  .hero-panel::after {
    content: '';
    position: absolute;
    z-index: -1;
    inset: 0;
    opacity: .7;
    background: linear-gradient(110deg, transparent 24%, rgba(111, 237, 255, .08) 45%, transparent 61%);
    transform: translateX(-120%);
    animation: sheen 8s ease-in-out infinite;
  }
  .crumb {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin: 0 0 clamp(30px, 5vw, 50px);
    color: var(--quiet);
    font-size: 12px;
  }
  .crumb a { color: var(--muted); text-underline-offset: 4px; }
  .crumb a:hover { color: var(--cyan); }
  .crumb span[aria-current] { max-width: min(600px, 68vw); overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
  .brand-row { display: flex; align-items: center; gap: 12px; }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 800;
    letter-spacing: .015em;
    text-decoration: none;
  }
  .brand-mark {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border: 1px solid rgba(119, 241, 255, .34);
    border-radius: 13px;
    background: linear-gradient(145deg, rgba(78, 234, 255, .24), rgba(148, 118, 255, .24));
    box-shadow: 0 9px 28px rgba(23, 209, 255, .14);
  }
  .brand-mark img { width: 28px; height: 28px; border-radius: 9px; }
  .hero-copy { max-width: 800px; margin-top: clamp(30px, 5vw, 58px); }
  .eyebrow,
  .section-kicker {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 13px;
    color: var(--cyan);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .11em;
    text-transform: uppercase;
  }
  .eyebrow::before {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--lime);
    box-shadow: 0 0 0 5px rgba(99, 245, 187, .12), 0 0 18px var(--lime);
    content: '';
    animation: pulse-dot 2.4s ease-in-out infinite;
  }
  h1,
  h2,
  h3,
  p { margin-top: 0; }
  h1 {
    max-width: 900px;
    margin-bottom: 19px;
    color: #f5f7ff;
    font-size: clamp(32px, 6vw, 62px);
    font-weight: 850;
    letter-spacing: -.045em;
    line-height: 1.12;
    text-wrap: balance;
  }
  .lede {
    max-width: 720px;
    margin-bottom: 0;
    color: #c3cbe0;
    font-size: clamp(16px, 2.1vw, 19px);
    line-height: 1.85;
    text-wrap: pretty;
  }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 31px; }
  .cta,
  .soft-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 52px;
    border-radius: 15px;
    font-weight: 800;
    text-decoration: none;
    transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
  }
  .cta {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    gap: 12px;
    padding: 13px 20px;
    color: #041018;
    background: linear-gradient(122deg, var(--cyan), #a8f7ff 42%, var(--violet));
    box-shadow: 0 14px 34px rgba(51, 201, 255, .22);
  }
  .cta::before {
    position: absolute;
    z-index: -1;
    inset: 0;
    background: linear-gradient(110deg, transparent 22%, rgba(255, 255, 255, .72) 48%, transparent 72%);
    content: '';
    transform: translateX(-130%);
    transition: transform .55s ease;
  }
  .cta:hover { box-shadow: 0 18px 44px rgba(51, 201, 255, .35); transform: translateY(-2px); }
  .cta:hover::before { transform: translateX(130%); }
  .cta-arrow { font-size: 18px; line-height: 1; transition: transform .22s ease; }
  .cta:hover .cta-arrow { transform: translateX(4px); }
  [dir="rtl"] .cta:hover .cta-arrow { transform: translateX(-4px); }
  .soft-cta {
    gap: 9px;
    padding: 13px 18px;
    border: 1px solid rgba(169, 185, 228, .22);
    color: var(--muted);
    background: rgba(255, 255, 255, .025);
  }
  .soft-cta:hover { border-color: rgba(78, 234, 255, .6); color: var(--ink); transform: translateY(-2px); }
  .highlight-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: clamp(36px, 6vw, 62px);
  }
  .highlight {
    min-width: 0;
    padding: 15px;
    border: 1px solid rgba(163, 181, 227, .13);
    border-radius: 16px;
    background: rgba(4, 7, 17, .34);
  }
  .highlight span { display: block; margin-bottom: 5px; color: var(--quiet); font-size: 11px; font-weight: 750; }
  .highlight strong { display: -webkit-box; overflow: hidden; color: #e4e9f7; font-size: 12px; font-weight: 650; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .panel,
  .risk-panel,
  .related-panel { margin-top: 18px; border-radius: 25px; }
  .story-card { padding: clamp(24px, 4vw, 40px); }
  .section-heading { max-width: 710px; }
  .section-heading h2 { margin-bottom: 9px; color: #eff3ff; font-size: clamp(23px, 3vw, 31px); letter-spacing: -.025em; line-height: 1.25; }
  .section-heading > p:last-child { margin-bottom: 0; color: var(--quiet); font-size: 14px; }
  .story-copy { max-width: 770px; margin-top: 25px; }
  .story-copy p { margin-bottom: 17px; color: #bdc6dc; font-size: 15.5px; line-height: 1.95; }
  .story-copy p:last-child { margin-bottom: 0; }
  .facts-panel { padding: clamp(24px, 4vw, 40px); }
  .facts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
  .fact-card {
    position: relative;
    min-width: 0;
    overflow: hidden;
    padding: 21px 20px 19px;
    border: 1px solid rgba(164, 182, 229, .13);
    border-radius: 19px;
    background: linear-gradient(145deg, rgba(32, 40, 71, .45), rgba(9, 13, 27, .42));
    transition: transform .24s ease, border-color .24s ease, background .24s ease;
  }
  .fact-card::after { position: absolute; inset-block: 0; inset-inline-start: 0; width: 3px; background: linear-gradient(var(--cyan), var(--violet)); content: ''; opacity: .72; }
  .fact-card:hover { border-color: rgba(78, 234, 255, .42); background: linear-gradient(145deg, rgba(38, 51, 91, .64), rgba(9, 13, 27, .62)); transform: translateY(-4px); }
  .fact-index { display: block; margin-bottom: 17px; color: rgba(148, 118, 255, .88); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
  .fact-card h3 { margin-bottom: 7px; color: #edf1ff; font-size: 15px; }
  .fact-card p { margin-bottom: 0; color: var(--muted); font-size: 13.5px; line-height: 1.75; }
  .faq-panel { padding: clamp(24px, 4vw, 40px); }
  .faq-list { margin-top: 24px; border-top: 1px solid var(--line); }
  .faq-list details { border-bottom: 1px solid var(--line); }
  .faq-list summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 0; color: #e8edf9; cursor: pointer; font-size: 15px; font-weight: 730; line-height: 1.55; list-style: none; }
  .faq-list summary::-webkit-details-marker { display: none; }
  .faq-plus { display: grid; width: 27px; height: 27px; flex: 0 0 27px; place-items: center; border: 1px solid rgba(135, 150, 195, .26); border-radius: 9px; color: var(--cyan); font-size: 18px; font-weight: 400; transition: transform .2s ease, background .2s ease; }
  details[open] .faq-plus { background: rgba(78, 234, 255, .11); transform: rotate(45deg); }
  .faq-list details p { max-width: 750px; margin: -2px 0 18px; color: var(--muted); font-size: 14px; line-height: 1.85; }
  .risk-panel { display: flex; gap: 16px; padding: 20px 22px; border-color: rgba(255, 183, 70, .26); background: linear-gradient(135deg, rgba(77, 48, 18, .45), rgba(18, 15, 21, .65)); }
  .risk-mark { display: grid; width: 31px; height: 31px; flex: 0 0 31px; place-items: center; border: 1px solid rgba(255, 183, 70, .43); border-radius: 10px; color: #ffbf5d; font-family: ui-monospace, monospace; font-weight: 900; }
  .risk-panel h2 { margin-bottom: 5px; color: #ffe4b5; font-size: 14px; }
  .risk-panel p { margin-bottom: 0; color: #d1c3ac; font-size: 13px; line-height: 1.8; }
  .related-panel { padding: clamp(24px, 4vw, 38px); }
  .related-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 22px; }
  .related-links a { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 14px 15px; border: 1px solid rgba(163, 181, 227, .13); border-radius: 15px; color: #c5cee2; font-size: 13px; font-weight: 650; line-height: 1.55; text-decoration: none; transition: border-color .2s ease, color .2s ease, transform .2s ease; }
  .related-links a:hover { border-color: rgba(78, 234, 255, .48); color: var(--cyan); transform: translateY(-2px); }
  .related-links a span { color: var(--violet); font-size: 16px; }
  footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; margin-top: 18px; padding: 19px 21px; border-radius: 19px; color: var(--quiet); font-size: 12px; }
  footer p { margin: 0; }
  footer a { color: var(--muted); text-underline-offset: 4px; }
  footer a:hover { color: var(--cyan); }
  .reveal { animation: rise-in .75s cubic-bezier(.16, 1, .3, 1) both; animation-delay: var(--delay, 0ms); }
  @keyframes rise-in { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes grid-drift { from { transform: perspective(500px) rotateX(62deg) translate3d(0, -10%, 0); } to { transform: perspective(500px) rotateX(62deg) translate3d(54px, -10%, 0); } }
  @keyframes orb-one { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(11vw, 9vh, 0) scale(1.16); } }
  @keyframes orb-two { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(-12vw, 12vh, 0) scale(1.13); } }
  @keyframes orb-three { from { transform: translate3d(0, 0, 0) scale(.92); } to { transform: translate3d(-8vw, -9vh, 0) scale(1.14); } }
  @keyframes halo-spin { to { transform: rotate(360deg); } }
  @keyframes sheen { 0%, 35% { transform: translateX(-130%); } 62%, 100% { transform: translateX(130%); } }
  @keyframes pulse-dot { 0%, 100% { box-shadow: 0 0 0 5px rgba(99, 245, 187, .12), 0 0 13px var(--lime); } 50% { box-shadow: 0 0 0 8px rgba(99, 245, 187, .04), 0 0 22px var(--lime); } }
  @media (max-width: 680px) {
    .landing-page { width: min(100% - 22px, 1060px); padding-top: 14px; }
    .hero-panel { padding: 24px 20px 21px; border-radius: 24px; }
    .crumb { margin-bottom: 31px; }
    .crumb span[aria-current] { max-width: 56vw; }
    h1 { font-size: clamp(31px, 10.2vw, 47px); }
    .lede { font-size: 15.5px; }
    .hero-actions { display: grid; grid-template-columns: 1fr; }
    .cta, .soft-cta { width: 100%; }
    .highlight-grid, .facts-grid, .related-links { grid-template-columns: 1fr; }
    .highlight { padding: 13px 14px; }
    .highlight strong { -webkit-line-clamp: 3; }
    .panel, .risk-panel, .related-panel { border-radius: 21px; }
    .fact-card { padding: 18px 17px; }
    .risk-panel { padding: 18px; }
    footer { display: block; line-height: 1.9; }
    footer p + p { margin-top: 8px; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
  }
</style>
</head>
<body class="landing-body">
<a class="skip-link" href="#content">${esc(ui.details)}</a>
<div class="ambient" aria-hidden="true">
  <span class="ambient-grid"></span>
  <span class="orb orb-one"></span>
  <span class="orb orb-two"></span>
  <span class="orb orb-three"></span>
</div>
<main id="content" class="landing-page" tabindex="-1">
  <header class="hero-panel reveal" style="--delay:40ms">
    <nav class="crumb" aria-label="${esc(ui.breadcrumb)}">
      <a href="${esc(SITE)}/">${esc(ui.home)}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(page.h1)}</span>
    </nav>

    <div class="brand-row">
      <a class="brand" href="${esc(SITE)}/" aria-label="FBT Swap">
        <span class="brand-mark"><img src="/icon-192.png" alt="" width="28" height="28"></span>
        <span>FBT Swap</span>
      </a>
    </div>

    <div class="hero-copy">
      <p class="eyebrow">${esc(ui.eyebrow)}</p>
      <h1>${esc(page.h1)}</h1>
      <p class="lede">${esc(page.description)}</p>
    </div>

    <div class="hero-actions">
      <a class="cta" href="${esc(appUrl)}"><span>${esc(page.ctaLabel || 'Open the app')}</span><span class="cta-arrow" aria-hidden="true">→</span></a>
      <a class="soft-cta" href="#facts"><span>${esc(ui.details)}</span><span aria-hidden="true">↓</span></a>
    </div>

    <div class="highlight-grid" aria-label="${esc(ui.highlights)}">
      ${highlights}
    </div>
  </header>

  <section class="story-card panel reveal" aria-labelledby="story-heading" style="--delay:120ms">
    <div class="section-heading">
      <p class="section-kicker">FBT Swap</p>
      <h2 id="story-heading">${esc(ui.story)}</h2>
    </div>
    <div class="story-copy">
      ${page.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('\n      ')}
    </div>
  </section>

  <section id="facts" class="facts-panel panel reveal" aria-labelledby="facts-heading" style="--delay:190ms">
    <div class="section-heading">
      <p class="section-kicker">${esc(ui.highlights)}</p>
      <h2 id="facts-heading">${esc(page.glanceLabel || ui.highlights)}</h2>
    </div>
    <div class="facts-grid">
      ${factCards}
    </div>
  </section>

  ${faqMarkup}

  <section class="risk-panel reveal" aria-labelledby="risk-heading" style="--delay:320ms">
    <span class="risk-mark" aria-hidden="true">!</span>
    <div>
      <h2 id="risk-heading">${esc(ui.risk)}</h2>
      <p>${esc(
        page.riskText ||
          'Crypto assets are volatile and on-chain transactions cannot be reversed. You can lose money, including all of it. Nothing here is financial advice.'
      )}</p>
    </div>
  </section>

  <section class="related-panel reveal" aria-labelledby="related-heading" style="--delay:380ms">
    <div class="section-heading">
      <p class="section-kicker">FBT Swap</p>
      <h2 id="related-heading">${esc(ui.related)}</h2>
    </div>
    <div class="related-links">
      ${siblingLinks}
    </div>
  </section>

  <footer class="reveal" style="--delay:440ms">
    <p><a href="${esc(SITE)}/">FBT Swap</a> &middot; <a href="${esc(SITE)}/#/legal/privacy">Privacy</a> &middot; <a href="${esc(SITE)}/#/legal/terms">Terms</a></p>
    <p>Fanous Bazaar Pishgam Co., Isfahan, Iran</p>
  </footer>
</main>
</body>
</html>
`;
}

/* -------------------------------------------------------------------------- */

function main() {
  for (const page of PAGES) {
    /*
     * A DIRECTORY with index.html, not `slug.html`. Static hosts serve
     * `/slug/` from `/slug/index.html`, giving a clean URL with no extension
     * — and a URL that ends in `.html` looks abandoned in 2026.
     */
    const dir = join(OUT, page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), render(page), 'utf8');
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
    ...PAGES.map(
      (p) =>
        `  <url>\n    <loc>${SITE}/${encodeURIComponent(p.slug)}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`
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

  console.log(`▸ generated ${PAGES.length} landing pages + sitemap`);
  for (const p of PAGES) console.log(`  /${p.slug}`);
}

main();
